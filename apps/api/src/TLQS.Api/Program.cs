using System.Diagnostics;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.HttpOverrides;
using TLQS.Api.Data;
using TLQS.Api.Security;
using TLQS.Api.V1;
using TLQS.Application.Workflows;

var builder = WebApplication.CreateBuilder(args);

builder.Logging.ClearProviders();
builder.Logging.AddConsole();
builder.WebHost.ConfigureKestrel(options => options.AddServerHeader = false);

if (string.IsNullOrWhiteSpace(builder.Configuration.GetConnectionString("TlqsDatabase")))
{
    throw new InvalidOperationException("Connection string 'TlqsDatabase' must be configured.");
}

builder.Services.AddSingleton<SqlFoundationDataStore>();
builder.Services.AddProblemDetails(options =>
{
    options.CustomizeProblemDetails = context =>
    {
        context.ProblemDetails.Extensions["traceId"] = context.HttpContext.TraceIdentifier;
    };
});
builder.Services.AddResponseCompression(options => options.EnableForHttps = true);
builder.Services.AddCors(options =>
{
    options.AddPolicy("web", policy =>
    {
        var origins = (builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [])
            .Where(origin => !string.IsNullOrWhiteSpace(origin))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        if (origins.Length > 0)
        {
            policy.WithOrigins(origins).AllowAnyHeader().AllowAnyMethod();
        }
    });
});

// Development-only authentication (every request runs as the configured user) is
// opt-in and never active outside the Development environment. Everywhere else the
// API validates Microsoft Entra ID access tokens.
var allowDevelopmentUser = builder.Configuration.GetValue<bool>("Authentication:AllowDevelopmentUser");
if (builder.Environment.IsDevelopment() && allowDevelopmentUser)
{
    builder.Services
        .AddAuthentication(DevelopmentAuthenticationHandler.SchemeName)
        .AddScheme<DevelopmentAuthenticationOptions, DevelopmentAuthenticationHandler>(
            DevelopmentAuthenticationHandler.SchemeName,
            options =>
            {
                var configuredEmail = builder.Configuration["Authentication:DevelopmentUserEmail"];
                if (!string.IsNullOrWhiteSpace(configuredEmail))
                {
                    options.Email = configuredEmail;
                }
            });
}
else
{
    var tenantId = builder.Configuration["Authentication:TenantId"];
    var audience = builder.Configuration["Authentication:Audience"];
    if (string.IsNullOrWhiteSpace(tenantId) || string.IsNullOrWhiteSpace(audience))
    {
        throw new InvalidOperationException(
            "Authentication:TenantId and Authentication:Audience must be configured for Entra ID JWT bearer authentication. "
            + "In Development you can set Authentication:AllowDevelopmentUser to true to use the development sign-in instead.");
    }

    builder.Services
        .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
        .AddJwtBearer(options =>
        {
            options.Authority = $"https://login.microsoftonline.com/{tenantId}/v2.0";
            // Keep the raw token claim names (preferred_username, email) so the
            // identity mapping in SqlFoundationDataStore sees them unchanged.
            options.MapInboundClaims = false;
            options.TokenValidationParameters.NameClaimType = "preferred_username";
            // Entra issues the audience as either the app's client id or its
            // api://<client-id> URI depending on how the scope was requested.
            options.TokenValidationParameters.ValidAudiences = [audience, $"api://{audience}"];
        });
}

builder.Services.AddAuthorization();
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    options.KnownIPNetworks.Clear();
    options.KnownProxies.Clear();
});

var app = builder.Build();
var requestLogger = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("TLQS.Api.Requests");

app.Use(async (context, next) =>
{
    var startedAt = Stopwatch.GetTimestamp();
    context.Response.Headers.TryAdd("X-Content-Type-Options", "nosniff");
    context.Response.Headers.TryAdd("X-Frame-Options", "DENY");
    context.Response.Headers.TryAdd("Referrer-Policy", "strict-origin-when-cross-origin");
    context.Response.Headers.TryAdd("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    context.Response.Headers.TryAdd("Content-Security-Policy", "frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
    context.Response.Headers.TryAdd("X-Trace-Id", context.TraceIdentifier);
    if (context.Request.Path.StartsWithSegments("/api") || context.Request.Path.StartsWithSegments("/health"))
    {
        context.Response.Headers.CacheControl = "no-store";
    }

    await next(context);

    if (!context.Request.Path.StartsWithSegments("/health"))
    {
        requestLogger.LogInformation(
            "HTTP {Method} {Path} responded {StatusCode} in {ElapsedMilliseconds:F1} ms (TraceId: {TraceId})",
            context.Request.Method,
            context.Request.Path,
            context.Response.StatusCode,
            Stopwatch.GetElapsedTime(startedAt).TotalMilliseconds,
            context.TraceIdentifier);
    }
});

app.UseExceptionHandler();
app.UseForwardedHeaders();

if (!app.Environment.IsDevelopment())
{
    app.UseHsts();
    app.UseHttpsRedirection();
}
app.UseResponseCompression();
app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = context =>
    {
        var cacheDuration = context.File.Name.Equals("index.html", StringComparison.OrdinalIgnoreCase)
            ? TimeSpan.Zero
            : TimeSpan.FromDays(30);
        context.Context.Response.Headers.CacheControl = cacheDuration == TimeSpan.Zero
            ? "no-cache"
            : $"public,max-age={(int)cacheDuration.TotalSeconds},immutable";
    }
});
app.UseCors("web");
app.UseAuthentication();
app.UseAuthorization();

// Workflow rule violations (missing required fields, invalid status transitions)
// surface as 400s with a readable message instead of blank 500s.
app.Use(async (context, next) =>
{
    try
    {
        await next(context);
    }
    catch (WorkflowValidationException exception)
    {
        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        await context.Response.WriteAsJsonAsync(new { Message = exception.Message });
    }
});

app.MapGet("/health/live", () => Results.Ok(new
{
    status = "healthy",
    timestamp = DateTimeOffset.UtcNow
}));

async Task<IResult> ReadinessAsync(SqlFoundationDataStore store, CancellationToken cancellationToken)
{
    var canConnect = await store.CanConnectAsync(cancellationToken);
    var payload = new
    {
        status = canConnect ? "healthy" : "unhealthy",
        database = canConnect ? "connected" : "unavailable",
        timestamp = DateTimeOffset.UtcNow
    };
    return Results.Json(payload, statusCode: canConnect
        ? StatusCodes.Status200OK
        : StatusCodes.Status503ServiceUnavailable);
}

app.MapGet("/health/ready", ReadinessAsync);
app.MapGet("/health", ReadinessAsync);

app.MapFoundationEndpoints();

// Production packages the React application into wwwroot. Client-side routes
// resolve to index.html while API and health endpoints retain their own 404s.
if (File.Exists(Path.Combine(app.Environment.WebRootPath ?? "wwwroot", "index.html")))
{
    app.MapFallbackToFile("{*path:nonfile}", "index.html");
}

app.Run();
