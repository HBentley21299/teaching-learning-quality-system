using System.Text.Json;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Security;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    private static readonly DashboardProcessConfigurationSummary[] DefaultDashboardProcesses =
    [
        new("overview", "Executive overview", true, 10, "bar", true, true, true, true),
        new("learning_walk", "Learning Walks", true, 20, "bar", true, true, true, true),
        new("liv", "LIV", true, 30, "bar", true, true, true, true),
        new("eli", "Elevate Learning and Innovation", true, 40, "bar", true, true, true, false),
        new("probation_case", "Probationary Observations", true, 50, "bar", true, true, true, true),
        new("elevate_environment", "Elevate Environments", true, 60, "bar", true, true, true, true),
        new("coaching_session", "Coaching and Mentoring", true, 70, "donut", true, true, true, true),
        new("work_scrutiny", "Work Scrutiny", true, 80, "bar", true, true, true, true),
        new("cpd_event", "CPD", true, 90, "bar", true, true, true, false),
        new("elevate_status", "Elevate Status", true, 100, "bar", false, true, true, false),
        new("actions", "Actions", true, 110, "donut", true, true, true, true)
    ];

    private static readonly HashSet<string> DashboardVisualTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "bar", "donut"
    };

    public async Task<DashboardConfigurationSummary> GetDashboardConfigurationAsync(CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var command = new SqlCommand(
            """
            SELECT TOP (1) config_json, updated_at
            FROM reporting.dashboards
            WHERE dashboard_key = N'tl_overview'
              AND is_active = 1
              AND archived_at IS NULL;
            """, connection);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return new DashboardConfigurationSummary(2, null, DefaultDashboardProcesses);
        }

        var json = reader.IsDBNull(0) ? null : reader.GetString(0);
        var updatedAt = reader.IsDBNull(1) ? (DateTimeOffset?)null : reader.GetFieldValue<DateTimeOffset>(1);
        return new DashboardConfigurationSummary(2, updatedAt, MergeDashboardConfiguration(ParseDashboardProcesses(json)));
    }

    public async Task SaveDashboardConfigurationAsync(
        SaveDashboardConfigurationRequest request,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        var normalized = NormalizeDashboardConfiguration(request.Processes);
        var json = JsonSerializer.Serialize(new { schemaVersion = 2, processes = normalized });

        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var command = new SqlCommand(
            """
            UPDATE reporting.dashboards
            SET config_json = @configurationJson,
                updated_at = sysutcdatetime()
            WHERE dashboard_key IN (N'tl_overview', N'faculty_dashboard')
              AND archived_at IS NULL;
            """, connection);
        command.Parameters.AddWithValue("@configurationJson", json);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public Task<IReadOnlyList<DashboardDimensionFactSummary>> GetDashboardDimensionFactsAsync(
        CurrentUser currentUser,
        CancellationToken cancellationToken) =>
        QueryAsync(
            """
            CREATE TABLE #visible_records (
                id uniqueidentifier NOT NULL PRIMARY KEY,
                record_type nvarchar(100) NOT NULL,
                occurred_on date NOT NULL,
                org_unit_id uniqueidentifier NULL,
                area_code nvarchar(100) NULL,
                area_name nvarchar(200) NULL,
                parent_area_code nvarchar(100) NULL
            );

            IF @canViewAll = 1
            BEGIN
                INSERT #visible_records (id, record_type, occurred_on, org_unit_id, area_code, area_name, parent_area_code)
                SELECT record.id, record.record_type, COALESCE(record.record_date, CONVERT(date, record.created_at)),
                       COALESCE(record.org_unit_id, subject_staff.primary_org_unit_id, owner_staff.primary_org_unit_id),
                       org_unit.code, org_unit.name, parent_org.code
                FROM core.records record
                LEFT JOIN people.staff subject_staff ON subject_staff.id = record.subject_staff_id
                LEFT JOIN people.staff owner_staff ON owner_staff.id = record.owner_staff_id
                LEFT JOIN org.org_units org_unit ON org_unit.id = COALESCE(record.org_unit_id, subject_staff.primary_org_unit_id, owner_staff.primary_org_unit_id)
                LEFT JOIN org.org_units parent_org ON parent_org.id = org_unit.parent_org_unit_id
                WHERE record.archived_at IS NULL;
            END
            ELSE
            BEGIN
                INSERT #visible_records (id, record_type, occurred_on, org_unit_id, area_code, area_name, parent_area_code)
                SELECT record.id, record.record_type, COALESCE(record.record_date, CONVERT(date, record.created_at)),
                       COALESCE(record.org_unit_id, subject_staff.primary_org_unit_id, owner_staff.primary_org_unit_id),
                       org_unit.code, org_unit.name, parent_org.code
                FROM core.records record
                LEFT JOIN people.staff subject_staff ON subject_staff.id = record.subject_staff_id
                LEFT JOIN people.staff owner_staff ON owner_staff.id = record.owner_staff_id
                LEFT JOIN org.org_units org_unit ON org_unit.id = COALESCE(record.org_unit_id, subject_staff.primary_org_unit_id, owner_staff.primary_org_unit_id)
                LEFT JOIN org.org_units parent_org ON parent_org.id = org_unit.parent_org_unit_id
                WHERE record.archived_at IS NULL
                  AND (
                        record.owner_staff_id = @currentStaffId
                        OR record.subject_staff_id = @currentStaffId
                        OR (@canViewScopedActivities = 1 AND (
                            EXISTS (SELECT 1 FROM org.fn_visible_org_units(@currentUserAccountId) unit WHERE unit.org_unit_id = COALESCE(record.org_unit_id, subject_staff.primary_org_unit_id, owner_staff.primary_org_unit_id))
                            OR EXISTS (SELECT 1 FROM org.fn_visible_staff(@currentUserAccountId) staff WHERE staff.staff_id = record.subject_staff_id)
                            OR EXISTS (SELECT 1 FROM org.fn_visible_staff(@currentUserAccountId) staff WHERE staff.staff_id = record.owner_staff_id)
                        ))
                  );
            END;

            CREATE TABLE #facts (
                id uniqueidentifier NOT NULL,
                process_key nvarchar(100) NOT NULL,
                occurred_on date NOT NULL,
                org_unit_id uniqueidentifier NULL,
                area_code nvarchar(100) NULL,
                area_name nvarchar(200) NULL,
                parent_area_code nvarchar(100) NULL,
                dimension_key nvarchar(100) NOT NULL,
                series_key nvarchar(100) NOT NULL,
                series_label nvarchar(300) NOT NULL,
                value_key nvarchar(100) NOT NULL,
                value_label nvarchar(300) NOT NULL,
                numeric_value decimal(10,2) NULL
            );

            INSERT #facts
                SELECT record.id, N'learning_walk' process_key, record.occurred_on, record.org_unit_id,
                       record.area_code, record.area_name, record.parent_area_code,
                       N'focus' dimension_key, CONVERT(nvarchar(80), theme.theme_id) series_key,
                       theme.theme_name_snapshot series_label, CONVERT(nvarchar(80), theme.theme_id) value_key,
                       theme.theme_name_snapshot value_label, CONVERT(decimal(10,2), NULL) numeric_value
                FROM #visible_records record
                JOIN quality.learning_walk_record_themes theme ON theme.record_id = record.id
                WHERE record.record_type = N'learning_walk'

                ;

            INSERT #facts

                SELECT record.id, N'learning_walk', record.occurred_on, record.org_unit_id,
                       record.area_code, record.area_name, record.parent_area_code,
                       N'focus_outcome', rating.focus_id, rating.focus_name, CONVERT(nvarchar(20), rating.score),
                       rating.rating, rating.score
                FROM #visible_records record
                JOIN forms.form_submissions submission ON submission.record_id = record.id AND submission.archived_at IS NULL
                JOIN forms.form_responses response ON response.form_submission_id = submission.id AND response.archived_at IS NULL
                JOIN forms.form_fields field ON field.id = response.form_field_id AND field.field_key = N'focus_rubric_ratings'
                CROSS APPLY OPENJSON(CASE WHEN ISJSON(response.response_text) = 1 THEN response.response_text ELSE N'[]' END)
                WITH (
                    focus_id nvarchar(80) '$.focusId',
                    focus_name nvarchar(300) '$.focusName',
                    score decimal(10,2) '$.score',
                    rating nvarchar(200) '$.rating'
                ) rating
                WHERE record.record_type = N'learning_walk'

                ;

            INSERT #facts

                SELECT record.id, N'liv', COALESCE(visit.visit_date, record.occurred_on), record.org_unit_id,
                       record.area_code, record.area_name, record.parent_area_code,
                       N'focus_outcome', focus.value_key, focus.display_name, descriptor.descriptor_key,
                       descriptor.visible_wording, rating.hidden_numeric_value
                FROM #visible_records record
                JOIN quality.liv_records liv ON liv.record_id = record.id AND liv.archived_at IS NULL
                JOIN quality.liv_visits visit ON visit.liv_record_id = liv.id AND visit.archived_at IS NULL
                JOIN quality.liv_visit_ratings rating ON rating.visit_id = visit.id AND rating.is_not_applicable = 0
                JOIN core.lookup_values focus ON focus.id = rating.focus_lookup_value_id
                JOIN quality.elevate_practice_rubric_descriptors descriptor ON descriptor.id = rating.descriptor_id
                WHERE record.record_type = N'liv'

                ;

            INSERT #facts

                SELECT record.id, N'eli', record.occurred_on, record.org_unit_id,
                       record.area_code, record.area_name, record.parent_area_code,
                       N'practice_area_outcome', area.area_key, area.name, descriptor.descriptor_key,
                       descriptor.visible_wording, rating.hidden_numeric_value
                FROM #visible_records record
                JOIN quality.elevate_practice_assessments assessment ON assessment.record_id = record.id AND assessment.archived_at IS NULL
                JOIN quality.elevate_practice_area_ratings rating ON rating.assessment_id = assessment.id
                JOIN quality.elevate_practice_areas area ON area.id = rating.area_id
                JOIN quality.elevate_practice_rubric_descriptors descriptor ON descriptor.id = rating.descriptor_id
                WHERE record.record_type = N'elevate_practice_assessment' AND assessment.status = N'submitted'

                ;

            INSERT #facts

                SELECT record.id, N'elevate_environment', record.occurred_on, record.org_unit_id,
                       record.area_code, record.area_name, record.parent_area_code,
                       N'pillar_outcome', rating.pillar_key, pillar.name, rating.judgement_key,
                       rating.judgement_label_snapshot, rating.numerical_score
                FROM #visible_records record
                JOIN quality.elevate_environment_pillar_ratings rating ON rating.record_id = record.id
                JOIN quality.elevate_environment_pillars pillar ON pillar.pillar_key = rating.pillar_key AND pillar.archived_at IS NULL
                WHERE record.record_type = N'elevate_environment'

                ;

            INSERT #facts

                SELECT record.id, N'probation_case', COALESCE(visit.observation_date, record.occurred_on), record.org_unit_id,
                       record.area_code, record.area_name, record.parent_area_code,
                       N'focus_outcome', focus.value_key, focus.display_name, descriptor.descriptor_key,
                       descriptor.visible_wording, rating.hidden_numeric_value
                FROM #visible_records record
                JOIN quality.probation_cases probation_case ON probation_case.record_id = record.id AND probation_case.archived_at IS NULL
                JOIN quality.probation_observations observation ON observation.probation_case_id = probation_case.id
                JOIN quality.probation_observation_ratings rating ON rating.probation_observation_id = observation.id
                LEFT JOIN quality.probation_observation_visits visit ON visit.probation_observation_id = observation.id
                JOIN core.lookup_values focus ON focus.id = rating.focus_lookup_value_id
                JOIN quality.elevate_practice_rubric_descriptors descriptor ON descriptor.id = rating.descriptor_id

                ;

            INSERT #facts

                SELECT record.id, N'coaching_session', record.occurred_on, record.org_unit_id,
                       record.area_code, record.area_name, record.parent_area_code,
                       N'focus', focus.value_key, focus.display_name, focus.value_key,
                       focus.display_name, CONVERT(decimal(10,2), NULL)
                FROM #visible_records record
                JOIN quality.coaching_sessions session ON session.record_id = record.id AND session.archived_at IS NULL
                CROSS APPLY (VALUES (session.primary_focus_lookup_value_id), (session.secondary_focus_lookup_value_id)) selected_focus(focus_id)
                JOIN core.lookup_values focus ON focus.id = selected_focus.focus_id
                WHERE record.record_type = N'coaching_session'

                ;

            INSERT #facts

                SELECT record.id, N'coaching_session', record.occurred_on, record.org_unit_id,
                       record.area_code, record.area_name, record.parent_area_code,
                       N'current_practice', N'current_practice', N'Current practice',
                       COALESCE(descriptor.descriptor_key, CONVERT(nvarchar(80), session.current_practice_hidden_score)),
                       COALESCE(session.current_practice_wording_snapshot, descriptor.visible_wording, N'Not recorded'),
                       session.current_practice_hidden_score
                FROM #visible_records record
                JOIN quality.coaching_sessions session ON session.record_id = record.id AND session.archived_at IS NULL
                LEFT JOIN quality.elevate_practice_rubric_descriptors descriptor ON descriptor.id = session.current_practice_descriptor_id
                WHERE record.record_type = N'coaching_session' AND session.current_practice_hidden_score IS NOT NULL

                ;

            INSERT #facts

                SELECT record.id, N'cpd_event', record.occurred_on, record.org_unit_id,
                       record.area_code, record.area_name, record.parent_area_code,
                       N'theme', theme.value_key, theme.display_name, theme.value_key,
                       theme.display_name, CONVERT(decimal(10,2), NULL)
                FROM #visible_records record
                JOIN cpd.cpd_events event ON event.record_id = record.id AND event.archived_at IS NULL
                JOIN core.lookup_values theme ON theme.id = event.theme_lookup_value_id
                WHERE record.record_type = N'cpd_event'

                ;

            INSERT #facts

                SELECT record.id, N'work_scrutiny', record.occurred_on, record.org_unit_id,
                       record.area_code, record.area_name, record.parent_area_code,
                       N'course', CONVERT(nvarchar(80), course.id), course.course_code,
                       CONVERT(nvarchar(80), course.id), course.course_code, CONVERT(decimal(10,2), NULL)
                FROM #visible_records record
                JOIN quality.work_scrutiny_course_samples sample ON sample.record_id = record.id
                JOIN curriculum.courses course ON course.id = sample.course_id
                WHERE record.record_type = N'work_scrutiny';

            SELECT id, process_key, occurred_on, org_unit_id, area_code, area_name, parent_area_code,
                   dimension_key, series_key, series_label, value_key, value_label, numeric_value
            FROM #facts
            ORDER BY occurred_on DESC, process_key, dimension_key, series_label;
            """,
            command => AddScopeParameters(command, currentUser),
            reader => new DashboardDimensionFactSummary(
                reader.GetGuid(0),
                reader.GetString(1),
                reader.GetFieldValue<DateOnly>(2),
                GetGuidOrNull(reader, 3),
                GetStringOrNull(reader, 4),
                GetStringOrNull(reader, 5),
                GetStringOrNull(reader, 6),
                reader.GetString(7),
                reader.GetString(8),
                reader.GetString(9),
                reader.GetString(10),
                reader.GetString(11),
                reader.IsDBNull(12) ? null : reader.GetDecimal(12)),
            cancellationToken);

    public Task<IReadOnlyList<ElevateStatusDashboardSummary>> GetElevateStatusDashboardAsync(
        string academicYear,
        CurrentUser currentUser,
        CancellationToken cancellationToken) =>
        QueryAsync(
            """
            WITH eligible_staff AS (
                SELECT staff.id, staff.primary_org_unit_id,
                       org_unit.code area_code, org_unit.name area_name,
                       parent_org.code parent_area_code
                FROM people.staff staff
                LEFT JOIN org.org_units org_unit ON org_unit.id = staff.primary_org_unit_id
                LEFT JOIN org.org_units parent_org ON parent_org.id = org_unit.parent_org_unit_id
                WHERE staff.archived_at IS NULL
                  AND staff.account_status = N'active'
                  AND (staff.end_date IS NULL OR staff.end_date >= CONVERT(date, sysutcdatetime()))
                  AND (
                        @canViewAll = 1
                        OR EXISTS (
                            SELECT 1
                            FROM org.fn_visible_staff(@currentUserAccountId) visible
                            WHERE visible.staff_id = staff.id
                        )
                  )
            ),
            highest_award AS (
                SELECT award.staff_id, MAX(CONVERT(int, award.level_number)) level_number
                FROM cpd.elevate_status_awards award
                WHERE award.academic_year_key = @academicYear
                  AND award.archived_at IS NULL
                GROUP BY award.staff_id
            )
            SELECT eligible.primary_org_unit_id, eligible.area_code, eligible.area_name,
                   eligible.parent_area_code, COUNT_BIG(*) staff_count,
                   SUM(CASE WHEN COALESCE(award.level_number, 0) >= 1 THEN 1 ELSE 0 END) level_1_or_above,
                   SUM(CASE WHEN COALESCE(award.level_number, 0) >= 2 THEN 1 ELSE 0 END) level_2_or_above,
                   SUM(CASE WHEN COALESCE(award.level_number, 0) >= 3 THEN 1 ELSE 0 END) level_3_or_above,
                   SUM(CASE WHEN COALESCE(award.level_number, 0) >= 4 THEN 1 ELSE 0 END) level_4_or_above,
                   SUM(CASE WHEN COALESCE(award.level_number, 0) >= 5 THEN 1 ELSE 0 END) level_5_or_above
            FROM eligible_staff eligible
            LEFT JOIN highest_award award ON award.staff_id = eligible.id
            GROUP BY eligible.primary_org_unit_id, eligible.area_code, eligible.area_name, eligible.parent_area_code
            ORDER BY eligible.area_name, eligible.area_code;
            """,
            command =>
            {
                AddScopeParameters(command, currentUser);
                command.Parameters.AddWithValue("@academicYear", academicYear);
            },
            reader => new ElevateStatusDashboardSummary(
                GetGuidOrNull(reader, 0),
                GetStringOrNull(reader, 1),
                GetStringOrNull(reader, 2),
                GetStringOrNull(reader, 3),
                reader.GetInt64(4),
                reader.GetInt32(5),
                reader.GetInt32(6),
                reader.GetInt32(7),
                reader.GetInt32(8),
                reader.GetInt32(9)),
            cancellationToken);

    private static IReadOnlyList<DashboardProcessConfigurationSummary> ParseDashboardProcesses(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try
        {
            using var document = JsonDocument.Parse(json);
            if (!document.RootElement.TryGetProperty("processes", out var processes)) return [];
            return JsonSerializer.Deserialize<List<DashboardProcessConfigurationSummary>>(
                processes.GetRawText(),
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private static IReadOnlyList<DashboardProcessConfigurationSummary> MergeDashboardConfiguration(
        IReadOnlyList<DashboardProcessConfigurationSummary> configured)
    {
        var byKey = configured.ToDictionary(item => item.ProcessKey, StringComparer.OrdinalIgnoreCase);
        return DefaultDashboardProcesses
            .Select(item => byKey.TryGetValue(item.ProcessKey, out var saved)
                ? NormalizeDashboardProcess(saved, item)
                : item)
            .OrderBy(item => item.DisplayOrder)
            .ToArray();
    }

    private static IReadOnlyList<DashboardProcessConfigurationSummary> NormalizeDashboardConfiguration(
        IReadOnlyList<DashboardProcessConfigurationSummary>? configured)
    {
        var supplied = configured ?? [];
        var byKey = supplied
            .Where(item => DefaultDashboardProcesses.Any(defaultItem => defaultItem.ProcessKey.Equals(item.ProcessKey, StringComparison.OrdinalIgnoreCase)))
            .GroupBy(item => item.ProcessKey, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.OrdinalIgnoreCase);

        return DefaultDashboardProcesses
            .Select((item, index) => byKey.TryGetValue(item.ProcessKey, out var saved)
                ? NormalizeDashboardProcess(saved with { DisplayOrder = Math.Clamp(saved.DisplayOrder, 1, 1000) }, item)
                : item with { DisplayOrder = (index + 1) * 10 })
            .OrderBy(item => item.DisplayOrder)
            .Select((item, index) => item with { DisplayOrder = (index + 1) * 10 })
            .ToArray();
    }

    private static DashboardProcessConfigurationSummary NormalizeDashboardProcess(
        DashboardProcessConfigurationSummary saved,
        DashboardProcessConfigurationSummary fallback) =>
        fallback with
        {
            Label = string.IsNullOrWhiteSpace(saved.Label) ? fallback.Label : saved.Label.Trim()[..Math.Min(saved.Label.Trim().Length, 80)],
            IsEnabled = fallback.ProcessKey == "overview" || saved.IsEnabled,
            DisplayOrder = saved.DisplayOrder,
            PrimaryVisual = DashboardVisualTypes.Contains(saved.PrimaryVisual) ? saved.PrimaryVisual.ToLowerInvariant() : fallback.PrimaryVisual,
            ShowTrend = saved.ShowTrend,
            ShowAreaComparison = saved.ShowAreaComparison,
            ShowOutcomes = saved.ShowOutcomes,
            ShowActions = saved.ShowActions
        };
}
