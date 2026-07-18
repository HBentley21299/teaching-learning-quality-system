namespace TLQS.Api.V1;

public sealed record PagedResult<T>(
    IReadOnlyList<T> Items,
    int Page,
    int PageSize,
    int TotalCount,
    int TotalPages);

public sealed record StaffProfileSectionSummary(
    int ReflectionCount,
    int SubmittedReflectionCount,
    int CoachingCount,
    int CpdCount,
    int InternalCpdCount,
    int ExternalCpdCount,
    int TotalCpdMinutes,
    int OpenActionCount,
    int CompletedActionCount,
    int OverdueActionCount,
    int LivCount,
    int ProbationCount);

public sealed record StaffProfileLivSummary(
    Guid Id,
    Guid RecordId,
    string Title,
    DateOnly? RecordDate,
    string? ReviewerName,
    string? ParentOrgUnitCode,
    string? OrgUnitCode,
    string CurrentStage,
    string Status,
    DateTimeOffset CreatedAt,
    DateTimeOffset? UpdatedAt);

public sealed record StaffProfileProbationSummary(
    Guid Id,
    Guid RecordId,
    string Title,
    string AcademicYear,
    string Status,
    byte CurrentObservationNumber,
    string? ParentOrgUnitCode,
    string? OrgUnitCode,
    DateTimeOffset CreatedAt,
    DateTimeOffset? UpdatedAt);
