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

IF OBJECT_ID('quality.elevate_practice_rubric_descriptors', 'U') IS NULL
BEGIN
    CREATE TABLE quality.elevate_practice_rubric_descriptors (
        id uniqueidentifier NOT NULL CONSTRAINT pk_elevate_practice_rubric_descriptors PRIMARY KEY DEFAULT newsequentialid(),
        framework_id uniqueidentifier NOT NULL,
        descriptor_key nvarchar(100) NOT NULL,
        visible_wording nvarchar(200) NOT NULL,
        guidance_text nvarchar(1000) NOT NULL,
        hidden_numeric_value tinyint NOT NULL,
        display_order int NOT NULL,
        colour_classification nvarchar(50) NULL,
        colour_hex nvarchar(20) NULL,
        is_active bit NOT NULL CONSTRAINT df_elevate_practice_descriptor_active DEFAULT 1,
        created_at datetimeoffset NOT NULL CONSTRAINT df_elevate_practice_descriptor_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        archived_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT fk_elevate_practice_descriptor_framework FOREIGN KEY (framework_id) REFERENCES quality.elevate_practice_frameworks(id),
        CONSTRAINT uq_elevate_practice_descriptor_key UNIQUE (framework_id, descriptor_key),
        CONSTRAINT ck_elevate_practice_descriptor_value CHECK (hidden_numeric_value BETWEEN 1 AND 5),
        CONSTRAINT ck_elevate_practice_descriptor_order CHECK (display_order > 0)
    );
END;

INSERT INTO quality.elevate_practice_rubric_descriptors (
    id, framework_id, descriptor_key, visible_wording, guidance_text,
    hidden_numeric_value, display_order, colour_classification, colour_hex, is_active
)
SELECT
    newid(), framework.id, descriptor.descriptor_key, descriptor.visible_wording, descriptor.guidance_text,
    descriptor.hidden_numeric_value, descriptor.display_order, descriptor.colour_classification, descriptor.colour_hex, 1
FROM quality.elevate_practice_frameworks framework
CROSS APPLY (VALUES
    ('not_yet_evident', 'Not yet evident', 'This is not currently evident or established within my practice.', 1, 1, 'red', '#B42318'),
    ('emerging', 'Emerging', 'I am beginning to develop this, but it is not yet consistent or fully effective.', 2, 2, 'orange', '#E56B1F'),
    ('secure', 'Secure', 'This is usually evident within my practice and generally supports learners effectively.', 3, 3, 'amber', '#D7A700'),
    ('strong', 'Strong', 'This is consistently embedded within my practice and has a clear positive impact on learners.', 4, 4, 'light_green', '#69A84F'),
    ('leading_practice', 'Leading practice', 'This is highly effective, consistently embedded and supported by clear evidence of impact.', 5, 5, 'green', '#237A3B')
) descriptor(descriptor_key, visible_wording, guidance_text, hidden_numeric_value, display_order, colour_classification, colour_hex)
WHERE NOT EXISTS (
    SELECT 1
    FROM quality.elevate_practice_rubric_descriptors existing
    WHERE existing.framework_id = framework.id
      AND existing.descriptor_key = descriptor.descriptor_key
);

IF COL_LENGTH('quality.elevate_practice_ratings', 'descriptor_id') IS NULL
BEGIN
    ALTER TABLE quality.elevate_practice_ratings ADD descriptor_id uniqueidentifier NULL;
END;
GO

UPDATE rating
SET descriptor_id = descriptor.id
FROM quality.elevate_practice_ratings rating
JOIN quality.elevate_practice_assessments assessment ON assessment.id = rating.assessment_id
JOIN quality.elevate_practice_rubric_descriptors descriptor
    ON descriptor.framework_id = assessment.framework_id
    AND descriptor.hidden_numeric_value = rating.score
WHERE rating.descriptor_id IS NULL;

IF EXISTS (SELECT 1 FROM quality.elevate_practice_ratings WHERE descriptor_id IS NULL)
BEGIN
    THROW 51000, 'Every Elevate Your Practice rating must map to a rubric descriptor.', 1;
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE name = 'fk_elevate_practice_rating_descriptor'
      AND parent_object_id = OBJECT_ID('quality.elevate_practice_ratings')
)
BEGIN
    ALTER TABLE quality.elevate_practice_ratings
        ADD CONSTRAINT fk_elevate_practice_rating_descriptor
        FOREIGN KEY (descriptor_id) REFERENCES quality.elevate_practice_rubric_descriptors(id);
END;

IF EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID('quality.elevate_practice_ratings')
      AND name = 'descriptor_id'
      AND is_nullable = 1
)
BEGIN
    ALTER TABLE quality.elevate_practice_ratings ALTER COLUMN descriptor_id uniqueidentifier NOT NULL;
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID('quality.elevate_practice_ratings')
      AND name = 'ix_elevate_practice_ratings_descriptor'
)
BEGIN
    CREATE INDEX ix_elevate_practice_ratings_descriptor
        ON quality.elevate_practice_ratings(descriptor_id, assessment_id);
END;

IF COL_LENGTH('quality.elevate_practice_assessments', 'archived_at') IS NULL
BEGIN
    ALTER TABLE quality.elevate_practice_assessments ADD archived_at datetimeoffset NULL;
END;
GO

IF EXISTS (
    SELECT 1
    FROM sys.key_constraints
    WHERE parent_object_id = OBJECT_ID('quality.elevate_practice_assessments')
      AND name = 'uq_elevate_practice_assessments_year'
)
BEGIN
    ALTER TABLE quality.elevate_practice_assessments DROP CONSTRAINT uq_elevate_practice_assessments_year;
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID('quality.elevate_practice_assessments')
      AND name = 'ux_elevate_practice_assessments_active_year'
)
BEGIN
    CREATE UNIQUE INDEX ux_elevate_practice_assessments_active_year
        ON quality.elevate_practice_assessments(staff_id, academic_year)
        WHERE archived_at IS NULL;
END;

IF COL_LENGTH('quality.elevate_practice_development_plans', 'archived_review_date') IS NULL
BEGIN
    ALTER TABLE quality.elevate_practice_development_plans ADD archived_review_date date NULL;
END;
GO

UPDATE quality.elevate_practice_development_plans
SET archived_review_date = COALESCE(archived_review_date, review_date),
    review_date = NULL
WHERE review_date IS NOT NULL;

UPDATE action_row
SET due_date = NULL,
    updated_at = sysutcdatetime()
FROM quality.actions action_row
JOIN quality.elevate_practice_development_plans plan_row ON plan_row.action_id = action_row.id
WHERE plan_row.archived_review_date IS NOT NULL
  AND action_row.due_date = plan_row.archived_review_date;

COMMIT TRANSACTION;
GO
