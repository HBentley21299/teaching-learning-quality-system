SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO

IF COL_LENGTH(N'cpd.cpd_events', N'duration_minutes') IS NULL
BEGIN
    ALTER TABLE cpd.cpd_events ADD duration_minutes int NULL;
END;
GO

BEGIN TRANSACTION;

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = N'ck_cpd_events_duration_minutes'
      AND parent_object_id = OBJECT_ID(N'cpd.cpd_events')
)
BEGIN
    ALTER TABLE cpd.cpd_events WITH CHECK ADD CONSTRAINT ck_cpd_events_duration_minutes
        CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 1499);
END;

DECLARE @selfLogPermissionId uniqueidentifier = CONVERT(uniqueidentifier, '19500000-0000-0000-0000-000000000001');

INSERT INTO auth.permissions (id, permission_key, name, description, category, is_system)
SELECT @selfLogPermissionId, N'cpd.self_log', N'Log own external CPD',
       N'Create and maintain external CPD records for the signed-in staff member.', N'CPD', 1
WHERE NOT EXISTS (
    SELECT 1 FROM auth.permissions WHERE permission_key = N'cpd.self_log'
);

SET @selfLogPermissionId = (
    SELECT id FROM auth.permissions WHERE permission_key = N'cpd.self_log' AND archived_at IS NULL
);

INSERT INTO auth.role_permissions (role_id, permission_id)
SELECT role.id, @selfLogPermissionId
FROM auth.roles role
WHERE role.is_active = 1
  AND role.archived_at IS NULL
  AND @selfLogPermissionId IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM auth.role_permissions existing
      WHERE existing.role_id = role.id
        AND existing.permission_id = @selfLogPermissionId
  );

DECLARE @cpdModuleId uniqueidentifier = (
    SELECT id FROM core.modules WHERE module_key = N'cpd' AND archived_at IS NULL
);
DECLARE @adminUserId uniqueidentifier = (
    SELECT TOP (1) account.id
    FROM auth.user_accounts account
    JOIN auth.user_roles user_role ON user_role.user_account_id = account.id
    JOIN auth.roles role ON role.id = user_role.role_id
    WHERE role.role_key = N'super_admin'
      AND account.archived_at IS NULL
    ORDER BY account.created_at
);

-- Publish a new managed-event version so historical submissions retain their original form definition.
DECLARE @managedTemplateId uniqueidentifier = (
    SELECT id FROM forms.form_templates WHERE template_key = N'cpd_core' AND archived_at IS NULL
);
DECLARE @managedVersionId uniqueidentifier = CONVERT(uniqueidentifier, '19500000-0000-0000-0000-000000000010');
DECLARE @managedActivitySectionId uniqueidentifier = CONVERT(uniqueidentifier, '19500000-0000-0000-0000-000000000011');
DECLARE @managedThemesSectionId uniqueidentifier = CONVERT(uniqueidentifier, '19500000-0000-0000-0000-000000000012');
DECLARE @managedParticipantsSectionId uniqueidentifier = CONVERT(uniqueidentifier, '19500000-0000-0000-0000-000000000013');

