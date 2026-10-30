using System.Globalization;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    private async Task<AdminCsvImportPlan> BuildCpdCsvPlanAsync(AdminCsvTable table, CurrentUser user,
        SqlConnection connection, SqlTransaction? transaction, IReadOnlyDictionary<string, AdminCsvLedgerEntry> ledger,
        CancellationToken token)
    {
        if (!AdminCsvAccess.CanUse(user, "cpd-events") || !user.StaffId.HasValue)
            throw new UnauthorizedAccessException("An Administrator linked to a staff record with the appropriate CPD permission is required.");

        var staff = new List<CpdCsvStaff>();
        var themes = new List<CpdCsvTheme>();
        var years = new List<CpdCsvYear>();
        var templates = new Dictionary<string, CpdCsvTemplate>(StringComparer.OrdinalIgnoreCase);
        var existing = new List<CpdCsvExistingEvent>();
        await using var command = new SqlCommand("""
            SELECT id,external_id,email,display_name,primary_org_unit_id,account_status,archived_at FROM people.staff;
            SELECT value.value_key,value.display_name,value.is_active,value.archived_at,type.is_active
            FROM core.lookup_values value JOIN core.lookup_types type ON type.id=value.lookup_type_id
            WHERE type.lookup_key=N'cpd_theme' AND type.archived_at IS NULL;
            SELECT academic_year_key,start_date,end_date,is_active,archived_at FROM core.academic_years;
            WITH candidates AS (
                SELECT template.template_key,version.id,ROW_NUMBER() OVER(PARTITION BY template.template_key
                    ORDER BY version.is_published DESC,version.active_from DESC,version.created_at DESC) position
                FROM forms.form_templates template
                JOIN forms.form_template_versions version ON version.form_template_id=template.id AND version.archived_at IS NULL
                JOIN core.modules module ON module.id=template.module_id AND module.module_key=N'cpd'
                WHERE template.template_key IN(N'cpd_core',N'cpd_mandatory') AND template.is_active=1
                  AND template.archived_at IS NULL AND version.is_published=1
            )
            SELECT candidate.template_key,candidate.id,field.id,field.field_key,field.field_type,field.is_required,field.label
            FROM candidates candidate
            LEFT JOIN forms.form_sections section ON section.form_template_version_id=candidate.id AND section.archived_at IS NULL
            LEFT JOIN forms.form_fields field ON field.form_section_id=section.id AND field.archived_at IS NULL AND field.is_active=1
            WHERE candidate.position=1 ORDER BY candidate.template_key,field.id;
            SELECT record.id,template.template_key,event.event_title,event.event_date,event.start_time
            FROM cpd.cpd_events event JOIN core.records record ON record.id=event.record_id AND record.archived_at IS NULL
            CROSS APPLY(SELECT TOP(1) submission.form_template_version_id FROM forms.form_submissions submission
                WHERE submission.record_id=record.id AND submission.archived_at IS NULL
                ORDER BY submission.created_at DESC,submission.id DESC) submission
            JOIN forms.form_template_versions version ON version.id=submission.form_template_version_id
            JOIN forms.form_templates template ON template.id=version.form_template_id
            WHERE event.archived_at IS NULL AND template.template_key IN(N'cpd_core',N'cpd_mandatory');
            """, connection, transaction);
        await using (var reader = await command.ExecuteReaderAsync(token))
        {
            while (await reader.ReadAsync(token)) staff.Add(new(reader.GetGuid(0), reader.GetString(1), reader.GetString(2), reader.GetString(3),
                GetGuidOrNull(reader, 4), reader.GetString(5) == "active" && reader.IsDBNull(6)));
            await reader.NextResultAsync(token);
            while (await reader.ReadAsync(token)) themes.Add(new(reader.GetString(0), reader.GetString(1), reader.GetBoolean(2) && reader.IsDBNull(3) && reader.GetBoolean(4)));
            await reader.NextResultAsync(token);
            while (await reader.ReadAsync(token)) years.Add(new(reader.GetString(0), DateOnly.FromDateTime(reader.GetDateTime(1)),
                DateOnly.FromDateTime(reader.GetDateTime(2)), reader.GetBoolean(3) && reader.IsDBNull(4)));
            await reader.NextResultAsync(token);
            var fields = new Dictionary<string, List<CpdCsvField>>(StringComparer.OrdinalIgnoreCase);
            while (await reader.ReadAsync(token))
            {
                var key = reader.GetString(0);
                if (!fields.TryGetValue(key, out var list))
                {
                    fields[key] = list = [];
                    templates[key] = new(key, reader.GetGuid(1), list);
                }
                if (!reader.IsDBNull(2)) list.Add(new(reader.GetGuid(2), reader.GetString(3), reader.GetString(4), reader.GetBoolean(5), reader.GetString(6)));
            }
            await reader.NextResultAsync(token);
            while (await reader.ReadAsync(token)) existing.Add(new(reader.GetGuid(0), reader.GetString(1), reader.GetString(2),
                DateOnly.FromDateTime(reader.GetDateTime(3)), reader.IsDBNull(4) ? null : TimeOnly.FromTimeSpan(reader.GetTimeSpan(4))));
        }

        var zone = TimeZoneInfo.FindSystemTimeZoneById(OperatingSystem.IsWindows() ? "GMT Standard Time" : "Europe/London");
        var now = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, zone).DateTime;
        var prepared = CpdCsvImportRules.Prepare(table, user, staff, themes, years, templates.Values.ToArray(), existing,
            ledger.ToDictionary(item => item.Key, item => item.Value.PayloadHash, StringComparer.OrdinalIgnoreCase), now);
        var changes = prepared.Events.Select(item => new AdminCsvPlannedChange(item.Reference, item.PayloadHash, item.FirstRowNumber,
            async (applyConnection, applyTransaction, actor, cancellationToken) =>
            {
                var request = CpdCsvImportRules.Submission(item);
                var result = await SubmitFormWithinTransactionAsync(request, actor, applyConnection, applyTransaction, cancellationToken);
                return result.RecordId;
            })).ToArray();
        return new("cpd-events", prepared.Rows, prepared.Issues, changes, prepared.ContextFingerprint);
    }
}

