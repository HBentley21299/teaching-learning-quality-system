export type ModuleSummary = {
  id: string;
  moduleKey: string;
  name: string;
  description?: string;
  routePrefix: string;
  displayOrder: number;
  isEnabled: boolean;
};

export type AcademicYearSummary = {
  academicYear: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  isFuture: boolean;
};

export type StaffSummary = {
  id: string;
  externalId: string;
  displayName: string;
  email: string;
  jobTitle?: string;
  primaryOrgUnitId?: string;
  accountStatus: string;
  orgUnitIds: string[];
};

export type MyTeamOrgUnit = {
  id: string;
  code: string;
  name: string;
};

export type MyTeamMember = {
  staffId: string;
  externalId: string;
  displayName: string;
  email: string;
  accountStatus: string;
  faculties: MyTeamOrgUnit[];
  teams: MyTeamOrgUnit[];
  roleNames: string[];
  openActionCount: number;
  overdueActionCount: number;
  elevateJudgement?: string;
  canOpenProfile: boolean;
  canManageActions: boolean;
};

export type LookupSummary = {
  lookupKey: string;
  name: string;
  values: string[];
};

export type LookupValueSummary = {
  id: string;
  valueKey: string;
  displayName: string;
  displayOrder: number;
};

export type ActionSummary = {
  id: string;
  sourceRecordId?: string;
  sourceRecordTitle?: string;
  sourceFormType: string;
  sourceSubRecordType?: string;
  sourceSubRecordId?: string;
  sourceSubRecordKey?: string;
  subjectStaffId?: string;
  subjectStaffName?: string;
  ownerStaffId: string;
  ownerStaffName?: string;
  actionTheme: string;
  title: string;
  detail?: string;
  statusKey?: string;
  priorityKey?: string;
  dueDate?: string;
  originalDueDate?: string;
  revisedDueDate?: string;
  completedDate?: string;
  completionNote?: string;
  cancellationComments?: string;
  visibilitySetting: ActionVisibility;
  publishedToStaff: boolean;
  isOverdue: boolean;
  createdAt: string;
  updatedAt?: string;
  deletedAt?: string;
  createdByName?: string;
  updatedByName?: string;
  completedByName?: string;
  cancelledByName?: string;
  deletedByName?: string;
  deletionReason?: string;
  facultyId?: string;
  facultyCode?: string;
  facultyName?: string;
  teamId?: string;
  teamCode?: string;
  teamName?: string;
  extensionCount: number;
  lastExtensionReason?: string;
  livVisitId?: string;
  livCycleId?: string;
  reviewDate?: string;
  intendedEvidence?: string;
  intendedImpact?: string;
  progressStatus?: CoachingActionStatus;
  parentActionId?: string;
  academicYear: string;
  isDeleted: boolean;
};

export type UcoTlaStaffOption = {
  staffId: string;
  displayName: string;
  email: string;
  jobTitle?: string;
  isUcoMember: boolean;
  isCoordinator: boolean;
};

export type UcoTlaAccessSummary = {
  canAccess: boolean;
  canCreate: boolean;
  canManage: boolean;
  canExport: boolean;
  ucoStaff: UcoTlaStaffOption[];
};

export type UcoTlaCapabilities = {
  canEditObserverSection: boolean;
  canRecordProfessionalDiscussion: boolean;
  canReflect: boolean;
  canFinalise: boolean;
  canReopen: boolean;
  canManageFollowUp: boolean;
  canCreateLinkedReview: boolean;
  canViewObserverFindings: boolean;
  canViewCompletedReport: boolean;
  canExport: boolean;
};

export type UcoTlaReviewSummary = {
  recordId: string;
  title: string;
  academicYear: string;
  workflowStatus: string;
  lecturerStaffId: string;
  lecturerName: string;
  observerStaffId: string;
  observerName: string;
  observationAt?: string;
  courseTitle?: string;
  moduleTitle?: string;
  professionalDiscussionAt?: string;
  followUpAt?: string;
  followUpStatus?: string;
  openActionCount: number;
  overdueActionCount: number;
  completedSectionCount: number;
  rowVersion: string;
  capabilities: UcoTlaCapabilities;
};

export type UcoTlaActionPlan = {
  id?: string;
  displayOrder: number;
  actionType: "essential" | "advisable" | "good_practice";
  target: string;
  achievementMethod: string;
  ownerStaffId: string;
  ownerName?: string;
  dueDate: string;
  centralActionId?: string;
};

export type UcoTlaFollowUp = {
  followUpType: "discussion" | "observation";
  scheduledAt: string;
  status: "scheduled" | "completed" | "cancelled";
  outcomeNotes?: string;
  linkedReviewRecordId?: string;
  completedAt?: string;
  rowVersion: string;
};

export type UcoTlaReviewDetail = {
  review: UcoTlaReviewSummary;
  formSubmissionId: string;
  sessionType?: string;
  courseLevel?: string;
  numberRegistered?: number;
  numberPresent?: number;
  numberLate?: number;
  responses: Record<string, string | undefined>;
  actionPlan: UcoTlaActionPlan[];
  followUp?: UcoTlaFollowUp;
  probationObservationId?: string;
  parentReviewRecordId?: string;
  sectionCompletion: Record<string, boolean>;
  lecturerAcknowledgedAt?: string;
  lecturerSignatoryName?: string;
  observerSignedAt?: string;
  observerSignatoryName?: string;
  reopenedAt?: string;
  reopenReason?: string;
};

export type UcoTlaDashboardSummary = {
  reviewsThisYear: number;
  completedReviews: number;
  activeUcoStaff: number;
  coveredUcoStaff: number;
  coveragePercent: number;
  awaitingLecturer: number;
  followUpsDue: number;
  openActions: number;
  overdueActions: number;
  practiceHighlights: {
    recordId: string;
    lecturerName: string;
    courseTitle: string;
    moduleTitle: string;
    observationAt: string;
    category: string;
    narrative: string;
  }[];
  reviews: UcoTlaReviewSummary[];
};

export type CreateUcoTlaReviewRequest = {
  lecturerStaffId: string;
  observerStaffId: string;
  academicYear: string;
};

export type SaveUcoTlaObserverSectionRequest = {
  observationAt: string;
  sessionType: string;
  courseTitle: string;
  moduleTitle: string;
  courseLevel: string;
  numberRegistered?: number;
  numberPresent?: number;
  numberLate?: number;
  responses: Record<string, string | undefined>;
  actionPlan: UcoTlaActionPlan[];
  professionalDiscussionAt?: string;
  followUp?: Omit<UcoTlaFollowUp, "rowVersion" | "linkedReviewRecordId" | "completedAt">;
  rowVersion: string;
  sectionKey?: string;
  isSectionComplete?: boolean;
};

export type QaCapabilities = {
  canConfigure: boolean;
  canSubmitEvidence: boolean;
  canCorrectEvidence: boolean;
  canRemoveEvidence: boolean;
  canClose: boolean;
  canReopen: boolean;
  canArchive: boolean;
  canExport: boolean;
  canManageActions: boolean;
};

export type QaReviewSummary = {
  id: string;
  title: string;
  academicYear: string;
  theme: string;
  status: "draft" | "open" | "closed" | "reopened" | "archived";
  plannedOpenDate?: string;
  closingDate: string;
  ownerName: string;
  teamCount: number;
  activityCount: number;
  evidenceCount: number;
  rowVersion: string;
  capabilities: QaCapabilities;
};

