using System.Text.Json;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Security;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    private const string ActionAuthorityCteSql = """
        action_leadership_units AS (
            SELECT unit.id,0 AS depth,CONVERT(varchar(max),CONCAT('|',CONVERT(varchar(36),unit.id),'|')) AS visited
            FROM org.org_unit_leaderships leader JOIN org.org_units unit ON unit.id=leader.org_unit_id
            JOIN people.staff manager ON manager.id=leader.leader_staff_id
            WHERE leader.leader_staff_id=@actionAuthorityStaffId AND leader.leadership_role=N'manager'
              AND leader.archived_at IS NULL AND leader.active_from<=CONVERT(date,sysutcdatetime())
              AND (leader.active_to IS NULL OR leader.active_to>=CONVERT(date,sysutcdatetime()))
              AND manager.account_status=N'active' AND manager.archived_at IS NULL
              AND unit.is_active=1 AND unit.archived_at IS NULL
            UNION ALL
            SELECT child.id,parent.depth+1,CONVERT(varchar(max),CONCAT(parent.visited,CONVERT(varchar(36),child.id),'|'))
            FROM org.org_units child JOIN action_leadership_units parent ON child.parent_org_unit_id=parent.id
            WHERE child.is_active=1 AND child.archived_at IS NULL AND parent.depth<64
              AND CHARINDEX(CONCAT('|',CONVERT(varchar(36),child.id),'|'),parent.visited)=0
        ),
        action_management_staff AS (
            SELECT staff_id FROM org.fn_visible_staff(@actionAuthorityAccountId) WHERE is_managed=1 AND manager_depth>0
            UNION
            SELECT staff.id FROM people.staff staff
            WHERE staff.archived_at IS NULL AND staff.account_status=N'active' AND staff.id<>@actionAuthorityStaffId
              AND (EXISTS(SELECT 1 FROM action_leadership_units unit WHERE unit.id=staff.primary_org_unit_id)
                OR EXISTS(SELECT 1 FROM org.staff_org_memberships membership
                    JOIN action_leadership_units unit ON unit.id=membership.org_unit_id
                    WHERE membership.staff_id=staff.id AND membership.archived_at IS NULL
                      AND membership.active_from<=CONVERT(date,sysutcdatetime())
                      AND (membership.active_to IS NULL OR membership.active_to>=CONVERT(date,sysutcdatetime()))))
        )
        """;
    // Management follows the action's creator, never its assignees, subject or report visibility.
    private const string ActionCreatorAuthoritySql = """
        (@actionOversight = 1 OR a.created_by_user_account_id = @actionAuthorityAccountId
         OR EXISTS (SELECT 1 FROM auth.user_accounts action_creator
             JOIN action_management_staff creator_scope ON creator_scope.staff_id = action_creator.staff_id
             WHERE action_creator.id = a.created_by_user_account_id))
        """;

    private static void AddActionAuthorityParameters(SqlCommand command, CurrentUser user)
    {
        command.Parameters.AddWithValue("@actionAuthorityAccountId", ToDbValue(user.UserAccountId));
        command.Parameters.AddWithValue("@actionAuthorityStaffId", ToDbValue(user.StaffId));
        command.Parameters.AddWithValue("@actionOversight", user.UserAccountId.HasValue && (user.IsAdministrator || user.IsTeachingLearning));
    }

    private static async Task<bool> CanManageActionCreatorAsync(SqlConnection connection, SqlTransaction? transaction,
        Guid? creatorAccountId, Guid? creatorStaffId, CurrentUser user, CancellationToken ct)
    {
        if (!user.UserAccountId.HasValue) return false;
        if (user.IsAdministrator || user.IsTeachingLearning || creatorAccountId == user.UserAccountId) return true;
        if (!creatorStaffId.HasValue && creatorAccountId.HasValue)
        {
            await using var account = new SqlCommand("SELECT staff_id FROM auth.user_accounts WHERE id=@creator;", connection, transaction);
            account.Parameters.AddWithValue("@creator", creatorAccountId.Value);
            creatorStaffId = await account.ExecuteScalarAsync(ct) is Guid staffId ? staffId : null;
        }
        if (!creatorStaffId.HasValue) return false;
        if (creatorStaffId == user.StaffId) return true;
        await using var command = new SqlCommand($"""
            WITH {ActionAuthorityCteSql}
            SELECT COUNT(*) FROM action_management_staff visible WHERE visible.staff_id=@creator;
            """, connection, transaction);
        AddActionAuthorityParameters(command,user);
        command.Parameters.AddWithValue("@creator", creatorStaffId.Value);
        return Convert.ToInt32(await command.ExecuteScalarAsync(ct)) > 0;
    }

    private static async Task<bool> CanManageActionAsync(SqlConnection connection, SqlTransaction? transaction,
        Guid actionId, CurrentUser user, CancellationToken ct)
    {
        Guid? creator;
        await using (var command = new SqlCommand("SELECT created_by_user_account_id FROM quality.actions WITH(HOLDLOCK) WHERE id=@id;", connection, transaction))
        {
            command.Parameters.AddWithValue("@id", actionId);
            await using var reader = await command.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct)) return false;
            creator = GetGuidOrNull(reader, 0);
        }
        return await CanManageActionCreatorAsync(connection, transaction, creator, null, user, ct);
    }

    private static async Task EnsureCanManageActionAsync(SqlConnection connection, SqlTransaction? transaction,
        Guid actionId, CurrentUser user, CancellationToken ct)
    {
        if (!await CanManageActionAsync(connection, transaction, actionId, user, ct))
            throw new UnauthorizedAccessException("Only the action creator, their management hierarchy, Administrator or Teaching & Learning can change this action.");
    }

    private async Task<IReadOnlyList<ActionSummary>> EnrichActionAuthorityAsync(IReadOnlyList<ActionSummary> actions, CurrentUser user, CancellationToken ct)
    {
        if (actions.Count == 0 || !user.UserAccountId.HasValue) return actions;
        var editable = await QueryAsync($"""
            WITH {ActionAuthorityCteSql}
            SELECT a.id FROM quality.actions a
            JOIN OPENJSON(@ids) selected ON a.id=TRY_CONVERT(uniqueidentifier,selected.value)
            WHERE {ActionCreatorAuthoritySql};
            """, command =>
            {
                command.Parameters.AddWithValue("@ids", JsonSerializer.Serialize(actions.Select(action => action.Id)));
                AddActionAuthorityParameters(command, user);
            }, reader => reader.GetGuid(0), ct);
        var ids = editable.ToHashSet();
        return actions.Select(action => action with { CanManageAction = ids.Contains(action.Id) }).ToArray();
    }

    private static async Task<bool> IsActiveTeachingLearningAsync(SqlConnection connection, Guid accountId, CancellationToken ct)
    {
        await using var command = new SqlCommand("""
            SELECT COUNT(*) FROM auth.user_roles assignment
            JOIN auth.roles role ON role.id=assignment.role_id
            WHERE assignment.user_account_id=@id AND role.role_key=N'teaching_learning_team'
              AND role.is_active=1 AND role.archived_at IS NULL
              AND assignment.active_from<=sysutcdatetime()
              AND (assignment.active_to IS NULL OR assignment.active_to>sysutcdatetime());
            """, connection);
        command.Parameters.AddWithValue("@id", accountId);
        return Convert.ToInt32(await command.ExecuteScalarAsync(ct)) > 0;
    }
}
