SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO

IF COL_LENGTH('org.staff_manager_relationships', 'assignment_source') IS NULL
BEGIN
    ALTER TABLE org.staff_manager_relationships
    ADD assignment_source nvarchar(50) NOT NULL
        CONSTRAINT df_staff_manager_relationship_assignment_source DEFAULT N'manual' WITH VALUES;
END;
GO

IF COL_LENGTH('org.staff_manager_relationships', 'source_org_unit_id') IS NULL
    ALTER TABLE org.staff_manager_relationships ADD source_org_unit_id uniqueidentifier NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'fk_staff_manager_relationship_source_org')
    ALTER TABLE org.staff_manager_relationships ADD CONSTRAINT fk_staff_manager_relationship_source_org
        FOREIGN KEY (source_org_unit_id) REFERENCES org.org_units(id);
GO

IF COL_LENGTH('auth.user_roles', 'assignment_source') IS NULL
BEGIN
    ALTER TABLE auth.user_roles
    ADD assignment_source nvarchar(50) NOT NULL
        CONSTRAINT df_user_roles_assignment_source DEFAULT N'manual' WITH VALUES;
END;
GO

IF COL_LENGTH('auth.access_scopes', 'assignment_source') IS NULL
BEGIN
    ALTER TABLE auth.access_scopes
    ADD assignment_source nvarchar(50) NOT NULL
        CONSTRAINT df_access_scopes_assignment_source DEFAULT N'manual' WITH VALUES;
END;
GO

IF OBJECT_ID('org.org_unit_leaderships', 'U') IS NULL
BEGIN
    CREATE TABLE org.org_unit_leaderships (
        id uniqueidentifier NOT NULL CONSTRAINT pk_org_unit_leaderships PRIMARY KEY DEFAULT newsequentialid(),
        org_unit_id uniqueidentifier NOT NULL,
        leader_staff_id uniqueidentifier NOT NULL,
        leadership_role nvarchar(50) NOT NULL CONSTRAINT df_org_unit_leadership_role DEFAULT N'manager',
        active_from date NOT NULL CONSTRAINT df_org_unit_leadership_active_from DEFAULT CONVERT(date, sysutcdatetime()),
        active_to date NULL,
        created_by_user_account_id uniqueidentifier NULL,
        updated_by_user_account_id uniqueidentifier NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_org_unit_leadership_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        archived_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT fk_org_unit_leadership_org FOREIGN KEY (org_unit_id) REFERENCES org.org_units(id),
        CONSTRAINT fk_org_unit_leadership_staff FOREIGN KEY (leader_staff_id) REFERENCES people.staff(id),
        CONSTRAINT fk_org_unit_leadership_created_by FOREIGN KEY (created_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT fk_org_unit_leadership_updated_by FOREIGN KEY (updated_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT ck_org_unit_leadership_role CHECK (leadership_role IN (N'manager')),
        CONSTRAINT ck_org_unit_leadership_dates CHECK (active_to IS NULL OR active_to >= active_from)
    );
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID('org.org_unit_leaderships')
      AND name = 'ux_org_unit_leadership_active'
)
BEGIN
    CREATE UNIQUE INDEX ux_org_unit_leadership_active
        ON org.org_unit_leaderships(org_unit_id, leadership_role)
        WHERE archived_at IS NULL AND active_to IS NULL;
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID('org.org_unit_leaderships')
      AND name = 'ix_org_unit_leadership_staff'
)
BEGIN
    CREATE INDEX ix_org_unit_leadership_staff
        ON org.org_unit_leaderships(leader_staff_id, leadership_role)
        INCLUDE (org_unit_id, active_from, active_to, archived_at);
END;
GO

