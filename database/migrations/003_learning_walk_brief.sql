SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO

IF EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE name = 'fk_activities_subject_staff'
      AND parent_object_id = OBJECT_ID('quality.activities')
)
BEGIN
    ALTER TABLE quality.activities DROP CONSTRAINT fk_activities_subject_staff;
END;
GO

IF EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'ix_activities_subject_date'
      AND object_id = OBJECT_ID('quality.activities')
)
BEGIN
    DROP INDEX ix_activities_subject_date ON quality.activities;
END;
GO

IF EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID('quality.activities')
      AND name = 'subject_staff_id'
      AND is_nullable = 0
)
BEGIN
    ALTER TABLE quality.activities ALTER COLUMN subject_staff_id uniqueidentifier NULL;
END;
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE name = 'fk_activities_subject_staff'
      AND parent_object_id = OBJECT_ID('quality.activities')
)
BEGIN
    ALTER TABLE quality.activities
    ADD CONSTRAINT fk_activities_subject_staff
        FOREIGN KEY (subject_staff_id) REFERENCES people.staff(id);
END;
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'ix_activities_subject_date'
      AND object_id = OBJECT_ID('quality.activities')
)
BEGIN
    CREATE INDEX ix_activities_subject_date ON quality.activities(subject_staff_id, activity_date);
END;
GO

IF OBJECT_ID('quality.learning_walk_theme_mappings', 'U') IS NULL
BEGIN
    CREATE TABLE quality.learning_walk_theme_mappings (
        id uniqueidentifier NOT NULL CONSTRAINT pk_learning_walk_theme_mappings PRIMARY KEY DEFAULT newsequentialid(),
        faculty_org_unit_id uniqueidentifier NOT NULL,
        child_org_unit_id uniqueidentifier NOT NULL,
        agreed_theme nvarchar(500) NOT NULL,
        is_active bit NOT NULL CONSTRAINT df_learning_walk_theme_mappings_active DEFAULT 1,
        created_at datetimeoffset NOT NULL CONSTRAINT df_learning_walk_theme_mappings_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        archived_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT fk_learning_walk_theme_mappings_faculty FOREIGN KEY (faculty_org_unit_id) REFERENCES org.org_units(id),
        CONSTRAINT fk_learning_walk_theme_mappings_child FOREIGN KEY (child_org_unit_id) REFERENCES org.org_units(id),
        CONSTRAINT ck_learning_walk_theme_mappings_different_orgs CHECK (faculty_org_unit_id <> child_org_unit_id)
    );
END;
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'ux_learning_walk_theme_mappings_active'
      AND object_id = OBJECT_ID('quality.learning_walk_theme_mappings')
)
BEGIN
    CREATE UNIQUE INDEX ux_learning_walk_theme_mappings_active
    ON quality.learning_walk_theme_mappings(faculty_org_unit_id, child_org_unit_id)
    WHERE archived_at IS NULL AND is_active = 1;
END;
GO

DECLARE @cucp uniqueidentifier = (
    SELECT id FROM org.org_units WHERE code = 'CUCP' AND archived_at IS NULL
);

IF @cucp IS NOT NULL
BEGIN
    INSERT INTO org.org_units (id, parent_org_unit_id, org_unit_type, code, name, description)
    SELECT v.id, @cucp, 'faculty_child_code', v.code, v.name, 'Seeded faculty child code for Learning Walk reporting.'
    FROM (VALUES
        ('20000000-0000-0000-0000-000000000021', 'CUCPHS', 'Health & Social Care'),
        ('20000000-0000-0000-0000-000000000022', 'CUCPEY', 'Early Years'),
        ('20000000-0000-0000-0000-000000000023', 'CUCPSC', 'Science')
    ) v(id, code, name)
    WHERE NOT EXISTS (
        SELECT 1 FROM org.org_units existing WHERE existing.id = v.id OR existing.code = v.code
    );

    INSERT INTO quality.learning_walk_theme_mappings (id, faculty_org_unit_id, child_org_unit_id, agreed_theme)
    SELECT v.id, @cucp, child.id, v.agreed_theme
    FROM (VALUES
        ('8a000000-0000-0000-0000-000000000001', 'CUCPHS', 'Embedding inclusive practice and learner progress checks'),
        ('8a000000-0000-0000-0000-000000000002', 'CUCPEY', 'Questioning and formative assessment in practical learning'),
        ('8a000000-0000-0000-0000-000000000003', 'CUCPSC', 'Assessment for learning and stretch in theory sessions')
    ) v(id, child_code, agreed_theme)
    JOIN org.org_units child ON child.code = v.child_code AND child.archived_at IS NULL
    WHERE NOT EXISTS (
        SELECT 1
        FROM quality.learning_walk_theme_mappings existing
        WHERE existing.faculty_org_unit_id = @cucp
          AND existing.child_org_unit_id = child.id
          AND existing.archived_at IS NULL
    );
