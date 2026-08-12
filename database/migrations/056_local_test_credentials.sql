SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO

-- Username/password credentials for local test accounts. Passwords are
-- PBKDF2-SHA256 hashes; production sign-in remains Microsoft Entra ID.
IF OBJECT_ID(N'auth.local_credentials', N'U') IS NULL
BEGIN
    CREATE TABLE auth.local_credentials (
        user_account_id uniqueidentifier NOT NULL
            CONSTRAINT pk_local_credentials PRIMARY KEY
            CONSTRAINT fk_local_credentials_account REFERENCES auth.user_accounts(id),
        password_hash nvarchar(500) NOT NULL,
        updated_at datetimeoffset NOT NULL
            CONSTRAINT df_local_credentials_updated_at DEFAULT sysutcdatetime(),
        updated_by_user_account_id uniqueidentifier NULL
            CONSTRAINT fk_local_credentials_updated_by REFERENCES auth.user_accounts(id)
    );
END;
GO
