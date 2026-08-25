using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using TLQS.Api.Data;
using TLQS.Api.Exports;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.V1;

public static class QaReviewEndpoints
{
    public static IEndpointRouteBuilder MapQaReviewEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api/v1/qa-hub").RequireAuthorization();

        api.MapGet("/summary", async (ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken token) =>
        {
            var user = await CurrentUser(principal, store, token);
            if (!QaReviewPolicy.HasHubPermission(user)) return Results.Forbid();
            var summary = await store.GetQaHubSummaryAsync(user, token);
            return summary.CanAccessHub ? Results.Ok(summary) : Results.Forbid();
        });

        api.MapGet("/activities", async (ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken token) =>
        {
            var user = await CurrentUser(principal, store, token);
            return QaReviewPolicy.HasHubPermission(user)
                ? Results.Ok(await store.GetQaActivityTypesAsync(token))
                : Results.Forbid();
        });

        api.MapGet("/questions", async (Guid? activityTypeId, bool? includeInactive, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken token) =>
        {
            var user = await CurrentUser(principal, store, token);
            return QaReviewPolicy.CanManage(user)
                ? Results.Ok(await store.GetQaQuestionsAsync(activityTypeId, includeInactive ?? false, token))
                : Results.Forbid();
        });

        api.MapPost("/questions", async (SaveQaQuestionRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken token) =>
        {
            var user = await CurrentUser(principal, store, token);
            return QaReviewPolicy.CanManage(user)
                ? Results.Ok(await store.SaveQaQuestionAsync(null, request, user, token))
                : Results.Forbid();
        });

        api.MapPut("/questions/{questionId:guid}", async (Guid questionId, SaveQaQuestionRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken token) =>
        {
            var user = await CurrentUser(principal, store, token);
            return QaReviewPolicy.CanManage(user)
                ? Results.Ok(await store.SaveQaQuestionAsync(questionId, request, user, token))
                : Results.Forbid();
        });

        api.MapPost("/templates/{templateId:guid}/duplicate", async (Guid templateId, DuplicateQaTemplateRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken token) =>
        {
            var user = await CurrentUser(principal, store, token);
            return QaReviewPolicy.CanManage(user)
                ? Results.Ok(await store.DuplicateQaTemplateAsync(templateId, request, user, token))
                : Results.Forbid();
        });

        api.MapPost("/reviews", async (SaveQaReviewRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken token) =>
        {
            var user = await CurrentUser(principal, store, token);
            if (!QaReviewPolicy.CanManage(user)) return Results.Forbid();
            var id = await store.SaveQaReviewAsync(null, request, user, token);
            return Results.Created($"/api/v1/qa-hub/reviews/{id}", new { Id = id });
        });

        api.MapGet("/reviews/{reviewId:guid}", async (Guid reviewId, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken token) =>
        {
            var user = await CurrentUser(principal, store, token);
            if (!QaReviewPolicy.HasHubPermission(user)) return Results.Forbid();
            var review = await store.GetQaReviewAsync(reviewId, user, token);
            return review is null ? Results.NotFound() : Results.Ok(review);
        });

        api.MapPut("/reviews/{reviewId:guid}", async (Guid reviewId, SaveQaReviewRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken token) =>
        {
            var user = await CurrentUser(principal, store, token);
            if (!QaReviewPolicy.CanManage(user)) return Results.Forbid();
            await store.SaveQaReviewAsync(reviewId, request, user, token);
            return Results.Ok(await store.GetQaReviewAsync(reviewId, user, token));
        });

        api.MapPost("/reviews/{reviewId:guid}/{action:regex(^(open|close|reopen|archive)$)}", async (
            Guid reviewId, string action, QaLifecycleRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken token) =>
        {
            var user = await CurrentUser(principal, store, token);
            return QaReviewPolicy.CanManage(user)
                ? Results.Ok(await store.TransitionQaReviewAsync(reviewId, action, request, user, token))
                : Results.Forbid();
        });

        api.MapPost("/reviews/{reviewId:guid}/evidence", async (
            Guid reviewId, SaveQaEvidenceRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken token) =>
        {
            var user = await CurrentUser(principal, store, token);
            if (!QaReviewPolicy.CanSubmitByPermission(user)) return Results.Forbid();
            return Results.Ok(await store.SaveQaEvidenceAsync(reviewId, null, request, false, user, token));
        });

