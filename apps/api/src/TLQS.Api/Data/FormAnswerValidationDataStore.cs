using System.Data.Common;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    private static async Task ValidateFormAnswersAsync(SqlConnection connection, DbTransaction transaction,
        Dictionary<Guid, FormFieldInfo> fields, IReadOnlyList<SubmitFormResponseRequest> responses,
        string recordType, bool requireComplete, CancellationToken cancellationToken)
    {
        if (responses.GroupBy(response => response.FieldId).Any(group => group.Count() > 1))
            throw new WorkflowValidationException("Each form question can have only one response.");
        if (responses.Any(response => !fields.ContainsKey(response.FieldId)))
            throw new WorkflowValidationException("The questions do not match this form version. Reload the form before saving.");
        foreach (var response in responses)
        {
            var field = fields[response.FieldId];
            FormAnswerRules.ValidateCustomAnswer(field.FieldKey, field.FieldType, field.Label, field.Options, response.Value);
        }
        if (!requireComplete) return;
        var hiddenSections = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (recordType == "elevate_environment")
        {
            await using var command = new SqlCommand("""
                SELECT pillar.pillar_key FROM quality.elevate_environment_pillars pillar
                JOIN core.system_assets asset ON asset.id=pillar.system_asset_id
                WHERE pillar.archived_at IS NULL AND (pillar.is_active=0 OR asset.is_active=0);
                """, connection, (SqlTransaction)transaction);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken)) hiddenSections.Add(reader.GetString(0));
        }
        var values = responses.ToDictionary(response => response.FieldId, response => response.Value);
        var pillars = new[] { "aspirational", "collaborative", "respectful", "innovative", "inclusion" };
        var missing = fields.Where(pair =>
        {
            var field = pair.Value;
            if (!field.IsRequired || field.FieldType is "team_bulk_add" or "selected_staff_list") return false;
            // The authoritative Learning Walk theme policy separately requires Other context when it is selected.
            if (IsLearningWalkRecordType(recordType) && field.FieldKey == "additional_focus_other") return false;
            if (recordType == "elevate_environment" && !field.FieldKey.StartsWith("custom_", StringComparison.Ordinal)
                && (hiddenSections.Contains(field.SectionKey) || field.FieldKey == "intended_purpose"
                    || pillars.Any(key => field.FieldKey == $"{key}_action" || field.FieldKey == $"{key}_owner" || field.FieldKey == $"{key}_target"))) return false;
            var value = values.GetValueOrDefault(pair.Key);
            if (field.FieldKey.StartsWith("custom_", StringComparison.Ordinal)) return !FormAnswerRules.IsAnswered(value, field.FieldType);
            // Existing CPD and Work Scrutiny choices use pipe-delimited values.
            // Custom questions use JSON; neither format may treat an empty selection as an answer.
            return string.IsNullOrWhiteSpace(value) || (field.FieldType is "multi_select" or "checkbox_group" && value?.Trim() == "[]");
        }).Select(pair => pair.Value.Label).ToArray();
        if (missing.Length > 0) throw new WorkflowValidationException($"Complete the required fields before submitting: {string.Join(", ", missing)}.");
    }
}
