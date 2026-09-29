using System.Data;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    public async Task<IReadOnlyList<QaNotSeenSetting>> GetQaNotSeenSettingsAsync(CancellationToken token) =>
        await QueryAsync("""
            SELECT template.id, activity.name, template.name, template.allows_not_seen, template.row_version
            FROM qa.activity_templates template
            JOIN qa.activity_types activity ON activity.id = template.activity_type_id
            WHERE template.archived_at IS NULL AND activity.archived_at IS NULL
              AND template.is_active = 1 AND activity.is_active = 1
            ORDER BY activity.display_order, activity.name, template.name;
            """, reader => new QaNotSeenSetting(reader.GetGuid(0), reader.GetString(1), reader.GetString(2), reader.GetBoolean(3), reader.GetFieldValue<byte[]>(4)), token);

    public async Task<QaNotSeenSetting> SaveQaNotSeenSettingAsync(Guid templateId, SaveQaNotSeenSettingRequest request, CurrentUser user, CancellationToken token)
    {
        if (!QaReviewPolicy.CanManage(user)) throw new UnauthorizedAccessException("QA review management permission is required.");
        if (request.RowVersion is not { Length: 8 }) throw new WorkflowValidationException("Reload the QA form settings before saving.");
        await using var connection = await OpenConnectionAsync(token);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(token);
        await using var command = new SqlCommand("""
            UPDATE template SET allows_not_seen = @enabled, updated_at = sysutcdatetime()
            OUTPUT deleted.allows_not_seen
            FROM qa.activity_templates template
            JOIN qa.activity_types activity ON activity.id = template.activity_type_id
            WHERE template.id = @id AND template.row_version = @version
              AND template.archived_at IS NULL AND activity.archived_at IS NULL
              AND template.is_active = 1 AND activity.is_active = 1;
            """, connection, transaction);
        command.Parameters.AddWithValue("@id", templateId);
        command.Parameters.AddWithValue("@enabled", request.AllowsNotSeen);
        command.Parameters.Add("@version", SqlDbType.Timestamp, 8).Value = request.RowVersion;
        var previous = await command.ExecuteScalarAsync(token);
        if (previous is null or DBNull) throw new DBConcurrencyException("This QA form was changed or is no longer active. Reload its settings before saving.");
        await WriteAuditAsync(connection, transaction, user.UserAccountId, null, "qa_activity_template", templateId,
            "not_seen_configured", "Updated optional neutral Not seen outcome. Existing responses and closure snapshots are retained.",
            JsonSerializer.Serialize(new { AllowsNotSeen = (bool)previous }), JsonSerializer.Serialize(new { request.AllowsNotSeen }), token);
        await transaction.CommitAsync(token);
        return (await GetQaNotSeenSettingsAsync(token)).Single(row => row.TemplateId == templateId);
    }
}
