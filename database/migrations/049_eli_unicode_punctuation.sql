SET XACT_ABORT ON;
GO

BEGIN TRANSACTION;

DECLARE @frameworkId uniqueidentifier = (
    SELECT id
    FROM quality.elevate_practice_frameworks
    WHERE framework_key = N'elevate_your_practice' AND version_label = N'1.2'
);

UPDATE statement_row
SET statement_text = CASE statement_row.statement_key
    WHEN N'curriculum_next_steps' THEN N'Activities clearly link to the curriculum, assessment and learners' + NCHAR(8217) + N' next steps.'
    WHEN N'adaptive_standards' THEN N'I adapt my teaching to learners' + NCHAR(8217) + N' needs while maintaining appropriate subject and industry standards.'
    WHEN N'starting_points_goals' THEN N'I understand learners' + NCHAR(8217) + N' starting points, goals and next steps and use these to shape learning.'
END
FROM quality.elevate_practice_statements statement_row
JOIN quality.elevate_practice_areas area ON area.id = statement_row.area_id
WHERE area.framework_id = @frameworkId
  AND statement_row.statement_key IN (N'curriculum_next_steps', N'adaptive_standards', N'starting_points_goals');

COMMIT TRANSACTION;
GO
