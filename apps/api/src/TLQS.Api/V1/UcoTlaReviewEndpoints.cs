using System.Security.Claims;
using TLQS.Api.Data;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.V1;

public static class UcoTlaReviewEndpoints
{
    public static IEndpointRouteBuilder MapUcoTlaReviewEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api/v1/uco-tla-reviews").RequireAuthorization();

        api.MapGet("/access", async (ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken token) =>
        {
            var user = await CurrentUser(principal, store, token);
            return Results.Ok(await store.GetUcoTlaAccessSummaryAsync(user, token));
        });

        api.MapGet("", async (ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken token) =>
        {
            var user = await CurrentUser(principal, store, token);
            var access = await store.GetUcoTlaAccessSummaryAsync(user, token);
            return access.CanAccess ? Results.Ok(await store.GetUcoTlaReviewsAsync(user, token)) : Results.Forbid();
        });

        api.MapGet("/dashboard", async (string? academicYear, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken token) =>
        {
            var user = await CurrentUser(principal, store, token);
            var access = await store.GetUcoTlaAccessSummaryAsync(user, token);
            return access.CanAccess ? Results.Ok(await store.GetUcoTlaDashboardAsync(user, academicYear, token)) : Results.Forbid();
        });

        api.MapPost("", async (CreateUcoTlaReviewRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken token) =>
        {
            var user = await CurrentUser(principal, store, token);
            if (!UcoTlaReviewAccessPolicy.CanManageAll(user)) return Results.Forbid();
            try
            {
                var id = await store.CreateUcoTlaReviewAsync(request, user, token);
                return Results.Created($"/api/v1/uco-tla-reviews/{id}", new { RecordId = id });
            }
            catch (UnauthorizedAccessException)
            {
                return Results.Forbid();
            }
        });

        api.MapGet("/{recordId:guid}", async (Guid recordId, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken token) =>
        {
            var user = await CurrentUser(principal, store, token);
            var review = await store.GetUcoTlaReviewAsync(recordId, user, token);
            return review is null ? Results.NotFound() : Results.Ok(review);
        });

        api.MapPut("/{recordId:guid}", async (Guid recordId, SaveUcoTlaObserverSectionRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken token) =>
        {
            var user = await CurrentUser(principal, store, token);
            return await Mutate(async () =>
            {
                await store.SaveUcoTlaObserverSectionAsync(recordId, request, user, token);
                return await store.GetUcoTlaReviewAsync(recordId, user, token);
            });
        });

        api.MapPost("/{recordId:guid}/submit", async (Guid recordId, UcoTlaFinaliseRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken token) =>
        {
            var user = await CurrentUser(principal, store, token);
            return await Mutate(async () =>
            {
                await store.SubmitUcoTlaForLecturerAsync(recordId, request.RowVersion, user, token);
                return await store.GetUcoTlaReviewAsync(recordId, user, token);
            });
        });

        api.MapPost("/{recordId:guid}/lecturer-acknowledgement", async (Guid recordId, UcoTlaLecturerAcknowledgementRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken token) =>
        {
            var user = await CurrentUser(principal, store, token);
            return await Mutate(async () =>
            {
                await store.AcknowledgeUcoTlaReviewAsync(recordId, request, user, token);
                return await store.GetUcoTlaReviewAsync(recordId, user, token);
            });
        });

        api.MapPut("/{recordId:guid}/professional-discussion", async (Guid recordId, UcoTlaProfessionalDiscussionRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken token) =>
        {
            var user = await CurrentUser(principal, store, token);
            return await Mutate(async () =>
            {
                await store.SaveUcoTlaProfessionalDiscussionAsync(recordId, request, user, token);
                return await store.GetUcoTlaReviewAsync(recordId, user, token);
            });
        });

        api.MapPost("/{recordId:guid}/finalise", async (Guid recordId, UcoTlaFinaliseRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken token) =>
        {
            var user = await CurrentUser(principal, store, token);
            return await Mutate(async () =>
            {
                await store.FinaliseUcoTlaReviewAsync(recordId, request, user, token);
                return await store.GetUcoTlaReviewAsync(recordId, user, token);
            });
        });

        api.MapPost("/{recordId:guid}/reopen", async (Guid recordId, UcoTlaReopenRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken token) =>
        {
            var user = await CurrentUser(principal, store, token);
            return await Mutate(async () =>
            {
                await store.ReopenUcoTlaReviewAsync(recordId, request, user, token);
                return await store.GetUcoTlaReviewAsync(recordId, user, token);
            });
        });

        api.MapPut("/{recordId:guid}/follow-up", async (Guid recordId, UcoTlaFollowUpRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken token) =>
        {
            var user = await CurrentUser(principal, store, token);
            return await Mutate(async () =>
            {
                await store.SaveUcoTlaFollowUpAsync(recordId, request, user, token);
                return await store.GetUcoTlaReviewAsync(recordId, user, token);
            });
        });

        api.MapPost("/{recordId:guid}/linked-review", async (Guid recordId, CreateLinkedUcoTlaReviewRequest request, ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken token) =>
        {
            var user = await CurrentUser(principal, store, token);
            if (!UcoTlaReviewAccessPolicy.CanManageAll(user)) return Results.Forbid();
            try
            {
                var linkedId = await store.CreateLinkedUcoTlaReviewAsync(recordId, request, user, token);
                return Results.Created($"/api/v1/uco-tla-reviews/{linkedId}", new { RecordId = linkedId });
            }
            catch (UcoTlaConcurrencyException exception)
            {
                return Results.Conflict(new { exception.Message });
            }
            catch (UnauthorizedAccessException)
            {
                return Results.Forbid();
            }
        });

        return app;
    }

    private static async Task<IResult> Mutate(Func<Task<UcoTlaReviewDetail?>> mutation)
    {
        try
        {
            var detail = await mutation();
            return detail is null ? Results.NotFound() : Results.Ok(detail);
        }
        catch (UcoTlaConcurrencyException exception)
        {
            return Results.Conflict(new { exception.Message });
        }
        catch (UnauthorizedAccessException)
        {
            return Results.Forbid();
        }
    }

    private static Task<CurrentUser> CurrentUser(ClaimsPrincipal principal, SqlFoundationDataStore store, CancellationToken token) =>
        PlatformOperationsEndpoints.ResolveCurrentUserAsync(principal, store, token);
}
