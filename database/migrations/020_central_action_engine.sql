SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO

IF COL_LENGTH('quality.actions', 'source_form_type') IS NULL
    ALTER TABLE quality.actions ADD source_form_type nvarchar(100) NULL;
GO

IF COL_LENGTH('quality.actions', 'source_sub_record_type') IS NULL
    ALTER TABLE quality.actions ADD source_sub_record_type nvarchar(100) NULL;
GO

IF COL_LENGTH('quality.actions', 'source_sub_record_id') IS NULL
    ALTER TABLE quality.actions ADD source_sub_record_id uniqueidentifier NULL;
GO

IF COL_LENGTH('quality.actions', 'source_sub_record_key') IS NULL
    ALTER TABLE quality.actions ADD source_sub_record_key nvarchar(100) NULL;
GO

IF COL_LENGTH('quality.actions', 'source_display_order') IS NULL
    ALTER TABLE quality.actions ADD source_display_order int NULL;
GO

IF COL_LENGTH('quality.actions', 'owner_context') IS NULL
    ALTER TABLE quality.actions ADD owner_context nvarchar(30) NULL;
GO

IF COL_LENGTH('quality.actions', 'original_due_date') IS NULL
    ALTER TABLE quality.actions ADD original_due_date date NULL;
GO

IF COL_LENGTH('quality.actions', 'revised_due_date') IS NULL
    ALTER TABLE quality.actions ADD revised_due_date date NULL;
GO

IF COL_LENGTH('quality.actions', 'visibility_setting') IS NULL
    ALTER TABLE quality.actions ADD visibility_setting nvarchar(30) NOT NULL
        CONSTRAINT df_actions_visibility DEFAULT N'staff_and_management' WITH VALUES;
GO

IF COL_LENGTH('quality.actions', 'cancelled_at') IS NULL
    ALTER TABLE quality.actions ADD cancelled_at datetimeoffset NULL;
GO

IF COL_LENGTH('quality.actions', 'cancelled_by_user_account_id') IS NULL
    ALTER TABLE quality.actions ADD cancelled_by_user_account_id uniqueidentifier NULL;
GO

IF COL_LENGTH('quality.actions', 'cancellation_comments') IS NULL
    ALTER TABLE quality.actions ADD cancellation_comments nvarchar(max) NULL;
GO

IF COL_LENGTH('quality.actions', 'deleted_by_user_account_id') IS NULL
    ALTER TABLE quality.actions ADD deleted_by_user_account_id uniqueidentifier NULL;
GO

