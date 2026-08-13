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

INSERT INTO auth.permissions (id, permission_key, name, category)
SELECT seed.id, seed.permission_key, seed.name, seed.category
FROM (VALUES
    (CONVERT(uniqueidentifier, '31000000-0000-0000-0000-000000000036'), N'als_learning_walk.submit', N'Submit ALS Learning Walks', N'ALS Learning Walks'),
    (CONVERT(uniqueidentifier, '31000000-0000-0000-0000-000000000037'), N'als_liv.submit', N'Submit ALS LIV Records', N'ALS LIV'),
    (CONVERT(uniqueidentifier, '31000000-0000-0000-0000-000000000038'), N'als_liv.manage', N'Manage ALS LIV Records', N'ALS LIV')
) seed(id, permission_key, name, category)
WHERE NOT EXISTS (SELECT 1 FROM auth.permissions existing WHERE existing.permission_key = seed.permission_key);

INSERT INTO auth.roles (id, role_key, name, description, is_system, precedence)
SELECT seed.id, seed.role_key, seed.name, seed.description, 1, seed.precedence
FROM (VALUES
    (CONVERT(uniqueidentifier, '30000000-0000-0000-0000-000000000008'), N'als_head_of_faculty', N'ALS Head of Faculty', N'Faculty leadership access with ALS-specific LIV and Learning Walk processes.', 300),
    (CONVERT(uniqueidentifier, '30000000-0000-0000-0000-000000000009'), N'als_team_leader', N'ALS Team Leader', N'Team leadership access with ALS-specific LIV and Learning Walk processes.', 200)
) seed(id, role_key, name, description, precedence)
WHERE NOT EXISTS (SELECT 1 FROM auth.roles existing WHERE existing.role_key = seed.role_key);

-- Mirror the corresponding leadership roles, except for the standard LIV and
-- Learning Walk grants which are deliberately replaced by ALS-specific grants.
INSERT INTO auth.role_permissions (role_id, permission_id)
SELECT target.id, source_permission.permission_id
FROM auth.roles target
JOIN auth.roles source_role ON source_role.role_key = CASE target.role_key
    WHEN N'als_head_of_faculty' THEN N'head_of_faculty'
    ELSE N'programme_leader' END
JOIN auth.role_permissions source_permission ON source_permission.role_id = source_role.id
JOIN auth.permissions permission ON permission.id = source_permission.permission_id
WHERE target.role_key IN (N'als_head_of_faculty', N'als_team_leader')
  AND permission.permission_key NOT IN (N'learning_walk.submit', N'liv.submit', N'liv.manage')
  AND NOT EXISTS (
      SELECT 1 FROM auth.role_permissions existing
      WHERE existing.role_id = target.id AND existing.permission_id = source_permission.permission_id
  );

INSERT INTO auth.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM auth.roles role
JOIN auth.permissions permission ON permission.permission_key IN (
    N'als_learning_walk.submit', N'als_liv.submit', N'als_liv.manage'
)
WHERE role.role_key IN (N'als_head_of_faculty', N'als_team_leader')
  AND (
      permission.permission_key <> N'als_liv.manage'
      OR role.role_key = N'als_head_of_faculty'
  )
  AND NOT EXISTS (
      SELECT 1 FROM auth.role_permissions existing
      WHERE existing.role_id = role.id AND existing.permission_id = permission.id
  );

-- System administrators and Teaching and Learning retain oversight of both variants.
INSERT INTO auth.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM auth.roles role
JOIN auth.permissions permission ON permission.permission_key IN (
    N'als_learning_walk.submit', N'als_liv.submit', N'als_liv.manage'
)
WHERE role.role_key IN (N'super_admin', N'teaching_learning_team')
  AND NOT EXISTS (
      SELECT 1 FROM auth.role_permissions existing
      WHERE existing.role_id = role.id AND existing.permission_id = permission.id
  );

