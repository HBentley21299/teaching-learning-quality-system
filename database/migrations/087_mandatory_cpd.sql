SET XACT_ABORT ON;
GO
BEGIN TRANSACTION;

IF NOT EXISTS (SELECT 1 FROM auth.permissions WHERE permission_key = N'cpd.mandatory_log')
    INSERT INTO auth.permissions (id, permission_key, name, category)
    VALUES (NEWID(), N'cpd.mandatory_log', N'Log mandatory CPD', N'CPD');

INSERT INTO auth.role_permissions (role_id, permission_id)
SELECT role_row.id, permission.id
FROM auth.roles role_row
CROSS JOIN auth.permissions permission
WHERE role_row.role_key IN (N'super_admin', N'teaching_learning_team')
  AND permission.permission_key = N'cpd.mandatory_log'
  AND NOT EXISTS (SELECT 1 FROM auth.role_permissions existing WHERE existing.role_id = role_row.id AND existing.permission_id = permission.id);

-- A distinct template preserves the CPD type through edits and keeps it outside Elevate eligibility.
IF NOT EXISTS (SELECT 1 FROM forms.form_templates WHERE template_key = N'cpd_mandatory')
BEGIN
    DECLARE @sourceVersion uniqueidentifier, @module uniqueidentifier;
    SELECT TOP (1) @sourceVersion = version.id, @module = template.module_id
    FROM forms.form_templates template
    JOIN forms.form_template_versions version ON version.form_template_id = template.id
    WHERE template.template_key = N'cpd_core' AND version.is_published = 1 AND version.archived_at IS NULL
    ORDER BY version.active_from DESC, version.created_at DESC;
    IF @sourceVersion IS NULL THROW 51000, 'A published CPD template is required before adding mandatory CPD.', 1;

    DECLARE @template uniqueidentifier = NEWID(), @version uniqueidentifier = NEWID();
    INSERT INTO forms.form_templates (id, module_id, template_key, name, description, is_active)
    VALUES (@template, @module, N'cpd_mandatory', N'Log mandatory CPD', N'Mandatory staff development recorded by Teaching and Learning. Does not contribute to Elevate status.', 1);
    INSERT INTO forms.form_template_versions (id, form_template_id, version_label, active_from, is_published)
    VALUES (@version, @template, N'1.0', SYSUTCDATETIME(), 1);

    DECLARE @sections TABLE (source_id uniqueidentifier, target_id uniqueidentifier);
    INSERT INTO @sections SELECT id, NEWID() FROM forms.form_sections WHERE form_template_version_id = @sourceVersion AND archived_at IS NULL;
    INSERT INTO forms.form_sections (id, form_template_version_id, section_key, title, description, display_order)
    SELECT map.target_id, @version, section.section_key, section.title, section.description, section.display_order
    FROM forms.form_sections section JOIN @sections map ON map.source_id = section.id;
    INSERT INTO forms.form_fields (id, form_section_id, field_key, label, field_type, options_lookup_type_id, is_required, display_order, help_text, validation_json, configuration_json, is_active)
    SELECT NEWID(), map.target_id, field.field_key, field.label, field.field_type, field.options_lookup_type_id,
           field.is_required, field.display_order,
           CASE WHEN field.field_key = N'staff_search' THEN N'Selected staff receive a mandatory CPD record on their profile, without Elevate credit.' ELSE field.help_text END,
           field.validation_json, field.configuration_json, field.is_active
    FROM forms.form_fields field JOIN @sections map ON map.source_id = field.form_section_id
    WHERE field.archived_at IS NULL;
END;
COMMIT TRANSACTION;
GO
