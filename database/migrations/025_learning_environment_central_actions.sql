SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

BEGIN TRANSACTION;

UPDATE section
SET title = N'Room',
    updated_at = sysutcdatetime()
FROM forms.form_sections section
JOIN forms.form_template_versions version ON version.id = section.form_template_version_id
JOIN forms.form_templates template ON template.id = version.form_template_id
WHERE template.template_key = N'elevate_learning_environments_core'
  AND section.section_key = N'room_context'
  AND section.archived_at IS NULL;

UPDATE field
SET is_active = 0,
    is_required = 0,
    options_lookup_type_id = NULL,
    archived_at = COALESCE(field.archived_at, sysutcdatetime()),
    updated_at = sysutcdatetime()
FROM forms.form_fields field
JOIN forms.form_sections section ON section.id = field.form_section_id
JOIN forms.form_template_versions version ON version.id = section.form_template_version_id
JOIN forms.form_templates template ON template.id = version.form_template_id
WHERE template.template_key = N'elevate_learning_environments_core'
  AND field.field_key IN (
      N'intended_purpose',
      N'aspirational_action', N'aspirational_owner', N'aspirational_target',
      N'collaborative_action', N'collaborative_owner', N'collaborative_target',
      N'respectful_action', N'respectful_owner', N'respectful_target',
      N'innovative_action', N'innovative_owner', N'innovative_target',
      N'inclusion_action', N'inclusion_owner', N'inclusion_target'
  );

DECLARE @purposeLookupTypeId uniqueidentifier = (
    SELECT id
    FROM core.lookup_types
    WHERE lookup_key = N'elevate_environment_purpose'
);

IF @purposeLookupTypeId IS NOT NULL
BEGIN
    UPDATE core.lookup_types
    SET is_active = 0,
        updated_at = sysutcdatetime()
    WHERE id = @purposeLookupTypeId;

    UPDATE core.admin_managed_lists
    SET is_active = 0,
        updated_at = sysutcdatetime()
    WHERE lookup_type_id = @purposeLookupTypeId;

    DELETE FROM core.lookup_usage_registry
    WHERE lookup_type_id = @purposeLookupTypeId;
END;

COMMIT TRANSACTION;
GO
