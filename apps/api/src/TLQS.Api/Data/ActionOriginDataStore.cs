using Microsoft.Data.SqlClient;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    private sealed record ActionRecordOrigin(string RecordType, Guid? SubjectStaffId);

    private static async Task<ActionRecordOrigin> ReadActionRecordOriginAsync(SqlConnection connection, SqlTransaction? transaction,
        Guid sourceRecordId, CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(transaction is null
            ? "SELECT record_type, subject_staff_id FROM core.records WHERE id=@id AND archived_at IS NULL;"
            : "SELECT record_type, subject_staff_id FROM core.records WITH(UPDLOCK,HOLDLOCK) WHERE id=@id AND archived_at IS NULL;",
            connection, transaction);
        command.Parameters.AddWithValue("@id", sourceRecordId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
            throw new WorkflowValidationException("The originating form or review was not found or is archived.");
        return new(reader.GetString(0), GetGuidOrNull(reader, 1));
    }
}
