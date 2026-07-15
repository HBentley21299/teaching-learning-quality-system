namespace TLQS.Application.Workflows;

public static class LivAccessPolicy
{
    public const string InProgress = "in_progress";
    public const string Closed = "closed";

    public static bool CanEdit(string status, bool isCreator, bool canManage) =>
        string.Equals(status, InProgress, StringComparison.OrdinalIgnoreCase)
        && (isCreator || canManage);

    public static bool CanViewSensitive(bool isCreator, bool isAdministrator, bool hasSensitivePermission) =>
        isCreator || isAdministrator || hasSensitivePermission;
}
