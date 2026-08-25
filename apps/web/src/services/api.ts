import type {
  ActionSummary,
  AcademicYearSummary,
  ActionExtensionSummary,
  ActionOwnerOption,
  AdminManagedList,
  AdminOrganisationStructure,
  AdminOrganisationStaff,
  MembershipChangeImpact,
  MessageDeliverySummary,
  MessagePreview,
  MessageTemplateSummary,
  MessageTemplateVersionSummary,
  MessagingParameter,
  MessagingConfiguration,
  RecordNavigation,
  SaveMessagingConfigurationRequest,
  OrganisationChangeImpact,
  OrganisationMigrationReview,
  PagedResult,
  AdminRecord,
  AdminWorkScrutinyRecord,
  AdminWorkScrutinyAction,
  AdminSaveElevatePracticeAssessmentRequest,
  AdminRoleSummary,
  AdminUserSummary,
  CoachingContext,
  CoachingConfiguration,
  CoachingSessionDetail,
  CoachingSessionSaveSummary,
  CoachingSessionSummary,
  CompleteStaffOnboardingRequest,
  CpdAttendanceDashboardSummary,
  CourseSummary,
  CreateActionRequest,
  CreateAdminUserRequest,
  CreateFormTemplateRequest,
  CurrentUser,
  DashboardSummary,
  DashboardActionSummary,
  DashboardConfiguration,
  DashboardDimensionFact,
  DashboardProcessConfiguration,
  ElevateStatusDashboardSummary,
  ElevateStatusBadgeAssetSummary,
  LivLifecycleDashboardSummary,
  ElevateEnvironmentPillarSummary,
  ElevatePracticeProgress,
  ElevatePracticeAudit,
  ElevatePracticeWorkspace,
  FormDefinition,
  FormTemplateSummary,
  LearningWalkThemeMappingSummary,
  LearningWalkThemeGroup,
  LearningWalkRollupSummary,
  LivConfiguration,
  LivCycle,
  LivRecordSummary,
  LivStaffContext,
  LookupSummary,
  LookupValueSummary,
  ModuleSummary,
  MyTeamMember,
  OrgUnitSummary,
  ProcessDashboardRecordSummary,
  ProbationCase,
  ProbationConfiguration,
  ProbationStaffContext,
  CreateProbationCaseRequest,
  RecordDetail,
  RecordAudit,
  RecordSummary,
  RoomSummary,
  SaveLivRecordRequest,
  SaveLivStageRequest,
  SaveManagerRelationshipRequest,
  SaveMessageTemplateRequest,
  SaveOrgUnitManagerRequest,
  SaveOrganisationUnitRequest,
  SaveOrganisationMembershipRequest,
  SaveLivVisitRequest,
  SaveProbationStageRequest,
  SaveProbationVisitRequest,
  SaveLearningWalkThemeGroupRequest,
  SaveLearningWalkThemeRequest,
  SaveCoachingSessionRequest,
  SaveElevatePracticeAssessmentRequest,
  SaveElevateStatusLevelRequest,
  SaveStaffReflectionRequest,
  StaffParticipationDashboardSummary,
  StaffProfileDetail,
  StaffProfileActionSummary,
  StaffProfileCoachingSummary,
  StaffProfileLivSummary,
  StaffProfileProbationSummary,
  StaffProfileRecordSummary,
  StaffProfileSectionSummary,
  StaffProfileSummary,
  StaffCpdRecordSummary,
  StaffReflectionSummary,
  StaffSummary,
  StaffOnboardingOptions,
  SharedThemeGroup,
  SubmitFormRequest,
  UpdateActionRequest,
  ExtendActionRequest,
  UpdateAdminUserRequest,
  UpdateFormSubmissionRequest,
  UpdateFormTemplateStructureRequest,
  UpdateLearningWalkThemeMappingRequest
  ,QaActivityTypeSummary
  ,QaAuditSummary
  ,QaDashboardSummary
  ,QaActionGroupSummary
  ,QaReviewActionOptions
  ,CreateQaActionGroupRequest
  ,QaEvidenceDetail
  ,QaHubSummary
  ,QaQuestionSummary
  ,QaReviewDetail
  ,SaveQaEvidenceRequest
  ,SaveQaReviewRequest
} from "./types";

import { clearLocalSession, getAccessToken, getLocalToken } from "./auth";

// An expired local test-account token yields 401s; clear it and return to
// the sign-in screen instead of leaving the app half-broken.
function handleExpiredLocalSession(status: number) {
  if (status === 401 && getLocalToken()) {
    clearLocalSession();
    window.location.assign("/");
  }
}

const configuredApiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").trim().replace(/\/+$/, "");
const apiBaseUrl = configuredApiBaseUrl || (import.meta.env.DEV ? "http://127.0.0.1:5001" : "");
const configuredTimeout = Number.parseInt(import.meta.env.VITE_API_TIMEOUT_MS ?? "30000", 10);
const apiRequestTimeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout >= 1000
  ? configuredTimeout
  : 30000;
const exportRequestTimeoutMs = Math.max(apiRequestTimeoutMs, 180000);

export type ApiResult<T = never> = {
  ok: boolean;
  message?: string;
  data?: T;
};

export type ExportFilters = {
  academicYear?: string;
  facultyCode?: string;
  teamCode?: string;
  fromDate?: string;
  toDate?: string;
  staffId?: string;
  reviewerId?: string;
  status?: string;
  recordType?: string;
};

async function buildHeaders(hasBody: boolean): Promise<HeadersInit | undefined> {
  const headers: Record<string, string> = {};
  const accessToken = await getAccessToken();
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  if (hasBody) {
    headers["Content-Type"] = "application/json";
  }

  return Object.keys(headers).length > 0 ? headers : undefined;
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await requestApi(url, { headers: await buildHeaders(false) }, signal);
  if (!response.ok) {
    handleExpiredLocalSession(response.status);
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }

  return (await response.json()) as T;
}

