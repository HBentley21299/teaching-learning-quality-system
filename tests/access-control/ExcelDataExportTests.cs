using System.Globalization;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Spreadsheet;
using DocumentFormat.OpenXml.Validation;
using TLQS.Api.Exports;
using TLQS.Api.V1;
using TLQS.Application.Workflows;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class ExcelDataExportTests
{
    [Fact]
    public void Form_entries_open_first_with_readable_unique_question_headers()
    {
        using var document = OpenWorkbook(new ExportSheet("Form entries", ["Area - Statement [eli/id/one]", "Area - Statement [eli/id/two]"], [new string?[] { "Secure", "Strong" }], false));
        Assert.Equal("Form entries", document.WorkbookPart!.Workbook.Sheets!.Elements<Sheet>().First().Name!.Value);
        var headings = GetDataWorksheet(document).GetFirstChild<SheetData>()!.Elements<Row>().First().Elements<Cell>().Select(cell => cell.InnerText).ToArray();
        Assert.Equal(new[] { "Area - Statement", "Area - Statement (2)" }, headings);
    }

    [Fact]
    public void Explicit_column_types_support_calculation_dates_and_literal_form_answers()
    {
        var sheet = new ExportSheet("Form entries", ["Learners", "Review date", "Submitted at", "Complete", "Staff code", "Comment"],
            [new string?[] { "14.5", "2026-09-08", "2026-09-08T13:45:00+01:00", "true", "00123", "=HYPERLINK(\"https://example.com\")" }],
            false, ["number", "date", "datetime", "boolean", "text", "text"]);
        using var document = OpenWorkbook(sheet);
        Assert.Empty(new OpenXmlValidator().Validate(document));
        var worksheet = GetDataWorksheet(document);
        var cells = worksheet.GetFirstChild<SheetData>()!.Elements<Row>().Skip(1).Single().Elements<Cell>().ToArray();
        Assert.Equal(CellValues.Number, cells[0].DataType!.Value);
        Assert.Equal("14.5", cells[0].CellValue!.Text);
        Assert.Equal(3U, cells[1].StyleIndex!.Value);
        Assert.Equal(new DateTime(2026, 9, 8).ToOADate(), double.Parse(cells[1].CellValue!.Text, CultureInfo.InvariantCulture));
        Assert.Equal(4U, cells[2].StyleIndex!.Value);
        Assert.Equal(new DateTime(2026, 9, 8, 12, 45, 0).ToOADate(), double.Parse(cells[2].CellValue!.Text, CultureInfo.InvariantCulture));
        Assert.Equal(CellValues.Boolean, cells[3].DataType!.Value);
        Assert.Equal("1", cells[3].CellValue!.Text);
        Assert.Equal("00123", cells[4].InlineString!.InnerText);
        Assert.Equal(CellValues.InlineString, cells[5].DataType!.Value);
        Assert.StartsWith("=HYPERLINK", cells[5].InlineString!.InnerText);
        Assert.Empty(worksheet.Descendants<CellFormula>());
        Assert.Equal("A1:F2", worksheet.GetFirstChild<AutoFilter>()!.Reference!.Value);
        Assert.Equal(PaneStateValues.Frozen, worksheet.Descendants<Pane>().Single().State!.Value);
    }

    [Fact]
    public void Missing_metadata_and_invalid_legacy_values_are_preserved_as_text()
    {
        using var legacy = OpenWorkbook(new ExportSheet("Legacy", ["Count", "Date"], [new string?[] { "00123", "2026-09-08" }], false));
        Assert.All(GetDataWorksheet(legacy).Descendants<Cell>(), cell => Assert.Equal(CellValues.InlineString, cell.DataType!.Value));
        using var invalid = OpenWorkbook(new ExportSheet("Mixed", ["Number", "Date", "Boolean", "Blank"],
            [new string?[] { "NaN", "Not recorded", "Pending", null }], false, ["number", "date", "boolean", "number"]));
        var cells = GetDataWorksheet(invalid).GetFirstChild<SheetData>()!.Elements<Row>().Skip(1).Single().Elements<Cell>().ToArray();
        Assert.All(cells, cell => Assert.Equal(CellValues.InlineString, cell.DataType!.Value));
        Assert.Equal("NaN", cells[0].InlineString!.InnerText);
        Assert.Equal("Not recorded", cells[1].InlineString!.InnerText);
        Assert.Equal("Pending", cells[2].InlineString!.InnerText);
        Assert.Equal("", cells[3].InlineString!.InnerText);
    }

    [Fact]
    public void Answers_exceeding_the_excel_cell_limit_fail_without_silent_truncation()
    {
        var sheet = new ExportSheet("Answers", ["Response"], [new string?[] { new('a', 32_768) }], false);
        var error = Assert.Throws<WorkflowValidationException>(() => CreateWorkbook(sheet));
        Assert.Contains("32,767", error.Message);
        using var valid = OpenWorkbook(sheet with { Rows = [new string?[] { new('a', 32_767) }] });
        Assert.Equal(32_767, GetDataWorksheet(valid).GetFirstChild<SheetData>()!.Elements<Row>().Skip(1).Single().InnerText.Length);
    }

    [Fact]
    public void More_than_excel_column_limit_fails_with_actionable_message()
    {
        var sheet = new ExportSheet("Answers", Enumerable.Range(0, 16_385).Select(index => $"Question {index}").ToArray(), [], false);
        var error = Assert.Throws<WorkflowValidationException>(() => CreateWorkbook(sheet));
        Assert.Contains("16,384", error.Message);
    }

    [Fact]
    public void Values_beyond_excel_numeric_precision_are_not_rounded_silently()
    {
        using var document = OpenWorkbook(new ExportSheet("Amounts", ["Value"], [new string?[] { "123456789012345678" }], false, ["number"]));
        var cell = GetDataWorksheet(document).GetFirstChild<SheetData>()!.Elements<Row>().Skip(1).Single().Elements<Cell>().Single();
        Assert.Equal(CellValues.InlineString, cell.DataType!.Value);
        Assert.Equal("123456789012345678", cell.InlineString!.InnerText);
    }

    [Theory]
    [InlineData("1900-01-01", "1")]
    [InlineData("1900-02-28", "59")]
    [InlineData("1900-03-01", "61")]
    public void Early_excel_dates_account_for_the_1900_date_system(string date, string expected)
    {
        using var document = OpenWorkbook(new ExportSheet("Dates", ["Date"], [new string?[] { date }], false, ["date"]));
        Assert.Equal(expected, GetDataWorksheet(document).GetFirstChild<SheetData>()!.Elements<Row>().Skip(1).Single().Elements<Cell>().Single().CellValue!.Text);
    }

    private static GeneratedExport CreateWorkbook(ExportSheet sheet) => new ExcelExportService().CreateWorkbook(new ExportWorkbookData(
        "learning-walks", "Learning walks", new ExportFilter("2026/27", null, null, null, null, null, null, null, null),
        "Test reviewer", DateTimeOffset.Parse("2026-09-08T12:00:00Z"), [sheet]));

    private static SpreadsheetDocument OpenWorkbook(ExportSheet sheet) => SpreadsheetDocument.Open(new MemoryStream(CreateWorkbook(sheet).Content), false);

    private static Worksheet GetDataWorksheet(SpreadsheetDocument document)
    {
        var sheet = document.WorkbookPart!.Workbook.Sheets!.Elements<Sheet>().Single(item => item.Name != "Export Information");
        return ((WorksheetPart)document.WorkbookPart.GetPartById(sheet.Id!)).Worksheet;
    }
}
