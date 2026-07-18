SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO

IF COL_LENGTH('people.staff', 'staff_category') IS NULL
    ALTER TABLE people.staff ADD staff_category nvarchar(60) NULL;
GO

IF COL_LENGTH('people.staff', 'onboarding_source') IS NULL
BEGIN
    ALTER TABLE people.staff
    ADD onboarding_source nvarchar(50) NOT NULL
        CONSTRAINT df_staff_onboarding_source DEFAULT N'manual' WITH VALUES;
END;
GO

IF COL_LENGTH('people.staff', 'onboarded_at') IS NULL
    ALTER TABLE people.staff ADD onboarded_at datetimeoffset NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_staff_category')
BEGIN
    ALTER TABLE people.staff ADD CONSTRAINT ck_staff_category CHECK (
        staff_category IS NULL OR staff_category IN (
            N'head_of_faculty_sector_manager',
            N'programme_leader',
            N'tutor_tutor_assessor',
            N'other'
        )
    );
END;
GO

IF COL_LENGTH('org.staff_org_memberships', 'assignment_source') IS NULL
BEGIN
    ALTER TABLE org.staff_org_memberships
    ADD assignment_source nvarchar(50) NOT NULL
        CONSTRAINT df_staff_org_membership_assignment_source DEFAULT N'manual' WITH VALUES;
END;
GO

-- Cross-college staff still select a governed faculty/team pair during
-- onboarding. These are ordinary organisation units, so all existing scope,
-- reporting and administration rules continue to apply.
IF NOT EXISTS (SELECT 1 FROM org.org_units WHERE code = N'COLLEGE')
BEGIN
    INSERT INTO org.org_units (id, parent_org_unit_id, org_unit_type, code, name, description, is_active)
    VALUES (
        CONVERT(uniqueidentifier, '24000000-0000-0000-0000-000000000001'),
        NULL,
        N'faculty',
        N'COLLEGE',
        N'College-wide',
        N'Cross-college and central service staff.',
        1
    );
END
ELSE
BEGIN
    UPDATE org.org_units
    SET org_unit_type = N'faculty',
        name = N'College-wide',
        description = N'Cross-college and central service staff.',
        is_active = 1,
        archived_at = NULL,
        updated_at = sysutcdatetime()
    WHERE code = N'COLLEGE';
END;
GO

DECLARE @collegeId uniqueidentifier = (SELECT id FROM org.org_units WHERE code = N'COLLEGE');

IF NOT EXISTS (SELECT 1 FROM org.org_units WHERE code = N'COLLEGE-TL')
    INSERT INTO org.org_units (id, parent_org_unit_id, org_unit_type, code, name, is_active)
    VALUES (CONVERT(uniqueidentifier, '24000000-0000-0000-0000-000000000002'), @collegeId, N'team', N'COLLEGE-TL', N'Teaching & Learning', 1);
ELSE
    UPDATE org.org_units SET parent_org_unit_id = @collegeId, org_unit_type = N'team', name = N'Teaching & Learning', is_active = 1, archived_at = NULL, updated_at = sysutcdatetime() WHERE code = N'COLLEGE-TL';

IF NOT EXISTS (SELECT 1 FROM org.org_units WHERE code = N'COLLEGE-EXEC')
    INSERT INTO org.org_units (id, parent_org_unit_id, org_unit_type, code, name, is_active)
    VALUES (CONVERT(uniqueidentifier, '24000000-0000-0000-0000-000000000003'), @collegeId, N'team', N'COLLEGE-EXEC', N'Executive Leadership', 1);
ELSE
    UPDATE org.org_units SET parent_org_unit_id = @collegeId, org_unit_type = N'team', name = N'Executive Leadership', is_active = 1, archived_at = NULL, updated_at = sysutcdatetime() WHERE code = N'COLLEGE-EXEC';

IF NOT EXISTS (SELECT 1 FROM org.org_units WHERE code = N'COLLEGE-OTHER')
    INSERT INTO org.org_units (id, parent_org_unit_id, org_unit_type, code, name, is_active)
    VALUES (CONVERT(uniqueidentifier, '24000000-0000-0000-0000-000000000004'), @collegeId, N'team', N'COLLEGE-OTHER', N'Other / Central Services', 1);
ELSE
    UPDATE org.org_units SET parent_org_unit_id = @collegeId, org_unit_type = N'team', name = N'Other / Central Services', is_active = 1, archived_at = NULL, updated_at = sysutcdatetime() WHERE code = N'COLLEGE-OTHER';
GO

