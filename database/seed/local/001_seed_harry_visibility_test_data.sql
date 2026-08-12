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

    DECLARE @staffId uniqueidentifier;
    DECLARE @userAccountId uniqueidentifier;
    DECLARE @orgUnitId uniqueidentifier;
    DECLARE @facultyId uniqueidentifier;
    DECLARE @eliAssessmentId uniqueidentifier;

    SELECT @staffId = staff.id, @userAccountId = account.id
    FROM people.staff staff
    JOIN auth.user_accounts account ON account.staff_id = staff.id
    WHERE staff.external_id = N'STAFF_0001'
      AND staff.display_name = N'Harry Bentley'
      AND staff.archived_at IS NULL
      AND account.archived_at IS NULL;

    IF @staffId IS NULL OR @userAccountId IS NULL
        THROW 51000, 'Harry Bentley STAFF_0001 and the linked user account are required.', 1;

    IF EXISTS (SELECT 1 FROM core.records WHERE id = 'F1000000-0000-0000-0000-000000000101')
    BEGIN
        PRINT 'Harry Bentley local visibility test data already exists.';
        COMMIT TRANSACTION;
        RETURN;
    END;

    SELECT @orgUnitId = id, @facultyId = parent_org_unit_id
    FROM org.org_units
    WHERE code = N'CUDCDIG' AND archived_at IS NULL;

    SELECT TOP (1) @eliAssessmentId = id
    FROM quality.elevate_practice_assessments
    WHERE staff_id = @staffId
      AND academic_year = N'2025/26'
      AND status = N'submitted'
      AND archived_at IS NULL
    ORDER BY submitted_at DESC, created_at DESC;

    IF @orgUnitId IS NULL OR @facultyId IS NULL
        THROW 51000, 'The CUDCDIG organisation structure is required.', 1;

    DECLARE @learningModuleId uniqueidentifier = (SELECT id FROM core.modules WHERE module_key = N'learning_walks');
    DECLARE @scrutinyModuleId uniqueidentifier = (SELECT id FROM core.modules WHERE module_key = N'work_scrutiny');
    DECLARE @cpdModuleId uniqueidentifier = (SELECT id FROM core.modules WHERE module_key = N'cpd');
    DECLARE @environmentModuleId uniqueidentifier = (SELECT id FROM core.modules WHERE module_key = N'elevate_environments');
    DECLARE @coachingModuleId uniqueidentifier = (SELECT id FROM core.modules WHERE module_key = N'coaching_mentoring');
    DECLARE @livModuleId uniqueidentifier = (SELECT id FROM core.modules WHERE module_key = N'liv');
    DECLARE @probationModuleId uniqueidentifier = (SELECT id FROM core.modules WHERE module_key = N'probation_observations');

    DECLARE @learningVersionId uniqueidentifier = (
        SELECT TOP (1) version.id
        FROM forms.form_templates template
        JOIN forms.form_template_versions version ON version.form_template_id = template.id
        WHERE template.template_key = N'learning_walk_core' AND version.is_published = 1 AND version.archived_at IS NULL
        ORDER BY TRY_CONVERT(decimal(10, 2), version.version_label) DESC, version.created_at DESC
    );
    DECLARE @scrutinyVersionId uniqueidentifier = (
        SELECT TOP (1) version.id
        FROM forms.form_templates template
        JOIN forms.form_template_versions version ON version.form_template_id = template.id
        WHERE template.template_key = N'work_scrutiny_cudcpa' AND version.is_published = 1 AND version.archived_at IS NULL
        ORDER BY TRY_CONVERT(decimal(10, 2), version.version_label) DESC, version.created_at DESC
    );
    DECLARE @cpdVersionId uniqueidentifier = (
        SELECT TOP (1) version.id
        FROM forms.form_templates template
        JOIN forms.form_template_versions version ON version.form_template_id = template.id
        WHERE template.template_key = N'cpd_core' AND version.is_published = 1 AND version.archived_at IS NULL
        ORDER BY TRY_CONVERT(decimal(10, 2), version.version_label) DESC, version.created_at DESC
    );
    DECLARE @externalCpdVersionId uniqueidentifier = (
        SELECT TOP (1) version.id
        FROM forms.form_templates template
        JOIN forms.form_template_versions version ON version.form_template_id = template.id
        WHERE template.template_key = N'cpd_external_self_log' AND version.is_published = 1 AND version.archived_at IS NULL
        ORDER BY TRY_CONVERT(decimal(10, 2), version.version_label) DESC, version.created_at DESC
    );
    DECLARE @environmentVersionId uniqueidentifier = (
        SELECT TOP (1) version.id
        FROM forms.form_templates template
        JOIN forms.form_template_versions version ON version.form_template_id = template.id
        WHERE template.template_key = N'elevate_learning_environments_core' AND version.is_published = 1 AND version.archived_at IS NULL
        ORDER BY TRY_CONVERT(decimal(10, 2), version.version_label) DESC, version.created_at DESC
    );

    IF @learningVersionId IS NULL OR @scrutinyVersionId IS NULL OR @cpdVersionId IS NULL
       OR @externalCpdVersionId IS NULL OR @environmentVersionId IS NULL
        THROW 51000, 'The published test form templates are required.', 1;

    DECLARE @actionOpen uniqueidentifier = (
        SELECT value.id FROM core.lookup_values value JOIN core.lookup_types type ON type.id = value.lookup_type_id
        WHERE type.lookup_key = N'action_status' AND value.value_key = N'open'
    );
    DECLARE @actionComplete uniqueidentifier = (
        SELECT value.id FROM core.lookup_values value JOIN core.lookup_types type ON type.id = value.lookup_type_id
        WHERE type.lookup_key = N'action_status' AND value.value_key = N'complete'
    );
    DECLARE @actionExtended uniqueidentifier = (
        SELECT value.id FROM core.lookup_values value JOIN core.lookup_types type ON type.id = value.lookup_type_id
        WHERE type.lookup_key = N'action_status' AND value.value_key = N'extended'
    );
    DECLARE @priorityHigh uniqueidentifier = (
        SELECT value.id FROM core.lookup_values value JOIN core.lookup_types type ON type.id = value.lookup_type_id
        WHERE type.lookup_key = N'action_priority' AND value.value_key = N'high'
    );
    DECLARE @priorityMedium uniqueidentifier = (
        SELECT value.id FROM core.lookup_values value JOIN core.lookup_types type ON type.id = value.lookup_type_id
        WHERE type.lookup_key = N'action_priority' AND value.value_key = N'medium'
    );
    DECLARE @cpdThemeId uniqueidentifier = (
        SELECT TOP (1) value.id FROM core.lookup_values value JOIN core.lookup_types type ON type.id = value.lookup_type_id
        WHERE type.lookup_key = N'cpd_theme' AND value.value_key = N'digital_learning' AND value.archived_at IS NULL
    );
    DECLARE @qualifiedStatusId uniqueidentifier = (
        SELECT value.id FROM core.lookup_values value JOIN core.lookup_types type ON type.id = value.lookup_type_id
        WHERE type.lookup_key = N'coaching_development_stage' AND value.value_key = N'qualified'
    );
    DECLARE @digitalFocusId uniqueidentifier = (
        SELECT value.id FROM core.lookup_values value JOIN core.lookup_types type ON type.id = value.lookup_type_id
        WHERE type.lookup_key = N'coaching_focus_area' AND value.value_key = N'digital'
    );
    DECLARE @assessmentFocusId uniqueidentifier = (
        SELECT value.id FROM core.lookup_values value JOIN core.lookup_types type ON type.id = value.lookup_type_id
        WHERE type.lookup_key = N'coaching_focus_area' AND value.value_key = N'assessment'
    );
    DECLARE @secureDescriptorId uniqueidentifier = (
        SELECT descriptor.id
        FROM quality.elevate_practice_rubric_descriptors descriptor
        JOIN quality.elevate_practice_frameworks framework ON framework.id = descriptor.framework_id
        WHERE framework.is_active = 1 AND descriptor.is_active = 1 AND descriptor.hidden_numeric_value = 3
    );
    DECLARE @strongDescriptorId uniqueidentifier = (
        SELECT descriptor.id
        FROM quality.elevate_practice_rubric_descriptors descriptor
        JOIN quality.elevate_practice_frameworks framework ON framework.id = descriptor.framework_id
        WHERE framework.is_active = 1 AND descriptor.is_active = 1 AND descriptor.hidden_numeric_value = 4
    );

    DECLARE @learningRecordId uniqueidentifier = 'F1000000-0000-0000-0000-000000000101';
    DECLARE @scrutinyRecordId uniqueidentifier = 'F1000000-0000-0000-0000-000000000102';
    DECLARE @environmentRecordId uniqueidentifier = 'F1000000-0000-0000-0000-000000000103';
    DECLARE @coachingRecordId uniqueidentifier = 'F1000000-0000-0000-0000-000000000104';
    DECLARE @probationRecordId uniqueidentifier = 'F1000000-0000-0000-0000-000000000105';
    DECLARE @livRecordId uniqueidentifier = 'F1000000-0000-0000-0000-000000000106';

    INSERT INTO core.records (
        id, module_id, record_type, title, summary, subject_staff_id, owner_staff_id,
        org_unit_id, record_date, created_by_user_account_id, academic_year_key
    ) VALUES
        (@learningRecordId, @learningModuleId, N'learning_walk', N'[TEST] Digital learning walk', N'Visibility fixture: purposeful digital learning and learner engagement.', @staffId, @staffId, @orgUnitId, '2026-05-12', @userAccountId, N'2025/26'),
        (@scrutinyRecordId, @scrutinyModuleId, N'work_scrutiny', N'[TEST] Digital work scrutiny', N'Level 3 Digital sample: consistent feedback with one development priority.', @staffId, @staffId, @orgUnitId, '2026-05-20', @userAccountId, N'2025/26'),
        (@environmentRecordId, @environmentModuleId, N'elevate_environment', N'[TEST] A004 learning environment check', N'Campus Central room check with a secure overall profile.', @staffId, @staffId, @orgUnitId, '2026-06-03', @userAccountId, N'2025/26'),
        (@coachingRecordId, @coachingModuleId, N'coaching_session', N'[TEST] Coaching session 1 - Harry Bentley', N'Digital assessment and feedback coaching cycle.', @staffId, @staffId, @orgUnitId, '2026-06-10', @userAccountId, N'2025/26'),
        (@probationRecordId, @probationModuleId, N'probation_case', N'[TEST] Probationary Observations - Harry Bentley', N'Three-observation visibility fixture with observation 1 complete.', @staffId, @staffId, @orgUnitId, '2026-06-01', @userAccountId, N'2025/26'),
        (@livRecordId, @livModuleId, N'liv', N'[TEST] LIV - Harry Bentley', N'Observation 2 LIV linked to the probationary observation cycle.', @staffId, @staffId, @orgUnitId, '2026-06-17', @userAccountId, N'2025/26');

    DECLARE @learningSubmissionId uniqueidentifier = 'F4000000-0000-0000-0000-000000000101';
    DECLARE @scrutinySubmissionId uniqueidentifier = 'F4000000-0000-0000-0000-000000000102';
    DECLARE @environmentSubmissionId uniqueidentifier = 'F4000000-0000-0000-0000-000000000103';

    INSERT INTO forms.form_submissions (
        id, record_id, form_template_version_id, submitted_by_user_account_id, submitted_at, status
    ) VALUES
        (@learningSubmissionId, @learningRecordId, @learningVersionId, @userAccountId, '2026-05-12T11:00:00+00:00', N'submitted'),
        (@scrutinySubmissionId, @scrutinyRecordId, @scrutinyVersionId, @userAccountId, '2026-05-20T15:00:00+00:00', N'submitted'),
        (@environmentSubmissionId, @environmentRecordId, @environmentVersionId, @userAccountId, '2026-06-03T13:00:00+00:00', N'submitted');

    DECLARE @learningResponses TABLE (
        field_key nvarchar(100), response_text nvarchar(max), response_number decimal(18, 4),
        response_date date, response_json nvarchar(max)
    );
    INSERT INTO @learningResponses VALUES
        (N'visit_date', NULL, NULL, '2026-05-12', NULL),
        (N'faculty_area', CONVERT(nvarchar(36), @facultyId), NULL, NULL, NULL),
        (N'team_level', CONVERT(nvarchar(36), @orgUnitId), NULL, NULL, NULL),
        (N'learning_walk_theme', N'Digital', NULL, NULL, NULL),
        (N'additional_focus_context', N'Digital', NULL, NULL, N'["8C000000-0000-0000-0000-000000000002"]'),
        (N'good_practice', N'Learners used collaborative tools confidently and could explain how the activity supported their progress.', NULL, NULL, NULL),
        (N'development_areas', N'Increase the use of live checks for understanding before independent practice.', NULL, NULL, NULL);

    INSERT INTO forms.form_responses (
        form_submission_id, form_field_id, response_text, response_number, response_date, response_json
    )
    SELECT @learningSubmissionId, field.id, response.response_text, response.response_number, response.response_date, response.response_json
    FROM @learningResponses response
    JOIN forms.form_sections section ON section.form_template_version_id = @learningVersionId
    JOIN forms.form_fields field ON field.form_section_id = section.id AND field.field_key = response.field_key;

    DECLARE @learningActivityId uniqueidentifier = 'F6000000-0000-0000-0000-000000000101';
    INSERT INTO quality.activities (
        id, record_id, activity_type, activity_date, subject_staff_id, reviewer_staff_id,
        org_unit_id, programme_area, summary_strengths, summary_development
    ) VALUES (
        @learningActivityId, @learningRecordId, N'learning_walk', '2026-05-12', @staffId, @staffId,
        @orgUnitId, N'Digital Level 3', N'Confident collaborative technology use.', N'More live checks for understanding.'
    );
    INSERT INTO quality.learning_walk_details (activity_id, visit_focus, learners_present, publish_to_staff)
    VALUES (@learningActivityId, N'Digital', 18, 1);
    INSERT INTO quality.learning_walk_record_themes (
        record_id, theme_id, theme_name_snapshot, group_name_snapshot, display_order_snapshot
    ) VALUES (
        @learningRecordId, '8C000000-0000-0000-0000-000000000002', N'Digital', N'Digital', 10
    );

    DECLARE @scrutinyResponses TABLE (
        field_key nvarchar(100), response_text nvarchar(max), response_number decimal(18, 4), response_date date
    );
    INSERT INTO @scrutinyResponses VALUES
        (N'scrutiny_date', NULL, NULL, '2026-05-20'),
        (N'faculty_area', CONVERT(nvarchar(36), @facultyId), NULL, NULL),
        (N'team_level', CONVERT(nvarchar(36), @orgUnitId), NULL, NULL),
        (N'reviewer', CONVERT(nvarchar(36), @staffId), NULL, NULL),
        (N'course_or_unit', N'Digital Production Level 3', NULL, NULL),
        (N'sample_size', NULL, 8, NULL),
        (N'finding_tag', N'Development priority', NULL, NULL),
        (N'strengths', N'Feedback is regular, subject-specific and clearly linked to assessment criteria.', NULL, NULL),
        (N'development_areas', N'Build in more opportunities for learners to respond visibly to feedback.', NULL, NULL),
        (N'recommended_actions', N'Review a sample of learner responses to feedback at the next team meeting.', NULL, NULL);

    INSERT INTO forms.form_responses (
        form_submission_id, form_field_id, response_text, response_number, response_date
    )
    SELECT @scrutinySubmissionId, field.id, response.response_text, response.response_number, response.response_date
    FROM @scrutinyResponses response
    JOIN forms.form_sections section ON section.form_template_version_id = @scrutinyVersionId
    JOIN forms.form_fields field ON field.form_section_id = section.id AND field.field_key = response.field_key;

    DECLARE @scrutinyActivityId uniqueidentifier = 'F6000000-0000-0000-0000-000000000102';
    INSERT INTO quality.activities (
        id, record_id, activity_type, activity_date, subject_staff_id, reviewer_staff_id,
        org_unit_id, programme_area, summary_strengths, summary_development
    ) VALUES (
        @scrutinyActivityId, @scrutinyRecordId, N'work_scrutiny', '2026-05-20', @staffId, @staffId,
        @orgUnitId, N'Digital Production Level 3', N'Consistent assessment feedback.', N'More visible learner responses.'
    );
    INSERT INTO quality.work_scrutiny_details (
        activity_id, sample_size, work_type, feedback_strategy_notes, publish_to_staff
    ) VALUES (
        @scrutinyActivityId, 8, N'Digital Production Level 3', N'Follow up learner responses at the next team review.', 1
    );

    DECLARE @roomId uniqueidentifier = (SELECT TOP (1) id FROM quality.rooms WHERE room_code = N'A004' AND is_active = 1 AND archived_at IS NULL);
    IF @roomId IS NULL THROW 51000, 'Active room A004 is required.', 1;

    DECLARE @environmentResponses TABLE (
        field_key nvarchar(100), response_text nvarchar(max), response_number decimal(18, 4), response_date date
    );
    INSERT INTO @environmentResponses VALUES
        (N'room_code', N'A004', NULL, NULL),
        (N'building_name', N'Campus Central', NULL, NULL),
        (N'assessment_date', NULL, NULL, '2026-06-03'),
        (N'aspirational_score', NULL, 3, NULL),
        (N'aspirational_working', N'Learner work and progression routes are displayed clearly.', NULL, NULL),
        (N'collaborative_score', NULL, 3, NULL),
        (N'collaborative_working', N'The room supports pair and group work without obstructing movement.', NULL, NULL),
        (N'respectful_score', NULL, 3, NULL),
        (N'respectful_working', N'The environment is orderly, inclusive and well maintained.', NULL, NULL),
        (N'innovative_score', NULL, 2, NULL),
        (N'innovative_working', N'Digital display is used consistently; interactive resources could be expanded.', NULL, NULL),
        (N'inclusion_score', NULL, 3, NULL),
        (N'inclusion_working', N'Resources and layouts support a range of learner needs.', NULL, NULL);

    INSERT INTO forms.form_responses (
        form_submission_id, form_field_id, response_text, response_number, response_date
    )
    SELECT @environmentSubmissionId, field.id, response.response_text, response.response_number, response.response_date
    FROM @environmentResponses response
    JOIN forms.form_sections section ON section.form_template_version_id = @environmentVersionId
    JOIN forms.form_fields field ON field.form_section_id = section.id AND field.field_key = response.field_key;

    INSERT INTO quality.elevate_environment_assessments (
        record_id, room_id, total_score, scored_value_count, barrier_count
    ) VALUES (@environmentRecordId, @roomId, 14, 5, 0);

    DECLARE @number int = 1;
    WHILE @number <= 15
    BEGIN
        DECLARE @cpdRecordId uniqueidentifier = CONVERT(uniqueidentifier, CONCAT(N'F1000000-0000-0000-0000-', RIGHT(CONCAT(N'000000000000', @number), 12)));
        DECLARE @cpdEventId uniqueidentifier = CONVERT(uniqueidentifier, CONCAT(N'F2000000-0000-0000-0000-', RIGHT(CONCAT(N'000000000000', @number), 12)));
        DECLARE @attendanceId uniqueidentifier = CONVERT(uniqueidentifier, CONCAT(N'F3000000-0000-0000-0000-', RIGHT(CONCAT(N'000000000000', @number), 12)));
        DECLARE @cpdSubmissionId uniqueidentifier = CONVERT(uniqueidentifier, CONCAT(N'F4000000-0000-0000-0000-', RIGHT(CONCAT(N'000000000000', @number), 12)));
        DECLARE @eventDate date = DATEADD(day, (@number - 1) * 10, CONVERT(date, '2026-01-15'));
        DECLARE @eventTitle nvarchar(300) = CONCAT(N'[TEST] Elevate CPD ', FORMAT(@number, '00'), N' - ',
            CASE (@number - 1) % 5
                WHEN 0 THEN N'Digital assessment'
                WHEN 1 THEN N'Inclusive practice'
                WHEN 2 THEN N'Active learning'
                WHEN 3 THEN N'Feedback strategies'
                ELSE N'Curriculum development'
            END);

        INSERT INTO core.records (
            id, module_id, record_type, title, summary, subject_staff_id, owner_staff_id,
            org_unit_id, record_date, created_by_user_account_id, academic_year_key
        ) VALUES (
            @cpdRecordId, @cpdModuleId, N'cpd_event', @eventTitle,
            N'Local visibility fixture for internal Elevate CPD attendance.', @staffId, @staffId,
            @orgUnitId, @eventDate, @userAccountId, N'2025/26'
        );

        INSERT INTO forms.form_submissions (
            id, record_id, form_template_version_id, submitted_by_user_account_id, submitted_at, status
        ) VALUES (
            @cpdSubmissionId, @cpdRecordId, @cpdVersionId, @userAccountId,
            DATEADD(hour, 11, CONVERT(datetime2, @eventDate)), N'submitted'
        );

        INSERT INTO forms.form_responses (
            form_submission_id, form_field_id, response_text, response_number, response_json
        )
        SELECT @cpdSubmissionId, field.id,
            CASE field.field_key
                WHEN N'date_time' THEN CONCAT(CONVERT(nvarchar(10), @eventDate, 23), N'T09:00')
                WHEN N'cpd_title' THEN @eventTitle
                WHEN N'delivery_mode' THEN N'In person'
                WHEN N'cpd_themes' THEN N'Digital learning'
                WHEN N'staff_search' THEN N'Harry Bentley'
                WHEN N'selected_staff_list' THEN N'Harry Bentley'
                ELSE NULL
            END,
            CASE field.field_key WHEN N'duration_hours' THEN 1 WHEN N'duration_minutes' THEN 30 ELSE NULL END,
            CASE field.field_key
                WHEN N'cpd_themes' THEN N'["Digital learning"]'
                WHEN N'staff_search' THEN CONCAT(N'["', CONVERT(nvarchar(36), @staffId), N'"]')
                WHEN N'selected_staff_list' THEN CONCAT(N'["', CONVERT(nvarchar(36), @staffId), N'"]')
                ELSE NULL
            END
        FROM forms.form_sections section
        JOIN forms.form_fields field ON field.form_section_id = section.id
        WHERE section.form_template_version_id = @cpdVersionId
          AND field.field_key IN (N'date_time', N'cpd_title', N'delivery_mode', N'duration_hours', N'duration_minutes', N'cpd_themes', N'staff_search', N'selected_staff_list');

        INSERT INTO cpd.cpd_events (
            id, record_id, event_title, event_date, start_time, end_time, theme_lookup_value_id,
            delivery_method, facilitator_staff_id, location, target_audience, notes, duration_minutes
        ) VALUES (
            @cpdEventId, @cpdRecordId, @eventTitle, @eventDate, '09:00', '10:30', @cpdThemeId,
            N'in_person', @staffId, N'Campus Central', N'Curriculum staff',
            N'Local visibility fixture. Internal CPD counts towards Elevate Status.', 90
        );

        INSERT INTO cpd.cpd_attendance (
            id, cpd_event_id, staff_id, org_unit_id_at_time, attendance_status, milestone_credit, evidence_required
        ) VALUES (@attendanceId, @cpdEventId, @staffId, @orgUnitId, N'Attended', 1, 0);

        SET @number += 1;
    END;

    DECLARE @externalRecordId uniqueidentifier = 'F1000000-0000-0000-0000-000000000016';
    DECLARE @externalEventId uniqueidentifier = 'F2000000-0000-0000-0000-000000000016';
    DECLARE @externalAttendanceId uniqueidentifier = 'F3000000-0000-0000-0000-000000000016';
    DECLARE @externalSubmissionId uniqueidentifier = 'F4000000-0000-0000-0000-000000000016';

    INSERT INTO core.records (
        id, module_id, record_type, title, summary, subject_staff_id, owner_staff_id,
        org_unit_id, record_date, created_by_user_account_id, academic_year_key
    ) VALUES (
        @externalRecordId, @cpdModuleId, N'cpd_event', N'[TEST] External sector webinar',
        N'External CPD fixture reported separately from the Elevate campaign.', @staffId, @staffId,
        @orgUnitId, '2026-06-20', @userAccountId, N'2025/26'
    );
    INSERT INTO forms.form_submissions (
        id, record_id, form_template_version_id, submitted_by_user_account_id, submitted_at, status
    ) VALUES (
        @externalSubmissionId, @externalRecordId, @externalCpdVersionId, @userAccountId, '2026-06-20T12:00:00+00:00', N'submitted'
    );
    INSERT INTO forms.form_responses (
        form_submission_id, form_field_id, response_text, response_number, response_json
    )
    SELECT @externalSubmissionId, field.id,
        CASE field.field_key
            WHEN N'date_time' THEN N'2026-06-20T10:00'
            WHEN N'cpd_title' THEN N'[TEST] External sector webinar'
            WHEN N'delivery_mode' THEN N'Online'
            WHEN N'cpd_themes' THEN N'Digital learning'
            ELSE NULL
        END,
        CASE field.field_key WHEN N'duration_hours' THEN 2 WHEN N'duration_minutes' THEN 15 ELSE NULL END,
        CASE field.field_key WHEN N'cpd_themes' THEN N'["Digital learning"]' ELSE NULL END
    FROM forms.form_sections section
    JOIN forms.form_fields field ON field.form_section_id = section.id
    WHERE section.form_template_version_id = @externalCpdVersionId;
    INSERT INTO cpd.cpd_events (
        id, record_id, event_title, event_date, start_time, end_time, theme_lookup_value_id,
        delivery_method, facilitator_staff_id, location, notes, duration_minutes
    ) VALUES (
        @externalEventId, @externalRecordId, N'[TEST] External sector webinar', '2026-06-20', '10:00', '12:15', @cpdThemeId,
        N'online', @staffId, N'Online', N'External CPD fixture; excluded from Elevate Status.', 135
    );
    INSERT INTO cpd.cpd_attendance (
        id, cpd_event_id, staff_id, org_unit_id_at_time, attendance_status, milestone_credit, evidence_required
    ) VALUES (@externalAttendanceId, @externalEventId, @staffId, @orgUnitId, N'Attended', 1, 0);

    INSERT INTO cpd.elevate_status_awards (
        id, staff_id, academic_year_key, level_number, qualifying_attendance_count,
        evidence_cpd_event_id, implementation_impact, confirmed_by_user_account_id, confirmed_at
    )
    SELECT source.id, @staffId, N'2025/26', source.level_number, source.qualifying_attendance_count,
           source.evidence_cpd_event_id, source.implementation_impact, @userAccountId, source.confirmed_at
    FROM (VALUES
        (CONVERT(uniqueidentifier, 'FC000000-0000-0000-0000-000000000001'), 1, 3, CONVERT(uniqueidentifier, 'F2000000-0000-0000-0000-000000000001'), CONVERT(nvarchar(2000), N'Applied retrieval checks and collaborative digital tools; learner participation and confidence improved.'), CONVERT(datetimeoffset, '2026-02-10T12:00:00+00:00')),
        (CONVERT(uniqueidentifier, 'FC000000-0000-0000-0000-000000000002'), 2, 6, CONVERT(uniqueidentifier, NULL), CONVERT(nvarchar(2000), NULL), CONVERT(datetimeoffset, '2026-03-12T12:00:00+00:00')),
        (CONVERT(uniqueidentifier, 'FC000000-0000-0000-0000-000000000003'), 3, 9, CONVERT(uniqueidentifier, NULL), CONVERT(nvarchar(2000), NULL), CONVERT(datetimeoffset, '2026-04-11T12:00:00+00:00')),
        (CONVERT(uniqueidentifier, 'FC000000-0000-0000-0000-000000000004'), 4, 12, CONVERT(uniqueidentifier, NULL), CONVERT(nvarchar(2000), NULL), CONVERT(datetimeoffset, '2026-05-11T12:00:00+00:00')),
        (CONVERT(uniqueidentifier, 'FC000000-0000-0000-0000-000000000005'), 5, 15, CONVERT(uniqueidentifier, NULL), CONVERT(nvarchar(2000), NULL), CONVERT(datetimeoffset, '2026-06-10T12:00:00+00:00'))
    ) source(id, level_number, qualifying_attendance_count, evidence_cpd_event_id, implementation_impact, confirmed_at)
    WHERE NOT EXISTS (
        SELECT 1
        FROM cpd.elevate_status_awards existing
        WHERE existing.staff_id = @staffId
          AND existing.academic_year_key = N'2025/26'
          AND existing.level_number = source.level_number
          AND existing.archived_at IS NULL
    );

    DECLARE @coachingCycleId uniqueidentifier = 'F6000000-0000-0000-0000-000000000401';
    DECLARE @coachingSessionId uniqueidentifier = 'F6000000-0000-0000-0000-000000000402';
    DECLARE @coachingCycleNumber int = COALESCE((
        SELECT MAX(cycle_number)
        FROM quality.coaching_cycles
        WHERE staff_id = @staffId
    ), 0) + 1;
    INSERT INTO quality.coaching_cycles (
        id, staff_id, coach_staff_id, cycle_number, cycle_type, status, started_on, created_by_user_account_id
    ) VALUES (@coachingCycleId, @staffId, @staffId, @coachingCycleNumber, N'coaching', N'active', '2026-06-10', @userAccountId);
    INSERT INTO quality.coaching_sessions (
        id, record_id, cycle_id, staff_id, coach_staff_id, session_number, session_date,
        session_type, delivery_method, duration_minutes, status, development_stage_lookup_value_id,
        primary_focus_lookup_value_id, secondary_focus_lookup_value_id, specific_session_focus,
        current_practice_descriptor_id, current_practice_wording_snapshot, current_practice_hidden_score,
        current_practice_evidence, support_types_json, conversation_summary, staff_agrees, coach_agrees,
        completed_at, created_by_user_account_id, updated_by_user_account_id
    ) VALUES (
        @coachingSessionId, @coachingRecordId, @coachingCycleId, @staffId, @staffId, 1, '2026-06-10',
        N'coaching', N'in_person', 75, N'completed', @qualifiedStatusId,
        @digitalFocusId, @assessmentFocusId, N'Using digital checks to strengthen assessment and feedback.',
        @secureDescriptorId, N'Secure Practice', 3,
        N'Existing practice is consistent; learner response data is not yet used routinely to adapt activities.',
        N'["reflective_questioning","feedback","joint_planning"]',
        N'Reviewed current digital assessment practice, modelled a short retrieval sequence and agreed a trial with two groups.',
        1, 1, '2026-06-10T15:00:00+00:00', @userAccountId, @userAccountId
    );

    DECLARE @livDetailId uniqueidentifier = 'F6000000-0000-0000-0000-000000000501';
    DECLARE @livCycleId uniqueidentifier = 'F6000000-0000-0000-0000-000000000502';
    DECLARE @livVisitId uniqueidentifier = 'F6000000-0000-0000-0000-000000000503';
    INSERT INTO quality.liv_records (
        id, record_id, subject_staff_id, reviewer_staff_id, org_unit_id, course_seen, liv_date, liv_time,
        pre_conversation, status, created_by_user_account_id, current_stage, visibility_status,
        source_elevate_assessment_id, eli_primary_focus_key, eli_primary_focus_snapshot, eli_desired_outcome
    ) VALUES (
        @livDetailId, @livRecordId, @staffId, @staffId, @orgUnitId, N'Digital Production Level 3', '2026-06-17', '10:00',
        N'Explore how digital checks can make learner understanding more visible.', N'in_progress', @userAccountId,
        N'visit', N'staff_visible', NULL, N'planning_structure', N'Planning and Structure',
        N'Build a consistent sequence of retrieval, modelling and independent application.'
    );
    INSERT INTO quality.liv_cycles (
        id, liv_record_id, cycle_number, cycle_status, started_at, created_by_user_account_id
    ) VALUES (@livCycleId, @livDetailId, 1, N'in_progress', '2026-06-17T09:00:00+00:00', @userAccountId);
    INSERT INTO quality.liv_visits (
        id, liv_record_id, visit_number, visit_date, visit_time, visit_type, course_name, course_group,
        course_level, reflection_notes, findings, visit_status, created_by_user_account_id, cycle_id
    ) VALUES (
        @livVisitId, @livDetailId, 1, '2026-06-17', '10:00', N'initial', N'Digital Production', N'DP3-A',
        N'Level 3', N'Discussed the balance between live modelling and independent learner application.',
        N'Learners responded well to visible success criteria; checks for understanding should be more systematic.',
        N'in_progress', @userAccountId, @livCycleId
    );
    INSERT INTO quality.liv_stages (
        id, liv_cycle_id, stage_type, stage_order, stage_status, context_text, aims_text,
        liv_visit_id, created_by_user_account_id
    ) VALUES
        ('F6000000-0000-0000-0000-000000000511', @livCycleId, N'pre_discussion', 1, N'completed', N'Linked to the current ELI focus.', N'Make learner understanding visible.', NULL, @userAccountId),
        ('F6000000-0000-0000-0000-000000000512', @livCycleId, N'visit', 2, N'in_progress', N'Initial classroom visit.', N'Review digital checks and learner response.', @livVisitId, @userAccountId);

    DECLARE @probationCaseId uniqueidentifier = 'F6000000-0000-0000-0000-000000000601';
    DECLARE @observationOneId uniqueidentifier = 'F6000000-0000-0000-0000-000000000611';
    DECLARE @observationTwoId uniqueidentifier = 'F6000000-0000-0000-0000-000000000612';
    DECLARE @observationThreeId uniqueidentifier = 'F6000000-0000-0000-0000-000000000613';
    INSERT INTO quality.probation_cases (
        id, record_id, subject_staff_id, org_unit_id, source_elevate_assessment_id,
        academic_year, status, current_observation_number, created_by_user_account_id
    ) VALUES (
        @probationCaseId, @probationRecordId, @staffId, @orgUnitId, @eliAssessmentId,
        N'2025/26', N'in_progress', 2, @userAccountId
    );
    INSERT INTO quality.probation_case_reviewers (
        probation_case_id, staff_id, reviewer_role, created_by_user_account_id
    ) VALUES (@probationCaseId, @staffId, N'leader', @userAccountId);
    INSERT INTO quality.probation_observations (
        id, probation_case_id, observation_number, observation_type, status, linked_liv_record_id,
        started_at, completed_at, completed_by_user_account_id, created_by_user_account_id
    ) VALUES
        (@observationOneId, @probationCaseId, 1, N'probation', N'completed', NULL, '2026-06-05T09:00:00+00:00', '2026-06-05T12:00:00+00:00', @userAccountId, @userAccountId),
        (@observationTwoId, @probationCaseId, 2, N'liv', N'in_progress', @livDetailId, '2026-06-17T09:00:00+00:00', NULL, NULL, @userAccountId),
        (@observationThreeId, @probationCaseId, 3, N'probation', N'not_started', NULL, NULL, NULL, NULL, @userAccountId);

    INSERT INTO quality.probation_observation_stages (
        id, probation_observation_id, stage_type, stage_order, stage_status,
        context_text, reflection_text, intended_next_observation_date, created_by_user_account_id
    ) VALUES
        ('F6000000-0000-0000-0000-000000000621', @observationOneId, N'professional_discussion', 1, N'completed', N'Planning routines and learner expectations reviewed.', NULL, NULL, @userAccountId),
        ('F6000000-0000-0000-0000-000000000622', @observationOneId, N'visit_rubric', 2, N'completed', N'Positive start and digital practice sampled.', NULL, NULL, @userAccountId),
        ('F6000000-0000-0000-0000-000000000623', @observationOneId, N'reflection_feedback', 3, N'completed', NULL, N'Clear routines supported learner engagement; increase systematic checks for understanding.', NULL, @userAccountId),
        ('F6000000-0000-0000-0000-000000000624', @observationOneId, N'actions', 4, N'completed', N'Action recorded in the central engine.', NULL, NULL, @userAccountId),
        ('F6000000-0000-0000-0000-000000000625', @observationOneId, N'next_observation', 5, N'completed', NULL, NULL, '2026-06-17', @userAccountId),
        ('F6000000-0000-0000-0000-000000000631', @observationThreeId, N'professional_discussion', 1, N'in_progress', NULL, NULL, NULL, @userAccountId),
        ('F6000000-0000-0000-0000-000000000632', @observationThreeId, N'visit_rubric', 2, N'in_progress', NULL, NULL, NULL, @userAccountId),
        ('F6000000-0000-0000-0000-000000000633', @observationThreeId, N'reflection_feedback', 3, N'in_progress', NULL, NULL, NULL, @userAccountId),
        ('F6000000-0000-0000-0000-000000000634', @observationThreeId, N'actions', 4, N'in_progress', NULL, NULL, NULL, @userAccountId);

    INSERT INTO quality.probation_observation_visits (
        probation_observation_id, observation_date, observation_time, course_name, course_group,
        course_level, key_points, created_by_user_account_id
    ) VALUES
        (@observationOneId, '2026-06-05', '09:30', N'Digital Production', N'DP3-A', N'Level 3', N'Purposeful start, clear modelling and confident learner participation.', @userAccountId),
        (@observationThreeId, NULL, NULL, NULL, NULL, NULL, NULL, @userAccountId);

    DECLARE @positiveStartFocusId uniqueidentifier = (
        SELECT value.id FROM core.lookup_values value JOIN core.lookup_types type ON type.id = value.lookup_type_id
        WHERE type.lookup_key = N'liv_focus_area' AND value.value_key = N'positive_start'
    );
    DECLARE @livDigitalFocusId uniqueidentifier = (
        SELECT value.id FROM core.lookup_values value JOIN core.lookup_types type ON type.id = value.lookup_type_id
        WHERE type.lookup_key = N'liv_focus_area' AND value.value_key = N'digital'
    );
    INSERT INTO quality.probation_observation_ratings (
        probation_observation_id, focus_lookup_value_id, descriptor_id, hidden_numeric_value, evidence_of_practice
    ) VALUES
        (@observationOneId, @positiveStartFocusId, @secureDescriptorId, 3, N'Learners began promptly and understood the purpose of the activity.'),
        (@observationOneId, @livDigitalFocusId, @strongDescriptorId, 4, N'Digital tools were embedded and supported active learner participation.');

    INSERT INTO quality.actions (
        id, source_record_id, subject_staff_id, owner_staff_id, title, detail, action_theme,
        priority_lookup_value_id, status_lookup_value_id, due_date, completed_date,
        published_to_staff, created_by_user_account_id, completion_note, completed_by_user_account_id,
        source_form_type, source_sub_record_type, source_sub_record_id, source_sub_record_key,
        source_display_order, original_due_date, revised_due_date, visibility_setting,
        liv_visit_id, liv_cycle_id, progress_status, intended_evidence, intended_impact, review_date
    ) VALUES
        ('FA000000-0000-0000-0000-000000000001', @learningRecordId, @staffId, @staffId, N'[TEST] Trial live checks for understanding', N'Use two live checks in each sampled session and review learner responses.', N'Assessment', @priorityMedium, @actionOpen, '2026-07-28', NULL, 1, @userAccountId, NULL, NULL, N'learning_walk', NULL, NULL, NULL, 1, '2026-07-28', NULL, N'staff_and_management', NULL, NULL, N'in_progress', N'Two annotated lesson examples.', N'More responsive sequencing and learner confidence.', '2026-07-28'),
        ('FA000000-0000-0000-0000-000000000002', @scrutinyRecordId, @staffId, @staffId, N'[TEST] Review learner responses to feedback', N'Sample learner improvements after feedback and agree a consistent team approach.', N'Feedback', @priorityHigh, @actionOpen, '2026-06-15', NULL, 1, @userAccountId, NULL, NULL, N'work_scrutiny', NULL, NULL, NULL, 1, '2026-06-15', NULL, N'staff_and_management', NULL, NULL, N'not_started', N'Eight learner work samples.', N'More visible impact from feedback.', '2026-06-15'),
        ('FA000000-0000-0000-0000-000000000003', @environmentRecordId, @staffId, @staffId, N'[TEST] Expand interactive room resources', N'Add two reusable interactive resources to the room display.', N'Innovative', @priorityMedium, @actionOpen, '2026-08-05', NULL, 1, @userAccountId, NULL, NULL, N'elevate_environment', NULL, NULL, NULL, 1, '2026-08-05', NULL, N'staff_and_management', NULL, NULL, N'not_started', N'Photographs and resource links.', N'Greater learner interaction with the environment.', '2026-08-05'),
        ('FA000000-0000-0000-0000-000000000004', @coachingRecordId, @staffId, @staffId, N'[TEST] Trial the retrieval sequence', N'Use the agreed retrieval sequence with two groups and capture learner response data.', N'Assessment and feedback', @priorityMedium, @actionComplete, '2026-06-24', '2026-06-23', 1, @userAccountId, N'Completed with both groups; response rates improved.', @userAccountId, N'coaching_mentoring', N'coaching_session', @coachingSessionId, N'session_1', 1, '2026-06-24', NULL, N'staff_and_management', NULL, NULL, N'completed', N'Lesson resources and response data.', N'More accurate checks before independent work.', '2026-06-24'),
        ('FA000000-0000-0000-0000-000000000005', @livRecordId, @staffId, @staffId, N'[TEST] Embed visible success checks', N'Introduce a consistent success check before independent application.', N'Planning and structure', @priorityHigh, @actionExtended, '2026-08-20', NULL, 1, @userAccountId, NULL, NULL, N'liv', N'liv_visit', @livVisitId, N'visit_1', 1, '2026-07-10', '2026-08-20', N'staff_and_management', @livVisitId, @livCycleId, N'in_progress', N'Learner response sample from three sessions.', N'Learners identify and address misconceptions earlier.', '2026-08-20'),
        ('FA000000-0000-0000-0000-000000000006', @probationRecordId, @staffId, @staffId, N'[TEST] Prepare evidence for observation 3', N'Collate examples showing the impact of actions from observations 1 and 2.', N'Professional standards', @priorityMedium, @actionOpen, '2026-08-01', NULL, 1, @userAccountId, NULL, NULL, N'probation_observation', N'probation_observation', @observationTwoId, N'observation_2', 2, '2026-08-01', NULL, N'staff_and_management', NULL, NULL, N'not_started', N'Annotated resources and learner work.', N'Clear evidence of development across the probation cycle.', '2026-08-01');

    INSERT INTO quality.action_extensions (
        id, action_id, previous_due_date, extended_due_date, reason, created_by_user_account_id, created_at
    ) VALUES (
        'FD000000-0000-0000-0000-000000000001', 'FA000000-0000-0000-0000-000000000005',
        '2026-07-10', '2026-08-20', N'Additional delivery time was needed to gather a meaningful learner sample.', @userAccountId, '2026-07-08T10:00:00+00:00'
    );

    INSERT INTO evidence.evidence_items (
        id, staff_id, related_record_id, evidence_date, pillar_or_theme, what_tried,
        implementation_detail, impact_summary, created_by_user_account_id
    ) VALUES (
        'FB000000-0000-0000-0000-000000000001', @staffId, 'F1000000-0000-0000-0000-000000000001',
        '2026-05-20', N'Digital Teaching & Learning', N'Used retrieval checks and collaborative digital tools after internal CPD.',
        N'Trialled the approach with two Level 3 groups over four weeks.',
        N'Participation increased and misconceptions were identified earlier.', @userAccountId
    );

    INSERT INTO ops.audit_logs (
        user_account_id, record_id, entity_name, entity_id, action, summary, after_json
    )
    SELECT @userAccountId, record.id, N'record', record.id, N'test_fixture.created',
           CONCAT(record.title, N' created for local visibility testing.'), N'{"fixture":"harry-visibility-test"}'
    FROM core.records record
    WHERE record.created_by_user_account_id = @userAccountId
      AND record.title LIKE N'[[]TEST]%';

    COMMIT TRANSACTION;
    PRINT 'Harry Bentley local visibility test data created.';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
