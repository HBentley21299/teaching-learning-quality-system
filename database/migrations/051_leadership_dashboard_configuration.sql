SET XACT_ABORT ON;
GO

BEGIN TRANSACTION;

DECLARE @configuration nvarchar(max) = N'{
  "schemaVersion": 2,
  "processes": [
    { "processKey": "overview", "label": "Executive overview", "isEnabled": true, "displayOrder": 10, "primaryVisual": "bar", "showTrend": true, "showAreaComparison": true, "showOutcomes": true, "showActions": true },
    { "processKey": "learning_walk", "label": "Learning Walks", "isEnabled": true, "displayOrder": 20, "primaryVisual": "bar", "showTrend": true, "showAreaComparison": true, "showOutcomes": true, "showActions": true },
    { "processKey": "liv", "label": "LIV", "isEnabled": true, "displayOrder": 30, "primaryVisual": "bar", "showTrend": true, "showAreaComparison": true, "showOutcomes": true, "showActions": true },
    { "processKey": "eli", "label": "Elevate Learning and Innovation", "isEnabled": true, "displayOrder": 40, "primaryVisual": "bar", "showTrend": true, "showAreaComparison": true, "showOutcomes": true, "showActions": false },
    { "processKey": "probation_case", "label": "Probationary Observations", "isEnabled": true, "displayOrder": 50, "primaryVisual": "bar", "showTrend": true, "showAreaComparison": true, "showOutcomes": true, "showActions": true },
    { "processKey": "elevate_environment", "label": "Elevate Environments", "isEnabled": true, "displayOrder": 60, "primaryVisual": "bar", "showTrend": true, "showAreaComparison": true, "showOutcomes": true, "showActions": true },
    { "processKey": "coaching_session", "label": "Coaching and Mentoring", "isEnabled": true, "displayOrder": 70, "primaryVisual": "donut", "showTrend": true, "showAreaComparison": true, "showOutcomes": true, "showActions": true },
    { "processKey": "work_scrutiny", "label": "Work Scrutiny", "isEnabled": true, "displayOrder": 80, "primaryVisual": "bar", "showTrend": true, "showAreaComparison": true, "showOutcomes": true, "showActions": true },
    { "processKey": "cpd_event", "label": "CPD", "isEnabled": true, "displayOrder": 90, "primaryVisual": "bar", "showTrend": true, "showAreaComparison": true, "showOutcomes": true, "showActions": false },
    { "processKey": "actions", "label": "Actions", "isEnabled": true, "displayOrder": 100, "primaryVisual": "donut", "showTrend": true, "showAreaComparison": true, "showOutcomes": true, "showActions": true }
  ]
}';

UPDATE reporting.dashboards
SET config_json = @configuration,
    purpose = CASE dashboard_key
        WHEN N'tl_overview' THEN N'Whole-organisation leadership intelligence across quality, development and assurance processes.'
        ELSE N'Permission-scoped leadership intelligence for managers and curriculum leaders.'
    END,
    updated_at = sysutcdatetime()
WHERE dashboard_key IN (N'tl_overview', N'faculty_dashboard')
  AND archived_at IS NULL
  AND (config_json IS NULL OR config_json NOT LIKE N'%"schemaVersion": 2%');

COMMIT TRANSACTION;
GO
