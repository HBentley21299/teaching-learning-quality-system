SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO

-- Dedicated administration permissions keep T&L configuration separate from
-- user/role administration and organisation allocation changes.
INSERT INTO auth.permissions (id, permission_key, name, description, category, is_system)
SELECT value.id, value.permission_key, value.name, value.description, value.category, 1
FROM (VALUES
    (CONVERT(uniqueidentifier, '31000000-0000-0000-0000-000000000023'), N'organisation.manage', N'Manage Organisation Structure', N'Manage organisation allocations and reporting relationships.', N'Organisation'),
    (CONVERT(uniqueidentifier, '31000000-0000-0000-0000-000000000024'), N'lists.manage', N'Manage Admin Lists', N'Manage governed lists and shared themes.', N'Administration'),
    (CONVERT(uniqueidentifier, '31000000-0000-0000-0000-000000000025'), N'records.manage', N'Manage Quality Records', N'Search, edit, archive and restore quality records.', N'Administration')
) value(id, permission_key, name, description, category)
WHERE NOT EXISTS (
    SELECT 1
    FROM auth.permissions existing
    WHERE existing.id = value.id OR existing.permission_key = value.permission_key
);
GO

INSERT INTO auth.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM auth.roles role
CROSS JOIN auth.permissions permission
WHERE ((
        role.role_key = N'super_admin'
        AND permission.permission_key IN (N'organisation.manage', N'lists.manage', N'records.manage')
      )
   OR (
        role.role_key = N'teaching_learning_team'
        AND permission.permission_key IN (N'lists.manage', N'records.manage')
      ))
  AND role.archived_at IS NULL
  AND permission.archived_at IS NULL
  AND NOT EXISTS (
      SELECT 1
      FROM auth.role_permissions existing
      WHERE existing.role_id = role.id
        AND existing.permission_id = permission.id
  );
GO

-- Direct reporting relationships are separate from organisation membership.
-- Primary line-manager relationships form the reporting hierarchy; secondary
-- and functional relationships grant direct oversight without inheriting a
-- whole reporting subtree.
IF OBJECT_ID('org.staff_manager_relationships', 'U') IS NULL
BEGIN
    CREATE TABLE org.staff_manager_relationships (
        id uniqueidentifier NOT NULL CONSTRAINT pk_staff_manager_relationships PRIMARY KEY DEFAULT newsequentialid(),
        staff_id uniqueidentifier NOT NULL,
        manager_staff_id uniqueidentifier NOT NULL,
        relationship_type nvarchar(30) NOT NULL CONSTRAINT df_staff_manager_relationship_type DEFAULT N'line_manager',
        is_primary bit NOT NULL CONSTRAINT df_staff_manager_relationship_primary DEFAULT 0,
        active_from date NULL,
        active_to date NULL,
        created_by_user_account_id uniqueidentifier NULL,
        updated_by_user_account_id uniqueidentifier NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_staff_manager_relationship_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        archived_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT fk_staff_manager_relationship_staff FOREIGN KEY (staff_id) REFERENCES people.staff(id),
        CONSTRAINT fk_staff_manager_relationship_manager FOREIGN KEY (manager_staff_id) REFERENCES people.staff(id),
        CONSTRAINT fk_staff_manager_relationship_created_by FOREIGN KEY (created_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT fk_staff_manager_relationship_updated_by FOREIGN KEY (updated_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT ck_staff_manager_relationship_not_self CHECK (staff_id <> manager_staff_id),
        CONSTRAINT ck_staff_manager_relationship_type CHECK (relationship_type IN (N'line_manager', N'secondary', N'functional')),
        CONSTRAINT ck_staff_manager_relationship_primary_type CHECK (is_primary = 0 OR relationship_type = N'line_manager'),
        CONSTRAINT ck_staff_manager_relationship_dates CHECK (active_to IS NULL OR active_from IS NULL OR active_to >= active_from)
    );
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID('org.staff_manager_relationships')
      AND name = 'ux_staff_manager_relationship_active'
)
BEGIN
    CREATE UNIQUE INDEX ux_staff_manager_relationship_active
        ON org.staff_manager_relationships(staff_id, manager_staff_id, relationship_type)
        WHERE archived_at IS NULL AND active_to IS NULL;
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID('org.staff_manager_relationships')
      AND name = 'ux_staff_manager_relationship_primary'
)
BEGIN
    CREATE UNIQUE INDEX ux_staff_manager_relationship_primary
        ON org.staff_manager_relationships(staff_id)
        WHERE is_primary = 1 AND archived_at IS NULL AND active_to IS NULL;
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID('org.staff_manager_relationships')
      AND name = 'ix_staff_manager_relationship_manager'
)
BEGIN
    CREATE INDEX ix_staff_manager_relationship_manager
        ON org.staff_manager_relationships(manager_staff_id, relationship_type, is_primary)
        INCLUDE (staff_id, active_from, active_to, archived_at);
