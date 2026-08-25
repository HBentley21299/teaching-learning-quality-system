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
        bool submitting)
    {
        var normalized = outcome?.Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(normalized))
        {
            return submitting && isRequired ? "Select an outcome." : null;
        }

        if (normalized is not ("below" or "at" or "above" or "not_applicable"))
        {
            return "Select a valid QA outcome.";
        }

        if (normalized == "not_applicable")
        {
            if (!allowsNotApplicable) return "Not applicable is not enabled for this criterion.";
            if (string.IsNullOrWhiteSpace(notApplicableReason)) return "Add a reason for Not applicable.";
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
            rated == 0 ? 0 : Math.Round((decimal)(at + above) * 100m / rated, 1));
    }
}

public sealed record QaOutcomeDistribution(
    int Below,
    int At,
    int Above,
    int NotApplicable,
    int Rated,
    decimal AtOrAbovePercentage);
