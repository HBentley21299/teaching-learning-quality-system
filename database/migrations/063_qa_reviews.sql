SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO

IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = N'qa')
    EXEC(N'CREATE SCHEMA qa AUTHORIZATION dbo;');
GO

INSERT INTO core.modules (id, module_key, name, description, route_prefix, display_order, is_enabled)
SELECT '74000000-0000-0000-0000-000000000001', N'qa_reviews', N'QA Reviews',
       N'Permission-scoped quality assurance reviews, evidence, dashboards and actions.', N'/qa-hub', 85, 1
WHERE NOT EXISTS (SELECT 1 FROM core.modules WHERE module_key = N'qa_reviews');
GO

INSERT INTO auth.permissions (permission_key, name, description, category, is_system)
SELECT source.permission_key, source.name, source.description, N'QA Reviews', 1
FROM (VALUES
    (N'qa_reviews.view_all', N'View all QA Reviews', N'View every QA Review and its evidence.'),
    (N'qa_reviews.view_scoped', N'View scoped QA Reviews', N'View QA Reviews intersecting assigned organisation scope.'),
    (N'qa_reviews.view_assigned', N'View assigned QA Reviews', N'View only explicitly assigned QA Reviews.'),
    (N'qa_reviews.submit_all', N'Submit all QA evidence', N'Create and edit evidence across every QA Review scope.'),
    (N'qa_reviews.submit_scoped', N'Submit scoped QA evidence', N'Create and edit evidence inside assigned organisation scope.'),
    (N'qa_reviews.submit_assigned', N'Submit assigned QA evidence', N'Create and edit evidence inside explicit review assignments.'),
    (N'qa_reviews.manage', N'Manage QA Reviews', N'Configure questions, scope and review lifecycle.'),
    (N'qa_reviews.correct', N'Correct submitted QA evidence', N'Correct submitted evidence with a mandatory audit reason.'),
    (N'qa_reviews.remove', N'Remove QA evidence', N'Soft-remove QA evidence with a mandatory audit reason.')
) source(permission_key, name, description)
WHERE NOT EXISTS (SELECT 1 FROM auth.permissions existing WHERE existing.permission_key = source.permission_key);
GO

IF NOT EXISTS (SELECT 1 FROM auth.roles WHERE role_key = N'qa_staff')
BEGIN
    INSERT INTO auth.roles (id, role_key, name, description, is_system, precedence)
    VALUES ('75000000-0000-0000-0000-000000000001', N'qa_staff', N'QA Staff',
            N'Additive Tutor-level role with access limited to assigned QA Reviews.', 1, 110);
END;
GO

INSERT INTO auth.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM auth.roles role
JOIN auth.permissions permission ON permission.permission_key LIKE N'qa_reviews.%'
WHERE role.role_key = N'super_admin'
  AND NOT EXISTS (SELECT 1 FROM auth.role_permissions existing WHERE existing.role_id = role.id AND existing.permission_id = permission.id);

INSERT INTO auth.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM auth.roles role
JOIN auth.permissions permission ON permission.permission_key IN (
    N'qa_reviews.view_all', N'qa_reviews.submit_all', N'qa_reviews.manage', N'qa_reviews.correct'
)
WHERE role.role_key = N'teaching_learning_team'
  AND NOT EXISTS (SELECT 1 FROM auth.role_permissions existing WHERE existing.role_id = role.id AND existing.permission_id = permission.id);

INSERT INTO auth.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM auth.roles role
JOIN auth.permissions permission ON permission.permission_key IN (N'qa_reviews.view_scoped', N'qa_reviews.submit_scoped')
WHERE role.role_key IN (N'director', N'head_of_faculty', N'programme_leader')
  AND NOT EXISTS (SELECT 1 FROM auth.role_permissions existing WHERE existing.role_id = role.id AND existing.permission_id = permission.id);

-- QA Staff is additive but also carries the Tutor permission set so removing an
-- accidental standalone allocation cannot reduce the rest of i-Elevate below Tutor.
INSERT INTO auth.role_permissions (role_id, permission_id)
SELECT qa_role.id, source_permission.permission_id
FROM auth.roles qa_role
CROSS APPLY (
    SELECT role_permission.permission_id
    FROM auth.roles tutor_role
    JOIN auth.role_permissions role_permission ON role_permission.role_id = tutor_role.id
    WHERE tutor_role.role_key = N'staff'
) source_permission
WHERE qa_role.role_key = N'qa_staff'
  AND NOT EXISTS (SELECT 1 FROM auth.role_permissions existing WHERE existing.role_id = qa_role.id AND existing.permission_id = source_permission.permission_id);

INSERT INTO auth.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM auth.roles role
JOIN auth.permissions permission ON permission.permission_key IN (N'qa_reviews.view_assigned', N'qa_reviews.submit_assigned')
WHERE role.role_key = N'qa_staff'
  AND NOT EXISTS (SELECT 1 FROM auth.role_permissions existing WHERE existing.role_id = role.id AND existing.permission_id = permission.id);
GO

IF OBJECT_ID(N'qa.activity_types', N'U') IS NULL
BEGIN
    CREATE TABLE qa.activity_types (
        id uniqueidentifier NOT NULL CONSTRAINT pk_qa_activity_types PRIMARY KEY DEFAULT newsequentialid(),
        activity_key nvarchar(80) NOT NULL,
        name nvarchar(200) NOT NULL,
        description nvarchar(1000) NULL,
        display_order int NOT NULL,
        is_active bit NOT NULL CONSTRAINT df_qa_activity_types_active DEFAULT 1,
        created_at datetimeoffset NOT NULL CONSTRAINT df_qa_activity_types_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        archived_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT uq_qa_activity_types_key UNIQUE (activity_key)
    );
END;
GO

