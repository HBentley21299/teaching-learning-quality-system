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
    [InlineData(LivAccessPolicy.Closed, true, false, false)]
    public void EditingRequiresAnInProgressCaseAndCreatorOrManager(
        string status,
        bool isCreator,
        bool canManage,
        bool expected)
    {
        Assert.Equal(expected, LivAccessPolicy.CanEdit(status, isCreator, canManage));
    }
}
