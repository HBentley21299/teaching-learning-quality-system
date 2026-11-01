namespace TLQS.Application.Workflows;

/// <summary>New actions inherit their process identity from an existing source record.</summary>
public static class ActionOriginPolicy
{
    private static readonly HashSet<string> GenericSources = new(StringComparer.Ordinal)
    {
        "learning_walk", "als_learning_walk", "work_scrutiny", "elevate_environment", "cpd_event",
        "liv", "als_liv", "probation_observation"
    };

    private static readonly HashSet<string> NativeSources = new(StringComparer.Ordinal)
    {
        "coaching_mentoring", "elevate_practice", "qa_review", "uco_tla_review",
        "digital_learning_walk", "activate_growth_review"
    };

    public static Guid RequireSourceRecord(Guid? sourceRecordId) => sourceRecordId is { } id && id != Guid.Empty
        ? id : throw new WorkflowValidationException("Create actions from their originating form or review. A source record is required.");

    public static string CanonicalSourceType(string? value) => value?.Trim().ToLowerInvariant() switch
    {
        "probation_case" => "probation_observation",
        "coaching_session" => "coaching_mentoring",
        "elevate_practice_assessment" => "elevate_practice",
        "cpd" => "cpd_event",
        var normalized => normalized ?? ""
    };

    public static string ResolveForGenericCreation(string storedRecordType, string? requestedSourceType)
    {
        var source = CanonicalSourceType(storedRecordType);
        if (NativeSources.Contains(source))
            throw new WorkflowValidationException("Create this action from its originating form or review so its workflow and history are retained.");
        if (!GenericSources.Contains(source))
            throw new WorkflowValidationException("Choose an existing supported form or review as the action's origin.");
        if (!string.IsNullOrWhiteSpace(requestedSourceType) && CanonicalSourceType(requestedSourceType) != source)
            throw new WorkflowValidationException("The action's process must match its originating record.");
        return source;
    }

    public static Guid? ResolveSubject(Guid? sourceSubject, Guid? requestedSubject)
    {
        if (requestedSubject == Guid.Empty || (sourceSubject.HasValue && requestedSubject.HasValue && sourceSubject != requestedSubject))
            throw new WorkflowValidationException("The action's associated staff member must match its originating record.");
        return sourceSubject ?? requestedSubject;
    }

    public static void ValidateSubRecord(string sourceType, string? subType, Guid? subId, Guid? visitId, Guid? cycleId, string? subKey)
    {
        if (subId == Guid.Empty || visitId == Guid.Empty || cycleId == Guid.Empty
            || (subType is null) != !subId.HasValue || (subKey is not null && subType is null))
            throw new WorkflowValidationException("Provide a valid originating visit, cycle or observation reference.");
        var livSubRecord = (subType is "liv_visit" or "liv_cycle") && (sourceType is "liv" or "als_liv");
        if (subType is not null && !livSubRecord
            && !(subType == "probation_observation" && sourceType == "probation_observation"))
            throw new WorkflowValidationException("The originating visit, cycle or observation must belong to this process.");
        if ((visitId.HasValue && (subType != "liv_visit" || subId != visitId))
            || (cycleId.HasValue && (sourceType is not ("liv" or "als_liv") || subType == "liv_cycle" && subId != cycleId)))
            throw new WorkflowValidationException("The action's originating visit and cycle references do not match.");
    }
}
