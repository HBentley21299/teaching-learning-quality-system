SET NOCOUNT ON;
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

IF OBJECT_ID(N'quality.elevate_environment_rubric_descriptors', N'U') IS NULL
BEGIN
    CREATE TABLE quality.elevate_environment_rubric_descriptors (
        id uniqueidentifier NOT NULL CONSTRAINT pk_elevate_environment_rubric_descriptors PRIMARY KEY DEFAULT newsequentialid(),
        pillar_id uniqueidentifier NOT NULL,
        numerical_score tinyint NOT NULL,
        judgement_key nvarchar(50) NOT NULL,
        judgement_label nvarchar(100) NOT NULL,
        descriptor nvarchar(2000) NOT NULL,
        display_order int NOT NULL,
        is_active bit NOT NULL CONSTRAINT df_elevate_environment_rubric_active DEFAULT 1,
        created_at datetimeoffset NOT NULL CONSTRAINT df_elevate_environment_rubric_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        archived_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT fk_elevate_environment_rubric_pillar FOREIGN KEY (pillar_id) REFERENCES quality.elevate_environment_pillars(id),
        CONSTRAINT uq_elevate_environment_rubric_score UNIQUE (pillar_id, numerical_score),
        CONSTRAINT ck_elevate_environment_rubric_score CHECK (numerical_score BETWEEN 1 AND 5),
        CONSTRAINT ck_elevate_environment_rubric_order CHECK (display_order > 0)
    );
END;

IF OBJECT_ID(N'quality.elevate_environment_pillar_ratings', N'U') IS NULL
BEGIN
    CREATE TABLE quality.elevate_environment_pillar_ratings (
        record_id uniqueidentifier NOT NULL,
        pillar_key nvarchar(50) NOT NULL,
        rubric_descriptor_id uniqueidentifier NOT NULL,
        numerical_score tinyint NOT NULL,
        judgement_key nvarchar(50) NOT NULL,
        judgement_label_snapshot nvarchar(100) NOT NULL,
        descriptor_snapshot nvarchar(2000) NOT NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_elevate_environment_rating_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT pk_elevate_environment_pillar_ratings PRIMARY KEY (record_id, pillar_key),
        CONSTRAINT fk_elevate_environment_rating_record FOREIGN KEY (record_id) REFERENCES core.records(id),
        CONSTRAINT fk_elevate_environment_rating_descriptor FOREIGN KEY (rubric_descriptor_id) REFERENCES quality.elevate_environment_rubric_descriptors(id),
        CONSTRAINT ck_elevate_environment_rating_score CHECK (numerical_score BETWEEN 1 AND 5)
    );
END;

