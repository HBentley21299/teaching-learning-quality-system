using TLQS.Api.V1;

namespace TLQS.Api.Data;

public sealed record StaffProfileListSqlPlan(string Sql, IReadOnlyDictionary<string, object> Parameters);

/// <summary>Composes paging around an already permission-scoped source. User text is always parameterised.</summary>
public static class StaffProfileListQuerySql
{
    public static StaffProfileListSqlPlan Build(
        string permittedSource,
        ListQuery? query,
        IReadOnlyDictionary<string, string> sortableColumns,
        string defaultOrder)
    {
        query ??= new ListQuery();
        var chosen = sortableColumns.FirstOrDefault(pair => string.Equals(pair.Key, query.SortBy, StringComparison.OrdinalIgnoreCase));
        var direction = string.Equals(query.SortDirection, "desc", StringComparison.OrdinalIgnoreCase) ? "DESC" : "ASC";
        var order = chosen.Key is null ? defaultOrder : $"CASE WHEN {chosen.Value} IS NULL THEN 1 ELSE 0 END, {chosen.Value} {direction}";
        var sql = $$"""
            WITH permitted AS (
                {{permittedSource}}
            ), filtered AS (
                SELECT * FROM permitted source_row
                WHERE (@profileStatus IS NULL OR source_row.FilterStatus COLLATE Latin1_General_100_CI_AI = @profileStatus)
                  AND (@profileType IS NULL OR source_row.FilterType COLLATE Latin1_General_100_CI_AI = @profileType)
                  AND (@profilePerson IS NULL OR source_row.FilterPerson COLLATE Latin1_General_100_CI_AI = @profilePerson)
                  AND (@profileFromDate IS NULL OR source_row.FilterDate >= @profileFromDate)
                  AND (@profileToDate IS NULL OR source_row.FilterDate <= @profileToDate)
                  AND NOT EXISTS (
                      SELECT 1 FROM STRING_SPLIT(@profileSearch, N' ') term
                      WHERE term.value <> N'' AND source_row.SearchText COLLATE Latin1_General_100_CI_AI NOT LIKE
                          N'%' + REPLACE(REPLACE(REPLACE(REPLACE(term.value, N'~', N'~~'), N'%', N'~%'), N'_', N'~_'), N'[', N'~[') + N'%' ESCAPE N'~'
                  )
            ), totals AS (SELECT COUNT(*) AS TotalCount FROM filtered), page_window AS (
                SELECT TotalCount, CASE WHEN TotalCount=0 THEN 0 WHEN @offset>=TotalCount THEN ((TotalCount-1)/@pageSize)*@pageSize ELSE @offset END AS EffectiveOffset FROM totals
            )
            SELECT TotalCount,
                   (SELECT * FROM filtered ORDER BY {{order}}, Id OFFSET (SELECT EffectiveOffset FROM page_window) ROWS FETCH NEXT @pageSize ROWS ONLY FOR JSON PATH) AS ItemsJson,
                   (SELECT DISTINCT FilterStatus AS [value] FROM permitted WHERE NULLIF(LTRIM(RTRIM(FilterStatus)), N'') IS NOT NULL ORDER BY [value] FOR JSON PATH) AS StatusJson,
                   (SELECT DISTINCT FilterType AS [value] FROM permitted WHERE NULLIF(LTRIM(RTRIM(FilterType)), N'') IS NOT NULL ORDER BY [value] FOR JSON PATH) AS TypeJson,
                   (SELECT DISTINCT FilterPerson AS [value] FROM permitted WHERE NULLIF(LTRIM(RTRIM(FilterPerson)), N'') IS NOT NULL ORDER BY [value] FOR JSON PATH) AS PersonJson
            FROM page_window;
            """;
        return new StaffProfileListSqlPlan(sql, new Dictionary<string, object>
        {
            ["@profileStatus"] = Filter(query.Status), ["@profileType"] = Filter(query.Type), ["@profilePerson"] = Filter(query.Person),
            ["@profileSearch"] = string.Join(' ', (query.Search ?? "").Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)),
            ["@profileFromDate"] = query.FromDate.HasValue ? query.FromDate.Value.ToDateTime(TimeOnly.MinValue) : DBNull.Value,
            ["@profileToDate"] = query.ToDate.HasValue ? query.ToDate.Value.ToDateTime(TimeOnly.MinValue) : DBNull.Value
        });
    }

    private static object Filter(string? value) => string.IsNullOrWhiteSpace(value) || string.Equals(value, "all", StringComparison.OrdinalIgnoreCase) ? DBNull.Value : value.Trim();
}

public sealed partial class SqlFoundationDataStore
{
    private async Task<PagedResult<T>> QueryStaffProfilePageAsync<T>(
        string source,
        IReadOnlyDictionary<string, string> sortableColumns,
        string defaultOrder,
        ListQuery? query,
        int page,
        int pageSize,
        Action<Microsoft.Data.SqlClient.SqlCommand> bind,
        CancellationToken cancellationToken)
    {
        var plan = StaffProfileListQuerySql.Build(source, query, sortableColumns, defaultOrder);
        var pages = await QueryAsync(plan.Sql, command =>
        {
            bind(command);
            command.Parameters.AddWithValue("@offset", (long)(page - 1) * pageSize);
            command.Parameters.AddWithValue("@pageSize", pageSize);
            foreach (var (name, value) in plan.Parameters)
            {
                var parameter = command.Parameters.AddWithValue(name, value);
                if (name is "@profileFromDate" or "@profileToDate") parameter.SqlDbType = System.Data.SqlDbType.Date;
                else { parameter.SqlDbType = System.Data.SqlDbType.NVarChar; parameter.Size = -1; }
            }
        }, reader =>
        {
            var total = reader.GetInt32(0);
            var items = System.Text.Json.JsonSerializer.Deserialize<T[]>(GetStringOrNull(reader, 1) ?? "[]") ?? [];
            var totalPages = total == 0 ? 0 : (int)Math.Ceiling(total / (double)pageSize);
            return new PagedResult<T>(items, Math.Min(page, Math.Max(1, totalPages)), pageSize, total, totalPages,
                new ListFilterOptions(ReadOptions(GetStringOrNull(reader, 2) ?? "[]"), ReadOptions(GetStringOrNull(reader, 3) ?? "[]"), ReadOptions(GetStringOrNull(reader, 4) ?? "[]")));
        }, cancellationToken);
        return pages[0];
    }

    private static IReadOnlyList<string> ReadOptions(string json)
    {
        using var document = System.Text.Json.JsonDocument.Parse(json);
        return document.RootElement.EnumerateArray().Select(row => row.GetProperty("value").GetString()!)
            .Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
    }
}
