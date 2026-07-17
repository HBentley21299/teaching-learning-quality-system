using System.Text.Json;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Reporting;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    public async Task<IReadOnlyList<ActivityOverTimePointSummary>> GetActivityOverTimeAsync(
        CurrentUser currentUser,
        string processKey,
        DateOnly? startDate,
        DateOnly? endDate,
        string? areaCode,
        string? status,
        string? theme,
        string? practiceObserved,
        CancellationToken cancellationToken)
    {
        var permitted = (await GetProcessDashboardRecordsAsync(currentUser, cancellationToken))
            .Where(record => string.Equals(record.ProcessKey, processKey, StringComparison.OrdinalIgnoreCase))
            .Where(record => string.IsNullOrWhiteSpace(status) || string.Equals(record.Status, status, StringComparison.OrdinalIgnoreCase))
            .Where(record => string.IsNullOrWhiteSpace(theme) || SplitDashboardValues(record.Theme).Contains(theme, StringComparer.OrdinalIgnoreCase))
            .Where(record => string.IsNullOrWhiteSpace(practiceObserved)
                || string.Equals(ParseRubricLabel(record.PracticeObserved) ?? record.PracticeObserved, practiceObserved, StringComparison.OrdinalIgnoreCase))
            .Where(record => string.IsNullOrWhiteSpace(areaCode) || DashboardRecordMatchesArea(record, areaCode))
            .ToArray();

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var resolvedEnd = endDate ?? (permitted.Length > 0
            ? permitted.Max(record => record.RecordDate ?? DateOnly.FromDateTime(record.CreatedAt.UtcDateTime))
            : today);
        var resolvedStart = startDate ?? (permitted.Length > 0
            ? permitted.Min(record => record.RecordDate ?? DateOnly.FromDateTime(record.CreatedAt.UtcDateTime))
            : resolvedEnd.AddMonths(-11));

        // Keep the default chart readable while explicit reporting periods are
        // returned in full.
        if (!startDate.HasValue && resolvedStart < resolvedEnd.AddMonths(-23))
        {
            resolvedStart = resolvedEnd.AddMonths(-23);
        }

        var inputs = permitted.Select(record => new MonthlyActivityInput(
            record.RecordDate ?? DateOnly.FromDateTime(record.CreatedAt.UtcDateTime),
            record.RecordType));
        return MonthlyActivityAggregator
            .Aggregate(inputs, resolvedStart, resolvedEnd, processKey)
            .Select(point => new ActivityOverTimePointSummary(point.Month, point.Count, point.RecordType))
            .ToArray();
    }

    public async Task<ActionDetailSummary?> GetActionDetailAsync(
        Guid actionId,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        if (!(await GetActionsAsync(currentUser, cancellationToken)).Any(action => action.Id == actionId))
        {
            return null;
        }

        var rows = await QueryAsync(
            """
            SELECT a.id, a.source_record_id, source.title, source.record_type,
                   a.subject_staff_id, subject.display_name, a.owner_staff_id, owner.display_name,
                   a.title, a.detail, status_value.value_key, priority_value.value_key,
                   a.due_date, a.completed_date, a.completion_note, a.created_at, a.updated_at
            FROM quality.actions a
            LEFT JOIN core.records source ON source.id = a.source_record_id
            LEFT JOIN people.staff subject ON subject.id = a.subject_staff_id
            LEFT JOIN people.staff owner ON owner.id = a.owner_staff_id
            LEFT JOIN core.lookup_values status_value ON status_value.id = a.status_lookup_value_id
            LEFT JOIN core.lookup_values priority_value ON priority_value.id = a.priority_lookup_value_id
            WHERE a.id = @actionId AND a.archived_at IS NULL;
            """,
            command => command.Parameters.AddWithValue("@actionId", actionId),
            reader => new ActionDetailRow(
                reader.GetGuid(0), GetGuidOrNull(reader, 1), GetStringOrNull(reader, 2), GetStringOrNull(reader, 3),
                GetGuidOrNull(reader, 4), GetStringOrNull(reader, 5), reader.GetGuid(6), GetStringOrNull(reader, 7),
                reader.GetString(8), GetStringOrNull(reader, 9), GetStringOrNull(reader, 10), GetStringOrNull(reader, 11),
                GetDateOnlyOrNull(reader, 12), GetDateOnlyOrNull(reader, 13), GetStringOrNull(reader, 14),
                reader.GetFieldValue<DateTimeOffset>(15), GetDateTimeOffsetOrNull(reader, 16)),
            cancellationToken);
        if (rows.Count == 0)
        {
            return null;
        }

        var audit = await QueryAsync(
            """
            SELECT log.id, log.action, log.summary, staff.display_name, log.created_at
            FROM ops.audit_logs log
            LEFT JOIN auth.user_accounts account ON account.id = log.user_account_id
            LEFT JOIN people.staff staff ON staff.id = account.staff_id
            WHERE log.entity_name = 'action' AND log.entity_id = @actionId
            ORDER BY log.created_at DESC;
            """,
            command => command.Parameters.AddWithValue("@actionId", actionId),
            reader => new AuditHistorySummary(
                reader.GetGuid(0), reader.GetString(1), GetStringOrNull(reader, 2),
                GetStringOrNull(reader, 3), reader.GetFieldValue<DateTimeOffset>(4)),
            cancellationToken);
        var row = rows[0];
        return new ActionDetailSummary(
            row.Id, row.SourceRecordId, row.SourceRecordTitle, row.SourceRecordType,
            row.SubjectStaffId, row.SubjectStaffName, row.OwnerStaffId, row.OwnerStaffName,
            row.Title, row.Detail, row.StatusKey, row.PriorityKey, row.DueDate,
            row.CompletedDate, row.CompletionNote, row.CreatedAt, row.UpdatedAt, audit);
    }

    public async Task<IReadOnlyList<StaffAssociatedRecordSummary>> GetStaffAssociatedRecordsAsync(
        Guid staffId,
        CancellationToken cancellationToken) =>
        await QueryAsync(
            """
            WITH associated_record_ids AS (
                SELECT r.id
                FROM core.records r
                WHERE r.subject_staff_id = @staffId AND r.archived_at IS NULL
                UNION
                SELECT event.record_id
                FROM cpd.cpd_attendance attendance
                JOIN cpd.cpd_events event ON event.id = attendance.cpd_event_id
                JOIN core.records r ON r.id = event.record_id
                WHERE attendance.staff_id = @staffId
                  AND attendance.archived_at IS NULL
                  AND event.archived_at IS NULL
                  AND r.archived_at IS NULL
            )
            SELECT r.id, r.record_type, r.title, r.record_date,
                   COALESCE(coaching.status, liv.status, practice.status, submission.status, 'submitted') AS status,
                   r.summary,
                   practice_observed.response_text
            FROM associated_record_ids associated
            JOIN core.records r ON r.id = associated.id
            LEFT JOIN quality.coaching_sessions coaching ON coaching.record_id = r.id AND coaching.archived_at IS NULL
            LEFT JOIN quality.liv_records liv ON liv.record_id = r.id AND liv.archived_at IS NULL
            LEFT JOIN quality.elevate_practice_assessments practice ON practice.record_id = r.id
            OUTER APPLY (
                SELECT TOP (1) form_submission.id, form_submission.status
                FROM forms.form_submissions form_submission
                WHERE form_submission.record_id = r.id AND form_submission.archived_at IS NULL
                ORDER BY form_submission.created_at DESC
            ) submission
            OUTER APPLY (
                SELECT TOP (1) response.response_text
                FROM forms.form_responses response
                JOIN forms.form_fields field ON field.id = response.form_field_id
                WHERE response.form_submission_id = submission.id
                  AND response.archived_at IS NULL
                  AND field.field_key = 'practice_observed'
            ) practice_observed
            ORDER BY COALESCE(r.record_date, CONVERT(date, r.created_at)) DESC, r.created_at DESC;
            """,
            command => command.Parameters.AddWithValue("@staffId", staffId),
            reader => new StaffAssociatedRecordSummary(
                reader.GetGuid(0), reader.GetString(1), reader.GetString(2), GetDateOnlyOrNull(reader, 3),
                reader.GetString(4), GetStringOrNull(reader, 5), GetStringOrNull(reader, 6)),
            cancellationToken);

    public async Task<IReadOnlyList<StaffReflectionRecordSummary>> GetStaffReflectionRecordsAsync(
        Guid staffId,
        CancellationToken cancellationToken) =>
        await QueryAsync(
            """
            SELECT reflection.id, reflection.record_id, reflection.title, reflection.reflection_text,
                   reflection.reflection_date, reflection.created_at
            FROM quality.staff_profile_reflections reflection
            JOIN core.records record_row ON record_row.id = reflection.record_id AND record_row.archived_at IS NULL
            WHERE reflection.staff_id = @staffId AND reflection.archived_at IS NULL
            ORDER BY reflection.reflection_date DESC, reflection.created_at DESC;
            """,
            command => command.Parameters.AddWithValue("@staffId", staffId),
            reader => new StaffReflectionRecordSummary(
                reader.GetGuid(0), reader.GetGuid(1), reader.GetString(2), reader.GetString(3),
                DateOnly.FromDateTime(reader.GetDateTime(4)), reader.GetFieldValue<DateTimeOffset>(5)),
            cancellationToken);

    public async Task<Guid> CreateStaffReflectionAsync(
        Guid staffId,
        CreateStaffReflectionRequest request,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        if ((currentUser.StaffId != staffId && !currentUser.HasPermission(PermissionKeys.StaffManage))
            || string.IsNullOrWhiteSpace(request.Title)
            || string.IsNullOrWhiteSpace(request.Text))
        {
            throw new WorkflowValidationException("A reflection title and reflection text are required.");
        }

        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            var moduleId = await GetModuleIdAsync(connection, transaction, "evidence", cancellationToken);
            var recordId = Guid.NewGuid();
            var reflectionId = Guid.NewGuid();
            await using (var command = new SqlCommand(
                """
                INSERT INTO core.records (
                    id, module_id, record_type, title, subject_staff_id, owner_staff_id,
                    record_date, created_by_user_account_id
                )
                VALUES (
                    @recordId, @moduleId, 'reflection', @title, @staffId, @ownerStaffId,
                    @reflectionDate, @currentUserAccountId
                );

                INSERT INTO quality.staff_profile_reflections (
                    id, record_id, staff_id, title, reflection_text, reflection_date, created_by_user_account_id
                )
                VALUES (
                    @reflectionId, @recordId, @staffId, @title, @text, @reflectionDate, @currentUserAccountId
                );
                """,
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@recordId", recordId);
                command.Parameters.AddWithValue("@reflectionId", reflectionId);
                command.Parameters.AddWithValue("@moduleId", moduleId);
                command.Parameters.AddWithValue("@staffId", staffId);
                command.Parameters.AddWithValue("@ownerStaffId", ToDbValue(currentUser.StaffId ?? staffId));
                command.Parameters.AddWithValue("@title", request.Title.Trim());
                command.Parameters.AddWithValue("@text", request.Text.Trim());
                command.Parameters.AddWithValue("@reflectionDate", request.ReflectionDate.ToDateTime(TimeOnly.MinValue));
                command.Parameters.AddWithValue("@currentUserAccountId", ToDbValue(currentUser.UserAccountId));
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            await WriteAuditAsync(
                connection, transaction, currentUser.UserAccountId, recordId, "staff_reflection", reflectionId,
                "staff_profile.reflection_created", $"Reflection '{request.Title.Trim()}' created by {currentUser.DisplayName}.",
                null, JsonSerializer.Serialize(new { request.Title, request.ReflectionDate }), cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return recordId;
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task<StaffReflectionDetailSummary?> GetStaffReflectionByRecordIdAsync(
        Guid recordId,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        var rows = await QueryAsync(
            """
            SELECT reflection.id, reflection.record_id, reflection.staff_id, staff.display_name,
                   reflection.title, reflection.reflection_text, reflection.reflection_date, reflection.created_at
            FROM quality.staff_profile_reflections reflection
            JOIN people.staff staff ON staff.id = reflection.staff_id
            JOIN core.records record_row ON record_row.id = reflection.record_id
            WHERE reflection.record_id = @recordId
              AND reflection.archived_at IS NULL
              AND record_row.archived_at IS NULL;
            """,
            command => command.Parameters.AddWithValue("@recordId", recordId),
            reader => new StaffReflectionDetailSummary(
                reader.GetGuid(0), reader.GetGuid(1), reader.GetGuid(2), reader.GetString(3),
                reader.GetString(4), reader.GetString(5), DateOnly.FromDateTime(reader.GetDateTime(6)),
                reader.GetFieldValue<DateTimeOffset>(7)),
            cancellationToken);
        var result = rows.FirstOrDefault();
        if (result is null)
        {
            return null;
        }

        var canView = result.StaffId == currentUser.StaffId
            || CanViewAllStaffProfiles(currentUser)
            || (currentUser.HasPermission(PermissionKeys.ReportsViewScoped)
                && await IsStaffProfileInScopeAsync(result.StaffId, currentUser, cancellationToken));
        return canView ? result : null;
    }

    public async Task<LivRecordSummary?> GetLivRecordByRecordIdAsync(
        Guid recordId,
        CurrentUser currentUser,
        CancellationToken cancellationToken) =>
        (await GetLivRecordsAsync(currentUser, cancellationToken)).FirstOrDefault(record => record.RecordId == recordId);

    public async Task<CoachingSessionDetail?> GetCoachingSessionByRecordIdAsync(
        Guid recordId,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        var ids = await QueryAsync(
            "SELECT id FROM quality.coaching_sessions WHERE record_id = @recordId AND archived_at IS NULL;",
            command => command.Parameters.AddWithValue("@recordId", recordId),
            reader => reader.GetGuid(0),
            cancellationToken);
        return ids.Count == 0 ? null : await GetCoachingSessionAsync(ids[0], currentUser, cancellationToken);
    }

    public async Task<ElevatePracticeWorkspaceSummary?> GetElevatePracticeByRecordIdAsync(
        Guid recordId,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        var records = await QueryAsync(
            """
            SELECT staff_id, academic_year
            FROM quality.elevate_practice_assessments
            WHERE record_id = @recordId;
            """,
            command => command.Parameters.AddWithValue("@recordId", recordId),
            reader => new { StaffId = reader.GetGuid(0), AcademicYear = reader.GetString(1) },
            cancellationToken);
        if (records.Count == 0)
        {
            return null;
        }

        var record = records[0];
        var canView = record.StaffId == currentUser.StaffId
            || CanViewAllStaffProfiles(currentUser)
            || (currentUser.HasPermission(PermissionKeys.ReportsViewScoped)
                && await IsStaffProfileInScopeAsync(record.StaffId, currentUser, cancellationToken));
        return canView
            ? await GetElevatePracticeWorkspaceAsync(record.StaffId, record.AcademicYear, false, cancellationToken)
            : null;
    }

    private static bool DashboardRecordMatchesArea(ProcessDashboardRecordSummary record, string areaCode)
    {
        if (string.Equals(record.AreaCode, areaCode, StringComparison.OrdinalIgnoreCase)
            || string.Equals(record.ParentAreaCode, areaCode, StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        return SplitDashboardValues(record.ParticipantAreaBreakdown, '|')
            .Select(metric => metric.Split('~'))
            .Any(parts => parts.Length >= 2
                && (string.Equals(parts[0], areaCode, StringComparison.OrdinalIgnoreCase)
                    || string.Equals(parts[1], areaCode, StringComparison.OrdinalIgnoreCase)));
    }

    private static IReadOnlyList<string> SplitDashboardValues(string? value, char separator = '|') =>
        value?.Split(separator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries) ?? [];

    private sealed record ActionDetailRow(
        Guid Id,
        Guid? SourceRecordId,
        string? SourceRecordTitle,
        string? SourceRecordType,
        Guid? SubjectStaffId,
        string? SubjectStaffName,
        Guid OwnerStaffId,
        string? OwnerStaffName,
        string Title,
        string? Detail,
        string? StatusKey,
        string? PriorityKey,
        DateOnly? DueDate,
        DateOnly? CompletedDate,
        string? CompletionNote,
        DateTimeOffset CreatedAt,
        DateTimeOffset? UpdatedAt);
}
