import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { Button } from "../design-system/Button";
import { api } from "../services/api";
import type {
  CoachingConfiguration,
  CoachingContext,
  CoachingLookupOption,
  CoachingPreviousActionStatus,
  CoachingRubricOption,
  CoachingSessionAction,
  CoachingSessionDetail,
  CoachingSessionSummary,
  CoachingSessionType,
  CurrentUser,
  SaveCoachingSessionRequest,
  StaffSummary
} from "../services/types";

type CoachingMentoringProps = {
  staff: StaffSummary[];
  user: CurrentUser;
  onActionsChanged: () => void;
  initialRecordId?: string;
};

const sessionTypes = [
  ["coaching", "Coaching"],
  ["mentoring", "Mentoring"],
  ["combined", "Combined"]
] as const;

const reasonOptions = [
  ["requested_by_staff", "Requested by staff member"],
  ["follow_up", "Follow-up session"],
  ["cpd_implementation", "CPD implementation"],
  ["new_role_responsibility", "New role or responsibility"],
  ["quality_activity", "Quality activity"],
  ["development_priority", "Development priority"],
  ["other", "Other"]
] as const;

const previousStatusOptions = [
  ["not_started", "Not started"],
  ["in_progress", "In progress"],
  ["completed", "Completed"],
  ["not_applicable", "Not applicable"]
] as const;

