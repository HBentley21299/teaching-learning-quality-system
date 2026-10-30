namespace TLQS.Api.V1;

public sealed record FormTemplateAdministration(
    Guid TemplateId, string TemplateKey, string ModuleKey, string Name, string? Description,
    Guid VersionId, string Version, string RowVersion, string Status, int SubmissionCount,
    IReadOnlyList<AdminFormSection> Sections, IReadOnlyList<AdminFormVersion> Versions);
public sealed record AdminFormVersion(Guid Id, string Version, string Status, int SubmissionCount, DateTimeOffset CreatedAt);
public sealed record AdminFormSection(Guid Id, string SectionKey, string Title, int DisplayOrder, IReadOnlyList<AdminFormField> Fields);
public sealed record AdminFormField(Guid Id, string FieldKey, string Label, string FieldType, bool IsRequired,
    int DisplayOrder, string? HelpText, IReadOnlyList<string> Options, bool IsProtected);
public sealed record CreateFormVersionDraftRequest(Guid SourceVersionId);
public sealed record FormVersionCommandRequest(string RowVersion);
public sealed record SaveFormVersionRequest(string Name, string? Description, string RowVersion,
    IReadOnlyList<FormStructureSectionRequest> Sections);
