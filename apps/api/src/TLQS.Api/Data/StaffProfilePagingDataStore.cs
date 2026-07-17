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
                     OR (record_row.id IS NULL AND CONVERT(date, action_row.created_at) BETWEEN @startDate AND @endDate)));
            """,
            command =>
            {
                command.Parameters.AddWithValue("@staffId", staffId);
                command.Parameters.AddWithValue("@academicYear", academicYear);
                command.Parameters.AddWithValue("@startDate", startDate.ToDateTime(TimeOnly.MinValue));
                command.Parameters.AddWithValue("@endDate", endDate.ToDateTime(TimeOnly.MinValue));
            },
            reader => new StaffProfileSectionSummary(
                reader.GetInt32(0), reader.GetInt32(1), reader.GetInt32(2), reader.GetInt32(3),
                reader.GetInt32(4), reader.GetInt32(5), reader.GetInt32(6)),
            cancellationToken);
        return rows[0];
    }

    public async Task<PagedResult<StaffReflectionSummary>> GetStaffProfileReflectionsPageAsync(
        Guid staffId, string academicYear, int page, int pageSize, CancellationToken cancellationToken)
    {
        (page, pageSize) = NormalizePage(page, pageSize);
        var allForStaff = await GetStaffReflectionsAsync(staffId, cancellationToken);
        var matching = allForStaff.Where(item => string.Equals(item.ElevatePracticeAcademicYear, academicYear, StringComparison.OrdinalIgnoreCase)).ToArray();
        return Page(matching, page, pageSize);
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
            SELECT event_row.id, event_row.event_title, event_row.event_date, themes.response_text, event_row.duration_minutes,
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
            reader => new StaffCpdRecordSummary(reader.GetGuid(0), reader.GetString(1), DateOnly.FromDateTime(reader.GetDateTime(2)), GetStringOrNull(reader, 3), GetIntOrNull(reader, 4), reader.GetBoolean(5)),
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

    private static (int Page, int PageSize) NormalizePage(int page, int pageSize) => (Math.Max(1, page), Math.Clamp(pageSize, 1, 100));
    private static PagedResult<T> Page<T>(IReadOnlyList<T> all, int page, int pageSize) => CreatePage(all.Skip((page - 1) * pageSize).Take(pageSize).ToArray(), page, pageSize, all.Count);
    private static PagedResult<T> CreatePage<T>(IReadOnlyList<T> items, int page, int pageSize, int total) => new(items, page, pageSize, total, total == 0 ? 0 : (int)Math.Ceiling(total / (double)pageSize));
    private sealed record StaffProfileShellRow(Guid StaffId, string ExternalId, string DisplayName, string Email, string? PrimaryOrgCode, string AccountStatus, int EvidenceSubmitted);
}