IF COL_LENGTH('quality.actions', 'deletion_reason') IS NULL
    ALTER TABLE quality.actions ADD deletion_reason nvarchar(1000) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'fk_actions_cancelled_by')
    ALTER TABLE quality.actions ADD CONSTRAINT fk_actions_cancelled_by
        FOREIGN KEY (cancelled_by_user_account_id) REFERENCES auth.user_accounts(id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'fk_actions_deleted_by')
    ALTER TABLE quality.actions ADD CONSTRAINT fk_actions_deleted_by
        FOREIGN KEY (deleted_by_user_account_id) REFERENCES auth.user_accounts(id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_actions_visibility')
    ALTER TABLE quality.actions ADD CONSTRAINT ck_actions_visibility CHECK (
        visibility_setting IN (N'owner_only', N'staff_and_management', N'management_only', N'source_editors')
    );
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_actions_source_display_order')
    ALTER TABLE quality.actions ADD CONSTRAINT ck_actions_source_display_order
        CHECK (source_display_order IS NULL OR source_display_order > 0);
GO

DECLARE @actionStatusLookupId uniqueidentifier = (
    SELECT id FROM core.lookup_types WHERE lookup_key = N'action_status' AND archived_at IS NULL
);

IF @actionStatusLookupId IS NOT NULL
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM core.lookup_values
        WHERE lookup_type_id = @actionStatusLookupId AND value_key = N'extended'
    )
        INSERT INTO core.lookup_values (
            id, lookup_type_id, value_key, display_name, display_order, color_hex, notes
        ) VALUES (
            '12000000-0000-0000-0000-000000000006', @actionStatusLookupId,
            N'extended', N'Extended', 3, N'#B45309', N'The implementation date has been formally extended.'
        );

    IF NOT EXISTS (
        SELECT 1 FROM core.lookup_values
        WHERE lookup_type_id = @actionStatusLookupId AND value_key = N'cancelled'
    )
        INSERT INTO core.lookup_values (
            id, lookup_type_id, value_key, display_name, display_order, color_hex, notes
        ) VALUES (
            '12000000-0000-0000-0000-000000000007', @actionStatusLookupId,
            N'cancelled', N'Cancelled', 4, N'#64748B', N'The action was cancelled with an audit reason.'
        );

    UPDATE core.lookup_values
    SET display_name = N'Completed', display_order = 2, is_active = 1, archived_at = NULL
    WHERE lookup_type_id = @actionStatusLookupId AND value_key = N'complete';

    UPDATE core.lookup_values
    SET display_order = CASE value_key WHEN N'open' THEN 1 WHEN N'extended' THEN 3 WHEN N'cancelled' THEN 4 ELSE display_order END,
        is_active = CASE WHEN value_key IN (N'open', N'complete', N'extended', N'cancelled') THEN 1 ELSE 0 END
    WHERE lookup_type_id = @actionStatusLookupId;

    DECLARE @openStatusId uniqueidentifier = (
        SELECT id FROM core.lookup_values WHERE lookup_type_id = @actionStatusLookupId AND value_key = N'open'
    );
    DECLARE @cancelledStatusId uniqueidentifier = (
        SELECT id FROM core.lookup_values WHERE lookup_type_id = @actionStatusLookupId AND value_key = N'cancelled'
    );

    UPDATE action_row
    SET status_lookup_value_id = CASE
            WHEN old_status.value_key = N'not_applicable' THEN @cancelledStatusId
            ELSE @openStatusId
        END,
        cancelled_at = CASE WHEN old_status.value_key = N'not_applicable' THEN COALESCE(action_row.updated_at, action_row.created_at) ELSE action_row.cancelled_at END,
        cancellation_comments = CASE WHEN old_status.value_key = N'not_applicable' THEN COALESCE(action_row.cancellation_comments, N'Migrated from Not Applicable status.') ELSE action_row.cancellation_comments END
    FROM quality.actions action_row
    JOIN core.lookup_values old_status ON old_status.id = action_row.status_lookup_value_id
    WHERE old_status.lookup_type_id = @actionStatusLookupId
      AND old_status.value_key IN (N'in_progress', N'overdue', N'not_applicable');
END;
GO

UPDATE action_row
SET source_form_type = COALESCE(action_row.source_form_type, record_row.record_type, N'standalone'),
    original_due_date = COALESCE(action_row.original_due_date, action_row.due_date),
    visibility_setting = CASE
        WHEN action_row.visibility_setting IS NULL OR action_row.visibility_setting = N''
            THEN CASE WHEN action_row.published_to_staff = 1 THEN N'staff_and_management' ELSE N'source_editors' END
        WHEN action_row.published_to_staff = 0 AND action_row.visibility_setting = N'staff_and_management'
            THEN N'source_editors'
        ELSE action_row.visibility_setting
    END
FROM quality.actions action_row
LEFT JOIN core.records record_row ON record_row.id = action_row.source_record_id;
GO

UPDATE quality.actions
SET source_form_type = CASE source_form_type
    WHEN N'elevate_practice_assessment' THEN N'elevate_practice'
    WHEN N'learning_environment' THEN N'elevate_environment'
    WHEN N'liv_record' THEN N'liv'
    ELSE source_form_type
END;
GO

IF COL_LENGTH('quality.actions', 'liv_visit_id') IS NOT NULL
BEGIN
    UPDATE quality.actions
    SET source_sub_record_type = COALESCE(source_sub_record_type, N'liv_visit'),
        source_sub_record_id = COALESCE(source_sub_record_id, liv_visit_id),
        source_form_type = COALESCE(source_form_type, N'liv')
    WHERE liv_visit_id IS NOT NULL;
END;
GO

IF OBJECT_ID('quality.action_extensions', 'U') IS NOT NULL
BEGIN
    ;WITH latest_extension AS (
        SELECT action_id, extended_due_date,
               ROW_NUMBER() OVER (PARTITION BY action_id ORDER BY created_at DESC, id DESC) AS row_number
        FROM quality.action_extensions
    )
    UPDATE action_row
    SET revised_due_date = latest.extended_due_date,
        due_date = latest.extended_due_date
    FROM quality.actions action_row
    JOIN latest_extension latest ON latest.action_id = action_row.id AND latest.row_number = 1;
END;
GO

