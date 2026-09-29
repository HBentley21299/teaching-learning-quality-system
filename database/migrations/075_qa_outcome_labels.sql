SET XACT_ABORT ON;
BEGIN TRANSACTION;

-- Display wording only: no evidence, question snapshots, scoring or reporting keys change.
IF OBJECT_ID(N'qa.outcome_labels', N'U') IS NULL
BEGIN
    CREATE TABLE qa.outcome_labels (
        id tinyint NOT NULL CONSTRAINT PK_qa_outcome_labels PRIMARY KEY,
        below_label nvarchar(40) NOT NULL,
        at_label nvarchar(40) NOT NULL,
        above_label nvarchar(40) NOT NULL,
        not_applicable_label nvarchar(40) NOT NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT CK_qa_outcome_labels_singleton CHECK (id = 1),
        CONSTRAINT CK_qa_outcome_labels_nonempty CHECK (
            LEN(LTRIM(RTRIM(below_label))) > 0 AND LEN(LTRIM(RTRIM(at_label))) > 0
            AND LEN(LTRIM(RTRIM(above_label))) > 0 AND LEN(LTRIM(RTRIM(not_applicable_label))) > 0),
        CONSTRAINT CK_qa_outcome_labels_distinct CHECK (
            below_label <> at_label AND below_label <> above_label AND below_label <> not_applicable_label
            AND at_label <> above_label AND at_label <> not_applicable_label AND above_label <> not_applicable_label)
    );
    INSERT INTO qa.outcome_labels (id, below_label, at_label, above_label, not_applicable_label)
    VALUES (1, N'Below standard', N'At standard', N'Above standard', N'Not applicable');
END;

INSERT INTO core.admin_managed_lists (lookup_type_id, category, description, display_order)
SELECT type.id, N'QA Hub', N'Action themes available when creating QA Review actions.', 180
FROM core.lookup_types type
WHERE type.lookup_key = N'action_theme_qa_review'
  AND NOT EXISTS (SELECT 1 FROM core.admin_managed_lists existing WHERE existing.lookup_type_id = type.id);

INSERT INTO core.lookup_usage_registry (lookup_type_id, application_key, display_name)
SELECT type.id, N'actions.qa_review', N'QA Review action forms'
FROM core.lookup_types type
WHERE type.lookup_key = N'action_theme_qa_review'
  AND NOT EXISTS (SELECT 1 FROM core.lookup_usage_registry existing WHERE existing.lookup_type_id = type.id AND existing.application_key = N'actions.qa_review');

COMMIT TRANSACTION;