-- Preserve existing Programme Leader and Head of Faculty allocations as the
-- first authoritative unit-manager assignments.
;WITH leadership_candidates AS (
    SELECT
        membership.org_unit_id,
        account.staff_id,
        ROW_NUMBER() OVER (
            PARTITION BY membership.org_unit_id
            ORDER BY membership.is_primary DESC, user_role.active_from, account.staff_id
        ) AS candidate_order
    FROM org.staff_org_memberships membership
    JOIN org.org_units unit ON unit.id = membership.org_unit_id
        AND unit.org_unit_type IN (N'faculty', N'team')
        AND unit.is_active = 1
        AND unit.archived_at IS NULL
    JOIN auth.user_accounts account ON account.staff_id = membership.staff_id
        AND account.account_status = N'active'
        AND account.is_disabled = 0
        AND account.archived_at IS NULL
    JOIN auth.user_roles user_role ON user_role.user_account_id = account.id
        AND user_role.active_from <= sysutcdatetime()
        AND (user_role.active_to IS NULL OR user_role.active_to > sysutcdatetime())
    JOIN auth.roles role ON role.id = user_role.role_id
        AND role.role_key = CASE unit.org_unit_type
            WHEN N'faculty' THEN N'head_of_faculty'
            WHEN N'team' THEN N'programme_leader'
        END
    WHERE membership.archived_at IS NULL
      AND (membership.active_from IS NULL OR membership.active_from <= CONVERT(date, sysutcdatetime()))
      AND (membership.active_to IS NULL OR membership.active_to >= CONVERT(date, sysutcdatetime()))
)
INSERT INTO org.org_unit_leaderships (
    org_unit_id, leader_staff_id, leadership_role, active_from
)
SELECT candidate.org_unit_id, candidate.staff_id, N'manager', CONVERT(date, sysutcdatetime())
FROM leadership_candidates candidate
WHERE candidate.candidate_order = 1
  AND NOT EXISTS (
      SELECT 1
      FROM org.org_unit_leaderships existing
      WHERE existing.org_unit_id = candidate.org_unit_id
        AND existing.leadership_role = N'manager'
        AND existing.archived_at IS NULL
        AND existing.active_to IS NULL
  );
GO

