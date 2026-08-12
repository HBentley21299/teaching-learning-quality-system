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

UPDATE auth.roles
SET name = N'Teaching and Learning Team',
    description = N'All teaching and learning forms and reporting.',
    updated_at = sysutcdatetime()
WHERE role_key = N'teaching_learning_team'
  AND (name <> N'Teaching and Learning Team'
       OR ISNULL(description, N'') <> N'All teaching and learning forms and reporting.');

UPDATE core.lookup_values
SET display_name = N'Digital Teaching and Learning',
    updated_at = sysutcdatetime()
WHERE value_key = N'digital_teaching_learning'
  AND display_name = N'Digital Teaching & Learning';

UPDATE core.theme_groups
SET name = N'Teaching and Learning',
    updated_at = sysutcdatetime()
WHERE group_key = N'teaching_learning'
  AND name = N'Teaching & Learning';

UPDATE org.org_units
SET name = N'Teaching and Learning',
    updated_at = sysutcdatetime()
WHERE code = N'COLLEGE-TL'
  AND name = N'Teaching & Learning';

COMMIT TRANSACTION;
GO
