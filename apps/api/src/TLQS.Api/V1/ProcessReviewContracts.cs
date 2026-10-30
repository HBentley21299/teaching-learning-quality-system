namespace TLQS.Api.V1;

public sealed record ProcessReviewStatement(string Key, string Text);
public sealed record ProcessReviewStandard(string Key, string Title, IReadOnlyList<ProcessReviewStatement> Statements);
public sealed record ProcessReviewRatingOption(string Key, string Label);
public sealed record ProcessReviewSkillSubArea(string Key,string Title);
public sealed record ProcessReviewSkillsPillar(string Key,string Title,IReadOnlyList<ProcessReviewSkillSubArea> SubAreas);
public sealed record ProcessReviewActionTheme(string Key,string Title);
public sealed record ProcessReviewOrgScope(Guid OrgUnitId,string Name,Guid? ParentOrgUnitId=null,string? ParentName=null,string? OrgUnitType=null);
public sealed record ProcessReviewResponsibleStaff(Guid StaffId,string DisplayName);
public sealed record ProcessReviewParticipant(Guid StaffId,string DisplayName,IReadOnlyList<string> Roles,bool IsLocked,IReadOnlyList<string> OrgUnitNames);
public sealed record ActivateGrowthReviewData(
    bool AllSubTeams,IReadOnlyList<Guid> SubTeamOrgUnitIds,IReadOnlyList<Guid> ParticipantStaffIds,
    IReadOnlyList<Guid> RemovedProgrammeLeaderStaffIds,IReadOnlyDictionary<string,decimal?> SkillsScanScores,
    DateOnly? FollowUpDate=null,string? MeetingMinutes=null,string? Strengths=null,string? Development=null,
    IReadOnlyList<Guid>? HeadOfFacultyStaffIds=null,IReadOnlyList<Guid>? ProgrammeLeaderStaffIds=null,
    IReadOnlyList<ProcessReviewParticipant>? AutomaticParticipants=null);
public sealed record ResolveActivateReviewContextRequest(Guid FacultyOrgUnitId,bool AllSubTeams,IReadOnlyList<Guid> SubTeamOrgUnitIds,
    Guid? RecordId=null,DateOnly? RecordDate=null);
public sealed record ActivateReviewContext(Guid FacultyOrgUnitId,string FacultyName,
    IReadOnlyList<ProcessReviewOrgScope> AvailableSubTeams,IReadOnlyList<Guid> SelectedSubTeamOrgUnitIds,
    IReadOnlyList<ProcessReviewParticipant> Participants,IReadOnlyList<string> Warnings);
public sealed record ProcessReviewConfiguration(
    string ProcessKey, string Title, int Version, string? RowVersion,
    IReadOnlyList<ProcessReviewStandard> Standards, IReadOnlyList<ProcessReviewRatingOption> RatingOptions,
    IReadOnlyDictionary<string, string> FieldLabels, IReadOnlyDictionary<string, string> Settings,
    IReadOnlyList<ProcessReviewSkillsPillar>? SkillsScanPillars=null,IReadOnlyList<ProcessReviewActionTheme>? ActionThemes=null);
public sealed record ProcessReviewSample(
    string Id, string Title, string SampleType, DateOnly? SampleDate, string? Course,
    IReadOnlyList<Guid> StaffIds, string? EvidenceLink, string? Notes);
public sealed record ProcessReviewResponse(
    string StatementKey, string? RatingKey, IReadOnlyList<string> SampleIds, string? Rationale);
public sealed record ProcessReviewData(
    IReadOnlyDictionary<string, string> Fields, IReadOnlyList<ProcessReviewSample> Samples,
    IReadOnlyList<ProcessReviewResponse> Responses,ActivateGrowthReviewData? Activate=null);
public sealed record SaveProcessReviewRequest(
    string Title, string AcademicYear, Guid? FacultyOrgUnitId, Guid? TeamOrgUnitId,
    DateOnly? RecordDate, ProcessReviewData Data, bool Submit = false, string? RowVersion = null);
public sealed record CreateActivateFollowUpRequest(string AcademicYear,DateOnly? RecordDate=null,string? RowVersion=null);
public sealed record ProcessReviewLink(Guid RecordId,string Title,string AcademicYear,DateOnly? RecordDate,string Status,bool CanEdit=false);
public sealed record ActivatePreviousReviewContext(ProcessReviewLink Review,ProcessReviewConfiguration Configuration,
    IReadOnlyDictionary<string,decimal?> SkillsScanScores,string? MeetingMinutes,string? Strengths,string? Development,
    IReadOnlyList<ProcessReviewOrgScope> SelectedSubTeams,IReadOnlyList<ProcessReviewParticipant> Participants);
