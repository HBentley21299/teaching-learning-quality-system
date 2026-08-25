using System.Text;
using TLQS.Api.Exports;
using TLQS.Api.V1;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class QaPdfReportServiceTests
{
    [Fact]
    public void CreateDashboardReport_UsesReadableDatasetsAndKeepsQuestionDetail()
    {
        var recordId = Guid.Parse("11111111-1111-1111-1111-111111111111");
        var workbook = new ExportWorkbookData(
            "learning-walks", "Learning Walks", new ExportFilter("2026/27", null, null, null, null, null, null, null, null),
            "Test User", DateTimeOffset.Parse("2026-08-25T10:00:00Z"),
            [
                new ExportSheet("Full Records", ["Record ID", "Title", "Record type", "Status", "Staff member", "Reviewer or owner"],
                    [new string?[] { recordId.ToString(), "Inclusive learning walk", "learning_walk", "Submitted", "Tutor Example", "Reviewer Example" }], false),
                new ExportSheet("Dashboard Records", ["Record ID", "Title", "Record type", "Status", "Staff member", "Reviewer or owner"],
                    [new string?[] { recordId.ToString(), "Inclusive learning walk", "learning_walk", "Submitted", "Tutor Example", "Reviewer Example" }], false),
                new ExportSheet("Question-Level Results", ["Record ID", "Record title", "Section", "Question", "Response"],
                    [new string?[] { recordId.ToString(), "Inclusive learning walk", "Inclusive practice", "Learners can participate fully in learning.", "Above standard" }], false)
            ]);

        var file = new QaPdfReportService().CreateDashboardReport(workbook);
        var raw = Encoding.ASCII.GetString(file.Content);

        Assert.Equal("application/pdf", file.ContentType);
        Assert.Contains("Question-Level Results", raw);
        Assert.Contains("Learners can participate", raw);
        Assert.DoesNotContain(recordId.ToString(), raw, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Dashboard Records", raw, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void CreateReport_ProducesMultipageDashboardWithExpandedCriteria()
    {
        var activityId = Guid.NewGuid();
        var questions = Enumerable.Range(1, 55).Select(index => new QaDashboardQuestionBreakdown(
            activityId.ToString(), "Lesson Visit", Guid.NewGuid(), "General",
            $"Criterion {index} checks that the quality process is consistently understood and evidenced across the selected teams.",
            1, 2, 3, 0, 6, 16.7m, 33.3m, 50m)).ToArray();
        var dashboard = new QaDashboardSummary(
            Guid.NewGuid(), 8, 2, 5, 0, 0, 55, 110, 165, 0, 330, 83.3m,
            [new QaDashboardBreakdown(activityId.ToString(), "Lesson Visit", 55, 110, 165, 0, 330, 83.3m)],
            questions, [], [], [], ["Team without evidence"], 3, 2, 0);
        var capabilities = new QaCapabilities(false, false, false, false, false, false, false, true, false);
        var review = new QaReviewSummary(
            dashboard.ReviewId, "Autumn quality review", "2026/27", "Teaching and learning", "closed",
            null, new DateOnly(2026, 12, 18), "QA Owner", 5, 1, 8, [], capabilities);
        var report = new QaReviewReportData(
            new QaReviewDetail(review, "general", Guid.NewGuid(), [], [], [], null),
            dashboard, [], "Test User", DateTimeOffset.Parse("2026-08-25T10:00:00Z"),
            null, null, null, null);

        var file = new QaPdfReportService().CreateReport(report);
        var raw = Encoding.ASCII.GetString(file.Content);

        Assert.Equal("application/pdf", file.ContentType);
        Assert.StartsWith("%PDF-1.4", raw);
        Assert.Contains("Criterion 55 checks", raw);
        Assert.Contains("Page 2 of", raw);
        Assert.EndsWith(".pdf", file.FileName);
    }
}
