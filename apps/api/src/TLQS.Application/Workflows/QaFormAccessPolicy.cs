namespace TLQS.Application.Workflows;

public static class QaFormAccessPolicy
{
    // The whitelist narrows the additive QA Staff role; it never grants a permission.
    public static bool CanComplete(bool canSubmit, bool canManage, bool isQaStaff,
        bool independentCollegeSubmission, bool restricted, bool listed) =>
        canSubmit && (canManage || !isQaStaff || independentCollegeSubmission || !restricted || listed);
}
