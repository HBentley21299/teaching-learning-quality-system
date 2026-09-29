using System.Data;
using System.Security.Claims;
using TLQS.Api.Data;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.V1;

public static partial class FoundationEndpoints
{
    private static void MapCustomRoleAdminEndpoints(RouteGroupBuilder api)
    {
        api.MapGet("/admin/permission-catalogue", async (ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken token) =>
        {
            var user = await GetCurrentUserAsync(principal, store, token);
            return await store.IsActiveAdministratorAsync(user, token)
                ? Results.Ok(await store.GetAssignablePermissionsAsync(user, token)) : Results.Forbid();
        });
        api.MapGet("/admin/custom-roles/{id:guid}", async (Guid id, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken token) =>
        {
            var user = await GetCurrentUserAsync(principal, store, token);
            if (!await store.IsActiveAdministratorAsync(user, token)) return Results.Forbid();
            var role = await store.GetCustomRoleAsync(id, token);
            return role is null ? Results.NotFound() : Results.Ok(role);
        });
        api.MapPost("/admin/custom-roles", (SaveCustomRoleRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken token) => SaveCustomRole(null, request, principal, store, token));
        api.MapPut("/admin/custom-roles/{id:guid}", (Guid id, SaveCustomRoleRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken token) => SaveCustomRole(id, request, principal, store, token));
    }

    private static async Task<IResult> SaveCustomRole(Guid? id, SaveCustomRoleRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken token)
    {
        var user = await GetCurrentUserAsync(principal, store, token);
        if (!await store.IsActiveAdministratorAsync(user, token)) return Results.Forbid();
        try { return Results.Ok(new { id = await store.SaveCustomRoleAsync(id, request, user, token) }); }
        catch (WorkflowValidationException ex) { return Results.BadRequest(new { message = ex.Message }); }
        catch (DBConcurrencyException ex) { return Results.Conflict(new { message = ex.Message }); }
        catch (UnauthorizedAccessException) { return Results.Forbid(); }
    }
}

public sealed record SaveCustomRoleRequest(string Name, string? Description, IReadOnlyList<string> PermissionKeys, byte[]? RowVersion);
public sealed record CustomRoleDetail(Guid Id, string Name, string? Description, IReadOnlyList<string> PermissionKeys, byte[] RowVersion);
