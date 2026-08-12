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

    /// <summary>The owner may correct any unarchived submission. Forms managers retain
    /// oversight access regardless of lifecycle status.</summary>
    public static bool CanEditResponses(string currentStatus, bool isOwner, bool canManageForms) =>
        canManageForms || isOwner;

    public static bool CanEditRecord(string recordType, string currentStatus, bool isOwner, bool canManageForms) =>
        CanEditResponses(currentStatus, isOwner, canManageForms)
        || (recordType.Equals("work_scrutiny", StringComparison.OrdinalIgnoreCase) && isOwner);

    public static bool CanArchiveRecord(string recordType, bool canManageForms, bool canManageUsers) =>
        recordType.Equals("work_scrutiny", StringComparison.OrdinalIgnoreCase)
            ? canManageUsers
            : canManageForms;

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
