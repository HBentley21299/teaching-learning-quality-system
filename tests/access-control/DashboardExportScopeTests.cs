using TLQS.Api.Data;
using TLQS.Api.V1;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class DashboardExportScopeTests
{
    [Fact]
    public void OverviewReportsCompletionWithoutPoolingDifferentProcessScores()
    {
        var records = new[] { Record(Guid.NewGuid()), Record(Guid.NewGuid(), "completed"), Record(Guid.NewGuid(), "closed"), Record(Guid.NewGuid(), "draft") };
        var fact = new DashboardDimensionFactSummary(records[0].Id, "learning_walk", new(2026, 9, 8), null, "DIG", "Digital", "FAC", "focus_outcome", "planning", "Planning", "3", "Secure", 3);
        var metrics = DashboardExportScope.Metrics("overview", records, [fact], []);
        Assert.Contains(metrics, metric => metric.Label == "Completed or submitted activity" && metric.Value == "3 of 4");
        Assert.DoesNotContain(metrics, metric => metric.Label is "Average score" or "Secure practice or above");
        Assert.Contains(DashboardExportScope.Metrics("learning_walk", records, [fact], []), metric => metric.Label == "Secure practice or above");
    }

    [Fact]
    public void CpdMultiFacultyEntriesProjectAttendedTotalsWithoutDuplicatingTheEvent()
    {
        var record = Record(Guid.NewGuid()) with { ProcessKey = "cpd_event", AreaCode = "Multiple", ParentAreaCode = null,
            ParticipantAreaBreakdown = "FAC~A~2~1~120|FAC~B~1~0~60|OTHER~C~4~4~240", ParticipantCount = 7, AttendanceCredits = 5, LearningMinutes = 420 };
        var rows = DashboardExportScope.Records([record], [], "cpd_event", Filter with { FacultyCode = "FAC" });
        Assert.Single(rows);
        Assert.Equal(record.Id, rows[0].Id);
        Assert.Equal(3, rows[0].ParticipantCount);
        Assert.Equal(1, rows[0].AttendanceCredits);
        Assert.Equal(180, rows[0].LearningMinutes);
        var both = DashboardExportScope.Records([record], [], "cpd_event", Filter with { FacultyCode = "FAC,OTHER" }).Single();
        Assert.Equal(7, both.ParticipantCount);
        Assert.Equal(420, both.LearningMinutes);
        Assert.Empty(DashboardExportScope.Records([record], [], "cpd_event", Filter with { FacultyCode = "NONE" }));
        var team = DashboardExportScope.Records([record], [], "cpd_event", Filter with { FacultyCode = "FAC", TeamCode = "B" }).Single();
        Assert.Equal(1, team.ParticipantCount);
        Assert.Equal(0, team.AttendanceCredits);
        var excluded = DashboardExportScope.ScopeCpd(record, Filter, new HashSet<string> { "OTHER" });
        Assert.Equal(3, excluded!.ParticipantCount);
        Assert.Null(excluded.OrgUnitId);
    }

    private static ExportFilter Filter => new("2026-27", null, null, null, null, null, null, null, null);
    private static ProcessDashboardRecordSummary Record(Guid id, string status = "submitted", string? delivery = null, string? theme = null) => new(
        Id: id, ProcessKey: "learning_walk", Title: "Walk", Summary: null, RecordDate: new DateOnly(2026, 9, 8), CreatedAt: new DateTimeOffset(2026, 9, 8, 12, 0, 0, TimeSpan.Zero),
        Status: status, OrgUnitId: null, AreaCode: "DIG", AreaName: "Digital", ParentAreaCode: "FAC", OwnerDisplayName: "Reviewer", SubjectDisplayName: "Teacher",
        Theme: theme, Detail: null, ParticipantAreaBreakdown: null, ParticipantCount: 0, AttendanceCredits: 0, LearningMinutes: 0, SampleSize: 0,
        ScoreTotal: 0, ScoreCount: 0, BarrierCount: 0, ScoreMaximum: 5, DeliveryAreaKey: delivery);

    [Fact]
    public void FactsRespectIndividualVisitDatesAndSelectedEliArea()
    {
        var id = Guid.NewGuid();
        var area = new DashboardDimensionFactSummary(id, "eli", new(2026, 9, 8), null, "DIG", "Digital", "FAC", "practice_area_outcome", "area-a", "Planning", "3", "Secure", 3);
        var selected = area with { DimensionKey = "practice_statement_outcome", SeriesKey = "area-a::statement-a", SeriesLabel = "Planning|||Statement A" };
        var rows = DashboardExportScope.Facts([area, selected, selected with { SeriesKey = "area-b::statement-b" }, selected with { OccurredOn = new(2026, 8, 1) }], new HashSet<Guid> { id }, "eli", Filter with { DimensionLabel = "Planning", FromDate = new(2026, 9, 1) });
        Assert.Equal(2, rows.Length);
        Assert.Contains(selected, rows);
    }
    [Fact]
    public void WeeklyTrendFillsMissingWeeksAndUsesMonday()
    {
        var rows = DashboardExportScope.Trend([new DateOnly(2026, 9, 8)], Filter with { FromDate = new(2026, 9, 1), ToDate = new(2026, 10, 15) });
        Assert.Equal(7, rows.Count);
        Assert.Equal(1, rows.Single(row => row.Label == "w/c 07 Sep 2026").Value);
        Assert.Equal(0, rows[0].Value);
    }
    [Fact]
    public void OrganisationIncludesEmptyStaffTeamsAndFacultyTotals()
    {
        var rows = DashboardExportScope.OrganisationItems([Record(Guid.NewGuid())], [], [], [new("learning_walk", null, "EMPTY", "Empty team", "FAC", 12, 0)], []);
        Assert.Contains(rows, row => row.Title == "Team: EMPTY" && row.Fields.Any(field => field.Label == "Active staff" && field.Value == "12"));
        Assert.Contains(rows, row => row.Title == "Faculty: FAC" && row.Fields.Any(field => field.Label == "Records" && field.Value == "1"));
    }

    [Fact]
    public void DraftsAndOtherProcessesAreExcludedFromOverviewInputs()
    {
        var included = Record(Guid.NewGuid());
        var rows = DashboardExportScope.Records([included, Record(Guid.NewGuid(), "draft"), Record(Guid.NewGuid()) with { ProcessKey = "cpd_event" }], [], "learning_walk", Filter);
        Assert.Equal([included.Id], rows.Select(row => row.Id));
    }
    [Fact]
    public void OrganisationDateStatusAndDeliveryIntersect()
    {
        var included = Record(Guid.NewGuid(), delivery: "vocational");
        var filter = Filter with { FacultyCode = "FAC", TeamCode = "DIG", Status = "submitted", DeliveryAreaKey = "vocational", FromDate = new(2026, 9, 1), ToDate = new(2026, 9, 30) };
        var rows = DashboardExportScope.Records([included, Record(Guid.NewGuid()), included with { Id = Guid.NewGuid(), AreaCode = "OTHER" }, included with { Id = Guid.NewGuid(), RecordDate = new(2026, 10, 1) }], [], "learning_walk", filter);
        Assert.Single(rows); Assert.Equal(included.Id, rows[0].Id);
    }
    [Fact]
    public void DynamicThemeMatchesEitherSavedSelectionsOrFactIdentity()
    {
        var selected = Record(Guid.NewGuid(), theme: "Feedback|Planning");
        var factSelected = Record(Guid.NewGuid());
        var fact = new DashboardDimensionFactSummary(factSelected.Id, "learning_walk", new(2026, 9, 8), null, "DIG", "Digital", "FAC", "focus", "stable-focus-id", "Planning", "secure", "Secure", 3);
        Assert.Equal(2, DashboardExportScope.Records([selected, factSelected, Record(Guid.NewGuid())], [fact], "learning_walk", Filter with { DimensionLabel = "Planning" }).Length);
    }
    [Fact]
    public void UnrecordedDeliveryIsDistinctFromOtherAreas()
    {
        Assert.Single(DashboardExportScope.Records([Record(Guid.NewGuid()), Record(Guid.NewGuid(), delivery: "vocational")], [], "learning_walk", Filter with { DeliveryAreaKey = "__not_recorded__" }));
    }
    [Fact]
    public void ActionFiltersUseRaisedDateAndOverdueStateWithSourceDeliveryScope()
    {
        var recordId = Guid.NewGuid();
        var action = new DashboardActionSummary(Guid.NewGuid(), recordId, "learning_walk", "Teacher", Guid.NewGuid(), "Owner", "Planning", "Action", "open", new(2026, 10, 1), null, true, new(2026, 9, 8, 12, 0, 0, TimeSpan.Zero), "FAC", "DIG", false);
        var rows = DashboardExportScope.Actions([action, action with { Id = Guid.NewGuid(), SourceRecordId = Guid.NewGuid() }, action with { Id = Guid.NewGuid(), IsDeleted = true }], "learning_walk", Filter with { Status = "overdue", DimensionLabel = "Planning", DeliveryAreaKey = "vocational", ToDate = new(2026, 9, 30) }, new HashSet<Guid> { recordId });
        Assert.Single(rows); Assert.Equal(action.Id, rows[0].Id);
    }
    [Fact]
    public void LivThemeFilterUsesActionsAndRetainsMatchingCases()
    {
        var record = Record(Guid.NewGuid()) with { ProcessKey = "liv" };
        var action = new DashboardActionSummary(Guid.NewGuid(), record.Id, "liv", "Teacher", Guid.NewGuid(), "Owner", "Feedback", "Action", "open", null, null, false, new(2026, 9, 8, 12, 0, 0, TimeSpan.Zero), "FAC", "DIG", false);
        var filter = Filter with { DimensionLabel = "Feedback", Status = "submitted" };
        var records = DashboardExportScope.Records([record, record with { Id = Guid.NewGuid() }], [], "liv", filter, [action]);
        Assert.Single(records);
        var actions = DashboardExportScope.Actions([action, action with { Id = Guid.NewGuid(), IsDeleted = true }], "liv", filter, records.Select(row => row.Id).ToHashSet());
        Assert.Single(actions);
        Assert.Empty(DashboardExportScope.Records([record], [], "liv", filter, [action with { IsDeleted = true }]));
    }
}
