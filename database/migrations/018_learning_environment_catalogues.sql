SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO

IF OBJECT_ID('core.system_assets', 'U') IS NULL
BEGIN
    CREATE TABLE core.system_assets (
        id uniqueidentifier NOT NULL CONSTRAINT pk_system_assets PRIMARY KEY DEFAULT newsequentialid(),
        asset_key nvarchar(100) NOT NULL,
        display_name nvarchar(200) NOT NULL,
        asset_uri nvarchar(1000) NOT NULL,
        media_type nvarchar(100) NOT NULL,
        alt_text nvarchar(300) NOT NULL,
        is_active bit NOT NULL CONSTRAINT df_system_assets_active DEFAULT 1,
        created_at datetimeoffset NOT NULL CONSTRAINT df_system_assets_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        archived_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT uq_system_assets_key UNIQUE (asset_key)
    );
END;
GO

IF OBJECT_ID('quality.elevate_environment_pillars', 'U') IS NULL
BEGIN
    CREATE TABLE quality.elevate_environment_pillars (
        id uniqueidentifier NOT NULL CONSTRAINT pk_elevate_environment_pillars PRIMARY KEY DEFAULT newsequentialid(),
        pillar_key nvarchar(50) NOT NULL,
        name nvarchar(100) NOT NULL,
        description nvarchar(1000) NOT NULL,
        system_asset_id uniqueidentifier NOT NULL,
        display_order int NOT NULL,
        is_active bit NOT NULL CONSTRAINT df_elevate_environment_pillars_active DEFAULT 1,
        created_at datetimeoffset NOT NULL CONSTRAINT df_elevate_environment_pillars_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        archived_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT fk_elevate_environment_pillars_asset FOREIGN KEY (system_asset_id) REFERENCES core.system_assets(id),
        CONSTRAINT uq_elevate_environment_pillars_key UNIQUE (pillar_key),
        CONSTRAINT ck_elevate_environment_pillars_order CHECK (display_order > 0)
    );
END;
GO

BEGIN TRANSACTION;

MERGE core.system_assets AS target
USING (VALUES
    (CAST('83000000-0000-0000-0000-000000000001' AS uniqueidentifier), N'elevate_environment.aspirational', N'Aspirational pillar graphic', N'/system-assets/elevate-environments/aspirational.png', N'image/png', N'Aspirational: three upward arrows'),
    (CAST('83000000-0000-0000-0000-000000000002' AS uniqueidentifier), N'elevate_environment.collaborative', N'Collaborative pillar graphic', N'/system-assets/elevate-environments/collaborative.png', N'image/png', N'Collaborative: people in discussion'),
    (CAST('83000000-0000-0000-0000-000000000003' AS uniqueidentifier), N'elevate_environment.respectful', N'Respectful pillar graphic', N'/system-assets/elevate-environments/respectful.png', N'image/png', N'Respectful: people within a heart'),
    (CAST('83000000-0000-0000-0000-000000000004' AS uniqueidentifier), N'elevate_environment.innovative', N'Innovative pillar graphic', N'/system-assets/elevate-environments/innovative.png', N'image/png', N'Innovative: illuminated light bulb'),
    (CAST('83000000-0000-0000-0000-000000000005' AS uniqueidentifier), N'elevate_environment.inclusion', N'Inclusion pillar graphic', N'/system-assets/elevate-environments/inclusion.png', N'image/png', N'Inclusion: a connected group of people')
) AS source(id, asset_key, display_name, asset_uri, media_type, alt_text)
ON target.asset_key = source.asset_key
WHEN MATCHED THEN
    UPDATE SET display_name = source.display_name,
               asset_uri = source.asset_uri,
               media_type = source.media_type,
               alt_text = source.alt_text,
               is_active = 1,
               archived_at = NULL,
               updated_at = sysutcdatetime()
WHEN NOT MATCHED THEN
    INSERT (id, asset_key, display_name, asset_uri, media_type, alt_text)
    VALUES (source.id, source.asset_key, source.display_name, source.asset_uri, source.media_type, source.alt_text);

