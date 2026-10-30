using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Security;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    private async Task<AdminCsvImportPlan> BuildManagedListCsvPlanAsync(AdminCsvTable table, CurrentUser user,
        SqlConnection connection, SqlTransaction? transaction, IReadOnlyDictionary<string, AdminCsvLedgerEntry> ledger, CancellationToken token)
    {
        RequireCsvAdministrator(user, "managed-list-values");
        var lists = new List<ManagedCsvList>();
        await using (var command = new SqlCommand("""
            SELECT type.id,type.lookup_key,type.name
            FROM core.admin_managed_lists managed
            JOIN core.lookup_types type ON type.id=managed.lookup_type_id
            WHERE managed.is_active=1 AND type.is_active=1 AND type.archived_at IS NULL
            ORDER BY type.lookup_key;
            """, connection, transaction))
        await using (var reader = await command.ExecuteReaderAsync(token))
            while (await reader.ReadAsync(token)) lists.Add(new(reader.GetGuid(0), reader.GetString(1), reader.GetString(2)));
        var values = new List<ManagedCsvValue>();
        await using (var command = new SqlCommand("""
            SELECT value.id,value.lookup_type_id,value.value_key,value.display_name,value.display_order,
                   CONVERT(bit,CASE WHEN value.is_active=1 AND value.archived_at IS NULL THEN 1 ELSE 0 END)
            FROM core.lookup_values value
            JOIN core.admin_managed_lists managed ON managed.lookup_type_id=value.lookup_type_id
            ORDER BY value.lookup_type_id,value.id;
            """, connection, transaction))
        await using (var reader = await command.ExecuteReaderAsync(token))
            while (await reader.ReadAsync(token)) values.Add(new(reader.GetGuid(0), reader.GetGuid(1), reader.GetString(2), reader.GetString(3), reader.GetInt32(4), reader.GetBoolean(5)));
        var validation = ManagedListCsvPlanner.Validate(table, lists, values, ledger.ToDictionary(item => item.Key,
            item => item.Value.PayloadHash, StringComparer.OrdinalIgnoreCase));
        var changes = validation.Candidates.Select(candidate => new AdminCsvPlannedChange(candidate.Reference, candidate.PayloadHash, candidate.RowNumber,
            async (db, tx, actor, ct) =>
            {
                var id = Guid.NewGuid();
                await using var command = new SqlCommand("INSERT INTO core.lookup_values(id,lookup_type_id,value_key,display_name,display_order) VALUES(@id,@type,@key,@name,@order);", db, tx);
                command.Parameters.AddWithValue("@id", id);
                command.Parameters.AddWithValue("@type", candidate.ListId);
                command.Parameters.AddWithValue("@key", candidate.ValueKey);
                command.Parameters.AddWithValue("@name", candidate.DisplayName);
                command.Parameters.AddWithValue("@order", candidate.DisplayOrder);
                await command.ExecuteNonQueryAsync(ct);
                await WriteAuditAsync(db, tx, actor.UserAccountId, null, "lookup_value", id, "lookup.csv_value_added",
                    $"{actor.DisplayName} imported '{candidate.DisplayName}' in {candidate.LookupKey}.", null, JsonSerializer.Serialize(candidate), ct);
                return id;
            })).ToArray();
        return new("managed-list-values", validation.Rows, validation.Issues, changes, AdminCsvReader.CanonicalHash(new { lists, values }));
    }
}

public sealed record ManagedCsvList(Guid Id, string Key, string Name);
public sealed record ManagedCsvValue(Guid Id, Guid ListId, string Key, string Name, int Order, bool Active);
public sealed record ManagedCsvCandidate(int RowNumber, string Reference, string PayloadHash, Guid ListId,
    string LookupKey, string ValueKey, string DisplayName, int DisplayOrder);
public sealed record ManagedCsvValidation(IReadOnlyList<AdminCsvPreviewRow> Rows, IReadOnlyList<AdminCsvIssue> Issues,
    IReadOnlyList<ManagedCsvCandidate> Candidates);

