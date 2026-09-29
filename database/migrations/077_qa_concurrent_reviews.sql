SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET ARITHABORT ON;
SET NUMERIC_ROUNDABORT OFF;
GO

BEGIN TRANSACTION;

-- Reviews have independent scopes, evidence, lifecycles and dashboard snapshots.
-- Remove the former global single-open-review restriction without changing data.
IF EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'qa.reviews') AND name = N'uq_qa_reviews_single_active'
)
    DROP INDEX uq_qa_reviews_single_active ON qa.reviews;

IF COL_LENGTH(N'qa.reviews', N'active_review_slot') IS NOT NULL
    ALTER TABLE qa.reviews DROP COLUMN active_review_slot;

COMMIT TRANSACTION;
GO
