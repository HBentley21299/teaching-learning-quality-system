namespace TLQS.Api.V1;

public sealed record AdminOrganisationStaffSummary(
    Guid StaffId,
    string ExternalId,
    string DisplayName,
    string Email,
    string AccountStatus,
    string EffectivePermissionLevel,
    IReadOnlyList<string> RoleNames,
    IReadOnlyList<AdminOrganisationMembershipSummary> Memberships,
    IReadOnlyList<AdminManagerRelationshipSummary> DirectManagers,
    IReadOnlyList<AdminReportingLineSummary> ReportingLine);

public sealed record AdminOrganisationMembershipSummary(
    Guid Id,
    Guid OrgUnitId,
    Guid? ParentOrgUnitId,
    string OrgUnitType,
    string Code,
    string Name,
    string? ParentCode,
    string? ParentName,
    string MembershipType,
    bool IsPrimary,
    DateOnly? ActiveFrom,
    DateOnly? ActiveTo,
    bool IsActive);

public sealed record AdminManagerRelationshipSummary(
    Guid Id,
    Guid ManagerStaffId,
    string ManagerName,
    string RelationshipType,
    bool IsPrimary,
    DateOnly? ActiveFrom,
    DateOnly? ActiveTo,
    bool IsActive);

public sealed record AdminReportingLineSummary(
    Guid ManagerStaffId,
    string ManagerName,
    int Level,
    string EffectivePermissionLevel);

public sealed record SaveOrganisationMembershipRequest(
    Guid OrgUnitId,
    string MembershipType,
    bool IsPrimary,
    DateOnly? ActiveFrom,
    DateOnly? ActiveTo);

public sealed record SaveManagerRelationshipRequest(
    Guid ManagerStaffId,
    string RelationshipType,
    bool IsPrimary,
    DateOnly? ActiveFrom,
    DateOnly? ActiveTo);

public sealed record AdminOrganisationStructureSummary(
    IReadOnlyList<AdminOrganisationUnitSummary> Units,
    IReadOnlyList<AdminOrganisationStaffOption> Staff);

public sealed record AdminOrganisationUnitSummary(
    Guid Id,
    Guid? ParentOrgUnitId,
    string OrgUnitType,
    string Code,
    string Name,
    int DirectStaffCount,
    int TotalStaffCount,
    int ChildTeamCount,
    int ManagedTeamCount,
    AdminOrganisationManagerSummary? Manager,
    AdminOrganisationManagerSummary? ParentManager);

public sealed record AdminOrganisationManagerSummary(
    Guid AssignmentId,
    Guid StaffId,
    string ExternalId,
    string DisplayName,
    string Email,
    string PermissionLevel,
    DateOnly ActiveFrom);

public sealed record AdminOrganisationStaffOption(
    Guid StaffId,
    string ExternalId,
    string DisplayName,
    string Email,
    string EffectivePermissionLevel,
    string? PrimaryOrgCode);

public sealed record SaveOrgUnitManagerRequest(Guid ManagerStaffId, string? Reason);

public sealed record ArchiveReasonRequest(string Reason);

public sealed record AdminManagedListSummary(
    string LookupKey,
    string Name,
    string Category,
    string? Description,
    int DisplayOrder,
    IReadOnlyList<string> UsedIn,
    IReadOnlyList<AdminManagedListValueSummary> Values);

public sealed record AdminManagedListValueSummary(
    Guid Id,
    string ValueKey,
    string DisplayName,
    int DisplayOrder,
    bool IsActive,
    DateTimeOffset CreatedAt,
    DateTimeOffset? UpdatedAt);

public sealed record UpdateManagedListValueRequest(string DisplayName);
public sealed record SetManagedListValueStatusRequest(bool IsActive);
public sealed record ReorderManagedListValuesRequest(IReadOnlyList<Guid> ValueIds);

public sealed record AdminRecordSummary(
    Guid RecordId,
    string ModuleKey,
    string ModuleName,
    string RecordType,
    string Title,
    string? SubjectStaffName,
    Guid? SubjectStaffId,
    string? OwnerStaffName,
    string? FacultyCode,
    string? FacultyName,
    string? TeamCode,
    string? TeamName,
    string Status,
    DateOnly? RecordDate,
    DateTimeOffset CreatedAt,
    DateTimeOffset? UpdatedAt,
    DateTimeOffset? ArchivedAt,
    string? DeletedByName,
    string? DeletionReason);

public sealed record SharedThemeSummary(
    Guid Id,
    Guid ThemeGroupId,
    string ThemeKey,
    string Name,
    string? Description,
    string? AssetKey,
    int DisplayOrder,
    bool IsOther,
    bool IsActive);

public sealed record SharedThemeGroupSummary(
    Guid Id,
    string GroupKey,
    string Name,
    string? Description,
    int DisplayOrder,
    bool IsActive,
    IReadOnlyList<SharedThemeSummary> Themes);
