SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO

INSERT INTO auth.permissions (permission_key, name, description, category, is_system)
SELECT N'qa_reviews.actions_admin', N'Monitor all QA Review actions',
       N'View and close every QA Review action group from the QA Hub.', N'QA Reviews', 1
WHERE NOT EXISTS (
    SELECT 1 FROM auth.permissions WHERE permission_key = N'qa_reviews.actions_admin'
);

INSERT INTO auth.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM auth.roles role
JOIN auth.permissions permission ON permission.permission_key = N'qa_reviews.actions_admin'
WHERE role.role_key = N'super_admin'
  AND NOT EXISTS (
      SELECT 1 FROM auth.role_permissions existing
      WHERE existing.role_id = role.id AND existing.permission_id = permission.id
  );
GO

IF OBJECT_ID(N'qa.action_groups', N'U') IS NULL
BEGIN
    CREATE TABLE qa.action_groups (
        id uniqueidentifier NOT NULL CONSTRAINT pk_qa_action_groups PRIMARY KEY DEFAULT newsequentialid(),
        review_id uniqueidentifier NOT NULL,
        faculty_org_unit_id uniqueidentifier NOT NULL,
        faculty_code_snapshot nvarchar(50) NOT NULL,
        faculty_name_snapshot nvarchar(250) NOT NULL,
        title nvarchar(300) NOT NULL,
        detail nvarchar(2000) NULL,
        due_date date NOT NULL,
        forced_closed_at datetimeoffset NULL,
        forced_closed_by_user_account_id uniqueidentifier NULL,
        forced_close_note nvarchar(1000) NULL,
        created_by_user_account_id uniqueidentifier NOT NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_qa_action_groups_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT fk_qa_action_groups_review FOREIGN KEY (review_id) REFERENCES qa.reviews(record_id),
        CONSTRAINT fk_qa_action_groups_faculty FOREIGN KEY (faculty_org_unit_id) REFERENCES org.org_units(id),
        CONSTRAINT fk_qa_action_groups_closed_by FOREIGN KEY (forced_closed_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT fk_qa_action_groups_created_by FOREIGN KEY (created_by_user_account_id) REFERENCES auth.user_accounts(id)
    );
END;
GO

IF OBJECT_ID(N'qa.action_group_teams', N'U') IS NULL
BEGIN
    CREATE TABLE qa.action_group_teams (
        action_group_id uniqueidentifier NOT NULL,
        team_org_unit_id uniqueidentifier NOT NULL,
        team_code_snapshot nvarchar(50) NOT NULL,
        team_name_snapshot nvarchar(250) NOT NULL,
        CONSTRAINT pk_qa_action_group_teams PRIMARY KEY (action_group_id, team_org_unit_id),
        CONSTRAINT fk_qa_action_group_teams_group FOREIGN KEY (action_group_id) REFERENCES qa.action_groups(id),
        CONSTRAINT fk_qa_action_group_teams_team FOREIGN KEY (team_org_unit_id) REFERENCES org.org_units(id)
    );
END;
GO

IF OBJECT_ID(N'qa.action_group_assignments', N'U') IS NULL
BEGIN
    CREATE TABLE qa.action_group_assignments (
        action_group_id uniqueidentifier NOT NULL,
        action_id uniqueidentifier NOT NULL,
        staff_id uniqueidentifier NOT NULL,
        assignment_role nvarchar(20) NOT NULL,
        source_org_unit_id uniqueidentifier NOT NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_qa_action_group_assignments_created DEFAULT sysutcdatetime(),
        CONSTRAINT pk_qa_action_group_assignments PRIMARY KEY (action_group_id, action_id),
        CONSTRAINT fk_qa_action_group_assignments_group FOREIGN KEY (action_group_id) REFERENCES qa.action_groups(id),
        CONSTRAINT fk_qa_action_group_assignments_action FOREIGN KEY (action_id) REFERENCES quality.actions(id),
        CONSTRAINT fk_qa_action_group_assignments_staff FOREIGN KEY (staff_id) REFERENCES people.staff(id),
        CONSTRAINT fk_qa_action_group_assignments_org FOREIGN KEY (source_org_unit_id) REFERENCES org.org_units(id),
        CONSTRAINT uq_qa_action_group_assignment_staff UNIQUE (action_group_id, staff_id),
        CONSTRAINT ck_qa_action_group_assignment_role CHECK (assignment_role IN (N'hof', N'pl'))
    );
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'qa.action_groups') AND name = N'ix_qa_action_groups_monitor'
)
    CREATE INDEX ix_qa_action_groups_monitor
        ON qa.action_groups(review_id, faculty_org_unit_id, due_date)
        INCLUDE (title, forced_closed_at, created_at);

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'qa.action_group_teams') AND name = N'ix_qa_action_group_teams_scope'
)
    CREATE INDEX ix_qa_action_group_teams_scope
        ON qa.action_group_teams(team_org_unit_id, action_group_id);

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'qa.action_group_assignments') AND name = N'ix_qa_action_group_assignments_staff'
)
    CREATE INDEX ix_qa_action_group_assignments_staff
        ON qa.action_group_assignments(staff_id, action_group_id)
        INCLUDE (action_id, assignment_role, source_org_unit_id);
GO

INSERT INTO core.lookup_types (id, lookup_key, name, description, is_system)
SELECT CONVERT(uniqueidentifier, '9a000000-0000-0000-0000-000000000009'),
       N'action_theme_qa_review', N'QA Review action themes',
       N'Configurable action themes for QA Review actions.', 0
WHERE NOT EXISTS (
    SELECT 1 FROM core.lookup_types WHERE lookup_key = N'action_theme_qa_review'
);

INSERT INTO core.lookup_values (id, lookup_type_id, value_key, display_name, display_order)
SELECT CONVERT(uniqueidentifier, '9a900000-0000-0000-0000-000000000001'), type.id,
       N'quality_improvement', N'Quality improvement', 10
FROM core.lookup_types type
WHERE type.lookup_key = N'action_theme_qa_review'
  AND NOT EXISTS (
      SELECT 1 FROM core.lookup_values value
      WHERE value.lookup_type_id = type.id AND value.value_key = N'quality_improvement'
  );
GO