public static class ManagedListCsvPlanner
{
    public static string ValueKey(AdminCsvRow row)
    {
        var requested = AdminCsvReader.Get(row, "value_key").ToLowerInvariant();
        return requested.Length > 0 ? requested : Regex.Replace(AdminCsvReader.Get(row, "display_name").ToLowerInvariant(), "[^a-z0-9]+", "_").Trim('_');
    }
    public static ManagedCsvValidation Validate(AdminCsvTable table, IReadOnlyList<ManagedCsvList> lists,
        IReadOnlyList<ManagedCsvValue> values, IReadOnlyDictionary<string, string> imported)
    {
        var issues = AdminCsvReader.ValidateHeaders(table, ["lookup_key", "display_name"], ["value_key", "display_order"]).ToList();
        var rows = new List<AdminCsvPreviewRow>();
        var candidates = new List<ManagedCsvCandidate>();
        if (issues.Count > 0) return new(rows, issues, candidates);
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var seenNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var nextOrders = lists.ToDictionary(list => list.Id, list => values.Where(value => value.ListId == list.Id).Select(value => value.Order).DefaultIfEmpty(0).Max());
        foreach (var row in table.Rows)
        {
            var before = issues.Count;
            var lookupKey = AdminCsvReader.Get(row, "lookup_key").ToLowerInvariant();
            var name = AdminCsvReader.Get(row, "display_name");
            var key = ValueKey(row);
            var reference = $"{lookupKey}:{key}";
            var orderText = AdminCsvReader.Get(row, "display_order");
            int? requestedOrder = null;
            if (orderText.Length > 0)
            {
                if (!int.TryParse(orderText, NumberStyles.None, CultureInfo.InvariantCulture, out var order) || order > int.MaxValue - 10000)
                    issues.Add(new(row.Number, "display_order", "Use a non-negative whole number below 2,147,473,647."));
                else requestedOrder = order;
            }
            var list = lists.FirstOrDefault(item => item.Key.Equals(lookupKey, StringComparison.OrdinalIgnoreCase));
            if (list is null) issues.Add(new(row.Number, "lookup_key", "Choose an active, registered editable list from the reference values."));
            if (name.Length is < 1 or > 200) issues.Add(new(row.Number, "display_name", "Choice wording must contain 1–200 characters."));
            if (key.Length is < 1 or > 100 || !Regex.IsMatch(key, "^[a-z0-9_]+$")) issues.Add(new(row.Number, "value_key", "Use 1–100 lowercase letters, numbers or underscores; provide a key if wording cannot generate one."));
            if (reference.Length > 200) issues.Add(new(row.Number, "lookup_key", "The combined list and choice key must be at most 200 characters."));
            if (!seen.Add(reference)) issues.Add(new(row.Number, "value_key", "This list and choice key appears more than once in the file."));
            if (!seenNames.Add($"{lookupKey}:{name}")) issues.Add(new(row.Number, "display_name", "This wording appears more than once for the same list."));
            var hash = AdminCsvReader.CanonicalHash(new { lookupKey, key, name, requestedOrder });
            var operation = "create";
            if (imported.TryGetValue(reference, out var previousHash))
            {
                if (previousHash == hash) operation = "skip";
                else issues.Add(new(row.Number, "value_key", "This reference was already imported with different content. Use the existing list editor to amend it."));
            }
            else if (list is not null)
            {
                var matchingKey = values.FirstOrDefault(value => value.ListId == list.Id && value.Key.Equals(key, StringComparison.OrdinalIgnoreCase));
                if (matchingKey is not null)
                {
                    if (matchingKey.Active && matchingKey.Name == name && (!requestedOrder.HasValue || requestedOrder == matchingKey.Order)) operation = "skip";
                    else issues.Add(new(row.Number, "value_key", "This choice key already exists with different wording, order or availability. Use the list editor."));
                }
                else if (values.Any(value => value.ListId == list.Id && value.Name.Equals(name, StringComparison.OrdinalIgnoreCase)))
                    issues.Add(new(row.Number, "display_name", "This wording already exists under another choice key. Use the list editor."));
            }
            if (issues.Count > before) operation = "error";
            var orderToUse = requestedOrder ?? (list is null ? 10 : nextOrders[list.Id] <= int.MaxValue - 10 ? nextOrders[list.Id] + 10 : 0);
            if (operation == "create" && list is not null)
            {
                if (orderToUse == 0 && !requestedOrder.HasValue)
                { issues.Add(new(row.Number, "display_order", "The list order is full. Set a valid display order explicitly.")); operation = "error"; }
                else
                {
                    nextOrders[list.Id] = Math.Max(nextOrders[list.Id], orderToUse);
                    candidates.Add(new(row.Number, reference, hash, list.Id, lookupKey, key, name, orderToUse));
                }
            }
            rows.Add(new(row.Number, reference, operation, new Dictionary<string, string?>
            { ["lookup_key"] = lookupKey, ["value_key"] = key, ["display_name"] = name, ["display_order"] = operation == "skip" && !requestedOrder.HasValue ? "Existing order retained" : orderToUse.ToString(CultureInfo.InvariantCulture) }));
        }
        return new(rows, issues, candidates);
    }
}
