using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using TLQS.Api.V1;

namespace TLQS.Api.Exports;

/// <summary>
/// The business-facing projection shared by Excel and the dashboard register. Source identifiers
/// remain available to the scoped data builders, but never become reporting columns or JSON dumps.
/// </summary>
public static class BusinessWorkbookExportBuilder
{
    private static readonly HashSet<string> InternalColumns = new(StringComparer.OrdinalIgnoreCase)
    {
        "Record ID", "Staff ID", "Action ID", "Submission ID", "Assessment ID", "Framework ID", "Area ID",
        "Statement ID", "LIV case ID", "Probation case ID", "Observation ID", "Linked LIV case ID", "Visit ID",
        "Session ID", "Reviewing session ID", "Cycle ID", "Review ID", "Revised action ID", "Parent action ID",
        "Central action ID", "CPD event ID", "Award ID", "Membership ID", "Org unit ID", "Source record ID", "Assessment record ID", "Linked UCO record ID",
        "Subject staff ID", "Owner staff ID", "Question key", "Question identity", "Field configuration", "Options lookup",
        "Row version", "Rowversion", "Concurrency token", "Visibility", "Record visibility", "Visibility status", "Visibility setting",
        "Visible to staff", "Can view", "Can edit", "Can remove", "Framework key", "Area key", "Statement key",
        "Visit or stage", "Observation or stage", "Cohort scope"
    };

    private static readonly HashSet<string> LinkColumns = new(StringComparer.OrdinalIgnoreCase)
    { "Record ID", "Staff ID", "Action ID", "Assessment ID", "LIV case ID", "Probation case ID", "Observation ID", "Linked LIV case ID", "Linked UCO record ID", "Cycle ID", "Visit ID", "Session ID", "Reviewing session ID", "CPD event ID", "Reflection ID" };

    private static readonly HashSet<string> TechnicalJsonProperties = new(StringComparer.OrdinalIgnoreCase)
    { "id", "key", "focusId", "statementId", "descriptorId", "areaId", "fieldId", "fieldKey", "lookupValueId", "questionId", "themeId", "themeKey", "recordId", "sourceRecordId", "staffId", "rowVersion", "row_version", "visibleToStaff", "visible_to_staff", "visibility", "visibilityStatus", "visibility_status", "visibilitySetting", "visibility_setting", "canEdit", "canView", "canRemove" };

    public static bool IsInternalStructuredProperty(string property) => TechnicalJsonProperties.Contains(property);

    public static ExportWorkbookData Build(ExportWorkbookData source)
    {
        if (source.Sheets.Count == 0) return source;
        if (source.Sheets.Any(sheet => sheet.Rows.Any(row => row.Count > sheet.Columns.Count)))
            throw new TLQS.Application.Workflows.WorkflowValidationException("The export contains answers without matching column headings.");
        if (source.ModuleKey == "qa-review-report" && source.Sheets[0].Name == "Form entries")
            source = AddQaReviewContext(source);
        var primary = source.Sheets[0];
        // Export-local references distinguish two entries by the same person without exposing database IDs.
        var references = BuildReferences(primary, source.Sheets);
        var selected = source.Sheets.Where((sheet, index) => index == 0 || KeepDetail(sheet.SourceModuleKey ?? source.ModuleKey, sheet.SourceSheetName ?? sheet.Name)).ToArray();
        var projected = selected.Select((sheet, index) => ProjectSheet(sheet, references, index == 0)).ToArray();
        return source with { Sheets = projected };
    }

    /// <summary>Preserves row order, so callers can join the safe values to their already-authorised record identities.</summary>
    public static ExportSheet ProjectEntries(ExportWorkbookData source) => Build(source).Sheets[0];

    private static ExportWorkbookData AddQaReviewContext(ExportWorkbookData source)
    {
        var context = source.Sheets.FirstOrDefault(sheet => sheet.Name == "Review Summary");
        if (context is null) return source;
        var values = context.Rows.Where(row => row.Count >= 2 && row[0] is not null).ToDictionary(row => row[0]!,row => row[1],StringComparer.OrdinalIgnoreCase);
        var fields = new[] { (Key:"Title",Label:"Review title"), (Key:"Theme",Label:"Review theme"), (Key:"Academic year",Label:"Academic year"), (Key:"Owner",Label:"Review owner") };
        var primary = source.Sheets[0];
        var add = fields.Where(field => !primary.Columns.Contains(field.Label)).ToArray();
        primary = primary with { Columns=primary.Columns.Concat(add.Select(field => field.Label)).ToArray(),
            Rows=primary.Rows.Select(row => (IReadOnlyList<string?>)row.Concat(add.Select(field => values.GetValueOrDefault(field.Key))).ToArray()).ToArray(),
            ColumnTypes=primary.Columns.Select((_,index) => primary.ColumnTypes?.ElementAtOrDefault(index) ?? "text").Concat(add.Select(_ => "text")).ToArray() };
        return source with { Sheets=new[] {primary}.Concat(source.Sheets.Skip(1)).ToArray() };
    }

