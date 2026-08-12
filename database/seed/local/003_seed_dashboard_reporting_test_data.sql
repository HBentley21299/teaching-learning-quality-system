SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

BEGIN TRY
    BEGIN TRANSACTION;

    IF EXISTS (SELECT 1 FROM core.records WHERE id = 'E1000000-0000-0000-0000-000000000001')
    BEGIN
        PRINT 'Dashboard reporting test data already exists.';
        COMMIT TRANSACTION;
        RETURN;
    END;

    DECLARE @createdBy uniqueidentifier = (
        SELECT account.id
        FROM auth.user_accounts account
        JOIN people.staff staff ON staff.id = account.staff_id
        WHERE staff.external_id = N'STAFF_0001'
          AND account.archived_at IS NULL
          AND staff.archived_at IS NULL
    );
    DECLARE @moduleId uniqueidentifier = (
        SELECT id FROM core.modules WHERE module_key = N'elevate_practice' AND archived_at IS NULL
    );
    DECLARE @livModuleId uniqueidentifier = (
        SELECT id FROM core.modules WHERE module_key = N'liv' AND archived_at IS NULL
    );
    DECLARE @ownerStaffId uniqueidentifier = (
        SELECT staff_id FROM auth.user_accounts WHERE id = @createdBy
    );
    DECLARE @frameworkId uniqueidentifier = (
        SELECT TOP (1) id
        FROM quality.elevate_practice_frameworks
        WHERE is_active = 1 AND archived_at IS NULL
        ORDER BY created_at DESC
    );

    IF @createdBy IS NULL OR @ownerStaffId IS NULL OR @moduleId IS NULL OR @livModuleId IS NULL OR @frameworkId IS NULL
        THROW 51000, 'The local dashboard fixture requires the Harry Bentley account, ELI and LIV modules, and active ELI framework.', 1;

    DECLARE @participants TABLE (
        sample_number int IDENTITY(1,1) PRIMARY KEY,
        staff_id uniqueidentifier NOT NULL,
        staff_name nvarchar(300) NOT NULL,
        org_unit_id uniqueidentifier NOT NULL,
        team_code nvarchar(50) NOT NULL,
        faculty_code nvarchar(50) NOT NULL
    );

    ;WITH eligible_teams AS (
        SELECT team.id, team.code, faculty.code AS faculty_code,
               ROW_NUMBER() OVER (PARTITION BY faculty.id ORDER BY team.code) AS team_rank
        FROM org.org_units team
        JOIN org.org_units faculty ON faculty.id = team.parent_org_unit_id
        WHERE team.is_active = 1 AND team.archived_at IS NULL
          AND faculty.is_active = 1 AND faculty.archived_at IS NULL
          AND faculty.code IN (N'CUCB', N'CUCP', N'CUDC', N'CUST')
          AND team.org_unit_type IN (N'team', N'faculty_child_code', N'faculty_child')
    ),
    eligible_staff AS (
        SELECT staff.id, staff.display_name, staff.primary_org_unit_id,
               ROW_NUMBER() OVER (PARTITION BY staff.primary_org_unit_id ORDER BY staff.display_name, staff.id) AS staff_rank
        FROM people.staff staff
        WHERE staff.archived_at IS NULL
          AND staff.account_status = N'active'
          AND NOT EXISTS (
              SELECT 1
              FROM quality.elevate_practice_assessments assessment
              WHERE assessment.staff_id = staff.id
                AND assessment.academic_year = N'2025/26'
                AND assessment.archived_at IS NULL
          )
    )
    INSERT INTO @participants (staff_id, staff_name, org_unit_id, team_code, faculty_code)
    SELECT TOP (12) staff.id, staff.display_name, team.id, team.code, team.faculty_code
    FROM eligible_teams team
    JOIN eligible_staff staff ON staff.primary_org_unit_id = team.id AND staff.staff_rank = 1
    WHERE team.team_rank <= 3
    ORDER BY team.faculty_code, team.code;

    IF (SELECT COUNT(*) FROM @participants) < 8
        THROW 51000, 'At least eight eligible staff across the selected faculties are required for the dashboard fixture.', 1;

    INSERT INTO core.records (
        id, module_id, record_type, title, summary, subject_staff_id, owner_staff_id,
        org_unit_id, record_date, created_by_user_account_id, academic_year_key
    )
    SELECT CONVERT(uniqueidentifier, CONCAT(N'E1000000-0000-0000-0000-', RIGHT(CONCAT(N'000000000000', participant.sample_number), 12))),
           @moduleId, N'elevate_practice_assessment',
           CONCAT(N'[TEST DASHBOARD] ELI - ', participant.staff_name),
           CONCAT(N'Reporting fixture for ', participant.faculty_code, N' / ', participant.team_code, N' with a varied practice profile.'),
           participant.staff_id, participant.staff_id, participant.org_unit_id,
           DATEADD(day, (participant.sample_number - 1) * 18, CONVERT(date, '2025-09-05')),
           @createdBy, N'2025/26'
    FROM @participants participant;

    INSERT INTO quality.elevate_practice_assessments (
        id, record_id, framework_id, staff_id, academic_year, status, submitted_at
    )
    SELECT CONVERT(uniqueidentifier, CONCAT(N'E2000000-0000-0000-0000-', RIGHT(CONCAT(N'000000000000', participant.sample_number), 12))),
           CONVERT(uniqueidentifier, CONCAT(N'E1000000-0000-0000-0000-', RIGHT(CONCAT(N'000000000000', participant.sample_number), 12))),
           @frameworkId, participant.staff_id, N'2025/26', N'submitted',
           DATEADD(hour, 15, CONVERT(datetimeoffset, DATEADD(day, (participant.sample_number - 1) * 18, CONVERT(date, '2025-09-05'))))
    FROM @participants participant;

    INSERT INTO quality.elevate_practice_area_ratings (
        assessment_id, area_id, descriptor_id, hidden_numeric_value
    )
    SELECT CONVERT(uniqueidentifier, CONCAT(N'E2000000-0000-0000-0000-', RIGHT(CONCAT(N'000000000000', participant.sample_number), 12))),
           area.id, descriptor.id, score.hidden_numeric_value
    FROM @participants participant
    JOIN quality.elevate_practice_areas area ON area.framework_id = @frameworkId
    CROSS APPLY (VALUES (CONVERT(tinyint, 2 + ((participant.sample_number + area.display_order) % 4)))) score(hidden_numeric_value)
    JOIN quality.elevate_practice_rubric_descriptors descriptor
      ON descriptor.framework_id = @frameworkId
     AND descriptor.hidden_numeric_value = score.hidden_numeric_value
     AND descriptor.is_active = 1
     AND descriptor.archived_at IS NULL;

    ;WITH focus_options AS (
        SELECT value.id, value.value_key,
               ROW_NUMBER() OVER (ORDER BY value.display_order, value.display_name) option_number
        FROM core.lookup_values value
        JOIN core.lookup_types type ON type.id = value.lookup_type_id
        WHERE type.lookup_key = N'liv_focus_area'
          AND value.value_key <> N'other'
          AND value.is_active = 1
          AND value.archived_at IS NULL
    )
    INSERT INTO quality.elevate_practice_liv_information (
        assessment_id, preferred_visit_month, primary_focus_lookup_value_id,
        desired_outcome, created_at
    )
    SELECT CONVERT(uniqueidentifier, CONCAT(N'E2000000-0000-0000-0000-', RIGHT(CONCAT(N'000000000000', participant.sample_number), 12))),
           DATEFROMPARTS(2025, 9 + ((participant.sample_number - 1) % 4), 1),
           focus.id,
           CONCAT(N'[TEST DASHBOARD] Develop and receive feedback on ', focus.value_key, N'.'),
           DATEADD(hour, 15, CONVERT(datetimeoffset, DATEADD(day, (participant.sample_number - 1) * 18, CONVERT(date, '2025-09-05'))))
    FROM @participants participant
    JOIN focus_options focus
      ON focus.option_number = 1 + ((participant.sample_number - 1) % (SELECT COUNT(*) FROM focus_options));

    INSERT INTO core.records (
        id, module_id, record_type, title, summary, subject_staff_id, owner_staff_id,
        org_unit_id, record_date, created_by_user_account_id, academic_year_key
    )
    SELECT CONVERT(uniqueidentifier, CONCAT(N'E3000000-0000-0000-0000-', RIGHT(CONCAT(N'000000000000', participant.sample_number), 12))),
           @livModuleId, N'liv', CONCAT(N'[TEST DASHBOARD] LIV - ', participant.staff_name),
           N'Removable reporting fixture used to validate the LIV journey.', participant.staff_id,
           @ownerStaffId, participant.org_unit_id,
           DATEADD(day, (participant.sample_number - 1) * 21, CONVERT(date, '2025-10-06')),
           @createdBy, N'2025/26'
    FROM @participants participant
    WHERE participant.sample_number <= 6;

    ;WITH selected_focus AS (
        SELECT assessment.id assessment_id, focus.value_key, focus.display_name
        FROM quality.elevate_practice_assessments assessment
        JOIN quality.elevate_practice_liv_information information ON information.assessment_id = assessment.id
        JOIN core.lookup_values focus ON focus.id = information.primary_focus_lookup_value_id
        WHERE assessment.id IN (
            SELECT CONVERT(uniqueidentifier, CONCAT(N'E2000000-0000-0000-0000-', RIGHT(CONCAT(N'000000000000', participant.sample_number), 12)))
            FROM @participants participant WHERE participant.sample_number <= 6
        )
    )
    INSERT INTO quality.liv_records (
        id, record_id, subject_staff_id, reviewer_staff_id, org_unit_id, pre_conversation,
        status, current_stage, visibility_status, completion_date,
        source_elevate_assessment_id, eli_primary_focus_key, eli_primary_focus_snapshot,
        eli_desired_outcome, created_by_user_account_id
    )
    SELECT CONVERT(uniqueidentifier, CONCAT(N'E4000000-0000-0000-0000-', RIGHT(CONCAT(N'000000000000', participant.sample_number), 12))),
           CONVERT(uniqueidentifier, CONCAT(N'E3000000-0000-0000-0000-', RIGHT(CONCAT(N'000000000000', participant.sample_number), 12))),
           participant.staff_id, @ownerStaffId, participant.org_unit_id,
           N'[TEST DASHBOARD] Initial discussion recorded.',
           CASE WHEN participant.sample_number = 1 THEN N'closed' ELSE N'in_progress' END,
           CASE WHEN participant.sample_number = 1 THEN N'completed' ELSE N'visit_1' END,
           N'staff_visible', CASE WHEN participant.sample_number = 1 THEN CONVERT(date, '2026-01-30') END,
           CONVERT(uniqueidentifier, CONCAT(N'E2000000-0000-0000-0000-', RIGHT(CONCAT(N'000000000000', participant.sample_number), 12))),
           focus.value_key, focus.display_name,
           CONCAT(N'[TEST DASHBOARD] Develop and receive feedback on ', focus.display_name, N'.'),
           @createdBy
    FROM @participants participant
    JOIN selected_focus focus
      ON focus.assessment_id = CONVERT(uniqueidentifier, CONCAT(N'E2000000-0000-0000-0000-', RIGHT(CONCAT(N'000000000000', participant.sample_number), 12)))
    WHERE participant.sample_number <= 6;

    INSERT INTO quality.liv_cycles (
        id, liv_record_id, cycle_number, cycle_status, started_at, completed_at,
        created_by_user_account_id
    )
    SELECT CONVERT(uniqueidentifier, CONCAT(N'E5000000-0000-0000-0000-', RIGHT(CONCAT(N'000000000000', participant.sample_number), 12))),
           CONVERT(uniqueidentifier, CONCAT(N'E4000000-0000-0000-0000-', RIGHT(CONCAT(N'000000000000', participant.sample_number), 12))),
           1, CASE WHEN participant.sample_number = 1 THEN N'completed' ELSE N'in_progress' END,
           DATEADD(day, (participant.sample_number - 1) * 21, CONVERT(datetimeoffset, '2025-10-06T09:00:00+00:00')),
           CASE WHEN participant.sample_number = 1 THEN CONVERT(datetimeoffset, '2026-01-30T16:00:00+00:00') END,
           @createdBy
    FROM @participants participant
    WHERE participant.sample_number <= 6;

    INSERT INTO quality.liv_visits (
        id, liv_record_id, visit_number, visit_date, visit_time, visit_type,
        course_name, reflection_notes, findings, visit_status,
        created_by_user_account_id, cycle_id
    )
    SELECT CONVERT(uniqueidentifier, CONCAT(N'E6000000-0000-0000-0000-', RIGHT(CONCAT(N'000000000000', participant.sample_number), 12))),
           CONVERT(uniqueidentifier, CONCAT(N'E4000000-0000-0000-0000-', RIGHT(CONCAT(N'000000000000', participant.sample_number), 12))),
           1, DATEADD(day, (participant.sample_number - 1) * 21, CONVERT(date, '2025-10-20')),
           CONVERT(time, '10:00'), N'initial', CONCAT(N'[TEST DASHBOARD] Course ', participant.sample_number),
           N'[TEST DASHBOARD] LIV notes recorded for reporting validation.',
           N'[TEST DASHBOARD] Structured findings are available.',
           CASE WHEN participant.sample_number <= 3 THEN N'completed' ELSE N'in_progress' END,
           @createdBy,
           CONVERT(uniqueidentifier, CONCAT(N'E5000000-0000-0000-0000-', RIGHT(CONCAT(N'000000000000', participant.sample_number), 12)))
    FROM @participants participant
    WHERE participant.sample_number <= 5;

    ;WITH focus_options AS (
        SELECT value.id,
               ROW_NUMBER() OVER (ORDER BY value.display_order, value.display_name) option_number
        FROM core.lookup_values value
        JOIN core.lookup_types type ON type.id = value.lookup_type_id
        WHERE type.lookup_key = N'liv_focus_area'
          AND value.value_key <> N'other'
          AND value.is_active = 1
          AND value.archived_at IS NULL
    ),
    rated_visits AS (
        SELECT participant.sample_number, visit.id visit_id
        FROM @participants participant
        JOIN quality.liv_visits visit
          ON visit.id = CONVERT(uniqueidentifier, CONCAT(N'E6000000-0000-0000-0000-', RIGHT(CONCAT(N'000000000000', participant.sample_number), 12)))
        WHERE participant.sample_number <= 3
    )
    INSERT INTO quality.liv_visit_ratings (
        visit_id, focus_lookup_value_id, descriptor_id, hidden_numeric_value, is_not_applicable
    )
    SELECT visit.visit_id, focus.id, descriptor.id,
           CONVERT(tinyint, 2 + visit.sample_number), 0
    FROM rated_visits visit
    JOIN focus_options focus ON focus.option_number <= 2
    JOIN quality.elevate_practice_rubric_descriptors descriptor
      ON descriptor.framework_id = @frameworkId
     AND descriptor.hidden_numeric_value = CONVERT(tinyint, 2 + visit.sample_number)
     AND descriptor.is_active = 1
     AND descriptor.archived_at IS NULL;

    DECLARE @participantCount int = (SELECT COUNT(*) FROM @participants);
    COMMIT TRANSACTION;
    PRINT CONCAT('Dashboard reporting test data created for ', @participantCount, ' staff.');
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