export type QaHubSummary = {
  canAccessHub: boolean;
  canManageReviews: boolean;
  canMonitorActions: boolean;
  openReviewCount: number;
  accessibleReviewCount: number;
  reviews: QaReviewSummary[];
};

export type QaQuestionSummary = {
  id: string;
  activityTypeId: string;
  activityKey: string;
  activityName: string;
  versionNumber: number;
  themeOrWeek?: string;
  questionText: string;
  guidance?: string;
  displayOrder: number;
  isRequired: boolean;
  allowsNotApplicable: boolean;
  commentRequiredAtExpected: boolean;
  isActive: boolean;
  sourceStatus: "active" | "draft" | "inactive" | "frozen";
  questionTag: string;
  createdAt: string;
};

export type QaActivityTemplateSummary = {
  id: string;
  activityTypeId: string;
  templateKey: string;
  name: string;
  description?: string;
  isActive: boolean;
  questionCount: number;
  rowVersion: string;
};

export type QaActivityTypeSummary = {
  id: string;
  activityKey: string;
  name: string;
  description?: string;
  displayOrder: number;
  isActive: boolean;
  templates: QaActivityTemplateSummary[];
};

export type QaScopeSummary = {
  orgUnitId: string;
  scopeType: "faculty" | "team";
  code: string;
  name: string;
  parentOrgUnitId?: string;
  parentCode?: string;
  parentName?: string;
};

export type QaReviewActivitySummary = {
  id: string;
  activityTypeId: string;
  activityKey: string;
  name: string;
  templateId: string;
  templateName: string;
  displayOrder: number;
  questions: QaQuestionSummary[];
};

export type QaEvidenceSummary = {
  id: string;
  reviewId: string;
  reviewActivityId: string;
  activityName: string;
  status: "draft" | "submitted";
  teamOrgUnitId: string;
  facultyName: string;
  teamName: string;
  courseProgramme?: string;
  courseLevel?: string;
  subjectStaffName?: string;
  reviewerStaffId: string;
  reviewerName: string;
  activityAt: string;
  sampleSize?: number;
  responseCount: number;
  submittedAt?: string;
  versionNumber: number;
  rowVersion: string;
  canEdit: boolean;
  canRemove: boolean;
};

export type QaCloseValidationSummary = {
  activitiesWithoutEvidence: string[];
  teamsWithoutEvidence: string[];
  draftSubmissionCount: number;
  missingRequiredResponseCount: number;
  evidenceCount: number;
  ratedResponseCount: number;
  sampleCount: number;
};

export type QaReviewDetail = {
  review: QaReviewSummary;
  questionTag: string;
  ownerStaffId: string;
  scope: QaScopeSummary[];
  activities: QaReviewActivitySummary[];
  evidence: QaEvidenceSummary[];
  closeValidation?: QaCloseValidationSummary;
};

export type SaveQaReviewRequest = {
  title: string;
  academicYear: string;
  theme: string;
  questionTag: string;
  ownerStaffId: string;
  plannedOpenDate?: string;
  closingDate: string;
  teamOrgUnitIds: string[];
  activities: { activityTypeId: string; templateId: string; questionIds: string[] }[];
  rowVersion?: string;
};

export type QaEvidenceResponseSummary = {
  reviewQuestionId: string;
  themeOrWeek?: string;
  questionText: string;
  guidance?: string;
  displayOrder: number;
  isRequired: boolean;
  allowsNotApplicable: boolean;
  commentRequiredAtExpected: boolean;
  outcome?: "below" | "at" | "above" | "not_applicable";
  comment?: string;
  notApplicableReason?: string;
};

export type QaEvidenceRevisionSummary = { versionNumber: number; reason?: string; createdBy: string; createdAt: string };

export type QaEvidenceDetail = {
  evidence: QaEvidenceSummary;
  teamOrgUnitIds: string[];
  teamNames: string[];
  contextualNotes?: string;
  evidenceLinks: string[];
  keyStrengths?: string;
  areasForImprovement?: string;
  recommendedActions?: string;
  additionalContext?: string;
  subjectStaffId?: string;
  responses: QaEvidenceResponseSummary[];
  revisions: QaEvidenceRevisionSummary[];
};

export type SaveQaEvidenceRequest = {
  reviewActivityId: string;
  teamOrgUnitId: string;
  teamOrgUnitIds?: string[];
  courseProgramme?: string;
  courseLevel?: string;
  subjectStaffId?: string;
  activityAt: string;
  sampleSize?: number;
  contextualNotes?: string;
  evidenceLinks?: string[];
  keyStrengths?: string;
  areasForImprovement?: string;
  recommendedActions?: string;
  additionalContext?: string;
  responses: { reviewQuestionId: string; outcome?: string; comment?: string; notApplicableReason?: string }[];
  correctionReason?: string;
  rowVersion?: string;
};

export type QaDashboardBreakdown = { key: string; label: string; below: number; at: number; above: number; notApplicable: number; rated: number; atOrAbovePercentage: number };
export type QaDashboardQuestionBreakdown = { activityKey: string; activityLabel: string; questionId: string; themeOrWeek?: string; questionText: string; below: number; at: number; above: number; notApplicable: number; rated: number; belowPercentage: number; atPercentage: number; abovePercentage: number };
export type QaDashboardSummary = {
  reviewId: string;
  evidenceCount: number;
  facultyCount: number;
  teamCount: number;
  courseCount: number;
  sampleCount: number;
  belowCount: number;
  atCount: number;
  aboveCount: number;
  notApplicableCount: number;
  ratedCount: number;
  atOrAbovePercentage: number;
  byActivity: QaDashboardBreakdown[];
  questions: QaDashboardQuestionBreakdown[];
  byTeam: QaDashboardBreakdown[];
  byTheme: QaDashboardBreakdown[];
  timeline: { date: string; evidenceCount: number; responseCount: number }[];
  teamsWithoutEvidence: string[];
  linkedActionCount: number;
  openActionCount: number;
  snapshotVersion: number;
};

export type QaAuditSummary = { id: string; action: string; summary?: string; reason?: string; actorName: string; createdAt: string };

export type QaActionOwnerOption = { staffId: string; displayName: string };
export type QaActionTeamOption = { teamOrgUnitId: string; teamName: string; programmeLeader?: QaActionOwnerOption };
export type QaActionFacultyOption = {
  facultyOrgUnitId: string;
  facultyName: string;
  headOfFaculty?: QaActionOwnerOption;
  teams: QaActionTeamOption[];
};
export type QaReviewActionOptions = {
  reviewId: string;
  reviewTitle: string;
  creationMode: "admin" | "review_owner" | "hof" | "pl";
  canCreateWholeReview: boolean;
  faculties: QaActionFacultyOption[];
};
export type QaActionAssignmentSummary = {
  actionId: string;
  staffId: string;
  staffName: string;
  assignmentRole: "hof" | "pl";
  sourceOrgUnitId: string;
  sourceOrgUnitName: string;
  status: string;
  completedDate?: string;
};
export type QaActionGroupSummary = {
  id: string;
  reviewId: string;
  reviewTitle: string;
  facultyOrgUnitId?: string;
  facultyName: string;
  teamOrgUnitIds: string[];
  teamNames: string[];
  title: string;
  detail?: string;
  dueDate: string;
  status: "open" | "overdue" | "reviewed" | "closed";
  createdAt: string;
  creatorStaffId?: string;
  creatorName: string;
  reviewedAt?: string;
  closedAt?: string;
  closeNote?: string;
  assignments: QaActionAssignmentSummary[];
  rowVersion: string;
  canReview: boolean;
  canClose: boolean;
};
export type CreateQaActionGroupRequest = {
  facultyOrgUnitId?: string;
  teamOrgUnitIds: string[];
  title: string;
  detail?: string;
  dueDate: string;
  wholeReview?: boolean;
};

