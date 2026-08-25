using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using TLQS.Api.V1;

namespace TLQS.Api.Exports;

public sealed class QaPdfReportService
{
    private const float PageWidth = 842F;
    private const float PageHeight = 595F;
    private const float Margin = 40F;
    private const float ContentWidth = PageWidth - (Margin * 2F);

    public GeneratedExport CreateReport(QaReviewReportData report)
    {
        var canvas = new QaPdfCanvas(PageWidth, PageHeight, Margin);
        canvas.NewPage();
        DrawPageHeader(canvas, report, firstPage: true);
        DrawHeadline(canvas, report);
        DrawOutcomeDistribution(canvas, report.Dashboard);
        DrawProcesses(canvas, report);
        DrawCoverage(canvas, report);

        var content = canvas.Pages.Select((page, index) =>
        {
            page.AppendLine("0.36 0.43 0.41 rg");
            page.AppendLine($"BT /F1 8 Tf {Margin.ToString(CultureInfo.InvariantCulture)} 20 Td ({PdfText($"Generated {report.GeneratedAt:dd MMM yyyy HH:mm} UTC by {report.GeneratedBy}" )}) Tj ET");
            page.AppendLine($"BT /F1 8 Tf {(PageWidth - Margin - 70).ToString(CultureInfo.InvariantCulture)} 20 Td (Page {index + 1} of {canvas.Pages.Count}) Tj ET");
            return page.ToString();
        }).ToArray();

        return new GeneratedExport(
            BuildPdf(content),
            "application/pdf",
            $"{SafeFileName(report.Review.Review.Title)}-qa-report-{report.GeneratedAt:yyyy-MM-dd}.pdf");
    }

    public GeneratedExport CreateDashboardReport(ExportWorkbookData report)
    {
        var canvas = new QaPdfCanvas(PageWidth, PageHeight, Margin);
        canvas.NewPage();
        DrawDashboardHeader(canvas, report, true);
        var reportSheets = report.Sheets
            .Where(sheet => sheet.Rows.Count > 0)
            .Where(sheet => !sheet.Name.Equals("Dashboard Records", StringComparison.OrdinalIgnoreCase)
                || !report.Sheets.Any(candidate => candidate.Name.Equals("Full Records", StringComparison.OrdinalIgnoreCase)))
            .ToArray();
        var totalRows = reportSheets.Sum(sheet => sheet.Rows.Count);
        var filterSummary = string.Join("   |   ", new[]
        {
            $"Academic year: {report.Filter.AcademicYear ?? "All"}",
            $"Faculty: {report.Filter.FacultyCode ?? "All"}",
            $"Team: {report.Filter.TeamCode ?? "All"}",
            $"Status: {report.Filter.Status ?? "All"}"
        });
        canvas.Text(Margin, canvas.Y, "Report scope", 10F, true, "153F35");
        canvas.Y -= 16F;
        canvas.Text(Margin, canvas.Y, filterSummary, 8.5F, false, "52645F");
        canvas.Y -= 26F;
        DrawDashboardCards(canvas, reportSheets.Length, totalRows, report.GeneratedAt);

        for (var index = 0; index < reportSheets.Length; index++)
        {
            if (index > 0)
            {
                canvas.NewPage();
                DrawDashboardHeader(canvas, report, false);
            }
            DrawDashboardSheet(canvas, report, reportSheets[index]);
        }

        var content = canvas.Pages.Select((page, index) =>
        {
            page.AppendLine("0.36 0.43 0.41 rg");
            page.AppendLine($"BT /F1 8 Tf {Margin.ToString(CultureInfo.InvariantCulture)} 20 Td ({PdfText($"Generated {report.GeneratedAt:dd MMM yyyy HH:mm} UTC by {report.GeneratedBy}")}) Tj ET");
            page.AppendLine($"BT /F1 8 Tf {(PageWidth - Margin - 70).ToString(CultureInfo.InvariantCulture)} 20 Td (Page {index + 1} of {canvas.Pages.Count}) Tj ET");
            return page.ToString();
        }).ToArray();
        return new GeneratedExport(
            BuildPdf(content), "application/pdf",
            $"{SafeFileName(report.DisplayName)}-dashboard-{report.GeneratedAt:yyyy-MM-dd}.pdf");
    }

