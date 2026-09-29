using System.Globalization;
using System.Text.Json;
using TLQS.Api.Exports;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    public async Task<ExportWorkbookData> GetDashboardExportAsync(string moduleKey, ExportFilter filter,
        CurrentUser user, CancellationToken cancellationToken, bool includeWorkbookEntries = true)
    {
        var module = NormalizeExportModuleKey(moduleKey);
        ValidateExportFilters(module, filter);
        if (string.IsNullOrWhiteSpace(filter.AcademicYear) || module is "staff" or "reflections")
            return await GetExportWorkbookAsync(module, filter, user, cancellationToken);
        if (filter.DimensionLabel?.Length > 500) throw new WorkflowValidationException("Select a valid theme, focus or area.");
        if (module == "uco-tla-reviews")
        {
            var workbook = includeWorkbookEntries ? await GetExportWorkbookAsync(module, filter, user, cancellationToken) : DashboardMetadata();
            var dashboard = await GetUcoTlaDashboardAsync(user, filter.AcademicYear, cancellationToken);
            return workbook with { Dashboard = UcoDashboardReportBuilder.Build(dashboard, DateTimeOffset.UtcNow) };
        }

        var process = DashboardProcess(module);
        var recordsTask = GetProcessDashboardRecordsAsync(user, cancellationToken, filter.AcademicYear, process);
        var factsTask = GetDashboardDimensionFactsAsync(filter.AcademicYear, user, cancellationToken, process);
        var actionsTask = GetDashboardActionsAsync(filter.AcademicYear, user, cancellationToken, process);
        var configurationTask = GetDashboardConfigurationAsync(cancellationToken);
        await Task.WhenAll(recordsTask, factsTask, actionsTask, configurationTask);
        var excludedUnits = await GetExcludedDashboardUnitsAsync(process, cancellationToken);
        var excludedIds = excludedUnits.Select(unit => unit.Id).ToHashSet();
        var excludedCodes = excludedUnits.Select(unit => unit.Code).ToHashSet();
        var allFacts = (await factsTask).Where(row => !excludedIds.Contains(row.OrgUnitId ?? Guid.Empty) && !excludedCodes.Contains(row.AreaCode ?? "")).ToList();
        var records = DashboardExportScope.Records((await recordsTask).Select(row => DashboardExportScope.ScopeCpd(row, filter, excludedCodes)).OfType<ProcessDashboardRecordSummary>().Where(row => !excludedIds.Contains(row.OrgUnitId ?? Guid.Empty) && !excludedCodes.Contains(row.AreaCode ?? "")).ToArray(), allFacts, process, filter, await actionsTask);
        var recordIds = records.Select(record => record.Id).ToHashSet();
        var facts = DashboardExportScope.Facts(allFacts, recordIds, process, filter);
        var actions = DashboardExportScope.Actions((await actionsTask).Where(row => !excludedCodes.Contains(row.FacultyCode ?? "") && !excludedCodes.Contains(row.TeamCode ?? "")).ToArray(), process, filter, recordIds);
        var scopedFilter = filter with { DashboardRecordIds = recordIds.ToArray(), DashboardActionIds = actions.Select(action => action.Id).ToArray(), DashboardProcessKey = process };
        if (module == "elevate-status") scopedFilter = filter; // Staff cohort uses year and organisation, rather than record scope.
        var data = includeWorkbookEntries ? await GetExportWorkbookAsync(module, scopedFilter, user, cancellationToken) : DashboardMetadata();
        if (includeWorkbookEntries && process == "overview")
        {
            var merged = data.Sheets[0];
            var supporting = new List<ExportSheet>();
            foreach (var group in records.GroupBy(record => record.ProcessKey))
            {
                var specialisedModule = group.Key switch { "cpd_event" => "cpd", "coaching_session" => "coaching", "eli" => "elevate-practice", "liv" => "liv", "als_liv" => "als-liv", "probation_case" => "probation", "elevate_environment" => "elevate-environments", _ => null };
                if (specialisedModule is null) continue;
                var specialised = await GetExportWorkbookAsync(specialisedModule, scopedFilter with { DashboardRecordIds = group.Select(record => record.Id).ToArray() }, user, cancellationToken);
                var entries = specialised.Sheets[0] with { Name = specialised.DisplayName };
                merged = FormEntryExportBuilder.Flatten("Form entries", merged, "Record ID", entries);
                // Separate detail sheets retain collection relationships and original field definitions.
                supporting.AddRange(specialised.Sheets.Skip(1).Select((sheet, index) => sheet with { Name = SafeWorksheetName($"{specialisedModule}-{index + 1}-{sheet.Name}") }));
            }
            data = data with { Sheets = new[] { merged }.Concat(data.Sheets.Skip(1)).Concat(supporting).ToArray() };
        }
        if (includeWorkbookEntries && data.Sheets.Count > 0 && process is not ("actions" or "elevate_status"))
            data = data with { Sheets = new[] { DashboardSubmissionExportBuilder.AddSubmitters(data.Sheets[0], records) }.Concat(data.Sheets.Skip(1)).ToArray() };
        var configuration = (await configurationTask).Processes.FirstOrDefault(item => item.ProcessKey == process);
        var reportSections = new List<DashboardReportSection>();
        var metricsList = DashboardExportScope.Metrics(process, records, facts, actions).ToList();
        var extraSheets = new List<ExportSheet>();

        StaffParticipationDashboardSummary[] participationRows = [];
        LivLifecycleDashboardSummary[] lifecycleRows = [];
        if (process is not ("overview" or "actions" or "elevate_status"))
        {
            var participation = (await GetStaffParticipationDashboardAsync(filter.AcademicYear, user, cancellationToken))
                .Where(row => row.ProcessKey == process && DashboardExportScope.Organisation(row.AreaCode, row.ParentAreaCode, filter)).ToArray();
            participationRows = participation;
            var active = participation.Sum(row => row.ActiveStaffCount);
            var reached = participation.Sum(row => row.ParticipatingStaffCount);
            metricsList.Add(new("Staff participation", active == 0 ? "Not available" : $"{reached:N0} of {active:N0} ({100m * reached / active:0}%)"));
            extraSheets.Add(ObjectSheet("Staff coverage", participation));
            reportSections.Add(new("Staff coverage", "Uses academic year and organisation filters; record date, status and focus filters do not change the staff denominator.",
                participation.Select(row => new DashboardReportItem(row.AreaName ?? row.AreaCode ?? "Unassigned", [new("Active staff", row.ActiveStaffCount.ToString()), new("Participating staff", row.ParticipatingStaffCount.ToString())])).ToArray()));
        }
        if (process == "eli")
        {
            var staff = DashboardSubmissionExportBuilder.ScopeEliStaff(
                await GetEliSubmissionStaffDashboardAsync(filter.AcademicYear, user, cancellationToken), filter, excludedIds, excludedCodes);
            metricsList.AddRange([Metric("Staff submitted", staff.Count(row => row.HasSubmitted)), Metric("Staff not submitted", staff.Count(row => !row.HasSubmitted))]);
            extraSheets.Add(DashboardSubmissionExportBuilder.EliStaffSheet(staff, filter.AcademicYear));
            reportSections.Add(DashboardSubmissionExportBuilder.EliStaffSection(staff));
        }
        if (process is "liv" or "als_liv")
        {
            var lifecycle = (await GetLivLifecycleDashboardAsync(filter.AcademicYear, user, cancellationToken, process))
                .Where(row => DashboardExportScope.Organisation(row.AreaCode, row.ParentAreaCode, filter)).ToArray();
            lifecycleRows = lifecycle;
            metricsList.AddRange([Metric("Completed visit forms", lifecycle.Sum(row => row.CompletedVisitCount)), Metric("Elevate practitioners", lifecycle.Sum(row => row.PractitionerStaffCount)), Metric("Staff with a LIV case", lifecycle.Sum(row => row.PractitionerStaffDenominator))]);
            metricsList.AddRange([Metric("LIV requested", lifecycle.Sum(row => row.RequestedCount)), Metric("Cases started", lifecycle.Sum(row => row.CaseStartedCount)),
                Metric("Visits scheduled", lifecycle.Sum(row => row.ScheduledCount)), Metric("Visits completed", lifecycle.Sum(row => row.VisitedCount)),
                Metric("Cases closed", lifecycle.Sum(row => row.CompletedCount))]);
            extraSheets.Add(ObjectSheet("LIV journey", lifecycle));
            reportSections.Add(new("LIV journey", "Uses academic year and organisation filters. All stages are expanded for every area.",
                lifecycle.Select(row => new DashboardReportItem(row.AreaName ?? row.AreaCode ?? "Unassigned", [new("Completed visit forms", row.CompletedVisitCount.ToString()), new("Elevate practitioners", row.PractitionerStaffCount.ToString()), new("Staff with a case", row.PractitionerStaffDenominator.ToString())],
                    [new("Requested", row.RequestedCount), new("Case started", row.CaseStartedCount), new("Scheduled", row.ScheduledCount), new("Visited", row.VisitedCount), new("Closed", row.CompletedCount)])).ToArray()));
        }
        if (process == "cpd_event")
        {
            var attendance = (await GetCpdAttendanceDashboardAsync(filter.AcademicYear, user, cancellationToken))
                .Where(row => DashboardExportScope.Organisation(row.AreaCode, row.ParentAreaCode, filter)).ToArray();
            extraSheets.Add(ObjectSheet("Staff attendance totals", attendance));
            reportSections.Add(new("CPD faculty attendance", "Average attended events per active member of staff in the academic year.", attendance.GroupBy(row => row.ParentAreaCode ?? row.AreaCode ?? "Unassigned")
                .OrderByDescending(group => group.Average(row => row.AttendanceCount)).Select(group => new DashboardReportItem(group.Key, [new("Active staff", group.Count().ToString()), new("Attendances", group.Sum(row => row.AttendanceCount).ToString()), new("Average per staff member", group.Average(row => row.AttendanceCount).ToString("0.0"))])).ToArray()));
            reportSections.Add(new("Staff attendance", "Attendance totals for the academic year and selected organisation, including staff with no attendance.",
                attendance.Select(row => new DashboardReportItem(row.StaffName, [new("Area", row.AreaName), new("Attendance count", row.AttendanceCount.ToString())])).ToArray()));
        }
        if (process == "elevate_status")
        {
            var status = (await GetElevateStatusDashboardAsync(filter.AcademicYear, user, cancellationToken))
                .Where(row => DashboardExportScope.Organisation(row.AreaCode, row.ParentAreaCode, filter)).ToArray();
            metricsList.Clear();
            metricsList.Add(Metric("Staff in scope", status.Sum(row => row.StaffCount)));
            metricsList.AddRange([Metric("Level 1 or above", status.Sum(row => row.Level1OrAbove)), Metric("Level 2 or above", status.Sum(row => row.Level2OrAbove)),
                Metric("Level 3 or above", status.Sum(row => row.Level3OrAbove)), Metric("Level 4 or above", status.Sum(row => row.Level4OrAbove)), Metric("Level 5 or above", status.Sum(row => row.Level5OrAbove))]);
            extraSheets.Add(ObjectSheet("Status coverage", status));
            reportSections.Add(new("Status by area", "Cumulative level totals for the selected academic year and organisation.",
                status.Select(row => new DashboardReportItem(row.AreaName ?? row.AreaCode ?? "Unassigned", [new("Staff", row.StaffCount.ToString())],
                    [new("Level 1+", row.Level1OrAbove), new("Level 2+", row.Level2OrAbove), new("Level 3+", row.Level3OrAbove), new("Level 4+", row.Level4OrAbove), new("Level 5", row.Level5OrAbove)])).ToArray()));
        }
        if (configuration?.ShowTrend != false && process != "elevate_status")
        {
            var trend = DashboardExportScope.Trend(process == "actions" ? actions.Select(item => DateOnly.FromDateTime(item.CreatedAt.Date))
                : records.Select(item => item.RecordDate ?? DateOnly.FromDateTime(item.CreatedAt.Date)), filter);
            reportSections.Add(new("Activity over time", "Uses the dashboard's daily, weekly or monthly intervals for the selected dates. All intervals are expanded.", [new("Activity", [], trend)]));
        }
        if (configuration?.ShowAreaComparison != false && process != "elevate_status")
        {
            reportSections.Add(new("Organisation comparison", "Faculty totals and every team, including teams with staff but no records.", DashboardExportScope.OrganisationItems(records, facts, actions, participationRows, lifecycleRows)));
        }
        if (configuration?.ShowOutcomes != false && process is not ("liv" or "als_liv"))
        {
            reportSections.Add(new("Outcomes and themes", "Every theme, focus, area and statement is expanded. A form may contribute to multiple themes; N/A is retained separately from numeric ratings.",
                facts.GroupBy(fact => (fact.ProcessKey, fact.DimensionKey, fact.SeriesKey)).OrderBy(group => group.Key.ProcessKey).ThenBy(group => group.Key.DimensionKey).ThenBy(group => group.Key.SeriesKey)
                    .Select(group => new DashboardReportItem(group.First().SeriesLabel.Replace("|||", " / "), DashboardExportScope.OutcomeFields(group),
                        group.GroupBy(fact => (fact.ValueKey, fact.ValueLabel)).OrderBy(value => value.Key.ValueKey).Select(value => new DashboardReportDistribution(value.Key.ValueLabel, value.Count())).ToArray())).ToArray()));
        }
        if (process is "liv" or "als_liv")
        {
            var themes = actions.GroupBy(action => action.ActionTheme).OrderByDescending(group => group.Count()).ThenBy(group => group.Key).Select(group => new DashboardReportDistribution(group.Key, group.Count())).ToArray();
            if (configuration?.ShowOutcomes != false)
                reportSections.Add(new("LIV action themes", "Each action counts once under its configured theme. Historical practice ratings are excluded.", [new("Action themes", [], themes)]));
            extraSheets.Add(ObjectSheet("Action theme totals", themes));
        }
        if (process is "coaching_session" or "work_scrutiny" or "overview" or "actions")
        {
            var selections = process == "actions" ? actions.Select(row => (Id: row.Id, Label: row.ActionTheme))
                : records.SelectMany(row => (row.Theme ?? "").Split('|', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).Select(label => (Id: row.Id, Label: label)))
                    .Concat(facts.Where(row => row.DimensionKey is "focus" or "theme" or "course" or "course_level").Select(row => (Id: row.SourceRecordId, Label: row.SeriesLabel)));
            reportSections.Add(new("Configured selections", "All selected themes, course levels, historical courses and focus areas. Each entry counts once per selection.", [new("Selections", [], selections.Distinct().GroupBy(row => row.Label).OrderByDescending(group => group.Count()).ThenBy(group => group.Key).Select(group => new DashboardReportDistribution(group.Key, group.Count())).ToArray())]));
        }
        if (process is "learning_walk" or "als_learning_walk")
            reportSections.Add(new("Learning walk delivery areas", "Each form counts once. Wording follows the latest saved label for each delivery-area key.", [new("Delivery area", [], records.GroupBy(row => row.DeliveryAreaKey ?? "__not_recorded__").OrderBy(group => group.Key).Select(group => new DashboardReportDistribution(group.OrderByDescending(row => row.CreatedAt).First().DeliveryAreaName ?? "Not recorded", group.Count())).ToArray())]));
        if (configuration?.ShowActions != false)
            reportSections.Add(new("Actions", "Every action in the dashboard scope, with its owner, due date and completion state.", actions.Select(action => new DashboardReportItem(action.Title,
                [new("Theme", action.ActionTheme), new("Owner", action.OwnerStaffName), new("Status", action.CompletedDate.HasValue ? "Complete" : action.IsOverdue ? "Overdue" : "Open"), new("Due date", action.DueDate?.ToString("dd MMM yyyy")), new("Completed date", action.CompletedDate?.ToString("dd MMM yyyy"))])).ToArray()));

        if (process == "overview")
            reportSections.Add(new("Process mix", "All processes contributing to this dashboard.", [new("Records by process", [], records.GroupBy(row => row.ProcessKey).OrderBy(group => group.Key).Select(group => new DashboardReportDistribution(group.Key, group.Count())).ToArray())]));
        if (process is "overview" or "actions") reportSections.Add(DashboardExportScope.ActionAssurance(actions));
        if (process is not ("actions" or "elevate_status"))
            reportSections.Add(DashboardSubmissionExportBuilder.RecordDetails(records));
        // Keep source rows available alongside the form-shaped entry sheet; these are the exact dashboard inputs.
        if (process != "elevate_status")
        {
            extraSheets.Add(ObjectSheet("Dashboard record data", records));
            extraSheets.Add(ObjectSheet("Dashboard response data", facts));
            extraSheets.Add(ObjectSheet("Dashboard action data", actions));
        }
        // PDF sections mirror the expanded dashboard; raw form rows remain in Excel only.
        return data with { Filter = filter, DisplayName = configuration?.Label ?? data.DisplayName,
            Sheets = data.Sheets.Concat(extraSheets).ToArray(), Dashboard = new(metricsList, reportSections) };

        ExportWorkbookData DashboardMetadata() => new(module, ExportDisplayName(module), filter,
            user.DisplayName, DateTimeOffset.UtcNow, []);
    }

    private static string DashboardProcess(string module) => module switch
    { "dashboard-overview" => "overview", "elevate-status" => "elevate_status", "elevate-practice" => "eli", "coaching" => "coaching_session", "cpd" => "cpd_event", "probation" => "probation_case", "learning-walks" => "learning_walk", "als-learning-walks" => "als_learning_walk", "elevate-environments" => "elevate_environment", "work-scrutiny" => "work_scrutiny", "als-liv" => "als_liv", _ => module };
    private static DashboardReportMetric Metric(string label, long value) => new(label, value.ToString("N0", CultureInfo.InvariantCulture));

    private static ExportSheet ObjectSheet<T>(string name, IReadOnlyList<T> rows)
    {
        var properties = typeof(T).GetProperties();
        return new(name, properties.Select(property => System.Text.RegularExpressions.Regex.Replace(property.Name, "([a-z])([A-Z])", "$1 $2")).ToArray(),
            rows.Select(row => (IReadOnlyList<string?>)properties.Select(property => property.GetValue(row) is { } value ? FormatExportValue(value) : null).ToArray()).ToArray(), false,
            properties.Select(property => { var type = Nullable.GetUnderlyingType(property.PropertyType) ?? property.PropertyType; return type == typeof(DateOnly) ? "date" : type == typeof(DateTimeOffset) ? "datetime" : type == typeof(int) || type == typeof(long) || type == typeof(decimal) ? "number" : "text"; }).ToArray());
    }
}

