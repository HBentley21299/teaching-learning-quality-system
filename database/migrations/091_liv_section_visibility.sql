SET XACT_ABORT ON;
GO

-- Preserve what existing staff could read. Visit details were previously private;
-- new sections are private until the review creator chooses to share them.
IF COL_LENGTH(N'quality.liv_stages', N'visible_to_staff') IS NULL
BEGIN
    ALTER TABLE quality.liv_stages ADD visible_to_staff bit NOT NULL
        CONSTRAINT df_liv_stages_visible_to_staff DEFAULT 0 WITH VALUES;
    EXEC(N'UPDATE quality.liv_stages SET visible_to_staff = 1 WHERE stage_type <> N''visit'';');
END;
GO

-- Reuse the section boundary wherever linked actions are read, including the
-- central action engine and staff profiles. This predicate does not grant scope.
CREATE OR ALTER FUNCTION quality.fn_liv_action_access(
    @actionId uniqueidentifier,
    @currentUserAccountId uniqueidentifier
)
RETURNS TABLE
AS
RETURN (
    SELECT CONVERT(bit, 1) AS can_view
    FROM quality.actions action_row
    LEFT JOIN quality.liv_records liv ON liv.record_id = action_row.source_record_id
    LEFT JOIN auth.user_accounts account ON account.id = @currentUserAccountId
    LEFT JOIN quality.liv_visits visit ON visit.id = COALESCE(action_row.liv_visit_id,
        CASE WHEN action_row.source_sub_record_type = N'liv_visit' THEN action_row.source_sub_record_id END)
    WHERE action_row.id = @actionId
      AND (liv.id IS NULL OR (liv.archived_at IS NULL AND (
          liv.created_by_user_account_id = @currentUserAccountId
          OR liv.reviewer_staff_id = account.staff_id
          OR EXISTS (
              SELECT 1 FROM auth.user_roles user_role
              JOIN auth.roles role ON role.id = user_role.role_id AND role.is_active = 1 AND role.archived_at IS NULL
              JOIN auth.role_permissions role_permission ON role_permission.role_id = role.id
              JOIN auth.permissions permission ON permission.id = role_permission.permission_id AND permission.archived_at IS NULL
              WHERE user_role.user_account_id = @currentUserAccountId
                AND user_role.active_from <= sysutcdatetime()
                AND (user_role.active_to IS NULL OR user_role.active_to > sysutcdatetime())
                AND (permission.permission_key IN (N'users.manage', N'liv.sensitive.read')
                    OR (liv.process_key = N'liv' AND permission.permission_key = N'liv.manage')
                    OR (liv.process_key = N'als_liv' AND permission.permission_key = N'als_liv.manage'))
          )
          OR EXISTS (
              SELECT 1 FROM quality.liv_stages stage
              JOIN quality.liv_cycles cycle ON cycle.id = stage.liv_cycle_id
              WHERE cycle.liv_record_id = liv.id AND stage.stage_type = N'actions'
                AND stage.archived_at IS NULL AND stage.visible_to_staff = 1
                AND cycle.id = COALESCE(action_row.liv_cycle_id,
                    CASE WHEN action_row.source_sub_record_type = N'liv_cycle' THEN action_row.source_sub_record_id END,
                    visit.cycle_id,
                    (SELECT TOP (1) first_cycle.id FROM quality.liv_cycles first_cycle
                     WHERE first_cycle.liv_record_id = liv.id ORDER BY first_cycle.cycle_number))
          )
      )))
);
GO
