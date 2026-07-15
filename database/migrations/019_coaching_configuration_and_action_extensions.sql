SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO

DECLARE @developmentStageLookupId uniqueidentifier = (
    SELECT id FROM core.lookup_types WHERE lookup_key = N'coaching_development_stage'
);

IF @developmentStageLookupId IS NULL
BEGIN
    SET @developmentStageLookupId = '13000000-0000-0000-0000-000000000001';
    INSERT INTO core.lookup_types (id, lookup_key, name, description, is_system)
    VALUES (
        @developmentStageLookupId,
        N'coaching_development_stage',
        N'Coaching staff development stages',
        N'Admin-managed development stages available on Coaching and Mentoring records.',
        0
    );
END;

INSERT INTO core.lookup_values (id, lookup_type_id, value_key, display_name, display_order)
SELECT seed.id, @developmentStageLookupId, seed.value_key, seed.display_name, seed.display_order
FROM (VALUES
    (CONVERT(uniqueidentifier, '13100000-0000-0000-0000-000000000001'), N'pre_trainee', N'Pre-trainee', 1),
    (CONVERT(uniqueidentifier, '13100000-0000-0000-0000-000000000002'), N'trainee', N'Trainee', 2),
    (CONVERT(uniqueidentifier, '13100000-0000-0000-0000-000000000003'), N'qualified', N'Qualified', 3)
) seed(id, value_key, display_name, display_order)
WHERE NOT EXISTS (
    SELECT 1 FROM core.lookup_values existing
    WHERE existing.lookup_type_id = @developmentStageLookupId
      AND existing.value_key = seed.value_key
);
GO

DECLARE @focusLookupId uniqueidentifier = (
    SELECT id FROM core.lookup_types WHERE lookup_key = N'coaching_focus_area'
);

IF @focusLookupId IS NULL
BEGIN
    SET @focusLookupId = '13000000-0000-0000-0000-000000000002';
    INSERT INTO core.lookup_types (id, lookup_key, name, description, is_system)
    VALUES (
        @focusLookupId,
        N'coaching_focus_area',
        N'Coaching focus areas',
        N'Admin-managed focus checklist for Coaching and Mentoring records.',
        0
    );
END;

INSERT INTO core.lookup_values (id, lookup_type_id, value_key, display_name, display_order)
SELECT seed.id, @focusLookupId, seed.value_key, seed.display_name, seed.display_order
FROM (VALUES
    (CONVERT(uniqueidentifier, '13200000-0000-0000-0000-000000000001'), N'teaching_learning', N'Teaching and learning', 1),
    (CONVERT(uniqueidentifier, '13200000-0000-0000-0000-000000000002'), N'assessment', N'Assessment', 2),
    (CONVERT(uniqueidentifier, '13200000-0000-0000-0000-000000000003'), N'engagement', N'Engagement', 3),
    (CONVERT(uniqueidentifier, '13200000-0000-0000-0000-000000000004'), N'inclusion', N'Inclusion', 4),
    (CONVERT(uniqueidentifier, '13200000-0000-0000-0000-000000000005'), N'behaviour', N'Behaviour', 5),
    (CONVERT(uniqueidentifier, '13200000-0000-0000-0000-000000000006'), N'digital', N'Digital', 6),
    (CONVERT(uniqueidentifier, '13200000-0000-0000-0000-000000000007'), N'subject_practice', N'Subject practice', 7),
    (CONVERT(uniqueidentifier, '13200000-0000-0000-0000-000000000008'), N'confidence', N'Confidence', 8),
    (CONVERT(uniqueidentifier, '13200000-0000-0000-0000-000000000009'), N'leadership', N'Leadership', 9),
    (CONVERT(uniqueidentifier, '13200000-0000-0000-0000-000000000010'), N'career', N'Career', 10)
) seed(id, value_key, display_name, display_order)
WHERE NOT EXISTS (
    SELECT 1 FROM core.lookup_values existing
    WHERE existing.lookup_type_id = @focusLookupId
      AND existing.value_key = seed.value_key
);
GO

