using System.Data;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    public async Task<ProbationConfigurationSummary> GetProbationConfigurationAsync(
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        var liv = await GetLivConfigurationAsync(cancellationToken);
        var reviewers = await QueryAsync(
            """
            SELECT DISTINCT staff.id, staff.display_name, staff.email, N'teaching_learning'
            FROM people.staff staff
            JOIN auth.user_accounts account ON account.staff_id = staff.id
              AND account.account_status = N'active' AND account.is_disabled = 0 AND account.archived_at IS NULL
            JOIN auth.user_roles user_role ON user_role.user_account_id = account.id
              AND user_role.active_from <= sysutcdatetime()
              AND (user_role.active_to IS NULL OR user_role.active_to > sysutcdatetime())
            JOIN auth.roles role ON role.id = user_role.role_id AND role.is_active = 1 AND role.archived_at IS NULL
            WHERE staff.archived_at IS NULL AND staff.account_status = N'active'
              AND role.role_key = N'teaching_learning_team'
            ORDER BY staff.display_name;
            """,
            reader => new ProbationReviewerOptionSummary(
                reader.GetGuid(0), reader.GetString(1), reader.GetString(2), reader.GetString(3)),
            cancellationToken);

        var roleKeys = currentUser.UserAccountId.HasValue
            ? await GetActiveProbationCreatorRolesAsync(currentUser.UserAccountId.Value, cancellationToken)
            : [];
        var canCreateCase = currentUser.StaffId.HasValue
            && currentUser.UserAccountId.HasValue
            && (currentUser.HasPermission(PermissionKeys.ProbationSubmit)
                || currentUser.HasPermission(PermissionKeys.ProbationManage))
            && ProbationObservationWorkflow.CanCreateCase(roleKeys);
        var eligibleStaff = canCreateCase
            ? await GetProbationEligibleStaffAsync(
                currentUser,
                ProbationObservationWorkflow.CanSelectAnyStaff(roleKeys),
                cancellationToken)
            : [];

        return new ProbationConfigurationSummary(
            liv.DeliveryAreas,
            liv.FocusAreas.Where(option => !option.IsOther).ToArray(),
            liv.DevelopmentOpportunities,
            liv.Rubric,
            reviewers,
            eligibleStaff,
            canCreateCase);
    }

    private Task<IReadOnlyList<string>> GetActiveProbationCreatorRolesAsync(
        Guid userAccountId,
        CancellationToken cancellationToken) =>
        QueryAsync(
            """
            SELECT DISTINCT role.role_key
            FROM auth.user_roles user_role
            JOIN auth.roles role ON role.id = user_role.role_id
              AND role.is_active = 1 AND role.archived_at IS NULL
            WHERE user_role.user_account_id = @userAccountId
              AND user_role.active_from <= sysutcdatetime()
              AND (user_role.active_to IS NULL OR user_role.active_to > sysutcdatetime());
            """,
            command => command.Parameters.AddWithValue("@userAccountId", userAccountId),
            reader => reader.GetString(0),
            cancellationToken);

    private Task<IReadOnlyList<StaffSummary>> GetProbationEligibleStaffAsync(
        CurrentUser currentUser,
        bool canSelectAnyStaff,
        CancellationToken cancellationToken) =>
        QueryAsync(
            """
            SELECT staff.id, staff.external_id, staff.display_name, staff.email, staff.job_title,
                   staff.primary_org_unit_id, staff.account_status, memberships.org_unit_ids
            FROM people.staff staff
            OUTER APPLY (
                SELECT STRING_AGG(CONVERT(nvarchar(36), membership.org_unit_id), N'|') AS org_unit_ids
                FROM (
                    SELECT DISTINCT staff_membership.org_unit_id
                    FROM org.staff_org_memberships staff_membership
                    WHERE staff_membership.staff_id = staff.id AND staff_membership.archived_at IS NULL
                ) membership
            ) memberships
            WHERE staff.archived_at IS NULL AND staff.account_status = N'active'
              AND staff.id <> @currentStaffId
              AND (
                  @canSelectAnyStaff = 1
                  OR EXISTS (
                      SELECT 1 FROM org.fn_visible_staff(@currentUserAccountId) visible
                      WHERE visible.staff_id = staff.id
                  )
              )
            ORDER BY staff.display_name;
            """,
            command =>
            {
                command.Parameters.AddWithValue("@currentStaffId", currentUser.StaffId!.Value);
                command.Parameters.AddWithValue("@currentUserAccountId", currentUser.UserAccountId!.Value);
                command.Parameters.AddWithValue("@canSelectAnyStaff", canSelectAnyStaff);
            },
            reader => new StaffSummary(
                reader.GetGuid(0), reader.GetString(1), reader.GetString(2), reader.GetString(3),
                GetStringOrNull(reader, 4), GetGuidOrNull(reader, 5), reader.GetString(6),
                ParseGuidValues(GetStringOrNull(reader, 7))),
            cancellationToken);

    public async Task<ProbationStaffContextSummary?> GetProbationStaffContextAsync(
        Guid staffId,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        var canViewAll = currentUser.HasPermission(PermissionKeys.ProbationManage)
            || currentUser.HasPermission(PermissionKeys.ReportsViewAll);
        var academicYear = GetCurrentAcademicYear();
        var rows = await QueryAsync(
            """
            SELECT staff.id, staff.display_name, assessment.id, assessment.record_id,
                   assessment.academic_year, primary_focus.display_name,
                   CASE WHEN secondary_focus.value_key = N'other'
                        THEN COALESCE(information.secondary_focus_other, secondary_focus.display_name)
                        ELSE secondary_focus.display_name END,
                   information.desired_outcome,
                   CASE WHEN EXISTS (
                       SELECT 1 FROM quality.probation_cases active_case
                       WHERE active_case.subject_staff_id = staff.id
                         AND active_case.status = N'in_progress' AND active_case.archived_at IS NULL
                   ) THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END
            FROM people.staff staff
            OUTER APPLY (
                SELECT TOP (1) source.id, source.record_id, source.academic_year
                FROM quality.elevate_practice_assessments source
                WHERE source.staff_id = staff.id AND source.status = N'submitted' AND source.archived_at IS NULL
                  AND source.academic_year = @academicYear
                ORDER BY source.submitted_at DESC
            ) assessment
            LEFT JOIN quality.elevate_practice_liv_information information ON information.assessment_id = assessment.id
            LEFT JOIN core.lookup_values primary_focus ON primary_focus.id = information.primary_focus_lookup_value_id
            LEFT JOIN core.lookup_values secondary_focus ON secondary_focus.id = information.secondary_focus_lookup_value_id
            WHERE staff.id = @staffId AND staff.archived_at IS NULL
              AND (
                  @canViewAll = 1 OR staff.id = @currentStaffId
                  OR EXISTS (
                      SELECT 1 FROM org.fn_visible_staff(@currentUserAccountId) visible
                      WHERE visible.staff_id = staff.id
                  )
              );
            """,
            command =>
            {
                command.Parameters.AddWithValue("@staffId", staffId);
                command.Parameters.AddWithValue("@academicYear", academicYear);
                command.Parameters.AddWithValue("@canViewAll", canViewAll);
                command.Parameters.AddWithValue("@currentStaffId", ToDbValue(currentUser.StaffId));
                command.Parameters.AddWithValue("@currentUserAccountId", ToDbValue(currentUser.UserAccountId));
            },
            reader => new ProbationStaffContextSummary(
                reader.GetGuid(0), reader.GetString(1), GetGuidOrNull(reader, 2), GetGuidOrNull(reader, 3),
                GetStringOrNull(reader, 4), GetStringOrNull(reader, 5), GetStringOrNull(reader, 6),
                GetStringOrNull(reader, 7), reader.GetBoolean(8)),
            cancellationToken);
        return rows.FirstOrDefault();
    }

    public async Task<IReadOnlyList<ProbationCaseSummary>> GetProbationCasesAsync(
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        var canViewAll = currentUser.HasPermission(PermissionKeys.ProbationManage)
            || currentUser.HasPermission(PermissionKeys.ReportsViewAll);
        var canViewScoped = currentUser.HasPermission(PermissionKeys.ProbationSubmit);
        var caseRows = await QueryAsync(
            """
            SELECT probation.id, probation.record_id, probation.subject_staff_id, subject.display_name,
                   probation.org_unit_id, area.code, parent.code, probation.academic_year,
                   probation.status, probation.current_observation_number,
                   probation.source_elevate_assessment_id, assessment.record_id,
                   probation.created_at, probation.updated_at,
                   CASE WHEN probation.status = N'in_progress' AND (
                       @canManage = 1 OR probation.created_by_user_account_id = @currentUserAccountId
                       OR EXISTS (
                           SELECT 1 FROM quality.probation_case_reviewers reviewer
                           WHERE reviewer.probation_case_id = probation.id AND reviewer.staff_id = @currentStaffId
                       )
                   ) THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END
            FROM quality.probation_cases probation
            JOIN people.staff subject ON subject.id = probation.subject_staff_id
            LEFT JOIN org.org_units area ON area.id = probation.org_unit_id
            LEFT JOIN org.org_units parent ON parent.id = area.parent_org_unit_id
            LEFT JOIN quality.elevate_practice_assessments assessment ON assessment.id = probation.source_elevate_assessment_id
            WHERE probation.archived_at IS NULL
              AND (
                  @canViewAll = 1 OR probation.subject_staff_id = @currentStaffId
                  OR probation.created_by_user_account_id = @currentUserAccountId
                  OR EXISTS (
                      SELECT 1 FROM quality.probation_case_reviewers reviewer
                      WHERE reviewer.probation_case_id = probation.id AND reviewer.staff_id = @currentStaffId
                  )
                  OR (@canViewScoped = 1 AND (
                      EXISTS (SELECT 1 FROM org.fn_visible_staff(@currentUserAccountId) visible WHERE visible.staff_id = probation.subject_staff_id)
                      OR EXISTS (SELECT 1 FROM org.fn_visible_org_units(@currentUserAccountId) visible WHERE visible.org_unit_id = probation.org_unit_id)
                  ))
              )
            ORDER BY COALESCE(probation.updated_at, probation.created_at) DESC;
            """,
            command =>
            {
                command.Parameters.AddWithValue("@canManage", currentUser.HasPermission(PermissionKeys.ProbationManage));
                command.Parameters.AddWithValue("@canViewAll", canViewAll);
                command.Parameters.AddWithValue("@canViewScoped", canViewScoped);
                command.Parameters.AddWithValue("@currentStaffId", ToDbValue(currentUser.StaffId));
                command.Parameters.AddWithValue("@currentUserAccountId", ToDbValue(currentUser.UserAccountId));
            },
            reader => new ProbationCaseRow(
                reader.GetGuid(0), reader.GetGuid(1), reader.GetGuid(2), reader.GetString(3),
                GetGuidOrNull(reader, 4), GetStringOrNull(reader, 5), GetStringOrNull(reader, 6),
                reader.GetString(7), reader.GetString(8), reader.GetByte(9), GetGuidOrNull(reader, 10),
                GetGuidOrNull(reader, 11), reader.GetFieldValue<DateTimeOffset>(12),
                GetDateTimeOffsetOrNull(reader, 13), reader.GetBoolean(14)),
            cancellationToken);
        if (caseRows.Count == 0) return [];

        var caseIds = caseRows.Select(row => row.Id).ToHashSet();
        var reviewers = await QueryAsync(
            """
            SELECT reviewer.probation_case_id, reviewer.staff_id, staff.display_name, reviewer.reviewer_role
            FROM quality.probation_case_reviewers reviewer
            JOIN people.staff staff ON staff.id = reviewer.staff_id;
            """,
            reader => new ProbationReviewerRow(
                reader.GetGuid(0), new ProbationReviewerSummary(reader.GetGuid(1), reader.GetString(2), reader.GetString(3))),
            cancellationToken);
        var observations = await QueryAsync(
            """
            SELECT observation.probation_case_id, observation.id, observation.observation_number,
                   observation.observation_type, observation.status, observation.linked_liv_record_id,
                   liv.record_id, observation.started_at, observation.completed_at
            FROM quality.probation_observations observation
            LEFT JOIN quality.liv_records liv ON liv.id = observation.linked_liv_record_id
            ORDER BY observation.probation_case_id, observation.observation_number;
            """,
            reader => new ProbationObservationRow(
                reader.GetGuid(0), reader.GetGuid(1), reader.GetByte(2), reader.GetString(3), reader.GetString(4),
                GetGuidOrNull(reader, 5), GetGuidOrNull(reader, 6), GetDateTimeOffsetOrNull(reader, 7),
                GetDateTimeOffsetOrNull(reader, 8)),
            cancellationToken);
        var stages = await QueryAsync(
            """
            SELECT stage.probation_observation_id, stage.id, stage.stage_type, stage.stage_order,
                   stage.stage_status, stage.context_text, stage.aims_text, stage.learner_activity_text,
                   stage.reflection_text, stage.development_opportunity_keys_json,
                   stage.intended_next_observation_date
            FROM quality.probation_observation_stages stage
            ORDER BY stage.probation_observation_id, stage.stage_order;
            """,
            reader => new ProbationStageRow(
                reader.GetGuid(0), reader.GetGuid(1), reader.GetString(2), reader.GetByte(3), reader.GetString(4),
                GetStringOrNull(reader, 5), GetStringOrNull(reader, 6), GetStringOrNull(reader, 7),
                GetStringOrNull(reader, 8), ParseLivStringList(GetStringOrNull(reader, 9)), GetDateOnlyOrNull(reader, 10)),
            cancellationToken);
        var visits = await QueryAsync(
            """
            SELECT visit.probation_observation_id, delivery.value_key, delivery.display_name,
                   visit.observation_date, CONVERT(nvarchar(5), visit.observation_time, 108),
                   visit.course_name, visit.course_group, visit.course_level, visit.key_points
            FROM quality.probation_observation_visits visit
            LEFT JOIN core.lookup_values delivery ON delivery.id = visit.delivery_area_lookup_value_id;
            """,
            reader => new ProbationVisitRow(
                reader.GetGuid(0), GetStringOrNull(reader, 1), GetStringOrNull(reader, 2),
                GetDateOnlyOrNull(reader, 3), GetStringOrNull(reader, 4), GetStringOrNull(reader, 5),
                GetStringOrNull(reader, 6), GetStringOrNull(reader, 7), GetStringOrNull(reader, 8)),
            cancellationToken);
        var ratings = await QueryAsync(
            """
            SELECT rating.probation_observation_id, focus.value_key, focus.display_name,
                   descriptor.id, descriptor.visible_wording, rating.evidence_of_practice
            FROM quality.probation_observation_ratings rating
            JOIN core.lookup_values focus ON focus.id = rating.focus_lookup_value_id
            JOIN quality.elevate_practice_rubric_descriptors descriptor ON descriptor.id = rating.descriptor_id;
            """,
            reader => new ProbationRatingRow(
                reader.GetGuid(0), new ProbationRatingSummary(
                    reader.GetString(1), reader.GetString(2), reader.GetGuid(3), reader.GetString(4), GetStringOrNull(reader, 5))),
            cancellationToken);

        var observationsByCase = observations.Where(row => caseIds.Contains(row.CaseId))
            .GroupBy(row => row.CaseId)
            .ToDictionary(group => group.Key, group => (IReadOnlyList<ProbationObservationSummary>)group.Select(row =>
            {
                var rowStages = stages.Where(stage => stage.ObservationId == row.Id)
                    .Select(stage => new ProbationStageSummary(
                        stage.Id, stage.StageType, stage.StageOrder, stage.StageStatus, stage.ContextText,
                        stage.AimsText, stage.LearnerActivityText, stage.ReflectionText,
                        stage.DevelopmentOpportunityKeys, stage.IntendedNextObservationDate,
                        caseRows.First(item => item.Id == row.CaseId).CanEdit
                            && caseRows.First(item => item.Id == row.CaseId).CurrentObservationNumber == row.ObservationNumber))
                    .ToArray();
                var visit = visits.FirstOrDefault(item => item.ObservationId == row.Id);
                return new ProbationObservationSummary(
                    row.Id, row.ObservationNumber, row.ObservationType, row.Status, row.LinkedLivRecordId,
                    row.LinkedLivSourceRecordId, row.StartedAt, row.CompletedAt, rowStages,
                    visit is null ? null : new ProbationVisitSummary(
                        visit.DeliveryAreaKey, visit.DeliveryAreaName, visit.ObservationDate, visit.ObservationTime,
                        visit.CourseName, visit.CourseGroup, visit.CourseLevel, visit.KeyPoints,
                        ratings.Where(rating => rating.ObservationId == row.Id).Select(rating => rating.Rating).ToArray()));
            }).OrderBy(item => item.ObservationNumber).ToArray());

        return caseRows.Select(row => new ProbationCaseSummary(
            row.Id, row.RecordId, row.SubjectStaffId, row.SubjectStaffName, row.OrgUnitId, row.OrgUnitCode,
            row.ParentOrgUnitCode, row.AcademicYear, row.Status, row.CurrentObservationNumber,
            row.SourceElevateAssessmentId, row.SourceElevateRecordId, row.CreatedAt, row.UpdatedAt, row.CanEdit,
            reviewers.Where(reviewer => reviewer.CaseId == row.Id).Select(reviewer => reviewer.Reviewer).ToArray(),
            observationsByCase.GetValueOrDefault(row.Id, []))).ToArray();
    }

    public async Task<Guid> CreateProbationCaseAsync(
        CreateProbationCaseRequest request,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        if (request.SubjectStaffId == Guid.Empty) throw new WorkflowValidationException("Select the staff member being observed.");
        if (!currentUser.StaffId.HasValue || !currentUser.UserAccountId.HasValue)
            throw new WorkflowValidationException("Your account must be linked to an active staff record before creating a probationary observation.");
        if (request.TeachingLearningReviewerStaffId == Guid.Empty)
            throw new WorkflowValidationException("The optional Teaching and Learning reviewer is not valid.");
        if (request.TeachingLearningReviewerStaffId.HasValue
            && request.TeachingLearningReviewerStaffId.Value == currentUser.StaffId.Value)
            throw new WorkflowValidationException("The lead reviewer and optional Teaching and Learning reviewer must be different staff members.");

        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);
        try
        {
            await ValidateProbationCreatorScopeAsync(
                connection,
                transaction,
                request.SubjectStaffId,
                currentUser.UserAccountId.Value,
                currentUser.StaffId.Value,
                cancellationToken);
            if (request.TeachingLearningReviewerStaffId.HasValue)
                await ValidateProbationReviewerAsync(connection, transaction, request.TeachingLearningReviewerStaffId.Value, "teaching_learning", cancellationToken);
            var moduleId = await GetModuleIdAsync(connection, transaction, "probation_observations", cancellationToken);
            var academicYear = GetCurrentAcademicYear();
            var caseId = Guid.NewGuid();
            var recordId = Guid.NewGuid();
            var observationOneId = Guid.NewGuid();
            var observationTwoId = Guid.NewGuid();
            var observationThreeId = Guid.NewGuid();

            await using (var command = new SqlCommand(
                """
                DECLARE @assessmentId uniqueidentifier = (
                    SELECT TOP (1) assessment.id
                    FROM quality.elevate_practice_assessments assessment
                    WHERE assessment.staff_id = @subjectStaffId AND assessment.status = N'submitted'
                      AND assessment.archived_at IS NULL AND assessment.academic_year = @academicYear
                    ORDER BY assessment.submitted_at DESC
                );

                INSERT INTO core.records (
                    id, module_id, record_type, title, summary, subject_staff_id, owner_staff_id,
                    org_unit_id, record_date, created_by_user_account_id
                )
                SELECT @recordId, @moduleId, N'probation_case', N'Probationary Observations - ' + staff.display_name,
                       N'Three-observation probation cycle', staff.id, @ownerStaffId,
                       COALESCE(@orgUnitId, staff.primary_org_unit_id), CONVERT(date, sysutcdatetime()), @createdBy
                FROM people.staff staff
                WHERE staff.id = @subjectStaffId AND staff.archived_at IS NULL;
                IF @@ROWCOUNT = 0 THROW 51000, 'The selected staff member was not found.', 1;

                INSERT INTO quality.probation_cases (
                    id, record_id, subject_staff_id, org_unit_id, source_elevate_assessment_id,
                    academic_year, status, current_observation_number, created_by_user_account_id
                )
                SELECT @caseId, @recordId, staff.id, COALESCE(@orgUnitId, staff.primary_org_unit_id),
                       @assessmentId, @academicYear, N'in_progress', 1, @createdBy
                FROM people.staff staff WHERE staff.id = @subjectStaffId;

                INSERT INTO quality.probation_case_reviewers (
                    probation_case_id, staff_id, reviewer_role, created_by_user_account_id
                ) VALUES (@caseId, @leaderReviewerId, N'leader', @createdBy);

                INSERT INTO quality.probation_case_reviewers (
                    probation_case_id, staff_id, reviewer_role, created_by_user_account_id
                )
                SELECT @caseId, @tlReviewerId, N'teaching_learning', @createdBy
                WHERE @tlReviewerId IS NOT NULL;

                INSERT INTO quality.probation_observations (
                    id, probation_case_id, observation_number, observation_type, status,
                    started_at, created_by_user_account_id
                ) VALUES
                    (@observationOneId, @caseId, 1, N'probation', N'in_progress', sysutcdatetime(), @createdBy),
                    (@observationTwoId, @caseId, 2, N'liv', N'not_started', NULL, @createdBy),
                    (@observationThreeId, @caseId, 3, N'probation', N'not_started', NULL, @createdBy);

                INSERT INTO quality.probation_observation_stages (
                    id, probation_observation_id, stage_type, stage_order, created_by_user_account_id
                )
                SELECT newid(), source.observation_id, stage.stage_type, stage.stage_order, @createdBy
                FROM (VALUES (@observationOneId, 1), (@observationThreeId, 3)) source(observation_id, observation_number)
                CROSS APPLY (VALUES
                    (N'professional_discussion', 1), (N'visit_rubric', 2),
                    (N'reflection_feedback', 3), (N'actions', 4), (N'next_observation', 5)
                ) stage(stage_type, stage_order)
                WHERE source.observation_number = 1 OR stage.stage_type <> N'next_observation';

                INSERT INTO quality.probation_observation_visits (
                    probation_observation_id, created_by_user_account_id
                ) VALUES (@observationOneId, @createdBy), (@observationThreeId, @createdBy);
                """, connection, (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@caseId", caseId);
                command.Parameters.AddWithValue("@recordId", recordId);
                command.Parameters.AddWithValue("@moduleId", moduleId);
                command.Parameters.AddWithValue("@observationOneId", observationOneId);
                command.Parameters.AddWithValue("@observationTwoId", observationTwoId);
                command.Parameters.AddWithValue("@observationThreeId", observationThreeId);
                command.Parameters.AddWithValue("@subjectStaffId", request.SubjectStaffId);
                command.Parameters.AddWithValue("@tlReviewerId", ToDbValue(request.TeachingLearningReviewerStaffId));
                command.Parameters.AddWithValue("@leaderReviewerId", currentUser.StaffId.Value);
                command.Parameters.AddWithValue("@orgUnitId", ToDbValue(request.OrgUnitId));
                command.Parameters.AddWithValue("@ownerStaffId", ToDbValue(currentUser.StaffId));
                command.Parameters.AddWithValue("@createdBy", ToDbValue(currentUser.UserAccountId));
                command.Parameters.AddWithValue("@academicYear", academicYear);
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            await WriteAuditAsync(
                connection, transaction, currentUser.UserAccountId, recordId, "probation_case", caseId,
                "probation.created", $"Probationary observation cycle created by {currentUser.DisplayName}.",
                null, JsonSerializer.Serialize(request), cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return caseId;
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    private static async Task ValidateProbationCreatorScopeAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        Guid subjectStaffId,
        Guid currentUserAccountId,
        Guid currentStaffId,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            """
            DECLARE @canCreate bit = CASE WHEN EXISTS (
                SELECT 1
                FROM auth.user_roles user_role
                JOIN auth.roles role ON role.id = user_role.role_id
                  AND role.is_active = 1 AND role.archived_at IS NULL
                WHERE user_role.user_account_id = @currentUserAccountId
                  AND user_role.active_from <= sysutcdatetime()
                  AND (user_role.active_to IS NULL OR user_role.active_to > sysutcdatetime())
                  AND role.role_key IN (N'programme_leader', N'head_of_faculty', N'director', N'super_admin')
            ) THEN 1 ELSE 0 END;

            DECLARE @canSelectAny bit = CASE WHEN EXISTS (
                SELECT 1
                FROM auth.user_roles user_role
                JOIN auth.roles role ON role.id = user_role.role_id
                  AND role.is_active = 1 AND role.archived_at IS NULL
                WHERE user_role.user_account_id = @currentUserAccountId
                  AND user_role.active_from <= sysutcdatetime()
                  AND (user_role.active_to IS NULL OR user_role.active_to > sysutcdatetime())
                  AND role.role_key IN (N'director', N'super_admin')
            ) THEN 1 ELSE 0 END;

            SELECT @canCreate,
                   CAST(CASE WHEN @canCreate = 1 AND EXISTS (
                       SELECT 1
                       FROM people.staff staff
                       WHERE staff.id = @subjectStaffId
                         AND staff.id <> @currentStaffId
                         AND staff.account_status = N'active'
                         AND staff.archived_at IS NULL
                         AND (
                             @canSelectAny = 1
                             OR EXISTS (
                                 SELECT 1 FROM org.fn_visible_staff(@currentUserAccountId) visible
                                 WHERE visible.staff_id = staff.id
                             )
                         )
                   ) THEN 1 ELSE 0 END AS bit);
            """,
            connection,
            (SqlTransaction)transaction);
        command.Parameters.AddWithValue("@subjectStaffId", subjectStaffId);
        command.Parameters.AddWithValue("@currentUserAccountId", currentUserAccountId);
        command.Parameters.AddWithValue("@currentStaffId", currentStaffId);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        await reader.ReadAsync(cancellationToken);
        if (!reader.GetBoolean(0))
            throw new WorkflowValidationException("Only Programme Leaders, Heads of Faculty, Directors or administrators can create probationary observations.");
        if (!reader.GetBoolean(1))
            throw new WorkflowValidationException("The selected staff member is outside your probationary observation scope.");
    }

    public async Task<FormSubmissionUpdateResult> UpdateProbationStageAsync(
        Guid caseId,
        Guid observationId,
        Guid stageId,
        SaveProbationStageRequest request,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            var metadata = await GetProbationObservationMetadataAsync(connection, transaction, caseId, observationId, currentUser, cancellationToken);
            if (metadata is null) return FormSubmissionUpdateResult.NotFound;
            if (!metadata.CanEdit) return FormSubmissionUpdateResult.Forbidden;
            if (metadata.ObservationNumber is not (1 or 3) || metadata.CurrentObservationNumber != metadata.ObservationNumber)
                throw new WorkflowValidationException("This probation observation is not the active observation.");
            var status = NormalizeProbationStageStatus(request.StageStatus);
            await ValidateLivOpportunityKeysAsync(connection, transaction, request.DevelopmentOpportunityKeys, cancellationToken);

            await using var command = new SqlCommand(
                """
                UPDATE stage
                SET context_text = @context, aims_text = @aims, learner_activity_text = @learnerActivity,
                    reflection_text = @reflection, development_opportunity_keys_json = @opportunities,
                    intended_next_observation_date = @nextDate, stage_status = @status,
                    updated_by_user_account_id = @user, updated_at = sysutcdatetime()
                FROM quality.probation_observation_stages stage
                WHERE stage.id = @stageId AND stage.probation_observation_id = @observationId
                  AND stage.stage_type <> N'visit_rubric';
                """, connection, (SqlTransaction)transaction);
            command.Parameters.AddWithValue("@stageId", stageId);
            command.Parameters.AddWithValue("@observationId", observationId);
            command.Parameters.AddWithValue("@context", ToDbValue(request.ContextText));
            command.Parameters.AddWithValue("@aims", ToDbValue(request.AimsText));
            command.Parameters.AddWithValue("@learnerActivity", ToDbValue(request.LearnerActivityText));
            command.Parameters.AddWithValue("@reflection", ToDbValue(request.ReflectionText));
            command.Parameters.AddWithValue("@opportunities", ToDbValue(SerializeLivStringList(request.DevelopmentOpportunityKeys)));
            command.Parameters.AddWithValue("@nextDate", ToDbValue(request.IntendedNextObservationDate));
            command.Parameters.AddWithValue("@status", status);
            command.Parameters.AddWithValue("@user", ToDbValue(currentUser.UserAccountId));
            if (await command.ExecuteNonQueryAsync(cancellationToken) == 0) return FormSubmissionUpdateResult.NotFound;

            await WriteAuditAsync(
                connection, transaction, currentUser.UserAccountId, metadata.RecordId, "probation_stage", stageId,
                "probation.stage_updated", $"Probation observation {metadata.ObservationNumber} stage updated by {currentUser.DisplayName}.",
                null, JsonSerializer.Serialize(request), cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return FormSubmissionUpdateResult.Saved;
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task<FormSubmissionUpdateResult> UpdateProbationVisitAsync(
        Guid caseId,
        Guid observationId,
        SaveProbationVisitRequest request,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            var metadata = await GetProbationObservationMetadataAsync(connection, transaction, caseId, observationId, currentUser, cancellationToken);
            if (metadata is null) return FormSubmissionUpdateResult.NotFound;
            if (!metadata.CanEdit) return FormSubmissionUpdateResult.Forbidden;
            if (metadata.ObservationNumber is not (1 or 3) || metadata.CurrentObservationNumber != metadata.ObservationNumber)
                throw new WorkflowValidationException("This probation observation is not the active observation.");
            var status = NormalizeProbationStageStatus(request.StageStatus);
            var deliveryAreaId = await ReadActiveLookupValueIdAsync(
                connection, transaction, "liv_delivery_area", request.DeliveryAreaKey,
                string.Equals(status, "completed", StringComparison.OrdinalIgnoreCase), cancellationToken);
            var ratings = (request.Ratings ?? []).Where(rating => !string.IsNullOrWhiteSpace(rating.FocusKey))
                .GroupBy(rating => rating.FocusKey, StringComparer.OrdinalIgnoreCase).Select(group => group.Last()).ToArray();

            await using (var command = new SqlCommand(
                """
                UPDATE quality.probation_observation_visits
                SET delivery_area_lookup_value_id = @deliveryAreaId, observation_date = @date,
                    observation_time = TRY_CONVERT(time(0), @time), course_name = @courseName,
                    course_group = @courseGroup, course_level = @courseLevel, key_points = @keyPoints,
                    updated_by_user_account_id = @user, updated_at = sysutcdatetime()
                WHERE probation_observation_id = @observationId;

                UPDATE quality.probation_observation_stages
                SET stage_status = @status, updated_by_user_account_id = @user, updated_at = sysutcdatetime()
                WHERE probation_observation_id = @observationId AND stage_type = N'visit_rubric';

                DELETE FROM quality.probation_observation_ratings WHERE probation_observation_id = @observationId;
                """, connection, (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@observationId", observationId);
                command.Parameters.AddWithValue("@deliveryAreaId", deliveryAreaId == Guid.Empty ? DBNull.Value : deliveryAreaId);
                command.Parameters.AddWithValue("@date", ToDbValue(request.ObservationDate));
                command.Parameters.AddWithValue("@time", ToDbValue(request.ObservationTime));
                command.Parameters.AddWithValue("@courseName", ToDbValue(request.CourseName));
                command.Parameters.AddWithValue("@courseGroup", ToDbValue(request.CourseGroup));
                command.Parameters.AddWithValue("@courseLevel", ToDbValue(request.CourseLevel));
                command.Parameters.AddWithValue("@keyPoints", ToDbValue(request.KeyPoints));
                command.Parameters.AddWithValue("@status", status);
                command.Parameters.AddWithValue("@user", ToDbValue(currentUser.UserAccountId));
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            foreach (var rating in ratings)
            {
                await using var command = new SqlCommand(
                    """
                    INSERT INTO quality.probation_observation_ratings (
                        probation_observation_id, focus_lookup_value_id, descriptor_id,
                        hidden_numeric_value, evidence_of_practice
                    )
                    SELECT @observationId, focus.id, descriptor.id,
                           descriptor.hidden_numeric_value, @evidence
                    FROM core.lookup_values focus
                    JOIN core.lookup_types focus_type ON focus_type.id = focus.lookup_type_id
                      AND focus_type.lookup_key = N'liv_focus_area'
                    JOIN quality.elevate_practice_rubric_descriptors descriptor ON descriptor.id = @descriptorId
                      AND descriptor.is_active = 1 AND descriptor.archived_at IS NULL
                    WHERE focus.value_key = @focusKey AND focus.value_key <> N'other'
                      AND focus.is_active = 1 AND focus.archived_at IS NULL;
                    """, connection, (SqlTransaction)transaction);
                command.Parameters.AddWithValue("@observationId", observationId);
                command.Parameters.AddWithValue("@focusKey", rating.FocusKey.Trim());
                command.Parameters.AddWithValue("@descriptorId", rating.DescriptorId);
                command.Parameters.AddWithValue("@evidence", ToDbValue(rating.EvidenceOfPractice));
                if (await command.ExecuteNonQueryAsync(cancellationToken) == 0)
                    throw new WorkflowValidationException("One or more probation rubric responses are invalid.");
            }

            if (status == "completed")
            {
                var requiredCount = await GetProbationRubricAreaCountAsync(connection, transaction, cancellationToken);
                if (ratings.Length != requiredCount)
                    throw new WorkflowValidationException("Select a practice outcome for every probation rubric area.");
            }

            await WriteAuditAsync(
                connection, transaction, currentUser.UserAccountId, metadata.RecordId, "probation_observation", observationId,
                "probation.visit_updated", $"Probation observation {metadata.ObservationNumber} visit and rubric updated by {currentUser.DisplayName}.",
                null, JsonSerializer.Serialize(request), cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return FormSubmissionUpdateResult.Saved;
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task<FormSubmissionUpdateResult> CompleteProbationObservationAsync(
        Guid caseId,
        Guid observationId,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);
        try
        {
            var metadata = await GetProbationObservationMetadataAsync(connection, transaction, caseId, observationId, currentUser, cancellationToken);
            if (metadata is null) return FormSubmissionUpdateResult.NotFound;
            if (!metadata.CanEdit) return FormSubmissionUpdateResult.Forbidden;
            if (metadata.ObservationNumber is not (1 or 3) || metadata.CurrentObservationNumber != metadata.ObservationNumber)
                throw new WorkflowValidationException("This probation observation is not the active observation.");

            var completedStages = new List<string>();
            await using (var command = new SqlCommand(
                "SELECT stage_type FROM quality.probation_observation_stages WHERE probation_observation_id = @id AND stage_status = N'completed';",
                connection, (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@id", observationId);
                await using var reader = await command.ExecuteReaderAsync(cancellationToken);
                while (await reader.ReadAsync(cancellationToken)) completedStages.Add(reader.GetString(0));
            }
            var selectedRatings = await GetProbationRatingCountAsync(connection, transaction, observationId, cancellationToken);
            var requiredRatings = await GetProbationRubricAreaCountAsync(connection, transaction, cancellationToken);
            ProbationObservationWorkflow.ValidateCompletion(metadata.ObservationNumber, completedStages, selectedRatings, requiredRatings);

            await using (var command = new SqlCommand(
                """
                UPDATE quality.probation_observations
                SET status = N'completed', completed_at = sysutcdatetime(), completed_by_user_account_id = @user,
                    updated_by_user_account_id = @user, updated_at = sysutcdatetime()
                WHERE id = @observationId;

                UPDATE quality.probation_cases
                SET current_observation_number = CASE WHEN @number = 1 THEN 2 ELSE 3 END,
                    status = CASE WHEN @number = 3 THEN N'completed' ELSE N'in_progress' END,
                    completed_at = CASE WHEN @number = 3 THEN sysutcdatetime() ELSE NULL END,
                    updated_by_user_account_id = @user, updated_at = sysutcdatetime()
                WHERE id = @caseId;
                """, connection, (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@observationId", observationId);
                command.Parameters.AddWithValue("@caseId", caseId);
                command.Parameters.AddWithValue("@number", metadata.ObservationNumber);
                command.Parameters.AddWithValue("@user", ToDbValue(currentUser.UserAccountId));
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            await WriteAuditAsync(
                connection, transaction, currentUser.UserAccountId, metadata.RecordId, "probation_observation", observationId,
                "probation.observation_completed", $"Probation observation {metadata.ObservationNumber} completed by {currentUser.DisplayName}.",
                null, JsonSerializer.Serialize(new { metadata.ObservationNumber }), cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return FormSubmissionUpdateResult.Saved;
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task<StartProbationLivSummary?> StartProbationLivAsync(
        Guid caseId,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);
        try
        {
            var rows = new List<ProbationLivSourceRow>();
            await using (var command = new SqlCommand(
                """
                SELECT probation.record_id, probation.subject_staff_id, probation.org_unit_id,
                       probation.source_elevate_assessment_id, probation.status, probation.current_observation_number,
                       observation.id, observation.status, observation.linked_liv_record_id,
                       leader.staff_id,
                       CASE WHEN @canManage = 1 OR probation.created_by_user_account_id = @currentUserAccountId
                            OR EXISTS (
                                SELECT 1 FROM quality.probation_case_reviewers current_reviewer
                                WHERE current_reviewer.probation_case_id = probation.id
                                  AND current_reviewer.staff_id = @currentStaffId
                            ) THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END
                FROM quality.probation_cases probation
                JOIN quality.probation_observations observation
                  ON observation.probation_case_id = probation.id AND observation.observation_number = 2
                JOIN quality.probation_case_reviewers leader
                  ON leader.probation_case_id = probation.id AND leader.reviewer_role = N'leader'
                WHERE probation.id = @caseId AND probation.archived_at IS NULL;
                """, connection, (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@caseId", caseId);
                command.Parameters.AddWithValue("@canManage", currentUser.HasPermission(PermissionKeys.ProbationManage));
                command.Parameters.AddWithValue("@currentUserAccountId", ToDbValue(currentUser.UserAccountId));
                command.Parameters.AddWithValue("@currentStaffId", ToDbValue(currentUser.StaffId));
                await using var reader = await command.ExecuteReaderAsync(cancellationToken);
                if (await reader.ReadAsync(cancellationToken))
                {
                    rows.Add(new ProbationLivSourceRow(
                        reader.GetGuid(0), reader.GetGuid(1), GetGuidOrNull(reader, 2), GetGuidOrNull(reader, 3),
                        reader.GetString(4), reader.GetByte(5), reader.GetGuid(6), reader.GetString(7),
                        GetGuidOrNull(reader, 8), reader.GetGuid(9), reader.GetBoolean(10)));
                }
            }
            var source = rows.FirstOrDefault();
            if (source is null) return null;
            if (!source.CanEdit) throw new WorkflowValidationException("You cannot start this probation LIV observation.");
            if (source.CurrentObservationNumber != 2 || source.CaseStatus != "in_progress")
                throw new WorkflowValidationException("Complete Observation 1 before starting the probation LIV.");
            if (source.LinkedLivRecordId.HasValue)
            {
                await using var existing = new SqlCommand("SELECT record_id FROM quality.liv_records WHERE id = @id;", connection, (SqlTransaction)transaction);
                existing.Parameters.AddWithValue("@id", source.LinkedLivRecordId.Value);
                return new StartProbationLivSummary(source.LinkedLivRecordId.Value, (Guid)(await existing.ExecuteScalarAsync(cancellationToken))!);
            }

            var moduleId = await GetModuleIdAsync(connection, transaction, "liv", cancellationToken);
            var livId = Guid.NewGuid();
            var livRecordId = Guid.NewGuid();
            var cycleId = Guid.NewGuid();
            await using (var command = new SqlCommand(
                """
                INSERT INTO core.records (
                    id, module_id, record_type, title, summary, subject_staff_id, owner_staff_id,
                    org_unit_id, record_date, created_by_user_account_id
                )
                SELECT @recordId, @moduleId, N'liv', N'Probation LIV - ' + staff.display_name,
                       N'Observation 2 of the probationary observation cycle', staff.id, @leaderReviewerId,
                       COALESCE(@orgUnitId, staff.primary_org_unit_id), CONVERT(date, sysutcdatetime()), @createdBy
                FROM people.staff staff WHERE staff.id = @subjectStaffId;

                INSERT INTO quality.liv_records (
                    id, record_id, subject_staff_id, reviewer_staff_id, org_unit_id,
                    status, current_stage, visibility_status, source_elevate_assessment_id,
                    eli_primary_focus_key, eli_primary_focus_snapshot, eli_desired_outcome,
                    created_by_user_account_id
                )
                SELECT @livId, @recordId, @subjectStaffId, @leaderReviewerId,
                       COALESCE(@orgUnitId, staff.primary_org_unit_id), N'in_progress', N'case_created',
                       N'staff_visible', NULL, primary_focus.value_key, primary_focus.display_name,
                       information.desired_outcome, @createdBy
                FROM people.staff staff
                LEFT JOIN quality.elevate_practice_liv_information information ON information.assessment_id = @assessmentId
                LEFT JOIN core.lookup_values primary_focus ON primary_focus.id = information.primary_focus_lookup_value_id
                WHERE staff.id = @subjectStaffId;

                INSERT INTO quality.liv_cycles (
                    id, liv_record_id, cycle_number, cycle_status, created_by_user_account_id
                ) VALUES (@cycleId, @livId, 1, N'in_progress', @createdBy);

                UPDATE quality.probation_observations
                SET linked_liv_record_id = @livId, status = N'in_progress', started_at = sysutcdatetime(),
                    updated_by_user_account_id = @createdBy, updated_at = sysutcdatetime()
                WHERE id = @observationId AND linked_liv_record_id IS NULL;
                """, connection, (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@recordId", livRecordId);
                command.Parameters.AddWithValue("@moduleId", moduleId);
                command.Parameters.AddWithValue("@livId", livId);
                command.Parameters.AddWithValue("@cycleId", cycleId);
                command.Parameters.AddWithValue("@observationId", source.ObservationId);
                command.Parameters.AddWithValue("@subjectStaffId", source.SubjectStaffId);
                command.Parameters.AddWithValue("@leaderReviewerId", source.LeaderReviewerStaffId);
                command.Parameters.AddWithValue("@orgUnitId", ToDbValue(source.OrgUnitId));
                command.Parameters.AddWithValue("@assessmentId", ToDbValue(source.SourceElevateAssessmentId));
                command.Parameters.AddWithValue("@createdBy", ToDbValue(currentUser.UserAccountId));
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            await WriteAuditAsync(
                connection, transaction, currentUser.UserAccountId, source.CaseRecordId, "probation_observation", source.ObservationId,
                "probation.liv_started", $"Probation Observation 2 LIV started by {currentUser.DisplayName}.",
                null, JsonSerializer.Serialize(new { livId, livRecordId }), cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return new StartProbationLivSummary(livId, livRecordId);
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    private static async Task ValidateProbationReviewerAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        Guid staffId,
        string reviewerType,
        CancellationToken cancellationToken)
    {
        var roles = reviewerType == "teaching_learning"
            ? new[] { "teaching_learning_team" }
            : new[] { "programme_leader", "head_of_faculty", "director", "super_admin" };
        await using var command = new SqlCommand(
            """
            SELECT COUNT(*)
            FROM auth.user_accounts account
            JOIN auth.user_roles user_role ON user_role.user_account_id = account.id
              AND user_role.active_from <= sysutcdatetime()
              AND (user_role.active_to IS NULL OR user_role.active_to > sysutcdatetime())
            JOIN auth.roles role ON role.id = user_role.role_id AND role.is_active = 1 AND role.archived_at IS NULL
            WHERE account.staff_id = @staffId AND account.account_status = N'active'
              AND account.is_disabled = 0 AND account.archived_at IS NULL
              AND role.role_key IN (SELECT [value] FROM OPENJSON(@roles));
            """, connection, (SqlTransaction)transaction);
        command.Parameters.AddWithValue("@staffId", staffId);
        command.Parameters.AddWithValue("@roles", JsonSerializer.Serialize(roles));
        if (Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken)) == 0)
            throw new WorkflowValidationException(reviewerType == "teaching_learning"
                ? "Select a staff member with the Teaching and Learning role."
                : "Select a Programme Leader or more senior leader.");
    }

    private static async Task<ProbationObservationMetadata?> GetProbationObservationMetadataAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        Guid caseId,
        Guid observationId,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            """
            SELECT probation.record_id, probation.status, probation.current_observation_number,
                   observation.observation_number, observation.status,
                   CASE WHEN probation.status = N'in_progress' AND observation.status <> N'completed' AND (
                       @canManage = 1 OR probation.created_by_user_account_id = @currentUserAccountId
                       OR EXISTS (
                           SELECT 1 FROM quality.probation_case_reviewers reviewer
                           WHERE reviewer.probation_case_id = probation.id AND reviewer.staff_id = @currentStaffId
                       )
                   ) THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END
            FROM quality.probation_cases probation
            JOIN quality.probation_observations observation ON observation.probation_case_id = probation.id
            WHERE probation.id = @caseId AND observation.id = @observationId AND probation.archived_at IS NULL;
            """, connection, (SqlTransaction)transaction);
        command.Parameters.AddWithValue("@caseId", caseId);
        command.Parameters.AddWithValue("@observationId", observationId);
        command.Parameters.AddWithValue("@canManage", currentUser.HasPermission(PermissionKeys.ProbationManage));
        command.Parameters.AddWithValue("@currentUserAccountId", ToDbValue(currentUser.UserAccountId));
        command.Parameters.AddWithValue("@currentStaffId", ToDbValue(currentUser.StaffId));
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken)
            ? new ProbationObservationMetadata(
                reader.GetGuid(0), reader.GetString(1), reader.GetByte(2), reader.GetByte(3), reader.GetString(4), reader.GetBoolean(5))
            : null;
    }

    private static string NormalizeProbationStageStatus(string? status) =>
        string.Equals(status, "completed", StringComparison.OrdinalIgnoreCase) ? "completed" : "in_progress";

    private static async Task<int> GetProbationRubricAreaCountAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            """
            SELECT COUNT(*)
            FROM core.lookup_values value
            JOIN core.lookup_types type ON type.id = value.lookup_type_id
            WHERE type.lookup_key = N'liv_focus_area' AND value.value_key <> N'other'
              AND value.is_active = 1 AND value.archived_at IS NULL;
            """, connection, (SqlTransaction)transaction);
        return Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken));
    }

    private static async Task<int> GetProbationRatingCountAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        Guid observationId,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            "SELECT COUNT(*) FROM quality.probation_observation_ratings WHERE probation_observation_id = @id;",
            connection, (SqlTransaction)transaction);
        command.Parameters.AddWithValue("@id", observationId);
        return Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken));
    }

    private sealed record ProbationCaseRow(
        Guid Id, Guid RecordId, Guid SubjectStaffId, string SubjectStaffName, Guid? OrgUnitId,
        string? OrgUnitCode, string? ParentOrgUnitCode, string AcademicYear, string Status,
        int CurrentObservationNumber, Guid? SourceElevateAssessmentId, Guid? SourceElevateRecordId,
        DateTimeOffset CreatedAt, DateTimeOffset? UpdatedAt, bool CanEdit);
    private sealed record ProbationReviewerRow(Guid CaseId, ProbationReviewerSummary Reviewer);
    private sealed record ProbationObservationRow(
        Guid CaseId, Guid Id, int ObservationNumber, string ObservationType, string Status,
        Guid? LinkedLivRecordId, Guid? LinkedLivSourceRecordId, DateTimeOffset? StartedAt, DateTimeOffset? CompletedAt);
    private sealed record ProbationStageRow(
        Guid ObservationId, Guid Id, string StageType, int StageOrder, string StageStatus,
        string? ContextText, string? AimsText, string? LearnerActivityText, string? ReflectionText,
        IReadOnlyList<string> DevelopmentOpportunityKeys, DateOnly? IntendedNextObservationDate);
    private sealed record ProbationVisitRow(
        Guid ObservationId, string? DeliveryAreaKey, string? DeliveryAreaName, DateOnly? ObservationDate,
        string? ObservationTime, string? CourseName, string? CourseGroup, string? CourseLevel, string? KeyPoints);
    private sealed record ProbationRatingRow(Guid ObservationId, ProbationRatingSummary Rating);
    private sealed record ProbationObservationMetadata(
        Guid RecordId, string CaseStatus, int CurrentObservationNumber, int ObservationNumber,
        string ObservationStatus, bool CanEdit);
    private sealed record ProbationLivSourceRow(
        Guid CaseRecordId, Guid SubjectStaffId, Guid? OrgUnitId, Guid? SourceElevateAssessmentId,
        string CaseStatus, int CurrentObservationNumber, Guid ObservationId, string ObservationStatus,
        Guid? LinkedLivRecordId, Guid LeaderReviewerStaffId, bool CanEdit);
}
