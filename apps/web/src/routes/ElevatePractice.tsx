import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  LockKeyhole,
  Save,
  Search,
  Send,
  Trash2,
  X
} from "lucide-react";
import { Button } from "../design-system/Button";
import { ExportExcelButton } from "../components/ExportButtons";
import { api } from "../services/api";
import type {
  AdminSaveElevatePracticeAssessmentRequest,
  CurrentUser,
  ElevateLivInformation,
  ElevatePracticeAudit,
  ElevatePracticeProgress,
  ElevatePracticeWorkspace,
  SaveElevatePracticeAssessmentRequest
} from "../services/types";

type LivInformationDraft = Omit<ElevateLivInformation, "noticeOptions" | "focusOptions">;

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
  const [view, setView] = useState<"assessment" | "progress">("assessment");
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

  async function save(submit: boolean) {
    if (!workspace || !draft) return;
    if (submit && !window.confirm("Submit and lock this assessment for the academic year?")) return;

    setIsSaving(true);
    setMessage("");
    const result = await api.saveElevatePractice(toSaveRequest(workspace, draft, submit));
    setIsSaving(false);
    if (!result.ok || !result.data) {
      setMessage(result.message ?? "The assessment could not be saved.");
      return;
    }
    setWorkspace(result.data);
    setDraft(createDraft(result.data));
    setMessage(submit ? "Assessment submitted and locked." : "Draft saved.");
  }

  if (isLoading) return <p className="muted-copy">Loading Elevate Learning and Innovation...</p>;

  return (
    <div className="route-stack">
      <div className="route-header">
        <div><p className="eyebrow">Staff self-assessment</p><h1>Elevate Learning and Innovation</h1></div>
        <div className="toolbar">
          {user.permissions.includes("exports.create") ? <ExportExcelButton filters={{ academicYear: workspace?.academicYear }} moduleKey="elevate-practice" /> : null}
          {isAdmin ? (
            <div className="segmented-control" aria-label="Elevate Learning and Innovation view">
              <button className={view === "assessment" ? "is-active" : ""} onClick={() => setView("assessment")} type="button">My assessment</button>
              <button className={view === "progress" ? "is-active" : ""} onClick={() => setView("progress")} type="button">Completion overview</button>
            </div>
          ) : null}
        </div>
      </div>
      {message ? <div className="notice-row">{message}</div> : null}
      {view === "progress" && isAdmin ? <ElevatePracticeProgressView /> : workspace && draft ? (
        workspace.status === "submitted" ? <ElevatePracticeResult workspace={workspace} /> : (
          <AssessmentEditor
            draft={draft}
            isSaving={isSaving}
            onChange={setDraft}
            onSave={() => void save(false)}
            onStepChange={setStep}
            onSubmit={() => void save(true)}
            step={step}
            workspace={workspace}
          />
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

  async function saveAdminRecord() {
    if (!workspace || !draft) return;
    setIsSaving(true);
    setMessage("");
    const result = await api.saveAdminElevatePracticeRecord(assessmentId, toAdminSaveRequest(workspace, draft, status));
    setIsSaving(false);
    if (!result.ok || !result.data) {
      setMessage(result.message ?? "The record could not be updated.");
      return;
    }
    setWorkspace(result.data);
    setDraft(createDraft(result.data));
    setStatus(result.data.status === "submitted" ? "submitted" : "draft");
    setAudit(await api.elevatePracticeAudit(assessmentId));
    setMessage("Elevate Learning and Innovation record updated and audit history recorded.");
  }

  async function deleteAdminRecord() {
    if (!workspace?.recordId || !deletionReason.trim()) {
      if (!workspace?.recordId) setMessage("This historical assessment is not linked to a system record and cannot be archived here.");
      return;
    }
    setIsSaving(true);
    const result = await api.archiveAdminRecord(workspace.recordId, deletionReason.trim());
    setIsSaving(false);
    if (!result.ok) {
      setMessage(result.message ?? "The record could not be archived.");
      return;
    }
    onDeleted();
  }

  if (!workspace || !draft) {
    return <section className="panel"><Button icon={ArrowLeft} onClick={onBack}>Back to records</Button><p className="muted-copy">{message || "Loading record..."}</p></section>;
  }

  return (
    <div className="route-stack">
      <div className="admin-record-editor-heading">
        <Button icon={ArrowLeft} onClick={onBack}>Back to records</Button>
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
      {message ? <div className="notice-row">{message}</div> : null}
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
    </div>
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
  onAdminStatusChange
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
    <>
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
            <LivInformationEditor information={draft.livInformation} onChange={updateLiv} workspace={workspace} />
          )}
          <div className="practice-editor-actions">
            <Button disabled={step === 0} icon={ArrowLeft} onClick={() => onStepChange(Math.max(0, step - 1))}>Previous</Button>
            <div className="toolbar">
              {adminStatus && onAdminStatusChange ? (
                <>
                  <label className="admin-elevate-status"><span>Record status</span><select onChange={(event) => onAdminStatusChange(event.target.value as "draft" | "submitted")} value={adminStatus}><option value="draft">Draft</option><option value="submitted">Submitted</option></select></label>
                  {step < livStep ? <Button icon={ArrowRight} onClick={() => onStepChange(step + 1)}>Next</Button> : null}
                  <Button disabled={isSaving} icon={Save} onClick={onSave} variant="primary">{isSaving ? "Saving..." : "Save changes"}</Button>
                </>
              ) : (
                <>
                  <Button disabled={isSaving} icon={Save} onClick={onSave}>Save draft</Button>
                  {step < livStep ? <Button icon={ArrowRight} onClick={() => onStepChange(step + 1)} variant="primary">Next</Button> : <Button disabled={isSaving} icon={Send} onClick={onSubmit} variant="primary">Submit and lock</Button>}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function LivInformationEditor({ information, onChange, workspace }: {
  information: LivInformationDraft;
  onChange: (updates: Partial<LivInformationDraft>) => void;
  workspace: ElevatePracticeWorkspace;
}) {
  const secondaryOther = information.secondaryFocusKey === "other";
  return (
    <div className="practice-area-section">
      <div className="panel-heading"><div><p className="eyebrow">Learning, Innovation and Vision visit</p><h2>LIV Information</h2></div><span>Supports your future LIV</span></div>
      <div className="form-grid form-grid-two">
        <label className="entry-field"><span>Notice preference</span><select onChange={(event) => onChange({ noticePreferenceKey: event.target.value })} value={information.noticePreferenceKey ?? ""}><option value="">Select notice preference</option>{workspace.livInformation.noticeOptions.map((option) => <option key={option.key} value={option.key}>{option.name}</option>)}</select></label>
        <label className="entry-field"><span>Preferred month</span><input onChange={(event) => onChange({ preferredVisitMonth: event.target.value })} type="month" value={information.preferredVisitMonth ?? ""} /></label>
        <label className="entry-field"><span>Primary focus</span><select onChange={(event) => onChange({ primaryFocusKey: event.target.value })} value={information.primaryFocusKey ?? ""}><option value="">Select primary focus</option>{workspace.livInformation.focusOptions.filter((option) => option.key !== "other").map((option) => <option key={option.key} value={option.key}>{option.name}</option>)}</select></label>
        <label className="entry-field"><span>Secondary focus <small>Optional</small></span><select onChange={(event) => onChange({ secondaryFocusKey: event.target.value, secondaryFocusOther: event.target.value === "other" ? information.secondaryFocusOther : "" })} value={information.secondaryFocusKey ?? ""}><option value="">No secondary focus</option>{workspace.livInformation.focusOptions.map((option) => <option key={option.key} value={option.key}>{option.name}</option>)}</select></label>
      </div>
      {secondaryOther ? <label className="entry-field"><span>Other secondary focus</span><input onChange={(event) => onChange({ secondaryFocusOther: event.target.value })} value={information.secondaryFocusOther ?? ""} /></label> : null}
      <label className="entry-field"><span>What would you like to achieve through your LIV?</span><textarea onChange={(event) => onChange({ desiredOutcome: event.target.value })} rows={6} value={information.desiredOutcome ?? ""} /></label>
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

export function ElevatePracticeResultPage({ staffId, recordId, onBack }: { staffId: string; recordId?: string; onBack: () => void }) {
  const [workspace, setWorkspace] = useState<ElevatePracticeWorkspace | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let cancelled = false;
    (recordId ? api.elevatePracticeRecord(recordId) : api.elevatePracticeResult(staffId))
      .then((result) => { if (!cancelled) setWorkspace(result); })
      .catch(() => { if (!cancelled) setMessage("The Elevate Learning and Innovation result could not be loaded."); });
    return () => { cancelled = true; };
  }, [recordId, staffId]);
  if (!workspace) return <section className="panel"><Button icon={ArrowLeft} onClick={onBack}>Back to Staff Profile</Button><p className="muted-copy">{message || "Loading assessment result..."}</p></section>;
  return <ElevatePracticeResult onBack={onBack} workspace={workspace} />;
}

function ElevatePracticeResult({ workspace, onBack }: { workspace: ElevatePracticeWorkspace; onBack?: () => void }) {
  const optionName = (key: string | undefined, options: Array<{ key: string; name: string }>) => options.find((option) => option.key === key)?.name ?? "Not provided";
  return (
    <div className="practice-result">
      {onBack ? <div><Button icon={ArrowLeft} onClick={onBack}>Back to Staff Profile</Button></div> : null}
      <section className="practice-result-header">
        <div><p className="eyebrow">Submitted self-assessment</p><h2>{workspace.staffName}</h2><p>{workspace.facultyName ?? "No faculty"} · {workspace.teamName ?? "No team"}</p></div>
        <div className="practice-result-score"><span>Overall profile</span><strong>{workspace.overallJudgement ?? "Not yet rated"}</strong><small>Rubric outcome</small></div>
        <div className="practice-result-lock"><LockKeyhole size={18} aria-hidden="true" /><span>Locked</span><small>{workspace.academicYear}{workspace.submittedAt ? ` · ${formatDate(workspace.submittedAt)}` : ""}</small></div>
      </section>
      <section className="panel"><div className="panel-heading"><h2>Practice outcomes</h2><span>Section results</span></div><div className="practice-result-areas">{workspace.areas.map((area) => <div key={area.areaKey}><span>{area.name}</span><strong>{area.judgement ?? "Not yet rated"}</strong></div>)}</div></section>
      <section className="panel practice-liv-summary">
        <div className="panel-heading"><div><p className="eyebrow">Learning, Innovation and Vision</p><h2>LIV information</h2></div><span>Ready for case creation</span></div>
        <div className="liv-information-grid">
          <div><span>Notice preference</span><strong>{optionName(workspace.livInformation.noticePreferenceKey, workspace.livInformation.noticeOptions)}</strong></div>
          <div><span>Preferred month</span><strong>{formatPreferredMonth(workspace.livInformation.preferredVisitMonth)}</strong></div>
          <div><span>Primary focus</span><strong>{optionName(workspace.livInformation.primaryFocusKey, workspace.livInformation.focusOptions)}</strong></div>
          <div><span>Secondary focus</span><strong>{workspace.livInformation.secondaryFocusKey === "other" ? workspace.livInformation.secondaryFocusOther ?? "Other" : optionName(workspace.livInformation.secondaryFocusKey, workspace.livInformation.focusOptions)}</strong></div>
        </div>
        <div className="practice-liv-outcome"><span>What I would like to achieve through my LIV</span><p>{workspace.livInformation.desiredOutcome || "No desired outcome recorded."}</p></div>
      </section>
    </div>
  );
}

function createDraft(workspace: ElevatePracticeWorkspace): PracticeDraft {
  return {
    ratings: Object.fromEntries(workspace.areas.flatMap((area) => area.statements.filter((statement) => statement.descriptorId).map((statement) => [statement.id, statement.descriptorId!] as const))),
    livInformation: {
      noticePreferenceKey: workspace.livInformation.noticePreferenceKey,
      preferredVisitMonth: workspace.livInformation.preferredVisitMonth,
      primaryFocusKey: workspace.livInformation.primaryFocusKey,
      secondaryFocusKey: workspace.livInformation.secondaryFocusKey,
      secondaryFocusOther: workspace.livInformation.secondaryFocusOther,
      desiredOutcome: workspace.livInformation.desiredOutcome
    }
  };
}

function toSaveRequest(workspace: ElevatePracticeWorkspace, draft: PracticeDraft, submit: boolean): SaveElevatePracticeAssessmentRequest {
  return {
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
  return { ratings: request.ratings, reflections: request.reflections, livInformation: request.livInformation, status };
}

function practiceStatusLabel(status: ElevatePracticeProgress["status"]) { return status === "not_started" ? "Not started" : status === "draft" ? "Draft" : "Submitted"; }
function practiceStatusClass(status: ElevatePracticeProgress["status"]) { return status === "not_started" ? "status-overdue" : status === "draft" ? "status-draft" : "status-complete"; }
function formatAuditAction(action: string) { return action.split(/[._]/).filter(Boolean).map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(" "); }
function formatAuditJson(value?: string) { if (!value) return "No record snapshot"; try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; } }
function formatDate(value: string) { return new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); }
function formatPreferredMonth(value?: string) { if (!value) return "Not provided"; const [year, month] = value.split("-").map(Number); return new Date(year, month - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" }); }
