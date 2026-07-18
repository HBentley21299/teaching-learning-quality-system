using System.Globalization;

namespace TLQS.Application.Workflows;

public static class AcademicYearPolicy
{
    public static string GetKey(DateOnly date)
    {
        var startYear = date.Month >= 8 ? date.Year : date.Year - 1;
        return $"{startYear}/{(startYear + 1) % 100:00}";
    }

    public static string GetCurrentKey(DateTimeOffset? current = null) =>
        GetKey(DateOnly.FromDateTime((current ?? DateTimeOffset.UtcNow).UtcDateTime));

    public static bool TryGetBounds(string? academicYear, out DateOnly startDate, out DateOnly endDate)
    {
        startDate = default;
        endDate = default;
        if (academicYear is null
            || academicYear.Length != 7
            || academicYear[4] != '/'
            || !int.TryParse(academicYear[..4], NumberStyles.None, CultureInfo.InvariantCulture, out var startYear)
            || !int.TryParse(academicYear[5..], NumberStyles.None, CultureInfo.InvariantCulture, out var endYearSuffix)
            || (startYear + 1) % 100 != endYearSuffix)
        {
            return false;
        }

        startDate = new DateOnly(startYear, 8, 1);
        endDate = new DateOnly(startYear + 1, 7, 31);
        return true;
    }
}
