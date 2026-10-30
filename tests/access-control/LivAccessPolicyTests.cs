using TLQS.Application.Security;
using TLQS.Application.Workflows;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class LivAccessPolicyTests
{
    [Fact]
    public void LivSensitivePermissionIsRegistered()
    {
        Assert.Contains(PermissionKeys.LivSensitiveRead, PermissionKeys.All);
    }

    [Theory]
    [InlineData(true, false, false, true)]
    [InlineData(false, true, false, true)]
    [InlineData(false, false, true, true)]
    [InlineData(false, false, false, false)]
    public void SensitiveFieldsRequireCreatorAdminOrExplicitPermission(
        bool isCreator,
        bool isAdministrator,
        bool hasSensitivePermission,
        bool expected)
    {
        Assert.Equal(
            expected,
            LivAccessPolicy.CanViewSensitive(isCreator, isAdministrator, hasSensitivePermission));
    }

    [Theory]
    [InlineData(LivAccessPolicy.InProgress, true, false, true)]
    [InlineData(LivAccessPolicy.InProgress, false, true, true)]
    [InlineData(LivAccessPolicy.InProgress, false, false, false)]
    [InlineData(LivAccessPolicy.Closed, true, false, true)]
    [InlineData(LivAccessPolicy.Closed, false, true, true)]
    public void EditingRequiresCreatorOrManagerRegardlessOfLifecycleStatus(
        string status,
        bool isCreator,
        bool canManage,
        bool expected)
    {
        Assert.Equal(expected, LivAccessPolicy.CanEdit(status, isCreator, canManage));
    }

    [Theory]
    [InlineData(false, false, false, false)]
    [InlineData(true, false, false, true)]
    [InlineData(false, true, false, true)]
    [InlineData(false, false, true, true)]
    public void StaffOnlyReadSharedSectionsWhileReviewEditorsKeepAccess(
        bool shared, bool canEditReview, bool canViewSensitive, bool expected)
    {
        Assert.Equal(expected, LivAccessPolicy.CanViewSection(shared, canEditReview, canViewSensitive));
    }

    [Fact]
    public void OnlyTheReviewCreatorControlsStaffVisibility()
    {
        var creator = Guid.NewGuid();
        Assert.True(LivAccessPolicy.CanManageVisibility(creator, creator));
        Assert.False(LivAccessPolicy.CanManageVisibility(creator, Guid.NewGuid()));
        Assert.False(LivAccessPolicy.CanManageVisibility(null, null));
        Assert.False(LivAccessPolicy.CanManageVisibility(creator, null));
    }

    [Theory]
    [InlineData(1, "follow_up_review")]
    [InlineData(2, "post_reflection")]
    [InlineData(3, "visit")]
    public void NotApplicableCannotSkipCycleTwoOrOtherRequiredSections(int cycleNumber, string stageType)
    {
        Assert.Throws<WorkflowValidationException>(() =>
            LivAccessPolicy.NormalizeStageStatus("not_applicable", stageType, cycleNumber));
    }

    [Theory]
    [InlineData(2)]
    [InlineData(3)]
    public void LaterFollowUpReviewsCanBeNotApplicable(int cycleNumber)
    {
        Assert.Equal("not_applicable", LivAccessPolicy.NormalizeStageStatus("not_applicable", "follow_up_review", cycleNumber));
    }

    [Fact]
    public void TheFirstCycleMustOpenCycleTwoBeforeAnyLivCanClose()
    {
        Assert.Throws<WorkflowValidationException>(() => LivAccessPolicy.ValidateCycleCompletion(1, false));
        LivAccessPolicy.ValidateCycleCompletion(1, true);
        LivAccessPolicy.ValidateCycleCompletion(2, false);
        LivAccessPolicy.ValidateCycleCompletion(2, true);
    }
}
