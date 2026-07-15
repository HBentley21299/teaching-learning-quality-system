SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO

-- LIV is a staff-visible case with an initial visit and unlimited follow-up visits.
IF COL_LENGTH('quality.liv_records', 'current_stage') IS NULL
BEGIN
    ALTER TABLE quality.liv_records ADD current_stage nvarchar(100) NULL;
END;
GO

IF COL_LENGTH('quality.liv_records', 'visibility_status') IS NULL
BEGIN
    ALTER TABLE quality.liv_records ADD visibility_status nvarchar(50) NULL;
END;
GO

IF COL_LENGTH('quality.liv_records', 'completion_date') IS NULL
BEGIN
    ALTER TABLE quality.liv_records ADD completion_date date NULL;
END;
GO

IF COL_LENGTH('quality.liv_records', 'is_elevate_practitioner') IS NULL
BEGIN
    ALTER TABLE quality.liv_records ADD is_elevate_practitioner bit NULL;
END;
GO

IF COL_LENGTH('quality.liv_records', 'area_of_practice_keys_json') IS NULL
BEGIN
    ALTER TABLE quality.liv_records ADD area_of_practice_keys_json nvarchar(max) NULL;
END;
GO

IF COL_LENGTH('quality.liv_records', 'area_of_practice_other') IS NULL
BEGIN
    ALTER TABLE quality.liv_records ADD area_of_practice_other nvarchar(1000) NULL;
END;
GO

UPDATE quality.liv_records
SET current_stage = COALESCE(current_stage, 'visit_1'),
    visibility_status = COALESCE(visibility_status, 'staff_visible')
WHERE current_stage IS NULL OR visibility_status IS NULL;
GO

IF OBJECT_ID('quality.liv_visits', 'U') IS NULL
BEGIN
    CREATE TABLE quality.liv_visits (
        id uniqueidentifier NOT NULL CONSTRAINT pk_liv_visits PRIMARY KEY DEFAULT newsequentialid(),
        liv_record_id uniqueidentifier NOT NULL,
        visit_number int NOT NULL,
        visit_date date NULL,
        visit_time time NULL,
        visit_type nvarchar(50) NOT NULL CONSTRAINT df_liv_visits_type DEFAULT 'follow_up',
        course_name nvarchar(300) NULL,
        course_group nvarchar(200) NULL,
        course_level nvarchar(100) NULL,
        reflection_notes nvarchar(max) NULL,
        findings nvarchar(max) NULL,
        visit_status nvarchar(50) NOT NULL CONSTRAINT df_liv_visits_status DEFAULT 'in_progress',
        created_by_user_account_id uniqueidentifier NULL,
        updated_by_user_account_id uniqueidentifier NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_liv_visits_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        archived_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT fk_liv_visits_record FOREIGN KEY (liv_record_id) REFERENCES quality.liv_records(id),
        CONSTRAINT fk_liv_visits_created_by FOREIGN KEY (created_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT fk_liv_visits_updated_by FOREIGN KEY (updated_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT uq_liv_visits_number UNIQUE (liv_record_id, visit_number),
        CONSTRAINT ck_liv_visits_number CHECK (visit_number > 0),
        CONSTRAINT ck_liv_visits_type CHECK (visit_type IN ('initial', 'follow_up')),
        CONSTRAINT ck_liv_visits_status CHECK (visit_status IN ('in_progress', 'completed'))
    );
END;
GO

INSERT INTO quality.liv_visits (
    liv_record_id, visit_number, visit_date, visit_time, visit_type, course_name,
    reflection_notes, findings, visit_status, created_by_user_account_id, created_at)
SELECT
    liv.id, 1, liv.liv_date, liv.liv_time, 'initial', liv.course_seen,
    liv.liv_overview, liv.post_conversation,
    CASE WHEN liv.status = 'closed' THEN 'completed' ELSE 'in_progress' END,
    liv.created_by_user_account_id, liv.created_at
FROM quality.liv_records liv
WHERE NOT EXISTS (
    SELECT 1 FROM quality.liv_visits visit
    WHERE visit.liv_record_id = liv.id AND visit.visit_number = 1
);
GO

INSERT INTO quality.liv_visits (
    liv_record_id, visit_number, visit_date, visit_type, course_name,
    reflection_notes, visit_status, created_by_user_account_id, created_at)
SELECT
    liv.id, 2, liv.follow_up_projected_date, 'follow_up', liv.course_seen,
    liv.second_liv_overview,
    CASE WHEN liv.status = 'closed' THEN 'completed' ELSE 'in_progress' END,
    liv.created_by_user_account_id, COALESCE(liv.updated_at, liv.created_at)
FROM quality.liv_records liv
WHERE (liv.second_liv_overview IS NOT NULL OR liv.follow_up_projected_date IS NOT NULL)
  AND NOT EXISTS (
      SELECT 1 FROM quality.liv_visits visit
      WHERE visit.liv_record_id = liv.id AND visit.visit_number = 2
  );
GO

IF EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = 'ck_liv_records_status'
      AND parent_object_id = OBJECT_ID('quality.liv_records')
)
BEGIN
    ALTER TABLE quality.liv_records DROP CONSTRAINT ck_liv_records_status;
END;
GO

UPDATE quality.liv_records
SET status = 'in_progress'
WHERE status IN ('draft', 'open');
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = 'ck_liv_records_status'
      AND parent_object_id = OBJECT_ID('quality.liv_records')
)
BEGIN
    ALTER TABLE quality.liv_records ADD CONSTRAINT ck_liv_records_status
        CHECK (status IN ('in_progress', 'closed'));
