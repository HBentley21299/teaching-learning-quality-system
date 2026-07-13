using TLQS.Domain.Common;

namespace TLQS.Domain.Forms;

public sealed class FormTemplate : AuditableEntity
{
    public Guid ModuleId { get; set; }
    public string TemplateKey { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public bool IsActive { get; set; } = true;
}

public sealed class FormTemplateVersion : AuditableEntity
{
    public Guid FormTemplateId { get; set; }
    public string VersionLabel { get; set; } = "1.0";
    public DateTimeOffset? ActiveFrom { get; set; }
    public DateTimeOffset? ActiveTo { get; set; }
    public bool IsPublished { get; set; }
    public Guid? CreatedByUserAccountId { get; set; }
}

public sealed class FormSection : AuditableEntity
{
    public Guid FormTemplateVersionId { get; set; }
    public string SectionKey { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public int DisplayOrder { get; set; }
}

public sealed class FormField : AuditableEntity
{
    public Guid FormSectionId { get; set; }
    public string FieldKey { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public string FieldType { get; set; } = string.Empty;
    public Guid? OptionsLookupTypeId { get; set; }
    public bool IsRequired { get; set; }
    public int DisplayOrder { get; set; }
    public string? HelpText { get; set; }
    public string? ValidationJson { get; set; }
    public string? ConfigurationJson { get; set; }
    public bool IsActive { get; set; } = true;
}

public sealed class FormSubmission : AuditableEntity
{
    public Guid RecordId { get; set; }
    public Guid FormTemplateVersionId { get; set; }
    public Guid? SubmittedByUserAccountId { get; set; }
    public DateTimeOffset? SubmittedAt { get; set; }
    public string Status { get; set; } = "draft";
}

public sealed class FormResponse : AuditableEntity
{
    public Guid FormSubmissionId { get; set; }
    public Guid FormFieldId { get; set; }
    public string? ResponseText { get; set; }
    public decimal? ResponseNumber { get; set; }
    public DateOnly? ResponseDate { get; set; }
    public Guid? ResponseLookupValueId { get; set; }
    public string? ResponseJson { get; set; }
}
