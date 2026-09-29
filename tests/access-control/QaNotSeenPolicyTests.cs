using TLQS.Application.Workflows;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class QaNotSeenPolicyTests
{
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void EnabledNeutralResponseSatisfiesRequiredQuestionWithoutNaReason(bool submitting)
    {
        Assert.Null(QaReviewPolicy.ValidateResponse(true, false, true, "not_seen", null, null, submitting, allowsNotSeen: true));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("at")]
    [InlineData("not_applicable")]
    public void DisabledFormCannotIntroduceANewNeutralResponse(string? saved)
    {
        Assert.NotNull(QaReviewPolicy.ValidateResponse(true, true, false, "not_seen", null, null, true, savedOutcome: saved));
    }

    [Fact]
    public void SwitchingOffAFormRetainsPreviouslySavedNeutralResponses()
    {
        Assert.Null(QaReviewPolicy.ValidateResponse(true, false, false, "not_seen", "Additional context", null, true, savedOutcome: "not_seen"));
        Assert.Null(QaReviewPolicy.ValidateResponse(true, false, false, "at", null, null, true, savedOutcome: "not_seen"));
    }

    [Fact]
    public void NeutralOutcomesRemainDistinctFromNaAndMissingAnswers()
    {
        var counts = QaReviewPolicy.CalculateDistribution(["below", "at", "above", "not_seen", "not_seen", "not_applicable", null]);
        Assert.Equal(3, counts.Rated);
        Assert.Equal(2, counts.NotSeen);
        Assert.Equal(1, counts.NotApplicable);
        Assert.Equal(66.7m, counts.AtOrAbovePercentage);
        Assert.NotNull(QaReviewPolicy.ValidateResponse(true, false, false, null, null, null, true, allowsNotSeen: true));
        Assert.NotNull(QaReviewPolicy.ValidateResponse(true, false, false, "not_applicable", null, "Reason", true, allowsNotSeen: true));
    }

    [Fact]
    public void NeutralWordingCannotBeReusedForAScoredOutcome()
    {
        Assert.Throws<WorkflowValidationException>(() => QaOutcomeLabels.Validate(" Not seen ", "At standard", "Above standard", "Not applicable"));
    }
}
