using TLQS.Application.Security;

namespace TLQS.Application.Workflows;

public static class ElevatePracticeAccessPolicy
{
    public static bool CanEdit(
        CurrentUser currentUser,
        Guid subjectStaffId,
        string status,
        int? managementDepth) =>
        AdministrationAccessPolicy.CanManageRecords(currentUser)
        || (status == "submitted"
            && currentUser.StaffId.HasValue
            && currentUser.StaffId != subjectStaffId
            && managementDepth > 0);
}
