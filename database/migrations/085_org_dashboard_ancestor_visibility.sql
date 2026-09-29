SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

-- A unit is reportable only when it and every ancestor are included. Keep
-- unassigned records visible; the depth guard prevents malformed cycles from
-- making excluded data reportable.
CREATE OR ALTER FUNCTION org.fn_dashboard_unit_visible (@org_unit_id uniqueidentifier)
RETURNS bit
AS
BEGIN
    DECLARE @visible bit = 1;
    DECLARE @current uniqueidentifier = @org_unit_id;
    DECLARE @parent uniqueidentifier;
    DECLARE @included bit;
    DECLARE @depth int = 0;

    WHILE @current IS NOT NULL AND @depth < 64
    BEGIN
        SELECT @parent = parent_org_unit_id, @included = include_in_dashboards
        FROM org.org_units WHERE id = @current;
        IF @@ROWCOUNT = 0 BREAK;
        IF @included = 0
        BEGIN
            SET @visible = 0;
            RETURN @visible;
        END;
        SET @current = @parent;
        SET @depth += 1;
    END;

    IF @depth = 64 AND @current IS NOT NULL SET @visible = 0;
    RETURN @visible;
END;
GO
