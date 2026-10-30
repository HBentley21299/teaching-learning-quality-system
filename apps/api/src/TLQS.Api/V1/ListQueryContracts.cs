namespace TLQS.Api.V1;

public sealed record ListQuery(
    string? Search = null,
    string? Status = null,
    string? Type = null,
    string? Person = null,
    DateOnly? FromDate = null,
    DateOnly? ToDate = null,
    string? SortBy = null,
    string? SortDirection = null);

public sealed record ListFilterOptions(
    IReadOnlyList<string> Status,
    IReadOnlyList<string> Type,
    IReadOnlyList<string> Person);
