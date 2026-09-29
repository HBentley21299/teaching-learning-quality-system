using TLQS.Application.Security;
using TLQS.Application.Workflows;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class QaPublishedReviewTests
{
    [Theory]
    [InlineData("draft", true)]
    [InlineData("open", true)]
    [InlineData("reopened", true)]
    [InlineData("closed", false)]
    [InlineData("archived", false)]
    public void ManagersCanConfigureDraftAndLiveReviewsWhileClosedSnapshotsStayLocked(string status, bool expected)
    {
        var manager = User(PermissionKeys.QaReviewsManage);
        Assert.Equal(expected, QaReviewPolicy.CanConfigure(manager, status));
    }

    [Theory]
    [InlineData(PermissionKeys.QaReviewsViewAll)]
    [InlineData(PermissionKeys.QaReviewsSubmitAll)]
    [InlineData(PermissionKeys.QaReviewsCorrect)]
    public void EvidencePermissionsDoNotPermitChangingReviewScope(string permission) =>
        Assert.False(QaReviewPolicy.CanConfigure(User(permission), "open"));

    [Fact]
    public void PublishedReviewCanAddTeamsWithoutChangingItsFrozenStructure()
    {
        var existing = Structure();
        var requested = existing with { TeamOrgUnitIds = [.. existing.TeamOrgUnitIds, Guid.NewGuid(), Guid.NewGuid()] };
        QaReviewPolicy.ValidatePublishedStructure(existing, requested);
    }

    [Fact]
    public void MetadataOnlyEditCanKeepTheSamePublishedStructure()
    {
        var existing = Structure();
        QaReviewPolicy.ValidatePublishedStructure(existing, existing);
    }

    [Fact]
    public void PublishedTeamCannotBeRemovedEvenWhenAnotherTeamIsAdded()
    {
        var existing = Structure();
        var requested = existing with { TeamOrgUnitIds = [existing.TeamOrgUnitIds[0], Guid.NewGuid()] };
        Assert.Contains("must remain included", Assert.Throws<WorkflowValidationException>(
            () => QaReviewPolicy.ValidatePublishedStructure(existing, requested)).Message);
    }

    [Fact]
    public void TeamSelectionOrderDoesNotChangePublishedScope()
    {
        var existing = Structure();
        QaReviewPolicy.ValidatePublishedStructure(existing, existing with { TeamOrgUnitIds = existing.TeamOrgUnitIds.Reverse().ToArray() });
    }

    [Theory]
    [InlineData("year")]
    [InlineData("tag")]
    [InlineData("opening")]
    public void PublishedReportingIdentityCannotChange(string change)
    {
        var existing = Structure();
        var requested = change switch
        {
            "year" => existing with { AcademicYear = "2027/28" },
            "tag" => existing with { QuestionTag = "another-tag" },
            _ => existing with { PlannedOpenDate = existing.PlannedOpenDate!.Value.AddDays(1) }
        };
        Assert.Throws<WorkflowValidationException>(() => QaReviewPolicy.ValidatePublishedStructure(existing, requested));
    }

    [Theory]
    [InlineData("activity")]
    [InlineData("template")]
    [InlineData("question")]
    [InlineData("remove-question")]
    [InlineData("remove-activity")]
    [InlineData("add-activity")]
    public void PublishedQuestionsAndActivitiesCannotBeReplacedOrRemoved(string change)
    {
        var existing = Structure();
        var activity = existing.Activities[0];
        var requested = existing with
        {
            Activities = change switch
            {
                "activity" => [activity with { ActivityTypeId = Guid.NewGuid() }],
                "template" => [activity with { TemplateId = Guid.NewGuid() }],
                "question" => [activity with { QuestionIds = [Guid.NewGuid(), activity.QuestionIds[1]] }],
                "remove-question" => [activity with { QuestionIds = [activity.QuestionIds[0]] }],
                "remove-activity" => [],
                _ => [activity, new QaPublishedReviewActivity(Guid.NewGuid(), Guid.NewGuid(), [Guid.NewGuid()])]
            }
        };
        Assert.Contains("protect submitted evidence", Assert.Throws<WorkflowValidationException>(
            () => QaReviewPolicy.ValidatePublishedStructure(existing, requested)).Message);
    }

    [Fact]
    public void FrozenQuestionSelectionOrderDoesNotRewriteStoredQuestionOrder()
    {
        var existing = Structure();
        var activity = existing.Activities[0];
        QaReviewPolicy.ValidatePublishedStructure(existing, existing with
        {
            Activities = [activity with { QuestionIds = activity.QuestionIds.Reverse().ToArray() }]
        });
    }

    private static QaPublishedReviewStructure Structure() => new(
        "2026/27", "general", new DateOnly(2026, 9, 1), [Guid.NewGuid(), Guid.NewGuid()],
        [new QaPublishedReviewActivity(Guid.NewGuid(), Guid.NewGuid(), [Guid.NewGuid(), Guid.NewGuid()])]);

    private static CurrentUser User(params string[] permissions) => new(
        Guid.NewGuid(), Guid.NewGuid(), "Review Manager", "review.manager@example.test",
        new HashSet<string>(permissions, StringComparer.OrdinalIgnoreCase), []);
}
