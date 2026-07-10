namespace TLQS.Application.Staff;

public sealed record StaffImportRow(
    string ExternalId,
    string DisplayName,
    string Email,
    string? FirstName,
    string? LastName,
    string? JobTitle,
    string? LineManagerExternalId,
    string? PrimaryOrgCode,
    string? RoleKey,
    string AccountStatus);

public sealed record StaffImportIssue(int RowNumber, string Field, string Message, string Severity);

public sealed record StaffImportPreview(
    int RowsRead,
    int RowsValid,
    int RowsWithErrors,
    IReadOnlyList<StaffImportIssue> Issues);

