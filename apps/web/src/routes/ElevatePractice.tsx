import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  Pencil,
  LockKeyhole,
  Save,
  Search,
  Send,
  Trash2,
  X
} from "lucide-react";
import { Button } from "../design-system/Button";
import { confirmUnsavedNavigation, useUnsavedChanges } from "../components/UnsavedChangesGuard";
import { ExportExcelButton } from "../components/ExportButtons";
import { api } from "../services/api";
import type {
  AdminSaveElevatePracticeAssessmentRequest,
  CurrentUser,
  ElevateLivInformation,
  ElevatePracticeAudit,
  ElevatePracticeProgress,
  ElevatePracticeValidationProgress,
  ElevatePracticeWorkspace,
  SaveElevatePracticeAssessmentRequest
} from "../services/types";

type LivInformationDraft = Omit<ElevateLivInformation, "focusOptions">;

type PracticeDraft = {
  ratings: Record<string, string>;
  livInformation: LivInformationDraft;
};

export function ElevatePractice({
  user,
  onActionsChanged: _onActionsChanged
}: {
  user: CurrentUser;
  onActionsChanged: () => void;
}) {
  const isAdmin = user.permissions.includes("users.manage");
  const canReview = isAdmin || user.permissions.includes("records.manage") || user.permissions.includes("elevate_practice.validate");
  const [view, setView] = useState<"assessment" | "progress" | "validation">("assessment");
  const [workspace, setWorkspace] = useState<ElevatePracticeWorkspace | null>(null);
  const [draft, setDraft] = useState<PracticeDraft | null>(null);
  const [step, setStep] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    api.elevatePracticeMe()
      .then((result) => {
        if (!cancelled) {
          setWorkspace(result);
          setDraft(createDraft(result));
        }
      })
      .catch(() => {
        if (!cancelled) setMessage("Elevate Learning and Innovation could not be loaded from the API.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  async function save(submit: boolean): Promise<boolean> {
    if (!workspace || !draft) return false;
    if (submit && !window.confirm("Submit this assessment for programme leader validation? Your responses will be locked unless returned for amendments.")) return false;

    setIsSaving(true);
    try {
      setMessage("");
      const result = await api.saveElevatePractice(toSaveRequest(workspace, draft, submit));

      if (!result.ok || !result.data) {
        setMessage(result.message ?? "The assessment could not be saved.");
        return false;
      }
      setWorkspace(result.data);
      setDraft(createDraft(result.data));
      setMessage(submit ? "Assessment submitted for validation." : "Draft saved.");
      clearNavigation();
      return true;
    } finally { setIsSaving(false); }
  }

  const clearNavigation = useUnsavedChanges({ label: "Elevate Learning and Innovation assessment", dirty: Boolean(workspace && draft && workspace.status !== "submitted" && JSON.stringify(draft) !== JSON.stringify(createDraft(workspace))),
    saving: isSaving, onSave: () => save(false), onDiscard: () => { if (workspace) setDraft(createDraft(workspace)); } });
  if (isLoading) return <p className="muted-copy">Loading Elevate Learning and Innovation...</p>;

  return (
    <div className="route-stack">
      <div className="route-header">
        <div><p className="eyebrow">Staff self-assessment</p><h1>Elevate Learning and Innovation</h1></div>
        <div className="toolbar">
          {user.permissions.includes("exports.create") ? <ExportExcelButton filters={{ academicYear: workspace?.academicYear }} moduleKey="elevate-practice" /> : null}
          {canReview ? (
            <div className="segmented-control" aria-label="Elevate Learning and Innovation view">
              <button className={view === "assessment" ? "is-active" : ""} onClick={() => void confirmUnsavedNavigation().then(leave => { if (leave) setView("assessment"); })} type="button">My assessment</button>
              <button className={view === "validation" ? "is-active" : ""} onClick={() => void confirmUnsavedNavigation().then(leave => { if (leave) setView("validation"); })} type="button">Programme leader validation</button>
              {isAdmin ? <button className={view === "progress" ? "is-active" : ""} onClick={() => void confirmUnsavedNavigation().then(leave => { if (leave) setView("progress"); })} type="button">Completion overview</button> : null}
            </div>
          ) : null}
        </div>
      </div>
      {message ? <div className="notice-row" role="alert">{message}</div> : null}
      {view === "validation" && canReview ? <ElevatePracticeValidationView /> : view === "progress" && isAdmin ? <ElevatePracticeProgressView /> : workspace && draft ? (
        workspace.status === "submitted" ? <ElevatePracticeResult workspace={workspace} /> : (
          <><ValidationHistory workspace={workspace} /><AssessmentEditor
            draft={draft}
            isSaving={isSaving}
            onChange={setDraft}
            onSave={() => void save(false)}
            onStepChange={setStep}
            onSubmit={() => void save(true)}
            step={step}
            workspace={workspace}
          /></>
        )
      ) : <section className="panel"><p className="muted-copy">No assessment is available for this account.</p></section>}
    </div>
  );
}

export function ElevatePracticeAdminEditor({ assessmentId, onBack, onDeleted }: {
  assessmentId: string;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const [workspace, setWorkspace] = useState<ElevatePracticeWorkspace | null>(null);
  const [draft, setDraft] = useState<PracticeDraft | null>(null);
  const [audit, setAudit] = useState<ElevatePracticeAudit[]>([]);
  const [status, setStatus] = useState<"draft" | "submitted">("draft");
  const [step, setStep] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [deletionReason, setDeletionReason] = useState("");
  const [editReason, setEditReason] = useState("");
  const clearAdminNavigation = useUnsavedChanges({ label: "ELI administrative correction", saving: isSaving,
    dirty: Boolean(workspace && draft && (JSON.stringify(draft) !== JSON.stringify(createDraft(workspace)) || status !== workspace.status || editReason)),
    onSave: () => saveAdminRecord(), onDiscard: () => { if (workspace) { setDraft(createDraft(workspace)); setStatus(workspace.status === "submitted" ? "submitted" : "draft"); } setEditReason(""); setDeletionReason(""); setIsConfirmingDelete(false); } });

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.adminElevatePracticeRecord(assessmentId), api.elevatePracticeAudit(assessmentId)])
      .then(([record, history]) => {
        if (cancelled) return;
        setWorkspace(record);
        setDraft(createDraft(record));
        setStatus(record.status === "submitted" ? "submitted" : "draft");
        setAudit(history);
      })
      .catch(() => { if (!cancelled) setMessage("The Elevate Learning and Innovation record could not be loaded."); });
    return () => { cancelled = true; };
  }, [assessmentId]);

  async function saveAdminRecord(): Promise<boolean> {
    if (!workspace || !draft || !editReason.trim()) {
      setMessage("Enter a reason for the changes before saving.");
      return false;
    }
    setIsSaving(true);
    try {
      setMessage("");
      const result = await api.saveAdminElevatePracticeRecord(assessmentId, { ...toAdminSaveRequest(workspace, draft, status), editReason: editReason.trim() });

      if (!result.ok || !result.data) {
        setMessage(result.message ?? "The record could not be updated.");
        return false;
      }
      setWorkspace(result.data);
      setDraft(createDraft(result.data));
      setStatus(result.data.status === "submitted" ? "submitted" : "draft");
      setAudit(await api.elevatePracticeAudit(assessmentId));
      setMessage("Elevate Learning and Innovation record updated and audit history recorded.");
      setEditReason(""); clearAdminNavigation();
      return true;
    } finally { setIsSaving(false); }
  }

  async function deleteAdminRecord() {
    if (!workspace?.recordId || !deletionReason.trim()) {
      if (!workspace?.recordId) setMessage("This historical assessment is not linked to a system record and cannot be archived here.");
      return;
    }
    setIsSaving(true);
    try {
      const result = await api.archiveAdminRecord(workspace.recordId, deletionReason.trim());

      if (!result.ok) {
        setMessage(result.message ?? "The record could not be archived.");
        return;
      }
      onDeleted();
    } finally { setIsSaving(false); }
  }

  if (!workspace || !draft) {
    return <section className="panel"><Button icon={ArrowLeft} onClick={() => void confirmUnsavedNavigation().then(leave => { if (leave) onBack(); })}>Back to records</Button><p className="muted-copy">{message || "Loading record..."}</p></section>;
  }

  return (
    <fieldset disabled={isSaving} style={{ display: "contents" }}><div className="route-stack">
      <div className="admin-record-editor-heading">
        <Button icon={ArrowLeft} onClick={() => void confirmUnsavedNavigation().then(leave => { if (leave) onBack(); })}>Back to records</Button>
        <Button disabled={isSaving} icon={Trash2} onClick={() => setIsConfirmingDelete(true)} variant="danger">Delete record</Button>
      </div>
      {isConfirmingDelete ? (
        <div className="admin-reason-dialog" role="dialog" aria-modal="true" aria-label="Delete Elevate Learning and Innovation record">
          <div>
            <div className="panel-heading"><h2>Archive record</h2><button className="icon-button" onClick={() => setIsConfirmingDelete(false)} title="Close" type="button"><X size={16} /></button></div>
            <p>This removes the record from profiles and reporting while retaining its audit history.</p>
            <label className="entry-field"><span>Reason <strong>Required</strong></span><textarea autoFocus onChange={(event) => setDeletionReason(event.target.value)} rows={4} value={deletionReason} /></label>
            <div className="toolbar"><Button icon={X} onClick={() => setIsConfirmingDelete(false)}>Cancel</Button><Button disabled={isSaving || !deletionReason.trim()} icon={Trash2} onClick={() => void deleteAdminRecord()} variant="danger">Archive record</Button></div>
          </div>
        </div>
      ) : null}
      {message ? <div className="notice-row" role="alert">{message}</div> : null}
      <section className="panel"><label className="entry-field"><span>Reason for changes <strong>Required</strong></span><textarea value={editReason} onChange={(event) => setEditReason(event.target.value)} rows={2} maxLength={2000} /></label><p className="muted-copy">Changes are recorded in the audit history and a submitted assessment will need validation again.</p></section>
      <AssessmentEditor
        adminStatus={status}
        draft={draft}
        isSaving={isSaving}
        onAdminStatusChange={setStatus}
        onChange={setDraft}
        onSave={() => void saveAdminRecord()}
        onStepChange={setStep}
        onSubmit={() => void saveAdminRecord()}
        step={step}
        workspace={workspace}
      />
      <section className="panel">
        <div className="panel-heading"><h2>Full audit history</h2><span>{audit.length} events</span></div>
        <div className="audit-history-list">
          {audit.length === 0 ? <p className="muted-copy">No audit events have been recorded.</p> : audit.map((entry) => (
            <details key={entry.id}>
              <summary><span><strong>{formatAuditAction(entry.action)}</strong><small>{entry.summary ?? "No summary"}</small></span><span>{entry.actorName}<small>{formatDate(entry.createdAt)}</small></span></summary>
              <div className="audit-change-grid"><div><strong>Before</strong><pre>{formatAuditJson(entry.beforeJson)}</pre></div><div><strong>After</strong><pre>{formatAuditJson(entry.afterJson)}</pre></div></div>
            </details>
          ))}
        </div>
      </section>
    </div></fieldset>
  );
}

