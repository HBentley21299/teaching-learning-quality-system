using TLQS.Domain.Common;

namespace TLQS.Domain.Curriculum;

public sealed class Course : AuditableEntity
{
    public string CourseCode { get; set; } = string.Empty;
    public string CourseName { get; set; } = string.Empty;
    public Guid OrgUnitId { get; set; }
    public string? AcademicYear { get; set; }
    public bool IsActive { get; set; } = true;
    public string? SourceSystem { get; set; }
}
