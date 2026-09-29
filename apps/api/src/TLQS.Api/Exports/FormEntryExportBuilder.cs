using System.Text.Json;
using TLQS.Api.V1;
using TLQS.Application.Workflows;

namespace TLQS.Api.Exports;

/// <summary>Builds entry rows by question identity, never by the order answers were selected.</summary>
public static class FormEntryExportBuilder
{
    /// <summary>Align identical faculty copies of Work Scrutiny without merging customised questions.</summary>
    public static ExportSheet AlignWorkScrutinyClones(ExportSheet source)
    {
        var keyIndex = Index(source, "Question key");
        var templateIndex = Index(source, "Form template");
        if (keyIndex < 0 || templateIndex < 0) return source;
        const string prefix = "work_scrutiny_quality_";
        var rows = source.Rows.Select(row =>
        {
            var template = Cell(row, templateIndex);
            var key = Cell(row, keyIndex);
            if (template is null || !template.StartsWith(prefix, StringComparison.Ordinal)
                || !Guid.TryParseExact(template[prefix.Length..], "D", out _)
                || key is null || !key.StartsWith(template + "/", StringComparison.Ordinal)) return row;
            // Include the saved definition, not the response: changed rubric options, wording or
            // lookup sources must never silently share a column with a different question.
            var definition = JsonSerializer.Serialize(new[] { "Section", "Question", "Response type", "Field configuration", "Options lookup" }
                .Select(column => Cell(row, Index(source, column))).ToArray());
            var signature = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(definition)));
            var copy = row.ToArray();
            copy[keyIndex] = $"work_scrutiny_quality/{key[(template.Length + 1)..]}/{signature}";
            return (IReadOnlyList<string?>)copy;
        }).ToArray();
        return source with { Rows = rows };
    }

    public static ExportSheet ExpandAnswers(ExportSheet source)
    {
        var rows = new List<IReadOnlyList<string?>>();
        var key = Index(source, "Question key");
        var label = Index(source, "Question");
        var response = Index(source, "Response");
        var type = Index(source, "Response type");
        foreach (var row in source.Rows)
        {
            var value = Cell(row, response);
            var copy = row.ToArray();
            if (value is null) { rows.Add(copy); continue; }
            try
            {
                using var json = JsonDocument.Parse(value);
                if (json.RootElement.ValueKind is not (JsonValueKind.Array or JsonValueKind.Object)) { rows.Add(copy); continue; }
                copy[response] = Describe(json.RootElement);
                rows.Add(copy);
                if (json.RootElement.ValueKind == JsonValueKind.Array)
                {
                    foreach (var item in json.RootElement.EnumerateArray())
                    {
                        if (item.ValueKind != JsonValueKind.Object) continue;
                        var id = Property(item, "focusId", "statementId", "pillarKey", "id", "key");
                        if (id is null) continue; // An unkeyed collection remains complete in its parent answer.
                        var title = Property(item, "focusName", "name", "label", "title") ?? id;
                        AddLeaves(item, $"{Cell(row, key)}/{Uri.EscapeDataString(id)}", $"{Cell(row, label)} - {title}", row);
                    }
                }
                else AddLeaves(json.RootElement, Cell(row, key)!, Cell(row, label)!, row);
            }
            catch (JsonException)
            {
                if (Cell(row, type) is "multi_select" or "checkbox_group") copy[response] = string.Join("\n", value.Split('|'));
                rows.Add(copy);
            }

            void AddLeaves(JsonElement element, string identity, string title, IReadOnlyList<string?> original)
            {
                foreach (var property in element.EnumerateObject())
                {
                    var child = original.ToArray();
                    child[key] = $"{identity}/{Uri.EscapeDataString(property.Name)}";
                    child[label] = $"{title} - {property.Name}";
                    child[response] = Describe(property.Value);
                    child[type] = property.Value.ValueKind == JsonValueKind.Number ? "number" : "text";
                    rows.Add(child);
                }
            }
        }
        return source with { Rows = rows };
    }

    public static ExportSheet Flatten(string name, ExportSheet primary, string parentKey, params ExportSheet[] children)
    {
        var parentIndex = Index(primary, parentKey);
        if (parentIndex < 0) return primary with { Name = name };
        if (primary.Rows.GroupBy(row => Cell(row, parentIndex)).Any(group => group.Count() > 1))
            throw new WorkflowValidationException("The export contains duplicate entry identifiers. No incomplete workbook was created.");
        var columns = primary.Columns.ToList();
        var types = primary.Columns.Select((_, index) => primary.ColumnTypes?.ElementAtOrDefault(index) ?? "text").ToList();
        var values = primary.Rows.Select(row => row.ToList()).ToArray();
        foreach (var child in children)
        {
            var childKey = Index(child, parentKey);
            if (childKey < 0 && parentKey == "Session ID") childKey = Index(child, "Reviewing session ID");
            if (childKey < 0) continue;
            var grouped = child.Rows.Where(row => Cell(row, childKey) is not null)
                .GroupBy(row => Cell(row, childKey)!, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(group => group.Key, group => group.ToArray(), StringComparer.OrdinalIgnoreCase);
            var questionKey = Index(child, "Question key");
            var answer = Index(child, "Response");
            var question = Index(child, "Question");
            if (questionKey >= 0 && answer >= 0)
            {
                foreach (var metadata in new[] { "Submission ID", "Form template", "Form version" })
                {
                    var metadataIndex = Index(child, metadata);
                    if (metadataIndex < 0 || columns.Contains(metadata)) continue;
                    columns.Add(metadata);
                    types.Add("text");
                    for (var index = 0; index < values.Length; index++)
                    {
                        var parent = Cell(primary.Rows[index], parentIndex);
                        var matches = parent is not null && grouped.TryGetValue(parent, out var found) ? found : [];
                        var saved = matches.Select(row => Cell(row, metadataIndex)).Where(value => value is not null).Distinct().ToArray();
                        values[index].Add(saved.Length == 0 ? null : string.Join("\n", saved));
                    }
                }
                var definitions = child.Rows.Where(row => Cell(row, questionKey) is not null)
                    .GroupBy(row => Cell(row, questionKey)!, StringComparer.Ordinal);
                foreach (var definition in definitions)
                {
                    var label = Cell(definition.First(), question) ?? definition.Key;
                    var section = Cell(definition.First(), Index(child, "Section"));
                    var heading = $"{(string.IsNullOrWhiteSpace(section) || label.StartsWith(section, StringComparison.OrdinalIgnoreCase) ? label : $"{section} - {label}")} [{definition.Key}]";
                    columns.Add(heading);
                    var fieldTypes = definition.Select(row => Cell(row, Index(child, "Response type"))).Distinct().ToArray();
                    types.Add(fieldTypes.Length == 1 && fieldTypes[0] is "number" or "date" ? fieldTypes[0]! : "text");
                    for (var index = 0; index < values.Length; index++)
                    {
                        var parent = Cell(primary.Rows[index], parentIndex);
                        var matches = parent is not null && grouped.TryGetValue(parent, out var found) ? found : [];
                        var answers = matches.Where(row => Cell(row, questionKey) == definition.Key).Select(row => Cell(row, answer)).Where(value => value is not null).Distinct().ToArray();
                        values[index].Add(answers.Length == 0 ? null : string.Join("\n", answers));
                        if (answers.Length > 1) types[^1] = "text";
                    }
                }
            }
            else
            {
                // Repeat collections horizontally; related sheets retain each item's permanent identifier.
                var count = grouped.Values.Select(items => items.Length).DefaultIfEmpty(1).Max();
                for (var item = 0; item < count; item++)
                for (var col = 0; col < child.Columns.Count; col++)
                {
                    if (col == childKey) continue;
                    columns.Add($"{child.Name}{(count > 1 ? $" {item + 1}" : "")} - {child.Columns[col]}");
                    types.Add(child.ColumnTypes?.ElementAtOrDefault(col) ?? "text");
                    for (var index = 0; index < values.Length; index++)
                    {
                        var parent = Cell(primary.Rows[index], parentIndex);
                        var matches = parent is not null && grouped.TryGetValue(parent, out var found) ? found : [];
                        values[index].Add(item < matches.Length ? Cell(matches[item], col) : null);
                    }
                }
            }
        }
        return new ExportSheet(name, columns, values, primary.WasTruncated || children.Any(child => child.WasTruncated), types);
    }

    public static ExportSheet Definitions(ExportSheet answers)
    {
        var key = Index(answers, "Question key");
        var label = Index(answers, "Question");
        var version = Index(answers, "Form version");
        var type = Index(answers, "Response type");
        return new ExportSheet("Field definitions", ["Question identity", "Saved question wording", "Form versions", "Response types"],
            answers.Rows.GroupBy(row => Cell(row, key)).OrderBy(group => group.Key, StringComparer.Ordinal)
                .Select(group => (IReadOnlyList<string?>)new[] { group.Key,
                    string.Join("\n", group.Select(row => Cell(row, label)).Distinct()),
                    string.Join("\n", group.Select(row => Cell(row, version)).Distinct()),
                    string.Join("\n", group.Select(row => Cell(row, type)).Distinct()) }).ToArray(), answers.WasTruncated);
    }

    private static string? Property(JsonElement item, params string[] keys) => keys.Select(key => item.TryGetProperty(key, out var value) ? value.ToString() : null).FirstOrDefault(value => !string.IsNullOrWhiteSpace(value));
    private static string Describe(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Array => string.Join("\n", element.EnumerateArray().Select(Describe)),
        JsonValueKind.Object => string.Join("; ", element.EnumerateObject().Select(property => $"{property.Name}: {Describe(property.Value)}")),
        JsonValueKind.Null => "",
        _ => element.ToString()
    };
    private static int Index(ExportSheet sheet, string name) => Array.FindIndex(sheet.Columns.ToArray(), column => column.Equals(name, StringComparison.OrdinalIgnoreCase));
    private static string? Cell(IReadOnlyList<string?> row, int index) => index >= 0 && index < row.Count ? row[index] : null;
}