function AssessmentEditor({
  workspace,
  draft,
  step,
  isSaving,
  onChange,
  onStepChange,
  onSave,
  onSubmit,
  adminStatus,
  onAdminStatusChange,
  submittedCorrection = false
}: {
  workspace: ElevatePracticeWorkspace;
  draft: PracticeDraft;
  step: number;
  isSaving: boolean;
  onChange: (next: PracticeDraft) => void;
  onStepChange: (next: number) => void;
  onSave: () => void;
  onSubmit: () => void;
  adminStatus?: "draft" | "submitted";
  onAdminStatusChange?: (status: "draft" | "submitted") => void;
  submittedCorrection?: boolean;
}) {
  const livStep = workspace.areas.length;
  const activeArea = step < workspace.areas.length ? workspace.areas[step] : null;
  const totalStatements = workspace.areas.reduce((total, area) => total + area.statements.length, 0);
  const completed = workspace.areas.reduce(
    (total, area) => total + area.statements.filter((statement) => draft.ratings[statement.id]).length,
    0
  );
  const percentage = totalStatements ? Math.round((completed / totalStatements) * 100) : 0;

  function updateLiv(updates: Partial<LivInformationDraft>) {
    onChange({ ...draft, livInformation: { ...draft.livInformation, ...updates } });
  }

  return (
    <fieldset disabled={isSaving} style={{ display: "contents" }}><>
      <section className="practice-context-band">
        <div><span>Staff member</span><strong>{workspace.staffName}</strong></div>
        <div><span>Faculty</span><strong>{workspace.facultyName ?? "Not assigned"}</strong></div>
        <div><span>Team</span><strong>{workspace.teamName ?? "Not assigned"}</strong></div>
        <div><span>Academic year</span><strong>{workspace.academicYear}</strong></div>
        <div><span>Status</span><strong>{adminStatus === "submitted" || workspace.status === "submitted" ? "Submitted" : adminStatus === "draft" || workspace.status === "draft" ? "Draft" : "Not started"}</strong></div>
      </section>
      <section className="practice-progress-band" aria-label="Assessment progress">
        <div><strong>{completed}/{totalStatements}</strong><span>statements rated</span></div>
        <div className="practice-progress-track"><span style={{ width: `${percentage}%` }} /></div><span>{percentage}%</span>
      </section>
      <div className="practice-editor-layout">
        <aside className="practice-step-list" aria-label="Assessment sections">
          {workspace.areas.map((area, index) => (
            <button className={step === index ? "is-active" : ""} key={area.areaKey} onClick={() => onStepChange(index)} type="button">
              <span>{index + 1}</span><strong>{area.name}</strong>{area.statements.every((statement) => draft.ratings[statement.id]) ? <Check size={15} aria-label="Complete" /> : null}
            </button>
          ))}
          <button className={step === livStep ? "is-active" : ""} onClick={() => onStepChange(livStep)} type="button"><span>{livStep + 1}</span><strong>LIV Information</strong></button>
        </aside>
        <div className="practice-editor-content">
          {activeArea ? (
            <div className="practice-area-section">
              <div className="panel-heading"><div><p className="eyebrow">{activeArea.category}</p><h2>{activeArea.name}</h2></div><span>{activeArea.statements.filter((statement) => draft.ratings[statement.id]).length}/{activeArea.statements.length} rated</span></div>
              <section className="practice-rubric-reference" aria-label="Elevate Learning and Innovation rubric reference">
                <h3>Rubric reference</h3>
                <div>
                  {workspace.ratingScale.filter((rating) => rating.isActive).map((rating) => (
                    <div key={rating.id} style={{ borderLeftColor: rating.colorHex ?? "#60736b" }}>
                      <i aria-hidden="true" style={{ background: rating.colorHex ?? "#60736b" }} />
                      <span><strong>{rating.descriptor}</strong><small>{rating.meaning}</small></span>
                    </div>
                  ))}
                </div>
              </section>
              <div className="practice-statement-list">
                <div className="panel-heading"><h3>Teaching and learning statements</h3><span>Choose one response per statement</span></div>
                {activeArea.statements.map((statement, index) => (
                  <div className="practice-statement" key={statement.id}>
                    <p><span>{index + 1}</span>{statement.text}</p>
                    <div className="likert-control" role="group" aria-label={`Response for ${statement.text}`}>
                      {workspace.ratingScale.filter((rating) => rating.isActive).map((rating) => (
                        <button
                          aria-pressed={draft.ratings[statement.id] === rating.id}
                          className={draft.ratings[statement.id] === rating.id ? "is-selected" : ""}
                          key={rating.id}
                          onClick={() => onChange({ ...draft, ratings: { ...draft.ratings, [statement.id]: rating.id } })}
                          style={{ "--rating-color": rating.colorHex ?? "#60736b" } as CSSProperties}
                          type="button"
                        >
                          <i aria-hidden="true" />
                          <strong>{rating.descriptor}</strong>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <LivInformationEditor information={draft.livInformation} onChange={updateLiv} ratings={draft.ratings} workspace={workspace} />
          )}
          <div className="practice-editor-actions">
            <Button disabled={step === 0} icon={ArrowLeft} onClick={() => onStepChange(Math.max(0, step - 1))}>Previous</Button>
            <div className="toolbar">
              {submittedCorrection || (adminStatus && onAdminStatusChange) ? (
                <>
                  {onAdminStatusChange ? <label className="admin-elevate-status"><span>Record status</span><select onChange={(event) => onAdminStatusChange(event.target.value as "draft" | "submitted")} value={adminStatus}><option value="draft">Draft</option><option value="submitted">Submitted</option></select></label> : <span className="muted-copy">Saves for validation · changes are audited</span>}
                  {step < livStep ? <Button icon={ArrowRight} onClick={() => onStepChange(step + 1)}>Next</Button> : null}
                  <Button disabled={isSaving} icon={Save} onClick={onSave} variant="primary">{isSaving ? "Saving..." : "Save changes"}</Button>
                </>
              ) : (
                <>
                  <Button disabled={isSaving} icon={Save} onClick={onSave}>Save draft</Button>
                  {step < livStep ? <Button icon={ArrowRight} onClick={() => onStepChange(step + 1)} variant="primary">Next</Button> : <Button disabled={isSaving} icon={Send} onClick={onSubmit} variant="primary">Submit for validation</Button>}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </></fieldset>
  );
}

function LivInformationEditor({ information, onChange, ratings, workspace }: {
  information: LivInformationDraft;
  onChange: (updates: Partial<LivInformationDraft>) => void;
  ratings: Record<string, string>;
  workspace: ElevatePracticeWorkspace;
}) {
  const secondaryOther = information.secondaryFocusKey === "other";
  const recommendedAreas = recommendedLivAreas(workspace, ratings);
  const preferredMonthOptions = livPreferredMonthOptions(workspace.academicYear);
  return (
    <div className="practice-area-section">
      <div className="panel-heading"><div><p className="eyebrow">Learning, Innovation and Vision visit</p><h2>LIV Information</h2></div><span>Supports your future LIV</span></div>
      <section className="practice-liv-recommendations" aria-label="Recommended LIV focus areas">
        <div><strong>Recommended focus areas</strong><span>Based on your answers</span></div>
        <ol>{recommendedAreas.length ? recommendedAreas.map((area) => <li key={area.areaKey}>{area.name}</li>) : <li>Complete the ELI statements to see recommendations.</li>}</ol>
      </section>
      <div className="form-grid form-grid-two">
        <label className="entry-field">
          <span>Preferred month</span>
          <select onChange={(event) => onChange({ preferredVisitMonth: event.target.value })} value={information.preferredVisitMonth ?? ""}>
            <option value="">Select preferred month</option>
            {preferredMonthOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <small>The Teaching and Learning team will attempt to accommodate your preferred month where possible, but this cannot be guaranteed.</small>
        </label>
        <label className="entry-field"><span>Primary focus</span><select onChange={(event) => onChange({ primaryFocusKey: event.target.value })} value={information.primaryFocusKey ?? ""}><option value="">Select primary focus</option>{workspace.livInformation.focusOptions.filter((option) => option.key !== "other").map((option) => <option key={option.key} value={option.key}>{option.name}</option>)}</select></label>
        <label className="entry-field"><span>Secondary focus <small>Optional</small></span><select onChange={(event) => onChange({ secondaryFocusKey: event.target.value, secondaryFocusOther: event.target.value === "other" ? information.secondaryFocusOther : "" })} value={information.secondaryFocusKey ?? ""}><option value="">No secondary focus</option>{workspace.livInformation.focusOptions.map((option) => <option key={option.key} value={option.key}>{option.name}</option>)}</select></label>
      </div>
      {secondaryOther ? <label className="entry-field"><span>Other secondary focus</span><input onChange={(event) => onChange({ secondaryFocusOther: event.target.value })} value={information.secondaryFocusOther ?? ""} /></label> : null}
      <label className="entry-field"><span>What would you like to achieve through your LIV?</span>
        <div className="practice-liv-guidance">
          <p>Have you considered a specific area of your practice you would like to develop, test or receive feedback on?</p>
          <p>Think about:</p>
          <ul><li>What you want to improve or explore</li><li>Why this matters for your learners</li><li>What you would like the observer to focus on</li><li>What success or improvement might look like</li></ul>
          <p>Include any particular strategies, approaches or learner groups you would like the LIV to consider.</p>
        </div>
        <textarea onChange={(event) => onChange({ desiredOutcome: event.target.value })} rows={8} value={information.desiredOutcome ?? ""} />
      </label>
    </div>
  );
}

function ElevatePracticeProgressView() {
  const [records, setRecords] = useState<ElevatePracticeProgress[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [faculty, setFaculty] = useState("all");
  const [resultStaffId, setResultStaffId] = useState("");

  useEffect(() => { api.elevatePracticeProgress().then(setRecords).finally(() => setIsLoading(false)); }, []);
  const faculties = useMemo(() => Array.from(new Map(records.filter((record) => record.facultyCode).map((record) => [record.facultyCode, record.facultyName])).entries()), [records]);
  const filtered = records.filter((record) => {
    const query = search.trim().toLowerCase();
    return (status === "all" || record.status === status)
      && (faculty === "all" || record.facultyCode === faculty)
      && (!query || `${record.staffName} ${record.externalId} ${record.email}`.toLowerCase().includes(query));
  });
  if (resultStaffId) return <ElevatePracticeResultPage onBack={() => setResultStaffId("")} staffId={resultStaffId} />;

  return (
    <>
      <section className="kpi-strip" aria-label="Assessment completion summary">
        <div className="kpi"><span>Total active staff</span><strong>{records.length}</strong></div>
        <div className="kpi kpi-amber"><span>Not started</span><strong>{records.filter((record) => record.status === "not_started").length}</strong></div>
        <div className="kpi kpi-blue"><span>In draft</span><strong>{records.filter((record) => record.status === "draft").length}</strong></div>
        <div className="kpi kpi-green"><span>Submitted</span><strong>{records.filter((record) => record.status === "submitted").length}</strong></div>
      </section>
      <section className="panel">
        <div className="panel-heading"><h2>Completion overview</h2><span>{records[0]?.academicYear ?? "Current academic year"}</span></div>
        <div className="filter-toolbar">
          <label className="search-box"><Search size={16} aria-hidden="true" /><input onChange={(event) => setSearch(event.target.value)} placeholder="Search staff" value={search} /></label>
          <label><span>Status</span><select onChange={(event) => setStatus(event.target.value)} value={status}><option value="all">All statuses</option><option value="not_started">Not started</option><option value="draft">Draft</option><option value="submitted">Submitted</option></select></label>
          <label><span>Faculty</span><select onChange={(event) => setFaculty(event.target.value)} value={faculty}><option value="all">All faculties</option>{faculties.map(([code, name]) => <option key={code} value={code}>{code} - {name}</option>)}</select></label>
        </div>
        <div className="table-shell"><table><thead><tr><th>Staff member</th><th>Faculty</th><th>Team</th><th>Status</th><th>Last activity</th><th>View</th></tr></thead><tbody>
          {isLoading ? <tr><td colSpan={6}>Loading completion data...</td></tr> : filtered.length === 0 ? <tr><td colSpan={6}>No staff match these filters.</td></tr> : filtered.map((record) => (
            <tr key={record.staffId}><td><strong>{record.staffName}</strong><small className="table-subline">{record.externalId}</small></td><td>{record.facultyCode ?? "Unassigned"}</td><td>{record.teamCode ?? "Unassigned"}</td><td><span className={`status-pill ${practiceStatusClass(record.status)}`}>{practiceStatusLabel(record.status)}</span></td><td>{record.submittedAt ? formatDate(record.submittedAt) : record.updatedAt ? formatDate(record.updatedAt) : "No activity"}</td><td>{record.status === "submitted" ? <button className="icon-button" onClick={() => setResultStaffId(record.staffId)} title="View submitted result" type="button"><Eye size={16} aria-hidden="true" /></button> : "-"}</td></tr>
          ))}
        </tbody></table></div>
      </section>
    </>
  );
}

function ElevatePracticeValidationView() {
  const [records, setRecords] = useState<ElevatePracticeValidationProgress[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState<ElevatePracticeValidationProgress | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setMessage("");
    api.elevatePracticeValidationProgress()
      .then((result) => { if (!cancelled) setRecords(result); })
      .catch(() => { if (!cancelled) setMessage("Validation progress could not be loaded. Please try again."); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [refresh]);
  if (selected) return <ElevatePracticeResultPage staffId={selected.staffId} recordId={selected.recordId} backLabel="Back to validation overview" onBack={() => { setSelected(null); setRefresh((value) => value + 1); }} />;
  const filtered = records.filter((record) => (status === "all" || record.validationStatus === status)
    && (!search.trim() || `${record.staffName} ${record.externalId} ${record.facultyName} ${record.teamName}`.toLowerCase().includes(search.trim().toLowerCase())));
  return <>
    <section className="kpi-strip" aria-label="Programme leader validation summary">
      <div className="kpi"><span>Staff in your scope</span><strong>{records.length}</strong></div>
      <div className="kpi kpi-amber"><span>Awaiting validation</span><strong>{records.filter((record) => record.validationStatus === "pending").length}</strong></div>
      <div className="kpi kpi-blue"><span>Returned for amendments</span><strong>{records.filter((record) => record.validationStatus === "returned").length}</strong></div>
      <div className="kpi kpi-green"><span>Validated</span><strong>{records.filter((record) => record.validationStatus === "validated").length}</strong></div>
    </section>
    <section className="panel">
      <div className="panel-heading"><div><h2>Programme leader validation</h2><p className="muted-copy">Review each response, validate the result or return it with feedback. Changes and decisions are tracked.</p></div><Button disabled={isLoading} onClick={() => setRefresh((value) => value + 1)}>Refresh</Button></div>
      {message ? <div className="notice-row" role="alert">{message}</div> : null}
      <div className="filter-toolbar">
        <label className="search-box"><Search size={16} aria-hidden="true" /><input aria-label="Search validation staff" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search staff, faculty or team" /></label>
        <label><span>Validation status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="pending">Awaiting validation</option><option value="returned">Returned for amendments</option><option value="validated">Validated</option><option value="draft">Not yet submitted</option></select></label>
      </div>
      <div className="table-shell"><table><thead><tr><th>Staff member</th><th>Faculty / team</th><th>Validation</th><th>Last review</th><th>Open</th></tr></thead><tbody>
        {isLoading ? <tr><td colSpan={5}>Loading validation progress...</td></tr> : filtered.length === 0 ? <tr><td colSpan={5}>No staff match these filters.</td></tr> : filtered.map((record) => <tr key={record.staffId}>
          <td><strong>{record.staffName}</strong><small className="table-subline">{record.externalId}</small></td>
          <td>{record.facultyName ?? "Unassigned"}<small className="table-subline">{record.teamName ?? "Unassigned"}</small></td>
          <td><span className={`status-pill ${validationStatusClass(record.validationStatus)}`}>{validationStatusLabel(record.validationStatus)}</span>{record.feedback ? <small className="table-subline">{record.feedback}</small> : null}</td>
          <td>{record.reviewedByName ?? "Not reviewed"}{record.reviewedAt ? <small className="table-subline">{formatDate(record.reviewedAt)}</small> : null}</td>
          <td>{record.assessmentId && (record.status === "submitted" || record.validationStatus === "returned") ? <Button icon={Eye} onClick={() => setSelected(record)}>Review</Button> : practiceStatusLabel(record.status)}</td>
        </tr>)}
      </tbody></table></div>
    </section>
  </>;
}

export function ElevatePracticeResultPage({ staffId, recordId, onBack, backLabel = "Back to Staff Profile" }: { staffId: string; recordId?: string; onBack: () => void; backLabel?: string }) {
  const [workspace, setWorkspace] = useState<ElevatePracticeWorkspace | null>(null);
  const [message, setMessage] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setWorkspace(null);
    setIsEditing(false);
    setMessage("");
    (recordId ? api.elevatePracticeRecord(recordId) : api.elevatePracticeResult(staffId))
      .then((result) => { if (!cancelled) setWorkspace(result); })
      .catch(() => { if (!cancelled) setMessage("The Elevate Learning and Innovation result could not be loaded."); });
    return () => { cancelled = true; };
  }, [recordId, staffId]);
  if (!workspace) return <section className="panel"><Button icon={ArrowLeft} onClick={() => void confirmUnsavedNavigation().then(leave => { if (leave) onBack(); })}>{backLabel}</Button><p className="muted-copy">{message || "Loading assessment result..."}</p></section>;
  if (isEditing && workspace.canEdit && workspace.assessmentId) {
    return <ElevatePracticeProfileEditor onBack={() => setIsEditing(false)} onSaved={(result) => { setWorkspace(result); setIsEditing(false); }} staffId={workspace.staffId} workspace={workspace} />;
  }
  return <ElevatePracticeResult onBack={onBack} backLabel={backLabel} onWorkspaceChange={setWorkspace} onEdit={workspace.canEdit && workspace.assessmentId ? () => setIsEditing(true) : undefined} workspace={workspace} />;
}

function ElevatePracticeProfileEditor({ staffId, workspace, onBack, onSaved }: { staffId: string; workspace: ElevatePracticeWorkspace; onBack: () => void; onSaved: (workspace: ElevatePracticeWorkspace) => void }) {
  const [draft, setDraft] = useState(() => createDraft(workspace));
  const [step, setStep] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [editReason, setEditReason] = useState("");
  const [staffPresent, setStaffPresent] = useState(false);
  const clearNavigation = useUnsavedChanges({ label: "ELI correction with staff member", saving: isSaving,
    dirty: JSON.stringify(draft) !== JSON.stringify(createDraft(workspace)) || Boolean(editReason) || staffPresent,
    onSave: () => save(), onDiscard: () => { setDraft(createDraft(workspace)); setEditReason(""); setStaffPresent(false); } });

  async function save(): Promise<boolean> {
    if (!workspace.assessmentId) return false;
    if (!editReason.trim() || !staffPresent) {
      setMessage("Enter a reason and confirm the staff member is present before saving changes.");
      return false;
    }
    setIsSaving(true);
    try {
      setMessage("");
      const result = await api.saveStaffElevatePracticeRecord(staffId, workspace.assessmentId, { ...toAdminSaveRequest(workspace, draft, "submitted"), editReason: editReason.trim(), staffPresent });

      if (!result.ok || !result.data) {
        setMessage(result.message ?? "The submitted assessment could not be updated.");
        return false;
      }
      clearNavigation(); onSaved(result.data);
      return true;
    } finally { setIsSaving(false); }
  }

  return <fieldset disabled={isSaving} style={{ display: "contents" }}><div className="route-stack"><div><Button disabled={isSaving} icon={ArrowLeft} onClick={() => void confirmUnsavedNavigation().then(leave => { if (leave) onBack(); })}>Back to report</Button></div>{message ? <div className="notice-row" role="alert">{message}</div> : null}<section className="panel practice-validation-panel"><h2>Edit with the staff member</h2><p>Review the responses together on this device. Saving records who made the changes and returns the result to awaiting validation.</p><label className="entry-field"><span>Reason for changes <strong>Required</strong></span><textarea value={editReason} onChange={(event) => setEditReason(event.target.value)} rows={3} maxLength={2000} /></label><label className="practice-validation-confirm"><input type="checkbox" checked={staffPresent} onChange={(event) => setStaffPresent(event.target.checked)} /><span>The staff member is present and we have reviewed these changes together.</span></label></section><AssessmentEditor submittedCorrection draft={draft} isSaving={isSaving} onChange={setDraft} onSave={() => void save()} onStepChange={setStep} onSubmit={() => void save()} step={step} workspace={workspace} /></div></fieldset>;
}

function ElevatePracticeResult({ workspace, onBack, onEdit, onWorkspaceChange, backLabel = "Back to Staff Profile" }: { workspace: ElevatePracticeWorkspace; onBack?: () => void; onEdit?: () => void; onWorkspaceChange?: (workspace: ElevatePracticeWorkspace) => void; backLabel?: string }) {
  const [expandedAreas, setExpandedAreas] = useState<Set<string>>(() => new Set());
  const allExpanded = workspace.areas.length > 0 && workspace.areas.every((area) => expandedAreas.has(area.areaKey));
  const optionName = (key: string | undefined, options: Array<{ key: string; name: string }>) => options.find((option) => option.key === key)?.name ?? "Not provided";
  return (
    <div className="practice-result">
      {onBack || onEdit ? <div className="toolbar">{onBack ? <Button icon={ArrowLeft} onClick={() => void confirmUnsavedNavigation().then(leave => { if (leave) onBack(); })}>{backLabel}</Button> : null}{onEdit ? <Button icon={Pencil} onClick={onEdit} variant="primary">Edit with staff member</Button> : null}</div> : null}
      <section className="practice-result-header">
        <div><p className="eyebrow">{workspace.status === "submitted" ? "Submitted self-assessment" : "Draft self-assessment"}</p><h2>{workspace.staffName}</h2><p>{workspace.facultyName ?? "No faculty"} · {workspace.teamName ?? "No team"}</p></div>
        <div className="practice-result-score"><span>Overall profile</span><strong>{workspace.overallJudgement ?? "Not yet rated"}</strong><small>Rubric outcome</small></div>
        <div className="practice-result-lock"><LockKeyhole size={18} aria-hidden="true" /><span>{workspace.status === "submitted" ? "Locked" : "Open for amendments"}</span><small>{workspace.academicYear}{workspace.submittedAt ? ` · ${formatDate(workspace.submittedAt)}` : ""}</small></div>
      </section>
      <section className="panel">
        <div className="panel-heading practice-responses-heading"><div><h2>Practice outcomes and responses</h2><p className="muted-copy">Expand a section to view the response to every statement.</p></div><Button onClick={() => setExpandedAreas(allExpanded ? new Set() : new Set(workspace.areas.map((area) => area.areaKey)))}>{allExpanded ? "Collapse all responses" : "Show all responses"}</Button></div>
        <div className="practice-response-sections">
          {workspace.areas.map((area) => (
            <details key={area.areaKey} open={expandedAreas.has(area.areaKey)}>
              <summary onClick={(event) => { event.preventDefault(); setExpandedAreas((current) => { const next = new Set(current); if (next.has(area.areaKey)) next.delete(area.areaKey); else next.add(area.areaKey); return next; }); }}>
                <span><strong>{area.name}</strong><small>{area.statements.filter((statement) => statement.descriptorId).length} of {area.statements.length} statements answered</small></span>
                <strong className="practice-section-outcome">{area.judgement ?? "Not yet rated"}</strong>
              </summary>
              <ol className="practice-statement-responses">
                {area.statements.map((statement) => {
                  const rating = workspace.ratingScale.find((item) => item.id === statement.descriptorId);
                  return <li key={statement.id}><p>{statement.text}</p><div className="practice-saved-response" style={{ borderLeftColor: rating?.colorHex ?? "var(--line)" }}><span>Recorded response</span><strong>{rating?.descriptor ?? (statement.descriptorId ? "Response wording unavailable" : "Not recorded")}</strong>{rating?.meaning ? <small>{rating.meaning}</small> : null}</div></li>;
                })}
              </ol>
              {area.reflection ? <div className="practice-saved-reflection"><strong>{area.reflectionPrompt || "Reflection"}</strong><p>{area.reflection}</p></div> : null}
            </details>
          ))}
        </div>
      </section>
      <section className="panel practice-liv-summary">
        <div className="panel-heading"><div><p className="eyebrow">Learning, Innovation and Vision</p><h2>LIV information</h2></div><span>Ready for case creation</span></div>
        <div className="liv-information-grid">
          <div><span>Preferred month</span><strong>{formatPreferredMonth(workspace.livInformation.preferredVisitMonth)}</strong></div>
          <div><span>Primary focus</span><strong>{optionName(workspace.livInformation.primaryFocusKey, workspace.livInformation.focusOptions)}</strong></div>
          <div><span>Secondary focus</span><strong>{workspace.livInformation.secondaryFocusKey === "other" ? workspace.livInformation.secondaryFocusOther ?? "Other" : optionName(workspace.livInformation.secondaryFocusKey, workspace.livInformation.focusOptions)}</strong></div>
        </div>
        <div className="practice-liv-outcome"><span>What I would like to achieve through my LIV</span><p>{workspace.livInformation.desiredOutcome || "No desired outcome recorded."}</p></div>
      </section>
      <ValidationHistory workspace={workspace} onWorkspaceChange={onWorkspaceChange} />
    </div>
  );
}

function ValidationHistory({ workspace, onWorkspaceChange }: { workspace: ElevatePracticeWorkspace; onWorkspaceChange?: (workspace: ElevatePracticeWorkspace) => void }) {
  const [note, setNote] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const validation = workspace.validation;
  if (!validation || (validation.status === "draft" && validation.history.length === 0)) return null;
  const canDecide = validation.canValidate && workspace.status === "submitted" && validation.status === "pending" && !!onWorkspaceChange;
  async function review(action: "validate" | "return") {
    if (!workspace.assessmentId || !validation?.rowVersion || !onWorkspaceChange) {
      setMessage("Refresh the assessment before recording a decision.");
      return;
    }
    if (action === "return" && !note.trim()) {
      setMessage("Describe which statements need to change before returning the assessment.");
      return;
    }
    if (action === "validate" && !reviewed) {
      setMessage("Confirm you have reviewed every response before validating the result.");
      return;
    }
    setIsSaving(true);
    try {
      setMessage("");
      const result = await api.reviewElevatePractice(workspace.staffId, workspace.assessmentId, { action, note: note.trim() || undefined, rowVersion: validation.rowVersion });

      if (!result.ok || !result.data) {
        setMessage(result.message ?? "The decision could not be saved. If someone else has changed the assessment, reopen it and review the latest responses before trying again.");
        return;
      }
      onWorkspaceChange(result.data);
      setNote("");
      setReviewed(false);
      setMessage(action === "validate" ? "Result validated and recorded." : "Returned to the staff member for amendments. Their assessment is now unlocked.");
    } finally { setIsSaving(false); }
  }
  return <fieldset disabled={isSaving} style={{ display: "contents" }}><section className="panel practice-validation-panel" aria-label="Assessment validation">
    <div className="panel-heading"><h2>Programme leader validation</h2><span className={`status-pill ${validationStatusClass(validation.status)}`}>{validationStatusLabel(validation.status)}</span></div>
    {validation.reviewedByName ? <p className="muted-copy">Last reviewed by {validation.reviewedByName}{validation.reviewedAt ? ` · ${formatDate(validation.reviewedAt)}` : ""}</p> : null}
    {validation.feedback ? <div className="practice-validation-feedback"><strong>{validation.status === "returned" ? "Amendments requested" : "Review feedback"}</strong><p>{validation.feedback}</p></div> : null}
    {validation.status === "returned" ? <p>The assessment is unlocked for the staff member to amend and resubmit for validation.</p> : validation.status === "pending" ? <p>Submitted responses are awaiting programme leader validation.</p> : null}
    {message ? <div className="notice-row" role="status">{message}</div> : null}
    {canDecide ? <>
      <label className="entry-field"><span>Review notes <small>Required when returning for amendments</small></span><textarea rows={4} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Identify the statements to discuss or amend, and explain why." /></label>
      <label className="practice-validation-confirm"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} /><span>I have reviewed every statement and the overall result with the available evidence.</span></label>
      <div className="toolbar"><Button disabled={isSaving || !note.trim()} onClick={() => void review("return")}>Return for amendments</Button><Button icon={Check} variant="primary" disabled={isSaving || !reviewed} onClick={() => void review("validate")}>{isSaving ? "Saving..." : "Validate result"}</Button></div>
    </> : null}
    <details className="practice-validation-history"><summary>Validation and amendment history ({validation.history.length})</summary>{validation.history.length ? <ol>{validation.history.map((event, index) => <li key={`${event.at}-${index}`}><div><strong>{validationActionLabel(event.action)}</strong><span>{event.actorName} · {formatDateTime(event.at)}</span></div>{event.note ? <p>{event.note}</p> : null}</li>)}</ol> : <p className="muted-copy">No validation decisions recorded yet.</p>}</details>
  </section></fieldset>;
}

function validationStatusLabel(status: string) { return ({ draft: "Not yet submitted", pending: "Awaiting validation", returned: "Returned for amendments", validated: "Validated" } as Record<string, string>)[status] ?? status; }
function validationStatusClass(status: string) { return status === "validated" ? "status-complete" : status === "pending" ? "status-overdue" : "status-draft"; }
function validationActionLabel(action: string) { return ({ validate: "Result validated", validated: "Result validated", return: "Returned for amendments", returned: "Returned for amendments", submitted: "Submitted for validation", resubmitted: "Resubmitted for validation", edited: "Assessment amended", staff_edit: "Amended with staff member", admin_edit: "Amended by administrator" } as Record<string, string>)[action] ?? formatAuditAction(action); }
function formatDateTime(value: string) { return new Date(value).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); }

function createDraft(workspace: ElevatePracticeWorkspace): PracticeDraft {
  return {
    ratings: Object.fromEntries(workspace.areas.flatMap((area) => area.statements.filter((statement) => statement.descriptorId).map((statement) => [statement.id, statement.descriptorId!] as const))),
    livInformation: {
      preferredVisitMonth: workspace.livInformation.preferredVisitMonth,
      primaryFocusKey: workspace.livInformation.primaryFocusKey,
      secondaryFocusKey: workspace.livInformation.secondaryFocusKey,
      secondaryFocusOther: workspace.livInformation.secondaryFocusOther,
      desiredOutcome: workspace.livInformation.desiredOutcome
    }
  };
}

function recommendedLivAreas(workspace: ElevatePracticeWorkspace, ratings: Record<string, string>) {
  const scaleOrder = new Map(workspace.ratingScale.map((rating) => [rating.id, rating.displayOrder]));
  return workspace.areas
    .map((area) => {
      const scores = area.statements.map((statement) => scaleOrder.get(ratings[statement.id])).filter((score): score is number => score !== undefined);
      return { ...area, score: scores.length === area.statements.length ? scores.reduce((total, score) => total + score, 0) / scores.length : null };
    })
    .filter((area) => area.score !== null)
    .sort((left, right) => left.score! - right.score! || left.displayOrder - right.displayOrder)
    .slice(0, 2);
}

function toSaveRequest(workspace: ElevatePracticeWorkspace, draft: PracticeDraft, submit: boolean): SaveElevatePracticeAssessmentRequest {
  return {
    rowVersion: workspace.validation?.rowVersion,
    ratings: workspace.areas.flatMap((area) => area.statements
      .filter((statement) => draft.ratings[statement.id])
      .map((statement) => ({ areaId: area.id, statementId: statement.id, descriptorId: draft.ratings[statement.id] }))),
    reflections: [],
    livInformation: draft.livInformation,
    submit
  };
}

function toAdminSaveRequest(workspace: ElevatePracticeWorkspace, draft: PracticeDraft, status: "draft" | "submitted"): AdminSaveElevatePracticeAssessmentRequest {
  const request = toSaveRequest(workspace, draft, false);
  return { ratings: request.ratings, reflections: request.reflections, livInformation: request.livInformation, rowVersion: request.rowVersion, status };
}

function practiceStatusLabel(status: ElevatePracticeProgress["status"]) { return status === "not_started" ? "Not started" : status === "draft" ? "Draft" : "Submitted"; }
function practiceStatusClass(status: ElevatePracticeProgress["status"]) { return status === "not_started" ? "status-overdue" : status === "draft" ? "status-draft" : "status-complete"; }
function formatAuditAction(action: string) { return action.split(/[._]/).filter(Boolean).map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(" "); }
function formatAuditJson(value?: string) { if (!value) return "No record snapshot"; try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; } }
function formatDate(value: string) { return new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); }
function formatPreferredMonth(value?: string) { if (!value) return "Not provided"; const [year, month] = value.split("-").map(Number); return new Date(year, month - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" }); }
function livPreferredMonthOptions(academicYear: string) {
  const startYear = /^\d{4}/.exec(academicYear)?.[0] ?? String(new Date().getFullYear());
  return [
    { value: `${startYear}-09`, label: `September ${startYear}` },
    { value: `${startYear}-10`, label: `October ${startYear}` },
    { value: `${startYear}-11`, label: `November ${startYear}` },
    { value: `${startYear}-12`, label: `December ${startYear}` }
  ];
}
