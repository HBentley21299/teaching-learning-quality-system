using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.DataProtection;
using TLQS.Api.Data;
using TLQS.Api.Security;
using TLQS.Api.V1;
using TLQS.Application.Workflows;

var builder = WebApplication.CreateBuilder(args);

builder.Logging.ClearProviders();
builder.Logging.AddConsole();

var dataProtectionKeysPath = Path.GetFullPath(Path.Combine(
    builder.Environment.ContentRootPath,
    "..",
    "..",
    "..",
    "..",
    ".localappdata",
    "data-protection-keys"));
Directory.CreateDirectory(dataProtectionKeysPath);

builder.Services
    .AddDataProtection()
    .SetApplicationName("TLQS")
    .PersistKeysToFileSystem(new DirectoryInfo(dataProtectionKeysPath));

builder.Services.AddSingleton<SqlFoundationDataStore>();
builder.Services.AddCors(options =>
{
    options.AddPolicy("web", policy =>
    {
        var origins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
        policy.WithOrigins(origins).AllowAnyHeader().AllowAnyMethod();
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

var app = builder.Build();

if (!app.Environment.IsDevelopment())
{
    app.UseHttpsRedirection();
}
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

app.MapGet("/health", async (SqlFoundationDataStore store, CancellationToken cancellationToken) =>
{
    var canConnect = await store.CanConnectAsync(cancellationToken);

    return Results.Ok(new
    {
        status = canConnect ? "healthy" : "degraded",
        database = canConnect ? "connected" : "unavailable",
        timestamp = DateTimeOffset.UtcNow
    });
});

app.MapFoundationEndpoints();

app.Run();
