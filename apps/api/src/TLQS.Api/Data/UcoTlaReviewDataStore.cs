using System.Data;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    private static readonly string[] UcoRequiredObserverFields =
    [
        "academic_research_skills", "personal_professional_development", "employability",
        "structure_pace_organisation", "level_appropriate_inclusive", "delivery_methods_styles_resources",
        "student_feedback_engagement", "module_handbook", "itslearning_resources", "session_materials",
        "assessment_information", "feedback_to_students", "good_practice"
    ];

    private static readonly HashSet<string> UcoSectionKeys = new(StringComparer.OrdinalIgnoreCase)
    {
        "session_details", "teaching_learning_activities", "delivery_facilitation",
        "learning_materials", "findings", "action_plan", "discussion_follow_up"
    };

    public async Task<UcoTlaAccessSummary> GetUcoTlaAccessSummaryAsync(
        CurrentUser user,
        CancellationToken cancellationToken)
    {
        var canManage = UcoTlaReviewAccessPolicy.CanManageAll(user);
        var canViewAll = UcoTlaReviewAccessPolicy.CanViewAll(user);
        var hasRecordAccess = user.StaffId.HasValue && (await QueryAsync(
            """
            SELECT TOP (1) review.record_id
            FROM quality.uco_tla_reviews review
            JOIN people.staff lecturer ON lecturer.id = review.lecturer_staff_id
            WHERE review.archived_at IS NULL
              AND (review.lecturer_staff_id = @staffId
                   OR review.observer_staff_id = @staffId
                   OR lecturer.line_manager_staff_id = @staffId);
            """,
            command => command.Parameters.AddWithValue("@staffId", user.StaffId.Value),
            reader => reader.GetGuid(0),
            cancellationToken)).Count > 0;

        // Assigned participants need the scoped UCO directory when completing action-plan owners.
        // It remains unavailable to users who have neither the coordinator role nor record access.
        var staff = canManage || hasRecordAccess ? await GetUcoTlaStaffOptionsAsync(cancellationToken) : [];
        return new UcoTlaAccessSummary(
            canViewAll || hasRecordAccess,
            canManage,
            canManage,
            canManage,
            staff);
    }

    private async Task<IReadOnlyList<ExportSheet>> BuildUcoTlaExportAsync(
        SqlConnection connection,
        ExportFilter filter,
        CurrentUser user,
        CancellationToken cancellationToken)
    {
        if (!UcoTlaReviewAccessPolicy.CanManageAll(user))
            throw new UnauthorizedAccessException("UCO Teaching & Learning coordinator access is required.");

        var reviews = await ReadExportSheetAsync(connection, "UCO TLA Reviews", """
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), review.record_id) AS [Record ID],
                   record.academic_year_key AS [Academic year], review.workflow_status AS [Workflow status],
                   lecturer.display_name AS [Lecturer], observer.display_name AS [Observer],
                   review.observation_at AS [Observation date and time], review.session_type AS [Session type],
                   review.course_title AS [Course title], review.module_title AS [Module title], review.course_level AS [Level],
                   review.number_registered AS [Number registered], review.number_present AS [Number present],
                   review.number_late AS [Number late], review.professional_discussion_at AS [Professional discussion],
                   review.lecturer_acknowledged_at AS [Lecturer acknowledged], review.observer_signed_at AS [Observer signed],
                   follow_up.follow_up_type AS [Follow-up type], follow_up.scheduled_at AS [Follow-up date],
                   follow_up.status AS [Follow-up status], follow_up.outcome_notes AS [Follow-up outcome]
            FROM quality.uco_tla_reviews review
            JOIN core.records record ON record.id = review.record_id
            JOIN people.staff lecturer ON lecturer.id = review.lecturer_staff_id
            JOIN people.staff observer ON observer.id = review.observer_staff_id
            LEFT JOIN quality.uco_tla_follow_ups follow_up ON follow_up.review_record_id = review.record_id
            WHERE review.archived_at IS NULL AND record.archived_at IS NULL
              AND (@academicYear IS NULL OR record.academic_year_key = @academicYear)
              AND (@fromDate IS NULL OR CONVERT(date, review.observation_at) >= @fromDate)
              AND (@toDate IS NULL OR CONVERT(date, review.observation_at) <= @toDate)
              AND (@staffId IS NULL OR review.lecturer_staff_id = @staffId)
              AND (@reviewerId IS NULL OR review.observer_staff_id = @reviewerId)
              AND (@status IS NULL OR review.workflow_status = @status)
            ORDER BY review.observation_at DESC
            """, command => AddUcoExportParameters(command, filter), cancellationToken);

        var responses = await ReadExportSheetAsync(connection, "Narrative Evidence", """
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), review.record_id) AS [Record ID], lecturer.display_name AS [Lecturer],
                   section.title AS [Section], field.label AS [Criterion], response.response_text AS [Narrative evidence]
            FROM quality.uco_tla_reviews review
            JOIN core.records record ON record.id = review.record_id
            JOIN people.staff lecturer ON lecturer.id = review.lecturer_staff_id
            JOIN forms.form_submissions submission ON submission.id = review.form_submission_id
            JOIN forms.form_responses response ON response.form_submission_id = submission.id AND response.archived_at IS NULL
            JOIN forms.form_fields field ON field.id = response.form_field_id
            JOIN forms.form_sections section ON section.id = field.form_section_id
            WHERE review.archived_at IS NULL AND record.archived_at IS NULL
              AND (@academicYear IS NULL OR record.academic_year_key = @academicYear)
              AND (@fromDate IS NULL OR CONVERT(date, review.observation_at) >= @fromDate)
              AND (@toDate IS NULL OR CONVERT(date, review.observation_at) <= @toDate)
              AND (@staffId IS NULL OR review.lecturer_staff_id = @staffId)
              AND (@reviewerId IS NULL OR review.observer_staff_id = @reviewerId)
              AND (@status IS NULL OR review.workflow_status = @status)
            ORDER BY review.observation_at DESC, section.display_order, field.display_order
            """, command => AddUcoExportParameters(command, filter), cancellationToken);

        var actions = await ReadExportSheetAsync(connection, "Development Actions", """
            SELECT TOP (@exportTake)
                   CONVERT(nvarchar(36), action_plan.review_record_id) AS [Record ID], lecturer.display_name AS [Lecturer],
                   action_plan.display_order AS [Action number], action_plan.action_type AS [Type], action_plan.target AS [Target],
                   action_plan.achievement_method AS [How achieved and checked], owner.display_name AS [Owner],
                   action_plan.due_date AS [Due date], CONVERT(nvarchar(36), action_plan.central_action_id) AS [Central action ID]
            FROM quality.uco_tla_action_plans action_plan
            JOIN quality.uco_tla_reviews review ON review.record_id = action_plan.review_record_id
            JOIN core.records record ON record.id = review.record_id
            JOIN people.staff lecturer ON lecturer.id = review.lecturer_staff_id
            JOIN people.staff owner ON owner.id = action_plan.owner_staff_id
            WHERE review.archived_at IS NULL AND record.archived_at IS NULL
              AND (@academicYear IS NULL OR record.academic_year_key = @academicYear)
              AND (@fromDate IS NULL OR CONVERT(date, review.observation_at) >= @fromDate)
              AND (@toDate IS NULL OR CONVERT(date, review.observation_at) <= @toDate)
              AND (@staffId IS NULL OR review.lecturer_staff_id = @staffId)
              AND (@reviewerId IS NULL OR review.observer_staff_id = @reviewerId)
              AND (@status IS NULL OR review.workflow_status = @status)
            ORDER BY review.observation_at DESC, action_plan.display_order
            """, command => AddUcoExportParameters(command, filter), cancellationToken);

        return [reviews, responses, actions];
    }

    private static void AddUcoExportParameters(SqlCommand command, ExportFilter filter)
    {
        AddNullableText(command, "@academicYear", filter.AcademicYear, 10);
        AddNullableDate(command, "@fromDate", filter.FromDate);
        AddNullableDate(command, "@toDate", filter.ToDate);
        AddNullableGuid(command, "@staffId", filter.StaffId);
        AddNullableGuid(command, "@reviewerId", filter.ReviewerId);
        AddNullableText(command, "@status", filter.Status, 100);
    }

    private static Task<IReadOnlyList<RecordReportResponse>> GetUcoTlaReportResponsesAsync(
        SqlConnection connection,
        Guid recordId,
        CancellationToken cancellationToken) =>
        QueryOnConnectionAsync(
            connection,
            """
            SELECT N'Course Details and Authenticated Sign-off', values_row.field_label, values_row.field_value
            FROM quality.uco_tla_reviews review
            JOIN people.staff lecturer ON lecturer.id = review.lecturer_staff_id
            JOIN people.staff observer ON observer.id = review.observer_staff_id
            LEFT JOIN auth.user_accounts lecturer_account ON lecturer_account.id = review.lecturer_acknowledged_by_user_account_id
            LEFT JOIN people.staff lecturer_signatory ON lecturer_signatory.id = lecturer_account.staff_id
            LEFT JOIN auth.user_accounts observer_account ON observer_account.id = review.observer_signed_by_user_account_id
            LEFT JOIN people.staff observer_signatory ON observer_signatory.id = observer_account.staff_id
            LEFT JOIN quality.uco_tla_follow_ups follow_up ON follow_up.review_record_id = review.record_id
            CROSS APPLY (VALUES
                (N'Lecturer name', CONVERT(nvarchar(max), lecturer.display_name), 1),
                (N'Observer name', CONVERT(nvarchar(max), observer.display_name), 2),
                (N'Professional discussion', CONVERT(nvarchar(max), review.professional_discussion_at, 127), 3),
                (N'Lecturer acknowledgement', CONCAT(lecturer_signatory.display_name, N' / ', CONVERT(nvarchar(40), review.lecturer_acknowledged_at, 127)), 4),
                (N'Observer final sign-off', CONCAT(observer_signatory.display_name, N' / ', CONVERT(nvarchar(40), review.observer_signed_at, 127)), 5),
                (N'Further professional discussion or observation required?', CASE WHEN follow_up.review_record_id IS NULL THEN N'No' ELSE N'Yes' END, 6),
                (N'Follow-up type', CONVERT(nvarchar(max), follow_up.follow_up_type), 7),
                (N'Follow-up date and time', CONVERT(nvarchar(max), follow_up.scheduled_at, 127), 8),
                (N'Follow-up outcome', CONVERT(nvarchar(max), follow_up.outcome_notes), 9)
            ) values_row(field_label, field_value, display_order)
            WHERE review.record_id = @recordId AND values_row.field_value IS NOT NULL
            ORDER BY values_row.display_order;
            """,
            command => command.Parameters.AddWithValue("@recordId", recordId),
            reader => new RecordReportResponse(reader.GetString(0), reader.GetString(1), GetStringOrNull(reader, 2)),
            cancellationToken);

    private Task<IReadOnlyList<UcoTlaStaffOption>> GetUcoTlaStaffOptionsAsync(CancellationToken cancellationToken) =>
        QueryAsync(
            """
            WITH uco_units AS (
                SELECT id FROM org.org_units WHERE code = N'UCO' AND archived_at IS NULL
                UNION ALL
                SELECT child.id FROM org.org_units child JOIN uco_units parent ON parent.id = child.parent_org_unit_id
                WHERE child.archived_at IS NULL
            )
            SELECT staff.id, staff.display_name, staff.email, staff.job_title,
                   CAST(1 AS bit),
                   CAST(CASE WHEN EXISTS (
                       SELECT 1
                       FROM auth.user_accounts account
                       JOIN auth.user_roles user_role ON user_role.user_account_id = account.id
                         AND user_role.active_from <= sysutcdatetime()
                         AND (user_role.active_to IS NULL OR user_role.active_to > sysutcdatetime())
                       JOIN auth.roles role ON role.id = user_role.role_id
                         AND role.role_key = N'uco_teaching_learning' AND role.is_active = 1 AND role.archived_at IS NULL
                       WHERE account.staff_id = staff.id AND account.account_status = N'active'
                         AND account.is_disabled = 0 AND account.archived_at IS NULL
                   ) THEN 1 ELSE 0 END AS bit)
            FROM people.staff staff
            WHERE staff.archived_at IS NULL AND staff.account_status = N'active'
              AND (
                  staff.primary_org_unit_id IN (SELECT id FROM uco_units)
                  OR EXISTS (
                      SELECT 1 FROM org.staff_org_memberships membership
                      WHERE membership.staff_id = staff.id AND membership.org_unit_id IN (SELECT id FROM uco_units)
                        AND membership.archived_at IS NULL
                        AND (membership.active_from IS NULL OR membership.active_from <= CONVERT(date, sysutcdatetime()))
                        AND (membership.active_to IS NULL OR membership.active_to >= CONVERT(date, sysutcdatetime()))
                  )
              )
            ORDER BY staff.display_name
            OPTION (MAXRECURSION 20);
            """,
            reader => new UcoTlaStaffOption(
                reader.GetGuid(0), reader.GetString(1), reader.GetString(2), GetStringOrNull(reader, 3),
                reader.GetBoolean(4), reader.GetBoolean(5)),
            cancellationToken);

    public async Task<IReadOnlyList<UcoTlaReviewSummary>> GetUcoTlaReviewsAsync(
        CurrentUser user,
        CancellationToken cancellationToken)
    {
        if (!user.UserAccountId.HasValue) return [];
        var rows = await QueryAsync(
            UcoTlaReviewSelectSql + " ORDER BY review.observation_at DESC, record.created_at DESC;",
            command => AddUcoTlaAccessParameters(command, user),
            MapUcoTlaRow,
            cancellationToken);
        return rows.Select(row => ToUcoTlaSummary(row, user)).ToArray();
    }

    public async Task<UcoTlaDashboardSummary> GetUcoTlaDashboardAsync(
        CurrentUser user,
        string? academicYear,
        CancellationToken cancellationToken)
    {
        var reviews = await GetUcoTlaReviewsAsync(user, cancellationToken);
        var selectedYear = string.IsNullOrWhiteSpace(academicYear) ? GetCurrentAcademicYear() : academicYear.Trim();
        var currentReviews = reviews.Where(review => review.AcademicYear == selectedYear).ToArray();
        var activeUcoStaff = UcoTlaReviewAccessPolicy.CanManageAll(user)
            ? (await GetUcoTlaStaffOptionsAsync(cancellationToken)).Count
            : 0;
        var coveredUcoStaff = UcoTlaReviewAccessPolicy.CanManageAll(user)
            ? currentReviews.Where(review => review.WorkflowStatus == UcoTlaReviewWorkflow.Completed)
                .Select(review => review.LecturerStaffId).Distinct().Count()
            : 0;
        return new UcoTlaDashboardSummary(
            currentReviews.Length,
            currentReviews.Count(review => review.WorkflowStatus == UcoTlaReviewWorkflow.Completed),
            activeUcoStaff,
            coveredUcoStaff,
            activeUcoStaff == 0 ? 0 : (int)Math.Round(coveredUcoStaff * 100m / activeUcoStaff),
            currentReviews.Count(review => review.WorkflowStatus == UcoTlaReviewWorkflow.AwaitingLecturer),
            currentReviews.Count(review => review.FollowUpStatus == "scheduled" && review.FollowUpAt <= DateTimeOffset.UtcNow.AddDays(14)),
            currentReviews.Sum(review => review.OpenActionCount),
            currentReviews.Sum(review => review.OverdueActionCount),
            await GetUcoTlaPracticeHighlightsAsync(user, selectedYear, cancellationToken),
            currentReviews);
    }

    private Task<IReadOnlyList<UcoTlaPracticeHighlight>> GetUcoTlaPracticeHighlightsAsync(
        CurrentUser user,
        string academicYear,
        CancellationToken cancellationToken) =>
        QueryAsync(
            """
            SELECT TOP (6) review.record_id, lecturer.display_name, review.course_title, review.module_title,
                   review.observation_at,
                   CASE field.field_key WHEN N'excellent_practice' THEN N'Excellent practice to share' ELSE N'Good practice' END,
                   response.response_text
            FROM quality.uco_tla_reviews review
            JOIN core.records record ON record.id = review.record_id
            JOIN people.staff lecturer ON lecturer.id = review.lecturer_staff_id
            JOIN forms.form_responses response ON response.form_submission_id = review.form_submission_id
            JOIN forms.form_fields field ON field.id = response.form_field_id
            WHERE review.archived_at IS NULL AND record.archived_at IS NULL AND response.archived_at IS NULL
              AND record.academic_year_key = @academicYear
              AND review.workflow_status IN (N'awaiting_lecturer', N'awaiting_finalisation', N'completed')
              AND field.field_key IN (N'good_practice', N'excellent_practice')
              AND NULLIF(LTRIM(RTRIM(response.response_text)), N'') IS NOT NULL
              AND (
                  @canViewUco = 1
                  OR review.lecturer_staff_id = @currentStaffId
                  OR review.observer_staff_id = @currentStaffId
                  OR lecturer.line_manager_staff_id = @currentStaffId
              )
            ORDER BY review.observation_at DESC,
                     CASE field.field_key WHEN N'excellent_practice' THEN 0 ELSE 1 END;
            """,
            command =>
            {
                AddUcoTlaAccessParameters(command, user);
                command.Parameters.AddWithValue("@academicYear", academicYear);
            },
            reader => new UcoTlaPracticeHighlight(
                reader.GetGuid(0), reader.GetString(1), reader.GetString(2), reader.GetString(3),
                reader.GetFieldValue<DateTimeOffset>(4), reader.GetString(5), reader.GetString(6)),
            cancellationToken);

    public async Task<UcoTlaReviewDetail?> GetUcoTlaReviewAsync(
        Guid recordId,
        CurrentUser user,
        CancellationToken cancellationToken)
    {
        if (!user.UserAccountId.HasValue) return null;
        var rows = await QueryAsync(
            UcoTlaReviewSelectSql + " AND review.record_id = @recordId;",
            command =>
            {
                AddUcoTlaAccessParameters(command, user);
                command.Parameters.AddWithValue("@recordId", recordId);
            },
            MapUcoTlaRow,
            cancellationToken);
        var row = rows.SingleOrDefault();
        if (row is null) return null;

        var summary = ToUcoTlaSummary(row, user);
        var responses = await GetUcoTlaResponsesAsync(row.FormSubmissionId, cancellationToken);
        if (!summary.Capabilities.CanViewObserverFindings)
        {
            responses = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        }
        var actionPlan = summary.Capabilities.CanViewObserverFindings
            ? await GetUcoTlaActionPlanAsync(recordId, cancellationToken)
            : [];
        var followUp = summary.Capabilities.CanViewObserverFindings
            ? await GetUcoTlaFollowUpAsync(recordId, cancellationToken)
            : null;
        var sectionCompletion = await GetUcoTlaSectionCompletionAsync(recordId, cancellationToken);

        return new UcoTlaReviewDetail(
            summary,
            row.FormSubmissionId,
            row.SessionType,
            row.CourseLevel,
            row.NumberRegistered,
            row.NumberPresent,
            row.NumberLate,
            responses,
            actionPlan,
            followUp,
            row.ProbationObservationId,
            row.ParentReviewRecordId,
            sectionCompletion,
            row.LecturerAcknowledgedAt,
            row.LecturerSignatoryName,
            row.ObserverSignedAt,
            row.ObserverSignatoryName,
            row.ReopenedAt,
            row.ReopenReason);
    }

    public Task<Guid> CreateUcoTlaReviewAsync(
        CreateUcoTlaReviewRequest request,
        CurrentUser user,
        CancellationToken cancellationToken) =>
        CreateUcoTlaReviewCoreAsync(request, null, user, cancellationToken);

    private async Task<Guid> CreateUcoTlaReviewCoreAsync(
        CreateUcoTlaReviewRequest request,
        Guid? parentReviewRecordId,
        CurrentUser user,
        CancellationToken cancellationToken)
    {
        RequireUcoTlaManager(user);
        UcoTlaReviewWorkflow.ValidatePeople(request.LecturerStaffId, request.ObserverStaffId);
        UcoTlaReviewWorkflow.ValidateAttendance(request.NumberRegistered, request.NumberPresent, request.NumberLate);
        var academicYear = request.AcademicYear?.Trim() ?? string.Empty;
        if (!AcademicYearPolicy.TryGetBounds(academicYear, out _, out _))
            throw new WorkflowValidationException("Select a valid academic year.");
        var hasSessionDetails = request.ObservationAt.HasValue
            || !string.IsNullOrWhiteSpace(request.SessionType)
            || !string.IsNullOrWhiteSpace(request.CourseTitle)
            || !string.IsNullOrWhiteSpace(request.ModuleTitle)
            || !string.IsNullOrWhiteSpace(request.CourseLevel);
        if (hasSessionDetails)
        {
            if (!request.ObservationAt.HasValue)
                throw new WorkflowValidationException("Enter the observation date and time.");
            ValidateUcoCourseDetails(request.SessionType, request.CourseTitle, request.ModuleTitle, request.CourseLevel);
            if (AcademicYearPolicy.GetKey(DateOnly.FromDateTime(request.ObservationAt.Value.Date)) != academicYear)
                throw new WorkflowValidationException("The observation date must be within the selected academic year.");
        }

        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            await ValidateUcoParticipantsAsync(connection, transaction, request.LecturerStaffId, request.ObserverStaffId,
                cancellationToken);
            if (parentReviewRecordId.HasValue)
            {
                await ValidateUcoParentReviewAsync(connection, transaction, parentReviewRecordId.Value,
                    request.LecturerStaffId, cancellationToken);
            }

            var recordId = Guid.NewGuid();
            var submissionId = Guid.NewGuid();
            var lecturerName = await GetUcoStaffNameAsync(connection, transaction, request.LecturerStaffId, cancellationToken);
            var title = request.ObservationAt.HasValue
                ? $"UCO TLA Review - {lecturerName} - {request.ObservationAt.Value:yyyy-MM-dd}"
                : $"UCO TLA Review - {lecturerName} - Draft";
            await using (var create = new SqlCommand(
                """
                INSERT INTO core.records (
                    id, module_id, record_type, title, subject_staff_id, owner_staff_id, org_unit_id,
                    record_date, academic_year_key, created_by_user_account_id, updated_by_user_account_id
                )
                SELECT @recordId, module.id, N'uco_tla_review', @title, @lecturerId, @observerId, uco.id,
                       CONVERT(date, @observationAt), @academicYear, @userId, @userId
                FROM core.modules module
                CROSS JOIN org.org_units uco
                WHERE module.module_key = N'uco_tla_reviews' AND uco.code = N'UCO';

                INSERT INTO forms.form_submissions (
                    id, record_id, form_template_version_id, status
                )
                SELECT @submissionId, @recordId, version.id, N'draft'
                FROM forms.form_template_versions version
                JOIN forms.form_templates template ON template.id = version.form_template_id
                WHERE template.template_key = N'uco_tla_review_core'
                  AND version.version_label = N'2025/26' AND version.is_published = 1;

                INSERT INTO quality.uco_tla_reviews (
                    record_id, form_submission_id, lecturer_staff_id, observer_staff_id,
                    observation_at, session_type, course_title, module_title, course_level,
                    number_registered, number_present, number_late, parent_review_record_id,
                    created_by_user_account_id, updated_by_user_account_id
                ) VALUES (
                    @recordId, @submissionId, @lecturerId, @observerId,
                    @observationAt, @sessionType, @courseTitle, @moduleTitle, @courseLevel,
                    @registered, @present, @late, @parentId, @userId, @userId
                );
                """, connection, transaction))
            {
                create.Parameters.AddWithValue("@recordId", recordId);
                create.Parameters.AddWithValue("@submissionId", submissionId);
                create.Parameters.AddWithValue("@title", title);
                create.Parameters.AddWithValue("@lecturerId", request.LecturerStaffId);
                create.Parameters.AddWithValue("@observerId", request.ObserverStaffId);
                create.Parameters.Add("@observationAt", SqlDbType.DateTimeOffset).Value = DbValue(request.ObservationAt);
                create.Parameters.AddWithValue("@academicYear", academicYear);
                create.Parameters.Add("@sessionType", SqlDbType.NVarChar, 200).Value = ToDbValue(request.SessionType?.Trim());
                create.Parameters.Add("@courseTitle", SqlDbType.NVarChar, 300).Value = ToDbValue(request.CourseTitle?.Trim());
                create.Parameters.Add("@moduleTitle", SqlDbType.NVarChar, 300).Value = ToDbValue(request.ModuleTitle?.Trim());
                create.Parameters.Add("@courseLevel", SqlDbType.NVarChar, 100).Value = ToDbValue(request.CourseLevel?.Trim());
                create.Parameters.AddWithValue("@registered", DbValue(request.NumberRegistered));
                create.Parameters.AddWithValue("@present", DbValue(request.NumberPresent));
                create.Parameters.AddWithValue("@late", DbValue(request.NumberLate));
                create.Parameters.AddWithValue("@parentId", ToDbValue(parentReviewRecordId));
                create.Parameters.AddWithValue("@userId", user.UserAccountId!.Value);
                if (await create.ExecuteNonQueryAsync(cancellationToken) != 3)
                    throw new WorkflowValidationException("The UCO TLA module or published form template is not configured. Apply migration 071.");
            }

            await UpsertUcoResponseAsync(connection, transaction, submissionId, "observation_at", request.ObservationAt?.ToString("O"), cancellationToken);
            await UpsertUcoResponseAsync(connection, transaction, submissionId, "session_type", request.SessionType, cancellationToken);
            await UpsertUcoResponseAsync(connection, transaction, submissionId, "course_title", request.CourseTitle, cancellationToken);
            await UpsertUcoResponseAsync(connection, transaction, submissionId, "module_title", request.ModuleTitle, cancellationToken);
            await UpsertUcoResponseAsync(connection, transaction, submissionId, "course_level", request.CourseLevel, cancellationToken);
            await UpsertUcoResponseAsync(connection, transaction, submissionId, "number_registered", request.NumberRegistered?.ToString(), cancellationToken);
            await UpsertUcoResponseAsync(connection, transaction, submissionId, "number_present", request.NumberPresent?.ToString(), cancellationToken);
            await UpsertUcoResponseAsync(connection, transaction, submissionId, "number_late", request.NumberLate?.ToString(), cancellationToken);

            if (parentReviewRecordId.HasValue)
            {
                await using var linkParent = new SqlCommand(
                    """
                    UPDATE quality.uco_tla_follow_ups
                    SET linked_review_record_id = @recordId, updated_by_user_account_id = @userId,
                        updated_at = sysutcdatetime()
                    WHERE review_record_id = @parentId AND follow_up_type = N'observation'
                      AND linked_review_record_id IS NULL;
                    """, connection, transaction);
                linkParent.Parameters.AddWithValue("@recordId", recordId);
                linkParent.Parameters.AddWithValue("@parentId", parentReviewRecordId.Value);
                linkParent.Parameters.AddWithValue("@userId", user.UserAccountId.Value);
                if (await linkParent.ExecuteNonQueryAsync(cancellationToken) != 1)
                    throw new WorkflowValidationException("The follow-up was changed while the linked review was being created.");
            }

            await InsertUcoDomainEventAsync(connection, transaction, "uco_tla.assigned", recordId, user, cancellationToken);
            await WriteAuditAsync(connection, transaction, user.UserAccountId, recordId, "uco_tla_review", recordId,
                "uco_tla.created", $"UCO TLA Review created for {lecturerName}.", null,
                JsonSerializer.Serialize(request), cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return recordId;
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task SaveUcoTlaObserverSectionAsync(
        Guid recordId,
        SaveUcoTlaObserverSectionRequest request,
        CurrentUser user,
        CancellationToken cancellationToken)
    {
        UcoTlaReviewWorkflow.ValidateAttendance(request.NumberRegistered, request.NumberPresent, request.NumberLate);
        UcoTlaReviewWorkflow.ValidateActionPlans(request.ActionPlan, action => action.ActionType);
        ValidateUcoCourseDetails(request.SessionType, request.CourseTitle, request.ModuleTitle, request.CourseLevel);
        ValidateUcoActionRows(request.ActionPlan);

        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            var state = await LockUcoReviewAsync(connection, transaction, recordId, request.RowVersion, cancellationToken);
            var canManage = UcoTlaReviewAccessPolicy.CanManageAll(user);
            if (!UcoTlaReviewWorkflow.CanEditObserverSection(state.Status, state.ObserverStaffId == user.StaffId, canManage))
                throw new UnauthorizedAccessException("The observer section is not editable at this stage.");

            await ValidateUcoActionOwnersAsync(connection, transaction, request.ActionPlan, cancellationToken);

            await using (var update = new SqlCommand(
                """
                UPDATE review SET observation_at = @observationAt, session_type = @sessionType,
                    course_title = @courseTitle, module_title = @moduleTitle, course_level = @courseLevel,
                    number_registered = @registered, number_present = @present, number_late = @late,
                    professional_discussion_at = @discussionAt,
                    updated_by_user_account_id = @userId, updated_at = sysutcdatetime()
                FROM quality.uco_tla_reviews review
                WHERE review.record_id = @recordId AND review.row_version = @rowVersion;

                UPDATE core.records SET title = @title, record_date = CONVERT(date, @observationAt),
                    academic_year_key = @academicYear, updated_by_user_account_id = @userId, updated_at = sysutcdatetime()
                WHERE id = @recordId;
                """, connection, transaction))
            {
                var lecturerName = await GetUcoStaffNameAsync(connection, transaction, state.LecturerStaffId, cancellationToken);
                update.Parameters.AddWithValue("@recordId", recordId);
                update.Parameters.Add("@rowVersion", SqlDbType.Timestamp, 8).Value = request.RowVersion;
                update.Parameters.AddWithValue("@observationAt", request.ObservationAt);
                update.Parameters.AddWithValue("@sessionType", request.SessionType.Trim());
                update.Parameters.AddWithValue("@courseTitle", request.CourseTitle.Trim());
                update.Parameters.AddWithValue("@moduleTitle", request.ModuleTitle.Trim());
                update.Parameters.AddWithValue("@courseLevel", request.CourseLevel.Trim());
                update.Parameters.AddWithValue("@registered", DbValue(request.NumberRegistered));
                update.Parameters.AddWithValue("@present", DbValue(request.NumberPresent));
                update.Parameters.AddWithValue("@late", DbValue(request.NumberLate));
                update.Parameters.AddWithValue("@discussionAt", DbValue(request.ProfessionalDiscussionAt));
                update.Parameters.AddWithValue("@userId", user.UserAccountId!.Value);
                update.Parameters.AddWithValue("@title", $"UCO TLA Review - {lecturerName} - {request.ObservationAt:yyyy-MM-dd}");
                update.Parameters.AddWithValue("@academicYear", AcademicYearPolicy.GetKey(DateOnly.FromDateTime(request.ObservationAt.Date)));
                if (await update.ExecuteNonQueryAsync(cancellationToken) < 2)
                    throw new UcoTlaConcurrencyException();
            }

            var allResponses = new Dictionary<string, string?>(request.Responses, StringComparer.OrdinalIgnoreCase)
            {
                ["observation_at"] = request.ObservationAt.ToString("O"),
                ["session_type"] = request.SessionType,
                ["course_title"] = request.CourseTitle,
                ["module_title"] = request.ModuleTitle,
                ["course_level"] = request.CourseLevel,
                ["number_registered"] = request.NumberRegistered?.ToString(),
                ["number_present"] = request.NumberPresent?.ToString(),
                ["number_late"] = request.NumberLate?.ToString()
            };
            foreach (var response in allResponses)
                await UpsertUcoResponseAsync(connection, transaction, state.FormSubmissionId, response.Key, response.Value, cancellationToken);

            await ReplaceUcoActionPlanAsync(connection, transaction, recordId, request.ActionPlan, cancellationToken);
            if (request.FollowUp is not null)
                await UpsertUcoFollowUpAsync(connection, transaction, recordId, request.FollowUp.FollowUpType,
                    request.FollowUp.ScheduledAt, request.FollowUp.Status, request.FollowUp.OutcomeNotes, user, cancellationToken);
            if (request.SectionKey is not null && request.IsSectionComplete.HasValue)
                await UpsertUcoSectionCompletionAsync(connection, transaction, recordId, request.SectionKey,
                    request.IsSectionComplete.Value, user, cancellationToken);

            await WriteAuditAsync(connection, transaction, user.UserAccountId, recordId, "uco_tla_review", recordId,
                "uco_tla.observer_section_saved", "Saved the UCO TLA observer section.", null,
                JsonSerializer.Serialize(new { request.ObservationAt, request.CourseTitle, responseCount = request.Responses.Count, actionCount = request.ActionPlan.Count }),
                cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task SubmitUcoTlaForLecturerAsync(
        Guid recordId,
        byte[] rowVersion,
        CurrentUser user,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            var state = await LockUcoReviewAsync(connection, transaction, recordId, rowVersion, cancellationToken);
            if (!UcoTlaReviewWorkflow.CanEditObserverSection(state.Status, state.ObserverStaffId == user.StaffId,
                    UcoTlaReviewAccessPolicy.CanManageAll(user)))
                throw new UnauthorizedAccessException("Only the assigned observer can send this review to the lecturer.");
            var responses = await GetUcoTlaResponsesAsync(connection, transaction, state.FormSubmissionId, cancellationToken);
            var missing = UcoRequiredObserverFields.Where(key => !responses.TryGetValue(key, out var value) || string.IsNullOrWhiteSpace(value)).ToArray();
            if (missing.Length > 0)
                throw new WorkflowValidationException("Complete every required narrative evidence field before sending the review to the lecturer.");

            var next = UcoTlaReviewWorkflow.Transition(state.Status, "submit");
            await UpdateUcoStatusAsync(connection, transaction, recordId, rowVersion, next, user,
                "moderation_submitted_at = NULL, moderation_return_reason = NULL", cancellationToken);
            await InsertUcoDomainEventAsync(connection, transaction, "uco_tla.observer_submitted", recordId, user, cancellationToken);
            await WriteAuditAsync(connection, transaction, user.UserAccountId, recordId, "uco_tla_review", recordId,
                "uco_tla.observer_submitted", "Observer completed the UCO TLA Review and sent it to the lecturer.", state.Status, next, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task AcknowledgeUcoTlaReviewAsync(
        Guid recordId,
        UcoTlaLecturerAcknowledgementRequest request,
        CurrentUser user,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.LecturerReflection))
            throw new WorkflowValidationException("Enter the lecturer reflection before acknowledging the review.");
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            var state = await LockUcoReviewAsync(connection, transaction, recordId, request.RowVersion, cancellationToken);
            if (!UcoTlaReviewWorkflow.CanReflect(state.Status, state.LecturerStaffId == user.StaffId))
                throw new UnauthorizedAccessException("Only the lecturer can acknowledge this review at this stage.");
            if (!state.ProfessionalDiscussionAt.HasValue)
                throw new WorkflowValidationException("Record the professional discussion date before lecturer acknowledgement.");
            await UpsertUcoResponseAsync(connection, transaction, state.FormSubmissionId, "lecturer_reflection", request.LecturerReflection, cancellationToken);
            var next = UcoTlaReviewWorkflow.Transition(state.Status, "acknowledge");
            await UpdateUcoStatusAsync(connection, transaction, recordId, request.RowVersion, next, user,
                "lecturer_acknowledged_at = sysutcdatetime(), lecturer_acknowledged_by_user_account_id = @userId", cancellationToken);
            await InsertUcoDomainEventAsync(connection, transaction, "uco_tla.lecturer_acknowledged", recordId, user, cancellationToken);
            await WriteAuditAsync(connection, transaction, user.UserAccountId, recordId, "uco_tla_review", recordId,
                "uco_tla.lecturer_acknowledged", "Lecturer acknowledged the UCO TLA Review.", state.Status, next, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task SaveUcoTlaProfessionalDiscussionAsync(
        Guid recordId,
        UcoTlaProfessionalDiscussionRequest request,
        CurrentUser user,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            var state = await LockUcoReviewAsync(connection, transaction, recordId, request.RowVersion, cancellationToken);
            if (state.Status != UcoTlaReviewWorkflow.AwaitingLecturer
                || (state.ObserverStaffId != user.StaffId && !UcoTlaReviewAccessPolicy.CanManageAll(user)))
                throw new UnauthorizedAccessException("The professional discussion can only be recorded by the observer or coordinator after the observer review is complete.");
            await using var update = new SqlCommand(
                """
                UPDATE quality.uco_tla_reviews
                SET professional_discussion_at = @discussionAt,
                    updated_by_user_account_id = @userId, updated_at = sysutcdatetime()
                WHERE record_id = @recordId AND row_version = @rowVersion;
                """, connection, transaction);
            update.Parameters.AddWithValue("@discussionAt", request.ProfessionalDiscussionAt);
            update.Parameters.AddWithValue("@userId", user.UserAccountId!.Value);
            update.Parameters.AddWithValue("@recordId", recordId);
            update.Parameters.Add("@rowVersion", SqlDbType.Timestamp, 8).Value = request.RowVersion;
            if (await update.ExecuteNonQueryAsync(cancellationToken) != 1) throw new UcoTlaConcurrencyException();
            await WriteAuditAsync(connection, transaction, user.UserAccountId, recordId, "uco_tla_review", recordId,
                "uco_tla.professional_discussion_recorded", "Recorded the professional discussion date.", null,
                JsonSerializer.Serialize(new { request.ProfessionalDiscussionAt }), cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task FinaliseUcoTlaReviewAsync(
        Guid recordId,
        UcoTlaFinaliseRequest request,
        CurrentUser user,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            var state = await LockUcoReviewAsync(connection, transaction, recordId, request.RowVersion, cancellationToken);
            if (!UcoTlaReviewWorkflow.CanFinalise(state.Status, state.ObserverStaffId == user.StaffId))
                throw new UnauthorizedAccessException("Only the assigned observer can give the final sign-off.");
            var responses = await GetUcoTlaResponsesAsync(connection, transaction, state.FormSubmissionId, cancellationToken);
            var actions = await GetUcoTlaActionPlanAsync(connection, transaction, recordId, cancellationToken);
            var followUp = await GetUcoTlaFollowUpAsync(connection, transaction, recordId, cancellationToken);
            var hasEssentialFinding = responses.TryGetValue("essential_actions", out var essential) && !string.IsNullOrWhiteSpace(essential);
            UcoTlaReviewWorkflow.ValidateEssentialFollowUp(
                hasEssentialFinding,
                actions.Any(action => action.ActionType == "essential"),
                state.ProfessionalDiscussionAt,
                followUp?.ScheduledAt);

            await MaterialiseUcoActionsAsync(connection, transaction, recordId, state.LecturerStaffId, actions, user, cancellationToken);
            var next = UcoTlaReviewWorkflow.Transition(state.Status, "finalise");
            await UpdateUcoStatusAsync(connection, transaction, recordId, request.RowVersion, next, user,
                "observer_signed_at = sysutcdatetime(), observer_signed_by_user_account_id = @userId", cancellationToken);
            await using (var completeSubmission = new SqlCommand(
                """
                UPDATE forms.form_submissions SET status = N'submitted', submitted_at = sysutcdatetime(),
                    submitted_by_user_account_id = @userId, updated_at = sysutcdatetime()
                WHERE id = @submissionId;

                UPDATE observation SET status = N'completed', completed_at = sysutcdatetime(),
                    completed_by_user_account_id = @userId, updated_by_user_account_id = @userId,
                    updated_at = sysutcdatetime()
                FROM quality.probation_observations observation
                WHERE observation.linked_uco_tla_review_id = @recordId;

                UPDATE probation_case
                SET current_observation_number = 3, status = N'in_progress', completed_at = NULL,
                    updated_by_user_account_id = @userId, updated_at = sysutcdatetime()
                FROM quality.probation_cases probation_case
                JOIN quality.probation_observations observation
                  ON observation.probation_case_id = probation_case.id
                WHERE observation.linked_uco_tla_review_id = @recordId
                  AND observation.observation_number = 2
                  AND probation_case.current_observation_number = 2;
                """, connection, transaction))
            {
                completeSubmission.Parameters.AddWithValue("@submissionId", state.FormSubmissionId);
                completeSubmission.Parameters.AddWithValue("@recordId", recordId);
                completeSubmission.Parameters.AddWithValue("@userId", user.UserAccountId!.Value);
                await completeSubmission.ExecuteNonQueryAsync(cancellationToken);
            }
            await InsertUcoDomainEventAsync(connection, transaction, "uco_tla.completed", recordId, user, cancellationToken);
            if (followUp is not null)
                await InsertUcoDomainEventAsync(connection, transaction, "uco_tla.follow_up_due", recordId, user, cancellationToken);
            await WriteAuditAsync(connection, transaction, user.UserAccountId, recordId, "uco_tla_review", recordId,
                "uco_tla.completed", "Observer signed and completed the UCO TLA Review.", state.Status, next, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task ReopenUcoTlaReviewAsync(
        Guid recordId,
        UcoTlaReopenRequest request,
        CurrentUser user,
        CancellationToken cancellationToken)
    {
        RequireUcoTlaManager(user);
        UcoTlaReviewWorkflow.RequireReason(request.Reason, "Enter a reason for reopening the review.");
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            var state = await LockUcoReviewAsync(connection, transaction, recordId, request.RowVersion, cancellationToken);
            var next = UcoTlaReviewWorkflow.Transition(state.Status, "reopen");
            await UpdateUcoStatusAsync(connection, transaction, recordId, request.RowVersion, next, user,
                "reopened_at = sysutcdatetime(), reopened_by_user_account_id = @userId, reopen_reason = @reason, " +
                "moderation_submitted_at = NULL, moderation_returned_at = NULL, moderation_return_reason = NULL, " +
                "moderation_approved_at = NULL, moderation_approved_by_user_account_id = NULL, " +
                "lecturer_acknowledged_at = NULL, lecturer_acknowledged_by_user_account_id = NULL, " +
                "observer_signed_at = NULL, observer_signed_by_user_account_id = NULL", cancellationToken, request.Reason);
            await using (var draft = new SqlCommand(
                """
                UPDATE forms.form_submissions
                SET status = N'draft', submitted_at = NULL, submitted_by_user_account_id = NULL,
                    updated_at = sysutcdatetime()
                WHERE id = @submissionId;

                UPDATE central_action
                SET archived_at = sysutcdatetime(), updated_by_user_account_id = @userId,
                    updated_at = sysutcdatetime()
                FROM quality.actions central_action
                JOIN quality.uco_tla_action_plans action_plan ON action_plan.central_action_id = central_action.id
                WHERE action_plan.review_record_id = @recordId AND central_action.archived_at IS NULL;

                UPDATE quality.uco_tla_action_plans
                SET central_action_id = NULL, updated_at = sysutcdatetime()
                WHERE review_record_id = @recordId;

                UPDATE quality.uco_tla_section_progress
                SET is_complete = 0, completed_at = NULL, completed_by_user_account_id = NULL,
                    updated_at = sysutcdatetime()
                WHERE review_record_id = @recordId;

                UPDATE observation
                SET status = N'in_progress', completed_at = NULL, completed_by_user_account_id = NULL,
                    updated_by_user_account_id = @userId, updated_at = sysutcdatetime()
                FROM quality.probation_observations observation
                WHERE observation.linked_uco_tla_review_id = @recordId;

                UPDATE probation_case
                SET current_observation_number = 2, status = N'in_progress', completed_at = NULL,
                    updated_by_user_account_id = @userId, updated_at = sysutcdatetime()
                FROM quality.probation_cases probation_case
                JOIN quality.probation_observations observation
                  ON observation.probation_case_id = probation_case.id
                WHERE observation.linked_uco_tla_review_id = @recordId
                  AND observation.observation_number = 2;
                """,
                connection, transaction))
            {
                draft.Parameters.AddWithValue("@submissionId", state.FormSubmissionId);
                draft.Parameters.AddWithValue("@recordId", recordId);
                draft.Parameters.AddWithValue("@userId", user.UserAccountId!.Value);
                await draft.ExecuteNonQueryAsync(cancellationToken);
            }
            await InsertUcoDomainEventAsync(connection, transaction, "uco_tla.reopened", recordId, user, cancellationToken);
            await WriteAuditWithReasonAsync(connection, transaction, user.UserAccountId, recordId, "uco_tla_review", recordId,
                "uco_tla.reopened", "Reopened the UCO TLA Review; section completion and sign-off must be repeated.", state.Status, next,
                request.Reason, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task SaveUcoTlaFollowUpAsync(
        Guid recordId,
        UcoTlaFollowUpRequest request,
        CurrentUser user,
        CancellationToken cancellationToken)
    {
        RequireUcoTlaManager(user);
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            await EnsureUcoReviewExistsAsync(connection, transaction, recordId, cancellationToken);
            if (request.RowVersion is not null)
            {
                await using var check = new SqlCommand(
                    "SELECT COUNT(*) FROM quality.uco_tla_follow_ups WHERE review_record_id = @id AND row_version = @rowVersion;",
                    connection, transaction);
                check.Parameters.AddWithValue("@id", recordId);
                check.Parameters.Add("@rowVersion", SqlDbType.Timestamp, 8).Value = request.RowVersion;
                if (Convert.ToInt32(await check.ExecuteScalarAsync(cancellationToken)) == 0)
                    throw new UcoTlaConcurrencyException();
            }
            await UpsertUcoFollowUpAsync(connection, transaction, recordId, request.FollowUpType, request.ScheduledAt,
                request.Status, request.OutcomeNotes, user, cancellationToken);
            await WriteAuditAsync(connection, transaction, user.UserAccountId, recordId, "uco_tla_follow_up", recordId,
                "uco_tla.follow_up_saved", "Saved UCO TLA follow-up details.", null, JsonSerializer.Serialize(request), cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task<Guid> CreateLinkedUcoTlaReviewAsync(
        Guid parentRecordId,
        CreateLinkedUcoTlaReviewRequest request,
        CurrentUser user,
        CancellationToken cancellationToken)
    {
        RequireUcoTlaManager(user);
        var parent = await GetUcoTlaReviewAsync(parentRecordId, user, cancellationToken)
            ?? throw new WorkflowValidationException("The original UCO TLA Review was not found.");
        if (parent.Review.WorkflowStatus != UcoTlaReviewWorkflow.Completed)
            throw new WorkflowValidationException("Complete the original review before creating a linked observation.");
        if (parent.FollowUp?.FollowUpType != "observation")
            throw new WorkflowValidationException("A linked review is only available when the follow-up type is observation.");
        if (parent.FollowUp.LinkedReviewRecordId.HasValue)
            throw new WorkflowValidationException("This follow-up already has a linked review.");

        var recordId = await CreateUcoTlaReviewCoreAsync(new CreateUcoTlaReviewRequest(
            parent.Review.LecturerStaffId, request.ObserverStaffId,
            AcademicYearPolicy.GetKey(DateOnly.FromDateTime(request.ObservationAt.Date)),
            request.ObservationAt, request.SessionType, request.CourseTitle, request.ModuleTitle,
            request.CourseLevel, null, null, null), parentRecordId, user, cancellationToken);

        return recordId;
    }

    private static void RequireUcoTlaManager(CurrentUser user)
    {
        if (!user.UserAccountId.HasValue || !UcoTlaReviewAccessPolicy.CanManageAll(user))
            throw new UnauthorizedAccessException("UCO Teaching & Learning coordinator access is required.");
    }

    private static void ValidateUcoCourseDetails(string? sessionType, string? courseTitle, string? moduleTitle, string? courseLevel)
    {
        if (string.IsNullOrWhiteSpace(sessionType) || string.IsNullOrWhiteSpace(courseTitle)
            || string.IsNullOrWhiteSpace(moduleTitle) || string.IsNullOrWhiteSpace(courseLevel))
            throw new WorkflowValidationException("Complete the session type, course, module and level.");
    }

    private static void ValidateUcoActionRows(IReadOnlyList<SaveUcoTlaActionPlanRequest> actions)
    {
        if (actions.Select(action => action.DisplayOrder).Distinct().Count() != actions.Count
            || actions.Any(action => action.DisplayOrder is < 1 or > 3))
            throw new WorkflowValidationException("Development action rows must use the distinct positions 1 to 3.");
        if (actions.Any(action => action.ActionType is not ("essential" or "advisable" or "good_practice")))
            throw new WorkflowValidationException("Select Essential, Advisable or Good practice for every action.");
        if (actions.Any(action => string.IsNullOrWhiteSpace(action.Target)
                                  || string.IsNullOrWhiteSpace(action.AchievementMethod)))
            throw new WorkflowValidationException("Every development action needs a target and an achievement/check method.");
    }

    private static async Task ValidateUcoParticipantsAsync(
        SqlConnection connection,
        SqlTransaction transaction,
        Guid lecturerId,
        Guid observerId,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            """
            WITH uco_units AS (
                SELECT id FROM org.org_units WHERE code = N'UCO' AND archived_at IS NULL
                UNION ALL
                SELECT child.id FROM org.org_units child JOIN uco_units parent ON parent.id = child.parent_org_unit_id
                WHERE child.archived_at IS NULL
            ), selected AS (
                SELECT staff.id,
                       CAST(CASE WHEN staff.primary_org_unit_id IN (SELECT id FROM uco_units)
                                      OR EXISTS (SELECT 1 FROM org.staff_org_memberships membership
                                                 WHERE membership.staff_id = staff.id
                                                   AND membership.org_unit_id IN (SELECT id FROM uco_units)
                                                   AND membership.archived_at IS NULL)
                                 THEN 1 ELSE 0 END AS bit) AS is_uco,
                       CAST(1 AS bit) AS is_active_member
                FROM people.staff staff
                WHERE staff.id IN (@lecturerId, @observerId)
                  AND staff.account_status = N'active' AND staff.archived_at IS NULL
            )
            SELECT COUNT(*), SUM(CASE WHEN is_uco = 1 THEN 1 ELSE 0 END)
            FROM selected
            OPTION (MAXRECURSION 20);
            """, connection, transaction);
        command.Parameters.AddWithValue("@lecturerId", lecturerId);
        command.Parameters.AddWithValue("@observerId", observerId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        await reader.ReadAsync(cancellationToken);
        if (reader.GetInt32(0) != 2 || reader.GetInt32(1) != 2)
            throw new WorkflowValidationException("The lecturer and observer must be active UCO staff members.");
    }

    private static async Task ValidateUcoParentReviewAsync(
        SqlConnection connection,
        SqlTransaction transaction,
        Guid parentRecordId,
        Guid lecturerId,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            """
            SELECT COUNT(*)
            FROM quality.uco_tla_reviews parent WITH (UPDLOCK, HOLDLOCK)
            JOIN quality.uco_tla_follow_ups follow_up WITH (UPDLOCK, HOLDLOCK)
              ON follow_up.review_record_id = parent.record_id
            WHERE parent.record_id = @parentRecordId
              AND parent.lecturer_staff_id = @lecturerId
              AND parent.workflow_status = N'completed'
              AND parent.archived_at IS NULL
              AND follow_up.follow_up_type = N'observation'
              AND follow_up.linked_review_record_id IS NULL;
            """, connection, transaction);
        command.Parameters.AddWithValue("@parentRecordId", parentRecordId);
        command.Parameters.AddWithValue("@lecturerId", lecturerId);
        if (Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken)) != 1)
            throw new WorkflowValidationException("A linked review must follow the unlinked observation follow-up of a completed review for the same lecturer.");
    }

    private static async Task ValidateUcoActionOwnersAsync(
        SqlConnection connection,
        SqlTransaction transaction,
        IReadOnlyList<SaveUcoTlaActionPlanRequest> actions,
        CancellationToken cancellationToken)
    {
        var ownerIds = actions.Select(action => action.OwnerStaffId).Distinct().ToArray();
        if (ownerIds.Length == 0) return;

        var parameterNames = ownerIds.Select((_, index) => $"@owner{index}").ToArray();
        await using var command = new SqlCommand(
            $$"""
            WITH uco_units AS (
                SELECT id FROM org.org_units WHERE code = N'UCO' AND archived_at IS NULL
                UNION ALL
                SELECT child.id FROM org.org_units child JOIN uco_units parent ON parent.id = child.parent_org_unit_id
                WHERE child.archived_at IS NULL
            )
            SELECT COUNT(DISTINCT staff.id)
            FROM people.staff staff
            WHERE staff.id IN ({{string.Join(", ", parameterNames)}})
              AND staff.account_status = N'active' AND staff.archived_at IS NULL
              AND (staff.primary_org_unit_id IN (SELECT id FROM uco_units)
                   OR EXISTS (SELECT 1 FROM org.staff_org_memberships membership
                              WHERE membership.staff_id = staff.id
                                AND membership.org_unit_id IN (SELECT id FROM uco_units)
                                AND membership.archived_at IS NULL))
            OPTION (MAXRECURSION 20);
            """, connection, transaction);
        for (var index = 0; index < ownerIds.Length; index++)
            command.Parameters.AddWithValue(parameterNames[index], ownerIds[index]);
        if (Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken)) != ownerIds.Length)
            throw new WorkflowValidationException("Every development action owner must be an active UCO staff member.");
    }

    private static async Task<string> GetUcoStaffNameAsync(
        SqlConnection connection,
        SqlTransaction transaction,
        Guid staffId,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            "SELECT display_name FROM people.staff WHERE id = @id AND archived_at IS NULL;", connection, transaction);
        command.Parameters.AddWithValue("@id", staffId);
        return await command.ExecuteScalarAsync(cancellationToken) as string
            ?? throw new WorkflowValidationException("The selected staff member was not found.");
    }

    private static async Task<UcoLockedState> LockUcoReviewAsync(
        SqlConnection connection,
        SqlTransaction transaction,
        Guid recordId,
        byte[] rowVersion,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            """
            SELECT workflow_status, lecturer_staff_id, observer_staff_id,
                   form_submission_id, professional_discussion_at
            FROM quality.uco_tla_reviews WITH (UPDLOCK, ROWLOCK)
            WHERE record_id = @recordId AND row_version = @rowVersion AND archived_at IS NULL;
            """, connection, transaction);
        command.Parameters.AddWithValue("@recordId", recordId);
        command.Parameters.Add("@rowVersion", SqlDbType.Timestamp, 8).Value = rowVersion;
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) throw new UcoTlaConcurrencyException();
        return new UcoLockedState(
            reader.GetString(0), reader.GetGuid(1), reader.GetGuid(2), reader.GetGuid(3),
            GetDateTimeOffsetOrNull(reader, 4));
    }

    private static async Task EnsureUcoReviewExistsAsync(
        SqlConnection connection,
        SqlTransaction transaction,
        Guid recordId,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            "SELECT COUNT(*) FROM quality.uco_tla_reviews WHERE record_id = @id AND archived_at IS NULL;", connection, transaction);
        command.Parameters.AddWithValue("@id", recordId);
        if (Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken)) != 1)
            throw new WorkflowValidationException("The UCO TLA Review was not found.");
    }

    private static async Task UpdateUcoStatusAsync(
        SqlConnection connection,
        SqlTransaction transaction,
        Guid recordId,
        byte[] rowVersion,
        string nextStatus,
        CurrentUser user,
        string additionalAssignments,
        CancellationToken cancellationToken,
        string? reason = null)
    {
        await using var command = new SqlCommand($$"""
            UPDATE quality.uco_tla_reviews
            SET workflow_status = @status, updated_by_user_account_id = @userId, updated_at = sysutcdatetime(),
                {{additionalAssignments}}
            WHERE record_id = @recordId AND row_version = @rowVersion;
            """, connection, transaction);
        command.Parameters.AddWithValue("@status", nextStatus);
        command.Parameters.AddWithValue("@userId", user.UserAccountId!.Value);
        command.Parameters.AddWithValue("@recordId", recordId);
        command.Parameters.AddWithValue("@reason", ToDbValue(reason));
        command.Parameters.Add("@rowVersion", SqlDbType.Timestamp, 8).Value = rowVersion;
        if (await command.ExecuteNonQueryAsync(cancellationToken) != 1) throw new UcoTlaConcurrencyException();
    }

    private static async Task UpsertUcoResponseAsync(
        SqlConnection connection,
        SqlTransaction transaction,
        Guid submissionId,
        string fieldKey,
        string? value,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            """
            UPDATE response SET response_text = @value, response_number = NULL, response_date = NULL,
                response_lookup_value_id = NULL, response_json = NULL, updated_at = sysutcdatetime(), archived_at = NULL
            FROM forms.form_responses response
            JOIN forms.form_fields field ON field.id = response.form_field_id
            WHERE response.form_submission_id = @submissionId AND field.field_key = @fieldKey;

            IF @@ROWCOUNT = 0
                INSERT INTO forms.form_responses (form_submission_id, form_field_id, response_text)
                SELECT @submissionId, field.id, @value
                FROM forms.form_submissions submission
                JOIN forms.form_template_versions version ON version.id = submission.form_template_version_id
                JOIN forms.form_sections section ON section.form_template_version_id = version.id
                JOIN forms.form_fields field ON field.form_section_id = section.id
                WHERE submission.id = @submissionId AND field.field_key = @fieldKey;
            """, connection, transaction);
        command.Parameters.AddWithValue("@submissionId", submissionId);
        command.Parameters.AddWithValue("@fieldKey", fieldKey);
        command.Parameters.AddWithValue("@value", ToDbValue(value));
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private Task<Dictionary<string, string?>> GetUcoTlaResponsesAsync(Guid submissionId, CancellationToken cancellationToken) =>
        QueryAsync(
            """
            SELECT field.field_key, response.response_text
            FROM forms.form_responses response
            JOIN forms.form_fields field ON field.id = response.form_field_id
            WHERE response.form_submission_id = @submissionId AND response.archived_at IS NULL;
            """,
            command => command.Parameters.AddWithValue("@submissionId", submissionId),
            reader => new KeyValuePair<string, string?>(reader.GetString(0), GetStringOrNull(reader, 1)),
            cancellationToken).ContinueWith(task => task.Result.ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.OrdinalIgnoreCase), cancellationToken);

    private static async Task<Dictionary<string, string?>> GetUcoTlaResponsesAsync(
        SqlConnection connection,
        SqlTransaction transaction,
        Guid submissionId,
        CancellationToken cancellationToken)
    {
        var values = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        await using var command = new SqlCommand(
            """
            SELECT field.field_key, response.response_text
            FROM forms.form_responses response
            JOIN forms.form_fields field ON field.id = response.form_field_id
            WHERE response.form_submission_id = @submissionId AND response.archived_at IS NULL;
            """, connection, transaction);
        command.Parameters.AddWithValue("@submissionId", submissionId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken)) values[reader.GetString(0)] = GetStringOrNull(reader, 1);
        return values;
    }

    private Task<IReadOnlyDictionary<string, bool>> GetUcoTlaSectionCompletionAsync(
        Guid recordId,
        CancellationToken cancellationToken) =>
        QueryAsync(
            """
            SELECT section_key, is_complete
            FROM quality.uco_tla_section_progress
            WHERE review_record_id = @recordId;
            """,
            command => command.Parameters.AddWithValue("@recordId", recordId),
            reader => new KeyValuePair<string, bool>(reader.GetString(0), reader.GetBoolean(1)),
            cancellationToken).ContinueWith<IReadOnlyDictionary<string, bool>>(
                task => task.Result.ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.OrdinalIgnoreCase),
                cancellationToken);

    private static async Task UpsertUcoSectionCompletionAsync(
        SqlConnection connection,
        SqlTransaction transaction,
        Guid recordId,
        string sectionKey,
        bool isComplete,
        CurrentUser user,
        CancellationToken cancellationToken)
    {
        var normalizedKey = sectionKey.Trim().ToLowerInvariant();
        if (!UcoSectionKeys.Contains(normalizedKey))
            throw new WorkflowValidationException("The selected UCO review section is not recognised.");

        await using var command = new SqlCommand(
            """
            UPDATE quality.uco_tla_section_progress
            SET is_complete = @isComplete,
                completed_at = CASE WHEN @isComplete = 1 THEN COALESCE(completed_at, sysutcdatetime()) ELSE NULL END,
                completed_by_user_account_id = CASE WHEN @isComplete = 1 THEN @userId ELSE NULL END,
                updated_at = sysutcdatetime()
            WHERE review_record_id = @recordId AND section_key = @sectionKey;
            IF @@ROWCOUNT = 0
                INSERT INTO quality.uco_tla_section_progress (
                    review_record_id, section_key, is_complete, completed_at, completed_by_user_account_id
                ) VALUES (
                    @recordId, @sectionKey, @isComplete,
                    CASE WHEN @isComplete = 1 THEN sysutcdatetime() ELSE NULL END,
                    CASE WHEN @isComplete = 1 THEN @userId ELSE NULL END
                );
            """, connection, transaction);
        command.Parameters.AddWithValue("@recordId", recordId);
        command.Parameters.AddWithValue("@sectionKey", normalizedKey);
        command.Parameters.AddWithValue("@isComplete", isComplete);
        command.Parameters.AddWithValue("@userId", user.UserAccountId!.Value);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private Task<IReadOnlyList<UcoTlaActionPlanSummary>> GetUcoTlaActionPlanAsync(
        Guid recordId,
        CancellationToken cancellationToken) =>
        QueryAsync(
            """
            SELECT action_plan.id, action_plan.display_order, action_plan.action_type, action_plan.target, action_plan.achievement_method,
                   action_plan.owner_staff_id, owner.display_name, action_plan.due_date, action_plan.central_action_id
            FROM quality.uco_tla_action_plans action_plan
            JOIN people.staff owner ON owner.id = action_plan.owner_staff_id
            WHERE action_plan.review_record_id = @recordId
            ORDER BY action_plan.display_order;
            """,
            command => command.Parameters.AddWithValue("@recordId", recordId),
            MapUcoTlaActionPlan,
            cancellationToken);

    private static async Task<IReadOnlyList<UcoTlaActionPlanSummary>> GetUcoTlaActionPlanAsync(
        SqlConnection connection,
        SqlTransaction transaction,
        Guid recordId,
        CancellationToken cancellationToken)
    {
        var rows = new List<UcoTlaActionPlanSummary>();
        await using var command = new SqlCommand(
            """
            SELECT action_plan.id, action_plan.display_order, action_plan.action_type, action_plan.target, action_plan.achievement_method,
                   action_plan.owner_staff_id, owner.display_name, action_plan.due_date, action_plan.central_action_id
            FROM quality.uco_tla_action_plans action_plan
            JOIN people.staff owner ON owner.id = action_plan.owner_staff_id
            WHERE action_plan.review_record_id = @recordId ORDER BY action_plan.display_order;
            """, connection, transaction);
        command.Parameters.AddWithValue("@recordId", recordId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken)) rows.Add(MapUcoTlaActionPlan(reader));
        return rows;
    }

    private static UcoTlaActionPlanSummary MapUcoTlaActionPlan(SqlDataReader reader) => new(
        reader.GetGuid(0), reader.GetByte(1), reader.GetString(2), reader.GetString(3), reader.GetString(4),
        reader.GetGuid(5), reader.GetString(6), DateOnly.FromDateTime(reader.GetDateTime(7)), GetGuidOrNull(reader, 8));

    private static async Task ReplaceUcoActionPlanAsync(
        SqlConnection connection,
        SqlTransaction transaction,
        Guid recordId,
        IReadOnlyList<SaveUcoTlaActionPlanRequest> actions,
        CancellationToken cancellationToken)
    {
        await using (var clear = new SqlCommand(
            "DELETE FROM quality.uco_tla_action_plans WHERE review_record_id = @recordId AND central_action_id IS NULL;",
            connection, transaction))
        {
            clear.Parameters.AddWithValue("@recordId", recordId);
            await clear.ExecuteNonQueryAsync(cancellationToken);
        }
        foreach (var action in actions)
        {
            await using var insert = new SqlCommand(
                """
                INSERT INTO quality.uco_tla_action_plans (
                    id, review_record_id, display_order, action_type, target, achievement_method, owner_staff_id, due_date
                ) VALUES (@id, @recordId, @order, @type, @target, @method, @ownerId, @dueDate);
                """, connection, transaction);
            insert.Parameters.AddWithValue("@id", action.Id ?? Guid.NewGuid());
            insert.Parameters.AddWithValue("@recordId", recordId);
            insert.Parameters.AddWithValue("@order", action.DisplayOrder);
            insert.Parameters.AddWithValue("@type", action.ActionType);
            insert.Parameters.AddWithValue("@target", action.Target.Trim());
            insert.Parameters.AddWithValue("@method", action.AchievementMethod.Trim());
            insert.Parameters.AddWithValue("@ownerId", action.OwnerStaffId);
            insert.Parameters.AddWithValue("@dueDate", action.DueDate.ToDateTime(TimeOnly.MinValue));
            await insert.ExecuteNonQueryAsync(cancellationToken);
        }
    }

    private Task<UcoTlaFollowUpSummary?> GetUcoTlaFollowUpAsync(Guid recordId, CancellationToken cancellationToken) =>
        QueryAsync(
            """
            SELECT follow_up_type, scheduled_at, status, outcome_notes, linked_review_record_id, completed_at, row_version
            FROM quality.uco_tla_follow_ups WHERE review_record_id = @recordId;
            """,
            command => command.Parameters.AddWithValue("@recordId", recordId),
            MapUcoTlaFollowUp,
            cancellationToken).ContinueWith(task => task.Result.SingleOrDefault(), cancellationToken);

    private static async Task<UcoTlaFollowUpSummary?> GetUcoTlaFollowUpAsync(
        SqlConnection connection,
        SqlTransaction transaction,
        Guid recordId,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            """
            SELECT follow_up_type, scheduled_at, status, outcome_notes, linked_review_record_id, completed_at, row_version
            FROM quality.uco_tla_follow_ups WHERE review_record_id = @recordId;
            """, connection, transaction);
        command.Parameters.AddWithValue("@recordId", recordId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? MapUcoTlaFollowUp(reader) : null;
    }

    private static UcoTlaFollowUpSummary MapUcoTlaFollowUp(SqlDataReader reader) => new(
        reader.GetString(0), reader.GetFieldValue<DateTimeOffset>(1), reader.GetString(2), GetStringOrNull(reader, 3),
        GetGuidOrNull(reader, 4), GetDateTimeOffsetOrNull(reader, 5), reader.GetFieldValue<byte[]>(6));

    private static async Task UpsertUcoFollowUpAsync(
        SqlConnection connection,
        SqlTransaction transaction,
        Guid recordId,
        string followUpType,
        DateTimeOffset scheduledAt,
        string status,
        string? outcomeNotes,
        CurrentUser user,
        CancellationToken cancellationToken)
    {
        var normalizedType = followUpType.Trim().ToLowerInvariant();
        var normalizedStatus = status.Trim().ToLowerInvariant();
        if (normalizedType is not ("discussion" or "observation"))
            throw new WorkflowValidationException("Choose discussion or observation for the follow-up.");
        if (normalizedStatus is not ("scheduled" or "completed" or "cancelled"))
            throw new WorkflowValidationException("Choose Scheduled, Completed or Cancelled for the follow-up status.");
        if (normalizedStatus == "completed" && string.IsNullOrWhiteSpace(outcomeNotes))
            throw new WorkflowValidationException("Enter outcome notes when completing a follow-up.");

        await using var command = new SqlCommand(
            """
            UPDATE quality.uco_tla_follow_ups
            SET follow_up_type = @type, scheduled_at = @scheduledAt, status = @status,
                outcome_notes = @notes,
                completed_at = CASE WHEN @status = N'completed' THEN COALESCE(completed_at, sysutcdatetime()) ELSE NULL END,
                updated_by_user_account_id = @userId, updated_at = sysutcdatetime()
            WHERE review_record_id = @recordId;
            IF @@ROWCOUNT = 0
                INSERT INTO quality.uco_tla_follow_ups (
                    review_record_id, follow_up_type, scheduled_at, status, outcome_notes,
                    completed_at, created_by_user_account_id, updated_by_user_account_id
                ) VALUES (
                    @recordId, @type, @scheduledAt, @status, @notes,
                    CASE WHEN @status = N'completed' THEN sysutcdatetime() ELSE NULL END, @userId, @userId
                );
            """, connection, transaction);
        command.Parameters.AddWithValue("@recordId", recordId);
        command.Parameters.AddWithValue("@type", normalizedType);
        command.Parameters.AddWithValue("@scheduledAt", scheduledAt);
        command.Parameters.AddWithValue("@status", normalizedStatus);
        command.Parameters.AddWithValue("@notes", ToDbValue(outcomeNotes));
        command.Parameters.AddWithValue("@userId", user.UserAccountId!.Value);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task MaterialiseUcoActionsAsync(
        SqlConnection connection,
        SqlTransaction transaction,
        Guid recordId,
        Guid lecturerId,
        IReadOnlyList<UcoTlaActionPlanSummary> actions,
        CurrentUser user,
        CancellationToken cancellationToken)
    {
        foreach (var action in actions.Where(action => !action.CentralActionId.HasValue))
        {
            var centralActionId = Guid.NewGuid();
            await using var command = new SqlCommand(
                """
                INSERT INTO quality.actions (
                    id, source_record_id, source_form_type, source_sub_record_type, source_sub_record_id,
                    source_sub_record_key, source_display_order, subject_staff_id, owner_staff_id,
                    title, detail, action_theme, status_lookup_value_id, due_date, original_due_date,
                    published_to_staff, visibility_setting, created_by_user_account_id, updated_by_user_account_id
                )
                SELECT @actionId, @recordId, N'uco_tla_review', N'uco_tla_action_plan', @planId,
                       CONCAT(N'action_', @displayOrder), @displayOrder, @lecturerId, @ownerId,
                       @title, @detail, @theme, status.id, @dueDate, @dueDate,
                       1, N'staff_and_management', @userId, @userId
                FROM core.lookup_values status
                JOIN core.lookup_types type ON type.id = status.lookup_type_id
                WHERE type.lookup_key = N'action_status' AND status.value_key = N'open';

                UPDATE quality.uco_tla_action_plans
                SET central_action_id = @actionId, updated_at = sysutcdatetime()
                WHERE id = @planId AND central_action_id IS NULL;
                """, connection, transaction);
            command.Parameters.AddWithValue("@actionId", centralActionId);
            command.Parameters.AddWithValue("@recordId", recordId);
            command.Parameters.AddWithValue("@planId", action.Id!.Value);
            command.Parameters.AddWithValue("@displayOrder", action.DisplayOrder);
            command.Parameters.AddWithValue("@lecturerId", lecturerId);
            command.Parameters.AddWithValue("@ownerId", action.OwnerStaffId);
            command.Parameters.AddWithValue("@title", action.Target);
            command.Parameters.AddWithValue("@detail", action.AchievementMethod);
            command.Parameters.AddWithValue("@theme", action.ActionType switch
            {
                "essential" => "Essential action",
                "good_practice" => "Sharing excellent practice",
                _ => "Advisable action"
            });
            command.Parameters.AddWithValue("@dueDate", action.DueDate.ToDateTime(TimeOnly.MinValue));
            command.Parameters.AddWithValue("@userId", user.UserAccountId!.Value);
            if (await command.ExecuteNonQueryAsync(cancellationToken) != 2)
                throw new WorkflowValidationException("The central action status configuration is missing.");
            await InsertDomainEventAsync(connection, transaction, "action.assigned", "action", centralActionId, recordId,
                "{}", user.UserAccountId, cancellationToken);
        }
    }

    private static async Task InsertUcoDomainEventAsync(
        SqlConnection connection,
        SqlTransaction transaction,
        string eventType,
        Guid recordId,
        CurrentUser user,
        CancellationToken cancellationToken) =>
        await InsertDomainEventAsync(connection, transaction, eventType, "uco_tla_review", recordId, recordId,
            "{}", user.UserAccountId, cancellationToken);

    private static void AddUcoTlaAccessParameters(SqlCommand command, CurrentUser user)
    {
        command.Parameters.AddWithValue("@currentStaffId", ToDbValue(user.StaffId));
        command.Parameters.AddWithValue("@canViewUco", UcoTlaReviewAccessPolicy.CanViewAll(user));
    }

    private static UcoTlaRow MapUcoTlaRow(SqlDataReader reader) => new(
        reader.GetGuid(0), reader.GetString(1), reader.GetString(2), reader.GetString(3),
        reader.GetGuid(4), reader.GetString(5), reader.GetGuid(6), reader.GetString(7),
        GetDateTimeOffsetOrNull(reader, 8), GetStringOrNull(reader, 9), GetStringOrNull(reader, 10),
        GetDateTimeOffsetOrNull(reader, 11), GetDateTimeOffsetOrNull(reader, 12), GetStringOrNull(reader, 13),
        reader.GetInt32(14), reader.GetInt32(15), reader.GetFieldValue<byte[]>(16), reader.GetBoolean(17),
        reader.GetGuid(18), GetStringOrNull(reader, 19), GetStringOrNull(reader, 20), GetIntOrNull(reader, 21),
        GetIntOrNull(reader, 22), GetIntOrNull(reader, 23), GetGuidOrNull(reader, 24), GetGuidOrNull(reader, 25),
        GetDateTimeOffsetOrNull(reader, 26), GetStringOrNull(reader, 27), GetDateTimeOffsetOrNull(reader, 28),
        GetStringOrNull(reader, 29), GetDateTimeOffsetOrNull(reader, 30), GetStringOrNull(reader, 31),
        reader.GetInt32(32));

    private static UcoTlaReviewSummary ToUcoTlaSummary(UcoTlaRow row, CurrentUser user)
    {
        var canManage = UcoTlaReviewAccessPolicy.CanManageAll(user);
        var canViewAll = UcoTlaReviewAccessPolicy.CanViewAll(user);
        var isLecturer = row.LecturerStaffId == user.StaffId;
        var isObserver = row.ObserverStaffId == user.StaffId;
        var canViewFindings = UcoTlaReviewWorkflow.CanViewObserverFindings(row.Status, isLecturer);
        var completedAccess = UcoTlaReviewWorkflow.CanViewCompletedReport(
            row.Status, user.StaffId, row.LecturerStaffId, row.ObserverStaffId,
            row.IsLineManager, canViewAll);
        var capabilities = new UcoTlaCapabilities(
            UcoTlaReviewWorkflow.CanEditObserverSection(row.Status, isObserver, canManage),
            row.Status == UcoTlaReviewWorkflow.AwaitingLecturer && (isObserver || canManage),
            UcoTlaReviewWorkflow.CanReflect(row.Status, isLecturer),
            UcoTlaReviewWorkflow.CanFinalise(row.Status, isObserver),
            canManage && row.Status == UcoTlaReviewWorkflow.Completed,
            canManage,
            canManage && row.Status == UcoTlaReviewWorkflow.Completed,
            canViewFindings,
            completedAccess,
            completedAccess);
        return new UcoTlaReviewSummary(
            row.RecordId, row.Title, row.AcademicYear, row.Status,
            row.LecturerStaffId, row.LecturerName, row.ObserverStaffId, row.ObserverName,
            row.ObservationAt, row.CourseTitle, row.ModuleTitle,
            row.ProfessionalDiscussionAt, row.FollowUpAt, row.FollowUpStatus,
            row.OpenActionCount, row.OverdueActionCount, row.CompletedSectionCount, row.RowVersion, capabilities);
    }

    private const string UcoTlaReviewSelectSql = """
        SELECT review.record_id, record.title, record.academic_year_key, review.workflow_status,
               review.lecturer_staff_id, lecturer.display_name,
               review.observer_staff_id, observer.display_name,
               review.observation_at, review.course_title, review.module_title, review.professional_discussion_at,
               follow_up.scheduled_at, follow_up.status,
               COALESCE(action_counts.open_count, 0), COALESCE(action_counts.overdue_count, 0),
               review.row_version,
               CAST(CASE WHEN lecturer.line_manager_staff_id = @currentStaffId THEN 1 ELSE 0 END AS bit),
               review.form_submission_id, review.session_type, review.course_level,
               review.number_registered, review.number_present, review.number_late,
               probation.id, review.parent_review_record_id,
               review.lecturer_acknowledged_at, lecturer_account_staff.display_name,
               review.observer_signed_at, observer_account_staff.display_name,
               review.reopened_at, review.reopen_reason,
               COALESCE(section_counts.completed_count, 0)
        FROM quality.uco_tla_reviews review
        JOIN core.records record ON record.id = review.record_id
        JOIN people.staff lecturer ON lecturer.id = review.lecturer_staff_id
        JOIN people.staff observer ON observer.id = review.observer_staff_id
        LEFT JOIN quality.uco_tla_follow_ups follow_up ON follow_up.review_record_id = review.record_id
        LEFT JOIN quality.probation_observations probation ON probation.linked_uco_tla_review_id = review.record_id
        LEFT JOIN auth.user_accounts lecturer_account ON lecturer_account.id = review.lecturer_acknowledged_by_user_account_id
        LEFT JOIN people.staff lecturer_account_staff ON lecturer_account_staff.id = lecturer_account.staff_id
        LEFT JOIN auth.user_accounts observer_account ON observer_account.id = review.observer_signed_by_user_account_id
        LEFT JOIN people.staff observer_account_staff ON observer_account_staff.id = observer_account.staff_id
        OUTER APPLY (
            SELECT COUNT(CASE WHEN status.value_key IN (N'open', N'extended') THEN 1 END) AS open_count,
                   COUNT(CASE WHEN status.value_key IN (N'open', N'extended') AND action.due_date < CONVERT(date, sysutcdatetime()) THEN 1 END) AS overdue_count
            FROM quality.actions action
            LEFT JOIN core.lookup_values status ON status.id = action.status_lookup_value_id
            WHERE action.source_record_id = review.record_id AND action.archived_at IS NULL
        ) action_counts
        OUTER APPLY (
            SELECT COUNT(*) AS completed_count
            FROM quality.uco_tla_section_progress progress
            WHERE progress.review_record_id = review.record_id AND progress.is_complete = 1
        ) section_counts
        WHERE review.archived_at IS NULL AND record.archived_at IS NULL
          AND (
              @canViewUco = 1
              OR review.lecturer_staff_id = @currentStaffId
              OR review.observer_staff_id = @currentStaffId
              OR lecturer.line_manager_staff_id = @currentStaffId
          )
        """;

    private static object DbValue(int? value) => value.HasValue ? value.Value : DBNull.Value;
    private static object DbValue(DateTimeOffset? value) => value.HasValue ? value.Value : DBNull.Value;

    private sealed record UcoLockedState(
        string Status,
        Guid LecturerStaffId,
        Guid ObserverStaffId,
        Guid FormSubmissionId,
        DateTimeOffset? ProfessionalDiscussionAt);

    private sealed record UcoTlaRow(
        Guid RecordId,
        string Title,
        string AcademicYear,
        string Status,
        Guid LecturerStaffId,
        string LecturerName,
        Guid ObserverStaffId,
        string ObserverName,
        DateTimeOffset? ObservationAt,
        string? CourseTitle,
        string? ModuleTitle,
        DateTimeOffset? ProfessionalDiscussionAt,
        DateTimeOffset? FollowUpAt,
        string? FollowUpStatus,
        int OpenActionCount,
        int OverdueActionCount,
        byte[] RowVersion,
        bool IsLineManager,
        Guid FormSubmissionId,
        string? SessionType,
        string? CourseLevel,
        int? NumberRegistered,
        int? NumberPresent,
        int? NumberLate,
        Guid? ProbationObservationId,
        Guid? ParentReviewRecordId,
        DateTimeOffset? LecturerAcknowledgedAt,
        string? LecturerSignatoryName,
        DateTimeOffset? ObserverSignedAt,
        string? ObserverSignatoryName,
        DateTimeOffset? ReopenedAt,
        string? ReopenReason,
        int CompletedSectionCount);
}

public sealed class UcoTlaConcurrencyException : Exception
{
    public UcoTlaConcurrencyException()
        : base("This UCO TLA Review changed since you opened it. Refresh and try again.")
    {
    }
}
