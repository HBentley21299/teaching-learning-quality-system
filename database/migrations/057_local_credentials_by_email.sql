SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO

-- Local test credentials are keyed by email rather than user account so a
-- test sign-in can exist before the account does. That lets a test account
-- reach the trusted self-onboarding screen (faculty, team, staff category)
-- on first sign-in, exactly as a first-time Microsoft user would.
IF OBJECT_ID(N'auth.local_credentials', N'U') IS NOT NULL
   AND COL_LENGTH(N'auth.local_credentials', N'email') IS NULL
BEGIN
    CREATE TABLE auth.local_credentials_rebuild (
        email nvarchar(320) NOT NULL
            CONSTRAINT pk_local_credentials_rebuild PRIMARY KEY,
        password_hash nvarchar(500) NOT NULL,
        user_account_id uniqueidentifier NULL
            CONSTRAINT fk_local_credentials_rebuild_account REFERENCES auth.user_accounts(id),
        updated_at datetimeoffset NOT NULL
            CONSTRAINT df_local_credentials_rebuild_updated_at DEFAULT sysutcdatetime(),
        updated_by_user_account_id uniqueidentifier NULL
            CONSTRAINT fk_local_credentials_rebuild_updated_by REFERENCES auth.user_accounts(id)
    );

    INSERT INTO auth.local_credentials_rebuild (email, password_hash, user_account_id, updated_at, updated_by_user_account_id)
    SELECT s.email, lc.password_hash, lc.user_account_id, lc.updated_at, lc.updated_by_user_account_id
    FROM auth.local_credentials lc
    JOIN auth.user_accounts ua ON ua.id = lc.user_account_id
    JOIN people.staff s ON s.id = ua.staff_id;

    DROP TABLE auth.local_credentials;
    EXEC sp_rename N'auth.local_credentials_rebuild', N'local_credentials';
    EXEC sp_rename N'auth.pk_local_credentials_rebuild', N'pk_local_credentials', N'OBJECT';
END;
GO

IF OBJECT_ID(N'auth.local_credentials', N'U') IS NULL
BEGIN
    CREATE TABLE auth.local_credentials (
        email nvarchar(320) NOT NULL
            CONSTRAINT pk_local_credentials PRIMARY KEY,
        password_hash nvarchar(500) NOT NULL,
        user_account_id uniqueidentifier NULL
            CONSTRAINT fk_local_credentials_account REFERENCES auth.user_accounts(id),
        updated_at datetimeoffset NOT NULL
            CONSTRAINT df_local_credentials_updated_at DEFAULT sysutcdatetime(),
        updated_by_user_account_id uniqueidentifier NULL
            CONSTRAINT fk_local_credentials_updated_by REFERENCES auth.user_accounts(id)
    );
END;
GO
