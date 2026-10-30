using System.Data;
using System.Security.Claims;
using TLQS.Api.Data;
using TLQS.Api.Exports;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.V1;

public static partial class FoundationEndpoints
{
    private static void MapProcessReviewEndpoints(RouteGroupBuilder api)
    {
        var reviews=api.MapGroup("/process-reviews");
        reviews.AddEndpointFilter(ProcessReviewErrors);
        MapActivateReviewContextEndpoints(reviews);
        MapActivateFollowUpEndpoints(reviews);
        reviews.MapGet("/{processKey}/configuration",async(string processKey,ClaimsPrincipal principal,SqlFoundationDataStore store,CancellationToken ct)=>
        {
            var user=await GetCurrentUserAsync(principal,store,ct);
            if(!user.UserAccountId.HasValue)return Results.Forbid();
            return Results.Ok(await store.GetProcessReviewConfigurationAsync(processKey,ct));
        });
        reviews.MapGet("/{processKey}",async(string processKey,string? academicYear,ClaimsPrincipal principal,SqlFoundationDataStore store,CancellationToken ct)=>
        {
            var user=await GetCurrentUserAsync(principal,store,ct);
            return Results.Ok(await store.GetProcessReviewsAsync(processKey,academicYear,user,ct));
        });
        reviews.MapPost("/{processKey}",async(string processKey,SaveProcessReviewRequest request,ClaimsPrincipal principal,SqlFoundationDataStore store,CancellationToken ct)=>
        {
            var user=await GetCurrentUserAsync(principal,store,ct);
            return Results.Ok(await store.SaveProcessReviewAsync(processKey,null,request,user,ct));
        });
        reviews.MapGet("/records/{recordId:guid}",async(Guid recordId,ClaimsPrincipal principal,SqlFoundationDataStore store,CancellationToken ct)=>
        {
            var user=await GetCurrentUserAsync(principal,store,ct);var result=await store.GetProcessReviewAsync(recordId,user,ct);
            return result is null?Results.NotFound():Results.Ok(result);
        });
        reviews.MapPut("/records/{recordId:guid}",async(Guid recordId,SaveProcessReviewRequest request,ClaimsPrincipal principal,SqlFoundationDataStore store,CancellationToken ct)=>
        {
            var user=await GetCurrentUserAsync(principal,store,ct);var current=await store.GetProcessReviewAsync(recordId,user,ct);
            if(current is null)return Results.NotFound();
            return Results.Ok(await store.SaveProcessReviewAsync(current.ProcessKey,recordId,request,user,ct));
        });
        reviews.MapGet("/{processKey}/actions",async(string processKey,string? academicYear,ClaimsPrincipal principal,SqlFoundationDataStore store,CancellationToken ct)=>
        {
            var user=await GetCurrentUserAsync(principal,store,ct);
            return Results.Ok(await store.GetProcessReviewActionsAsync(processKey,academicYear,user,ct));
        });
        reviews.MapGet("/actions/{actionId:guid}",async(Guid actionId,ClaimsPrincipal principal,SqlFoundationDataStore store,CancellationToken ct)=>
        {
            var user=await GetCurrentUserAsync(principal,store,ct);var result=await store.GetProcessReviewActionAsync(actionId,user,ct);
            return result is null?Results.NotFound():Results.Ok(result);
        });
        reviews.MapPut("/actions/{actionId:guid}",async(Guid actionId,SaveProcessReviewActionRequest request,ClaimsPrincipal principal,SqlFoundationDataStore store,CancellationToken ct)=>
        {
            var user=await GetCurrentUserAsync(principal,store,ct);var current=await store.GetProcessReviewActionAsync(actionId,user,ct);
            if(current is null)return Results.NotFound();
            return Results.Ok(await store.SaveProcessReviewActionAsync(current.RecordId,actionId,request,user,ct));
        });
        reviews.MapPost("/records/{recordId:guid}/actions",async(Guid recordId,SaveProcessReviewActionRequest request,ClaimsPrincipal principal,SqlFoundationDataStore store,CancellationToken ct)=>
        {
            var user=await GetCurrentUserAsync(principal,store,ct);
            await store.SaveProcessReviewActionAsync(recordId,null,request,user,ct);
            return Results.Ok(await store.GetProcessReviewAsync(recordId,user,ct));
        });
        reviews.MapPut("/records/{recordId:guid}/actions/{actionId:guid}",async(Guid recordId,Guid actionId,SaveProcessReviewActionRequest request,ClaimsPrincipal principal,SqlFoundationDataStore store,CancellationToken ct)=>
        {
            var user=await GetCurrentUserAsync(principal,store,ct);
            // The action-only path is used by assignees without review access.
            if(await store.GetProcessReviewAsync(recordId,user,ct) is null)return Results.NotFound();
            await store.SaveProcessReviewActionAsync(recordId,actionId,request,user,ct);
            return Results.Ok(await store.GetProcessReviewAsync(recordId,user,ct));
        });
        reviews.MapGet("/{processKey}/export",async(string processKey,string? academicYear,ClaimsPrincipal principal,SqlFoundationDataStore store,ExcelExportService excel,MessagingConfigurationStore messaging,CancellationToken ct)=>
        {
            var user=await GetCurrentUserAsync(principal,store,ct);
            if(!user.HasPermission(PermissionKeys.ExportsCreate))return Results.Forbid();
            var applicationUrl=(await messaging.GetEffectiveAsync(ct)).ApplicationUrl;
            var workbook=await store.GetProcessReviewExportAsync(processKey,academicYear,user,ct,applicationUrl);
            var export=excel.CreateWorkbook(workbook);
            return Results.File(export.Content,export.ContentType,export.FileName);
        });
        var admin=api.MapGroup("/admin/process-reviews");
        admin.AddEndpointFilter(ProcessReviewErrors);
        admin.MapPut("/{processKey}/configuration",async(string processKey,ProcessReviewConfiguration request,ClaimsPrincipal principal,SqlFoundationDataStore store,CancellationToken ct)=>
        {
            var user=await GetCurrentUserAsync(principal,store,ct);
            return Results.Ok(await store.SaveProcessReviewConfigurationAsync(processKey,request,user,ct));
        });
    }

    private static async ValueTask<object?> ProcessReviewErrors(EndpointFilterInvocationContext context,EndpointFilterDelegate next)
    {
        try{return await next(context);}
        catch(WorkflowValidationException exception){return Results.BadRequest(new{message=exception.Message});}
        catch(DBConcurrencyException exception){return Results.Conflict(new{message=exception.Message});}
        catch(UnauthorizedAccessException exception){return Results.Json(new{message=exception.Message},statusCode:403);}
    }
}
