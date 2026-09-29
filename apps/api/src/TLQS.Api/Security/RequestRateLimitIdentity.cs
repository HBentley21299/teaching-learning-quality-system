using System.Security.Claims;

namespace TLQS.Api.Security;

public static class RequestRateLimitIdentity
{
    public static IApplicationBuilder UseAuthenticatedRateLimiting(this IApplicationBuilder app)
    {
        app.UseAuthentication();
        return app.UseRateLimiter();
    }

    public static string PartitionKey(HttpContext context)
    {
        if (context.User.Identity?.IsAuthenticated == true)
        {
            var oid = context.User.FindFirstValue("oid");
            if (!string.IsNullOrWhiteSpace(oid))
                return $"entra:{context.User.FindFirstValue("tid") ?? "configured-tenant"}:{oid}";
            var subject = context.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? context.User.FindFirstValue("sub");
            if (!string.IsNullOrWhiteSpace(subject))
                return $"authenticated:{context.User.Identity.AuthenticationType}:{subject}";
        }
        return $"anonymous:{context.Connection.RemoteIpAddress?.ToString() ?? "unknown"}";
    }
}