export type DashboardActionSummary = Pick<ActionSummary,
  | "id"
  | "sourceRecordId"
  | "sourceFormType"
  | "subjectStaffName"
  | "ownerStaffId"
  | "ownerStaffName"
  | "actionTheme"
  | "title"
  | "statusKey"
  | "dueDate"
  | "completedDate"
  | "isOverdue"
  | "createdAt"
  | "facultyCode"
  | "teamCode"
  | "isDeleted"
>;

export type ActionVisibility = "owner_only" | "staff_and_management" | "management_only" | "source_editors";

export type CreateActionRequest = {
  sourceRecordId?: string;
  subjectStaffId?: string;
  ownerStaffId: string;
  actionTheme: string;
  title: string;
  detail?: string;
  priorityLookupValueId?: string;
  statusLookupValueId?: string;
  dueDate?: string;
  publishedToStaff: boolean;
  livVisitId?: string;
  livCycleId?: string;
  sourceFormType?: string;
  sourceSubRecordType?: string;
  sourceSubRecordId?: string;
  sourceSubRecordKey?: string;
  visibilitySetting?: ActionVisibility;
};

export type UpdateActionRequest = {
  actionTheme?: string;
  title?: string;
  detail?: string;
  dueDate?: string;
  status?: "complete" | "open" | "cancelled";
  completionNote?: string;
  ownerStaffId?: string;
  visibilitySetting?: ActionVisibility;
  cancellationComments?: string;
};

export type ExtendActionRequest = {
  dueDate: string;
  reason: string;
};

export type ActionExtensionSummary = {
  id: string;
  previousDueDate: string;
  extendedDueDate: string;
  reason: string;
  createdByName?: string;
  createdAt: string;
};

export type ActionOwnerOption = {
  staffId: string;
  displayName: string;
  relationship: string;
  orgUnitId?: string;
  orgUnitCode?: string;
};

export type RecordSummary = {
  id: string;
  moduleId: string;
  recordType: string;
  title: string;
  subjectStaffId?: string;
  ownerStaffId?: string;
  orgUnitId?: string;
  recordDate?: string;
  createdAt: string;
  submissionStatus: string;
  academicYear: string;
  isCreatedByCurrentUser: boolean;
};

export type LivVisitSummary = {
  id: string;
  visitNumber: number;
  visitDate?: string;
  visitTime?: string;
  visitType: "initial" | "follow_up";
  courseName?: string;
  courseLevel?: string;
  reflectionNotes?: string;
  findings?: string;
  visitStatus: "in_progress" | "completed";
  createdAt: string;
  updatedAt?: string;
  cycleId?: string;
  ratings: LivVisitRating[];
  deliveryAreaKey?: string;
  deliveryAreaName?: string;
};

export type LivLookupOption = { key: string; name: string; displayOrder: number; isOther?: boolean };
export type LivVisitRating = { focusKey: string; focusName: string; descriptorId?: string; descriptor?: string; isNotApplicable: boolean };
export type LivStage = {
  id: string;
  stageType: "pre_discussion" | "distance_impact" | "visit" | "post_reflection" | "actions" | "follow_up_review";
  stageOrder: number;
  stageStatus: "in_progress" | "completed" | "not_applicable";
  contextText?: string;
  aimsText?: string;
  learnerActivityText?: string;
  reflectionText?: string;
  intendedFollowUpDate?: string;
  distanceImpactText?: string;
  developmentOpportunityKeys: string[];
  visitId?: string;
  canEdit: boolean;
};
export type LivCycle = {
  id: string;
  cycleNumber: number;
  status: "in_progress" | "completed";
  startedAt: string;
  completedAt?: string;
  isFollowUp: boolean;
  stages: LivStage[];
};
export type LivConfiguration = {
  deliveryAreas: LivLookupOption[];
  courseLevels: LivLookupOption[];
  focusAreas: LivLookupOption[];
  developmentOpportunities: LivLookupOption[];
  rubric: ElevatePracticeRatingScale[];
};
export type LivStaffContext = {
  staffId: string;
  staffName: string;
  assessmentId?: string;
  academicYear?: string;
  primaryFocusKey?: string;
  primaryFocus?: string;
  desiredOutcome?: string;
  existingLivRecordId?: string;
  existingLivSourceRecordId?: string;
  preferredVisitMonth?: string;
  secondaryFocusKey?: string;
  secondaryFocus?: string;
  secondaryFocusOther?: string;
};

export type LivRecordSummary = {
  id: string;
  recordId: string;
  subjectStaffId: string;
  subjectStaffName: string;
  reviewerStaffId?: string;
  reviewerStaffName?: string;
  orgUnitId?: string;
  orgUnitCode?: string;
  parentOrgUnitCode?: string;
  preConversation?: string;
  status: "in_progress" | "closed";
  currentStage: string;
  visibilityStatus: "staff_visible";
  completionDate?: string;
  createdAt: string;
  updatedAt?: string;
  canEdit: boolean;
  canViewSensitive: boolean;
  isElevatePractitioner?: boolean;
  areaOfPracticeKeys: string[];
  areaOfPracticeThemeIds: string[];
  areaOfPracticeOther?: string;
  visits: LivVisitSummary[];
  deliveryAreaKey?: string;
  deliveryAreaName?: string;
  sourceElevateAssessmentId?: string;
  eliPrimaryFocusKey?: string;
  eliPrimaryFocus?: string;
  eliDesiredOutcome?: string;
  cycles: LivCycle[];
  eliPreferredVisitMonth?: string;
  eliSecondaryFocusKey?: string;
  eliSecondaryFocus?: string;
  eliSecondaryFocusOther?: string;
  linkedProbationCaseId?: string;
  probationObservationNumber?: number;
  isCreatedByCurrentUser: boolean;
};

export type SaveLivVisitRequest = {
  visitDate?: string;
  visitTime?: string;
  courseName?: string;
  courseLevel?: string;
  reflectionNotes?: string;
  findings?: string;
  deliveryAreaKey?: string;
  ratings?: Array<{ focusKey: string; descriptorId?: string; isNotApplicable: boolean }>;
};

export type SaveLivRecordRequest = {
  subjectStaffId: string;
  orgUnitId?: string;
  deliveryAreaKey?: string;
  preConversation?: string;
  initialVisit?: SaveLivVisitRequest;
  isElevatePractitioner?: boolean;
  areaOfPracticeKeys: string[];
  areaOfPracticeThemeIds: string[];
  areaOfPracticeOther?: string;
};

export type SaveLivStageRequest = {
  stageType: LivStage["stageType"];
  contextText?: string;
  aimsText?: string;
  learnerActivityText?: string;
  reflectionText?: string;
  intendedFollowUpDate?: string;
  distanceImpactText?: string;
  developmentOpportunityKeys: string[];
  stageStatus?: LivStage["stageStatus"];
};

export type ProbationReviewerOption = {
  staffId: string;
  displayName: string;
  email: string;
  reviewerType: "teaching_learning" | "leader";
};

