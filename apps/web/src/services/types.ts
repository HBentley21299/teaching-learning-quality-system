export type ModuleSummary = {
  id: string;
  moduleKey: string;
  name: string;
  description?: string;
  routePrefix: string;
  displayOrder: number;
  isEnabled: boolean;
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
  sourceRecordType?: string;
  subjectStaffId?: string;
  subjectStaffName?: string;
  ownerStaffId: string;
  ownerStaffName?: string;
  title: string;
  detail?: string;
  statusKey?: string;
  priorityKey?: string;
  dueDate?: string;
  completedDate?: string;
  completionNote?: string;
  isOverdue: boolean;
};

export type CreateActionRequest = {
  sourceRecordId?: string;
  subjectStaffId?: string;
  ownerStaffId: string;
  title: string;
  detail?: string;
  priorityLookupValueId?: string;
  statusLookupValueId?: string;
  dueDate?: string;
  publishedToStaff: boolean;
};

export type UpdateActionRequest = {
  title?: string;
  detail?: string;
  dueDate?: string;
  status?: "complete" | "open";
  completionNote?: string;
};

export type RecordSummary = {
  id: string;
  moduleId: string;
  recordType: string;
  title: string;
  subjectStaffId?: string;
  ownerStaffId?: string;
  reviewerStaffId?: string;
  practiceObserved?: string;
  orgUnitId?: string;
  recordDate?: string;
  createdAt: string;
  submissionStatus: string;
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
  courseSeen?: string;
  livDate?: string;
  livTime?: string;
  preConversation?: string;
  livOverview?: string;
  postConversation?: string;
  followUpProjectedDate?: string;
  secondLivOverview?: string;
  status: "draft" | "open" | "closed";
  createdAt: string;
  updatedAt?: string;
  canEdit: boolean;
};

export type SaveLivRecordRequest = {
  subjectStaffId: string;
  orgUnitId?: string;
  courseSeen?: string;
  livDate?: string;
  livTime?: string;
  preConversation?: string;
  livOverview?: string;
  postConversation?: string;
  followUpProjectedDate?: string;
  secondLivOverview?: string;
  saveAsDraft?: boolean;
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
  canEdit: boolean;
  sections: RecordDetailSection[];
  auditHistory: AuditHistory[];
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
  processKey: "learning_walk" | "work_scrutiny" | "cpd_event" | "elevate_environment" | "coaching_session";
  recordType: string;
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
  focus?: string;
  practiceObserved?: string;
  participantAreaBreakdown?: string;
  participantCount: number;
  attendanceCredits: number;
  sampleSize: number;
  scoreTotal: number;
  scoreCount: number;
  barrierCount: number;
  belowSecureCount: number;
};

export type ActivityOverTimePoint = {
  month: string;
  recordCount: number;
  recordType: string;
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
  reflectionPointCount: number;
  completedReflections: number;
  overdueReflections: number;
  openLivActions: number;
};

export type StaffReflectionSummary = {
  pointKey: string;
  name: string;
  dueDate: string;
  status: "completed" | "overdue" | "not_yet_due";
  evidenceItemId?: string;
  text?: string;
  completionDate?: string;
  lastSavedAt?: string;
};

export type StaffCpdRecordSummary = {
  recordId: string;
  title: string;
  eventDate: string;
  themes?: string;
  recordType: string;
};

export type StaffLivActionSummary = {
  id: string;
  title: string;
  createdAt: string;
  sourceRecordId?: string;
  sourceRecordTitle?: string;
  dueDate?: string;
  completedDate?: string;
  isOverdue: boolean;
};

export type ElevatePracticeRatingScale = {
  score: number;
  descriptor: string;
  meaning: string;
  colorHex: string;
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
  score?: number;
};

export type ElevatePracticeArea = {
  id: string;
  areaKey: string;
  category: string;
  name: string;
  reflectionPrompt: string;
  displayOrder: number;
  averageScore?: number;
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
  reviewDate?: string;
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
  ratingScale: ElevatePracticeRatingScale[];
  supportOptions: ElevatePracticeSupportOption[];
  areas: ElevatePracticeArea[];
  strengthAreaKeys: string[];
  developmentAreaKeys: string[];
  suggestedStrengthAreaKeys: string[];
  suggestedDevelopmentAreaKeys: string[];
  developmentPlans: ElevatePracticePlan[];
};

export type SaveElevatePracticeAssessmentRequest = {
  ratings: Array<{ statementId: string; score: number }>;
  reflections: Array<{ areaKey: string; text: string }>;
  strengthAreaKeys: string[];
  developmentAreaKeys: string[];
  developmentPlans: Array<{
    areaKey: string;
    developmentApproach: string;
    supportKeys: string[];
    supportDetails: string;
    successEvidence: string;
    intendedImpact: string;
    reviewDate?: string;
  }>;
  submit: boolean;
};

