using TLQS.Api.V1;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    private static void ValidateWorkScrutinyCourseLevel(Dictionary<Guid, FormFieldInfo> fields,
        IReadOnlyList<SubmitFormResponseRequest> responses, IReadOnlyDictionary<string, string>? previous = null)
    {
        var field = WorkScrutinyResponseRules.CourseLevelKeys.Select(key => fields.FirstOrDefault(pair => pair.Value.FieldKey == key))
            .FirstOrDefault(pair => pair.Value is not null);
        if (field.Value is null)
        {
            if (previous is not null) return; // Historical templates without a level field remain editable.
            throw new WorkflowValidationException("Add a course level field to this Work Scrutiny template in the Form Editor before submitting.");
        }
        var value = responses.FirstOrDefault(response => response.FieldId == field.Key)?.Value;
        if (previous is not null && previous.GetValueOrDefault(field.Value.FieldKey) == value) return;
        WorkScrutinyResponseRules.ValidateCourseLevel(value, field.Value.Options);
    }

    private static void ValidateWorkScrutinyResponses(
        Dictionary<Guid, FormFieldInfo> fields,
        IReadOnlyList<SubmitFormResponseRequest> responses)
    {
        if (responses.Select(response => response.FieldId).Distinct().Count() != responses.Count
            || responses.Any(response => !fields.ContainsKey(response.FieldId)))
        {
            throw new WorkflowValidationException("This form has changed. Reopen the Work Scrutiny form before submitting.");
        }

        foreach (var response in responses)
        {
            var field = fields[response.FieldId];
            WorkScrutinyResponseRules.Validate(field.FieldKey, field.FieldType, field.Label, field.Options, response.Value);
        }
    }
}
