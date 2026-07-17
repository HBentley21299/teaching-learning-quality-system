SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO

INSERT INTO core.modules (id, module_key, name, route_prefix, display_order, description)
SELECT CONVERT(uniqueidentifier, '50000000-0000-0000-0000-000000000013'),
       N'probation_observations', N'Probationary Observations', N'/probation-observations', 46,
       N'Three-observation probation workflow with a shared LIV second observation.'
WHERE NOT EXISTS (SELECT 1 FROM core.modules WHERE module_key = N'probation_observations');
GO

INSERT INTO auth.permissions (id, permission_key, name, category)
SELECT value.id, value.permission_key, value.name, N'Probationary Observations'
FROM (VALUES
    (CONVERT(uniqueidentifier, '31000000-0000-0000-0000-000000000026'), N'probation.submit', N'Create Probationary Observations'),
    (CONVERT(uniqueidentifier, '31000000-0000-0000-0000-000000000027'), N'probation.manage', N'Manage Probationary Observations')
) value(id, permission_key, name)
WHERE NOT EXISTS (
    SELECT 1 FROM auth.permissions existing WHERE existing.permission_key = value.permission_key
);
GO

INSERT INTO auth.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM auth.roles role
JOIN auth.permissions permission ON permission.permission_key = N'probation.submit'
WHERE role.role_key IN (N'super_admin', N'teaching_learning_team', N'director', N'head_of_faculty', N'programme_leader')
  AND role.archived_at IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM auth.role_permissions existing
      WHERE existing.role_id = role.id AND existing.permission_id = permission.id
  );

INSERT INTO auth.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM auth.roles role
JOIN auth.permissions permission ON permission.permission_key = N'probation.manage'
WHERE role.role_key IN (N'super_admin', N'teaching_learning_team')
  AND role.archived_at IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM auth.role_permissions existing
      WHERE existing.role_id = role.id AND existing.permission_id = permission.id
  );
GO

IF OBJECT_ID(N'quality.probation_cases', N'U') IS NULL
BEGIN
    CREATE TABLE quality.probation_cases (
        id uniqueidentifier NOT NULL CONSTRAINT pk_probation_cases PRIMARY KEY DEFAULT newsequentialid(),
        record_id uniqueidentifier NOT NULL,
        subject_staff_id uniqueidentifier NOT NULL,
        org_unit_id uniqueidentifier NULL,
        source_elevate_assessment_id uniqueidentifier NULL,
        academic_year nvarchar(20) NOT NULL,
        status nvarchar(30) NOT NULL CONSTRAINT df_probation_cases_status DEFAULT N'in_progress',
        current_observation_number tinyint NOT NULL CONSTRAINT df_probation_cases_current_observation DEFAULT 1,
        completed_at datetimeoffset NULL,
        created_by_user_account_id uniqueidentifier NULL,
        updated_by_user_account_id uniqueidentifier NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_probation_cases_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        archived_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT uq_probation_cases_record UNIQUE (record_id),
        CONSTRAINT fk_probation_cases_record FOREIGN KEY (record_id) REFERENCES core.records(id),
        CONSTRAINT fk_probation_cases_staff FOREIGN KEY (subject_staff_id) REFERENCES people.staff(id),
        CONSTRAINT fk_probation_cases_org FOREIGN KEY (org_unit_id) REFERENCES org.org_units(id),
        CONSTRAINT fk_probation_cases_elevate FOREIGN KEY (source_elevate_assessment_id) REFERENCES quality.elevate_practice_assessments(id),
        CONSTRAINT fk_probation_cases_created_by FOREIGN KEY (created_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT fk_probation_cases_updated_by FOREIGN KEY (updated_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT ck_probation_cases_status CHECK (status IN (N'in_progress', N'completed')),
        CONSTRAINT ck_probation_cases_current_observation CHECK (current_observation_number BETWEEN 1 AND 3)
    );
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'quality.probation_cases') AND name = N'ux_probation_cases_staff_year_active'
)
    CREATE UNIQUE INDEX ux_probation_cases_staff_year_active
        ON quality.probation_cases(subject_staff_id, academic_year)
        WHERE archived_at IS NULL;
