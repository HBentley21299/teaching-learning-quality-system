import { dashboardActionState, isDashboardActionOpen } from "./dashboardActionState";
import type { CpdAttendanceDashboardSummary, DashboardActionSummary, DashboardDimensionFact, DashboardProcessConfiguration, ElevateStatusStaffSummary, EliSubmissionStaffSummary, LivLifecycleDashboardSummary, ProcessDashboardRecordSummary } from "./types";

export type IntelligenceKind = "records" | "staff" | "areas" | "actions";
export type IntelligenceRow = { id: string; title: string; person: string; area: string; date?: string | null; status: string; detail: string; recordId?: string; staffId?: string; actionId?: string; ownerStaffId?: string; amount?: number };
export type IntelligenceChoice = { key: string; label: string; value: number; detail: string; kind: IntelligenceKind; ids: string[]; tone?: "teal" | "blue" | "green" | "amber" | "violet" };
export type IntelligenceBreakdown = { key: string; title: string; detail: string; choices: IntelligenceChoice[] };
export type ProcessIntelligenceInput = {
  processKey: DashboardProcessConfiguration["processKey"]; records: ProcessDashboardRecordSummary[]; facts: DashboardDimensionFact[]; actions: DashboardActionSummary[];
  eliStaff?: EliSubmissionStaffSummary[]; cpdStaff?: CpdAttendanceDashboardSummary[]; statusStaff?: ElevateStatusStaffSummary[]; lifecycle?: LivLifecycleDashboardSummary[];
  participation?: { activeStaffCount: number; participatingStaffCount: number }; showOutcomes?: boolean; showActions?: boolean; showAreaComparison?: boolean;
};
export type IntelligenceModel = { rows: Record<IntelligenceKind, IntelligenceRow[]>; metrics: IntelligenceChoice[]; breakdowns: IntelligenceBreakdown[]; defaultKind: IntelligenceKind; note: string; progress: { value: number | null; label: string; detail: string }; attention: IntelligenceRow[] };
export const processIntelligenceLabels: Record<string, string> = { overview: "College overview", learning_walk: "Learning Walks", als_learning_walk: "ALS Learning Walks", liv: "LIV", als_liv: "ALS LIV", eli: "ELI", probation_case: "Probationary Observations", elevate_environment: "Elevate Environments", coaching_session: "Coaching and Mentoring", work_scrutiny: "Work Scrutiny", cpd_event: "CPD", elevate_status: "Elevate Status" };
export const emptyProcessExploration = { choice: "all", kind: "records" as IntelligenceKind, search: "", area: "all", sort: "date-desc" };
const unique = <T,>(rows: T[], key: (row: T) => string) => [...new Map(rows.map(row => [key(row), row])).values()];
const complete = (status: string) => ["submitted", "completed", "closed"].includes(status.toLowerCase());
const words = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
const percent = (part: number, total: number) => total > 0 && part <= total ? Math.round(part * 100 / total) : null;
const area = (row: { areaName?: string; areaCode?: string }) => row.areaName || row.areaCode || "Area not recorded";
const choice = (key: string, label: string, rows: IntelligenceRow[], kind: IntelligenceKind, detail = "Select to explore", value = rows.length): IntelligenceChoice => ({ key, label, value, detail, kind, ids: rows.map(row => row.id) });

