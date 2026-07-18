namespace TLQS.Api.V1;

public sealed record ProbationReviewerOptionSummary(
    Guid StaffId,
    string DisplayName,
    string Email,
    string ReviewerType);

public sealed record ProbationConfigurationSummary(
    IReadOnlyList<LivLookupOptionSummary> DeliveryAreas,
    IReadOnlyList<LivLookupOptionSummary> FocusAreas,
    IReadOnlyList<LivLookupOptionSummary> DevelopmentOpportunities,
    IReadOnlyList<ElevatePracticeRatingScaleSummary> Rubric,
    IReadOnlyList<ProbationReviewerOptionSummary> TeachingLearningReviewers,
    IReadOnlyList<StaffSummary> EligibleStaff,
    bool CanCreateCase);

public sealed record ProbationStaffContextSummary(
    Guid StaffId,
    string StaffName,
    Guid? AssessmentId,
    Guid? AssessmentRecordId,
    string? AcademicYear,
    string? PrimaryFocus,
    string? SecondaryFocus,
    string? DesiredOutcome,
    bool HasActiveProbationCase);

public sealed record CreateProbationCaseRequest(
    Guid SubjectStaffId,
    Guid? TeachingLearningReviewerStaffId,
    Guid? OrgUnitId = null);

public sealed record ProbationReviewerSummary(
    Guid StaffId,
    string DisplayName,
    string ReviewerRole);

public sealed record ProbationRatingRequest(
    string FocusKey,
    Guid DescriptorId,
    string? EvidenceOfPractice);

public sealed record ProbationRatingSummary(
    string FocusKey,
    string FocusName,
    Guid DescriptorId,
    string Descriptor,
    string? EvidenceOfPractice);

public sealed record SaveProbationVisitRequest(
    string? DeliveryAreaKey,
    DateOnly? ObservationDate,
    string? ObservationTime,
    string? CourseName,
    string? CourseGroup,
    string? CourseLevel,
    string? KeyPoints,
    IReadOnlyList<ProbationRatingRequest>? Ratings,
    string? StageStatus = null);

public sealed record ProbationVisitSummary(
    string? DeliveryAreaKey,
    string? DeliveryAreaName,
    DateOnly? ObservationDate,
    string? ObservationTime,
    string? CourseName,
    string? CourseGroup,
    string? CourseLevel,
    string? KeyPoints,
    IReadOnlyList<ProbationRatingSummary> Ratings);

public sealed record SaveProbationStageRequest(
    string? ContextText,
    string? AimsText,
    string? LearnerActivityText,
    string? ReflectionText,
    IReadOnlyList<string>? DevelopmentOpportunityKeys,
    DateOnly? IntendedNextObservationDate,
    string? StageStatus = null);

public sealed record ProbationStageSummary(
    Guid Id,
    string StageType,
    int StageOrder,
    string StageStatus,
    string? ContextText,
    string? AimsText,
    string? LearnerActivityText,
    string? ReflectionText,
    IReadOnlyList<string> DevelopmentOpportunityKeys,
    DateOnly? IntendedNextObservationDate,
    bool CanEdit);

public sealed record ProbationObservationSummary(
    Guid Id,
    int ObservationNumber,
    string ObservationType,
    string Status,
    Guid? LinkedLivRecordId,
    Guid? LinkedLivSourceRecordId,
    DateTimeOffset? StartedAt,
    DateTimeOffset? CompletedAt,
    IReadOnlyList<ProbationStageSummary> Stages,
    ProbationVisitSummary? Visit);

public sealed record ProbationCaseSummary(
    Guid Id,
    Guid RecordId,
    Guid SubjectStaffId,
    string SubjectStaffName,
    Guid? OrgUnitId,
    string? OrgUnitCode,
    string? ParentOrgUnitCode,
    string AcademicYear,
    string Status,
    int CurrentObservationNumber,
    Guid? SourceElevateAssessmentId,
    Guid? SourceElevateRecordId,
    DateTimeOffset CreatedAt,
    DateTimeOffset? UpdatedAt,
    bool CanEdit,
    IReadOnlyList<ProbationReviewerSummary> Reviewers,
    IReadOnlyList<ProbationObservationSummary> Observations);

public sealed record StartProbationLivSummary(Guid LivRecordId, Guid LivSourceRecordId);
