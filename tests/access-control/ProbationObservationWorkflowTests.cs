using TLQS.Application.Workflows;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class ProbationObservationWorkflowTests
{
    [Theory]
    [InlineData("programme_leader")]
    [InlineData("head_of_faculty")]
    [InlineData("director")]
    [InlineData("super_admin")]
    public void LeadersCanCreateProbationCases(string roleKey)
    {
        Assert.True(ProbationObservationWorkflow.CanCreateCase([roleKey]));
    }

    [Theory]
    [InlineData("staff")]
    [InlineData("teaching_learning_team")]
    public void NonLeadershipRolesCannotCreateProbationCases(string roleKey)
    {
        Assert.False(ProbationObservationWorkflow.CanCreateCase([roleKey]));
    }

    [Fact]
    public void DirectorsAndAdministratorsCanSelectAnyStaffMember()
    {
        Assert.True(ProbationObservationWorkflow.CanSelectAnyStaff(["director"]));
        Assert.True(ProbationObservationWorkflow.CanSelectAnyStaff(["super_admin"]));
        Assert.False(ProbationObservationWorkflow.CanSelectAnyStaff(["head_of_faculty"]));
        Assert.False(ProbationObservationWorkflow.CanSelectAnyStaff(["programme_leader"]));
    }

    [Fact]
    public void ExistingCaseForAcademicYearPreventsDuplicateCreation()
    {
        var exception = Assert.Throws<WorkflowValidationException>(() =>
            ProbationObservationWorkflow.ValidateCaseCreation(true, "2026/27"));

        Assert.Equal(
            "A probationary observation cycle already exists for this staff member in 2026/27. Open the existing cycle instead.",
            exception.Message);
    }

    [Fact]
    public void StaffWithoutCaseForAcademicYearCanCreateCycle()
    {
        ProbationObservationWorkflow.ValidateCaseCreation(false, "2026/27");
    }

    [Fact]
    public void ObservationOneRequiresTheNextObservationDateStage()
    {
        Assert.Equal(
            ["professional_discussion", "visit_rubric", "reflection_feedback", "actions", "next_observation"],
            ProbationObservationWorkflow.RequiredStageTypes(1));
    }

    [Fact]
    public void ObservationThreeDoesNotRequireTheHiddenNextDateStage()
    {
        Assert.Equal(
            ["professional_discussion", "visit_rubric", "reflection_feedback", "actions"],
            ProbationObservationWorkflow.RequiredStageTypes(3));
    }

    [Theory]
    [InlineData(1, 2)]
    [InlineData(2, 3)]
    [InlineData(3, 3)]
    public void ObservationsAdvanceSequentially(int completed, int expected)
    {
        Assert.Equal(expected, ProbationObservationWorkflow.NextObservationNumber(completed));
    }

    [Fact]
    public void CompletionRequiresEveryObservedRubricArea()
    {
        var stages = ProbationObservationWorkflow.RequiredStageTypes(1);
        Assert.Throws<WorkflowValidationException>(() =>
            ProbationObservationWorkflow.ValidateCompletion(1, stages, selectedRubricAreas: 3, requiredRubricAreas: 4));
    }

    [Fact]
    public void CompletionAllowsEveryRubricAreaToBeNotObserved()
    {
        var stages = ProbationObservationWorkflow.RequiredStageTypes(1);
        ProbationObservationWorkflow.ValidateCompletion(
            1,
            stages,
            selectedRubricAreas: 0,
            requiredRubricAreas: 0);
    }

    [Fact]
    public void CompleteObservationThreePassesWithoutANextDateStage()
    {
        var stages = ProbationObservationWorkflow.RequiredStageTypes(3);
        ProbationObservationWorkflow.ValidateCompletion(3, stages, selectedRubricAreas: 4, requiredRubricAreas: 4);
    }
}
