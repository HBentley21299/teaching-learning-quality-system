using TLQS.Application.Workflows;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class QaFormAccessPolicyTests
{
    [Theory]
    [InlineData(false, false, true, false, true, true, false)]
    [InlineData(false, true, true, true, false, true, false)]
    [InlineData(true, false, true, false, false, false, true)]
    [InlineData(true, false, true, false, true, false, false)]
    [InlineData(true, false, true, false, true, true, true)]
    [InlineData(true, true, true, false, true, false, true)]
    [InlineData(true, false, true, true, true, false, true)]
    [InlineData(true, false, false, false, true, false, true)]
    public void WhitelistNarrowsQaStaffWithoutGrantingPermissions(bool submit, bool manage, bool qaStaff,
        bool independentSubmission, bool restricted, bool listed, bool expected) =>
        Assert.Equal(expected, QaFormAccessPolicy.CanComplete(submit, manage, qaStaff, independentSubmission, restricted, listed));

    [Fact]
    public void RevokingWhitelistAccessBlocksAnAlreadyOpenedForm()
    {
        Assert.True(QaFormAccessPolicy.CanComplete(true, false, true, false, true, true));
        Assert.False(QaFormAccessPolicy.CanComplete(true, false, true, false, true, false));
    }
}