MERGE quality.elevate_environment_pillars AS target
USING (VALUES
    (CAST('84000000-0000-0000-0000-000000000001' AS uniqueidentifier), N'aspirational', N'Aspirational', N'Does the environment communicate high expectations and prepare learners for excellent work? Look for readiness, current resources, a clear curriculum purpose, quality, progression and pride.', N'elevate_environment.aspirational', 10),
    (CAST('84000000-0000-0000-0000-000000000002' AS uniqueidentifier), N'collaborative', N'Collaborative', N'Does the environment enable communication, demonstration, practice and effective collaboration? Look for visibility, flexible activity, safe movement and accessible shared resources.', N'elevate_environment.collaborative', 20),
    (CAST('84000000-0000-0000-0000-000000000003' AS uniqueidentifier), N'respectful', N'Respectful', N'Does the room show care for learners, staff, their work and subject standards? Look for cleanliness, safe storage, suitable comfort, privacy and clear fault-reporting routines.', N'elevate_environment.respectful', 30),
    (CAST('84000000-0000-0000-0000-000000000004' AS uniqueidentifier), N'innovative', N'Innovative', N'Do the room, resources and equipment improve learning and support current or future practice? Look for reliable tools, authentic practice, experimentation, independence and better feedback.', N'elevate_environment.innovative', 40),
    (CAST('84000000-0000-0000-0000-000000000005' AS uniqueidentifier), N'inclusion', N'Inclusion', N'Can learners access, participate and work as independently as possible without reduced expectations? Look for accessible routes and equipment, clear instructions, sensory needs and dignified adjustments.', N'elevate_environment.inclusion', 50)
) AS source(id, pillar_key, name, description, asset_key, display_order)
JOIN core.system_assets asset ON asset.asset_key = source.asset_key
ON target.pillar_key = source.pillar_key
WHEN MATCHED THEN
    UPDATE SET name = source.name,
               description = source.description,
               system_asset_id = asset.id,
               display_order = source.display_order,
               archived_at = NULL,
               updated_at = sysutcdatetime()
WHEN NOT MATCHED THEN
    INSERT (id, pillar_key, name, description, system_asset_id, display_order)
    VALUES (source.id, source.pillar_key, source.name, source.description, asset.id, source.display_order);

DECLARE @purposeLookupId uniqueidentifier = (
    SELECT id
    FROM core.lookup_types
    WHERE lookup_key = N'elevate_environment_purpose'
      AND archived_at IS NULL
);

IF @purposeLookupId IS NULL
BEGIN
    SET @purposeLookupId = '85000000-0000-0000-0000-000000000001';
    INSERT INTO core.lookup_types (id, lookup_key, name, is_system)
    VALUES (@purposeLookupId, N'elevate_environment_purpose', N'Learning Environment intended purposes', 0);
END;

MERGE core.lookup_values AS target
USING (VALUES
    (CAST('85000000-0000-0000-0000-000000000010' AS uniqueidentifier), N'performance_review', N'Performance Review', 10)
) AS source(id, value_key, display_name, display_order)
ON target.lookup_type_id = @purposeLookupId
   AND target.value_key = source.value_key
WHEN MATCHED THEN
    UPDATE SET display_name = source.display_name,
               display_order = source.display_order,
               is_active = 1,
               archived_at = NULL,
               updated_at = sysutcdatetime()
WHEN NOT MATCHED THEN
    INSERT (id, lookup_type_id, value_key, display_name, display_order, is_active)
    VALUES (source.id, @purposeLookupId, source.value_key, source.display_name, source.display_order, 1);

UPDATE field
SET label = N'Room',
    help_text = N'Search the active room register and select a controlled room value.',
    updated_at = sysutcdatetime()
FROM forms.form_fields field
JOIN forms.form_sections section ON section.id = field.form_section_id
JOIN forms.form_template_versions version ON version.id = section.form_template_version_id
JOIN forms.form_templates template ON template.id = version.form_template_id
WHERE template.template_key = N'elevate_learning_environments_core'
  AND field.field_key = N'room_code'
  AND field.archived_at IS NULL;

UPDATE field
SET label = N'Intended purpose',
    field_type = N'checkbox_group',
    options_lookup_type_id = @purposeLookupId,
    is_required = 1,
    help_text = N'Select every purpose that applies to this learning environment check.',
    updated_at = sysutcdatetime()
FROM forms.form_fields field
JOIN forms.form_sections section ON section.id = field.form_section_id
JOIN forms.form_template_versions version ON version.id = section.form_template_version_id
JOIN forms.form_templates template ON template.id = version.form_template_id
WHERE template.template_key = N'elevate_learning_environments_core'
  AND field.field_key = N'intended_purpose'
  AND field.archived_at IS NULL;

UPDATE field
SET label = CASE
        WHEN field.field_key LIKE N'%[_]action' THEN N'Action'
        WHEN field.field_key LIKE N'%[_]owner' THEN N'Owner'
        WHEN field.field_key LIKE N'%[_]target' THEN N'Date for review'
        ELSE field.label
    END,
    help_text = CASE WHEN field.field_key LIKE N'%[_]score' THEN NULL ELSE field.help_text END,
    updated_at = sysutcdatetime()
FROM forms.form_fields field
JOIN forms.form_sections section ON section.id = field.form_section_id
JOIN forms.form_template_versions version ON version.id = section.form_template_version_id
JOIN forms.form_templates template ON template.id = version.form_template_id
WHERE template.template_key = N'elevate_learning_environments_core'
  AND (
      field.field_key LIKE N'%[_]action'
      OR field.field_key LIKE N'%[_]owner'
      OR field.field_key LIKE N'%[_]target'
      OR field.field_key LIKE N'%[_]score'
  )
  AND field.archived_at IS NULL;

COMMIT TRANSACTION;
GO
