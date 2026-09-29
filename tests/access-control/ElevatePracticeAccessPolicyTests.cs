using TLQS.Application.Security;
using TLQS.Application.Workflows;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class ElevatePracticeAccessPolicyTests
{
    private static readonly Guid SubjectStaffId = Guid.Parse("10000000-0000-0000-0000-000000000001");

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(6)]
    [InlineData(64)]
    public void ActiveManagerAtAnySupportedDepthCanEditSubmittedAssessment(int managementDepth)
    {
        // The active staff hierarchy grants access without a generic reporting role.
        Assert.True(ElevatePracticeAccessPolicy.CanEdit(CreateUser(), SubjectStaffId, "submitted", managementDepth));
    }

    [Theory]
    [InlineData(PermissionKeys.ReportsViewAll)]
    [InlineData(PermissionKeys.ReportsViewScoped)]
    [InlineData(PermissionKeys.StaffManage)]
    [InlineData(PermissionKeys.FormsManage)]
    public void VisibilityAndOtherAdministrationPermissionsDoNotGrantEditing(string permission)
    {
        var user = CreateUser(permission) with
        {
            Scopes = [new AccessScopeDto("specific_staff", null, SubjectStaffId)]
        };

        Assert.False(ElevatePracticeAccessPolicy.CanEdit(user, SubjectStaffId, "submitted", null));
    }

    [Theory]
    [InlineData("draft")]
    [InlineData("archived")]
    public void ManagerCannotTakeOverUnsubmittedOrArchivedAssessment(string status)
    {
        Assert.False(ElevatePracticeAccessPolicy.CanEdit(CreateUser(), SubjectStaffId, status, 1));
    }

    [Theory]
    [InlineData("draft")]
    [InlineData("submitted")]
    public void RecordAdministratorsRetainEditingAccess(string status)
    {
        Assert.True(ElevatePracticeAccessPolicy.CanEdit(CreateUser(PermissionKeys.RecordsManage), SubjectStaffId, status, null));
    }

    [Fact]
    public void StaffCannotUseManagerEditingRouteForOwnSubmittedAssessment()
    {
        var user = CreateUser() with { StaffId = SubjectStaffId };

        Assert.False(ElevatePracticeAccessPolicy.CanEdit(user, SubjectStaffId, "submitted", 1));
    }

    [Theory]
    [InlineData(null)]
    [InlineData(0)]
    [InlineData(-1)]
    public void AbsentOrInvalidManagementRelationshipDoesNotGrantEditing(int? managementDepth)
    {
        Assert.False(ElevatePracticeAccessPolicy.CanEdit(CreateUser(), SubjectStaffId, "submitted", managementDepth));
    }

    [Fact]
    public void UnlinkedUserCannotGainManagerEditingAccess()
    {
        var user = CreateUser() with { StaffId = null };

        Assert.False(ElevatePracticeAccessPolicy.CanEdit(user, SubjectStaffId, "submitted", 1));
    }

    private static CurrentUser CreateUser(params string[] permissions) => new(
        Guid.NewGuid(),
        Guid.NewGuid(),
        "Manager",
        "manager@example.com",
        permissions.ToHashSet(StringComparer.OrdinalIgnoreCase),
        []);
}
