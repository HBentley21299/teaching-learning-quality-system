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

IF COL_LENGTH(N'qa.action_groups', N'scope_mode') IS NULL
BEGIN
    ALTER TABLE qa.action_groups ADD
        scope_mode nvarchar(20) NOT NULL
            CONSTRAINT df_qa_action_groups_scope_mode DEFAULT N'faculty',
        creator_staff_id uniqueidentifier NULL,
        workflow_status nvarchar(20) NOT NULL
            CONSTRAINT df_qa_action_groups_workflow_status DEFAULT N'open',
        reviewed_at datetimeoffset NULL,
        reviewed_by_user_account_id uniqueidentifier NULL,
        closed_at datetimeoffset NULL,
        closed_by_user_account_id uniqueidentifier NULL;
END;
GO

IF OBJECT_ID(N'qa.action_groups', N'U') IS NOT NULL
BEGIN
    IF OBJECT_ID(N'qa.fk_qa_action_groups_creator_staff', N'F') IS NULL
        ALTER TABLE qa.action_groups ADD CONSTRAINT fk_qa_action_groups_creator_staff
            FOREIGN KEY (creator_staff_id) REFERENCES people.staff(id);

    IF OBJECT_ID(N'qa.fk_qa_action_groups_reviewed_by', N'F') IS NULL
        ALTER TABLE qa.action_groups ADD CONSTRAINT fk_qa_action_groups_reviewed_by
            FOREIGN KEY (reviewed_by_user_account_id) REFERENCES auth.user_accounts(id);

    IF OBJECT_ID(N'qa.fk_qa_action_groups_workflow_closed_by', N'F') IS NULL
        ALTER TABLE qa.action_groups ADD CONSTRAINT fk_qa_action_groups_workflow_closed_by
            FOREIGN KEY (closed_by_user_account_id) REFERENCES auth.user_accounts(id);

    IF OBJECT_ID(N'qa.ck_qa_action_groups_scope_mode', N'C') IS NULL
        ALTER TABLE qa.action_groups ADD CONSTRAINT ck_qa_action_groups_scope_mode
            CHECK (scope_mode IN (N'faculty', N'team', N'whole_review'));

    IF OBJECT_ID(N'qa.ck_qa_action_groups_workflow_status', N'C') IS NULL
        ALTER TABLE qa.action_groups ADD CONSTRAINT ck_qa_action_groups_workflow_status
            CHECK (workflow_status IN (N'open', N'reviewed', N'closed'));

    UPDATE action_group
    SET creator_staff_id = COALESCE(action_group.creator_staff_id, account.staff_id),
        workflow_status = CASE WHEN forced_closed_at IS NULL THEN action_group.workflow_status ELSE N'closed' END,
        closed_at = COALESCE(action_group.closed_at, forced_closed_at),
        closed_by_user_account_id = COALESCE(action_group.closed_by_user_account_id, forced_closed_by_user_account_id)
    FROM qa.action_groups action_group
    LEFT JOIN auth.user_accounts account ON account.id = action_group.created_by_user_account_id;
END;

IF COL_LENGTH(N'qa.action_groups', N'faculty_org_unit_id') IS NOT NULL
BEGIN
    ALTER TABLE qa.action_groups ALTER COLUMN faculty_org_unit_id uniqueidentifier NULL;
    ALTER TABLE qa.action_groups ALTER COLUMN faculty_code_snapshot nvarchar(50) NULL;
    ALTER TABLE qa.action_groups ALTER COLUMN faculty_name_snapshot nvarchar(250) NULL;
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'qa.action_groups')
      AND name = N'ix_qa_action_groups_workflow'
)
    CREATE INDEX ix_qa_action_groups_workflow
        ON qa.action_groups(workflow_status, review_id, due_date)
        INCLUDE (creator_staff_id, scope_mode, title, created_at);

INSERT INTO qa.activity_types (id, activity_key, name, description, display_order)
SELECT CONVERT(uniqueidentifier, '73000000-0000-0000-0000-000000000008'),
       N'inclusion_learning_walk', N'Inclusion Learning Walks',
       N'Focused review of inclusive practice and learner access.', 35
WHERE NOT EXISTS (
    SELECT 1 FROM qa.activity_types WHERE activity_key = N'inclusion_learning_walk'
);

INSERT INTO qa.activity_templates (
    id, activity_type_id, template_key, name, description
)
SELECT CONVERT(uniqueidentifier, '72000000-0000-0000-0000-000000000008'),
       activity.id, N'qa_inclusion_learning_walk_initial',
       N'Inclusion Learning Walks',
       N'Blank fixed process ready for questions to be added in QA Review criteria.'
FROM qa.activity_types activity
WHERE activity.activity_key = N'inclusion_learning_walk'
  AND NOT EXISTS (
      SELECT 1 FROM qa.activity_templates
      WHERE template_key = N'qa_inclusion_learning_walk_initial'
  );

COMMIT TRANSACTION;
GO
