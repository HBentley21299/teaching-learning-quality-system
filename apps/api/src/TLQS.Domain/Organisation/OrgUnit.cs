using TLQS.Domain.Common;

namespace TLQS.Domain.Organisation;

public sealed class OrgUnit : AuditableEntity
{
    public Guid? ParentOrgUnitId { get; set; }
    public string OrgUnitType { get; set; } = "faculty";
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public bool IsActive { get; set; } = true;
}

public sealed class StaffOrgMembership : AuditableEntity
{
    public Guid StaffId { get; set; }
    public Guid OrgUnitId { get; set; }
    public string MembershipType { get; set; } = "member";
    public string AssignmentSource { get; set; } = "manual";
    public bool IsPrimary { get; set; }
    public DateOnly? ActiveFrom { get; set; }
    public DateOnly? ActiveTo { get; set; }
}

public sealed class OrgUnitLeadership : AuditableEntity
{
    public Guid OrgUnitId { get; set; }
    public Guid LeaderStaffId { get; set; }
    public string LeadershipRole { get; set; } = "manager";
    public DateOnly ActiveFrom { get; set; } = DateOnly.FromDateTime(DateTime.UtcNow);
    public DateOnly? ActiveTo { get; set; }
    public Guid? CreatedByUserAccountId { get; set; }
    public Guid? UpdatedByUserAccountId { get; set; }
}

