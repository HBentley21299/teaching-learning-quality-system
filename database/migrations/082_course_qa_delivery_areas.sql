SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET ARITHABORT ON;
SET NUMERIC_ROUNDABORT OFF;
GO

BEGIN TRANSACTION;

-- Existing evidence has no inferred delivery area. Preserve historical records as-is.
IF COL_LENGTH(N'qa.evidence_submissions', N'delivery_area_key') IS NULL
    ALTER TABLE qa.evidence_submissions ADD delivery_area_key nvarchar(100) NULL;
IF COL_LENGTH(N'qa.evidence_submissions', N'delivery_area_name_snapshot') IS NULL
    ALTER TABLE qa.evidence_submissions ADD delivery_area_name_snapshot nvarchar(200) NULL;

-- Add the governed choice to every Work Scrutiny template version. Old responses
-- remain blank; the submission workflow requires a choice for new records.
;WITH target_section AS (
    SELECT section.id, section.form_template_version_id,
           ROW_NUMBER() OVER (PARTITION BY section.form_template_version_id
               ORDER BY CASE WHEN section.section_key = N'sample_details' THEN 0 ELSE 1 END,
                        section.display_order, section.id) AS row_number
    FROM forms.form_sections section
    JOIN forms.form_template_versions version ON version.id = section.form_template_version_id
    JOIN forms.form_templates template ON template.id = version.form_template_id
    JOIN core.modules module ON module.id = template.module_id
    WHERE module.module_key = N'work_scrutiny' AND section.archived_at IS NULL
)
INSERT forms.form_fields (form_section_id, field_key, label, field_type, is_required, display_order, help_text)
SELECT target.id, N'learning_walk_delivery_area', N'Delivery area', N'learning_walk_delivery_area', 0, 5,
       N'Select the shared LIV and Learning Walk delivery area for this sample.'
FROM target_section target
WHERE target.row_number = 1 AND NOT EXISTS (
    SELECT 1 FROM forms.form_fields field
    JOIN forms.form_sections section ON section.id = field.form_section_id
    WHERE section.form_template_version_id = target.form_template_version_id
      AND field.field_key = N'learning_walk_delivery_area' AND field.archived_at IS NULL
);

INSERT core.lookup_usage_registry (lookup_type_id, application_key, display_name)
SELECT type.id, usage.application_key, usage.display_name
FROM (VALUES
    (N'work_scrutiny.form', N'Work Scrutiny forms'),
    (N'qa_evidence.form', N'QA Hub evidence forms')
) usage(application_key, display_name)
JOIN core.lookup_types type ON type.lookup_key = N'liv_delivery_area'
WHERE NOT EXISTS (
    SELECT 1 FROM core.lookup_usage_registry existing
    WHERE existing.lookup_type_id = type.id AND existing.application_key = usage.application_key
);

COMMIT TRANSACTION;
GO
