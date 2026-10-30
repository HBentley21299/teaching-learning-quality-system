namespace TLQS.Api.Data;

internal static class StaffProfileListSources
{
    public const string Cpd = """
        SELECT event_row.id AS Id, event_row.record_id AS RecordId, event_row.event_title AS Title, CONVERT(date,event_row.event_date) AS EventDate,
               themes.response_text AS Themes, event_row.duration_minutes AS DurationMinutes,
               CONVERT(bit,CASE WHEN template_info.template_key=N'cpd_core' THEN 1 ELSE 0 END) AS IsInternal,
               CONVERT(bit,CASE WHEN template_info.template_key=N'cpd_mandatory' THEN 1 ELSE 0 END) AS IsMandatory,
               attendance.attendance_status AS FilterStatus,
               CASE WHEN template_info.template_key=N'cpd_core' THEN N'internal' WHEN template_info.template_key=N'cpd_mandatory' THEN N'mandatory' ELSE N'external' END AS FilterType,
               CAST(NULL AS nvarchar(300)) AS FilterPerson, CONVERT(date,event_row.event_date) AS FilterDate,
               CONCAT(event_row.event_title,N' ',CONVERT(nvarchar(10),event_row.event_date,23),N' ',CONVERT(nvarchar(11),event_row.event_date,106),N' ',themes.response_text,N' ',event_row.duration_minutes,N' minutes ',attendance.attendance_status,N' ',
                   CASE WHEN template_info.template_key=N'cpd_core' THEN N'internal' WHEN template_info.template_key=N'cpd_mandatory' THEN N'mandatory' ELSE N'external' END) AS SearchText
        FROM cpd.cpd_attendance attendance
        JOIN cpd.cpd_events event_row ON event_row.id=attendance.cpd_event_id AND event_row.archived_at IS NULL
        OUTER APPLY (SELECT TOP (1) response.response_text FROM forms.form_submissions submission
                     JOIN forms.form_responses response ON response.form_submission_id=submission.id AND response.archived_at IS NULL
                     JOIN forms.form_fields field_row ON field_row.id=response.form_field_id AND field_row.field_key=N'cpd_themes'
                     WHERE submission.record_id=event_row.record_id AND submission.archived_at IS NULL ORDER BY submission.created_at DESC) themes
        OUTER APPLY (SELECT TOP (1) template.template_key FROM forms.form_submissions submission
                     JOIN forms.form_template_versions version_row ON version_row.id=submission.form_template_version_id
                     JOIN forms.form_templates template ON template.id=version_row.form_template_id
                     WHERE submission.record_id=event_row.record_id AND submission.archived_at IS NULL ORDER BY submission.created_at DESC) template_info
        WHERE attendance.staff_id=@staffId AND attendance.archived_at IS NULL AND attendance.attendance_status=N'Attended'
          AND event_row.event_date BETWEEN @startDate AND @endDate
        """;

    public const string Coaching = """
        SELECT session.id AS Id, session.record_id AS RecordId, cycle.cycle_number AS CycleNumber, session.session_number AS SessionNumber,
               CONVERT(date,session.session_date) AS SessionDate, session.session_type AS SessionType, session.status AS Status,
               coach.display_name AS CoachName, focus.display_name AS PrimaryFocus, session.specific_session_focus AS SpecificSessionFocus,
               session.status AS FilterStatus, session.session_type AS FilterType, coach.display_name AS FilterPerson,
               CONVERT(date,session.session_date) AS FilterDate,
               CONCAT(cycle.cycle_number,N' cycle ',session.session_number,N' session ',CONVERT(nvarchar(10),session.session_date,23),N' ',CONVERT(nvarchar(11),session.session_date,106),N' ',session.session_type,N' ',REPLACE(session.session_type,N'_',N' '),N' ',session.status,N' ',REPLACE(session.status,N'_',N' '),N' ',coach.display_name,N' ',focus.display_name,N' ',session.specific_session_focus) AS SearchText
        FROM quality.coaching_sessions session
        JOIN quality.coaching_cycles cycle ON cycle.id=session.cycle_id AND cycle.archived_at IS NULL
        JOIN people.staff coach ON coach.id=session.coach_staff_id
        LEFT JOIN core.lookup_values focus ON focus.id=session.primary_focus_lookup_value_id
        WHERE session.staff_id=@staffId AND session.archived_at IS NULL AND session.session_date BETWEEN @startDate AND @endDate
        """;

    public const string Liv = """
        SELECT liv.id AS Id, liv.record_id AS RecordId, record_row.title AS Title, record_row.record_date AS RecordDate,
               reviewer.display_name AS ReviewerName, parent.code AS ParentOrgUnitCode, area.code AS OrgUnitCode,
               COALESCE(liv.current_stage,N'case_created') AS CurrentStage, liv.status AS Status,
               liv.created_at AS CreatedAt, liv.updated_at AS UpdatedAt, liv.process_key AS ProcessKey,
               liv.status AS FilterStatus, liv.process_key AS FilterType, reviewer.display_name AS FilterPerson,
               CONVERT(date,record_row.record_date) AS FilterDate,
               CONCAT(record_row.title,N' ',CONVERT(nvarchar(10),record_row.record_date,23),N' ',CONVERT(nvarchar(11),record_row.record_date,106),N' ',reviewer.display_name,N' ',parent.code,N' ',area.code,N' ',liv.current_stage,N' ',REPLACE(liv.current_stage,N'_',N' '),N' ',liv.status,N' ',REPLACE(liv.status,N'_',N' '),N' ',liv.process_key,N' ',REPLACE(liv.process_key,N'_',N' ')) AS SearchText
        FROM quality.liv_records liv
        JOIN core.records record_row ON record_row.id=liv.record_id
        LEFT JOIN people.staff reviewer ON reviewer.id=liv.reviewer_staff_id
        LEFT JOIN org.org_units area ON area.id=liv.org_unit_id
        LEFT JOIN org.org_units parent ON parent.id=area.parent_org_unit_id AND parent.org_unit_type=N'faculty'
        WHERE liv.subject_staff_id=@staffId AND liv.archived_at IS NULL AND record_row.archived_at IS NULL
          AND record_row.academic_year_key=@academicYear
          AND (liv.subject_staff_id=@currentStaffId OR (liv.process_key=N'liv' AND @canViewStandardLiv=1) OR (liv.process_key=N'als_liv' AND @canViewAlsLiv=1))
        """;

