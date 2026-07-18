namespace TLQS.Application.Forms;

public static class FormSubmissionRules
{
    private static readonly HashSet<string> DedicatedWorkflowRecordTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "learning_walk",
        "work_scrutiny",
        "cpd_event",
        "external_cpd",
        "elevate_environment",
        "coaching_session",
        "liv",
        "liv_record",
        "reflection",
        "elevate_practice",
        "elevate_practice_assessment"
    };

    public static bool RequiresDedicatedWorkflow(string? recordType) =>
        !string.IsNullOrWhiteSpace(recordType) && DedicatedWorkflowRecordTypes.Contains(recordType);

    public static bool IsKnownTemplateRecordTypePair(string? templateKey, string? recordType)
    {
        if (string.IsNullOrWhiteSpace(templateKey) || string.IsNullOrWhiteSpace(recordType))
        {
            return false;
        }

        if (templateKey.StartsWith("work_scrutiny_", StringComparison.OrdinalIgnoreCase))
        {
            return recordType.Equals("work_scrutiny", StringComparison.OrdinalIgnoreCase);
        }

        return templateKey.ToLowerInvariant() switch
        {
            "learning_walk_core" => recordType.Equals("learning_walk", StringComparison.OrdinalIgnoreCase),
            "cpd_core" => recordType.Equals("cpd_event", StringComparison.OrdinalIgnoreCase),
            "external_cpd_core" => recordType.Equals("external_cpd", StringComparison.OrdinalIgnoreCase),
            "elevate_learning_environments_core" => recordType.Equals("elevate_environment", StringComparison.OrdinalIgnoreCase),
            _ => false
        };
    }

    public static bool IsTemplateModuleRecordTypePair(
        string? templateKey,
        string? moduleKey,
        string? recordType)
    {
        if (!IsKnownTemplateRecordTypePair(templateKey, recordType)
            || string.IsNullOrWhiteSpace(moduleKey))
        {
            return false;
        }

        return recordType?.ToLowerInvariant() switch
        {
            "learning_walk" => moduleKey.Equals("learning_walks", StringComparison.OrdinalIgnoreCase),
            "work_scrutiny" => moduleKey.Equals("work_scrutiny", StringComparison.OrdinalIgnoreCase),
            "cpd_event" or "external_cpd" => moduleKey.Equals("cpd", StringComparison.OrdinalIgnoreCase),
            "elevate_environment" => moduleKey.Equals("elevate_environments", StringComparison.OrdinalIgnoreCase),
            _ => false
        };
    }
}

public static class RubricSubmissionRules
{
    public static bool IsRubricField(string? fieldType) =>
        string.Equals(fieldType, "judgement_scale_1_5", StringComparison.OrdinalIgnoreCase)
        || string.Equals(fieldType, "practice_rubric_1_5", StringComparison.OrdinalIgnoreCase)
        || string.Equals(fieldType, "pillar_rubric_1_5", StringComparison.OrdinalIgnoreCase)
        || string.Equals(fieldType, "score_0_3", StringComparison.OrdinalIgnoreCase);

    public static bool IsValidValue(
        string? fieldType,
        string? value,
        IReadOnlyCollection<string> configuredOptions,
        string? recordType,
        string? templateVersion)
    {
        if (!IsRubricField(fieldType) || string.IsNullOrWhiteSpace(value))
        {
            return true;
        }

        if (string.Equals(fieldType, "score_0_3", StringComparison.OrdinalIgnoreCase))
        {
            return string.Equals(recordType, "elevate_environment", StringComparison.OrdinalIgnoreCase)
                && string.Equals(templateVersion, "1.0", StringComparison.OrdinalIgnoreCase)
                && int.TryParse(value, out var legacyScore)
                && legacyScore is >= 0 and <= 3;
        }

        return configuredOptions.Contains(value, StringComparer.Ordinal);
    }
}
