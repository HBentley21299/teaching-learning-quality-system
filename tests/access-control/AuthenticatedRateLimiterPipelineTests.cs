using System.Net;
using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using TLQS.Api.Security;
using Xunit;

namespace TLQS.AccessControl.Tests;

public class AuthenticatedRateLimiterPipelineTests
{
    [Fact]
    public async Task RealPipelinePartitionsAfterAuthenticationForColleaguesAtSameAddress()
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Development", ContentRootPath = Path.GetTempPath() });
        builder.Logging.ClearProviders();
        builder.WebHost.ConfigureKestrel(server => server.Listen(IPAddress.Loopback, 0));
        builder.Services.AddAuthentication("TestIdentity").AddScheme<AuthenticationSchemeOptions, TestIdentityHandler>("TestIdentity", _ => { });
        builder.Services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = 429;
            options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
                RateLimitPartition.GetFixedWindowLimiter(RequestRateLimitIdentity.PartitionKey(context), _ => new FixedWindowRateLimiterOptions
                { PermitLimit = 1, Window = TimeSpan.FromMinutes(1), QueueLimit = 0, AutoReplenishment = false }));
        });
        await using var app = builder.Build();
        app.UseAuthenticatedRateLimiting();
        app.MapGet("/ping", () => Results.Ok());
        await app.StartAsync();
        try
        {
            using var client = new HttpClient { BaseAddress = new Uri(app.Urls.Single()) };
            async Task<HttpStatusCode> Send(string? user)
            {
                using var request = new HttpRequestMessage(HttpMethod.Get, "/ping");
                if (user is not null) request.Headers.Add("X-Test-Identity", user);
                using var response = await client.SendAsync(request); return response.StatusCode;
            }
            Assert.Equal(HttpStatusCode.OK, await Send("colleague-a"));
            Assert.Equal(HttpStatusCode.TooManyRequests, await Send("colleague-a"));
            Assert.Equal(HttpStatusCode.OK, await Send("colleague-b"));
            Assert.Equal(HttpStatusCode.OK, await Send(null));
            Assert.Equal(HttpStatusCode.TooManyRequests, await Send(null));
        }
        finally { await app.StopAsync(); }
    }

    private sealed class TestIdentityHandler(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
        : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            var subject = Request.Headers["X-Test-Identity"].ToString();
            if (string.IsNullOrWhiteSpace(subject)) return Task.FromResult(AuthenticateResult.NoResult());
            var principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim("oid", subject), new Claim("tid", "college")], Scheme.Name));
            return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(principal, Scheme.Name)));
        }
    }
}
