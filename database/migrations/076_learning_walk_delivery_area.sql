SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

BEGIN TRANSACTION;

-- Add the governed field to every existing Learning Walk context so historical
-- records can be edited without changing their template version. No responses
-- are invented: missing historical values remain explicitly not recorded.
-- Requiredness is enforced on new submission by the workflow, so editing an
-- older submitted record does not force an invented historical answer.
INSERT INTO forms.form_fields
    (form_section_id, field_key, label, field_type, is_required, display_order, help_text)
SELECT section.id, 'learning_walk_delivery_area', 'Learning Walk delivery area',
       'learning_walk_delivery_area', 0, 35,
       'Select the delivery area for this visit. Choices are shared with the corresponding LIV delivery areas.'
FROM forms.form_sections section
JOIN forms.form_template_versions version ON version.id = section.form_template_version_id
JOIN forms.form_templates template ON template.id = version.form_template_id
WHERE template.template_key = 'learning_walk_core'
  AND section.section_key = 'context'
  AND section.archived_at IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM forms.form_fields field
      JOIN forms.form_sections existing_section ON existing_section.id = field.form_section_id
      WHERE existing_section.form_template_version_id = version.id
        AND field.field_key = 'learning_walk_delivery_area'
  );

INSERT INTO core.lookup_usage_registry (lookup_type_id, application_key, display_name)
SELECT type.id, usage.application_key, usage.display_name
FROM (VALUES
    (N'liv_delivery_area', N'learning_walk.form', N'Learning Walk forms'),
    (N'liv_delivery_area', N'learning_walk.dashboard', N'Learning Walk dashboards and exports'),
    (N'als_liv_delivery_area', N'als_learning_walk.form', N'ALS Learning Walk forms'),
    (N'als_liv_delivery_area', N'als_learning_walk.dashboard', N'ALS Learning Walk dashboards and exports')
) usage(lookup_key, application_key, display_name)
JOIN core.lookup_types type ON type.lookup_key = usage.lookup_key
WHERE NOT EXISTS (
    SELECT 1 FROM core.lookup_usage_registry existing
    WHERE existing.lookup_type_id = type.id AND existing.application_key = usage.application_key
);

UPDATE managed
SET description = CASE type.lookup_key
        WHEN N'liv_delivery_area' THEN N'Delivery areas shared by LIV visits and Learning Walks. Existing Learning Walk records retain their saved wording.'
        ELSE N'Delivery areas shared by ALS LIV visits and ALS Learning Walks. Existing Learning Walk records retain their saved wording.'
    END
FROM core.admin_managed_lists managed
JOIN core.lookup_types type ON type.id = managed.lookup_type_id
WHERE type.lookup_key IN (N'liv_delivery_area', N'als_liv_delivery_area');

COMMIT TRANSACTION;
GO
