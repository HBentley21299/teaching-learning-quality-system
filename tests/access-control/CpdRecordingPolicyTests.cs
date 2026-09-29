using TLQS.Application.Security;
using TLQS.Application.Workflows;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class CpdRecordingPolicyTests
{
    [Theory]
    [InlineData("cpd_core", true)]
    [InlineData("cpd_mandatory", false)]
    [InlineData("cpd_external_self_log", false)]
    [InlineData("future_cpd", false)]
    public void OnlyManagedDevelopmentContributesToElevate(string template, bool expected) =>
        Assert.Equal(expected, CpdRecordingPolicy.ContributesToElevate(template));

    [Theory]
    [InlineData("cpd.manage", false)]
    [InlineData("cpd.self_log", false)]
    [InlineData("forms.manage", false)]
    [InlineData("cpd.mandatory_log", true)]
    public void MandatoryRecordingRequiresDedicatedPermission(string permission, bool expected)
    {
        var user = CurrentUser.Empty("test@example.com") with { Permissions = new HashSet<string> { permission } };
        Assert.Equal(expected, CpdRecordingPolicy.CanManageMandatory(user));
    }
}
