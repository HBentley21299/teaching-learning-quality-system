using TLQS.Application.Security;
using TLQS.Application.Workflows;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class AdministrationAccessPolicyTests
{
    [Fact]
    public void TeachingAndLearningCanManageListsFormsAndRecordsButNotOrganisation()
    {
        var user = CreateUser(
            PermissionKeys.ListsManage,
            PermissionKeys.FormsManage,
            PermissionKeys.RecordsManage);

        Assert.True(AdministrationAccessPolicy.CanOpenAdminCentre(user));
        Assert.True(AdministrationAccessPolicy.CanManageLists(user));
        Assert.True(AdministrationAccessPolicy.CanManageForms(user));
        Assert.True(AdministrationAccessPolicy.CanManageRecords(user));
        Assert.False(AdministrationAccessPolicy.CanManageOrganisation(user));
        Assert.False(AdministrationAccessPolicy.CanManagePeopleAndAccess(user));
    }

    [Fact]
    public void OrganisationManagementDoesNotImplicitlyGrantRecordOrRoleManagement()
    {
        var user = CreateUser(PermissionKeys.OrganisationManage);

        Assert.True(AdministrationAccessPolicy.CanManageOrganisation(user));
        Assert.False(AdministrationAccessPolicy.CanManageRecords(user));
        Assert.False(AdministrationAccessPolicy.CanManagePeopleAndAccess(user));
    }

    [Fact]
    public void ScopedLeaderCannotOpenAdministrationWithoutAnAdminPermission()
    {
        var user = CreateUser(
            PermissionKeys.MyTeamView,
            PermissionKeys.ReportsViewScoped,
            PermissionKeys.ActionsManage);

        Assert.False(AdministrationAccessPolicy.CanOpenAdminCentre(user));
    }

    private static CurrentUser CreateUser(params string[] permissions) => new(
        Guid.NewGuid(),
        Guid.NewGuid(),
        "Test User",
        "test.user@oldham.ac.uk",
        new HashSet<string>(permissions, StringComparer.OrdinalIgnoreCase),
        []);
}