    private static void DrawDashboardHeader(QaPdfCanvas canvas, ExportWorkbookData report, bool firstPage)
    {
        if (firstPage)
        {
            canvas.Fill(0, PageHeight - 86F, PageWidth, 86F, "153F35");
            canvas.Text(Margin, PageHeight - 30F, "i-Elevate | Leadership dashboard report", 11F, true, "A9E4D5");
            canvas.Text(Margin, PageHeight - 59F, report.DisplayName, 22F, true, "FFFFFF");
            canvas.Text(Margin, PageHeight - 76F, "Permission-scoped dashboard data and expanded form detail", 9.5F, false, "D9ECE7");
            canvas.Y = PageHeight - 108F;
            return;
        }
        canvas.Text(Margin, PageHeight - 28F, "i-Elevate | Leadership dashboard report", 9F, true, "087F6F");
        canvas.Text(Margin, PageHeight - 43F, report.DisplayName, 12F, true, "153F35");
        canvas.Line(Margin, PageHeight - 53F, PageWidth - Margin, PageHeight - 53F, "C9D8D3", .8F);
        canvas.Y = PageHeight - 70F;
    }

    private static void DrawDashboardCards(QaPdfCanvas canvas, int sheetCount, int rowCount, DateTimeOffset generatedAt)
    {
        var cards = new[]
        {
            ("Datasets", sheetCount.ToString(CultureInfo.InvariantCulture)),
            ("Detailed rows", rowCount.ToString("N0", CultureInfo.InvariantCulture)),
            ("Generated", generatedAt.ToString("dd MMM yyyy", CultureInfo.InvariantCulture))
        };
        const float gap = 12F;
        var width = (ContentWidth - (gap * 2F)) / 3F;
        for (var index = 0; index < cards.Length; index++)
        {
            var x = Margin + (index * (width + gap));
            canvas.Fill(x, canvas.Y - 52F, width, 52F, "F1F6F4");
            canvas.Stroke(x, canvas.Y - 52F, width, 52F, "C9D8D3", .7F);
            canvas.Fill(x, canvas.Y - 52F, 4F, 52F, "087F6F");
            canvas.Text(x + 13F, canvas.Y - 18F, cards[index].Item1, 8F, false, "52645F");
            canvas.Text(x + 13F, canvas.Y - 39F, cards[index].Item2, 15F, true, "153F35");
        }
        canvas.Y -= 72F;
    }

