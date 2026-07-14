using System.Text.Json;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    private static readonly HashSet<string> CoachingSessionTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "coaching", "mentoring", "combined"
    };

    private static readonly HashSet<string> CoachingDeliveryMethods = new(StringComparer.OrdinalIgnoreCase)
    {
        "in_person", "online", "telephone"
    };

    private static readonly HashSet<string> CoachingReasons = new(StringComparer.OrdinalIgnoreCase)
    {
        "requested_by_staff", "follow_up", "cpd_implementation", "new_role_responsibility",
        "quality_activity", "development_priority", "other"
    };

    private static readonly HashSet<string> CoachingActionOwners = new(StringComparer.OrdinalIgnoreCase)
    {
        "staff", "coach", "joint"
    };

    private static readonly HashSet<string> CoachingPreviousActionStatuses = new(StringComparer.OrdinalIgnoreCase)
    {
        "not_started", "in_progress", "completed", "not_applicable"
    };

    public async Task<CoachingConfigurationSummary> GetCoachingConfigurationAsync(CancellationToken cancellationToken)
    {
        async Task<IReadOnlyList<CoachingLookupOptionSummary>> GetOptionsAsync(string lookupKey) =>
            await QueryAsync(
                """
                SELECT value.id, value.value_key, value.display_name, value.display_order
                FROM core.lookup_values value
                JOIN core.lookup_types type ON type.id = value.lookup_type_id
                WHERE type.lookup_key = @lookupKey
                  AND type.is_active = 1
                  AND type.archived_at IS NULL
                  AND value.is_active = 1
                  AND value.archived_at IS NULL
                ORDER BY value.display_order, value.display_name;
                """,
                command => command.Parameters.AddWithValue("@lookupKey", lookupKey),
                reader => new CoachingLookupOptionSummary(
                    reader.GetGuid(0), reader.GetString(1), reader.GetString(2), reader.GetInt32(3)),
                cancellationToken);

        var rubric = await QueryAsync(
            """
            SELECT descriptor.id, descriptor.descriptor_key, descriptor.visible_wording,
                   descriptor.guidance_text, descriptor.display_order,
                   descriptor.colour_classification, descriptor.colour_hex
            FROM quality.elevate_practice_rubric_descriptors descriptor
            JOIN quality.elevate_practice_frameworks framework ON framework.id = descriptor.framework_id
            WHERE framework.is_active = 1
              AND framework.archived_at IS NULL
              AND descriptor.is_active = 1
              AND descriptor.archived_at IS NULL
            ORDER BY descriptor.display_order;
            """,
            null,
            reader => new CoachingRubricOptionSummary(
                reader.GetGuid(0), reader.GetString(1), reader.GetString(2), reader.GetString(3),
                reader.GetInt32(4), GetStringOrNull(reader, 5), GetStringOrNull(reader, 6)),
            cancellationToken);

        return new CoachingConfigurationSummary(
            await GetOptionsAsync("coaching_development_stage"),
            await GetOptionsAsync("coaching_focus_area"),
            await GetOptionsAsync("coaching_support_type"),
            rubric);
    }

    public async Task<bool> CanStartCoachingForStaffAsync(
        Guid staffId,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        if (!currentUser.HasPermission(PermissionKeys.CoachingSubmit)
            && !currentUser.HasPermission(PermissionKeys.CoachingManage))
        {
            return false;
        }

        if (currentUser.HasPermission(PermissionKeys.CoachingManage)
            || currentUser.HasPermission(PermissionKeys.ReportsViewAll)
            || currentUser.StaffId == staffId)
        {
            return true;
        }

        var assignedCoach = await QueryAsync(
            """
            SELECT 1
            FROM quality.coaching_assignments
            WHERE staff_id = @staffId
              AND coach_staff_id = @currentStaffId
              AND effective_from <= CONVERT(date, sysutcdatetime())
              AND (effective_to IS NULL OR effective_to >= CONVERT(date, sysutcdatetime()))
              AND archived_at IS NULL;
            """,
            command =>
            {
                command.Parameters.AddWithValue("@staffId", staffId);
                command.Parameters.AddWithValue("@currentStaffId", ToDbValue(currentUser.StaffId));
            },
            reader => reader.GetInt32(0),
            cancellationToken);

        return assignedCoach.Count > 0
            || await IsStaffProfileInScopeAsync(staffId, currentUser, cancellationToken);
    }

    public async Task<CoachingContextSummary> GetCoachingContextAsync(
        Guid staffId,
        Guid? cycleId,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        if (!await CanStartCoachingForStaffAsync(staffId, currentUser, cancellationToken))
        {
            throw new WorkflowValidationException("You cannot create a coaching record for this staff member.");
        }

        var staffRows = await QueryAsync(
            """
            SELECT id, display_name
            FROM people.staff
            WHERE id = @staffId AND account_status = 'active' AND archived_at IS NULL;
            """,
            command => command.Parameters.AddWithValue("@staffId", staffId),
            reader => new CoachingPersonRow(reader.GetGuid(0), reader.GetString(1)),
            cancellationToken);
        if (staffRows.Count == 0)
        {
            throw new WorkflowValidationException("The selected staff member is not active.");
        }

        var coach = await ResolveCoachAsync(staffId, currentUser.StaffId, cancellationToken);
        var cycles = await QueryAsync(
            """
            SELECT cycle.id, cycle.cycle_number, cycle.cycle_type, cycle.status, cycle.started_on, cycle.closed_on,
                   cycle.coach_staff_id, coach.display_name,
                   (SELECT COUNT(*) FROM quality.coaching_sessions session
                    WHERE session.cycle_id = cycle.id AND session.archived_at IS NULL)
            FROM quality.coaching_cycles cycle
            JOIN people.staff coach ON coach.id = cycle.coach_staff_id
            WHERE cycle.staff_id = @staffId AND cycle.archived_at IS NULL
            ORDER BY cycle.cycle_number DESC;
            """,
            command => command.Parameters.AddWithValue("@staffId", staffId),
            reader => new CoachingCycleSummary(
                reader.GetGuid(0),
                reader.GetInt32(1),
                reader.GetString(2),
                reader.GetString(3),
                DateOnly.FromDateTime(reader.GetDateTime(4)),
                GetDateOnlyOrNull(reader, 5),
                reader.GetGuid(6),
                reader.GetString(7),
                reader.GetInt32(8)),
            cancellationToken);

        CoachingCycleSummary? selectedCycle = null;
        if (cycleId.HasValue)
        {
            selectedCycle = cycles.FirstOrDefault(cycle => cycle.Id == cycleId.Value)
                ?? throw new WorkflowValidationException("The selected coaching cycle does not belong to this staff member.");
            coach = new CoachingCoachRow(selectedCycle.CoachStaffId, selectedCycle.CoachName, "cycle");
        }

        var nextSessionNumber = selectedCycle is null ? 1 : selectedCycle.SessionCount + 1;
        var previousActions = selectedCycle is null
            ? []
            : await GetCoachingPreviousActionsAsync(selectedCycle.Id, null, cancellationToken);

        return new CoachingContextSummary(
            staffRows[0].Id,
            staffRows[0].Name,
            coach.Id,
            coach.Name,
            coach.Source,
            cycles,
            selectedCycle?.Id,
            nextSessionNumber,
            previousActions);
    }

    public Task<IReadOnlyList<CoachingSessionSummary>> GetCoachingSessionsAsync(
        CurrentUser currentUser,
        CancellationToken cancellationToken) =>
        QueryAsync(
            """
            WITH visible_staff AS (
                SELECT staff_id FROM org.fn_visible_staff(@currentUserAccountId)
            )
            SELECT session.id, session.record_id, session.cycle_id, cycle.cycle_number,
                   session.staff_id, staff.display_name, session.coach_staff_id, coach.display_name,
                   session.session_number, session.session_date, session.session_type, session.status,
                   COALESCE(JSON_VALUE(session.focus_area_keys_json, '$[0]'), session.main_focus),
                   session.created_at, session.updated_at,
                   CONVERT(bit, CASE
                       WHEN @canManage = 1 THEN 1
                       WHEN session.status = 'draft'
                            AND (session.created_by_user_account_id = @currentUserAccountId OR session.coach_staff_id = @currentStaffId)
                           THEN 1
                       ELSE 0
                   END)
            FROM quality.coaching_sessions session
            JOIN quality.coaching_cycles cycle ON cycle.id = session.cycle_id
            JOIN people.staff staff ON staff.id = session.staff_id
            JOIN people.staff coach ON coach.id = session.coach_staff_id
            WHERE session.archived_at IS NULL
              AND (
                    @canViewAll = 1
                    OR session.staff_id = @currentStaffId
                    OR session.coach_staff_id = @currentStaffId
                    OR session.created_by_user_account_id = @currentUserAccountId
                    OR (
                        @canViewScoped = 1
                        AND EXISTS (SELECT 1 FROM visible_staff visible WHERE visible.staff_id = session.staff_id)
                    )
              )
            ORDER BY session.session_date DESC, session.created_at DESC;
            """,
            command => AddCoachingScopeParameters(command, currentUser),
            reader => new CoachingSessionSummary(
                reader.GetGuid(0),
                reader.GetGuid(1),
                reader.GetGuid(2),
                reader.GetInt32(3),
                reader.GetGuid(4),
                reader.GetString(5),
                reader.GetGuid(6),
                reader.GetString(7),
                reader.GetInt32(8),
                DateOnly.FromDateTime(reader.GetDateTime(9)),
                reader.GetString(10),
                reader.GetString(11),
                GetStringOrNull(reader, 12),
                reader.GetFieldValue<DateTimeOffset>(13),
                GetDateTimeOffsetOrNull(reader, 14),
                reader.GetBoolean(15)),
            cancellationToken);

    public async Task<CoachingSessionDetail?> GetCoachingSessionAsync(
        Guid sessionId,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        if (!await CanViewCoachingSessionAsync(sessionId, currentUser, cancellationToken))
        {
            return null;
        }

        var rows = await QueryAsync(
            """
            SELECT session.id, session.record_id, session.cycle_id, cycle.cycle_number,
                   session.staff_id, staff.display_name, session.coach_staff_id, coach.display_name,
                   session.session_number, session.session_date, session.session_type, session.delivery_method,
                   session.duration_minutes, session.status, session.progress_reflection, session.main_focus,
                   session.additional_focus_json, session.session_reason, session.goal, session.why_this_matters,
                   session.confidence_before, session.current_situation, session.whats_working, session.challenges,
                   session.key_discussion_points, session.support_types_json, session.support_resources,
                   session.intended_impact_areas_json, session.impact_statement, session.confidence_to_complete,
                   session.support_needed_json, session.additional_support_details, session.key_takeaway,
                   session.session_summary, session.staff_agrees, session.coach_agrees,
                   session.another_session_required, session.next_session_date, session.next_focus,
                   session.completed_at, session.created_by_user_account_id, session.created_at, session.updated_at,
                   development_stage.value_key, session.focus_area_keys_json, session.additional_focus_text,
                   session.intended_impact_text, session.intended_impact_descriptor_id,
                   session.intended_impact_wording_snapshot, session.mentor_comments
            FROM quality.coaching_sessions session
            JOIN quality.coaching_cycles cycle ON cycle.id = session.cycle_id
            JOIN people.staff staff ON staff.id = session.staff_id
            JOIN people.staff coach ON coach.id = session.coach_staff_id
            LEFT JOIN core.lookup_values development_stage ON development_stage.id = session.development_stage_lookup_value_id
            WHERE session.id = @sessionId AND session.archived_at IS NULL;
            """,
            command => command.Parameters.AddWithValue("@sessionId", sessionId),
            reader => new CoachingSessionDbRow(
                reader.GetGuid(0), reader.GetGuid(1), reader.GetGuid(2), reader.GetInt32(3),
                reader.GetGuid(4), reader.GetString(5), reader.GetGuid(6), reader.GetString(7),
                reader.GetInt32(8), DateOnly.FromDateTime(reader.GetDateTime(9)), reader.GetString(10),
                GetStringOrNull(reader, 11), reader.IsDBNull(12) ? null : reader.GetInt32(12), reader.GetString(13),
                GetStringOrNull(reader, 14), GetStringOrNull(reader, 15), GetStringOrNull(reader, 16),
                GetStringOrNull(reader, 17), GetStringOrNull(reader, 18), GetStringOrNull(reader, 19),
                reader.IsDBNull(20) ? null : reader.GetByte(20), GetStringOrNull(reader, 21),
                GetStringOrNull(reader, 22), GetStringOrNull(reader, 23), GetStringOrNull(reader, 24),
                GetStringOrNull(reader, 25), GetStringOrNull(reader, 26), GetStringOrNull(reader, 27),
                GetStringOrNull(reader, 28), reader.IsDBNull(29) ? null : reader.GetByte(29),
                GetStringOrNull(reader, 30), GetStringOrNull(reader, 31), GetStringOrNull(reader, 32),
                GetStringOrNull(reader, 33), reader.GetBoolean(34), reader.GetBoolean(35),
                GetStringOrNull(reader, 36), GetDateOnlyOrNull(reader, 37), GetStringOrNull(reader, 38),
                GetDateTimeOffsetOrNull(reader, 39), GetGuidOrNull(reader, 40),
                reader.GetFieldValue<DateTimeOffset>(41), GetDateTimeOffsetOrNull(reader, 42),
                GetStringOrNull(reader, 43), GetStringOrNull(reader, 44), GetStringOrNull(reader, 45),
                GetStringOrNull(reader, 46), GetGuidOrNull(reader, 47), GetStringOrNull(reader, 48),
                GetStringOrNull(reader, 49)),
            cancellationToken);
        if (rows.Count == 0)
        {
            return null;
        }

        var row = rows[0];
        var previousActions = await GetCoachingPreviousActionsAsync(row.CycleId, row.SessionNumber, cancellationToken);
        var previousUpdates = await QueryAsync(
            """
            SELECT action_id, status, update_text
            FROM quality.coaching_previous_action_updates
            WHERE session_id = @sessionId;
            """,
            command => command.Parameters.AddWithValue("@sessionId", sessionId),
            reader => new CoachingPreviousActionUpdateSummary(reader.GetGuid(0), reader.GetString(1), GetStringOrNull(reader, 2)),
            cancellationToken);
        var actions = await QueryAsync(
            """
            SELECT action.id, action.id, action.source_display_order, action.title,
                   COALESCE(action.owner_context, 'staff'), action.due_date, action.detail
            FROM quality.actions action
            WHERE action.source_sub_record_type = 'coaching_session'
              AND action.source_sub_record_id = @sessionId
              AND action.archived_at IS NULL
            ORDER BY action.source_display_order, action.created_at;
            """,
            command => command.Parameters.AddWithValue("@sessionId", sessionId),
            reader => new CoachingSessionActionSummary(
                reader.GetGuid(0),
                GetGuidOrNull(reader, 1),
                reader.GetInt32(2),
                reader.GetString(3),
                reader.GetString(4),
                DateOnly.FromDateTime(reader.GetDateTime(5)),
                GetStringOrNull(reader, 6)),
            cancellationToken);

        var canEdit = currentUser.HasPermission(PermissionKeys.CoachingManage)
            || (row.Status == "draft"
                && (row.CreatedByUserAccountId == currentUser.UserAccountId || row.CoachStaffId == currentUser.StaffId));

        return new CoachingSessionDetail(
            row.Id, row.RecordId, row.CycleId, row.CycleNumber, row.StaffId, row.StaffName,
            row.CoachStaffId, row.CoachName, row.SessionNumber, row.SessionDate, row.SessionType,
            row.DeliveryMethod, row.DurationMinutes, row.Status, row.DevelopmentStageKey,
            ParseCoachingFocusAreas(row.FocusAreaKeysJson, row.MainFocus, row.AdditionalFocusJson), row.AdditionalFocusText,
            row.ProgressReflection, row.MainFocus,
            ParseCoachingJsonList(row.AdditionalFocusJson), row.SessionReason, row.Goal, row.WhyThisMatters,
            row.IntendedImpactText ?? row.WhyThisMatters, row.IntendedImpactDescriptorId,
            row.IntendedImpactWordingSnapshot, row.ConfidenceBefore, row.CurrentSituation, row.WhatsWorking,
            row.Challenges, row.KeyDiscussionPoints, ParseCoachingJsonList(row.SupportTypesJson), row.SupportResources,
            row.MentorComments,
            ParseCoachingJsonList(row.IntendedImpactAreasJson), row.ImpactStatement, row.ConfidenceToComplete,
            ParseCoachingJsonList(row.SupportNeededJson), row.AdditionalSupportDetails, row.KeyTakeaway,
            row.SessionSummary, row.StaffAgrees, row.CoachAgrees, row.AnotherSessionRequired,
            row.NextSessionDate, row.NextFocus, row.CompletedAt, canEdit, previousActions, previousUpdates, actions);
    }

    public async Task<CoachingSessionSaveSummary> SaveCoachingSessionAsync(
        Guid? sessionId,
        SaveCoachingSessionRequest request,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        if (!currentUser.UserAccountId.HasValue || !currentUser.StaffId.HasValue)
        {
            throw new WorkflowValidationException("A linked staff account is required to save a coaching record.");
        }

        if (!currentUser.HasPermission(PermissionKeys.CoachingSubmit)
            && !currentUser.HasPermission(PermissionKeys.CoachingManage))
        {
            throw new WorkflowValidationException("You do not have permission to save coaching records.");
        }

        ValidateCoachingRequest(request);
        if (!sessionId.HasValue
            && !await CanStartCoachingForStaffAsync(request.StaffId, currentUser, cancellationToken))
        {
            throw new WorkflowValidationException("You cannot create a coaching record for this staff member.");
        }

        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            await ValidateCoachingConfigurationAsync(connection, transaction, request, cancellationToken);
            var staff = await GetCoachingStaffForUpdateAsync(connection, transaction, request.StaffId, cancellationToken);
            var targetSessionId = sessionId ?? Guid.NewGuid();
            Guid recordId;
            Guid cycleId;
            Guid coachStaffId;
            int cycleNumber;
            int sessionNumber;
            string previousStatus;

            if (sessionId.HasValue)
            {
                var existing = await GetCoachingSessionForUpdateAsync(connection, transaction, sessionId.Value, cancellationToken)
                    ?? throw new WorkflowValidationException("The coaching session was not found.");
                var canEdit = currentUser.HasPermission(PermissionKeys.CoachingManage)
                    || (existing.Status == "draft"
                        && (existing.CreatedByUserAccountId == currentUser.UserAccountId || existing.CoachStaffId == currentUser.StaffId));
                if (!canEdit)
                {
                    throw new WorkflowValidationException("This coaching session is locked or belongs to another coach.");
                }

                if (existing.StaffId != request.StaffId)
                {
                    throw new WorkflowValidationException("The staff member cannot be changed after a coaching session is created.");
                }

                if (existing.Status == "completed" && request.Status.Equals("draft", StringComparison.OrdinalIgnoreCase))
                {
                    throw new WorkflowValidationException("A completed coaching session cannot be returned to draft.");
                }

                recordId = existing.RecordId;
                cycleId = existing.CycleId;
                coachStaffId = existing.CoachStaffId;
                cycleNumber = existing.CycleNumber;
                sessionNumber = existing.SessionNumber;
                previousStatus = existing.Status;
            }
            else
            {
                previousStatus = "new";
                if (request.CycleId.HasValue)
                {
                    var cycle = await GetCoachingCycleForUpdateAsync(connection, transaction, request.CycleId.Value, cancellationToken)
                        ?? throw new WorkflowValidationException("The selected coaching cycle was not found.");
                    if (cycle.StaffId != request.StaffId)
                    {
                        throw new WorkflowValidationException("The selected coaching cycle belongs to another staff member.");
                    }

                    if (cycle.Status == "closed" && !currentUser.HasPermission(PermissionKeys.CoachingManage))
                    {
                        throw new WorkflowValidationException("This coaching cycle is closed. Start a new cycle instead.");
                    }

                    cycleId = cycle.Id;
                    coachStaffId = cycle.CoachStaffId;
                    cycleNumber = cycle.CycleNumber;
                    sessionNumber = cycle.SessionCount + 1;
                }
                else
                {
                    if (!request.CreateNewCycle)
                    {
                        throw new WorkflowValidationException("Choose an existing coaching cycle or start a new one.");
                    }

                    var coach = await ResolveCoachAsync(connection, transaction, request.StaffId, currentUser.StaffId.Value, cancellationToken);
                    coachStaffId = coach.Id;
                    cycleNumber = await GetNextCoachingCycleNumberAsync(connection, transaction, request.StaffId, cancellationToken);
                    cycleId = Guid.NewGuid();
                    sessionNumber = 1;

                    await using var cycleCommand = new SqlCommand(
                        """
                        INSERT INTO quality.coaching_cycles (
                            id, staff_id, coach_staff_id, cycle_number, cycle_type, status, started_on, created_by_user_account_id
                        )
                        VALUES (
                            @id, @staffId, @coachStaffId, @cycleNumber, @cycleType, 'active', @startedOn, @userAccountId
                        );
                        """,
                        connection,
                        transaction);
                    cycleCommand.Parameters.AddWithValue("@id", cycleId);
                    cycleCommand.Parameters.AddWithValue("@staffId", request.StaffId);
                    cycleCommand.Parameters.AddWithValue("@coachStaffId", coachStaffId);
                    cycleCommand.Parameters.AddWithValue("@cycleNumber", cycleNumber);
                    cycleCommand.Parameters.AddWithValue("@cycleType", request.SessionType.ToLowerInvariant());
                    cycleCommand.Parameters.AddWithValue("@startedOn", request.SessionDate.ToDateTime(TimeOnly.MinValue));
                    cycleCommand.Parameters.AddWithValue("@userAccountId", currentUser.UserAccountId.Value);
                    await cycleCommand.ExecuteNonQueryAsync(cancellationToken);
                }

                recordId = Guid.NewGuid();
                await using var recordCommand = new SqlCommand(
                    """
                    INSERT INTO core.records (
                        id, module_id, record_type, title, summary, status_lookup_value_id,
                        subject_staff_id, owner_staff_id, org_unit_id, record_date, created_by_user_account_id
                    )
                    VALUES (
                        @recordId,
                        (SELECT TOP (1) id FROM core.modules WHERE module_key = 'coaching_mentoring' AND archived_at IS NULL),
                        'coaching_session', @title, @summary,
                        (SELECT TOP (1) value.id FROM core.lookup_values value
                         JOIN core.lookup_types type ON type.id = value.lookup_type_id
                         WHERE type.lookup_key = 'review_status' AND value.value_key = @recordStatus),
                        @staffId, @coachStaffId, @orgUnitId, @sessionDate, @userAccountId
                    );
                    """,
                    connection,
                    transaction);
                AddCoachingRecordParameters(recordCommand, recordId, staff, coachStaffId, cycleNumber, sessionNumber, request, currentUser);
                await recordCommand.ExecuteNonQueryAsync(cancellationToken);

                await using var insertSessionCommand = new SqlCommand(
                    """
                    INSERT INTO quality.coaching_sessions (
                        id, record_id, cycle_id, staff_id, coach_staff_id, session_number, session_date,
                        session_type, status, created_by_user_account_id, updated_by_user_account_id
                    )
                    VALUES (
                        @id, @recordId, @cycleId, @staffId, @coachStaffId, @sessionNumber, @sessionDate,
                        @sessionType, 'draft', @userAccountId, @userAccountId
                    );
                    """,
                    connection,
                    transaction);
                insertSessionCommand.Parameters.AddWithValue("@id", targetSessionId);
                insertSessionCommand.Parameters.AddWithValue("@recordId", recordId);
                insertSessionCommand.Parameters.AddWithValue("@cycleId", cycleId);
                insertSessionCommand.Parameters.AddWithValue("@staffId", request.StaffId);
                insertSessionCommand.Parameters.AddWithValue("@coachStaffId", coachStaffId);
                insertSessionCommand.Parameters.AddWithValue("@sessionNumber", sessionNumber);
                insertSessionCommand.Parameters.AddWithValue("@sessionDate", request.SessionDate.ToDateTime(TimeOnly.MinValue));
                insertSessionCommand.Parameters.AddWithValue("@sessionType", request.SessionType.ToLowerInvariant());
                insertSessionCommand.Parameters.AddWithValue("@userAccountId", currentUser.UserAccountId.Value);
                await insertSessionCommand.ExecuteNonQueryAsync(cancellationToken);
            }

            await UpdateCoachingSessionAsync(
                connection, transaction, targetSessionId, request, currentUser.UserAccountId.Value, cancellationToken);
            await SaveCoachingPreviousActionUpdatesAsync(
                connection, transaction, targetSessionId, cycleId, sessionNumber,
                request.PreviousActionUpdates ?? [], request.Status, currentUser, cancellationToken);
            await SaveCoachingSessionActionsAsync(
                connection, transaction, targetSessionId, recordId, request.StaffId, coachStaffId,
                request.Actions ?? [], request.Status, currentUser, cancellationToken);

            await using (var recordUpdate = new SqlCommand(
                """
                UPDATE core.records
                SET title = @title,
                    summary = @summary,
                    status_lookup_value_id = (
                        SELECT TOP (1) value.id FROM core.lookup_values value
                        JOIN core.lookup_types type ON type.id = value.lookup_type_id
                        WHERE type.lookup_key = 'review_status' AND value.value_key = @recordStatus
                    ),
                    owner_staff_id = @coachStaffId,
                    org_unit_id = @orgUnitId,
                    record_date = @sessionDate,
                    updated_by_user_account_id = @userAccountId,
                    updated_at = sysutcdatetime()
                WHERE id = @recordId;
                """,
                connection,
                transaction))
            {
                AddCoachingRecordParameters(recordUpdate, recordId, staff, coachStaffId, cycleNumber, sessionNumber, request, currentUser);
                await recordUpdate.ExecuteNonQueryAsync(cancellationToken);
            }

            if (request.Status.Equals("completed", StringComparison.OrdinalIgnoreCase))
            {
                await using var cycleStatus = new SqlCommand(
                    """
                    UPDATE quality.coaching_cycles
                    SET status = CASE WHEN @anotherSessionRequired = 'no' THEN 'closed' ELSE 'active' END,
                        closed_on = CASE WHEN @anotherSessionRequired = 'no' THEN @sessionDate ELSE NULL END,
                        updated_at = sysutcdatetime()
                    WHERE id = @cycleId;
                    """,
                    connection,
                    transaction);
                cycleStatus.Parameters.AddWithValue("@anotherSessionRequired", ToDbValue(request.AnotherSessionRequired?.ToLowerInvariant()));
                cycleStatus.Parameters.AddWithValue("@sessionDate", request.SessionDate.ToDateTime(TimeOnly.MinValue));
                cycleStatus.Parameters.AddWithValue("@cycleId", cycleId);
                await cycleStatus.ExecuteNonQueryAsync(cancellationToken);
            }

            await WriteAuditAsync(
                connection,
                transaction,
                currentUser.UserAccountId,
                recordId,
                "coaching_session",
                targetSessionId,
                previousStatus == "new" ? "coaching_session.created" : "coaching_session.updated",
                $"Coaching cycle {cycleNumber}, session {sessionNumber} for {staff.Name} saved as {request.Status.ToLowerInvariant()} by {currentUser.DisplayName}.",
                previousStatus == "new" ? null : JsonSerializer.Serialize(new { status = previousStatus }),
                JsonSerializer.Serialize(new { status = request.Status.ToLowerInvariant(), cycleNumber, sessionNumber }),
                cancellationToken);

            await transaction.CommitAsync(cancellationToken);
            return new CoachingSessionSaveSummary(
                targetSessionId,
                recordId,
                cycleId,
                cycleNumber,
                sessionNumber,
                request.Status.ToLowerInvariant());
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    private async Task<bool> CanViewCoachingSessionAsync(
        Guid sessionId,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        var rows = await QueryAsync(
            """
            WITH visible_staff AS (
                SELECT staff_id FROM org.fn_visible_staff(@currentUserAccountId)
            )
            SELECT 1
            FROM quality.coaching_sessions session
            JOIN people.staff staff ON staff.id = session.staff_id
            WHERE session.id = @sessionId
              AND session.archived_at IS NULL
              AND (
                    @canViewAll = 1
                    OR session.staff_id = @currentStaffId
                    OR session.coach_staff_id = @currentStaffId
                    OR session.created_by_user_account_id = @currentUserAccountId
                    OR (
                        @canViewScoped = 1
                        AND EXISTS (SELECT 1 FROM visible_staff visible WHERE visible.staff_id = session.staff_id)
                    )
              )
            ;
            """,
            command =>
            {
                AddCoachingScopeParameters(command, currentUser);
                command.Parameters.AddWithValue("@sessionId", sessionId);
            },
            reader => reader.GetInt32(0),
            cancellationToken);
        return rows.Count > 0;
    }

    private async Task<IReadOnlyList<CoachingPreviousActionSummary>> GetCoachingPreviousActionsAsync(
        Guid cycleId,
        int? beforeSessionNumber,
        CancellationToken cancellationToken) =>
        await QueryAsync(
            """
            SELECT action.id, action.title, action.due_date,
                   CASE status.value_key
                       WHEN 'in_progress' THEN 'in_progress'
                       WHEN 'complete' THEN 'completed'
                       WHEN 'not_applicable' THEN 'not_applicable'
                       ELSE 'not_started'
                   END,
                    latest_update.update_text,
                    (SELECT COUNT(*) FROM quality.action_extensions extension WHERE extension.action_id = action.id),
                    latest_extension.reason
            FROM quality.actions action
            JOIN quality.coaching_sessions origin
              ON action.source_sub_record_type = 'coaching_session'
             AND origin.id = action.source_sub_record_id
            LEFT JOIN core.lookup_values status ON status.id = action.status_lookup_value_id
            OUTER APPLY (
                SELECT TOP (1) update_row.update_text
                FROM quality.coaching_previous_action_updates update_row
                JOIN quality.coaching_sessions update_session ON update_session.id = update_row.session_id
                WHERE update_row.action_id = action.id
                  AND update_session.status = 'completed'
                ORDER BY update_session.session_number DESC, update_row.updated_at DESC, update_row.created_at DESC
            ) latest_update
            OUTER APPLY (
                SELECT TOP (1) extension.reason
                FROM quality.action_extensions extension
                WHERE extension.action_id = action.id
                ORDER BY extension.created_at DESC
            ) latest_extension
            WHERE origin.cycle_id = @cycleId
              AND origin.status = 'completed'
              AND (@beforeSessionNumber IS NULL OR origin.session_number < @beforeSessionNumber)
              AND action.archived_at IS NULL
              AND action.completed_date IS NULL
              AND ISNULL(status.value_key, 'open') NOT IN ('complete', 'cancelled')
            ORDER BY action.due_date, action.title;
            """,
            command =>
            {
                command.Parameters.AddWithValue("@cycleId", cycleId);
                command.Parameters.AddWithValue("@beforeSessionNumber", beforeSessionNumber.HasValue ? beforeSessionNumber.Value : DBNull.Value);
            },
            reader => new CoachingPreviousActionSummary(
                reader.GetGuid(0),
                reader.GetString(1),
                GetDateOnlyOrNull(reader, 2),
                reader.GetString(3),
                GetStringOrNull(reader, 4),
                reader.GetInt32(5),
                GetStringOrNull(reader, 6)),
            cancellationToken);

    private async Task<CoachingCoachRow> ResolveCoachAsync(
        Guid staffId,
        Guid? currentStaffId,
        CancellationToken cancellationToken)
    {
        var rows = await QueryAsync(
            CoachingCoachResolutionSql,
            command =>
            {
                command.Parameters.AddWithValue("@staffId", staffId);
                command.Parameters.AddWithValue("@currentStaffId", ToDbValue(currentStaffId));
            },
            reader => new CoachingCoachRow(reader.GetGuid(0), reader.GetString(1), reader.GetString(2)),
            cancellationToken);
        return rows.FirstOrDefault()
            ?? throw new WorkflowValidationException("No coach or mentor could be resolved for this staff member.");
    }

    private static async Task<CoachingCoachRow> ResolveCoachAsync(
        SqlConnection connection,
        SqlTransaction transaction,
        Guid staffId,
        Guid currentStaffId,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(CoachingCoachResolutionSql, connection, transaction);
        command.Parameters.AddWithValue("@staffId", staffId);
        command.Parameters.AddWithValue("@currentStaffId", currentStaffId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            throw new WorkflowValidationException("No coach or mentor could be resolved for this staff member.");
        }

        return new CoachingCoachRow(reader.GetGuid(0), reader.GetString(1), reader.GetString(2));
    }

    private const string CoachingCoachResolutionSql =
        """
        SELECT TOP (1) candidate.id, candidate.display_name, candidate.source
        FROM (
            SELECT coach.id, coach.display_name, CONVERT(nvarchar(30), 'assigned') AS source, 1 AS priority,
                   assignment.is_primary, assignment.effective_from
            FROM quality.coaching_assignments assignment
            JOIN people.staff coach ON coach.id = assignment.coach_staff_id
            WHERE assignment.staff_id = @staffId
              AND assignment.effective_from <= CONVERT(date, sysutcdatetime())
              AND (assignment.effective_to IS NULL OR assignment.effective_to >= CONVERT(date, sysutcdatetime()))
              AND assignment.archived_at IS NULL
              AND coach.account_status = 'active'
              AND coach.archived_at IS NULL
            UNION ALL
            SELECT manager.id, manager.display_name, CONVERT(nvarchar(30), 'line_manager'), 2, CONVERT(bit, 1), CONVERT(date, '19000101')
            FROM people.staff staff
            JOIN people.staff manager ON manager.id = staff.line_manager_staff_id
            WHERE staff.id = @staffId AND manager.account_status = 'active' AND manager.archived_at IS NULL
            UNION ALL
            SELECT current_staff.id, current_staff.display_name, CONVERT(nvarchar(30), 'current_user'), 3, CONVERT(bit, 1), CONVERT(date, '19000101')
            FROM people.staff current_staff
            WHERE current_staff.id = @currentStaffId AND current_staff.account_status = 'active' AND current_staff.archived_at IS NULL
        ) candidate
        ORDER BY candidate.priority, candidate.is_primary DESC, candidate.effective_from DESC;
        """;

    private static async Task<CoachingStaffRow> GetCoachingStaffForUpdateAsync(
        SqlConnection connection,
        SqlTransaction transaction,
        Guid staffId,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            """
            SELECT display_name, primary_org_unit_id
            FROM people.staff WITH (UPDLOCK, HOLDLOCK)
            WHERE id = @staffId AND account_status = 'active' AND archived_at IS NULL;
            """,
            connection,
            transaction);
        command.Parameters.AddWithValue("@staffId", staffId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            throw new WorkflowValidationException("The selected staff member is not active.");
        }

        return new CoachingStaffRow(reader.GetString(0), GetGuidOrNull(reader, 1));
    }

    private static async Task<CoachingSessionLockRow?> GetCoachingSessionForUpdateAsync(
        SqlConnection connection,
        SqlTransaction transaction,
        Guid sessionId,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            """
            SELECT session.record_id, session.cycle_id, session.staff_id, session.coach_staff_id,
                   cycle.cycle_number, session.session_number, session.status, session.created_by_user_account_id
            FROM quality.coaching_sessions session WITH (UPDLOCK, HOLDLOCK)
            JOIN quality.coaching_cycles cycle ON cycle.id = session.cycle_id
            WHERE session.id = @sessionId AND session.archived_at IS NULL;
            """,
            connection,
            transaction);
        command.Parameters.AddWithValue("@sessionId", sessionId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken)
            ? new CoachingSessionLockRow(
                reader.GetGuid(0), reader.GetGuid(1), reader.GetGuid(2), reader.GetGuid(3),
                reader.GetInt32(4), reader.GetInt32(5), reader.GetString(6), GetGuidOrNull(reader, 7))
            : null;
    }

    private static async Task<CoachingCycleLockRow?> GetCoachingCycleForUpdateAsync(
        SqlConnection connection,
        SqlTransaction transaction,
        Guid cycleId,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            """
            SELECT cycle.id, cycle.staff_id, cycle.coach_staff_id, cycle.cycle_number, cycle.status,
                   (SELECT COUNT(*) FROM quality.coaching_sessions session
                    WHERE session.cycle_id = cycle.id AND session.archived_at IS NULL)
            FROM quality.coaching_cycles cycle WITH (UPDLOCK, HOLDLOCK)
            WHERE cycle.id = @cycleId AND cycle.archived_at IS NULL;
            """,
            connection,
            transaction);
        command.Parameters.AddWithValue("@cycleId", cycleId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken)
            ? new CoachingCycleLockRow(
                reader.GetGuid(0), reader.GetGuid(1), reader.GetGuid(2), reader.GetInt32(3),
                reader.GetString(4), reader.GetInt32(5))
            : null;
    }

    private static async Task<int> GetNextCoachingCycleNumberAsync(
        SqlConnection connection,
        SqlTransaction transaction,
        Guid staffId,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            """
            SELECT ISNULL(MAX(cycle_number), 0) + 1
            FROM quality.coaching_cycles WITH (UPDLOCK, HOLDLOCK)
            WHERE staff_id = @staffId;
            """,
            connection,
            transaction);
        command.Parameters.AddWithValue("@staffId", staffId);
        return Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken));
    }

    private static async Task UpdateCoachingSessionAsync(
        SqlConnection connection,
        SqlTransaction transaction,
        Guid sessionId,
        SaveCoachingSessionRequest request,
        Guid userAccountId,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            """
            UPDATE quality.coaching_sessions
            SET session_date = @sessionDate,
                session_type = @sessionType,
                delivery_method = @deliveryMethod,
                duration_minutes = @durationMinutes,
                status = @status,
                development_stage_lookup_value_id = (
                    SELECT TOP (1) value.id
                    FROM core.lookup_values value
                    JOIN core.lookup_types type ON type.id = value.lookup_type_id
                    WHERE type.lookup_key = 'coaching_development_stage'
                      AND value.value_key = @developmentStageKey
                ),
                focus_area_keys_json = @focusAreaKeysJson,
                additional_focus_text = @additionalFocus,
                progress_reflection = @progressReflection,
                session_reason = @sessionReason,
                goal = @goal,
                intended_impact_text = @intendedImpact,
                intended_impact_descriptor_id = @intendedImpactDescriptorId,
                intended_impact_wording_snapshot = (
                    SELECT TOP (1) descriptor.visible_wording
                    FROM quality.elevate_practice_rubric_descriptors descriptor
                    WHERE descriptor.id = @intendedImpactDescriptorId
                ),
                intended_impact_hidden_score = (
                    SELECT TOP (1) descriptor.hidden_numeric_value
                    FROM quality.elevate_practice_rubric_descriptors descriptor
                    WHERE descriptor.id = @intendedImpactDescriptorId
                ),
                current_situation = @currentSituation,
                whats_working = @whatsWorking,
                challenges = @challenges,
                key_discussion_points = @keyDiscussionPoints,
                support_types_json = @supportTypesJson,
                mentor_comments = @mentorComments,
                completed_at = CASE WHEN @status = 'completed' THEN COALESCE(completed_at, sysutcdatetime()) ELSE NULL END,
                updated_by_user_account_id = @userAccountId,
                updated_at = sysutcdatetime()
            WHERE id = @sessionId;
            """,
            connection,
            transaction);
        command.Parameters.AddWithValue("@sessionId", sessionId);
        AddCoachingSessionParameters(command, request);
        command.Parameters.AddWithValue("@userAccountId", userAccountId);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task SaveCoachingPreviousActionUpdatesAsync(
        SqlConnection connection,
        SqlTransaction transaction,
        Guid sessionId,
        Guid cycleId,
        int sessionNumber,
        IReadOnlyList<CoachingPreviousActionUpdateRequest> updates,
        string sessionStatus,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        foreach (var update in updates.GroupBy(item => item.ActionId).Select(group => group.Last()))
        {
            await using var command = new SqlCommand(
                """
                IF NOT EXISTS (
                    SELECT 1
                    FROM quality.actions action
                    JOIN quality.coaching_sessions origin
                      ON action.source_sub_record_type = 'coaching_session'
                     AND origin.id = action.source_sub_record_id
                    WHERE action.id = @actionId
                      AND origin.cycle_id = @cycleId
                      AND origin.session_number < @sessionNumber
                      AND origin.status = 'completed'
                      AND action.archived_at IS NULL
                )
                    THROW 51000, 'A previous action does not belong to this coaching cycle.', 1;

                UPDATE quality.coaching_previous_action_updates
                SET status = @status, update_text = @updateText, updated_at = sysutcdatetime()
                WHERE session_id = @sessionId AND action_id = @actionId;

                IF @@ROWCOUNT = 0
                BEGIN
                    INSERT INTO quality.coaching_previous_action_updates (session_id, action_id, status, update_text)
                    VALUES (@sessionId, @actionId, @status, @updateText);
                END;
                """,
                connection,
                transaction);
            command.Parameters.AddWithValue("@sessionId", sessionId);
            command.Parameters.AddWithValue("@actionId", update.ActionId);
            command.Parameters.AddWithValue("@cycleId", cycleId);
            command.Parameters.AddWithValue("@sessionNumber", sessionNumber);
            command.Parameters.AddWithValue("@status", update.Status.ToLowerInvariant());
            command.Parameters.AddWithValue("@updateText", ToDbValue(update.UpdateText));
            await command.ExecuteNonQueryAsync(cancellationToken);

            if (!sessionStatus.Equals("completed", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var lookupStatus = update.Status.ToLowerInvariant() switch
            {
                "not_started" => "open",
                "in_progress" => "open",
                "completed" => "complete",
                "not_applicable" => "cancelled",
                _ => "open"
            };
            var isClosed = lookupStatus is "complete" or "cancelled";
            var isCancelled = lookupStatus == "cancelled";

            await using var actionCommand = new SqlCommand(
                """
                UPDATE quality.actions
                SET status_lookup_value_id = (
                        SELECT TOP (1) value.id
                        FROM core.lookup_values value
                        JOIN core.lookup_types type ON type.id = value.lookup_type_id
                        WHERE type.lookup_key = 'action_status' AND value.value_key = @statusKey
                    ),
                    completed_date = CASE WHEN @isClosed = 1 THEN CONVERT(date, sysutcdatetime()) ELSE NULL END,
                    completion_note = @updateText,
                    completed_by_user_account_id = CASE WHEN @isClosed = 1 THEN @userAccountId ELSE NULL END,
                    cancelled_at = CASE WHEN @isCancelled = 1 THEN sysutcdatetime() ELSE NULL END,
                    cancelled_by_user_account_id = CASE WHEN @isCancelled = 1 THEN @userAccountId ELSE NULL END,
                    cancellation_comments = CASE WHEN @isCancelled = 1 THEN @updateText ELSE NULL END,
                    updated_by_user_account_id = @userAccountId,
                    updated_at = sysutcdatetime()
                WHERE id = @actionId AND archived_at IS NULL;
                """,
                connection,
                transaction);
            actionCommand.Parameters.AddWithValue("@statusKey", lookupStatus);
            actionCommand.Parameters.AddWithValue("@isClosed", isClosed);
            actionCommand.Parameters.AddWithValue("@isCancelled", isCancelled);
            actionCommand.Parameters.AddWithValue("@updateText", ToDbValue(update.UpdateText));
            actionCommand.Parameters.AddWithValue("@userAccountId", currentUser.UserAccountId!.Value);
            actionCommand.Parameters.AddWithValue("@actionId", update.ActionId);
            await actionCommand.ExecuteNonQueryAsync(cancellationToken);
        }
    }

    private static async Task SaveCoachingSessionActionsAsync(
        SqlConnection connection,
        SqlTransaction transaction,
        Guid sessionId,
        Guid recordId,
        Guid staffId,
        Guid coachStaffId,
        IReadOnlyList<CoachingSessionActionRequest> actions,
        string sessionStatus,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        var existing = new HashSet<Guid>();
        await using (var shiftCommand = new SqlCommand(
            """
            UPDATE quality.actions
            SET source_display_order = source_display_order + 1000
            WHERE source_sub_record_type = 'coaching_session'
              AND source_sub_record_id = @sessionId
              AND archived_at IS NULL;
            """,
            connection,
            transaction))
        {
            shiftCommand.Parameters.AddWithValue("@sessionId", sessionId);
            await shiftCommand.ExecuteNonQueryAsync(cancellationToken);
        }

        await using (var existingCommand = new SqlCommand(
            """
            SELECT id
            FROM quality.actions
            WHERE source_sub_record_type = 'coaching_session'
              AND source_sub_record_id = @sessionId
              AND archived_at IS NULL;
            """,
            connection,
            transaction))
        {
            existingCommand.Parameters.AddWithValue("@sessionId", sessionId);
            await using var reader = await existingCommand.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                existing.Add(reader.GetGuid(0));
            }
        }

        var retained = new HashSet<Guid>();
        var normalized = actions
            .Where(action => !string.IsNullOrWhiteSpace(action.ActionText))
            .ToArray();
        for (var index = 0; index < normalized.Length; index++)
        {
            var requestAction = normalized[index];
            var rowId = requestAction.Id.HasValue && existing.Contains(requestAction.Id.Value)
                ? requestAction.Id.Value
                : Guid.NewGuid();
            retained.Add(rowId);

            await using var command = new SqlCommand(
                """
                UPDATE quality.actions
                SET source_display_order = @actionOrder,
                    title = @actionText,
                    owner_context = @ownerType,
                    owner_staff_id = @ownerStaffId,
                    due_date = @targetDate,
                    original_due_date = COALESCE(original_due_date, @targetDate),
                    detail = @evidenceText,
                    published_to_staff = @publishedToStaff,
                    visibility_setting = @visibilitySetting,
                    updated_by_user_account_id = @userAccountId,
                    updated_at = sysutcdatetime()
                WHERE id = @id
                  AND source_sub_record_type = 'coaching_session'
                  AND source_sub_record_id = @sessionId;

                IF @@ROWCOUNT = 0
                BEGIN
                    INSERT INTO quality.actions (
                        id, source_record_id, source_form_type, source_sub_record_type, source_sub_record_id,
                        source_display_order, owner_context, subject_staff_id, owner_staff_id, title, detail,
                        priority_lookup_value_id, status_lookup_value_id, due_date, original_due_date,
                        published_to_staff, visibility_setting, created_by_user_account_id
                    )
                    VALUES (
                        @id, @recordId, 'coaching_mentoring', 'coaching_session', @sessionId,
                        @actionOrder, @ownerType, @staffId, @ownerStaffId, @actionText, @evidenceText,
                        (SELECT TOP (1) value.id FROM core.lookup_values value
                         JOIN core.lookup_types type ON type.id = value.lookup_type_id
                         WHERE type.lookup_key = 'priority' AND value.value_key = 'medium'),
                        (SELECT TOP (1) value.id FROM core.lookup_values value
                         JOIN core.lookup_types type ON type.id = value.lookup_type_id
                         WHERE type.lookup_key = 'action_status' AND value.value_key = 'open'),
                        @targetDate, @targetDate, @publishedToStaff, @visibilitySetting, @userAccountId
                    );
                END;
                """,
                connection,
                transaction);
            command.Parameters.AddWithValue("@id", rowId);
            command.Parameters.AddWithValue("@sessionId", sessionId);
            command.Parameters.AddWithValue("@recordId", recordId);
            command.Parameters.AddWithValue("@staffId", staffId);
            command.Parameters.AddWithValue("@actionOrder", index + 1);
            command.Parameters.AddWithValue("@actionText", requestAction.ActionText.Trim());
            command.Parameters.AddWithValue("@ownerType", requestAction.OwnerType.ToLowerInvariant());
            command.Parameters.AddWithValue("@ownerStaffId", requestAction.OwnerType.Equals("coach", StringComparison.OrdinalIgnoreCase) ? coachStaffId : staffId);
            command.Parameters.AddWithValue("@targetDate", requestAction.TargetDate.ToDateTime(TimeOnly.MinValue));
            command.Parameters.AddWithValue("@evidenceText", ToDbValue(requestAction.EvidenceText));
            command.Parameters.AddWithValue("@publishedToStaff", sessionStatus.Equals("completed", StringComparison.OrdinalIgnoreCase));
            command.Parameters.AddWithValue("@visibilitySetting", sessionStatus.Equals("completed", StringComparison.OrdinalIgnoreCase) ? "staff_and_management" : "source_editors");
            command.Parameters.AddWithValue("@userAccountId", currentUser.UserAccountId!.Value);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        foreach (var removed in existing.Except(retained))
        {
            await using var archiveCommand = new SqlCommand(
                """
                UPDATE quality.actions
                SET archived_at = sysutcdatetime(),
                    deleted_by_user_account_id = @userAccountId,
                    deletion_reason = 'Removed while editing the coaching session draft.',
                    updated_by_user_account_id = @userAccountId,
                    updated_at = sysutcdatetime()
                WHERE id = @id;
                """,
                connection,
                transaction);
            archiveCommand.Parameters.AddWithValue("@id", removed);
            archiveCommand.Parameters.AddWithValue("@userAccountId", currentUser.UserAccountId!.Value);
            await archiveCommand.ExecuteNonQueryAsync(cancellationToken);
        }
    }

    private static void ValidateCoachingRequest(SaveCoachingSessionRequest request)
    {
        if (request.StaffId == Guid.Empty)
        {
            throw new WorkflowValidationException("Select a staff member for the coaching session.");
        }

        if (request.SessionDate == default)
        {
            throw new WorkflowValidationException("Enter the session date.");
        }

        ValidateCoachingOption(request.SessionType, CoachingSessionTypes, "session type", true);
        ValidateCoachingOption(request.DeliveryMethod, CoachingDeliveryMethods, "delivery method", false);
        ValidateCoachingOption(request.SessionReason, CoachingReasons, "reason for session", false);

        if (!string.Equals(request.Status, "draft", StringComparison.OrdinalIgnoreCase)
            && !string.Equals(request.Status, "completed", StringComparison.OrdinalIgnoreCase))
        {
            throw new WorkflowValidationException("The coaching session status must be Draft or Completed.");
        }

        if (request.DurationMinutes is < 1 or > 1440)
        {
            throw new WorkflowValidationException("Duration must be between 1 minute and 24 hours.");
        }

        foreach (var action in request.Actions ?? [])
        {
            if (string.IsNullOrWhiteSpace(action.ActionText))
            {
                throw new WorkflowValidationException("Every agreed action needs a description.");
            }

            ValidateCoachingOption(action.OwnerType, CoachingActionOwners, "action owner", true);
            if (action.TargetDate == default)
            {
                throw new WorkflowValidationException("Every agreed action needs a target date.");
            }
        }

        foreach (var update in request.PreviousActionUpdates ?? [])
        {
            ValidateCoachingOption(update.Status, CoachingPreviousActionStatuses, "previous action status", true);
        }

        if (!string.Equals(request.Status, "completed", StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        if (string.IsNullOrWhiteSpace(request.DeliveryMethod)
            || !request.DurationMinutes.HasValue
            || string.IsNullOrWhiteSpace(request.DevelopmentStageKey)
            || request.FocusAreas is null || request.FocusAreas.Count == 0
            || string.IsNullOrWhiteSpace(request.SessionReason)
            || string.IsNullOrWhiteSpace(request.Goal)
            || string.IsNullOrWhiteSpace(request.IntendedImpact)
            || !request.IntendedImpactDescriptorId.HasValue
            || string.IsNullOrWhiteSpace(request.KeyDiscussionPoints)
            )
        {
            throw new WorkflowValidationException("Complete the session details, development stage, focus, goal, intended impact and discussion before completing the session.");
        }
    }

    private static async Task ValidateCoachingConfigurationAsync(
        SqlConnection connection,
        SqlTransaction transaction,
        SaveCoachingSessionRequest request,
        CancellationToken cancellationToken)
    {
        async Task ValidateLookupValueAsync(string lookupKey, string valueKey, string label)
        {
            await using var command = new SqlCommand(
                """
                SELECT COUNT(*)
                FROM core.lookup_values value
                JOIN core.lookup_types type ON type.id = value.lookup_type_id
                WHERE type.lookup_key = @lookupKey
                  AND value.value_key = @valueKey;
                """,
                connection,
                transaction);
            command.Parameters.AddWithValue("@lookupKey", lookupKey);
            command.Parameters.AddWithValue("@valueKey", valueKey.Trim().ToLowerInvariant());
            if (Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken)) == 0)
            {
                throw new WorkflowValidationException($"The selected {label} is not valid.");
            }
        }

        if (!string.IsNullOrWhiteSpace(request.DevelopmentStageKey))
        {
            await ValidateLookupValueAsync(
                "coaching_development_stage", request.DevelopmentStageKey, "staff development stage");
        }

        foreach (var value in (request.FocusAreas ?? []).Distinct(StringComparer.OrdinalIgnoreCase))
        {
            await ValidateLookupValueAsync("coaching_focus_area", value, "focus area");
        }

        foreach (var value in (request.SupportTypes ?? []).Distinct(StringComparer.OrdinalIgnoreCase))
        {
            await ValidateLookupValueAsync("coaching_support_type", value, "support type");
        }

        if (!request.IntendedImpactDescriptorId.HasValue)
        {
            return;
        }

        await using var descriptorCommand = new SqlCommand(
            "SELECT COUNT(*) FROM quality.elevate_practice_rubric_descriptors WHERE id = @id;",
            connection,
            transaction);
        descriptorCommand.Parameters.AddWithValue("@id", request.IntendedImpactDescriptorId.Value);
        if (Convert.ToInt32(await descriptorCommand.ExecuteScalarAsync(cancellationToken)) == 0)
        {
            throw new WorkflowValidationException("The selected intended impact judgement is not valid.");
        }
    }

    private static void ValidateCoachingOption(
        string? value,
        HashSet<string> allowed,
        string label,
        bool required)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            if (required)
            {
                throw new WorkflowValidationException($"Select a {label}.");
            }

            return;
        }

        if (!allowed.Contains(value))
        {
            throw new WorkflowValidationException($"The selected {label} is not valid.");
        }
    }

    private static void AddCoachingScopeParameters(SqlCommand command, CurrentUser currentUser)
    {
        command.Parameters.AddWithValue("@currentUserAccountId", ToDbValue(currentUser.UserAccountId));
        command.Parameters.AddWithValue("@currentStaffId", ToDbValue(currentUser.StaffId));
        command.Parameters.AddWithValue("@canManage", currentUser.HasPermission(PermissionKeys.CoachingManage));
        command.Parameters.AddWithValue("@canViewAll",
            currentUser.HasPermission(PermissionKeys.CoachingManage)
            || currentUser.HasPermission(PermissionKeys.ReportsViewAll));
        command.Parameters.AddWithValue("@canViewScoped",
            currentUser.HasPermission(PermissionKeys.CoachingSubmit)
            || currentUser.HasPermission(PermissionKeys.ReportsViewScoped));
    }

    private static void AddCoachingSessionParameters(SqlCommand command, SaveCoachingSessionRequest request)
    {
        command.Parameters.AddWithValue("@sessionDate", request.SessionDate.ToDateTime(TimeOnly.MinValue));
        command.Parameters.AddWithValue("@sessionType", request.SessionType.ToLowerInvariant());
        command.Parameters.AddWithValue("@deliveryMethod", ToDbValue(request.DeliveryMethod?.ToLowerInvariant()));
        command.Parameters.AddWithValue("@durationMinutes", request.DurationMinutes.HasValue ? request.DurationMinutes.Value : DBNull.Value);
        command.Parameters.AddWithValue("@status", request.Status.ToLowerInvariant());
        command.Parameters.AddWithValue("@developmentStageKey", ToDbValue(request.DevelopmentStageKey?.ToLowerInvariant()));
        command.Parameters.AddWithValue("@focusAreaKeysJson", ToDbValue(SerializeCoachingList(request.FocusAreas)));
        command.Parameters.AddWithValue("@additionalFocus", ToDbValue(request.AdditionalFocus));
        command.Parameters.AddWithValue("@progressReflection", ToDbValue(request.ProgressReflection));
        command.Parameters.AddWithValue("@sessionReason", ToDbValue(request.SessionReason?.ToLowerInvariant()));
        command.Parameters.AddWithValue("@goal", ToDbValue(request.Goal));
        command.Parameters.AddWithValue("@intendedImpact", ToDbValue(request.IntendedImpact));
        command.Parameters.AddWithValue("@intendedImpactDescriptorId", ToDbValue(request.IntendedImpactDescriptorId));
        command.Parameters.AddWithValue("@currentSituation", ToDbValue(request.CurrentSituation));
        command.Parameters.AddWithValue("@whatsWorking", ToDbValue(request.WhatsWorking));
        command.Parameters.AddWithValue("@challenges", ToDbValue(request.Challenges));
        command.Parameters.AddWithValue("@keyDiscussionPoints", ToDbValue(request.KeyDiscussionPoints));
        command.Parameters.AddWithValue("@supportTypesJson", ToDbValue(SerializeCoachingList(request.SupportTypes)));
        command.Parameters.AddWithValue("@mentorComments", ToDbValue(request.MentorComments));
    }

    private static void AddCoachingRecordParameters(
        SqlCommand command,
        Guid recordId,
        CoachingStaffRow staff,
        Guid coachStaffId,
        int cycleNumber,
        int sessionNumber,
        SaveCoachingSessionRequest request,
        CurrentUser currentUser)
    {
        command.Parameters.AddWithValue("@recordId", recordId);
        command.Parameters.AddWithValue("@title", $"Coaching cycle {cycleNumber}, session {sessionNumber}: {staff.Name}");
        command.Parameters.AddWithValue("@summary", ToDbValue(request.FocusAreas?.FirstOrDefault() ?? request.IntendedImpact ?? "Draft coaching session"));
        command.Parameters.AddWithValue("@recordStatus", request.Status.Equals("completed", StringComparison.OrdinalIgnoreCase) ? "submitted" : "draft");
        command.Parameters.AddWithValue("@staffId", request.StaffId);
        command.Parameters.AddWithValue("@coachStaffId", coachStaffId);
        command.Parameters.AddWithValue("@orgUnitId", ToDbValue(staff.OrgUnitId));
        command.Parameters.AddWithValue("@sessionDate", request.SessionDate.ToDateTime(TimeOnly.MinValue));
        command.Parameters.AddWithValue("@userAccountId", currentUser.UserAccountId!.Value);
    }

    private static string? SerializeCoachingList(IReadOnlyList<string>? values)
    {
        var normalized = values?
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value.Trim().ToLowerInvariant())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray() ?? [];
        return normalized.Length == 0 ? null : JsonSerializer.Serialize(normalized);
    }

    private static IReadOnlyList<string> ParseCoachingJsonList(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return [];
        }

        try
        {
            return JsonSerializer.Deserialize<string[]>(value) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private static IReadOnlyList<string> ParseCoachingFocusAreas(
        string? focusAreaKeysJson,
        string? legacyMainFocus,
        string? legacyAdditionalFocusJson)
    {
        var configured = ParseCoachingJsonList(focusAreaKeysJson);
        if (configured.Count > 0)
        {
            return configured;
        }

        return new[] { legacyMainFocus }
            .Concat(ParseCoachingJsonList(legacyAdditionalFocusJson))
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private sealed record CoachingPersonRow(Guid Id, string Name);
    private sealed record CoachingCoachRow(Guid Id, string Name, string Source);
    private sealed record CoachingStaffRow(string Name, Guid? OrgUnitId);
    private sealed record CoachingCycleLockRow(Guid Id, Guid StaffId, Guid CoachStaffId, int CycleNumber, string Status, int SessionCount);
    private sealed record CoachingSessionLockRow(
        Guid RecordId,
        Guid CycleId,
        Guid StaffId,
        Guid CoachStaffId,
        int CycleNumber,
        int SessionNumber,
        string Status,
        Guid? CreatedByUserAccountId);
    private sealed record CoachingSessionDbRow(
        Guid Id,
        Guid RecordId,
        Guid CycleId,
        int CycleNumber,
        Guid StaffId,
        string StaffName,
        Guid CoachStaffId,
        string CoachName,
        int SessionNumber,
        DateOnly SessionDate,
        string SessionType,
        string? DeliveryMethod,
        int? DurationMinutes,
        string Status,
        string? ProgressReflection,
        string? MainFocus,
        string? AdditionalFocusJson,
        string? SessionReason,
        string? Goal,
        string? WhyThisMatters,
        int? ConfidenceBefore,
        string? CurrentSituation,
        string? WhatsWorking,
        string? Challenges,
        string? KeyDiscussionPoints,
        string? SupportTypesJson,
        string? SupportResources,
        string? IntendedImpactAreasJson,
        string? ImpactStatement,
        int? ConfidenceToComplete,
        string? SupportNeededJson,
        string? AdditionalSupportDetails,
        string? KeyTakeaway,
        string? SessionSummary,
        bool StaffAgrees,
        bool CoachAgrees,
        string? AnotherSessionRequired,
        DateOnly? NextSessionDate,
        string? NextFocus,
        DateTimeOffset? CompletedAt,
        Guid? CreatedByUserAccountId,
        DateTimeOffset CreatedAt,
        DateTimeOffset? UpdatedAt,
        string? DevelopmentStageKey,
        string? FocusAreaKeysJson,
        string? AdditionalFocusText,
        string? IntendedImpactText,
        Guid? IntendedImpactDescriptorId,
        string? IntendedImpactWordingSnapshot,
        string? MentorComments);
}