export type ElevatePracticeProgress = {
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
  title: string;
  targetDate?: string;
  status: CoachingPreviousActionStatus;
  latestUpdate?: string;
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

export type CoachingSessionType = "coaching" | "mentoring" | "combined";
export type CoachingPreviousActionStatus = "not_started" | "in_progress" | "completed" | "not_applicable";

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
  mainFocus?: string;
  createdAt: string;
  updatedAt?: string;
  canEdit: boolean;
};

export type CoachingSessionAction = {
  id?: string;
  actionId?: string;
  actionOrder?: number;
  actionText: string;
  ownerType: "staff" | "coach" | "joint";
  targetDate: string;
  evidenceText?: string;
};

export type CoachingPreviousActionUpdate = {
  actionId: string;
  status: CoachingPreviousActionStatus;
  updateText?: string;
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
  progressReflection?: string;
  mainFocus?: string;
  additionalFocusAreas: string[];
  sessionReason?: string;
  goal?: string;
  whyThisMatters?: string;
  confidenceBefore?: number;
  currentSituation?: string;
  whatsWorking?: string;
  challenges?: string;
  keyDiscussionPoints?: string;
  supportTypes: string[];
  supportResources?: string;
  intendedImpactAreas: string[];
  impactStatement?: string;
  confidenceToComplete?: number;
  supportNeeded: string[];
  additionalSupportDetails?: string;
  keyTakeaway?: string;
  sessionSummary?: string;
  staffAgrees: boolean;
  coachAgrees: boolean;
  anotherSessionRequired?: "yes" | "no" | "to_be_confirmed";
  nextSessionDate?: string;
  nextFocus?: string;
  completedAt?: string;
  canEdit: boolean;
  previousActions: CoachingPreviousActionSummary[];
  previousActionUpdates: CoachingPreviousActionUpdate[];
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
  progressReflection?: string;
  mainFocus?: string;
  additionalFocusAreas: string[];
  sessionReason?: string;
  goal?: string;
  whyThisMatters?: string;
  confidenceBefore?: number;
  currentSituation?: string;
  whatsWorking?: string;
  challenges?: string;
  keyDiscussionPoints?: string;
  supportTypes: string[];
  supportResources?: string;
  intendedImpactAreas: string[];
  impactStatement?: string;
  confidenceToComplete?: number;
  supportNeeded: string[];
  additionalSupportDetails?: string;
  keyTakeaway?: string;
  sessionSummary?: string;
  staffAgrees: boolean;
  coachAgrees: boolean;
  anotherSessionRequired?: "yes" | "no" | "to_be_confirmed";
  nextSessionDate?: string;
  nextFocus?: string;
  previousActionUpdates: CoachingPreviousActionUpdate[];
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
  overallAverage?: number;
  submittedAt?: string;
};

export type StaffProfileDetail = {
  staffId: string;
  externalId: string;
  displayName: string;
  email: string;
  jobTitle?: string;
  primaryOrgCode?: string;
  accountStatus: string;
  evidenceSubmitted: number;
  milestonesCompleted: number;
  attendanceCredits: number;
  reflections: StaffReflectionSummary[];
  reflectionRecords: StaffReflectionRecordSummary[];
  cpdRecords: StaffCpdRecordSummary[];
  actions: ActionSummary[];
  livActions: StaffLivActionSummary[];
  associatedRecords: StaffAssociatedRecordSummary[];
  elevatePractice?: StaffElevatePracticeSummary;
};

export type StaffReflectionRecordSummary = {
  id: string;
  recordId: string;
  title: string;
  text: string;
  reflectionDate: string;
  createdAt: string;
};

export type StaffAssociatedRecordSummary = {
  recordId: string;
  recordType: string;
  title: string;
  recordDate?: string;
  status: string;
  summary?: string;
  practiceObserved?: string;
};

export type StaffReflectionDetail = {
  id: string;
  recordId: string;
  staffId: string;
  staffName: string;
  title: string;
  text: string;
  reflectionDate: string;
  createdAt: string;
};

export type AuditHistory = {
  id: string;
  action: string;
  summary?: string;
  userDisplayName?: string;
  createdAt: string;
};

export type ActionDetail = {
  id: string;
  sourceRecordId?: string;
  sourceRecordTitle?: string;
  sourceRecordType?: string;
  subjectStaffId?: string;
  subjectStaffName?: string;
  ownerStaffId: string;
  ownerStaffName?: string;
  title: string;
  detail?: string;
  statusKey?: string;
  priorityKey?: string;
  dueDate?: string;
  completedDate?: string;
  completionNote?: string;
  createdAt: string;
  updatedAt?: string;
  auditHistory: AuditHistory[];
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
};
