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
    string? RecordType,
    string? DeliveryAreaKey = null,
    string? DimensionLabel = null)
{
    [System.Text.Json.Serialization.JsonIgnore]
    public IReadOnlyList<Guid>? DashboardRecordIds { get; init; }
    [System.Text.Json.Serialization.JsonIgnore]
    public IReadOnlyList<Guid>? DashboardActionIds { get; init; }
    [System.Text.Json.Serialization.JsonIgnore]
    public string? DashboardProcessKey { get; init; }
}

public sealed record ExportSheet(string Name, IReadOnlyList<string> Columns, IReadOnlyList<IReadOnlyList<string?>> Rows, bool WasTruncated,
    IReadOnlyList<string>? ColumnTypes = null);

public sealed record ExportWorkbookData(
    string ModuleKey,
    string DisplayName,
    ExportFilter Filter,
    string GeneratedBy,
    DateTimeOffset GeneratedAt,
    IReadOnlyList<ExportSheet> Sheets,
    DashboardReportData? Dashboard = null);

public sealed record DashboardReportData(IReadOnlyList<DashboardReportMetric> Metrics, IReadOnlyList<DashboardReportSection> Sections);
public sealed record DashboardReportMetric(string Label, string Value);
public sealed record DashboardReportSection(string Title, string? Description, IReadOnlyList<DashboardReportItem> Items);
public sealed record DashboardReportItem(string Title, IReadOnlyList<RecordReportField> Fields, IReadOnlyList<DashboardReportDistribution>? Distribution = null);
public sealed record DashboardReportDistribution(string Label, decimal Value);

public sealed record RecordReportData(
    Guid RecordId,
    string Title,
    string RecordType,
    string Status,
    string? StaffName,
    string? ReviewerName,
    string? Organisation,
    string? AcademicYear,
    DateOnly? RecordDate,
    DateTimeOffset CreatedAt,
    string CreatedBy,
    IReadOnlyList<RecordReportSection> Sections,
    IReadOnlyList<RecordReportAction> Actions);

public sealed record RecordReportSection(string Title, IReadOnlyList<RecordReportField> Fields);
public sealed record RecordReportField(string Label, string? Value);
public sealed record RecordReportAction(
    string Action,
    string? Detail,
    string? Owner,
    DateOnly? DueDate,
    string Status,
    DateOnly? CompletedDate,
    string? CompletionNote,
    int? LivCycleNumber);