export function CoachingMentoring({ staff, user, onActionsChanged, initialRecordId = "" }: CoachingMentoringProps) {
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
  const [historyOpen, setHistoryOpen] = useState(true);
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
    if (session) {
      void openSession(session.id);
    } else {
      setMessage("The coaching source record is outside your permitted scope.");
    }
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
      setForm({ ...form, cycleId: undefined, createNewCycle: true, previousActionUpdates: [] });
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
        previousActionUpdates: nextContext.previousActions.map((action) => ({
          actionId: action.actionId,
          status: action.status,
          updateText: ""
        }))
      });
    } catch {
      setMessage("The selected coaching cycle could not be loaded.");
    } finally {
      setIsLoading(false);
    }
  }

  async function save(status: "draft" | "completed") {
    if (!form) return;
    if (status === "completed" && !window.confirm("Complete this session and publish its agreed actions?")) return;

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
    setMessage(status === "completed" ? "Session completed and agreed actions published." : "Draft session saved.");
    if (status === "completed") onActionsChanged();
  }

  const filteredSessions = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = sessions.filter((session) => {
      const matchesSearch = !query || [session.staffName, session.coachName, session.mainFocus ?? ""]
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
        onBack={() => { setView("list"); setMessage(""); }}
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
        <button className="collapsible-heading" onClick={() => setHistoryOpen((current) => !current)} type="button">
          <span>{historyOpen ? <ChevronDown size={18} aria-hidden="true" /> : <ChevronRight size={18} aria-hidden="true" />}Session history</span>
          <strong>{sessions.length}</strong>
        </button>
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
                      <td><strong>{session.staffName}</strong><small className="table-subline">{lookupLabel(configuration?.focusAreas, session.mainFocus)}</small></td>
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

  function update<K extends keyof SaveCoachingSessionRequest>(key: K, value: SaveCoachingSessionRequest[K]) {
    onChange({ ...form, [key]: value });
  }

  function toggleList(key: "focusAreas" | "supportTypes", value: string) {
    const current = form[key];
    update(key, current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }

  function updatePreviousAction(actionId: string, updates: { status?: CoachingPreviousActionStatus; updateText?: string }) {
    const existing = form.previousActionUpdates.find((item) => item.actionId === actionId);
    const next = existing
      ? form.previousActionUpdates.map((item) => item.actionId === actionId ? { ...item, ...updates } : item)
      : [...form.previousActionUpdates, { actionId, status: updates.status ?? "not_started", updateText: updates.updateText ?? "" }];
    update("previousActionUpdates", next);
  }

  function addAction() {
    update("actions", [...form.actions, emptyAction()]);
  }

  function updateAction(index: number, updates: Partial<CoachingSessionAction>) {
    update("actions", form.actions.map((action, actionIndex) => actionIndex === index ? { ...action, ...updates } : action));
  }

  function removeAction(index: number) {
    update("actions", form.actions.filter((_, actionIndex) => actionIndex !== index));
  }

  return (
    <div className="route-stack coaching-editor">
      <div className="route-header coaching-editor-header">
        <div>
          <button className="back-link" onClick={onBack} type="button"><ArrowLeft size={16} aria-hidden="true" />Back to sessions</button>
          <p className="eyebrow">{detail ? `Cycle ${detail.cycleNumber} / Session ${detail.sessionNumber}` : "New coaching record"}</p>
          <h1>{staffName || "Coaching and Mentoring Record"}</h1>
        </div>
        <div className="coaching-header-meta"><span>{coachName}</span><strong className={`status-badge status-${detail?.status ?? form.status}`}>{detail?.status ?? form.status}</strong></div>
      </div>

      {message ? <div className="notice-row">{message}</div> : null}

      <fieldset disabled={!editable || isSaving}>
        <CoachingSection number={1} title="Session details">
          <div className="coaching-form-grid coaching-form-grid-4">
            <ReadOnlyField label="Staff member" value={staffName} />
            <ReadOnlyField label="Coach or mentor" value={coachName} />
            <label className="entry-field"><span>Date</span><input onChange={(event) => update("sessionDate", event.target.value)} type="date" value={form.sessionDate} /></label>
            <ReadOnlyField label="Session number" value={String(sessionNumber)} />
            <label className="entry-field"><span>Session type</span><select onChange={(event) => update("sessionType", event.target.value as CoachingSessionType)} value={form.sessionType}>{sessionTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="entry-field"><span>Delivery method</span><select onChange={(event) => update("deliveryMethod", event.target.value as SaveCoachingSessionRequest["deliveryMethod"])} value={form.deliveryMethod ?? ""}><option value="">Select method</option><option value="in_person">In person</option><option value="online">Online</option><option value="telephone">Telephone</option></select></label>
            <DurationWheel onChange={(value) => update("durationMinutes", value)} value={form.durationMinutes} />
            <label className="entry-field"><span>Staff development stage</span><select onChange={(event) => update("developmentStageKey", event.target.value || undefined)} value={form.developmentStageKey ?? ""}><option value="">Select stage</option>{configuration?.developmentStages.map((option) => <option key={option.id} value={option.valueKey}>{option.displayName}</option>)}</select></label>
            {detail ? <ReadOnlyField label="Coaching cycle" value={`Cycle ${cycleNumber}`} /> : (
              <label className="entry-field"><span>Coaching cycle</span><select onChange={(event) => onCycleChange(event.target.value)} value={form.cycleId ?? "new"}><option value="new">New cycle</option>{context?.cycles.filter((cycle) => cycle.status === "active").map((cycle) => <option key={cycle.id} value={cycle.id}>Cycle {cycle.cycleNumber} - {labelFor(sessionTypes, cycle.cycleType)} ({cycle.sessionCount} sessions)</option>)}</select></label>
            )}
          </div>
        </CoachingSection>

        <CoachingSection number={2} title="Previous actions">
          {previousActions.length === 0 ? <p className="muted-copy">No incomplete actions from earlier sessions in this cycle.</p> : (
            <div className="table-wrap coaching-previous-actions"><table><thead><tr><th>Action</th><th>Due date</th><th>Status</th><th>Closure comments or update</th></tr></thead><tbody>{previousActions.map((action) => {
              const updateRow = form.previousActionUpdates.find((item) => item.actionId === action.actionId);
              return <tr key={action.actionId}>
                <td><strong>{action.title}</strong>{action.latestUpdate ? <small className="table-subline">Last update: {action.latestUpdate}</small> : null}{action.lastExtensionReason ? <small className="table-subline">Extension: {action.lastExtensionReason}</small> : null}</td>
                <td>{formatDate(action.targetDate)}{action.extensionCount > 0 ? <small className="table-subline">{action.extensionCount} extension{action.extensionCount === 1 ? "" : "s"}</small> : null}</td>
                <td><select aria-label={`Status for ${action.title}`} onChange={(event) => updatePreviousAction(action.actionId, { status: event.target.value as CoachingPreviousActionStatus })} value={updateRow?.status ?? action.status}>{previousStatusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td>
                <td><input aria-label={`Closure comments or update for ${action.title}`} onChange={(event) => updatePreviousAction(action.actionId, { updateText: event.target.value })} placeholder="Closure comments or progress update" value={updateRow?.updateText ?? ""} /></td>
              </tr>;
            })}</tbody></table></div>
          )}
          <TextAreaField label="Progress reflection" onChange={(value) => update("progressReflection", value)} prompt="What has changed? What worked? Any barriers?" value={form.progressReflection} />
        </CoachingSection>

        <CoachingSection number={3} title="Session focus">
          <MultiSelect title="Focus areas" options={configuration?.focusAreas ?? []} values={form.focusAreas} onToggle={(value) => toggleList("focusAreas", value)} />
          <TextAreaField label="Additional focus" onChange={(value) => update("additionalFocus", value)} value={form.additionalFocus} />
          <label className="entry-field"><span>Reason for session</span><select onChange={(event) => update("sessionReason", event.target.value || undefined)} value={form.sessionReason ?? ""}><option value="">Select reason</option>{reasonOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        </CoachingSection>

        <CoachingSection number={4} title="Intended outcome">
          <TextAreaField label="Goal" onChange={(value) => update("goal", value)} prompt="What do you want to achieve?" value={form.goal} />
          <TextAreaField label="Intended impact" onChange={(value) => update("intendedImpact", value)} value={form.intendedImpact} />
          <WordingRubric label="Intended impact outcome" onChange={(id) => update("intendedImpactDescriptorId", id)} options={configuration?.intendedImpactRubric ?? []} value={form.intendedImpactDescriptorId} />
        </CoachingSection>

        <CoachingSection number={5} title="Discussion">
          <div className="coaching-discussion-stack">
            <TextAreaField label="Current situation" onChange={(value) => update("currentSituation", value)} value={form.currentSituation} />
            <TextAreaField label="What's working" onChange={(value) => update("whatsWorking", value)} value={form.whatsWorking} />
            <TextAreaField label="Challenges" onChange={(value) => update("challenges", value)} value={form.challenges} />
            <TextAreaField label="Key discussion points" onChange={(value) => update("keyDiscussionPoints", value)} value={form.keyDiscussionPoints} />
          </div>
        </CoachingSection>

        <CoachingSection number={6} title="Mentor Comments">
          <TextAreaField label="Mentor comments" onChange={(value) => update("mentorComments", value)} value={form.mentorComments} />
          <MultiSelect title="Support provided" options={configuration?.supportTypes ?? []} values={form.supportTypes} onToggle={(value) => toggleList("supportTypes", value)} />
        </CoachingSection>

        <CoachingSection number={7} title="Actions">
          <div className="coaching-actions-heading"><p className="muted-copy">{form.actions.length} agreed {form.actions.length === 1 ? "action" : "actions"}</p><Button icon={Plus} onClick={addAction} variant="secondary">Add action</Button></div>
          <div className="coaching-action-list">
            {form.actions.map((action, index) => (
              <div className="coaching-action-row" key={action.id ?? index}>
                <label className="entry-field coaching-action-text"><span>Action</span><textarea onChange={(event) => updateAction(index, { actionText: event.target.value })} rows={2} value={action.actionText} /></label>
                <label className="entry-field"><span>Owner</span><select onChange={(event) => updateAction(index, { ownerType: event.target.value as CoachingSessionAction["ownerType"] })} value={action.ownerType}><option value="staff">Staff</option><option value="coach">Coach or mentor</option><option value="joint">Joint</option></select></label>
                <label className="entry-field"><span>Date to be implemented by</span><input onChange={(event) => updateAction(index, { targetDate: event.target.value })} type="date" value={action.targetDate} /></label>
                <button className="icon-button coaching-action-remove" disabled={Boolean(action.actionId)} onClick={() => removeAction(index)} title={action.actionId ? "Published actions cannot be removed" : "Remove action"} type="button"><Trash2 size={16} aria-hidden="true" /></button>
              </div>
            ))}
          </div>
        </CoachingSection>
      </fieldset>

      <div className="coaching-save-bar">
        <div><span>Cycle {cycleNumber ?? "New"}</span><strong>Session {sessionNumber}</strong></div>
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

function CoachingSection({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return <section className="coaching-section"><div className="coaching-section-heading"><span>{number}</span><h2>{title}</h2></div><div className="coaching-section-body">{children}</div></section>;
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return <label className="entry-field"><span>{label}</span><input readOnly value={value} /></label>;
}

function TextAreaField({ label, value, prompt, onChange }: { label: string; value?: string; prompt?: string; onChange: (value: string) => void }) {
  return <label className="entry-field"><span>{label}</span><textarea onChange={(event) => onChange(event.target.value)} placeholder={prompt} rows={3} value={value ?? ""} /></label>;
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
          <button aria-pressed={value === option.id} className={value === option.id ? "is-selected" : ""} key={option.id} onClick={() => onChange(option.id)} title={option.guidanceText} type="button">
            <i aria-hidden="true" style={{ backgroundColor: option.colorHex ?? "#60736b" }} />
            <span><strong>{option.visibleWording}</strong><small>{option.guidanceText}</small></span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function emptyCoachingForm(staffId: string): SaveCoachingSessionRequest {
  return {
    staffId,
    createNewCycle: true,
    sessionDate: new Date().toISOString().slice(0, 10),
    sessionType: "coaching",
    status: "draft",
    focusAreas: [],
    supportTypes: [],
    previousActionUpdates: [],
    actions: []
  };
}

function emptyAction(): CoachingSessionAction {
  return { actionText: "", ownerType: "staff", targetDate: "" };
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
    developmentStageKey: detail.developmentStageKey,
    focusAreas: detail.focusAreas,
    additionalFocus: detail.additionalFocus,
    progressReflection: detail.progressReflection,
    sessionReason: detail.sessionReason,
    goal: detail.goal,
    intendedImpact: detail.intendedImpact,
    intendedImpactDescriptorId: detail.intendedImpactDescriptorId,
    currentSituation: detail.currentSituation,
    whatsWorking: detail.whatsWorking,
    challenges: detail.challenges,
    keyDiscussionPoints: detail.keyDiscussionPoints,
    supportTypes: detail.supportTypes,
    mentorComments: detail.mentorComments,
    previousActionUpdates: detail.previousActions.map((action) => detail.previousActionUpdates.find((update) => update.actionId === action.actionId) ?? { actionId: action.actionId, status: action.status, updateText: "" }),
    actions: detail.actions
  };
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
