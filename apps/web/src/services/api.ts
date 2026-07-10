import type {
  ActionSummary,
  AdminRoleSummary,
  AdminUserSummary,
  CreateActionRequest,
  CreateAdminUserRequest,
  CreateFormTemplateRequest,
  CurrentUser,
  DashboardSummary,
  FormDefinition,
  FormTemplateSummary,
  LearningWalkThemeMappingSummary,
  LearningWalkRollupSummary,
  LivRecordSummary,
  ModuleSummary,
  OrgUnitSummary,
  RecordDetail,
  RecordSummary,
  SaveLivRecordRequest,
  StaffProfileDetail,
  StaffProfileRecordSummary,
  StaffProfileSummary,
  StaffSummary,
  SubmitFormRequest,
  UpdateActionRequest,
  UpdateAdminUserRequest,
  UpdateFormSubmissionRequest,
  UpdateFormTemplateStructureRequest,
  UpdateLearningWalkThemeMappingRequest
} from "./types";

import { getAccessToken } from "./auth";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:5001";

export type ApiResult = {
  ok: boolean;
  message?: string;
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
  const response = await fetch(`${apiBaseUrl}${url}`, { headers: await buildHeaders(false) });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }

  return (await response.json()) as T;
}

async function sendJson<TRequest>(url: string, method: "POST" | "PUT", body?: TRequest): Promise<ApiResult> {
  try {
    const response = await fetch(`${apiBaseUrl}${url}`, {
      body: body ? JSON.stringify(body) : undefined,
      headers: await buildHeaders(Boolean(body)),
      method
    });

    if (response.ok) {
      return { ok: true };
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
  } catch {
    return { ok: false, message: "The API could not be reached. Check it is running." };
  }
}

export const api = {
  currentUser: () => getJson<CurrentUser>("/api/v1/me"),
  modules: () => getJson<ModuleSummary[]>("/api/v1/modules"),
  orgUnits: () => getJson<OrgUnitSummary[]>("/api/v1/org-units"),
  staff: () => getJson<StaffSummary[]>("/api/v1/staff"),
  records: () => getJson<RecordSummary[]>("/api/v1/records"),
  recordDetail: (id: string) => getJson<RecordDetail>(`/api/v1/records/${id}`),
  actions: () => getJson<ActionSummary[]>("/api/v1/actions"),
  createAction: (request: CreateActionRequest) => sendJson("/api/v1/actions", "POST", request),
  updateAction: (id: string, request: UpdateActionRequest) => sendJson(`/api/v1/actions/${id}`, "PUT", request),
  dashboards: () => getJson<DashboardSummary[]>("/api/v1/reports/dashboards"),
  learningWalkRollup: () =>
    getJson<LearningWalkRollupSummary[]>("/api/v1/reports/learning-walk-rollup"),
  formTemplates: () => getJson<FormTemplateSummary[]>("/api/v1/form-templates"),
  formDefinition: (templateKey: string) =>
    getJson<FormDefinition>(`/api/v1/form-templates/${templateKey}/definition`),
  learningWalkThemeMappings: () =>
    getJson<LearningWalkThemeMappingSummary[]>("/api/v1/learning-walk/theme-mappings"),
  updateLearningWalkThemeMapping: (request: UpdateLearningWalkThemeMappingRequest) =>
    sendJson("/api/v1/learning-walk/theme-mappings", "PUT", request),
  createFormTemplate: (request: CreateFormTemplateRequest) =>
    sendJson("/api/v1/form-templates", "POST", request),
  archiveFormTemplate: (id: string) => sendJson(`/api/v1/form-templates/${id}/archive`, "POST"),
  submitForm: (request: SubmitFormRequest) => sendJson("/api/v1/form-submissions", "POST", request),
  updateFormSubmission: (id: string, request: UpdateFormSubmissionRequest) =>
    sendJson(`/api/v1/form-submissions/${id}`, "PUT", request),
  changeSubmissionStatus: (id: string, action: "submit" | "reopen" | "archive") =>
    sendJson(`/api/v1/form-submissions/${id}/status`, "POST", { action }),
  livRecords: () => getJson<LivRecordSummary[]>("/api/v1/liv-records"),
  createLivRecord: (request: SaveLivRecordRequest) => sendJson("/api/v1/liv-records", "POST", request),
  updateLivRecord: (id: string, request: SaveLivRecordRequest) =>
    sendJson(`/api/v1/liv-records/${id}`, "PUT", request),
  changeLivStatus: (id: string, action: "submit" | "close" | "reopen" | "archive") =>
    sendJson(`/api/v1/liv-records/${id}/status`, "POST", { action }),
  staffProfiles: () =>
    getJson<StaffProfileSummary[]>("/api/v1/reports/staff-profile-summaries"),
  staffProfileRecords: () => getJson<StaffProfileRecordSummary[]>("/api/v1/staff-profiles"),
  staffProfile: (staffId: string) => getJson<StaffProfileDetail>(`/api/v1/staff-profiles/${staffId}`),
  saveReflection: (staffId: string, pointKey: string, text: string) =>
    sendJson(`/api/v1/staff-profiles/${staffId}/reflections/${pointKey}`, "PUT", { text }),
  adminUsers: () => getJson<AdminUserSummary[]>("/api/v1/admin/users"),
  createAdminUser: (request: CreateAdminUserRequest) => sendJson("/api/v1/admin/users", "POST", request),
  updateAdminUser: (id: string, request: UpdateAdminUserRequest) =>
    sendJson(`/api/v1/admin/users/${id}`, "PUT", request),
  adminRoles: () => getJson<AdminRoleSummary[]>("/api/v1/admin/roles"),
  updateFormTemplateStructure: (id: string, request: UpdateFormTemplateStructureRequest) =>
    sendJson(`/api/v1/form-templates/${id}/structure`, "PUT", request),
  publishFormTemplate: (id: string) => sendJson(`/api/v1/form-templates/${id}/publish`, "POST")
};
