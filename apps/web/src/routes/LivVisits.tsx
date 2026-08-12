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
import { ExportExcelButton, ExportWordButton } from "../components/ExportButtons";
import { KpiStrip } from "../components/KpiStrip";
import { StaffSearchSelect } from "../components/StaffSearchSelect";
import { ActionThemeSelect } from "../components/ActionThemeSelect";
import { api } from "../services/api";
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
  staff: StaffSummary[];
  orgUnits: OrgUnitSummary[];
  user: CurrentUser;
  onActionsChanged?: () => Promise<void>;
  onOpenStaffProfile?: (staffId: string) => void;
  initialSourceRecordId?: string;
  onRecordOpened?: (recordId: string) => void;
  onRecordClosed?: () => void;
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
  staff,
  orgUnits,
  user,
  onActionsChanged,
  onOpenStaffProfile,
  initialSourceRecordId = "",
  onRecordOpened,
  onRecordClosed
}: LivVisitsProps) {
  const [records, setRecords] = useState<LivRecordSummary[]>([]);
  const [configuration, setConfiguration] = useState<LivConfiguration | null>(null);
  const [practitionerThemeGroups, setPractitionerThemeGroups] = useState<SharedThemeGroup[]>([]);
  const [actions, setActions] = useState<ActionSummary[]>([]);
  const [selectedRecordId, setSelectedRecordId] = useState("");
  const [selectedCycleId, setSelectedCycleId] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [staffContext, setStaffContext] = useState<LivStaffContext | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [recordSearch, setRecordSearch] = useState("");
  const [recordStatus, setRecordStatus] = useState("all");
  const [recordOwnershipView, setRecordOwnershipView] = useState<"mine" | "scope">("mine");
  const [coverageSearch, setCoverageSearch] = useState("");
  const [coverageFaculty, setCoverageFaculty] = useState("all");
  const [coverageStatus, setCoverageStatus] = useState<"all" | CoverageStatus>("all");
  const openedInitialRecord = useRef("");

  const canCreate = user.permissions.includes("liv.submit") || user.permissions.includes("liv.manage");
  const selectedRecord = records.find((record) => record.id === selectedRecordId) ?? null;

  function openRecord(record: LivRecordSummary) {
    setSelectedRecordId(record.id);
    onRecordOpened?.(record.recordId);
  }

  async function refreshData(nextMessage = "") {
    const [recordsResult, actionsResult, configurationResult, practitionerThemesResult] = await Promise.allSettled([
      api.livRecords(),
      api.actions(),
      api.livConfiguration(),
      api.sharedThemes("liv")
    ]);

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
  }

  useEffect(() => { void refreshData(); }, []);

  useEffect(() => {
    if (!initialSourceRecordId || !records.length || openedInitialRecord.current === initialSourceRecordId) return;
    openedInitialRecord.current = initialSourceRecordId;
    const record = records.find((candidate) => candidate.recordId === initialSourceRecordId);
    if (record) openRecord(record);
    else setStatusMessage("The LIV source record is outside your permitted scope.");
  }, [initialSourceRecordId, records]);

  useEffect(() => {
    if (!selectedStaffId) {
      setStaffContext(null);
      return;
    }
    api.livStaffContext(selectedStaffId)
      .then(setStaffContext)
      .catch(() => setStatusMessage("Elevate Learning and Innovation information could not be loaded for this staff member."));
  }, [selectedStaffId]);

  useEffect(() => {
    if (!selectedRecord) return;
    const current = selectedRecord.cycles.find((cycle) => cycle.status === "in_progress") ?? selectedRecord.cycles.at(-1);
    if (current && !selectedRecord.cycles.some((cycle) => cycle.id === selectedCycleId)) setSelectedCycleId(current.id);
  }, [selectedCycleId, selectedRecord]);

  const faculties = useMemo(() => orgUnits.filter((unit) => unit.orgUnitType === "faculty" && unit.isActive).sort((a, b) => a.name.localeCompare(b.name)), [orgUnits]);
  const unitById = useMemo(() => new Map(orgUnits.map((unit) => [unit.id, unit])), [orgUnits]);
  const recordByStaff = useMemo(() => new Map(records.map((record) => [record.subjectStaffId, record])), [records]);
  const coverageRows = useMemo(() => staff.map((staffMember) => {
    const units = staffMember.orgUnitIds.map((id) => unitById.get(id)).filter((unit): unit is OrgUnitSummary => Boolean(unit));
    const teams = units.filter((unit) => unit.orgUnitType === "team");
    const facultyIds = new Set([...units.filter((unit) => unit.orgUnitType === "faculty").map((unit) => unit.id), ...teams.map((team) => team.parentOrgUnitId).filter(Boolean) as string[]]);
    const staffFaculties = faculties.filter((faculty) => facultyIds.has(faculty.id));
    const record = recordByStaff.get(staffMember.id);
    const status: CoverageStatus = !record ? "not_started" : record.cycles.some((cycle) => cycle.status === "completed") ? "completed" : "in_progress";
    return { staff: staffMember, faculties: staffFaculties, teams, record, status };
  }), [faculties, recordByStaff, staff, unitById]);
  const filteredCoverage = useMemo(() => {
    const query = coverageSearch.trim().toLowerCase();
    return coverageRows.filter((row) =>
      (coverageFaculty === "all" || row.faculties.some((faculty) => faculty.id === coverageFaculty))
      && (coverageStatus === "all" || row.status === coverageStatus)
      && (!query || `${row.staff.displayName} ${row.staff.externalId} ${row.teams.map((team) => team.code).join(" ")}`.toLowerCase().includes(query))
    );
  }, [coverageFaculty, coverageRows, coverageSearch, coverageStatus]);

  const visibleRecords = useMemo(() => {
    const query = recordSearch.trim().toLowerCase();
    return records.filter((record) =>
      (recordStatus === "all" || record.status === recordStatus)
      && (!query || `${record.subjectStaffName} ${record.parentOrgUnitCode ?? ""} ${record.orgUnitCode ?? ""} ${latestVisit(record)?.deliveryAreaName ?? ""}`.toLowerCase().includes(query))
    );
  }, [recordSearch, recordStatus, records]);
  const displayedRecords = useMemo(() => recordOwnershipView === "mine"
    ? visibleRecords.filter((record) => record.isCreatedByCurrentUser)
    : visibleRecords, [recordOwnershipView, visibleRecords]);

  async function createCase() {
    if (!selectedStaffId) {
      setStatusMessage("Select a staff member.");
      return;
    }
    setIsSaving(true);
    const request: SaveLivRecordRequest = {
      subjectStaffId: selectedStaffId,
      areaOfPracticeKeys: [],
      areaOfPracticeThemeIds: []
    };
    const result = await api.createLivRecord(request);
    setIsSaving(false);
    if (!result.ok) {
      setStatusMessage(result.message ?? "The LIV case could not be created.");
      return;
    }
    setIsCreating(false);
    setSelectedStaffId("");
    await refreshData("LIV case created. The staff member can now view the in-progress record.");
  }

  if (selectedRecord && configuration) {
    return (
      <LivCaseWorkspace
        actions={actions.filter((action) => action.sourceRecordId === selectedRecord.recordId)}
        configuration={configuration}
        cycleId={selectedCycleId}
        onBack={() => { setSelectedRecordId(""); setSelectedCycleId(""); onRecordClosed?.(); }}
        onChanged={async (message) => { await refreshData(message); await onActionsChanged?.(); }}
        onCycleChange={setSelectedCycleId}
        onOpenStaffProfile={onOpenStaffProfile}
        record={selectedRecord}
        practitionerThemeGroups={practitionerThemeGroups}
        staff={staff}
      />
    );
  }

  return (
    <div className="route-stack">
      <div className="route-header"><div><p className="eyebrow">Learning, Innovation and Vision</p><h1>LIV</h1></div><div className="toolbar">{canCreate ? <Button icon={FilePlus2} onClick={() => setIsCreating((value) => !value)} variant="primary">Create LIV case</Button> : null}</div></div>
      {statusMessage ? <div className="notice-row">{statusMessage}</div> : null}
      {isCreating ? (
        <section className="panel liv-v2-create">
          <div className="panel-heading"><div><h2>New LIV case</h2><span>The submitted ELI information is linked automatically.</span></div><button className="icon-button" onClick={() => setIsCreating(false)} title="Close" type="button"><X size={16} /></button></div>
          <div className="form-stack">
            <label className="entry-field"><span>Staff member</span><StaffSearchSelect id="liv-staff" onChange={setSelectedStaffId} staff={staff} value={selectedStaffId} /></label>
          </div>
          {staffContext ? <EliContext context={staffContext} /> : null}
          <div className="toolbar toolbar-end"><Button icon={X} onClick={() => setIsCreating(false)}>Cancel</Button><Button disabled={isSaving || !selectedStaffId} icon={Plus} onClick={() => void createCase()} variant="primary">{isSaving ? "Creating..." : "Create case"}</Button></div>
        </section>
      ) : null}

      <KpiStrip items={[
        { label: "Staff in scope", value: coverageRows.length, tone: "blue" },
        { label: "LIV completed", value: coverageRows.filter((row) => row.status === "completed").length, tone: "green" },
        { label: "In progress", value: coverageRows.filter((row) => row.status === "in_progress").length, tone: "amber" },
        { label: "Not started", value: coverageRows.filter((row) => row.status === "not_started").length, tone: "red" }
      ]} />

      <details className="panel liv-v2-records">
        <summary><span><strong>LIV coverage</strong><small>Completed, in-progress and not-started staff</small></span><span className="toolbar"><span>{filteredCoverage.length} staff</span><ChevronDown size={18} /></span></summary>
        <div className="filter-toolbar">
          <label className="search-box"><Search size={16} aria-hidden="true" /><input onChange={(event) => setCoverageSearch(event.target.value)} placeholder="Search staff or team" value={coverageSearch} /></label>
          <label><span>Faculty</span><select onChange={(event) => setCoverageFaculty(event.target.value)} value={coverageFaculty}><option value="all">All faculties</option>{faculties.map((faculty) => <option key={faculty.id} value={faculty.id}>{faculty.code} - {faculty.name}</option>)}</select></label>
          <label><span>LIV status</span><select onChange={(event) => setCoverageStatus(event.target.value as typeof coverageStatus)} value={coverageStatus}><option value="all">All statuses</option><option value="completed">Completed</option><option value="in_progress">In progress</option><option value="not_started">Not started</option></select></label>
        </div>
        <div className="table-shell"><table><thead><tr><th>Staff member</th><th>Faculty</th><th>Team</th><th>LIV status</th><th>Record</th></tr></thead><tbody>
          {filteredCoverage.length === 0 ? <tr><td colSpan={5}>No staff match these filters.</td></tr> : filteredCoverage.map((row) => <tr key={row.staff.id}><td><strong>{row.staff.displayName}</strong><small className="table-subline">{row.staff.externalId}</small></td><td>{row.faculties.map((unit) => unit.code).join(", ") || "Unassigned"}</td><td>{row.teams.map((unit) => unit.code).join(", ") || "Unassigned"}</td><td><span className={`status-pill ${coverageStatusClass(row.status)}`}>{coverageStatusLabel(row.status)}</span></td><td>{row.record ? <button className="icon-button" onClick={() => openRecord(row.record!)} title="Open LIV record" type="button"><Eye size={16} /></button> : "-"}</td></tr>)}
        </tbody></table></div>
      </details>

      <details className="panel liv-v2-records">
        <summary><span><strong>{recordOwnershipView === "mine" ? "My LIV records" : "LIV records in scope"}</strong><small>{displayedRecords.length} records in this view</small></span><span className="toolbar">{user.permissions.includes("exports.create") ? <ExportExcelButton moduleKey="liv" orgUnits={orgUnits} /> : null}<ChevronDown size={18} /></span></summary>
        <div className="segmented-control record-ownership-switch" aria-label="LIV record ownership view"><button className={recordOwnershipView === "mine" ? "is-active" : ""} onClick={() => setRecordOwnershipView("mine")} type="button">My LIV records</button><button className={recordOwnershipView === "scope" ? "is-active" : ""} onClick={() => setRecordOwnershipView("scope")} type="button">All in my scope</button></div>
        <div className="filter-toolbar">
          <label className="search-box"><Search size={16} aria-hidden="true" /><input onChange={(event) => setRecordSearch(event.target.value)} placeholder="Search records" value={recordSearch} /></label>
          <label><span>Status</span><select onChange={(event) => setRecordStatus(event.target.value)} value={recordStatus}><option value="all">All statuses</option><option value="in_progress">In progress</option><option value="closed">Closed</option></select></label>
        </div>
        <div className="table-shell"><table><thead><tr><th>Staff member</th><th>Faculty / team</th><th>Latest delivery area</th><th>Current cycle</th><th>Status</th><th>Open</th></tr></thead><tbody>
          {displayedRecords.length === 0 ? <tr><td colSpan={6}>{recordOwnershipView === "mine" ? "You have not created any LIV records matching these filters." : "No LIV records match these filters."}</td></tr> : displayedRecords.map((record) => <tr key={record.id}><td><strong>{record.subjectStaffName}</strong><small className="table-subline">{record.reviewerStaffName ? `Created by ${record.reviewerStaffName}` : ""}</small></td><td>{[record.parentOrgUnitCode, record.orgUnitCode].filter(Boolean).join(" / ") || "Unassigned"}</td><td>{latestVisit(record)?.deliveryAreaName ?? "Not set"}</td><td>{record.cycles.find((cycle) => cycle.status === "in_progress")?.cycleNumber ?? record.cycles.at(-1)?.cycleNumber ?? 1}</td><td><span className={`status-pill ${record.status === "closed" ? "status-complete" : "status-draft"}`}>{record.status === "closed" ? "Closed" : "In progress"}</span></td><td><button className="icon-button" onClick={() => openRecord(record)} title="Open LIV record" type="button"><Eye size={16} /></button></td></tr>)}
        </tbody></table></div>
      </details>
    </div>
  );
}

