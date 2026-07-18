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
    Academic years are governed system data. The August-to-July boundary is
    shared by every module through core.records, while the catalogue supplies
    stable filter options and five future years.
*/
IF OBJECT_ID(N'core.academic_years', N'U') IS NULL
BEGIN
    CREATE TABLE core.academic_years (
        academic_year_key nvarchar(7) NOT NULL CONSTRAINT pk_academic_years PRIMARY KEY,
        start_date date NOT NULL,
        end_date date NOT NULL,
        display_order int NOT NULL,
        is_active bit NOT NULL CONSTRAINT df_academic_years_active DEFAULT 1,
        created_at datetimeoffset NOT NULL CONSTRAINT df_academic_years_created DEFAULT sysutcdatetime(),
        archived_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT ck_academic_years_key CHECK (academic_year_key LIKE N'[1-2][0-9][0-9][0-9]/[0-9][0-9]'),
        CONSTRAINT ck_academic_years_dates CHECK (end_date >= start_date)
    );
END;
GO

DECLARE @current_start_year int = CASE
    WHEN MONTH(CONVERT(date, sysutcdatetime())) >= 8 THEN YEAR(CONVERT(date, sysutcdatetime()))
    ELSE YEAR(CONVERT(date, sysutcdatetime())) - 1
END;
DECLARE @offset int = -5;

WHILE @offset <= 5
BEGIN
    DECLARE @start_year int = @current_start_year + @offset;
    DECLARE @year_key nvarchar(7) = CONCAT(@start_year, N'/', RIGHT(CONCAT(N'0', (@start_year + 1) % 100), 2));
    DECLARE @start_date date = DATEFROMPARTS(@start_year, 8, 1);
    DECLARE @end_date date = DATEFROMPARTS(@start_year + 1, 7, 31);

    IF NOT EXISTS (SELECT 1 FROM core.academic_years WHERE academic_year_key = @year_key)
    BEGIN
        INSERT INTO core.academic_years (academic_year_key, start_date, end_date, display_order)
        VALUES (@year_key, @start_date, @end_date, @start_year);
    END;

    SET @offset += 1;
END;
GO

IF COL_LENGTH(N'core.records', N'academic_year_key') IS NULL
BEGIN
    ALTER TABLE core.records ADD academic_year_key nvarchar(7) NULL;
END;
GO

;WITH record_years AS (
    SELECT
        record_row.id,
        CASE
            WHEN MONTH(COALESCE(record_row.record_date, CONVERT(date, record_row.created_at))) >= 8
                THEN YEAR(COALESCE(record_row.record_date, CONVERT(date, record_row.created_at)))
            ELSE YEAR(COALESCE(record_row.record_date, CONVERT(date, record_row.created_at))) - 1
        END AS start_year
    FROM core.records record_row
), missing_years AS (
    SELECT DISTINCT start_year
    FROM record_years
)
INSERT INTO core.academic_years (academic_year_key, start_date, end_date, display_order)
SELECT
    CONCAT(start_year, N'/', RIGHT(CONCAT(N'0', (start_year + 1) % 100), 2)),
    DATEFROMPARTS(start_year, 8, 1),
    DATEFROMPARTS(start_year + 1, 7, 31),
    start_year
FROM missing_years
WHERE NOT EXISTS (
    SELECT 1
    FROM core.academic_years existing
    WHERE existing.academic_year_key = CONCAT(start_year, N'/', RIGHT(CONCAT(N'0', (start_year + 1) % 100), 2))
);

UPDATE record_row
SET academic_year_key = CONCAT(
    calculated.start_year,
    N'/',
    RIGHT(CONCAT(N'0', (calculated.start_year + 1) % 100), 2)
)
FROM core.records record_row
CROSS APPLY (
    SELECT CASE
        WHEN MONTH(COALESCE(record_row.record_date, CONVERT(date, record_row.created_at))) >= 8
            THEN YEAR(COALESCE(record_row.record_date, CONVERT(date, record_row.created_at)))
        ELSE YEAR(COALESCE(record_row.record_date, CONVERT(date, record_row.created_at))) - 1
    END AS start_year
) calculated;
GO

IF EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID(N'core.records')
      AND name = N'academic_year_key'
      AND is_nullable = 1
)
BEGIN
    ALTER TABLE core.records ALTER COLUMN academic_year_key nvarchar(7) NOT NULL;
END;
GO

IF OBJECT_ID(N'core.df_records_academic_year', N'D') IS NULL
BEGIN
    ALTER TABLE core.records ADD CONSTRAINT df_records_academic_year DEFAULT (
        CONCAT(
            CASE WHEN MONTH(CONVERT(date, sysutcdatetime())) >= 8
                THEN YEAR(CONVERT(date, sysutcdatetime()))
                ELSE YEAR(CONVERT(date, sysutcdatetime())) - 1
            END,
            N'/',
            RIGHT(CONCAT(N'0', (
                CASE WHEN MONTH(CONVERT(date, sysutcdatetime())) >= 8
                    THEN YEAR(CONVERT(date, sysutcdatetime())) + 1
                    ELSE YEAR(CONVERT(date, sysutcdatetime()))
                END
            ) % 100), 2)
        )
    ) FOR academic_year_key;
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'fk_records_academic_year')
BEGIN
    ALTER TABLE core.records WITH CHECK ADD CONSTRAINT fk_records_academic_year
        FOREIGN KEY (academic_year_key) REFERENCES core.academic_years(academic_year_key);
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'core.records') AND name = N'ix_records_academic_year')
BEGIN
    CREATE INDEX ix_records_academic_year ON core.records(academic_year_key, record_type, record_date);
END;
GO

