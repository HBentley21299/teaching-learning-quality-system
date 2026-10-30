import { WorkflowNarrativeField, WorkflowTextField } from "../components/WorkflowNarrativeField";
import { useFormContent } from "../services/formContent";
import { LoadingState } from "../components/LoadingState";
import { ScrollableTableRegion } from "../components/ScrollableTableRegion";
import { WorkflowErrorSummary } from "../components/WorkflowErrorSummary";
import { focusWorkflowControl, type WorkflowFieldError } from "../services/workflowExperience";
import { useWorkflowPagination, WorkflowPagination } from "../components/WorkflowPagination";
import { WorkflowFeedback } from "../components/WorkflowFeedback";
import { WorkflowFilters } from "../components/WorkflowFilters";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Eye,
  FilePlus2,
  Plus,
  Save,
  Search,
  Send,
  Trash2,
  UsersRound
} from "lucide-react";
import { StaffSearchSelect } from "../components/StaffSearchSelect";
import { ActionThemeSelect } from "../components/ActionThemeSelect";
import { ExportExcelButton, ExportWordButton } from "../components/ExportButtons";
import { Button } from "../design-system/Button";
import { confirmUnsavedNavigation, useUnsavedChanges } from "../components/UnsavedChangesGuard";
import { api } from "../services/api";
import { distinctListValues, matchesListSearch, sortListRows } from "../services/listQuery";
import type {
  CoachingActionReview,
  CoachingActionStatus,
  CoachingConfiguration,
  CoachingContext,
  CoachingLookupOption,
  CoachingPreviousActionSummary,
  CoachingReviewOutcome,
  CoachingSessionAction,
  CoachingSessionDetail,
  CoachingSessionSummary,
  CoachingSessionType,
  CurrentUser,
  OrgUnitSummary,
  SaveCoachingSessionRequest,
  StaffSummary
} from "../services/types";

type CoachingMentoringProps = {
  staff: StaffSummary[];
  orgUnits: OrgUnitSummary[];
  user: CurrentUser;
  onActionsChanged: () => void;
  initialRecordId?: string;
  onRecordOpened?: (recordId: string) => void;
  onRecordClosed?: () => void;
};

const sessionTypes = [
  ["coaching", "Coaching"],
  ["mentoring", "Mentoring"]
] as const;

const actionStatuses: Array<[CoachingActionStatus, string]> = [
  ["not_started", "Not started"],
  ["in_progress", "In progress"],
  ["completed", "Completed"],
  ["closed", "Closed"]
];

const reviewOutcomes: Array<[CoachingReviewOutcome, string]> = [
  ["completed", "Completed"],
  ["continue", "Continue"],
  ["revised", "Revised"],
  ["closed_without_completion", "Closed without completion"]
];

