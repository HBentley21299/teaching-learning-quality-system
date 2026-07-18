namespace TLQS.Application.Workflows;

public static class ProbationObservationWorkflow
{
    private static readonly HashSet<string> CreatorRoles = new(StringComparer.OrdinalIgnoreCase)
    {
        "programme_leader",
        "head_of_faculty",
        "director",
        "super_admin"
    };

    private static readonly HashSet<string> OrganisationWideRoles = new(StringComparer.OrdinalIgnoreCase)
    {
        "director",
        "super_admin"
    };

    public static bool CanCreateCase(IEnumerable<string> roleKeys) => roleKeys.Any(CreatorRoles.Contains);

    public static bool CanSelectAnyStaff(IEnumerable<string> roleKeys) => roleKeys.Any(OrganisationWideRoles.Contains);

    public static IReadOnlyList<string> RequiredStageTypes(int observationNumber) => observationNumber switch
    {
        1 => ["professional_discussion", "visit_rubric", "reflection_feedback", "actions", "next_observation"],
        3 => ["professional_discussion", "visit_rubric", "reflection_feedback", "actions"],
        _ => throw new WorkflowValidationException("Only probation observations 1 and 3 use the probation template.")
    };

    public static int NextObservationNumber(int completedObservationNumber) => completedObservationNumber switch
    {
        1 => 2,
        2 => 3,
        3 => 3,
        _ => throw new WorkflowValidationException("The probation observation number must be between 1 and 3.")
    };

    public static void ValidateCompletion(
        int observationNumber,
        IReadOnlyCollection<string> completedStageTypes,
        int selectedRubricAreas,
        int requiredRubricAreas)
    {
        var missing = RequiredStageTypes(observationNumber)
            .Where(stage => !completedStageTypes.Contains(stage, StringComparer.OrdinalIgnoreCase))
            .ToArray();
        if (missing.Length > 0)
        {
            throw new WorkflowValidationException("Complete every required stage before completing this probation observation.");
        }

        if (requiredRubricAreas <= 0 || selectedRubricAreas != requiredRubricAreas)
        {
            throw new WorkflowValidationException("Select a practice outcome for every probation rubric area.");
        }
    }
}
