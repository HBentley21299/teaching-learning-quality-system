using System.Text.Json;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    public async Task<IReadOnlyList<AdminOrganisationStaffSummary>> GetAdminOrganisationStaffAsync(
        CancellationToken cancellationToken)
    {
        var staff = await QueryAsync(
            """
            SELECT id, external_id, display_name, email, account_status, staff_category
            FROM people.staff
            WHERE archived_at IS NULL
            ORDER BY display_name;
            """,
            reader => new OrganisationStaffRow(
                reader.GetGuid(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.GetString(3),
                reader.GetString(4),
                GetStringOrNull(reader, 5)),
            cancellationToken);

        var memberships = await QueryAsync(
            """
            SELECT membership.id, membership.staff_id, membership.org_unit_id,
                   unit.parent_org_unit_id, unit.org_unit_type, unit.code, unit.name,
                   parent.code, parent.name, membership.membership_type,
                   membership.is_primary, membership.active_from, membership.active_to,
                   membership.archived_at
            FROM org.staff_org_memberships membership
            JOIN org.org_units unit ON unit.id = membership.org_unit_id
            LEFT JOIN org.org_units parent ON parent.id = unit.parent_org_unit_id
            WHERE membership.archived_at IS NULL
              AND unit.archived_at IS NULL
            ORDER BY membership.staff_id, membership.is_primary DESC, unit.org_unit_type, unit.name;
            """,
            reader => new OrganisationMembershipRow(
                reader.GetGuid(0),
                reader.GetGuid(1),
                reader.GetGuid(2),
                GetGuidOrNull(reader, 3),
                reader.GetString(4),
                reader.GetString(5),
                reader.GetString(6),
                GetStringOrNull(reader, 7),
                GetStringOrNull(reader, 8),
                reader.GetString(9),
                reader.GetBoolean(10),
                GetDateOnlyOrNull(reader, 11),
                GetDateOnlyOrNull(reader, 12)),
            cancellationToken);

        var managerRelationships = await QueryAsync(
            """
            SELECT relationship.id, relationship.staff_id, relationship.manager_staff_id,
                   manager.display_name, relationship.relationship_type, relationship.is_primary,
                   relationship.active_from, relationship.active_to, relationship.archived_at
            FROM org.staff_manager_relationships relationship
            JOIN people.staff manager ON manager.id = relationship.manager_staff_id
            WHERE relationship.archived_at IS NULL
              AND manager.archived_at IS NULL
            ORDER BY relationship.staff_id, relationship.is_primary DESC, manager.display_name;
            """,
            reader => new OrganisationManagerRow(
                reader.GetGuid(0),
                reader.GetGuid(1),
                reader.GetGuid(2),
                reader.GetString(3),
                reader.GetString(4),
                reader.GetBoolean(5),
                GetDateOnlyOrNull(reader, 6),
                GetDateOnlyOrNull(reader, 7)),
            cancellationToken);

        var roles = await QueryAsync(
            """
            SELECT account.staff_id, role.name, role.precedence
            FROM auth.user_accounts account
            JOIN auth.user_roles user_role ON user_role.user_account_id = account.id
                AND user_role.active_from <= sysutcdatetime()
                AND (user_role.active_to IS NULL OR user_role.active_to > sysutcdatetime())
            JOIN auth.roles role ON role.id = user_role.role_id
                AND role.is_active = 1
                AND role.archived_at IS NULL
            WHERE account.archived_at IS NULL
            ORDER BY account.staff_id, role.precedence DESC, role.name;
            """,
            reader => new OrganisationRoleRow(reader.GetGuid(0), reader.GetString(1), reader.GetInt32(2)),
            cancellationToken);

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var staffById = staff.ToDictionary(person => person.StaffId);
        var rolesByStaff = roles
            .GroupBy(role => role.StaffId)
            .ToDictionary(group => group.Key, group => group.OrderByDescending(role => role.Precedence).ToArray());
        var activePrimaryManagers = managerRelationships
            .Where(relationship => relationship.IsPrimary && IsActiveOn(relationship.ActiveFrom, relationship.ActiveTo, today))
            .GroupBy(relationship => relationship.StaffId)
            .ToDictionary(group => group.Key, group => group.First());

        return staff.Select(person =>
        {
            var personRoles = rolesByStaff.GetValueOrDefault(person.StaffId, []);
            var reportingLine = BuildReportingLine(
                person.StaffId,
                activePrimaryManagers,
                staffById,
                rolesByStaff);

            return new AdminOrganisationStaffSummary(
                person.StaffId,
                person.ExternalId,
                person.DisplayName,
                person.Email,
                person.AccountStatus,
                person.StaffCategory,
                personRoles.FirstOrDefault()?.RoleName ?? "Tutor",
                personRoles.Select(role => role.RoleName).ToArray(),
                memberships
                    .Where(membership => membership.StaffId == person.StaffId)
                    .Select(membership => new AdminOrganisationMembershipSummary(
                        membership.Id,
                        membership.OrgUnitId,
                        membership.ParentOrgUnitId,
                        membership.OrgUnitType,
                        membership.Code,
                        membership.Name,
                        membership.ParentCode,
                        membership.ParentName,
                        membership.MembershipType,
                        membership.IsPrimary,
                        membership.ActiveFrom,
                        membership.ActiveTo,
                        IsActiveOn(membership.ActiveFrom, membership.ActiveTo, today)))
                    .ToArray(),
                managerRelationships
                    .Where(relationship => relationship.StaffId == person.StaffId)
                    .Select(relationship => new AdminManagerRelationshipSummary(
                        relationship.Id,
                        relationship.ManagerStaffId,
                        relationship.ManagerName,
                        relationship.RelationshipType,
                        relationship.IsPrimary,
                        relationship.ActiveFrom,
                        relationship.ActiveTo,
                        IsActiveOn(relationship.ActiveFrom, relationship.ActiveTo, today)))
                    .ToArray(),
                reportingLine);
        }).ToArray();
    }

    public async Task<Guid> SaveOrganisationMembershipAsync(
        Guid staffId,
        SaveOrganisationMembershipRequest request,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        ValidateDateRange(request.ActiveFrom, request.ActiveTo);
        var membershipType = NormalizeMembershipType(request.MembershipType);

        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            var staffExists = await ScalarExistsAsync(
                connection,
                transaction,
                "SELECT 1 FROM people.staff WHERE id = @id AND archived_at IS NULL;",
                command => command.Parameters.AddWithValue("@id", staffId),
                cancellationToken);
            var orgExists = await ScalarExistsAsync(
                connection,
                transaction,
                "SELECT 1 FROM org.org_units WHERE id = @id AND archived_at IS NULL AND is_active = 1;",
                command => command.Parameters.AddWithValue("@id", request.OrgUnitId),
                cancellationToken);
            if (!staffExists || !orgExists)
            {
                throw new WorkflowValidationException("Select an active staff member and organisation unit.");
            }

            var membershipId = Guid.NewGuid();
            var makePrimary = request.IsPrimary;
            if (!makePrimary)
            {
                makePrimary = !await ScalarExistsAsync(
                    connection,
                    transaction,
                    """
                    SELECT 1
                    FROM org.staff_org_memberships
                    WHERE staff_id = @staffId
                      AND is_primary = 1
                      AND archived_at IS NULL
                      AND (active_to IS NULL OR active_to >= CONVERT(date, sysutcdatetime()));
                    """,
                    command => command.Parameters.AddWithValue("@staffId", staffId),
                    cancellationToken);
            }

            if (makePrimary)
            {
                await ExecuteAsync(
                    connection,
                    transaction,
                    """
                    UPDATE org.staff_org_memberships
                    SET is_primary = 0,
                        updated_by_user_account_id = @updatedBy,
                        updated_at = sysutcdatetime()
                    WHERE staff_id = @staffId
                      AND is_primary = 1
                      AND archived_at IS NULL;
                    """,
                    command =>
                    {
                        command.Parameters.AddWithValue("@staffId", staffId);
                        command.Parameters.AddWithValue("@updatedBy", ToDbValue(currentUser.UserAccountId));
                    },
                    cancellationToken);
            }

            await using (var command = new SqlCommand(
                """
                DECLARE @existingId uniqueidentifier = (
                    SELECT TOP (1) id
                    FROM org.staff_org_memberships
                    WHERE staff_id = @staffId
                      AND org_unit_id = @orgUnitId
                      AND membership_type = @membershipType
                    ORDER BY CASE WHEN archived_at IS NULL THEN 0 ELSE 1 END, created_at DESC
                );

                IF @existingId IS NULL
                BEGIN
                    INSERT INTO org.staff_org_memberships (
                        id, staff_id, org_unit_id, membership_type, is_primary,
                        active_from, active_to, created_by_user_account_id, created_at
                    )
                    VALUES (
                        @id, @staffId, @orgUnitId, @membershipType, @isPrimary,
                        @activeFrom, @activeTo, @createdBy, sysutcdatetime()
                    );
                END
                ELSE
                BEGIN
                    SET @id = @existingId;
                    UPDATE org.staff_org_memberships
                    SET is_primary = @isPrimary,
                        active_from = @activeFrom,
                        active_to = @activeTo,
                        archived_at = NULL,
                        updated_by_user_account_id = @updatedBy,
                        updated_at = sysutcdatetime()
                    WHERE id = @existingId;
                END;

                SELECT @id;
                """,
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.Add(new SqlParameter("@id", System.Data.SqlDbType.UniqueIdentifier) { Value = membershipId, Direction = System.Data.ParameterDirection.InputOutput });
                command.Parameters.AddWithValue("@staffId", staffId);
                command.Parameters.AddWithValue("@orgUnitId", request.OrgUnitId);
                command.Parameters.AddWithValue("@membershipType", membershipType);
                command.Parameters.AddWithValue("@isPrimary", makePrimary);
                command.Parameters.AddWithValue("@activeFrom", ToDbValue(request.ActiveFrom));
                command.Parameters.AddWithValue("@activeTo", ToDbValue(request.ActiveTo));
                command.Parameters.AddWithValue("@createdBy", ToDbValue(currentUser.UserAccountId));
                command.Parameters.AddWithValue("@updatedBy", ToDbValue(currentUser.UserAccountId));
                membershipId = (Guid)(await command.ExecuteScalarAsync(cancellationToken))!;
            }

            if (makePrimary)
            {
                await ExecuteAsync(
                    connection,
                    transaction,
                    """
                    UPDATE people.staff
                    SET primary_org_unit_id = @orgUnitId, updated_at = sysutcdatetime()
                    WHERE id = @staffId;
                    """,
                    command =>
                    {
                        command.Parameters.AddWithValue("@staffId", staffId);
                        command.Parameters.AddWithValue("@orgUnitId", request.OrgUnitId);
                    },
                    cancellationToken);
            }

            await WriteAuditWithReasonAsync(
                connection,
                transaction,
                currentUser.UserAccountId,
                null,
                "staff_org_membership",
                membershipId,
                "organisation.membership_saved",
                $"Organisation allocation saved by {currentUser.DisplayName}.",
                null,
                JsonSerializer.Serialize(new { staffId, request.OrgUnitId, membershipType, isPrimary = makePrimary, request.ActiveFrom, request.ActiveTo }),
                null,
                cancellationToken);

            await transaction.CommitAsync(cancellationToken);
            return membershipId;
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task<bool> SetPrimaryOrganisationMembershipAsync(
        Guid staffId,
        Guid membershipId,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            Guid? orgUnitId = null;
            await using (var select = new SqlCommand(
                """
                SELECT org_unit_id
                FROM org.staff_org_memberships
                WHERE id = @membershipId
                  AND staff_id = @staffId
                  AND archived_at IS NULL
                  AND (active_from IS NULL OR active_from <= CONVERT(date, sysutcdatetime()))
                  AND (active_to IS NULL OR active_to >= CONVERT(date, sysutcdatetime()));
                """,
                connection,
                (SqlTransaction)transaction))
            {
                select.Parameters.AddWithValue("@membershipId", membershipId);
                select.Parameters.AddWithValue("@staffId", staffId);
                orgUnitId = (Guid?)(await select.ExecuteScalarAsync(cancellationToken));
            }

            if (!orgUnitId.HasValue)
            {
                await transaction.RollbackAsync(cancellationToken);
                return false;
            }

            await ExecuteAsync(
                connection,
                transaction,
                """
                UPDATE org.staff_org_memberships
                SET is_primary = CASE WHEN id = @membershipId THEN 1 ELSE 0 END,
                    updated_by_user_account_id = @updatedBy,
                    updated_at = sysutcdatetime()
                WHERE staff_id = @staffId AND archived_at IS NULL;

                UPDATE people.staff
                SET primary_org_unit_id = @orgUnitId, updated_at = sysutcdatetime()
                WHERE id = @staffId;
                """,
                command =>
                {
                    command.Parameters.AddWithValue("@membershipId", membershipId);
                    command.Parameters.AddWithValue("@staffId", staffId);
                    command.Parameters.AddWithValue("@orgUnitId", orgUnitId.Value);
                    command.Parameters.AddWithValue("@updatedBy", ToDbValue(currentUser.UserAccountId));
                },
                cancellationToken);

            await WriteAuditWithReasonAsync(
                connection, transaction, currentUser.UserAccountId, null,
                "staff_org_membership", membershipId, "organisation.primary_allocation_changed",
                $"Primary organisation allocation changed by {currentUser.DisplayName}.",
                null, JsonSerializer.Serialize(new { staffId, membershipId, orgUnitId }), null, cancellationToken);

            await transaction.CommitAsync(cancellationToken);
            return true;
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task<bool> ArchiveOrganisationMembershipAsync(
        Guid staffId,
        Guid membershipId,
        string reason,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        reason = RequireReason(reason);
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            var exists = await ScalarExistsAsync(
                connection,
                transaction,
                "SELECT 1 FROM org.staff_org_memberships WHERE id = @membershipId AND staff_id = @staffId AND archived_at IS NULL;",
                command =>
                {
                    command.Parameters.AddWithValue("@membershipId", membershipId);
                    command.Parameters.AddWithValue("@staffId", staffId);
                },
                cancellationToken);
            if (!exists)
            {
                await transaction.RollbackAsync(cancellationToken);
                return false;
            }

            await ExecuteAsync(
                connection,
                transaction,
                """
                DECLARE @wasPrimary bit = 0;
                DECLARE @replacementId uniqueidentifier;
                DECLARE @replacementOrgUnitId uniqueidentifier;
                SELECT @wasPrimary = is_primary
                FROM org.staff_org_memberships
                WHERE id = @membershipId AND staff_id = @staffId AND archived_at IS NULL;

                UPDATE org.staff_org_memberships
                SET is_primary = 0,
                    archived_at = sysutcdatetime(),
                    updated_by_user_account_id = @updatedBy,
                    updated_at = sysutcdatetime()
                WHERE id = @membershipId AND staff_id = @staffId AND archived_at IS NULL;

                IF @wasPrimary = 1
                BEGIN
                    SELECT TOP (1)
                        @replacementId = id,
                        @replacementOrgUnitId = org_unit_id
                    FROM org.staff_org_memberships
                    WHERE staff_id = @staffId
                      AND id <> @membershipId
                      AND archived_at IS NULL
                      AND (active_from IS NULL OR active_from <= CONVERT(date, sysutcdatetime()))
                      AND (active_to IS NULL OR active_to >= CONVERT(date, sysutcdatetime()))
                    ORDER BY CASE membership_type
                                 WHEN N'programme_leader' THEN 1
                                 WHEN N'head_of_faculty' THEN 2
                                 WHEN N'director' THEN 3
                                 ELSE 4
                             END,
                             created_at;

                    UPDATE org.staff_org_memberships
                    SET is_primary = 1,
                        updated_by_user_account_id = @updatedBy,
                        updated_at = sysutcdatetime()
                    WHERE id = @replacementId;

                    UPDATE people.staff
                    SET primary_org_unit_id = @replacementOrgUnitId, updated_at = sysutcdatetime()
                    WHERE id = @staffId;
                END;
                """,
                command =>
                {
                    command.Parameters.AddWithValue("@membershipId", membershipId);
                    command.Parameters.AddWithValue("@staffId", staffId);
                    command.Parameters.AddWithValue("@updatedBy", ToDbValue(currentUser.UserAccountId));
                },
                cancellationToken);

            await WriteAuditWithReasonAsync(
                connection, transaction, currentUser.UserAccountId, null,
                "staff_org_membership", membershipId, "organisation.membership_removed",
                $"Organisation allocation removed by {currentUser.DisplayName}.",
                null, JsonSerializer.Serialize(new { staffId, membershipId }), reason, cancellationToken);

            await transaction.CommitAsync(cancellationToken);
            return true;
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task<Guid> SaveManagerRelationshipAsync(
        Guid staffId,
        SaveManagerRelationshipRequest request,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        if (request.IsPrimary)
        {
            throw new WorkflowValidationException("Primary reporting lines are managed from faculty and team manager assignments.");
        }

        if (staffId == request.ManagerStaffId)
        {
            throw new WorkflowValidationException("A staff member cannot manage themselves.");
        }
        ValidateDateRange(request.ActiveFrom, request.ActiveTo);
        var relationshipType = NormalizeManagerRelationshipType(request.RelationshipType);
        var isPrimary = request.IsPrimary;
        if (isPrimary)
        {
            relationshipType = "line_manager";
        }

        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            var staffAndManagerExist = await ScalarExistsAsync(
                connection,
                transaction,
                """
                SELECT 1
                WHERE EXISTS (SELECT 1 FROM people.staff WHERE id = @staffId AND archived_at IS NULL)
                  AND EXISTS (SELECT 1 FROM people.staff WHERE id = @managerStaffId AND archived_at IS NULL);
                """,
                command =>
                {
                    command.Parameters.AddWithValue("@staffId", staffId);
                    command.Parameters.AddWithValue("@managerStaffId", request.ManagerStaffId);
                },
                cancellationToken);
            if (!staffAndManagerExist)
            {
                throw new WorkflowValidationException("Select an active staff member and manager.");
            }

            if (isPrimary && await WouldCreateManagerCycleAsync(connection, transaction, staffId, request.ManagerStaffId, cancellationToken))
            {
                throw new WorkflowValidationException("That primary manager would create a circular reporting line.");
            }

            if (isPrimary)
            {
                await ExecuteAsync(
                    connection,
                    transaction,
                    """
                    UPDATE org.staff_manager_relationships
                    SET is_primary = 0,
                        active_to = COALESCE(active_to, CONVERT(date, sysutcdatetime())),
                        archived_at = sysutcdatetime(),
                        updated_by_user_account_id = @updatedBy,
                        updated_at = sysutcdatetime()
                    WHERE staff_id = @staffId
                      AND is_primary = 1
                      AND archived_at IS NULL;
                    """,
                    command =>
                    {
                        command.Parameters.AddWithValue("@staffId", staffId);
                        command.Parameters.AddWithValue("@updatedBy", ToDbValue(currentUser.UserAccountId));
                    },
                    cancellationToken);
            }

            var relationshipId = Guid.NewGuid();
            await ExecuteAsync(
                connection,
                transaction,
                """
                INSERT INTO org.staff_manager_relationships (
                    id, staff_id, manager_staff_id, relationship_type, is_primary,
                    active_from, active_to, created_by_user_account_id
                )
                VALUES (
                    @id, @staffId, @managerStaffId, @relationshipType, @isPrimary,
                    @activeFrom, @activeTo, @createdBy
                );
                """,
                command =>
                {
                    command.Parameters.AddWithValue("@id", relationshipId);
                    command.Parameters.AddWithValue("@staffId", staffId);
                    command.Parameters.AddWithValue("@managerStaffId", request.ManagerStaffId);
                    command.Parameters.AddWithValue("@relationshipType", relationshipType);
                    command.Parameters.AddWithValue("@isPrimary", isPrimary);
                    command.Parameters.AddWithValue("@activeFrom", ToDbValue(request.ActiveFrom));
                    command.Parameters.AddWithValue("@activeTo", ToDbValue(request.ActiveTo));
                    command.Parameters.AddWithValue("@createdBy", ToDbValue(currentUser.UserAccountId));
                },
                cancellationToken);

            if (isPrimary)
            {
                await ExecuteAsync(
                    connection,
                    transaction,
                    """
                    UPDATE people.staff
                    SET line_manager_staff_id = @managerStaffId, updated_at = sysutcdatetime()
                    WHERE id = @staffId;
                    """,
                    command =>
                    {
                        command.Parameters.AddWithValue("@staffId", staffId);
                        command.Parameters.AddWithValue("@managerStaffId", request.ManagerStaffId);
                    },
                    cancellationToken);
            }

            await WriteAuditWithReasonAsync(
                connection, transaction, currentUser.UserAccountId, null,
                "staff_manager_relationship", relationshipId, "organisation.manager_assigned",
                $"Manager relationship assigned by {currentUser.DisplayName}.",
                null, JsonSerializer.Serialize(new { staffId, request.ManagerStaffId, relationshipType, isPrimary, request.ActiveFrom, request.ActiveTo }), null, cancellationToken);

            await transaction.CommitAsync(cancellationToken);
            return relationshipId;
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task<bool> ArchiveManagerRelationshipAsync(
        Guid staffId,
        Guid relationshipId,
        string reason,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        reason = RequireReason(reason);
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            var exists = await ScalarExistsAsync(
                connection,
                transaction,
                "SELECT 1 FROM org.staff_manager_relationships WHERE id = @relationshipId AND staff_id = @staffId AND assignment_source <> N'org_unit_leadership' AND archived_at IS NULL;",
                command =>
                {
                    command.Parameters.AddWithValue("@relationshipId", relationshipId);
                    command.Parameters.AddWithValue("@staffId", staffId);
                },
                cancellationToken);
            if (!exists)
            {
                await transaction.RollbackAsync(cancellationToken);
                return false;
            }

            await ExecuteAsync(
                connection,
                transaction,
                """
                DECLARE @wasPrimary bit = 0;
                SELECT @wasPrimary = is_primary
                FROM org.staff_manager_relationships
                WHERE id = @relationshipId AND staff_id = @staffId AND archived_at IS NULL;

                UPDATE org.staff_manager_relationships
                SET is_primary = 0,
                    active_to = COALESCE(active_to, CONVERT(date, sysutcdatetime())),
                    archived_at = sysutcdatetime(),
                    updated_by_user_account_id = @updatedBy,
                    updated_at = sysutcdatetime()
                WHERE id = @relationshipId AND staff_id = @staffId AND archived_at IS NULL;

                IF @wasPrimary = 1
                    UPDATE people.staff
                    SET line_manager_staff_id = NULL, updated_at = sysutcdatetime()
                    WHERE id = @staffId;
                """,
                command =>
                {
                    command.Parameters.AddWithValue("@relationshipId", relationshipId);
                    command.Parameters.AddWithValue("@staffId", staffId);
                    command.Parameters.AddWithValue("@updatedBy", ToDbValue(currentUser.UserAccountId));
                },
                cancellationToken);

            await WriteAuditWithReasonAsync(
                connection, transaction, currentUser.UserAccountId, null,
                "staff_manager_relationship", relationshipId, "organisation.manager_removed",
                $"Manager relationship removed by {currentUser.DisplayName}.",
                null, JsonSerializer.Serialize(new { staffId, relationshipId }), reason, cancellationToken);

            await transaction.CommitAsync(cancellationToken);
            return true;
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    private static IReadOnlyList<AdminReportingLineSummary> BuildReportingLine(
        Guid staffId,
        IReadOnlyDictionary<Guid, OrganisationManagerRow> primaryManagers,
        IReadOnlyDictionary<Guid, OrganisationStaffRow> staffById,
        IReadOnlyDictionary<Guid, OrganisationRoleRow[]> rolesByStaff)
    {
        var result = new List<AdminReportingLineSummary>();
        var visited = new HashSet<Guid> { staffId };
        var currentStaffId = staffId;

        while (result.Count < 12 && primaryManagers.TryGetValue(currentStaffId, out var relationship))
        {
            if (!visited.Add(relationship.ManagerStaffId)
                || !staffById.TryGetValue(relationship.ManagerStaffId, out var manager))
            {
                break;
            }

            var managerRoles = rolesByStaff.GetValueOrDefault(manager.StaffId, []);
            result.Add(new AdminReportingLineSummary(
                manager.StaffId,
                manager.DisplayName,
                result.Count + 1,
                managerRoles.FirstOrDefault()?.RoleName ?? "Tutor"));
            currentStaffId = manager.StaffId;
        }

        return result;
    }

    private static bool IsActiveOn(DateOnly? activeFrom, DateOnly? activeTo, DateOnly date) =>
        (!activeFrom.HasValue || activeFrom.Value <= date)
        && (!activeTo.HasValue || activeTo.Value >= date);

    private static void ValidateDateRange(DateOnly? activeFrom, DateOnly? activeTo)
    {
        if (activeFrom.HasValue && activeTo.HasValue && activeTo.Value < activeFrom.Value)
        {
            throw new WorkflowValidationException("The end date cannot be before the start date.");
        }
    }

    private static string NormalizeMembershipType(string? value)
    {
        var normalized = string.IsNullOrWhiteSpace(value) ? "member" : value.Trim().ToLowerInvariant();
        return normalized is "member" or "programme_leader" or "head_of_faculty" or "director" or "support"
            ? normalized
            : throw new WorkflowValidationException("Select a valid allocation role.");
    }

    private static string NormalizeManagerRelationshipType(string? value)
    {
        var normalized = string.IsNullOrWhiteSpace(value) ? "line_manager" : value.Trim().ToLowerInvariant();
        return normalized is "line_manager" or "secondary" or "functional"
            ? normalized
            : throw new WorkflowValidationException("Select a valid manager relationship type.");
    }

    private static string RequireReason(string? reason)
    {
        var normalized = reason?.Trim();
        if (string.IsNullOrWhiteSpace(normalized))
        {
            throw new WorkflowValidationException("Enter a reason for this change.");
        }

        return normalized.Length <= 1000
            ? normalized
            : throw new WorkflowValidationException("Reasons cannot exceed 1,000 characters.");
    }

    private static async Task<bool> WouldCreateManagerCycleAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        Guid staffId,
        Guid managerStaffId,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            """
            WITH manager_chain AS (
                SELECT relationship.manager_staff_id
                FROM org.staff_manager_relationships relationship
                WHERE relationship.staff_id = @managerStaffId
                  AND relationship.is_primary = 1
                  AND relationship.archived_at IS NULL
                  AND (relationship.active_to IS NULL OR relationship.active_to >= CONVERT(date, sysutcdatetime()))
                UNION ALL
                SELECT relationship.manager_staff_id
                FROM org.staff_manager_relationships relationship
                JOIN manager_chain chain ON chain.manager_staff_id = relationship.staff_id
                WHERE relationship.is_primary = 1
                  AND relationship.archived_at IS NULL
                  AND (relationship.active_to IS NULL OR relationship.active_to >= CONVERT(date, sysutcdatetime()))
            )
            SELECT TOP (1) 1
            FROM manager_chain
            WHERE manager_staff_id = @staffId
            OPTION (MAXRECURSION 100);
            """,
            connection,
            (SqlTransaction)transaction);
        command.Parameters.AddWithValue("@staffId", staffId);
        command.Parameters.AddWithValue("@managerStaffId", managerStaffId);
        return await command.ExecuteScalarAsync(cancellationToken) is not null;
    }

    private static async Task<bool> ScalarExistsAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        string sql,
        Action<SqlCommand> configure,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(sql, connection, (SqlTransaction)transaction);
        configure(command);
        return await command.ExecuteScalarAsync(cancellationToken) is not null;
    }

    private static async Task<int> ExecuteAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        string sql,
        Action<SqlCommand> configure,
        CancellationToken cancellationToken,
        bool ignoreMissingColumn = false)
    {
        await using var command = new SqlCommand(sql, connection, (SqlTransaction)transaction);
        configure(command);
        try
        {
            return await command.ExecuteNonQueryAsync(cancellationToken);
        }
        catch (SqlException exception) when (ignoreMissingColumn && exception.Number == 207)
        {
            return 0;
        }
    }

    private sealed record OrganisationStaffRow(Guid StaffId, string ExternalId, string DisplayName, string Email, string AccountStatus, string? StaffCategory);
    private sealed record OrganisationMembershipRow(
        Guid Id,
        Guid StaffId,
        Guid OrgUnitId,
        Guid? ParentOrgUnitId,
        string OrgUnitType,
        string Code,
        string Name,
        string? ParentCode,
        string? ParentName,
        string MembershipType,
        bool IsPrimary,
        DateOnly? ActiveFrom,
        DateOnly? ActiveTo);
    private sealed record OrganisationManagerRow(
        Guid Id,
        Guid StaffId,
        Guid ManagerStaffId,
        string ManagerName,
        string RelationshipType,
        bool IsPrimary,
        DateOnly? ActiveFrom,
        DateOnly? ActiveTo);
    private sealed record OrganisationRoleRow(Guid StaffId, string RoleName, int Precedence);
}