DECLARE @supportLookupId uniqueidentifier = (
    SELECT id FROM core.lookup_types WHERE lookup_key = N'coaching_support_type'
);

IF @supportLookupId IS NULL
BEGIN
    SET @supportLookupId = '13000000-0000-0000-0000-000000000003';
    INSERT INTO core.lookup_types (id, lookup_key, name, description, is_system)
    VALUES (
        @supportLookupId,
        N'coaching_support_type',
        N'Coaching support types',
        N'Admin-managed support checklist retained beneath Mentor Comments.',
        0
    );
END;

INSERT INTO core.lookup_values (id, lookup_type_id, value_key, display_name, display_order)
SELECT seed.id, @supportLookupId, seed.value_key, seed.display_name, seed.display_order
FROM (VALUES
    (CONVERT(uniqueidentifier, '13300000-0000-0000-0000-000000000001'), N'reflective_questioning', N'Reflective questioning', 1),
    (CONVERT(uniqueidentifier, '13300000-0000-0000-0000-000000000002'), N'advice_guidance', N'Advice or guidance', 2),
    (CONVERT(uniqueidentifier, '13300000-0000-0000-0000-000000000003'), N'modelling_demonstration', N'Modelling or demonstration', 3),
    (CONVERT(uniqueidentifier, '13300000-0000-0000-0000-000000000004'), N'resource_sharing', N'Resource sharing', 4),
    (CONVERT(uniqueidentifier, '13300000-0000-0000-0000-000000000005'), N'joint_planning', N'Joint planning', 5),
    (CONVERT(uniqueidentifier, '13300000-0000-0000-0000-000000000006'), N'observation', N'Observation', 6),
    (CONVERT(uniqueidentifier, '13300000-0000-0000-0000-000000000007'), N'feedback', N'Feedback', 7),
    (CONVERT(uniqueidentifier, '13300000-0000-0000-0000-000000000008'), N'cpd_signposting', N'CPD signposting', 8),
    (CONVERT(uniqueidentifier, '13300000-0000-0000-0000-000000000009'), N'technology_support', N'Technology support', 9),
    (CONVERT(uniqueidentifier, '13300000-0000-0000-0000-000000000010'), N'professional_guidance', N'Professional guidance', 10),
    (CONVERT(uniqueidentifier, '13300000-0000-0000-0000-000000000011'), N'other', N'Other', 11)
) seed(id, value_key, display_name, display_order)
WHERE NOT EXISTS (
    SELECT 1 FROM core.lookup_values existing
    WHERE existing.lookup_type_id = @supportLookupId
      AND existing.value_key = seed.value_key
);
GO

IF COL_LENGTH('quality.coaching_sessions', 'development_stage_lookup_value_id') IS NULL
    ALTER TABLE quality.coaching_sessions ADD development_stage_lookup_value_id uniqueidentifier NULL;
GO

IF COL_LENGTH('quality.coaching_sessions', 'focus_area_keys_json') IS NULL
    ALTER TABLE quality.coaching_sessions ADD focus_area_keys_json nvarchar(max) NULL;
GO

IF COL_LENGTH('quality.coaching_sessions', 'additional_focus_text') IS NULL
    ALTER TABLE quality.coaching_sessions ADD additional_focus_text nvarchar(max) NULL;
GO

IF COL_LENGTH('quality.coaching_sessions', 'intended_impact_text') IS NULL
    ALTER TABLE quality.coaching_sessions ADD intended_impact_text nvarchar(max) NULL;
GO

IF COL_LENGTH('quality.coaching_sessions', 'intended_impact_descriptor_id') IS NULL
    ALTER TABLE quality.coaching_sessions ADD intended_impact_descriptor_id uniqueidentifier NULL;
GO

IF COL_LENGTH('quality.coaching_sessions', 'intended_impact_wording_snapshot') IS NULL
    ALTER TABLE quality.coaching_sessions ADD intended_impact_wording_snapshot nvarchar(200) NULL;
GO

