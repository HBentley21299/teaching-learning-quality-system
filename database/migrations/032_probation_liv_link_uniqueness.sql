SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO

IF EXISTS (
    SELECT 1
    FROM sys.key_constraints
    WHERE parent_object_id = OBJECT_ID(N'quality.probation_observations')
      AND name = N'uq_probation_observations_liv'
)
    ALTER TABLE quality.probation_observations
        DROP CONSTRAINT uq_probation_observations_liv;
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'quality.probation_observations')
      AND name = N'ux_probation_observations_liv'
)
    CREATE UNIQUE INDEX ux_probation_observations_liv
        ON quality.probation_observations(linked_liv_record_id)
        WHERE linked_liv_record_id IS NOT NULL;
GO
