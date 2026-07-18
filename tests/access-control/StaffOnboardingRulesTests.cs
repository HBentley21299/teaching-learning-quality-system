using TLQS.Application.Identity;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class StaffOnboardingRulesTests
{
    [Theory]
    [InlineData(StaffOnboardingRules.HeadOfFacultySectorManager)]
    [InlineData(StaffOnboardingRules.ProgrammeLeader)]
    [InlineData(StaffOnboardingRules.TutorTutorAssessor)]
    [InlineData(StaffOnboardingRules.Other)]
    public void Every_self_onboarded_category_starts_with_staff_permissions(string category)
    {
        Assert.Equal("staff", StaffOnboardingRules.InitialRoleKeyFor(category));
    }

    [Theory]
    [InlineData(StaffOnboardingRules.HeadOfFacultySectorManager, "faculty")]
    [InlineData(StaffOnboardingRules.ProgrammeLeader, "team")]
    [InlineData(StaffOnboardingRules.TutorTutorAssessor, null)]
    [InlineData(StaffOnboardingRules.Other, null)]
    public void Leadership_category_records_the_admin_allocation_needed(string category, string? unitType)
    {
        Assert.Equal(unitType, StaffOnboardingRules.RequestedManagedUnitTypeFor(category));
    }

    [Fact]
    public void Privileged_central_roles_cannot_be_self_selected()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => StaffOnboardingRules.InitialRoleKeyFor("director"));
        Assert.Throws<ArgumentOutOfRangeException>(() => StaffOnboardingRules.InitialRoleKeyFor("teaching_learning_team"));
        Assert.Throws<ArgumentOutOfRangeException>(() => StaffOnboardingRules.InitialRoleKeyFor("super_admin"));
    }
}