IF @managedTemplateId IS NOT NULL
BEGIN
    INSERT INTO forms.form_template_versions (
        id, form_template_id, version_label, active_from, is_published, created_by_user_account_id
    )
    SELECT @managedVersionId, @managedTemplateId, N'2.0', sysutcdatetime(), 1, @adminUserId
    WHERE NOT EXISTS (
        SELECT 1 FROM forms.form_template_versions WHERE id = @managedVersionId
    );

    INSERT INTO forms.form_sections (id, form_template_version_id, section_key, title, display_order)
    SELECT value.id, @managedVersionId, value.section_key, value.title, value.display_order
    FROM (VALUES
        (@managedActivitySectionId, N'activity_details', N'Activity details', 10),
        (@managedThemesSectionId, N'themes', N'Themes', 20),
        (@managedParticipantsSectionId, N'participants', N'Participants', 30)
    ) value(id, section_key, title, display_order)
    WHERE NOT EXISTS (
        SELECT 1 FROM forms.form_sections existing WHERE existing.id = value.id
    );

    INSERT INTO forms.form_fields (
        id, form_section_id, field_key, label, field_type, is_required, display_order, help_text
    )
    SELECT value.id, value.section_id, value.field_key, value.label, value.field_type,
           value.is_required, value.display_order, value.help_text
    FROM (VALUES
        (CONVERT(uniqueidentifier, '19500000-0000-0000-0000-000000000020'), @managedActivitySectionId, N'date_time', N'Date and time', N'datetime', 1, 10, CONVERT(nvarchar(500), NULL)),
        (CONVERT(uniqueidentifier, '19500000-0000-0000-0000-000000000021'), @managedActivitySectionId, N'cpd_title', N'CPD title', N'short_text', 1, 20, NULL),
        (CONVERT(uniqueidentifier, '19500000-0000-0000-0000-000000000022'), @managedActivitySectionId, N'delivery_mode', N'Delivery mode', N'single_select', 1, 30, NULL),
        (CONVERT(uniqueidentifier, '19500000-0000-0000-0000-000000000023'), @managedActivitySectionId, N'duration_hours', N'Duration hours', N'number', 1, 40, N'Enter a value from 0 to 24.'),
        (CONVERT(uniqueidentifier, '19500000-0000-0000-0000-000000000024'), @managedActivitySectionId, N'duration_minutes', N'Duration minutes', N'number', 1, 50, N'Enter a value from 0 to 59.'),
        (CONVERT(uniqueidentifier, '19500000-0000-0000-0000-000000000025'), @managedThemesSectionId, N'cpd_themes', N'CPD theme', N'checkbox_group', 1, 10, N'Select every theme that applies.'),
        (CONVERT(uniqueidentifier, '19500000-0000-0000-0000-000000000026'), @managedParticipantsSectionId, N'staff_search', N'Staff search and selection', N'staff_multi_select', 1, 10, N'Selected staff receive CPD attendance credit when the event is submitted.'),
        (CONVERT(uniqueidentifier, '19500000-0000-0000-0000-000000000027'), @managedParticipantsSectionId, N'bulk_upload_by_team_code', N'Bulk upload by team code', N'team_bulk_add', 0, 20, NULL),
        (CONVERT(uniqueidentifier, '19500000-0000-0000-0000-000000000028'), @managedParticipantsSectionId, N'selected_staff_list', N'Selected staff list', N'selected_staff_list', 0, 30, NULL)
    ) value(id, section_id, field_key, label, field_type, is_required, display_order, help_text)
    WHERE NOT EXISTS (
        SELECT 1 FROM forms.form_fields existing WHERE existing.id = value.id
    );
END;

-- A separate system template allows every user to record only their own external CPD.
DECLARE @externalTemplateId uniqueidentifier = CONVERT(uniqueidentifier, '19500000-0000-0000-0000-000000000100');
DECLARE @externalVersionId uniqueidentifier = CONVERT(uniqueidentifier, '19500000-0000-0000-0000-000000000101');
DECLARE @externalActivitySectionId uniqueidentifier = CONVERT(uniqueidentifier, '19500000-0000-0000-0000-000000000102');
DECLARE @externalThemesSectionId uniqueidentifier = CONVERT(uniqueidentifier, '19500000-0000-0000-0000-000000000103');

IF @cpdModuleId IS NOT NULL
BEGIN
    INSERT INTO forms.form_templates (id, module_id, template_key, name, description, is_active)
    SELECT @externalTemplateId, @cpdModuleId, N'cpd_external_self_log', N'Log external CPD',
           N'Staff self-service record for external professional development.', 1
    WHERE NOT EXISTS (
        SELECT 1 FROM forms.form_templates WHERE template_key = N'cpd_external_self_log'
    );

    SET @externalTemplateId = (
        SELECT id FROM forms.form_templates WHERE template_key = N'cpd_external_self_log'
    );

    INSERT INTO forms.form_template_versions (
        id, form_template_id, version_label, active_from, is_published, created_by_user_account_id
    )
    SELECT @externalVersionId, @externalTemplateId, N'1.0', sysutcdatetime(), 1, @adminUserId
    WHERE NOT EXISTS (
        SELECT 1 FROM forms.form_template_versions WHERE id = @externalVersionId
    );

    INSERT INTO forms.form_sections (id, form_template_version_id, section_key, title, display_order)
    SELECT value.id, @externalVersionId, value.section_key, value.title, value.display_order
    FROM (VALUES
        (@externalActivitySectionId, N'activity_details', N'Activity details', 10),
        (@externalThemesSectionId, N'themes', N'Themes', 20)
    ) value(id, section_key, title, display_order)
    WHERE NOT EXISTS (
        SELECT 1 FROM forms.form_sections existing WHERE existing.id = value.id
    );

    INSERT INTO forms.form_fields (
        id, form_section_id, field_key, label, field_type, is_required, display_order, help_text
    )
    SELECT value.id, value.section_id, value.field_key, value.label, value.field_type,
           value.is_required, value.display_order, value.help_text
    FROM (VALUES
        (CONVERT(uniqueidentifier, '19500000-0000-0000-0000-000000000110'), @externalActivitySectionId, N'date_time', N'Date and time', N'datetime', 1, 10, CONVERT(nvarchar(500), NULL)),
        (CONVERT(uniqueidentifier, '19500000-0000-0000-0000-000000000111'), @externalActivitySectionId, N'cpd_title', N'CPD title', N'short_text', 1, 20, NULL),
        (CONVERT(uniqueidentifier, '19500000-0000-0000-0000-000000000112'), @externalActivitySectionId, N'delivery_mode', N'Delivery mode', N'single_select', 1, 30, NULL),
        (CONVERT(uniqueidentifier, '19500000-0000-0000-0000-000000000113'), @externalActivitySectionId, N'duration_hours', N'Duration hours', N'number', 1, 40, N'Enter a value from 0 to 24.'),
        (CONVERT(uniqueidentifier, '19500000-0000-0000-0000-000000000114'), @externalActivitySectionId, N'duration_minutes', N'Duration minutes', N'number', 1, 50, N'Enter a value from 0 to 59.'),
        (CONVERT(uniqueidentifier, '19500000-0000-0000-0000-000000000115'), @externalThemesSectionId, N'cpd_themes', N'CPD theme', N'checkbox_group', 1, 10, N'Select every theme that applies.')
    ) value(id, section_id, field_key, label, field_type, is_required, display_order, help_text)
    WHERE NOT EXISTS (
        SELECT 1 FROM forms.form_fields existing WHERE existing.id = value.id
    );
