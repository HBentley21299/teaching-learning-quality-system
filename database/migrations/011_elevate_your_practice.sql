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

IF OBJECT_ID('quality.elevate_practice_frameworks', 'U') IS NULL
BEGIN
    CREATE TABLE quality.elevate_practice_frameworks (
        id uniqueidentifier NOT NULL CONSTRAINT pk_elevate_practice_frameworks PRIMARY KEY DEFAULT newsequentialid(),
        framework_key nvarchar(100) NOT NULL,
        version_label nvarchar(50) NOT NULL,
        name nvarchar(250) NOT NULL,
        is_active bit NOT NULL CONSTRAINT df_elevate_practice_frameworks_active DEFAULT 1,
        created_at datetimeoffset NOT NULL CONSTRAINT df_elevate_practice_frameworks_created DEFAULT sysutcdatetime(),
        archived_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT uq_elevate_practice_frameworks UNIQUE (framework_key, version_label)
    );
END;

IF OBJECT_ID('quality.elevate_practice_areas', 'U') IS NULL
BEGIN
    CREATE TABLE quality.elevate_practice_areas (
        id uniqueidentifier NOT NULL CONSTRAINT pk_elevate_practice_areas PRIMARY KEY DEFAULT newsequentialid(),
        framework_id uniqueidentifier NOT NULL,
        area_key nvarchar(100) NOT NULL,
        category nvarchar(100) NOT NULL,
        name nvarchar(250) NOT NULL,
        reflection_prompt nvarchar(1000) NOT NULL,
        display_order int NOT NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_elevate_practice_areas_created DEFAULT sysutcdatetime(),
        row_version rowversion NOT NULL,
        CONSTRAINT fk_elevate_practice_areas_framework FOREIGN KEY (framework_id) REFERENCES quality.elevate_practice_frameworks(id),
        CONSTRAINT uq_elevate_practice_areas UNIQUE (framework_id, area_key)
    );
END;

IF OBJECT_ID('quality.elevate_practice_statements', 'U') IS NULL
BEGIN
    CREATE TABLE quality.elevate_practice_statements (
        id uniqueidentifier NOT NULL CONSTRAINT pk_elevate_practice_statements PRIMARY KEY DEFAULT newsequentialid(),
        area_id uniqueidentifier NOT NULL,
        statement_key nvarchar(100) NOT NULL,
        statement_text nvarchar(1000) NOT NULL,
        display_order int NOT NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_elevate_practice_statements_created DEFAULT sysutcdatetime(),
        row_version rowversion NOT NULL,
        CONSTRAINT fk_elevate_practice_statements_area FOREIGN KEY (area_id) REFERENCES quality.elevate_practice_areas(id),
        CONSTRAINT uq_elevate_practice_statements UNIQUE (area_id, statement_key)
    );
END;

IF OBJECT_ID('quality.elevate_practice_assessments', 'U') IS NULL
BEGIN
    CREATE TABLE quality.elevate_practice_assessments (
        id uniqueidentifier NOT NULL CONSTRAINT pk_elevate_practice_assessments PRIMARY KEY DEFAULT newsequentialid(),
        record_id uniqueidentifier NOT NULL,
        framework_id uniqueidentifier NOT NULL,
        staff_id uniqueidentifier NOT NULL,
        academic_year nvarchar(7) NOT NULL,
        status nvarchar(20) NOT NULL CONSTRAINT df_elevate_practice_assessments_status DEFAULT 'draft',
        submitted_at datetimeoffset NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_elevate_practice_assessments_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT fk_elevate_practice_assessments_record FOREIGN KEY (record_id) REFERENCES core.records(id),
        CONSTRAINT fk_elevate_practice_assessments_framework FOREIGN KEY (framework_id) REFERENCES quality.elevate_practice_frameworks(id),
        CONSTRAINT fk_elevate_practice_assessments_staff FOREIGN KEY (staff_id) REFERENCES people.staff(id),
        CONSTRAINT uq_elevate_practice_assessments_record UNIQUE (record_id),
        CONSTRAINT uq_elevate_practice_assessments_year UNIQUE (staff_id, academic_year),
        CONSTRAINT ck_elevate_practice_assessments_status CHECK (status IN ('draft', 'submitted'))
    );