    private static void DrawDashboardSheet(QaPdfCanvas canvas, ExportWorkbookData report, ExportSheet sheet)
    {
        const int pdfRowLimit = 120;
        var availableColumns = sheet.Columns
            .Select((header, index) => (Header: header, Index: index))
            .Where(column => !column.Header.EndsWith(" ID", StringComparison.OrdinalIgnoreCase))
            .ToArray();
        var preferredHeaders = sheet.Name.Equals("Question-Level Results", StringComparison.OrdinalIgnoreCase)
            ? new[] { "Record title", "Faculty", "Team", "Question", "Response" }
            : [];
        var selectedColumns = preferredHeaders
            .Select(header => availableColumns.FirstOrDefault(column => column.Header.Equals(header, StringComparison.OrdinalIgnoreCase)))
            .Where(column => column.Header is not null)
            .ToArray();
        if (selectedColumns.Length == 0) selectedColumns = availableColumns.Take(5).ToArray();
        if (selectedColumns.Length == 0)
        {
            selectedColumns = sheet.Columns.Take(5).Select((header, index) => (Header: header, Index: index)).ToArray();
        }
        var weights = selectedColumns.Select(column => DashboardColumnWeight(column.Header)).ToArray();
        var weightTotal = weights.Sum();
        var columnWidths = weights.Select(weight => ContentWidth * weight / weightTotal).ToArray();
        EnsureDashboard(canvas, report, 72F);
        canvas.Fill(Margin, canvas.Y - 42F, ContentWidth, 42F, "E7F2EF");
        canvas.Fill(Margin, canvas.Y - 42F, 5F, 42F, "087F6F");
        canvas.Text(Margin + 14F, canvas.Y - 17F, sheet.Name, 12F, true, "153F35");
        canvas.Text(Margin + 14F, canvas.Y - 33F,
            $"{sheet.Rows.Count:N0} rows{(sheet.WasTruncated ? " | Excel row limit reached" : "")}", 8F, false, "52645F");
        canvas.Y -= 51F;
        EnsureDashboard(canvas, report, 28F);
        canvas.Fill(Margin, canvas.Y - 24F, ContentWidth, 24F, "153F35");
        var headerX = Margin;
        for (var index = 0; index < selectedColumns.Length; index++)
        {
            var header = QaPdfCanvas.Wrap(selectedColumns[index].Header, columnWidths[index] - 10F, 7F, true).FirstOrDefault() ?? "";
            canvas.Text(headerX + 5F, canvas.Y - 15F, header, 7F, true, "FFFFFF");
            headerX += columnWidths[index];
        }
        canvas.Y -= 24F;

        foreach (var row in sheet.Rows.Take(pdfRowLimit))
        {
            var wrapped = selectedColumns.Select((column, index) => QaPdfCanvas.Wrap(
                column.Index < row.Count ? row[column.Index] ?? "" : "", columnWidths[index] - 10F, 6.8F, false).Take(2).ToArray()).ToArray();
            var height = Math.Max(24F, 8F + wrapped.Max(lines => lines.Length) * 9F);
            EnsureDashboard(canvas, report, height + 2F);
            canvas.Fill(Margin, canvas.Y - height, ContentWidth, height, "FAFCFB");
            canvas.Line(Margin, canvas.Y - height, Margin + ContentWidth, canvas.Y - height, "D8E2DF", .5F);
            var cellX = Margin;
            for (var column = 0; column < selectedColumns.Length; column++)
            {
                var textY = canvas.Y - 11F;
                foreach (var line in wrapped[column])
                {
                    canvas.Text(cellX + 5F, textY, line, 6.8F, false, "243B35");
                    textY -= 9F;
                }
                cellX += columnWidths[column];
            }
            canvas.Y -= height;
        }
        if (sheet.Rows.Count > pdfRowLimit)
        {
            EnsureDashboard(canvas, report, 28F);
            canvas.Text(Margin, canvas.Y - 12F,
                $"PDF preview shows the first {pdfRowLimit} rows. The Excel report contains the complete permission-scoped dataset.",
                8F, true, "8A6218");
            canvas.Y -= 30F;
        }
        canvas.Y -= 12F;
    }

    private static float DashboardColumnWeight(string header) => header.ToLowerInvariant() switch
    {
        var value when value.Contains("question") || value.Contains("description") || value.Contains("summary") || value.Contains("response") => 2.2F,
        var value when value.Contains("title") || value.Contains("source record") => 1.8F,
        var value when value.Contains("staff") || value.Contains("reviewer") || value.Contains("owner") || value.Contains("faculty") || value.Contains("team") => 1.25F,
        _ => 1F
    };

    private static void EnsureDashboard(QaPdfCanvas canvas, ExportWorkbookData report, float requiredHeight)
    {
        if (canvas.Y - requiredHeight >= 42F) return;
        canvas.NewPage();
        DrawDashboardHeader(canvas, report, false);
    }

    private static void DrawPageHeader(QaPdfCanvas canvas, QaReviewReportData report, bool firstPage)
    {
        if (firstPage)
        {
            canvas.Fill(0, PageHeight - 86F, PageWidth, 86F, "153F35");
            canvas.Text(Margin, PageHeight - 30F, "i-Elevate | QA Review report", 11F, true, "A9E4D5");
            canvas.Text(Margin, PageHeight - 58F, report.Review.Review.Title, 22F, true, "FFFFFF");
            canvas.Text(Margin, PageHeight - 76F,
                $"{report.Review.Review.AcademicYear} | {report.Review.Review.Theme} | {TitleCase(report.Review.Review.Status)}",
                9.5F, false, "D9ECE7");
            canvas.Y = PageHeight - 108F;
            return;
        }

        canvas.Text(Margin, PageHeight - 28F, "i-Elevate | QA Review report", 9F, true, "087F6F");
        canvas.Text(Margin, PageHeight - 43F, report.Review.Review.Title, 12F, true, "153F35");
        canvas.Line(Margin, PageHeight - 53F, PageWidth - Margin, PageHeight - 53F, "C9D8D3", .8F);
        canvas.Y = PageHeight - 70F;
    }

