namespace TLQS.Api.V1;

public sealed record MessageTemplateSummary(
    Guid Id,
    string MessageKey,
    string Name,
    string? InternalDescription,
    bool IsActive,
    bool IsDeleted,
    int VersionNumber,
    string SubjectTemplate,
    string PlainTextTemplate,
    string? HtmlTemplate,
    string RecipientConfigJson,
    string EventType,
    string ConditionConfigJson,
    string ScheduleConfigJson,
    DateTimeOffset CreatedAt,
    DateTimeOffset? UpdatedAt,
    int PendingCount,
    int FailedCount,
    int SentCount);

public sealed record SaveMessageTemplateRequest(
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
    IReadOnlyList<SaveMessageAttachmentRequest>? Attachments = null);

public sealed record SaveMessageAttachmentRequest(
    string AttachmentType,
    string DisplayName,
    Guid? FileAssetId,
    string? ExportModuleKey);

public sealed record SendTestMessageRequest(string RecipientEmail, IReadOnlyDictionary<string, string>? SampleParameters);
public sealed record SetMessageTemplateStatusRequest(bool IsActive, bool Restore, string Reason);

public sealed record MessageDeliverySummary(
    Guid Id,
    string TemplateName,
    int TemplateVersion,
    string TriggeringEvent,
    string Status,
    string Recipients,
    int AttemptCount,
    DateTimeOffset QueuedAt,
    DateTimeOffset? DeliveredAt,
    DateTimeOffset? FailedAt,
    string? LastError,
    string? ProviderResponseId);

public sealed record MessagingParameterSummary(string Key, string Label, string Category, string SampleValue);
public sealed record RetryMessageRequest(string Reason);

public sealed record MessageTemplateVersionSummary(
    Guid Id,
    int VersionNumber,
    string SubjectTemplate,
    string PlainTextTemplate,
    string? HtmlTemplate,
    string RecipientConfigJson,
    DateTimeOffset CreatedAt,
    string? CreatedBy);

public sealed record MessagePreview(
    string Subject,
    string PlainTextBody,
    string? HtmlBody,
    IReadOnlyList<string> Recipients);

public sealed record SetMessageDeliveryStatusRequest(string Reason);
public sealed record DuplicateMessageTemplateRequest(string MessageKey, string Name);
