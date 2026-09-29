using TLQS.Application.Security;

namespace TLQS.Application.Workflows;

public static class CpdRecordingPolicy
{
    public static bool IsMandatory(string? templateKey) =>
        string.Equals(templateKey, "cpd_mandatory", StringComparison.OrdinalIgnoreCase);

    public static bool CanManageMandatory(CurrentUser user) => user.HasPermission(PermissionKeys.CpdMandatoryLog);

    // Eligibility is deliberately opt-in: external, mandatory and future CPD types never earn credit implicitly.
    public static bool ContributesToElevate(string? templateKey) =>
        string.Equals(templateKey, "cpd_core", StringComparison.OrdinalIgnoreCase);
}
