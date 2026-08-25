namespace TLQS.Api.V1;

public sealed record QaCapabilities(
    bool CanConfigure,
    bool CanSubmitEvidence,
    bool CanCorrectEvidence,
    bool CanRemoveEvidence,
    bool CanClose,
    bool CanReopen,
    bool CanArchive,
    bool CanExport,
    bool CanManageActions);

public sealed record QaHubSummary(
    bool CanAccessHub,
    bool CanManageReviews,
    bool CanMonitorActions,
    int OpenReviewCount,
    int AccessibleReviewCount,
    IReadOnlyList<QaReviewSummary> Reviews);

public sealed record QaReviewSummary(
    Guid Id,
    string Title,
    string AcademicYear,
    string Theme,
    string Status,
    DateOnly? PlannedOpenDate,
    DateOnly ClosingDate,
    string OwnerName,
    int TeamCount,
    int ActivityCount,
    int EvidenceCount,
    byte[] RowVersion,
    QaCapabilities Capabilities);

public sealed record QaReviewDetail(
    QaReviewSummary Review,
    string QuestionTag,
    Guid OwnerStaffId,
    IReadOnlyList<QaScopeSummary> Scope,
    IReadOnlyList<QaReviewActivitySummary> Activities,
    IReadOnlyList<QaEvidenceSummary> Evidence,
    QaCloseValidationSummary? CloseValidation);

public sealed record QaScopeSummary(
    Guid OrgUnitId,
    string ScopeType,
    string Code,
    string Name,
    Guid? ParentOrgUnitId,
    string? ParentCode,
    string? ParentName);

public sealed record QaActivityTypeSummary(
    Guid Id,
    string ActivityKey,
    string Name,
    string? Description,
    int DisplayOrder,
    bool IsActive,
    IReadOnlyList<QaActivityTemplateSummary> Templates);

public sealed record QaActivityTemplateSummary(
    Guid Id,
    Guid ActivityTypeId,
    string TemplateKey,
    string Name,
    string? Description,
    bool IsActive,
    int QuestionCount,
    byte[] RowVersion);

public sealed record QaReviewActivitySummary(
    Guid Id,
    Guid ActivityTypeId,
    string ActivityKey,
    string Name,
    Guid TemplateId,
    string TemplateName,
    int DisplayOrder,
    IReadOnlyList<QaQuestionSummary> Questions);

public sealed record QaQuestionSummary(
    Guid Id,
    Guid ActivityTypeId,
    string ActivityKey,
    string ActivityName,
    int VersionNumber,
    string? ThemeOrWeek,
    string QuestionText,
    string? Guidance,
    int DisplayOrder,
    bool IsRequired,
    bool AllowsNotApplicable,
    bool CommentRequiredAtExpected,
    bool IsActive,
    string SourceStatus,
    string QuestionTag,
    DateTimeOffset CreatedAt);

public sealed record SaveQaReviewRequest(
    string Title,
    string AcademicYear,
    string Theme,
    string QuestionTag,
    Guid OwnerStaffId,
    DateOnly? PlannedOpenDate,
    DateOnly ClosingDate,
    IReadOnlyList<Guid> TeamOrgUnitIds,
    IReadOnlyList<SaveQaReviewActivityRequest> Activities,
    byte[]? RowVersion = null);

public sealed record SaveQaReviewActivityRequest(
    Guid ActivityTypeId,
    Guid TemplateId,
    IReadOnlyList<Guid> QuestionIds);

public sealed record SaveQaQuestionRequest(
    Guid ActivityTypeId,
    string? ThemeOrWeek,
    string QuestionText,
    string? Guidance,
    int DisplayOrder,
    bool IsRequired,
    bool AllowsNotApplicable,
    bool CommentRequiredAtExpected,
    bool IsActive,
    string SourceStatus,
    string QuestionTag);

public sealed record DuplicateQaTemplateRequest(string Name, string? Description);

public sealed record QaLifecycleRequest(string? Reason, byte[] RowVersion);

public sealed record QaReasonRequest(string Reason);

public sealed record QaCloseValidationSummary(
    IReadOnlyList<string> ActivitiesWithoutEvidence,
    IReadOnlyList<string> TeamsWithoutEvidence,
    int DraftSubmissionCount,
    int MissingRequiredResponseCount,
    int EvidenceCount,
    int RatedResponseCount,
    int SampleCount);

public sealed record QaEvidenceSummary(
    Guid Id,
    Guid ReviewId,
    Guid ReviewActivityId,
    string ActivityName,
    string Status,
    Guid TeamOrgUnitId,
    string FacultyName,
    string TeamName,
    string? CourseProgramme,
    string? CourseLevel,
    string? SubjectStaffName,
    Guid ReviewerStaffId,
    string ReviewerName,
    DateTimeOffset ActivityAt,
    int? SampleSize,
    int ResponseCount,
    DateTimeOffset? SubmittedAt,
    int VersionNumber,
    byte[] RowVersion,
    bool CanEdit,
    bool CanRemove);

public sealed record QaEvidenceDetail(
    QaEvidenceSummary Evidence,
    IReadOnlyList<Guid> TeamOrgUnitIds,
    IReadOnlyList<string> TeamNames,
    string? ContextualNotes,
    IReadOnlyList<string> EvidenceLinks,
    string? KeyStrengths,
    string? AreasForImprovement,
    string? RecommendedActions,
    string? AdditionalContext,
    Guid? SubjectStaffId,
    IReadOnlyList<QaEvidenceResponseSummary> Responses,
    IReadOnlyList<QaEvidenceRevisionSummary> Revisions);

