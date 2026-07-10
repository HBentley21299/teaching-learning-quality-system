using TLQS.Domain.Common;

namespace TLQS.Domain.CPD;

public sealed class CpdEvent : AuditableEntity
{
    public Guid RecordId { get; set; }
    public string EventTitle { get; set; } = string.Empty;
    public DateOnly EventDate { get; set; }
    public TimeOnly? StartTime { get; set; }
    public TimeOnly? EndTime { get; set; }
    public Guid? ThemeLookupValueId { get; set; }
    public string? DeliveryMethod { get; set; }
    public Guid? FacilitatorStaffId { get; set; }
    public string? Location { get; set; }
    public string? TargetAudience { get; set; }
    public int? Capacity { get; set; }
    public string? Notes { get; set; }
}

public sealed class CpdAttendance : AuditableEntity
{
    public Guid CpdEventId { get; set; }
    public Guid StaffId { get; set; }
    public Guid? OrgUnitIdAtTime { get; set; }
    public string AttendanceStatus { get; set; } = "Attended";
    public int MilestoneCredit { get; set; } = 1;
    public bool EvidenceRequired { get; set; }
}