END;
GO

INSERT INTO org.staff_manager_relationships (
    staff_id, manager_staff_id, relationship_type, is_primary, active_from
)
SELECT staff.id, staff.line_manager_staff_id, N'line_manager', 1, staff.start_date
FROM people.staff staff
WHERE staff.line_manager_staff_id IS NOT NULL
  AND staff.archived_at IS NULL
  AND NOT EXISTS (
      SELECT 1
      FROM org.staff_manager_relationships relationship
      WHERE relationship.staff_id = staff.id
        AND relationship.is_primary = 1
        AND relationship.archived_at IS NULL
        AND relationship.active_to IS NULL
  );
GO

-- Keep deletion metadata on the universal record and mark actions archived as
-- part of a source-record cascade so independently deleted actions stay deleted
-- if the source is later restored.
IF COL_LENGTH('core.records', 'deleted_by_user_account_id') IS NULL
    ALTER TABLE core.records ADD deleted_by_user_account_id uniqueidentifier NULL;
GO
IF COL_LENGTH('core.records', 'deletion_reason') IS NULL
    ALTER TABLE core.records ADD deletion_reason nvarchar(1000) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'fk_records_deleted_by')
    ALTER TABLE core.records ADD CONSTRAINT fk_records_deleted_by
        FOREIGN KEY (deleted_by_user_account_id) REFERENCES auth.user_accounts(id);
GO
IF COL_LENGTH('quality.actions', 'archived_with_source') IS NULL
    ALTER TABLE quality.actions ADD archived_with_source bit NOT NULL
        CONSTRAINT df_actions_archived_with_source DEFAULT 0;
GO
IF COL_LENGTH('ops.audit_logs', 'reason') IS NULL
    ALTER TABLE ops.audit_logs ADD reason nvarchar(1000) NULL;
GO

-- Governed administrator lists extend the existing lookup engine. The registry
-- controls which lists are editable and documents every system surface using a
-- list without hard-coding that information in the interface.
IF COL_LENGTH('core.lookup_values', 'created_by_user_account_id') IS NULL
    ALTER TABLE core.lookup_values ADD created_by_user_account_id uniqueidentifier NULL;
GO
IF COL_LENGTH('core.lookup_values', 'updated_by_user_account_id') IS NULL
    ALTER TABLE core.lookup_values ADD updated_by_user_account_id uniqueidentifier NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'fk_lookup_values_created_by')
    ALTER TABLE core.lookup_values ADD CONSTRAINT fk_lookup_values_created_by
        FOREIGN KEY (created_by_user_account_id) REFERENCES auth.user_accounts(id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'fk_lookup_values_updated_by')
    ALTER TABLE core.lookup_values ADD CONSTRAINT fk_lookup_values_updated_by
        FOREIGN KEY (updated_by_user_account_id) REFERENCES auth.user_accounts(id);
GO

IF OBJECT_ID('core.admin_managed_lists', 'U') IS NULL
BEGIN
    CREATE TABLE core.admin_managed_lists (
        lookup_type_id uniqueidentifier NOT NULL CONSTRAINT pk_admin_managed_lists PRIMARY KEY,
        category nvarchar(100) NOT NULL,
        description nvarchar(1000) NULL,
        display_order int NOT NULL,
        is_active bit NOT NULL CONSTRAINT df_admin_managed_lists_active DEFAULT 1,
        created_at datetimeoffset NOT NULL CONSTRAINT df_admin_managed_lists_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        CONSTRAINT fk_admin_managed_lists_type FOREIGN KEY (lookup_type_id) REFERENCES core.lookup_types(id)
    );