public sealed record QaEvidenceResponseSummary(
    Guid ReviewQuestionId,
    string? ThemeOrWeek,
    string QuestionText,
    string? Guidance,
    int DisplayOrder,
    bool IsRequired,
    bool AllowsNotApplicable,
    bool CommentRequiredAtExpected,
    string? Outcome,
    string? Comment,
    string? NotApplicableReason);

public sealed record SaveQaEvidenceRequest(
    Guid ReviewActivityId,
    Guid TeamOrgUnitId,
    IReadOnlyList<Guid>? TeamOrgUnitIds,
    string? CourseProgramme,
    string? CourseLevel,
    Guid? SubjectStaffId,
    DateTimeOffset ActivityAt,
    int? SampleSize,
    string? ContextualNotes,
    IReadOnlyList<string>? EvidenceLinks,
    string? KeyStrengths,
    string? AreasForImprovement,
    string? RecommendedActions,
    string? AdditionalContext,
    IReadOnlyList<SaveQaEvidenceResponseRequest> Responses,
    string? CorrectionReason,
    byte[]? RowVersion = null);

public sealed record SaveQaEvidenceResponseRequest(
    Guid ReviewQuestionId,
    string? Outcome,
    string? Comment,
    string? NotApplicableReason);

public sealed record QaEvidenceRevisionSummary(
    int VersionNumber,
    string? Reason,
    string CreatedBy,
    DateTimeOffset CreatedAt);

public sealed record QaDashboardSummary(
    Guid ReviewId,
    int EvidenceCount,
    int FacultyCount,
    int TeamCount,
    int CourseCount,
    int SampleCount,
    int BelowCount,
    int AtCount,
    int AboveCount,
    int NotApplicableCount,
    int RatedCount,
    decimal AtOrAbovePercentage,
    IReadOnlyList<QaDashboardBreakdown> ByActivity,
    IReadOnlyList<QaDashboardQuestionBreakdown> Questions,
    IReadOnlyList<QaDashboardBreakdown> ByTeam,
    IReadOnlyList<QaDashboardBreakdown> ByTheme,
    IReadOnlyList<QaDashboardTimelinePoint> Timeline,
    IReadOnlyList<string> TeamsWithoutEvidence,
    int LinkedActionCount,
    int OpenActionCount,
    int SnapshotVersion);

public sealed record QaDashboardBreakdown(
    string Key,
    string Label,
    int Below,
    int At,
    int Above,
    int NotApplicable,
    int Rated,
    decimal AtOrAbovePercentage);

public sealed record QaDashboardQuestionBreakdown(
    string ActivityKey,
    string ActivityLabel,
    Guid QuestionId,
    string? ThemeOrWeek,
    string QuestionText,
    int Below,
    int At,
    int Above,
    int NotApplicable,
    int Rated,
    decimal BelowPercentage,
    decimal AtPercentage,
    decimal AbovePercentage);

public sealed record QaDashboardTimelinePoint(DateOnly Date, int EvidenceCount, int ResponseCount);

public sealed record QaReviewReportData(
    QaReviewDetail Review,
    QaDashboardSummary Dashboard,
    IReadOnlyList<QaActionGroupSummary> Actions,
    string GeneratedBy,
    DateTimeOffset GeneratedAt,
    Guid? FacultyOrgUnitId,
    string? FacultyName,
    Guid? TeamOrgUnitId,
    string? TeamName);

public sealed record QaAuditSummary(
    Guid Id,
    string Action,
    string? Summary,
    string? Reason,
    string ActorName,
    DateTimeOffset CreatedAt);

public sealed record QaActionOwnerOption(Guid StaffId, string DisplayName);

public sealed record QaActionTeamOption(
    Guid TeamOrgUnitId,
    string TeamName,
    QaActionOwnerOption? ProgrammeLeader);

public sealed record QaActionFacultyOption(
    Guid FacultyOrgUnitId,
    string FacultyName,
    QaActionOwnerOption? HeadOfFaculty,
    IReadOnlyList<QaActionTeamOption> Teams);

public sealed record QaReviewActionOptions(
    Guid ReviewId,
    string ReviewTitle,
    string CreationMode,
    bool CanCreateWholeReview,
    IReadOnlyList<QaActionFacultyOption> Faculties);

public sealed record CreateQaActionGroupRequest(
    Guid? FacultyOrgUnitId,
    IReadOnlyList<Guid> TeamOrgUnitIds,
    string Title,
    string? Detail,
    DateOnly DueDate,
    bool WholeReview = false);

public sealed record QaActionWorkflowRequest(byte[] RowVersion);

public sealed record QaActionAssignmentSummary(
    Guid ActionId,
    Guid StaffId,
    string StaffName,
    string AssignmentRole,
    Guid SourceOrgUnitId,
    string SourceOrgUnitName,
    string Status,
    DateOnly? CompletedDate);

public sealed record QaActionGroupSummary(
    Guid Id,
    Guid ReviewId,
    string ReviewTitle,
    Guid? FacultyOrgUnitId,
    string FacultyName,
    IReadOnlyList<Guid> TeamOrgUnitIds,
    IReadOnlyList<string> TeamNames,
    string Title,
    string? Detail,
    DateOnly DueDate,
    string Status,
    DateTimeOffset CreatedAt,
    Guid? CreatorStaffId,
    string CreatorName,
    DateTimeOffset? ReviewedAt,
    DateTimeOffset? ClosedAt,
    string? CloseNote,
    IReadOnlyList<QaActionAssignmentSummary> Assignments,
    byte[] RowVersion,
    bool CanReview,
    bool CanClose);
