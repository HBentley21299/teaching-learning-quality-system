using TLQS.Api.Data;
using TLQS.Api.V1;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class WorkScrutinyDashboardFactsTests
{
    [Theory]
    [InlineData("Emerging", "emerging", 1)]
    [InlineData("Developing Practice", "developing", 2)]
    [InlineData("Secure", "secure", 3)]
    [InlineData("Strong Practice", "strong", 4)]
    [InlineData("Exceptional", "exceptional", 5)]
    public void StandardJudgementsUseTheFormsFivePointScale(string label, string key, int score)
    {
        var result = WorkScrutinyDashboardFacts.Normalize(Fact(label));
        Assert.Equal(key, result.ValueKey);
        Assert.Equal((decimal)score, result.NumericValue);
    }

    [Theory]
    [InlineData("N/A", "not_applicable")]
    [InlineData("Not applicable", "not_applicable")]
    [InlineData("Not seen", "not_seen")]
    [InlineData("Local configured wording", "Local configured wording")]
    public void NeutralAndUnknownResponsesRemainVisibleWithoutAffectingScores(string label, string key)
    {
        var result = WorkScrutinyDashboardFacts.Normalize(Fact(label));
        Assert.Equal(label, result.ValueLabel);
        Assert.Equal(key, result.ValueKey);
        Assert.Null(result.NumericValue);
    }

    [Fact]
    public void NeutralJudgementDoesNotReduceTheSectionMean()
    {
        var facts = new[] { "Secure", "Strong", "Not seen", "N/A" }.Select(value => WorkScrutinyDashboardFacts.Normalize(Fact(value))).ToArray();
        Assert.Equal(4, facts.Length);
        Assert.Equal(3.5m, facts.Where(value => value.NumericValue.HasValue).Average(value => value.NumericValue!.Value));
        Assert.Equal(2, facts.Count(value => value.NumericValue is null));
    }

    [Fact]
    public void CourseCategoriesAreNeverInterpretedAsRubricJudgements()
    {
        var original = Fact("Strong") with { DimensionKey = "course" };
        Assert.Same(original, WorkScrutinyDashboardFacts.Normalize(original));
    }

    private static DashboardDimensionFactSummary Fact(string label) =>
        new(Guid.NewGuid(), "work_scrutiny", new DateOnly(2026, 9, 29), null, null, null, null,
            "scrutiny_section_outcome", "assessment_feedback", "Assessment and feedback", label, label, null);
}
