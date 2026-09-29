namespace TLQS.Application.Workflows;

public static class RoomCatalogueRules
{
    public static (string RoomCode, string BuildingName) Validate(string? roomCode, string? buildingName)
    {
        roomCode = roomCode?.Trim();
        buildingName = buildingName?.Trim();
        if (string.IsNullOrWhiteSpace(roomCode) || roomCode.Length > 50)
            throw new WorkflowValidationException("Enter a room code of no more than 50 characters.");
        if (string.IsNullOrWhiteSpace(buildingName) || buildingName.Length > 200)
            throw new WorkflowValidationException("Enter a building name of no more than 200 characters.");
        return (roomCode, buildingName);
    }

    public static byte[] ReadRowVersion(string? rowVersion)
    {
        if (!string.IsNullOrWhiteSpace(rowVersion))
        {
            try
            {
                var bytes = Convert.FromBase64String(rowVersion);
                if (bytes.Length == 8) return bytes;
            }
            catch (FormatException) { }
        }
        throw new WorkflowValidationException("Reload the room catalogue before saving this room.");
    }

    public static void EnsureUpdateSafe(byte[] expectedVersion, byte[] actualVersion, string originalCode, string newCode, int assessmentCount)
    {
        if (!expectedVersion.SequenceEqual(actualVersion))
            throw new RoomCatalogueConflictException("Another administrator changed this room. Cancel your edit, reload the catalogue and try again.");
        if (assessmentCount > 0 && !string.Equals(originalCode, newCode, StringComparison.Ordinal))
            throw new RoomCatalogueConflictException("This room is used by existing assessments, so its code cannot change. You can correct the building name or deactivate the room and add a new one.");
    }
}

public sealed class RoomCatalogueConflictException(string message) : Exception(message);
