SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO

-- Product language changes without changing stable module or permission keys.
UPDATE core.modules
SET name = N'Elevate Learning and Innovation',
    description = N'Annual staff self-assessment and LIV preparation.'
WHERE module_key = N'elevate_practice';

UPDATE auth.permissions
SET name = N'Complete Elevate Learning and Innovation',
    category = N'Elevate Learning and Innovation'
WHERE permission_key = N'elevate_practice.submit';

UPDATE quality.elevate_practice_frameworks
SET name = N'Elevate Learning and Innovation Staff Self-Assessment'
WHERE framework_key = N'elevate_your_practice';

UPDATE core.records
SET title = REPLACE(title, N'Elevate Your Practice', N'Elevate Learning and Innovation')
WHERE record_type = N'elevate_practice_assessment'
  AND title LIKE N'%Elevate Your Practice%';

UPDATE quality.actions
SET title = REPLACE(title, N'Elevate Your Practice', N'Elevate Learning and Innovation')
WHERE source_form_type = N'elevate_practice'
  AND title LIKE N'%Elevate Your Practice%';
GO

-- The V2 rubric is one response per section. Historical statement ratings stay
-- in their original table; the backfill gives every historical section one
-- governed descriptor for current reporting.
IF OBJECT_ID('quality.elevate_practice_area_ratings', 'U') IS NULL
BEGIN
    CREATE TABLE quality.elevate_practice_area_ratings (
        assessment_id uniqueidentifier NOT NULL,
        area_id uniqueidentifier NOT NULL,
        descriptor_id uniqueidentifier NOT NULL,
        hidden_numeric_value tinyint NOT NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_elevate_area_ratings_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT pk_elevate_practice_area_ratings PRIMARY KEY (assessment_id, area_id),
        CONSTRAINT fk_elevate_area_ratings_assessment FOREIGN KEY (assessment_id) REFERENCES quality.elevate_practice_assessments(id),
        CONSTRAINT fk_elevate_area_ratings_area FOREIGN KEY (area_id) REFERENCES quality.elevate_practice_areas(id),
        CONSTRAINT fk_elevate_area_ratings_descriptor FOREIGN KEY (descriptor_id) REFERENCES quality.elevate_practice_rubric_descriptors(id),
        CONSTRAINT ck_elevate_area_ratings_value CHECK (hidden_numeric_value BETWEEN 1 AND 5)
    );
END;
GO

;WITH historical AS (
    SELECT rating.assessment_id, statement.area_id,
           CAST(ROUND(AVG(CAST(rating.score AS decimal(9, 4))), 0) AS tinyint) AS hidden_numeric_value
    FROM quality.elevate_practice_ratings rating
    JOIN quality.elevate_practice_statements statement ON statement.id = rating.statement_id
    GROUP BY rating.assessment_id, statement.area_id
)
INSERT INTO quality.elevate_practice_area_ratings (
    assessment_id, area_id, descriptor_id, hidden_numeric_value
)
SELECT historical.assessment_id, historical.area_id, descriptor.id, historical.hidden_numeric_value
FROM historical
JOIN quality.elevate_practice_assessments assessment ON assessment.id = historical.assessment_id
JOIN quality.elevate_practice_rubric_descriptors descriptor
  ON descriptor.framework_id = assessment.framework_id
 AND descriptor.hidden_numeric_value = historical.hidden_numeric_value
WHERE NOT EXISTS (
    SELECT 1 FROM quality.elevate_practice_area_ratings existing
    WHERE existing.assessment_id = historical.assessment_id
      AND existing.area_id = historical.area_id
);
GO

UPDATE descriptor
SET descriptor_key = wording.descriptor_key,
    visible_wording = wording.visible_wording,
    guidance_text = wording.guidance_text,
    display_order = wording.hidden_numeric_value,
    colour_classification = wording.colour_classification,
    colour_hex = wording.colour_hex,
    is_active = 1
