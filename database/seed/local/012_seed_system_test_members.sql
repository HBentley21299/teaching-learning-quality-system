-- Explicitly requested local test data. Additive; never invoked during startup.
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET QUOTED_IDENTIFIER ON;
IF ISNULL(CONVERT(int, SERVERPROPERTY('IsLocalDB')), 0) <> 1
    THROW 51000, 'System test fixtures are restricted to LocalDB.', 1;

BEGIN TRY
    BEGIN TRANSACTION;
    DECLARE @actor uniqueidentifier, @manager uniqueidentifier;
    SELECT @actor = a.id, @manager = s.id
    FROM people.staff s JOIN auth.user_accounts a ON a.staff_id=s.id
    WHERE s.external_id=N'STAFF_0001' AND s.archived_at IS NULL AND a.archived_at IS NULL;
    IF @actor IS NULL THROW 51000, 'The local administrator account is required.', 1;

    DECLARE @members TABLE (n int PRIMARY KEY, code nvarchar(50), unit_type nvarchar(50));
    INSERT @members VALUES (1,N'CUDCDIG',N'team'),(2,N'CUCPHSC',N'team'),
      (3,N'CUFPBUS',N'team'),(4,N'CUSTSPT',N'team'),(5,N'CUCBBRK',N'team'),
      (6,N'CURCHB',N'team'),(7,N'WBL-BU',N'team'),(8,N'CUENMT-ADULT',N'team'),
      (9,N'CUESFT',N'team'),(10,N'CUSE',N'team'),(11,N'UCO',N'faculty'),(12,N'ALS-CUCB',N'team');
    IF EXISTS (SELECT 1 FROM @members m WHERE NOT EXISTS (
      SELECT 1 FROM org.org_units u WHERE u.code=m.code AND u.org_unit_type=m.unit_type AND u.is_active=1 AND u.archived_at IS NULL))
      THROW 51000, 'A required test membership organisation unit is unavailable.', 1;

    INSERT people.staff (external_id,first_name,last_name,display_name,email,job_title,
      primary_org_unit_id,line_manager_staff_id,account_status,start_date,notes,
      staff_category,onboarding_source,onboarded_at)
    SELECT CONCAT(N'SYSTEM-TEST-',RIGHT(CONCAT(N'00',m.n),2)), N'Test',
      CONCAT(N'Colleague ',RIGHT(CONCAT(N'00',m.n),2)),
      CONCAT(N'Test Colleague ',RIGHT(CONCAT(N'00',m.n),2)),
      CONCAT(N'system.test.',RIGHT(CONCAT(N'00',m.n),2),N'@ielevate.local'),
      CASE WHEN m.n=12 THEN N'Learning Support Assistant (test)' ELSE N'Tutor (test)' END,
      u.id,@manager,N'active','2026-08-01',
      N'[SYSTEM TEST 26/27] Fictional colleague for local workflow and dashboard testing.',
      CASE WHEN m.n=12 THEN N'other' ELSE N'tutor_tutor_assessor' END,N'manual',sysutcdatetime()
    FROM @members m JOIN org.org_units u ON u.code=m.code AND u.org_unit_type=m.unit_type AND u.archived_at IS NULL
    WHERE NOT EXISTS (SELECT 1 FROM people.staff s WHERE s.external_id=CONCAT(N'SYSTEM-TEST-',RIGHT(CONCAT(N'00',m.n),2)));

    INSERT org.staff_org_memberships(staff_id,org_unit_id,membership_type,is_primary,active_from,change_reason)
    SELECT s.id,s.primary_org_unit_id,N'member',1,'2026-08-01',N'[SYSTEM TEST 26/27] Local test member'
    FROM people.staff s JOIN @members m ON s.external_id=CONCAT(N'SYSTEM-TEST-',RIGHT(CONCAT(N'00',m.n),2))
    WHERE NOT EXISTS (SELECT 1 FROM org.staff_org_memberships x WHERE x.staff_id=s.id AND x.org_unit_id=s.primary_org_unit_id AND x.archived_at IS NULL);

    INSERT auth.user_accounts(staff_id,account_status,is_disabled)
    SELECT s.id,N'active',0 FROM people.staff s JOIN @members m ON s.external_id=CONCAT(N'SYSTEM-TEST-',RIGHT(CONCAT(N'00',m.n),2))
    WHERE NOT EXISTS (SELECT 1 FROM auth.user_accounts a WHERE a.staff_id=s.id);
    INSERT auth.user_roles(user_account_id,role_id,active_from,assignment_source)
    SELECT a.id,r.id,sysutcdatetime(),N'manual'
    FROM people.staff s JOIN @members m ON s.external_id=CONCAT(N'SYSTEM-TEST-',RIGHT(CONCAT(N'00',m.n),2))
    JOIN auth.user_accounts a ON a.staff_id=s.id JOIN auth.roles r ON r.role_key=N'staff'
    WHERE NOT EXISTS (SELECT 1 FROM auth.user_roles x WHERE x.user_account_id=a.id AND x.role_id=r.id AND x.active_to IS NULL);
    INSERT auth.access_scopes(user_account_id,scope_type,staff_id,is_active,assignment_source)
    SELECT a.id,N'self',s.id,1,N'manual'
    FROM people.staff s JOIN @members m ON s.external_id=CONCAT(N'SYSTEM-TEST-',RIGHT(CONCAT(N'00',m.n),2))
    JOIN auth.user_accounts a ON a.staff_id=s.id
    WHERE NOT EXISTS (SELECT 1 FROM auth.access_scopes x WHERE x.user_account_id=a.id AND x.scope_type=N'self' AND x.is_active=1 AND x.archived_at IS NULL);

    INSERT org.staff_manager_relationships(staff_id,manager_staff_id,relationship_type,is_primary,active_from,assignment_source,created_by_user_account_id)
    SELECT s.id,@manager,N'line_manager',1,'2026-08-01',N'manual',@actor
    FROM people.staff s JOIN @members m ON s.external_id=CONCAT(N'SYSTEM-TEST-',RIGHT(CONCAT(N'00',m.n),2))
    WHERE NOT EXISTS (SELECT 1 FROM org.staff_manager_relationships x WHERE x.staff_id=s.id AND x.is_primary=1 AND x.archived_at IS NULL);
    COMMIT;
    SELECT s.display_name,u.code organisation_code FROM people.staff s
    JOIN @members m ON s.external_id=CONCAT(N'SYSTEM-TEST-',RIGHT(CONCAT(N'00',m.n),2))
    JOIN org.org_units u ON u.id=s.primary_org_unit_id ORDER BY m.n;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
END CATCH;
