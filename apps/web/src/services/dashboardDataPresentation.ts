import type { DashboardRecordData, ElevateStatusStaffSummary, ProcessDashboardRecordSummary } from "./types";
import { compareListValues } from "./listQuery";

export type DashboardExplorerColumn = {
  key: string;
  label: string;
  section: string;
  kind?: "record" | "person" | "date" | "number" | "text";
};

export type DashboardExplorerRow = {
  id: string;
  record: DashboardExplorerSourceRecord;
  values: Record<string, string>;
  searchText: string;
};
export type DashboardFieldFilter = { key: string; operator: "contains" | "equals" | "not_equals" | "empty" | "not_empty" | "gte" | "lte"; value: string };

export type DashboardExplorerSourceRecord = Omit<ProcessDashboardRecordSummary, "processKey"> & { processKey: string; reviewerDisplayName?: string };

const baseColumns: DashboardExplorerColumn[] = [
  { key: "title", label: "Record", section: "Record", kind: "record" },
  { key: "subject", label: "Staff member", section: "People", kind: "person" },
  { key: "submitter", label: "Submitted by", section: "People", kind: "person" },
  { key: "owner", label: "Record owner", section: "People", kind: "person" },
  { key: "reviewer", label: "Reviewer", section: "People", kind: "person" },
  { key: "date", label: "Record date", section: "Record", kind: "date" },
  { key: "submitted", label: "Submitted on", section: "Record", kind: "date" },
  { key: "created", label: "Created on", section: "Record", kind: "date" },
  { key: "status", label: "Status", section: "Record" },
  { key: "faculty", label: "Faculty", section: "Organisation" },
  { key: "team", label: "Team / area", section: "Organisation" },
  { key: "delivery", label: "Delivery area", section: "Organisation" },
  { key: "focus", label: "Focus / theme", section: "Form summary" },
  { key: "detail", label: "Activity / outcome", section: "Form summary" },
  { key: "summary", label: "Summary", section: "Form summary" },
  { key: "participants", label: "Participants", section: "Form summary", kind: "number" },
  { key: "minutes", label: "Learning minutes", section: "Form summary", kind: "number" },
  { key: "credits", label: "Attendance credits", section: "Form summary", kind: "number" },
  { key: "sample", label: "Sample / visits", section: "Form summary", kind: "number" },
  { key: "score", label: "Average rating", section: "Form summary", kind: "number" },
  { key: "barriers", label: "Barriers recorded", section: "Form summary", kind: "number" },
  { key: "year", label: "Academic year", section: "Record" }
];

const knownValues: Record<string, string> = {
  in_progress: "In progress", not_started: "Not started", not_applicable: "Not applicable", not_seen: "Not seen",
  n_a: "Not applicable", completed: "Completed", submitted: "Submitted", draft: "Draft", archived: "Archived",
  awaiting_review: "Awaiting review", below_expected: "Below expected", at_expected: "At expected", above_expected: "Above expected",
  observer_draft: "Observer review", awaiting_lecturer: "With lecturer", awaiting_finalisation: "Final sign-off", open: "Open", overdue: "Overdue", complete: "Complete", cancelled: "Cancelled"
};
const dateFormatter = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" });

export function dashboardFieldLabel(key: string) {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/^./, character => character.toUpperCase());
}

export function dashboardDate(value?: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
}

export function dashboardDateTime(value?: string | null) {
  if (!value) return "Not recorded";
  const normalized = /^\d{4}-\d{2}-\d{2}T/.test(value) && !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? `${value}Z` : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? value : dateTimeFormatter.format(date);
}

/** Values remain plain text. Arrays and structured saved answers stay readable without leaking JSON syntax into cells. */
export function displayDashboardValue(value: unknown): string {
  if (value == null || value === "") return "Not recorded";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map(displayDashboardValue).filter(item => item !== "Not recorded").join("; ") || "Not recorded";
  if (typeof value === "object") return Object.entries(value).map(([key, item]) => `${dashboardFieldLabel(key)}: ${displayDashboardValue(item)}`).join("; ");
  const text = String(value).trim();
  if ((text.startsWith("[") && text.endsWith("]")) || (text.startsWith("{") && text.endsWith("}"))) {
    try { return displayDashboardValue(JSON.parse(text)); } catch { /* A saved narrative that resembles JSON remains intact. */ }
  }
  if (/^(?:true|false)$/i.test(text)) return text.toLowerCase() === "true" ? "Yes" : "No";
  if (/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(text)) return text.includes("T") ? dashboardDateTime(text) : dashboardDate(text);
  if (/^n\/?a$/i.test(text)) return "Not applicable";
  return knownValues[text.toLowerCase()] ?? text;
}

