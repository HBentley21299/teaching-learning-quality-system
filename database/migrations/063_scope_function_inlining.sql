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

/*
    Performance: convert the two access-scope functions from multi-statement
    table-valued functions (MSTVFs) to inline table-valued functions (iTVFs).

    An MSTVF returns a table variable. The optimiser cannot see inside it, so
    every statement that references one is subject to interleaved execution:
    the function is materialised in full and the consuming statement is
    recompiled on each execution. Measured on the local dataset this cost
    roughly 67ms per call for fn_visible_staff, while the query logic itself
    accounts for about 7ms. Because scope is applied on essentially every
    read, a single API request paid that penalty ten or more times.

    An iTVF is expanded into the calling query like a view, so it is optimised
    once as part of the outer plan and can use the underlying indexes.

    Behaviour is preserved exactly, including the fact that
    fn_visible_org_units does not check whether the account is active or
    archived. That is a pre-existing access-control gap; changing it belongs
    in a security fix, not in a performance change.
*/

/*
    The functions are dropped and recreated rather than altered: SQL Server
    cannot ALTER a multi-statement table-valued function into an inline one.
    Neither function carries explicit GRANTs, so nothing is lost by the drop.
*/
DROP FUNCTION IF EXISTS org.fn_visible_staff;
GO

CREATE FUNCTION org.fn_visible_staff (@user_account_id uniqueidentifier)
RETURNS TABLE
AS
RETURN
    WITH viewer AS (
        SELECT account.staff_id AS viewer_staff_id
        FROM auth.user_accounts account
        WHERE account.id = @user_account_id
          AND account.archived_at IS NULL
          AND account.is_disabled = 0
          AND account.staff_id IS NOT NULL
    ),
    global_access AS (
        SELECT 1 AS is_global
        WHERE EXISTS (
            SELECT 1
            FROM auth.user_roles user_role
            JOIN auth.role_permissions role_permission
                ON role_permission.role_id = user_role.role_id
            JOIN auth.permissions permission
                ON permission.id = role_permission.permission_id
               AND permission.archived_at IS NULL
            WHERE user_role.user_account_id = @user_account_id
              AND user_role.active_from <= CAST(SYSUTCDATETIME() AS datetimeoffset)
              AND (user_role.active_to IS NULL OR user_role.active_to > CAST(SYSUTCDATETIME() AS datetimeoffset))
              AND permission.permission_key IN (N'staff.manage', N'users.manage', N'reports.view_all')
        )
        OR EXISTS (
            SELECT 1
            FROM auth.access_scopes scope
            WHERE scope.user_account_id = @user_account_id
              AND scope.scope_type = N'global'
              AND scope.is_active = 1
              AND scope.archived_at IS NULL
        )
    ),
    manager_edges AS (
        SELECT relationship.staff_id, relationship.manager_staff_id, relationship.is_primary
        FROM org.staff_manager_relationships relationship
        WHERE relationship.archived_at IS NULL
          AND (relationship.active_from IS NULL OR relationship.active_from <= CONVERT(date, SYSUTCDATETIME()))
          AND (relationship.active_to IS NULL OR relationship.active_to >= CONVERT(date, SYSUTCDATETIME()))

        UNION ALL

        SELECT staff.id, staff.line_manager_staff_id, CONVERT(bit, 1)
        FROM people.staff staff
        WHERE staff.line_manager_staff_id IS NOT NULL
          AND staff.archived_at IS NULL
          AND NOT EXISTS (
              SELECT 1
              FROM org.staff_manager_relationships relationship
              WHERE relationship.staff_id = staff.id
                AND relationship.is_primary = 1
                AND relationship.archived_at IS NULL
                AND (relationship.active_from IS NULL OR relationship.active_from <= CONVERT(date, SYSUTCDATETIME()))
                AND (relationship.active_to IS NULL OR relationship.active_to >= CONVERT(date, SYSUTCDATETIME()))
          )
    ),
    manager_tree AS (
        SELECT
            edge.staff_id,
            1 AS relationship_depth,
            edge.is_primary AS can_recurse,
            CONVERT(varchar(max), CONCAT(N'|', CONVERT(varchar(36), viewer.viewer_staff_id), N'|', CONVERT(varchar(36), edge.staff_id), N'|')) AS visited
        FROM manager_edges edge
        JOIN viewer ON viewer.viewer_staff_id = edge.manager_staff_id

        UNION ALL

        SELECT
            edge.staff_id,
            parent.relationship_depth + 1,
            edge.is_primary,
            CONVERT(varchar(max), CONCAT(parent.visited, CONVERT(varchar(36), edge.staff_id), N'|'))
        FROM manager_edges edge
        JOIN manager_tree parent ON parent.staff_id = edge.manager_staff_id
        WHERE parent.can_recurse = 1
          AND edge.is_primary = 1
          AND parent.relationship_depth < 64
          AND CHARINDEX(CONCAT(N'|', CONVERT(varchar(36), edge.staff_id), N'|'), parent.visited) = 0
    ),
    base_org_units AS (
        SELECT DISTINCT scope.org_unit_id
        FROM auth.access_scopes scope
        WHERE scope.user_account_id = @user_account_id
          AND scope.scope_type = N'assigned_org_units'
          AND scope.org_unit_id IS NOT NULL
          AND scope.is_active = 1
          AND scope.archived_at IS NULL
    ),
    org_tree AS (
        SELECT
            base.org_unit_id,
            0 AS relationship_depth,
            CONVERT(varchar(max), CONCAT(N'|', CONVERT(varchar(36), base.org_unit_id), N'|')) AS visited
        FROM base_org_units base

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
    ),
    scoped_org_units AS (
        SELECT DISTINCT org_unit_id FROM org_tree
    ),
    eligible AS (
        SELECT
            viewer.viewer_staff_id AS staff_id,
            CONVERT(bit, 1) AS is_self,
            CONVERT(bit, 0) AS is_managed,
            CONVERT(bit, 0) AS is_org_scoped,
            CONVERT(int, 0) AS relationship_depth
        FROM viewer

        UNION ALL

        SELECT staff.id, CONVERT(bit, 0), CONVERT(bit, 0), CONVERT(bit, 1), CONVERT(int, NULL)
        FROM people.staff staff
        WHERE staff.archived_at IS NULL
          AND EXISTS (SELECT 1 FROM viewer)
          AND EXISTS (SELECT 1 FROM global_access)

        UNION ALL

        SELECT tree.staff_id, CONVERT(bit, 0), CONVERT(bit, 1), CONVERT(bit, 0), tree.relationship_depth
        FROM manager_tree tree

        UNION ALL

        SELECT staff.id, CONVERT(bit, 0), CONVERT(bit, 0), CONVERT(bit, 1), CONVERT(int, NULL)
        FROM people.staff staff
        WHERE staff.archived_at IS NULL
          AND EXISTS (SELECT 1 FROM viewer)
          AND (
              EXISTS (
                  SELECT 1
                  FROM scoped_org_units scope
                  WHERE scope.org_unit_id = staff.primary_org_unit_id
              )
              OR EXISTS (
                  SELECT 1
                  FROM org.staff_org_memberships membership
                  JOIN scoped_org_units scope ON scope.org_unit_id = membership.org_unit_id
                  WHERE membership.staff_id = staff.id
                    AND membership.archived_at IS NULL
                    AND (membership.active_from IS NULL OR membership.active_from <= CONVERT(date, SYSUTCDATETIME()))
                    AND (membership.active_to IS NULL OR membership.active_to >= CONVERT(date, SYSUTCDATETIME()))
              )
          )

        UNION ALL

        SELECT scope.staff_id, CONVERT(bit, 0), CONVERT(bit, 0), CONVERT(bit, 1), CONVERT(int, NULL)
        FROM auth.access_scopes scope
        WHERE scope.user_account_id = @user_account_id
          AND scope.scope_type = N'specific_staff'
          AND scope.staff_id IS NOT NULL
          AND scope.is_active = 1
          AND scope.archived_at IS NULL
          AND EXISTS (SELECT 1 FROM viewer)
    )
    SELECT
        eligible.staff_id,
        CONVERT(bit, MAX(CONVERT(int, eligible.is_self))) AS is_self,
        CONVERT(bit, MAX(CONVERT(int, eligible.is_managed))) AS is_managed,
        CONVERT(bit, MAX(CONVERT(int, eligible.is_org_scoped))) AS is_org_scoped,
        MIN(NULLIF(eligible.relationship_depth, 0)) AS manager_depth
    FROM eligible
    GROUP BY eligible.staff_id;
