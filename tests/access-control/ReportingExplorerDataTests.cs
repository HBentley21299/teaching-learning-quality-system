using TLQS.Api.Data;
using TLQS.Api.V1;
using TLQS.Application.Security;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class ReportingExplorerDataTests
{
    [Fact]
    public void NamedStatusUsesContinuousValidAwardsAndRetainsStaffWithNoAwards()
    {
        var first = Staff("No award", 2);
        var gap = Staff("Missing first award", 12) with { AwardLevel = 4, AwardAttendanceCount = 12 };
        var valid = Staff("Two awards", 9);
        var invalid = valid with { AwardLevel = 3, AwardAttendanceCount = 8 };
        var rows = ElevateStatusDashboardBuilder.Staff([first, gap,
            valid with { AwardLevel = 1, AwardAttendanceCount = 3 },
            valid with { AwardLevel = 2, AwardAttendanceCount = 6 }, invalid]);
        Assert.Equal(3, rows.Count);
        Assert.Equal(0, rows.Single(row => row.StaffId == first.StaffId).CurrentLevel);
        Assert.Equal(1, rows.Single(row => row.StaffId == first.StaffId).SessionsToNextLevel);
        Assert.Equal(0, rows.Single(row => row.StaffId == gap.StaffId).CurrentLevel);
        var awarded = rows.Single(row => row.StaffId == valid.StaffId);
        Assert.Equal(2, awarded.CurrentLevel);
        Assert.Equal("Elevate Storyteller", awarded.CurrentLevelName);
        Assert.Equal(3, awarded.NextLevel);
        Assert.Equal(0, awarded.SessionsToNextLevel); // Attendance alone does not grant the next award.
        Assert.Equal(valid.ConfirmedAt, awarded.LastConfirmedAt);
        var aggregate = Assert.Single(ElevateStatusDashboardBuilder.Areas(rows));
        Assert.Equal(3, aggregate.StaffCount);
        Assert.Equal(1, aggregate.Level1OrAbove);
        Assert.Equal(1, aggregate.Level2OrAbove);
        Assert.Equal(0, aggregate.Level3OrAbove);
    }

    [Fact]
    public void CompletedStatusHasNoNextLevelAndAreasUseExactNamedCohort()
    {
        var staff = Staff("Complete", 16);
        var source = Enumerable.Range(1, 5).Select(level => staff with { AwardLevel = level, AwardAttendanceCount = level * 3 });
        var row = Assert.Single(ElevateStatusDashboardBuilder.Staff(source));
        Assert.Equal(5, row.CurrentLevel);
        Assert.Null(row.NextLevel); Assert.Null(row.NextLevelName); Assert.Null(row.SessionsToNextLevel);
        Assert.Equal(1, Assert.Single(ElevateStatusDashboardBuilder.Areas([row])).Level5OrAbove);
        Assert.Empty(ElevateStatusDashboardBuilder.Staff([]));
        Assert.Empty(ElevateStatusDashboardBuilder.Areas([]));
    }

    [Fact]
    public void ExplorerUsesSafeBusinessFieldsAndKeepsStableIdentityForAnswersAndChildRows()
    {
        var recordId = Guid.NewGuid(); var caseId = Guid.NewGuid();
        var unrelated = Guid.NewGuid();
        var primary = new ExportSheet("Form entries", ["Record ID", "LIV case ID", "Staff member", "Visible to staff", "Row version", "Visit 1 - Feedback [question-a]", "Visit 1 - Feedback [question-b]"],
            [[recordId.ToString(), caseId.ToString(), "Alex Example", "No", "010203", "First answer", "Second answer"]], false);
        var visits = new ExportSheet("Visits", ["LIV case ID", "Visit date", "Visit focus", "Visible to staff"],
            [[caseId.ToString(), "29 Oct 2026", "Planning", "No"], [unrelated.ToString(), "30 Oct 2026", "Outside record", "Yes"]], false);
        var workbook = Workbook(primary, visits);
        var data = DashboardRecordDataBuilder.Build("liv", workbook);
        Assert.Equal(recordId, Assert.Single(data.Rows).RecordId);
        Assert.DoesNotContain(data.Columns, column => column.Label.Contains("ID") || column.Label.Contains("version", StringComparison.OrdinalIgnoreCase) || column.Label.Contains("Visible"));
        var feedback = data.Columns.Where(column => column.Label.StartsWith("Visit 1 - Feedback")).ToArray();
        Assert.Equal(2, feedback.Length);
        Assert.NotEqual(feedback[0].Key, feedback[1].Key);
        Assert.Equal("First answer", data.Rows[0].Values[feedback[0].Key]);
        Assert.Equal("Second answer", data.Rows[0].Values[feedback[1].Key]);
        var table = Assert.Single(data.RelatedTables!);
        Assert.Equal("Visits", table.Label);
        var child = Assert.Single(table.Rows);
        Assert.Equal(recordId, child.RecordId);
        Assert.Contains("Planning", child.Values.Values);
        Assert.DoesNotContain("Outside record", child.Values.Values);
        var reordered = DashboardRecordDataBuilder.Build("liv", workbook with { Sheets = [primary with {
            Columns = primary.Columns.Reverse().ToArray(), Rows = primary.Rows.Select(row => (IReadOnlyList<string?>)row.Reverse().ToArray()).ToArray() }, visits] });
        Assert.Equal(feedback.Select(column => column.Key).Order(), reordered.Columns.Where(column => column.Label.StartsWith("Visit 1 - Feedback")).Select(column => column.Key).Order());
    }

    [Theory]
    [InlineData("overview", "dashboard-overview")]
    [InlineData("eli", "elevate-practice")]
    [InlineData("als_liv", "als-liv")]
    [InlineData("probation_case", "probation")]
    [InlineData("actions", "actions")]
    [InlineData("uco_tla_review", "uco-tla-reviews")]
    public void ExplorerOnlyMapsSupportedFormDashboards(string key, string expected)
    {
        Assert.True(DashboardRecordDataBuilder.TryGetModule(key, out var actual));
        Assert.Equal(expected, actual);
        Assert.False(DashboardRecordDataBuilder.TryGetModule("staff", out _));
        Assert.False(DashboardRecordDataBuilder.TryGetModule("unknown", out _));
    }

    [Fact]
    public void DetailedDataPreservesReportAndProcessGrantsAndDedicatedUcoCoordinatorAccess()
    {
        Assert.False(DashboardRecordDataBuilder.CanRead(User(), "overview"));
        Assert.True(DashboardRecordDataBuilder.CanRead(User(PermissionKeys.ReportsViewScoped), "overview"));
        Assert.False(DashboardRecordDataBuilder.CanRead(User(PermissionKeys.ReportsViewScoped), "liv"));
        Assert.True(DashboardRecordDataBuilder.CanRead(User(PermissionKeys.ReportsViewScoped, PermissionKeys.LivSubmit), "liv"));
        Assert.False(DashboardRecordDataBuilder.CanRead(User(PermissionKeys.ReportsViewScoped, PermissionKeys.LivSubmit), "als_liv"));
        Assert.True(DashboardRecordDataBuilder.CanRead(User(PermissionKeys.ReportsViewAll), "als_liv"));
        Assert.False(DashboardRecordDataBuilder.CanRead(User(PermissionKeys.ReportsViewAll), "uco_tla_review"));
        Assert.True(DashboardRecordDataBuilder.CanRead(User(PermissionKeys.UcoTlaManage), "uco_tla_review"));
        Assert.True(DashboardRecordDataBuilder.CanRead(User(PermissionKeys.RecordsManage), "uco_tla_review"));
        Assert.False(DashboardRecordDataBuilder.CanRead(User(PermissionKeys.UcoTlaManage), "overview"));
    }

    [Fact]
    public void ActionDataUsesActionIdentityAndRetainsOnlyItsOwnExtensions()
    {
        var actionId = Guid.NewGuid(); var unrelated = Guid.NewGuid();
        var primary = new ExportSheet("Form entries", ["Action ID", "Action", "Owner"], [[actionId.ToString(), "Improve planning", "Alex Example"]], false);
        var extensions = new ExportSheet("Extensions", ["Action ID", "Reason", "New due date"],
            [[actionId.ToString(), "Further practice", "30 Nov 2026"], [unrelated.ToString(), "Outside scope", "31 Dec 2026"]], false);
        var result = DashboardRecordDataBuilder.Build("actions", Workbook(primary, extensions) with { ModuleKey = "actions" });
        Assert.Equal(actionId, Assert.Single(result.Rows).RecordId);
        var extension = Assert.Single(Assert.Single(result.RelatedTables!).Rows);
        Assert.Equal(actionId, extension.RecordId);
        Assert.Contains("Further practice", extension.Values.Values);
        Assert.DoesNotContain("Outside scope", extension.Values.Values);
    }

    private static ElevateStatusDashboardSourceRow Staff(string name, int attendance) => new(Guid.NewGuid(), name, null, "TEAM", "Team", "FAC", attendance,
        null, null, DateTimeOffset.Parse("2026-10-29T12:00:00Z"));
    private static ExportWorkbookData Workbook(params ExportSheet[] sheets) => new("liv", "LIV", new("2026/27", null, null, null, null, null, null, null, null),
        "Reviewer", DateTimeOffset.UtcNow, sheets);
    private static CurrentUser User(params string[] permissions) => new(Guid.NewGuid(), Guid.NewGuid(), "Test", "test@example.com", permissions.ToHashSet(), []);
}
