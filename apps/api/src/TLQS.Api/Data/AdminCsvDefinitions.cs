using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Security;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    public async Task<AdminCsvImportDefinition> GetAdminCsvDefinitionAsync(string kind, CurrentUser user, CancellationToken token)
    {
        RequireCsvAdministrator(user, kind);
        var definition = AdminCsvDefinitions.Get(kind);
        var references = new List<AdminCsvReference>();
        if (kind == "qa-questions")
        {
            var activities = await GetQaActivityTypesAsync(token);
            references.Add(new("Available QA activities", ["activity_key", "Activity"], activities.Where(row => row.IsActive)
                .Select(row => (IReadOnlyList<string>)new[] { row.ActivityKey, row.Name }).ToArray()));
        }
        if (kind == "cpd-events")
        {
            var themes = await GetLookupValuesAsync("cpd_theme", token);
            references.Add(new("Active CPD themes", ["theme_keys", "Theme"], themes.Select(row => (IReadOnlyList<string>)new[] { row.ValueKey, row.DisplayName }).ToArray()));
            var years = await GetAcademicYearsAsync(token);
            references.Add(new("Academic years", ["academic_year"], years.Select(row => (IReadOnlyList<string>)new[] { row.AcademicYear }).ToArray()));
            var staff = await QueryAsync("""
                SELECT TOP (2000) staff.external_id,staff.email,staff.display_name
                FROM people.staff staff
                WHERE staff.archived_at IS NULL AND staff.account_status='active'
                ORDER BY staff.display_name,staff.id;
                """, reader => (IReadOnlyList<string>)new[] { GetStringOrNull(reader, 0) ?? "", GetStringOrNull(reader, 1) ?? "", reader.GetString(2) }, token);
            references.Add(new("Active staff matching references (first 2,000 by name; names are for reference only)", ["participant_external_id", "participant_email", "Staff member"], staff));
        }
        if (kind == "managed-list-values")
        {
            var lists = await GetAdminManagedListsAsync(token);
            references.Add(new("Registered editable lists", ["lookup_key", "List", "Category"], lists.Select(row => (IReadOnlyList<string>)new[] { row.LookupKey, row.Name, row.Category }).ToArray()));
            references.Add(new("Existing list choices", ["lookup_key", "value_key", "display_name", "Availability"], lists.SelectMany(list => list.Values.Select(value => (IReadOnlyList<string>)new[] { list.LookupKey, value.ValueKey, value.DisplayName, value.IsActive ? "Active" : "Inactive" })).ToArray()));
        }
        return definition with { References = references };
    }
}

public static class AdminCsvDefinitions
{
    public static AdminCsvImportDefinition Get(string kind) => kind switch
    {
        "qa-questions" => new(kind, "Import QA questions", "Add criteria and guidance to the QA question bank for future review setup.",
        [
            new("question_reference", "Question reference", true, "Your stable reference, up to 200 characters. Reuse it when re-uploading the same question.", "QA-2026-001"),
            new("activity_key", "Activity key", true, "Copy an active activity key from the references below.", "lesson_visit"),
            new("question_tag", "Question tag", false, "Groups questions for review setup. Defaults to general; maximum 80 characters.", "autumn-2026"),
            new("theme_or_week", "Theme or week", false, "Optional section or week label, up to 200 characters.", "Planning"),
            new("question_text", "Question", true, "The criterion wording, up to 1,000 characters.", "Learning is sequenced to build understanding."),
            new("guidance", "Guidance", false, "Optional guidance, up to 2,000 characters. Quote a field containing commas or line breaks.", "Consider how activities connect to prior learning."),
            new("display_order", "Display order", false, "A non-negative whole number; blank appends after existing questions.", "10"),
            new("is_required", "Required", false, "true or false. Defaults to true.", "true"),
            new("allows_not_applicable", "Allow N/A", false, "true or false. Defaults to false.", "false"),
            new("comment_required_at_expected", "Legacy comment flag", false, "Retained for CSV compatibility; not enforced. Evidence notes remain optional for every outcome. Leave blank or use false.", "false"),
            new("source_status", "Availability", false, "draft (default) or active. Review draft questions in the question bank before making them active.", "draft")
        ],
        ["Adds questions only. Existing questions and published review snapshots are retained.",
         "Select imported questions when setting up a future review using their activity and question tag.",
         "Not seen, form access and shared outcome wording are maintained separately in QA administration.",
         "Evidence notes are optional. The legacy comment_required_at_expected column does not make them mandatory; N/A reasons remain required where N/A is enabled.",
         "Identical imported references are skipped. A changed reference payload or a duplicate existing criterion must be resolved in the question bank."], []),
        "cpd-events" => new(kind, "Import CPD events & attendance", "Record delivered internal or mandatory CPD events with named participants.",
        [
            new("event_reference", "Event reference", true, "Your stable event reference, up to 200 characters. Repeat it for each participant in the same event.", "CPD-2026-001"),
            new("academic_year", "Academic year", true, "Use a registered year matching the event date.", "2026/27"),
            new("cpd_type", "CPD type", true, "internal or mandatory. The applicable CPD management permission is required.", "internal"),
            new("title", "Event title", true, "Use the same title and event details for every participant in the group.", "Assessment and feedback workshop"),
            new("event_date_time", "Event date and time", true, "Delivered event in local time: yyyy-MM-ddTHH:mm. Future events are not imported.", "2026-10-01T14:00"),
            new("duration_minutes", "Duration in minutes", true, "Total duration as a whole number from 1 to 1,499.", "90"),
            new("delivery_mode", "Delivery mode", true, "Face to face, Online, Blended or Self-directed.", "Face to face"),
            new("theme_keys", "CPD themes", true, "Active theme keys from the references below; separate multiple choices with |.", "assessment_feedback|digital_learning"),
            new("participant_external_id", "Participant external ID", false, "Provide this or participant_email. If both are provided, they must identify the same active member of staff.", "STAFF001"),
            new("participant_email", "Participant email", false, "Exact staff email; staff are never matched by name or created by an import.", "colleague@example.org")
        ],
        ["One participant per row. Rows sharing an event reference create one event and its attendance.",
         "Internal attendance uses the existing qualifying CPD rules. Mandatory CPD earns no Elevate attendance credit. Award confirmation remains a separate workflow.",
         "Imports create delivered events only; they do not edit attendance, create future events or record external self-logs on another person's behalf.",
         "Identical imported events are skipped. Changed references and probable existing events are blocked for review in the original record."], []),
        "managed-list-values" => new(kind, "Import list choices", "Add choices to registered administrative lists, including CPD themes and QA action themes.",
        [
            new("lookup_key", "List key", true, "Choose a registered list from the references below. System workflow lists cannot be imported.", "cpd_theme"),
            new("value_key", "Choice key", false, "Stable lowercase letters, numbers and underscores, up to 100 characters. Blank generates a key from the wording.", "retrieval_practice"),
            new("display_name", "Choice wording", true, "The wording shown in forms, up to 200 characters.", "Retrieval practice"),
            new("display_order", "Display order", false, "A non-negative whole number. Blank appends after existing choices.", "10")
        ],
        ["Adds active choices only to registered editable lists. It never renames, reorders, archives or reactivates existing choices.",
         "Existing identical active choices are skipped. Conflicting keys, duplicate wording and inactive choices require review in the existing list editor.",
         "Import missing CPD themes first, then use their keys in the CPD event import."], []),
        _ => throw new ArgumentOutOfRangeException(nameof(kind))
    };
}
