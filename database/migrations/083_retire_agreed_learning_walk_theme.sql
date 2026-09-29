SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

BEGIN TRANSACTION;

-- The faculty/team agreed-theme question is no longer part of either Learning
-- Walk form. Retire the field on every template version without deleting any
-- historical form response or changing the separate Focus question.
UPDATE field
SET is_active = 0,
    is_required = 0,
    archived_at = COALESCE(field.archived_at, sysutcdatetime()),
    updated_at = sysutcdatetime()
FROM forms.form_fields field
JOIN forms.form_sections section ON section.id = field.form_section_id
JOIN forms.form_template_versions version ON version.id = section.form_template_version_id
JOIN forms.form_templates template ON template.id = version.form_template_id
WHERE template.template_key = N'learning_walk_core'
  AND field.field_key = N'learning_walk_theme'
  AND (field.is_active = 1 OR field.is_required = 1 OR field.archived_at IS NULL);

COMMIT TRANSACTION;
GO
