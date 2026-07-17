using System.Security.Claims;
using TLQS.Api.Data;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.V1;

public static class PlatformOperationsEndpoints
{
    public static IEndpointRouteBuilder MapPlatformOperationsEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api/v1").RequireAuthorization();

        api.MapPost("/admin/organisation/units", async (
            SaveOrganisationUnitRequest request,
            ClaimsPrincipal principal,
            SqlFoundationDataStore store,
            CancellationToken cancellationToken) =>
        {
            var user = await ResolveCurrentUserAsync(principal, store, cancellationToken);
            if (!AdministrationAccessPolicy.CanManageOrganisation(user)) return Results.Forbid();
            var id = await store.CreateOrganisationUnitAsync(request, user, cancellationToken);
            return Results.Created($"/api/v1/admin/organisation/units/{id}", new { Id = id });
        });

        api.MapPut("/admin/organisation/units/{orgUnitId:guid}", async (
            Guid orgUnitId,
            SaveOrganisationUnitRequest request,
            ClaimsPrincipal principal,
            SqlFoundationDataStore store,
            CancellationToken cancellationToken) =>
        {
            var user = await ResolveCurrentUserAsync(principal, store, cancellationToken);
            if (!AdministrationAccessPolicy.CanManageOrganisation(user)) return Results.Forbid();
            return await store.UpdateOrganisationUnitAsync(orgUnitId, request, user, cancellationToken)
                ? Results.NoContent()
                : Results.NotFound();
        });

        api.MapGet("/admin/organisation/units/{orgUnitId:guid}/impact", async (
            Guid orgUnitId,
            ClaimsPrincipal principal,
            SqlFoundationDataStore store,
            CancellationToken cancellationToken) =>
        {
            var user = await ResolveCurrentUserAsync(principal, store, cancellationToken);
            if (!AdministrationAccessPolicy.CanManageOrganisation(user)) return Results.Forbid();
            var impact = await store.GetOrganisationChangeImpactAsync(orgUnitId, cancellationToken);
            return impact is null ? Results.NotFound() : Results.Ok(impact);
        });

        api.MapPost("/admin/organisation/units/{orgUnitId:guid}/status", async (
            Guid orgUnitId,
            SetOrganisationUnitStatusRequest request,
            ClaimsPrincipal principal,
            SqlFoundationDataStore store,
            CancellationToken cancellationToken) =>
        {
            var user = await ResolveCurrentUserAsync(principal, store, cancellationToken);
            if (!AdministrationAccessPolicy.CanManageOrganisation(user)) return Results.Forbid();
            return await store.SetOrganisationUnitStatusAsync(orgUnitId, request, user, cancellationToken)
                ? Results.NoContent()
                : Results.NotFound();
        });

        api.MapGet("/admin/organisation/staff/{staffId:guid}/memberships/{membershipId:guid}/impact", async (
            Guid staffId,
            Guid membershipId,
            ClaimsPrincipal principal,
            SqlFoundationDataStore store,
            CancellationToken cancellationToken) =>
        {
            var user = await ResolveCurrentUserAsync(principal, store, cancellationToken);
            if (!AdministrationAccessPolicy.CanManageOrganisation(user)) return Results.Forbid();
            var impact = await store.GetMembershipChangeImpactAsync(staffId, membershipId, cancellationToken);
            return impact is null ? Results.NotFound() : Results.Ok(impact);
        });

        api.MapGet("/admin/organisation/migration-reviews", async (
            ClaimsPrincipal principal,
            SqlFoundationDataStore store,
            CancellationToken cancellationToken) =>
        {
            var user = await ResolveCurrentUserAsync(principal, store, cancellationToken);
            return AdministrationAccessPolicy.CanManageOrganisation(user)
                ? Results.Ok(await store.GetOrganisationMigrationReviewsAsync(cancellationToken))
                : Results.Forbid();
        });

