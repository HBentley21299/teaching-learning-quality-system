SET XACT_ABORT ON;
GO
-- One optional commentary field per QA evidence form. Existing reviews retain commentary access.
IF COL_LENGTH(N'qa.review_activities',N'written_commentary_enabled') IS NULL
BEGIN
    ALTER TABLE qa.review_activities ADD written_commentary_enabled bit NOT NULL
        CONSTRAINT df_qa_review_activities_written_commentary DEFAULT (1) WITH VALUES;
END;
GO
IF COL_LENGTH(N'qa.evidence_submissions',N'written_commentary') IS NULL
BEGIN
    ALTER TABLE qa.evidence_submissions ADD written_commentary nvarchar(max) NULL;
END;
GO