        api.MapPost("/reviews/{reviewId:guid}/evidence/submit", async (
            Guid reviewId, SaveQaEvidenceRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken token) =>
        {
            var user = await CurrentUser(principal, store, token);
            if (!QaReviewPolicy.CanSubmitByPermission(user)) return Results.Forbid();
            return Results.Ok(await store.SaveQaEvidenceAsync(reviewId, null, request, true, user, token));
        });

        api.MapGet("/evidence/{evidenceId:guid}", async (Guid evidenceId, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken token) =>
        {
            var user = await CurrentUser(principal, store, token);
            if (!QaReviewPolicy.HasHubPermission(user)) return Results.Forbid();
            var evidence = await store.GetQaEvidenceAsync(evidenceId, user, token);
            return evidence is null ? Results.NotFound() : Results.Ok(evidence);
        });

        api.MapPut("/reviews/{reviewId:guid}/evidence/{evidenceId:guid}", async (
            Guid reviewId, Guid evidenceId, SaveQaEvidenceRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken token) =>
        {
            var user = await CurrentUser(principal, store, token);
            if (!QaReviewPolicy.CanSubmitByPermission(user)) return Results.Forbid();
            return Results.Ok(await store.SaveQaEvidenceAsync(reviewId, evidenceId, request, false, user, token));
        });

        api.MapPost("/reviews/{reviewId:guid}/evidence/{evidenceId:guid}/submit", async (
            Guid reviewId, Guid evidenceId, SaveQaEvidenceRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken token) =>
        {
            var user = await CurrentUser(principal, store, token);
            if (!QaReviewPolicy.CanSubmitByPermission(user)) return Results.Forbid();
            return Results.Ok(await store.SaveQaEvidenceAsync(reviewId, evidenceId, request, true, user, token));
        });

        api.MapDelete("/evidence/{evidenceId:guid}", async (
            Guid evidenceId, [FromBody] QaReasonRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken token) =>
        {
            var user = await CurrentUser(principal, store, token);
            if (!QaReviewPolicy.CanRemove(user)) return Results.Forbid();
            await store.RemoveQaEvidenceAsync(evidenceId, request.Reason, user, token);
            return Results.NoContent();
        });

        api.MapGet("/reviews/{reviewId:guid}/dashboard", async (
            Guid reviewId, Guid? facultyOrgUnitId, Guid? teamOrgUnitId,
            ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken token) =>
        {
            var user = await CurrentUser(principal, store, token);
            if (!QaReviewPolicy.HasHubPermission(user)) return Results.Forbid();
            if (!await store.CanUseQaDashboardFilterAsync(reviewId, facultyOrgUnitId, teamOrgUnitId, user, token))
                return Results.Forbid();
            var dashboard = await store.GetQaDashboardAsync(reviewId, user, token, facultyOrgUnitId, teamOrgUnitId);
            return dashboard is null ? Results.NotFound() : Results.Ok(dashboard);
        });

        api.MapGet("/reviews/{reviewId:guid}/action-options", async (
            Guid reviewId, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken token) =>
        {
            var user = await CurrentUser(principal, store, token);
            var options = await store.GetQaReviewActionOptionsAsync(reviewId, user, token);
            if (options is null) return Results.NotFound();
            return options.CreationMode is "admin" or "review_owner" ? Results.Ok(options) : Results.Forbid();
        });

        api.MapGet("/action-options", async (
            ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken token) =>
        {
            var user = await CurrentUser(principal, store, token);
            return await store.CanUseQaActionMonitoringAsync(user, token)
                ? Results.Ok(await store.GetQaActionReviewOptionsAsync(user, token))
                : Results.Forbid();
        });

        api.MapGet("/reviews/{reviewId:guid}/actions", async (
            Guid reviewId, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken token) =>
        {
            var user = await CurrentUser(principal, store, token);
            if (!QaReviewPolicy.HasHubPermission(user)) return Results.Forbid();
            var actions = await store.GetQaReviewActionGroupsAsync(reviewId, user, token);
            return actions is null ? Results.NotFound() : Results.Ok(actions);
        });

        api.MapPost("/reviews/{reviewId:guid}/actions", async (
            Guid reviewId, CreateQaActionGroupRequest request,
            ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken token) =>
        {
            var user = await CurrentUser(principal, store, token);
            return Results.Ok(await store.CreateQaActionGroupAsync(reviewId, request, user, token));
        });

