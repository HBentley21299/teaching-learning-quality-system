SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;

BEGIN TRANSACTION;

IF COL_LENGTH('quality.actions', 'action_theme') IS NULL
BEGIN
    ALTER TABLE quality.actions
        ADD action_theme nvarchar(200) NULL;
END;
GO

UPDATE action
SET action_theme =
    CASE COALESCE(NULLIF(action.source_form_type, ''), record.record_type, 'standalone')
        WHEN 'learning_walk' THEN N'Learning Walk'
        WHEN 'work_scrutiny' THEN N'Work Scrutiny'
        WHEN 'coaching_mentoring' THEN N'Coaching and Mentoring'
        WHEN 'liv' THEN N'Learning and Improvement Visit'
        WHEN 'probation_observation' THEN N'Probationary Observation'
        WHEN 'elevate_environment' THEN N'Elevate Learning Environment'
        WHEN 'elevate_practice' THEN N'Elevate Learning and Innovation'
        ELSE N'Organisation'
    END
FROM quality.actions action
LEFT JOIN core.records record ON record.id = action.source_record_id
WHERE NULLIF(LTRIM(RTRIM(action.action_theme)), '') IS NULL;

ALTER TABLE quality.actions
    ALTER COLUMN action_theme nvarchar(200) NOT NULL;

COMMIT TRANSACTION;
