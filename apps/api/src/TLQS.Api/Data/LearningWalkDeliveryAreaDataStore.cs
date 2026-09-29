using System.Data.Common;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    public Task<IReadOnlyList<LearningWalkDeliveryAreaOption>> GetLearningWalkDeliveryAreasAsync(
        string processKey, CancellationToken cancellationToken) => QueryAsync(
        """
        SELECT value.value_key, value.display_name,
               CONVERT(bit, CASE WHEN value.is_active = 1 AND value.archived_at IS NULL
                    AND type.is_active = 1 AND type.archived_at IS NULL THEN 1 ELSE 0 END)
        FROM core.lookup_types type
        JOIN core.lookup_values value ON value.lookup_type_id = type.id
        WHERE type.lookup_key = @lookupKey
        ORDER BY value.display_order, value.display_name;
        """,
        command => command.Parameters.AddWithValue("@lookupKey", LearningWalkDeliveryAreaRules.LookupKey(processKey)),
        reader => new LearningWalkDeliveryAreaOption(reader.GetString(0), reader.GetString(1), reader.GetBoolean(2)),
        cancellationToken);

    private sealed record LearningWalkDeliveryAreaSelection(Guid LookupId, string Key, string DisplayName);

    private static async Task<LearningWalkDeliveryAreaSelection?> ResolveLearningWalkDeliveryAreaAsync(
        SqlConnection connection, DbTransaction transaction, string recordType, string? requestedKey,
        Guid? submissionId, bool required, CancellationToken cancellationToken)
    {
        var key = requestedKey?.Trim();
        string? previousKey = null;
        string? previousDisplayName = null;
        if (submissionId.HasValue)
        {
            await using var previous = new SqlCommand(
                """
                SELECT response.response_text, JSON_VALUE(response.response_json, '$.displayName')
                FROM forms.form_responses response WITH (UPDLOCK, HOLDLOCK)
                JOIN forms.form_fields field ON field.id = response.form_field_id
                WHERE response.form_submission_id = @submissionId
                  AND field.field_key = 'learning_walk_delivery_area'
                  AND response.archived_at IS NULL;
                """, connection, (SqlTransaction)transaction);
            previous.Parameters.AddWithValue("@submissionId", submissionId.Value);
            await using var reader = await previous.ExecuteReaderAsync(cancellationToken);
            if (await reader.ReadAsync(cancellationToken))
            {
                previousKey = GetStringOrNull(reader, 0);
                previousDisplayName = GetStringOrNull(reader, 1);
            }
        }

        if (string.IsNullOrWhiteSpace(key))
        {
            LearningWalkDeliveryAreaRules.Validate(key, previousKey, false, required);
            return null;
        }

        await using var lookup = new SqlCommand(
            """
            SELECT value.id, value.value_key, value.display_name,
                   CONVERT(bit, CASE WHEN value.is_active = 1 AND value.archived_at IS NULL
                        AND type.is_active = 1 AND type.archived_at IS NULL THEN 1 ELSE 0 END)
            FROM core.lookup_values value WITH (HOLDLOCK)
            JOIN core.lookup_types type ON type.id = value.lookup_type_id
            WHERE type.lookup_key = @lookupKey AND value.value_key = @key;
            """, connection, (SqlTransaction)transaction);
        lookup.Parameters.AddWithValue("@lookupKey", LearningWalkDeliveryAreaRules.LookupKey(recordType));
        lookup.Parameters.AddWithValue("@key", key);
        await using var lookupReader = await lookup.ExecuteReaderAsync(cancellationToken);
        if (!await lookupReader.ReadAsync(cancellationToken))
            throw new WorkflowValidationException("Choose a Learning Walk delivery area from the list.");

        var canonicalKey = lookupReader.GetString(1);
        LearningWalkDeliveryAreaRules.Validate(canonicalKey, previousKey, lookupReader.GetBoolean(3), required);
        return new LearningWalkDeliveryAreaSelection(lookupReader.GetGuid(0), canonicalKey,
            canonicalKey == previousKey && !string.IsNullOrWhiteSpace(previousDisplayName)
                ? previousDisplayName : lookupReader.GetString(2));
    }

    private static async Task PersistLearningWalkDeliveryAreaAsync(
        SqlConnection connection, DbTransaction transaction, Guid submissionId,
        LearningWalkDeliveryAreaSelection? selection, CancellationToken cancellationToken)
    {
        if (selection is null) return;
        await using var command = new SqlCommand(
            """
            UPDATE response
            SET response_text = @key,
                response_lookup_value_id = @lookupId,
                response_json = @snapshot
            FROM forms.form_responses response
            JOIN forms.form_fields field ON field.id = response.form_field_id
            WHERE response.form_submission_id = @submissionId
              AND field.field_key = 'learning_walk_delivery_area'
              AND response.archived_at IS NULL;
            """, connection, (SqlTransaction)transaction);
        command.Parameters.AddWithValue("@submissionId", submissionId);
        command.Parameters.AddWithValue("@lookupId", selection.LookupId);
        command.Parameters.AddWithValue("@key", selection.Key);
        command.Parameters.AddWithValue("@snapshot", JsonSerializer.Serialize(new { displayName = selection.DisplayName }));
        await command.ExecuteNonQueryAsync(cancellationToken);
    }
}