FROM quality.elevate_practice_rubric_descriptors descriptor
JOIN (VALUES
    (CAST(1 AS tinyint), N'emerging_practice', N'Emerging Practice', N'Practice is not yet clearly evident or consistently applied.', N'powder_blue_grey', N'#D7E7F3'),
    (CAST(2 AS tinyint), N'developing_practice', N'Developing Practice', N'Practice is evident but remains new, variable or inconsistent.', N'soft_teal', N'#A9DDD2'),
    (CAST(3 AS tinyint), N'secure_practice', N'Secure Practice', N'Practice is usually effective and has a clear positive impact on learners.', N'green', N'#3FAE5A'),
    (CAST(4 AS tinyint), N'strong_practice', N'Strong Practice', N'Practice is consistently effective, embedded and responsive to learners'' needs.', N'dark_green', N'#176B3A'),
    (CAST(5 AS tinyint), N'exceptional_practice', N'Exceptional Practice', N'Practice is sustained, highly effective and shared to support others.', N'blue', N'#1565A8')
) wording(hidden_numeric_value, descriptor_key, visible_wording, guidance_text, colour_classification, colour_hex)
  ON wording.hidden_numeric_value = descriptor.hidden_numeric_value;
GO

-- Governed lists used by ELI and LIV.
DECLARE @noticeTypeId uniqueidentifier = CONVERT(uniqueidentifier, '10000000-0000-0000-0000-000000000011');
DECLARE @focusTypeId uniqueidentifier = CONVERT(uniqueidentifier, '10000000-0000-0000-0000-000000000012');
DECLARE @deliveryTypeId uniqueidentifier = CONVERT(uniqueidentifier, '10000000-0000-0000-0000-000000000013');
DECLARE @opportunityTypeId uniqueidentifier = CONVERT(uniqueidentifier, '10000000-0000-0000-0000-000000000014');

INSERT INTO core.lookup_types (id, lookup_key, name, is_system)
SELECT seed.id, seed.lookup_key, seed.name, 0
FROM (VALUES
    (@noticeTypeId, N'liv_notice_preference', N'LIV Notice Preferences'),
    (@focusTypeId, N'liv_focus_area', N'LIV Focus Areas'),
    (@deliveryTypeId, N'liv_delivery_area', N'LIV Delivery Areas'),
    (@opportunityTypeId, N'liv_development_opportunity', N'LIV Development Opportunities')
) seed(id, lookup_key, name)
WHERE NOT EXISTS (SELECT 1 FROM core.lookup_types existing WHERE existing.lookup_key = seed.lookup_key);

SET @noticeTypeId = (SELECT id FROM core.lookup_types WHERE lookup_key = N'liv_notice_preference');
SET @focusTypeId = (SELECT id FROM core.lookup_types WHERE lookup_key = N'liv_focus_area');
SET @deliveryTypeId = (SELECT id FROM core.lookup_types WHERE lookup_key = N'liv_delivery_area');
SET @opportunityTypeId = (SELECT id FROM core.lookup_types WHERE lookup_key = N'liv_development_opportunity');

