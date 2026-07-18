SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO

DECLARE @templateId uniqueidentifier = '70000000-0000-0000-0000-000000000001';
DECLARE @versionId uniqueidentifier = '71000000-0000-0000-0000-000000000040';
DECLARE @contextSectionId uniqueidentifier = '72000000-0000-0000-0000-000000000071';
DECLARE @practiceSectionId uniqueidentifier = '72000000-0000-0000-0000-000000000072';
DECLARE @findingsSectionId uniqueidentifier = '72000000-0000-0000-0000-000000000073';

IF EXISTS (SELECT 1 FROM forms.form_templates WHERE id = @templateId AND archived_at IS NULL)
BEGIN
    INSERT INTO forms.form_template_versions (
        id, form_template_id, version_label, active_from, is_published, created_by_user_account_id
    )
    SELECT @versionId, @templateId, '2.1', sysutcdatetime(), 1, '41000000-0000-0000-0000-000000000001'
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
        (@practiceSectionId, 'practice_observed', 'Practice Observed', 2),
        (@findingsSectionId, 'findings', 'Findings', 3)
    ) v(id, section_key, title, display_order)
    WHERE NOT EXISTS (SELECT 1 FROM forms.form_sections existing WHERE existing.id = v.id);

    INSERT INTO forms.form_fields (
        id, form_section_id, field_key, label, field_type, is_required, display_order, help_text
    )
    SELECT v.id, v.section_id, v.field_key, v.label, v.field_type,
           v.is_required, v.display_order, v.help_text
    FROM (VALUES
        (CONVERT(uniqueidentifier, '73000000-0000-0000-0000-000000000071'), @contextSectionId, 'visit_date', 'Date of visit', 'date', CONVERT(bit, 1), 10, CONVERT(nvarchar(1000), NULL)),
        (CONVERT(uniqueidentifier, '73000000-0000-0000-0000-000000000072'), @contextSectionId, 'faculty_area', 'Faculty Area', 'faculty_lookup', CONVERT(bit, 1), 20, 'Select the parent faculty.'),
        (CONVERT(uniqueidentifier, '73000000-0000-0000-0000-000000000073'), @contextSectionId, 'team_level', 'Team Level', 'team_lookup', CONVERT(bit, 1), 30, 'Options are filtered by the selected faculty.'),
        (CONVERT(uniqueidentifier, '73000000-0000-0000-0000-000000000074'), @contextSectionId, 'learning_walk_theme', 'Agreed Learning Walk Theme', 'auto_text', CONVERT(bit, 1), 40, 'Auto-filled from the faculty and team mapping.'),
        (CONVERT(uniqueidentifier, '73000000-0000-0000-0000-000000000075'), @contextSectionId, 'additional_focus_context', 'Additional themes or context', 'learning_walk_theme_group', CONVERT(bit, 0), 50, 'Select every additional theme that applies.'),
        (CONVERT(uniqueidentifier, '73000000-0000-0000-0000-000000000076'), @contextSectionId, 'additional_focus_other', 'Other focus or context', 'long_text', CONVERT(bit, 0), 60, 'Required when Other is selected.'),
        (CONVERT(uniqueidentifier, '73000000-0000-0000-0000-000000000077'), @practiceSectionId, 'practice_observed_rating', 'Practice Observed', 'practice_rubric_1_5', CONVERT(bit, 1), 10, 'Select the level that best reflects the practice observed.'),
        (CONVERT(uniqueidentifier, '73000000-0000-0000-0000-000000000078'), @findingsSectionId, 'good_practice', 'Areas of Good Practice Identified', 'long_text', CONVERT(bit, 1), 10, CONVERT(nvarchar(1000), NULL)),
        (CONVERT(uniqueidentifier, '73000000-0000-0000-0000-000000000079'), @findingsSectionId, 'development_areas', 'Areas for Development Identified', 'long_text', CONVERT(bit, 1), 20, CONVERT(nvarchar(1000), NULL))
    ) v(id, section_id, field_key, label, field_type, is_required, display_order, help_text)
    WHERE NOT EXISTS (SELECT 1 FROM forms.form_fields existing WHERE existing.id = v.id);
END;
GO
