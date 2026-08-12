namespace TLQS.Api.V1;

public sealed record CoachingConfigurationSummary(
    IReadOnlyList<CoachingLookupOptionSummary> QualificationStatuses,
    IReadOnlyList<CoachingLookupOptionSummary> FocusAreas,
    IReadOnlyList<CoachingLookupOptionSummary> SupportTypes,
    IReadOnlyList<CoachingRubricOptionSummary> CurrentPracticeRubric,
    int MaxActionsPerSession);

public sealed record CoachingLookupOptionSummary(
    Guid Id,
    string ValueKey,
    string DisplayName,
    int DisplayOrder);

public sealed record CoachingRubricOptionSummary(
    Guid Id,
    string DescriptorKey,
    string VisibleWording,
    string GuidanceText,
    int DisplayOrder,
    string? ColourClassification,
    string? ColorHex);

public sealed record CoachingContextSummary(
    Guid StaffId,
    string StaffName,
    Guid CoachStaffId,
    string CoachName,
    string CoachSource,
    IReadOnlyList<CoachingCycleSummary> Cycles,
    Guid? SelectedCycleId,
    int NextSessionNumber,
    IReadOnlyList<CoachingPreviousActionSummary> PreviousActions);

public sealed record CoachingCycleSummary(
    Guid Id,
    int CycleNumber,
    string CycleType,
    string Status,
    DateOnly StartedOn,
    DateOnly? ClosedOn,
    Guid CoachStaffId,
    string CoachName,
    int SessionCount);

public sealed record CoachingPreviousActionSummary(
    Guid ActionId,
    string ActionTheme,
    string Title,
    string OwnerType,
    string OwnerName,
    DateOnly? DueDate,
    DateOnly? ReviewDate,
    string Status,
    string? IntendedEvidence,
    string? IntendedImpact,
    string? LatestProgressUpdate,
    string? LatestImpactObserved);

public sealed record CoachingSessionSummary(
    Guid Id,
    Guid RecordId,
    Guid CycleId,
    int CycleNumber,
    Guid StaffId,
    string StaffName,
    Guid CoachStaffId,
    string CoachName,
    int SessionNumber,
    DateOnly SessionDate,
    string SessionType,
    string Status,
    string? PrimaryFocus,
    DateTimeOffset CreatedAt,
    DateTimeOffset? UpdatedAt,
    bool CanEdit,
    bool IsCreatedByCurrentUser);

public sealed record CoachingSessionDetail(
    Guid Id,
    Guid RecordId,
    Guid CycleId,
    int CycleNumber,
    Guid StaffId,
    string StaffName,
    Guid CoachStaffId,
    string CoachName,
    int SessionNumber,
    DateOnly SessionDate,
    string SessionType,
    string? DeliveryMethod,
    int? DurationMinutes,
    string Status,
    string? QualificationStatusKey,
    string? PrimaryFocusKey,
    string? SecondaryFocusKey,
    string? FocusOtherText,
    string? SpecificSessionFocus,
    Guid? CurrentPracticeDescriptorId,
    string? CurrentPracticeWording,
    string? CurrentPracticeEvidence,
    IReadOnlyList<string> SupportTypes,
    string? SupportOtherText,
    string? ConversationSummary,
    bool ClosesCycle,
    DateTimeOffset? CompletedAt,
    bool CanEdit,
    IReadOnlyList<CoachingPreviousActionSummary> PreviousActions,
    IReadOnlyList<CoachingActionReviewSummary> ActionReviews,
    IReadOnlyList<CoachingSessionActionSummary> Actions);

public sealed record CoachingActionReviewSummary(
    Guid ActionId,
    string? ReviewOutcome,
    string? ProgressUpdate,
    string? ImpactObserved,
    CoachingSessionActionSummary? RevisedAction);

public sealed record CoachingSessionActionSummary(
    Guid? Id,
    int ActionOrder,
    string ActionTheme,
    string ActionText,
    string OwnerType,
    string OwnerName,
    DateOnly? DueDate,
    string? IntendedEvidence,
    string? IntendedImpact,
    DateOnly? ReviewDate,
    string Status,
    Guid? ParentActionId);

public sealed record SaveCoachingSessionRequest(
    Guid StaffId,
    Guid? CycleId,
    bool CreateNewCycle,
    DateOnly SessionDate,
    string SessionType,
    string? DeliveryMethod,
    int? DurationMinutes,
    string Status,
    string? QualificationStatusKey,
    string? PrimaryFocusKey,
    string? SecondaryFocusKey,
    string? FocusOtherText,
    string? SpecificSessionFocus,
    Guid? CurrentPracticeDescriptorId,
    string? CurrentPracticeEvidence,
    IReadOnlyList<string>? SupportTypes,
    string? SupportOtherText,
    string? ConversationSummary,
    bool CloseCycle,
    IReadOnlyList<CoachingActionReviewRequest>? ActionReviews,
    IReadOnlyList<CoachingSessionActionRequest>? Actions);

public sealed record CoachingActionReviewRequest(
    Guid ActionId,
    string? ReviewOutcome,
    string? ProgressUpdate,
    string? ImpactObserved,
    CoachingSessionActionRequest? RevisedAction);

public sealed record CoachingSessionActionRequest(
    Guid? Id,
    string ActionTheme,
    string ActionText,
    string OwnerType,
    DateOnly? DueDate,
    string? IntendedEvidence,
    string? IntendedImpact,
    DateOnly? ReviewDate,
    string Status);

public sealed record CoachingSessionSaveSummary(
    Guid Id,
    Guid RecordId,
    Guid CycleId,
    int CycleNumber,
    int SessionNumber,
    string Status);

public sealed record UpdateCoachingConfigurationRequest(int MaxActionsPerSession);
