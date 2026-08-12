-- Returns a local test sign-in to its "first sign-in" state so trusted
-- self-onboarding (faculty, team, staff category) runs again. The password
-- is kept, so the same credentials still sign in.
--
-- Usage (defaults to the new-starter account):
--   sqlcmd -S "(localdb)\MSSQLLocalDB" -d TLQS -i scripts\reset-onboarding.sql
--   sqlcmd -S "(localdb)\MSSQLLocalDB" -d TLQS -v email="staff.test@ielevate.local" -i scripts\reset-onboarding.sql
--
-- Only ever point this at a test account: it removes that person's staff
-- record, account, roles, scopes and memberships.
SET XACT_ABORT ON;
SET NOCOUNT ON;

:setvar email "newstarter.test@ielevate.local"
DECLARE @email nvarchar(320) = N'$(email)';

BEGIN TRANSACTION;

DECLARE @staffIds TABLE (id uniqueidentifier);
INSERT INTO @staffIds SELECT id FROM people.staff WHERE email = @email;

DECLARE @accountIds TABLE (id uniqueidentifier);
INSERT INTO @accountIds
SELECT ua.id FROM auth.user_accounts ua WHERE ua.staff_id IN (SELECT id FROM @staffIds);

-- Unlink the credential first so the account rows can be removed.
UPDATE auth.local_credentials SET user_account_id = NULL, updated_at = sysutcdatetime()
WHERE email = @email;
UPDATE auth.local_credentials SET updated_by_user_account_id = NULL
WHERE updated_by_user_account_id IN (SELECT id FROM @accountIds);

DELETE FROM auth.access_scopes WHERE user_account_id IN (SELECT id FROM @accountIds);
DELETE FROM auth.user_roles WHERE user_account_id IN (SELECT id FROM @accountIds);
DELETE FROM auth.auth_identities WHERE user_account_id IN (SELECT id FROM @accountIds);
DELETE FROM org.staff_org_memberships WHERE staff_id IN (SELECT id FROM @staffIds);
UPDATE ops.audit_logs SET user_account_id = NULL
WHERE user_account_id IN (SELECT id FROM @accountIds);
DELETE FROM auth.user_accounts WHERE id IN (SELECT id FROM @accountIds);
DELETE FROM people.staff WHERE id IN (SELECT id FROM @staffIds);

COMMIT TRANSACTION;

SELECT @email AS reset_email,
       (SELECT COUNT(*) FROM people.staff WHERE email = @email) AS staff_rows_remaining,
       (SELECT COUNT(*) FROM auth.local_credentials WHERE email = @email) AS credential_kept;
