using TLQS.Api.Data;
using TLQS.Api.V1;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class StaffProfileListQueryTests
{
    [Fact]
    public void FilterTextAndSortInjectionNeverBecomeSqlAndPagingFollowsTheFilteredSource()
    {
        var attack = "'; DROP TABLE people.staff;--";
        var plan = StaffProfileListQuerySql.Build("SELECT Id, Title FROM scoped_source", new ListQuery(Search: "  Amélie\t50% [literal]  ", Status: attack, Person: "Retired reviewer", SortBy: attack, SortDirection: attack),
            new Dictionary<string, string> { ["title"] = "Title" }, "CreatedAt DESC");
        Assert.DoesNotContain(attack, plan.Sql);
        Assert.Equal(attack, plan.Parameters["@profileStatus"]);
        Assert.Equal("Amélie 50% [literal]", plan.Parameters["@profileSearch"]);
        Assert.Contains("FROM permitted source_row", plan.Sql);
        Assert.Contains("SELECT COUNT(*) AS TotalCount FROM filtered", plan.Sql);
        Assert.Contains("FROM filtered ORDER BY CreatedAt DESC, Id OFFSET", plan.Sql);
        Assert.Contains("@offset>=TotalCount", plan.Sql);
        Assert.Contains("FROM permitted WHERE", plan.Sql); // Historical options are not derived from one filtered page.
    }

    [Theory]
    [InlineData("asc", "ASC")]
    [InlineData("DESC", "DESC")]
    [InlineData("unrecognised", "ASC")]
    public void RecognisedSortKeysUseWhitelistedTypedColumnsAndKeepNullsLast(string direction, string expected)
    {
        var plan = StaffProfileListQuerySql.Build("SELECT * FROM permitted_input", new ListQuery(SortBy: "DURATION", SortDirection: direction),
            new Dictionary<string, string> { ["duration"] = "DurationMinutes" }, "EventDate DESC");
        Assert.Contains($"CASE WHEN DurationMinutes IS NULL THEN 1 ELSE 0 END, DurationMinutes {expected}, Id OFFSET", plan.Sql);
        Assert.Contains("Latin1_General_100_CI_AI", plan.Sql);
        Assert.Contains("ESCAPE N'~'", plan.Sql);
    }
}