    private static void DrawHeadline(QaPdfCanvas canvas, QaReviewReportData report)
    {
        canvas.Text(Margin, canvas.Y, "Report scope", 10F, true, "153F35");
        canvas.Y -= 15F;
        var scope = $"Faculty: {report.FacultyName ?? "All faculties"}   |   Team: {report.TeamName ?? "All teams"}   |   Owner: {report.Review.Review.OwnerName}   |   Closing date: {report.Review.Review.ClosingDate:dd MMM yyyy}";
        canvas.Text(Margin, canvas.Y, scope, 8.5F, false, "52645F");
        canvas.Y -= 24F;

        var cards = new[]
        {
            ("Submissions", report.Dashboard.EvidenceCount.ToString(CultureInfo.InvariantCulture)),
            ("Rated responses", report.Dashboard.RatedCount.ToString(CultureInfo.InvariantCulture)),
            ("Teams with evidence", report.Dashboard.TeamCount.ToString(CultureInfo.InvariantCulture)),
            ("At or above standard", $"{report.Dashboard.AtOrAbovePercentage:0.0}%")
        };
        var gap = 10F;
        var width = (ContentWidth - (gap * 3F)) / 4F;
        for (var index = 0; index < cards.Length; index++)
        {
            var x = Margin + (index * (width + gap));
            canvas.Fill(x, canvas.Y - 54F, width, 54F, "F1F6F4");
            canvas.Stroke(x, canvas.Y - 54F, width, 54F, "C9D8D3", .7F);
            canvas.Fill(x, canvas.Y - 54F, 4F, 54F, "087F6F");
            canvas.Text(x + 13F, canvas.Y - 18F, cards[index].Item1, 8F, false, "52645F");
            canvas.Text(x + 13F, canvas.Y - 41F, cards[index].Item2, 17F, true, "153F35");
        }
        canvas.Y -= 72F;
    }

    private static void DrawOutcomeDistribution(QaPdfCanvas canvas, QaDashboardSummary dashboard)
    {
        canvas.Text(Margin, canvas.Y, "Outcome distribution", 13F, true, "153F35");
        canvas.Text(PageWidth - Margin - 190F, canvas.Y, $"{dashboard.RatedCount} rated responses", 8.5F, false, "52645F");
        canvas.Y -= 17F;
        canvas.Fill(Margin, canvas.Y - 16F, ContentWidth, 16F, "E5ECE9");
        if (dashboard.RatedCount > 0)
        {
            var x = Margin;
            foreach (var item in new[]
                     {
                         (dashboard.BelowCount, "D29B2E"),
                         (dashboard.AtCount, "76B77C"),
                         (dashboard.AboveCount, "26734D")
                     })
            {
                var width = ContentWidth * item.Item1 / dashboard.RatedCount;
                if (width > 0) canvas.Fill(x, canvas.Y - 16F, width, 16F, item.Item2);
                x += width;
            }
        }
        canvas.Y -= 29F;
        canvas.Text(Margin, canvas.Y, $"Below standard  {dashboard.BelowCount} ({Rate(dashboard.BelowCount, dashboard.RatedCount)})", 8.5F, true, "8A6218");
        canvas.Text(Margin + 205F, canvas.Y, $"At standard  {dashboard.AtCount} ({Rate(dashboard.AtCount, dashboard.RatedCount)})", 8.5F, true, "47774B");
        canvas.Text(Margin + 405F, canvas.Y, $"Above standard  {dashboard.AboveCount} ({Rate(dashboard.AboveCount, dashboard.RatedCount)})", 8.5F, true, "205E40");
        canvas.Text(Margin + 625F, canvas.Y, $"N/A  {dashboard.NotApplicableCount}", 8.5F, false, "52645F");
        canvas.Y -= 28F;
    }