public sealed record CpdCsvStaff(Guid Id, string ExternalId, string Email, string Name, Guid? PrimaryOrgUnitId, bool IsActive);
public sealed record CpdCsvTheme(string Key, string Name, bool IsActive);
public sealed record CpdCsvYear(string Key, DateOnly StartDate, DateOnly EndDate, bool IsActive);
public sealed record CpdCsvField(Guid Id, string Key, string Type, bool IsRequired, string Label);
public sealed record CpdCsvTemplate(string Key, Guid VersionId, IReadOnlyList<CpdCsvField> Fields);
public sealed record CpdCsvExistingEvent(Guid RecordId, string TemplateKey, string Title, DateOnly Date, TimeOnly? StartTime);
public sealed record CpdCsvPreparedEvent(string Reference, string PayloadHash, int FirstRowNumber, string AcademicYear,
    string Type, string Title, DateTime EventAt, int DurationMinutes, string DeliveryMode,
    IReadOnlyList<CpdCsvTheme> Themes, IReadOnlyList<CpdCsvStaff> Participants, CpdCsvTemplate Template);
public sealed record CpdCsvPreparedPlan(IReadOnlyList<AdminCsvPreviewRow> Rows, IReadOnlyList<AdminCsvIssue> Issues,
    IReadOnlyList<CpdCsvPreparedEvent> Events, string ContextFingerprint);

public static class CpdCsvImportRules
{
    public static readonly string[] RequiredHeaders = ["event_reference", "academic_year", "cpd_type", "title", "event_date_time", "duration_minutes", "delivery_mode", "theme_keys"];
    public static readonly string[] OptionalHeaders = ["participant_external_id", "participant_email"];
    private static readonly string[] ExpectedFields = ["cpd_title", "date_time", "delivery_mode", "duration_hours", "duration_minutes", "cpd_themes", "staff_search"];
    private static readonly string[] DeliveryModes = ["Face to face", "Online", "Blended", "Self-directed"];

