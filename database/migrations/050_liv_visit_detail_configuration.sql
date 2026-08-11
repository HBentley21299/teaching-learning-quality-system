SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRANSACTION;

DECLARE @courseLevelTypeId uniqueidentifier = CONVERT(uniqueidentifier, '10000000-0000-0000-0000-000000000015');

INSERT INTO core.lookup_types (id, lookup_key, name, is_system)
SELECT @courseLevelTypeId, N'liv_course_level', N'LIV Course Levels', 0
WHERE NOT EXISTS (
    SELECT 1 FROM core.lookup_types WHERE lookup_key = N'liv_course_level'
);

SET @courseLevelTypeId = (
    SELECT id FROM core.lookup_types WHERE lookup_key = N'liv_course_level'
);

INSERT INTO core.lookup_values (id, lookup_type_id, value_key, display_name, display_order)
SELECT seed.id, @courseLevelTypeId, seed.value_key, seed.display_name, seed.display_order
FROM (VALUES
    (CONVERT(uniqueidentifier, '18A00000-0000-0000-0000-000000000041'), N'pre_entry', N'Pre-entry', 1),
    (CONVERT(uniqueidentifier, '18A00000-0000-0000-0000-000000000042'), N'entry_level', N'Entry Level', 2),
    (CONVERT(uniqueidentifier, '18A00000-0000-0000-0000-000000000043'), N'level_1', N'Level 1', 3),
    (CONVERT(uniqueidentifier, '18A00000-0000-0000-0000-000000000044'), N'level_2', N'Level 2', 4),
    (CONVERT(uniqueidentifier, '18A00000-0000-0000-0000-000000000045'), N'level_3', N'Level 3', 5),
    (CONVERT(uniqueidentifier, '18A00000-0000-0000-0000-000000000046'), N'level_4', N'Level 4', 6),
    (CONVERT(uniqueidentifier, '18A00000-0000-0000-0000-000000000047'), N'level_5', N'Level 5', 7),
    (CONVERT(uniqueidentifier, '18A00000-0000-0000-0000-000000000048'), N'level_6', N'Level 6', 8),
    (CONVERT(uniqueidentifier, '18A00000-0000-0000-0000-000000000049'), N'level_7', N'Level 7', 9)
) seed(id, value_key, display_name, display_order)
WHERE NOT EXISTS (
    SELECT 1
    FROM core.lookup_values existing
    WHERE existing.lookup_type_id = @courseLevelTypeId
      AND existing.value_key = seed.value_key
);

INSERT INTO core.admin_managed_lists (lookup_type_id, category, description, display_order)
SELECT @courseLevelTypeId, N'LIV', N'Course levels available within reviewer-only LIV visit detail.', 95
WHERE NOT EXISTS (
    SELECT 1 FROM core.admin_managed_lists WHERE lookup_type_id = @courseLevelTypeId
);

INSERT INTO core.lookup_usage_registry (lookup_type_id, application_key, display_name)
SELECT @courseLevelTypeId, N'liv.visit_detail', N'LIV visit detail'
WHERE NOT EXISTS (
    SELECT 1
    FROM core.lookup_usage_registry
    WHERE lookup_type_id = @courseLevelTypeId
      AND application_key = N'liv.visit_detail'
);

UPDATE visit
SET course_level = level.value_key
FROM quality.liv_visits visit
JOIN core.lookup_values level
  ON level.lookup_type_id = @courseLevelTypeId
 AND (
      level.value_key = visit.course_level
      OR level.display_name = visit.course_level
 )
WHERE visit.course_level IS NOT NULL
  AND visit.course_level <> level.value_key;

COMMIT TRANSACTION;