INSERT INTO core.modules (id, module_key, name, route_prefix, display_order, description)
SELECT seed.id, seed.module_key, seed.name, seed.route_prefix, seed.display_order, seed.description
FROM (VALUES
    (CONVERT(uniqueidentifier, '50000000-0000-0000-0000-000000000016'), N'als_learning_walks', N'ALS Learning Walks', N'/als-learning-walks', 35, N'ALS-specific learning walk records and configurable focus areas.'),
    (CONVERT(uniqueidentifier, '50000000-0000-0000-0000-000000000017'), N'als_liv', N'ALS LIV', N'/als-liv', 36, N'ALS-specific LIV cases, visits and cycles.')
) seed(id, module_key, name, route_prefix, display_order, description)
WHERE NOT EXISTS (SELECT 1 FROM core.modules existing WHERE existing.module_key = seed.module_key);

IF COL_LENGTH(N'quality.liv_records', N'process_key') IS NULL
BEGIN
    ALTER TABLE quality.liv_records ADD process_key nvarchar(50) NOT NULL
        CONSTRAINT df_liv_records_process_key DEFAULT N'liv';
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'ck_liv_records_process_key')
BEGIN
    ALTER TABLE quality.liv_records ADD CONSTRAINT ck_liv_records_process_key
        CHECK (process_key IN (N'liv', N'als_liv'));
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'quality.liv_records') AND name = N'ix_liv_records_process_active')
BEGIN
    CREATE INDEX ix_liv_records_process_active
        ON quality.liv_records(process_key, org_unit_id, subject_staff_id)
        INCLUDE(record_id, reviewer_staff_id, status, completion_date, updated_at)
        WHERE archived_at IS NULL;
END;

IF COL_LENGTH(N'quality.learning_walk_theme_mappings', N'process_key') IS NULL
BEGIN
    ALTER TABLE quality.learning_walk_theme_mappings ADD process_key nvarchar(50) NOT NULL
        CONSTRAINT df_learning_walk_theme_mappings_process DEFAULT N'learning_walk';
END;
GO

IF EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'quality.learning_walk_theme_mappings')
      AND name = N'ux_learning_walk_theme_mappings_active'
)
BEGIN
    DROP INDEX ux_learning_walk_theme_mappings_active ON quality.learning_walk_theme_mappings;
END;

CREATE UNIQUE INDEX ux_learning_walk_theme_mappings_active
    ON quality.learning_walk_theme_mappings(process_key, faculty_org_unit_id, child_org_unit_id)
    WHERE archived_at IS NULL AND is_active = 1;

INSERT INTO quality.learning_walk_theme_mappings(
    id, faculty_org_unit_id, child_org_unit_id, agreed_theme, is_active, process_key
)
SELECT NEWID(), source.faculty_org_unit_id, source.child_org_unit_id, source.agreed_theme, source.is_active, N'als_learning_walk'
FROM quality.learning_walk_theme_mappings source
WHERE source.process_key = N'learning_walk' AND source.archived_at IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM quality.learning_walk_theme_mappings existing
      WHERE existing.process_key = N'als_learning_walk'
        AND existing.faculty_org_unit_id = source.faculty_org_unit_id
        AND existing.child_org_unit_id = source.child_org_unit_id
        AND existing.archived_at IS NULL
  );

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'ck_learning_walk_theme_mappings_process')
BEGIN
    ALTER TABLE quality.learning_walk_theme_mappings ADD CONSTRAINT ck_learning_walk_theme_mappings_process
        CHECK (process_key IN (N'learning_walk', N'als_learning_walk'));
END;

IF OBJECT_ID(N'core.theme_group_applications', N'U') IS NULL
BEGIN
    CREATE TABLE core.theme_group_applications (
        theme_group_id uniqueidentifier NOT NULL,
        application_key nvarchar(100) NOT NULL,
        display_order int NOT NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_theme_group_applications_created DEFAULT sysutcdatetime(),
        CONSTRAINT pk_theme_group_applications PRIMARY KEY(theme_group_id, application_key),
        CONSTRAINT fk_theme_group_applications_group FOREIGN KEY(theme_group_id) REFERENCES core.theme_groups(id)
    );
