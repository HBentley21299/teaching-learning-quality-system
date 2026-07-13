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

DECLARE @oldFrameworkId uniqueidentifier = (
    SELECT id
    FROM quality.elevate_practice_frameworks
    WHERE framework_key = 'elevate_your_practice' AND version_label = '1.0'
);
DECLARE @newFrameworkId uniqueidentifier = '90000000-0000-0000-0000-000000000002';

IF @oldFrameworkId IS NULL
BEGIN
    THROW 51000, 'Elevate Your Practice framework 1.0 must exist before applying version 1.1.', 1;
END;

INSERT INTO quality.elevate_practice_frameworks (id, framework_key, version_label, name, is_active)
SELECT @newFrameworkId, 'elevate_your_practice', '1.1', 'Elevate Your Practice Staff Self-Assessment', 1
WHERE NOT EXISTS (
    SELECT 1
    FROM quality.elevate_practice_frameworks
    WHERE framework_key = 'elevate_your_practice' AND version_label = '1.1'
);

UPDATE quality.elevate_practice_frameworks
SET is_active = CASE WHEN id = @newFrameworkId THEN 1 ELSE 0 END
WHERE framework_key = 'elevate_your_practice'
  AND archived_at IS NULL;

INSERT INTO quality.elevate_practice_areas (
    id,
    framework_id,
    area_key,
    category,
    name,
    reflection_prompt,
    display_order
)
SELECT
    NEWID(),
    @newFrameworkId,
    source.area_key,
    source.category,
    source.name,
    source.reflection_prompt,
    source.display_order
FROM quality.elevate_practice_areas source
WHERE source.framework_id = @oldFrameworkId
  AND source.area_key <> 'sustainable_resources'
  AND NOT EXISTS (
      SELECT 1
      FROM quality.elevate_practice_areas existing
      WHERE existing.framework_id = @newFrameworkId
        AND existing.area_key = source.area_key
  );

INSERT INTO quality.elevate_practice_statements (
    id,
    area_id,
    statement_key,
    statement_text,
    display_order
)
SELECT
    NEWID(),
    target_area.id,
    source_statement.statement_key,
    source_statement.statement_text,
    source_statement.display_order
FROM quality.elevate_practice_statements source_statement
JOIN quality.elevate_practice_areas source_area ON source_area.id = source_statement.area_id
JOIN quality.elevate_practice_areas target_area
    ON target_area.framework_id = @newFrameworkId
    AND target_area.area_key = source_area.area_key
WHERE source_area.framework_id = @oldFrameworkId
  AND NOT EXISTS (
      SELECT 1
      FROM quality.elevate_practice_statements existing
      WHERE existing.area_id = target_area.id
        AND existing.statement_key = source_statement.statement_key
  );

-- Drafts move to the current framework. Submitted assessments remain linked
-- to their original version so their locked historical result does not change.
INSERT INTO quality.elevate_practice_ratings (assessment_id, statement_id, score)
SELECT rating.assessment_id, target_statement.id, rating.score
FROM quality.elevate_practice_ratings rating
JOIN quality.elevate_practice_assessments assessment
    ON assessment.id = rating.assessment_id
    AND assessment.framework_id = @oldFrameworkId
    AND assessment.status = 'draft'
JOIN quality.elevate_practice_statements source_statement ON source_statement.id = rating.statement_id
JOIN quality.elevate_practice_areas source_area ON source_area.id = source_statement.area_id
JOIN quality.elevate_practice_areas target_area
    ON target_area.framework_id = @newFrameworkId
    AND target_area.area_key = source_area.area_key
JOIN quality.elevate_practice_statements target_statement
    ON target_statement.area_id = target_area.id
    AND target_statement.statement_key = source_statement.statement_key
WHERE NOT EXISTS (
    SELECT 1
    FROM quality.elevate_practice_ratings existing
    WHERE existing.assessment_id = rating.assessment_id
      AND existing.statement_id = target_statement.id
);

