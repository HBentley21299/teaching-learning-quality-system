using TLQS.Application.Workflows;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class WorkScrutinyResponseRulesTests
{
    [Theory]
    [InlineData("Pre-entry")]
    [InlineData("Entry Level")]
    [InlineData("Level 1")]
    [InlineData("Level 7")]
    public void AcceptsCourseLevelWithoutAnImportedCourse(string value) =>
        WorkScrutinyResponseRules.ValidateCourseLevel(value, []);

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("Level 99")]
    [InlineData("An imported course name")]
    public void RequiresARecognisedLevelForNewLevelOnlySubmissions(string? value) =>
        Assert.Throws<WorkflowValidationException>(() => WorkScrutinyResponseRules.ValidateCourseLevel(value, []));

    [Fact]
    public void UsesTemplateConfiguredLevelChoices()
    {
        WorkScrutinyResponseRules.ValidateCourseLevel("Entry Level 3", ["Entry Level 3", "Level 2"]);
        Assert.Throws<WorkflowValidationException>(() => WorkScrutinyResponseRules.ValidateCourseLevel("Level 1", ["Entry Level 3", "Level 2"]));
    }

    [Theory]
    [InlineData("0")]
    [InlineData("-2")]
    [InlineData("1.5")]
    [InlineData("unknown")]
    [InlineData("2147483648")]
    public void LearnerSampleMustBePositiveWholeNumber(string value) => Assert.Throws<WorkflowValidationException>(() =>
        WorkScrutinyResponseRules.Validate("sample_size", "number", "Learners", [], value));

    [Fact]
    public void LearnerCountIsAcceptedIndependentlyOfCourses() =>
        WorkScrutinyResponseRules.Validate("sample_size", "number", "Learners", [], "12");

    [Fact]
    public void ApplicableAndNotApplicableUseThePublishedVersionsChoices()
    {
        WorkScrutinyResponseRules.Validate("ws_curriculum_1", "rubric_scale", "Statement", ["Expected practice", "N/A"], "N/A");
        WorkScrutinyResponseRules.Validate("ws_curriculum_1", "rubric_scale", "Statement", ["Expected practice", "N/A"], "Expected practice");
        Assert.Throws<WorkflowValidationException>(() => WorkScrutinyResponseRules.Validate("ws_curriculum_1", "rubric_scale", "Statement", ["Expected practice", "N/A"], "Secure"));
    }

    [Fact]
    public void OverallJudgementCannotUseNotApplicableUnlessConfigured() => Assert.Throws<WorkflowValidationException>(() =>
        WorkScrutinyResponseRules.Validate("overall_picture", "single_select", "Overall", ["Secure", "Strong"], "N/A"));

    [Fact]
    public void EverySelectedEvidenceOptionMustBeConfigured()
    {
        WorkScrutinyResponseRules.Validate("evidence_sampled", "checkbox_group", "Evidence", ["Digital work", "Practical evidence"], "Digital work|Practical evidence");
        Assert.Throws<WorkflowValidationException>(() => WorkScrutinyResponseRules.Validate("evidence_sampled", "checkbox_group", "Evidence", ["Digital work", "Practical evidence"], "Digital work|Invented"));
    }

    [Fact]
    public void TriangulationCannotContradictItself() => Assert.Throws<WorkflowValidationException>(() =>
        WorkScrutinyResponseRules.Validate("triangulation_sources", "checkbox_group", "Triangulation", ["No further validation required", "Learning Walk"], "No further validation required|Learning Walk"));

    [Fact]
    public void DelimitersAloneAreNotASelection() => Assert.Throws<WorkflowValidationException>(() =>
        WorkScrutinyResponseRules.Validate("evidence_sampled", "checkbox_group", "Evidence", ["Digital work", "Practical evidence"], "||"));

    [Fact]
    public void OptionalAndHistoricalUnconfiguredFieldsRemainSupported()
    {
        WorkScrutinyResponseRules.Validate("sample_size", "number", "Learners", [], null);
        WorkScrutinyResponseRules.Validate("historic_rating", "single_select", "Rating", [], "Historical wording");
    }
}
