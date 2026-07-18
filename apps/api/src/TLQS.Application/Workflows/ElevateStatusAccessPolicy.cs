using TLQS.Application.Security;

namespace TLQS.Application.Workflows;

public static class ElevateStatusAccessPolicy
{
    public static bool CanManageControlledLevels(CurrentUser currentUser) =>
        currentUser.HasPermission(PermissionKeys.ElevateStatusManage);

    public static bool CanUpdateLevel(CurrentUser currentUser, Guid staffId, int levelNumber) =>
        levelNumber is >= 1 and <= 5
        && (CanManageControlledLevels(currentUser)
            || (levelNumber == 1 && currentUser.StaffId == staffId));
}
