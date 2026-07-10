SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

CREATE OR ALTER VIEW reporting.v_staff_profile_summary
AS
SELECT
    s.id AS staff_id,
    s.external_id,
    s.display_name,
    s.email,
    s.job_title,
    ou.code AS primary_org_code,
    ou.name AS primary_org_name,
    COUNT(DISTINCT ca.id) AS cpd_sessions_attended,
    COUNT(DISTINCT ev.id) AS evidence_records,
    COUNT(DISTINCT CASE WHEN act.completed_date IS NULL AND act.archived_at IS NULL THEN act.id END) AS open_actions,
    COUNT(DISTINCT CASE WHEN act.completed_date IS NULL AND act.due_date < CONVERT(date, sysutcdatetime()) AND act.archived_at IS NULL THEN act.id END) AS overdue_actions
FROM people.staff s
LEFT JOIN org.org_units ou ON ou.id = s.primary_org_unit_id
LEFT JOIN cpd.cpd_attendance ca ON ca.staff_id = s.id AND ca.archived_at IS NULL AND ca.attendance_status = 'Attended'
LEFT JOIN evidence.evidence_items ev ON ev.staff_id = s.id AND ev.archived_at IS NULL
LEFT JOIN quality.actions act ON act.subject_staff_id = s.id AND act.archived_at IS NULL
WHERE s.archived_at IS NULL
GROUP BY s.id, s.external_id, s.display_name, s.email, s.job_title, ou.code, ou.name;
GO

CREATE OR ALTER VIEW reporting.v_dashboard_activity_overview
AS
SELECT
    m.module_key,
    m.name AS module_name,
    r.record_type,
    r.org_unit_id,
    ou.code AS org_unit_code,
    ou.name AS org_unit_name,
    COUNT_BIG(*) AS record_count,
    MIN(r.record_date) AS first_record_date,
    MAX(r.record_date) AS latest_record_date
FROM core.records r
JOIN core.modules m ON m.id = r.module_id
LEFT JOIN org.org_units ou ON ou.id = r.org_unit_id
WHERE r.archived_at IS NULL
GROUP BY m.module_key, m.name, r.record_type, r.org_unit_id, ou.code, ou.name;
GO

CREATE OR ALTER VIEW reporting.v_open_actions_by_org
AS
SELECT
    COALESCE(r.org_unit_id, owner.primary_org_unit_id, subject.primary_org_unit_id) AS org_unit_id,
    ou.code AS org_unit_code,
    ou.name AS org_unit_name,
    COUNT_BIG(*) AS open_actions,
    SUM(CASE WHEN a.due_date < CONVERT(date, sysutcdatetime()) THEN 1 ELSE 0 END) AS overdue_actions,
    SUM(CASE WHEN priority.value_key = 'high' THEN 1 ELSE 0 END) AS high_priority_actions
FROM quality.actions a
LEFT JOIN core.records r ON r.id = a.source_record_id
LEFT JOIN people.staff owner ON owner.id = a.owner_staff_id
LEFT JOIN people.staff subject ON subject.id = a.subject_staff_id
LEFT JOIN org.org_units ou ON ou.id = COALESCE(r.org_unit_id, owner.primary_org_unit_id, subject.primary_org_unit_id)
LEFT JOIN core.lookup_values priority ON priority.id = a.priority_lookup_value_id
WHERE a.archived_at IS NULL AND a.completed_date IS NULL
GROUP BY COALESCE(r.org_unit_id, owner.primary_org_unit_id, subject.primary_org_unit_id), ou.code, ou.name;
GO

CREATE OR ALTER VIEW reporting.v_cpd_milestones
AS
SELECT
    s.id AS staff_id,
    s.external_id,
    s.display_name,
    s.primary_org_unit_id,
    ou.code AS org_unit_code,
    SUM(CASE WHEN ca.attendance_status = 'Attended' THEN ca.milestone_credit ELSE 0 END) AS attendance_credits,
    CASE
        WHEN SUM(CASE WHEN ca.attendance_status = 'Attended' THEN ca.milestone_credit ELSE 0 END) >= 15 THEN 15
        WHEN SUM(CASE WHEN ca.attendance_status = 'Attended' THEN ca.milestone_credit ELSE 0 END) >= 12 THEN 12
        WHEN SUM(CASE WHEN ca.attendance_status = 'Attended' THEN ca.milestone_credit ELSE 0 END) >= 9 THEN 9
        WHEN SUM(CASE WHEN ca.attendance_status = 'Attended' THEN ca.milestone_credit ELSE 0 END) >= 6 THEN 6
        WHEN SUM(CASE WHEN ca.attendance_status = 'Attended' THEN ca.milestone_credit ELSE 0 END) >= 3 THEN 3
        ELSE 0
    END AS achieved_milestone,
    CASE
        WHEN SUM(CASE WHEN ca.attendance_status = 'Attended' THEN ca.milestone_credit ELSE 0 END) < 3 THEN 3
        WHEN SUM(CASE WHEN ca.attendance_status = 'Attended' THEN ca.milestone_credit ELSE 0 END) < 6 THEN 6
        WHEN SUM(CASE WHEN ca.attendance_status = 'Attended' THEN ca.milestone_credit ELSE 0 END) < 9 THEN 9
        WHEN SUM(CASE WHEN ca.attendance_status = 'Attended' THEN ca.milestone_credit ELSE 0 END) < 12 THEN 12
        WHEN SUM(CASE WHEN ca.attendance_status = 'Attended' THEN ca.milestone_credit ELSE 0 END) < 15 THEN 15
        ELSE NULL
    END AS next_milestone
FROM people.staff s
LEFT JOIN org.org_units ou ON ou.id = s.primary_org_unit_id
LEFT JOIN cpd.cpd_attendance ca ON ca.staff_id = s.id AND ca.archived_at IS NULL
WHERE s.archived_at IS NULL
GROUP BY s.id, s.external_id, s.display_name, s.primary_org_unit_id, ou.code;
GO
