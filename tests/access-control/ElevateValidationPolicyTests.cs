using TLQS.Application.Security;
using TLQS.Application.Workflows;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class ElevateValidationPolicyTests
{
    private static readonly Guid SubjectStaffId = Guid.Parse("10000000-0000-0000-0000-000000000001");

    [Theory]
    [InlineData(true, true)]
    [InlineData(false, false)]
    public void ProgrammeLeaderValidationRequiresAssignedStaffScope(bool inScope, bool expected)
    {
        var user = CreateUser(PermissionKeys.ElevatePracticeValidate);
        Assert.Equal(expected, ElevateValidationPolicy.CanReview(user, SubjectStaffId, inScope));
    }

    [Theory]
    [InlineData(PermissionKeys.ReportsViewAll)]
    [InlineData(PermissionKeys.ReportsViewScoped)]
    [InlineData(PermissionKeys.StaffManage)]
    [InlineData(PermissionKeys.FormsManage)]
    [InlineData(PermissionKeys.ElevatePracticeSubmit)]
    public void VisibilityAndOtherPermissionsDoNotGrantValidation(string permission)
    {
        Assert.False(ElevateValidationPolicy.CanReview(CreateUser(permission), SubjectStaffId, true));
    }

    [Fact]
    public void RecordAdministratorCanReviewAnotherStaffMemberWithoutAssignedScope()
    {
        Assert.True(ElevateValidationPolicy.CanReview(CreateUser(PermissionKeys.RecordsManage), SubjectStaffId, false));
    }

    [Theory]
    [InlineData(PermissionKeys.RecordsManage)]
    [InlineData(PermissionKeys.ElevatePracticeValidate)]
    public void NoReviewerCanValidateTheirOwnAssessment(string permission)
    {
        var user = CreateUser(permission) with { StaffId = SubjectStaffId };
        Assert.False(ElevateValidationPolicy.CanReview(user, SubjectStaffId, true));
    }

    [Theory]
    [InlineData(PermissionKeys.RecordsManage)]
    [InlineData(PermissionKeys.ElevatePracticeValidate)]
    public void ValidationRequiresLinkedStaffIdentity(string permission)
    {
        var user = CreateUser(permission) with { StaffId = null };
        Assert.False(ElevateValidationPolicy.CanReview(user, SubjectStaffId, true));
    }

    [Theory]
    [InlineData("draft", "draft")]
    [InlineData("draft", "returned")]
    [InlineData("submitted", "validated")]
    [InlineData("submitted", "returned")]
    [InlineData("submitted", "draft")]
    [InlineData("archived", "pending")]
    public void OnlySubmittedAssessmentsAwaitingValidationCanReceiveADecision(string status, string validation)
    {
        Assert.Throws<WorkflowValidationException>(() =>
            ElevateValidationPolicy.ValidateDecision(status, validation, "validate", null));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void ReturningAssessmentRequiresUsefulFeedback(string? note)
    {
        Assert.Throws<WorkflowValidationException>(() =>
            ElevateValidationPolicy.ValidateDecision("submitted", "pending", "return", note));
    }

    [Theory]
    [InlineData("validate", null)]
    [InlineData("validate", "All statements reviewed and agreed.")]
    [InlineData("return", "Revisit the statement about assessment feedback.")]
    public void PendingSubmissionAcceptsValidReviewDecisions(string action, string? note)
    {
        ElevateValidationPolicy.ValidateDecision("submitted", "pending", action, note);
    }

    [Theory]
    [InlineData("validate")]
    [InlineData("return")]
    public void ReviewFeedbackUsesTheSupportedStorageLimit(string action)
    {
        ElevateValidationPolicy.ValidateDecision("submitted", "pending", action, new string('x', 4000));
        Assert.Throws<WorkflowValidationException>(() =>
            ElevateValidationPolicy.ValidateDecision("submitted", "pending", action, new string('x', 4001)));
    }

    [Theory]
    [InlineData("")]
    [InlineData("approve")]
    [InlineData("submitted")]
    public void UnknownDecisionsCannotChangeValidationState(string action)
    {
        Assert.Throws<WorkflowValidationException>(() =>
            ElevateValidationPolicy.ValidateDecision("submitted", "pending", action, "Feedback"));
    }

    [Theory]
    [InlineData("submitted", "draft", "pending")]
    [InlineData("submitted", "returned", "pending")]
    [InlineData("submitted", "pending", "pending")]
    [InlineData("submitted", "validated", "pending")]
    [InlineData("draft", "draft", "draft")]
    [InlineData("draft", "returned", "returned")]
    [InlineData("draft", "pending", "draft")]
    [InlineData("draft", "validated", "draft")]
    public void ContentChangesRequireReviewAgainAndPreserveOpenAmendmentRequests(
        string status, string previousValidation, string expected)
    {
        Assert.Equal(expected, ElevateValidationPolicy.AfterContentSave(status, previousValidation));
    }

    private static CurrentUser CreateUser(params string[] permissions) => new(
        Guid.NewGuid(), Guid.NewGuid(), "Programme leader", "programme.leader@example.com",
        permissions.ToHashSet(StringComparer.OrdinalIgnoreCase), []);
}
