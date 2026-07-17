SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO

/*
    Coaching and Mentoring V2

    Existing coaching sessions in the pre-launch environment are confirmed test
    data. Clear those transactional records while preserving staff, coach
    assignments, permissions, lookups and all non-coaching records.
*/
DECLARE @coaching_records TABLE (id uniqueidentifier PRIMARY KEY);
DECLARE @coaching_actions TABLE (id uniqueidentifier PRIMARY KEY);

INSERT INTO @coaching_records (id)
SELECT id
FROM core.records
WHERE record_type = N'coaching_session';

INSERT INTO @coaching_actions (id)
SELECT action_row.id
FROM quality.actions action_row
WHERE action_row.source_form_type = N'coaching_mentoring'
   OR action_row.source_record_id IN (SELECT id FROM @coaching_records);

DELETE FROM ops.notifications
WHERE related_action_id IN (SELECT id FROM @coaching_actions)
   OR record_id IN (SELECT id FROM @coaching_records);

UPDATE evidence.evidence_items
SET related_action_id = NULL
WHERE related_action_id IN (SELECT id FROM @coaching_actions);

UPDATE evidence.evidence_items
SET related_record_id = NULL
WHERE related_record_id IN (SELECT id FROM @coaching_records);

DELETE FROM evidence.file_attachments
WHERE record_id IN (SELECT id FROM @coaching_records);

DELETE FROM quality.action_extensions
WHERE action_id IN (SELECT id FROM @coaching_actions);

IF OBJECT_ID(N'quality.coaching_previous_action_updates', N'U') IS NOT NULL
    DELETE FROM quality.coaching_previous_action_updates;

DELETE FROM quality.actions
WHERE id IN (SELECT id FROM @coaching_actions);

DELETE FROM ops.audit_logs
WHERE record_id IN (SELECT id FROM @coaching_records)
   OR (entity_name = N'coaching_session');

DELETE FROM quality.coaching_sessions;
DELETE FROM quality.coaching_cycles;
DELETE FROM core.records
WHERE id IN (SELECT id FROM @coaching_records);
GO

IF COL_LENGTH(N'quality.coaching_sessions', N'primary_focus_lookup_value_id') IS NULL
    ALTER TABLE quality.coaching_sessions ADD primary_focus_lookup_value_id uniqueidentifier NULL;
GO

IF COL_LENGTH(N'quality.coaching_sessions', N'secondary_focus_lookup_value_id') IS NULL
    ALTER TABLE quality.coaching_sessions ADD secondary_focus_lookup_value_id uniqueidentifier NULL;
GO

IF COL_LENGTH(N'quality.coaching_sessions', N'focus_other_text') IS NULL
    ALTER TABLE quality.coaching_sessions ADD focus_other_text nvarchar(500) NULL;
GO

IF COL_LENGTH(N'quality.coaching_sessions', N'specific_session_focus') IS NULL
    ALTER TABLE quality.coaching_sessions ADD specific_session_focus nvarchar(1000) NULL;
GO

IF COL_LENGTH(N'quality.coaching_sessions', N'current_practice_descriptor_id') IS NULL
    ALTER TABLE quality.coaching_sessions ADD current_practice_descriptor_id uniqueidentifier NULL;
GO

IF COL_LENGTH(N'quality.coaching_sessions', N'current_practice_wording_snapshot') IS NULL
    ALTER TABLE quality.coaching_sessions ADD current_practice_wording_snapshot nvarchar(200) NULL;
GO

IF COL_LENGTH(N'quality.coaching_sessions', N'current_practice_hidden_score') IS NULL
    ALTER TABLE quality.coaching_sessions ADD current_practice_hidden_score tinyint NULL;
GO

IF COL_LENGTH(N'quality.coaching_sessions', N'current_practice_evidence') IS NULL
    ALTER TABLE quality.coaching_sessions ADD current_practice_evidence nvarchar(max) NULL;
GO

IF COL_LENGTH(N'quality.coaching_sessions', N'conversation_summary') IS NULL
    ALTER TABLE quality.coaching_sessions ADD conversation_summary nvarchar(max) NULL;
GO

