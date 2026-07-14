SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO

IF OBJECT_ID('quality.learning_walk_theme_groups', 'U') IS NULL
BEGIN
    CREATE TABLE quality.learning_walk_theme_groups (
        id uniqueidentifier NOT NULL CONSTRAINT pk_learning_walk_theme_groups PRIMARY KEY,
        group_key nvarchar(100) NOT NULL,
        name nvarchar(200) NOT NULL,
        display_order int NOT NULL,
        is_active bit NOT NULL CONSTRAINT df_learning_walk_theme_groups_active DEFAULT 1,
        created_at datetimeoffset NOT NULL CONSTRAINT df_learning_walk_theme_groups_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        archived_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT uq_learning_walk_theme_groups_key UNIQUE (group_key)
    );
END;
GO

IF OBJECT_ID('quality.learning_walk_themes', 'U') IS NULL
BEGIN
    CREATE TABLE quality.learning_walk_themes (
        id uniqueidentifier NOT NULL CONSTRAINT pk_learning_walk_themes PRIMARY KEY DEFAULT newsequentialid(),
        theme_group_id uniqueidentifier NOT NULL,
        name nvarchar(250) NOT NULL,
        display_order int NOT NULL,
        is_other bit NOT NULL CONSTRAINT df_learning_walk_themes_other DEFAULT 0,
        is_active bit NOT NULL CONSTRAINT df_learning_walk_themes_active DEFAULT 1,
        created_by_user_account_id uniqueidentifier NULL,
        updated_by_user_account_id uniqueidentifier NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_learning_walk_themes_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        archived_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT fk_learning_walk_themes_group FOREIGN KEY (theme_group_id) REFERENCES quality.learning_walk_theme_groups(id),
        CONSTRAINT fk_learning_walk_themes_created_by FOREIGN KEY (created_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT fk_learning_walk_themes_updated_by FOREIGN KEY (updated_by_user_account_id) REFERENCES auth.user_accounts(id)
    );
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'ux_learning_walk_themes_group_name'
      AND object_id = OBJECT_ID('quality.learning_walk_themes')
)
BEGIN
    CREATE UNIQUE INDEX ux_learning_walk_themes_group_name
    ON quality.learning_walk_themes(theme_group_id, name)
    WHERE archived_at IS NULL;
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'ux_learning_walk_themes_other'
      AND object_id = OBJECT_ID('quality.learning_walk_themes')
)
BEGIN
    CREATE UNIQUE INDEX ux_learning_walk_themes_other
    ON quality.learning_walk_themes(is_other)
    WHERE archived_at IS NULL AND is_other = 1;
END;
GO

IF OBJECT_ID('quality.learning_walk_record_themes', 'U') IS NULL
BEGIN
    CREATE TABLE quality.learning_walk_record_themes (
        record_id uniqueidentifier NOT NULL,
        theme_id uniqueidentifier NOT NULL,
        theme_name_snapshot nvarchar(250) NOT NULL,
        group_name_snapshot nvarchar(200) NOT NULL,
        display_order_snapshot int NOT NULL,
        selected_at datetimeoffset NOT NULL CONSTRAINT df_learning_walk_record_themes_selected DEFAULT sysutcdatetime(),
        CONSTRAINT pk_learning_walk_record_themes PRIMARY KEY (record_id, theme_id),
        CONSTRAINT fk_learning_walk_record_themes_record FOREIGN KEY (record_id) REFERENCES core.records(id),
        CONSTRAINT fk_learning_walk_record_themes_theme FOREIGN KEY (theme_id) REFERENCES quality.learning_walk_themes(id)
    );
END;
GO

INSERT INTO quality.learning_walk_theme_groups (id, group_key, name, display_order)
SELECT v.id, v.group_key, v.name, v.display_order
FROM (VALUES
    (CONVERT(uniqueidentifier, '8b000000-0000-0000-0000-000000000001'), 'teaching_learning_expectations', 'Teaching and Learning Expectations', 10),
    (CONVERT(uniqueidentifier, '8b000000-0000-0000-0000-000000000002'), 'digital', 'Digital', 20),
    (CONVERT(uniqueidentifier, '8b000000-0000-0000-0000-000000000003'), 'sustainability', 'Sustainability', 30),
    (CONVERT(uniqueidentifier, '8b000000-0000-0000-0000-000000000004'), 'other', 'Other', 40)
) v(id, group_key, name, display_order)
WHERE NOT EXISTS (
    SELECT 1 FROM quality.learning_walk_theme_groups existing WHERE existing.id = v.id OR existing.group_key = v.group_key
);
GO

