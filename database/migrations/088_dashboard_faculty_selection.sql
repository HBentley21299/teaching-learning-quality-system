SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO
IF OBJECT_ID(N'reporting.dashboard_faculty_exclusions', N'U') IS NULL
CREATE TABLE reporting.dashboard_faculty_exclusions (
    dashboard_key nvarchar(80) NOT NULL,
    faculty_org_unit_id uniqueidentifier NOT NULL REFERENCES org.org_units(id),
    updated_by_user_account_id uniqueidentifier NULL REFERENCES auth.user_accounts(id),
    updated_at datetimeoffset NOT NULL DEFAULT sysutcdatetime(),
    CONSTRAINT pk_dashboard_faculty_exclusions PRIMARY KEY(dashboard_key, faculty_org_unit_id)
);
GO
CREATE OR ALTER FUNCTION org.fn_dashboard_process_unit_visible (@org_unit_id uniqueidentifier, @process_key nvarchar(100))
RETURNS bit
AS
BEGIN
    IF org.fn_dashboard_unit_visible(@org_unit_id) = 0 RETURN 0;
    SET @process_key = CASE @process_key WHEN N'elevate_practice_assessment' THEN N'eli' WHEN N'elevate_practice' THEN N'eli'
        WHEN N'coaching_mentoring' THEN N'coaching_session' WHEN N'probation_observation' THEN N'probation_case'
        WHEN N'cpd' THEN N'cpd_event' ELSE @process_key END;
    DECLARE @current uniqueidentifier = @org_unit_id, @depth int = 0;
    WHILE @current IS NOT NULL AND @depth < 64
    BEGIN
        IF EXISTS(SELECT 1 FROM reporting.dashboard_faculty_exclusions WHERE dashboard_key=@process_key AND faculty_org_unit_id=@current) RETURN 0;
        SET @current = (SELECT parent_org_unit_id FROM org.org_units WHERE id=@current);
        SET @depth += 1;
    END;
    RETURN 1;
END;
GO
