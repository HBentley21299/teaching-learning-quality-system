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

    [Fact]
    public void Workflow_filter_narrows_review_metrics_attention_and_highlights_but_retains_annual_staff_coverage()
    {
        var now=DateTimeOffset.Parse("2026-10-29T12:00:00Z");
        UcoTlaReviewSummary Review(string name,string status,int open,int overdue,int sections,DateTimeOffset? followUp=null) => new(
            Guid.NewGuid(),name,"2026/27",status,Guid.NewGuid(),name,Guid.NewGuid(),"Observer",now.AddDays(1),"Course","Module",null,
            followUp,followUp.HasValue ? "scheduled" : null,open,overdue,sections,[],new(false,false,false,false,false,false,false,false,false,false));
        var selected=Review("Selected lecturer","awaiting_lecturer",2,1,4,now.AddDays(3));
        var completed=Review("Completed outside filter","completed",7,5,7);
        var finalisation=Review("Finalisation outside filter","awaiting_finalisation",6,4,5,now.AddDays(5));
        UcoTlaPracticeHighlight Highlight(UcoTlaReviewSummary review) => new(review.RecordId,review.LecturerName,"Course","Module",now,"Inclusive practice",$"Evidence for {review.LecturerName}");
        var source=new UcoTlaDashboardSummary(3,1,12,8,67,1,2,15,10,[Highlight(selected),Highlight(completed),Highlight(finalisation)],[selected,completed,finalisation]);
        var report=UcoDashboardReportBuilder.Build(source,now,"awaiting_lecturer");
        string? Metric(string label)=>report.Metrics.Single(metric=>metric.Label==label).Value;
        Assert.Equal("1",Metric("Reviews this year"));
        Assert.Equal("0",Metric("Completed reviews"));
        Assert.Equal("1",Metric("In progress"));
        Assert.Equal("1",Metric("Awaiting lecturer"));
        Assert.Equal("1",Metric("Follow-ups due"));
        Assert.Equal("2",Metric("Open actions"));
        Assert.Equal("1",Metric("Overdue actions"));
        Assert.Equal("57%",Metric("Sections marked"));
        Assert.Equal("1",Metric("Observations in next 30 days"));
        Assert.Equal("12",Metric("Active UCO staff"));
        Assert.Equal("8",Metric("Staff covered"));
        Assert.Equal("67%",Metric("Staff coverage"));
        Assert.Single(report.Sections.Single(section=>section.Title=="Practice highlights").Items);
        Assert.Single(report.Sections.Single(section=>section.Title=="What needs progressing").Items);
        Assert.Equal("Selected lecturer",report.Sections.Single(section=>section.Title=="UCO review register").Items.Single().Title);
        var workflow=report.Sections.Single(section=>section.Title=="Where reviews are now").Items.Single().Distribution!;
        Assert.Equal(1,workflow.Single(row=>row.Label=="awaiting lecturer").Value);
        Assert.All(workflow.Where(row=>row.Label!="awaiting lecturer"),row=>Assert.Equal(0,row.Value));
        var noRows=UcoDashboardReportBuilder.Build(source,now,"observer_draft");
        Assert.Equal("0",noRows.Metrics.Single(metric=>metric.Label=="Reviews this year").Value);
        Assert.Equal("67%",noRows.Metrics.Single(metric=>metric.Label=="Staff coverage").Value);
        Assert.Empty(noRows.Sections.Single(section=>section.Title=="Practice highlights").Items);
    }
}
