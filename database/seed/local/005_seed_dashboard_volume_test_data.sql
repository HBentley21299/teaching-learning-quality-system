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

    DECLARE @academicYear nvarchar(20) = N'2025/26';
    DECLARE @recordCount int = 120;
    DECLARE @marker nvarchar(80) = N'[LOAD TEST 25/26]';

    IF EXISTS (
        SELECT 1
        FROM core.records
        WHERE academic_year_key = @academicYear
          AND LEFT(title, LEN(@marker)) = @marker
    )
    BEGIN
        PRINT 'The 2025/26 dashboard volume fixture already exists.';
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
    DECLARE @ownerStaffId uniqueidentifier = (
        SELECT staff_id FROM auth.user_accounts WHERE id = @createdBy
    );
    DECLARE @frameworkId uniqueidentifier = (
        SELECT TOP (1) id
        FROM quality.elevate_practice_frameworks
        WHERE is_active = 1
        ORDER BY created_at DESC
    );
    DECLARE @learningWalkVersionId uniqueidentifier;
    DECLARE @learningWalkRatingsFieldId uniqueidentifier;
    SELECT TOP (1)
        @learningWalkVersionId = version.id,
        @learningWalkRatingsFieldId = field.id
    FROM forms.form_template_versions version
    JOIN forms.form_templates template ON template.id = version.form_template_id
    JOIN forms.form_sections section ON section.form_template_version_id = version.id
    JOIN forms.form_fields field ON field.form_section_id = section.id
    WHERE template.template_key = N'learning_walk_core'
      AND field.field_key = N'focus_rubric_ratings'
      AND template.archived_at IS NULL
      AND version.archived_at IS NULL
    ORDER BY version.created_at DESC;

    DECLARE @openStatusId uniqueidentifier = (
        SELECT value.id
        FROM core.lookup_values value
        JOIN core.lookup_types type ON type.id = value.lookup_type_id
        WHERE type.lookup_key = N'action_status' AND value.value_key = N'open'
    );
    DECLARE @completeStatusId uniqueidentifier = (
        SELECT value.id
        FROM core.lookup_values value
        JOIN core.lookup_types type ON type.id = value.lookup_type_id
        WHERE type.lookup_key = N'action_status' AND value.value_key = N'complete'
    );
    DECLARE @mediumPriorityId uniqueidentifier = (
        SELECT TOP (1) value.id
        FROM core.lookup_values value
        JOIN core.lookup_types type ON type.id = value.lookup_type_id
        WHERE type.lookup_key IN (N'priority', N'action_priority')
          AND value.value_key = N'medium'
        ORDER BY CASE WHEN type.lookup_key = N'priority' THEN 0 ELSE 1 END
    );

    IF @createdBy IS NULL OR @ownerStaffId IS NULL OR @frameworkId IS NULL
       OR @learningWalkVersionId IS NULL OR @learningWalkRatingsFieldId IS NULL
       OR @openStatusId IS NULL OR @completeStatusId IS NULL
        THROW 51000, 'The volume fixture requires the local admin account, active ELI framework, Learning Walk form and action statuses.', 1;

    DECLARE @participants TABLE (
        sample_number int IDENTITY(1,1) PRIMARY KEY,
        staff_id uniqueidentifier NOT NULL,
        staff_name nvarchar(300) NOT NULL,
        org_unit_id uniqueidentifier NOT NULL,
        org_unit_code nvarchar(50) NOT NULL,
        org_unit_name nvarchar(250) NOT NULL,
        parent_code nvarchar(50) NULL,
        parent_name nvarchar(250) NULL
    );

    ;WITH candidate AS (
        SELECT staff.id, staff.display_name, staff.primary_org_unit_id,
               unit.code org_unit_code, unit.name org_unit_name,
               parent.code parent_code, parent.name parent_name,
               ROW_NUMBER() OVER (
                   PARTITION BY COALESCE(parent.id, unit.id)
                   ORDER BY unit.code, staff.display_name, staff.id
               ) AS faculty_rank
        FROM people.staff staff
        JOIN org.org_units unit ON unit.id = staff.primary_org_unit_id
        LEFT JOIN org.org_units parent ON parent.id = unit.parent_org_unit_id
        WHERE staff.archived_at IS NULL
          AND staff.account_status = N'active'
          AND unit.archived_at IS NULL
          AND (staff.start_date IS NULL OR staff.start_date <= CONVERT(date, '2026-07-31'))
          AND (staff.end_date IS NULL OR staff.end_date >= CONVERT(date, '2025-08-01'))
          AND NOT EXISTS (
              SELECT 1 FROM quality.elevate_practice_assessments assessment
              WHERE assessment.staff_id = staff.id
                AND assessment.academic_year = @academicYear
                AND assessment.archived_at IS NULL
          )
          AND NOT EXISTS (
              SELECT 1 FROM quality.probation_cases probation
              WHERE probation.subject_staff_id = staff.id
                AND probation.academic_year = @academicYear
                AND probation.archived_at IS NULL
          )
          AND NOT EXISTS (
              SELECT 1 FROM cpd.elevate_status_awards award
              WHERE award.staff_id = staff.id
                AND award.academic_year_key = @academicYear
                AND award.archived_at IS NULL
          )
    )
    INSERT INTO @participants (
        staff_id, staff_name, org_unit_id, org_unit_code, org_unit_name, parent_code, parent_name
    )
    SELECT TOP (@recordCount)
           id, display_name, primary_org_unit_id, org_unit_code, org_unit_name, parent_code, parent_name
    FROM candidate
    ORDER BY faculty_rank, COALESCE(parent_code, org_unit_code), org_unit_code, display_name;

    IF (SELECT COUNT(*) FROM @participants) < @recordCount
        THROW 51000, 'At least 120 eligible staff are required for the 2025/26 volume fixture.', 1;

    DECLARE @records TABLE (
        sample_number int NOT NULL,
        process_key nvarchar(50) NOT NULL,
        record_id uniqueidentifier NOT NULL,
        detail_id uniqueidentifier NOT NULL,
        aux_id uniqueidentifier NOT NULL,
        extra_id uniqueidentifier NOT NULL,
        staff_id uniqueidentifier NOT NULL,
        org_unit_id uniqueidentifier NOT NULL,
        record_date date NOT NULL,
        PRIMARY KEY (process_key, sample_number)
    );

    INSERT INTO @records (
        sample_number, process_key, record_id, detail_id, aux_id, extra_id,
        staff_id, org_unit_id, record_date
    )
    SELECT participant.sample_number, process.process_key,
           NEWID(), NEWID(), NEWID(), NEWID(),
           participant.staff_id, participant.org_unit_id,
           DATEADD(day, (participant.sample_number * 13 + process.day_offset) % 350, CONVERT(date, '2025-08-05'))
    FROM @participants participant
    CROSS JOIN (VALUES
        (N'learning_walk', 0),
        (N'liv', 1),
        (N'eli', 2),
        (N'probation_case', 3),
        (N'elevate_environment', 4),
        (N'coaching_session', 5),
        (N'work_scrutiny', 6),
        (N'cpd_event', 7)
    ) process(process_key, day_offset);

    INSERT INTO core.records (
        id, module_id, record_type, title, summary,
        subject_staff_id, owner_staff_id, org_unit_id, record_date,
        created_by_user_account_id, created_at, academic_year_key,
        org_unit_code_snapshot, org_unit_name_snapshot,
        parent_org_unit_code_snapshot, parent_org_unit_name_snapshot
    )
    SELECT record.record_id,
           module.id,
           CASE record.process_key
               WHEN N'eli' THEN N'elevate_practice_assessment'
               WHEN N'probation_case' THEN N'probation_case'
               ELSE record.process_key
           END,
           CONCAT(@marker, N' ', process_name.display_name, N' ', RIGHT(CONCAT(N'000', record.sample_number), 3)),
           CONCAT(N'Removable high-volume reporting validation record for ', process_name.display_name, N'.'),
           record.staff_id, @ownerStaffId, record.org_unit_id, record.record_date,
           @createdBy, TODATETIMEOFFSET(CONVERT(datetime2, record.record_date), '+00:00'), @academicYear,
           participant.org_unit_code, participant.org_unit_name,
           participant.parent_code, participant.parent_name
    FROM @records record
    JOIN @participants participant ON participant.sample_number = record.sample_number
    CROSS APPLY (VALUES (
        CASE record.process_key
            WHEN N'learning_walk' THEN N'learning_walks'
            WHEN N'liv' THEN N'liv'
            WHEN N'eli' THEN N'elevate_practice'
            WHEN N'probation_case' THEN N'probation_observations'
            WHEN N'elevate_environment' THEN N'elevate_environments'
            WHEN N'coaching_session' THEN N'coaching_mentoring'
            WHEN N'work_scrutiny' THEN N'work_scrutiny'
            WHEN N'cpd_event' THEN N'cpd'
        END,
        CASE record.process_key
            WHEN N'learning_walk' THEN N'Learning Walk'
            WHEN N'liv' THEN N'LIV'
            WHEN N'eli' THEN N'ELI'
            WHEN N'probation_case' THEN N'Probation Observation'
            WHEN N'elevate_environment' THEN N'Learning Environment'
            WHEN N'coaching_session' THEN N'Coaching and Mentoring'
            WHEN N'work_scrutiny' THEN N'Work Scrutiny'
            WHEN N'cpd_event' THEN N'CPD'
        END
    )) process_name(module_key, display_name)
    JOIN core.modules module ON module.module_key = process_name.module_key AND module.archived_at IS NULL;

    /* Elevate Learning and Innovation assessments and requests. */
    INSERT INTO quality.elevate_practice_assessments (
        id, record_id, framework_id, staff_id, academic_year, status,
        submitted_at, created_at
    )
    SELECT record.detail_id, record.record_id, @frameworkId, record.staff_id,
           @academicYear, N'submitted',
           DATEADD(hour, 15, TODATETIMEOFFSET(CONVERT(datetime2, record.record_date), '+00:00')),
           TODATETIMEOFFSET(CONVERT(datetime2, record.record_date), '+00:00')
    FROM @records record
    WHERE record.process_key = N'eli';

    INSERT INTO quality.elevate_practice_area_ratings (
        assessment_id, area_id, descriptor_id, hidden_numeric_value, created_at
    )
    SELECT record.detail_id, area.id, descriptor.id, score.hidden_numeric_value,
           TODATETIMEOFFSET(CONVERT(datetime2, record.record_date), '+00:00')
    FROM @records record
    JOIN quality.elevate_practice_areas area ON area.framework_id = @frameworkId
    CROSS APPLY (VALUES (CONVERT(tinyint, 1 + ((record.sample_number + area.display_order) % 5)))) score(hidden_numeric_value)
    JOIN quality.elevate_practice_rubric_descriptors descriptor
      ON descriptor.framework_id = @frameworkId
     AND descriptor.hidden_numeric_value = score.hidden_numeric_value
     AND descriptor.is_active = 1
     AND descriptor.archived_at IS NULL
    WHERE record.process_key = N'eli';

    DECLARE @livFocus TABLE (
        option_number int PRIMARY KEY,
        id uniqueidentifier NOT NULL,
        value_key nvarchar(100) NOT NULL,
        display_name nvarchar(250) NOT NULL
    );
    INSERT INTO @livFocus (option_number, id, value_key, display_name)
    SELECT ROW_NUMBER() OVER (ORDER BY value.display_order, value.display_name),
           value.id, value.value_key, value.display_name
    FROM core.lookup_values value
    JOIN core.lookup_types type ON type.id = value.lookup_type_id
    WHERE type.lookup_key = N'liv_focus_area'
      AND value.value_key <> N'other'
      AND value.is_active = 1
      AND value.archived_at IS NULL;
    DECLARE @livFocusCount int = (SELECT COUNT(*) FROM @livFocus);

    INSERT INTO quality.elevate_practice_liv_information (
        assessment_id, preferred_visit_month, primary_focus_lookup_value_id,
        secondary_focus_lookup_value_id, desired_outcome, created_at
    )
    SELECT record.detail_id,
           DATEFROMPARTS(2025, 9 + ((record.sample_number - 1) % 4), 1),
           primary_focus.id, secondary_focus.id,
           CONCAT(@marker, N' Develop ', primary_focus.display_name, N' and ', secondary_focus.display_name, N'.'),
           TODATETIMEOFFSET(CONVERT(datetime2, record.record_date), '+00:00')
    FROM @records record
    JOIN @livFocus primary_focus
      ON primary_focus.option_number = 1 + ((record.sample_number - 1) % @livFocusCount)
    JOIN @livFocus secondary_focus
      ON secondary_focus.option_number = 1 + (record.sample_number % @livFocusCount)
    WHERE record.process_key = N'eli';

    /* LIV journey: 120 requested/cases/planned, 108 visited and 72 closed. */
    INSERT INTO quality.liv_records (
        id, record_id, subject_staff_id, reviewer_staff_id, org_unit_id,
        pre_conversation, status, current_stage, visibility_status, completion_date,
        source_elevate_assessment_id, eli_primary_focus_key, eli_primary_focus_snapshot,
        eli_desired_outcome, created_by_user_account_id, created_at
    )
    SELECT liv.detail_id, liv.record_id, liv.staff_id, @ownerStaffId, liv.org_unit_id,
           CONCAT(@marker, N' Initial LIV discussion.'),
           CASE WHEN liv.sample_number <= 72 THEN N'closed' ELSE N'in_progress' END,
           CASE WHEN liv.sample_number <= 72 THEN N'completed' ELSE N'visit_1' END,
           N'staff_visible',
           CASE WHEN liv.sample_number <= 72 THEN DATEADD(day, 28, liv.record_date) END,
           eli.detail_id, focus.value_key, focus.display_name,
           CONCAT(@marker, N' Receive developmental feedback on ', focus.display_name, N'.'),
           @createdBy, TODATETIMEOFFSET(CONVERT(datetime2, liv.record_date), '+00:00')
    FROM @records liv
    JOIN @records eli ON eli.sample_number = liv.sample_number AND eli.process_key = N'eli'
    JOIN @livFocus focus ON focus.option_number = 1 + ((liv.sample_number - 1) % @livFocusCount)
    WHERE liv.process_key = N'liv';

    INSERT INTO quality.liv_cycles (
        id, liv_record_id, cycle_number, cycle_status, started_at, completed_at,
        created_by_user_account_id, created_at
    )
    SELECT record.aux_id, record.detail_id, 1,
           CASE WHEN record.sample_number <= 72 THEN N'completed' ELSE N'in_progress' END,
           TODATETIMEOFFSET(CONVERT(datetime2, record.record_date), '+00:00'),
           CASE WHEN record.sample_number <= 72
                THEN DATEADD(day, 28, TODATETIMEOFFSET(CONVERT(datetime2, record.record_date), '+00:00')) END,
           @createdBy, TODATETIMEOFFSET(CONVERT(datetime2, record.record_date), '+00:00')
    FROM @records record
    WHERE record.process_key = N'liv';

    INSERT INTO quality.liv_visits (
        id, liv_record_id, visit_number, visit_date, visit_time, visit_type,
        course_name, course_level, reflection_notes, findings, visit_status,
        created_by_user_account_id, cycle_id, created_at
    )
    SELECT record.extra_id, record.detail_id, 1, DATEADD(day, 14, record.record_date),
           CONVERT(time, '10:00'), N'initial',
           CONCAT(@marker, N' Course ', RIGHT(CONCAT(N'000', record.sample_number), 3)),
           CONCAT(N'Level ', 1 + (record.sample_number % 4)),
           CONCAT(@marker, N' LIV notes recorded.'),
           N'Varied evidence has been recorded to validate outcome reporting.',
           CASE WHEN record.sample_number <= 108 THEN N'completed' ELSE N'in_progress' END,
           @createdBy, record.aux_id,
           TODATETIMEOFFSET(CONVERT(datetime2, record.record_date), '+00:00')
    FROM @records record
    WHERE record.process_key = N'liv';

    INSERT INTO quality.liv_visit_ratings (
        visit_id, focus_lookup_value_id, descriptor_id,
        hidden_numeric_value, is_not_applicable, created_at
    )
    SELECT record.extra_id, focus.id, descriptor.id, score.hidden_numeric_value, 0,
           TODATETIMEOFFSET(CONVERT(datetime2, record.record_date), '+00:00')
    FROM @records record
    JOIN @livFocus focus ON focus.option_number IN (
        1 + ((record.sample_number - 1) % @livFocusCount),
        1 + (record.sample_number % @livFocusCount)
    )
    CROSS APPLY (VALUES (CONVERT(tinyint, 1 + ((record.sample_number + focus.option_number) % 5)))) score(hidden_numeric_value)
    JOIN quality.elevate_practice_rubric_descriptors descriptor
      ON descriptor.framework_id = @frameworkId
     AND descriptor.hidden_numeric_value = score.hidden_numeric_value
     AND descriptor.is_active = 1
     AND descriptor.archived_at IS NULL
    WHERE record.process_key = N'liv'
      AND record.sample_number <= 108;

    /* Learning Walk focus selections and selected-focus rubric outcomes. */
    DECLARE @walkThemes TABLE (
        option_number int PRIMARY KEY,
        id uniqueidentifier NOT NULL,
        theme_name nvarchar(250) NOT NULL,
        group_name nvarchar(200) NOT NULL,
        display_order int NOT NULL
    );
    INSERT INTO @walkThemes (option_number, id, theme_name, group_name, display_order)
    SELECT ROW_NUMBER() OVER (ORDER BY group_row.display_order, theme.display_order, theme.name),
           theme.id, theme.name, group_row.name, theme.display_order
    FROM quality.learning_walk_themes theme
    JOIN quality.learning_walk_theme_groups group_row ON group_row.id = theme.theme_group_id
    WHERE theme.is_active = 1 AND theme.archived_at IS NULL
      AND group_row.is_active = 1 AND group_row.archived_at IS NULL;
    DECLARE @walkThemeCount int = (SELECT COUNT(*) FROM @walkThemes);

    INSERT INTO quality.activities (
        id, record_id, activity_type, activity_date, subject_staff_id,
        reviewer_staff_id, org_unit_id, programme_area, course_level,
        summary_strengths, summary_development, created_at
    )
    SELECT record.detail_id, record.record_id, N'learning_walk', record.record_date,
           record.staff_id, @ownerStaffId, record.org_unit_id,
           N'Teaching and Learning', CONCAT(N'Level ', 1 + (record.sample_number % 4)),
           CONCAT(@marker, N' Strengths observed.'),
           CONCAT(@marker, N' Development point recorded.'),
           TODATETIMEOFFSET(CONVERT(datetime2, record.record_date), '+00:00')
    FROM @records record
    WHERE record.process_key = N'learning_walk';

    INSERT INTO quality.learning_walk_details (
        activity_id, visit_focus, learners_present, publish_to_staff, created_at
    )
    SELECT record.detail_id, CONCAT(@marker, N' Selected focus review.'),
           8 + (record.sample_number % 22), 1,
           TODATETIMEOFFSET(CONVERT(datetime2, record.record_date), '+00:00')
    FROM @records record
    WHERE record.process_key = N'learning_walk';

    INSERT INTO quality.learning_walk_record_themes (
        record_id, theme_id, theme_name_snapshot, group_name_snapshot,
        display_order_snapshot, selected_at
    )
    SELECT record.record_id, theme.id, theme.theme_name, theme.group_name,
           theme.display_order,
           TODATETIMEOFFSET(CONVERT(datetime2, record.record_date), '+00:00')
    FROM @records record
    JOIN @walkThemes theme ON theme.option_number IN (
        1 + ((record.sample_number - 1) % @walkThemeCount),
        1 + (record.sample_number % @walkThemeCount)
    )
    WHERE record.process_key = N'learning_walk';

    INSERT INTO forms.form_submissions (
        id, record_id, form_template_version_id, submitted_by_user_account_id,
        submitted_at, status, created_at
    )
    SELECT record.aux_id, record.record_id, @learningWalkVersionId, @createdBy,
           DATEADD(hour, 12, TODATETIMEOFFSET(CONVERT(datetime2, record.record_date), '+00:00')),
           N'submitted', TODATETIMEOFFSET(CONVERT(datetime2, record.record_date), '+00:00')
    FROM @records record
    WHERE record.process_key = N'learning_walk';

    INSERT INTO forms.form_responses (
        form_submission_id, form_field_id, response_text, created_at
    )
    SELECT record.aux_id, @learningWalkRatingsFieldId,
           (
               SELECT CONVERT(nvarchar(36), theme.id) AS focusId,
                      theme.theme_name AS focusName,
                      score.hidden_numeric_value AS score,
                      descriptor.visible_wording AS rating
               FROM @walkThemes theme
               CROSS APPLY (VALUES (CONVERT(tinyint, 1 + ((record.sample_number + theme.option_number) % 5)))) score(hidden_numeric_value)
               JOIN quality.elevate_practice_rubric_descriptors descriptor
                 ON descriptor.framework_id = @frameworkId
                AND descriptor.hidden_numeric_value = score.hidden_numeric_value
                AND descriptor.is_active = 1
                AND descriptor.archived_at IS NULL
               WHERE theme.option_number IN (
                   1 + ((record.sample_number - 1) % @walkThemeCount),
                   1 + (record.sample_number % @walkThemeCount)
               )
               ORDER BY theme.option_number
               FOR JSON PATH
           ),
           TODATETIMEOFFSET(CONVERT(datetime2, record.record_date), '+00:00')
    FROM @records record
    WHERE record.process_key = N'learning_walk';

    /* Work Scrutiny records use removable 2025/26 course rows. */
    DECLARE @courses TABLE (
        sample_number int PRIMARY KEY,
        id uniqueidentifier NOT NULL
    );
    INSERT INTO @courses (sample_number, id)
    SELECT sample_number, NEWID() FROM @participants;

    INSERT INTO curriculum.courses (
        id, course_code, course_name, org_unit_id, academic_year,
        is_active, source_system, created_at
    )
    SELECT course.id,
           CONCAT(N'LOAD25-', RIGHT(CONCAT(N'000', participant.sample_number), 3)),
           CONCAT(@marker, N' Course ', RIGHT(CONCAT(N'000', participant.sample_number), 3)),
           participant.org_unit_id, @academicYear, 1,
           N'TLQS_DASHBOARD_VOLUME_TEST',
           CONVERT(datetimeoffset, '2025-08-01T00:00:00+00:00')
    FROM @courses course
    JOIN @participants participant ON participant.sample_number = course.sample_number;

    INSERT INTO quality.activities (
        id, record_id, activity_type, activity_date, subject_staff_id,
        reviewer_staff_id, org_unit_id, programme_area, course_level,
        summary_strengths, summary_development, created_at
    )
    SELECT record.detail_id, record.record_id, N'work_scrutiny', record.record_date,
           record.staff_id, @ownerStaffId, record.org_unit_id,
           N'Curriculum sample', CONCAT(N'Level ', 1 + (record.sample_number % 4)),
           CONCAT(@marker, N' Consistent strengths identified.'),
           CONCAT(@marker, N' Follow-up sampling recommended.'),
           TODATETIMEOFFSET(CONVERT(datetime2, record.record_date), '+00:00')
    FROM @records record
    WHERE record.process_key = N'work_scrutiny';

    INSERT INTO quality.work_scrutiny_details (
        activity_id, sample_size, work_type, feedback_strategy_notes,
        publish_to_staff, created_at
    )
    SELECT record.detail_id, 5 + (record.sample_number % 16),
           CASE record.sample_number % 3 WHEN 0 THEN N'Written work' WHEN 1 THEN N'Practical evidence' ELSE N'Digital portfolio' END,
           CONCAT(@marker, N' Varied feedback evidence recorded.'), 1,
           TODATETIMEOFFSET(CONVERT(datetime2, record.record_date), '+00:00')
    FROM @records record
    WHERE record.process_key = N'work_scrutiny';

    INSERT INTO quality.work_scrutiny_course_samples (record_id, course_id, created_at)
    SELECT record.record_id, course.id,
           TODATETIMEOFFSET(CONVERT(datetime2, record.record_date), '+00:00')
    FROM @records record
    JOIN @courses course ON course.sample_number = record.sample_number
    WHERE record.process_key = N'work_scrutiny';

    /* Elevate Learning Environments outcomes across all configured pillars. */
    DECLARE @rooms TABLE (option_number int PRIMARY KEY, id uniqueidentifier NOT NULL);
    INSERT INTO @rooms (option_number, id)
    SELECT ROW_NUMBER() OVER (ORDER BY room.building_name, room.room_code), room.id
    FROM quality.rooms room
    WHERE room.is_active = 1 AND room.archived_at IS NULL;
    DECLARE @roomCount int = (SELECT COUNT(*) FROM @rooms);

    IF @roomCount = 0
        THROW 51000, 'At least one active learning environment room is required.', 1;

    INSERT INTO quality.elevate_environment_assessments (
        record_id, room_id, total_score, scored_value_count, barrier_count, created_at
    )
    SELECT record.record_id, room.id,
           SUM(1 + ((record.sample_number + pillar.display_order) % 5)),
           COUNT(*), CASE WHEN record.sample_number % 4 = 0 THEN 1 ELSE 0 END,
           TODATETIMEOFFSET(CONVERT(datetime2, record.record_date), '+00:00')
    FROM @records record
    JOIN @rooms room ON room.option_number = 1 + ((record.sample_number - 1) % @roomCount)
    CROSS JOIN quality.elevate_environment_pillars pillar
    WHERE record.process_key = N'elevate_environment'
      AND pillar.is_active = 1 AND pillar.archived_at IS NULL
    GROUP BY record.record_id, record.sample_number, record.record_date, room.id;

    INSERT INTO quality.elevate_environment_pillar_ratings (
        record_id, pillar_key, rubric_descriptor_id, numerical_score,
        judgement_key, judgement_label_snapshot, descriptor_snapshot, created_at
    )
    SELECT record.record_id, pillar.pillar_key, descriptor.id,
           descriptor.numerical_score, descriptor.judgement_key,
           descriptor.judgement_label, descriptor.descriptor,
           TODATETIMEOFFSET(CONVERT(datetime2, record.record_date), '+00:00')
    FROM @records record
    CROSS JOIN quality.elevate_environment_pillars pillar
    CROSS APPLY (VALUES (CONVERT(tinyint, 1 + ((record.sample_number + pillar.display_order) % 5)))) score(numerical_score)
    JOIN quality.elevate_environment_rubric_descriptors descriptor
      ON descriptor.pillar_id = pillar.id
     AND descriptor.numerical_score = score.numerical_score
     AND descriptor.is_active = 1
     AND descriptor.archived_at IS NULL
    WHERE record.process_key = N'elevate_environment'
      AND pillar.is_active = 1 AND pillar.archived_at IS NULL;

    /* Coaching and mentoring sessions. */
    DECLARE @coachingFocus TABLE (
        option_number int PRIMARY KEY,
        id uniqueidentifier NOT NULL,
        display_name nvarchar(250) NOT NULL
    );
    INSERT INTO @coachingFocus (option_number, id, display_name)
    SELECT ROW_NUMBER() OVER (ORDER BY value.display_order, value.display_name),
           value.id, value.display_name
    FROM core.lookup_values value
    JOIN core.lookup_types type ON type.id = value.lookup_type_id
    WHERE type.lookup_key = N'coaching_focus_area'
      AND value.value_key <> N'other'
      AND value.is_active = 1
      AND value.archived_at IS NULL;
    DECLARE @coachingFocusCount int = (SELECT COUNT(*) FROM @coachingFocus);

    INSERT INTO quality.coaching_cycles (
        id, staff_id, coach_staff_id, cycle_number, cycle_type, status,
        started_on, closed_on, created_by_user_account_id, created_at
    )
    SELECT record.detail_id, record.staff_id, @ownerStaffId,
           COALESCE(existing.max_cycle_number, 0) + 1,
           CASE WHEN record.sample_number % 4 = 0 THEN N'mentoring' ELSE N'coaching' END,
           N'closed', record.record_date, DATEADD(day, 14, record.record_date),
           @createdBy, TODATETIMEOFFSET(CONVERT(datetime2, record.record_date), '+00:00')
    FROM @records record
    OUTER APPLY (
        SELECT MAX(cycle.cycle_number) max_cycle_number
        FROM quality.coaching_cycles cycle
        WHERE cycle.staff_id = record.staff_id
    ) existing
    WHERE record.process_key = N'coaching_session';

    INSERT INTO quality.coaching_sessions (
        id, record_id, cycle_id, staff_id, coach_staff_id, session_number,
        session_date, session_type, delivery_method, duration_minutes, status,
        primary_focus_lookup_value_id, secondary_focus_lookup_value_id,
        specific_session_focus, current_practice_descriptor_id,
        current_practice_wording_snapshot, current_practice_hidden_score,
        current_practice_evidence, conversation_summary, staff_agrees, coach_agrees,
        completed_at, closes_cycle, created_by_user_account_id, created_at
    )
    SELECT record.aux_id, record.record_id, record.detail_id, record.staff_id, @ownerStaffId, 1,
           record.record_date,
           CASE WHEN record.sample_number % 4 = 0 THEN N'mentoring' ELSE N'coaching' END,
           CASE record.sample_number % 3 WHEN 0 THEN N'in_person' WHEN 1 THEN N'online' ELSE N'telephone' END,
           45 + ((record.sample_number % 4) * 15), N'completed',
           primary_focus.id, secondary_focus.id,
           CONCAT(@marker, N' Development conversation.'), descriptor.id,
           descriptor.visible_wording, descriptor.hidden_numeric_value,
           N'Practice evidence recorded for volume reporting validation.',
           N'Agreed a focused next step and an approach for reviewing impact.',
           1, 1,
           DATEADD(hour, 16, TODATETIMEOFFSET(CONVERT(datetime2, record.record_date), '+00:00')),
           1, @createdBy, TODATETIMEOFFSET(CONVERT(datetime2, record.record_date), '+00:00')
    FROM @records record
    JOIN @coachingFocus primary_focus
      ON primary_focus.option_number = 1 + ((record.sample_number - 1) % @coachingFocusCount)
    JOIN @coachingFocus secondary_focus
      ON secondary_focus.option_number = 1 + (record.sample_number % @coachingFocusCount)
    CROSS APPLY (VALUES (CONVERT(tinyint, 1 + (record.sample_number % 5)))) score(hidden_numeric_value)
    JOIN quality.elevate_practice_rubric_descriptors descriptor
      ON descriptor.framework_id = @frameworkId
     AND descriptor.hidden_numeric_value = score.hidden_numeric_value
     AND descriptor.is_active = 1
     AND descriptor.archived_at IS NULL
    WHERE record.process_key = N'coaching_session';

    /* Probation cases with one completed observation and two future stages. */
    INSERT INTO quality.probation_cases (
        id, record_id, subject_staff_id, org_unit_id, source_elevate_assessment_id,
        academic_year, status, current_observation_number, completed_at,
        created_by_user_account_id, created_at
    )
    SELECT probation.detail_id, probation.record_id, probation.staff_id, probation.org_unit_id,
           eli.detail_id, @academicYear,
           CASE WHEN probation.sample_number <= 84 THEN N'completed' ELSE N'in_progress' END,
           CASE WHEN probation.sample_number <= 84 THEN 3 ELSE 2 END,
           CASE WHEN probation.sample_number <= 84
                THEN DATEADD(day, 30, TODATETIMEOFFSET(CONVERT(datetime2, probation.record_date), '+00:00')) END,
           @createdBy, TODATETIMEOFFSET(CONVERT(datetime2, probation.record_date), '+00:00')
    FROM @records probation
    JOIN @records eli ON eli.sample_number = probation.sample_number AND eli.process_key = N'eli'
    WHERE probation.process_key = N'probation_case';

    DECLARE @probationObservations TABLE (
        sample_number int NOT NULL,
        observation_number tinyint NOT NULL,
        id uniqueidentifier NOT NULL,
        PRIMARY KEY (sample_number, observation_number)
    );
    INSERT INTO @probationObservations (sample_number, observation_number, id)
    SELECT record.sample_number, observation.observation_number, NEWID()
    FROM @records record
    CROSS JOIN (VALUES (CONVERT(tinyint, 1)), (CONVERT(tinyint, 2)), (CONVERT(tinyint, 3))) observation(observation_number)
    WHERE record.process_key = N'probation_case';

    INSERT INTO quality.probation_observations (
        id, probation_case_id, observation_number, observation_type, status,
        started_at, completed_at, completed_by_user_account_id,
        created_by_user_account_id, created_at
    )
    SELECT observation.id, record.detail_id, observation.observation_number,
           CASE WHEN observation.observation_number = 2 THEN N'liv' ELSE N'probation' END,
           CASE WHEN observation.observation_number = 1 THEN N'completed' ELSE N'not_started' END,
           CASE WHEN observation.observation_number = 1
                THEN TODATETIMEOFFSET(CONVERT(datetime2, record.record_date), '+00:00') END,
           CASE WHEN observation.observation_number = 1
                THEN DATEADD(hour, 3, TODATETIMEOFFSET(CONVERT(datetime2, record.record_date), '+00:00')) END,
           CASE WHEN observation.observation_number = 1 THEN @createdBy END,
           @createdBy, TODATETIMEOFFSET(CONVERT(datetime2, record.record_date), '+00:00')
    FROM @probationObservations observation
    JOIN @records record ON record.sample_number = observation.sample_number
                        AND record.process_key = N'probation_case';

    INSERT INTO quality.probation_observation_visits (
        probation_observation_id, observation_date, observation_time,
        course_name, course_level, key_points, unobserved_focus_keys_json,
        created_by_user_account_id, created_at
    )
    SELECT observation.id, record.record_date, CONVERT(time, '09:30'),
           CONCAT(@marker, N' Probation course ', RIGHT(CONCAT(N'000', record.sample_number), 3)),
           CONCAT(N'Level ', 1 + (record.sample_number % 4)),
           N'Varied observation evidence recorded for reporting validation.',
           CONCAT(N'["', unobserved.value_key, N'"]'),
           @createdBy, TODATETIMEOFFSET(CONVERT(datetime2, record.record_date), '+00:00')
    FROM @probationObservations observation
    JOIN @records record ON record.sample_number = observation.sample_number
                        AND record.process_key = N'probation_case'
    JOIN @livFocus unobserved
      ON unobserved.option_number = 1 + ((record.sample_number + 1) % @livFocusCount)
    WHERE observation.observation_number = 1;

    INSERT INTO quality.probation_observation_ratings (
        probation_observation_id, focus_lookup_value_id, descriptor_id,
        hidden_numeric_value, evidence_of_practice, created_at
    )
    SELECT observation.id, focus.id, descriptor.id, score.hidden_numeric_value,
           N'Observed practice evidence recorded for reporting validation.',
           TODATETIMEOFFSET(CONVERT(datetime2, record.record_date), '+00:00')
    FROM @probationObservations observation
    JOIN @records record ON record.sample_number = observation.sample_number
                        AND record.process_key = N'probation_case'
    JOIN @livFocus focus ON focus.option_number IN (
        1 + ((record.sample_number - 1) % @livFocusCount),
        1 + (record.sample_number % @livFocusCount)
    )
    CROSS APPLY (VALUES (CONVERT(tinyint, 1 + ((record.sample_number + focus.option_number) % 5)))) score(hidden_numeric_value)
    JOIN quality.elevate_practice_rubric_descriptors descriptor
      ON descriptor.framework_id = @frameworkId
     AND descriptor.hidden_numeric_value = score.hidden_numeric_value
     AND descriptor.is_active = 1
     AND descriptor.archived_at IS NULL
    WHERE observation.observation_number = 1;

    /* CPD events, attendance and a distributed Elevate Status profile. */
    DECLARE @cpdThemes TABLE (option_number int PRIMARY KEY, id uniqueidentifier NOT NULL);
    INSERT INTO @cpdThemes (option_number, id)
    SELECT ROW_NUMBER() OVER (ORDER BY value.display_order, value.display_name), value.id
    FROM core.lookup_values value
    JOIN core.lookup_types type ON type.id = value.lookup_type_id
    WHERE type.lookup_key = N'cpd_theme'
      AND value.is_active = 1 AND value.archived_at IS NULL;
    DECLARE @cpdThemeCount int = (SELECT COUNT(*) FROM @cpdThemes);

    INSERT INTO cpd.cpd_events (
        id, record_id, event_title, event_date, start_time, end_time,
        theme_lookup_value_id, delivery_method, facilitator_staff_id,
        location, target_audience, capacity, notes, duration_minutes, created_at
    )
    SELECT record.detail_id, record.record_id,
           CONCAT(@marker, N' CPD event ', RIGHT(CONCAT(N'000', record.sample_number), 3)),
           record.record_date, CONVERT(time, '09:00'), CONVERT(time, '10:30'),
           theme.id,
           CASE record.sample_number % 3 WHEN 0 THEN N'in_person' WHEN 1 THEN N'online' ELSE N'hybrid' END,
           @ownerStaffId, CONCAT(N'Room ', 1 + (record.sample_number % 20)),
           N'Teaching and learning staff', 30,
           CONCAT(@marker, N' CPD reporting event.'),
           60 + ((record.sample_number % 4) * 30),
           TODATETIMEOFFSET(CONVERT(datetime2, record.record_date), '+00:00')
    FROM @records record
    JOIN @cpdThemes theme ON theme.option_number = 1 + ((record.sample_number - 1) % @cpdThemeCount)
    WHERE record.process_key = N'cpd_event';

    INSERT INTO cpd.cpd_attendance (
        id, cpd_event_id, staff_id, org_unit_id_at_time,
        attendance_status, milestone_credit, evidence_required, created_at
    )
    SELECT record.aux_id, record.detail_id, record.staff_id, record.org_unit_id,
           N'Attended', 1, 0,
           TODATETIMEOFFSET(CONVERT(datetime2, record.record_date), '+00:00')
    FROM @records record
    WHERE record.process_key = N'cpd_event';

    INSERT INTO cpd.elevate_status_awards (
        id, staff_id, academic_year_key, level_number, qualifying_attendance_count,
        evidence_cpd_event_id, implementation_impact,
        confirmed_by_user_account_id, confirmed_at
    )
    SELECT CONVERT(uniqueidentifier, CONCAT(
               N'D9000000-0000-0000-0000-',
               RIGHT(CONCAT(N'000000000000', participant.sample_number), 12)
           )),
           participant.staff_id, @academicYear, award.level_number,
           award.level_number * 3,
           CASE WHEN award.level_number = 1 THEN cpd.detail_id END,
           CASE WHEN award.level_number = 1
                THEN CONCAT(@marker, N' Evidence of implementation and impact.') END,
           @createdBy,
           DATEADD(hour, 16, TODATETIMEOFFSET(CONVERT(datetime2, cpd.record_date), '+00:00'))
    FROM @participants participant
    JOIN @records cpd ON cpd.sample_number = participant.sample_number AND cpd.process_key = N'cpd_event'
    CROSS APPLY (VALUES (CONVERT(tinyint, 1 + ((participant.sample_number - 1) % 5)))) award(level_number);

    /* One linked action for every process record: 960 actions in total. */
    INSERT INTO quality.actions (
        id, source_record_id, subject_staff_id, owner_staff_id,
        title, detail, action_theme, priority_lookup_value_id,
        status_lookup_value_id, due_date, completed_date,
        published_to_staff, created_by_user_account_id, created_at,
        completion_note, completed_by_user_account_id,
        source_form_type, original_due_date, visibility_setting, progress_status
    )
    SELECT NEWID(), record.record_id, record.staff_id, @ownerStaffId,
           CONCAT(@marker, N' ', action_copy.action_theme, N' action ', RIGHT(CONCAT(N'000', record.sample_number), 3)),
           N'Removable action used to validate completion, overdue and organisational reporting.',
           action_copy.action_theme, @mediumPriorityId,
           CASE WHEN record.sample_number % 4 = 0 THEN @completeStatusId ELSE @openStatusId END,
           CASE record.sample_number % 4
               WHEN 0 THEN DATEADD(day, 30, record.record_date)
               WHEN 1 THEN CONVERT(date, '2026-06-15')
               WHEN 2 THEN CONVERT(date, '2026-09-15')
               ELSE CONVERT(date, '2026-08-20')
           END,
           CASE WHEN record.sample_number % 4 = 0 THEN DATEADD(day, 20, record.record_date) END,
           1, @createdBy,
           TODATETIMEOFFSET(CONVERT(datetime2, record.record_date), '+00:00'),
           CASE WHEN record.sample_number % 4 = 0 THEN N'Completed within the load-test scenario.' END,
           CASE WHEN record.sample_number % 4 = 0 THEN @createdBy END,
           action_copy.source_form_type,
           CASE record.sample_number % 4
               WHEN 0 THEN DATEADD(day, 30, record.record_date)
               WHEN 1 THEN CONVERT(date, '2026-06-15')
               WHEN 2 THEN CONVERT(date, '2026-09-15')
               ELSE CONVERT(date, '2026-08-20')
           END,
           N'staff_and_management',
           CASE WHEN record.sample_number % 4 = 0 THEN N'completed'
                WHEN record.sample_number % 3 = 0 THEN N'in_progress'
                ELSE N'not_started' END
    FROM @records record
    CROSS APPLY (VALUES (
        CASE record.process_key
            WHEN N'learning_walk' THEN N'learning_walk'
            WHEN N'liv' THEN N'liv'
            WHEN N'eli' THEN N'elevate_practice'
            WHEN N'probation_case' THEN N'probation_observation'
            WHEN N'elevate_environment' THEN N'elevate_environment'
            WHEN N'coaching_session' THEN N'coaching_mentoring'
            WHEN N'work_scrutiny' THEN N'work_scrutiny'
            WHEN N'cpd_event' THEN N'cpd'
        END,
        CASE record.process_key
            WHEN N'learning_walk' THEN N'Assessment and feedback'
            WHEN N'liv' THEN N'Planning and structure'
            WHEN N'eli' THEN N'Professional development'
            WHEN N'probation_case' THEN N'Professional standards'
            WHEN N'elevate_environment' THEN N'Inclusive environment'
            WHEN N'coaching_session' THEN N'Reflective practice'
            WHEN N'work_scrutiny' THEN N'Learner progress'
            WHEN N'cpd_event' THEN N'Knowledge transfer'
        END
    )) action_copy(source_form_type, action_theme);

    COMMIT TRANSACTION;

    SELECT record_type, COUNT_BIG(*) AS record_count
    FROM core.records
    WHERE academic_year_key = @academicYear
      AND LEFT(title, LEN(@marker)) = @marker
    GROUP BY record_type
    ORDER BY record_type;

    SELECT source_form_type, COUNT_BIG(*) AS action_count
    FROM quality.actions
    WHERE LEFT(title, LEN(@marker)) = @marker
      AND archived_at IS NULL
    GROUP BY source_form_type
    ORDER BY source_form_type;

    PRINT 'The 2025/26 dashboard volume fixture is ready.';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
