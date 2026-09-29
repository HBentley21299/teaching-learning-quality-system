using System.Data;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    public async Task<QaOutcomeLabelsState> GetQaOutcomeLabelsAsync(CancellationToken token)
    {
        await using var connection = await OpenConnectionAsync(token);
        await using var exists = new SqlCommand("SELECT OBJECT_ID(N'qa.outcome_labels', N'U');", connection);
        if (await exists.ExecuteScalarAsync(token) is null or DBNull)
            return new(QaOutcomeLabels.Default, null, false);
        await using var command = new SqlCommand("SELECT below_label, at_label, above_label, not_applicable_label, row_version FROM qa.outcome_labels WHERE id = 1;", connection);
        await using var reader = await command.ExecuteReaderAsync(token);
        if (!await reader.ReadAsync(token)) return new(QaOutcomeLabels.Default, null, false);
        return new(new(reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetString(3)), reader.GetFieldValue<byte[]>(4), true);
    }

    public async Task<QaOutcomeLabelsState> SaveQaOutcomeLabelsAsync(SaveQaOutcomeLabelsRequest request, CurrentUser user, CancellationToken token)
    {
        var labels = QaOutcomeLabels.Validate(request.Below, request.At, request.Above, request.NotApplicable);
        if (request.RowVersion is not { Length: 8 }) throw new WorkflowValidationException("Reload the outcome wording before saving.");
        var previous = await GetQaOutcomeLabelsAsync(token);
        if (!previous.IsAvailable) throw new WorkflowValidationException("Outcome wording is unavailable until database migration 075 has been applied.");
        await using var connection = await OpenConnectionAsync(token);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(token);
        await using var command = new SqlCommand("""
            UPDATE qa.outcome_labels SET below_label = @below, at_label = @at,
                above_label = @above, not_applicable_label = @na
            WHERE id = 1 AND row_version = @version;
            """, connection, transaction);
        command.Parameters.Add("@below", SqlDbType.NVarChar, 40).Value = labels.Below;
        command.Parameters.Add("@at", SqlDbType.NVarChar, 40).Value = labels.At;
        command.Parameters.Add("@above", SqlDbType.NVarChar, 40).Value = labels.Above;
        command.Parameters.Add("@na", SqlDbType.NVarChar, 40).Value = labels.NotApplicable;
        command.Parameters.Add("@version", SqlDbType.Timestamp, 8).Value = request.RowVersion;
        if (await command.ExecuteNonQueryAsync(token) != 1)
            throw new DBConcurrencyException("Outcome wording was changed by another administrator. Reload before saving.");
        await WriteAuditAsync(connection, transaction, user.UserAccountId, null, "qa_outcome_labels",
            Guid.Parse("00000000-0000-0000-0000-000000000075"), "updated",
            "Updated shared QA outcome display wording; saved outcomes and calculations are unchanged.",
            JsonSerializer.Serialize(previous.Labels), JsonSerializer.Serialize(labels), token);
        await transaction.CommitAsync(token);
        return await GetQaOutcomeLabelsAsync(token);
    }
}