GO

IF OBJECT_ID(N'quality.probation_case_reviewers', N'U') IS NULL
BEGIN
    CREATE TABLE quality.probation_case_reviewers (
        probation_case_id uniqueidentifier NOT NULL,
        staff_id uniqueidentifier NOT NULL,
        reviewer_role nvarchar(30) NOT NULL,
        created_by_user_account_id uniqueidentifier NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_probation_reviewers_created DEFAULT sysutcdatetime(),
        row_version rowversion NOT NULL,
        CONSTRAINT pk_probation_case_reviewers PRIMARY KEY (probation_case_id, reviewer_role),
        CONSTRAINT uq_probation_case_reviewer_staff UNIQUE (probation_case_id, staff_id),
        CONSTRAINT fk_probation_reviewers_case FOREIGN KEY (probation_case_id) REFERENCES quality.probation_cases(id),
        CONSTRAINT fk_probation_reviewers_staff FOREIGN KEY (staff_id) REFERENCES people.staff(id),
        CONSTRAINT fk_probation_reviewers_created_by FOREIGN KEY (created_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT ck_probation_reviewers_role CHECK (reviewer_role IN (N'teaching_learning', N'leader'))
    );
END;
GO

IF OBJECT_ID(N'quality.probation_observations', N'U') IS NULL
BEGIN
    CREATE TABLE quality.probation_observations (
        id uniqueidentifier NOT NULL CONSTRAINT pk_probation_observations PRIMARY KEY DEFAULT newsequentialid(),
        probation_case_id uniqueidentifier NOT NULL,
        observation_number tinyint NOT NULL,
        observation_type nvarchar(30) NOT NULL,
        status nvarchar(30) NOT NULL CONSTRAINT df_probation_observations_status DEFAULT N'not_started',
        linked_liv_record_id uniqueidentifier NULL,
        started_at datetimeoffset NULL,
        completed_at datetimeoffset NULL,
        completed_by_user_account_id uniqueidentifier NULL,
        created_by_user_account_id uniqueidentifier NULL,
        updated_by_user_account_id uniqueidentifier NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_probation_observations_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT uq_probation_observations_number UNIQUE (probation_case_id, observation_number),
        CONSTRAINT uq_probation_observations_liv UNIQUE (linked_liv_record_id),
        CONSTRAINT fk_probation_observations_case FOREIGN KEY (probation_case_id) REFERENCES quality.probation_cases(id),
        CONSTRAINT fk_probation_observations_liv FOREIGN KEY (linked_liv_record_id) REFERENCES quality.liv_records(id),
        CONSTRAINT fk_probation_observations_completed_by FOREIGN KEY (completed_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT fk_probation_observations_created_by FOREIGN KEY (created_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT fk_probation_observations_updated_by FOREIGN KEY (updated_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT ck_probation_observations_number CHECK (observation_number BETWEEN 1 AND 3),
        CONSTRAINT ck_probation_observations_type CHECK (
            (observation_number IN (1, 3) AND observation_type = N'probation')
            OR (observation_number = 2 AND observation_type = N'liv')
        ),
        CONSTRAINT ck_probation_observations_status CHECK (status IN (N'not_started', N'in_progress', N'completed')),
        CONSTRAINT ck_probation_observations_liv_link CHECK (
            (observation_number = 2) OR linked_liv_record_id IS NULL
        )
    );
END;
GO

IF OBJECT_ID(N'quality.probation_observation_stages', N'U') IS NULL
BEGIN
    CREATE TABLE quality.probation_observation_stages (
        id uniqueidentifier NOT NULL CONSTRAINT pk_probation_observation_stages PRIMARY KEY DEFAULT newsequentialid(),
        probation_observation_id uniqueidentifier NOT NULL,
        stage_type nvarchar(40) NOT NULL,
        stage_order tinyint NOT NULL,
        stage_status nvarchar(30) NOT NULL CONSTRAINT df_probation_stages_status DEFAULT N'in_progress',
        context_text nvarchar(max) NULL,
        aims_text nvarchar(max) NULL,
        learner_activity_text nvarchar(max) NULL,
        reflection_text nvarchar(max) NULL,
        development_opportunity_keys_json nvarchar(max) NULL,
        intended_next_observation_date date NULL,
        created_by_user_account_id uniqueidentifier NULL,
        updated_by_user_account_id uniqueidentifier NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_probation_stages_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT uq_probation_stages_type UNIQUE (probation_observation_id, stage_type),
        CONSTRAINT fk_probation_stages_observation FOREIGN KEY (probation_observation_id) REFERENCES quality.probation_observations(id),
        CONSTRAINT fk_probation_stages_created_by FOREIGN KEY (created_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT fk_probation_stages_updated_by FOREIGN KEY (updated_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT ck_probation_stages_type CHECK (stage_type IN (
            N'professional_discussion', N'visit_rubric', N'reflection_feedback', N'actions', N'next_observation'
        )),
        CONSTRAINT ck_probation_stages_order CHECK (stage_order BETWEEN 1 AND 5),
        CONSTRAINT ck_probation_stages_status CHECK (stage_status IN (N'in_progress', N'completed')),
        CONSTRAINT ck_probation_stages_opportunities CHECK (
            development_opportunity_keys_json IS NULL OR ISJSON(development_opportunity_keys_json) = 1
        )
    );
END;
GO

IF OBJECT_ID(N'quality.probation_observation_visits', N'U') IS NULL
BEGIN
    CREATE TABLE quality.probation_observation_visits (
        probation_observation_id uniqueidentifier NOT NULL CONSTRAINT pk_probation_observation_visits PRIMARY KEY,
        delivery_area_lookup_value_id uniqueidentifier NULL,
        observation_date date NULL,
        observation_time time(0) NULL,
        course_name nvarchar(300) NULL,
        course_group nvarchar(200) NULL,
        course_level nvarchar(100) NULL,
        key_points nvarchar(max) NULL,
        created_by_user_account_id uniqueidentifier NULL,
        updated_by_user_account_id uniqueidentifier NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_probation_visits_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT fk_probation_visits_observation FOREIGN KEY (probation_observation_id) REFERENCES quality.probation_observations(id),
        CONSTRAINT fk_probation_visits_delivery FOREIGN KEY (delivery_area_lookup_value_id) REFERENCES core.lookup_values(id),
        CONSTRAINT fk_probation_visits_created_by FOREIGN KEY (created_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT fk_probation_visits_updated_by FOREIGN KEY (updated_by_user_account_id) REFERENCES auth.user_accounts(id)
    );
END;
GO

IF OBJECT_ID(N'quality.probation_observation_ratings', N'U') IS NULL
BEGIN
    CREATE TABLE quality.probation_observation_ratings (
        probation_observation_id uniqueidentifier NOT NULL,
        focus_lookup_value_id uniqueidentifier NOT NULL,
        descriptor_id uniqueidentifier NOT NULL,
        hidden_numeric_value tinyint NOT NULL,
        evidence_of_practice nvarchar(max) NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_probation_ratings_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT pk_probation_observation_ratings PRIMARY KEY (probation_observation_id, focus_lookup_value_id),
        CONSTRAINT fk_probation_ratings_observation FOREIGN KEY (probation_observation_id) REFERENCES quality.probation_observations(id),
        CONSTRAINT fk_probation_ratings_focus FOREIGN KEY (focus_lookup_value_id) REFERENCES core.lookup_values(id),
        CONSTRAINT fk_probation_ratings_descriptor FOREIGN KEY (descriptor_id) REFERENCES quality.elevate_practice_rubric_descriptors(id),
        CONSTRAINT ck_probation_ratings_value CHECK (hidden_numeric_value BETWEEN 1 AND 5)
    );
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'quality.probation_observations') AND name = N'ix_probation_observations_case_status'
)
    CREATE INDEX ix_probation_observations_case_status
        ON quality.probation_observations(probation_case_id, status, observation_number)
        INCLUDE (linked_liv_record_id, completed_at);
GO

