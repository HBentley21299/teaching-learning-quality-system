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

INSERT INTO auth.permissions (id, permission_key, name, description, category, is_system)
SELECT CONVERT(uniqueidentifier, '31000000-0000-0000-0000-000000000039'),
       N'uco_tla.manage', N'Manage UCO TLA Reviews',
       N'Create, moderate, report on and export UCO Teaching, Learning and Assessment Reviews.',
       N'UCO Teaching & Learning', 1
WHERE NOT EXISTS (SELECT 1 FROM auth.permissions WHERE permission_key = N'uco_tla.manage');

INSERT INTO auth.roles (id, role_key, name, description, is_system, precedence)
SELECT CONVERT(uniqueidentifier, '30000000-0000-0000-0000-000000000010'),
       N'uco_teaching_learning', N'UCO Teaching & Learning',
       N'Coordinates and moderates UCO Teaching, Learning and Assessment Reviews without broader faculty permissions.',
       1, 350
WHERE NOT EXISTS (SELECT 1 FROM auth.roles WHERE role_key = N'uco_teaching_learning');

INSERT INTO auth.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM auth.roles role
JOIN auth.permissions permission ON permission.permission_key = N'uco_tla.manage'
WHERE role.role_key = N'uco_teaching_learning'
  AND NOT EXISTS (
      SELECT 1 FROM auth.role_permissions existing
      WHERE existing.role_id = role.id AND existing.permission_id = permission.id
  );

-- The UCO role is deliberately scoped. Export and action operations recognise
-- uco_tla.manage directly instead of inheriting the platform-wide permissions.
DELETE role_permission
FROM auth.role_permissions role_permission
JOIN auth.roles role ON role.id = role_permission.role_id
JOIN auth.permissions permission ON permission.id = role_permission.permission_id
WHERE role.role_key = N'uco_teaching_learning'
  AND permission.permission_key IN (N'exports.create', N'actions.manage');

INSERT INTO auth.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM auth.roles role
JOIN auth.permissions permission ON permission.permission_key = N'uco_tla.manage'
WHERE role.role_key = N'super_admin'
  AND NOT EXISTS (
      SELECT 1 FROM auth.role_permissions existing
      WHERE existing.role_id = role.id AND existing.permission_id = permission.id
  );

INSERT INTO core.modules (id, module_key, name, description, route_prefix, display_order, is_enabled)
SELECT CONVERT(uniqueidentifier, '50000000-0000-0000-0000-000000000018'),
       N'uco_tla_reviews', N'UCO TLA Reviews',
       N'Moderated Teaching, Learning and Assessment Reviews for University Centre Oldham.',
       N'/uco-tla-reviews', 37, 1
WHERE NOT EXISTS (SELECT 1 FROM core.modules WHERE module_key = N'uco_tla_reviews');

INSERT INTO org.org_units (id, parent_org_unit_id, org_unit_type, code, name, description, is_active)
SELECT CONVERT(uniqueidentifier, '21000000-0000-0000-0000-000000000001'), NULL,
       N'faculty', N'UCO', N'University Centre Oldham',
       N'Stable organisation root for University Centre Oldham provision.', 1
WHERE NOT EXISTS (SELECT 1 FROM org.org_units WHERE code = N'UCO');

DECLARE @moduleId uniqueidentifier = (SELECT id FROM core.modules WHERE module_key = N'uco_tla_reviews');
DECLARE @ucoOrgUnitId uniqueidentifier = (SELECT id FROM org.org_units WHERE code = N'UCO');
DECLARE @templateId uniqueidentifier = '74000000-0000-0000-0000-000000000009';
DECLARE @versionId uniqueidentifier = '75000000-0000-0000-0000-000000000009';

INSERT INTO forms.form_templates (id, module_id, template_key, name, description, is_active)
SELECT @templateId, @moduleId, N'uco_tla_review_core', N'UCO Teaching, Learning and Assessment Review',
       N'The moderated UCO review form. Criteria collect narrative evidence only; no rating is stored.', 1
WHERE NOT EXISTS (SELECT 1 FROM forms.form_templates WHERE template_key = N'uco_tla_review_core');

SELECT @templateId = id FROM forms.form_templates WHERE template_key = N'uco_tla_review_core';

