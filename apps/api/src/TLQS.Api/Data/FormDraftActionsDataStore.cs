using System.Data.Common;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Identity;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    private static async Task SaveDraftActionsAsync(SqlConnection connection, DbTransaction transaction,
        Guid submissionId, IReadOnlyList<DraftLinkedActionRequest> actions, CancellationToken cancellationToken)
    {
        if (actions.Count > 100 || actions.Any(action => (action.Title?.Length ?? 0) > 300
            || (action.ActionTheme?.Length ?? 0) > 300 || (action.Detail?.Length ?? 0) > 4000))
            throw new WorkflowValidationException("Keep drafts to 100 actions, with an action description of up to 300 characters.");
        await using var command = new SqlCommand("UPDATE forms.form_submissions SET draft_actions_json = @json WHERE id = @id;", connection, (SqlTransaction)transaction);
        command.Parameters.AddWithValue("@id", submissionId);
        command.Parameters.AddWithValue("@json", actions.Count == 0 ? DBNull.Value : JsonSerializer.Serialize(actions));
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task<IReadOnlyList<DraftLinkedActionRequest>> ReadDraftActionsAsync(SqlConnection connection,
        DbTransaction? transaction, Guid submissionId, CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(transaction is null
            ? "SELECT draft_actions_json FROM forms.form_submissions WHERE id = @id;"
            : "SELECT draft_actions_json FROM forms.form_submissions WITH (UPDLOCK, HOLDLOCK) WHERE id = @id;", connection, (SqlTransaction?)transaction);
        command.Parameters.AddWithValue("@id", submissionId);
        var json = await command.ExecuteScalarAsync(cancellationToken) as string;
        return string.IsNullOrWhiteSpace(json) ? [] : JsonSerializer.Deserialize<List<DraftLinkedActionRequest>>(json) ?? [];
    }

    private async Task<IReadOnlyList<DraftLinkedActionRequest>> GetDraftActionsAsync(Guid submissionId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        return await ReadDraftActionsAsync(connection, null, submissionId, cancellationToken);
    }

    private static async Task PublishDraftActionsAsync(SqlConnection connection, DbTransaction transaction,
        Guid submissionId, Guid recordId, string recordType, CurrentUser currentUser, CancellationToken cancellationToken)
    {
        var drafts = await ReadDraftActionsAsync(connection, transaction, submissionId, cancellationToken);
        if (drafts.Any(action => string.IsNullOrWhiteSpace(action.ActionTheme) || string.IsNullOrWhiteSpace(action.Title)
            || !action.OwnerStaffId.HasValue || !action.DueDate.HasValue))
            throw new WorkflowValidationException("Complete every draft action's theme, description, owner and implementation date before submitting.");
        if (drafts.Count == 0) return;
        await CreateSubmissionActionsAsync(connection, transaction, recordId, recordType,
            drafts.Select(action => new SubmitLinkedActionRequest(action.ActionTheme!.Trim(), action.Title!.Trim(),
                action.OwnerStaffId!.Value, action.DueDate!.Value, action.Detail)).ToArray(), currentUser, cancellationToken);
        await SaveDraftActionsAsync(connection, transaction, submissionId, [], cancellationToken);
    }
}
