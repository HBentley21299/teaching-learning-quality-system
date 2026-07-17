import { useEffect, useMemo, useState, type ReactNode } from "react";
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
import { FullRecordLink } from "../components/FullRecordLink";
import { Button } from "../design-system/Button";
import { api } from "../services/api";
import type {
  CoachingContext,
  CoachingPreviousActionStatus,
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
};

const sessionTypes = [
  ["coaching", "Coaching"],
  ["mentoring", "Mentoring"],
  ["combined", "Combined"]
] as const;

const focusOptions = [
  ["teaching_learning", "Teaching & learning"],
  ["assessment", "Assessment"],
  ["engagement", "Engagement"],
  ["inclusion", "Inclusion"],
  ["behaviour", "Behaviour"],
  ["digital", "Digital"],
  ["subject_practice", "Subject practice"],
  ["confidence", "Confidence"],
  ["leadership", "Leadership"],
  ["career", "Career"],
  ["other", "Other"]
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

const supportTypeOptions = [
  ["reflective_questioning", "Reflective questioning"],
  ["advice_guidance", "Advice or guidance"],
  ["modelling_demonstration", "Modelling or demonstration"],
  ["resource_sharing", "Resource sharing"],
  ["joint_planning", "Joint planning"],
  ["observation", "Observation"],
  ["feedback", "Feedback"],
  ["cpd_signposting", "CPD signposting"],
  ["technology_support", "Technology support"],
  ["professional_guidance", "Professional guidance"],
  ["other", "Other"]
] as const;

const impactOptions = [
  ["learner_progress", "Learner progress"],
  ["engagement", "Engagement"],
  ["confidence", "Confidence"],
  ["inclusion", "Inclusion"],
  ["teaching_quality", "Teaching quality"],
  ["technology_use", "Technology use"],
  ["professional_practice", "Professional practice"],
  ["leadership_development", "Leadership development"],
  ["other", "Other"]
] as const;

const supportNeededOptions = [
  ["coaching", "Coaching"],
  ["mentoring", "Mentoring"],
  ["cpd", "CPD"],
  ["resources", "Resources"],
  ["time", "Time"],
  ["observation_opportunities", "Observation opportunities"],
  ["technical_support", "Technical support"],
  ["manager_support", "Manager support"],
  ["other", "Other"]
] as const;

const previousStatusOptions = [
  ["not_started", "Not started"],
  ["in_progress", "In progress"],
  ["completed", "Completed"],
  ["not_applicable", "Not applicable"]
] as const;

export function CoachingMentoring({ staff, user, onActionsChanged }: CoachingMentoringProps) {
  const canCreate = user.permissions.includes("coaching.submit") || user.permissions.includes("coaching.manage");
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

  useEffect(() => {
    void refreshSessions();
  }, []);

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
      let nextContext: CoachingContext | null = null;
      if (canCreate) {
        nextContext = await api.coachingContext(nextDetail.staffId, nextDetail.cycleId).catch(() => null);
      }
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
    if (!form || !context) {
      return;
    }

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
    if (!form) {
      return;
    }

    if (status === "completed" && !window.confirm("Complete this session and publish its agreed actions?")) {
      return;
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
    setMessage(status === "completed" ? "Session completed and agreed actions published." : "Draft session saved.");
    if (status === "completed") {
      onActionsChanged();
    }
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
        <div>
          <p className="eyebrow">Professional development</p>
          <h1>Coaching and Mentoring</h1>
        </div>
      </div>

      {message ? <div className="notice-row">{message}</div> : null}

      {canCreate ? (
        <section className="panel coaching-start-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">New record</p>
              <h2>Select a staff member</h2>
            </div>
            <UsersRound size={22} aria-hidden="true" />
          </div>
          <div className="coaching-start-controls">
            <StaffSearchSelect
              helperText="Search the staff directory"
              id="coaching-staff"
              onChange={setSelectedStaffId}
              staff={staff}
              value={selectedStaffId}
            />
            <Button disabled={!selectedStaffId || isLoading} icon={FilePlus2} onClick={() => void startSession()} variant="primary">
              Create session
            </Button>
          </div>
        </section>
      ) : null}

      <section className="panel coaching-history-panel">
        <button className="collapsible-heading" onClick={() => setHistoryOpen((current) => !current)} type="button">
          <span>
            {historyOpen ? <ChevronDown size={18} aria-hidden="true" /> : <ChevronRight size={18} aria-hidden="true" />}
            Session history
          </span>
          <strong>{filteredSessions.length} of {sessions.length}</strong>
        </button>
        {historyOpen ? (
          <>
            <div className="coaching-filter-bar">
              <label className="search-box">
                <Search size={16} aria-hidden="true" />
                <input onChange={(event) => setSearch(event.target.value)} placeholder="Search staff, coach or focus" value={search} />
              </label>
              <label>
                <span>Status</span>
                <select onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}>
                  <option value="all">All statuses</option>
                  <option value="draft">Draft</option>
                  <option value="completed">Completed</option>
                </select>
              </label>
              <label>
                <span>Type</span>
                <select onChange={(event) => setTypeFilter(event.target.value)} value={typeFilter}>
                  <option value="all">All types</option>
                  {sessionTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label>
                <span>Sort by</span>
                <select onChange={(event) => setSort(event.target.value)} value={sort}>
                  <option value="date_desc">Newest first</option>
                  <option value="date_asc">Oldest first</option>
                  <option value="staff">Staff name</option>
                  <option value="cycle">Cycle and session</option>
                </select>
              </label>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Staff member</th><th>Cycle / session</th><th>Date</th><th>Type</th><th>Coach or mentor</th><th>Status</th><th>Report</th><th><span className="sr-only">Manage</span></th></tr></thead>
                <tbody>
                  {isLoading ? (
                    <tr><td colSpan={8}>Loading sessions...</td></tr>
                  ) : filteredSessions.length === 0 ? (
                    <tr><td colSpan={8}>No coaching or mentoring sessions match these filters.</td></tr>
                  ) : filteredSessions.map((session) => (
                    <tr key={session.id}>
                      <td><strong>{session.staffName}</strong><small className="table-subline">{labelFor(focusOptions, session.mainFocus)}</small></td>
                      <td>Cycle {session.cycleNumber} / Session {session.sessionNumber}</td>
                      <td>{formatDate(session.sessionDate)}</td>
                      <td>{labelFor(sessionTypes, session.sessionType)}</td>
                      <td>{session.coachName}</td>
                      <td><span className={`status-badge status-${session.status}`}>{session.status}</span></td>
                      <td><FullRecordLink label="View report" recordId={session.recordId} recordType="coaching_session" /></td>
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
  const previousActions = detail?.previousActions ?? context?.previousActions ?? [];
  const coachName = detail?.coachName ?? context?.coachName ?? "";
  const staffName = detail?.staffName ?? context?.staffName ?? "";
  const cycleNumber = detail?.cycleNumber
    ?? context?.cycles.find((cycle) => cycle.id === form.cycleId)?.cycleNumber;
  const sessionNumber = detail?.sessionNumber ?? context?.nextSessionNumber ?? 1;

  function update<K extends keyof SaveCoachingSessionRequest>(key: K, value: SaveCoachingSessionRequest[K]) {
    onChange({ ...form, [key]: value });
  }

  function toggleList(key: "additionalFocusAreas" | "supportTypes" | "intendedImpactAreas" | "supportNeeded", value: string) {
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
        <div className="coaching-header-meta">
          <span>{coachName}</span>
          <strong className={`status-badge status-${detail?.status ?? form.status}`}>{detail?.status ?? form.status}</strong>
        </div>
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
            <label className="entry-field"><span>Duration</span><select onChange={(event) => update("durationMinutes", event.target.value ? Number(event.target.value) : undefined)} value={form.durationMinutes ?? ""}><option value="">Select duration</option><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">60 minutes</option><option value="90">90 minutes</option></select></label>
            <label className="entry-field"><span>Status</span><select onChange={(event) => update("status", event.target.value as SaveCoachingSessionRequest["status"])} value={form.status}><option disabled={detail?.status === "completed"} value="draft">Draft</option><option value="completed">Completed</option></select></label>
            {detail ? <ReadOnlyField label="Coaching cycle" value={`Cycle ${cycleNumber}`} /> : (
              <label className="entry-field"><span>Coaching cycle</span><select onChange={(event) => onCycleChange(event.target.value)} value={form.cycleId ?? "new"}><option value="new">New cycle</option>{context?.cycles.filter((cycle) => cycle.status === "active").map((cycle) => <option key={cycle.id} value={cycle.id}>Cycle {cycle.cycleNumber} - {labelFor(sessionTypes, cycle.cycleType)} ({cycle.sessionCount} sessions)</option>)}</select></label>
            )}
          </div>
        </CoachingSection>

        <CoachingSection number={2} title="Previous actions">
          {previousActions.length === 0 ? <p className="muted-copy">No incomplete actions from earlier sessions in this cycle.</p> : (
            <div className="table-wrap coaching-previous-actions"><table><thead><tr><th>Action</th><th>Target date</th><th>Status</th><th>Update</th></tr></thead><tbody>{previousActions.map((action) => {
              const updateRow = form.previousActionUpdates.find((item) => item.actionId === action.actionId);
              return <tr key={action.actionId}><td><strong>{action.title}</strong>{action.latestUpdate ? <small className="table-subline">Last update: {action.latestUpdate}</small> : null}</td><td>{formatDate(action.targetDate)}</td><td><select aria-label={`Status for ${action.title}`} onChange={(event) => updatePreviousAction(action.actionId, { status: event.target.value as CoachingPreviousActionStatus })} value={updateRow?.status ?? action.status}>{previousStatusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td><td><input aria-label={`Update for ${action.title}`} onChange={(event) => updatePreviousAction(action.actionId, { updateText: event.target.value })} placeholder="Progress update" value={updateRow?.updateText ?? ""} /></td></tr>;
            })}</tbody></table></div>
          )}
          <TextAreaField label="Progress reflection" onChange={(value) => update("progressReflection", value)} prompt="What has changed? What worked? Any barriers?" value={form.progressReflection} />
        </CoachingSection>

        <CoachingSection number={3} title="Session focus">
          <div className="coaching-form-grid coaching-form-grid-2">
            <label className="entry-field"><span>Main focus</span><select onChange={(event) => update("mainFocus", event.target.value || undefined)} value={form.mainFocus ?? ""}><option value="">Select focus</option>{focusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="entry-field"><span>Reason for session</span><select onChange={(event) => update("sessionReason", event.target.value || undefined)} value={form.sessionReason ?? ""}><option value="">Select reason</option>{reasonOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          </div>
          <MultiSelect title="Additional focus areas" options={focusOptions} values={form.additionalFocusAreas} onToggle={(value) => toggleList("additionalFocusAreas", value)} />
        </CoachingSection>

        <CoachingSection number={4} title="Intended outcome">
          <div className="coaching-form-grid coaching-form-grid-2">
            <TextAreaField label="Goal" onChange={(value) => update("goal", value)} prompt="What do you want to achieve?" value={form.goal} />
            <TextAreaField label="Why this matters" onChange={(value) => update("whyThisMatters", value)} value={form.whyThisMatters} />
          </div>
          <ConfidenceScale label="Confidence before the session" onChange={(value) => update("confidenceBefore", value)} value={form.confidenceBefore} />
        </CoachingSection>

        <CoachingSection number={5} title="Discussion">
          <div className="coaching-form-grid coaching-form-grid-2">
            <TextAreaField label="Current situation" onChange={(value) => update("currentSituation", value)} value={form.currentSituation} />
            <TextAreaField label="What's working" onChange={(value) => update("whatsWorking", value)} value={form.whatsWorking} />
            <TextAreaField label="Challenges" onChange={(value) => update("challenges", value)} value={form.challenges} />
            <TextAreaField label="Key discussion points" onChange={(value) => update("keyDiscussionPoints", value)} value={form.keyDiscussionPoints} />
          </div>
        </CoachingSection>

        <CoachingSection number={6} title="Support provided">
          <MultiSelect title="Type of support" options={supportTypeOptions} values={form.supportTypes} onToggle={(value) => toggleList("supportTypes", value)} />
          <TextAreaField label="Key support and resources" onChange={(value) => update("supportResources", value)} value={form.supportResources} />
        </CoachingSection>

        <CoachingSection number={7} title="Actions">
          <div className="coaching-actions-heading"><p className="muted-copy">{form.actions.length} agreed {form.actions.length === 1 ? "action" : "actions"}</p><Button icon={Plus} onClick={addAction} variant="secondary">Add action</Button></div>
          <div className="coaching-action-list">
            {form.actions.map((action, index) => (
              <div className="coaching-action-row" key={action.id ?? index}>
                <label className="entry-field coaching-action-text"><span>Action</span><textarea onChange={(event) => updateAction(index, { actionText: event.target.value })} rows={2} value={action.actionText} /></label>
                <label className="entry-field"><span>Owner</span><select onChange={(event) => updateAction(index, { ownerType: event.target.value as CoachingSessionAction["ownerType"] })} value={action.ownerType}><option value="staff">Staff</option><option value="coach">Coach</option><option value="joint">Joint</option></select></label>
                <label className="entry-field"><span>Target date</span><input onChange={(event) => updateAction(index, { targetDate: event.target.value })} type="date" value={action.targetDate} /></label>
                <label className="entry-field coaching-action-evidence"><span>Evidence</span><input onChange={(event) => updateAction(index, { evidenceText: event.target.value })} value={action.evidenceText ?? ""} /></label>
                <button className="icon-button coaching-action-remove" disabled={Boolean(action.actionId)} onClick={() => removeAction(index)} title={action.actionId ? "Published actions cannot be removed" : "Remove action"} type="button"><Trash2 size={16} aria-hidden="true" /></button>
              </div>
            ))}
          </div>
        </CoachingSection>

        <CoachingSection number={8} title="Intended impact">
          <MultiSelect title="Intended impact areas" options={impactOptions} values={form.intendedImpactAreas} onToggle={(value) => toggleList("intendedImpactAreas", value)} />
          <TextAreaField label="Impact statement" onChange={(value) => update("impactStatement", value)} value={form.impactStatement} />
        </CoachingSection>

        <CoachingSection number={9} title="Commitment">
          <ConfidenceScale label="Confidence to complete agreed actions" onChange={(value) => update("confidenceToComplete", value)} value={form.confidenceToComplete} />
          <MultiSelect title="Support needed" options={supportNeededOptions} values={form.supportNeeded} onToggle={(value) => toggleList("supportNeeded", value)} />
          <TextAreaField label="Additional support details" onChange={(value) => update("additionalSupportDetails", value)} value={form.additionalSupportDetails} />
        </CoachingSection>

        <CoachingSection number={10} title="Summary">
          <div className="coaching-form-grid coaching-form-grid-2">
            <TextAreaField label="Key takeaway" onChange={(value) => update("keyTakeaway", value)} value={form.keyTakeaway} />
            <TextAreaField label="Session summary" onChange={(value) => update("sessionSummary", value)} value={form.sessionSummary} />
          </div>
          <div className="coaching-agreements">
            <label><input checked={form.staffAgrees} onChange={(event) => update("staffAgrees", event.target.checked)} type="checkbox" /><span>Staff agrees</span></label>
            <label><input checked={form.coachAgrees} onChange={(event) => update("coachAgrees", event.target.checked)} type="checkbox" /><span>Coach or mentor agrees</span></label>
          </div>
        </CoachingSection>

        <CoachingSection number={11} title="Next steps">
          <div className="coaching-form-grid coaching-form-grid-3">
            <label className="entry-field"><span>Another session required</span><select onChange={(event) => update("anotherSessionRequired", event.target.value as SaveCoachingSessionRequest["anotherSessionRequired"])} value={form.anotherSessionRequired ?? ""}><option value="">Select</option><option value="yes">Yes</option><option value="no">No</option><option value="to_be_confirmed">To be confirmed</option></select></label>
            <label className="entry-field"><span>Next session date</span><input onChange={(event) => update("nextSessionDate", event.target.value || undefined)} type="date" value={form.nextSessionDate ?? ""} /></label>
            <label className="entry-field"><span>Next focus</span><input onChange={(event) => update("nextFocus", event.target.value)} value={form.nextFocus ?? ""} /></label>
          </div>
          <div className="coaching-review-actions"><strong>Actions to review next time</strong>{form.actions.length === 0 ? <span className="muted-copy">No actions added.</span> : <ol>{form.actions.filter((action) => action.actionText.trim()).map((action, index) => <li key={action.id ?? index}>{action.actionText}</li>)}</ol>}</div>
        </CoachingSection>
      </fieldset>

      <div className="coaching-save-bar">
        <div><span>Cycle {cycleNumber ?? "New"}</span><strong>Session {sessionNumber}</strong></div>
        {editable ? <div><Button disabled={isSaving} icon={form.status === "completed" ? Send : Save} onClick={() => onSave(form.status)} variant={form.status === "completed" ? "primary" : "secondary"}>{form.status === "completed" ? "Complete session" : "Save draft"}</Button></div> : <span className="coaching-locked"><CheckCircle2 size={17} aria-hidden="true" />Completed session</span>}
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

function MultiSelect({ title, options, values, onToggle }: { title: string; options: readonly (readonly [string, string])[]; values: string[]; onToggle: (value: string) => void }) {
  return <fieldset className="coaching-multi-select"><legend>{title}</legend>{options.map(([value, label]) => <label key={value}><input checked={values.includes(value)} onChange={() => onToggle(value)} type="checkbox" /><span>{label}</span></label>)}</fieldset>;
}

function ConfidenceScale({ label, value, onChange }: { label: string; value?: number; onChange: (value: number) => void }) {
  return <div className="coaching-confidence"><div><strong>{label}</strong><span>{value ? `${value} / 5` : "Not rated"}</span></div><div className="coaching-confidence-options">{[1, 2, 3, 4, 5].map((score) => <button aria-pressed={value === score} className={value === score ? "is-selected" : ""} key={score} onClick={() => onChange(score)} type="button"><strong>{score}</strong><span>{score === 1 ? "Very low" : score === 5 ? "Highly confident" : ""}</span></button>)}</div></div>;
}

function emptyCoachingForm(staffId: string): SaveCoachingSessionRequest {
  return {
    staffId,
    createNewCycle: true,
    sessionDate: new Date().toISOString().slice(0, 10),
    sessionType: "coaching",
    status: "draft",
    additionalFocusAreas: [],
    supportTypes: [],
    intendedImpactAreas: [],
    supportNeeded: [],
    staffAgrees: false,
    coachAgrees: false,
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
    progressReflection: detail.progressReflection,
    mainFocus: detail.mainFocus,
    additionalFocusAreas: detail.additionalFocusAreas,
    sessionReason: detail.sessionReason,
    goal: detail.goal,
    whyThisMatters: detail.whyThisMatters,
    confidenceBefore: detail.confidenceBefore,
    currentSituation: detail.currentSituation,
    whatsWorking: detail.whatsWorking,
    challenges: detail.challenges,
    keyDiscussionPoints: detail.keyDiscussionPoints,
    supportTypes: detail.supportTypes,
    supportResources: detail.supportResources,
    intendedImpactAreas: detail.intendedImpactAreas,
    impactStatement: detail.impactStatement,
    confidenceToComplete: detail.confidenceToComplete,
    supportNeeded: detail.supportNeeded,
    additionalSupportDetails: detail.additionalSupportDetails,
    keyTakeaway: detail.keyTakeaway,
    sessionSummary: detail.sessionSummary,
    staffAgrees: detail.staffAgrees,
    coachAgrees: detail.coachAgrees,
    anotherSessionRequired: detail.anotherSessionRequired,
    nextSessionDate: detail.nextSessionDate,
    nextFocus: detail.nextFocus,
    previousActionUpdates: detail.previousActions.map((action) => detail.previousActionUpdates.find((update) => update.actionId === action.actionId) ?? { actionId: action.actionId, status: action.status, updateText: "" }),
    actions: detail.actions
  };
}

function labelFor(options: readonly (readonly [string, string])[], value?: string) {
  if (!value) return "";
  return options.find(([key]) => key === value)?.[1] ?? value.replaceAll("_", " ");
}

function formatDate(value?: string) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`));
}