END;

IF OBJECT_ID('quality.elevate_practice_ratings', 'U') IS NULL
BEGIN
    CREATE TABLE quality.elevate_practice_ratings (
        assessment_id uniqueidentifier NOT NULL,
        statement_id uniqueidentifier NOT NULL,
        score tinyint NOT NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_elevate_practice_ratings_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT pk_elevate_practice_ratings PRIMARY KEY (assessment_id, statement_id),
        CONSTRAINT fk_elevate_practice_ratings_assessment FOREIGN KEY (assessment_id) REFERENCES quality.elevate_practice_assessments(id),
        CONSTRAINT fk_elevate_practice_ratings_statement FOREIGN KEY (statement_id) REFERENCES quality.elevate_practice_statements(id),
        CONSTRAINT ck_elevate_practice_ratings_score CHECK (score BETWEEN 1 AND 5)
    );
END;

IF OBJECT_ID('quality.elevate_practice_reflections', 'U') IS NULL
BEGIN
    CREATE TABLE quality.elevate_practice_reflections (
        assessment_id uniqueidentifier NOT NULL,
        area_id uniqueidentifier NOT NULL,
        reflection_text nvarchar(max) NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_elevate_practice_reflections_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT pk_elevate_practice_reflections PRIMARY KEY (assessment_id, area_id),
        CONSTRAINT fk_elevate_practice_reflections_assessment FOREIGN KEY (assessment_id) REFERENCES quality.elevate_practice_assessments(id),
        CONSTRAINT fk_elevate_practice_reflections_area FOREIGN KEY (area_id) REFERENCES quality.elevate_practice_areas(id)
    );
END;

IF OBJECT_ID('quality.elevate_practice_selections', 'U') IS NULL
BEGIN
    CREATE TABLE quality.elevate_practice_selections (
        assessment_id uniqueidentifier NOT NULL,
        area_id uniqueidentifier NOT NULL,
        selection_type nvarchar(20) NOT NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_elevate_practice_selections_created DEFAULT sysutcdatetime(),
        CONSTRAINT pk_elevate_practice_selections PRIMARY KEY (assessment_id, area_id, selection_type),
        CONSTRAINT fk_elevate_practice_selections_assessment FOREIGN KEY (assessment_id) REFERENCES quality.elevate_practice_assessments(id),
        CONSTRAINT fk_elevate_practice_selections_area FOREIGN KEY (area_id) REFERENCES quality.elevate_practice_areas(id),
        CONSTRAINT ck_elevate_practice_selections_type CHECK (selection_type IN ('strength', 'development'))
    );
END;

IF OBJECT_ID('quality.elevate_practice_development_plans', 'U') IS NULL
BEGIN
    CREATE TABLE quality.elevate_practice_development_plans (
        id uniqueidentifier NOT NULL CONSTRAINT pk_elevate_practice_development_plans PRIMARY KEY DEFAULT newsequentialid(),
        assessment_id uniqueidentifier NOT NULL,
        area_id uniqueidentifier NOT NULL,
        development_approach nvarchar(max) NULL,
        support_keys_json nvarchar(max) NULL,
        support_details nvarchar(max) NULL,
        success_evidence nvarchar(max) NULL,
        intended_impact nvarchar(max) NULL,
        review_date date NULL,
        action_id uniqueidentifier NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_elevate_practice_plans_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT fk_elevate_practice_plans_assessment FOREIGN KEY (assessment_id) REFERENCES quality.elevate_practice_assessments(id),
        CONSTRAINT fk_elevate_practice_plans_area FOREIGN KEY (area_id) REFERENCES quality.elevate_practice_areas(id),
        CONSTRAINT fk_elevate_practice_plans_action FOREIGN KEY (action_id) REFERENCES quality.actions(id),
        CONSTRAINT uq_elevate_practice_plans_area UNIQUE (assessment_id, area_id),
        CONSTRAINT ck_elevate_practice_plans_support_json CHECK (support_keys_json IS NULL OR ISJSON(support_keys_json) = 1)
    );
