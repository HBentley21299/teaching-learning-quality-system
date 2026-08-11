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
