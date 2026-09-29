namespace TLQS.Application.Workflows;

// Presentation only. The fixed neutral Not seen code is separate from these editable labels.
public sealed record QaOutcomeLabels(string Below, string At, string Above, string NotApplicable)
{
    public static QaOutcomeLabels Default { get; } = new("Below standard", "At standard", "Above standard", "Not applicable");
    [System.Text.Json.Serialization.JsonIgnore]
    public string AtOrAbove => $"{At} / {Above}";

    public static QaOutcomeLabels Validate(string? below, string? at, string? above, string? notApplicable)
    {
        var labels = new[] { below, at, above, notApplicable }.Select(value => value?.Trim() ?? "").ToArray();
        if (labels.Any(value => value.Length is < 1 or > 40 || value.Any(char.IsControl)))
            throw new WorkflowValidationException("Each outcome label must contain 1–40 characters on a single line.");
        if (labels.Distinct(StringComparer.OrdinalIgnoreCase).Count() != 4)
            throw new WorkflowValidationException("Use a different label for each outcome so ratings remain unambiguous.");
        if (labels.Any(value => value.Equals("Not seen", StringComparison.OrdinalIgnoreCase)))
            throw new WorkflowValidationException("Not seen is reserved for the separate neutral outcome.");
        return new(labels[0], labels[1], labels[2], labels[3]);
    }
}
