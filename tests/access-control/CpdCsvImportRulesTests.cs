using TLQS.Api.Data;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class CpdCsvImportRulesTests
{
    private static readonly CpdCsvStaff Alex = new(Guid.Parse("10000000-0000-0000-0000-000000000001"), "S001", "alex@example.test", "Alex Example", Guid.NewGuid(), true);
    private static readonly CpdCsvStaff Sam = new(Guid.Parse("10000000-0000-0000-0000-000000000002"), "S002", "sam@example.test", "Sam Example", Guid.NewGuid(), true);
    private static readonly CpdCsvTheme Digital = new("digital", "Digital learning", true);
    private static readonly CpdCsvTheme Inclusion = new("inclusion", "Inclusive practice", true);
    private static readonly CpdCsvYear Year = new("2026/27", new(2026, 8, 1), new(2027, 7, 31), true);
    private static readonly string[] Fields = ["cpd_title", "date_time", "duration_hours", "duration_minutes", "delivery_mode", "cpd_themes", "staff_search"];
    private static readonly CpdCsvTemplate Internal = Template("cpd_core");
    private static readonly CpdCsvTemplate Mandatory = Template("cpd_mandatory");

    [Fact]
    public void ParticipantRowsCreateOneFormEventWithEveryNamedAttendeeAndExpectedSavedFormAnswers()
    {
        var plan = Prepare([Row(), Row(3, participant: "S002")]);
        var entry = Assert.Single(plan.Events);
        Assert.Empty(Errors(plan)); Assert.Equal(2, plan.Rows.Count);
        Assert.Equal(new[] { Alex.Id, Sam.Id }, entry.Participants.Select(person => person.Id));
        Assert.All(plan.Rows, row => Assert.Equal("create", row.Operation));
        Assert.All(plan.Rows, row => Assert.Equal(CpdCsvImportRules.RequiredHeaders.Concat(CpdCsvImportRules.OptionalHeaders).Order(), row.Values.Keys.Order()));
        Assert.Contains(plan.Issues, issue => issue.Severity == "info" && issue.Message.Contains("2 distinct") && issue.Message.Contains("one qualifying"));
        var request = CpdCsvImportRules.Submission(entry);
        Assert.Equal("cpd_core", request.TemplateKey); Assert.Equal("cpd_event", request.RecordType);
        Assert.False(request.SaveAsDraft); Assert.Null(request.Actions); Assert.Null(request.DraftActions);
        Assert.Null(request.SubjectStaffId); Assert.Null(request.OrgUnitId); Assert.Equal(new DateOnly(2026, 10, 1), request.RecordDate);
        string? Answer(string key) => request.Responses.Single(response => response.FieldId == Internal.Fields.Single(field => field.Key == key).Id).Value;
        Assert.Equal("1", Answer("duration_hours")); Assert.Equal("30", Answer("duration_minutes"));
        Assert.Equal("Digital learning|Inclusive practice", Answer("cpd_themes"));
        Assert.Equal($"{Alex.Id}|{Sam.Id}", Answer("staff_search"));
        Assert.Equal("2026-10-01T09:00:00", Answer("date_time"));
    }

    [Fact]
    public void MandatoryImportsUseTheirOwnPermissionAndTemplateAndNeverClaimQualifyingCredit()
    {
        var plan = Prepare([Row(type: "mandatory")], user: User(PermissionKeys.CpdMandatoryLog));
        Assert.Empty(Errors(plan));
        var entry = Assert.Single(plan.Events);
        Assert.Equal("cpd_mandatory", CpdCsvImportRules.Submission(entry).TemplateKey);
        Assert.False(CpdRecordingPolicy.ContributesToElevate(entry.Template.Key));
        Assert.Contains(plan.Issues, issue => issue.Severity == "info" && issue.Message.Contains("zero Elevate credit"));
        Assert.Contains(Prepare([Row()], user: User(PermissionKeys.CpdMandatoryLog)).Issues, issue => issue.Column == "cpd_type" && issue.Severity == "error");
        Assert.Contains(Prepare([Row(type: "mandatory")], user: User(PermissionKeys.CpdManage)).Issues, issue => issue.Column == "cpd_type" && issue.Severity == "error");
        Assert.Contains(Prepare([Row(type: "external")]).Issues, issue => issue.Column == "cpd_type" && issue.Severity == "error");
    }

    [Fact]
    public void ImportRequiresAnActualAdministratorIdentityAndAppropriatePermission()
    {
        Assert.Throws<UnauthorizedAccessException>(() => Prepare([Row()], user: User(PermissionKeys.CpdManage) with { IsAdministrator = false }));
        Assert.Throws<UnauthorizedAccessException>(() => Prepare([Row()], user: User()));
        Assert.Throws<UnauthorizedAccessException>(() => Prepare([Row()], user: User(PermissionKeys.CpdManage) with { StaffId = null }));
        Assert.Throws<UnauthorizedAccessException>(() => Prepare([Row()], user: User(PermissionKeys.CpdManage) with { UserAccountId = null }));
    }

    [Fact]
    public void RepeatedParticipantRowsAreDeduplicatedWithoutSplittingTheEventAndPayloadIgnoresRowOrder()
    {
        var first = Prepare([Row(), Row(3, participant: "S002"), Row(4)]);
        var second = Prepare([Row(participant: "S002", themes: "inclusion|digital"), Row(3, themes: "digital|inclusion")]);
        Assert.Equal(2, Assert.Single(first.Events).Participants.Count);
        Assert.Contains(first.Issues, issue => issue.RowNumber == 4 && issue.Severity == "warning");
        Assert.Equal(first.Events[0].PayloadHash, Assert.Single(second.Events).PayloadHash);
    }

    [Fact]
    public void IdenticalReimportSkipsAndChangedPayloadCannotOverwritePreviousEvent()
    {
        var original = Assert.Single(Prepare([Row()]).Events);
        var ledger = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) { ["event-1"] = original.PayloadHash };
        var repeated = Prepare([Row(reference: "EVENT-1", email: "ALEX@EXAMPLE.TEST")], ledger: ledger);
        Assert.Empty(Errors(repeated)); Assert.Empty(repeated.Events); Assert.Equal("skip", Assert.Single(repeated.Rows).Operation);
        var changed = Prepare([Row(duration: "120")], ledger: ledger);
        Assert.Empty(changed.Events); Assert.Equal("error", Assert.Single(changed.Rows).Operation);
        Assert.Contains(changed.Issues, issue => issue.Column == "event_reference" && issue.Message.Contains("different data"));
        var nowInactive = Prepare([Row()], ledger: ledger, staff: [Alex with { IsActive = false }, Sam], themes: [Digital with { IsActive = false }, Inclusion]);
        Assert.Empty(Errors(nowInactive)); Assert.Equal("skip", Assert.Single(nowInactive.Rows).Operation);
    }

    [Fact]
    public void DistinctReferencesCannotImportTheSameSessionTwiceAndGroupMetadataMustAgree()
    {
        var duplicate = Prepare([Row(), Row(3, reference: "event-2", participant: "S002")]);
        Assert.Empty(duplicate.Events); Assert.All(duplicate.Rows, row => Assert.Equal("error", row.Operation));
        Assert.Contains(duplicate.Issues, issue => issue.Message.Contains("different event references"));
        var conflicting = Prepare([Row(), Row(3, duration: "120", participant: "S002")]);
        Assert.Empty(conflicting.Events); Assert.Contains(conflicting.Issues, issue => issue.Message.Contains("identical event details"));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void ExistingManualSessionIsNotDuplicatedEvenWhenItsHistoricalTimeWasNotRecorded(bool hasTime)
    {
        var original = new CpdCsvExistingEvent(Guid.NewGuid(), "cpd_core", "  Digital practice  ", new(2026, 10, 1), hasTime ? new(9, 0) : null);
        var plan = Prepare([Row()], existing: [original]);
        Assert.Empty(plan.Events); Assert.Contains(plan.Issues, issue => issue.Message.Contains("already exists"));
    }

    [Fact]
    public void PeopleResolveByExactUniqueIdentifiersAndMismatchedOrInactivePeopleAreRejected()
    {
        Assert.Empty(Errors(Prepare([Row(participant: "", email: "alex@example.test")])));
        Assert.Contains(Errors(Prepare([Row(email: "sam@example.test")])), issue => issue.Column == "participant_email");
        Assert.Contains(Errors(Prepare([Row(participant: "Alex Example")])), issue => issue.Column == "participant_external_id");
        Assert.Contains(Errors(Prepare([Row()], staff: [Alex with { IsActive = false }, Sam])), issue => issue.Message.Contains("inactive or archived"));
        Assert.Contains(Errors(Prepare([Row(participant: "", email: Alex.Email)], staff: [Alex, Sam with { Email = Alex.Email }])), issue => issue.Message.Contains("exactly one"));
        Assert.Empty(Prepare([Row(participant: "")]).Events);
    }

    [Theory]
    [InlineData("duration_minutes", "0")]
    [InlineData("duration_minutes", "1500")]
    [InlineData("duration_minutes", "1.5")]
    [InlineData("event_date_time", "01/10/2026 09:00")]
    [InlineData("event_date_time", "2026-10-01T09:00Z")]
    [InlineData("event_date_time", "2026-10-30T09:00")]
    [InlineData("academic_year", "2025/26")]
    [InlineData("delivery_mode", "Unrecognised mode")]
    [InlineData("theme_keys", "unknown_theme")]
    public void InvalidTemporalClassificationAndConfiguredSelectionsFailBeforePlanningAnyWrite(string column, string value)
    {
        var row = Row(); var values = new Dictionary<string, string>(row.Values, StringComparer.OrdinalIgnoreCase) { [column] = value };
        var plan = Prepare([row with { Values = values }]);
        Assert.Empty(plan.Events); Assert.Contains(Errors(plan), issue => issue.Column == column || column == "event_date_time" && issue.Column == "academic_year");
    }

    [Fact]
    public void InactiveThemesUnregisteredYearsAndNewRequiredFormFieldsMustBeReviewed()
    {
        Assert.Contains(Errors(Prepare([Row()], themes: [Digital with { IsActive = false }, Inclusion])), issue => issue.Column == "theme_keys");
        Assert.Contains(Errors(Prepare([Row()], years: [])), issue => issue.Column == "academic_year");
        var changed = Internal with { Fields = Internal.Fields.Concat([new CpdCsvField(Guid.NewGuid(), "impact", "long_text", true, "Impact of professional development")]).ToArray() };
        Assert.Contains(Errors(Prepare([Row()], templates: [changed, Mandatory])), issue => issue.Message.Contains("Impact of professional development"));
        var renamedVersion = Internal with { VersionId = Guid.NewGuid() };
        var before = Prepare([Row()]); var after = Prepare([Row()], templates: [renamedVersion, Mandatory]);
        Assert.Equal(before.Events[0].PayloadHash, after.Events[0].PayloadHash);
        Assert.NotEqual(before.ContextFingerprint, after.ContextFingerprint);
    }

    [Fact]
    public void UnknownColumnsAndMissingIdentityHeaderAreReportedAndStaffSnapshotChangesInvalidatePreview()
    {
        var table = Table([Row()]);
        var invalid = CpdCsvImportRules.Prepare(table with { Headers = table.Headers.Append("milestone_credit").Where(key => key is not ("participant_external_id" or "participant_email")).ToArray() },
            User(PermissionKeys.CpdManage), [Alex, Sam], [Digital, Inclusion], [Year], [Internal, Mandatory], [], new Dictionary<string, string>(), new(2026, 10, 29, 12, 0, 0));
        Assert.Empty(invalid.Events); Assert.Contains(invalid.Issues, issue => issue.Column == "milestone_credit");
        Assert.Contains(invalid.Issues, issue => issue.Message.Contains("Include participant_external_id"));
        Assert.NotEqual(Prepare([Row()]).ContextFingerprint, Prepare([Row()], staff: [Alex with { PrimaryOrgUnitId = Guid.NewGuid() }, Sam]).ContextFingerprint);
    }

    private static IEnumerable<AdminCsvIssue> Errors(CpdCsvPreparedPlan plan) => plan.Issues.Where(issue => issue.Severity == "error");
    private static CpdCsvPreparedPlan Prepare(AdminCsvRow[] rows, CurrentUser? user = null, IReadOnlyList<CpdCsvStaff>? staff = null,
        IReadOnlyList<CpdCsvTheme>? themes = null, IReadOnlyList<CpdCsvYear>? years = null, IReadOnlyList<CpdCsvTemplate>? templates = null,
        IReadOnlyList<CpdCsvExistingEvent>? existing = null, IReadOnlyDictionary<string, string>? ledger = null) =>
        CpdCsvImportRules.Prepare(Table(rows), user ?? User(PermissionKeys.CpdManage, PermissionKeys.CpdMandatoryLog), staff ?? [Alex, Sam], themes ?? [Digital, Inclusion],
            years ?? [Year], templates ?? [Internal, Mandatory], existing ?? [], ledger ?? new Dictionary<string, string>(), new(2026, 10, 29, 12, 0, 0));
    private static AdminCsvTable Table(AdminCsvRow[] rows) => new(CpdCsvImportRules.RequiredHeaders.Concat(CpdCsvImportRules.OptionalHeaders).ToArray(), rows);
    private static AdminCsvRow Row(int number = 2, string reference = "event-1", string participant = "S001", string email = "", string type = "internal", string duration = "90", string themes = "digital|inclusion") => new(number,
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) { ["event_reference"] = reference, ["academic_year"] = "2026/27", ["cpd_type"] = type,
            ["title"] = "Digital practice", ["event_date_time"] = "2026-10-01T09:00", ["duration_minutes"] = duration, ["delivery_mode"] = "Face to face",
            ["theme_keys"] = themes, ["participant_external_id"] = participant, ["participant_email"] = email });
    private static CurrentUser User(params string[] permissions) => new(Guid.NewGuid(), Guid.NewGuid(), "Admin", "admin@example.test", permissions.ToHashSet(), []) { IsAdministrator = true };
    private static CpdCsvTemplate Template(string key) => new(key, Guid.NewGuid(), Fields.Select(field => new CpdCsvField(Guid.NewGuid(), field, "short_text", true, field)).ToArray());
}