        api.MapGet("/actions", async (
            ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken token) =>
        {
            var user = await CurrentUser(principal, store, token);
            return await store.CanUseQaActionMonitoringAsync(user, token)
                ? Results.Ok(await store.GetQaAdminActionGroupsAsync(user, token))
                : Results.Forbid();
        });

        api.MapPost("/actions/{groupId:guid}/review", async (
            Guid groupId, QaActionWorkflowRequest request,
            ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken token) =>
        {
            var user = await CurrentUser(principal, store, token);
            return await store.CanUseQaActionMonitoringAsync(user, token)
                ? Results.Ok(await store.ReviewQaActionGroupAsync(groupId, request, user, token))
                : Results.Forbid();
        });

        api.MapPost("/actions/{groupId:guid}/close", async (
            Guid groupId, QaActionWorkflowRequest request,
            ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken token) =>
        {
            var user = await CurrentUser(principal, store, token);
            return await store.CanUseQaActionMonitoringAsync(user, token)
                ? Results.Ok(await store.CloseQaActionGroupAsync(groupId, request, user, token))
                : Results.Forbid();
        });

        api.MapGet("/reviews/{reviewId:guid}/audit", async (Guid reviewId, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken token) =>
        {
            var user = await CurrentUser(principal, store, token);
            if (!QaReviewPolicy.HasHubPermission(user)) return Results.Forbid();
            var audit = await store.GetQaAuditAsync(reviewId, user, token);
            return audit is null ? Results.NotFound() : Results.Ok(audit);
        });

        api.MapGet("/reviews/{reviewId:guid}/report.xlsx", async (
            Guid reviewId, Guid? facultyOrgUnitId, Guid? teamOrgUnitId,
            ClaimsPrincipal principal, SqlFoundationDataStore store, ExcelExportService exporter, CancellationToken token) =>
        {
            var user = await CurrentUser(principal, store, token);
            if (!QaReviewPolicy.HasHubPermission(user)) return Results.Forbid();
            if (!await store.CanUseQaDashboardFilterAsync(reviewId, facultyOrgUnitId, teamOrgUnitId, user, token))
                return Results.Forbid();
            var workbook = await store.GetQaExportAsync(reviewId, user, token, facultyOrgUnitId, teamOrgUnitId);
            if (workbook is null) return Results.NotFound();
            var file = exporter.CreateWorkbook(workbook);
            return Results.File(file.Content, file.ContentType, file.FileName);
        }).RequireRateLimiting("sensitive");

        api.MapGet("/reviews/{reviewId:guid}/report.pdf", async (
            Guid reviewId, Guid? facultyOrgUnitId, Guid? teamOrgUnitId,
            ClaimsPrincipal principal, SqlFoundationDataStore store, QaPdfReportService exporter, CancellationToken token) =>
        {
            var user = await CurrentUser(principal, store, token);
            if (!QaReviewPolicy.HasHubPermission(user)) return Results.Forbid();
            if (!await store.CanUseQaDashboardFilterAsync(reviewId, facultyOrgUnitId, teamOrgUnitId, user, token))
                return Results.Forbid();
            var report = await store.GetQaReportAsync(reviewId, user, token, facultyOrgUnitId, teamOrgUnitId);
            if (report is null) return Results.NotFound();
            var file = exporter.CreateReport(report);
            return Results.File(file.Content, file.ContentType, file.FileName);
        }).RequireRateLimiting("sensitive");

        // Retain the original route for bookmarked links while serving the new dashboard-led workbook.
        api.MapGet("/reviews/{reviewId:guid}/export.xlsx", async (
            Guid reviewId, ClaimsPrincipal principal, SqlFoundationDataStore store, ExcelExportService exporter, CancellationToken token) =>
        {
            var user = await CurrentUser(principal, store, token);
            if (!QaReviewPolicy.HasHubPermission(user)) return Results.Forbid();
            var workbook = await store.GetQaExportAsync(reviewId, user, token);
            if (workbook is null) return Results.NotFound();
            var file = exporter.CreateWorkbook(workbook);
            return Results.File(file.Content, file.ContentType, file.FileName);
        }).RequireRateLimiting("sensitive");

        return app;
    }

    private static Task<CurrentUser> CurrentUser(ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken token) =>
        PlatformOperationsEndpoints.ResolveCurrentUserAsync(principal, store, token);
}
