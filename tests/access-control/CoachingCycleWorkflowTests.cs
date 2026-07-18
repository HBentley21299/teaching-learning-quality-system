using TLQS.Application.Workflows;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class CoachingCycleWorkflowTests
{
    [Theory]
    [InlineData(CoachingCycleWorkflow.NotStarted, "open")]
    [InlineData(CoachingCycleWorkflow.InProgress, "open")]
    [InlineData(CoachingCycleWorkflow.Completed, "complete")]
    [InlineData(CoachingCycleWorkflow.Closed, "cancelled")]
    public void CoachingStatusMapsToCentralActionEngine(string status, string expected)
    {
        Assert.Equal(expected, CoachingCycleWorkflow.GetCentralActionStatus(status));
    }

    [Theory]
    [InlineData(CoachingCycleWorkflow.ReviewCompleted, CoachingCycleWorkflow.Completed, "complete")]
    [InlineData(CoachingCycleWorkflow.ReviewContinue, CoachingCycleWorkflow.InProgress, "open")]
    [InlineData(CoachingCycleWorkflow.ReviewRevised, CoachingCycleWorkflow.Closed, "cancelled")]
    [InlineData(CoachingCycleWorkflow.ReviewClosedWithoutCompletion, CoachingCycleWorkflow.Closed, "cancelled")]
    public void ReviewOutcomePreservesActionLifecycle(string outcome, string progress, string central)
    {
        Assert.Equal(progress, CoachingCycleWorkflow.GetProgressStatusForReview(outcome));
        Assert.Equal(central, CoachingCycleWorkflow.GetCentralStatusForReview(outcome));
    }

    [Fact]
    public void CycleClosureRequiresEveryActionToBeCompletedOrClosed()
    {
        Assert.True(CoachingCycleWorkflow.CanCloseCycle([
            CoachingCycleWorkflow.ReviewCompleted,
            CoachingCycleWorkflow.ReviewClosedWithoutCompletion
        ]));
        Assert.False(CoachingCycleWorkflow.CanCloseCycle([
            CoachingCycleWorkflow.ReviewCompleted,
            CoachingCycleWorkflow.ReviewContinue
        ]));
    }

    [Fact]
    public void RevisedActionSatisfiesTheNewActionRequirement()
    {
        Assert.True(CoachingCycleWorkflow.MeetsActionRequirement(0, 1, closesCycle: false));
        Assert.False(CoachingCycleWorkflow.MeetsActionRequirement(0, 0, closesCycle: false));
        Assert.True(CoachingCycleWorkflow.MeetsActionRequirement(0, 0, closesCycle: true));
    }

    [Fact]
    public void ConfiguredActionLimitIsEnforced()
    {
        Assert.True(CoachingCycleWorkflow.IsWithinActionLimit(3, 3));
        Assert.False(CoachingCycleWorkflow.IsWithinActionLimit(4, 3));
        Assert.False(CoachingCycleWorkflow.IsWithinActionLimit(1, 11));
    }
}