export type ProbationConfiguration = LivConfiguration & {
  teachingLearningReviewers: ProbationReviewerOption[];
  eligibleStaff: StaffSummary[];
  canCreateCase: boolean;
};

export type ProbationStaffContext = {
  staffId: string;
  staffName: string;
  assessmentId?: string;
  assessmentRecordId?: string;
  academicYear?: string;
  primaryFocus?: string;
  secondaryFocus?: string;
  desiredOutcome?: string;
  hasProbationCaseForAcademicYear: boolean;
};

export type ProbationReviewer = {
  staffId: string;
  displayName: string;
  reviewerRole: "teaching_learning" | "leader";
};

export type ProbationRating = {
  focusKey: string;
  focusName: string;
  descriptorId: string;
  descriptor: string;
  evidenceOfPractice?: string;
};

export type ProbationVisit = {
  deliveryAreaKey?: string;
  deliveryAreaName?: string;
  observationDate?: string;
  observationTime?: string;
  courseName?: string;
  courseGroup?: string;
  courseLevel?: string;
  keyPoints?: string;
  unobservedFocusKeys: string[];
  ratings: ProbationRating[];
};

export type ProbationStage = {
  id: string;
  stageType: "professional_discussion" | "visit_rubric" | "reflection_feedback" | "actions" | "next_observation";
  stageOrder: number;
  stageStatus: "in_progress" | "completed";
  contextText?: string;
  aimsText?: string;
  learnerActivityText?: string;
  reflectionText?: string;
  developmentOpportunityKeys: string[];
  intendedNextObservationDate?: string;
  canEdit: boolean;
};

export type ProbationObservation = {
  id: string;
  observationNumber: 1 | 2 | 3;
  observationType: "probation" | "liv" | "uco_tla";
  status: "not_started" | "in_progress" | "completed";
  linkedLivRecordId?: string;
  linkedLivSourceRecordId?: string;
  linkedUcoTlaReviewId?: string;
  startedAt?: string;
  completedAt?: string;
  stages: ProbationStage[];
  visit?: ProbationVisit;
};

export type ProbationCase = {
  id: string;
  recordId: string;
  subjectStaffId: string;
  subjectStaffName: string;
  orgUnitId?: string;
  orgUnitCode?: string;
  parentOrgUnitCode?: string;
  academicYear: string;
  status: "in_progress" | "completed";
  currentObservationNumber: 1 | 2 | 3;
  sourceElevateAssessmentId?: string;
  sourceElevateRecordId?: string;
  createdAt: string;
  updatedAt?: string;
  canEdit: boolean;
  isCreatedByCurrentUser: boolean;
  reviewers: ProbationReviewer[];
  observations: ProbationObservation[];
};

export type CreateProbationCaseRequest = {
  subjectStaffId: string;
  teachingLearningReviewerStaffId?: string;
  orgUnitId?: string;
};

export type SaveProbationStageRequest = {
  contextText?: string;
  aimsText?: string;
  learnerActivityText?: string;
  reflectionText?: string;
  developmentOpportunityKeys: string[];
  intendedNextObservationDate?: string;
  stageStatus?: "in_progress" | "completed";
};

export type SaveProbationVisitRequest = {
  deliveryAreaKey?: string;
  observationDate?: string;
  observationTime?: string;
  courseName?: string;
  courseGroup?: string;
  courseLevel?: string;
  keyPoints?: string;
  unobservedFocusKeys: string[];
  ratings: Array<{ focusKey: string; descriptorId: string; evidenceOfPractice?: string }>;
  stageStatus?: "in_progress" | "completed";
};

export type RecordDetail = {
  id: string;
  moduleKey: string;
  moduleName: string;
  recordType: string;
  title: string;
  summary?: string;
  orgUnitId?: string;
  orgUnitCode?: string;
  orgUnitName?: string;
  parentOrgUnitCode?: string;
  recordDate?: string;
  createdAt: string;
  ownerDisplayName?: string;
  submissionId: string;
  templateKey: string;
  templateName: string;
  templateVersion: string;
  submissionStatus: string;
  submittedAt?: string;
  archivedAt?: string;
  canEdit: boolean;
  courseIds: string[];
  sections: RecordDetailSection[];
};

export type AdminWorkScrutinyRecord = {
  id: string;
  title: string;
  summary?: string;
  orgUnitId?: string;
  orgUnitCode?: string;
  orgUnitName?: string;
  parentOrgUnitCode?: string;
  recordDate?: string;
  createdAt: string;
  ownerDisplayName?: string;
  submissionId: string;
  submissionStatus: string;
  archivedAt?: string;
  openActionCount: number;
  completedActionCount: number;
};

export type RecordAudit = {
  id: string;
  action: string;
  summary?: string;
  actorName: string;
  beforeJson?: string;
  afterJson?: string;
  reason?: string;
  createdAt: string;
};

export type AdminWorkScrutinyAction = {
  id: string;
  title: string;
  ownerDisplayName?: string;
  dueDate?: string;
  completedDate?: string;
  statusKey?: string;
  archivedAt?: string;
};

export type RecordDetailSection = {
  id: string;
  sectionKey: string;
  title: string;
  displayOrder: number;
  fields: RecordDetailField[];
};

export type RecordDetailField = FormFieldDefinition & {
  value?: string;
};

export type LearningWalkRollupSummary = {
  facultyOrgUnitId?: string;
  facultyCode?: string;
  facultyName?: string;
  childOrgUnitId?: string;
  childCode?: string;
  childName?: string;
  recordCount: number;
  latestRecordDate?: string;
};

export type DashboardSummary = {
  id: string;
  dashboardKey: string;
  name: string;
  purpose?: string;
  primaryPermissionKey: string;
  facultyScopeRequired: boolean;
};

export type ProcessDashboardRecordSummary = {
  id: string;
  processKey: "learning_walk" | "als_learning_walk" | "liv" | "als_liv" | "eli" | "work_scrutiny" | "cpd_event" | "elevate_environment" | "coaching_session" | "probation_case";
  title: string;
  summary?: string;
  recordDate?: string;
  createdAt: string;
  status: string;
  orgUnitId?: string;
  areaCode?: string;
  areaName?: string;
  parentAreaCode?: string;
  ownerDisplayName?: string;
  subjectDisplayName?: string;
  theme?: string;
  detail?: string;
  participantAreaBreakdown?: string;
  participantCount: number;
  attendanceCredits: number;
  learningMinutes: number;
  sampleSize: number;
  scoreTotal: number;
  scoreCount: number;
  barrierCount: number;
  scoreMaximum: number;
  relatedRecordId?: string;
  subjectStaffId?: string;
  academicYear?: string;
};

export type DashboardProcessConfiguration = {
  processKey: "overview" | "learning_walk" | "als_learning_walk" | "liv" | "als_liv" | "eli" | "probation_case" | "elevate_environment" | "coaching_session" | "work_scrutiny" | "cpd_event" | "elevate_status" | "actions";
  label: string;
  isEnabled: boolean;
  displayOrder: number;
  primaryVisual: "bar" | "donut";
  showTrend: boolean;
  showAreaComparison: boolean;
  showOutcomes: boolean;
  showActions: boolean;
};

export type DashboardConfiguration = {
  schemaVersion: number;
  updatedAt?: string;
  processes: DashboardProcessConfiguration[];
};

