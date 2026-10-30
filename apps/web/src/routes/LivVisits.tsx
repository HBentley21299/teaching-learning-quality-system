import { useFormContent } from "../services/formContent";
import { WorkflowNarrativeField } from "../components/WorkflowNarrativeField";
import { LoadingState } from "../components/LoadingState";
import { WorkflowErrorSummary } from "../components/WorkflowErrorSummary";
import { ScrollableTableRegion } from "../components/ScrollableTableRegion";
import { focusWorkflowControl, type WorkflowFieldError } from "../services/workflowExperience";
import { dashboardActionState, isDashboardActionOpen } from "../services/dashboardActionState";
import { useWorkflowPagination, WorkflowPagination } from "../components/WorkflowPagination";
import { WorkflowFeedback } from "../components/WorkflowFeedback";
import { WorkflowFilters } from "../components/WorkflowFilters";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Eye,
  FilePlus2,
  ListChecks,
  MessageSquareText,
  Plus,
  RefreshCw,
  Save,
  Search,
  Target,
  X
} from "lucide-react";
import { Button } from "../design-system/Button";
import { confirmUnsavedNavigation, useUnsavedChanges } from "../components/UnsavedChangesGuard";
import { useActionOwners } from "../components/useActionOwners";
import { ExportExcelButton, ExportWordButton } from "../components/ExportButtons";
import { KpiStrip } from "../components/KpiStrip";
import { StaffSearchSelect } from "../components/StaffSearchSelect";
import { ActionThemeSelect } from "../components/ActionThemeSelect";
import { LivStageVisibility } from "../components/LivStageVisibility";
import { api } from "../services/api";
import { distinctListValues, matchesListSearch, sortListRows } from "../services/listQuery";
import { isMyLivRecord, livCompletionOptions } from "../services/livWorkflow";
import type {
  ActionOwnerOption,
  ActionSummary,
  CurrentUser,
  LivConfiguration,
  LivCycle,
  LivRecordSummary,
  LivStaffContext,
  LivStage,
  LivVisitSummary,
  OrgUnitSummary,
  SaveLivRecordRequest,
  SaveLivStageRequest,
  SaveLivVisitRequest,
  SharedThemeGroup,
  StaffSummary
} from "../services/types";

type LivVisitsProps = {
  academicYear: string;
  staff: StaffSummary[];
  orgUnits: OrgUnitSummary[];
  user: CurrentUser;
  onActionsChanged?: () => Promise<void>;
  onOpenStaffProfile?: (staffId: string) => void;
  initialSourceRecordId?: string;
  onRecordOpened?: (recordId: string) => void;
  onRecordClosed?: () => void;
  processKey?: "liv" | "als_liv";
};

type CoverageStatus = "not_started" | "in_progress" | "completed";

const stageDefinitions = [
  { type: "pre_discussion", followUpType: "distance_impact", label: "Professional Discussion", followUpLabel: "Distance Travelled and Impact", icon: MessageSquareText },
  { type: "visit", followUpType: "visit", label: "LIV Visit", followUpLabel: "LIV Visit", icon: Eye },
  { type: "post_reflection", followUpType: "post_reflection", label: "Post-LIV Reflection", followUpLabel: "Post-LIV Reflection", icon: RefreshCw },
  { type: "actions", followUpType: "actions", label: "Actions", followUpLabel: "Actions", icon: ListChecks },
  { type: "follow_up_review", followUpType: "follow_up_review", label: "Follow-up Review", followUpLabel: "Follow-up Review", icon: CalendarClock }
] as const;

