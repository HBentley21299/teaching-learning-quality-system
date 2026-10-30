using System.Security.Claims;
using TLQS.Api.Data;

namespace TLQS.Api.V1;

public static partial class FoundationEndpoints
{
    private static void MapActivateFollowUpEndpoints(RouteGroupBuilder reviews)
    {
        reviews.MapPost("/records/{recordId:guid}/follow-up",async(Guid recordId,CreateActivateFollowUpRequest request,
            ClaimsPrincipal principal,SqlFoundationDataStore store,CancellationToken ct)=>
        {
            var user=await GetCurrentUserAsync(principal,store,ct);
            return Results.Ok(await store.CreateActivateFollowUpAsync(recordId,request,user,ct));
        });
    }
}