INSERT INTO quality.elevate_practice_reflections (assessment_id, area_id, reflection_text)
SELECT reflection.assessment_id, target_area.id, reflection.reflection_text
FROM quality.elevate_practice_reflections reflection
JOIN quality.elevate_practice_assessments assessment
    ON assessment.id = reflection.assessment_id
    AND assessment.framework_id = @oldFrameworkId
    AND assessment.status = 'draft'
JOIN quality.elevate_practice_areas source_area ON source_area.id = reflection.area_id
JOIN quality.elevate_practice_areas target_area
    ON target_area.framework_id = @newFrameworkId
    AND target_area.area_key = source_area.area_key
WHERE NOT EXISTS (
    SELECT 1
    FROM quality.elevate_practice_reflections existing
    WHERE existing.assessment_id = reflection.assessment_id
      AND existing.area_id = target_area.id
);

INSERT INTO quality.elevate_practice_selections (assessment_id, area_id, selection_type)
SELECT selection.assessment_id, target_area.id, selection.selection_type
FROM quality.elevate_practice_selections selection
JOIN quality.elevate_practice_assessments assessment
    ON assessment.id = selection.assessment_id
    AND assessment.framework_id = @oldFrameworkId
    AND assessment.status = 'draft'
JOIN quality.elevate_practice_areas source_area ON source_area.id = selection.area_id
JOIN quality.elevate_practice_areas target_area
    ON target_area.framework_id = @newFrameworkId
    AND target_area.area_key = source_area.area_key
WHERE NOT EXISTS (
    SELECT 1
    FROM quality.elevate_practice_selections existing
    WHERE existing.assessment_id = selection.assessment_id
      AND existing.area_id = target_area.id
      AND existing.selection_type = selection.selection_type
);

DELETE plan_row
FROM quality.elevate_practice_development_plans plan_row
JOIN quality.elevate_practice_assessments assessment
    ON assessment.id = plan_row.assessment_id
    AND assessment.framework_id = @oldFrameworkId
    AND assessment.status = 'draft'
JOIN quality.elevate_practice_areas source_area ON source_area.id = plan_row.area_id
WHERE source_area.area_key = 'sustainable_resources';

UPDATE plan_row
SET area_id = target_area.id,
    updated_at = sysutcdatetime()
FROM quality.elevate_practice_development_plans plan_row
JOIN quality.elevate_practice_assessments assessment
    ON assessment.id = plan_row.assessment_id
    AND assessment.framework_id = @oldFrameworkId
    AND assessment.status = 'draft'
JOIN quality.elevate_practice_areas source_area ON source_area.id = plan_row.area_id
JOIN quality.elevate_practice_areas target_area
    ON target_area.framework_id = @newFrameworkId
    AND target_area.area_key = source_area.area_key;

DELETE rating
FROM quality.elevate_practice_ratings rating
JOIN quality.elevate_practice_assessments assessment
    ON assessment.id = rating.assessment_id
    AND assessment.framework_id = @oldFrameworkId
    AND assessment.status = 'draft'
JOIN quality.elevate_practice_statements statement_row ON statement_row.id = rating.statement_id
JOIN quality.elevate_practice_areas area_row ON area_row.id = statement_row.area_id
WHERE area_row.framework_id = @oldFrameworkId;

DELETE reflection
FROM quality.elevate_practice_reflections reflection
JOIN quality.elevate_practice_assessments assessment
    ON assessment.id = reflection.assessment_id
    AND assessment.framework_id = @oldFrameworkId
    AND assessment.status = 'draft'
JOIN quality.elevate_practice_areas area_row ON area_row.id = reflection.area_id
WHERE area_row.framework_id = @oldFrameworkId;

DELETE selection
FROM quality.elevate_practice_selections selection
JOIN quality.elevate_practice_assessments assessment
    ON assessment.id = selection.assessment_id
    AND assessment.framework_id = @oldFrameworkId
    AND assessment.status = 'draft'
JOIN quality.elevate_practice_areas area_row ON area_row.id = selection.area_id
WHERE area_row.framework_id = @oldFrameworkId;

UPDATE quality.elevate_practice_assessments
SET framework_id = @newFrameworkId,
    updated_at = sysutcdatetime()
WHERE framework_id = @oldFrameworkId
  AND status = 'draft';

COMMIT TRANSACTION;
GO
