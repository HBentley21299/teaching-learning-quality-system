using TLQS.Domain.Common;

namespace TLQS.Domain.Reporting;

public sealed class Dashboard : AuditableEntity
{
    public string DashboardKey { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Purpose { get; set; }
    public string PrimaryPermissionKey { get; set; } = string.Empty;
    public bool FacultyScopeRequired { get; set; }
    public string? ConfigJson { get; set; }
    public bool IsActive { get; set; } = true;
}

public sealed class SavedReportView : AuditableEntity
{
    public Guid DashboardId { get; set; }
    public Guid OwnerUserAccountId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string FiltersJson { get; set; } = "{}";
    public bool IsShared { get; set; }
}

