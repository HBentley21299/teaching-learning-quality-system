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

-- Tutors may log their own external professional development. Creating a
-- college CPD event remains protected by cpd.manage.
IF NOT EXISTS (SELECT 1 FROM auth.permissions WHERE permission_key = 'cpd.external.submit')
BEGIN
    INSERT INTO auth.permissions (id, permission_key, name, category)
    VALUES (
        'A49E2B66-F781-F111-A136-A4F93330CC93',
        'cpd.external.submit',
        'Log External CPD',
        'CPD'
    );
END;

INSERT INTO auth.role_permissions (role_id, permission_id)
SELECT role_row.id, permission_row.id
FROM auth.roles role_row
JOIN auth.permissions permission_row ON permission_row.permission_key = 'cpd.external.submit'
WHERE role_row.role_key IN (
    'super_admin', 'teaching_learning_team', 'director', 'head_of_faculty',
    'programme_leader', 'staff'
)
  AND role_row.is_active = 1
  AND NOT EXISTS (
      SELECT 1 FROM auth.role_permissions existing
      WHERE existing.role_id = role_row.id
        AND existing.permission_id = permission_row.id
  );

-- Unrestricted reflection records supplement the three legacy milestone
-- prompts. Legacy evidence remains in evidence.evidence_items and is still
-- returned by the API.
IF OBJECT_ID('quality.staff_profile_reflections', 'U') IS NULL
BEGIN
    CREATE TABLE quality.staff_profile_reflections (
        id uniqueidentifier NOT NULL CONSTRAINT pk_staff_profile_reflections PRIMARY KEY DEFAULT newsequentialid(),
        record_id uniqueidentifier NOT NULL,
        staff_id uniqueidentifier NOT NULL,
        title nvarchar(300) NOT NULL,
        reflection_text nvarchar(max) NOT NULL,
        reflection_date date NOT NULL,
        created_by_user_account_id uniqueidentifier NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_staff_profile_reflections_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        archived_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT fk_staff_profile_reflections_record FOREIGN KEY (record_id) REFERENCES core.records(id),
        CONSTRAINT fk_staff_profile_reflections_staff FOREIGN KEY (staff_id) REFERENCES people.staff(id),
        CONSTRAINT fk_staff_profile_reflections_created_by FOREIGN KEY (created_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT uq_staff_profile_reflections_record UNIQUE (record_id)
    );

    CREATE INDEX ix_staff_profile_reflections_staff_date
        ON quality.staff_profile_reflections(staff_id, reflection_date DESC)
        INCLUDE (record_id, title)
        WHERE archived_at IS NULL;
END;

-- Learning Walk 3.0 adds the reporting judgement between Findings and
-- Theme / Focus while retaining the prior version for historical records.
DECLARE @learningWalkTemplate uniqueidentifier = (
    SELECT id FROM forms.form_templates
    WHERE template_key = 'learning_walk_core' AND archived_at IS NULL
);
DECLARE @learningWalkVersion uniqueidentifier = '71000000-0000-0000-0000-000000000012';
DECLARE @lwContext uniqueidentifier = '72000000-0000-0000-0000-000000000021';
DECLARE @lwFindings uniqueidentifier = '72000000-0000-0000-0000-000000000022';
DECLARE @lwJudgement uniqueidentifier = '72000000-0000-0000-0000-000000000023';
DECLARE @lwTheme uniqueidentifier = '72000000-0000-0000-0000-000000000024';
DECLARE @lwFollowUp uniqueidentifier = '72000000-0000-0000-0000-000000000025';

IF @learningWalkTemplate IS NOT NULL
BEGIN
    INSERT INTO forms.form_template_versions (
        id, form_template_id, version_label, active_from, is_published, created_by_user_account_id
    )
    SELECT @learningWalkVersion, @learningWalkTemplate, '3.0', sysutcdatetime(), 1,
           '41000000-0000-0000-0000-000000000001'
    WHERE NOT EXISTS (SELECT 1 FROM forms.form_template_versions WHERE id = @learningWalkVersion);

    INSERT INTO forms.form_sections (id, form_template_version_id, section_key, title, display_order)
    SELECT row_value.id, @learningWalkVersion, row_value.section_key, row_value.title, row_value.display_order
    FROM (VALUES
        (@lwContext, 'context', 'Context', 1),
        (@lwFindings, 'findings', 'Findings', 2),
        (@lwJudgement, 'practice_observed', 'Practice Observed', 3),
        (@lwTheme, 'theme_focus', 'Theme / Focus', 4),
        (@lwFollowUp, 'follow_up', 'Follow-up', 5)
    ) row_value(id, section_key, title, display_order)
    WHERE NOT EXISTS (SELECT 1 FROM forms.form_sections existing WHERE existing.id = row_value.id);

    INSERT INTO forms.form_fields (
        id, form_section_id, field_key, label, field_type, is_required,
        display_order, help_text, configuration_json
    )
    SELECT row_value.id, row_value.section_id, row_value.field_key, row_value.label,
           row_value.field_type, row_value.is_required, row_value.display_order,
           row_value.help_text, row_value.configuration_json
    FROM (VALUES
        (CONVERT(uniqueidentifier, '73000000-0000-0000-0000-000000000021'), @lwContext, 'visit_date', 'Date of visit', 'date', 1, 10, CONVERT(nvarchar(1000), NULL), CONVERT(nvarchar(max), NULL)),
        (CONVERT(uniqueidentifier, '73000000-0000-0000-0000-000000000022'), @lwContext, 'faculty_area', 'Faculty Area', 'faculty_lookup', 1, 20, N'Select the parent faculty.', NULL),
        (CONVERT(uniqueidentifier, '73000000-0000-0000-0000-000000000023'), @lwContext, 'team_level', 'Team Level', 'team_lookup', 1, 30, N'Options are filtered by the selected faculty.', NULL),
        (CONVERT(uniqueidentifier, '73000000-0000-0000-0000-000000000024'), @lwFindings, 'good_practice', 'Areas of Good Practice Identified', 'long_text', 1, 10, NULL, NULL),
        (CONVERT(uniqueidentifier, '73000000-0000-0000-0000-000000000025'), @lwFindings, 'development_areas', 'Areas for Development Identified', 'long_text', 1, 20, NULL, NULL),
        (CONVERT(uniqueidentifier, '73000000-0000-0000-0000-000000000026'), @lwJudgement, 'practice_observed', 'Practice Observed', 'practice_rubric_1_5', 1, 10, N'Select the wording that best describes the practice observed. The score is stored for reporting.',
         N'{"options":["1::Emerging Practice::Practice is beginning to develop but is not yet consistent or fully effective.::#B42318","2::Developing Practice::Practice is evident but remains new, variable or inconsistently effective.::#E56B1F","3::Secure Practice::Practice is usually effective and has a clear positive impact on learners.::#D7A700","4::Strong Practice::Practice is consistently effective, embedded and responsive to learners'' needs.::#69A84F","5::Leading Practice::Practice is sustained, highly effective and supported by clear evidence of impact that can inform others.::#237A3B"]}'),
        (CONVERT(uniqueidentifier, '73000000-0000-0000-0000-000000000027'), @lwTheme, 'learning_walk_theme', 'Learning Walk Theme', 'auto_text', 1, 10, N'Auto-filled from the faculty and team mapping.', NULL),
        (CONVERT(uniqueidentifier, '73000000-0000-0000-0000-000000000028'), @lwTheme, 'additional_focus_context', 'Additional Focus / Context', 'long_text', 0, 20, NULL, NULL),
        (CONVERT(uniqueidentifier, '73000000-0000-0000-0000-000000000029'), @lwFollowUp, 'actions_next_steps', 'Actions / Next Steps', 'long_text', 0, 10, N'Use linked actions when an owner and due date are required.', NULL)
    ) row_value(id, section_id, field_key, label, field_type, is_required, display_order, help_text, configuration_json)
    WHERE NOT EXISTS (SELECT 1 FROM forms.form_fields existing WHERE existing.id = row_value.id);
END;

IF COL_LENGTH('quality.learning_walk_details', 'practice_observed_score') IS NULL
    ALTER TABLE quality.learning_walk_details ADD practice_observed_score tinyint NULL;

IF COL_LENGTH('quality.learning_walk_details', 'practice_observed_label') IS NULL
    ALTER TABLE quality.learning_walk_details ADD practice_observed_label nvarchar(100) NULL;

IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = 'ck_learning_walk_practice_observed_score'
)
BEGIN
    EXEC(N'ALTER TABLE quality.learning_walk_details
        ADD CONSTRAINT ck_learning_walk_practice_observed_score
        CHECK (practice_observed_score IS NULL OR practice_observed_score BETWEEN 1 AND 5);');
END;

-- Elevate Learning Environments 2.0 uses five unique 1-5 pillar rubrics and
-- whole-audit narrative fields. The 1.0 form and responses remain untouched.
DECLARE @environmentTemplate uniqueidentifier = (
    SELECT id FROM forms.form_templates
    WHERE template_key = 'elevate_learning_environments_core' AND archived_at IS NULL
);
DECLARE @environmentVersion uniqueidentifier = '80000000-0000-0000-0000-000000000003';
DECLARE @environmentContext uniqueidentifier = '81000000-0000-0000-0000-000000000011';
DECLARE @environmentAspirational uniqueidentifier = '81000000-0000-0000-0000-000000000012';
DECLARE @environmentCollaborative uniqueidentifier = '81000000-0000-0000-0000-000000000013';
DECLARE @environmentRespectful uniqueidentifier = '81000000-0000-0000-0000-000000000014';
DECLARE @environmentInnovative uniqueidentifier = '81000000-0000-0000-0000-000000000015';
DECLARE @environmentInclusive uniqueidentifier = '81000000-0000-0000-0000-000000000016';
DECLARE @environmentOverall uniqueidentifier = '81000000-0000-0000-0000-000000000017';

IF @environmentTemplate IS NOT NULL
BEGIN
    UPDATE forms.form_templates
    SET name = 'Elevate Learning Environments Audit',
        description = 'Whole-room audit using five pillar-specific 1-5 rubrics.',
        updated_at = sysutcdatetime()
    WHERE id = @environmentTemplate;

    INSERT INTO forms.form_template_versions (
        id, form_template_id, version_label, active_from, is_published, created_by_user_account_id
    )
    SELECT @environmentVersion, @environmentTemplate, '2.0', sysutcdatetime(), 1,
           '41000000-0000-0000-0000-000000000001'
    WHERE NOT EXISTS (SELECT 1 FROM forms.form_template_versions WHERE id = @environmentVersion);

    INSERT INTO forms.form_sections (id, form_template_version_id, section_key, title, display_order)
    SELECT row_value.id, @environmentVersion, row_value.section_key, row_value.title, row_value.display_order
    FROM (VALUES
        (@environmentContext, 'room_context', 'Room and purpose', 1),
        (@environmentAspirational, 'aspirational', 'Aspirational', 2),
        (@environmentCollaborative, 'collaborative', 'Collaborative', 3),
        (@environmentRespectful, 'respectful', 'Respectful', 4),
        (@environmentInnovative, 'innovative', 'Innovative', 5),
        (@environmentInclusive, 'inclusive', 'Inclusive', 6),
        (@environmentOverall, 'overall_commentary', 'Overall commentary', 7)
    ) row_value(id, section_key, title, display_order)
    WHERE NOT EXISTS (SELECT 1 FROM forms.form_sections existing WHERE existing.id = row_value.id);

    INSERT INTO forms.form_fields (
        id, form_section_id, field_key, label, field_type, is_required,
        display_order, help_text, configuration_json
    )
    SELECT row_value.id, row_value.section_id, row_value.field_key, row_value.label,
           row_value.field_type, row_value.is_required, row_value.display_order,
           row_value.help_text, row_value.configuration_json
    FROM (VALUES
        (CONVERT(uniqueidentifier, '82000000-0000-0000-0000-000000000101'), @environmentContext, 'room_code', 'Room code', 'room_lookup', 1, 10, N'Type a room code to filter the room register.', CONVERT(nvarchar(max), NULL)),
        (CONVERT(uniqueidentifier, '82000000-0000-0000-0000-000000000102'), @environmentContext, 'building_name', 'Building', 'auto_text', 1, 20, N'Filled automatically from the room register.', NULL),
        (CONVERT(uniqueidentifier, '82000000-0000-0000-0000-000000000103'), @environmentContext, 'assessment_date', 'Date of audit', 'date', 1, 30, NULL, NULL),
        (CONVERT(uniqueidentifier, '82000000-0000-0000-0000-000000000104'), @environmentContext, 'intended_purpose', 'Intended curriculum purpose', 'long_text', 1, 40, N'Judge the environment against its intended curriculum purpose. Specialist environments should not be expected to operate like general classrooms.', NULL),

        (CONVERT(uniqueidentifier, '82000000-0000-0000-0000-000000000110'), @environmentAspirational, 'aspirational_score', 'Aspirational judgement', 'pillar_rubric_1_5', 1, 10, N'Consider readiness, current resources, curriculum purpose, quality, progression and pride.',
         N'{"options":["1::Emerging Practice::The environment inconsistently communicates high expectations. Presentation, organisation, condition or subject identity may limit learner pride and readiness.::#B42318","2::Developing Practice::Some areas reflect care, ambition and professional standards, but these are inconsistent or not yet embedded throughout the space.::#E56B1F","3::Secure Practice::The environment is well maintained, purposeful and appropriate for its intended use. It supports high standards and provides a professional learning setting.::#D7A700","4::Strong Practice::The space is thoughtfully organised and presented, reflects the curriculum or industry context, and encourages learners to take pride in their work.::#69A84F","5::Leading Practice::The environment consistently communicates exceptional ambition and authenticity. Learners demonstrate strong ownership, pride and professional behaviours within the space.::#237A3B"]}'),
        (CONVERT(uniqueidentifier, '82000000-0000-0000-0000-000000000111'), @environmentAspirational, 'aspirational_action', 'Highest-impact action', 'long_text', 0, 20, NULL, NULL),
        (CONVERT(uniqueidentifier, '82000000-0000-0000-0000-000000000112'), @environmentAspirational, 'aspirational_owner', 'Action owner', 'staff_lookup', 0, 30, NULL, NULL),
        (CONVERT(uniqueidentifier, '82000000-0000-0000-0000-000000000113'), @environmentAspirational, 'aspirational_target', 'Target date', 'date', 0, 40, NULL, NULL),

        (CONVERT(uniqueidentifier, '82000000-0000-0000-0000-000000000120'), @environmentCollaborative, 'collaborative_score', 'Collaborative judgement', 'pillar_rubric_1_5', 1, 10, N'Consider communication, demonstration, practice, visibility, movement and access to shared resources.',
         N'{"options":["1::Emerging Practice::The organisation of the room or access to resources restricts interaction, participation or shared learning where these are appropriate.::#B42318","2::Developing Practice::Some opportunities for collaboration are available, but the room’s organisation or use does not consistently support effective participation.::#E56B1F","3::Secure Practice::The space supports the intended balance of independent, paired, group, practical or teacher-led learning.::#D7A700","4::Strong Practice::The environment is deliberately organised to promote communication, peer learning, shared problem-solving and active participation.::#69A84F","5::Leading Practice::The space supports seamless movement between different forms of learning and enables learners to collaborate confidently, independently and purposefully.::#237A3B"]}'),
        (CONVERT(uniqueidentifier, '82000000-0000-0000-0000-000000000121'), @environmentCollaborative, 'collaborative_action', 'Highest-impact action', 'long_text', 0, 20, NULL, NULL),
        (CONVERT(uniqueidentifier, '82000000-0000-0000-0000-000000000122'), @environmentCollaborative, 'collaborative_owner', 'Action owner', 'staff_lookup', 0, 30, NULL, NULL),
        (CONVERT(uniqueidentifier, '82000000-0000-0000-0000-000000000123'), @environmentCollaborative, 'collaborative_target', 'Target date', 'date', 0, 40, NULL, NULL),

        (CONVERT(uniqueidentifier, '82000000-0000-0000-0000-000000000130'), @environmentRespectful, 'respectful_score', 'Respectful judgement', 'pillar_rubric_1_5', 1, 10, N'Consider care, safety, storage, comfort, privacy, subject standards and fault reporting.',
         N'{"options":["1::Emerging Practice::Issues with cleanliness, maintenance, comfort, safety or organisation undermine dignity, wellbeing or effective learning.::#B42318","2::Developing Practice::The space is generally usable, but standards of care, organisation or comfort are inconsistent.::#E56B1F","3::Secure Practice::The environment is clean, safe, orderly and well cared for. It supports learner dignity, comfort and professional conduct.::#D7A700","4::Strong Practice::The space is intentionally organised to promote calm, belonging, shared responsibility and positive learning behaviours.::#69A84F","5::Leading Practice::A strong culture of care and shared ownership is evident. The environment exceptionally supports dignity, wellbeing, respect and professional standards.::#237A3B"]}'),
        (CONVERT(uniqueidentifier, '82000000-0000-0000-0000-000000000131'), @environmentRespectful, 'respectful_action', 'Highest-impact action', 'long_text', 0, 20, NULL, NULL),
        (CONVERT(uniqueidentifier, '82000000-0000-0000-0000-000000000132'), @environmentRespectful, 'respectful_owner', 'Action owner', 'staff_lookup', 0, 30, NULL, NULL),
        (CONVERT(uniqueidentifier, '82000000-0000-0000-0000-000000000133'), @environmentRespectful, 'respectful_target', 'Target date', 'date', 0, 40, NULL, NULL),

        (CONVERT(uniqueidentifier, '82000000-0000-0000-0000-000000000140'), @environmentInnovative, 'innovative_score', 'Innovative judgement', 'pillar_rubric_1_5', 1, 10, N'Consider whether resources and equipment improve learning and support current or future practice.',
         N'{"options":["1::Emerging Practice::Available equipment, technology or learning resources are unreliable, inaccessible, unsuitable or insufficiently used to support learning.::#B42318","2::Developing Practice::Some appropriate resources are available and used, but implementation is inconsistent or dependent on repeated workarounds.::#E56B1F","3::Secure Practice::Technology, specialist equipment and other resources are functional, accessible and used appropriately to support the intended learning.::#D7A700","4::Strong Practice::The environment enables purposeful experimentation, creativity, simulation, authentic practice or new approaches to learning.::#69A84F","5::Leading Practice::The space demonstrates exemplary integration of specialist resources, technology and learning design, significantly extending what learners can experience and achieve.::#237A3B"]}'),
        (CONVERT(uniqueidentifier, '82000000-0000-0000-0000-000000000141'), @environmentInnovative, 'innovative_action', 'Highest-impact action', 'long_text', 0, 20, NULL, NULL),
        (CONVERT(uniqueidentifier, '82000000-0000-0000-0000-000000000142'), @environmentInnovative, 'innovative_owner', 'Action owner', 'staff_lookup', 0, 30, NULL, NULL),
        (CONVERT(uniqueidentifier, '82000000-0000-0000-0000-000000000143'), @environmentInnovative, 'innovative_target', 'Target date', 'date', 0, 40, NULL, NULL),

        (CONVERT(uniqueidentifier, '82000000-0000-0000-0000-000000000150'), @environmentInclusive, 'inclusion_score', 'Inclusive judgement', 'pillar_rubric_1_5', 1, 10, N'Consider access, participation, independence, clear instructions, sensory needs and dignified adjustments without reducing expectations.',
         N'{"options":["1::Emerging Practice::Significant barriers affect access, communication, navigation, sensory comfort, independence or participation.::#B42318","2::Developing Practice::Some inclusive features or adjustments are in place, but they are inconsistent, reactive or reliant on individual workarounds.::#E56B1F","3::Secure Practice::The environment supports safe, dignified and equitable participation, with reasonable adjustments available where required.::#D7A700","4::Strong Practice::The space anticipates a range of learner needs and provides appropriate flexibility, choice and support without reducing ambition.::#69A84F","5::Leading Practice::Inclusion is embedded throughout the environment. The space is highly accessible, adaptable and enabling, allowing diverse learners to participate independently and meaningfully.::#237A3B"]}'),
        (CONVERT(uniqueidentifier, '82000000-0000-0000-0000-000000000151'), @environmentInclusive, 'inclusion_action', 'Highest-impact action', 'long_text', 0, 20, NULL, NULL),
        (CONVERT(uniqueidentifier, '82000000-0000-0000-0000-000000000152'), @environmentInclusive, 'inclusion_owner', 'Action owner', 'staff_lookup', 0, 30, NULL, NULL),
        (CONVERT(uniqueidentifier, '82000000-0000-0000-0000-000000000153'), @environmentInclusive, 'inclusion_target', 'Target date', 'date', 0, 40, NULL, NULL),

        (CONVERT(uniqueidentifier, '82000000-0000-0000-0000-000000000160'), @environmentOverall, 'overall_working', 'What is Working', 'long_text', 0, 10, N'Record evidence that applies to the learning environment as a whole.', NULL),
        (CONVERT(uniqueidentifier, '82000000-0000-0000-0000-000000000161'), @environmentOverall, 'overall_improvement', 'What Needs Improvement', 'long_text', 0, 20, N'Record the most important improvements for the learning environment as a whole.', NULL)
    ) row_value(id, section_id, field_key, label, field_type, is_required, display_order, help_text, configuration_json)
    WHERE NOT EXISTS (SELECT 1 FROM forms.form_fields existing WHERE existing.id = row_value.id);
END;

IF COL_LENGTH('quality.elevate_environment_assessments', 'below_secure_count') IS NULL
BEGIN
    ALTER TABLE quality.elevate_environment_assessments
    ADD below_secure_count tinyint NOT NULL
        CONSTRAINT df_elevate_assessments_below_secure DEFAULT 0;
END;

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_elevate_assessments_total')
    ALTER TABLE quality.elevate_environment_assessments DROP CONSTRAINT ck_elevate_assessments_total;

ALTER TABLE quality.elevate_environment_assessments
ADD CONSTRAINT ck_elevate_assessments_total CHECK (total_score BETWEEN 0 AND 25);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_elevate_assessments_below_secure')
BEGIN
    EXEC(N'ALTER TABLE quality.elevate_environment_assessments
        ADD CONSTRAINT ck_elevate_assessments_below_secure CHECK (below_secure_count BETWEEN 0 AND 5);');
END;

-- External CPD is a separate versioned form and record type. It shares the
-- CPD event/attendance reporting tables, but can only enrol the current user.
DECLARE @cpdModule uniqueidentifier = (SELECT id FROM core.modules WHERE module_key = 'cpd');
DECLARE @externalTemplate uniqueidentifier = '78000000-0000-0000-0000-000000000011';
DECLARE @externalVersion uniqueidentifier = '78000000-0000-0000-0000-000000000012';
DECLARE @externalDetails uniqueidentifier = '78000000-0000-0000-0000-000000000013';
DECLARE @externalLearning uniqueidentifier = '78000000-0000-0000-0000-000000000014';

IF @cpdModule IS NOT NULL
BEGIN
    INSERT INTO forms.form_templates (id, module_id, template_key, name, description, is_active)
    SELECT @externalTemplate, @cpdModule, 'external_cpd_core', 'External CPD',
           'Self-service external CPD record for the signed-in staff member.', 1
    WHERE NOT EXISTS (SELECT 1 FROM forms.form_templates WHERE template_key = 'external_cpd_core');

    INSERT INTO forms.form_template_versions (
        id, form_template_id, version_label, active_from, is_published, created_by_user_account_id
    )
    SELECT @externalVersion, @externalTemplate, '1.0', sysutcdatetime(), 1,
           '41000000-0000-0000-0000-000000000001'
    WHERE NOT EXISTS (SELECT 1 FROM forms.form_template_versions WHERE id = @externalVersion);

    INSERT INTO forms.form_sections (id, form_template_version_id, section_key, title, display_order)
    SELECT row_value.id, @externalVersion, row_value.section_key, row_value.title, row_value.display_order
    FROM (VALUES
        (@externalDetails, 'activity_details', 'Activity details', 1),
        (@externalLearning, 'learning_impact', 'Learning and impact', 2)
    ) row_value(id, section_key, title, display_order)
    WHERE NOT EXISTS (SELECT 1 FROM forms.form_sections existing WHERE existing.id = row_value.id);

    INSERT INTO forms.form_fields (
        id, form_section_id, field_key, label, field_type, is_required,
        display_order, help_text, configuration_json
    )
    SELECT row_value.id, row_value.section_id, row_value.field_key, row_value.label,
           row_value.field_type, row_value.is_required, row_value.display_order,
           row_value.help_text, row_value.configuration_json
    FROM (VALUES
        (CONVERT(uniqueidentifier, '79000000-0000-0000-0000-000000000011'), @externalDetails, 'date_time', 'Date and time', 'datetime', 1, 10, CONVERT(nvarchar(1000), NULL), CONVERT(nvarchar(max), NULL)),
        (CONVERT(uniqueidentifier, '79000000-0000-0000-0000-000000000012'), @externalDetails, 'cpd_title', 'CPD title', 'short_text', 1, 20, NULL, NULL),
        (CONVERT(uniqueidentifier, '79000000-0000-0000-0000-000000000013'), @externalDetails, 'external_provider', 'Provider', 'short_text', 1, 30, NULL, NULL),
        (CONVERT(uniqueidentifier, '79000000-0000-0000-0000-000000000014'), @externalDetails, 'duration_hours', 'Duration (hours)', 'number', 0, 40, NULL, NULL),
        (CONVERT(uniqueidentifier, '79000000-0000-0000-0000-000000000015'), @externalLearning, 'cpd_themes', 'CPD theme', 'checkbox_group', 1, 10, N'Select every theme that applies.', NULL),
        (CONVERT(uniqueidentifier, '79000000-0000-0000-0000-000000000016'), @externalLearning, 'learning_summary', 'What did you learn?', 'long_text', 1, 20, NULL, NULL),
        (CONVERT(uniqueidentifier, '79000000-0000-0000-0000-000000000017'), @externalLearning, 'impact_plan', 'How will this influence your practice?', 'long_text', 1, 30, NULL, NULL),
        (CONVERT(uniqueidentifier, '79000000-0000-0000-0000-000000000018'), @externalLearning, 'evidence_reference', 'Evidence or certificate reference', 'long_text', 0, 40, N'Add a link, certificate reference or other evidence note.', NULL)
    ) row_value(id, section_id, field_key, label, field_type, is_required, display_order, help_text, configuration_json)
    WHERE NOT EXISTS (SELECT 1 FROM forms.form_fields existing WHERE existing.id = row_value.id);
END;

COMMIT TRANSACTION;
GO
