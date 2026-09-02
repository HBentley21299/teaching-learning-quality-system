using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Validation;
using Microsoft.Extensions.Options;
using TLQS.Api.Exports;
using TLQS.Api.Messaging;
using TLQS.Api.V1;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class MessagingAndExportTests
{
    [Fact]
    public void Message_template_policy_rejects_unapproved_parameters()
    {
        var exception = Assert.Throws<ArgumentException>(() =>
            MessageTemplatePolicy.Validate(
                "Action for {{staff.fullName}}",
                "Open {{database.connectionString}}",
                null));

        Assert.Contains("Unsupported message parameter", exception.Message);
    }

    [Fact]
    public void Message_template_policy_sanitizes_unsafe_html()
    {
        var html = MessageTemplatePolicy.SanitizeHtml(
            "<p onclick=\"alert(1)\">Hello</p><script>alert(2)</script><a href=\"javascript:alert(3)\">Open</a>");

        Assert.NotNull(html);
        Assert.DoesNotContain("onclick", html, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("script", html, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("javascript:", html, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Excel_export_is_a_valid_open_xml_workbook()
    {
        var export = new ExcelExportService().CreateWorkbook(new ExportWorkbookData(
            "actions",
            "Actions",
            new ExportFilter("2026/27", "CUCP", null, null, null, null, null, "open", null),
            "Test user",
            DateTimeOffset.Parse("2026-07-17T12:00:00Z"),
            [new ExportSheet(
                "Actions",
                ["Action", "Owner", "Status"],
                [new string?[] { "Review learner feedback", "Test user", "Open" }],
                false)]));

        using var stream = new MemoryStream(export.Content);
        using var document = SpreadsheetDocument.Open(stream, false);
        var validationErrors = new OpenXmlValidator().Validate(document).ToArray();
        Assert.True(validationErrors.Length == 0, string.Join(Environment.NewLine,
            validationErrors.Select(error => $"{error.Part?.Uri} {error.Path?.XPath}: {error.Description}")));
        Assert.Equal(2, document.WorkbookPart!.Workbook.Sheets!.Count());
    }

    [Fact]
    public void Word_export_is_valid_and_references_header_and_footer()
    {
        var service = new WordExportService(Options.Create(new ExportBrandingOptions()));
        var export = service.CreateRecordReport(new RecordReportData(
            Guid.NewGuid(), "Learning Walk", "learning_walk", "Submitted",
            "Test staff member", "Test reviewer", "CUCP / CUCPHSC",
            "2025/26",
            new DateOnly(2026, 7, 17), DateTimeOffset.Parse("2026-07-17T12:00:00Z"),
            "Test user",
            [new RecordReportSection("Context", [new RecordReportField("Theme", "Inclusive practice")])],
            [new RecordReportAction("Review feedback", null, "Test staff member", new DateOnly(2026, 8, 1), "Open", null, null, null)]));

        using var stream = new MemoryStream(export.Content);
        using var document = WordprocessingDocument.Open(stream, false);
        Assert.NotNull(document.MainDocumentPart);
        var text = document.MainDocumentPart!.Document.Body!.InnerText;
        Assert.Contains("Learning Walk", text);
        Assert.Contains("Complete record detail", text);
    }

    [Fact]
    public void Uco_word_export_uses_the_three_part_form_and_contains_no_rating_judgement()
    {
        var service = new WordExportService(Options.Create(new ExportBrandingOptions()));
        var export = service.CreateRecordReport(new RecordReportData(
            Guid.NewGuid(), "UCO TLA Review", "uco_tla_review", "Completed",
            "Test lecturer", "Test observer", "UCO", "2025/26",
            new DateOnly(2026, 6, 10), DateTimeOffset.Parse("2026-06-10T12:00:00Z"),
            "Test coordinator",
            [
                new RecordReportSection("Course Details and Authenticated Sign-off", [
                    new RecordReportField("Session type", "Seminar"),
                    new RecordReportField("Level", "6")
                ]),
                new RecordReportSection("Teaching and learning activities", [
                    new RecordReportField("Academic/research skills", "Students evaluated current research.")
                ]),
                new RecordReportSection("Delivery and facilitation of teaching and learning", [
                    new RecordReportField("Structure, pace and organisation of session", "A clear sequence was observed.")
                ]),
                new RecordReportSection("Teaching, learning and assessment materials", [
                    new RecordReportField("Module handbook", "Current and accessible.")
                ]),
                new RecordReportSection("Findings and actions", [
                    new RecordReportField("Aspects of good practice", "Specific inclusive questioning.")
                ]),
                new RecordReportSection("Reflection and development", [
                    new RecordReportField("Lecturer reflection on observation and professional discussion", "I will build on this approach.")
                ])
            ],
            [new RecordReportAction("Share questioning model", "Demonstrate at CPD", "Test lecturer",
                new DateOnly(2026, 9, 1), "Open", null, null, null)]));

        using var stream = new MemoryStream(export.Content);
        using var document = WordprocessingDocument.Open(stream, false);
        var body = document.MainDocumentPart!.Document.Body!;
        var validationErrors = new OpenXmlValidator().Validate(document).ToArray();
        Assert.Empty(validationErrors);
        Assert.Equal(2, body.Descendants<DocumentFormat.OpenXml.Wordprocessing.Break>()
            .Count(value => value.Type?.Value == DocumentFormat.OpenXml.Wordprocessing.BreakValues.Page));
        Assert.Contains("Authenticated Sign-off", body.InnerText);
        Assert.DoesNotContain("Moderator", body.InnerText, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Rating", body.InnerText, StringComparison.OrdinalIgnoreCase);
    }
}
