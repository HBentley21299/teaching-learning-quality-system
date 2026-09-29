using System.Data;
using System.Reflection;
using Microsoft.Data.SqlClient;
using TLQS.Api.Data;
using TLQS.Application.Security;
using TLQS.Application.Workflows;
using Xunit;

namespace TLQS.AccessControl.Tests;

// Explicit opt-in: this suite creates and drops a uniquely named, empty test database.
// Never point it at the college database; only the master connection is accepted.
public sealed class AccountAdministrationDatabaseFactAttribute : FactAttribute
{
    public AccountAdministrationDatabaseFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("TLQS_TEST_SQL_MASTER")))
            Skip = "Set TLQS_TEST_SQL_MASTER to an isolated local SQL Server master connection to run database-boundary tests.";
    }
}

public class AccountAdministrationDatabaseTests
{
    [AccountAdministrationDatabaseFact]
    public async Task DatabaseAuthorityFinalAdminConcurrencyAndRevisionGuards()
    {
        await using var fixture = await GuardDatabase.CreateAsync();
        await using var connection = new SqlConnection(fixture.ConnectionString);
        await connection.OpenAsync();
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync();
        var token = CancellationToken.None;
        var admin = Guid.NewGuid(); var delegated = Guid.NewGuid();
        await fixture.ExecuteAsync(connection, transaction, $"""
            INSERT people.staff(id,account_status) VALUES ('{admin}','active'),('{delegated}','active');
            INSERT auth.user_accounts(id,staff_id,account_status) VALUES ('{admin}','{admin}','active'),('{delegated}','{delegated}','active');
            INSERT auth.roles(id,role_key,is_system,is_active) VALUES ('{admin}','super_admin',1,1),('{delegated}','custom_accounts',0,1);
            INSERT auth.user_roles(user_account_id,role_id) VALUES ('{admin}','{admin}'),('{delegated}','{delegated}');
            """);

        Assert.True(await Invoke<bool>("IsActiveAdministratorAsync", connection, transaction, (Guid?)admin, token));
        Assert.False(await Invoke<bool>("IsActiveAdministratorAsync", connection, transaction, (Guid?)delegated, token));
        var forgedAuthority = new CurrentUser(delegated, delegated, "Delegated test account", "test@example.invalid",
            new HashSet<string> { "users.manage", "permissions.manage" }, []) { IsAdministrator = true };
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => Invoke("RequireAdministratorAsync", connection, transaction, forgedAuthority, token));
        await fixture.ExecuteAsync(connection, transaction, $"UPDATE auth.roles SET is_system=0 WHERE id='{admin}';");
        Assert.False(await Invoke<bool>("IsActiveAdministratorAsync", connection, transaction, (Guid?)admin, token));
        await fixture.ExecuteAsync(connection, transaction, $"UPDATE auth.roles SET is_system=1 WHERE id='{admin}';");
        await fixture.ExecuteAsync(connection, transaction, $"UPDATE auth.roles SET is_active=0 WHERE id='{admin}';");
        Assert.False(await Invoke<bool>("IsActiveAdministratorAsync", connection, transaction, (Guid?)admin, token));
        await fixture.ExecuteAsync(connection, transaction, $"UPDATE auth.roles SET is_active=1,archived_at=sysutcdatetime() WHERE id='{admin}';");
        Assert.False(await Invoke<bool>("IsActiveAdministratorAsync", connection, transaction, (Guid?)admin, token));
        await fixture.ExecuteAsync(connection, transaction, $"UPDATE auth.roles SET archived_at=NULL WHERE id='{admin}';");

        await Invoke("LockAccountAdministrationAsync", connection, transaction, token);
        await using (var competing = new SqlConnection(fixture.ConnectionString))
        {
            await competing.OpenAsync();
            await using var competingTransaction = (SqlTransaction)await competing.BeginTransactionAsync();
            await using var request = new SqlCommand("DECLARE @result int; EXEC @result=sys.sp_getapplock @Resource=N'TLQS:account-access-administration',@LockMode=N'Exclusive',@LockOwner=N'Transaction',@LockTimeout=0; SELECT @result;", competing, competingTransaction);
            Assert.True(Convert.ToInt32(await request.ExecuteScalarAsync()) < 0);
            await competingTransaction.RollbackAsync();
        }

        await Invoke("EnsureAdministratorRemainsAsync", connection, transaction, true, token);
        foreach (var mutation in new[] { "is_disabled=1", "account_status='inactive'", "archived_at=sysutcdatetime()" })
        {
            await fixture.ExecuteAsync(connection, transaction, $"UPDATE auth.user_accounts SET {mutation} WHERE id='{admin}';");
            await Assert.ThrowsAsync<WorkflowValidationException>(() => Invoke("EnsureAdministratorRemainsAsync", connection, transaction, true, token));
            await fixture.ExecuteAsync(connection, transaction, $"UPDATE auth.user_accounts SET is_disabled=0,account_status='active',archived_at=NULL WHERE id='{admin}';");
        }
        await fixture.ExecuteAsync(connection, transaction, $"UPDATE auth.user_roles SET active_to=sysutcdatetime() WHERE user_account_id='{admin}';");
        await Assert.ThrowsAsync<WorkflowValidationException>(() => Invoke("EnsureAdministratorRemainsAsync", connection, transaction, true, token));
        await fixture.ExecuteAsync(connection, transaction, $"UPDATE auth.user_roles SET active_to=NULL WHERE user_account_id='{admin}';");

