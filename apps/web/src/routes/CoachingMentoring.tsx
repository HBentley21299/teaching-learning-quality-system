import { useEffect, useMemo, useRef, useState } from "react";
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
import { api } from "../services/api";
import type {
  CoachingActionReview,
  CoachingActionStatus,
  CoachingConfiguration,
  CoachingContext,
  CoachingLookupOption,
  CoachingPreviousActionSummary,
  CoachingReviewOutcome,
  CoachingRubricOption,
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
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sort, setSort] = useState("date_desc");
  const [historyOpen, setHistoryOpen] = useState(false);
  const openedInitialRecord = useRef("");

  useEffect(() => {
    void refreshSessions();
    void api.coachingConfiguration()
      .then(setConfiguration)
      .catch(() => setMessage("Coaching configuration could not be loaded from the API."));
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
    setIsLoading(true);
    try {
      setSessions(await api.coachingSessions());
    } catch {
      setMessage("Coaching and mentoring records could not be loaded from the API.");
    } finally {
      setIsLoading(false);
    }
  }

  async function startSession() {
    if (!selectedStaffId) {
      setMessage("Select a staff member first.");
      return;
    }

    setIsLoading(true);
    setMessage("");
    try {
      const nextContext = await api.coachingContext(selectedStaffId);
      setContext(nextContext);
      setDetail(null);
      setForm(emptyCoachingForm(selectedStaffId));
      setView("form");
    } catch {
      setMessage("A coaching record cannot be started for the selected staff member.");
    } finally {
      setIsLoading(false);
    }
  }

  async function openSession(id: string) {
    setIsLoading(true);
    setMessage("");
    try {
      const nextDetail = await api.coachingSession(id);
      const nextContext = canCreate
        ? await api.coachingContext(nextDetail.staffId, nextDetail.cycleId).catch(() => null)
        : null;
      setSelectedStaffId(nextDetail.staffId);
      setContext(nextContext);
      setDetail(nextDetail);
      setForm(formFromDetail(nextDetail));
      setView("form");
      onRecordOpened?.(nextDetail.recordId);
    } catch {
      setMessage("The selected coaching session could not be opened.");
    } finally {
      setIsLoading(false);
    }
  }

  async function changeCycle(value: string) {
    if (!form || !context) return;

    if (value === "new") {
      const nextContext = await api.coachingContext(form.staffId);
      setContext(nextContext);
      setForm({ ...form, cycleId: undefined, createNewCycle: true, actionReviews: [] });
      return;
    }

    setIsLoading(true);
    try {
      const nextContext = await api.coachingContext(form.staffId, value);
      setContext(nextContext);
      setForm({
        ...form,
        cycleId: value,
        createNewCycle: false,
        actionReviews: nextContext.previousActions.map((action) => ({ actionId: action.actionId }))
      });
    } catch {
      setMessage("The selected coaching cycle could not be loaded.");
    } finally {
      setIsLoading(false);
    }
  }

  async function save(status: "draft" | "completed") {
    if (!form) return;
    const previousActions = detail?.previousActions ?? context?.previousActions ?? [];
    if (status === "completed") {
      const validationMessage = validateCompletion(form, previousActions, configuration?.maxActionsPerSession ?? 3);
      if (validationMessage) {
        setMessage(validationMessage);
        return;
      }
      if (!window.confirm(form.closeCycle
        ? "Complete this session and close the coaching cycle?"
        : "Complete this session and publish its agreed actions?")) return;
    }

    setIsSaving(true);
    setMessage("");
    const request = { ...form, status };
    const result = detail
      ? await api.updateCoachingSession(detail.id, request)
      : await api.createCoachingSession(request);
    setIsSaving(false);

    if (!result.ok || !result.data) {
      setMessage(result.message ?? "The coaching session could not be saved.");
      return;
    }

    await refreshSessions();
    const savedDetail = await api.coachingSession(result.data.id).catch(() => null);
    if (savedDetail) {
      setDetail(savedDetail);
      setForm(formFromDetail(savedDetail));
    }
    setMessage(status === "completed"
      ? form.closeCycle
        ? "Session completed and coaching cycle closed."
        : "Session completed and agreed actions published."
      : "Draft session saved.");
    if (status === "completed") onActionsChanged();
  }

  const filteredSessions = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = sessions.filter((session) => {
      const matchesSearch = !query || [session.staffName, session.coachName, session.primaryFocus ?? ""]
        .some((value) => value.toLowerCase().includes(query));
      return matchesSearch
        && (statusFilter === "all" || session.status === statusFilter)
        && (typeFilter === "all" || session.sessionType === typeFilter);
    });
    return [...filtered].sort((left, right) => {
      if (sort === "staff") return left.staffName.localeCompare(right.staffName);
      if (sort === "cycle") return right.cycleNumber - left.cycleNumber || right.sessionNumber - left.sessionNumber;
      return sort === "date_asc"
        ? left.sessionDate.localeCompare(right.sessionDate)
        : right.sessionDate.localeCompare(left.sessionDate);
    });
  }, [search, sessions, sort, statusFilter, typeFilter]);

  if (view === "form" && form) {
    return (
      <CoachingSessionEditor
        configuration={configuration}
        context={context}
        detail={detail}
        form={form}
        isSaving={isSaving}
        message={message}
        onBack={() => { setView("list"); setMessage(""); onRecordClosed?.(); }}
        onChange={setForm}
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

      {message ? <div className="notice-row">{message}</div> : null}

      {canCreate ? (
        <section className="panel coaching-start-panel">
          <div className="panel-heading">
            <div><p className="eyebrow">New record</p><h2>Select a staff member</h2></div>
            <UsersRound size={22} aria-hidden="true" />
          </div>
          <div className="coaching-start-controls">
            <StaffSearchSelect helperText="Search the staff directory" id="coaching-staff" onChange={setSelectedStaffId} staff={staff} value={selectedStaffId} />
            <Button disabled={!selectedStaffId || isLoading || !configuration} icon={FilePlus2} onClick={() => void startSession()} variant="primary">Create session</Button>
          </div>
        </section>
      ) : null}

      <section className="panel coaching-history-panel">
        <div className="panel-heading">
          <button className="collapsible-heading" onClick={() => setHistoryOpen((current) => !current)} type="button">
            <span>{historyOpen ? <ChevronDown size={18} aria-hidden="true" /> : <ChevronRight size={18} aria-hidden="true" />}Active records</span>
            <strong>{sessions.length}</strong>
          </button>
          {user.permissions.includes("exports.create") ? <ExportExcelButton moduleKey="coaching" orgUnits={orgUnits} /> : null}
        </div>
        {historyOpen ? (
          <>
            <div className="coaching-filter-bar">
              <label className="search-box"><Search size={16} aria-hidden="true" /><input onChange={(event) => setSearch(event.target.value)} placeholder="Search staff, coach or focus" value={search} /></label>
              <label><span>Status</span><select onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}><option value="all">All statuses</option><option value="draft">Draft</option><option value="completed">Completed</option></select></label>
              <label><span>Type</span><select onChange={(event) => setTypeFilter(event.target.value)} value={typeFilter}><option value="all">All types</option>{sessionTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label><span>Sort by</span><select onChange={(event) => setSort(event.target.value)} value={sort}><option value="date_desc">Newest first</option><option value="date_asc">Oldest first</option><option value="staff">Staff name</option><option value="cycle">Cycle and session</option></select></label>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Staff member</th><th>Cycle / session</th><th>Date</th><th>Type</th><th>Coach or mentor</th><th>Status</th><th><span className="sr-only">Open</span></th></tr></thead>
                <tbody>
                  {isLoading ? <tr><td colSpan={7}>Loading sessions...</td></tr> : filteredSessions.length === 0 ? (
                    <tr><td colSpan={7}>No coaching or mentoring sessions match these filters.</td></tr>
                  ) : filteredSessions.map((session) => (
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
            </div>
          </>
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
  message,
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
  message: string;
  onBack: () => void;
  onChange: (next: SaveCoachingSessionRequest) => void;
  onCycleChange: (value: string) => void;
  onSave: (status: "draft" | "completed") => void;
}) {
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
          <button className="back-link" onClick={onBack} type="button"><ArrowLeft size={16} aria-hidden="true" />Back to sessions</button>
          <p className="eyebrow">Coaching and Mentoring</p>
          <h1>{staffName || "Coaching and Mentoring Record"}</h1>
        </div>
        <div className="coaching-header-summary">
          <div><span>Coaching cycle</span><strong>{cycleNumber ? `Cycle ${cycleNumber}` : "New cycle"}</strong></div>
          <div><span>Session</span><strong>{sessionNumber}</strong></div>
          <div><span>Coach or mentor</span><strong>{coachName || "Resolving"}</strong></div>
          <strong className={`status-badge status-${detail?.status ?? form.status}`}>{detail?.status ?? form.status}</strong>
        </div>
      </div>

      {message ? <div className="notice-row">{message}</div> : null}

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
              <label className="entry-field"><span>Delivery method</span><select onChange={(event) => update("deliveryMethod", event.target.value as SaveCoachingSessionRequest["deliveryMethod"])} value={form.deliveryMethod ?? ""}><option value="">Select method</option><option value="in_person">In person</option><option value="online">Online</option><option value="telephone">Telephone</option></select></label>
              <DurationWheel onChange={(value) => update("durationMinutes", value)} value={form.durationMinutes} />
              <label className="entry-field"><span>Qualification status</span><select onChange={(event) => update("qualificationStatusKey", event.target.value || undefined)} value={form.qualificationStatusKey ?? ""}><option value="">Select status</option>{configuration?.qualificationStatuses.map((option) => <option key={option.id} value={option.valueKey}>{option.displayName}</option>)}</select></label>
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
                        {action.intendedEvidence ? <p><strong>Evidence:</strong> {action.intendedEvidence}</p> : null}
                        {action.intendedImpact ? <p><strong>Intended impact:</strong> {action.intendedImpact}</p> : null}
                      </div>
                    ) : null}
                    <div className="coaching-form-grid coaching-form-grid-2">
                      <TextAreaField label="Progress, evidence or update" onChange={(value) => updateReview(action.actionId, { progressUpdate: value })} rows={2} value={review?.progressUpdate} />
                      <TextAreaField label="Impact observed" onChange={(value) => updateReview(action.actionId, { impactObserved: value })} rows={2} value={review?.impactObserved} />
                    </div>
                    <label className="entry-field coaching-review-outcome"><span>Review outcome</span><select onChange={(event) => setReviewOutcome(action, event.target.value ? event.target.value as CoachingReviewOutcome : undefined)} value={review?.reviewOutcome ?? ""}><option value="">Select outcome</option>{reviewOutcomes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                    {review?.reviewOutcome === "revised" && review.revisedAction ? (
                      <div className="coaching-revised-action">
                        <h4>Revised action</h4>
                        <ActionFields action={review.revisedAction} coachName={coachName} index={0} staffName={staffName} onChange={(changes) => updateReview(action.actionId, { revisedAction: { ...review.revisedAction!, ...changes } })} />
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </CoachingSection>
        ) : null}

        <CoachingSection number={sessionNumber > 1 && previousActions.length > 0 ? 3 : 2} title="Focus of Session and Current Practice">
          <div className="coaching-form-grid coaching-form-grid-2">
            <label className="entry-field"><span>Primary focus area</span><select onChange={(event) => update("primaryFocusKey", event.target.value || undefined)} value={form.primaryFocusKey ?? ""}><option value="">Select primary focus</option>{configuration?.focusAreas.map((option) => <option key={option.id} value={option.valueKey}>{option.displayName}</option>)}</select></label>
            <label className="entry-field"><span>Secondary focus area <small>Optional</small></span><select onChange={(event) => update("secondaryFocusKey", event.target.value || undefined)} value={form.secondaryFocusKey ?? ""}><option value="">No secondary focus</option>{configuration?.focusAreas.filter((option) => option.valueKey !== form.primaryFocusKey).map((option) => <option key={option.id} value={option.valueKey}>{option.displayName}</option>)}</select></label>
          </div>
          {hasOtherFocus ? <label className="entry-field coaching-conditional-field"><span>Describe the other focus area</span><input onChange={(event) => update("focusOtherText", event.target.value)} value={form.focusOtherText ?? ""} /></label> : null}
          <TextAreaField label="What is the specific focus for this session?" onChange={(value) => update("specificSessionFocus", value)} rows={2} value={form.specificSessionFocus} />
          <WordingRubric label="Current practice at the time of this session" onChange={(id) => update("currentPracticeDescriptorId", id)} options={configuration?.currentPracticeRubric ?? []} value={form.currentPracticeDescriptorId} />
          <TextAreaField label="Briefly describe the current practice or evidence that informed this judgement" onChange={(value) => update("currentPracticeEvidence", value)} optional rows={2} value={form.currentPracticeEvidence} />
        </CoachingSection>

        <CoachingSection number={sessionNumber > 1 && previousActions.length > 0 ? 4 : 3} title="Coaching and Mentoring Conversation">
          <MultiSelect title="Support provided" options={configuration?.supportTypes ?? []} values={form.supportTypes} onToggle={toggleSupport} />
          {hasOtherSupport ? <label className="entry-field coaching-conditional-field"><span>Describe the other support provided</span><input onChange={(event) => update("supportOtherText", event.target.value)} value={form.supportOtherText ?? ""} /></label> : null}
          <TextAreaField
            label="Conversation summary"
            onChange={(value) => update("conversationSummary", value)}
            prompt="Summarise the coaching or mentoring conversation, including the key reflections, guidance and agreed approach."
            rows={4}
            value={form.conversationSummary}
          />
        </CoachingSection>

        <CoachingSection number={sessionNumber > 1 && previousActions.length > 0 ? 5 : 4} title="Actions">
          <div className="coaching-actions-heading">
            <div><strong>{form.actions.length} of {maxActions} actions</strong><p className="muted-copy">Actions feed directly into My Actions and the central Action Engine.</p></div>
            <Button disabled={form.actions.length >= maxActions} icon={Plus} onClick={addAction} variant="secondary">Add action</Button>
          </div>
          {form.actions.length === 0 ? <div className="coaching-empty-actions">No new actions have been added.</div> : (
            <div className="coaching-action-list">
              {form.actions.map((action, index) => (
                <article className="coaching-action-card" key={action.id ?? index}>
                  <div className="coaching-action-card-heading"><strong>Action {index + 1}</strong><button className="icon-button" disabled={Boolean(action.id)} onClick={() => removeAction(index)} title={action.id ? "Published actions cannot be removed" : "Remove action"} type="button"><Trash2 size={16} aria-hidden="true" /></button></div>
                  <ActionFields action={action} coachName={coachName} index={index} staffName={staffName} onChange={(changes) => updateAction(index, changes)} />
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

function CoachingSection({ number, title, defaultOpen = false, children }: { number: number; title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  return (
    <details className="coaching-section" open={defaultOpen}>
      <summary className="coaching-section-heading"><span>{number}</span><h2>{title}</h2><ChevronDown size={18} aria-hidden="true" /></summary>
      <div className="coaching-section-body">{children}</div>
    </details>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return <label className="entry-field"><span>{label}</span><input readOnly value={value} /></label>;
}

function TextAreaField({ label, value, prompt, optional = false, rows = 3, onChange }: { label: string; value?: string; prompt?: string; optional?: boolean; rows?: number; onChange: (value: string) => void }) {
  return <label className="entry-field"><span>{label}{optional ? <small>Optional</small> : null}</span><textarea onChange={(event) => onChange(event.target.value)} placeholder={prompt} rows={rows} value={value ?? ""} /></label>;
}

function DurationWheel({ value, onChange }: { value?: number; onChange: (value?: number) => void }) {
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
    <div className="entry-field coaching-duration-field">
      <span>Duration</span>
      <div className="coaching-time-wheel">
        <label><span className="sr-only">Hours</span><select aria-label="Duration hours" onChange={(event) => update(event.target.value, minutes)} value={hours}><option value="">Hours</option>{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{hour} hr</option>)}</select></label>
        <label><span className="sr-only">Minutes</span><select aria-label="Duration minutes" onChange={(event) => update(hours, event.target.value)} value={minutes}><option value="">Minutes</option>{Array.from({ length: 60 }, (_, minute) => <option key={minute} value={minute}>{String(minute).padStart(2, "0")} min</option>)}</select></label>
      </div>
      <small>{value ? formatDuration(value) : "Not set"}</small>
    </div>
  );
}

function MultiSelect({ title, options, values, onToggle }: { title: string; options: CoachingLookupOption[]; values: string[]; onToggle: (value: string) => void }) {
  return <fieldset className="coaching-multi-select"><legend>{title}</legend>{options.map((option) => <label key={option.id}><input checked={values.includes(option.valueKey)} onChange={() => onToggle(option.valueKey)} type="checkbox" /><span>{option.displayName}</span></label>)}</fieldset>;
}

function WordingRubric({ label, options, value, onChange }: { label: string; options: CoachingRubricOption[]; value?: string; onChange: (id: string) => void }) {
  return (
    <fieldset className="coaching-wording-rubric">
      <legend>{label}</legend>
      <div>
        {options.map((option) => (
          <button aria-pressed={value === option.id} className={value === option.id ? "is-selected" : ""} key={option.id} onClick={() => onChange(option.id)} type="button">
            <i aria-hidden="true" style={{ backgroundColor: option.colorHex ?? "#60736b" }} />
            <span><strong>{option.visibleWording}</strong><small>{option.guidanceText}</small></span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function ActionFields({ action, coachName, index, staffName, onChange }: { action: CoachingSessionAction; coachName: string; index: number; staffName: string; onChange: (changes: Partial<CoachingSessionAction>) => void }) {
  return (
    <div className="coaching-action-fields">
      <label className="entry-field coaching-action-theme"><span>Action theme <strong>Required</strong></span><ActionThemeSelect id={`coaching-action-theme-${action.id ?? index}`} onChange={(actionTheme) => onChange({ actionTheme })} sourceFormType="coaching_mentoring" value={action.actionTheme} /></label>
      <label className="entry-field coaching-action-description"><span>Action {index + 1} <strong>Required</strong></span><textarea maxLength={300} onChange={(event) => onChange({ actionText: event.target.value })} rows={3} value={action.actionText} /></label>
      <label className="entry-field"><span>Owner <strong>Required</strong></span><select onChange={(event) => onChange({ ownerType: event.target.value as CoachingSessionAction["ownerType"] })} value={action.ownerType}><option value="staff">{staffName}</option><option value="coach">{coachName}</option><option value="joint">Staff member and coach</option></select></label>
      <label className="entry-field"><span>Date to be implemented by <strong>Required</strong></span><input onChange={(event) => onChange({ dueDate: event.target.value || undefined })} type="date" value={action.dueDate ?? ""} /></label>
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

function validateCompletion(form: SaveCoachingSessionRequest, previousActions: CoachingPreviousActionSummary[], maxActions: number) {
  if (!form.deliveryMethod || !form.durationMinutes || !form.qualificationStatusKey) return "Complete all required Session Details before completing the record.";
  if (!form.primaryFocusKey || !form.specificSessionFocus?.trim() || !form.currentPracticeDescriptorId) return "Complete the session focus and current-practice judgement.";
  if ((form.primaryFocusKey === "other" || form.secondaryFocusKey === "other") && !form.focusOtherText?.trim()) return "Describe the focus area selected as Other.";
  if (form.supportTypes.length === 0 || !form.conversationSummary?.trim()) return "Select the support provided and add the conversation summary.";
  if (form.supportTypes.includes("other") && !form.supportOtherText?.trim()) return "Describe the support type selected as Other.";
  if (form.actions.length > maxActions) return `This session can contain no more than ${maxActions} actions.`;
  if (previousActions.some((action) => !form.actionReviews.find((review) => review.actionId === action.actionId)?.reviewOutcome)) return "Record a review outcome for every active action.";
  if (form.closeCycle && form.actionReviews.some((review) => review.reviewOutcome && !["completed", "closed_without_completion"].includes(review.reviewOutcome))) return "Complete or close every previous action before closing the coaching cycle.";

  const actions = [
    ...form.actions,
    ...form.actionReviews.filter((review) => review.reviewOutcome === "revised" && review.revisedAction).map((review) => review.revisedAction!)
  ].filter((action) => action.actionText.trim());
  if (!form.closeCycle && actions.length === 0) return "Add at least one action, or formally close the coaching cycle.";
  if (actions.some((action) => !action.actionTheme.trim() || !action.actionText.trim() || !action.dueDate)) return "Every agreed action needs an action theme, action, owner and implementation date.";
  return "";
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
