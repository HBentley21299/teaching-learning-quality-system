using TLQS.Application.Security;
using TLQS.Application.Workflows;
using Xunit;

namespace TLQS.AccessControl.Tests;

public class AccountAdministrationPolicyTests
{
    [Theory]
    [InlineData("inactive", null, false, false)]
    [InlineData("leaver", null, false, false)]
    [InlineData(null, true, false, false)]
    [InlineData(null, null, true, false)]
    [InlineData(null, null, false, true)]
    public void OwnUsabilityCannotBeRemoved(string? status, bool? disabled, bool archived, bool removesAdmin) =>
        Assert.Throws<WorkflowValidationException>(() => AccountAdministrationPolicy.ValidateSelfAccess(true, status, disabled, archived, removesAdmin));

    [Theory]
    [InlineData(null, null)]
    [InlineData("active", false)]
    public void OwnOrdinaryMaintenanceRemainsAvailable(string? status, bool? disabled) =>
        AccountAdministrationPolicy.ValidateSelfAccess(true, status, disabled, false, false);

    [Theory]
    [InlineData("")]
    [InlineData("deleted")]
    [InlineData("ACTIVE")]
    public void UnknownStatusDoesNotSilentlyLockAccount(string status) =>
        Assert.Throws<WorkflowValidationException>(() => AccountAdministrationPolicy.ValidateSelfAccess(false, status, null, false, false));
}
