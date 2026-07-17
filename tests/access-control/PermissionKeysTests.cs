using TLQS.Application.Security;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class PermissionKeysTests
{
    [Fact]
    public void PermissionKeys_AreUnique()
    {
        Assert.Equal(PermissionKeys.All.Length, PermissionKeys.All.Distinct(StringComparer.OrdinalIgnoreCase).Count());
    }

    [Fact]
    public void PermissionKeys_UseExpectedNamespaceShape()
    {
        Assert.All(PermissionKeys.All, key =>
        {
            Assert.Contains('.', key);
            Assert.DoesNotContain(' ', key);
            Assert.Equal(key.ToLowerInvariant(), key);
        });
    }

    [Fact]
    public void ExternalCpdSubmission_IsAFirstClassPermission()
    {
        Assert.Contains(PermissionKeys.CpdExternalSubmit, PermissionKeys.All);
        Assert.NotEqual(PermissionKeys.CpdManage, PermissionKeys.CpdExternalSubmit);
    }
}
