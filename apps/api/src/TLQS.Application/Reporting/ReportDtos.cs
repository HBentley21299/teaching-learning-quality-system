namespace TLQS.Application.Reporting;

public sealed record DashboardSummaryDto(
    string DashboardKey,
    string Name,
    string? Purpose,
    string RequiredPermission,
    bool FacultyScopeRequired);

public sealed record StaffProfileSummaryDto(
    Guid StaffId,
    string ExternalId,
    string DisplayName,
    string Email,
    string? JobTitle,
    string? PrimaryOrgCode,
    int CpdSessionsAttended,
    int EvidenceRecords,
    int OpenActions,
    int OverdueActions);

