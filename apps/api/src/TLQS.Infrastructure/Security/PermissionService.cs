using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using TLQS.Application.Security;
using TLQS.Infrastructure.Persistence;

namespace TLQS.Infrastructure.Security;

public sealed class PermissionService(TlqsDbContext dbContext) : IPermissionService
{
    public async Task<bool> HasPermissionAsync(ClaimsPrincipal principal, string permissionKey, CancellationToken cancellationToken)
    {
        var currentUser = await GetCurrentUserAsync(principal, cancellationToken);
        return currentUser.HasPermission(permissionKey);
    }

    public async Task<CurrentUser> GetCurrentUserAsync(ClaimsPrincipal principal, CancellationToken cancellationToken)
    {
        var oid = principal.FindFirstValue("oid")
            ?? principal.FindFirstValue("http://schemas.microsoft.com/identity/claims/objectidentifier");
        var email = principal.FindFirstValue(ClaimTypes.Email)
            ?? principal.FindFirstValue("preferred_username")
            ?? "unknown@local";

        if (principal.Identity?.AuthenticationType == "Development")
        {
            return await GetDevelopmentUserAsync(email, cancellationToken);
        }

        if (string.IsNullOrWhiteSpace(oid))
        {
            return CurrentUser.Empty(email);
        }

        var identity = await dbContext.AuthIdentities
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Provider == "entra" && x.ProviderSubjectId == oid, cancellationToken);

        if (identity is null)
        {
            return CurrentUser.Empty(email);
        }

        return await BuildCurrentUserAsync(identity.UserAccountId, email, cancellationToken);
    }

    private async Task<CurrentUser> GetDevelopmentUserAsync(string email, CancellationToken cancellationToken)
    {
        var userAccountId = await dbContext.UserAccounts
            .AsNoTracking()
            .OrderBy(x => x.CreatedAt)
            .Select(x => x.Id)
            .FirstOrDefaultAsync(cancellationToken);

        if (userAccountId == Guid.Empty)
        {
            return CurrentUser.Empty(email);
        }

        return await BuildCurrentUserAsync(userAccountId, email, cancellationToken);
    }

    private async Task<CurrentUser> BuildCurrentUserAsync(Guid userAccountId, string fallbackEmail, CancellationToken cancellationToken)
    {
        var profile = await (
            from account in dbContext.UserAccounts.AsNoTracking()
            join staff in dbContext.Staff.AsNoTracking() on account.StaffId equals staff.Id
            where account.Id == userAccountId && !account.IsDisabled && account.ArchivedAt == null
            select new
            {
                UserAccountId = account.Id,
                StaffId = staff.Id,
                staff.DisplayName,
                staff.Email
            })
            .FirstOrDefaultAsync(cancellationToken);

        if (profile is null)
        {
            return CurrentUser.Empty(fallbackEmail);
        }

        var permissions = await (
            from userRole in dbContext.UserRoles.AsNoTracking()
            join rolePermission in dbContext.RolePermissions.AsNoTracking() on userRole.RoleId equals rolePermission.RoleId
            join permission in dbContext.Permissions.AsNoTracking() on rolePermission.PermissionId equals permission.Id
            where userRole.UserAccountId == profile.UserAccountId && userRole.ActiveTo == null
            select permission.PermissionKey)
            .Distinct()
            .ToArrayAsync(cancellationToken);

        var scopes = await dbContext.AccessScopes
            .AsNoTracking()
            .Where(x => x.UserAccountId == profile.UserAccountId && x.IsActive && x.ArchivedAt == null)
            .Select(x => new AccessScopeDto(x.ScopeType, x.OrgUnitId, x.StaffId))
            .ToArrayAsync(cancellationToken);

        return new CurrentUser(
            profile.UserAccountId,
            profile.StaffId,
            profile.DisplayName,
            profile.Email,
            permissions.ToHashSet(StringComparer.OrdinalIgnoreCase),
            scopes);
    }
}
