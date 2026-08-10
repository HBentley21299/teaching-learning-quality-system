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
        "coaching", "mentoring"
    };

    private static readonly HashSet<string> CoachingDeliveryMethods = new(StringComparer.OrdinalIgnoreCase)
    {
        "in_person", "online", "telephone"
    };

    private static readonly HashSet<string> CoachingActionStatuses = new(StringComparer.OrdinalIgnoreCase)
    {
        "not_started", "in_progress", "completed", "closed"
    };

    private static readonly HashSet<string> CoachingActionOwners = new(StringComparer.OrdinalIgnoreCase)
    {
        "staff", "coach", "joint"
    };

    private static readonly HashSet<string> CoachingReviewOutcomes = new(StringComparer.OrdinalIgnoreCase)
    {
        "completed", "continue", "revised", "closed_without_completion"
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

        var maxActions = await QueryAsync(
            """
            SELECT max_actions_per_session
            FROM quality.coaching_configuration
            WHERE configuration_id = 1;
            """,
            null,
            reader => reader.GetInt32(0),
            cancellationToken);

        return new CoachingConfigurationSummary(
            await GetOptionsAsync("coaching_development_stage"),
            await GetOptionsAsync("coaching_focus_area"),
            await GetOptionsAsync("coaching_support_type"),
            rubric,
            maxActions.FirstOrDefault(3));
    }

    public async Task<int> UpdateCoachingConfigurationAsync(
        UpdateCoachingConfigurationRequest request,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        if (request.MaxActionsPerSession is < 1 or > 10)
        {
            throw new WorkflowValidationException("The maximum actions per session must be between 1 and 10.");
        }

        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var command = new SqlCommand(
            """
            UPDATE quality.coaching_configuration
            SET max_actions_per_session = @maxActions,
                updated_by_user_account_id = @userAccountId,
                updated_at = sysutcdatetime()
            WHERE configuration_id = 1;
            """,
            connection);
        command.Parameters.AddWithValue("@maxActions", request.MaxActionsPerSession);
        command.Parameters.AddWithValue("@userAccountId", ToDbValue(currentUser.UserAccountId));
        await command.ExecuteNonQueryAsync(cancellationToken);

        return request.MaxActionsPerSession;
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
            : await GetCoachingPreviousActionsAsync(selectedCycle.Id, null, null, cancellationToken);

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
                   primary_focus.value_key,
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
            LEFT JOIN core.lookup_values primary_focus ON primary_focus.id = session.primary_focus_lookup_value_id
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
                   session.duration_minutes, session.status, qualification.value_key,
                   primary_focus.value_key, secondary_focus.value_key, session.focus_other_text,
                   session.specific_session_focus, session.current_practice_descriptor_id,
                   session.current_practice_wording_snapshot, session.current_practice_evidence,
                   session.support_types_json, session.support_other_text, session.conversation_summary,
                   session.closes_cycle, session.completed_at, session.created_by_user_account_id,
                   session.created_at, session.updated_at
            FROM quality.coaching_sessions session
            JOIN quality.coaching_cycles cycle ON cycle.id = session.cycle_id
            JOIN people.staff staff ON staff.id = session.staff_id
            JOIN people.staff coach ON coach.id = session.coach_staff_id
            LEFT JOIN core.lookup_values qualification ON qualification.id = session.development_stage_lookup_value_id
            LEFT JOIN core.lookup_values primary_focus ON primary_focus.id = session.primary_focus_lookup_value_id
            LEFT JOIN core.lookup_values secondary_focus ON secondary_focus.id = session.secondary_focus_lookup_value_id
            WHERE session.id = @sessionId AND session.archived_at IS NULL;
            """,
            command => command.Parameters.AddWithValue("@sessionId", sessionId),
            reader => new CoachingSessionDbRow(
                reader.GetGuid(0), reader.GetGuid(1), reader.GetGuid(2), reader.GetInt32(3),
                reader.GetGuid(4), reader.GetString(5), reader.GetGuid(6), reader.GetString(7),
                reader.GetInt32(8), DateOnly.FromDateTime(reader.GetDateTime(9)), reader.GetString(10),
                GetStringOrNull(reader, 11), reader.IsDBNull(12) ? null : reader.GetInt32(12), reader.GetString(13),
                GetStringOrNull(reader, 14), GetStringOrNull(reader, 15), GetStringOrNull(reader, 16),
                GetStringOrNull(reader, 17), GetStringOrNull(reader, 18), GetGuidOrNull(reader, 19),
                GetStringOrNull(reader, 20), GetStringOrNull(reader, 21), GetStringOrNull(reader, 22),
                GetStringOrNull(reader, 23), GetStringOrNull(reader, 24), reader.GetBoolean(25),
                GetDateTimeOffsetOrNull(reader, 26), GetGuidOrNull(reader, 27),
                reader.GetFieldValue<DateTimeOffset>(28), GetDateTimeOffsetOrNull(reader, 29)),
            cancellationToken);
        if (rows.Count == 0)
        {
            return null;
        }

        var row = rows[0];
        var previousActions = await GetCoachingPreviousActionsAsync(row.CycleId, row.SessionNumber, row.Id, cancellationToken);
        var actionReviews = await QueryAsync(
            """
            SELECT review.action_id, review.review_outcome, review.progress_update, review.impact_observed,
                   revised.id, revised.source_display_order, revised.title, COALESCE(revised.owner_context, 'staff'),
                   revised_owner.display_name, revised.due_date, revised.intended_evidence,
                   revised.intended_impact, revised.review_date, COALESCE(revised.progress_status, 'not_started'),
                   revised.parent_action_id, revised.action_theme
            FROM quality.coaching_action_reviews review
            LEFT JOIN quality.actions revised ON revised.id = review.revised_action_id
            LEFT JOIN people.staff revised_owner ON revised_owner.id = revised.owner_staff_id
            WHERE review.session_id = @sessionId
            ORDER BY review.created_at, review.id;
            """,
            command => command.Parameters.AddWithValue("@sessionId", sessionId),
            reader => new CoachingActionReviewSummary(
                reader.GetGuid(0),
                GetStringOrNull(reader, 1),
                GetStringOrNull(reader, 2),
                GetStringOrNull(reader, 3),
                reader.IsDBNull(4)
                    ? null
                    : new CoachingSessionActionSummary(
                        reader.GetGuid(4),
                        reader.GetInt32(5),
                        reader.GetString(15),
                        reader.GetString(6),
                        reader.GetString(7),
                        reader.GetString(8),
                        GetDateOnlyOrNull(reader, 9),
                        GetStringOrNull(reader, 10),
                        GetStringOrNull(reader, 11),
                        GetDateOnlyOrNull(reader, 12),
                        reader.GetString(13),
                        GetGuidOrNull(reader, 14))),
            cancellationToken);
        var actions = await QueryAsync(
            """
            SELECT action.id, action.source_display_order, action.title,
                   COALESCE(action.owner_context, 'staff'), owner.display_name, action.due_date,
                   action.intended_evidence, action.intended_impact, action.review_date,
                   COALESCE(action.progress_status, 'not_started'), action.parent_action_id,
                   action.action_theme
            FROM quality.actions action
            JOIN people.staff owner ON owner.id = action.owner_staff_id
            WHERE action.source_sub_record_type = 'coaching_session'
              AND action.source_sub_record_id = @sessionId
              AND action.archived_at IS NULL
              AND action.parent_action_id IS NULL
            ORDER BY action.source_display_order, action.created_at;
            """,
            command => command.Parameters.AddWithValue("@sessionId", sessionId),
            reader => new CoachingSessionActionSummary(
                reader.GetGuid(0),
                reader.GetInt32(1),
                reader.GetString(11),
                reader.GetString(2),
                reader.GetString(3),
                reader.GetString(4),
                GetDateOnlyOrNull(reader, 5),
                GetStringOrNull(reader, 6),
                GetStringOrNull(reader, 7),
                GetDateOnlyOrNull(reader, 8),
                reader.GetString(9),
                GetGuidOrNull(reader, 10)),
            cancellationToken);

        var canEdit = currentUser.HasPermission(PermissionKeys.CoachingManage)
            || (row.Status == "draft"
                && (row.CreatedByUserAccountId == currentUser.UserAccountId || row.CoachStaffId == currentUser.StaffId));

        return new CoachingSessionDetail(
            row.Id, row.RecordId, row.CycleId, row.CycleNumber, row.StaffId, row.StaffName,
            row.CoachStaffId, row.CoachName, row.SessionNumber, row.SessionDate, row.SessionType,
            row.DeliveryMethod, row.DurationMinutes, row.Status, row.QualificationStatusKey,
            row.PrimaryFocusKey, row.SecondaryFocusKey, row.FocusOtherText, row.SpecificSessionFocus,
            row.CurrentPracticeDescriptorId, row.CurrentPracticeWording, row.CurrentPracticeEvidence,
            ParseCoachingJsonList(row.SupportTypesJson), row.SupportOtherText, row.ConversationSummary,
            row.ClosesCycle, row.CompletedAt, canEdit, previousActions, actionReviews, actions);
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
            await ValidateCoachingActionReviewCoverageAsync(
                connection, transaction, cycleId, sessionNumber, request, cancellationToken);
            await SaveCoachingSessionActionsAsync(
                connection, transaction, targetSessionId, recordId, request.StaffId, coachStaffId,
                request.Actions ?? [], request.Status, currentUser, cancellationToken);
            await SaveCoachingActionReviewsAsync(
                connection, transaction, targetSessionId, recordId, cycleId, sessionNumber,
                request.StaffId, coachStaffId, request.ActionReviews ?? [], request.Actions?.Count ?? 0,
                request.Status, currentUser, cancellationToken);

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
                    SET status = CASE WHEN @closeCycle = 1 THEN 'closed' ELSE 'active' END,
                        closed_on = CASE WHEN @closeCycle = 1 THEN @sessionDate ELSE NULL END,
                        updated_at = sysutcdatetime()
                    WHERE id = @cycleId;
                    """,
                    connection,
                    transaction);
                cycleStatus.Parameters.AddWithValue("@closeCycle", request.CloseCycle);
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
                JsonSerializer.Serialize(new { status = request.Status.ToLowerInvariant(), cycleNumber, sessionNumber, request.CloseCycle }),
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
        Guid? reviewSessionId,
        CancellationToken cancellationToken)
    {
        if (beforeSessionNumber is <= 1)
        {
            return [];
        }

        return await QueryAsync(
            """
            SELECT action.id, action.title, COALESCE(action.owner_context, 'staff'),
                   CASE
                       WHEN action.owner_context = 'coach' THEN origin_coach.display_name
                       WHEN action.owner_context = 'joint' THEN CONCAT(origin_staff.display_name, ' and ', origin_coach.display_name)
                       ELSE origin_staff.display_name
                   END,
                   action.due_date, action.review_date,
                   COALESCE(action.progress_status, 'not_started'),
                   action.intended_evidence, action.intended_impact,
                   latest_review.progress_update, latest_review.impact_observed,
                   action.action_theme
            FROM quality.actions action
            JOIN quality.coaching_sessions origin
              ON action.source_sub_record_type = 'coaching_session'
             AND origin.id = action.source_sub_record_id
            JOIN people.staff origin_staff ON origin_staff.id = origin.staff_id
            JOIN people.staff origin_coach ON origin_coach.id = origin.coach_staff_id
            LEFT JOIN core.lookup_values status ON status.id = action.status_lookup_value_id
            OUTER APPLY (
                SELECT TOP (1) review.progress_update, review.impact_observed
                FROM quality.coaching_action_reviews review
                JOIN quality.coaching_sessions update_session ON update_session.id = review.session_id
                WHERE review.action_id = action.id
                  AND update_session.status = 'completed'
                ORDER BY update_session.session_number DESC, review.updated_at DESC, review.created_at DESC
            ) latest_review
            WHERE origin.cycle_id = @cycleId
              AND origin.status = 'completed'
              AND (@beforeSessionNumber IS NULL OR origin.session_number < @beforeSessionNumber)
              AND action.archived_at IS NULL
              AND (
                    (
                        action.completed_date IS NULL
                        AND ISNULL(status.value_key, 'open') NOT IN ('complete', 'cancelled')
                        AND COALESCE(action.progress_status, 'not_started') NOT IN ('completed', 'closed')
                    )
                    OR EXISTS (
                        SELECT 1
                        FROM quality.coaching_action_reviews current_review
                        WHERE current_review.session_id = @reviewSessionId
                          AND current_review.action_id = action.id
                    )
              )
            ORDER BY action.due_date, action.title
            OPTION (RECOMPILE);
            """,
            command =>
            {
                command.Parameters.AddWithValue("@cycleId", cycleId);
                command.Parameters.AddWithValue("@beforeSessionNumber", beforeSessionNumber.HasValue ? beforeSessionNumber.Value : DBNull.Value);
                command.Parameters.AddWithValue("@reviewSessionId", reviewSessionId.HasValue ? reviewSessionId.Value : DBNull.Value);
            },
            reader => new CoachingPreviousActionSummary(
                reader.GetGuid(0),
                reader.GetString(11),
                reader.GetString(1),
                reader.GetString(2),
                reader.GetString(3),
                GetDateOnlyOrNull(reader, 4),
                GetDateOnlyOrNull(reader, 5),
                reader.GetString(6),
                GetStringOrNull(reader, 7),
                GetStringOrNull(reader, 8),
                GetStringOrNull(reader, 9),
                GetStringOrNull(reader, 10)),
            cancellationToken);
    }

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
                      AND value.value_key = @qualificationStatusKey
                ),
                primary_focus_lookup_value_id = (
                    SELECT TOP (1) value.id
                    FROM core.lookup_values value
                    JOIN core.lookup_types type ON type.id = value.lookup_type_id
                    WHERE type.lookup_key = 'coaching_focus_area'
                      AND value.value_key = @primaryFocusKey
                ),
                secondary_focus_lookup_value_id = (
                    SELECT TOP (1) value.id
                    FROM core.lookup_values value
                    JOIN core.lookup_types type ON type.id = value.lookup_type_id
                    WHERE type.lookup_key = 'coaching_focus_area'
                      AND value.value_key = @secondaryFocusKey
                ),
                focus_other_text = @focusOtherText,
                specific_session_focus = @specificSessionFocus,
                current_practice_descriptor_id = @currentPracticeDescriptorId,
                current_practice_wording_snapshot = (
                    SELECT TOP (1) descriptor.visible_wording
                    FROM quality.elevate_practice_rubric_descriptors descriptor
                    WHERE descriptor.id = @currentPracticeDescriptorId
                ),
                current_practice_hidden_score = (
                    SELECT TOP (1) descriptor.hidden_numeric_value
                    FROM quality.elevate_practice_rubric_descriptors descriptor
                    WHERE descriptor.id = @currentPracticeDescriptorId
                ),
                current_practice_evidence = @currentPracticeEvidence,
                support_types_json = @supportTypesJson,
                support_other_text = @supportOtherText,
                conversation_summary = @conversationSummary,
                closes_cycle = @closeCycle,
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

    private static async Task ValidateCoachingActionReviewCoverageAsync(
        SqlConnection connection,
        SqlTransaction transaction,
        Guid cycleId,
        int sessionNumber,
        SaveCoachingSessionRequest request,
        CancellationToken cancellationToken)
    {
        if (!request.Status.Equals("completed", StringComparison.OrdinalIgnoreCase) || sessionNumber <= 1)
        {
            return;
        }

        var expected = new HashSet<Guid>();
        await using (var command = new SqlCommand(
            """
            SELECT action.id
            FROM quality.actions action
            JOIN quality.coaching_sessions origin
              ON origin.id = action.source_sub_record_id
             AND action.source_sub_record_type = 'coaching_session'
            LEFT JOIN core.lookup_values status ON status.id = action.status_lookup_value_id
            WHERE origin.cycle_id = @cycleId
              AND origin.session_number < @sessionNumber
              AND origin.status = 'completed'
              AND action.archived_at IS NULL
              AND action.completed_date IS NULL
              AND ISNULL(status.value_key, 'open') NOT IN ('complete', 'cancelled')
              AND COALESCE(action.progress_status, 'not_started') NOT IN ('completed', 'closed');
            """,
            connection,
            transaction))
        {
            command.Parameters.AddWithValue("@cycleId", cycleId);
            command.Parameters.AddWithValue("@sessionNumber", sessionNumber);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                expected.Add(reader.GetGuid(0));
            }
        }

        var submitted = (request.ActionReviews ?? [])
            .Where(review => !string.IsNullOrWhiteSpace(review.ReviewOutcome))
            .GroupBy(review => review.ActionId)
            .ToDictionary(group => group.Key, group => group.Last().ReviewOutcome!, EqualityComparer<Guid>.Default);
        if (expected.Any(actionId => !submitted.ContainsKey(actionId)))
        {
            throw new WorkflowValidationException("Record a review outcome for every active action before completing this session.");
        }

        if (request.CloseCycle && !CoachingCycleWorkflow.CanCloseCycle(submitted.Values))
        {
            throw new WorkflowValidationException("Complete or close every previous action before closing the coaching cycle.");
        }
    }

    private static async Task SaveCoachingActionReviewsAsync(
        SqlConnection connection,
        SqlTransaction transaction,
        Guid sessionId,
        Guid recordId,
        Guid cycleId,
        int sessionNumber,
        Guid staffId,
        Guid coachStaffId,
        IReadOnlyList<CoachingActionReviewRequest> reviews,
        int regularActionCount,
        string sessionStatus,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        var submittedActionIds = new HashSet<Guid>();
        var reviewIndex = 0;
        foreach (var review in reviews.GroupBy(item => item.ActionId).Select(group => group.Last()))
        {
            submittedActionIds.Add(review.ActionId);
            await using (var validateCommand = new SqlCommand(
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
                """,
                connection,
                transaction))
            {
                validateCommand.Parameters.AddWithValue("@actionId", review.ActionId);
                validateCommand.Parameters.AddWithValue("@cycleId", cycleId);
                validateCommand.Parameters.AddWithValue("@sessionNumber", sessionNumber);
                await validateCommand.ExecuteNonQueryAsync(cancellationToken);
            }

            Guid? existingRevisedActionId = null;
            await using (var existingCommand = new SqlCommand(
                """
                SELECT revised_action_id
                FROM quality.coaching_action_reviews
                WHERE session_id = @sessionId AND action_id = @actionId;
                """,
                connection,
                transaction))
            {
                existingCommand.Parameters.AddWithValue("@sessionId", sessionId);
                existingCommand.Parameters.AddWithValue("@actionId", review.ActionId);
                var existing = await existingCommand.ExecuteScalarAsync(cancellationToken);
                existingRevisedActionId = existing is null or DBNull ? null : (Guid)existing;
            }

            Guid? revisedActionId = null;
            if (review.ReviewOutcome?.Equals("revised", StringComparison.OrdinalIgnoreCase) == true
                && review.RevisedAction is not null)
            {
                revisedActionId = existingRevisedActionId ?? Guid.NewGuid();
                reviewIndex++;
                await UpsertCoachingActionAsync(
                    connection,
                    transaction,
                    revisedActionId.Value,
                    sessionId,
                    recordId,
                    staffId,
                    coachStaffId,
                    regularActionCount + reviewIndex,
                    review.RevisedAction,
                    review.ActionId,
                    sessionStatus,
                    currentUser,
                    cancellationToken);
            }
            else if (existingRevisedActionId.HasValue)
            {
                await using var archiveRevised = new SqlCommand(
                    """
                    UPDATE quality.actions
                    SET archived_at = sysutcdatetime(),
                        deleted_by_user_account_id = @userAccountId,
                        deletion_reason = 'Revised action removed while editing its coaching review.',
                        updated_by_user_account_id = @userAccountId,
                        updated_at = sysutcdatetime()
                    WHERE id = @id;
                    """,
                    connection,
                    transaction);
                archiveRevised.Parameters.AddWithValue("@id", existingRevisedActionId.Value);
                archiveRevised.Parameters.AddWithValue("@userAccountId", currentUser.UserAccountId!.Value);
                await archiveRevised.ExecuteNonQueryAsync(cancellationToken);
            }

            await using (var reviewCommand = new SqlCommand(
                """
                UPDATE quality.coaching_action_reviews
                SET review_outcome = @reviewOutcome,
                    progress_update = @progressUpdate,
                    impact_observed = @impactObserved,
                    revised_action_id = @revisedActionId,
                    updated_by_user_account_id = @userAccountId,
                    updated_at = sysutcdatetime()
                WHERE session_id = @sessionId AND action_id = @actionId;

                IF @@ROWCOUNT = 0
                BEGIN
                    INSERT INTO quality.coaching_action_reviews (
                        session_id, action_id, review_outcome, progress_update, impact_observed,
                        revised_action_id, created_by_user_account_id, updated_by_user_account_id
                    )
                    VALUES (
                        @sessionId, @actionId, @reviewOutcome, @progressUpdate, @impactObserved,
                        @revisedActionId, @userAccountId, @userAccountId
                    );
                END;
                """,
                connection,
                transaction))
            {
                reviewCommand.Parameters.AddWithValue("@sessionId", sessionId);
                reviewCommand.Parameters.AddWithValue("@actionId", review.ActionId);
                reviewCommand.Parameters.AddWithValue("@reviewOutcome", ToDbValue(review.ReviewOutcome?.ToLowerInvariant()));
                reviewCommand.Parameters.AddWithValue("@progressUpdate", ToDbValue(review.ProgressUpdate));
                reviewCommand.Parameters.AddWithValue("@impactObserved", ToDbValue(review.ImpactObserved));
                reviewCommand.Parameters.AddWithValue("@revisedActionId", ToDbValue(revisedActionId));
                reviewCommand.Parameters.AddWithValue("@userAccountId", currentUser.UserAccountId!.Value);
                await reviewCommand.ExecuteNonQueryAsync(cancellationToken);
            }

            if (!sessionStatus.Equals("completed", StringComparison.OrdinalIgnoreCase)
                || string.IsNullOrWhiteSpace(review.ReviewOutcome))
            {
                continue;
            }

            var outcome = review.ReviewOutcome.ToLowerInvariant();
            var progressStatus = CoachingCycleWorkflow.GetProgressStatusForReview(outcome);
            var centralStatus = CoachingCycleWorkflow.GetCentralStatusForReview(outcome);
            var isComplete = centralStatus == "complete";
            var isCancelled = centralStatus == "cancelled";
            var reviewNote = string.Join(
                Environment.NewLine,
                new[] { review.ProgressUpdate, review.ImpactObserved }
                    .Where(value => !string.IsNullOrWhiteSpace(value)));

            await using var actionCommand = new SqlCommand(
                """
                UPDATE quality.actions
                SET progress_status = @progressStatus,
                    status_lookup_value_id = (
                        SELECT TOP (1) value.id
                        FROM core.lookup_values value
                        JOIN core.lookup_types type ON type.id = value.lookup_type_id
                        WHERE type.lookup_key = 'action_status' AND value.value_key = @statusKey
                    ),
                    completed_date = CASE WHEN @isComplete = 1 THEN CONVERT(date, sysutcdatetime()) ELSE NULL END,
                    completion_note = CASE WHEN @isComplete = 1 THEN @reviewNote ELSE completion_note END,
                    completed_by_user_account_id = CASE WHEN @isComplete = 1 THEN @userAccountId ELSE NULL END,
                    cancelled_at = CASE WHEN @isCancelled = 1 THEN sysutcdatetime() ELSE NULL END,
                    cancelled_by_user_account_id = CASE WHEN @isCancelled = 1 THEN @userAccountId ELSE NULL END,
                    cancellation_comments = CASE WHEN @isCancelled = 1 THEN @reviewNote ELSE NULL END,
                    updated_by_user_account_id = @userAccountId,
                    updated_at = sysutcdatetime()
                WHERE id = @actionId AND archived_at IS NULL;
                """,
                connection,
                transaction);
            actionCommand.Parameters.AddWithValue("@progressStatus", progressStatus);
            actionCommand.Parameters.AddWithValue("@statusKey", centralStatus);
            actionCommand.Parameters.AddWithValue("@isComplete", isComplete);
            actionCommand.Parameters.AddWithValue("@isCancelled", isCancelled);
            actionCommand.Parameters.AddWithValue("@reviewNote", ToDbValue(reviewNote));
            actionCommand.Parameters.AddWithValue("@userAccountId", currentUser.UserAccountId!.Value);
            actionCommand.Parameters.AddWithValue("@actionId", review.ActionId);
            await actionCommand.ExecuteNonQueryAsync(cancellationToken);
        }

        await using var removeCommand = new SqlCommand(
            """
            DELETE FROM quality.coaching_action_reviews
            WHERE session_id = @sessionId
              AND action_id NOT IN (
                  SELECT value
                  FROM OPENJSON(@retainedActionIds)
                  WITH (value uniqueidentifier '$')
              );
            """,
            connection,
            transaction);
        removeCommand.Parameters.AddWithValue("@sessionId", sessionId);
        removeCommand.Parameters.AddWithValue(
            "@retainedActionIds",
            JsonSerializer.Serialize(submittedActionIds));
        await removeCommand.ExecuteNonQueryAsync(cancellationToken);
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
              AND parent_action_id IS NULL
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
              AND parent_action_id IS NULL
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
            await UpsertCoachingActionAsync(
                connection, transaction, rowId, sessionId, recordId, staffId, coachStaffId,
                index + 1, requestAction, null, sessionStatus, currentUser, cancellationToken);
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

    private static async Task UpsertCoachingActionAsync(
        SqlConnection connection,
        SqlTransaction transaction,
        Guid actionId,
        Guid sessionId,
        Guid recordId,
        Guid staffId,
        Guid coachStaffId,
        int actionOrder,
        CoachingSessionActionRequest request,
        Guid? parentActionId,
        string sessionStatus,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        var progressStatus = request.Status.ToLowerInvariant();
        var centralStatus = CoachingCycleWorkflow.GetCentralActionStatus(progressStatus);
        var isComplete = centralStatus == "complete";
        var isCancelled = centralStatus == "cancelled";
        var isPublished = sessionStatus.Equals("completed", StringComparison.OrdinalIgnoreCase);

        await using var command = new SqlCommand(
            """
            UPDATE quality.actions
            SET source_display_order = @actionOrder,
                action_theme = @actionTheme,
                title = @actionText,
                owner_context = @ownerType,
                owner_staff_id = @ownerStaffId,
                due_date = @dueDate,
                original_due_date = COALESCE(original_due_date, @dueDate),
                detail = @intendedEvidence,
                intended_evidence = @intendedEvidence,
                intended_impact = @intendedImpact,
                review_date = @reviewDate,
                progress_status = @progressStatus,
                parent_action_id = @parentActionId,
                status_lookup_value_id = (
                    SELECT TOP (1) value.id FROM core.lookup_values value
                    JOIN core.lookup_types type ON type.id = value.lookup_type_id
                    WHERE type.lookup_key = 'action_status' AND value.value_key = @centralStatus
                ),
                completed_date = CASE WHEN @isComplete = 1 THEN COALESCE(completed_date, CONVERT(date, sysutcdatetime())) ELSE NULL END,
                completed_by_user_account_id = CASE WHEN @isComplete = 1 THEN @userAccountId ELSE NULL END,
                cancelled_at = CASE WHEN @isCancelled = 1 THEN COALESCE(cancelled_at, sysutcdatetime()) ELSE NULL END,
                cancelled_by_user_account_id = CASE WHEN @isCancelled = 1 THEN @userAccountId ELSE NULL END,
                published_to_staff = @publishedToStaff,
                visibility_setting = @visibilitySetting,
                archived_at = NULL,
                updated_by_user_account_id = @userAccountId,
                updated_at = sysutcdatetime()
            WHERE id = @id
              AND source_sub_record_type = 'coaching_session'
              AND source_sub_record_id = @sessionId;

            IF @@ROWCOUNT = 0
            BEGIN
                INSERT INTO quality.actions (
                    id, source_record_id, source_form_type, source_sub_record_type, source_sub_record_id,
                    source_display_order, owner_context, subject_staff_id, owner_staff_id, action_theme, title, detail,
                    intended_evidence, intended_impact, review_date, progress_status, parent_action_id,
                    priority_lookup_value_id, status_lookup_value_id, due_date, original_due_date,
                    completed_date, completed_by_user_account_id, cancelled_at, cancelled_by_user_account_id,
                    published_to_staff, visibility_setting, created_by_user_account_id
                )
                VALUES (
                    @id, @recordId, 'coaching_mentoring', 'coaching_session', @sessionId,
                    @actionOrder, @ownerType, @staffId, @ownerStaffId, @actionTheme, @actionText, @intendedEvidence,
                    @intendedEvidence, @intendedImpact, @reviewDate, @progressStatus, @parentActionId,
                    (SELECT TOP (1) value.id FROM core.lookup_values value
                     JOIN core.lookup_types type ON type.id = value.lookup_type_id
                     WHERE type.lookup_key = 'priority' AND value.value_key = 'medium'),
                    (SELECT TOP (1) value.id FROM core.lookup_values value
                     JOIN core.lookup_types type ON type.id = value.lookup_type_id
                     WHERE type.lookup_key = 'action_status' AND value.value_key = @centralStatus),
                    @dueDate, @dueDate,
                    CASE WHEN @isComplete = 1 THEN CONVERT(date, sysutcdatetime()) ELSE NULL END,
                    CASE WHEN @isComplete = 1 THEN @userAccountId ELSE NULL END,
                    CASE WHEN @isCancelled = 1 THEN sysutcdatetime() ELSE NULL END,
                    CASE WHEN @isCancelled = 1 THEN @userAccountId ELSE NULL END,
                    @publishedToStaff, @visibilitySetting, @userAccountId
                );
            END;
            """,
            connection,
            transaction);
        command.Parameters.AddWithValue("@id", actionId);
        command.Parameters.AddWithValue("@sessionId", sessionId);
        command.Parameters.AddWithValue("@recordId", recordId);
        command.Parameters.AddWithValue("@staffId", staffId);
        command.Parameters.AddWithValue("@actionOrder", actionOrder);
        command.Parameters.AddWithValue("@actionTheme", request.ActionTheme.Trim());
        command.Parameters.AddWithValue("@actionText", request.ActionText.Trim());
        command.Parameters.AddWithValue("@ownerType", request.OwnerType.ToLowerInvariant());
        command.Parameters.AddWithValue(
            "@ownerStaffId",
            request.OwnerType.Equals("coach", StringComparison.OrdinalIgnoreCase) ? coachStaffId : staffId);
        command.Parameters.AddWithValue(
            "@dueDate",
            request.DueDate.HasValue ? request.DueDate.Value.ToDateTime(TimeOnly.MinValue) : DBNull.Value);
        command.Parameters.AddWithValue("@intendedEvidence", ToDbValue(request.IntendedEvidence));
        command.Parameters.AddWithValue("@intendedImpact", ToDbValue(request.IntendedImpact));
        command.Parameters.AddWithValue(
            "@reviewDate",
            request.ReviewDate.HasValue ? request.ReviewDate.Value.ToDateTime(TimeOnly.MinValue) : DBNull.Value);
        command.Parameters.AddWithValue("@progressStatus", progressStatus);
        command.Parameters.AddWithValue("@parentActionId", ToDbValue(parentActionId));
        command.Parameters.AddWithValue("@centralStatus", centralStatus);
        command.Parameters.AddWithValue("@isComplete", isComplete);
        command.Parameters.AddWithValue("@isCancelled", isCancelled);
        command.Parameters.AddWithValue("@publishedToStaff", isPublished);
        command.Parameters.AddWithValue("@visibilitySetting", isPublished ? "staff_and_management" : "source_editors");
        command.Parameters.AddWithValue("@userAccountId", currentUser.UserAccountId!.Value);
        await command.ExecuteNonQueryAsync(cancellationToken);
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

        if (!string.Equals(request.Status, "draft", StringComparison.OrdinalIgnoreCase)
            && !string.Equals(request.Status, "completed", StringComparison.OrdinalIgnoreCase))
        {
            throw new WorkflowValidationException("The coaching session status must be Draft or Completed.");
        }

        if (request.DurationMinutes is < 1 or > 1440)
        {
            throw new WorkflowValidationException("Duration must be between 1 minute and 24 hours.");
        }

        if (request.CloseCycle && !request.Status.Equals("completed", StringComparison.OrdinalIgnoreCase))
        {
            throw new WorkflowValidationException("A coaching cycle can only be closed when the session is completed.");
        }

        foreach (var action in request.Actions ?? [])
        {
            if (string.IsNullOrWhiteSpace(action.ActionTheme))
            {
                throw new WorkflowValidationException("Every coaching action needs an action theme.");
            }
            ValidateCoachingOption(action.OwnerType, CoachingActionOwners, "action owner", true);
            ValidateCoachingOption(action.Status, CoachingActionStatuses, "action status", true);
        }

        foreach (var review in request.ActionReviews ?? [])
        {
            if (!string.IsNullOrWhiteSpace(review.ReviewOutcome))
            {
                ValidateCoachingOption(review.ReviewOutcome, CoachingReviewOutcomes, "action review outcome", true);
            }

            if (review.ReviewOutcome?.Equals("revised", StringComparison.OrdinalIgnoreCase) == true
                && review.RevisedAction is null)
            {
                throw new WorkflowValidationException("Enter the revised action before saving a Revised outcome.");
            }

            if (review.RevisedAction is not null)
            {
                if (string.IsNullOrWhiteSpace(review.RevisedAction.ActionTheme))
                {
                    throw new WorkflowValidationException("Every revised action needs an action theme.");
                }
                ValidateCoachingOption(review.RevisedAction.OwnerType, CoachingActionOwners, "revised action owner", true);
                ValidateCoachingOption(review.RevisedAction.Status, CoachingActionStatuses, "revised action status", true);
            }
        }

        if (!string.Equals(request.Status, "completed", StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        if (string.IsNullOrWhiteSpace(request.DeliveryMethod)
            || !request.DurationMinutes.HasValue
            || string.IsNullOrWhiteSpace(request.QualificationStatusKey)
            || string.IsNullOrWhiteSpace(request.PrimaryFocusKey)
            || string.IsNullOrWhiteSpace(request.SpecificSessionFocus)
            || !request.CurrentPracticeDescriptorId.HasValue
            || request.SupportTypes is null || request.SupportTypes.Count == 0
            || string.IsNullOrWhiteSpace(request.ConversationSummary))
        {
            throw new WorkflowValidationException("Complete the session details, qualification status, focus, current-practice judgement, support and conversation summary before completing the session.");
        }

        if ((string.Equals(request.PrimaryFocusKey, "other", StringComparison.OrdinalIgnoreCase)
             || request.SecondaryFocusKey?.Equals("other", StringComparison.OrdinalIgnoreCase) == true)
            && string.IsNullOrWhiteSpace(request.FocusOtherText))
        {
            throw new WorkflowValidationException("Describe the session focus when Other is selected.");
        }

        if (request.SupportTypes?.Any(value => value.Equals("other", StringComparison.OrdinalIgnoreCase)) == true
            && string.IsNullOrWhiteSpace(request.SupportOtherText))
        {
            throw new WorkflowValidationException("Describe the support provided when Other is selected.");
        }

        var completedActions = (request.Actions ?? [])
            .Where(action => !string.IsNullOrWhiteSpace(action.ActionText))
            .Concat((request.ActionReviews ?? [])
                .Where(review => review.ReviewOutcome?.Equals("revised", StringComparison.OrdinalIgnoreCase) == true)
                .Select(review => review.RevisedAction)
                .OfType<CoachingSessionActionRequest>())
            .ToArray();
        var revisedActionCount = (request.ActionReviews ?? [])
            .Count(review => review.ReviewOutcome?.Equals("revised", StringComparison.OrdinalIgnoreCase) == true
                             && review.RevisedAction is not null);
        if (!CoachingCycleWorkflow.MeetsActionRequirement(
                (request.Actions ?? []).Count(action => !string.IsNullOrWhiteSpace(action.ActionText)),
                revisedActionCount,
                request.CloseCycle))
        {
            throw new WorkflowValidationException("Add at least one action, or formally close the coaching cycle.");
        }

        foreach (var action in completedActions)
        {
            if (string.IsNullOrWhiteSpace(action.ActionText)
                || string.IsNullOrWhiteSpace(action.ActionTheme)
                || !action.DueDate.HasValue)
            {
                throw new WorkflowValidationException("Every action needs an action theme, action, owner and implementation date.");
            }
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

        if (!string.IsNullOrWhiteSpace(request.QualificationStatusKey))
        {
            await ValidateLookupValueAsync(
                "coaching_development_stage", request.QualificationStatusKey, "qualification status");
        }

        foreach (var value in new[] { request.PrimaryFocusKey, request.SecondaryFocusKey }
                     .Where(value => !string.IsNullOrWhiteSpace(value))
                     .Distinct(StringComparer.OrdinalIgnoreCase))
        {
            await ValidateLookupValueAsync("coaching_focus_area", value!, "focus area");
        }

        if (!string.IsNullOrWhiteSpace(request.PrimaryFocusKey)
            && request.PrimaryFocusKey.Equals(request.SecondaryFocusKey, StringComparison.OrdinalIgnoreCase))
        {
            throw new WorkflowValidationException("Choose different primary and secondary focus areas.");
        }

        foreach (var value in (request.SupportTypes ?? []).Distinct(StringComparer.OrdinalIgnoreCase))
        {
            await ValidateLookupValueAsync("coaching_support_type", value, "support type");
        }

        var newActions = (request.Actions ?? [])
            .Where(action => !action.Id.HasValue)
            .Concat((request.ActionReviews ?? [])
                .Select(review => review.RevisedAction)
                .OfType<CoachingSessionActionRequest>()
                .Where(action => !action.Id.HasValue));
        foreach (var actionTheme in newActions
                     .Select(action => action.ActionTheme)
                     .Where(theme => !string.IsNullOrWhiteSpace(theme))
                     .Distinct(StringComparer.OrdinalIgnoreCase))
        {
            await ValidateActionThemeAsync(
                connection,
                transaction,
                "coaching_mentoring",
                actionTheme,
                cancellationToken);
        }

        var actionCount = (request.Actions ?? []).Count(action => !string.IsNullOrWhiteSpace(action.ActionText));
        await using (var limitCommand = new SqlCommand(
            "SELECT max_actions_per_session FROM quality.coaching_configuration WHERE configuration_id = 1;",
            connection,
            transaction))
        {
            var maxActions = Convert.ToInt32(await limitCommand.ExecuteScalarAsync(cancellationToken));
            var revisedActionCount = (request.ActionReviews ?? [])
                .Count(review => review.ReviewOutcome?.Equals("revised", StringComparison.OrdinalIgnoreCase) == true
                                 && review.RevisedAction is not null);
            if (!CoachingCycleWorkflow.IsWithinActionLimit(actionCount + revisedActionCount, maxActions))
            {
                throw new WorkflowValidationException($"A coaching session can contain no more than {maxActions} new actions.");
            }
        }

        if (!request.CurrentPracticeDescriptorId.HasValue)
        {
            return;
        }

        await using var descriptorCommand = new SqlCommand(
            "SELECT COUNT(*) FROM quality.elevate_practice_rubric_descriptors WHERE id = @id;",
            connection,
            transaction);
        descriptorCommand.Parameters.AddWithValue("@id", request.CurrentPracticeDescriptorId.Value);
        if (Convert.ToInt32(await descriptorCommand.ExecuteScalarAsync(cancellationToken)) == 0)
        {
            throw new WorkflowValidationException("The selected current-practice judgement is not valid.");
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
        command.Parameters.AddWithValue("@qualificationStatusKey", ToDbValue(request.QualificationStatusKey?.ToLowerInvariant()));
        command.Parameters.AddWithValue("@primaryFocusKey", ToDbValue(request.PrimaryFocusKey?.ToLowerInvariant()));
        command.Parameters.AddWithValue("@secondaryFocusKey", ToDbValue(request.SecondaryFocusKey?.ToLowerInvariant()));
        command.Parameters.AddWithValue("@focusOtherText", ToDbValue(request.FocusOtherText));
        command.Parameters.AddWithValue("@specificSessionFocus", ToDbValue(request.SpecificSessionFocus));
        command.Parameters.AddWithValue("@currentPracticeDescriptorId", ToDbValue(request.CurrentPracticeDescriptorId));
        command.Parameters.AddWithValue("@currentPracticeEvidence", ToDbValue(request.CurrentPracticeEvidence));
        command.Parameters.AddWithValue("@supportTypesJson", ToDbValue(SerializeCoachingList(request.SupportTypes)));
        command.Parameters.AddWithValue("@supportOtherText", ToDbValue(request.SupportOtherText));
        command.Parameters.AddWithValue("@conversationSummary", ToDbValue(request.ConversationSummary));
        command.Parameters.AddWithValue("@closeCycle", request.CloseCycle);
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
        command.Parameters.AddWithValue("@summary", ToDbValue(request.SpecificSessionFocus ?? request.PrimaryFocusKey ?? "Draft coaching session"));
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
        string? QualificationStatusKey,
        string? PrimaryFocusKey,
        string? SecondaryFocusKey,
        string? FocusOtherText,
        string? SpecificSessionFocus,
        Guid? CurrentPracticeDescriptorId,
        string? CurrentPracticeWording,
        string? CurrentPracticeEvidence,
        string? SupportTypesJson,
        string? SupportOtherText,
        string? ConversationSummary,
        bool ClosesCycle,
        DateTimeOffset? CompletedAt,
        Guid? CreatedByUserAccountId,
        DateTimeOffset CreatedAt,
        DateTimeOffset? UpdatedAt);
}
