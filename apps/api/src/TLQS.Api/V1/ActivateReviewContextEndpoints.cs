using System.Security.Claims;
using TLQS.Api.Data;

namespace TLQS.Api.V1;

public static partial class FoundationEndpoints
{
    private static void MapActivateReviewContextEndpoints(RouteGroupBuilder reviews)
    {
        reviews.MapPost("/activate/context",async(ResolveActivateReviewContextRequest request,ClaimsPrincipal principal,SqlFoundationDataStore store,CancellationToken ct)=>
        {
            var user=await GetCurrentUserAsync(principal,store,ct);
            return Results.Ok(await store.ResolveActivateReviewContextAsync(request,user,ct));
        });
    }
}
