using TLQS.Application.Reporting;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class MonthlyActivityAggregatorTests
{
    [Fact]
    public void Aggregate_GroupsRecordsByCalendarMonthInChronologicalOrder()
    {
        var records = new[]
        {
            new MonthlyActivityInput(new DateOnly(2026, 3, 28), "learning_walk"),
            new MonthlyActivityInput(new DateOnly(2026, 1, 4), "learning_walk"),
            new MonthlyActivityInput(new DateOnly(2026, 3, 2), "learning_walk")
        };

        var result = MonthlyActivityAggregator.Aggregate(
            records,
            new DateOnly(2026, 1, 1),
            new DateOnly(2026, 3, 31),
            "learning_walk");

        Assert.Equal(
            new[]
            {
                (new DateOnly(2026, 1, 1), 1L),
                (new DateOnly(2026, 2, 1), 0L),
                (new DateOnly(2026, 3, 1), 2L)
            },
            result.Select(point => (point.Month, point.Count)));
    }

    [Fact]
    public void Aggregate_InsertsEveryEmptyMonthAsZero()
    {
        var result = MonthlyActivityAggregator.Aggregate(
            Array.Empty<MonthlyActivityInput>(),
            new DateOnly(2025, 11, 15),
            new DateOnly(2026, 2, 12),
            "cpd_event");

        Assert.Equal(4, result.Count);
        Assert.All(result, point => Assert.Equal(0, point.Count));
        Assert.All(result, point => Assert.Equal("cpd_event", point.RecordType));
    }

    [Fact]
    public void Aggregate_AppliesTheSelectedReportingPeriod()
    {
        var records = new[]
        {
            new MonthlyActivityInput(new DateOnly(2025, 12, 31), "work_scrutiny"),
            new MonthlyActivityInput(new DateOnly(2026, 1, 1), "work_scrutiny"),
            new MonthlyActivityInput(new DateOnly(2026, 2, 15), "work_scrutiny"),
            new MonthlyActivityInput(new DateOnly(2026, 3, 1), "work_scrutiny")
        };

        var result = MonthlyActivityAggregator.Aggregate(
            records,
            new DateOnly(2026, 1, 1),
            new DateOnly(2026, 2, 28),
            "work_scrutiny");

        Assert.Equal(new long[] { 1, 1 }, result.Select(point => point.Count));
    }
}
