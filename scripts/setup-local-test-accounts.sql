-- Local test environment setup (run against the LOCAL database only):
--   1. Archives every staff member and account except Harry Bentley's.
--   2. Creates four test accounts (Tutor, Programme Leader, Head of Faculty,
--      Teaching & Learning) with roles and scopes matching real patterns.
--   3. Sets local username/password credentials for the five kept accounts.
-- Idempotent: safe to re-run.
SET XACT_ABORT ON;
SET NOCOUNT ON;
BEGIN TRANSACTION;

DECLARE @now datetimeoffset = sysutcdatetime();
DECLARE @keepEmails TABLE (email nvarchar(320) PRIMARY KEY);
INSERT INTO @keepEmails VALUES
    (N'harryjbentley@outlook.com'),
    (N'staff.test@ielevate.local'),
    (N'pl.test@ielevate.local'),
    (N'hof.test@ielevate.local'),
    (N'tl.test@ielevate.local'),
    (N'newstarter.test@ielevate.local');

------------------------------------------------------------------ dummies
DECLARE @facultyCUCP uniqueidentifier = '20000000-0000-0000-0000-000000000002';
DECLARE @teamCUCPHSC uniqueidentifier = '20000000-0000-0000-0000-000000000021';
DECLARE @teamCollegeTL uniqueidentifier = '24000000-0000-0000-0000-000000000002';

DECLARE @dummies TABLE (
    staff_id uniqueidentifier,
    account_id uniqueidentifier,
    display_name nvarchar(200),
    first_name nvarchar(100),
    last_name nvarchar(100),
    email nvarchar(320),
    job_title nvarchar(200),
    staff_category nvarchar(50),
    primary_org_unit_id uniqueidentifier,
    role_key nvarchar(50)
);
INSERT INTO @dummies VALUES
    ('43000000-0000-0000-0000-000000000001', '44000000-0000-0000-0000-000000000001',
     N'Test Tutor', N'Test', N'Tutor', N'staff.test@ielevate.local',
     N'Tutor (Test Account)', N'tutor_tutor_assessor', @teamCUCPHSC, N'staff'),
    ('43000000-0000-0000-0000-000000000002', '44000000-0000-0000-0000-000000000002',
     N'Test Programme Leader', N'Test', N'Programme Leader', N'pl.test@ielevate.local',
     N'Programme Leader (Test Account)', N'programme_leader', @teamCUCPHSC, N'programme_leader'),
    ('43000000-0000-0000-0000-000000000003', '44000000-0000-0000-0000-000000000003',
     N'Test Head of Faculty', N'Test', N'Head of Faculty', N'hof.test@ielevate.local',
     N'Head of Faculty (Test Account)', N'head_of_faculty_sector_manager', @facultyCUCP, N'head_of_faculty'),
    ('43000000-0000-0000-0000-000000000004', '44000000-0000-0000-0000-000000000004',
     N'Test Teaching and Learning', N'Test', N'Teaching and Learning', N'tl.test@ielevate.local',
     N'Teaching and Learning Coach (Test Account)', N'other', @teamCollegeTL, N'teaching_learning_team');

INSERT INTO people.staff (id, external_id, first_name, last_name, display_name, email, job_title,
    primary_org_unit_id, account_status, staff_category, onboarding_source, onboarded_at)
SELECT d.staff_id, N'TEST-' + UPPER(d.role_key), d.first_name, d.last_name, d.display_name, d.email, d.job_title,
    d.primary_org_unit_id, N'active', d.staff_category, N'manual', @now
FROM @dummies d
WHERE NOT EXISTS (SELECT 1 FROM people.staff s WHERE s.id = d.staff_id);

INSERT INTO auth.user_accounts (id, staff_id, account_status, is_disabled)
SELECT d.account_id, d.staff_id, N'active', 0
FROM @dummies d
WHERE NOT EXISTS (SELECT 1 FROM auth.user_accounts ua WHERE ua.id = d.account_id);

INSERT INTO auth.user_roles (id, user_account_id, role_id, active_from, assignment_source)
SELECT NEWID(), d.account_id, r.id, @now, N'manual'
FROM @dummies d
JOIN auth.roles r ON r.role_key = d.role_key
WHERE NOT EXISTS (
    SELECT 1 FROM auth.user_roles ur WHERE ur.user_account_id = d.account_id AND ur.role_id = r.id);

-- Scopes: everyone gets self; PL scopes to their team, HOF to their faculty,
-- Teaching & Learning gets global (matching existing role patterns).
INSERT INTO auth.access_scopes (id, user_account_id, scope_type, org_unit_id, staff_id, is_active, assignment_source)
SELECT NEWID(), d.account_id, N'self', NULL, d.staff_id, 1, N'manual'
FROM @dummies d
WHERE NOT EXISTS (SELECT 1 FROM auth.access_scopes s
    WHERE s.user_account_id = d.account_id AND s.scope_type = N'self' AND s.archived_at IS NULL);