INSERT INTO forms.form_template_versions (
    id, form_template_id, version_label, active_from, is_published
)
SELECT @versionId, @templateId, N'2025/26', CONVERT(datetimeoffset, '2025-08-01T00:00:00+00:00'), 1
WHERE NOT EXISTS (
    SELECT 1 FROM forms.form_template_versions
    WHERE form_template_id = @templateId AND version_label = N'2025/26'
);

SELECT @versionId = id
FROM forms.form_template_versions
WHERE form_template_id = @templateId AND version_label = N'2025/26';

INSERT INTO forms.form_template_org_units (form_template_id, org_unit_id, assignment_type)
SELECT @templateId, @ucoOrgUnitId, N'applies_to'
WHERE NOT EXISTS (
    SELECT 1 FROM forms.form_template_org_units
    WHERE form_template_id = @templateId AND org_unit_id = @ucoOrgUnitId AND assignment_type = N'applies_to'
);

DECLARE @sections TABLE (
    id uniqueidentifier NOT NULL,
    section_key nvarchar(100) NOT NULL,
    title nvarchar(250) NOT NULL,
    description nvarchar(1000) NULL,
    display_order int NOT NULL
);

INSERT INTO @sections (id, section_key, title, description, display_order)
VALUES
('76000000-0000-0000-0000-000000000090', N'course_session', N'Course and session details', N'Scheduling, course and attendance details.', 10),
('76000000-0000-0000-0000-000000000091', N'curriculum_development', N'Teaching and learning activities', N'Narrative evidence for curriculum and learner development.', 20),
('76000000-0000-0000-0000-000000000092', N'delivery_facilitation', N'Delivery and facilitation of teaching and learning', N'Narrative evidence for each delivery criterion.', 30),
('76000000-0000-0000-0000-000000000093', N'learning_materials', N'Teaching, learning and assessment materials', N'Narrative evidence about the resources supporting learning.', 40),
('76000000-0000-0000-0000-000000000094', N'findings', N'Findings and actions', N'Good practice, essential and advisable actions, and excellent-practice sharing.', 50),
('76000000-0000-0000-0000-000000000095', N'reflection_development', N'Reflection and development', N'Lecturer reflection and the structured development action plan.', 60);

INSERT INTO forms.form_sections (id, form_template_version_id, section_key, title, description, display_order)
SELECT source.id, @versionId, source.section_key, source.title, source.description, source.display_order
FROM @sections source
WHERE NOT EXISTS (
    SELECT 1 FROM forms.form_sections existing
    WHERE existing.form_template_version_id = @versionId AND existing.section_key = source.section_key
);

DECLARE @fields TABLE (
    id uniqueidentifier NOT NULL,
    section_key nvarchar(100) NOT NULL,
    field_key nvarchar(100) NOT NULL,
    label nvarchar(300) NOT NULL,
    field_type nvarchar(50) NOT NULL,
    is_required bit NOT NULL,
    display_order int NOT NULL,
    help_text nvarchar(1000) NULL
);