        api.MapGet("/staff-profiles/{staffId:guid}/section-summary", async (
            Guid staffId,
            string? academicYear,
            ClaimsPrincipal principal,
            SqlFoundationDataStore store,
            CancellationToken cancellationToken) =>
        {
            var user = await ResolveCurrentUserAsync(principal, store, cancellationToken);
            if (!await CanViewStaffProfileAsync(user, staffId, store, cancellationToken)) return Results.Forbid();
            return Results.Ok(await store.GetStaffProfileSectionSummaryAsync(
                staffId, academicYear ?? SqlFoundationDataStore.GetCurrentAcademicYear(), cancellationToken));
        });

        api.MapGet("/staff-profiles/{staffId:guid}/reflections", async (
            Guid staffId, string? academicYear, int page, int pageSize,
            ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var user = await ResolveCurrentUserAsync(principal, store, cancellationToken);
            if (!await CanViewStaffProfileAsync(user, staffId, store, cancellationToken)) return Results.Forbid();
            return Results.Ok(await store.GetStaffProfileReflectionsPageAsync(
                staffId, academicYear ?? SqlFoundationDataStore.GetCurrentAcademicYear(), page, pageSize, cancellationToken));
        });

        api.MapGet("/staff-profiles/{staffId:guid}/cpd", async (
            Guid staffId, string? academicYear, int page, int pageSize,
            ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var user = await ResolveCurrentUserAsync(principal, store, cancellationToken);
            if (!await CanViewStaffProfileAsync(user, staffId, store, cancellationToken)) return Results.Forbid();
            return Results.Ok(await store.GetStaffProfileCpdPageAsync(
                staffId, academicYear ?? SqlFoundationDataStore.GetCurrentAcademicYear(), page, pageSize, cancellationToken));
        });

        api.MapGet("/staff-profiles/{staffId:guid}/coaching", async (
            Guid staffId, string? academicYear, int page, int pageSize,
            ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var user = await ResolveCurrentUserAsync(principal, store, cancellationToken);
            if (!await CanViewStaffProfileAsync(user, staffId, store, cancellationToken)) return Results.Forbid();
            return Results.Ok(await store.GetStaffProfileCoachingPageAsync(
                staffId, academicYear ?? SqlFoundationDataStore.GetCurrentAcademicYear(), page, pageSize, cancellationToken));
        });

        api.MapGet("/staff-profiles/{staffId:guid}/actions", async (
            Guid staffId, string? academicYear, int page, int pageSize,
            ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var user = await ResolveCurrentUserAsync(principal, store, cancellationToken);
            if (!await CanViewStaffProfileAsync(user, staffId, store, cancellationToken)) return Results.Forbid();
            return Results.Ok(await store.GetStaffProfileActionsPageAsync(
                staffId, academicYear ?? SqlFoundationDataStore.GetCurrentAcademicYear(), page, pageSize, cancellationToken));
        });

        return app;
    }

    internal static Task<CurrentUser> ResolveCurrentUserAsync(
        ClaimsPrincipal principal,
        SqlFoundationDataStore store,
        CancellationToken cancellationToken)
    {
        var email = principal.FindFirstValue("preferred_username")
            ?? principal.FindFirstValue("email")
            ?? principal.FindFirstValue(ClaimTypes.Email);
        var subjectId = principal.FindFirstValue("oid") ?? principal.FindFirstValue("sub");
        var tenantValue = principal.FindFirstValue("tid");
        Guid? tenantId = Guid.TryParse(tenantValue, out var parsedTenant) ? parsedTenant : null;
        return store.GetCurrentUserAsync(email, subjectId, tenantId, cancellationToken);
    }

    private static async Task<bool> CanViewStaffProfileAsync(
        CurrentUser user,
        Guid staffId,
        SqlFoundationDataStore store,
        CancellationToken cancellationToken) =>
        (user.StaffId.HasValue && user.StaffId.Value == staffId)
        || SqlFoundationDataStore.CanViewAllStaffProfiles(user)
        || (user.HasPermission(PermissionKeys.ReportsViewScoped)
            && await store.IsStaffProfileInScopeAsync(staffId, user, cancellationToken));
}
