SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

BEGIN TRANSACTION;

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'core.records')
      AND name = N'ix_records_reporting_year_active'
)
BEGIN
    CREATE INDEX ix_records_reporting_year_active
        ON core.records (academic_year_key, record_type, record_date DESC, created_at DESC)
        INCLUDE (id, owner_staff_id, subject_staff_id, org_unit_id, module_id)
        WHERE archived_at IS NULL
        WITH (MAXDOP = 1);
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'quality.actions')
      AND name = N'ix_actions_source_record_active'
)
BEGIN
    CREATE INDEX ix_actions_source_record_active
        ON quality.actions (source_record_id)
        INCLUDE (
            owner_staff_id,
            subject_staff_id,
            status_lookup_value_id,
            due_date,
            completed_date,
            source_form_type,
            created_at,
            visibility_setting,
            action_theme
        )
        WHERE archived_at IS NULL
        WITH (MAXDOP = 1);
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'quality.actions')
      AND name = N'ix_actions_created_active'
)
BEGIN
    CREATE INDEX ix_actions_created_active
        ON quality.actions (created_at DESC)
        INCLUDE (source_record_id, owner_staff_id, subject_staff_id, status_lookup_value_id, due_date, completed_date)
        WHERE archived_at IS NULL
        WITH (MAXDOP = 1);
END;

COMMIT TRANSACTION;
