SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO

/*
    Staff membership describes where somebody works. It must not implicitly
    grant management or reporting access. Those rights come from explicit
    access scopes, manager relationships, or global permissions.
*/
CREATE OR ALTER FUNCTION org.fn_visible_staff (@user_account_id uniqueidentifier)
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
    SELECT DISTINCT scope.org_unit_id
    FROM auth.access_scopes scope
    WHERE scope.user_account_id = @user_account_id
      AND scope.scope_type = N'assigned_org_units'
      AND scope.org_unit_id IS NOT NULL
      AND scope.is_active = 1
      AND scope.archived_at IS NULL;

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

-- Memberships were mapped in migration 036; retire the superseded node.
UPDATE org.org_units
SET is_active = 0,
    effective_to = COALESCE(effective_to, CONVERT(date, sysutcdatetime())),
    updated_at = sysutcdatetime()
WHERE code = N'WBL-CUCB'
  AND is_active = 1;
GO

/* Durable application events allow message rules to evolve independently of forms. */
IF OBJECT_ID(N'ops.domain_events', N'U') IS NULL
BEGIN
    CREATE TABLE ops.domain_events (
        id uniqueidentifier NOT NULL CONSTRAINT pk_domain_events PRIMARY KEY DEFAULT newsequentialid(),
        event_type nvarchar(120) NOT NULL,
        aggregate_type nvarchar(100) NOT NULL,
        aggregate_id uniqueidentifier NULL,
        source_record_id uniqueidentifier NULL,
        payload_json nvarchar(max) NOT NULL CONSTRAINT df_domain_event_payload DEFAULT N'{}',
        occurred_at datetimeoffset NOT NULL CONSTRAINT df_domain_event_occurred DEFAULT sysutcdatetime(),
        published_by_user_account_id uniqueidentifier NULL,
        processed_at datetimeoffset NULL,
        processing_error nvarchar(2000) NULL,
        attempt_count int NOT NULL CONSTRAINT df_domain_event_attempt_count DEFAULT 0,
        CONSTRAINT fk_domain_event_record FOREIGN KEY (source_record_id) REFERENCES core.records(id),
        CONSTRAINT fk_domain_event_user FOREIGN KEY (published_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT ck_domain_event_payload_json CHECK (ISJSON(payload_json) = 1)
    );
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'ops.domain_events') AND name = N'ix_domain_events_pending'
)
    CREATE INDEX ix_domain_events_pending ON ops.domain_events(processed_at, occurred_at)
        INCLUDE (event_type, aggregate_type, aggregate_id, source_record_id, attempt_count);
GO
