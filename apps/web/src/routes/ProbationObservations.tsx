import { useFormContent } from "../services/formContent";
import { WorkflowNarrativeField } from "../components/WorkflowNarrativeField";
import { LoadingState } from "../components/LoadingState";
import { ScrollableTableRegion } from "../components/ScrollableTableRegion";
import { focusWorkflowControl } from "../services/workflowExperience";
import { dashboardActionState } from "../services/dashboardActionState";
import { useWorkflowPagination, WorkflowPagination } from "../components/WorkflowPagination";
import { WorkflowFeedback } from "../components/WorkflowFeedback";
import { WorkflowFilters } from "../components/WorkflowFilters";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BookOpenCheck,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Eye,
  FilePlus2,
  ListChecks,
  MessageSquareText,
  Plus,
  Save,
  Search,
  UsersRound,
  X
} from "lucide-react";
import { KpiStrip } from "../components/KpiStrip";
import { ExportExcelButton, ExportWordButton } from "../components/ExportButtons";
import { StaffSearchSelect } from "../components/StaffSearchSelect";
import { ActionThemeSelect } from "../components/ActionThemeSelect";
import { Button } from "../design-system/Button";
import { confirmUnsavedNavigation, useUnsavedChanges } from "../components/UnsavedChangesGuard";
import { useActionOwners } from "../components/useActionOwners";
import { api } from "../services/api";
import { distinctListValues, matchesListSearch, sortListRows } from "../services/listQuery";
import { saveProbationActions } from "../services/saveProbationActions";
import type {
  ActionOwnerOption,
  ActionSummary,
  CurrentUser,
  LivConfiguration,
  LivRecordSummary,
  OrgUnitSummary,
  ProbationCase,
  ProbationConfiguration,
  ProbationObservation,
  ProbationStage,
  ProbationStaffContext,
  ProbationVisit,
  SaveProbationStageRequest,
  SaveProbationVisitRequest,
  StaffSummary
} from "../services/types";
import { LivCaseWorkspace } from "./LivVisits";

type Props = {
  actions: ActionSummary[];
  staff: StaffSummary[];
  orgUnits: OrgUnitSummary[];
  user: CurrentUser;
  onActionsChanged?: () => Promise<void>;
  onOpenEliReport: (staffId: string, elevateRecordId: string) => void;
  onOpenUcoTlaReview: (recordId: string) => void;
  initialSourceRecordId?: string;
  onRecordOpened?: (recordId: string) => void;
  onRecordClosed?: () => void;
};

const stageDefinitions = [
  { type: "professional_discussion", label: "Professional Discussion", icon: MessageSquareText },
  { type: "visit_rubric", label: "Observation and Practice Rubric", icon: Eye },
  { type: "reflection_feedback", label: "Reflection and Feedback", icon: BookOpenCheck },
  { type: "actions", label: "Actions", icon: ListChecks },
  { type: "next_observation", label: "Next Probationary Observation", icon: CalendarClock }
] as const;