END;
GO

IF OBJECT_ID('core.lookup_usage_registry', 'U') IS NULL
BEGIN
    CREATE TABLE core.lookup_usage_registry (
        lookup_type_id uniqueidentifier NOT NULL,
        application_key nvarchar(100) NOT NULL,
        display_name nvarchar(250) NOT NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_lookup_usage_registry_created DEFAULT sysutcdatetime(),
        CONSTRAINT pk_lookup_usage_registry PRIMARY KEY (lookup_type_id, application_key),
        CONSTRAINT fk_lookup_usage_registry_type FOREIGN KEY (lookup_type_id) REFERENCES core.lookup_types(id)
    );
END;
GO

INSERT INTO core.admin_managed_lists (lookup_type_id, category, description, display_order)
SELECT type.id, value.category, value.description, value.display_order
FROM (VALUES
    (N'cpd_theme', N'CPD', N'Themes available when recording CPD.', 10),
    (N'elevate_environment_purpose', N'Learning Environment', N'Intended purposes available on Learning Environment reviews.', 20),
    (N'coaching_development_stage', N'Coaching and Mentoring', N'Staff development stages.', 30),
    (N'coaching_focus_area', N'Coaching and Mentoring', N'Coaching and mentoring focus areas.', 40),
    (N'coaching_support_type', N'Coaching and Mentoring', N'Mentor support and comment categories.', 50)
) value(lookup_key, category, description, display_order)
JOIN core.lookup_types type ON type.lookup_key = value.lookup_key
WHERE NOT EXISTS (
    SELECT 1 FROM core.admin_managed_lists existing WHERE existing.lookup_type_id = type.id
);
GO

IF COL_LENGTH('org.staff_org_memberships', 'created_by_user_account_id') IS NULL
    ALTER TABLE org.staff_org_memberships ADD created_by_user_account_id uniqueidentifier NULL;
GO
IF COL_LENGTH('org.staff_org_memberships', 'updated_by_user_account_id') IS NULL
    ALTER TABLE org.staff_org_memberships ADD updated_by_user_account_id uniqueidentifier NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'fk_staff_org_memberships_created_by')
    ALTER TABLE org.staff_org_memberships ADD CONSTRAINT fk_staff_org_memberships_created_by
        FOREIGN KEY (created_by_user_account_id) REFERENCES auth.user_accounts(id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'fk_staff_org_memberships_updated_by')
    ALTER TABLE org.staff_org_memberships ADD CONSTRAINT fk_staff_org_memberships_updated_by
        FOREIGN KEY (updated_by_user_account_id) REFERENCES auth.user_accounts(id);
GO

INSERT INTO core.lookup_usage_registry (lookup_type_id, application_key, display_name)
SELECT type.id, value.application_key, value.display_name
FROM (VALUES
    (N'cpd_theme', N'cpd.form', N'CPD forms'),
    (N'cpd_theme', N'cpd.reporting', N'CPD dashboards and reporting'),
    (N'elevate_environment_purpose', N'elevate_environment.form', N'Learning Environment reviews'),
    (N'coaching_development_stage', N'coaching.form', N'Coaching and Mentoring forms'),
    (N'coaching_focus_area', N'coaching.focus', N'Coaching and Mentoring focus areas'),
    (N'coaching_support_type', N'coaching.support', N'Coaching and Mentoring mentor comments')
) value(lookup_key, application_key, display_name)
JOIN core.lookup_types type ON type.lookup_key = value.lookup_key
WHERE NOT EXISTS (
    SELECT 1
    FROM core.lookup_usage_registry existing
    WHERE existing.lookup_type_id = type.id
      AND existing.application_key = value.application_key
);
GO