export function LivCaseWorkspace({ record, configuration, practitionerThemeGroups = [], actions, cycleId, staff, onBack, onChanged, onCycleChange, onOpenStaffProfile, embedded = false }: {
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
}) {
  const cycle = record.cycles.find((value) => value.id === cycleId) ?? record.cycles.find((value) => value.status === "in_progress") ?? record.cycles.at(-1);
  const [ownerOptions, setOwnerOptions] = useState<ActionOwnerOption[]>([]);
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => { api.actionOwnerOptions(record.recordId, record.subjectStaffId).then(setOwnerOptions).catch(() => setOwnerOptions([])); }, [record.recordId, record.subjectStaffId]);

  async function addStage(stageType: LivStage["stageType"]) {
    setIsSaving(true);
    const result = await api.addLivStage(record.id, emptyStageRequest(stageType));
    setIsSaving(false);
    if (!result.ok) {
      setMessage(result.message ?? "The LIV stage could not be added.");
      return;
    }
    await onChanged("LIV stage added.");
  }

  async function completeCycle(openFollowUp: boolean) {
    const isProbationLiv = record.probationObservationNumber === 2;
    const confirmation = isProbationLiv
      ? "Complete Probation Observation 2?"
      : openFollowUp
        ? "Complete this cycle and open the next follow-up cycle?"
        : "Complete this cycle and close the LIV without opening another cycle?";
    if (!window.confirm(confirmation)) return;
    setIsSaving(true);
    const result = await api.completeLivCycle(record.id, openFollowUp);
    setIsSaving(false);
    if (!result.ok) {
      setMessage(result.message ?? "The cycle could not be completed.");
      return;
    }
    await onChanged(isProbationLiv
      ? "Probation Observation 2 completed. Observation 3 is ready."
      : openFollowUp ? "Cycle completed. A new follow-up cycle is ready." : "Cycle completed and the LIV is now closed.");
  }

  if (!cycle) return <section className="panel"><Button icon={ArrowLeft} onClick={onBack}>Back to LIV</Button><p>No LIV cycle is available.</p></section>;

  const currentCycleActions = actions.filter((action) => action.livCycleId === cycle.id);
  const previousActions = actions.filter((action) => action.livCycleId && action.livCycleId !== cycle.id);
  const complete = stageDefinitions.every((definition) => cycle.stages.some((stage) => stage.stageType === (cycle.isFollowUp ? definition.followUpType : definition.type)));

  return (
    <div className="route-stack">
      {!embedded ? <div className="route-header"><div><Button icon={ArrowLeft} onClick={onBack}>Back to LIV</Button><p className="eyebrow">In-progress staff-visible record</p><h1>{record.subjectStaffName}</h1></div><div className="toolbar"><ExportWordButton recordId={record.recordId} />{onOpenStaffProfile ? <Button icon={Eye} onClick={() => onOpenStaffProfile(record.subjectStaffId)}>Staff profile</Button> : null}</div></div> : null}
      {message ? <div className="notice-row">{message}</div> : null}
      <section className="panel liv-v2-header">
        <div className="panel-heading">
          <div><p className="eyebrow">Elevate Learning and Innovation</p><h2>LIV preferences and focus</h2></div>
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
      </section>
      {!embedded && record.canViewSensitive ? <ElevatePractitionerEditor onChanged={onChanged} record={record} themeGroups={practitionerThemeGroups} /> : null}
      <div className="segmented-control liv-v2-cycles" aria-label="LIV cycles">
        {record.cycles.map((value) => <button className={cycle.id === value.id ? "is-active" : ""} key={value.id} onClick={() => onCycleChange(value.id)} type="button">Cycle {value.cycleNumber}{value.status === "completed" ? " · Complete" : " · Current"}</button>)}
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
            <details className="panel liv-v2-stage-panel" key={type}>
              <summary>
                <div className="liv-v2-stage-title"><span><Icon size={18} /></span><div><p className="eyebrow">Stage {index + 1}</p><h2>{label}</h2></div></div>
                {stage ? <span className={`status-pill ${stage.stageStatus === "completed" || stage.stageStatus === "not_applicable" ? "status-complete" : "status-draft"}`}>{stage.stageStatus === "completed" ? "Completed" : stage.stageStatus === "not_applicable" ? "Not applicable" : "In progress"}</span> : <span className="muted-copy">Not added</span>}
                <ChevronDown size={18} aria-hidden="true" />
              </summary>
              <div className="liv-v2-stage-panel-body">
                {stage ? (
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
                  />
                ) : record.canEdit && cycle.status === "in_progress" ? <Button disabled={isSaving} icon={Plus} onClick={() => void addStage(type)}>Add stage</Button> : <p className="muted-copy">This stage has not been added.</p>}
              </div>
            </details>
          );
        })}
      </div>
      {record.canEdit && cycle.status === "in_progress" ? <div className="liv-v2-complete"><div className="toolbar toolbar-end"><Button disabled={isSaving || !complete} icon={CheckCircle2} onClick={() => void completeCycle(true)} variant="primary">{record.probationObservationNumber === 2 ? "Complete Probation Observation 2" : "Complete cycle and open follow-up"}</Button>{record.probationObservationNumber !== 2 && cycle.cycleNumber >= 2 ? <Button disabled={isSaving || !complete} icon={CheckCircle2} onClick={() => void completeCycle(false)}>Complete cycle and close LIV</Button> : null}</div>{!complete ? <small>Add all five stages before completing this cycle.</small> : cycle.cycleNumber >= 2 ? <small>Choose whether another follow-up cycle is required.</small> : null}</div> : null}
    </div>
  );
}