/** Every chart retains the identifiers and grain of the authorised dataset it summarises. */
export function processIntelligenceModel(input: ProcessIntelligenceInput): IntelligenceModel {
  const records = unique(input.records, row => row.id), actions = unique(input.actions.filter(row => !row.isDeleted), row => row.id), recordById = new Map(records.map(row => [row.id, row]));
  // A probation case can contain several observations with identical focus/response values.
  // Facts have no observation identifier: preserve response rows and deduplicate only record cohorts.
  const facts = input.facts.filter(fact => recordById.has(fact.sourceRecordId));
  const rows: IntelligenceModel["rows"] = { records: records.map(record => ({ id: record.id, recordId: record.id, staffId: record.subjectStaffId || undefined, title: record.title,
    person: [record.subjectDisplayName && `Associated staff: ${record.subjectDisplayName}`, record.submitterDisplayName && `Submitter: ${record.submitterDisplayName}`, record.ownerDisplayName && `Owner: ${record.ownerDisplayName}`].filter(Boolean).join(" · ") || "Person not recorded",
    area: area(record), date: record.recordDate || record.createdAt, status: words(record.status), amount: record.participantCount,
    detail: record.processKey === "cpd_event" ? `${record.participantCount} attendances · ${Math.round(record.learningMinutes / 6) / 10} attendance-weighted learning hours · ${record.theme || "Theme not recorded"}`
      : record.processKey === "probation_case" ? `${record.sampleSize} observations · ${record.subjectDisplayName || "Staff member not recorded"}`
      : record.processKey === "elevate_environment" ? `${record.barrierCount} barriers · ${record.detail || record.theme || "Environment review"}`
      : record.processKey === "work_scrutiny" ? `${record.sampleSize} work samples · ${record.theme || record.detail || "Work scrutiny"}`
      : [record.deliveryAreaName, record.theme, record.detail].filter(Boolean).join(" · ") || processIntelligenceLabels[record.processKey] })), staff: [], areas: [], actions: input.showActions === false ? [] : actions.map(action => ({ id: action.id, actionId: action.id, ownerStaffId: action.ownerStaffId, title: action.title, person: action.responsibleStaffNames?.join("; ") || action.ownerStaffName || "Owner not recorded", area: action.teamCode || action.facultyCode || "Area not recorded", date: action.dueDate, status: words(dashboardActionState(action)), detail: [action.sourceRecordTitle || "Earlier origin not recorded", action.subjectStaffName, action.actionTheme].filter(Boolean).join(" · ") })) };
  let defaultKind: IntelligenceKind = "records", note = "Charts count records unless a different unit is stated. Select a card or bar to inspect the matching named records.";
  const finished = rows.records.filter(row => complete(recordById.get(row.id)!.status));
  let progress = { value: percent(finished.length, records.length), label: "Submitted or completed", detail: `${finished.length} of ${records.length} selected records submitted, completed or closed` };
  let metrics = [choice("all", "Records in scope", rows.records, "records", "Reset to all records"), choice("complete", "Submitted or completed", finished, "records"), choice("in-progress", "In progress", rows.records.filter(row => !finished.includes(row)), "records")];
  const breakdowns: IntelligenceBreakdown[] = [];
  const add = (key: string, title: string, detail: string, choices: IntelligenceChoice[]) => { if (choices.length) breakdowns.push({ key, title, detail, choices }); };
  const recordChoice = (key: string, label: string, ids: Set<string>, detail: string, value?: number) => choice(key, label, rows.records.filter(row => ids.has(row.id)), "records", detail, value);
  const groupedFacts = (dimensions: string[], title: string, key: string) => {
    const groups = new Map<string, DashboardDimensionFact[]>();
    for (const fact of facts.filter(fact => dimensions.includes(fact.dimensionKey))) { const groupKey = `${fact.dimensionKey}:${fact.seriesKey}`; groups.set(groupKey, [...(groups.get(groupKey) || []), fact]); }
    add(key, title, "Distinct records containing each selection. A record may appear in more than one category.", [...groups].map(([id, entries]) => recordChoice(`${key}:${id}`, entries[0].seriesLabel, new Set(entries.map(fact => fact.sourceRecordId)), "Records with this selection")).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label)));
  };
  if (input.processKey === "overview") {
    add("process", "Activity by process", "Select a process to explore its records; process totals are not staff counts.", [...new Set(records.map(row => row.processKey))].map(key => choice(`process:${key}`, processIntelligenceLabels[key], rows.records.filter(row => recordById.get(row.id)?.processKey === key), "records")));
    const teams = [...new Set(records.map(row => row.areaCode).filter(Boolean))].length;
    metrics[2] = choice("in-progress", "In-progress records", rows.records.filter(row => !finished.includes(row)), "records", `${teams} recorded areas represented`);
  } else if (input.processKey === "eli") {
    const staff = unique(input.eliStaff || [], row => row.staffId);
    rows.staff = staff.map(row => ({ id: row.staffId, staffId: row.staffId, recordId: row.assessmentRecordId, title: row.staffName, person: row.staffName, area: area(row), date: row.submittedAt, status: row.hasSubmitted ? "Submitted" : "Not submitted", detail: row.hasSubmitted ? "ELI submission recorded for the academic year" : "No submitted ELI for the academic year" }));
    const submitted = rows.staff.filter(row => row.status === "Submitted"), pending = rows.staff.filter(row => row.status !== "Submitted");
    defaultKind = "staff"; metrics = [choice("all", "Eligible staff", rows.staff, "staff", "Academic-year and organisation scope"), choice("eli:submitted", "Staff submitted", submitted, "staff"), choice("eli:pending", "Staff not submitted", pending, "staff")];
    progress = { value: percent(submitted.length, rows.staff.length), label: "ELI submission coverage", detail: `${submitted.length} of ${rows.staff.length} eligible staff · academic-year and organisation scope, independent of record date/status filters` };
    add("submission", "Staff submission position", "One row per eligible staff member. Staff coverage uses the academic year and selected organisation.", metrics.slice(1));
    note = "The staff roster uses annual eligibility. Outcome bars open the filtered assessment records; they do not change the annual coverage denominator.";
    if (input.showOutcomes !== false) groupedFacts(["practice_area_outcome"], "Practice areas assessed", "practice");
  } else if (input.processKey === "elevate_status") {
    const staff = unique(input.statusStaff || [], row => row.staffId);
    rows.staff = staff.map(row => ({ id: row.staffId, staffId: row.staffId, title: row.staffName, person: row.staffName, area: area(row), date: row.lastConfirmedAt, status: row.currentLevelName || "No level yet", amount: row.currentLevel,
      detail: `${row.qualifyingAttendanceCount} qualifying sessions · ${row.nextLevelName ? `${row.sessionsToNextLevel ?? "—"} sessions to ${row.nextLevelName}` : "Highest level achieved"}` }));
    defaultKind = "staff"; const achieved = rows.staff.filter(row => (row.amount || 0) >= 1), near = rows.staff.filter(row => staff.find(person => person.staffId === row.id)?.sessionsToNextLevel === 1);
    metrics = [choice("all", "Staff in scope", rows.staff, "staff", "Reset to all named staff"), choice("status:achieved", "Level achieved", achieved, "staff"), choice("status:next", "One session to next level", near, "staff")];
    add("levels", "Highest achieved level", "Exclusive levels: each person appears once. The detailed badge analysis below also shows cumulative attainment.", [...new Set([0, 1, 2, 3, 4, 5, ...staff.map(row => row.currentLevel)])].map(level => choice(`level:${level}`, level === 0 ? "No level yet" : staff.find(row => row.currentLevel === level)?.currentLevelName || `Level ${level}`, rows.staff.filter(row => row.amount === level), "staff")));
    progress = { value: percent(achieved.length, staff.length), label: "Staff with a level", detail: `${achieved.length} of ${staff.length} named staff in the selected academic-year, organisation and highest-level scope` };
    note = "Select an exact level to see its staff. Session counts and the next level are shown for each person; cumulative badge thresholds remain in detailed analysis.";
  } else if (["liv", "als_liv"].includes(input.processKey)) {
    const lifecycle = unique(input.lifecycle || [], row => row.orgUnitId || `${row.parentAreaCode}:${row.areaCode}`);
    const stages: Array<[keyof LivLifecycleDashboardSummary, string]> = [...(input.processKey === "liv" ? [["requestedCount", "Requested"] as [keyof LivLifecycleDashboardSummary, string]] : []), ["caseStartedCount", "Case started"], ["scheduledCount", "Visit scheduled"], ["visitedCount", "Visit completed"], ["completedCount", "Case closed"]];
    rows.areas = lifecycle.map((row, index) => ({ id: row.orgUnitId || `${row.areaCode}:${index}`, title: area(row), person: `${row.practitionerStaffCount} practitioners / ${row.practitionerStaffDenominator} eligible`, area: area(row), status: "Cumulative case stages", detail: stages.map(([key, label]) => `${label}: ${row[key]}`).join(" · ") + ` · Completed visit forms: ${row.completedVisitCount}` }));
    const totals = (key: keyof LivLifecycleDashboardSummary) => lifecycle.reduce((sum, row) => sum + Number(row[key] || 0), 0);
    add("journey", "LIV case journey", "Cumulative case counts, not additive slices. Select a stage to compare its organisation rows; individual case stages are not inferred from form status.", stages.map(([key, label]) => ({ ...choice(`journey:${key}`, label, rows.areas.filter((_, index) => Number(lifecycle[index][key]) > 0), "areas", "Compare areas with cases at this stage", totals(key)), tone: key === "completedCount" ? "green" : "blue" })));
    progress = { value: percent(totals("visitedCount"), totals("caseStartedCount")), label: "Cases with a completed visit", detail: `${totals("visitedCount")} of ${totals("caseStartedCount")} cases started · ${totals("completedVisitCount")} completed visit forms · annual organisation scope` };
    metrics[1] = choice("journey:visitedCount", "Cases with a completed visit", rows.areas.filter((_, index) => lifecycle[index].visitedCount > 0), "areas", "Compare annual organisation lifecycle data", totals("visitedCount"));
    metrics[2] = choice("journey:scheduledCount", "Cases scheduled", rows.areas.filter((_, index) => lifecycle[index].scheduledCount > 0), "areas", "Compare annual organisation lifecycle data", totals("scheduledCount"));
    note = "The journey uses annual organisation lifecycle totals; record date/status filters apply to the visit register. Stage selections show organisation rows because the source does not assign stages to individual visit records.";
  } else if (input.processKey === "probation_case") {
    const staff = new Map<string, ProcessDashboardRecordSummary[]>();
    for (const record of records) { const key = record.subjectStaffId || record.subjectDisplayName || record.id; staff.set(key, [...(staff.get(key) || []), record]); }
    rows.staff = [...staff].map(([id, cases]) => { const highest = cases.reduce((best, row) => row.sampleSize > best.sampleSize ? row : best, cases[0]); return { id, title: highest.subjectDisplayName || highest.title, staffId: highest.subjectStaffId, recordId: highest.id, person: highest.ownerDisplayName || "Reviewer not recorded", area: area(highest), date: highest.recordDate || highest.createdAt, status: `${Math.min(3, Math.max(0, highest.sampleSize))} observations`, amount: highest.sampleSize, detail: `Highest recorded observation count: ${highest.sampleSize} · ${cases.length} linked case records` }; });
    const stages = [0, 1, 2, 3].map(stage => choice(`probation:${stage}`, stage === 3 ? "3+ observations" : `${stage} observations`, rows.staff.filter(row => Math.min(3, row.amount || 0) === stage), "staff", "Unique staff at this observation stage"));
    add("probation", "Observation journey", "One person per stage, using their highest recorded observation count. Stages are exclusive.", stages);
    metrics[1] = choice("probation:3", "Three observations recorded", rows.staff.filter(row => (row.amount || 0) >= 3), "staff");
    metrics[2] = choice("probation:pending", "Staff below three observations", rows.staff.filter(row => (row.amount || 0) < 3), "staff");
    progress = { value: percent(metrics[1].value, rows.staff.length), label: "Three observations recorded", detail: `${metrics[1].value} of ${rows.staff.length} represented staff · no assumption about staff without a probation record` };
  } else if (input.processKey === "cpd_event") {
    const staff = unique(input.cpdStaff || [], row => row.staffId);
    rows.staff = staff.map(row => ({ id: row.staffId, staffId: row.staffId, title: row.staffName, person: row.staffName, area: area(row), status: `${row.attendanceCount} attendances`, amount: row.attendanceCount, detail: "Confirmed attendance in the selected academic-year and organisation scope" }));
    add("attendance", "Confirmed attendance by staff", "One row per eligible staff member in the academic year and organisation, including staff with no confirmed attendance.", [[0, 0], [1, 1], [2, 3], [4, Infinity]].map(([minimum, maximum]) => choice(`attendance:${minimum}`, minimum === 0 ? "No confirmed attendance" : minimum === 1 ? "1 event" : maximum === Infinity ? "4+ events" : "2–3 events", rows.staff.filter(row => (row.amount || 0) >= minimum && (row.amount || 0) <= maximum), "staff")));
    metrics[1] = choice("cpd:attendances", "Event attendances", rows.records, "records", "Total attendances; a staff member can attend multiple events", records.reduce((sum, row) => sum + row.participantCount, 0));
    metrics[2] = choice("cpd:staff", "Named attendees", rows.staff.filter(row => (row.amount || 0) > 0), "staff", "Staff with at least one confirmed attendance · annual organisation scope");
    metrics.push(choice("cpd:hours", "Learning hours", rows.records, "records", "Attendance-weighted hours across the selected events", Math.round(records.reduce((sum, row) => sum + row.learningMinutes, 0) / 6) / 10));
    note = "Event counts, attendances and learning hours follow the record filters. Named attendance and participation use the academic year and organisation; they are not narrowed by event dates or status.";
    if (input.showOutcomes !== false) groupedFacts(["theme", "focus"], "Professional learning themes", "themes");
  } else if (input.processKey === "elevate_environment") {
    const barriers = rows.records.filter(row => recordById.get(row.id)!.barrierCount > 0);
    metrics[1] = choice("barriers:yes", "Reviews with barriers", barriers, "records", `${records.reduce((sum, row) => sum + row.barrierCount, 0)} barriers across review records`);
    add("barriers", "Environment barriers", "Review records with a recorded barrier. Repeated reviews of the same room count separately; barrier totals are not a count of unique rooms.", [metrics[1], choice("barriers:no", "No recorded barriers", rows.records.filter(row => !barriers.includes(row)), "records")]);
    if (input.showOutcomes !== false) groupedFacts(["pillar_outcome", "focus"], "Environment pillars assessed", "pillars");
  } else if (["learning_walk", "als_learning_walk"].includes(input.processKey)) {
    add("delivery", "Learning Walk delivery areas", "Records by their recorded delivery area; unknown areas remain visible.", [...new Set(records.map(row => row.deliveryAreaName || "Delivery area not recorded"))].map(label => choice(`delivery:${label}`, label, rows.records.filter(row => (recordById.get(row.id)?.deliveryAreaName || "Delivery area not recorded") === label), "records")));
    if (input.showOutcomes !== false) groupedFacts(["focus"], "Focus coverage", "focus");
  } else if (input.processKey === "work_scrutiny") {
    metrics[1] = choice("samples", "Work samples", rows.records, "records", "Total work samples across scrutiny records", records.reduce((sum, row) => sum + row.sampleSize, 0));
    if (input.showOutcomes !== false) groupedFacts(["course", "course_level"], "Course and level coverage", "course");
  } else if (input.processKey === "coaching_session") {
    const associated = records.filter(row => row.subjectStaffId || row.subjectDisplayName), people = new Set(associated.map(row => row.subjectStaffId || row.subjectDisplayName));
    metrics[1] = choice("coaching:staff", "Staff coached", rows.records.filter(row => associated.some(record => record.id === row.id)), "records", "Distinct associated staff; opens their coaching sessions", people.size);
    if (input.showOutcomes !== false) groupedFacts(["focus", "theme"], "Coaching focus", "focus");
  }

  if (["cpd_event", "coaching_session"].includes(input.processKey)) {
    const participation = input.participation;
    progress = { value: participation ? percent(participation.participatingStaffCount, participation.activeStaffCount) : null, label: input.processKey === "cpd_event" ? "Annual CPD participation" : "Annual coaching reach", detail: participation ? `${participation.participatingStaffCount} of ${participation.activeStaffCount} eligible staff · academic-year and organisation scope, independent of record date/status filters` : "An eligible staff denominator is not available in this scope" };
  }
  if (input.showOutcomes !== false && input.processKey !== "overview" && input.processKey !== "elevate_status") {
    const headlineFacts = facts.filter(fact => fact.dimensionKey.endsWith("outcome") && !fact.dimensionKey.endsWith("_statement_outcome"));
    const groups = new Map<string, DashboardDimensionFact[]>();
    for (const fact of headlineFacts) { const key = fact.numericValue == null ? `neutral:${fact.valueKey}` : `rating:${fact.numericValue}:${fact.valueLabel}`; groups.set(key, [...(groups.get(key) || []), fact]); }
    add("ratings", "Recorded outcomes", "Counts are area/focus responses, not staff or records. Neutral responses remain separate; statement detail is preserved in detailed analysis.", [...groups].map(([key, entries]) => recordChoice(`outcome:${key}`, entries[0].valueLabel, new Set(entries.map(fact => fact.sourceRecordId)), `${entries.length} responses · ${new Set(entries.map(fact => fact.sourceRecordId)).size} records`, entries.length)));
  }
  if (input.showAreaComparison !== false && !["liv", "als_liv"].includes(input.processKey)) {
    const target = rows[defaultKind];
    add("areas", defaultKind === "staff" ? "Staff by area" : "Activity by area", `Select an area to inspect its ${defaultKind}. Counts use the current report scope.`, [...new Set(target.map(row => row.area))].map(label => choice(`area:${label}`, label, target.filter(row => row.area === label), defaultKind)));
  }
  if (input.showActions !== false && actions.length) metrics.push(choice("overdue-actions", "Overdue linked actions", rows.actions.filter(row => row.status === "Overdue"), "actions", "Open the originating action record"));
  const openActions = rows.actions.filter(row => actions.some(action => action.id === row.id && isDashboardActionOpen(action))).sort((a, b) => Number(b.status === "Overdue") - Number(a.status === "Overdue") || (a.date || "9999").localeCompare(b.date || "9999"));
  const staffAttention = input.processKey === "eli" ? rows.staff.filter(row => row.status === "Not submitted") : input.processKey === "elevate_status" ? rows.staff.filter(row => (input.statusStaff || []).some(person => person.staffId === row.id && person.sessionsToNextLevel === 1)) : input.processKey === "probation_case" ? rows.staff.filter(row => (row.amount || 0) < 3) : [];
  const attention = [...openActions, ...staffAttention, ...rows.records.filter(row => !complete(recordById.get(row.id)!.status))];
  return { rows, metrics, breakdowns, defaultKind, note, progress, attention };
}

