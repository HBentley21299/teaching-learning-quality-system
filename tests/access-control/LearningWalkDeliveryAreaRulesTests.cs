using TLQS.Application.Workflows;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class LearningWalkDeliveryAreaRulesTests
{
    [Theory]
    [InlineData("learning_walk", "liv_delivery_area")]
    [InlineData("als_learning_walk", "als_liv_delivery_area")]
    [InlineData("work_scrutiny", "liv_delivery_area")]
    public void UsesMatchingLivCatalogue(string process, string lookup) =>
        Assert.Equal(lookup, LearningWalkDeliveryAreaRules.LookupKey(process));

    [Fact]
    public void NewSubmissionRequiresSelection() => Assert.Throws<WorkflowValidationException>(() =>
        LearningWalkDeliveryAreaRules.Validate(null, null, false, true));

    [Fact]
    public void DraftAndHistoricalMissingSelectionCanRemainMissing() =>
        LearningWalkDeliveryAreaRules.Validate(null, null, false, false);

    [Fact]
    public void HistoricalRetiredSelectionCanBeRetained() =>
        LearningWalkDeliveryAreaRules.Validate("retired", "retired", false, true);

    [Fact]
    public void RetiredSelectionCannotBeIntroduced() => Assert.Throws<WorkflowValidationException>(() =>
        LearningWalkDeliveryAreaRules.Validate("retired", "active", false, true));

    [Fact]
    public void RecordedSelectionCannotBeSilentlyCleared() => Assert.Throws<WorkflowValidationException>(() =>
        LearningWalkDeliveryAreaRules.Validate(null, "active", false, false));

    [Fact]
    public void ActiveSelectionCanReplaceRetiredValue() =>
        LearningWalkDeliveryAreaRules.Validate("active", "retired", true, true);
}