END;
GO

DECLARE @livStatusDefault sysname = (
    SELECT dc.name
    FROM sys.default_constraints dc
    JOIN sys.columns c ON c.default_object_id = dc.object_id
    WHERE dc.parent_object_id = OBJECT_ID('quality.liv_records')
      AND c.name = 'status'
);
IF @livStatusDefault IS NOT NULL
BEGIN
    DECLARE @dropLivStatusDefault nvarchar(max) =
        N'ALTER TABLE quality.liv_records DROP CONSTRAINT ' + QUOTENAME(@livStatusDefault) + N';';
    EXEC sys.sp_executesql @dropLivStatusDefault;
END;
ALTER TABLE quality.liv_records ADD CONSTRAINT df_liv_records_status DEFAULT 'in_progress' FOR status;
GO

IF COL_LENGTH('quality.actions', 'liv_visit_id') IS NULL
BEGIN
    ALTER TABLE quality.actions ADD liv_visit_id uniqueidentifier NULL;
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys
    WHERE name = 'fk_actions_liv_visit'
      AND parent_object_id = OBJECT_ID('quality.actions')
)
BEGIN
    ALTER TABLE quality.actions ADD CONSTRAINT fk_actions_liv_visit
        FOREIGN KEY (liv_visit_id) REFERENCES quality.liv_visits(id);
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'ix_actions_liv_visit'
      AND object_id = OBJECT_ID('quality.actions')
)
BEGIN
    CREATE INDEX ix_actions_liv_visit ON quality.actions(liv_visit_id)
    WHERE liv_visit_id IS NOT NULL;
END;
GO

INSERT INTO auth.permissions (id, permission_key, name, category)
SELECT '31000000-0000-0000-0000-000000000021', 'liv.sensitive.read', 'View Sensitive LIV Practitioner Fields', 'LIV'
WHERE NOT EXISTS (
    SELECT 1 FROM auth.permissions WHERE permission_key = 'liv.sensitive.read'
);
GO

INSERT INTO auth.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM auth.roles r
JOIN auth.permissions p ON p.permission_key = 'liv.sensitive.read'
WHERE r.role_key IN ('super_admin', 'teaching_learning_team')
  AND NOT EXISTS (
      SELECT 1 FROM auth.role_permissions rp
      WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
GO
