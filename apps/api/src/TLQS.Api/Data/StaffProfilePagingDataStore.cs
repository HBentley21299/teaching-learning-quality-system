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
                   AND EXISTS (SELECT 1 FROM forms.form_submissions submission JOIN forms.form_template_versions version_row ON version_row.id=submission.form_template_version_id JOIN forms.form_templates template ON template.id=version_row.form_template_id WHERE submission.record_id=event_row.record_id AND submission.archived_at IS NULL AND template.template_key=N'cpd_external_self_log')),
                (SELECT COALESCE(SUM(event_row.duration_minutes), 0) FROM cpd.cpd_attendance attendance
                 JOIN cpd.cpd_events event_row ON event_row.id = attendance.cpd_event_id AND event_row.archived_at IS NULL
                 WHERE attendance.staff_id = @staffId AND attendance.attendance_status = N'Attended' AND attendance.archived_at IS NULL
                   AND event_row.event_date BETWEEN @startDate AND @endDate),
                (SELECT COUNT(*) FROM quality.actions action_row
                 LEFT JOIN core.records record_row ON record_row.id = action_row.source_record_id
                 WHERE (action_row.subject_staff_id = @staffId OR action_row.owner_staff_id = @staffId)
                   AND EXISTS (SELECT 1 FROM quality.fn_liv_action_access(action_row.id, @currentUserAccountId))
                   AND action_row.archived_at IS NULL AND action_row.completed_date IS NULL
                   AND NOT EXISTS (SELECT 1 FROM core.lookup_values status_row WHERE status_row.id=action_row.status_lookup_value_id AND status_row.value_key IN (N'cancelled',N'complete'))
                   AND ((record_row.id IS NOT NULL AND record_row.academic_year_key = @academicYear)
                     OR (record_row.id IS NULL AND CONVERT(date, action_row.created_at) BETWEEN @startDate AND @endDate))),
                (SELECT COUNT(*) FROM quality.actions action_row
                 LEFT JOIN core.records record_row ON record_row.id = action_row.source_record_id
                 WHERE (action_row.subject_staff_id = @staffId OR action_row.owner_staff_id = @staffId)
                   AND EXISTS (SELECT 1 FROM quality.fn_liv_action_access(action_row.id, @currentUserAccountId))
                   AND action_row.archived_at IS NULL
                   AND (action_row.completed_date IS NOT NULL OR EXISTS (SELECT 1 FROM core.lookup_values status_row WHERE status_row.id=action_row.status_lookup_value_id AND status_row.value_key=N'complete'))
                   AND NOT EXISTS (SELECT 1 FROM core.lookup_values status_row WHERE status_row.id=action_row.status_lookup_value_id AND status_row.value_key=N'cancelled')
                   AND ((record_row.id IS NOT NULL AND record_row.academic_year_key = @academicYear)
                     OR (record_row.id IS NULL AND CONVERT(date, action_row.created_at) BETWEEN @startDate AND @endDate))),
                (SELECT COUNT(*) FROM quality.actions action_row
                 LEFT JOIN core.records record_row ON record_row.id = action_row.source_record_id
                 WHERE (action_row.subject_staff_id = @staffId OR action_row.owner_staff_id = @staffId)
                   AND EXISTS (SELECT 1 FROM quality.fn_liv_action_access(action_row.id, @currentUserAccountId))
                   AND action_row.archived_at IS NULL AND action_row.completed_date IS NULL
                   AND NOT EXISTS (SELECT 1 FROM core.lookup_values status_row WHERE status_row.id=action_row.status_lookup_value_id AND status_row.value_key IN (N'cancelled',N'complete'))
                   AND action_row.due_date < CONVERT(date, sysutcdatetime())
                   AND ((record_row.id IS NOT NULL AND record_row.academic_year_key = @academicYear)
                     OR (record_row.id IS NULL AND CONVERT(date, action_row.created_at) BETWEEN @startDate AND @endDate))),
                (SELECT COUNT(*) FROM quality.liv_records liv
                 JOIN core.records record_row ON record_row.id = liv.record_id AND record_row.archived_at IS NULL
                 WHERE liv.subject_staff_id = @staffId AND liv.archived_at IS NULL
                   AND record_row.academic_year_key = @academicYear
                   AND (
                       liv.subject_staff_id = @currentStaffId
                       OR (liv.process_key = N'liv' AND @canViewStandardLiv = 1)
                       OR (liv.process_key = N'als_liv' AND @canViewAlsLiv = 1)
                   )),
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
                   )),
                (SELECT COUNT(*) FROM cpd.cpd_attendance attendance
                 JOIN cpd.cpd_events event_row ON event_row.id = attendance.cpd_event_id AND event_row.archived_at IS NULL
                 WHERE attendance.staff_id = @staffId AND attendance.attendance_status = N'Attended' AND attendance.archived_at IS NULL
                   AND event_row.event_date BETWEEN @startDate AND @endDate
                   AND EXISTS (SELECT 1 FROM forms.form_submissions submission JOIN forms.form_template_versions version_row ON version_row.id=submission.form_template_version_id JOIN forms.form_templates template ON template.id=version_row.form_template_id WHERE submission.record_id=event_row.record_id AND submission.archived_at IS NULL AND template.template_key=N'cpd_mandatory'));
            """,
            command =>
            {
                command.Parameters.AddWithValue("@staffId", staffId);
                command.Parameters.AddWithValue("@academicYear", academicYear);
                command.Parameters.AddWithValue("@startDate", startDate.ToDateTime(TimeOnly.MinValue));
                command.Parameters.AddWithValue("@endDate", endDate.ToDateTime(TimeOnly.MinValue));
                command.Parameters.AddWithValue("@canViewAllProbation", currentUser.HasPermission(PermissionKeys.ProbationManage) || currentUser.HasPermission(PermissionKeys.ReportsViewAll));
                command.Parameters.AddWithValue("@canViewScopedProbation", currentUser.HasPermission(PermissionKeys.ProbationSubmit) || currentUser.HasPermission(PermissionKeys.ReportsViewScoped));
                command.Parameters.AddWithValue("@canViewStandardLiv", currentUser.HasPermission(PermissionKeys.ReportsViewAll) || currentUser.HasPermission(PermissionKeys.LivSubmit) || currentUser.HasPermission(PermissionKeys.LivManage));
                command.Parameters.AddWithValue("@canViewAlsLiv", currentUser.HasPermission(PermissionKeys.ReportsViewAll) || currentUser.HasPermission(PermissionKeys.AlsLivSubmit) || currentUser.HasPermission(PermissionKeys.AlsLivManage));
                command.Parameters.AddWithValue("@currentStaffId", ToDbValue(currentUser.StaffId));
                command.Parameters.AddWithValue("@currentUserAccountId", ToDbValue(currentUser.UserAccountId));
            },
            reader => new StaffProfileSectionSummary(
                reader.GetInt32(0), reader.GetInt32(1), reader.GetInt32(2), reader.GetInt32(3),
                reader.GetInt32(4), reader.GetInt32(5), reader.GetInt32(6), reader.GetInt32(7),
                reader.GetInt32(8), reader.GetInt32(9), reader.GetInt32(10), reader.GetInt32(11), reader.GetInt32(12)),
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
        Guid staffId, string academicYear, int page, int pageSize, CancellationToken cancellationToken, ListQuery? query = null)
    {
        (page, pageSize) = NormalizePage(page, pageSize);
        var (startDate, endDate) = await GetAcademicYearBoundsAsync(academicYear, cancellationToken);
        return await QueryStaffProfilePageAsync<StaffCpdRecordSummary>(StaffProfileListSources.Cpd,
            ProfileSortColumns(("date", "EventDate"), ("eventDate", "EventDate"), ("title", "Title"), ("type", "FilterType"), ("themes", "Themes"), ("duration", "DurationMinutes"), ("durationMinutes", "DurationMinutes")),
            "EventDate DESC", query, page, pageSize,
            command => AddProfileListParameters(command, staffId, academicYear, startDate, endDate), cancellationToken);
    }

    public async Task<PagedResult<StaffProfileCoachingSummary>> GetStaffProfileCoachingPageAsync(
        Guid staffId, string academicYear, int page, int pageSize, CancellationToken cancellationToken, ListQuery? query = null)
    {
        (page, pageSize) = NormalizePage(page, pageSize);
        var (startDate, endDate) = await GetAcademicYearBoundsAsync(academicYear, cancellationToken);
        return await QueryStaffProfilePageAsync<StaffProfileCoachingSummary>(StaffProfileListSources.Coaching,
            ProfileSortColumns(("date", "SessionDate"), ("sessionDate", "SessionDate"), ("person", "CoachName"), ("coachName", "CoachName"), ("type", "SessionType"), ("sessionType", "SessionType"), ("status", "Status"), ("focus", "COALESCE(PrimaryFocus, SpecificSessionFocus)"), ("primaryFocus", "PrimaryFocus"), ("specificSessionFocus", "SpecificSessionFocus"), ("cycle", "CycleNumber"), ("cycleNumber", "CycleNumber"), ("session", "SessionNumber"), ("sessionNumber", "SessionNumber")),
            "SessionDate DESC, CycleNumber DESC, SessionNumber DESC", query, page, pageSize,
            command => AddProfileListParameters(command, staffId, academicYear, startDate, endDate), cancellationToken);
    }

    public async Task<PagedResult<StaffProfileLivSummary>> GetStaffProfileLivPageAsync(
        Guid staffId, string academicYear, int page, int pageSize, CurrentUser currentUser, CancellationToken cancellationToken, ListQuery? query = null)
    {
        (page, pageSize) = NormalizePage(page, pageSize);
        var (startDate, endDate) = await GetAcademicYearBoundsAsync(academicYear, cancellationToken);
        return await QueryStaffProfilePageAsync<StaffProfileLivSummary>(StaffProfileListSources.Liv,
            ProfileSortColumns(("date", "RecordDate"), ("recordDate", "RecordDate"), ("title", "Title"), ("person", "ReviewerName"), ("reviewerName", "ReviewerName"), ("type", "ProcessKey"), ("processKey", "ProcessKey"), ("status", "Status"), ("stage", "CurrentStage"), ("currentStage", "CurrentStage"), ("area", "OrgUnitCode"), ("orgUnitCode", "OrgUnitCode"), ("parentOrgUnitCode", "ParentOrgUnitCode"), ("updated", "COALESCE(UpdatedAt, CreatedAt)"), ("updatedAt", "UpdatedAt"), ("createdAt", "CreatedAt")),
            "COALESCE(UpdatedAt, CreatedAt) DESC", query, page, pageSize,
            command => AddLivProfileParameters(command, staffId, academicYear, startDate, endDate, currentUser), cancellationToken);
    }

    public async Task<PagedResult<StaffProfileProbationSummary>> GetStaffProfileProbationPageAsync(
        Guid staffId, int page, int pageSize, CurrentUser currentUser, CancellationToken cancellationToken, ListQuery? query = null)
    {
        (page, pageSize) = NormalizePage(page, pageSize);
        var canViewAll = currentUser.HasPermission(PermissionKeys.ProbationManage) || currentUser.HasPermission(PermissionKeys.ReportsViewAll);
        var canViewScoped = currentUser.HasPermission(PermissionKeys.ProbationSubmit) || currentUser.HasPermission(PermissionKeys.ReportsViewScoped);
        return await QueryStaffProfilePageAsync<StaffProfileProbationSummary>(StaffProfileListSources.Probation,
            ProfileSortColumns(("date", "CreatedAt"), ("createdAt", "CreatedAt"), ("title", "Title"), ("type", "AcademicYear"), ("academicYear", "AcademicYear"), ("status", "Status"), ("observation", "CurrentObservationNumber"), ("currentObservationNumber", "CurrentObservationNumber"), ("area", "OrgUnitCode"), ("orgUnitCode", "OrgUnitCode"), ("parentOrgUnitCode", "ParentOrgUnitCode"), ("updated", "COALESCE(UpdatedAt, CreatedAt)"), ("updatedAt", "UpdatedAt")),
            "COALESCE(UpdatedAt, CreatedAt) DESC", query, page, pageSize,
            command => AddProbationProfileParameters(command, staffId, currentUser, canViewAll, canViewScoped), cancellationToken);
    }

    public async Task<PagedResult<StaffProfileActionSummary>> GetStaffProfileActionsPageAsync(
        Guid staffId, string academicYear, int page, int pageSize, CurrentUser currentUser, CancellationToken cancellationToken, ListQuery? query = null)
    {
        (page, pageSize) = NormalizePage(page, pageSize);
        var (startDate, endDate) = await GetAcademicYearBoundsAsync(academicYear, cancellationToken);
        return await QueryStaffProfilePageAsync<StaffProfileActionSummary>(StaffProfileListSources.Actions,
            ProfileSortColumns(("date", "CreatedAt"), ("createdAt", "CreatedAt"), ("title", "Title"), ("person", "OwnerName"), ("ownerName", "OwnerName"), ("type", "FilterType"), ("sourceRecordType", "SourceRecordType"), ("status", "FilterStatus"), ("statusKey", "FilterStatus"), ("due", "DueDate"), ("dueDate", "DueDate"), ("completed", "CompletedDate"), ("completedDate", "CompletedDate"), ("source", "SourceRecordTitle"), ("sourceRecordTitle", "SourceRecordTitle"), ("sourceModuleName", "SourceModuleName")),
            "CASE WHEN FilterStatus IN (N'open',N'overdue') THEN 0 ELSE 1 END, CASE WHEN DueDate IS NULL THEN 1 ELSE 0 END, DueDate, CreatedAt DESC", query, page, pageSize,
            command =>
            {
                AddProfileListParameters(command, staffId, academicYear, startDate, endDate);
                command.Parameters.AddWithValue("@currentUserAccountId", ToDbValue(currentUser.UserAccountId));
            }, cancellationToken);
    }

    private static IReadOnlyDictionary<string, string> ProfileSortColumns(params (string Key, string Column)[] columns) =>
        columns.ToDictionary(column => column.Key, column => column.Column, StringComparer.OrdinalIgnoreCase);

    private static void AddProfileListParameters(Microsoft.Data.SqlClient.SqlCommand command, Guid staffId, string academicYear, DateOnly startDate, DateOnly endDate)
    {
        command.Parameters.AddWithValue("@staffId", staffId);
        command.Parameters.AddWithValue("@academicYear", academicYear);
        command.Parameters.AddWithValue("@startDate", startDate.ToDateTime(TimeOnly.MinValue));
        command.Parameters.AddWithValue("@endDate", endDate.ToDateTime(TimeOnly.MinValue));
    }

    private async Task<int> CountAsync(string sql, Guid staffId, string academicYear, DateOnly startDate, DateOnly endDate, CancellationToken cancellationToken, CurrentUser? currentUser = null)
    {
        var rows = await QueryAsync(sql, command =>
        {
            command.Parameters.AddWithValue("@staffId", staffId);
            command.Parameters.AddWithValue("@academicYear", academicYear);
            command.Parameters.AddWithValue("@startDate", startDate.ToDateTime(TimeOnly.MinValue));
            command.Parameters.AddWithValue("@endDate", endDate.ToDateTime(TimeOnly.MinValue));
            if (currentUser is not null) command.Parameters.AddWithValue("@currentUserAccountId", ToDbValue(currentUser.UserAccountId));
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

    private static void AddLivProfileParameters(
        Microsoft.Data.SqlClient.SqlCommand command,
        Guid staffId,
        string academicYear,
        DateOnly startDate,
        DateOnly endDate,
        CurrentUser currentUser)
    {
        command.Parameters.AddWithValue("@staffId", staffId);
        command.Parameters.AddWithValue("@academicYear", academicYear);
        command.Parameters.AddWithValue("@startDate", startDate.ToDateTime(TimeOnly.MinValue));
        command.Parameters.AddWithValue("@endDate", endDate.ToDateTime(TimeOnly.MinValue));
        AddLivProfileAccessParameters(command, currentUser);
    }

    private static void AddLivProfileAccessParameters(Microsoft.Data.SqlClient.SqlCommand command, CurrentUser currentUser)
    {
        command.Parameters.AddWithValue("@currentStaffId", ToDbValue(currentUser.StaffId));
        command.Parameters.AddWithValue("@canViewStandardLiv", currentUser.HasPermission(PermissionKeys.ReportsViewAll) || currentUser.HasPermission(PermissionKeys.LivSubmit) || currentUser.HasPermission(PermissionKeys.LivManage));
        command.Parameters.AddWithValue("@canViewAlsLiv", currentUser.HasPermission(PermissionKeys.ReportsViewAll) || currentUser.HasPermission(PermissionKeys.AlsLivSubmit) || currentUser.HasPermission(PermissionKeys.AlsLivManage));
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
