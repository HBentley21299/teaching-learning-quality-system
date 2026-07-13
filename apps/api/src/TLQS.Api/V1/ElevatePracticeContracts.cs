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
    IReadOnlyList<ElevatePracticeRatingScaleSummary> RatingScale,
    IReadOnlyList<ElevatePracticeSupportOptionSummary> SupportOptions,
    IReadOnlyList<ElevatePracticeAreaSummary> Areas,
    IReadOnlyList<string> StrengthAreaKeys,
    IReadOnlyList<string> DevelopmentAreaKeys,
    IReadOnlyList<string> SuggestedStrengthAreaKeys,
    IReadOnlyList<string> SuggestedDevelopmentAreaKeys,
    IReadOnlyList<ElevatePracticePlanSummary> DevelopmentPlans);

public sealed record ElevatePracticeRatingScaleSummary(int Score, string Descriptor, string Meaning, string ColorHex);
public sealed record ElevatePracticeSupportOptionSummary(string Key, string Name);
public sealed record ElevatePracticeAreaSummary(
    Guid Id,
    string AreaKey,
    string Category,
    string Name,
    string ReflectionPrompt,
    int DisplayOrder,
    decimal? AverageScore,
    string? Reflection,
    IReadOnlyList<ElevatePracticeStatementSummary> Statements);
public sealed record ElevatePracticeStatementSummary(Guid Id, string StatementKey, string Text, int DisplayOrder, int? Score);
public sealed record ElevatePracticePlanSummary(
    string AreaKey,
    string DevelopmentApproach,
    IReadOnlyList<string> SupportKeys,
    string SupportDetails,
    string SuccessEvidence,
    string IntendedImpact,
    DateOnly? ReviewDate,
    Guid? ActionId);

public sealed record SaveElevatePracticeAssessmentRequest(
    IReadOnlyList<ElevatePracticeRatingRequest>? Ratings,
    IReadOnlyList<ElevatePracticeReflectionRequest>? Reflections,
    IReadOnlyList<string>? StrengthAreaKeys,
    IReadOnlyList<string>? DevelopmentAreaKeys,
    IReadOnlyList<ElevatePracticePlanRequest>? DevelopmentPlans,
    bool Submit = false);
public sealed record ElevatePracticeRatingRequest(Guid StatementId, int Score);
public sealed record ElevatePracticeReflectionRequest(string AreaKey, string? Text);
public sealed record ElevatePracticePlanRequest(
    string AreaKey,
    string? DevelopmentApproach,
    IReadOnlyList<string>? SupportKeys,
    string? SupportDetails,
    string? SuccessEvidence,
    string? IntendedImpact,
    DateOnly? ReviewDate);

public sealed record ElevatePracticeProgressSummary(
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

public sealed record StaffElevatePracticeSummary(
    Guid AssessmentId,
    string AcademicYear,
    string Status,
    decimal? OverallAverage,
    DateTimeOffset? SubmittedAt);