END;

INSERT INTO core.theme_group_applications(theme_group_id, application_key, display_order)
SELECT DISTINCT theme.theme_group_id, application.application_key, theme_group.display_order
FROM core.themes theme
JOIN core.theme_groups theme_group ON theme_group.id = theme.theme_group_id
JOIN core.theme_applications application ON application.theme_id = theme.id
WHERE application.application_key IN (N'learning_walk', N'liv')
  AND NOT EXISTS (
      SELECT 1 FROM core.theme_group_applications existing
      WHERE existing.theme_group_id = theme.theme_group_id
        AND existing.application_key = application.application_key
  );

-- Clone the current Learning Walk catalogue into stable, independent ALS rows.
DECLARE @alsGroups TABLE(source_id uniqueidentifier PRIMARY KEY, target_id uniqueidentifier NOT NULL);
INSERT INTO @alsGroups(source_id, target_id)
SELECT source.id, NEWID()
FROM core.theme_groups source
WHERE source.archived_at IS NULL
  AND EXISTS (
      SELECT 1 FROM core.theme_group_applications application
      WHERE application.theme_group_id = source.id AND application.application_key = N'learning_walk'
  );

INSERT INTO core.theme_groups(id, group_key, name, description, display_order, is_active)
SELECT mapping.target_id, CONCAT(N'als_', source.group_key), source.name, source.description, source.display_order, source.is_active
FROM @alsGroups mapping
JOIN core.theme_groups source ON source.id = mapping.source_id
WHERE NOT EXISTS (SELECT 1 FROM core.theme_groups existing WHERE existing.group_key = CONCAT(N'als_', source.group_key));

-- Rebuild the map from persistent keys when this migration is re-run before ledger insertion.
DELETE FROM @alsGroups;
INSERT INTO @alsGroups(source_id, target_id)
SELECT source.id, target.id
FROM core.theme_groups source
JOIN core.theme_groups target ON target.group_key = CONCAT(N'als_', source.group_key)
WHERE source.archived_at IS NULL
  AND EXISTS (
      SELECT 1 FROM core.theme_group_applications application
      WHERE application.theme_group_id = source.id AND application.application_key = N'learning_walk'
  );

INSERT INTO core.theme_group_applications(theme_group_id, application_key, display_order)
SELECT mapping.target_id, application.application_key, source.display_order
FROM @alsGroups mapping
JOIN core.theme_groups source ON source.id = mapping.source_id
CROSS JOIN (VALUES(N'als_learning_walk'), (N'als_liv')) application(application_key)
WHERE NOT EXISTS (
    SELECT 1 FROM core.theme_group_applications existing
    WHERE existing.theme_group_id = mapping.target_id AND existing.application_key = application.application_key
);

DECLARE @alsThemes TABLE(source_id uniqueidentifier PRIMARY KEY, target_id uniqueidentifier NOT NULL, target_group_id uniqueidentifier NOT NULL);
INSERT INTO @alsThemes(source_id, target_id, target_group_id)
SELECT source.id, NEWID(), group_mapping.target_id
FROM core.themes source
JOIN @alsGroups group_mapping ON group_mapping.source_id = source.theme_group_id
WHERE source.archived_at IS NULL;

INSERT INTO core.themes(id, theme_group_id, theme_key, name, description, asset_key, display_order, is_other, is_active)
SELECT mapping.target_id, mapping.target_group_id, CONCAT(N'als_', source.theme_key), source.name,
       source.description, source.asset_key, source.display_order, source.is_other, source.is_active
FROM @alsThemes mapping
JOIN core.themes source ON source.id = mapping.source_id
WHERE NOT EXISTS (SELECT 1 FROM core.themes existing WHERE existing.theme_key = CONCAT(N'als_', source.theme_key));

DELETE FROM @alsThemes;
INSERT INTO @alsThemes(source_id, target_id, target_group_id)
SELECT source.id, target.id, target.theme_group_id
FROM core.themes source
JOIN @alsGroups group_mapping ON group_mapping.source_id = source.theme_group_id
JOIN core.themes target ON target.theme_key = CONCAT(N'als_', source.theme_key)
WHERE source.archived_at IS NULL;

