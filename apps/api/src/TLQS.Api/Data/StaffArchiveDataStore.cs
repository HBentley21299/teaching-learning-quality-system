using System.Text.Json;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    public async Task<FormSubmissionUpdateResult> SetAdminUserArchivedAsync(
        Guid userAccountId,
        bool archived,
        CurrentUser currentUser,
        CancellationToken cancellationToken, byte[]? rowVersion = null, byte[]? staffRowVersion = null)
    {
        if (archived && currentUser.UserAccountId == userAccountId)
        {
            throw new WorkflowValidationException("You cannot archive your own account.");
        }

        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(
            System.Data.IsolationLevel.Serializable, cancellationToken);
        try
        {
            await LockAccountAdministrationAsync(connection, transaction, cancellationToken);
            await RequireAdministratorAsync(connection, transaction, currentUser, cancellationToken);
            await CheckAccountRevisionAsync(connection, transaction, userAccountId, rowVersion, staffRowVersion, cancellationToken);
            var targetWasAdministrator = await IsActiveAdministratorAsync(connection, transaction, userAccountId, cancellationToken);
            Guid staffId;
            string displayName;
            bool currentlyArchived;
            bool hasActiveAccess;
            await using (var command = new SqlCommand(
                """
                SELECT ua.staff_id, s.display_name,
                       CONVERT(bit, CASE WHEN ua.archived_at IS NOT NULL OR s.archived_at IS NOT NULL THEN 1 ELSE 0 END),
                       CONVERT(bit, CASE WHEN ua.is_disabled = 0 AND ua.account_status = N'active'
                                         AND s.account_status = N'active' THEN 1 ELSE 0 END)
                FROM auth.user_accounts ua WITH (UPDLOCK, HOLDLOCK)
                JOIN people.staff s WITH (UPDLOCK, HOLDLOCK) ON s.id = ua.staff_id
                WHERE ua.id = @id;
                """, connection, transaction))
            {
                command.Parameters.AddWithValue("@id", userAccountId);
                await using var reader = await command.ExecuteReaderAsync(cancellationToken);
                if (!await reader.ReadAsync(cancellationToken))
                {
                    return FormSubmissionUpdateResult.NotFound;
                }
                staffId = reader.GetGuid(0);
                displayName = reader.GetString(1);
                currentlyArchived = reader.GetBoolean(2);
                hasActiveAccess = reader.GetBoolean(3);
            }

            if (currentlyArchived == archived)
            {
                await transaction.CommitAsync(cancellationToken);
                return FormSubmissionUpdateResult.Saved;
            }

            if (archived)
            {
                await using var command = new SqlCommand(
                    """
                    SELECT COUNT(DISTINCT ua.id)
                    FROM auth.user_accounts ua WITH (UPDLOCK, HOLDLOCK)
                    JOIN people.staff s ON s.id = ua.staff_id
                    JOIN auth.user_roles ur ON ur.user_account_id = ua.id
                    JOIN auth.roles r ON r.id = ur.role_id
                    WHERE r.role_key = N'super_admin'
                      AND ua.id <> @id
                      AND ua.is_disabled = 0
                      AND ua.account_status = N'active'
                      AND ua.archived_at IS NULL
                      AND s.account_status = N'active'
                      AND s.archived_at IS NULL
                      AND ur.active_from <= sysutcdatetime()
                      AND (ur.active_to IS NULL OR ur.active_to > sysutcdatetime());
                    """, connection, transaction);
                command.Parameters.AddWithValue("@id", userAccountId);
                var otherAdmins = Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken));
                var roles = await GetActiveRoleKeysAsync(connection, transaction, userAccountId, cancellationToken);
                if (hasActiveAccess && roles.Contains("super_admin", StringComparer.OrdinalIgnoreCase) && otherAdmins == 0)
                {
                    throw new WorkflowValidationException("The final active Admin account cannot be archived.");
                }
            }

            await using (var command = new SqlCommand(
                """
                UPDATE people.staff
                SET archived_at = CASE WHEN @archived = 1 THEN sysutcdatetime() ELSE NULL END,
                    updated_at = sysutcdatetime()
                WHERE id = @staffId;

                UPDATE auth.user_accounts
                SET admin_version = admin_version + 1, archived_at = CASE WHEN @archived = 1 THEN sysutcdatetime() ELSE NULL END,
                    is_disabled = 1,
                    updated_at = sysutcdatetime()
                WHERE id = @userAccountId;

                IF @archived = 1
                BEGIN
                    UPDATE auth.user_roles
                    SET active_to = CASE WHEN active_from > sysutcdatetime() THEN active_from ELSE sysutcdatetime() END
                    WHERE user_account_id = @userAccountId
                      AND (active_to IS NULL OR active_to > sysutcdatetime());

                    UPDATE auth.access_scopes
                    SET is_active = 0, archived_at = sysutcdatetime(), updated_at = sysutcdatetime()
                    WHERE user_account_id = @userAccountId AND archived_at IS NULL;

                    UPDATE org.org_unit_leaderships
                    SET archived_at = sysutcdatetime(),
                        active_to = CASE WHEN active_to <= CONVERT(date, sysutcdatetime()) THEN active_to
                                         WHEN active_from > CONVERT(date, sysutcdatetime()) THEN active_from
                                         ELSE CONVERT(date, sysutcdatetime()) END,
                        updated_at = sysutcdatetime(), updated_by_user_account_id = @actorId
                    WHERE leader_staff_id = @staffId AND archived_at IS NULL;

                    UPDATE org.staff_org_memberships
                    SET archived_at = sysutcdatetime(),
                        active_to = CASE WHEN active_to <= CONVERT(date, sysutcdatetime()) THEN active_to
                                         WHEN active_from > CONVERT(date, sysutcdatetime()) THEN active_from
                                         ELSE CONVERT(date, sysutcdatetime()) END,
                        updated_at = sysutcdatetime(), updated_by_user_account_id = @actorId
                    WHERE staff_id = @staffId AND archived_at IS NULL;

                    UPDATE org.staff_manager_relationships
                    SET archived_at = sysutcdatetime(),
                        active_to = CASE WHEN active_to <= CONVERT(date, sysutcdatetime()) THEN active_to
                                         WHEN active_from > CONVERT(date, sysutcdatetime()) THEN active_from
                                         ELSE CONVERT(date, sysutcdatetime()) END,
                        updated_at = sysutcdatetime(), updated_by_user_account_id = @actorId
                    WHERE (staff_id = @staffId OR manager_staff_id = @staffId) AND archived_at IS NULL;
                END;
                """, connection, transaction))
            {
                command.Parameters.AddWithValue("@archived", archived);
                command.Parameters.AddWithValue("@staffId", staffId);
                command.Parameters.AddWithValue("@userAccountId", userAccountId);
                command.Parameters.AddWithValue("@actorId", ToDbValue(currentUser.UserAccountId));
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            await EnsureAdministratorRemainsAsync(connection, transaction, targetWasAdministrator, cancellationToken);

            if (archived)
            {
                await RebuildUnitManagementProjectionAsync(connection, transaction, currentUser.UserAccountId, cancellationToken);
            }

            await WriteAuditAsync(connection, transaction, currentUser.UserAccountId, null,
                "user_account", userAccountId, archived ? "user.archived" : "user.restored",
                $"{displayName} {(archived ? "archived" : "restored")} by {currentUser.DisplayName}.",
                JsonSerializer.Serialize(new { archived = currentlyArchived }),
                JsonSerializer.Serialize(new { archived, isDisabled = true }), cancellationToken);

            await transaction.CommitAsync(cancellationToken);
            return FormSubmissionUpdateResult.Saved;
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }
}
