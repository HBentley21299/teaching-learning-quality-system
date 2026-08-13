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
    Elevate Status artwork is versioned by academic year and level. Replacing
    an image archives the previous row, so other academic years and the audit
    history remain unchanged.
*/
IF OBJECT_ID(N'cpd.elevate_status_badge_assets', N'U') IS NULL
BEGIN
    CREATE TABLE cpd.elevate_status_badge_assets (
        id uniqueidentifier NOT NULL
            CONSTRAINT pk_elevate_status_badge_assets PRIMARY KEY DEFAULT newsequentialid(),
        academic_year_key nvarchar(7) NOT NULL,
        level_number tinyint NOT NULL,
        file_name nvarchar(260) NOT NULL,
        content_type nvarchar(100) NOT NULL,
        content_length int NOT NULL,
        file_content varbinary(max) NOT NULL,
        uploaded_by_user_account_id uniqueidentifier NOT NULL,
        created_at datetimeoffset NOT NULL
            CONSTRAINT df_elevate_status_badge_assets_created DEFAULT sysutcdatetime(),
        archived_by_user_account_id uniqueidentifier NULL,
        archived_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT fk_elevate_status_badge_assets_year
            FOREIGN KEY (academic_year_key) REFERENCES core.academic_years(academic_year_key),
        CONSTRAINT fk_elevate_status_badge_assets_uploaded_by
            FOREIGN KEY (uploaded_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT fk_elevate_status_badge_assets_archived_by
            FOREIGN KEY (archived_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT ck_elevate_status_badge_assets_level CHECK (level_number BETWEEN 1 AND 5),
        CONSTRAINT ck_elevate_status_badge_assets_content_type
            CHECK (content_type IN (N'image/png', N'image/jpeg', N'image/webp')),
        CONSTRAINT ck_elevate_status_badge_assets_length
            CHECK (content_length > 0 AND content_length <= 5242880)
    );

    CREATE UNIQUE INDEX ux_elevate_status_badge_assets_active
        ON cpd.elevate_status_badge_assets(academic_year_key, level_number)
        WHERE archived_at IS NULL;

    CREATE INDEX ix_elevate_status_badge_assets_history
        ON cpd.elevate_status_badge_assets(academic_year_key, level_number, created_at DESC)
        INCLUDE (file_name, content_type, content_length, uploaded_by_user_account_id, archived_at);
END;
GO
