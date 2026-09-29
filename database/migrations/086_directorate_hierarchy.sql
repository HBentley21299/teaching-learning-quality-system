-- Add directorates without replacing faculty/team identities or historical records.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
GO

CREATE OR ALTER PROCEDURE org.usp_rebuild_unit_management_projection
    @updated_by_user_account_id uniqueidentifier = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
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
        -- Faculty managers report to the director of their allocated directorate.
        SELECT faculty_leader.leader_staff_id AS staff_id,
               director.leader_staff_id AS manager_staff_id,
               faculty.parent_org_unit_id AS source_org_unit_id,
               5 AS priority, CONVERT(bit, 1) AS is_primary, faculty.code AS unit_code
        FROM active_leadership faculty_leader
        JOIN org.org_units faculty ON faculty.id = faculty_leader.org_unit_id AND faculty.org_unit_type = N'faculty'
        JOIN active_leadership director ON director.org_unit_id = faculty.parent_org_unit_id
        WHERE faculty_leader.leader_staff_id <> director.leader_staff_id

        UNION ALL

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
        WHEN N'directorate' THEN N'director'
        WHEN N'faculty' THEN N'head_of_faculty'
        WHEN N'team' THEN N'programme_leader'
    END
    WHERE leadership.leadership_role = N'manager'
      AND leadership.archived_at IS NULL
      AND leadership.active_from <= @today
      AND (leadership.active_to IS NULL OR leadership.active_to >= @today)
      AND unit.org_unit_type IN (N'directorate', N'faculty', N'team')
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
      AND role.role_key IN (N'director', N'head_of_faculty', N'programme_leader')
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
                WHEN N'directorate' THEN N'director'
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

-- Initial requested allocations. Leave all other units untouched. Re-running this
-- migration does not override a faculty that has subsequently been reallocated.
DECLARE @newDirectorates TABLE (id uniqueidentifier, code nvarchar(50));
INSERT org.org_units (org_unit_type, code, name, description, is_active, effective_from)
OUTPUT inserted.id, inserted.code INTO @newDirectorates
SELECT N'directorate', source.code, source.name, N'Directorate containing allocated faculties.', 1, CONVERT(date, sysutcdatetime())
FROM (VALUES
 (N'DIR-HSPSC', N'Health, Science, Professional, Sporting and Creative Studies'),
 (N'DIR-TECH', N'Technical Studies'),
 (N'DIR-EMS', N'English and Maths and Supported Studies')
) source(code, name)
WHERE NOT EXISTS (SELECT 1 FROM org.org_units unit WHERE unit.org_unit_type=N'directorate' AND unit.code=source.code);

UPDATE faculty SET parent_org_unit_id = directorate.id, updated_at = sysutcdatetime()
FROM org.org_units faculty
JOIN (VALUES
 (N'CUCP', N'DIR-HSPSC'), (N'CUFP', N'DIR-HSPSC'), (N'CUST', N'DIR-HSPSC'), (N'CUDC', N'DIR-HSPSC'), (N'CUPA', N'DIR-HSPSC'),
 (N'CUCB', N'DIR-TECH'), (N'CURC', N'DIR-TECH'), (N'WBL', N'DIR-TECH'),
 (N'CUENMT', N'DIR-EMS'), (N'CUES', N'DIR-EMS'), (N'CUSE', N'DIR-EMS')
) mapping(faculty_code, directorate_code) ON mapping.faculty_code=faculty.code
JOIN @newDirectorates directorate ON directorate.code=mapping.directorate_code
WHERE faculty.org_unit_type=N'faculty' AND faculty.parent_org_unit_id IS NULL AND faculty.archived_at IS NULL;

EXEC org.usp_rebuild_unit_management_projection @updated_by_user_account_id = NULL;
COMMIT TRANSACTION;
GO