    private static void DrawProcesses(QaPdfCanvas canvas, QaReviewReportData report)
    {
        foreach (var process in report.Dashboard.ByActivity)
        {
            Ensure(canvas, report, 68F);
            canvas.Fill(Margin, canvas.Y - 42F, ContentWidth, 42F, "E7F2EF");
            canvas.Fill(Margin, canvas.Y - 42F, 5F, 42F, "087F6F");
            canvas.Text(Margin + 14F, canvas.Y - 17F, process.Label, 12F, true, "153F35");
            canvas.Text(Margin + 14F, canvas.Y - 33F,
                $"Below {process.Below} | At {process.At} | Above {process.Above} | N/A {process.NotApplicable} | {process.AtOrAbovePercentage:0.0}% at or above",
                8F, false, "52645F");
            canvas.Y -= 52F;

            var questions = report.Dashboard.Questions.Where(question => question.ActivityKey == process.Key).ToArray();
            if (questions.Length == 0)
            {
                canvas.Text(Margin + 12F, canvas.Y, "No criteria are attached to this process.", 8.5F, false, "52645F");
                canvas.Y -= 22F;
                continue;
            }

            foreach (var question in questions)
            {
                var lines = QaPdfCanvas.Wrap(question.QuestionText, 425F, 8.5F, true);
                var cardHeight = Math.Max(54F, 27F + (lines.Count * 11F));
                Ensure(canvas, report, cardHeight + 8F);
                canvas.Fill(Margin, canvas.Y - cardHeight, ContentWidth, cardHeight, "FAFCFB");
                canvas.Stroke(Margin, canvas.Y - cardHeight, ContentWidth, cardHeight, "D8E2DF", .6F);
                canvas.Text(Margin + 12F, canvas.Y - 14F, question.ThemeOrWeek ?? "General", 7F, true, "087F6F");
                var textY = canvas.Y - 29F;
                foreach (var line in lines)
                {
                    canvas.Text(Margin + 12F, textY, line, 8.5F, true, "243B35");
                    textY -= 11F;
                }

                var barX = Margin + 470F;
                var barWidth = ContentWidth - 486F;
                canvas.Fill(barX, canvas.Y - 25F, barWidth, 10F, "E5ECE9");
                if (question.Rated > 0)
                {
                    var x = barX;
                    foreach (var item in new[]
                             {
                                 (question.Below, "D29B2E"),
                                 (question.At, "76B77C"),
                                 (question.Above, "26734D")
                             })
                    {
                        var width = barWidth * item.Item1 / question.Rated;
                        if (width > 0) canvas.Fill(x, canvas.Y - 25F, width, 10F, item.Item2);
                        x += width;
                    }
                }
                canvas.Text(barX, canvas.Y - 42F,
                    $"Below {question.Below} ({question.BelowPercentage:0.0}%)   At {question.At} ({question.AtPercentage:0.0}%)   Above {question.Above} ({question.AbovePercentage:0.0}%)",
                    7.2F, false, "3E504B");
                if (question.NotApplicable > 0)
                    canvas.Text(barX, canvas.Y - 54F, $"Not applicable {question.NotApplicable}", 7F, false, "52645F");
                canvas.Y -= cardHeight + 7F;
            }
            canvas.Y -= 8F;
        }
    }

    private static void DrawCoverage(QaPdfCanvas canvas, QaReviewReportData report)
    {
        Ensure(canvas, report, 92F);
        canvas.Text(Margin, canvas.Y, "Coverage and follow-up", 13F, true, "153F35");
        canvas.Y -= 21F;
        canvas.Text(Margin, canvas.Y, "Teams without submitted evidence", 8F, true, "52645F");
        canvas.Y -= 14F;
        var emptyTeams = report.Dashboard.TeamsWithoutEvidence.Count == 0
            ? "None - every selected team has submitted evidence."
            : string.Join(", ", report.Dashboard.TeamsWithoutEvidence);
        foreach (var line in QaPdfCanvas.Wrap(emptyTeams, ContentWidth, 8.5F, false))
        {
            Ensure(canvas, report, 13F);
            canvas.Text(Margin, canvas.Y, line, 8.5F, false, "243B35");
            canvas.Y -= 12F;
        }
        canvas.Y -= 10F;
    }

