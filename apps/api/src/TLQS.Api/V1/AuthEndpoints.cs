using System.Security.Claims;
using TLQS.Api.Data;
using TLQS.Api.Security;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.V1;

public sealed record LocalLoginRequest(string Email, string Password);
public sealed record LocalLoginResponse(string Token, string DisplayName, string Email, bool RequiresOnboarding);
public sealed record ChangePasswordRequest(string CurrentPassword, string NewPassword);
public sealed record SetPasswordRequest(string NewPassword);

/// <summary>
/// Username/password endpoints for local test accounts. Mapped only when the
/// local sign-in scheme is active; Microsoft Entra ID sign-in is untouched.
/// </summary>
public static class AuthEndpoints
{
    public static IEndpointRouteBuilder MapLocalAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api/v1/auth");

        api.MapPost("/login", async (
            LocalLoginRequest request,
            SqlFoundationDataStore store,
            LocalTokenService tokens,
            CancellationToken cancellationToken) =>
        {
            if (string.IsNullOrWhiteSpace(request.Email) || string.IsNullOrEmpty(request.Password))
            {
                return Results.Json(new { Message = "Enter your email address and password." }, statusCode: 400);
            }

            var credential = await store.GetLocalCredentialAsync(request.Email.Trim(), cancellationToken);
            if (credential is null || !LocalPasswordHasher.Verify(request.Password, credential.PasswordHash))
            {
                return Results.Json(
                    new { Message = "The email address or password is incorrect." }, statusCode: 401);
            }

            // No account yet means this test sign-in has not completed trusted
            // self-onboarding; the app shows the faculty/team setup screen.
            var requiresOnboarding = credential.UserAccountId is null;
            return Results.Ok(new LocalLoginResponse(
                tokens.CreateToken(credential.Email),
                credential.DisplayName ?? credential.Email.Split('@')[0],
                credential.Email,
                requiresOnboarding));
        }).AllowAnonymous().RequireRateLimiting("sensitive");

        api.MapPost("/change-password", async (
            ChangePasswordRequest request,
            ClaimsPrincipal principal,
            SqlFoundationDataStore store,
            CancellationToken cancellationToken) =>
        {
            var email = principal.FindFirstValue("preferred_username")
                ?? principal.FindFirstValue(ClaimTypes.Email);
            if (string.IsNullOrWhiteSpace(email))
            {
                return Results.Unauthorized();
            }

            ValidateNewPassword(request.NewPassword);
            var currentHash = await store.GetLocalPasswordHashAsync(email, cancellationToken);
            if (currentHash is null || !LocalPasswordHasher.Verify(request.CurrentPassword, currentHash))
            {
                return Results.Json(new { Message = "The current password is incorrect." }, statusCode: 400);
            }

            var user = await PlatformOperationsEndpoints.ResolveCurrentUserAsync(principal, store, cancellationToken);
            await store.SetLocalPasswordByEmailAsync(
                email, LocalPasswordHasher.Hash(request.NewPassword), user, cancellationToken);
            return Results.NoContent();
        }).RequireAuthorization().RequireRateLimiting("sensitive");

        api.MapPost("/admin/users/{userAccountId:guid}/password", async (
            Guid userAccountId,
            SetPasswordRequest request,
            ClaimsPrincipal principal,
            SqlFoundationDataStore store,
            CancellationToken cancellationToken) =>
        {
            var user = await PlatformOperationsEndpoints.ResolveCurrentUserAsync(principal, store, cancellationToken);
            if (!user.HasPermission(PermissionKeys.UsersManage))
            {
                return Results.Forbid();
            }

            ValidateNewPassword(request.NewPassword);
            var email = await store.GetAccountEmailAsync(userAccountId, cancellationToken);
            if (email is null)
            {
                return Results.NotFound();
            }

            return await store.SetLocalPasswordByEmailAsync(
                email, LocalPasswordHasher.Hash(request.NewPassword), user, cancellationToken)
                ? Results.NoContent()
                : Results.NotFound();
        }).RequireAuthorization().RequireRateLimiting("sensitive");

        return app;
    }

    private static void ValidateNewPassword(string password)
    {
        if (string.IsNullOrEmpty(password) || password.Length < 10)
        {
            throw new WorkflowValidationException("Choose a password of at least 10 characters.");
        }
    }
}