    public static string? DisplayValue(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return value;
        var trimmed = value.TrimStart();
        if (trimmed[0] is not ('[' or '{')) return value;
        try
        {
            using var json = JsonDocument.Parse(value);
            return Describe(json.RootElement);
        }
        catch (JsonException) { return value; }
    }

    private static bool KeepDetail(string module, string name)
    {
        if (name=="Form entries") return true;
        // These repeat source/definition or aggregate implementation data already represented by
        // the form columns and dashboard. They are deliberately absent from ordinary reporting.
        if (name.Contains("Form Answers", StringComparison.OrdinalIgnoreCase)
            || name.Contains("Field definitions", StringComparison.OrdinalIgnoreCase)
            || name.StartsWith("Dashboard ", StringComparison.OrdinalIgnoreCase)
            || name is "Staff coverage" or "LIV journey" or "Status coverage" or "Action theme totals") return false;
        if (name is "ELI staff submissions" or "Staff attendance totals") return true;
        var details = module switch
        {
            "staff" => new[] { "Memberships" },
            "elevate-status" => ["Elevate Status Awards"],
            "actions" => ["Extensions"],
            "cpd" => ["Attendance"],
            "coaching" => ["Session Actions", "Action Reviews"],
            "liv" or "als-liv" => ["Cycles", "Visits", "Stages", "Practice Ratings", "Actions"],
            "probation" => ["Observations", "Stages", "Visits", "Practice Rubric", "Actions", "Linked LIV Cases", "Linked LIV Cycles", "Linked LIV Visits", "Linked LIV Stages", "Linked LIV Practice Ratings", "Linked LIV Actions", "Linked UCO Reviews", "Linked UCO Development Actions"],
            "reflections" => ["Linked Focus Areas"],
            "learning-walks" or "als-learning-walks" or "work-scrutiny" => ["Actions"],
            "elevate-environments" => ["Pillar Ratings", "Actions"],
            "uco-tla-reviews" => ["Development Actions"],
            "digital_learning_walk" => ["Samples", "Responses", "Sample links", "Actions", "Updates"],
            "activate_growth_review" => ["Skills Scan", "Review links", "Previous review", "Previous Skills Scan", "Review scope", "Participants", "Historical form", "Snapshots", "Actions", "Updates", "Historical action detail", "Historical impact updates"],
            // QA criteria are scalar fields of an evidence item and already appear on the first sheet.
            "qa-review" or "qa-reviews" or "qa-review-report" => ["Linked Actions"],
            _ => Array.Empty<string>()
        };
        if (module != "dashboard-overview") return details.Contains(name, StringComparer.OrdinalIgnoreCase);
        // Overview carries each process's full form sheet plus its genuine repeat-detail sheets.
        // Unprefixed sheets are the overview's own linked actions.
        if (name == "Actions") return true;
        var prefixed=Regex.Match(name,@"^(?<module>[a-z-]+)-\d+-(?<sheet>.+)$",RegexOptions.CultureInvariant);
        return !prefixed.Success || KeepDetail(prefixed.Groups["module"].Value,prefixed.Groups["sheet"].Value);
    }

    private static Dictionary<string, (string Reference, string? Staff, string? Title)> BuildReferences(ExportSheet primary, IReadOnlyList<ExportSheet> sheets)
    {
        var result = new Dictionary<string, (string, string?, string?)>(StringComparer.OrdinalIgnoreCase);
        var links = primary.Columns.Select((column, index) => (column, index)).Where(item => LinkColumns.Contains(BaseColumn(item.column))).ToArray();
        var staff = FirstIndex(primary, "Staff member", "Name", "Lecturer");
        var title = FirstIndex(primary, "Title", "Record title", "Event title", "Action", "Activity");
        for (var row = 0; row < primary.Rows.Count; row++)
        {
            var reference = $"Entry {row + 1:0000}";
            foreach (var link in links)
            {
                var key = Cell(primary.Rows[row], link.index);
                if (!string.IsNullOrEmpty(key)) result.TryAdd(key, (reference, Cell(primary.Rows[row], staff), Cell(primary.Rows[row], title)));
            }
        }
        // Supporting source rows bridge core record -> specialist case -> cycle/visit/action.
        // An attendee's Staff ID must never become a bridge across unrelated event records.
        var staffCohort = primary.Columns.Any(column => column.Equals("Staff ID", StringComparison.OrdinalIgnoreCase));
        for (var pass = 0; pass < 4; pass++)
        {
        var previousCount = result.Count;
        foreach (var sheet in sheets.Skip(1))
        {
            var related = sheet.Columns.Select((column,index) => (column: BaseColumn(column),index))
                .Where(item => LinkColumns.Contains(item.column) && (staffCohort || item.column != "Staff ID")).ToArray();
            if (related.Length < 2) continue;
            foreach (var row in sheet.Rows)
            {
                var known = related.Select(item => Cell(row,item.index)).FirstOrDefault(key => key is not null && result.ContainsKey(key));
                if (known is null) continue;
                foreach (var link in related)
                    if (Cell(row,link.index) is { Length: > 0 } key) result.TryAdd(key,result[known]);
            }
        }
        if (result.Count == previousCount) break;
        }
        return result;
    }