    private static void DrawActions(QaPdfCanvas canvas, QaReviewReportData report)
    {
        Ensure(canvas, report, 62F);
        canvas.Fill(Margin, canvas.Y - 50F, ContentWidth, 50F, "F1F6F4");
        canvas.Stroke(Margin, canvas.Y - 50F, ContentWidth, 50F, "C9D8D3", .7F);
        canvas.Text(Margin + 13F, canvas.Y - 19F, "Linked actions", 10F, true, "153F35");
        canvas.Text(Margin + 13F, canvas.Y - 37F,
            $"{report.Dashboard.OpenActionCount} open of {report.Dashboard.LinkedActionCount} linked actions. Full action details are included in the Excel report.",
            8.5F, false, "52645F");
        canvas.Y -= 62F;
    }

    private static void Ensure(QaPdfCanvas canvas, QaReviewReportData report, float requiredHeight)
    {
        if (canvas.Y - requiredHeight >= 42F) return;
        canvas.NewPage();
        DrawPageHeader(canvas, report, firstPage: false);
    }

    private static string Rate(int count, int total) => total == 0 ? "0.0%" : $"{Math.Round(count * 100m / total, 1):0.0}%";

    private static string TitleCase(string value) => value.Length == 0 ? value : char.ToUpperInvariant(value[0]) + value[1..];

    private static string SafeFileName(string value) =>
        Regex.Replace(value.ToLowerInvariant(), "[^a-z0-9-]+", "-").Trim('-');

    private static byte[] BuildPdf(IReadOnlyList<string> pages)
    {
        var objectCount = 4 + (pages.Count * 2);
        var objects = new string[objectCount + 1];
        objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
        var pageReferences = Enumerable.Range(0, pages.Count).Select(index => $"{5 + (index * 2)} 0 R");
        objects[2] = $"<< /Type /Pages /Count {pages.Count} /Kids [{string.Join(' ', pageReferences)}] >>";
        objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
        objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
        for (var index = 0; index < pages.Count; index++)
        {
            var pageId = 5 + (index * 2);
            var contentId = pageId + 1;
            var contentLength = Encoding.ASCII.GetByteCount(pages[index]);
            objects[pageId] = $"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PageWidth.ToString(CultureInfo.InvariantCulture)} {PageHeight.ToString(CultureInfo.InvariantCulture)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents {contentId} 0 R >>";
            objects[contentId] = $"<< /Length {contentLength} >>\nstream\n{pages[index]}endstream";
        }

        using var stream = new MemoryStream();
        static void Write(MemoryStream target, string value)
        {
            var bytes = Encoding.ASCII.GetBytes(value);
            target.Write(bytes, 0, bytes.Length);
        }
        Write(stream, "%PDF-1.4\n%TLQS\n");
        var offsets = new long[objectCount + 1];
        for (var id = 1; id <= objectCount; id++)
        {
            offsets[id] = stream.Position;
            Write(stream, $"{id} 0 obj\n{objects[id]}\nendobj\n");
        }
        var xref = stream.Position;
        Write(stream, $"xref\n0 {objectCount + 1}\n0000000000 65535 f \n");
        for (var id = 1; id <= objectCount; id++) Write(stream, $"{offsets[id]:D10} 00000 n \n");
        Write(stream, $"trailer\n<< /Size {objectCount + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n");
        return stream.ToArray();
    }

    private static string PdfText(string value)
    {
        var mapped = value
            .Replace('\u2010', '-').Replace('\u2011', '-').Replace('\u2012', '-').Replace('\u2013', '-').Replace('\u2014', '-')
            .Replace('\u2018', '\'').Replace('\u2019', '\'').Replace('\u201C', '"').Replace('\u201D', '"')
            .Replace('\u2022', '-').Replace('\u00A0', ' ');
        var normalized = mapped.Normalize(NormalizationForm.FormD);
        var ascii = new string(normalized.Where(character => CharUnicodeInfo.GetUnicodeCategory(character) != UnicodeCategory.NonSpacingMark)
            .Select(character => character is >= ' ' and <= '~' ? character : '?').ToArray());
        return ascii.Replace("\\", "\\\\").Replace("(", "\\(").Replace(")", "\\)");
    }

