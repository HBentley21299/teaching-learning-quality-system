-- Local-only UCO TLA workflow fixture.
--
-- Apply with:
--   sqlcmd -S "(localdb)\MSSQLLocalDB" -d TLQS -E -b -i database\seed\local\011_seed_uco_test_accounts.sql
--
-- Every account uses the password: UcoTest2026!
-- Idempotent: safe to re-run. Never apply this file to production.
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @now datetimeoffset = sysutcdatetime();
    DECLARE @ucoRootId uniqueidentifier = (
        SELECT TOP (1) id
        FROM org.org_units
        WHERE code = N'UCO'
          AND archived_at IS NULL
    );

    IF @ucoRootId IS NULL
        THROW 51000, 'Migration 071 must be applied before seeding UCO test accounts.', 1;

    DECLARE @testOrgUnitId uniqueidentifier = '21000000-0000-0000-0000-000000000101';

    IF EXISTS (
        SELECT 1
        FROM org.org_units
        WHERE org_unit_type = N'team'
          AND code = N'UCO-TEST'
          AND id <> @testOrgUnitId
    )
    BEGIN
        SELECT @testOrgUnitId = id
        FROM org.org_units
        WHERE org_unit_type = N'team'
          AND code = N'UCO-TEST';
    END;

    MERGE org.org_units AS target
    USING (SELECT @testOrgUnitId AS id) AS source
       ON target.id = source.id
    WHEN MATCHED THEN UPDATE SET
        parent_org_unit_id = @ucoRootId,
        org_unit_type = N'team',
        code = N'UCO-TEST',
        name = N'UCO Test Provision',
        description = N'Local-only organisation unit for exercising the UCO TLA review workflow.',
        is_active = 1,
        archived_at = NULL,
        updated_at = @now
    WHEN NOT MATCHED THEN INSERT (
        id, parent_org_unit_id, org_unit_type, code, name, description, is_active
    ) VALUES (
        @testOrgUnitId, @ucoRootId, N'team', N'UCO-TEST', N'UCO Test Provision',
        N'Local-only organisation unit for exercising the UCO TLA review workflow.', 1
    );

    DECLARE @people TABLE (
        staff_id uniqueidentifier NOT NULL,
        account_id uniqueidentifier NOT NULL,
        external_id nvarchar(50) NOT NULL,
        first_name nvarchar(100) NOT NULL,
        last_name nvarchar(100) NOT NULL,
        display_name nvarchar(220) NOT NULL,
        email nvarchar(320) NOT NULL,
        job_title nvarchar(200) NOT NULL,
        staff_category nvarchar(50) NOT NULL,
        workflow_role nvarchar(30) NOT NULL
    );

    INSERT INTO @people (
        staff_id, account_id, external_id, first_name, last_name, display_name,
        email, job_title, staff_category, workflow_role
    ) VALUES
        ('48000000-0000-0000-0000-000000000001', '49000000-0000-0000-0000-000000000001',
         N'TEST-UCO-LECTURER', N'UCO', N'Lecturer', N'UCO Test Lecturer',
         N'uco.lecturer.test@ielevate.local', N'Lecturer (UCO Test Account)',
         N'tutor_tutor_assessor', N'lecturer'),
        ('48000000-0000-0000-0000-000000000002', '49000000-0000-0000-0000-000000000002',
         N'TEST-UCO-OBSERVER', N'UCO', N'Observer', N'UCO Test Observer',
         N'uco.observer.test@ielevate.local', N'Observer (UCO Test Account)',
         N'tutor_tutor_assessor', N'observer'),
        ('48000000-0000-0000-0000-000000000003', '49000000-0000-0000-0000-000000000003',
         N'TEST-UCO-COORD-1', N'UCO', N'Coordinator One', N'UCO Test Coordinator One',
         N'uco.coordinator1.test@ielevate.local', N'UCO Teaching and Learning Coordinator (Test Account)',
         N'other', N'coordinator'),
        ('48000000-0000-0000-0000-000000000004', '49000000-0000-0000-0000-000000000004',
         N'TEST-UCO-COORD-2', N'UCO', N'Coordinator Two', N'UCO Test Coordinator Two',
         N'uco.coordinator2.test@ielevate.local', N'UCO Teaching and Learning Coordinator (Test Account)',
         N'other', N'coordinator'),
        ('48000000-0000-0000-0000-000000000005', '49000000-0000-0000-0000-000000000005',
         N'TEST-UCO-MANAGER', N'UCO', N'Line Manager', N'UCO Test Line Manager',
         N'uco.manager.test@ielevate.local', N'Line Manager (UCO Test Account)',
         N'other', N'line_manager');

    IF EXISTS (
        SELECT 1
        FROM @people fixture
        JOIN people.staff existing ON existing.email = fixture.email
        WHERE existing.id <> fixture.staff_id
    )
        THROW 51000, 'A UCO test email is already assigned to a different staff record.', 1;

    MERGE people.staff AS target
    USING @people AS source
       ON target.id = source.staff_id
    WHEN MATCHED THEN UPDATE SET
        external_id = source.external_id,
        first_name = source.first_name,
        last_name = source.last_name,
        display_name = source.display_name,
        email = source.email,
        job_title = source.job_title,
        line_manager_staff_id = NULL,
        primary_org_unit_id = @testOrgUnitId,
        account_status = N'active',
        staff_category = source.staff_category,
        onboarding_source = N'manual',
        onboarded_at = COALESCE(target.onboarded_at, @now),
        archived_at = NULL,
        updated_at = @now
    WHEN NOT MATCHED THEN INSERT (
        id, external_id, first_name, last_name, display_name, email, job_title,
        primary_org_unit_id, account_status, staff_category, onboarding_source, onboarded_at
    ) VALUES (
        source.staff_id, source.external_id, source.first_name, source.last_name,
        source.display_name, source.email, source.job_title, @testOrgUnitId, N'active',
        source.staff_category, N'manual', @now
    );

    UPDATE people.staff
    SET line_manager_staff_id = '48000000-0000-0000-0000-000000000005',
        updated_at = @now
    WHERE id = '48000000-0000-0000-0000-000000000001';

    MERGE auth.user_accounts AS target
    USING @people AS source
       ON target.id = source.account_id
    WHEN MATCHED THEN UPDATE SET
        staff_id = source.staff_id,
        account_status = N'active',
        is_disabled = 0,
        archived_at = NULL,
        updated_at = @now
    WHEN NOT MATCHED THEN INSERT (id, staff_id, account_status, is_disabled)
        VALUES (source.account_id, source.staff_id, N'active', 0);

    DECLARE @staffRoleId uniqueidentifier = (
        SELECT id FROM auth.roles WHERE role_key = N'staff' AND is_active = 1 AND archived_at IS NULL
    );
    DECLARE @ucoRoleId uniqueidentifier = (
        SELECT id FROM auth.roles WHERE role_key = N'uco_teaching_learning' AND is_active = 1 AND archived_at IS NULL
    );

    IF @staffRoleId IS NULL OR @ucoRoleId IS NULL
        THROW 51000, 'The staff and UCO Teaching & Learning roles must exist before seeding test accounts.', 1;

    INSERT INTO auth.user_roles (id, user_account_id, role_id, active_from, assignment_source)
    SELECT NEWID(), fixture.account_id, @staffRoleId, @now, N'local_test_fixture'
    FROM @people fixture
    WHERE NOT EXISTS (
        SELECT 1
        FROM auth.user_roles assignment
        WHERE assignment.user_account_id = fixture.account_id
          AND assignment.role_id = @staffRoleId
          AND assignment.active_to IS NULL
    );

    INSERT INTO auth.user_roles (id, user_account_id, role_id, active_from, assignment_source)
    SELECT NEWID(), fixture.account_id, @ucoRoleId, @now, N'local_test_fixture'
    FROM @people fixture
    WHERE fixture.workflow_role = N'coordinator'
      AND NOT EXISTS (
          SELECT 1
          FROM auth.user_roles assignment
          WHERE assignment.user_account_id = fixture.account_id
            AND assignment.role_id = @ucoRoleId
            AND assignment.active_to IS NULL
      );

    INSERT INTO auth.access_scopes (
        id, user_account_id, scope_type, staff_id, is_active, assignment_source
    )
    SELECT NEWID(), fixture.account_id, N'self', fixture.staff_id, 1, N'local_test_fixture'
    FROM @people fixture
    WHERE NOT EXISTS (
        SELECT 1
        FROM auth.access_scopes scope
        WHERE scope.user_account_id = fixture.account_id
          AND scope.scope_type = N'self'
          AND scope.staff_id = fixture.staff_id
          AND scope.is_active = 1
          AND scope.archived_at IS NULL
    );

    MERGE org.staff_org_memberships AS target
    USING (
        SELECT
            CONVERT(uniqueidentifier, CONCAT(
                N'4A000000-0000-0000-0000-',
                RIGHT(CONCAT(N'000000000000', CONVERT(nvarchar(12),
                    ROW_NUMBER() OVER (ORDER BY fixture.staff_id))), 12)
            )) AS membership_id,
            fixture.staff_id
        FROM @people fixture
    ) AS source
       ON target.id = source.membership_id
    WHEN MATCHED THEN UPDATE SET
        staff_id = source.staff_id,
        org_unit_id = @testOrgUnitId,
        membership_type = N'member',
        is_primary = 1,
        active_from = CONVERT(date, '2025-08-01'),
        active_to = NULL,
        archived_at = NULL,
        updated_at = @now,
        updated_by_user_account_id = '49000000-0000-0000-0000-000000000003'
    WHEN NOT MATCHED THEN INSERT (
        id, staff_id, org_unit_id, membership_type, is_primary, active_from,
        created_by_user_account_id
    ) VALUES (
        source.membership_id, source.staff_id, @testOrgUnitId, N'member', 1,
        CONVERT(date, '2025-08-01'), '49000000-0000-0000-0000-000000000003'
    );

    MERGE org.staff_manager_relationships AS target
    USING (SELECT CONVERT(uniqueidentifier, '4B000000-0000-0000-0000-000000000001') AS id) AS source
       ON target.id = source.id
    WHEN MATCHED THEN UPDATE SET
        staff_id = '48000000-0000-0000-0000-000000000001',
        manager_staff_id = '48000000-0000-0000-0000-000000000005',
        relationship_type = N'line_manager',
        is_primary = 1,
        active_from = CONVERT(date, '2025-08-01'),
        active_to = NULL,
        archived_at = NULL,
        updated_at = @now,
        updated_by_user_account_id = '49000000-0000-0000-0000-000000000003'
    WHEN NOT MATCHED THEN INSERT (
        id, staff_id, manager_staff_id, relationship_type, is_primary, active_from,
        created_by_user_account_id
    ) VALUES (
        source.id, '48000000-0000-0000-0000-000000000001',
        '48000000-0000-0000-0000-000000000005', N'line_manager', 1,
        CONVERT(date, '2025-08-01'), '49000000-0000-0000-0000-000000000003'
    );

    DECLARE @passwordHash nvarchar(500) =
        N'pbkdf2-sha256$100000$VUNPLVRMQS1URVNULTIwMjY=$M2aJdtL4CjiLzXItCQxsFpPgS8oVFsBA8yBNhRRbsUY=';

    MERGE auth.local_credentials AS target
    USING (
        SELECT email, account_id
        FROM @people
    ) AS source
       ON target.email = source.email
    WHEN MATCHED THEN UPDATE SET
        password_hash = @passwordHash,
        user_account_id = source.account_id,
        updated_at = @now,
        updated_by_user_account_id = '49000000-0000-0000-0000-000000000003'
    WHEN NOT MATCHED THEN INSERT (
        email, password_hash, user_account_id, updated_at, updated_by_user_account_id
    ) VALUES (
        source.email, @passwordHash, source.account_id, @now,
        '49000000-0000-0000-0000-000000000003'
    );

    IF NOT EXISTS (
        SELECT 1
        FROM ops.audit_logs
        WHERE entity_name = N'org_units'
          AND entity_id = @testOrgUnitId
          AND action = N'local_uco_test_fixture_seeded'
    )
        INSERT INTO ops.audit_logs (
            user_account_id, entity_name, entity_id, action, summary, after_json
        ) VALUES (
            '49000000-0000-0000-0000-000000000003', N'org_units', @testOrgUnitId,
            N'local_uco_test_fixture_seeded',
            N'Created the local UCO TLA organisation and test accounts.',
            (SELECT N'UCO-TEST' AS orgUnitCode, COUNT(*) AS accountCount FROM @people FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
        );

    COMMIT TRANSACTION;

    SELECT unit.code, unit.name, parent.code AS parent_code
    FROM org.org_units unit
    LEFT JOIN org.org_units parent ON parent.id = unit.parent_org_unit_id
    WHERE unit.id = @testOrgUnitId;

    SELECT fixture.workflow_role, staff.display_name, staff.email,
           STRING_AGG(role.role_key, N', ') WITHIN GROUP (ORDER BY role.role_key) AS role_keys
    FROM @people fixture
    JOIN people.staff staff ON staff.id = fixture.staff_id
    JOIN auth.user_accounts account ON account.id = fixture.account_id
    LEFT JOIN auth.user_roles assignment
      ON assignment.user_account_id = account.id AND assignment.active_to IS NULL
    LEFT JOIN auth.roles role ON role.id = assignment.role_id
    GROUP BY fixture.workflow_role, staff.display_name, staff.email
    ORDER BY fixture.workflow_role;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
