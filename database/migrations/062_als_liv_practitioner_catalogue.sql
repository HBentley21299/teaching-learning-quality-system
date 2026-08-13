SET NOCOUNT ON;
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

-- ALS LIV practitioner areas began as the ALS Learning Walk catalogue. Clone
-- the current values into independent rows so future changes remain isolated.
DECLARE @groupMap TABLE(source_id uniqueidentifier PRIMARY KEY, target_id uniqueidentifier NOT NULL);

INSERT INTO @groupMap(source_id, target_id)
SELECT source.id, NEWID()
FROM core.theme_groups source
JOIN core.theme_group_applications application
  ON application.theme_group_id = source.id
 AND application.application_key = N'als_learning_walk'
WHERE source.archived_at IS NULL;

INSERT INTO core.theme_groups(id, group_key, name, description, display_order, is_active)
SELECT mapping.target_id,
       CONCAT(N'als_liv_practitioner_', REPLACE(CONVERT(nvarchar(36), source.id), N'-', N'')),
       source.name, source.description, source.display_order, source.is_active
FROM @groupMap mapping
JOIN core.theme_groups source ON source.id = mapping.source_id
WHERE NOT EXISTS (
    SELECT 1 FROM core.theme_groups existing
    WHERE existing.group_key = CONCAT(N'als_liv_practitioner_', REPLACE(CONVERT(nvarchar(36), source.id), N'-', N''))
);

DELETE FROM @groupMap;
INSERT INTO @groupMap(source_id, target_id)
SELECT source.id, target.id
FROM core.theme_groups source
JOIN core.theme_group_applications application
  ON application.theme_group_id = source.id
 AND application.application_key = N'als_learning_walk'
JOIN core.theme_groups target
  ON target.group_key = CONCAT(N'als_liv_practitioner_', REPLACE(CONVERT(nvarchar(36), source.id), N'-', N''))
WHERE source.archived_at IS NULL;

INSERT INTO core.theme_group_applications(theme_group_id, application_key, display_order)
SELECT mapping.target_id, N'als_liv_practitioner', source.display_order
FROM @groupMap mapping
JOIN core.theme_groups source ON source.id = mapping.source_id
WHERE NOT EXISTS (
    SELECT 1 FROM core.theme_group_applications existing
    WHERE existing.theme_group_id = mapping.target_id
      AND existing.application_key = N'als_liv_practitioner'
);

DECLARE @themeMap TABLE(source_id uniqueidentifier PRIMARY KEY, target_id uniqueidentifier NOT NULL, target_group_id uniqueidentifier NOT NULL);

INSERT INTO @themeMap(source_id, target_id, target_group_id)
SELECT source.id, NEWID(), group_mapping.target_id
FROM core.themes source
JOIN @groupMap group_mapping ON group_mapping.source_id = source.theme_group_id
WHERE source.archived_at IS NULL;

INSERT INTO core.themes(id, theme_group_id, theme_key, name, description, asset_key, display_order, is_other, is_active)
SELECT mapping.target_id, mapping.target_group_id,
       CONCAT(N'als_liv_practitioner_', REPLACE(CONVERT(nvarchar(36), source.id), N'-', N'')),
       source.name, source.description, source.asset_key, source.display_order, source.is_other, source.is_active
FROM @themeMap mapping
JOIN core.themes source ON source.id = mapping.source_id
WHERE NOT EXISTS (
    SELECT 1 FROM core.themes existing
    WHERE existing.theme_key = CONCAT(N'als_liv_practitioner_', REPLACE(CONVERT(nvarchar(36), source.id), N'-', N''))
);

DELETE FROM @themeMap;
INSERT INTO @themeMap(source_id, target_id, target_group_id)
SELECT source.id, target.id, target.theme_group_id
FROM core.themes source
JOIN @groupMap group_mapping ON group_mapping.source_id = source.theme_group_id
JOIN core.themes target
  ON target.theme_key = CONCAT(N'als_liv_practitioner_', REPLACE(CONVERT(nvarchar(36), source.id), N'-', N''))
WHERE source.archived_at IS NULL;

INSERT INTO core.theme_applications(theme_id, application_key, display_order)
SELECT mapping.target_id, application.application_key, source.display_order
FROM @themeMap mapping
JOIN core.themes source ON source.id = mapping.source_id
CROSS JOIN (VALUES(N'als_liv_practitioner'), (N'reporting')) application(application_key)
WHERE NOT EXISTS (
    SELECT 1 FROM core.theme_applications existing
    WHERE existing.theme_id = mapping.target_id
      AND existing.application_key = application.application_key
);

-- Retain any existing ALS LIV selections by moving them to the equivalent row
-- in the new catalogue. Saved snapshots keep their original submitted wording.
INSERT INTO quality.liv_record_themes(
    liv_record_id, theme_id, theme_name_snapshot, group_name_snapshot,
    display_order_snapshot, selected_at
)
SELECT selected.liv_record_id, mapping.target_id, selected.theme_name_snapshot,
       selected.group_name_snapshot, selected.display_order_snapshot, selected.selected_at
FROM quality.liv_record_themes selected
JOIN quality.liv_records record ON record.id = selected.liv_record_id
JOIN @themeMap mapping ON mapping.source_id = selected.theme_id
WHERE record.process_key = N'als_liv'
  AND NOT EXISTS (
      SELECT 1 FROM quality.liv_record_themes existing
      WHERE existing.liv_record_id = selected.liv_record_id
        AND existing.theme_id = mapping.target_id
  );

DELETE selected
FROM quality.liv_record_themes selected
JOIN quality.liv_records record ON record.id = selected.liv_record_id
JOIN @themeMap mapping ON mapping.source_id = selected.theme_id
WHERE record.process_key = N'als_liv';

UPDATE record
SET area_of_practice_keys_json = catalogue.keys_json
FROM quality.liv_records record
OUTER APPLY (
    SELECT CASE WHEN COUNT(*) = 0 THEN NULL
                ELSE CONCAT(N'["', STRING_AGG(STRING_ESCAPE(theme.theme_key, 'json'), N'","'), N'"]') END AS keys_json
    FROM quality.liv_record_themes selected
    JOIN core.themes theme ON theme.id = selected.theme_id
    WHERE selected.liv_record_id = record.id
) catalogue
WHERE record.process_key = N'als_liv';

-- Remove the obsolete shared application links. The ALS Learning Walk rows and
-- historical reporting rows remain intact.
DELETE application
FROM core.theme_applications application
JOIN core.themes theme ON theme.id = application.theme_id
JOIN core.theme_group_applications group_application
  ON group_application.theme_group_id = theme.theme_group_id
 AND group_application.application_key = N'als_learning_walk'
WHERE application.application_key = N'als_liv';

DELETE application
FROM core.theme_group_applications application
WHERE application.application_key = N'als_liv';

COMMIT TRANSACTION;
GO
