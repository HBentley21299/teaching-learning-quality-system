namespace TLQS.Api.V1;

public sealed record DashboardConfigurationSummary(
    int SchemaVersion,
    DateTimeOffset? UpdatedAt,
    IReadOnlyList<DashboardProcessConfigurationSummary> Processes);

public sealed record DashboardProcessConfigurationSummary(
    string ProcessKey,
    string Label,
    bool IsEnabled,
    int DisplayOrder,
    string PrimaryVisual,
    bool ShowTrend,
    bool ShowAreaComparison,
    bool ShowOutcomes,
    bool ShowActions);

public sealed record SaveDashboardConfigurationRequest(
    IReadOnlyList<DashboardProcessConfigurationSummary> Processes);

public sealed record DashboardDimensionFactSummary(
    Guid SourceRecordId,
    string ProcessKey,
    DateOnly OccurredOn,
    Guid? OrgUnitId,
    string? AreaCode,
    string? AreaName,
    string? ParentAreaCode,
    string DimensionKey,
    string SeriesKey,
    string SeriesLabel,
    string ValueKey,
    string ValueLabel,
    decimal? NumericValue);

public sealed record ElevateStatusDashboardSummary(
    Guid? OrgUnitId,
    string? AreaCode,
    string? AreaName,
    string? ParentAreaCode,
    long StaffCount,
    int Level1OrAbove,
    int Level2OrAbove,
    int Level3OrAbove,
    int Level4OrAbove,
    int Level5OrAbove);

public sealed record StaffParticipationDashboardSummary(
    string ProcessKey,
    Guid? OrgUnitId,
    string? AreaCode,
    string? AreaName,
    string? ParentAreaCode,
    long ActiveStaffCount,
    int ParticipatingStaffCount);

public sealed record CpdAttendanceDashboardSummary(
    Guid StaffId,
    string StaffName,
    Guid? OrgUnitId,
    string? AreaCode,
    string? AreaName,
    string? ParentAreaCode,
    int AttendanceCount);

public sealed record LivLifecycleDashboardSummary(
    Guid? OrgUnitId,
    string? AreaCode,
    string? AreaName,
    string? ParentAreaCode,
    int RequestedCount,
    int CaseStartedCount,
    int ScheduledCount,
    int VisitedCount,
    int CompletedCount,
    int CompletedVisitCount,
    int PractitionerStaffCount,
    int PractitionerStaffDenominator);
