SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO

IF OBJECT_ID('quality.coaching_assignments', 'U') IS NULL
BEGIN
    CREATE TABLE quality.coaching_assignments (
        id uniqueidentifier NOT NULL CONSTRAINT pk_coaching_assignments PRIMARY KEY DEFAULT newsequentialid(),
        staff_id uniqueidentifier NOT NULL,
        coach_staff_id uniqueidentifier NOT NULL,
        assignment_type nvarchar(20) NOT NULL,
        effective_from date NOT NULL CONSTRAINT df_coaching_assignments_from DEFAULT CONVERT(date, sysutcdatetime()),
        effective_to date NULL,
        is_primary bit NOT NULL CONSTRAINT df_coaching_assignments_primary DEFAULT 1,
        created_by_user_account_id uniqueidentifier NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_coaching_assignments_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        archived_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT fk_coaching_assignments_staff FOREIGN KEY (staff_id) REFERENCES people.staff(id),
        CONSTRAINT fk_coaching_assignments_coach FOREIGN KEY (coach_staff_id) REFERENCES people.staff(id),
        CONSTRAINT fk_coaching_assignments_created_by FOREIGN KEY (created_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT ck_coaching_assignments_type CHECK (assignment_type IN ('coaching', 'mentoring', 'combined')),
        CONSTRAINT ck_coaching_assignments_people CHECK (staff_id <> coach_staff_id),
        CONSTRAINT ck_coaching_assignments_dates CHECK (effective_to IS NULL OR effective_to >= effective_from)
    );
END;
GO

IF OBJECT_ID('quality.coaching_cycles', 'U') IS NULL
BEGIN
    CREATE TABLE quality.coaching_cycles (
        id uniqueidentifier NOT NULL CONSTRAINT pk_coaching_cycles PRIMARY KEY DEFAULT newsequentialid(),
        staff_id uniqueidentifier NOT NULL,
        coach_staff_id uniqueidentifier NOT NULL,
        cycle_number int NOT NULL,
        cycle_type nvarchar(20) NOT NULL,
        status nvarchar(20) NOT NULL CONSTRAINT df_coaching_cycles_status DEFAULT 'active',
        started_on date NOT NULL,
        closed_on date NULL,
        created_by_user_account_id uniqueidentifier NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_coaching_cycles_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        archived_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT fk_coaching_cycles_staff FOREIGN KEY (staff_id) REFERENCES people.staff(id),
        CONSTRAINT fk_coaching_cycles_coach FOREIGN KEY (coach_staff_id) REFERENCES people.staff(id),
        CONSTRAINT fk_coaching_cycles_created_by FOREIGN KEY (created_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT uq_coaching_cycles_staff_number UNIQUE (staff_id, cycle_number),
        CONSTRAINT ck_coaching_cycles_number CHECK (cycle_number > 0),
        CONSTRAINT ck_coaching_cycles_type CHECK (cycle_type IN ('coaching', 'mentoring', 'combined')),
        CONSTRAINT ck_coaching_cycles_status CHECK (status IN ('active', 'closed')),
        CONSTRAINT ck_coaching_cycles_dates CHECK (closed_on IS NULL OR closed_on >= started_on)
    );
END;
GO

IF OBJECT_ID('quality.coaching_sessions', 'U') IS NULL
BEGIN
    CREATE TABLE quality.coaching_sessions (
        id uniqueidentifier NOT NULL CONSTRAINT pk_coaching_sessions PRIMARY KEY DEFAULT newsequentialid(),
        record_id uniqueidentifier NOT NULL,
        cycle_id uniqueidentifier NOT NULL,
        staff_id uniqueidentifier NOT NULL,
        coach_staff_id uniqueidentifier NOT NULL,
        session_number int NOT NULL,
        session_date date NOT NULL,
        session_type nvarchar(20) NOT NULL,
        delivery_method nvarchar(20) NULL,
        duration_minutes int NULL,
        status nvarchar(20) NOT NULL CONSTRAINT df_coaching_sessions_status DEFAULT 'draft',
        progress_reflection nvarchar(max) NULL,
        main_focus nvarchar(100) NULL,
        additional_focus_json nvarchar(max) NULL,
        session_reason nvarchar(150) NULL,
        goal nvarchar(max) NULL,
        why_this_matters nvarchar(max) NULL,
        confidence_before tinyint NULL,
        current_situation nvarchar(max) NULL,
        whats_working nvarchar(max) NULL,
        challenges nvarchar(max) NULL,
        key_discussion_points nvarchar(max) NULL,
        support_types_json nvarchar(max) NULL,
        support_resources nvarchar(max) NULL,
        intended_impact_areas_json nvarchar(max) NULL,
        impact_statement nvarchar(max) NULL,
        confidence_to_complete tinyint NULL,
        support_needed_json nvarchar(max) NULL,
        additional_support_details nvarchar(max) NULL,
        key_takeaway nvarchar(max) NULL,
        session_summary nvarchar(max) NULL,
        staff_agrees bit NOT NULL CONSTRAINT df_coaching_sessions_staff_agrees DEFAULT 0,
        coach_agrees bit NOT NULL CONSTRAINT df_coaching_sessions_coach_agrees DEFAULT 0,
        another_session_required nvarchar(20) NULL,
        next_session_date date NULL,
        next_focus nvarchar(200) NULL,
        completed_at datetimeoffset NULL,
        created_by_user_account_id uniqueidentifier NULL,
        updated_by_user_account_id uniqueidentifier NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_coaching_sessions_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        archived_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT fk_coaching_sessions_record FOREIGN KEY (record_id) REFERENCES core.records(id),
        CONSTRAINT fk_coaching_sessions_cycle FOREIGN KEY (cycle_id) REFERENCES quality.coaching_cycles(id),
        CONSTRAINT fk_coaching_sessions_staff FOREIGN KEY (staff_id) REFERENCES people.staff(id),
        CONSTRAINT fk_coaching_sessions_coach FOREIGN KEY (coach_staff_id) REFERENCES people.staff(id),
        CONSTRAINT fk_coaching_sessions_created_by FOREIGN KEY (created_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT fk_coaching_sessions_updated_by FOREIGN KEY (updated_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT uq_coaching_sessions_record UNIQUE (record_id),
        CONSTRAINT uq_coaching_sessions_cycle_number UNIQUE (cycle_id, session_number),
        CONSTRAINT ck_coaching_sessions_number CHECK (session_number > 0),
        CONSTRAINT ck_coaching_sessions_type CHECK (session_type IN ('coaching', 'mentoring', 'combined')),
        CONSTRAINT ck_coaching_sessions_delivery CHECK (delivery_method IS NULL OR delivery_method IN ('in_person', 'online', 'telephone')),
        CONSTRAINT ck_coaching_sessions_duration CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 480),
        CONSTRAINT ck_coaching_sessions_status CHECK (status IN ('draft', 'completed')),
        CONSTRAINT ck_coaching_sessions_confidence_before CHECK (confidence_before IS NULL OR confidence_before BETWEEN 1 AND 5),
        CONSTRAINT ck_coaching_sessions_confidence_complete CHECK (confidence_to_complete IS NULL OR confidence_to_complete BETWEEN 1 AND 5),
        CONSTRAINT ck_coaching_sessions_next_required CHECK (another_session_required IS NULL OR another_session_required IN ('yes', 'no', 'to_be_confirmed')),
        CONSTRAINT ck_coaching_sessions_additional_focus_json CHECK (additional_focus_json IS NULL OR ISJSON(additional_focus_json) = 1),
        CONSTRAINT ck_coaching_sessions_support_types_json CHECK (support_types_json IS NULL OR ISJSON(support_types_json) = 1),
        CONSTRAINT ck_coaching_sessions_impact_json CHECK (intended_impact_areas_json IS NULL OR ISJSON(intended_impact_areas_json) = 1),
        CONSTRAINT ck_coaching_sessions_support_needed_json CHECK (support_needed_json IS NULL OR ISJSON(support_needed_json) = 1)
    );
END;
GO

IF OBJECT_ID('quality.coaching_session_actions', 'U') IS NULL
BEGIN
    CREATE TABLE quality.coaching_session_actions (
        id uniqueidentifier NOT NULL CONSTRAINT pk_coaching_session_actions PRIMARY KEY DEFAULT newsequentialid(),
        session_id uniqueidentifier NOT NULL,
        action_order int NOT NULL,
        action_text nvarchar(1000) NOT NULL,
        owner_type nvarchar(20) NOT NULL,
        target_date date NOT NULL,
        evidence_text nvarchar(max) NULL,
        action_id uniqueidentifier NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_coaching_session_actions_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        archived_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT fk_coaching_session_actions_session FOREIGN KEY (session_id) REFERENCES quality.coaching_sessions(id),
        CONSTRAINT fk_coaching_session_actions_action FOREIGN KEY (action_id) REFERENCES quality.actions(id),
        CONSTRAINT uq_coaching_session_actions_order UNIQUE (session_id, action_order),
        CONSTRAINT ck_coaching_session_actions_order CHECK (action_order > 0),
        CONSTRAINT ck_coaching_session_actions_owner CHECK (owner_type IN ('staff', 'coach', 'joint'))
    );
END;
GO

IF OBJECT_ID('quality.coaching_previous_action_updates', 'U') IS NULL
BEGIN
    CREATE TABLE quality.coaching_previous_action_updates (
        id uniqueidentifier NOT NULL CONSTRAINT pk_coaching_previous_action_updates PRIMARY KEY DEFAULT newsequentialid(),
        session_id uniqueidentifier NOT NULL,
        action_id uniqueidentifier NOT NULL,
        status nvarchar(20) NOT NULL,
        update_text nvarchar(max) NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_coaching_previous_updates_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT fk_coaching_previous_updates_session FOREIGN KEY (session_id) REFERENCES quality.coaching_sessions(id),
        CONSTRAINT fk_coaching_previous_updates_action FOREIGN KEY (action_id) REFERENCES quality.actions(id),
        CONSTRAINT uq_coaching_previous_updates UNIQUE (session_id, action_id),
        CONSTRAINT ck_coaching_previous_updates_status CHECK (status IN ('not_started', 'in_progress', 'completed', 'not_applicable'))
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('quality.coaching_assignments') AND name = 'ix_coaching_assignments_staff_active')
    CREATE INDEX ix_coaching_assignments_staff_active ON quality.coaching_assignments(staff_id, effective_from, effective_to) INCLUDE (coach_staff_id, assignment_type, is_primary) WHERE archived_at IS NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('quality.coaching_cycles') AND name = 'ix_coaching_cycles_staff_status')
    CREATE INDEX ix_coaching_cycles_staff_status ON quality.coaching_cycles(staff_id, status, started_on DESC) INCLUDE (coach_staff_id, cycle_number) WHERE archived_at IS NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('quality.coaching_sessions') AND name = 'ix_coaching_sessions_staff_date')
    CREATE INDEX ix_coaching_sessions_staff_date ON quality.coaching_sessions(staff_id, session_date DESC) INCLUDE (coach_staff_id, status, session_number, cycle_id) WHERE archived_at IS NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('quality.coaching_session_actions') AND name = 'ix_coaching_session_actions_action')
    CREATE INDEX ix_coaching_session_actions_action ON quality.coaching_session_actions(action_id) WHERE action_id IS NOT NULL AND archived_at IS NULL;
