SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

BEGIN TRANSACTION;

-- A coordinator initially assigns the lecturer and observer only. The observer
-- completes these session fields in the first controlled-form section.
ALTER TABLE quality.uco_tla_reviews ALTER COLUMN observation_at datetimeoffset NULL;
ALTER TABLE quality.uco_tla_reviews ALTER COLUMN session_type nvarchar(200) NULL;
ALTER TABLE quality.uco_tla_reviews ALTER COLUMN course_title nvarchar(300) NULL;
ALTER TABLE quality.uco_tla_reviews ALTER COLUMN module_title nvarchar(300) NULL;
ALTER TABLE quality.uco_tla_reviews ALTER COLUMN course_level nvarchar(100) NULL;

COMMIT TRANSACTION;
GO
