using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed record AdminCsvRow(int Number, IReadOnlyDictionary<string, string> Values);
public sealed record AdminCsvTable(IReadOnlyList<string> Headers, IReadOnlyList<AdminCsvRow> Rows);
internal sealed record AdminCsvLedgerEntry(string Reference, string PayloadHash, Guid EntityId);
internal sealed record AdminCsvPlannedChange(string Reference, string PayloadHash, int FirstRowNumber,
    Func<SqlConnection, SqlTransaction, CurrentUser, CancellationToken, Task<Guid>> Apply);
internal sealed record AdminCsvImportPlan(string Kind, IReadOnlyList<AdminCsvPreviewRow> Rows,
    IReadOnlyList<AdminCsvIssue> Issues, IReadOnlyList<AdminCsvPlannedChange> Changes, string ContextFingerprint = "");

public static class AdminCsvAccess
{
    public static bool CanUse(CurrentUser user, string kind) => user.UserAccountId.HasValue && user.IsAdministrator && (kind switch
    {
        "qa-questions" => user.HasPermission(PermissionKeys.QaReviewsManage),
        "cpd-events" => user.HasPermission(PermissionKeys.CpdManage) || user.HasPermission(PermissionKeys.CpdMandatoryLog),
        "managed-list-values" => user.HasPermission(PermissionKeys.ListsManage),
        _ => false
    });
}

public static class AdminCsvReader
{
    public const int MaximumBytes = 1024 * 1024;
    public const int MaximumRows = 1000;
    public static string Get(AdminCsvRow row, string column) => row.Values.TryGetValue(column, out var value) ? value.Trim() : "";
    public static string Hash(string value) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    public static string CanonicalHash(object value) => Hash(JsonSerializer.Serialize(value));

    public static IReadOnlyList<AdminCsvIssue> ValidateHeaders(AdminCsvTable table, string[] required, string[] optional)
    {
        var issues = new List<AdminCsvIssue>();
        var allowed = required.Concat(optional).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var name in required.Where(name => !table.Headers.Contains(name, StringComparer.OrdinalIgnoreCase)))
            issues.Add(new(1, name, $"The required column '{name}' is missing."));
        foreach (var name in table.Headers.Where(name => !allowed.Contains(name)))
            issues.Add(new(1, name, $"Unknown column '{name}'. Use the downloaded template."));
        return issues;
    }

    public static AdminCsvTable Parse(string? csv)
    {
        if (string.IsNullOrWhiteSpace(csv)) throw new WorkflowValidationException("Choose a CSV file containing a header and at least one data row.");
        if (Encoding.UTF8.GetByteCount(csv) > MaximumBytes) throw new WorkflowValidationException("CSV files must be no larger than 1 MiB.");
        if (csv.Contains('\0') || csv.Contains('\uFFFD')) throw new WorkflowValidationException("Save the file as UTF-8 CSV. Binary or unreadable characters were found.");
        csv = csv.TrimStart('\uFEFF');
        var records = new List<string[]>();
        var recordNumbers = new List<int>();
        var recordNumber = 1;
        var cells = new List<string>();
        var cell = new StringBuilder();
        var quoted = false;
        var closed = false;
        var atStart = true;
        void EndCell() { cells.Add(cell.ToString()); cell.Clear(); closed = false; atStart = true; }
        void EndRow()
        {
            EndCell();
            if (cells.Any(value => !string.IsNullOrWhiteSpace(value))) { records.Add(cells.ToArray()); recordNumbers.Add(recordNumber); }
            recordNumber++;
            cells.Clear();
            if (records.Count > MaximumRows + 1) throw new WorkflowValidationException($"Import at most {MaximumRows} data rows at a time.");
        }
        for (var index = 0; index < csv.Length; index++)
        {
            var character = csv[index];
            if (quoted)
            {
                if (character != '"') { cell.Append(character); continue; }
                if (index + 1 < csv.Length && csv[index + 1] == '"') { cell.Append('"'); index++; continue; }
                quoted = false; closed = true; continue;
            }
            if (character == ',') { EndCell(); continue; }
            if (character is '\r' or '\n')
            {
                if (character == '\r' && index + 1 < csv.Length && csv[index + 1] == '\n') index++;
                EndRow(); continue;
            }
            if (closed) throw new WorkflowValidationException($"Unexpected text after a closing quote near CSV row {records.Count + 1}.");
            if (character == '"')
            {
                if (!atStart) throw new WorkflowValidationException($"A quote must start a quoted field near CSV row {records.Count + 1}.");
                quoted = true; atStart = false; continue;
            }
            cell.Append(character); atStart = false;
        }
        if (quoted) throw new WorkflowValidationException("The CSV contains an unclosed quoted field.");
        if (cell.Length > 0 || cells.Count > 0 || closed) EndRow();
        if (records.Count < 2) throw new WorkflowValidationException("The CSV must contain a header and at least one data row.");
        var headers = records[0].Select(value => value.Trim()).ToArray();
        if (headers.Length > 40 || headers.Any(string.IsNullOrWhiteSpace) || headers.Distinct(StringComparer.OrdinalIgnoreCase).Count() != headers.Length)
            throw new WorkflowValidationException("CSV headers must be present, unique and limited to 40 columns.");
        var rows = new List<AdminCsvRow>();
        for (var index = 1; index < records.Count; index++)
        {
            if (records[index].Length != headers.Length) throw new WorkflowValidationException($"CSV row {recordNumbers[index]} has {records[index].Length} columns; the header has {headers.Length}.");
            rows.Add(new(recordNumbers[index], headers.Select((header, position) => (header, records[index][position]))
                .ToDictionary(pair => pair.header, pair => pair.Item2, StringComparer.OrdinalIgnoreCase)));
        }
        return new(headers, rows);
    }
}
