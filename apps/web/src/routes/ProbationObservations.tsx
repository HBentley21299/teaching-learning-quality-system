import { useEffect, useMemo, useState } from "react";
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
import { api } from "../services/api";
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
  const [recordOwnershipView, setRecordOwnershipView] = useState<"mine" | "scope">("mine");
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const hasProbationPermission = user.permissions.includes("probation.submit") || user.permissions.includes("probation.manage");
  const canCreate = hasProbationPermission && Boolean(configuration?.canCreateCase);
  const selectedCase = cases.find((item) => item.id === selectedCaseId) ?? null;

  function openCase(item: ProbationCase) {
    setSelectedCaseId(item.id);
    setSelectedObservationNumber(item.currentObservationNumber);
    onRecordOpened?.(item.recordId);
  }
  const faculties = orgUnits.filter((unit) => unit.orgUnitType === "faculty" && unit.isActive);
  const teams = orgUnits.filter((unit) => unit.orgUnitType === "team" && unit.isActive
    && (facultyFilter === "all" || unit.parentOrgUnitId === facultyFilter));

  async function refresh(nextMessage = "") {
    try {
      const [nextCases, nextConfiguration, nextLivRecords] = await Promise.all([
        api.probationCases(),
        api.probationConfiguration(),
        api.livRecords()
      ]);
      setCases(nextCases);
      setConfiguration(nextConfiguration);
      setLivConfiguration(nextConfiguration);
      setLivRecords(nextLivRecords);
      if (nextMessage) setMessage(nextMessage);
    } catch {
      setMessage("Probationary observations could not be loaded from the API.");
    }
  }

  useEffect(() => { void refresh(); }, []);
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
    setStaffContext(null);
    if (!subjectStaffId || !canCreate) return;
    api.probationStaffContext(subjectStaffId).then(setStaffContext).catch(() => setStaffContext(null));
  }, [canCreate, subjectStaffId]);

  const years = useMemo(() => [...new Set(cases.map((item) => item.academicYear))].sort().reverse(), [cases]);
  const filteredCases = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return cases.filter((item) => {
      const staffMember = staff.find((candidate) => candidate.id === item.subjectStaffId);
      const matchesSearch = !query || [item.subjectStaffName, item.orgUnitCode, item.parentOrgUnitCode, item.academicYear]
        .some((value) => value?.toLocaleLowerCase().includes(query));
      const matchesYear = yearFilter === "all" || item.academicYear === yearFilter;
      const matchesFaculty = facultyFilter === "all" || staffMember?.orgUnitIds.includes(facultyFilter)
        || item.orgUnitId === facultyFilter;
      const matchesTeam = teamFilter === "all" || staffMember?.orgUnitIds.includes(teamFilter)
        || item.orgUnitId === teamFilter;
      const matchesStatus = statusFilter === "all" || item.status === statusFilter;
      const matchesOwnership = recordOwnershipView === "scope" || item.isCreatedByCurrentUser;
      return matchesSearch && matchesYear && matchesFaculty && matchesTeam && matchesStatus && matchesOwnership;
    });
  }, [cases, facultyFilter, recordOwnershipView, search, staff, statusFilter, teamFilter, yearFilter]);

  const completionCounts = [1, 2, 3].map((number) => filteredCases.filter((item) => highestCompletedObservation(item) === number).length);

  async function createCase() {
    if (!subjectStaffId) return;
    setIsSaving(true);
    const staffMember = configuration?.eligibleStaff.find((item) => item.id === subjectStaffId);
    const result = await api.createProbationCase({
      subjectStaffId,
      teachingLearningReviewerStaffId: teachingLearningReviewerId || undefined,
      orgUnitId: staffMember?.primaryOrgUnitId
    });
    setIsSaving(false);
    if (!result.ok) {
      setMessage(result.message ?? "The probationary observation case could not be created.");
      return;
    }
    setIsCreating(false);
    setSubjectStaffId("");
    setTeachingLearningReviewerId("");
    setSelectedCaseId(result.data?.id ?? "");
    setSelectedObservationNumber(1);
    await refresh("Probationary observation case created.");
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
        onBack={() => { setSelectedCaseId(""); setSelectedLivCycleId(""); onRecordClosed?.(); }}
        onChanged={async (nextMessage) => { await onActionsChanged?.(); await refresh(nextMessage); }}
        onObservationChange={(number) => { setSelectedObservationNumber(number); setSelectedLivCycleId(""); }}
        onLivCycleChange={setSelectedLivCycleId}
        onOpenEliReport={onOpenEliReport}
        onOpenUcoTlaReview={onOpenUcoTlaReview}
      />
    );
  }

  return (
    <div className="route-stack probation-route">
      <div className="route-header">
        <div><p className="eyebrow">Staff probation observation process</p><h1>Probationary Observations</h1></div>
        {canCreate ? <Button icon={FilePlus2} onClick={() => setIsCreating((value) => !value)} variant="primary">Create probation case</Button> : null}
      </div>
      {message ? <div className="notice-row">{message}</div> : null}

      {isCreating && configuration ? (
        <section className="panel probation-create-panel">
          <div className="panel-heading"><div><h2>New probationary observation cycle</h2><span>Select a staff member within your permitted area. You will be assigned as lead reviewer automatically.</span></div><button className="icon-button" onClick={() => setIsCreating(false)} title="Close" type="button"><X size={16} /></button></div>
          <div className="form-grid form-grid-three">
            <label className="entry-field"><span>Staff member</span><StaffSearchSelect helperText="Search the staff available within your team, faculty or organisation scope." id="probation-subject" onChange={setSubjectStaffId} staff={configuration.eligibleStaff} value={subjectStaffId} /></label>
            <label className="entry-field"><span>Teaching and Learning reviewer <small>Optional</small></span><select onChange={(event) => setTeachingLearningReviewerId(event.target.value)} value={teachingLearningReviewerId}><option value="">No T&L reviewer</option>{configuration.teachingLearningReviewers.map((reviewer) => <option disabled={reviewer.staffId === user.staffId} key={reviewer.staffId} value={reviewer.staffId}>{reviewer.displayName}</option>)}</select></label>
            <div className="entry-field"><span>Lead reviewer</span><div className="probation-auto-reviewer"><strong>{user.displayName}</strong><small>Assigned from your signed-in account</small></div></div>
          </div>
          {staffContext ? <ProbationEliContext context={staffContext} /> : null}
          <div className="toolbar toolbar-end"><Button icon={X} onClick={() => setIsCreating(false)}>Cancel</Button><Button disabled={isSaving || !subjectStaffId || Boolean(staffContext?.hasProbationCaseForAcademicYear)} icon={Plus} onClick={() => void createCase()} variant="primary">{isSaving ? "Creating..." : "Create cycle"}</Button></div>
        </section>
      ) : null}

      <KpiStrip items={[
        { label: "Completed Observation 1", value: completionCounts[0], tone: "blue" },
        { label: "Completed Observation 2", value: completionCounts[1], tone: "amber" },
        { label: "Completed Observation 3", value: completionCounts[2], tone: "green" }
      ]} />

      <details className="panel liv-v2-records">
        <summary><span><strong>{recordOwnershipView === "mine" ? "My probationary observation records" : "Probationary observation records in scope"}</strong><small>{filteredCases.length} records in this view</small></span><span className="toolbar">{user.permissions.includes("exports.create") ? <ExportExcelButton filters={{ academicYear: yearFilter === "all" ? undefined : yearFilter }} moduleKey="probation" orgUnits={orgUnits} /> : null}<ChevronDown size={18} /></span></summary>
        <div className="segmented-control record-ownership-switch" aria-label="Probation record ownership view"><button className={recordOwnershipView === "mine" ? "is-active" : ""} onClick={() => setRecordOwnershipView("mine")} type="button">My probation records</button><button className={recordOwnershipView === "scope" ? "is-active" : ""} onClick={() => setRecordOwnershipView("scope")} type="button">All in my scope</button></div>
        <div className="filter-toolbar probation-filter-toolbar">
          <label className="search-box"><Search size={16} /><input onChange={(event) => setSearch(event.target.value)} placeholder="Search staff or area" value={search} /></label>
          <label><span>Academic year</span><select onChange={(event) => setYearFilter(event.target.value)} value={yearFilter}><option value="all">All years</option>{years.map((year) => <option key={year}>{year}</option>)}</select></label>
          <label><span>Faculty</span><select onChange={(event) => { setFacultyFilter(event.target.value); setTeamFilter("all"); }} value={facultyFilter}><option value="all">All faculties</option>{faculties.map((unit) => <option key={unit.id} value={unit.id}>{unit.code} - {unit.name}</option>)}</select></label>
          <label><span>Team</span><select onChange={(event) => setTeamFilter(event.target.value)} value={teamFilter}><option value="all">All teams</option>{teams.map((unit) => <option key={unit.id} value={unit.id}>{unit.code} - {unit.name}</option>)}</select></label>
          <label><span>Status</span><select onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}><option value="all">All statuses</option><option value="in_progress">In progress</option><option value="completed">Completed</option></select></label>
        </div>
        <div className="table-shell"><table><thead><tr><th>Staff member</th><th>Faculty / team</th><th>Academic year</th><th>Progress</th><th>Reviewers</th><th>Open</th></tr></thead><tbody>
          {filteredCases.length === 0 ? <tr><td colSpan={6}>{recordOwnershipView === "mine" ? "You have not created any probation records matching these filters." : "No probation records match these filters."}</td></tr> : filteredCases.map((item) => <tr key={item.id}><td><strong>{item.subjectStaffName}</strong></td><td>{[item.parentOrgUnitCode, item.orgUnitCode].filter(Boolean).join(" / ") || "Unassigned"}</td><td>{item.academicYear}</td><td><span className={`status-pill ${item.status === "completed" ? "status-complete" : "status-draft"}`}>{item.status === "completed" ? "Observation 3 complete" : `Observation ${item.currentObservationNumber}`}</span></td><td>{item.reviewers.map((reviewer) => reviewer.displayName).join(" and ")}</td><td><button className="icon-button" onClick={() => openCase(item)} title="Open probation case" type="button"><Eye size={16} /></button></td></tr>)}
        </tbody></table></div>
      </details>
    </div>
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
    const result = await api.startProbationLiv(record.id);
    setIsSaving(false);
    if (!result.ok) {
      setMessage(result.message ?? "Observation 2 could not be started.");
      return;
    }
    await onChanged("Observation 2 LIV created and linked to both records.");
  }

  async function completeObservation() {
    if (!observation || !window.confirm(`Complete Probation Observation ${observation.observationNumber}?`)) return;
    setIsSaving(true);
    const result = await api.completeProbationObservation(record.id, observation.id);
    setIsSaving(false);
    if (!result.ok) {
      setMessage(result.message ?? "The observation could not be completed.");
      return;
    }
    await onChanged(observation.observationNumber === 1 ? "Observation 1 completed. Observation 2 is ready." : "Probationary observation cycle completed.");
    onObservationChange(observation.observationNumber === 1 ? 2 : 3);
  }

  return (
    <div className="route-stack probation-workspace">
      <div className="route-header probation-case-header">
        <div><Button icon={ArrowLeft} onClick={onBack}>Back to probation records</Button><p className="eyebrow">{record.academicYear} probation cycle</p><h1>{record.subjectStaffName}</h1></div>
        <div className="toolbar"><ExportWordButton recordId={record.recordId} /><Button disabled={!record.sourceElevateRecordId} icon={ClipboardCheck} onClick={() => record.sourceElevateRecordId && onOpenEliReport(record.subjectStaffId, record.sourceElevateRecordId)} variant="primary">{record.sourceElevateRecordId ? "Open ELI report" : "No submitted ELI report"}</Button></div>
      </div>
      {message ? <div className="notice-row">{message}</div> : null}
      <section className="panel probation-case-summary">
        <div><span>Teaching and Learning reviewer</span><strong>{record.reviewers.find((reviewer) => reviewer.reviewerRole === "teaching_learning")?.displayName ?? "Not assigned"}</strong></div>
        <div><span>Leader reviewer</span><strong>{record.reviewers.find((reviewer) => reviewer.reviewerRole === "leader")?.displayName ?? "Not assigned"}</strong></div>
        <div><span>Faculty / team</span><strong>{[record.parentOrgUnitCode, record.orgUnitCode].filter(Boolean).join(" / ") || "Unassigned"}</strong></div>
        <div><span>Cycle status</span><strong>{record.status === "completed" ? "Completed" : "In progress"}</strong></div>
      </section>
      <div className="probation-observation-switcher" aria-label="Probation observation progress">
        {record.observations.map((item) => {
          const available = item.status !== "not_started" || item.observationNumber === record.currentObservationNumber;
          return <button className={item.observationNumber === observation.observationNumber ? "is-active" : ""} disabled={!available} key={item.id} onClick={() => onObservationChange(item.observationNumber)} type="button"><span>{item.status === "completed" ? <CheckCircle2 size={18} /> : item.observationNumber}</span><strong>Observation {item.observationNumber}</strong><small>{item.observationNumber === 2 ? (item.observationType === "uco_tla" ? "UCO TLA" : "LIV") : "Probation template"} / {formatStatus(item.status)}</small></button>;
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

  useEffect(() => { setForm(stageToRequest(stage)); setVisit(visitToRequest(observation.visit, stage.stageStatus)); }, [observation.visit, stage]);

  async function saveStage() {
    setIsSaving(true);
    const result = await api.updateProbationStage(record.id, observation.id, stage.id, form);
    setIsSaving(false);
    if (!result.ok) { setMessage(result.message ?? "The stage could not be saved."); return; }
    await onChanged("Probation observation stage saved.");
  }

  async function saveVisit() {
    setIsSaving(true);
    const result = await api.updateProbationVisit(record.id, observation.id, visit);
    setIsSaving(false);
    if (!result.ok) { setMessage(result.message ?? "The observation and rubric could not be saved."); return; }
    await onChanged("Observation details, rubric and evidence saved.");
  }

  if (stage.stageType === "actions") {
    return <ProbationActions actions={actions.filter((action) => action.sourceRecordId === record.recordId && action.sourceSubRecordId === observation.id)} observation={observation} record={record} stage={stage} staff={staff} onChanged={onChanged} />;
  }

  return (
    <div className="form-stack probation-stage-form">
      {message ? <div className="notice-row">{message}</div> : null}
      {stage.stageType === "professional_discussion" ? <div className="form-stack"><label className="entry-field"><span>Context</span><textarea disabled={!stage.canEdit} onChange={(event) => setForm({ ...form, contextText: event.target.value })} rows={3} value={form.contextText ?? ""} /></label><label className="entry-field"><span>Aims and intended outcomes</span><textarea disabled={!stage.canEdit} onChange={(event) => setForm({ ...form, aimsText: event.target.value })} rows={3} value={form.aimsText ?? ""} /></label><label className="entry-field"><span>Planned learner activity</span><textarea disabled={!stage.canEdit} onChange={(event) => setForm({ ...form, learnerActivityText: event.target.value })} rows={3} value={form.learnerActivityText ?? ""} /></label></div> : null}
      {stage.stageType === "visit_rubric" ? <ProbationVisitEditor configuration={configuration} disabled={!stage.canEdit} value={visit} onChange={setVisit} /> : null}
      {stage.stageType === "reflection_feedback" ? <div className="form-stack"><label className="entry-field"><span>Reflection and feedback</span><textarea disabled={!stage.canEdit} onChange={(event) => setForm({ ...form, reflectionText: event.target.value })} rows={6} value={form.reflectionText ?? ""} /></label><fieldset className="checklist-field"><legend>Development opportunities</legend><div>{configuration.developmentOpportunities.map((option) => <label key={option.key}><input checked={form.developmentOpportunityKeys.includes(option.key)} disabled={!stage.canEdit} onChange={() => setForm({ ...form, developmentOpportunityKeys: toggleValue(form.developmentOpportunityKeys, option.key) })} type="checkbox" /><span>{option.name}</span></label>)}</div></fieldset></div> : null}
      {stage.stageType === "next_observation" ? <label className="entry-field"><span>Agreed date of next probationary observation</span><input disabled={!stage.canEdit} onChange={(event) => setForm({ ...form, intendedNextObservationDate: event.target.value })} type="date" value={form.intendedNextObservationDate ?? ""} /></label> : null}
      {stage.canEdit ? <div className="toolbar toolbar-end"><label className="compact-check"><input checked={(stage.stageType === "visit_rubric" ? visit.stageStatus : form.stageStatus) === "completed"} onChange={(event) => stage.stageType === "visit_rubric" ? setVisit({ ...visit, stageStatus: event.target.checked ? "completed" : "in_progress" }) : setForm({ ...form, stageStatus: event.target.checked ? "completed" : "in_progress" })} type="checkbox" /><span>Mark stage complete</span></label><Button disabled={isSaving} icon={Save} onClick={() => void (stage.stageType === "visit_rubric" ? saveVisit() : saveStage())} variant="primary">{isSaving ? "Saving..." : "Save stage"}</Button></div> : <p className="muted-copy">This record is visible but read-only for your current access.</p>}
    </div>
  );
}

function ProbationVisitEditor({ configuration, disabled, value, onChange }: { configuration: ProbationConfiguration; disabled: boolean; value: SaveProbationVisitRequest; onChange: (value: SaveProbationVisitRequest) => void }) {
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
      <label className="entry-field"><span>Key points</span><textarea disabled={disabled} onChange={(event) => onChange({ ...value, keyPoints: event.target.value })} rows={5} value={value.keyPoints ?? ""} /></label>
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
                      <button className={selected?.descriptorId === descriptor.id ? "is-selected" : ""} disabled={disabled} key={descriptor.id} onClick={() => selectRating(focus.key, descriptor.id)} title={descriptor.meaning} type="button">
                        <i style={{ background: descriptor.colorHex }} />
                        <span>{descriptor.descriptor}</span>
                      </button>
                    ))}
                  </div>
                  {selected ? (
                    <details className="probation-evidence-disclosure">
                      <summary>Evidence of practice <small>Optional</small><ChevronDown size={16} /></summary>
                      <textarea disabled={disabled} onChange={(event) => updateEvidence(focus.key, event.target.value)} placeholder="Add the evidence observed for this area" rows={3} value={selected.evidenceOfPractice ?? ""} />
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
  const [ownerOptions, setOwnerOptions] = useState<ActionOwnerOption[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [actionTheme, setActionTheme] = useState("");
  const [title, setTitle] = useState("");
  const [ownerId, setOwnerId] = useState(record.subjectStaffId);
  const [dueDate, setDueDate] = useState("");
  const [stageComplete, setStageComplete] = useState(stage.stageStatus === "completed");
  const [isSaving, setIsSaving] = useState(false);
  const permittedOwnerStaff = useMemo(() => {
    const permittedIds = new Set(ownerOptions.map((option) => option.staffId));
    return staff.filter((staffMember) => permittedIds.has(staffMember.id));
  }, [ownerOptions, staff]);
  useEffect(() => { api.actionOwnerOptions(record.recordId, record.subjectStaffId).then(setOwnerOptions).catch(() => setOwnerOptions([])); }, [record.recordId, record.subjectStaffId]);
  async function addAction() {
    if (!actionTheme.trim() || !title.trim() || !ownerId || !dueDate) return;
    setIsSaving(true);
    const result = await api.createAction({ sourceRecordId: record.recordId, sourceFormType: "probation_observation", sourceSubRecordType: "probation_observation", sourceSubRecordId: observation.id, sourceSubRecordKey: `observation_${observation.observationNumber}`, subjectStaffId: record.subjectStaffId, ownerStaffId: ownerId, actionTheme: actionTheme.trim(), title: title.trim(), dueDate, publishedToStaff: true, visibilitySetting: "staff_and_management" });
    setIsSaving(false);
    if (!result.ok) return;
    setActionTheme(""); setTitle(""); setDueDate(""); setOwnerId(record.subjectStaffId); setIsAdding(false);
    await onChanged("Probation action added to the central Action Engine.");
  }
  async function saveStage() {
    setIsSaving(true);
    const result = await api.updateProbationStage(record.id, observation.id, stage.id, { developmentOpportunityKeys: [], stageStatus: stageComplete ? "completed" : "in_progress" });
    setIsSaving(false);
    if (result.ok) await onChanged("Actions stage saved.");
  }
  return <div className="probation-actions"><div className="liv-actions-heading"><div><h3>Observation actions</h3><span>{actions.length} linked to Observation {observation.observationNumber}</span></div>{stage.canEdit ? <Button icon={Plus} onClick={() => setIsAdding((value) => !value)} variant="primary">Add action</Button> : null}</div>{isAdding ? <div className="liv-action-editor"><label className="entry-field"><span>Action theme <strong>Required</strong></span><ActionThemeSelect id={`probation-action-theme-${observation.id}`} onChange={setActionTheme} sourceFormType="probation_observation" value={actionTheme} /></label><label className="entry-field"><span>Action <strong>Required</strong></span><textarea maxLength={300} onChange={(event) => setTitle(event.target.value)} rows={3} value={title} /></label><div className="form-grid form-grid-two"><div className="entry-field"><span>Owner <strong>Required</strong></span><StaffSearchSelect helperText="Type to find an authorised action owner." id={`probation-action-owner-${observation.id}`} onChange={setOwnerId} staff={permittedOwnerStaff} value={ownerId} /></div><label className="entry-field"><span>Date to be implemented by <strong>Required</strong></span><input onChange={(event) => setDueDate(event.target.value)} type="date" value={dueDate} /></label></div><div className="toolbar toolbar-end"><Button icon={X} onClick={() => setIsAdding(false)}>Cancel</Button><Button disabled={isSaving || !actionTheme.trim() || !title.trim() || !ownerId || !dueDate} icon={Save} onClick={() => void addAction()} variant="primary">Create action</Button></div></div> : null}<div className="probation-action-list">{actions.length === 0 ? <p className="muted-copy">No actions have been added.</p> : actions.map((action) => <div key={action.id}><span className={`status-pill ${action.completedDate ? "status-complete" : "status-draft"}`}>{action.completedDate ? "Completed" : action.isOverdue ? "Overdue" : "Open"}</span><div><strong>{action.title}</strong><span>{action.actionTheme} / {action.ownerStaffName ?? "Unassigned"} / {formatDate(action.dueDate)}</span></div></div>)}</div>{stage.canEdit ? <div className="toolbar toolbar-end"><label className="compact-check"><input checked={stageComplete} onChange={(event) => setStageComplete(event.target.checked)} type="checkbox" /><span>Mark stage complete</span></label><Button disabled={isSaving} icon={Save} onClick={() => void saveStage()} variant="primary">Save stage</Button></div> : null}{ownerOptions.length === 0 && staff.length > 0 ? <small className="muted-copy">No action owners are available within your scope.</small> : null}</div>;
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
