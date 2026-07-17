namespace TLQS.Api.V1;

public sealed record AcademicYearSummary(
    string AcademicYear,
    DateOnly StartDate,
    DateOnly EndDate,
    bool IsCurrent,
    bool IsFuture);

public sealed record ElevateStatusCpdSummary(
    Guid CpdEventId,
    string Title,
    DateOnly EventDate);

public sealed record ElevateStatusLevelSummary(
    int LevelNumber,
    string LevelKey,
    string Name,
    int RequiredSessions,
    string? RequirementLabel,
    bool IsEligible,
    bool IsAwarded,
    Guid? EvidenceCpdEventId,
    string? ImplementationImpact,
    int? AttendanceCountAtAward,
    DateTimeOffset? AwardedAt,
    string? AwardedByName);

public sealed record ElevateStatusSummary(
    Guid StaffId,
    string AcademicYear,
    int InternalCpdSessionsAttended,
    bool CanSubmitExplorerEvidence,
    bool CanManageControlledLevels,
    IReadOnlyList<ElevateStatusCpdSummary> EligibleInternalCpd,
    IReadOnlyList<ElevateStatusLevelSummary> Levels);

public sealed record SaveElevateStatusLevelRequest(
    string AcademicYear,
    bool Confirmed,
    Guid? EvidenceCpdEventId,
    string? ImplementationImpact);
