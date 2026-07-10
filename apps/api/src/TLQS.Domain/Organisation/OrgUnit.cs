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
    public bool IsPrimary { get; set; }
    public DateOnly? ActiveFrom { get; set; }
    public DateOnly? ActiveTo { get; set; }
}