MERGE quality.elevate_environment_rubric_descriptors AS target
USING (
    SELECT pillar.id AS pillar_id, source.*
    FROM (VALUES
        (CAST(N'aspirational' AS nvarchar(50)), 1, N'priority_improvement', N'Priority improvement', N'Condition, readiness, missing or unsuitable resources, or avoidable clutter undermine learning and communicate low expectations. The space has little meaningful connection to the subject, profession or learners'' intended destination.', 10),
        (N'aspirational', 2, N'developing', N'Developing', N'Some positive features and subject identity are visible, but condition, organisation, resources or examples are uneven. High expectations are not consistently reinforced across the room.', 20),
        (N'aspirational', 3, N'secure', N'Secure', N'The room is organised, maintained and ready for its intended use. Standards, subject identity and progression are clear, and current resources and equipment support high-quality outcomes.', 30),
        (N'aspirational', 4, N'strong', N'Strong', N'The environment is coherent and authentic. Learner work, professional practice, current pathways and high-quality resources are used purposefully to reinforce ambition, pride and independence.', 40),
        (N'aspirational', 5, N'leading_practice', N'Leading practice', N'The environment consistently drives exceptional standards and learner ownership. It exemplifies current subject, industry or higher-education practice and offers a sustainable model that others could learn from.', 50),

        (N'collaborative', 1, N'priority_improvement', N'Priority improvement', N'Layout, acoustics, sightlines or equipment positioning create avoidable barriers to participation, demonstration, supervision or peer support. Bottlenecks or isolated learners materially restrict learning.', 10),
        (N'collaborative', 2, N'developing', N'Developing', N'Interaction is possible but uneven. Some learners have weaker access, transitions are awkward, or the use of shared resources and specialist areas depends on repeated workarounds.', 20),
        (N'collaborative', 3, N'secure', N'Secure', N'The room supports the intended balance of demonstration, individual practice, discussion and pair or team activity. Visibility, movement, supervision and shared resources are well managed, including where furniture or equipment is fixed.', 30),
        (N'collaborative', 4, N'strong', N'Strong', N'The space is deliberately used to enable purposeful teamwork, peer coaching and shared problem-solving. Participation routes are varied, transitions are smooth and the specialist layout is used to clear advantage.', 40),
        (N'collaborative', 5, N'leading_practice', N'Leading practice', N'Learners confidently and independently use the environment for high-level collaboration and shared practice. The space is adaptive, inclusive and demonstrably strengthens communication, teamwork and collective responsibility.', 50),

        (N'respectful', 1, N'priority_improvement', N'Priority improvement', N'The room is unsafe, unclean, damaged or poorly maintained. Storage, comfort, privacy, unresolved faults or the general condition undermine dignity and suggest a lack of care for learners, staff or their work.', 10),
        (N'respectful', 2, N'developing', N'Developing', N'The space is broadly usable, but maintenance, storage, comfort, presentation or readiness is inconsistent. Standards rely too heavily on individual effort or temporary workarounds.', 20),
        (N'respectful', 3, N'secure', N'Secure', N'The room is clean, safe, orderly and maintained. Resources are stored logically, comfort is appropriate to its function, and learners, staff and their work are treated with dignity.', 30),
        (N'respectful', 4, N'strong', N'Strong', N'Clear routines and shared ownership keep the space calm, professional and ready. Faults are addressed, resources are cared for, and learner identity, contribution and work are valued appropriately.', 40),
        (N'respectful', 5, N'leading_practice', N'Leading practice', N'An exemplary culture of care and stewardship is embedded. High standards are sustained across different users, and dignity, wellbeing, safety and professional responsibility are evident without compromising the room''s specialist function.', 50),

        (N'innovative', 1, N'priority_improvement', N'Priority improvement', N'Essential equipment, resources or technology are absent, unsuitable, outdated or unreliable, materially restricting curriculum delivery, safe practice or learners'' access to current professional methods.', 10),
        (N'innovative', 2, N'developing', N'Developing', N'Useful tools are available, but access, functionality or purposeful use is inconsistent. Innovation feels added on, limited to isolated features or dependent on particular individuals.', 20),
        (N'innovative', 3, N'secure', N'Secure', N'Appropriate analogue, digital and specialist tools are reliable, accessible and purposeful. They support practice, creation, assessment, feedback, problem-solving or independent learning in ways suited to the curriculum.', 30),
        (N'innovative', 4, N'strong', N'Strong', N'The environment enables authentic simulation, experimentation, creation, rapid feedback or industry-standard practice. Tools and room design are integrated, sustainable and clearly extend learning.', 40),
        (N'innovative', 5, N'leading_practice', N'Leading practice', N'Purposeful innovation demonstrably enables learning that would otherwise be difficult or impossible. The approach is evaluated, refined and adaptable, and provides a credible model for wider or future practice.', 50),

        (N'inclusion', 1, N'priority_improvement', N'Priority improvement', N'Physical, sensory, communication or equipment barriers prevent or materially restrict access and participation. Adjustments are unavailable, unsafe, stigmatising or require unnecessary separation.', 10),
        (N'inclusion', 2, N'developing', N'Developing', N'Some inclusive features are present, but access depends on ad hoc staff support, restricted choices or visible workarounds. Participation and independence are uneven.', 20),
        (N'inclusion', 3, N'secure', N'Secure', N'Learners can navigate, see, hear, access resources and equipment, and participate safely. Information is clear, and reasonable adjustments and assistive options are practical, dignified and routine.', 30),
        (N'inclusion', 4, N'strong', N'Strong', N'The environment anticipates varied needs and offers multiple ways to participate, communicate and regulate sensory demands. Adjustments preserve independence, safety, dignity and high expectations.', 40),
        (N'inclusion', 5, N'leading_practice', N'Leading practice', N'Inclusion is embedded and continually refined through learner experience and voice. Equitable access, belonging and independence are sustained by design, making the environment a model of ambitious inclusive practice.', 50)
    ) source(pillar_key, numerical_score, judgement_key, judgement_label, descriptor, display_order)
    JOIN quality.elevate_environment_pillars pillar ON pillar.pillar_key = source.pillar_key
) AS source
ON target.pillar_id = source.pillar_id
   AND target.numerical_score = source.numerical_score