INSERT INTO @fields (id, section_key, field_key, label, field_type, is_required, display_order, help_text)
VALUES
('77000000-0000-0000-0000-000000000090', N'course_session', N'observation_at', N'Date/time of observation', N'datetime', 1, 10, NULL),
('77000000-0000-0000-0000-000000000091', N'course_session', N'session_type', N'Session type', N'text', 1, 20, NULL),
('77000000-0000-0000-0000-000000000092', N'course_session', N'course_title', N'Course title', N'text', 1, 30, NULL),
('77000000-0000-0000-0000-000000000093', N'course_session', N'module_title', N'Module title', N'text', 1, 40, NULL),
('77000000-0000-0000-0000-000000000094', N'course_session', N'course_level', N'Level', N'text', 1, 50, NULL),
('77000000-0000-0000-0000-000000000095', N'course_session', N'number_registered', N'Number on register', N'number', 0, 60, NULL),
('77000000-0000-0000-0000-000000000096', N'course_session', N'number_present', N'Number present', N'number', 0, 70, N'Must not exceed the number on register.'),
('77000000-0000-0000-0000-000000000097', N'course_session', N'number_late', N'Number arriving late', N'number', 0, 80, N'Must not exceed the number present.'),
('77000000-0000-0000-0000-000000000098', N'curriculum_development', N'academic_research_skills', N'Academic/research skills', N'textarea', 1, 10, N'Record specific observed evidence. The handbook guidance is available beside the form.'),
('77000000-0000-0000-0000-000000000099', N'curriculum_development', N'personal_professional_development', N'Personal and professional development', N'textarea', 1, 20, N'Record specific observed evidence. The handbook guidance is available beside the form.'),
('77000000-0000-0000-0000-000000000100', N'curriculum_development', N'employability', N'Employability', N'textarea', 1, 30, N'Record specific observed evidence. The handbook guidance is available beside the form.'),
('77000000-0000-0000-0000-000000000101', N'delivery_facilitation', N'structure_pace_organisation', N'Structure, pace and organisation of session', N'textarea', 1, 10, N'Record narrative evidence; do not assign a rating.'),
('77000000-0000-0000-0000-000000000102', N'delivery_facilitation', N'level_appropriate_inclusive', N'Level-appropriate and inclusive content and delivery', N'textarea', 1, 20, N'Record narrative evidence; do not assign a rating.'),
('77000000-0000-0000-0000-000000000103', N'delivery_facilitation', N'delivery_methods_styles_resources', N'Range of delivery methods, styles and resources', N'textarea', 1, 30, N'Record narrative evidence; do not assign a rating.'),
('77000000-0000-0000-0000-000000000104', N'delivery_facilitation', N'student_feedback_engagement', N'Student feedback and engagement', N'textarea', 1, 40, N'Record narrative evidence; do not assign a rating.'),
('77000000-0000-0000-0000-000000000105', N'learning_materials', N'module_handbook', N'Module handbook', N'textarea', 1, 10, N'Consider whether materials are current, accurate, accessible and appropriate.'),
('77000000-0000-0000-0000-000000000106', N'learning_materials', N'itslearning_resources', N'Resources on ItsLearning', N'textarea', 1, 20, N'Consider whether materials are current, accurate, accessible and appropriate.'),
('77000000-0000-0000-0000-000000000107', N'learning_materials', N'session_materials', N'Session materials, handouts and resources', N'textarea', 1, 30, N'Consider whether materials are current, accurate, accessible and appropriate.'),
('77000000-0000-0000-0000-000000000108', N'learning_materials', N'assessment_information', N'Assessment information', N'textarea', 1, 40, N'Consider whether materials are current, accurate, accessible and appropriate.'),
('77000000-0000-0000-0000-000000000109', N'learning_materials', N'feedback_to_students', N'Feedback to students', N'textarea', 1, 50, N'Consider whether materials are current, accurate, accessible and appropriate.'),
('77000000-0000-0000-0000-000000000110', N'findings', N'good_practice', N'Aspects of good practice', N'textarea', 1, 10, NULL),
('77000000-0000-0000-0000-000000000111', N'findings', N'essential_actions', N'Essential actions', N'textarea', 0, 20, N'Essential actions require a tracked essential action and a follow-up checkpoint 8-12 weeks after the professional discussion.'),
('77000000-0000-0000-0000-000000000112', N'findings', N'advisable_actions', N'Advisable actions', N'textarea', 0, 30, NULL),
('77000000-0000-0000-0000-000000000113', N'findings', N'excellent_practice', N'Excellent practice to share', N'textarea', 0, 40, N'Only include specific examples of excellent practice; do not simply repeat the best aspect of the session.'),
('77000000-0000-0000-0000-000000000114', N'reflection_development', N'lecturer_reflection', N'Lecturer reflection on observation and professional discussion', N'textarea', 1, 10, N'Completed by the lecturer after moderation approval and the professional discussion.');

INSERT INTO forms.form_fields (
    id, form_section_id, field_key, label, field_type, is_required, display_order, help_text
)
SELECT source.id, section.id, source.field_key, source.label, source.field_type,
       source.is_required, source.display_order, source.help_text
FROM @fields source
JOIN forms.form_sections section
  ON section.form_template_version_id = @versionId AND section.section_key = source.section_key
WHERE NOT EXISTS (
    SELECT 1 FROM forms.form_fields existing
    WHERE existing.form_section_id = section.id AND existing.field_key = source.field_key
);

