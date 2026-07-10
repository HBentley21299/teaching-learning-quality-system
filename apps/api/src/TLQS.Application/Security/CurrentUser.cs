using System.Security.Claims;

namespace TLQS.Application.Security;

public sealed record CurrentUser(
    Guid? UserAccountId,
    Guid? StaffId,
    string DisplayName,
    string Email,
    IReadOnlySet<string> Permissions,
    IReadOnlyList<AccessScopeDto> Scopes)
{
    public bool HasPermission(string permissionKey) => Permissions.Contains(permissionKey);

    public static CurrentUser Empty(string email) => new(
        null,
        null,
        "Unauthorised user",
        email,
        new HashSet<string>(StringComparer.OrdinalIgnoreCase),
        []);
}

public sealed record AccessScopeDto(string ScopeType, Guid? OrgUnitId, Guid? StaffId);

public interface ICurrentUserAccessor
{
    CurrentUser? CurrentUser { get; }
}

public interface IPermissionService
{
    Task<bool> HasPermissionAsync(ClaimsPrincipal principal, string permissionKey, CancellationToken cancellationToken);
    Task<CurrentUser> GetCurrentUserAsync(ClaimsPrincipal principal, CancellationToken cancellationToken);
}

public interface IAccessScopeService
{
    IQueryable<T> ApplyStaffScope<T>(IQueryable<T> query, CurrentUser currentUser)
        where T : IStaffScoped;
}

public interface IStaffScoped
{
    Guid? StaffId { get; }
    Guid? OrgUnitId { get; }
}
