using System.Security.Claims;
using TLQS.Api.Data;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.V1;

public static partial class FoundationEndpoints
{
    private static void MapReportingExplorerEndpoints(RouteGroupBuilder api)
    {
        api.MapGet("/reports/elevate-status-staff", async (string academicYear, ClaimsPrincipal principal,
            SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var user = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!CanReadReportingData(user)) return Results.Forbid();
            return Results.Ok(await store.GetElevateStatusStaffDashboardAsync(academicYear, user, cancellationToken));
        });

        api.MapGet("/reports/report-record-data", async (string academicYear, string dashboardKey,
            string? facultyCode, string? teamCode, DateOnly? fromDate, DateOnly? toDate, string? status,
            string? deliveryAreaKey, string? dimensionLabel,
            ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var user = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!DashboardRecordDataBuilder.TryGetModule(dashboardKey, out var module))
                return Results.BadRequest(new { Message = "Select a supported form dashboard." });
            if (!DashboardRecordDataBuilder.CanRead(user, dashboardKey)) return Results.Forbid();
            try
            {
                var filter = new ExportFilter(academicYear, facultyCode, teamCode, fromDate, toDate,
                    null, null, status, null, deliveryAreaKey, dimensionLabel);
                return Results.Ok(await store.GetDashboardRecordDataAsync(dashboardKey, module!, filter, user, cancellationToken));
            }
            catch (WorkflowValidationException exception)
            {
                return Results.BadRequest(new { Message = exception.Message });
            }
        });

        api.MapGet("/qa-hub/reviews/{reviewId:guid}/report-data", async (Guid reviewId,
            Guid? facultyOrgUnitId, Guid? teamOrgUnitId, ClaimsPrincipal principal,
            SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var user = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!QaReviewPolicy.HasHubPermission(user)) return Results.Forbid();
            if (!await store.CanUseQaDashboardFilterAsync(reviewId, facultyOrgUnitId, teamOrgUnitId, user, cancellationToken))
                return Results.Forbid();
            try
            {
                var workbook = await store.GetQaExportAsync(reviewId, user, cancellationToken, facultyOrgUnitId, teamOrgUnitId);
                return workbook is null ? Results.NotFound() : Results.Ok(DashboardRecordDataBuilder.Build("qa_review", workbook));
            }
            catch (UnauthorizedAccessException exception)
            {
                return Results.Json(new { Message = exception.Message }, statusCode: StatusCodes.Status403Forbidden);
            }
        });
    }

    private static bool CanReadReportingData(CurrentUser user) =>
        user.HasPermission(PermissionKeys.ReportsViewAll) || user.HasPermission(PermissionKeys.ReportsViewScoped);

}