async function sendJson<TRequest, TResponse = never>(url: string, method: "POST" | "PUT" | "DELETE", body?: TRequest): Promise<ApiResult<TResponse>> {
  try {
    const response = await requestApi(url, {
      body: body ? JSON.stringify(body) : undefined,
      headers: await buildHeaders(Boolean(body)),
      method
    });

    if (response.ok) {
      const contentType = response.headers.get("content-type") ?? "";
      const data = response.status !== 204 && contentType.includes("application/json")
        ? (await response.json()) as TResponse
        : undefined;
      return { ok: true, data };
    }

    handleExpiredLocalSession(response.status);
    let message = `The request failed (${response.status}).`;
    if (response.status === 403) {
      message = "You do not have permission to do that.";
    }

    try {
      const payload = (await response.json()) as { message?: string; Message?: string };
      message = payload.message ?? payload.Message ?? message;
    } catch {
      // keep the default message when the body is not JSON
    }

    return { ok: false, message };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, message: "The API request timed out. Please try again." };
    }
    return { ok: false, message: "The API could not be reached. Check it is running." };
  }
}

async function sendForm<TResponse>(url: string, body: FormData): Promise<ApiResult<TResponse>> {
  try {
    const response = await requestApi(url, {
      body,
      headers: await buildHeaders(false),
      method: "POST"
    });
    if (response.ok) {
      return { ok: true, data: (await response.json()) as TResponse };
    }
    handleExpiredLocalSession(response.status);
    let message = response.status === 403
      ? "You do not have permission to do that."
      : `The upload failed (${response.status}).`;
    try {
      const payload = (await response.json()) as { message?: string; Message?: string };
      message = payload.message ?? payload.Message ?? message;
    } catch {
      // keep the status-based message
    }
    return { ok: false, message };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error && error.name === "AbortError"
        ? "The upload took too long. Please try again."
        : "The API could not be reached. Check it is running."
    };
  }
}

async function getApiBlob(url: string): Promise<Blob | null> {
  const response = await requestApi(url, { headers: await buildHeaders(false) });
  if (response.status === 404) return null;
  if (!response.ok) {
    handleExpiredLocalSession(response.status);
    throw new Error(`The image could not be loaded (${response.status}).`);
  }
  return response.blob();
}

async function requestApi(url: string, init: RequestInit, externalSignal?: AbortSignal, timeoutMs = apiRequestTimeoutMs): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  const abortFromCaller = () => controller.abort();
  externalSignal?.addEventListener("abort", abortFromCaller, { once: true });

  try {
    return await fetch(`${apiBaseUrl}${url}`, {
      ...init,
      cache: "no-store",
      signal: controller.signal
    });
  } finally {
    window.clearTimeout(timeoutId);
    externalSignal?.removeEventListener("abort", abortFromCaller);
  }
}

async function downloadApiFile(url: string): Promise<ApiResult> {
  try {
    const response = await requestApi(url, { headers: await buildHeaders(false) }, undefined, exportRequestTimeoutMs);
    if (!response.ok) {
      return {
        ok: false,
        message: response.status === 403
          ? "You do not have permission to create this export."
          : `The export could not be created (${response.status}).`
      };
    }

    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") ?? "";
    const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    const plainName = disposition.match(/filename="?([^";]+)"?/i)?.[1];
    const fileName = encodedName ? decodeURIComponent(encodedName) : plainName ?? "i-elevate-export";
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
    return { ok: true };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, message: "The export took too long. Narrow the filters and try again." };
    }
    return { ok: false, message: "The API could not be reached. Check it is running." };
  }
}

