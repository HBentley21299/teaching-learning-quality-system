SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

CREATE OR ALTER VIEW reporting.v_staff_profile_summary
AS
WITH cpd_totals AS (
    SELECT
        attendance.staff_id,
        COUNT_BIG(*) AS cpd_sessions_attended
    FROM cpd.cpd_attendance attendance
    WHERE attendance.archived_at IS NULL
      AND attendance.attendance_status = 'Attended'
    GROUP BY attendance.staff_id
),
evidence_totals AS (
    SELECT
        evidence_item.staff_id,
        COUNT_BIG(*) AS evidence_records
    FROM evidence.evidence_items evidence_item
    WHERE evidence_item.archived_at IS NULL
    GROUP BY evidence_item.staff_id
),
action_totals AS (
    SELECT
        action_item.subject_staff_id AS staff_id,
        COUNT_BIG(*) AS open_actions,
        SUM(CASE
            WHEN action_item.due_date < CONVERT(date, sysutcdatetime()) THEN CONVERT(bigint, 1)
            ELSE CONVERT(bigint, 0)
        END) AS overdue_actions
    FROM quality.actions action_item
    WHERE action_item.archived_at IS NULL
      AND action_item.completed_date IS NULL
      AND action_item.subject_staff_id IS NOT NULL
    GROUP BY action_item.subject_staff_id
)
SELECT
    staff.id AS staff_id,
    staff.external_id,
    staff.display_name,
    staff.email,
    staff.job_title,
    org_unit.code AS primary_org_code,
    org_unit.name AS primary_org_name,
    COALESCE(cpd_totals.cpd_sessions_attended, 0) AS cpd_sessions_attended,
    COALESCE(evidence_totals.evidence_records, 0) AS evidence_records,
    COALESCE(action_totals.open_actions, 0) AS open_actions,
    COALESCE(action_totals.overdue_actions, 0) AS overdue_actions
FROM people.staff staff
LEFT JOIN org.org_units org_unit ON org_unit.id = staff.primary_org_unit_id
LEFT JOIN cpd_totals ON cpd_totals.staff_id = staff.id
LEFT JOIN evidence_totals ON evidence_totals.staff_id = staff.id
LEFT JOIN action_totals ON action_totals.staff_id = staff.id
WHERE staff.archived_at IS NULL;
GO
