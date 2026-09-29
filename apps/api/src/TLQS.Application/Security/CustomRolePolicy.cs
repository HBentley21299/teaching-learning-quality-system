namespace TLQS.Application.Security;

public static class CustomRolePolicy
{
    public static bool CanGrant(string? permissionKey, IEnumerable<string> actorPermissions) =>
        !string.IsNullOrWhiteSpace(permissionKey)
        && permissionKey != "cpd.mandatory_log"
        && actorPermissions.Contains(permissionKey, StringComparer.Ordinal);
}
