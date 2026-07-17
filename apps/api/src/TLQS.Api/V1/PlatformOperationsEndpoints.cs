using System.Security.Claims;
using Microsoft.AspNetCore.RateLimiting;
using TLQS.Api.Messaging;
using TLQS.Api.Exports;
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

        api.MapGet("/admin/messaging/parameters", async (
            ClaimsPrincipal principal,
            SqlFoundationDataStore store,
            CancellationToken cancellationToken) =>
        {
            var user = await ResolveCurrentUserAsync(principal, store, cancellationToken);
            return AdministrationAccessPolicy.CanManageMessaging(user)
                ? Results.Ok(MessageTemplatePolicy.Parameters)
                : Results.Forbid();
        });

        api.MapGet("/admin/messaging/templates", async (
            bool includeDeleted,
            ClaimsPrincipal principal,
            SqlFoundationDataStore store,
            CancellationToken cancellationToken) =>
        {
            var user = await ResolveCurrentUserAsync(principal, store, cancellationToken);
            return AdministrationAccessPolicy.CanManageMessaging(user)
                ? Results.Ok(await store.GetMessageTemplatesAsync(includeDeleted, cancellationToken))
                : Results.Forbid();
        });

        api.MapGet("/admin/messaging/templates/{templateId:guid}/versions", async (
            Guid templateId,
            ClaimsPrincipal principal,
            SqlFoundationDataStore store,
            CancellationToken cancellationToken) =>
        {
            var user = await ResolveCurrentUserAsync(principal, store, cancellationToken);
            return AdministrationAccessPolicy.CanManageMessaging(user)
                ? Results.Ok(await store.GetMessageTemplateVersionsAsync(templateId, cancellationToken))
                : Results.Forbid();
        });

        api.MapPost("/admin/messaging/templates", async (
            SaveMessageTemplateRequest request,
            ClaimsPrincipal principal,
            SqlFoundationDataStore store,
            CancellationToken cancellationToken) =>
        {
            var user = await ResolveCurrentUserAsync(principal, store, cancellationToken);
            if (!AdministrationAccessPolicy.CanManageMessaging(user)) return Results.Forbid();
            var id = await store.CreateMessageTemplateAsync(request, user, cancellationToken);
            return Results.Created($"/api/v1/admin/messaging/templates/{id}", new { Id = id });
        }).RequireRateLimiting("sensitive");

        api.MapPut("/admin/messaging/templates/{templateId:guid}", async (
            Guid templateId,
            SaveMessageTemplateRequest request,
            ClaimsPrincipal principal,
            SqlFoundationDataStore store,
            CancellationToken cancellationToken) =>
        {
            var user = await ResolveCurrentUserAsync(principal, store, cancellationToken);
            if (!AdministrationAccessPolicy.CanManageMessaging(user)) return Results.Forbid();
            return await store.UpdateMessageTemplateAsync(templateId, request, user, cancellationToken)
                ? Results.NoContent() : Results.NotFound();
        }).RequireRateLimiting("sensitive");

        api.MapPost("/admin/messaging/templates/{templateId:guid}/duplicate", async (
            Guid templateId,
            DuplicateMessageTemplateRequest request,
            ClaimsPrincipal principal,
            SqlFoundationDataStore store,
            CancellationToken cancellationToken) =>
        {
            var user = await ResolveCurrentUserAsync(principal, store, cancellationToken);
            if (!AdministrationAccessPolicy.CanManageMessaging(user)) return Results.Forbid();
            var id = await store.DuplicateMessageTemplateAsync(templateId, request.MessageKey, request.Name, user, cancellationToken);
            return id.HasValue ? Results.Ok(new { Id = id.Value }) : Results.NotFound();
        }).RequireRateLimiting("sensitive");

        api.MapPost("/admin/messaging/templates/preview", async (
            SaveMessageTemplateRequest request,
            ClaimsPrincipal principal,
            SqlFoundationDataStore store,
            CancellationToken cancellationToken) =>
        {
            var user = await ResolveCurrentUserAsync(principal, store, cancellationToken);
            return AdministrationAccessPolicy.CanManageMessaging(user)
                ? Results.Ok(store.PreviewMessageTemplate(request, null))
                : Results.Forbid();
        }).RequireRateLimiting("sensitive");

        api.MapPost("/admin/messaging/templates/{templateId:guid}/status", async (
            Guid templateId,
            SetMessageTemplateStatusRequest request,
            ClaimsPrincipal principal,
            SqlFoundationDataStore store,
            CancellationToken cancellationToken) =>
        {
            var user = await ResolveCurrentUserAsync(principal, store, cancellationToken);
            if (!AdministrationAccessPolicy.CanManageMessaging(user)) return Results.Forbid();
            return await store.SetMessageTemplateStatusAsync(templateId, request, user, cancellationToken)
                ? Results.NoContent() : Results.NotFound();
        }).RequireRateLimiting("sensitive");

        api.MapPost("/admin/messaging/templates/{templateId:guid}/delete", async (
            Guid templateId,
            SetMessageDeliveryStatusRequest request,
            ClaimsPrincipal principal,
            SqlFoundationDataStore store,
            CancellationToken cancellationToken) =>
        {
            var user = await ResolveCurrentUserAsync(principal, store, cancellationToken);
            if (!AdministrationAccessPolicy.CanManageMessaging(user)) return Results.Forbid();
            return await store.SoftDeleteMessageTemplateAsync(templateId, request.Reason, user, cancellationToken)
                ? Results.NoContent() : Results.NotFound();
        }).RequireRateLimiting("sensitive");

        api.MapPost("/admin/messaging/templates/{templateId:guid}/test", async (
            Guid templateId,
            SendTestMessageRequest request,
            ClaimsPrincipal principal,
            SqlFoundationDataStore store,
            CancellationToken cancellationToken) =>
        {
            var user = await ResolveCurrentUserAsync(principal, store, cancellationToken);
            if (!user.HasPermission(PermissionKeys.MessagingSend)
                && !AdministrationAccessPolicy.CanManageMessaging(user)) return Results.Forbid();
            var id = await store.QueueTestMessageAsync(templateId, request, user, cancellationToken);
            return id.HasValue ? Results.Accepted($"/api/v1/admin/messaging/deliveries/{id}", new { Id = id.Value }) : Results.NotFound();
        }).RequireRateLimiting("sensitive");

        api.MapGet("/admin/messaging/deliveries", async (
            int take,
            ClaimsPrincipal principal,
            SqlFoundationDataStore store,
            CancellationToken cancellationToken) =>
        {
            var user = await ResolveCurrentUserAsync(principal, store, cancellationToken);
            return AdministrationAccessPolicy.CanManageMessaging(user)
                ? Results.Ok(await store.GetMessageDeliveriesAsync(take <= 0 ? 100 : take, cancellationToken))
                : Results.Forbid();
        });

        api.MapPost("/admin/messaging/deliveries/{deliveryId:guid}/retry", async (
            Guid deliveryId,
            RetryMessageRequest request,
            ClaimsPrincipal principal,
            SqlFoundationDataStore store,
            CancellationToken cancellationToken) =>
        {
            var user = await ResolveCurrentUserAsync(principal, store, cancellationToken);
            if (!user.HasPermission(PermissionKeys.MessagingSend)) return Results.Forbid();
            return await store.RetryMessageAsync(deliveryId, request.Reason, user, cancellationToken)
                ? Results.NoContent() : Results.Conflict(new { Message = "Only failed or cancelled messages can be retried." });
        }).RequireRateLimiting("sensitive");

        api.MapPost("/admin/messaging/deliveries/{deliveryId:guid}/cancel", async (
            Guid deliveryId,
            SetMessageDeliveryStatusRequest request,
            ClaimsPrincipal principal,
            SqlFoundationDataStore store,
            CancellationToken cancellationToken) =>
        {
            var user = await ResolveCurrentUserAsync(principal, store, cancellationToken);
            if (!user.HasPermission(PermissionKeys.MessagingSend)) return Results.Forbid();
            return await store.CancelMessageAsync(deliveryId, request.Reason, user, cancellationToken)
                ? Results.NoContent() : Results.Conflict(new { Message = "That message can no longer be cancelled." });
        }).RequireRateLimiting("sensitive");

        api.MapGet("/exports/excel/{moduleKey}", async (
            string moduleKey,
            string? academicYear,
            string? facultyCode,
            string? teamCode,
            DateOnly? fromDate,
            DateOnly? toDate,
            Guid? staffId,
            Guid? reviewerId,
            string? status,
            string? recordType,
            ClaimsPrincipal principal,
            SqlFoundationDataStore store,
            ExcelExportService exporter,
            CancellationToken cancellationToken) =>
        {
            var user = await ResolveCurrentUserAsync(principal, store, cancellationToken);
            if (!user.HasPermission(PermissionKeys.ExportsCreate)) return Results.Forbid();
            var filter = new ExportFilter(
                academicYear, facultyCode, teamCode, fromDate, toDate,
                staffId, reviewerId, status, recordType);
            var workbook = await store.GetExportWorkbookAsync(moduleKey, filter, user, cancellationToken);
            var result = exporter.CreateWorkbook(workbook);
            await store.RecordExportAuditAsync(moduleKey, "xlsx", filter, user, cancellationToken);
            return Results.File(result.Content, result.ContentType, result.FileName);
        }).RequireRateLimiting("sensitive");

        api.MapGet("/exports/word/records/{recordId:guid}", async (
            Guid recordId,
            ClaimsPrincipal principal,
            SqlFoundationDataStore store,
            WordExportService exporter,
            CancellationToken cancellationToken) =>
        {
            var user = await ResolveCurrentUserAsync(principal, store, cancellationToken);
            if (!user.HasPermission(PermissionKeys.ExportsCreate)) return Results.Forbid();
            var report = await store.GetRecordReportAsync(recordId, user, cancellationToken);
            if (report is null) return Results.NotFound();
            var result = exporter.CreateRecordReport(report);
            await store.RecordExportAuditAsync(report.RecordType, "docx", new ExportFilter(null, null, null, null, null, null, null, null, null), user, cancellationToken);
            return Results.File(result.Content, result.ContentType, result.FileName);
        }).RequireRateLimiting("sensitive");

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