function LivStageEditor({ stage, record, cycle, configuration, actions, previousActions, ownerOptions, staff, onChanged }: {
  stage: LivStage;
  record: LivRecordSummary;
  cycle: LivCycle;
  configuration: LivConfiguration;
  actions: ActionSummary[];
  previousActions: ActionSummary[];
  ownerOptions: ActionOwnerOption[];
  staff: StaffSummary[];
  onChanged: (message: string) => Promise<void>;
}) {
  const [form, setForm] = useState<SaveLivStageRequest>(() => stageToRequest(stage));
  const [visit, setVisit] = useState<SaveLivVisitRequest>(() => visitToRequest(record.visits.find((value) => value.id === stage.visitId)));
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const canEdit = stage.canEdit;

  useEffect(() => { setForm(stageToRequest(stage)); setVisit(visitToRequest(record.visits.find((value) => value.id === stage.visitId))); }, [record.visits, stage]);

  async function saveStage() {
    setIsSaving(true);
    const result = await api.updateLivStage(record.id, stage.id, form);
    setIsSaving(false);
    if (!result.ok) {
      setMessage(result.message ?? "The stage could not be saved.");
      return;
    }
    await onChanged("LIV stage saved.");
  }

  async function saveVisit() {
    if (!stage.visitId) return;
    if (!visit.deliveryAreaKey) {
      setMessage("Select the delivery area for this LIV visit.");
      return;
    }
    if (!visit.courseLevel) {
      setMessage("Select the course level for this LIV visit.");
      return;
    }
    if (!visit.ratings?.length) {
      setMessage("Select at least one focus area for the LIV visit detail.");
      return;
    }
    if (visit.ratings.some((rating) => !rating.descriptorId && !rating.isNotApplicable)) {
      setMessage("Choose one practice outcome for every selected LIV focus area.");
      return;
    }
    setIsSaving(true);
    const result = await api.updateLivVisit(record.id, stage.visitId, visit);
    const stageResult = result.ok
      ? await api.updateLivStage(record.id, stage.id, form)
      : null;
    setIsSaving(false);
    if (!result.ok || !stageResult?.ok) {
      setMessage(result.message ?? stageResult?.message ?? "The LIV visit could not be saved.");
      return;
    }
    await onChanged("LIV visit detail saved.");
  }

  if (stage.stageType === "actions") return <LivActions actions={actions} cycle={cycle} ownerOptions={ownerOptions} record={record} staff={staff} onChanged={onChanged} />;
  if (stage.stageType === "visit" && !record.canViewSensitive) return null;

  return (
    <div className="liv-v2-stage-form">
      {message ? <div className="notice-row">{message}</div> : null}
      {stage.stageType === "pre_discussion" ? (
        <div className="form-stack">
          <label className="entry-field"><span>Context</span><textarea disabled={!canEdit} onChange={(event) => setForm({ ...form, contextText: event.target.value })} rows={4} value={form.contextText ?? ""} /></label>
          <label className="entry-field"><span>Aims and intended outcomes</span><textarea disabled={!canEdit} onChange={(event) => setForm({ ...form, aimsText: event.target.value })} rows={4} value={form.aimsText ?? ""} /></label>
          <label className="entry-field"><span>Planned learner activity</span><textarea disabled={!canEdit} onChange={(event) => setForm({ ...form, learnerActivityText: event.target.value })} rows={4} value={form.learnerActivityText ?? ""} /></label>
        </div>
      ) : stage.stageType === "distance_impact" ? (
        <div className="form-stack">
          <label className="entry-field"><span>Distance travelled and impact</span><textarea disabled={!canEdit} onChange={(event) => setForm({ ...form, distanceImpactText: event.target.value })} rows={6} value={form.distanceImpactText ?? ""} /></label>
          <OpportunityChecklist disabled={!canEdit} options={configuration.developmentOpportunities} selected={form.developmentOpportunityKeys} onChange={(keys) => setForm({ ...form, developmentOpportunityKeys: keys })} />
        </div>
      ) : stage.stageType === "visit" ? (
        <VisitEditor completed={stage.stageStatus === "completed"} configuration={configuration} disabled={!canEdit} record={record} value={visit} onChange={setVisit} />
      ) : stage.stageType === "post_reflection" ? (
        <div className="form-stack">
          {cycle.isFollowUp && previousActions.length ? <PreviousActions actions={previousActions} onChanged={onChanged} /> : null}
          <label className="entry-field"><span>Post-LIV reflection and discussion</span><textarea disabled={!canEdit} onChange={(event) => setForm({ ...form, reflectionText: event.target.value })} rows={7} value={form.reflectionText ?? ""} /></label>
          <OpportunityChecklist disabled={!canEdit} options={configuration.developmentOpportunities} selected={form.developmentOpportunityKeys} onChange={(keys) => setForm({ ...form, developmentOpportunityKeys: keys })} />
        </div>
      ) : (
        <label className="entry-field"><span>Intended follow-up date</span><input disabled={!canEdit || form.stageStatus === "not_applicable"} onChange={(event) => setForm({ ...form, intendedFollowUpDate: event.target.value })} type="date" value={form.intendedFollowUpDate ?? ""} /></label>
      )}
      {canEdit ? (
        <div className="toolbar toolbar-end">
          {stage.stageType === "follow_up_review" ? <label className="compact-check"><input checked={form.stageStatus === "not_applicable"} onChange={(event) => setForm({ ...form, intendedFollowUpDate: event.target.checked ? undefined : form.intendedFollowUpDate, stageStatus: event.target.checked ? "not_applicable" : "in_progress" })} type="checkbox" /><span>Not applicable - no further follow-up required</span></label> : null}
          <label className="compact-check"><input checked={form.stageStatus === "completed"} onChange={(event) => setForm({ ...form, stageStatus: event.target.checked ? "completed" : "in_progress" })} type="checkbox" /><span>Mark stage complete</span></label>
          <Button disabled={isSaving} icon={Save} onClick={() => void (stage.stageType === "visit" ? saveVisit() : saveStage())} variant="primary">{isSaving ? "Saving..." : "Save stage"}</Button>
        </div>
      ) : <p className="muted-copy">This stage is read-only for your current access.</p>}
    </div>
  );
}