    public const string Probation = """
        SELECT probation.id AS Id, probation.record_id AS RecordId, record_row.title AS Title, probation.academic_year AS AcademicYear,
               probation.status AS Status, probation.current_observation_number AS CurrentObservationNumber,
               parent.code AS ParentOrgUnitCode, area.code AS OrgUnitCode, probation.created_at AS CreatedAt, probation.updated_at AS UpdatedAt,
               probation.status AS FilterStatus, probation.academic_year AS FilterType, CAST(NULL AS nvarchar(300)) AS FilterPerson,
               CONVERT(date,probation.created_at) AS FilterDate,
               CONCAT(record_row.title,N' ',probation.academic_year,N' ',probation.status,N' ',REPLACE(probation.status,N'_',N' '),N' observation ',probation.current_observation_number,N' ',parent.code,N' ',area.code,N' ',CONVERT(nvarchar(10),probation.created_at,23),N' ',CONVERT(nvarchar(11),probation.created_at,106)) AS SearchText
        FROM quality.probation_cases probation
        JOIN core.records record_row ON record_row.id=probation.record_id AND record_row.archived_at IS NULL
        LEFT JOIN org.org_units area ON area.id=probation.org_unit_id
        LEFT JOIN org.org_units parent ON parent.id=area.parent_org_unit_id AND parent.org_unit_type=N'faculty'
        WHERE probation.subject_staff_id=@staffId AND probation.archived_at IS NULL
          AND (@canViewAll=1 OR probation.subject_staff_id=@currentStaffId OR probation.created_by_user_account_id=@currentUserAccountId
            OR EXISTS (SELECT 1 FROM quality.probation_case_reviewers reviewer WHERE reviewer.probation_case_id=probation.id AND reviewer.staff_id=@currentStaffId)
            OR (@canViewScoped=1 AND (
                EXISTS (SELECT 1 FROM org.fn_visible_staff(@currentUserAccountId) visible WHERE visible.staff_id=probation.subject_staff_id)
                OR EXISTS (SELECT 1 FROM org.fn_visible_org_units(@currentUserAccountId) visible WHERE visible.org_unit_id=probation.org_unit_id))))
        """;

    public const string Actions = """
        SELECT action_row.id AS Id, action_row.title AS Title, action_row.detail AS Detail, action_row.created_at AS CreatedAt,
               action_row.source_record_id AS SourceRecordId, record_row.title AS SourceRecordTitle, record_row.record_type AS SourceRecordType,
               module.name AS SourceModuleName, owner.display_name AS OwnerName, status_value.value_key AS StatusKey,
               action_row.due_date AS DueDate, action_row.completed_date AS CompletedDate,
               CONVERT(bit,CASE WHEN state.FilterStatus=N'overdue' THEN 1 ELSE 0 END) AS IsOverdue,
               state.FilterStatus, COALESCE(record_row.record_type,N'standalone') AS FilterType, owner.display_name AS FilterPerson,
               CONVERT(date,action_row.created_at) AS FilterDate,
               CONCAT(action_row.title,N' ',action_row.detail,N' ',record_row.title,N' ',record_row.record_type,N' ',REPLACE(record_row.record_type,N'_',N' '),N' ',module.name,N' ',owner.display_name,N' ',state.FilterStatus,N' ',CONVERT(nvarchar(10),action_row.created_at,23),N' ',CONVERT(nvarchar(11),action_row.created_at,106),N' ',CONVERT(nvarchar(10),action_row.due_date,23),N' ',CONVERT(nvarchar(11),action_row.due_date,106),N' ',CONVERT(nvarchar(10),action_row.completed_date,23),N' ',CONVERT(nvarchar(11),action_row.completed_date,106)) AS SearchText
        FROM quality.actions action_row
        JOIN people.staff owner ON owner.id=action_row.owner_staff_id
        LEFT JOIN core.records record_row ON record_row.id=action_row.source_record_id
        LEFT JOIN core.modules module ON module.id=record_row.module_id
        LEFT JOIN core.lookup_values status_value ON status_value.id=action_row.status_lookup_value_id
        CROSS APPLY (SELECT CASE WHEN status_value.value_key=N'cancelled' THEN N'cancelled'
            WHEN action_row.completed_date IS NOT NULL OR status_value.value_key=N'complete' THEN N'complete'
            WHEN action_row.due_date<CONVERT(date,sysutcdatetime()) THEN N'overdue' ELSE N'open' END AS FilterStatus) state
        WHERE (action_row.subject_staff_id=@staffId OR action_row.owner_staff_id=@staffId) AND action_row.archived_at IS NULL
          AND EXISTS (SELECT 1 FROM quality.fn_liv_action_access(action_row.id,@currentUserAccountId))
          AND ((record_row.id IS NOT NULL AND record_row.academic_year_key=@academicYear)
            OR (record_row.id IS NULL AND CONVERT(date,action_row.created_at) BETWEEN @startDate AND @endDate))
        """;
}