public static class DashboardExportScope
{
    public static ProcessDashboardRecordSummary? ScopeCpd(ProcessDashboardRecordSummary record, ExportFilter filter, IReadOnlySet<string>? excludedCodes = null)
    {
        if (record.ProcessKey != "cpd_event") return record;
        var parts = (record.ParticipantAreaBreakdown ?? "").Split('|').Select(value => value.Split('~'))
            .Where(part => part.Length == 5 && part.Skip(2).All(value => int.TryParse(value, out var number) && number >= 0))
            .Where(part => excludedCodes?.Contains(part[0]) != true && excludedCodes?.Contains(part[1]) != true && Organisation(part[1], part[0], filter)).ToArray();
        if (parts.Length == 0)
        {
            if (!Organisation(record.AreaCode, record.ParentAreaCode, filter) || excludedCodes?.Contains(record.AreaCode ?? "") == true || excludedCodes?.Contains(record.ParentAreaCode ?? "") == true) return null;
            return record with { ParticipantAreaBreakdown = null, ParticipantCount = 0, AttendanceCredits = 0, LearningMinutes = 0 };
        }
        var area = parts.Length == 1 ? parts[0][1] : filter.TeamCode ?? filter.FacultyCode ?? "Multiple";
        return record with { OrgUnitId = null, AreaCode = area, AreaName = parts.Length == 1 ? area : filter.FacultyCode ?? "Multiple areas",
            ParentAreaCode = parts.Length == 1 ? parts[0][0] : filter.FacultyCode,
            ParticipantAreaBreakdown = string.Join('|', parts.Select(part => string.Join('~', part))),
            ParticipantCount = parts.Sum(part => int.Parse(part[2])), AttendanceCredits = parts.Sum(part => int.Parse(part[3])), LearningMinutes = parts.Sum(part => int.Parse(part[4])) };
    }

