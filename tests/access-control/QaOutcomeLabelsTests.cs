using System.Text;
using TLQS.Api.Exports;
using TLQS.Api.V1;
using TLQS.Application.Workflows;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class QaOutcomeLabelsTests
{
    [Fact]
    public void WordingChangesDoNotChangeStoredOutcomeKeysOrReportingDenominators()
    {
        var labels = QaOutcomeLabels.Validate(" Developing ", "Secure", "Exceptional", "Not observed");
        Assert.Equal("Developing", labels.Below);
        var distribution = QaReviewPolicy.CalculateDistribution(["below", "at", "above", "above", "not_applicable"]);
        Assert.Equal(4, distribution.Rated);
        Assert.Equal(1, distribution.NotApplicable);
        Assert.Equal(75m, distribution.AtOrAbovePercentage);
        Assert.Null(QaReviewPolicy.ValidateResponse(true, true, false, "above", null, null, true));
        Assert.Equal("Select a valid QA outcome.", QaReviewPolicy.ValidateResponse(true, true, false, labels.Above, null, null, true));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("Secure")]
    [InlineData(" secure ")]
    [InlineData("First\nSecond")]
    [InlineData("12345678901234567890123456789012345678901")]
    public void RejectsMissingDuplicateMultilineOrLongLabels(string? below) =>
        Assert.Throws<WorkflowValidationException>(() => QaOutcomeLabels.Validate(below, "Secure", "Exceptional", "Not observed"));

    [Fact]
    public void CustomLabelsAppearInPdfForHistoricalReviewWithoutAlteringSnapshotCounts()
    {
        var labels = new QaOutcomeLabels("Developing", "Secure", "Exceptional", "Not observed");
        var dashboard = new QaDashboardSummary(Guid.NewGuid(), 1, 1, 1, 0, 0, 1, 2, 3, 1, 6, 83.3m,
            [new("lesson_visit", "Lesson Visit", 1, 2, 3, 1, 6, 83.3m)],
            [new("lesson_visit", "Lesson Visit", Guid.NewGuid(), "General", "Criterion", 1, 2, 3, 1, 6, 16.7m, 33.3m, 50m)], [], [], [], [], 0, 0, 2);
        var review = new QaReviewSummary(dashboard.ReviewId, "Closed review", "2026/27", "Quality", "closed", null,
            new DateOnly(2026, 9, 8), "Owner", 1, 1, 1, [], new(false, false, false, false, false, false, false, true, false));
        var report = new QaReviewReportData(new(review, "general", Guid.NewGuid(), [], [], [], null), dashboard, [], "Admin",
            DateTimeOffset.UtcNow, null, null, null, null, labels);
        var raw = Encoding.ASCII.GetString(new QaPdfReportService().CreateReport(report).Content);
        foreach (var label in new[] { labels.Below, labels.At, labels.Above, labels.NotApplicable }) Assert.Contains(label, raw);
        Assert.DoesNotContain("Below standard", raw);
        Assert.DoesNotContain("At standard", raw);
        Assert.Equal(2, report.Dashboard.SnapshotVersion);
        Assert.Equal(6, report.Dashboard.RatedCount);
    }
}
