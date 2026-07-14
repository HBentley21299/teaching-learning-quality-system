using TLQS.Application.Security;

namespace TLQS.Application.Workflows;

public static class MyTeamAccessPolicy
{
    public static bool CanView(CurrentUser currentUser) =>
        currentUser.HasPermission(PermissionKeys.MyTeamView);

    public static bool CanOpenStaffProfile(CurrentUser currentUser) =>
        currentUser.HasPermission(PermissionKeys.ReportsViewScoped)
        || currentUser.HasPermission(PermissionKeys.ReportsViewAll)
        || currentUser.HasPermission(PermissionKeys.StaffManage)
        || currentUser.HasPermission(PermissionKeys.UsersManage);

    public static bool CanManageActions(CurrentUser currentUser) =>
        currentUser.HasPermission(PermissionKeys.ActionsManage);
}