export type DashboardDimensionFact = {
  sourceRecordId: string;
  processKey: Exclude<DashboardProcessConfiguration["processKey"], "overview" | "actions">;
  occurredOn: string;
  orgUnitId?: string;
  areaCode?: string;
  areaName?: string;
  parentAreaCode?: string;
  dimensionKey: string;
  seriesKey: string;
  seriesLabel: string;
  valueKey: string;
  valueLabel: string;
  numericValue?: number;
};

export type ElevateStatusDashboardSummary = {
  orgUnitId?: string;
  areaCode?: string;
  areaName?: string;
  parentAreaCode?: string;
  staffCount: number;
  level1OrAbove: number;
  level2OrAbove: number;
  level3OrAbove: number;
  level4OrAbove: number;
  level5OrAbove: number;
};

export type StaffParticipationDashboardSummary = {
  processKey: "eli" | "liv" | "cpd_event" | "coaching_session";
  orgUnitId?: string;
  areaCode?: string;
  areaName?: string;
  parentAreaCode?: string;
  activeStaffCount: number;
  participatingStaffCount: number;
};

export type CpdAttendanceDashboardSummary = {
  staffId: string;
  staffName: string;
  orgUnitId?: string;
  areaCode?: string;
  areaName?: string;
  parentAreaCode?: string;
  attendanceCount: number;
};

export type LivLifecycleDashboardSummary = {
  orgUnitId?: string;
  areaCode?: string;
  areaName?: string;
  parentAreaCode?: string;
  requestedCount: number;
  caseStartedCount: number;
  scheduledCount: number;
  visitedCount: number;
  completedCount: number;
  completedVisitCount: number;
  practitionerStaffCount: number;
  practitionerStaffDenominator: number;
};

export type RecordNavigation = {
  id: string;
  recordType: string;
  subjectStaffId?: string;
};

export type StaffProfileSummary = {
  staffId: string;
  externalId: string;
  displayName: string;
  email: string;
  jobTitle?: string;
  primaryOrgCode?: string;
  cpdSessionsAttended: number;
  evidenceRecords: number;
  openActions: number;
  overdueActions: number;
};

export type StaffProfileRecordSummary = {
  staffId: string;
  externalId: string;
  displayName: string;
  email: string;
  jobTitle?: string;
  primaryOrgCode?: string;
  accountStatus: string;
  reflectionCount: number;
  submittedReflections: number;
  draftReflections: number;
  openActions: number;
};

export type StaffReflectionFocusAreaSummary = {
  focusLookupValueId?: string;
  focusKeySnapshot: string;
  textSnapshot: string;
  focusType: "primary" | "secondary";
  displayOrder: number;
};

export type StaffReflectionSummary = {
  id: string;
  staffId: string;
  elevatePracticeAssessmentId: string;
  elevatePracticeRecordId: string;
  elevatePracticeAcademicYear: string;
  reflectionDate: string;
  progress?: string;
  impact?: string;
  examples?: string;
  status: "draft" | "submitted";
  focusAreas: StaffReflectionFocusAreaSummary[];
  createdByUserAccountId?: string;
  createdByName?: string;
  createdAt: string;
  updatedByUserAccountId?: string;
  updatedByName?: string;
  updatedAt?: string;
};

export type SaveStaffReflectionRequest = {
  reflectionDate: string;
  progress?: string;
  impact?: string;
  examples?: string;
  status: "draft" | "submitted";
};

export type StaffCpdRecordSummary = {
  id: string;
  recordId: string;
  title: string;
  eventDate: string;
  themes?: string;
  durationMinutes?: number;
  isInternal: boolean;
};

export type ElevateStatusCpdSummary = {
  cpdEventId: string;
  title: string;
  eventDate: string;
};

export type ElevateStatusLevelSummary = {
  levelNumber: number;
  levelKey: "explorer" | "storyteller" | "innovator" | "champion" | "changemaker";
  name: string;
  requiredSessions: number;
  requirementLabel?: string;
  isEligible: boolean;
  isConfirmed: boolean;
  isAwarded: boolean;
  evidenceCpdEventId?: string;
  implementationImpact?: string;
  attendanceCountAtAward?: number;
  awardedAt?: string;
  awardedByName?: string;
  customBadgeAssetId?: string;
};

export type ElevateStatusBadgeAssetSummary = {
  academicYear: string;
  levelNumber: number;
  levelKey: ElevateStatusLevelSummary["levelKey"];
  levelName: string;
  defaultAssetPath: string;
  customAssetId?: string;
  fileName?: string;
  contentType?: string;
  contentLength?: number;
  uploadedAt?: string;
  uploadedByName?: string;
};

export type ElevateStatusSummary = {
  staffId: string;
  academicYear: string;
  internalCpdSessionsAttended: number;
  canSubmitExplorerEvidence: boolean;
  canManageControlledLevels: boolean;
  eligibleInternalCpd: ElevateStatusCpdSummary[];
  levels: ElevateStatusLevelSummary[];
};

export type SaveElevateStatusLevelRequest = {
  academicYear: string;
  confirmed: boolean;
  evidenceCpdEventId?: string;
  implementationImpact?: string;
};

export type StaffProfileActionSummary = {
  id: string;
  title: string;
  detail?: string;
  createdAt: string;
  sourceRecordId?: string;
  sourceRecordTitle?: string;
  sourceRecordType?: string;
  sourceModuleName?: string;
  ownerName: string;
  statusKey?: string;
  dueDate?: string;
  completedDate?: string;
  isOverdue: boolean;
};

export type StaffProfileCoachingSummary = {
  id: string;
  recordId: string;
  cycleNumber: number;
  sessionNumber: number;
  sessionDate: string;
  sessionType: CoachingSessionType;
  status: "draft" | "completed";
  coachName: string;
  primaryFocus?: string;
  specificSessionFocus?: string;
};

export type ElevatePracticeRatingScale = {
  id: string;
  descriptorKey: string;
  descriptor: string;
  meaning: string;
  displayOrder: number;
  colourClassification?: string;
  colorHex?: string;
  isActive: boolean;
};

export type ElevatePracticeSupportOption = {
  key: string;
  name: string;
};

export type ElevatePracticeStatement = {
  id: string;
  statementKey: string;
  text: string;
  displayOrder: number;
  descriptorId?: string;
};

export type ElevatePracticeArea = {
  id: string;
  areaKey: string;
  category: string;
  name: string;
  reflectionPrompt: string;
  displayOrder: number;
  descriptorId?: string;
  judgement?: string;
  reflection?: string;
  statements: ElevatePracticeStatement[];
};

export type ElevatePracticePlan = {
  areaKey: string;
  developmentApproach: string;
  supportKeys: string[];
  supportDetails: string;
  successEvidence: string;
  intendedImpact: string;
  actionId?: string;
};

export type ElevatePracticeWorkspace = {
  academicYear: string;
  assessmentId?: string;
  recordId?: string;
  status: "not_started" | "draft" | "submitted";
  submittedAt?: string;
  staffId: string;
  staffName: string;
  facultyName?: string;
  teamName?: string;
  canEdit: boolean;
  overallJudgement?: string;
  ratingScale: ElevatePracticeRatingScale[];
  supportOptions: ElevatePracticeSupportOption[];
  areas: ElevatePracticeArea[];
  strengthAreaKeys: string[];
  developmentAreaKeys: string[];
  suggestedStrengthAreaKeys: string[];
  suggestedDevelopmentAreaKeys: string[];
  developmentPlans: ElevatePracticePlan[];
  livInformation: ElevateLivInformation;
};

export type PagedResult<T> = {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
};

