using System.Data;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Mvc;
using TLQS.Api.Data;
using TLQS.Api.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.V1;

public static partial class FoundationEndpoints
{
    private static void MapAdminCsvImportEndpoints(RouteGroupBuilder api)
    {
        var imports = api.MapGroup("/admin/csv-imports").RequireRateLimiting("sensitive");
        imports.MapGet("/{kind}", async (string kind, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken token) =>
        {
            var user = await GetCurrentUserAsync(principal, store, token);
            return AdminCsvAccess.CanUse(user, kind) ? Results.Ok(await store.GetAdminCsvDefinitionAsync(kind, user, token)) : Results.Forbid();
        });
        imports.MapGet("/{kind}/template", async (string kind, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken token) =>
        {
            var user = await GetCurrentUserAsync(principal, store, token);
            if (!AdminCsvAccess.CanUse(user, kind)) return Results.Forbid();
            var definition = await store.GetAdminCsvDefinitionAsync(kind, user, token);
            return Results.File(Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(string.Join(',', definition.Columns.Select(column => column.Key)) + "\r\n")).ToArray(),
                "text/csv; charset=utf-8", $"i-Elevate-{kind}-template.csv");
        });
        imports.MapPost("/{kind}/preview", async (string kind, AdminCsvImportRequest request, ClaimsPrincipal principal,
            SqlFoundationDataStore store, IDataProtectionProvider protection, CancellationToken token) =>
        {
            var user = await GetCurrentUserAsync(principal, store, token);
            if (!AdminCsvAccess.CanUse(user, kind)) return Results.Forbid();
            try
            {
                var plan = await store.PreviewAdminCsvAsync(kind, request.Csv, user, token);
                var preview = SqlFoundationDataStore.CsvPreview(plan, AdminCsvReader.Parse(request.Csv).Rows.Count);
                return Results.Ok(preview with { PreviewToken = preview.CanImport ? AdminCsvPreviewTokens.Create(protection, user, kind, request.Csv, SqlFoundationDataStore.AdminCsvPlanFingerprint(plan)) : null });
            }
            catch (WorkflowValidationException exception) { return Results.BadRequest(new { Message = exception.Message }); }
        }).WithMetadata(new RequestSizeLimitAttribute(2 * AdminCsvReader.MaximumBytes));
        imports.MapPost("/{kind}/apply", async (string kind, AdminCsvImportRequest request, ClaimsPrincipal principal,
            SqlFoundationDataStore store, IDataProtectionProvider protection, CancellationToken token) =>
        {
            var user = await GetCurrentUserAsync(principal, store, token);
            if (!AdminCsvAccess.CanUse(user, kind)) return Results.Forbid();
            try
            {
                _ = AdminCsvReader.Parse(request.Csv);
                var fingerprint = AdminCsvPreviewTokens.Read(protection, user, kind, request.Csv, request.PreviewToken);
                return Results.Ok(await store.ApplyAdminCsvAsync(kind, request.Csv, fingerprint, user, token));
            }
            catch (DBConcurrencyException exception) { return Results.Conflict(new { Message = exception.Message }); }
            catch (Microsoft.Data.SqlClient.SqlException exception) when (exception.Number is 2601 or 2627 or 1205)
            { return Results.Conflict(new { Message = "A source reference or catalogue entry changed during import. Nothing was imported. Preview the file again." }); }
            catch (WorkflowValidationException exception) { return Results.BadRequest(new { Message = exception.Message }); }
        }).WithMetadata(new RequestSizeLimitAttribute(2 * AdminCsvReader.MaximumBytes));
    }
}
