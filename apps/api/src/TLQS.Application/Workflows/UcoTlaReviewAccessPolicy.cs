using TLQS.Application.Security;

namespace TLQS.Application.Workflows;

public static class UcoTlaReviewAccessPolicy
{
    public static bool CanManageAll(CurrentUser currentUser) =>
        currentUser.HasPermission(PermissionKeys.UcoTlaManage)
        || currentUser.HasPermission(PermissionKeys.RecordsManage);

    public static bool CanViewAll(CurrentUser currentUser) =>
        CanManageAll(currentUser)
        || currentUser.HasPermission(PermissionKeys.ReportsViewAll);
}