INSERT INTO core.lookup_values (id, lookup_type_id, value_key, display_name, display_order)
SELECT seed.id, seed.lookup_type_id, seed.value_key, seed.display_name, seed.display_order
FROM (VALUES
    (CONVERT(uniqueidentifier, '18A00000-0000-0000-0000-000000000001'), @noticeTypeId, N'no_notice', N'No notice', 1),
    (CONVERT(uniqueidentifier, '18A00000-0000-0000-0000-000000000002'), @noticeTypeId, N'hours_24', N'24 hours'' notice', 2),
    (CONVERT(uniqueidentifier, '18A00000-0000-0000-0000-000000000003'), @noticeTypeId, N'week_1', N'1 week''s notice', 3),
    (CONVERT(uniqueidentifier, '18A00000-0000-0000-0000-000000000004'), @noticeTypeId, N'weeks_2', N'2 weeks'' notice', 4),
    (CONVERT(uniqueidentifier, '18A00000-0000-0000-0000-000000000011'), @focusTypeId, N'positive_start', N'Positive Start', 1),
    (CONVERT(uniqueidentifier, '18A00000-0000-0000-0000-000000000012'), @focusTypeId, N'planning_structure', N'Planning and Structure', 2),
    (CONVERT(uniqueidentifier, '18A00000-0000-0000-0000-000000000013'), @focusTypeId, N'delivery', N'Delivery', 3),
    (CONVERT(uniqueidentifier, '18A00000-0000-0000-0000-000000000014'), @focusTypeId, N'assessment', N'Assessment', 4),
    (CONVERT(uniqueidentifier, '18A00000-0000-0000-0000-000000000015'), @focusTypeId, N'feedback', N'Feedback', 5),
    (CONVERT(uniqueidentifier, '18A00000-0000-0000-0000-000000000016'), @focusTypeId, N'inclusion', N'Inclusion', 6),
    (CONVERT(uniqueidentifier, '18A00000-0000-0000-0000-000000000017'), @focusTypeId, N'learner_focus', N'Learner Focus', 7),
    (CONVERT(uniqueidentifier, '18A00000-0000-0000-0000-000000000018'), @focusTypeId, N'digital', N'Digital', 8),
    (CONVERT(uniqueidentifier, '18A00000-0000-0000-0000-000000000019'), @focusTypeId, N'other', N'Other', 9),
    (CONVERT(uniqueidentifier, '18A00000-0000-0000-0000-000000000021'), @deliveryTypeId, N'epyp', N'EPYP', 1),
    (CONVERT(uniqueidentifier, '18A00000-0000-0000-0000-000000000022'), @deliveryTypeId, N'adult_part_time', N'Adult part time', 2),
    (CONVERT(uniqueidentifier, '18A00000-0000-0000-0000-000000000023'), @deliveryTypeId, N'adult_full_time', N'Adult full time', 3),
    (CONVERT(uniqueidentifier, '18A00000-0000-0000-0000-000000000024'), @deliveryTypeId, N'wbl', N'WBL', 4),
    (CONVERT(uniqueidentifier, '18A00000-0000-0000-0000-000000000025'), @deliveryTypeId, N'uco', N'UCO', 5),
    (CONVERT(uniqueidentifier, '18A00000-0000-0000-0000-000000000031'), @opportunityTypeId, N'internal_cpd', N'Internal CPD', 1),
    (CONVERT(uniqueidentifier, '18A00000-0000-0000-0000-000000000032'), @opportunityTypeId, N'external_cpd', N'External CPD', 2),
    (CONVERT(uniqueidentifier, '18A00000-0000-0000-0000-000000000033'), @opportunityTypeId, N'shadowing', N'Shadowing', 3),
    (CONVERT(uniqueidentifier, '18A00000-0000-0000-0000-000000000034'), @opportunityTypeId, N'team_teaching', N'Team Teaching', 4),
    (CONVERT(uniqueidentifier, '18A00000-0000-0000-0000-000000000035'), @opportunityTypeId, N'mentoring_coaching', N'Mentoring/Coaching', 5)
) seed(id, lookup_type_id, value_key, display_name, display_order)
WHERE NOT EXISTS (
    SELECT 1 FROM core.lookup_values existing
    WHERE existing.lookup_type_id = seed.lookup_type_id AND existing.value_key = seed.value_key
);

INSERT INTO core.admin_managed_lists (lookup_type_id, category, description, display_order)
SELECT type.id, N'LIV', seed.description, seed.display_order
FROM (VALUES
    (N'liv_notice_preference', N'Notice choices used in Elevate Learning and Innovation.', 60),
    (N'liv_focus_area', N'Focus areas used in ELI and LIV rubrics.', 70),
    (N'liv_delivery_area', N'Delivery areas recorded against LIV cases.', 80),
    (N'liv_development_opportunity', N'Development opportunities recorded during follow-up cycles.', 90)
) seed(lookup_key, description, display_order)
JOIN core.lookup_types type ON type.lookup_key = seed.lookup_key
WHERE NOT EXISTS (SELECT 1 FROM core.admin_managed_lists existing WHERE existing.lookup_type_id = type.id);

INSERT INTO core.lookup_usage_registry (lookup_type_id, application_key, display_name)
SELECT type.id, seed.application_key, seed.display_name
FROM (VALUES
    (N'liv_notice_preference', N'elevate_learning_innovation.liv_information', N'ELI LIV Information'),
    (N'liv_focus_area', N'elevate_learning_innovation.liv_information', N'ELI LIV Information'),
    (N'liv_focus_area', N'liv.visit_rubric', N'LIV visit rubric'),
    (N'liv_delivery_area', N'liv.case', N'LIV cases'),
    (N'liv_development_opportunity', N'liv.follow_up', N'LIV follow-up cycles')
) seed(lookup_key, application_key, display_name)
JOIN core.lookup_types type ON type.lookup_key = seed.lookup_key
WHERE NOT EXISTS (
    SELECT 1 FROM core.lookup_usage_registry existing
    WHERE existing.lookup_type_id = type.id AND existing.application_key = seed.application_key
);
GO

