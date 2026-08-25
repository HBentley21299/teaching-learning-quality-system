using System.Globalization;
using System.Diagnostics;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    internal const int InteractiveExportRowLimit = 25_000;

    public async Task<ExportWorkbookData> GetExportWorkbookAsync(
        string moduleKey,
        ExportFilter filter,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        var normalizedKey = NormalizeExportModuleKey(moduleKey);
        await using var connection = await OpenConnectionAsync(cancellationToken);
        var sheets = (normalizedKey switch
        {
            "staff" => await BuildStaffExportAsync(connection, filter, currentUser, cancellationToken),
            "dashboard-overview" => await BuildGenericRecordExportAsync(connection, null, "Dashboard Records", filter, currentUser, cancellationToken),
            "elevate-status" => await BuildElevateStatusExportAsync(connection, filter, currentUser, cancellationToken),
            "actions" => await BuildActionExportAsync(connection, filter, currentUser, cancellationToken),
            "cpd" => await BuildCpdExportAsync(connection, filter, currentUser, cancellationToken),
            "coaching" => await BuildCoachingExportAsync(connection, filter, currentUser, cancellationToken),
            "reflections" => await BuildReflectionExportAsync(connection, filter, currentUser, cancellationToken),
            "liv" => await BuildLivExportAsync(connection, filter, currentUser, cancellationToken, "liv"),
            "als-liv" => await BuildLivExportAsync(connection, filter, currentUser, cancellationToken, "als_liv"),
            "elevate-practice" => await BuildElevatePracticeExportAsync(connection, filter, currentUser, cancellationToken),
            "learning-walks" => await BuildGenericRecordExportAsync(connection, "learning_walk", "Learning Walks", filter, currentUser, cancellationToken),
            "als-learning-walks" => await BuildGenericRecordExportAsync(connection, "als_learning_walk", "ALS Learning Walks", filter, currentUser, cancellationToken),
            "work-scrutiny" => await BuildGenericRecordExportAsync(connection, "work_scrutiny", "Work Scrutiny", filter, currentUser, cancellationToken),
            "elevate-environments" => await BuildElevateEnvironmentExportAsync(connection, filter, currentUser, cancellationToken),
            "probation" => await BuildProbationExportAsync(connection, filter, currentUser, cancellationToken),
            _ => throw new WorkflowValidationException("Select a supported export area.")
        }).ToList();
        var questionRecordType = DashboardQuestionRecordType(normalizedKey);
        if (questionRecordType is not null || normalizedKey == "dashboard-overview")
        {
            var questionResults = await BuildQuestionLevelResultsAsync(
                connection, questionRecordType, filter, currentUser, cancellationToken);
            if (questionResults.Rows.Count > 0)
            {
                var existingIndex = sheets.FindIndex(sheet =>
                    string.Equals(sheet.Name, questionResults.Name, StringComparison.OrdinalIgnoreCase));
                if (existingIndex >= 0) sheets[existingIndex] = questionResults;
                else sheets.Add(questionResults);
            }
        }
        return new ExportWorkbookData(
            normalizedKey, ExportDisplayName(normalizedKey), filter,
            currentUser.DisplayName, DateTimeOffset.UtcNow, sheets);
    }

    private async Task<ExportSheet> BuildQuestionLevelResultsAsync(
        SqlConnection connection,
        string? recordType,
        ExportFilter filter,
        CurrentUser user,
        CancellationToken cancellationToken) =>
        await ReadExportSheetAsync(connection, "Question-Level Results", $"""
            {ScopedRecordsCte}
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), record_row.id) AS [Record ID],
                   record_row.title AS [Record title], record_row.record_type AS [Process],
                   COALESCE(status_value.display_name, status_value.value_key, N'Draft') AS [Record status],
                   record_row.record_date AS [Record date], record_row.academic_year_key AS [Academic year],
                   faculty.code AS [Faculty code], faculty.name AS [Faculty],
                   team.code AS [Team code], team.name AS [Team],
                   subject.display_name AS [Staff member], owner.display_name AS [Reviewer or owner],
                   submission.status AS [Form status], section.title AS [Section],
                   CONCAT(field.field_key, CASE WHEN expanded.item_key IS NULL THEN N'' ELSE CONCAT(N':', expanded.item_key COLLATE DATABASE_DEFAULT) END) AS [Question key],
                   CONCAT(field.label, CASE WHEN expanded.item_label IS NULL THEN N'' ELSE CONCAT(N' - ', expanded.item_label COLLATE DATABASE_DEFAULT) END) AS [Question],
                   field.field_type AS [Response type],
                   CASE WHEN expanded.item_key IS NOT NULL OR expanded.item_label IS NOT NULL
                        THEN expanded.item_response COLLATE DATABASE_DEFAULT
                        ELSE COALESCE(response.response_text, CONVERT(nvarchar(100), response.response_number),
                             CONVERT(nvarchar(30), response.response_date, 23), lookup_value.display_name,
                             response.response_json) END AS [Response],
                   response.updated_at AS [Response updated at]
            FROM scoped_records record_row
            LEFT JOIN core.lookup_values status_value ON status_value.id = record_row.status_lookup_value_id
            LEFT JOIN people.staff subject ON subject.id = record_row.subject_staff_id
            LEFT JOIN people.staff owner ON owner.id = record_row.owner_staff_id
            LEFT JOIN org.org_units area ON area.id = record_row.org_unit_id
            LEFT JOIN org.org_units faculty ON faculty.id = CASE WHEN area.parent_org_unit_id IS NULL THEN area.id ELSE area.parent_org_unit_id END
            LEFT JOIN org.org_units team ON team.id = CASE WHEN area.parent_org_unit_id IS NOT NULL THEN area.id ELSE NULL END
            JOIN forms.form_submissions submission ON submission.record_id = record_row.id AND submission.archived_at IS NULL
            JOIN forms.form_responses response ON response.form_submission_id = submission.id AND response.archived_at IS NULL
            JOIN forms.form_fields field ON field.id = response.form_field_id
            JOIN forms.form_sections section ON section.id = field.form_section_id
            LEFT JOIN core.lookup_values lookup_value ON lookup_value.id = response.response_lookup_value_id
            OUTER APPLY (
                SELECT COALESCE(response.response_json,
                    CASE WHEN ISJSON(response.response_text) = 1 THEN response.response_text END) AS json_value
            ) json_source
            OUTER APPLY (
                SELECT CAST(NULL AS nvarchar(200)) AS item_key,
                       CAST(NULL AS nvarchar(500)) AS item_label,
                       CAST(NULL AS nvarchar(max)) AS item_response,
                       0 AS item_order
                WHERE LEFT(LTRIM(COALESCE(json_source.json_value, N'')), 1) <> N'['
                   OR json_source.json_value = N'[]'
                UNION ALL
                SELECT COALESCE(JSON_VALUE(item.[value], N'$.focusId'), JSON_VALUE(item.[value], N'$.id'), item.[key]),
                       COALESCE(JSON_VALUE(item.[value], N'$.focusName'), JSON_VALUE(item.[value], N'$.name'), JSON_VALUE(item.[value], N'$.label')),
                       COALESCE(
                           NULLIF(CONCAT(
                               JSON_VALUE(item.[value], N'$.rating'),
                               CASE WHEN JSON_VALUE(item.[value], N'$.score') IS NULL THEN N''
                                    ELSE CONCAT(N' (', JSON_VALUE(item.[value], N'$.score'), N')') END), N''),
                           JSON_VALUE(item.[value], N'$.value'),
                           item.[value]),
                       TRY_CONVERT(int, item.[key]) + 1
                FROM OPENJSON(json_source.json_value) item
                WHERE LEFT(LTRIM(COALESCE(json_source.json_value, N'')), 1) = N'['
            ) expanded
            ORDER BY record_row.record_date DESC, record_row.created_at DESC,
                     section.display_order, field.display_order, expanded.item_order;
            """, command => AddExportParameters(command, user, filter, recordType), cancellationToken);

    public async Task<RecordReportData?> GetRecordReportAsync(
        Guid recordId,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var command = new SqlCommand(
            """
            WITH visible_staff AS (SELECT staff_id FROM org.fn_visible_staff(@currentUserAccountId)),
                 visible_org AS (SELECT org_unit_id FROM org.fn_visible_org_units(@currentUserAccountId))
            SELECT record_row.id, record_row.title, record_row.record_type,
                   COALESCE(status_value.display_name, status_value.value_key, N'Draft'),
                   subject.display_name, reviewer.display_name,
                   COALESCE(record_row.org_unit_name_snapshot, unit.name), record_row.academic_year_key, record_row.record_date,
                   record_row.created_at, COALESCE(creator.display_name, N'System')
            FROM core.records record_row
            LEFT JOIN core.lookup_values status_value ON status_value.id = record_row.status_lookup_value_id
            LEFT JOIN people.staff subject ON subject.id = record_row.subject_staff_id
            LEFT JOIN people.staff reviewer ON reviewer.id = record_row.owner_staff_id
            LEFT JOIN org.org_units unit ON unit.id = record_row.org_unit_id
            LEFT JOIN auth.user_accounts creator_account ON creator_account.id = record_row.created_by_user_account_id
            LEFT JOIN people.staff creator ON creator.id = creator_account.staff_id
            WHERE record_row.id = @recordId
              AND record_row.archived_at IS NULL
              AND (
                  @canViewAll = 1
                  OR record_row.created_by_user_account_id = @currentUserAccountId
                  OR EXISTS (SELECT 1 FROM visible_staff WHERE staff_id IN (record_row.subject_staff_id, record_row.owner_staff_id))
                  OR EXISTS (SELECT 1 FROM visible_org WHERE org_unit_id = record_row.org_unit_id)
              );
            """, connection);
        AddScopeParameters(command, currentUser);
        command.Parameters.AddWithValue("@recordId", recordId);
        RecordReportHeader? header = null;
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            if (await reader.ReadAsync(cancellationToken))
            {
                header = new RecordReportHeader(
                    reader.GetGuid(0), reader.GetString(1), reader.GetString(2), reader.GetString(3),
                    GetStringOrNull(reader, 4), GetStringOrNull(reader, 5), GetStringOrNull(reader, 6),
                    GetStringOrNull(reader, 7), GetDateOnlyOrNull(reader, 8), reader.GetFieldValue<DateTimeOffset>(9), reader.GetString(10));
            }
        }
        if (header is null) return null;

        var fields = (await QueryOnConnectionAsync(
            connection,
            """
            SELECT section.title, field.label,
                   COALESCE(response.response_text,
                            CONVERT(nvarchar(100), response.response_number),
                            CONVERT(nvarchar(30), response.response_date, 23),
                            lookup_value.display_name,
                            response.response_json)
            FROM forms.form_submissions submission
            JOIN forms.form_responses response ON response.form_submission_id = submission.id AND response.archived_at IS NULL
            JOIN forms.form_fields field ON field.id = response.form_field_id
            JOIN forms.form_sections section ON section.id = field.form_section_id
            LEFT JOIN core.lookup_values lookup_value ON lookup_value.id = response.response_lookup_value_id
            WHERE submission.record_id = @recordId AND submission.archived_at IS NULL
            ORDER BY section.display_order, field.display_order;
            """,
            command => command.Parameters.AddWithValue("@recordId", recordId),
            reader => new RecordReportResponse(reader.GetString(0), reader.GetString(1), GetStringOrNull(reader, 2)),
            cancellationToken)).ToList();
        fields.AddRange(await GetSpecialistRecordResponsesAsync(connection, recordId, header.RecordType, currentUser, cancellationToken));
        var actions = await QueryOnConnectionAsync(
            connection,
            """
            SELECT action_row.title, action_row.detail, owner.display_name, action_row.due_date,
                   COALESCE(status_value.display_name, status_value.value_key, N'Open'),
                   action_row.completed_date, action_row.completion_note, liv_cycle.cycle_number
            FROM quality.actions action_row
            LEFT JOIN people.staff owner ON owner.id = action_row.owner_staff_id
            LEFT JOIN core.lookup_values status_value ON status_value.id = action_row.status_lookup_value_id
            LEFT JOIN quality.liv_cycles liv_cycle ON liv_cycle.id = action_row.liv_cycle_id
            WHERE action_row.source_record_id = @recordId AND action_row.archived_at IS NULL
            ORDER BY action_row.due_date, action_row.created_at;
            """,
            command => command.Parameters.AddWithValue("@recordId", recordId),
            reader => new RecordReportAction(
                reader.GetString(0), GetStringOrNull(reader, 1), GetStringOrNull(reader, 2),
                GetDateOnlyOrNull(reader, 3), reader.GetString(4), GetDateOnlyOrNull(reader, 5), GetStringOrNull(reader, 6),
                reader.IsDBNull(7) ? null : reader.GetInt32(7)),
            cancellationToken);
        var sections = fields.GroupBy(item => item.Section)
            .Select(group => new RecordReportSection(
                group.Key,
                group.Select(item => new RecordReportField(item.Label, item.Value)).ToArray()))
            .ToArray();
        return new RecordReportData(
            header.Id, header.Title, header.RecordType, header.Status, header.StaffName,
            header.ReviewerName, header.Organisation, header.AcademicYear, header.RecordDate, header.CreatedAt,
            header.CreatedBy, sections, actions);
    }

    private async Task<IReadOnlyList<RecordReportResponse>> GetSpecialistRecordResponsesAsync(
        SqlConnection connection,
        Guid recordId,
        string recordType,
        CurrentUser currentUser,
        CancellationToken cancellationToken) =>
        await QueryOnConnectionAsync(
            connection,
            """
            SELECT detail.section_name, detail.field_label, detail.field_value
            FROM (
                SELECT N'Coaching — Session details' AS section_name, values_row.field_label, values_row.field_value, values_row.display_order
                FROM quality.coaching_sessions session_row
                JOIN quality.coaching_cycles cycle ON cycle.id = session_row.cycle_id
                LEFT JOIN core.lookup_values qualification ON qualification.id = session_row.development_stage_lookup_value_id
                LEFT JOIN core.lookup_values primary_focus ON primary_focus.id = session_row.primary_focus_lookup_value_id
                LEFT JOIN core.lookup_values secondary_focus ON secondary_focus.id = session_row.secondary_focus_lookup_value_id
                CROSS APPLY (VALUES
                    (N'Session number', CONVERT(nvarchar(max), session_row.session_number), 1),
                    (N'Session date', CONVERT(nvarchar(max), session_row.session_date, 23), 2),
                    (N'Session type', CONVERT(nvarchar(max), session_row.session_type), 3),
                    (N'Delivery method', CONVERT(nvarchar(max), session_row.delivery_method), 4),
                    (N'Duration minutes', CONVERT(nvarchar(max), session_row.duration_minutes), 5),
                    (N'Qualification status', CONVERT(nvarchar(max), qualification.display_name), 6),
                    (N'Coaching cycle', CONCAT(N'Cycle ', cycle.cycle_number, N' — ', cycle.status), 7),
                    (N'Primary focus', CONVERT(nvarchar(max), primary_focus.display_name), 8),
                    (N'Secondary focus', CONVERT(nvarchar(max), secondary_focus.display_name), 9),
                    (N'Other focus', CONVERT(nvarchar(max), session_row.focus_other_text), 10),
                    (N'Specific session focus', CONVERT(nvarchar(max), session_row.specific_session_focus), 11),
                    (N'Current practice judgement', CONVERT(nvarchar(max), session_row.current_practice_wording_snapshot), 12),
                    (N'Current practice score', CONVERT(nvarchar(max), session_row.current_practice_hidden_score), 13),
                    (N'Current practice evidence', CONVERT(nvarchar(max), session_row.current_practice_evidence), 14),
                    (N'Support provided', CONVERT(nvarchar(max), session_row.support_types_json), 15),
                    (N'Other support', CONVERT(nvarchar(max), session_row.support_other_text), 16),
                    (N'Conversation summary', CONVERT(nvarchar(max), session_row.conversation_summary), 17),
                    (N'Close coaching cycle', CASE WHEN session_row.closes_cycle = 1 THEN N'Yes' ELSE N'No' END, 18),
                    (N'Closure rationale or final reflection', CONVERT(nvarchar(max), session_row.mentor_comments), 19),
                    (N'Session status', CONVERT(nvarchar(max), session_row.status), 20)
                ) values_row(field_label, field_value, display_order)
                WHERE session_row.record_id = @recordId

                UNION ALL

                SELECT N'Learning environment — Audit details', values_row.field_label, values_row.field_value, values_row.display_order
                FROM quality.elevate_environment_assessments assessment
                JOIN quality.rooms room ON room.id = assessment.room_id
                CROSS APPLY (VALUES
                    (N'Room', CONVERT(nvarchar(max), room.room_code), 1),
                    (N'Building', CONVERT(nvarchar(max), room.building_name), 2),
                    (N'Total score', CONVERT(nvarchar(max), assessment.total_score), 3),
                    (N'Scored value count', CONVERT(nvarchar(max), assessment.scored_value_count), 4),
                    (N'Priority improvement count', CONVERT(nvarchar(max), assessment.barrier_count), 5)
                ) values_row(field_label, field_value, display_order)
                WHERE assessment.record_id = @recordId

                UNION ALL

                SELECT CONCAT(N'Learning environment — ', pillar.name), values_row.field_label, values_row.field_value,
                       (pillar.display_order * 10) + values_row.display_order
                FROM quality.elevate_environment_pillar_ratings rating
                JOIN quality.elevate_environment_pillars pillar ON pillar.pillar_key = rating.pillar_key
                CROSS APPLY (VALUES
                    (N'Numerical score', CONVERT(nvarchar(max), rating.numerical_score), 1),
                    (N'Judgement', CONVERT(nvarchar(max), rating.judgement_label_snapshot), 2),
                    (N'Selected descriptor', CONVERT(nvarchar(max), rating.descriptor_snapshot), 3)
                ) values_row(field_label, field_value, display_order)
                WHERE rating.record_id = @recordId

                UNION ALL

                SELECT N'LIV — Preferences and focus', values_row.field_label, values_row.field_value, values_row.display_order
                FROM quality.liv_records liv
                LEFT JOIN quality.elevate_practice_liv_information liv_info ON liv_info.assessment_id = liv.source_elevate_assessment_id
                CROSS APPLY (VALUES
                    (N'Preferred month', CONVERT(nvarchar(max), liv_info.preferred_visit_month, 23), 1),
                    (N'Primary focus', CONVERT(nvarchar(max), liv.eli_primary_focus_snapshot), 2),
                    (N'Desired outcome', CONVERT(nvarchar(max), liv.eli_desired_outcome), 3),
                    (N'Areas of practice', CASE WHEN @hasSensitivePermission = 1 OR liv.reviewer_staff_id = @currentStaffId OR liv.created_by_user_account_id = @currentUserAccountId THEN CONVERT(nvarchar(max), liv.area_of_practice_keys_json) END, 5),
                    (N'Elevate practitioner', CASE WHEN @hasSensitivePermission = 1 OR liv.reviewer_staff_id = @currentStaffId OR liv.created_by_user_account_id = @currentUserAccountId THEN CASE WHEN liv.is_elevate_practitioner = 1 THEN N'Yes' ELSE N'-' END END, 6),
                    (N'Record visibility', CONVERT(nvarchar(max), liv.visibility_status), 7),
                    (N'Status', CONVERT(nvarchar(max), liv.status), 8)
                ) values_row(field_label, field_value, display_order)
                WHERE liv.record_id = @recordId

                UNION ALL

                SELECT CONCAT(N'LIV — Cycle ', cycle.cycle_number, N' — ', stage.stage_type), values_row.field_label,
                       values_row.field_value, (cycle.cycle_number * 100) + (stage.stage_order * 10) + values_row.display_order
                FROM quality.liv_records liv
                JOIN quality.liv_cycles cycle ON cycle.liv_record_id = liv.id
                JOIN quality.liv_stages stage ON stage.liv_cycle_id = cycle.id AND stage.archived_at IS NULL
                CROSS APPLY (VALUES
                    (N'Stage status', CONVERT(nvarchar(max), stage.stage_status), 1),
                    (N'Context', CONVERT(nvarchar(max), stage.context_text), 2),
                    (N'Aims and intended outcomes', CONVERT(nvarchar(max), stage.aims_text), 3),
                    (N'Planned learner activity', CONVERT(nvarchar(max), stage.learner_activity_text), 4),
                    (N'Reflection', CONVERT(nvarchar(max), stage.reflection_text), 5),
                    (N'Distance travelled and impact', CONVERT(nvarchar(max), stage.distance_impact_text), 6),
                    (N'Development opportunities', CONVERT(nvarchar(max), stage.development_opportunity_keys_json), 7),
                    (N'Intended follow-up date', CONVERT(nvarchar(max), stage.intended_follow_up_date, 23), 8)
                ) values_row(field_label, field_value, display_order)
                WHERE liv.record_id = @recordId

                UNION ALL

                SELECT CONCAT(N'LIV — Cycle ', cycle.cycle_number, N' — Visit'), values_row.field_label,
                       values_row.field_value, (cycle.cycle_number * 100) + 50 + values_row.display_order
                FROM quality.liv_records liv
                JOIN quality.liv_cycles cycle ON cycle.liv_record_id = liv.id
                JOIN quality.liv_visits visit ON visit.cycle_id = cycle.id AND visit.archived_at IS NULL
                LEFT JOIN core.lookup_values delivery ON delivery.id = visit.delivery_area_lookup_value_id
                LEFT JOIN core.lookup_types course_level_type ON course_level_type.lookup_key = @courseLevelLookupKey
                LEFT JOIN core.lookup_values course_level ON course_level.lookup_type_id = course_level_type.id
                  AND course_level.value_key = visit.course_level
                CROSS APPLY (VALUES
                    (N'Delivery area', CONVERT(nvarchar(max), delivery.display_name), 1),
                    (N'Visit date', CONVERT(nvarchar(max), visit.visit_date, 23), 2),
                    (N'Visit time', CONVERT(nvarchar(max), visit.visit_time), 3),
                    (N'Course name', CONVERT(nvarchar(max), visit.course_name), 4),
                    (N'Course level', CONVERT(nvarchar(max), COALESCE(course_level.display_name, visit.course_level)), 5),
                    (N'LIV notes', CASE WHEN @hasSensitivePermission = 1 OR liv.reviewer_staff_id = @currentStaffId OR liv.created_by_user_account_id = @currentUserAccountId THEN CONVERT(nvarchar(max), visit.reflection_notes) END, 6),
                    (N'Visit status', CONVERT(nvarchar(max), visit.visit_status), 7)
                ) values_row(field_label, field_value, display_order)
                WHERE liv.record_id = @recordId

                UNION ALL

                SELECT CONCAT(N'LIV — Cycle ', cycle.cycle_number, N' — Rubric'), focus.display_name,
                       CASE WHEN rating.is_not_applicable = 1 THEN N'N/A'
                            ELSE CONCAT(rating.hidden_numeric_value, N' — ', descriptor.visible_wording) END,
                       (cycle.cycle_number * 100) + 70 + focus.display_order
                FROM quality.liv_records liv
                JOIN quality.liv_cycles cycle ON cycle.liv_record_id = liv.id
                JOIN quality.liv_visits visit ON visit.cycle_id = cycle.id AND visit.archived_at IS NULL
                JOIN quality.liv_visit_ratings rating ON rating.visit_id = visit.id
                JOIN core.lookup_values focus ON focus.id = rating.focus_lookup_value_id
                LEFT JOIN quality.elevate_practice_rubric_descriptors descriptor ON descriptor.id = rating.descriptor_id
                WHERE liv.record_id = @recordId

                UNION ALL

                SELECT N'Probation — Cycle overview', values_row.field_label, values_row.field_value, values_row.display_order
                FROM quality.probation_cases probation_case
                CROSS APPLY (VALUES
                    (N'Cycle status', CONVERT(nvarchar(max), probation_case.status), 1),
                    (N'Current observation', CONCAT(N'Observation ', probation_case.current_observation_number), 2),
                    (N'Completed at', CONVERT(nvarchar(max), probation_case.completed_at, 126), 3)
                ) values_row(field_label, field_value, display_order)
                WHERE probation_case.record_id = @recordId

                UNION ALL

                SELECT N'Probation — Reviewers', reviewer.reviewer_role, staff.display_name, 10
                FROM quality.probation_cases probation_case
                JOIN quality.probation_case_reviewers reviewer ON reviewer.probation_case_id = probation_case.id
                JOIN people.staff staff ON staff.id = reviewer.staff_id
                WHERE probation_case.record_id = @recordId

                UNION ALL

                SELECT CONCAT(N'Probation — Observation ', observation.observation_number, N' — ', stage.stage_type),
                       values_row.field_label, values_row.field_value,
                       (observation.observation_number * 100) + (stage.stage_order * 10) + values_row.display_order
                FROM quality.probation_cases probation_case
                JOIN quality.probation_observations observation ON observation.probation_case_id = probation_case.id
                JOIN quality.probation_observation_stages stage ON stage.probation_observation_id = observation.id
                CROSS APPLY (VALUES
                    (N'Stage status', CONVERT(nvarchar(max), stage.stage_status), 1),
                    (N'Context', CONVERT(nvarchar(max), stage.context_text), 2),
                    (N'Aims and intended outcomes', CONVERT(nvarchar(max), stage.aims_text), 3),
                    (N'Planned learner activity', CONVERT(nvarchar(max), stage.learner_activity_text), 4),
                    (N'Reflection and feedback', CONVERT(nvarchar(max), stage.reflection_text), 5),
                    (N'Development opportunities', CONVERT(nvarchar(max), stage.development_opportunity_keys_json), 6),
                    (N'Next observation date', CONVERT(nvarchar(max), stage.intended_next_observation_date, 23), 7)
                ) values_row(field_label, field_value, display_order)
                WHERE probation_case.record_id = @recordId

                UNION ALL

                SELECT CONCAT(N'Probation — Observation ', observation.observation_number, N' — Visit'), values_row.field_label,
                       values_row.field_value, (observation.observation_number * 100) + 60 + values_row.display_order
                FROM quality.probation_cases probation_case
                JOIN quality.probation_observations observation ON observation.probation_case_id = probation_case.id
                JOIN quality.probation_observation_visits visit ON visit.probation_observation_id = observation.id
                LEFT JOIN core.lookup_values delivery ON delivery.id = visit.delivery_area_lookup_value_id
                CROSS APPLY (VALUES
                    (N'Observation status', CONVERT(nvarchar(max), observation.status), 1),
                    (N'Delivery area', CONVERT(nvarchar(max), delivery.display_name), 2),
                    (N'Observation date', CONVERT(nvarchar(max), visit.observation_date, 23), 3),
                    (N'Observation time', CONVERT(nvarchar(max), visit.observation_time), 4),
                    (N'Course name', CONVERT(nvarchar(max), visit.course_name), 5),
                    (N'Course group', CONVERT(nvarchar(max), visit.course_group), 6),
                    (N'Course level', CONVERT(nvarchar(max), visit.course_level), 7),
                    (N'Key points', CONVERT(nvarchar(max), visit.key_points), 8)
                ) values_row(field_label, field_value, display_order)
                WHERE probation_case.record_id = @recordId

                UNION ALL

                SELECT CONCAT(N'Probation — Observation ', observation.observation_number, N' — Rubric'), focus.display_name,
                       CONCAT(rating.hidden_numeric_value, N' — ', descriptor.visible_wording,
                              CASE WHEN NULLIF(rating.evidence_of_practice, N'') IS NULL THEN N'' ELSE CONCAT(N' | Evidence: ', rating.evidence_of_practice) END),
                       (observation.observation_number * 100) + 80 + focus.display_order
                FROM quality.probation_cases probation_case
                JOIN quality.probation_observations observation ON observation.probation_case_id = probation_case.id
                JOIN quality.probation_observation_ratings rating ON rating.probation_observation_id = observation.id
                JOIN core.lookup_values focus ON focus.id = rating.focus_lookup_value_id
                JOIN quality.elevate_practice_rubric_descriptors descriptor ON descriptor.id = rating.descriptor_id
                WHERE probation_case.record_id = @recordId
            ) detail
            WHERE NULLIF(LTRIM(RTRIM(detail.field_value)), N'') IS NOT NULL
            ORDER BY detail.display_order, detail.section_name, detail.field_label;
            """,
            command =>
            {
                command.Parameters.AddWithValue("@recordId", recordId);
                command.Parameters.AddWithValue("@currentUserAccountId", ToDbValue(currentUser.UserAccountId));
                command.Parameters.AddWithValue("@currentStaffId", ToDbValue(currentUser.StaffId));
                command.Parameters.AddWithValue("@hasSensitivePermission", currentUser.HasPermission(PermissionKeys.LivSensitiveRead));
                command.Parameters.AddWithValue("@courseLevelLookupKey", recordType.Equals("als_liv", StringComparison.OrdinalIgnoreCase) ? "als_liv_course_level" : "liv_course_level");
            },
            reader => new RecordReportResponse(reader.GetString(0), reader.GetString(1), GetStringOrNull(reader, 2)),
            cancellationToken);

    public async Task RecordExportAuditAsync(
        string moduleKey,
        string format,
        ExportFilter filter,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var command = new SqlCommand(
            """
            INSERT INTO ops.audit_logs (
                user_account_id, entity_name, action, summary, after_json
            ) VALUES (
                @userId, N'export', N'export.created', @summary, @details
            );
            """, connection);
        command.Parameters.AddWithValue("@userId", ToDbValue(currentUser.UserAccountId));
        command.Parameters.AddWithValue("@summary", $"{format.ToUpperInvariant()} export created for {moduleKey} by {currentUser.DisplayName}.");
        command.Parameters.AddWithValue("@details", JsonSerializer.Serialize(new { ModuleKey = moduleKey, Format = format, Filter = filter }));
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private async Task<IReadOnlyList<ExportSheet>> BuildGenericRecordExportAsync(
        SqlConnection connection,
        string? recordType,
        string sheetName,
        ExportFilter filter,
        CurrentUser user,
        CancellationToken cancellationToken)
    {
        var main = await ReadExportSheetAsync(connection, sheetName, $"""
            {ScopedRecordsCte}
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), record_row.id) AS [Record ID],
                   record_row.title AS [Title], record_row.record_type AS [Record type],
                   COALESCE(status_value.display_name, status_value.value_key, N'Draft') AS [Status],
                   subject.display_name AS [Staff member], owner.display_name AS [Reviewer or owner],
                   faculty.code AS [Faculty code], faculty.name AS [Faculty],
                   team.code AS [Sub-team code], team.name AS [Sub-team],
                   record_row.record_date AS [Record date], record_row.academic_year_key AS [Academic year],
                   record_row.summary AS [Summary], creator.display_name AS [Created by],
                   record_row.created_at AS [Created at], record_row.updated_at AS [Updated at]
            FROM scoped_records record_row
            LEFT JOIN core.lookup_values status_value ON status_value.id = record_row.status_lookup_value_id
            LEFT JOIN people.staff subject ON subject.id = record_row.subject_staff_id
            LEFT JOIN people.staff owner ON owner.id = record_row.owner_staff_id
            LEFT JOIN org.org_units area ON area.id = record_row.org_unit_id
            LEFT JOIN org.org_units faculty ON faculty.id = CASE WHEN area.parent_org_unit_id IS NULL THEN area.id ELSE area.parent_org_unit_id END
            LEFT JOIN org.org_units team ON team.id = CASE WHEN area.parent_org_unit_id IS NOT NULL THEN area.id ELSE NULL END
            LEFT JOIN auth.user_accounts creator_account ON creator_account.id = record_row.created_by_user_account_id
            LEFT JOIN people.staff creator ON creator.id = creator_account.staff_id
            ORDER BY record_row.record_date DESC, record_row.created_at DESC;
            """, command => AddExportParameters(command, user, filter, recordType), cancellationToken);
        var responses = await ReadExportSheetAsync(connection, "Form Responses", $"""
            {ScopedRecordsCte}
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), record_row.id) AS [Record ID], record_row.title AS [Record title],
                   section.title AS [Section], field.label AS [Question],
                   COALESCE(response.response_text, CONVERT(nvarchar(100), response.response_number),
                            CONVERT(nvarchar(30), response.response_date, 23), lookup_value.display_name,
                            response.response_json) AS [Response]
            FROM scoped_records record_row
            JOIN forms.form_submissions submission ON submission.record_id = record_row.id AND submission.archived_at IS NULL
            JOIN forms.form_responses response ON response.form_submission_id = submission.id AND response.archived_at IS NULL
            JOIN forms.form_fields field ON field.id = response.form_field_id
            JOIN forms.form_sections section ON section.id = field.form_section_id
            LEFT JOIN core.lookup_values lookup_value ON lookup_value.id = response.response_lookup_value_id
            ORDER BY record_row.created_at DESC, section.display_order, field.display_order;
            """, command => AddExportParameters(command, user, filter, recordType), cancellationToken);
        var actions = await ReadExportSheetAsync(connection, "Actions", $"""
            {ScopedRecordsCte}
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), action_row.id) AS [Action ID],
                   CONVERT(nvarchar(36), record_row.id) AS [Record ID], record_row.title AS [Source record],
                   action_row.title AS [Action], action_row.detail AS [Description],
                   owner.display_name AS [Owner], action_row.due_date AS [Due date],
                   COALESCE(status_value.display_name, status_value.value_key, N'Open') AS [Status],
                   action_row.completed_date AS [Completed date], action_row.completion_note AS [Closure comments]
            FROM scoped_records record_row
            JOIN quality.actions action_row ON action_row.source_record_id = record_row.id AND action_row.archived_at IS NULL
            LEFT JOIN people.staff owner ON owner.id = action_row.owner_staff_id
            LEFT JOIN core.lookup_values status_value ON status_value.id = action_row.status_lookup_value_id
            ORDER BY record_row.created_at DESC, action_row.due_date;
            """, command => AddExportParameters(command, user, filter, recordType), cancellationToken);
        return [FlattenByKey("Full Records", main, "Record ID", responses, actions), main, responses, actions];
    }

    private async Task<IReadOnlyList<ExportSheet>> BuildElevateEnvironmentExportAsync(
        SqlConnection connection,
        ExportFilter filter,
        CurrentUser user,
        CancellationToken cancellationToken)
    {
        var sheets = (await BuildGenericRecordExportAsync(
            connection,
            "elevate_environment",
            "Learning Environments",
            filter,
            user,
            cancellationToken)).ToList();
        var ratings = await ReadExportSheetAsync(connection, "Pillar Ratings", $"""
            {ScopedRecordsCte}
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), record_row.id) AS [Record ID],
                   record_row.title AS [Record title],
                   room.room_code AS [Room],
                   room.building_name AS [Building],
                   pillar.name AS [Pillar],
                   rating.numerical_score AS [Numerical score],
                   rating.judgement_label_snapshot AS [Judgement],
                   rating.descriptor_snapshot AS [Selected descriptor],
                   record_row.record_date AS [Audit date],
                   record_row.academic_year_key AS [Academic year]
            FROM scoped_records record_row
            JOIN quality.elevate_environment_assessments assessment ON assessment.record_id = record_row.id
            JOIN quality.rooms room ON room.id = assessment.room_id
            JOIN quality.elevate_environment_pillar_ratings rating ON rating.record_id = record_row.id
            JOIN quality.elevate_environment_pillars pillar ON pillar.pillar_key = rating.pillar_key
            ORDER BY record_row.record_date DESC, record_row.created_at DESC, pillar.display_order;
            """, command => AddExportParameters(command, user, filter, "elevate_environment"), cancellationToken);
        sheets.Add(ratings);
        sheets[0] = FlattenByKey("Full Records", sheets[1], "Record ID", sheets.Skip(2).ToArray());
        return sheets;
    }

    private async Task<IReadOnlyList<ExportSheet>> BuildStaffExportAsync(
        SqlConnection connection, ExportFilter filter, CurrentUser user, CancellationToken cancellationToken)
    {
        var staff = await ReadExportSheetAsync(connection, "Staff", """
            WITH visible_staff AS (SELECT staff_id FROM org.fn_visible_staff(@currentUserAccountId))
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), staff.id) AS [Staff ID], staff.external_id AS [Staff code],
                   staff.display_name AS [Name], staff.email AS [Email], staff.staff_category AS [Staff category],
                   manager.display_name AS [Primary line manager], faculty.code AS [Faculty code],
                   faculty.name AS [Faculty], team.code AS [Sub-team code], team.name AS [Sub-team],
                   staff.account_status AS [Account status], staff.start_date AS [Start date],
                   staff.end_date AS [End date], staff.created_at AS [Created at], staff.updated_at AS [Updated at]
            FROM people.staff staff
            JOIN visible_staff visible ON visible.staff_id = staff.id
            LEFT JOIN people.staff manager ON manager.id = staff.line_manager_staff_id
            LEFT JOIN org.org_units area ON area.id = staff.primary_org_unit_id
            LEFT JOIN org.org_units faculty ON faculty.id = CASE WHEN area.parent_org_unit_id IS NULL THEN area.id ELSE area.parent_org_unit_id END
            LEFT JOIN org.org_units team ON team.id = CASE WHEN area.parent_org_unit_id IS NOT NULL THEN area.id ELSE NULL END
            WHERE staff.archived_at IS NULL
              AND (@staffId IS NULL OR staff.id = @staffId)
              AND ((@facultyCode IS NULL AND @teamCode IS NULL)
                   OR faculty.code IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@facultyCode, N','))
                   OR team.code IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@teamCode, N',')))
              AND (@status IS NULL OR staff.account_status = @status)
            ORDER BY staff.display_name;
            """, command => AddExportParameters(command, user, filter), cancellationToken);
        var memberships = await ReadExportSheetAsync(connection, "Memberships", """
            WITH visible_staff AS (SELECT staff_id FROM org.fn_visible_staff(@currentUserAccountId))
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), membership.id) AS [Membership ID],
                   CONVERT(nvarchar(36), staff.id) AS [Staff ID], staff.display_name AS [Staff member],
                   unit.code AS [Organisation code], unit.name AS [Organisation], unit.org_unit_type AS [Level],
                   membership.membership_type AS [Membership type], membership.is_primary AS [Primary],
                   membership.active_from AS [Active from], membership.active_to AS [Active to],
                   membership.assignment_source AS [Assignment source], membership.change_reason AS [Change reason]
            FROM org.staff_org_memberships membership
            JOIN people.staff staff ON staff.id = membership.staff_id
            JOIN visible_staff visible ON visible.staff_id = staff.id
            JOIN org.org_units unit ON unit.id = membership.org_unit_id
            LEFT JOIN org.org_units parent ON parent.id = unit.parent_org_unit_id
            WHERE membership.archived_at IS NULL
              AND (@staffId IS NULL OR staff.id = @staffId)
              AND ((@facultyCode IS NULL AND @teamCode IS NULL)
                   OR COALESCE(parent.code, unit.code) IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@facultyCode, N','))
                   OR unit.code IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@teamCode, N',')))
            ORDER BY staff.display_name, membership.is_primary DESC, unit.name;
            """, command => AddExportParameters(command, user, filter), cancellationToken);
        return [staff, memberships];
    }

    private async Task<IReadOnlyList<ExportSheet>> BuildElevateStatusExportAsync(
        SqlConnection connection, ExportFilter filter, CurrentUser user, CancellationToken cancellationToken)
    {
        var sheets = (await BuildStaffExportAsync(connection, filter, user, cancellationToken)).ToList();
        var awards = await ReadExportSheetAsync(connection, "Elevate Status Awards", """
            WITH visible_staff AS (SELECT staff_id FROM org.fn_visible_staff(@currentUserAccountId))
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), award.id) AS [Award ID], staff.display_name AS [Staff member],
                   staff.email AS [Email], faculty.code AS [Faculty code], faculty.name AS [Faculty],
                   team.code AS [Team code], team.name AS [Team], award.academic_year_key AS [Academic year],
                   award.level_number AS [Level], award.qualifying_attendance_count AS [Qualifying attendance],
                   award.implementation_impact AS [Implementation impact], award.confirmed_at AS [Confirmed at]
            FROM cpd.elevate_status_awards award
            JOIN people.staff staff ON staff.id = award.staff_id
            JOIN visible_staff visible ON visible.staff_id = staff.id
            LEFT JOIN org.org_units area ON area.id = staff.primary_org_unit_id
            LEFT JOIN org.org_units faculty ON faculty.id = CASE WHEN area.parent_org_unit_id IS NULL THEN area.id ELSE area.parent_org_unit_id END
            LEFT JOIN org.org_units team ON team.id = CASE WHEN area.parent_org_unit_id IS NOT NULL THEN area.id ELSE NULL END
            WHERE award.archived_at IS NULL
              AND (@academicYear IS NULL OR award.academic_year_key = @academicYear)
              AND (@staffId IS NULL OR staff.id = @staffId)
              AND ((@facultyCode IS NULL AND @teamCode IS NULL)
                   OR faculty.code IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@facultyCode, N','))
                   OR team.code IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@teamCode, N',')))
            ORDER BY staff.display_name, award.level_number;
            """, command => AddExportParameters(command, user, filter), cancellationToken);
        sheets.Add(awards);
        return sheets;
    }

    private async Task<IReadOnlyList<ExportSheet>> BuildActionExportAsync(
        SqlConnection connection, ExportFilter filter, CurrentUser user, CancellationToken cancellationToken)
    {
        var actions = await ReadExportSheetAsync(connection, "Actions", """
            WITH visible_staff AS (SELECT staff_id FROM org.fn_visible_staff(@currentUserAccountId)),
                 visible_org AS (SELECT org_unit_id FROM org.fn_visible_org_units(@currentUserAccountId))
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), action_row.id) AS [Action ID], action_row.title AS [Action],
                   action_row.detail AS [Description], subject.display_name AS [Staff member],
                   owner.display_name AS [Owner], COALESCE(action_row.source_form_type, record_row.record_type, N'Standalone') AS [Source],
                   record_row.title AS [Source record], action_row.original_due_date AS [Original due date],
                   action_row.revised_due_date AS [Revised due date], action_row.due_date AS [Due date],
                   COALESCE(status_value.display_name, status_value.value_key, N'Open') AS [Status],
                   priority_value.display_name AS [Priority], action_row.completed_date AS [Completed date],
                   action_row.completion_note AS [Closure comments], action_row.cancellation_comments AS [Cancellation comments],
                   faculty.code AS [Faculty code], team.code AS [Sub-team code],
                   record_row.academic_year_key AS [Academic year], action_row.created_at AS [Created at],
                   action_row.updated_at AS [Updated at]
            FROM quality.actions action_row
            LEFT JOIN core.records record_row ON record_row.id = action_row.source_record_id
            LEFT JOIN people.staff subject ON subject.id = action_row.subject_staff_id
            LEFT JOIN people.staff owner ON owner.id = action_row.owner_staff_id
            LEFT JOIN core.lookup_values status_value ON status_value.id = action_row.status_lookup_value_id
            LEFT JOIN core.lookup_values priority_value ON priority_value.id = action_row.priority_lookup_value_id
            LEFT JOIN org.org_units area ON area.id = COALESCE(record_row.org_unit_id, subject.primary_org_unit_id, owner.primary_org_unit_id)
            LEFT JOIN org.org_units faculty ON faculty.id = CASE WHEN area.parent_org_unit_id IS NULL THEN area.id ELSE area.parent_org_unit_id END
            LEFT JOIN org.org_units team ON team.id = CASE WHEN area.parent_org_unit_id IS NOT NULL THEN area.id ELSE NULL END
            WHERE action_row.archived_at IS NULL
              AND (
                  @canViewAll = 1 OR action_row.owner_staff_id = @currentStaffId OR action_row.subject_staff_id = @currentStaffId
                  OR record_row.owner_staff_id = @currentStaffId
                  OR (@canViewScopedActivities = 1 AND (
                      EXISTS (SELECT 1 FROM visible_org WHERE org_unit_id = record_row.org_unit_id)
                      OR EXISTS (SELECT 1 FROM visible_staff WHERE staff_id IN (action_row.subject_staff_id, action_row.owner_staff_id))))
              )
              AND (
                  @canViewAll = 1 OR action_row.visibility_setting = N'staff_and_management'
                  OR (action_row.visibility_setting = N'owner_only' AND action_row.owner_staff_id = @currentStaffId)
                  OR (action_row.visibility_setting = N'source_editors' AND (action_row.created_by_user_account_id = @currentUserAccountId OR record_row.owner_staff_id = @currentStaffId))
                  OR (action_row.visibility_setting = N'management_only' AND @canViewScopedActivities = 1)
              )
              AND (@academicYear IS NULL OR record_row.academic_year_key = @academicYear)
              AND ((@facultyCode IS NULL AND @teamCode IS NULL)
                   OR faculty.code IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@facultyCode, N','))
                   OR team.code IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@teamCode, N',')))
              AND (@fromDate IS NULL OR action_row.due_date >= @fromDate)
              AND (@toDate IS NULL OR action_row.due_date <= @toDate)
              AND (@staffId IS NULL OR action_row.subject_staff_id = @staffId OR action_row.owner_staff_id = @staffId)
              AND (@status IS NULL OR status_value.value_key = @status)
              AND (@recordType IS NULL OR COALESCE(action_row.source_form_type, record_row.record_type) = @recordType)
            ORDER BY action_row.due_date, action_row.created_at DESC;
            """, command => AddExportParameters(command, user, filter), cancellationToken);
        var extensions = await ReadExportSheetAsync(connection, "Extensions", """
            WITH visible_staff AS (SELECT staff_id FROM org.fn_visible_staff(@currentUserAccountId))
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), extension.action_id) AS [Action ID], action_row.title AS [Action],
                   extension.previous_due_date AS [Previous due date], extension.extended_due_date AS [Revised due date],
                   extension.reason AS [Extension reason], extender.display_name AS [Extended by],
                   extension.created_at AS [Extended at]
            FROM quality.action_extensions extension
            JOIN quality.actions action_row ON action_row.id = extension.action_id
            LEFT JOIN auth.user_accounts extender_account ON extender_account.id = extension.created_by_user_account_id
            LEFT JOIN people.staff extender ON extender.id = extender_account.staff_id
            WHERE action_row.archived_at IS NULL
              AND (action_row.owner_staff_id = @currentStaffId OR action_row.subject_staff_id = @currentStaffId OR @canViewAll = 1
                   OR EXISTS (SELECT 1 FROM visible_staff WHERE staff_id IN (action_row.subject_staff_id, action_row.owner_staff_id)))
              AND (@staffId IS NULL OR action_row.subject_staff_id = @staffId OR action_row.owner_staff_id = @staffId)
            ORDER BY extension.created_at DESC;
            """, command => AddExportParameters(command, user, filter), cancellationToken);
        return [actions, extensions];
    }

    private async Task<IReadOnlyList<ExportSheet>> BuildCpdExportAsync(
        SqlConnection connection, ExportFilter filter, CurrentUser user, CancellationToken cancellationToken)
    {
        var events = await ReadExportSheetAsync(connection, "CPD Events", $"""
            {ScopedRecordsCte}
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), event_row.id) AS [CPD event ID], event_row.event_title AS [Event title],
                   event_row.event_date AS [Event date], event_row.start_time AS [Start time], event_row.end_time AS [End time],
                   event_row.duration_minutes AS [Duration minutes], theme.display_name AS [Theme],
                   event_row.delivery_method AS [Delivery method], facilitator.display_name AS [Facilitator],
                   event_row.location AS [Location], event_row.target_audience AS [Target audience],
                   event_row.capacity AS [Capacity], record_row.academic_year_key AS [Academic year],
                   record_row.created_at AS [Created at]
            FROM cpd.cpd_events event_row
            JOIN scoped_records record_row ON record_row.id = event_row.record_id
            LEFT JOIN core.lookup_values theme ON theme.id = event_row.theme_lookup_value_id
            LEFT JOIN people.staff facilitator ON facilitator.id = event_row.facilitator_staff_id
            ORDER BY event_row.event_date DESC, event_row.event_title;
            """, command => AddExportParameters(command, user, filter, "cpd_event"), cancellationToken);
        var attendance = await ReadExportSheetAsync(connection, "Attendance", $"""
            {ScopedRecordsCte}
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), event_row.id) AS [CPD event ID], event_row.event_title AS [Event title],
                   event_row.event_date AS [Event date], staff.display_name AS [Staff member], staff.email AS [Email],
                   attendance.attendance_status AS [Attendance status], attendance.milestone_credit AS [Credit],
                   event_row.duration_minutes AS [Duration minutes], faculty.code AS [Faculty code],
                   team.code AS [Sub-team code], record_row.academic_year_key AS [Academic year]
            FROM cpd.cpd_events event_row
            JOIN scoped_records record_row ON record_row.id = event_row.record_id
            JOIN cpd.cpd_attendance attendance ON attendance.cpd_event_id = event_row.id AND attendance.archived_at IS NULL
            JOIN people.staff staff ON staff.id = attendance.staff_id
            LEFT JOIN org.org_units area ON area.id = COALESCE(attendance.org_unit_id_at_time, staff.primary_org_unit_id)
            LEFT JOIN org.org_units faculty ON faculty.id = CASE WHEN area.parent_org_unit_id IS NULL THEN area.id ELSE area.parent_org_unit_id END
            LEFT JOIN org.org_units team ON team.id = CASE WHEN area.parent_org_unit_id IS NOT NULL THEN area.id ELSE NULL END
            WHERE (@staffId IS NULL OR staff.id = @staffId)
            ORDER BY event_row.event_date DESC, staff.display_name;
            """, command => AddExportParameters(command, user, filter, "cpd_event"), cancellationToken);
        return [FlattenByKey("Full Records", attendance, "CPD event ID", events), events, attendance];
    }

    private async Task<IReadOnlyList<ExportSheet>> BuildCoachingExportAsync(
        SqlConnection connection, ExportFilter filter, CurrentUser user, CancellationToken cancellationToken)
    {
        var sessions = await ReadExportSheetAsync(connection, "Coaching Sessions", $"""
            {ScopedRecordsCte}
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), session_row.id) AS [Session ID],
                   CONVERT(nvarchar(36), cycle.id) AS [Cycle ID], staff.display_name AS [Staff member],
                   coach.display_name AS [Coach or mentor], cycle.cycle_number AS [Cycle number],
                   session_row.session_number AS [Session number], session_row.session_date AS [Session date],
                   session_row.session_type AS [Session type], session_row.delivery_method AS [Delivery method],
                   session_row.duration_minutes AS [Duration minutes], qualification.display_name AS [Qualified status],
                   primary_focus.display_name AS [Primary focus], secondary_focus.display_name AS [Secondary focus],
                   session_row.specific_session_focus AS [Specific focus],
                   session_row.current_practice_wording_snapshot AS [Current practice],
                   session_row.current_practice_evidence AS [Current practice evidence],
                   session_row.support_types_json AS [Support provided],
                   session_row.conversation_summary AS [Conversation summary], session_row.status AS [Status],
                   record_row.academic_year_key AS [Academic year], session_row.created_at AS [Created at],
                   session_row.updated_at AS [Updated at]
            FROM quality.coaching_sessions session_row
            JOIN scoped_records record_row ON record_row.id = session_row.record_id
            JOIN quality.coaching_cycles cycle ON cycle.id = session_row.cycle_id
            JOIN people.staff staff ON staff.id = session_row.staff_id
            LEFT JOIN people.staff coach ON coach.id = session_row.coach_staff_id
            LEFT JOIN core.lookup_values qualification ON qualification.id = session_row.development_stage_lookup_value_id
            LEFT JOIN core.lookup_values primary_focus ON primary_focus.id = session_row.primary_focus_lookup_value_id
            LEFT JOIN core.lookup_values secondary_focus ON secondary_focus.id = session_row.secondary_focus_lookup_value_id
            ORDER BY session_row.session_date DESC, session_row.session_number DESC;
            """, command => AddExportParameters(command, user, filter, "coaching_session"), cancellationToken);
        var actions = await ReadExportSheetAsync(connection, "Session Actions", $"""
            {ScopedRecordsCte}
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), session_row.id) AS [Session ID], session_row.session_number AS [Session number],
                   action_row.title AS [Action], owner.display_name AS [Owner], action_row.due_date AS [Due date],
                   action_row.review_date AS [Review date], action_row.intended_evidence AS [Intended evidence],
                   action_row.intended_impact AS [Intended impact], action_row.progress_status AS [Progress status],
                   COALESCE(status_value.display_name, status_value.value_key, N'Open') AS [Status]
            FROM quality.coaching_sessions session_row
            JOIN scoped_records record_row ON record_row.id = session_row.record_id
            JOIN quality.actions action_row ON action_row.source_record_id = record_row.id AND action_row.archived_at IS NULL
            LEFT JOIN people.staff owner ON owner.id = action_row.owner_staff_id
            LEFT JOIN core.lookup_values status_value ON status_value.id = action_row.status_lookup_value_id
            ORDER BY session_row.session_date DESC, action_row.due_date;
            """, command => AddExportParameters(command, user, filter, "coaching_session"), cancellationToken);
        var reviews = await ReadExportSheetAsync(connection, "Action Reviews", $"""
            {ScopedRecordsCte}
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), review.id) AS [Review ID],
                   CONVERT(nvarchar(36), review.session_id) AS [Reviewing session ID],
                   CONVERT(nvarchar(36), review.action_id) AS [Action ID], action_row.title AS [Action],
                   review.review_outcome AS [Review outcome], review.progress_update AS [Progress or evidence],
                   review.impact_observed AS [Impact observed],
                   CONVERT(nvarchar(36), review.revised_action_id) AS [Revised action ID], review.created_at AS [Reviewed at]
            FROM quality.coaching_action_reviews review
            JOIN quality.coaching_sessions session_row ON session_row.id = review.session_id
            JOIN scoped_records record_row ON record_row.id = session_row.record_id
            JOIN quality.actions action_row ON action_row.id = review.action_id
            ORDER BY review.created_at DESC;
            """, command => AddExportParameters(command, user, filter, "coaching_session"), cancellationToken);
        return [FlattenByKey("Full Records", sessions, "Session ID", actions, reviews), sessions, actions, reviews];
    }

    private async Task<IReadOnlyList<ExportSheet>> BuildReflectionExportAsync(
        SqlConnection connection, ExportFilter filter, CurrentUser user, CancellationToken cancellationToken)
    {
        var reflections = await ReadExportSheetAsync(connection, "Reflections", """
            WITH visible_staff AS (SELECT staff_id FROM org.fn_visible_staff(@currentUserAccountId))
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), reflection.id) AS [Reflection ID], staff.display_name AS [Staff member],
                   reflection.reflection_date AS [Reflection date], reflection.progress AS [Progress],
                   reflection.impact AS [Impact], reflection.examples AS [Examples], reflection.status AS [Status],
                   assessment.academic_year AS [Academic year], reflection.created_at AS [Created at],
                   reflection.updated_at AS [Updated at]
            FROM quality.staff_reflections reflection
            JOIN people.staff staff ON staff.id = reflection.staff_id
            JOIN visible_staff visible ON visible.staff_id = staff.id
            LEFT JOIN quality.elevate_practice_assessments assessment ON assessment.id = reflection.elevate_practice_assessment_id
            LEFT JOIN org.org_units area ON area.id = staff.primary_org_unit_id
            LEFT JOIN org.org_units faculty ON faculty.id = CASE WHEN area.parent_org_unit_id IS NULL THEN area.id ELSE area.parent_org_unit_id END
            LEFT JOIN org.org_units team ON team.id = CASE WHEN area.parent_org_unit_id IS NOT NULL THEN area.id ELSE NULL END
            WHERE reflection.archived_at IS NULL
              AND (@academicYear IS NULL OR assessment.academic_year = @academicYear)
              AND ((@facultyCode IS NULL AND @teamCode IS NULL)
                   OR faculty.code IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@facultyCode, N','))
                   OR team.code IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@teamCode, N',')))
              AND (@fromDate IS NULL OR reflection.reflection_date >= @fromDate)
              AND (@toDate IS NULL OR reflection.reflection_date <= @toDate)
              AND (@staffId IS NULL OR staff.id = @staffId)
              AND (@status IS NULL OR reflection.status = @status)
            ORDER BY reflection.reflection_date DESC, staff.display_name;
            """, command => AddExportParameters(command, user, filter), cancellationToken);
        var focus = await ReadExportSheetAsync(connection, "Linked Focus Areas", """
            WITH visible_staff AS (SELECT staff_id FROM org.fn_visible_staff(@currentUserAccountId))
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), focus.reflection_id) AS [Reflection ID], staff.display_name AS [Staff member],
                   reflection.reflection_date AS [Reflection date], focus.focus_type AS [Focus type],
                   focus.focus_key_snapshot AS [Focus key], focus.focus_text_snapshot AS [Historical wording]
            FROM quality.staff_reflection_focus_areas focus
            JOIN quality.staff_reflections reflection ON reflection.id = focus.reflection_id AND reflection.archived_at IS NULL
            JOIN people.staff staff ON staff.id = reflection.staff_id
            JOIN visible_staff visible ON visible.staff_id = staff.id
            LEFT JOIN quality.elevate_practice_assessments assessment ON assessment.id = reflection.elevate_practice_assessment_id
            WHERE (@academicYear IS NULL OR assessment.academic_year = @academicYear)
              AND (@staffId IS NULL OR staff.id = @staffId)
            ORDER BY reflection.reflection_date DESC, focus.display_order;
            """, command => AddExportParameters(command, user, filter), cancellationToken);
        return [reflections, focus];
    }

    private async Task<IReadOnlyList<ExportSheet>> BuildLivExportAsync(
        SqlConnection connection, ExportFilter filter, CurrentUser user, CancellationToken cancellationToken, string recordType)
    {
        var cases = await ReadExportSheetAsync(connection, "LIV Cases", $"""
            {ScopedRecordsCte}
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), liv.id) AS [LIV case ID], staff.display_name AS [Staff member],
                   reviewer.display_name AS [Reviewer], liv.status AS [Status], liv.current_stage AS [Current stage],
                   liv.eli_primary_focus_snapshot AS [Primary focus], liv.eli_desired_outcome AS [Desired outcome],
                   CASE WHEN @canViewLivSensitive = 1 OR liv.reviewer_staff_id = @currentStaffId OR liv.created_by_user_account_id = @currentUserAccountId THEN CASE WHEN liv.is_elevate_practitioner = 1 THEN N'Yes' ELSE N'-' END END AS [Elevate practitioner],
                   CASE WHEN @canViewLivSensitive = 1 OR liv.reviewer_staff_id = @currentStaffId OR liv.created_by_user_account_id = @currentUserAccountId THEN liv.area_of_practice_keys_json END AS [Areas of practice],
                   faculty.code AS [Faculty code], team.code AS [Sub-team code],
                   record_row.academic_year_key AS [Academic year], liv.created_at AS [Created at],
                   liv.completion_date AS [Completion date]
            FROM quality.liv_records liv
            JOIN scoped_records record_row ON record_row.id = liv.record_id
            JOIN people.staff staff ON staff.id = liv.subject_staff_id
            LEFT JOIN people.staff reviewer ON reviewer.id = liv.reviewer_staff_id
            LEFT JOIN org.org_units area ON area.id = liv.org_unit_id
            LEFT JOIN org.org_units faculty ON faculty.id = CASE WHEN area.parent_org_unit_id IS NULL THEN area.id ELSE area.parent_org_unit_id END
            LEFT JOIN org.org_units team ON team.id = CASE WHEN area.parent_org_unit_id IS NOT NULL THEN area.id ELSE NULL END
            ORDER BY liv.created_at DESC;
            """, command =>
            {
                AddExportParameters(command, user, filter, recordType);
                command.Parameters.AddWithValue("@canViewLivSensitive", user.HasPermission(PermissionKeys.LivSensitiveRead));
            }, cancellationToken);
        var visits = await ReadExportSheetAsync(connection, "Visits", $"""
            {ScopedRecordsCte}
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), liv.id) AS [LIV case ID], CONVERT(nvarchar(36), visit.id) AS [Visit ID],
                   visit.visit_number AS [Visit number], visit.visit_date AS [Visit date], visit.visit_time AS [Visit time],
                   visit.visit_type AS [Visit type], visit.course_name AS [Course],
                   COALESCE(course_level.display_name, visit.course_level) AS [Level], delivery.display_name AS [Delivery area],
                   CASE WHEN @canViewLivSensitive = 1 OR liv.reviewer_staff_id = @currentStaffId OR liv.created_by_user_account_id = @currentUserAccountId THEN visit.reflection_notes END AS [LIV notes],
                   visit.visit_status AS [Visit status], visit.created_at AS [Created at]
            FROM quality.liv_records liv
            JOIN scoped_records record_row ON record_row.id = liv.record_id
            JOIN quality.liv_visits visit ON visit.liv_record_id = liv.id AND visit.archived_at IS NULL
            LEFT JOIN core.lookup_values delivery ON delivery.id = visit.delivery_area_lookup_value_id
            LEFT JOIN core.lookup_types course_level_type ON course_level_type.lookup_key = @courseLevelLookupKey
            LEFT JOIN core.lookup_values course_level ON course_level.lookup_type_id = course_level_type.id
              AND course_level.value_key = visit.course_level
            ORDER BY liv.created_at DESC, visit.visit_number;
            """, command =>
            {
                AddExportParameters(command, user, filter, recordType);
                command.Parameters.AddWithValue("@courseLevelLookupKey", recordType == "als_liv" ? "als_liv_course_level" : "liv_course_level");
                command.Parameters.AddWithValue("@canViewLivSensitive", user.HasPermission(PermissionKeys.LivSensitiveRead));
            }, cancellationToken);
        var stages = await ReadExportSheetAsync(connection, "Stages", $"""
            {ScopedRecordsCte}
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), liv.id) AS [LIV case ID], cycle.cycle_number AS [Cycle],
                   stage.stage_order AS [Stage order], stage.stage_type AS [Stage], stage.stage_status AS [Status],
                   stage.context_text AS [Context], stage.aims_text AS [Aims],
                   stage.learner_activity_text AS [Learner activity], stage.reflection_text AS [Reflection],
                   stage.intended_follow_up_date AS [Follow-up date], stage.distance_impact_text AS [Impact],
                   stage.created_at AS [Created at]
            FROM quality.liv_records liv
            JOIN scoped_records record_row ON record_row.id = liv.record_id
            JOIN quality.liv_cycles cycle ON cycle.liv_record_id = liv.id
            JOIN quality.liv_stages stage ON stage.liv_cycle_id = cycle.id AND stage.archived_at IS NULL
            ORDER BY liv.created_at DESC, cycle.cycle_number, stage.stage_order;
            """, command => AddExportParameters(command, user, filter, recordType), cancellationToken);
        var ratings = await ReadExportSheetAsync(connection, "Practice Rubric", $"""
            {ScopedRecordsCte}
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), liv.id) AS [LIV case ID], cycle.cycle_number AS [Cycle],
                   visit.visit_number AS [Visit number], focus.display_name AS [Focus area],
                   CASE WHEN rating.is_not_applicable = 1 THEN N'N/A' ELSE descriptor.visible_wording END AS [Judgement],
                   rating.hidden_numeric_value AS [Numerical score], rating.is_not_applicable AS [Not applicable]
            FROM quality.liv_records liv
            JOIN scoped_records record_row ON record_row.id = liv.record_id
            JOIN quality.liv_cycles cycle ON cycle.liv_record_id = liv.id
            JOIN quality.liv_visits visit ON visit.cycle_id = cycle.id AND visit.archived_at IS NULL
            JOIN quality.liv_visit_ratings rating ON rating.visit_id = visit.id
            JOIN core.lookup_values focus ON focus.id = rating.focus_lookup_value_id
            LEFT JOIN quality.elevate_practice_rubric_descriptors descriptor ON descriptor.id = rating.descriptor_id
            ORDER BY liv.created_at DESC, cycle.cycle_number, focus.display_order;
            """, command => AddExportParameters(command, user, filter, recordType), cancellationToken);
        var actions = await ReadExportSheetAsync(connection, "Actions", $"""
            {ScopedRecordsCte}
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), liv.id) AS [LIV case ID], action_row.source_sub_record_key AS [Visit or stage],
                   action_row.title AS [Action], owner.display_name AS [Owner], action_row.due_date AS [Due date],
                   COALESCE(status_value.display_name, status_value.value_key, N'Open') AS [Status],
                   action_row.completion_note AS [Closure comments]
            FROM quality.liv_records liv
            JOIN scoped_records record_row ON record_row.id = liv.record_id
            JOIN quality.actions action_row ON action_row.source_record_id = record_row.id AND action_row.archived_at IS NULL
            LEFT JOIN people.staff owner ON owner.id = action_row.owner_staff_id
            LEFT JOIN core.lookup_values status_value ON status_value.id = action_row.status_lookup_value_id
            ORDER BY liv.created_at DESC, action_row.due_date;
            """, command => AddExportParameters(command, user, filter, recordType), cancellationToken);
        return [FlattenByKey("Full Records", cases, "LIV case ID", visits, stages, ratings, actions), cases, visits, stages, ratings, actions];
    }

    private async Task<IReadOnlyList<ExportSheet>> BuildProbationExportAsync(
        SqlConnection connection, ExportFilter filter, CurrentUser user, CancellationToken cancellationToken)
    {
        var cases = await ReadExportSheetAsync(connection, "Probation Cases", $"""
            {ScopedRecordsCte}
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), record_row.id) AS [Record ID],
                   CONVERT(nvarchar(36), probation_case.id) AS [Probation case ID],
                   staff.display_name AS [Staff member], staff.email AS [Staff email],
                   faculty.code AS [Faculty code], faculty.name AS [Faculty],
                   team.code AS [Sub-team code], team.name AS [Sub-team],
                   probation_case.academic_year AS [Academic year], probation_case.status AS [Status],
                   probation_case.current_observation_number AS [Current observation],
                   STRING_AGG(CONCAT(reviewer.reviewer_role, N': ', reviewer_staff.display_name), N' | ') AS [Reviewers],
                   probation_case.created_at AS [Created at], probation_case.updated_at AS [Updated at],
                   probation_case.completed_at AS [Completed at]
            FROM quality.probation_cases probation_case
            JOIN scoped_records record_row ON record_row.id = probation_case.record_id
            JOIN people.staff staff ON staff.id = probation_case.subject_staff_id
            LEFT JOIN org.org_units area ON area.id = probation_case.org_unit_id
            LEFT JOIN org.org_units faculty ON faculty.id = CASE WHEN area.parent_org_unit_id IS NULL THEN area.id ELSE area.parent_org_unit_id END
            LEFT JOIN org.org_units team ON team.id = CASE WHEN area.parent_org_unit_id IS NOT NULL THEN area.id ELSE NULL END
            LEFT JOIN quality.probation_case_reviewers reviewer ON reviewer.probation_case_id = probation_case.id
            LEFT JOIN people.staff reviewer_staff ON reviewer_staff.id = reviewer.staff_id
            GROUP BY record_row.id, probation_case.id, staff.display_name, staff.email,
                     faculty.code, faculty.name, team.code, team.name, probation_case.academic_year,
                     probation_case.status, probation_case.current_observation_number,
                     probation_case.created_at, probation_case.updated_at, probation_case.completed_at
            ORDER BY probation_case.created_at DESC;
            """, command => AddExportParameters(command, user, filter, "probation_case"), cancellationToken);
        var observations = await ReadExportSheetAsync(connection, "Observations", $"""
            {ScopedRecordsCte}
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), record_row.id) AS [Record ID],
                   CONVERT(nvarchar(36), observation.id) AS [Observation ID],
                   observation.observation_number AS [Observation number], observation.observation_type AS [Observation type],
                   observation.status AS [Status], CONVERT(nvarchar(36), observation.linked_liv_record_id) AS [Linked LIV case ID],
                   observation.started_at AS [Started at], observation.completed_at AS [Completed at],
                   observation.created_at AS [Created at], observation.updated_at AS [Updated at]
            FROM quality.probation_cases probation_case
            JOIN scoped_records record_row ON record_row.id = probation_case.record_id
            JOIN quality.probation_observations observation ON observation.probation_case_id = probation_case.id
            ORDER BY probation_case.created_at DESC, observation.observation_number;
            """, command => AddExportParameters(command, user, filter, "probation_case"), cancellationToken);
        var stages = await ReadExportSheetAsync(connection, "Stages", $"""
            {ScopedRecordsCte}
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), record_row.id) AS [Record ID], observation.observation_number AS [Observation number],
                   stage.stage_order AS [Stage order], stage.stage_type AS [Stage], stage.stage_status AS [Status],
                   stage.context_text AS [Context], stage.aims_text AS [Aims and intended outcomes],
                   stage.learner_activity_text AS [Planned learner activity], stage.reflection_text AS [Reflection and feedback],
                   stage.development_opportunity_keys_json AS [Development opportunities],
                   stage.intended_next_observation_date AS [Next observation date],
                   stage.created_at AS [Created at], stage.updated_at AS [Updated at]
            FROM quality.probation_cases probation_case
            JOIN scoped_records record_row ON record_row.id = probation_case.record_id
            JOIN quality.probation_observations observation ON observation.probation_case_id = probation_case.id
            JOIN quality.probation_observation_stages stage ON stage.probation_observation_id = observation.id
            ORDER BY probation_case.created_at DESC, observation.observation_number, stage.stage_order;
            """, command => AddExportParameters(command, user, filter, "probation_case"), cancellationToken);
        var visits = await ReadExportSheetAsync(connection, "Visits", $"""
            {ScopedRecordsCte}
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), record_row.id) AS [Record ID], observation.observation_number AS [Observation number],
                   delivery.display_name AS [Delivery area], visit.observation_date AS [Observation date],
                   visit.observation_time AS [Observation time], visit.course_name AS [Course],
                   visit.course_group AS [Group], visit.course_level AS [Level], visit.key_points AS [Key points],
                   visit.created_at AS [Created at], visit.updated_at AS [Updated at]
            FROM quality.probation_cases probation_case
            JOIN scoped_records record_row ON record_row.id = probation_case.record_id
            JOIN quality.probation_observations observation ON observation.probation_case_id = probation_case.id
            JOIN quality.probation_observation_visits visit ON visit.probation_observation_id = observation.id
            LEFT JOIN core.lookup_values delivery ON delivery.id = visit.delivery_area_lookup_value_id
            ORDER BY probation_case.created_at DESC, observation.observation_number;
            """, command => AddExportParameters(command, user, filter, "probation_case"), cancellationToken);
        var ratings = await ReadExportSheetAsync(connection, "Practice Rubric", $"""
            {ScopedRecordsCte}
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), record_row.id) AS [Record ID], observation.observation_number AS [Observation number],
                   focus.display_name AS [Focus area], descriptor.visible_wording AS [Judgement],
                   rating.hidden_numeric_value AS [Numerical score], rating.evidence_of_practice AS [Evidence of practice]
            FROM quality.probation_cases probation_case
            JOIN scoped_records record_row ON record_row.id = probation_case.record_id
            JOIN quality.probation_observations observation ON observation.probation_case_id = probation_case.id
            JOIN quality.probation_observation_ratings rating ON rating.probation_observation_id = observation.id
            JOIN core.lookup_values focus ON focus.id = rating.focus_lookup_value_id
            JOIN quality.elevate_practice_rubric_descriptors descriptor ON descriptor.id = rating.descriptor_id
            ORDER BY probation_case.created_at DESC, observation.observation_number, focus.display_order;
            """, command => AddExportParameters(command, user, filter, "probation_case"), cancellationToken);
        var actions = await ReadExportSheetAsync(connection, "Actions", $"""
            {ScopedRecordsCte}
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), record_row.id) AS [Record ID], CONVERT(nvarchar(36), action_row.id) AS [Action ID],
                   action_row.source_sub_record_key AS [Observation or stage], action_row.title AS [Action],
                   action_row.detail AS [Description], owner.display_name AS [Owner], action_row.due_date AS [Due date],
                   COALESCE(status_value.display_name, status_value.value_key, N'Open') AS [Status],
                   action_row.completed_date AS [Completed date], action_row.completion_note AS [Closure comments]
            FROM quality.probation_cases probation_case
            JOIN scoped_records record_row ON record_row.id = probation_case.record_id
            JOIN quality.actions action_row ON action_row.source_record_id = record_row.id AND action_row.archived_at IS NULL
            LEFT JOIN people.staff owner ON owner.id = action_row.owner_staff_id
            LEFT JOIN core.lookup_values status_value ON status_value.id = action_row.status_lookup_value_id
            ORDER BY probation_case.created_at DESC, action_row.due_date;
            """, command => AddExportParameters(command, user, filter, "probation_case"), cancellationToken);
        return [
            FlattenByKey("Full Records", cases, "Record ID", observations, stages, visits, ratings, actions),
            cases, observations, stages, visits, ratings, actions
        ];
    }

    private async Task<IReadOnlyList<ExportSheet>> BuildElevatePracticeExportAsync(
        SqlConnection connection, ExportFilter filter, CurrentUser user, CancellationToken cancellationToken)
    {
        var assessments = await ReadExportSheetAsync(connection, "Assessments", $"""
            {ScopedRecordsCte}
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), assessment.id) AS [Assessment ID], staff.display_name AS [Staff member],
                   assessment.academic_year AS [Academic year], assessment.status AS [Status],
                   assessment.submitted_at AS [Submitted at], assessment.created_at AS [Created at],
                   assessment.updated_at AS [Updated at]
            FROM quality.elevate_practice_assessments assessment
            JOIN scoped_records record_row ON record_row.id = assessment.record_id
            JOIN people.staff staff ON staff.id = assessment.staff_id
            ORDER BY assessment.academic_year DESC, staff.display_name;
            """, command => AddExportParameters(command, user, filter, "elevate_practice_assessment"), cancellationToken);
        var ratings = await ReadExportSheetAsync(connection, "Area Outcomes", $"""
            {ScopedRecordsCte}
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), assessment.id) AS [Assessment ID], staff.display_name AS [Staff member],
                   area.category AS [Category], area.name AS [Area], descriptor.visible_wording AS [Wording outcome],
                   assessment.academic_year AS [Academic year]
            FROM quality.elevate_practice_assessments assessment
            JOIN scoped_records record_row ON record_row.id = assessment.record_id
            JOIN people.staff staff ON staff.id = assessment.staff_id
            JOIN quality.elevate_practice_area_ratings rating ON rating.assessment_id = assessment.id
            JOIN quality.elevate_practice_areas area ON area.id = rating.area_id
            JOIN quality.elevate_practice_rubric_descriptors descriptor ON descriptor.id = rating.descriptor_id
            ORDER BY assessment.academic_year DESC, staff.display_name, area.display_order;
            """, command => AddExportParameters(command, user, filter, "elevate_practice_assessment"), cancellationToken);
        var development = await ReadExportSheetAsync(connection, "Development Areas", $"""
            {ScopedRecordsCte}
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), assessment.id) AS [Assessment ID], staff.display_name AS [Staff member],
                   area.name AS [Development area], development_plan.development_approach AS [Development approach],
                   development_plan.support_keys_json AS [Support], development_plan.support_details AS [Support details],
                   development_plan.success_evidence AS [Evidence of success], development_plan.intended_impact AS [Intended impact],
                   assessment.academic_year AS [Academic year]
            FROM quality.elevate_practice_assessments assessment
            JOIN scoped_records record_row ON record_row.id = assessment.record_id
            JOIN people.staff staff ON staff.id = assessment.staff_id
            JOIN quality.elevate_practice_development_plans development_plan ON development_plan.assessment_id = assessment.id
            JOIN quality.elevate_practice_areas area ON area.id = development_plan.area_id
            ORDER BY assessment.academic_year DESC, staff.display_name, area.display_order;
            """, command => AddExportParameters(command, user, filter, "elevate_practice_assessment"), cancellationToken);
        return [assessments, ratings, development];
    }

    private static ExportSheet FlattenByKey(
        string name,
        ExportSheet primary,
        string primaryKeyColumn,
        params ExportSheet[] relatedSheets)
    {
        var primaryKeyIndex = Array.FindIndex(primary.Columns.ToArray(), column =>
            string.Equals(column, primaryKeyColumn, StringComparison.OrdinalIgnoreCase));
        if (primaryKeyIndex < 0) return primary;

        var related = relatedSheets.Select(sheet =>
        {
            var keyIndex = Array.FindIndex(sheet.Columns.ToArray(), column =>
                string.Equals(column, primaryKeyColumn, StringComparison.OrdinalIgnoreCase)
                || column.EndsWith("Record ID", StringComparison.OrdinalIgnoreCase)
                   && primaryKeyColumn.EndsWith("Record ID", StringComparison.OrdinalIgnoreCase)
                || column.Equals("Reviewing session ID", StringComparison.OrdinalIgnoreCase)
                   && primaryKeyColumn.Equals("Session ID", StringComparison.OrdinalIgnoreCase));
            var groupedRows = keyIndex < 0
                ? new Dictionary<string, IReadOnlyList<IReadOnlyList<string?>>>(StringComparer.OrdinalIgnoreCase)
                : sheet.Rows
                    .Where(row => row.Count > keyIndex && !string.IsNullOrWhiteSpace(row[keyIndex]))
                    .GroupBy(row => row[keyIndex]!, StringComparer.OrdinalIgnoreCase)
                    .ToDictionary(group => group.Key, group => (IReadOnlyList<IReadOnlyList<string?>>)group.ToArray(), StringComparer.OrdinalIgnoreCase);
            return new { Sheet = sheet, KeyIndex = keyIndex, Rows = groupedRows };
        }).Where(item => item.KeyIndex >= 0).ToArray();

        var maximumOccurrences = related.ToDictionary(
            item => item.Sheet.Name,
            item => Math.Max(1, item.Rows.Values.Select(rows => rows.Count).DefaultIfEmpty(0).Max()),
            StringComparer.OrdinalIgnoreCase);
        var columns = primary.Columns.ToList();
        foreach (var item in related)
        {
            var occurrenceCount = maximumOccurrences[item.Sheet.Name];
            for (var occurrence = 1; occurrence <= occurrenceCount; occurrence++)
            {
                foreach (var column in item.Sheet.Columns.Where((_, index) => index != item.KeyIndex))
                    columns.Add($"{item.Sheet.Name} {occurrence} — {column}");
            }
        }

        var rows = new List<IReadOnlyList<string?>>(primary.Rows.Count);
        foreach (var primaryRow in primary.Rows)
        {
            var row = primaryRow.ToList();
            var key = primaryRow.Count > primaryKeyIndex ? primaryRow[primaryKeyIndex] : null;
            foreach (var item in related)
            {
                var occurrenceCount = maximumOccurrences[item.Sheet.Name];
                var matching = key is not null && item.Rows.TryGetValue(key, out var found)
                    ? found
                    : Array.Empty<IReadOnlyList<string?>>();
                for (var occurrence = 0; occurrence < occurrenceCount; occurrence++)
                {
                    var source = occurrence < matching.Count ? matching[occurrence] : null;
                    for (var column = 0; column < item.Sheet.Columns.Count; column++)
                    {
                        if (column == item.KeyIndex) continue;
                        row.Add(source is not null && source.Count > column ? source[column] : null);
                    }
                }
            }
            rows.Add(row);
        }

        return new ExportSheet(
            name,
            columns,
            rows,
            primary.WasTruncated || relatedSheets.Any(sheet => sheet.WasTruncated));
    }

    private async Task<ExportSheet> ReadExportSheetAsync(
        SqlConnection connection,
        string name,
        string sql,
        Action<SqlCommand> configure,
        CancellationToken cancellationToken)
    {
        var startedAt = Stopwatch.GetTimestamp();
        var optimizedSql = sql.TrimEnd();
        if (optimizedSql.EndsWith(';')) optimizedSql = optimizedSql[..^1];
        optimizedSql += " OPTION (RECOMPILE, MAX_GRANT_PERCENT = 1);";
        await using var command = new SqlCommand(optimizedSql, connection) { CommandTimeout = 90 };
        command.Parameters.AddWithValue("@exportTake", InteractiveExportRowLimit + 1);
        configure(command);
        await using var reader = await command.ExecuteReaderAsync(System.Data.CommandBehavior.SequentialAccess, cancellationToken);
        var columns = Enumerable.Range(0, reader.FieldCount).Select(reader.GetName).ToArray();
        var rows = new List<IReadOnlyList<string?>>();
        while (rows.Count <= InteractiveExportRowLimit && await reader.ReadAsync(cancellationToken))
        {
            var row = new string?[reader.FieldCount];
            for (var index = 0; index < reader.FieldCount; index++)
                row[index] = reader.IsDBNull(index) ? null : FormatExportValue(reader.GetValue(index));
            rows.Add(row);
        }
        var truncated = rows.Count > InteractiveExportRowLimit;
        if (truncated) rows.RemoveAt(rows.Count - 1);
        var elapsed = Stopwatch.GetElapsedTime(startedAt);
        if (elapsed > TimeSpan.FromSeconds(2))
            logger.LogWarning("Export sheet {SheetName} loaded {RowCount} rows in {ElapsedMilliseconds:F0} ms.", name, rows.Count, elapsed.TotalMilliseconds);
        return new ExportSheet(SafeWorksheetName(name), columns, rows, truncated);
    }

    private static string FormatExportValue(object value) => value switch
    {
        DateTime dateTime => dateTime.ToString("dd MMM yyyy HH:mm", CultureInfo.InvariantCulture),
        DateTimeOffset dateTimeOffset => dateTimeOffset.ToString("dd MMM yyyy HH:mm", CultureInfo.InvariantCulture),
        DateOnly dateOnly => dateOnly.ToString("dd MMM yyyy", CultureInfo.InvariantCulture),
        TimeSpan time => time.ToString(@"hh\:mm", CultureInfo.InvariantCulture),
        bool boolean => boolean ? "Yes" : "No",
        IFormattable formattable => formattable.ToString(null, CultureInfo.InvariantCulture) ?? "",
        _ => Convert.ToString(value, CultureInfo.InvariantCulture) ?? ""
    };

    private static string SafeWorksheetName(string value)
    {
        var invalid = new[] { ':', '\\', '/', '?', '*', '[', ']' };
        var sanitized = string.Concat(value.Select(character => invalid.Contains(character) ? '-' : character));
        return sanitized[..Math.Min(31, sanitized.Length)];
    }

    private static string NormalizeExportModuleKey(string value) => value.Trim().ToLowerInvariant() switch
    {
        "learning_walk" => "learning-walks",
        "als_learning_walk" => "als-learning-walks",
        "als_liv" => "als-liv",
        "work_scrutiny" => "work-scrutiny",
        "elevate_environment" => "elevate-environments",
        "elevate_practice" => "elevate-practice",
        "coaching_mentoring" => "coaching",
        "probation_observation" => "probation",
        var key => key
    };

    private static string? DashboardQuestionRecordType(string key) => key switch
    {
        "learning-walks" => "learning_walk",
        "als-learning-walks" => "als_learning_walk",
        "liv" => "liv",
        "als-liv" => "als_liv",
        "work-scrutiny" => "work_scrutiny",
        "elevate-environments" => "elevate_environment",
        "elevate-practice" => "elevate_practice_assessment",
        "coaching" => "coaching_session",
        "cpd" => "cpd_event",
        "probation" => "probation_case",
        _ => null
    };

    private static string ExportDisplayName(string key) => key switch
    {
        "learning-walks" => "Learning Walks",
        "als-learning-walks" => "ALS Learning Walks",
        "als-liv" => "ALS Learning and Innovation Visits",
        "work-scrutiny" => "Work Scrutiny",
        "elevate-environments" => "Learning Environments",
        "elevate-practice" => "Elevate Learning and Innovation",
        "coaching" => "Coaching and Mentoring",
        "reflections" => "Staff Reflections",
        "actions" => "Actions",
        "cpd" => "CPD",
        "liv" => "Learning and Innovation Visits",
        "staff" => "Staff",
        "probation" => "Probationary Observations",
        "dashboard-overview" => "Teaching and Learning Overview",
        "elevate-status" => "i-Elevate Status",
        _ => key
    };

    private static void AddExportParameters(
        SqlCommand command,
        CurrentUser user,
        ExportFilter filter,
        string? recordType = null)
    {
        AddScopeParameters(command, user);
        AddNullableText(command, "@academicYear", filter.AcademicYear, 10);
        AddNullableText(command, "@facultyCode", filter.FacultyCode, 4000);
        AddNullableText(command, "@teamCode", filter.TeamCode, 4000);
        AddNullableDate(command, "@fromDate", filter.FromDate);
        AddNullableDate(command, "@toDate", filter.ToDate);
        AddNullableGuid(command, "@staffId", filter.StaffId);
        AddNullableGuid(command, "@reviewerId", filter.ReviewerId);
        AddNullableText(command, "@status", filter.Status, 100);
        AddNullableText(command, "@recordType", recordType ?? filter.RecordType, 100);
    }

    private static void AddNullableText(SqlCommand command, string name, string? value, int size) =>
        command.Parameters.Add(name, System.Data.SqlDbType.NVarChar, size).Value =
            string.IsNullOrWhiteSpace(value) ? DBNull.Value : value.Trim();

    private static void AddNullableDate(SqlCommand command, string name, DateOnly? value) =>
        command.Parameters.Add(name, System.Data.SqlDbType.Date).Value =
            value.HasValue ? value.Value.ToDateTime(TimeOnly.MinValue) : DBNull.Value;

    private static void AddNullableGuid(SqlCommand command, string name, Guid? value) =>
        command.Parameters.Add(name, System.Data.SqlDbType.UniqueIdentifier).Value =
            value.HasValue ? value.Value : DBNull.Value;

    private static async Task<IReadOnlyList<T>> QueryOnConnectionAsync<T>(
        SqlConnection connection,
        string sql,
        Action<SqlCommand> configure,
        Func<SqlDataReader, T> map,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(sql, connection);
        configure(command);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var rows = new List<T>();
        while (await reader.ReadAsync(cancellationToken)) rows.Add(map(reader));
        return rows;
    }

    private const string ScopedRecordsCte = """
        WITH visible_staff AS (SELECT staff_id FROM org.fn_visible_staff(@currentUserAccountId)),
             visible_org AS (SELECT org_unit_id FROM org.fn_visible_org_units(@currentUserAccountId)),
             scoped_records AS (
                 SELECT record_source.*
                 FROM core.records record_source
                 LEFT JOIN core.lookup_values record_status ON record_status.id = record_source.status_lookup_value_id
                 LEFT JOIN org.org_units record_area ON record_area.id = record_source.org_unit_id
                 LEFT JOIN org.org_units record_faculty ON record_faculty.id = CASE WHEN record_area.parent_org_unit_id IS NULL THEN record_area.id ELSE record_area.parent_org_unit_id END
                 LEFT JOIN org.org_units record_team ON record_team.id = CASE WHEN record_area.parent_org_unit_id IS NOT NULL THEN record_area.id ELSE NULL END
                 WHERE record_source.archived_at IS NULL
                   AND (@recordType IS NULL OR record_source.record_type = @recordType)
                   AND (
                       @canViewAll = 1 OR record_source.created_by_user_account_id = @currentUserAccountId
                       OR EXISTS (SELECT 1 FROM visible_staff WHERE staff_id IN (record_source.subject_staff_id, record_source.owner_staff_id))
                       OR EXISTS (SELECT 1 FROM visible_org WHERE org_unit_id = record_source.org_unit_id)
                   )
                   AND (@academicYear IS NULL OR record_source.academic_year_key = @academicYear)
                   AND ((@facultyCode IS NULL AND @teamCode IS NULL)
                        OR record_faculty.code IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@facultyCode, N','))
                        OR record_team.code IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@teamCode, N',')))
                   AND (@fromDate IS NULL OR record_source.record_date >= @fromDate)
                   AND (@toDate IS NULL OR record_source.record_date <= @toDate)
                   AND (@staffId IS NULL OR record_source.subject_staff_id = @staffId)
                   AND (@reviewerId IS NULL OR record_source.owner_staff_id = @reviewerId)
                   AND (@status IS NULL OR record_status.value_key = @status)
             )
        """;

    private sealed record RecordReportHeader(
        Guid Id,
        string Title,
        string RecordType,
        string Status,
        string? StaffName,
        string? ReviewerName,
        string? Organisation,
        string? AcademicYear,
        DateOnly? RecordDate,
        DateTimeOffset CreatedAt,
        string CreatedBy);

    private sealed record RecordReportResponse(string Section, string Label, string? Value);
}
