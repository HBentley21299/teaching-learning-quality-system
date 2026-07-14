using System.Text.Json;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Security;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    public Task<IReadOnlyList<AdminWorkScrutinyRecordSummary>> GetAdminWorkScrutinyRecordsAsync(
        CancellationToken cancellationToken) =>
        QueryAsync(
            """
            SELECT
                record.id,
                record.title,
                record.summary,
                record.org_unit_id,
                org_unit.code,
                org_unit.name,
                parent_org.code,
                record.record_date,
                record.created_at,
                owner.display_name,
                submission.id,
                submission.status,
                record.archived_at,
                action_counts.open_count,
                action_counts.completed_count
            FROM core.records record
            JOIN forms.form_submissions submission ON submission.id = (
                SELECT TOP (1) candidate.id
                FROM forms.form_submissions candidate
                WHERE candidate.record_id = record.id
                  AND candidate.archived_at IS NULL
                ORDER BY candidate.created_at DESC
            )
            LEFT JOIN people.staff owner ON owner.id = record.owner_staff_id
            LEFT JOIN org.org_units org_unit ON org_unit.id = record.org_unit_id
            LEFT JOIN org.org_units parent_org ON parent_org.id = org_unit.parent_org_unit_id
            OUTER APPLY (
                SELECT
                    SUM(CASE WHEN action.completed_date IS NULL THEN 1 ELSE 0 END) AS open_count,
                    SUM(CASE WHEN action.completed_date IS NOT NULL THEN 1 ELSE 0 END) AS completed_count
                FROM quality.actions action
                WHERE action.source_record_id = record.id
            ) action_counts
            WHERE record.record_type = 'work_scrutiny'
            ORDER BY CASE WHEN record.archived_at IS NULL THEN 0 ELSE 1 END,
                     record.record_date DESC,
                     record.created_at DESC;
            """,
            reader => new AdminWorkScrutinyRecordSummary(
                reader.GetGuid(0),
                reader.GetString(1),
                GetStringOrNull(reader, 2),
                GetGuidOrNull(reader, 3),
                GetStringOrNull(reader, 4),
                GetStringOrNull(reader, 5),
                GetStringOrNull(reader, 6),
                GetDateOnlyOrNull(reader, 7),
                reader.GetFieldValue<DateTimeOffset>(8),
                GetStringOrNull(reader, 9),
                reader.GetGuid(10),
                reader.GetString(11),
                GetDateTimeOffsetOrNull(reader, 12),
                reader.IsDBNull(13) ? 0 : reader.GetInt32(13),
                reader.IsDBNull(14) ? 0 : reader.GetInt32(14)),
            cancellationToken);

    public Task<IReadOnlyList<RecordAuditSummary>> GetRecordAuditHistoryAsync(
        Guid recordId,
        CancellationToken cancellationToken) =>
        QueryAsync(
            """
            SELECT audit.id, audit.action, audit.summary,
                   COALESCE(actor.display_name, 'System') AS actor_name,
                   audit.before_json, audit.after_json, audit.created_at
            FROM ops.audit_logs audit
            LEFT JOIN auth.user_accounts account ON account.id = audit.user_account_id
            LEFT JOIN people.staff actor ON actor.id = account.staff_id
            WHERE audit.record_id = @recordId
            ORDER BY audit.created_at DESC;
            """,
            command => command.Parameters.AddWithValue("@recordId", recordId),
            reader => new RecordAuditSummary(
                reader.GetGuid(0),
                reader.GetString(1),
                GetStringOrNull(reader, 2),
                reader.GetString(3),
                GetStringOrNull(reader, 4),
                GetStringOrNull(reader, 5),
                reader.GetFieldValue<DateTimeOffset>(6)),
            cancellationToken);

    public Task<IReadOnlyList<AdminWorkScrutinyActionSummary>> GetAdminWorkScrutinyActionsAsync(
        Guid recordId,
        CancellationToken cancellationToken) =>
        QueryAsync(
            """
            SELECT action.id, action.title, owner.display_name, action.due_date,
                   action.completed_date, status_value.value_key, action.archived_at
            FROM quality.actions action
            LEFT JOIN people.staff owner ON owner.id = action.owner_staff_id
            LEFT JOIN core.lookup_values status_value ON status_value.id = action.status_lookup_value_id
            WHERE action.source_record_id = @recordId
            ORDER BY CASE WHEN action.completed_date IS NULL THEN 0 ELSE 1 END,
                     action.due_date,
                     action.created_at;
            """,
            command => command.Parameters.AddWithValue("@recordId", recordId),
            reader => new AdminWorkScrutinyActionSummary(
                reader.GetGuid(0),
                reader.GetString(1),
                GetStringOrNull(reader, 2),
                GetDateOnlyOrNull(reader, 3),
                GetDateOnlyOrNull(reader, 4),
                GetStringOrNull(reader, 5),
                GetDateTimeOffsetOrNull(reader, 6)),
            cancellationToken);

    public async Task<bool> SetWorkScrutinyArchivedStateAsync(
        Guid recordId,
        bool isArchived,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        try
        {
            string? title = null;
            DateTimeOffset? currentArchivedAt = null;
            await using (var readCommand = new SqlCommand(
                """
                SELECT title, archived_at
                FROM core.records WITH (UPDLOCK, HOLDLOCK)
                WHERE id = @recordId
                  AND record_type = 'work_scrutiny';
                """,
                connection,
                (SqlTransaction)transaction))
            {
                readCommand.Parameters.AddWithValue("@recordId", recordId);
                await using var reader = await readCommand.ExecuteReaderAsync(cancellationToken);
                if (!await reader.ReadAsync(cancellationToken))
                {
                    await transaction.RollbackAsync(cancellationToken);
                    return false;
                }

                title = reader.GetString(0);
                currentArchivedAt = GetDateTimeOffsetOrNull(reader, 1);
            }

            if (isArchived == currentArchivedAt.HasValue)
            {
                await transaction.CommitAsync(cancellationToken);
                return true;
            }

            await using (var updateCommand = new SqlCommand(
                isArchived
                    ? """
                      UPDATE quality.actions
                      SET archived_at = COALESCE(archived_at, sysutcdatetime()),
                          updated_at = sysutcdatetime()
                      WHERE source_record_id = @recordId;

                      UPDATE core.records
                      SET archived_at = sysutcdatetime(),
                          updated_by_user_account_id = @userAccountId,
                          updated_at = sysutcdatetime()
                      WHERE id = @recordId;
                      """
                    : """
                      UPDATE quality.actions
                      SET archived_at = NULL,
                          updated_at = sysutcdatetime()
                      WHERE source_record_id = @recordId;

                      UPDATE core.records
                      SET archived_at = NULL,
                          updated_by_user_account_id = @userAccountId,
                          updated_at = sysutcdatetime()
                      WHERE id = @recordId;
                      """,
                connection,
                (SqlTransaction)transaction))
            {
                updateCommand.Parameters.AddWithValue("@recordId", recordId);
                updateCommand.Parameters.AddWithValue("@userAccountId", ToDbValue(currentUser.UserAccountId));
                await updateCommand.ExecuteNonQueryAsync(cancellationToken);
            }

            await WriteAuditAsync(
                connection,
                transaction,
                currentUser.UserAccountId,
                recordId,
                "work_scrutiny_record",
                recordId,
                isArchived ? "work_scrutiny.deleted" : "work_scrutiny.restored",
                $"Work Scrutiny '{title}' {(isArchived ? "deleted" : "restored")} by {currentUser.DisplayName}.",
                JsonSerializer.Serialize(new { archived = currentArchivedAt.HasValue }),
                JsonSerializer.Serialize(new { archived = isArchived }),
                cancellationToken);

            await transaction.CommitAsync(cancellationToken);
            return true;
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }
}