WHEN MATCHED THEN
    UPDATE SET judgement_key = source.judgement_key,
               judgement_label = source.judgement_label,
               descriptor = source.descriptor,
               display_order = source.display_order,
               is_active = 1,
               archived_at = NULL,
               updated_at = sysutcdatetime()
WHEN NOT MATCHED THEN
    INSERT (id, pillar_id, numerical_score, judgement_key, judgement_label, descriptor, display_order)
    VALUES (newid(), source.pillar_id, source.numerical_score, source.judgement_key, source.judgement_label, source.descriptor, source.display_order);

IF EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = N'ck_elevate_assessments_total'
      AND parent_object_id = OBJECT_ID(N'quality.elevate_environment_assessments')
)
BEGIN
    ALTER TABLE quality.elevate_environment_assessments DROP CONSTRAINT ck_elevate_assessments_total;
END;

ALTER TABLE quality.elevate_environment_assessments WITH CHECK
    ADD CONSTRAINT ck_elevate_assessments_total CHECK (total_score BETWEEN 0 AND 25);

DECLARE @templateId uniqueidentifier = (
    SELECT id FROM forms.form_templates WHERE template_key = N'elevate_learning_environments_core'
);
DECLARE @versionId uniqueidentifier = '80000000-0000-0000-0000-000000000041';
DECLARE @roomSectionId uniqueidentifier = '81000000-0000-0000-0000-000000000041';
DECLARE @aspirationalSectionId uniqueidentifier = '81000000-0000-0000-0000-000000000042';
DECLARE @collaborativeSectionId uniqueidentifier = '81000000-0000-0000-0000-000000000043';
DECLARE @respectfulSectionId uniqueidentifier = '81000000-0000-0000-0000-000000000044';
DECLARE @innovativeSectionId uniqueidentifier = '81000000-0000-0000-0000-000000000045';
DECLARE @inclusiveSectionId uniqueidentifier = '81000000-0000-0000-0000-000000000046';
DECLARE @overallSectionId uniqueidentifier = '81000000-0000-0000-0000-000000000047';

UPDATE forms.form_templates
SET name = N'Elevate Your Learning Environment Audit',
    description = N'Learning environment audit using five unique pillar rubrics and centrally managed actions.',
    updated_at = sysutcdatetime()
WHERE id = @templateId;

UPDATE quality.elevate_environment_pillars
SET name = N'Inclusive',
    updated_at = sysutcdatetime()
WHERE pillar_key = N'inclusion';

IF @templateId IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM forms.form_template_versions WHERE id = @versionId)
BEGIN
    INSERT INTO forms.form_template_versions (
        id, form_template_id, version_label, active_from, is_published, created_by_user_account_id
    )
    VALUES (
        @versionId, @templateId, N'2.0', sysutcdatetime(), 1, '41000000-0000-0000-0000-000000000001'
    );
END;

