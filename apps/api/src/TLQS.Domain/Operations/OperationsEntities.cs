namespace TLQS.Domain.Operations;

public sealed class AuditLog
{
    public Guid Id { get; set; }
    public Guid? UserAccountId { get; set; }
    public Guid? RecordId { get; set; }
    public string EntityName { get; set; } = string.Empty;
    public Guid? EntityId { get; set; }
    public string Action { get; set; } = string.Empty;
    public string? Summary { get; set; }
    public string? BeforeJson { get; set; }
    public string? AfterJson { get; set; }
    public string? IpAddress { get; set; }
    public string? UserAgent { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class Notification
{
    public Guid Id { get; set; }
    public Guid UserAccountId { get; set; }
    public Guid? RelatedActionId { get; set; }
    public Guid? RecordId { get; set; }
    public string NotificationType { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string? Body { get; set; }
    public string DeliveryChannel { get; set; } = "in_app";
    public DateTimeOffset? ScheduledFor { get; set; }
    public DateTimeOffset? SentAt { get; set; }
    public DateTimeOffset? ReadAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? ArchivedAt { get; set; }
    public byte[] RowVersion { get; set; } = [];
}

