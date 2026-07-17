using System.Net.Mail;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;
using TLQS.Api.Messaging;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    private static readonly Regex MessageKeyPattern = new("^[a-z][a-z0-9._-]{2,119}$", RegexOptions.Compiled);
    private static readonly HashSet<string> SupportedMessageEvents = new(StringComparer.OrdinalIgnoreCase)
    {
        "action.assigned", "action.due_soon", "action.overdue", "action.completed",
        "coaching.session_recorded", "coaching.action_assigned", "form.submitted",
        "record.reopened", "record.status_changed", "record.reviewer_allocated",
        "report.available", "reflection.window_opened", "reflection.deadline_approaching",
        "cpd.registered", "cpd.reminder", "manual"
    };

    public async Task<IReadOnlyList<MessageTemplateSummary>> GetMessageTemplatesAsync(
        bool includeDeleted,
        CancellationToken cancellationToken) =>
        await QueryAsync(
            """
            SELECT template.id, template.message_key, template.name, template.internal_description,
                   template.is_active, CONVERT(bit, CASE WHEN template.archived_at IS NULL THEN 0 ELSE 1 END),
                   version.version_number, version.subject_template, version.plain_text_template,
                   version.html_template, version.recipient_config_json,
                   COALESCE(rule.event_type, N'manual'), COALESCE(rule.condition_config_json, N'{}'),
                   COALESCE(rule.schedule_config_json, N'{"mode":"immediate"}'),
                   template.created_at, template.updated_at,
                   SUM(CASE WHEN outbox.status IN (N'pending', N'processing', N'retrying') THEN 1 ELSE 0 END),
                   SUM(CASE WHEN outbox.status = N'failed' THEN 1 ELSE 0 END),
                   SUM(CASE WHEN outbox.status = N'sent' THEN 1 ELSE 0 END)
            FROM ops.message_templates template
            JOIN ops.message_template_versions version ON version.id = template.current_version_id
            OUTER APPLY (
                SELECT TOP (1) message_rule.event_type, message_rule.condition_config_json,
                               message_rule.schedule_config_json
                FROM ops.message_rules message_rule
                WHERE message_rule.message_template_id = template.id
                  AND message_rule.archived_at IS NULL
                ORDER BY message_rule.created_at DESC
            ) rule
            LEFT JOIN ops.message_outbox outbox ON outbox.template_version_id = version.id
            WHERE (@includeDeleted = 1 OR template.archived_at IS NULL)
            GROUP BY template.id, template.message_key, template.name, template.internal_description,
                     template.is_active, template.archived_at, version.version_number,
                     version.subject_template, version.plain_text_template, version.html_template,
                     version.recipient_config_json, rule.event_type, rule.condition_config_json,
                     rule.schedule_config_json, template.created_at, template.updated_at
            ORDER BY template.name;
            """,
            command => command.Parameters.AddWithValue("@includeDeleted", includeDeleted),
            reader => new MessageTemplateSummary(
                reader.GetGuid(0), reader.GetString(1), reader.GetString(2), GetStringOrNull(reader, 3),
                reader.GetBoolean(4), reader.GetBoolean(5), reader.GetInt32(6), reader.GetString(7),
                reader.GetString(8), GetStringOrNull(reader, 9), reader.GetString(10), reader.GetString(11),
                reader.GetString(12), reader.GetString(13), reader.GetFieldValue<DateTimeOffset>(14),
                GetDateTimeOffsetOrNull(reader, 15), reader.GetInt32(16), reader.GetInt32(17), reader.GetInt32(18)),
            cancellationToken);

    public async Task<IReadOnlyList<MessageTemplateVersionSummary>> GetMessageTemplateVersionsAsync(
        Guid templateId,
        CancellationToken cancellationToken) =>
        await QueryAsync(
            """
            SELECT version.id, version.version_number, version.subject_template,
                   version.plain_text_template, version.html_template, version.recipient_config_json,
                   version.created_at, staff.display_name
            FROM ops.message_template_versions version
            LEFT JOIN auth.user_accounts account ON account.id = version.created_by_user_account_id
            LEFT JOIN people.staff staff ON staff.id = account.staff_id
            WHERE version.message_template_id = @templateId
            ORDER BY version.version_number DESC;
            """,
            command => command.Parameters.AddWithValue("@templateId", templateId),
            reader => new MessageTemplateVersionSummary(
                reader.GetGuid(0), reader.GetInt32(1), reader.GetString(2), reader.GetString(3),
                GetStringOrNull(reader, 4), reader.GetString(5), reader.GetFieldValue<DateTimeOffset>(6),
                GetStringOrNull(reader, 7)),
            cancellationToken);

    public async Task<Guid> CreateMessageTemplateAsync(
        SaveMessageTemplateRequest request,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        var normalized = NormalizeMessageTemplate(request);
        var templateId = Guid.NewGuid();
        await SaveMessageTemplateAsync(templateId, normalized, currentUser, true, cancellationToken);
        return templateId;
    }

    public async Task<bool> UpdateMessageTemplateAsync(
        Guid templateId,
        SaveMessageTemplateRequest request,
        CurrentUser currentUser,
        CancellationToken cancellationToken) =>
        await SaveMessageTemplateAsync(templateId, NormalizeMessageTemplate(request), currentUser, false, cancellationToken);

    public async Task<Guid?> DuplicateMessageTemplateAsync(
        Guid sourceTemplateId,
        string messageKey,
        string name,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        var templates = await GetMessageTemplatesAsync(true, cancellationToken);
        var source = templates.SingleOrDefault(item => item.Id == sourceTemplateId);
        if (source is null) return null;
        var request = new SaveMessageTemplateRequest(
            messageKey, name, source.InternalDescription, source.SubjectTemplate, source.PlainTextTemplate,
            source.HtmlTemplate, source.RecipientConfigJson, source.EventType, source.ConditionConfigJson,
            source.ScheduleConfigJson, false);
        return await CreateMessageTemplateAsync(request, currentUser, cancellationToken);
    }

    public async Task<bool> SetMessageTemplateStatusAsync(
        Guid templateId,
        SetMessageTemplateStatusRequest request,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        var reason = string.IsNullOrWhiteSpace(request.Reason)
            ? throw new WorkflowValidationException("Enter a reason for this template change.")
            : request.Reason.Trim();
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            await using var command = new SqlCommand(
                """
                UPDATE ops.message_templates
                SET is_active = @isActive,
                    archived_at = CASE WHEN @restore = 1 THEN NULL
                                       WHEN @isActive = 0 AND @restore = 0 THEN archived_at
                                       ELSE archived_at END,
                    updated_by_user_account_id = @userId,
                    updated_at = sysutcdatetime()
                WHERE id = @id;
                """, connection, (SqlTransaction)transaction);
            command.Parameters.AddWithValue("@id", templateId);
            command.Parameters.AddWithValue("@isActive", request.IsActive);
            command.Parameters.AddWithValue("@restore", request.Restore);
            command.Parameters.AddWithValue("@userId", ToDbValue(currentUser.UserAccountId));
            var changed = await command.ExecuteNonQueryAsync(cancellationToken);
            if (changed == 0)
            {
                await transaction.RollbackAsync(cancellationToken);
                return false;
            }
            await WriteAuditWithReasonAsync(
                connection, transaction, currentUser.UserAccountId, null, "message_template", templateId,
                request.Restore ? "messaging.template_restored" : request.IsActive
                    ? "messaging.template_activated" : "messaging.template_deactivated",
                $"Message template status changed by {currentUser.DisplayName}.", null,
                JsonSerializer.Serialize(new { request.IsActive, request.Restore }), reason, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return true;
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task<bool> SoftDeleteMessageTemplateAsync(
        Guid templateId,
        string reason,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(reason)) throw new WorkflowValidationException("Enter a reason for deleting this template.");
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            await using var command = new SqlCommand(
                """
                UPDATE ops.message_templates
                SET is_active = 0, archived_at = COALESCE(archived_at, sysutcdatetime()),
                    updated_by_user_account_id = @userId, updated_at = sysutcdatetime()
                WHERE id = @id;
                UPDATE ops.message_rules SET is_active = 0, archived_at = COALESCE(archived_at, sysutcdatetime())
                WHERE message_template_id = @id;
                """, connection, (SqlTransaction)transaction);
            command.Parameters.AddWithValue("@id", templateId);
            command.Parameters.AddWithValue("@userId", ToDbValue(currentUser.UserAccountId));
            var changed = await command.ExecuteNonQueryAsync(cancellationToken);
            if (changed == 0)
            {
                await transaction.RollbackAsync(cancellationToken);
                return false;
            }
            await WriteAuditWithReasonAsync(
                connection, transaction, currentUser.UserAccountId, null, "message_template", templateId,
                "messaging.template_deleted", $"Message template deleted by {currentUser.DisplayName}.",
                null, null, reason.Trim(), cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return true;
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public MessagePreview PreviewMessageTemplate(
        SaveMessageTemplateRequest request,
        IReadOnlyDictionary<string, string>? sampleParameters)
    {
        var normalized = NormalizeMessageTemplate(request);
        var values = BuildSampleParameters(sampleParameters);
        return new MessagePreview(
            MessageTemplatePolicy.Render(normalized.SubjectTemplate, values),
            MessageTemplatePolicy.Render(normalized.PlainTextTemplate, values),
            normalized.HtmlTemplate is null ? null : MessageTemplatePolicy.Render(normalized.HtmlTemplate, values),
            ReadRecipientTypes(normalized.RecipientConfigJson));
    }

    public async Task<Guid?> QueueTestMessageAsync(
        Guid templateId,
        SendTestMessageRequest request,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        var address = ValidateEmail(request.RecipientEmail);
        var values = BuildSampleParameters(request.SampleParameters);
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            Guid? versionId = null;
            await using (var versionCommand = new SqlCommand(
                "SELECT current_version_id FROM ops.message_templates WHERE id = @id AND archived_at IS NULL;",
                connection, (SqlTransaction)transaction))
            {
                versionCommand.Parameters.AddWithValue("@id", templateId);
                var value = await versionCommand.ExecuteScalarAsync(cancellationToken);
                if (value is Guid guid) versionId = guid;
            }
            if (!versionId.HasValue)
            {
                await transaction.RollbackAsync(cancellationToken);
                return null;
            }
            var outboxId = Guid.NewGuid();
            await using (var command = new SqlCommand(
                """
                INSERT INTO ops.message_outbox (
                    id, template_version_id, triggering_event, idempotency_key,
                    parameter_values_json, requested_by_user_account_id
                ) VALUES (
                    @id, @versionId, N'manual.test', @idempotencyKey,
                    @parameters, @requestedBy
                );
                INSERT INTO ops.message_outbox_recipients (
                    outbox_id, recipient_type, email_address, display_name
                ) VALUES (@id, N'to', @email, N'Test recipient');
                """, connection, (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@id", outboxId);
                command.Parameters.AddWithValue("@versionId", versionId.Value);
                command.Parameters.AddWithValue("@idempotencyKey", $"test:{templateId:N}:{outboxId:N}");
                command.Parameters.AddWithValue("@parameters", JsonSerializer.Serialize(values));
                command.Parameters.AddWithValue("@requestedBy", ToDbValue(currentUser.UserAccountId));
                command.Parameters.AddWithValue("@email", address);
                await command.ExecuteNonQueryAsync(cancellationToken);
            }
            await WriteAuditAsync(
                connection, transaction, currentUser.UserAccountId, null, "message_outbox", outboxId,
                "messaging.test_queued", $"Test message queued by {currentUser.DisplayName}.",
                null, JsonSerializer.Serialize(new { TemplateId = templateId, Recipient = address }), cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return outboxId;
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task<IReadOnlyList<MessageDeliverySummary>> GetMessageDeliveriesAsync(
        int take,
        CancellationToken cancellationToken) =>
        await QueryAsync(
            """
            SELECT TOP (@take) outbox.id, template.name, version.version_number,
                   outbox.triggering_event, outbox.status,
                   STRING_AGG(CONCAT(recipient.recipient_type, N': ', recipient.email_address), N'; '),
                   outbox.attempt_count, outbox.queued_at, outbox.delivered_at, outbox.failed_at,
                   outbox.last_error, outbox.provider_response_id
            FROM ops.message_outbox outbox
            JOIN ops.message_template_versions version ON version.id = outbox.template_version_id
            JOIN ops.message_templates template ON template.id = version.message_template_id
            LEFT JOIN ops.message_outbox_recipients recipient ON recipient.outbox_id = outbox.id
            GROUP BY outbox.id, template.name, version.version_number, outbox.triggering_event,
                     outbox.status, outbox.attempt_count, outbox.queued_at, outbox.delivered_at,
                     outbox.failed_at, outbox.last_error, outbox.provider_response_id
            ORDER BY outbox.queued_at DESC;
            """,
            command => command.Parameters.AddWithValue("@take", Math.Clamp(take, 1, 500)),
            reader => new MessageDeliverySummary(
                reader.GetGuid(0), reader.GetString(1), reader.GetInt32(2), reader.GetString(3),
                reader.GetString(4), GetStringOrNull(reader, 5) ?? "", reader.GetInt32(6),
                reader.GetFieldValue<DateTimeOffset>(7), GetDateTimeOffsetOrNull(reader, 8),
                GetDateTimeOffsetOrNull(reader, 9), GetStringOrNull(reader, 10), GetStringOrNull(reader, 11)),
            cancellationToken);

    public async Task<bool> RetryMessageAsync(
        Guid outboxId,
        string reason,
        CurrentUser currentUser,
        CancellationToken cancellationToken) =>
        await ChangeMessageDeliveryAsync(outboxId, "retry", reason, currentUser, cancellationToken);

    public async Task<bool> CancelMessageAsync(
        Guid outboxId,
        string reason,
        CurrentUser currentUser,
        CancellationToken cancellationToken) =>
        await ChangeMessageDeliveryAsync(outboxId, "cancel", reason, currentUser, cancellationToken);

    internal async Task<IReadOnlyList<Guid>> ClaimMessageBatchAsync(int batchSize, CancellationToken cancellationToken)
    {
        var ids = new List<Guid>();
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var command = new SqlCommand(
            """
            ;WITH claim AS (
                SELECT TOP (@batchSize) *
                FROM ops.message_outbox WITH (UPDLOCK, READPAST, ROWLOCK)
                WHERE status IN (N'pending', N'retrying')
                  AND available_at <= sysutcdatetime()
                  AND (locked_until IS NULL OR locked_until < sysutcdatetime())
                ORDER BY priority, queued_at
            )
            UPDATE claim
            SET status = N'processing', processing_at = sysutcdatetime(),
                locked_until = DATEADD(minute, 5, sysutcdatetime())
            OUTPUT inserted.id;
            """, connection);
        command.Parameters.AddWithValue("@batchSize", Math.Clamp(batchSize, 1, 50));
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken)) ids.Add(reader.GetGuid(0));
        return ids;
    }

    internal async Task<MessageDeliveryWorkItem?> GetMessageWorkItemAsync(Guid outboxId, CancellationToken cancellationToken)
    {
        var rows = await QueryAsync(
            """
            SELECT outbox.id, outbox.attempt_count, outbox.max_attempts,
                   version.subject_template, version.plain_text_template, version.html_template,
                   outbox.parameter_values_json
            FROM ops.message_outbox outbox
            JOIN ops.message_template_versions version ON version.id = outbox.template_version_id
            WHERE outbox.id = @id AND outbox.status = N'processing';
            """,
            command => command.Parameters.AddWithValue("@id", outboxId),
            reader => new MessageWorkRow(
                reader.GetGuid(0), reader.GetInt32(1), reader.GetInt32(2), reader.GetString(3),
                reader.GetString(4), GetStringOrNull(reader, 5), reader.GetString(6)),
            cancellationToken);
        if (rows.Count == 0) return null;
        var recipients = await QueryAsync(
            """
            SELECT recipient_type, email_address, display_name
            FROM ops.message_outbox_recipients WHERE outbox_id = @id ORDER BY recipient_type, email_address;
            """,
            command => command.Parameters.AddWithValue("@id", outboxId),
            reader => new OutboundRecipient(reader.GetString(0), reader.GetString(1), GetStringOrNull(reader, 2)),
            cancellationToken);
        var row = rows[0];
        var values = JsonSerializer.Deserialize<Dictionary<string, string>>(row.ParametersJson)
            ?? new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        MessageTemplatePolicy.Validate(row.SubjectTemplate, row.PlainTextTemplate, row.HtmlTemplate);
        return new MessageDeliveryWorkItem(
            row.Id, row.AttemptCount, row.MaxAttempts,
            new OutboundEmail(
                MessageTemplatePolicy.Render(row.SubjectTemplate, values),
                MessageTemplatePolicy.Render(row.PlainTextTemplate, values),
                row.HtmlTemplate is null ? null : MessageTemplatePolicy.Render(row.HtmlTemplate, values),
                recipients));
    }

    internal async Task CompleteMessageDeliveryAsync(
        MessageDeliveryWorkItem item,
        DateTimeOffset startedAt,
        string provider,
        string? responseId,
        CancellationToken cancellationToken) =>
        await RecordMessageAttemptAsync(item, startedAt, provider, true, responseId, null, cancellationToken);

    internal async Task FailMessageDeliveryAsync(
        MessageDeliveryWorkItem item,
        DateTimeOffset startedAt,
        string provider,
        string error,
        CancellationToken cancellationToken) =>
        await RecordMessageAttemptAsync(item, startedAt, provider, false, null, error, cancellationToken);

    private async Task<bool> SaveMessageTemplateAsync(
        Guid templateId,
        NormalizedMessageTemplate request,
        CurrentUser currentUser,
        bool create,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            var nextVersion = 1;
            if (create)
            {
                await using var insert = new SqlCommand(
                    """
                    INSERT INTO ops.message_templates (
                        id, message_key, name, internal_description, is_active,
                        created_by_user_account_id, updated_by_user_account_id
                    ) VALUES (@id, @key, @name, @description, @active, @userId, @userId);
                    """, connection, (SqlTransaction)transaction);
                AddTemplateParameters(insert, templateId, request, currentUser.UserAccountId);
                await insert.ExecuteNonQueryAsync(cancellationToken);
            }
            else
            {
                await using var read = new SqlCommand(
                    "SELECT COALESCE(MAX(version_number), 0) + 1 FROM ops.message_template_versions WHERE message_template_id = @id;",
                    connection, (SqlTransaction)transaction);
                read.Parameters.AddWithValue("@id", templateId);
                nextVersion = Convert.ToInt32(await read.ExecuteScalarAsync(cancellationToken));
                await using var update = new SqlCommand(
                    """
                    UPDATE ops.message_templates SET message_key = @key, name = @name,
                        internal_description = @description, is_active = @active,
                        updated_by_user_account_id = @userId, updated_at = sysutcdatetime()
                    WHERE id = @id AND archived_at IS NULL;
                    """, connection, (SqlTransaction)transaction);
                AddTemplateParameters(update, templateId, request, currentUser.UserAccountId);
                if (await update.ExecuteNonQueryAsync(cancellationToken) == 0)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    return false;
                }
            }

            var versionId = Guid.NewGuid();
            await using (var version = new SqlCommand(
                """
                INSERT INTO ops.message_template_versions (
                    id, message_template_id, version_number, subject_template, plain_text_template,
                    html_template, recipient_config_json, created_by_user_account_id
                ) VALUES (@versionId, @templateId, @versionNumber, @subject, @plainText,
                          @html, @recipients, @userId);
                UPDATE ops.message_templates SET current_version_id = @versionId WHERE id = @templateId;
                UPDATE ops.message_rules SET is_active = 0, archived_at = sysutcdatetime()
                WHERE message_template_id = @templateId AND archived_at IS NULL;
                INSERT INTO ops.message_rules (
                    message_template_id, event_type, condition_config_json,
                    schedule_config_json, is_active
                ) VALUES (@templateId, @eventType, @conditions, @schedule, @active);
                """, connection, (SqlTransaction)transaction))
            {
                version.Parameters.AddWithValue("@versionId", versionId);
                version.Parameters.AddWithValue("@templateId", templateId);
                version.Parameters.AddWithValue("@versionNumber", nextVersion);
                version.Parameters.AddWithValue("@subject", request.SubjectTemplate);
                version.Parameters.AddWithValue("@plainText", request.PlainTextTemplate);
                version.Parameters.AddWithValue("@html", ToDbValue(request.HtmlTemplate));
                version.Parameters.AddWithValue("@recipients", request.RecipientConfigJson);
                version.Parameters.AddWithValue("@userId", ToDbValue(currentUser.UserAccountId));
                version.Parameters.AddWithValue("@eventType", request.EventType);
                version.Parameters.AddWithValue("@conditions", request.ConditionConfigJson);
                version.Parameters.AddWithValue("@schedule", request.ScheduleConfigJson);
                version.Parameters.AddWithValue("@active", request.IsActive);
                await version.ExecuteNonQueryAsync(cancellationToken);
            }

            await using (var archiveAttachments = new SqlCommand(
                "UPDATE ops.message_attachments SET archived_at = sysutcdatetime() WHERE message_template_id = @id AND archived_at IS NULL;",
                connection, (SqlTransaction)transaction))
            {
                archiveAttachments.Parameters.AddWithValue("@id", templateId);
                await archiveAttachments.ExecuteNonQueryAsync(cancellationToken);
            }
            foreach (var attachment in request.Attachments)
            {
                await using var insertAttachment = new SqlCommand(
                    """
                    INSERT INTO ops.message_attachments (
                        message_template_id, attachment_type, file_asset_id, export_module_key, display_name
                    ) VALUES (@templateId, @type, @fileId, @moduleKey, @displayName);
                    """, connection, (SqlTransaction)transaction);
                insertAttachment.Parameters.AddWithValue("@templateId", templateId);
                insertAttachment.Parameters.AddWithValue("@type", attachment.AttachmentType);
                insertAttachment.Parameters.AddWithValue("@fileId", ToDbValue(attachment.FileAssetId));
                insertAttachment.Parameters.AddWithValue("@moduleKey", ToDbValue(attachment.ExportModuleKey));
                insertAttachment.Parameters.AddWithValue("@displayName", attachment.DisplayName);
                await insertAttachment.ExecuteNonQueryAsync(cancellationToken);
            }

            await WriteAuditAsync(
                connection, transaction, currentUser.UserAccountId, null, "message_template", templateId,
                create ? "messaging.template_created" : "messaging.template_updated",
                $"Message template version {nextVersion} saved by {currentUser.DisplayName}.", null,
                JsonSerializer.Serialize(new { request.MessageKey, request.Name, Version = nextVersion, request.EventType, request.IsActive }),
                cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return true;
        }
        catch (SqlException exception) when (exception.Number is 2601 or 2627)
        {
            await transaction.RollbackAsync(cancellationToken);
            throw new WorkflowValidationException("That message key is already in use.");
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    private async Task<bool> ChangeMessageDeliveryAsync(
        Guid outboxId,
        string operation,
        string reason,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(reason)) throw new WorkflowValidationException("Enter a reason for this delivery change.");
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            var sql = operation == "retry"
                ? """
                  UPDATE ops.message_outbox SET status = N'retrying', available_at = sysutcdatetime(),
                      locked_until = NULL, failed_at = NULL, cancelled_at = NULL, last_error = NULL
                  WHERE id = @id AND status IN (N'failed', N'cancelled');
                  """
                : """
                  UPDATE ops.message_outbox SET status = N'cancelled', cancelled_at = sysutcdatetime(), locked_until = NULL
                  WHERE id = @id AND status IN (N'pending', N'retrying', N'failed');
                  """;
            await using var command = new SqlCommand(sql, connection, (SqlTransaction)transaction);
            command.Parameters.AddWithValue("@id", outboxId);
            if (await command.ExecuteNonQueryAsync(cancellationToken) == 0)
            {
                await transaction.RollbackAsync(cancellationToken);
                return false;
            }
            await WriteAuditWithReasonAsync(
                connection, transaction, currentUser.UserAccountId, null, "message_outbox", outboxId,
                operation == "retry" ? "messaging.delivery_retried" : "messaging.delivery_cancelled",
                $"Message delivery {operation} requested by {currentUser.DisplayName}.", null, null,
                reason.Trim(), cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return true;
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    private async Task RecordMessageAttemptAsync(
        MessageDeliveryWorkItem item,
        DateTimeOffset startedAt,
        string provider,
        bool successful,
        string? responseId,
        string? error,
        CancellationToken cancellationToken)
    {
        var nextAttempt = item.AttemptCount + 1;
        var terminal = !successful && nextAttempt >= item.MaxAttempts;
        var delaySeconds = Math.Min(1800, 15 * (int)Math.Pow(2, Math.Min(nextAttempt - 1, 7)));
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            await using var command = new SqlCommand(
                """
                INSERT INTO ops.message_delivery_attempts (
                    outbox_id, attempt_number, provider_type, started_at, completed_at,
                    was_successful, provider_response_id, error_summary
                ) VALUES (
                    @id, @attempt, @provider, @startedAt, sysutcdatetime(),
                    @successful, @responseId, @error
                );
                UPDATE ops.message_outbox
                SET attempt_count = @attempt,
                    status = CASE WHEN @successful = 1 THEN N'sent'
                                  WHEN @terminal = 1 THEN N'failed' ELSE N'retrying' END,
                    delivered_at = CASE WHEN @successful = 1 THEN sysutcdatetime() ELSE NULL END,
                    failed_at = CASE WHEN @terminal = 1 THEN sysutcdatetime() ELSE NULL END,
                    available_at = CASE WHEN @successful = 0 AND @terminal = 0
                                        THEN DATEADD(second, @delaySeconds, sysutcdatetime()) ELSE available_at END,
                    locked_until = NULL,
                    last_error = @error,
                    provider_response_id = @responseId
                WHERE id = @id AND status = N'processing';
                """, connection, (SqlTransaction)transaction);
            command.Parameters.AddWithValue("@id", item.Id);
            command.Parameters.AddWithValue("@attempt", nextAttempt);
            command.Parameters.AddWithValue("@provider", provider);
            command.Parameters.AddWithValue("@startedAt", startedAt);
            command.Parameters.AddWithValue("@successful", successful);
            command.Parameters.AddWithValue("@terminal", terminal);
            command.Parameters.AddWithValue("@delaySeconds", delaySeconds);
            command.Parameters.AddWithValue("@responseId", ToDbValue(responseId));
            command.Parameters.AddWithValue("@error", ToDbValue(error is null ? null : error[..Math.Min(error.Length, 2000)]));
            await command.ExecuteNonQueryAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    private static NormalizedMessageTemplate NormalizeMessageTemplate(SaveMessageTemplateRequest request)
    {
        var key = request.MessageKey.Trim().ToLowerInvariant();
        if (!MessageKeyPattern.IsMatch(key)) throw new WorkflowValidationException("Use a message key such as action.due_reminder.");
        var name = request.Name.Trim();
        if (name.Length is < 3 or > 250) throw new WorkflowValidationException("Enter a message name between 3 and 250 characters.");
        var eventType = request.EventType.Trim().ToLowerInvariant();
        if (!SupportedMessageEvents.Contains(eventType)) throw new WorkflowValidationException("Select a supported message event.");
        var recipients = NormalizeJson(request.RecipientConfigJson, "recipient configuration");
        var conditions = NormalizeJson(request.ConditionConfigJson, "trigger conditions");
        var schedule = NormalizeJson(request.ScheduleConfigJson, "send schedule");
        var html = MessageTemplatePolicy.SanitizeHtml(request.HtmlTemplate);
        MessageTemplatePolicy.Validate(request.SubjectTemplate.Trim(), request.PlainTextTemplate.Trim(), html);
        var attachments = (request.Attachments ?? []).Select(NormalizeAttachment).ToArray();
        return new NormalizedMessageTemplate(
            key, name, string.IsNullOrWhiteSpace(request.InternalDescription) ? null : request.InternalDescription.Trim(),
            request.SubjectTemplate.Trim(), request.PlainTextTemplate.Trim(), html, recipients,
            eventType, conditions, schedule, request.IsActive, attachments);
    }

    private static NormalizedMessageAttachment NormalizeAttachment(SaveMessageAttachmentRequest item)
    {
        var type = item.AttachmentType.Trim().ToLowerInvariant();
        if (type is not ("static" or "record" or "excel_export" or "word_report"))
            throw new WorkflowValidationException("Select a supported attachment type.");
        var name = item.DisplayName.Trim();
        if (name.Length is < 1 or > 250) throw new WorkflowValidationException("Enter an attachment display name.");
        if (type == "static" && !item.FileAssetId.HasValue) throw new WorkflowValidationException("Select a stored file for a static attachment.");
        if (type is "excel_export" or "word_report" && string.IsNullOrWhiteSpace(item.ExportModuleKey))
            throw new WorkflowValidationException("Select the module used to generate this attachment.");
        return new NormalizedMessageAttachment(type, name, item.FileAssetId, item.ExportModuleKey?.Trim());
    }

    private static string NormalizeJson(string? json, string label)
    {
        var value = string.IsNullOrWhiteSpace(json) ? "{}" : json.Trim();
        try
        {
            using var document = JsonDocument.Parse(value);
            if (document.RootElement.ValueKind != JsonValueKind.Object)
                throw new WorkflowValidationException($"The {label} must be a JSON object.");
            return JsonSerializer.Serialize(document.RootElement);
        }
        catch (JsonException)
        {
            throw new WorkflowValidationException($"The {label} is not valid structured configuration.");
        }
    }

    private static IReadOnlyDictionary<string, string> BuildSampleParameters(IReadOnlyDictionary<string, string>? supplied)
    {
        var values = MessageTemplatePolicy.Parameters.ToDictionary(item => item.Key, item => item.SampleValue, StringComparer.OrdinalIgnoreCase);
        if (supplied is null) return values;
        foreach (var pair in supplied)
        {
            if (!values.ContainsKey(pair.Key)) throw new WorkflowValidationException($"Unsupported message parameter: {pair.Key}");
            values[pair.Key] = pair.Value;
        }
        return values;
    }

    private static string ValidateEmail(string email)
    {
        try
        {
            var address = new MailAddress(email.Trim());
            if (!string.Equals(address.Address, email.Trim(), StringComparison.OrdinalIgnoreCase)) throw new FormatException();
            return address.Address;
        }
        catch (FormatException)
        {
            throw new WorkflowValidationException("Enter a valid test recipient email address.");
        }
    }

    private static IReadOnlyList<string> ReadRecipientTypes(string json)
    {
        using var document = JsonDocument.Parse(json);
        var result = new List<string>();
        foreach (var property in document.RootElement.EnumerateObject())
            if (property.Name is "to" or "cc" or "bcc") result.Add($"{property.Name.ToUpperInvariant()}: configured by rule");
        return result.Count == 0 ? ["No recipients configured"] : result;
    }

    private static void AddTemplateParameters(
        SqlCommand command,
        Guid templateId,
        NormalizedMessageTemplate request,
        Guid? userAccountId)
    {
        command.Parameters.AddWithValue("@id", templateId);
        command.Parameters.AddWithValue("@key", request.MessageKey);
        command.Parameters.AddWithValue("@name", request.Name);
        command.Parameters.AddWithValue("@description", ToDbValue(request.InternalDescription));
        command.Parameters.AddWithValue("@active", request.IsActive);
        command.Parameters.AddWithValue("@userId", ToDbValue(userAccountId));
    }

    private sealed record NormalizedMessageTemplate(
        string MessageKey,
        string Name,
        string? InternalDescription,
        string SubjectTemplate,
        string PlainTextTemplate,
        string? HtmlTemplate,
        string RecipientConfigJson,
        string EventType,
        string ConditionConfigJson,
        string ScheduleConfigJson,
        bool IsActive,
        IReadOnlyList<NormalizedMessageAttachment> Attachments);

    private sealed record NormalizedMessageAttachment(
        string AttachmentType,
        string DisplayName,
        Guid? FileAssetId,
        string? ExportModuleKey);

    private sealed record MessageWorkRow(
        Guid Id,
        int AttemptCount,
        int MaxAttempts,
        string SubjectTemplate,
        string PlainTextTemplate,
        string? HtmlTemplate,
        string ParametersJson);
}

public sealed record MessageDeliveryWorkItem(
    Guid Id,
    int AttemptCount,
    int MaxAttempts,
    OutboundEmail Email);
