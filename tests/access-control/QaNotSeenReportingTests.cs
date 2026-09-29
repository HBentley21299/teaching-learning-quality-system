using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using TLQS.Api.Data;
using TLQS.Api.Exports;
using TLQS.Api.V1;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class QaNotSeenReportingTests
{
    [Fact]
    public void Mixed_results_export_neutral_counts_separately_without_reducing_rated_percentage()
    {
        var report = Report(1, 2, 1, 2, 7);
        var workbook = SqlFoundationDataStore.BuildQaReviewExport(report);
        var outcomes = workbook.Sheets.Single(sheet => sheet.Name == "Outcome Distribution");
        Assert.Equal(new string?[] { "Not seen", "7", null }, outcomes.Rows.Single(row => row[0] == "Not seen"));
        Assert.Equal("50.0%", outcomes.Rows.Single(row => row[0] == "At standard")[2]);
        var summary = workbook.Sheets.Single(sheet => sheet.Name == "Dashboard");
        Assert.Equal("13", summary.Rows.Single(row => row[0] == "Total responses")[1]);
        foreach (var name in new[] { "Processes", "Expanded Criteria", "Team Coverage", "Themes" })
        {
            var sheet = workbook.Sheets.Single(sheet => sheet.Name == name);
            Assert.Equal("7", sheet.Rows.Single()[sheet.Columns.ToList().IndexOf("Not seen")]);
            Assert.Equal("4", sheet.Rows.Single()[sheet.Columns.ToList().IndexOf("Rated")]);
            Assert.Equal(sheet.Columns.Count, sheet.Rows.Single().Count);
        }
    }

    [Fact]
    public void Unrated_excel_has_blank_percentages_and_explicit_no_rated_responses()
    {
        var workbook = SqlFoundationDataStore.BuildQaReviewExport(Report(0, 0, 0, 2, 7));
        Assert.Contains(workbook.Sheets.Single(sheet => sheet.Name == "Dashboard").Rows,
            row => row[1] == "No rated responses");
        foreach (var name in new[] { "Processes", "Expanded Criteria", "Team Coverage", "Themes" })
        {
            var sheet = workbook.Sheets.Single(sheet => sheet.Name == name);
            foreach (var column in sheet.Columns.Select((label, index) => (label, index)).Where(column => column.label.EndsWith(" %")))
                Assert.Null(sheet.Rows.Single()[column.index]);
        }
        Assert.All(workbook.Sheets.Single(sheet => sheet.Name == "Outcome Distribution").Rows, row => Assert.Null(row[2]));
    }

    [Theory]
    [InlineData(0, 0, 0, 2, 7)]
    [InlineData(1, 2, 1, 2, 7)]
    public void Pdf_shows_not_seen_counts_and_uses_only_rated_responses(int below, int at, int above, int na, int notSeen)
    {
        var report = Report(below, at, above, na, notSeen);
        var output = new QaPdfReportService().CreateReport(report);
        var content = Encoding.ASCII.GetString(output.Content);
        Assert.Contains("Not seen: 7", content);
        Assert.Contains("Not seen and not applicable are excluded from rated percentages.", content);
        Assert.Contains($"{below + at + above} rated / {below + at + above + na + notSeen} total responses", content);
        if (below + at + above == 0)
        {
            Assert.Contains("No rated responses", content);
            Assert.DoesNotContain("0.0%", content);
        }
        else
            Assert.Contains("At standard: 2 \\(50.0%\\)", content);
        var fixtureDirectory = Environment.GetEnvironmentVariable("TLQS_QA_NEUTRAL_FIXTURES");
        if (!string.IsNullOrWhiteSpace(fixtureDirectory))
        {
            Directory.CreateDirectory(fixtureDirectory);
            File.WriteAllBytes(Path.Combine(fixtureDirectory, below + at + above == 0 ? "qa-unrated.pdf" : "qa-mixed.pdf"), output.Content);
        }
    }

    [Fact]
    public void Historical_snapshot_without_neutral_properties_deserializes_with_zero_counts()
    {
        var original = Report(1, 2, 1, 2, 0).Dashboard;
        var json = JsonSerializer.SerializeToNode(original)!.AsObject();
        json.Remove("NotSeenCount");
        foreach (var name in new[] { "ByActivity", "ByTeam", "ByTheme", "Questions" })
            foreach (var row in json[name]!.AsArray()) row!.AsObject().Remove("NotSeen");
        var restored = JsonSerializer.Deserialize<QaDashboardSummary>(json.ToJsonString())!;
        Assert.Equal(0, restored.NotSeenCount);
        Assert.Equal(original.RatedCount, restored.RatedCount);
        Assert.Equal(original.AtOrAbovePercentage, restored.AtOrAbovePercentage);
        Assert.All(restored.ByActivity.Concat(restored.ByTeam).Concat(restored.ByTheme), row => Assert.Equal(0, row.NotSeen));
        Assert.All(restored.Questions, row => Assert.Equal(0, row.NotSeen));
    }

    private static QaReviewReportData Report(int below, int at, int above, int na, int notSeen)
    {
        var activityId = Guid.NewGuid().ToString();
        var rated = below + at + above;
        decimal Percent(int count) => rated == 0 ? 0 : Math.Round(count * 100m / rated, 1);
        var breakdown = new QaDashboardBreakdown(activityId, "Lesson visit", below, at, above, na, rated, Percent(at + above), notSeen);
        var question = new QaDashboardQuestionBreakdown(activityId, "Lesson visit", Guid.NewGuid(), "Learner progress",
            "Assessment evidence demonstrates how learners apply feedback and make progress.", below, at, above, na, rated,
            Percent(below), Percent(at), Percent(above), notSeen);
        var dashboard = new QaDashboardSummary(Guid.NewGuid(), 13, 1, 1, 1, 0, below, at, above, na, rated, Percent(at + above),
            [breakdown], [question], [breakdown], [breakdown], [], [], 0, 0, 0, notSeen);
        var capabilities = new QaCapabilities(false, false, false, false, false, false, false, true, false);
        var review = new QaReviewSummary(dashboard.ReviewId, "Autumn quality review", "2026/27", "Teaching and learning", "open",
            null, new DateOnly(2026, 12, 18), "QA Owner", 1, 1, 13, [], capabilities);
        return new QaReviewReportData(new QaReviewDetail(review, "general", Guid.NewGuid(), [], [], [], null),
            dashboard, [], "Test User", DateTimeOffset.Parse("2026-09-09T10:00:00Z"), null, null, null, null);
    }
}