IF COL_LENGTH(N'quality.coaching_sessions', N'support_other_text') IS NULL
    ALTER TABLE quality.coaching_sessions ADD support_other_text nvarchar(500) NULL;
GO

IF COL_LENGTH(N'quality.coaching_sessions', N'closes_cycle') IS NULL
    ALTER TABLE quality.coaching_sessions ADD closes_cycle bit NOT NULL
        CONSTRAINT df_coaching_sessions_closes_cycle DEFAULT 0 WITH VALUES;
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'fk_coaching_sessions_primary_focus')
    ALTER TABLE quality.coaching_sessions ADD CONSTRAINT fk_coaching_sessions_primary_focus
        FOREIGN KEY (primary_focus_lookup_value_id) REFERENCES core.lookup_values(id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'fk_coaching_sessions_secondary_focus')
    ALTER TABLE quality.coaching_sessions ADD CONSTRAINT fk_coaching_sessions_secondary_focus
        FOREIGN KEY (secondary_focus_lookup_value_id) REFERENCES core.lookup_values(id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'fk_coaching_sessions_current_practice')
    ALTER TABLE quality.coaching_sessions ADD CONSTRAINT fk_coaching_sessions_current_practice
        FOREIGN KEY (current_practice_descriptor_id) REFERENCES quality.elevate_practice_rubric_descriptors(id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'ck_coaching_sessions_current_practice_score')
    ALTER TABLE quality.coaching_sessions ADD CONSTRAINT ck_coaching_sessions_current_practice_score
        CHECK (current_practice_hidden_score IS NULL OR current_practice_hidden_score BETWEEN 1 AND 5);
GO

IF COL_LENGTH(N'quality.actions', N'progress_status') IS NULL
    ALTER TABLE quality.actions ADD progress_status nvarchar(20) NULL;
GO

IF COL_LENGTH(N'quality.actions', N'intended_evidence') IS NULL
    ALTER TABLE quality.actions ADD intended_evidence nvarchar(max) NULL;
GO

IF COL_LENGTH(N'quality.actions', N'intended_impact') IS NULL
    ALTER TABLE quality.actions ADD intended_impact nvarchar(max) NULL;
GO

IF COL_LENGTH(N'quality.actions', N'review_date') IS NULL
    ALTER TABLE quality.actions ADD review_date date NULL;
GO

IF COL_LENGTH(N'quality.actions', N'parent_action_id') IS NULL
    ALTER TABLE quality.actions ADD parent_action_id uniqueidentifier NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'fk_actions_parent')
    ALTER TABLE quality.actions ADD CONSTRAINT fk_actions_parent
        FOREIGN KEY (parent_action_id) REFERENCES quality.actions(id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'ck_actions_progress_status')
    ALTER TABLE quality.actions ADD CONSTRAINT ck_actions_progress_status
        CHECK (progress_status IS NULL OR progress_status IN (N'not_started', N'in_progress', N'completed', N'closed'));
GO

IF OBJECT_ID(N'quality.coaching_action_reviews', N'U') IS NULL
BEGIN
    CREATE TABLE quality.coaching_action_reviews (
        id uniqueidentifier NOT NULL CONSTRAINT pk_coaching_action_reviews PRIMARY KEY DEFAULT newsequentialid(),
        session_id uniqueidentifier NOT NULL,
        action_id uniqueidentifier NOT NULL,
        review_outcome nvarchar(30) NULL,
        progress_update nvarchar(max) NULL,
        impact_observed nvarchar(max) NULL,
        revised_action_id uniqueidentifier NULL,
        created_by_user_account_id uniqueidentifier NULL,
        updated_by_user_account_id uniqueidentifier NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_coaching_action_reviews_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT fk_coaching_action_reviews_session FOREIGN KEY (session_id) REFERENCES quality.coaching_sessions(id),
        CONSTRAINT fk_coaching_action_reviews_action FOREIGN KEY (action_id) REFERENCES quality.actions(id),
        CONSTRAINT fk_coaching_action_reviews_revised_action FOREIGN KEY (revised_action_id) REFERENCES quality.actions(id),
        CONSTRAINT fk_coaching_action_reviews_created_by FOREIGN KEY (created_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT fk_coaching_action_reviews_updated_by FOREIGN KEY (updated_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT uq_coaching_action_reviews_session_action UNIQUE (session_id, action_id),
        CONSTRAINT ck_coaching_action_reviews_outcome CHECK (
            review_outcome IS NULL OR review_outcome IN (N'completed', N'continue', N'revised', N'closed_without_completion')
        )
    );
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'quality.coaching_action_reviews')
      AND name = N'ix_coaching_action_reviews_action'
)
    CREATE INDEX ix_coaching_action_reviews_action
        ON quality.coaching_action_reviews(action_id, created_at DESC)
        INCLUDE (session_id, review_outcome, revised_action_id);
