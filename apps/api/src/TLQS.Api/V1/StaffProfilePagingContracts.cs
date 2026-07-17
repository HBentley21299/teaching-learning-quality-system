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
    int OverdueActionCount);
