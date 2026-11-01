namespace TLQS.Application.Workflows;

public enum GenericActionMutation { Update, Extend, Delete, Restore }

/// <summary>Source workflows own structural fields; the action engine owns permitted progress updates.</summary>
public static class ActionMutationPolicy
{
    public static bool RequiresSourceWorkflow(Guid? sourceRecordId, string? sourceType) =>
        sourceRecordId.HasValue && sourceRecordId != Guid.Empty
        && ActionOriginPolicy.CanonicalSourceType(sourceType) is "qa_review" or "uco_tla_review" or "coaching_mentoring" or "elevate_practice";

    public static void ValidateGenericMutation(Guid? sourceRecordId, string? sourceType, GenericActionMutation mutation, bool structuralFields = false)
    {
        if (RequiresSourceWorkflow(sourceRecordId, sourceType)
            && (structuralFields || mutation is GenericActionMutation.Delete or GenericActionMutation.Restore))
            throw new WorkflowValidationException("Change this action's structure or removal through its originating form or review. Progress and audited extensions remain available in Actions.");
    }

    public static void ValidateQaProgress(string? groupStatus, string? reviewStatus, bool sourceArchived)
    {
        if (sourceArchived || string.Equals(reviewStatus,"archived",StringComparison.OrdinalIgnoreCase)
            || groupStatus?.Trim().ToLowerInvariant() is "closed" or "archived")
            throw new WorkflowValidationException("This QA action's group is closed or its review is archived. Manage it through QA Hub before changing progress.");
    }
}