INSERT INTO core.theme_applications(theme_id, application_key, display_order)
SELECT mapping.target_id, application.application_key, source.display_order
FROM @alsThemes mapping
JOIN core.themes source ON source.id = mapping.source_id
CROSS JOIN (VALUES(N'als_learning_walk'), (N'als_liv'), (N'reporting')) application(application_key)
WHERE NOT EXISTS (
    SELECT 1 FROM core.theme_applications existing
    WHERE existing.theme_id = mapping.target_id AND existing.application_key = application.application_key
);

-- Clone each configurable LIV list so future ALS edits remain isolated.
DECLARE @lookupSeeds TABLE(source_key nvarchar(100), target_key nvarchar(100), target_name nvarchar(200), category nvarchar(100), display_order int);
INSERT INTO @lookupSeeds VALUES
    (N'liv_delivery_area', N'als_liv_delivery_area', N'ALS LIV Delivery Areas', N'ALS LIV', 80),
    (N'liv_course_level', N'als_liv_course_level', N'ALS LIV Course Levels', N'ALS LIV', 81),
    (N'liv_visit_focus_area', N'als_liv_visit_focus_area', N'ALS LIV Visit Focus Areas', N'ALS LIV', 82),
    (N'liv_development_opportunity', N'als_liv_development_opportunity', N'ALS LIV Development Opportunities', N'ALS LIV', 83),
    (N'action_theme_learning_walk', N'action_theme_als_learning_walk', N'ALS Learning Walk Action Themes', N'Actions', 184),
    (N'action_theme_liv', N'action_theme_als_liv', N'ALS LIV Action Themes', N'Actions', 185);

INSERT INTO core.lookup_types(id, lookup_key, name, description, is_system)
SELECT NEWID(), seed.target_key, seed.target_name, CONCAT(N'Independent ALS catalogue cloned from ', seed.source_key, N'.'), 0
FROM @lookupSeeds seed
WHERE NOT EXISTS (SELECT 1 FROM core.lookup_types existing WHERE existing.lookup_key = seed.target_key);

INSERT INTO core.lookup_values(id, lookup_type_id, value_key, display_name, display_order, is_active, notes)
SELECT NEWID(), target_type.id, source_value.value_key, source_value.display_name,
       source_value.display_order, source_value.is_active, source_value.notes
FROM @lookupSeeds seed
JOIN core.lookup_types source_type ON source_type.lookup_key = seed.source_key
JOIN core.lookup_values source_value ON source_value.lookup_type_id = source_type.id AND source_value.archived_at IS NULL
JOIN core.lookup_types target_type ON target_type.lookup_key = seed.target_key
WHERE NOT EXISTS (
    SELECT 1 FROM core.lookup_values existing
    WHERE existing.lookup_type_id = target_type.id AND existing.value_key = source_value.value_key
);

INSERT INTO core.admin_managed_lists(lookup_type_id, category, description, display_order)
SELECT target.id, seed.category, CONCAT(seed.target_name, N'. Changes apply only to the ALS process.'), seed.display_order
FROM @lookupSeeds seed
JOIN core.lookup_types target ON target.lookup_key = seed.target_key
WHERE NOT EXISTS (SELECT 1 FROM core.admin_managed_lists existing WHERE existing.lookup_type_id = target.id);

INSERT INTO core.lookup_usage_registry(lookup_type_id, application_key, display_name)
SELECT target.id, CONCAT(seed.target_key, N'.form'), seed.target_name
FROM @lookupSeeds seed
JOIN core.lookup_types target ON target.lookup_key = seed.target_key
WHERE NOT EXISTS (
    SELECT 1 FROM core.lookup_usage_registry existing
    WHERE existing.lookup_type_id = target.id AND existing.application_key = CONCAT(seed.target_key, N'.form')
);

COMMIT TRANSACTION;
GO
