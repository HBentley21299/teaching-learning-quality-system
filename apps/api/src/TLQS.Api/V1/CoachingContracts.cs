namespace TLQS.Api.V1;

public sealed record CoachingConfigurationSummary(
    IReadOnlyList<CoachingLookupOptionSummary> DevelopmentStages,
    IReadOnlyList<CoachingLookupOptionSummary> FocusAreas,
    IReadOnlyList<CoachingLookupOptionSummary> SupportTypes,
    IReadOnlyList<CoachingRubricOptionSummary> IntendedImpactRubric);

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
    string Title,
    DateOnly? TargetDate,
    string Status,
    string? LatestUpdate,
    int ExtensionCount,
    string? LastExtensionReason);

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
    string? MainFocus,
    DateTimeOffset CreatedAt,
    DateTimeOffset? UpdatedAt,
    bool CanEdit);

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
    string? DevelopmentStageKey,
    IReadOnlyList<string> FocusAreas,
    string? AdditionalFocus,
    string? ProgressReflection,
    string? MainFocus,
    IReadOnlyList<string> AdditionalFocusAreas,
    string? SessionReason,
    string? Goal,
    string? WhyThisMatters,
    string? IntendedImpact,
    Guid? IntendedImpactDescriptorId,
    string? IntendedImpactWording,
    int? ConfidenceBefore,
    string? CurrentSituation,
    string? WhatsWorking,
    string? Challenges,
    string? KeyDiscussionPoints,
    IReadOnlyList<string> SupportTypes,
    string? SupportResources,
    string? MentorComments,
    IReadOnlyList<string> IntendedImpactAreas,
    string? ImpactStatement,
    int? ConfidenceToComplete,
    IReadOnlyList<string> SupportNeeded,
    string? AdditionalSupportDetails,
    string? KeyTakeaway,
    string? SessionSummary,
    bool StaffAgrees,
    bool CoachAgrees,
    string? AnotherSessionRequired,
    DateOnly? NextSessionDate,
    string? NextFocus,
    DateTimeOffset? CompletedAt,
    bool CanEdit,
    IReadOnlyList<CoachingPreviousActionSummary> PreviousActions,
    IReadOnlyList<CoachingPreviousActionUpdateSummary> PreviousActionUpdates,
    IReadOnlyList<CoachingSessionActionSummary> Actions);

public sealed record CoachingPreviousActionUpdateSummary(
    Guid ActionId,
    string Status,
    string? UpdateText);

public sealed record CoachingSessionActionSummary(
    Guid? Id,
    Guid? ActionId,
    int ActionOrder,
    string ActionText,
    string OwnerType,
    DateOnly TargetDate,
    string? EvidenceText);

public sealed record SaveCoachingSessionRequest(
    Guid StaffId,
    Guid? CycleId,
    bool CreateNewCycle,
    DateOnly SessionDate,
    string SessionType,
    string? DeliveryMethod,
    int? DurationMinutes,
    string Status,
    string? DevelopmentStageKey,
    IReadOnlyList<string>? FocusAreas,
    string? AdditionalFocus,
    string? ProgressReflection,
    string? MainFocus,
    IReadOnlyList<string>? AdditionalFocusAreas,
    string? SessionReason,
    string? Goal,
    string? WhyThisMatters,
    string? IntendedImpact,
    Guid? IntendedImpactDescriptorId,
    int? ConfidenceBefore,
    string? CurrentSituation,
    string? WhatsWorking,
    string? Challenges,
    string? KeyDiscussionPoints,
    IReadOnlyList<string>? SupportTypes,
    string? SupportResources,
    string? MentorComments,
    IReadOnlyList<string>? IntendedImpactAreas,
    string? ImpactStatement,
    int? ConfidenceToComplete,
    IReadOnlyList<string>? SupportNeeded,
    string? AdditionalSupportDetails,
    string? KeyTakeaway,
    string? SessionSummary,
    bool StaffAgrees,
    bool CoachAgrees,
    string? AnotherSessionRequired,
    DateOnly? NextSessionDate,
    string? NextFocus,
    IReadOnlyList<CoachingPreviousActionUpdateRequest>? PreviousActionUpdates,
    IReadOnlyList<CoachingSessionActionRequest>? Actions);

public sealed record CoachingPreviousActionUpdateRequest(
    Guid ActionId,
    string Status,
    string? UpdateText);

public sealed record CoachingSessionActionRequest(
    Guid? Id,
    string ActionText,
    string OwnerType,
    DateOnly TargetDate,
    string? EvidenceText);

public sealed record CoachingSessionSaveSummary(
    Guid Id,
    Guid RecordId,
    Guid CycleId,
    int CycleNumber,
    int SessionNumber,
    string Status);