END;

COMMIT TRANSACTION;
GO

CREATE OR ALTER VIEW reporting.v_cpd_milestones
AS
SELECT
    staff.id AS staff_id,
    staff.external_id,
    staff.display_name,
    staff.primary_org_unit_id,
    org_unit.code AS org_unit_code,
    SUM(CASE WHEN attendance.attendance_status = 'Attended' THEN attendance.milestone_credit ELSE 0 END) AS attendance_credits,
    SUM(CASE WHEN attendance.attendance_status = 'Attended' THEN COALESCE(event.duration_minutes, 0) ELSE 0 END) AS total_cpd_minutes,
    CASE
        WHEN SUM(CASE WHEN attendance.attendance_status = 'Attended' THEN attendance.milestone_credit ELSE 0 END) >= 15 THEN 15
        WHEN SUM(CASE WHEN attendance.attendance_status = 'Attended' THEN attendance.milestone_credit ELSE 0 END) >= 12 THEN 12
        WHEN SUM(CASE WHEN attendance.attendance_status = 'Attended' THEN attendance.milestone_credit ELSE 0 END) >= 9 THEN 9
        WHEN SUM(CASE WHEN attendance.attendance_status = 'Attended' THEN attendance.milestone_credit ELSE 0 END) >= 6 THEN 6
        WHEN SUM(CASE WHEN attendance.attendance_status = 'Attended' THEN attendance.milestone_credit ELSE 0 END) >= 3 THEN 3
        ELSE 0
    END AS achieved_milestone,
    CASE
        WHEN SUM(CASE WHEN attendance.attendance_status = 'Attended' THEN attendance.milestone_credit ELSE 0 END) < 3 THEN 3
        WHEN SUM(CASE WHEN attendance.attendance_status = 'Attended' THEN attendance.milestone_credit ELSE 0 END) < 6 THEN 6
        WHEN SUM(CASE WHEN attendance.attendance_status = 'Attended' THEN attendance.milestone_credit ELSE 0 END) < 9 THEN 9
        WHEN SUM(CASE WHEN attendance.attendance_status = 'Attended' THEN attendance.milestone_credit ELSE 0 END) < 12 THEN 12
        WHEN SUM(CASE WHEN attendance.attendance_status = 'Attended' THEN attendance.milestone_credit ELSE 0 END) < 15 THEN 15
        ELSE NULL
    END AS next_milestone
FROM people.staff staff
LEFT JOIN org.org_units org_unit ON org_unit.id = staff.primary_org_unit_id
LEFT JOIN cpd.cpd_attendance attendance ON attendance.staff_id = staff.id AND attendance.archived_at IS NULL
LEFT JOIN cpd.cpd_events event ON event.id = attendance.cpd_event_id AND event.archived_at IS NULL
WHERE staff.archived_at IS NULL
GROUP BY staff.id, staff.external_id, staff.display_name, staff.primary_org_unit_id, org_unit.code;
GO