export type StaffProfileSectionSummary = {
  reflectionCount: number;
  submittedReflectionCount: number;
  coachingCount: number;
  cpdCount: number;
  internalCpdCount: number;
  externalCpdCount: number;
  totalCpdMinutes: number;
  openActionCount: number;
  completedActionCount: number;
  overdueActionCount: number;
  livCount: number;
  probationCount: number;
};

export type StaffProfileLivSummary = {
  id: string;
  recordId: string;
  title: string;
  recordDate?: string;
  reviewerName?: string;
  parentOrgUnitCode?: string;
  orgUnitCode?: string;
  currentStage: string;
  status: "in_progress" | "closed";
  createdAt: string;
  updatedAt?: string;
  processKey: "liv" | "als_liv";
};

export type StaffProfileProbationSummary = {
  id: string;
  recordId: string;
  title: string;
  academicYear: string;
  status: "in_progress" | "completed" | "closed";
  currentObservationNumber: number;
  parentOrgUnitCode?: string;
  orgUnitCode?: string;
  createdAt: string;
  updatedAt?: string;
};

export type ElevateLookupOption = { key: string; name: string; displayOrder: number; isOther?: boolean };
export type ElevateLivInformation = {
  preferredVisitMonth?: string;
  primaryFocusKey?: string;
  secondaryFocusKey?: string;
  secondaryFocusOther?: string;
  desiredOutcome?: string;
  focusOptions: ElevateLookupOption[];
};

export type SaveElevatePracticeAssessmentRequest = {
  ratings: Array<{ areaId: string; statementId: string; descriptorId: string }>;
  reflections: Array<{ areaKey: string; text: string }>;
  livInformation: Omit<ElevateLivInformation, "focusOptions">;
  submit: boolean;
};

export type AdminSaveElevatePracticeAssessmentRequest = Omit<SaveElevatePracticeAssessmentRequest, "submit"> & {
  status: "draft" | "submitted";
};

export type ElevatePracticeAudit = {
  id: string;
  action: string;
  summary?: string;
  actorName: string;
  beforeJson?: string;
  afterJson?: string;
  createdAt: string;
};

export type ElevatePracticeProgress = {
  assessmentId?: string;
  recordId?: string;
  staffId: string;
  externalId: string;
  staffName: string;
  email: string;
  facultyCode?: string;
  facultyName?: string;
  teamCode?: string;
  teamName?: string;
  academicYear: string;
  status: "not_started" | "draft" | "submitted";
  updatedAt?: string;
  submittedAt?: string;
};

export type CoachingCycleSummary = {
  id: string;
  cycleNumber: number;
  cycleType: CoachingSessionType;
  status: "active" | "closed";
  startedOn: string;
  closedOn?: string;
  coachStaffId: string;
  coachName: string;
  sessionCount: number;
};

export type CoachingPreviousActionSummary = {
  actionId: string;
  actionTheme: string;
  title: string;
  ownerType: CoachingActionOwner;
  ownerName: string;
  dueDate?: string;
  reviewDate?: string;
  status: CoachingActionStatus;
  intendedEvidence?: string;
  intendedImpact?: string;
  latestProgressUpdate?: string;
  latestImpactObserved?: string;
};

export type CoachingLookupOption = {
  id: string;
  valueKey: string;
  displayName: string;
  displayOrder: number;
};

export type CoachingRubricOption = {
  id: string;
  descriptorKey: string;
  visibleWording: string;
  guidanceText: string;
  displayOrder: number;
  colourClassification?: string;
  colorHex?: string;
};

export type CoachingConfiguration = {
  qualificationStatuses: CoachingLookupOption[];
  focusAreas: CoachingLookupOption[];
  supportTypes: CoachingLookupOption[];
  currentPracticeRubric: CoachingRubricOption[];
  maxActionsPerSession: number;
};

export type CoachingContext = {
  staffId: string;
  staffName: string;
  coachStaffId: string;
  coachName: string;
  coachSource: "assigned" | "line_manager" | "current_user" | "cycle";
  cycles: CoachingCycleSummary[];
  selectedCycleId?: string;
  nextSessionNumber: number;
  previousActions: CoachingPreviousActionSummary[];
};

export type CoachingSessionType = "coaching" | "mentoring";
export type CoachingActionOwner = "staff" | "coach" | "joint";
export type CoachingActionStatus = "not_started" | "in_progress" | "completed" | "closed";
export type CoachingReviewOutcome = "completed" | "continue" | "revised" | "closed_without_completion";

export type CoachingSessionSummary = {
  id: string;
  recordId: string;
  cycleId: string;
  cycleNumber: number;
  staffId: string;
  staffName: string;
  coachStaffId: string;
  coachName: string;
  sessionNumber: number;
  sessionDate: string;
  sessionType: CoachingSessionType;
  status: "draft" | "completed";
  primaryFocus?: string;
  createdAt: string;
  updatedAt?: string;
  canEdit: boolean;
  isCreatedByCurrentUser: boolean;
};

export type CoachingSessionAction = {
  id?: string;
  actionOrder: number;
  actionTheme: string;
  actionText: string;
  ownerType: CoachingActionOwner;
  ownerName?: string;
  dueDate?: string;
  intendedEvidence?: string;
  intendedImpact?: string;
  reviewDate?: string;
  status: CoachingActionStatus;
  parentActionId?: string;
};

export type CoachingActionReview = {
  actionId: string;
  reviewOutcome?: CoachingReviewOutcome;
  progressUpdate?: string;
  impactObserved?: string;
  revisedAction?: CoachingSessionAction;
};

export type CoachingSessionDetail = {
  id: string;
  recordId: string;
  cycleId: string;
  cycleNumber: number;
  staffId: string;
  staffName: string;
  coachStaffId: string;
  coachName: string;
  sessionNumber: number;
  sessionDate: string;
  sessionType: CoachingSessionType;
  deliveryMethod?: "in_person" | "online" | "telephone";
  durationMinutes?: number;
  status: "draft" | "completed";
  qualificationStatusKey?: string;
  primaryFocusKey?: string;
  secondaryFocusKey?: string;
  focusOtherText?: string;
  specificSessionFocus?: string;
  currentPracticeDescriptorId?: string;
  currentPracticeWording?: string;
  currentPracticeEvidence?: string;
  supportTypes: string[];
  supportOtherText?: string;
  conversationSummary?: string;
  closesCycle: boolean;
  completedAt?: string;
  canEdit: boolean;
  previousActions: CoachingPreviousActionSummary[];
  actionReviews: CoachingActionReview[];
  actions: CoachingSessionAction[];
};

export type SaveCoachingSessionRequest = {
  staffId: string;
  cycleId?: string;
  createNewCycle: boolean;
  sessionDate: string;
  sessionType: CoachingSessionType;
  deliveryMethod?: "in_person" | "online" | "telephone";
  durationMinutes?: number;
  status: "draft" | "completed";
  qualificationStatusKey?: string;
  primaryFocusKey?: string;
  secondaryFocusKey?: string;
  focusOtherText?: string;
  specificSessionFocus?: string;
  currentPracticeDescriptorId?: string;
  currentPracticeEvidence?: string;
  supportTypes: string[];
  supportOtherText?: string;
  conversationSummary?: string;
  closeCycle: boolean;
  actionReviews: CoachingActionReview[];
  actions: CoachingSessionAction[];
};

export type CoachingSessionSaveSummary = {
  id: string;
  recordId: string;
  cycleId: string;
  cycleNumber: number;
  sessionNumber: number;
  status: "draft" | "completed";
};

