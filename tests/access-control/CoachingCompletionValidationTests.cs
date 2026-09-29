using System.Reflection;
using TLQS.Api.Data;
using TLQS.Api.V1;
using TLQS.Application.Workflows;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class CoachingCompletionValidationTests
{
    private static void Validate(SaveCoachingSessionRequest request) =>
        typeof(SqlFoundationDataStore).GetMethod("ValidateCoachingRequest", BindingFlags.NonPublic | BindingFlags.Static)!
            .Invoke(null, [request]);

    private static SaveCoachingSessionRequest CompletedSession() => new(
        StaffId: Guid.NewGuid(), CycleId: null, CreateNewCycle: true,
        SessionDate: new DateOnly(2026, 9, 8), SessionType: "coaching", DeliveryMethod: "in_person",
        DurationMinutes: 30, Status: "completed", QualificationStatusKey: "qualified",
        PrimaryFocusKey: "planning", SecondaryFocusKey: null, FocusOtherText: null,
        SpecificSessionFocus: "Plan checks for understanding.", CurrentPracticeDescriptorId: null,
        CurrentPracticeEvidence: null, SupportTypes: ["discussion"], SupportOtherText: null,
        ConversationSummary: "Reviewed the approach and agreed next steps.", CloseCycle: true,
        ActionReviews: [], Actions: []);

    [Fact]
    public void CompletionDoesNotRequireRemovedPracticeRating() => Validate(CompletedSession());

    [Fact]
    public void CompletionStillRequiresSessionFocus()
    {
        var exception = Assert.Throws<TargetInvocationException>(() => Validate(CompletedSession() with { SpecificSessionFocus = null }));
        Assert.IsType<WorkflowValidationException>(exception.InnerException);
        Assert.Contains("focus", exception.InnerException!.Message);
    }
}
