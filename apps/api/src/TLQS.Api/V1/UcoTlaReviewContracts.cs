namespace TLQS.Api.V1;

public sealed record UcoTlaStaffOption(
    Guid StaffId,
    string DisplayName,
    string Email,
    string? JobTitle,
    bool IsUcoMember,
    bool IsCoordinator);

public sealed record UcoTlaAccessSummary(
    bool CanAccess,
    bool CanCreate,
    bool CanManage,
    bool CanExport,
    IReadOnlyList<UcoTlaStaffOption> UcoStaff);

public sealed record UcoTlaCapabilities(
    bool CanEditObserverSection,
    bool CanRecordProfessionalDiscussion,
    bool CanReflect,
    bool CanFinalise,
    bool CanReopen,
    bool CanManageFollowUp,
    bool CanCreateLinkedReview,
    bool CanViewObserverFindings,
    bool CanViewCompletedReport,
    bool CanExport);

public sealed record UcoTlaReviewSummary(
    Guid RecordId,
    string Title,
    string AcademicYear,
    string WorkflowStatus,
    Guid LecturerStaffId,
    string LecturerName,
    Guid ObserverStaffId,
    string ObserverName,
    DateTimeOffset? ObservationAt,
    string? CourseTitle,
    string? ModuleTitle,
    DateTimeOffset? ProfessionalDiscussionAt,
    DateTimeOffset? FollowUpAt,
    string? FollowUpStatus,
    int OpenActionCount,
    int OverdueActionCount,
    int CompletedSectionCount,
    byte[] RowVersion,
    UcoTlaCapabilities Capabilities);

public sealed record UcoTlaActionPlanSummary(
    Guid? Id,
    int DisplayOrder,
    string ActionType,
    string Target,
    string AchievementMethod,
    Guid OwnerStaffId,
    string? OwnerName,
    DateOnly DueDate,
    Guid? CentralActionId);

public sealed record UcoTlaFollowUpSummary(
    string FollowUpType,
    DateTimeOffset ScheduledAt,
    string Status,
    string? OutcomeNotes,
    Guid? LinkedReviewRecordId,
    DateTimeOffset? CompletedAt,
    byte[] RowVersion);

public sealed record UcoTlaReviewDetail(
    UcoTlaReviewSummary Review,
    Guid FormSubmissionId,
    string? SessionType,
    string? CourseLevel,
    int? NumberRegistered,
    int? NumberPresent,
    int? NumberLate,
    IReadOnlyDictionary<string, string?> Responses,
    IReadOnlyList<UcoTlaActionPlanSummary> ActionPlan,
    UcoTlaFollowUpSummary? FollowUp,
    Guid? ProbationObservationId,
    Guid? ParentReviewRecordId,
    IReadOnlyDictionary<string, bool> SectionCompletion,
    DateTimeOffset? LecturerAcknowledgedAt,
    string? LecturerSignatoryName,
    DateTimeOffset? ObserverSignedAt,
    string? ObserverSignatoryName,
    DateTimeOffset? ReopenedAt,
    string? ReopenReason);

public sealed record CreateUcoTlaReviewRequest(
    Guid LecturerStaffId,
    Guid ObserverStaffId,
    string AcademicYear,
    DateTimeOffset? ObservationAt = null,
    string? SessionType = null,
    string? CourseTitle = null,
    string? ModuleTitle = null,
    string? CourseLevel = null,
    int? NumberRegistered = null,
    int? NumberPresent = null,
    int? NumberLate = null);

public sealed record SaveUcoTlaObserverSectionRequest(
    DateTimeOffset ObservationAt,
    string SessionType,
    string CourseTitle,
    string ModuleTitle,
    string CourseLevel,
    int? NumberRegistered,
    int? NumberPresent,
    int? NumberLate,
    IReadOnlyDictionary<string, string?> Responses,
    IReadOnlyList<SaveUcoTlaActionPlanRequest> ActionPlan,
    DateTimeOffset? ProfessionalDiscussionAt,
    SaveUcoTlaFollowUpRequest? FollowUp,
    byte[] RowVersion,
    string? SectionKey = null,
    bool? IsSectionComplete = null);

public sealed record SaveUcoTlaActionPlanRequest(
    Guid? Id,
    int DisplayOrder,
    string ActionType,
    string Target,
    string AchievementMethod,
    Guid OwnerStaffId,
    DateOnly DueDate);

public sealed record SaveUcoTlaFollowUpRequest(
    string FollowUpType,
    DateTimeOffset ScheduledAt,
    string Status = "scheduled",
    string? OutcomeNotes = null,
    byte[]? RowVersion = null);

public sealed record UcoTlaLecturerAcknowledgementRequest(
    string LecturerReflection,
    byte[] RowVersion);

public sealed record UcoTlaProfessionalDiscussionRequest(
    DateTimeOffset ProfessionalDiscussionAt,
    byte[] RowVersion);

public sealed record UcoTlaFinaliseRequest(byte[] RowVersion);

public sealed record UcoTlaReopenRequest(string Reason, byte[] RowVersion);

public sealed record UcoTlaFollowUpRequest(
    string FollowUpType,
    DateTimeOffset ScheduledAt,
    string Status,
    string? OutcomeNotes,
    byte[]? RowVersion);

public sealed record CreateLinkedUcoTlaReviewRequest(
    Guid ObserverStaffId,
    DateTimeOffset ObservationAt,
    string SessionType,
    string CourseTitle,
    string ModuleTitle,
    string CourseLevel);

public sealed record UcoTlaPracticeHighlight(
    Guid RecordId,
    string LecturerName,
    string CourseTitle,
    string ModuleTitle,
    DateTimeOffset ObservationAt,
    string Category,
    string Narrative);

public sealed record UcoTlaDashboardSummary(
    int ReviewsThisYear,
    int CompletedReviews,
    int ActiveUcoStaff,
    int CoveredUcoStaff,
    int CoveragePercent,
    int AwaitingLecturer,
    int FollowUpsDue,
    int OpenActions,
    int OverdueActions,
    IReadOnlyList<UcoTlaPracticeHighlight> PracticeHighlights,
    IReadOnlyList<UcoTlaReviewSummary> Reviews);
