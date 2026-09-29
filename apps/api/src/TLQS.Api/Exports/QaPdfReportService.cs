using TLQS.Application.Workflows;
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
        DrawOutcomeDistribution(canvas, report.Dashboard, report.OutcomeLabels ?? QaOutcomeLabels.Default);
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
        var filterSummary = string.Join("   |   ", new[]
        {
            $"Academic year: {report.Filter.AcademicYear ?? "All"}",
            $"Faculty: {report.Filter.FacultyCode ?? "All"}",
            $"Team: {report.Filter.TeamCode ?? "All"}",
            $"Status: {report.Filter.Status ?? "All"}",
            report.Filter.DeliveryAreaKey is null ? null : $"Delivery area: {(report.Filter.DeliveryAreaKey == "__not_recorded__" ? "Not recorded" : report.Filter.DeliveryAreaKey)}",
            report.Filter.FromDate is null ? null : $"From: {report.Filter.FromDate:dd MMM yyyy}",
            report.Filter.ToDate is null ? null : $"To: {report.Filter.ToDate:dd MMM yyyy}",
            report.Filter.RecordType is null ? null : $"Process: {report.Filter.RecordType}",
            report.Filter.DimensionLabel is null ? null : $"Focus: {report.Filter.DimensionLabel}"
        }.Where(value => value is not null));
        canvas.Text(Margin, canvas.Y, "Report scope", 10F, true, "153F35");
        canvas.Y -= 16F;
        DrawDashboardParagraph(canvas, report, filterSummary);
        canvas.Y -= 12F;
        if (report.Dashboard is { } dashboard)
        {
            DrawDashboardCards(canvas, report, dashboard.Metrics);
            foreach (var section in dashboard.Sections)
                DrawDashboardSection(canvas, report, section);
        }
        else
        {
            // Older module exports still get a complete expanded view, with no row or column preview limit.
            foreach (var sheet in reportSheets)
                DrawDashboardSheet(canvas, report, sheet);
            if (reportSheets.Length == 0)
                DrawDashboardParagraph(canvas, report, "No data matches the selected dashboard filters.");
        }

        var content = canvas.Pages.Select((page, index) =>
        {
            page.AppendLine("0.36 0.43 0.41 rg");
            var footer = DashboardWrap($"Generated {report.GeneratedAt:dd MMM yyyy HH:mm} UTC by {report.GeneratedBy}", ContentWidth - 100F, 7F, false);
            for (var line = 0; line < footer.Count; line++)
                page.AppendLine($"BT /F1 7 Tf {Margin.ToString(CultureInfo.InvariantCulture)} {(25F - line * 8F).ToString(CultureInfo.InvariantCulture)} Td ({PdfText(footer[line])}) Tj ET");
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
            var titleLines = DashboardWrap(report.DisplayName, ContentWidth, 22F, true);
            var height = 86F + (titleLines.Count - 1) * 26F;
            canvas.Fill(0, PageHeight - height, PageWidth, height, "153F35");
            canvas.Text(Margin, PageHeight - 30F, "i-Elevate | Leadership dashboard report", 11F, true, "A9E4D5");
            for (var line = 0; line < titleLines.Count; line++)
                canvas.Text(Margin, PageHeight - 59F - line * 26F, titleLines[line], 22F, true, "FFFFFF");
            canvas.Text(Margin, PageHeight - height + 10F, "Dashboard summary and expanded details for the selected filters", 9.5F, false, "D9ECE7");
            canvas.Y = PageHeight - height - 22F;
            return;
        }
        var continuationLines = DashboardWrap(report.DisplayName, ContentWidth, 12F, true);
        canvas.Text(Margin, PageHeight - 28F, "i-Elevate | Leadership dashboard report", 9F, true, "087F6F");
        for (var line = 0; line < continuationLines.Count; line++)
            canvas.Text(Margin, PageHeight - 43F - line * 15F, continuationLines[line], 12F, true, "153F35");
        var divider = PageHeight - 53F - (continuationLines.Count - 1) * 15F;
        canvas.Line(Margin, divider, PageWidth - Margin, divider, "C9D8D3", .8F);
        canvas.Y = divider - 17F;
    }

    private static void DrawDashboardCards(QaPdfCanvas canvas, ExportWorkbookData report, IReadOnlyList<DashboardReportMetric> metrics)
    {
        const int columns = 4;
        const float gap = 10F;
        var width = (ContentWidth - gap * (columns - 1)) / columns;
        for (var offset = 0; offset < metrics.Count; offset += columns)
        {
            var row = metrics.Skip(offset).Take(columns).ToArray();
            var labels = row.Select(metric => DashboardWrap(metric.Label, width - 26F, 8F, false)).ToArray();
            var values = row.Select(metric => DashboardWrap(metric.Value, width - 26F, 17F, true)).ToArray();
            var height = 24F + labels.Max(lines => lines.Count) * 10F + values.Max(lines => lines.Count) * 21F;
            EnsureDashboard(canvas, report, height + 14F);
            for (var index = 0; index < row.Length; index++)
            {
                var x = Margin + index * (width + gap);
                canvas.Fill(x, canvas.Y - height, width, height, "F1F6F4");
                canvas.Stroke(x, canvas.Y - height, width, height, "C9D8D3", .7F);
                canvas.Fill(x, canvas.Y - height, 4F, height, "087F6F");
                var textY = canvas.Y - 16F;
                foreach (var line in labels[index])
                {
                    canvas.Text(x + 13F, textY, line, 8F, false, "52645F");
                    textY -= 10F;
                }
                textY -= 16F;
                foreach (var line in values[index])
                {
                    canvas.Text(x + 13F, textY, line, 17F, true, "153F35");
                    textY -= 21F;
                }
            }
            canvas.Y -= height + 14F;
        }
    }

    private static void DrawDashboardSheet(QaPdfCanvas canvas, ExportWorkbookData report, ExportSheet sheet)
    {
        var columns = sheet.Columns.Select((label, index) => (Label: label, Index: index))
            .Where(column => !column.Label.EndsWith(" ID", StringComparison.OrdinalIgnoreCase)
                && !column.Label.Equals("ID", StringComparison.OrdinalIgnoreCase)).ToArray();
        var titleIndex = Array.FindIndex(sheet.Columns.ToArray(), label =>
            label.Equals("Title", StringComparison.OrdinalIgnoreCase) || label.Equals("Record title", StringComparison.OrdinalIgnoreCase));
        var items = sheet.Rows.Select((row, index) => new DashboardReportItem(
            titleIndex >= 0 && titleIndex < row.Count && !string.IsNullOrWhiteSpace(row[titleIndex])
                ? row[titleIndex]! : $"Entry {index + 1:N0}",
            columns.Where(column => column.Index != titleIndex).Select(column => new RecordReportField(column.Label,
                column.Index < row.Count ? row[column.Index] : null)).ToArray())).ToArray();
        DrawDashboardSection(canvas, report, new DashboardReportSection(sheet.Name,
            $"{sheet.Rows.Count:N0} entries" + (sheet.WasTruncated ? " | The source export limit was reached; narrow the filters to include all matching data." : ""), items));
    }

    private static void DrawDashboardSection(QaPdfCanvas canvas, ExportWorkbookData report, DashboardReportSection section)
    {
        var introductionHeight = DashboardWrap(section.Title, ContentWidth - 28F, 12F, true).Count * 28F + 10F
            + (string.IsNullOrWhiteSpace(section.Description) ? 0F : DashboardWrap(section.Description, ContentWidth, 8.5F, false).Count * 12F + 7F);
        EnsureDashboard(canvas, report, Math.Min(400F, introductionHeight + 80F));
        DrawDashboardBand(canvas, report, section.Title, false);
        if (!string.IsNullOrWhiteSpace(section.Description))
        {
            DrawDashboardParagraph(canvas, report, section.Description);
            canvas.Y -= 7F;
        }
        if (section.Items.Count == 0)
        {
            DrawDashboardParagraph(canvas, report, "No matching data.");
            canvas.Y -= 12F;
            return;
        }
        foreach (var item in section.Items)
        {
            EnsureDashboard(canvas, report, 66F);
            DrawDashboardItemTitle(canvas, report, item.Title);
            if (item.Distribution is { Count: > 0 })
                DrawDashboardDistribution(canvas, report, section.Title, item);
            foreach (var field in item.Fields)
                DrawDashboardField(canvas, report, section.Title, item.Title, field);
            canvas.Y -= 12F;
        }
        canvas.Y -= 8F;
    }

    private static void DrawDashboardBand(QaPdfCanvas canvas, ExportWorkbookData report, string title, bool continuation)
    {
        var lines = DashboardWrap(title + (continuation ? " (continued)" : ""), ContentWidth - 28F, 12F, true);
        foreach (var line in lines)
        {
            EnsureDashboard(canvas, report, 28F);
            canvas.Fill(Margin, canvas.Y - 28F, ContentWidth, 28F, "E7F2EF");
            canvas.Fill(Margin, canvas.Y - 28F, 5F, 28F, "087F6F");
            canvas.Text(Margin + 14F, canvas.Y - 19F, line, 12F, true, "153F35");
            canvas.Y -= 28F;
        }
        canvas.Y -= 10F;
    }

    private static void DrawDashboardItemTitle(QaPdfCanvas canvas, ExportWorkbookData report, string title)
    {
        foreach (var line in DashboardWrap(title, ContentWidth - 20F, 10F, true))
        {
            EnsureDashboard(canvas, report, 17F);
            canvas.Text(Margin + 10F, canvas.Y - 11F, line, 10F, true, "153F35");
            canvas.Y -= 15F;
        }
        canvas.Y -= 5F;
    }

    private static void DashboardContinuation(QaPdfCanvas canvas, ExportWorkbookData report, string section, string item)
    {
        canvas.NewPage();
        DrawDashboardHeader(canvas, report, false);
        DrawDashboardBand(canvas, report, section, true);
        DrawDashboardItemTitle(canvas, report, item);
    }

    private static void DrawDashboardField(QaPdfCanvas canvas, ExportWorkbookData report, string section, string item, RecordReportField field)
    {
        const float labelWidth = 208F;
        const float lineHeight = 11F;
        var labelLines = DashboardWrap(field.Label, labelWidth - 20F, 8F, true);
        var valueLines = DashboardWrap(string.IsNullOrWhiteSpace(field.Value) ? "Not recorded" : field.Value,
            ContentWidth - labelWidth - 20F, 8.5F, false);
        var count = Math.Max(labelLines.Count, valueLines.Count);
        var offset = 0;
        while (offset < count)
        {
            if (canvas.Y < 66F) DashboardContinuation(canvas, report, section, item);
            var available = Math.Max(1, (int)((canvas.Y - 50F) / lineHeight));
            var take = Math.Min(count - offset, available);
            var height = take * lineHeight + 8F;
            canvas.Fill(Margin, canvas.Y - height, ContentWidth, height, "FAFCFB");
            canvas.Fill(Margin, canvas.Y - height, labelWidth, height, "F1F6F4");
            canvas.Line(Margin, canvas.Y - height, Margin + ContentWidth, canvas.Y - height, "D8E2DF", .5F);
            for (var line = 0; line < take; line++)
            {
                var index = offset + line;
                var y = canvas.Y - 12F - line * lineHeight;
                var labelIndex = offset >= labelLines.Count ? line : index;
                if (labelIndex < labelLines.Count) canvas.Text(Margin + 10F, y, labelLines[labelIndex], 8F, true, "52645F");
                if (index < valueLines.Count) canvas.Text(Margin + labelWidth + 10F, y, valueLines[index], 8.5F, false, "243B35");
            }
            canvas.Y -= height;
            offset += take;
            if (offset < count) DashboardContinuation(canvas, report, section, item);
        }
    }

    private static void DrawDashboardDistribution(QaPdfCanvas canvas, ExportWorkbookData report, string section, DashboardReportItem item)
    {
        var distribution = item.Distribution!;
        var maximum = Math.Max(1m, distribution.Max(entry => entry.Value));
        const float labelWidth = 300F;
        const float barWidth = 340F;
        foreach (var entry in distribution)
        {
            var lines = DashboardWrap(entry.Label, labelWidth - 24F, 8.5F, false);
            var height = Math.Max(25F, lines.Count * 11F + 9F);
            if (canvas.Y - height < 42F) DashboardContinuation(canvas, report, section, item.Title);
            // Long configurable labels use the normal flowing field renderer instead of overflowing the chart.
            if (height > 300F)
            {
                DrawDashboardField(canvas, report, section, item.Title,
                    new RecordReportField(entry.Label, entry.Value.ToString("0.##", CultureInfo.InvariantCulture)));
                continue;
            }
            for (var index = 0; index < lines.Count; index++)
                canvas.Text(Margin + 10F, canvas.Y - 13F - index * 11F, lines[index], 8.5F, false, "243B35");
            canvas.Fill(Margin + labelWidth, canvas.Y - 17F, barWidth, 10F, "E5ECE9");
            var width = (float)(Math.Max(0m, entry.Value) / maximum) * barWidth;
            if (width > 0) canvas.Fill(Margin + labelWidth, canvas.Y - 17F, width, 10F, "087F6F");
            canvas.Text(Margin + labelWidth + barWidth + 12F, canvas.Y - 15F,
                entry.Value.ToString("0.##", CultureInfo.InvariantCulture), 9F, true, "153F35");
            canvas.Y -= height;
        }
        canvas.Y -= 6F;
    }

    private static void DrawDashboardParagraph(QaPdfCanvas canvas, ExportWorkbookData report, string text)
    {
        foreach (var line in DashboardWrap(text, ContentWidth, 8.5F, false))
        {
            EnsureDashboard(canvas, report, 14F);
            canvas.Text(Margin, canvas.Y - 10F, line, 8.5F, false, "52645F");
            canvas.Y -= 12F;
        }
    }

    private static IReadOnlyList<string> DashboardWrap(string text, float width, float size, bool bold) =>
        text.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n')
            .SelectMany(paragraph => QaPdfCanvas.Wrap(paragraph.Replace('\t', ' '), width, size, bold, precise: true)).ToArray();

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
        canvas.Y -= 16F;
        canvas.Text(Margin, canvas.Y, "Current shared outcome wording; saved outcomes and closure calculations are unchanged.", 7F, false, "52645F");
        canvas.Y -= 20F;

        var cards = new[]
        {
            ("Submissions", report.Dashboard.EvidenceCount.ToString(CultureInfo.InvariantCulture)),
            ("Rated responses", report.Dashboard.RatedCount.ToString(CultureInfo.InvariantCulture)),
            ("Teams with evidence", report.Dashboard.TeamCount.ToString(CultureInfo.InvariantCulture)),
            ((report.OutcomeLabels ?? QaOutcomeLabels.Default).AtOrAbove, report.Dashboard.RatedCount == 0 ? "No rated responses" : $"{report.Dashboard.AtOrAbovePercentage:0.0}%")
        };
        var gap = 10F;
        var width = (ContentWidth - (gap * 3F)) / 4F;
        for (var index = 0; index < cards.Length; index++)
        {
            var x = Margin + (index * (width + gap));
            canvas.Fill(x, canvas.Y - 78F, width, 78F, "F1F6F4");
            canvas.Stroke(x, canvas.Y - 78F, width, 78F, "C9D8D3", .7F);
            canvas.Fill(x, canvas.Y - 78F, 4F, 78F, "087F6F");
            var labelLines = QaPdfCanvas.Wrap(cards[index].Item1, width - 26F, 7F, false);
            for (var line = 0; line < labelLines.Count; line++)
                canvas.Text(x + 13F, canvas.Y - 14F - line * 9F, labelLines[line], 7F, false, "52645F");
            canvas.Text(x + 13F, canvas.Y - 66F, cards[index].Item2, cards[index].Item2.Length > 15 ? 12F : 17F, true, "153F35");
        }
        canvas.Y -= 94F;
    }

    private static void DrawOutcomeDistribution(QaPdfCanvas canvas, QaDashboardSummary dashboard, QaOutcomeLabels labels)
    {
        canvas.Text(Margin, canvas.Y, "Outcome distribution", 13F, true, "153F35");
        canvas.Text(PageWidth - Margin - 225F, canvas.Y, $"{dashboard.RatedCount} rated / {dashboard.RatedCount + dashboard.NotApplicableCount + dashboard.NotSeenCount} total responses", 8.5F, false, "52645F");
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
        DrawOutcomeLegend(canvas, labels, dashboard.BelowCount, dashboard.AtCount, dashboard.AboveCount, dashboard.NotApplicableCount, dashboard.RatedCount, dashboard.NotSeenCount);
        canvas.Text(Margin, canvas.Y, "Not seen and not applicable are excluded from rated percentages.", 7.5F, false, "52645F");
        canvas.Y -= 13F;
        canvas.Y -= 10F;
    }

    private static void DrawOutcomeLegend(QaPdfCanvas canvas, QaOutcomeLabels labels, int below, int at, int above, int notApplicable, int rated, int notSeen)
    {
        var items = new[] { ("Not seen", notSeen, "52645F", false), (labels.Below, below, "8A6218", true), (labels.At, at, "47774B", true), (labels.Above, above, "205E40", true), (labels.NotApplicable, notApplicable, "52645F", false) };
        var width = ContentWidth / items.Length;
        var height = 0F;
        for (var index = 0; index < items.Length; index++)
        {
            var lines = QaPdfCanvas.Wrap(items[index].Item1, width - 12F, 8F, true);
            for (var line = 0; line < lines.Count; line++)
                canvas.Text(Margin + index * width, canvas.Y - line * 10F, lines[line], 8F, true, items[index].Item3);
            var offset = lines.Count * 10F;
            canvas.Text(Margin + index * width, canvas.Y - offset, items[index].Item4 && rated > 0 ? $"{items[index].Item2} ({Rate(items[index].Item2, rated)})" : items[index].Item2.ToString(), 8F, false, items[index].Item3);
            height = Math.Max(height, offset + 16F);
        }
        canvas.Y -= height;
        if (rated == 0)
        {
            canvas.Text(Margin, canvas.Y, "No rated responses", 8F, false, "52645F");
            canvas.Y -= 14F;
        }
    }

    private static void DrawProcesses(QaPdfCanvas canvas, QaReviewReportData report)
    {
        var labels = report.OutcomeLabels ?? QaOutcomeLabels.Default;
        foreach (var process in report.Dashboard.ByActivity)
        {
            var questions = report.Dashboard.Questions.Where(question => question.ActivityKey == process.Key).ToArray();
            var legendHeight = new[] { "Not seen", labels.Below, labels.At, labels.Above, labels.NotApplicable }
                .Max(label => QaPdfCanvas.Wrap(label, ContentWidth / 5F - 12F, 8F, true).Count) * 10F + 16F
                + (process.Rated == 0 ? 14F : 0F);
            var firstQuestionHeight = questions.Length == 0 ? 22F : QaQuestionCardHeight(questions[0], labels) + 8F;
            Ensure(canvas, report, 44F + legendHeight + firstQuestionHeight);
            canvas.Fill(Margin, canvas.Y - 30F, ContentWidth, 30F, "E7F2EF");
            canvas.Fill(Margin, canvas.Y - 30F, 5F, 30F, "087F6F");
            canvas.Text(Margin + 14F, canvas.Y - 19F, process.Label, 12F, true, "153F35");
            canvas.Y -= 44F;
            DrawOutcomeLegend(canvas, labels, process.Below, process.At, process.Above, process.NotApplicable, process.Rated, process.NotSeen);

            if (questions.Length == 0)
            {
                canvas.Text(Margin + 12F, canvas.Y, "No criteria are attached to this process.", 8.5F, false, "52645F");
                canvas.Y -= 22F;
                continue;
            }

            foreach (var question in questions)
            {
                var lines = QaPdfCanvas.Wrap(question.QuestionText, 425F, 8.5F, true);
                var outcomeLines = QaQuestionOutcomeLines(question, labels);
                var cardHeight = QaQuestionCardHeight(question, labels);
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
                var outcomeY = canvas.Y - 40F;
                foreach (var line in outcomeLines)
                    {
                        canvas.Text(barX, outcomeY, line, 7F, false, "52645F");
                        outcomeY -= 9F;
                    }
                canvas.Y -= cardHeight + 7F;
            }
            canvas.Y -= 8F;
        }
    }

    private static string[] QaQuestionOutcomeLines(QaDashboardQuestionBreakdown question, QaOutcomeLabels labels) => new[]
    {
        $"Not seen: {question.NotSeen}",
        OutcomeText(labels.Below, question.Below, question.Rated),
        OutcomeText(labels.At, question.At, question.Rated),
        OutcomeText(labels.Above, question.Above, question.Rated),
        $"{labels.NotApplicable}: {question.NotApplicable}",
        question.Rated == 0 ? "No rated responses" : $"{question.Rated} rated responses"
    }.SelectMany(outcome => QaPdfCanvas.Wrap(outcome, ContentWidth - 486F, 7F, false)).ToArray();

    private static float QaQuestionCardHeight(QaDashboardQuestionBreakdown question, QaOutcomeLabels labels) =>
        Math.Max(48F + QaQuestionOutcomeLines(question, labels).Length * 9F,
            27F + QaPdfCanvas.Wrap(question.QuestionText, 425F, 8.5F, true).Count * 11F);

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

    private static string Rate(int count, int total) => total == 0 ? "No rated responses" : $"{Math.Round(count * 100m / total, 1):0.0}%";

    private static string OutcomeText(string label, int count, int rated) => rated == 0 ? $"{label}: {count}" : $"{label}: {count} ({Rate(count, rated)})";

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

        public static IReadOnlyList<string> Wrap(string text, float maxWidth, float fontSize, bool bold, bool precise = false)
        {
            float Width(string value) => precise
                ? value.Sum(character => (bold ? HelveticaBoldWidths : HelveticaWidths)[Math.Clamp(character - 32, 0, 94)]) * fontSize / 1000F
                : Measure(value, fontSize, bold);
            var clean = PdfText(text).Replace("\\(", "(").Replace("\\)", ")").Replace("\\\\", "\\");
            var words = clean.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            var lines = new List<string>();
            var current = "";
            foreach (var word in words)
            {
                if (Width(word) > maxWidth)
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
                        if (chunk.Length > 0 && Width(candidateChunk) > maxWidth)
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
                if (Width(candidate) <= maxWidth)
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

        // Standard PDF Helvetica advance widths, ASCII 32-126, in thousandths of an em.
        // Dashboard exports use exact widths so long configurable wording cannot run into another column.
        private static readonly int[] HelveticaWidths =
            [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
        private static readonly int[] HelveticaBoldWidths =
            [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

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