INSERT INTO forms.form_sections (id, form_template_version_id, section_key, title, description, display_order)
SELECT source.id, @versionId, source.section_key, source.title, source.description, source.display_order
FROM (VALUES
    (@roomSectionId, N'room_context', N'Room', CAST(NULL AS nvarchar(1000)), 10),
    (@aspirationalSectionId, N'aspirational', N'Aspirational', N'Judge the environment against the complete Aspirational descriptor for the selected level.', 20),
    (@collaborativeSectionId, N'collaborative', N'Collaborative', N'Judge the environment against the complete Collaborative descriptor for the selected level.', 30),
    (@respectfulSectionId, N'respectful', N'Respectful', N'Judge the environment against the complete Respectful descriptor for the selected level.', 40),
    (@innovativeSectionId, N'innovative', N'Innovative', N'Judge the environment against the complete Innovative descriptor for the selected level.', 50),
    (@inclusiveSectionId, N'inclusion', N'Inclusive', N'Judge the environment against the complete Inclusive descriptor for the selected level.', 60),
    (@overallSectionId, N'overall_findings', N'Overall findings', N'Record evidence and improvement priorities that apply across the audit.', 70)
) source(id, section_key, title, description, display_order)
WHERE EXISTS (SELECT 1 FROM forms.form_template_versions WHERE id = @versionId)
  AND NOT EXISTS (SELECT 1 FROM forms.form_sections existing WHERE existing.id = source.id);

INSERT INTO forms.form_fields (
    id, form_section_id, field_key, label, field_type, is_required, display_order, help_text
)
SELECT source.id, source.section_id, source.field_key, source.label, source.field_type,
       source.is_required, source.display_order, source.help_text
FROM (VALUES
    (CAST('82000000-0000-0000-0000-000000000101' AS uniqueidentifier), @roomSectionId, N'room_code', N'Room', N'room_lookup', 1, 10, N'Search the active room register and select a controlled room value.'),
    (CAST('82000000-0000-0000-0000-000000000102' AS uniqueidentifier), @roomSectionId, N'building_name', N'Building', N'auto_text', 1, 20, N'Filled automatically from the room register.'),
    (CAST('82000000-0000-0000-0000-000000000103' AS uniqueidentifier), @roomSectionId, N'assessment_date', N'Date of audit', N'date', 1, 30, CAST(NULL AS nvarchar(1000))),

    (CAST('82000000-0000-0000-0000-000000000110' AS uniqueidentifier), @aspirationalSectionId, N'aspirational_score', N'Judgement', N'environment_rubric_1_5', 1, 10, N'Select the descriptor that best reflects the learning environment.'),
    (CAST('82000000-0000-0000-0000-000000000120' AS uniqueidentifier), @collaborativeSectionId, N'collaborative_score', N'Judgement', N'environment_rubric_1_5', 1, 10, N'Select the descriptor that best reflects the learning environment.'),
    (CAST('82000000-0000-0000-0000-000000000130' AS uniqueidentifier), @respectfulSectionId, N'respectful_score', N'Judgement', N'environment_rubric_1_5', 1, 10, N'Select the descriptor that best reflects the learning environment.'),
    (CAST('82000000-0000-0000-0000-000000000140' AS uniqueidentifier), @innovativeSectionId, N'innovative_score', N'Judgement', N'environment_rubric_1_5', 1, 10, N'Select the descriptor that best reflects the learning environment.'),
    (CAST('82000000-0000-0000-0000-000000000150' AS uniqueidentifier), @inclusiveSectionId, N'inclusion_score', N'Judgement', N'environment_rubric_1_5', 1, 10, N'Select the descriptor that best reflects the learning environment.'),

    (CAST('82000000-0000-0000-0000-000000000160' AS uniqueidentifier), @overallSectionId, N'environment_what_is_working', N'What is Working', N'long_text', 0, 10, N'Optional: record the strongest evidence across the full learning environment audit.'),
    (CAST('82000000-0000-0000-0000-000000000161' AS uniqueidentifier), @overallSectionId, N'environment_needs_improvement', N'What Needs Improvement', N'long_text', 0, 20, N'Optional: record the most important improvement priorities across the full audit.')
) source(id, section_id, field_key, label, field_type, is_required, display_order, help_text)
WHERE EXISTS (SELECT 1 FROM forms.form_sections WHERE id = source.section_id)
  AND NOT EXISTS (SELECT 1 FROM forms.form_fields existing WHERE existing.id = source.id);

COMMIT TRANSACTION;
GO