GO

IF OBJECT_ID(N'quality.coaching_configuration', N'U') IS NULL
BEGIN
    CREATE TABLE quality.coaching_configuration (
        configuration_id tinyint NOT NULL CONSTRAINT pk_coaching_configuration PRIMARY KEY,
        max_actions_per_session int NOT NULL CONSTRAINT df_coaching_configuration_max_actions DEFAULT 3,
        updated_by_user_account_id uniqueidentifier NULL,
        updated_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT ck_coaching_configuration_singleton CHECK (configuration_id = 1),
        CONSTRAINT ck_coaching_configuration_max_actions CHECK (max_actions_per_session BETWEEN 1 AND 10),
        CONSTRAINT fk_coaching_configuration_updated_by FOREIGN KEY (updated_by_user_account_id) REFERENCES auth.user_accounts(id)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM quality.coaching_configuration WHERE configuration_id = 1)
    INSERT INTO quality.coaching_configuration (configuration_id, max_actions_per_session) VALUES (1, 3);
GO

DECLARE @focusLookupId uniqueidentifier = (
    SELECT id FROM core.lookup_types WHERE lookup_key = N'coaching_focus_area'
);

UPDATE core.lookup_values
SET display_name = CASE value_key
        WHEN N'assessment' THEN N'Assessment and feedback'
        WHEN N'digital' THEN N'Digital practice'
        WHEN N'confidence' THEN N'Professional confidence'
        WHEN N'career' THEN N'Career development'
        ELSE display_name
    END
WHERE lookup_type_id = @focusLookupId
  AND value_key IN (N'assessment', N'digital', N'confidence', N'career');

IF NOT EXISTS (
    SELECT 1 FROM core.lookup_values
    WHERE lookup_type_id = @focusLookupId AND value_key = N'other'
)
    INSERT INTO core.lookup_values (id, lookup_type_id, value_key, display_name, display_order)
    VALUES ('13200000-0000-0000-0000-000000000011', @focusLookupId, N'other', N'Other', 11);
GO

UPDATE core.lookup_types
SET name = N'Coaching qualification statuses',
    description = N'Admin-managed qualification statuses available on Coaching and Mentoring sessions.'
WHERE lookup_key = N'coaching_development_stage';
GO

UPDATE core.admin_managed_lists
SET description = N'Qualification statuses available on Coaching and Mentoring sessions.'
WHERE lookup_type_id = (
    SELECT id FROM core.lookup_types WHERE lookup_key = N'coaching_development_stage'
);
GO

UPDATE core.lookup_usage_registry
SET display_name = N'Coaching qualification status'
WHERE lookup_type_id = (
    SELECT id FROM core.lookup_types WHERE lookup_key = N'coaching_development_stage'
);
GO

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'ck_coaching_sessions_type')
    ALTER TABLE quality.coaching_sessions DROP CONSTRAINT ck_coaching_sessions_type;
GO

ALTER TABLE quality.coaching_sessions ADD CONSTRAINT ck_coaching_sessions_type
    CHECK (session_type IN (N'coaching', N'mentoring'));
GO

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'ck_coaching_cycles_type')
    ALTER TABLE quality.coaching_cycles DROP CONSTRAINT ck_coaching_cycles_type;
GO

ALTER TABLE quality.coaching_cycles ADD CONSTRAINT ck_coaching_cycles_type
    CHECK (cycle_type IN (N'coaching', N'mentoring'));
GO
