using TLQS.Application.Security;
using TLQS.Application.Workflows;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class AccessBoundaryPolicyTests
{
    [Fact]
    public void GenericRecordEndpointRequiresFormAdministration()
    {
        Assert.False(AccessBoundaryPolicy.CanCreateGenericRecord(CreateUser(PermissionKeys.LearningWalkSubmit)));
        Assert.False(AccessBoundaryPolicy.CanCreateGenericRecord(CreateUser(PermissionKeys.WorkScrutinySubmit)));
        Assert.True(AccessBoundaryPolicy.CanCreateGenericRecord(CreateUser(PermissionKeys.FormsManage)));
    }

    [Fact]
    public void ActionPermissionAndVisibilityAloneDoNotGrantCreatorAuthority()
    {
        Assert.False(AccessBoundaryPolicy.CanManageVisibleAction(CreateUser(PermissionKeys.ActionsManage), false));
        Assert.False(AccessBoundaryPolicy.CanManageVisibleAction(CreateUser(), true));
        Assert.False(AccessBoundaryPolicy.CanManageVisibleAction(CreateUser(PermissionKeys.ActionsManage), true));
        Assert.True(AccessBoundaryPolicy.CanManageVisibleAction(CreateUser(),true,true,false));
        Assert.True(AccessBoundaryPolicy.CanManageVisibleAction(CreateUser(),true,false,true));
        Assert.False(AccessBoundaryPolicy.CanManageVisibleAction(CreateUser(),false,true,true));
    }

    [Fact]
    public void UcoAndRecordPermissionsDoNotReplaceCreatorAuthority()
    {
        var user = CreateUser(PermissionKeys.UcoTlaManage);

        Assert.False(AccessBoundaryPolicy.CanManageVisibleAction(user, true, "uco_tla_review"));
        Assert.False(AccessBoundaryPolicy.CanManageVisibleAction(user, true, "learning_walk"));
        Assert.False(AccessBoundaryPolicy.CanManageVisibleAction(user, false, "uco_tla_review"));
    }

    [Fact]
    public void ActualAdministratorAndTeachingLearningRolesCanManageVisibleActions()
    {
        var user = CreateUser(PermissionKeys.RecordsManage);

        Assert.False(AccessBoundaryPolicy.CanManageVisibleAction(user, true, "uco_tla_review"));
        Assert.False(AccessBoundaryPolicy.CanManageVisibleAction(user, true, "learning_walk"));
        Assert.True(AccessBoundaryPolicy.CanManageVisibleAction(user with{IsAdministrator=true},true));
        Assert.True(AccessBoundaryPolicy.CanManageVisibleAction(user with{IsTeachingLearning=true},true));
        Assert.False(AccessBoundaryPolicy.CanManageVisibleAction(user with{IsTeachingLearning=true},false));
    }

    [Theory]
    [InlineData("learning_walk", "learning_walks", true)]
    [InlineData("als_learning_walk", "learning_walks", true)]
    [InlineData("als_learning_walk", "als_learning_walks", false)]
    [InlineData("learning_walk", "work_scrutiny", false)]
    [InlineData("work_scrutiny", "work_scrutiny", true)]
    [InlineData("cpd_event", "cpd", true)]
    [InlineData("elevate_environment", "elevate_environments", true)]
    public void TemplatesCannotBeSubmittedAsAnotherRecordType(string recordType, string moduleKey, bool expected)
    {
        Assert.Equal(expected, AccessBoundaryPolicy.IsTemplateCompatible(recordType, moduleKey));
    }

    private static CurrentUser CreateUser(params string[] permissions) => new(
        Guid.NewGuid(),
        Guid.NewGuid(),
        "Test User",
        "test.user@oldham.ac.uk",
        new HashSet<string>(permissions, StringComparer.OrdinalIgnoreCase),
        []);
}
