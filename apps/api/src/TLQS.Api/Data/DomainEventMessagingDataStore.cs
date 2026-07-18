using System.Text.Json;
using Microsoft.Data.SqlClient;
using TLQS.Api.Messaging;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    internal async Task<int> DispatchDomainEventBatchAsync(
        int batchSize,
        MessagingOptions options,
        CancellationToken cancellationToken)
    {
        var events = await ClaimDomainEventBatchAsync(batchSize, cancellationToken);
        foreach (var domainEvent in events)
        {
            try
            {
                await DispatchDomainEventAsync(domainEvent, options, cancellationToken);
            }
            catch (Exception exception)
            {
                await RecordDomainEventFailureAsync(domainEvent, exception, cancellationToken);
            }
        }
        return events.Count;
    }

    private async Task<IReadOnlyList<ClaimedDomainEvent>> ClaimDomainEventBatchAsync(
        int batchSize,
        CancellationToken cancellationToken)
    {
        var events = new List<ClaimedDomainEvent>();
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var command = new SqlCommand(
            """
            ;WITH claim AS (
                SELECT TOP (@batchSize) *
                FROM ops.domain_events WITH (UPDLOCK, READPAST, ROWLOCK)
                WHERE processed_at IS NULL
                  AND (locked_until IS NULL OR locked_until < sysutcdatetime())
                  AND attempt_count < 5
                ORDER BY occurred_at
            )
            UPDATE claim
            SET attempt_count = attempt_count + 1,
                processing_at = sysutcdatetime(),
                locked_until = DATEADD(minute, 5, sysutcdatetime()),
                processing_error = NULL
            OUTPUT inserted.id, inserted.event_type, inserted.aggregate_type,
                   inserted.aggregate_id, inserted.source_record_id, inserted.payload_json,
                   inserted.occurred_at, inserted.published_by_user_account_id,
                   inserted.attempt_count;
            """, connection);
        command.Parameters.AddWithValue("@batchSize", Math.Clamp(batchSize, 1, 50));
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            events.Add(new ClaimedDomainEvent(
                reader.GetGuid(0), reader.GetString(1), reader.GetString(2),
                reader.IsDBNull(3) ? null : reader.GetGuid(3),
                reader.IsDBNull(4) ? null : reader.GetGuid(4),
                reader.GetString(5), reader.GetFieldValue<DateTimeOffset>(6),
                reader.IsDBNull(7) ? null : reader.GetGuid(7), reader.GetInt32(8)));
        }
        return events;
    }

    private async Task DispatchDomainEventAsync(
        ClaimedDomainEvent domainEvent,
        MessagingOptions options,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            var context = await LoadDomainMessageContextAsync(
                connection, (SqlTransaction)transaction, domainEvent, cancellationToken);
            var rules = await LoadMessageDispatchRulesAsync(
                connection, (SqlTransaction)transaction, domainEvent.EventType, cancellationToken);
            var warnings = new List<string>();

            foreach (var rule in rules.Where(rule => ConditionsMatch(rule.ConditionConfigJson, context.Conditions)))
            {
                var recipients = await ResolveDomainEventRecipientsAsync(
                    connection, (SqlTransaction)transaction, rule.RecipientConfigJson, context, cancellationToken);
                if (recipients.Count == 0)
                {
                    warnings.Add($"Rule {rule.Id} had no resolvable recipients.");
                    continue;
                }

                var parameters = BuildDomainMessageParameters(
                    domainEvent.PayloadJson, context, recipients, options);
                var availableAt = ResolveMessageAvailability(rule.ScheduleConfigJson, domainEvent.OccurredAt, context.ActionDueDate);
                var outboxId = Guid.NewGuid();
                var inserted = false;
                await using (var insert = new SqlCommand(
                    """
                    IF NOT EXISTS (SELECT 1 FROM ops.message_outbox WHERE idempotency_key = @idempotencyKey)
                    BEGIN
                        INSERT INTO ops.message_outbox (
                            id, template_version_id, message_rule_id, source_record_id,
                            triggering_event, idempotency_key, parameter_values_json,
                            available_at, requested_by_user_account_id
                        ) VALUES (
                            @id, @versionId, @ruleId, @sourceRecordId,
                            @eventType, @idempotencyKey, @parameters,
                            @availableAt, @requestedBy
                        );
                        SELECT CONVERT(bit, 1);
                    END
                    ELSE SELECT CONVERT(bit, 0);
                    """, connection, (SqlTransaction)transaction))
                {
                    insert.Parameters.AddWithValue("@id", outboxId);
                    insert.Parameters.AddWithValue("@versionId", rule.TemplateVersionId);
                    insert.Parameters.AddWithValue("@ruleId", rule.Id);
                    insert.Parameters.AddWithValue("@sourceRecordId", ToDbValue(domainEvent.SourceRecordId));
                    insert.Parameters.AddWithValue("@eventType", domainEvent.EventType);
                    insert.Parameters.AddWithValue("@idempotencyKey", $"event:{domainEvent.Id:N}:rule:{rule.Id:N}");
                    insert.Parameters.AddWithValue("@parameters", JsonSerializer.Serialize(parameters));
                    insert.Parameters.AddWithValue("@availableAt", availableAt);
                    insert.Parameters.AddWithValue("@requestedBy", ToDbValue(domainEvent.PublishedByUserAccountId));
                    inserted = Convert.ToBoolean(await insert.ExecuteScalarAsync(cancellationToken));
                }
                if (!inserted) continue;

                foreach (var recipient in recipients)
                {
                    await using var insertRecipient = new SqlCommand(
                        """
                        INSERT INTO ops.message_outbox_recipients (
                            outbox_id, recipient_type, email_address, display_name, staff_id
                        ) VALUES (@outboxId, @type, @email, @displayName, @staffId);
                        """, connection, (SqlTransaction)transaction);
                    insertRecipient.Parameters.AddWithValue("@outboxId", outboxId);
                    insertRecipient.Parameters.AddWithValue("@type", recipient.Type);
                    insertRecipient.Parameters.AddWithValue("@email", recipient.EmailAddress);
                    insertRecipient.Parameters.AddWithValue("@displayName", recipient.DisplayName);
                    insertRecipient.Parameters.AddWithValue("@staffId", recipient.StaffId);
                    await insertRecipient.ExecuteNonQueryAsync(cancellationToken);
                }
            }

            await using (var complete = new SqlCommand(
                """
                UPDATE ops.domain_events
                SET processed_at = sysutcdatetime(), processing_at = NULL, locked_until = NULL,
                    processing_error = @warning
                WHERE id = @id;
                """, connection, (SqlTransaction)transaction))
            {
                complete.Parameters.AddWithValue("@id", domainEvent.Id);
                complete.Parameters.AddWithValue("@warning", ToDbValue(warnings.Count == 0 ? null : string.Join(' ', warnings)));
                await complete.ExecuteNonQueryAsync(cancellationToken);
            }
            await transaction.CommitAsync(cancellationToken);
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    private static async Task<IReadOnlyList<MessageDispatchRule>> LoadMessageDispatchRulesAsync(
        SqlConnection connection,
        SqlTransaction transaction,
        string eventType,
        CancellationToken cancellationToken)
    {
        var rules = new List<MessageDispatchRule>();
        await using var command = new SqlCommand(
            """
            SELECT message_rule.id, template.current_version_id, version.recipient_config_json,
                   message_rule.condition_config_json, message_rule.schedule_config_json
            FROM ops.message_rules message_rule
            JOIN ops.message_templates template ON template.id = message_rule.message_template_id
            JOIN ops.message_template_versions version ON version.id = template.current_version_id
            WHERE message_rule.event_type = @eventType
              AND message_rule.is_active = 1 AND message_rule.archived_at IS NULL
              AND template.is_active = 1 AND template.archived_at IS NULL;
            """, connection, transaction);
        command.Parameters.AddWithValue("@eventType", eventType);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
            rules.Add(new MessageDispatchRule(
                reader.GetGuid(0), reader.GetGuid(1), reader.GetString(2),
                reader.GetString(3), reader.GetString(4)));
        return rules;
    }

    private static async Task<DomainMessageContext> LoadDomainMessageContextAsync(
        SqlConnection connection,
        SqlTransaction transaction,
        ClaimedDomainEvent domainEvent,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            """
            DECLARE @actionId uniqueidentifier = CASE WHEN @aggregateType = N'action' THEN @aggregateId END;
            DECLARE @recordId uniqueidentifier = COALESCE(
                @sourceRecordId,
                (SELECT source_record_id FROM quality.actions WHERE id = @actionId),
                CASE WHEN @aggregateType = N'record' THEN @aggregateId END
            );

            SELECT
                COALESCE(action.subject_staff_id, record.subject_staff_id),
                action.owner_staff_id,
                record.owner_staff_id,
                COALESCE(record_creator.staff_id, action_creator.staff_id),
                COALESCE(primary_manager.manager_staff_id, subject.line_manager_staff_id),
                record.record_type,
                record.title,
                submission.status,
                action.title,
                CONVERT(nvarchar(10), action.due_date, 23),
                action_status.value_key,
                subject.display_name,
                subject.email,
                manager.display_name,
                CASE WHEN parent_unit.id IS NULL THEN unit.name ELSE parent_unit.name END,
                CASE WHEN parent_unit.id IS NULL THEN NULL ELSE unit.name END,
                CASE WHEN parent_unit.id IS NULL THEN unit.code ELSE parent_unit.code END,
                CASE WHEN parent_unit.id IS NULL THEN NULL ELSE unit.code END,
                CONVERT(nvarchar(10), record.record_date, 23)
            FROM (VALUES (1)) root(value)
            LEFT JOIN quality.actions action ON action.id = @actionId
            LEFT JOIN core.records record ON record.id = @recordId
            OUTER APPLY (
                SELECT TOP (1) form_submission.status
                FROM forms.form_submissions form_submission
                WHERE form_submission.record_id = record.id
                ORDER BY form_submission.created_at DESC
            ) submission
            LEFT JOIN people.staff subject ON subject.id = COALESCE(action.subject_staff_id, record.subject_staff_id)
            OUTER APPLY (
                SELECT TOP (1) relationship.manager_staff_id
                FROM org.staff_manager_relationships relationship
                WHERE relationship.staff_id = subject.id
                  AND relationship.is_primary = 1
                  AND relationship.archived_at IS NULL
                  AND (relationship.active_from IS NULL OR relationship.active_from <= CONVERT(date, sysutcdatetime()))
                  AND (relationship.active_to IS NULL OR relationship.active_to >= CONVERT(date, sysutcdatetime()))
                ORDER BY relationship.active_from DESC
            ) primary_manager
            LEFT JOIN people.staff manager ON manager.id = COALESCE(primary_manager.manager_staff_id, subject.line_manager_staff_id)
            LEFT JOIN auth.user_accounts record_creator ON record_creator.id = record.created_by_user_account_id
            LEFT JOIN auth.user_accounts action_creator ON action_creator.id = action.created_by_user_account_id
            LEFT JOIN core.lookup_values action_status ON action_status.id = action.status_lookup_value_id
            LEFT JOIN org.org_units unit ON unit.id = COALESCE(record.org_unit_id, subject.primary_org_unit_id)
            LEFT JOIN org.org_units parent_unit ON parent_unit.id = unit.parent_org_unit_id;
            """, connection, transaction);
        command.Parameters.AddWithValue("@aggregateType", domainEvent.AggregateType);
        command.Parameters.AddWithValue("@aggregateId", ToDbValue(domainEvent.AggregateId));
        command.Parameters.AddWithValue("@sourceRecordId", ToDbValue(domainEvent.SourceRecordId));
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) return DomainMessageContext.Empty;

        Guid? GuidValue(int ordinal) => reader.IsDBNull(ordinal) ? null : reader.GetGuid(ordinal);
        string? Text(int ordinal) => reader.IsDBNull(ordinal) ? null : reader.GetString(ordinal);
        var conditions = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase)
        {
            ["recordType"] = Text(5), ["recordStatus"] = Text(7),
            ["facultyCode"] = Text(16), ["teamCode"] = Text(17)
        };
        DateOnly? dueDate = DateOnly.TryParse(Text(9), out var parsedDueDate) ? parsedDueDate : null;
        return new DomainMessageContext(
            GuidValue(0), GuidValue(1), GuidValue(2), GuidValue(3), GuidValue(4),
            Text(5), Text(6), Text(7), Text(8), dueDate, Text(10), Text(11), Text(12),
            Text(13), Text(14), Text(15), Text(16), Text(17), Text(18), conditions);
    }

    private static async Task<IReadOnlyList<ResolvedMessageRecipient>> ResolveDomainEventRecipientsAsync(
        SqlConnection connection,
        SqlTransaction transaction,
        string recipientConfigJson,
        DomainMessageContext context,
        CancellationToken cancellationToken)
    {
        using var document = JsonDocument.Parse(recipientConfigJson);
        var requested = new List<(string Type, Guid StaffId)>();
        foreach (var type in new[] { "to", "cc", "bcc" })
        {
            if (!document.RootElement.TryGetProperty(type, out var values) || values.ValueKind != JsonValueKind.Array) continue;
            foreach (var value in values.EnumerateArray())
            {
                var staffId = value.GetString() switch
                {
                    "staff" => context.SubjectStaffId,
                    "action_owner" => context.ActionOwnerStaffId,
                    "record_creator" => context.RecordCreatorStaffId,
                    "line_manager" => context.LineManagerStaffId,
                    "reviewer" => context.ReviewerStaffId,
                    _ => null
                };
                if (staffId.HasValue) requested.Add((type, staffId.Value));
            }
        }
        if (requested.Count == 0) return [];

        var staffIds = requested.Select(item => item.StaffId).Distinct().ToArray();
        var parameterNames = staffIds.Select((_, index) => $"@staff{index}").ToArray();
        await using var command = new SqlCommand(
            $"SELECT id, email, display_name FROM people.staff WHERE archived_at IS NULL AND account_status = N'active' AND id IN ({string.Join(',', parameterNames)});",
            connection, transaction);
        for (var index = 0; index < staffIds.Length; index++) command.Parameters.AddWithValue(parameterNames[index], staffIds[index]);
        var staff = new Dictionary<Guid, (string Email, string Name)>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
            staff[reader.GetGuid(0)] = (reader.GetString(1), reader.GetString(2));

        return requested
            .Where(item => staff.ContainsKey(item.StaffId))
            .Select(item => new ResolvedMessageRecipient(item.Type, staff[item.StaffId].Email, staff[item.StaffId].Name, item.StaffId))
            .DistinctBy(item => (item.Type, item.EmailAddress.ToUpperInvariant()))
            .ToArray();
    }

    private static Dictionary<string, string> BuildDomainMessageParameters(
        string payloadJson,
        DomainMessageContext context,
        IReadOnlyList<ResolvedMessageRecipient> recipients,
        MessagingOptions options)
    {
        var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["recipient.firstName"] = recipients[0].DisplayName.Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? recipients[0].DisplayName,
            ["recipient.fullName"] = recipients[0].DisplayName,
            ["staff.fullName"] = context.SubjectName ?? "",
            ["staff.email"] = context.SubjectEmail ?? "",
            ["staff.lineManagerName"] = context.LineManagerName ?? "",
            ["organisation.faculty"] = context.FacultyName ?? "",
            ["organisation.team"] = context.TeamName ?? "",
            ["action.title"] = context.ActionTitle ?? "",
            ["action.dueDate"] = context.ActionDueDate?.ToString("dd MMMM yyyy") ?? "",
            ["action.status"] = context.ActionStatus ?? "",
            ["record.type"] = HumanizeMessageValue(context.RecordType),
            ["record.title"] = context.RecordTitle ?? "",
            ["record.status"] = HumanizeMessageValue(context.RecordStatus),
            // Direct record routes are not public SPA entry points yet. Keep links valid until deep-link routing lands.
            ["record.reportUrl"] = options.ApplicationUrl,
            ["cpd.title"] = string.Equals(context.RecordType, "cpd_event", StringComparison.OrdinalIgnoreCase) ? context.RecordTitle ?? "" : "",
            ["cpd.date"] = string.Equals(context.RecordType, "cpd_event", StringComparison.OrdinalIgnoreCase) && DateOnly.TryParse(context.RecordDate, out var eventDate)
                ? eventDate.ToString("dd MMMM yyyy") : "",
            ["application.url"] = options.ApplicationUrl
        };
        using var payload = JsonDocument.Parse(payloadJson);
        if (payload.RootElement.TryGetProperty("parameters", out var parameters) && parameters.ValueKind == JsonValueKind.Object)
        {
            foreach (var parameter in parameters.EnumerateObject()) values[parameter.Name] = parameter.Value.ToString();
        }
        return values;
    }

    private static bool ConditionsMatch(string conditionConfigJson, IReadOnlyDictionary<string, string?> context)
    {
        using var document = JsonDocument.Parse(conditionConfigJson);
        if (document.RootElement.ValueKind != JsonValueKind.Object) return true;
        foreach (var condition in document.RootElement.EnumerateObject())
        {
            var expected = condition.Value.ToString();
            if (string.IsNullOrWhiteSpace(expected)) continue;
            if (!context.TryGetValue(condition.Name, out var actual)
                || !string.Equals(expected, actual, StringComparison.OrdinalIgnoreCase)) return false;
        }
        return true;
    }

    private static DateTimeOffset ResolveMessageAvailability(
        string scheduleConfigJson,
        DateTimeOffset occurredAt,
        DateOnly? actionDueDate)
    {
        using var document = JsonDocument.Parse(scheduleConfigJson);
        if (!document.RootElement.TryGetProperty("mode", out var mode)
            || !string.Equals(mode.GetString(), "relative", StringComparison.OrdinalIgnoreCase)) return DateTimeOffset.UtcNow;
        var days = document.RootElement.TryGetProperty("daysOffset", out var offset) && offset.TryGetInt32(out var value)
            ? Math.Clamp(value, -365, 365) : 0;
        var basis = actionDueDate.HasValue
            ? new DateTimeOffset(actionDueDate.Value.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero)
            : occurredAt;
        return basis.AddDays(days);
    }

    private async Task RecordDomainEventFailureAsync(
        ClaimedDomainEvent domainEvent,
        Exception exception,
        CancellationToken cancellationToken)
    {
        var message = exception.Message.Replace('\r', ' ').Replace('\n', ' ').Trim();
        message = message[..Math.Min(message.Length, 1800)];
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var command = new SqlCommand(
            """
            UPDATE ops.domain_events
            SET processing_at = NULL, locked_until = NULL, processing_error = @error,
                processed_at = CASE WHEN attempt_count >= 5 THEN sysutcdatetime() ELSE NULL END
            WHERE id = @id;
            """, connection);
        command.Parameters.AddWithValue("@id", domainEvent.Id);
        command.Parameters.AddWithValue("@error", message);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task InsertDomainEventAsync(
        SqlConnection connection,
        SqlTransaction transaction,
        string eventType,
        string aggregateType,
        Guid? aggregateId,
        Guid? sourceRecordId,
        string payloadJson,
        Guid? publishedByUserAccountId,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            """
            INSERT INTO ops.domain_events (
                event_type, aggregate_type, aggregate_id, source_record_id,
                payload_json, published_by_user_account_id
            ) VALUES (@eventType, @aggregateType, @aggregateId, @sourceRecordId, @payload, @publishedBy);
            """, connection, transaction);
        command.Parameters.AddWithValue("@eventType", eventType);
        command.Parameters.AddWithValue("@aggregateType", aggregateType);
        command.Parameters.AddWithValue("@aggregateId", ToDbValue(aggregateId));
        command.Parameters.AddWithValue("@sourceRecordId", ToDbValue(sourceRecordId));
        command.Parameters.AddWithValue("@payload", payloadJson);
        command.Parameters.AddWithValue("@publishedBy", ToDbValue(publishedByUserAccountId));
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static string HumanizeMessageValue(string? value) => string.IsNullOrWhiteSpace(value)
        ? "" : string.Join(' ', value.Split('_', '-', StringSplitOptions.RemoveEmptyEntries)
            .Select(word => char.ToUpperInvariant(word[0]) + word[1..]));

    private sealed record ClaimedDomainEvent(
        Guid Id, string EventType, string AggregateType, Guid? AggregateId,
        Guid? SourceRecordId, string PayloadJson, DateTimeOffset OccurredAt,
        Guid? PublishedByUserAccountId, int AttemptCount);
    private sealed record MessageDispatchRule(
        Guid Id, Guid TemplateVersionId, string RecipientConfigJson,
        string ConditionConfigJson, string ScheduleConfigJson);
    private sealed record ResolvedMessageRecipient(
        string Type, string EmailAddress, string DisplayName, Guid StaffId);
    private sealed record DomainMessageContext(
        Guid? SubjectStaffId, Guid? ActionOwnerStaffId, Guid? ReviewerStaffId,
        Guid? RecordCreatorStaffId, Guid? LineManagerStaffId,
        string? RecordType, string? RecordTitle, string? RecordStatus,
        string? ActionTitle, DateOnly? ActionDueDate, string? ActionStatus,
        string? SubjectName, string? SubjectEmail, string? LineManagerName,
        string? FacultyName, string? TeamName, string? FacultyCode, string? TeamCode,
        string? RecordDate, IReadOnlyDictionary<string, string?> Conditions)
    {
        public static DomainMessageContext Empty { get; } = new(
            null, null, null, null, null, null, null, null, null, null, null,
            null, null, null, null, null, null, null, null,
            new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase));
    }
}
