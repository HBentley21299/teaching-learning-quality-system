import { useEffect, useRef, useState } from "react";
import { Copy, RefreshCw, Save } from "lucide-react";
import { actionPath } from "../app/routing";
import { Button } from "../design-system/Button";
import { api } from "../services/api";
import type { ProcessReviewAction, SaveProcessReviewActionRequest } from "../services/processReviewTypes";
import { processReviewSafeLink } from "../services/processReviewTypes";
import { LoadingState } from "./LoadingState";
import { confirmUnsavedNavigation, useUnsavedChanges } from "./UnsavedChangesGuard";

function editableAction(action: ProcessReviewAction, reviewRecordId?: string): SaveProcessReviewActionRequest {
  return { title: action.title, themeKey: action.themeKey, ownerStaffId: action.ownerStaffId,
    dueDate: action.dueDate, supportRequired: action.supportRequired, successEvidence: action.successEvidence,
    progress: action.progress, progressNote: "", evidenceLink: "", barriers: "", nextStep: "",
    impactStatus: action.impactStatus, impactEvidence: action.impactEvidence ?? "",
    impactEvidenceLink: action.impactEvidenceLink ?? "", deadlineChangeReason: "", rowVersion: action.rowVersion,
    responsibleStaffIds: action.responsibleStaffIds?.length ? [...action.responsibleStaffIds] : [action.ownerStaffId],
    impactAreaKey: action.impactAreaKey, detail: action.detail, reviewDate: action.reviewDate, ...(reviewRecordId ? { reviewRecordId } : {}) };
}

function hasEarlierImpact(value: Pick<ProcessReviewAction, "impactStatus" | "impactEvidence" | "impactEvidenceLink">) {
  return value.impactStatus !== "awaiting_evidence" || Boolean(value.impactEvidence?.trim() || value.impactEvidenceLink?.trim());
}

