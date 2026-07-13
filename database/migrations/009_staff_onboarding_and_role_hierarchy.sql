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

IF COL_LENGTH('auth.roles', 'precedence') IS NULL
BEGIN
    ALTER TABLE auth.roles
    ADD precedence int NOT NULL
        CONSTRAINT df_roles_precedence DEFAULT 0;
END;
GO

UPDATE auth.roles
SET name = CASE role_key
        WHEN 'super_admin' THEN 'Admin'
        WHEN 'teaching_learning_team' THEN 'Teaching & Learning'
        WHEN 'staff' THEN 'Tutor'
        ELSE name
    END,
    precedence = CASE role_key
        WHEN 'super_admin' THEN 600
        WHEN 'teaching_learning_team' THEN 500
        WHEN 'director' THEN 400
        WHEN 'leader_manager' THEN 300
        WHEN 'staff' THEN 100
        ELSE precedence
    END,
    updated_at = sysutcdatetime()
WHERE role_key IN ('super_admin', 'teaching_learning_team', 'director', 'leader_manager', 'staff');

INSERT INTO auth.roles (id, role_key, name, description, is_system, precedence)
SELECT v.id, v.role_key, v.name, v.description, 1, v.precedence
FROM (VALUES
    (CONVERT(uniqueidentifier, '30000000-0000-0000-0000-000000000006'), 'head_of_faculty', 'Head of Faculty', 'Faculty records, actions and dashboards.', 300),
    (CONVERT(uniqueidentifier, '30000000-0000-0000-0000-000000000007'), 'programme_leader', 'Programme Leader', 'Sub-team records, actions and dashboards.', 200)
) v(id, role_key, name, description, precedence)
WHERE NOT EXISTS (
    SELECT 1
    FROM auth.roles existing
    WHERE existing.role_key = v.role_key
);

-- Both management tiers begin with the established manager permission set.
INSERT INTO auth.role_permissions (role_id, permission_id)
SELECT target.id, source_permissions.permission_id
FROM auth.roles target
CROSS APPLY (
    SELECT rp.permission_id
    FROM auth.roles source_role
    JOIN auth.role_permissions rp ON rp.role_id = source_role.id
    WHERE source_role.role_key = 'leader_manager'
) source_permissions
WHERE target.role_key IN ('head_of_faculty', 'programme_leader')
  AND NOT EXISTS (
      SELECT 1
      FROM auth.role_permissions existing
      WHERE existing.role_id = target.id
        AND existing.permission_id = source_permissions.permission_id
  );

-- Preserve any existing manager allocation as Head of Faculty before retiring
-- the old combined role. The official staff import subsequently assigns Tutor.
INSERT INTO auth.user_roles (user_account_id, role_id)
SELECT legacy.user_account_id, replacement.id
FROM auth.user_roles legacy
JOIN auth.roles old_role ON old_role.id = legacy.role_id
CROSS JOIN auth.roles replacement
WHERE old_role.role_key = 'leader_manager'
  AND replacement.role_key = 'head_of_faculty'
  AND legacy.active_from <= sysutcdatetime()
  AND (legacy.active_to IS NULL OR legacy.active_to > sysutcdatetime())
  AND NOT EXISTS (
      SELECT 1
      FROM auth.user_roles existing
      WHERE existing.user_account_id = legacy.user_account_id
        AND existing.role_id = replacement.id
        AND existing.active_from <= sysutcdatetime()
        AND (existing.active_to IS NULL OR existing.active_to > sysutcdatetime())
  );

UPDATE ur
SET active_to = sysutcdatetime()
FROM auth.user_roles ur
JOIN auth.roles r ON r.id = ur.role_id
WHERE r.role_key = 'leader_manager'
  AND ur.active_from <= sysutcdatetime()
  AND (ur.active_to IS NULL OR ur.active_to > sysutcdatetime());

UPDATE auth.roles
SET is_active = 0,
    archived_at = COALESCE(archived_at, sysutcdatetime()),
    updated_at = sysutcdatetime()
WHERE role_key = 'leader_manager';

DECLARE @constructionFacultyId uniqueidentifier = (
    SELECT id
    FROM org.org_units
    WHERE code = 'CUCB'
      AND org_unit_type = 'faculty'
      AND archived_at IS NULL
);

IF @constructionFacultyId IS NULL
BEGIN
    THROW 51000, 'CUCB must exist before the WBL-CUCB team can be created.', 1;
END;

IF NOT EXISTS (SELECT 1 FROM org.org_units WHERE code = 'WBL-CUCB')
BEGIN
    INSERT INTO org.org_units (
        id,
        parent_org_unit_id,
        org_unit_type,
        code,
        name,
        description
    )
    VALUES (
        '20000000-0000-0000-0000-000000000220',
        @constructionFacultyId,
        'team',
        'WBL-CUCB',
        'Work-Based Learning - Construction and Motor Vehicle',
        'Team supplied by the official curriculum staff register.'
    );
END;

IF OBJECT_ID('ops.data_import_runs', 'U') IS NULL
BEGIN
    CREATE TABLE ops.data_import_runs (
        id uniqueidentifier NOT NULL CONSTRAINT pk_data_import_runs PRIMARY KEY DEFAULT newsequentialid(),
        import_key nvarchar(150) NOT NULL,
        source_name nvarchar(300) NOT NULL,
        source_row_count int NOT NULL,
        completed_at datetimeoffset NOT NULL CONSTRAINT df_data_import_runs_completed DEFAULT sysutcdatetime(),
        notes nvarchar(1000) NULL,
        CONSTRAINT uq_data_import_runs_key UNIQUE (import_key)
    );
END;

COMMIT TRANSACTION;
GO
