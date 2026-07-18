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

    DECLARE @recordIds TABLE (id uniqueidentifier PRIMARY KEY);
    INSERT INTO @recordIds (id) VALUES
        ('F1000000-0000-0000-0000-000000000016'),
        ('F1000000-0000-0000-0000-000000000101'),
        ('F1000000-0000-0000-0000-000000000102'),
        ('F1000000-0000-0000-0000-000000000103'),
        ('F1000000-0000-0000-0000-000000000104'),
        ('F1000000-0000-0000-0000-000000000105'),
        ('F1000000-0000-0000-0000-000000000106');

    DECLARE @number int = 1;
    WHILE @number <= 15
    BEGIN
        INSERT INTO @recordIds (id)
        VALUES (CONVERT(uniqueidentifier, CONCAT(N'F1000000-0000-0000-0000-', RIGHT(CONCAT(N'000000000000', @number), 12))));
        SET @number += 1;
    END;

    DECLARE @actionIds TABLE (id uniqueidentifier PRIMARY KEY);
    INSERT INTO @actionIds (id) VALUES
        ('FA000000-0000-0000-0000-000000000001'),
        ('FA000000-0000-0000-0000-000000000002'),
        ('FA000000-0000-0000-0000-000000000003'),
        ('FA000000-0000-0000-0000-000000000004'),
        ('FA000000-0000-0000-0000-000000000005'),
        ('FA000000-0000-0000-0000-000000000006');

    DELETE FROM ops.audit_logs WHERE record_id IN (SELECT id FROM @recordIds) OR entity_id IN (SELECT id FROM @actionIds);
    DELETE FROM evidence.evidence_items WHERE id = 'FB000000-0000-0000-0000-000000000001';
    DELETE FROM cpd.elevate_status_awards WHERE id IN (
        'FC000000-0000-0000-0000-000000000001', 'FC000000-0000-0000-0000-000000000002',
        'FC000000-0000-0000-0000-000000000003', 'FC000000-0000-0000-0000-000000000004',
        'FC000000-0000-0000-0000-000000000005'
    );
    DELETE FROM quality.coaching_action_reviews WHERE action_id IN (SELECT id FROM @actionIds) OR revised_action_id IN (SELECT id FROM @actionIds);
    DELETE FROM quality.coaching_previous_action_updates WHERE action_id IN (SELECT id FROM @actionIds);
    DELETE FROM quality.elevate_environment_action_links WHERE action_id IN (SELECT id FROM @actionIds);
    DELETE FROM quality.action_extensions WHERE action_id IN (SELECT id FROM @actionIds);
    DELETE FROM quality.actions WHERE id IN (SELECT id FROM @actionIds);

    DELETE FROM quality.probation_observation_ratings WHERE probation_observation_id IN (
        'F6000000-0000-0000-0000-000000000611', 'F6000000-0000-0000-0000-000000000612', 'F6000000-0000-0000-0000-000000000613'
    );
    DELETE FROM quality.probation_observation_stages WHERE probation_observation_id IN (
        'F6000000-0000-0000-0000-000000000611', 'F6000000-0000-0000-0000-000000000612', 'F6000000-0000-0000-0000-000000000613'
    );
    DELETE FROM quality.probation_observation_visits WHERE probation_observation_id IN (
        'F6000000-0000-0000-0000-000000000611', 'F6000000-0000-0000-0000-000000000612', 'F6000000-0000-0000-0000-000000000613'
    );
    DELETE FROM quality.probation_case_reviewers WHERE probation_case_id = 'F6000000-0000-0000-0000-000000000601';
    DELETE FROM quality.probation_observations WHERE probation_case_id = 'F6000000-0000-0000-0000-000000000601';
    DELETE FROM quality.probation_cases WHERE id = 'F6000000-0000-0000-0000-000000000601';

    DELETE FROM quality.liv_visit_ratings WHERE visit_id = 'F6000000-0000-0000-0000-000000000503';
    DELETE FROM quality.liv_stages WHERE liv_cycle_id = 'F6000000-0000-0000-0000-000000000502';
    DELETE FROM quality.liv_visits WHERE liv_record_id = 'F6000000-0000-0000-0000-000000000501';
    DELETE FROM quality.liv_cycles WHERE liv_record_id = 'F6000000-0000-0000-0000-000000000501';
    DELETE FROM quality.liv_record_themes WHERE liv_record_id = 'F6000000-0000-0000-0000-000000000501';
    DELETE FROM quality.liv_records WHERE id = 'F6000000-0000-0000-0000-000000000501';

    DELETE FROM quality.coaching_action_reviews WHERE session_id = 'F6000000-0000-0000-0000-000000000402';
    DELETE FROM quality.coaching_previous_action_updates WHERE session_id = 'F6000000-0000-0000-0000-000000000402';
    DELETE FROM quality.coaching_sessions WHERE id = 'F6000000-0000-0000-0000-000000000402';
    DELETE FROM quality.coaching_cycles WHERE id = 'F6000000-0000-0000-0000-000000000401';

    DELETE FROM quality.learning_walk_record_themes WHERE record_id IN (SELECT id FROM @recordIds);
    DELETE FROM quality.learning_walk_details WHERE activity_id IN (SELECT id FROM quality.activities WHERE record_id IN (SELECT id FROM @recordIds));
    DELETE FROM quality.work_scrutiny_course_samples WHERE record_id IN (SELECT id FROM @recordIds);
    DELETE FROM quality.work_scrutiny_details WHERE activity_id IN (SELECT id FROM quality.activities WHERE record_id IN (SELECT id FROM @recordIds));
    DELETE FROM quality.activities WHERE record_id IN (SELECT id FROM @recordIds);
    DELETE FROM quality.elevate_environment_assessments WHERE record_id IN (SELECT id FROM @recordIds);

    DELETE FROM cpd.cpd_attendance WHERE cpd_event_id IN (SELECT id FROM cpd.cpd_events WHERE record_id IN (SELECT id FROM @recordIds));
    DELETE FROM cpd.cpd_events WHERE record_id IN (SELECT id FROM @recordIds);
    DELETE FROM forms.form_responses WHERE form_submission_id IN (SELECT id FROM forms.form_submissions WHERE record_id IN (SELECT id FROM @recordIds));
    DELETE FROM forms.form_submissions WHERE record_id IN (SELECT id FROM @recordIds);
    DELETE FROM core.records WHERE id IN (SELECT id FROM @recordIds);

    COMMIT TRANSACTION;
    PRINT 'Harry Bentley local visibility test data removed.';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
