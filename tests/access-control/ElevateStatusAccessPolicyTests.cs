using TLQS.Application.Security;
using TLQS.Application.Workflows;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class ElevateStatusAccessPolicyTests
{
    private static readonly Guid StaffId = Guid.Parse("10000000-0000-0000-0000-000000000001");

    [Fact]
    public void Staff_CanSubmitOwnExplorerOnly()
    {
        var user = CreateUser(StaffId);

        Assert.True(ElevateStatusAccessPolicy.CanUpdateLevel(user, StaffId, 1));
        Assert.False(ElevateStatusAccessPolicy.CanUpdateLevel(user, StaffId, 2));
        Assert.False(ElevateStatusAccessPolicy.CanUpdateLevel(user, Guid.NewGuid(), 1));
    }

    [Fact]
    public void CampaignManager_CanUpdateEveryLevel()
    {
        var user = CreateUser(Guid.NewGuid(), PermissionKeys.ElevateStatusManage);

        Assert.All(Enumerable.Range(1, 5), level =>
            Assert.True(ElevateStatusAccessPolicy.CanUpdateLevel(user, StaffId, level)));
    }

    [Fact]
    public void BroadReportingPermission_DoesNotGrantCampaignManagement()
    {
        var user = CreateUser(Guid.NewGuid(), PermissionKeys.ReportsViewAll);

        Assert.False(ElevateStatusAccessPolicy.CanUpdateLevel(user, StaffId, 2));
    }

    private static CurrentUser CreateUser(Guid staffId, params string[] permissions) =>
        new(
            Guid.NewGuid(),
            staffId,
            "Test User",
            "test@example.com",
            permissions.ToHashSet(StringComparer.OrdinalIgnoreCase),
            []);
}
