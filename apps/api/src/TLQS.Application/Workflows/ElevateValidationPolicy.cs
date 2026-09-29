using TLQS.Application.Security;

namespace TLQS.Application.Workflows;

public static class ElevateValidationPolicy
{
    public static bool HasReviewPermission(CurrentUser user) =>
        user.HasPermission(PermissionKeys.ElevatePracticeValidate) || AdministrationAccessPolicy.CanManageRecords(user);

    public static bool CanReview(CurrentUser user, Guid staffId, bool inScope) =>
        user.StaffId.HasValue && user.StaffId != staffId && HasReviewPermission(user)
        && (AdministrationAccessPolicy.CanManageRecords(user) || inScope);

    public static void ValidateDecision(string assessmentStatus, string validationStatus, string action, string? note)
    {
        if (assessmentStatus != "submitted" || validationStatus != "pending")
            throw new WorkflowValidationException("Only a submitted assessment awaiting validation can be reviewed. Refresh the assessment.");
        if (action is not ("validate" or "return")) throw new WorkflowValidationException("Choose Validate or Return for amendments.");
        if (action == "return" && string.IsNullOrWhiteSpace(note))
            throw new WorkflowValidationException("Explain which statements need amending before returning the assessment.");
        if (note?.Length > 4000) throw new WorkflowValidationException("Keep review feedback within 4,000 characters.");
    }

    public static string AfterContentSave(string assessmentStatus, string previousValidationStatus) =>
        assessmentStatus == "submitted" ? "pending" : previousValidationStatus == "returned" ? "returned" : "draft";
}
