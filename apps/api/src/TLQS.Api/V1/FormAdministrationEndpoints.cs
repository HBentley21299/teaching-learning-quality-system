using System.Data;
using System.Security.Claims;
using TLQS.Api.Data;
using TLQS.Application.Security;

namespace TLQS.Api.V1;

public static partial class FoundationEndpoints
{
    private static void MapFormAdministrationEndpoints(RouteGroupBuilder api)
    {
        api.MapGet("/form-content/{formKey}", async (string formKey, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var user = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!user.UserAccountId.HasValue) return Results.Forbid();
            var result = await store.GetWorkflowFormContentAsync(formKey, cancellationToken);
            return result is null ? Results.NotFound() : Results.Ok(result);
        });
        api.MapGet("/admin/forms/content", async (ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var user = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!user.HasPermission(PermissionKeys.FormsManage)) return Results.Forbid();
            return Results.Ok(await store.GetWorkflowFormContentAdministrationAsync(user, cancellationToken));
        });
        api.MapPut("/admin/forms/content/{formKey}", async (string formKey, SaveWorkflowFormContentRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var user = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!user.HasPermission(PermissionKeys.FormsManage)) return Results.Forbid();
            await store.SaveWorkflowFormContentAsync(formKey, request, user, cancellationToken);
            return Results.NoContent();
        });
        var forms = api.MapGroup("/form-templates/{templateId:guid}");
        forms.AddEndpointFilter(async (context, next) =>
        {
            try { return await next(context); }
            catch (DBConcurrencyException exception) { return Results.Conflict(new { message = exception.Message }); }
        });
        forms.MapGet("/administration", async (Guid templateId, Guid? versionId, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var user = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!user.HasPermission(PermissionKeys.FormsManage)) return Results.Forbid();
            var result = await store.GetFormTemplateAdministrationAsync(templateId, versionId, user, cancellationToken);
            return result is null ? Results.NotFound() : Results.Ok(result);
        });
        forms.MapPost("/draft", async (Guid templateId, CreateFormVersionDraftRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var user = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!user.HasPermission(PermissionKeys.FormsManage)) return Results.Forbid();
            var versionId = await store.CreateFormVersionDraftAsync(templateId, request.SourceVersionId, user, cancellationToken);
            return Results.Ok(new { versionId });
        });
        forms.MapPut("/versions/{versionId:guid}", async (Guid templateId, Guid versionId, SaveFormVersionRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var user = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!user.HasPermission(PermissionKeys.FormsManage)) return Results.Forbid();
            await store.SaveFormVersionAsync(templateId, versionId, request, user, cancellationToken);
            return Results.NoContent();
        });
        forms.MapPost("/versions/{versionId:guid}/publish", async (Guid templateId, Guid versionId, FormVersionCommandRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var user = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!user.HasPermission(PermissionKeys.FormsManage)) return Results.Forbid();
            await store.PublishFormVersionAsync(templateId, versionId, request.RowVersion, user, cancellationToken);
            return Results.NoContent();
        });
        forms.MapPost("/versions/{versionId:guid}/discard", async (Guid templateId, Guid versionId, FormVersionCommandRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken cancellationToken) =>
        {
            var user = await GetCurrentUserAsync(principal, store, cancellationToken);
            if (!user.HasPermission(PermissionKeys.FormsManage)) return Results.Forbid();
            await store.DiscardFormVersionDraftAsync(templateId, versionId, request.RowVersion, user, cancellationToken);
            return Results.NoContent();
        });
    }
}
