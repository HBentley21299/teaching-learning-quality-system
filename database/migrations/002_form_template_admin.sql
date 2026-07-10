SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO

IF OBJECT_ID('forms.form_template_org_units', 'U') IS NULL
BEGIN
    CREATE TABLE forms.form_template_org_units (
        id uniqueidentifier NOT NULL CONSTRAINT pk_form_template_org_units PRIMARY KEY DEFAULT newsequentialid(),
        form_template_id uniqueidentifier NOT NULL,
        org_unit_id uniqueidentifier NOT NULL,
        assignment_type nvarchar(50) NOT NULL CONSTRAINT df_form_template_org_units_type DEFAULT 'applies_to',
        created_at datetimeoffset NOT NULL CONSTRAINT df_form_template_org_units_created DEFAULT sysutcdatetime(),
        archived_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT fk_form_template_org_units_template FOREIGN KEY (form_template_id) REFERENCES forms.form_templates(id),
        CONSTRAINT fk_form_template_org_units_org FOREIGN KEY (org_unit_id) REFERENCES org.org_units(id),
        CONSTRAINT uq_form_template_org_unit UNIQUE (form_template_id, org_unit_id, assignment_type)
    );
END;
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'ix_form_template_org_units_org'
      AND object_id = OBJECT_ID('forms.form_template_org_units')
)
BEGIN
    CREATE INDEX ix_form_template_org_units_org
    ON forms.form_template_org_units(org_unit_id)
    WHERE archived_at IS NULL;
END;
GO

DECLARE @workScrutinyModule uniqueidentifier = (
    SELECT id FROM core.modules WHERE module_key = 'work_scrutiny'
);

IF @workScrutinyModule IS NOT NULL
BEGIN
    INSERT INTO forms.form_templates (id, module_id, template_key, name, description, is_active)
    SELECT v.template_id, @workScrutinyModule, v.template_key, v.name, v.description, 1
    FROM (VALUES
        ('74000000-0000-0000-0000-000000000001', 'work_scrutiny_cudcpa', 'Work Scrutiny - Digital, Creative & Performing Arts', 'Faculty-specific work scrutiny template for Digital, Creative & Performing Arts.')
    ) v(template_id, template_key, name, description)
    WHERE NOT EXISTS (
        SELECT 1 FROM forms.form_templates existing WHERE existing.id = v.template_id
    );

    INSERT INTO forms.form_template_versions (id, form_template_id, version_label, active_from, is_published, created_by_user_account_id)
    SELECT '75000000-0000-0000-0000-000000000001', '74000000-0000-0000-0000-000000000001', '0.1', NULL, 0, '41000000-0000-0000-0000-000000000001'
    WHERE NOT EXISTS (
        SELECT 1 FROM forms.form_template_versions WHERE id = '75000000-0000-0000-0000-000000000001'
    );

    INSERT INTO forms.form_template_org_units (form_template_id, org_unit_id)
    SELECT '74000000-0000-0000-0000-000000000001', ou.id
    FROM org.org_units ou
    WHERE ou.code = 'CUDCPA'
      AND NOT EXISTS (
          SELECT 1
          FROM forms.form_template_org_units existing
          WHERE existing.form_template_id = '74000000-0000-0000-0000-000000000001'
            AND existing.org_unit_id = ou.id
            AND existing.archived_at IS NULL
      );
END;
GO