export type StaffElevatePracticeSummary = {
  assessmentId: string;
  recordId: string;
  academicYear: string;
  status: "draft" | "submitted";
  judgement?: string;
  submittedAt?: string;
  focusAreas: StaffElevateFocusAreaSummary[];
};

export type StaffElevateFocusAreaSummary = {
  focusKey: string;
  focusName: string;
  focusType: "primary" | "secondary";
  displayOrder: number;
};

export type StaffProfileDetail = {
  staffId: string;
  externalId: string;
  displayName: string;
  email: string;
  primaryOrgCode?: string;
  accountStatus: string;
  academicYear: string;
  evidenceSubmitted: number;
  milestonesCompleted: number;
  reflections: StaffReflectionSummary[];
  cpdRecords: StaffCpdRecordSummary[];
  actions: StaffProfileActionSummary[];
  coachingRecords: StaffProfileCoachingSummary[];
  elevatePractice?: StaffElevatePracticeSummary;
  elevateStatus: ElevateStatusSummary;
};

export type AdminUserScopeSummary = {
  scopeType: string;
  orgUnitId?: string;
  orgUnitCode?: string;
};

export type AdminUserSummary = {
  userAccountId: string;
  staffId: string;
  externalId: string;
  displayName: string;
  email: string;
  jobTitle?: string;
  primaryOrgUnitId?: string;
  primaryOrgCode?: string;
  accountStatus: string;
  isDisabled: boolean;
  lastLoginAt?: string;
  roles: RoleSummary[];
  scopes: AdminUserScopeSummary[];
};

export type RoleSummary = {
  roleKey: string;
  name: string;
  isOrganisationManaged?: boolean;
};

export type PermissionSummary = {
  permissionKey: string;
  name: string;
  category: string;
};

export type AdminRoleSummary = {
  id: string;
  roleKey: string;
  name: string;
  description?: string;
  isSystem: boolean;
  precedence: number;
  permissions: PermissionSummary[];
};

export type CreateAdminUserRequest = {
  externalId: string;
  displayName: string;
  email: string;
  jobTitle?: string;
  primaryOrgUnitId?: string;
  roleKeys: string[];
  scopeOrgUnitIds: string[];
  accountStatus?: string;
};

export type UpdateAdminUserRequest = {
  displayName?: string;
  jobTitle?: string;
  primaryOrgUnitId?: string;
  accountStatus?: string;
  isDisabled?: boolean;
  roleKeys?: string[];
  scopeOrgUnitIds?: string[];
};

export type UpdateFormTemplateStructureRequest = {
  name: string;
  description?: string;
  orgUnitId?: string;
  sections: Array<{
    sectionKey: string;
    title: string;
    displayOrder: number;
    fields: Array<{
      fieldKey: string;
      label: string;
      fieldType: string;
      isRequired: boolean;
      displayOrder: number;
      helpText?: string;
      options?: string[];
    }>;
  }>;
};

export type CurrentUser = {
  userAccountId?: string;
  staffId?: string;
  displayName: string;
  email: string;
  permissions: string[];
  scopes: Array<{ scopeType: string; orgUnitId?: string; staffId?: string }>;
};

export type StaffOnboardingCategory = {
  key: string;
  name: string;
  displayOrder: number;
};

export type StaffOnboardingOptions = {
  faculties: OrgUnitSummary[];
  teams: OrgUnitSummary[];
  categories: StaffOnboardingCategory[];
};

export type CompleteStaffOnboardingRequest = {
  facultyOrgUnitId: string;
  teamOrgUnitId: string;
  staffCategory: string;
};

export type OrgUnitSummary = {
  id: string;
  parentOrgUnitId?: string;
  orgUnitType: string;
  code: string;
  name: string;
  isActive: boolean;
};

export type RoomSummary = {
  id: string;
  roomCode: string;
  buildingName: string;
};

export type AdminOrganisationMembership = {
  id: string;
  orgUnitId: string;
  parentOrgUnitId?: string;
  orgUnitType: string;
  code: string;
  name: string;
  parentCode?: string;
  parentName?: string;
  membershipType: string;
  isPrimary: boolean;
  activeFrom?: string;
  activeTo?: string;
  isActive: boolean;
};

export type AdminManagerRelationship = {
  id: string;
  managerStaffId: string;
  managerName: string;
  relationshipType: string;
  isPrimary: boolean;
  activeFrom?: string;
  activeTo?: string;
  isActive: boolean;
};

export type AdminReportingLine = {
  managerStaffId: string;
  managerName: string;
  level: number;
  effectivePermissionLevel: string;
};

export type AdminOrganisationStaff = {
  staffId: string;
  externalId: string;
  displayName: string;
  email: string;
  accountStatus: string;
  staffCategory?: string;
  effectivePermissionLevel: string;
  roleNames: string[];
  memberships: AdminOrganisationMembership[];
  directManagers: AdminManagerRelationship[];
  reportingLine: AdminReportingLine[];
};

export type AdminOrganisationManager = {
  assignmentId: string;
  staffId: string;
  externalId: string;
  displayName: string;
  email: string;
  permissionLevel: string;
  activeFrom: string;
};

export type AdminOrganisationUnit = {
  id: string;
  parentOrgUnitId?: string;
  orgUnitType: "faculty" | "team";
  code: string;
  name: string;
  description?: string;
  directStaffCount: number;
  totalStaffCount: number;
  childTeamCount: number;
  managedTeamCount: number;
  isActive: boolean;
  legacyCodes: string[];
  alignedFacultyCodes: string[];
  manager?: AdminOrganisationManager;
  parentManager?: AdminOrganisationManager;
};

export type AdminOrganisationStaffOption = {
  staffId: string;
  externalId: string;
  displayName: string;
  email: string;
  staffCategory?: string;
  effectivePermissionLevel: string;
  primaryOrgCode?: string;
};

export type AdminOrganisationStructure = {
  units: AdminOrganisationUnit[];
  staff: AdminOrganisationStaffOption[];
};

export type SaveOrgUnitManagerRequest = {
  managerStaffId: string;
  reason?: string;
};

export type SaveOrganisationUnitRequest = {
  orgUnitType: "faculty" | "team";
  code: string;
  name: string;
  description?: string;
  parentOrgUnitId?: string;
};

export type OrganisationChangeImpact = {
  orgUnitId: string;
  activeMemberships: number;
  activeLeaderships: number;
  activePermissionScopes: number;
  childUnits: number;
  historicalRecords: number;
  draftRecords: number;
  openActions: number;
  warnings: string[];
};

export type MembershipChangeImpact = {
  membershipId: string;
  staffId: string;
  staffName: string;
  orgUnitCode: string;
  isPrimary: boolean;
  permissionScopes: number;
  directReports: number;
  assignedOpenActions: number;
  draftRecords: number;
  activeReviews: number;
  warnings: string[];
};

export type OrganisationMigrationReview = {
  id: string;
  migrationKey: string;
  itemType: string;
  sourceCode?: string;
  proposedCode?: string;
  staffId?: string;
  staffName?: string;
  details: string;
  status: "open" | "resolved" | "ignored";
  resolutionNote?: string;
  createdAt: string;
};

export type SaveOrganisationMembershipRequest = {
  orgUnitId: string;
  membershipType: string;
  isPrimary: boolean;
  activeFrom?: string;
  activeTo?: string;
};

