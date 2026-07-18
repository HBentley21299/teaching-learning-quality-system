namespace TLQS.Api.V1;

public sealed record StaffOnboardingCategorySummary(string Key, string Name, int DisplayOrder);

public sealed record StaffOnboardingOptionsSummary(
    IReadOnlyList<OrgUnitSummary> Faculties,
    IReadOnlyList<OrgUnitSummary> Teams,
    IReadOnlyList<StaffOnboardingCategorySummary> Categories);

public sealed record CompleteStaffOnboardingRequest(
    Guid FacultyOrgUnitId,
    Guid TeamOrgUnitId,
    string StaffCategory);

