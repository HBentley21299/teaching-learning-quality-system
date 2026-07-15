using TLQS.Application.Organisation;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class OrganisationLeadershipRulesTests
{
    [Theory]
    [InlineData("faculty", "head_of_faculty", "Head of Faculty")]
    [InlineData("team", "programme_leader", "Programme Leader")]
    public void Managed_unit_maps_to_expected_permission_tier(string unitType, string roleKey, string roleName)
    {
        Assert.True(OrganisationLeadershipRules.IsManagedUnitType(unitType));
        Assert.Equal(roleKey, OrganisationLeadershipRules.RoleKeyFor(unitType));
        Assert.Equal(roleName, OrganisationLeadershipRules.RoleNameFor(unitType));
    }

    [Fact]
    public void Unsupported_unit_cannot_receive_a_manager()
    {
        Assert.False(OrganisationLeadershipRules.IsManagedUnitType("college"));
        Assert.Throws<ArgumentOutOfRangeException>(() => OrganisationLeadershipRules.RoleKeyFor("college"));
    }
}
