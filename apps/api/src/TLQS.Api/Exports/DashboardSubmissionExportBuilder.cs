using System.Globalization;
using TLQS.Api.Data;
using TLQS.Api.V1;

namespace TLQS.Api.Exports;

public static class DashboardSubmissionExportBuilder
{
    public const string EliScopeNote = "Uses academic year, organisation and dashboard faculty exclusions. Record date, status, theme and delivery-area filters do not change this staff cohort. Not submitted includes staff with no submitted assessment; draft content is excluded.";

    public static EliSubmissionStaffSummary[] ScopeEliStaff(IReadOnlyList<EliSubmissionStaffSummary> rows, ExportFilter filter,
        IReadOnlySet<Guid> excludedIds, IReadOnlySet<string> excludedCodes) => rows
        .Where(row => !excludedIds.Contains(row.OrgUnitId ?? Guid.Empty)
            && !excludedCodes.Contains(row.AreaCode ?? "") && !excludedCodes.Contains(row.ParentAreaCode ?? "")
            && DashboardExportScope.Organisation(row.AreaCode, row.ParentAreaCode, filter))
        .OrderBy(row => row.HasSubmitted).ThenBy(row => row.StaffName).ThenBy(row => row.StaffId).ToArray();

    public static DashboardReportSection EliStaffSection(IReadOnlyList<EliSubmissionStaffSummary> rows) => new(
        "ELI submission by staff member", EliScopeNote, rows.Select(row => new DashboardReportItem(row.StaffName,
            [new("Submission status", row.HasSubmitted ? "Submitted" : "Not submitted"), new("Area", row.AreaName ?? row.AreaCode ?? "Unassigned"),
             new("Submitted at", row.HasSubmitted ? row.SubmittedAt?.ToString("dd MMM yyyy HH:mm", CultureInfo.InvariantCulture) : null),
             new("Assessment record ID", row.HasSubmitted ? row.AssessmentRecordId?.ToString() : null)])).ToArray());

    public static ExportSheet EliStaffSheet(IReadOnlyList<EliSubmissionStaffSummary> rows, string academicYear) => new(
        "ELI staff submissions", ["Staff ID", "Staff member", "Academic year", "Faculty code", "Area code", "Area", "Submission status", "Submitted at", "Assessment record ID", "Cohort scope"],
        rows.Select(row => (IReadOnlyList<string?>)new string?[] { row.StaffId.ToString(), row.StaffName, academicYear, row.ParentAreaCode,
            row.AreaCode, row.AreaName, row.HasSubmitted ? "Submitted" : "Not submitted",
            row.HasSubmitted ? row.SubmittedAt?.ToString("O", CultureInfo.InvariantCulture) : null,
            row.HasSubmitted ? row.AssessmentRecordId?.ToString() : null, EliScopeNote }).ToArray(), false,
        ["text", "text", "text", "text", "text", "text", "text", "datetime", "text", "text"]);

    public static DashboardReportSection RecordDetails(IReadOnlyList<ProcessDashboardRecordSummary> rows) => new(
        "Record details", "Every record in the selected dashboard scope. Submitted by identifies the recorded submission actor; an unavailable historic actor is shown as not recorded.",
        rows.Select(row => new DashboardReportItem(row.Title,
            [new("Record ID", row.Id.ToString()), new("Process", row.ProcessKey), new("Staff member", row.SubjectDisplayName),
             new("Submitted by", string.IsNullOrWhiteSpace(row.SubmitterDisplayName) ? "Not recorded" : row.SubmitterDisplayName),
             new("Owner", row.OwnerDisplayName), new("Area", row.AreaName ?? row.AreaCode), new("Status", row.Status),
             new("Record date", row.RecordDate?.ToString("dd MMM yyyy", CultureInfo.InvariantCulture)),
             new("Delivery area", row.DeliveryAreaName), new("Themes", row.Theme?.Replace("|", "; ")),
             new("Summary", row.Summary), new("Detail", row.Detail)])).ToArray());

    // Enrich the existing entry rows by stable record identity without reordering or removing form columns.
    public static ExportSheet AddSubmitters(ExportSheet sheet, IReadOnlyList<ProcessDashboardRecordSummary> records)
    {
        var key = sheet.Columns.ToList().FindIndex(column => column == "Record ID");
        if (key < 0 || sheet.Columns.Contains("Submitted by")) return sheet;
        var actors = records.GroupBy(row => row.Id).ToDictionary(group => group.Key, group => group.First().SubmitterDisplayName);
        return sheet with {
            Columns = sheet.Columns.Concat(["Submitted by"]).ToArray(),
            Rows = sheet.Rows.Select(row => (IReadOnlyList<string?>)row.Concat(new[] {
                Guid.TryParse(row.ElementAtOrDefault(key), out var id) && actors.TryGetValue(id, out var actor) ? actor : null }).ToArray()).ToArray(),
            ColumnTypes = sheet.Columns.Select((_, index) => sheet.ColumnTypes?.ElementAtOrDefault(index) ?? "text").Concat(["text"]).ToArray()
        };
    }
}
