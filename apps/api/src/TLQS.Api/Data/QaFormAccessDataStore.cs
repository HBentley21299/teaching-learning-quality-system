using System.Data;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    private const string ActiveQaStaffSql = """
        SELECT 1 FROM auth.user_accounts account
        JOIN auth.user_roles assignment ON assignment.user_account_id = account.id
        JOIN auth.roles role ON role.id = assignment.role_id
        WHERE account.staff_id = staff.id AND account.archived_at IS NULL AND account.is_disabled = 0
          AND account.account_status = N'active' AND staff.account_status = N'active' AND staff.archived_at IS NULL
          AND assignment.active_from <= sysutcdatetime()
          AND (assignment.active_to IS NULL OR assignment.active_to > sysutcdatetime())
          AND role.role_key = N'qa_staff' AND role.is_active = 1 AND role.archived_at IS NULL
        """;

    public async Task<QaFormAccessSettings> GetQaFormAccessSettingsAsync(CurrentUser user, CancellationToken token)
    {
        if (!QaReviewPolicy.CanManage(user)) throw new UnauthorizedAccessException("QA review management permission is required.");
        var templates = await QueryAsync("""
            SELECT template.id, activity.name, template.name, template.restrict_qa_staff, template.row_version
            FROM qa.activity_templates template JOIN qa.activity_types activity ON activity.id = template.activity_type_id
            WHERE template.archived_at IS NULL AND activity.archived_at IS NULL AND template.is_active = 1 AND activity.is_active = 1
            ORDER BY activity.display_order, activity.name, template.name;
            """, reader => new QaFormAccessSetting(reader.GetGuid(0), reader.GetString(1), reader.GetString(2), reader.GetBoolean(3), [], reader.GetFieldValue<byte[]>(4)), token);
        var members = await QueryAsync("SELECT activity_template_id, staff_id FROM qa.activity_template_staff;",
            reader => (TemplateId: reader.GetGuid(0), StaffId: reader.GetGuid(1)), token);
        var staff = await QueryAsync("""
            SELECT staff.id, staff.display_name, staff.email
            FROM people.staff staff
            WHERE EXISTS (
            """ + ActiveQaStaffSql + """
            ) OR EXISTS (SELECT 1 FROM qa.activity_template_staff member WHERE member.staff_id = staff.id)
            ORDER BY staff.display_name, staff.id;
            """, reader => new QaFormAccessStaff(reader.GetGuid(0), reader.GetString(1), GetStringOrNull(reader, 2) ?? ""), token);
        return new QaFormAccessSettings(templates.Select(form => form with { StaffIds = members.Where(member => member.TemplateId == form.TemplateId).Select(member => member.StaffId).ToArray() }).ToArray(), staff);
    }

    public async Task<QaFormAccessSetting> SaveQaFormAccessSettingAsync(Guid templateId,
        SaveQaFormAccessSettingRequest request, CurrentUser user, CancellationToken token)
    {
        if (!QaReviewPolicy.CanManage(user)) throw new UnauthorizedAccessException("QA review management permission is required.");
        if (request.RowVersion is not { Length: 8 }) throw new WorkflowValidationException("Reload the form access settings before saving.");
        if (request.StaffIds is null || request.StaffIds.Count > 5000 || request.StaffIds.Contains(Guid.Empty))
            throw new WorkflowValidationException("Select valid QA staff members.");
        var ids = request.StaffIds.Distinct().Order().ToArray();
        await using var connection = await OpenConnectionAsync(token);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(token);
        // Lock the same template used by evidence saves before changing any members.
        await using var update = new SqlCommand("""
            UPDATE template SET restrict_qa_staff = @restricted, updated_at = sysutcdatetime()
            OUTPUT deleted.restrict_qa_staff
            FROM qa.activity_templates template JOIN qa.activity_types activity ON activity.id = template.activity_type_id
            WHERE template.id = @id AND template.row_version = @version
              AND template.archived_at IS NULL AND template.is_active = 1 AND activity.archived_at IS NULL AND activity.is_active = 1;
            """, connection, transaction);
        update.Parameters.AddWithValue("@id", templateId);
        update.Parameters.AddWithValue("@restricted", request.RestrictQaStaff);
        update.Parameters.Add("@version", SqlDbType.Timestamp, 8).Value = request.RowVersion;
        var previous = await update.ExecuteScalarAsync(token);
        if (previous is null or DBNull) throw new DBConcurrencyException("This form was changed or is no longer active. Reload its access settings before saving.");
        var previousIds = new List<Guid>();
        await using (var before = new SqlCommand("SELECT staff_id FROM qa.activity_template_staff WHERE activity_template_id = @id;", connection, transaction))
        {
            before.Parameters.AddWithValue("@id", templateId);
            await using var reader = await before.ExecuteReaderAsync(token);
            while (await reader.ReadAsync(token)) previousIds.Add(reader.GetGuid(0));
        }
        await using var validate = new SqlCommand("""
            SELECT COUNT(*) FROM OPENJSON(@ids) WITH (id uniqueidentifier '$') selected
            JOIN people.staff staff ON staff.id = selected.id
            WHERE EXISTS (
            """ + ActiveQaStaffSql + """
            ) OR EXISTS (SELECT 1 FROM qa.activity_template_staff member WHERE member.activity_template_id = @id AND member.staff_id = staff.id);
            """, connection, transaction);
        validate.Parameters.AddWithValue("@ids", JsonSerializer.Serialize(ids));
        validate.Parameters.AddWithValue("@id", templateId);
        if (Convert.ToInt32(await validate.ExecuteScalarAsync(token)) != ids.Length)
            throw new WorkflowValidationException("New whitelist members must have an active QA Staff account. Reload the available staff and try again.");
        await using var replace = new SqlCommand("""
            DELETE FROM qa.activity_template_staff WHERE activity_template_id = @id;
            INSERT qa.activity_template_staff (activity_template_id, staff_id)
            SELECT @id, id FROM OPENJSON(@ids) WITH (id uniqueidentifier '$');
            """, connection, transaction);
        replace.Parameters.AddWithValue("@id", templateId);
        replace.Parameters.AddWithValue("@ids", JsonSerializer.Serialize(ids));
        await replace.ExecuteNonQueryAsync(token);
        await WriteAuditAsync(connection, transaction, user.UserAccountId, null, "qa_activity_template", templateId,
            "form_access_configured", "Updated QA Staff form submission whitelist. Report access is unchanged.",
            JsonSerializer.Serialize(new { RestrictQaStaff = (bool)previous, StaffIds = previousIds }),
            JsonSerializer.Serialize(new { request.RestrictQaStaff, StaffIds = ids }), token);
        await transaction.CommitAsync(token);
        return (await GetQaFormAccessSettingsAsync(user, token)).Forms.Single(form => form.TemplateId == templateId);
    }

    private async Task<IReadOnlyDictionary<Guid, bool>> GetQaFormSubmissionAccessAsync(Guid reviewId, CurrentUser user, CancellationToken token)
    {
        await using var connection = await OpenConnectionAsync(token);
        return await ReadQaFormSubmissionAccessAsync(connection, null, reviewId, user, token);
    }

    private static async Task<IReadOnlyDictionary<Guid, bool>> ReadQaFormSubmissionAccessAsync(
        SqlConnection connection, SqlTransaction? transaction, Guid reviewId, CurrentUser user, CancellationToken token)
    {
        await using var command = new SqlCommand("""
            SELECT activity.id, template.restrict_qa_staff,
                CAST(CASE WHEN EXISTS (SELECT 1 FROM qa.activity_template_staff member WITH (HOLDLOCK)
                    WHERE member.activity_template_id = template.id AND member.staff_id = @staff) THEN 1 ELSE 0 END AS bit),
                CAST(CASE WHEN EXISTS (
                    SELECT 1 FROM auth.user_roles assignment JOIN auth.roles role ON role.id = assignment.role_id
                    WHERE assignment.user_account_id = @user AND role.role_key = N'qa_staff'
                      AND role.is_active = 1 AND role.archived_at IS NULL
                      AND assignment.active_from <= sysutcdatetime() AND (assignment.active_to IS NULL OR assignment.active_to > sysutcdatetime())
                ) THEN 1 ELSE 0 END AS bit),
                CAST(CASE WHEN EXISTS (
                    SELECT 1 FROM auth.user_roles assignment JOIN auth.roles role ON role.id = assignment.role_id
                    JOIN auth.role_permissions grant_permission ON grant_permission.role_id = role.id
                    JOIN auth.permissions permission ON permission.id = grant_permission.permission_id
                    WHERE assignment.user_account_id = @user AND role.role_key <> N'qa_staff'
                      AND permission.permission_key = N'qa_reviews.submit_all'
                      AND role.is_active = 1 AND role.archived_at IS NULL
                      AND assignment.active_from <= sysutcdatetime() AND (assignment.active_to IS NULL OR assignment.active_to > sysutcdatetime())
                ) THEN 1 ELSE 0 END AS bit)
            FROM qa.review_activities activity
            JOIN qa.activity_templates template WITH (HOLDLOCK) ON template.id = activity.activity_template_id
            WHERE activity.review_id = @review;
            """, connection, transaction);
        command.Parameters.AddWithValue("@review", reviewId);
        command.Parameters.AddWithValue("@user", ToDbValue(user.UserAccountId));
        command.Parameters.AddWithValue("@staff", ToDbValue(user.StaffId));
        var result = new Dictionary<Guid, bool>();
        await using var reader = await command.ExecuteReaderAsync(token);
        while (await reader.ReadAsync(token))
            result[reader.GetGuid(0)] = QaFormAccessPolicy.CanComplete(QaReviewPolicy.CanSubmitByPermission(user),
                QaReviewPolicy.CanManage(user), reader.GetBoolean(3), reader.GetBoolean(4), reader.GetBoolean(1), reader.GetBoolean(2));
        return result;
    }
}
