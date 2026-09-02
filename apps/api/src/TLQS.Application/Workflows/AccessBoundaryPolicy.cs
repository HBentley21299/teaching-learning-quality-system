using TLQS.Application.Security;

namespace TLQS.Application.Workflows;

public static class AccessBoundaryPolicy
{
    public static bool CanCreateGenericRecord(CurrentUser currentUser) =>
        currentUser.HasPermission(PermissionKeys.FormsManage);

    public static bool CanManageVisibleAction(CurrentUser currentUser, bool actionIsVisible) =>
        actionIsVisible && currentUser.HasPermission(PermissionKeys.ActionsManage);

    public static bool CanManageVisibleAction(CurrentUser currentUser, bool actionIsVisible, string? sourceFormType) =>
        actionIsVisible
        && (currentUser.HasPermission(PermissionKeys.ActionsManage)
            || (UcoTlaReviewAccessPolicy.CanManageAll(currentUser)
                && string.Equals(sourceFormType, "uco_tla_review", StringComparison.OrdinalIgnoreCase)));

    public static bool IsTemplateCompatible(string recordType, string moduleKey)
    {
        var expectedModuleKey = recordType.Trim().ToLowerInvariant() switch
        {
            "learning_walk" => "learning_walks",
            "als_learning_walk" => "learning_walks",
            "work_scrutiny" => "work_scrutiny",
            "cpd_event" => "cpd",
            "elevate_environment" => "elevate_environments",
            _ => recordType.Trim().ToLowerInvariant()
        };

        return string.Equals(expectedModuleKey, moduleKey, StringComparison.OrdinalIgnoreCase);
    }
}
