using Microsoft.Data.SqlClient;
using TLQS.Application.Security;

namespace TLQS.Api.Data;

/// <summary>
/// A local test credential. <see cref="UserAccountId"/> is null until the
/// account has completed trusted self-onboarding, which is what lets a test
/// sign-in reach the onboarding screen on first use.
/// </summary>
public sealed record LocalLoginCredential(
    string Email,
    string PasswordHash,
    Guid? UserAccountId,
    string? DisplayName,
    bool IsAccountUsable);

public sealed partial class SqlFoundationDataStore
{
    public async Task<LocalLoginCredential?> GetLocalCredentialAsync(string email, CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var command = new SqlCommand(
            """
            SELECT TOP (1)
                lc.email,
                lc.password_hash,
                account.id,
                staff.display_name,
                CASE WHEN account.id IS NULL THEN 1 ELSE 0 END AS awaiting_onboarding
            FROM auth.local_credentials lc
            LEFT JOIN auth.user_accounts account
                ON account.id = lc.user_account_id
                AND account.is_disabled = 0
                AND account.account_status = 'active'
                AND account.archived_at IS NULL
            LEFT JOIN people.staff staff ON staff.id = account.staff_id
            WHERE lc.email = @email;
            """,
            connection);
        command.Parameters.AddWithValue("@email", email);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        var accountId = reader.IsDBNull(2) ? (Guid?)null : reader.GetGuid(2);
        return new LocalLoginCredential(
            reader.GetString(0),
            reader.GetString(1),
            accountId,
            reader.IsDBNull(3) ? null : reader.GetString(3),
            IsAccountUsable: true);
    }

    public async Task<string?> GetLocalPasswordHashAsync(string email, CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var command = new SqlCommand(
            "SELECT password_hash FROM auth.local_credentials WHERE email = @email;", connection);
        command.Parameters.AddWithValue("@email", email);
        return await command.ExecuteScalarAsync(cancellationToken) as string;
    }

    /// <summary>Links a credential to the account created during onboarding.</summary>
    public async Task LinkLocalCredentialAsync(string email, Guid userAccountId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var command = new SqlCommand(
            """
            UPDATE auth.local_credentials
            SET user_account_id = @accountId, updated_at = sysutcdatetime()
            WHERE email = @email;
            """, connection);
        command.Parameters.AddWithValue("@accountId", userAccountId);
        command.Parameters.AddWithValue("@email", email);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<bool> SetLocalPasswordByEmailAsync(
        string email,
        string passwordHash,
        CurrentUser changedBy,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(cancellationToken);

        int affected;
        await using (var update = new SqlCommand(
            """
            UPDATE auth.local_credentials
            SET password_hash = @hash,
                updated_at = sysutcdatetime(),
                updated_by_user_account_id = @byUser
            WHERE email = @email;
            """, connection, transaction))
        {
            update.Parameters.AddWithValue("@hash", passwordHash);
            update.Parameters.AddWithValue("@byUser", changedBy.UserAccountId ?? (object)DBNull.Value);
            update.Parameters.AddWithValue("@email", email);
            affected = await update.ExecuteNonQueryAsync(cancellationToken);
        }

        if (affected == 0)
        {
            await transaction.RollbackAsync(cancellationToken);
            return false;
        }

        await using (var audit = new SqlCommand(
            """
            INSERT INTO ops.audit_logs (user_account_id, entity_name, entity_id, action, summary)
            VALUES (@byUser, N'local_credentials', NULL, N'local_password_changed', @summary);
            """, connection, transaction))
        {
            audit.Parameters.AddWithValue("@byUser", changedBy.UserAccountId ?? (object)DBNull.Value);
            audit.Parameters.AddWithValue("@summary",
                $"Local test password for {email} updated by {changedBy.DisplayName}.");
            await audit.ExecuteNonQueryAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
        return true;
    }

    /// <summary>Resolves an account id to its staff email, for admin resets.</summary>
    public async Task<string?> GetAccountEmailAsync(Guid userAccountId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var command = new SqlCommand(
            """
            SELECT s.email FROM auth.user_accounts ua
            JOIN people.staff s ON s.id = ua.staff_id
            WHERE ua.id = @id AND ua.archived_at IS NULL;
            """, connection);
        command.Parameters.AddWithValue("@id", userAccountId);
        return await command.ExecuteScalarAsync(cancellationToken) as string;
    }
}
