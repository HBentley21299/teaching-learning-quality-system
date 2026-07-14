namespace TLQS.Application.Organisation;

public static class OrganisationLeadershipRules
{
    public const string FacultyType = "faculty";
    public const string TeamType = "team";

    public static bool IsManagedUnitType(string? orgUnitType) =>
        string.Equals(orgUnitType, FacultyType, StringComparison.OrdinalIgnoreCase)
        || string.Equals(orgUnitType, TeamType, StringComparison.OrdinalIgnoreCase);

    public static string RoleKeyFor(string orgUnitType) => orgUnitType.ToLowerInvariant() switch
    {
        FacultyType => "head_of_faculty",
        TeamType => "programme_leader",
        _ => throw new ArgumentOutOfRangeException(nameof(orgUnitType), "Only faculties and teams can have an organisation manager.")
    };

    public static string RoleNameFor(string orgUnitType) => orgUnitType.ToLowerInvariant() switch
    {
        FacultyType => "Head of Faculty",
        TeamType => "Programme Leader",
        _ => throw new ArgumentOutOfRangeException(nameof(orgUnitType), "Only faculties and teams can have an organisation manager.")
    };
}
