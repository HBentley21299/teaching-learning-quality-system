using System.Text;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Spreadsheet;
using DocumentFormat.OpenXml.Validation;
using TLQS.Api.Exports;
using TLQS.Api.V1;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class DashboardSubmissionExportTests
{
    private static ExportFilter Filter => new("2026/27", "FAC", null, new(2026, 10, 1), new(2026, 10, 31), null, null, "submitted", null, "adult", "Planning");

    [Fact]
    public void EliCohortRetainsNonSubmittersRegardlessOfRecordFiltersAndHonoursOrganisationExclusions()
    {
        var submitted = Staff("Submitted colleague", true);
        var pending = Staff("Pending colleague", false);
        var excludedId = Guid.NewGuid();
        var rows = DashboardSubmissionExportBuilder.ScopeEliStaff([
            submitted, pending, Staff("Outside faculty", false) with { ParentAreaCode = "OTHER" },
            Staff("Excluded unit", false) with { OrgUnitId = excludedId },
            Staff("Excluded code", false) with { AreaCode = "HIDDEN" },
            Staff("Excluded faculty", false) with { ParentAreaCode = "HIDDEN_FAC" }
        ], Filter, new HashSet<Guid> { excludedId }, new HashSet<string> { "HIDDEN", "HIDDEN_FAC" });
        Assert.Equal(new[] { pending.StaffId, submitted.StaffId }, rows.Select(row => row.StaffId));
        Assert.Empty(DashboardSubmissionExportBuilder.ScopeEliStaff(rows, Filter with { TeamCode = "OTHER_TEAM" }, new HashSet<Guid>(), new HashSet<string>()));
        Assert.Equal(rows, DashboardSubmissionExportBuilder.ScopeEliStaff(rows, Filter with { FromDate = null, ToDate = null, Status = null, DimensionLabel = null, DeliveryAreaKey = null }, new HashSet<Guid>(), new HashSet<string>()));
    }

    [Fact]
    public void SubmitterEnrichmentUsesRecordIdentityAndNeverInfersActorFromOwnerOrSubject()
    {
        var first = Record("Actual submitter"); var second = Record(null);
        var sheet = new ExportSheet("Form entries", ["Record ID", "Dynamic question", "Created by"],
            [[second.Id.ToString(), "Second answer", "Original creator"], [first.Id.ToString(), "First answer", "Original creator"]], false);
        var enriched = DashboardSubmissionExportBuilder.AddSubmitters(sheet, [first, second]);
        Assert.Equal(sheet.Columns.Concat(["Submitted by"]), enriched.Columns);
        Assert.Equal(sheet.Rows[0], enriched.Rows[0].Take(3));
        Assert.Null(enriched.Rows[0][3]);
        Assert.Equal("Actual submitter", enriched.Rows[1][3]);
        Assert.Same(enriched, DashboardSubmissionExportBuilder.AddSubmitters(enriched, [first, second]));
        var details = DashboardSubmissionExportBuilder.RecordDetails([first, second]);
        Assert.Contains(details.Items[0].Fields, field => field.Label == "Submitted by" && field.Value == "Actual submitter");
        Assert.Contains(details.Items[1].Fields, field => field.Label == "Submitted by" && field.Value == "Not recorded");
    }

    [Fact]
    public void PdfAndWorkbookIncludeNamedCohortAndSubmitterWithoutDraftRecordReferences()
    {
        var pending = Staff("Pending Example", false) with { SubmittedAt = DateTimeOffset.Parse("2026-09-01T10:00:00Z"), AssessmentRecordId = Guid.NewGuid() };
        var submitted = Staff("Submitted Example", true);
        var section = DashboardSubmissionExportBuilder.EliStaffSection([pending, submitted]);
        var sheet = DashboardSubmissionExportBuilder.EliStaffSheet([pending, submitted], "2026/27");
        Assert.Null(sheet.Rows[0][7]); Assert.Null(sheet.Rows[0][8]);
        Assert.Equal("datetime", sheet.ColumnTypes![7]);
        var workbook = new ExportWorkbookData("elevate-practice", "Elevate Learning and Innovation", Filter, "Test reviewer", DateTimeOffset.UtcNow,
            [sheet], new DashboardReportData([], [section, DashboardSubmissionExportBuilder.RecordDetails([Record("Submission Actor")])]));
        var pdf = Encoding.ASCII.GetString(new QaPdfReportService().CreateDashboardReport(workbook).Content);
        Assert.Contains("Pending Example", pdf); Assert.Contains("Submitted Example", pdf); Assert.Contains("Not submitted", pdf);
        Assert.Contains("Submission Actor", pdf); Assert.DoesNotContain(pending.AssessmentRecordId!.Value.ToString(), pdf);
        Assert.Contains("Record date", pdf);
        using var document = SpreadsheetDocument.Open(new MemoryStream(new ExcelExportService().CreateWorkbook(workbook).Content), false);
        Assert.Empty(new OpenXmlValidator().Validate(document));
        var outputSheet = document.WorkbookPart!.Workbook.Sheets!.Elements<Sheet>().Single(item => item.Name == "ELI staff submissions");
        var output = ((WorksheetPart)document.WorkbookPart.GetPartById(outputSheet.Id!)).Worksheet;
        Assert.Contains("Pending Example", output.InnerText); Assert.Contains("Submitted Example", output.InnerText);
        Assert.Contains(DashboardSubmissionExportBuilder.EliScopeNote, output.InnerText);
        Assert.DoesNotContain(pending.AssessmentRecordId!.Value.ToString(), output.InnerText);
    }

    private static EliSubmissionStaffSummary Staff(string name, bool submitted) => new(Guid.NewGuid(), name, Guid.NewGuid(), "TEAM", "Team", "FAC", submitted,
        submitted ? DateTimeOffset.Parse("2026-09-08T12:00:00Z") : null, submitted ? Guid.NewGuid() : null);

    private static ProcessDashboardRecordSummary Record(string? submitter) => new(
        Id: Guid.NewGuid(), ProcessKey: "eli", Title: "Self assessment", Summary: null, RecordDate: new(2026, 9, 8), CreatedAt: DateTimeOffset.UtcNow,
        Status: "submitted", OrgUnitId: null, AreaCode: "TEAM", AreaName: "Team", ParentAreaCode: "FAC", OwnerDisplayName: "Owner is not submitter", SubjectDisplayName: "Subject is not submitter",
        Theme: null, Detail: null, ParticipantAreaBreakdown: null, ParticipantCount: 0, AttendanceCredits: 0, LearningMinutes: 0, SampleSize: 0,
        ScoreTotal: 0, ScoreCount: 0, BarrierCount: 0, ScoreMaximum: 5, SubmitterDisplayName: submitter);
}
