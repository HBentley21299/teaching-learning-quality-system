namespace TLQS.Application.Workflows;

/// <summary>
/// Status transitions for form submissions. Statuses are stored in
/// forms.form_submissions.status: draft -> submitted -> reopened -> submitted.
/// Archiving stamps core.records.archived_at and is allowed from any status.
/// </summary>
public static class SubmissionLifecycle
{
    public const string Draft = "draft";
    public const string Submitted = "submitted";
    public const string Reopened = "reopened";

    public const string ActionSubmit = "submit";
    public const string ActionReopen = "reopen";
    public const string ActionArchive = "archive";

    public static string? GetTargetStatus(string currentStatus, string action) =>
        (currentStatus, action) switch
        {
            (Draft, ActionSubmit) => Submitted,
            (Reopened, ActionSubmit) => Submitted,
            (Submitted, ActionReopen) => Reopened,
            (_, ActionArchive) => currentStatus,
            _ => null
        };

    /// <summary>Editing responses is only allowed while a submission is in draft or reopened,
    /// unless the caller has forms.manage.</summary>
    public static bool CanEditResponses(string currentStatus, bool isOwner, bool canManageForms) =>
        canManageForms || (isOwner && currentStatus is Draft or Reopened);

    public static bool CanPerform(string action, bool isOwner, bool canManageForms) =>
        action switch
        {
            ActionSubmit => isOwner || canManageForms,
            ActionReopen => canManageForms,
            ActionArchive => canManageForms,
            _ => false
        };
}

public sealed class WorkflowValidationException(string message) : Exception(message);
