SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'curriculum')
    EXEC('CREATE SCHEMA curriculum');
GO

IF COL_LENGTH('forms.form_fields', 'configuration_json') IS NULL
BEGIN
    ALTER TABLE forms.form_fields
    ADD configuration_json nvarchar(max) NULL;
END;
GO

IF OBJECT_ID('curriculum.courses', 'U') IS NULL
BEGIN
    CREATE TABLE curriculum.courses (
        id uniqueidentifier NOT NULL CONSTRAINT pk_courses PRIMARY KEY DEFAULT newsequentialid(),
        course_code nvarchar(100) NOT NULL,
        course_name nvarchar(300) NOT NULL,
        org_unit_id uniqueidentifier NOT NULL,
        academic_year nvarchar(20) NULL,
        is_active bit NOT NULL CONSTRAINT df_courses_active DEFAULT 1,
        source_system nvarchar(100) NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_courses_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        archived_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT fk_courses_org_unit FOREIGN KEY (org_unit_id) REFERENCES org.org_units(id),
        CONSTRAINT uq_courses_code_year UNIQUE (course_code, academic_year)
    );

    CREATE INDEX ix_courses_org_unit_active
    ON curriculum.courses(org_unit_id, is_active)
    INCLUDE (course_code, course_name, academic_year);
END;
GO

IF OBJECT_ID('quality.work_scrutiny_course_samples', 'U') IS NULL
BEGIN
    CREATE TABLE quality.work_scrutiny_course_samples (
        record_id uniqueidentifier NOT NULL,
        course_id uniqueidentifier NOT NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_work_scrutiny_samples_created DEFAULT sysutcdatetime(),
        CONSTRAINT pk_work_scrutiny_course_samples PRIMARY KEY (record_id, course_id),
        CONSTRAINT fk_work_scrutiny_samples_record FOREIGN KEY (record_id) REFERENCES core.records(id),
        CONSTRAINT fk_work_scrutiny_samples_course FOREIGN KEY (course_id) REFERENCES curriculum.courses(id)
    );

    CREATE INDEX ix_work_scrutiny_samples_course
    ON quality.work_scrutiny_course_samples(course_id, record_id);
END;
GO

-- Work scrutiny is course-based, so it does not always have an individual staff subject.
IF EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID('quality.activities')
      AND name = 'subject_staff_id'
      AND is_nullable = 0
)
BEGIN
    ALTER TABLE quality.activities ALTER COLUMN subject_staff_id uniqueidentifier NULL;
END;
GO

-- Retain the original fixed form for historical submissions, but do not offer it
-- for new records now that templates resolve from individual sub-teams.
UPDATE forms.form_templates
SET archived_at = COALESCE(archived_at, sysutcdatetime()),
    is_active = 0,
    updated_at = sysutcdatetime()
WHERE id = '74000000-0000-0000-0000-000000000001'
  AND archived_at IS NULL;
GO