export function LivVisits({
  academicYear,
  staff,
  orgUnits,
  user,
  onActionsChanged,
  onOpenStaffProfile,
  initialSourceRecordId = "",
  onRecordOpened,
  onRecordClosed,
  processKey = "liv"
}: LivVisitsProps) {
  const [records, setRecords] = useState<LivRecordSummary[]>([]);
  const [configuration, setConfiguration] = useState<LivConfiguration | null>(null);
  const [practitionerThemeGroups, setPractitionerThemeGroups] = useState<SharedThemeGroup[]>([]);
  const [actions, setActions] = useState<ActionSummary[]>([]);
  const [selectedRecordId, setSelectedRecordId] = useState("");
  const [selectedCycleId, setSelectedCycleId] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const refreshRequest = useRef(0);
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [staffContext, setStaffContext] = useState<LivStaffContext | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [recordSearch, setRecordSearch] = useState("");
  const [recordStatus, setRecordStatus] = useState("all");
  const [recordYear, setRecordYear] = useState("all");
  const [recordReviewer, setRecordReviewer] = useState("all");
  const [recordArea, setRecordArea] = useState("all");
  const [recordCycle, setRecordCycle] = useState("all");
  const [recordSort, setRecordSort] = useState("staff");
  const [recordOwnershipView, setRecordOwnershipView] = useState<"mine" | "scope">("mine");
  const [coverageSearch, setCoverageSearch] = useState("");
  const [coverageFaculty, setCoverageFaculty] = useState("all");
  const [coverageTeam, setCoverageTeam] = useState("all");
  const [coverageSort, setCoverageSort] = useState("staff");
  const [coverageStatus, setCoverageStatus] = useState<"all" | CoverageStatus>("all");
  const openedInitialRecord = useRef("");

  const isAlsLiv = processKey === "als_liv";
  const processLabel = isAlsLiv ? "ALS LIV" : "LIV";
  const canCreate = isAlsLiv
    ? user.permissions.includes("als_liv.submit") || user.permissions.includes("als_liv.manage")
    : user.permissions.includes("liv.submit") || user.permissions.includes("liv.manage");
  const clearCreateNavigation = useUnsavedChanges({ label: `New ${processLabel} case`, dirty: isCreating && Boolean(selectedStaffId), saving: isCreating && isSaving,
    submission: true, onSubmit: canCreate ? createCase : undefined, submitLabel: `Create ${processLabel} case`,
    onDiscard: () => { setIsCreating(false); setSelectedStaffId(""); setStaffContext(null); } });
  const selectedRecord = records.find((record) => record.id === selectedRecordId) ?? null;

  async function openRecord(record: LivRecordSummary) {
    if (!await confirmUnsavedNavigation()) return;
    setSelectedRecordId(record.id);
    onRecordOpened?.(record.recordId);
    if (typeof window !== "undefined") window.requestAnimationFrame(() => focusWorkflowControl("liv-case-heading"));
  }

  async function refreshData(nextMessage = "") {
    const request = ++refreshRequest.current;
    setIsLoading(true);
    const [recordsResult, actionsResult, configurationResult, practitionerThemesResult] = await Promise.allSettled([
      api.livRecords(processKey),
      api.actions(false),
      api.livConfiguration(processKey),
      api.sharedThemes(isAlsLiv ? "als_liv_practitioner" : processKey)
    ]);
    if (request !== refreshRequest.current) return;
    setIsLoading(false);
    setLoadFailed(recordsResult.status === "rejected" || configurationResult.status === "rejected");

    if (recordsResult.status === "rejected") {
      setStatusMessage("LIV records could not be loaded from the API.");
      return;
    }

    setRecords(recordsResult.value);
    if (actionsResult.status === "fulfilled") setActions(actionsResult.value);
    if (configurationResult.status === "fulfilled") setConfiguration(configurationResult.value);
    if (practitionerThemesResult.status === "fulfilled") setPractitionerThemeGroups(practitionerThemesResult.value);

    if (nextMessage) setStatusMessage(nextMessage);
    else if (configurationResult.status === "rejected") setStatusMessage("LIV records loaded, but form configuration is temporarily unavailable.");
    else setStatusMessage("");
    return recordsResult.value;
  }

  useEffect(() => {
    setRecords([]); setConfiguration(null); setSelectedRecordId(""); setSelectedCycleId("");
    void refreshData();
    return () => { refreshRequest.current += 1; };
  }, [academicYear, processKey]);

  useEffect(() => {
    if (!initialSourceRecordId || !records.length || openedInitialRecord.current === initialSourceRecordId) return;
    openedInitialRecord.current = initialSourceRecordId;
    const record = records.find((candidate) => candidate.recordId === initialSourceRecordId);
    if (record) openRecord(record);
    else setStatusMessage("The LIV source record is outside your permitted scope.");
  }, [initialSourceRecordId, records]);

  useEffect(() => {
    let cancelled = false;
    setStaffContext(null);
    if (!selectedStaffId || isAlsLiv) {
      return;
    }
    api.livStaffContext(selectedStaffId, processKey)
      .then(context => { if (!cancelled) setStaffContext(context); })
      .catch(() => { if (!cancelled) setStatusMessage("Elevate Learning and Innovation information could not be loaded for this staff member."); });
    return () => { cancelled = true; };
  }, [isAlsLiv, processKey, selectedStaffId]);

  useEffect(() => {
    if (!selectedRecord) return;
    const current = selectedRecord.cycles.find((cycle) => cycle.status === "in_progress") ?? selectedRecord.cycles.at(-1);
    if (current && !selectedRecord.cycles.some((cycle) => cycle.id === selectedCycleId)) setSelectedCycleId(current.id);
  }, [selectedCycleId, selectedRecord]);

  const faculties = useMemo(() => sortListRows(orgUnits.filter(unit => unit.orgUnitType === "faculty"), unit => unit.name), [orgUnits]);
  const unitById = useMemo(() => new Map(orgUnits.map((unit) => [unit.id, unit])), [orgUnits]);
  const recordByStaff = useMemo(() => new Map(sortListRows(records, record => new Date(record.updatedAt || record.createdAt), "asc", record => record.id).map(record => [record.subjectStaffId, record])), [records]);
  const coverageRows = useMemo(() => staff.map((staffMember) => {
    const units = staffMember.orgUnitIds.map((id) => unitById.get(id)).filter((unit): unit is OrgUnitSummary => Boolean(unit));
    const teams = units.filter(unit => ["team", "faculty_child_code", "faculty_child"].includes(unit.orgUnitType));
    const facultyIds = new Set([...units.filter((unit) => unit.orgUnitType === "faculty").map((unit) => unit.id), ...teams.map((team) => team.parentOrgUnitId).filter(Boolean) as string[]]);
    const staffFaculties = faculties.filter((faculty) => facultyIds.has(faculty.id));
    const record = recordByStaff.get(staffMember.id);
    const status: CoverageStatus = !record ? "not_started" : record.cycles.some((cycle) => cycle.status === "completed") ? "completed" : "in_progress";
    return { staff: staffMember, faculties: staffFaculties, teams, record, status };
  }), [faculties, recordByStaff, staff, unitById]);
  const coverageFacultyOptions = faculties.filter(faculty => coverageRows.some(row => row.faculties.some(unit => unit.id === faculty.id)));
  const coverageTeamOptions = sortListRows([...new Map(coverageRows.filter(row => coverageFaculty === "all" || row.faculties.some(faculty => faculty.id === coverageFaculty)).flatMap(row => row.teams.map(team => [team.id, team] as const))).values()], team => team.name);
  const filteredCoverage = sortListRows(coverageRows.filter(row =>
    (coverageFaculty === "all" || row.faculties.some(faculty => faculty.id === coverageFaculty))
    && (coverageTeam === "all" || row.teams.some(team => team.id === coverageTeam))
    && (coverageStatus === "all" || row.status === coverageStatus)
    && matchesListSearch(coverageSearch, row.staff.displayName, row.staff.externalId, row.staff.email,
      row.teams.map(team => [team.code, team.name]), row.faculties.map(faculty => [faculty.code, faculty.name]), row.status.replaceAll("_", " "), row.record?.reviewerStaffName)
  ), row => coverageSort === "faculty" ? row.faculties.map(faculty => faculty.name).join(" / ") : coverageSort === "team" ? row.teams.map(team => team.name).join(" / ")
    : coverageSort === "status" ? row.status : row.staff.displayName, "asc", row => row.staff.id);

  const currentCycleNumber = (record: LivRecordSummary) => record.cycles.find(cycle => cycle.status === "in_progress")?.cycleNumber ?? record.cycles.at(-1)?.cycleNumber ?? 1;
  const reviewerOptions = sortListRows([...new Map(records.filter(record => record.reviewerStaffId).map(record => [record.reviewerStaffId!, record.reviewerStaffName || "Not recorded"])).entries()], entry => entry[1]);
  const areaOptions = sortListRows([...new Map(records.filter(record => record.orgUnitId).map(record => [record.orgUnitId!, { id: record.orgUnitId!, label: [record.parentOrgUnitCode, record.orgUnitCode].filter(Boolean).join(" / ") || "Unassigned" }])).values()], area => area.label);
  const visibleRecords = sortListRows(records.filter(record =>
    (recordStatus === "all" || record.status === recordStatus)
    && (recordYear === "all" || record.academicYear === recordYear)
    && (recordReviewer === "all" || record.reviewerStaffId === recordReviewer)
    && (recordArea === "all" || record.orgUnitId === recordArea)
    && (recordCycle === "all" || String(currentCycleNumber(record)) === recordCycle)
    && matchesListSearch(recordSearch, record.subjectStaffName, record.reviewerStaffName, record.parentOrgUnitCode,
      record.orgUnitCode, record.academicYear, orgUnits.find(unit => unit.id === record.orgUnitId)?.name, record.currentStage.replaceAll("_", " "),
      record.status === "closed" ? "Closed" : "In progress", `Cycle ${currentCycleNumber(record)}`,
      record.visits.map(visit => [visit.deliveryAreaName, visit.courseName, visit.courseLevel, visit.visitDate]),
      staff.find(person => person.id === record.subjectStaffId)?.externalId)
  ), record => recordSort === "reviewer" ? record.reviewerStaffName : recordSort === "area" ? [record.parentOrgUnitCode, record.orgUnitCode].filter(Boolean).join(" / ")
    : recordSort === "cycle" ? currentCycleNumber(record) : recordSort === "status" ? record.status
    : recordSort === "newest" || recordSort === "oldest" ? new Date(record.updatedAt || record.createdAt)
    : recordSort === "visit_newest" || recordSort === "visit_oldest" ? latestVisit(record)?.visitDate ? new Date(latestVisit(record)!.visitDate!) : undefined
    : record.subjectStaffName,
  recordSort === "newest" || recordSort === "visit_newest" ? "desc" : "asc", record => record.id);
  const displayedRecords = recordOwnershipView === "mine" ? visibleRecords.filter(record => isMyLivRecord(record, user.staffId)) : visibleRecords;
  const coveragePage = useWorkflowPagination(filteredCoverage, JSON.stringify([coverageSearch, coverageFaculty, coverageTeam, coverageStatus, coverageSort]));
  const recordPage = useWorkflowPagination(displayedRecords, JSON.stringify([recordOwnershipView, recordSearch, recordStatus, recordYear, recordReviewer, recordArea, recordCycle, recordSort]));

  async function closeCreate() {
    if (!await confirmUnsavedNavigation()) return;
    setIsCreating(false); setSelectedStaffId(""); setStaffContext(null);
    window.requestAnimationFrame(() => focusWorkflowControl("liv-create-trigger"));
  }

  async function createCase(): Promise<boolean> {
    if (!canCreate || isSaving) return false;
    if (!selectedStaffId) {
      setStatusMessage("Select a staff member.");
      return false;
    }
    setIsSaving(true);
    try {
      const request: SaveLivRecordRequest = {
        subjectStaffId: selectedStaffId,
        areaOfPracticeKeys: [],
        areaOfPracticeThemeIds: []
      };
      const result = await api.createLivRecord(request, processKey);

      if (!result.ok) {
        setStatusMessage(result.message ?? "The LIV case could not be created.");
        return false;
      }
      setIsCreating(false);
      clearCreateNavigation();
      setSelectedStaffId("");
      setSelectedCycleId("");
      setSelectedRecordId(result.data?.id ?? "");
      const refreshedRecords = await refreshData("LIV case created. Share each section with the staff member when it is ready.");
      const createdRecord = refreshedRecords?.find((record) => record.id === result.data?.id);
      if (createdRecord) await openRecord(createdRecord);
      else setStatusMessage("The LIV case was created, but could not be opened. Refresh the records to open it; you do not need to create it again.");
      return true;
    } finally { setIsSaving(false); }
  }

  if (selectedRecord && configuration) {
    return (
      <LivCaseWorkspace
        actions={actions.filter((action) => action.sourceRecordId === selectedRecord.recordId)}
        configuration={configuration}
        cycleId={selectedCycleId}
        onBack={() => { setSelectedRecordId(""); setSelectedCycleId(""); onRecordClosed?.(); window.requestAnimationFrame(() => focusWorkflowControl("liv-records-summary")); }}
        onChanged={async (message) => { await refreshData(message); await onActionsChanged?.(); }}
        onCycleChange={setSelectedCycleId}
        onOpenStaffProfile={onOpenStaffProfile}
        record={selectedRecord}
        practitionerThemeGroups={practitionerThemeGroups}
        processKey={processKey}
        canExportWord={user.permissions.includes("reports.view_all") || user.permissions.includes(isAlsLiv ? "als_liv.submit" : "liv.submit") || user.permissions.includes(isAlsLiv ? "als_liv.manage" : "liv.manage")}
        staff={staff}
      />
    );
  }

  return (
    <fieldset disabled={isSaving} style={{ display: "contents" }}><div className="route-stack">
      <div className="route-header"><div><p className="eyebrow">{isAlsLiv ? "Additional Learning Support" : "Learning, Innovation and Vision"}</p><h1>{processLabel}</h1></div><div className="toolbar">{canCreate ? <Button id="liv-create-trigger" aria-expanded={isCreating} icon={FilePlus2} onClick={() => isCreating ? closeCreate() : setIsCreating(true)} variant="primary">{`Create ${processLabel} case`}</Button> : null}</div></div>
      <WorkflowFeedback message={statusMessage} />
      {loadFailed ? <Button disabled={isLoading} onClick={() => void refreshData()}>Retry loading records</Button> : null}
      {isLoading ? <LoadingState label={`Loading ${processLabel} records…`} /> : null}
      {isCreating ? (
        <section className="panel liv-v2-create">
          <div className="panel-heading"><div><h2>New {processLabel} case</h2><span>{isAlsLiv ? "Create a distinct ALS observation cycle." : "The submitted ELI information is linked automatically."}</span></div><button className="icon-button" onClick={closeCreate} title="Close" type="button"><X size={16} /></button></div>
          <div className="form-stack">
            <label className="entry-field"><span>Staff member</span><StaffSearchSelect id="liv-staff" onChange={setSelectedStaffId} staff={staff} value={selectedStaffId} /></label>
          </div>
          {!isAlsLiv && staffContext ? <EliContext context={staffContext} /> : null}
          <div className="toolbar toolbar-end"><Button icon={X} onClick={closeCreate}>Cancel</Button><Button disabled={isSaving || !selectedStaffId} icon={Plus} onClick={() => void createCase()} variant="primary">{isSaving ? "Creating..." : "Create case"}</Button></div>
        </section>
      ) : null}

      <KpiStrip items={[
        { label: "Staff in scope", value: coverageRows.length, tone: "blue" },
        { label: `${processLabel} completed`, value: coverageRows.filter((row) => row.status === "completed").length, tone: "green" },
        { label: "In progress", value: coverageRows.filter((row) => row.status === "in_progress").length, tone: "amber" },
        { label: "Not started", value: coverageRows.filter((row) => row.status === "not_started").length, tone: "red" }
      ]} />

      <details className="panel liv-v2-records">
        <summary><span><strong>{processLabel} coverage</strong><small>Completed, in-progress and not-started staff</small></span><span className="toolbar"><span>{filteredCoverage.length} staff</span><ChevronDown size={18} /></span></summary>
        <WorkflowFilters activeCount={[coverageFaculty, coverageStatus, coverageTeam].filter(value => value !== "all").length} hasQuery={Boolean(coverageSearch)} onClear={() => { setCoverageSearch(""); setCoverageFaculty("all"); setCoverageTeam("all"); setCoverageStatus("all"); setCoverageSort("staff"); }} primary={<>
<label className="search-box"><Search size={16} aria-hidden="true" /><input onChange={(event) => setCoverageSearch(event.target.value)} aria-label="Search LIV coverage" placeholder="Search staff, reviewer, faculty or team" value={coverageSearch} /></label>
<label><span>Sort by</span><select aria-label="Sort LIV coverage" value={coverageSort} onChange={event => setCoverageSort(event.target.value)}><option value="staff">Staff name</option><option value="faculty">Faculty</option><option value="team">Team</option><option value="status">Status</option></select></label>
</>}>
<label><span>Faculty</span><select onChange={(event) => { setCoverageFaculty(event.target.value); setCoverageTeam("all"); }} value={coverageFaculty}><option value="all">All faculties</option>{coverageFacultyOptions.map((faculty) => <option key={faculty.id} value={faculty.id}>{faculty.code} - {faculty.name}</option>)}</select></label>
          <label><span>{processLabel} status</span><select onChange={(event) => setCoverageStatus(event.target.value as typeof coverageStatus)} value={coverageStatus}><option value="all">All statuses</option><option value="completed">Completed</option><option value="in_progress">In progress</option><option value="not_started">Not started</option></select></label>
          <label><span>Team</span><select value={coverageTeam} onChange={event => setCoverageTeam(event.target.value)}><option value="all">All teams</option>{coverageTeamOptions.map(team => <option key={team.id} value={team.id}>{team.code} - {team.name}</option>)}</select></label>
</WorkflowFilters>
        <ScrollableTableRegion label={`${processLabel} staff coverage`}><table><thead><tr><th scope="col">Staff member</th><th scope="col">Faculty</th><th scope="col">Team</th><th scope="col">{processLabel} status</th><th scope="col">Record</th></tr></thead><tbody>
          {isLoading && filteredCoverage.length === 0 ? null : loadFailed && filteredCoverage.length === 0 ? <tr><td colSpan={5}>Staff coverage is temporarily unavailable. Use Retry loading records above.</td></tr> : filteredCoverage.length === 0 ? <tr><td colSpan={5}>No staff match these filters.</td></tr> : coveragePage.items.map((row) => <tr key={row.staff.id}><td><strong>{row.staff.displayName}</strong><small className="table-subline">{row.staff.externalId}</small></td><td>{row.faculties.map((unit) => unit.code).join(", ") || "Unassigned"}</td><td>{row.teams.map((unit) => unit.code).join(", ") || "Unassigned"}</td><td><span className={`status-pill ${coverageStatusClass(row.status)}`}>{coverageStatusLabel(row.status)}</span></td><td>{row.record ? <button className="icon-button" onClick={() => openRecord(row.record!)} title={`Open ${processLabel} record`} type="button"><Eye size={16} /></button> : "-"}</td></tr>)}
        </tbody></table></ScrollableTableRegion>
        <WorkflowPagination {...coveragePage} label="LIV coverage" />
      </details>

      <details className="panel liv-v2-records" open>
        <summary id="liv-records-summary"><span><strong>{recordOwnershipView === "mine" ? `My ${processLabel} records` : `${processLabel} records in scope`}</strong><small>{displayedRecords.length} records in this view</small></span><ChevronDown aria-hidden="true" size={18} /></summary>
        <div className="toolbar toolbar-end">{user.permissions.includes("exports.create") ? <ExportExcelButton moduleKey={isAlsLiv ? "als-liv" : "liv"} orgUnits={orgUnits} /> : null}</div>
        <div className="segmented-control record-ownership-switch" aria-label={`${processLabel} record ownership view`}><button aria-pressed={recordOwnershipView === "mine"} className={recordOwnershipView === "mine" ? "is-active" : ""} onClick={() => setRecordOwnershipView("mine")} type="button">My {processLabel} records</button><button aria-pressed={recordOwnershipView === "scope"} className={recordOwnershipView === "scope" ? "is-active" : ""} onClick={() => setRecordOwnershipView("scope")} type="button">All in my scope</button></div>
        <WorkflowFilters activeCount={[recordStatus, recordYear, recordReviewer, recordArea, recordCycle].filter(value => value !== "all").length} hasQuery={Boolean(recordSearch)} onClear={() => { setRecordSearch(""); setRecordStatus("all"); setRecordYear("all"); setRecordReviewer("all"); setRecordArea("all"); setRecordCycle("all"); setRecordSort("staff"); }} primary={<>
<label className="search-box"><Search size={16} aria-hidden="true" /><input onChange={(event) => setRecordSearch(event.target.value)} aria-label="Search LIV records" placeholder="Search people, course, area or stage" value={recordSearch} /></label>
<label><span>Sort by</span><select aria-label="Sort LIV records" value={recordSort} onChange={event => setRecordSort(event.target.value)}><option value="staff">Staff name</option><option value="reviewer">Reviewer name</option><option value="area">Faculty / team</option><option value="cycle">Current cycle</option><option value="status">Status</option><option value="newest">Last activity: newest first</option><option value="oldest">Last activity: oldest first</option><option value="visit_newest">Latest visit: newest first</option><option value="visit_oldest">Latest visit: oldest first</option></select></label>
</>}>
<label><span>Status</span><select onChange={(event) => setRecordStatus(event.target.value)} value={recordStatus}><option value="all">All statuses</option><option value="in_progress">In progress</option><option value="closed">Closed</option></select></label>
          <label><span>Academic year</span><select value={recordYear} onChange={event => setRecordYear(event.target.value)}><option value="all">All years</option>{distinctListValues(records.map(record => record.academicYear)).reverse().map(year => <option key={year}>{year}</option>)}</select></label>
          <label><span>Reviewer</span><select value={recordReviewer} onChange={event => setRecordReviewer(event.target.value)}><option value="all">All reviewers</option>{reviewerOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
          <label><span>Faculty / team</span><select value={recordArea} onChange={event => setRecordArea(event.target.value)}><option value="all">All areas</option>{areaOptions.map(area => <option key={area.id} value={area.id}>{area.label}</option>)}</select></label>
          <label><span>Current cycle</span><select value={recordCycle} onChange={event => setRecordCycle(event.target.value)}><option value="all">All cycles</option>{distinctListValues(records.map(record => String(currentCycleNumber(record)))).map(cycle => <option key={cycle} value={cycle}>Cycle {cycle}</option>)}</select></label>
</WorkflowFilters>
        <ScrollableTableRegion label={`${processLabel} records`}><table><thead><tr><th scope="col">Staff member</th><th scope="col">Faculty / team</th><th scope="col">Latest delivery area</th><th scope="col">Current cycle</th><th scope="col">Status</th><th scope="col">Open</th></tr></thead><tbody>
          {isLoading && displayedRecords.length === 0 ? null : loadFailed && displayedRecords.length === 0 ? <tr><td colSpan={6}>Records are temporarily unavailable. Use Retry loading records above.</td></tr> : displayedRecords.length === 0 ? <tr><td colSpan={6}>{recordOwnershipView === "mine" ? `No ${processLabel} records created by you or reviewing you match these filters.` : `No ${processLabel} records match these filters.`}</td></tr> : recordPage.items.map((record) => <tr key={record.id}><td><strong>{record.subjectStaffName}</strong><small className="table-subline">{record.reviewerStaffName ? `Created by ${record.reviewerStaffName}` : ""}</small></td><td>{[record.parentOrgUnitCode, record.orgUnitCode].filter(Boolean).join(" / ") || "Unassigned"}</td><td>{latestVisit(record)?.deliveryAreaName ?? "Not set"}</td><td>{record.cycles.find((cycle) => cycle.status === "in_progress")?.cycleNumber ?? record.cycles.at(-1)?.cycleNumber ?? 1}</td><td><span className={`status-pill ${record.status === "closed" ? "status-complete" : "status-draft"}`}>{record.status === "closed" ? "Closed" : "In progress"}</span></td><td><button className="icon-button" onClick={() => openRecord(record)} title={`Open ${processLabel} record`} type="button"><Eye size={16} /></button></td></tr>)}
        </tbody></table></ScrollableTableRegion>
        <WorkflowPagination {...recordPage} label="LIV records" />
      </details>
    </div></fieldset>
  );
}

export function LivCaseWorkspace({ record, configuration, practitionerThemeGroups = [], actions, cycleId, staff, onBack, onChanged, onCycleChange, onOpenStaffProfile, embedded = false, processKey = "liv", canExportWord = false }: {
  record: LivRecordSummary;
  configuration: LivConfiguration;
  practitionerThemeGroups?: SharedThemeGroup[];
  actions: ActionSummary[];
  cycleId: string;
  staff: StaffSummary[];
  onBack: () => void;
  onChanged: (message: string) => Promise<void>;
  onCycleChange: (id: string) => void;
  onOpenStaffProfile?: (staffId: string) => void;
  embedded?: boolean;
  processKey?: "liv" | "als_liv";
  canExportWord?: boolean;
}) {
  const processLabel = processKey === "als_liv" ? "ALS LIV" : "LIV";
  const cycle = record.cycles.find((value) => value.id === cycleId) ?? record.cycles.find((value) => value.status === "in_progress") ?? record.cycles.at(-1);
  const canManageActions = record.canEdit && cycle?.status === "in_progress";
  const { owners: ownerOptions, loading: ownersLoading, error: ownersError, retry: retryOwners } = useActionOwners(record.recordId, record.subjectStaffId, processKey, canManageActions);
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function addStage(stageType: LivStage["stageType"]) {
    setIsSaving(true);
    try {
      const result = await api.addLivStage(record.id, emptyStageRequest(stageType), processKey);

      if (!result.ok) {
        setMessage(result.message ?? "The LIV stage could not be added.");
        return;
      }
      await onChanged("LIV stage added.");
    } finally { setIsSaving(false); }
  }

  async function completeCycle(openFollowUp: boolean) {
    if (!cycle || !await confirmUnsavedNavigation()) return;
    const option = livCompletionOptions(cycle.cycleNumber, record.probationObservationNumber === 2, processLabel)
      .find((value) => value.openFollowUp === openFollowUp);
    if (!option || !window.confirm(option.confirmation)) return;
    setIsSaving(true);
    try {
      const result = await api.completeLivCycle(record.id, openFollowUp, processKey);

      if (!result.ok) {
        setMessage(result.message ?? "The cycle could not be completed.");
        return;
      }
      await onChanged(option.successMessage);
      if (openFollowUp && result.data?.id) onCycleChange(result.data.id);
    } finally { setIsSaving(false); }
  }

  if (!cycle) return <section className="panel"><Button icon={ArrowLeft} onClick={() => void confirmUnsavedNavigation().then(leave => { if (leave) onBack(); })}>{`Back to ${processLabel}`}</Button><p>No {processLabel} cycle is available.</p></section>;

  const currentCycleActions = actions.filter((action) => action.livCycleId === cycle.id);
  const previousActions = actions.filter((action) => action.livCycleId && action.livCycleId !== cycle.id);
  const complete = stageDefinitions.every((definition) => cycle.stages.some((stage) => stage.stageType === (cycle.isFollowUp ? definition.followUpType : definition.type)));

  return (
    <div className="route-stack">
      {!embedded ? <div className="route-header"><div><Button icon={ArrowLeft} onClick={() => void confirmUnsavedNavigation().then(leave => { if (leave) onBack(); })}>{`Back to ${processLabel}`}</Button><p className="eyebrow">{processLabel} review · Sections shared individually</p><h1 id="liv-case-heading" tabIndex={-1}>{record.subjectStaffName}</h1></div><div className="toolbar">{canExportWord ? <ExportWordButton recordId={record.recordId} /> : null}{onOpenStaffProfile ? <Button icon={Eye} onClick={() => onOpenStaffProfile(record.subjectStaffId)}>Staff profile</Button> : null}</div></div> : null}
      <WorkflowFeedback message={message} />
      {canManageActions && (ownersLoading ? <LoadingState label="Loading action owners…" size="inline" /> : ownersError ? <div role="alert">{ownersError}<Button onClick={() => void retryOwners()}>Retry action owners</Button></div> : null)}
      {processKey !== "als_liv" ? <section className="panel liv-v2-header">
        <div className="panel-heading">
          <div><p className="eyebrow">Elevate Learning and Innovation</p><h2>{processLabel} preferences and focus</h2></div>
          <span>{record.sourceElevateAssessmentId ? "Linked assessment" : "No linked assessment"}</span>
        </div>
        <div className="liv-information-grid">
          <div><span>Preferred month</span><strong>{formatPreferredMonth(record.eliPreferredVisitMonth)}</strong></div>
          <div><span>Primary focus</span><strong>{record.eliPrimaryFocus ?? "Not provided"}</strong></div>
          <div><span>Secondary focus</span><strong>{eliSecondaryFocus(record)}</strong></div>
          <div><span>Faculty / team</span><strong>{[record.parentOrgUnitCode, record.orgUnitCode].filter(Boolean).join(" / ") || "Unassigned"}</strong></div>
          <div><span>Created by</span><strong>{record.reviewerStaffName ?? "System account"}</strong></div>
        </div>
        <details><summary>Desired outcome from Elevate Learning and Innovation</summary><p>{record.eliDesiredOutcome || "No desired outcome was provided."}</p></details>
        {record.sourceElevateAssessmentId ? <small>Linked to the staff member's submitted Elevate Learning and Innovation record.</small> : <small>No submitted ELI record was available when this case was created.</small>}
      </section> : null}
      {!embedded && record.canViewSensitive ? <ElevatePractitionerEditor onChanged={onChanged} processKey={processKey} record={record} themeGroups={practitionerThemeGroups} /> : null}
      <div className="segmented-control liv-v2-cycles" aria-label="LIV cycles">
        {record.cycles.map((value) => <button aria-pressed={cycle.id === value.id} className={cycle.id === value.id ? "is-active" : ""} key={value.id} onClick={() => void confirmUnsavedNavigation().then(leave => { if (leave) onCycleChange(value.id); })} type="button">Cycle {value.cycleNumber}{value.status === "completed" ? " · Complete" : " · Current"}</button>)}
      </div>
      <section className="liv-v2-stage-map" aria-label={`LIV cycle ${cycle.cycleNumber} stages`}>
        {stageDefinitions.map((definition, index) => {
          const type = cycle.isFollowUp ? definition.followUpType : definition.type;
          const label = cycle.isFollowUp ? definition.followUpLabel : definition.label;
          const Icon = definition.icon;
          const stage = cycle.stages.find((value) => value.stageType === type);
          return <div className={stage ? "is-added" : ""} key={type}><span>{stage?.stageStatus === "completed" || stage?.stageStatus === "not_applicable" ? <CheckCircle2 size={18} /> : <Icon size={18} />}</span><strong>{index + 1}. {label}</strong><small>{stage ? stage.stageStatus === "completed" ? "Completed" : stage.stageStatus === "not_applicable" ? "Not applicable" : "In progress" : "Not added"}</small></div>;
        })}
      </section>
      <div className="liv-v2-stage-stack">
        {stageDefinitions.map((definition, index) => {
          const type = (cycle.isFollowUp ? definition.followUpType : definition.type) as LivStage["stageType"];
          const label = cycle.isFollowUp ? definition.followUpLabel : definition.label;
          const Icon = definition.icon;
          const stage = cycle.stages.find((value) => value.stageType === type);
          return (
            <details className="panel liv-v2-stage-panel" key={`${cycle.id}-${type}`}>
              <summary>
                <div className="liv-v2-stage-title"><span><Icon size={18} /></span><div><p className="eyebrow">Stage {index + 1}</p><h2>{label}</h2></div></div>
                <span className="liv-stage-summary-status">
                  {stage ? <><span className={`status-pill ${stage.stageStatus === "completed" || stage.stageStatus === "not_applicable" ? "status-complete" : "status-draft"}`}>{stage.stageStatus === "completed" ? "Completed" : stage.stageStatus === "not_applicable" ? "Not applicable" : "In progress"}</span><LivStageVisibility canManage={record.isCreatedByCurrentUser} onChanged={onChanged} processKey={processKey} recordId={record.id} sectionLabel={label} staffName={record.subjectStaffName} stageId={stage.id} visibleToStaff={stage.visibleToStaff} /></> : <span className="muted-copy">Not added</span>}
                </span>
                <ChevronDown size={18} aria-hidden="true" />
              </summary>
              <div className="liv-v2-stage-panel-body">
                {stage && !stage.canView ? <p className="muted-copy">This section has not been shared with you. The review owner will make it visible when it is ready.</p> : stage ? (
                  <LivStageEditor
                    actions={currentCycleActions}
                    configuration={configuration}
                    cycle={cycle}
                    ownerOptions={ownerOptions}
                    previousActions={previousActions}
                    record={record}
                    stage={stage}
                    staff={staff}
                    onChanged={onChanged}
                    processKey={processKey}
                  />
                ) : record.canEdit && cycle.status === "in_progress" ? <Button disabled={isSaving} icon={Plus} onClick={() => void addStage(type)}>Add stage</Button> : <p className="muted-copy">This stage has not been added.</p>}
              </div>
            </details>
          );
        })}
      </div>
      {record.canEdit && cycle.status === "in_progress" ? <div className="liv-v2-complete"><div className="toolbar toolbar-end">{livCompletionOptions(cycle.cycleNumber, record.probationObservationNumber === 2, processLabel).map((option) => <Button disabled={isSaving || !complete} icon={CheckCircle2} key={String(option.openFollowUp)} onClick={() => void completeCycle(option.openFollowUp)} variant={option.openFollowUp ? "primary" : undefined}>{option.label}</Button>)}</div>{!complete ? <small>Add all five stages before completing this cycle.</small> : null}<small>{cycle.cycleNumber >= 2 ? "Choose whether another follow-up cycle is required." : "Every staff member must progress to cycle 2. Complete this cycle to open it."}</small></div> : null}
    </div>
  );
}

function LivStageEditor({ stage, record, cycle, configuration, actions, previousActions, ownerOptions, staff, onChanged, processKey }: {
  stage: LivStage;
  record: LivRecordSummary;
  cycle: LivCycle;
  configuration: LivConfiguration;
  actions: ActionSummary[];
  previousActions: ActionSummary[];
  ownerOptions: ActionOwnerOption[];
  staff: StaffSummary[];
  onChanged: (message: string) => Promise<void>;
  processKey: "liv" | "als_liv";
}) {
  const [form, setForm] = useState<SaveLivStageRequest>(() => stageToRequest(stage, cycle.cycleNumber));
  const [visit, setVisit] = useState<SaveLivVisitRequest>(() => visitToRequest(record.visits.find((value) => value.id === stage.visitId)));
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const content = useFormContent("liv");
  const [visitErrors, setVisitErrors] = useState<WorkflowFieldError[]>([]);
  const canEdit = stage.canEdit;
  const baseline = useRef(JSON.stringify([form, visit]));
  const dirty = canEdit && JSON.stringify([form, visit]) !== baseline.current;
  const isStageDraft = canEdit && stage.stageType !== "actions" && stage.stageStatus === "in_progress";
  const clearNavigation = useUnsavedChanges({ label: `LIV ${stage.stageType.replaceAll("_", " ")}`, dirty, saving: isSaving,
    submission: isStageDraft,
    onSave: () => stage.stageType === "visit" ? saveVisit(isStageDraft ? "in_progress" : form.stageStatus) : saveStage(isStageDraft ? "in_progress" : form.stageStatus),
    onSubmit: isStageDraft ? () => stage.stageType === "visit" ? saveVisit("completed") : saveStage(form.stageStatus === "not_applicable" ? "not_applicable" : "completed") : undefined,
    submitLabel: form.stageStatus === "not_applicable" ? "Mark stage not applicable" : "Complete stage",
    onDiscard: () => { const [nextForm, nextVisit] = JSON.parse(baseline.current) as [SaveLivStageRequest, SaveLivVisitRequest]; setForm(nextForm); setVisit(nextVisit); } });
  useEffect(() => {
    // A sibling stage/action refresh must never overwrite this editor's local text.
    if (dirty) return;
    const nextForm = stageToRequest(stage, cycle.cycleNumber);
    const nextVisit = visitToRequest(record.visits.find(value => value.id === stage.visitId));
    baseline.current = JSON.stringify([nextForm, nextVisit]);
    setForm(nextForm); setVisit(nextVisit);
  }, [record.visits, stage]);

  async function saveStage(stageStatus = form.stageStatus): Promise<boolean> {
    if (!canEdit || isSaving) return false;
    const savedForm = { ...form, stageStatus };
    setIsSaving(true);
    try {
      const result = await api.updateLivStage(record.id, stage.id, savedForm, processKey);

      if (!result.ok) {
        setMessage(result.message ?? "The stage could not be saved.");
        return false;
      }
      setForm(savedForm); baseline.current = JSON.stringify([savedForm, visit]); clearNavigation();
      await onChanged("LIV stage saved.");
      return true;
    } finally { setIsSaving(false); }
  }

  async function saveVisit(stageStatus = form.stageStatus): Promise<boolean> {
    if (!canEdit || isSaving || !stage.visitId) return false;
    const savedForm = { ...form, stageStatus };
    const errors: WorkflowFieldError[] = [];
    if (!visit.deliveryAreaKey) errors.push({ id: `liv-visit-${stage.visitId}-delivery`, message: "Select the delivery area for this LIV visit." });
    if (!visit.courseLevel) errors.push({ id: `liv-visit-${stage.visitId}-level`, message: "Select the course level for this LIV visit." });
    setVisitErrors(errors); setMessage("");
    if (errors.length) return false;
    setIsSaving(true);
    try {
      const result = await api.updateLivVisit(record.id, stage.visitId, visit, processKey);
      const stageResult = result.ok
        ? await api.updateLivStage(record.id, stage.id, savedForm, processKey)
        : null;

      if (!result.ok || !stageResult?.ok) {
        setMessage(result.message ?? stageResult?.message ?? "The LIV visit could not be saved.");
        return false;
      }
      setForm(savedForm); baseline.current = JSON.stringify([savedForm, visit]); clearNavigation();
      await onChanged("LIV visit detail saved.");
      return true;
    } finally { setIsSaving(false); }
  }

  if (stage.stageType === "actions") return <LivActions actions={actions} cycle={cycle} ownerOptions={ownerOptions} processKey={processKey} record={record} staff={staff} onChanged={onChanged} />;

  return (
    <fieldset disabled={isSaving} style={{ display: "contents" }}><div className="liv-v2-stage-form">
      <WorkflowFeedback message={message} />
      <WorkflowErrorSummary errors={visitErrors} />
      {stage.stageType === "pre_discussion" ? (
        <div className="form-stack">
          <WorkflowNarrativeField content={content.field("contextText", "Context")} disabled={!canEdit} onChange={value => setForm({ ...form, contextText: value })} rows={4} value={form.contextText ?? ""} />
          <WorkflowNarrativeField content={content.field("aimsText", "Aims and intended outcomes")} disabled={!canEdit} onChange={value => setForm({ ...form, aimsText: value })} rows={4} value={form.aimsText ?? ""} />
          <WorkflowNarrativeField content={content.field("learnerActivityText", "Planned learner activity")} disabled={!canEdit} onChange={value => setForm({ ...form, learnerActivityText: value })} rows={4} value={form.learnerActivityText ?? ""} />
        </div>
      ) : stage.stageType === "distance_impact" ? (
        <div className="form-stack">
          <WorkflowNarrativeField content={content.field("distanceImpactText", "Distance travelled and impact")} disabled={!canEdit} onChange={value => setForm({ ...form, distanceImpactText: value })} rows={6} value={form.distanceImpactText ?? ""} />
          <OpportunityChecklist disabled={!canEdit} options={configuration.developmentOpportunities} selected={form.developmentOpportunityKeys} onChange={(keys) => setForm({ ...form, developmentOpportunityKeys: keys })} />
        </div>
      ) : stage.stageType === "visit" ? (
        <VisitEditor idPrefix={`liv-visit-${stage.visitId}`} errors={visitErrors} completed={stage.stageStatus === "completed"} configuration={configuration} disabled={!canEdit} value={visit} onChange={setVisit} />
      ) : stage.stageType === "post_reflection" ? (
        <div className="form-stack">
          {cycle.isFollowUp && previousActions.length ? <PreviousActions actions={previousActions} onChanged={onChanged} /> : null}
          <WorkflowNarrativeField content={content.field("reflectionText", "Post-LIV reflection and discussion")} disabled={!canEdit} onChange={value => setForm({ ...form, reflectionText: value })} rows={7} value={form.reflectionText ?? ""} />
          <OpportunityChecklist disabled={!canEdit} options={configuration.developmentOpportunities} selected={form.developmentOpportunityKeys} onChange={(keys) => setForm({ ...form, developmentOpportunityKeys: keys })} />
        </div>
      ) : (
        <div className="form-stack"><label className="entry-field"><span>Intended follow-up date</span><input disabled={!canEdit || (cycle.cycleNumber >= 2 && form.stageStatus === "not_applicable")} onChange={(event) => setForm({ ...form, intendedFollowUpDate: event.target.value })} type="date" value={form.intendedFollowUpDate ?? ""} /></label>{cycle.cycleNumber === 1 ? <p className="muted-copy">Cycle 2 is required for every staff member. Set the intended follow-up date for the next cycle.</p> : null}</div>
      )}
      {canEdit ? (
        <div className="toolbar toolbar-end">
          {stage.stageType === "follow_up_review" && cycle.cycleNumber >= 2 ? <label className="compact-check"><input checked={form.stageStatus === "not_applicable"} onChange={(event) => setForm({ ...form, intendedFollowUpDate: event.target.checked ? undefined : form.intendedFollowUpDate, stageStatus: event.target.checked ? "not_applicable" : "in_progress" })} type="checkbox" /><span>Not applicable - no further follow-up required</span></label> : null}
          <label className="compact-check"><input checked={form.stageStatus === "completed"} onChange={(event) => setForm({ ...form, stageStatus: event.target.checked ? "completed" : "in_progress" })} type="checkbox" /><span>Mark stage complete</span></label>
          <Button disabled={isSaving} icon={Save} onClick={() => void (stage.stageType === "visit" ? saveVisit() : saveStage())} variant="primary">{isSaving ? "Saving..." : "Save stage"}</Button>
        </div>
      ) : <p className="muted-copy">This stage is read-only for your current access.</p>}
    </div></fieldset>
  );
}

function VisitEditor({ completed, configuration, disabled, value, onChange, idPrefix, errors }: {
  idPrefix: string;
  errors: WorkflowFieldError[];
  completed: boolean;
  configuration: LivConfiguration;
  disabled: boolean;
  value: SaveLivVisitRequest;
  onChange: (value: SaveLivVisitRequest) => void;
}) {
  const content = useFormContent("liv");
  const [isOpen, setIsOpen] = useState(!completed);
  const fieldError = (key: string) => errors.find(error => error.id === `${idPrefix}-${key}`);
  return (
    <details className="liv-visit-detail" open={isOpen} onToggle={event => setIsOpen(event.currentTarget.open)}>
      <summary><span>Detail</span><ChevronDown size={16} aria-hidden="true" /></summary>
      <div className="form-stack liv-visit-detail-body">
        <div className="form-grid form-grid-three">
          <label className="entry-field"><span>Delivery area</span><select id={`${idPrefix}-delivery`} aria-required="true" aria-invalid={Boolean(fieldError("delivery")) || undefined} aria-describedby={fieldError("delivery") ? `${idPrefix}-delivery-error` : undefined} disabled={disabled} onChange={(event) => onChange({ ...value, deliveryAreaKey: event.target.value })} value={value.deliveryAreaKey ?? ""}><option value="">Select delivery area</option>{value.deliveryAreaKey && !configuration.deliveryAreas.some(option => option.key === value.deliveryAreaKey) ? <option value={value.deliveryAreaKey}>{value.deliveryAreaKey.replaceAll("_", " ")} (existing response)</option> : null}{configuration.deliveryAreas.map((option) => <option key={option.key} value={option.key}>{option.name}</option>)}</select>{fieldError("delivery") ? <small className="workflow-field-error" id={`${idPrefix}-delivery-error`}>{fieldError("delivery")?.message}</small> : null}</label>
          <label className="entry-field"><span>Visit date</span><input disabled={disabled} onChange={(event) => onChange({ ...value, visitDate: event.target.value })} type="date" value={value.visitDate ?? ""} /></label>
          <label className="entry-field"><span>Visit time</span><input disabled={disabled} onChange={(event) => onChange({ ...value, visitTime: event.target.value })} type="time" value={value.visitTime ?? ""} /></label>
          <label className="entry-field"><span>Course name</span><input disabled={disabled} onChange={(event) => onChange({ ...value, courseName: event.target.value })} value={value.courseName ?? ""} /></label>
          <label className="entry-field"><span>Course level</span><select id={`${idPrefix}-level`} aria-required="true" aria-invalid={Boolean(fieldError("level")) || undefined} aria-describedby={fieldError("level") ? `${idPrefix}-level-error` : undefined} disabled={disabled} onChange={(event) => onChange({ ...value, courseLevel: event.target.value })} value={value.courseLevel ?? ""}><option value="">Select course level</option>{value.courseLevel && !configuration.courseLevels.some(option => option.key === value.courseLevel) ? <option value={value.courseLevel}>{value.courseLevel} (existing response)</option> : null}{configuration.courseLevels.map((option) => <option key={option.key} value={option.key}>{option.name}</option>)}</select>{fieldError("level") ? <small className="workflow-field-error" id={`${idPrefix}-level-error`}>{fieldError("level")?.message}</small> : null}</label>
        </div>
        <WorkflowNarrativeField content={content.field("reflectionNotes", "LIV notes")} disabled={disabled} onChange={nextValue => onChange({ ...value, reflectionNotes: nextValue })} rows={7} value={value.reflectionNotes ?? ""} />
        <p className="muted-copy">LIV reporting uses the themes selected in the Actions stage.</p>
      </div>
    </details>
  );
}

function ElevatePractitionerEditor({ record, themeGroups, onChanged, processKey }: { record: LivRecordSummary; themeGroups: SharedThemeGroup[]; onChanged: (message: string) => Promise<void>; processKey: "liv" | "als_liv" }) {
  const themes = themeGroups.flatMap((group) => group.themes).filter((theme) => theme.isActive || record.areaOfPracticeThemeIds.includes(theme.id));
  const [isPractitioner, setIsPractitioner] = useState(record.isElevatePractitioner ? "yes" : "");
  const [themeIds, setThemeIds] = useState(record.areaOfPracticeThemeIds);
  const [other, setOther] = useState(record.areaOfPracticeOther ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const otherSelected = themes.some((theme) => theme.isOther && themeIds.includes(theme.id));
  const practitionerBaseline = useRef(JSON.stringify([isPractitioner, themeIds, other]));
  const practitionerDirty = JSON.stringify([isPractitioner, themeIds, other]) !== practitionerBaseline.current;
  const clearNavigation = useUnsavedChanges({ label: "LIV practitioner information", dirty: record.canEdit && practitionerDirty, saving: isSaving, onSave: () => save(),
    onDiscard: () => { const next = record.isElevatePractitioner ? "yes" : ""; practitionerBaseline.current = JSON.stringify([next, record.areaOfPracticeThemeIds, record.areaOfPracticeOther ?? ""]); setIsPractitioner(next); setThemeIds(record.areaOfPracticeThemeIds); setOther(record.areaOfPracticeOther ?? ""); } });

  useEffect(() => {
    if (practitionerDirty) return;
    practitionerBaseline.current = JSON.stringify([record.isElevatePractitioner ? "yes" : "", record.areaOfPracticeThemeIds, record.areaOfPracticeOther ?? ""]);
    setIsPractitioner(record.isElevatePractitioner ? "yes" : "");
    setThemeIds(record.areaOfPracticeThemeIds);
    setOther(record.areaOfPracticeOther ?? "");
  }, [record.areaOfPracticeOther, record.areaOfPracticeThemeIds, record.isElevatePractitioner]);

  async function save(): Promise<boolean> {
    if (otherSelected && !other.trim()) {
      setMessage("Describe the other area of practice.");
      return false;
    }
    setIsSaving(true);
    try {
      const result = await api.updateLivRecord(record.id, {
        subjectStaffId: record.subjectStaffId,
        orgUnitId: record.orgUnitId,
        isElevatePractitioner: isPractitioner === "yes",
        areaOfPracticeKeys: [],
        areaOfPracticeThemeIds: themeIds,
        areaOfPracticeOther: otherSelected ? other.trim() : undefined
      }, processKey);

      if (!result.ok) {
        setMessage(result.message ?? "Elevate practitioner information could not be saved.");
        return false;
      }
      setMessage("");
      practitionerBaseline.current = JSON.stringify([isPractitioner, themeIds, other]); clearNavigation();
      await onChanged("Elevate practitioner information saved.");
      return true;
    } finally { setIsSaving(false); }
  }

  return <fieldset disabled={isSaving} style={{ display: "contents" }}><details className="panel liv-v2-records"><summary><span><strong>Elevate practitioner</strong><small>Practitioner status and areas of practice</small></span><ChevronDown size={18} /></summary><div className="form-stack liv-practitioner-editor"><WorkflowFeedback message={message} /><label className="entry-field"><span>Elevate practitioner</span><select disabled={!record.canEdit} onChange={(event) => setIsPractitioner(event.target.value)} value={isPractitioner}><option value="">-</option><option value="yes">Yes</option></select></label><fieldset className="support-options"><legend>Areas of practice</legend>{themes.map((theme) => <label key={theme.id}><input checked={themeIds.includes(theme.id)} disabled={!record.canEdit} onChange={() => setThemeIds((current) => current.includes(theme.id) ? current.filter((id) => id !== theme.id) : [...current, theme.id])} type="checkbox" /><span>{theme.name}</span></label>)}</fieldset>{otherSelected ? <label className="entry-field"><span>Other area of practice</span><input disabled={!record.canEdit} onChange={(event) => setOther(event.target.value)} value={other} /></label> : null}{record.canEdit ? <div className="toolbar toolbar-end"><Button disabled={isSaving} icon={Save} onClick={() => void save()} variant="primary">{isSaving ? "Saving..." : "Save practitioner information"}</Button></div> : <p className="muted-copy">This information is read-only for your current access.</p>}</div></details></fieldset>;
}

function LivActions({ actions, record, cycle, ownerOptions, staff, onChanged, processKey }: {
  actions: ActionSummary[];
  record: LivRecordSummary;
  cycle: LivCycle;
  ownerOptions: ActionOwnerOption[];
  staff: StaffSummary[];
  onChanged: (message: string) => Promise<void>;
  processKey: "liv" | "als_liv";
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [actionTheme, setActionTheme] = useState("");
  const [text, setText] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const clearNavigation = useUnsavedChanges({ label: "New LIV action", dirty: isAdding && Boolean(actionTheme || text || ownerId || dueDate), saving: isSaving,
    submission: true, onSubmit: record.canEdit && cycle.status === "in_progress" ? createAction : undefined, submitLabel: "Create action",
    onDiscard: () => { setIsAdding(false); setActionTheme(""); setText(""); setOwnerId(""); setDueDate(""); } });

  async function createAction(): Promise<boolean> {
    if (!record.canEdit || cycle.status !== "in_progress" || isSaving) return false;
    if (!actionTheme.trim() || !text.trim() || !ownerId || !dueDate) { setMessage("Complete the action theme, description, owner and implementation date."); return false; }
    setIsSaving(true);
    try {
      const result = await api.createAction({ sourceRecordId: record.recordId, sourceFormType: processKey, subjectStaffId: record.subjectStaffId, ownerStaffId: ownerId, actionTheme: actionTheme.trim(), title: text.trim(), dueDate, publishedToStaff: true, livCycleId: cycle.id, visibilitySetting: "staff_and_management" });

      if (!result.ok) { setMessage(result.message ?? "The action could not be saved. Your changes are still here."); return false; }
      clearNavigation();
      setActionTheme(""); setText(""); setOwnerId(""); setDueDate(""); setIsAdding(false);
      await onChanged("LIV action created.");
      return true;
    } finally { setIsSaving(false); }
  }

  return (
    <fieldset disabled={isSaving} style={{ display: "contents" }}><div className="liv-v2-actions">
      {message ? <p role="alert">{message}</p> : null}
      <div className="liv-actions-heading"><div><h3>Cycle actions</h3><span>{actions.length} linked to this cycle</span></div>{record.canEdit && cycle.status === "in_progress" ? <Button icon={Plus} onClick={() => setIsAdding(true)} variant="primary">Add action</Button> : null}</div>
      {isAdding ? <div className="liv-action-editor"><label className="entry-field"><span>Action theme <strong>Required</strong></span><ActionThemeSelect id={`liv-action-theme-${cycle.id}`} onChange={setActionTheme} sourceFormType={processKey} value={actionTheme} /></label><label className="entry-field"><span>Action <strong>Required</strong></span><textarea maxLength={300} onChange={(event) => setText(event.target.value)} rows={3} value={text} /></label><div className="form-grid form-grid-two"><label className="entry-field"><span>Owner <strong>Required</strong></span><select onChange={(event) => setOwnerId(event.target.value)} value={ownerId}><option value="">Select owner</option>{ownerOptions.map((option) => <option key={option.staffId} value={option.staffId}>{option.displayName} - {option.relationship}</option>)}</select></label><label className="entry-field"><span>Date to be implemented by <strong>Required</strong></span><input onChange={(event) => setDueDate(event.target.value)} type="date" value={dueDate} /></label></div><div className="toolbar toolbar-end"><Button icon={X} onClick={() => void confirmUnsavedNavigation().then(leave => { if (leave) setIsAdding(false); })}>Cancel</Button><Button disabled={isSaving || !actionTheme.trim() || !text.trim() || !ownerId || !dueDate} icon={Save} onClick={() => void createAction()} variant="primary">Create action</Button></div></div> : null}
      <div className="liv-action-list">{actions.length === 0 ? <p className="muted-copy">No actions have been added to this cycle.</p> : actions.map((action) => <LivActionCard action={action} key={action.id} onChanged={onChanged} />)}</div>
      {record.canEdit && cycle.status === "in_progress" && ownerOptions.length === 0 && staff.length > 0 ? <small className="muted-copy">No valid owners are available for this record and your current permissions.</small> : null}
    </div></fieldset>
  );
}

function PreviousActions({ actions, onChanged }: { actions: ActionSummary[]; onChanged: (message: string) => Promise<void> }) {
  return <details open><summary>Previous cycle actions</summary><div className="liv-action-list">{actions.map((action) => <LivActionCard action={action} key={action.id} onChanged={onChanged} />)}</div></details>;
}

function LivActionCard({ action, onChanged }: { action: ActionSummary; onChanged: (message: string) => Promise<void> }) {
  const [mode, setMode] = useState<"" | "complete" | "extend">("");
  const [comments, setComments] = useState("");
  const [date, setDate] = useState(action.revisedDueDate ?? action.dueDate ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const state = dashboardActionState(action);
  const closed = !isDashboardActionOpen(action);
  const [message, setMessage] = useState("");
  const clearNavigation = useUnsavedChanges({ label: mode === "complete" ? "LIV action closure" : "LIV action extension", saving: isSaving,
    dirty: Boolean(mode && (comments || date !== (action.revisedDueDate ?? action.dueDate ?? ""))), onSave: () => submit(),
    onDiscard: () => { setMode(""); setComments(""); setDate(action.revisedDueDate ?? action.dueDate ?? ""); } });

  async function submit(): Promise<boolean> {
    if (!mode || !comments.trim() || (mode === "extend" && !date)) { setMessage("Enter the required comments and revised date before saving."); return false; }
    setIsSaving(true);
    try {
      const result = mode === "complete"
        ? await api.updateAction(action.id, { status: "complete", completionNote: comments.trim() || undefined })
        : await api.extendAction(action.id, { dueDate: date, reason: comments.trim() });

      if (!result.ok) { setMessage(result.message ?? "The action could not be updated."); return false; }
      clearNavigation();
      setMode(""); setComments("");
      await onChanged(mode === "complete" ? "Action closed." : "Action implementation date extended.");
      return true;
    } finally { setIsSaving(false); }
  }

  return <fieldset disabled={isSaving} style={{ display: "contents" }}><article className="liv-action-card">{message ? <p role="alert">{message}</p> : null}<div className="liv-visit-card-heading"><div><h3>{action.title}</h3><span>{action.ownerStaffName ?? "Unassigned"} · {action.revisedDueDate ?? action.dueDate ?? "No date"}</span></div><span className={`status-pill ${closed ? "status-complete" : action.isOverdue ? "status-overdue" : "status-open"}`}>{state === "cancelled" ? "Cancelled" : state === "complete" ? "Completed" : state === "overdue" ? "Overdue" : action.statusKey === "extended" ? "Extended" : "Open"}</span></div>{action.detail ? <p>{action.detail}</p> : null}{!closed ? <div className="toolbar"><Button icon={CheckCircle2} onClick={() => setMode("complete")}>Close</Button><Button icon={CalendarClock} onClick={() => setMode("extend")}>Extend</Button></div> : action.completionNote ? <small>{action.completionNote}</small> : null}{mode ? <div className="liv-action-editor">{mode === "extend" ? <label className="entry-field"><span>Revised implementation date</span><input onChange={(event) => setDate(event.target.value)} type="date" value={date} /></label> : null}<label className="entry-field"><span>{mode === "complete" ? "Closure comments" : "Extension reason"}</span><textarea onChange={(event) => setComments(event.target.value)} rows={3} value={comments} /></label><div className="toolbar"><Button icon={X} onClick={() => void confirmUnsavedNavigation().then(leave => { if (leave) setMode(""); })}>Cancel</Button><Button disabled={isSaving || !comments.trim() || (mode === "extend" && !date)} icon={mode === "complete" ? CheckCircle2 : CalendarClock} onClick={() => void submit()} variant="primary">{mode === "complete" ? "Close action" : "Extend action"}</Button></div></div> : null}</article></fieldset>;
}

function OpportunityChecklist({ options, selected, disabled, onChange }: { options: LivConfiguration["developmentOpportunities"]; selected: string[]; disabled: boolean; onChange: (keys: string[]) => void }) {
  return <fieldset className="support-options"><legend>Development opportunities</legend>{options.map((option) => <label key={option.key}><input checked={selected.includes(option.key)} disabled={disabled} onChange={() => onChange(selected.includes(option.key) ? selected.filter((key) => key !== option.key) : [...selected, option.key])} type="checkbox" /><span>{option.name}</span></label>)}</fieldset>;
}

function EliContext({ context }: { context: LivStaffContext }) {
  return <section className="liv-v2-eli-context"><div className="liv-information-grid"><div><span>Preferred month</span><strong>{formatPreferredMonth(context.preferredVisitMonth)}</strong></div><div><span>Primary focus</span><strong>{context.primaryFocus ?? "Not provided"}</strong></div><div><span>Secondary focus</span><strong>{context.secondaryFocusKey === "other" ? context.secondaryFocusOther || "Other" : context.secondaryFocus ?? "Not provided"}</strong></div></div><details><summary><Target size={16} /> Desired outcome</summary><p>{context.desiredOutcome || "No desired outcome was provided."}</p></details>{context.existingLivRecordId ? <p className="notice-row">This submitted ELI assessment is already linked to a LIV case.</p> : null}</section>;
}

function emptyStageRequest(stageType: LivStage["stageType"]): SaveLivStageRequest { return { stageType, developmentOpportunityKeys: [], stageStatus: "in_progress" }; }
function stageToRequest(stage: LivStage, cycleNumber: number): SaveLivStageRequest { return { stageType: stage.stageType, contextText: stage.contextText, aimsText: stage.aimsText, learnerActivityText: stage.learnerActivityText, reflectionText: stage.reflectionText, intendedFollowUpDate: stage.intendedFollowUpDate, distanceImpactText: stage.distanceImpactText, developmentOpportunityKeys: stage.developmentOpportunityKeys, stageStatus: stage.stageType === "follow_up_review" && cycleNumber === 1 && stage.stageStatus === "not_applicable" ? "in_progress" : stage.stageStatus }; }
function visitToRequest(visit?: LivVisitSummary): SaveLivVisitRequest { return { visitDate: visit?.visitDate, visitTime: visit?.visitTime, courseName: visit?.courseName, courseLevel: visit?.courseLevel, reflectionNotes: visit?.reflectionNotes, findings: visit?.findings, deliveryAreaKey: visit?.deliveryAreaKey, ratings: visit?.ratings.map((rating) => ({ focusKey: rating.focusKey, descriptorId: rating.descriptorId, isNotApplicable: rating.isNotApplicable })) ?? [] }; }
function latestVisit(record: LivRecordSummary) { return record.visits.at(-1); }
function eliSecondaryFocus(record: LivRecordSummary) { return record.eliSecondaryFocusKey === "other" ? record.eliSecondaryFocusOther || "Other" : record.eliSecondaryFocus ?? "Not provided"; }
function formatPreferredMonth(value?: string) { if (!value) return "Not provided"; const [year, month] = value.split("-").map(Number); return new Date(year, month - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" }); }
function coverageStatusLabel(status: CoverageStatus) { return status === "completed" ? "Completed" : status === "in_progress" ? "In progress" : "Not started"; }
function coverageStatusClass(status: CoverageStatus) { return status === "completed" ? "status-complete" : status === "in_progress" ? "status-draft" : "status-overdue"; }
