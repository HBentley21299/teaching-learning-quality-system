using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Validation;
using TLQS.Api.Data;
using TLQS.Api.Exports;
using TLQS.Api.V1;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class GenericFormReportingCompatibilityTests
{
    [Theory]
    [InlineData("elevate-environments", "elevate_environment", "Pillar Ratings")]
    [InlineData("learning-walks", "learning_walk", "Actions")]
    [InlineData("work-scrutiny", "work_scrutiny", "Actions")]
    [InlineData("cpd", "cpd_event", "Attendance")]
    public void Saved_custom_fields_of_supported_types_survive_excel_and_native_reporting_with_existing_domain_details(
        string module, string process, string detailName)
    {
        var historical = Guid.NewGuid().ToString();
        var current = Guid.NewGuid().ToString();
        var main = new ExportSheet("Form entries", ["Record ID", "Title", "Staff member"],
            [[historical, "Historical entry", "Alex"], [current, "Current entry", "Blair"]], false);
        string[] columns = ["Record ID", "Form template", "Form version", "Section", "Question key", "Question", "Response type", "Response"];
        IReadOnlyList<string?> Answer(string id, string key, string label, string type, string value, string version = "v2") =>
            [id, "published-form", version, "Additional context", $"published-form/context/custom_{key}", label, type, value];
        var answers = FormEntryExportBuilder.ExpandAnswers(new ExportSheet("Form Answers", columns, [
            Answer(historical, "short", "Custom short", "short_text", "Historical wording", "v1"),
            Answer(current, "short", "Custom short", "short_text", "Saved short response"),
            Answer(current, "long", "Custom long", "long_text", "First line\nSecond line"),
            Answer(current, "number", "Custom number", "number", "12"),
            Answer(current, "date", "Custom date", "date", "2026-11-01"),
            Answer(current, "choice", "Custom choice", "single_select", "Other"),
            Answer(current, "multiple", "Custom multiple", "multi_select", "[\"Coaching | mentoring\",\"Feedback\"]"),
            Answer(current, "checklist", "Custom checklist", "checkbox_group", "Paper|Digital"),
            Answer(current, "rubric", "Custom rubric", "rubric_scale", "Secure"),
            Answer(current, "partial", "Custom partial", "yes_no_partial", "Partial")
        ], false));
        var entries = FormEntryExportBuilder.Flatten("Form entries", main, "Record ID", answers);
        var detail = new ExportSheet(detailName, ["Record ID", "Finding"], [[current, "Existing domain detail"]], false);
        var workbook = new ExportWorkbookData(module, "Form report", new("2026/27", null, null, null, null, null, null, null, null),
            "Reviewer", DateTimeOffset.UtcNow, [entries, answers, detail]);

        var business = BusinessWorkbookExportBuilder.Build(workbook);
        Assert.Equal(2, business.Sheets.Count);
        var primary = business.Sheets[0];
        var number = primary.Columns.ToList().FindIndex(label => label.Contains("Custom number"));
        var date = primary.Columns.ToList().FindIndex(label => label.Contains("Custom date"));
        Assert.Equal("number", primary.ColumnTypes![number]);
        Assert.Equal("date", primary.ColumnTypes[date]);
        Assert.Null(primary.Rows[0][number]);
        Assert.Equal("12", primary.Rows[1][number]);
        Assert.Contains("Historical wording", primary.Rows[0]);
        Assert.Contains("First line\nSecond line", primary.Rows[1]);
        Assert.Contains("Coaching | mentoring\nFeedback", primary.Rows[1]);
        Assert.Contains("Paper\nDigital", primary.Rows[1]);
        Assert.Contains("Existing domain detail", business.Sheets[1].Rows[0]);

        var data = DashboardRecordDataBuilder.Build(process, workbook);
        Assert.Equal(2, data.Rows.Count);
        var currentRow = data.Rows.Single(row => row.RecordId.ToString() == current);
        Assert.Contains("12", currentRow.Values.Values);
        Assert.Contains("Secure", currentRow.Values.Values);
        Assert.Contains("Partial", currentRow.Values.Values);
        Assert.Contains("Coaching | mentoring\nFeedback", currentRow.Values.Values);
        Assert.Contains("Existing domain detail", Assert.Single(Assert.Single(data.RelatedTables!).Rows).Values.Values);
        Assert.DoesNotContain(data.Columns, column => column.Label.Contains("Question key"));
        using var document = SpreadsheetDocument.Open(new MemoryStream(new ExcelExportService().CreateWorkbook(workbook).Content), false);
        Assert.Empty(new OpenXmlValidator().Validate(document));
    }
}