        byte[] accountVersion, staffVersion;
        await using (var read = new SqlCommand($"SELECT CONVERT(binary(8),account.admin_version),staff.row_version FROM auth.user_accounts account JOIN people.staff staff ON staff.id=account.staff_id WHERE account.id='{delegated}';", connection, transaction))
        await using (var reader = await read.ExecuteReaderAsync())
        {
            Assert.True(await reader.ReadAsync()); accountVersion = reader.GetFieldValue<byte[]>(0); staffVersion = reader.GetFieldValue<byte[]>(1);
        }
        await Invoke("CheckAccountRevisionAsync", connection, transaction, delegated, accountVersion, staffVersion, token);
        await fixture.ExecuteAsync(connection, transaction, $"UPDATE auth.user_accounts SET admin_version=admin_version+1 WHERE id='{delegated}';");
        await Assert.ThrowsAsync<DBConcurrencyException>(() => Invoke("CheckAccountRevisionAsync", connection, transaction, delegated, accountVersion, staffVersion, token));
        await transaction.RollbackAsync();
    }

    private static MethodInfo Method(string name, int count) => typeof(SqlFoundationDataStore).GetMethods(BindingFlags.NonPublic | BindingFlags.Static)
        .Single(method => method.Name == name && method.GetParameters().Length == count);
    private static Task Invoke(string name, params object?[] arguments) => (Task)Method(name, arguments.Length).Invoke(null, arguments)!;
    private static Task<T> Invoke<T>(string name, params object?[] arguments) => (Task<T>)Method(name, arguments.Length).Invoke(null, arguments)!;

    private sealed class GuardDatabase : IAsyncDisposable
    {
        private readonly string master;
        private readonly string name = "TLQS_AccessGuardTest_" + Guid.NewGuid().ToString("N");
        public string ConnectionString { get; private set; } = "";
        private GuardDatabase(string master) { this.master = master; }
        public static async Task<GuardDatabase> CreateAsync()
        {
            var builder = new SqlConnectionStringBuilder(Environment.GetEnvironmentVariable("TLQS_TEST_SQL_MASTER"));
            if (!string.Equals(builder.InitialCatalog, "master", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("The test connection must explicitly use Database=master.");
            if (!(builder.DataSource.StartsWith("(localdb)", StringComparison.OrdinalIgnoreCase) || builder.DataSource is "." or "localhost"))
                throw new InvalidOperationException("Database guard tests only run against an isolated local SQL Server.");
            var result = new GuardDatabase(builder.ConnectionString);
            await using var connection = new SqlConnection(result.master); await connection.OpenAsync();
            await using (var create = new SqlCommand($"CREATE DATABASE [{result.name}];", connection) { CommandTimeout = 120 }) await create.ExecuteNonQueryAsync();
            builder.InitialCatalog = result.name; result.ConnectionString = builder.ConnectionString;
            try
            {
                await using var target = new SqlConnection(result.ConnectionString); await target.OpenAsync();
                await result.ExecuteAsync(target, null, "CREATE SCHEMA auth;");
                await result.ExecuteAsync(target, null, "CREATE SCHEMA people;");
                await result.ExecuteAsync(target, null, """
                    CREATE TABLE people.staff(id uniqueidentifier PRIMARY KEY,account_status nvarchar(30),archived_at datetimeoffset NULL,row_version rowversion);
                    CREATE TABLE auth.user_accounts(id uniqueidentifier PRIMARY KEY,staff_id uniqueidentifier,account_status nvarchar(30),is_disabled bit DEFAULT 0,archived_at datetimeoffset NULL,admin_version bigint DEFAULT 0);
                    CREATE TABLE auth.roles(id uniqueidentifier PRIMARY KEY,role_key nvarchar(100),is_system bit,is_active bit,archived_at datetimeoffset NULL);
                    CREATE TABLE auth.user_roles(user_account_id uniqueidentifier,role_id uniqueidentifier,active_from datetimeoffset DEFAULT sysutcdatetime(),active_to datetimeoffset NULL);
                    """);
                return result;
            }
            catch { await result.DisposeAsync(); throw; }
        }
        public async Task ExecuteAsync(SqlConnection connection, SqlTransaction? transaction, string sql)
        { await using var command = new SqlCommand(sql, connection, transaction); await command.ExecuteNonQueryAsync(); }
        public async ValueTask DisposeAsync()
        {
            SqlConnection.ClearAllPools();
            await using var connection = new SqlConnection(master); await connection.OpenAsync();
            await using var drop = new SqlCommand($"ALTER DATABASE [{name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{name}];", connection);
            await drop.ExecuteNonQueryAsync();
        }
    }
}
