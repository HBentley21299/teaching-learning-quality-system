using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    private static readonly Regex OrganisationCodePattern = new("^[A-Z0-9-]{2,50}$", RegexOptions.Compiled);

    public async Task<Guid> CreateOrganisationUnitAsync(
        SaveOrganisationUnitRequest request,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        var normalized = NormalizeOrganisationUnit(request);
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            await ValidateOrganisationParentAsync(connection, transaction, null, normalized, cancellationToken);
            var id = Guid.NewGuid();
            await ExecuteAsync(
                connection,
                transaction,
                """
                INSERT INTO org.org_units (
                    id, parent_org_unit_id, org_unit_type, code, name, description,
                    is_active, effective_from, updated_by_user_account_id
                )
                VALUES (
                    @id, @parentId, @type, @code, @name, @description,
                    1, CONVERT(date, sysutcdatetime()), @updatedBy
                );
                """,
                command =>
                {
                    command.Parameters.AddWithValue("@id", id);
                    command.Parameters.AddWithValue("@parentId", ToDbValue(normalized.ParentOrgUnitId));
                    command.Parameters.AddWithValue("@type", normalized.OrgUnitType);
                    command.Parameters.AddWithValue("@code", normalized.Code);
                    command.Parameters.AddWithValue("@name", normalized.Name);
                    command.Parameters.AddWithValue("@description", ToDbValue(normalized.Description));
                    command.Parameters.AddWithValue("@updatedBy", ToDbValue(currentUser.UserAccountId));
                },
                cancellationToken);

            await WriteAuditWithReasonAsync(
                connection, transaction, currentUser.UserAccountId, null,
                "org_unit", id, "organisation.unit_created",
                $"Organisation unit {normalized.Code} created by {currentUser.DisplayName}.",
                null, JsonSerializer.Serialize(normalized), null, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return id;
        }
        catch (SqlException exception) when (exception.Number is 2601 or 2627)
        {
            await transaction.RollbackAsync(cancellationToken);
            throw new WorkflowValidationException("That organisation code is already in use for this type of unit.");
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task<bool> UpdateOrganisationUnitAsync(
        Guid orgUnitId,
        SaveOrganisationUnitRequest request,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        var normalized = NormalizeOrganisationUnit(request);
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            var before = await ReadOrganisationUnitAsync(connection, transaction, orgUnitId, cancellationToken);
            if (before is null)
            {
                await transaction.RollbackAsync(cancellationToken);
                return false;
            }

            await ValidateOrganisationParentAsync(connection, transaction, orgUnitId, normalized, cancellationToken);
            await ExecuteAsync(
                connection,
                transaction,
                """
                UPDATE org.org_units
                SET parent_org_unit_id = @parentId,
                    org_unit_type = @type,
                    code = @code,
                    name = @name,
                    description = @description,
                    legacy_code = CASE WHEN code <> @code THEN code ELSE legacy_code END,
                    updated_by_user_account_id = @updatedBy,
                    updated_at = sysutcdatetime()
                WHERE id = @id AND archived_at IS NULL;

                IF @oldCode <> @code
                   AND NOT EXISTS (SELECT 1 FROM org.org_unit_code_aliases WHERE legacy_code = @oldCode)
                BEGIN
                    INSERT INTO org.org_unit_code_aliases (
                        legacy_code, replacement_org_unit_id, migration_note, created_by_user_account_id
                    )
                    VALUES (@oldCode, @id, N'Code changed in Organisation Structure administration.', @updatedBy);
                END;
                """,
                command =>
                {
                    command.Parameters.AddWithValue("@id", orgUnitId);
                    command.Parameters.AddWithValue("@parentId", ToDbValue(normalized.ParentOrgUnitId));
                    command.Parameters.AddWithValue("@type", normalized.OrgUnitType);
                    command.Parameters.AddWithValue("@code", normalized.Code);
                    command.Parameters.AddWithValue("@oldCode", before.Code);
                    command.Parameters.AddWithValue("@name", normalized.Name);
                    command.Parameters.AddWithValue("@description", ToDbValue(normalized.Description));
                    command.Parameters.AddWithValue("@updatedBy", ToDbValue(currentUser.UserAccountId));
                },
                cancellationToken);

            await WriteAuditWithReasonAsync(
                connection, transaction, currentUser.UserAccountId, null,
                "org_unit", orgUnitId, "organisation.unit_updated",
                $"Organisation unit {before.Code} updated by {currentUser.DisplayName}.",
                JsonSerializer.Serialize(before), JsonSerializer.Serialize(normalized), null, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return true;
        }
        catch (SqlException exception) when (exception.Number is 2601 or 2627)
        {
            await transaction.RollbackAsync(cancellationToken);
            throw new WorkflowValidationException("That organisation code is already in use for this type of unit.");
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task<OrganisationChangeImpactSummary?> GetOrganisationChangeImpactAsync(
        Guid orgUnitId,
        CancellationToken cancellationToken)
    {
        var rows = await QueryAsync(
            """
            SELECT unit.id,
                   (SELECT COUNT(*) FROM org.staff_org_memberships membership
                    WHERE membership.org_unit_id = unit.id AND membership.archived_at IS NULL
                      AND (membership.active_to IS NULL OR membership.active_to >= CONVERT(date, sysutcdatetime()))),
                   (SELECT COUNT(*) FROM org.org_unit_leaderships leadership
                    WHERE leadership.org_unit_id = unit.id AND leadership.archived_at IS NULL
                      AND (leadership.active_to IS NULL OR leadership.active_to >= CONVERT(date, sysutcdatetime()))),
                   (SELECT COUNT(*) FROM auth.access_scopes scope
                    WHERE scope.org_unit_id = unit.id AND scope.is_active = 1 AND scope.archived_at IS NULL),
                   (SELECT COUNT(*) FROM org.org_units child
                    WHERE child.parent_org_unit_id = unit.id AND child.is_active = 1 AND child.archived_at IS NULL),
                   (SELECT COUNT(*) FROM core.records record_row WHERE record_row.org_unit_id = unit.id),
                   (SELECT COUNT(*) FROM core.records record_row
                    LEFT JOIN core.lookup_values status_value ON status_value.id = record_row.status_lookup_value_id
                    WHERE record_row.org_unit_id = unit.id AND record_row.archived_at IS NULL
                      AND COALESCE(status_value.value_key, N'draft') IN (N'draft', N'in_progress', N'open')),
                   (SELECT COUNT(*) FROM quality.actions action_row
                    JOIN core.records record_row ON record_row.id = action_row.source_record_id
                    WHERE record_row.org_unit_id = unit.id AND action_row.completed_date IS NULL AND action_row.archived_at IS NULL)
            FROM org.org_units unit
            WHERE unit.id = @orgUnitId AND unit.archived_at IS NULL;
            """,
            command => command.Parameters.AddWithValue("@orgUnitId", orgUnitId),
            reader => new OrganisationImpactRow(
                reader.GetGuid(0), reader.GetInt32(1), reader.GetInt32(2), reader.GetInt32(3),
                reader.GetInt32(4), reader.GetInt32(5), reader.GetInt32(6), reader.GetInt32(7)),
            cancellationToken);

        if (rows.Count == 0) return null;
        var row = rows[0];
        var warnings = new List<string>();
        if (row.ActiveMemberships > 0) warnings.Add($"{row.ActiveMemberships} active staff membership(s) will point to an inactive unit.");
        if (row.ActiveLeaderships > 0) warnings.Add($"{row.ActiveLeaderships} active manager assignment(s) require review.");
        if (row.ActivePermissionScopes > 0) warnings.Add($"{row.ActivePermissionScopes} explicit permission scope(s) require review.");
        if (row.ChildUnits > 0) warnings.Add($"{row.ChildUnits} active child unit(s) remain below this unit.");
        if (row.DraftRecords > 0) warnings.Add($"{row.DraftRecords} draft or in-progress record(s) use this unit.");
        return new OrganisationChangeImpactSummary(
            row.Id, row.ActiveMemberships, row.ActiveLeaderships, row.ActivePermissionScopes,
            row.ChildUnits, row.HistoricalRecords, row.DraftRecords, row.OpenActions, warnings);
    }

    public async Task<bool> SetOrganisationUnitStatusAsync(
        Guid orgUnitId,
        SetOrganisationUnitStatusRequest request,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        var reason = RequireReason(request.Reason);
        var impact = await GetOrganisationChangeImpactAsync(orgUnitId, cancellationToken);
        if (impact is null) return false;
        if (!request.IsActive && impact.Warnings.Count > 0 && !request.ConfirmImpact)
        {
            throw new WorkflowValidationException("Review and confirm the organisation change impact before deactivating this unit.");
        }

        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            var changed = await ExecuteAsync(
                connection,
                transaction,
                """
                UPDATE org.org_units
                SET is_active = @isActive,
                    effective_to = CASE WHEN @isActive = 0 THEN CONVERT(date, sysutcdatetime()) ELSE NULL END,
                    archived_at = NULL,
                    updated_by_user_account_id = @updatedBy,
                    updated_at = sysutcdatetime()
                WHERE id = @id AND archived_at IS NULL;
                """,
                command =>
                {
                    command.Parameters.AddWithValue("@id", orgUnitId);
                    command.Parameters.AddWithValue("@isActive", request.IsActive);
                    command.Parameters.AddWithValue("@updatedBy", ToDbValue(currentUser.UserAccountId));
                },
                cancellationToken);
            if (changed == 0)
            {
                await transaction.RollbackAsync(cancellationToken);
                return false;
            }

            await WriteAuditWithReasonAsync(
                connection, transaction, currentUser.UserAccountId, null,
                "org_unit", orgUnitId,
                request.IsActive ? "organisation.unit_activated" : "organisation.unit_deactivated",
                $"Organisation unit status changed by {currentUser.DisplayName}.",
                null, JsonSerializer.Serialize(new { request.IsActive, impact }), reason, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return true;
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task<MembershipChangeImpactSummary?> GetMembershipChangeImpactAsync(
        Guid staffId,
        Guid membershipId,
        CancellationToken cancellationToken)
    {
        var rows = await QueryAsync(
            """
            SELECT membership.id, membership.staff_id, staff.display_name, unit.code, membership.is_primary,
                   (SELECT COUNT(*) FROM auth.access_scopes scope
                    JOIN auth.user_accounts account ON account.id = scope.user_account_id
                    WHERE account.staff_id = staff.id AND scope.org_unit_id = unit.id
                      AND scope.is_active = 1 AND scope.archived_at IS NULL),
                   (SELECT COUNT(*) FROM org.staff_manager_relationships relationship
                    WHERE relationship.manager_staff_id = staff.id AND relationship.archived_at IS NULL
                      AND (relationship.active_to IS NULL OR relationship.active_to >= CONVERT(date, sysutcdatetime()))),
                   (SELECT COUNT(*) FROM quality.actions action_row
                    WHERE action_row.owner_staff_id = staff.id AND action_row.completed_date IS NULL AND action_row.archived_at IS NULL),
                   (SELECT COUNT(*) FROM core.records record_row
                    LEFT JOIN core.lookup_values status_value ON status_value.id = record_row.status_lookup_value_id
                    WHERE (record_row.subject_staff_id = staff.id OR record_row.owner_staff_id = staff.id)
                      AND record_row.archived_at IS NULL
                      AND COALESCE(status_value.value_key, N'draft') IN (N'draft', N'in_progress', N'open')),
                   (SELECT COUNT(*) FROM quality.coaching_sessions session
                    WHERE session.staff_id = staff.id AND session.status = N'draft' AND session.archived_at IS NULL)
            FROM org.staff_org_memberships membership
            JOIN people.staff staff ON staff.id = membership.staff_id
            JOIN org.org_units unit ON unit.id = membership.org_unit_id
            WHERE membership.id = @membershipId AND membership.staff_id = @staffId AND membership.archived_at IS NULL;
            """,
            command =>
            {
                command.Parameters.AddWithValue("@membershipId", membershipId);
                command.Parameters.AddWithValue("@staffId", staffId);
            },
            reader => new MembershipImpactRow(
                reader.GetGuid(0), reader.GetGuid(1), reader.GetString(2), reader.GetString(3), reader.GetBoolean(4),
                reader.GetInt32(5), reader.GetInt32(6), reader.GetInt32(7), reader.GetInt32(8), reader.GetInt32(9)),
            cancellationToken);
        if (rows.Count == 0) return null;
        var row = rows[0];
        var warnings = new List<string>();
        if (row.IsPrimary) warnings.Add("The staff member will have no primary organisation until an administrator explicitly selects one.");
        if (row.PermissionScopes > 0) warnings.Add($"{row.PermissionScopes} explicit permission scope(s) are unaffected and should be reviewed separately.");
        if (row.DirectReports > 0) warnings.Add($"{row.DirectReports} reporting relationship(s) are unaffected by membership removal.");
        if (row.DraftRecords > 0) warnings.Add($"{row.DraftRecords} draft or in-progress record(s) remain attached to the staff member.");
        return new MembershipChangeImpactSummary(
            row.MembershipId, row.StaffId, row.StaffName, row.OrgUnitCode, row.IsPrimary,
            row.PermissionScopes, row.DirectReports, row.AssignedOpenActions, row.DraftRecords, row.ActiveReviews, warnings);
    }

    public Task<IReadOnlyList<OrganisationMigrationReviewSummary>> GetOrganisationMigrationReviewsAsync(
        CancellationToken cancellationToken) =>
        QueryAsync(
            """
            SELECT review.id, review.migration_key, review.item_type, review.source_code, review.proposed_code,
                   review.staff_id, staff.display_name, review.details, review.status, review.resolution_note, review.created_at
            FROM org.migration_review_items review
            LEFT JOIN people.staff staff ON staff.id = review.staff_id
            ORDER BY CASE review.status WHEN N'open' THEN 0 ELSE 1 END, review.created_at DESC;
            """,
            reader => new OrganisationMigrationReviewSummary(
                reader.GetGuid(0), reader.GetString(1), reader.GetString(2), GetStringOrNull(reader, 3),
                GetStringOrNull(reader, 4), GetGuidOrNull(reader, 5), GetStringOrNull(reader, 6),
                reader.GetString(7), reader.GetString(8), GetStringOrNull(reader, 9), reader.GetFieldValue<DateTimeOffset>(10)),
            cancellationToken);

    private static SaveOrganisationUnitRequest NormalizeOrganisationUnit(SaveOrganisationUnitRequest request)
    {
        var type = request.OrgUnitType.Trim().ToLowerInvariant();
        if (type is not ("faculty" or "team"))
            throw new WorkflowValidationException("Organisation unit type must be faculty or team.");
        var code = request.Code.Trim().ToUpperInvariant();
        if (!OrganisationCodePattern.IsMatch(code))
            throw new WorkflowValidationException("Use 2-50 uppercase letters, numbers or hyphens for the organisation code.");
        var name = request.Name.Trim();
        if (name.Length is < 2 or > 250)
            throw new WorkflowValidationException("Organisation name must contain between 2 and 250 characters.");
        return request with
        {
            OrgUnitType = type,
            Code = code,
            Name = name,
            Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
            ParentOrgUnitId = type == "faculty" ? null : request.ParentOrgUnitId
        };
    }

    private static async Task ValidateOrganisationParentAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        Guid? orgUnitId,
        SaveOrganisationUnitRequest request,
        CancellationToken cancellationToken)
    {
        if (request.OrgUnitType == "faculty") return;
        if (!request.ParentOrgUnitId.HasValue)
            throw new WorkflowValidationException("A sub-team must belong to a faculty.");
        if (orgUnitId == request.ParentOrgUnitId)
            throw new WorkflowValidationException("An organisation unit cannot be its own parent.");
        if (!await ScalarExistsAsync(
            connection, transaction,
            "SELECT 1 FROM org.org_units WHERE id = @id AND org_unit_type = N'faculty' AND is_active = 1 AND archived_at IS NULL;",
            command => command.Parameters.AddWithValue("@id", request.ParentOrgUnitId.Value), cancellationToken))
            throw new WorkflowValidationException("Select an active faculty for this sub-team.");
    }

    private static async Task<OrganisationUnitRow?> ReadOrganisationUnitAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        Guid orgUnitId,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            "SELECT id, parent_org_unit_id, org_unit_type, code, name, description, is_active FROM org.org_units WHERE id = @id AND archived_at IS NULL;",
            connection, (SqlTransaction)transaction);
        command.Parameters.AddWithValue("@id", orgUnitId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken)
            ? new OrganisationUnitRow(reader.GetGuid(0), GetGuidOrNull(reader, 1), reader.GetString(2), reader.GetString(3),
                reader.GetString(4), GetStringOrNull(reader, 5), reader.GetBoolean(6))
            : null;
    }

    private sealed record OrganisationUnitRow(Guid Id, Guid? ParentOrgUnitId, string OrgUnitType, string Code, string Name, string? Description, bool IsActive);
    private sealed record OrganisationImpactRow(Guid Id, int ActiveMemberships, int ActiveLeaderships, int ActivePermissionScopes, int ChildUnits, int HistoricalRecords, int DraftRecords, int OpenActions);
    private sealed record MembershipImpactRow(Guid MembershipId, Guid StaffId, string StaffName, string OrgUnitCode, bool IsPrimary, int PermissionScopes, int DirectReports, int AssignedOpenActions, int DraftRecords, int ActiveReviews);
}
