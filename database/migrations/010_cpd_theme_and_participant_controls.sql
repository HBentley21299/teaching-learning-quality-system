SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO

BEGIN TRANSACTION;

DECLARE @cpdThemeLookupId uniqueidentifier = (
    SELECT id
    FROM core.lookup_types
    WHERE lookup_key = N'cpd_theme'
      AND archived_at IS NULL
);

IF @cpdThemeLookupId IS NOT NULL
BEGIN
    UPDATE core.lookup_values
    SET is_active = 0,
        archived_at = COALESCE(archived_at, sysutcdatetime()),
        updated_at = sysutcdatetime()
    WHERE lookup_type_id = @cpdThemeLookupId
      AND value_key NOT IN (
          N'teaching_learning_assessment',
          N'digital_learning',
          N'assessment_feedback',
          N'inclusive_practice',
          N'safeguarding_wellbeing',
          N'curriculum_development'
      );

    MERGE core.lookup_values AS target
    USING (VALUES
        (CAST('18000000-0000-0000-0000-000000000001' AS uniqueidentifier), N'teaching_learning_assessment', N'Teaching, learning and assessment', 10),
        (CAST('18000000-0000-0000-0000-000000000002' AS uniqueidentifier), N'digital_learning', N'Digital learning', 20),
        (CAST('15000000-0000-0000-0000-000000000002' AS uniqueidentifier), N'assessment_feedback', N'Assessment and feedback', 30),
        (CAST('18000000-0000-0000-0000-000000000003' AS uniqueidentifier), N'inclusive_practice', N'Inclusive practice', 40),
        (CAST('18000000-0000-0000-0000-000000000004' AS uniqueidentifier), N'safeguarding_wellbeing', N'Safeguarding and wellbeing', 50),
        (CAST('18000000-0000-0000-0000-000000000005' AS uniqueidentifier), N'curriculum_development', N'Curriculum development', 60)
    ) AS source(id, value_key, display_name, display_order)
        ON target.lookup_type_id = @cpdThemeLookupId
       AND target.value_key = source.value_key
    WHEN MATCHED THEN
        UPDATE SET
            display_name = source.display_name,
            display_order = source.display_order,
            is_active = 1,
            archived_at = NULL,
            updated_at = sysutcdatetime()
    WHEN NOT MATCHED THEN
        INSERT (id, lookup_type_id, value_key, display_name, display_order, is_active)
        VALUES (source.id, @cpdThemeLookupId, source.value_key, source.display_name, source.display_order, 1);
END;

UPDATE field
SET is_required = 1,
    updated_at = sysutcdatetime()
FROM forms.form_fields field
JOIN forms.form_sections section ON section.id = field.form_section_id
JOIN forms.form_template_versions version ON version.id = section.form_template_version_id
JOIN forms.form_templates template ON template.id = version.form_template_id
WHERE template.template_key = N'cpd_core'
  AND field.field_key = N'staff_search'
  AND field.archived_at IS NULL;

COMMIT TRANSACTION;
GO