GO

INSERT INTO core.modules (id, module_key, name, route_prefix, display_order, description)
SELECT '50000000-0000-0000-0000-000000000012', 'coaching_mentoring', 'Coaching and Mentoring', '/coaching-mentoring', 55,
       'Cycle-based coaching and mentoring sessions with carried actions and impact review.'
WHERE NOT EXISTS (SELECT 1 FROM core.modules WHERE module_key = 'coaching_mentoring');
GO

INSERT INTO auth.permissions (id, permission_key, name, category)
SELECT v.id, v.permission_key, v.name, v.category
FROM (VALUES
    (CONVERT(uniqueidentifier, '31000000-0000-0000-0000-000000000019'), 'coaching.submit', 'Create Coaching and Mentoring Sessions', 'Coaching and Mentoring'),
    (CONVERT(uniqueidentifier, '31000000-0000-0000-0000-000000000020'), 'coaching.manage', 'Manage Coaching and Mentoring Sessions', 'Coaching and Mentoring')
) v(id, permission_key, name, category)
WHERE NOT EXISTS (SELECT 1 FROM auth.permissions existing WHERE existing.permission_key = v.permission_key);
GO

INSERT INTO auth.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM auth.roles r
JOIN auth.permissions p ON p.permission_key = 'coaching.submit'
WHERE r.role_key IN ('super_admin', 'teaching_learning_team', 'director', 'head_of_faculty', 'programme_leader')
  AND r.is_active = 1
  AND NOT EXISTS (
      SELECT 1 FROM auth.role_permissions existing
      WHERE existing.role_id = r.id AND existing.permission_id = p.id
  );
GO

INSERT INTO auth.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM auth.roles r
JOIN auth.permissions p ON p.permission_key = 'coaching.manage'
WHERE r.role_key IN ('super_admin', 'teaching_learning_team')
  AND r.is_active = 1
  AND NOT EXISTS (
      SELECT 1 FROM auth.role_permissions existing
      WHERE existing.role_id = r.id AND existing.permission_id = p.id
  );
GO

DECLARE @actionStatusLookupId uniqueidentifier = (
    SELECT id FROM core.lookup_types WHERE lookup_key = 'action_status' AND archived_at IS NULL
);

IF @actionStatusLookupId IS NOT NULL
   AND NOT EXISTS (
       SELECT 1 FROM core.lookup_values
       WHERE lookup_type_id = @actionStatusLookupId AND value_key = 'not_applicable'
   )
BEGIN
    INSERT INTO core.lookup_values (
        id, lookup_type_id, value_key, display_name, display_order, color_hex, notes
    )
    VALUES (
        '12000000-0000-0000-0000-000000000005', @actionStatusLookupId,
        'not_applicable', 'Not Applicable', 5, '#64748B', 'Available when a carried coaching action no longer applies.'
    );
END;
GO
