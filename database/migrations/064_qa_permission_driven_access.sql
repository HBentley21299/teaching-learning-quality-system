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

UPDATE auth.roles
SET description = N'Additive Tutor-level role with college-wide QA Review viewing and evidence submission access.'
WHERE role_key = N'qa_staff';

-- Preserve historical rows for audit, but individual contributor assignments
-- no longer grant access and cannot be edited by the application.
UPDATE qa.review_contributors
SET is_active = 0,
    active_to = COALESCE(active_to, sysutcdatetime())
WHERE is_active = 1 OR active_to IS NULL;

-- Directors and QA Staff now use permission-driven college-wide access. Heads
-- of Faculty and Programme Leaders retain their normal organisation scopes.
DELETE role_permission
FROM auth.role_permissions role_permission
JOIN auth.roles role ON role.id = role_permission.role_id
JOIN auth.permissions permission ON permission.id = role_permission.permission_id
WHERE (role.role_key = N'director' AND permission.permission_key IN (
          N'qa_reviews.view_scoped', N'qa_reviews.submit_scoped'
      ))
   OR (role.role_key = N'qa_staff' AND permission.permission_key IN (
          N'qa_reviews.view_assigned', N'qa_reviews.submit_assigned'
      ));

INSERT INTO auth.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM auth.roles role
JOIN auth.permissions permission ON permission.permission_key IN (
    N'qa_reviews.view_all', N'qa_reviews.submit_all'
)
WHERE role.role_key IN (N'director', N'qa_staff')
  AND NOT EXISTS (
      SELECT 1
      FROM auth.role_permissions existing
      WHERE existing.role_id = role.id
        AND existing.permission_id = permission.id
  );

COMMIT TRANSACTION;
GO
