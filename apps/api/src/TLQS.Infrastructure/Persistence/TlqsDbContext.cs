using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using TLQS.Domain.CPD;
using TLQS.Domain.Core;
using TLQS.Domain.Curriculum;
using TLQS.Domain.Evidence;
using TLQS.Domain.Forms;
using TLQS.Domain.IdentityAccess;
using TLQS.Domain.Operations;
using TLQS.Domain.Organisation;
using TLQS.Domain.People;
using TLQS.Domain.Quality;
using TLQS.Domain.Reporting;

namespace TLQS.Infrastructure.Persistence;

public sealed class TlqsDbContext(DbContextOptions<TlqsDbContext> options) : DbContext(options)
{
    public DbSet<Staff> Staff => Set<Staff>();
    public DbSet<OrgUnit> OrgUnits => Set<OrgUnit>();
    public DbSet<StaffOrgMembership> StaffOrgMemberships => Set<StaffOrgMembership>();
    public DbSet<UserAccount> UserAccounts => Set<UserAccount>();
    public DbSet<AuthIdentity> AuthIdentities => Set<AuthIdentity>();
    public DbSet<Role> Roles => Set<Role>();
    public DbSet<Permission> Permissions => Set<Permission>();
    public DbSet<RolePermission> RolePermissions => Set<RolePermission>();
    public DbSet<UserRole> UserRoles => Set<UserRole>();
    public DbSet<AccessScope> AccessScopes => Set<AccessScope>();
    public DbSet<LookupType> LookupTypes => Set<LookupType>();
    public DbSet<LookupValue> LookupValues => Set<LookupValue>();
    public DbSet<ModuleDefinition> Modules => Set<ModuleDefinition>();
    public DbSet<QualityRecord> Records => Set<QualityRecord>();
    public DbSet<FormTemplate> FormTemplates => Set<FormTemplate>();
    public DbSet<FormTemplateVersion> FormTemplateVersions => Set<FormTemplateVersion>();
    public DbSet<FormSection> FormSections => Set<FormSection>();
    public DbSet<FormField> FormFields => Set<FormField>();
    public DbSet<FormSubmission> FormSubmissions => Set<FormSubmission>();
    public DbSet<FormResponse> FormResponses => Set<FormResponse>();
    public DbSet<Activity> Activities => Set<Activity>();
    public DbSet<LearningWalkDetail> LearningWalkDetails => Set<LearningWalkDetail>();
    public DbSet<WorkScrutinyDetail> WorkScrutinyDetails => Set<WorkScrutinyDetail>();
    public DbSet<WorkScrutinyCourseSample> WorkScrutinyCourseSamples => Set<WorkScrutinyCourseSample>();
    public DbSet<Course> Courses => Set<Course>();
    public DbSet<ActionItem> Actions => Set<ActionItem>();
    public DbSet<CpdEvent> CpdEvents => Set<CpdEvent>();
    public DbSet<CpdAttendance> CpdAttendance => Set<CpdAttendance>();
    public DbSet<EvidenceItem> EvidenceItems => Set<EvidenceItem>();
    public DbSet<FileAsset> FileAssets => Set<FileAsset>();
    public DbSet<FileAttachment> FileAttachments => Set<FileAttachment>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<Dashboard> Dashboards => Set<Dashboard>();
    public DbSet<SavedReportView> SavedReportViews => Set<SavedReportView>();
    public DbSet<StaffProfileSummaryReadModel> StaffProfileSummaries => Set<StaffProfileSummaryReadModel>();
    public DbSet<DashboardActivityOverviewReadModel> DashboardActivityOverview => Set<DashboardActivityOverviewReadModel>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Staff>().ToTable("staff", "people");
        modelBuilder.Entity<OrgUnit>().ToTable("org_units", "org");
        modelBuilder.Entity<StaffOrgMembership>().ToTable("staff_org_memberships", "org");
        modelBuilder.Entity<UserAccount>().ToTable("user_accounts", "auth");
        modelBuilder.Entity<AuthIdentity>().ToTable("auth_identities", "auth");
        modelBuilder.Entity<Role>().ToTable("roles", "auth");
        modelBuilder.Entity<Permission>().ToTable("permissions", "auth");
        modelBuilder.Entity<RolePermission>().ToTable("role_permissions", "auth");
        modelBuilder.Entity<UserRole>().ToTable("user_roles", "auth");
        modelBuilder.Entity<AccessScope>().ToTable("access_scopes", "auth");
        modelBuilder.Entity<LookupType>().ToTable("lookup_types", "core");
        modelBuilder.Entity<LookupValue>().ToTable("lookup_values", "core");
        modelBuilder.Entity<ModuleDefinition>().ToTable("modules", "core");
        modelBuilder.Entity<QualityRecord>().ToTable("records", "core");
        modelBuilder.Entity<FormTemplate>().ToTable("form_templates", "forms");
        modelBuilder.Entity<FormTemplateVersion>().ToTable("form_template_versions", "forms");
        modelBuilder.Entity<FormSection>().ToTable("form_sections", "forms");
        modelBuilder.Entity<FormField>().ToTable("form_fields", "forms");
        modelBuilder.Entity<FormSubmission>().ToTable("form_submissions", "forms");
        modelBuilder.Entity<FormResponse>().ToTable("form_responses", "forms");
        modelBuilder.Entity<Activity>().ToTable("activities", "quality");
        modelBuilder.Entity<LearningWalkDetail>().ToTable("learning_walk_details", "quality");
        modelBuilder.Entity<WorkScrutinyDetail>().ToTable("work_scrutiny_details", "quality");
        modelBuilder.Entity<WorkScrutinyCourseSample>().ToTable("work_scrutiny_course_samples", "quality");
        modelBuilder.Entity<Course>().ToTable("courses", "curriculum");
        modelBuilder.Entity<ActionItem>().ToTable("actions", "quality");
        modelBuilder.Entity<CpdEvent>().ToTable("cpd_events", "cpd");
        modelBuilder.Entity<CpdAttendance>().ToTable("cpd_attendance", "cpd");
        modelBuilder.Entity<EvidenceItem>().ToTable("evidence_items", "evidence");
        modelBuilder.Entity<FileAsset>().ToTable("file_assets", "evidence");
        modelBuilder.Entity<FileAttachment>().ToTable("file_attachments", "evidence");
        modelBuilder.Entity<AuditLog>().ToTable("audit_logs", "ops");
        modelBuilder.Entity<Notification>().ToTable("notifications", "ops");
        modelBuilder.Entity<Dashboard>().ToTable("dashboards", "reporting");
        modelBuilder.Entity<SavedReportView>().ToTable("saved_report_views", "reporting");