IF OBJECT_ID('quality.elevate_practice_liv_information', 'U') IS NULL
BEGIN
    CREATE TABLE quality.elevate_practice_liv_information (
        assessment_id uniqueidentifier NOT NULL CONSTRAINT pk_elevate_practice_liv_information PRIMARY KEY,
        notice_preference_lookup_value_id uniqueidentifier NULL,
        preferred_visit_month date NULL,
        primary_focus_lookup_value_id uniqueidentifier NULL,
        secondary_focus_lookup_value_id uniqueidentifier NULL,
        secondary_focus_other nvarchar(1000) NULL,
        desired_outcome nvarchar(max) NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_elevate_liv_information_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT fk_elevate_liv_info_assessment FOREIGN KEY (assessment_id) REFERENCES quality.elevate_practice_assessments(id),
        CONSTRAINT fk_elevate_liv_info_notice FOREIGN KEY (notice_preference_lookup_value_id) REFERENCES core.lookup_values(id),
        CONSTRAINT fk_elevate_liv_info_primary_focus FOREIGN KEY (primary_focus_lookup_value_id) REFERENCES core.lookup_values(id),
        CONSTRAINT fk_elevate_liv_info_secondary_focus FOREIGN KEY (secondary_focus_lookup_value_id) REFERENCES core.lookup_values(id)
    );
END;
GO

-- LIV case header values copied from the source ELI record remain snapshots so
-- an assessment amendment cannot silently rewrite an active case.
IF COL_LENGTH('quality.liv_records', 'delivery_area_lookup_value_id') IS NULL
    ALTER TABLE quality.liv_records ADD delivery_area_lookup_value_id uniqueidentifier NULL;
GO
IF COL_LENGTH('quality.liv_records', 'source_elevate_assessment_id') IS NULL
    ALTER TABLE quality.liv_records ADD source_elevate_assessment_id uniqueidentifier NULL;
GO
IF COL_LENGTH('quality.liv_records', 'eli_primary_focus_key') IS NULL
    ALTER TABLE quality.liv_records ADD eli_primary_focus_key nvarchar(100) NULL;
GO
IF COL_LENGTH('quality.liv_records', 'eli_primary_focus_snapshot') IS NULL
    ALTER TABLE quality.liv_records ADD eli_primary_focus_snapshot nvarchar(250) NULL;
