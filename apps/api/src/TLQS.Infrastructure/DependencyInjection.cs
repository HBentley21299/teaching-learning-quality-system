using Microsoft.EntityFrameworkCore;
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

        services.AddScoped<IPermissionService, PermissionService>();
        services.AddScoped<IAccessScopeService, AccessScopeService>();
        services.AddScoped<IFileStorageService, FileStorageNamingService>();

        return services;
    }
}

public interface IFileStorageService
{
    Task<string> CreateUploadNameAsync(string originalFileName, CancellationToken cancellationToken);
}

public sealed class FileStorageNamingService : IFileStorageService
{
    public Task<string> CreateUploadNameAsync(string originalFileName, CancellationToken cancellationToken)
    {
        var extension = Path.GetExtension(originalFileName);
        var safeExtension = string.IsNullOrWhiteSpace(extension) ? ".bin" : extension.ToLowerInvariant();
        return Task.FromResult($"{DateTimeOffset.UtcNow:yyyy/MM/dd}/{Guid.NewGuid():N}{safeExtension}");
    }
}
