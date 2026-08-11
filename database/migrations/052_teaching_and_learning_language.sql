SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;
GO

BEGIN TRANSACTION;

UPDATE auth.permissions
SET name = N'Manage Teaching and Learning Records',
    description = N'Search, edit, archive and restore teaching and learning records.',
    updated_at = sysutcdatetime()
WHERE permission_key = N'records.manage'
  AND (name = N'Manage Quality Records'
       OR description = N'Search, edit, archive and restore quality records.');

UPDATE reporting.dashboards
SET purpose = N'Whole-organisation leadership intelligence across teaching and learning, development and assurance processes.',
    updated_at = sysutcdatetime()
WHERE dashboard_key = N'tl_overview'
  AND purpose = N'Whole-organisation leadership intelligence across quality, development and assurance processes.';

UPDATE lookup_value
SET display_name = N'Teaching and learning improvement',
    updated_at = sysutcdatetime()
FROM core.lookup_values lookup_value
JOIN core.lookup_types lookup_type ON lookup_type.id = lookup_value.lookup_type_id
WHERE lookup_type.lookup_key = N'action_theme_standalone'
  AND lookup_value.value_key = N'quality_improvement'
  AND lookup_value.display_name = N'Quality improvement';

UPDATE quality.elevate_environment_pillars
SET description = REPLACE(description, N'a clear curriculum purpose, quality, progression and pride', N'a clear curriculum purpose, standards, progression and pride'),
    updated_at = sysutcdatetime()
WHERE pillar_key = N'aspirational'
  AND description LIKE N'%a clear curriculum purpose, quality, progression and pride%';

UPDATE quality.actions
SET detail = N'Programme-level action from the faculty teaching and learning review.',
    updated_at = sysutcdatetime()
WHERE detail = N'Programme-level action from the faculty quality review.';

COMMIT TRANSACTION;
GO
