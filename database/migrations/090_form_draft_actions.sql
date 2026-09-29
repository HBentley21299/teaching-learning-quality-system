-- Incomplete actions belong to a draft submission, never the central action pool.
IF COL_LENGTH(N'forms.form_submissions', N'draft_actions_json') IS NULL
BEGIN
    ALTER TABLE forms.form_submissions ADD draft_actions_json nvarchar(max) NULL;
    EXEC(N'ALTER TABLE forms.form_submissions ADD CONSTRAINT CK_form_submissions_draft_actions_json
        CHECK (draft_actions_json IS NULL OR ISJSON(draft_actions_json) = 1);');
END;