IF COL_LENGTH('quality.coaching_sessions', 'intended_impact_hidden_score') IS NULL
    ALTER TABLE quality.coaching_sessions ADD intended_impact_hidden_score tinyint NULL;
GO

IF COL_LENGTH('quality.coaching_sessions', 'mentor_comments') IS NULL
    ALTER TABLE quality.coaching_sessions ADD mentor_comments nvarchar(max) NULL;
GO

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_coaching_sessions_duration')
    ALTER TABLE quality.coaching_sessions DROP CONSTRAINT ck_coaching_sessions_duration;
GO

ALTER TABLE quality.coaching_sessions
    ADD CONSTRAINT ck_coaching_sessions_duration
    CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 1440);
GO

UPDATE quality.coaching_sessions
SET intended_impact_text = why_this_matters
WHERE intended_impact_text IS NULL
  AND why_this_matters IS NOT NULL;
GO

UPDATE session
SET intended_impact_descriptor_id = descriptor.id,
    intended_impact_wording_snapshot = descriptor.visible_wording,
    intended_impact_hidden_score = descriptor.hidden_numeric_value
FROM quality.coaching_sessions session
JOIN quality.elevate_practice_frameworks framework
    ON framework.is_active = 1 AND framework.archived_at IS NULL
JOIN quality.elevate_practice_rubric_descriptors descriptor
    ON descriptor.framework_id = framework.id
   AND descriptor.hidden_numeric_value = session.confidence_before
   AND descriptor.archived_at IS NULL
WHERE session.intended_impact_descriptor_id IS NULL
  AND session.confidence_before IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'fk_coaching_sessions_development_stage')
    ALTER TABLE quality.coaching_sessions
        ADD CONSTRAINT fk_coaching_sessions_development_stage
        FOREIGN KEY (development_stage_lookup_value_id) REFERENCES core.lookup_values(id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'fk_coaching_sessions_intended_impact_descriptor')
    ALTER TABLE quality.coaching_sessions
        ADD CONSTRAINT fk_coaching_sessions_intended_impact_descriptor
        FOREIGN KEY (intended_impact_descriptor_id) REFERENCES quality.elevate_practice_rubric_descriptors(id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_coaching_sessions_focus_area_json')
    ALTER TABLE quality.coaching_sessions
        ADD CONSTRAINT ck_coaching_sessions_focus_area_json
        CHECK (focus_area_keys_json IS NULL OR ISJSON(focus_area_keys_json) = 1);
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_coaching_sessions_intended_impact_score')
    ALTER TABLE quality.coaching_sessions
        ADD CONSTRAINT ck_coaching_sessions_intended_impact_score
        CHECK (intended_impact_hidden_score IS NULL OR intended_impact_hidden_score BETWEEN 1 AND 5);
GO

IF OBJECT_ID('quality.action_extensions', 'U') IS NULL
BEGIN
    CREATE TABLE quality.action_extensions (
        id uniqueidentifier NOT NULL CONSTRAINT pk_action_extensions PRIMARY KEY DEFAULT newsequentialid(),
        action_id uniqueidentifier NOT NULL,
        previous_due_date date NOT NULL,
        extended_due_date date NOT NULL,
        reason nvarchar(1000) NOT NULL,
        created_by_user_account_id uniqueidentifier NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_action_extensions_created DEFAULT sysutcdatetime(),
        row_version rowversion NOT NULL,
        CONSTRAINT fk_action_extensions_action FOREIGN KEY (action_id) REFERENCES quality.actions(id),
        CONSTRAINT fk_action_extensions_created_by FOREIGN KEY (created_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT ck_action_extensions_dates CHECK (extended_due_date > previous_due_date),
        CONSTRAINT ck_action_extensions_reason CHECK (LEN(LTRIM(RTRIM(reason))) > 0)
    );
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID('quality.action_extensions')
      AND name = 'ix_action_extensions_action_created'
)
    CREATE INDEX ix_action_extensions_action_created
        ON quality.action_extensions(action_id, created_at DESC)
        INCLUDE (previous_due_date, extended_due_date, reason);
GO