    public static SubmitFormRequest Submission(CpdCsvPreparedEvent item)
    {
        var answers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["cpd_title"] = item.Title, ["date_time"] = item.EventAt.ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture),
            ["delivery_mode"] = item.DeliveryMode, ["duration_hours"] = (item.DurationMinutes / 60).ToString(CultureInfo.InvariantCulture),
            ["duration_minutes"] = (item.DurationMinutes % 60).ToString(CultureInfo.InvariantCulture),
            ["cpd_themes"] = string.Join('|', item.Themes.Select(theme => theme.Name)),
            ["staff_search"] = string.Join('|', item.Participants.Select(participant => participant.Id))
        };
        return new(item.Template.Key, "cpd_event", item.Title, answers["cpd_themes"], null, null,
            DateOnly.FromDateTime(item.EventAt), item.Template.Fields.Where(field => answers.ContainsKey(field.Key))
                .Select(field => new SubmitFormResponseRequest(field.Id, answers[field.Key])).ToArray());
    }

    public static CpdCsvPreparedPlan Prepare(AdminCsvTable table, CurrentUser user, IReadOnlyList<CpdCsvStaff> staff,
        IReadOnlyList<CpdCsvTheme> themes, IReadOnlyList<CpdCsvYear> years, IReadOnlyList<CpdCsvTemplate> templates,
        IReadOnlyList<CpdCsvExistingEvent> existing, IReadOnlyDictionary<string, string> ledger, DateTime collegeNow)
    {
        if (!AdminCsvAccess.CanUse(user, "cpd-events") || !user.StaffId.HasValue)
            throw new UnauthorizedAccessException("An Administrator linked to a staff record with the appropriate CPD permission is required.");
        var issues = AdminCsvReader.ValidateHeaders(table, RequiredHeaders, OptionalHeaders).ToList();
        if (!OptionalHeaders.Any(header => table.Headers.Contains(header, StringComparer.OrdinalIgnoreCase)))
            issues.Add(new(1, "participant_external_id", "Include participant_external_id or participant_email to identify each participant."));
        var rows = new List<ParsedRow>();
        var previews = new List<AdminCsvPreviewRow>();
        var events = new List<CpdCsvPreparedEvent>();
        foreach (var row in table.Rows)
        {
            var reference = AdminCsvReader.Get(row, "event_reference");
            var year = AdminCsvReader.Get(row, "academic_year");
            var type = AdminCsvReader.Get(row, "cpd_type").ToLowerInvariant();
            var title = AdminCsvReader.Get(row, "title");
            var dateText = AdminCsvReader.Get(row, "event_date_time");
            var durationText = AdminCsvReader.Get(row, "duration_minutes");
            var deliveryText = AdminCsvReader.Get(row, "delivery_mode");
            void Error(string column, string message) => issues.Add(new(row.Number, column, message));
            if (reference.Length is 0 or > 200) Error("event_reference", "Use a stable event reference of 1 to 200 characters.");
            if (title.Length is 0 or > 300) Error("title", "Enter an event title of 1 to 300 characters.");
            if (type is not ("internal" or "mandatory")) Error("cpd_type", "Use internal or mandatory. External self-logs are recorded by the individual staff member.");
            else if (!user.HasPermission(type == "internal" ? PermissionKeys.CpdManage : PermissionKeys.CpdMandatoryLog))
                Error("cpd_type", $"You do not have permission to import {type} CPD.");
            var parsedDate = DateTime.TryParseExact(dateText, ["yyyy-MM-dd'T'HH:mm", "yyyy-MM-dd'T'HH:mm:ss"], CultureInfo.InvariantCulture, DateTimeStyles.None, out var eventAt);
            if (!parsedDate) Error("event_date_time", "Use the local college date and time in yyyy-MM-ddTHH:mm format.");
            else if (!string.Equals(AcademicYearPolicy.GetKey(DateOnly.FromDateTime(eventAt)), year, StringComparison.Ordinal))
                Error("academic_year", "The academic year must match the event date (1 August to 31 July), for example 2026/27.");
            if (!int.TryParse(durationText, NumberStyles.None, CultureInfo.InvariantCulture, out var duration) || duration is < 1 or > 1499)
                Error("duration_minutes", "Enter a whole number of minutes from 1 to 1499.");
            var delivery = DeliveryModes.FirstOrDefault(value => value.Equals(deliveryText, StringComparison.OrdinalIgnoreCase));
            if (delivery is null) Error("delivery_mode", "Use Face to face, Online, Blended or Self-directed.");

            var selectedThemes = new List<CpdCsvTheme>();
            var themeKeys = AdminCsvReader.Get(row, "theme_keys").Split('|', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).Distinct(StringComparer.OrdinalIgnoreCase).Order(StringComparer.OrdinalIgnoreCase).ToArray();
            if (themeKeys.Length == 0) Error("theme_keys", "Select at least one configured CPD theme key.");
            foreach (var key in themeKeys)
            {
                var matches = themes.Where(theme => theme.Key.Equals(key, StringComparison.OrdinalIgnoreCase)).ToArray();
                if (matches.Length != 1) Error("theme_keys", $"Theme key '{key}' does not identify one configured CPD theme.");
                else selectedThemes.Add(matches[0]);
            }
            var externalId = AdminCsvReader.Get(row, "participant_external_id");
            var email = AdminCsvReader.Get(row, "participant_email");
            var byExternal = externalId.Length == 0 ? [] : staff.Where(person => person.ExternalId.Equals(externalId, StringComparison.OrdinalIgnoreCase)).ToArray();
            var byEmail = email.Length == 0 ? [] : staff.Where(person => person.Email.Equals(email, StringComparison.OrdinalIgnoreCase)).ToArray();
            CpdCsvStaff? participant = null;
            if (externalId.Length == 0 && email.Length == 0) Error("participant_external_id", "Identify the participant by external staff ID or email.");
            if (externalId.Length > 0 && byExternal.Length != 1) Error("participant_external_id", "The external staff ID must identify exactly one existing staff member.");
            if (email.Length > 0 && byEmail.Length != 1) Error("participant_email", "The email must identify exactly one existing staff member.");
            if (byExternal.Length == 1 && byEmail.Length == 1 && byExternal[0].Id != byEmail[0].Id)
                Error("participant_email", "The email and external staff ID identify different people.");
            else if (externalId.Length > 0 && byExternal.Length == 1 && (email.Length == 0 || byEmail.Length == 1)) participant = byExternal[0];
            else if (externalId.Length == 0 && byEmail.Length == 1) participant = byEmail[0];
            rows.Add(new(row, reference, year, type, title, eventAt, duration, delivery ?? deliveryText, selectedThemes, participant));
        }

        foreach (var duplicate in rows.GroupBy(row => (row.Type, Title: row.Title.ToUpperInvariant(), row.EventAt))
                     .Where(group => group.Select(row => row.Reference).Distinct(StringComparer.OrdinalIgnoreCase).Count() > 1))
            foreach (var row in duplicate)
                issues.Add(new(row.Source.Number, "event_reference", "The same CPD type, title and date/time appear under different event references. Use one reference with one row per participant."));

        foreach (var group in rows.GroupBy(row => row.Reference, StringComparer.OrdinalIgnoreCase))
        {
            var first = group.First();
            var groupRows = group.ToArray();
            var numbers = groupRows.Select(row => row.Source.Number).ToHashSet();
            if (groupRows.Any(row => Context(row) != Context(first)))
                foreach (var row in groupRows) issues.Add(new(row.Source.Number, "event_reference", "All rows for one event reference must use identical event details, CPD type, academic year and themes."));
            var participants = groupRows.Where(row => row.Participant is not null).Select(row => row.Participant!).DistinctBy(person => person.Id).OrderBy(person => person.Id).ToArray();
            foreach (var duplicate in groupRows.Where(row => row.Participant is not null).GroupBy(row => row.Participant!.Id).Where(duplicate => duplicate.Count() > 1))
                foreach (var row in duplicate.Skip(1)) issues.Add(new(row.Source.Number, "participant_external_id", "This participant is repeated for the same event and will be counted once.", "warning"));
            var hash = AdminCsvReader.CanonicalHash(new
            {
                academicYear = first.Year, type = first.Type, title = first.Title,
                eventAt = first.EventAt.ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture),
                durationMinutes = first.Duration, deliveryMode = first.Delivery,
                themes = first.Themes.Select(theme => theme.Key).Order(StringComparer.OrdinalIgnoreCase),
                participants = participants.Select(person => person.Id)
            });
            var operation = "create";
            if (!issues.Any(issue => issue.Severity == "error" && (issue.RowNumber == 1 || numbers.Contains(issue.RowNumber))))
            {
                if (ledger.TryGetValue(first.Reference, out var prior))
                {
                    if (string.Equals(prior, hash, StringComparison.Ordinal)) operation = "skip";
                    else issues.Add(new(first.Source.Number, "event_reference", "This reference was already imported with different data. Amend the original CPD record; imports do not overwrite records."));
                }
                else
                {
                    if (first.EventAt > collegeNow) issues.Add(new(first.Source.Number, "event_date_time", "Import completed CPD only. Future events must be managed through the normal CPD workflow."));
                    var year = years.SingleOrDefault(year => year.Key.Equals(first.Year, StringComparison.Ordinal));
                    if (year is null || !year.IsActive || DateOnly.FromDateTime(first.EventAt) < year.StartDate || DateOnly.FromDateTime(first.EventAt) > year.EndDate)
                        issues.Add(new(first.Source.Number, "academic_year", "Select an active, registered academic year containing the event date."));
                    foreach (var row in groupRows.Where(row => row.Participant is { IsActive: false }))
                        issues.Add(new(row.Source.Number, "participant_external_id", "The participant is inactive or archived. Imports do not reactivate staff."));
                    foreach (var theme in first.Themes.Where(theme => !theme.IsActive))
                        issues.Add(new(first.Source.Number, "theme_keys", $"The CPD theme '{theme.Key}' is inactive or archived."));
                    var templateKey = first.Type == "mandatory" ? "cpd_mandatory" : "cpd_core";
                    var template = templates.SingleOrDefault(template => template.Key.Equals(templateKey, StringComparison.OrdinalIgnoreCase));
                    if (template is null) issues.Add(new(first.Source.Number, "cpd_type", "There is no active published form for this CPD type."));
                    else
                    {
                        foreach (var missing in ExpectedFields.Where(key => !template.Fields.Any(field => field.Key.Equals(key, StringComparison.OrdinalIgnoreCase))))
                            issues.Add(new(first.Source.Number, "cpd_type", $"The published form is missing '{missing}'. Use the original form until its configuration is reviewed."));
                        foreach (var field in template.Fields.Where(field => field.IsRequired && !ExpectedFields.Contains(field.Key, StringComparer.OrdinalIgnoreCase)))
                            issues.Add(new(first.Source.Number, "cpd_type", $"The published form requires '{field.Label}', which this CSV does not collect. Complete the event using the original form."));
                    }
                    if (existing.Any(item => item.TemplateKey == templateKey && item.Title.Trim().Equals(first.Title, StringComparison.OrdinalIgnoreCase)
                        && item.Date == DateOnly.FromDateTime(first.EventAt) && (item.StartTime is null || item.StartTime == TimeOnly.FromDateTime(first.EventAt))))
                        issues.Add(new(first.Source.Number, "event_reference", "A CPD event of this type with the same title, date and time already exists. Review that record before importing another reference."));
                    if (!issues.Any(issue => issue.Severity == "error" && numbers.Contains(issue.RowNumber)) && template is not null)
                    {
                        events.Add(new(first.Reference, hash, first.Source.Number, first.Year, first.Type, first.Title, first.EventAt, first.Duration, first.Delivery, first.Themes, participants, template));
                        issues.Add(new(first.Source.Number, "event_reference", first.Type == "internal"
                            ? $"This event will record {participants.Length} distinct participant(s) as Attended, with one qualifying internal CPD attendance each. Elevate award confirmations remain separate."
                            : $"This mandatory event will record {participants.Length} distinct participant(s) as Attended, with zero Elevate credit.", "info"));
                    }
                }
            }
            if (issues.Any(issue => issue.Severity == "error" && (issue.RowNumber == 1 || numbers.Contains(issue.RowNumber)))) operation = "error";
            foreach (var row in groupRows) previews.Add(new(row.Source.Number, row.Reference, operation, new Dictionary<string, string?>
            {
                ["event_reference"] = row.Reference, ["academic_year"] = row.Year, ["cpd_type"] = row.Type,
                ["title"] = row.Title, ["event_date_time"] = AdminCsvReader.Get(row.Source, "event_date_time"),
                ["duration_minutes"] = row.Duration.ToString(CultureInfo.InvariantCulture), ["delivery_mode"] = row.Delivery,
                ["theme_keys"] = string.Join('|', row.Themes.Select(theme => theme.Key)),
                ["participant_external_id"] = row.Participant?.ExternalId ?? AdminCsvReader.Get(row.Source, "participant_external_id"),
                ["participant_email"] = row.Participant?.Email ?? AdminCsvReader.Get(row.Source, "participant_email")
            }));
        }
        var context = AdminCsvReader.CanonicalHash(new
        {
            staff = rows.Where(row => row.Participant is not null).Select(row => row.Participant!).DistinctBy(person => person.Id).OrderBy(person => person.Id),
            themes = rows.SelectMany(row => row.Themes).DistinctBy(theme => theme.Key).OrderBy(theme => theme.Key, StringComparer.OrdinalIgnoreCase),
            templates = templates.Where(template => rows.Any(row => template.Key == (row.Type == "mandatory" ? "cpd_mandatory" : "cpd_core"))).OrderBy(template => template.Key),
            years = years.Where(year => rows.Any(row => row.Year == year.Key)).OrderBy(year => year.Key)
        });
        return new(previews.OrderBy(row => row.RowNumber).ToArray(), issues, events, context);
    }

    private static string Context(ParsedRow row) => AdminCsvReader.CanonicalHash(new
    {
        row.Year, row.Type, row.Title, row.EventAt, row.Duration, row.Delivery,
        themes = row.Themes.Select(theme => theme.Key).Order(StringComparer.OrdinalIgnoreCase)
    });
    private sealed record ParsedRow(AdminCsvRow Source, string Reference, string Year, string Type, string Title,
        DateTime EventAt, int Duration, string Delivery, IReadOnlyList<CpdCsvTheme> Themes, CpdCsvStaff? Participant);
}
