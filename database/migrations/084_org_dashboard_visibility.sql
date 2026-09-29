SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

-- This controls reporting inclusion only. Existing records and staff allocations
-- remain untouched, and re-enabling a unit restores its historical dashboard data.
IF COL_LENGTH(N'org.org_units', N'include_in_dashboards') IS NULL
BEGIN
    ALTER TABLE org.org_units
    ADD include_in_dashboards bit NOT NULL
        CONSTRAINT df_org_units_include_in_dashboards DEFAULT (1);
END;
GO

-- A faculty setting applies to its descendants; teams retain their own setting.
-- Unassigned records remain reportable so that a missing allocation is visible.
CREATE OR ALTER FUNCTION org.fn_dashboard_unit_visible (@org_unit_id uniqueidentifier)
RETURNS bit
AS
BEGIN
    DECLARE @visible bit = 1;
    IF EXISTS (
        SELECT 1
        FROM org.org_units unit
        LEFT JOIN org.org_units parent ON parent.id = unit.parent_org_unit_id
        WHERE unit.id = @org_unit_id
          AND (unit.include_in_dashboards = 0 OR parent.include_in_dashboards = 0)
    )
        SET @visible = 0;
    RETURN @visible;
END;
GO