END;

INSERT INTO core.modules (id, module_key, name, route_prefix, display_order, description)
SELECT '50000000-0000-0000-0000-000000000011', 'elevate_practice', 'Elevate Your Practice', '/elevate-your-practice', 48,
       'Annual staff self-assessment, practice profile and development planning.'
WHERE NOT EXISTS (SELECT 1 FROM core.modules WHERE module_key = 'elevate_practice');

INSERT INTO auth.permissions (id, permission_key, name, category)
SELECT '31000000-0000-0000-0000-000000000018', 'elevate_practice.submit', 'Complete Elevate Your Practice', 'Elevate Your Practice'
WHERE NOT EXISTS (SELECT 1 FROM auth.permissions WHERE permission_key = 'elevate_practice.submit');

INSERT INTO auth.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM auth.roles r
CROSS JOIN auth.permissions p
WHERE p.permission_key = 'elevate_practice.submit'
  AND r.role_key IN ('super_admin', 'teaching_learning_team', 'director', 'head_of_faculty', 'programme_leader', 'staff')
  AND r.is_active = 1
  AND NOT EXISTS (
      SELECT 1 FROM auth.role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

DECLARE @supportLookupId uniqueidentifier = '10000000-0000-0000-0000-000000000008';
INSERT INTO core.lookup_types (id, lookup_key, name, is_system)
SELECT @supportLookupId, 'elevate_practice_support', 'Elevate Your Practice Support', 0
WHERE NOT EXISTS (SELECT 1 FROM core.lookup_types WHERE lookup_key = 'elevate_practice_support');
SET @supportLookupId = (SELECT id FROM core.lookup_types WHERE lookup_key = 'elevate_practice_support');

DECLARE @supportValues TABLE (id uniqueidentifier, value_key nvarchar(100), display_name nvarchar(200), display_order int);
INSERT INTO @supportValues VALUES
('18100000-0000-0000-0000-000000000001', 'elevate_cpd', 'Elevate CPD session', 1),
('18100000-0000-0000-0000-000000000002', 'faculty_cpd', 'Faculty CPD', 2),
('18100000-0000-0000-0000-000000000003', 'digital_support', 'Digital teaching and learning support', 3),
('18100000-0000-0000-0000-000000000004', 'assistive_support', 'Assistive technology support', 4),
('18100000-0000-0000-0000-000000000005', 'immersive_support', 'Immersive technology support', 5),
('18100000-0000-0000-0000-000000000006', 'sustainability_support', 'Sustainability support or resources', 6),
('18100000-0000-0000-0000-000000000007', 'coaching_mentoring', 'Coaching or mentoring', 7),
('18100000-0000-0000-0000-000000000008', 'observe_colleague', 'Observation of a colleague', 8),
('18100000-0000-0000-0000-000000000009', 'collaborative_planning', 'Collaborative planning', 9),
('18100000-0000-0000-0000-000000000010', 'professional_updating', 'Professional or industry updating', 10),
('18100000-0000-0000-0000-000000000011', 'independent_research', 'Independent research', 11),
('18100000-0000-0000-0000-000000000012', 'resource_development', 'Resource development', 12),
('18100000-0000-0000-0000-000000000013', 'other', 'Other', 13);

INSERT INTO core.lookup_values (id, lookup_type_id, value_key, display_name, display_order)
SELECT sv.id, @supportLookupId, sv.value_key, sv.display_name, sv.display_order
FROM @supportValues sv
WHERE NOT EXISTS (
    SELECT 1 FROM core.lookup_values lv
    WHERE lv.lookup_type_id = @supportLookupId AND lv.value_key = sv.value_key
);

DECLARE @frameworkId uniqueidentifier = '90000000-0000-0000-0000-000000000001';
INSERT INTO quality.elevate_practice_frameworks (id, framework_key, version_label, name, is_active)
SELECT @frameworkId, 'elevate_your_practice', '1.0', 'Elevate Your Practice Staff Self-Assessment', 1
WHERE NOT EXISTS (
    SELECT 1 FROM quality.elevate_practice_frameworks WHERE framework_key = 'elevate_your_practice' AND version_label = '1.0'
);

DECLARE @areas TABLE (
    id uniqueidentifier,
    area_key nvarchar(100),
    category nvarchar(100),
    name nvarchar(250),
    reflection_prompt nvarchar(1000),
    display_order int
);
INSERT INTO @areas VALUES
('91000000-0000-0000-0000-000000000001', 'positive_start', 'Teaching and Learning Standards', 'Positive Start', 'What does an effective positive start look like within your practice? Provide an example where possible.', 1),
('91000000-0000-0000-0000-000000000002', 'planning_structure', 'Teaching and Learning Standards', 'Planning and Structure', 'How does your planning and sequencing support learner understanding and progress?', 2),
('91000000-0000-0000-0000-000000000003', 'delivery', 'Teaching and Learning Standards', 'Delivery', 'Describe a teaching approach that has been particularly effective with your learners.', 3),
('91000000-0000-0000-0000-000000000004', 'assessment_feedback', 'Teaching and Learning Standards', 'Assessment and Feedback', 'Give an example of how assessment or feedback influenced what you or your learners did next.', 4),
('91000000-0000-0000-0000-000000000005', 'inclusion', 'Teaching and Learning Standards', 'Inclusion', 'Describe an inclusive approach or adjustment that has enabled learners to participate or progress more successfully.', 5),
('91000000-0000-0000-0000-000000000006', 'learner_focus', 'Teaching and Learning Standards', 'Learner Focus', 'How do you ensure that learning is responsive to individual learners and their intended destinations?', 6),
('91000000-0000-0000-0000-000000000007', 'digital_teaching_learning', 'Digital Practice', 'Digital Teaching and Learning', 'Describe how digital technology has improved learning, participation, assessment, feedback or learner independence.', 7),
('91000000-0000-0000-0000-000000000008', 'assistive_technology', 'Digital Practice', 'Assistive Technology', 'Describe how assistive technology or accessible digital practice has reduced a barrier for learners.', 8),
('91000000-0000-0000-0000-000000000009', 'immersive_technology', 'Digital Practice', 'Immersive Technology', 'Describe any current or potential use of immersive technology within your curriculum and the intended benefit for learners.', 9),
('91000000-0000-0000-0000-000000000010', 'sustainability_curriculum', 'Sustainability', 'Sustainability in Curriculum and Practice', 'How is sustainability currently reflected within your teaching, curriculum or professional practice?', 10),
('91000000-0000-0000-0000-000000000011', 'sustainable_resources', 'Sustainability', 'Sustainable Use of Resources', 'Provide an example of how responsible or sustainable resource use is promoted within your practice.', 11);

INSERT INTO quality.elevate_practice_areas (id, framework_id, area_key, category, name, reflection_prompt, display_order)
SELECT a.id, @frameworkId, a.area_key, a.category, a.name, a.reflection_prompt, a.display_order
FROM @areas a
WHERE NOT EXISTS (
    SELECT 1 FROM quality.elevate_practice_areas existing WHERE existing.framework_id = @frameworkId AND existing.area_key = a.area_key
);

DECLARE @statements TABLE (area_key nvarchar(100), statement_key nvarchar(100), statement_text nvarchar(1000), display_order int);
INSERT INTO @statements VALUES
('positive_start', 'routines_expectations', 'I establish clear routines, expectations and professional standards.', 1),
('positive_start', 'purposeful_start', 'Learning begins promptly with a purposeful activity.', 2),
('positive_start', 'connects_learning', 'The start of learning connects to previous learning or prepares learners for what follows.', 3),
('positive_start', 'purpose_understood', 'Learners understand what they are learning and why it matters.', 4),
('positive_start', 'welcoming_environment', 'I create a welcoming, calm and purposeful learning environment.', 5),
('planning_structure', 'logical_sequence', 'Learning is logically sequenced and builds on previous knowledge and skills.', 1),
('planning_structure', 'appropriate_pace', 'Learning is appropriately paced and broken into manageable stages.', 2),
('planning_structure', 'anticipates_barriers', 'My planning identifies likely misconceptions and barriers to learning.', 3),
('planning_structure', 'support_challenge', 'My planning includes appropriate support and additional challenge.', 4),
('planning_structure', 'wider_connections', 'Learners understand how individual activities connect to their wider course, assessment or destination.', 5),
('delivery', 'clear_explanations', 'I provide clear explanations and instructions.', 1),
('delivery', 'effective_modelling', 'I use effective modelling, demonstrations and examples.', 2),
('delivery', 'active_learning', 'Learners are actively thinking, discussing, practising, creating or applying their learning.', 3),
('delivery', 'responsive_adaptation', 'I adapt my delivery in response to learners'' needs and understanding.', 4),
('delivery', 'current_expectations', 'Teaching reflects current subject, industry or professional expectations.', 5),
('delivery', 'appropriate_challenge', 'Learning provides appropriate challenge and avoids unnecessary periods of passivity.', 6),
('assessment_feedback', 'check_all_understanding', 'I regularly check the understanding of all learners.', 1),
('assessment_feedback', 'questioning_diagnoses', 'My questioning helps identify misconceptions, gaps and levels of understanding.', 2),
('assessment_feedback', 'adapt_from_assessment', 'I adapt teaching in response to assessment information.', 3),
('assessment_feedback', 'specific_feedback', 'Feedback is clear, specific and focused on improvement.', 4),
('assessment_feedback', 'act_on_feedback', 'Learners understand how to act on feedback.', 5),
('assessment_feedback', 'demonstrate_improvement', 'Learners have opportunities to demonstrate that they have improved.', 6),
('inclusion', 'learner_information', 'I use available learner information to inform my planning and teaching.', 1),
('inclusion', 'reduce_barriers', 'I anticipate and reduce barriers to participation and learning.', 2),
('inclusion', 'accessible_resources', 'Resources and activities are accessible to the learners using them.', 3),
('inclusion', 'adjustments', 'I make effective use of support strategies and reasonable adjustments.', 4),
('inclusion', 'participation', 'All learners are encouraged and supported to participate.', 5),
('inclusion', 'belonging', 'Learners experience a sense of respect, safety and belonging.', 6),
('learner_focus', 'starting_points', 'I understand learners'' starting points, aspirations and intended destinations.', 1),
('learner_focus', 'adapt_to_needs', 'Learning is adapted appropriately to reflect different learner needs.', 2),
('learner_focus', 'reflect_potential', 'Learners are challenged to produce work that reflects their potential.', 3),
('learner_focus', 'independence', 'Learners are supported to become increasingly independent.', 4),
('learner_focus', 'progress_next_steps', 'Learners understand their current progress and next steps.', 5),
('learner_focus', 'learner_voice', 'Learner voice and feedback are used to improve the learning experience.', 6),
('digital_teaching_learning', 'purposeful_technology', 'I select digital technology because it improves learning rather than simply replacing an existing activity.', 1),
('digital_teaching_learning', 'consistent_environment', 'Learners experience a consistent and well-organised digital learning environment.', 2),
('digital_teaching_learning', 'locatable_resources', 'Digital resources are clear, current and easy for learners to locate.', 3),
('digital_teaching_learning', 'digital_participation', 'I use digital tools to increase learner participation and interaction.', 4),
('digital_teaching_learning', 'digital_assessment', 'I use digital technology to support assessment and feedback.', 5),
('digital_teaching_learning', 'digital_independence', 'Digital activities support independent learning and learner agency.', 6),
('digital_teaching_learning', 'learner_confidence', 'I develop learners'' confidence in using technology relevant to their course or future destination.', 7),
('digital_teaching_learning', 'safe_ethical_use', 'I model safe, responsible and ethical use of technology, including artificial intelligence.', 8),
('assistive_technology', 'broad_benefit', 'I understand that assistive technology can benefit a wide range of learners.', 1),
('assistive_technology', 'accessibility_selection', 'I consider accessibility when creating or selecting digital resources.', 2),
('assistive_technology', 'accessible_formats', 'I use accessible document formats, layouts, fonts and presentation methods.', 3),
('assistive_technology', 'awareness_tools', 'I make learners aware of relevant accessibility features and assistive tools.', 4),
('assistive_technology', 'confident_use', 'I support learners to use assistive technology confidently and independently.', 5),
('assistive_technology', 'appropriate_tools', 'I use tools such as text-to-speech, speech-to-text, captions, translation or reading support where appropriate.', 6),
('assistive_technology', 'embedded_assistive', 'Assistive technology is embedded into everyday practice rather than only introduced when difficulties arise.', 7),
('immersive_technology', 'available_technology', 'I understand the immersive technology available within the college.', 1),
('immersive_technology', 'curriculum_opportunity', 'I can identify where immersive technology could meaningfully support my curriculum.', 2),
('immersive_technology', 'curriculum_connection', 'Immersive activities are clearly connected to curriculum knowledge, skills or assessment.', 3),
('immersive_technology', 'learner_preparation', 'I prepare learners appropriately before immersive activities.', 4),
('immersive_technology', 'active_reflection', 'Learners actively apply, discuss or reflect on what they experience.', 5),
('immersive_technology', 'unique_experiences', 'I use immersive technology to provide experiences that would otherwise be difficult, unsafe or costly to reproduce.', 6),
('immersive_technology', 'evaluate_impact', 'I evaluate whether immersive activities have improved understanding, confidence or practical readiness.', 7),
('sustainability_curriculum', 'relevant_issues', 'I understand the sustainability issues most relevant to my subject or vocational area.', 1),
('sustainability_curriculum', 'curriculum_content', 'Sustainability is meaningfully connected to curriculum content where relevant.', 2),
('sustainability_curriculum', 'environmental_impact', 'Learners consider the environmental impact of decisions and professional practices.', 3),
('sustainability_curriculum', 'social_ethical_impact', 'Learners consider the social, ethical and economic impact of decisions.', 4),
('sustainability_curriculum', 'industry_change', 'I help learners understand how sustainability is changing their industry, profession or community.', 5),
('sustainability_curriculum', 'green_careers', 'Learners develop knowledge or skills connected to sustainable employment and green careers.', 6),
('sustainability_curriculum', 'evaluate_alternatives', 'Learners have opportunities to evaluate alternatives and propose more sustainable approaches.', 7),
('sustainability_curriculum', 'embedded_sustainability', 'Sustainability is embedded within learning rather than treated as an isolated activity.', 8),
('sustainable_resources', 'physical_resources', 'I model responsible use of physical resources, equipment and materials.', 1),
('sustainable_resources', 'reduce_waste', 'I reduce unnecessary printing, waste and duplication where appropriate.', 2),
('sustainable_resources', 'effective_digital_resources', 'I make effective use of digital resources without creating unnecessary barriers.', 3),
('sustainable_resources', 'learner_resource_use', 'Learners understand the importance of responsible resource use within their subject or industry.', 4),
('sustainable_resources', 'long_term_impact', 'I encourage learners to consider the longer-term impact of their choices and actions.', 5);

INSERT INTO quality.elevate_practice_statements (area_id, statement_key, statement_text, display_order)
SELECT a.id, s.statement_key, s.statement_text, s.display_order
FROM @statements s
JOIN quality.elevate_practice_areas a ON a.framework_id = @frameworkId AND a.area_key = s.area_key
WHERE NOT EXISTS (
    SELECT 1 FROM quality.elevate_practice_statements existing
    WHERE existing.area_id = a.id AND existing.statement_key = s.statement_key
);

COMMIT TRANSACTION;
GO