INSERT INTO auth.access_scopes (id, user_account_id, scope_type, org_unit_id, staff_id, is_active, assignment_source)
SELECT NEWID(), d.account_id, N'assigned_org_units', d.primary_org_unit_id, NULL, 1, N'manual'
FROM @dummies d
WHERE d.role_key IN (N'programme_leader', N'head_of_faculty')
  AND NOT EXISTS (SELECT 1 FROM auth.access_scopes s
    WHERE s.user_account_id = d.account_id AND s.scope_type = N'assigned_org_units' AND s.archived_at IS NULL);

INSERT INTO auth.access_scopes (id, user_account_id, scope_type, org_unit_id, staff_id, is_active, assignment_source)
SELECT NEWID(), d.account_id, N'global', NULL, NULL, 1, N'manual'
FROM @dummies d
WHERE d.role_key = N'teaching_learning_team'
  AND NOT EXISTS (SELECT 1 FROM auth.access_scopes s
    WHERE s.user_account_id = d.account_id AND s.scope_type = N'global' AND s.archived_at IS NULL);

------------------------------------------------------- archive other staff
DECLARE @archivedStaff int, @archivedAccounts int;

UPDATE ua
SET is_disabled = 1, archived_at = COALESCE(ua.archived_at, @now), updated_at = @now
FROM auth.user_accounts ua
JOIN people.staff s ON s.id = ua.staff_id
WHERE s.email NOT IN (SELECT email FROM @keepEmails)
  AND ua.archived_at IS NULL;
SET @archivedAccounts = @@ROWCOUNT;

UPDATE s
SET archived_at = COALESCE(s.archived_at, @now), updated_at = @now
FROM people.staff s
WHERE s.email NOT IN (SELECT email FROM @keepEmails)
  AND s.archived_at IS NULL;
SET @archivedStaff = @@ROWCOUNT;

---------------------------------------------------------------- passwords
-- Credentials are keyed by email so a sign-in can exist before its account,
-- which is what lets the new-starter account reach self-onboarding.
DECLARE @credentials TABLE (email nvarchar(320), hash nvarchar(500));
INSERT INTO @credentials VALUES
    (N'harryjbentley@outlook.com', N'pbkdf2-sha256$100000$4RfqovVitVhObv0wy7zxfw==$vKdx1hfqjrpoG4khy3ppUTqcHTzbbbp9DODAW8S7r60='),
    (N'staff.test@ielevate.local', N'pbkdf2-sha256$100000$HJt9JKWtxOUeVrMeh+Vkgw==$gmj5nibcrSbZl1/4NqK8dd4EBOPD72nhsQFfuDxE/9s='),
    (N'pl.test@ielevate.local',    N'pbkdf2-sha256$100000$KNaYKBNK54nkzKMrGquFgg==$SsE1W1yuXmBhUsGClLa9u+u2xsqaJfnjtkaPrXY1M/k='),
    (N'hof.test@ielevate.local',   N'pbkdf2-sha256$100000$FMgVWtaE/+kBLVCSrHDLEQ==$/J31aTcHTJpa8NbNWtbLT5EIV33wxEcad1d+s5cYXnY='),
    (N'tl.test@ielevate.local',    N'pbkdf2-sha256$100000$A0BMSK4bMcx9jXtWswS2ZA==$r2NYnPdGeiu3ECzrMLVk37JcN3bELJPZZGjOrIJpnLE='),
    -- Deliberately has no staff record or account: first sign-in runs trusted
    -- self-onboarding (faculty, team, staff category).
    (N'newstarter.test@ielevate.local', N'pbkdf2-sha256$100000$NbpJCmke0K1PoprPQSTxDw==$Tv0/fP/RD/3OGdicLrtrRFKQXov1rgu4bj4X4shw1FA=');

MERGE auth.local_credentials AS target
USING (
    SELECT c.email,
           c.hash,
           (SELECT TOP (1) ua.id FROM auth.user_accounts ua
            JOIN people.staff s ON s.id = ua.staff_id
            WHERE s.email = c.email AND ua.archived_at IS NULL AND s.archived_at IS NULL
            ORDER BY ua.created_at DESC) AS user_account_id
    FROM @credentials c
) AS source
ON target.email = source.email
WHEN MATCHED THEN UPDATE SET
    password_hash = source.hash,
    user_account_id = source.user_account_id,
    updated_at = @now
WHEN NOT MATCHED THEN INSERT (email, password_hash, user_account_id, updated_at)
    VALUES (source.email, source.hash, source.user_account_id, @now);

INSERT INTO ops.audit_logs (user_account_id, entity_name, entity_id, action, summary, after_json)
VALUES ('41000000-0000-0000-0000-000000000001', N'user_accounts', NULL, N'local_test_environment_setup',
    N'Archived non-test staff and created local test accounts.',
    (SELECT @archivedStaff AS archivedStaff, @archivedAccounts AS archivedAccounts FOR JSON PATH, WITHOUT_ARRAY_WRAPPER));

COMMIT TRANSACTION;

SELECT @archivedStaff AS archived_staff, @archivedAccounts AS archived_accounts;
SELECT s.display_name, s.email, r.role_key
FROM people.staff s
JOIN auth.user_accounts ua ON ua.staff_id = s.id
LEFT JOIN auth.user_roles ur ON ur.user_account_id = ua.id
LEFT JOIN auth.roles r ON r.id = ur.role_id
WHERE s.archived_at IS NULL
ORDER BY s.display_name, r.role_key;