export type SaveManagerRelationshipRequest = {
  managerStaffId: string;
  relationshipType: string;
  isPrimary: boolean;
  activeFrom?: string;
  activeTo?: string;
};

export type AdminManagedListValue = {
  id: string;
  valueKey: string;
  displayName: string;
  displayOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
};

export type AdminManagedList = {
  lookupKey: string;
  name: string;
  category: string;
  description?: string;
  displayOrder: number;
  usedIn: string[];
  values: AdminManagedListValue[];
};

export type AdminRecord = {
  recordId: string;
  moduleKey: string;
  moduleName: string;
  recordType: string;
  title: string;
  subjectStaffName?: string;
  subjectStaffId?: string;
  ownerStaffName?: string;
  facultyCode?: string;
  facultyName?: string;
  teamCode?: string;
  teamName?: string;
  status: string;
  recordDate?: string;
  createdAt: string;
  updatedAt?: string;
  archivedAt?: string;
  deletedByName?: string;
  deletionReason?: string;
};

export type SharedTheme = {
  id: string;
  themeGroupId: string;
  themeKey: string;
  name: string;
  description?: string;
  assetKey?: string;
  displayOrder: number;
  isOther: boolean;
  isActive: boolean;
};

export type SharedThemeGroup = {
  id: string;
  groupKey: string;
  name: string;
  description?: string;
  displayOrder: number;
  isActive: boolean;
  themes: SharedTheme[];
};

export type ElevateEnvironmentPillarSummary = {
  id: string;
  pillarKey: string;
  name: string;
  description: string;
  displayOrder: number;
  isActive: boolean;
  assetUri: string;
  assetAltText: string;
  rubric: ElevateEnvironmentRubricDescriptorSummary[];
};

export type ElevateEnvironmentRubricDescriptorSummary = {
  id: string;
  score: number;
  judgementKey: string;
  judgement: string;
  descriptor: string;
  colorHex?: string;
};

export type CourseSummary = {
  id: string;
  courseCode: string;
  courseName: string;
  orgUnitId: string;
  academicYear?: string;
};

export type FormTemplateSummary = {
  id: string;
  moduleId: string;
  moduleKey: string;
  moduleName: string;
  templateKey: string;
  name: string;
  version?: string;
  status: "Draft" | "Published" | "Archived";
  isEditable: boolean;
  assignedOrgUnits: Array<{ id: string; code: string; name: string }>;
  submissionCount: number;
};

export type CreateFormTemplateRequest = {
  moduleKey: "work_scrutiny";
  name: string;
  description?: string;
  orgUnitId: string;
};

export type FormDefinition = {
  templateId: string;
  versionId: string;
  templateKey: string;
  name: string;
  version: string;
  sections: FormSectionDefinition[];
};

export type FormSectionDefinition = {
  id: string;
  sectionKey: string;
  title: string;
  displayOrder: number;
  fields: FormFieldDefinition[];
};

export type FormFieldDefinition = {
  id: string;
  fieldKey: string;
  label: string;
  fieldType: "date" | "faculty_lookup" | "team_lookup" | "auto_text" | "staff_lookup" | "long_text" | string;
  isRequired: boolean;
  displayOrder: number;
  helpText?: string;
  options?: string[];
};

export type LearningWalkThemeMappingSummary = {
  id: string;
  facultyOrgUnitId: string;
  childOrgUnitId: string;
  agreedTheme: string;
};

export type UpdateLearningWalkThemeMappingRequest = {
  facultyOrgUnitId: string;
  childOrgUnitId: string;
  agreedTheme: string;
};

export type LearningWalkTheme = {
  id: string;
  themeGroupId: string;
  name: string;
  displayOrder: number;
  isOther: boolean;
  isActive: boolean;
};

export type LearningWalkThemeGroup = {
  id: string;
  groupKey: string;
  name: string;
  displayOrder: number;
  isActive: boolean;
  themes: LearningWalkTheme[];
};

export type SaveLearningWalkThemeGroupRequest = {
  name: string;
};

export type SaveLearningWalkThemeRequest = {
  themeGroupId: string;
  name: string;
};

export type SubmitFormRequest = {
  templateKey: string;
  recordType: string;
  title: string;
  summary?: string;
  subjectStaffId?: string;
  orgUnitId?: string;
  recordDate?: string;
  responses: Array<{ fieldId: string; value?: string }>;
  saveAsDraft?: boolean;
  courseIds?: string[];
  actions?: Array<{ title: string; ownerStaffId: string; dueDate: string }>;
};

export type UpdateFormSubmissionRequest = {
  title: string;
  summary?: string;
  subjectStaffId?: string;
  orgUnitId?: string;
  recordDate?: string;
  responses: Array<{ fieldId: string; value?: string }>;
  courseIds?: string[];
};

export type MessageAttachmentRequest = {
  attachmentType: "static" | "record" | "excel_export" | "word_report";
  displayName: string;
  fileAssetId?: string;
  exportModuleKey?: string;
};

export type SaveMessageTemplateRequest = {
  messageKey: string;
  name: string;
  internalDescription?: string;
  subjectTemplate: string;
  plainTextTemplate: string;
  htmlTemplate?: string;
  recipientConfigJson: string;
  eventType: string;
  conditionConfigJson: string;
  scheduleConfigJson: string;
  isActive: boolean;
  attachments?: MessageAttachmentRequest[];
};

export type MessageTemplateSummary = SaveMessageTemplateRequest & {
  id: string;
  isDeleted: boolean;
  versionNumber: number;
  createdAt: string;
  updatedAt?: string;
  pendingCount: number;
  failedCount: number;
  sentCount: number;
};

export type MessageTemplateVersionSummary = {
  id: string;
  versionNumber: number;
  subjectTemplate: string;
  plainTextTemplate: string;
  htmlTemplate?: string;
  recipientConfigJson: string;
  createdAt: string;
  createdBy?: string;
};

export type MessagingParameter = {
  key: string;
  label: string;
  category: string;
  sampleValue: string;
};

export type MessagePreview = {
  subject: string;
  plainTextBody: string;
  htmlBody?: string;
  recipients: string[];
};

export type MessageDeliverySummary = {
  id: string;
  templateName: string;
  templateVersion: number;
  triggeringEvent: string;
  status: "pending" | "processing" | "sent" | "failed" | "retrying" | "cancelled";
  recipients: string;
  attemptCount: number;
  queuedAt: string;
  deliveredAt?: string;
  failedAt?: string;
  lastError?: string;
  providerResponseId?: string;
};

export type MessagingConfiguration = {
  enabled: boolean;
  testMode: boolean;
  provider: "MicrosoftGraph" | "Smtp";
  tenantId: string;
  clientId: string;
  clientSecretConfigured: boolean;
  senderAddress: string;
  senderDisplayName: string;
  replyToAddress: string;
  testRecipient: string;
  applicationUrl: string;
  pollSeconds: number;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: "StartTls" | "SslOnConnect" | "None";
  smtpAuthentication: "OAuth2" | "UsernamePassword" | "None";
  smtpUsername: string;
  smtpPasswordConfigured: boolean;
  updatedAt?: string;
  updatedBy?: string;
};

export type SaveMessagingConfigurationRequest = Omit<
  MessagingConfiguration,
  "clientSecretConfigured" | "smtpPasswordConfigured" | "updatedAt" | "updatedBy"
> & {
  clientSecret?: string;
  clearClientSecret: boolean;
  smtpPassword?: string;
  clearSmtpPassword: boolean;
};
