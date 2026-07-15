import type {
  ActionSummary,
  ActionExtensionSummary,
  ActionOwnerOption,
  AdminManagedList,
  AdminOrganisationStructure,
  AdminOrganisationStaff,
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
  CourseSummary,
  CreateActionRequest,
  CreateAdminUserRequest,
  CreateFormTemplateRequest,
  CurrentUser,
  DashboardSummary,
  ElevateEnvironmentPillarSummary,
  ElevatePracticeProgress,
  ElevatePracticeAudit,
  ElevatePracticeWorkspace,
  FormDefinition,
  FormTemplateSummary,
  LearningWalkThemeMappingSummary,
  LearningWalkThemeGroup,
  LearningWalkRollupSummary,
  LivRecordSummary,
  LookupSummary,
  LookupValueSummary,
  ModuleSummary,
  MyTeamMember,
  OrgUnitSummary,
  ProcessDashboardRecordSummary,
  RecordDetail,
  RecordAudit,
  RecordSummary,
  RoomSummary,
  SaveLivRecordRequest,
  SaveManagerRelationshipRequest,
  SaveOrgUnitManagerRequest,
  SaveOrganisationMembershipRequest,
  SaveLivVisitRequest,
  SaveLearningWalkThemeRequest,
  SaveCoachingSessionRequest,
  SaveElevatePracticeAssessmentRequest,
  SaveStaffReflectionRequest,
  StaffProfileDetail,
  StaffProfileRecordSummary,
  StaffProfileSummary,
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
} from "./types";

import { getAccessToken } from "./auth";

const configuredApiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").trim().replace(/\/+$/, "");
const apiBaseUrl = configuredApiBaseUrl || (import.meta.env.DEV ? "http://127.0.0.1:5001" : "");
const configuredTimeout = Number.parseInt(import.meta.env.VITE_API_TIMEOUT_MS ?? "30000", 10);
const apiRequestTimeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout >= 1000
  ? configuredTimeout
  : 30000;

export type ApiResult<T = never> = {
  ok: boolean;
  message?: string;
  data?: T;
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

async function getJson<T>(url: string): Promise<T> {
  const response = await requestApi(url, { headers: await buildHeaders(false) });
  if (!response.ok) {
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

async function requestApi(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), apiRequestTimeoutMs);

  try {
    return await fetch(`${apiBaseUrl}${url}`, {
      ...init,
      cache: "no-store",
      signal: controller.signal
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export const api = {
  currentUser: () => getJson<CurrentUser>("/api/v1/me"),
  staffOnboardingOptions: () => getJson<StaffOnboardingOptions>("/api/v1/onboarding/options"),
  completeStaffOnboarding: (request: CompleteStaffOnboardingRequest) =>
    sendJson<CompleteStaffOnboardingRequest, CurrentUser>("/api/v1/onboarding", "POST", request),
  modules: () => getJson<ModuleSummary[]>("/api/v1/modules"),
  lookups: () => getJson<LookupSummary[]>("/api/v1/lookups"),
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
  records: () => getJson<RecordSummary[]>("/api/v1/records"),
  recordDetail: (id: string) => getJson<RecordDetail>(`/api/v1/records/${id}`),
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
  actions: (includeDeleted = false) => getJson<ActionSummary[]>(`/api/v1/actions${includeDeleted ? "?includeDeleted=true" : ""}`),
  actionOwnerOptions: (sourceRecordId?: string, subjectStaffId?: string) => {
    const parameters = new URLSearchParams();
    if (sourceRecordId) parameters.set("sourceRecordId", sourceRecordId);
    if (subjectStaffId) parameters.set("subjectStaffId", subjectStaffId);
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
  processDashboardRecords: () =>
    getJson<ProcessDashboardRecordSummary[]>("/api/v1/reports/process-records"),
  learningWalkRollup: () =>
    getJson<LearningWalkRollupSummary[]>("/api/v1/reports/learning-walk-rollup"),
  formTemplates: () => getJson<FormTemplateSummary[]>("/api/v1/form-templates"),
  formDefinition: (templateKey: string) =>
    getJson<FormDefinition>(`/api/v1/form-templates/${templateKey}/definition`),
  workScrutinyTemplate: (orgUnitId: string) =>
    getJson<FormDefinition>(`/api/v1/work-scrutiny/template/${encodeURIComponent(orgUnitId)}`),
  learningWalkThemeMappings: () =>
    getJson<LearningWalkThemeMappingSummary[]>("/api/v1/learning-walk/theme-mappings"),
  updateLearningWalkThemeMapping: (request: UpdateLearningWalkThemeMappingRequest) =>
    sendJson("/api/v1/learning-walk/theme-mappings", "PUT", request),
  learningWalkThemes: () =>
    getJson<LearningWalkThemeGroup[]>("/api/v1/learning-walk/themes"),
  adminLearningWalkThemes: () =>
    getJson<LearningWalkThemeGroup[]>("/api/v1/admin/learning-walk/themes"),
  createLearningWalkTheme: (request: SaveLearningWalkThemeRequest) =>
    sendJson<SaveLearningWalkThemeRequest, { id: string }>("/api/v1/admin/learning-walk/themes", "POST", request),
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
  livRecords: () => getJson<LivRecordSummary[]>("/api/v1/liv-records"),
  createLivRecord: (request: SaveLivRecordRequest) => sendJson("/api/v1/liv-records", "POST", request),
  updateLivRecord: (id: string, request: SaveLivRecordRequest) =>
    sendJson(`/api/v1/liv-records/${id}`, "PUT", request),
  addLivVisit: (id: string, request: SaveLivVisitRequest) =>
    sendJson<SaveLivVisitRequest, { id: string; visitNumber: number }>(`/api/v1/liv-records/${id}/visits`, "POST", request),
  updateLivVisit: (id: string, visitId: string, request: SaveLivVisitRequest) =>
    sendJson(`/api/v1/liv-records/${id}/visits/${visitId}`, "PUT", request),
  changeLivStatus: (id: string, action: "close" | "reopen" | "archive") =>
    sendJson(`/api/v1/liv-records/${id}/status`, "POST", { action }),
  staffProfiles: () =>
    getJson<StaffProfileSummary[]>("/api/v1/reports/staff-profile-summaries"),
  staffProfileRecords: () => getJson<StaffProfileRecordSummary[]>("/api/v1/staff-profiles"),
  staffProfile: (staffId: string) => getJson<StaffProfileDetail>(`/api/v1/staff-profiles/${staffId}`),
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
  elevatePracticeRecord: (recordId: string) =>
    getJson<ElevatePracticeWorkspace>(`/api/v1/elevate-practice/records/${recordId}`),
  coachingSessions: () => getJson<CoachingSessionSummary[]>("/api/v1/coaching/sessions"),
  coachingConfiguration: () => getJson<CoachingConfiguration>("/api/v1/coaching/configuration"),
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
  publishFormTemplate: (id: string) => sendJson(`/api/v1/form-templates/${id}/publish`, "POST")
};
