namespace TLQS.Api.V1;

public sealed record AdminRoomSummary(
    Guid Id,
    string RoomCode,
    string BuildingName,
    bool IsActive,
    int AssessmentCount,
    string RowVersion);

public sealed record SaveAdminRoomRequest(string? RoomCode, string? BuildingName, bool IsActive, string? RowVersion);
