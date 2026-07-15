using System.Text.Json;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    public async Task<IReadOnlyList<AdminManagedListSummary>> GetAdminManagedListsAsync(
        CancellationToken cancellationToken)
    {
        var lists = await QueryAsync(
            """
            SELECT type.id, type.lookup_key, type.name, managed.category,
                   managed.description, managed.display_order
            FROM core.admin_managed_lists managed
            JOIN core.lookup_types type ON type.id = managed.lookup_type_id
            WHERE managed.is_active = 1
              AND type.is_active = 1
              AND type.archived_at IS NULL
            ORDER BY managed.display_order, type.name;
            """,
            reader => new ManagedListRow(
                reader.GetGuid(0), reader.GetString(1), reader.GetString(2), reader.GetString(3),
                GetStringOrNull(reader, 4), reader.GetInt32(5)),
            cancellationToken);

        var values = await QueryAsync(
            """
            SELECT value.lookup_type_id, value.id, value.value_key, value.display_name,
                   value.display_order, value.is_active, value.archived_at,
                   value.created_at, value.updated_at
            FROM core.lookup_values value
            JOIN core.admin_managed_lists managed ON managed.lookup_type_id = value.lookup_type_id
            ORDER BY value.lookup_type_id, value.display_order, value.display_name;
            """,
            reader => new ManagedListValueRow(
                reader.GetGuid(0), reader.GetGuid(1), reader.GetString(2), reader.GetString(3),
                reader.GetInt32(4), reader.GetBoolean(5) && reader.IsDBNull(6),
                reader.GetFieldValue<DateTimeOffset>(7), GetDateTimeOffsetOrNull(reader, 8)),
            cancellationToken);

        var usage = await QueryAsync(
            """
            SELECT lookup_type_id, display_name
            FROM core.lookup_usage_registry
            ORDER BY lookup_type_id, display_name;
            """,
            reader => new ManagedListUsageRow(reader.GetGuid(0), reader.GetString(1)),
            cancellationToken);

        return lists.Select(list => new AdminManagedListSummary(
            list.LookupKey,
            list.Name,
            list.Category,
            list.Description,
            list.DisplayOrder,
            usage.Where(item => item.LookupTypeId == list.Id).Select(item => item.DisplayName).ToArray(),
            values.Where(value => value.LookupTypeId == list.Id)
                .Select(value => new AdminManagedListValueSummary(
                    value.Id,
                    value.ValueKey,
                    value.DisplayName,
                    value.DisplayOrder,
                    value.IsActive,
                    value.CreatedAt,
                    value.UpdatedAt))
                .ToArray())).ToArray();
    }

    public async Task<bool> UpdateManagedListValueAsync(
        string lookupKey,
        Guid id,
        string displayName,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        displayName = displayName.Trim();
        if (string.IsNullOrWhiteSpace(displayName) || displayName.Length > 200)
        {
            throw new WorkflowValidationException("Enter a list value of no more than 200 characters.");
        }

        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            string? beforeJson;
            await using (var before = new SqlCommand(
                """
                SELECT (
                    SELECT value.display_name AS displayName, value.display_order AS displayOrder,
                           value.is_active AS isActive
                    FROM core.lookup_values value
                    JOIN core.lookup_types type ON type.id = value.lookup_type_id
                    JOIN core.admin_managed_lists managed ON managed.lookup_type_id = type.id
                    WHERE value.id = @id AND type.lookup_key = @lookupKey
                    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
                );
                """,
                connection,
                (SqlTransaction)transaction))
            {
                before.Parameters.AddWithValue("@id", id);
                before.Parameters.AddWithValue("@lookupKey", lookupKey.Trim());
                beforeJson = await before.ExecuteScalarAsync(cancellationToken) as string;
            }

            if (string.IsNullOrWhiteSpace(beforeJson))
            {
                await transaction.RollbackAsync(cancellationToken);
                return false;
            }

            await using (var command = new SqlCommand(
                """
                IF EXISTS (
                    SELECT 1
                    FROM core.lookup_values candidate
                    JOIN core.lookup_types type ON type.id = candidate.lookup_type_id
                    WHERE type.lookup_key = @lookupKey
                      AND candidate.id <> @id
                      AND candidate.display_name = @displayName
                      AND candidate.archived_at IS NULL
                )
                    THROW 51000, 'That list value already exists.', 1;

                UPDATE value
                SET display_name = @displayName,
                    updated_by_user_account_id = @updatedBy,
                    updated_at = sysutcdatetime()
                FROM core.lookup_values value
                JOIN core.lookup_types type ON type.id = value.lookup_type_id
                JOIN core.admin_managed_lists managed ON managed.lookup_type_id = type.id
                WHERE value.id = @id AND type.lookup_key = @lookupKey;
                """,
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@id", id);
                command.Parameters.AddWithValue("@lookupKey", lookupKey.Trim());
                command.Parameters.AddWithValue("@displayName", displayName);
                command.Parameters.AddWithValue("@updatedBy", ToDbValue(currentUser.UserAccountId));
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            await WriteAuditWithReasonAsync(
                connection, transaction, currentUser.UserAccountId, null,
                "lookup_value", id, "lookup.value_updated",
                $"List value updated by {currentUser.DisplayName}.",
                beforeJson, JsonSerializer.Serialize(new { displayName }), null, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return true;
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task<bool> SetManagedListValueStatusAsync(
        string lookupKey,
        Guid id,
        bool isActive,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            if (!isActive)
            {
                await using var count = new SqlCommand(
                    """
                    SELECT COUNT(*)
                    FROM core.lookup_values value
                    JOIN core.lookup_types type ON type.id = value.lookup_type_id
                    WHERE type.lookup_key = @lookupKey
                      AND value.is_active = 1
                      AND value.archived_at IS NULL;
                    """,
                    connection,
                    (SqlTransaction)transaction);
                count.Parameters.AddWithValue("@lookupKey", lookupKey.Trim());
                if (Convert.ToInt32(await count.ExecuteScalarAsync(cancellationToken)) <= 1)
                {
                    throw new WorkflowValidationException("At least one active value must remain in the list.");
                }
            }

            int rows;
            await using (var command = new SqlCommand(
                """
                UPDATE value
                SET is_active = @isActive,
                    archived_at = NULL,
                    updated_by_user_account_id = @updatedBy,
                    updated_at = sysutcdatetime()
                FROM core.lookup_values value
                JOIN core.lookup_types type ON type.id = value.lookup_type_id
                JOIN core.admin_managed_lists managed ON managed.lookup_type_id = type.id
                WHERE value.id = @id AND type.lookup_key = @lookupKey;
                """,
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@id", id);
                command.Parameters.AddWithValue("@lookupKey", lookupKey.Trim());
                command.Parameters.AddWithValue("@isActive", isActive);
                command.Parameters.AddWithValue("@updatedBy", ToDbValue(currentUser.UserAccountId));
                rows = await command.ExecuteNonQueryAsync(cancellationToken);
            }

            if (rows == 0)
            {
                await transaction.RollbackAsync(cancellationToken);
                return false;
            }

            await WriteAuditWithReasonAsync(
                connection, transaction, currentUser.UserAccountId, null,
                "lookup_value", id, isActive ? "lookup.value_reactivated" : "lookup.value_deactivated",
                $"List value {(isActive ? "reactivated" : "deactivated")} by {currentUser.DisplayName}.",
                null, JsonSerializer.Serialize(new { isActive }), null, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return true;
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task ReorderManagedListValuesAsync(
        string lookupKey,
        IReadOnlyList<Guid> valueIds,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        var orderedIds = valueIds.Distinct().ToArray();
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            await using (var validate = new SqlCommand(
                """
                SELECT COUNT(*)
                FROM core.lookup_values value
                JOIN core.lookup_types type ON type.id = value.lookup_type_id
                JOIN core.admin_managed_lists managed ON managed.lookup_type_id = type.id
                WHERE type.lookup_key = @lookupKey;
                """,
                connection,
                (SqlTransaction)transaction))
            {
                validate.Parameters.AddWithValue("@lookupKey", lookupKey.Trim());
                if (Convert.ToInt32(await validate.ExecuteScalarAsync(cancellationToken)) != orderedIds.Length)
                {
                    throw new WorkflowValidationException("The reordered list must contain every value, including inactive values.");
                }
            }

            for (var index = 0; index < orderedIds.Length; index++)
            {
                await using var command = new SqlCommand(
                    """
                    UPDATE value
                    SET display_order = @displayOrder,
                        updated_by_user_account_id = @updatedBy,
                        updated_at = sysutcdatetime()
                    FROM core.lookup_values value
                    JOIN core.lookup_types type ON type.id = value.lookup_type_id
                    WHERE value.id = @id AND type.lookup_key = @lookupKey;
                    """,
                    connection,
                    (SqlTransaction)transaction);
                command.Parameters.AddWithValue("@id", orderedIds[index]);
                command.Parameters.AddWithValue("@lookupKey", lookupKey.Trim());
                command.Parameters.AddWithValue("@displayOrder", (index + 1) * 10);
                command.Parameters.AddWithValue("@updatedBy", ToDbValue(currentUser.UserAccountId));
                if (await command.ExecuteNonQueryAsync(cancellationToken) == 0)
                {
                    throw new WorkflowValidationException("A value does not belong to the selected list.");
                }
            }

            await WriteAuditWithReasonAsync(
                connection, transaction, currentUser.UserAccountId, null,
                "lookup_type", null, "lookup.values_reordered",
                $"List values reordered by {currentUser.DisplayName}.",
                null, JsonSerializer.Serialize(new { lookupKey, orderedIds }), null, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task<IReadOnlyList<SharedThemeGroupSummary>> GetSharedThemeGroupsAsync(
        string applicationKey,
        bool includeInactive,
        CancellationToken cancellationToken)
    {
        var rows = await QueryAsync(
            """
            SELECT theme_group.id, theme_group.group_key, theme_group.name,
                   theme_group.description, theme_group.display_order, theme_group.is_active,
                   theme.id, theme.theme_key, theme.name, theme.description, theme.asset_key,
                   application.display_order, theme.is_other, theme.is_active
            FROM core.theme_groups theme_group
            LEFT JOIN core.themes theme ON theme.theme_group_id = theme_group.id
                AND theme.archived_at IS NULL
            LEFT JOIN core.theme_applications application ON application.theme_id = theme.id
                AND application.application_key = @applicationKey
            WHERE theme_group.archived_at IS NULL
              AND (@includeInactive = 1 OR theme_group.is_active = 1)
              AND (
                    theme.id IS NULL
                    OR (
                        application.theme_id IS NOT NULL
                        AND (@includeInactive = 1 OR (theme.is_active = 1 AND application.is_active = 1))
                    )
              )
            ORDER BY theme_group.display_order, application.display_order, theme.name;
            """,
            command =>
            {
                command.Parameters.AddWithValue("@applicationKey", applicationKey.Trim());
                command.Parameters.AddWithValue("@includeInactive", includeInactive);
            },
            reader => new SharedThemeRow(
                reader.GetGuid(0), reader.GetString(1), reader.GetString(2), GetStringOrNull(reader, 3),
                reader.GetInt32(4), reader.GetBoolean(5), GetGuidOrNull(reader, 6), GetStringOrNull(reader, 7),
                GetStringOrNull(reader, 8), GetStringOrNull(reader, 9), GetStringOrNull(reader, 10),
                reader.IsDBNull(11) ? null : reader.GetInt32(11),
                reader.IsDBNull(12) ? null : reader.GetBoolean(12),
                reader.IsDBNull(13) ? null : reader.GetBoolean(13)),
            cancellationToken);

        return rows.GroupBy(row => new
            {
                row.GroupId, row.GroupKey, row.GroupName, row.GroupDescription,
                row.GroupDisplayOrder, row.GroupIsActive
            })
            .Select(group => new SharedThemeGroupSummary(
                group.Key.GroupId,
                group.Key.GroupKey,
                group.Key.GroupName,
                group.Key.GroupDescription,
                group.Key.GroupDisplayOrder,
                group.Key.GroupIsActive,
                group.Where(row => row.ThemeId.HasValue)
                    .Select(row => new SharedThemeSummary(
                        row.ThemeId!.Value,
                        row.GroupId,
                        row.ThemeKey!,
                        row.ThemeName!,
                        row.ThemeDescription,
                        row.AssetKey,
                        row.ThemeDisplayOrder!.Value,
                        row.IsOther!.Value,
                        row.ThemeIsActive!.Value))
                    .ToArray()))
            .OrderBy(group => group.DisplayOrder)
            .ToArray();
    }

    public async Task<IReadOnlyList<AdminRecordSummary>> GetAdminRecordsAsync(CancellationToken cancellationToken)
    {
        return await QueryAsync(
            """
            SELECT record.id, module.module_key, module.name, record.record_type, record.title,
                   subject.display_name, record.subject_staff_id, owner.display_name,
                   faculty.code, faculty.name, team.code, team.name,
                   COALESCE(liv.status, practice.status, coaching.status, submission.status,
                            CASE WHEN record.archived_at IS NULL THEN N'complete' ELSE N'archived' END) AS status,
                   record.record_date, record.created_at, record.updated_at, record.archived_at,
                   deleted_staff.display_name, record.deletion_reason
            FROM core.records record
            JOIN core.modules module ON module.id = record.module_id
            LEFT JOIN people.staff subject ON subject.id = record.subject_staff_id
            LEFT JOIN people.staff owner ON owner.id = record.owner_staff_id
            LEFT JOIN org.org_units area ON area.id = COALESCE(record.org_unit_id, subject.primary_org_unit_id, owner.primary_org_unit_id)
            LEFT JOIN org.org_units faculty ON faculty.id = CASE WHEN area.org_unit_type = N'faculty' THEN area.id ELSE area.parent_org_unit_id END
            LEFT JOIN org.org_units team ON team.id = CASE WHEN area.org_unit_type = N'team' THEN area.id ELSE NULL END
            LEFT JOIN quality.liv_records liv ON liv.record_id = record.id
            LEFT JOIN quality.elevate_practice_assessments practice ON practice.record_id = record.id
            LEFT JOIN quality.coaching_sessions coaching ON coaching.record_id = record.id
            OUTER APPLY (
                SELECT TOP (1) form_submission.status
                FROM forms.form_submissions form_submission
                WHERE form_submission.record_id = record.id
                ORDER BY form_submission.created_at DESC
            ) submission
            LEFT JOIN auth.user_accounts deleted_account ON deleted_account.id = record.deleted_by_user_account_id
            LEFT JOIN people.staff deleted_staff ON deleted_staff.id = deleted_account.staff_id
            ORDER BY COALESCE(record.updated_at, record.created_at) DESC
            OPTION (FORCE ORDER, MAXDOP 1);
            """,
            reader => new AdminRecordSummary(
                reader.GetGuid(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.GetString(4),
                GetStringOrNull(reader, 5), GetGuidOrNull(reader, 6), GetStringOrNull(reader, 7),
                GetStringOrNull(reader, 8), GetStringOrNull(reader, 9), GetStringOrNull(reader, 10), GetStringOrNull(reader, 11),
                reader.GetString(12), GetDateOnlyOrNull(reader, 13), reader.GetFieldValue<DateTimeOffset>(14),
                GetDateTimeOffsetOrNull(reader, 15), GetDateTimeOffsetOrNull(reader, 16), GetStringOrNull(reader, 17), GetStringOrNull(reader, 18)),
            cancellationToken);
    }

    public async Task<bool> SetAdminRecordArchivedStateAsync(
        Guid recordId,
        bool archived,
        string? reason,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        var normalizedReason = archived ? RequireReason(reason) : reason?.Trim();
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            string? recordType = null;
            bool currentlyArchived = false;
            await using (var select = new SqlCommand(
                "SELECT record_type, archived_at FROM core.records WHERE id = @recordId;",
                connection,
                (SqlTransaction)transaction))
            {
                select.Parameters.AddWithValue("@recordId", recordId);
                await using var reader = await select.ExecuteReaderAsync(cancellationToken);
                if (await reader.ReadAsync(cancellationToken))
                {
                    recordType = reader.GetString(0);
                    currentlyArchived = !reader.IsDBNull(1);
                }
            }

            if (recordType is null)
            {
                await transaction.RollbackAsync(cancellationToken);
                return false;
            }
            if (currentlyArchived == archived)
            {
                await transaction.CommitAsync(cancellationToken);
                return true;
            }

            await using (var command = new SqlCommand(
                """
                UPDATE core.records
                SET archived_at = CASE WHEN @archived = 1 THEN sysutcdatetime() ELSE NULL END,
                    deleted_by_user_account_id = CASE WHEN @archived = 1 THEN @userAccountId ELSE NULL END,
                    deletion_reason = CASE WHEN @archived = 1 THEN @reason ELSE NULL END,
                    updated_by_user_account_id = @userAccountId,
                    updated_at = sysutcdatetime()
                WHERE id = @recordId;

                UPDATE forms.form_submissions
                SET archived_at = CASE WHEN @archived = 1 THEN sysutcdatetime() ELSE NULL END,
                    updated_at = sysutcdatetime()
                WHERE record_id = @recordId;

                UPDATE quality.liv_records
                SET archived_at = CASE WHEN @archived = 1 THEN sysutcdatetime() ELSE NULL END,
                    updated_by_user_account_id = @userAccountId,
                    updated_at = sysutcdatetime()
                WHERE record_id = @recordId;

                UPDATE visit
                SET archived_at = CASE WHEN @archived = 1 THEN sysutcdatetime() ELSE NULL END,
                    updated_by_user_account_id = @userAccountId,
                    updated_at = sysutcdatetime()
                FROM quality.liv_visits visit
                JOIN quality.liv_records liv ON liv.id = visit.liv_record_id
                WHERE liv.record_id = @recordId;

                UPDATE quality.elevate_practice_assessments
                SET archived_at = CASE WHEN @archived = 1 THEN sysutcdatetime() ELSE NULL END,
                    updated_at = sysutcdatetime()
                WHERE record_id = @recordId;

                UPDATE quality.coaching_sessions
                SET archived_at = CASE WHEN @archived = 1 THEN sysutcdatetime() ELSE NULL END,
                    updated_by_user_account_id = @userAccountId,
                    updated_at = sysutcdatetime()
                WHERE record_id = @recordId;

                UPDATE quality.actions
                SET archived_at = CASE
                        WHEN @archived = 1 AND archived_at IS NULL THEN sysutcdatetime()
                        WHEN @archived = 0 AND archived_with_source = 1 THEN NULL
                        ELSE archived_at
                    END,
                    archived_with_source = CASE WHEN @archived = 1 AND archived_at IS NULL THEN 1 WHEN @archived = 0 THEN 0 ELSE archived_with_source END,
                    deleted_by_user_account_id = CASE
                        WHEN @archived = 1 AND archived_at IS NULL THEN @userAccountId
                        WHEN @archived = 0 AND archived_with_source = 1 THEN NULL
                        ELSE deleted_by_user_account_id
                    END,
                    deletion_reason = CASE
                        WHEN @archived = 1 AND archived_at IS NULL THEN N'Archived with source record.'
                        WHEN @archived = 0 AND archived_with_source = 1 THEN NULL
                        ELSE deletion_reason
                    END,
                    updated_by_user_account_id = @userAccountId,
                    updated_at = sysutcdatetime()
                WHERE source_record_id = @recordId
                  AND (@archived = 1 OR archived_with_source = 1);
                """,
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@recordId", recordId);
                command.Parameters.AddWithValue("@archived", archived);
                command.Parameters.AddWithValue("@userAccountId", ToDbValue(currentUser.UserAccountId));
                command.Parameters.AddWithValue("@reason", ToDbValue(normalizedReason));
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            await WriteAuditWithReasonAsync(
                connection, transaction, currentUser.UserAccountId, recordId,
                "record", recordId, archived ? "record.archived" : "record.restored",
                $"Record {(archived ? "archived" : "restored")} by {currentUser.DisplayName}.",
                JsonSerializer.Serialize(new { archived = currentlyArchived }),
                JsonSerializer.Serialize(new { archived }), normalizedReason, cancellationToken);

            await transaction.CommitAsync(cancellationToken);
            return true;
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task<ElevatePracticeWorkspaceSummary?> GetElevatePracticeWorkspaceByRecordAsync(
        Guid recordId,
        CancellationToken cancellationToken)
    {
        var source = await QueryAsync(
            """
            SELECT staff_id, academic_year
            FROM quality.elevate_practice_assessments
            WHERE record_id = @recordId AND archived_at IS NULL;
            """,
            command => command.Parameters.AddWithValue("@recordId", recordId),
            reader => new ElevateRecordLookupRow(reader.GetGuid(0), reader.GetString(1)),
            cancellationToken);
        return source.Count == 0
            ? null
            : await GetElevatePracticeWorkspaceAsync(source[0].StaffId, source[0].AcademicYear, false, cancellationToken);
    }

    private sealed record ManagedListRow(Guid Id, string LookupKey, string Name, string Category, string? Description, int DisplayOrder);
    private sealed record ManagedListValueRow(Guid LookupTypeId, Guid Id, string ValueKey, string DisplayName, int DisplayOrder, bool IsActive, DateTimeOffset CreatedAt, DateTimeOffset? UpdatedAt);
    private sealed record ManagedListUsageRow(Guid LookupTypeId, string DisplayName);
    private sealed record SharedThemeRow(
        Guid GroupId, string GroupKey, string GroupName, string? GroupDescription,
        int GroupDisplayOrder, bool GroupIsActive, Guid? ThemeId, string? ThemeKey,
        string? ThemeName, string? ThemeDescription, string? AssetKey,
        int? ThemeDisplayOrder, bool? IsOther, bool? ThemeIsActive);
    private sealed record ElevateRecordLookupRow(Guid StaffId, string AcademicYear);
}