GO
IF COL_LENGTH('quality.liv_records', 'eli_desired_outcome') IS NULL
    ALTER TABLE quality.liv_records ADD eli_desired_outcome nvarchar(max) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'fk_liv_records_delivery_area')
    ALTER TABLE quality.liv_records ADD CONSTRAINT fk_liv_records_delivery_area
        FOREIGN KEY (delivery_area_lookup_value_id) REFERENCES core.lookup_values(id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'fk_liv_records_source_elevate')
    ALTER TABLE quality.liv_records ADD CONSTRAINT fk_liv_records_source_elevate
        FOREIGN KEY (source_elevate_assessment_id) REFERENCES quality.elevate_practice_assessments(id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ux_liv_records_source_elevate' AND object_id = OBJECT_ID('quality.liv_records'))
    CREATE UNIQUE INDEX ux_liv_records_source_elevate ON quality.liv_records(source_elevate_assessment_id)
    WHERE source_elevate_assessment_id IS NOT NULL AND archived_at IS NULL;
GO

IF OBJECT_ID('quality.liv_cycles', 'U') IS NULL
BEGIN
    CREATE TABLE quality.liv_cycles (
        id uniqueidentifier NOT NULL CONSTRAINT pk_liv_cycles PRIMARY KEY DEFAULT newsequentialid(),
        liv_record_id uniqueidentifier NOT NULL,
        cycle_number int NOT NULL,
        cycle_status nvarchar(30) NOT NULL CONSTRAINT df_liv_cycles_status DEFAULT N'in_progress',
        started_at datetimeoffset NOT NULL CONSTRAINT df_liv_cycles_started DEFAULT sysutcdatetime(),
        completed_at datetimeoffset NULL,
        created_by_user_account_id uniqueidentifier NULL,
        updated_by_user_account_id uniqueidentifier NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_liv_cycles_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT fk_liv_cycles_record FOREIGN KEY (liv_record_id) REFERENCES quality.liv_records(id),
        CONSTRAINT fk_liv_cycles_created_by FOREIGN KEY (created_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT fk_liv_cycles_updated_by FOREIGN KEY (updated_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT uq_liv_cycles_number UNIQUE (liv_record_id, cycle_number),
        CONSTRAINT ck_liv_cycles_number CHECK (cycle_number > 0),
        CONSTRAINT ck_liv_cycles_status CHECK (cycle_status IN (N'in_progress', N'completed'))
    );
END;
GO

INSERT INTO quality.liv_cycles (
    id, liv_record_id, cycle_number, cycle_status, started_at,
    completed_at, created_by_user_account_id, created_at
)
SELECT NEWID(), liv.id, numbers.cycle_number,
       CASE WHEN liv.status = N'closed' THEN N'completed' ELSE N'in_progress' END,
       COALESCE(visit.created_at, liv.created_at),
       CASE WHEN liv.status = N'closed' THEN COALESCE(liv.updated_at, liv.created_at) ELSE NULL END,
       liv.created_by_user_account_id, COALESCE(visit.created_at, liv.created_at)
FROM quality.liv_records liv
CROSS APPLY (
    SELECT visit.visit_number AS cycle_number
    FROM quality.liv_visits visit
    WHERE visit.liv_record_id = liv.id AND visit.archived_at IS NULL
    UNION ALL
    SELECT 1 WHERE NOT EXISTS (
        SELECT 1 FROM quality.liv_visits visit
        WHERE visit.liv_record_id = liv.id AND visit.archived_at IS NULL
    )
) numbers
LEFT JOIN quality.liv_visits visit
  ON visit.liv_record_id = liv.id AND visit.visit_number = numbers.cycle_number
WHERE NOT EXISTS (
    SELECT 1 FROM quality.liv_cycles existing
    WHERE existing.liv_record_id = liv.id AND existing.cycle_number = numbers.cycle_number
);
GO

IF COL_LENGTH('quality.liv_visits', 'cycle_id') IS NULL
    ALTER TABLE quality.liv_visits ADD cycle_id uniqueidentifier NULL;
GO
UPDATE visit
SET cycle_id = cycle.id
FROM quality.liv_visits visit
JOIN quality.liv_cycles cycle
  ON cycle.liv_record_id = visit.liv_record_id
 AND cycle.cycle_number = visit.visit_number
WHERE visit.cycle_id IS NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'fk_liv_visits_cycle')
    ALTER TABLE quality.liv_visits ADD CONSTRAINT fk_liv_visits_cycle
        FOREIGN KEY (cycle_id) REFERENCES quality.liv_cycles(id);
GO

IF OBJECT_ID('quality.liv_stages', 'U') IS NULL
BEGIN
    CREATE TABLE quality.liv_stages (
        id uniqueidentifier NOT NULL CONSTRAINT pk_liv_stages PRIMARY KEY DEFAULT newsequentialid(),
        liv_cycle_id uniqueidentifier NOT NULL,
        stage_type nvarchar(40) NOT NULL,
        stage_order int NOT NULL,
        stage_status nvarchar(30) NOT NULL CONSTRAINT df_liv_stages_status DEFAULT N'in_progress',
        context_text nvarchar(max) NULL,
        aims_text nvarchar(max) NULL,
        learner_activity_text nvarchar(max) NULL,
        reflection_text nvarchar(max) NULL,
        intended_follow_up_date date NULL,
        distance_impact_text nvarchar(max) NULL,
        development_opportunity_keys_json nvarchar(max) NULL,
        liv_visit_id uniqueidentifier NULL,
        created_by_user_account_id uniqueidentifier NULL,
        updated_by_user_account_id uniqueidentifier NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_liv_stages_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        archived_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT fk_liv_stages_cycle FOREIGN KEY (liv_cycle_id) REFERENCES quality.liv_cycles(id),
        CONSTRAINT fk_liv_stages_visit FOREIGN KEY (liv_visit_id) REFERENCES quality.liv_visits(id),
        CONSTRAINT fk_liv_stages_created_by FOREIGN KEY (created_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT fk_liv_stages_updated_by FOREIGN KEY (updated_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT uq_liv_stages_type UNIQUE (liv_cycle_id, stage_type),
        CONSTRAINT ck_liv_stages_type CHECK (stage_type IN (N'pre_discussion', N'distance_impact', N'visit', N'post_reflection', N'actions', N'follow_up_review')),
        CONSTRAINT ck_liv_stages_order CHECK (stage_order BETWEEN 1 AND 5),
        CONSTRAINT ck_liv_stages_status CHECK (stage_status IN (N'in_progress', N'completed')),
        CONSTRAINT ck_liv_stages_opportunities CHECK (development_opportunity_keys_json IS NULL OR ISJSON(development_opportunity_keys_json) = 1)
    );
END;
GO

INSERT INTO quality.liv_stages (
    liv_cycle_id, stage_type, stage_order, context_text,
    created_by_user_account_id, created_at
)
SELECT cycle.id, N'pre_discussion', 1, liv.pre_conversation,
       liv.created_by_user_account_id, liv.created_at
FROM quality.liv_cycles cycle
JOIN quality.liv_records liv ON liv.id = cycle.liv_record_id
WHERE cycle.cycle_number = 1
  AND NULLIF(LTRIM(RTRIM(liv.pre_conversation)), N'') IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM quality.liv_stages existing
      WHERE existing.liv_cycle_id = cycle.id AND existing.stage_type = N'pre_discussion'
  );

INSERT INTO quality.liv_stages (
    liv_cycle_id, stage_type, stage_order, stage_status, liv_visit_id,
    created_by_user_account_id, created_at
)
SELECT cycle.id, N'visit', 2, visit.visit_status, visit.id,
       visit.created_by_user_account_id, visit.created_at
FROM quality.liv_visits visit
JOIN quality.liv_cycles cycle ON cycle.id = visit.cycle_id
WHERE visit.archived_at IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM quality.liv_stages existing
      WHERE existing.liv_cycle_id = cycle.id AND existing.stage_type = N'visit'
  );
GO

IF OBJECT_ID('quality.liv_visit_ratings', 'U') IS NULL
BEGIN
    CREATE TABLE quality.liv_visit_ratings (
        visit_id uniqueidentifier NOT NULL,
        focus_lookup_value_id uniqueidentifier NOT NULL,
        descriptor_id uniqueidentifier NULL,
        hidden_numeric_value tinyint NULL,
        is_not_applicable bit NOT NULL CONSTRAINT df_liv_visit_ratings_na DEFAULT 0,
        created_at datetimeoffset NOT NULL CONSTRAINT df_liv_visit_ratings_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT pk_liv_visit_ratings PRIMARY KEY (visit_id, focus_lookup_value_id),
        CONSTRAINT fk_liv_visit_ratings_visit FOREIGN KEY (visit_id) REFERENCES quality.liv_visits(id),
        CONSTRAINT fk_liv_visit_ratings_focus FOREIGN KEY (focus_lookup_value_id) REFERENCES core.lookup_values(id),
        CONSTRAINT fk_liv_visit_ratings_descriptor FOREIGN KEY (descriptor_id) REFERENCES quality.elevate_practice_rubric_descriptors(id),
        CONSTRAINT ck_liv_visit_ratings_value CHECK (hidden_numeric_value IS NULL OR hidden_numeric_value BETWEEN 1 AND 5),
        CONSTRAINT ck_liv_visit_ratings_choice CHECK (
            (is_not_applicable = 1 AND descriptor_id IS NULL AND hidden_numeric_value IS NULL)
            OR (is_not_applicable = 0 AND descriptor_id IS NOT NULL AND hidden_numeric_value IS NOT NULL)
        )
    );
END;
GO

IF COL_LENGTH('quality.actions', 'liv_cycle_id') IS NULL
    ALTER TABLE quality.actions ADD liv_cycle_id uniqueidentifier NULL;
GO
UPDATE action_row
SET liv_cycle_id = visit.cycle_id
FROM quality.actions action_row
JOIN quality.liv_visits visit ON visit.id = action_row.liv_visit_id
WHERE action_row.liv_cycle_id IS NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'fk_actions_liv_cycle')
    ALTER TABLE quality.actions ADD CONSTRAINT fk_actions_liv_cycle
        FOREIGN KEY (liv_cycle_id) REFERENCES quality.liv_cycles(id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_actions_liv_cycle' AND object_id = OBJECT_ID('quality.actions'))
    CREATE INDEX ix_actions_liv_cycle ON quality.actions(liv_cycle_id)
    WHERE liv_cycle_id IS NOT NULL;
GO
