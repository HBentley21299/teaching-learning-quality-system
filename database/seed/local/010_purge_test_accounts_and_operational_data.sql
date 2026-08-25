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
   Local clean-room reset.

   Preserves:
   - Harry Bentley's staff and sign-in account, roles, access scopes and memberships.
   - Organisation structure and curriculum/configuration catalogues.
   - Form definitions and QA activity/question/template definitions.
   - System roles, permissions, modules, lookups, themes and assets.

   Removes:
   - Every other staff profile and sign-in account.
   - All submitted records, workflow data, QA reviews/evidence/actions, CPD,
     saved reports, files, notifications, audit logs and domain events.
*/
BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @harryStaffId uniqueidentifier;
    DECLARE @harryUserAccountId uniqueidentifier;

    SELECT @harryStaffId = staff.id
    FROM people.staff staff
    WHERE staff.id = '40000000-0000-0000-0000-000000000001'
      AND staff.external_id = N'STAFF_0001'
      AND staff.display_name = N'Harry Bentley'
      AND LOWER(staff.email) = N'harryjbentley@outlook.com';

    IF @harryStaffId IS NULL
        THROW 51000, 'Safety check failed: the protected Harry Bentley staff profile was not found.', 1;

    SELECT @harryUserAccountId = account.id
    FROM auth.user_accounts account
    WHERE account.staff_id = @harryStaffId;

    IF @harryUserAccountId IS NULL
        THROW 51000, 'Safety check failed: the protected Harry Bentley sign-in account was not found.', 1;

    IF (SELECT COUNT(*) FROM people.staff WHERE id = @harryStaffId) <> 1
       OR (SELECT COUNT(*) FROM auth.user_accounts WHERE id = @harryUserAccountId) <> 1
        THROW 51000, 'Safety check failed: the protected account is not unique.', 1;

    DECLARE @orgUnitCount int = (SELECT COUNT(*) FROM org.org_units);
    DECLARE @formTemplateCount int = (SELECT COUNT(*) FROM forms.form_templates);
    DECLARE @formVersionCount int = (SELECT COUNT(*) FROM forms.form_template_versions);
    DECLARE @qaActivityCount int = (SELECT COUNT(*) FROM qa.activity_types);
    DECLARE @qaTemplateCount int = (SELECT COUNT(*) FROM qa.activity_templates);
    DECLARE @qaQuestionCount int = (SELECT COUNT(*) FROM qa.questions);
    DECLARE @qaQuestionVersionCount int = (SELECT COUNT(*) FROM qa.question_versions);
    DECLARE @roleCount int = (SELECT COUNT(*) FROM auth.roles);
    DECLARE @permissionCount int = (SELECT COUNT(*) FROM auth.permissions);
    DECLARE @harryRoleCount int = (SELECT COUNT(*) FROM auth.user_roles WHERE user_account_id = @harryUserAccountId);
    DECLARE @harryScopeCount int = (SELECT COUNT(*) FROM auth.access_scopes WHERE user_account_id = @harryUserAccountId);
    DECLARE @harryMembershipCount int = (SELECT COUNT(*) FROM org.staff_org_memberships WHERE staff_id = @harryStaffId);

    SELECT staff.id
    INTO #targetStaff
    FROM people.staff staff
    WHERE staff.id <> @harryStaffId;

    SELECT account.id
    INTO #targetAccounts
    FROM auth.user_accounts account
    WHERE account.id <> @harryUserAccountId;

    DECLARE @removedStaffCount int = (SELECT COUNT(*) FROM #targetStaff);
    DECLARE @removedAccountCount int = (SELECT COUNT(*) FROM #targetAccounts);

    /* Delivery, notification, audit and per-user reporting data. */
    DELETE FROM ops.message_delivery_attempts;
    DELETE FROM ops.message_outbox_recipients;
    DELETE FROM ops.message_outbox;
    DELETE FROM ops.notifications;
    DELETE FROM ops.export_jobs;
    DELETE FROM ops.domain_events;
    DELETE FROM ops.audit_logs;
    DELETE FROM ops.data_import_runs;
    DELETE FROM reporting.saved_report_views;

    /* QA review instances. Question-bank and activity/template configuration stays. */
    DELETE FROM qa.action_group_assignments;
    DELETE FROM qa.action_group_teams;
    DELETE FROM qa.action_groups;
    DELETE FROM qa.dashboard_snapshots;
    DELETE FROM qa.evidence_team_scopes;
    DELETE FROM qa.evidence_responses;
    DELETE FROM qa.evidence_revisions;
    DELETE FROM qa.evidence_submissions;
    DELETE FROM qa.review_question_selections;
    DELETE FROM qa.review_questions;
    DELETE FROM qa.review_contributors;
    DELETE FROM qa.review_scopes;
    DELETE FROM qa.review_activities;
    DELETE FROM qa.reviews;

    /* Evidence and reflections must be removed before their linked actions/assessments. */
    DELETE FROM quality.staff_reflection_development_areas;
    DELETE FROM quality.staff_reflection_focus_areas;
    DELETE FROM quality.staff_reflections;
    DELETE FROM evidence.file_attachments;
    DELETE FROM evidence.evidence_items;
    DELETE FROM ops.message_attachments;
    DELETE FROM evidence.file_assets;

    /* Central and workflow-linked actions. */
    DELETE FROM quality.coaching_action_reviews;
    DELETE FROM quality.coaching_previous_action_updates;
    DELETE FROM quality.elevate_environment_action_links;
    DELETE FROM quality.elevate_practice_development_plans;
    DELETE FROM quality.action_extensions;
    DELETE FROM quality.actions;

    /* Probation, LIV, coaching and activity records. */
    DELETE FROM quality.probation_observation_ratings;
    DELETE FROM quality.probation_observation_stages;
    DELETE FROM quality.probation_observation_visits;
    DELETE FROM quality.probation_case_reviewers;
    DELETE FROM quality.probation_observations;
    DELETE FROM quality.probation_cases;

    DELETE FROM quality.liv_visit_ratings;
    DELETE FROM quality.liv_stages;
    DELETE FROM quality.liv_visits;
    DELETE FROM quality.liv_cycles;
    DELETE FROM quality.liv_record_themes;
    DELETE FROM quality.liv_records;

    DELETE FROM quality.coaching_sessions;
    DELETE FROM quality.coaching_cycles;
    DELETE FROM quality.coaching_assignments;

    DELETE FROM quality.learning_walk_record_themes;
    DELETE FROM quality.work_scrutiny_course_samples;
    DELETE FROM quality.learning_walk_details;
    DELETE FROM quality.work_scrutiny_details;
    DELETE FROM quality.activities;

    /* Elevate assessment instances. Frameworks, areas, statements and rubrics stay. */
    DELETE FROM quality.elevate_practice_selections;
    DELETE FROM quality.elevate_practice_reflections;
    DELETE FROM quality.elevate_practice_ratings;
    DELETE FROM quality.elevate_practice_area_ratings;
    DELETE FROM quality.elevate_practice_liv_information;
    DELETE FROM quality.elevate_practice_assessments;
    DELETE FROM quality.elevate_environment_pillar_ratings;
    DELETE FROM quality.elevate_environment_assessments;

    /* CPD participation and generated awards. Badge definitions/assets stay. */
    DELETE FROM cpd.elevate_status_awards;
    DELETE FROM cpd.cpd_attendance;
    DELETE FROM cpd.cpd_events;

    /* Submitted form and platform record instances. Definitions stay. */
    DELETE FROM forms.form_responses;
    DELETE FROM forms.form_submissions;
    DELETE FROM core.records;

    /* Clear audit ownership on retained configuration if a removed account touched it. */
    UPDATE core.lookup_values
    SET created_by_user_account_id = CASE WHEN created_by_user_account_id IN (SELECT id FROM #targetAccounts) THEN NULL ELSE created_by_user_account_id END,
        updated_by_user_account_id = CASE WHEN updated_by_user_account_id IN (SELECT id FROM #targetAccounts) THEN NULL ELSE updated_by_user_account_id END;

    UPDATE core.theme_groups
    SET created_by_user_account_id = CASE WHEN created_by_user_account_id IN (SELECT id FROM #targetAccounts) THEN NULL ELSE created_by_user_account_id END,
        updated_by_user_account_id = CASE WHEN updated_by_user_account_id IN (SELECT id FROM #targetAccounts) THEN NULL ELSE updated_by_user_account_id END;

    UPDATE core.themes
    SET created_by_user_account_id = CASE WHEN created_by_user_account_id IN (SELECT id FROM #targetAccounts) THEN NULL ELSE created_by_user_account_id END,
        updated_by_user_account_id = CASE WHEN updated_by_user_account_id IN (SELECT id FROM #targetAccounts) THEN NULL ELSE updated_by_user_account_id END;

    UPDATE forms.form_template_versions
    SET created_by_user_account_id = NULL
    WHERE created_by_user_account_id IN (SELECT id FROM #targetAccounts);

    UPDATE qa.activity_templates
    SET created_by_user_account_id = NULL
    WHERE created_by_user_account_id IN (SELECT id FROM #targetAccounts);

    UPDATE qa.question_versions
    SET created_by_user_account_id = NULL
    WHERE created_by_user_account_id IN (SELECT id FROM #targetAccounts);

    UPDATE quality.coaching_configuration
    SET updated_by_user_account_id = NULL
    WHERE updated_by_user_account_id IN (SELECT id FROM #targetAccounts);

    UPDATE quality.learning_walk_themes
    SET created_by_user_account_id = CASE WHEN created_by_user_account_id IN (SELECT id FROM #targetAccounts) THEN NULL ELSE created_by_user_account_id END,
        updated_by_user_account_id = CASE WHEN updated_by_user_account_id IN (SELECT id FROM #targetAccounts) THEN NULL ELSE updated_by_user_account_id END;

    UPDATE ops.message_template_versions
    SET created_by_user_account_id = NULL
    WHERE created_by_user_account_id IN (SELECT id FROM #targetAccounts);

    UPDATE ops.message_templates
    SET created_by_user_account_id = CASE WHEN created_by_user_account_id IN (SELECT id FROM #targetAccounts) THEN NULL ELSE created_by_user_account_id END,
        updated_by_user_account_id = CASE WHEN updated_by_user_account_id IN (SELECT id FROM #targetAccounts) THEN NULL ELSE updated_by_user_account_id END;

    UPDATE ops.messaging_configuration
    SET updated_by_user_account_id = NULL
    WHERE updated_by_user_account_id IN (SELECT id FROM #targetAccounts);

    UPDATE org.org_unit_code_aliases
    SET created_by_user_account_id = NULL
    WHERE created_by_user_account_id IN (SELECT id FROM #targetAccounts);

    UPDATE org.org_units
    SET updated_by_user_account_id = NULL
    WHERE updated_by_user_account_id IN (SELECT id FROM #targetAccounts);

    UPDATE cpd.elevate_status_badge_assets
    SET uploaded_by_user_account_id = @harryUserAccountId,
        archived_by_user_account_id = CASE WHEN archived_by_user_account_id IN (SELECT id FROM #targetAccounts) THEN NULL ELSE archived_by_user_account_id END
    WHERE uploaded_by_user_account_id IN (SELECT id FROM #targetAccounts)
       OR archived_by_user_account_id IN (SELECT id FROM #targetAccounts);

    /* Remove account/profile assignments while retaining Harry's access. */
    DELETE FROM org.migration_review_items;
    DELETE FROM org.org_unit_leaderships;
    DELETE FROM org.staff_manager_relationships;

    UPDATE org.staff_org_memberships
    SET replacement_membership_id = NULL
    WHERE replacement_membership_id IN (
        SELECT membership.id
        FROM org.staff_org_memberships membership
        JOIN #targetStaff target ON target.id = membership.staff_id
    );

    UPDATE org.staff_org_memberships
    SET created_by_user_account_id = CASE WHEN created_by_user_account_id IN (SELECT id FROM #targetAccounts) THEN NULL ELSE created_by_user_account_id END,
        updated_by_user_account_id = CASE WHEN updated_by_user_account_id IN (SELECT id FROM #targetAccounts) THEN NULL ELSE updated_by_user_account_id END
    WHERE staff_id = @harryStaffId;

    DELETE membership
    FROM org.staff_org_memberships membership
    JOIN #targetStaff target ON target.id = membership.staff_id;

    DELETE scope
    FROM auth.access_scopes scope
    WHERE scope.user_account_id IN (SELECT id FROM #targetAccounts)
       OR scope.staff_id IN (SELECT id FROM #targetStaff);

    DELETE role_assignment
    FROM auth.user_roles role_assignment
    JOIN #targetAccounts target ON target.id = role_assignment.user_account_id;

    DELETE identity_row
    FROM auth.auth_identities identity_row
    JOIN #targetAccounts target ON target.id = identity_row.user_account_id;

    UPDATE auth.local_credentials
    SET user_account_id = @harryUserAccountId,
        updated_by_user_account_id = CASE WHEN updated_by_user_account_id IN (SELECT id FROM #targetAccounts) THEN NULL ELSE updated_by_user_account_id END
    WHERE LOWER(email) = N'harryjbentley@outlook.com';

    DELETE FROM auth.local_credentials
    WHERE LOWER(email) <> N'harryjbentley@outlook.com';

    UPDATE people.staff SET line_manager_staff_id = NULL;

    DELETE account
    FROM auth.user_accounts account
    JOIN #targetAccounts target ON target.id = account.id;

    DELETE staff
    FROM people.staff staff
    JOIN #targetStaff target ON target.id = staff.id;

    /* Post-conditions: only Harry remains and retained configuration is unchanged. */
    IF (SELECT COUNT(*) FROM people.staff) <> 1
       OR NOT EXISTS (SELECT 1 FROM people.staff WHERE id = @harryStaffId)
       OR (SELECT COUNT(*) FROM auth.user_accounts) <> 1
       OR NOT EXISTS (SELECT 1 FROM auth.user_accounts WHERE id = @harryUserAccountId AND staff_id = @harryStaffId)
        THROW 51000, 'Safety check failed: account cleanup did not leave exactly the protected Harry account.', 1;

    IF (SELECT COUNT(*) FROM core.records) <> 0
       OR (SELECT COUNT(*) FROM quality.actions) <> 0
       OR (SELECT COUNT(*) FROM qa.reviews) <> 0
       OR (SELECT COUNT(*) FROM qa.evidence_submissions) <> 0
       OR (SELECT COUNT(*) FROM forms.form_submissions) <> 0
       OR (SELECT COUNT(*) FROM cpd.cpd_events) <> 0
        THROW 51000, 'Safety check failed: one or more operational record types remains.', 1;

    IF (SELECT COUNT(*) FROM org.org_units) <> @orgUnitCount
       OR (SELECT COUNT(*) FROM forms.form_templates) <> @formTemplateCount
       OR (SELECT COUNT(*) FROM forms.form_template_versions) <> @formVersionCount
       OR (SELECT COUNT(*) FROM qa.activity_types) <> @qaActivityCount
       OR (SELECT COUNT(*) FROM qa.activity_templates) <> @qaTemplateCount
       OR (SELECT COUNT(*) FROM qa.questions) <> @qaQuestionCount
       OR (SELECT COUNT(*) FROM qa.question_versions) <> @qaQuestionVersionCount
       OR (SELECT COUNT(*) FROM auth.roles) <> @roleCount
       OR (SELECT COUNT(*) FROM auth.permissions) <> @permissionCount
       OR (SELECT COUNT(*) FROM auth.user_roles WHERE user_account_id = @harryUserAccountId) <> @harryRoleCount
       OR (SELECT COUNT(*) FROM auth.access_scopes WHERE user_account_id = @harryUserAccountId) <> @harryScopeCount
       OR (SELECT COUNT(*) FROM org.staff_org_memberships WHERE staff_id = @harryStaffId) <> @harryMembershipCount
        THROW 51000, 'Safety check failed: protected configuration or Harry access changed during cleanup.', 1;

    COMMIT TRANSACTION;

    PRINT CONCAT(
        'Local clean-room reset complete. Removed ', @removedStaffCount,
        ' staff profiles and ', @removedAccountCount,
        ' sign-in accounts; preserved Harry Bentley and all protected configuration.'
    );
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