    private sealed class QaPdfCanvas(float pageWidth, float pageHeight, float margin)
    {
        public List<StringBuilder> Pages { get; } = [];
        public float Y { get; set; }
        private StringBuilder Current => Pages[^1];

        public void NewPage()
        {
            Pages.Add(new StringBuilder());
            Fill(0, 0, pageWidth, pageHeight, "FFFFFF");
            Y = pageHeight - margin;
        }

        public void Text(float x, float y, string text, float size, bool bold, string colour)
        {
            var (red, green, blue) = Colour(colour);
            Current.AppendLine($"{red} {green} {blue} rg");
            Current.AppendLine($"BT /{(bold ? "F2" : "F1")} {Number(size)} Tf {Number(x)} {Number(y)} Td ({PdfText(text)}) Tj ET");
        }

        public void Fill(float x, float y, float width, float height, string colour)
        {
            var (red, green, blue) = Colour(colour);
            Current.AppendLine($"{red} {green} {blue} rg {Number(x)} {Number(y)} {Number(width)} {Number(height)} re f");
        }

        public void Stroke(float x, float y, float width, float height, string colour, float lineWidth)
        {
            var (red, green, blue) = Colour(colour);
            Current.AppendLine($"{red} {green} {blue} RG {Number(lineWidth)} w {Number(x)} {Number(y)} {Number(width)} {Number(height)} re S");
        }

        public void Line(float x1, float y1, float x2, float y2, string colour, float lineWidth)
        {
            var (red, green, blue) = Colour(colour);
            Current.AppendLine($"{red} {green} {blue} RG {Number(lineWidth)} w {Number(x1)} {Number(y1)} m {Number(x2)} {Number(y2)} l S");
        }

        public static IReadOnlyList<string> Wrap(string text, float maxWidth, float fontSize, bool bold)
        {
            var clean = PdfText(text).Replace("\\(", "(").Replace("\\)", ")").Replace("\\\\", "\\");
            var words = clean.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            var lines = new List<string>();
            var current = "";
            foreach (var word in words)
            {
                if (Measure(word, fontSize, bold) > maxWidth)
                {
                    if (current.Length > 0)
                    {
                        lines.Add(current);
                        current = "";
                    }
                    var chunk = "";
                    foreach (var character in word)
                    {
                        var candidateChunk = chunk + character;
                        if (chunk.Length > 0 && Measure(candidateChunk, fontSize, bold) > maxWidth)
                        {
                            lines.Add(chunk);
                            chunk = character.ToString();
                        }
                        else
                        {
                            chunk = candidateChunk;
                        }
                    }
                    current = chunk;
                    continue;
                }
                var candidate = current.Length == 0 ? word : $"{current} {word}";
                if (Measure(candidate, fontSize, bold) <= maxWidth)
                {
                    current = candidate;
                    continue;
                }
                if (current.Length > 0) lines.Add(current);
                current = word;
            }
            if (current.Length > 0) lines.Add(current);
            return lines.Count == 0 ? [""] : lines;
        }

        private static float Measure(string value, float size, bool bold) =>
            value.Sum(character => character == ' ' ? .28F : char.IsUpper(character) ? .62F : char.IsDigit(character) ? .55F : .5F) * size * (bold ? 1.03F : 1F);

        private static (string Red, string Green, string Blue) Colour(string hex)
        {
            var red = Convert.ToInt32(hex[..2], 16) / 255F;
            var green = Convert.ToInt32(hex.Substring(2, 2), 16) / 255F;
            var blue = Convert.ToInt32(hex.Substring(4, 2), 16) / 255F;
            return (Number(red), Number(green), Number(blue));
        }

        private static string Number(float value) => value.ToString("0.###", CultureInfo.InvariantCulture);
    }
}