GO

DROP FUNCTION IF EXISTS org.fn_visible_org_units;
GO

CREATE FUNCTION org.fn_visible_org_units (@user_account_id uniqueidentifier)
RETURNS TABLE
AS
RETURN
    WITH global_access AS (
        SELECT 1 AS is_global
        WHERE EXISTS (
            SELECT 1
            FROM auth.user_roles ur
            JOIN auth.role_permissions rp ON rp.role_id = ur.role_id
            JOIN auth.permissions p ON p.id = rp.permission_id
            WHERE ur.user_account_id = @user_account_id
              AND ur.active_from <= CAST(SYSUTCDATETIME() AS datetimeoffset)
              AND (ur.active_to IS NULL OR ur.active_to > CAST(SYSUTCDATETIME() AS datetimeoffset))
              AND p.permission_key IN (N'staff.manage', N'users.manage', N'reports.view_all')
        )
        OR EXISTS (
            SELECT 1
            FROM auth.access_scopes scope
            WHERE scope.user_account_id = @user_account_id
              AND scope.scope_type = N'global'
              AND scope.is_active = 1
              AND scope.archived_at IS NULL
        )
    ),
    base_scope AS (
        SELECT scope.org_unit_id
        FROM auth.access_scopes scope
        WHERE scope.user_account_id = @user_account_id
          AND scope.scope_type = N'assigned_org_units'
          AND scope.org_unit_id IS NOT NULL
          AND scope.is_active = 1
          AND scope.archived_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM global_access)
    ),
    org_tree AS (
        SELECT base_scope.org_unit_id, 0 AS depth
        FROM base_scope

        UNION ALL

        SELECT child.id, tree.depth + 1
        FROM org.org_units child
        JOIN org_tree tree ON tree.org_unit_id = child.parent_org_unit_id
        WHERE child.is_active = 1
          AND child.archived_at IS NULL
          AND tree.depth < 32
    )
    SELECT unit.id AS org_unit_id
    FROM org.org_units unit
    WHERE unit.is_active = 1
      AND unit.archived_at IS NULL
      AND EXISTS (SELECT 1 FROM global_access)

    UNION

    SELECT org_tree.org_unit_id
    FROM org_tree;
GO
