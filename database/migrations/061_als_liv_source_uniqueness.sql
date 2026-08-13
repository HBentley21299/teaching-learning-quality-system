SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO

BEGIN TRANSACTION;

IF EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'quality.liv_records')
      AND name = N'ux_liv_records_source_elevate'
)
BEGIN
    DROP INDEX ux_liv_records_source_elevate ON quality.liv_records;
END;

CREATE UNIQUE INDEX ux_liv_records_source_elevate
    ON quality.liv_records(process_key, source_elevate_assessment_id)
    WHERE source_elevate_assessment_id IS NOT NULL AND archived_at IS NULL;

COMMIT TRANSACTION;
GO
