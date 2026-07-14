namespace TLQS.Api.V1;

public sealed record AdminWorkScrutinyRecordSummary(
    Guid Id,
    string Title,
    string? Summary,
    Guid? OrgUnitId,
    string? OrgUnitCode,
    string? OrgUnitName,
    string? ParentOrgUnitCode,
    DateOnly? RecordDate,
    DateTimeOffset CreatedAt,
    string? OwnerDisplayName,
    Guid SubmissionId,
    string SubmissionStatus,
    DateTimeOffset? ArchivedAt,
    int OpenActionCount,
    int CompletedActionCount);

public sealed record RecordAuditSummary(
    Guid Id,
    string Action,
    string? Summary,
    string ActorName,
    string? BeforeJson,
    string? AfterJson,
    DateTimeOffset CreatedAt);

public sealed record AdminWorkScrutinyActionSummary(
    Guid Id,
    string Title,
    string? OwnerDisplayName,
    DateOnly? DueDate,
    DateOnly? CompletedDate,
    string? StatusKey,
    DateTimeOffset? ArchivedAt);
