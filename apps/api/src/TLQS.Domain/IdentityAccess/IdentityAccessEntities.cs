using TLQS.Domain.Common;

namespace TLQS.Domain.IdentityAccess;

public sealed class UserAccount : AuditableEntity
{
    public Guid StaffId { get; set; }
    public string AccountStatus { get; set; } = "active";
    public bool IsDisabled { get; set; }
    public DateTimeOffset? LastLoginAt { get; set; }
}

public sealed class AuthIdentity : AuditableEntity
{
    public Guid UserAccountId { get; set; }
    public string Provider { get; set; } = "entra";
    public Guid TenantId { get; set; }
    public string ProviderSubjectId { get; set; } = string.Empty;
    public string EmailClaim { get; set; } = string.Empty;
}

public sealed class Role : AuditableEntity
{
    public string RoleKey { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public bool IsSystem { get; set; }
    public bool IsActive { get; set; } = true;
}

public sealed class Permission : AuditableEntity
{
    public string PermissionKey { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string Category { get; set; } = string.Empty;
    public bool IsSystem { get; set; } = true;
}

public sealed class RolePermission
{
    public Guid Id { get; set; }
    public Guid RoleId { get; set; }
    public Guid PermissionId { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class UserRole
{
    public Guid Id { get; set; }
    public Guid UserAccountId { get; set; }
    public Guid RoleId { get; set; }
    public DateTimeOffset ActiveFrom { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? ActiveTo { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class AccessScope : AuditableEntity
{
    public Guid UserAccountId { get; set; }
    public string ScopeType { get; set; } = "self";
    public Guid? OrgUnitId { get; set; }
    public Guid? StaffId { get; set; }
    public bool IsActive { get; set; } = true;
}

