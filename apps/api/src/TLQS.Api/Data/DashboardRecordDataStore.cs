using System.Security.Cryptography;
using System.Text;
using TLQS.Api.Exports;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    public async Task<DashboardRecordDataSummary> GetDashboardRecordDataAsync(string dashboardKey, string moduleKey,
        ExportFilter filter, CurrentUser currentUser, CancellationToken cancellationToken)
    {
        // Use the same record scope, field projection and LIV section visibility as Excel. This is
        // loaded on demand, separately from aggregate dashboard requests and their smaller payloads.
        var workbook = await GetDashboardExportAsync(moduleKey, filter, currentUser, cancellationToken, includeDashboardSummary: false);
        return DashboardRecordDataBuilder.Build(dashboardKey, workbook);
    }
}

public static class DashboardRecordDataBuilder
{
    private static readonly IReadOnlyDictionary<string, string> Modules = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        ["overview"] = "dashboard-overview", ["learning_walk"] = "learning-walks", ["als_learning_walk"] = "als-learning-walks",
        ["liv"] = "liv", ["als_liv"] = "als-liv", ["eli"] = "elevate-practice", ["probation_case"] = "probation",
        ["elevate_environment"] = "elevate-environments", ["coaching_session"] = "coaching", ["work_scrutiny"] = "work-scrutiny",
        ["cpd_event"] = "cpd", ["actions"] = "actions", ["uco_tla_review"] = "uco-tla-reviews"
    };

    public static bool TryGetModule(string dashboardKey, out string? moduleKey) => Modules.TryGetValue(dashboardKey.Trim(), out moduleKey);

    public static bool CanRead(CurrentUser user, string dashboardKey)
    {
        if (!TryGetModule(dashboardKey, out var module)) return false;
        // Match the existing UCO export restriction, independently of broad reporting grants.
        if (module == "uco-tla-reviews") return UcoTlaReviewAccessPolicy.CanManageAll(user);
        if (user.HasPermission(PermissionKeys.ReportsViewAll)) return true;
        if (!user.HasPermission(PermissionKeys.ReportsViewScoped)) return false;
        return dashboardKey.Trim().ToLowerInvariant() switch
        {
            "learning_walk" => user.HasPermission(PermissionKeys.LearningWalkSubmit),
            "als_learning_walk" => user.HasPermission(PermissionKeys.AlsLearningWalkSubmit),
            "liv" => user.HasPermission(PermissionKeys.LivSubmit) || user.HasPermission(PermissionKeys.LivManage),
            "als_liv" => user.HasPermission(PermissionKeys.AlsLivSubmit) || user.HasPermission(PermissionKeys.AlsLivManage),
            _ => true
        };
    }

    public static DashboardRecordDataSummary Build(string dashboardKey, ExportWorkbookData source)
    {
        if (source.Sheets.Count == 0) return new(dashboardKey, [], [], false, source.GeneratedAt);
        var primary = source.Sheets[0];
        var identityColumn = dashboardKey.Trim().Equals("actions", StringComparison.OrdinalIgnoreCase) ? "Action ID" : "Record ID";
        var recordIndex = primary.Columns.ToList().FindIndex(column => column.Equals(identityColumn, StringComparison.OrdinalIgnoreCase));
        var projected = BusinessWorkbookExportBuilder.Build(source);
        var safe = projected.Sheets[0];
        var columns = Columns(safe);
        var rows = new List<DashboardRecordDataRow>();
        var recordsByReference = new Dictionary<string, Guid>(StringComparer.OrdinalIgnoreCase);
        for (var index = 0; index < primary.Rows.Count; index++)
        {
            if (recordIndex < 0 || recordIndex >= primary.Rows[index].Count || !Guid.TryParse(primary.Rows[index][recordIndex], out var recordId)) continue;
            rows.Add(Row(recordId, safe.Rows[index], columns));
            recordsByReference[$"Entry {index + 1:0000}"] = recordId;
        }
        var relatedTables = new List<DashboardRecordDataTable>();
        foreach (var safeDetail in projected.Sheets.Skip(1))
        {
            var detailColumns = Columns(safeDetail);
            var detailRows = new List<DashboardRecordDataRow>();
            var referenceIndex = safeDetail.Columns.ToList().IndexOf("Entry reference");
            if (referenceIndex < 0) continue; // Staff cohorts have their own denominator, rather than a form-record relationship.
            foreach (var row in safeDetail.Rows)
            {
                if (row.ElementAtOrDefault(referenceIndex) is { } reference && recordsByReference.TryGetValue(reference, out var recordId))
                    detailRows.Add(Row(recordId, row, detailColumns));
            }
            if (detailRows.Count > 0) relatedTables.Add(new(ColumnKey(safeDetail.Name), safeDetail.Name, detailColumns, detailRows));
        }
        return new(dashboardKey, columns, rows, source.Sheets.Any(sheet => sheet.WasTruncated), source.GeneratedAt, relatedTables);
    }

    private static IReadOnlyList<DashboardRecordDataColumn> Columns(ExportSheet sheet)
    {
        var labels = ExcelExportService.ReadableHeadings(sheet.Columns);
        return sheet.Columns.Select((heading, index) => new DashboardRecordDataColumn(
            ColumnKey(heading), labels[index], Section(labels[index]), sheet.ColumnTypes?.ElementAtOrDefault(index) ?? "text")).ToArray();
    }

    private static DashboardRecordDataRow Row(Guid recordId, IReadOnlyList<string?> source, IReadOnlyList<DashboardRecordDataColumn> columns) =>
        new(recordId, columns.Select((column, cell) => (column.Key, Value: source.ElementAtOrDefault(cell)))
            .ToDictionary(value => value.Key, value => value.Value, StringComparer.Ordinal));

    private static string ColumnKey(string heading) => "field_" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(heading))).ToLowerInvariant();
    private static string Section(string heading)
    {
        var separator = heading.IndexOf(" - ", StringComparison.Ordinal);
        return separator > 0 ? heading[..separator] : "Record";
    }
}
