using System.Text;
using TLQS.Api.Exports;
using TLQS.Api.V1;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class UcoDashboardReportBuilderTests
{
    [Fact]
    public void Uco_pdf_expands_dashboard_workflow_attention_and_register_without_raw_workbook_answers()
    {
        var now = DateTimeOffset.Parse("2026-09-29T12:00:00Z");
        var review = new UcoTlaReviewSummary(Guid.NewGuid(), "Review", "2026/27", "awaiting_lecturer",
            Guid.NewGuid(), "Lecturer example", Guid.NewGuid(), "Observer example", now.AddDays(-1), "Course", "Module",
            null, now.AddDays(3), "scheduled", 2, 1, 4, [], new(false, false, false, false, false, false, false, false, false, false));
        var dashboard = UcoDashboardReportBuilder.Build(new(1, 0, 12, 0, 0, 1, 1, 2, 1, [], [review]), now);
        Assert.Contains(dashboard.Sections, section => section.Title == "Where reviews are now");
        Assert.Single(dashboard.Sections.Single(section => section.Title == "What needs progressing").Items);
        Assert.Single(dashboard.Sections.Single(section => section.Title == "UCO review register").Items);
        Assert.DoesNotContain(dashboard.Sections, section => section.Title == "Expanded form entries");
        var workbook = new ExportWorkbookData("uco-tla-reviews", "UCO", new("2026/27", null, null, null, null, null, null, null, null),
            "Reviewer", now, [new("Form entries", ["Raw answer"], [["RAW_RESPONSE_EXCEL_ONLY"]], false)], dashboard);
        var pdf = Encoding.ASCII.GetString(new QaPdfReportService().CreateDashboardReport(workbook).Content);
        Assert.Contains("Lecturer example", pdf);
        Assert.Contains("Observer example", pdf);
        Assert.Contains("Follow-up", pdf);
        Assert.DoesNotContain("RAW_RESPONSE_EXCEL_ONLY", pdf);
        Assert.Equal("RAW_RESPONSE_EXCEL_ONLY", workbook.Sheets[0].Rows[0][0]);
    }
}
