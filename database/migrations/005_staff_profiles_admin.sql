SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO

-- ============================================================
-- 1. Staff Profile reflection points
--    Configuration for the three termly reflection checkpoints.
--    A staff member's reflection itself is stored as a row in
--    evidence.evidence_items with pillar_or_theme = 'reflection'
--    and milestone_lookup_value_id pointing at the same
--    impact_milestone lookup value as the reflection point.
-- ============================================================
IF OBJECT_ID('quality.reflection_points', 'U') IS NULL
BEGIN
    CREATE TABLE quality.reflection_points (
        id uniqueidentifier NOT NULL CONSTRAINT pk_reflection_points PRIMARY KEY DEFAULT newsequentialid(),
        point_key nvarchar(50) NOT NULL,
        name nvarchar(200) NOT NULL,
        milestone_lookup_value_id uniqueidentifier NOT NULL,
        due_date date NOT NULL,
        display_order int NOT NULL CONSTRAINT df_reflection_points_order DEFAULT 0,
        is_active bit NOT NULL CONSTRAINT df_reflection_points_active DEFAULT 1,
        created_at datetimeoffset NOT NULL CONSTRAINT df_reflection_points_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        archived_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT fk_reflection_points_milestone FOREIGN KEY (milestone_lookup_value_id) REFERENCES core.lookup_values(id),
        CONSTRAINT uq_reflection_points_key UNIQUE (point_key)
    );
END;
GO

INSERT INTO quality.reflection_points (id, point_key, name, milestone_lookup_value_id, due_date, display_order)
SELECT v.id, v.point_key, v.name, v.milestone_lookup_value_id, v.due_date, v.display_order
FROM (VALUES
    ('90000000-0000-0000-0000-000000000001', 'reflection_1', 'Reflection Point 1', '14000000-0000-0000-0000-000000000001', '2026-12-18', 1),
    ('90000000-0000-0000-0000-000000000002', 'reflection_2', 'Reflection Point 2', '14000000-0000-0000-0000-000000000002', '2027-04-02', 2),
    ('90000000-0000-0000-0000-000000000003', 'reflection_3', 'Reflection Point 3', '14000000-0000-0000-0000-000000000003', '2027-07-05', 3)
) v(id, point_key, name, milestone_lookup_value_id, due_date, display_order)
WHERE NOT EXISTS (SELECT 1 FROM quality.reflection_points existing WHERE existing.point_key = v.point_key);
GO

-- ============================================================
-- 2. Helpful index for per-staff reflection lookups
-- ============================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID('evidence.evidence_items') AND name = 'ix_evidence_items_staff_milestone'
)
BEGIN
    CREATE NONCLUSTERED INDEX ix_evidence_items_staff_milestone
        ON evidence.evidence_items (staff_id, milestone_lookup_value_id)
        INCLUDE (pillar_or_theme, evidence_date, archived_at);
END;
GO
