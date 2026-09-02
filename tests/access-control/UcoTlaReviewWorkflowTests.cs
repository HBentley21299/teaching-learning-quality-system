using TLQS.Application.Security;
using TLQS.Application.Workflows;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class UcoTlaReviewWorkflowTests
{
    [Fact]
    public void RecordAdministratorsCanManageEveryUcoReview()
    {
        Assert.True(UcoTlaReviewAccessPolicy.CanManageAll(CreateUser(PermissionKeys.RecordsManage)));
        Assert.True(UcoTlaReviewAccessPolicy.CanManageAll(CreateUser(PermissionKeys.UcoTlaManage)));
        Assert.False(UcoTlaReviewAccessPolicy.CanManageAll(CreateUser(PermissionKeys.ReportsViewAll)));
        Assert.True(UcoTlaReviewAccessPolicy.CanViewAll(CreateUser(PermissionKeys.ReportsViewAll)));
    }

    [Theory]
    [InlineData("observer_draft", "submit", "awaiting_lecturer")]
    [InlineData("awaiting_lecturer", "acknowledge", "awaiting_finalisation")]
    [InlineData("awaiting_finalisation", "finalise", "completed")]
    [InlineData("completed", "reopen", "observer_draft")]
    public void ValidTransitionsAdvanceToExpectedState(string state, string action, string expected)
    {
        Assert.Equal(expected, UcoTlaReviewWorkflow.Transition(state, action));
    }

    [Fact]
    public void RemovedModerationActionsAreRejected()
    {
        Assert.Throws<WorkflowValidationException>(() =>
            UcoTlaReviewWorkflow.Transition(UcoTlaReviewWorkflow.ObserverDraft, "approve"));
    }

    [Theory]
    [InlineData("observer_draft", "acknowledge")]
    [InlineData("observer_draft", "approve")]
    [InlineData("observer_draft", "return")]
    [InlineData("awaiting_lecturer", "return")]
    [InlineData("awaiting_finalisation", "submit")]
    [InlineData("completed", "finalise")]
    public void InvalidTransitionsAreRejected(string state, string action)
    {
        Assert.Throws<WorkflowValidationException>(() => UcoTlaReviewWorkflow.Transition(state, action));
    }

    [Fact]
    public void LecturerCannotSeeFindingsBeforeObserverSubmission()
    {
        Assert.False(UcoTlaReviewWorkflow.CanViewObserverFindings(UcoTlaReviewWorkflow.ObserverDraft, true));
        Assert.True(UcoTlaReviewWorkflow.CanViewObserverFindings(UcoTlaReviewWorkflow.AwaitingLecturer, true));
    }

    [Fact]
    public void ParticipantsMustBeDistinct()
    {
        var staff = Guid.NewGuid();
        Assert.Throws<WorkflowValidationException>(() =>
            UcoTlaReviewWorkflow.ValidatePeople(staff, staff));
    }

    [Theory]
    [InlineData(10, 11, 0)]
    [InlineData(10, 8, 9)]
    [InlineData(-1, 0, 0)]
    public void InvalidAttendanceIsRejected(int registered, int present, int late)
    {
        Assert.Throws<WorkflowValidationException>(() =>
            UcoTlaReviewWorkflow.ValidateAttendance(registered, present, late));
    }

    [Fact]
    public void EssentialFindingRequiresActionAndEightToTwelveWeekFollowUp()
    {
        var discussion = new DateTimeOffset(2026, 9, 1, 10, 0, 0, TimeSpan.Zero);
        Assert.Throws<WorkflowValidationException>(() =>
            UcoTlaReviewWorkflow.ValidateEssentialFollowUp(true, false, discussion, discussion.AddDays(63)));
        Assert.Throws<WorkflowValidationException>(() =>
            UcoTlaReviewWorkflow.ValidateEssentialFollowUp(true, true, discussion, discussion.AddDays(50)));

        UcoTlaReviewWorkflow.ValidateEssentialFollowUp(true, true, discussion, discussion.AddDays(70));
    }

    [Fact]
    public void ActionPlanIsLimitedToThreeRows()
    {
        Assert.Throws<WorkflowValidationException>(() =>
            UcoTlaReviewWorkflow.ValidateActionPlans(
                new[] { "essential", "advisable", "advisable", "good_practice" }, value => value));
    }

    [Fact]
    public void CompletedFindingsStayLockedUntilReopened()
    {
        Assert.False(UcoTlaReviewWorkflow.CanEditObserverSection(UcoTlaReviewWorkflow.Completed, true, true));
        Assert.Equal(UcoTlaReviewWorkflow.ObserverDraft,
            UcoTlaReviewWorkflow.Transition(UcoTlaReviewWorkflow.Completed, "reopen"));
    }

    [Fact]
    public void AccessMatrixIncludesParticipantsLineManagersAndExecutiveOversight()
    {
        var lecturer = Guid.NewGuid();
        var observer = Guid.NewGuid();
        var lineManager = Guid.NewGuid();
        var unrelated = Guid.NewGuid();

        Assert.True(UcoTlaReviewWorkflow.CanAccessRecord("observer_draft", unrelated, lecturer, observer, false, true)); // coordinator, admin or executive oversight
        Assert.True(UcoTlaReviewWorkflow.CanAccessRecord("observer_draft", observer, lecturer, observer, false, false));
        Assert.True(UcoTlaReviewWorkflow.CanAccessRecord("observer_draft", lecturer, lecturer, observer, false, false));
        Assert.True(UcoTlaReviewWorkflow.CanAccessRecord("observer_draft", lineManager, lecturer, observer, true, false));
        Assert.False(UcoTlaReviewWorkflow.CanAccessRecord("completed", unrelated, lecturer, observer, false, false));
    }

    [Fact]
    public void CompletedReportIsUnavailableUntilFinalSignOff()
    {
        var lecturer = Guid.NewGuid();
        var observer = Guid.NewGuid();
        Assert.False(UcoTlaReviewWorkflow.CanViewCompletedReport("awaiting_finalisation", lecturer,
            lecturer, observer, false, false));
        Assert.True(UcoTlaReviewWorkflow.CanViewCompletedReport("completed", lecturer,
            lecturer, observer, false, false));
    }

    private static CurrentUser CreateUser(params string[] permissions) => new(
        Guid.NewGuid(), Guid.NewGuid(), "Test administrator", "admin.test@oldham.ac.uk",
        new HashSet<string>(permissions, StringComparer.OrdinalIgnoreCase), []);
}
