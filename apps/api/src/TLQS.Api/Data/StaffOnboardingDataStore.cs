using System.Text.Json;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Identity;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    public async Task<StaffOnboardingOptionsSummary> GetStaffOnboardingOptionsAsync(
        CancellationToken cancellationToken)
    {
        var units = await GetOrgUnitsAsync(cancellationToken);
        return new StaffOnboardingOptionsSummary(
            units.Where(unit => unit.IsActive && unit.OrgUnitType == "faculty")
                .OrderBy(unit => unit.Name)
                .ToArray(),
            units.Where(unit => unit.IsActive && unit.OrgUnitType == "team" && unit.ParentOrgUnitId.HasValue)
                .OrderBy(unit => unit.Name)
                .ToArray(),
            StaffOnboardingRules.Categories
                .Select(option => new StaffOnboardingCategorySummary(option.Key, option.Name, option.DisplayOrder))
                .ToArray());
    }

    public async Task<CurrentUser> CompleteStaffOnboardingAsync(
        CompleteStaffOnboardingRequest request,
        string email,
        string displayName,
        string providerSubjectId,
        Guid tenantId,
        string provider,
        CancellationToken cancellationToken)
    {
        var normalizedEmail = email.Trim().ToLowerInvariant();
        var normalizedDisplayName = displayName.Trim();
        if (string.IsNullOrWhiteSpace(normalizedEmail) || normalizedEmail.Length > 320)
        {
            throw new WorkflowValidationException("Your Microsoft account did not provide a valid email address.");
        }
        if (string.IsNullOrWhiteSpace(normalizedDisplayName) || normalizedDisplayName.Length > 220)
        {
            throw new WorkflowValidationException("Your Microsoft account did not provide a valid display name.");
        }
        if (!Guid.TryParse(providerSubjectId, out var providerObjectId))
        {
            throw new WorkflowValidationException("Your Microsoft account did not provide a valid Entra object ID.");
        }

        string category;
        try
        {
            category = StaffOnboardingRules.NormalizeCategory(request.StaffCategory);
        }
        catch (ArgumentOutOfRangeException exception)
        {
            throw new WorkflowValidationException(exception.Message);
        }
        var roleKey = StaffOnboardingRules.InitialRoleKeyFor(category);

        // Identity lookups only resolve Entra identities, so a local test
        // sign-in is looked up by email and never records an Entra identity.
        var isEntra = string.Equals(provider, "entra", StringComparison.Ordinal);
        var entraSubjectId = isEntra ? providerObjectId.ToString() : null;
        Guid? entraTenantId = isEntra ? tenantId : null;

        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            await using (var hierarchyCommand = new SqlCommand(
                """
                SELECT COUNT_BIG(*)
                FROM org.org_units team
                JOIN org.org_units faculty ON faculty.id = team.parent_org_unit_id
                WHERE faculty.id = @facultyId
                  AND faculty.org_unit_type = N'faculty'
                  AND faculty.is_active = 1
                  AND faculty.archived_at IS NULL
                  AND team.id = @teamId
                  AND team.org_unit_type = N'team'
                  AND team.is_active = 1
                  AND team.archived_at IS NULL;
                """,
                connection,
                (SqlTransaction)transaction))
            {
                hierarchyCommand.Parameters.AddWithValue("@facultyId", request.FacultyOrgUnitId);
                hierarchyCommand.Parameters.AddWithValue("@teamId", request.TeamOrgUnitId);
                if (Convert.ToInt64(await hierarchyCommand.ExecuteScalarAsync(cancellationToken)) != 1)
                {
                    throw new WorkflowValidationException("Select an active team within the selected faculty.");
                }
            }

            await using (var existingCommand = new SqlCommand(
                """
                SELECT COUNT_BIG(*)
                FROM people.staff staff
                LEFT JOIN auth.user_accounts account ON account.staff_id = staff.id
                LEFT JOIN auth.auth_identities provider_identity ON provider_identity.user_account_id = account.id
                    AND provider_identity.provider = @provider
                    AND provider_identity.tenant_id = @tenantId
                    AND provider_identity.provider_subject_id = @providerSubjectId
                WHERE staff.email = @email OR provider_identity.id IS NOT NULL;
                """,
                connection,
                (SqlTransaction)transaction))
            {
                existingCommand.Parameters.AddWithValue("@tenantId", tenantId);
                existingCommand.Parameters.AddWithValue("@provider", provider);
                existingCommand.Parameters.AddWithValue("@providerSubjectId", providerObjectId.ToString());
                existingCommand.Parameters.AddWithValue("@email", normalizedEmail);
                if (Convert.ToInt64(await existingCommand.ExecuteScalarAsync(cancellationToken)) > 0)
                {
                    throw new WorkflowValidationException("This Microsoft account is already linked to a staff record. Refresh the page or contact an administrator.");
                }
            }

            Guid roleId;
            await using (var roleCommand = new SqlCommand(
                "SELECT id FROM auth.roles WHERE role_key = @roleKey AND is_active = 1 AND archived_at IS NULL;",
                connection,
                (SqlTransaction)transaction))
            {
                roleCommand.Parameters.AddWithValue("@roleKey", roleKey);
                roleId = (Guid)(await roleCommand.ExecuteScalarAsync(cancellationToken)
                    ?? throw new WorkflowValidationException("The selected staff category has not been configured."));
            }

            var staffId = Guid.NewGuid();
            var userAccountId = Guid.NewGuid();
            var externalId = $"ENTRA_{providerObjectId:N}";

            await using (var createCommand = new SqlCommand(
                """
                INSERT INTO people.staff (
                    id, external_id, display_name, email, primary_org_unit_id,
                    account_status, staff_category, onboarding_source, onboarded_at
                )
                VALUES (
                    @staffId, @externalId, @displayName, @email, @teamId,
                    N'active', @staffCategory, N'self_service', sysutcdatetime()
                );

                INSERT INTO auth.user_accounts (id, staff_id, account_status, is_disabled, last_login_at)
                VALUES (@userAccountId, @staffId, N'active', 0, sysutcdatetime());

                INSERT INTO auth.auth_identities (
                    user_account_id, provider, tenant_id, provider_subject_id, email_claim
                )
                VALUES (
                    @userAccountId, @provider, @tenantId, @providerSubjectId, @email
                );

                INSERT INTO auth.user_roles (
                    user_account_id, role_id, active_from, assignment_source
                )
                VALUES (
                    @userAccountId, @roleId, sysutcdatetime(), N'self_service'
                );

                INSERT INTO auth.access_scopes (
                    user_account_id, scope_type, staff_id, is_active, assignment_source
                )
                VALUES (
                    @userAccountId, N'self', @staffId, 1, N'self_service'
                );

                INSERT INTO org.staff_org_memberships (
                    staff_id, org_unit_id, membership_type, is_primary, active_from,
                    created_by_user_account_id, assignment_source
                )
                VALUES (
                    @staffId, @teamId, N'member', 1, CONVERT(date, sysutcdatetime()),
                    @userAccountId, N'self_service'
                );
                """,
                connection,
                (SqlTransaction)transaction))
            {
                createCommand.Parameters.AddWithValue("@staffId", staffId);
                createCommand.Parameters.AddWithValue("@userAccountId", userAccountId);
                createCommand.Parameters.AddWithValue("@externalId", externalId);
                createCommand.Parameters.AddWithValue("@displayName", normalizedDisplayName);
                createCommand.Parameters.AddWithValue("@email", normalizedEmail);
                createCommand.Parameters.AddWithValue("@facultyId", request.FacultyOrgUnitId);
                createCommand.Parameters.AddWithValue("@teamId", request.TeamOrgUnitId);
                createCommand.Parameters.AddWithValue("@staffCategory", category);
                createCommand.Parameters.AddWithValue("@tenantId", tenantId);
                createCommand.Parameters.AddWithValue("@provider", provider);
                createCommand.Parameters.AddWithValue("@providerSubjectId", providerObjectId.ToString());
                createCommand.Parameters.AddWithValue("@roleId", roleId);
                await createCommand.ExecuteNonQueryAsync(cancellationToken);
            }

            await WriteAuditAsync(
                connection,
                transaction,
                userAccountId,
                null,
                "staff",
                staffId,
                "staff.self_onboarded",
                $"{normalizedDisplayName} completed trusted self-onboarding.",
                null,
                JsonSerializer.Serialize(new
                {
                    staffId,
                    userAccountId,
                    request.FacultyOrgUnitId,
                    request.TeamOrgUnitId,
                    staffCategory = category,
                    initialRole = roleKey,
                    source = "self_service"
                }),
                cancellationToken);

            await transaction.CommitAsync(cancellationToken);
        }
        catch (SqlException exception) when (exception.Number is 2601 or 2627)
        {
            await transaction.RollbackAsync(cancellationToken);
            var existing = await GetCurrentUserAsync(
                normalizedEmail, entraSubjectId, entraTenantId, cancellationToken);
            if (existing.UserAccountId.HasValue)
            {
                return existing;
            }
            throw new WorkflowValidationException("This Microsoft account has already been registered.");
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }

        return await GetCurrentUserAsync(
            normalizedEmail,
            entraSubjectId,
            entraTenantId,
            cancellationToken);
    }
}

