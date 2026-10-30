using TLQS.Api.V1;

namespace TLQS.Api.Data;

public sealed record ElevateStatusDashboardSourceRow(
    Guid StaffId, string StaffName, Guid? OrgUnitId, string? AreaCode, string? AreaName, string? ParentAreaCode,
    int QualifyingAttendanceCount, int? AwardLevel, int? AwardAttendanceCount, DateTimeOffset? ConfirmedAt);

public static class ElevateStatusDashboardBuilder
{
    private static readonly string[] LevelNames =
    ["Not yet awarded", "Elevate Explorer", "Elevate Storyteller", "Elevate Innovator", "Elevate Champion", "Elevate Changemaker"];

    public static IReadOnlyList<ElevateStatusStaffDashboardSummary> Staff(IEnumerable<ElevateStatusDashboardSourceRow> source) =>
        source.GroupBy(row => row.StaffId).Select(group =>
        {
            var staff = group.First();
            var awards = group.Where(row => row.AwardLevel is >= 1 and <= 5)
                .GroupBy(row => row.AwardLevel!.Value).ToDictionary(level => level.Key, level => level.OrderByDescending(row => row.ConfirmedAt).First());
            var currentLevel = 0;
            DateTimeOffset? lastConfirmedAt = null;
            // Match the individual status page: later confirmations never bridge a missing or invalid earlier award.
            for (var level = 1; level <= 5; level++)
            {
                if (!awards.TryGetValue(level, out var award) || !award.AwardAttendanceCount.HasValue || award.AwardAttendanceCount.Value < level * 3) break;
                currentLevel = level;
                lastConfirmedAt = award.ConfirmedAt;
            }

            int? nextLevel = currentLevel == 5 ? null : currentLevel + 1;
            return new ElevateStatusStaffDashboardSummary(staff.StaffId, staff.StaffName, staff.OrgUnitId,
                staff.AreaCode, staff.AreaName, staff.ParentAreaCode, currentLevel, LevelNames[currentLevel],
                staff.QualifyingAttendanceCount, nextLevel, nextLevel.HasValue ? LevelNames[nextLevel.Value] : null,
                nextLevel.HasValue ? Math.Max(0, nextLevel.Value * 3 - staff.QualifyingAttendanceCount) : null,
                lastConfirmedAt);
        }).OrderBy(row => row.StaffName, StringComparer.CurrentCultureIgnoreCase).ThenBy(row => row.StaffId).ToArray();

    public static IReadOnlyList<ElevateStatusDashboardSummary> Areas(IEnumerable<ElevateStatusStaffDashboardSummary> staff) =>
        staff.GroupBy(row => (row.OrgUnitId, row.AreaCode, row.AreaName, row.ParentAreaCode))
            .OrderBy(group => group.Key.AreaName).ThenBy(group => group.Key.AreaCode)
            .Select(group => new ElevateStatusDashboardSummary(group.Key.OrgUnitId, group.Key.AreaCode,
                group.Key.AreaName, group.Key.ParentAreaCode, group.LongCount(),
                group.Count(row => row.CurrentLevel >= 1), group.Count(row => row.CurrentLevel >= 2),
                group.Count(row => row.CurrentLevel >= 3), group.Count(row => row.CurrentLevel >= 4),
                group.Count(row => row.CurrentLevel >= 5))).ToArray();
}
