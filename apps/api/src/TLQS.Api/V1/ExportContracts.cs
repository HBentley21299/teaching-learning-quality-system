namespace TLQS.Api.V1;

public sealed record ExportFilter(
    string? AcademicYear,
    string? FacultyCode,
    string? TeamCode,
    DateOnly? FromDate,
    DateOnly? ToDate,
    Guid? StaffId,
    Guid? ReviewerId,
    string? Status,
    string? RecordType);

public sealed record ExportSheet(string Name, IReadOnlyList<string> Columns, IReadOnlyList<IReadOnlyList<string?>> Rows, bool WasTruncated);

public sealed record ExportWorkbookData(
    string ModuleKey,
    string DisplayName,
    ExportFilter Filter,
    string GeneratedBy,
    DateTimeOffset GeneratedAt,
    IReadOnlyList<ExportSheet> Sheets);

public sealed record RecordReportData(
    Guid RecordId,
    string Title,
    string RecordType,
    string Status,
    string? StaffName,
    string? ReviewerName,
    string? Organisation,
    DateOnly? RecordDate,
    DateTimeOffset CreatedAt,
    string CreatedBy,
    IReadOnlyList<RecordReportSection> Sections,
    IReadOnlyList<RecordReportAction> Actions);

public sealed record RecordReportSection(string Title, IReadOnlyList<RecordReportField> Fields);
public sealed record RecordReportField(string Label, string? Value);
public sealed record RecordReportAction(string Action, string? Owner, DateOnly? DueDate, string Status);
