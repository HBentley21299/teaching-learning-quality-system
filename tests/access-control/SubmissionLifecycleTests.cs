using TLQS.Application.Workflows;
using Xunit;

namespace TLQS.AccessControl.Tests;

public class SubmissionLifecycleTests
{
    [Theory]
    [InlineData(SubmissionLifecycle.Draft, SubmissionLifecycle.ActionSubmit, SubmissionLifecycle.Submitted)]
    [InlineData(SubmissionLifecycle.Reopened, SubmissionLifecycle.ActionSubmit, SubmissionLifecycle.Submitted)]
    [InlineData(SubmissionLifecycle.Submitted, SubmissionLifecycle.ActionReopen, SubmissionLifecycle.Reopened)]
    public void ValidTransitionsResolveToTargetStatus(string current, string action, string expected)
    {
        Assert.Equal(expected, SubmissionLifecycle.GetTargetStatus(current, action));
    }

    [Theory]
    [InlineData(SubmissionLifecycle.Submitted, SubmissionLifecycle.ActionSubmit)]
    [InlineData(SubmissionLifecycle.Draft, SubmissionLifecycle.ActionReopen)]
    [InlineData(SubmissionLifecycle.Reopened, SubmissionLifecycle.ActionReopen)]
    [InlineData(SubmissionLifecycle.Draft, "unknown")]
    public void InvalidTransitionsReturnNull(string current, string action)
    {
        Assert.Null(SubmissionLifecycle.GetTargetStatus(current, action));
    }

    [Theory]
    [InlineData(SubmissionLifecycle.Draft)]
    [InlineData(SubmissionLifecycle.Submitted)]
    [InlineData(SubmissionLifecycle.Reopened)]
    public void ArchiveIsAllowedFromAnyStatus(string current)
    {
        Assert.NotNull(SubmissionLifecycle.GetTargetStatus(current, SubmissionLifecycle.ActionArchive));
    }

    [Fact]
    public void OwnersCanEditDraftsAndReopenedButNotSubmitted()
    {
        Assert.True(SubmissionLifecycle.CanEditResponses(SubmissionLifecycle.Draft, isOwner: true, canManageForms: false));
        Assert.True(SubmissionLifecycle.CanEditResponses(SubmissionLifecycle.Reopened, isOwner: true, canManageForms: false));
        Assert.False(SubmissionLifecycle.CanEditResponses(SubmissionLifecycle.Submitted, isOwner: true, canManageForms: false));
    }

    [Fact]
    public void FormsManagersCanAlwaysEdit()
    {
        Assert.True(SubmissionLifecycle.CanEditResponses(SubmissionLifecycle.Submitted, isOwner: false, canManageForms: true));
    }

    [Fact]
    public void NonOwnersWithoutManagePermissionCannotEdit()
    {
        Assert.False(SubmissionLifecycle.CanEditResponses(SubmissionLifecycle.Draft, isOwner: false, canManageForms: false));
    }

    [Fact]
    public void OnlyFormsManagersCanReopenOrArchive()
    {
        Assert.False(SubmissionLifecycle.CanPerform(SubmissionLifecycle.ActionReopen, isOwner: true, canManageForms: false));
        Assert.False(SubmissionLifecycle.CanPerform(SubmissionLifecycle.ActionArchive, isOwner: true, canManageForms: false));
        Assert.True(SubmissionLifecycle.CanPerform(SubmissionLifecycle.ActionReopen, isOwner: false, canManageForms: true));
        Assert.True(SubmissionLifecycle.CanPerform(SubmissionLifecycle.ActionArchive, isOwner: false, canManageForms: true));
    }

    [Fact]
    public void OwnersCanSubmitTheirOwnRecords()
    {
        Assert.True(SubmissionLifecycle.CanPerform(SubmissionLifecycle.ActionSubmit, isOwner: true, canManageForms: false));
        Assert.False(SubmissionLifecycle.CanPerform(SubmissionLifecycle.ActionSubmit, isOwner: false, canManageForms: false));
    }
}
