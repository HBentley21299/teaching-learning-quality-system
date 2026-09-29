using TLQS.Application.Security;
using Xunit;

namespace TLQS.AccessControl.Tests;

public class CustomRolePolicyTests
{
    [Fact]
    public void CannotGrantCapabilityActorDoesNotHold() => Assert.False(CustomRolePolicy.CanGrant("users.manage", new[] { "staff.read" }));

    [Fact]
    public void CanGrantHeldCapability() => Assert.True(CustomRolePolicy.CanGrant("staff.read", new[] { "staff.read" }));

    [Fact]
    public void MandatoryCpdRemainsReservedEvenForActorWhoHoldsIt() => Assert.False(CustomRolePolicy.CanGrant("cpd.mandatory_log", new[] { "cpd.mandatory_log" }));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" ")]
    public void EmptyCapabilityCannotBeGranted(string? key) => Assert.False(CustomRolePolicy.CanGrant(key, new[] { "staff.read" }));
}