IF OBJECT_ID('quality.coaching_session_actions', 'U') IS NOT NULL
BEGIN
    DECLARE @openStatusId uniqueidentifier = (
        SELECT TOP (1) value.id
        FROM core.lookup_values value
        JOIN core.lookup_types type ON type.id = value.lookup_type_id
        WHERE type.lookup_key = N'action_status' AND value.value_key = N'open'
    );
    DECLARE @mediumPriorityId uniqueidentifier = (
        SELECT TOP (1) value.id
        FROM core.lookup_values value
        JOIN core.lookup_types type ON type.id = value.lookup_type_id
        WHERE type.lookup_key = N'priority' AND value.value_key = N'medium'
    );

    INSERT INTO quality.actions (
        id, source_record_id, source_form_type, source_sub_record_type, source_sub_record_id,
        source_display_order, owner_context, subject_staff_id, owner_staff_id, title, detail,
        priority_lookup_value_id, status_lookup_value_id, due_date, original_due_date,
        published_to_staff, visibility_setting, created_by_user_account_id, created_at, updated_at,
        archived_at
    )
    SELECT session_action.id,
           session.record_id,
           N'coaching_mentoring',
           N'coaching_session',
           session.id,
           session_action.action_order,
           session_action.owner_type,
           session.staff_id,
           CASE WHEN session_action.owner_type = N'coach' THEN session.coach_staff_id ELSE session.staff_id END,
           LEFT(session_action.action_text, 300),
           CASE
               WHEN session_action.owner_type = N'joint' AND NULLIF(LTRIM(RTRIM(session_action.evidence_text)), N'') IS NOT NULL
                   THEN CONCAT(N'Joint action. Evidence: ', session_action.evidence_text)
               WHEN session_action.owner_type = N'joint' THEN N'Joint action.'
               WHEN NULLIF(LTRIM(RTRIM(session_action.evidence_text)), N'') IS NOT NULL
                   THEN CONCAT(N'Evidence: ', session_action.evidence_text)
               ELSE NULL
           END,
           @mediumPriorityId,
           @openStatusId,
           session_action.target_date,
           session_action.target_date,
           CASE WHEN session.status = N'completed' THEN 1 ELSE 0 END,
           CASE WHEN session.status = N'completed' THEN N'staff_and_management' ELSE N'source_editors' END,
           session.created_by_user_account_id,
           session_action.created_at,
           session_action.updated_at,
           session_action.archived_at
    FROM quality.coaching_session_actions session_action
    JOIN quality.coaching_sessions session ON session.id = session_action.session_id
    WHERE session_action.action_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM quality.actions existing WHERE existing.id = session_action.id);

    UPDATE session_action
    SET action_id = session_action.id
    FROM quality.coaching_session_actions session_action
    WHERE session_action.action_id IS NULL
      AND EXISTS (SELECT 1 FROM quality.actions existing WHERE existing.id = session_action.id);

    UPDATE action_row
    SET source_record_id = COALESCE(action_row.source_record_id, session.record_id),
        source_form_type = N'coaching_mentoring',
        source_sub_record_type = N'coaching_session',
        source_sub_record_id = session.id,
        source_display_order = session_action.action_order,
        owner_context = session_action.owner_type,
        subject_staff_id = COALESCE(action_row.subject_staff_id, session.staff_id),
        original_due_date = COALESCE(action_row.original_due_date, session_action.target_date),
        visibility_setting = CASE WHEN session.status = N'completed' THEN N'staff_and_management' ELSE N'source_editors' END,
        published_to_staff = CASE WHEN session.status = N'completed' THEN 1 ELSE 0 END
    FROM quality.actions action_row
    JOIN quality.coaching_session_actions session_action ON session_action.action_id = action_row.id
    JOIN quality.coaching_sessions session ON session.id = session_action.session_id;

    DROP TABLE quality.coaching_session_actions;
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID('quality.actions') AND name = 'ix_actions_source_provenance'
)
    CREATE INDEX ix_actions_source_provenance
        ON quality.actions(source_form_type, source_record_id, source_sub_record_type, source_sub_record_id)
        INCLUDE (subject_staff_id, owner_staff_id, status_lookup_value_id, due_date, archived_at);
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID('quality.actions') AND name = 'ix_actions_subject_status'
)
    CREATE INDEX ix_actions_subject_status
        ON quality.actions(subject_staff_id, status_lookup_value_id, due_date)
        INCLUDE (owner_staff_id, source_form_type, archived_at);
GO
