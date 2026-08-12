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

-- Preserve the established reporting keys while allowing the LIV display
-- wording and active state to be administered independently.
UPDATE value
SET value_key = stable.value_key,
    updated_at = sysutcdatetime()
FROM core.lookup_values value
JOIN core.lookup_types type ON type.id = value.lookup_type_id
JOIN (VALUES
    (N'Positive Start', N'positive_start'),
    (N'Planning and Structure', N'planning_structure'),
    (N'Delivery', N'delivery'),
    (N'Assessment', N'assessment'),
    (N'Feedback', N'feedback'),
    (N'Inclusion', N'inclusion'),
    (N'Learner Focus', N'learner_focus'),
    (N'Digital', N'digital'),
    (N'Assistive Technology', N'assistive_technology'),
    (N'Sustainability', N'sustainability')
) stable(display_name, value_key) ON stable.display_name = value.display_name
WHERE type.lookup_key = N'liv_visit_focus_area'
  AND value.value_key <> stable.value_key;

COMMIT TRANSACTION;
GO
