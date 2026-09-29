namespace TLQS.Application.Workflows;

public static class LearningWalkDeliveryAreaRules
{
    public const string FieldKey = "learning_walk_delivery_area";

    public static string LookupKey(string recordType) => recordType switch
    {
        "learning_walk" => "liv_delivery_area",
        "als_learning_walk" => "als_liv_delivery_area",
        "work_scrutiny" => "liv_delivery_area",
        _ => throw new WorkflowValidationException("Delivery areas are not supported for this form.")
    };

    public static void Validate(string? key, string? previousKey, bool isActive, bool required)
    {
        if (string.IsNullOrWhiteSpace(key))
        {
            if (required || !string.IsNullOrWhiteSpace(previousKey))
                throw new WorkflowValidationException("Select a delivery area before submitting.");
            return;
        }

        if (!isActive && !string.Equals(key, previousKey, StringComparison.Ordinal))
            throw new WorkflowValidationException("Choose an active delivery area from the list.");
    }
}