function VisitEditor({ completed, configuration, disabled, record, value, onChange }: {
  completed: boolean;
  configuration: LivConfiguration;
  disabled: boolean;
  record: LivRecordSummary;
  value: SaveLivVisitRequest;
  onChange: (value: SaveLivVisitRequest) => void;
}) {
  const ratings = value.ratings ?? [];
  function updateRating(focusKey: string, descriptorId?: string, isNotApplicable = false) {
    onChange({ ...value, ratings: [...ratings.filter((rating) => rating.focusKey !== focusKey), { focusKey, descriptorId, isNotApplicable }] });
  }
  function toggleFocus(focusKey: string) {
    const selected = ratings.some((rating) => rating.focusKey === focusKey);
    onChange({
      ...value,
      ratings: selected
        ? ratings.filter((rating) => rating.focusKey !== focusKey)
        : [...ratings, { focusKey, isNotApplicable: false }]
    });
  }
  const selectedFocusAreas = configuration.focusAreas
    .filter((focus) => !focus.isOther && ratings.some((rating) => rating.focusKey === focus.key));
  return (
    <details className="liv-visit-detail" open={!completed}>
      <summary><span>Detail</span><ChevronDown size={16} aria-hidden="true" /></summary>
      <div className="form-stack liv-visit-detail-body">
        <div className="form-grid form-grid-three">
          <label className="entry-field"><span>Delivery area</span><select disabled={disabled} onChange={(event) => onChange({ ...value, deliveryAreaKey: event.target.value })} value={value.deliveryAreaKey ?? ""}><option value="">Select delivery area</option>{configuration.deliveryAreas.map((option) => <option key={option.key} value={option.key}>{option.name}</option>)}</select></label>
          <label className="entry-field"><span>Visit date</span><input disabled={disabled} onChange={(event) => onChange({ ...value, visitDate: event.target.value })} type="date" value={value.visitDate ?? ""} /></label>
          <label className="entry-field"><span>Visit time</span><input disabled={disabled} onChange={(event) => onChange({ ...value, visitTime: event.target.value })} type="time" value={value.visitTime ?? ""} /></label>
          <label className="entry-field"><span>Course name</span><input disabled={disabled} onChange={(event) => onChange({ ...value, courseName: event.target.value })} value={value.courseName ?? ""} /></label>
          <label className="entry-field"><span>Course level</span><select disabled={disabled} onChange={(event) => onChange({ ...value, courseLevel: event.target.value })} value={value.courseLevel ?? ""}><option value="">Select course level</option>{configuration.courseLevels.map((option) => <option key={option.key} value={option.key}>{option.name}</option>)}</select></label>
        </div>
        <label className="entry-field"><span>LIV notes</span><textarea disabled={disabled} onChange={(event) => onChange({ ...value, reflectionNotes: event.target.value })} rows={7} value={value.reflectionNotes ?? ""} /></label>
        <fieldset className="support-options liv-visit-focus-selector">
          <legend>Focus areas</legend>
          {configuration.focusAreas.filter((focus) => !focus.isOther).map((focus) => <label key={focus.key}><input checked={ratings.some((rating) => rating.focusKey === focus.key)} disabled={disabled} onChange={() => toggleFocus(focus.key)} type="checkbox" /><span>{focus.name}</span></label>)}
        </fieldset>
        <section className="coaching-wording-rubric learning-walk-focus-rubrics liv-visit-selected-rubrics">
          <div className="panel-heading"><h3>LIV visit detail</h3><span>Choose one practice outcome for each selected area</span></div>
          {selectedFocusAreas.length ? <div className="learning-walk-focus-rubric-list">{selectedFocusAreas.map((focus) => {
            const selected = ratings.find((rating) => rating.focusKey === focus.key);
            return <fieldset className="learning-walk-focus-rubric" key={focus.key}><legend>{focus.name}</legend><div>{configuration.rubric.filter((descriptor) => descriptor.isActive).map((descriptor) => <button aria-pressed={selected?.descriptorId === descriptor.id} className={selected?.descriptorId === descriptor.id ? "is-selected" : ""} disabled={disabled} key={descriptor.id} onClick={() => updateRating(focus.key, descriptor.id)} title={descriptor.meaning} type="button"><i aria-hidden="true" style={{ background: descriptor.colorHex }} /><span><strong>{descriptor.descriptor}</strong></span></button>)}</div></fieldset>;
          })}</div> : <div className="empty-row">Select one or more focus areas to show their detail.</div>}
        </section>
      </div>
    </details>
  );
}

