using TLQS.Application.Workflows;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class ElevateProgressPolicyTests
{
    [Theory]
    [InlineData(null, "2026/27")]
    [InlineData("", "2026/27")]
    [InlineData("  ", "2026/27")]
    [InlineData("all", null)]
    [InlineData(" ALL ", null)]
    [InlineData("2024/25", "2024/25")]
    [InlineData(" 2025/26 ", "2025/26")]
    public void ExplicitAllAndHistoricalYearsDoNotChangeTheDefault(string? requested, string? expected)
    {
        Assert.True(ElevateProgressPolicy.TryResolveAcademicYear(requested, "2026/27", out var year));
        Assert.Equal(expected, year);
    }

    [Theory]
    [InlineData("2024/26")]
    [InlineData("2024-25")]
    [InlineData("0000/01")]
    [InlineData("9999/00")]
    [InlineData("2026/2027")]
    [InlineData("invalid")]
    public void MalformedOrOutOfRangeYearsFailWithoutThrowing(string requested) =>
        Assert.False(ElevateProgressPolicy.TryResolveAcademicYear(requested, "2026/27", out _));
}