INSERT INTO quality.learning_walk_themes (id, theme_group_id, name, display_order, is_other)
SELECT v.id, v.theme_group_id, v.name, v.display_order, v.is_other
FROM (VALUES
    (CONVERT(uniqueidentifier, '8c000000-0000-0000-0000-000000000001'), CONVERT(uniqueidentifier, '8b000000-0000-0000-0000-000000000001'), 'Teaching and Learning Expectations', 10, CONVERT(bit, 0)),
    (CONVERT(uniqueidentifier, '8c000000-0000-0000-0000-000000000002'), CONVERT(uniqueidentifier, '8b000000-0000-0000-0000-000000000002'), 'Digital', 10, CONVERT(bit, 0)),
    (CONVERT(uniqueidentifier, '8c000000-0000-0000-0000-000000000003'), CONVERT(uniqueidentifier, '8b000000-0000-0000-0000-000000000003'), 'Sustainability', 10, CONVERT(bit, 0)),
    (CONVERT(uniqueidentifier, '8c000000-0000-0000-0000-000000000004'), CONVERT(uniqueidentifier, '8b000000-0000-0000-0000-000000000004'), 'Other', 10, CONVERT(bit, 1))
) v(id, theme_group_id, name, display_order, is_other)
WHERE NOT EXISTS (
    SELECT 1 FROM quality.learning_walk_themes existing WHERE existing.id = v.id
);
GO

DECLARE @templateId uniqueidentifier = '70000000-0000-0000-0000-000000000001';
DECLARE @versionId uniqueidentifier = '71000000-0000-0000-0000-000000000016';
DECLARE @contextSectionId uniqueidentifier = '72000000-0000-0000-0000-000000000061';
DECLARE @findingsSectionId uniqueidentifier = '72000000-0000-0000-0000-000000000062';

IF EXISTS (SELECT 1 FROM forms.form_templates WHERE id = @templateId AND archived_at IS NULL)
BEGIN
    INSERT INTO forms.form_template_versions (
        id, form_template_id, version_label, active_from, is_published, created_by_user_account_id
    )
    SELECT @versionId, @templateId, '2.0', sysutcdatetime(), 1, '41000000-0000-0000-0000-000000000001'
    WHERE NOT EXISTS (SELECT 1 FROM forms.form_template_versions WHERE id = @versionId);

    UPDATE forms.form_template_versions
    SET active_to = COALESCE(active_to, sysutcdatetime()),
        updated_at = sysutcdatetime()
    WHERE form_template_id = @templateId
      AND id <> @versionId
      AND is_published = 1
      AND active_to IS NULL;

    INSERT INTO forms.form_sections (id, form_template_version_id, section_key, title, display_order)
    SELECT v.id, @versionId, v.section_key, v.title, v.display_order
    FROM (VALUES
        (@contextSectionId, 'context', 'Context and focus', 1),
        (@findingsSectionId, 'findings', 'Findings', 2)
    ) v(id, section_key, title, display_order)
    WHERE NOT EXISTS (SELECT 1 FROM forms.form_sections existing WHERE existing.id = v.id);

    INSERT INTO forms.form_fields (
        id, form_section_id, field_key, label, field_type, is_required, display_order, help_text
    )
    SELECT v.id, v.section_id, v.field_key, v.label, v.field_type, v.is_required, v.display_order, v.help_text
    FROM (VALUES
        (CONVERT(uniqueidentifier, '73000000-0000-0000-0000-000000000061'), @contextSectionId, 'visit_date', 'Date of visit', 'date', CONVERT(bit, 1), 10, CONVERT(nvarchar(1000), NULL)),
        (CONVERT(uniqueidentifier, '73000000-0000-0000-0000-000000000062'), @contextSectionId, 'faculty_area', 'Faculty Area', 'faculty_lookup', CONVERT(bit, 1), 20, 'Select the parent faculty.'),
        (CONVERT(uniqueidentifier, '73000000-0000-0000-0000-000000000063'), @contextSectionId, 'team_level', 'Team Level', 'team_lookup', CONVERT(bit, 1), 30, 'Options are filtered by the selected faculty.'),
        (CONVERT(uniqueidentifier, '73000000-0000-0000-0000-000000000064'), @contextSectionId, 'learning_walk_theme', 'Agreed Learning Walk Theme', 'auto_text', CONVERT(bit, 1), 40, 'Auto-filled from the faculty and team mapping.'),
        (CONVERT(uniqueidentifier, '73000000-0000-0000-0000-000000000065'), @contextSectionId, 'additional_focus_context', 'Additional themes or context', 'learning_walk_theme_group', CONVERT(bit, 0), 50, 'Select every additional theme that applies.'),
        (CONVERT(uniqueidentifier, '73000000-0000-0000-0000-000000000066'), @contextSectionId, 'additional_focus_other', 'Other focus or context', 'long_text', CONVERT(bit, 0), 60, 'Required when Other is selected.'),
        (CONVERT(uniqueidentifier, '73000000-0000-0000-0000-000000000067'), @findingsSectionId, 'good_practice', 'Areas of Good Practice Identified', 'long_text', CONVERT(bit, 1), 10, CONVERT(nvarchar(1000), NULL)),
        (CONVERT(uniqueidentifier, '73000000-0000-0000-0000-000000000068'), @findingsSectionId, 'development_areas', 'Areas for Development Identified', 'long_text', CONVERT(bit, 1), 20, CONVERT(nvarchar(1000), NULL))
    ) v(id, section_id, field_key, label, field_type, is_required, display_order, help_text)
    WHERE NOT EXISTS (SELECT 1 FROM forms.form_fields existing WHERE existing.id = v.id);
END;
GO