        modelBuilder.Entity<RolePermission>().HasKey(x => x.Id);
        modelBuilder.Entity<UserRole>().HasKey(x => x.Id);
        modelBuilder.Entity<LearningWalkDetail>().HasKey(x => x.ActivityId);
        modelBuilder.Entity<WorkScrutinyDetail>().HasKey(x => x.ActivityId);
        modelBuilder.Entity<WorkScrutinyCourseSample>().HasKey(x => new { x.RecordId, x.CourseId });
        modelBuilder.Entity<FileAsset>().HasKey(x => x.Id);
        modelBuilder.Entity<FileAttachment>().HasKey(x => x.Id);
        modelBuilder.Entity<AuditLog>().HasKey(x => x.Id);
        modelBuilder.Entity<Notification>().HasKey(x => x.Id);

        modelBuilder.Entity<Staff>().HasIndex(x => x.ExternalId).IsUnique();
        modelBuilder.Entity<Staff>().HasIndex(x => x.Email).IsUnique();
        modelBuilder.Entity<OrgUnit>().HasIndex(x => x.Code).IsUnique();
        modelBuilder.Entity<UserAccount>().HasIndex(x => x.StaffId).IsUnique();
        modelBuilder.Entity<Role>().HasIndex(x => x.RoleKey).IsUnique();
        modelBuilder.Entity<Permission>().HasIndex(x => x.PermissionKey).IsUnique();
        modelBuilder.Entity<LookupType>().HasIndex(x => x.LookupKey).IsUnique();
        modelBuilder.Entity<ModuleDefinition>().HasIndex(x => x.ModuleKey).IsUnique();
        modelBuilder.Entity<Dashboard>().HasIndex(x => x.DashboardKey).IsUnique();

        modelBuilder.Entity<StaffProfileSummaryReadModel>(entity =>
        {
            entity.HasNoKey();
            entity.ToView("v_staff_profile_summary", "reporting");
        });

        modelBuilder.Entity<DashboardActivityOverviewReadModel>(entity =>
        {
            entity.HasNoKey();
            entity.ToView("v_dashboard_activity_overview", "reporting");
        });

        ApplyConventions(modelBuilder);
    }

    private static void ApplyConventions(ModelBuilder modelBuilder)
    {
        foreach (var entity in modelBuilder.Model.GetEntityTypes())
        {
            foreach (var property in entity.GetProperties())
            {
                property.SetColumnName(ToSnakeCase(property.Name));
                if (property.Name == "RowVersion")
                {
                    property.ValueGenerated = ValueGenerated.OnAddOrUpdate;
                    property.SetIsConcurrencyToken(true);
                }
            }
        }
    }

    private static string ToSnakeCase(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return value;
        }

        var chars = new List<char>(value.Length + 8);
        for (var i = 0; i < value.Length; i++)
        {
            var current = value[i];
            if (char.IsUpper(current) && i > 0 && value[i - 1] != '_')
            {
                chars.Add('_');
            }

            chars.Add(char.ToLowerInvariant(current));
        }

        return new string(chars.ToArray());
    }
}

public sealed class StaffProfileSummaryReadModel
{
    public Guid StaffId { get; set; }
    public string ExternalId { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string? JobTitle { get; set; }
    public string? PrimaryOrgCode { get; set; }
    public string? PrimaryOrgName { get; set; }
    public int CpdSessionsAttended { get; set; }
    public int EvidenceRecords { get; set; }
    public int OpenActions { get; set; }
    public int OverdueActions { get; set; }
}

public sealed class DashboardActivityOverviewReadModel
{
    public string ModuleKey { get; set; } = string.Empty;
    public string ModuleName { get; set; } = string.Empty;
    public string RecordType { get; set; } = string.Empty;
    public Guid? OrgUnitId { get; set; }
    public string? OrgUnitCode { get; set; }
    public string? OrgUnitName { get; set; }
    public long RecordCount { get; set; }
    public DateOnly? FirstRecordDate { get; set; }
    public DateOnly? LatestRecordDate { get; set; }
}
