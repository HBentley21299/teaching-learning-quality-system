using Azure.Identity;
using Azure.Storage.Blobs;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Azure;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using TLQS.Application.Security;
using TLQS.Infrastructure.Persistence;
using TLQS.Infrastructure.Security;

namespace TLQS.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddDbContext<TlqsDbContext>(options =>
        {
            var connectionString = configuration.GetConnectionString("TlqsDatabase");
            options.UseSqlServer(connectionString, sql => sql.EnableRetryOnFailure());
        });

        services.AddAzureClients(builder =>
        {
            var storageUri = configuration["Storage:AccountUri"];
            if (!string.IsNullOrWhiteSpace(storageUri))
            {
                builder.AddBlobServiceClient(new Uri(storageUri));
                builder.UseCredential(new DefaultAzureCredential());
            }
        });

        services.AddScoped<IPermissionService, PermissionService>();
        services.AddScoped<IAccessScopeService, AccessScopeService>();
        services.AddScoped<IFileStorageService, BlobFileStorageService>();

        return services;
    }
}

public interface IFileStorageService
{
    Task<string> CreateUploadNameAsync(string originalFileName, CancellationToken cancellationToken);
}

public sealed class BlobFileStorageService : IFileStorageService
{
    public Task<string> CreateUploadNameAsync(string originalFileName, CancellationToken cancellationToken)
    {
        var extension = Path.GetExtension(originalFileName);
        var safeExtension = string.IsNullOrWhiteSpace(extension) ? ".bin" : extension.ToLowerInvariant();
        return Task.FromResult($"{DateTimeOffset.UtcNow:yyyy/MM/dd}/{Guid.NewGuid():N}{safeExtension}");
    }
}
