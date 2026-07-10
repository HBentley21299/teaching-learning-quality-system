namespace TLQS.Domain.Common;

public abstract class AuditableEntity
{
    public Guid Id { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? UpdatedAt { get; set; }
    public DateTimeOffset? ArchivedAt { get; set; }
    public byte[] RowVersion { get; set; } = [];

    public bool IsArchived => ArchivedAt.HasValue;
}

