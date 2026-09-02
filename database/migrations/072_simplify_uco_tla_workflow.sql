SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

BEGIN TRANSACTION;

-- Moderation has been removed from the live workflow. Preserve the legacy
-- columns for existing audit history, but do not require a moderator for new reviews.
UPDATE quality.uco_tla_reviews
SET workflow_status = CASE
        WHEN workflow_status = N'awaiting_moderation' THEN N'awaiting_lecturer'
        WHEN workflow_status = N'changes_requested' THEN N'observer_draft'
        ELSE workflow_status
    END,
    updated_at = sysutcdatetime()
WHERE workflow_status IN (N'awaiting_moderation', N'changes_requested');

IF OBJECT_ID(N'quality.ck_uco_tla_reviews_people_distinct', N'C') IS NOT NULL
    ALTER TABLE quality.uco_tla_reviews DROP CONSTRAINT ck_uco_tla_reviews_people_distinct;

ALTER TABLE quality.uco_tla_reviews ALTER COLUMN moderator_staff_id uniqueidentifier NULL;

IF OBJECT_ID(N'quality.ck_uco_tla_reviews_people_distinct', N'C') IS NULL
    ALTER TABLE quality.uco_tla_reviews ADD CONSTRAINT ck_uco_tla_reviews_people_distinct CHECK (
        lecturer_staff_id <> observer_staff_id
        AND (moderator_staff_id IS NULL OR (
            lecturer_staff_id <> moderator_staff_id AND observer_staff_id <> moderator_staff_id
        ))
    );

IF OBJECT_ID(N'quality.ck_uco_tla_reviews_status', N'C') IS NOT NULL
    ALTER TABLE quality.uco_tla_reviews DROP CONSTRAINT ck_uco_tla_reviews_status;

IF OBJECT_ID(N'quality.ck_uco_tla_reviews_status', N'C') IS NULL
    ALTER TABLE quality.uco_tla_reviews ADD CONSTRAINT ck_uco_tla_reviews_status CHECK (
        workflow_status IN (N'observer_draft', N'awaiting_lecturer', N'awaiting_finalisation', N'completed', N'archived')
    );

IF OBJECT_ID(N'quality.uco_tla_section_progress', N'U') IS NULL
BEGIN
    CREATE TABLE quality.uco_tla_section_progress (
        review_record_id uniqueidentifier NOT NULL,
        section_key nvarchar(60) NOT NULL,
        is_complete bit NOT NULL CONSTRAINT df_uco_tla_section_progress_complete DEFAULT 0,
        completed_at datetimeoffset NULL,
        completed_by_user_account_id uniqueidentifier NULL,
        updated_at datetimeoffset NOT NULL CONSTRAINT df_uco_tla_section_progress_updated DEFAULT sysutcdatetime(),
        row_version rowversion NOT NULL,
        CONSTRAINT pk_uco_tla_section_progress PRIMARY KEY (review_record_id, section_key),
        CONSTRAINT fk_uco_tla_section_progress_review FOREIGN KEY (review_record_id)
            REFERENCES quality.uco_tla_reviews(record_id),
        CONSTRAINT fk_uco_tla_section_progress_user FOREIGN KEY (completed_by_user_account_id)
            REFERENCES auth.user_accounts(id),
        CONSTRAINT ck_uco_tla_section_progress_key CHECK (section_key IN (
            N'session_details', N'teaching_learning_activities', N'delivery_facilitation',
            N'learning_materials', N'findings', N'action_plan', N'discussion_follow_up'
        )),
        CONSTRAINT ck_uco_tla_section_progress_completion CHECK (
            (is_complete = 0 AND completed_at IS NULL AND completed_by_user_account_id IS NULL)
            OR (is_complete = 1 AND completed_at IS NOT NULL AND completed_by_user_account_id IS NOT NULL)
        )
    );
END;

UPDATE auth.permissions
SET name = N'Manage UCO TLA Reviews',
    description = N'Create, manage, report on and export UCO Teaching, Learning and Assessment Reviews.'
WHERE permission_key = N'uco_tla.manage';

UPDATE auth.roles
SET description = N'Coordinates UCO Teaching, Learning and Assessment Reviews without broader faculty permissions.'
WHERE role_key = N'uco_teaching_learning';

UPDATE core.modules
SET description = N'Teaching, Learning and Assessment Reviews for University Centre Oldham.'
WHERE module_key = N'uco_tla_reviews';

COMMIT TRANSACTION;
GO