CREATE OR ALTER TRIGGER core.tr_records_assign_academic_year
ON core.records
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @calculated TABLE (
        record_id uniqueidentifier NOT NULL PRIMARY KEY,
        start_year int NOT NULL,
        academic_year_key nvarchar(7) NOT NULL
    );

    INSERT INTO @calculated (record_id, start_year, academic_year_key)
    SELECT
        inserted_row.id,
        year_value.start_year,
        CONCAT(year_value.start_year, N'/', RIGHT(CONCAT(N'0', (year_value.start_year + 1) % 100), 2))
    FROM inserted inserted_row
    CROSS APPLY (
        SELECT CASE
            WHEN MONTH(COALESCE(inserted_row.record_date, CONVERT(date, inserted_row.created_at))) >= 8
                THEN YEAR(COALESCE(inserted_row.record_date, CONVERT(date, inserted_row.created_at)))
            ELSE YEAR(COALESCE(inserted_row.record_date, CONVERT(date, inserted_row.created_at))) - 1
        END AS start_year
    ) year_value;

    INSERT INTO core.academic_years (academic_year_key, start_date, end_date, display_order)
    SELECT DISTINCT
        calculated.academic_year_key,
        DATEFROMPARTS(calculated.start_year, 8, 1),
        DATEFROMPARTS(calculated.start_year + 1, 7, 31),
        calculated.start_year
    FROM @calculated calculated
    WHERE NOT EXISTS (
        SELECT 1
        FROM core.academic_years existing
        WHERE existing.academic_year_key = calculated.academic_year_key
    );

    UPDATE record_row
    SET academic_year_key = calculated.academic_year_key
    FROM core.records record_row
    JOIN @calculated calculated ON calculated.record_id = record_row.id
    WHERE record_row.academic_year_key <> calculated.academic_year_key;
END;
GO

/* Only T&L and system administrators may confirm controlled campaign levels. */
DECLARE @manage_permission_id uniqueidentifier = CONVERT(uniqueidentifier, '1a000000-0000-0000-0000-000000000001');

IF NOT EXISTS (SELECT 1 FROM auth.permissions WHERE permission_key = N'elevate_status.manage')
BEGIN
    INSERT INTO auth.permissions (id, permission_key, name, description, category)
    VALUES (
        @manage_permission_id,
        N'elevate_status.manage',
        N'Manage Elevate Status',
        N'Confirm, amend and revoke controlled Elevate Status campaign levels.',
        N'CPD'
    );
END
ELSE
BEGIN
    SELECT @manage_permission_id = id
    FROM auth.permissions
    WHERE permission_key = N'elevate_status.manage';
END;

INSERT INTO auth.role_permissions (role_id, permission_id)
SELECT role_row.id, @manage_permission_id
FROM auth.roles role_row
WHERE role_row.role_key IN (N'super_admin', N'teaching_learning_team')
  AND role_row.archived_at IS NULL
  AND NOT EXISTS (
      SELECT 1
      FROM auth.role_permissions existing
      WHERE existing.role_id = role_row.id
        AND existing.permission_id = @manage_permission_id
  );
GO

IF OBJECT_ID(N'cpd.elevate_status_awards', N'U') IS NULL
BEGIN
    CREATE TABLE cpd.elevate_status_awards (
        id uniqueidentifier NOT NULL CONSTRAINT pk_elevate_status_awards PRIMARY KEY DEFAULT newsequentialid(),
        staff_id uniqueidentifier NOT NULL,
        academic_year_key nvarchar(7) NOT NULL,
        level_number tinyint NOT NULL,
        qualifying_attendance_count int NOT NULL,
        evidence_cpd_event_id uniqueidentifier NULL,
        implementation_impact nvarchar(max) NULL,
        confirmed_by_user_account_id uniqueidentifier NOT NULL,
        confirmed_at datetimeoffset NOT NULL CONSTRAINT df_elevate_status_awards_confirmed DEFAULT sysutcdatetime(),
        updated_by_user_account_id uniqueidentifier NULL,
        updated_at datetimeoffset NULL,
        archived_by_user_account_id uniqueidentifier NULL,
        archived_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT fk_elevate_status_awards_staff FOREIGN KEY (staff_id) REFERENCES people.staff(id),
        CONSTRAINT fk_elevate_status_awards_year FOREIGN KEY (academic_year_key) REFERENCES core.academic_years(academic_year_key),
        CONSTRAINT fk_elevate_status_awards_event FOREIGN KEY (evidence_cpd_event_id) REFERENCES cpd.cpd_events(id),
        CONSTRAINT fk_elevate_status_awards_confirmed_by FOREIGN KEY (confirmed_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT fk_elevate_status_awards_updated_by FOREIGN KEY (updated_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT fk_elevate_status_awards_archived_by FOREIGN KEY (archived_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT ck_elevate_status_awards_level CHECK (level_number BETWEEN 1 AND 5),
        CONSTRAINT ck_elevate_status_awards_attendance CHECK (qualifying_attendance_count >= 0),
        CONSTRAINT ck_elevate_status_awards_evidence CHECK (
            (level_number = 1 AND evidence_cpd_event_id IS NOT NULL AND LEN(LTRIM(RTRIM(implementation_impact))) > 0)
            OR
            (level_number > 1 AND evidence_cpd_event_id IS NULL AND implementation_impact IS NULL)
        )
    );

    CREATE UNIQUE INDEX ux_elevate_status_awards_active_level
        ON cpd.elevate_status_awards(staff_id, academic_year_key, level_number)
        WHERE archived_at IS NULL;

    CREATE INDEX ix_elevate_status_awards_profile
        ON cpd.elevate_status_awards(staff_id, academic_year_key)
        INCLUDE (level_number, qualifying_attendance_count, confirmed_at)
        WHERE archived_at IS NULL;
END;
GO
