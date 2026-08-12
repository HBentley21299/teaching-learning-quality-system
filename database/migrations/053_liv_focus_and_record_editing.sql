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

-- LIV visit focus areas begin with the current Learning Walk catalogue, but use
-- their own governed lookup so future wording and activation changes remain
-- independent between the two processes.
DECLARE @livVisitFocusTypeId uniqueidentifier = CONVERT(uniqueidentifier, '10000000-0000-0000-0000-000000000053');

INSERT INTO core.lookup_types (id, lookup_key, name, description, is_system)
SELECT @livVisitFocusTypeId, N'liv_visit_focus_area', N'LIV Visit Focus Areas',
       N'Focus areas used to reveal the corresponding LIV visit detail rubric.', 0
WHERE NOT EXISTS (SELECT 1 FROM core.lookup_types WHERE lookup_key = N'liv_visit_focus_area');

SET @livVisitFocusTypeId = (SELECT id FROM core.lookup_types WHERE lookup_key = N'liv_visit_focus_area');

INSERT INTO core.lookup_values (
    id, lookup_type_id, value_key, display_name, display_order, is_active
)
SELECT NEWID(), @livVisitFocusTypeId, theme.theme_key, theme.name,
       ROW_NUMBER() OVER (ORDER BY theme_group.display_order, application.display_order, theme.name) * 10,
       CONVERT(bit, 1)
FROM core.themes theme
JOIN core.theme_groups theme_group ON theme_group.id = theme.theme_group_id
JOIN core.theme_applications application ON application.theme_id = theme.id
    AND application.application_key = N'learning_walk' AND application.is_active = 1
WHERE theme.is_active = 1 AND theme.archived_at IS NULL
  AND theme_group.is_active = 1 AND theme_group.archived_at IS NULL
  AND theme.is_other = 0
  AND NOT EXISTS (
      SELECT 1 FROM core.lookup_values existing
      WHERE existing.lookup_type_id = @livVisitFocusTypeId
        AND existing.value_key = theme.theme_key
  );

-- Keep a safe baseline if a site has no active Learning Walk themes yet.
INSERT INTO core.lookup_values (id, lookup_type_id, value_key, display_name, display_order)
SELECT seed.id, @livVisitFocusTypeId, seed.value_key, seed.display_name, seed.display_order
FROM (VALUES
    (CONVERT(uniqueidentifier, '18B00000-0000-0000-0000-000000000001'), N'positive_start', N'Positive Start', 10),
    (CONVERT(uniqueidentifier, '18B00000-0000-0000-0000-000000000002'), N'planning_structure', N'Planning and Structure', 20),
    (CONVERT(uniqueidentifier, '18B00000-0000-0000-0000-000000000003'), N'delivery', N'Delivery', 30),
    (CONVERT(uniqueidentifier, '18B00000-0000-0000-0000-000000000004'), N'assessment', N'Assessment', 40),
    (CONVERT(uniqueidentifier, '18B00000-0000-0000-0000-000000000005'), N'feedback', N'Feedback', 50),
    (CONVERT(uniqueidentifier, '18B00000-0000-0000-0000-000000000006'), N'inclusion', N'Inclusion', 60),
    (CONVERT(uniqueidentifier, '18B00000-0000-0000-0000-000000000007'), N'learner_focus', N'Learner Focus', 70),
    (CONVERT(uniqueidentifier, '18B00000-0000-0000-0000-000000000008'), N'digital', N'Digital', 80)
) seed(id, value_key, display_name, display_order)
WHERE NOT EXISTS (SELECT 1 FROM core.lookup_values WHERE lookup_type_id = @livVisitFocusTypeId);

INSERT INTO core.admin_managed_lists (lookup_type_id, category, description, display_order)
SELECT @livVisitFocusTypeId, N'LIV',
       N'LIV visit focus areas. Initially mirrors Learning Walk focus wording but is maintained independently.', 75
WHERE NOT EXISTS (SELECT 1 FROM core.admin_managed_lists WHERE lookup_type_id = @livVisitFocusTypeId);

INSERT INTO core.lookup_usage_registry (lookup_type_id, application_key, display_name)
SELECT @livVisitFocusTypeId, N'liv.visit_detail', N'LIV visit focus and detail rubrics'
WHERE NOT EXISTS (
    SELECT 1 FROM core.lookup_usage_registry
    WHERE lookup_type_id = @livVisitFocusTypeId AND application_key = N'liv.visit_detail'
);

-- Stage five can explicitly be recorded as not applicable when no further
-- follow-up is required and the LIV will close after cycle two or later.
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'ck_liv_stages_status')
    ALTER TABLE quality.liv_stages DROP CONSTRAINT ck_liv_stages_status;

ALTER TABLE quality.liv_stages ADD CONSTRAINT ck_liv_stages_status
    CHECK (stage_status IN (N'in_progress', N'completed', N'not_applicable'));

COMMIT TRANSACTION;
GO
