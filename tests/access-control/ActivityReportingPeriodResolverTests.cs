using TLQS.Application.Reporting;
using TLQS.Application.Workflows;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class ActivityReportingPeriodResolverTests
{
    private static readonly DateOnly Today = new(2026, 7, 18);

    [Fact]
    public void Resolve_RejectsAnExplicitInvertedRange()
    {
        Assert.Throws<WorkflowValidationException>(() => ActivityReportingPeriodResolver.Resolve(
            [],
            new DateOnly(2026, 7, 1),
            new DateOnly(2026, 6, 30),
            Today));
    }

    [Fact]
    public void Resolve_FutureStartWithoutEndProducesAValidZeroMonth()
    {
        var start = new DateOnly(2027, 2, 1);

        var period = ActivityReportingPeriodResolver.Resolve([], start, null, Today);

        Assert.Equal(start, period.Start);
        Assert.Equal(start, period.End);
    }

    [Fact]
    public void Resolve_EndOnlyWithoutEligibleRecordsReturnsTrailingTwelveMonths()
    {
        var end = new DateOnly(2025, 4, 20);

        var period = ActivityReportingPeriodResolver.Resolve(
            [new DateOnly(2026, 1, 1)], null, end, Today);

        Assert.Equal(new DateOnly(2024, 5, 1), period.Start);
        Assert.Equal(end, period.End);
    }

    [Fact]
    public void Resolve_StartOnlyUsesTodayWhenAllRecordsPrecedeTheStart()
    {
        var start = new DateOnly(2026, 4, 1);

        var period = ActivityReportingPeriodResolver.Resolve(
            [new DateOnly(2025, 1, 1)], start, null, Today);

        Assert.Equal(start, period.Start);
        Assert.Equal(Today, period.End);
    }

    [Fact]
    public void Resolve_ImplicitLongHistoryIsCappedAtTwentyFourMonths()
    {
        var period = ActivityReportingPeriodResolver.Resolve(
            [new DateOnly(2020, 1, 1), new DateOnly(2026, 6, 30)], null, null, Today);

        Assert.Equal(new DateOnly(2024, 7, 1), period.Start);
        Assert.Equal(new DateOnly(2026, 6, 30), period.End);
    }
}