-- Shared themes are a governed catalogue. Elevate Your Practice remains a
-- separate fixed rubric; reporting can cross-map it without weakening rubric
-- versioning or exposing ordinary lists as rubric descriptors.
IF OBJECT_ID('core.theme_groups', 'U') IS NULL
BEGIN
    CREATE TABLE core.theme_groups (
        id uniqueidentifier NOT NULL CONSTRAINT pk_theme_groups PRIMARY KEY,
        group_key nvarchar(100) NOT NULL,
        name nvarchar(200) NOT NULL,
        description nvarchar(1000) NULL,
        display_order int NOT NULL,
        is_active bit NOT NULL CONSTRAINT df_theme_groups_active DEFAULT 1,
        created_by_user_account_id uniqueidentifier NULL,
        updated_by_user_account_id uniqueidentifier NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_theme_groups_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        archived_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT uq_theme_groups_key UNIQUE (group_key),
        CONSTRAINT fk_theme_groups_created_by FOREIGN KEY (created_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT fk_theme_groups_updated_by FOREIGN KEY (updated_by_user_account_id) REFERENCES auth.user_accounts(id)
    );
END;
GO

IF OBJECT_ID('core.themes', 'U') IS NULL
BEGIN
    CREATE TABLE core.themes (
        id uniqueidentifier NOT NULL CONSTRAINT pk_themes PRIMARY KEY DEFAULT newsequentialid(),
        theme_group_id uniqueidentifier NOT NULL,
        theme_key nvarchar(150) NOT NULL,
        name nvarchar(250) NOT NULL,
        description nvarchar(1000) NULL,
        asset_key nvarchar(150) NULL,
        display_order int NOT NULL,
        is_other bit NOT NULL CONSTRAINT df_themes_other DEFAULT 0,
        is_active bit NOT NULL CONSTRAINT df_themes_active DEFAULT 1,
        created_by_user_account_id uniqueidentifier NULL,
        updated_by_user_account_id uniqueidentifier NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_themes_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        archived_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT fk_themes_group FOREIGN KEY (theme_group_id) REFERENCES core.theme_groups(id),
        CONSTRAINT fk_themes_created_by FOREIGN KEY (created_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT fk_themes_updated_by FOREIGN KEY (updated_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT uq_themes_key UNIQUE (theme_key)
    );
END;
GO

IF OBJECT_ID('core.theme_applications', 'U') IS NULL
BEGIN
    CREATE TABLE core.theme_applications (
        theme_id uniqueidentifier NOT NULL,
        application_key nvarchar(100) NOT NULL,
        display_order int NOT NULL,
        is_active bit NOT NULL CONSTRAINT df_theme_applications_active DEFAULT 1,
        created_at datetimeoffset NOT NULL CONSTRAINT df_theme_applications_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        CONSTRAINT pk_theme_applications PRIMARY KEY (theme_id, application_key),
        CONSTRAINT fk_theme_applications_theme FOREIGN KEY (theme_id) REFERENCES core.themes(id)
    );
END;
GO

INSERT INTO core.theme_groups (id, group_key, name, display_order, is_active, created_at, updated_at, archived_at)
SELECT id, group_key, name, display_order, is_active, created_at, updated_at, archived_at
FROM quality.learning_walk_theme_groups source
WHERE NOT EXISTS (SELECT 1 FROM core.theme_groups target WHERE target.id = source.id OR target.group_key = source.group_key);
GO

INSERT INTO core.themes (
    id, theme_group_id, theme_key, name, display_order, is_other, is_active,
    created_by_user_account_id, updated_by_user_account_id, created_at, updated_at, archived_at
)
SELECT
    theme.id,
    theme.theme_group_id,
    CASE
        WHEN theme.is_other = 1 THEN N'other'
        WHEN group_row.group_key IN (N'teaching_learning_expectations', N'digital', N'sustainability') THEN group_row.group_key
        ELSE CONCAT(group_row.group_key, N'_', CONVERT(nvarchar(36), theme.id))
    END,
    theme.name,
    theme.display_order,
    theme.is_other,
    theme.is_active,
    theme.created_by_user_account_id,
    theme.updated_by_user_account_id,
    theme.created_at,
    theme.updated_at,
    theme.archived_at
FROM quality.learning_walk_themes theme
JOIN quality.learning_walk_theme_groups group_row ON group_row.id = theme.theme_group_id
WHERE NOT EXISTS (SELECT 1 FROM core.themes target WHERE target.id = theme.id);
GO

INSERT INTO core.theme_applications (theme_id, application_key, display_order)
SELECT theme.id, application.application_key, theme.display_order
FROM core.themes theme
CROSS JOIN (VALUES (N'learning_walk'), (N'liv'), (N'reporting')) application(application_key)
WHERE NOT EXISTS (
    SELECT 1
    FROM core.theme_applications existing
    WHERE existing.theme_id = theme.id
      AND existing.application_key = application.application_key
);
GO

IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'fk_learning_walk_record_themes_theme')
    ALTER TABLE quality.learning_walk_record_themes DROP CONSTRAINT fk_learning_walk_record_themes_theme;
GO
IF OBJECT_ID('quality.learning_walk_record_themes', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'fk_learning_walk_record_themes_shared_theme')
    ALTER TABLE quality.learning_walk_record_themes ADD CONSTRAINT fk_learning_walk_record_themes_shared_theme
        FOREIGN KEY (theme_id) REFERENCES core.themes(id);
GO

IF OBJECT_ID('quality.liv_record_themes', 'U') IS NULL
BEGIN
    CREATE TABLE quality.liv_record_themes (
        liv_record_id uniqueidentifier NOT NULL,
        theme_id uniqueidentifier NOT NULL,
        theme_name_snapshot nvarchar(250) NOT NULL,
        group_name_snapshot nvarchar(200) NOT NULL,
        display_order_snapshot int NOT NULL,
        selected_at datetimeoffset NOT NULL CONSTRAINT df_liv_record_themes_selected DEFAULT sysutcdatetime(),
        CONSTRAINT pk_liv_record_themes PRIMARY KEY (liv_record_id, theme_id),
        CONSTRAINT fk_liv_record_themes_record FOREIGN KEY (liv_record_id) REFERENCES quality.liv_records(id),
        CONSTRAINT fk_liv_record_themes_theme FOREIGN KEY (theme_id) REFERENCES core.themes(id)
    );
END;
GO

INSERT INTO quality.liv_record_themes (
    liv_record_id, theme_id, theme_name_snapshot, group_name_snapshot, display_order_snapshot
)
SELECT DISTINCT liv.id, theme.id, theme.name, group_row.name, theme.display_order
FROM quality.liv_records liv
CROSS APPLY OPENJSON(CASE WHEN ISJSON(liv.area_of_practice_keys_json) = 1 THEN liv.area_of_practice_keys_json ELSE N'[]' END) selected
JOIN core.themes theme ON theme.theme_key = selected.value
JOIN core.theme_groups group_row ON group_row.id = theme.theme_group_id
WHERE NOT EXISTS (
    SELECT 1
    FROM quality.liv_record_themes existing
    WHERE existing.liv_record_id = liv.id
      AND existing.theme_id = theme.id
);
GO

-- Organisation visibility is resolved separately from people visibility so
-- activity records remain scoped even when they have no subject staff member.
DROP FUNCTION IF EXISTS org.fn_visible_org_units;
GO
CREATE FUNCTION org.fn_visible_org_units (@user_account_id uniqueidentifier)
RETURNS @visible TABLE (org_unit_id uniqueidentifier NOT NULL PRIMARY KEY)
AS
BEGIN
    DECLARE @viewer_staff_id uniqueidentifier;
    DECLARE @now datetimeoffset = sysutcdatetime();
    DECLARE @today date = CONVERT(date, @now);

    SELECT @viewer_staff_id = account.staff_id
    FROM auth.user_accounts account
    WHERE account.id = @user_account_id
      AND account.archived_at IS NULL
      AND account.is_disabled = 0;

    IF @viewer_staff_id IS NULL RETURN;

    DECLARE @permissions TABLE (permission_key nvarchar(160) NOT NULL PRIMARY KEY);
    INSERT INTO @permissions (permission_key)
    SELECT DISTINCT permission.permission_key
    FROM auth.user_roles user_role
    JOIN auth.role_permissions role_permission ON role_permission.role_id = user_role.role_id
    JOIN auth.permissions permission ON permission.id = role_permission.permission_id
        AND permission.archived_at IS NULL
    WHERE user_role.user_account_id = @user_account_id
      AND user_role.active_from <= @now
      AND (user_role.active_to IS NULL OR user_role.active_to > @now);

    IF EXISTS (
        SELECT 1 FROM @permissions
        WHERE permission_key IN (N'staff.manage', N'users.manage', N'reports.view_all')
    ) OR EXISTS (
        SELECT 1
        FROM auth.access_scopes scope
        WHERE scope.user_account_id = @user_account_id
          AND scope.scope_type = N'global'
          AND scope.is_active = 1
          AND scope.archived_at IS NULL
    )
    BEGIN
        INSERT INTO @visible (org_unit_id)
        SELECT unit.id
        FROM org.org_units unit
        WHERE unit.archived_at IS NULL
          AND unit.is_active = 1;
        RETURN;
    END;

    DECLARE @base_org_units TABLE (org_unit_id uniqueidentifier NOT NULL PRIMARY KEY);
    INSERT INTO @base_org_units (org_unit_id)
    SELECT org_unit_id
    FROM (
        SELECT scope.org_unit_id
        FROM auth.access_scopes scope
        WHERE scope.user_account_id = @user_account_id
          AND scope.scope_type = N'assigned_org_units'
          AND scope.org_unit_id IS NOT NULL
          AND scope.is_active = 1
          AND scope.archived_at IS NULL

        UNION

        SELECT membership.org_unit_id
        FROM org.staff_org_memberships membership
        WHERE membership.staff_id = @viewer_staff_id
          AND membership.archived_at IS NULL
          AND (membership.active_from IS NULL OR membership.active_from <= @today)
          AND (membership.active_to IS NULL OR membership.active_to >= @today)
          AND EXISTS (
              SELECT 1 FROM @permissions permission
              WHERE permission.permission_key IN (N'my_team.view', N'reports.view_scoped')
          )

        UNION

        SELECT staff.primary_org_unit_id
        FROM people.staff staff
        WHERE staff.id = @viewer_staff_id
          AND staff.primary_org_unit_id IS NOT NULL
          AND EXISTS (
              SELECT 1 FROM @permissions permission
              WHERE permission.permission_key IN (N'my_team.view', N'reports.view_scoped')
          )
    ) base_scope;

    ;WITH org_tree AS (
        SELECT
            base.org_unit_id,
            0 AS relationship_depth,
            CONVERT(varchar(max), CONCAT(N'|', CONVERT(varchar(36), base.org_unit_id), N'|')) AS visited
        FROM @base_org_units base

        UNION ALL

        SELECT
            child.id,
            parent.relationship_depth + 1,
            CONVERT(varchar(max), CONCAT(parent.visited, CONVERT(varchar(36), child.id), N'|'))
        FROM org.org_units child
        JOIN org_tree parent ON parent.org_unit_id = child.parent_org_unit_id
        WHERE child.archived_at IS NULL
          AND child.is_active = 1
          AND parent.relationship_depth < 32
          AND CHARINDEX(CONCAT(N'|', CONVERT(varchar(36), child.id), N'|'), parent.visited) = 0
    )
    INSERT INTO @visible (org_unit_id)
    SELECT DISTINCT org_unit_id FROM org_tree;

    RETURN;
END;
GO

-- One reusable organisation resolver supplies self, direct/indirect management,
-- own allocated faculties/teams, explicit scopes and global access. Primary
-- manager edges recurse; secondary and functional edges are direct only.
DROP FUNCTION IF EXISTS org.fn_visible_staff;
GO
CREATE FUNCTION org.fn_visible_staff (@user_account_id uniqueidentifier)
RETURNS @visible TABLE (
    staff_id uniqueidentifier NOT NULL PRIMARY KEY,
    is_self bit NOT NULL,
    is_managed bit NOT NULL,
    is_org_scoped bit NOT NULL,
    manager_depth int NULL
)
AS
BEGIN
    DECLARE @viewer_staff_id uniqueidentifier;
    DECLARE @now datetimeoffset = sysutcdatetime();
    DECLARE @today date = CONVERT(date, @now);

    SELECT @viewer_staff_id = account.staff_id
    FROM auth.user_accounts account
    WHERE account.id = @user_account_id
      AND account.archived_at IS NULL
      AND account.is_disabled = 0;

    IF @viewer_staff_id IS NULL RETURN;

    DECLARE @permissions TABLE (permission_key nvarchar(160) NOT NULL PRIMARY KEY);
    INSERT INTO @permissions (permission_key)
    SELECT DISTINCT permission.permission_key
    FROM auth.user_roles user_role
    JOIN auth.role_permissions role_permission ON role_permission.role_id = user_role.role_id
    JOIN auth.permissions permission ON permission.id = role_permission.permission_id
        AND permission.archived_at IS NULL
    WHERE user_role.user_account_id = @user_account_id
      AND user_role.active_from <= @now
      AND (user_role.active_to IS NULL OR user_role.active_to > @now);

    DECLARE @eligible TABLE (
        staff_id uniqueidentifier NOT NULL,
        is_self bit NOT NULL,
        is_managed bit NOT NULL,
        is_org_scoped bit NOT NULL,
        relationship_depth int NULL
    );

    INSERT INTO @eligible VALUES (@viewer_staff_id, 1, 0, 0, 0);

    IF EXISTS (
        SELECT 1 FROM @permissions
        WHERE permission_key IN (N'staff.manage', N'users.manage', N'reports.view_all')
    ) OR EXISTS (
        SELECT 1
        FROM auth.access_scopes scope
        WHERE scope.user_account_id = @user_account_id
          AND scope.scope_type = N'global'
          AND scope.is_active = 1
          AND scope.archived_at IS NULL
    )
    BEGIN
        INSERT INTO @eligible (staff_id, is_self, is_managed, is_org_scoped, relationship_depth)
        SELECT staff.id, 0, 0, 1, NULL
        FROM people.staff staff
        WHERE staff.archived_at IS NULL;
    END;

    DECLARE @manager_edges TABLE (
        staff_id uniqueidentifier NOT NULL,
        manager_staff_id uniqueidentifier NOT NULL,
        is_primary bit NOT NULL
    );

    INSERT INTO @manager_edges (staff_id, manager_staff_id, is_primary)
    SELECT relationship.staff_id, relationship.manager_staff_id, relationship.is_primary
    FROM org.staff_manager_relationships relationship
    WHERE relationship.archived_at IS NULL
      AND (relationship.active_from IS NULL OR relationship.active_from <= @today)
      AND (relationship.active_to IS NULL OR relationship.active_to >= @today);

    INSERT INTO @manager_edges (staff_id, manager_staff_id, is_primary)
    SELECT staff.id, staff.line_manager_staff_id, 1
    FROM people.staff staff
    WHERE staff.line_manager_staff_id IS NOT NULL
      AND staff.archived_at IS NULL
      AND NOT EXISTS (
          SELECT 1
          FROM org.staff_manager_relationships relationship
          WHERE relationship.staff_id = staff.id
            AND relationship.is_primary = 1
            AND relationship.archived_at IS NULL
            AND (relationship.active_from IS NULL OR relationship.active_from <= @today)
            AND (relationship.active_to IS NULL OR relationship.active_to >= @today)
      );

    ;WITH manager_tree AS (
        SELECT
            edge.staff_id,
            1 AS relationship_depth,
            edge.is_primary AS can_recurse,
            CONVERT(varchar(max), CONCAT(N'|', CONVERT(varchar(36), @viewer_staff_id), N'|', CONVERT(varchar(36), edge.staff_id), N'|')) AS visited
        FROM @manager_edges edge
        WHERE edge.manager_staff_id = @viewer_staff_id

        UNION ALL

        SELECT
            edge.staff_id,
            parent.relationship_depth + 1,
            edge.is_primary,
            CONVERT(varchar(max), CONCAT(parent.visited, CONVERT(varchar(36), edge.staff_id), N'|'))
        FROM @manager_edges edge
        JOIN manager_tree parent ON parent.staff_id = edge.manager_staff_id
        WHERE parent.can_recurse = 1
          AND edge.is_primary = 1
          AND parent.relationship_depth < 64
          AND CHARINDEX(CONCAT(N'|', CONVERT(varchar(36), edge.staff_id), N'|'), parent.visited) = 0
    )
    INSERT INTO @eligible (staff_id, is_self, is_managed, is_org_scoped, relationship_depth)
    SELECT staff_id, 0, 1, 0, relationship_depth
    FROM manager_tree;

    DECLARE @base_org_units TABLE (org_unit_id uniqueidentifier NOT NULL PRIMARY KEY);
    INSERT INTO @base_org_units (org_unit_id)
    SELECT org_unit_id
    FROM (
        SELECT scope.org_unit_id
        FROM auth.access_scopes scope
        WHERE scope.user_account_id = @user_account_id
          AND scope.scope_type = N'assigned_org_units'
          AND scope.org_unit_id IS NOT NULL
          AND scope.is_active = 1
          AND scope.archived_at IS NULL

        UNION

        SELECT membership.org_unit_id
        FROM org.staff_org_memberships membership
        WHERE membership.staff_id = @viewer_staff_id
          AND membership.archived_at IS NULL
          AND (membership.active_from IS NULL OR membership.active_from <= @today)
          AND (membership.active_to IS NULL OR membership.active_to >= @today)
          AND EXISTS (
              SELECT 1 FROM @permissions permission
              WHERE permission.permission_key IN (N'my_team.view', N'reports.view_scoped')
          )

        UNION

        SELECT staff.primary_org_unit_id
        FROM people.staff staff
        WHERE staff.id = @viewer_staff_id
          AND staff.primary_org_unit_id IS NOT NULL
          AND EXISTS (
              SELECT 1 FROM @permissions permission
              WHERE permission.permission_key IN (N'my_team.view', N'reports.view_scoped')
          )
    ) base_scope;

    DECLARE @scoped_org_units TABLE (org_unit_id uniqueidentifier NOT NULL PRIMARY KEY);
    ;WITH org_tree AS (
        SELECT
            base.org_unit_id,
            0 AS relationship_depth,
            CONVERT(varchar(max), CONCAT(N'|', CONVERT(varchar(36), base.org_unit_id), N'|')) AS visited
        FROM @base_org_units base

        UNION ALL

        SELECT
            child.id,
            parent.relationship_depth + 1,
            CONVERT(varchar(max), CONCAT(parent.visited, CONVERT(varchar(36), child.id), N'|'))
        FROM org.org_units child
        JOIN org_tree parent ON parent.org_unit_id = child.parent_org_unit_id
        WHERE child.archived_at IS NULL
          AND child.is_active = 1
          AND parent.relationship_depth < 32
          AND CHARINDEX(CONCAT(N'|', CONVERT(varchar(36), child.id), N'|'), parent.visited) = 0
    )
    INSERT INTO @scoped_org_units (org_unit_id)
    SELECT DISTINCT org_unit_id FROM org_tree;

    INSERT INTO @eligible (staff_id, is_self, is_managed, is_org_scoped, relationship_depth)
    SELECT DISTINCT staff.id, 0, 0, 1, NULL
    FROM people.staff staff
    WHERE staff.archived_at IS NULL
      AND (
          EXISTS (SELECT 1 FROM @scoped_org_units scope WHERE scope.org_unit_id = staff.primary_org_unit_id)
          OR EXISTS (
              SELECT 1
              FROM org.staff_org_memberships membership
              JOIN @scoped_org_units scope ON scope.org_unit_id = membership.org_unit_id
              WHERE membership.staff_id = staff.id
                AND membership.archived_at IS NULL
                AND (membership.active_from IS NULL OR membership.active_from <= @today)
                AND (membership.active_to IS NULL OR membership.active_to >= @today)
          )
      );

    INSERT INTO @eligible (staff_id, is_self, is_managed, is_org_scoped, relationship_depth)
    SELECT scope.staff_id, 0, 0, 1, NULL
    FROM auth.access_scopes scope
    WHERE scope.user_account_id = @user_account_id
      AND scope.scope_type = N'specific_staff'
      AND scope.staff_id IS NOT NULL
      AND scope.is_active = 1
      AND scope.archived_at IS NULL;

    INSERT INTO @visible (staff_id, is_self, is_managed, is_org_scoped, manager_depth)
    SELECT
        eligible.staff_id,
        CONVERT(bit, MAX(CONVERT(int, eligible.is_self))),
        CONVERT(bit, MAX(CONVERT(int, eligible.is_managed))),
        CONVERT(bit, MAX(CONVERT(int, eligible.is_org_scoped))),
        MIN(NULLIF(eligible.relationship_depth, 0))
    FROM @eligible eligible
    GROUP BY eligible.staff_id;

    RETURN;
END;
GO