    private static ExportSheet ProjectSheet(ExportSheet source,
        IReadOnlyDictionary<string, (string Reference, string? Staff, string? Title)> references, bool primary)
    {
        var indices = source.Columns.Select((column, index) => (column, index))
            .Where(item => !IsInternal(item.column)).Select(item => item.index).ToArray();
        var selectedPractice = source.Columns.ToList().IndexOf("Selected practice themes");
        var practice = source.Columns.ToList().IndexOf("Areas of practice");
        if (selectedPractice>=0 && practice>=0) indices=indices.Where(index=>index!=selectedPractice).ToArray();
        if (primary)
        {
            string[] context = ["Staff member","Name","Lecturer","Title","Record title","Event title","Activity","Reviewer","Coach or mentor","Owner","Submitted by","Academic year","Faculty","Sub-team"];
            indices = indices.OrderBy(index => {var rank=Array.FindIndex(context,label=>label.Equals(source.Columns[index],StringComparison.OrdinalIgnoreCase));return rank<0 ? context.Length : rank;}).ToArray();
        }
        var links = source.Columns.Select((column, index) => (column, index)).Where(item => LinkColumns.Contains(BaseColumn(item.column))).Select(item => item.index).ToArray();
        var independentCohort = source.Name is "ELI staff submissions" or "Staff attendance totals";
        var includeReference = links.Length > 0 && (primary || references.Count > 0 && !independentCohort);
        var addStaff = includeReference && !primary && FirstIndex(source, "Staff member", "Name", "Lecturer") < 0;
        var addTitle = includeReference && !primary && FirstIndex(source, "Source record", "Record title", "Event title", "Activity") < 0;
        var prefix = new List<string>();
        if (includeReference) prefix.Add("Entry reference");
        if (addStaff) prefix.Add("Associated staff member");
        if (addTitle) prefix.Add("Source entry");
        var headings = prefix.Concat(indices.Select(index => source.Columns[index])).ToArray();
        var sourceRows = !primary && links.Length > 0 && references.Count > 0 && !independentCohort
            ? source.Rows.Where(row => links.Any(index => Cell(row,index) is { } key && references.ContainsKey(key))).ToArray()
            : source.Rows;
        var rows = sourceRows.Select((row, rowIndex) =>
        {
            var match = links.Select(index => Cell(row, index)).Where(key => key is not null && references.ContainsKey(key)).Select(key => references[key!]).FirstOrDefault();
            var values = new List<string?>();
            if (includeReference) values.Add(primary ? $"Entry {rowIndex + 1:0000}" : match.Reference);
            if (addStaff) values.Add(match.Staff);
            if (addTitle) values.Add(match.Title);
            values.AddRange(indices.Select(index => DisplayValue(index==practice && selectedPractice>=0 && !string.IsNullOrWhiteSpace(Cell(row,selectedPractice)) ? Cell(row,selectedPractice) : Cell(row, index))));
            return (IReadOnlyList<string?>)values;
        }).ToArray();
        return source with { Columns = headings, Rows = rows,
            ColumnTypes = prefix.Select(_ => "text").Concat(indices.Select(index => source.ColumnTypes?.ElementAtOrDefault(index) ?? "text")).ToArray() };
    }

    private static bool IsInternal(string column)
    {
        // Bracketed identities belong to stable saved form questions; their visible wording is
        // intentionally not treated as system metadata, even if a question is called "Staff ID".
        if (column.EndsWith(']') && column.Contains(" [", StringComparison.Ordinal)) return false;
        var label = column.Split(" - ").Last();
        return InternalColumns.Contains(label) || label.Equals("Reflection ID", StringComparison.OrdinalIgnoreCase);
    }

    private static string Describe(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Array => string.Join("\n", element.EnumerateArray().Select(Describe).Where(value => value.Length > 0)),
        JsonValueKind.Object => string.Join("\n", element.EnumerateObject().Where(property => !IsInternalStructuredProperty(property.Name))
            .Select(property => $"{Words(property.Name)}: {Describe(property.Value)}")),
        JsonValueKind.Null => "",
        _ => element.ToString()
    };

    private static string Words(string value) => Regex.Replace(value.Replace('_', ' '), "([a-z])([A-Z])", "$1 $2");
    private static string BaseColumn(string column) => column.Split(" - ").Last();
    private static int FirstIndex(ExportSheet sheet, params string[] names) => sheet.Columns.ToList().FindIndex(column => names.Contains(column, StringComparer.OrdinalIgnoreCase));
    private static string? Cell(IReadOnlyList<string?> row, int index) => index >= 0 && index < row.Count ? row[index] : null;
}