IF OBJECT_ID(N'qa.activity_templates', N'U') IS NULL
BEGIN
    CREATE TABLE qa.activity_templates (
        id uniqueidentifier NOT NULL CONSTRAINT pk_qa_activity_templates PRIMARY KEY DEFAULT newsequentialid(),
        activity_type_id uniqueidentifier NOT NULL,
        template_key nvarchar(100) NOT NULL,
        name nvarchar(250) NOT NULL,
        description nvarchar(1000) NULL,
        is_active bit NOT NULL CONSTRAINT df_qa_activity_templates_active DEFAULT 1,
        created_by_user_account_id uniqueidentifier NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_qa_activity_templates_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        archived_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT fk_qa_activity_templates_type FOREIGN KEY (activity_type_id) REFERENCES qa.activity_types(id),
        CONSTRAINT fk_qa_activity_templates_creator FOREIGN KEY (created_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT uq_qa_activity_templates_key UNIQUE (template_key)
    );
END;
GO

IF OBJECT_ID(N'qa.questions', N'U') IS NULL
BEGIN
    CREATE TABLE qa.questions (
        id uniqueidentifier NOT NULL CONSTRAINT pk_qa_questions PRIMARY KEY DEFAULT newsequentialid(),
        activity_type_id uniqueidentifier NOT NULL,
        question_key nvarchar(120) NOT NULL,
        default_display_order int NOT NULL,
        is_retired bit NOT NULL CONSTRAINT df_qa_questions_retired DEFAULT 0,
        created_at datetimeoffset NOT NULL CONSTRAINT df_qa_questions_created DEFAULT sysutcdatetime(),
        archived_at datetimeoffset NULL,
        CONSTRAINT fk_qa_questions_activity FOREIGN KEY (activity_type_id) REFERENCES qa.activity_types(id),
        CONSTRAINT uq_qa_questions_key UNIQUE (question_key)
    );
END;
GO

IF OBJECT_ID(N'qa.question_versions', N'U') IS NULL
BEGIN
    CREATE TABLE qa.question_versions (
        id uniqueidentifier NOT NULL CONSTRAINT pk_qa_question_versions PRIMARY KEY DEFAULT newsequentialid(),
        question_id uniqueidentifier NOT NULL,
        version_number int NOT NULL,
        theme_or_week nvarchar(200) NULL,
        question_text nvarchar(1000) NOT NULL,
        guidance nvarchar(2000) NULL,
        is_required bit NOT NULL CONSTRAINT df_qa_question_versions_required DEFAULT 1,
        allows_not_applicable bit NOT NULL CONSTRAINT df_qa_question_versions_na DEFAULT 0,
        comment_required_at_expected bit NOT NULL CONSTRAINT df_qa_question_versions_comment_expected DEFAULT 0,
        is_active bit NOT NULL CONSTRAINT df_qa_question_versions_active DEFAULT 1,
        source_status nvarchar(20) NOT NULL CONSTRAINT df_qa_question_versions_source_status DEFAULT N'active',
        created_by_user_account_id uniqueidentifier NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_qa_question_versions_created DEFAULT sysutcdatetime(),
        CONSTRAINT fk_qa_question_versions_question FOREIGN KEY (question_id) REFERENCES qa.questions(id),
        CONSTRAINT fk_qa_question_versions_creator FOREIGN KEY (created_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT uq_qa_question_versions_number UNIQUE (question_id, version_number),
        CONSTRAINT ck_qa_question_versions_status CHECK (source_status IN (N'active', N'draft', N'inactive'))
    );
END;
GO

IF OBJECT_ID(N'qa.activity_template_questions', N'U') IS NULL
BEGIN
    CREATE TABLE qa.activity_template_questions (
        activity_template_id uniqueidentifier NOT NULL,
        question_id uniqueidentifier NOT NULL,
        display_order int NOT NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_qa_template_questions_created DEFAULT sysutcdatetime(),
        CONSTRAINT pk_qa_activity_template_questions PRIMARY KEY (activity_template_id, question_id),
        CONSTRAINT fk_qa_template_questions_template FOREIGN KEY (activity_template_id) REFERENCES qa.activity_templates(id),
        CONSTRAINT fk_qa_template_questions_question FOREIGN KEY (question_id) REFERENCES qa.questions(id)
    );
END;
GO

IF OBJECT_ID(N'qa.reviews', N'U') IS NULL
BEGIN
    CREATE TABLE qa.reviews (
        record_id uniqueidentifier NOT NULL CONSTRAINT pk_qa_reviews PRIMARY KEY,
        review_theme nvarchar(300) NOT NULL,
        intended_purpose nvarchar(2000) NULL,
        status nvarchar(20) NOT NULL CONSTRAINT df_qa_reviews_status DEFAULT N'draft',
        planned_open_date date NULL,
        closing_date date NOT NULL,
        opened_at datetimeoffset NULL,
        opened_by_user_account_id uniqueidentifier NULL,
        closed_at datetimeoffset NULL,
        closed_by_user_account_id uniqueidentifier NULL,
        closure_note nvarchar(2000) NULL,
        reopened_at datetimeoffset NULL,
        reopened_by_user_account_id uniqueidentifier NULL,
        archived_at datetimeoffset NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_qa_reviews_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT fk_qa_reviews_record FOREIGN KEY (record_id) REFERENCES core.records(id),
        CONSTRAINT fk_qa_reviews_opened_by FOREIGN KEY (opened_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT fk_qa_reviews_closed_by FOREIGN KEY (closed_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT fk_qa_reviews_reopened_by FOREIGN KEY (reopened_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT ck_qa_reviews_status CHECK (status IN (N'draft', N'open', N'closed', N'reopened', N'archived'))
    );
END;
GO

IF OBJECT_ID(N'qa.review_scopes', N'U') IS NULL
BEGIN
    CREATE TABLE qa.review_scopes (
        id uniqueidentifier NOT NULL CONSTRAINT pk_qa_review_scopes PRIMARY KEY DEFAULT newsequentialid(),
        review_id uniqueidentifier NOT NULL,
        org_unit_id uniqueidentifier NOT NULL,
        scope_type nvarchar(20) NOT NULL,
        org_unit_code_snapshot nvarchar(50) NOT NULL,
        org_unit_name_snapshot nvarchar(250) NOT NULL,
        parent_org_unit_id uniqueidentifier NULL,
        parent_code_snapshot nvarchar(50) NULL,
        parent_name_snapshot nvarchar(250) NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_qa_review_scopes_created DEFAULT sysutcdatetime(),
        CONSTRAINT fk_qa_review_scopes_review FOREIGN KEY (review_id) REFERENCES qa.reviews(record_id),
        CONSTRAINT fk_qa_review_scopes_org FOREIGN KEY (org_unit_id) REFERENCES org.org_units(id),
        CONSTRAINT fk_qa_review_scopes_parent FOREIGN KEY (parent_org_unit_id) REFERENCES org.org_units(id),
        CONSTRAINT uq_qa_review_scopes_unit UNIQUE (review_id, org_unit_id),
        CONSTRAINT ck_qa_review_scopes_type CHECK (scope_type IN (N'faculty', N'team'))
    );
END;
GO

IF OBJECT_ID(N'qa.review_contributors', N'U') IS NULL
BEGIN
    CREATE TABLE qa.review_contributors (
        id uniqueidentifier NOT NULL CONSTRAINT pk_qa_review_contributors PRIMARY KEY DEFAULT newsequentialid(),
        review_id uniqueidentifier NOT NULL,
        staff_id uniqueidentifier NOT NULL,
        assigned_org_unit_id uniqueidentifier NULL,
        is_active bit NOT NULL CONSTRAINT df_qa_review_contributors_active DEFAULT 1,
        active_from datetimeoffset NOT NULL CONSTRAINT df_qa_review_contributors_from DEFAULT sysutcdatetime(),
        active_to datetimeoffset NULL,
        created_by_user_account_id uniqueidentifier NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_qa_review_contributors_created DEFAULT sysutcdatetime(),
        CONSTRAINT fk_qa_review_contributors_review FOREIGN KEY (review_id) REFERENCES qa.reviews(record_id),
        CONSTRAINT fk_qa_review_contributors_staff FOREIGN KEY (staff_id) REFERENCES people.staff(id),
        CONSTRAINT fk_qa_review_contributors_org FOREIGN KEY (assigned_org_unit_id) REFERENCES org.org_units(id),
        CONSTRAINT fk_qa_review_contributors_creator FOREIGN KEY (created_by_user_account_id) REFERENCES auth.user_accounts(id)
    );
    CREATE UNIQUE INDEX uq_qa_review_contributors_assignment
        ON qa.review_contributors(review_id, staff_id, assigned_org_unit_id)
        WHERE active_to IS NULL;
END;
GO

IF OBJECT_ID(N'qa.review_activities', N'U') IS NULL
BEGIN
    CREATE TABLE qa.review_activities (
        id uniqueidentifier NOT NULL CONSTRAINT pk_qa_review_activities PRIMARY KEY DEFAULT newsequentialid(),
        review_id uniqueidentifier NOT NULL,
        activity_type_id uniqueidentifier NOT NULL,
        activity_template_id uniqueidentifier NOT NULL,
        display_order int NOT NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_qa_review_activities_created DEFAULT sysutcdatetime(),
        CONSTRAINT fk_qa_review_activities_review FOREIGN KEY (review_id) REFERENCES qa.reviews(record_id),
        CONSTRAINT fk_qa_review_activities_type FOREIGN KEY (activity_type_id) REFERENCES qa.activity_types(id),
        CONSTRAINT fk_qa_review_activities_template FOREIGN KEY (activity_template_id) REFERENCES qa.activity_templates(id),
        CONSTRAINT uq_qa_review_activities_type UNIQUE (review_id, activity_type_id)
    );
END;
GO

IF OBJECT_ID(N'qa.review_question_selections', N'U') IS NULL
BEGIN
    CREATE TABLE qa.review_question_selections (
        review_activity_id uniqueidentifier NOT NULL,
        question_id uniqueidentifier NOT NULL,
        display_order int NOT NULL,
        CONSTRAINT pk_qa_review_question_selections PRIMARY KEY (review_activity_id, question_id),
        CONSTRAINT fk_qa_review_question_selections_activity FOREIGN KEY (review_activity_id) REFERENCES qa.review_activities(id),
        CONSTRAINT fk_qa_review_question_selections_question FOREIGN KEY (question_id) REFERENCES qa.questions(id)
    );
END;
GO

IF OBJECT_ID(N'qa.review_questions', N'U') IS NULL
BEGIN
    CREATE TABLE qa.review_questions (
        id uniqueidentifier NOT NULL CONSTRAINT pk_qa_review_questions PRIMARY KEY DEFAULT newsequentialid(),
        review_activity_id uniqueidentifier NOT NULL,
        source_question_id uniqueidentifier NOT NULL,
        source_question_version_id uniqueidentifier NOT NULL,
        source_version_number int NOT NULL,
        theme_or_week nvarchar(200) NULL,
        question_text nvarchar(1000) NOT NULL,
        guidance nvarchar(2000) NULL,
        display_order int NOT NULL,
        is_required bit NOT NULL,
        allows_not_applicable bit NOT NULL,
        comment_required_at_expected bit NOT NULL,
        frozen_at datetimeoffset NOT NULL CONSTRAINT df_qa_review_questions_frozen DEFAULT sysutcdatetime(),
        CONSTRAINT fk_qa_review_questions_activity FOREIGN KEY (review_activity_id) REFERENCES qa.review_activities(id),
        CONSTRAINT fk_qa_review_questions_source FOREIGN KEY (source_question_id) REFERENCES qa.questions(id),
        CONSTRAINT fk_qa_review_questions_version FOREIGN KEY (source_question_version_id) REFERENCES qa.question_versions(id),
        CONSTRAINT uq_qa_review_questions_source UNIQUE (review_activity_id, source_question_id)
    );
END;
GO

IF OBJECT_ID(N'qa.evidence_submissions', N'U') IS NULL
BEGIN
    CREATE TABLE qa.evidence_submissions (
        record_id uniqueidentifier NOT NULL CONSTRAINT pk_qa_evidence_submissions PRIMARY KEY,
        review_id uniqueidentifier NOT NULL,
        review_activity_id uniqueidentifier NOT NULL,
        faculty_org_unit_id uniqueidentifier NOT NULL,
        team_org_unit_id uniqueidentifier NOT NULL,
        faculty_code_snapshot nvarchar(50) NOT NULL,
        faculty_name_snapshot nvarchar(250) NOT NULL,
        team_code_snapshot nvarchar(50) NOT NULL,
        team_name_snapshot nvarchar(250) NOT NULL,
        course_programme nvarchar(300) NULL,
        course_level nvarchar(100) NULL,
        subject_staff_id uniqueidentifier NULL,
        reviewer_staff_id uniqueidentifier NOT NULL,
        activity_at datetimeoffset NOT NULL,
        sample_size int NULL,
        contextual_notes nvarchar(2000) NULL,
        evidence_links_json nvarchar(max) NULL,
        key_strengths nvarchar(max) NULL,
        areas_for_improvement nvarchar(max) NULL,
        recommended_actions nvarchar(max) NULL,
        additional_context nvarchar(max) NULL,
        status nvarchar(20) NOT NULL CONSTRAINT df_qa_evidence_status DEFAULT N'draft',
        submitted_at datetimeoffset NULL,
        submitted_by_user_account_id uniqueidentifier NULL,
        version_number int NOT NULL CONSTRAINT df_qa_evidence_version DEFAULT 1,
        removed_at datetimeoffset NULL,
        removed_by_user_account_id uniqueidentifier NULL,
        removal_reason nvarchar(1000) NULL,
        created_by_user_account_id uniqueidentifier NOT NULL,
        updated_by_user_account_id uniqueidentifier NOT NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_qa_evidence_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT fk_qa_evidence_record FOREIGN KEY (record_id) REFERENCES core.records(id),
        CONSTRAINT fk_qa_evidence_review FOREIGN KEY (review_id) REFERENCES qa.reviews(record_id),
        CONSTRAINT fk_qa_evidence_activity FOREIGN KEY (review_activity_id) REFERENCES qa.review_activities(id),
        CONSTRAINT fk_qa_evidence_faculty FOREIGN KEY (faculty_org_unit_id) REFERENCES org.org_units(id),
        CONSTRAINT fk_qa_evidence_team FOREIGN KEY (team_org_unit_id) REFERENCES org.org_units(id),
        CONSTRAINT fk_qa_evidence_subject FOREIGN KEY (subject_staff_id) REFERENCES people.staff(id),
        CONSTRAINT fk_qa_evidence_reviewer FOREIGN KEY (reviewer_staff_id) REFERENCES people.staff(id),
        CONSTRAINT fk_qa_evidence_submitted_by FOREIGN KEY (submitted_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT fk_qa_evidence_removed_by FOREIGN KEY (removed_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT fk_qa_evidence_created_by FOREIGN KEY (created_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT fk_qa_evidence_updated_by FOREIGN KEY (updated_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT ck_qa_evidence_status CHECK (status IN (N'draft', N'submitted')),
        CONSTRAINT ck_qa_evidence_sample CHECK (sample_size IS NULL OR sample_size >= 0),
        CONSTRAINT ck_qa_evidence_links_json CHECK (evidence_links_json IS NULL OR ISJSON(evidence_links_json) = 1)
    );
END;
GO

IF OBJECT_ID(N'qa.evidence_responses', N'U') IS NULL
BEGIN
    CREATE TABLE qa.evidence_responses (
        id uniqueidentifier NOT NULL CONSTRAINT pk_qa_evidence_responses PRIMARY KEY DEFAULT newsequentialid(),
        evidence_record_id uniqueidentifier NOT NULL,
        review_question_id uniqueidentifier NOT NULL,
        outcome nvarchar(30) NULL,
        comment nvarchar(max) NULL,
        not_applicable_reason nvarchar(1000) NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_qa_evidence_responses_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        CONSTRAINT fk_qa_evidence_responses_submission FOREIGN KEY (evidence_record_id) REFERENCES qa.evidence_submissions(record_id),
        CONSTRAINT fk_qa_evidence_responses_question FOREIGN KEY (review_question_id) REFERENCES qa.review_questions(id),
        CONSTRAINT uq_qa_evidence_responses_question UNIQUE (evidence_record_id, review_question_id),
        CONSTRAINT ck_qa_evidence_responses_outcome CHECK (outcome IS NULL OR outcome IN (N'below', N'at', N'above', N'not_applicable'))
    );
END;
GO

IF OBJECT_ID(N'qa.evidence_revisions', N'U') IS NULL
BEGIN
    CREATE TABLE qa.evidence_revisions (
        id uniqueidentifier NOT NULL CONSTRAINT pk_qa_evidence_revisions PRIMARY KEY DEFAULT newsequentialid(),
        evidence_record_id uniqueidentifier NOT NULL,
        version_number int NOT NULL,
        snapshot_json nvarchar(max) NOT NULL,
        reason nvarchar(1000) NULL,
        created_by_user_account_id uniqueidentifier NOT NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_qa_evidence_revisions_created DEFAULT sysutcdatetime(),
        CONSTRAINT fk_qa_evidence_revisions_submission FOREIGN KEY (evidence_record_id) REFERENCES qa.evidence_submissions(record_id),
        CONSTRAINT fk_qa_evidence_revisions_creator FOREIGN KEY (created_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT uq_qa_evidence_revisions_version UNIQUE (evidence_record_id, version_number),
        CONSTRAINT ck_qa_evidence_revisions_json CHECK (ISJSON(snapshot_json) = 1)
    );
END;
GO

IF OBJECT_ID(N'qa.dashboard_snapshots', N'U') IS NULL
BEGIN
    CREATE TABLE qa.dashboard_snapshots (
        id uniqueidentifier NOT NULL CONSTRAINT pk_qa_dashboard_snapshots PRIMARY KEY DEFAULT newsequentialid(),
        review_id uniqueidentifier NOT NULL,
        version_number int NOT NULL,
        dashboard_json nvarchar(max) NOT NULL,
        created_by_user_account_id uniqueidentifier NOT NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_qa_dashboard_snapshots_created DEFAULT sysutcdatetime(),
        CONSTRAINT fk_qa_dashboard_snapshots_review FOREIGN KEY (review_id) REFERENCES qa.reviews(record_id),
        CONSTRAINT fk_qa_dashboard_snapshots_creator FOREIGN KEY (created_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT uq_qa_dashboard_snapshots_version UNIQUE (review_id, version_number),
        CONSTRAINT ck_qa_dashboard_snapshots_json CHECK (ISJSON(dashboard_json) = 1)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'qa.review_scopes') AND name = N'ix_qa_review_scopes_access')
    CREATE INDEX ix_qa_review_scopes_access ON qa.review_scopes(org_unit_id, review_id) INCLUDE (scope_type, parent_org_unit_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'qa.review_contributors') AND name = N'ix_qa_review_contributors_access')
    CREATE INDEX ix_qa_review_contributors_access ON qa.review_contributors(staff_id, is_active, review_id) INCLUDE (assigned_org_unit_id, active_to);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'qa.evidence_submissions') AND name = N'ix_qa_evidence_dashboard')
    CREATE INDEX ix_qa_evidence_dashboard ON qa.evidence_submissions(review_id, team_org_unit_id, review_activity_id, status, activity_at)
        INCLUDE (faculty_org_unit_id, reviewer_staff_id, sample_size, removed_at);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'qa.evidence_responses') AND name = N'ix_qa_evidence_responses_dashboard')
    CREATE INDEX ix_qa_evidence_responses_dashboard ON qa.evidence_responses(review_question_id, outcome, evidence_record_id);
GO

INSERT INTO qa.activity_types (id, activity_key, name, description, display_order)
SELECT source.id, source.activity_key, source.name, source.description, source.display_order
FROM (VALUES
    (CONVERT(uniqueidentifier, '73000000-0000-0000-0000-000000000001'), N'lesson_visit', N'Lesson Visit', N'Observed teaching and learning activity.', 10),
    (CONVERT(uniqueidentifier, '73000000-0000-0000-0000-000000000002'), N'digital_learning_walk', N'Digital Learning Walk', N'Review of digital course spaces and curriculum information.', 20),
    (CONVERT(uniqueidentifier, '73000000-0000-0000-0000-000000000003'), N'work_scrutiny', N'Work Scrutiny', N'Review of learner work, assessment and feedback.', 30),
    (CONVERT(uniqueidentifier, '73000000-0000-0000-0000-000000000004'), N'walk_around', N'Walk Around', N'Short operational and learning-environment checks.', 40),
    (CONVERT(uniqueidentifier, '73000000-0000-0000-0000-000000000005'), N'desk_review', N'Desk Review', N'Data and record review; criteria permit Not applicable.', 50),
    (CONVERT(uniqueidentifier, '73000000-0000-0000-0000-000000000006'), N'stop_and_ask', N'Stop and Ask', N'Short, rapid learner checks.', 60),
    (CONVERT(uniqueidentifier, '73000000-0000-0000-0000-000000000007'), N'student_voice', N'Student Voice', N'Longer structured learner discussion.', 70)
) source(id, activity_key, name, description, display_order)
WHERE NOT EXISTS (SELECT 1 FROM qa.activity_types existing WHERE existing.activity_key = source.activity_key);

INSERT INTO qa.activity_templates (id, activity_type_id, template_key, name, description)
SELECT source.id, activity.id, source.template_key, source.name, N'Initial configurable template imported from QA week 1.docx.'
FROM (VALUES
    (CONVERT(uniqueidentifier, '72000000-0000-0000-0000-000000000001'), N'lesson_visit', N'qa_lesson_visit_initial', N'Lesson Visit - Initial QA cycle'),
    (CONVERT(uniqueidentifier, '72000000-0000-0000-0000-000000000002'), N'digital_learning_walk', N'qa_digital_learning_walk_initial', N'Digital Learning Walk - Initial QA cycle'),
    (CONVERT(uniqueidentifier, '72000000-0000-0000-0000-000000000003'), N'work_scrutiny', N'qa_work_scrutiny_initial', N'Work Scrutiny - Initial QA cycle'),
    (CONVERT(uniqueidentifier, '72000000-0000-0000-0000-000000000004'), N'walk_around', N'qa_walk_around_initial', N'Walk Around - Initial QA cycle'),
    (CONVERT(uniqueidentifier, '72000000-0000-0000-0000-000000000005'), N'desk_review', N'qa_desk_review_initial', N'Desk Review - Initial QA cycle'),
    (CONVERT(uniqueidentifier, '72000000-0000-0000-0000-000000000006'), N'stop_and_ask', N'qa_stop_and_ask_initial', N'Stop and Ask - Initial QA cycle'),
    (CONVERT(uniqueidentifier, '72000000-0000-0000-0000-000000000007'), N'student_voice', N'qa_student_voice_initial', N'Student Voice - Initial QA cycle')
) source(id, activity_key, template_key, name)
JOIN qa.activity_types activity ON activity.activity_key = source.activity_key
WHERE NOT EXISTS (SELECT 1 FROM qa.activity_templates existing WHERE existing.template_key = source.template_key);
GO

DECLARE @questions TABLE (
    id uniqueidentifier, version_id uniqueidentifier, activity_key nvarchar(80), question_key nvarchar(120),
    display_order int, theme nvarchar(200), question_text nvarchar(1000), guidance nvarchar(2000),
    allows_na bit, is_active bit, source_status nvarchar(20)
);

INSERT INTO @questions VALUES
('70000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001',N'lesson_visit',N'lv_w1_welcome',10,N'Week 1: Right Start',N'The tutor creates a welcoming environment in which learners are acknowledged and valued.',N'For example: learning names, greetings and positive noticing.',0,1,N'active'),
('70000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000002',N'lesson_visit',N'lv_w1_expectations',20,N'Week 1: Right Start',N'Professional expectations are embedded and challenged constructively.',N'Consider classroom behaviours and how expectations are reinforced.',0,1,N'active'),
('70000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000003',N'lesson_visit',N'lv_w1_do_now',30,N'Week 1: Right Start',N'Do-now activities support learner interaction.',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000004','71000000-0000-0000-0000-000000000004',N'lesson_visit',N'lv_w1_study_programme',40,N'Week 1: Right Start',N'Learners understand their study programme.',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000005','71000000-0000-0000-0000-000000000005',N'lesson_visit',N'lv_w1_every_learner_known',50,N'Week 1: Right Start',N'Every Learner Known is being established through meaningful connections with learners.',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000006','71000000-0000-0000-0000-000000000006',N'lesson_visit',N'lv_w1_lgp',60,N'Week 1: Right Start',N'Evidence of LGP is being used.',N'Source acronym retained. Teaching & Learning must clarify the intended meaning before activation.',0,0,N'draft'),
('70000000-0000-0000-0000-000000000007','71000000-0000-0000-0000-000000000007',N'lesson_visit',N'lv_w2_challenge',70,N'Week 2: Level 1',N'Lesson activities are challenging and engaging, and learners attempt structured tasks rather than opting out.',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000008','71000000-0000-0000-0000-000000000008',N'lesson_visit',N'lv_w2_independence',80,N'Week 2: Level 1',N'Learners begin to complete parts of tasks independently, supported by clear scaffolds.',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000009','71000000-0000-0000-0000-000000000009',N'lesson_visit',N'lv_w2_belonging',90,N'Week 2: Level 1',N'Learners respond positively to being noticed and show an increased willingness to contribute.',N'Look for belonging cues such as relaxed posture, smiles and participation.',0,1,N'active'),
('70000000-0000-0000-0000-000000000010','71000000-0000-0000-0000-000000000010',N'lesson_visit',N'lv_w2_high_expectations',100,N'Week 2: Level 1',N'High expectations are communicated and effectively challenged.',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000011','71000000-0000-0000-0000-000000000011',N'lesson_visit',N'lv_w2_relevance',110,N'Week 2: Level 1',N'Learners understand the relevance of learning through links to industry, jobs or careers.',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000012','71000000-0000-0000-0000-000000000012',N'lesson_visit',N'lv_w2_clear_information',120,N'Week 2: Level 1',N'Information is presented clearly and in a logical manner.',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000013','71000000-0000-0000-0000-000000000013',N'lesson_visit',N'lv_w2_checks',130,N'Week 2: Level 1',N'Checks of starting points and understanding identify gaps and inform adjustments.',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000014','71000000-0000-0000-0000-000000000014',N'lesson_visit',N'lv_w2_english_maths',140,N'Week 2: Level 1',N'English and mathematics are embedded or discussed to support progress through the study programme.',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000015','71000000-0000-0000-0000-000000000015',N'lesson_visit',N'lv_w2_accessibility',150,N'Week 2: Level 1',N'All learners can access and participate in learning, with appropriate adjustments for SEND.',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000016','71000000-0000-0000-0000-000000000016',N'lesson_visit',N'lv_w3_industry_practice',160,N'Week 3: Skills',N'Learning reflects expected industry practice and current employer needs.',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000017','71000000-0000-0000-0000-000000000017',N'lesson_visit',N'lv_w3_behaviours',170,N'Week 3: Skills',N'Learners demonstrate professional behaviours and attitudes required for their vocational pathway.',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000018','71000000-0000-0000-0000-000000000018',N'lesson_visit',N'lv_w3_employability',180,N'Week 3: Skills',N'Relevant employability skills are embedded in lesson activities.',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000019','71000000-0000-0000-0000-000000000019',N'lesson_visit',N'lv_w3_progression',190,N'Week 3: Skills',N'Learning is contextualised to work opportunities relevant to learners'' progression routes.',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000020','71000000-0000-0000-0000-000000000020',N'lesson_visit',N'lv_w3_purpose',200,N'Week 3: Skills',N'Tasks and activities link to a clear end point or goal.',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000021','71000000-0000-0000-0000-000000000021',N'lesson_visit',N'lv_w3_assessment_adaptation',210,N'Week 3: Skills',N'Assessment identifies learners who are struggling and informs adaptations that close knowledge gaps.',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000022','71000000-0000-0000-0000-000000000022',N'lesson_visit',N'lv_w3_vocabulary',220,N'Week 3: Skills',N'Vocabulary is relevant to the industry.',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000023','71000000-0000-0000-0000-000000000023',N'lesson_visit',N'lv_w3_industry_skills',230,N'Week 3: Skills',N'Lesson tasks develop relevant industry-ready skills, such as communication.',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000024','71000000-0000-0000-0000-000000000024',N'lesson_visit',N'lv_w3_authentic_practice',240,N'Week 3: Skills',N'Learners apply and practise skills as they would in the workplace.',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000025','71000000-0000-0000-0000-000000000025',N'lesson_visit',N'lv_w5_feedback',250,N'Week 5: Assessment and Feedback',N'Learners receive feedback during the lesson that helps them improve.',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000026','71000000-0000-0000-0000-000000000026',N'lesson_visit',N'lv_w6_context',260,N'Week 6: English and Mathematics',N'Learning is contextualised using engaging points of reference that reflect learner destinations.',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000027','71000000-0000-0000-0000-000000000027',N'lesson_visit',N'lv_w6_self_assessment',270,N'Week 6: English and Mathematics',N'Learners can identify strengths, areas for improvement and what they need to revise.',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000028','71000000-0000-0000-0000-000000000028',N'lesson_visit',N'lv_w6_development',280,N'Week 6: English and Mathematics',N'Teachers support learners to develop English, mathematics and digital skills.',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000029','71000000-0000-0000-0000-000000000029',N'lesson_visit',N'lv_w6_opportunities',290,N'Week 6: English and Mathematics',N'Opportunities to develop English and mathematics are acted upon.',NULL,0,1,N'active'),

('70000000-0000-0000-0000-000000000030','71000000-0000-0000-0000-000000000030',N'digital_learning_walk',N'dlw_w1_vle',10,N'Week 1: Right Start',N'The VLE contains core course information.',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000031','71000000-0000-0000-0000-000000000031',N'digital_learning_walk',N'dlw_w1_communication',20,N'Week 1: Right Start',N'Clear communication channels are established with learners.',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000032','71000000-0000-0000-0000-000000000032',N'digital_learning_walk',N'dlw_w1_via',30,N'Week 1: Right Start',N'An accurate assessment of starting points has been completed through VIA.',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000033','71000000-0000-0000-0000-000000000033',N'digital_learning_walk',N'dlw_w1_core_documents',40,N'Week 1: Right Start',N'Core course documents are complete.',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000034','71000000-0000-0000-0000-000000000034',N'digital_learning_walk',N'dlw_w1_curriculum_map',50,N'Week 1: Right Start',N'A curriculum map is available to learners.',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000035','71000000-0000-0000-0000-000000000035',N'digital_learning_walk',N'dlw_w1_handbook',60,N'Week 1: Right Start',N'A course handbook is available to learners.',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000036','71000000-0000-0000-0000-000000000036',N'digital_learning_walk',N'dlw_w1_end_points',70,N'Week 1: Right Start',N'Ambitious end points are defined in core documents.',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000037','71000000-0000-0000-0000-000000000037',N'digital_learning_walk',N'dlw_w1_markbook',80,N'Week 1: Right Start',N'The markbook records evidence of learner starting points.',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000038','71000000-0000-0000-0000-000000000038',N'digital_learning_walk',N'dlw_w2_assessment_plan',90,N'Week 2: Level 1',N'The assessment plan shows logical sequencing and development of knowledge.',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000039','71000000-0000-0000-0000-000000000039',N'digital_learning_walk',N'dlw_w2_targets',100,N'Week 2: Level 1',N'Ambitious, clear targets link to learner outcomes and end points.',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000040','71000000-0000-0000-0000-000000000040',N'digital_learning_walk',N'dlw_w2_sow_sampling',110,N'Week 2: Level 1',N'The planned curriculum and scheme of work are ambitious.',N'The source includes an unresolved sampling note. Review and clarify before activation.',0,0,N'draft'),
('70000000-0000-0000-0000-000000000041','71000000-0000-0000-0000-000000000041',N'digital_learning_walk',N'dlw_w2_via_targets',120,N'Week 2: Level 1',N'VIA findings inform ambitious learner targets.',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000042','71000000-0000-0000-0000-000000000042',N'digital_learning_walk',N'dlw_w3_employer_integration',130,N'Week 3: Skills',N'Assessment plans and curriculum maps integrate employers and industry into planning, delivery and assessment.',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000043','71000000-0000-0000-0000-000000000043',N'digital_learning_walk',N'dlw_w3_feedback',140,N'Week 3: Skills',N'Learner feedback links to relevant industry knowledge or skills.',NULL,0,1,N'active'),

('70000000-0000-0000-0000-000000000044','71000000-0000-0000-0000-000000000044',N'work_scrutiny',N'ws_w1_via',10,N'Week 1: Right Start',N'An effective VIA has been completed.',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000045','71000000-0000-0000-0000-000000000045',N'work_scrutiny',N'ws_w1_via_feedback',20,N'Week 1: Right Start',N'Informative and actionable VIA feedback has been provided.',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000046','71000000-0000-0000-0000-000000000046',N'work_scrutiny',N'ws_w1_www_ebi',30,N'Week 1: Right Start',N'What Went Well and Even Better If feedback is used effectively.',NULL,0,1,N'active'),

('70000000-0000-0000-0000-000000000047','71000000-0000-0000-0000-000000000047',N'walk_around',N'wa_w1_start_time',10,N'Week 1: Right Start',N'The lesson starts on time.',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000048','71000000-0000-0000-0000-000000000048',N'walk_around',N'wa_w1_welcome',20,N'Week 1: Right Start',N'The tutor welcomes learners.',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000049','71000000-0000-0000-0000-000000000049',N'walk_around',N'wa_w1_attendance',30,N'Week 1: Right Start',N'Attendance',N'The source is an incomplete criterion. Clarify the intended attendance check before activation.',0,0,N'draft'),
('70000000-0000-0000-0000-000000000050','71000000-0000-0000-0000-000000000050',N'walk_around',N'wa_w1_environment',40,N'Week 1: Right Start',N'The learning environment is appropriate for the planned activity.',NULL,0,1,N'active'),

('70000000-0000-0000-0000-000000000051','71000000-0000-0000-0000-000000000051',N'desk_review',N'dr_w1_attendance_intervention',10,N'Week 1: Right Start',N'Attendance concerns have an effective intervention recorded.',NULL,1,1,N'active'),
('70000000-0000-0000-0000-000000000052','71000000-0000-0000-0000-000000000052',N'desk_review',N'dr_w1_high_needs_targets',20,N'Week 1: Right Start',N'High-needs learner targets align to identified needs or EHCP outcomes.',NULL,1,1,N'active'),
('70000000-0000-0000-0000-000000000053','71000000-0000-0000-0000-000000000053',N'desk_review',N'dr_w1_diagnostic_referrals',30,N'Week 1: Right Start',N'Diagnostic assessment referrals are being made where required.',N'Review volumes and whether referral decisions are supported by evidence.',1,1,N'active'),
('70000000-0000-0000-0000-000000000054','71000000-0000-0000-0000-000000000054',N'desk_review',N'dr_w1_timetable',40,N'Week 1: Right Start',N'Learner timetables are accurate and complete.',NULL,1,1,N'active'),

('70000000-0000-0000-0000-000000000055','71000000-0000-0000-0000-000000000055',N'stop_and_ask',N'sa_w1_support_awareness',10,N'Weeks 1 and 2: Right Start / Level 1',N'Is your tutor aware of any support needs you have?',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000056','71000000-0000-0000-0000-000000000056',N'stop_and_ask',N'sa_w1_support_met',20,N'Weeks 1 and 2: Right Start / Level 1',N'Are your support needs being met?',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000057','71000000-0000-0000-0000-000000000057',N'stop_and_ask',N'sa_w1_achievement_support',30,N'Weeks 1 and 2: Right Start / Level 1',N'Are you being supported in a way that will help you achieve?',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000058','71000000-0000-0000-0000-000000000058',N'stop_and_ask',N'sa_w1_tutors',40,N'Weeks 1 and 2: Right Start / Level 1',N'Do you know who your tutors are?',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000059','71000000-0000-0000-0000-000000000059',N'stop_and_ask',N'sa_w1_timetable',50,N'Weeks 1 and 2: Right Start / Level 1',N'Do you know your timetable?',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000060','71000000-0000-0000-0000-000000000060',N'stop_and_ask',N'sa_w1_app',60,N'Weeks 1 and 2: Right Start / Level 1',N'Do you know how to use the college app?',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000061','71000000-0000-0000-0000-000000000061',N'stop_and_ask',N'sa_w3_employers_learning',70,N'Week 3: Skills',N'Will employers or industry experts be involved in your learning or lessons?',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000062','71000000-0000-0000-0000-000000000062',N'stop_and_ask',N'sa_w3_employers_assessment',80,N'Week 3: Skills',N'Will employers or industry experts be involved in your assessments?',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000063','71000000-0000-0000-0000-000000000063',N'stop_and_ask',N'sa_w3_career_skills',90,N'Week 3: Skills',N'Are your tutors helping you develop the skills needed for your future career?',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000064','71000000-0000-0000-0000-000000000064',N'stop_and_ask',N'sa_w4_relationships',100,N'Week 4: Personal and Professional Development',N'Have you been provided with information about healthy relationships?',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000065','71000000-0000-0000-0000-000000000065',N'stop_and_ask',N'sa_w4_health',110,N'Week 4: Personal and Professional Development',N'Have you taken part in activities relating to mental and physical health?',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000066','71000000-0000-0000-0000-000000000066',N'stop_and_ask',N'sa_w4_safety',120,N'Week 4: Personal and Professional Development',N'Have you discussed how to keep yourself safe from radicalisation, extreme views and online harm?',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000067','71000000-0000-0000-0000-000000000067',N'stop_and_ask',N'sa_w4_values_characteristics',130,N'Week 4: Personal and Professional Development',N'Have you developed your understanding of British values and protected characteristics?',N'Corrected from the source wording "protective characteristics".',0,1,N'active'),
('70000000-0000-0000-0000-000000000068','71000000-0000-0000-0000-000000000068',N'stop_and_ask',N'sa_w5_feedback',140,N'Week 5: Assessment and Feedback',N'Has your tutor provided feedback that helped you improve or develop?',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000069','71000000-0000-0000-0000-000000000069',N'stop_and_ask',N'sa_w5_new_learning',150,N'Week 5: Assessment and Feedback',N'Have you learnt something new or gained new knowledge?',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000070','71000000-0000-0000-0000-000000000070',N'stop_and_ask',N'sa_w5_progress',160,N'Week 5: Assessment and Feedback',N'Have you made progress?',NULL,0,1,N'active'),

('70000000-0000-0000-0000-000000000071','71000000-0000-0000-0000-000000000071',N'student_voice',N'sv_w1_course_content',10,N'Weeks 1 and 2: Right Start / Level 1',N'What will you study and learn on your course?',N'Prompt for units, topics and expected learning.',0,1,N'active'),
('70000000-0000-0000-0000-000000000072','71000000-0000-0000-0000-000000000072',N'student_voice',N'sv_w1_assessment',20,N'Weeks 1 and 2: Right Start / Level 1',N'How will you be assessed on your course?',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000073','71000000-0000-0000-0000-000000000073',N'student_voice',N'sv_w1_destination',30,N'Weeks 1 and 2: Right Start / Level 1',N'What is your intended destination or end point, and how will your course help you get there?',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000074','71000000-0000-0000-0000-000000000074',N'student_voice',N'sv_w1_employers',40,N'Weeks 1 and 2: Right Start / Level 1',N'How and when will you work with employers or industry experts?',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000075','71000000-0000-0000-0000-000000000075',N'student_voice',N'sv_w1_needs_awareness',50,N'Weeks 1 and 2: Right Start / Level 1',N'Are your tutors aware of your needs?',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000076','71000000-0000-0000-0000-000000000076',N'student_voice',N'sv_w1_needs_met',60,N'Weeks 1 and 2: Right Start / Level 1',N'Are your needs being met, and are you being supported in a way that helps you?',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000077','71000000-0000-0000-0000-000000000077',N'student_voice',N'sv_w1_known',70,N'Weeks 1 and 2: Right Start / Level 1',N'Do you feel your tutor has taken the time to get to know you?',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000078','71000000-0000-0000-0000-000000000078',N'student_voice',N'sv_w1_starting_points',80,N'Weeks 1 and 2: Right Start / Level 1',N'Has your tutor found out what you already know so that you can build on your knowledge?',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000079','71000000-0000-0000-0000-000000000079',N'student_voice',N'sv_w1_enjoyment',90,N'Weeks 1 and 2: Right Start / Level 1',N'Have your lessons been interesting and enjoyable? Why?',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000080','71000000-0000-0000-0000-000000000080',N'student_voice',N'sv_w1_new_learning',100,N'Weeks 1 and 2: Right Start / Level 1',N'Have you learnt something new?',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000081','71000000-0000-0000-0000-000000000081',N'student_voice',N'sv_w1_enjoyed_most',110,N'Weeks 1 and 2: Right Start / Level 1',N'What have you enjoyed most so far?',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000082','71000000-0000-0000-0000-000000000082',N'student_voice',N'sv_w1_communication',120,N'Weeks 1 and 2: Right Start / Level 1',N'How will your tutors communicate with you?',NULL,0,1,N'active'),
('70000000-0000-0000-0000-000000000083','71000000-0000-0000-0000-000000000083',N'student_voice',N'sv_w5_improvement',130,N'Week 5: Assessment and Feedback',N'Do you know what you are doing well, what you need to improve and what you need to revise or develop?',NULL,0,1,N'active');

INSERT INTO qa.questions (id, activity_type_id, question_key, default_display_order)
SELECT source.id, activity.id, source.question_key, source.display_order
FROM @questions source
JOIN qa.activity_types activity ON activity.activity_key = source.activity_key
WHERE NOT EXISTS (SELECT 1 FROM qa.questions existing WHERE existing.question_key = source.question_key);

INSERT INTO qa.question_versions (
    id, question_id, version_number, theme_or_week, question_text, guidance,
    is_required, allows_not_applicable, comment_required_at_expected, is_active, source_status
)
SELECT source.version_id, source.id, 1, source.theme, source.question_text, source.guidance,
       1, source.allows_na, 0, source.is_active, source.source_status
FROM @questions source
WHERE NOT EXISTS (SELECT 1 FROM qa.question_versions existing WHERE existing.question_id = source.id AND existing.version_number = 1);

INSERT INTO qa.activity_template_questions (activity_template_id, question_id, display_order)
SELECT template.id, question.id, question.default_display_order
FROM qa.questions question
JOIN qa.activity_types activity ON activity.id = question.activity_type_id
JOIN qa.activity_templates template ON template.activity_type_id = activity.id AND template.archived_at IS NULL
WHERE template.template_key LIKE N'qa_%_initial'
  AND NOT EXISTS (
      SELECT 1 FROM qa.activity_template_questions existing
      WHERE existing.activity_template_id = template.id AND existing.question_id = question.id
  );
GO