export function normalizeDashboardSearch(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

// The scoped API removes internal fields. Recognise legacy technical names without suppressing ordinary questions about visibility.
export function isDashboardBusinessColumn(column: { key: string; label: string }) {
  if (/^field_[a-f0-9]{64}$/.test(column.key)) return true;
  const technical = new Set(["visibility", "sectionvisibility", "recordvisibility", "visibilitystatus", "visibilitysetting", "visibletostaff", "rowversion", "concurrencystamp", "sectionsharing"]);
  const normalize = (value: string) => value.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return !technical.has(normalize(column.key)) && !technical.has(normalize(column.label.split(" - ").at(-1) ?? column.label));
}

export function dashboardExplorerColumns(processKey: string, data?: DashboardRecordData | null, records: ProcessDashboardRecordSummary[] = []): DashboardExplorerColumn[] {
  const processColumns = baseColumns.filter(column => {
    if (["participants", "minutes", "credits"].includes(column.key)) return processKey === "cpd_event";
    if (column.key === "barriers") return ["eli", "elevate_environment"].includes(processKey);
    if (column.key === "reviewer") return ["qa_review", "uco_tla_review"].includes(processKey);
    if (column.key === "sample") return ["liv", "als_liv", "probation_case", "work_scrutiny", "learning_walk", "als_learning_walk"].includes(processKey);
    if (column.key === "score") return !["cpd_event", "coaching_session", "elevate_environment", "probation_case"].includes(processKey);
    return true;
  }).map(column => column.key === "sample" ? { ...column, label: ["liv", "als_liv"].includes(processKey) ? "Visits recorded" : processKey === "probation_case" ? "Observation number" : "Sample size" } : column.key === "reviewer" && processKey === "uco_tla_review" ? { ...column, label: "Observer" } : column);
  const seen = new Set<string>();
  const recordValues = new Map(records.map(record => [record.id, dashboardSummaryValues(record)]));
  return [...processColumns, ...(data?.columns ?? []).filter(column => {
    if (!isDashboardBusinessColumn(column) || seen.has(column.key)) return false;
    seen.add(column.key);
    const context = contextColumnKey(column, processKey);
    if (!context || !processColumns.some(item => item.key === context)) return true;
    return (data?.rows ?? []).some(row => {
      const existing = recordValues.get(row.recordId)?.[context], projected = displayDashboardValue(row.values[column.key]);
      if (!existing || existing === "Not recorded" || existing === "Unassigned" || projected === "Not recorded") return false;
      const left = normalizeDashboardSearch(existing), right = normalizeDashboardSearch(projected);
      return left !== right && !(["faculty", "team"].includes(context) && (` ${left} `).includes(` ${right} `));
    });
  }).map(column => ({
    key: `answer:${column.key}`, label: column.label || dashboardFieldLabel(column.key), section: column.section === "Record" ? "Saved record context" : column.section || "Saved form answers", kind: column.dataType === "number" ? "number" as const : column.dataType === "date" || column.dataType === "datetime" ? "date" as const : "text" as const
  }))];
}

export function recommendedDashboardColumns(processKey: string, data?: DashboardRecordData | null): string[] {
  const named = ["eli", "liv", "als_liv", "probation_case", "coaching_session", "uco_tla_review"].includes(processKey);
  const savedDefaults = processKey === "actions" ? ["due date", "progress status"] : processKey === "uco_tla_review" ? ["course title", "module title"] : processKey === "qa_review" ? ["course or programme"] : [];
  const savedKeys = savedDefaults.flatMap(label => {
    const column = data?.columns.find(item => normalizeDashboardSearch(item.label) === label);
    return column ? [`answer:${column.key}`] : [];
  });
  if (processKey === "actions") return ["title", "subject", "owner", "date", "faculty", "team", "status", ...savedKeys];
  if (processKey === "qa_review") return ["title", "subject", "reviewer", "date", "faculty", "team", "status", ...savedKeys];
  const specific = processKey === "cpd_event" ? ["participants", "minutes"] : processKey === "uco_tla_review" ? ["reviewer"] : ["learning_walk", "als_learning_walk"].includes(processKey) ? ["delivery", "focus"] : processKey === "work_scrutiny" ? ["sample", "focus"] : ["focus"];
  return ["title", ...(named ? ["subject"] : []), "submitter", "date", "faculty", "team", "status", ...specific, ...(processKey === "elevate_environment" ? ["barriers"] : []), ...savedKeys];
}

export function buildDashboardExplorerRows(records: ProcessDashboardRecordSummary[], columns: DashboardExplorerColumn[], data?: DashboardRecordData | null, processKey = "overview"): DashboardExplorerRow[] {
  const answersByRecord = new Map<string, Map<string, string[]>>();
  const relatedAnswers = new Map<string, string[]>();
  for (const table of data?.relatedTables ?? []) {
    const safeKeys = new Set(table.columns.filter(isDashboardBusinessColumn).map(column => column.key));
    for (const row of table.rows) {
      const answers = relatedAnswers.get(row.recordId) ?? [];
      answers.push(...Object.entries(row.values).filter(([key]) => safeKeys.has(key)).map(([, value]) => displayDashboardValue(value)));
      relatedAnswers.set(row.recordId, answers);
    }
  }
  for (const row of data?.rows ?? []) {
    const values = answersByRecord.get(row.recordId) ?? new Map<string, string[]>();
    for (const [key, value] of Object.entries(row.values)) {
      const display = displayDashboardValue(value), previous = values.get(key) ?? [];
      if (!previous.includes(display)) previous.push(display);
      values.set(key, previous);
    }
    answersByRecord.set(row.recordId, values);
  }
  const knownIds = new Set(records.map(record => record.id));
  const projected = projectionRecords(data, processKey).filter(record => !knownIds.has(record.id));
  const sourceRecords: DashboardExplorerSourceRecord[] = [...records, ...projected];
  const contextColumns = (data?.columns ?? []).flatMap(column => { const context = contextColumnKey(column, processKey); return context ? [{ column, context }] : []; });
  return sourceRecords.map(record => {
    const values = dashboardSummaryValues(record);
    for (const { column, context } of contextColumns) {
      const saved = answersByRecord.get(record.id)?.get(column.key)?.filter(value => value !== "Not recorded").join("\n");
      if (context && saved && ["Not recorded", "Unassigned", ""].includes(values[context] ?? "")) values[context] = saved;
    }
    for (const column of columns.filter(item => item.key.startsWith("answer:"))) {
      const answers = answersByRecord.get(record.id)?.get(column.key.slice(7)) ?? [];
      values[column.key] = (answers.length > 1 ? answers.filter(value => value !== "Not recorded") : answers).join("\n") || "Not recorded";
    }
    return { id: record.id, record, values, searchText: normalizeDashboardSearch([...Object.values(values), ...(relatedAnswers.get(record.id) ?? [])].filter(value => value !== "Not recorded").join(" ")) };
  });
}

function dashboardSummaryValues(record: DashboardExplorerSourceRecord): Record<string, string> {
  const area = record.areaName ? `${record.areaName}${record.areaCode ? ` (${record.areaCode})` : ""}` : record.areaCode;
  return {
    title: record.title, subject: displayDashboardValue(record.subjectDisplayName), submitter: displayDashboardValue(record.submitterDisplayName), owner: displayDashboardValue(record.ownerDisplayName), reviewer: displayDashboardValue(record.reviewerDisplayName),
    date: dashboardDate(record.recordDate ?? record.createdAt), submitted: dashboardDateTime(record.submittedAt), created: dashboardDateTime(record.createdAt), status: displayDashboardValue(record.status),
    faculty: record.parentAreaCode ?? record.areaCode ?? "Unassigned", team: area ?? "Unassigned", delivery: record.deliveryAreaName ?? displayDashboardValue(record.deliveryAreaKey),
    focus: displayDashboardValue(record.theme?.replace(/\s*\|\s*/g, "; ")), detail: displayDashboardValue(record.detail), summary: displayDashboardValue(record.summary),
    participants: String(record.participantCount), minutes: String(record.learningMinutes), credits: String(record.attendanceCredits), sample: String(record.sampleSize),
    score: record.scoreCount > 0 ? `${(record.scoreTotal / record.scoreCount).toFixed(1)} / ${record.scoreMaximum}` : "Not recorded", barriers: String(record.barrierCount), year: displayDashboardValue(record.academicYear)
  };
}

function contextColumnKey(column: { label: string; section?: string | null }, processKey: string): string | undefined {
  if (column.section !== "Record") return undefined;
  const labels: Record<string, string> = {
    "record title": "title", "title": "title", "action title": "title", "action": "title",
    "staff member": "subject", "lecturer": "subject", "associated staff member": "subject", "submitted by": "submitter",
    "record owner": "owner", "owner": "owner", "status": "status", "workflow status": "status", "academic year": "year",
    "faculty": "faculty", "sub team": "team", "team": "team", "teams": "team"
  };
  const label = normalizeDashboardSearch(column.label);
  if (processKey === "qa_review" && label === "activity") return "title";
  if ((processKey === "qa_review" && label === "reviewer") || (processKey === "uco_tla_review" && label === "observer")) return "reviewer";
  return labels[label];
}

/** UCO reviews and standalone actions have no process-record summary. Their scoped business projection supplies the register rows. */
function projectionRecords(data: DashboardRecordData | null | undefined, processKey: string): DashboardExplorerSourceRecord[] {
  const seen = new Set<string>();
  const labels = new Map((data?.columns ?? []).map(column => [normalizeDashboardSearch(column.label), column.key]));
  const value = (values: Record<string, string | null>, alternatives: string[]) => {
    for (const label of alternatives) {
      const key = labels.get(label);
      if (key && values[key]?.trim()) return values[key]!.trim();
    }
    return undefined;
  };
  return (data?.rows ?? []).filter(row => {
    if (seen.has(row.recordId)) return false;
    seen.add(row.recordId); return true;
  }).map((row, index) => ({
    id: row.recordId, processKey,
    title: value(row.values, processKey === "qa_review" ? ["activity", "record title", "title"] : ["record title", "action title", "review title", "title", "record", "action", "review", "activity"]) ?? `${processKey === "actions" ? "Action" : processKey === "qa_review" ? "Submission" : "Review"} ${index + 1}`,
    status: value(row.values, ["status", "workflow status", "review status", "action status", "submission status"]) ?? "Not recorded",
    subjectDisplayName: value(row.values, ["staff member", "associated staff member", "associated staff", "practitioner", "lecturer", "lecturer name", "subject", "staff name", "staff"]),
    submitterDisplayName: value(row.values, ["submitted by", "submitter", "submitter name"]),
    reviewerDisplayName: value(row.values, ["reviewer", "reviewer name", "observer", "observer name"]),
    ownerDisplayName: value(row.values, ["record owner", "action owner", "owner", "owner name"]),
    recordDate: projectionDate(value(row.values, ["record date", "action date", "review date", "observation date and time", "observation date", "observation at", "activity date", "activity at", "date", "created on", "created at"])),
    createdAt: projectionDate(value(row.values, ["created on", "created at", "record date", "review date", "observation date and time", "observation date", "observation at", "activity date", "activity at", "date"])) ?? "",
    submittedAt: projectionDate(value(row.values, ["submitted on", "submitted at", "submission date"])),
    parentAreaCode: value(row.values, ["faculty", "faculty name", "faculty code"]),
    areaCode: value(row.values, ["team code", "sub team code", "area code"]), areaName: value(row.values, ["team", "teams", "sub team", "team name", "area", "area name"]),
    academicYear: value(row.values, ["academic year"]),
    summary: value(row.values, ["summary", "description", "action description"]), detail: value(row.values, ["outcome", "review outcome", "activity"]),
    theme: value(row.values, ["theme", "themes", "focus", "focus area", "action theme"]),
    participantCount: 0, attendanceCredits: 0, learningMinutes: 0, sampleSize: 0, scoreTotal: 0, scoreCount: 0, barrierCount: 0, scoreMaximum: 0
  }));
}

function projectionDate(value?: string) {
  if (!value) return value;
  const match = /^(\d{1,2}) ([A-Za-z]{3}) (\d{4})(?:,? (\d{2}):(\d{2}))?(?: UTC)?$/.exec(value);
  if (!match) return value;
  const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(match[2].toLowerCase());
  return month < 0 ? value : new Date(Date.UTC(Number(match[3]), month, Number(match[1]), Number(match[4] ?? 0), Number(match[5] ?? 0))).toISOString();
}

function explorerSortValue(row: DashboardExplorerRow, key: string, kind?: DashboardExplorerColumn["kind"]) {
  const displayed = row.values[key];
  if (!displayed || displayed === "Not recorded" || displayed === "Unassigned") return null;
  if (["date", "created", "submitted"].includes(key)) {
    const value = key === "submitted" ? row.record.submittedAt : key === "created" ? row.record.createdAt : row.record.recordDate ?? row.record.createdAt;
    return value ? new Date(value) : null;
  }
  if (kind === "date") return new Date(projectionDate(displayed) ?? "");
  if (kind === "number") return key === "score" ? Number.parseFloat(displayed) : Number(displayed.replaceAll(",", ""));
  return displayed;
}

export function filterDashboardExplorerRows(rows: DashboardExplorerRow[], query: string, sortKey: string, direction: "asc" | "desc", columns: DashboardExplorerColumn[] = [], fieldFilters: DashboardFieldFilter[] = []) {
  const terms = normalizeDashboardSearch(query).split(" ").filter(Boolean);
  const kinds = new Map(columns.map(column => [column.key, column.kind]));
  return rows.filter(row => terms.every(term => row.searchText.includes(term)) && fieldFilters.every(filter => {
    if (!kinds.has(filter.key)) return true;
    const raw = row.values[filter.key], empty = !raw || raw === "Not recorded" || raw === "Unassigned";
    if (filter.operator === "empty") return empty;
    if (filter.operator === "not_empty") return !empty;
    if (!filter.value.trim()) return true;
    const actual = normalizeDashboardSearch(raw ?? ""), target = normalizeDashboardSearch(filter.value);
    if (filter.operator === "contains") return actual.includes(target);
    if (filter.operator === "equals") return actual === target;
    if (filter.operator === "not_equals") return actual !== target;
    const kind = kinds.get(filter.key), value = explorerSortValue(row, filter.key, kind);
    const limit = kind === "date" ? new Date(projectionDate(filter.value) ?? "") : kind === "number" ? Number(filter.value.replaceAll(",", "")) : filter.value;
    if (kind === "date" && filter.operator === "lte" && /^\d{4}-\d{2}-\d{2}$/.test(filter.value) && limit instanceof Date) limit.setUTCHours(23, 59, 59, 999);
    if (value == null || limit instanceof Date && Number.isNaN(limit.getTime()) || typeof limit === "number" && Number.isNaN(limit)) return false;
    const comparison = compareListValues(value, limit);
    return filter.operator === "gte" ? comparison >= 0 : comparison <= 0;
  })).sort((left, right) => {
    return compareListValues(explorerSortValue(left, sortKey, kinds.get(sortKey)), explorerSortValue(right, sortKey, kinds.get(sortKey)), direction) || left.id.localeCompare(right.id);
  });
}

export function filterElevateStatusStaff(rows: ElevateStatusStaffSummary[], query: string, level: string) {
  const terms = normalizeDashboardSearch(query).split(" ").filter(Boolean);
  return rows.filter(row => (level === "all" || row.currentLevel === Number(level)) && terms.every(term => normalizeDashboardSearch([row.staffName, row.areaName, row.areaCode, row.parentAreaCode, row.currentLevelName, `level ${row.currentLevel}`, row.qualifyingAttendanceCount, row.nextLevelName, row.nextLevel == null ? "Highest level reached" : `level ${row.nextLevel}`, row.sessionsToNextLevel === 0 ? "Attendance threshold met" : row.sessionsToNextLevel, row.lastConfirmedAt ? dashboardDate(row.lastConfirmedAt) : "Not yet confirmed"].join(" ")).includes(term)));
}
