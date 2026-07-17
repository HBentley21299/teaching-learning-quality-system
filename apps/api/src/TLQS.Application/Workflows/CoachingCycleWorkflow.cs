namespace TLQS.Application.Workflows;

public static class CoachingCycleWorkflow
{
    public const string NotStarted = "not_started";
    public const string InProgress = "in_progress";
    public const string Completed = "completed";
    public const string Closed = "closed";

    public const string ReviewCompleted = "completed";
    public const string ReviewContinue = "continue";
    public const string ReviewRevised = "revised";
    public const string ReviewClosedWithoutCompletion = "closed_without_completion";

    public static string GetCentralActionStatus(string progressStatus) =>
        progressStatus.ToLowerInvariant() switch
        {
            Completed => "complete",
            Closed => "cancelled",
            _ => "open"
        };

    public static string GetProgressStatusForReview(string reviewOutcome) =>
        reviewOutcome.ToLowerInvariant() switch
        {
            ReviewCompleted => Completed,
            ReviewContinue => InProgress,
            ReviewRevised or ReviewClosedWithoutCompletion => Closed,
            _ => NotStarted
        };

    public static string GetCentralStatusForReview(string reviewOutcome) =>
        reviewOutcome.ToLowerInvariant() switch
        {
            ReviewCompleted => "complete",
            ReviewRevised or ReviewClosedWithoutCompletion => "cancelled",
            _ => "open"
        };

    public static bool CanCloseCycle(IEnumerable<string> reviewOutcomes) =>
        reviewOutcomes.All(outcome =>
            outcome.Equals(ReviewCompleted, StringComparison.OrdinalIgnoreCase)
            || outcome.Equals(ReviewClosedWithoutCompletion, StringComparison.OrdinalIgnoreCase));

    public static bool MeetsActionRequirement(int newActionCount, int revisedActionCount, bool closesCycle) =>
        closesCycle || newActionCount + revisedActionCount > 0;

    public static bool IsWithinActionLimit(int actionCount, int maximum) =>
        maximum is >= 1 and <= 10 && actionCount <= maximum;
}
