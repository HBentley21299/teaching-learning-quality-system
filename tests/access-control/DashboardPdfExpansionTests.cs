using System.Text;
using System.Text.RegularExpressions;
using TLQS.Api.Exports;
using TLQS.Api.V1;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class DashboardPdfExpansionTests
{
    [Fact]
    public void Expanded_dashboard_renders_metrics_distributions_and_every_record_response_across_pages()
    {
        var longResponse = string.Join("\n", Enumerable.Range(1, 100)
            .Select(index => $"Evidence paragraph {index:D3}: Learners described how feedback helped them to develop their independent professional practice."));
        var report = CreateWorkbook() with
        {
            Sheets = [new("Form entries", ["Private raw answer"], [["RAW_WORKBOOK_ONLY_SENTINEL"]], false)],
            Dashboard = new DashboardReportData(
                [new("Submitted walks", "126"), new("Staff covered", "84"), new("At or above expected practice", "86.7%"), new("Open actions", "12")],
                [new("Outcome distribution", "All selected themes are included. N/A responses are shown separately.",
                    [new("Inclusive teaching and learning", [new("Rated responses", "120"), new("Not applicable", "6")],
                        [new("Below standard", 16), new("At standard", 74), new("Above standard", 30)])]),
                 new("Expanded dashboard drilldowns", "Every item displayed in the dashboard is expanded.",
                    Enumerable.Range(1, 126).Select(index => new DashboardReportItem($"Learning walk entry {index:D3}",
                        [new("Staff member", "Tutor Example"), new("Learning walk delivery area", "Adult provision"),
                         new("Themes selected", "Inclusive practice; Assessment and feedback"),
                         new("Learners understand what they are learning and how this relates to their course and future progression.", "Above standard"),
                         new("Evidence and next steps", index == 1 ? longResponse : $"Complete response for form {index:D3}.")])).ToArray())])
        };

        var file = new QaPdfReportService().CreateDashboardReport(report);
        var raw = Encoding.ASCII.GetString(file.Content);
        Assert.Contains("Submitted walks", raw);
        Assert.Contains("Outcome distribution", raw);
        Assert.Contains("Adult provision", raw);
        Assert.Contains("Evidence paragraph 100", raw);
        Assert.Contains("Learning walk entry 126", raw);
        Assert.Contains("Complete response for form 126", raw);
        Assert.DoesNotContain("first 120", raw);
        Assert.Contains("continued", raw);
        Assert.DoesNotContain("Datasets", raw);
        Assert.DoesNotContain("RAW_WORKBOOK_ONLY_SENTINEL", raw);
        Assert.DoesNotContain("Expanded form entries", raw);
        Assert.True(Regex.Matches(raw, @"/Type /Page\b").Count > 2);

        // Optional local render fixture; tests never persist user records or require the application/database.
        if (Environment.GetEnvironmentVariable("TLQS_PDF_FIXTURE_PATH") is { Length: > 0 } path)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
            File.WriteAllBytes(path, file.Content);
        }
    }

    [Fact]
    public void Legacy_workbook_fallback_has_no_column_or_row_preview_cap_and_keeps_multiline_text()
    {
        var columns = Enumerable.Range(1, 12).Select(index => $"Answer column {index:D2}").ToArray();
        var rows = Enumerable.Range(1, 125).Select(row => (IReadOnlyList<string?>)Enumerable.Range(1, 12)
            .Select(column => $"Value {row:D3}-{column:D2}" + (row == 125 && column == 12 ? "\nFinal paragraph preserved." : "")).ToArray()).ToArray();
        var report = CreateWorkbook() with { Sheets = [new("Form responses", columns, rows, false)] };
        var raw = Encoding.ASCII.GetString(new QaPdfReportService().CreateDashboardReport(report).Content);
        Assert.Contains("Answer column 12", raw);
        Assert.Contains("Value 125-12", raw);
        Assert.Contains("Final paragraph preserved.", raw);
        Assert.DoesNotContain("PDF preview", raw);
        Assert.DoesNotContain("?Final", raw);
    }

    private static ExportWorkbookData CreateWorkbook() => new(
        "learning-walks", "Learning Walks",
        new ExportFilter("2026/27", "Business and Professional Studies", "Business", new(2026, 9, 1), new(2026, 12, 31), null, null, "Submitted", null),
        "Test Reviewer", DateTimeOffset.Parse("2026-09-08T10:00:00Z"), []);
}
