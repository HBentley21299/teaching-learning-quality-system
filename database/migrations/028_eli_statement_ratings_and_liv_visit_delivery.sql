SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO

-- Restore one governed rubric response per ELI statement. Records saved while
-- the section-level V2 interface was active inherit that section response.
INSERT INTO quality.elevate_practice_ratings (
    assessment_id, statement_id, score, descriptor_id
)
SELECT area_rating.assessment_id, statement.id,
       area_rating.hidden_numeric_value, area_rating.descriptor_id
FROM quality.elevate_practice_area_ratings area_rating
JOIN quality.elevate_practice_statements statement
  ON statement.area_id = area_rating.area_id
WHERE NOT EXISTS (
    SELECT 1
    FROM quality.elevate_practice_ratings existing
    WHERE existing.assessment_id = area_rating.assessment_id
      AND existing.statement_id = statement.id
);
GO

-- Delivery area belongs to the individual visit because it may change between
-- the initial LIV and any later follow-up cycle.
IF COL_LENGTH('quality.liv_visits', 'delivery_area_lookup_value_id') IS NULL
BEGIN
    ALTER TABLE quality.liv_visits
        ADD delivery_area_lookup_value_id uniqueidentifier NULL;
END;
GO

UPDATE visit
SET delivery_area_lookup_value_id = liv.delivery_area_lookup_value_id
FROM quality.liv_visits visit
JOIN quality.liv_records liv ON liv.id = visit.liv_record_id
WHERE visit.delivery_area_lookup_value_id IS NULL
  AND liv.delivery_area_lookup_value_id IS NOT NULL;
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE name = 'fk_liv_visits_delivery_area'
      AND parent_object_id = OBJECT_ID('quality.liv_visits')
)
BEGIN
    ALTER TABLE quality.liv_visits
        ADD CONSTRAINT fk_liv_visits_delivery_area
        FOREIGN KEY (delivery_area_lookup_value_id) REFERENCES core.lookup_values(id);
END;
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('quality.liv_visits')
      AND name = 'ix_liv_visits_delivery_area'
)
BEGIN
    CREATE INDEX ix_liv_visits_delivery_area
        ON quality.liv_visits(delivery_area_lookup_value_id, liv_record_id);
END;
GO
