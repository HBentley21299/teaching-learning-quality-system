namespace TLQS.Application.Workflows;

public static class LivAccessPolicy
{
    public const string InProgress = "in_progress";
    public const string Closed = "closed";

    public static bool CanEdit(string status, bool isCreator, bool canManage) =>
        isCreator || canManage;

    public static bool CanViewSensitive(bool isCreator, bool isAdministrator, bool hasSensitivePermission) =>
        isCreator || isAdministrator || hasSensitivePermission;

    public static bool CanViewSection(bool visibleToStaff, bool canEditReview, bool canViewSensitive) =>
        visibleToStaff || canEditReview || canViewSensitive;

    public static bool CanManageVisibility(Guid? creatorAccountId, Guid? currentAccountId) =>
        creatorAccountId.HasValue && creatorAccountId == currentAccountId;

    public static string NormalizeStageStatus(string? value, string stageType, int cycleNumber)
    {
        var status = value?.Trim().ToLowerInvariant() ?? InProgress;
        if (status == "not_applicable" && (stageType != "follow_up_review" || cycleNumber < 2))
            throw new WorkflowValidationException("Not applicable is only available for the follow-up review from cycle 2 onwards. Every LIV must progress to cycle 2.");
        return status is InProgress or "completed" or "not_applicable"
            ? status
            : throw new WorkflowValidationException("The selected LIV stage status is invalid.");
    }

    public static void ValidateCycleCompletion(int cycleNumber, bool openFollowUp)
    {
        if (cycleNumber < 2 && !openFollowUp)
            throw new WorkflowValidationException("Every LIV must progress to cycle 2 before it can be closed.");
    }
}
