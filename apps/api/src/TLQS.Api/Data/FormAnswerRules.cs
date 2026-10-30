using System.Globalization;
using System.Text.Json;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public static class FormAnswerRules
{
    public static bool IsAnswered(string? value, string fieldType)
    {
        if (string.IsNullOrWhiteSpace(value)) return false;
        if (fieldType is not ("multi_select" or "checkbox_group")) return true;
        try { using var json = JsonDocument.Parse(value); return json.RootElement.ValueKind == JsonValueKind.Array && json.RootElement.GetArrayLength() > 0; }
        catch (JsonException) { return false; }
    }
    public static void ValidateCustomAnswer(string key, string type, string label, IReadOnlyList<string> options, string? value)
    {
        if (!key.StartsWith("custom_", StringComparison.Ordinal) || string.IsNullOrWhiteSpace(value)) return;
        var valid = type switch
        {
            "number" => decimal.TryParse(value, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out _),
            "date" => DateOnly.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _),
            "yes_no_partial" => new[] { "Yes", "No", "Partial", "Partially" }.Contains(value, StringComparer.OrdinalIgnoreCase),
            "single_select" or "rubric_scale" => options.Contains(value, StringComparer.Ordinal),
            "multi_select" or "checkbox_group" => ValidChoices(value, options),
            "short_text" or "long_text" => true,
            _ => false
        };
        if (!valid) throw new WorkflowValidationException($"Enter a valid answer for '{label}' using this version's response choices.");
    }
    private static bool ValidChoices(string value, IReadOnlyList<string> options)
    {
        try
        {
            using var json = JsonDocument.Parse(value);
            if (json.RootElement.ValueKind != JsonValueKind.Array) return false;
            var choices = json.RootElement.EnumerateArray().ToArray();
            return choices.All(item => item.ValueKind == JsonValueKind.String && options.Contains(item.GetString()!, StringComparer.Ordinal))
                && choices.Select(item => item.GetString()).Distinct(StringComparer.Ordinal).Count() == choices.Length;
        }
        catch (JsonException) { return false; }
    }
}
