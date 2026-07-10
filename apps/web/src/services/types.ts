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
};

export type ActionSummary = {
  id: string;
  sourceRecordId?: string;
  sourceRecordTitle?: string;
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
  id: string;
  title: string;
  eventDate: string;
  themes?: string;
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
  reflections: StaffReflectionSummary[];
  cpdRecords: StaffCpdRecordSummary[];
  livActions: StaffLivActionSummary[];
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
};

export type UpdateFormSubmissionRequest = {
  title: string;
  summary?: string;
  subjectStaffId?: string;
  orgUnitId?: string;
  recordDate?: string;
  responses: Array<{ fieldId: string; value?: string }>;
};
