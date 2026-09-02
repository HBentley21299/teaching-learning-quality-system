SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

BEGIN TRANSACTION;

UPDATE field
SET help_text = N'Completed by the lecturer after the observer has shared the review and the professional discussion has taken place.',
    updated_at = sysutcdatetime()
FROM forms.form_fields field
JOIN forms.form_sections section ON section.id = field.form_section_id
JOIN forms.form_template_versions version ON version.id = section.form_template_version_id
JOIN forms.form_templates template ON template.id = version.form_template_id
WHERE template.template_key = N'uco_tla_review_core'
  AND field.field_key = N'lecturer_reflection'
  AND field.help_text LIKE N'%moderation%';

COMMIT TRANSACTION;
GO
