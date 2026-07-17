SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'quality.staff_reflections')
      AND name = N'ix_staff_reflections_profile_date'
)
BEGIN
    CREATE INDEX ix_staff_reflections_profile_date
        ON quality.staff_reflections(staff_id, archived_at, reflection_date DESC, created_at DESC)
        INCLUDE (elevate_practice_assessment_id, elevate_practice_record_id, status);
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'quality.actions')
      AND name = N'ix_actions_subject_profile'
)
BEGIN
    CREATE INDEX ix_actions_subject_profile
        ON quality.actions(subject_staff_id, archived_at, due_date, created_at DESC)
        INCLUDE (owner_staff_id, source_record_id, completed_date, status_lookup_value_id);
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'quality.actions')
      AND name = N'ix_actions_owner_profile'
)
BEGIN
    CREATE INDEX ix_actions_owner_profile
        ON quality.actions(owner_staff_id, archived_at, due_date, created_at DESC)
        INCLUDE (subject_staff_id, source_record_id, completed_date, status_lookup_value_id);
END;
GO