export function CoachingMentoring({ staff, orgUnits, user, onActionsChanged, initialRecordId = "", onRecordOpened, onRecordClosed }: CoachingMentoringProps) {
  const canCreate = user.permissions.includes("coaching.submit") || user.permissions.includes("coaching.manage");
  const [configuration, setConfiguration] = useState<CoachingConfiguration | null>(null);
  const [sessions, setSessions] = useState<CoachingSessionSummary[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [context, setContext] = useState<CoachingContext | null>(null);
  const [detail, setDetail] = useState<CoachingSessionDetail | null>(null);
  const [form, setForm] = useState<SaveCoachingSessionRequest | null>(null);
  const [view, setView] = useState<"list" | "form">("list");
  const [isLoading, setIsLoading] = useState(true);
  const [loadingLabel, setLoadingLabel] = useState("Loading coaching and mentoring sessions…");
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [validationError, setValidationError] = useState<WorkflowFieldError | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sort, setSort] = useState("date_desc");
  const [focusFilter, setFocusFilter] = useState("all");
  const [coachFilter, setCoachFilter] = useState("all");
  const [yearFilter, setYearFilter] = useState("all");
  const [historyOpen, setHistoryOpen] = useState(true);
  const [recordOwnershipView, setRecordOwnershipView] = useState<"mine" | "scope">("mine");
  const openedInitialRecord = useRef("");
  const selectionRequest = useRef(0);
  const sessionsRequest = useRef(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const formBaseline = useRef("");
  const clearNavigation = useUnsavedChanges({ label: "Coaching and mentoring session", dirty: view === "form" && Boolean(form) && JSON.stringify(form) !== formBaseline.current,
    submission: view === "form" && detail?.status !== "completed", submitLabel: "Complete",
    onSubmit: view === "form" && detail?.status !== "completed" && (detail ? detail.canEdit : canCreate) ? () => save("completed") : undefined,
    saving: isSaving, onSave: () => save(detail?.status === "completed" ? "completed" : "draft"), onDiscard: () => { if (formBaseline.current) setForm(JSON.parse(formBaseline.current) as SaveCoachingSessionRequest); } });

  useEffect(() => {
    let cancelled = false;
    void refreshSessions();
    void api.coachingConfiguration()
      .then(configuration => { if (!cancelled) setConfiguration(configuration); })
      .catch(() => { if (!cancelled) setMessage("Coaching settings could not be loaded. Refresh this page to try again."); });
    return () => { cancelled = true; selectionRequest.current += 1; sessionsRequest.current += 1; };
  }, []);

  useEffect(() => {
    if (!initialRecordId || isLoading || openedInitialRecord.current === initialRecordId) return;
    openedInitialRecord.current = initialRecordId;
    const session = sessions.find((candidate) => candidate.recordId === initialRecordId);
    if (session) void openSession(session.id);
    else setMessage("The coaching source record is outside your permitted scope.");
    // openSession is permission checked by the API.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRecordId, isLoading, sessions]);

  async function refreshSessions() {
    const request = ++sessionsRequest.current;
    setLoadingLabel("Loading coaching and mentoring sessions…");
    setIsLoading(true);
    try {
      const result = await api.coachingSessions();
      if (request !== sessionsRequest.current) return;
      setSessions(result); setLoadFailed(false);
    } catch {
      if (request !== sessionsRequest.current) return;
      setLoadFailed(true);
      setMessage("Coaching and mentoring records could not be loaded from the API.");
    } finally {
      if (request === sessionsRequest.current) setIsLoading(false);
    }
  }

  async function startSession() {
    if (!selectedStaffId) {
      setMessage("Select a staff member first.");
      return;
    }

    const request = ++selectionRequest.current;
    setLoadingLabel("Preparing the coaching session…");
    setIsLoading(true);
    setMessage("");
    try {
      const nextContext = await api.coachingContext(selectedStaffId);
      if (request !== selectionRequest.current) return;
      setContext(nextContext);
      setDetail(null);
      const nextForm = emptyCoachingForm(selectedStaffId);
      formBaseline.current = JSON.stringify(nextForm); setForm(nextForm);
      setView("form");
      if (typeof window !== "undefined") window.requestAnimationFrame(() => focusWorkflowControl("coaching-editor-heading"));
    } catch {
      if (request !== selectionRequest.current) return;
      setMessage("A coaching record cannot be started for the selected staff member.");
    } finally {
      if (request === selectionRequest.current) setIsLoading(false);
    }
  }

  async function openSession(id: string) {
    if (!await confirmUnsavedNavigation()) return;
    const request = ++selectionRequest.current;
    setLoadingLabel("Opening the coaching session…");
    setIsLoading(true);
    setMessage("");
    try {
      const nextDetail = await api.coachingSession(id);
      const nextContext = canCreate
        ? await api.coachingContext(nextDetail.staffId, nextDetail.cycleId).catch(() => null)
        : null;
      if (request !== selectionRequest.current) return;
      setSelectedStaffId(nextDetail.staffId);
      setContext(nextContext);
      setDetail(nextDetail);
      formBaseline.current = JSON.stringify(formFromDetail(nextDetail));
      setForm(formFromDetail(nextDetail));
      setView("form");
      if (typeof window !== "undefined") window.requestAnimationFrame(() => focusWorkflowControl("coaching-editor-heading"));
      onRecordOpened?.(nextDetail.recordId);
    } catch {
      if (request !== selectionRequest.current) return;
      setMessage("The selected coaching session could not be opened.");
    } finally {
      if (request === selectionRequest.current) setIsLoading(false);
    }
  }

  async function changeCycle(value: string) {
    if (!form || !context) return;
    const request = ++selectionRequest.current;
    setLoadingLabel("Loading the coaching cycle…");
    setIsLoading(true);
    try {
      const nextContext = await api.coachingContext(form.staffId, value === "new" ? undefined : value);
      if (request !== selectionRequest.current) return;
      setContext(nextContext);
      setForm(current => current ? { ...current, cycleId: value === "new" ? undefined : value,
        createNewCycle: value === "new", actionReviews: value === "new" ? [] : nextContext.previousActions.map(action => ({ actionId: action.actionId })) } : current);
    } catch {
      if (request !== selectionRequest.current) return;
      setMessage("The selected coaching cycle could not be loaded.");
    } finally {
      if (request === selectionRequest.current) setIsLoading(false);
    }
  }

  async function save(status: "draft" | "completed"): Promise<boolean> {
    if (!form) return false;
    const previousActions = detail?.previousActions ?? context?.previousActions ?? [];
    if (status === "completed") {
      const error = validateCompletion(form, previousActions, configuration?.maxActionsPerSession ?? 3);
      if (error) {
        setMessage(""); setValidationError(error);
        return false;
      }
      if (!window.confirm(form.closeCycle
        ? "Complete this session and close the coaching cycle?"
        : "Complete this session and publish its agreed actions?")) return false;
    }

    setIsSaving(true); setValidationError(null);
    try {
      setMessage("");
      const request = { ...form, status };
      const result = detail
        ? await api.updateCoachingSession(detail.id, request)
        : await api.createCoachingSession(request);


      if (!result.ok || !result.data) {
        setMessage(result.message ?? "The coaching session could not be saved.");
        return false;
      }

      formBaseline.current = JSON.stringify(form); clearNavigation();
      await refreshSessions();
      const savedDetail = await api.coachingSession(result.data.id).catch(() => null);
      if (savedDetail) {
        setDetail(savedDetail);
        formBaseline.current = JSON.stringify(formFromDetail(savedDetail));
        setForm(formFromDetail(savedDetail));
      }
      setMessage(status === "completed"
        ? form.closeCycle
          ? "Session completed and coaching cycle closed."
          : "Session completed and agreed actions published."
        : "Draft session saved.");
      if (status === "completed") onActionsChanged();
      return true;
    } finally { setIsSaving(false); }
  }

  const filteredSessions = useMemo(() => {
    const filtered = sessions.filter((session) => {
      const matchesSearch = matchesListSearch(search, session.staffName, session.coachName, session.primaryFocus,
        lookupLabel(configuration?.focusAreas, session.primaryFocus), session.sessionType, session.status,
        session.sessionDate, session.academicYear, formatDate(session.sessionDate), `Cycle ${session.cycleNumber} Session ${session.sessionNumber}`);
      return matchesSearch
        && (recordOwnershipView === "scope" || session.isCreatedByCurrentUser)
        && (statusFilter === "all" || session.status === statusFilter)
        && (typeFilter === "all" || session.sessionType === typeFilter)
        && (focusFilter === "all" || session.primaryFocus === focusFilter)
        && (coachFilter === "all" || session.coachStaffId === coachFilter)
        && (yearFilter === "all" || (session.academicYear || "not_recorded") === yearFilter);
    });
    return sortListRows(filtered, session => sort === "staff" ? session.staffName : sort === "coach" ? session.coachName
      : sort === "focus" ? lookupLabel(configuration?.focusAreas, session.primaryFocus) : sort === "status" ? session.status
      : sort === "cycle" ? session.cycleNumber * 10000 + session.sessionNumber : session.sessionDate ? new Date(session.sessionDate) : undefined,
    ["date_desc", "cycle"].includes(sort) ? "desc" : "asc", session => session.id);
  }, [configuration, coachFilter, focusFilter, yearFilter, recordOwnershipView, search, sessions, sort, statusFilter, typeFilter]);
  const focusOptions = sortListRows(distinctListValues(sessions.map(session => session.primaryFocus)).map(key => ({ key, label: lookupLabel(configuration?.focusAreas, key) })), option => option.label, "asc", option => option.key);
  const coachOptions = sortListRows([...new Map(sessions.map(session => [session.coachStaffId, session.coachName])).entries()], option => option[1], "asc", option => option[0]);
  const yearOptions = distinctListValues(sessions.map(session => session.academicYear || "not_recorded")).reverse();

  const recordPage = useWorkflowPagination(filteredSessions, JSON.stringify([recordOwnershipView, search, statusFilter, typeFilter, coachFilter, focusFilter, yearFilter, sort]));

  if (view === "form" && form) {
    return (
      <CoachingSessionEditor
        configuration={configuration}
        context={context}
        detail={detail}
        form={form}
        isSaving={isSaving}
        isLoading={isLoading}
        loadingLabel={loadingLabel}
        message={message}
        validationError={validationError}
        onBack={() => void confirmUnsavedNavigation().then(leave => { if (leave) { selectionRequest.current += 1; setView("list"); setMessage(""); onRecordClosed?.(); window.requestAnimationFrame(() => focusWorkflowControl(canCreate ? "coaching-start-trigger" : "coaching-history-trigger")); } })}
        onChange={next => { setForm(next); setValidationError(null); }}
        onCycleChange={(value) => void changeCycle(value)}
        onSave={(status) => void save(status)}
      />
    );
  }

  return (
    <div className="route-stack coaching-workspace">
      <div className="route-header">
        <div><p className="eyebrow">Professional development</p><h1>Coaching and Mentoring</h1></div>
      </div>

      <WorkflowFeedback message={message} />
      {isLoading ? <LoadingState label={loadingLabel} /> : null}
      {loadFailed ? <Button disabled={isLoading} onClick={() => void refreshSessions()}>Retry loading sessions</Button> : null}

      {canCreate ? (
        <section className="panel coaching-start-panel">
          <div className="panel-heading">
            <div><p className="eyebrow">New record</p><h2>Select a staff member</h2></div>
            <UsersRound size={22} aria-hidden="true" />
          </div>
          <div className="coaching-start-controls">
            <StaffSearchSelect helperText="Search the staff directory" id="coaching-staff" onChange={setSelectedStaffId} staff={staff} value={selectedStaffId} />
            <Button id="coaching-start-trigger" disabled={!selectedStaffId || isLoading || !configuration} icon={FilePlus2} onClick={() => void startSession()} variant="primary">Create session</Button>
          </div>
        </section>
      ) : null}

      <section className="panel coaching-history-panel">
        <div className="panel-heading">
          <button id="coaching-history-trigger" aria-expanded={historyOpen} aria-controls="coaching-record-history" className="collapsible-heading" onClick={() => setHistoryOpen((current) => !current)} type="button">
            <span>{historyOpen ? <ChevronDown size={18} aria-hidden="true" /> : <ChevronRight size={18} aria-hidden="true" />}{recordOwnershipView === "mine" ? "My coaching and mentoring records" : "Records in scope"}</span>
            <strong>{filteredSessions.length}</strong>
          </button>
          {user.permissions.includes("exports.create") ? <ExportExcelButton moduleKey="coaching" orgUnits={orgUnits} /> : null}
        </div>
        {historyOpen ? (
          <div id="coaching-record-history">
            <div className="segmented-control record-ownership-switch" aria-label="Coaching record ownership view"><button aria-pressed={recordOwnershipView === "mine"} className={recordOwnershipView === "mine" ? "is-active" : ""} onClick={() => setRecordOwnershipView("mine")} type="button">My coaching records</button><button aria-pressed={recordOwnershipView === "scope"} className={recordOwnershipView === "scope" ? "is-active" : ""} onClick={() => setRecordOwnershipView("scope")} type="button">All in my scope</button></div>
            <WorkflowFilters activeCount={[statusFilter, typeFilter, coachFilter, focusFilter, yearFilter].filter(value => value !== "all").length} hasQuery={Boolean(search)} onClear={() => { setSearch(""); setStatusFilter("all"); setTypeFilter("all"); setCoachFilter("all"); setFocusFilter("all"); setYearFilter("all"); setSort("date_desc"); }} primary={<>
<label className="search-box"><Search size={16} aria-hidden="true" /><input aria-label="Search coaching sessions" onChange={(event) => setSearch(event.target.value)} placeholder="Staff, coach, focus, date or cycle" value={search} /></label>
<label><span>Sort by</span><select aria-label="Sort coaching sessions" onChange={(event) => setSort(event.target.value)} value={sort}><option value="date_desc">Newest first</option><option value="date_asc">Oldest first</option><option value="staff">Staff name</option><option value="coach">Coach / mentor</option><option value="focus">Focus</option><option value="status">Status</option><option value="cycle">Cycle and session</option></select></label>
</>}>
<label><span>Status</span><select onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}><option value="all">All statuses</option>{distinctListValues(sessions.map(session => session.status)).map(value => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
              <label><span>Type</span><select onChange={(event) => setTypeFilter(event.target.value)} value={typeFilter}><option value="all">All types</option>{distinctListValues(sessions.map(session => session.sessionType)).map(value => <option key={value} value={value}>{labelFor(sessionTypes, value)}</option>)}</select></label>
              <label><span>Coach / mentor</span><select aria-label="Filter coaching coach" value={coachFilter} onChange={event => setCoachFilter(event.target.value)}><option value="all">All coaches and mentors</option>{coachOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
              <label><span>Focus</span><select aria-label="Filter coaching focus" value={focusFilter} onChange={event => setFocusFilter(event.target.value)}><option value="all">All focus areas</option>{focusOptions.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
              <label><span>Academic year</span><select value={yearFilter} onChange={event => setYearFilter(event.target.value)}><option value="all">All years</option>{yearOptions.map(year => <option key={year} value={year}>{year === "not_recorded" ? "Not recorded" : year}</option>)}</select></label>
</WorkflowFilters>
            <ScrollableTableRegion label="Coaching and mentoring sessions">
              <table>
                <thead><tr><th scope="col">Staff member</th><th scope="col">Cycle / session</th><th scope="col">Date</th><th scope="col">Type</th><th scope="col">Coach or mentor</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead>
                <tbody>
                  {isLoading && sessions.length === 0 ? null : loadFailed && sessions.length === 0 ? <tr><td colSpan={7}>Sessions are temporarily unavailable. Use Retry loading sessions above.</td></tr> : filteredSessions.length === 0 ? (
                    <tr><td colSpan={7}>{recordOwnershipView === "mine" ? "You have not created any coaching or mentoring records matching these filters." : "No coaching or mentoring sessions match these filters."}</td></tr>
                  ) : recordPage.items.map((session) => (
                    <tr key={session.id}>
                      <td><strong>{session.staffName}</strong><small className="table-subline">{lookupLabel(configuration?.focusAreas, session.primaryFocus)}</small></td>
                      <td>Cycle {session.cycleNumber} / Session {session.sessionNumber}</td>
                      <td>{formatDate(session.sessionDate)}</td>
                      <td>{labelFor(sessionTypes, session.sessionType)}</td>
                      <td>{session.coachName}</td>
                      <td><span className={`status-badge status-${session.status}`}>{session.status}</span></td>
                      <td><button className="icon-button" onClick={() => void openSession(session.id)} title={session.canEdit ? "Open session" : "View session"} type="button"><Eye size={16} aria-hidden="true" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollableTableRegion>
            <WorkflowPagination {...recordPage} label="Coaching sessions" />
          </div>
        ) : null}
      </section>
    </div>
  );
}


function CoachingSessionEditor({
  configuration,
  context,
  detail,
  form,
  isSaving,
  isLoading,
  loadingLabel,
  message,
  validationError,
  onBack,
  onChange,
  onCycleChange,
  onSave
}: {
  configuration: CoachingConfiguration | null;
  context: CoachingContext | null;
  detail: CoachingSessionDetail | null;
  form: SaveCoachingSessionRequest;
  isSaving: boolean;
  isLoading: boolean;
  loadingLabel: string;
  message: string;
  validationError: WorkflowFieldError | null;
  onBack: () => void;
  onChange: (next: SaveCoachingSessionRequest) => void;
  onCycleChange: (value: string) => void;
  onSave: (status: "draft" | "completed") => void;
}) {
  const content = useFormContent("coaching");
  const editable = detail ? detail.canEdit : true;
  const isCompleted = detail?.status === "completed";
  const previousActions = detail?.previousActions ?? context?.previousActions ?? [];
  const coachName = detail?.coachName ?? context?.coachName ?? "";
  const staffName = detail?.staffName ?? context?.staffName ?? "";
  const cycleNumber = detail?.cycleNumber ?? context?.cycles.find((cycle) => cycle.id === form.cycleId)?.cycleNumber;
  const sessionNumber = detail?.sessionNumber ?? context?.nextSessionNumber ?? 1;
  const hasOtherFocus = form.primaryFocusKey === "other" || form.secondaryFocusKey === "other";
  const hasOtherSupport = form.supportTypes.includes("other");
  const maxActions = configuration?.maxActionsPerSession ?? 3;

  function update<K extends keyof SaveCoachingSessionRequest>(key: K, value: SaveCoachingSessionRequest[K]) {
    onChange({ ...form, [key]: value });
  }

  function toggleSupport(value: string) {
    update("supportTypes", form.supportTypes.includes(value)
      ? form.supportTypes.filter((item) => item !== value)
      : [...form.supportTypes, value]);
  }

  function updateReview(actionId: string, changes: Partial<CoachingActionReview>) {
    const existing = form.actionReviews.find((item) => item.actionId === actionId);
    const next = existing
      ? form.actionReviews.map((item) => item.actionId === actionId ? { ...item, ...changes } : item)
      : [...form.actionReviews, { actionId, ...changes }];
    update("actionReviews", next);
  }

  function setReviewOutcome(action: CoachingPreviousActionSummary, outcome?: CoachingReviewOutcome) {
    const changes: Partial<CoachingActionReview> = { reviewOutcome: outcome };
    if (outcome === "revised") {
      const existing = form.actionReviews.find((item) => item.actionId === action.actionId);
      changes.revisedAction = existing?.revisedAction ?? revisedActionFrom(action);
    } else {
      changes.revisedAction = undefined;
    }
    updateReview(action.actionId, changes);
  }

  function addAction() {
    if (form.actions.length >= maxActions) return;
    update("actions", [...form.actions, emptyAction(form.actions.length + 1)]);
  }

  function updateAction(index: number, changes: Partial<CoachingSessionAction>) {
    update("actions", form.actions.map((action, actionIndex) => actionIndex === index ? { ...action, ...changes } : action));
  }

  function removeAction(index: number) {
    update("actions", form.actions.filter((_, actionIndex) => actionIndex !== index).map((action, actionIndex) => ({ ...action, actionOrder: actionIndex + 1 })));
  }

  return (
    <div className="route-stack coaching-editor">
      <div className="route-header coaching-editor-header">
        <div>
          <button className="back-link" onClick={() => void confirmUnsavedNavigation().then(leave => { if (leave) onBack(); })} type="button"><ArrowLeft size={16} aria-hidden="true" />Back to sessions</button>
          <p className="eyebrow">Coaching and Mentoring</p>
          <h1 id="coaching-editor-heading" tabIndex={-1}>{staffName || "Coaching and Mentoring Record"}</h1>
        </div>
        <div className="coaching-header-summary">
          <div><span>Coaching cycle</span><strong>{cycleNumber ? `Cycle ${cycleNumber}` : "New cycle"}</strong></div>
          <div><span>Session</span><strong>{sessionNumber}</strong></div>
          <div><span>Coach or mentor</span><strong>{coachName || "Resolving"}</strong></div>
          <strong className={`status-badge status-${detail?.status ?? form.status}`}>{detail?.status ?? form.status}</strong>
        </div>
      </div>

      <WorkflowFeedback message={message} />
      {isLoading ? <LoadingState label={loadingLabel} /> : null}
      <WorkflowErrorSummary errors={validationError ? [validationError] : []} />

      <fieldset disabled={!editable || isSaving}>
        <CoachingSection defaultOpen number={1} title="Session Details">
          <div className="coaching-session-overview">
            <div className="coaching-person-summary">
              <span>Staff member</span>
              <strong>{staffName}</strong>
              <small>Coach or mentor: {coachName}</small>
            </div>
            <div className="coaching-form-grid coaching-form-grid-3">
              <label className="entry-field"><span>Session date</span><input onChange={(event) => update("sessionDate", event.target.value)} type="date" value={form.sessionDate} /></label>
              <label className="entry-field"><span>Session type</span><select onChange={(event) => update("sessionType", event.target.value as CoachingSessionType)} value={form.sessionType}>{sessionTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className="entry-field"><span>Delivery method</span><select id="coaching-delivery" aria-invalid={validationError?.id === "coaching-delivery" || undefined} aria-describedby={validationError?.id === "coaching-delivery" ? "coaching-delivery-summary-error" : undefined} onChange={(event) => update("deliveryMethod", event.target.value as SaveCoachingSessionRequest["deliveryMethod"])} value={form.deliveryMethod ?? ""}><option value="">Select method</option><option value="in_person">In person</option><option value="online">Online</option><option value="telephone">Telephone</option></select></label>
              <DurationWheel invalid={validationError?.id === "coaching-duration"} onChange={(value) => update("durationMinutes", value)} value={form.durationMinutes} />
              <label className="entry-field"><span>Qualification status</span><select id="coaching-qualification" aria-invalid={validationError?.id === "coaching-qualification" || undefined} aria-describedby={validationError?.id === "coaching-qualification" ? "coaching-qualification-summary-error" : undefined} onChange={(event) => update("qualificationStatusKey", event.target.value || undefined)} value={form.qualificationStatusKey ?? ""}><option value="">Select status</option><SavedLookupOption value={form.qualificationStatusKey} options={configuration?.qualificationStatuses} />{configuration?.qualificationStatuses.map((option) => <option key={option.id} value={option.valueKey}>{option.displayName}</option>)}</select></label>
              {detail ? <ReadOnlyField label="Coaching cycle" value={`Cycle ${cycleNumber}`} /> : (
                <label className="entry-field"><span>Coaching cycle</span><select onChange={(event) => onCycleChange(event.target.value)} value={form.cycleId ?? "new"}><option value="new">Start a new cycle</option>{context?.cycles.filter((cycle) => cycle.status === "active").map((cycle) => <option key={cycle.id} value={cycle.id}>Cycle {cycle.cycleNumber} - {labelFor(sessionTypes, cycle.cycleType)} ({cycle.sessionCount} sessions)</option>)}</select></label>
              )}
            </div>
          </div>
        </CoachingSection>

        {sessionNumber > 1 && previousActions.length > 0 ? (
          <CoachingSection number={2} title="Review Previous Actions">
            <p className="coaching-section-intro">Review every active action carried forward from this coaching cycle.</p>
            <div className="coaching-review-list">
              {previousActions.map((action) => {
                const review = form.actionReviews.find((item) => item.actionId === action.actionId);
                return (
                  <article className="coaching-review-card" key={action.actionId}>
                    <div className="coaching-review-card-heading">
                      <div><span>{formatActionStatus(action.status)}</span><h3>{action.title}</h3></div>
                      <dl>
                        <div><dt>Owner</dt><dd>{action.ownerName}</dd></div>
                        <div><dt>Due</dt><dd>{formatDate(action.dueDate)}</dd></div>
                        <div><dt>Review</dt><dd>{formatDate(action.reviewDate)}</dd></div>
                      </dl>
                    </div>
                    {action.intendedEvidence || action.intendedImpact ? (
                      <div className="coaching-review-context">
                        {action.intendedEvidence ? <p><strong>{content.field("intendedEvidence", "Evidence").label}:</strong> {action.intendedEvidence}{content.field("intendedEvidence", "Evidence").helpText ? <small>{content.field("intendedEvidence", "Evidence").helpText}</small> : null}</p> : null}
                        {action.intendedImpact ? <p><strong>{content.field("intendedImpact", "Intended impact").label}:</strong> {action.intendedImpact}{content.field("intendedImpact", "Intended impact").helpText ? <small>{content.field("intendedImpact", "Intended impact").helpText}</small> : null}</p> : null}
                      </div>
                    ) : null}
                    <div className="coaching-form-grid coaching-form-grid-2">
                      <TextAreaField label={content.field("progressUpdate", "Progress, evidence or update").label} prompt={content.field("progressUpdate", "Progress, evidence or update").helpText} onChange={(value) => updateReview(action.actionId, { progressUpdate: value })} rows={2} value={review?.progressUpdate} />
                      <TextAreaField label={content.field("impactObserved", "Impact observed").label} prompt={content.field("impactObserved", "Impact observed").helpText} onChange={(value) => updateReview(action.actionId, { impactObserved: value })} rows={2} value={review?.impactObserved} />
                    </div>
                    <label className="entry-field coaching-review-outcome"><span>Review outcome</span><select id={`coaching-review-${action.actionId}`} aria-invalid={validationError?.id === `coaching-review-${action.actionId}` || undefined} aria-describedby={validationError?.id === `coaching-review-${action.actionId}` ? `${validationError.id}-summary-error` : undefined} onChange={(event) => setReviewOutcome(action, event.target.value ? event.target.value as CoachingReviewOutcome : undefined)} value={review?.reviewOutcome ?? ""}><option value="">Select outcome</option>{reviewOutcomes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                    {review?.reviewOutcome === "revised" && review.revisedAction ? (
                      <div className="coaching-revised-action">
                        <h4>Revised action</h4>
                        <ActionFields validationError={validationError} action={review.revisedAction} coachName={coachName} index={0} staffName={staffName} onChange={(changes) => updateReview(action.actionId, { revisedAction: { ...review.revisedAction!, ...changes } })} />
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </CoachingSection>
        ) : null}

        <CoachingSection number={sessionNumber > 1 && previousActions.length > 0 ? 3 : 2} title="Focus of Session">
          <div className="coaching-form-grid coaching-form-grid-2">
            <label className="entry-field"><span>Primary focus area</span><select id="coaching-focus" aria-invalid={validationError?.id === "coaching-focus" || undefined} aria-describedby={validationError?.id === "coaching-focus" ? "coaching-focus-summary-error" : undefined} onChange={(event) => update("primaryFocusKey", event.target.value || undefined)} value={form.primaryFocusKey ?? ""}><option value="">Select primary focus</option><SavedLookupOption value={form.primaryFocusKey} options={configuration?.focusAreas} />{configuration?.focusAreas.map((option) => <option key={option.id} value={option.valueKey}>{option.displayName}</option>)}</select></label>
            <label className="entry-field"><span>Secondary focus area <small>Optional</small></span><select onChange={(event) => update("secondaryFocusKey", event.target.value || undefined)} value={form.secondaryFocusKey ?? ""}><option value="">No secondary focus</option><SavedLookupOption value={form.secondaryFocusKey} options={configuration?.focusAreas} />{configuration?.focusAreas.filter((option) => option.valueKey !== form.primaryFocusKey).map((option) => <option key={option.id} value={option.valueKey}>{option.displayName}</option>)}</select></label>
          </div>
          {hasOtherFocus ? <WorkflowTextField className="entry-field coaching-conditional-field" content={content.field("focusOtherText", "Describe the other focus area")} id="coaching-focus-other" aria-invalid={validationError?.id === "coaching-focus-other" || undefined} aria-describedby={validationError?.id === "coaching-focus-other" ? "coaching-focus-other-summary-error" : undefined} onChange={value => update("focusOtherText", value)} value={form.focusOtherText ?? ""} /> : null}
          <TextAreaField id="coaching-specific-focus" invalid={validationError?.id === "coaching-specific-focus"} label={content.field("specificSessionFocus", "What is the specific focus for this session?").label} prompt={content.field("specificSessionFocus", "What is the specific focus for this session?").helpText} onChange={(value) => update("specificSessionFocus", value)} rows={2} value={form.specificSessionFocus} />
        </CoachingSection>

        <CoachingSection number={sessionNumber > 1 && previousActions.length > 0 ? 4 : 3} title="Coaching and Mentoring Conversation">
          <MultiSelect id="coaching-support" invalid={validationError?.id === "coaching-support"} title="Support provided" options={configuration?.supportTypes ?? []} values={form.supportTypes} onToggle={toggleSupport} />
          {hasOtherSupport ? <WorkflowTextField className="entry-field coaching-conditional-field" content={content.field("supportOtherText", "Describe the other support provided")} id="coaching-support-other" aria-invalid={validationError?.id === "coaching-support-other" || undefined} aria-describedby={validationError?.id === "coaching-support-other" ? "coaching-support-other-summary-error" : undefined} onChange={value => update("supportOtherText", value)} value={form.supportOtherText ?? ""} /> : null}
          <TextAreaField
            id="coaching-conversation" invalid={validationError?.id === "coaching-conversation"}
            label={content.field("conversationSummary", "Conversation summary").label}
            onChange={(value) => update("conversationSummary", value)}
            prompt={content.field("conversationSummary", "Conversation summary", "Summarise the coaching or mentoring conversation, including the key reflections, guidance and agreed approach.").helpText}
            rows={4}
            value={form.conversationSummary}
          />
        </CoachingSection>

        <CoachingSection number={sessionNumber > 1 && previousActions.length > 0 ? 5 : 4} title="Actions" id="coaching-actions-section">
          <div className="coaching-actions-heading">
            <div><strong>{form.actions.length} of {maxActions} actions</strong><p className="muted-copy">Agreed actions appear in Actions when you complete the session.</p></div>
            <Button id="coaching-add-action" disabled={form.actions.length >= maxActions} icon={Plus} onClick={addAction} variant="secondary">Add action</Button>
          </div>
          {form.actions.length === 0 ? <div className="coaching-empty-actions">No new actions have been added.</div> : (
            <div className="coaching-action-list">
              {form.actions.map((action, index) => (
                <article className="coaching-action-card" key={action.id ?? index}>
                  <div className="coaching-action-card-heading"><strong>Action {index + 1}</strong><button className="icon-button" disabled={Boolean(action.id)} onClick={() => removeAction(index)} title={action.id ? "Published actions cannot be removed" : "Remove action"} type="button"><Trash2 size={16} aria-hidden="true" /></button></div>
                  <ActionFields validationError={validationError} action={action} coachName={coachName} index={index} staffName={staffName} onChange={(changes) => updateAction(index, changes)} />
                </article>
              ))}
            </div>
          )}
          <label className="coaching-cycle-close">
            <input checked={form.closeCycle} onChange={(event) => update("closeCycle", event.target.checked)} type="checkbox" />
            <span><strong>Complete this session and close the coaching cycle</strong><small>All carried actions must be completed or closed. A new action is not required when the cycle is formally closed.</small></span>
          </label>
        </CoachingSection>
      </fieldset>

      <div className="coaching-save-bar">
        <div><span>{cycleNumber ? `Cycle ${cycleNumber}` : "New coaching cycle"}</span><strong>Session {sessionNumber}</strong></div>
        {detail ? <ExportWordButton recordId={detail.recordId} /> : null}
        {editable ? (
          isCompleted ? (
            <div><Button disabled={isSaving} icon={Save} onClick={() => onSave("completed")} variant="primary">Save changes</Button></div>
          ) : (
            <div>
              <Button disabled={isSaving} icon={Save} onClick={() => onSave("draft")} variant="secondary">Save Draft</Button>
              <Button disabled={isSaving} icon={Send} onClick={() => onSave("completed")} variant="primary">Complete</Button>
            </div>
          )
        ) : <span className="coaching-locked"><CheckCircle2 size={17} aria-hidden="true" />Completed session</span>}
      </div>
    </div>
  );
}

function CoachingSection({ number, title, defaultOpen = false, children, id }: { number: number; title: string; defaultOpen?: boolean; children: React.ReactNode; id?: string }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <details id={id} tabIndex={id ? -1 : undefined} className="coaching-section" open={isOpen} onToggle={event => setIsOpen(event.currentTarget.open)}>
      <summary className="coaching-section-heading"><span>{number}</span><h2>{title}</h2><ChevronDown size={18} aria-hidden="true" /></summary>
      <div className="coaching-section-body">{children}</div>
    </details>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return <label className="entry-field"><span>{label}</span><input readOnly value={value} /></label>;
}

function TextAreaField({ label, value, prompt, optional = false, rows = 3, onChange, id, invalid }: { id?: string; invalid?: boolean; label: string; value?: string; prompt?: string; optional?: boolean; rows?: number; onChange: (value: string) => void }) {
  const helpId = useId();
  return <label className="entry-field"><span>{label}{optional ? <small>Optional</small> : null}</span><textarea id={id} aria-invalid={invalid || undefined} aria-describedby={[prompt ? helpId : undefined, invalid && id ? `${id}-summary-error` : undefined].filter(Boolean).join(" ") || undefined} onChange={(event) => onChange(event.target.value)} rows={rows} value={value ?? ""} />{prompt ? <small id={helpId}>{prompt}</small> : null}</label>;
}

function DurationWheel({ value, onChange, invalid }: { invalid?: boolean; value?: number; onChange: (value?: number) => void }) {
  const hours = value === undefined ? "" : String(Math.floor(value / 60));
  const minutes = value === undefined ? "" : String(value % 60);

  function update(nextHours: string, nextMinutes: string) {
    if (nextHours === "" && nextMinutes === "") {
      onChange(undefined);
      return;
    }
    const total = Number(nextHours || 0) * 60 + Number(nextMinutes || 0);
    onChange(total || undefined);
  }

  return (
    <div id="coaching-duration" tabIndex={-1} role="group" aria-label="Session duration" aria-invalid={invalid || undefined} aria-describedby={invalid ? "coaching-duration-summary-error" : undefined} className="entry-field coaching-duration-field">
      <span>Duration</span>
      <div className="coaching-time-wheel">
        <label><span className="sr-only">Hours</span><select aria-label="Duration hours" onChange={(event) => update(event.target.value, minutes)} value={hours}><option value="">Hours</option>{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{hour} hr</option>)}</select></label>
        <label><span className="sr-only">Minutes</span><select aria-label="Duration minutes" onChange={(event) => update(hours, event.target.value)} value={minutes}><option value="">Minutes</option>{Array.from({ length: 60 }, (_, minute) => <option key={minute} value={minute}>{String(minute).padStart(2, "0")} min</option>)}</select></label>
      </div>
      <small>{value ? formatDuration(value) : "Not set"}</small>
    </div>
  );
}

function MultiSelect({ title, options, values, onToggle, id, invalid }: { id?: string; invalid?: boolean; title: string; options: CoachingLookupOption[]; values: string[]; onToggle: (value: string) => void }) {
  const choices = [...options, ...values.filter(value => !options.some(option => option.valueKey === value)).map(value => ({ id: value, valueKey: value, displayName: `${lookupLabel(undefined, value)} (existing response)` }))];
  return <fieldset id={id} tabIndex={-1} aria-invalid={invalid || undefined} aria-describedby={invalid && id ? `${id}-summary-error` : undefined} className="coaching-multi-select"><legend>{title}</legend>{choices.map((option) => <label key={option.id}><input checked={values.includes(option.valueKey)} onChange={() => onToggle(option.valueKey)} type="checkbox" /><span>{option.displayName}</span></label>)}</fieldset>;
}

function ActionFields({ action, coachName, index, staffName, onChange, validationError }: { validationError?: WorkflowFieldError | null; action: CoachingSessionAction; coachName: string; index: number; staffName: string; onChange: (changes: Partial<CoachingSessionAction>) => void }) {
  const content = useFormContent("coaching");
  return (
    <div className="coaching-action-fields">
      <label className="entry-field coaching-action-theme"><span>Action theme <strong>Required</strong></span><ActionThemeSelect id={coachingActionFieldId(action, "theme")} aria-required="true" aria-invalid={validationError?.id === coachingActionFieldId(action, "theme") || undefined} aria-describedby={validationError?.id === coachingActionFieldId(action, "theme") ? `${validationError.id}-summary-error` : undefined} onChange={(actionTheme) => onChange({ actionTheme })} sourceFormType="coaching_mentoring" value={action.actionTheme} /></label>
      <WorkflowNarrativeField className="entry-field coaching-action-description" content={{ ...content.field("actionText", "Action"), label: `${content.field("actionText", "Action").label} ${index + 1}` }} requiredLabel id={coachingActionFieldId(action, "text")} aria-required="true" aria-invalid={validationError?.id === coachingActionFieldId(action, "text") || undefined} aria-describedby={validationError?.id === coachingActionFieldId(action, "text") ? `${validationError.id}-summary-error` : undefined} maxLength={300} onChange={value => onChange({ actionText: value })} rows={3} value={action.actionText} />
      <label className="entry-field"><span>Owner <strong>Required</strong></span><select onChange={(event) => onChange({ ownerType: event.target.value as CoachingSessionAction["ownerType"] })} value={action.ownerType}><option value="staff">{staffName}</option><option value="coach">{coachName}</option><option value="joint">Staff member and coach</option></select></label>
      <label className="entry-field"><span>Date to be implemented by <strong>Required</strong></span><input id={coachingActionFieldId(action, "date")} aria-required="true" aria-invalid={validationError?.id === coachingActionFieldId(action, "date") || undefined} aria-describedby={validationError?.id === coachingActionFieldId(action, "date") ? `${validationError.id}-summary-error` : undefined} onChange={(event) => onChange({ dueDate: event.target.value || undefined })} type="date" value={action.dueDate ?? ""} /></label>
    </div>
  );
}

function emptyCoachingForm(staffId: string): SaveCoachingSessionRequest {
  return {
    staffId,
    createNewCycle: true,
    sessionDate: new Date().toISOString().slice(0, 10),
    sessionType: "coaching",
    status: "draft",
    supportTypes: [],
    closeCycle: false,
    actionReviews: [],
    actions: []
  };
}

function emptyAction(actionOrder: number): CoachingSessionAction {
  return { actionOrder, actionTheme: "", actionText: "", ownerType: "staff", status: "not_started" };
}

function revisedActionFrom(action: CoachingPreviousActionSummary): CoachingSessionAction {
  return {
    actionOrder: 0,
    actionTheme: action.actionTheme,
    actionText: action.title,
    ownerType: action.ownerType,
    dueDate: action.dueDate,
    intendedEvidence: action.intendedEvidence,
    intendedImpact: action.intendedImpact,
    reviewDate: action.reviewDate,
    status: "not_started",
    parentActionId: action.actionId
  };
}

function formFromDetail(detail: CoachingSessionDetail): SaveCoachingSessionRequest {
  return {
    staffId: detail.staffId,
    cycleId: detail.cycleId,
    createNewCycle: false,
    sessionDate: detail.sessionDate,
    sessionType: detail.sessionType,
    deliveryMethod: detail.deliveryMethod,
    durationMinutes: detail.durationMinutes,
    status: detail.status,
    qualificationStatusKey: detail.qualificationStatusKey,
    primaryFocusKey: detail.primaryFocusKey,
    secondaryFocusKey: detail.secondaryFocusKey,
    focusOtherText: detail.focusOtherText,
    specificSessionFocus: detail.specificSessionFocus,
    currentPracticeDescriptorId: detail.currentPracticeDescriptorId,
    currentPracticeEvidence: detail.currentPracticeEvidence,
    supportTypes: detail.supportTypes,
    supportOtherText: detail.supportOtherText,
    conversationSummary: detail.conversationSummary,
    closeCycle: detail.closesCycle,
    actionReviews: detail.previousActions.map((action) =>
      detail.actionReviews.find((review) => review.actionId === action.actionId) ?? { actionId: action.actionId }),
    actions: detail.actions
  };
}

function coachingActionFieldId(action: CoachingSessionAction, field: "theme" | "text" | "date") {
  return `${action.parentActionId ? `coaching-revised-${action.parentActionId}` : `coaching-action-${action.id ?? action.actionOrder}`}-${field}`;
}

function validateCompletion(form: SaveCoachingSessionRequest, previousActions: CoachingPreviousActionSummary[], maxActions: number): WorkflowFieldError | undefined {
  if (!form.deliveryMethod) return { id: "coaching-delivery", message: "Select the session delivery method." };
  if (!form.durationMinutes) return { id: "coaching-duration", message: "Set the session duration." };
  if (!form.qualificationStatusKey) return { id: "coaching-qualification", message: "Select the qualification status." };
  if (!form.primaryFocusKey) return { id: "coaching-focus", message: "Select the primary session focus." };
  if (!form.specificSessionFocus?.trim()) return { id: "coaching-specific-focus", message: "Describe the specific focus for this session." };
  if ((form.primaryFocusKey === "other" || form.secondaryFocusKey === "other") && !form.focusOtherText?.trim()) return { id: "coaching-focus-other", message: "Describe the focus area selected as Other." };
  if (form.supportTypes.length === 0) return { id: "coaching-support", message: "Select the support provided." };
  if (!form.conversationSummary?.trim()) return { id: "coaching-conversation", message: "Add the conversation summary." };
  if (form.supportTypes.includes("other") && !form.supportOtherText?.trim()) return { id: "coaching-support-other", message: "Describe the support type selected as Other." };
  if (form.actions.length > maxActions) return { id: "coaching-actions-section", message: `This session can contain no more than ${maxActions} actions.` };
  const unreviewed = previousActions.find(action => !form.actionReviews.find(review => review.actionId === action.actionId)?.reviewOutcome);
  if (unreviewed) return { id: `coaching-review-${unreviewed.actionId}`, message: "Record a review outcome for every active action." };
  const unclosed = form.closeCycle ? form.actionReviews.find(review => review.reviewOutcome && !["completed", "closed_without_completion"].includes(review.reviewOutcome)) : undefined;
  if (unclosed) return { id: `coaching-review-${unclosed.actionId}`, message: "Complete or close every previous action before closing the coaching cycle." };
  const actions = [...form.actions, ...form.actionReviews.filter(review => review.reviewOutcome === "revised" && review.revisedAction).map(review => review.revisedAction!)].filter(action => action.actionText.trim());
  if (!form.closeCycle && actions.length === 0) return { id: "coaching-add-action", message: "Add at least one action, or formally close the coaching cycle." };
  for (const action of actions) {
    if (!action.actionTheme.trim()) return { id: coachingActionFieldId(action, "theme"), message: "Choose a theme for every agreed action." };
    if (!action.actionText.trim()) return { id: coachingActionFieldId(action, "text"), message: "Describe every agreed action." };
    if (!action.dueDate) return { id: coachingActionFieldId(action, "date"), message: "Set an implementation date for every agreed action." };
  }
}

function SavedLookupOption({ value, options = [] }: { value?: string; options?: CoachingLookupOption[] }) {
  return value && !options.some(option => option.valueKey === value) ? <option value={value}>{lookupLabel(undefined, value)} (existing response)</option> : null;
}

function lookupLabel(options?: CoachingLookupOption[], value?: string) {
  if (!value) return "";
  return options?.find((option) => option.valueKey === value)?.displayName ?? value.replaceAll("_", " ");
}

function labelFor(options: readonly (readonly [string, string])[], value?: string) {
  if (!value) return "";
  return options.find(([key]) => key === value)?.[1] ?? value.replaceAll("_", " ");
}

function formatDate(value?: string) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`));
}

function formatDuration(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} minutes`;
  if (minutes === 0) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  return `${hours} ${hours === 1 ? "hour" : "hours"} ${minutes} minutes`;
}

function formatActionStatus(value: CoachingActionStatus) {
  return actionStatuses.find(([status]) => status === value)?.[1] ?? value.replaceAll("_", " ");
}
