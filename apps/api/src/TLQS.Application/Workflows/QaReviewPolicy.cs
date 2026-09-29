using TLQS.Application.Security;

namespace TLQS.Application.Workflows;

public static class QaReviewPolicy
{
    public static readonly IReadOnlySet<string> OpenEvidenceStatuses =
        new HashSet<string>(["open", "reopened"], StringComparer.OrdinalIgnoreCase);

    public static bool HasHubPermission(CurrentUser user) =>
        user.HasPermission(PermissionKeys.QaReviewsViewAll)
        || user.HasPermission(PermissionKeys.QaReviewsViewScoped);

    public static bool CanManage(CurrentUser user) => user.HasPermission(PermissionKeys.QaReviewsManage);

    public static bool CanConfigure(CurrentUser user, string status) =>
        CanManage(user) && status.Trim().ToLowerInvariant() is "draft" or "open" or "reopened";

    public static void ValidatePublishedStructure(QaPublishedReviewStructure existing, QaPublishedReviewStructure requested)
    {
        if (!string.Equals(existing.AcademicYear, requested.AcademicYear, StringComparison.Ordinal)
            || !string.Equals(existing.QuestionTag, requested.QuestionTag, StringComparison.OrdinalIgnoreCase)
            || existing.PlannedOpenDate != requested.PlannedOpenDate)
            throw new WorkflowValidationException("The academic year, question tag and planned opening date are fixed after publication.");

        if (existing.TeamOrgUnitIds.Except(requested.TeamOrgUnitIds).Any())
            throw new WorkflowValidationException("Teams already included in a published review must remain included. You can add more teams or faculties.");

        if (existing.Activities.Count != requested.Activities.Count
            || existing.Activities.Zip(requested.Activities).Any(pair =>
                pair.First.ActivityTypeId != pair.Second.ActivityTypeId
                || pair.First.TemplateId != pair.Second.TemplateId
                || !pair.First.QuestionIds.ToHashSet().SetEquals(pair.Second.QuestionIds)))
            throw new WorkflowValidationException("Published activities, templates and questions are fixed to protect submitted evidence and reporting. Create another review for different questions.");
    }

    public static bool CanCorrect(CurrentUser user) => user.HasPermission(PermissionKeys.QaReviewsCorrect);

    public static bool CanRemove(CurrentUser user) => user.HasPermission(PermissionKeys.QaReviewsRemove);

    public static bool CanManageActions(CurrentUser user) => user.HasPermission(PermissionKeys.QaReviewsManage);

    public static bool CanMonitorActions(CurrentUser user) => user.HasPermission(PermissionKeys.QaReviewsActionsAdmin);

    public static bool CanReviewActions(CurrentUser user) =>
        CanManage(user) || CanMonitorActions(user);

    public static bool CanUseEmbeddedActions(CurrentUser user, Guid ownerStaffId) =>
        CanMonitorActions(user) || user.StaffId == ownerStaffId;

    public static bool CanSubmitByPermission(CurrentUser user) =>
        user.HasPermission(PermissionKeys.QaReviewsSubmitAll)
        || user.HasPermission(PermissionKeys.QaReviewsSubmitScoped);

    public static bool IsEvidenceWritable(string reviewStatus) => OpenEvidenceStatuses.Contains(reviewStatus);

    public static bool CanTransition(string currentStatus, string action) =>
        (currentStatus.Trim().ToLowerInvariant(), action.Trim().ToLowerInvariant()) switch
        {
            ("draft", "open") => true,
            ("open", "close") => true,
            ("reopened", "close") => true,
            ("closed", "reopen") => true,
            ("draft", "archive") => true,
            ("closed", "archive") => true,
            _ => false
        };

    public static string StatusAfter(string currentStatus, string action)
    {
        if (!CanTransition(currentStatus, action))
        {
            throw new WorkflowValidationException(
                $"A {currentStatus} QA Review cannot be changed using '{action}'.");
        }

        return action.Trim().ToLowerInvariant() switch
        {
            "open" => "open",
            "close" => "closed",
            "reopen" => "reopened",
            "archive" => "archived",
            _ => throw new ArgumentOutOfRangeException(nameof(action))
        };
    }

    public static string? ValidateResponse(
        bool isRequired,
        bool allowsNotApplicable,
        bool commentRequiredAtExpected,
        string? outcome,
        string? comment,
        string? notApplicableReason,
        bool submitting,
        QaOutcomeLabels? labels = null,
        bool allowsNotSeen = false,
        string? savedOutcome = null)
    {
        var normalized = outcome?.Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(normalized))
        {
            return submitting && isRequired ? "Select an outcome." : null;
        }

        if (normalized is not ("below" or "at" or "above" or "not_applicable" or "not_seen"))
        {
            return "Select a valid QA outcome.";
        }

        if (normalized == "not_seen" && !allowsNotSeen && savedOutcome != "not_seen")
            return "Not seen is not enabled for this form.";

        if (normalized == "not_applicable")
        {
            if (!allowsNotApplicable) return $"{(labels ?? QaOutcomeLabels.Default).NotApplicable} is not enabled for this criterion.";
            if (string.IsNullOrWhiteSpace(notApplicableReason)) return $"Add a reason for {(labels ?? QaOutcomeLabels.Default).NotApplicable}.";
        }

        return null;
    }

    public static QaOutcomeDistribution CalculateDistribution(IEnumerable<string?> outcomes)
    {
        var values = outcomes.Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value!.Trim().ToLowerInvariant()).ToArray();
        var below = values.Count(value => value == "below");
        var at = values.Count(value => value == "at");
        var above = values.Count(value => value == "above");
        var notApplicable = values.Count(value => value == "not_applicable");
        var rated = below + at + above;
        return new QaOutcomeDistribution(
            below, at, above, notApplicable, rated,
            rated == 0 ? 0 : Math.Round((decimal)(at + above) * 100m / rated, 1),
            values.Count(value => value == "not_seen"));
    }
}

public sealed record QaOutcomeDistribution(
    int Below,
    int At,
    int Above,
    int NotApplicable,
    int Rated,
    decimal AtOrAbovePercentage,
    int NotSeen = 0);

public sealed record QaPublishedReviewStructure(
    string AcademicYear,
    string QuestionTag,
    DateOnly? PlannedOpenDate,
    IReadOnlyList<Guid> TeamOrgUnitIds,
    IReadOnlyList<QaPublishedReviewActivity> Activities);

public sealed record QaPublishedReviewActivity(Guid ActivityTypeId, Guid TemplateId, IReadOnlyList<Guid> QuestionIds);