IF OBJECT_ID(N'quality.uco_tla_reviews', N'U') IS NULL
BEGIN
    CREATE TABLE quality.uco_tla_reviews (
        record_id uniqueidentifier NOT NULL CONSTRAINT pk_uco_tla_reviews PRIMARY KEY,
        form_submission_id uniqueidentifier NOT NULL,
        lecturer_staff_id uniqueidentifier NOT NULL,
        observer_staff_id uniqueidentifier NOT NULL,
        moderator_staff_id uniqueidentifier NOT NULL,
        workflow_status nvarchar(40) NOT NULL CONSTRAINT df_uco_tla_reviews_status DEFAULT N'observer_draft',
        observation_at datetimeoffset NOT NULL,
        session_type nvarchar(200) NOT NULL,
        course_title nvarchar(300) NOT NULL,
        module_title nvarchar(300) NOT NULL,
        course_level nvarchar(100) NOT NULL,
        number_registered int NULL,
        number_present int NULL,
        number_late int NULL,
        professional_discussion_at datetimeoffset NULL,
        moderation_submitted_at datetimeoffset NULL,
        moderation_returned_at datetimeoffset NULL,
        moderation_return_reason nvarchar(2000) NULL,
        moderation_approved_at datetimeoffset NULL,
        moderation_approved_by_user_account_id uniqueidentifier NULL,
        lecturer_acknowledged_at datetimeoffset NULL,
        lecturer_acknowledged_by_user_account_id uniqueidentifier NULL,
        observer_signed_at datetimeoffset NULL,
        observer_signed_by_user_account_id uniqueidentifier NULL,
        parent_review_record_id uniqueidentifier NULL,
        reopened_at datetimeoffset NULL,
        reopened_by_user_account_id uniqueidentifier NULL,
        reopen_reason nvarchar(2000) NULL,
        created_by_user_account_id uniqueidentifier NOT NULL,
        updated_by_user_account_id uniqueidentifier NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_uco_tla_reviews_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        archived_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT uq_uco_tla_reviews_submission UNIQUE (form_submission_id),
        CONSTRAINT fk_uco_tla_reviews_record FOREIGN KEY (record_id) REFERENCES core.records(id),
        CONSTRAINT fk_uco_tla_reviews_submission FOREIGN KEY (form_submission_id) REFERENCES forms.form_submissions(id),
        CONSTRAINT fk_uco_tla_reviews_lecturer FOREIGN KEY (lecturer_staff_id) REFERENCES people.staff(id),
        CONSTRAINT fk_uco_tla_reviews_observer FOREIGN KEY (observer_staff_id) REFERENCES people.staff(id),
        CONSTRAINT fk_uco_tla_reviews_moderator FOREIGN KEY (moderator_staff_id) REFERENCES people.staff(id),
        CONSTRAINT fk_uco_tla_reviews_moderated_by FOREIGN KEY (moderation_approved_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT fk_uco_tla_reviews_lecturer_ack FOREIGN KEY (lecturer_acknowledged_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT fk_uco_tla_reviews_observer_sign FOREIGN KEY (observer_signed_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT fk_uco_tla_reviews_parent FOREIGN KEY (parent_review_record_id) REFERENCES quality.uco_tla_reviews(record_id),
        CONSTRAINT fk_uco_tla_reviews_reopened_by FOREIGN KEY (reopened_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT fk_uco_tla_reviews_created_by FOREIGN KEY (created_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT fk_uco_tla_reviews_updated_by FOREIGN KEY (updated_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT ck_uco_tla_reviews_people_distinct CHECK (
            lecturer_staff_id <> observer_staff_id AND lecturer_staff_id <> moderator_staff_id AND observer_staff_id <> moderator_staff_id
        ),
        CONSTRAINT ck_uco_tla_reviews_attendance CHECK (
            (number_registered IS NULL OR number_registered >= 0)
            AND (number_present IS NULL OR number_present >= 0)
            AND (number_late IS NULL OR number_late >= 0)
            AND (number_present IS NULL OR number_registered IS NULL OR number_present <= number_registered)
            AND (number_late IS NULL OR number_present IS NULL OR number_late <= number_present)
        ),
        CONSTRAINT ck_uco_tla_reviews_status CHECK (workflow_status IN (
            N'observer_draft', N'awaiting_moderation', N'changes_requested',
            N'awaiting_lecturer', N'awaiting_finalisation', N'completed', N'archived'
        ))
    );
END;

IF OBJECT_ID(N'quality.uco_tla_action_plans', N'U') IS NULL
BEGIN
    CREATE TABLE quality.uco_tla_action_plans (
        id uniqueidentifier NOT NULL CONSTRAINT pk_uco_tla_action_plans PRIMARY KEY DEFAULT newsequentialid(),
        review_record_id uniqueidentifier NOT NULL,
        display_order tinyint NOT NULL,
        action_type nvarchar(30) NOT NULL,
        target nvarchar(300) NOT NULL,
        achievement_method nvarchar(max) NOT NULL,
        owner_staff_id uniqueidentifier NOT NULL,
        due_date date NOT NULL,
        central_action_id uniqueidentifier NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_uco_tla_action_plans_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT uq_uco_tla_action_plans_order UNIQUE (review_record_id, display_order),
        CONSTRAINT uq_uco_tla_action_plans_central UNIQUE (central_action_id),
        CONSTRAINT fk_uco_tla_action_plans_review FOREIGN KEY (review_record_id) REFERENCES quality.uco_tla_reviews(record_id),
        CONSTRAINT fk_uco_tla_action_plans_owner FOREIGN KEY (owner_staff_id) REFERENCES people.staff(id),
        CONSTRAINT fk_uco_tla_action_plans_action FOREIGN KEY (central_action_id) REFERENCES quality.actions(id),
        CONSTRAINT ck_uco_tla_action_plans_order CHECK (display_order BETWEEN 1 AND 3),
        CONSTRAINT ck_uco_tla_action_plans_type CHECK (action_type IN (N'essential', N'advisable', N'good_practice'))
    );
END;

IF OBJECT_ID(N'quality.uco_tla_follow_ups', N'U') IS NULL
BEGIN
    CREATE TABLE quality.uco_tla_follow_ups (
        review_record_id uniqueidentifier NOT NULL CONSTRAINT pk_uco_tla_follow_ups PRIMARY KEY,
        follow_up_type nvarchar(30) NOT NULL,
        scheduled_at datetimeoffset NOT NULL,
        status nvarchar(30) NOT NULL CONSTRAINT df_uco_tla_follow_ups_status DEFAULT N'scheduled',
        outcome_notes nvarchar(max) NULL,
        linked_review_record_id uniqueidentifier NULL,
        completed_at datetimeoffset NULL,
        created_by_user_account_id uniqueidentifier NOT NULL,
        updated_by_user_account_id uniqueidentifier NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_uco_tla_follow_ups_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT uq_uco_tla_follow_ups_linked_review UNIQUE (linked_review_record_id),
        CONSTRAINT fk_uco_tla_follow_ups_review FOREIGN KEY (review_record_id) REFERENCES quality.uco_tla_reviews(record_id),
        CONSTRAINT fk_uco_tla_follow_ups_linked FOREIGN KEY (linked_review_record_id) REFERENCES quality.uco_tla_reviews(record_id),
        CONSTRAINT fk_uco_tla_follow_ups_created_by FOREIGN KEY (created_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT fk_uco_tla_follow_ups_updated_by FOREIGN KEY (updated_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT ck_uco_tla_follow_ups_type CHECK (follow_up_type IN (N'discussion', N'observation')),
        CONSTRAINT ck_uco_tla_follow_ups_status CHECK (status IN (N'scheduled', N'completed', N'cancelled'))
    );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'quality.uco_tla_reviews') AND name = N'ix_uco_tla_reviews_workflow')
    CREATE INDEX ix_uco_tla_reviews_workflow
        ON quality.uco_tla_reviews(workflow_status, moderator_staff_id, observation_at)
        INCLUDE (record_id, lecturer_staff_id, observer_staff_id, professional_discussion_at);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'quality.uco_tla_reviews') AND name = N'ix_uco_tla_reviews_participants')
    CREATE INDEX ix_uco_tla_reviews_participants
        ON quality.uco_tla_reviews(lecturer_staff_id, observer_staff_id, archived_at)
        INCLUDE (record_id, workflow_status, observation_at);

IF COL_LENGTH(N'quality.probation_observations', N'linked_uco_tla_review_id') IS NULL
    ALTER TABLE quality.probation_observations ADD linked_uco_tla_review_id uniqueidentifier NULL;
GO

IF OBJECT_ID(N'quality.fk_probation_observations_uco_tla', N'F') IS NULL
    ALTER TABLE quality.probation_observations ADD CONSTRAINT fk_probation_observations_uco_tla
        FOREIGN KEY (linked_uco_tla_review_id) REFERENCES quality.uco_tla_reviews(record_id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'quality.probation_observations') AND name = N'ux_probation_observations_uco_tla')
    CREATE UNIQUE INDEX ux_probation_observations_uco_tla
        ON quality.probation_observations(linked_uco_tla_review_id)
        WHERE linked_uco_tla_review_id IS NOT NULL;

IF OBJECT_ID(N'quality.ck_probation_observations_type', N'C') IS NOT NULL
    ALTER TABLE quality.probation_observations DROP CONSTRAINT ck_probation_observations_type;

IF OBJECT_ID(N'quality.ck_probation_observations_liv_link', N'C') IS NOT NULL
    ALTER TABLE quality.probation_observations DROP CONSTRAINT ck_probation_observations_liv_link;

IF OBJECT_ID(N'quality.ck_probation_observations_type', N'C') IS NULL
    ALTER TABLE quality.probation_observations ADD CONSTRAINT ck_probation_observations_type CHECK (
        (observation_number IN (1, 3) AND observation_type = N'probation')
        OR (observation_number = 2 AND observation_type IN (N'liv', N'uco_tla'))
    );

IF OBJECT_ID(N'quality.ck_probation_observations_review_link', N'C') IS NULL
    ALTER TABLE quality.probation_observations ADD CONSTRAINT ck_probation_observations_review_link CHECK (
        (observation_number = 2 OR (linked_liv_record_id IS NULL AND linked_uco_tla_review_id IS NULL))
        AND NOT (linked_liv_record_id IS NOT NULL AND linked_uco_tla_review_id IS NOT NULL)
        AND (observation_type <> N'liv' OR linked_uco_tla_review_id IS NULL)
        AND (observation_type <> N'uco_tla' OR linked_liv_record_id IS NULL)
    );

INSERT INTO core.lookup_types (id, lookup_key, name, description, is_system)
SELECT CONVERT(uniqueidentifier, '9a000000-0000-0000-0000-000000000010'),
       N'action_theme_uco_tla_review', N'UCO TLA Review action themes',
       N'Configurable action themes for UCO TLA Review actions.', 0
WHERE NOT EXISTS (SELECT 1 FROM core.lookup_types WHERE lookup_key = N'action_theme_uco_tla_review');

INSERT INTO core.lookup_values (id, lookup_type_id, value_key, display_name, display_order)
SELECT seed.id, type.id, seed.value_key, seed.display_name, seed.display_order
FROM core.lookup_types type
CROSS APPLY (VALUES
    (CONVERT(uniqueidentifier, '9aa00000-0000-0000-0000-000000000001'), N'general', N'General', 10),
    (CONVERT(uniqueidentifier, '9aa00000-0000-0000-0000-000000000002'), N'essential_action', N'Essential action', 20),
    (CONVERT(uniqueidentifier, '9aa00000-0000-0000-0000-000000000003'), N'advisable_action', N'Advisable action', 30),
    (CONVERT(uniqueidentifier, '9aa00000-0000-0000-0000-000000000004'), N'sharing_practice', N'Sharing excellent practice', 40)
) seed(id, value_key, display_name, display_order)
WHERE type.lookup_key = N'action_theme_uco_tla_review'
  AND NOT EXISTS (
      SELECT 1 FROM core.lookup_values existing
      WHERE existing.lookup_type_id = type.id AND existing.value_key = seed.value_key
  );

INSERT INTO core.admin_managed_lists (lookup_type_id, category, description, display_order)
SELECT type.id, N'UCO TLA Reviews', N'Action themes available on UCO TLA Review actions.', 190
FROM core.lookup_types type
WHERE type.lookup_key = N'action_theme_uco_tla_review'
  AND NOT EXISTS (SELECT 1 FROM core.admin_managed_lists existing WHERE existing.lookup_type_id = type.id);

INSERT INTO core.lookup_usage_registry (lookup_type_id, application_key, display_name)
SELECT type.id, N'actions.uco_tla_review', N'UCO TLA Review action forms'
FROM core.lookup_types type
WHERE type.lookup_key = N'action_theme_uco_tla_review'
  AND NOT EXISTS (
      SELECT 1 FROM core.lookup_usage_registry existing
      WHERE existing.lookup_type_id = type.id AND existing.application_key = N'actions.uco_tla_review'
  );

COMMIT TRANSACTION;
GO