export const api = {
  qaHubSummary: () => getJson<QaHubSummary>("/api/v1/qa-hub/summary"),
  qaActivityTypes: () => getJson<QaActivityTypeSummary[]>("/api/v1/qa-hub/activities"),
  qaQuestions: (activityTypeId?: string, includeInactive = false) => {
    const query = new URLSearchParams();
    if (activityTypeId) query.set("activityTypeId", activityTypeId);
    if (includeInactive) query.set("includeInactive", "true");
    return getJson<QaQuestionSummary[]>(`/api/v1/qa-hub/questions${query.size ? `?${query}` : ""}`);
  },
  saveQaQuestion: (questionId: string | undefined, request: Omit<QaQuestionSummary, "id" | "activityKey" | "activityName" | "versionNumber" | "createdAt">) =>
    sendJson<Omit<QaQuestionSummary, "id" | "activityKey" | "activityName" | "versionNumber" | "createdAt">, QaQuestionSummary>(`/api/v1/qa-hub/questions${questionId ? `/${questionId}` : ""}`, questionId ? "PUT" : "POST", request),
  qaReview: (reviewId: string) => getJson<QaReviewDetail>(`/api/v1/qa-hub/reviews/${reviewId}`),
  createQaReview: (request: SaveQaReviewRequest) => sendJson<SaveQaReviewRequest, { id: string }>("/api/v1/qa-hub/reviews", "POST", request),
  updateQaReview: (reviewId: string, request: SaveQaReviewRequest) => sendJson<SaveQaReviewRequest, QaReviewDetail>(`/api/v1/qa-hub/reviews/${reviewId}`, "PUT", request),
  transitionQaReview: (reviewId: string, action: "open" | "close" | "reopen" | "archive", reason: string | undefined, rowVersion: string) =>
    sendJson<{ reason?: string; rowVersion: string }, QaReviewDetail>(`/api/v1/qa-hub/reviews/${reviewId}/${action}`, "POST", { reason, rowVersion }),
  duplicateQaTemplate: (templateId: string, name: string, description?: string) =>
    sendJson(`/api/v1/qa-hub/templates/${templateId}/duplicate`, "POST", { name, description }),
  qaEvidence: (evidenceId: string) => getJson<QaEvidenceDetail>(`/api/v1/qa-hub/evidence/${evidenceId}`),
  saveQaEvidence: (reviewId: string, evidenceId: string | undefined, request: SaveQaEvidenceRequest, submit = false) => {
    const path = evidenceId
      ? `/api/v1/qa-hub/reviews/${reviewId}/evidence/${evidenceId}${submit ? "/submit" : ""}`
      : `/api/v1/qa-hub/reviews/${reviewId}/evidence${submit ? "/submit" : ""}`;
    return sendJson<SaveQaEvidenceRequest, QaEvidenceDetail>(path, evidenceId && !submit ? "PUT" : "POST", request);
  },
  removeQaEvidence: (evidenceId: string, reason: string) => sendJson(`/api/v1/qa-hub/evidence/${evidenceId}`, "DELETE", { reason }),
  qaDashboard: (reviewId: string, facultyOrgUnitId?: string, teamOrgUnitId?: string) => {
    const query = new URLSearchParams();
    if (facultyOrgUnitId) query.set("facultyOrgUnitId", facultyOrgUnitId);
    if (teamOrgUnitId) query.set("teamOrgUnitId", teamOrgUnitId);
    return getJson<QaDashboardSummary>(`/api/v1/qa-hub/reviews/${reviewId}/dashboard${query.size ? `?${query}` : ""}`);
  },
  qaReviewActionOptions: (reviewId: string) => getJson<QaReviewActionOptions>(`/api/v1/qa-hub/reviews/${reviewId}/action-options`),
  qaActionReviewOptions: () => getJson<QaReviewActionOptions[]>("/api/v1/qa-hub/action-options"),
  qaReviewActions: (reviewId: string) => getJson<QaActionGroupSummary[]>(`/api/v1/qa-hub/reviews/${reviewId}/actions`),
  createQaReviewAction: (reviewId: string, request: CreateQaActionGroupRequest) =>
    sendJson<CreateQaActionGroupRequest, QaActionGroupSummary>(`/api/v1/qa-hub/reviews/${reviewId}/actions`, "POST", request),
  qaAdminActions: () => getJson<QaActionGroupSummary[]>("/api/v1/qa-hub/actions"),
  reviewQaActionGroup: (groupId: string, rowVersion: string) =>
    sendJson<{ rowVersion: string }, QaActionGroupSummary>(`/api/v1/qa-hub/actions/${groupId}/review`, "POST", { rowVersion }),
  closeQaActionGroup: (groupId: string, rowVersion: string) =>
    sendJson<{ rowVersion: string }, QaActionGroupSummary>(`/api/v1/qa-hub/actions/${groupId}/close`, "POST", { rowVersion }),
  qaAudit: (reviewId: string) => getJson<QaAuditSummary[]>(`/api/v1/qa-hub/reviews/${reviewId}/audit`),
  exportQaReview: (reviewId: string, format: "pdf" | "xlsx", facultyOrgUnitId?: string, teamOrgUnitId?: string) => {
    const query = new URLSearchParams();
    if (facultyOrgUnitId) query.set("facultyOrgUnitId", facultyOrgUnitId);
    if (teamOrgUnitId) query.set("teamOrgUnitId", teamOrgUnitId);
    return downloadApiFile(`/api/v1/qa-hub/reviews/${reviewId}/report.${format}${query.size ? `?${query}` : ""}`);
  },
  changePassword: (request: { currentPassword: string; newPassword: string }) =>
    sendJson("/api/v1/auth/change-password", "POST", request),
  adminSetUserPassword: (userAccountId: string, newPassword: string) =>
    sendJson(`/api/v1/auth/admin/users/${userAccountId}/password`, "POST", { newPassword }),
  exportExcel: (moduleKey: string, filters: ExportFilters = {}) => {
    const query = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => { if (value) query.set(key, value); });
    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    return downloadApiFile(`/api/v1/exports/excel/${encodeURIComponent(moduleKey)}${suffix}`);
  },
  exportDashboard: (moduleKey: string, format: "pdf" | "xlsx", filters: ExportFilters = {}) => {
    const query = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => { if (value) query.set(key, value); });
    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    const routeFormat = format === "xlsx" ? "excel" : "pdf";
    return downloadApiFile(`/api/v1/exports/${routeFormat}/${encodeURIComponent(moduleKey)}${suffix}`);
  },
  exportRecordWord: (recordId: string) =>
    downloadApiFile(`/api/v1/exports/word/records/${encodeURIComponent(recordId)}`),
  currentUser: () => getJson<CurrentUser>("/api/v1/me"),
  staffOnboardingOptions: () => getJson<StaffOnboardingOptions>("/api/v1/onboarding/options"),
  completeStaffOnboarding: (request: CompleteStaffOnboardingRequest) =>
    sendJson<CompleteStaffOnboardingRequest, CurrentUser>("/api/v1/onboarding", "POST", request),
  modules: () => getJson<ModuleSummary[]>("/api/v1/modules"),
  lookups: () => getJson<LookupSummary[]>("/api/v1/lookups"),
  actionThemes: (sourceFormType: string) =>
    getJson<LookupValueSummary[]>(`/api/v1/action-themes/${encodeURIComponent(sourceFormType)}`),
  sharedThemes: (applicationKey: string) =>
    getJson<SharedThemeGroup[]>(`/api/v1/themes/${encodeURIComponent(applicationKey)}`),
  adminLookupValues: (lookupKey: string) =>
    getJson<LookupValueSummary[]>(`/api/v1/admin/lookups/${encodeURIComponent(lookupKey)}/values`),
  addLookupValue: (lookupKey: string, displayName: string) =>
    sendJson<{ displayName: string }, LookupValueSummary>(
      `/api/v1/admin/lookups/${encodeURIComponent(lookupKey)}/values`,
      "POST",
      { displayName }
    ),
  archiveLookupValue: (lookupKey: string, id: string) =>
    sendJson(`/api/v1/admin/lookups/${encodeURIComponent(lookupKey)}/values/${id}/archive`, "POST"),
  orgUnits: () => getJson<OrgUnitSummary[]>("/api/v1/org-units"),
  rooms: () => getJson<RoomSummary[]>("/api/v1/rooms"),
  elevateEnvironmentPillars: () =>
    getJson<ElevateEnvironmentPillarSummary[]>("/api/v1/elevate-environment/pillars"),
  courses: (orgUnitId: string) =>
    getJson<CourseSummary[]>(`/api/v1/courses?orgUnitId=${encodeURIComponent(orgUnitId)}`),
  staff: () => getJson<StaffSummary[]>("/api/v1/staff"),
  myTeam: () => getJson<MyTeamMember[]>("/api/v1/my-team"),
  records: (academicYear?: string) =>
    getJson<RecordSummary[]>(`/api/v1/records${academicYear ? `?academicYear=${encodeURIComponent(academicYear)}` : ""}`),
  recordDetail: (id: string) => getJson<RecordDetail>(`/api/v1/records/${id}`),
  recordNavigation: (id: string) => getJson<RecordNavigation>(`/api/v1/records/${id}/navigation`),
  adminWorkScrutinyRecords: () =>
    getJson<AdminWorkScrutinyRecord[]>("/api/v1/admin/work-scrutiny/records"),
  adminWorkScrutinyRecord: (id: string) =>
    getJson<RecordDetail>(`/api/v1/admin/work-scrutiny/records/${id}`),
  workScrutinyRecordAudit: (id: string) =>
    getJson<RecordAudit[]>(`/api/v1/admin/work-scrutiny/records/${id}/audit`),
  adminWorkScrutinyActions: (id: string) =>
    getJson<AdminWorkScrutinyAction[]>(`/api/v1/admin/work-scrutiny/records/${id}/actions`),
  deleteWorkScrutinyRecord: (id: string) =>
    sendJson(`/api/v1/admin/work-scrutiny/records/${id}`, "DELETE"),
  restoreWorkScrutinyRecord: (id: string) =>
    sendJson(`/api/v1/admin/work-scrutiny/records/${id}/restore`, "POST"),
  actions: (includeDeleted = false, academicYear?: string) => {
    const parameters = new URLSearchParams();
    if (includeDeleted) parameters.set("includeDeleted", "true");
    if (academicYear) parameters.set("academicYear", academicYear);
    const query = parameters.toString();
    return getJson<ActionSummary[]>(`/api/v1/actions${query ? `?${query}` : ""}`);
  },
  actionOwnerOptions: (sourceRecordId?: string, subjectStaffId?: string, sourceFormType?: string) => {
    const parameters = new URLSearchParams();
    if (sourceRecordId) parameters.set("sourceRecordId", sourceRecordId);
    if (subjectStaffId) parameters.set("subjectStaffId", subjectStaffId);
    if (sourceFormType) parameters.set("sourceFormType", sourceFormType);
    const query = parameters.toString();
    return getJson<ActionOwnerOption[]>(`/api/v1/actions/owner-options${query ? `?${query}` : ""}`);
  },
  createAction: (request: CreateActionRequest) => sendJson("/api/v1/actions", "POST", request),
  updateAction: (id: string, request: UpdateActionRequest) => sendJson(`/api/v1/actions/${id}`, "PUT", request),
  extendAction: (id: string, request: ExtendActionRequest) => sendJson(`/api/v1/actions/${id}/extend`, "POST", request),
  actionExtensions: (id: string) => getJson<ActionExtensionSummary[]>(`/api/v1/actions/${id}/extensions`),
  deleteAction: (id: string, reason: string) => sendJson(`/api/v1/actions/${id}`, "DELETE", { reason }),
  restoreAction: (id: string) => sendJson(`/api/v1/actions/${id}/restore`, "POST"),
  dashboards: () => getJson<DashboardSummary[]>("/api/v1/reports/dashboards"),
  processDashboardRecords: (academicYear?: string) =>
    getJson<ProcessDashboardRecordSummary[]>(`/api/v1/reports/process-records${academicYear ? `?academicYear=${encodeURIComponent(academicYear)}` : ""}`),
  dashboardActions: (academicYear: string) =>
    getJson<DashboardActionSummary[]>(`/api/v1/reports/actions?academicYear=${encodeURIComponent(academicYear)}`),
  dashboardConfiguration: () =>
    getJson<DashboardConfiguration>("/api/v1/reports/dashboard-configuration"),
  dashboardDimensions: (academicYear?: string) =>
    getJson<DashboardDimensionFact[]>(`/api/v1/reports/dashboard-dimensions${academicYear ? `?academicYear=${encodeURIComponent(academicYear)}` : ""}`),
  eliStatementDashboardDimensions: (academicYear: string) =>
    getJson<DashboardDimensionFact[]>(`/api/v1/reports/eli-statement-dimensions?academicYear=${encodeURIComponent(academicYear)}`),
  elevateStatusDashboard: (academicYear: string) =>
    getJson<ElevateStatusDashboardSummary[]>(`/api/v1/reports/elevate-status?academicYear=${encodeURIComponent(academicYear)}`),
  staffParticipationDashboard: (academicYear: string) =>
    getJson<StaffParticipationDashboardSummary[]>(`/api/v1/reports/staff-participation?academicYear=${encodeURIComponent(academicYear)}`),
  cpdAttendanceDashboard: (academicYear: string) =>
    getJson<CpdAttendanceDashboardSummary[]>(`/api/v1/reports/cpd-attendance?academicYear=${encodeURIComponent(academicYear)}`),
  livLifecycleDashboard: (academicYear: string, process = "liv") =>
    getJson<LivLifecycleDashboardSummary[]>(`/api/v1/reports/liv-lifecycle?academicYear=${encodeURIComponent(academicYear)}&process=${encodeURIComponent(process)}`),
  saveDashboardConfiguration: (processes: DashboardProcessConfiguration[]) =>
    sendJson("/api/v1/admin/reports/dashboard-configuration", "PUT", { processes }),
  learningWalkRollup: () =>
    getJson<LearningWalkRollupSummary[]>("/api/v1/reports/learning-walk-rollup"),
  formTemplates: () => getJson<FormTemplateSummary[]>("/api/v1/form-templates"),
  formDefinition: (templateKey: string) =>
    getJson<FormDefinition>(`/api/v1/form-templates/${templateKey}/definition`),
  workScrutinyTemplate: (orgUnitId: string) =>
    getJson<FormDefinition>(`/api/v1/work-scrutiny/template/${encodeURIComponent(orgUnitId)}`),
  learningWalkThemeMappings: (process = "learning_walk") =>
    getJson<LearningWalkThemeMappingSummary[]>(`/api/v1/learning-walk/theme-mappings?process=${encodeURIComponent(process)}`),
  updateLearningWalkThemeMapping: (request: UpdateLearningWalkThemeMappingRequest, process = "learning_walk") =>
    sendJson(`/api/v1/learning-walk/theme-mappings?process=${encodeURIComponent(process)}`, "PUT", request),
  learningWalkThemes: (process = "learning_walk") =>
    getJson<LearningWalkThemeGroup[]>(`/api/v1/learning-walk/themes?process=${encodeURIComponent(process)}`),
  adminLearningWalkThemes: (process = "learning_walk") =>
    getJson<LearningWalkThemeGroup[]>(`/api/v1/admin/learning-walk/themes?process=${encodeURIComponent(process)}`),
  createLearningWalkThemeGroup: (request: SaveLearningWalkThemeGroupRequest, process = "learning_walk") =>
    sendJson<SaveLearningWalkThemeGroupRequest, { id: string }>(`/api/v1/admin/learning-walk/theme-groups?process=${encodeURIComponent(process)}`, "POST", request),
  updateLearningWalkThemeGroup: (id: string, request: SaveLearningWalkThemeGroupRequest) =>
    sendJson(`/api/v1/admin/learning-walk/theme-groups/${id}`, "PUT", request),
  setLearningWalkThemeGroupStatus: (id: string, isActive: boolean) =>
    sendJson(`/api/v1/admin/learning-walk/theme-groups/${id}/status`, "POST", { isActive }),
  createLearningWalkTheme: (request: SaveLearningWalkThemeRequest, process = "learning_walk") =>
    sendJson<SaveLearningWalkThemeRequest, { id: string }>(`/api/v1/admin/learning-walk/themes?process=${encodeURIComponent(process)}`, "POST", request),
  updateLearningWalkTheme: (id: string, request: SaveLearningWalkThemeRequest) =>
    sendJson(`/api/v1/admin/learning-walk/themes/${id}`, "PUT", request),
  setLearningWalkThemeStatus: (id: string, isActive: boolean) =>
    sendJson(`/api/v1/admin/learning-walk/themes/${id}/status`, "POST", { isActive }),
  reorderLearningWalkThemes: (themeGroupId: string, themeIds: string[]) =>
    sendJson("/api/v1/admin/learning-walk/themes/reorder", "PUT", { themeGroupId, themeIds }),
  createFormTemplate: (request: CreateFormTemplateRequest) =>
    sendJson("/api/v1/form-templates", "POST", request),
  archiveFormTemplate: (id: string) => sendJson(`/api/v1/form-templates/${id}/archive`, "POST"),
  submitForm: (request: SubmitFormRequest) =>
    sendJson<SubmitFormRequest, { id: string; recordId: string }>("/api/v1/form-submissions", "POST", request),
  updateFormSubmission: (id: string, request: UpdateFormSubmissionRequest) =>
    sendJson(`/api/v1/form-submissions/${id}`, "PUT", request),
  changeSubmissionStatus: (id: string, action: "submit" | "reopen" | "archive") =>
    sendJson(`/api/v1/form-submissions/${id}/status`, "POST", { action }),
  livRecords: (process = "liv") => getJson<LivRecordSummary[]>(`/api/v1/liv-records?process=${encodeURIComponent(process)}`),
  livConfiguration: (process = "liv") => getJson<LivConfiguration>(`/api/v1/liv-records/configuration?process=${encodeURIComponent(process)}`),
  livStaffContext: (staffId: string, process = "liv") =>
    getJson<LivStaffContext>(`/api/v1/liv-records/staff/${staffId}/context?process=${encodeURIComponent(process)}`),
  createLivRecord: (request: SaveLivRecordRequest, process = "liv") => sendJson(`/api/v1/liv-records?process=${encodeURIComponent(process)}`, "POST", request),
  updateLivRecord: (id: string, request: SaveLivRecordRequest, process = "liv") =>
    sendJson(`/api/v1/liv-records/${id}?process=${encodeURIComponent(process)}`, "PUT", request),
  addLivVisit: (id: string, request: SaveLivVisitRequest, process = "liv") =>
    sendJson<SaveLivVisitRequest, { id: string; visitNumber: number }>(`/api/v1/liv-records/${id}/visits?process=${encodeURIComponent(process)}`, "POST", request),
  updateLivVisit: (id: string, visitId: string, request: SaveLivVisitRequest, process = "liv") =>
    sendJson(`/api/v1/liv-records/${id}/visits/${visitId}?process=${encodeURIComponent(process)}`, "PUT", request),
  addLivStage: (id: string, request: SaveLivStageRequest, process = "liv") =>
    sendJson<SaveLivStageRequest, { id: string; stageType: string; stageOrder: number; visitId?: string }>(
      `/api/v1/liv-records/${id}/stages?process=${encodeURIComponent(process)}`, "POST", request
    ),
  updateLivStage: (id: string, stageId: string, request: SaveLivStageRequest, process = "liv") =>
    sendJson(`/api/v1/liv-records/${id}/stages/${stageId}?process=${encodeURIComponent(process)}`, "PUT", request),
  completeLivCycle: (id: string, openFollowUp = true, process = "liv") =>
    sendJson<{ openFollowUp: boolean }, LivCycle>(`/api/v1/liv-records/${id}/cycles/current/complete?process=${encodeURIComponent(process)}`, "POST", { openFollowUp }),
  changeLivStatus: (id: string, action: "close" | "reopen" | "archive", process = "liv") =>
    sendJson(`/api/v1/liv-records/${id}/status?process=${encodeURIComponent(process)}`, "POST", { action }),
  probationCases: () => getJson<ProbationCase[]>("/api/v1/probation-observations"),
  probationConfiguration: () => getJson<ProbationConfiguration>("/api/v1/probation-observations/configuration"),
  probationStaffContext: (staffId: string) =>
    getJson<ProbationStaffContext>(`/api/v1/probation-observations/staff/${staffId}/context`),
  createProbationCase: (request: CreateProbationCaseRequest) =>
    sendJson<CreateProbationCaseRequest, { id: string }>("/api/v1/probation-observations", "POST", request),
  updateProbationStage: (caseId: string, observationId: string, stageId: string, request: SaveProbationStageRequest) =>
    sendJson(`/api/v1/probation-observations/${caseId}/observations/${observationId}/stages/${stageId}`, "PUT", request),
  updateProbationVisit: (caseId: string, observationId: string, request: SaveProbationVisitRequest) =>
    sendJson(`/api/v1/probation-observations/${caseId}/observations/${observationId}/visit`, "PUT", request),
  completeProbationObservation: (caseId: string, observationId: string) =>
    sendJson(`/api/v1/probation-observations/${caseId}/observations/${observationId}/complete`, "POST"),
  startProbationLiv: (caseId: string) =>
    sendJson<never, { livRecordId: string; livSourceRecordId: string }>(`/api/v1/probation-observations/${caseId}/observations/2/start`, "POST"),
  staffProfiles: () =>
    getJson<StaffProfileSummary[]>("/api/v1/reports/staff-profile-summaries"),
  staffProfileRecords: () => getJson<StaffProfileRecordSummary[]>("/api/v1/staff-profiles"),
  academicYears: () => getJson<AcademicYearSummary[]>("/api/v1/academic-years"),
  elevateStatusBadgeAssets: (academicYear: string) =>
    getJson<ElevateStatusBadgeAssetSummary[]>(`/api/v1/elevate-status/badge-assets?academicYear=${encodeURIComponent(academicYear)}`),
  elevateStatusBadgeContent: (academicYear: string, levelNumber: number, assetVersion: string) =>
    getApiBlob(`/api/v1/elevate-status/badge-assets/${levelNumber}/content?academicYear=${encodeURIComponent(academicYear)}&version=${encodeURIComponent(assetVersion)}`),
  uploadElevateStatusBadge: (academicYear: string, levelNumber: number, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return sendForm<ElevateStatusBadgeAssetSummary[]>(
      `/api/v1/admin/elevate-status/badge-assets/${levelNumber}?academicYear=${encodeURIComponent(academicYear)}`,
      form
    );
  },
  resetElevateStatusBadge: (academicYear: string, levelNumber: number) =>
    sendJson<never, ElevateStatusBadgeAssetSummary[]>(
      `/api/v1/admin/elevate-status/badge-assets/${levelNumber}?academicYear=${encodeURIComponent(academicYear)}`,
      "DELETE"
    ),
  staffProfile: (staffId: string, academicYear?: string) =>
    getJson<StaffProfileDetail>(
      `/api/v1/staff-profiles/${staffId}${academicYear ? `?academicYear=${encodeURIComponent(academicYear)}` : ""}`
    ),
  staffProfileSectionSummary: (staffId: string, academicYear: string, signal?: AbortSignal) =>
    getJson<StaffProfileSectionSummary>(
      `/api/v1/staff-profiles/${staffId}/section-summary?academicYear=${encodeURIComponent(academicYear)}`,
      signal
    ),
  staffProfileReflections: (staffId: string, academicYear: string, page = 1, pageSize = 20, signal?: AbortSignal) =>
    getJson<PagedResult<StaffReflectionSummary>>(
      `/api/v1/staff-profiles/${staffId}/reflections?academicYear=${encodeURIComponent(academicYear)}&page=${page}&pageSize=${pageSize}`,
      signal
    ),
  staffProfileCpd: (staffId: string, academicYear: string, page = 1, pageSize = 20, signal?: AbortSignal) =>
    getJson<PagedResult<StaffCpdRecordSummary>>(
      `/api/v1/staff-profiles/${staffId}/cpd?academicYear=${encodeURIComponent(academicYear)}&page=${page}&pageSize=${pageSize}`,
      signal
    ),
  staffProfileCoaching: (staffId: string, academicYear: string, page = 1, pageSize = 20, signal?: AbortSignal) =>
    getJson<PagedResult<StaffProfileCoachingSummary>>(
      `/api/v1/staff-profiles/${staffId}/coaching?academicYear=${encodeURIComponent(academicYear)}&page=${page}&pageSize=${pageSize}`,
      signal
    ),
  staffProfileLiv: (staffId: string, academicYear: string, page = 1, pageSize = 20, signal?: AbortSignal) =>
    getJson<PagedResult<StaffProfileLivSummary>>(
      `/api/v1/staff-profiles/${staffId}/liv?academicYear=${encodeURIComponent(academicYear)}&page=${page}&pageSize=${pageSize}`,
      signal
    ),
  staffProfileProbation: (staffId: string, page = 1, pageSize = 20, signal?: AbortSignal) =>
    getJson<PagedResult<StaffProfileProbationSummary>>(
      `/api/v1/staff-profiles/${staffId}/probation?page=${page}&pageSize=${pageSize}`,
      signal
    ),
  staffProfileActions: (staffId: string, academicYear: string, page = 1, pageSize = 20, signal?: AbortSignal) =>
    getJson<PagedResult<StaffProfileActionSummary>>(
      `/api/v1/staff-profiles/${staffId}/actions?academicYear=${encodeURIComponent(academicYear)}&page=${page}&pageSize=${pageSize}`,
      signal
    ),
  saveElevateStatusLevel: (staffId: string, levelNumber: number, request: SaveElevateStatusLevelRequest) =>
    sendJson<SaveElevateStatusLevelRequest, StaffProfileDetail["elevateStatus"]>(
      `/api/v1/staff-profiles/${staffId}/elevate-status/${levelNumber}`,
      "PUT",
      request
    ),
  elevatePracticeMe: () => getJson<ElevatePracticeWorkspace>("/api/v1/elevate-practice/me"),
  saveElevatePractice: (request: SaveElevatePracticeAssessmentRequest) =>
    sendJson<SaveElevatePracticeAssessmentRequest, ElevatePracticeWorkspace>("/api/v1/elevate-practice/me", "PUT", request),
  elevatePracticeProgress: () => getJson<ElevatePracticeProgress[]>("/api/v1/elevate-practice/progress"),
  adminElevatePracticeRecord: (assessmentId: string) =>
    getJson<ElevatePracticeWorkspace>(`/api/v1/elevate-practice/admin/records/${assessmentId}`),
  saveAdminElevatePracticeRecord: (assessmentId: string, request: AdminSaveElevatePracticeAssessmentRequest) =>
    sendJson<AdminSaveElevatePracticeAssessmentRequest, ElevatePracticeWorkspace>(
      `/api/v1/elevate-practice/admin/records/${assessmentId}`,
      "PUT",
      request
    ),
  deleteAdminElevatePracticeRecord: (assessmentId: string) =>
    sendJson(`/api/v1/elevate-practice/admin/records/${assessmentId}`, "DELETE"),
  elevatePracticeAudit: (assessmentId: string) =>
    getJson<ElevatePracticeAudit[]>(`/api/v1/elevate-practice/admin/records/${assessmentId}/audit`),
  elevatePracticeResult: (staffId: string) =>
    getJson<ElevatePracticeWorkspace>(`/api/v1/elevate-practice/staff/${staffId}/latest`),
  saveStaffElevatePracticeRecord: (staffId: string, assessmentId: string, request: AdminSaveElevatePracticeAssessmentRequest) =>
    sendJson<AdminSaveElevatePracticeAssessmentRequest, ElevatePracticeWorkspace>(
      `/api/v1/elevate-practice/staff/${staffId}/records/${assessmentId}`,
      "PUT",
      request
    ),
  elevatePracticeRecord: (recordId: string) =>
    getJson<ElevatePracticeWorkspace>(`/api/v1/elevate-practice/records/${recordId}`),
  coachingSessions: () => getJson<CoachingSessionSummary[]>("/api/v1/coaching/sessions"),
  coachingConfiguration: () => getJson<CoachingConfiguration>("/api/v1/coaching/configuration"),
  updateCoachingConfiguration: (maxActionsPerSession: number) =>
    sendJson<{ maxActionsPerSession: number }, { maxActionsPerSession: number }>(
      "/api/v1/admin/coaching/configuration",
      "PUT",
      { maxActionsPerSession }
    ),
  coachingSession: (id: string) => getJson<CoachingSessionDetail>(`/api/v1/coaching/sessions/${id}`),
  coachingContext: (staffId: string, cycleId?: string) =>
    getJson<CoachingContext>(
      `/api/v1/coaching/staff/${staffId}/context${cycleId ? `?cycleId=${encodeURIComponent(cycleId)}` : ""}`
    ),
  createCoachingSession: (request: SaveCoachingSessionRequest) =>
    sendJson<SaveCoachingSessionRequest, CoachingSessionSaveSummary>("/api/v1/coaching/sessions", "POST", request),
  updateCoachingSession: (id: string, request: SaveCoachingSessionRequest) =>
    sendJson<SaveCoachingSessionRequest, CoachingSessionSaveSummary>(`/api/v1/coaching/sessions/${id}`, "PUT", request),
  createStaffReflection: (staffId: string) =>
    sendJson<never, StaffReflectionSummary>(`/api/v1/staff-profiles/${staffId}/reflections`, "POST"),
  updateStaffReflection: (staffId: string, reflectionId: string, request: SaveStaffReflectionRequest) =>
    sendJson<SaveStaffReflectionRequest, StaffReflectionSummary>(
      `/api/v1/staff-profiles/${staffId}/reflections/${reflectionId}`,
      "PUT",
      request
    ),
  adminUsers: () => getJson<AdminUserSummary[]>("/api/v1/admin/users"),
  adminOrganisationStaff: () =>
    getJson<AdminOrganisationStaff[]>("/api/v1/admin/organisation/staff"),
  adminOrganisationStructure: () =>
    getJson<AdminOrganisationStructure>("/api/v1/admin/organisation/structure"),
  createOrganisationUnit: (request: SaveOrganisationUnitRequest) =>
    sendJson<SaveOrganisationUnitRequest, { id: string }>("/api/v1/admin/organisation/units", "POST", request),
  updateOrganisationUnit: (orgUnitId: string, request: SaveOrganisationUnitRequest) =>
    sendJson<SaveOrganisationUnitRequest>(`/api/v1/admin/organisation/units/${orgUnitId}`, "PUT", request),
  organisationUnitImpact: (orgUnitId: string) =>
    getJson<OrganisationChangeImpact>(`/api/v1/admin/organisation/units/${orgUnitId}/impact`),
  setOrganisationUnitStatus: (orgUnitId: string, isActive: boolean, reason: string, confirmImpact: boolean) =>
    sendJson(`/api/v1/admin/organisation/units/${orgUnitId}/status`, "POST", { isActive, reason, confirmImpact }),
  organisationMigrationReviews: () =>
    getJson<OrganisationMigrationReview[]>("/api/v1/admin/organisation/migration-reviews"),
  saveOrgUnitManager: (orgUnitId: string, request: SaveOrgUnitManagerRequest) =>
    sendJson<SaveOrgUnitManagerRequest, { id: string }>(
      `/api/v1/admin/organisation/units/${orgUnitId}/manager`,
      "PUT",
      request
    ),
  archiveOrgUnitManager: (orgUnitId: string, reason: string) =>
    sendJson(`/api/v1/admin/organisation/units/${orgUnitId}/manager/archive`, "POST", { reason }),
  saveOrganisationMembership: (staffId: string, request: SaveOrganisationMembershipRequest) =>
    sendJson<SaveOrganisationMembershipRequest, { id: string }>(
      `/api/v1/admin/organisation/staff/${staffId}/memberships`,
      "POST",
      request
    ),
  setPrimaryOrganisationMembership: (staffId: string, membershipId: string) =>
    sendJson(`/api/v1/admin/organisation/staff/${staffId}/memberships/${membershipId}/primary`, "POST"),
  archiveOrganisationMembership: (staffId: string, membershipId: string, reason: string) =>
    sendJson(`/api/v1/admin/organisation/staff/${staffId}/memberships/${membershipId}/archive`, "POST", { reason }),
  organisationMembershipImpact: (staffId: string, membershipId: string) =>
    getJson<MembershipChangeImpact>(`/api/v1/admin/organisation/staff/${staffId}/memberships/${membershipId}/impact`),
  saveManagerRelationship: (staffId: string, request: SaveManagerRelationshipRequest) =>
    sendJson<SaveManagerRelationshipRequest, { id: string }>(
      `/api/v1/admin/organisation/staff/${staffId}/managers`,
      "POST",
      request
    ),
  archiveManagerRelationship: (staffId: string, relationshipId: string, reason: string) =>
    sendJson(`/api/v1/admin/organisation/staff/${staffId}/managers/${relationshipId}/archive`, "POST", { reason }),
  adminManagedLists: () => getJson<AdminManagedList[]>("/api/v1/admin/lists"),
  updateManagedListValue: (lookupKey: string, id: string, displayName: string) =>
    sendJson(`/api/v1/admin/lists/${encodeURIComponent(lookupKey)}/values/${id}`, "PUT", { displayName }),
  setManagedListValueStatus: (lookupKey: string, id: string, isActive: boolean) =>
    sendJson(`/api/v1/admin/lists/${encodeURIComponent(lookupKey)}/values/${id}/status`, "POST", { isActive }),
  reorderManagedListValues: (lookupKey: string, valueIds: string[]) =>
    sendJson(`/api/v1/admin/lists/${encodeURIComponent(lookupKey)}/values/reorder`, "PUT", { valueIds }),
  adminRecords: () => getJson<AdminRecord[]>("/api/v1/admin/records"),
  adminRecordAudit: (recordId: string) =>
    getJson<RecordAudit[]>(`/api/v1/admin/records/${recordId}/audit`),
  archiveAdminRecord: (recordId: string, reason: string) =>
    sendJson(`/api/v1/admin/records/${recordId}/archive`, "POST", { reason }),
  restoreAdminRecord: (recordId: string, reason: string) =>
    sendJson(`/api/v1/admin/records/${recordId}/restore`, "POST", { reason }),
  createAdminUser: (request: CreateAdminUserRequest) => sendJson("/api/v1/admin/users", "POST", request),
  updateAdminUser: (id: string, request: UpdateAdminUserRequest) =>
    sendJson(`/api/v1/admin/users/${id}`, "PUT", request),
  adminRoles: () => getJson<AdminRoleSummary[]>("/api/v1/admin/roles"),
  updateFormTemplateStructure: (id: string, request: UpdateFormTemplateStructureRequest) =>
    sendJson(`/api/v1/form-templates/${id}/structure`, "PUT", request),
  publishFormTemplate: (id: string) => sendJson(`/api/v1/form-templates/${id}/publish`, "POST"),
  messageTemplates: (includeDeleted = false) =>
    getJson<MessageTemplateSummary[]>(`/api/v1/admin/messaging/templates?includeDeleted=${includeDeleted}`),
  messagingConfiguration: () =>
    getJson<MessagingConfiguration>("/api/v1/admin/messaging/settings"),
  saveMessagingConfiguration: (request: SaveMessagingConfigurationRequest) =>
    sendJson<SaveMessagingConfigurationRequest, MessagingConfiguration>("/api/v1/admin/messaging/settings", "PUT", request),
  messagingParameters: () => getJson<MessagingParameter[]>("/api/v1/admin/messaging/parameters"),
  messageTemplateVersions: (id: string) =>
    getJson<MessageTemplateVersionSummary[]>(`/api/v1/admin/messaging/templates/${id}/versions`),
  createMessageTemplate: (request: SaveMessageTemplateRequest) =>
    sendJson<SaveMessageTemplateRequest, { id: string }>("/api/v1/admin/messaging/templates", "POST", request),
  updateMessageTemplate: (id: string, request: SaveMessageTemplateRequest) =>
    sendJson(`/api/v1/admin/messaging/templates/${id}`, "PUT", request),
  duplicateMessageTemplate: (id: string, messageKey: string, name: string) =>
    sendJson(`/api/v1/admin/messaging/templates/${id}/duplicate`, "POST", { messageKey, name }),
  previewMessageTemplate: (request: SaveMessageTemplateRequest) =>
    sendJson<SaveMessageTemplateRequest, MessagePreview>("/api/v1/admin/messaging/templates/preview", "POST", request),
  setMessageTemplateStatus: (id: string, isActive: boolean, restore: boolean, reason: string) =>
    sendJson(`/api/v1/admin/messaging/templates/${id}/status`, "POST", { isActive, restore, reason }),
  deleteMessageTemplate: (id: string, reason: string) =>
    sendJson(`/api/v1/admin/messaging/templates/${id}/delete`, "POST", { reason }),
  sendTestMessage: (id: string, recipientEmail: string) =>
    sendJson(`/api/v1/admin/messaging/templates/${id}/test`, "POST", { recipientEmail }),
  messageDeliveries: (take = 100) =>
    getJson<MessageDeliverySummary[]>(`/api/v1/admin/messaging/deliveries?take=${take}`),
  retryMessageDelivery: (id: string, reason: string) =>
    sendJson(`/api/v1/admin/messaging/deliveries/${id}/retry`, "POST", { reason }),
  cancelMessageDelivery: (id: string, reason: string) =>
    sendJson(`/api/v1/admin/messaging/deliveries/${id}/cancel`, "POST", { reason })
};
