SET XACT_ABORT ON;
SET NOCOUNT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO

BEGIN TRANSACTION;

-- Clear the editable catalogue while retaining immutable question snapshots on
-- opened and historical reviews. The seven fixed activity types and their
-- empty form templates remain available for administrators to repopulate.
DELETE FROM qa.review_question_selections;
DELETE FROM qa.activity_template_questions;

UPDATE qa.questions
SET is_retired = 1,
    archived_at = COALESCE(archived_at, sysutcdatetime())
WHERE archived_at IS NULL;

COMMIT TRANSACTION;
GO
