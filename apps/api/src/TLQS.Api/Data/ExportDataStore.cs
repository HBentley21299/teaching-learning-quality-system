using System.Globalization;
using System.Diagnostics;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    internal const int InteractiveExportRowLimit = 25_000;

    public async Task<ExportWorkbookData> GetExportWorkbookAsync(
        string moduleKey,
        ExportFilter filter,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        var normalizedKey = NormalizeExportModuleKey(moduleKey);
        await using var connection = await OpenConnectionAsync(cancellationToken);
        var sheets = normalizedKey switch
        {
            "staff" => await BuildStaffExportAsync(connection, filter, currentUser, cancellationToken),
            "actions" => await BuildActionExportAsync(connection, filter, currentUser, cancellationToken),
            "cpd" => await BuildCpdExportAsync(connection, filter, currentUser, cancellationToken),
            "coaching" => await BuildCoachingExportAsync(connection, filter, currentUser, cancellationToken),
            "reflections" => await BuildReflectionExportAsync(connection, filter, currentUser, cancellationToken),
            "liv" => await BuildLivExportAsync(connection, filter, currentUser, cancellationToken),
            "elevate-practice" => await BuildElevatePracticeExportAsync(connection, filter, currentUser, cancellationToken),
            "learning-walks" => await BuildGenericRecordExportAsync(connection, "learning_walk", "Learning Walks", filter, currentUser, cancellationToken),
            "work-scrutiny" => await BuildGenericRecordExportAsync(connection, "work_scrutiny", "Work Scrutiny", filter, currentUser, cancellationToken),
            "elevate-environments" => await BuildGenericRecordExportAsync(connection, "elevate_environment", "Learning Environments", filter, currentUser, cancellationToken),
            "probation" => await BuildGenericRecordExportAsync(connection, "probation_case", "Probationary Observations", filter, currentUser, cancellationToken),
            _ => throw new WorkflowValidationException("Select a supported export area.")
        };
        return new ExportWorkbookData(
            normalizedKey, ExportDisplayName(normalizedKey), filter,
            currentUser.DisplayName, DateTimeOffset.UtcNow, sheets);
    }

    public async Task<RecordReportData?> GetRecordReportAsync(
        Guid recordId,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var command = new SqlCommand(
            """
            WITH visible_staff AS (SELECT staff_id FROM org.fn_visible_staff(@currentUserAccountId)),
                 visible_org AS (SELECT org_unit_id FROM org.fn_visible_org_units(@currentUserAccountId))
            SELECT record_row.id, record_row.title, record_row.record_type,
                   COALESCE(status_value.display_name, status_value.value_key, N'Draft'),
                   subject.display_name, reviewer.display_name,
                   COALESCE(record_row.org_unit_name_snapshot, unit.name), record_row.record_date,
                   record_row.created_at, COALESCE(creator.display_name, N'System')
            FROM core.records record_row
            LEFT JOIN core.lookup_values status_value ON status_value.id = record_row.status_lookup_value_id
            LEFT JOIN people.staff subject ON subject.id = record_row.subject_staff_id
            LEFT JOIN people.staff reviewer ON reviewer.id = record_row.owner_staff_id
            LEFT JOIN org.org_units unit ON unit.id = record_row.org_unit_id
            LEFT JOIN auth.user_accounts creator_account ON creator_account.id = record_row.created_by_user_account_id
            LEFT JOIN people.staff creator ON creator.id = creator_account.staff_id
            WHERE record_row.id = @recordId
              AND record_row.archived_at IS NULL
              AND (
                  record_row.created_by_user_account_id = @currentUserAccountId
                  OR EXISTS (SELECT 1 FROM visible_staff WHERE staff_id IN (record_row.subject_staff_id, record_row.owner_staff_id))
                  OR EXISTS (SELECT 1 FROM visible_org WHERE org_unit_id = record_row.org_unit_id)
              );
            """, connection);
        AddScopeParameters(command, currentUser);
        command.Parameters.AddWithValue("@recordId", recordId);
        RecordReportHeader? header = null;
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            if (await reader.ReadAsync(cancellationToken))
            {
                header = new RecordReportHeader(
                    reader.GetGuid(0), reader.GetString(1), reader.GetString(2), reader.GetString(3),
                    GetStringOrNull(reader, 4), GetStringOrNull(reader, 5), GetStringOrNull(reader, 6),
                    GetDateOnlyOrNull(reader, 7), reader.GetFieldValue<DateTimeOffset>(8), reader.GetString(9));
            }
        }
        if (header is null) return null;

        var fields = await QueryOnConnectionAsync(
            connection,
            """
            SELECT section.title, field.label,
                   COALESCE(response.response_text,
                            CONVERT(nvarchar(100), response.response_number),
                            CONVERT(nvarchar(30), response.response_date, 23),
                            lookup_value.display_name,
                            response.response_json)
            FROM forms.form_submissions submission
            JOIN forms.form_responses response ON response.form_submission_id = submission.id AND response.archived_at IS NULL
            JOIN forms.form_fields field ON field.id = response.form_field_id
            JOIN forms.form_sections section ON section.id = field.form_section_id
            LEFT JOIN core.lookup_values lookup_value ON lookup_value.id = response.response_lookup_value_id
            WHERE submission.record_id = @recordId AND submission.archived_at IS NULL
            ORDER BY section.display_order, field.display_order;
            """,
            command => command.Parameters.AddWithValue("@recordId", recordId),
            reader => new RecordReportResponse(reader.GetString(0), reader.GetString(1), GetStringOrNull(reader, 2)),
            cancellationToken);
        var actions = await QueryOnConnectionAsync(
            connection,
            """
            SELECT action_row.title, owner.display_name, action_row.due_date,
                   COALESCE(status_value.display_name, status_value.value_key, N'Open')
            FROM quality.actions action_row
            LEFT JOIN people.staff owner ON owner.id = action_row.owner_staff_id
            LEFT JOIN core.lookup_values status_value ON status_value.id = action_row.status_lookup_value_id
            WHERE action_row.source_record_id = @recordId AND action_row.archived_at IS NULL
            ORDER BY action_row.due_date, action_row.created_at;
            """,
            command => command.Parameters.AddWithValue("@recordId", recordId),
            reader => new RecordReportAction(
                reader.GetString(0), GetStringOrNull(reader, 1), GetDateOnlyOrNull(reader, 2), reader.GetString(3)),
            cancellationToken);
        var sections = fields.GroupBy(item => item.Section)
            .Select(group => new RecordReportSection(
                group.Key,
                group.Select(item => new RecordReportField(item.Label, item.Value)).ToArray()))
            .ToArray();
        return new RecordReportData(
            header.Id, header.Title, header.RecordType, header.Status, header.StaffName,
            header.ReviewerName, header.Organisation, header.RecordDate, header.CreatedAt,
            header.CreatedBy, sections, actions);
    }

    public async Task RecordExportAuditAsync(
        string moduleKey,
        string format,
        ExportFilter filter,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var command = new SqlCommand(
            """
            INSERT INTO ops.audit_logs (
                user_account_id, entity_name, action, summary, after_json
            ) VALUES (
                @userId, N'export', N'export.created', @summary, @details
            );
            """, connection);
        command.Parameters.AddWithValue("@userId", ToDbValue(currentUser.UserAccountId));
        command.Parameters.AddWithValue("@summary", $"{format.ToUpperInvariant()} export created for {moduleKey} by {currentUser.DisplayName}.");
        command.Parameters.AddWithValue("@details", JsonSerializer.Serialize(new { ModuleKey = moduleKey, Format = format, Filter = filter }));
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private async Task<IReadOnlyList<ExportSheet>> BuildGenericRecordExportAsync(
        SqlConnection connection,
        string recordType,
        string sheetName,
        ExportFilter filter,
        CurrentUser user,
        CancellationToken cancellationToken)
    {
        var main = await ReadExportSheetAsync(connection, sheetName, $"""
            {ScopedRecordsCte}
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), record_row.id) AS [Record ID],
                   record_row.title AS [Title], record_row.record_type AS [Record type],
                   COALESCE(status_value.display_name, status_value.value_key, N'Draft') AS [Status],
                   subject.display_name AS [Staff member], owner.display_name AS [Reviewer or owner],
                   faculty.code AS [Faculty code], faculty.name AS [Faculty],
                   team.code AS [Sub-team code], team.name AS [Sub-team],
                   record_row.record_date AS [Record date], record_row.academic_year_key AS [Academic year],
                   record_row.summary AS [Summary], creator.display_name AS [Created by],
                   record_row.created_at AS [Created at], record_row.updated_at AS [Updated at]
            FROM scoped_records record_row
            LEFT JOIN core.lookup_values status_value ON status_value.id = record_row.status_lookup_value_id
            LEFT JOIN people.staff subject ON subject.id = record_row.subject_staff_id
            LEFT JOIN people.staff owner ON owner.id = record_row.owner_staff_id
            LEFT JOIN org.org_units area ON area.id = record_row.org_unit_id
            LEFT JOIN org.org_units faculty ON faculty.id = CASE WHEN area.parent_org_unit_id IS NULL THEN area.id ELSE area.parent_org_unit_id END
            LEFT JOIN org.org_units team ON team.id = CASE WHEN area.parent_org_unit_id IS NOT NULL THEN area.id ELSE NULL END
            LEFT JOIN auth.user_accounts creator_account ON creator_account.id = record_row.created_by_user_account_id
            LEFT JOIN people.staff creator ON creator.id = creator_account.staff_id
            ORDER BY record_row.record_date DESC, record_row.created_at DESC;
            """, command => AddExportParameters(command, user, filter, recordType), cancellationToken);
        var responses = await ReadExportSheetAsync(connection, "Form Responses", $"""
            {ScopedRecordsCte}
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), record_row.id) AS [Record ID], record_row.title AS [Record title],
                   section.title AS [Section], field.label AS [Question],
                   COALESCE(response.response_text, CONVERT(nvarchar(100), response.response_number),
                            CONVERT(nvarchar(30), response.response_date, 23), lookup_value.display_name,
                            response.response_json) AS [Response]
            FROM scoped_records record_row
            JOIN forms.form_submissions submission ON submission.record_id = record_row.id AND submission.archived_at IS NULL
            JOIN forms.form_responses response ON response.form_submission_id = submission.id AND response.archived_at IS NULL
            JOIN forms.form_fields field ON field.id = response.form_field_id
            JOIN forms.form_sections section ON section.id = field.form_section_id
            LEFT JOIN core.lookup_values lookup_value ON lookup_value.id = response.response_lookup_value_id
            ORDER BY record_row.created_at DESC, section.display_order, field.display_order;
            """, command => AddExportParameters(command, user, filter, recordType), cancellationToken);
        var actions = await ReadExportSheetAsync(connection, "Actions", $"""
            {ScopedRecordsCte}
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), action_row.id) AS [Action ID],
                   CONVERT(nvarchar(36), record_row.id) AS [Record ID], record_row.title AS [Source record],
                   action_row.title AS [Action], action_row.detail AS [Description],
                   owner.display_name AS [Owner], action_row.due_date AS [Due date],
                   COALESCE(status_value.display_name, status_value.value_key, N'Open') AS [Status],
                   action_row.completed_date AS [Completed date], action_row.completion_note AS [Closure comments]
            FROM scoped_records record_row
            JOIN quality.actions action_row ON action_row.source_record_id = record_row.id AND action_row.archived_at IS NULL
            LEFT JOIN people.staff owner ON owner.id = action_row.owner_staff_id
            LEFT JOIN core.lookup_values status_value ON status_value.id = action_row.status_lookup_value_id
            ORDER BY record_row.created_at DESC, action_row.due_date;
            """, command => AddExportParameters(command, user, filter, recordType), cancellationToken);
        return [main, responses, actions];
    }

    private async Task<IReadOnlyList<ExportSheet>> BuildStaffExportAsync(
        SqlConnection connection, ExportFilter filter, CurrentUser user, CancellationToken cancellationToken)
    {
        var staff = await ReadExportSheetAsync(connection, "Staff", """
            WITH visible_staff AS (SELECT staff_id FROM org.fn_visible_staff(@currentUserAccountId))
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), staff.id) AS [Staff ID], staff.external_id AS [Staff code],
                   staff.display_name AS [Name], staff.email AS [Email], staff.staff_category AS [Staff category],
                   manager.display_name AS [Primary line manager], faculty.code AS [Faculty code],
                   faculty.name AS [Faculty], team.code AS [Sub-team code], team.name AS [Sub-team],
                   staff.account_status AS [Account status], staff.start_date AS [Start date],
                   staff.end_date AS [End date], staff.created_at AS [Created at], staff.updated_at AS [Updated at]
            FROM people.staff staff
            JOIN visible_staff visible ON visible.staff_id = staff.id
            LEFT JOIN people.staff manager ON manager.id = staff.line_manager_staff_id
            LEFT JOIN org.org_units area ON area.id = staff.primary_org_unit_id
            LEFT JOIN org.org_units faculty ON faculty.id = CASE WHEN area.parent_org_unit_id IS NULL THEN area.id ELSE area.parent_org_unit_id END
            LEFT JOIN org.org_units team ON team.id = CASE WHEN area.parent_org_unit_id IS NOT NULL THEN area.id ELSE NULL END
            WHERE staff.archived_at IS NULL
              AND (@staffId IS NULL OR staff.id = @staffId)
              AND (@facultyCode IS NULL OR faculty.code = @facultyCode)
              AND (@teamCode IS NULL OR team.code = @teamCode)
              AND (@status IS NULL OR staff.account_status = @status)
            ORDER BY staff.display_name;
            """, command => AddExportParameters(command, user, filter), cancellationToken);
        var memberships = await ReadExportSheetAsync(connection, "Memberships", """
            WITH visible_staff AS (SELECT staff_id FROM org.fn_visible_staff(@currentUserAccountId))
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), membership.id) AS [Membership ID],
                   CONVERT(nvarchar(36), staff.id) AS [Staff ID], staff.display_name AS [Staff member],
                   unit.code AS [Organisation code], unit.name AS [Organisation], unit.org_unit_type AS [Level],
                   membership.membership_type AS [Membership type], membership.is_primary AS [Primary],
                   membership.active_from AS [Active from], membership.active_to AS [Active to],
                   membership.assignment_source AS [Assignment source], membership.change_reason AS [Change reason]
            FROM org.staff_org_memberships membership
            JOIN people.staff staff ON staff.id = membership.staff_id
            JOIN visible_staff visible ON visible.staff_id = staff.id
            JOIN org.org_units unit ON unit.id = membership.org_unit_id
            LEFT JOIN org.org_units parent ON parent.id = unit.parent_org_unit_id
            WHERE membership.archived_at IS NULL
              AND (@staffId IS NULL OR staff.id = @staffId)
              AND (@facultyCode IS NULL OR COALESCE(parent.code, unit.code) = @facultyCode)
              AND (@teamCode IS NULL OR unit.code = @teamCode)
            ORDER BY staff.display_name, membership.is_primary DESC, unit.name;
            """, command => AddExportParameters(command, user, filter), cancellationToken);
        return [staff, memberships];
    }

    private async Task<IReadOnlyList<ExportSheet>> BuildActionExportAsync(
        SqlConnection connection, ExportFilter filter, CurrentUser user, CancellationToken cancellationToken)
    {
        var actions = await ReadExportSheetAsync(connection, "Actions", """
            WITH visible_staff AS (SELECT staff_id FROM org.fn_visible_staff(@currentUserAccountId)),
                 visible_org AS (SELECT org_unit_id FROM org.fn_visible_org_units(@currentUserAccountId))
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), action_row.id) AS [Action ID], action_row.title AS [Action],
                   action_row.detail AS [Description], subject.display_name AS [Staff member],
                   owner.display_name AS [Owner], COALESCE(action_row.source_form_type, record_row.record_type, N'Standalone') AS [Source],
                   record_row.title AS [Source record], action_row.original_due_date AS [Original due date],
                   action_row.revised_due_date AS [Revised due date], action_row.due_date AS [Due date],
                   COALESCE(status_value.display_name, status_value.value_key, N'Open') AS [Status],
                   priority_value.display_name AS [Priority], action_row.completed_date AS [Completed date],
                   action_row.completion_note AS [Closure comments], action_row.cancellation_comments AS [Cancellation comments],
                   faculty.code AS [Faculty code], team.code AS [Sub-team code],
                   record_row.academic_year_key AS [Academic year], action_row.created_at AS [Created at],
                   action_row.updated_at AS [Updated at]
            FROM quality.actions action_row
            LEFT JOIN core.records record_row ON record_row.id = action_row.source_record_id
            LEFT JOIN people.staff subject ON subject.id = action_row.subject_staff_id
            LEFT JOIN people.staff owner ON owner.id = action_row.owner_staff_id
            LEFT JOIN core.lookup_values status_value ON status_value.id = action_row.status_lookup_value_id
            LEFT JOIN core.lookup_values priority_value ON priority_value.id = action_row.priority_lookup_value_id
            LEFT JOIN org.org_units area ON area.id = COALESCE(record_row.org_unit_id, subject.primary_org_unit_id, owner.primary_org_unit_id)
            LEFT JOIN org.org_units faculty ON faculty.id = CASE WHEN area.parent_org_unit_id IS NULL THEN area.id ELSE area.parent_org_unit_id END
            LEFT JOIN org.org_units team ON team.id = CASE WHEN area.parent_org_unit_id IS NOT NULL THEN area.id ELSE NULL END
            WHERE action_row.archived_at IS NULL
              AND (
                  @canViewAll = 1 OR action_row.owner_staff_id = @currentStaffId OR action_row.subject_staff_id = @currentStaffId
                  OR record_row.owner_staff_id = @currentStaffId
                  OR (@canViewScopedActivities = 1 AND (
                      EXISTS (SELECT 1 FROM visible_org WHERE org_unit_id = record_row.org_unit_id)
                      OR EXISTS (SELECT 1 FROM visible_staff WHERE staff_id IN (action_row.subject_staff_id, action_row.owner_staff_id))))
              )
              AND (
                  @canViewAll = 1 OR action_row.visibility_setting = N'staff_and_management'
                  OR (action_row.visibility_setting = N'owner_only' AND action_row.owner_staff_id = @currentStaffId)
                  OR (action_row.visibility_setting = N'source_editors' AND (action_row.created_by_user_account_id = @currentUserAccountId OR record_row.owner_staff_id = @currentStaffId))
                  OR (action_row.visibility_setting = N'management_only' AND @canViewScopedActivities = 1)
              )
              AND (@academicYear IS NULL OR record_row.academic_year_key = @academicYear)
              AND (@facultyCode IS NULL OR faculty.code = @facultyCode)
              AND (@teamCode IS NULL OR team.code = @teamCode)
              AND (@fromDate IS NULL OR action_row.due_date >= @fromDate)
              AND (@toDate IS NULL OR action_row.due_date <= @toDate)
              AND (@staffId IS NULL OR action_row.subject_staff_id = @staffId OR action_row.owner_staff_id = @staffId)
              AND (@status IS NULL OR status_value.value_key = @status)
              AND (@recordType IS NULL OR COALESCE(action_row.source_form_type, record_row.record_type) = @recordType)
            ORDER BY action_row.due_date, action_row.created_at DESC;
            """, command => AddExportParameters(command, user, filter), cancellationToken);
        var extensions = await ReadExportSheetAsync(connection, "Extensions", """
            WITH visible_staff AS (SELECT staff_id FROM org.fn_visible_staff(@currentUserAccountId))
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), extension.action_id) AS [Action ID], action_row.title AS [Action],
                   extension.previous_due_date AS [Previous due date], extension.extended_due_date AS [Revised due date],
                   extension.reason AS [Extension reason], extender.display_name AS [Extended by],
                   extension.created_at AS [Extended at]
            FROM quality.action_extensions extension
            JOIN quality.actions action_row ON action_row.id = extension.action_id
            LEFT JOIN auth.user_accounts extender_account ON extender_account.id = extension.created_by_user_account_id
            LEFT JOIN people.staff extender ON extender.id = extender_account.staff_id
            WHERE action_row.archived_at IS NULL
              AND (action_row.owner_staff_id = @currentStaffId OR action_row.subject_staff_id = @currentStaffId OR @canViewAll = 1
                   OR EXISTS (SELECT 1 FROM visible_staff WHERE staff_id IN (action_row.subject_staff_id, action_row.owner_staff_id)))
              AND (@staffId IS NULL OR action_row.subject_staff_id = @staffId OR action_row.owner_staff_id = @staffId)
            ORDER BY extension.created_at DESC;
            """, command => AddExportParameters(command, user, filter), cancellationToken);
        return [actions, extensions];
    }

    private async Task<IReadOnlyList<ExportSheet>> BuildCpdExportAsync(
        SqlConnection connection, ExportFilter filter, CurrentUser user, CancellationToken cancellationToken)
    {
        var events = await ReadExportSheetAsync(connection, "CPD Events", $"""
            {ScopedRecordsCte}
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), event_row.id) AS [CPD event ID], event_row.event_title AS [Event title],
                   event_row.event_date AS [Event date], event_row.start_time AS [Start time], event_row.end_time AS [End time],
                   event_row.duration_minutes AS [Duration minutes], theme.display_name AS [Theme],
                   event_row.delivery_method AS [Delivery method], facilitator.display_name AS [Facilitator],
                   event_row.location AS [Location], event_row.target_audience AS [Target audience],
                   event_row.capacity AS [Capacity], record_row.academic_year_key AS [Academic year],
                   record_row.created_at AS [Created at]
            FROM cpd.cpd_events event_row
            JOIN scoped_records record_row ON record_row.id = event_row.record_id
            LEFT JOIN core.lookup_values theme ON theme.id = event_row.theme_lookup_value_id
            LEFT JOIN people.staff facilitator ON facilitator.id = event_row.facilitator_staff_id
            ORDER BY event_row.event_date DESC, event_row.event_title;
            """, command => AddExportParameters(command, user, filter, "cpd_event"), cancellationToken);
        var attendance = await ReadExportSheetAsync(connection, "Attendance", $"""
            {ScopedRecordsCte}
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), event_row.id) AS [CPD event ID], event_row.event_title AS [Event title],
                   event_row.event_date AS [Event date], staff.display_name AS [Staff member], staff.email AS [Email],
                   attendance.attendance_status AS [Attendance status], attendance.milestone_credit AS [Credit],
                   event_row.duration_minutes AS [Duration minutes], faculty.code AS [Faculty code],
                   team.code AS [Sub-team code], record_row.academic_year_key AS [Academic year]
            FROM cpd.cpd_events event_row
            JOIN scoped_records record_row ON record_row.id = event_row.record_id
            JOIN cpd.cpd_attendance attendance ON attendance.cpd_event_id = event_row.id AND attendance.archived_at IS NULL
            JOIN people.staff staff ON staff.id = attendance.staff_id
            LEFT JOIN org.org_units area ON area.id = COALESCE(attendance.org_unit_id_at_time, staff.primary_org_unit_id)
            LEFT JOIN org.org_units faculty ON faculty.id = CASE WHEN area.parent_org_unit_id IS NULL THEN area.id ELSE area.parent_org_unit_id END
            LEFT JOIN org.org_units team ON team.id = CASE WHEN area.parent_org_unit_id IS NOT NULL THEN area.id ELSE NULL END
            WHERE (@staffId IS NULL OR staff.id = @staffId)
            ORDER BY event_row.event_date DESC, staff.display_name;
            """, command => AddExportParameters(command, user, filter, "cpd_event"), cancellationToken);
        return [events, attendance];
    }

    private async Task<IReadOnlyList<ExportSheet>> BuildCoachingExportAsync(
        SqlConnection connection, ExportFilter filter, CurrentUser user, CancellationToken cancellationToken)
    {
        var sessions = await ReadExportSheetAsync(connection, "Coaching Sessions", $"""
            {ScopedRecordsCte}
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), session_row.id) AS [Session ID],
                   CONVERT(nvarchar(36), cycle.id) AS [Cycle ID], staff.display_name AS [Staff member],
                   coach.display_name AS [Coach or mentor], cycle.cycle_number AS [Cycle number],
                   session_row.session_number AS [Session number], session_row.session_date AS [Session date],
                   session_row.session_type AS [Session type], session_row.delivery_method AS [Delivery method],
                   session_row.duration_minutes AS [Duration minutes], qualification.display_name AS [Qualified status],
                   primary_focus.display_name AS [Primary focus], secondary_focus.display_name AS [Secondary focus],
                   session_row.specific_session_focus AS [Specific focus],
                   session_row.current_practice_wording_snapshot AS [Current practice],
                   session_row.current_practice_evidence AS [Current practice evidence],
                   session_row.support_types_json AS [Support provided],
                   session_row.conversation_summary AS [Conversation summary], session_row.status AS [Status],
                   record_row.academic_year_key AS [Academic year], session_row.created_at AS [Created at],
                   session_row.updated_at AS [Updated at]
            FROM quality.coaching_sessions session_row
            JOIN scoped_records record_row ON record_row.id = session_row.record_id
            JOIN quality.coaching_cycles cycle ON cycle.id = session_row.cycle_id
            JOIN people.staff staff ON staff.id = session_row.staff_id
            LEFT JOIN people.staff coach ON coach.id = session_row.coach_staff_id
            LEFT JOIN core.lookup_values qualification ON qualification.id = session_row.development_stage_lookup_value_id
            LEFT JOIN core.lookup_values primary_focus ON primary_focus.id = session_row.primary_focus_lookup_value_id
            LEFT JOIN core.lookup_values secondary_focus ON secondary_focus.id = session_row.secondary_focus_lookup_value_id
            ORDER BY session_row.session_date DESC, session_row.session_number DESC;
            """, command => AddExportParameters(command, user, filter, "coaching_session"), cancellationToken);
        var actions = await ReadExportSheetAsync(connection, "Session Actions", $"""
            {ScopedRecordsCte}
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), session_row.id) AS [Session ID], session_row.session_number AS [Session number],
                   action_row.title AS [Action], owner.display_name AS [Owner], action_row.due_date AS [Due date],
                   action_row.review_date AS [Review date], action_row.intended_evidence AS [Intended evidence],
                   action_row.intended_impact AS [Intended impact], action_row.progress_status AS [Progress status],
                   COALESCE(status_value.display_name, status_value.value_key, N'Open') AS [Status]
            FROM quality.coaching_sessions session_row
            JOIN scoped_records record_row ON record_row.id = session_row.record_id
            JOIN quality.actions action_row ON action_row.source_record_id = record_row.id AND action_row.archived_at IS NULL
            LEFT JOIN people.staff owner ON owner.id = action_row.owner_staff_id
            LEFT JOIN core.lookup_values status_value ON status_value.id = action_row.status_lookup_value_id
            ORDER BY session_row.session_date DESC, action_row.due_date;
            """, command => AddExportParameters(command, user, filter, "coaching_session"), cancellationToken);
        var reviews = await ReadExportSheetAsync(connection, "Action Reviews", $"""
            {ScopedRecordsCte}
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), review.id) AS [Review ID],
                   CONVERT(nvarchar(36), review.session_id) AS [Reviewing session ID],
                   CONVERT(nvarchar(36), review.action_id) AS [Action ID], action_row.title AS [Action],
                   review.review_outcome AS [Review outcome], review.progress_update AS [Progress or evidence],
                   review.impact_observed AS [Impact observed],
                   CONVERT(nvarchar(36), review.revised_action_id) AS [Revised action ID], review.created_at AS [Reviewed at]
            FROM quality.coaching_action_reviews review
            JOIN quality.coaching_sessions session_row ON session_row.id = review.session_id
            JOIN scoped_records record_row ON record_row.id = session_row.record_id
            JOIN quality.actions action_row ON action_row.id = review.action_id
            ORDER BY review.created_at DESC;
            """, command => AddExportParameters(command, user, filter, "coaching_session"), cancellationToken);
        return [sessions, actions, reviews];
    }

    private async Task<IReadOnlyList<ExportSheet>> BuildReflectionExportAsync(
        SqlConnection connection, ExportFilter filter, CurrentUser user, CancellationToken cancellationToken)
    {
        var reflections = await ReadExportSheetAsync(connection, "Reflections", """
            WITH visible_staff AS (SELECT staff_id FROM org.fn_visible_staff(@currentUserAccountId))
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), reflection.id) AS [Reflection ID], staff.display_name AS [Staff member],
                   reflection.reflection_date AS [Reflection date], reflection.progress AS [Progress],
                   reflection.impact AS [Impact], reflection.examples AS [Examples], reflection.status AS [Status],
                   assessment.academic_year AS [Academic year], reflection.created_at AS [Created at],
                   reflection.updated_at AS [Updated at]
            FROM quality.staff_reflections reflection
            JOIN people.staff staff ON staff.id = reflection.staff_id
            JOIN visible_staff visible ON visible.staff_id = staff.id
            LEFT JOIN quality.elevate_practice_assessments assessment ON assessment.id = reflection.elevate_practice_assessment_id
            LEFT JOIN org.org_units area ON area.id = staff.primary_org_unit_id
            LEFT JOIN org.org_units faculty ON faculty.id = CASE WHEN area.parent_org_unit_id IS NULL THEN area.id ELSE area.parent_org_unit_id END
            LEFT JOIN org.org_units team ON team.id = CASE WHEN area.parent_org_unit_id IS NOT NULL THEN area.id ELSE NULL END
            WHERE reflection.archived_at IS NULL
              AND (@academicYear IS NULL OR assessment.academic_year = @academicYear)
              AND (@facultyCode IS NULL OR faculty.code = @facultyCode)
              AND (@teamCode IS NULL OR team.code = @teamCode)
              AND (@fromDate IS NULL OR reflection.reflection_date >= @fromDate)
              AND (@toDate IS NULL OR reflection.reflection_date <= @toDate)
              AND (@staffId IS NULL OR staff.id = @staffId)
              AND (@status IS NULL OR reflection.status = @status)
            ORDER BY reflection.reflection_date DESC, staff.display_name;
            """, command => AddExportParameters(command, user, filter), cancellationToken);
        var focus = await ReadExportSheetAsync(connection, "Linked Focus Areas", """
            WITH visible_staff AS (SELECT staff_id FROM org.fn_visible_staff(@currentUserAccountId))
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), focus.reflection_id) AS [Reflection ID], staff.display_name AS [Staff member],
                   reflection.reflection_date AS [Reflection date], focus.focus_type AS [Focus type],
                   focus.focus_key_snapshot AS [Focus key], focus.focus_text_snapshot AS [Historical wording]
            FROM quality.staff_reflection_focus_areas focus
            JOIN quality.staff_reflections reflection ON reflection.id = focus.reflection_id AND reflection.archived_at IS NULL
            JOIN people.staff staff ON staff.id = reflection.staff_id
            JOIN visible_staff visible ON visible.staff_id = staff.id
            LEFT JOIN quality.elevate_practice_assessments assessment ON assessment.id = reflection.elevate_practice_assessment_id
            WHERE (@academicYear IS NULL OR assessment.academic_year = @academicYear)
              AND (@staffId IS NULL OR staff.id = @staffId)
            ORDER BY reflection.reflection_date DESC, focus.display_order;
            """, command => AddExportParameters(command, user, filter), cancellationToken);
        return [reflections, focus];
    }

    private async Task<IReadOnlyList<ExportSheet>> BuildLivExportAsync(
        SqlConnection connection, ExportFilter filter, CurrentUser user, CancellationToken cancellationToken)
    {
        var cases = await ReadExportSheetAsync(connection, "LIV Cases", $"""
            {ScopedRecordsCte}
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), liv.id) AS [LIV case ID], staff.display_name AS [Staff member],
                   reviewer.display_name AS [Reviewer], liv.status AS [Status], liv.current_stage AS [Current stage],
                   liv.eli_primary_focus_snapshot AS [Primary focus], liv.eli_desired_outcome AS [Desired outcome],
                   liv.is_elevate_practitioner AS [Elevate practitioner], liv.area_of_practice_keys_json AS [Areas of practice],
                   faculty.code AS [Faculty code], team.code AS [Sub-team code],
                   record_row.academic_year_key AS [Academic year], liv.created_at AS [Created at],
                   liv.completion_date AS [Completion date]
            FROM quality.liv_records liv
            JOIN scoped_records record_row ON record_row.id = liv.record_id
            JOIN people.staff staff ON staff.id = liv.subject_staff_id
            LEFT JOIN people.staff reviewer ON reviewer.id = liv.reviewer_staff_id
            LEFT JOIN org.org_units area ON area.id = liv.org_unit_id
            LEFT JOIN org.org_units faculty ON faculty.id = CASE WHEN area.parent_org_unit_id IS NULL THEN area.id ELSE area.parent_org_unit_id END
            LEFT JOIN org.org_units team ON team.id = CASE WHEN area.parent_org_unit_id IS NOT NULL THEN area.id ELSE NULL END
            ORDER BY liv.created_at DESC;
            """, command => AddExportParameters(command, user, filter, "liv"), cancellationToken);
        var visits = await ReadExportSheetAsync(connection, "Visits", $"""
            {ScopedRecordsCte}
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), liv.id) AS [LIV case ID], CONVERT(nvarchar(36), visit.id) AS [Visit ID],
                   visit.visit_number AS [Visit number], visit.visit_date AS [Visit date], visit.visit_time AS [Visit time],
                   visit.visit_type AS [Visit type], visit.course_name AS [Course], visit.course_group AS [Group],
                   visit.course_level AS [Level], delivery.display_name AS [Delivery area],
                   visit.reflection_notes AS [Reflection and discussion], visit.findings AS [Findings],
                   visit.visit_status AS [Visit status], visit.created_at AS [Created at]
            FROM quality.liv_records liv
            JOIN scoped_records record_row ON record_row.id = liv.record_id
            JOIN quality.liv_visits visit ON visit.liv_record_id = liv.id AND visit.archived_at IS NULL
            LEFT JOIN core.lookup_values delivery ON delivery.id = visit.delivery_area_lookup_value_id
            ORDER BY liv.created_at DESC, visit.visit_number;
            """, command => AddExportParameters(command, user, filter, "liv"), cancellationToken);
        var stages = await ReadExportSheetAsync(connection, "Stages", $"""
            {ScopedRecordsCte}
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), liv.id) AS [LIV case ID], cycle.cycle_number AS [Cycle],
                   stage.stage_order AS [Stage order], stage.stage_type AS [Stage], stage.stage_status AS [Status],
                   stage.context_text AS [Context], stage.aims_text AS [Aims],
                   stage.learner_activity_text AS [Learner activity], stage.reflection_text AS [Reflection],
                   stage.intended_follow_up_date AS [Follow-up date], stage.distance_impact_text AS [Impact],
                   stage.created_at AS [Created at]
            FROM quality.liv_records liv
            JOIN scoped_records record_row ON record_row.id = liv.record_id
            JOIN quality.liv_cycles cycle ON cycle.liv_record_id = liv.id
            JOIN quality.liv_stages stage ON stage.liv_cycle_id = cycle.id AND stage.archived_at IS NULL
            ORDER BY liv.created_at DESC, cycle.cycle_number, stage.stage_order;
            """, command => AddExportParameters(command, user, filter, "liv"), cancellationToken);
        var actions = await ReadExportSheetAsync(connection, "Actions", $"""
            {ScopedRecordsCte}
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), liv.id) AS [LIV case ID], action_row.source_sub_record_key AS [Visit or stage],
                   action_row.title AS [Action], owner.display_name AS [Owner], action_row.due_date AS [Due date],
                   COALESCE(status_value.display_name, status_value.value_key, N'Open') AS [Status],
                   action_row.completion_note AS [Closure comments]
            FROM quality.liv_records liv
            JOIN scoped_records record_row ON record_row.id = liv.record_id
            JOIN quality.actions action_row ON action_row.source_record_id = record_row.id AND action_row.archived_at IS NULL
            LEFT JOIN people.staff owner ON owner.id = action_row.owner_staff_id
            LEFT JOIN core.lookup_values status_value ON status_value.id = action_row.status_lookup_value_id
            ORDER BY liv.created_at DESC, action_row.due_date;
            """, command => AddExportParameters(command, user, filter, "liv"), cancellationToken);
        return [cases, visits, stages, actions];
    }

    private async Task<IReadOnlyList<ExportSheet>> BuildElevatePracticeExportAsync(
        SqlConnection connection, ExportFilter filter, CurrentUser user, CancellationToken cancellationToken)
    {
        var assessments = await ReadExportSheetAsync(connection, "Assessments", $"""
            {ScopedRecordsCte}
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), assessment.id) AS [Assessment ID], staff.display_name AS [Staff member],
                   assessment.academic_year AS [Academic year], assessment.status AS [Status],
                   assessment.submitted_at AS [Submitted at], assessment.created_at AS [Created at],
                   assessment.updated_at AS [Updated at]
            FROM quality.elevate_practice_assessments assessment
            JOIN scoped_records record_row ON record_row.id = assessment.record_id
            JOIN people.staff staff ON staff.id = assessment.staff_id
            ORDER BY assessment.academic_year DESC, staff.display_name;
            """, command => AddExportParameters(command, user, filter, "elevate_practice_assessment"), cancellationToken);
        var ratings = await ReadExportSheetAsync(connection, "Area Outcomes", $"""
            {ScopedRecordsCte}
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), assessment.id) AS [Assessment ID], staff.display_name AS [Staff member],
                   area.category AS [Category], area.name AS [Area], descriptor.visible_wording AS [Wording outcome],
                   assessment.academic_year AS [Academic year]
            FROM quality.elevate_practice_assessments assessment
            JOIN scoped_records record_row ON record_row.id = assessment.record_id
            JOIN people.staff staff ON staff.id = assessment.staff_id
            JOIN quality.elevate_practice_area_ratings rating ON rating.assessment_id = assessment.id
            JOIN quality.elevate_practice_areas area ON area.id = rating.area_id
            JOIN quality.elevate_practice_rubric_descriptors descriptor ON descriptor.id = rating.descriptor_id
            ORDER BY assessment.academic_year DESC, staff.display_name, area.display_order;
            """, command => AddExportParameters(command, user, filter, "elevate_practice_assessment"), cancellationToken);
        var development = await ReadExportSheetAsync(connection, "Development Areas", $"""
            {ScopedRecordsCte}
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), assessment.id) AS [Assessment ID], staff.display_name AS [Staff member],
                   area.name AS [Development area], development_plan.development_approach AS [Development approach],
                   development_plan.support_keys_json AS [Support], development_plan.support_details AS [Support details],
                   development_plan.success_evidence AS [Evidence of success], development_plan.intended_impact AS [Intended impact],
                   assessment.academic_year AS [Academic year]
            FROM quality.elevate_practice_assessments assessment
            JOIN scoped_records record_row ON record_row.id = assessment.record_id
            JOIN people.staff staff ON staff.id = assessment.staff_id
            JOIN quality.elevate_practice_development_plans development_plan ON development_plan.assessment_id = assessment.id
            JOIN quality.elevate_practice_areas area ON area.id = development_plan.area_id
            ORDER BY assessment.academic_year DESC, staff.display_name, area.display_order;
            """, command => AddExportParameters(command, user, filter, "elevate_practice_assessment"), cancellationToken);
        return [assessments, ratings, development];
    }

    private async Task<ExportSheet> ReadExportSheetAsync(
        SqlConnection connection,
        string name,
        string sql,
        Action<SqlCommand> configure,
        CancellationToken cancellationToken)
    {
        var startedAt = Stopwatch.GetTimestamp();
        await using var command = new SqlCommand(sql, connection) { CommandTimeout = 90 };
        command.Parameters.AddWithValue("@exportTake", InteractiveExportRowLimit + 1);
        configure(command);
        await using var reader = await command.ExecuteReaderAsync(System.Data.CommandBehavior.SequentialAccess, cancellationToken);
        var columns = Enumerable.Range(0, reader.FieldCount).Select(reader.GetName).ToArray();
        var rows = new List<IReadOnlyList<string?>>();
        while (rows.Count <= InteractiveExportRowLimit && await reader.ReadAsync(cancellationToken))
        {
            var row = new string?[reader.FieldCount];
            for (var index = 0; index < reader.FieldCount; index++)
                row[index] = reader.IsDBNull(index) ? null : FormatExportValue(reader.GetValue(index));
            rows.Add(row);
        }
        var truncated = rows.Count > InteractiveExportRowLimit;
        if (truncated) rows.RemoveAt(rows.Count - 1);
        var elapsed = Stopwatch.GetElapsedTime(startedAt);
        if (elapsed > TimeSpan.FromSeconds(2))
            logger.LogWarning("Export sheet {SheetName} loaded {RowCount} rows in {ElapsedMilliseconds:F0} ms.", name, rows.Count, elapsed.TotalMilliseconds);
        return new ExportSheet(SafeWorksheetName(name), columns, rows, truncated);
    }

    private static string FormatExportValue(object value) => value switch
    {
        DateTime dateTime => dateTime.ToString("dd MMM yyyy HH:mm", CultureInfo.InvariantCulture),
        DateTimeOffset dateTimeOffset => dateTimeOffset.ToString("dd MMM yyyy HH:mm", CultureInfo.InvariantCulture),
        DateOnly dateOnly => dateOnly.ToString("dd MMM yyyy", CultureInfo.InvariantCulture),
        TimeSpan time => time.ToString(@"hh\:mm", CultureInfo.InvariantCulture),
        bool boolean => boolean ? "Yes" : "No",
        IFormattable formattable => formattable.ToString(null, CultureInfo.InvariantCulture) ?? "",
        _ => Convert.ToString(value, CultureInfo.InvariantCulture) ?? ""
    };

    private static string SafeWorksheetName(string value)
    {
        var invalid = new[] { ':', '\\', '/', '?', '*', '[', ']' };
        var sanitized = string.Concat(value.Select(character => invalid.Contains(character) ? '-' : character));
        return sanitized[..Math.Min(31, sanitized.Length)];
    }

    private static string NormalizeExportModuleKey(string value) => value.Trim().ToLowerInvariant() switch
    {
        "learning_walk" => "learning-walks",
        "work_scrutiny" => "work-scrutiny",
        "elevate_environment" => "elevate-environments",
        "elevate_practice" => "elevate-practice",
        "coaching_mentoring" => "coaching",
        "probation_observation" => "probation",
        var key => key
    };

    private static string ExportDisplayName(string key) => key switch
    {
        "learning-walks" => "Learning Walks",
        "work-scrutiny" => "Work Scrutiny",
        "elevate-environments" => "Learning Environments",
        "elevate-practice" => "Elevate Learning and Innovation",
        "coaching" => "Coaching and Mentoring",
        "reflections" => "Staff Reflections",
        "actions" => "Actions",
        "cpd" => "CPD",
        "liv" => "Learning and Innovation Visits",
        "staff" => "Staff",
        "probation" => "Probationary Observations",
        _ => key
    };

    private static void AddExportParameters(
        SqlCommand command,
        CurrentUser user,
        ExportFilter filter,
        string? recordType = null)
    {
        AddScopeParameters(command, user);
        command.Parameters.AddWithValue("@academicYear", ToDbValue(filter.AcademicYear));
        command.Parameters.AddWithValue("@facultyCode", ToDbValue(filter.FacultyCode));
        command.Parameters.AddWithValue("@teamCode", ToDbValue(filter.TeamCode));
        command.Parameters.AddWithValue("@fromDate", ToDbValue(filter.FromDate));
        command.Parameters.AddWithValue("@toDate", ToDbValue(filter.ToDate));
        command.Parameters.AddWithValue("@staffId", ToDbValue(filter.StaffId));
        command.Parameters.AddWithValue("@reviewerId", ToDbValue(filter.ReviewerId));
        command.Parameters.AddWithValue("@status", ToDbValue(filter.Status));
        command.Parameters.AddWithValue("@recordType", ToDbValue(recordType ?? filter.RecordType));
    }

    private static async Task<IReadOnlyList<T>> QueryOnConnectionAsync<T>(
        SqlConnection connection,
        string sql,
        Action<SqlCommand> configure,
        Func<SqlDataReader, T> map,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(sql, connection);
        configure(command);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var rows = new List<T>();
        while (await reader.ReadAsync(cancellationToken)) rows.Add(map(reader));
        return rows;
    }

    private const string ScopedRecordsCte = """
        WITH visible_staff AS (SELECT staff_id FROM org.fn_visible_staff(@currentUserAccountId)),
             visible_org AS (SELECT org_unit_id FROM org.fn_visible_org_units(@currentUserAccountId)),
             scoped_records AS (
                 SELECT record_source.*
                 FROM core.records record_source
                 LEFT JOIN core.lookup_values record_status ON record_status.id = record_source.status_lookup_value_id
                 LEFT JOIN org.org_units record_area ON record_area.id = record_source.org_unit_id
                 LEFT JOIN org.org_units record_faculty ON record_faculty.id = CASE WHEN record_area.parent_org_unit_id IS NULL THEN record_area.id ELSE record_area.parent_org_unit_id END
                 LEFT JOIN org.org_units record_team ON record_team.id = CASE WHEN record_area.parent_org_unit_id IS NOT NULL THEN record_area.id ELSE NULL END
                 WHERE record_source.archived_at IS NULL
                   AND (@recordType IS NULL OR record_source.record_type = @recordType)
                   AND (
                       @canViewAll = 1 OR record_source.created_by_user_account_id = @currentUserAccountId
                       OR EXISTS (SELECT 1 FROM visible_staff WHERE staff_id IN (record_source.subject_staff_id, record_source.owner_staff_id))
                       OR EXISTS (SELECT 1 FROM visible_org WHERE org_unit_id = record_source.org_unit_id)
                   )
                   AND (@academicYear IS NULL OR record_source.academic_year_key = @academicYear)
                   AND (@facultyCode IS NULL OR record_faculty.code = @facultyCode)
                   AND (@teamCode IS NULL OR record_team.code = @teamCode)
                   AND (@fromDate IS NULL OR record_source.record_date >= @fromDate)
                   AND (@toDate IS NULL OR record_source.record_date <= @toDate)
                   AND (@staffId IS NULL OR record_source.subject_staff_id = @staffId)
                   AND (@reviewerId IS NULL OR record_source.owner_staff_id = @reviewerId)
                   AND (@status IS NULL OR record_status.value_key = @status)
             )
        """;

    private sealed record RecordReportHeader(
        Guid Id,
        string Title,
        string RecordType,
        string Status,
        string? StaffName,
        string? ReviewerName,
        string? Organisation,
        DateOnly? RecordDate,
        DateTimeOffset CreatedAt,
        string CreatedBy);

    private sealed record RecordReportResponse(string Section, string Label, string? Value);
}
