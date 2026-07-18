using TLQS.Application.Forms;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class FormSubmissionRulesTests
{
    [Theory]
    [InlineData("learning_walk_core", "learning_walk")]
    [InlineData("work_scrutiny_engineering", "work_scrutiny")]
    [InlineData("cpd_core", "cpd_event")]
    [InlineData("external_cpd_core", "external_cpd")]
    [InlineData("elevate_learning_environments_core", "elevate_environment")]
    public void KnownTemplateRecordTypePair_AcceptsOnlyConfiguredPair(string templateKey, string recordType)
    {
        Assert.True(FormSubmissionRules.IsKnownTemplateRecordTypePair(templateKey, recordType));
        Assert.False(FormSubmissionRules.IsKnownTemplateRecordTypePair(templateKey, "reflection"));
    }

    [Fact]
    public void TemplateModuleRecordTypePair_RejectsTemplateMovedToWrongModule()
    {
        Assert.True(FormSubmissionRules.IsTemplateModuleRecordTypePair(
            "external_cpd_core", "cpd", "external_cpd"));
        Assert.False(FormSubmissionRules.IsTemplateModuleRecordTypePair(
            "external_cpd_core", "learning_walks", "external_cpd"));
    }

    [Theory]
    [InlineData("learning_walk")]
    [InlineData("external_cpd")]
    [InlineData("reflection")]
    [InlineData("coaching_session")]
    [InlineData("elevate_practice_assessment")]
    public void DedicatedRecords_CannotUseGenericCreateEndpoint(string recordType)
    {
        Assert.True(FormSubmissionRules.RequiresDedicatedWorkflow(recordType));
    }

    [Fact]
    public void RubricValue_MustExactlyMatchAConfiguredToken()
    {
        string[] options =
        [
            "1::Emerging Practice::Descriptor::#B42318",
            "5::Leading Practice::Descriptor::#237A3B"
        ];

        Assert.True(RubricSubmissionRules.IsValidValue(
            "practice_rubric_1_5", options[1], options, "learning_walk", "1.0"));
        Assert.False(RubricSubmissionRules.IsValidValue(
            "practice_rubric_1_5", "5::Leading Practice", options, "learning_walk", "1.0"));
        Assert.False(RubricSubmissionRules.IsValidValue(
            "practice_rubric_1_5", $"{options[1]} ", options, "learning_walk", "1.0"));
    }

    [Theory]
    [InlineData("0", true)]
    [InlineData("3", true)]
    [InlineData("4", false)]
    public void LegacyEnvironmentScore_IsAllowedOnlyWithinVersionOneRange(string value, bool expected)
    {
        Assert.Equal(expected, RubricSubmissionRules.IsValidValue(
            "score_0_3", value, [], "elevate_environment", "1.0"));
        Assert.False(RubricSubmissionRules.IsValidValue(
            "score_0_3", value, [], "elevate_environment", "2.0"));
        Assert.False(RubricSubmissionRules.IsValidValue(
            "score_0_3", value, [], "learning_walk", "1.0"));
    }
}
