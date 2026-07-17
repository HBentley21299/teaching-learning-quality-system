using TLQS.Application.Workflows;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class AcademicYearPolicyTests
{
    [Theory]
    [InlineData(2026, 7, 31, "2025/26")]
    [InlineData(2026, 8, 1, "2026/27")]
    [InlineData(2027, 7, 31, "2026/27")]
    public void GetKey_UsesAugustToJulyBoundary(int year, int month, int day, string expected)
    {
        Assert.Equal(expected, AcademicYearPolicy.GetKey(new DateOnly(year, month, day)));
    }

    [Theory]
    [InlineData("2026/27", true)]
    [InlineData("2026/28", false)]
    [InlineData("26/27", false)]
    [InlineData("", false)]
    public void TryGetBounds_ValidatesCanonicalKeys(string value, bool expected)
    {
        Assert.Equal(expected, AcademicYearPolicy.TryGetBounds(value, out _, out _));
    }
}