function ElevatePractitionerEditor({ record, themeGroups, onChanged }: { record: LivRecordSummary; themeGroups: SharedThemeGroup[]; onChanged: (message: string) => Promise<void> }) {
  const themes = themeGroups.flatMap((group) => group.themes).filter((theme) => theme.isActive || record.areaOfPracticeThemeIds.includes(theme.id));
  const [isPractitioner, setIsPractitioner] = useState(record.isElevatePractitioner ? "yes" : "");
  const [themeIds, setThemeIds] = useState(record.areaOfPracticeThemeIds);
  const [other, setOther] = useState(record.areaOfPracticeOther ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const otherSelected = themes.some((theme) => theme.isOther && themeIds.includes(theme.id));

  useEffect(() => {
    setIsPractitioner(record.isElevatePractitioner ? "yes" : "");
    setThemeIds(record.areaOfPracticeThemeIds);
    setOther(record.areaOfPracticeOther ?? "");
  }, [record.areaOfPracticeOther, record.areaOfPracticeThemeIds, record.isElevatePractitioner]);

  async function save() {
    if (otherSelected && !other.trim()) {
      setMessage("Describe the other area of practice.");
      return;
    }
    setIsSaving(true);
    const result = await api.updateLivRecord(record.id, {
      subjectStaffId: record.subjectStaffId,
      orgUnitId: record.orgUnitId,
      isElevatePractitioner: isPractitioner === "yes",
      areaOfPracticeKeys: [],
      areaOfPracticeThemeIds: themeIds,
      areaOfPracticeOther: otherSelected ? other.trim() : undefined
    });
    setIsSaving(false);
    if (!result.ok) {
      setMessage(result.message ?? "Elevate practitioner information could not be saved.");
      return;
    }
    setMessage("");
    await onChanged("Elevate practitioner information saved.");
  }

  return <details className="panel liv-v2-records"><summary><span><strong>Elevate practitioner</strong><small>Practitioner status and areas of practice</small></span><ChevronDown size={18} /></summary><div className="form-stack liv-practitioner-editor">{message ? <div className="notice-row">{message}</div> : null}<label className="entry-field"><span>Elevate practitioner</span><select disabled={!record.canEdit} onChange={(event) => setIsPractitioner(event.target.value)} value={isPractitioner}><option value="">-</option><option value="yes">Yes</option></select></label><fieldset className="support-options"><legend>Areas of practice</legend>{themes.map((theme) => <label key={theme.id}><input checked={themeIds.includes(theme.id)} disabled={!record.canEdit} onChange={() => setThemeIds((current) => current.includes(theme.id) ? current.filter((id) => id !== theme.id) : [...current, theme.id])} type="checkbox" /><span>{theme.name}</span></label>)}</fieldset>{otherSelected ? <label className="entry-field"><span>Other area of practice</span><input disabled={!record.canEdit} onChange={(event) => setOther(event.target.value)} value={other} /></label> : null}{record.canEdit ? <div className="toolbar toolbar-end"><Button disabled={isSaving} icon={Save} onClick={() => void save()} variant="primary">{isSaving ? "Saving..." : "Save practitioner information"}</Button></div> : <p className="muted-copy">This information is read-only for your current access.</p>}</div></details>;
}

function LivActions({ actions, record, cycle, ownerOptions, staff, onChanged }: {
  actions: ActionSummary[];
  record: LivRecordSummary;
  cycle: LivCycle;
  ownerOptions: ActionOwnerOption[];
  staff: StaffSummary[];
  onChanged: (message: string) => Promise<void>;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [actionTheme, setActionTheme] = useState("");
  const [text, setText] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function createAction() {
    if (!actionTheme.trim() || !text.trim() || !ownerId || !dueDate) return;
    setIsSaving(true);
    const result = await api.createAction({ sourceRecordId: record.recordId, sourceFormType: "liv", subjectStaffId: record.subjectStaffId, ownerStaffId: ownerId, actionTheme: actionTheme.trim(), title: text.trim(), dueDate, publishedToStaff: true, livCycleId: cycle.id, visibilitySetting: "staff_and_management" });
    setIsSaving(false);
    if (!result.ok) return;
    setActionTheme(""); setText(""); setOwnerId(""); setDueDate(""); setIsAdding(false);
    await onChanged("LIV action created in the central action engine.");
  }

  return (
    <div className="liv-v2-actions">
      <div className="liv-actions-heading"><div><h3>Cycle actions</h3><span>{actions.length} linked to this cycle</span></div>{record.canEdit && cycle.status === "in_progress" ? <Button icon={Plus} onClick={() => setIsAdding((value) => !value)} variant="primary">Add action</Button> : null}</div>
      {isAdding ? <div className="liv-action-editor"><label className="entry-field"><span>Action theme <strong>Required</strong></span><ActionThemeSelect id={`liv-action-theme-${cycle.id}`} onChange={setActionTheme} sourceFormType="liv" value={actionTheme} /></label><label className="entry-field"><span>Action <strong>Required</strong></span><textarea maxLength={300} onChange={(event) => setText(event.target.value)} rows={3} value={text} /></label><div className="form-grid form-grid-two"><label className="entry-field"><span>Owner <strong>Required</strong></span><select onChange={(event) => setOwnerId(event.target.value)} value={ownerId}><option value="">Select owner</option>{ownerOptions.map((option) => <option key={option.staffId} value={option.staffId}>{option.displayName} - {option.relationship}</option>)}</select></label><label className="entry-field"><span>Date to be implemented by <strong>Required</strong></span><input onChange={(event) => setDueDate(event.target.value)} type="date" value={dueDate} /></label></div><div className="toolbar toolbar-end"><Button icon={X} onClick={() => setIsAdding(false)}>Cancel</Button><Button disabled={isSaving || !actionTheme.trim() || !text.trim() || !ownerId || !dueDate} icon={Save} onClick={() => void createAction()} variant="primary">Create action</Button></div></div> : null}
      <div className="liv-action-list">{actions.length === 0 ? <p className="muted-copy">No actions have been added to this cycle.</p> : actions.map((action) => <LivActionCard action={action} key={action.id} onChanged={onChanged} />)}</div>
      {ownerOptions.length === 0 && staff.length > 0 ? <small className="muted-copy">No valid owners are available for this record and your current permissions.</small> : null}
    </div>
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
  const closed = Boolean(action.completedDate) || action.statusKey === "completed" || action.statusKey === "cancelled";

  async function submit() {
    setIsSaving(true);
    const result = mode === "complete"
      ? await api.updateAction(action.id, { status: "complete", completionNote: comments.trim() || undefined })
      : await api.extendAction(action.id, { dueDate: date, reason: comments.trim() });
    setIsSaving(false);
    if (!result.ok) return;
    setMode(""); setComments("");
    await onChanged(mode === "complete" ? "Action closed." : "Action implementation date extended.");
  }

  return <article className="liv-action-card"><div className="liv-visit-card-heading"><div><h3>{action.title}</h3><span>{action.ownerStaffName ?? "Unassigned"} · {action.revisedDueDate ?? action.dueDate ?? "No date"}</span></div><span className={`status-pill ${closed ? "status-complete" : action.isOverdue ? "status-overdue" : "status-open"}`}>{closed ? "Completed" : action.statusKey === "extended" ? "Extended" : "Open"}</span></div>{action.detail ? <p>{action.detail}</p> : null}{!closed ? <div className="toolbar"><Button icon={CheckCircle2} onClick={() => setMode("complete")}>Close</Button><Button icon={CalendarClock} onClick={() => setMode("extend")}>Extend</Button></div> : action.completionNote ? <small>{action.completionNote}</small> : null}{mode ? <div className="liv-action-editor">{mode === "extend" ? <label className="entry-field"><span>Revised implementation date</span><input onChange={(event) => setDate(event.target.value)} type="date" value={date} /></label> : null}<label className="entry-field"><span>{mode === "complete" ? "Closure comments" : "Extension reason"}</span><textarea onChange={(event) => setComments(event.target.value)} rows={3} value={comments} /></label><div className="toolbar"><Button icon={X} onClick={() => setMode("")}>Cancel</Button><Button disabled={isSaving || !comments.trim() || (mode === "extend" && !date)} icon={mode === "complete" ? CheckCircle2 : CalendarClock} onClick={() => void submit()} variant="primary">{mode === "complete" ? "Close action" : "Extend action"}</Button></div></div> : null}</article>;
}

function OpportunityChecklist({ options, selected, disabled, onChange }: { options: LivConfiguration["developmentOpportunities"]; selected: string[]; disabled: boolean; onChange: (keys: string[]) => void }) {
  return <fieldset className="support-options"><legend>Development opportunities</legend>{options.map((option) => <label key={option.key}><input checked={selected.includes(option.key)} disabled={disabled} onChange={() => onChange(selected.includes(option.key) ? selected.filter((key) => key !== option.key) : [...selected, option.key])} type="checkbox" /><span>{option.name}</span></label>)}</fieldset>;
}

function EliContext({ context }: { context: LivStaffContext }) {
  return <section className="liv-v2-eli-context"><div className="liv-information-grid"><div><span>Preferred month</span><strong>{formatPreferredMonth(context.preferredVisitMonth)}</strong></div><div><span>Primary focus</span><strong>{context.primaryFocus ?? "Not provided"}</strong></div><div><span>Secondary focus</span><strong>{context.secondaryFocusKey === "other" ? context.secondaryFocusOther || "Other" : context.secondaryFocus ?? "Not provided"}</strong></div></div><details><summary><Target size={16} /> Desired outcome</summary><p>{context.desiredOutcome || "No desired outcome was provided."}</p></details>{context.existingLivRecordId ? <p className="notice-row">This submitted ELI assessment is already linked to a LIV case.</p> : null}</section>;
}

function emptyStageRequest(stageType: LivStage["stageType"]): SaveLivStageRequest { return { stageType, developmentOpportunityKeys: [], stageStatus: "in_progress" }; }
function stageToRequest(stage: LivStage): SaveLivStageRequest { return { stageType: stage.stageType, contextText: stage.contextText, aimsText: stage.aimsText, learnerActivityText: stage.learnerActivityText, reflectionText: stage.reflectionText, intendedFollowUpDate: stage.intendedFollowUpDate, distanceImpactText: stage.distanceImpactText, developmentOpportunityKeys: stage.developmentOpportunityKeys, stageStatus: stage.stageStatus }; }
function visitToRequest(visit?: LivVisitSummary): SaveLivVisitRequest { return { visitDate: visit?.visitDate, visitTime: visit?.visitTime, courseName: visit?.courseName, courseLevel: visit?.courseLevel, reflectionNotes: visit?.reflectionNotes, findings: visit?.findings, deliveryAreaKey: visit?.deliveryAreaKey, ratings: visit?.ratings.map((rating) => ({ focusKey: rating.focusKey, descriptorId: rating.descriptorId, isNotApplicable: rating.isNotApplicable })) ?? [] }; }
function latestVisit(record: LivRecordSummary) { return record.visits.at(-1); }
function eliSecondaryFocus(record: LivRecordSummary) { return record.eliSecondaryFocusKey === "other" ? record.eliSecondaryFocusOther || "Other" : record.eliSecondaryFocus ?? "Not provided"; }
function formatPreferredMonth(value?: string) { if (!value) return "Not provided"; const [year, month] = value.split("-").map(Number); return new Date(year, month - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" }); }
function coverageStatusLabel(status: CoverageStatus) { return status === "completed" ? "Completed" : status === "in_progress" ? "In progress" : "Not started"; }
function coverageStatusClass(status: CoverageStatus) { return status === "completed" ? "status-complete" : status === "in_progress" ? "status-draft" : "status-overdue"; }
