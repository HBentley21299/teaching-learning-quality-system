namespace TLQS.Api.V1;

public sealed record AdminCsvImportRequest(string Csv, string? PreviewToken = null);
public sealed record AdminCsvIssue(int RowNumber, string Column, string Message, string Severity = "error");
public sealed record AdminCsvPreviewRow(int RowNumber, string Reference, string Operation, IReadOnlyDictionary<string, string?> Values);
public sealed record AdminCsvImportPreview(string Kind, int RowsRead, int CreateCount, int SkipCount,
    IReadOnlyList<AdminCsvPreviewRow> Rows, IReadOnlyList<AdminCsvIssue> Issues, bool CanImport, string? PreviewToken);
public sealed record AdminCsvImportResult(Guid BatchId, int CreatedCount, int SkippedCount, string Message);
public sealed record AdminCsvColumn(string Key, string Label, bool Required, string Description, string Example);
public sealed record AdminCsvReference(string Label, IReadOnlyList<string> Columns, IReadOnlyList<IReadOnlyList<string>> Rows);
public sealed record AdminCsvImportDefinition(string Kind, string Title, string Description,
    IReadOnlyList<AdminCsvColumn> Columns, IReadOnlyList<string> Notes, IReadOnlyList<AdminCsvReference> References);
