using System.Text.Json;
using TLQS.Api.Data;
using TLQS.Api.V1;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class LivSectionVisibilityTests
{
    [Fact]
    public void HiddenSectionsAreRedactedFromTheResponseAndCannotBeEditedByTheSubject()
    {
        var record = Example();
        var result = LivSectionVisibility.ForReader(record, record.SubjectStaffId);
        Assert.Empty(result.Visits);
        Assert.Null(result.PreConversation);
        foreach (var stage in result.Cycles![0].Stages)
        {
            Assert.False(stage.CanView);
            Assert.False(stage.CanEdit);
            Assert.Null(stage.ContextText);
            Assert.Null(stage.AimsText);
            Assert.Null(stage.LearnerActivityText);
            Assert.Null(stage.ReflectionText);
            Assert.Null(stage.IntendedFollowUpDate);
            Assert.Null(stage.DistanceImpactText);
            Assert.Null(stage.VisitId);
            Assert.Empty(stage.DevelopmentOpportunityKeys);
        }
        Assert.DoesNotContain("private", JsonSerializer.Serialize(result), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void SharingTheVisitRevealsItsDetailsWithoutGrantingPractitionerAccess()
    {
        var record = Example();
        var cycle = record.Cycles![0];
        record = record with { Cycles = [cycle with { Stages = cycle.Stages.Select(stage =>
            stage with { VisibleToStaff = stage.StageType == "visit" }).ToArray() }] };
        var result = LivSectionVisibility.ForReader(record, record.SubjectStaffId);
        Assert.Single(result.Visits);
        Assert.Equal("private visit notes", result.Visits[0].ReflectionNotes);
        Assert.False(result.CanViewSensitive);
        Assert.False(result.Cycles![0].Stages.Single(stage => stage.StageType == "visit").CanEdit);
        Assert.False(result.Cycles[0].Stages.Single(stage => stage.StageType == "pre_discussion").CanView);
    }

    [Fact]
    public void StaffCanContributeToASharedDiscussionWhileOtherSectionsRemainReadOnly()
    {
        var record = Example();
        var cycle = record.Cycles![0];
        record = record with { Cycles = [cycle with { Stages = cycle.Stages.Select(stage => stage with { VisibleToStaff = true }).ToArray() }] };
        var result = LivSectionVisibility.ForReader(record, record.SubjectStaffId);
        Assert.True(result.Cycles![0].Stages.Single(stage => stage.StageType == "pre_discussion").CanEdit);
        Assert.False(result.Cycles[0].Stages.Single(stage => stage.StageType == "visit").CanEdit);
        Assert.False(LivSectionVisibility.ForReader(record, Guid.NewGuid()).Cycles![0].Stages[0].CanEdit);
    }

    [Theory]
    [InlineData(true, false)]
    [InlineData(false, true)]
    public void ReviewEditorsAndSensitiveReadersRetainPrivateSectionAccess(bool canEdit, bool sensitive)
    {
        var record = Example() with { CanEdit = canEdit, CanViewSensitive = sensitive };
        var result = LivSectionVisibility.ForReader(record, Guid.NewGuid());
        Assert.Single(result.Visits);
        Assert.All(result.Cycles![0].Stages, stage => Assert.True(stage.CanView));
        Assert.Equal("private legacy discussion", result.PreConversation);
    }

    private static LivCaseSummary Example()
    {
        var visitId = Guid.NewGuid();
        var cycleId = Guid.NewGuid();
        LivStageSummary Stage(string type) => new(Guid.NewGuid(), type, type == "visit" ? 2 : 1,
            "in_progress", "private context", "private aims", "private learner activity", "private reflection",
            new DateOnly(2027, 1, 1), "private impact", ["private opportunity"], type == "visit" ? visitId : null, false, false);
        return new LivCaseSummary(
            Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), "Alex", null, null, null, null, null,
            "private legacy discussion", "in_progress", "visit", "staff_visible", null, DateTimeOffset.UtcNow, null,
            false, false, null, [], null, [],
            [new LivVisitSummary(visitId, 1, null, null, "initial", null, null, null,
                "private visit notes", "private findings", "in_progress", DateTimeOffset.UtcNow, null, cycleId, [])],
            Cycles: [new LivCycleSummary(cycleId, 1, "in_progress", DateTimeOffset.UtcNow, null, false,
                [Stage("pre_discussion"), Stage("visit")])]);
    }
}
