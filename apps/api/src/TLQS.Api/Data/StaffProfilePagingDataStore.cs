using System.Text.Json;
using TLQS.Api.V1;
using TLQS.Application.Security;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    public async Task<StaffProfileDetail?> GetStaffProfileShellAsync(
        Guid staffId,
        string academicYear,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        var (startDate, endDate) = await GetAcademicYearBoundsAsync(academicYear, cancellationToken);
        var headers = await QueryAsync(
            """
            SELECT staff.id, staff.external_id, staff.display_name, staff.email, unit.code, staff.account_status,
                   (SELECT COUNT(*) FROM evidence.evidence_items evidence_row
                    WHERE evidence_row.staff_id = staff.id AND evidence_row.archived_at IS NULL
                      AND evidence_row.evidence_date BETWEEN @startDate AND @endDate
                      AND (evidence_row.pillar_or_theme IS NULL OR evidence_row.pillar_or_theme <> N'reflection'))
            FROM people.staff staff
            LEFT JOIN org.org_units unit ON unit.id = staff.primary_org_unit_id
            WHERE staff.id = @staffId AND staff.archived_at IS NULL;
            """,
            command =>
            {
                command.Parameters.AddWithValue("@staffId", staffId);
                command.Parameters.AddWithValue("@startDate", startDate.ToDateTime(TimeOnly.MinValue));
                command.Parameters.AddWithValue("@endDate", endDate.ToDateTime(TimeOnly.MinValue));
            },
            reader => new StaffProfileShellRow(
                reader.GetGuid(0), reader.GetString(1), reader.GetString(2), reader.GetString(3),
                GetStringOrNull(reader, 4), reader.GetString(5), reader.GetInt32(6)),
            cancellationToken);
        if (headers.Count == 0) return null;
        var header = headers[0];
        return new StaffProfileDetail(
            header.StaffId, header.ExternalId, header.DisplayName, header.Email, header.PrimaryOrgCode,
            header.AccountStatus, academicYear, header.EvidenceSubmitted, 0,
            [], [], [], [],
            await GetElevatePracticeProfileSummaryAsync(staffId, academicYear, cancellationToken),
            await GetElevateStatusAsync(staffId, academicYear, currentUser, cancellationToken));
    }

    public async Task<StaffProfileSectionSummary> GetStaffProfileSectionSummaryAsync(
        Guid staffId,
        string academicYear,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        var (startDate, endDate) = await GetAcademicYearBoundsAsync(academicYear, cancellationToken);
        var rows = await QueryAsync(
            """
            SELECT
                (SELECT COUNT(*) FROM quality.staff_reflections reflection
                 JOIN quality.elevate_practice_assessments assessment ON assessment.id = reflection.elevate_practice_assessment_id
                 WHERE reflection.staff_id = @staffId AND assessment.academic_year = @academicYear AND reflection.archived_at IS NULL),
                (SELECT COUNT(*) FROM quality.staff_reflections reflection
                 JOIN quality.elevate_practice_assessments assessment ON assessment.id = reflection.elevate_practice_assessment_id
                 WHERE reflection.staff_id = @staffId AND assessment.academic_year = @academicYear
                   AND reflection.status = N'submitted' AND reflection.archived_at IS NULL),
                (SELECT COUNT(*) FROM quality.coaching_sessions session
                 WHERE session.staff_id = @staffId AND session.archived_at IS NULL AND session.session_date BETWEEN @startDate AND @endDate),
                (SELECT COUNT(*) FROM cpd.cpd_attendance attendance
                 JOIN cpd.cpd_events event_row ON event_row.id = attendance.cpd_event_id AND event_row.archived_at IS NULL
                 WHERE attendance.staff_id = @staffId AND attendance.attendance_status = N'Attended'
                   AND attendance.archived_at IS NULL AND event_row.event_date BETWEEN @startDate AND @endDate),
                (SELECT COUNT(*) FROM cpd.cpd_attendance attendance
                 JOIN cpd.cpd_events event_row ON event_row.id = attendance.cpd_event_id AND event_row.archived_at IS NULL
                 WHERE attendance.staff_id = @staffId AND attendance.attendance_status = N'Attended' AND attendance.archived_at IS NULL
                   AND event_row.event_date BETWEEN @startDate AND @endDate
                   AND EXISTS (SELECT 1 FROM forms.form_submissions submission JOIN forms.form_template_versions version_row ON version_row.id=submission.form_template_version_id JOIN forms.form_templates template ON template.id=version_row.form_template_id WHERE submission.record_id=event_row.record_id AND submission.archived_at IS NULL AND template.template_key=N'cpd_core')),
                (SELECT COUNT(*) FROM cpd.cpd_attendance attendance
                 JOIN cpd.cpd_events event_row ON event_row.id = attendance.cpd_event_id AND event_row.archived_at IS NULL
                 WHERE attendance.staff_id = @staffId AND attendance.attendance_status = N'Attended' AND attendance.archived_at IS NULL
                   AND event_row.event_date BETWEEN @startDate AND @endDate
                   AND NOT EXISTS (SELECT 1 FROM forms.form_submissions submission JOIN forms.form_template_versions version_row ON version_row.id=submission.form_template_version_id JOIN forms.form_templates template ON template.id=version_row.form_template_id WHERE submission.record_id=event_row.record_id AND submission.archived_at IS NULL AND template.template_key=N'cpd_core')),
                (SELECT COALESCE(SUM(event_row.duration_minutes), 0) FROM cpd.cpd_attendance attendance
                 JOIN cpd.cpd_events event_row ON event_row.id = attendance.cpd_event_id AND event_row.archived_at IS NULL
                 WHERE attendance.staff_id = @staffId AND attendance.attendance_status = N'Attended' AND attendance.archived_at IS NULL
                   AND event_row.event_date BETWEEN @startDate AND @endDate),
                (SELECT COUNT(*) FROM quality.actions action_row
                 LEFT JOIN core.records record_row ON record_row.id = action_row.source_record_id
                 WHERE (action_row.subject_staff_id = @staffId OR action_row.owner_staff_id = @staffId)
                   AND action_row.archived_at IS NULL AND action_row.completed_date IS NULL
                   AND ((record_row.id IS NOT NULL AND record_row.academic_year_key = @academicYear)
                     OR (record_row.id IS NULL AND CONVERT(date, action_row.created_at) BETWEEN @startDate AND @endDate))),
                (SELECT COUNT(*) FROM quality.actions action_row
                 LEFT JOIN core.records record_row ON record_row.id = action_row.source_record_id
                 WHERE (action_row.subject_staff_id = @staffId OR action_row.owner_staff_id = @staffId)
                   AND action_row.archived_at IS NULL AND action_row.completed_date IS NOT NULL
                   AND ((record_row.id IS NOT NULL AND record_row.academic_year_key = @academicYear)
                     OR (record_row.id IS NULL AND CONVERT(date, action_row.created_at) BETWEEN @startDate AND @endDate))),
                (SELECT COUNT(*) FROM quality.actions action_row
                 LEFT JOIN core.records record_row ON record_row.id = action_row.source_record_id
                 WHERE (action_row.subject_staff_id = @staffId OR action_row.owner_staff_id = @staffId)
                   AND action_row.archived_at IS NULL AND action_row.completed_date IS NULL
                   AND action_row.due_date < CONVERT(date, sysutcdatetime())
                   AND ((record_row.id IS NOT NULL AND record_row.academic_year_key = @academicYear)
                     OR (record_row.id IS NULL AND CONVERT(date, action_row.created_at) BETWEEN @startDate AND @endDate))),
                (SELECT COUNT(*) FROM quality.liv_records liv
                 JOIN core.records record_row ON record_row.id = liv.record_id AND record_row.archived_at IS NULL
                 WHERE liv.subject_staff_id = @staffId AND liv.archived_at IS NULL
                   AND record_row.academic_year_key = @academicYear),
                (SELECT COUNT(*) FROM quality.probation_cases probation
                 WHERE probation.subject_staff_id = @staffId AND probation.archived_at IS NULL
                   AND (
                       @canViewAllProbation = 1
                       OR probation.subject_staff_id = @currentStaffId
                       OR probation.created_by_user_account_id = @currentUserAccountId
                       OR EXISTS (
                           SELECT 1 FROM quality.probation_case_reviewers reviewer
                           WHERE reviewer.probation_case_id = probation.id AND reviewer.staff_id = @currentStaffId
                       )
                       OR (@canViewScopedProbation = 1 AND (
                           EXISTS (SELECT 1 FROM org.fn_visible_staff(@currentUserAccountId) visible WHERE visible.staff_id = probation.subject_staff_id)
                           OR EXISTS (SELECT 1 FROM org.fn_visible_org_units(@currentUserAccountId) visible WHERE visible.org_unit_id = probation.org_unit_id)
                       ))
                   ));
            """,
            command =>
            {
                command.Parameters.AddWithValue("@staffId", staffId);
                command.Parameters.AddWithValue("@academicYear", academicYear);
                command.Parameters.AddWithValue("@startDate", startDate.ToDateTime(TimeOnly.MinValue));
                command.Parameters.AddWithValue("@endDate", endDate.ToDateTime(TimeOnly.MinValue));
                command.Parameters.AddWithValue("@canViewAllProbation", currentUser.HasPermission(PermissionKeys.ProbationManage) || currentUser.HasPermission(PermissionKeys.ReportsViewAll));
                command.Parameters.AddWithValue("@canViewScopedProbation", currentUser.HasPermission(PermissionKeys.ProbationSubmit) || currentUser.HasPermission(PermissionKeys.ReportsViewScoped));
                command.Parameters.AddWithValue("@currentStaffId", ToDbValue(currentUser.StaffId));
                command.Parameters.AddWithValue("@currentUserAccountId", ToDbValue(currentUser.UserAccountId));
            },
            reader => new StaffProfileSectionSummary(
                reader.GetInt32(0), reader.GetInt32(1), reader.GetInt32(2), reader.GetInt32(3),
                reader.GetInt32(4), reader.GetInt32(5), reader.GetInt32(6), reader.GetInt32(7),
                reader.GetInt32(8), reader.GetInt32(9), reader.GetInt32(10), reader.GetInt32(11)),
            cancellationToken);
        return rows[0];
    }

    public async Task<PagedResult<StaffReflectionSummary>> GetStaffProfileReflectionsPageAsync(
        Guid staffId, string academicYear, int page, int pageSize, CancellationToken cancellationToken)
    {
        (page, pageSize) = NormalizePage(page, pageSize);
        var totalRows = await QueryAsync(
            """
            SELECT COUNT(*)
            FROM quality.staff_reflections reflection
            JOIN quality.elevate_practice_assessments assessment ON assessment.id = reflection.elevate_practice_assessment_id
            WHERE reflection.staff_id = @staffId AND assessment.academic_year = @academicYear AND reflection.archived_at IS NULL;
            """,
            command => { command.Parameters.AddWithValue("@staffId", staffId); command.Parameters.AddWithValue("@academicYear", academicYear); },
            reader => reader.GetInt32(0), cancellationToken);
        var rows = await QueryAsync(
            """
            SELECT reflection.id, reflection.staff_id, reflection.elevate_practice_assessment_id,
                   reflection.elevate_practice_record_id, assessment.academic_year, reflection.reflection_date,
                   reflection.progress, reflection.impact, reflection.examples, reflection.status,
                   reflection.created_by_user_account_id, created_by.display_name, reflection.created_at,
                   reflection.updated_by_user_account_id, updated_by.display_name, reflection.updated_at
            FROM quality.staff_reflections reflection
            JOIN quality.elevate_practice_assessments assessment ON assessment.id = reflection.elevate_practice_assessment_id
            LEFT JOIN auth.user_accounts created_account ON created_account.id = reflection.created_by_user_account_id
            LEFT JOIN people.staff created_by ON created_by.id = created_account.staff_id
            LEFT JOIN auth.user_accounts updated_account ON updated_account.id = reflection.updated_by_user_account_id
            LEFT JOIN people.staff updated_by ON updated_by.id = updated_account.staff_id
            WHERE reflection.staff_id = @staffId AND assessment.academic_year = @academicYear AND reflection.archived_at IS NULL
            ORDER BY reflection.reflection_date DESC, reflection.created_at DESC
            OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;
            """,
            command =>
            {
                command.Parameters.AddWithValue("@staffId", staffId);
                command.Parameters.AddWithValue("@academicYear", academicYear);
                command.Parameters.AddWithValue("@offset", (page - 1) * pageSize);
                command.Parameters.AddWithValue("@pageSize", pageSize);
            },
            reader => new StaffReflectionRow(
                reader.GetGuid(0), reader.GetGuid(1), reader.GetGuid(2), reader.GetGuid(3), reader.GetString(4),
                DateOnly.FromDateTime(reader.GetDateTime(5)), GetStringOrNull(reader, 6), GetStringOrNull(reader, 7),
                GetStringOrNull(reader, 8), reader.GetString(9), GetGuidOrNull(reader, 10), GetStringOrNull(reader, 11),
                reader.GetFieldValue<DateTimeOffset>(12), GetGuidOrNull(reader, 13), GetStringOrNull(reader, 14), GetDateTimeOffsetOrNull(reader, 15)),
            cancellationToken);
        if (rows.Count == 0) return CreatePage<StaffReflectionSummary>([], page, pageSize, totalRows[0]);

        var focusRows = await QueryAsync(
            """
            SELECT link.reflection_id, link.focus_lookup_value_id, link.focus_key_snapshot,
                   link.focus_text_snapshot, link.focus_type, link.display_order
            FROM quality.staff_reflection_focus_areas link
            JOIN OPENJSON(@reflectionIds) ids ON TRY_CONVERT(uniqueidentifier, ids.value) = link.reflection_id
            ORDER BY link.reflection_id, link.display_order;
            """,
            command => command.Parameters.AddWithValue("@reflectionIds", JsonSerializer.Serialize(rows.Select(row => row.Id))),
            reader => new StaffReflectionFocusRow(reader.GetGuid(0), GetGuidOrNull(reader, 1), reader.GetString(2), reader.GetString(3), reader.GetString(4), reader.GetInt32(5)),
            cancellationToken);
        var focusByReflection = focusRows.GroupBy(row => row.ReflectionId).ToDictionary(
            group => group.Key,
            group => (IReadOnlyList<StaffReflectionFocusAreaSummary>)group.Select(focus => new StaffReflectionFocusAreaSummary(
                focus.FocusLookupValueId, focus.FocusKeySnapshot, focus.TextSnapshot, focus.FocusType, focus.DisplayOrder)).ToArray());
        var items = rows.Select(row => new StaffReflectionSummary(
            row.Id, row.StaffId, row.ElevatePracticeAssessmentId, row.ElevatePracticeRecordId, row.AcademicYear,
            row.ReflectionDate, row.Progress, row.Impact, row.Examples, row.Status,
            focusByReflection.GetValueOrDefault(row.Id, []), row.CreatedByUserAccountId, row.CreatedByName,
            row.CreatedAt, row.UpdatedByUserAccountId, row.UpdatedByName, row.UpdatedAt)).ToArray();
        return CreatePage(items, page, pageSize, totalRows[0]);
    }

    public async Task<PagedResult<StaffCpdRecordSummary>> GetStaffProfileCpdPageAsync(
        Guid staffId, string academicYear, int page, int pageSize, CancellationToken cancellationToken)
    {
        (page, pageSize) = NormalizePage(page, pageSize);
        var (startDate, endDate) = await GetAcademicYearBoundsAsync(academicYear, cancellationToken);
        var total = await CountAsync(
            """
            SELECT COUNT(*) FROM cpd.cpd_attendance attendance
            JOIN cpd.cpd_events event_row ON event_row.id = attendance.cpd_event_id AND event_row.archived_at IS NULL
            WHERE attendance.staff_id = @staffId AND attendance.archived_at IS NULL
              AND attendance.attendance_status = N'Attended' AND event_row.event_date BETWEEN @startDate AND @endDate;
            """, staffId, academicYear, startDate, endDate, cancellationToken);
        var items = await QueryAsync(
            """
            SELECT event_row.id, event_row.record_id, event_row.event_title, event_row.event_date, themes.response_text, event_row.duration_minutes,
                   CASE WHEN template_info.template_key = N'cpd_core' THEN CONVERT(bit, 1) ELSE CONVERT(bit, 0) END
            FROM cpd.cpd_attendance attendance
            JOIN cpd.cpd_events event_row ON event_row.id = attendance.cpd_event_id AND event_row.archived_at IS NULL
            OUTER APPLY (SELECT TOP (1) response.response_text FROM forms.form_submissions submission
                         JOIN forms.form_responses response ON response.form_submission_id = submission.id AND response.archived_at IS NULL
                         JOIN forms.form_fields field_row ON field_row.id = response.form_field_id AND field_row.field_key = N'cpd_themes'
                         WHERE submission.record_id = event_row.record_id AND submission.archived_at IS NULL) themes
            OUTER APPLY (SELECT TOP (1) template.template_key FROM forms.form_submissions submission
                         JOIN forms.form_template_versions version_row ON version_row.id = submission.form_template_version_id
                         JOIN forms.form_templates template ON template.id = version_row.form_template_id
                         WHERE submission.record_id = event_row.record_id AND submission.archived_at IS NULL ORDER BY submission.created_at DESC) template_info
            WHERE attendance.staff_id = @staffId AND attendance.archived_at IS NULL
              AND attendance.attendance_status = N'Attended' AND event_row.event_date BETWEEN @startDate AND @endDate
            ORDER BY event_row.event_date DESC, event_row.id OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;
            """,
            command => AddPageParameters(command, staffId, academicYear, startDate, endDate, page, pageSize),
            reader => new StaffCpdRecordSummary(reader.GetGuid(0), reader.GetGuid(1), reader.GetString(2), DateOnly.FromDateTime(reader.GetDateTime(3)), GetStringOrNull(reader, 4), GetIntOrNull(reader, 5), reader.GetBoolean(6)),
            cancellationToken);
        return CreatePage(items, page, pageSize, total);
    }

    public async Task<PagedResult<StaffProfileCoachingSummary>> GetStaffProfileCoachingPageAsync(
        Guid staffId, string academicYear, int page, int pageSize, CancellationToken cancellationToken)
    {
        (page, pageSize) = NormalizePage(page, pageSize);
        var (startDate, endDate) = await GetAcademicYearBoundsAsync(academicYear, cancellationToken);
        var total = await CountAsync(
            "SELECT COUNT(*) FROM quality.coaching_sessions WHERE staff_id=@staffId AND archived_at IS NULL AND session_date BETWEEN @startDate AND @endDate;",
            staffId, academicYear, startDate, endDate, cancellationToken);
        var items = await QueryAsync(
            """
            SELECT session.id, session.record_id, cycle.cycle_number, session.session_number, session.session_date,
                   session.session_type, session.status, coach.display_name, focus.display_name, session.specific_session_focus
            FROM quality.coaching_sessions session
            JOIN quality.coaching_cycles cycle ON cycle.id = session.cycle_id AND cycle.archived_at IS NULL
            JOIN people.staff coach ON coach.id = session.coach_staff_id
            LEFT JOIN core.lookup_values focus ON focus.id = session.primary_focus_lookup_value_id
            WHERE session.staff_id=@staffId AND session.archived_at IS NULL AND session.session_date BETWEEN @startDate AND @endDate
            ORDER BY session.session_date DESC, cycle.cycle_number DESC, session.session_number DESC
            OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;
            """,
            command => AddPageParameters(command, staffId, academicYear, startDate, endDate, page, pageSize),
            reader => new StaffProfileCoachingSummary(
                reader.GetGuid(0), reader.GetGuid(1), reader.GetInt32(2), reader.GetInt32(3),
                DateOnly.FromDateTime(reader.GetDateTime(4)), reader.GetString(5), reader.GetString(6), reader.GetString(7),
                GetStringOrNull(reader, 8), GetStringOrNull(reader, 9)),
            cancellationToken);
        return CreatePage(items, page, pageSize, total);
    }

    public async Task<PagedResult<StaffProfileLivSummary>> GetStaffProfileLivPageAsync(
        Guid staffId, string academicYear, int page, int pageSize, CancellationToken cancellationToken)
    {
        (page, pageSize) = NormalizePage(page, pageSize);
        var (startDate, endDate) = await GetAcademicYearBoundsAsync(academicYear, cancellationToken);
        const string whereClause = """
            liv.subject_staff_id = @staffId
            AND liv.archived_at IS NULL
            AND record_row.archived_at IS NULL
            AND record_row.academic_year_key = @academicYear
            """;
        var total = await CountAsync(
            $"SELECT COUNT(*) FROM quality.liv_records liv JOIN core.records record_row ON record_row.id=liv.record_id WHERE {whereClause};",
            staffId, academicYear, startDate, endDate, cancellationToken);
        var items = await QueryAsync(
            $"""
            SELECT liv.id, liv.record_id, record_row.title, record_row.record_date,
                   reviewer.display_name, parent.code, area.code, liv.current_stage,
                   liv.status, liv.created_at, liv.updated_at
            FROM quality.liv_records liv
            JOIN core.records record_row ON record_row.id = liv.record_id
            LEFT JOIN people.staff reviewer ON reviewer.id = liv.reviewer_staff_id
            LEFT JOIN org.org_units area ON area.id = liv.org_unit_id
            LEFT JOIN org.org_units parent ON parent.id = area.parent_org_unit_id
            WHERE {whereClause}
            ORDER BY COALESCE(liv.updated_at, liv.created_at) DESC, liv.id
            OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;
            """,
            command => AddPageParameters(command, staffId, academicYear, startDate, endDate, page, pageSize),
            reader => new StaffProfileLivSummary(
                reader.GetGuid(0), reader.GetGuid(1), reader.GetString(2), GetDateOnlyOrNull(reader, 3),
                GetStringOrNull(reader, 4), GetStringOrNull(reader, 5), GetStringOrNull(reader, 6),
                GetStringOrNull(reader, 7) ?? "case_created", reader.GetString(8),
                reader.GetFieldValue<DateTimeOffset>(9), GetDateTimeOffsetOrNull(reader, 10)),
            cancellationToken);
        return CreatePage(items, page, pageSize, total);
    }

    public async Task<PagedResult<StaffProfileProbationSummary>> GetStaffProfileProbationPageAsync(
        Guid staffId, int page, int pageSize, CurrentUser currentUser, CancellationToken cancellationToken)
    {
        (page, pageSize) = NormalizePage(page, pageSize);
        var canViewAll = currentUser.HasPermission(PermissionKeys.ProbationManage)
            || currentUser.HasPermission(PermissionKeys.ReportsViewAll);
        var canViewScoped = currentUser.HasPermission(PermissionKeys.ProbationSubmit)
            || currentUser.HasPermission(PermissionKeys.ReportsViewScoped);
        const string whereClause = """
            probation.subject_staff_id = @staffId
            AND probation.archived_at IS NULL
            AND (
                @canViewAll = 1
                OR probation.subject_staff_id = @currentStaffId
                OR probation.created_by_user_account_id = @currentUserAccountId
                OR EXISTS (
                    SELECT 1 FROM quality.probation_case_reviewers reviewer
                    WHERE reviewer.probation_case_id = probation.id AND reviewer.staff_id = @currentStaffId
                )
                OR (@canViewScoped = 1 AND (
                    EXISTS (SELECT 1 FROM org.fn_visible_staff(@currentUserAccountId) visible WHERE visible.staff_id = probation.subject_staff_id)
                    OR EXISTS (SELECT 1 FROM org.fn_visible_org_units(@currentUserAccountId) visible WHERE visible.org_unit_id = probation.org_unit_id)
                ))
            )
            """;
        var totalRows = await QueryAsync(
            $"SELECT COUNT(*) FROM quality.probation_cases probation WHERE {whereClause};",
            command => AddProbationProfileParameters(command, staffId, currentUser, canViewAll, canViewScoped),
            reader => reader.GetInt32(0),
            cancellationToken);
        var items = await QueryAsync(
            $"""
            SELECT probation.id, probation.record_id, record_row.title, probation.academic_year,
                   probation.status, probation.current_observation_number, parent.code, area.code,
                   probation.created_at, probation.updated_at
            FROM quality.probation_cases probation
            JOIN core.records record_row ON record_row.id = probation.record_id AND record_row.archived_at IS NULL
            LEFT JOIN org.org_units area ON area.id = probation.org_unit_id
            LEFT JOIN org.org_units parent ON parent.id = area.parent_org_unit_id
            WHERE {whereClause}
            ORDER BY COALESCE(probation.updated_at, probation.created_at) DESC, probation.id
            OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;
            """,
            command =>
            {
                AddProbationProfileParameters(command, staffId, currentUser, canViewAll, canViewScoped);
                command.Parameters.AddWithValue("@offset", (page - 1) * pageSize);
                command.Parameters.AddWithValue("@pageSize", pageSize);
            },
            reader => new StaffProfileProbationSummary(
                reader.GetGuid(0), reader.GetGuid(1), reader.GetString(2), reader.GetString(3),
                reader.GetString(4), reader.GetByte(5), GetStringOrNull(reader, 6), GetStringOrNull(reader, 7),
                reader.GetFieldValue<DateTimeOffset>(8), GetDateTimeOffsetOrNull(reader, 9)),
            cancellationToken);
        return CreatePage(items, page, pageSize, totalRows[0]);
    }

    public async Task<PagedResult<StaffProfileActionSummary>> GetStaffProfileActionsPageAsync(
        Guid staffId, string academicYear, int page, int pageSize, CancellationToken cancellationToken)
    {
        (page, pageSize) = NormalizePage(page, pageSize);
        var (startDate, endDate) = await GetAcademicYearBoundsAsync(academicYear, cancellationToken);
        const string whereClause = """
            (action_row.subject_staff_id = @staffId OR action_row.owner_staff_id = @staffId)
            AND action_row.archived_at IS NULL
            AND ((record_row.id IS NOT NULL AND record_row.academic_year_key = @academicYear)
              OR (record_row.id IS NULL AND CONVERT(date, action_row.created_at) BETWEEN @startDate AND @endDate))
            """;
        var total = await CountAsync(
            $"SELECT COUNT(*) FROM quality.actions action_row LEFT JOIN core.records record_row ON record_row.id=action_row.source_record_id WHERE {whereClause};",
            staffId, academicYear, startDate, endDate, cancellationToken);
        var items = await QueryAsync(
            $"""
            SELECT action_row.id, action_row.title, action_row.detail, action_row.created_at, action_row.source_record_id,
                   record_row.title, record_row.record_type, module.name, owner.display_name, status_value.value_key,
                   action_row.due_date, action_row.completed_date
            FROM quality.actions action_row
            JOIN people.staff owner ON owner.id = action_row.owner_staff_id
            LEFT JOIN core.records record_row ON record_row.id = action_row.source_record_id
            LEFT JOIN core.modules module ON module.id = record_row.module_id
            LEFT JOIN core.lookup_values status_value ON status_value.id = action_row.status_lookup_value_id
            WHERE {whereClause}
            ORDER BY CASE WHEN action_row.completed_date IS NULL THEN 0 ELSE 1 END, action_row.due_date, action_row.created_at DESC
            OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;
            """,
            command => AddPageParameters(command, staffId, academicYear, startDate, endDate, page, pageSize),
            reader =>
            {
                var dueDate = GetDateOnlyOrNull(reader, 10);
                var completedDate = GetDateOnlyOrNull(reader, 11);
                return new StaffProfileActionSummary(
                    reader.GetGuid(0), reader.GetString(1), GetStringOrNull(reader, 2), reader.GetFieldValue<DateTimeOffset>(3),
                    GetGuidOrNull(reader, 4), GetStringOrNull(reader, 5), GetStringOrNull(reader, 6), GetStringOrNull(reader, 7),
                    reader.GetString(8), GetStringOrNull(reader, 9), dueDate, completedDate,
                    dueDate.HasValue && completedDate is null && dueDate.Value < DateOnly.FromDateTime(DateTime.UtcNow));
            }, cancellationToken);
        return CreatePage(items, page, pageSize, total);
    }

    private async Task<int> CountAsync(string sql, Guid staffId, string academicYear, DateOnly startDate, DateOnly endDate, CancellationToken cancellationToken)
    {
        var rows = await QueryAsync(sql, command =>
        {
            command.Parameters.AddWithValue("@staffId", staffId);
            command.Parameters.AddWithValue("@academicYear", academicYear);
            command.Parameters.AddWithValue("@startDate", startDate.ToDateTime(TimeOnly.MinValue));
            command.Parameters.AddWithValue("@endDate", endDate.ToDateTime(TimeOnly.MinValue));
        }, reader => reader.GetInt32(0), cancellationToken);
        return rows[0];
    }

    private static void AddPageParameters(Microsoft.Data.SqlClient.SqlCommand command, Guid staffId, string academicYear, DateOnly startDate, DateOnly endDate, int page, int pageSize)
    {
        command.Parameters.AddWithValue("@staffId", staffId);
        command.Parameters.AddWithValue("@academicYear", academicYear);
        command.Parameters.AddWithValue("@startDate", startDate.ToDateTime(TimeOnly.MinValue));
        command.Parameters.AddWithValue("@endDate", endDate.ToDateTime(TimeOnly.MinValue));
        command.Parameters.AddWithValue("@offset", (page - 1) * pageSize);
        command.Parameters.AddWithValue("@pageSize", pageSize);
    }

    private static void AddProbationProfileParameters(
        Microsoft.Data.SqlClient.SqlCommand command,
        Guid staffId,
        CurrentUser currentUser,
        bool canViewAll,
        bool canViewScoped)
    {
        command.Parameters.AddWithValue("@staffId", staffId);
        command.Parameters.AddWithValue("@canViewAll", canViewAll);
        command.Parameters.AddWithValue("@canViewScoped", canViewScoped);
        command.Parameters.AddWithValue("@currentStaffId", ToDbValue(currentUser.StaffId));
        command.Parameters.AddWithValue("@currentUserAccountId", ToDbValue(currentUser.UserAccountId));
    }

    private static (int Page, int PageSize) NormalizePage(int page, int pageSize) => (Math.Max(1, page), Math.Clamp(pageSize, 1, 100));
    private static PagedResult<T> CreatePage<T>(IReadOnlyList<T> items, int page, int pageSize, int total) => new(items, page, pageSize, total, total == 0 ? 0 : (int)Math.Ceiling(total / (double)pageSize));
    private sealed record StaffProfileShellRow(Guid StaffId, string ExternalId, string DisplayName, string Email, string? PrimaryOrgCode, string AccountStatus, int EvidenceSubmitted);
}
