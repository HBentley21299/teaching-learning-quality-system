-- Administrative concurrency ignores last-login updates but tracks access changes.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO
IF COL_LENGTH(N'auth.user_accounts', N'admin_version') IS NULL
    ALTER TABLE auth.user_accounts ADD admin_version bigint NOT NULL CONSTRAINT df_user_accounts_admin_version DEFAULT 0 WITH VALUES;
GO
CREATE OR ALTER TRIGGER auth.tr_user_roles_admin_revision ON auth.user_roles AFTER INSERT, UPDATE, DELETE AS
BEGIN
    SET NOCOUNT ON;
    UPDATE account SET admin_version = account.admin_version + 1
    FROM auth.user_accounts account
    WHERE account.id IN (SELECT user_account_id FROM inserted UNION SELECT user_account_id FROM deleted);
END;
GO
CREATE OR ALTER TRIGGER auth.tr_access_scopes_admin_revision ON auth.access_scopes AFTER INSERT, UPDATE, DELETE AS
BEGIN
    SET NOCOUNT ON;
    UPDATE account SET admin_version = account.admin_version + 1
    FROM auth.user_accounts account
    WHERE account.id IN (SELECT user_account_id FROM inserted UNION SELECT user_account_id FROM deleted);
END;
GO
CREATE OR ALTER TRIGGER auth.tr_account_status_admin_revision ON auth.user_accounts AFTER UPDATE AS
BEGIN
    SET NOCOUNT ON;
    IF UPDATE(is_disabled) OR UPDATE(account_status) OR UPDATE(archived_at)
        UPDATE account SET admin_version = account.admin_version + 1
        FROM auth.user_accounts account JOIN inserted current_row ON current_row.id = account.id
        JOIN deleted previous ON previous.id = current_row.id
        WHERE current_row.is_disabled <> previous.is_disabled OR current_row.account_status <> previous.account_status
           OR ISNULL(current_row.archived_at,CONVERT(datetimeoffset,'1900-01-01')) <> ISNULL(previous.archived_at,CONVERT(datetimeoffset,'1900-01-01'));
END;
GO

-- Preserve each installed function's shape and scope semantics. Some databases
-- use inline visibility functions for query performance; SQL Server cannot ALTER
-- between inline and multi-statement table-valued functions.
DECLARE @definition nvarchar(max) = OBJECT_DEFINITION(OBJECT_ID(N'org.fn_visible_org_units'));
IF @definition IS NULL OR CHARINDEX(N'FROM auth.user_roles ur', @definition) = 0
    THROW 51000, 'Cannot safely update org.fn_visible_org_units: expected role lookup was not found.', 1;
SET @definition = N'ALTER ' + SUBSTRING(@definition, CHARINDEX(N'FUNCTION', UPPER(@definition)), LEN(@definition));
IF CHARINDEX(N'JOIN auth.roles active_role', @definition) = 0
    SET @definition = REPLACE(@definition, N'FROM auth.user_roles ur',
        N'FROM auth.user_roles ur JOIN auth.roles active_role ON active_role.id = ur.role_id AND active_role.is_active = 1 AND active_role.archived_at IS NULL');
IF CHARINDEX(N'p.archived_at IS NULL', @definition) = 0
    SET @definition = REPLACE(@definition, N'JOIN auth.permissions p ON p.id = rp.permission_id',
        N'JOIN auth.permissions p ON p.id = rp.permission_id AND p.archived_at IS NULL');
EXEC sys.sp_executesql @definition;
GO
DECLARE @definition nvarchar(max) = OBJECT_DEFINITION(OBJECT_ID(N'org.fn_visible_staff'));
IF @definition IS NULL OR CHARINDEX(N'FROM auth.user_roles user_role', @definition) = 0
    THROW 51000, 'Cannot safely update org.fn_visible_staff: expected role lookup was not found.', 1;
SET @definition = N'ALTER ' + SUBSTRING(@definition, CHARINDEX(N'FUNCTION', UPPER(@definition)), LEN(@definition));
IF CHARINDEX(N'JOIN auth.roles active_role', @definition) = 0
    SET @definition = REPLACE(@definition, N'FROM auth.user_roles user_role',
        N'FROM auth.user_roles user_role JOIN auth.roles active_role ON active_role.id = user_role.role_id AND active_role.is_active = 1 AND active_role.archived_at IS NULL');
EXEC sys.sp_executesql @definition;
GO
