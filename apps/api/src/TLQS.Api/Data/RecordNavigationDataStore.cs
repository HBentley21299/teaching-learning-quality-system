using TLQS.Api.V1;
using TLQS.Application.Security;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    public async Task<RecordNavigationSummary?> GetRecordNavigationAsync(
        Guid recordId,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        var rows = await QueryAsync(
            """
            WITH visible_staff AS (
                SELECT staff_id FROM org.fn_visible_staff(@currentUserAccountId)
            ),
            visible_org_units AS (
                SELECT org_unit_id FROM org.fn_visible_org_units(@currentUserAccountId)
            )
            SELECT record_row.id, record_row.record_type, record_row.subject_staff_id
            FROM core.records record_row
            WHERE record_row.id = @recordId
              AND record_row.archived_at IS NULL
              AND (
                    @canViewAll = 1
                    OR record_row.created_by_user_account_id = @currentUserAccountId
                    OR record_row.owner_staff_id = @currentStaffId
                    OR record_row.subject_staff_id = @currentStaffId
                    OR EXISTS (
                        SELECT 1 FROM visible_staff
                        WHERE staff_id IN (record_row.subject_staff_id, record_row.owner_staff_id)
                    )
                    OR EXISTS (
                        SELECT 1 FROM visible_org_units
                        WHERE org_unit_id = record_row.org_unit_id
                    )
              );
            """,
            command =>
            {
                AddScopeParameters(command, currentUser);
                command.Parameters.AddWithValue("@recordId", recordId);
            },
            reader => new RecordNavigationSummary(
                reader.GetGuid(0),
                reader.GetString(1),
                GetGuidOrNull(reader, 2)),
            cancellationToken);

        return rows.FirstOrDefault();
    }
}
