SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;

BEGIN TRANSACTION;

DECLARE @types TABLE (
    id uniqueidentifier NOT NULL,
    lookup_key nvarchar(100) NOT NULL,
    name nvarchar(200) NOT NULL
);

INSERT INTO @types (id, lookup_key, name)
VALUES
    ('9a000000-0000-0000-0000-000000000001', 'action_theme_learning_walk', 'Learning Walk action themes'),
    ('9a000000-0000-0000-0000-000000000002', 'action_theme_elevate_environment', 'Learning Environment action themes'),
    ('9a000000-0000-0000-0000-000000000003', 'action_theme_work_scrutiny', 'Work Scrutiny action themes'),
    ('9a000000-0000-0000-0000-000000000004', 'action_theme_coaching_mentoring', 'Coaching and Mentoring action themes'),
    ('9a000000-0000-0000-0000-000000000005', 'action_theme_liv', 'LIV action themes'),
    ('9a000000-0000-0000-0000-000000000006', 'action_theme_probation_observation', 'Probationary Observation action themes'),
    ('9a000000-0000-0000-0000-000000000007', 'action_theme_cpd', 'CPD action themes'),
    ('9a000000-0000-0000-0000-000000000008', 'action_theme_standalone', 'Standalone action themes');

INSERT INTO core.lookup_types (id, lookup_key, name, description, is_system)
SELECT source.id, source.lookup_key, source.name, 'Configurable action themes for this process.', 0
FROM @types source
WHERE NOT EXISTS (
    SELECT 1 FROM core.lookup_types existing WHERE existing.lookup_key = source.lookup_key
);

DECLARE @values TABLE (
    id uniqueidentifier NOT NULL,
    lookup_key nvarchar(100) NOT NULL,
    value_key nvarchar(100) NOT NULL,
    display_name nvarchar(200) NOT NULL,
    display_order int NOT NULL
);

