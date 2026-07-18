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
}
