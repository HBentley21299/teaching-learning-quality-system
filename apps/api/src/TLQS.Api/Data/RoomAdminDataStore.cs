using System.Data;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    public Task<IReadOnlyList<AdminRoomSummary>> GetAdminRoomsAsync(CancellationToken cancellationToken) =>
        QueryAsync(
            """
            SELECT room.id, room.room_code, room.building_name,
                   CAST(CASE WHEN room.is_active = 1 AND room.archived_at IS NULL THEN 1 ELSE 0 END AS bit),
                   (SELECT COUNT(*) FROM core.records record
                    WHERE EXISTS (SELECT 1 FROM quality.elevate_environment_assessments assessment WHERE assessment.record_id = record.id AND assessment.room_id = room.id)
                       OR (record.record_type = N'elevate_environment' AND EXISTS (
                           SELECT 1 FROM forms.form_submissions submission
                           JOIN forms.form_responses response ON response.form_submission_id = submission.id
                           JOIN forms.form_fields field ON field.id = response.form_field_id
                           WHERE submission.record_id = record.id AND field.field_key = N'room_code' AND response.response_text = room.room_code))),
                   room.row_version
            FROM quality.rooms room
            ORDER BY room.room_code;
            """,
            ReadAdminRoom,
            cancellationToken);

    public async Task<AdminRoomSummary?> SaveAdminRoomAsync(
        Guid? id,
        SaveAdminRoomRequest request,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        var (roomCode, buildingName) = RoomCatalogueRules.Validate(request.RoomCode, request.BuildingName);
        var expectedVersion = id.HasValue ? RoomCatalogueRules.ReadRowVersion(request.RowVersion) : null;
        var roomId = id ?? Guid.NewGuid();
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            AdminRoomSummary? before = null;
            if (id.HasValue)
            {
                await using var read = new SqlCommand(
                    """
                    SELECT room.id, room.room_code, room.building_name,
                           CAST(CASE WHEN room.is_active = 1 AND room.archived_at IS NULL THEN 1 ELSE 0 END AS bit),
                           (SELECT COUNT(*) FROM core.records record
                            WHERE EXISTS (SELECT 1 FROM quality.elevate_environment_assessments assessment WITH (HOLDLOCK) WHERE assessment.record_id = record.id AND assessment.room_id = room.id)
                               OR (record.record_type = N'elevate_environment' AND EXISTS (
                                   SELECT 1 FROM forms.form_submissions submission
                                   JOIN forms.form_responses response WITH (HOLDLOCK) ON response.form_submission_id = submission.id
                                   JOIN forms.form_fields field ON field.id = response.form_field_id
                                   WHERE submission.record_id = record.id AND field.field_key = N'room_code' AND response.response_text = room.room_code))),
                           room.row_version
                    FROM quality.rooms room WITH (UPDLOCK, HOLDLOCK)
                    WHERE room.id = @id;
                    """, connection, transaction);
                read.Parameters.AddWithValue("@id", roomId);
                await using (var reader = await read.ExecuteReaderAsync(cancellationToken))
                {
                    if (await reader.ReadAsync(cancellationToken)) before = ReadAdminRoom(reader);
                }
                if (before is null)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    return null;
                }
                RoomCatalogueRules.EnsureUpdateSafe(expectedVersion!, Convert.FromBase64String(before.RowVersion), before.RoomCode, roomCode, before.AssessmentCount);
            }

            await using var command = new SqlCommand(id.HasValue
                ? """
                  UPDATE quality.rooms
                  SET room_code = @roomCode, building_name = @buildingName,
                      is_active = @isActive,
                      archived_at = CASE WHEN @isActive = 1 THEN NULL ELSE archived_at END,
                      updated_at = sysutcdatetime()
                  OUTPUT inserted.row_version
                  WHERE id = @id;
                  """
                : """
                  INSERT INTO quality.rooms (id, room_code, building_name, is_active)
                  OUTPUT inserted.row_version
                  VALUES (@id, @roomCode, @buildingName, @isActive);
                  """, connection, transaction);
            command.Parameters.AddWithValue("@id", roomId);
            command.Parameters.Add("@roomCode", SqlDbType.NVarChar, 50).Value = roomCode;
            command.Parameters.Add("@buildingName", SqlDbType.NVarChar, 200).Value = buildingName;
            command.Parameters.AddWithValue("@isActive", request.IsActive);
            var rowVersion = (byte[])(await command.ExecuteScalarAsync(cancellationToken))!;
            var saved = new AdminRoomSummary(roomId, roomCode, buildingName, request.IsActive, before?.AssessmentCount ?? 0, Convert.ToBase64String(rowVersion));
            await WriteAuditWithReasonAsync(
                connection, transaction, currentUser.UserAccountId, null,
                "room", roomId, id.HasValue ? "room.updated" : "room.created",
                $"Room {roomCode} {(id.HasValue ? "updated" : "created")} by {currentUser.DisplayName}.",
                before is null ? null : JsonSerializer.Serialize(before), JsonSerializer.Serialize(saved), null, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return saved;
        }
        catch (SqlException exception) when (exception.Number is 2601 or 2627)
        {
            await transaction.RollbackAsync(cancellationToken);
            throw new RoomCatalogueConflictException("That room code already exists. Search all rooms, including inactive rooms, to edit or reactivate it.");
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    private static AdminRoomSummary ReadAdminRoom(SqlDataReader reader) => new(
        reader.GetGuid(0), reader.GetString(1), reader.GetString(2), reader.GetBoolean(3), reader.GetInt32(4),
        Convert.ToBase64String(reader.GetFieldValue<byte[]>(5)));
}