export function ProbationObservations({
  actions,
  staff,
  orgUnits,
  user,
  onActionsChanged,
  onOpenEliReport,
  onOpenUcoTlaReview,
  initialSourceRecordId = "",
  onRecordOpened,
  onRecordClosed
}: Props) {
  const [cases, setCases] = useState<ProbationCase[]>([]);
  const [configuration, setConfiguration] = useState<ProbationConfiguration | null>(null);
  const [livConfiguration, setLivConfiguration] = useState<LivConfiguration | null>(null);
  const [livRecords, setLivRecords] = useState<LivRecordSummary[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [selectedObservationNumber, setSelectedObservationNumber] = useState<1 | 2 | 3>(1);
  const [selectedLivCycleId, setSelectedLivCycleId] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [subjectStaffId, setSubjectStaffId] = useState("");
  const [teachingLearningReviewerId, setTeachingLearningReviewerId] = useState("");
  const [staffContext, setStaffContext] = useState<ProbationStaffContext | null>(null);
  const [search, setSearch] = useState("");
  const [yearFilter, setYearFilter] = useState("all");
  const [facultyFilter, setFacultyFilter] = useState("all");
  const [teamFilter, setTeamFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [reviewerFilter, setReviewerFilter] = useState("all");
  const [observationFilter, setObservationFilter] = useState("all");
  const [sort, setSort] = useState("staff");
  const [recordOwnershipView, setRecordOwnershipView] = useState<"mine" | "scope">("mine");
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const refreshRequest = useRef(0);

  const hasProbationPermission = user.permissions.includes("probation.submit") || user.permissions.includes("probation.manage");
  const canCreate = hasProbationPermission && Boolean(configuration?.canCreateCase);
  const clearCreateNavigation = useUnsavedChanges({ label: "New probation case", dirty: isCreating && Boolean(subjectStaffId || teachingLearningReviewerId), saving: isCreating && isSaving,
    submission: true, onSubmit: canCreate ? createCase : undefined, submitLabel: "Create probation case",
    onDiscard: () => { setIsCreating(false); setSubjectStaffId(""); setTeachingLearningReviewerId(""); setStaffContext(null); } });
  const selectedCase = cases.find((item) => item.id === selectedCaseId) ?? null;

  async function openCase(item: ProbationCase) {
    if (!await confirmUnsavedNavigation()) return;
    setSelectedCaseId(item.id);
    setSelectedObservationNumber(item.currentObservationNumber);
    onRecordOpened?.(item.recordId);
    if (typeof window !== "undefined") window.requestAnimationFrame(() => focusWorkflowControl("probation-case-heading"));
  }
  // Case snapshots remain authoritative after a staff transfer or an area's retirement.
  const caseArea = (item: ProbationCase) => orgUnits.find(unit => unit.id === item.orgUnitId);
  const caseFacultyCode = (item: ProbationCase) => item.parentOrgUnitCode || (caseArea(item)?.orgUnitType === "faculty" ? item.orgUnitCode : orgUnits.find(unit => unit.id === caseArea(item)?.parentOrgUnitId)?.code);
  const faculties = sortListRows(distinctListValues(cases.map(caseFacultyCode)).map(code => ({ code, name: orgUnits.find(unit => unit.code === code)?.name || code })), unit => unit.name);
  const teams = sortListRows([...new Map(cases.filter(item => facultyFilter === "all" || caseFacultyCode(item) === facultyFilter).filter(item => item.orgUnitId && (item.parentOrgUnitCode || caseArea(item)?.orgUnitType !== "faculty")).map(item => [item.orgUnitId!, { id: item.orgUnitId!, code: item.orgUnitCode || "Unassigned", name: caseArea(item)?.name || item.orgUnitCode || "Unassigned" }])).values()], unit => unit.name);
  const reviewers = sortListRows([...new Map(cases.flatMap(item => item.reviewers.map(reviewer => [reviewer.staffId, reviewer.displayName] as const))).entries()], entry => entry[1]);

  async function refresh(nextMessage = "") {
    const request = ++refreshRequest.current;
    setIsLoading(true);
    try {
      const [nextCases, nextConfiguration, nextLivRecords] = await Promise.all([
        api.probationCases(),
        api.probationConfiguration(),
        api.livRecords()
      ]);
      if (request !== refreshRequest.current) return;
      setLoadFailed(false);
      setCases(nextCases);
      setConfiguration(nextConfiguration);
      setLivConfiguration(nextConfiguration);
      setLivRecords(nextLivRecords);
      if (nextMessage) setMessage(nextMessage);
    } catch {
      if (request !== refreshRequest.current) return;
      setLoadFailed(true);
      setMessage("Probationary observations could not be loaded from the API.");
    } finally { if (request === refreshRequest.current) setIsLoading(false); }
  }

  useEffect(() => { void refresh(); return () => { refreshRequest.current += 1; }; }, []);
  useEffect(() => {
    if (!initialSourceRecordId || cases.length === 0) return;
    const match = cases.find((item) => item.recordId === initialSourceRecordId
      || item.observations.some((observation) => observation.linkedLivSourceRecordId === initialSourceRecordId
        || observation.linkedUcoTlaReviewId === initialSourceRecordId));
    if (match) {
      openCase(match);
    const linked = match.observations.find((observation) => observation.linkedLivSourceRecordId === initialSourceRecordId
      || observation.linkedUcoTlaReviewId === initialSourceRecordId);
      setSelectedObservationNumber(linked?.observationNumber ?? match.currentObservationNumber);
    }
  }, [cases, initialSourceRecordId]);
  useEffect(() => {
    let cancelled = false;
    setStaffContext(null);
    if (!subjectStaffId || !canCreate) return;
    api.probationStaffContext(subjectStaffId).then(context => { if (!cancelled) setStaffContext(context); }).catch(() => { if (!cancelled) setStaffContext(null); });
    return () => { cancelled = true; };
  }, [canCreate, subjectStaffId]);

  const years = useMemo(() => distinctListValues(cases.map(item => item.academicYear)).reverse(), [cases]);
  const filteredCases = sortListRows(cases.filter(item => {
    const staffMember = staff.find(candidate => candidate.id === item.subjectStaffId);
    return matchesListSearch(search, item.subjectStaffName, staffMember?.externalId, staffMember?.email, item.orgUnitCode,
      item.parentOrgUnitCode, caseArea(item)?.name, item.academicYear, item.status.replaceAll("_", " "),
      `Observation ${item.currentObservationNumber}`, item.reviewers.map(reviewer => reviewer.displayName))
      && (yearFilter === "all" || item.academicYear === yearFilter)
      && (facultyFilter === "all" || caseFacultyCode(item) === facultyFilter)
      && (teamFilter === "all" || item.orgUnitId === teamFilter)
      && (statusFilter === "all" || item.status === statusFilter)
      && (reviewerFilter === "all" || item.reviewers.some(reviewer => reviewer.staffId === reviewerFilter))
      && (observationFilter === "all" || String(item.currentObservationNumber) === observationFilter)
      && (recordOwnershipView === "scope" || item.isCreatedByCurrentUser);
  }), item => sort === "year" ? item.academicYear : sort === "status" ? item.status : sort === "observation" ? item.currentObservationNumber
    : sort === "newest" || sort === "oldest" ? new Date(item.updatedAt || item.createdAt) : item.subjectStaffName,
  sort === "newest" || sort === "year" ? "desc" : "asc", item => item.id);

  const recordPage = useWorkflowPagination(filteredCases, JSON.stringify([recordOwnershipView, search, yearFilter, facultyFilter, teamFilter, statusFilter, reviewerFilter, observationFilter, sort]));
  const completionCounts = [1, 2, 3].map((number) => filteredCases.filter((item) => highestCompletedObservation(item) === number).length);

  async function closeCreate() {
    if (!await confirmUnsavedNavigation()) return;
    setIsCreating(false); setSubjectStaffId(""); setTeachingLearningReviewerId(""); setStaffContext(null);
    window.requestAnimationFrame(() => focusWorkflowControl("probation-create-trigger"));
  }

  async function createCase(): Promise<boolean> {
    if (!canCreate || isSaving || !subjectStaffId) return false;
    setIsSaving(true);
    try {
      const staffMember = configuration?.eligibleStaff.find((item) => item.id === subjectStaffId);
      const result = await api.createProbationCase({
        subjectStaffId,
        teachingLearningReviewerStaffId: teachingLearningReviewerId || undefined,
        orgUnitId: staffMember?.primaryOrgUnitId
      });

      if (!result.ok) {
        setMessage(result.message ?? "The probationary observation case could not be created.");
        return false;
      }
      setIsCreating(false);
      clearCreateNavigation();
      setSubjectStaffId("");
      setTeachingLearningReviewerId("");
      setSelectedCaseId(result.data?.id ?? "");
      setSelectedObservationNumber(1);
      await refresh("Probationary observation case created.");
      return true;
    } finally { setIsSaving(false); }
  }

  if (selectedCase && configuration && livConfiguration) {
    return (
      <ProbationCaseWorkspace
        actions={actions}
        configuration={configuration}
        livConfiguration={livConfiguration}
        livRecords={livRecords}
        selectedObservationNumber={selectedObservationNumber}
        selectedLivCycleId={selectedLivCycleId}
        record={selectedCase}
        staff={staff}
        onBack={() => { setSelectedCaseId(""); setSelectedLivCycleId(""); onRecordClosed?.(); window.requestAnimationFrame(() => focusWorkflowControl("probation-records-summary")); }}
        onChanged={async (nextMessage) => { await onActionsChanged?.(); await refresh(nextMessage); }}
        onObservationChange={(number) => { setSelectedObservationNumber(number); setSelectedLivCycleId(""); }}
        onLivCycleChange={setSelectedLivCycleId}
        onOpenEliReport={onOpenEliReport}
        onOpenUcoTlaReview={onOpenUcoTlaReview}
      />
    );
  }

  return (
    <fieldset disabled={isSaving} style={{ display: "contents" }}><div className="route-stack probation-route">
      <div className="route-header">
        <div><p className="eyebrow">Staff probation observation process</p><h1>Probationary Observations</h1></div>
        {canCreate ? <Button id="probation-create-trigger" aria-expanded={isCreating} icon={FilePlus2} onClick={() => isCreating ? closeCreate() : setIsCreating(true)} variant="primary">Create probation case</Button> : null}
      </div>
      <WorkflowFeedback message={message} />
      {loadFailed ? <Button disabled={isLoading} onClick={() => void refresh()}>Retry loading observations</Button> : null}
      {isLoading ? <LoadingState label="Loading probationary observations…" /> : null}

      {isCreating && configuration ? (
        <section className="panel probation-create-panel">
          <div className="panel-heading"><div><h2>New probationary observation cycle</h2><span>Select a staff member within your permitted area. You will be assigned as lead reviewer automatically.</span></div><button className="icon-button" onClick={closeCreate} title="Close" type="button"><X size={16} /></button></div>
          <div className="form-grid form-grid-three">
            <label className="entry-field"><span>Staff member</span><StaffSearchSelect helperText="Search the staff available within your team, faculty or organisation scope." id="probation-subject" onChange={setSubjectStaffId} staff={configuration.eligibleStaff} value={subjectStaffId} /></label>
            <label className="entry-field"><span>Teaching and Learning reviewer <small>Optional</small></span><select onChange={(event) => setTeachingLearningReviewerId(event.target.value)} value={teachingLearningReviewerId}><option value="">No T&L reviewer</option>{configuration.teachingLearningReviewers.map((reviewer) => <option disabled={reviewer.staffId === user.staffId} key={reviewer.staffId} value={reviewer.staffId}>{reviewer.displayName}</option>)}</select></label>
            <div className="entry-field"><span>Lead reviewer</span><div className="probation-auto-reviewer"><strong>{user.displayName}</strong><small>Assigned from your signed-in account</small></div></div>
          </div>
          {staffContext ? <ProbationEliContext context={staffContext} /> : null}
          <div className="toolbar toolbar-end"><Button icon={X} onClick={closeCreate}>Cancel</Button><Button disabled={isSaving || !subjectStaffId || Boolean(staffContext?.hasProbationCaseForAcademicYear)} icon={Plus} onClick={() => void createCase()} variant="primary">{isSaving ? "Creating..." : "Create cycle"}</Button></div>
        </section>
      ) : null}

      <KpiStrip items={[
        { label: "Completed Observation 1", value: completionCounts[0], tone: "blue" },
        { label: "Completed Observation 2", value: completionCounts[1], tone: "amber" },
        { label: "Completed Observation 3", value: completionCounts[2], tone: "green" }
      ]} />

      <details className="panel liv-v2-records" open>
        <summary id="probation-records-summary"><span><strong>{recordOwnershipView === "mine" ? "My probationary observation records" : "Probationary observation records in scope"}</strong><small>{filteredCases.length} records in this view</small></span><ChevronDown aria-hidden="true" size={18} /></summary>
        <div className="toolbar toolbar-end">{user.permissions.includes("exports.create") ? <ExportExcelButton filters={{ academicYear: yearFilter === "all" ? undefined : yearFilter }} moduleKey="probation" orgUnits={orgUnits} /> : null}</div>
        <div className="segmented-control record-ownership-switch" aria-label="Probation record ownership view"><button aria-pressed={recordOwnershipView === "mine"} className={recordOwnershipView === "mine" ? "is-active" : ""} onClick={() => setRecordOwnershipView("mine")} type="button">My probation records</button><button aria-pressed={recordOwnershipView === "scope"} className={recordOwnershipView === "scope" ? "is-active" : ""} onClick={() => setRecordOwnershipView("scope")} type="button">All in my scope</button></div>
        <WorkflowFilters activeCount={[yearFilter, facultyFilter, teamFilter, statusFilter, reviewerFilter, observationFilter].filter(value => value !== "all").length} hasQuery={Boolean(search)} onClear={() => { setSearch(""); setYearFilter("all"); setFacultyFilter("all"); setTeamFilter("all"); setStatusFilter("all"); setReviewerFilter("all"); setObservationFilter("all"); setSort("staff"); }} primary={<>
<label className="search-box"><Search size={16} /><input onChange={(event) => setSearch(event.target.value)} aria-label="Search probation cases" placeholder="Search staff, reviewer, area or observation" value={search} /></label>
<label><span>Sort by</span><select aria-label="Sort probation cases" value={sort} onChange={event => setSort(event.target.value)}><option value="staff">Staff name</option><option value="newest">Last activity: newest first</option><option value="oldest">Last activity: oldest first</option><option value="year">Academic year: newest first</option><option value="observation">Current observation</option><option value="status">Status</option></select></label>
</>}>
<label><span>Academic year</span><select onChange={(event) => setYearFilter(event.target.value)} value={yearFilter}><option value="all">All years</option>{years.map((year) => <option key={year}>{year}</option>)}</select></label>
          <label><span>Faculty</span><select onChange={(event) => { setFacultyFilter(event.target.value); setTeamFilter("all"); }} value={facultyFilter}><option value="all">All faculties</option>{faculties.map((unit) => <option key={unit.code} value={unit.code}>{unit.code} - {unit.name}</option>)}</select></label>
          <label><span>Team</span><select onChange={(event) => setTeamFilter(event.target.value)} value={teamFilter}><option value="all">All teams</option>{teams.map((unit) => <option key={unit.id} value={unit.id}>{unit.code} - {unit.name}</option>)}</select></label>
          <label><span>Status</span><select onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}><option value="all">All statuses</option>{distinctListValues(cases.map(item => item.status)).map(status => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select></label>
          <label><span>Reviewer</span><select value={reviewerFilter} onChange={event => setReviewerFilter(event.target.value)}><option value="all">All reviewers</option>{reviewers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
          <label><span>Current observation</span><select value={observationFilter} onChange={event => setObservationFilter(event.target.value)}><option value="all">All observations</option>{distinctListValues(cases.map(item => String(item.currentObservationNumber))).map(number => <option key={number} value={number}>Observation {number}</option>)}</select></label>
</WorkflowFilters>
        <ScrollableTableRegion label="Probationary observation records"><table><thead><tr><th scope="col">Staff member</th><th scope="col">Faculty / team</th><th scope="col">Academic year</th><th scope="col">Progress</th><th scope="col">Reviewers</th><th scope="col">Open</th></tr></thead><tbody>
          {isLoading && filteredCases.length === 0 ? null : loadFailed && filteredCases.length === 0 ? <tr><td colSpan={6}>Records are temporarily unavailable. Use Retry loading observations above.</td></tr> : filteredCases.length === 0 ? <tr><td colSpan={6}>{recordOwnershipView === "mine" ? "You have not created any probation records matching these filters." : "No probation records match these filters."}</td></tr> : recordPage.items.map((item) => <tr key={item.id}><td><strong>{item.subjectStaffName}</strong></td><td>{[item.parentOrgUnitCode, item.orgUnitCode].filter(Boolean).join(" / ") || "Unassigned"}</td><td>{item.academicYear}</td><td><span className={`status-pill ${item.status === "completed" ? "status-complete" : "status-draft"}`}>{item.status === "completed" ? "Observation 3 complete" : `Observation ${item.currentObservationNumber}`}</span></td><td>{item.reviewers.map((reviewer) => reviewer.displayName).join(" and ")}</td><td><button className="icon-button" onClick={() => openCase(item)} title="Open probation case" type="button"><Eye size={16} /></button></td></tr>)}
        </tbody></table></ScrollableTableRegion>
        <WorkflowPagination {...recordPage} label="Probation records" />
      </details>
    </div></fieldset>
  );
}

function ProbationCaseWorkspace({ record, configuration, livConfiguration, livRecords, actions, selectedObservationNumber, selectedLivCycleId, staff, onBack, onChanged, onObservationChange, onLivCycleChange, onOpenEliReport, onOpenUcoTlaReview }: {
  record: ProbationCase;
  configuration: ProbationConfiguration;
  livConfiguration: LivConfiguration;
  livRecords: LivRecordSummary[];
  actions: ActionSummary[];
  selectedObservationNumber: 1 | 2 | 3;
  selectedLivCycleId: string;
  staff: StaffSummary[];
  onBack: () => void;
  onChanged: (message: string) => Promise<void>;
  onObservationChange: (number: 1 | 2 | 3) => void;
  onLivCycleChange: (id: string) => void;
  onOpenEliReport: (staffId: string, elevateRecordId: string) => void;
  onOpenUcoTlaReview: (recordId: string) => void;
}) {
  const observation = record.observations.find((item) => item.observationNumber === selectedObservationNumber)
    ?? record.observations.find((item) => item.observationNumber === record.currentObservationNumber)!;
  const linkedLiv = observation?.linkedLivRecordId ? livRecords.find((item) => item.id === observation.linkedLivRecordId) : undefined;
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function startLiv() {
    setIsSaving(true);
    try {
      const result = await api.startProbationLiv(record.id);

      if (!result.ok) {
        setMessage(result.message ?? "Observation 2 could not be started.");
        return;
      }
      await onChanged("Observation 2 LIV created and linked to both records.");
    } finally { setIsSaving(false); }
  }

  async function completeObservation() {
    if (!observation || !await confirmUnsavedNavigation() || !window.confirm(`Complete Probation Observation ${observation.observationNumber}?`)) return;
    setIsSaving(true);
    try {
      const result = await api.completeProbationObservation(record.id, observation.id);

      if (!result.ok) {
        setMessage(result.message ?? "The observation could not be completed.");
        return;
      }
      await onChanged(observation.observationNumber === 1 ? "Observation 1 completed. Observation 2 is ready." : "Probationary observation cycle completed.");
      onObservationChange(observation.observationNumber === 1 ? 2 : 3);
    } finally { setIsSaving(false); }
  }

  return (
    <div className="route-stack probation-workspace">
      <div className="route-header probation-case-header">
        <div><Button icon={ArrowLeft} onClick={() => void confirmUnsavedNavigation().then(leave => { if (leave) onBack(); })}>Back to probation records</Button><p className="eyebrow">{record.academicYear} probation cycle</p><h1 id="probation-case-heading" tabIndex={-1}>{record.subjectStaffName}</h1></div>
        <div className="toolbar"><ExportWordButton recordId={record.recordId} /><Button disabled={!record.sourceElevateRecordId} icon={ClipboardCheck} onClick={() => record.sourceElevateRecordId && onOpenEliReport(record.subjectStaffId, record.sourceElevateRecordId)} variant="primary">{record.sourceElevateRecordId ? "Open ELI report" : "No submitted ELI report"}</Button></div>
      </div>
      <WorkflowFeedback message={message} />
      <section className="panel probation-case-summary">
        <div><span>Teaching and Learning reviewer</span><strong>{record.reviewers.find((reviewer) => reviewer.reviewerRole === "teaching_learning")?.displayName ?? "Not assigned"}</strong></div>
        <div><span>Leader reviewer</span><strong>{record.reviewers.find((reviewer) => reviewer.reviewerRole === "leader")?.displayName ?? "Not assigned"}</strong></div>
        <div><span>Faculty / team</span><strong>{[record.parentOrgUnitCode, record.orgUnitCode].filter(Boolean).join(" / ") || "Unassigned"}</strong></div>
        <div><span>Cycle status</span><strong>{record.status === "completed" ? "Completed" : "In progress"}</strong></div>
      </section>
      <div className="probation-observation-switcher" aria-label="Probation observation progress">
        {record.observations.map((item) => {
          const available = item.status !== "not_started" || item.observationNumber === record.currentObservationNumber;
          return <button aria-pressed={item.observationNumber === observation.observationNumber} className={item.observationNumber === observation.observationNumber ? "is-active" : ""} disabled={!available} key={item.id} onClick={() => void confirmUnsavedNavigation().then(leave => { if (leave) onObservationChange(item.observationNumber); })} type="button"><span>{item.status === "completed" ? <CheckCircle2 size={18} /> : item.observationNumber}</span><strong>Observation {item.observationNumber}</strong><small>{item.observationNumber === 2 ? (item.observationType === "uco_tla" ? "UCO TLA" : "LIV") : "Probation template"} / {formatStatus(item.status)}</small></button>;
        })}
      </div>

      {observation.observationNumber === 2 ? (
        observation.linkedUcoTlaReviewId ? (
          <section className="panel probation-start-liv">
            <div><span className="probation-stage-icon"><ClipboardCheck size={22} /></span><h2>Observation 2 / UCO TLA Review</h2><p>This shared review is completed in the dedicated UCO workflow. Completing it also completes this probation observation.</p></div>
            <Button icon={ClipboardCheck} onClick={() => onOpenUcoTlaReview(observation.linkedUcoTlaReviewId!)} variant="primary">Open UCO TLA Review</Button>
          </section>
        ) : linkedLiv ? (
          <section className="probation-linked-liv">
            <div className="dashboard-section-heading"><div><h2>Observation 2 / LIV</h2><span>This is one shared record and also appears in the staff member's LIV history.</span></div></div>
            <LivCaseWorkspace actions={actions.filter((action) => action.sourceRecordId === linkedLiv.recordId)} configuration={livConfiguration} cycleId={selectedLivCycleId} embedded onBack={() => undefined} onChanged={onChanged} onCycleChange={onLivCycleChange} record={linkedLiv} staff={staff} />
          </section>
        ) : (
          <section className="panel probation-start-liv">
            <div><span className="probation-stage-icon"><Eye size={22} /></span><h2>Observation 2 can use LIV or a UCO TLA Review</h2><p>Start a standard LIV here. A UCO Teaching & Learning coordinator can instead link this observation when creating a UCO TLA Review.</p></div>
            {record.canEdit && record.currentObservationNumber === 2 ? <Button disabled={isSaving} icon={Plus} onClick={() => void startLiv()} variant="primary">{isSaving ? "Starting..." : "Start Observation 2 LIV"}</Button> : <span className="status-pill status-draft">Waiting for Observation 1</span>}
          </section>
        )
      ) : (
        <>
          <div className="probation-stage-stack">
            {stageDefinitions.filter((definition) => observation.observationNumber !== 3 || definition.type !== "next_observation").map((definition, index) => {
              const stage = observation.stages.find((item) => item.stageType === definition.type);
              if (!stage) return null;
              return <ProbationStagePanel actions={actions} configuration={configuration} defaultOpen={index === 0 && stage.stageStatus !== "completed"} definition={definition} key={stage.id} observation={observation} record={record} stage={stage} staff={staff} onChanged={onChanged} />;
            })}
          </div>
          {record.canEdit && record.currentObservationNumber === observation.observationNumber && observation.status !== "completed" ? <div className="probation-complete-bar"><Button disabled={isSaving || observation.stages.some((stage) => stage.stageStatus !== "completed")} icon={CheckCircle2} onClick={() => void completeObservation()} variant="primary">{`Complete Observation ${observation.observationNumber}`}</Button><small>Every visible stage must be marked complete first.</small></div> : null}
        </>
      )}
    </div>
  );
}

function ProbationStagePanel({ actions, configuration, defaultOpen, definition, observation, record, stage, staff, onChanged }: {
  actions: ActionSummary[];
  configuration: ProbationConfiguration;
  defaultOpen: boolean;
  definition: (typeof stageDefinitions)[number];
  observation: ProbationObservation;
  record: ProbationCase;
  stage: ProbationStage;
  staff: StaffSummary[];
  onChanged: (message: string) => Promise<void>;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const Icon = definition.icon;
  return (
    <details className="panel probation-stage-panel" open={isOpen} onToggle={(event) => setIsOpen(event.currentTarget.open)}>
      <summary>
        <div><span className="probation-stage-icon"><Icon size={18} /></span><p className="eyebrow">Stage {stage.stageOrder}</p><h2>{definition.label}</h2></div>
        <span className={`status-pill ${stage.stageStatus === "completed" ? "status-complete" : "status-draft"}`}>{stage.stageStatus === "completed" ? "Completed" : "In progress"}</span>
        <ChevronDown size={18} />
      </summary>
      <div className="probation-stage-body"><ProbationStageEditor actions={actions} configuration={configuration} observation={observation} record={record} stage={stage} staff={staff} onChanged={onChanged} /></div>
    </details>
  );
}

function ProbationStageEditor({ record, observation, stage, configuration, actions, staff, onChanged }: {
  record: ProbationCase;
  observation: ProbationObservation;
  stage: ProbationStage;
  configuration: ProbationConfiguration;
  actions: ActionSummary[];
  staff: StaffSummary[];
  onChanged: (message: string) => Promise<void>;
}) {
  const [form, setForm] = useState<SaveProbationStageRequest>(() => stageToRequest(stage));
  const [visit, setVisit] = useState<SaveProbationVisitRequest>(() => visitToRequest(observation.visit, stage.stageStatus));
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");

  const baseline = useRef(JSON.stringify([form, visit]));
  const dirty = stage.canEdit && JSON.stringify([form, visit]) !== baseline.current;
  const content = useFormContent("probation");
  const isStageDraft = stage.canEdit && stage.stageType !== "actions" && stage.stageStatus === "in_progress";
  const clearNavigation = useUnsavedChanges({ label: `Probation ${stage.stageType.replaceAll("_", " ")}`, dirty, saving: isSaving,
    submission: isStageDraft,
    onSave: () => stage.stageType === "visit_rubric" ? saveVisit(isStageDraft ? "in_progress" : visit.stageStatus) : saveStage(isStageDraft ? "in_progress" : form.stageStatus),
    onSubmit: isStageDraft ? () => stage.stageType === "visit_rubric" ? saveVisit("completed") : saveStage("completed") : undefined,
    submitLabel: "Complete stage",
    onDiscard: () => { const [nextForm, nextVisit] = JSON.parse(baseline.current) as [SaveProbationStageRequest, SaveProbationVisitRequest]; setForm(nextForm); setVisit(nextVisit); } });
  useEffect(() => {
    if (dirty) return;
    const nextForm = stageToRequest(stage); const nextVisit = visitToRequest(observation.visit, stage.stageStatus);
    baseline.current = JSON.stringify([nextForm, nextVisit]); setForm(nextForm); setVisit(nextVisit);
  }, [observation.visit, stage]);

  async function saveStage(stageStatus = form.stageStatus): Promise<boolean> {
    if (!stage.canEdit || isSaving) return false;
    const savedForm = { ...form, stageStatus };
    setIsSaving(true);
    try {
      const result = await api.updateProbationStage(record.id, observation.id, stage.id, savedForm);

      if (!result.ok) { setMessage(result.message ?? "The stage could not be saved."); return false; }
      setForm(savedForm); baseline.current = JSON.stringify([savedForm, visit]); clearNavigation();
      await onChanged("Probation observation stage saved.");
      return true;
    } finally { setIsSaving(false); }
  }

  async function saveVisit(stageStatus = visit.stageStatus): Promise<boolean> {
    if (!stage.canEdit || isSaving) return false;
    const savedVisit = { ...visit, stageStatus };
    setIsSaving(true);
    try {
      const result = await api.updateProbationVisit(record.id, observation.id, savedVisit);

      if (!result.ok) { setMessage(result.message ?? "The observation and rubric could not be saved."); return false; }
      setVisit(savedVisit); baseline.current = JSON.stringify([form, savedVisit]); clearNavigation();
      await onChanged("Observation details, rubric and evidence saved.");
      return true;
    } finally { setIsSaving(false); }
  }

  if (stage.stageType === "actions") {
    return <ProbationActions actions={actions.filter((action) => action.sourceRecordId === record.recordId && action.sourceSubRecordId === observation.id)} observation={observation} record={record} stage={stage} staff={staff} onChanged={onChanged} />;
  }

  return (
    <fieldset disabled={isSaving} style={{ display: "contents" }}><div className="form-stack probation-stage-form">
      <WorkflowFeedback message={message} />
      {stage.stageType === "professional_discussion" ? <div className="form-stack"><WorkflowNarrativeField content={content.field("contextText", "Context")} disabled={!stage.canEdit} onChange={value => setForm({ ...form, contextText: value })} rows={3} value={form.contextText ?? ""} /><WorkflowNarrativeField content={content.field("aimsText", "Aims and intended outcomes")} disabled={!stage.canEdit} onChange={value => setForm({ ...form, aimsText: value })} rows={3} value={form.aimsText ?? ""} /><WorkflowNarrativeField content={content.field("learnerActivityText", "Planned learner activity")} disabled={!stage.canEdit} onChange={value => setForm({ ...form, learnerActivityText: value })} rows={3} value={form.learnerActivityText ?? ""} /></div> : null}
      {stage.stageType === "visit_rubric" ? <ProbationVisitEditor configuration={configuration} disabled={!stage.canEdit} value={visit} onChange={setVisit} /> : null}
      {stage.stageType === "reflection_feedback" ? <div className="form-stack"><WorkflowNarrativeField content={content.field("reflectionText", "Reflection and feedback")} disabled={!stage.canEdit} onChange={value => setForm({ ...form, reflectionText: value })} rows={6} value={form.reflectionText ?? ""} /><fieldset className="checklist-field"><legend>Development opportunities</legend><div>{configuration.developmentOpportunities.map((option) => <label key={option.key}><input checked={form.developmentOpportunityKeys.includes(option.key)} disabled={!stage.canEdit} onChange={() => setForm({ ...form, developmentOpportunityKeys: toggleValue(form.developmentOpportunityKeys, option.key) })} type="checkbox" /><span>{option.name}</span></label>)}</div></fieldset></div> : null}
      {stage.stageType === "next_observation" ? <label className="entry-field"><span>Agreed date of next probationary observation</span><input disabled={!stage.canEdit} onChange={(event) => setForm({ ...form, intendedNextObservationDate: event.target.value })} type="date" value={form.intendedNextObservationDate ?? ""} /></label> : null}
      {stage.canEdit ? <div className="toolbar toolbar-end"><label className="compact-check"><input checked={(stage.stageType === "visit_rubric" ? visit.stageStatus : form.stageStatus) === "completed"} onChange={(event) => stage.stageType === "visit_rubric" ? setVisit({ ...visit, stageStatus: event.target.checked ? "completed" : "in_progress" }) : setForm({ ...form, stageStatus: event.target.checked ? "completed" : "in_progress" })} type="checkbox" /><span>Mark stage complete</span></label><Button disabled={isSaving} icon={Save} onClick={() => void (stage.stageType === "visit_rubric" ? saveVisit() : saveStage())} variant="primary">{isSaving ? "Saving..." : "Save stage"}</Button></div> : <p className="muted-copy">This record is visible but read-only for your current access.</p>}
    </div></fieldset>
  );
}

function ProbationVisitEditor({ configuration, disabled, value, onChange }: { configuration: ProbationConfiguration; disabled: boolean; value: SaveProbationVisitRequest; onChange: (value: SaveProbationVisitRequest) => void }) {
  const content = useFormContent("probation");
  const [retainedRatings, setRetainedRatings] = useState<Record<string, SaveProbationVisitRequest["ratings"][number]>>({});

  function selectRating(focusKey: string, descriptorId: string) {
    const existing = value.ratings.find((rating) => rating.focusKey === focusKey);
    onChange({ ...value, ratings: [...value.ratings.filter((rating) => rating.focusKey !== focusKey), { focusKey, descriptorId, evidenceOfPractice: existing?.evidenceOfPractice }] });
  }

  function updateEvidence(focusKey: string, evidenceOfPractice: string) {
    onChange({ ...value, ratings: value.ratings.map((rating) => rating.focusKey === focusKey ? { ...rating, evidenceOfPractice } : rating) });
  }

  function setObserved(focusKey: string, observed: boolean) {
    if (!observed) {
      const existing = value.ratings.find((rating) => rating.focusKey === focusKey);
      if (existing) setRetainedRatings((current) => ({ ...current, [focusKey]: existing }));
      onChange({
        ...value,
        unobservedFocusKeys: [...value.unobservedFocusKeys.filter((key) => key !== focusKey), focusKey],
        ratings: value.ratings.filter((rating) => rating.focusKey !== focusKey)
      });
      return;
    }

    const retained = retainedRatings[focusKey];
    onChange({
      ...value,
      unobservedFocusKeys: value.unobservedFocusKeys.filter((key) => key !== focusKey),
      ratings: retained
        ? [...value.ratings.filter((rating) => rating.focusKey !== focusKey), retained]
        : value.ratings
    });
    if (retained) {
      setRetainedRatings((current) => {
        const next = { ...current };
        delete next[focusKey];
        return next;
      });
    }
  }

  return (
    <div className="form-stack probation-visit-editor">
      <div className="form-grid form-grid-three">
        <label className="entry-field"><span>Delivery area</span><select disabled={disabled} onChange={(event) => onChange({ ...value, deliveryAreaKey: event.target.value })} value={value.deliveryAreaKey ?? ""}><option value="">Select delivery area</option>{configuration.deliveryAreas.map((option) => <option key={option.key} value={option.key}>{option.name}</option>)}</select></label>
        <label className="entry-field"><span>Observation date</span><input disabled={disabled} onChange={(event) => onChange({ ...value, observationDate: event.target.value })} type="date" value={value.observationDate ?? ""} /></label>
        <label className="entry-field"><span>Observation time</span><input disabled={disabled} onChange={(event) => onChange({ ...value, observationTime: event.target.value })} type="time" value={value.observationTime ?? ""} /></label>
        <label className="entry-field"><span>Course name</span><input disabled={disabled} onChange={(event) => onChange({ ...value, courseName: event.target.value })} value={value.courseName ?? ""} /></label>
        <label className="entry-field"><span>Course group</span><input disabled={disabled} onChange={(event) => onChange({ ...value, courseGroup: event.target.value })} value={value.courseGroup ?? ""} /></label>
        <label className="entry-field"><span>Course level</span><input disabled={disabled} onChange={(event) => onChange({ ...value, courseLevel: event.target.value })} value={value.courseLevel ?? ""} /></label>
      </div>
      <WorkflowNarrativeField content={content.field("keyPoints", "Key points")} disabled={disabled} onChange={nextValue => onChange({ ...value, keyPoints: nextValue })} rows={5} value={value.keyPoints ?? ""} />
      <section className="probation-rubric">
        <div className="panel-heading">
          <div>
            <h3>Practice rubric</h3>
            <span>Turn off areas that were not observed. Select one wording judgement for each observed area.</span>
          </div>
        </div>
        {configuration.focusAreas.map((focus) => {
          const selected = value.ratings.find((rating) => rating.focusKey === focus.key);
          const observed = !value.unobservedFocusKeys.includes(focus.key);
          return (
            <fieldset className={observed ? "" : "is-not-observed"} key={focus.key}>
              <legend className="probation-rubric-area-heading">
                <span>{focus.name}</span>
                <label className="probation-observed-toggle">
                  <input
                    aria-label={`${focus.name} observed`}
                    checked={observed}
                    disabled={disabled}
                    onChange={(event) => setObserved(focus.key, event.target.checked)}
                    type="checkbox"
                  />
                  <span>{observed ? "Observed" : "Not observed"}</span>
                </label>
              </legend>
              {observed ? (
                <>
                  <div className="probation-rubric-options">
                    {configuration.rubric.map((descriptor) => (
                      <button aria-pressed={selected?.descriptorId === descriptor.id} className={selected?.descriptorId === descriptor.id ? "is-selected" : ""} disabled={disabled} key={descriptor.id} onClick={() => selectRating(focus.key, descriptor.id)} title={descriptor.meaning} type="button">
                        <i style={{ background: descriptor.colorHex }} />
                        <span>{descriptor.descriptor}</span>
                      </button>
                    ))}
                  </div>
                  {selected ? (
                    <details className="probation-evidence-disclosure">
                      <summary>{content.field("evidenceOfPractice", "Evidence of practice").label} <small>Optional</small><ChevronDown size={16} /></summary>
                      <textarea aria-describedby={content.field("evidenceOfPractice", "Evidence of practice").helpText ? `probation-evidence-${focus.key}-help` : undefined} aria-label={`${content.field("evidenceOfPractice", "Evidence of practice").label} for ${focus.name}`} disabled={disabled} onChange={(event) => updateEvidence(focus.key, event.target.value)} placeholder="Add the evidence observed for this area" rows={3} value={selected.evidenceOfPractice ?? ""} />
                      {content.field("evidenceOfPractice", "Evidence of practice").helpText ? <small id={`probation-evidence-${focus.key}-help`}>{content.field("evidenceOfPractice", "Evidence of practice").helpText}</small> : null}
                    </details>
                  ) : null}
                </>
              ) : <p className="probation-not-observed-copy">No practice judgement is required for this area.</p>}
            </fieldset>
          );
        })}
      </section>
    </div>
  );
}

function ProbationActions({ record, observation, stage, actions, staff, onChanged }: { record: ProbationCase; observation: ProbationObservation; stage: ProbationStage; actions: ActionSummary[]; staff: StaffSummary[]; onChanged: (message: string) => Promise<void> }) {
  const { owners: ownerOptions, loading: ownersLoading, error: ownersError, retry: retryOwners } = useActionOwners(record.recordId, record.subjectStaffId);
  const [isAdding, setIsAdding] = useState(false);
  const [actionTheme, setActionTheme] = useState("");
  const [title, setTitle] = useState("");
  const [ownerId, setOwnerId] = useState(record.subjectStaffId);
  const [dueDate, setDueDate] = useState("");
  const [stageComplete, setStageComplete] = useState(stage.stageStatus === "completed");
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const saving = useRef(false);
  const savedStageComplete = useRef(stage.stageStatus === "completed");
  const stageDirty = stageComplete !== savedStageComplete.current;
  const hasActionDraft = isAdding && Boolean(actionTheme || title || dueDate || ownerId !== record.subjectStaffId);
  useEffect(() => {
    const complete = stage.stageStatus === "completed";
    const previous = savedStageComplete.current;
    setStageComplete(current => current === previous ? complete : current);
    savedStageComplete.current = complete;
  }, [stage.stageStatus]);
  const clearActionNavigation = useUnsavedChanges({ label: "New probation action", saving: isSaving,
    dirty: hasActionDraft, submission: true, onSubmit: stage.canEdit ? () => saveActions(false) : undefined, submitLabel: "Create action",
    onDiscard: resetDraft });
  const clearNavigation = useUnsavedChanges({ label: "Probation actions stage", saving: isSaving,
    dirty: stageDirty, onSave: () => saveActions(true, false),
    onDiscard: () => setStageComplete(savedStageComplete.current) });
  const permittedOwnerStaff = useMemo(() => {
    const permittedIds = new Set(ownerOptions.map((option) => option.staffId));
    return staff.filter((staffMember) => permittedIds.has(staffMember.id));
  }, [ownerOptions, staff]);
  function resetDraft() {
    setActionTheme(""); setTitle(""); setDueDate(""); setOwnerId(record.subjectStaffId); setIsAdding(false);
  }

  async function saveActions(includeStage: boolean, includeAction = true): Promise<boolean> {
    if (saving.current || !stage.canEdit) return false;
    const draft = includeAction && (!includeStage || hasActionDraft) ? { actionTheme, title, ownerStaffId: ownerId, dueDate } : undefined;
    if (draft && (ownersLoading || ownersError || !ownerOptions.some(owner => owner.staffId === ownerId))) {
      setMessage(ownersError || (ownersLoading ? "Wait for action owners to finish loading." : "Select an authorised action owner."));
      return false;
    }
    saving.current = true;
    setIsSaving(true); setMessage("");
    let actionCreated = false;
    try {
      const result = await saveProbationActions(draft, {
        createAction: value => api.createAction({ ...value, sourceRecordId: record.recordId, sourceFormType: "probation_observation", sourceSubRecordType: "probation_observation", sourceSubRecordId: observation.id, sourceSubRecordKey: `observation_${observation.observationNumber}`, subjectStaffId: record.subjectStaffId, publishedToStaff: true, visibilitySetting: "staff_and_management" }),
        actionSaved: () => { actionCreated = true; resetDraft(); clearActionNavigation(); },
        saveStage: includeStage ? async () => {
          const saved = await api.updateProbationStage(record.id, observation.id, stage.id, { developmentOpportunityKeys: [], stageStatus: stageComplete ? "completed" : "in_progress" });
          if (saved.ok) savedStageComplete.current = stageComplete;
          return saved;
        } : undefined
      });
      if (result.ok && (includeStage || !stageDirty)) clearNavigation();
      if (!result.ok) setMessage(result.message ?? "The actions could not be saved. Your changes are still here.");
      if (result.ok || actionCreated) await onChanged(result.ok && includeStage ? "Actions stage saved." : "Probation action created.");
      return result.ok;
    } finally { saving.current = false; setIsSaving(false); }
  }
  return (
    <fieldset disabled={isSaving} style={{ display: "contents" }}><div className="probation-actions">
      {message ? <p role="alert">{message}</p> : null}
      {ownersLoading ? <LoadingState label="Loading action owners…" size="inline" /> : ownersError ? <div role="alert">{ownersError}<Button onClick={() => void retryOwners()}>Retry action owners</Button></div> : null}
      <div className="liv-actions-heading">
        <div><h3>Observation actions</h3><span>{actions.length} linked to Observation {observation.observationNumber}</span></div>
        {stage.canEdit ? <Button icon={Plus} onClick={() => setIsAdding(true)} variant="primary">Add action</Button> : null}
      </div>
      {isAdding ? <div className="liv-action-editor">
        <label className="entry-field"><span>Action theme <strong>Required</strong></span><ActionThemeSelect id={`probation-action-theme-${observation.id}`} onChange={setActionTheme} sourceFormType="probation_observation" value={actionTheme} /></label>
        <label className="entry-field"><span>Action <strong>Required</strong></span><textarea maxLength={300} onChange={(event) => setTitle(event.target.value)} rows={3} value={title} /></label>
        <div className="form-grid form-grid-two">
          <div className="entry-field"><label htmlFor={`probation-action-owner-${observation.id}`}>Owner <strong>Required</strong></label><StaffSearchSelect helperText="Type to find an authorised action owner." id={`probation-action-owner-${observation.id}`} onChange={setOwnerId} staff={permittedOwnerStaff} value={ownerId} /></div>
          <label className="entry-field"><span>Date to be implemented by <strong>Required</strong></span><input onChange={(event) => setDueDate(event.target.value)} type="date" value={dueDate} /></label>
        </div>
        <div className="toolbar toolbar-end">
          <Button icon={X} onClick={() => void confirmUnsavedNavigation().then(leave => { if (leave) resetDraft(); })}>Cancel</Button>
          <Button disabled={isSaving || ownersLoading || Boolean(ownersError) || !actionTheme.trim() || !title.trim() || !ownerOptions.some(owner => owner.staffId === ownerId) || !dueDate} icon={Save} onClick={() => void saveActions(false)} variant="primary">Create action</Button>
        </div>
      </div> : null}
      <div className="probation-action-list">
        {actions.length === 0 ? <p className="muted-copy">No actions have been added.</p> : actions.map((action) => <div key={action.id}>
          <span className={`status-pill ${dashboardActionState(action) === "complete" ? "status-complete" : "status-draft"}`}>{dashboardActionState(action) === "cancelled" ? "Cancelled" : dashboardActionState(action) === "complete" ? "Completed" : dashboardActionState(action) === "overdue" ? "Overdue" : action.statusKey === "extended" ? "Extended" : "Open"}</span>
          <div><strong>{action.title}</strong><span>{action.actionTheme} / {action.ownerStaffName ?? "Unassigned"} / {formatDate(action.dueDate)}</span></div>
        </div>)}
      </div>
      {stage.canEdit ? <div className="toolbar toolbar-end">
        <label className="compact-check"><input checked={stageComplete} onChange={(event) => setStageComplete(event.target.checked)} type="checkbox" /><span>Mark stage complete</span></label>
        <Button disabled={isSaving} icon={Save} onClick={() => void saveActions(true)} variant="primary">{isSaving ? "Saving..." : "Save stage"}</Button>
      </div> : null}
      {!ownersLoading && !ownersError && ownerOptions.length === 0 && staff.length > 0 ? <small className="muted-copy">No action owners are available within your scope.</small> : null}
    </div></fieldset>
  );
}

function ProbationEliContext({ context }: { context: ProbationStaffContext }) {
  return <details className="probation-eli-disclosure"><summary><span><strong>ELI information</strong><small>{context.assessmentId ? `${context.academicYear} report available` : "No submitted report"}</small></span><ChevronDown aria-hidden="true" size={18} /></summary><div className="probation-eli-context"><div><span>ELI report</span><strong>{context.assessmentId ? `${context.academicYear} submitted` : "No submitted report"}</strong></div><div><span>Primary focus</span><strong>{context.primaryFocus ?? "Not provided"}</strong></div><div><span>Secondary focus</span><strong>{context.secondaryFocus ?? "Not provided"}</strong></div><div><span>Desired outcome</span><strong>{context.desiredOutcome ?? "Not provided"}</strong></div>{context.hasProbationCaseForAcademicYear ? <p className="notice-row">This staff member already has a probationary observation cycle for the current academic year.</p> : null}</div></details>;
}

function stageToRequest(stage: ProbationStage): SaveProbationStageRequest {
  return { contextText: stage.contextText, aimsText: stage.aimsText, learnerActivityText: stage.learnerActivityText, reflectionText: stage.reflectionText, developmentOpportunityKeys: stage.developmentOpportunityKeys, intendedNextObservationDate: stage.intendedNextObservationDate, stageStatus: stage.stageStatus };
}
function visitToRequest(visit: ProbationVisit | undefined, stageStatus: ProbationStage["stageStatus"]): SaveProbationVisitRequest {
  return { deliveryAreaKey: visit?.deliveryAreaKey, observationDate: visit?.observationDate, observationTime: visit?.observationTime, courseName: visit?.courseName, courseGroup: visit?.courseGroup, courseLevel: visit?.courseLevel, keyPoints: visit?.keyPoints, unobservedFocusKeys: visit?.unobservedFocusKeys ?? [], ratings: visit?.ratings.map((rating) => ({ focusKey: rating.focusKey, descriptorId: rating.descriptorId, evidenceOfPractice: rating.evidenceOfPractice })) ?? [], stageStatus };
}
function highestCompletedObservation(record: ProbationCase) { return Math.max(0, ...record.observations.filter((item) => item.status === "completed").map((item) => item.observationNumber)); }
function toggleValue(values: string[], value: string) { return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]; }
function formatStatus(value: string) { return value.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase()); }
function formatDate(value?: string) { return value ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T00:00:00`)) : "No date"; }
