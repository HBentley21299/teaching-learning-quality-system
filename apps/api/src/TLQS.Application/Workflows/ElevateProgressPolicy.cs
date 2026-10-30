using System.Globalization;

namespace TLQS.Application.Workflows;

public static class ElevateProgressPolicy
{
    public static bool TryResolveAcademicYear(string? requested, string currentAcademicYear, out string? academicYear)
    {
        academicYear = string.IsNullOrWhiteSpace(requested) ? currentAcademicYear : requested.Trim();
        if (academicYear.Equals("all", StringComparison.OrdinalIgnoreCase))
        {
            academicYear = null;
            return true;
        }
        return academicYear.Length == 7
            && int.TryParse(academicYear.AsSpan(0, 4), NumberStyles.None, CultureInfo.InvariantCulture, out var startYear)
            && startYear is >= 1 and <= 9998
            && AcademicYearPolicy.TryGetBounds(academicYear, out _, out _);
    }
}
