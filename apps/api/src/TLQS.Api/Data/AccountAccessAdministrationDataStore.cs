using System.Data;
using Microsoft.Data.SqlClient;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    public async Task<bool> IsActiveAdministratorAsync(CurrentUser user, CancellationToken token)
    {
        await using var connection = await OpenConnectionAsync(token);
        return await IsActiveAdministratorAsync(connection, null, user.UserAccountId, token);
    }

    private const string ActiveAdministratorSql = """
        SELECT COUNT(DISTINCT account.id)
        FROM auth.user_accounts account
        JOIN people.staff staff ON staff.id = account.staff_id
        JOIN auth.user_roles assignment ON assignment.user_account_id = account.id
        JOIN auth.roles role ON role.id = assignment.role_id
        WHERE account.is_disabled = 0 AND account.account_status = N'active' AND account.archived_at IS NULL
          AND staff.account_status = N'active' AND staff.archived_at IS NULL
          AND role.role_key = N'super_admin' AND role.is_system = 1 AND role.is_active = 1 AND role.archived_at IS NULL
          AND assignment.active_from <= sysutcdatetime()
          AND (assignment.active_to IS NULL OR assignment.active_to > sysutcdatetime())
        """;

    private static async Task<bool> IsActiveAdministratorAsync(SqlConnection connection, SqlTransaction? transaction, Guid? accountId, CancellationToken token)
    {
        if (!accountId.HasValue) return false;
        await using var command = new SqlCommand(ActiveAdministratorSql + " AND account.id = @id;", connection, transaction);
        command.Parameters.AddWithValue("@id", accountId.Value);
        return Convert.ToInt32(await command.ExecuteScalarAsync(token)) > 0;
    }

    // Every account/role mutation takes the same transaction-owned lock before reading
    // authority or administrator counts. Concurrent edits cannot both remove the last admin.
    private static async Task LockAccountAdministrationAsync(SqlConnection connection, SqlTransaction transaction, CancellationToken token)
    {
        await using var command = new SqlCommand("""
            DECLARE @result int;
            EXEC @result = sys.sp_getapplock @Resource = N'TLQS:account-access-administration',
                @LockMode = N'Exclusive', @LockOwner = N'Transaction', @LockTimeout = 15000;
            SELECT @result;
            """, connection, transaction);
        if (Convert.ToInt32(await command.ExecuteScalarAsync(token)) < 0)
            throw new DBConcurrencyException("Account administration is busy. Refresh and try again.");
    }

    private static async Task RequireAdministratorAsync(SqlConnection connection, SqlTransaction transaction, CurrentUser user, CancellationToken token)
    {
        if (!await IsActiveAdministratorAsync(connection, transaction, user.UserAccountId, token))
            throw new UnauthorizedAccessException("Only an active Administrator can allocate roles, edit permission tiers or change access scope.");
    }

    private static async Task EnsureAdministratorRemainsAsync(SqlConnection connection, SqlTransaction transaction, bool targetWasAdministrator, CancellationToken token)
    {
        if (!targetWasAdministrator) return;
        await using var command = new SqlCommand(ActiveAdministratorSql + ";", connection, transaction);
        if (Convert.ToInt32(await command.ExecuteScalarAsync(token)) == 0)
            throw new WorkflowValidationException("Keep at least one active Administrator account. This change would remove the final administrator's access.");
    }

    private static async Task CheckAccountRevisionAsync(SqlConnection connection, SqlTransaction transaction, Guid accountId,
        byte[]? rowVersion, byte[]? staffRowVersion, CancellationToken token)
    {
        if (rowVersion is not { Length: 8 } || staffRowVersion is not { Length: 8 })
            throw new DBConcurrencyException("Reload this staff account before saving. Its current access version is required.");
        await using var command = new SqlCommand("""
            SELECT COUNT(*) FROM auth.user_accounts account WITH (UPDLOCK, HOLDLOCK)
            JOIN people.staff staff WITH (UPDLOCK, HOLDLOCK) ON staff.id = account.staff_id
            WHERE account.id = @id AND CONVERT(binary(8), account.admin_version) = @version AND staff.row_version = @staffVersion;
            """, connection, transaction);
        command.Parameters.AddWithValue("@id", accountId);
        command.Parameters.Add("@version", SqlDbType.Binary, 8).Value = rowVersion;
        command.Parameters.Add("@staffVersion", SqlDbType.Binary, 8).Value = staffRowVersion;
        if (Convert.ToInt32(await command.ExecuteScalarAsync(token)) != 1)
            throw new DBConcurrencyException("This staff account or its access changed since you opened it. Refresh and review the latest details before saving.");
    }
}
