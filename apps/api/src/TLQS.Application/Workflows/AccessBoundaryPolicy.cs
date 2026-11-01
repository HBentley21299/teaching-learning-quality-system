using TLQS.Application.Security;

namespace TLQS.Application.Workflows;

public static class AccessBoundaryPolicy
{
    public static bool CanCreateGenericRecord(CurrentUser currentUser) =>
        currentUser.HasPermission(PermissionKeys.FormsManage);

    public static bool CanManageVisibleAction(CurrentUser currentUser, bool actionIsVisible) =>
        CanManageVisibleAction(currentUser,actionIsVisible,false,false);

    public static bool CanManageVisibleAction(CurrentUser currentUser, bool actionIsVisible, string? sourceFormType) =>
        CanManageVisibleAction(currentUser,actionIsVisible,false,false);

    public static bool CanManageVisibleAction(CurrentUser currentUser,bool actionIsVisible,bool isCreator,bool managesCreator) =>
        actionIsVisible && currentUser.UserAccountId.HasValue
        && (currentUser.IsAdministrator || currentUser.IsTeachingLearning || isCreator || managesCreator);

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