INSERT INTO @values (id, lookup_key, value_key, display_name, display_order)
VALUES
    ('9a100000-0000-0000-0000-000000000001', 'action_theme_learning_walk', 'general', 'General', 10),
    ('9a100000-0000-0000-0000-000000000002', 'action_theme_learning_walk', 'positive_start', 'Positive start', 20),
    ('9a100000-0000-0000-0000-000000000003', 'action_theme_learning_walk', 'planning_and_structure', 'Planning and structure', 30),
    ('9a100000-0000-0000-0000-000000000004', 'action_theme_learning_walk', 'delivery', 'Delivery', 40),
    ('9a100000-0000-0000-0000-000000000005', 'action_theme_learning_walk', 'assessment', 'Assessment', 50),
    ('9a100000-0000-0000-0000-000000000006', 'action_theme_learning_walk', 'feedback', 'Feedback', 60),
    ('9a100000-0000-0000-0000-000000000007', 'action_theme_learning_walk', 'inclusion', 'Inclusion', 70),
    ('9a100000-0000-0000-0000-000000000008', 'action_theme_learning_walk', 'learner_focus', 'Learner focus', 80),
    ('9a100000-0000-0000-0000-000000000009', 'action_theme_learning_walk', 'digital', 'Digital', 90),

    ('9a200000-0000-0000-0000-000000000001', 'action_theme_elevate_environment', 'general', 'General', 10),
    ('9a200000-0000-0000-0000-000000000002', 'action_theme_elevate_environment', 'aspirational', 'Aspirational', 20),
    ('9a200000-0000-0000-0000-000000000003', 'action_theme_elevate_environment', 'collaborative', 'Collaborative', 30),
    ('9a200000-0000-0000-0000-000000000004', 'action_theme_elevate_environment', 'respectful', 'Respectful', 40),
    ('9a200000-0000-0000-0000-000000000005', 'action_theme_elevate_environment', 'innovative', 'Innovative', 50),
    ('9a200000-0000-0000-0000-000000000006', 'action_theme_elevate_environment', 'inclusive', 'Inclusive', 60),

    ('9a300000-0000-0000-0000-000000000001', 'action_theme_work_scrutiny', 'general', 'General', 10),
    ('9a300000-0000-0000-0000-000000000002', 'action_theme_work_scrutiny', 'progress_and_attainment', 'Progress and attainment', 20),
    ('9a300000-0000-0000-0000-000000000003', 'action_theme_work_scrutiny', 'assessment', 'Assessment', 30),
    ('9a300000-0000-0000-0000-000000000004', 'action_theme_work_scrutiny', 'feedback', 'Feedback', 40),
    ('9a300000-0000-0000-0000-000000000005', 'action_theme_work_scrutiny', 'presentation_and_standards', 'Presentation and standards', 50),
    ('9a300000-0000-0000-0000-000000000006', 'action_theme_work_scrutiny', 'learner_response', 'Learner response', 60),

    ('9a400000-0000-0000-0000-000000000001', 'action_theme_coaching_mentoring', 'general', 'General', 10),
    ('9a400000-0000-0000-0000-000000000002', 'action_theme_coaching_mentoring', 'teaching_and_learning', 'Teaching and learning', 20),
    ('9a400000-0000-0000-0000-000000000003', 'action_theme_coaching_mentoring', 'assessment_and_feedback', 'Assessment and feedback', 30),
    ('9a400000-0000-0000-0000-000000000004', 'action_theme_coaching_mentoring', 'engagement', 'Engagement', 40),
    ('9a400000-0000-0000-0000-000000000005', 'action_theme_coaching_mentoring', 'inclusion', 'Inclusion', 50),
    ('9a400000-0000-0000-0000-000000000006', 'action_theme_coaching_mentoring', 'behaviour', 'Behaviour', 60),
    ('9a400000-0000-0000-0000-000000000007', 'action_theme_coaching_mentoring', 'digital_practice', 'Digital practice', 70),
    ('9a400000-0000-0000-0000-000000000008', 'action_theme_coaching_mentoring', 'subject_practice', 'Subject practice', 80),
    ('9a400000-0000-0000-0000-000000000009', 'action_theme_coaching_mentoring', 'professional_confidence', 'Professional confidence', 90),
    ('9a400000-0000-0000-0000-000000000010', 'action_theme_coaching_mentoring', 'leadership', 'Leadership', 100),
    ('9a400000-0000-0000-0000-000000000011', 'action_theme_coaching_mentoring', 'career_development', 'Career development', 110),
    ('9a400000-0000-0000-0000-000000000012', 'action_theme_coaching_mentoring', 'other', 'Other', 120),

    ('9a500000-0000-0000-0000-000000000001', 'action_theme_liv', 'general', 'General', 10),
    ('9a500000-0000-0000-0000-000000000002', 'action_theme_liv', 'planning_and_structure', 'Planning and structure', 20),
    ('9a500000-0000-0000-0000-000000000003', 'action_theme_liv', 'delivery', 'Delivery', 30),
    ('9a500000-0000-0000-0000-000000000004', 'action_theme_liv', 'assessment_and_feedback', 'Assessment and feedback', 40),
    ('9a500000-0000-0000-0000-000000000005', 'action_theme_liv', 'inclusion', 'Inclusion', 50),
    ('9a500000-0000-0000-0000-000000000006', 'action_theme_liv', 'learner_engagement', 'Learner engagement', 60),
    ('9a500000-0000-0000-0000-000000000007', 'action_theme_liv', 'digital_practice', 'Digital practice', 70),

    ('9a600000-0000-0000-0000-000000000001', 'action_theme_probation_observation', 'general', 'General', 10),
    ('9a600000-0000-0000-0000-000000000002', 'action_theme_probation_observation', 'planning_and_structure', 'Planning and structure', 20),
    ('9a600000-0000-0000-0000-000000000003', 'action_theme_probation_observation', 'delivery', 'Delivery', 30),
    ('9a600000-0000-0000-0000-000000000004', 'action_theme_probation_observation', 'assessment_and_feedback', 'Assessment and feedback', 40),
    ('9a600000-0000-0000-0000-000000000005', 'action_theme_probation_observation', 'inclusion', 'Inclusion', 50),
    ('9a600000-0000-0000-0000-000000000006', 'action_theme_probation_observation', 'learner_focus', 'Learner focus', 60),
    ('9a600000-0000-0000-0000-000000000007', 'action_theme_probation_observation', 'professional_standards', 'Professional standards', 70),

    ('9a700000-0000-0000-0000-000000000001', 'action_theme_cpd', 'general', 'General', 10),
    ('9a700000-0000-0000-0000-000000000002', 'action_theme_cpd', 'application_of_learning', 'Application of learning', 20),
    ('9a700000-0000-0000-0000-000000000003', 'action_theme_cpd', 'sharing_practice', 'Sharing practice', 30),
    ('9a700000-0000-0000-0000-000000000004', 'action_theme_cpd', 'qualification', 'Qualification', 40),
    ('9a700000-0000-0000-0000-000000000005', 'action_theme_cpd', 'compliance', 'Compliance', 50),
    ('9a700000-0000-0000-0000-000000000006', 'action_theme_cpd', 'career_development', 'Career development', 60),

    ('9a800000-0000-0000-0000-000000000001', 'action_theme_standalone', 'general', 'General', 10),
    ('9a800000-0000-0000-0000-000000000002', 'action_theme_standalone', 'quality_improvement', 'Quality improvement', 20),
    ('9a800000-0000-0000-0000-000000000003', 'action_theme_standalone', 'operational_improvement', 'Operational improvement', 30),
    ('9a800000-0000-0000-0000-000000000004', 'action_theme_standalone', 'compliance', 'Compliance', 40),
    ('9a800000-0000-0000-0000-000000000005', 'action_theme_standalone', 'staff_development', 'Staff development', 50),
    ('9a800000-0000-0000-0000-000000000006', 'action_theme_standalone', 'learner_experience', 'Learner experience', 60);

INSERT INTO core.lookup_values (
    id, lookup_type_id, value_key, display_name, display_order
)
SELECT source.id, type.id, source.value_key, source.display_name, source.display_order
FROM @values source
JOIN core.lookup_types type ON type.lookup_key = source.lookup_key
WHERE NOT EXISTS (
    SELECT 1
    FROM core.lookup_values existing
    WHERE existing.lookup_type_id = type.id
      AND existing.value_key = source.value_key
);

UPDATE action
SET action_theme = 'General'
FROM quality.actions action
WHERE action.action_theme =
    CASE action.source_form_type
        WHEN 'learning_walk' THEN 'Learning Walk'
        WHEN 'work_scrutiny' THEN 'Work Scrutiny'
        WHEN 'coaching_mentoring' THEN 'Coaching and Mentoring'
        WHEN 'liv' THEN 'Learning and Improvement Visit'
        WHEN 'probation_observation' THEN 'Probationary Observation'
        WHEN 'elevate_environment' THEN 'Elevate Learning Environment'
        WHEN 'standalone' THEN 'Organisation'
        ELSE NULL
    END;

COMMIT TRANSACTION;
