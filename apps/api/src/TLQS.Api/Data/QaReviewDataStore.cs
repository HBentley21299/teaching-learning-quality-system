using System.Text.Json;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    public async Task<QaHubSummary> GetQaHubSummaryAsync(CurrentUser user, CancellationToken cancellationToken)
    {
        if (!QaReviewPolicy.HasHubPermission(user))
            return new QaHubSummary(false, false, false, 0, 0, []);

        var reviews = await QueryAsync(
            QaReviewListSql,
            command => AddQaAccessParameters(command, user),
            reader => MapQaReviewSummary(reader, user),
            cancellationToken);
        var visible = reviews.Where(review => review.Status != "archived").ToArray();
        var available = visible.Count(review => review.Status is "open" or "reopened" or "closed");
        var canAccess = user.HasPermission(PermissionKeys.QaReviewsViewAll)
            || user.HasPermission(PermissionKeys.QaReviewsViewScoped)
            || visible.Any(review => review.Status is "open" or "reopened" or "closed");
        var canUseActionMonitoring = await CanUseQaActionMonitoringAsync(user, cancellationToken);
        return new QaHubSummary(
            canAccess,
            QaReviewPolicy.CanManage(user),
            canUseActionMonitoring,
            visible.Count(review => review.Status is "open" or "reopened"),
            available,
            canAccess ? visible : []);
    }

    public async Task<IReadOnlyList<QaActivityTypeSummary>> GetQaActivityTypesAsync(CancellationToken cancellationToken)
    {
        var rows = await QueryAsync(
            """
            SELECT activity.id, activity.activity_key, activity.name, activity.description,
                   activity.display_order, activity.is_active,
                   template.id, template.template_key, template.name, template.description,
                   template.is_active, template.row_version,
                   (SELECT COUNT(*) FROM qa.activity_template_questions mapping WHERE mapping.activity_template_id = template.id)
            FROM qa.activity_types activity
            LEFT JOIN qa.activity_templates template ON template.activity_type_id = activity.id AND template.archived_at IS NULL
            WHERE activity.archived_at IS NULL
            ORDER BY activity.display_order, template.name;
            """,
            reader => new QaActivityTemplateRow(
                reader.GetGuid(0), reader.GetString(1), reader.GetString(2), GetStringOrNull(reader, 3),
                reader.GetInt32(4), reader.GetBoolean(5), GetGuidOrNull(reader, 6), GetStringOrNull(reader, 7),
                GetStringOrNull(reader, 8), GetStringOrNull(reader, 9),
                reader.IsDBNull(10) ? null : reader.GetBoolean(10),
                reader.IsDBNull(11) ? null : reader.GetFieldValue<byte[]>(11),
                reader.IsDBNull(12) ? 0 : reader.GetInt32(12)),
            cancellationToken);

        return rows.GroupBy(row => new { row.ActivityTypeId, row.ActivityKey, row.ActivityName, row.ActivityDescription, row.DisplayOrder, row.ActivityActive })
            .Select(group => new QaActivityTypeSummary(
                group.Key.ActivityTypeId,
                group.Key.ActivityKey,
                group.Key.ActivityName,
                group.Key.ActivityDescription,
                group.Key.DisplayOrder,
                group.Key.ActivityActive,
                group.Where(row => row.TemplateId.HasValue).Select(row => new QaActivityTemplateSummary(
                    row.TemplateId!.Value, row.ActivityTypeId, row.TemplateKey!, row.TemplateName!,
                    row.TemplateDescription, row.TemplateActive!.Value, row.QuestionCount, row.TemplateRowVersion!)).ToArray()))
            .ToArray();
    }

    public async Task<IReadOnlyList<QaQuestionSummary>> GetQaQuestionsAsync(
        Guid? activityTypeId,
        bool includeInactive,
        CancellationToken cancellationToken)
    {
        return await QueryAsync(
            """
            WITH latest AS (
                SELECT version.*, ROW_NUMBER() OVER (PARTITION BY version.question_id ORDER BY version.version_number DESC) AS ordinal
                FROM qa.question_versions version
            )
            SELECT question.id, question.activity_type_id, activity.activity_key, activity.name,
                   version.version_number, version.theme_or_week, version.question_text, version.guidance,
                   question.default_display_order, version.is_required, version.allows_not_applicable,
                   version.comment_required_at_expected, version.is_active, version.source_status,
                   version.question_tag, version.created_at
            FROM qa.questions question
            JOIN qa.activity_types activity ON activity.id = question.activity_type_id
            JOIN latest version ON version.question_id = question.id AND version.ordinal = 1
            WHERE question.archived_at IS NULL
              AND (@activityTypeId IS NULL OR question.activity_type_id = @activityTypeId)
              AND (@includeInactive = 1 OR (version.is_active = 1 AND version.source_status = N'active' AND question.is_retired = 0))
            ORDER BY activity.display_order, question.default_display_order, version.question_text;
            """,
            command =>
            {
                command.Parameters.AddWithValue("@activityTypeId", ToDbValue(activityTypeId));
                command.Parameters.AddWithValue("@includeInactive", includeInactive);
            },
            MapQaQuestion,
            cancellationToken);
    }

    public async Task<QaQuestionSummary> SaveQaQuestionAsync(
        Guid? questionId,
        SaveQaQuestionRequest request,
        CurrentUser user,
        CancellationToken cancellationToken)
    {
        ValidateQaQuestion(request);
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(cancellationToken);
        var id = questionId ?? Guid.NewGuid();
        var nextVersion = 1;
        string? previousSourceStatus = null;
        if (questionId.HasValue)
        {
            await using var read = new SqlCommand(
                """
                SELECT question.activity_type_id, ISNULL(MAX(version.version_number), 0) + 1,
                       (SELECT TOP (1) latest.source_status FROM qa.question_versions latest
                        WHERE latest.question_id = question.id ORDER BY latest.version_number DESC)
                FROM qa.questions question LEFT JOIN qa.question_versions version ON version.question_id = question.id
                WHERE question.id = @id GROUP BY question.id, question.activity_type_id;
                """,
                connection, transaction);
            read.Parameters.AddWithValue("@id", id);
            await using var versionReader = await read.ExecuteReaderAsync(cancellationToken);
            if (!await versionReader.ReadAsync(cancellationToken)) throw new WorkflowValidationException("The QA question was not found.");
            if (versionReader.GetGuid(0) != request.ActivityTypeId)
                throw new WorkflowValidationException("A stable QA question cannot move to a different activity. Create a new question instead.");
            nextVersion = versionReader.GetInt32(1);
            previousSourceStatus = GetStringOrNull(versionReader, 2);
            await versionReader.DisposeAsync();
        }
        else
        {
            await using var create = new SqlCommand(
                """
                INSERT INTO qa.questions (id, activity_type_id, question_key, default_display_order)
                VALUES (@id, @activityTypeId, @questionKey, @displayOrder);
                """, connection, transaction);
            create.Parameters.AddWithValue("@id", id);
            create.Parameters.AddWithValue("@activityTypeId", request.ActivityTypeId);
            create.Parameters.AddWithValue("@questionKey", $"qa_custom_{id:N}");
            create.Parameters.AddWithValue("@displayOrder", request.DisplayOrder);
            await create.ExecuteNonQueryAsync(cancellationToken);
        }

        await using (var command = new SqlCommand(
            """
            INSERT INTO qa.question_versions (
                question_id, version_number, theme_or_week, question_text, guidance,
                is_required, allows_not_applicable, comment_required_at_expected,
                is_active, source_status, question_tag, created_by_user_account_id
            ) VALUES (
                @questionId, @version, @theme, @text, @guidance,
                @required, @allowsNa, @commentAt, @active, @sourceStatus, @questionTag, @userAccountId
            );
            UPDATE qa.questions
            SET default_display_order = @displayOrder,
                is_retired = CASE WHEN @active = 1 AND @sourceStatus = N'active' THEN 0 ELSE 1 END
            WHERE id = @questionId;
            """, connection, transaction))
        {
            command.Parameters.AddWithValue("@questionId", id);
            command.Parameters.AddWithValue("@version", nextVersion);
            command.Parameters.AddWithValue("@activityTypeId", request.ActivityTypeId);
            command.Parameters.AddWithValue("@theme", ToDbValue(request.ThemeOrWeek));
            command.Parameters.AddWithValue("@text", request.QuestionText.Trim());
            command.Parameters.AddWithValue("@guidance", ToDbValue(request.Guidance));
            command.Parameters.AddWithValue("@displayOrder", request.DisplayOrder);
            command.Parameters.AddWithValue("@required", request.IsRequired);
            command.Parameters.AddWithValue("@allowsNa", request.AllowsNotApplicable);
            command.Parameters.AddWithValue("@commentAt", request.CommentRequiredAtExpected);
            command.Parameters.AddWithValue("@active", request.IsActive);
            command.Parameters.AddWithValue("@sourceStatus", request.SourceStatus.Trim().ToLowerInvariant());
            command.Parameters.AddWithValue("@questionTag", NormalizeQaTag(request.QuestionTag));
            command.Parameters.AddWithValue("@userAccountId", ToDbValue(user.UserAccountId));
            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        var nextSourceStatus = request.SourceStatus.Trim().ToLowerInvariant();
        var auditAction = !questionId.HasValue ? "created"
            : nextSourceStatus == "inactive" ? "archived"
            : previousSourceStatus == "inactive" && nextSourceStatus == "active" ? "restored"
            : "versioned";
        var auditSummary = auditAction switch
        {
            "created" => "Created a QA question.",
            "archived" => $"Archived QA question as version {nextVersion}.",
            "restored" => $"Restored QA question as version {nextVersion}.",
            _ => $"Created QA question version {nextVersion}."
        };
        await WriteAuditAsync(connection, transaction, user.UserAccountId, null, "qa_question", id,
            auditAction, auditSummary,
            null, JsonSerializer.Serialize(request), cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        var questions = await GetQaQuestionsAsync(request.ActivityTypeId, true, cancellationToken);
        return questions.Single(question => question.Id == id);
    }

    public async Task<QaReviewDetail?> GetQaReviewAsync(Guid reviewId, CurrentUser user, CancellationToken cancellationToken)
    {
        var summaries = await QueryAsync(
            QaReviewListSql + " AND record.id = @reviewId",
            command =>
            {
                AddQaAccessParameters(command, user);
                command.Parameters.AddWithValue("@reviewId", reviewId);
            },
            reader => MapQaReviewSummary(reader, user),
            cancellationToken);
        var summary = summaries.SingleOrDefault();
        if (summary is null) return null;

        var metadata = (await QueryAsync(
            "SELECT review.question_tag, record.owner_staff_id FROM qa.reviews review JOIN core.records record ON record.id = review.record_id WHERE review.record_id = @id;",
            command => command.Parameters.AddWithValue("@id", reviewId),
            reader => new { QuestionTag = reader.GetString(0), OwnerId = reader.GetGuid(1) },
            cancellationToken)).Single();
        var scope = await GetQaReviewScopeAsync(reviewId, user, cancellationToken);
        var activities = await GetQaReviewActivitiesAsync(reviewId, summary.Status != "draft", cancellationToken);
        var evidence = await GetQaEvidenceListAsync(reviewId, user, cancellationToken);
        var formAccess = await GetQaFormSubmissionAccessAsync(reviewId, user, cancellationToken);
        activities = activities.Select(activity => activity with { CanSubmitEvidence = summary.Capabilities.CanSubmitEvidence && formAccess.GetValueOrDefault(activity.Id) }).ToArray();
        evidence = evidence.Select(item => item with { CanEdit = item.CanEdit && formAccess.GetValueOrDefault(item.ReviewActivityId) }).ToArray();
        var validation = summary.Capabilities.CanClose ? await GetQaCloseValidationAsync(reviewId, user, cancellationToken) : null;
        return new QaReviewDetail(summary, metadata.QuestionTag, metadata.OwnerId,
            scope, activities, evidence, validation);
    }

    public async Task<Guid> SaveQaReviewAsync(
        Guid? reviewId,
        SaveQaReviewRequest request,
        CurrentUser user,
        CancellationToken cancellationToken)
    {
        ValidateQaReview(request);
        if (!QaReviewPolicy.CanManage(user)) throw new WorkflowValidationException("You do not have permission to manage QA Reviews.");
        if (!user.UserAccountId.HasValue) throw new WorkflowValidationException("A linked account is required.");
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(cancellationToken);
        var id = reviewId ?? Guid.NewGuid();
        var before = (string?)null;
        SaveQaReviewRequest? publishedConfiguration = null;

        if (reviewId.HasValue)
        {
            await using var statusCommand = new SqlCommand(
                "SELECT status FROM qa.reviews WITH (UPDLOCK, ROWLOCK) WHERE record_id = @id AND row_version = @rowVersion;", connection, transaction);
            statusCommand.Parameters.AddWithValue("@id", id);
            statusCommand.Parameters.Add("@rowVersion", System.Data.SqlDbType.Timestamp, 8).Value = request.RowVersion
                ?? throw new WorkflowValidationException("The review row version is required.");
            var status = await statusCommand.ExecuteScalarAsync(cancellationToken) as string
                ?? throw new WorkflowValidationException("This QA Review changed since you opened it, or is no longer available. Refresh and try again.");
            if (!QaReviewPolicy.CanConfigure(user, status))
                throw new WorkflowValidationException(status == "closed"
                    ? "Reopen this QA Review before changing its details or adding teams."
                    : "This QA Review cannot be edited.");

            var existing = await ReadQaReviewConfigurationAsync(connection, transaction, id, status != "draft", cancellationToken);
            before = JsonSerializer.Serialize(existing);
            if (status != "draft")
            {
                QaReviewPolicy.ValidatePublishedStructure(ToQaPublishedStructure(existing), ToQaPublishedStructure(request));
                publishedConfiguration = existing;
            }

            await using var update = new SqlCommand(
                """
                UPDATE record SET title = @title, owner_staff_id = @owner,
                       record_date = @closingDate, academic_year_key = @academicYear,
                       updated_by_user_account_id = @user, updated_at = sysutcdatetime()
                FROM core.records record JOIN qa.reviews review ON review.record_id = record.id
                WHERE record.id = @id AND review.row_version = @rowVersion;
                UPDATE qa.reviews SET review_theme = @theme, question_tag = @questionTag,
                       planned_open_date = @openDate, closing_date = @closingDate, updated_at = sysutcdatetime()
                WHERE record_id = @id AND row_version = @rowVersion;
                """, connection, transaction);
            AddQaReviewParameters(update, id, request, user.UserAccountId.Value);
            update.Parameters.Add("@rowVersion", System.Data.SqlDbType.Timestamp, 8).Value = request.RowVersion
                ?? throw new WorkflowValidationException("The review row version is required.");
            if (await update.ExecuteNonQueryAsync(cancellationToken) < 2)
                throw new WorkflowValidationException("This QA Review changed since you opened it. Refresh and try again.");

            if (publishedConfiguration is null)
            {
                await using var clear = new SqlCommand(
                    """
                    DELETE selection FROM qa.review_question_selections selection
                    JOIN qa.review_activities activity ON activity.id = selection.review_activity_id WHERE activity.review_id = @id;
                    DELETE FROM qa.review_activities WHERE review_id = @id;
                    DELETE FROM qa.review_scopes WHERE review_id = @id;
                    UPDATE qa.review_contributors SET is_active = 0, active_to = sysutcdatetime()
                    WHERE review_id = @id AND active_to IS NULL;
                    """, connection, transaction);
                clear.Parameters.AddWithValue("@id", id);
                await clear.ExecuteNonQueryAsync(cancellationToken);
            }
        }
        else
        {
            await using var create = new SqlCommand(
                """
                INSERT INTO core.records (
                    id, module_id, record_type, title, summary, owner_staff_id, record_date,
                    academic_year_key, created_by_user_account_id, updated_by_user_account_id
                )
                SELECT @id, module.id, N'qa_review', @title, NULL, @owner, @closingDate,
                       @academicYear, @user, @user
                FROM core.modules module WHERE module.module_key = N'qa_reviews';
                INSERT INTO qa.reviews (
                    record_id, review_theme, question_tag, planned_open_date, closing_date
                ) VALUES (@id, @theme, @questionTag, @openDate, @closingDate);
                """, connection, transaction);
            AddQaReviewParameters(create, id, request, user.UserAccountId.Value);
            if (await create.ExecuteNonQueryAsync(cancellationToken) != 2)
                throw new WorkflowValidationException("The QA Reviews module is not registered. Apply migration 063.");
        }

        if (publishedConfiguration is null)
            await InsertQaReviewConfigurationAsync(connection, transaction, id, request, user, cancellationToken);
        else
            await InsertQaReviewScopesAsync(connection, transaction, id,
                request.TeamOrgUnitIds.Except(publishedConfiguration.TeamOrgUnitIds), cancellationToken);
        await WriteAuditAsync(connection, transaction, user.UserAccountId, id, "qa_review", id,
            reviewId.HasValue ? "updated" : "created", publishedConfiguration is not null
                ? "Updated published QA Review details and team scope; existing evidence and question snapshots retained."
                : reviewId.HasValue ? "Updated QA Review configuration." : "Created QA Review draft.",
            before, JsonSerializer.Serialize(request), cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return id;
    }

    public async Task<QaReviewDetail> TransitionQaReviewAsync(
        Guid reviewId,
        string action,
        QaLifecycleRequest request,
        CurrentUser user,
        CancellationToken cancellationToken)
    {
        if (!user.UserAccountId.HasValue) throw new WorkflowValidationException("A linked account is required.");
        var normalizedAction = action.Trim().ToLowerInvariant();
        if (normalizedAction is "close" or "reopen" or "archive" && string.IsNullOrWhiteSpace(request.Reason))
            throw new WorkflowValidationException(normalizedAction == "close" ? "Add a closure note." : $"Add a reason to {normalizedAction} this review.");

        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(cancellationToken);
        string currentStatus;
        await using (var read = new SqlCommand(
            "SELECT status FROM qa.reviews WITH (UPDLOCK, ROWLOCK) WHERE record_id = @id AND row_version = @rowVersion;",
            connection, transaction))
        {
            read.Parameters.AddWithValue("@id", reviewId);
            read.Parameters.Add("@rowVersion", System.Data.SqlDbType.Timestamp, 8).Value = request.RowVersion;
            currentStatus = await read.ExecuteScalarAsync(cancellationToken) as string
                ?? throw new WorkflowValidationException("This QA Review changed since you opened it. Refresh and try again.");
        }
        var nextStatus = QaReviewPolicy.StatusAfter(currentStatus, normalizedAction);
        if (normalizedAction == "open")
        {
            await ValidateQaReviewReadyToOpenAsync(connection, transaction, reviewId, cancellationToken);
            await using var freeze = new SqlCommand(
                """
                INSERT INTO qa.review_questions (
                    review_activity_id, source_question_id, source_question_version_id, source_version_number,
                    theme_or_week, question_tag, question_text, guidance, display_order, is_required,
                    allows_not_applicable, comment_required_at_expected
                )
                SELECT selection.review_activity_id, question.id, version.id, version.version_number,
                       version.theme_or_week, version.question_tag, version.question_text, version.guidance, selection.display_order,
                       version.is_required, version.allows_not_applicable, version.comment_required_at_expected
                FROM qa.review_question_selections selection
                JOIN qa.review_activities activity ON activity.id = selection.review_activity_id
                JOIN qa.questions question ON question.id = selection.question_id
                CROSS APPLY (
                    SELECT TOP (1) question_version.* FROM qa.question_versions question_version
                    WHERE question_version.question_id = question.id
                      AND question_version.is_active = 1 AND question_version.source_status = N'active'
                    ORDER BY question_version.version_number DESC
                ) version
                WHERE activity.review_id = @id
                  AND NOT EXISTS (
                      SELECT 1 FROM qa.review_questions frozen
                      WHERE frozen.review_activity_id = selection.review_activity_id
                        AND frozen.source_question_id = selection.question_id
                  );
                """, connection, transaction);
            freeze.Parameters.AddWithValue("@id", reviewId);
            await freeze.ExecuteNonQueryAsync(cancellationToken);
        }

        await using (var update = new SqlCommand(
            """
            UPDATE qa.reviews
            SET status = @status, updated_at = sysutcdatetime(),
                opened_at = CASE WHEN @action = N'open' THEN sysutcdatetime() ELSE opened_at END,
                opened_by_user_account_id = CASE WHEN @action = N'open' THEN @user ELSE opened_by_user_account_id END,
                closed_at = CASE WHEN @action = N'close' THEN sysutcdatetime() ELSE closed_at END,
                closed_by_user_account_id = CASE WHEN @action = N'close' THEN @user ELSE closed_by_user_account_id END,
                closure_note = CASE WHEN @action = N'close' THEN @reason ELSE closure_note END,
                reopened_at = CASE WHEN @action = N'reopen' THEN sysutcdatetime() ELSE reopened_at END,
                reopened_by_user_account_id = CASE WHEN @action = N'reopen' THEN @user ELSE reopened_by_user_account_id END,
                archived_at = CASE WHEN @action = N'archive' THEN sysutcdatetime() ELSE archived_at END
            WHERE record_id = @id;
            UPDATE core.records SET updated_at = sysutcdatetime(), updated_by_user_account_id = @user,
                archived_at = CASE WHEN @action = N'archive' THEN sysutcdatetime() ELSE archived_at END
            WHERE id = @id;
            """, connection, transaction))
        {
            update.Parameters.AddWithValue("@id", reviewId);
            update.Parameters.AddWithValue("@status", nextStatus);
            update.Parameters.AddWithValue("@action", normalizedAction);
            update.Parameters.AddWithValue("@reason", ToDbValue(request.Reason));
            update.Parameters.AddWithValue("@user", user.UserAccountId.Value);
            await update.ExecuteNonQueryAsync(cancellationToken);
        }

        if (normalizedAction == "close")
        {
            var dashboard = await BuildQaDashboardAsync(connection, transaction, reviewId, user, cancellationToken);
            await using var snapshot = new SqlCommand(
                """
                DECLARE @version int = ISNULL((SELECT MAX(version_number) FROM qa.dashboard_snapshots WHERE review_id = @id), 0) + 1;
                INSERT INTO qa.dashboard_snapshots (review_id, version_number, dashboard_json, created_by_user_account_id)
                VALUES (@id, @version, @json, @user);
                """, connection, transaction);
            snapshot.Parameters.AddWithValue("@id", reviewId);
            snapshot.Parameters.AddWithValue("@json", JsonSerializer.Serialize(dashboard));
            snapshot.Parameters.AddWithValue("@user", user.UserAccountId.Value);
            await snapshot.ExecuteNonQueryAsync(cancellationToken);
        }

        await InsertDomainEventAsync(connection, transaction, $"qa_review.{PastTense(normalizedAction)}", "qa_review",
            reviewId, reviewId, JsonSerializer.Serialize(new { reviewId, status = nextStatus, reason = request.Reason }),
            user.UserAccountId, cancellationToken);
        await WriteAuditWithReasonAsync(connection, transaction, user.UserAccountId, reviewId, "qa_review", reviewId,
            normalizedAction, $"QA Review {PastTense(normalizedAction)}.",
            JsonSerializer.Serialize(new { status = currentStatus }), JsonSerializer.Serialize(new { status = nextStatus }),
            request.Reason, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return await GetQaReviewAsync(reviewId, user, cancellationToken)
            ?? throw new WorkflowValidationException("The QA Review is no longer available.");
    }

    public async Task<QaActivityTemplateSummary> DuplicateQaTemplateAsync(
        Guid templateId,
        DuplicateQaTemplateRequest request,
        CurrentUser user,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Name) || request.Name.Trim().Length > 250)
            throw new WorkflowValidationException("Enter a template name of no more than 250 characters.");
        var id = Guid.NewGuid();
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(cancellationToken);
        await using (var command = new SqlCommand(
            """
            INSERT INTO qa.activity_templates (id, activity_type_id, template_key, name, description, created_by_user_account_id, allows_not_seen, restrict_qa_staff)
            SELECT @id, source.activity_type_id, @key, @name, @description, @user, source.allows_not_seen, source.restrict_qa_staff
            FROM qa.activity_templates source WITH (HOLDLOCK) WHERE source.id = @source AND source.archived_at IS NULL;
            INSERT INTO qa.activity_template_questions (activity_template_id, question_id, display_order)
            SELECT @id, mapping.question_id, mapping.display_order FROM qa.activity_template_questions mapping WHERE mapping.activity_template_id = @source;
            INSERT INTO qa.activity_template_staff (activity_template_id, staff_id)
            SELECT @id, staff_id FROM qa.activity_template_staff WHERE activity_template_id = @source;
            """, connection, transaction))
        {
            command.Parameters.AddWithValue("@id", id);
            command.Parameters.AddWithValue("@source", templateId);
            command.Parameters.AddWithValue("@key", $"qa_custom_{id:N}");
            command.Parameters.AddWithValue("@name", request.Name.Trim());
            command.Parameters.AddWithValue("@description", ToDbValue(request.Description));
            command.Parameters.AddWithValue("@user", ToDbValue(user.UserAccountId));
            if (await command.ExecuteNonQueryAsync(cancellationToken) < 1)
                throw new WorkflowValidationException("The source template was not found.");
        }
        await WriteAuditAsync(connection, transaction, user.UserAccountId, null, "qa_activity_template", id,
            "duplicated", "Duplicated a QA activity template.", null,
            JsonSerializer.Serialize(new { sourceTemplateId = templateId, request.Name }), cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        var activity = (await GetQaActivityTypesAsync(cancellationToken)).Single(item => item.Templates.Any(template => template.Id == id));
        return activity.Templates.Single(template => template.Id == id);
    }

    public async Task<QaEvidenceDetail> SaveQaEvidenceAsync(
        Guid reviewId,
        Guid? evidenceId,
        SaveQaEvidenceRequest request,
        bool submit,
        CurrentUser user,
        CancellationToken cancellationToken)
    {
        if (!user.UserAccountId.HasValue || !user.StaffId.HasValue)
            throw new WorkflowValidationException("A linked staff account is required.");
        var outcomeLabels = (await GetQaOutcomeLabelsAsync(cancellationToken)).Labels;
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(cancellationToken);
        var teamIds = (request.TeamOrgUnitIds is { Count: > 0 } ? request.TeamOrgUnitIds : [request.TeamOrgUnitId]).Distinct().ToArray();
        var formAccess = await ReadQaFormSubmissionAccessAsync(connection, transaction, reviewId, user, cancellationToken);
        if (!formAccess.GetValueOrDefault(request.ReviewActivityId))
            throw new UnauthorizedAccessException("You do not have access to complete this QA form. Ask a QA administrator to check its staff whitelist.");
        if (teamIds.Length == 0 || teamIds.Length > 250)
            throw new WorkflowValidationException("Select between 1 and 250 teams for this evidence submission.");
        QaEvidenceAccess? access = null;
        foreach (var teamId in teamIds)
        {
            var teamAccess = await ReadQaEvidenceAccessAsync(connection, transaction, reviewId, teamId, request.ReviewActivityId, user, cancellationToken);
            if (!teamAccess.CanSubmit || !QaReviewPolicy.IsEvidenceWritable(teamAccess.ReviewStatus))
                throw new WorkflowValidationException("Evidence can only be saved in an Open or Reopened review within your assigned scope.");
            access ??= teamAccess;
        }

        var questions = await ReadQaEvidenceQuestionsAsync(connection, transaction, request.ReviewActivityId, evidenceId, cancellationToken);
        if (questions.Count == 0) throw new WorkflowValidationException("The selected activity has no frozen questions.");
        if (request.Responses.GroupBy(response => response.ReviewQuestionId).Any(group => group.Count() > 1)
            || request.Responses.Any(response => questions.All(question => question.Id != response.ReviewQuestionId)))
            throw new WorkflowValidationException("Every evidence response must identify one frozen question from the selected activity.");
        var requestResponses = request.Responses.ToDictionary(response => response.ReviewQuestionId);
        foreach (var question in questions)
        {
            requestResponses.TryGetValue(question.Id, out var response);
            var error = QaReviewPolicy.ValidateResponse(question.IsRequired, question.AllowsNotApplicable,
                question.CommentRequiredAtExpected, response?.Outcome, response?.Comment, response?.NotApplicableReason, submit, outcomeLabels,
                question.AllowsNotSeen, question.SavedOutcome);
            if (error is not null) throw new WorkflowValidationException($"{question.QuestionText}: {error}");
        }

        var id = evidenceId ?? Guid.NewGuid();
        var wasSubmitted = false;
        var ownerAccountId = user.UserAccountId.Value;
        var version = 1;
        if (evidenceId.HasValue)
        {
            await using var read = new SqlCommand(
                "SELECT status, created_by_user_account_id, version_number, review_activity_id FROM qa.evidence_submissions WITH (UPDLOCK, ROWLOCK) WHERE record_id = @id AND review_id = @reviewId AND removed_at IS NULL;",
                connection, transaction);
            read.Parameters.AddWithValue("@id", id);
            read.Parameters.AddWithValue("@reviewId", reviewId);
            await using var reader = await read.ExecuteReaderAsync(cancellationToken);
            if (!await reader.ReadAsync(cancellationToken)) throw new WorkflowValidationException("The QA evidence was not found.");
            wasSubmitted = reader.GetString(0) == "submitted";
            ownerAccountId = reader.GetGuid(1);
            version = reader.GetInt32(2);
            if (!formAccess.GetValueOrDefault(reader.GetGuid(3)))
                throw new UnauthorizedAccessException("You no longer have access to edit this QA form. Ask a QA administrator to check its staff whitelist.");
            await reader.DisposeAsync();
            if (ownerAccountId != user.UserAccountId && !QaReviewPolicy.CanCorrect(user))
                throw new UnauthorizedAccessException("You cannot edit another reviewer's evidence.");
            if (wasSubmitted && string.IsNullOrWhiteSpace(request.CorrectionReason))
                throw new WorkflowValidationException("Add an audit reason for changing submitted evidence.");
            if (request.RowVersion is null) throw new WorkflowValidationException("The evidence row version is required.");
        }

        var deliveryArea = await ResolveQaEvidenceDeliveryAreaAsync(connection, transaction,
            evidenceId, request.DeliveryAreaKey, submit && !wasSubmitted, cancellationToken);
        var nextVersion = wasSubmitted || submit ? version + (wasSubmitted ? 1 : 0) : version;
        if (!evidenceId.HasValue)
        {
            await using var create = new SqlCommand(
                """
                INSERT INTO core.records (
                    id, module_id, record_type, title, summary, subject_staff_id, owner_staff_id,
                    org_unit_id, record_date, academic_year_key, created_by_user_account_id, updated_by_user_account_id
                )
                SELECT @id, module.id, N'qa_evidence', @title, @context, @subject, @reviewer,
                       @team, CONVERT(date, @activityAt), review_record.academic_year_key, @user, @user
                FROM core.modules module
                JOIN core.records review_record ON review_record.id = @reviewId
                WHERE module.module_key = N'qa_reviews';
                INSERT INTO qa.evidence_submissions (
                    record_id, review_id, review_activity_id, faculty_org_unit_id, team_org_unit_id,
                    faculty_code_snapshot, faculty_name_snapshot, team_code_snapshot, team_name_snapshot,
                    course_programme, course_level, delivery_area_key, delivery_area_name_snapshot,
                    subject_staff_id, reviewer_staff_id, activity_at, sample_size,
                    contextual_notes, evidence_links_json, key_strengths, areas_for_improvement,
                    recommended_actions, additional_context, status, submitted_at, submitted_by_user_account_id,
                    version_number, created_by_user_account_id, updated_by_user_account_id
                )
                SELECT @id, @reviewId, @activity, team.parent_org_unit_id, team.id,
                       faculty.code, faculty.name, team.code, team.name,
                       @programme, @level, @deliveryAreaKey, @deliveryAreaName,
                       @subject, @reviewer, @activityAt, @sampleSize,
                       @context, @links, @strengths, @improvements, @actions, @additional,
                       @status, CASE WHEN @submit = 1 THEN sysutcdatetime() END,
                       CASE WHEN @submit = 1 THEN @user END, @version, @user, @user
                FROM org.org_units team JOIN org.org_units faculty ON faculty.id = team.parent_org_unit_id
                WHERE team.id = @team;
                """, connection, transaction);
            AddQaEvidenceParameters(create, id, reviewId, request with { TeamOrgUnitId = teamIds[0] }, user, submit, nextVersion, access!.ActivityName);
            AddQaDeliveryAreaParameters(create, deliveryArea);
            if (await create.ExecuteNonQueryAsync(cancellationToken) != 2)
                throw new WorkflowValidationException("Select a current team with a faculty parent.");
        }
        else
        {
            await using var update = new SqlCommand(
                """
                UPDATE evidence SET review_activity_id = @activity, faculty_org_unit_id = team.parent_org_unit_id,
                    team_org_unit_id = team.id, faculty_code_snapshot = faculty.code,
                    faculty_name_snapshot = faculty.name, team_code_snapshot = team.code, team_name_snapshot = team.name,
                    course_programme = @programme, course_level = @level,
                    delivery_area_key = @deliveryAreaKey, delivery_area_name_snapshot = @deliveryAreaName,
                    subject_staff_id = @subject,
                    activity_at = @activityAt, sample_size = @sampleSize, contextual_notes = @context,
                    evidence_links_json = @links, key_strengths = @strengths, areas_for_improvement = @improvements,
                    recommended_actions = @actions, additional_context = @additional,
                    status = CASE WHEN @submit = 1 THEN N'submitted' ELSE evidence.status END,
                    submitted_at = CASE WHEN @submit = 1 THEN sysutcdatetime() ELSE evidence.submitted_at END,
                    submitted_by_user_account_id = CASE WHEN @submit = 1 THEN @user ELSE evidence.submitted_by_user_account_id END,
                    version_number = @version, updated_by_user_account_id = @user, updated_at = sysutcdatetime()
                FROM qa.evidence_submissions evidence
                JOIN org.org_units team ON team.id = @team
                JOIN org.org_units faculty ON faculty.id = team.parent_org_unit_id
                WHERE evidence.record_id = @id AND evidence.row_version = @rowVersion;
                UPDATE core.records SET title = @title, summary = @context, subject_staff_id = @subject,
                    org_unit_id = @team, record_date = CONVERT(date, @activityAt),
                    updated_by_user_account_id = @user, updated_at = sysutcdatetime()
                WHERE id = @id;
                """, connection, transaction);
            AddQaEvidenceParameters(update, id, reviewId, request with { TeamOrgUnitId = teamIds[0] }, user, submit, nextVersion, access!.ActivityName);
            AddQaDeliveryAreaParameters(update, deliveryArea);
            update.Parameters.Add("@rowVersion", System.Data.SqlDbType.Timestamp, 8).Value = request.RowVersion!;
            if (await update.ExecuteNonQueryAsync(cancellationToken) < 2)
                throw new WorkflowValidationException("This evidence changed since you opened it. Refresh and try again.");
            await using var clear = new SqlCommand("DELETE FROM qa.evidence_responses WHERE evidence_record_id = @id;", connection, transaction);
            clear.Parameters.AddWithValue("@id", id);
            await clear.ExecuteNonQueryAsync(cancellationToken);
        }

        await SyncQaEvidenceTeamScopesAsync(connection, transaction, id, reviewId, teamIds, cancellationToken);

        foreach (var response in request.Responses.Where(item => questions.Any(question => question.Id == item.ReviewQuestionId)))
        {
            await using var insert = new SqlCommand(
                """
                INSERT INTO qa.evidence_responses (evidence_record_id, review_question_id, outcome, comment, not_applicable_reason)
                VALUES (@evidence, @question, @outcome, @comment, @reason);
                """, connection, transaction);
            insert.Parameters.AddWithValue("@evidence", id);
            insert.Parameters.AddWithValue("@question", response.ReviewQuestionId);
            insert.Parameters.AddWithValue("@outcome", ToDbValue(response.Outcome?.Trim().ToLowerInvariant()));
            insert.Parameters.AddWithValue("@comment", ToDbValue(response.Comment));
            insert.Parameters.AddWithValue("@reason", ToDbValue(response.NotApplicableReason));
            await insert.ExecuteNonQueryAsync(cancellationToken);
        }

        if (submit || wasSubmitted)
        {
            var snapshotJson = JsonSerializer.Serialize(new { request, status = submit ? "submitted" : "corrected", version = nextVersion });
            await using var revision = new SqlCommand(
                """
                INSERT INTO qa.evidence_revisions (evidence_record_id, version_number, snapshot_json, reason, created_by_user_account_id)
                VALUES (@id, @version, @json, @reason, @user);
                """, connection, transaction);
            revision.Parameters.AddWithValue("@id", id);
            revision.Parameters.AddWithValue("@version", nextVersion);
            revision.Parameters.AddWithValue("@json", snapshotJson);
            revision.Parameters.AddWithValue("@reason", ToDbValue(request.CorrectionReason));
            revision.Parameters.AddWithValue("@user", user.UserAccountId.Value);
            await revision.ExecuteNonQueryAsync(cancellationToken);
        }

        await WriteAuditWithReasonAsync(connection, transaction, user.UserAccountId, id, "qa_evidence", id,
            submit ? "submitted" : evidenceId.HasValue ? "updated" : "created",
            submit ? "Submitted QA evidence." : evidenceId.HasValue ? "Updated QA evidence." : "Created QA evidence draft.",
            null, JsonSerializer.Serialize(new { reviewId, request.ReviewActivityId, teamOrgUnitIds = teamIds, version = nextVersion }),
            request.CorrectionReason, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return await GetQaEvidenceAsync(id, user, cancellationToken)
            ?? throw new WorkflowValidationException("The saved evidence is no longer available.");
    }

    public async Task<QaEvidenceDetail?> GetQaEvidenceAsync(Guid evidenceId, CurrentUser user, CancellationToken cancellationToken, bool includeEditingMetadata = true)
    {
        var rows = await QueryAsync(
            """
            SELECT evidence.record_id, evidence.review_id, evidence.review_activity_id, activity_type.name,
                   evidence.status, evidence.team_org_unit_id, evidence.faculty_name_snapshot, evidence.team_name_snapshot,
                   evidence.course_programme, evidence.course_level, subject.display_name,
                   evidence.reviewer_staff_id, reviewer.display_name, evidence.activity_at, evidence.sample_size,
                   (SELECT COUNT(*) FROM qa.evidence_responses response WHERE response.evidence_record_id = evidence.record_id),
                   evidence.submitted_at, evidence.version_number, evidence.row_version,
                   evidence.contextual_notes, evidence.evidence_links_json, evidence.key_strengths,
                   evidence.areas_for_improvement, evidence.recommended_actions, evidence.additional_context,
                   evidence.subject_staff_id, evidence.created_by_user_account_id, review.status,
                   CAST(CASE WHEN evidence.created_by_user_account_id = @userAccountId THEN 1 ELSE 0 END AS bit),
                   evidence.delivery_area_key, evidence.delivery_area_name_snapshot
            FROM qa.evidence_submissions evidence
            JOIN qa.reviews review ON review.record_id = evidence.review_id
            JOIN qa.review_activities activity ON activity.id = evidence.review_activity_id
            JOIN qa.activity_types activity_type ON activity_type.id = activity.activity_type_id
            JOIN people.staff reviewer ON reviewer.id = evidence.reviewer_staff_id
            LEFT JOIN people.staff subject ON subject.id = evidence.subject_staff_id
            WHERE evidence.record_id = @id AND evidence.removed_at IS NULL
              AND (
                    @viewAll = 1
                    OR EXISTS (
                        SELECT 1 FROM qa.evidence_team_scopes evidence_scope
                        JOIN org.fn_visible_org_units(@userAccountId) visible
                          ON visible.org_unit_id IN (evidence_scope.team_org_unit_id, evidence_scope.faculty_org_unit_id)
                        WHERE evidence_scope.evidence_record_id = evidence.record_id)
                    OR EXISTS (
                        SELECT 1 FROM qa.evidence_team_scopes evidence_scope
                        JOIN qa.review_contributors contributor ON contributor.review_id = evidence.review_id
                          AND contributor.staff_id = @staffId AND contributor.is_active = 1 AND contributor.active_to IS NULL
                          AND (contributor.assigned_org_unit_id IS NULL
                               OR contributor.assigned_org_unit_id IN (evidence_scope.team_org_unit_id, evidence_scope.faculty_org_unit_id))
                        WHERE evidence_scope.evidence_record_id = evidence.record_id)
                  );
            """,
            command =>
            {
                command.Parameters.AddWithValue("@id", evidenceId);
                command.Parameters.AddWithValue("@userAccountId", ToDbValue(user.UserAccountId));
                command.Parameters.AddWithValue("@staffId", ToDbValue(user.StaffId));
                command.Parameters.AddWithValue("@viewAll", user.HasPermission(PermissionKeys.QaReviewsViewAll));
            },
            reader => new QaEvidenceDetailRow(
                new QaEvidenceSummary(
                    reader.GetGuid(0), reader.GetGuid(1), reader.GetGuid(2), reader.GetString(3), reader.GetString(4),
                    reader.GetGuid(5), reader.GetString(6), reader.GetString(7), GetStringOrNull(reader, 8), GetStringOrNull(reader, 9),
                    GetStringOrNull(reader, 10), reader.GetGuid(11), reader.GetString(12), reader.GetFieldValue<DateTimeOffset>(13),
                    GetIntOrNull(reader, 14), reader.GetInt32(15), GetDateTimeOffsetOrNull(reader, 16), reader.GetInt32(17),
                    reader.GetFieldValue<byte[]>(18),
                    QaReviewPolicy.IsEvidenceWritable(reader.GetString(27)) && (reader.GetBoolean(28) || QaReviewPolicy.CanCorrect(user)),
                    QaReviewPolicy.CanRemove(user), GetStringOrNull(reader, 29), GetStringOrNull(reader, 30)),
                GetStringOrNull(reader, 19), GetStringOrNull(reader, 20), GetStringOrNull(reader, 21), GetStringOrNull(reader, 22),
                GetStringOrNull(reader, 23), GetStringOrNull(reader, 24), GetGuidOrNull(reader, 25)),
            cancellationToken);
        var row = rows.SingleOrDefault();
        if (row is null) return null;

        // Export reads retain the permission-scoped header above, but do not need editor capabilities.
        if (includeEditingMetadata)
        {
            var formAccess = await GetQaFormSubmissionAccessAsync(row.Evidence.ReviewId, user, cancellationToken);
            row = row with { Evidence = row.Evidence with { CanEdit = row.Evidence.CanEdit && formAccess.GetValueOrDefault(row.Evidence.ReviewActivityId) } };
        }
        else
        {
            row = row with { Evidence = row.Evidence with { CanEdit = false, CanRemove = false } };
        }

        var evidenceTeams = await QueryAsync(
            """
            SELECT scope.team_org_unit_id, scope.team_name_snapshot
            FROM qa.evidence_team_scopes scope
            WHERE scope.evidence_record_id = @id
            ORDER BY scope.faculty_name_snapshot, scope.team_name_snapshot;
            """,
            command => command.Parameters.AddWithValue("@id", evidenceId),
            reader => new { Id = reader.GetGuid(0), Name = reader.GetString(1) }, cancellationToken);

        var responses = await QueryAsync(
            """
            -- Resolve the single activity first. Joining the entire evidence/activity/template
            -- graph into the ordered response query can request a disproportionate memory grant.
            DECLARE @activityId uniqueidentifier, @allowsNotSeen bit;
            SELECT @activityId=evidence.review_activity_id, @allowsNotSeen=template.allows_not_seen
            FROM qa.evidence_submissions evidence
            JOIN qa.review_activities activity ON activity.id=evidence.review_activity_id
            JOIN qa.activity_templates template ON template.id=activity.activity_template_id
            WHERE evidence.record_id=@id;

            SELECT question.id, question.theme_or_week, question.question_text, question.guidance,
                   question.display_order, question.is_required, question.allows_not_applicable,
                   question.comment_required_at_expected, response.outcome, response.comment, response.not_applicable_reason, @allowsNotSeen AS allows_not_seen
            FROM qa.review_questions question
            LEFT JOIN qa.evidence_responses response ON response.review_question_id = question.id AND response.evidence_record_id = @id
            WHERE question.review_activity_id = @activityId
            ORDER BY question.display_order;
            """,
            command => command.Parameters.AddWithValue("@id", evidenceId),
            reader => new QaEvidenceResponseSummary(
                reader.GetGuid(0), GetStringOrNull(reader, 1), reader.GetString(2), GetStringOrNull(reader, 3),
                reader.GetInt32(4), reader.GetBoolean(5), reader.GetBoolean(6), reader.GetBoolean(7),
                GetStringOrNull(reader, 8), GetStringOrNull(reader, 9), GetStringOrNull(reader, 10), reader.GetBoolean(11)),
            cancellationToken);
        IReadOnlyList<QaEvidenceRevisionSummary> revisions = [];
        if (includeEditingMetadata) revisions = await QueryAsync(
            """
            SELECT revision.version_number, revision.reason, staff.display_name, revision.created_at
            FROM qa.evidence_revisions revision
            JOIN auth.user_accounts account ON account.id = revision.created_by_user_account_id
            JOIN people.staff staff ON staff.id = account.staff_id
            WHERE revision.evidence_record_id = @id ORDER BY revision.version_number DESC;
            """,
            command => command.Parameters.AddWithValue("@id", evidenceId),
            reader => new QaEvidenceRevisionSummary(reader.GetInt32(0), GetStringOrNull(reader, 1), reader.GetString(2), reader.GetFieldValue<DateTimeOffset>(3)),
            cancellationToken);
        return new QaEvidenceDetail(row.Evidence, evidenceTeams.Select(team => team.Id).ToArray(), evidenceTeams.Select(team => team.Name).ToArray(),
            row.ContextualNotes, ParseStringArray(row.EvidenceLinksJson),
            row.KeyStrengths, row.AreasForImprovement, row.RecommendedActions, row.AdditionalContext,
            row.SubjectStaffId, responses, revisions);
    }

    public async Task RemoveQaEvidenceAsync(
        Guid evidenceId,
        string reason,
        CurrentUser user,
        CancellationToken cancellationToken)
    {
        if (!QaReviewPolicy.CanRemove(user)) throw new WorkflowValidationException("Only an Administrator can remove QA evidence.");
        if (string.IsNullOrWhiteSpace(reason)) throw new WorkflowValidationException("Add a removal reason.");
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(cancellationToken);
        await using var command = new SqlCommand(
            """
            UPDATE qa.evidence_submissions SET removed_at = sysutcdatetime(), removed_by_user_account_id = @user,
                removal_reason = @reason, updated_at = sysutcdatetime(), updated_by_user_account_id = @user
            WHERE record_id = @id AND removed_at IS NULL;
            UPDATE core.records SET archived_at = sysutcdatetime(), updated_at = sysutcdatetime(), updated_by_user_account_id = @user
            WHERE id = @id;
            """, connection, transaction);
        command.Parameters.AddWithValue("@id", evidenceId);
        command.Parameters.AddWithValue("@user", ToDbValue(user.UserAccountId));
        command.Parameters.AddWithValue("@reason", reason.Trim());
        if (await command.ExecuteNonQueryAsync(cancellationToken) < 2) throw new WorkflowValidationException("The QA evidence was not found.");
        await WriteAuditWithReasonAsync(connection, transaction, user.UserAccountId, evidenceId, "qa_evidence", evidenceId,
            "removed", "Soft-removed QA evidence.", null, null, reason.Trim(), cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    public async Task<QaDashboardSummary?> GetQaDashboardAsync(
        Guid reviewId,
        CurrentUser user,
        CancellationToken cancellationToken,
        Guid? facultyOrgUnitId = null,
        Guid? teamOrgUnitId = null)
    {
        if (!await CanViewQaReviewAsync(reviewId, user, cancellationToken)) return null;
        await using var connection = await OpenConnectionAsync(cancellationToken);
        return await BuildQaDashboardAsync(connection, null, reviewId, user, cancellationToken, facultyOrgUnitId, teamOrgUnitId);
    }

    public async Task<IReadOnlyList<QaAuditSummary>?> GetQaAuditAsync(Guid reviewId, CurrentUser user, CancellationToken cancellationToken)
    {
        if (!await CanViewQaReviewAsync(reviewId, user, cancellationToken)) return null;
        return await QueryAsync(
            """
            SELECT audit.id, audit.action, audit.summary, audit.reason, COALESCE(staff.display_name, N'System'), audit.created_at
            FROM ops.audit_logs audit
            LEFT JOIN auth.user_accounts account ON account.id = audit.user_account_id
            LEFT JOIN people.staff staff ON staff.id = account.staff_id
            WHERE audit.record_id = @reviewId
               OR audit.record_id IN (
                    SELECT evidence.record_id FROM qa.evidence_submissions evidence WHERE evidence.review_id = @reviewId
                      AND (@viewAll = 1
                           OR EXISTS (
                                SELECT 1 FROM qa.evidence_team_scopes evidence_scope
                                WHERE evidence_scope.evidence_record_id = evidence.record_id
                                  AND (EXISTS (SELECT 1 FROM org.fn_visible_org_units(@userAccountId) visible
                                              WHERE visible.org_unit_id IN (evidence_scope.team_org_unit_id, evidence_scope.faculty_org_unit_id))
                                       OR EXISTS (SELECT 1 FROM qa.review_contributors contributor
                                                  WHERE contributor.review_id = evidence.review_id AND contributor.staff_id = @staffId
                                                    AND contributor.is_active = 1 AND contributor.active_to IS NULL
                                                    AND (contributor.assigned_org_unit_id IS NULL
                                                         OR contributor.assigned_org_unit_id IN (evidence_scope.team_org_unit_id, evidence_scope.faculty_org_unit_id)))))
                          )
               )
            ORDER BY audit.created_at DESC;
            """,
            command =>
            {
                command.Parameters.AddWithValue("@reviewId", reviewId);
                command.Parameters.AddWithValue("@userAccountId", ToDbValue(user.UserAccountId));
                command.Parameters.AddWithValue("@staffId", ToDbValue(user.StaffId));
                command.Parameters.AddWithValue("@viewAll", user.HasPermission(PermissionKeys.QaReviewsViewAll));
            },
            reader => new QaAuditSummary(reader.GetGuid(0), reader.GetString(1), GetStringOrNull(reader, 2),
                GetStringOrNull(reader, 3), reader.GetString(4), reader.GetFieldValue<DateTimeOffset>(5)),
            cancellationToken);
    }

    public async Task<QaReviewReportData?> GetQaReportAsync(
        Guid reviewId,
        CurrentUser user,
        CancellationToken cancellationToken,
        Guid? facultyOrgUnitId = null,
        Guid? teamOrgUnitId = null)
    {
        var review = await GetQaReviewAsync(reviewId, user, cancellationToken);
        if (review is null) return null;
        var dashboard = await GetQaDashboardAsync(reviewId, user, cancellationToken, facultyOrgUnitId, teamOrgUnitId);
        if (dashboard is null) return null;

        var selectedTeam = teamOrgUnitId.HasValue
            ? review.Scope.FirstOrDefault(scope => scope.ScopeType == "team" && scope.OrgUnitId == teamOrgUnitId.Value)
            : null;
        var facultyName = facultyOrgUnitId.HasValue
            ? review.Scope.FirstOrDefault(scope => scope.ScopeType == "team" && scope.ParentOrgUnitId == facultyOrgUnitId.Value)?.ParentName
            : selectedTeam?.ParentName;
        var includedDashboardUnitIds = (await QueryAsync(
            "SELECT id FROM org.org_units WHERE org.fn_dashboard_process_unit_visible(id, N'qa_review') = 1;",
            reader => reader.GetGuid(0), cancellationToken)).ToHashSet();
        bool IsDashboardVisible(Guid? orgUnitId) => !orgUnitId.HasValue || includedDashboardUnitIds.Contains(orgUnitId.Value);
        var actions = (await GetQaReviewActionGroupsAsync(reviewId, user, cancellationToken) ?? [])
            .Where(action => (!facultyOrgUnitId.HasValue || action.FacultyOrgUnitId == facultyOrgUnitId.Value)
                && (!teamOrgUnitId.HasValue || action.TeamOrgUnitIds.Contains(teamOrgUnitId.Value))
                && IsDashboardVisible(action.FacultyOrgUnitId)
                && (action.TeamOrgUnitIds.Count == 0 || action.TeamOrgUnitIds.Any(teamId => IsDashboardVisible(teamId))))
            .Select(action =>
            {
                var visibleTeams = action.TeamOrgUnitIds.Zip(action.TeamNames, (id, name) => (id, name))
                    .Where(team => IsDashboardVisible(team.id)).ToArray();
                return action with
                {
                    TeamOrgUnitIds = visibleTeams.Select(team => team.id).ToArray(),
                    TeamNames = visibleTeams.Select(team => team.name).ToArray()
                };
            })
            .ToArray();

        return new QaReviewReportData(
            review,
            dashboard,
            actions,
            user.DisplayName,
            DateTimeOffset.UtcNow,
            facultyOrgUnitId,
            facultyName,
            teamOrgUnitId,
            selectedTeam?.Name,
            (await GetQaOutcomeLabelsAsync(cancellationToken)).Labels);
    }

    public async Task<ExportWorkbookData?> GetQaExportAsync(
        Guid reviewId,
        CurrentUser user,
        CancellationToken cancellationToken,
        Guid? facultyOrgUnitId = null,
        Guid? teamOrgUnitId = null)
    {
        var report = await GetQaReportAsync(reviewId, user, cancellationToken, facultyOrgUnitId, teamOrgUnitId);
        if (report is null) return null;
        var included = (await QueryAsync("""
            SELECT evidence.record_id FROM qa.evidence_submissions evidence
            WHERE evidence.review_id=@id AND evidence.removed_at IS NULL AND evidence.status=N'submitted'
              AND EXISTS (SELECT 1 FROM qa.evidence_team_scopes scope
                  WHERE scope.evidence_record_id=evidence.record_id
                    AND org.fn_dashboard_process_unit_visible(scope.team_org_unit_id,N'qa_review')=1
                    AND (@facultyId IS NULL OR scope.faculty_org_unit_id=@facultyId)
                    AND (@teamId IS NULL OR scope.team_org_unit_id=@teamId));
            """, command => {
                command.Parameters.AddWithValue("@id", reviewId);
                command.Parameters.AddWithValue("@facultyId", ToDbValue(facultyOrgUnitId));
                command.Parameters.AddWithValue("@teamId", ToDbValue(teamOrgUnitId));
            }, reader => reader.GetGuid(0), cancellationToken)).ToHashSet();
        var entries = new List<QaEvidenceDetail>();
        foreach (var evidence in report.Review.Evidence.Where(item => included.Contains(item.Id)))
        {
            var detail = await GetQaEvidenceAsync(evidence.Id, user, cancellationToken, includeEditingMetadata: false);
            if (detail is not null) entries.Add(detail);
        }
        var workbook = BuildQaReviewExport(report);
        return workbook with { Sheets = TLQS.Api.Exports.QaFormEntryExportBuilder.Build(entries, report.OutcomeLabels ?? QaOutcomeLabels.Default).Concat(workbook.Sheets).ToArray() };
    }

    public static ExportWorkbookData BuildQaReviewExport(QaReviewReportData report)
    {
        var review = report.Review;
        var dashboard = report.Dashboard;
        var labels = report.OutcomeLabels ?? QaOutcomeLabels.Default;
        static string? Percentage(int value, int denominator) => denominator == 0 ? null : $"{Math.Round(value * 100m / denominator, 1):0.0}%";
        static IReadOnlyList<string?> BreakdownRow(QaDashboardBreakdown item) =>
        [
            item.Label,
            item.Below.ToString(), Percentage(item.Below, item.Rated),
            item.At.ToString(), Percentage(item.At, item.Rated),
            item.Above.ToString(), Percentage(item.Above, item.Rated),
            item.NotApplicable.ToString(), item.NotSeen.ToString(), item.Rated.ToString(), Percentage(item.At + item.Above, item.Rated)
        ];

        var criteria = dashboard.Questions.Select(question => (IReadOnlyList<string?>)new string?[]
        {
            question.ActivityLabel, question.ThemeOrWeek, question.QuestionText,
            question.Below.ToString(), Percentage(question.Below, question.Rated),
            question.At.ToString(), Percentage(question.At, question.Rated),
            question.Above.ToString(), Percentage(question.Above, question.Rated),
            question.NotApplicable.ToString(), question.NotSeen.ToString(), question.Rated.ToString()
        }).ToArray();
        var actionRows = report.Actions.Select(action => (IReadOnlyList<string?>)new string?[]
        {
            action.Title, action.Detail, action.FacultyName, string.Join(", ", action.TeamNames),
            action.DueDate.ToString("yyyy-MM-dd"), action.Status,
            string.Join(", ", action.Assignments.Select(assignment => $"{assignment.StaffName} ({assignment.AssignmentRole.ToUpperInvariant()})"))
        }).ToArray();
        var outcomeRows = new IReadOnlyList<string?>[]
        {
            new string?[] { labels.Below, dashboard.BelowCount.ToString(), Percentage(dashboard.BelowCount, dashboard.RatedCount) },
            new string?[] { labels.At, dashboard.AtCount.ToString(), Percentage(dashboard.AtCount, dashboard.RatedCount) },
            new string?[] { labels.Above, dashboard.AboveCount.ToString(), Percentage(dashboard.AboveCount, dashboard.RatedCount) },
            new string?[] { labels.NotApplicable, dashboard.NotApplicableCount.ToString(), null },
            new string?[] { "Not seen", dashboard.NotSeenCount.ToString(), null }
        };
        var breakdownColumns = new[] { "Process", labels.Below, $"{labels.Below} %", labels.At, $"{labels.At} %", labels.Above, $"{labels.Above} %", labels.NotApplicable, "Not seen", "Rated", $"{labels.AtOrAbove} %" };

        return new ExportWorkbookData(
            "qa-review-report",
            review.Review.Title,
            new ExportFilter(review.Review.AcademicYear, report.FacultyName, report.TeamName, null, null, null, null, review.Review.Status, "qa_review"),
            report.GeneratedBy,
            report.GeneratedAt,
            [
                new ExportSheet("Review Summary", ["Property", "Value"],
                    [
                        new string?[] { "Title", review.Review.Title },
                        new string?[] { "Outcome wording", "Current shared labels; saved keys, snapshots and calculations unchanged." },
                        new string?[] { "Neutral responses", "Not seen and not applicable are counted separately and excluded from rated percentages. Percentages are blank when there are no rated responses." },
                        new string?[] { "Theme", review.Review.Theme },
                        new string?[] { "Academic year", review.Review.AcademicYear },
                        new string?[] { "Status", review.Review.Status },
                        new string?[] { "Closing date", review.Review.ClosingDate.ToString("yyyy-MM-dd") },
                        new string?[] { "Owner", review.Review.OwnerName },
                        new string?[] { "Faculty filter", report.FacultyName ?? "All faculties" },
                        new string?[] { "Team filter", report.TeamName ?? "All teams" }
                    ], false),
                new ExportSheet("Dashboard", ["Measure", "Value"],
                    [
                        new string?[] { "Submissions", dashboard.EvidenceCount.ToString() },
                        new string?[] { "Rated responses", dashboard.RatedCount.ToString() },
                        new string?[] { "Not seen", dashboard.NotSeenCount.ToString() },
                        new string?[] { "Total responses", (dashboard.RatedCount + dashboard.NotApplicableCount + dashboard.NotSeenCount).ToString() },
                        new string?[] { "Teams with evidence", dashboard.TeamCount.ToString() },
                        new string?[] { labels.AtOrAbove, Percentage(dashboard.AtCount + dashboard.AboveCount, dashboard.RatedCount) ?? "No rated responses" },
                        new string?[] { "Linked actions", dashboard.LinkedActionCount.ToString() },
                        new string?[] { "Open actions", dashboard.OpenActionCount.ToString() }
                    ], false),
                new ExportSheet("Outcome Distribution", ["Outcome", "Count", "% of rated responses"], outcomeRows, false),
                new ExportSheet("Processes", breakdownColumns, dashboard.ByActivity.Select(BreakdownRow).ToArray(), false),
                new ExportSheet("Expanded Criteria", ["Process", "Theme/Week", "Criterion", labels.Below, $"{labels.Below} %", labels.At, $"{labels.At} %", labels.Above, $"{labels.Above} %", labels.NotApplicable, "Not seen", "Rated"], criteria, false),
                new ExportSheet("Team Coverage", breakdownColumns, dashboard.ByTeam.Select(BreakdownRow).ToArray(), false),
                new ExportSheet("Themes", breakdownColumns, dashboard.ByTheme.Select(BreakdownRow).ToArray(), false),
                new ExportSheet("Zero Coverage", ["Team without submitted evidence"], dashboard.TeamsWithoutEvidence.Select(team => (IReadOnlyList<string?>)new string?[] { team }).ToArray(), false),
                new ExportSheet("Linked Actions", ["Action", "Detail", "Faculty", "Teams", "Due date", "Status", "Assigned to"], actionRows, false)
            ]);
    }

    private async Task<IReadOnlyList<QaScopeSummary>> GetQaReviewScopeAsync(Guid reviewId, CurrentUser user, CancellationToken cancellationToken) =>
        await QueryAsync(
            """
            SELECT org_unit_id, scope_type, org_unit_code_snapshot, org_unit_name_snapshot,
                   parent_org_unit_id, parent_code_snapshot, parent_name_snapshot
            FROM qa.review_scopes scope WHERE review_id = @id
              AND (@viewAll = 1
                   OR @viewScoped = 1 AND EXISTS (SELECT 1 FROM org.fn_visible_org_units(@userAccountId) visible WHERE visible.org_unit_id IN (scope.org_unit_id, scope.parent_org_unit_id))
                   OR @viewAssigned = 1 AND EXISTS (SELECT 1 FROM qa.review_contributors contributor WHERE contributor.review_id = scope.review_id AND contributor.staff_id = @staffId
                       AND contributor.is_active = 1 AND contributor.active_to IS NULL
                       AND (contributor.assigned_org_unit_id IS NULL OR contributor.assigned_org_unit_id IN (scope.org_unit_id, scope.parent_org_unit_id))))
            ORDER BY parent_name_snapshot, org_unit_name_snapshot;
            """,
            command =>
            {
                command.Parameters.AddWithValue("@id", reviewId);
                AddQaAccessParameters(command, user);
            },
            reader => new QaScopeSummary(reader.GetGuid(0), reader.GetString(1), reader.GetString(2), reader.GetString(3),
                GetGuidOrNull(reader, 4), GetStringOrNull(reader, 5), GetStringOrNull(reader, 6)),
            cancellationToken);

    private async Task<IReadOnlyList<QaReviewActivitySummary>> GetQaReviewActivitiesAsync(
        Guid reviewId, bool frozen, CancellationToken cancellationToken)
    {
        var activities = await QueryAsync(
            """
            SELECT activity.id, activity.activity_type_id, type.activity_key, type.name,
                   activity.activity_template_id, template.name, activity.display_order
            FROM qa.review_activities activity
            JOIN qa.activity_types type ON type.id = activity.activity_type_id
            JOIN qa.activity_templates template ON template.id = activity.activity_template_id
            WHERE activity.review_id = @id ORDER BY activity.display_order;
            """,
            command => command.Parameters.AddWithValue("@id", reviewId),
            reader => new QaReviewActivityRow(reader.GetGuid(0), reader.GetGuid(1), reader.GetString(2), reader.GetString(3),
                reader.GetGuid(4), reader.GetString(5), reader.GetInt32(6)), cancellationToken);
        var result = new List<QaReviewActivitySummary>();
        foreach (var activity in activities)
        {
            IReadOnlyList<QaQuestionSummary> questions;
            if (frozen)
            {
                questions = await QueryAsync(
                    """
                    SELECT frozen.id, type.id, type.activity_key, type.name,
                           frozen.source_version_number, frozen.theme_or_week, frozen.question_text, frozen.guidance,
                           frozen.display_order, frozen.is_required, frozen.allows_not_applicable,
                           frozen.comment_required_at_expected, CAST(1 AS bit), N'frozen', frozen.question_tag, frozen.frozen_at, template.allows_not_seen
                    FROM qa.review_questions frozen
                    JOIN qa.review_activities activity ON activity.id = frozen.review_activity_id
                    JOIN qa.activity_templates template ON template.id = activity.activity_template_id
                    JOIN qa.activity_types type ON type.id = activity.activity_type_id
                    WHERE frozen.review_activity_id = @id ORDER BY frozen.display_order;
                    """,
                    command => command.Parameters.AddWithValue("@id", activity.Id), MapQaQuestion, cancellationToken);
            }
            else
            {
                questions = await QueryAsync(
                    """
                    WITH latest AS (
                        SELECT version.*, ROW_NUMBER() OVER (PARTITION BY version.question_id ORDER BY version.version_number DESC) ordinal
                        FROM qa.question_versions version
                    )
                    SELECT question.id, type.id, type.activity_key, type.name,
                           version.version_number, version.theme_or_week, version.question_text, version.guidance,
                           selection.display_order, version.is_required, version.allows_not_applicable,
                           version.comment_required_at_expected, version.is_active, version.source_status,
                           version.question_tag, version.created_at, template.allows_not_seen
                    FROM qa.review_question_selections selection
                    JOIN qa.review_activities activity ON activity.id = selection.review_activity_id
                    JOIN qa.activity_templates template ON template.id = activity.activity_template_id
                    JOIN qa.questions question ON question.id = selection.question_id
                    JOIN latest version ON version.question_id = question.id AND version.ordinal = 1
                    JOIN qa.activity_types type ON type.id = question.activity_type_id
                    WHERE selection.review_activity_id = @id ORDER BY selection.display_order;
                    """,
                    command => command.Parameters.AddWithValue("@id", activity.Id), MapQaQuestion, cancellationToken);
            }
            result.Add(new QaReviewActivitySummary(activity.Id, activity.ActivityTypeId, activity.ActivityKey,
                activity.Name, activity.TemplateId, activity.TemplateName, activity.DisplayOrder, questions));
        }
        return result;
    }

    private async Task<IReadOnlyList<QaEvidenceSummary>> GetQaEvidenceListAsync(
        Guid reviewId, CurrentUser user, CancellationToken cancellationToken) =>
        await QueryAsync(
            """
            SELECT evidence.record_id, evidence.review_id, evidence.review_activity_id, type.name,
                   evidence.status, evidence.team_org_unit_id, evidence.faculty_name_snapshot, evidence.team_name_snapshot,
                   evidence.course_programme, evidence.course_level, subject.display_name,
                   evidence.reviewer_staff_id, reviewer.display_name, evidence.activity_at, evidence.sample_size,
                   (SELECT COUNT(*) FROM qa.evidence_responses response WHERE response.evidence_record_id = evidence.record_id),
                   evidence.submitted_at, evidence.version_number, evidence.row_version,
                   CAST(CASE WHEN evidence.created_by_user_account_id = @userAccountId THEN 1 ELSE 0 END AS bit), review.status,
                   evidence.delivery_area_key, evidence.delivery_area_name_snapshot
            FROM qa.evidence_submissions evidence
            JOIN qa.reviews review ON review.record_id = evidence.review_id
            JOIN qa.review_activities activity ON activity.id = evidence.review_activity_id
            JOIN qa.activity_types type ON type.id = activity.activity_type_id
            JOIN people.staff reviewer ON reviewer.id = evidence.reviewer_staff_id
            LEFT JOIN people.staff subject ON subject.id = evidence.subject_staff_id
            WHERE evidence.review_id = @reviewId AND evidence.removed_at IS NULL
              AND (@viewAll = 1
                   OR EXISTS (
                        SELECT 1 FROM qa.evidence_team_scopes evidence_scope
                        JOIN org.fn_visible_org_units(@userAccountId) visible
                          ON visible.org_unit_id IN (evidence_scope.team_org_unit_id, evidence_scope.faculty_org_unit_id)
                        WHERE evidence_scope.evidence_record_id = evidence.record_id)
                   OR EXISTS (
                        SELECT 1 FROM qa.evidence_team_scopes evidence_scope
                        JOIN qa.review_contributors contributor ON contributor.review_id = evidence.review_id
                          AND contributor.staff_id = @staffId AND contributor.is_active = 1 AND contributor.active_to IS NULL
                          AND (contributor.assigned_org_unit_id IS NULL
                               OR contributor.assigned_org_unit_id IN (evidence_scope.team_org_unit_id, evidence_scope.faculty_org_unit_id))
                        WHERE evidence_scope.evidence_record_id = evidence.record_id))
            ORDER BY evidence.activity_at DESC, evidence.created_at DESC;
            """,
            command =>
            {
                command.Parameters.AddWithValue("@reviewId", reviewId);
                command.Parameters.AddWithValue("@userAccountId", ToDbValue(user.UserAccountId));
                command.Parameters.AddWithValue("@staffId", ToDbValue(user.StaffId));
                command.Parameters.AddWithValue("@viewAll", user.HasPermission(PermissionKeys.QaReviewsViewAll));
            },
            reader => new QaEvidenceSummary(
                reader.GetGuid(0), reader.GetGuid(1), reader.GetGuid(2), reader.GetString(3), reader.GetString(4),
                reader.GetGuid(5), reader.GetString(6), reader.GetString(7), GetStringOrNull(reader, 8), GetStringOrNull(reader, 9),
                GetStringOrNull(reader, 10), reader.GetGuid(11), reader.GetString(12), reader.GetFieldValue<DateTimeOffset>(13),
                GetIntOrNull(reader, 14), reader.GetInt32(15), GetDateTimeOffsetOrNull(reader, 16), reader.GetInt32(17),
                reader.GetFieldValue<byte[]>(18),
                QaReviewPolicy.IsEvidenceWritable(reader.GetString(20)) && (reader.GetBoolean(19) || QaReviewPolicy.CanCorrect(user)),
                QaReviewPolicy.CanRemove(user), GetStringOrNull(reader, 21), GetStringOrNull(reader, 22)), cancellationToken);

    private async Task<QaCloseValidationSummary> GetQaCloseValidationAsync(Guid reviewId, CurrentUser user, CancellationToken cancellationToken)
    {
        var activities = await QueryAsync(
            """
            SELECT type.name FROM qa.review_activities activity JOIN qa.activity_types type ON type.id = activity.activity_type_id
            WHERE activity.review_id = @id AND NOT EXISTS (
                SELECT 1 FROM qa.evidence_submissions evidence WHERE evidence.review_activity_id = activity.id AND evidence.removed_at IS NULL AND evidence.status = N'submitted');
            """, command => command.Parameters.AddWithValue("@id", reviewId), reader => reader.GetString(0), cancellationToken);
        var teams = await QueryAsync(
            """
            SELECT scope.org_unit_name_snapshot FROM qa.review_scopes scope
            WHERE scope.review_id = @id AND scope.scope_type = N'team' AND NOT EXISTS (
                SELECT 1 FROM qa.evidence_submissions evidence
                JOIN qa.evidence_team_scopes evidence_scope ON evidence_scope.evidence_record_id = evidence.record_id
                WHERE evidence.review_id = scope.review_id AND evidence_scope.team_org_unit_id = scope.org_unit_id
                  AND evidence.removed_at IS NULL AND evidence.status = N'submitted');
            """, command => command.Parameters.AddWithValue("@id", reviewId), reader => reader.GetString(0), cancellationToken);
        var counts = (await QueryAsync(
            """
            SELECT SUM(CASE WHEN status = N'draft' THEN 1 ELSE 0 END),
                   COUNT(CASE WHEN status = N'submitted' THEN 1 END),
                   ISNULL(SUM(CASE WHEN status = N'submitted' THEN sample_size ELSE 0 END), 0),
                   (SELECT COUNT(*) FROM qa.evidence_responses response JOIN qa.evidence_submissions item ON item.record_id = response.evidence_record_id WHERE item.review_id = @id AND item.removed_at IS NULL AND item.status = N'submitted' AND response.outcome IS NOT NULL)
            FROM qa.evidence_submissions WHERE review_id = @id AND removed_at IS NULL;
            """, command => command.Parameters.AddWithValue("@id", reviewId),
            reader => new { Drafts = reader.IsDBNull(0) ? 0 : reader.GetInt32(0), Evidence = reader.GetInt32(1), Samples = reader.GetInt32(2), Responses = reader.GetInt32(3) }, cancellationToken)).Single();
        var missing = (await QueryAsync(
            """
            SELECT ISNULL(SUM(gaps.missing), 0) FROM qa.evidence_submissions evidence
            CROSS APPLY (SELECT COUNT(*) missing FROM qa.review_questions question
                         WHERE question.review_activity_id = evidence.review_activity_id AND question.is_required = 1
                           AND NOT EXISTS (SELECT 1 FROM qa.evidence_responses response WHERE response.evidence_record_id = evidence.record_id AND response.review_question_id = question.id AND response.outcome IS NOT NULL)) gaps
            WHERE evidence.review_id = @id AND evidence.removed_at IS NULL AND gaps.missing > 0;
            """, command => command.Parameters.AddWithValue("@id", reviewId), reader => reader.GetInt32(0), cancellationToken)).Single();
        return new QaCloseValidationSummary(activities, teams, counts.Drafts, missing, counts.Evidence, counts.Responses, counts.Samples);
    }

    private async Task<QaDashboardSummary> BuildQaDashboardAsync(
        SqlConnection connection,
        SqlTransaction? transaction,
        Guid reviewId,
        CurrentUser user,
        CancellationToken cancellationToken,
        Guid? facultyOrgUnitId = null,
        Guid? teamOrgUnitId = null)
    {
        async Task<IReadOnlyList<T>> Read<T>(string sql, Func<SqlDataReader, T> map)
        {
            var values = new List<T>();
            await using var command = new SqlCommand(sql, connection, transaction);
            command.Parameters.AddWithValue("@id", reviewId);
            command.Parameters.AddWithValue("@userAccountId", ToDbValue(user.UserAccountId));
            command.Parameters.AddWithValue("@staffId", ToDbValue(user.StaffId));
            command.Parameters.AddWithValue("@viewAll", user.HasPermission(PermissionKeys.QaReviewsViewAll));
            command.Parameters.AddWithValue("@facultyId", ToDbValue(facultyOrgUnitId));
            command.Parameters.AddWithValue("@teamId", ToDbValue(teamOrgUnitId));
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken)) values.Add(map(reader));
            return values;
        }
        static string EvidenceAccessFilter(string evidenceAlias) => $"""
            {evidenceAlias}.review_id = @id AND {evidenceAlias}.removed_at IS NULL AND {evidenceAlias}.status = N'submitted'
            AND EXISTS (
                SELECT 1 FROM qa.evidence_team_scopes selected_filter_scope
                WHERE selected_filter_scope.evidence_record_id = {evidenceAlias}.record_id
                  AND org.fn_dashboard_process_unit_visible(selected_filter_scope.team_org_unit_id, N'qa_review') = 1
                  AND (@facultyId IS NULL OR selected_filter_scope.faculty_org_unit_id = @facultyId)
                  AND (@teamId IS NULL OR selected_filter_scope.team_org_unit_id = @teamId)
            )
            AND (@viewAll = 1 OR EXISTS (
                SELECT 1 FROM qa.evidence_team_scopes accessible_scope
                WHERE accessible_scope.evidence_record_id = {evidenceAlias}.record_id
                  AND (
                    EXISTS (SELECT 1 FROM org.fn_visible_org_units(@userAccountId) visible
                            WHERE visible.org_unit_id IN (accessible_scope.team_org_unit_id, accessible_scope.faculty_org_unit_id))
                    OR EXISTS (SELECT 1 FROM qa.review_contributors contributor
                               WHERE contributor.review_id = {evidenceAlias}.review_id AND contributor.staff_id = @staffId
                                 AND contributor.is_active = 1 AND contributor.active_to IS NULL
                                 AND (contributor.assigned_org_unit_id IS NULL
                                      OR contributor.assigned_org_unit_id IN (accessible_scope.team_org_unit_id, accessible_scope.faculty_org_unit_id)))
                  )
            ))
            """;
        var accessFilter = EvidenceAccessFilter("evidence");
        var sampleAccessFilter = EvidenceAccessFilter("sample");
        var coveredAccessFilter = EvidenceAccessFilter("covered_evidence");
        var headline = (await Read(
            $"""
            SELECT COUNT(DISTINCT evidence.record_id),
                   (SELECT COUNT(DISTINCT coverage.faculty_org_unit_id)
                    FROM qa.evidence_submissions covered_evidence
                    JOIN qa.evidence_team_scopes coverage ON coverage.evidence_record_id = covered_evidence.record_id
                    WHERE {coveredAccessFilter}
                      AND org.fn_dashboard_process_unit_visible(coverage.team_org_unit_id, N'qa_review') = 1
                      AND (@facultyId IS NULL OR coverage.faculty_org_unit_id = @facultyId)
                      AND (@teamId IS NULL OR coverage.team_org_unit_id = @teamId)),
                   (SELECT COUNT(DISTINCT coverage.team_org_unit_id)
                    FROM qa.evidence_submissions covered_evidence
                    JOIN qa.evidence_team_scopes coverage ON coverage.evidence_record_id = covered_evidence.record_id
                    WHERE {coveredAccessFilter}
                      AND org.fn_dashboard_process_unit_visible(coverage.team_org_unit_id, N'qa_review') = 1
                      AND (@facultyId IS NULL OR coverage.faculty_org_unit_id = @facultyId)
                      AND (@teamId IS NULL OR coverage.team_org_unit_id = @teamId)),
                   COUNT(DISTINCT evidence.course_programme),
                   (SELECT ISNULL(SUM(sample.sample_size), 0) FROM qa.evidence_submissions sample WHERE {sampleAccessFilter}),
                   SUM(CASE WHEN response.outcome = N'below' THEN 1 ELSE 0 END), SUM(CASE WHEN response.outcome = N'at' THEN 1 ELSE 0 END),
                   SUM(CASE WHEN response.outcome = N'above' THEN 1 ELSE 0 END), SUM(CASE WHEN response.outcome = N'not_applicable' THEN 1 ELSE 0 END),
                   SUM(CASE WHEN response.outcome = N'not_seen' THEN 1 ELSE 0 END)
            FROM qa.evidence_submissions evidence LEFT JOIN qa.evidence_responses response ON response.evidence_record_id = evidence.record_id
            WHERE {accessFilter};
            """, reader => Enumerable.Range(0, 10).Select(index => reader.IsDBNull(index) ? 0 : reader.GetInt32(index)).ToArray())).Single();
        async Task<IReadOnlyList<QaDashboardBreakdown>> Breakdown(string keyExpression, string labelExpression, string joins = "") =>
            await Read(
                $"""
                SELECT {keyExpression}, {labelExpression},
                       SUM(CASE WHEN response.outcome = N'below' THEN 1 ELSE 0 END), SUM(CASE WHEN response.outcome = N'at' THEN 1 ELSE 0 END),
                       SUM(CASE WHEN response.outcome = N'above' THEN 1 ELSE 0 END), SUM(CASE WHEN response.outcome = N'not_applicable' THEN 1 ELSE 0 END),
                       SUM(CASE WHEN response.outcome = N'not_seen' THEN 1 ELSE 0 END)
                FROM qa.evidence_submissions evidence
                JOIN qa.evidence_responses response ON response.evidence_record_id = evidence.record_id {joins}
                WHERE {accessFilter}
                GROUP BY {keyExpression}, {labelExpression};
                """, reader =>
                {
                    var distribution = QaReviewPolicy.CalculateDistribution(
                        Enumerable.Repeat("below", reader.GetInt32(2)).Concat(Enumerable.Repeat("at", reader.GetInt32(3)))
                            .Concat(Enumerable.Repeat("above", reader.GetInt32(4))).Concat(Enumerable.Repeat("not_applicable", reader.GetInt32(5)))
                            .Concat(Enumerable.Repeat("not_seen", reader.GetInt32(6))));
                    return new QaDashboardBreakdown(reader.GetString(0), reader.GetString(1), distribution.Below, distribution.At,
                        distribution.Above, distribution.NotApplicable, distribution.Rated, distribution.AtOrAbovePercentage, distribution.NotSeen);
                });
        var byActivity = await Read(
            $"""
            SELECT CONVERT(nvarchar(36), activity_type.id), activity_type.name,
                   SUM(CASE WHEN response.outcome = N'below' THEN 1 ELSE 0 END),
                   SUM(CASE WHEN response.outcome = N'at' THEN 1 ELSE 0 END),
                   SUM(CASE WHEN response.outcome = N'above' THEN 1 ELSE 0 END),
                   SUM(CASE WHEN response.outcome = N'not_applicable' THEN 1 ELSE 0 END),
                   SUM(CASE WHEN response.outcome = N'not_seen' THEN 1 ELSE 0 END)
            FROM qa.review_activities activity
            JOIN qa.activity_types activity_type ON activity_type.id = activity.activity_type_id
            LEFT JOIN qa.evidence_submissions evidence ON evidence.review_activity_id = activity.id AND {accessFilter}
            LEFT JOIN qa.evidence_responses response ON response.evidence_record_id = evidence.record_id
            WHERE activity.review_id = @id
            GROUP BY activity.display_order, activity_type.id, activity_type.name
            ORDER BY activity.display_order;
            """, reader => MapQaDashboardBreakdown(reader));
        var questions = await Read(
            $"""
            SELECT CONVERT(nvarchar(36), activity_type.id), activity_type.name, question.id,
                   question.theme_or_week, question.question_text,
                   SUM(CASE WHEN response.outcome = N'below' THEN 1 ELSE 0 END),
                   SUM(CASE WHEN response.outcome = N'at' THEN 1 ELSE 0 END),
                   SUM(CASE WHEN response.outcome = N'above' THEN 1 ELSE 0 END),
                   SUM(CASE WHEN response.outcome = N'not_applicable' THEN 1 ELSE 0 END),
                   SUM(CASE WHEN response.outcome = N'not_seen' THEN 1 ELSE 0 END)
            FROM qa.review_activities activity
            JOIN qa.activity_types activity_type ON activity_type.id = activity.activity_type_id
            JOIN qa.review_questions question ON question.review_activity_id = activity.id
            LEFT JOIN qa.evidence_submissions evidence ON evidence.review_activity_id = activity.id AND {accessFilter}
            LEFT JOIN qa.evidence_responses response ON response.evidence_record_id = evidence.record_id
                AND response.review_question_id = question.id
            WHERE activity.review_id = @id
            GROUP BY activity.display_order, activity_type.id, activity_type.name,
                     question.display_order, question.id, question.theme_or_week, question.question_text
            ORDER BY activity.display_order, question.display_order;
            """, reader =>
            {
                var below = reader.GetInt32(5);
                var at = reader.GetInt32(6);
                var above = reader.GetInt32(7);
                var notApplicable = reader.GetInt32(8);
                var ratedCount = below + at + above;
                decimal Percentage(int value) => ratedCount == 0 ? 0 : Math.Round(value * 100m / ratedCount, 1);
                return new QaDashboardQuestionBreakdown(reader.GetString(0), reader.GetString(1), reader.GetGuid(2),
                    GetStringOrNull(reader, 3), reader.GetString(4), below, at, above, notApplicable, ratedCount,
                    Percentage(below), Percentage(at), Percentage(above), reader.GetInt32(9));
            });
        var byTeam = await Breakdown("CONVERT(nvarchar(36), team_scope.team_org_unit_id)", "team_scope.team_name_snapshot",
            "JOIN qa.evidence_team_scopes team_scope ON team_scope.evidence_record_id = evidence.record_id AND org.fn_dashboard_process_unit_visible(team_scope.team_org_unit_id, N'qa_review') = 1 AND (@facultyId IS NULL OR team_scope.faculty_org_unit_id = @facultyId) AND (@teamId IS NULL OR team_scope.team_org_unit_id = @teamId)");
        var byTheme = await Breakdown("COALESCE(question.theme_or_week, N'Other')", "COALESCE(question.theme_or_week, N'Other')",
            "JOIN qa.review_questions question ON question.id = response.review_question_id");
        var timeline = await Read(
            $"""
            SELECT CONVERT(date, evidence.activity_at), COUNT(DISTINCT evidence.record_id), COUNT(response.id)
            FROM qa.evidence_submissions evidence LEFT JOIN qa.evidence_responses response ON response.evidence_record_id = evidence.record_id
            WHERE {accessFilter} GROUP BY CONVERT(date, evidence.activity_at) ORDER BY CONVERT(date, evidence.activity_at);
            """, reader => new QaDashboardTimelinePoint(DateOnly.FromDateTime(reader.GetDateTime(0)), reader.GetInt32(1), reader.GetInt32(2)));
        var emptyTeams = await Read(
            """
            SELECT scope.org_unit_name_snapshot FROM qa.review_scopes scope WHERE scope.review_id = @id AND scope.scope_type = N'team'
              AND org.fn_dashboard_process_unit_visible(scope.org_unit_id, N'qa_review') = 1
              AND (@facultyId IS NULL OR scope.parent_org_unit_id = @facultyId)
              AND (@teamId IS NULL OR scope.org_unit_id = @teamId)
              AND (@viewAll = 1
                   OR EXISTS (SELECT 1 FROM org.fn_visible_org_units(@userAccountId) visible WHERE visible.org_unit_id IN (scope.org_unit_id, scope.parent_org_unit_id))
                   OR EXISTS (SELECT 1 FROM qa.review_contributors contributor WHERE contributor.review_id = scope.review_id AND contributor.staff_id = @staffId
                       AND contributor.is_active = 1 AND contributor.active_to IS NULL
                       AND (contributor.assigned_org_unit_id IS NULL OR contributor.assigned_org_unit_id IN (scope.org_unit_id, scope.parent_org_unit_id))))
              AND NOT EXISTS (
                    SELECT 1 FROM qa.evidence_submissions evidence
                    JOIN qa.evidence_team_scopes evidence_scope ON evidence_scope.evidence_record_id = evidence.record_id
                    WHERE evidence.review_id = scope.review_id AND evidence_scope.team_org_unit_id = scope.org_unit_id
                      AND evidence.status = N'submitted' AND evidence.removed_at IS NULL);
            """, reader => reader.GetString(0));
        var actionCounts = (await Read(
            """
            SELECT COUNT(*), SUM(CASE WHEN action_group.forced_closed_at IS NULL AND open_assignment.has_open = 1 THEN 1 ELSE 0 END)
            FROM qa.action_groups action_group
            OUTER APPLY (
                SELECT TOP (1) 1 AS has_open
                FROM qa.action_group_assignments assignment
                JOIN quality.actions action ON action.id = assignment.action_id AND action.archived_at IS NULL
                LEFT JOIN core.lookup_values status ON status.id = action.status_lookup_value_id
                WHERE assignment.action_group_id = action_group.id
                  AND action.completed_date IS NULL
                  AND COALESCE(status.value_key, N'open') NOT IN (N'complete', N'cancelled')
            ) open_assignment
            WHERE action_group.review_id = @id
              AND org.fn_dashboard_process_unit_visible(action_group.faculty_org_unit_id, N'qa_review') = 1
              AND (NOT EXISTS (SELECT 1 FROM qa.action_group_teams any_team WHERE any_team.action_group_id = action_group.id)
                   OR EXISTS (SELECT 1 FROM qa.action_group_teams visible_team
                              WHERE visible_team.action_group_id = action_group.id
                                AND org.fn_dashboard_process_unit_visible(visible_team.team_org_unit_id, N'qa_review') = 1))
              AND (@facultyId IS NULL OR action_group.faculty_org_unit_id = @facultyId)
              AND (@teamId IS NULL OR EXISTS (
                    SELECT 1 FROM qa.action_group_teams selected_team
                    WHERE selected_team.action_group_id = action_group.id
                      AND selected_team.team_org_unit_id = @teamId))
              AND (@viewAll = 1
                   OR EXISTS (SELECT 1 FROM qa.action_group_assignments assignment
                              WHERE assignment.action_group_id = action_group.id AND assignment.staff_id = @staffId)
                   OR EXISTS (SELECT 1 FROM qa.action_group_teams selected_team
                              JOIN org.fn_visible_org_units(@userAccountId) visible
                                ON visible.org_unit_id IN (selected_team.team_org_unit_id, action_group.faculty_org_unit_id)
                              WHERE selected_team.action_group_id = action_group.id));
            """, reader => new[] { reader.GetInt32(0), reader.IsDBNull(1) ? 0 : reader.GetInt32(1) })).Single();
        var snapshot = (await Read("SELECT ISNULL(MAX(version_number), 0) FROM qa.dashboard_snapshots WHERE review_id = @id;", reader => reader.GetInt32(0))).Single();
        var rated = headline[5] + headline[6] + headline[7];
        return new QaDashboardSummary(reviewId, headline[0], headline[1], headline[2], headline[3], headline[4],
            headline[5], headline[6], headline[7], headline[8], rated,
            rated == 0 ? 0 : Math.Round((decimal)(headline[6] + headline[7]) * 100m / rated, 1),
            byActivity, questions, byTeam, byTheme, timeline, emptyTeams, actionCounts[0], actionCounts[1], snapshot, headline[9]);
    }

    private static QaPublishedReviewStructure ToQaPublishedStructure(SaveQaReviewRequest request) => new(
        request.AcademicYear.Trim(), NormalizeQaTag(request.QuestionTag), request.PlannedOpenDate,
        request.TeamOrgUnitIds, request.Activities.Select(activity => new QaPublishedReviewActivity(
            activity.ActivityTypeId, activity.TemplateId, activity.QuestionIds)).ToArray());

    private static async Task<SaveQaReviewRequest> ReadQaReviewConfigurationAsync(
        SqlConnection connection, SqlTransaction transaction, Guid reviewId, bool frozen, CancellationToken cancellationToken)
    {
        SaveQaReviewRequest configuration;
        await using (var command = new SqlCommand(
            """
            SELECT record.title, record.academic_year_key, review.review_theme, review.question_tag,
                   record.owner_staff_id, review.planned_open_date, review.closing_date, review.row_version
            FROM qa.reviews review JOIN core.records record ON record.id = review.record_id
            WHERE review.record_id = @id;
            """, connection, transaction))
        {
            command.Parameters.AddWithValue("@id", reviewId);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            if (!await reader.ReadAsync(cancellationToken))
                throw new WorkflowValidationException("The QA Review was not found.");
            configuration = new SaveQaReviewRequest(reader.GetString(0), reader.GetString(1), reader.GetString(2),
                reader.GetString(3), reader.GetGuid(4), GetDateOnlyOrNull(reader, 5),
                DateOnly.FromDateTime(reader.GetDateTime(6)), [], [], reader.GetFieldValue<byte[]>(7));
        }

        var teams = new List<Guid>();
        await using (var command = new SqlCommand(
            "SELECT org_unit_id FROM qa.review_scopes WHERE review_id = @id AND scope_type = N'team';", connection, transaction))
        {
            command.Parameters.AddWithValue("@id", reviewId);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken)) teams.Add(reader.GetGuid(0));
        }

        var activities = new List<SaveQaReviewActivityRequest>();
        await using (var command = new SqlCommand(
            """
            SELECT activity.activity_type_id, activity.activity_template_id,
                   CASE WHEN @frozen = 1 THEN snapshot.id ELSE selection.question_id END
            FROM qa.review_activities activity
            LEFT JOIN qa.review_questions snapshot ON snapshot.review_activity_id = activity.id AND @frozen = 1
            LEFT JOIN qa.review_question_selections selection ON selection.review_activity_id = activity.id AND @frozen = 0
            WHERE activity.review_id = @id
            ORDER BY activity.display_order, activity.id, snapshot.display_order, selection.display_order;
            """, connection, transaction))
        {
            command.Parameters.AddWithValue("@id", reviewId);
            command.Parameters.AddWithValue("@frozen", frozen);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                var typeId = reader.GetGuid(0);
                if (activities.Count == 0 || activities[^1].ActivityTypeId != typeId)
                    activities.Add(new SaveQaReviewActivityRequest(typeId, reader.GetGuid(1), new List<Guid>()));
                if (!reader.IsDBNull(2)) ((List<Guid>)activities[^1].QuestionIds).Add(reader.GetGuid(2));
            }
        }
        return configuration with { TeamOrgUnitIds = teams, Activities = activities };
    }

    private static async Task InsertQaReviewScopesAsync(
        SqlConnection connection, SqlTransaction transaction, Guid reviewId,
        IEnumerable<Guid> teamIds, CancellationToken cancellationToken)
    {
        foreach (var teamId in teamIds.Distinct())
        {
            await using var scope = new SqlCommand(
                """
                INSERT INTO qa.review_scopes (
                    review_id, org_unit_id, scope_type, org_unit_code_snapshot, org_unit_name_snapshot,
                    parent_org_unit_id, parent_code_snapshot, parent_name_snapshot
                )
                SELECT @review, team.id, N'team', team.code, team.name,
                       faculty.id, faculty.code, faculty.name
                FROM org.org_units team JOIN org.org_units faculty ON faculty.id = team.parent_org_unit_id
                WHERE team.id = @team AND team.archived_at IS NULL AND team.is_active = 1
                  AND team.org_unit_type IN (N'team', N'faculty_child', N'faculty_child_code')
                  AND faculty.archived_at IS NULL AND faculty.is_active = 1 AND faculty.org_unit_type = N'faculty';
                """, connection, transaction);
            scope.Parameters.AddWithValue("@review", reviewId);
            scope.Parameters.AddWithValue("@team", teamId);
            if (await scope.ExecuteNonQueryAsync(cancellationToken) != 1)
                throw new WorkflowValidationException("A selected team is unavailable or does not have an active faculty parent.");
        }
    }

    private async Task InsertQaReviewConfigurationAsync(
        SqlConnection connection,
        SqlTransaction transaction,
        Guid reviewId,
        SaveQaReviewRequest request,
        CurrentUser user,
        CancellationToken cancellationToken)
    {
        await InsertQaReviewScopesAsync(connection, transaction, reviewId, request.TeamOrgUnitIds, cancellationToken);

        var order = 0;
        foreach (var activityRequest in request.Activities)
        {
            var activityId = Guid.NewGuid();
            await using var activity = new SqlCommand(
                """
                INSERT INTO qa.review_activities (id, review_id, activity_type_id, activity_template_id, display_order)
                SELECT @id, @review, @type, template.id, @order
                FROM qa.activity_templates template
                WHERE template.id = @template AND template.activity_type_id = @type AND template.is_active = 1 AND template.archived_at IS NULL;
                """, connection, transaction);
            activity.Parameters.AddWithValue("@id", activityId);
            activity.Parameters.AddWithValue("@review", reviewId);
            activity.Parameters.AddWithValue("@type", activityRequest.ActivityTypeId);
            activity.Parameters.AddWithValue("@template", activityRequest.TemplateId);
            activity.Parameters.AddWithValue("@order", order++);
            if (await activity.ExecuteNonQueryAsync(cancellationToken) != 1)
                throw new WorkflowValidationException("Select a current template for every activity.");

            await using var selection = new SqlCommand(
                """
                WITH latest AS (
                    SELECT version.*, ROW_NUMBER() OVER (
                        PARTITION BY version.question_id ORDER BY version.version_number DESC
                    ) AS ordinal
                    FROM qa.question_versions version
                ), selected_ids AS (
                    SELECT DISTINCT TRY_CONVERT(uniqueidentifier, [value]) AS id
                    FROM OPENJSON(@questionIds)
                    WHERE TRY_CONVERT(uniqueidentifier, [value]) IS NOT NULL
                ), tagged AS (
                    SELECT question.id,
                           ROW_NUMBER() OVER (ORDER BY question.default_display_order, version.question_text) - 1 AS display_order
                    FROM qa.questions question
                    JOIN latest version ON version.question_id = question.id AND version.ordinal = 1
                    JOIN selected_ids selected ON selected.id = question.id
                    WHERE question.activity_type_id = @type
                      AND question.archived_at IS NULL AND question.is_retired = 0
                      AND version.is_active = 1 AND version.source_status = N'active'
                )
                INSERT INTO qa.review_question_selections (review_activity_id, question_id, display_order)
                SELECT @activity, tagged.id, tagged.display_order FROM tagged;
                """, connection, transaction);
            selection.Parameters.AddWithValue("@activity", activityId);
            selection.Parameters.AddWithValue("@type", activityRequest.ActivityTypeId);
            var selectedQuestionIds = activityRequest.QuestionIds.Distinct().ToArray();
            selection.Parameters.AddWithValue("@questionIds", JsonSerializer.Serialize(selectedQuestionIds));
            var insertedQuestionCount = await selection.ExecuteNonQueryAsync(cancellationToken);
            if (selectedQuestionIds.Length == 0)
                throw new WorkflowValidationException("Select at least one question for every enabled activity.");
            if (insertedQuestionCount != selectedQuestionIds.Length)
                throw new WorkflowValidationException("One or more selected questions are inactive or outside the chosen activity.");
        }

    }

    private static async Task ValidateQaReviewReadyToOpenAsync(
        SqlConnection connection, SqlTransaction transaction, Guid reviewId, CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            """
            SELECT
                (SELECT COUNT(*) FROM qa.review_scopes WHERE review_id = @id AND scope_type = N'team'),
                (SELECT COUNT(*) FROM qa.review_activities WHERE review_id = @id),
                (SELECT COUNT(*) FROM qa.review_question_selections selection JOIN qa.review_activities activity ON activity.id = selection.review_activity_id WHERE activity.review_id = @id),
                (SELECT COUNT(*) FROM qa.review_activities activity WHERE activity.review_id = @id AND NOT EXISTS (
                    SELECT 1 FROM qa.review_question_selections selection
                    JOIN qa.question_versions version ON version.question_id = selection.question_id
                    WHERE selection.review_activity_id = activity.id AND version.is_active = 1 AND version.source_status = N'active')),
                (SELECT COUNT(*) FROM qa.review_question_selections selection JOIN qa.review_activities activity ON activity.id = selection.review_activity_id
                    WHERE activity.review_id = @id AND NOT EXISTS (
                        SELECT 1 FROM qa.question_versions version WHERE version.question_id = selection.question_id AND version.is_active = 1 AND version.source_status = N'active'));
            """, connection, transaction);
        command.Parameters.AddWithValue("@id", reviewId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        await reader.ReadAsync(cancellationToken);
        if (reader.GetInt32(0) == 0) throw new WorkflowValidationException("Select at least one team before opening the review.");
        if (reader.GetInt32(1) == 0) throw new WorkflowValidationException("Enable at least one activity before opening the review.");
        if (reader.GetInt32(2) == 0) throw new WorkflowValidationException("Select at least one active question before opening the review.");
        if (reader.GetInt32(3) > 0) throw new WorkflowValidationException("Every enabled activity must have at least one active, approved question.");
        if (reader.GetInt32(4) > 0) throw new WorkflowValidationException("Every selected question must have an active, approved version.");
    }

    private async Task<QaEvidenceAccess> ReadQaEvidenceAccessAsync(
        SqlConnection connection,
        SqlTransaction transaction,
        Guid reviewId,
        Guid teamId,
        Guid reviewActivityId,
        CurrentUser user,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            """
            SELECT TOP (1) review.status, type.name,
                CASE WHEN @submitAll = 1 THEN 1
                     WHEN @submitScoped = 1 AND EXISTS (SELECT 1 FROM org.fn_visible_org_units(@userAccountId) visible WHERE visible.org_unit_id IN (scope.org_unit_id, scope.parent_org_unit_id)) THEN 1
                     WHEN @submitAssigned = 1 AND EXISTS (
                         SELECT 1 FROM qa.review_contributors contributor WHERE contributor.review_id = review.record_id
                           AND contributor.staff_id = @staffId AND contributor.is_active = 1 AND contributor.active_to IS NULL
                           AND (contributor.assigned_org_unit_id IS NULL OR contributor.assigned_org_unit_id IN (scope.org_unit_id, scope.parent_org_unit_id))) THEN 1
                     ELSE 0 END
            FROM qa.reviews review
            JOIN qa.review_scopes scope ON scope.review_id = review.record_id AND scope.org_unit_id = @teamId
            JOIN qa.review_activities activity ON activity.review_id = review.record_id AND activity.id = @activityId
            JOIN qa.activity_types type ON type.id = activity.activity_type_id
            WHERE review.record_id = @reviewId;
            """, connection, transaction);
        command.Parameters.AddWithValue("@reviewId", reviewId);
        command.Parameters.AddWithValue("@teamId", teamId);
        command.Parameters.AddWithValue("@activityId", reviewActivityId);
        command.Parameters.AddWithValue("@userAccountId", ToDbValue(user.UserAccountId));
        command.Parameters.AddWithValue("@staffId", ToDbValue(user.StaffId));
        command.Parameters.AddWithValue("@submitAll", user.HasPermission(PermissionKeys.QaReviewsSubmitAll));
        command.Parameters.AddWithValue("@submitScoped", user.HasPermission(PermissionKeys.QaReviewsSubmitScoped));
        command.Parameters.AddWithValue("@submitAssigned", false);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) throw new WorkflowValidationException("The review or selected team was not found.");
        return new QaEvidenceAccess(reader.GetString(0), GetStringOrNull(reader, 1) ?? "QA activity", reader.GetInt32(2) == 1);
    }

    private static async Task<IReadOnlyList<QaEvidenceQuestion>> ReadQaEvidenceQuestionsAsync(
        SqlConnection connection, SqlTransaction transaction, Guid reviewActivityId, Guid? evidenceId, CancellationToken cancellationToken)
    {
        var result = new List<QaEvidenceQuestion>();
        await using var command = new SqlCommand(
            """
            SELECT question.id, question.question_text, question.is_required, question.allows_not_applicable, question.comment_required_at_expected,
                   template.allows_not_seen, response.outcome
            FROM qa.review_questions question
            JOIN qa.review_activities activity ON activity.id = question.review_activity_id
            JOIN qa.activity_templates template WITH (HOLDLOCK) ON template.id = activity.activity_template_id
            LEFT JOIN qa.evidence_responses response ON response.review_question_id = question.id AND response.evidence_record_id = @evidenceId
            WHERE question.review_activity_id = @id ORDER BY question.display_order;
            """, connection, transaction);
        command.Parameters.AddWithValue("@id", reviewActivityId);
        command.Parameters.AddWithValue("@evidenceId", ToDbValue(evidenceId));
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
            result.Add(new QaEvidenceQuestion(reader.GetGuid(0), reader.GetString(1), reader.GetBoolean(2), reader.GetBoolean(3), reader.GetBoolean(4), reader.GetBoolean(5), GetStringOrNull(reader, 6)));
        return result;
    }

    private async Task<bool> CanViewQaReviewAsync(Guid reviewId, CurrentUser user, CancellationToken cancellationToken)
    {
        var values = await QueryAsync(
            """
            SELECT COUNT(*) FROM qa.reviews review WHERE review.record_id = @id AND (
                @viewAll = 1
                OR (@viewScoped = 1 AND EXISTS (SELECT 1 FROM qa.review_scopes scope JOIN org.fn_visible_org_units(@userAccountId) visible ON visible.org_unit_id IN (scope.org_unit_id, scope.parent_org_unit_id) WHERE scope.review_id = review.record_id))
                OR (@viewAssigned = 1 AND review.status IN (N'open', N'reopened', N'closed') AND EXISTS (SELECT 1 FROM qa.review_contributors contributor WHERE contributor.review_id = review.record_id AND contributor.staff_id = @staffId AND contributor.is_active = 1 AND contributor.active_to IS NULL))
            );
            """,
            command =>
            {
                command.Parameters.AddWithValue("@id", reviewId);
                AddQaAccessParameters(command, user);
            }, reader => reader.GetInt32(0), cancellationToken);
        return values.Single() > 0;
    }

    private static void AddQaAccessParameters(SqlCommand command, CurrentUser user)
    {
        command.Parameters.AddWithValue("@userAccountId", ToDbValue(user.UserAccountId));
        command.Parameters.AddWithValue("@staffId", ToDbValue(user.StaffId));
        command.Parameters.AddWithValue("@viewAll", user.HasPermission(PermissionKeys.QaReviewsViewAll));
        command.Parameters.AddWithValue("@viewScoped", user.HasPermission(PermissionKeys.QaReviewsViewScoped));
        command.Parameters.AddWithValue("@viewAssigned", false);
    }

    private static QaReviewSummary MapQaReviewSummary(SqlDataReader reader, CurrentUser user)
    {
        var status = reader.GetString(4);
        var scoped = reader.GetBoolean(15);
        var canSubmit = QaReviewPolicy.IsEvidenceWritable(status) && (
            user.HasPermission(PermissionKeys.QaReviewsSubmitAll)
            || user.HasPermission(PermissionKeys.QaReviewsSubmitScoped) && scoped);
        var canManage = QaReviewPolicy.CanManage(user);
        return new QaReviewSummary(reader.GetGuid(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), status,
            GetDateOnlyOrNull(reader, 5), DateOnly.FromDateTime(reader.GetDateTime(6)), reader.GetString(7),
            reader.GetInt32(8), reader.GetInt32(9), reader.GetInt32(10), reader.GetFieldValue<byte[]>(11),
            new QaCapabilities(QaReviewPolicy.CanConfigure(user, status), canSubmit, QaReviewPolicy.CanCorrect(user),
                QaReviewPolicy.CanRemove(user), canManage && status is "open" or "reopened",
                canManage && status == "closed", canManage && status is "draft" or "closed", true,
                status == "closed" && QaReviewPolicy.CanUseEmbeddedActions(user, reader.GetGuid(16))));
    }

    private static QaQuestionSummary MapQaQuestion(SqlDataReader reader) => new(
        reader.GetGuid(0), reader.GetGuid(1), reader.GetString(2), reader.GetString(3), reader.GetInt32(4),
        GetStringOrNull(reader, 5), reader.GetString(6), GetStringOrNull(reader, 7), reader.GetInt32(8),
        reader.GetBoolean(9), reader.GetBoolean(10), reader.GetBoolean(11), reader.GetBoolean(12), reader.GetString(13),
        reader.GetString(14), reader.GetFieldValue<DateTimeOffset>(15), reader.FieldCount > 16 && reader.GetBoolean(16));

    private static QaDashboardBreakdown MapQaDashboardBreakdown(SqlDataReader reader)
    {
        var distribution = QaReviewPolicy.CalculateDistribution(
            Enumerable.Repeat("below", reader.GetInt32(2)).Concat(Enumerable.Repeat("at", reader.GetInt32(3)))
                .Concat(Enumerable.Repeat("above", reader.GetInt32(4)))
                .Concat(Enumerable.Repeat("not_applicable", reader.GetInt32(5)))
                .Concat(Enumerable.Repeat("not_seen", reader.GetInt32(6))));
        return new QaDashboardBreakdown(reader.GetString(0), reader.GetString(1), distribution.Below, distribution.At,
            distribution.Above, distribution.NotApplicable, distribution.Rated, distribution.AtOrAbovePercentage, distribution.NotSeen);
    }

    private static void AddQaReviewParameters(SqlCommand command, Guid id, SaveQaReviewRequest request, Guid userAccountId)
    {
        command.Parameters.AddWithValue("@id", id);
        command.Parameters.AddWithValue("@title", request.Title.Trim());
        command.Parameters.AddWithValue("@owner", request.OwnerStaffId);
        command.Parameters.AddWithValue("@closingDate", request.ClosingDate.ToDateTime(TimeOnly.MinValue));
        command.Parameters.AddWithValue("@academicYear", request.AcademicYear.Trim());
        command.Parameters.AddWithValue("@user", userAccountId);
        command.Parameters.AddWithValue("@theme", request.Theme.Trim());
        command.Parameters.AddWithValue("@questionTag", NormalizeQaTag(request.QuestionTag));
        command.Parameters.AddWithValue("@openDate", ToDbValue(request.PlannedOpenDate));
    }

    private static async Task SyncQaEvidenceTeamScopesAsync(
        SqlConnection connection,
        SqlTransaction transaction,
        Guid evidenceId,
        Guid reviewId,
        IReadOnlyList<Guid> teamIds,
        CancellationToken cancellationToken)
    {
        await using (var clear = new SqlCommand(
            "DELETE FROM qa.evidence_team_scopes WHERE evidence_record_id = @evidenceId;", connection, transaction))
        {
            clear.Parameters.AddWithValue("@evidenceId", evidenceId);
            await clear.ExecuteNonQueryAsync(cancellationToken);
        }

        await using var insert = new SqlCommand(
            """
            WITH selected_teams AS (
                SELECT DISTINCT TRY_CONVERT(uniqueidentifier, [value]) team_id
                FROM OPENJSON(@teamIds)
                WHERE TRY_CONVERT(uniqueidentifier, [value]) IS NOT NULL
            )
            INSERT INTO qa.evidence_team_scopes (
                evidence_record_id, team_org_unit_id, faculty_org_unit_id,
                faculty_code_snapshot, faculty_name_snapshot, team_code_snapshot, team_name_snapshot
            )
            SELECT @evidenceId, team.id, faculty.id, faculty.code, faculty.name, team.code, team.name
            FROM selected_teams selected
            JOIN qa.review_scopes review_scope ON review_scope.review_id = @reviewId
                AND review_scope.scope_type = N'team' AND review_scope.org_unit_id = selected.team_id
            JOIN org.org_units team ON team.id = selected.team_id
            JOIN org.org_units faculty ON faculty.id = team.parent_org_unit_id;
            """, connection, transaction);
        insert.Parameters.AddWithValue("@evidenceId", evidenceId);
        insert.Parameters.AddWithValue("@reviewId", reviewId);
        insert.Parameters.AddWithValue("@teamIds", JsonSerializer.Serialize(teamIds));
        if (await insert.ExecuteNonQueryAsync(cancellationToken) != teamIds.Count)
            throw new WorkflowValidationException("Every evidence team must be part of the selected QA review scope.");
    }

    private static async Task<(string? Key, string? Name)> ResolveQaEvidenceDeliveryAreaAsync(
        SqlConnection connection, SqlTransaction transaction, Guid? evidenceId, string? requestedKey,
        bool required, CancellationToken cancellationToken)
    {
        string? previousKey = null;
        string? previousName = null;
        if (evidenceId.HasValue)
        {
            await using var previous = new SqlCommand(
                "SELECT delivery_area_key, delivery_area_name_snapshot FROM qa.evidence_submissions WITH (UPDLOCK, HOLDLOCK) WHERE record_id = @id;",
                connection, transaction);
            previous.Parameters.AddWithValue("@id", evidenceId.Value);
            await using var reader = await previous.ExecuteReaderAsync(cancellationToken);
            if (await reader.ReadAsync(cancellationToken))
            {
                previousKey = GetStringOrNull(reader, 0);
                previousName = GetStringOrNull(reader, 1);
            }
        }

        var key = requestedKey?.Trim();
        if (string.IsNullOrWhiteSpace(key))
        {
            if (required || !string.IsNullOrWhiteSpace(previousKey))
                throw new WorkflowValidationException("Select a delivery area before submitting QA evidence.");
            return (null, null);
        }
        if (key.Length > 100) throw new WorkflowValidationException("Choose a delivery area from the list.");

        await using var lookup = new SqlCommand(
            """
            SELECT value.display_name, CONVERT(bit, CASE WHEN value.is_active = 1 AND value.archived_at IS NULL
                AND type.is_active = 1 AND type.archived_at IS NULL THEN 1 ELSE 0 END)
            FROM core.lookup_values value
            JOIN core.lookup_types type ON type.id = value.lookup_type_id
            WHERE type.lookup_key = N'liv_delivery_area' AND value.value_key = @key;
            """, connection, transaction);
        lookup.Parameters.AddWithValue("@key", key);
        await using var lookupReader = await lookup.ExecuteReaderAsync(cancellationToken);
        if (!await lookupReader.ReadAsync(cancellationToken))
        {
            if (key == previousKey) return (previousKey, previousName ?? previousKey);
            throw new WorkflowValidationException("Choose a delivery area from the list.");
        }
        var name = lookupReader.GetString(0);
        var isActive = lookupReader.GetBoolean(1);
        if (!isActive && key != previousKey)
            throw new WorkflowValidationException("Choose an active delivery area from the list.");
        return (key, key == previousKey && !string.IsNullOrWhiteSpace(previousName) ? previousName : name);
    }

    private static void AddQaDeliveryAreaParameters(SqlCommand command, (string? Key, string? Name) area)
    {
        command.Parameters.AddWithValue("@deliveryAreaKey", ToDbValue(area.Key));
        command.Parameters.AddWithValue("@deliveryAreaName", ToDbValue(area.Name));
    }

    private static void AddQaEvidenceParameters(
        SqlCommand command, Guid id, Guid reviewId, SaveQaEvidenceRequest request, CurrentUser user,
        bool submit, int version, string activityName)
    {
        command.Parameters.AddWithValue("@id", id);
        command.Parameters.AddWithValue("@reviewId", reviewId);
        command.Parameters.AddWithValue("@activity", request.ReviewActivityId);
        command.Parameters.AddWithValue("@team", request.TeamOrgUnitId);
        command.Parameters.AddWithValue("@programme", ToDbValue(request.CourseProgramme));
        command.Parameters.AddWithValue("@level", ToDbValue(request.CourseLevel));
        command.Parameters.AddWithValue("@subject", ToDbValue(request.SubjectStaffId));
        command.Parameters.AddWithValue("@reviewer", user.StaffId!.Value);
        command.Parameters.AddWithValue("@activityAt", request.ActivityAt);
        command.Parameters.AddWithValue("@sampleSize", request.SampleSize.HasValue ? request.SampleSize.Value : DBNull.Value);
        command.Parameters.AddWithValue("@context", ToDbValue(request.ContextualNotes));
        command.Parameters.AddWithValue("@links", request.EvidenceLinks is { Count: > 0 } ? JsonSerializer.Serialize(request.EvidenceLinks) : DBNull.Value);
        command.Parameters.AddWithValue("@strengths", ToDbValue(request.KeyStrengths));
        command.Parameters.AddWithValue("@improvements", ToDbValue(request.AreasForImprovement));
        command.Parameters.AddWithValue("@actions", ToDbValue(request.RecommendedActions));
        command.Parameters.AddWithValue("@additional", ToDbValue(request.AdditionalContext));
        command.Parameters.AddWithValue("@status", submit ? "submitted" : "draft");
        command.Parameters.AddWithValue("@submit", submit);
        command.Parameters.AddWithValue("@version", version);
        command.Parameters.AddWithValue("@user", user.UserAccountId!.Value);
        command.Parameters.AddWithValue("@title", $"{activityName} - {request.ActivityAt:dd MMM yyyy}");
    }

    private static void ValidateQaReview(SaveQaReviewRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Title) || request.Title.Trim().Length > 300) throw new WorkflowValidationException("Enter a review title of no more than 300 characters.");
        if (string.IsNullOrWhiteSpace(request.Theme)) throw new WorkflowValidationException("Enter the review theme.");
        if (string.IsNullOrWhiteSpace(request.QuestionTag) || request.QuestionTag.Trim().Length > 80) throw new WorkflowValidationException("Select a question tag of no more than 80 characters.");
        if (!System.Text.RegularExpressions.Regex.IsMatch(request.AcademicYear.Trim(), "^[12][0-9]{3}/[0-9]{2}$")) throw new WorkflowValidationException("Select a valid academic year.");
        if (request.PlannedOpenDate.HasValue && request.ClosingDate < request.PlannedOpenDate.Value) throw new WorkflowValidationException("The closing date must be on or after the opening date.");
        if (request.TeamOrgUnitIds.Count == 0) throw new WorkflowValidationException("Select at least one team.");
        if (request.Activities.Count == 0) throw new WorkflowValidationException("Enable at least one activity.");
    }

    private static void ValidateQaQuestion(SaveQaQuestionRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.QuestionText) || request.QuestionText.Trim().Length > 1000) throw new WorkflowValidationException("Enter a question of no more than 1,000 characters.");
        if (string.IsNullOrWhiteSpace(request.QuestionTag) || request.QuestionTag.Trim().Length > 80) throw new WorkflowValidationException("Enter a question tag of no more than 80 characters.");
        if (request.DisplayOrder < 0) throw new WorkflowValidationException("Question order cannot be negative.");
        if (request.SourceStatus.Trim().ToLowerInvariant() is not ("active" or "draft" or "inactive")) throw new WorkflowValidationException("Select a valid question source status.");
    }

    private static IReadOnlyList<string> ParseStringArray(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try { return JsonSerializer.Deserialize<string[]>(json) ?? []; }
        catch (JsonException) { return []; }
    }

    private static string NormalizeQaTag(string value) => value.Trim().ToLowerInvariant();

    private static string PastTense(string action) => action switch
    {
        "open" => "opened", "close" => "closed", "reopen" => "reopened", "archive" => "archived", _ => action
    };

    private const string QaReviewListSql = """
        SELECT record.id, record.title, record.academic_year_key, review.review_theme, review.status,
               review.planned_open_date, review.closing_date, owner.display_name,
               (SELECT COUNT(*) FROM qa.review_scopes scope_count WHERE scope_count.review_id = review.record_id AND scope_count.scope_type = N'team'),
               (SELECT COUNT(*) FROM qa.review_activities activity_count WHERE activity_count.review_id = review.record_id),
               (SELECT COUNT(*) FROM qa.evidence_submissions evidence_count
                WHERE evidence_count.review_id = review.record_id AND evidence_count.removed_at IS NULL
                  AND evidence_count.status = N'submitted'
                  AND (@viewAll = 1
                       OR @viewScoped = 1 AND EXISTS (SELECT 1 FROM org.fn_visible_org_units(@userAccountId) evidence_visible WHERE evidence_visible.org_unit_id IN (evidence_count.team_org_unit_id, evidence_count.faculty_org_unit_id))
                       OR @viewAssigned = 1 AND EXISTS (SELECT 1 FROM qa.review_contributors evidence_contributor WHERE evidence_contributor.review_id = review.record_id
                           AND evidence_contributor.staff_id = @staffId AND evidence_contributor.is_active = 1 AND evidence_contributor.active_to IS NULL
                           AND (evidence_contributor.assigned_org_unit_id IS NULL OR evidence_contributor.assigned_org_unit_id IN (evidence_count.team_org_unit_id, evidence_count.faculty_org_unit_id))))),
               review.row_version, review.created_at, review.updated_at,
               CAST(CASE WHEN EXISTS (SELECT 1 FROM qa.review_contributors contributor WHERE contributor.review_id = review.record_id AND contributor.staff_id = @staffId AND contributor.is_active = 1 AND contributor.active_to IS NULL) THEN 1 ELSE 0 END AS bit),
               CAST(CASE WHEN EXISTS (SELECT 1 FROM qa.review_scopes scope JOIN org.fn_visible_org_units(@userAccountId) visible ON visible.org_unit_id IN (scope.org_unit_id, scope.parent_org_unit_id) WHERE scope.review_id = review.record_id) THEN 1 ELSE 0 END AS bit),
               record.owner_staff_id
        FROM qa.reviews review
        JOIN core.records record ON record.id = review.record_id
        JOIN people.staff owner ON owner.id = record.owner_staff_id
        WHERE (
            @viewAll = 1
            OR (@viewScoped = 1 AND EXISTS (SELECT 1 FROM qa.review_scopes scope JOIN org.fn_visible_org_units(@userAccountId) visible ON visible.org_unit_id IN (scope.org_unit_id, scope.parent_org_unit_id) WHERE scope.review_id = review.record_id))
            OR (@viewAssigned = 1 AND review.status IN (N'open', N'reopened', N'closed') AND EXISTS (SELECT 1 FROM qa.review_contributors contributor WHERE contributor.review_id = review.record_id AND contributor.staff_id = @staffId AND contributor.is_active = 1 AND contributor.active_to IS NULL))
        )
        """;

    private sealed record QaActivityTemplateRow(
        Guid ActivityTypeId, string ActivityKey, string ActivityName, string? ActivityDescription,
        int DisplayOrder, bool ActivityActive, Guid? TemplateId, string? TemplateKey, string? TemplateName,
        string? TemplateDescription, bool? TemplateActive, byte[]? TemplateRowVersion, int QuestionCount);
    private sealed record QaReviewActivityRow(Guid Id, Guid ActivityTypeId, string ActivityKey, string Name, Guid TemplateId, string TemplateName, int DisplayOrder);
    private sealed record QaEvidenceDetailRow(QaEvidenceSummary Evidence, string? ContextualNotes, string? EvidenceLinksJson,
        string? KeyStrengths, string? AreasForImprovement, string? RecommendedActions, string? AdditionalContext, Guid? SubjectStaffId);
    private sealed record QaEvidenceQuestion(Guid Id, string QuestionText, bool IsRequired, bool AllowsNotApplicable, bool CommentRequiredAtExpected, bool AllowsNotSeen, string? SavedOutcome);
    private sealed record QaEvidenceAccess(string ReviewStatus, string ActivityName, bool CanSubmit);
}
