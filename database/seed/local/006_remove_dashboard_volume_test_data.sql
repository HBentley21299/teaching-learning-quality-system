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

    DECLARE @marker nvarchar(80) = N'[LOAD TEST 25/26]';

    SELECT id, record_type
    INTO #volume_records
    FROM core.records
    WHERE academic_year_key = N'2025/26'
      AND LEFT(title, LEN(@marker)) = @marker;

    SELECT session.cycle_id
    INTO #volume_coaching_cycles
    FROM quality.coaching_sessions session
    JOIN #volume_records record ON record.id = session.record_id;

    DELETE extension_row
    FROM quality.action_extensions extension_row
    JOIN quality.actions action_row ON action_row.id = extension_row.action_id
    WHERE LEFT(action_row.title, LEN(@marker)) = @marker;

    DELETE review
    FROM quality.coaching_action_reviews review
    JOIN quality.actions action_row ON action_row.id = review.action_id
    WHERE LEFT(action_row.title, LEN(@marker)) = @marker;

    DELETE FROM quality.actions
    WHERE LEFT(title, LEN(@marker)) = @marker;

    DELETE FROM cpd.elevate_status_awards
    WHERE CONVERT(nvarchar(36), id) LIKE N'd9000000-%';

    DELETE response
    FROM forms.form_responses response
    JOIN forms.form_submissions submission ON submission.id = response.form_submission_id
    JOIN #volume_records record ON record.id = submission.record_id;

    DELETE submission
    FROM forms.form_submissions submission
    JOIN #volume_records record ON record.id = submission.record_id;

    DELETE rating
    FROM quality.liv_visit_ratings rating
    JOIN quality.liv_visits visit ON visit.id = rating.visit_id
    JOIN quality.liv_records liv ON liv.id = visit.liv_record_id
    JOIN #volume_records record ON record.id = liv.record_id;

    DELETE stage
    FROM quality.liv_stages stage
    JOIN quality.liv_cycles cycle ON cycle.id = stage.liv_cycle_id
    JOIN quality.liv_records liv ON liv.id = cycle.liv_record_id
    JOIN #volume_records record ON record.id = liv.record_id;

    DELETE visit
    FROM quality.liv_visits visit
    JOIN quality.liv_records liv ON liv.id = visit.liv_record_id
    JOIN #volume_records record ON record.id = liv.record_id;

    DELETE cycle
    FROM quality.liv_cycles cycle
    JOIN quality.liv_records liv ON liv.id = cycle.liv_record_id
    JOIN #volume_records record ON record.id = liv.record_id;

    DELETE liv
    FROM quality.liv_records liv
    JOIN #volume_records record ON record.id = liv.record_id;

    DELETE rating
    FROM quality.probation_observation_ratings rating
    JOIN quality.probation_observations observation ON observation.id = rating.probation_observation_id
    JOIN quality.probation_cases probation ON probation.id = observation.probation_case_id
    JOIN #volume_records record ON record.id = probation.record_id;

    DELETE visit
    FROM quality.probation_observation_visits visit
    JOIN quality.probation_observations observation ON observation.id = visit.probation_observation_id
    JOIN quality.probation_cases probation ON probation.id = observation.probation_case_id
    JOIN #volume_records record ON record.id = probation.record_id;

    DELETE stage
    FROM quality.probation_observation_stages stage
    JOIN quality.probation_observations observation ON observation.id = stage.probation_observation_id
    JOIN quality.probation_cases probation ON probation.id = observation.probation_case_id
    JOIN #volume_records record ON record.id = probation.record_id;

    DELETE reviewer
    FROM quality.probation_case_reviewers reviewer
    JOIN quality.probation_cases probation ON probation.id = reviewer.probation_case_id
    JOIN #volume_records record ON record.id = probation.record_id;

    DELETE observation
    FROM quality.probation_observations observation
    JOIN quality.probation_cases probation ON probation.id = observation.probation_case_id
    JOIN #volume_records record ON record.id = probation.record_id;

    DELETE probation
    FROM quality.probation_cases probation
    JOIN #volume_records record ON record.id = probation.record_id;

    DELETE rating
    FROM quality.elevate_practice_area_ratings rating
    JOIN quality.elevate_practice_assessments assessment ON assessment.id = rating.assessment_id
    JOIN #volume_records record ON record.id = assessment.record_id;

    DELETE information
    FROM quality.elevate_practice_liv_information information
    JOIN quality.elevate_practice_assessments assessment ON assessment.id = information.assessment_id
    JOIN #volume_records record ON record.id = assessment.record_id;

    DELETE selection
    FROM quality.elevate_practice_selections selection
    JOIN quality.elevate_practice_assessments assessment ON assessment.id = selection.assessment_id
    JOIN #volume_records record ON record.id = assessment.record_id;

    DELETE reflection
    FROM quality.elevate_practice_reflections reflection
    JOIN quality.elevate_practice_assessments assessment ON assessment.id = reflection.assessment_id
    JOIN #volume_records record ON record.id = assessment.record_id;

    DELETE rating
    FROM quality.elevate_practice_ratings rating
    JOIN quality.elevate_practice_assessments assessment ON assessment.id = rating.assessment_id
    JOIN #volume_records record ON record.id = assessment.record_id;

    DELETE assessment
    FROM quality.elevate_practice_assessments assessment
    JOIN #volume_records record ON record.id = assessment.record_id;

    DELETE rating
    FROM quality.elevate_environment_pillar_ratings rating
    JOIN #volume_records record ON record.id = rating.record_id;

    DELETE assessment
    FROM quality.elevate_environment_assessments assessment
    JOIN #volume_records record ON record.id = assessment.record_id;

    DELETE link
    FROM quality.learning_walk_record_themes link
    JOIN #volume_records record ON record.id = link.record_id;

    DELETE sample
    FROM quality.work_scrutiny_course_samples sample
    JOIN #volume_records record ON record.id = sample.record_id;

    DELETE detail
    FROM quality.learning_walk_details detail
    JOIN quality.activities activity ON activity.id = detail.activity_id
    JOIN #volume_records record ON record.id = activity.record_id;

    DELETE detail
    FROM quality.work_scrutiny_details detail
    JOIN quality.activities activity ON activity.id = detail.activity_id
    JOIN #volume_records record ON record.id = activity.record_id;

    DELETE activity
    FROM quality.activities activity
    JOIN #volume_records record ON record.id = activity.record_id;

    DELETE session
    FROM quality.coaching_sessions session
    JOIN #volume_records record ON record.id = session.record_id;

    DELETE cycle
    FROM quality.coaching_cycles cycle
    JOIN #volume_coaching_cycles volume_cycle ON volume_cycle.cycle_id = cycle.id;

    DELETE attendance
    FROM cpd.cpd_attendance attendance
    JOIN cpd.cpd_events event ON event.id = attendance.cpd_event_id
    JOIN #volume_records record ON record.id = event.record_id;

    DELETE event
    FROM cpd.cpd_events event
    JOIN #volume_records record ON record.id = event.record_id;

    DELETE FROM core.records
    WHERE id IN (SELECT id FROM #volume_records);

    DELETE FROM curriculum.courses
    WHERE source_system = N'TLQS_DASHBOARD_VOLUME_TEST'
      AND academic_year = N'2025/26';

    COMMIT TRANSACTION;
    PRINT 'The 2025/26 dashboard volume fixture was removed.';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
