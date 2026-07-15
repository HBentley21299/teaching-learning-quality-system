using TLQS.Application.Security;
using TLQS.Application.Workflows;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class MyTeamAccessPolicyTests
{
    [Fact]
    public void TutorWithoutMyTeamPermissionCannotOpenTab()
    {
        var user = CreateUser(PermissionKeys.StaffRead);

        Assert.False(MyTeamAccessPolicy.CanView(user));
    }

    [Fact]
    public void ScopedManagerCanOpenTeamProfilesAndManageActions()
    {
        var user = CreateUser(
            PermissionKeys.MyTeamView,
            PermissionKeys.ReportsViewScoped,
            PermissionKeys.ActionsManage);

        Assert.True(MyTeamAccessPolicy.CanView(user));
        Assert.True(MyTeamAccessPolicy.CanOpenStaffProfile(user));
        Assert.True(MyTeamAccessPolicy.CanManageActions(user));
    }

    [Fact]
    public void ActionVisibilityDoesNotGrantProfileAccess()
    {
        var user = CreateUser(PermissionKeys.MyTeamView, PermissionKeys.ActionsManage);

        Assert.True(MyTeamAccessPolicy.CanView(user));
        Assert.False(MyTeamAccessPolicy.CanOpenStaffProfile(user));
    }

    private static CurrentUser CreateUser(params string[] permissions) => new(
        Guid.NewGuid(),
        Guid.NewGuid(),
        "Test User",
        "test.user@oldham.ac.uk",
        new HashSet<string>(permissions, StringComparer.OrdinalIgnoreCase),
        []);
}
