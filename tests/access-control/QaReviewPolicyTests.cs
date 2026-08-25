using TLQS.Application.Security;
using TLQS.Application.Workflows;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class QaReviewPolicyTests
{
    [Theory]
    [InlineData(PermissionKeys.QaReviewsViewAll)]
    [InlineData(PermissionKeys.QaReviewsViewScoped)]
    public void HubRequiresAnExplicitQaViewGrant(string permission) =>
        Assert.True(QaReviewPolicy.HasHubPermission(User(permission)));

    [Fact]
    public void OrdinaryTutorPermissionsDoNotExposeQaHub() =>
        Assert.False(QaReviewPolicy.HasHubPermission(User(PermissionKeys.CpdSelfLog, PermissionKeys.ElevatePracticeSubmit)));

    [Theory]
    [InlineData(PermissionKeys.QaReviewsSubmitAll)]
    [InlineData(PermissionKeys.QaReviewsSubmitScoped)]
    public void EvidenceSubmissionRequiresAnExplicitQaSubmitGrant(string permission) =>
        Assert.True(QaReviewPolicy.CanSubmitByPermission(User(permission)));

    [Fact]
    public void LegacyIndividualAssignmentPermissionsDoNotExposeQaHub()
    {
        var user = User(PermissionKeys.QaReviewsViewAssigned, PermissionKeys.QaReviewsSubmitAssigned);
        Assert.False(QaReviewPolicy.HasHubPermission(user));
        Assert.False(QaReviewPolicy.CanSubmitByPermission(user));
    }

    [Fact]
    public void QaStaffCollegeWideGrantDoesNotConferManagement()
    {
        var user = User(PermissionKeys.QaReviewsViewAll, PermissionKeys.QaReviewsSubmitAll);
        Assert.True(QaReviewPolicy.HasHubPermission(user));
        Assert.True(QaReviewPolicy.CanSubmitByPermission(user));
        Assert.False(QaReviewPolicy.CanManage(user));
        Assert.False(QaReviewPolicy.CanCorrect(user));
        Assert.False(QaReviewPolicy.CanRemove(user));
    }

    [Fact]
    public void EvidenceRemovalIsSeparateFromCorrectionAndManagement()
    {
        Assert.False(QaReviewPolicy.CanRemove(User(PermissionKeys.QaReviewsManage, PermissionKeys.QaReviewsCorrect)));
        Assert.True(QaReviewPolicy.CanRemove(User(PermissionKeys.QaReviewsRemove)));
    }

    [Fact]
    public void ReviewManagersCanCreateActionsWithoutReceivingCollegeWideMonitoring()
    {
        var user = User(PermissionKeys.QaReviewsManage);
        Assert.True(QaReviewPolicy.CanManageActions(user));
        Assert.True(QaReviewPolicy.CanReviewActions(user));
        Assert.False(QaReviewPolicy.CanMonitorActions(user));
    }

    [Fact]
    public void QaActionMonitoringRequiresTheAdministratorGrant() =>
        Assert.True(QaReviewPolicy.CanMonitorActions(User(PermissionKeys.QaReviewsActionsAdmin)));

    [Fact]
    public void ReviewOwnerCanUseEmbeddedActionsWithoutAdministratorMonitoring()
    {
        var staffId = Guid.NewGuid();
        var user = UserWithStaff(staffId, PermissionKeys.QaReviewsViewScoped);
        Assert.True(QaReviewPolicy.CanUseEmbeddedActions(user, staffId));
        Assert.False(QaReviewPolicy.CanUseEmbeddedActions(user, Guid.NewGuid()));
    }

    [Fact]
    public void ActionAdministratorsCanUseEmbeddedActionsForAnyReview() =>
        Assert.True(QaReviewPolicy.CanUseEmbeddedActions(User(PermissionKeys.QaReviewsActionsAdmin), Guid.NewGuid()));

    [Theory]
    [InlineData("draft", "open", true)]
    [InlineData("open", "close", true)]
    [InlineData("reopened", "close", true)]
    [InlineData("closed", "reopen", true)]
    [InlineData("draft", "archive", true)]
    [InlineData("closed", "archive", true)]
    [InlineData("open", "archive", false)]
    [InlineData("closed", "open", false)]
    [InlineData("archived", "reopen", false)]
    public void LifecycleOnlyAllowsDefinedTransitions(string status, string action, bool expected) =>
        Assert.Equal(expected, QaReviewPolicy.CanTransition(status, action));

    [Theory]
    [InlineData("open", true)]
    [InlineData("reopened", true)]
    [InlineData("draft", false)]
    [InlineData("closed", false)]
    [InlineData("archived", false)]
    public void EvidenceWritesAreLockedOutsideOpenStates(string status, bool expected) =>
        Assert.Equal(expected, QaReviewPolicy.IsEvidenceWritable(status));

    [Theory]
    [InlineData("below")]
    [InlineData("at")]
    [InlineData("above")]
    public void StandardOutcomesDoNotRequireNarrativeComments(string outcome)
    {
        Assert.Null(QaReviewPolicy.ValidateResponse(true, false, true, outcome, null, null, true));
    }

    [Fact]
    public void NotApplicableIsRejectedWhenItIsNotEnabled()
    {
        var message = QaReviewPolicy.ValidateResponse(true, false, false, "not_applicable", null, null, true);
        Assert.StartsWith("Not applicable is not enabled", message);
    }

    [Fact]
    public void NotApplicableRequiresAReasonWhenEnabled()
    {
        Assert.Equal("Add a reason for Not applicable.",
            QaReviewPolicy.ValidateResponse(true, true, false, "not_applicable", null, null, true));
        Assert.Null(QaReviewPolicy.ValidateResponse(true, true, false, "not_applicable", null, "Not observed", true));
    }

    [Fact]
    public void DashboardDistributionUsesCountsAndDenominatorNotAnAverage()
    {
        var result = QaReviewPolicy.CalculateDistribution(["below", "at", "above", "above", "not_applicable"]);
        Assert.Equal(1, result.Below);
        Assert.Equal(1, result.At);
        Assert.Equal(2, result.Above);
        Assert.Equal(1, result.NotApplicable);
        Assert.Equal(4, result.Rated);
        Assert.Equal(75m, result.AtOrAbovePercentage);
    }

    private static CurrentUser User(params string[] permissions) => new(
        Guid.NewGuid(), Guid.NewGuid(), "QA Test", "qa.test@example.test",
        new HashSet<string>(permissions, StringComparer.OrdinalIgnoreCase), []);

    private static CurrentUser UserWithStaff(Guid staffId, params string[] permissions) => new(
        Guid.NewGuid(), staffId, "QA Test", "qa.test@example.test",
        new HashSet<string>(permissions, StringComparer.OrdinalIgnoreCase), []);
}