export type ActivateActionOutcome = "progress" | "close" | "extend" | "reopen";
/** Action permissions are supplied by the server independently of review access. */
export function ProcessReviewActionPanel({ actionId, revision, onChanged, reviewRecordId, initialOutcome = "progress", blocked = false, onDirtyChange, onSavingChange }: {
  actionId: string; revision?: string; onChanged: () => Promise<void>; reviewRecordId?: string;
  initialOutcome?: ActivateActionOutcome; blocked?: boolean; onDirtyChange?: (dirty: boolean) => void; onSavingChange?: (saving: boolean) => void;
}) {
  const [action, setAction] = useState<ProcessReviewAction | null>(null);
  const [draft, setDraft] = useState<SaveProcessReviewActionRequest | null>(null);
  const [baseline, setBaseline] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showLink, setShowLink] = useState(false);
  const [outcome, setOutcome] = useState<ActivateActionOutcome>("progress");
  const sequence = useRef(0);
  const dirty = Boolean(draft && JSON.stringify(draft) !== baseline);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const loadedActionId = useRef("");
  const clearUnsaved = useUnsavedChanges({ label: "Action progress and impact", dirty, saving,
    onSave: save, onDiscard: () => { if (action) setDraft(editableAction(action, reviewRecordId)); setOutcome("progress"); } });
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onSavingChange?.(saving); }, [saving, onSavingChange]);
  useEffect(() => () => { onDirtyChange?.(false); onSavingChange?.(false); }, [onDirtyChange, onSavingChange]);

  async function load() {
    const request = ++sequence.current;
    setLoading(true); setError(""); setAction(null); setDraft(null); setBaseline("");
    try {
      const next = await api.processReviewAction(actionId);
      if (request !== sequence.current) return;
      const editable = editableAction(next, reviewRecordId);
      const initial = next.processKey === "activate_growth_review" && next.canEdit ? initialOutcome : "progress";
      const progress = initial === "close" ? "complete" : initial === "extend" ? "extended" : initial === "reopen" ? "open" : editable.progress;
      setAction(next); setDraft({ ...editable, progress }); setOutcome(initial); setBaseline(JSON.stringify(editable));
    } catch (cause) {
      if (request === sequence.current) setError(cause instanceof Error ? cause.message : "The action could not be loaded.");
    } finally { if (request === sequence.current) setLoading(false); }
  }

  useEffect(() => {
    if (loadedActionId.current === actionId && dirtyRef.current) {
      setMessage("The action register refreshed. Your unsaved update is retained; saving checks for conflicting changes.");
      return;
    }
    loadedActionId.current = actionId;
    void load(); return () => { sequence.current += 1; };
  }, [actionId, revision, reviewRecordId]);

  function update(key: keyof SaveProcessReviewActionRequest, value: string) {
    setDraft(previous => previous ? { ...previous, [key]: value } : previous);
    setMessage("");
  }

  async function save(): Promise<boolean> {
    if (!draft || !action?.canEdit || saving || blocked) return false;
    if (action.processKey === "activate_growth_review" && !draft.progressNote?.trim()) {
      setError("Record the distance travelled and outcome of this action review."); return false;
    }
    if (action.processKey === "activate_growth_review" && outcome === "extend" && (!draft.dueDate || draft.dueDate <= action.dueDate)) {
      setError("Choose a new review date after the current review date."); return false;
    }
    if (draft.dueDate !== action.dueDate && !draft.deadlineChangeReason?.trim()) {
      setError(action.processKey === "activate_growth_review" ? "Explain why the review date is changing." : "Explain why the implementation date is changing."); return false;
    }
    if (action.processKey !== "activate_growth_review" && draft.impactStatus === "demonstrated" && !draft.impactEvidence?.trim() && !draft.impactEvidenceLink?.trim()) {
      setError("Describe or link to the evidence demonstrating the action’s impact."); return false;
    }
    setSaving(true); setError(""); setMessage("");
    try {
      const result = await api.updateAssignedProcessReviewAction(action.actionId, draft);
      if (!result.ok || !result.data) { setError(result.message ?? "The action update could not be saved. Your changes are retained."); return false; }
      const next = editableAction(result.data, reviewRecordId);
      setAction(result.data); setDraft(next); setBaseline(JSON.stringify(next)); clearUnsaved();
      setOutcome("progress");
      setMessage(result.data.processKey === "activate_growth_review" ? "Action update saved." : "Action update saved. Activity progress and impact remain separate.");
      try { await onChanged(); } catch { setMessage("Action update saved. Refresh the action register to see its latest state."); }
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The action update could not be saved. Your changes are retained."); return false; }
    finally { setSaving(false); }
  }

  const link = typeof window === "undefined" ? actionPath(actionId) : new URL(actionPath(actionId), window.location.origin).href;
  async function copyLink() {
    try { await navigator.clipboard.writeText(link); setMessage("Action link copied."); }
    catch { setShowLink(true); setMessage("Select and copy the action link below."); }
  }

  if (loading) return <LoadingState label="Loading review action progress…" />;
  if (!action || !draft) return <div role="alert"><p>{error || "This action is not available to your account."}</p><Button icon={RefreshCw} onClick={() => void load()}>Retry</Button></div>;
  const activate = action.processKey === "activate_growth_review";
  const earlierImpactUpdates = activate ? action.updates.filter(hasEarlierImpact) : [];
  function chooseOutcome(next: ActivateActionOutcome) {
    if (!action || !draft || !action.canEdit || saving || blocked) return;
    setOutcome(next); setError(""); setMessage("");
    setDraft({ ...draft, progress: next === "close" ? "complete" : next === "extend" ? "extended" : next === "reopen" ? "open" : action.progress,
      dueDate: action.dueDate, reviewDate: action.reviewDate || action.dueDate, deadlineChangeReason: "" });
  }
  const field = (key: keyof SaveProcessReviewActionRequest, label: string, rows = 3) => <label className="entry-field"><span>{label}</span><textarea rows={rows} maxLength={4000} value={String(draft[key] ?? "")} onChange={event => update(key, event.target.value)} /></label>;
  return <div className="route-stack" style={{ marginTop: "1rem" }}>
    <div className="panel-heading"><div><h3>{activate ? "Review action · distance travelled" : "Review action updates & impact"}</h3><span>{reviewRecordId ? "This dated review updates the original shared action." : "i-Elevate is the live action record."}</span></div><Button icon={Copy} onClick={() => void copyLink()} variant="secondary">Copy action link</Button></div>
    {showLink ? <label className="entry-field"><span>Action link</span><input readOnly value={link} onFocus={event => event.currentTarget.select()} /></label> : null}
    {activate ? <dl className="action-detail-grid"><div><dt>Action theme</dt><dd>{action.themeLabel || action.themeKey}</dd></div><div><dt>Area of impact</dt><dd>{action.impactAreaLabel || "Not recorded"}</dd></div><div><dt>Action detail</dt><dd>{action.detail || action.title}</dd></div><div><dt>Impact measures</dt><dd>{action.successEvidence}</dd></div><div><dt>Responsible</dt><dd>{action.responsibleStaff?.length ? action.responsibleStaff.map(person => person.displayName).join("; ") : action.ownerName}</dd></div></dl>
      : <dl className="action-detail-grid"><div><dt>Support required</dt><dd>{action.supportRequired || "None recorded"}</dd></div><div><dt>Evidence of success</dt><dd>{action.successEvidence}</dd></div></dl>}
    {activate && (action.supportRequired?.trim() || hasEarlierImpact(action) || earlierImpactUpdates.length > 0) ? <details className="action-history"><summary>Earlier support and impact · read only</summary>
      {action.supportRequired?.trim() ? <p>Earlier support: {action.supportRequired}</p> : null}
      {hasEarlierImpact(action) ? <><p>Earlier impact assessment: {action.impactStatus.replaceAll("_", " ")}</p>{action.impactEvidence ? <p>{action.impactEvidence}</p> : null}{processReviewSafeLink(action.impactEvidenceLink) ? <p><a href={processReviewSafeLink(action.impactEvidenceLink)!} target="_blank" rel="noopener noreferrer">Earlier impact evidence</a></p> : null}</> : null}
      {earlierImpactUpdates.map(update => <article key={update.updateId}><h4>{new Date(update.updatedAt).toLocaleString("en-GB")} · {update.updatedByName}</h4><p>{update.impactStatus.replaceAll("_", " ")}</p>{update.impactEvidence ? <p>{update.impactEvidence}</p> : null}{processReviewSafeLink(update.impactEvidenceLink) ? <p><a href={processReviewSafeLink(update.impactEvidenceLink)!} target="_blank" rel="noopener noreferrer">Earlier dated impact evidence</a></p> : null}</article>)}
    </details> : null}
    {error ? <p role="alert">{error}</p> : null}{message ? <p role="status">{message}</p> : null}
    {!action.canEdit ? <p className="notice-row">Only the action creator, their management hierarchy, Admin or Teaching & Learning can update this action.</p> : null}
    <fieldset className="entry-form" disabled={saving || !action.canEdit || blocked} style={{ margin: 0, padding: 0, border: 0, minWidth: 0 }}>
      {activate ? <><div className="toolbar" role="group" aria-label="Action review outcome"><Button aria-pressed={outcome === "progress"} onClick={() => chooseOutcome("progress")}>Record progress</Button>{!["complete", "cancelled"].includes(action.progress) ? <><Button aria-pressed={outcome === "close"} onClick={() => chooseOutcome("close")}>Close action</Button><Button aria-pressed={outcome === "extend"} onClick={() => chooseOutcome("extend")}>Extend action</Button></> : <Button aria-pressed={outcome === "reopen"} onClick={() => chooseOutcome("reopen")}>Reopen action</Button>}</div><p className="muted-copy">Current status: {action.progress === "complete" ? "Completed" : action.progress.replaceAll("_", " ")} · Review date: {action.reviewDate || action.dueDate}. Describe what has changed against the impact measures.</p></> : null}
      <div className="entry-field-grid">
        {!activate ? <label className="entry-field"><span>Activity progress</span><select value={draft.progress} onChange={event => update("progress", event.target.value)}><option value="open">Open</option><option value="extended">Extended</option><option value="complete">Completed</option><option value="cancelled">Cancelled</option></select></label> : null}
        {!activate || outcome === "extend" ? <label className="entry-field"><span>{activate ? "New review date" : "Implementation date"}</span><input type="date" min={activate ? action.dueDate : undefined} value={draft.dueDate} onChange={event => { const value = event.target.value; setDraft(previous => previous ? { ...previous, dueDate: value, ...(activate ? { reviewDate: value } : {}) } : previous); setMessage(""); }} /></label> : null}
        {draft.dueDate !== action.dueDate ? field("deadlineChangeReason", activate ? "Reason for changing the review date" : "Reason for changing the deadline") : null}
        {field("progressNote", activate ? "Distance travelled and outcome" : "Progress update")}{!activate ? <>{field("barriers", "Barriers")}{field("nextStep", "Next step")}</> : null}
        <label className="entry-field"><span>Progress evidence link</span><input type="url" value={draft.evidenceLink ?? ""} onChange={event => update("evidenceLink", event.target.value)} /></label>
        {!activate ? <><label className="entry-field"><span>Impact assessment</span><select value={draft.impactStatus} onChange={event => update("impactStatus", event.target.value)}><option value="awaiting_evidence">Awaiting evidence</option><option value="assessing">Evidence being assessed</option><option value="demonstrated">Impact demonstrated</option><option value="further_change">Further change needed</option></select><small>Completing the activity does not confirm that its intended impact has been demonstrated.</small></label>
        {field("impactEvidence", "Impact evidence and observed change")}
        <label className="entry-field"><span>Impact evidence link</span><input type="url" value={draft.impactEvidenceLink ?? ""} onChange={event => update("impactEvidenceLink", event.target.value)} /></label></> : null}
      </div>
      <div className="toolbar"><Button icon={Save} disabled={!dirty || saving || !action.canEdit || blocked} onClick={() => void save()} variant="primary">{saving ? "Saving…" : activate && outcome === "close" ? "Confirm close action" : activate && outcome === "extend" ? "Confirm extension" : activate && outcome === "reopen" ? "Confirm reopen action" : "Save dated update"}</Button></div>
    </fieldset>
    <Button icon={RefreshCw} disabled={saving} onClick={async () => { if (await confirmUnsavedNavigation()) await load(); }} variant="quiet">Reload latest action</Button>
    {action.updates.length ? <details className="action-history"><summary>Dated action history ({action.updates.length})</summary>{action.updates.map(update => <article key={update.updateId}><h4>{new Date(update.updatedAt).toLocaleString("en-GB")} · {update.updatedByName}</h4><p>Activity: {update.progress}{!activate ? ` · Impact: ${update.impactStatus.replaceAll("_", " ")}` : ""}</p><p>{update.progressNote}</p>{update.barriers ? <p>Barriers: {update.barriers}</p> : null}{update.nextStep ? <p>Next step: {update.nextStep}</p> : null}{update.deadlineChangeReason ? <p>{activate ? "Review date" : "Deadline"} changed to {update.dueDate}: {update.deadlineChangeReason}</p> : null}{!activate && update.impactEvidence ? <p>Impact evidence: {update.impactEvidence}</p> : null}{processReviewSafeLink(update.evidenceLink) ? <a href={processReviewSafeLink(update.evidenceLink)!} target="_blank" rel="noopener noreferrer">Progress evidence</a> : null}{!activate && processReviewSafeLink(update.impactEvidenceLink) ? <p><a href={processReviewSafeLink(update.impactEvidenceLink)!} target="_blank" rel="noopener noreferrer">Impact evidence</a></p> : null}</article>)}</details> : <p className="muted-copy">No dated action updates yet.</p>}
  </div>;
}