export function exploreProcessIntelligence(model: IntelligenceModel, filter: typeof emptyProcessExploration) {
  const selected = [...model.metrics, ...model.breakdowns.flatMap(group => group.choices)].find(row => row.key === filter.choice);
  const kind = filter.choice === "all" ? filter.kind : selected?.kind || filter.kind;
  const ids = filter.choice !== "all" && selected ? new Set(selected.ids) : null;
  const terms = filter.search.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const rows = model.rows[kind].filter(row => (!ids || ids.has(row.id)) && (filter.area === "all" || row.area === filter.area) && terms.every(term => [row.title, row.person, row.area, row.status, row.detail, row.date].join(" ").toLowerCase().includes(term)));
  const [field, direction] = filter.sort.split("-");
  return { kind, selected, rows: rows.sort((a, b) => { const left = field === "date" ? a.date : field === "amount" ? a.amount : field === "area" ? a.area : field === "status" ? a.status : a.title; const right = field === "date" ? b.date : field === "amount" ? b.amount : field === "area" ? b.area : field === "status" ? b.status : b.title; if (left == null) return right == null ? a.title.localeCompare(b.title) : 1; if (right == null) return -1; return (typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right), undefined, { numeric: true })) * (direction === "desc" ? -1 : 1) || a.title.localeCompare(b.title); }) };
}