END;
GO

DECLARE @learningWalkTemplate uniqueidentifier = '70000000-0000-0000-0000-000000000001';
DECLARE @learningWalkVersion uniqueidentifier = '71000000-0000-0000-0000-000000000011';
DECLARE @lwContext uniqueidentifier = '72000000-0000-0000-0000-000000000011';
DECLARE @lwFindings uniqueidentifier = '72000000-0000-0000-0000-000000000012';
DECLARE @lwFollowUp uniqueidentifier = '72000000-0000-0000-0000-000000000013';

IF EXISTS (
    SELECT 1 FROM forms.form_templates WHERE id = @learningWalkTemplate AND archived_at IS NULL
)
BEGIN
    INSERT INTO forms.form_template_versions (id, form_template_id, version_label, active_from, is_published, created_by_user_account_id)
    SELECT @learningWalkVersion, @learningWalkTemplate, '1.1', sysutcdatetime(), 1, '41000000-0000-0000-0000-000000000001'
    WHERE NOT EXISTS (SELECT 1 FROM forms.form_template_versions WHERE id = @learningWalkVersion);

    INSERT INTO forms.form_sections (id, form_template_version_id, section_key, title, display_order)
    SELECT v.id, @learningWalkVersion, v.section_key, v.title, v.display_order
    FROM (VALUES
        (@lwContext, 'context', 'Context', 1),
        (@lwFindings, 'findings', 'Findings', 2),
        (@lwFollowUp, 'follow_up', 'Follow-up', 3)
    ) v(id, section_key, title, display_order)
    WHERE NOT EXISTS (SELECT 1 FROM forms.form_sections existing WHERE existing.id = v.id);

    INSERT INTO forms.form_fields (id, form_section_id, field_key, label, field_type, is_required, display_order, help_text)
    SELECT v.id, v.section_id, v.field_key, v.label, v.field_type, v.is_required, v.display_order, v.help_text
    FROM (VALUES
        ('73000000-0000-0000-0000-000000000011', @lwContext, 'visit_date', 'Date of visit', 'date', 1, 10, NULL),
        ('73000000-0000-0000-0000-000000000012', @lwContext, 'faculty_area', 'Faculty Area', 'faculty_lookup', 1, 20, 'Select the parent faculty.'),
        ('73000000-0000-0000-0000-000000000013', @lwContext, 'team_level', 'Team Level', 'team_lookup', 1, 30, 'Options are filtered by the selected faculty.'),
        ('73000000-0000-0000-0000-000000000014', @lwContext, 'learning_walk_theme', 'Learning Walk Theme', 'auto_text', 1, 40, 'Auto-filled from the faculty and team mapping.'),
        ('73000000-0000-0000-0000-000000000015', @lwContext, 'additional_focus_context', 'Additional Focus / Context', 'long_text', 0, 50, NULL),
        ('73000000-0000-0000-0000-000000000016', @lwFindings, 'good_practice', 'Areas of Good Practice Identified', 'long_text', 1, 10, NULL),
        ('73000000-0000-0000-0000-000000000017', @lwFindings, 'development_areas', 'Areas for Development Identified', 'long_text', 1, 20, NULL),
        ('73000000-0000-0000-0000-000000000018', @lwFollowUp, 'actions_next_steps', 'Actions / Next Steps', 'long_text', 0, 10, 'Free-text for release 1; this can become linked actions later.')
    ) v(id, section_id, field_key, label, field_type, is_required, display_order, help_text)
    WHERE NOT EXISTS (SELECT 1 FROM forms.form_fields existing WHERE existing.id = v.id);
END;
GO
