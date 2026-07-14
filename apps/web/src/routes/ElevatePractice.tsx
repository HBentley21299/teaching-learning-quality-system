import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ClipboardList,
  Eye,
  LockKeyhole,
  Save,
  Search,
  Send,
  Sparkles,
  Trash2,
  X
} from "lucide-react";
import { Button } from "../design-system/Button";
import { api } from "../services/api";
import type {
  AdminSaveElevatePracticeAssessmentRequest,
  CurrentUser,
  ElevatePracticeAudit,
  ElevatePracticePlan,
  ElevatePracticeProgress,
  ElevatePracticeWorkspace,
  SaveElevatePracticeAssessmentRequest
} from "../services/types";

type PracticeDraft = {
  ratings: Record<string, string>;
  reflections: Record<string, string>;
  strengths: string[];
  developments: string[];
  plans: Record<string, ElevatePracticePlan>;
};

export function ElevatePractice({
  user,
  onActionsChanged
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
    setIsLoading(true);
    api
      .elevatePracticeMe()
      .then((result) => {
        if (!cancelled) {
          setWorkspace(result);
          setDraft(createDraft(result));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMessage("The Elevate Your Practice assessment could not be loaded from the API.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function save(submit: boolean) {
    if (!workspace || !draft) {
      return;
    }

    if (submit && !window.confirm("Submit and lock this assessment for the academic year?")) {
      return;
    }

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
    setMessage(submit ? "Assessment submitted and locked. Two development actions have been created." : "Draft saved.");
    if (submit) {
      onActionsChanged();
    }
  }

  if (isLoading) {
    return <p className="muted-copy">Loading Elevate Your Practice...</p>;
  }

  return (
    <div className="route-stack">
      <div className="route-header">
        <div>
          <p className="eyebrow">Annual staff self-assessment</p>
          <h1>Elevate Your Practice</h1>
        </div>
        {isAdmin ? (
          <div className="segmented-control" aria-label="Elevate Your Practice view">
            <button className={view === "assessment" ? "is-active" : ""} onClick={() => setView("assessment")} type="button">
              My assessment
            </button>
            <button className={view === "progress" ? "is-active" : ""} onClick={() => setView("progress")} type="button">
              Completion overview
            </button>
          </div>
        ) : null}
      </div>

      {message ? <div className="notice-row">{message}</div> : null}

      {view === "progress" && isAdmin ? (
        <ElevatePracticeProgressView />
      ) : workspace && draft ? (
        workspace.status === "submitted" ? (
          <ElevatePracticeResult workspace={workspace} />
        ) : (
          <AssessmentEditor
            draft={draft}
            isSaving={isSaving}
            onChange={setDraft}
            onMessage={setMessage}
            onSave={() => void save(false)}
            onSubmit={() => void save(true)}
            onStepChange={setStep}
            step={step}
            workspace={workspace}
          />
        )
      ) : (
        <section className="panel">
          <p className="muted-copy">No assessment is available for this account.</p>
        </section>
      )}
    </div>
  );
}

export function ElevatePracticeAdminEditor({
  assessmentId,
  onBack,
  onDeleted
}: {
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
    Promise.all([
      api.adminElevatePracticeRecord(assessmentId),
      api.elevatePracticeAudit(assessmentId)
    ])
      .then(([record, history]) => {
        if (cancelled) {
          return;
        }
        setWorkspace(record);
        setDraft(createDraft(record));
        setStatus(record.status === "submitted" ? "submitted" : "draft");
        setAudit(history);
      })
      .catch(() => {
        if (!cancelled) {
          setMessage("The Elevate Your Practice record could not be loaded.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [assessmentId]);

  async function saveAdminRecord() {
    if (!workspace || !draft) {
      return;
    }

    setIsSaving(true);
    setMessage("");
    const result = await api.saveAdminElevatePracticeRecord(
      assessmentId,
      toAdminSaveRequest(workspace, draft, status)
    );
    setIsSaving(false);
    if (!result.ok || !result.data) {
      setMessage(result.message ?? "The record could not be updated.");
      return;
    }

    setWorkspace(result.data);
    setDraft(createDraft(result.data));
    setStatus(result.data.status === "submitted" ? "submitted" : "draft");
    setAudit(await api.elevatePracticeAudit(assessmentId));
    setMessage("Elevate Your Practice record updated and audit history recorded.");
  }

  async function deleteAdminRecord() {
    const recordId = workspace?.recordId;
    if (!recordId || !deletionReason.trim()) {
      if (!recordId) setMessage("This historical assessment is not linked to a system record and cannot be archived here.");
      return;
    }

    setIsSaving(true);
    const result = await api.archiveAdminRecord(recordId, deletionReason.trim());
    setIsSaving(false);
    if (!result.ok) {
      setMessage(result.message ?? "The record could not be archived.");
      return;
    }

    onDeleted();
  }

  if (!workspace || !draft) {
    return (
      <section className="panel">
        <Button icon={ArrowLeft} onClick={onBack}>Back to records</Button>
        <p className="muted-copy">{message || "Loading Elevate Your Practice record..."}</p>
      </section>
    );
  }

  return (
    <div className="route-stack">
      <div className="admin-record-editor-heading">
        <Button icon={ArrowLeft} onClick={onBack}>Back to records</Button>
        <Button disabled={isSaving} icon={Trash2} onClick={() => setIsConfirmingDelete(true)} variant="danger">Delete record</Button>
      </div>
      {isConfirmingDelete ? (
        <div className="admin-reason-dialog" role="dialog" aria-modal="true" aria-label="Delete Elevate Your Practice record">
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
        onMessage={setMessage}
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
              <summary>
                <span><strong>{formatAuditAction(entry.action)}</strong><small>{entry.summary ?? "No summary"}</small></span>
                <span>{entry.actorName}<small>{formatDate(entry.createdAt)}</small></span>
              </summary>
              <div className="audit-change-grid">
                <div><strong>Before</strong><pre>{formatAuditJson(entry.beforeJson)}</pre></div>
                <div><strong>After</strong><pre>{formatAuditJson(entry.afterJson)}</pre></div>
              </div>
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
  onMessage,
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
  onMessage: (message: string) => void;
  onSave: () => void;
  onSubmit: () => void;
  adminStatus?: "draft" | "submitted";
  onAdminStatusChange?: (status: "draft" | "submitted") => void;
}) {
  const profileStep = workspace.areas.length;
  const planStep = workspace.areas.length + 1;
  const totalStatements = workspace.areas.reduce((total, area) => total + area.statements.length, 0);
  const completedStatements = Object.keys(draft.ratings).length;
  const activeArea = step < workspace.areas.length ? workspace.areas[step] : null;

  function updateRating(statementId: string, descriptorId: string) {
    onChange({ ...draft, ratings: { ...draft.ratings, [statementId]: descriptorId } });
  }

  function updateReflection(areaKey: string, value: string) {
    onChange({ ...draft, reflections: { ...draft.reflections, [areaKey]: value } });
  }

  function toggleSelection(type: "strengths" | "developments", areaKey: string, maximum: number) {
    const current = draft[type];
    if (current.includes(areaKey)) {
      const next = current.filter((key) => key !== areaKey);
      const nextPlans = type === "developments"
        ? Object.fromEntries(Object.entries(draft.plans).filter(([key]) => next.includes(key)))
        : draft.plans;
      onChange({ ...draft, [type]: next, plans: nextPlans });
      return;
    }

    const conflicts = type === "strengths" ? draft.developments : draft.strengths;
    if (conflicts.includes(areaKey)) {
      onMessage("An area cannot be selected as both a strength and a development priority.");
      return;
    }

    if (current.length >= maximum) {
      onMessage(`You can select a maximum of ${maximum} ${type === "strengths" ? "strengths" : "development areas"}.`);
      return;
    }

    const next = [...current, areaKey];
    const nextPlans = type === "developments"
      ? { ...draft.plans, [areaKey]: draft.plans[areaKey] ?? emptyPlan(areaKey) }
      : draft.plans;
    onChange({ ...draft, [type]: next, plans: nextPlans });
  }

  function useSuggestions(type: "strengths" | "developments") {
    const ranked = workspace.areas
      .map((area) => ({ area, average: areaAveragePosition(area, draft, workspace) }))
      .filter((value): value is { area: ElevatePracticeWorkspace["areas"][number]; average: number } => value.average !== undefined);
    const excluded = type === "strengths" ? draft.developments : draft.strengths;
    const values = ranked
      .filter((value) => !excluded.includes(value.area.areaKey))
      .sort((left, right) => type === "strengths"
        ? right.average - left.average || left.area.displayOrder - right.area.displayOrder
        : left.average - right.average || right.area.displayOrder - left.area.displayOrder)
      .slice(0, type === "strengths" ? 3 : 2)
      .map((value) => value.area.areaKey);
    if (values.length < (type === "strengths" ? 3 : 2)) {
      onMessage("Complete all statement ratings before using the suggested areas.");
      return;
    }
    const nextPlans = type === "developments"
      ? Object.fromEntries(values.map((key) => [key, draft.plans[key] ?? emptyPlan(key)]))
      : draft.plans;
    onChange({ ...draft, [type]: values, plans: nextPlans });
  }

  function updatePlan(areaKey: string, updates: Partial<ElevatePracticePlan>) {
    onChange({
      ...draft,
      plans: {
        ...draft.plans,
        [areaKey]: { ...(draft.plans[areaKey] ?? emptyPlan(areaKey)), ...updates }
      }
    });
  }

  return (
    <>
      <section className="practice-context-band">
        <div>
          <span>Staff member</span>
          <strong>{workspace.staffName}</strong>
        </div>
        <div>
          <span>Faculty</span>
          <strong>{workspace.facultyName ?? "Not assigned"}</strong>
        </div>
        <div>
          <span>Team</span>
          <strong>{workspace.teamName ?? "Not assigned"}</strong>
        </div>
        <div>
          <span>Academic year</span>
          <strong>{workspace.academicYear}</strong>
        </div>
        <div>
          <span>Status</span>
          <strong>{adminStatus ? (adminStatus === "submitted" ? "Submitted" : "Draft") : workspace.status === "submitted" ? "Submitted" : workspace.status === "draft" ? "Draft" : "Not started"}</strong>
        </div>
      </section>

      <section className="practice-progress-band" aria-label="Assessment progress">
        <div>
          <strong>{completedStatements}/{totalStatements}</strong>
          <span>statements rated</span>
        </div>
        <div className="practice-progress-track"><span style={{ width: `${Math.round((completedStatements / totalStatements) * 100)}%` }} /></div>
        <span>{Math.round((completedStatements / totalStatements) * 100)}%</span>
      </section>

      <div className="practice-editor-layout">
        <aside className="practice-step-list" aria-label="Assessment sections">
          {workspace.areas.map((area, index) => {
            const complete = area.statements.every((statement) => draft.ratings[statement.id]);
            return (
              <button className={step === index ? "is-active" : ""} key={area.areaKey} onClick={() => onStepChange(index)} type="button">
                <span>{index + 1}</span>
                <strong>{area.name}</strong>
                {complete ? <Check size={15} aria-label="Complete" /> : null}
              </button>
            );
          })}
          <button className={step === profileStep ? "is-active" : ""} onClick={() => onStepChange(profileStep)} type="button">
            <span>{profileStep + 1}</span><strong>Practice profile</strong>
          </button>
          <button className={step === planStep ? "is-active" : ""} onClick={() => onStepChange(planStep)} type="button">
            <span>{planStep + 1}</span><strong>Development plan</strong>
          </button>
        </aside>

        <div className="practice-editor-content">
          {activeArea ? (
            <div className="practice-area-section">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">{activeArea.category}</p>
                  <h2>{activeArea.name}</h2>
                </div>
                <span>{activeArea.statements.filter((statement) => draft.ratings[statement.id]).length}/{activeArea.statements.length} rated</span>
              </div>
              <div className="rating-scale-key">
                {workspace.ratingScale.filter((rating) => rating.isActive).map((rating) => (
                  <div key={rating.id} title={rating.meaning}>
                    <span aria-hidden="true" style={{ background: rating.colorHex ?? "#60736b" }} />
                    <strong>{rating.descriptor}</strong>
                  </div>
                ))}
              </div>
              <div className="practice-statement-list">
                {activeArea.statements.map((statement, index) => (
                  <div className="practice-statement" key={statement.id}>
                    <p><span>{index + 1}</span>{statement.text}</p>
                    <div className="likert-control" aria-label={`Rating for ${statement.text}`}>
                      {workspace.ratingScale.filter((rating) => rating.isActive).map((rating) => (
                        <button
                          aria-label={rating.descriptor}
                          className={draft.ratings[statement.id] === rating.id ? "is-selected" : ""}
                          key={rating.id}
                          onClick={() => updateRating(statement.id, rating.id)}
                          style={{ "--rating-color": rating.colorHex ?? "#60736b" } as CSSProperties}
                          title={`${rating.descriptor}: ${rating.meaning}`}
                          type="button"
                        >
                          <i aria-hidden="true" />
                          <span><strong>{rating.descriptor}</strong><small>{rating.meaning}</small></span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <label className="entry-field practice-reflection">
                <span>Evidence or reflection <small>Optional</small></span>
                <small>{activeArea.reflectionPrompt}</small>
                <textarea
                  onChange={(event) => updateReflection(activeArea.areaKey, event.target.value)}
                  rows={5}
                  value={draft.reflections[activeArea.areaKey] ?? ""}
                />
              </label>
            </div>
          ) : step === profileStep ? (
            <PracticeProfile workspace={workspace} draft={draft} onToggle={toggleSelection} onUseSuggestions={useSuggestions} />
          ) : (
            <DevelopmentPlanEditor workspace={workspace} draft={draft} onUpdate={updatePlan} />
          )}

          <div className="practice-editor-actions">
            <Button disabled={step === 0} icon={ArrowLeft} onClick={() => onStepChange(Math.max(0, step - 1))}>Previous</Button>
            <div className="toolbar">
              {adminStatus && onAdminStatusChange ? (
                <>
                  <label className="admin-elevate-status">
                    <span>Record status</span>
                    <select onChange={(event) => onAdminStatusChange(event.target.value as "draft" | "submitted")} value={adminStatus}>
                      <option value="draft">Draft</option>
                      <option value="submitted">Submitted</option>
                    </select>
                  </label>
                  {step < planStep ? <Button icon={ArrowRight} onClick={() => onStepChange(Math.min(planStep, step + 1))}>Next</Button> : null}
                  <Button disabled={isSaving} icon={Save} onClick={onSave} variant="primary">{isSaving ? "Saving..." : "Save changes"}</Button>
                </>
              ) : (
                <>
                  <Button disabled={isSaving} icon={Save} onClick={onSave}>Save draft</Button>
                  {step < planStep ? (
                    <Button icon={ArrowRight} onClick={() => onStepChange(Math.min(planStep, step + 1))} variant="primary">Next</Button>
                  ) : (
                    <Button disabled={isSaving} icon={Send} onClick={onSubmit} variant="primary">Submit and lock</Button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function PracticeProfile({
  workspace,
  draft,
  onToggle,
  onUseSuggestions
}: {
  workspace: ElevatePracticeWorkspace;
  draft: PracticeDraft;
  onToggle: (type: "strengths" | "developments", areaKey: string, maximum: number) => void;
  onUseSuggestions: (type: "strengths" | "developments") => void;
}) {
  const rankedAreas = workspace.areas
    .map((area) => ({ area, average: areaAveragePosition(area, draft, workspace) }))
    .filter((value): value is { area: ElevatePracticeWorkspace["areas"][number]; average: number } => value.average !== undefined);
  const suggestedStrengths = rankedAreas
    .slice()
    .sort((left, right) => right.average - left.average || left.area.displayOrder - right.area.displayOrder)
    .slice(0, 3)
    .map((value) => value.area.areaKey);
  const suggestedDevelopments = rankedAreas
    .slice()
    .sort((left, right) => left.average - right.average || right.area.displayOrder - left.area.displayOrder)
    .filter((value) => !suggestedStrengths.includes(value.area.areaKey))
    .slice(0, 2)
    .map((value) => value.area.areaKey);

  return (
    <div className="practice-profile-section">
      <div className="panel-heading">
        <div><p className="eyebrow">Calculated from your ratings</p><h2>Practice profile</h2></div>
        <Sparkles size={20} aria-hidden="true" />
      </div>
      <div className="practice-score-list">
        {workspace.areas.map((area) => (
          <div key={area.areaKey}>
            <span>{area.name}</span>
            <strong>{rubricWordingForPosition(workspace, areaAveragePosition(area, draft, workspace))}</strong>
          </div>
        ))}
      </div>

      <div className="practice-selection-grid">
        <section>
          <div className="panel-heading">
            <div><h3>My three strongest areas</h3><span>{draft.strengths.length}/3 selected</span></div>
            <Button onClick={() => onUseSuggestions("strengths")} variant="quiet">Use suggestions</Button>
          </div>
          <div className="practice-choice-list">
            {workspace.areas.map((area) => (
              <label key={area.areaKey}>
                <input checked={draft.strengths.includes(area.areaKey)} onChange={() => onToggle("strengths", area.areaKey, 3)} type="checkbox" />
                <span>{area.name}</span>
                {suggestedStrengths.includes(area.areaKey) ? <small>Suggested</small> : null}
              </label>
            ))}
          </div>
        </section>
        <section>
          <div className="panel-heading">
            <div><h3>My two development areas</h3><span>{draft.developments.length}/2 selected</span></div>
            <Button onClick={() => onUseSuggestions("developments")} variant="quiet">Use suggestions</Button>
          </div>
          <div className="practice-choice-list">
            {workspace.areas.map((area) => (
              <label key={area.areaKey}>
                <input checked={draft.developments.includes(area.areaKey)} onChange={() => onToggle("developments", area.areaKey, 2)} type="checkbox" />
                <span>{area.name}</span>
                {suggestedDevelopments.includes(area.areaKey) ? <small>Suggested</small> : null}
              </label>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function DevelopmentPlanEditor({
  workspace,
  draft,
  onUpdate
}: {
  workspace: ElevatePracticeWorkspace;
  draft: PracticeDraft;
  onUpdate: (areaKey: string, updates: Partial<ElevatePracticePlan>) => void;
}) {
  if (draft.developments.length !== 2) {
    return (
      <div className="practice-empty-state">
        <ClipboardList size={26} aria-hidden="true" />
        <h2>Select two development areas first</h2>
        <p>Return to Practice profile and choose exactly two areas. A plan will be created for each selection.</p>
      </div>
    );
  }

  return (
    <div className="practice-plans">
      <div className="panel-heading">
        <div><p className="eyebrow">Two plans become two actions</p><h2>Development plan</h2></div>
      </div>
      {draft.developments.map((areaKey, index) => {
        const area = workspace.areas.find((value) => value.areaKey === areaKey);
        const plan = draft.plans[areaKey] ?? emptyPlan(areaKey);
        return (
          <section className="practice-plan" key={areaKey}>
            <div className="practice-plan-heading"><span>{index + 1}</span><div><small>Selected development area</small><h3>{area?.name ?? areaKey}</h3></div></div>
            <label className="entry-field">
              <span>How will I develop this area?</span>
              <textarea onChange={(event) => onUpdate(areaKey, { developmentApproach: event.target.value })} rows={4} value={plan.developmentApproach} />
            </label>
            <fieldset className="support-options">
              <legend>CPD or support needed</legend>
              {workspace.supportOptions.map((option) => (
                <label key={option.key}>
                  <input
                    checked={plan.supportKeys.includes(option.key)}
                    onChange={() => onUpdate(areaKey, {
                      supportKeys: plan.supportKeys.includes(option.key)
                        ? plan.supportKeys.filter((key) => key !== option.key)
                        : [...plan.supportKeys, option.key]
                    })}
                    type="checkbox"
                  />
                  <span>{option.name}</span>
                </label>
              ))}
            </fieldset>
            <label className="entry-field">
              <span>Additional support details <small>Optional</small></span>
              <textarea onChange={(event) => onUpdate(areaKey, { supportDetails: event.target.value })} rows={3} value={plan.supportDetails} />
            </label>
            <div className="practice-plan-fields">
              <label className="entry-field">
                <span>What evidence will demonstrate successful implementation?</span>
                <textarea onChange={(event) => onUpdate(areaKey, { successEvidence: event.target.value })} rows={4} value={plan.successEvidence} />
              </label>
              <label className="entry-field">
                <span>What is the intended impact?</span>
                <textarea onChange={(event) => onUpdate(areaKey, { intendedImpact: event.target.value })} rows={4} value={plan.intendedImpact} />
              </label>
            </div>
          </section>
        );
      })}
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

  useEffect(() => {
    api.elevatePracticeProgress().then(setRecords).finally(() => setIsLoading(false));
  }, []);

  const faculties = useMemo(() => Array.from(new Map(records.filter((record) => record.facultyCode).map((record) => [record.facultyCode, record.facultyName])).entries()), [records]);
  const filtered = records.filter((record) => {
    const query = search.trim().toLowerCase();
    return (status === "all" || record.status === status)
      && (faculty === "all" || record.facultyCode === faculty)
      && (!query || `${record.staffName} ${record.externalId} ${record.email}`.toLowerCase().includes(query));
  });

  if (resultStaffId) {
    return <ElevatePracticeResultPage onBack={() => setResultStaffId("")} staffId={resultStaffId} />;
  }

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
        <div className="table-shell">
          <table>
            <thead><tr><th>Staff member</th><th>Faculty</th><th>Team</th><th>Status</th><th>Last activity</th><th>View</th></tr></thead>
            <tbody>
              {isLoading ? <tr><td colSpan={6}>Loading completion data...</td></tr> : filtered.length === 0 ? <tr><td colSpan={6}>No staff match these filters.</td></tr> : filtered.map((record) => (
                <tr key={record.staffId}>
                  <td><strong>{record.staffName}</strong><small className="table-subline">{record.externalId}</small></td>
                  <td>{record.facultyCode ?? "Unassigned"}</td>
                  <td>{record.teamCode ?? "Unassigned"}</td>
                  <td><span className={`status-pill ${practiceStatusClass(record.status)}`}>{practiceStatusLabel(record.status)}</span></td>
                  <td>{record.submittedAt ? formatDate(record.submittedAt) : record.updatedAt ? formatDate(record.updatedAt) : "No activity"}</td>
                  <td>{record.status === "submitted" ? <button className="icon-button" onClick={() => setResultStaffId(record.staffId)} title="View submitted result" type="button"><Eye size={16} aria-hidden="true" /></button> : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
      .catch(() => { if (!cancelled) setMessage("The Elevate Your Practice result could not be loaded."); });
    return () => { cancelled = true; };
  }, [recordId, staffId]);

  if (!workspace) {
    return <section className="panel"><Button icon={ArrowLeft} onClick={onBack}>Back to Staff Profile</Button><p className="muted-copy">{message || "Loading assessment result..."}</p></section>;
  }

  return <ElevatePracticeResult onBack={onBack} workspace={workspace} />;
}

function ElevatePracticeResult({ workspace, onBack }: { workspace: ElevatePracticeWorkspace; onBack?: () => void }) {
  const areaName = (key: string) => workspace.areas.find((area) => area.areaKey === key)?.name ?? key;

  return (
    <div className="practice-result">
      {onBack ? <div><Button icon={ArrowLeft} onClick={onBack}>Back to Staff Profile</Button></div> : null}
      <section className="practice-result-header">
        <div><p className="eyebrow">Submitted self-assessment</p><h2>{workspace.staffName}</h2><p>{workspace.facultyName ?? "No faculty"} · {workspace.teamName ?? "No team"}</p></div>
        <div className="practice-result-score"><span>Overall profile</span><strong>{workspace.overallJudgement ?? "Not yet rated"}</strong><small>Rubric judgement</small></div>
        <div className="practice-result-lock"><LockKeyhole size={18} aria-hidden="true" /><span>Locked</span><small>{workspace.academicYear}{workspace.submittedAt ? ` · ${formatDate(workspace.submittedAt)}` : ""}</small></div>
      </section>
      <section className="panel">
        <div className="panel-heading"><h2>Area profile</h2><span>Rubric judgements</span></div>
        <div className="practice-result-areas">
          {workspace.areas.map((area) => (
            <div key={area.areaKey}><span>{area.name}</span><strong>{area.judgement ?? "Not yet rated"}</strong></div>
          ))}
        </div>
      </section>
      <div className="practice-result-columns">
        <section className="panel"><div className="panel-heading"><h2>Three strongest areas</h2></div><ol>{workspace.strengthAreaKeys.map((key) => <li key={key}>{areaName(key)}</li>)}</ol></section>
        <section className="panel"><div className="panel-heading"><h2>Development areas</h2></div><ol>{workspace.developmentAreaKeys.map((key) => <li key={key}>{areaName(key)}</li>)}</ol></section>
      </div>
      <section className="panel">
        <div className="panel-heading"><h2>Development plan and linked actions</h2><span>{workspace.developmentPlans.length} actions</span></div>
        <div className="practice-result-plans">
          {workspace.developmentPlans.map((plan) => (
            <article key={plan.areaKey}>
              <div><h3>{areaName(plan.areaKey)}</h3><span className="status-pill status-open">Action created</span></div>
              <dl><dt>Development approach</dt><dd>{plan.developmentApproach}</dd><dt>Success evidence</dt><dd>{plan.successEvidence}</dd><dt>Intended impact</dt><dd>{plan.intendedImpact}</dd></dl>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function createDraft(workspace: ElevatePracticeWorkspace): PracticeDraft {
  return {
    ratings: Object.fromEntries(workspace.areas.flatMap((area) => area.statements.filter((statement) => statement.descriptorId).map((statement) => [statement.id, statement.descriptorId!]))),
    reflections: Object.fromEntries(workspace.areas.map((area) => [area.areaKey, area.reflection ?? ""])),
    strengths: workspace.strengthAreaKeys,
    developments: workspace.developmentAreaKeys,
    plans: Object.fromEntries(workspace.developmentPlans.map((plan) => [plan.areaKey, plan]))
  };
}

function toSaveRequest(workspace: ElevatePracticeWorkspace, draft: PracticeDraft, submit: boolean): SaveElevatePracticeAssessmentRequest {
  return {
    ratings: Object.entries(draft.ratings).map(([statementId, descriptorId]) => ({ statementId, descriptorId })),
    reflections: workspace.areas.map((area) => ({ areaKey: area.areaKey, text: draft.reflections[area.areaKey] ?? "" })),
    strengthAreaKeys: draft.strengths,
    developmentAreaKeys: draft.developments,
    developmentPlans: draft.developments.map((areaKey) => draft.plans[areaKey] ?? emptyPlan(areaKey)),
    submit
  };
}

function toAdminSaveRequest(
  workspace: ElevatePracticeWorkspace,
  draft: PracticeDraft,
  status: "draft" | "submitted"
): AdminSaveElevatePracticeAssessmentRequest {
  const request = toSaveRequest(workspace, draft, false);
  return {
    ratings: request.ratings,
    reflections: request.reflections,
    strengthAreaKeys: request.strengthAreaKeys,
    developmentAreaKeys: request.developmentAreaKeys,
    developmentPlans: request.developmentPlans,
    status
  };
}

function emptyPlan(areaKey: string): ElevatePracticePlan {
  return { areaKey, developmentApproach: "", supportKeys: [], supportDetails: "", successEvidence: "", intendedImpact: "" };
}

function areaAveragePosition(area: ElevatePracticeWorkspace["areas"][number], draft: PracticeDraft, workspace: ElevatePracticeWorkspace) {
  const values = area.statements
    .map((statement) => workspace.ratingScale.find((descriptor) => descriptor.id === draft.ratings[statement.id])?.displayOrder)
    .filter((value): value is number => value !== undefined);
  return values.length === area.statements.length ? values.reduce((total, value) => total + value, 0) / values.length : undefined;
}

function rubricWordingForPosition(workspace: ElevatePracticeWorkspace, position?: number) {
  if (position === undefined) {
    return "Not yet rated";
  }

  return workspace.ratingScale
    .slice()
    .sort((left, right) =>
      Math.abs(left.displayOrder - position) - Math.abs(right.displayOrder - position)
      || left.displayOrder - right.displayOrder
    )[0]?.descriptor ?? "Not yet rated";
}

function practiceStatusLabel(status: ElevatePracticeProgress["status"]) {
  return status === "not_started" ? "Not started" : status === "draft" ? "Draft" : "Submitted";
}

function practiceStatusClass(status: ElevatePracticeProgress["status"]) {
  return status === "not_started" ? "status-overdue" : status === "draft" ? "status-draft" : "status-complete";
}

function formatAuditAction(action: string) {
  return action
    .split(/[._]/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function formatAuditJson(value?: string) {
  if (!value) {
    return "No record snapshot";
  }

  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
