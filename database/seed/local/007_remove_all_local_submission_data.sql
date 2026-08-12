SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

/*
   Local release reset. This deliberately removes submitted/transactional data
   while preserving accounts, organisation structure, form definitions,
   configurable lists, rooms, courses and system assets.
*/
BEGIN TRY
    BEGIN TRANSACTION;

    DELETE FROM ops.message_delivery_attempts;
    DELETE FROM ops.message_outbox_recipients;
    DELETE FROM ops.message_outbox;
    DELETE FROM ops.notifications;
    DELETE FROM ops.export_jobs;
    DELETE FROM ops.domain_events;
    DELETE FROM ops.audit_logs;

    DELETE FROM evidence.file_attachments;
    DELETE FROM evidence.evidence_items;
    DELETE FROM evidence.file_assets;

    DELETE FROM quality.staff_reflection_development_areas;
    DELETE FROM quality.staff_reflection_focus_areas;
    DELETE FROM quality.staff_reflections;

    DELETE FROM quality.coaching_action_reviews;
    DELETE FROM quality.coaching_previous_action_updates;
    DELETE FROM quality.elevate_environment_action_links;
    DELETE FROM quality.elevate_practice_development_plans;
    DELETE FROM quality.action_extensions;
    DELETE FROM quality.actions;

    UPDATE quality.probation_observations SET linked_liv_record_id = NULL;

    DELETE FROM quality.probation_observation_ratings;
    DELETE FROM quality.probation_observation_visits;
    DELETE FROM quality.probation_observation_stages;
    DELETE FROM quality.probation_case_reviewers;
    DELETE FROM quality.probation_observations;
    DELETE FROM quality.probation_cases;

    DELETE FROM quality.liv_visit_ratings;
    DELETE FROM quality.liv_stages;
    DELETE FROM quality.liv_visits;
    DELETE FROM quality.liv_cycles;
    DELETE FROM quality.liv_record_themes;
    DELETE FROM quality.liv_records;

    DELETE FROM quality.elevate_practice_selections;
    DELETE FROM quality.elevate_practice_reflections;
    DELETE FROM quality.elevate_practice_ratings;
    DELETE FROM quality.elevate_practice_area_ratings;
    DELETE FROM quality.elevate_practice_liv_information;
    DELETE FROM quality.elevate_practice_assessments;

    DELETE FROM quality.elevate_environment_pillar_ratings;
    DELETE FROM quality.elevate_environment_assessments;
    DELETE FROM quality.learning_walk_record_themes;
    DELETE FROM quality.learning_walk_details;
    DELETE FROM quality.work_scrutiny_course_samples;
    DELETE FROM quality.work_scrutiny_details;
    DELETE FROM quality.activities;

    DELETE FROM quality.coaching_sessions;
    DELETE FROM quality.coaching_cycles;
    DELETE FROM quality.coaching_assignments;

    DELETE FROM cpd.elevate_status_awards;
    DELETE FROM cpd.cpd_attendance;
    DELETE FROM cpd.cpd_events;

    DELETE FROM forms.form_responses;
    DELETE FROM forms.form_submissions;
    DELETE FROM core.records;

    COMMIT TRANSACTION;
    PRINT 'All local submission and workflow data was removed. Configuration and accounts were preserved.';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
