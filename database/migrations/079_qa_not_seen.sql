-- Optional neutral QA outcome, selected per form template. No evidence or snapshots are rewritten.
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF COL_LENGTH(N'qa.activity_templates', N'allows_not_seen') IS NULL
    ALTER TABLE qa.activity_templates ADD allows_not_seen bit NOT NULL
        CONSTRAINT df_qa_activity_templates_not_seen DEFAULT (0) WITH VALUES;

IF OBJECT_ID(N'qa.ck_qa_evidence_responses_outcome', N'C') IS NOT NULL
    ALTER TABLE qa.evidence_responses DROP CONSTRAINT ck_qa_evidence_responses_outcome;

ALTER TABLE qa.evidence_responses WITH CHECK ADD CONSTRAINT ck_qa_evidence_responses_outcome
    CHECK (outcome IS NULL OR outcome IN (N'below', N'at', N'above', N'not_applicable', N'not_seen'));

COMMIT TRANSACTION;