    public static bool Organisation(string? area, string? parent, ExportFilter filter)
    {
        var teams = Split(filter.TeamCode, ','); var faculties = Split(filter.FacultyCode, ',');
        return teams.Length > 0 ? teams.Contains(area) : faculties.Length == 0 || faculties.Contains(area) || faculties.Contains(parent);
    }
    public static ProcessDashboardRecordSummary[] Records(IReadOnlyList<ProcessDashboardRecordSummary> rows,
        IReadOnlyList<DashboardDimensionFactSummary> facts, string process, ExportFilter filter, IReadOnlyList<DashboardActionSummary>? actions = null)
    {
        var matchingDimensions = facts.Where(fact => fact.SeriesLabel == filter.DimensionLabel).Select(fact => fact.SourceRecordId).ToHashSet();
        if (process is "liv" or "als_liv")
            matchingDimensions.UnionWith(Actions(actions ?? [], process, filter with { Status = null, DeliveryAreaKey = null }, new HashSet<Guid>()).Where(action => action.SourceRecordId.HasValue).Select(action => action.SourceRecordId!.Value));
        return rows.Select(row => ScopeCpd(row, filter)).OfType<ProcessDashboardRecordSummary>().Where(row => process == "overview" || row.ProcessKey == process)
            .Where(row => !row.Status.Equals("draft", StringComparison.OrdinalIgnoreCase))
            .Where(row => (row.ProcessKey == "cpd_event" && row.ParticipantCount > 0) || Organisation(row.AreaCode, row.ParentAreaCode, filter))
            .Where(row => DateMatches(row.RecordDate ?? DateOnly.FromDateTime(row.CreatedAt.Date), filter))
            .Where(row => filter.Status is null || row.Status == filter.Status)
            .Where(row => filter.DimensionLabel is null || Split(row.Theme, '|').Contains(filter.DimensionLabel) || matchingDimensions.Contains(row.Id))
            .Where(row => filter.DeliveryAreaKey is null || (row.DeliveryAreaKey ?? "__not_recorded__") == filter.DeliveryAreaKey)
            .OrderByDescending(row => row.RecordDate ?? DateOnly.FromDateTime(row.CreatedAt.Date)).ThenBy(row => row.Id).ToArray();
    }
    public static DashboardActionSummary[] Actions(IReadOnlyList<DashboardActionSummary> rows, string process, ExportFilter filter, IReadOnlySet<Guid> recordIds)
    {
        var source = process switch { "eli" => "elevate_practice", "probation_case" => "probation_observation", "coaching_session" => "coaching_mentoring", _ => process };
        return rows.Where(row => !row.IsDeleted && (process is "overview" or "actions" || row.SourceFormType == source || (process == "cpd_event" && row.SourceFormType == "cpd")))
            .Where(row => Organisation(row.TeamCode, row.FacultyCode, filter) && DateMatches(DateOnly.FromDateTime(row.CreatedAt.Date), filter))
            .Where(row => filter.Status is null || (process is "liv" or "als_liv" ? row.SourceRecordId.HasValue && recordIds.Contains(row.SourceRecordId.Value) : filter.Status == (row.CompletedDate.HasValue ? "complete" : row.IsOverdue ? "overdue" : "open")))
            .Where(row => filter.DimensionLabel is null || row.ActionTheme == filter.DimensionLabel)
            .Where(row => filter.DeliveryAreaKey is null || row.SourceRecordId.HasValue && recordIds.Contains(row.SourceRecordId.Value))
            .OrderBy(row => row.DueDate).ThenBy(row => row.Id).ToArray();
    }
    public static DashboardDimensionFactSummary[] Facts(IReadOnlyList<DashboardDimensionFactSummary> facts, IReadOnlySet<Guid> ids, string process, ExportFilter filter)
    {
        var scoped = facts.Where(row => ids.Contains(row.SourceRecordId) && Organisation(row.AreaCode, row.ParentAreaCode, filter) && DateMatches(row.OccurredOn, filter)).ToArray();
        var areas = scoped.Where(row => (row.DimensionKey is "practice_area_outcome" or "scrutiny_section_outcome") && row.SeriesLabel == filter.DimensionLabel).Select(row => row.SeriesKey).ToHashSet();
        return scoped.Where(row => filter.DimensionLabel is null || row.SeriesLabel == filter.DimensionLabel || (process is "eli" or "work_scrutiny") && (row.DimensionKey is "practice_statement_outcome" or "scrutiny_statement_outcome") && areas.Contains(row.SeriesKey.Split("::")[0])).ToArray();
    }
    public static IReadOnlyList<RecordReportField> OutcomeFields(IEnumerable<DashboardDimensionFactSummary> source)
    {
        var rows = source.ToArray(); var scored = rows.Where(row => row.NumericValue.HasValue).ToArray(); var secure = scored.Count(row => row.NumericValue >= 3);
        return [new("Contributing entries", rows.Select(row => row.SourceRecordId).Distinct().Count().ToString()), new("Responses", rows.Length.ToString()),
            new("Average score", scored.Length == 0 ? "Not scored" : scored.Average(row => row.NumericValue!.Value).ToString("0.00")),
            new("Secure or above", scored.Length == 0 ? "Not scored" : $"{secure} of {scored.Length} ({100m * secure / scored.Length:0}%)")];
    }
    public static DashboardReportSection ActionAssurance(IReadOnlyList<DashboardActionSummary> actions)
    {
        var rows = actions.Where(row => row.StatusKey != "cancelled").ToArray();
        var complete = rows.Count(row => row.CompletedDate.HasValue || row.StatusKey == "complete");
        var active = rows.Where(row => !row.CompletedDate.HasValue && row.StatusKey != "complete").ToArray();
        var dated = rows.Where(row => row.DueDate.HasValue).ToArray(); var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var compliant = dated.Count(row => row.CompletedDate.HasValue ? row.CompletedDate <= row.DueDate : !row.IsOverdue);
        return new("Action assurance", "Cancelled actions are excluded from assurance measures.", [new("Action position", [new("Total", rows.Length.ToString()), new("Complete", complete.ToString()), new("In progress", active.Count(row => !row.IsOverdue).ToString()), new("Overdue", active.Count(row => row.IsOverdue).ToString()), new("Due in 14 days", active.Count(row => !row.IsOverdue && row.DueDate >= today && row.DueDate <= today.AddDays(14)).ToString()), new("Due-date compliance", dated.Length == 0 ? "No due dates" : $"{compliant} of {dated.Length} ({100m * compliant / dated.Length:0}%)")])]);
    }
    public static IReadOnlyList<DashboardReportItem> OrganisationItems(IReadOnlyList<ProcessDashboardRecordSummary> records, IReadOnlyList<DashboardDimensionFactSummary> facts, IReadOnlyList<DashboardActionSummary> actions, IReadOnlyList<StaffParticipationDashboardSummary> staff, IReadOnlyList<LivLifecycleDashboardSummary> lifecycle)
    {
        var areas = records.Select(row => (Area: row.AreaCode, Parent: row.ParentAreaCode)).Concat(facts.Select(row => (row.AreaCode, row.ParentAreaCode))).Concat(actions.Select(row => (row.TeamCode, row.FacultyCode))).Concat(staff.Select(row => (row.AreaCode, row.ParentAreaCode))).Concat(lifecycle.Select(row => (row.AreaCode, row.ParentAreaCode))).Distinct().ToArray();
        var groups = areas.Select(row => (Code: row.Item1 ?? "Unassigned", Faculty: false)).Concat(areas.Where(row => row.Item2 is not null).Select(row => (Code: row.Item2!, Faculty: true))).Distinct().OrderBy(row => row.Code).ThenByDescending(row => row.Faculty);
        return groups.Select(group => {
            bool Match(string? area, string? parent) => (area ?? "Unassigned") == group.Code || group.Faculty && parent == group.Code;
            var selected = records.Where(row => Match(row.AreaCode, row.ParentAreaCode)).ToArray();
            var ratings = facts.Where(row => Match(row.AreaCode, row.ParentAreaCode) && !row.DimensionKey.EndsWith("_statement_outcome")).ToArray();
            var selectedActions = actions.Where(row => Match(row.TeamCode, row.FacultyCode)).ToArray();
            var people = staff.Where(row => Match(row.AreaCode, row.ParentAreaCode)).ToArray();
            var journey = lifecycle.Where(row => Match(row.AreaCode, row.ParentAreaCode)).ToArray();
            var fields = new List<RecordReportField> {new("Records", selected.Length.ToString()), new("Completed records", selected.Count(row => Completed(row.Status)).ToString()), new("Open actions", selectedActions.Count(row => !row.CompletedDate.HasValue).ToString()), new("Overdue actions", selectedActions.Count(row => !row.CompletedDate.HasValue && row.IsOverdue).ToString())};
            fields.AddRange(OutcomeFields(ratings).Where(field => field.Label is "Average score" or "Secure or above"));
            if (people.Length > 0) { fields.Add(new("Active staff", people.Sum(row => row.ActiveStaffCount).ToString())); fields.Add(new("Participating staff", people.Sum(row => row.ParticipatingStaffCount).ToString())); }
            if (journey.Length > 0) { fields.Add(new("Visits completed", journey.Sum(row => row.VisitedCount).ToString())); fields.Add(new("Elevate practitioners", journey.Sum(row => row.PractitionerStaffCount).ToString())); }
            return new DashboardReportItem($"{(group.Faculty ? "Faculty" : "Team")}: {group.Code}", fields);
        }).ToArray();
    }
    public static bool Completed(string value) => new[] { "completed", "submitted", "closed" }.Contains(value.ToLowerInvariant());
    public static bool DateMatches(DateOnly date, ExportFilter filter) => (!filter.FromDate.HasValue || date >= filter.FromDate) && (!filter.ToDate.HasValue || date <= filter.ToDate);
    private static string[] Split(string? value, char delimiter) => value?.Split(delimiter, StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries) ?? [];
    public static IReadOnlyList<DashboardReportDistribution> Trend(IEnumerable<DateOnly> dates, ExportFilter filter)
    {
        var all = dates.Order().ToArray();
        if (all.Length == 0 && (!filter.FromDate.HasValue || !filter.ToDate.HasValue)) return [];
        var from = filter.FromDate ?? all[0]; var to = filter.ToDate ?? all[^1];
        var days = to.DayNumber - from.DayNumber + 1;
        var interval = !filter.FromDate.HasValue && !filter.ToDate.HasValue ? "month" : days <= 31 ? "day" : days <= 120 ? "week" : "month";
        DateOnly Key(DateOnly date) => interval == "month" ? new(date.Year, date.Month, 1) : interval == "week" ? date.AddDays(-(((int)date.DayOfWeek + 6) % 7)) : date;
        var counts = all.GroupBy(Key).ToDictionary(group => group.Key, group => group.Count());
        if (interval != "month") for (var date = Key(from); date <= Key(to); date = date.AddDays(interval == "week" ? 7 : 1)) counts.TryAdd(date, 0);
        return counts.OrderBy(pair => pair.Key).Select(pair => new DashboardReportDistribution(
            interval == "month" ? pair.Key.ToString("MMM yyyy", CultureInfo.InvariantCulture) : (interval == "week" ? "w/c " : "") + pair.Key.ToString("dd MMM yyyy", CultureInfo.InvariantCulture), pair.Value)).ToArray();
    }
    public static IReadOnlyList<DashboardReportMetric> Metrics(string process, IReadOnlyList<ProcessDashboardRecordSummary> records,
        IReadOnlyList<DashboardDimensionFactSummary> facts, IReadOnlyList<DashboardActionSummary> actions)
    {
        DashboardReportMetric Count(string label, long count) => new(label, count.ToString("N0", CultureInfo.InvariantCulture));
        var metrics = new List<DashboardReportMetric> { Count(process == "actions" ? "Actions raised" : "Records in view", process == "actions" ? actions.Count : records.Count),
            Count("Completed records", records.Count(row => Completed(row.Status))), Count("Open actions", actions.Count(row => !row.CompletedDate.HasValue)), Count("Overdue actions", actions.Count(row => !row.CompletedDate.HasValue && row.IsOverdue)) };
        var numeric = facts.Where(fact => !fact.DimensionKey.EndsWith("_statement_outcome") && fact.NumericValue.HasValue).ToArray();
        if (process != "overview" && numeric.Length > 0) metrics.Add(new("Secure practice or above", $"{100m * numeric.Count(fact => fact.NumericValue >= 3) / numeric.Length:0}%"));
        if (process is "learning_walk" or "als_learning_walk") metrics.Add(Count("Focus selections", facts.Where(fact => fact.DimensionKey == "focus").Select(fact => (fact.SourceRecordId, fact.SeriesKey)).Distinct().Count()));
        if (process == "work_scrutiny") metrics.Add(Count("Learner work samples", records.Sum(row => row.SampleSize)));
        if (process == "elevate_environment") metrics.Add(Count("Barriers identified", records.Sum(row => row.BarrierCount)));
        if (process == "cpd_event") { metrics.Add(Count("Attendances", records.Sum(row => row.ParticipantCount))); metrics.Add(new("Learning hours", (records.Sum(row => row.LearningMinutes) / 60m).ToString("0.0", CultureInfo.InvariantCulture))); }
        if (process == "overview") { metrics.RemoveAll(metric => metric.Label == "Completed records"); metrics.Add(new("Completed or submitted activity", $"{records.Count(row => Completed(row.Status))} of {records.Count}")); metrics.Add(Count("Teams represented", records.Where(row => !string.IsNullOrWhiteSpace(row.AreaCode) && !string.IsNullOrWhiteSpace(row.ParentAreaCode) && row.AreaCode != row.ParentAreaCode).Select(row => row.AreaCode).Distinct().Count())); }
        if (process == "eli") metrics.Add(Count("Areas assessed", facts.Where(row => row.DimensionKey == "practice_area_outcome").Select(row => row.SeriesKey).Distinct().Count()));
        if (process == "probation_case") { var stages = records.GroupBy(row => row.SubjectStaffId?.ToString() ?? row.SubjectDisplayName ?? row.Id.ToString()).Select(group => group.Max(row => row.SampleSize)).ToArray(); for (var stage = 1; stage <= 3; stage++) metrics.Add(Count($"Staff with at least {stage} observation(s)", stages.Count(value => value >= stage))); }
        if (process is "coaching_session" or "work_scrutiny") metrics.Add(Count(process == "work_scrutiny" ? "Levels / courses represented" : "Focus areas used", facts.Where(row => !row.DimensionKey.EndsWith("outcome")).Select(row => row.SeriesLabel).Concat(records.SelectMany(row => Split(row.Theme, '|'))).Distinct().Count()));
        return metrics;
    }
}
