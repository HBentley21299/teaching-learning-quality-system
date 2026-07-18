namespace TLQS.Application.Identity;

public static class StaffOnboardingRules
{
    public const string HeadOfFacultySectorManager = "head_of_faculty_sector_manager";
    public const string ProgrammeLeader = "programme_leader";
    public const string TutorTutorAssessor = "tutor_tutor_assessor";
    public const string Other = "other";

    public static readonly IReadOnlyList<StaffCategoryOption> Categories =
    [
        new(HeadOfFacultySectorManager, "Head of Faculty / Sector Manager", 10),
        new(ProgrammeLeader, "Programme Leader", 20),
        new(TutorTutorAssessor, "Tutor / Tutor Assessor", 30),
        new(Other, "Other", 40)
    ];

    public static string NormalizeCategory(string? category)
    {
        var normalized = category?.Trim().ToLowerInvariant();
        return Categories.Any(option => option.Key == normalized)
            ? normalized!
            : throw new ArgumentOutOfRangeException(nameof(category), "Select a valid staff category.");
    }

    public static string InitialRoleKeyFor(string category)
    {
        _ = NormalizeCategory(category);
        return "staff";
    }

    public static string? RequestedManagedUnitTypeFor(string category) => NormalizeCategory(category) switch
    {
        HeadOfFacultySectorManager => "faculty",
        ProgrammeLeader => "team",
        TutorTutorAssessor or Other => null,
        _ => null
    };
}

public sealed record StaffCategoryOption(string Key, string Name, int DisplayOrder);