public sealed record ProcessReviewSummary(
    Guid RecordId, string ProcessKey, string Title, string AcademicYear,
    Guid? FacultyOrgUnitId, string? FacultyName, Guid? TeamOrgUnitId, string? TeamName,
    DateOnly? RecordDate, Guid OwnerStaffId, string OwnerName, string Status,
    DateTimeOffset UpdatedAt, string RowVersion, int SampleCount, int RatedStatementCount,
    int StatementCount, int OpenActionCount, DateOnly? SnapshotAsOf,
    IReadOnlyList<ProcessReviewOrgScope>? SelectedSubTeams=null,IReadOnlyList<ProcessReviewParticipant>? Participants=null,
    IReadOnlyDictionary<string,decimal?>? SkillsScanScores=null,DateOnly? FollowUpDate=null,bool? AllSubTeams=null,
    bool IsFollowUp=false,ProcessReviewLink? ParentReview=null,IReadOnlyList<ProcessReviewLink>? FollowUpReviews=null);
public sealed record ProcessReviewSnapshot(
    Guid SnapshotId, DateOnly AsOfDate, DateTimeOffset RecordedAt, string RecordedByName,
    string SourceMeeting, string TeamsLink, ProcessReviewData Data);
public sealed record ProcessReviewActionUpdate(
    Guid UpdateId, DateTimeOffset UpdatedAt, string UpdatedByName, string Progress,
    string? ProgressNote, string? EvidenceLink, string? Barriers, string? NextStep,
    DateOnly DueDate, string? DeadlineChangeReason,
    string ImpactStatus, string? ImpactEvidence, string? ImpactEvidenceLink);
public sealed record ProcessReviewAction(
    Guid ActionId, Guid RecordId, string ProcessKey, string RecordTitle, string AcademicYear,
    string? FacultyName, string? TeamName, string Title, string ThemeKey,
    Guid OwnerStaffId, string OwnerName, DateOnly DueDate, string SupportRequired,
    string SuccessEvidence, string Progress, string ImpactStatus, string? ImpactEvidence,
    string? ImpactEvidenceLink, string RowVersion, IReadOnlyList<ProcessReviewActionUpdate> Updates, bool CanEdit = false, string? ThemeLabel = null,
    IReadOnlyList<Guid>? ResponsibleStaffIds=null,IReadOnlyList<ProcessReviewResponsibleStaff>? ResponsibleStaff=null,
    string? ImpactAreaKey=null,string? ImpactAreaLabel=null,string? Detail=null,DateOnly? ReviewDate=null,
    IReadOnlyList<Guid>? AssociatedReviewIds=null);
public sealed record SaveProcessReviewActionRequest(
    string Title, string ThemeKey, Guid OwnerStaffId, DateOnly DueDate,
    string SupportRequired, string SuccessEvidence, string Progress = "open",
    string? ProgressNote = null, string? EvidenceLink = null, string? Barriers = null,
    string? NextStep = null, string ImpactStatus = "awaiting_evidence",
    string? ImpactEvidence = null, string? ImpactEvidenceLink = null,
    string? DeadlineChangeReason = null, string? RowVersion = null,
    IReadOnlyList<Guid>? ResponsibleStaffIds=null,string? ImpactAreaKey=null,string? Detail=null,DateOnly? ReviewDate=null);
public sealed record ProcessReviewDetail(
    Guid RecordId, string ProcessKey, string Title, string AcademicYear,
    Guid? FacultyOrgUnitId, string? FacultyName, Guid? TeamOrgUnitId, string? TeamName,
    DateOnly? RecordDate, Guid OwnerStaffId, string OwnerName, string Status,
    DateTimeOffset UpdatedAt, string RowVersion, ProcessReviewConfiguration Configuration,
    ProcessReviewData Data, IReadOnlyList<ProcessReviewSnapshot> Snapshots,
    IReadOnlyList<ProcessReviewAction> Actions, bool CanEdit,
    IReadOnlyList<ProcessReviewOrgScope>? SelectedSubTeams=null,IReadOnlyList<ProcessReviewParticipant>? Participants=null,
    ProcessReviewConfiguration? LegacyConfiguration=null,bool IsFollowUp=false,ProcessReviewLink? ParentReview=null,
    IReadOnlyList<ProcessReviewLink>? FollowUpReviews=null,ActivatePreviousReviewContext? ParentReviewContext=null);
