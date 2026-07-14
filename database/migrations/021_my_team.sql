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

IF NOT EXISTS (
    SELECT 1
    FROM auth.permissions
    WHERE permission_key = N'my_team.view'
      AND archived_at IS NULL
)
BEGIN
    INSERT INTO auth.permissions (
        id,
        permission_key,
        name,
        description,
        category,
        is_system
    )
    VALUES (
        CONVERT(uniqueidentifier, '31000000-0000-0000-0000-000000000022'),
        N'my_team.view',
        N'View My Team',
        N'View staff and actions within assigned management and organisation scope.',
        N'Staff',
        1
    );
END;

INSERT INTO auth.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM auth.roles role
CROSS JOIN auth.permissions permission
WHERE role.role_key IN (
        N'super_admin',
        N'teaching_learning_team',
        N'director',
        N'head_of_faculty',
        N'programme_leader'
    )
  AND role.archived_at IS NULL
  AND role.is_active = 1
  AND permission.permission_key = N'my_team.view'
  AND permission.archived_at IS NULL
  AND NOT EXISTS (
      SELECT 1
      FROM auth.role_permissions existing
      WHERE existing.role_id = role.id
        AND existing.permission_id = permission.id
  );

COMMIT TRANSACTION;
GO
