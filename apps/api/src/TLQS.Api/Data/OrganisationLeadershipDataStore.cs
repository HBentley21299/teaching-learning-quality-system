using System.Text.Json;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Organisation;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    public async Task<AdminOrganisationStructureSummary> GetAdminOrganisationStructureAsync(
        CancellationToken cancellationToken)
    {
        var units = await QueryAsync(
            """
            SELECT id, parent_org_unit_id, org_unit_type, code, name
            FROM org.org_units
            WHERE org_unit_type IN (N'faculty', N'team')
              AND is_active = 1
              AND archived_at IS NULL
            ORDER BY CASE org_unit_type WHEN N'faculty' THEN 0 ELSE 1 END, code, name;
            """,
            reader => new ManagedOrgUnitRow(
                reader.GetGuid(0),
                GetGuidOrNull(reader, 1),
                reader.GetString(2),
                reader.GetString(3),
                reader.GetString(4)),
            cancellationToken);

        var staff = await QueryAsync(
            """
            SELECT staff.id, staff.external_id, staff.display_name, staff.email, staff.staff_category,
                   COALESCE(effective_role.name, N'Tutor'), primary_unit.code
            FROM people.staff staff
            JOIN auth.user_accounts account ON account.staff_id = staff.id
                AND account.account_status = N'active'
                AND account.is_disabled = 0
                AND account.archived_at IS NULL
            LEFT JOIN org.org_units primary_unit ON primary_unit.id = staff.primary_org_unit_id
            OUTER APPLY (
                SELECT TOP (1) role.name
                FROM auth.user_roles user_role
                JOIN auth.roles role ON role.id = user_role.role_id
                    AND role.is_active = 1
                    AND role.archived_at IS NULL
                WHERE user_role.user_account_id = account.id
                  AND user_role.active_from <= sysutcdatetime()
                  AND (user_role.active_to IS NULL OR user_role.active_to > sysutcdatetime())
                ORDER BY role.precedence DESC, role.name
            ) effective_role
            WHERE staff.account_status = N'active'
              AND staff.archived_at IS NULL
            ORDER BY staff.display_name;
            """,
            reader => new ManagedStaffRow(
                reader.GetGuid(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.GetString(3),
                GetStringOrNull(reader, 4),
                reader.GetString(5),
                GetStringOrNull(reader, 6)),
            cancellationToken);

        var leaderships = await QueryAsync(
            """
            SELECT leadership.id, leadership.org_unit_id, leadership.leader_staff_id,
                   leadership.active_from
            FROM org.org_unit_leaderships leadership
            WHERE leadership.leadership_role = N'manager'
              AND leadership.archived_at IS NULL
              AND leadership.active_from <= CONVERT(date, sysutcdatetime())
              AND (leadership.active_to IS NULL OR leadership.active_to >= CONVERT(date, sysutcdatetime()));
            """,
            reader => new ManagedLeadershipRow(
                reader.GetGuid(0),
                reader.GetGuid(1),
                reader.GetGuid(2),
                DateOnly.FromDateTime(reader.GetDateTime(3))),
            cancellationToken);

        var memberships = await QueryAsync(
            """
            SELECT membership.staff_id, membership.org_unit_id, unit.parent_org_unit_id
            FROM org.staff_org_memberships membership
            JOIN org.org_units unit ON unit.id = membership.org_unit_id
                AND unit.is_active = 1
                AND unit.archived_at IS NULL
            JOIN people.staff staff ON staff.id = membership.staff_id
                AND staff.account_status = N'active'
                AND staff.archived_at IS NULL
            WHERE membership.archived_at IS NULL
              AND (membership.active_from IS NULL OR membership.active_from <= CONVERT(date, sysutcdatetime()))
              AND (membership.active_to IS NULL OR membership.active_to >= CONVERT(date, sysutcdatetime()));
            """,
            reader => new ManagedMembershipRow(reader.GetGuid(0), reader.GetGuid(1), GetGuidOrNull(reader, 2)),
            cancellationToken);

        var staffById = staff.ToDictionary(person => person.StaffId);
        var leadershipByUnit = leaderships.ToDictionary(leadership => leadership.OrgUnitId);
        var teamsByFaculty = units
            .Where(unit => unit.OrgUnitType == OrganisationLeadershipRules.TeamType && unit.ParentOrgUnitId.HasValue)
            .GroupBy(unit => unit.ParentOrgUnitId!.Value)
            .ToDictionary(group => group.Key, group => group.ToArray());

        AdminOrganisationManagerSummary? ManagerFor(Guid? orgUnitId)
        {
            if (!orgUnitId.HasValue
                || !leadershipByUnit.TryGetValue(orgUnitId.Value, out var leadership)
                || !staffById.TryGetValue(leadership.LeaderStaffId, out var leader))
            {
                return null;
            }

            return new AdminOrganisationManagerSummary(
                leadership.Id,
                leader.StaffId,
                leader.ExternalId,
                leader.DisplayName,
                leader.Email,
                leader.EffectivePermissionLevel,
                leadership.ActiveFrom);
        }

        var unitSummaries = units.Select(unit =>
        {
            var directStaffCount = memberships
                .Where(membership => membership.OrgUnitId == unit.Id)
                .Select(membership => membership.StaffId)
                .Distinct()
                .Count();
            var totalStaffCount = unit.OrgUnitType == OrganisationLeadershipRules.FacultyType
                ? memberships
                    .Where(membership => membership.OrgUnitId == unit.Id || membership.ParentOrgUnitId == unit.Id)
                    .Select(membership => membership.StaffId)
                    .Distinct()
                    .Count()
                : directStaffCount;
            var childTeams = teamsByFaculty.GetValueOrDefault(unit.Id, []);

            return new AdminOrganisationUnitSummary(
                unit.Id,
                unit.ParentOrgUnitId,
                unit.OrgUnitType,
                unit.Code,
                unit.Name,
                directStaffCount,
                totalStaffCount,
                childTeams.Length,
                childTeams.Count(team => leadershipByUnit.ContainsKey(team.Id)),
                ManagerFor(unit.Id),
                unit.OrgUnitType == OrganisationLeadershipRules.TeamType ? ManagerFor(unit.ParentOrgUnitId) : null);
        }).ToArray();

        return new AdminOrganisationStructureSummary(
            unitSummaries,
            staff.Select(person => new AdminOrganisationStaffOption(
                person.StaffId,
                person.ExternalId,
                person.DisplayName,
                person.Email,
                person.StaffCategory,
                person.EffectivePermissionLevel,
                person.PrimaryOrgCode)).ToArray());
    }

    public async Task<Guid> SaveOrgUnitManagerAsync(
        Guid orgUnitId,
        SaveOrgUnitManagerRequest request,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            var unit = await GetManagedUnitAsync(connection, transaction, orgUnitId, cancellationToken)
                ?? throw new WorkflowValidationException("Select an active faculty or team.");
            if (!OrganisationLeadershipRules.IsManagedUnitType(unit.OrgUnitType))
            {
                throw new WorkflowValidationException("Only faculties and teams can have a manager.");
            }

            var managerExists = await ScalarExistsAsync(
                connection,
                transaction,
                """
                SELECT 1
                FROM people.staff staff
                JOIN auth.user_accounts account ON account.staff_id = staff.id
                WHERE staff.id = @managerStaffId
                  AND staff.account_status = N'active'
                  AND staff.archived_at IS NULL
                  AND account.account_status = N'active'
                  AND account.is_disabled = 0
                  AND account.archived_at IS NULL;
                """,
                command => command.Parameters.AddWithValue("@managerStaffId", request.ManagerStaffId),
                cancellationToken);
            if (!managerExists)
            {
                throw new WorkflowValidationException("Select an active staff account as the manager.");
            }

            var current = await GetActiveUnitLeadershipAsync(connection, transaction, orgUnitId, cancellationToken);
            if (current?.LeaderStaffId == request.ManagerStaffId)
            {
                await RebuildUnitManagementProjectionAsync(connection, transaction, currentUser.UserAccountId, cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return current.Id;
            }

            var reason = current is null ? request.Reason?.Trim() : RequireReason(request.Reason);
            if (current is not null)
            {
                await ExecuteAsync(
                    connection,
                    transaction,
                    """
                    UPDATE org.org_unit_leaderships
                    SET active_to = CONVERT(date, sysutcdatetime()),
                        archived_at = sysutcdatetime(),
                        updated_by_user_account_id = @updatedBy,
                        updated_at = sysutcdatetime()
                    WHERE id = @id AND archived_at IS NULL;
                    """,
                    command =>
                    {
                        command.Parameters.AddWithValue("@id", current.Id);
                        command.Parameters.AddWithValue("@updatedBy", ToDbValue(currentUser.UserAccountId));
                    },
                    cancellationToken);
            }

            var assignmentId = Guid.NewGuid();
            await ExecuteAsync(
                connection,
                transaction,
                """
                INSERT INTO org.org_unit_leaderships (
                    id, org_unit_id, leader_staff_id, leadership_role,
                    active_from, created_by_user_account_id
                )
                VALUES (
                    @id, @orgUnitId, @leaderStaffId, N'manager',
                    CONVERT(date, sysutcdatetime()), @createdBy
                );
                """,
                command =>
                {
                    command.Parameters.AddWithValue("@id", assignmentId);
                    command.Parameters.AddWithValue("@orgUnitId", orgUnitId);
                    command.Parameters.AddWithValue("@leaderStaffId", request.ManagerStaffId);
                    command.Parameters.AddWithValue("@createdBy", ToDbValue(currentUser.UserAccountId));
                },
                cancellationToken);

            await RebuildUnitManagementProjectionAsync(connection, transaction, currentUser.UserAccountId, cancellationToken);
            await WriteAuditWithReasonAsync(
                connection,
                transaction,
                currentUser.UserAccountId,
                null,
                "org_unit_leadership",
                assignmentId,
                current is null ? "organisation.unit_manager_assigned" : "organisation.unit_manager_changed",
                $"{OrganisationLeadershipRules.RoleNameFor(unit.OrgUnitType)} for {unit.Code} changed by {currentUser.DisplayName}.",
                current is null ? null : JsonSerializer.Serialize(new { current.Id, current.LeaderStaffId }),
                JsonSerializer.Serialize(new { assignmentId, orgUnitId, request.ManagerStaffId, roleKey = OrganisationLeadershipRules.RoleKeyFor(unit.OrgUnitType) }),
                reason,
                cancellationToken);

            await transaction.CommitAsync(cancellationToken);
            return assignmentId;
        }
        catch (SqlException exception) when (exception.Number == 51000)
        {
            await transaction.RollbackAsync(cancellationToken);
            throw new WorkflowValidationException(exception.Message);
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task<bool> ArchiveOrgUnitManagerAsync(
        Guid orgUnitId,
        string reason,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        reason = RequireReason(reason);
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            var unit = await GetManagedUnitAsync(connection, transaction, orgUnitId, cancellationToken);
            var current = await GetActiveUnitLeadershipAsync(connection, transaction, orgUnitId, cancellationToken);
            if (unit is null || current is null)
            {
                await transaction.RollbackAsync(cancellationToken);
                return false;
            }

            await ExecuteAsync(
                connection,
                transaction,
                """
                UPDATE org.org_unit_leaderships
                SET active_to = CONVERT(date, sysutcdatetime()),
                    archived_at = sysutcdatetime(),
                    updated_by_user_account_id = @updatedBy,
                    updated_at = sysutcdatetime()
                WHERE id = @id AND archived_at IS NULL;
                """,
                command =>
                {
                    command.Parameters.AddWithValue("@id", current.Id);
                    command.Parameters.AddWithValue("@updatedBy", ToDbValue(currentUser.UserAccountId));
                },
                cancellationToken);

            await RebuildUnitManagementProjectionAsync(connection, transaction, currentUser.UserAccountId, cancellationToken);
            await WriteAuditWithReasonAsync(
                connection,
                transaction,
                currentUser.UserAccountId,
                null,
                "org_unit_leadership",
                current.Id,
                "organisation.unit_manager_removed",
                $"{OrganisationLeadershipRules.RoleNameFor(unit.OrgUnitType)} for {unit.Code} removed by {currentUser.DisplayName}.",
                JsonSerializer.Serialize(new { current.Id, current.LeaderStaffId }),
                JsonSerializer.Serialize(new { orgUnitId, removed = true }),
                reason,
                cancellationToken);

            await transaction.CommitAsync(cancellationToken);
            return true;
        }
        catch (SqlException exception) when (exception.Number == 51000)
        {
            await transaction.RollbackAsync(cancellationToken);
            throw new WorkflowValidationException(exception.Message);
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    private static async Task<ManagedOrgUnitRow?> GetManagedUnitAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        Guid orgUnitId,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            """
            SELECT id, parent_org_unit_id, org_unit_type, code, name
            FROM org.org_units
            WHERE id = @id AND is_active = 1 AND archived_at IS NULL;
            """,
            connection,
            (SqlTransaction)transaction);
        command.Parameters.AddWithValue("@id", orgUnitId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken)
            ? new ManagedOrgUnitRow(
                reader.GetGuid(0),
                GetGuidOrNull(reader, 1),
                reader.GetString(2),
                reader.GetString(3),
                reader.GetString(4))
            : null;
    }

    private static async Task<ManagedLeadershipRow?> GetActiveUnitLeadershipAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        Guid orgUnitId,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            """
            SELECT TOP (1) id, org_unit_id, leader_staff_id, active_from
            FROM org.org_unit_leaderships
            WHERE org_unit_id = @orgUnitId
              AND leadership_role = N'manager'
              AND archived_at IS NULL
              AND active_from <= CONVERT(date, sysutcdatetime())
              AND (active_to IS NULL OR active_to >= CONVERT(date, sysutcdatetime()))
            ORDER BY created_at DESC;
            """,
            connection,
            (SqlTransaction)transaction);
        command.Parameters.AddWithValue("@orgUnitId", orgUnitId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken)
            ? new ManagedLeadershipRow(
                reader.GetGuid(0),
                reader.GetGuid(1),
                reader.GetGuid(2),
                DateOnly.FromDateTime(reader.GetDateTime(3)))
            : null;
    }

    private static async Task RebuildUnitManagementProjectionAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        Guid? updatedByUserAccountId,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            "org.usp_rebuild_unit_management_projection",
            connection,
            (SqlTransaction)transaction)
        {
            CommandType = System.Data.CommandType.StoredProcedure
        };
        command.Parameters.AddWithValue("@updated_by_user_account_id", ToDbValue(updatedByUserAccountId));
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private sealed record ManagedOrgUnitRow(
        Guid Id,
        Guid? ParentOrgUnitId,
        string OrgUnitType,
        string Code,
        string Name);

    private sealed record ManagedStaffRow(
        Guid StaffId,
        string ExternalId,
        string DisplayName,
        string Email,
        string? StaffCategory,
        string EffectivePermissionLevel,
        string? PrimaryOrgCode);

    private sealed record ManagedLeadershipRow(
        Guid Id,
        Guid OrgUnitId,
        Guid LeaderStaffId,
        DateOnly ActiveFrom);

    private sealed record ManagedMembershipRow(Guid StaffId, Guid OrgUnitId, Guid? ParentOrgUnitId);
}
