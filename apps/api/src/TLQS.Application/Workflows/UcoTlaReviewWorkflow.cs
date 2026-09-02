namespace TLQS.Application.Workflows;

public static class UcoTlaReviewWorkflow
{
    public const string ObserverDraft = "observer_draft";
    public const string AwaitingLecturer = "awaiting_lecturer";
    public const string AwaitingFinalisation = "awaiting_finalisation";
    public const string Completed = "completed";
    public const string Archived = "archived";

    public static bool CanEditObserverSection(string status, bool isAssignedObserver, bool canManage) =>
        (isAssignedObserver || canManage) && status == ObserverDraft;

    public static bool CanReflect(string status, bool isLecturer) =>
        isLecturer && status == AwaitingLecturer;

    public static bool CanFinalise(string status, bool isAssignedObserver) =>
        isAssignedObserver && status == AwaitingFinalisation;

    public static bool CanViewObserverFindings(string status, bool isLecturer) =>
        !isLecturer || status is AwaitingLecturer or AwaitingFinalisation or Completed or Archived;

    public static bool CanAccessRecord(
        string status,
        Guid? currentStaffId,
        Guid lecturerStaffId,
        Guid observerStaffId,
        bool isCurrentLineManager,
        bool canViewAll) =>
        canViewAll
        || currentStaffId == lecturerStaffId
        || currentStaffId == observerStaffId
        || isCurrentLineManager;

    public static bool CanViewCompletedReport(
        string status,
        Guid? currentStaffId,
        Guid lecturerStaffId,
        Guid observerStaffId,
        bool isCurrentLineManager,
        bool canViewAll) =>
        status == Completed && CanAccessRecord(status, currentStaffId, lecturerStaffId, observerStaffId,
            isCurrentLineManager, canViewAll);

    public static string Transition(string status, string action) => (status, action.Trim().ToLowerInvariant()) switch
    {
        (ObserverDraft, "submit") => AwaitingLecturer,
        (AwaitingLecturer, "acknowledge") => AwaitingFinalisation,
        (AwaitingFinalisation, "finalise") => Completed,
        (Completed, "reopen") => ObserverDraft,
        (_, "archive") when status != Archived => Archived,
        _ => throw new WorkflowValidationException($"A {status} UCO TLA Review cannot be changed with '{action}'.")
    };

    public static void ValidatePeople(Guid lecturerId, Guid observerId)
    {
        if (lecturerId == observerId)
            throw new WorkflowValidationException("The lecturer and observer must be different active staff members.");
    }

    public static void ValidateAttendance(int? registered, int? present, int? late)
    {
        if (registered is < 0 || present is < 0 || late is < 0)
            throw new WorkflowValidationException("Attendance values cannot be negative.");
        if (registered.HasValue && present > registered)
            throw new WorkflowValidationException("The number present cannot exceed the number on register.");
        if (present.HasValue && late > present)
            throw new WorkflowValidationException("The number arriving late cannot exceed the number present.");
    }

    public static void ValidateActionPlans<T>(IReadOnlyCollection<T> actions, Func<T, string> actionType)
    {
        if (actions.Count > 3)
            throw new WorkflowValidationException("A UCO TLA Review can contain no more than three development actions.");
        if (actions.Count > 0 && actions.Any(action => string.IsNullOrWhiteSpace(actionType(action))))
            throw new WorkflowValidationException("Select a type for every development action.");
    }

    public static void ValidateEssentialFollowUp(
        bool hasEssentialFinding,
        bool hasEssentialAction,
        DateTimeOffset? professionalDiscussionAt,
        DateTimeOffset? followUpAt)
    {
        if (!hasEssentialFinding) return;
        if (!hasEssentialAction)
            throw new WorkflowValidationException("Essential findings require at least one tracked essential action.");
        if (!professionalDiscussionAt.HasValue || !followUpAt.HasValue)
            throw new WorkflowValidationException("Essential findings require a follow-up checkpoint 8 to 12 weeks after the professional discussion.");

        var minimum = professionalDiscussionAt.Value.Date.AddDays(56);
        var maximum = professionalDiscussionAt.Value.Date.AddDays(84);
        if (followUpAt.Value.Date < minimum || followUpAt.Value.Date > maximum)
            throw new WorkflowValidationException("Schedule the essential-action follow-up 8 to 12 weeks after the professional discussion.");
    }

    public static void RequireReason(string? reason, string message)
    {
        if (string.IsNullOrWhiteSpace(reason)) throw new WorkflowValidationException(message);
    }
}
