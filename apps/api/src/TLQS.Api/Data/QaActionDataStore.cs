using System.Text.Json;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    public async Task<bool> CanUseQaDashboardFilterAsync(
        Guid reviewId,
        Guid? facultyOrgUnitId,
        Guid? teamOrgUnitId,
        CurrentUser user,
        CancellationToken cancellationToken)
    {
        if (!facultyOrgUnitId.HasValue && !teamOrgUnitId.HasValue) return true;
        var matches = await QueryAsync(
            """
            SELECT COUNT(*)
            FROM qa.review_scopes scope
            WHERE scope.review_id = @reviewId AND scope.scope_type = N'team'
              AND (@facultyId IS NULL OR scope.parent_org_unit_id = @facultyId)
              AND (@teamId IS NULL OR scope.org_unit_id = @teamId)
              AND (@viewAll = 1 OR (@viewScoped = 1 AND EXISTS (
                    SELECT 1 FROM org.fn_visible_org_units(@userAccountId) visible
                    WHERE visible.org_unit_id IN (scope.org_unit_id, scope.parent_org_unit_id))));
            """,
            command =>
            {
                command.Parameters.AddWithValue("@reviewId", reviewId);
                command.Parameters.AddWithValue("@facultyId", ToDbValue(facultyOrgUnitId));
                command.Parameters.AddWithValue("@teamId", ToDbValue(teamOrgUnitId));
                command.Parameters.AddWithValue("@userAccountId", ToDbValue(user.UserAccountId));
                command.Parameters.AddWithValue("@viewAll", user.HasPermission(PermissionKeys.QaReviewsViewAll));
                command.Parameters.AddWithValue("@viewScoped", user.HasPermission(PermissionKeys.QaReviewsViewScoped));
            }, reader => reader.GetInt32(0), cancellationToken);
        return matches.Single() > 0;
    }

    public async Task<bool> CanUseQaActionMonitoringAsync(CurrentUser user, CancellationToken cancellationToken)
    {
        if (!user.UserAccountId.HasValue || !user.StaffId.HasValue) return false;
        if (QaReviewPolicy.CanReviewActions(user)) return true;
        var matches = await QueryAsync(
            """
            SELECT COUNT(*)
            FROM qa.reviews review
            WHERE review.status = N'closed'
              AND (EXISTS (
                    SELECT 1 FROM qa.review_scopes scope
                    JOIN org.org_unit_leaderships leadership
                      ON leadership.org_unit_id IN (scope.org_unit_id, scope.parent_org_unit_id)
                     AND leadership.leader_staff_id = @staffId
                     AND leadership.leadership_role = N'manager'
                     AND leadership.archived_at IS NULL
                     AND leadership.active_from <= CONVERT(date, sysutcdatetime())
                     AND (leadership.active_to IS NULL OR leadership.active_to >= CONVERT(date, sysutcdatetime()))
                    WHERE scope.review_id = review.record_id AND scope.scope_type = N'team'
                  ) OR EXISTS (
                    SELECT 1 FROM qa.action_group_assignments assignment
                    JOIN qa.action_groups action_group ON action_group.id = assignment.action_group_id
                    WHERE action_group.review_id = review.record_id AND assignment.staff_id = @staffId));
            """,
            command => command.Parameters.AddWithValue("@staffId", user.StaffId.Value),
            reader => reader.GetInt32(0), cancellationToken);
        return matches.Single() > 0;
    }

    public async Task<IReadOnlyList<QaReviewActionOptions>> GetQaActionReviewOptionsAsync(
        CurrentUser user,
        CancellationToken cancellationToken)
    {
        if (!await CanUseQaActionMonitoringAsync(user, cancellationToken)) return [];
        var reviewIds = await QueryAsync(
            """
            SELECT review.record_id
            FROM qa.reviews review
            JOIN core.records record ON record.id = review.record_id
            WHERE review.status = N'closed'
              AND (@monitorAll = 1 OR record.owner_staff_id = @staffId OR EXISTS (
                    SELECT 1 FROM qa.review_scopes scope
                    JOIN org.org_unit_leaderships leadership
                      ON leadership.org_unit_id IN (scope.org_unit_id, scope.parent_org_unit_id)
                     AND leadership.leader_staff_id = @staffId
                     AND leadership.leadership_role = N'manager'
                     AND leadership.archived_at IS NULL
                     AND leadership.active_from <= CONVERT(date, sysutcdatetime())
                     AND (leadership.active_to IS NULL OR leadership.active_to >= CONVERT(date, sysutcdatetime()))
                    WHERE scope.review_id = review.record_id AND scope.scope_type = N'team'))
            ORDER BY review.closing_date DESC, record.title;
            """,
            command =>
            {
                command.Parameters.AddWithValue("@monitorAll", QaReviewPolicy.CanMonitorActions(user));
                command.Parameters.AddWithValue("@staffId", user.StaffId!.Value);
            }, reader => reader.GetGuid(0), cancellationToken);
        var result = new List<QaReviewActionOptions>();
        foreach (var reviewId in reviewIds)
        {
            var options = await GetQaReviewActionOptionsAsync(reviewId, user, cancellationToken);
            if (options is not null) result.Add(options);
        }
        return result;
    }

    public async Task<QaReviewActionOptions?> GetQaReviewActionOptionsAsync(
        Guid reviewId,
        CurrentUser user,
        CancellationToken cancellationToken)
    {
        if (!user.StaffId.HasValue || !user.UserAccountId.HasValue
            || !await CanViewQaReviewAsync(reviewId, user, cancellationToken)) return null;
        var reviewRows = await QueryAsync(
            """
            SELECT record.title, record.owner_staff_id
            FROM qa.reviews review JOIN core.records record ON record.id = review.record_id
            WHERE review.record_id = @reviewId AND review.status = N'closed';
            """,
            command => command.Parameters.AddWithValue("@reviewId", reviewId),
            reader => new { Title = reader.GetString(0), OwnerStaffId = reader.GetGuid(1) }, cancellationToken);
        var review = reviewRows.SingleOrDefault();
        if (review is null) return null;

        var rows = await QueryAsync(
            """
            SELECT scope.parent_org_unit_id, scope.parent_name_snapshot,
                   faculty_staff.id, faculty_staff.display_name,
                   scope.org_unit_id, scope.org_unit_name_snapshot,
                   team_staff.id, team_staff.display_name,
                   CAST(CASE WHEN EXISTS (
                        SELECT 1 FROM org.org_unit_leaderships mine
                        WHERE mine.org_unit_id = scope.parent_org_unit_id AND mine.leader_staff_id = @staffId
                          AND mine.leadership_role = N'manager' AND mine.archived_at IS NULL
                          AND mine.active_from <= CONVERT(date, sysutcdatetime())
                          AND (mine.active_to IS NULL OR mine.active_to >= CONVERT(date, sysutcdatetime())))
                        THEN 1 ELSE 0 END AS bit),
                   CAST(CASE WHEN EXISTS (
                        SELECT 1 FROM org.org_unit_leaderships mine
                        WHERE mine.org_unit_id = scope.org_unit_id AND mine.leader_staff_id = @staffId
                          AND mine.leadership_role = N'manager' AND mine.archived_at IS NULL
                          AND mine.active_from <= CONVERT(date, sysutcdatetime())
                          AND (mine.active_to IS NULL OR mine.active_to >= CONVERT(date, sysutcdatetime())))
                        THEN 1 ELSE 0 END AS bit)
            FROM qa.review_scopes scope
            OUTER APPLY (
                SELECT TOP (1) staff.id, staff.display_name
                FROM org.org_unit_leaderships leader JOIN people.staff staff ON staff.id = leader.leader_staff_id
                WHERE leader.org_unit_id = scope.parent_org_unit_id AND leader.leadership_role = N'manager'
                  AND leader.archived_at IS NULL AND leader.active_from <= CONVERT(date, sysutcdatetime())
                  AND (leader.active_to IS NULL OR leader.active_to >= CONVERT(date, sysutcdatetime()))
                  AND staff.archived_at IS NULL AND staff.account_status = N'active'
                ORDER BY leader.active_from DESC, staff.display_name
            ) faculty_staff
            OUTER APPLY (
                SELECT TOP (1) staff.id, staff.display_name
                FROM org.org_unit_leaderships leader JOIN people.staff staff ON staff.id = leader.leader_staff_id
                WHERE leader.org_unit_id = scope.org_unit_id AND leader.leadership_role = N'manager'
                  AND leader.archived_at IS NULL AND leader.active_from <= CONVERT(date, sysutcdatetime())
                  AND (leader.active_to IS NULL OR leader.active_to >= CONVERT(date, sysutcdatetime()))
                  AND staff.archived_at IS NULL AND staff.account_status = N'active'
                ORDER BY leader.active_from DESC, staff.display_name
            ) team_staff
            WHERE scope.review_id = @reviewId AND scope.scope_type = N'team'
            ORDER BY scope.parent_name_snapshot, scope.org_unit_name_snapshot;
            """,
            command =>
            {
                command.Parameters.AddWithValue("@reviewId", reviewId);
                command.Parameters.AddWithValue("@staffId", user.StaffId.Value);
            }, reader => new QaActionOptionRow(
                reader.GetGuid(0), reader.GetString(1), GetGuidOrNull(reader, 2), GetStringOrNull(reader, 3),
                reader.GetGuid(4), reader.GetString(5), GetGuidOrNull(reader, 6), GetStringOrNull(reader, 7),
                reader.GetBoolean(8), reader.GetBoolean(9)), cancellationToken);
        if (rows.Count == 0) return null;

        string mode;
        IReadOnlyList<QaActionOptionRow> permittedRows;
        if (QaReviewPolicy.CanMonitorActions(user))
        {
            mode = "admin";
            permittedRows = rows;
        }
        else if (review.OwnerStaffId == user.StaffId.Value)
        {
            mode = "review_owner";
            permittedRows = rows;
        }
        else if (rows.Any(row => row.LeadsFaculty))
        {
            mode = "hof";
            permittedRows = rows.Where(row => row.LeadsFaculty).ToArray();
        }
        else
        {
            mode = "pl";
            permittedRows = rows.Where(row => row.LeadsTeam).ToArray();
        }
        if (permittedRows.Count == 0) return null;
        var faculties = permittedRows.GroupBy(row => new
            { row.FacultyId, row.FacultyName, row.HeadOfFacultyId, row.HeadOfFacultyName })
            .Select(group => new QaActionFacultyOption(
                group.Key.FacultyId, group.Key.FacultyName,
                group.Key.HeadOfFacultyId.HasValue
                    ? new QaActionOwnerOption(group.Key.HeadOfFacultyId.Value, group.Key.HeadOfFacultyName!) : null,
                group.Select(row => new QaActionTeamOption(
                    row.TeamId, row.TeamName,
                    row.ProgrammeLeaderId.HasValue
                        ? new QaActionOwnerOption(row.ProgrammeLeaderId.Value, row.ProgrammeLeaderName!) : null)).ToArray()))
            .ToArray();
        return new QaReviewActionOptions(reviewId, review.Title, mode, mode == "admin", faculties);
    }

    public async Task<IReadOnlyList<QaActionGroupSummary>?> GetQaReviewActionGroupsAsync(
        Guid reviewId, CurrentUser user, CancellationToken cancellationToken)
    {
        if (!await CanViewQaReviewAsync(reviewId, user, cancellationToken)) return null;
        var owners = await QueryAsync(
            "SELECT owner_staff_id FROM core.records WHERE id = @reviewId AND archived_at IS NULL;",
            command => command.Parameters.AddWithValue("@reviewId", reviewId),
            reader => reader.GetGuid(0), cancellationToken);
        if (!QaReviewPolicy.CanUseEmbeddedActions(user, owners.SingleOrDefault())) return null;
        return await LoadQaActionGroupsAsync(reviewId, user, cancellationToken);
    }

    public async Task<IReadOnlyList<QaActionGroupSummary>> GetQaAdminActionGroupsAsync(
        CurrentUser user, CancellationToken cancellationToken)
    {
        if (!await CanUseQaActionMonitoringAsync(user, cancellationToken)) return [];
        return await LoadQaActionGroupsAsync(null, user, cancellationToken);
    }

    public async Task<QaActionGroupSummary> CreateQaActionGroupAsync(
        Guid reviewId, CreateQaActionGroupRequest request, CurrentUser user, CancellationToken cancellationToken)
    {
        var options = await GetQaReviewActionOptionsAsync(reviewId, user, cancellationToken)
            ?? throw new WorkflowValidationException("You cannot create actions for this QA Review scope.");
        if (string.IsNullOrWhiteSpace(request.Title)) throw new WorkflowValidationException("Enter an action.");
        if (request.Title.Trim().Length > 300) throw new WorkflowValidationException("QA Review action titles cannot exceed 300 characters.");
        if (request.Detail?.Trim().Length > 2000) throw new WorkflowValidationException("QA Review action detail cannot exceed 2,000 characters.");
        if (request.DueDate == default) throw new WorkflowValidationException("Enter a due date for the QA Review action.");
        if (!user.StaffId.HasValue || !user.UserAccountId.HasValue) throw new WorkflowValidationException("A linked staff account is required.");
        if (request.WholeReview && !options.CanCreateWholeReview)
            throw new WorkflowValidationException("Only an Administrator can create an all-review action.");

        QaActionFacultyOption? selectedFaculty = null;
        Guid[] selectedTeamIds;
        if (request.WholeReview)
        {
            selectedTeamIds = options.Faculties.SelectMany(faculty => faculty.Teams)
                .Select(team => team.TeamOrgUnitId).Distinct().ToArray();
        }
        else
        {
            selectedFaculty = options.Faculties.SingleOrDefault(faculty => faculty.FacultyOrgUnitId == request.FacultyOrgUnitId)
                ?? throw new WorkflowValidationException("Select a permitted review faculty.");
            var permittedTeamIds = selectedFaculty.Teams.Select(team => team.TeamOrgUnitId).ToHashSet();
            selectedTeamIds = (request.TeamOrgUnitIds ?? []).Distinct().ToArray();
            if (options.CreationMode == "pl") selectedTeamIds = permittedTeamIds.ToArray();
            if (selectedTeamIds.Length == 0 || selectedTeamIds.Any(teamId => !permittedTeamIds.Contains(teamId)))
                throw new WorkflowValidationException("Every selected team must be within your permitted QA Review scope.");
        }

        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            string reviewTitle;
            await using (var reviewCommand = new SqlCommand(
                """
                SELECT record.title FROM qa.reviews review WITH (UPDLOCK, HOLDLOCK)
                JOIN core.records record ON record.id = review.record_id
                WHERE review.record_id = @reviewId AND review.status = N'closed';
                """, connection, transaction))
            {
                reviewCommand.Parameters.AddWithValue("@reviewId", reviewId);
                reviewTitle = await reviewCommand.ExecuteScalarAsync(cancellationToken) as string
                    ?? throw new WorkflowValidationException("Actions can only be added after the QA Review has been closed.");
            }

            var scopeRows = new List<QaActionCreateScopeRow>();
            await using (var scopeCommand = new SqlCommand(
                """
                WITH selected_teams AS (
                    SELECT DISTINCT TRY_CONVERT(uniqueidentifier, [value]) AS team_id FROM OPENJSON(@teamIds)
                    WHERE TRY_CONVERT(uniqueidentifier, [value]) IS NOT NULL)
                SELECT scope.parent_org_unit_id, scope.parent_code_snapshot, scope.parent_name_snapshot,
                       scope.org_unit_id, scope.org_unit_code_snapshot, scope.org_unit_name_snapshot,
                       faculty_staff.id, faculty_staff.display_name, team_staff.id, team_staff.display_name
                FROM selected_teams selected
                JOIN qa.review_scopes scope ON scope.review_id = @reviewId
                    AND scope.scope_type = N'team' AND scope.org_unit_id = selected.team_id
                OUTER APPLY (
                    SELECT TOP (1) staff.id, staff.display_name
                    FROM org.org_unit_leaderships leader JOIN people.staff staff ON staff.id = leader.leader_staff_id
                    WHERE leader.org_unit_id = scope.parent_org_unit_id AND leader.leadership_role = N'manager'
                      AND leader.archived_at IS NULL AND leader.active_from <= CONVERT(date, sysutcdatetime())
                      AND (leader.active_to IS NULL OR leader.active_to >= CONVERT(date, sysutcdatetime()))
                      AND staff.archived_at IS NULL AND staff.account_status = N'active'
                    ORDER BY leader.active_from DESC, staff.display_name) faculty_staff
                OUTER APPLY (
                    SELECT TOP (1) staff.id, staff.display_name
                    FROM org.org_unit_leaderships leader JOIN people.staff staff ON staff.id = leader.leader_staff_id
                    WHERE leader.org_unit_id = scope.org_unit_id AND leader.leadership_role = N'manager'
                      AND leader.archived_at IS NULL AND leader.active_from <= CONVERT(date, sysutcdatetime())
                      AND (leader.active_to IS NULL OR leader.active_to >= CONVERT(date, sysutcdatetime()))
                      AND staff.archived_at IS NULL AND staff.account_status = N'active'
                    ORDER BY leader.active_from DESC, staff.display_name) team_staff;
                """, connection, transaction))
            {
                scopeCommand.Parameters.AddWithValue("@reviewId", reviewId);
                scopeCommand.Parameters.AddWithValue("@teamIds", JsonSerializer.Serialize(selectedTeamIds));
                await using var reader = await scopeCommand.ExecuteReaderAsync(cancellationToken);
                while (await reader.ReadAsync(cancellationToken))
                    scopeRows.Add(new QaActionCreateScopeRow(
                        reader.GetGuid(0), reader.GetString(1), reader.GetString(2),
                        reader.GetGuid(3), reader.GetString(4), reader.GetString(5),
                        GetGuidOrNull(reader, 6), GetStringOrNull(reader, 7),
                        GetGuidOrNull(reader, 8), GetStringOrNull(reader, 9)));
            }
            if (scopeRows.Count != selectedTeamIds.Length)
                throw new WorkflowValidationException("Every selected team must belong to this QA Review.");
            if (scopeRows.Any(scope => !scope.HeadOfFacultyId.HasValue))
                throw new WorkflowValidationException("Every selected faculty needs an active Head of Faculty before this action can be created.");

            var groupId = Guid.NewGuid();
            var groupFaculty = request.WholeReview ? null : scopeRows[0];
            await using (var groupCommand = new SqlCommand(
                """
                INSERT INTO qa.action_groups (
                    id, review_id, faculty_org_unit_id, faculty_code_snapshot, faculty_name_snapshot,
                    scope_mode, creator_staff_id, workflow_status, title, detail, due_date, created_by_user_account_id)
                VALUES (@id, @reviewId, @facultyId, @facultyCode, @facultyName,
                    @scopeMode, @creatorStaffId, N'open', @title, @detail, @dueDate, @userAccountId);
                """, connection, transaction))
            {
                groupCommand.Parameters.AddWithValue("@id", groupId);
                groupCommand.Parameters.AddWithValue("@reviewId", reviewId);
                groupCommand.Parameters.AddWithValue("@facultyId", ToDbValue(groupFaculty?.FacultyId));
                groupCommand.Parameters.AddWithValue("@facultyCode", ToDbValue(groupFaculty?.FacultyCode));
                groupCommand.Parameters.AddWithValue("@facultyName", ToDbValue(groupFaculty?.FacultyName));
                groupCommand.Parameters.AddWithValue("@scopeMode", request.WholeReview ? "whole_review" : options.CreationMode == "pl" ? "team" : "faculty");
                groupCommand.Parameters.AddWithValue("@creatorStaffId", user.StaffId.Value);
                groupCommand.Parameters.AddWithValue("@title", request.Title.Trim());
                groupCommand.Parameters.AddWithValue("@detail", ToDbValue(request.Detail?.Trim()));
                groupCommand.Parameters.AddWithValue("@dueDate", request.DueDate.ToDateTime(TimeOnly.MinValue));
                groupCommand.Parameters.AddWithValue("@userAccountId", user.UserAccountId.Value);
                await groupCommand.ExecuteNonQueryAsync(cancellationToken);
            }
            foreach (var scope in scopeRows)
            {
                await using var teamCommand = new SqlCommand(
                    """
                    INSERT INTO qa.action_group_teams (action_group_id, team_org_unit_id, team_code_snapshot, team_name_snapshot)
                    VALUES (@groupId, @teamId, @teamCode, @teamName);
                    """, connection, transaction);
                teamCommand.Parameters.AddWithValue("@groupId", groupId);
                teamCommand.Parameters.AddWithValue("@teamId", scope.TeamId);
                teamCommand.Parameters.AddWithValue("@teamCode", scope.TeamCode);
                teamCommand.Parameters.AddWithValue("@teamName", scope.TeamName);
                await teamCommand.ExecuteNonQueryAsync(cancellationToken);
            }

            var owners = new Dictionary<Guid, QaActionOwnerCreateRow>();
            foreach (var scope in scopeRows)
            {
                owners.TryAdd(scope.HeadOfFacultyId!.Value,
                    new QaActionOwnerCreateRow(scope.HeadOfFacultyId.Value, "hof", scope.FacultyId, scope.HeadOfFacultyName!));
                if (scope.ProgrammeLeaderId.HasValue)
                    owners.TryAdd(scope.ProgrammeLeaderId.Value,
                        new QaActionOwnerCreateRow(scope.ProgrammeLeaderId.Value, "pl", scope.TeamId, scope.ProgrammeLeaderName!));
            }
            foreach (var owner in owners.Values)
            {
                var actionId = Guid.NewGuid();
                await using var actionCommand = new SqlCommand(
                    """
                    INSERT INTO quality.actions (
                        id, source_record_id, source_form_type, source_sub_record_type, source_sub_record_id,
                        subject_staff_id, owner_staff_id, action_theme, title, detail,
                        status_lookup_value_id, due_date, original_due_date, published_to_staff,
                        visibility_setting, created_by_user_account_id)
                    VALUES (@id, @reviewId, N'qa_review', N'qa_action_group', @groupId,
                        @staffId, @staffId, N'Quality improvement', @title, @detail,
                        (SELECT TOP (1) value.id FROM core.lookup_values value
                         JOIN core.lookup_types type ON type.id = value.lookup_type_id
                         WHERE type.lookup_key = N'action_status' AND value.value_key = N'open'),
                        @dueDate, @dueDate, 1, N'staff_and_management', @userAccountId);
                    INSERT INTO qa.action_group_assignments (
                        action_group_id, action_id, staff_id, assignment_role, source_org_unit_id)
                    VALUES (@groupId, @id, @staffId, @assignmentRole, @sourceOrgUnitId);
                    """, connection, transaction);
                actionCommand.Parameters.AddWithValue("@id", actionId);
                actionCommand.Parameters.AddWithValue("@reviewId", reviewId);
                actionCommand.Parameters.AddWithValue("@groupId", groupId);
                actionCommand.Parameters.AddWithValue("@staffId", owner.StaffId);
                actionCommand.Parameters.AddWithValue("@title", request.Title.Trim());
                actionCommand.Parameters.AddWithValue("@detail", ToDbValue(request.Detail?.Trim()));
                actionCommand.Parameters.AddWithValue("@dueDate", request.DueDate.ToDateTime(TimeOnly.MinValue));
                actionCommand.Parameters.AddWithValue("@userAccountId", user.UserAccountId.Value);
                actionCommand.Parameters.AddWithValue("@assignmentRole", owner.AssignmentRole);
                actionCommand.Parameters.AddWithValue("@sourceOrgUnitId", owner.SourceOrgUnitId);
                await actionCommand.ExecuteNonQueryAsync(cancellationToken);
                await InsertDomainEventAsync(connection, transaction, "action.assigned", "action", actionId,
                    reviewId, JsonSerializer.Serialize(new { qaActionGroupId = groupId }), user.UserAccountId, cancellationToken);
            }
            await WriteAuditAsync(connection, transaction, user.UserAccountId, reviewId, "qa_action_group", groupId,
                "qa_action_group.created", $"Created QA action '{request.Title.Trim()}' for {(request.WholeReview ? "every review area" : groupFaculty!.FacultyName)}.",
                null, JsonSerializer.Serialize(new
                {
                    scopeMode = request.WholeReview ? "whole_review" : options.CreationMode,
                    facultyOrgUnitId = groupFaculty?.FacultyId,
                    teamOrgUnitIds = selectedTeamIds,
                    ownerStaffIds = owners.Keys,
                    reviewTitle,
                    dueDate = request.DueDate.ToString("yyyy-MM-dd")
                }), cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            var groups = await LoadQaActionGroupsAsync(reviewId, user, cancellationToken);
            return groups.Single(group => group.Id == groupId);
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public Task<QaActionGroupSummary> ReviewQaActionGroupAsync(
        Guid groupId, QaActionWorkflowRequest request, CurrentUser user, CancellationToken cancellationToken) =>
        TransitionQaActionGroupAsync(groupId, "review", request, user, cancellationToken);

    public Task<QaActionGroupSummary> CloseQaActionGroupAsync(
        Guid groupId, QaActionWorkflowRequest request, CurrentUser user, CancellationToken cancellationToken) =>
        TransitionQaActionGroupAsync(groupId, "close", request, user, cancellationToken);

    private async Task<QaActionGroupSummary> TransitionQaActionGroupAsync(
        Guid groupId, string transition, QaActionWorkflowRequest request,
        CurrentUser user, CancellationToken cancellationToken)
    {
        if (!user.UserAccountId.HasValue || !user.StaffId.HasValue)
            throw new WorkflowValidationException("A linked staff account is required.");
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            Guid reviewId;
            Guid? creatorStaffId;
            string title;
            string status;
            byte[] rowVersion;
            await using (var read = new SqlCommand(
                "SELECT review_id, creator_staff_id, title, workflow_status, row_version FROM qa.action_groups WITH (UPDLOCK, HOLDLOCK) WHERE id = @id;",
                connection, transaction))
            {
                read.Parameters.AddWithValue("@id", groupId);
                await using var reader = await read.ExecuteReaderAsync(cancellationToken);
                if (!await reader.ReadAsync(cancellationToken)) throw new WorkflowValidationException("The QA action was not found.");
                reviewId = reader.GetGuid(0);
                creatorStaffId = GetGuidOrNull(reader, 1);
                title = reader.GetString(2);
                status = reader.GetString(3);
                rowVersion = reader.GetFieldValue<byte[]>(4);
            }
            if (!rowVersion.SequenceEqual(request.RowVersion))
                throw new WorkflowValidationException("This QA action changed after it was opened. Refresh and try again.");
            if (creatorStaffId != user.StaffId && !QaReviewPolicy.CanReviewActions(user))
                throw new WorkflowValidationException("Only the creator, Teaching & Learning or an Administrator can review this action.");
            var expected = transition == "review" ? "open" : "reviewed";
            if (!string.Equals(status, expected, StringComparison.OrdinalIgnoreCase))
                throw new WorkflowValidationException(transition == "review"
                    ? "Only an open QA action can be reviewed." : "Review the QA action before closing it.");

            if (transition == "review")
            {
                await using var update = new SqlCommand(
                    """
                    UPDATE qa.action_groups SET workflow_status = N'reviewed', reviewed_at = sysutcdatetime(),
                        reviewed_by_user_account_id = @userAccountId, updated_at = sysutcdatetime() WHERE id = @id;
                    """, connection, transaction);
                update.Parameters.AddWithValue("@id", groupId);
                update.Parameters.AddWithValue("@userAccountId", user.UserAccountId.Value);
                await update.ExecuteNonQueryAsync(cancellationToken);
            }
            else
            {
                await using var update = new SqlCommand(
                    """
                    UPDATE action SET status_lookup_value_id = (
                            SELECT TOP (1) value.id FROM core.lookup_values value
                            JOIN core.lookup_types type ON type.id = value.lookup_type_id
                            WHERE type.lookup_key = N'action_status' AND value.value_key = N'complete'),
                        completed_date = COALESCE(completed_date, CONVERT(date, sysutcdatetime())),
                        completed_by_user_account_id = COALESCE(completed_by_user_account_id, @userAccountId),
                        completion_note = COALESCE(completion_note, N'Closed from QA action monitoring.'),
                        progress_status = CASE WHEN progress_status IS NULL THEN NULL ELSE N'completed' END,
                        updated_by_user_account_id = @userAccountId, updated_at = sysutcdatetime()
                    FROM quality.actions action
                    JOIN qa.action_group_assignments assignment ON assignment.action_id = action.id
                    WHERE assignment.action_group_id = @id AND action.archived_at IS NULL;
                    UPDATE qa.action_groups SET workflow_status = N'closed', closed_at = sysutcdatetime(),
                        closed_by_user_account_id = @userAccountId, updated_at = sysutcdatetime() WHERE id = @id;
                    """, connection, transaction);
                update.Parameters.AddWithValue("@id", groupId);
                update.Parameters.AddWithValue("@userAccountId", user.UserAccountId.Value);
                await update.ExecuteNonQueryAsync(cancellationToken);
            }
            await WriteAuditAsync(connection, transaction, user.UserAccountId, reviewId, "qa_action_group", groupId,
                transition == "review" ? "qa_action_group.reviewed" : "qa_action_group.closed",
                $"QA action '{title}' {(transition == "review" ? "reviewed" : "closed")} by {user.DisplayName}.",
                null, JsonSerializer.Serialize(new { status = transition == "review" ? "reviewed" : "closed" }), cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            var groups = await LoadQaActionGroupsAsync(reviewId, user, cancellationToken);
            return groups.Single(group => group.Id == groupId);
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    private async Task<IReadOnlyList<QaActionGroupSummary>> LoadQaActionGroupsAsync(
        Guid? reviewId, CurrentUser user, CancellationToken cancellationToken)
    {
        var rows = await QueryAsync(
            """
            SELECT action_group.id, action_group.review_id, record.title,
                   action_group.faculty_org_unit_id, COALESCE(action_group.faculty_name_snapshot, N'Whole review'),
                   action_group.title, action_group.detail, action_group.due_date,
                   action_group.workflow_status, action_group.created_at,
                   action_group.creator_staff_id, COALESCE(creator.display_name, N'System'),
                   action_group.reviewed_at, action_group.closed_at,
                   action_group.forced_close_note, action_group.row_version
            FROM qa.action_groups action_group
            JOIN core.records record ON record.id = action_group.review_id
            LEFT JOIN people.staff creator ON creator.id = action_group.creator_staff_id
            WHERE (@reviewId IS NULL OR action_group.review_id = @reviewId)
              AND (@monitorAll = 1 OR action_group.creator_staff_id = @staffId
                   OR EXISTS (SELECT 1 FROM qa.action_group_assignments assignment
                              WHERE assignment.action_group_id = action_group.id AND assignment.staff_id = @staffId)
                   OR EXISTS (
                        SELECT 1 FROM qa.action_group_teams selected_team
                        JOIN qa.review_scopes scope ON scope.review_id = action_group.review_id
                            AND scope.scope_type = N'team' AND scope.org_unit_id = selected_team.team_org_unit_id
                        JOIN org.org_unit_leaderships leadership
                          ON leadership.org_unit_id IN (scope.org_unit_id, scope.parent_org_unit_id)
                         AND leadership.leader_staff_id = @staffId
                         AND leadership.leadership_role = N'manager'
                         AND leadership.archived_at IS NULL
                         AND leadership.active_from <= CONVERT(date, sysutcdatetime())
                         AND (leadership.active_to IS NULL OR leadership.active_to >= CONVERT(date, sysutcdatetime()))
                        WHERE selected_team.action_group_id = action_group.id))
            ORDER BY CASE action_group.workflow_status WHEN N'open' THEN 0 WHEN N'reviewed' THEN 1 ELSE 2 END,
                     action_group.due_date, action_group.created_at DESC;
            """,
            command =>
            {
                command.Parameters.AddWithValue("@reviewId", ToDbValue(reviewId));
                command.Parameters.AddWithValue("@monitorAll", QaReviewPolicy.CanReviewActions(user));
                command.Parameters.AddWithValue("@staffId", ToDbValue(user.StaffId));
            }, reader => new QaActionGroupRow(
                reader.GetGuid(0), reader.GetGuid(1), reader.GetString(2), GetGuidOrNull(reader, 3), reader.GetString(4),
                reader.GetString(5), GetStringOrNull(reader, 6), DateOnly.FromDateTime(reader.GetDateTime(7)),
                reader.GetString(8), reader.GetFieldValue<DateTimeOffset>(9), GetGuidOrNull(reader, 10), reader.GetString(11),
                GetDateTimeOffsetOrNull(reader, 12), GetDateTimeOffsetOrNull(reader, 13), GetStringOrNull(reader, 14),
                reader.GetFieldValue<byte[]>(15)), cancellationToken);
        if (rows.Count == 0) return [];
        var groupIdsJson = JsonSerializer.Serialize(rows.Select(row => row.Id));
        var teams = await QueryAsync(
            """
            SELECT team.action_group_id, team.team_org_unit_id, team.team_name_snapshot
            FROM qa.action_group_teams team
            JOIN OPENJSON(@groupIds) selected ON TRY_CONVERT(uniqueidentifier, selected.[value]) = team.action_group_id
            ORDER BY team.team_name_snapshot;
            """, command => command.Parameters.AddWithValue("@groupIds", groupIdsJson),
            reader => new QaActionGroupTeamRow(reader.GetGuid(0), reader.GetGuid(1), reader.GetString(2)), cancellationToken);
        var assignments = await QueryAsync(
            """
            SELECT assignment.action_group_id, assignment.action_id, assignment.staff_id,
                   staff.display_name, assignment.assignment_role, assignment.source_org_unit_id,
                   unit.name, COALESCE(status.value_key, N'open'), action.completed_date
            FROM qa.action_group_assignments assignment
            JOIN OPENJSON(@groupIds) selected ON TRY_CONVERT(uniqueidentifier, selected.[value]) = assignment.action_group_id
            JOIN quality.actions action ON action.id = assignment.action_id
            JOIN people.staff staff ON staff.id = assignment.staff_id
            JOIN org.org_units unit ON unit.id = assignment.source_org_unit_id
            LEFT JOIN core.lookup_values status ON status.id = action.status_lookup_value_id
            ORDER BY CASE assignment.assignment_role WHEN N'hof' THEN 0 ELSE 1 END, staff.display_name;
            """, command => command.Parameters.AddWithValue("@groupIds", groupIdsJson),
            reader => new QaActionAssignmentRow(
                reader.GetGuid(0), reader.GetGuid(1), reader.GetGuid(2), reader.GetString(3), reader.GetString(4),
                reader.GetGuid(5), reader.GetString(6), reader.GetString(7), GetDateOnlyOrNull(reader, 8)), cancellationToken);

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        return rows.Select(row =>
        {
            var groupTeams = teams.Where(team => team.GroupId == row.Id).ToArray();
            var groupAssignments = assignments.Where(assignment => assignment.GroupId == row.Id).ToArray();
            var status = row.WorkflowStatus == "open" && row.DueDate < today ? "overdue" : row.WorkflowStatus;
            var canTransition = row.CreatorStaffId == user.StaffId || QaReviewPolicy.CanReviewActions(user);
            return new QaActionGroupSummary(
                row.Id, row.ReviewId, row.ReviewTitle, row.FacultyId, row.FacultyName,
                groupTeams.Select(team => team.TeamId).ToArray(), groupTeams.Select(team => team.TeamName).ToArray(),
                row.Title, row.Detail, row.DueDate, status, row.CreatedAt, row.CreatorStaffId, row.CreatorName,
                row.ReviewedAt, row.ClosedAt, row.CloseNote,
                groupAssignments.Select(assignment => new QaActionAssignmentSummary(
                    assignment.ActionId, assignment.StaffId, assignment.StaffName, assignment.AssignmentRole,
                    assignment.SourceOrgUnitId, assignment.SourceOrgUnitName, assignment.Status, assignment.CompletedDate)).ToArray(),
                row.RowVersion, canTransition && status is "open" or "overdue", canTransition && status == "reviewed");
        }).ToArray();
    }

    private sealed record QaActionOptionRow(
        Guid FacultyId, string FacultyName, Guid? HeadOfFacultyId, string? HeadOfFacultyName,
        Guid TeamId, string TeamName, Guid? ProgrammeLeaderId, string? ProgrammeLeaderName,
        bool LeadsFaculty, bool LeadsTeam);
    private sealed record QaActionCreateScopeRow(
        Guid FacultyId, string FacultyCode, string FacultyName,
        Guid TeamId, string TeamCode, string TeamName,
        Guid? HeadOfFacultyId, string? HeadOfFacultyName,
        Guid? ProgrammeLeaderId, string? ProgrammeLeaderName);
    private sealed record QaActionOwnerCreateRow(Guid StaffId, string AssignmentRole, Guid SourceOrgUnitId, string DisplayName);
    private sealed record QaActionGroupRow(
        Guid Id, Guid ReviewId, string ReviewTitle, Guid? FacultyId, string FacultyName,
        string Title, string? Detail, DateOnly DueDate, string WorkflowStatus, DateTimeOffset CreatedAt,
        Guid? CreatorStaffId, string CreatorName, DateTimeOffset? ReviewedAt,
        DateTimeOffset? ClosedAt, string? CloseNote, byte[] RowVersion);
    private sealed record QaActionGroupTeamRow(Guid GroupId, Guid TeamId, string TeamName);
    private sealed record QaActionAssignmentRow(
        Guid GroupId, Guid ActionId, Guid StaffId, string StaffName, string AssignmentRole,
        Guid SourceOrgUnitId, string SourceOrgUnitName, string Status, DateOnly? CompletedDate);
}
