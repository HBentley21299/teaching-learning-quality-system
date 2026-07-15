SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET ARITHABORT ON;
SET NUMERIC_ROUNDABORT OFF;
GO

BEGIN TRANSACTION;

IF OBJECT_ID('quality.staff_reflections', 'U') IS NULL
BEGIN
    CREATE TABLE quality.staff_reflections (
        id uniqueidentifier NOT NULL CONSTRAINT pk_staff_reflections PRIMARY KEY DEFAULT newsequentialid(),
        staff_id uniqueidentifier NOT NULL,
        elevate_practice_assessment_id uniqueidentifier NOT NULL,
        elevate_practice_record_id uniqueidentifier NOT NULL,
        reflection_date date NOT NULL CONSTRAINT df_staff_reflections_date DEFAULT CONVERT(date, sysutcdatetime()),
        progress nvarchar(max) NULL,
        impact nvarchar(max) NULL,
        examples nvarchar(max) NULL,
        status nvarchar(20) NOT NULL CONSTRAINT df_staff_reflections_status DEFAULT 'draft',
        legacy_evidence_item_id uniqueidentifier NULL,
        created_by_user_account_id uniqueidentifier NULL,
        updated_by_user_account_id uniqueidentifier NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_staff_reflections_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        archived_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT fk_staff_reflections_staff FOREIGN KEY (staff_id) REFERENCES people.staff(id),
        CONSTRAINT fk_staff_reflections_assessment FOREIGN KEY (elevate_practice_assessment_id) REFERENCES quality.elevate_practice_assessments(id),
        CONSTRAINT fk_staff_reflections_record FOREIGN KEY (elevate_practice_record_id) REFERENCES core.records(id),
        CONSTRAINT fk_staff_reflections_legacy_evidence FOREIGN KEY (legacy_evidence_item_id) REFERENCES evidence.evidence_items(id),
        CONSTRAINT fk_staff_reflections_created_by FOREIGN KEY (created_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT fk_staff_reflections_updated_by FOREIGN KEY (updated_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT ck_staff_reflections_status CHECK (status IN ('draft', 'submitted'))
    );
END;

IF OBJECT_ID('quality.staff_reflection_development_areas', 'U') IS NULL
BEGIN
    CREATE TABLE quality.staff_reflection_development_areas (
        reflection_id uniqueidentifier NOT NULL,
        development_area_id uniqueidentifier NOT NULL,
        development_area_text_snapshot nvarchar(250) NOT NULL,
        display_order int NOT NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_staff_reflection_areas_created DEFAULT sysutcdatetime(),
        CONSTRAINT pk_staff_reflection_development_areas PRIMARY KEY (reflection_id, development_area_id),
        CONSTRAINT fk_staff_reflection_areas_reflection FOREIGN KEY (reflection_id) REFERENCES quality.staff_reflections(id),
        CONSTRAINT fk_staff_reflection_areas_area FOREIGN KEY (development_area_id) REFERENCES quality.elevate_practice_areas(id)
    );
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID('quality.staff_reflections')
      AND name = 'ix_staff_reflections_staff_date'
)
BEGIN
    CREATE INDEX ix_staff_reflections_staff_date
        ON quality.staff_reflections(staff_id, reflection_date DESC, created_at DESC)
        INCLUDE (status, elevate_practice_assessment_id, elevate_practice_record_id)
        WHERE archived_at IS NULL;
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID('quality.staff_reflections')
      AND name = 'ix_staff_reflections_assessment'
)
BEGIN
    CREATE INDEX ix_staff_reflections_assessment
        ON quality.staff_reflections(elevate_practice_assessment_id, reflection_date DESC)
        WHERE archived_at IS NULL;
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID('quality.staff_reflections')
      AND name = 'uq_staff_reflections_legacy_evidence'
)
BEGIN
    CREATE UNIQUE INDEX uq_staff_reflections_legacy_evidence
        ON quality.staff_reflections(legacy_evidence_item_id)
        WHERE legacy_evidence_item_id IS NOT NULL;
END;

-- Preserve any earlier checkpoint reflections where a submitted Elevate record exists.
INSERT INTO quality.staff_reflections (
    id,
    staff_id,
    elevate_practice_assessment_id,
    elevate_practice_record_id,
    reflection_date,
    progress,
    status,
    legacy_evidence_item_id,
    created_by_user_account_id,
    created_at,
    updated_at
)
SELECT
    newid(),
    evidence_item.staff_id,
    assessment.id,
    assessment.record_id,
    evidence_item.evidence_date,
    evidence_item.impact_summary,
    'submitted',
    evidence_item.id,
    evidence_item.created_by_user_account_id,
    evidence_item.created_at,
    evidence_item.updated_at
FROM evidence.evidence_items evidence_item
CROSS APPLY (
    SELECT TOP (1) candidate.id, candidate.record_id
    FROM quality.elevate_practice_assessments candidate
    WHERE candidate.staff_id = evidence_item.staff_id
      AND candidate.status = 'submitted'
      AND candidate.archived_at IS NULL
    ORDER BY candidate.submitted_at DESC, candidate.created_at DESC
) assessment
WHERE evidence_item.pillar_or_theme = 'reflection'
  AND evidence_item.archived_at IS NULL
  AND NOT EXISTS (
      SELECT 1
      FROM quality.staff_reflections existing
      WHERE existing.legacy_evidence_item_id = evidence_item.id
  );

INSERT INTO quality.staff_reflection_development_areas (
    reflection_id,
    development_area_id,
    development_area_text_snapshot,
    display_order
)
SELECT
    reflection.id,
    selection.area_id,
    area.name,
    area.display_order
FROM quality.staff_reflections reflection
JOIN quality.elevate_practice_selections selection
    ON selection.assessment_id = reflection.elevate_practice_assessment_id
    AND selection.selection_type = 'development'
JOIN quality.elevate_practice_areas area ON area.id = selection.area_id
WHERE NOT EXISTS (
    SELECT 1
    FROM quality.staff_reflection_development_areas existing
    WHERE existing.reflection_id = reflection.id
      AND existing.development_area_id = selection.area_id
);

IF OBJECT_ID('quality.reflection_points', 'U') IS NOT NULL
BEGIN
    UPDATE quality.reflection_points
    SET is_active = 0,
        updated_at = COALESCE(updated_at, sysutcdatetime())
    WHERE is_active = 1
      AND archived_at IS NULL;
END;

COMMIT TRANSACTION;
GO
