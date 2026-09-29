namespace TLQS.Application.Workflows;

public static class WorkScrutinyResponseRules
{
    public static IReadOnlyList<string> CourseLevels { get; } = Array.AsReadOnly(new[] { "Pre-entry", "Entry Level", "Level 1", "Level 2", "Level 3", "Level 4", "Level 5", "Level 6", "Level 7" });
    public static IReadOnlyList<string> CourseLevelKeys { get; } = Array.AsReadOnly(new[] { "qualification_level", "course_level", "course_or_unit" });

    public static void ValidateCourseLevel(string? value, IReadOnlyList<string> configuredOptions)
    {
        var options = configuredOptions.Count > 0 ? configuredOptions : CourseLevels;
        if (string.IsNullOrWhiteSpace(value) || !options.Contains(value, StringComparer.Ordinal))
            throw new WorkflowValidationException("Select a course level for the scrutiny sample.");
    }

    public static void Validate(string fieldKey, string fieldType, string label, IReadOnlyList<string> options, string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return;

        if (fieldKey == "sample_size" && (!int.TryParse(value, out var count) || count < 1))
        {
            throw new WorkflowValidationException("Learner sample size must be a positive whole number.");
        }

        if (options.Count == 0) return; // Preserve legacy fields without configured choices.
        var selected = fieldType is "multi_select" or "checkbox_group"
            ? value.Split('|', StringSplitOptions.RemoveEmptyEntries)
            : fieldType is "single_select" or "rubric_scale" ? [value] : Array.Empty<string>();
        if ((fieldType is "multi_select" or "checkbox_group" && selected.Length == 0)
            || selected.Any(choice => !options.Contains(choice, StringComparer.Ordinal)))
        {
            throw new WorkflowValidationException($"Choose a configured response for {label}.");
        }

        if (fieldKey == "triangulation_sources" && selected.Length > 1 && selected.Contains("No further validation required"))
            throw new WorkflowValidationException("Choose further evidence or No further validation required, rather than both.");
    }
}
