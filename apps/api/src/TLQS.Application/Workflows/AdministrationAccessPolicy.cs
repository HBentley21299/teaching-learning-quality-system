using TLQS.Application.Security;

namespace TLQS.Application.Workflows;

public static class AdministrationAccessPolicy
{
    public static bool CanOpenAdminCentre(CurrentUser currentUser) =>
        CanManagePeopleAndAccess(currentUser)
        || CanManageOrganisation(currentUser)
        || CanManageLists(currentUser)
        || CanManageForms(currentUser)
        || CanManageRecords(currentUser)
        || CanManageMessaging(currentUser);

    public static bool CanManagePeopleAndAccess(CurrentUser currentUser) =>
        currentUser.HasPermission(PermissionKeys.UsersManage)
        || currentUser.HasPermission(PermissionKeys.PermissionsManage);

    public static bool CanManageOrganisation(CurrentUser currentUser) =>
        currentUser.HasPermission(PermissionKeys.OrganisationManage);

    public static bool CanManageLists(CurrentUser currentUser) =>
        currentUser.HasPermission(PermissionKeys.ListsManage);

    public static bool CanManageForms(CurrentUser currentUser) =>
        currentUser.HasPermission(PermissionKeys.FormsManage);

    public static bool CanManageRecords(CurrentUser currentUser) =>
        currentUser.HasPermission(PermissionKeys.RecordsManage);

    public static bool CanManageMessaging(CurrentUser currentUser) =>
        currentUser.HasPermission(PermissionKeys.MessagingManage);
}