CREATE OR ALTER PROCEDURE org.usp_rebuild_unit_management_projection
    @updated_by_user_account_id uniqueidentifier = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @now datetimeoffset = sysutcdatetime();
    DECLARE @today date = CONVERT(date, @now);

    DECLARE @desired TABLE (
        staff_id uniqueidentifier NOT NULL PRIMARY KEY,
        manager_staff_id uniqueidentifier NOT NULL,
        source_org_unit_id uniqueidentifier NOT NULL
    );

    ;WITH active_leadership AS (
        SELECT leadership.org_unit_id, leadership.leader_staff_id
        FROM org.org_unit_leaderships leadership
        JOIN org.org_units unit ON unit.id = leadership.org_unit_id
            AND unit.is_active = 1
            AND unit.archived_at IS NULL
        JOIN people.staff leader ON leader.id = leadership.leader_staff_id
            AND leader.account_status = N'active'
            AND leader.archived_at IS NULL
        WHERE leadership.leadership_role = N'manager'
          AND leadership.archived_at IS NULL
          AND leadership.active_from <= @today
          AND (leadership.active_to IS NULL OR leadership.active_to >= @today)
    ),
    active_memberships AS (
        SELECT membership.staff_id, membership.org_unit_id, membership.is_primary,
               unit.org_unit_type, unit.parent_org_unit_id
        FROM org.staff_org_memberships membership
        JOIN org.org_units unit ON unit.id = membership.org_unit_id
            AND unit.is_active = 1
            AND unit.archived_at IS NULL
        JOIN people.staff staff ON staff.id = membership.staff_id
            AND staff.account_status = N'active'
            AND staff.archived_at IS NULL
        WHERE membership.archived_at IS NULL
          AND (membership.active_from IS NULL OR membership.active_from <= @today)
          AND (membership.active_to IS NULL OR membership.active_to >= @today)
    ),
    candidates AS (
        -- A team manager reports to the manager of its parent faculty.
        SELECT team_leader.leader_staff_id AS staff_id,
               faculty_leader.leader_staff_id AS manager_staff_id,
               team.parent_org_unit_id AS source_org_unit_id,
               10 AS priority,
               CONVERT(bit, 1) AS is_primary,
               team.code AS unit_code
        FROM active_leadership team_leader
        JOIN org.org_units team ON team.id = team_leader.org_unit_id
            AND team.org_unit_type = N'team'
        JOIN active_leadership faculty_leader ON faculty_leader.org_unit_id = team.parent_org_unit_id
        WHERE team_leader.leader_staff_id <> faculty_leader.leader_staff_id

        UNION ALL

        -- Staff in a managed team report to that team's manager.
        SELECT membership.staff_id,
               team_leader.leader_staff_id,
               membership.org_unit_id,
               20,
               membership.is_primary,
               team.code
        FROM active_memberships membership
        JOIN org.org_units team ON team.id = membership.org_unit_id
            AND team.org_unit_type = N'team'
        JOIN active_leadership team_leader ON team_leader.org_unit_id = membership.org_unit_id
        WHERE membership.staff_id <> team_leader.leader_staff_id

        UNION ALL

        -- If a team has no manager, its faculty manager provides continuity.
        SELECT membership.staff_id,
               faculty_leader.leader_staff_id,
               team.parent_org_unit_id,
               30,
               membership.is_primary,
               team.code
        FROM active_memberships membership
        JOIN org.org_units team ON team.id = membership.org_unit_id
            AND team.org_unit_type = N'team'
        JOIN active_leadership faculty_leader ON faculty_leader.org_unit_id = team.parent_org_unit_id
        LEFT JOIN active_leadership team_leader ON team_leader.org_unit_id = team.id
        WHERE team_leader.org_unit_id IS NULL
          AND membership.staff_id <> faculty_leader.leader_staff_id

        UNION ALL

        -- Staff allocated directly to a faculty report to its manager.
        SELECT membership.staff_id,
               faculty_leader.leader_staff_id,
               membership.org_unit_id,
               40,
               membership.is_primary,
               faculty.code
        FROM active_memberships membership
        JOIN org.org_units faculty ON faculty.id = membership.org_unit_id
            AND faculty.org_unit_type = N'faculty'
        JOIN active_leadership faculty_leader ON faculty_leader.org_unit_id = membership.org_unit_id
        WHERE membership.staff_id <> faculty_leader.leader_staff_id
    ),
    ranked AS (
        SELECT candidate.*,
               ROW_NUMBER() OVER (
                   PARTITION BY candidate.staff_id
                   ORDER BY candidate.priority, candidate.is_primary DESC, candidate.unit_code, candidate.manager_staff_id
               ) AS candidate_order
        FROM candidates candidate
    )
    INSERT INTO @desired (staff_id, manager_staff_id, source_org_unit_id)
    SELECT staff_id, manager_staff_id, source_org_unit_id
    FROM ranked
    WHERE candidate_order = 1;

    IF EXISTS (
        SELECT 1
        FROM @desired desired
        WHERE desired.staff_id = desired.manager_staff_id
    )
        THROW 51000, 'The organisation manager assignments would create a self-managed reporting line.', 1;

    ;WITH reporting_chain AS (
        SELECT desired.staff_id AS root_staff_id,
               desired.manager_staff_id,
               1 AS relationship_depth,
               CONVERT(varchar(max), CONCAT(N'|', CONVERT(varchar(36), desired.staff_id), N'|')) AS visited
        FROM @desired desired

        UNION ALL

        SELECT chain.root_staff_id,
               desired.manager_staff_id,
               chain.relationship_depth + 1,
               CONVERT(varchar(max), CONCAT(chain.visited, CONVERT(varchar(36), chain.manager_staff_id), N'|'))
        FROM reporting_chain chain
        JOIN @desired desired ON desired.staff_id = chain.manager_staff_id
        WHERE chain.relationship_depth < 50
          AND CHARINDEX(CONCAT(N'|', CONVERT(varchar(36), chain.manager_staff_id), N'|'), chain.visited) = 0
    )
    SELECT TOP (1) 1 AS cycle_detected
    INTO #reporting_cycle
    FROM reporting_chain chain
    WHERE chain.manager_staff_id = chain.root_staff_id
    OPTION (MAXRECURSION 100);

    IF EXISTS (SELECT 1 FROM #reporting_cycle)
        THROW 51000, 'The organisation manager assignments would create a circular reporting line.', 1;

    DROP TABLE #reporting_cycle;

    -- Close generated relationships that are no longer part of the organisation projection.
    UPDATE relationship
    SET relationship.is_primary = 0,
        relationship.active_to = COALESCE(relationship.active_to, @today),
        relationship.archived_at = COALESCE(relationship.archived_at, @now),
        relationship.updated_by_user_account_id = @updated_by_user_account_id,
        relationship.updated_at = @now
    FROM org.staff_manager_relationships relationship
    WHERE relationship.assignment_source = N'org_unit_leadership'
      AND relationship.is_primary = 1
      AND relationship.archived_at IS NULL
      AND NOT EXISTS (
          SELECT 1
          FROM @desired desired
          WHERE desired.staff_id = relationship.staff_id
            AND desired.manager_staff_id = relationship.manager_staff_id
            AND desired.source_org_unit_id = relationship.source_org_unit_id
      );

    -- Organisation leadership is authoritative for primary reporting lines.
    UPDATE relationship
    SET relationship.is_primary = 0,
        relationship.active_to = COALESCE(relationship.active_to, @today),
        relationship.archived_at = COALESCE(relationship.archived_at, @now),
        relationship.updated_by_user_account_id = @updated_by_user_account_id,
        relationship.updated_at = @now
    FROM org.staff_manager_relationships relationship
    JOIN @desired desired ON desired.staff_id = relationship.staff_id
    WHERE relationship.is_primary = 1
      AND relationship.archived_at IS NULL
      AND (
          relationship.manager_staff_id <> desired.manager_staff_id
          OR ISNULL(relationship.source_org_unit_id, '00000000-0000-0000-0000-000000000000') <> desired.source_org_unit_id
          OR relationship.assignment_source <> N'org_unit_leadership'
      );

    INSERT INTO org.staff_manager_relationships (
        staff_id, manager_staff_id, relationship_type, is_primary,
        active_from, created_by_user_account_id, assignment_source, source_org_unit_id
    )
    SELECT desired.staff_id, desired.manager_staff_id, N'line_manager', 1,
           @today, @updated_by_user_account_id, N'org_unit_leadership', desired.source_org_unit_id
    FROM @desired desired
    WHERE NOT EXISTS (
        SELECT 1
        FROM org.staff_manager_relationships relationship
        WHERE relationship.staff_id = desired.staff_id
          AND relationship.manager_staff_id = desired.manager_staff_id
          AND relationship.is_primary = 1
          AND relationship.archived_at IS NULL
          AND (relationship.active_to IS NULL OR relationship.active_to >= @today)
    );

    -- Grant the manager permission tier implied by the unit type.
    INSERT INTO auth.user_roles (user_account_id, role_id, active_from, assignment_source)
    SELECT DISTINCT account.id, role.id, @now, N'org_unit_leadership'
    FROM org.org_unit_leaderships leadership
    JOIN org.org_units unit ON unit.id = leadership.org_unit_id
    JOIN auth.user_accounts account ON account.staff_id = leadership.leader_staff_id
        AND account.archived_at IS NULL
    JOIN auth.roles role ON role.role_key = CASE unit.org_unit_type
        WHEN N'faculty' THEN N'head_of_faculty'
        WHEN N'team' THEN N'programme_leader'
    END
    WHERE leadership.leadership_role = N'manager'
      AND leadership.archived_at IS NULL
      AND leadership.active_from <= @today
      AND (leadership.active_to IS NULL OR leadership.active_to >= @today)
      AND unit.org_unit_type IN (N'faculty', N'team')
      AND NOT EXISTS (
          SELECT 1
          FROM auth.user_roles existing
          WHERE existing.user_account_id = account.id
            AND existing.role_id = role.id
            AND existing.active_from <= @now
            AND (existing.active_to IS NULL OR existing.active_to > @now)
      );

    UPDATE user_role
    SET user_role.active_to = @now
    FROM auth.user_roles user_role
    JOIN auth.roles role ON role.id = user_role.role_id
    JOIN auth.user_accounts account ON account.id = user_role.user_account_id
    WHERE user_role.assignment_source = N'org_unit_leadership'
      AND user_role.active_from <= @now
      AND (user_role.active_to IS NULL OR user_role.active_to > @now)
      AND role.role_key IN (N'head_of_faculty', N'programme_leader')
      AND NOT EXISTS (
          SELECT 1
          FROM org.org_unit_leaderships leadership
          JOIN org.org_units unit ON unit.id = leadership.org_unit_id
          WHERE leadership.leader_staff_id = account.staff_id
            AND leadership.leadership_role = N'manager'
            AND leadership.archived_at IS NULL
            AND leadership.active_from <= @today
            AND (leadership.active_to IS NULL OR leadership.active_to >= @today)
            AND role.role_key = CASE unit.org_unit_type
                WHEN N'faculty' THEN N'head_of_faculty'
                WHEN N'team' THEN N'programme_leader'
            END
      );

    -- Unit scopes let the existing permission engine include every child team.
    INSERT INTO auth.access_scopes (
        user_account_id, scope_type, org_unit_id, is_active, assignment_source
    )
    SELECT account.id, N'assigned_org_units', leadership.org_unit_id, 1, N'org_unit_leadership'
    FROM org.org_unit_leaderships leadership
    JOIN auth.user_accounts account ON account.staff_id = leadership.leader_staff_id
        AND account.archived_at IS NULL
    WHERE leadership.leadership_role = N'manager'
      AND leadership.archived_at IS NULL
      AND leadership.active_from <= @today
      AND (leadership.active_to IS NULL OR leadership.active_to >= @today)
      AND NOT EXISTS (
          SELECT 1
          FROM auth.access_scopes existing
          WHERE existing.user_account_id = account.id
            AND existing.scope_type = N'assigned_org_units'
            AND existing.org_unit_id = leadership.org_unit_id
            AND existing.is_active = 1
            AND existing.archived_at IS NULL
      );

    UPDATE scope
    SET scope.is_active = 0,
        scope.archived_at = COALESCE(scope.archived_at, @now),
        scope.updated_at = @now
    FROM auth.access_scopes scope
    JOIN auth.user_accounts account ON account.id = scope.user_account_id
    WHERE scope.assignment_source = N'org_unit_leadership'
      AND scope.scope_type = N'assigned_org_units'
      AND scope.is_active = 1
      AND scope.archived_at IS NULL
      AND NOT EXISTS (
          SELECT 1
          FROM org.org_unit_leaderships leadership
          WHERE leadership.leader_staff_id = account.staff_id
            AND leadership.org_unit_id = scope.org_unit_id
            AND leadership.leadership_role = N'manager'
            AND leadership.archived_at IS NULL
            AND leadership.active_from <= @today
            AND (leadership.active_to IS NULL OR leadership.active_to >= @today)
      );

    -- Retain the legacy column only as a synchronized compatibility projection.
    UPDATE staff
    SET staff.line_manager_staff_id = current_relationship.manager_staff_id,
        staff.updated_at = CASE
            WHEN ISNULL(staff.line_manager_staff_id, '00000000-0000-0000-0000-000000000000')
                <> ISNULL(current_relationship.manager_staff_id, '00000000-0000-0000-0000-000000000000')
            THEN @now ELSE staff.updated_at END
    FROM people.staff staff
    OUTER APPLY (
        SELECT TOP (1) relationship.manager_staff_id
        FROM org.staff_manager_relationships relationship
        WHERE relationship.staff_id = staff.id
          AND relationship.is_primary = 1
          AND relationship.archived_at IS NULL
          AND (relationship.active_from IS NULL OR relationship.active_from <= @today)
          AND (relationship.active_to IS NULL OR relationship.active_to >= @today)
        ORDER BY relationship.created_at DESC
    ) current_relationship
    WHERE staff.archived_at IS NULL;
END;
GO

EXEC org.usp_rebuild_unit_management_projection @updated_by_user_account_id = NULL;
GO
