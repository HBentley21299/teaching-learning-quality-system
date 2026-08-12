namespace TLQS.Api.V1;

public sealed record ElevatePracticeWorkspaceSummary(
    string AcademicYear,
    Guid? AssessmentId,
    Guid? RecordId,
    string Status,
    DateTimeOffset? SubmittedAt,
    Guid StaffId,
    string StaffName,
    string? FacultyName,
    string? TeamName,
    bool CanEdit,
    string? OverallJudgement,
    IReadOnlyList<ElevatePracticeRatingScaleSummary> RatingScale,
    IReadOnlyList<ElevatePracticeSupportOptionSummary> SupportOptions,
    IReadOnlyList<ElevatePracticeAreaSummary> Areas,
    IReadOnlyList<string> StrengthAreaKeys,
    IReadOnlyList<string> DevelopmentAreaKeys,
    IReadOnlyList<string> SuggestedStrengthAreaKeys,
    IReadOnlyList<string> SuggestedDevelopmentAreaKeys,
    IReadOnlyList<ElevatePracticePlanSummary> DevelopmentPlans,
    ElevateLivInformationSummary LivInformation);

public sealed record ElevatePracticeRatingScaleSummary(
    Guid Id,
    string DescriptorKey,
    string Descriptor,
    string Meaning,
    int DisplayOrder,
    string? ColourClassification,
    string? ColorHex,
    bool IsActive);
public sealed record ElevatePracticeSupportOptionSummary(string Key, string Name);
public sealed record ElevatePracticeAreaSummary(
    Guid Id,
    string AreaKey,
    string Category,
    string Name,
    string ReflectionPrompt,
    int DisplayOrder,
    Guid? DescriptorId,
    string? Judgement,
    string? Reflection,
    IReadOnlyList<ElevatePracticeStatementSummary> Statements);
public sealed record ElevatePracticeStatementSummary(Guid Id, string StatementKey, string Text, int DisplayOrder, Guid? DescriptorId);
public sealed record ElevatePracticePlanSummary(
    string AreaKey,
    string DevelopmentApproach,
    IReadOnlyList<string> SupportKeys,
    string SupportDetails,
    string SuccessEvidence,
    string IntendedImpact,
    Guid? ActionId);

public sealed record SaveElevatePracticeAssessmentRequest(
    IReadOnlyList<ElevatePracticeRatingRequest>? Ratings,
    IReadOnlyList<ElevatePracticeReflectionRequest>? Reflections,
    SaveElevateLivInformationRequest? LivInformation,
    bool Submit = false,
    IReadOnlyList<string>? StrengthAreaKeys = null,
    IReadOnlyList<string>? DevelopmentAreaKeys = null,
    IReadOnlyList<ElevatePracticePlanRequest>? DevelopmentPlans = null);
public sealed record ElevatePracticeRatingRequest(Guid AreaId, Guid DescriptorId, Guid StatementId);
public sealed record ElevatePracticeReflectionRequest(string AreaKey, string? Text);
public sealed record ElevatePracticePlanRequest(
    string AreaKey,
    string? DevelopmentApproach,
    IReadOnlyList<string>? SupportKeys,
    string? SupportDetails,
    string? SuccessEvidence,
    string? IntendedImpact);

public sealed record ElevatePracticeProgressSummary(
    Guid? AssessmentId,
    Guid? RecordId,
    Guid StaffId,
    string ExternalId,
    string StaffName,
    string Email,
    string? FacultyCode,
    string? FacultyName,
    string? TeamCode,
    string? TeamName,
    string AcademicYear,
    string Status,
    DateTimeOffset? UpdatedAt,
    DateTimeOffset? SubmittedAt);

public sealed record AdminSaveElevatePracticeAssessmentRequest(
    IReadOnlyList<ElevatePracticeRatingRequest>? Ratings,
    IReadOnlyList<ElevatePracticeReflectionRequest>? Reflections,
    SaveElevateLivInformationRequest? LivInformation,
    string Status,
    IReadOnlyList<string>? StrengthAreaKeys = null,
    IReadOnlyList<string>? DevelopmentAreaKeys = null,
    IReadOnlyList<ElevatePracticePlanRequest>? DevelopmentPlans = null);

public sealed record ElevateLookupOptionSummary(string Key, string Name, int DisplayOrder, bool IsOther = false);

public sealed record ElevateLivInformationSummary(
    string? PreferredVisitMonth,
    string? PrimaryFocusKey,
    string? SecondaryFocusKey,
    string? SecondaryFocusOther,
    string? DesiredOutcome,
    IReadOnlyList<ElevateLookupOptionSummary> FocusOptions);

public sealed record SaveElevateLivInformationRequest(
    string? PreferredVisitMonth,
    string? PrimaryFocusKey,
    string? SecondaryFocusKey,
    string? SecondaryFocusOther,
    string? DesiredOutcome);

public sealed record ElevatePracticeAuditSummary(
    Guid Id,
    string Action,
    string? Summary,
    string ActorName,
    string? BeforeJson,
    string? AfterJson,
    DateTimeOffset CreatedAt);

public sealed record StaffElevatePracticeSummary(
    Guid AssessmentId,
    Guid RecordId,
    string AcademicYear,
    string Status,
    string? Judgement,
    DateTimeOffset? SubmittedAt,
    IReadOnlyList<StaffElevateFocusAreaSummary> FocusAreas);

public sealed record StaffElevateFocusAreaSummary(
    string FocusKey,
    string FocusName,
    string FocusType,
    int DisplayOrder);
