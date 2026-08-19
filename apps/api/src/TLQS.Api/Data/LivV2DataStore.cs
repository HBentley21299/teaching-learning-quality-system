using System.Data;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    public async Task<LivConfigurationSummary> GetLivConfigurationAsync(CancellationToken cancellationToken, string processKey = "liv")
    {
        var lookupPrefix = processKey == "als_liv" ? "als_liv" : "liv";
        var deliveryAreas = await GetLivLookupOptionsAsync($"{lookupPrefix}_delivery_area", cancellationToken);
        var courseLevels = await GetLivLookupOptionsAsync($"{lookupPrefix}_course_level", cancellationToken);
        var focusAreas = await GetLivLookupOptionsAsync($"{lookupPrefix}_visit_focus_area", cancellationToken);
        var opportunities = await GetLivLookupOptionsAsync($"{lookupPrefix}_development_opportunity", cancellationToken);
        var rubric = await QueryAsync(
            """
            SELECT TOP (5) descriptor.id, descriptor.descriptor_key, descriptor.visible_wording,
                   descriptor.guidance_text, descriptor.display_order,
                   descriptor.colour_classification, descriptor.colour_hex, descriptor.is_active
            FROM quality.elevate_practice_rubric_descriptors descriptor
            JOIN quality.elevate_practice_frameworks framework ON framework.id = descriptor.framework_id
            WHERE framework.is_active = 1 AND framework.archived_at IS NULL
              AND descriptor.is_active = 1 AND descriptor.archived_at IS NULL
            ORDER BY descriptor.display_order;
            """,
            reader => new ElevatePracticeRatingScaleSummary(
                reader.GetGuid(0), reader.GetString(1), reader.GetString(2), reader.GetString(3),
                reader.GetInt32(4), GetStringOrNull(reader, 5), GetStringOrNull(reader, 6), reader.GetBoolean(7)),
            cancellationToken);
        return new LivConfigurationSummary(deliveryAreas, courseLevels, focusAreas, opportunities, rubric);
    }

    public async Task<LivStaffContextSummary?> GetLivStaffContextAsync(
        Guid staffId,
        CurrentUser currentUser,
        CancellationToken cancellationToken,
        string processKey = "liv")
    {
        var canViewAll = currentUser.HasPermission(processKey == "als_liv" ? PermissionKeys.AlsLivManage : PermissionKeys.LivManage)
            || currentUser.HasPermission(PermissionKeys.ReportsViewAll);
        var rows = await QueryAsync(
            """
            SELECT staff.id, staff.display_name, assessment.id, assessment.academic_year,
                   focus.value_key, focus.display_name, information.desired_outcome,
                   liv.id, liv.record_id,
                   CONVERT(nvarchar(7), information.preferred_visit_month, 126),
                   secondary_focus.value_key, secondary_focus.display_name,
                   information.secondary_focus_other
            FROM people.staff staff
            OUTER APPLY (
                SELECT TOP (1) assessment.id, assessment.academic_year
                FROM quality.elevate_practice_assessments assessment
                WHERE assessment.staff_id = staff.id
                  AND assessment.status = N'submitted'
                  AND assessment.archived_at IS NULL
                ORDER BY assessment.academic_year DESC, assessment.submitted_at DESC
            ) assessment
            LEFT JOIN quality.elevate_practice_liv_information information ON information.assessment_id = assessment.id
            LEFT JOIN core.lookup_values focus ON focus.id = information.primary_focus_lookup_value_id
            LEFT JOIN core.lookup_values secondary_focus ON secondary_focus.id = information.secondary_focus_lookup_value_id
            OUTER APPLY (
                SELECT TOP (1) record.id, record.record_id
                FROM quality.liv_records record
                WHERE record.source_elevate_assessment_id = assessment.id
                  AND record.process_key = @processKey
                  AND record.archived_at IS NULL
                ORDER BY record.created_at DESC
            ) liv
            WHERE staff.id = @staffId
              AND staff.archived_at IS NULL
              AND (
                    @canViewAll = 1
                    OR staff.id = @currentStaffId
                    OR EXISTS (
                        SELECT 1 FROM org.fn_visible_staff(@currentUserAccountId) visible
                        WHERE visible.staff_id = staff.id
                    )
              );
            """,
            command =>
            {
                command.Parameters.AddWithValue("@staffId", staffId);
                command.Parameters.AddWithValue("@canViewAll", canViewAll);
                command.Parameters.AddWithValue("@currentStaffId", ToDbValue(currentUser.StaffId));
                command.Parameters.AddWithValue("@currentUserAccountId", ToDbValue(currentUser.UserAccountId));
                command.Parameters.AddWithValue("@processKey", processKey);
            },
            reader => new LivStaffContextSummary(
                reader.GetGuid(0), reader.GetString(1), GetGuidOrNull(reader, 2),
                GetStringOrNull(reader, 3), GetStringOrNull(reader, 4), GetStringOrNull(reader, 5),
                GetStringOrNull(reader, 6), GetGuidOrNull(reader, 7), GetGuidOrNull(reader, 8),
                GetStringOrNull(reader, 9), GetStringOrNull(reader, 10), GetStringOrNull(reader, 11),
                GetStringOrNull(reader, 12)),
            cancellationToken);
        return rows.FirstOrDefault();
    }

    public async Task<IReadOnlyList<LivCaseSummary>> GetLivCasesV2Async(
        CurrentUser currentUser,
        CancellationToken cancellationToken,
        string processKey = "liv")
    {
        var managePermission = processKey == "als_liv" ? PermissionKeys.AlsLivManage : PermissionKeys.LivManage;
        var submitPermission = processKey == "als_liv" ? PermissionKeys.AlsLivSubmit : PermissionKeys.LivSubmit;
        var canViewAll = currentUser.HasPermission(managePermission)
            || currentUser.HasPermission(PermissionKeys.ReportsViewAll);
        var canViewScoped = currentUser.HasPermission(submitPermission);
        var canManage = currentUser.HasPermission(managePermission);
        var hasSensitivePermission = currentUser.HasPermission(PermissionKeys.LivSensitiveRead)
            || currentUser.HasPermission(PermissionKeys.UsersManage);
        var visibilityFilter = canViewAll
            ? string.Empty
            : """
                AND (
                    liv.subject_staff_id = @currentStaffId
                    OR liv.reviewer_staff_id = @currentStaffId
                    OR liv.created_by_user_account_id = @currentUserAccountId
                    OR (
                        @canViewScoped = 1
                        AND (
                            EXISTS (SELECT 1 FROM org.fn_visible_staff(@currentUserAccountId) visible WHERE visible.staff_id = liv.subject_staff_id)
                            OR EXISTS (SELECT 1 FROM org.fn_visible_org_units(@currentUserAccountId) visible WHERE visible.org_unit_id = liv.org_unit_id)
                        )
                    )
                )
              """;

        var cases = await QueryAsync(
            $"""
            SELECT liv.id, liv.record_id, liv.subject_staff_id, subject.display_name,
                   liv.reviewer_staff_id, reviewer.display_name, liv.org_unit_id,
                   area.code, parent.code, liv.pre_conversation, liv.status,
                   liv.current_stage, liv.visibility_status, liv.completion_date,
                   liv.created_at, liv.updated_at,
                   CASE WHEN @canManage = 1 OR liv.reviewer_staff_id = @currentStaffId OR liv.created_by_user_account_id = @currentUserAccountId
                        THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END,
                   CASE WHEN @hasSensitivePermission = 1 OR liv.reviewer_staff_id = @currentStaffId OR liv.created_by_user_account_id = @currentUserAccountId
                        THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END,
                   CASE WHEN @hasSensitivePermission = 1 OR liv.reviewer_staff_id = @currentStaffId OR liv.created_by_user_account_id = @currentUserAccountId
                        THEN liv.is_elevate_practitioner ELSE NULL END,
                   CASE WHEN @hasSensitivePermission = 1 OR liv.reviewer_staff_id = @currentStaffId OR liv.created_by_user_account_id = @currentUserAccountId
                        THEN liv.area_of_practice_keys_json ELSE NULL END,
                   CASE WHEN @hasSensitivePermission = 1 OR liv.reviewer_staff_id = @currentStaffId OR liv.created_by_user_account_id = @currentUserAccountId
                        THEN liv.area_of_practice_other ELSE NULL END,
                   delivery.value_key, delivery.display_name,
                    COALESCE(liv.source_elevate_assessment_id, probation_case.source_elevate_assessment_id),
                   COALESCE(source_primary.value_key, liv.eli_primary_focus_key),
                   COALESCE(source_primary.display_name, liv.eli_primary_focus_snapshot),
                   COALESCE(source_information.desired_outcome, liv.eli_desired_outcome),
                   CONVERT(nvarchar(7), source_information.preferred_visit_month, 126),
                   source_secondary.value_key, source_secondary.display_name,
                    source_information.secondary_focus_other,
                    probation_case.id, probation_observation.observation_number,
                    CONVERT(bit, CASE WHEN liv.created_by_user_account_id = @currentUserAccountId THEN 1 ELSE 0 END)
            FROM quality.liv_records liv
            JOIN people.staff subject ON subject.id = liv.subject_staff_id
            LEFT JOIN people.staff reviewer ON reviewer.id = liv.reviewer_staff_id
            LEFT JOIN org.org_units area ON area.id = liv.org_unit_id
            LEFT JOIN org.org_units parent ON parent.id = area.parent_org_unit_id
            LEFT JOIN core.lookup_values delivery ON delivery.id = liv.delivery_area_lookup_value_id
            LEFT JOIN quality.probation_observations probation_observation
              ON probation_observation.linked_liv_record_id = liv.id
            LEFT JOIN quality.probation_cases probation_case
              ON probation_case.id = probation_observation.probation_case_id AND probation_case.archived_at IS NULL
            LEFT JOIN quality.elevate_practice_liv_information source_information
              ON source_information.assessment_id = COALESCE(liv.source_elevate_assessment_id, probation_case.source_elevate_assessment_id)
            LEFT JOIN core.lookup_values source_primary
              ON source_primary.id = source_information.primary_focus_lookup_value_id
            LEFT JOIN core.lookup_values source_secondary
              ON source_secondary.id = source_information.secondary_focus_lookup_value_id
            WHERE liv.archived_at IS NULL AND liv.process_key = @processKey
            {visibilityFilter}
            OPTION (LOOP JOIN);
            """,
            command =>
            {
                command.Parameters.AddWithValue("@currentUserAccountId", ToDbValue(currentUser.UserAccountId));
                command.Parameters.AddWithValue("@currentStaffId", ToDbValue(currentUser.StaffId));
                command.Parameters.AddWithValue("@canViewScoped", canViewScoped);
                command.Parameters.AddWithValue("@canManage", canManage);
                command.Parameters.AddWithValue("@hasSensitivePermission", hasSensitivePermission);
                command.Parameters.AddWithValue("@processKey", processKey);
            },
            reader => new LivCaseSummary(
                reader.GetGuid(0), reader.GetGuid(1), reader.GetGuid(2), reader.GetString(3),
                GetGuidOrNull(reader, 4), GetStringOrNull(reader, 5), GetGuidOrNull(reader, 6),
                GetStringOrNull(reader, 7), GetStringOrNull(reader, 8), GetStringOrNull(reader, 9),
                reader.GetString(10), GetStringOrNull(reader, 11) ?? "case_created",
                GetStringOrNull(reader, 12) ?? "staff_visible", GetDateOnlyOrNull(reader, 13),
                reader.GetFieldValue<DateTimeOffset>(14), GetDateTimeOffsetOrNull(reader, 15),
                reader.GetBoolean(16), reader.GetBoolean(17),
                reader.IsDBNull(18) ? null : reader.GetBoolean(18),
                ParseLivStringList(GetStringOrNull(reader, 19)), GetStringOrNull(reader, 20), [], [],
                GetStringOrNull(reader, 21), GetStringOrNull(reader, 22), GetGuidOrNull(reader, 23),
                GetStringOrNull(reader, 24), GetStringOrNull(reader, 25), GetStringOrNull(reader, 26), [],
                GetStringOrNull(reader, 27), GetStringOrNull(reader, 28), GetStringOrNull(reader, 29),
                GetStringOrNull(reader, 30), GetGuidOrNull(reader, 31),
                reader.IsDBNull(32) ? null : reader.GetByte(32), reader.GetBoolean(33)),
            cancellationToken);

        if (cases.Count == 0)
        {
            return cases;
        }

        var caseIds = cases.Select(item => item.Id).ToHashSet();
        /*
            The follow-up queries below filter on this id set. It is passed as a
            JSON array and read back with OPENJSON ... WITH (value uniqueidentifier),
            not as a comma separated list split by STRING_SPLIT.

            STRING_SPLIT returns nvarchar, so the previous form had to wrap each
            value in TRY_CONVERT before comparing it to a uniqueidentifier column.
            That expression is not sargable and STRING_SPLIT carries a fixed
            cardinality estimate, so the filter was re-evaluated per candidate row:
            measured at ~210ms for the visit ratings query alone against ~30ms for
            the typed OPENJSON form, on a set of 128 ids.

            Guids contain no JSON escape characters, so composing the array by
            concatenation is safe here.
        */
        var caseIdsJson = string.Concat("[\"", string.Join("\",\"", caseIds), "\"]");
        var themes = await QueryAsync(
            """
            SELECT liv_record_id, theme_id
            FROM quality.liv_record_themes
            WHERE liv_record_id IN (
                SELECT value FROM OPENJSON(@caseIds) WITH (value uniqueidentifier '$')
            );
            """,
            command => command.Parameters.AddWithValue("@caseIds", caseIdsJson),
            reader => new LivThemeSelectionV2Row(reader.GetGuid(0), reader.GetGuid(1)),
            cancellationToken);
        var cycles = await QueryAsync(
            """
            SELECT id, liv_record_id, cycle_number, cycle_status, started_at, completed_at
            FROM quality.liv_cycles
            WHERE liv_record_id IN (
                SELECT value FROM OPENJSON(@caseIds) WITH (value uniqueidentifier '$')
            )
            ORDER BY liv_record_id, cycle_number;
            """,
            command => command.Parameters.AddWithValue("@caseIds", caseIdsJson),
            reader => new LivCycleV2Row(
                reader.GetGuid(0), reader.GetGuid(1), reader.GetInt32(2), reader.GetString(3),
                reader.GetFieldValue<DateTimeOffset>(4), GetDateTimeOffsetOrNull(reader, 5)),
            cancellationToken);
        var stages = await QueryAsync(
            """
            SELECT stage.liv_cycle_id, stage.id, stage.stage_type, stage.stage_order,
                   stage.stage_status, stage.context_text, stage.aims_text,
                   stage.learner_activity_text, stage.reflection_text,
                   stage.intended_follow_up_date, stage.distance_impact_text,
                   stage.development_opportunity_keys_json, stage.liv_visit_id
            FROM quality.liv_stages stage
            JOIN quality.liv_cycles cycle ON cycle.id = stage.liv_cycle_id
            WHERE stage.archived_at IS NULL
              AND cycle.liv_record_id IN (
                  SELECT value FROM OPENJSON(@caseIds) WITH (value uniqueidentifier '$')
              )
            ORDER BY stage.liv_cycle_id, stage.stage_order;
            """,
            command => command.Parameters.AddWithValue("@caseIds", caseIdsJson),
            reader => new LivStageV2Row(
                reader.GetGuid(0), reader.GetGuid(1), reader.GetString(2), reader.GetInt32(3),
                reader.GetString(4), GetStringOrNull(reader, 5), GetStringOrNull(reader, 6),
                GetStringOrNull(reader, 7), GetStringOrNull(reader, 8), GetDateOnlyOrNull(reader, 9),
                GetStringOrNull(reader, 10), ParseLivStringList(GetStringOrNull(reader, 11)), GetGuidOrNull(reader, 12)),
            cancellationToken);
        var visitRatings = await QueryAsync(
            """
            SELECT rating.visit_id, focus.value_key, focus.display_name,
                   rating.descriptor_id, descriptor.visible_wording, rating.is_not_applicable
            FROM quality.liv_visit_ratings rating
            JOIN quality.liv_visits visit ON visit.id = rating.visit_id
            JOIN core.lookup_values focus ON focus.id = rating.focus_lookup_value_id
            LEFT JOIN quality.elevate_practice_rubric_descriptors descriptor ON descriptor.id = rating.descriptor_id
            WHERE visit.liv_record_id IN (
                SELECT value FROM OPENJSON(@caseIds) WITH (value uniqueidentifier '$')
            );
            """,
            command => command.Parameters.AddWithValue("@caseIds", caseIdsJson),
            reader => new LivVisitRatingV2Row(
                reader.GetGuid(0), new LivVisitRatingSummary(
                    reader.GetString(1), reader.GetString(2), GetGuidOrNull(reader, 3),
                    GetStringOrNull(reader, 4), reader.GetBoolean(5))),
            cancellationToken);
        var visits = await QueryAsync(
            """
            SELECT visit.liv_record_id, visit.id, visit.visit_number, visit.visit_date,
                   CONVERT(nvarchar(5), visit.visit_time, 108), visit.visit_type,
                   visit.course_name, CAST(NULL AS nvarchar(200)), visit.course_level,
                   visit.reflection_notes, visit.findings, visit.visit_status,
                   visit.created_at, visit.updated_at, visit.cycle_id,
                   delivery.value_key, delivery.display_name
            FROM quality.liv_visits visit
            LEFT JOIN core.lookup_values delivery ON delivery.id = visit.delivery_area_lookup_value_id
            WHERE visit.archived_at IS NULL
              AND visit.liv_record_id IN (
                  SELECT value FROM OPENJSON(@caseIds) WITH (value uniqueidentifier '$')
              );
            """,
            command => command.Parameters.AddWithValue("@caseIds", caseIdsJson),
            reader => new LivVisitV2Row(
                reader.GetGuid(0),
                new LivVisitSummary(
                    reader.GetGuid(1), reader.GetInt32(2), GetDateOnlyOrNull(reader, 3),
                    GetStringOrNull(reader, 4), reader.GetString(5), GetStringOrNull(reader, 6),
                    GetStringOrNull(reader, 7), GetStringOrNull(reader, 8), GetStringOrNull(reader, 9),
                    GetStringOrNull(reader, 10), reader.GetString(11),
                    reader.GetFieldValue<DateTimeOffset>(12), GetDateTimeOffsetOrNull(reader, 13),
                    GetGuidOrNull(reader, 14), [], GetStringOrNull(reader, 15), GetStringOrNull(reader, 16))),
            cancellationToken);

        var ratingsByVisit = visitRatings.GroupBy(row => row.VisitId)
            .ToDictionary(group => group.Key, group => (IReadOnlyList<LivVisitRatingSummary>)group.Select(row => row.Rating).ToArray());
        var visitsByCase = visits.Where(row => caseIds.Contains(row.LivRecordId))
            .GroupBy(row => row.LivRecordId)
            .ToDictionary(
                group => group.Key,
                group => (IReadOnlyList<LivVisitSummary>)group
                    .OrderBy(row => row.Visit.VisitNumber)
                    .Select(row => row.Visit with { Ratings = ratingsByVisit.GetValueOrDefault(row.Visit.Id, []) })
                    .ToArray());

        return cases
            .OrderByDescending(item => item.UpdatedAt ?? item.CreatedAt)
            .Select(item =>
            {
                var itemCycles = cycles.Where(cycle => cycle.LivRecordId == item.Id)
                    .Select(cycle => new LivCycleSummary(
                        cycle.Id, cycle.CycleNumber, cycle.Status, cycle.StartedAt, cycle.CompletedAt,
                        cycle.CycleNumber > 1,
                        stages.Where(stage => stage.CycleId == cycle.Id)
                            .Select(stage => new LivStageSummary(
                                stage.Id, stage.StageType, stage.StageOrder, stage.StageStatus,
                                stage.ContextText, stage.AimsText, stage.LearnerActivityText,
                                stage.ReflectionText, stage.IntendedFollowUpDate, stage.DistanceImpactText,
                                stage.DevelopmentOpportunityKeys, stage.VisitId,
                                item.CanEdit || (item.SubjectStaffId == currentUser.StaffId
                                    && stage.StageType is "pre_discussion" or "distance_impact")))
                            .ToArray()))
                    .ToArray();
                return item with
                {
                    AreaOfPracticeThemeIds = item.CanViewSensitive
                        ? themes.Where(theme => theme.LivRecordId == item.Id).Select(theme => theme.ThemeId).ToArray()
                        : [],
                    Visits = item.CanViewSensitive ? visitsByCase.GetValueOrDefault(item.Id, []) : [],
                    Cycles = itemCycles
                };
            })
            .ToArray();
    }

    public async Task<Guid> CreateLivCaseV2Async(
        SaveLivCaseRequest request,
        CurrentUser currentUser,
        CancellationToken cancellationToken,
        string processKey = "liv")
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);
        try
        {
            await ValidateLivCreationScopeAsync(
                connection,
                transaction,
                request.SubjectStaffId,
                request.OrgUnitId,
                currentUser,
                cancellationToken);

            var moduleId = await GetModuleIdAsync(connection, transaction, processKey, cancellationToken);
            var recordId = Guid.NewGuid();
            var livId = Guid.NewGuid();
            var cycleId = Guid.NewGuid();

            var source = processKey == "als_liv"
                ? null
                : await ReadLatestElevateLivSourceAsync(connection, transaction, request.SubjectStaffId, processKey, cancellationToken);
            if (source?.ExistingLivId is not null)
            {
                throw new WorkflowValidationException("This Elevate Learning and Innovation assessment already has a LIV case.");
            }
            await using (var command = new SqlCommand(
                """
                INSERT INTO core.records (
                    id, module_id, record_type, title, subject_staff_id, owner_staff_id,
                    org_unit_id, record_date, created_by_user_account_id
                )
                SELECT @recordId, @moduleId, @processKey, @recordLabel + N' - ' + staff.display_name,
                       @subjectStaffId, @ownerStaffId, COALESCE(@orgUnitId, staff.primary_org_unit_id),
                       CONVERT(date, sysutcdatetime()), @createdBy
                FROM people.staff staff
                WHERE staff.id = @subjectStaffId AND staff.archived_at IS NULL;

                INSERT INTO quality.liv_records (
                    id, record_id, subject_staff_id, reviewer_staff_id, org_unit_id,
                    pre_conversation, status, current_stage, visibility_status,
                    is_elevate_practitioner, area_of_practice_keys_json, area_of_practice_other,
                    delivery_area_lookup_value_id, source_elevate_assessment_id,
                    eli_primary_focus_key, eli_primary_focus_snapshot, eli_desired_outcome,
                    created_by_user_account_id, process_key
                )
                SELECT @id, @recordId, @subjectStaffId, @reviewerStaffId,
                       COALESCE(@orgUnitId, staff.primary_org_unit_id), @preConversation,
                       N'in_progress', N'case_created', N'staff_visible', @isElevatePractitioner,
                       @areaKeysJson, @areaOther, @deliveryAreaId, @sourceAssessmentId,
                       @primaryFocusKey, @primaryFocusName, @desiredOutcome, @createdBy, @processKey
                FROM people.staff staff WHERE staff.id = @subjectStaffId;

                INSERT INTO quality.liv_cycles (
                    id, liv_record_id, cycle_number, cycle_status, created_by_user_account_id
                ) VALUES (@cycleId, @id, 1, N'in_progress', @createdBy);
                """,
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@recordId", recordId);
                command.Parameters.AddWithValue("@moduleId", moduleId);
                command.Parameters.AddWithValue("@id", livId);
                command.Parameters.AddWithValue("@cycleId", cycleId);
                command.Parameters.AddWithValue("@subjectStaffId", request.SubjectStaffId);
                command.Parameters.AddWithValue("@ownerStaffId", ToDbValue(currentUser.StaffId));
                command.Parameters.AddWithValue("@reviewerStaffId", ToDbValue(currentUser.StaffId));
                command.Parameters.AddWithValue("@orgUnitId", ToDbValue(request.OrgUnitId));
                command.Parameters.AddWithValue("@preConversation", ToDbValue(request.PreConversation));
                command.Parameters.AddWithValue("@isElevatePractitioner", ToDbValue(request.IsElevatePractitioner));
                command.Parameters.AddWithValue("@areaKeysJson", ToDbValue(SerializeLivStringList(request.AreaOfPracticeKeys)));
                command.Parameters.AddWithValue("@areaOther", ToDbValue(request.AreaOfPracticeOther));
                command.Parameters.AddWithValue("@deliveryAreaId", DBNull.Value);
                command.Parameters.AddWithValue("@sourceAssessmentId", ToDbValue(source?.AssessmentId));
                command.Parameters.AddWithValue("@primaryFocusKey", ToDbValue(source?.PrimaryFocusKey));
                command.Parameters.AddWithValue("@primaryFocusName", ToDbValue(source?.PrimaryFocusName));
                command.Parameters.AddWithValue("@desiredOutcome", ToDbValue(source?.DesiredOutcome));
                command.Parameters.AddWithValue("@createdBy", ToDbValue(currentUser.UserAccountId));
                command.Parameters.AddWithValue("@processKey", processKey);
                command.Parameters.AddWithValue("@recordLabel", processKey == "als_liv" ? "ALS LIV" : "LIV");
                if (await command.ExecuteNonQueryAsync(cancellationToken) < 3)
                {
                    throw new WorkflowValidationException("The selected staff member was not found.");
                }
            }

            await SaveLivThemeSelectionsAsync(
                connection, transaction, livId, request, cancellationToken,
                processKey == "als_liv" ? "als_liv_practitioner" : "liv");
            if (!string.IsNullOrWhiteSpace(request.PreConversation))
            {
                await InsertLivStageAsync(
                    connection, transaction, cycleId, "pre_discussion", request.PreConversation,
                    null, null, null, null, null, [], null, currentUser.UserAccountId, cancellationToken);
            }

            await WriteAuditAsync(
                connection, transaction, currentUser.UserAccountId, recordId,
                "liv_record", livId, "liv.created",
                $"LIV case created by {currentUser.DisplayName}.", null,
                JsonSerializer.Serialize(request), cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return livId;
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task<FormSubmissionUpdateResult> UpdateLivCaseV2Async(
        Guid livId,
        SaveLivCaseRequest request,
        CurrentUser currentUser,
        CancellationToken cancellationToken,
        string processKey = "liv")
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            var metadata = await GetLivCaseMetadataV2Async(connection, transaction, livId, cancellationToken);
            if (metadata is null) return FormSubmissionUpdateResult.NotFound;
            if (metadata.ProcessKey != processKey) return FormSubmissionUpdateResult.Forbidden;
            if (!CanEditLivMetadata(metadata, currentUser)) return FormSubmissionUpdateResult.Forbidden;

            if (request.OrgUnitId.HasValue)
            {
                await ValidateLivOrgUnitScopeAsync(
                    connection,
                    transaction,
                    request.OrgUnitId.Value,
                    currentUser,
                    cancellationToken);
            }

            var canWriteSensitive = CanViewLivSensitiveMetadata(metadata, currentUser);
            await using (var command = new SqlCommand(
                """
                UPDATE quality.liv_records
                SET org_unit_id = COALESCE(@orgUnitId, org_unit_id),
                    is_elevate_practitioner = CASE WHEN @canWriteSensitive = 1 THEN @isElevatePractitioner ELSE is_elevate_practitioner END,
                    area_of_practice_other = CASE WHEN @canWriteSensitive = 1 THEN @areaOther ELSE area_of_practice_other END,
                    updated_by_user_account_id = @updatedBy,
                    updated_at = sysutcdatetime()
                WHERE id = @id;
                """,
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@id", livId);
                command.Parameters.AddWithValue("@orgUnitId", ToDbValue(request.OrgUnitId));
                command.Parameters.AddWithValue("@canWriteSensitive", canWriteSensitive);
                command.Parameters.AddWithValue("@isElevatePractitioner", ToDbValue(request.IsElevatePractitioner));
                command.Parameters.AddWithValue("@areaOther", ToDbValue(request.AreaOfPracticeOther));
                command.Parameters.AddWithValue("@updatedBy", ToDbValue(currentUser.UserAccountId));
                await command.ExecuteNonQueryAsync(cancellationToken);
            }
            if (canWriteSensitive)
            {
                await SaveLivThemeSelectionsAsync(
                    connection, transaction, livId, request, cancellationToken,
                    processKey == "als_liv" ? "als_liv_practitioner" : "liv");
            }
            await WriteAuditAsync(
                connection, transaction, currentUser.UserAccountId, metadata.RecordId,
                "liv_record", livId, "liv.updated", $"LIV case updated by {currentUser.DisplayName}.",
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

    public async Task<LivStageCreatedSummary?> AddLivStageAsync(
        Guid livId,
        SaveLivStageRequest request,
        CurrentUser currentUser,
        CancellationToken cancellationToken,
        string processKey = "liv")
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);
        try
        {
            var metadata = await GetLivCaseMetadataV2Async(connection, transaction, livId, cancellationToken);
            if (metadata is null || metadata.ProcessKey != processKey || !CanEditLivMetadata(metadata, currentUser)) return null;
            var cycle = await GetActiveLivCycleAsync(connection, transaction, livId, cancellationToken)
                ?? throw new WorkflowValidationException("The LIV case has no active cycle.");
            var stageType = NormalizeLivStageType(request.StageType, cycle.CycleNumber);
            var stageOrder = LivStageOrder(stageType);
            var visitId = stageType == "visit" ? Guid.NewGuid() : (Guid?)null;
            if (visitId.HasValue)
            {
                await InsertLivCycleVisitAsync(
                    connection, transaction, visitId.Value, livId, cycle.Id, cycle.CycleNumber,
                    new SaveLivVisitRequest(null, null, null, null, null, null, null),
                    currentUser.UserAccountId, processKey, cancellationToken);
            }
            var stageId = await InsertLivStageAsync(
                connection, transaction, cycle.Id, stageType,
                request.ContextText, request.AimsText, request.LearnerActivityText,
                request.ReflectionText, request.IntendedFollowUpDate, request.DistanceImpactText,
                request.DevelopmentOpportunityKeys, visitId, currentUser.UserAccountId, cancellationToken);

            await using (var update = new SqlCommand(
                "UPDATE quality.liv_records SET current_stage = @stage, updated_at = sysutcdatetime(), updated_by_user_account_id = @user WHERE id = @id;",
                connection, (SqlTransaction)transaction))
            {
                update.Parameters.AddWithValue("@stage", stageType);
                update.Parameters.AddWithValue("@user", ToDbValue(currentUser.UserAccountId));
                update.Parameters.AddWithValue("@id", livId);
                await update.ExecuteNonQueryAsync(cancellationToken);
            }
            await WriteAuditAsync(
                connection, transaction, currentUser.UserAccountId, metadata.RecordId,
                "liv_stage", stageId, "liv.stage_added",
                $"{LivStageLabel(stageType)} added by {currentUser.DisplayName}.", null,
                JsonSerializer.Serialize(request), cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return new LivStageCreatedSummary(stageId, stageType, stageOrder, visitId);
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task<FormSubmissionUpdateResult> UpdateLivStageAsync(
        Guid livId,
        Guid stageId,
        SaveLivStageRequest request,
        CurrentUser currentUser,
        CancellationToken cancellationToken,
        string processKey = "liv")
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            var metadata = await GetLivCaseMetadataV2Async(connection, transaction, livId, cancellationToken);
            if (metadata is null) return FormSubmissionUpdateResult.NotFound;
            if (metadata.ProcessKey != processKey) return FormSubmissionUpdateResult.Forbidden;
            string? stageType;
            await using (var read = new SqlCommand(
                """
                SELECT stage.stage_type
                FROM quality.liv_stages stage
                JOIN quality.liv_cycles cycle ON cycle.id = stage.liv_cycle_id
                WHERE stage.id = @stageId AND cycle.liv_record_id = @livId AND stage.archived_at IS NULL;
                """, connection, (SqlTransaction)transaction))
            {
                read.Parameters.AddWithValue("@stageId", stageId);
                read.Parameters.AddWithValue("@livId", livId);
                stageType = await read.ExecuteScalarAsync(cancellationToken) as string;
            }
            if (stageType is null) return FormSubmissionUpdateResult.NotFound;
            var subjectCanEdit = metadata.SubjectStaffId == currentUser.StaffId
                && stageType is "pre_discussion" or "distance_impact";
            if (!subjectCanEdit && !CanEditLivMetadata(metadata, currentUser)) return FormSubmissionUpdateResult.Forbidden;
            var stageStatus = NormalizeLivStageStatus(request.StageStatus, stageType);

            await ValidateLivOpportunityKeysAsync(
                connection, transaction, request.DevelopmentOpportunityKeys, processKey, cancellationToken);
            await using (var command = new SqlCommand(
                """
                UPDATE quality.liv_stages
                SET context_text = @context, aims_text = @aims,
                    learner_activity_text = @learnerActivity, reflection_text = @reflection,
                    intended_follow_up_date = @followUpDate,
                    distance_impact_text = @distanceImpact,
                    development_opportunity_keys_json = @opportunities,
                    stage_status = @stageStatus,
                    updated_by_user_account_id = @updatedBy, updated_at = sysutcdatetime()
                WHERE id = @stageId;
                """, connection, (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@stageId", stageId);
                command.Parameters.AddWithValue("@context", ToDbValue(request.ContextText));
                command.Parameters.AddWithValue("@aims", ToDbValue(request.AimsText));
                command.Parameters.AddWithValue("@learnerActivity", ToDbValue(request.LearnerActivityText));
                command.Parameters.AddWithValue("@reflection", ToDbValue(request.ReflectionText));
                command.Parameters.AddWithValue("@followUpDate", ToDbValue(request.IntendedFollowUpDate));
                command.Parameters.AddWithValue("@distanceImpact", ToDbValue(request.DistanceImpactText));
                command.Parameters.AddWithValue("@opportunities", ToDbValue(SerializeLivStringList(request.DevelopmentOpportunityKeys)));
                command.Parameters.AddWithValue("@stageStatus", stageStatus);
                command.Parameters.AddWithValue("@updatedBy", ToDbValue(currentUser.UserAccountId));
                await command.ExecuteNonQueryAsync(cancellationToken);
            }
            await WriteAuditAsync(
                connection, transaction, currentUser.UserAccountId, metadata.RecordId,
                "liv_stage", stageId, "liv.stage_updated",
                $"{LivStageLabel(stageType)} updated by {currentUser.DisplayName}.", null,
                JsonSerializer.Serialize(request), cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return FormSubmissionUpdateResult.Saved;
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task<FormSubmissionUpdateResult> UpdateLivVisitV2Async(
        Guid livId,
        Guid visitId,
        SaveLivVisitRequest request,
        CurrentUser currentUser,
        CancellationToken cancellationToken,
        string processKey = "liv")
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            var metadata = await GetLivCaseMetadataV2Async(connection, transaction, livId, cancellationToken);
            if (metadata is null) return FormSubmissionUpdateResult.NotFound;
            if (metadata.ProcessKey != processKey) return FormSubmissionUpdateResult.Forbidden;
            if (!CanEditLivMetadata(metadata, currentUser)) return FormSubmissionUpdateResult.Forbidden;
            var deliveryAreaId = await ReadActiveLookupValueIdAsync(
                connection, transaction, LivLookupKey(processKey, "delivery_area"), request.DeliveryAreaKey, true, cancellationToken);
            _ = await ReadActiveLookupValueIdAsync(
                connection, transaction, LivLookupKey(processKey, "course_level"), request.CourseLevel, false, cancellationToken);

            await using (var command = new SqlCommand(
                """
                UPDATE quality.liv_visits
                SET visit_date = @visitDate, visit_time = @visitTime,
                    course_name = @courseName, course_group = NULL,
                    course_level = @courseLevel, reflection_notes = @reflectionNotes,
                    findings = @findings, delivery_area_lookup_value_id = @deliveryAreaId,
                    updated_by_user_account_id = @updatedBy,
                    updated_at = sysutcdatetime()
                WHERE id = @visitId AND liv_record_id = @livId AND archived_at IS NULL;
                """, connection, (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@visitId", visitId);
                command.Parameters.AddWithValue("@livId", livId);
                command.Parameters.AddWithValue("@updatedBy", ToDbValue(currentUser.UserAccountId));
                command.Parameters.AddWithValue("@deliveryAreaId", deliveryAreaId);
                AddLivVisitParameters(command, request);
                if (await command.ExecuteNonQueryAsync(cancellationToken) == 0) return FormSubmissionUpdateResult.NotFound;
            }
            await SaveLivVisitRatingsAsync(connection, transaction, visitId, request.Ratings, processKey, cancellationToken);
            await WriteAuditAsync(
                connection, transaction, currentUser.UserAccountId, metadata.RecordId,
                "liv_visit", visitId, "liv.visit_updated",
                $"LIV visit updated by {currentUser.DisplayName}.", null,
                JsonSerializer.Serialize(request), cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return FormSubmissionUpdateResult.Saved;
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task<LivCycleSummary?> CompleteLivCycleAsync(
        Guid livId,
        bool openFollowUp,
        CurrentUser currentUser,
        CancellationToken cancellationToken,
        string processKey = "liv")
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);
        try
        {
            var metadata = await GetLivCaseMetadataV2Async(connection, transaction, livId, cancellationToken);
            if (metadata is null || metadata.ProcessKey != processKey || !CanEditLivMetadata(metadata, currentUser)) return null;
            var cycle = await GetActiveLivCycleAsync(connection, transaction, livId, cancellationToken)
                ?? throw new WorkflowValidationException("The LIV case has no active cycle.");
            var stageTypes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            await using (var read = new SqlCommand(
                "SELECT stage_type FROM quality.liv_stages WHERE liv_cycle_id = @cycleId AND archived_at IS NULL;",
                connection, (SqlTransaction)transaction))
            {
                read.Parameters.AddWithValue("@cycleId", cycle.Id);
                await using var reader = await read.ExecuteReaderAsync(cancellationToken);
                while (await reader.ReadAsync(cancellationToken)) stageTypes.Add(reader.GetString(0));
            }
            var requiredStageOne = cycle.CycleNumber == 1 ? "pre_discussion" : "distance_impact";
            var required = new[] { requiredStageOne, "visit", "post_reflection", "actions", "follow_up_review" };
            if (required.Any(value => !stageTypes.Contains(value)))
            {
                throw new WorkflowValidationException("Add all five LIV stages before completing this cycle.");
            }

            ProbationLivCompletionLink? probationLink = null;
            await using (var read = new SqlCommand(
                """
                SELECT observation.id, probation.id, probation.record_id
                FROM quality.probation_observations observation
                JOIN quality.probation_cases probation ON probation.id = observation.probation_case_id
                WHERE observation.linked_liv_record_id = @livId
                  AND observation.observation_number = 2
                  AND observation.status = N'in_progress'
                  AND probation.status = N'in_progress' AND probation.archived_at IS NULL;
                """, connection, (SqlTransaction)transaction))
            {
                read.Parameters.AddWithValue("@livId", livId);
                await using var reader = await read.ExecuteReaderAsync(cancellationToken);
                if (await reader.ReadAsync(cancellationToken))
                    probationLink = new ProbationLivCompletionLink(reader.GetGuid(0), reader.GetGuid(1), reader.GetGuid(2));
            }

            if (probationLink is not null)
            {
                await using (var command = new SqlCommand(
                    """
                    UPDATE quality.liv_cycles
                    SET cycle_status = N'completed', completed_at = sysutcdatetime(),
                        updated_by_user_account_id = @user, updated_at = sysutcdatetime()
                    WHERE id = @cycleId;
                    UPDATE quality.liv_stages
                    SET stage_status = N'completed', updated_by_user_account_id = @user, updated_at = sysutcdatetime()
                    WHERE liv_cycle_id = @cycleId AND archived_at IS NULL;
                    UPDATE quality.liv_visits
                    SET visit_status = N'completed', updated_by_user_account_id = @user, updated_at = sysutcdatetime()
                    WHERE cycle_id = @cycleId AND archived_at IS NULL;
                    UPDATE quality.liv_records
                    SET status = N'closed', current_stage = N'completed', completion_date = CONVERT(date, sysutcdatetime()),
                        updated_by_user_account_id = @user, updated_at = sysutcdatetime()
                    WHERE id = @livId;
                    UPDATE quality.probation_observations
                    SET status = N'completed', completed_at = sysutcdatetime(), completed_by_user_account_id = @user,
                        updated_by_user_account_id = @user, updated_at = sysutcdatetime()
                    WHERE id = @observationId;
                    UPDATE quality.probation_observations
                    SET status = N'in_progress', started_at = COALESCE(started_at, sysutcdatetime()),
                        updated_by_user_account_id = @user, updated_at = sysutcdatetime()
                    WHERE probation_case_id = @probationCaseId AND observation_number = 3 AND status = N'not_started';
                    UPDATE quality.probation_cases
                    SET current_observation_number = 3, updated_by_user_account_id = @user, updated_at = sysutcdatetime()
                    WHERE id = @probationCaseId;
                    """, connection, (SqlTransaction)transaction))
                {
                    command.Parameters.AddWithValue("@cycleId", cycle.Id);
                    command.Parameters.AddWithValue("@livId", livId);
                    command.Parameters.AddWithValue("@observationId", probationLink.ObservationId);
                    command.Parameters.AddWithValue("@probationCaseId", probationLink.CaseId);
                    command.Parameters.AddWithValue("@user", ToDbValue(currentUser.UserAccountId));
                    await command.ExecuteNonQueryAsync(cancellationToken);
                }
                await WriteAuditAsync(
                    connection, transaction, currentUser.UserAccountId, metadata.RecordId,
                    "liv_cycle", cycle.Id, "liv.probation_observation_completed",
                    $"Probation Observation 2 LIV completed by {currentUser.DisplayName}.", null,
                    JsonSerializer.Serialize(new { cycle.CycleNumber, probationLink.CaseId }), cancellationToken);
                await WriteAuditAsync(
                    connection, transaction, currentUser.UserAccountId, probationLink.CaseRecordId,
                    "probation_observation", probationLink.ObservationId, "probation.observation_completed",
                    $"Probation Observation 2 completed through LIV by {currentUser.DisplayName}.", null,
                    JsonSerializer.Serialize(new { livId, cycle.CycleNumber }), cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return new LivCycleSummary(cycle.Id, cycle.CycleNumber, "completed", cycle.StartedAt, DateTimeOffset.UtcNow, false, []);
            }

            if (!openFollowUp)
            {
                if (cycle.CycleNumber < 2)
                    throw new WorkflowValidationException("A LIV can only be closed without a follow-up after cycle 2 has been completed.");

                await using (var command = new SqlCommand(
                    """
                    UPDATE quality.liv_cycles
                    SET cycle_status = N'completed', completed_at = sysutcdatetime(),
                        updated_by_user_account_id = @user, updated_at = sysutcdatetime()
                    WHERE id = @cycleId;
                    UPDATE quality.liv_stages
                    SET stage_status = CASE WHEN stage_status = N'in_progress' THEN N'completed' ELSE stage_status END,
                        updated_by_user_account_id = @user, updated_at = sysutcdatetime()
                    WHERE liv_cycle_id = @cycleId AND archived_at IS NULL;
                    UPDATE quality.liv_visits
                    SET visit_status = N'completed', updated_by_user_account_id = @user, updated_at = sysutcdatetime()
                    WHERE cycle_id = @cycleId AND archived_at IS NULL;
                    UPDATE quality.liv_records
                    SET status = N'closed', current_stage = N'completed', completion_date = CONVERT(date, sysutcdatetime()),
                        updated_by_user_account_id = @user, updated_at = sysutcdatetime()
                    WHERE id = @livId;
                    """, connection, (SqlTransaction)transaction))
                {
                    command.Parameters.AddWithValue("@cycleId", cycle.Id);
                    command.Parameters.AddWithValue("@livId", livId);
                    command.Parameters.AddWithValue("@user", ToDbValue(currentUser.UserAccountId));
                    await command.ExecuteNonQueryAsync(cancellationToken);
                }
                await WriteAuditAsync(
                    connection, transaction, currentUser.UserAccountId, metadata.RecordId,
                    "liv_cycle", cycle.Id, "liv.cycle_completed_and_closed",
                    $"LIV cycle {cycle.CycleNumber} completed and the LIV closed by {currentUser.DisplayName}.",
                    null, JsonSerializer.Serialize(new { cycle.CycleNumber, OpenFollowUp = false }), cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return new LivCycleSummary(cycle.Id, cycle.CycleNumber, "completed", cycle.StartedAt, DateTimeOffset.UtcNow, true, []);
            }

            var nextCycleId = Guid.NewGuid();
            var nextCycleNumber = cycle.CycleNumber + 1;
            await using (var command = new SqlCommand(
                """
                UPDATE quality.liv_cycles
                SET cycle_status = N'completed', completed_at = sysutcdatetime(),
                    updated_by_user_account_id = @user, updated_at = sysutcdatetime()
                WHERE id = @cycleId;
                UPDATE quality.liv_stages
                SET stage_status = N'completed', updated_by_user_account_id = @user, updated_at = sysutcdatetime()
                WHERE liv_cycle_id = @cycleId AND archived_at IS NULL;
                UPDATE quality.liv_visits
                SET visit_status = N'completed', updated_by_user_account_id = @user, updated_at = sysutcdatetime()
                WHERE cycle_id = @cycleId AND archived_at IS NULL;
                INSERT INTO quality.liv_cycles (
                    id, liv_record_id, cycle_number, cycle_status, created_by_user_account_id
                ) VALUES (@nextCycleId, @livId, @nextCycleNumber, N'in_progress', @user);
                UPDATE quality.liv_records
                SET current_stage = N'distance_impact', completion_date = CONVERT(date, sysutcdatetime()),
                    updated_by_user_account_id = @user, updated_at = sysutcdatetime()
                WHERE id = @livId;
                """, connection, (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@cycleId", cycle.Id);
                command.Parameters.AddWithValue("@nextCycleId", nextCycleId);
                command.Parameters.AddWithValue("@nextCycleNumber", nextCycleNumber);
                command.Parameters.AddWithValue("@livId", livId);
                command.Parameters.AddWithValue("@user", ToDbValue(currentUser.UserAccountId));
                await command.ExecuteNonQueryAsync(cancellationToken);
            }
            await WriteAuditAsync(
                connection, transaction, currentUser.UserAccountId, metadata.RecordId,
                "liv_cycle", cycle.Id, "liv.cycle_completed",
                $"LIV cycle {cycle.CycleNumber} completed by {currentUser.DisplayName}; follow-up cycle {nextCycleNumber} opened.",
                null, JsonSerializer.Serialize(new { cycle.CycleNumber, nextCycleNumber }), cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return new LivCycleSummary(nextCycleId, nextCycleNumber, "in_progress", DateTimeOffset.UtcNow, null, true, []);
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    private Task<IReadOnlyList<LivLookupOptionSummary>> GetLivLookupOptionsAsync(
        string lookupKey,
        CancellationToken cancellationToken) =>
        QueryAsync(
            """
            SELECT value.value_key, value.display_name, value.display_order,
                   CASE WHEN value.value_key = N'other' THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END
            FROM core.lookup_values value
            JOIN core.lookup_types type ON type.id = value.lookup_type_id
            WHERE type.lookup_key = @lookupKey AND value.is_active = 1 AND value.archived_at IS NULL
            ORDER BY value.display_order, value.display_name;
            """,
            command => command.Parameters.AddWithValue("@lookupKey", lookupKey),
            reader => new LivLookupOptionSummary(reader.GetString(0), reader.GetString(1), reader.GetInt32(2), reader.GetBoolean(3)),
            cancellationToken);

    private static async Task<Guid> ReadActiveLookupValueIdAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        string lookupKey,
        string? valueKey,
        bool required,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(valueKey))
        {
            if (required) throw new WorkflowValidationException("Select a LIV delivery area.");
            return Guid.Empty;
        }
        await using var command = new SqlCommand(
            """
            SELECT value.id
            FROM core.lookup_values value
            JOIN core.lookup_types type ON type.id = value.lookup_type_id
            WHERE type.lookup_key = @lookupKey AND value.value_key = @valueKey
              AND value.is_active = 1 AND value.archived_at IS NULL;
            """, connection, (SqlTransaction)transaction);
        command.Parameters.AddWithValue("@lookupKey", lookupKey);
        command.Parameters.AddWithValue("@valueKey", valueKey.Trim());
        return (Guid?)(await command.ExecuteScalarAsync(cancellationToken))
            ?? throw new WorkflowValidationException("The selected LIV option is no longer available.");
    }

    private static async Task<ElevateLivSourceV2Row?> ReadLatestElevateLivSourceAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        Guid staffId,
        string processKey,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            """
            SELECT TOP (1) assessment.id, focus.value_key, focus.display_name,
                   information.desired_outcome, existing.id
            FROM quality.elevate_practice_assessments assessment
            JOIN quality.elevate_practice_liv_information information ON information.assessment_id = assessment.id
            LEFT JOIN core.lookup_values focus ON focus.id = information.primary_focus_lookup_value_id
            LEFT JOIN quality.liv_records existing
              ON existing.source_elevate_assessment_id = assessment.id AND existing.process_key = @processKey AND existing.archived_at IS NULL
            WHERE assessment.staff_id = @staffId AND assessment.status = N'submitted'
              AND assessment.archived_at IS NULL
            ORDER BY assessment.academic_year DESC, assessment.submitted_at DESC;
            """, connection, (SqlTransaction)transaction);
        command.Parameters.AddWithValue("@staffId", staffId);
        command.Parameters.AddWithValue("@processKey", processKey);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken)
            ? new ElevateLivSourceV2Row(
                reader.GetGuid(0), GetStringOrNull(reader, 1), GetStringOrNull(reader, 2),
                GetStringOrNull(reader, 3), GetGuidOrNull(reader, 4))
            : null;
    }

    private static async Task<LivCaseMetadataV2?> GetLivCaseMetadataV2Async(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        Guid livId,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            "SELECT record_id, subject_staff_id, reviewer_staff_id, created_by_user_account_id, status, process_key FROM quality.liv_records WHERE id = @id AND archived_at IS NULL;",
            connection, (SqlTransaction)transaction);
        command.Parameters.AddWithValue("@id", livId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken)
            ? new LivCaseMetadataV2(reader.GetGuid(0), reader.GetGuid(1), GetGuidOrNull(reader, 2), GetGuidOrNull(reader, 3), reader.GetString(4), reader.GetString(5))
            : null;
    }

    private static async Task ValidateLivCreationScopeAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        Guid subjectStaffId,
        Guid? orgUnitId,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            """
            SELECT COUNT(*)
            FROM people.staff staff
            JOIN org.fn_visible_staff(@currentUserAccountId) visible ON visible.staff_id = staff.id
            WHERE staff.id = @subjectStaffId
              AND staff.account_status = 'active'
              AND staff.archived_at IS NULL;
            """,
            connection,
            (SqlTransaction)transaction);
        command.Parameters.AddWithValue("@currentUserAccountId", ToDbValue(currentUser.UserAccountId));
        command.Parameters.AddWithValue("@subjectStaffId", subjectStaffId);
        if (Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken)) != 1)
        {
            throw new WorkflowValidationException("You cannot create a LIV for a staff member outside your assigned scope.");
        }

        if (orgUnitId.HasValue)
        {
            await ValidateLivOrgUnitScopeAsync(connection, transaction, orgUnitId.Value, currentUser, cancellationToken);
        }
    }

    private static async Task ValidateLivOrgUnitScopeAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        Guid orgUnitId,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            """
            SELECT COUNT(*)
            FROM org.org_units unit
            JOIN org.fn_visible_org_units(@currentUserAccountId) visible ON visible.org_unit_id = unit.id
            WHERE unit.id = @orgUnitId
              AND unit.is_active = 1
              AND unit.archived_at IS NULL;
            """,
            connection,
            (SqlTransaction)transaction);
        command.Parameters.AddWithValue("@currentUserAccountId", ToDbValue(currentUser.UserAccountId));
        command.Parameters.AddWithValue("@orgUnitId", orgUnitId);
        if (Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken)) != 1)
        {
            throw new WorkflowValidationException("The selected LIV team or faculty is outside your assigned scope.");
        }
    }

    private static bool CanEditLivMetadata(LivCaseMetadataV2 metadata, CurrentUser currentUser) =>
        metadata.ReviewerStaffId == currentUser.StaffId
            || metadata.CreatedByUserAccountId == currentUser.UserAccountId
            || currentUser.HasPermission(metadata.ProcessKey == "als_liv" ? PermissionKeys.AlsLivManage : PermissionKeys.LivManage);

    private static bool CanViewLivSensitiveMetadata(LivCaseMetadataV2 metadata, CurrentUser currentUser) =>
        metadata.ReviewerStaffId == currentUser.StaffId
        || metadata.CreatedByUserAccountId == currentUser.UserAccountId
        || currentUser.HasPermission(PermissionKeys.UsersManage)
        || currentUser.HasPermission(PermissionKeys.LivSensitiveRead);

    private static string LivLookupKey(string processKey, string suffix) =>
        $"{(processKey == "als_liv" ? "als_liv" : "liv")}_{suffix}";

    private static async Task<LivCycleV2Row?> GetActiveLivCycleAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        Guid livId,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            "SELECT TOP (1) id, liv_record_id, cycle_number, cycle_status, started_at, completed_at FROM quality.liv_cycles WHERE liv_record_id = @livId AND cycle_status = N'in_progress' ORDER BY cycle_number DESC;",
            connection, (SqlTransaction)transaction);
        command.Parameters.AddWithValue("@livId", livId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken)
            ? new LivCycleV2Row(reader.GetGuid(0), reader.GetGuid(1), reader.GetInt32(2), reader.GetString(3), reader.GetFieldValue<DateTimeOffset>(4), GetDateTimeOffsetOrNull(reader, 5))
            : null;
    }

    private static string NormalizeLivStageType(string value, int cycleNumber)
    {
        var normalized = value.Trim().ToLowerInvariant();
        var allowed = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "pre_discussion", "distance_impact", "visit", "post_reflection", "actions", "follow_up_review"
        };
        if (!allowed.Contains(normalized)) throw new WorkflowValidationException("The selected LIV stage is invalid.");
        if (cycleNumber == 1 && normalized == "distance_impact") throw new WorkflowValidationException("Distance Travelled and Impact is used in follow-up cycles.");
        if (cycleNumber > 1 && normalized == "pre_discussion") throw new WorkflowValidationException("Follow-up cycles use Distance Travelled and Impact instead of a pre-LIV discussion.");
        return normalized;
    }

    private static string NormalizeLivStageStatus(string? value, string stageType)
    {
        var normalized = value?.Trim().ToLowerInvariant() ?? "in_progress";
        if (normalized == "not_applicable" && stageType != "follow_up_review")
            throw new WorkflowValidationException("Not applicable is only available for the follow-up review stage.");
        return normalized is "in_progress" or "completed" or "not_applicable"
            ? normalized
            : throw new WorkflowValidationException("The selected LIV stage status is invalid.");
    }

    private static int LivStageOrder(string stageType) => stageType switch
    {
        "pre_discussion" or "distance_impact" => 1,
        "visit" => 2,
        "post_reflection" => 3,
        "actions" => 4,
        "follow_up_review" => 5,
        _ => throw new WorkflowValidationException("The selected LIV stage is invalid.")
    };

    private static string LivStageLabel(string stageType) => stageType switch
    {
        "pre_discussion" => "Pre-LIV Professional Discussion",
        "distance_impact" => "Distance Travelled and Impact",
        "visit" => "LIV Visit",
        "post_reflection" => "Post LIV Reflection and Discussion",
        "actions" => "Actions",
        "follow_up_review" => "Follow-up Review",
        _ => "LIV stage"
    };

    private static async Task<Guid> InsertLivStageAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        Guid cycleId,
        string stageType,
        string? context,
        string? aims,
        string? learnerActivity,
        string? reflection,
        DateOnly? followUpDate,
        string? distanceImpact,
        IReadOnlyList<string>? opportunities,
        Guid? visitId,
        Guid? userAccountId,
        CancellationToken cancellationToken)
    {
        var id = Guid.NewGuid();
        await using var command = new SqlCommand(
            """
            INSERT INTO quality.liv_stages (
                id, liv_cycle_id, stage_type, stage_order, context_text, aims_text,
                learner_activity_text, reflection_text, intended_follow_up_date,
                distance_impact_text, development_opportunity_keys_json, liv_visit_id,
                created_by_user_account_id
            ) VALUES (
                @id, @cycleId, @stageType, @stageOrder, @context, @aims,
                @learnerActivity, @reflection, @followUpDate, @distanceImpact,
                @opportunities, @visitId, @user
            );
            """, connection, (SqlTransaction)transaction);
        command.Parameters.AddWithValue("@id", id);
        command.Parameters.AddWithValue("@cycleId", cycleId);
        command.Parameters.AddWithValue("@stageType", stageType);
        command.Parameters.AddWithValue("@stageOrder", LivStageOrder(stageType));
        command.Parameters.AddWithValue("@context", ToDbValue(context));
        command.Parameters.AddWithValue("@aims", ToDbValue(aims));
        command.Parameters.AddWithValue("@learnerActivity", ToDbValue(learnerActivity));
        command.Parameters.AddWithValue("@reflection", ToDbValue(reflection));
        command.Parameters.AddWithValue("@followUpDate", ToDbValue(followUpDate));
        command.Parameters.AddWithValue("@distanceImpact", ToDbValue(distanceImpact));
        command.Parameters.AddWithValue("@opportunities", ToDbValue(SerializeLivStringList(opportunities)));
        command.Parameters.AddWithValue("@visitId", ToDbValue(visitId));
        command.Parameters.AddWithValue("@user", ToDbValue(userAccountId));
        await command.ExecuteNonQueryAsync(cancellationToken);
        return id;
    }

    private static async Task InsertLivCycleVisitAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        Guid visitId,
        Guid livId,
        Guid cycleId,
        int visitNumber,
        SaveLivVisitRequest request,
        Guid? userAccountId,
        string processKey,
        CancellationToken cancellationToken)
    {
        Guid? deliveryAreaId = null;
        if (!string.IsNullOrWhiteSpace(request.DeliveryAreaKey))
        {
            deliveryAreaId = await ReadActiveLookupValueIdAsync(
                connection, transaction, LivLookupKey(processKey, "delivery_area"), request.DeliveryAreaKey, true, cancellationToken);
        }
        _ = await ReadActiveLookupValueIdAsync(
            connection, transaction, LivLookupKey(processKey, "course_level"), request.CourseLevel, false, cancellationToken);
        await using var command = new SqlCommand(
            """
            INSERT INTO quality.liv_visits (
                id, liv_record_id, cycle_id, visit_number, visit_date, visit_time,
                visit_type, course_name, course_group, course_level, reflection_notes,
                findings, delivery_area_lookup_value_id, visit_status, created_by_user_account_id
            ) VALUES (
                @id, @livId, @cycleId, @visitNumber, @visitDate, @visitTime,
                CASE WHEN @visitNumber = 1 THEN N'initial' ELSE N'follow_up' END,
                @courseName, NULL, @courseLevel, @reflectionNotes,
                @findings, @deliveryAreaId, N'in_progress', @createdBy
            );
            """, connection, (SqlTransaction)transaction);
        command.Parameters.AddWithValue("@id", visitId);
        command.Parameters.AddWithValue("@livId", livId);
        command.Parameters.AddWithValue("@cycleId", cycleId);
        command.Parameters.AddWithValue("@visitNumber", visitNumber);
        command.Parameters.AddWithValue("@createdBy", ToDbValue(userAccountId));
        command.Parameters.AddWithValue("@deliveryAreaId", ToDbValue(deliveryAreaId));
        AddLivVisitParameters(command, request);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task ValidateLivOpportunityKeysAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        IReadOnlyList<string>? keys,
        string processKey,
        CancellationToken cancellationToken)
    {
        var values = (keys ?? []).Where(value => !string.IsNullOrWhiteSpace(value)).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        if (values.Length == 0) return;
        await using var command = new SqlCommand(
            """
            SELECT COUNT(*)
            FROM core.lookup_values value
            JOIN core.lookup_types type ON type.id = value.lookup_type_id
            WHERE type.lookup_key = @lookupKey
              AND value.value_key IN (SELECT [value] FROM OPENJSON(@keys))
              AND value.is_active = 1 AND value.archived_at IS NULL;
            """, connection, (SqlTransaction)transaction);
        command.Parameters.AddWithValue("@keys", JsonSerializer.Serialize(values));
        command.Parameters.AddWithValue("@lookupKey", LivLookupKey(processKey, "development_opportunity"));
        if (Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken)) != values.Length)
            throw new WorkflowValidationException("One or more development opportunities are no longer available.");
    }

    private static async Task SaveLivVisitRatingsAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        Guid visitId,
        IReadOnlyList<LivVisitRatingRequest>? ratings,
        string processKey,
        CancellationToken cancellationToken)
    {
        var values = (ratings ?? []).Where(value => !string.IsNullOrWhiteSpace(value.FocusKey))
            .GroupBy(value => value.FocusKey, StringComparer.OrdinalIgnoreCase).Select(group => group.Last()).ToArray();
        await using (var clear = new SqlCommand("DELETE FROM quality.liv_visit_ratings WHERE visit_id = @visitId;", connection, (SqlTransaction)transaction))
        {
            clear.Parameters.AddWithValue("@visitId", visitId);
            await clear.ExecuteNonQueryAsync(cancellationToken);
        }
        foreach (var rating in values)
        {
            if (!rating.IsNotApplicable && !rating.DescriptorId.HasValue)
                throw new WorkflowValidationException("Select a rubric outcome for every rated LIV area.");
            await using var command = new SqlCommand(
                """
                INSERT INTO quality.liv_visit_ratings (
                    visit_id, focus_lookup_value_id, descriptor_id, hidden_numeric_value, is_not_applicable
                )
                SELECT @visitId, focus.id,
                       CASE WHEN @isNa = 1 THEN NULL ELSE descriptor.id END,
                       CASE WHEN @isNa = 1 THEN NULL ELSE descriptor.hidden_numeric_value END,
                       @isNa
                FROM core.lookup_values focus
                JOIN core.lookup_types focus_type ON focus_type.id = focus.lookup_type_id AND focus_type.lookup_key = @lookupKey
                LEFT JOIN quality.elevate_practice_rubric_descriptors descriptor ON descriptor.id = @descriptorId AND descriptor.archived_at IS NULL
                WHERE focus.value_key = @focusKey AND focus.value_key <> N'other'
                  AND focus.is_active = 1 AND focus.archived_at IS NULL;
                """, connection, (SqlTransaction)transaction);
            command.Parameters.AddWithValue("@visitId", visitId);
            command.Parameters.AddWithValue("@focusKey", rating.FocusKey);
            command.Parameters.AddWithValue("@descriptorId", ToDbValue(rating.DescriptorId));
            command.Parameters.AddWithValue("@isNa", rating.IsNotApplicable);
            command.Parameters.AddWithValue("@lookupKey", LivLookupKey(processKey, "visit_focus_area"));
            if (await command.ExecuteNonQueryAsync(cancellationToken) == 0)
                throw new WorkflowValidationException("One or more LIV rubric responses are invalid.");
        }
    }

    private sealed record LivThemeSelectionV2Row(Guid LivRecordId, Guid ThemeId);
    private sealed record LivCycleV2Row(Guid Id, Guid LivRecordId, int CycleNumber, string Status, DateTimeOffset StartedAt, DateTimeOffset? CompletedAt);
    private sealed record LivStageV2Row(
        Guid CycleId, Guid Id, string StageType, int StageOrder, string StageStatus,
        string? ContextText, string? AimsText, string? LearnerActivityText,
        string? ReflectionText, DateOnly? IntendedFollowUpDate, string? DistanceImpactText,
        IReadOnlyList<string> DevelopmentOpportunityKeys, Guid? VisitId);
    private sealed record LivVisitV2Row(Guid LivRecordId, LivVisitSummary Visit);
    private sealed record LivVisitRatingV2Row(Guid VisitId, LivVisitRatingSummary Rating);
    private sealed record ElevateLivSourceV2Row(Guid AssessmentId, string? PrimaryFocusKey, string? PrimaryFocusName, string? DesiredOutcome, Guid? ExistingLivId);
    private sealed record LivCaseMetadataV2(Guid RecordId, Guid SubjectStaffId, Guid? ReviewerStaffId, Guid? CreatedByUserAccountId, string Status, string ProcessKey);
    private sealed record ProbationLivCompletionLink(Guid ObservationId, Guid CaseId, Guid CaseRecordId);
}
