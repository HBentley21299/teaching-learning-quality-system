using TLQS.Application.Security;

namespace TLQS.Infrastructure.Security;

public sealed class AccessScopeService : IAccessScopeService
{
    public IQueryable<T> ApplyStaffScope<T>(IQueryable<T> query, CurrentUser currentUser)
        where T : IStaffScoped
    {
        if (currentUser.Scopes.Any(x => x.ScopeType.Equals("global", StringComparison.OrdinalIgnoreCase)))
        {
            return query;
        }

        var staffIds = currentUser.Scopes
            .Where(x => x.StaffId.HasValue)
            .Select(x => x.StaffId!.Value)
            .Append(currentUser.StaffId ?? Guid.Empty)
            .Where(x => x != Guid.Empty)
            .ToArray();

        var orgIds = currentUser.Scopes
            .Where(x => x.OrgUnitId.HasValue)
            .Select(x => x.OrgUnitId!.Value)
            .ToArray();

        return query.Where(x =>
            (x.StaffId.HasValue && staffIds.Contains(x.StaffId.Value))
            || (x.OrgUnitId.HasValue && orgIds.Contains(x.OrgUnitId.Value)));
    }
}

