using TLQS.Domain.Common;

namespace TLQS.Domain.People;

public sealed class Staff : AuditableEntity
{
    public string ExternalId { get; set; } = string.Empty;
    public string? FirstName { get; set; }
    public string? LastName { get; set; }
    public string DisplayName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string? JobTitle { get; set; }
    public Guid? LineManagerStaffId { get; set; }
    public Guid? PrimaryOrgUnitId { get; set; }
    public string AccountStatus { get; set; } = "active";
    public string? StaffCategory { get; set; }
    public string OnboardingSource { get; set; } = "manual";
    public DateTimeOffset? OnboardedAt { get; set; }
    public DateOnly? StartDate { get; set; }
    public DateOnly? EndDate { get; set; }
    public string? Notes { get; set; }
}

