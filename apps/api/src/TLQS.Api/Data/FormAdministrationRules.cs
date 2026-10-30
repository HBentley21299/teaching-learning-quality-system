using System.Text.RegularExpressions;
using TLQS.Api.V1;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

/// <summary>Core data contracts remain stable; additional questions belong to immutable published versions.</summary>
public static partial class FormAdministrationRules
{
    public static bool SupportsModule(string moduleKey) => moduleKey is "learning_walks" or "work_scrutiny" or "cpd" or "elevate_environments";
    public static bool IsProtected(string moduleKey, string sectionKey, string fieldKey) => fieldKey.StartsWith("custom_", StringComparison.Ordinal) ? false : moduleKey == "work_scrutiny"
        ? sectionKey is "context" or "sample" or "actions" || fieldKey is "scrutiny_date" or "faculty_area" or "team_level" or "reviewer" or "course_sample" or "recommended_actions" or "qualification_level" or "course_level" or "course_or_unit" or "learning_walk_delivery_area"
        : true;
    public static readonly IReadOnlySet<string> EditableTypes = new HashSet<string>(StringComparer.Ordinal)
    { "short_text", "long_text", "number", "date", "yes_no_partial", "single_select", "multi_select", "checkbox_group", "rubric_scale" };
    private static readonly HashSet<string> ChoiceTypes = ["single_select", "multi_select", "checkbox_group", "rubric_scale"];

    public static void Validate(string moduleKey, IReadOnlyList<AdminFormSection> baseline, SaveFormVersionRequest request)
    {
        if (!SupportsModule(moduleKey)) throw new WorkflowValidationException("This form uses its dedicated workflow configuration.");
        if (string.IsNullOrWhiteSpace(request.Name) || request.Name.Trim().Length > 250 || request.Description?.Length > 1000)
            throw new WorkflowValidationException("Use a form name of 1–250 characters and a description of up to 1,000 characters.");
        // An older, empty Work Scrutiny draft can be saved once to receive its
        // required workflow questions. Protected baseline fields still cannot
        // be removed below, and the datastore adds the core section atomically.
        if (request.Sections is null || request.Sections.Count > 50 || request.Sections.Count == 0 && moduleKey != "work_scrutiny"
            || request.Sections.Sum(section => section.Fields?.Count ?? 0) > 300)
            throw new WorkflowValidationException("Use 1–50 sections and up to 300 questions.");
        ValidateProtectedFields(baseline, request.Sections);
        var oldFields = baseline.SelectMany(section => section.Fields.Select(field => (section.SectionKey, Field: field)))
            .ToDictionary(item => item.Field.FieldKey, StringComparer.OrdinalIgnoreCase);
        var keys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var sectionKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var section in request.Sections)
        {
            if (!ValidKey(section.SectionKey) || !sectionKeys.Add(section.SectionKey) || string.IsNullOrWhiteSpace(section.Title) || section.Title.Trim().Length > 250)
                throw new WorkflowValidationException("Each section needs a distinct reference key and a title of up to 250 characters.");
            if (section.Fields is null || section.Fields.Count == 0)
                throw new WorkflowValidationException($"Add a question to '{section.Title}' or remove the empty section.");
            foreach (var field in section.Fields)
            {
                if (!ValidKey(field.FieldKey) || !keys.Add(field.FieldKey) || string.IsNullOrWhiteSpace(field.Label)
                    || field.Label.Trim().Length > 300 || field.HelpText?.Length > 1000)
                    throw new WorkflowValidationException("Each question needs a distinct reference key, a label of up to 300 characters and guidance of up to 1,000 characters.");
                var options = field.Options ?? [];
                if (oldFields.TryGetValue(field.FieldKey, out var old) && old.Field.IsProtected)
                {
                    continue;
                }
                else
                {
                    if (!oldFields.ContainsKey(field.FieldKey) && !field.FieldKey.StartsWith("custom_", StringComparison.Ordinal))
                        throw new WorkflowValidationException("New question keys must start with custom_.");
                    if (!EditableTypes.Contains(field.FieldType)) throw new WorkflowValidationException($"Choose a supported answer type for '{field.Label}'.");
                    if (options.Count > 20 || options.Any(value => string.IsNullOrWhiteSpace(value) || value.Length > 300)
                        || options.Distinct(StringComparer.OrdinalIgnoreCase).Count() != options.Count
                        || ChoiceTypes.Contains(field.FieldType) && options.Count < 2
                        || !ChoiceTypes.Contains(field.FieldType) && options.Count != 0)
                        throw new WorkflowValidationException($"'{field.Label}' needs 2–20 distinct choices for a choice question, and no configured choices for other answer types.");
                }
            }
        }
    }

    public static void ValidateProtectedFields(IReadOnlyList<AdminFormSection> baseline, IReadOnlyList<FormStructureSectionRequest> sections)
    {
        var protectedFields = baseline.SelectMany(section => section.Fields.Where(field => field.IsProtected).Select(field => (section.SectionKey, Field: field)))
            .ToDictionary(item => item.Field.FieldKey, StringComparer.OrdinalIgnoreCase);
        var retained = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var section in sections)
        foreach (var field in section.Fields ?? [])
        {
            if (!protectedFields.TryGetValue(field.FieldKey, out var known)) continue;
            if (section.SectionKey != known.SectionKey || field.FieldKey != known.Field.FieldKey || field.FieldType != known.Field.FieldType
                || field.IsRequired != known.Field.IsRequired || !(field.Options ?? []).SequenceEqual(known.Field.Options, StringComparer.Ordinal))
                throw new WorkflowValidationException($"'{known.Field.Label}' is a core field. Keep its section, answer type, required rule and managed choices unchanged; wording and guidance can be edited.");
            retained.Add(field.FieldKey);
        }
        foreach (var field in protectedFields.Values)
            if (!retained.Contains(field.Field.FieldKey)) throw new WorkflowValidationException($"Keep core question '{field.Field.Label}' to preserve this form's workflow and reporting.");
    }
    private static bool ValidKey(string? key) => key is { Length: > 0 and <= 100 } && ReferenceKey().IsMatch(key);
    [GeneratedRegex("^[a-zA-Z][a-zA-Z0-9_]*$")]
    private static partial Regex ReferenceKey();
}
