using TLQS.Domain.Common;

namespace TLQS.Domain.Core;

public sealed class LookupType : AuditableEntity
{
    public string LookupKey { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public bool IsSystem { get; set; }
    public bool IsActive { get; set; } = true;
}

public sealed class LookupValue : AuditableEntity
{
    public Guid LookupTypeId { get; set; }
    public string ValueKey { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public int DisplayOrder { get; set; }
    public string? ColorHex { get; set; }
    public bool IsActive { get; set; } = true;
    public string? Notes { get; set; }
}

public sealed class ModuleDefinition : AuditableEntity
{
    public string ModuleKey { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string RoutePrefix { get; set; } = string.Empty;
    public int DisplayOrder { get; set; }
    public bool IsEnabled { get; set; } = true;
}

public sealed class QualityRecord : AuditableEntity
{
    public Guid ModuleId { get; set; }
    public string RecordType { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string? Summary { get; set; }
    public Guid? StatusLookupValueId { get; set; }
    public Guid? SubjectStaffId { get; set; }
    public Guid? OwnerStaffId { get; set; }
    public Guid? OrgUnitId { get; set; }
    public DateOnly? RecordDate { get; set; }
    public Guid? CreatedByUserAccountId { get; set; }
    public Guid? UpdatedByUserAccountId { get; set; }
}

