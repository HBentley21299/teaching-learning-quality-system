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

IF COL_LENGTH(N'qa.question_versions', N'question_tag') IS NULL
BEGIN
    ALTER TABLE qa.question_versions
        ADD question_tag nvarchar(80) NOT NULL
            CONSTRAINT df_qa_question_versions_tag DEFAULT N'general';
END;

IF COL_LENGTH(N'qa.reviews', N'question_tag') IS NULL
BEGIN
    ALTER TABLE qa.reviews
        ADD question_tag nvarchar(80) NOT NULL
            CONSTRAINT df_qa_reviews_tag DEFAULT N'general';
END;

IF COL_LENGTH(N'qa.review_questions', N'question_tag') IS NULL
BEGIN
    ALTER TABLE qa.review_questions
        ADD question_tag nvarchar(80) NOT NULL
            CONSTRAINT df_qa_review_questions_tag DEFAULT N'general';
END;

-- Compile statements that reference the new columns only after SQL Server has
-- completed the conditional schema batch. The transaction remains open.
GO

UPDATE qa.question_versions
SET question_tag = N'general'
WHERE NULLIF(LTRIM(RTRIM(question_tag)), N'') IS NULL;

UPDATE qa.reviews
SET question_tag = N'general'
WHERE NULLIF(LTRIM(RTRIM(question_tag)), N'') IS NULL;

UPDATE qa.review_questions
SET question_tag = N'general'
WHERE NULLIF(LTRIM(RTRIM(question_tag)), N'') IS NULL;

IF COL_LENGTH(N'qa.reviews', N'active_review_slot') IS NULL
BEGIN
    ALTER TABLE qa.reviews
        ADD active_review_slot AS (
            CASE
                WHEN status IN (N'open', N'reopened')
                    THEN CONVERT(uniqueidentifier, N'00000000-0000-0000-0000-000000000000')
                ELSE record_id
            END
        ) PERSISTED;
END;
GO

IF (SELECT COUNT(*) FROM qa.reviews WHERE status IN (N'open', N'reopened')) > 1
BEGIN
    THROW 51000, 'Only one QA Review may be Open or Reopened at a time. Close the additional active reviews before applying migration 065.', 1;
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'qa.reviews') AND name = N'uq_qa_reviews_single_active'
)
BEGIN
    CREATE UNIQUE INDEX uq_qa_reviews_single_active
        ON qa.reviews(active_review_slot);
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'qa.question_versions') AND name = N'ix_qa_question_versions_tag'
)
BEGIN
    CREATE INDEX ix_qa_question_versions_tag
        ON qa.question_versions(question_tag, source_status, is_active, question_id, version_number DESC);
END;

COMMIT TRANSACTION;
GO
