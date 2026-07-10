SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO

-- ============================================================
-- 1. Action closure evidence and auditing columns
-- ============================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('quality.actions') AND name = 'completion_note'
)
BEGIN
    ALTER TABLE quality.actions ADD completion_note nvarchar(max) NULL;
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('quality.actions') AND name = 'completed_by_user_account_id'
)
BEGIN
    ALTER TABLE quality.actions ADD completed_by_user_account_id uniqueidentifier NULL
        CONSTRAINT fk_actions_completed_by REFERENCES auth.user_accounts(id);
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('quality.actions') AND name = 'updated_by_user_account_id'
)
BEGIN
    ALTER TABLE quality.actions ADD updated_by_user_account_id uniqueidentifier NULL
        CONSTRAINT fk_actions_updated_by REFERENCES auth.user_accounts(id);
END;
GO

-- ============================================================
-- 2. LIV records (Learning Improvement Visits)
--    Registered through core.records like every other workflow.
-- ============================================================
IF OBJECT_ID('quality.liv_records', 'U') IS NULL
BEGIN
    CREATE TABLE quality.liv_records (
        id uniqueidentifier NOT NULL CONSTRAINT pk_liv_records PRIMARY KEY DEFAULT newsequentialid(),
        record_id uniqueidentifier NOT NULL,
        subject_staff_id uniqueidentifier NOT NULL,
        reviewer_staff_id uniqueidentifier NULL,
        org_unit_id uniqueidentifier NULL,
        course_seen nvarchar(300) NULL,
        liv_date date NULL,
        liv_time time NULL,
        pre_conversation nvarchar(max) NULL,
        liv_overview nvarchar(max) NULL,
        post_conversation nvarchar(max) NULL,
        follow_up_projected_date date NULL,
        second_liv_overview nvarchar(max) NULL,
        status nvarchar(50) NOT NULL CONSTRAINT df_liv_records_status DEFAULT 'draft',
        created_by_user_account_id uniqueidentifier NULL,
        updated_by_user_account_id uniqueidentifier NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_liv_records_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        archived_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT fk_liv_records_record FOREIGN KEY (record_id) REFERENCES core.records(id),
        CONSTRAINT fk_liv_records_subject FOREIGN KEY (subject_staff_id) REFERENCES people.staff(id),
        CONSTRAINT fk_liv_records_reviewer FOREIGN KEY (reviewer_staff_id) REFERENCES people.staff(id),
        CONSTRAINT fk_liv_records_org FOREIGN KEY (org_unit_id) REFERENCES org.org_units(id),
        CONSTRAINT fk_liv_records_created_by FOREIGN KEY (created_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT fk_liv_records_updated_by FOREIGN KEY (updated_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT uq_liv_records_record UNIQUE (record_id),
        CONSTRAINT ck_liv_records_status CHECK (status IN ('draft', 'open', 'closed'))
    );
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'ix_liv_records_subject' AND object_id = OBJECT_ID('quality.liv_records')
)
BEGIN
    CREATE INDEX ix_liv_records_subject ON quality.liv_records(subject_staff_id, liv_date);
END;
GO

-- ============================================================
-- 3. LIV module, permissions and role grants
-- ============================================================
INSERT INTO core.modules (id, module_key, name, route_prefix, display_order, description)
SELECT '50000000-0000-0000-0000-000000000009', 'liv', 'Learning Improvement Visits', '/liv', 45,
       'LIV records with pre/post conversations and follow-up actions.'
WHERE NOT EXISTS (SELECT 1 FROM core.modules WHERE module_key = 'liv');
GO

INSERT INTO auth.permissions (id, permission_key, name, category)
SELECT v.id, v.permission_key, v.name, v.category
FROM (VALUES
    ('31000000-0000-0000-0000-000000000014', 'liv.submit', 'Submit LIV Records', 'LIV'),
    ('31000000-0000-0000-0000-000000000015', 'liv.manage', 'Manage LIV Records', 'LIV')
) v(id, permission_key, name, category)
WHERE NOT EXISTS (SELECT 1 FROM auth.permissions existing WHERE existing.permission_key = v.permission_key);
GO

-- Super admin and T&L team manage LIV; directors and leaders/managers can submit.
INSERT INTO auth.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM auth.roles r
JOIN auth.permissions p ON p.permission_key IN ('liv.submit', 'liv.manage')
WHERE r.role_key IN ('super_admin', 'teaching_learning_team')
AND NOT EXISTS (
    SELECT 1 FROM auth.role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
);
GO

INSERT INTO auth.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM auth.roles r
JOIN auth.permissions p ON p.permission_key = 'liv.submit'
WHERE r.role_key IN ('director', 'leader_manager')
AND NOT EXISTS (
    SELECT 1 FROM auth.role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
);
GO

-- ============================================================
-- 4. Work Scrutiny template fields (template existed with no fields)
-- ============================================================
DECLARE @wsVersion uniqueidentifier = '75000000-0000-0000-0000-000000000001';
DECLARE @wsContext uniqueidentifier = '76000000-0000-0000-0000-000000000001';
DECLARE @wsSample uniqueidentifier = '76000000-0000-0000-0000-000000000002';
DECLARE @wsFindings uniqueidentifier = '76000000-0000-0000-0000-000000000003';

IF EXISTS (SELECT 1 FROM forms.form_template_versions WHERE id = @wsVersion)
BEGIN
    -- Restore the seeded faculty template if it was archived during early testing.
    UPDATE forms.form_templates
    SET archived_at = NULL,
        is_active = 1,
        updated_at = sysutcdatetime()
    WHERE id = '74000000-0000-0000-0000-000000000001'
      AND archived_at IS NOT NULL;

    INSERT INTO forms.form_sections (id, form_template_version_id, section_key, title, display_order)
    SELECT v.id, @wsVersion, v.section_key, v.title, v.display_order
    FROM (VALUES
        (@wsContext, 'context', 'Context', 1),
        (@wsSample, 'sample', 'Sample', 2),
        (@wsFindings, 'findings', 'Findings', 3)
    ) v(id, section_key, title, display_order)
    WHERE NOT EXISTS (SELECT 1 FROM forms.form_sections existing WHERE existing.id = v.id);

    INSERT INTO forms.form_fields (id, form_section_id, field_key, label, field_type, is_required, display_order, help_text)
    SELECT v.id, v.section_id, v.field_key, v.label, v.field_type, v.is_required, v.display_order, v.help_text
    FROM (VALUES
        ('77000000-0000-0000-0000-000000000001', @wsContext, 'scrutiny_date', 'Date of scrutiny', 'date', 1, 10, NULL),
        ('77000000-0000-0000-0000-000000000002', @wsContext, 'faculty_area', 'Faculty area', 'faculty_lookup', 1, 20, NULL),
        ('77000000-0000-0000-0000-000000000003', @wsContext, 'team_level', 'Team / child code', 'team_lookup', 1, 30, NULL),
        ('77000000-0000-0000-0000-000000000004', @wsContext, 'reviewer', 'Reviewer', 'staff_lookup', 1, 40, NULL),
        ('77000000-0000-0000-0000-000000000005', @wsSample, 'course_or_unit', 'Course / unit sampled', 'short_text', 1, 10, NULL),
        ('77000000-0000-0000-0000-000000000006', @wsSample, 'sample_size', 'Sample size', 'number', 0, 20, NULL),
        ('77000000-0000-0000-0000-000000000007', @wsFindings, 'finding_tag', 'Finding tag', 'single_select', 1, 10, NULL),
        ('77000000-0000-0000-0000-000000000008', @wsFindings, 'strengths', 'Strengths identified', 'long_text', 1, 20, NULL),
        ('77000000-0000-0000-0000-000000000009', @wsFindings, 'development_areas', 'Areas for development', 'long_text', 1, 30, NULL),
        ('77000000-0000-0000-0000-000000000010', @wsFindings, 'recommended_actions', 'Recommended actions', 'long_text', 0, 40, NULL)
    ) v(id, section_id, field_key, label, field_type, is_required, display_order, help_text)
    WHERE NOT EXISTS (SELECT 1 FROM forms.form_fields existing WHERE existing.id = v.id);

    UPDATE forms.form_template_versions
    SET is_published = 1,
        active_from = COALESCE(active_from, sysutcdatetime()),
        updated_at = sysutcdatetime()
    WHERE id = @wsVersion AND is_published = 0;
END;
GO

-- ============================================================
-- 5. CPD core template (events created through the forms pipeline)
-- ============================================================
DECLARE @cpdModule uniqueidentifier = (SELECT id FROM core.modules WHERE module_key = 'cpd');
DECLARE @cpdTemplate uniqueidentifier = '78000000-0000-0000-0000-000000000001';
DECLARE @cpdVersion uniqueidentifier = '78000000-0000-0000-0000-000000000002';
DECLARE @cpdActivity uniqueidentifier = '78000000-0000-0000-0000-000000000003';
DECLARE @cpdThemes uniqueidentifier = '78000000-0000-0000-0000-000000000004';
DECLARE @cpdParticipants uniqueidentifier = '78000000-0000-0000-0000-000000000005';

IF @cpdModule IS NOT NULL
BEGIN
    INSERT INTO forms.form_templates (id, module_id, template_key, name, description, is_active)
    SELECT @cpdTemplate, @cpdModule, 'cpd_core', 'CPD Core Template', 'CPD events with themes and participants.', 1
    WHERE NOT EXISTS (SELECT 1 FROM forms.form_templates WHERE id = @cpdTemplate OR template_key = 'cpd_core');

    INSERT INTO forms.form_template_versions (id, form_template_id, version_label, active_from, is_published, created_by_user_account_id)
    SELECT @cpdVersion, @cpdTemplate, '1.0', sysutcdatetime(), 1, '41000000-0000-0000-0000-000000000001'
    WHERE EXISTS (SELECT 1 FROM forms.form_templates WHERE id = @cpdTemplate)
      AND NOT EXISTS (SELECT 1 FROM forms.form_template_versions WHERE id = @cpdVersion);

    INSERT INTO forms.form_sections (id, form_template_version_id, section_key, title, display_order)
    SELECT v.id, @cpdVersion, v.section_key, v.title, v.display_order
    FROM (VALUES
        (@cpdActivity, 'activity_details', 'Activity details', 1),
        (@cpdThemes, 'themes', 'Themes', 2),
        (@cpdParticipants, 'participants', 'Participants', 3)
    ) v(id, section_key, title, display_order)
    WHERE EXISTS (SELECT 1 FROM forms.form_template_versions WHERE id = @cpdVersion)
      AND NOT EXISTS (SELECT 1 FROM forms.form_sections existing WHERE existing.id = v.id);

    INSERT INTO forms.form_fields (id, form_section_id, field_key, label, field_type, is_required, display_order, help_text)
    SELECT v.id, v.section_id, v.field_key, v.label, v.field_type, v.is_required, v.display_order, v.help_text
    FROM (VALUES
        ('79000000-0000-0000-0000-000000000001', @cpdActivity, 'date_time', 'Date and time', 'datetime', 1, 10, NULL),
        ('79000000-0000-0000-0000-000000000002', @cpdActivity, 'cpd_title', 'CPD title', 'short_text', 1, 20, NULL),
        ('79000000-0000-0000-0000-000000000003', @cpdActivity, 'delivery_mode', 'Delivery mode', 'single_select', 1, 30, NULL),
        ('79000000-0000-0000-0000-000000000004', @cpdThemes, 'cpd_themes', 'CPD theme', 'checkbox_group', 1, 10, 'Select every theme that applies.'),
        ('79000000-0000-0000-0000-000000000005', @cpdParticipants, 'staff_search', 'Staff search and selection', 'staff_multi_select', 0, 10, 'Selected staff receive CPD attendance credit when the event is submitted.'),
        ('79000000-0000-0000-0000-000000000006', @cpdParticipants, 'bulk_upload_by_team_code', 'Bulk upload by team code', 'team_bulk_add', 0, 20, NULL),
        ('79000000-0000-0000-0000-000000000007', @cpdParticipants, 'selected_staff_list', 'Selected staff list', 'selected_staff_list', 0, 30, NULL)
    ) v(id, section_id, field_key, label, field_type, is_required, display_order, help_text)
    WHERE EXISTS (SELECT 1 FROM forms.form_sections WHERE id = @cpdActivity)
      AND NOT EXISTS (SELECT 1 FROM forms.form_fields existing WHERE existing.id = v.id);
END;
GO

-- ============================================================
-- 6. Form submission status check (draft / submitted / reopened)
-- ============================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = 'ck_form_submissions_status'
      AND parent_object_id = OBJECT_ID('forms.form_submissions')
)
BEGIN
    ALTER TABLE forms.form_submissions ADD CONSTRAINT ck_form_submissions_status
        CHECK (status IN ('draft', 'submitted', 'reopened'));
END;
GO
