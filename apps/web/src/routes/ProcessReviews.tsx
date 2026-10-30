import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Check, Copy, ExternalLink, Plus, Save, Send, Trash2 } from "lucide-react";
import { Button } from "../design-system/Button";
import { LoadingState } from "../components/LoadingState";
import { StaffSearchSelect } from "../components/StaffSearchSelect";
import { SkillsScanResultBar } from "../components/SkillsScanResultBar";
import { WorkflowFeedback } from "../components/WorkflowFeedback";
import { WorkflowFilters } from "../components/WorkflowFilters";
import { useWorkflowPagination, WorkflowPagination } from "../components/WorkflowPagination";
import { confirmUnsavedNavigation, useUnsavedChanges } from "../components/UnsavedChangesGuard";
import { api } from "../services/api";
import { actionPath } from "../app/routing";
import type { CurrentUser, OrgUnitSummary, StaffSummary } from "../services/types";
import {
  emptyProcessReviewRequest, emptyActivateGrowthReviewData, activatePillarAverage, activateParticipantIds, activateSubTeamGroups, activateContextPatch,
  processReviewFingerprint, processReviewRequest, processReviewSafeLink,
  removeProcessReviewSample, type ProcessReviewAction, type ProcessReviewConfiguration,
  type ProcessReviewData, type ProcessReviewDetail, type ProcessReviewKey, type ProcessReviewResponse,
  type ProcessReviewSample, type ProcessReviewSummary, type SaveProcessReviewActionRequest,
  type SaveProcessReviewRequest, type ActivateGrowthReviewData, type ActivateReviewContext
} from "../services/processReviewTypes";
import "./ProcessReviews.css";

export type ProcessReviewsProps = {
  processKey: ProcessReviewKey; user: CurrentUser; orgUnits: OrgUnitSummary[]; staff: StaffSummary[];
  academicYear: string; initialRecordId?: string; onRecordOpened?: (recordId: string) => void;
  onRecordClosed?: () => void; onActionsChanged?: () => Promise<void>;
};

const digitalSteps = ["Review context", "Samples", "Six standards", "Strengths & actions", "Check & submit"];
const activateSteps = ["Review & participants", "Skills Scan results", "Meeting minutes", "Actions", "Check & submit"];
const progressLabels: Record<string, string> = { open: "Open", complete: "Completed", extended: "Extended", cancelled: "Cancelled" };
const impactLabels: Record<string, string> = { awaiting_evidence: "Awaiting evidence", assessing: "Evidence being assessed", demonstrated: "Impact demonstrated", further_change: "Further change needed" };

function displayDate(value?: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function editorRequest(detail: ProcessReviewDetail) {
  const request = processReviewRequest(detail);
  if (detail.processKey === "activate_growth_review" && !request.data.activate) {
    const selected = detail.selectedSubTeams?.map(team => team.orgUnitId) || (detail.teamOrgUnitId ? [detail.teamOrgUnitId] : []);
    request.data.activate = emptyActivateGrowthReviewData(selected, detail.participants?.map(person => person.staffId) || []);
  }
  return request;
}

function activateData(request: SaveProcessReviewRequest) { return request.data.activate || emptyActivateGrowthReviewData(); }
function activateScopeKey(request: SaveProcessReviewRequest) {
  const data = activateData(request);
  return `${request.facultyOrgUnitId || ""}|${request.recordDate || ""}|${data.allSubTeams ? "all" : [...data.subTeamOrgUnitIds].sort().join(",")}`;
}

export function ProcessReviews({ processKey, user, orgUnits, staff, academicYear, initialRecordId = "", onRecordOpened, onRecordClosed, onActionsChanged }: ProcessReviewsProps) {
  const digital = processKey === "digital_learning_walk";
  const title = digital ? "Digital Learning Walks" : "Activate+ Growth Reviews";
  const steps = digital ? digitalSteps : activateSteps;
  const [configuration, setConfiguration] = useState<ProcessReviewConfiguration | null>(null);
  const [records, setRecords] = useState<ProcessReviewSummary[]>([]);
  const [detail, setDetail] = useState<ProcessReviewDetail | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [request, setRequest] = useState(() => emptyProcessReviewRequest(academicYear));
  const [baseline, setBaseline] = useState(() => processReviewFingerprint(request));
  const [step, setStep] = useState(0);
  const [standard, setStandard] = useState(0);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [saving, setSaving] = useState(false);
  const [followUpBusy, setFollowUpBusy] = useState("");
  const [actionDirty, setActionDirty] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error" | "neutral">("neutral");
  const [loadFailed, setLoadFailed] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [facultyFilter, setFacultyFilter] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [sort, setSort] = useState("newest");
  const loadVersion = useRef(0);
  const detailVersion = useRef(0);
  const saveLock = useRef(false);
  const followUpLock = useRef(false);
  const headingId = useId();
  const activeConfiguration = digital ? detail?.configuration ?? configuration : detail?.configuration.skillsScanPillars?.length ? detail.configuration : configuration ?? detail?.configuration;
  const dirty = editorOpen && processReviewFingerprint(request) !== baseline;
  const canCreate = Boolean(user.staffId) && ["forms.manage", `${processKey}.submit`, `${processKey}.manage`].some(key => user.permissions.includes(key));
  const canEdit = detail ? detail.canEdit : canCreate;
  const scaleMissing = digital && !activeConfiguration?.ratingOptions.length;
  const clearNavigation = useUnsavedChanges({ label: title, dirty, saving: saving || actionBusy || Boolean(followUpBusy),
    submission: true, onSave: canEdit ? () => save(false) : undefined,
    onSubmit: canEdit && !scaleMissing ? () => save(true) : undefined,
    submitLabel: "Submit review",
    onDiscard: () => { const next = detail ? editorRequest(detail) : emptyProcessReviewRequest(academicYear); setRequest(next); setBaseline(processReviewFingerprint(next)); }
  });

  async function loadRegister() {
    const version = ++loadVersion.current;
    setLoading(true); setLoadFailed(false);
    try {
      const [config, rows] = await Promise.all([api.processReviewConfiguration(processKey), api.processReviews(processKey, academicYear)]);
      if (version !== loadVersion.current) return;
      setConfiguration(config); setRecords(rows);
    } catch (error) {
      if (version !== loadVersion.current) return;
      setLoadFailed(true); reportError(error, "The review register could not be loaded. Try again.");
    } finally { if (version === loadVersion.current) setLoading(false); }
  }

  useEffect(() => {
    setDetail(null); setEditorOpen(false); setOpening(false); setMessage(""); setStep(0); setStandard(0);
    const next = emptyProcessReviewRequest(academicYear); setRequest(next); setBaseline(processReviewFingerprint(next));
    void loadRegister();
    return () => { loadVersion.current++; detailVersion.current++; };
  }, [processKey, academicYear]);

  useEffect(() => {
    if (initialRecordId && initialRecordId !== detail?.recordId) void openRecord(initialRecordId);
  }, [initialRecordId, processKey]);

  function reportError(error: unknown, fallback: string) {
    setMessageTone("error"); setMessage(error instanceof Error && error.message ? error.message : fallback);
  }

  async function openRecord(recordId: string) {
    if (!await confirmUnsavedNavigation()) return;
    const version = ++detailVersion.current;
    setOpening(true); setMessage("");
    try {
      const loaded = await api.processReview(recordId);
      if (version !== detailVersion.current) return;
      if (loaded.processKey !== processKey) { setMessageTone("error"); setMessage("This record belongs to another review process."); return; }
      const next = editorRequest(loaded);
      setDetail(loaded); setRequest(next); setBaseline(processReviewFingerprint(next)); setStep(0); setStandard(0); setEditorOpen(true);
      onRecordOpened?.(recordId);
    } catch (error) { if (version === detailVersion.current) reportError(error, "That review could not be opened, or you no longer have access."); }
    finally { if (version === detailVersion.current) setOpening(false); }
  }

  async function startReview() {
    if (!configuration || !canCreate || !await confirmUnsavedNavigation()) return;
    const next = emptyProcessReviewRequest(academicYear);
    detailVersion.current++;
    if (!digital) next.data.activate = emptyActivateGrowthReviewData();
    setDetail(null); setRequest(next); setBaseline(processReviewFingerprint(next)); setEditorOpen(true); setStep(0); setStandard(0); setMessage("");
    onRecordClosed?.();
  }

  async function closeEditor() {
    if (!await confirmUnsavedNavigation()) return;
    detailVersion.current++;
    setEditorOpen(false); setDetail(null); setMessage(""); onRecordClosed?.(); void loadRegister();
  }

  async function addFollowUp(parent: Pick<ProcessReviewSummary, "recordId" | "rowVersion"> | null = detail) {
    if (!parent || digital || !canCreate || followUpLock.current) return;
    if (dirty || actionDirty) { setMessageTone("error"); setMessage("Save or cancel your current edits before adding a follow-up review."); return; }
    followUpLock.current = true; setFollowUpBusy(parent.recordId); setMessage("");
    const version = ++detailVersion.current;
    try {
      const result = await api.createActivateFollowUp(parent.recordId, { academicYear, rowVersion: parent.rowVersion });
      if (version !== detailVersion.current) return;
      if (!result.ok || !result.data) { setMessageTone("error"); setMessage(result.message || "The follow-up could not be created. The previous review is unchanged."); return; }
      const next = editorRequest(result.data);
      clearNavigation(); setDetail(result.data); setRequest(next); setBaseline(processReviewFingerprint(next)); setEditorOpen(true); setStep(0); setStandard(0);
      onRecordOpened?.(result.data.recordId); setMessageTone("success"); setMessage("Linked follow-up review opened. Previous results are available as reference and existing actions remain shared.");
      void api.processReviews(processKey, academicYear).then(updatedRecords => {
        if (version === detailVersion.current) setRecords(updatedRecords);
      }).catch(() => { /* The linked review remains open if the register cannot refresh. */ });
    } catch (error) { if (version === detailVersion.current) reportError(error, "The follow-up could not be created. Try again."); }
    finally { followUpLock.current = false; setFollowUpBusy(""); }
  }

  async function save(submit: boolean): Promise<boolean> {
    if (!canEdit || saveLock.current || followUpLock.current || actionBusy || (submit && scaleMissing)) return false;
    if (submit && actionDirty) { setMessageTone("error"); setMessage("Save or cancel the action edits before submitting this review."); return false; }
    saveLock.current = true; setSaving(true); setMessage("");
    try {
      const result = await api.saveProcessReview(processKey, detail?.recordId ?? null, { ...request, submit, rowVersion: detail?.rowVersion ?? undefined });
      if (!result.ok || !result.data) { setMessageTone("error"); setMessage(result.message ?? "The review could not be saved. Your entries are still here."); return false; }
      const next = editorRequest(result.data);
      setDetail(result.data); setRequest(next); setBaseline(processReviewFingerprint(next)); clearNavigation();
      setMessageTone("success"); setMessage(submit ? "Review submitted." : "Review saved.");
      onRecordOpened?.(result.data.recordId);
      try { setRecords(await api.processReviews(processKey, academicYear)); } catch { /* The saved record remains open if the register refresh fails. */ }
      return true;
    } catch (error) { reportError(error, "The review could not be saved. Your entries are still here."); return false; }
    finally { saveLock.current = false; setSaving(false); }
  }

  function field(key: string, value: string) { setRequest(current => ({ ...current, data: { ...current.data, fields: { ...current.data.fields, [key]: value } } })); }
  function patchData(patch: Partial<ProcessReviewData>) { setRequest(current => ({ ...current, data: { ...current.data, ...patch } })); }
  function patchRequest(patch: Partial<SaveProcessReviewRequest> | ((current: SaveProcessReviewRequest) => Partial<SaveProcessReviewRequest>)) { setRequest(current => ({ ...current, ...(typeof patch === "function" ? patch(current) : patch) })); }
  const label = (key: string, fallback: string) => activeConfiguration?.fieldLabels[key] || fallback;

  async function actionsChanged(next: ProcessReviewDetail) {
    setDetail(next);
    if (dirty) setRequest(current => ({ ...current, rowVersion: next.rowVersion }));
    else { const updated = editorRequest(next); setRequest(updated); setBaseline(processReviewFingerprint(updated)); }
    try { await onActionsChanged?.(); } catch { /* The action save succeeded; a sibling summary can refresh later. */ }
  }

  const filteredRecords = useMemo(() => records.filter(record => {
    const text = [record.title, record.ownerName, record.facultyName, record.teamName, record.status, record.academicYear, record.selectedSubTeams?.map(team => team.name).join(" "), record.participants?.map(person => person.displayName).join(" ")].join(" ").toLowerCase();
    return (!search.trim() || text.includes(search.trim().toLowerCase())) && (statusFilter === "all" || record.status === statusFilter)
      && (facultyFilter === "all" || record.facultyOrgUnitId === facultyFilter) && (ownerFilter === "all" || record.ownerStaffId === ownerFilter);
  }).sort((a, b) => {
    const order = sort === "title" ? a.title.localeCompare(b.title) : sort === "owner" ? a.ownerName.localeCompare(b.ownerName)
      : sort === "faculty" ? (a.facultyName || "").localeCompare(b.facultyName || "") : sort === "followup" ? (a.followUpReviews?.map(review => review.recordDate).filter(Boolean).sort()[0] || "9999").localeCompare(b.followUpReviews?.map(review => review.recordDate).filter(Boolean).sort()[0] || "9999")
      : (b.recordDate || b.updatedAt).localeCompare(a.recordDate || a.updatedAt);
    return order || a.recordId.localeCompare(b.recordId);
  }), [records, search, statusFilter, facultyFilter, ownerFilter, sort]);
  const pagination = useWorkflowPagination(filteredRecords, JSON.stringify([processKey, academicYear, search, statusFilter, facultyFilter, ownerFilter, sort]));

  if (loading || opening) return <div className="route-stack"><LoadingState size="page" label={editorOpen || initialRecordId ? "Opening the review…" : `Loading ${title.toLowerCase()}…`} /></div>;
  if (!editorOpen) return <div className="route-stack process-reviews">
    <section className="panel"><div className="panel-heading"><div><span className="eyebrow">Forms & reviews</span><h1>{title}</h1><p className="muted-copy">{digital ? "Team or area reviews across six standards, informed by linked samples." : "Faculty reviews, Skills Scan averages, meeting minutes and agreed actions."}</p></div>{canCreate ? <Button icon={Plus} variant="primary" disabled={!configuration || Boolean(followUpBusy)} onClick={() => void startReview()}>New {digital ? "digital learning walk" : "growth review"}</Button> : null}</div>
      <WorkflowFeedback message={message} tone={messageTone} onDismiss={() => setMessage("")} />
      {loadFailed ? <div className="process-review-empty"><p>The register is currently unavailable.</p><Button onClick={() => void loadRegister()}>Try again</Button></div> : <>
        <WorkflowFilters activeCount={[statusFilter, facultyFilter, ownerFilter].filter(value => value !== "all").length} hasQuery={Boolean(search)} onClear={() => { setSearch(""); setStatusFilter("all"); setFacultyFilter("all"); setOwnerFilter("all"); }} primary={<><label className="entry-field"><span>Search reviews</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Title, faculty, team or review owner" /></label><label className="entry-field"><span>Sort by</span><select value={sort} onChange={event => setSort(event.target.value)}><option value="newest">Review date · newest</option><option value="title">Title A–Z</option><option value="owner">Review owner A–Z</option><option value="faculty">Faculty A–Z</option>{!digital ? <option value="followup">Follow-up review date · soonest</option> : null}</select></label></>}>
          <label className="entry-field"><span>Status</span><select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="draft">Draft</option><option value="submitted">Submitted</option></select></label>
          <label className="entry-field"><span>Faculty</span><select value={facultyFilter} onChange={event => setFacultyFilter(event.target.value)}><option value="all">All faculties</option>{Array.from(new Map(records.filter(record => record.facultyOrgUnitId).map(record => [record.facultyOrgUnitId!, record.facultyName || "Saved faculty"]))).sort((a,b) => a[1].localeCompare(b[1])).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
          <label className="entry-field"><span>Review owner</span><select value={ownerFilter} onChange={event => setOwnerFilter(event.target.value)}><option value="all">All owners</option>{Array.from(new Map(records.map(record => [record.ownerStaffId, record.ownerName]))).sort((a,b) => a[1].localeCompare(b[1])).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        </WorkflowFilters>
        <p className="muted-copy" role="status">{filteredRecords.length} {filteredRecords.length === 1 ? "review" : "reviews"} · {academicYear}</p>
        {!filteredRecords.length ? <div className="process-review-empty"><h2>{records.length ? "No reviews match these filters" : "No reviews yet"}</h2><p>{records.length ? "Change the search or filters to see more reviews." : "Saved drafts and submitted reviews will appear here."}</p></div> : <div className="process-review-register" role="region" aria-label={`${title} register`} tabIndex={0}><table className="data-table"><thead><tr><th scope="col">Review</th><th scope="col">Review owner</th><th scope="col">Date</th><th scope="col">Status</th><th scope="col">{digital ? "Evidence" : "Follow-up review"}</th><th scope="col">Open actions</th></tr></thead><tbody>{pagination.items.map(record => <tr key={record.recordId}><td><button type="button" className="quiet-link" onClick={() => void openRecord(record.recordId)}>{record.title}</button><span className="process-review-cell-note">{[record.facultyName, record.teamName].filter(Boolean).join(" · ") || "Context not yet recorded"}</span></td><td>{record.ownerName}</td><td>{displayDate(record.recordDate)}</td><td><span className={`status-chip ${record.status === "submitted" ? "status-good" : ""}`}>{record.status === "submitted" ? "Submitted" : "Draft"}</span></td><td>{digital ? `${record.sampleCount} samples · ${record.ratedStatementCount}/${record.statementCount} rated` : <div className="form-stack">{record.followUpReviews?.map(followUp => <button type="button" className="quiet-link" key={followUp.recordId} onClick={() => void openRecord(followUp.recordId)}>{followUp.title} · {displayDate(followUp.recordDate)}</button>)}{!record.followUpReviews?.length && canCreate && (record.ownerStaffId === user.staffId || user.isAdministrator || user.permissions.includes(`${processKey}.manage`)) ? <Button icon={Plus} busy={followUpBusy === record.recordId} disabled={Boolean(followUpBusy)} onClick={() => void addFollowUp(record)}>Add follow-up review</Button> : !record.followUpReviews?.length ? <span>None added</span> : null}</div>}</td><td>{record.openActionCount}</td></tr>)}</tbody></table></div>}
        <WorkflowPagination {...pagination} label={`${title} register`} />
      </>}
    </section>
  </div>;

  if (!activeConfiguration) return <WorkflowFeedback tone="error" message="The form configuration is unavailable. Return to the register and try again." />;
  const displayedSteps = !digital && detail?.isFollowUp ? ["Follow-up & participants", "Skills Scan reference", "Follow-up notes", "Review actions", "Check & submit"] : steps;
  const currentStep = displayedSteps[step] || displayedSteps[0];
  const actionsStep = digital ? 3 : 3;
  const snapshotCount = detail?.snapshots.length ?? 0;
  const commonProps: ReviewFieldsProps = { request, setRequest: patchRequest, field, label, orgUnits, staff, user, detail, configuration: activeConfiguration };
  return <div className="route-stack process-reviews">
    <section className="panel process-review-heading"><div className="panel-heading"><div><Button icon={ArrowLeft} variant="quiet" disabled={Boolean(followUpBusy)} onClick={() => void closeEditor()}>Review register</Button><span className="eyebrow">{title}</span><h1 id={headingId}>{request.title || `New ${digital ? "digital learning walk" : "growth review"}`}</h1><p className="muted-copy">{request.academicYear} · {detail?.status === "submitted" ? "Submitted" : "Draft"} · Framework {activeConfiguration.version}</p></div><div className="process-review-owner"><span>Review owner</span><strong>{detail?.ownerName || user.displayName}</strong><small>Recorded automatically from the person who creates the review.</small></div></div>
      {!canEdit ? <p className="notice-row">You can view this review. Its owner or an authorised coordinator can amend it.</p> : null}
      <WorkflowFeedback message={message} tone={messageTone} onDismiss={() => setMessage("")} />
      {!digital && detail?.isFollowUp ? <p className="notice-row">Linked follow-up · scope and participants carried forward, with fresh meeting notes and shared actions.</p> : null}
    </section>
    {!digital && step === 0 ? <ActivateReviewFollowUps detail={detail} canCreate={canCreate} blocked={dirty || actionDirty} busy={Boolean(followUpBusy) || saving || actionBusy} onAdd={() => void addFollowUp()} onOpen={id => void openRecord(id)} onSave={() => void save(false)} /> : null}
    <div className="process-review-workspace"><nav className="process-review-steps" aria-label={`${title} form sections`}>{displayedSteps.map((name, index) => <button type="button" disabled={saving || Boolean(followUpBusy)} key={name} aria-current={step === index ? "step" : undefined} onClick={() => { setStep(index); window.requestAnimationFrame(() => document.getElementById(`${headingId}-section`)?.focus()); }}><span aria-hidden="true">{index + 1}</span>{name}</button>)}</nav><section className="panel process-review-editor" aria-labelledby={`${headingId}-section`}>
      <div className="panel-heading"><div><span className="eyebrow">Section {step + 1} of {steps.length}</span><h2 id={`${headingId}-section`} tabIndex={-1}>{currentStep}</h2></div>{dirty || actionDirty ? <span className="status-chip">{actionDirty ? "Unsaved action edits" : "Unsaved changes"}</span> : null}</div>
      <div hidden={step !== actionsStep}>{digital ? <fieldset className="process-review-fields" disabled={!canEdit || saving || actionBusy || Boolean(followUpBusy)}><Narrative label={label("strengths", "Strengths and effective practice")} value={request.data.fields.strengths || ""} onChange={value => field("strengths", value)} /></fieldset> : null}<ProcessReviewActions key={detail?.recordId || "new-review"} detail={detail} configuration={activeConfiguration} staff={staff} onDirtyChange={setActionDirty} onSavingChange={setActionBusy} onChanged={actionsChanged} onSaveReview={() => save(false)} reviewSaving={saving || Boolean(followUpBusy)} reviewScopeDirty={!digital && Boolean(detail) && (!detail!.data.activate || activateScopeKey(request) !== activateScopeKey(editorRequest(detail!)))} /></div><div hidden={step === actionsStep}><fieldset className="process-review-fields" disabled={(!canEdit && !(digital && step === 2)) || saving || actionBusy || Boolean(followUpBusy)}>
        {step === 0 ? digital ? <ReviewContext {...commonProps} digital={digital} /> : <ActivateReviewContextFields {...commonProps} /> : digital && step === 1 ? <DigitalSamples data={request.data} staff={staff} onChange={patchData} /> : digital && step === 2 ? <DigitalStatements readOnly={!canEdit} configuration={activeConfiguration} data={request.data} selected={standard} setSelected={setStandard} onChange={responses => patchData({ responses })} /> : !digital && step === 1 ? <ActivateSkillsScan {...commonProps} /> : !digital && step === 2 ? <ActivateMeetingMinutes {...commonProps} /> : <ReviewChecks {...commonProps} digital={digital} />}
      </fieldset></div>
      {digital && scaleMissing ? <div className="notice-row process-review-scale-notice"><div><strong>College rating scale awaited</strong><p>Evidence and drafts can be saved now. An administrator must configure the college scale before this review can be submitted.</p>{detail && canEdit ? <Button disabled={saving} onClick={() => void save(false)}>Save draft and refresh form settings</Button> : null}</div></div> : null}
      <div className="process-review-footer"><div className="toolbar">{step > 0 ? <Button icon={ArrowLeft} disabled={saving || Boolean(followUpBusy)} onClick={() => setStep(step - 1)}>Previous</Button> : null}{step < steps.length - 1 ? <Button disabled={saving || Boolean(followUpBusy)} onClick={() => setStep(step + 1)}>Continue <ArrowRight size={16} aria-hidden="true" /></Button> : null}</div><div className="toolbar">{canEdit ? <><Button busy={saving} disabled={actionBusy || Boolean(followUpBusy)} icon={Save} onClick={() => void save(false)}>{detail?.status === "submitted" ? "Save changes" : "Save draft"}</Button>{step === steps.length - 1 ? <Button busy={saving} disabled={scaleMissing || actionBusy || Boolean(followUpBusy)} icon={Send} variant="primary" onClick={() => void save(true)}>Submit review</Button> : null}</> : null}</div></div>
    </section></div>
    {!digital && detail && (Object.keys(detail.data.fields).length > 0 || snapshotCount > 0) ? <ActivateHistoricalData detail={detail} /> : null}
  </div>;
}

type ReviewFieldsProps = {
  request: SaveProcessReviewRequest; setRequest: (patch: Partial<SaveProcessReviewRequest> | ((current: SaveProcessReviewRequest) => Partial<SaveProcessReviewRequest>)) => void;
  field: (key: string, value: string) => void; label: (key: string, fallback: string) => string;
  orgUnits: OrgUnitSummary[]; staff: StaffSummary[]; user: CurrentUser; detail: ProcessReviewDetail | null;
  configuration: ProcessReviewConfiguration;
};

function ActivateReviewFollowUps({ detail, canCreate, blocked, busy, onAdd, onOpen, onSave }: {
  detail: ProcessReviewDetail | null; canCreate: boolean; blocked: boolean; busy: boolean;
  onAdd: () => void; onOpen: (id: string) => void; onSave: () => void;
}) {
  const ready = Boolean(detail?.data.activate && detail.facultyOrgUnitId && detail.selectedSubTeams?.length);
  return <section className="panel activate-review-links">
    {detail?.isFollowUp ? <div className="form-stack"><h2>Previous review</h2>{detail.parentReview ? <div className="process-review-row"><div><strong>{detail.parentReview.title}</strong><p className="muted-copy">{displayDate(detail.parentReview.recordDate)} · {detail.parentReview.status === "submitted" ? "Submitted" : "Draft"}</p></div><Button disabled={busy} onClick={() => onOpen(detail.parentReview!.recordId)}>Open previous review</Button></div> : <p className="muted-copy">The review remains linked. Details of the previous review require permission to view it.</p>}</div> : null}
    <div className="process-review-row"><div><h2>Follow-up review</h2><p className="muted-copy">Create a linked review with the same teams and participants. Previous results remain available as reference, with fresh notes and the existing actions.</p></div>
      {detail && ready && detail.canEdit && canCreate && !detail.followUpReviews?.length ? <Button icon={Plus} busy={busy} disabled={blocked} onClick={onAdd}>Add follow-up review</Button> : null}
    </div>
    {!detail ? <div className="notice-row"><p>Save this review before adding its follow-up.</p>{canCreate ? <Button icon={Save} disabled={busy} onClick={onSave}>Save review draft</Button> : null}</div> : detail.followUpReviews?.length ? detail.followUpReviews.map(review => <div className="process-review-row" key={review.recordId}><div><strong>{review.title}</strong><p className="muted-copy">{displayDate(review.recordDate)} · {review.status === "submitted" ? "Submitted" : "Draft"}</p></div><Button disabled={busy} onClick={() => onOpen(review.recordId)}>Open follow-up review</Button></div>) : !ready ? <p className="muted-copy">Choose and save the review's teams before adding its follow-up.</p> : <p className="muted-copy">No follow-up has been added yet.</p>}
    {blocked && detail?.canEdit ? <p className="muted-copy">Save or cancel the current edits before adding a follow-up.</p> : null}
  </section>;
}

function TextField({ label, value, onChange, type = "text", help, maxLength = 1000, min }: { label: string; value: string; onChange: (value: string) => void; type?: string; help?: string; maxLength?: number; min?: number }) {
  const id = useId();
  return <label className="entry-field" htmlFor={id}><span>{label}</span><input id={id} type={type} value={value} maxLength={maxLength} min={min} onChange={event => onChange(event.target.value)} aria-describedby={help ? `${id}-help` : undefined} />{help ? <small id={`${id}-help`}>{help}</small> : null}</label>;
}
function Narrative({ label, value, onChange, help, maxLength = 10000, disabled = false }: { label: string; value: string; onChange: (value: string) => void; help?: string; maxLength?: number; disabled?: boolean }) {
  const id = useId();
  return <label className="entry-field" htmlFor={id}><span>{label}</span><textarea id={id} value={value} disabled={disabled} rows={4} maxLength={maxLength} onChange={event => onChange(event.target.value)} aria-describedby={help ? `${id}-help` : undefined} />{help ? <small id={`${id}-help`}>{help}</small> : null}</label>;
}
function ExternalEvidence({ value, children }: { value?: string | null; children: ReactNode }) {
  const href = processReviewSafeLink(value);
  return href ? <a className="process-review-external" href={href} target="_blank" rel="noreferrer">{children}<ExternalLink size={15} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a> : null;
}
function Notes({ fieldKey, fallback, request, field, label, help }: Pick<ReviewFieldsProps, "request" | "field" | "label"> & { fieldKey: string; fallback: string; help?: string }) {
  return <Narrative label={label(fieldKey, fallback)} value={request.data.fields[fieldKey] || ""} onChange={value => field(fieldKey, value)} help={help} />;
}
function StaffSetField({ label, staff, ids, onChange, removeLabel = "Remove attendee" }: { label: string; staff: StaffSummary[]; ids: string[]; onChange: (ids: string[]) => void; removeLabel?: string }) {
  const id = useId();
  return <div className="process-review-staff-selection"><span className="process-review-field-label">{label}</span>{ids.map(staffId => <div className="process-review-row" key={staffId}><span>{staff.find(person => person.id === staffId)?.displayName || "Saved staff member"}</span><Button variant="quiet" onClick={() => onChange(ids.filter(value => value !== staffId))}>{removeLabel}</Button></div>)}<StaffSearchSelect id={`${id}-attendees`} label={label} value="" staff={staff.filter(person => !ids.includes(person.id))} onChange={staffId => { if (staffId) onChange([...ids, staffId]); }} /></div>;
}
function ReviewContext(props: ReviewFieldsProps & { digital: boolean }) {
  const { request, setRequest, orgUnits, label } = props;
  const faculties = orgUnits.filter(unit => unit.orgUnitType.toLowerCase() === "faculty" && (unit.isActive || unit.id === request.facultyOrgUnitId));
  const teams = orgUnits.filter(unit => unit.orgUnitType.toLowerCase() === "team" && (!request.facultyOrgUnitId || unit.parentOrgUnitId === request.facultyOrgUnitId || unit.id === request.teamOrgUnitId) && (unit.isActive || unit.id === request.teamOrgUnitId));
  return <div className="form-stack"><p className="muted-copy">One team or area review, supported by several samples. The review owner is recorded automatically.</p><div className="form-grid form-grid-two">
    <TextField label={label("title", "Review title")} value={request.title} onChange={title => setRequest({ title })} maxLength={300} />
    <label className="entry-field"><span>{label("faculty", "Faculty")}</span><select value={request.facultyOrgUnitId || ""} onChange={event => setRequest({ facultyOrgUnitId: event.target.value || undefined, teamOrgUnitId: undefined })}><option value="">Select faculty</option>{request.facultyOrgUnitId && !faculties.some(unit => unit.id === request.facultyOrgUnitId) ? <option value={request.facultyOrgUnitId}>Saved faculty</option> : null}{faculties.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
    <label className="entry-field"><span>{label("team", "Team / area")}</span><select value={request.teamOrgUnitId || ""} onChange={event => setRequest({ teamOrgUnitId: event.target.value || undefined })}><option value="">Select team / area</option>{request.teamOrgUnitId && !teams.some(unit => unit.id === request.teamOrgUnitId) ? <option value={request.teamOrgUnitId}>Saved team / area</option> : null}{teams.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
    <TextField label={label("recordDate", "Review date")} type="date" value={request.recordDate || ""} onChange={recordDate => setRequest({ recordDate: recordDate || undefined })} />
  </div><Notes {...props} fieldKey="scope" fallback="Scope and context" /></div>;
}

function DigitalSamples({ data, onChange, staff }: { data: ProcessReviewData; onChange: (patch: Partial<ProcessReviewData>) => void; staff: StaffSummary[] }) {
  function update(id: string, patch: Partial<ProcessReviewSample>) { onChange({ samples: data.samples.map(sample => sample.id === id ? { ...sample, ...patch } : sample) }); }
  return <div className="form-stack"><p className="muted-copy">Record the samples used across the review. A sample can support more than one statement; it does not receive a separate rating.</p>{data.samples.length === 0 ? <p className="process-review-empty">No samples have been added.</p> : data.samples.map((sample, index) => <section className="process-review-sample" key={sample.id}><div className="process-review-row"><h3>Sample {index + 1}</h3><Button icon={Trash2} variant="quiet" onClick={() => onChange(removeProcessReviewSample(data, sample.id))}>Remove sample {index + 1}</Button></div><div className="form-grid form-grid-two"><TextField label="Sample title" value={sample.title} onChange={title => update(sample.id, { title })} maxLength={300} /><label className="entry-field"><span>Sample type</span><select value={sample.sampleType} onChange={event => update(sample.id, { sampleType: event.target.value })}><option value="digital_classroom">Digital classroom</option><option value="learner_work">Learner work</option><option value="observation">Observation</option><option value="discussion">Discussion</option><option value="other">Other</option>{sample.sampleType && !["digital_classroom", "learner_work", "observation", "discussion", "other"].includes(sample.sampleType) ? <option value={sample.sampleType}>{sample.sampleType}</option> : null}</select></label><TextField label="Sample date" type="date" value={sample.sampleDate || ""} onChange={sampleDate => update(sample.id, { sampleDate: sampleDate || undefined })} /><TextField label="Course / group" value={sample.course || ""} onChange={course => update(sample.id, { course })} /></div><div className="process-review-staff-selection"><span className="process-review-field-label">Associated staff</span>{sample.staffIds.map(staffId => <div className="process-review-row" key={staffId}><span>{staff.find(person => person.id === staffId)?.displayName || "Saved staff member"}</span><Button variant="quiet" onClick={() => update(sample.id, { staffIds: sample.staffIds.filter(id => id !== staffId) })}>Remove staff</Button></div>)}<StaffSearchSelect id={`sample-${sample.id}-staff`} label={`Add staff to sample ${index + 1}`} staff={staff.filter(person => !sample.staffIds.includes(person.id))} value="" onChange={staffId => { if (staffId) update(sample.id, { staffIds: [...sample.staffIds, staffId] }); }} /></div><TextField label="Evidence link" type="url" value={sample.evidenceLink || ""} onChange={evidenceLink => update(sample.id, { evidenceLink })} /><ExternalEvidence value={sample.evidenceLink}>Open sample evidence</ExternalEvidence><Narrative label="Evidence notes" value={sample.notes || ""} onChange={notes => update(sample.id, { notes })} /></section>)}<Button icon={Plus} onClick={() => onChange({ samples: [...data.samples, { id: crypto.randomUUID(), title: "", sampleType: "learner_work", staffIds: [] }] })}>Add sample</Button></div>;
}

function DigitalStatements({ configuration, data, selected, setSelected, onChange, readOnly }: { readOnly: boolean; configuration: ProcessReviewConfiguration; data: ProcessReviewData; selected: number; setSelected: (value: number) => void; onChange: (responses: ProcessReviewResponse[]) => void }) {
  const standards = configuration.standards;
  const standard = standards[selected] || standards[0];
  function update(key: string, patch: Partial<ProcessReviewResponse>) {
    const existing = data.responses.find(response => response.statementKey === key);
    const next: ProcessReviewResponse = { statementKey: key, sampleIds: [], ...existing, ...patch };
    onChange(existing ? data.responses.map(response => response.statementKey === key ? next : response) : [...data.responses, next]);
  }
  return <div className="form-stack"><p className="muted-copy">One overall rating per statement, informed by its linked samples.</p><nav className="process-review-standards" aria-label="Digital standards">{standards.map((item, index) => <button type="button" aria-pressed={selected === index} aria-label={`Standard ${index + 1}: ${item.title}`} key={item.key} onClick={() => setSelected(index)}>{index + 1}</button>)}</nav>{standard ? <><h3>{selected + 1}. {standard.title}</h3>{standard.statements.map((statement, index) => {
    const response = data.responses.find(item => item.statementKey === statement.key);
    return <section className="process-review-statement" key={statement.key}><h3>{selected + 1}.{index + 1} · {statement.text}</h3><label className="entry-field"><span>Overall statement rating</span><select disabled={readOnly || !configuration.ratingOptions.length} aria-label={`Rating for statement ${selected + 1}.${index + 1}`} value={response?.ratingKey || ""} onChange={event => update(statement.key, { ratingKey: event.target.value || undefined })}><option value="">{configuration.ratingOptions.length ? "Select rating" : "College scale to be configured"}</option>{response?.ratingKey && !configuration.ratingOptions.some(rating => rating.key === response.ratingKey) ? <option value={response.ratingKey}>Saved rating · {response.ratingKey}</option> : null}{configuration.ratingOptions.map(rating => <option value={rating.key} key={rating.key}>{rating.label}</option>)}</select></label><details className="process-review-evidence" open={Boolean(response?.sampleIds.length)}><summary>Linked samples · {response?.sampleIds.length || 0}</summary>{!data.samples.length ? <p>Add a sample in the Samples section, then link it here.</p> : data.samples.map((sample, sampleIndex) => <label className="process-review-check" key={sample.id}><input type="checkbox" disabled={readOnly} checked={Boolean(response?.sampleIds.includes(sample.id))} onChange={event => update(statement.key, { sampleIds: event.target.checked ? [...new Set([...(response?.sampleIds || []), sample.id])] : (response?.sampleIds || []).filter(id => id !== sample.id) })} /><span>Sample {sampleIndex + 1} · {sample.title || "Untitled sample"}</span></label>)}</details><Narrative disabled={readOnly} label="Evidence and rationale" value={response?.rationale || ""} onChange={rationale => update(statement.key, { rationale })} /></section>;
  })}</> : <p>No question framework is configured. Contact an administrator before submitting this review.</p>}</div>;
}

function ActivateReviewContextFields(props: ReviewFieldsProps) {
  const { request, setRequest, orgUnits, staff, detail, label } = props;
  const data = activateData(request);
  const [context, setContext] = useState<ActivateReviewContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState("");
  const [areaFilter, setAreaFilter] = useState("all");
  const sequence = useRef(0);
  const previousContext = useRef<ActivateReviewContext | null>(null);
  const scopeKey = activateScopeKey(request);
  const faculties = orgUnits.filter(unit => unit.orgUnitType === "faculty" && (unit.isActive || unit.id === request.facultyOrgUnitId));
  useEffect(() => {
    if (!request.facultyOrgUnitId) { setContext(null); setLoading(false); setError(""); return; }
    if (detail && (!detail.canEdit || detail.isFollowUp)) {
      const participants = detail.isFollowUp ? detail.data.activate?.automaticParticipants || detail.participants?.filter(person => person.isLocked || person.roles.includes("Programme leader")) || [] : detail.participants || [];
      setContext({ facultyOrgUnitId: detail.facultyOrgUnitId || "", facultyName: detail.facultyName || "Saved faculty", availableSubTeams: detail.selectedSubTeams || [], selectedSubTeamOrgUnitIds: data.subTeamOrgUnitIds, participants, warnings: [] });
      return;
    }
    const version = ++sequence.current;
    setLoading(true); setError("");
    setContext(current => current?.facultyOrgUnitId === request.facultyOrgUnitId ? current : null);
    void api.activateReviewContext({ facultyOrgUnitId: request.facultyOrgUnitId, allSubTeams: data.allSubTeams,
      subTeamOrgUnitIds: data.subTeamOrgUnitIds, recordDate: request.recordDate, recordId: detail?.recordId }).then(result => {
      if (version !== sequence.current) return;
      if (!result.ok || !result.data) { setError(result.message || "The selected area and its participants could not be checked. Try again."); return; }
      const nextContext = result.data;
      const previousAutomatic = new Set(previousContext.current?.participants.filter(person => person.isLocked || person.roles.some(role => /creator|owner|head[ _]of[ _]faculty|programme[ _]leader/i.test(role))).map(person => person.staffId) || []);
      setContext(nextContext); previousContext.current = nextContext;
      setRequest(current => {
        if (activateScopeKey(current) !== scopeKey) return {};
        return activateContextPatch(current, nextContext, [...previousAutomatic]);
      });
    }).catch(cause => { if (version === sequence.current) setError(cause instanceof Error ? cause.message : "Participants could not be checked."); })
      .finally(() => { if (version === sequence.current) setLoading(false); });
    return () => { sequence.current++; };
  }, [scopeKey, detail?.recordId, detail?.canEdit, retry]);

  function update(patch: Partial<ActivateGrowthReviewData>) { setRequest(current => { const next = { ...activateData(current), ...patch }; return { ...(patch.subTeamOrgUnitIds ? { teamOrgUnitId: undefined } : {}), data: { ...current.data, activate: next } }; }); }
  function changeFaculty(facultyOrgUnitId: string) {
    const oldAutomatic = new Set(context?.participants.filter(person => person.isLocked || person.roles.some(role => /creator|owner|head[ _]of[ _]faculty|programme[ _]leader/i.test(role))).map(person => person.staffId) || []);
    setAreaFilter("all"); setSearch("");
    setRequest(current => ({ facultyOrgUnitId: facultyOrgUnitId || undefined, teamOrgUnitId: undefined,
      data: { ...current.data, activate: { ...activateData(current), allSubTeams: true, subTeamOrgUnitIds: [], removedProgrammeLeaderStaffIds: [], participantStaffIds: activateData(current).participantStaffIds.filter(id => !oldAutomatic.has(id)) } } }));
  }
  const groups = context ? activateSubTeamGroups(context) : [];
  const selectedIds = new Set(data.allSubTeams ? context?.selectedSubTeamOrgUnitIds || data.subTeamOrgUnitIds : data.subTeamOrgUnitIds);
  const currentContext = context?.facultyOrgUnitId === request.facultyOrgUnitId ? context : null;
  const defaultIds = new Set(currentContext?.participants.map(person => person.staffId) || []);
  const selectedParticipants = currentContext ? activateParticipantIds(currentContext, data.participantStaffIds, data.removedProgrammeLeaderStaffIds) : data.participantStaffIds;
  const visibleParticipants = currentContext?.participants.filter(person => selectedParticipants.includes(person.staffId)) || [];
  const extraIds = selectedParticipants.filter(id => !defaultIds.has(id));
  function removeParticipant(staffId: string, programmeLeader: boolean) {
    update({ participantStaffIds: data.participantStaffIds.filter(id => id !== staffId), removedProgrammeLeaderStaffIds: programmeLeader ? [...new Set([...data.removedProgrammeLeaderStaffIds, staffId])] : data.removedProgrammeLeaderStaffIds });
  }
  return <div className="form-stack">
    <p className="muted-copy">Choose the review area and the people taking part. The creator is required; faculty leadership is filled from the organisation structure.</p>
    <div className="form-grid form-grid-two"><TextField label={label("title", "Review title")} value={request.title} onChange={title => setRequest({ title })} maxLength={300} /><label className="entry-field"><span>Faculty</span><select disabled={detail?.isFollowUp} value={request.facultyOrgUnitId || ""} onChange={event => changeFaculty(event.target.value)}><option value="">Select faculty</option>{request.facultyOrgUnitId && !faculties.some(unit => unit.id === request.facultyOrgUnitId) ? <option value={request.facultyOrgUnitId}>{detail?.facultyName || "Saved faculty"}</option> : null}{faculties.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label><TextField label={label("recordDate", "Review conducted")} type="date" value={request.recordDate || ""} onChange={recordDate => setRequest({ recordDate: recordDate || undefined })} /></div>
    {detail?.isFollowUp ? <section className="activate-scope"><h3>Linked review scope</h3><p className="muted-copy">{detail.facultyName} · {detail.selectedSubTeams?.map(team => team.name).join("; ") || "Saved review scope"}</p><p className="muted-copy">The follow-up retains the previous review's teams so its results and actions stay linked.</p></section> : request.facultyOrgUnitId ? <section className="activate-scope"><div className="process-review-row"><h3>Area and sub-teams</h3><Button aria-pressed={data.allSubTeams} variant={data.allSubTeams ? "primary" : "secondary"} onClick={() => { setAreaFilter("all"); update({ allSubTeams: !data.allSubTeams, subTeamOrgUnitIds: data.allSubTeams ? [...selectedIds] : currentContext?.selectedSubTeamOrgUnitIds || data.subTeamOrgUnitIds }); }}>{data.allSubTeams ? "All sub-teams selected" : "Select all sub-teams"}</Button></div>{groups.length > 1 ? <label className="entry-field"><span>Area</span><select value={areaFilter} onChange={event => { const value = event.target.value; setAreaFilter(value); if (value !== "all") update({ allSubTeams: false, subTeamOrgUnitIds: groups.find(group => group.id === value)?.teams.map(team => team.orgUnitId) || [] }); }}><option value="all">All areas in this faculty</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label> : null}<label className="entry-field"><span>Find a sub-team</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>{groups.filter(group => areaFilter === "all" || group.id === areaFilter).map(group => <fieldset className="activate-subteam-group" key={group.id}><legend>{group.name}</legend>{group.teams.filter(team => `${team.name} ${group.name}`.toLowerCase().includes(search.trim().toLowerCase())).map(team => <label className="process-review-check" key={team.orgUnitId}><input type="checkbox" checked={selectedIds.has(team.orgUnitId)} onChange={event => { const ids = new Set(selectedIds); if (event.target.checked) ids.add(team.orgUnitId); else ids.delete(team.orgUnitId); update({ allSubTeams: false, subTeamOrgUnitIds: [...ids] }); }} /><span>{team.name}</span></label>)}</fieldset>)}{!groups.length && !loading ? <p className="muted-copy">No sub-teams are available for this faculty.</p> : null}</section> : null}
    {loading ? <p role="status">Checking the selected area and its participants…</p> : null}
    {error ? <div role="alert"><p>{error}</p><Button onClick={() => setRetry(value => value + 1)}>Try again</Button></div> : null}
    {!loading && !error && currentContext ? <section className="form-stack"><h3>Participants</h3>{currentContext.warnings.map(warning => <p className="notice-row" key={warning}>{warning}</p>)}<div className="activate-participants">{visibleParticipants.map(person => <div className="activate-participant" key={person.staffId}><div><strong>{person.displayName}</strong><small>{person.roles.map(role => (({ creator: "Review creator", review_owner: "Review creator", head_of_faculty: "Head of Faculty", programme_leader: "Programme Leader" } as Record<string, string>)[role] || role.replaceAll("_", " "))).join(" · ")}{person.orgUnitNames.length ? ` · ${person.orgUnitNames.join(", ")}` : ""}</small></div>{person.isLocked ? <span className="status-chip">Required</span> : <Button variant="quiet" onClick={() => removeParticipant(person.staffId, true)}>Remove</Button>}</div>)}{extraIds.map(staffId => <div className="activate-participant" key={staffId}><strong>{staff.find(person => person.id === staffId)?.displayName || detail?.participants?.find(person => person.staffId === staffId)?.displayName || "Saved participant"}</strong><Button variant="quiet" onClick={() => removeParticipant(staffId, false)}>Remove</Button></div>)}</div>{currentContext.participants.filter(person => !person.isLocked && data.removedProgrammeLeaderStaffIds.includes(person.staffId)).map(person => <div className="process-review-row" key={person.staffId}><span>{person.displayName} · removed from this review</span><Button variant="quiet" onClick={() => update({ removedProgrammeLeaderStaffIds: data.removedProgrammeLeaderStaffIds.filter(id => id !== person.staffId), participantStaffIds: [...new Set([...data.participantStaffIds, person.staffId])] })}>Restore Programme Leader</Button></div>)}<label className="entry-field"><span>Add another participant</span><StaffSearchSelect id="activate-extra-participant" label="Add participant" value="" staff={staff.filter(person => !selectedParticipants.includes(person.id))} onChange={staffId => { if (staffId) update({ participantStaffIds: [...new Set([...selectedParticipants, staffId])], removedProgrammeLeaderStaffIds: data.removedProgrammeLeaderStaffIds.filter(id => id !== staffId) }); }} /></label></section> : null}
  </div>;
}

function ActivateSkillsScan({ request, setRequest, configuration, detail }: ReviewFieldsProps) {
  const data = activateData(request);
  const pillars = configuration.skillsScanPillars || [];
  const previous = detail?.parentReviewContext;
  const [enterResults, setEnterResults] = useState(!detail?.isFollowUp || Object.values(data.skillsScanScores).some(value => value !== null));
  const validScore = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 5;
  return <div className="form-stack">
    {detail?.isFollowUp ? <>
      <p className="muted-copy">The previous review's results are reference information. Add a fresh Skills Scan only when new averages are available; the follow-up can be completed without repeating it.</p>
      {previous ? <details className="activate-previous-review" open><summary>Previous Skills Scan results · {previous.review.title} · {displayDate(previous.review.recordDate)}</summary>
        <div className="activate-skills-pillars">{(previous.configuration.skillsScanPillars || []).map(pillar => {
          const mean = activatePillarAverage(pillar, previous.skillsScanScores);
          return <section className="activate-skills-pillar" key={pillar.key}><div className="process-review-row"><h3>{pillar.title}</h3><strong>{mean === null ? "Awaiting remaining results" : `${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(mean)} / 5`}</strong></div>
            {mean !== null ? <SkillsScanResultBar value={mean} label={`${pillar.title} previous pillar average`} /> : null}
            <dl className="process-review-summary">{pillar.subAreas.map(area => <div key={area.key}><dt>{area.title}</dt><dd>{previous.skillsScanScores[area.key] ?? "Not entered"}</dd></div>)}</dl>
          </section>;
        })}</div>
      </details> : <p className="notice-row">Previous review results are available only to people with permission to view that review.</p>}
      <label className="process-review-check"><input type="checkbox" checked={enterResults} onChange={event => setEnterResults(event.target.checked)} /><span>Add new Skills Scan results for this follow-up</span></label>
      {!enterResults && Object.values(data.skillsScanScores).some(value => value !== null) ? <p className="muted-copy">Your entered results are retained. Reopen this section to amend them.</p> : null}
    </> : <><p className="muted-copy">Enter the 15 sub-area averages from the Skills Scan results. Use decimal values from 1 to 5; leave missing results blank.</p><p className="muted-copy">Each pillar shows the unweighted mean of its sub-area averages once all of them are entered. Missing results do not count as zero.</p></>}
    {enterResults ? <div className="activate-skills-pillars">{pillars.map((pillar, index) => {
      const mean = activatePillarAverage(pillar, data.skillsScanScores);
      const completed = pillar.subAreas.filter(area => validScore(data.skillsScanScores[area.key])).length;
      return <section className="activate-skills-pillar" key={pillar.key}>
        <div className="process-review-row"><h3>{index + 1}. {pillar.title}</h3><span className="activate-pillar-value">{mean === null ? `${completed} / ${pillar.subAreas.length} entered` : `${new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(mean)} / 5`}</span></div>
        {pillar.subAreas.map(area => {
          const score = data.skillsScanScores[area.key];
          return <div className="activate-skills-score" key={area.key}>
            <label className="entry-field"><span>{area.title}</span><input aria-label={`${area.title} average`} type="number" inputMode="decimal" min={1} max={5} step="any" value={score ?? ""} onChange={event => {
              const value = event.target.value === "" ? null : Number(event.target.value);
              setRequest(current => ({ data: { ...current.data, activate: { ...activateData(current), skillsScanScores: { ...activateData(current).skillsScanScores, [area.key]: value } } } }));
            }} /></label>
            {validScore(score) ? <SkillsScanResultBar value={score} label={`${area.title} average`} /> : <span className="muted-copy">{score === null || score === undefined ? "Not entered" : "Enter a value from 1 to 5"}</span>}
          </div>;
        })}
        {mean !== null ? <SkillsScanResultBar value={mean} label={`${pillar.title} pillar average`} /> : null}
        <p className="muted-copy">{mean === null ? "Pillar average pending all sub-area results." : `Pillar average: ${new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(mean)} / 5 · unweighted sub-area averages`}</p>
      </section>;
    })}</div> : null}
    {!pillars.length ? <p className="notice-row">The Skills Scan framework is unavailable. Save your draft and refresh the form settings.</p> : null}
  </div>;
}

function ActivateMeetingMinutes({ request, setRequest, label, detail }: ReviewFieldsProps) {
  function update(key: "meetingMinutes" | "strengths" | "development", value: string) { setRequest(current => ({ data: { ...current.data, activate: { ...activateData(current), [key]: value } } })); }
  const data = activateData(request);
  return <div className="form-stack">{detail?.parentReviewContext ? <details className="activate-previous-review"><summary>Previous meeting notes · reference only</summary><dl className="process-review-summary"><div><dt>Minutes</dt><dd className="process-review-preserve">{detail.parentReviewContext.meetingMinutes || "Not recorded"}</dd></div><div><dt>Strengths</dt><dd className="process-review-preserve">{detail.parentReviewContext.strengths || "Not recorded"}</dd></div><div><dt>Areas for development</dt><dd className="process-review-preserve">{detail.parentReviewContext.development || "Not recorded"}</dd></div></dl></details> : null}<Narrative label={detail?.isFollowUp ? "Follow-up meeting notes" : label("meetingMinutes", "Meeting minutes")} value={data.meetingMinutes || ""} onChange={value => update("meetingMinutes", value)} /><Narrative label={label("strengths", "Strengths")} value={data.strengths || ""} onChange={value => update("strengths", value)} /><Narrative label={label("development", "Areas for development")} value={data.development || ""} onChange={value => update("development", value)} /></div>;
}

function ActivateHistoricalData({ detail }: { detail: ProcessReviewDetail }) {
  const labels = (detail.legacyConfiguration || detail.configuration).fieldLabels;
  return <details className="panel process-review-history"><summary>Historical review data · read only</summary><p className="muted-copy">Earlier review fields and snapshots are retained here.</p>{Object.entries(detail.data.fields).filter(([, value]) => value.trim()).map(([key, value]) => <div key={key}><h3>{labels[key] || key.replaceAll("_", " ")}</h3>{processReviewSafeLink(value) ? <ExternalEvidence value={value}>Open historical evidence</ExternalEvidence> : <p className="process-review-preserve">{value}</p>}</div>)}{detail.snapshots.map(snapshot => <details className="process-review-history" key={snapshot.snapshotId}><summary>{displayDate(snapshot.asOfDate)} · {snapshot.sourceMeeting} · {snapshot.recordedByName}</summary><ExternalEvidence value={snapshot.teamsLink}>Open historical source</ExternalEvidence>{Object.entries(snapshot.data.fields).filter(([, value]) => value.trim()).map(([key, value]) => <div key={key}><h3>{labels[key] || key.replaceAll("_", " ")}</h3><p className="process-review-preserve">{value}</p></div>)}</details>)}</details>;
}

function ReviewChecks({ request, detail, configuration, digital }: ReviewFieldsProps & { digital: boolean }) {
  if (!digital) return <ActivateReviewChecks request={request} detail={detail} configuration={configuration} />;
  const statements = configuration.standards.flatMap(standard => standard.statements);
  const rated = statements.filter(statement => request.data.responses.some(response => response.statementKey === statement.key && configuration.ratingOptions.some(rating => rating.key === response.ratingKey))).length;
  const evidenced = statements.filter(statement => request.data.responses.some(response => response.statementKey === statement.key && response.sampleIds.some(id => request.data.samples.some(sample => sample.id === id)))).length;
  return <div className="form-stack"><p className="muted-copy">Check the review before formal submission. Saving a draft preserves unfinished work.</p><dl className="process-review-summary"><div><dt>Review</dt><dd>{request.title || "Title not yet entered"}</dd></div><div><dt>Faculty / area</dt><dd>{request.facultyOrgUnitId ? "Faculty selected" : "Faculty still required"}{request.teamOrgUnitId ? " · team / area selected" : " · team / area still required"}</dd></div><div><dt>Review owner</dt><dd>{detail?.ownerName || "Set from the signed-in person on creation"}</dd></div><div><dt>Samples</dt><dd>{request.data.samples.length}</dd></div><div><dt>Statements rated</dt><dd>{rated} / {statements.length}</dd></div><div><dt>Statements with linked evidence</dt><dd>{evidenced} / {statements.length}</dd></div><div><dt>Native actions</dt><dd>{detail?.actions.length || 0} · maintained separately from the review narrative</dd></div></dl>{configuration.settings.requireSamplePerRating !== "false" ? <p className="muted-copy">Each rating needs at least one linked sample. Sample volume does not weight the rating.</p> : null}{configuration.settings.requireRationale === "true" ? <p className="muted-copy">Rationale is required for every statement.</p> : null}</div>;
}

function emptyAction(): SaveProcessReviewActionRequest {
  return { title: "", themeKey: "", ownerStaffId: "", dueDate: "", supportRequired: "", successEvidence: "", progress: "open", impactStatus: "awaiting_evidence" };
}

type ProcessReviewActionsProps = {
  detail: ProcessReviewDetail | null; configuration: ProcessReviewConfiguration; staff: StaffSummary[];
  onDirtyChange: (dirty: boolean) => void; onSavingChange: (saving: boolean) => void;
  onChanged: (detail: ProcessReviewDetail) => Promise<void>; onSaveReview: () => Promise<boolean>;
  reviewSaving: boolean; reviewScopeDirty?: boolean;
};

function ProcessReviewActions(props: ProcessReviewActionsProps) {
  return props.configuration.processKey === "activate_growth_review" ? <ActivateReviewActions {...props} /> : <DigitalReviewActions {...props} />;
}

function ActivateReviewChecks({ request, detail, configuration }: Pick<ReviewFieldsProps, "request" | "detail" | "configuration">) {
  const data = activateData(request);
  const areas = configuration.skillsScanPillars?.flatMap(pillar => pillar.subAreas) || [];
  const entered = areas.filter(area => { const value = data.skillsScanScores[area.key]; return typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 5; }).length;
  return <div className="form-stack"><p className="muted-copy">Check the scope, participants, Skills Scan results, minutes and agreed actions before submitting.</p><dl className="process-review-summary"><div><dt>Review</dt><dd>{request.title || "Title not yet entered"}</dd></div><div><dt>Area</dt><dd>{request.facultyOrgUnitId ? data.allSubTeams ? "All sub-teams in the selected faculty" : `${data.subTeamOrgUnitIds.length} selected sub-teams` : "Faculty not yet selected"}</dd></div><div><dt>Review conducted</dt><dd>{displayDate(request.recordDate)}</dd></div><div><dt>Follow-up reviews</dt><dd>{detail?.followUpReviews?.length || 0} linked</dd></div><div><dt>Participants</dt><dd>{data.participantStaffIds.length} · automatic roles follow the organisation structure</dd></div><div><dt>Skills Scan averages</dt><dd>{entered} / {areas.length || 15} entered · missing results stay blank</dd></div><div><dt>Meeting minutes</dt><dd>{data.meetingMinutes?.trim() ? "Recorded" : "Not yet recorded"}</dd></div><div><dt>Strengths</dt><dd>{data.strengths?.trim() ? "Recorded" : "Not yet recorded"}</dd></div><div><dt>Areas for development</dt><dd>{data.development?.trim() ? "Recorded" : "Not yet recorded"}</dd></div><div><dt>Actions</dt><dd>{detail?.actions.length || 0} · named responsible people, impact measures and review dates</dd></div></dl><p className="muted-copy">A pillar average is available only when all of its sub-area averages have been entered. Activity progress is maintained through Actions.</p></div>;
}

function ActivateReviewActions({ detail, configuration, staff, onChanged, onSaveReview, reviewSaving, onDirtyChange, onSavingChange, reviewScopeDirty = false }: ProcessReviewActionsProps) {
  const [form, setForm] = useState<SaveProcessReviewActionRequest | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [baseline, setBaseline] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"success" | "error" | "neutral">("neutral");
  const lock = useRef(false);
  const dirty = form !== null && JSON.stringify(form) !== baseline;
  const clear = useUnsavedChanges({ label: "Activate+ action", dirty, saving, onSave: form ? saveAction : undefined,
    onDiscard: () => { setForm(null); setActionId(null); }, discardLabel: "Discard action edits" });
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onSavingChange(saving); }, [saving, onSavingChange]);
  const themes = configuration.actionThemes || [];
  const pillars = configuration.skillsScanPillars || [];
  const impactAreas = pillars.flatMap(pillar => pillar.subAreas);
  const original = detail?.actions.find(action => action.actionId === actionId);
  function start(action?: ProcessReviewAction) {
    const responsibleStaffIds = action?.responsibleStaffIds?.length ? action.responsibleStaffIds : action ? [action.ownerStaffId] : [];
    const next: SaveProcessReviewActionRequest = action ? {
      title: action.title, themeKey: action.themeKey, ownerStaffId: action.ownerStaffId, dueDate: action.dueDate,
      supportRequired: action.supportRequired, successEvidence: action.successEvidence, progress: action.progress,
      impactStatus: action.impactStatus, impactEvidence: action.impactEvidence, impactEvidenceLink: action.impactEvidenceLink,
      rowVersion: action.rowVersion, responsibleStaffIds, impactAreaKey: action.impactAreaKey || "",
      detail: action.detail || action.title, reviewDate: action.reviewDate || action.dueDate
    } : { ...emptyAction(), responsibleStaffIds: [], detail: "", impactAreaKey: "", reviewDate: "" };
    setForm(next); setBaseline(JSON.stringify(next)); setActionId(action?.actionId || null); setMessage("");
  }
  function update(patch: Partial<SaveProcessReviewActionRequest>) { setForm(current => current ? { ...current, ...patch } : current); }
  async function saveAction(): Promise<boolean> {
    if (!form || !detail || lock.current) return false;
    if (reviewScopeDirty) { setTone("error"); setMessage("Save the review scope before assigning or amending its actions."); return false; }
    lock.current = true; setSaving(true); setMessage("");
    try {
      const sourceRecordId = original?.recordId || detail.recordId;
      const actionRequest = { ...form,
        ownerStaffId: form.responsibleStaffIds?.[0] || form.ownerStaffId,
        dueDate: form.reviewDate || form.dueDate, title: (form.detail || form.title).trim().slice(0, 300) };
      let updatedReview: ProcessReviewDetail;
      if (sourceRecordId !== detail.recordId && actionId) {
        const result = await api.updateAssignedProcessReviewAction(actionId, actionRequest);
        if (!result.ok || !result.data) { setTone("error"); setMessage(result.message || "The action could not be saved. Your entries remain here."); return false; }
        updatedReview = { ...detail, actions: detail.actions.map(action => action.actionId === actionId ? result.data! : action) };
      } else {
        const result = await api.saveProcessReviewAction(sourceRecordId, actionId, actionRequest);
        if (!result.ok || !result.data) { setTone("error"); setMessage(result.message || "The action could not be saved. Your entries remain here."); return false; }
        updatedReview = result.data;
      }
      clear(); setForm(null); setActionId(null); setTone("success"); setMessage("Action saved."); await onChanged(updatedReview); return true;
    } catch (error) { setTone("error"); setMessage(error instanceof Error ? error.message : "The action could not be saved. Your entries remain here."); return false; }
    finally { lock.current = false; setSaving(false); }
  }
  return <div className="form-stack"><p className="muted-copy">Agree what will change, how its impact will be measured, who is responsible and when it will be reviewed.</p><WorkflowFeedback message={message} tone={tone} onDismiss={() => setMessage("")} />{!detail || reviewScopeDirty ? <div className="notice-row"><div><p>{detail ? "Save the updated review scope before changing its actions." : "Save this review as a draft before adding actions."}</p><Button disabled={reviewSaving || saving} icon={Save} onClick={() => void onSaveReview()}>Save review draft</Button></div></div> : null}{detail ? <>
    {detail.status === "draft" ? <p className="muted-copy">Assigned actions are available to their responsible people straight away, even while the review remains a draft.</p> : null}
    {!detail.actions.length ? <p className="process-review-empty">No actions have been agreed yet.</p> : detail.actions.map(action => <article className="process-review-action" key={action.actionId}><div className="process-review-row"><h3>{action.detail || action.title}</h3><span className="status-chip">{progressLabels[action.progress] || action.progress}</span></div><dl className="process-review-summary"><div><dt>Theme</dt><dd>{action.themeLabel || themes.find(theme => theme.key === action.themeKey)?.title || action.themeKey}</dd></div><div><dt>Area of impact</dt><dd>{action.impactAreaLabel || impactAreas.find(area => area.key === action.impactAreaKey)?.title || "Not recorded"}</dd></div><div><dt>Impact measures</dt><dd className="process-review-preserve">{action.successEvidence}</dd></div><div><dt>Responsible people</dt><dd>{action.responsibleStaff?.map(person => person.displayName).join(", ") || (action.responsibleStaffIds?.length ? action.responsibleStaffIds.map(id => staff.find(person => person.id === id)?.displayName || "Saved staff member").join(", ") : action.ownerName)}</dd></div><div><dt>Review date</dt><dd>{displayDate(action.reviewDate || action.dueDate)}</dd></div></dl><div className="toolbar">{action.canEdit ? <Button disabled={saving || reviewSaving || form !== null} onClick={() => start(action)}>Amend action</Button> : null}<a className="process-review-external" href={actionPath(action.actionId)} target="_blank" rel="noreferrer">Open in Actions <ExternalLink size={15} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a></div></article>)}
    {!form && detail.canEdit ? <Button icon={Plus} disabled={reviewSaving || saving || reviewScopeDirty} onClick={() => start()}>Add action</Button> : null}
    {form ? <section className="process-review-action-editor"><h3>{actionId ? "Amend action" : "New action"}</h3><fieldset className="process-review-fields" disabled={saving || reviewSaving}><div className="form-stack"><div className="form-grid form-grid-two"><label className="entry-field"><span>Theme</span><select value={form.themeKey} onChange={event => update({ themeKey: event.target.value })}><option value="">Select theme</option>{form.themeKey && !themes.some(theme => theme.key === form.themeKey) ? <option value={form.themeKey}>{original?.themeLabel || "Historical theme"}</option> : null}{themes.map(theme => <option key={theme.key} value={theme.key}>{theme.title}</option>)}</select></label><label className="entry-field"><span>Area of impact</span><select value={form.impactAreaKey || ""} onChange={event => update({ impactAreaKey: event.target.value })}><option value="">Select Skills Scan area</option>{pillars.map(pillar => <optgroup key={pillar.key} label={pillar.title}>{pillar.subAreas.map(area => <option key={area.key} value={area.key}>{area.title}</option>)}</optgroup>)}</select></label></div><Narrative label="Action detail" value={form.detail || ""} onChange={value => update({ detail: value, title: value.trim().slice(0, 300) })} /><Narrative label="Impact measures" maxLength={4000} value={form.successEvidence} onChange={successEvidence => update({ successEvidence })} /><StaffSetField label="Responsible people" staff={staff} ids={form.responsibleStaffIds || []} removeLabel="Remove person" onChange={responsibleStaffIds => update({ responsibleStaffIds, ownerStaffId: responsibleStaffIds[0] || "" })} /><TextField label="Review date" type="date" value={form.reviewDate || ""} onChange={reviewDate => update({ reviewDate, dueDate: reviewDate })} />{original && (original.reviewDate || original.dueDate) !== form.reviewDate ? <Narrative label="Reason for changing the review date" maxLength={1000} value={form.deadlineChangeReason || ""} onChange={deadlineChangeReason => update({ deadlineChangeReason })} /> : null}</div></fieldset><div className="toolbar"><Button disabled={reviewSaving || reviewScopeDirty} busy={saving} icon={Check} variant="primary" onClick={() => void saveAction()}>{actionId ? "Save action" : "Assign action"}</Button><Button disabled={saving || reviewSaving} onClick={() => { clear(); setForm(null); setActionId(null); }}>Cancel action edits</Button></div></section> : null}
  </> : null}</div>;
}

function DigitalReviewActions({ detail, configuration, staff, onChanged, onSaveReview, reviewSaving, onDirtyChange, onSavingChange }: { detail: ProcessReviewDetail | null; configuration: ProcessReviewConfiguration; staff: StaffSummary[]; onDirtyChange: (dirty: boolean) => void; onSavingChange: (saving: boolean) => void; onChanged: (detail: ProcessReviewDetail) => Promise<void>; onSaveReview: () => Promise<boolean>; reviewSaving: boolean }) {
  const [form, setForm] = useState<SaveProcessReviewActionRequest | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [baseline, setBaseline] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"success" | "error" | "neutral">("neutral");
  const lock = useRef(false);
  const dirty = form !== null && JSON.stringify(form) !== baseline;
  const clear = useUnsavedChanges({ label: "Review action", dirty, saving,
    onSave: form ? saveAction : undefined, onDiscard: () => { setForm(null); setActionId(null); },
    discardLabel: "Discard action edits", discardMessage: "Unsaved action edits are discarded. Previously saved actions remain in i-Elevate." });

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onSavingChange(saving); }, [saving, onSavingChange]);

  async function editAction(action?: ProcessReviewAction) {
    const next = action ? {
      title: action.title, themeKey: action.themeKey, ownerStaffId: action.ownerStaffId, dueDate: action.dueDate,
      supportRequired: action.supportRequired, successEvidence: action.successEvidence, progress: action.progress,
      impactStatus: action.impactStatus, impactEvidence: action.impactEvidence, impactEvidenceLink: action.impactEvidenceLink,
      rowVersion: action.rowVersion
    } : emptyAction();
    setForm(next); setBaseline(JSON.stringify(next)); setActionId(action?.actionId || null); setMessage("");
  }
  function cancelEdit() { clear(); setForm(null); setActionId(null); }
  async function saveAction(): Promise<boolean> {
    if (!form || !detail || lock.current) return false;
    lock.current = true; setSaving(true); setMessage("");
    try {
      const response = await api.saveProcessReviewAction(detail.recordId, actionId, form);
      if (!response.ok || !response.data) { setTone("error"); setMessage(response.message || "The action could not be saved. Your entries remain here."); return false; }
      clear(); setForm(null); setActionId(null); setTone("success"); setMessage("Action saved in i-Elevate."); await onChanged(response.data); return true;
    } catch (error) { setTone("error"); setMessage(error instanceof Error ? error.message : "The action could not be saved. Your entries remain here."); return false; }
    finally { lock.current = false; setSaving(false); }
  }
  async function copyLink(id: string) {
    const url = new URL(actionPath(id), window.location.origin).href;
    try { await navigator.clipboard.writeText(url); setTone("success"); setMessage("Action link copied."); }
    catch { setTone("neutral"); setMessage(`Copy this action link: ${url}`); }
  }
  const themeOptions = configuration.standards;
  const original = detail?.actions.find(action => action.actionId === actionId);
  function set(key: keyof SaveProcessReviewActionRequest, value: string) { setForm(current => current ? { ...current, [key]: value } : current); }
  return <div className="form-stack"><p className="muted-copy">{"Agree improvement actions against the relevant Digital standard."}</p><WorkflowFeedback message={message} tone={tone} onDismiss={() => setMessage("")} />{!detail ? <div className="notice-row"><div><p>Save the review as a draft before assigning actions.</p><Button disabled={reviewSaving} icon={Save} onClick={() => void onSaveReview()}>Save review draft</Button></div></div> : <>
    {detail.status === "draft" ? <p className="notice-row">Assigning an action makes it available to its owner straight away, even while this review remains a draft.</p> : null}
    {!detail.actions.length ? <p className="process-review-empty">No actions have been assigned to this review.</p> : detail.actions.map(action => <article className="process-review-action" key={action.actionId}><div className="process-review-row"><h3>{action.title}</h3><span className="status-chip">{progressLabels[action.progress] || action.progress}</span></div><p className="muted-copy">{action.themeLabel || themeOptions.find(theme => theme.key === action.themeKey)?.title || action.themeKey}</p><dl className="process-review-summary"><div><dt>Owner</dt><dd>{action.ownerName}</dd></div><div><dt>Due date</dt><dd>{displayDate(action.dueDate)}</dd></div><div><dt>Support required</dt><dd className="process-review-preserve">{action.supportRequired || "None recorded"}</dd></div><div><dt>Success evidence</dt><dd className="process-review-preserve">{action.successEvidence}</dd></div><div><dt>Impact</dt><dd>{impactLabels[action.impactStatus] || action.impactStatus}</dd></div></dl>{action.impactEvidence ? <p className="process-review-preserve">{action.impactEvidence}</p> : null}<ExternalEvidence value={action.impactEvidenceLink}>Open impact evidence</ExternalEvidence>{action.progress === "complete" && action.impactStatus !== "demonstrated" ? <p className="notice-row">Activity completed · impact still needs assessment.</p> : null}<div className="toolbar">{action.canEdit ? <Button disabled={saving || reviewSaving || form !== null} onClick={() => void editAction(action)}>Update action</Button> : null}<Button icon={Copy} disabled={saving} onClick={() => void copyLink(action.actionId)}>Copy action link</Button></div>{action.updates.length ? <details><summary>Dated updates · {action.updates.length}</summary>{action.updates.map(update => <div className="process-review-update" key={update.updateId}><strong>{displayDate(update.updatedAt)} · {update.updatedByName}</strong><p>{progressLabels[update.progress] || update.progress} · Impact: {impactLabels[update.impactStatus] || update.impactStatus}</p>{update.progressNote ? <p className="process-review-preserve">{update.progressNote}</p> : null}{update.barriers ? <p className="process-review-preserve"><strong>Barriers:</strong> {update.barriers}</p> : null}{update.nextStep ? <p className="process-review-preserve"><strong>Next step:</strong> {update.nextStep}</p> : null}<ExternalEvidence value={update.evidenceLink}>Open progress evidence</ExternalEvidence>{update.deadlineChangeReason ? <p><strong>Deadline:</strong> {displayDate(update.dueDate)} · {update.deadlineChangeReason}</p> : null}{update.impactEvidence ? <p className="process-review-preserve"><strong>Impact evidence:</strong> {update.impactEvidence}</p> : null}<ExternalEvidence value={update.impactEvidenceLink}>Open impact evidence</ExternalEvidence></div>)}</details> : null}</article>)}
    {!form && detail.canEdit ? <Button icon={Plus} disabled={reviewSaving || saving} onClick={() => void editAction()}>Add action</Button> : null}
    {form ? <section className="process-review-action-editor"><h3>{actionId ? "Update action" : "New action"}</h3><fieldset className="process-review-fields" disabled={saving || reviewSaving}><div className="form-stack"><Narrative maxLength={300} label="What will change?" value={form.title} onChange={value => set("title", value)} /><div className="form-grid form-grid-two"><label className="entry-field"><span>{"Related Digital standard"}</span><select value={form.themeKey} onChange={event => set("themeKey", event.target.value)}><option value="">Select area</option>{form.themeKey && !themeOptions.some(theme => theme.key === form.themeKey) ? <option value={form.themeKey}>{form.themeKey}</option> : null}{themeOptions.map(theme => <option key={theme.key} value={theme.key}>{theme.title}</option>)}</select></label><label className="entry-field"><span>Action owner</span><StaffSearchSelect id="process-review-action-owner" label="Action owner" value={form.ownerStaffId} staff={staff} onChange={value => set("ownerStaffId", value)} /></label><TextField label="Completion date" type="date" value={form.dueDate} onChange={value => set("dueDate", value)} /><label className="entry-field"><span>Activity progress</span><select value={form.progress} onChange={event => set("progress", event.target.value)}>{Object.entries(progressLabels).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label></div><Narrative maxLength={4000} label="Support required" value={form.supportRequired} onChange={value => set("supportRequired", value)} /><Narrative maxLength={4000} label="What evidence will show success?" value={form.successEvidence} onChange={value => set("successEvidence", value)} /><Narrative maxLength={4000} label="Dated progress update" value={form.progressNote || ""} onChange={value => set("progressNote", value)} /><TextField label="Progress evidence link" type="url" value={form.evidenceLink || ""} onChange={value => set("evidenceLink", value)} /><div className="form-grid form-grid-two"><Narrative maxLength={4000} label="Barriers" value={form.barriers || ""} onChange={value => set("barriers", value)} /><Narrative maxLength={4000} label="Next step" value={form.nextStep || ""} onChange={value => set("nextStep", value)} /></div>{original && original.dueDate !== form.dueDate ? <Narrative maxLength={4000} label="Reason for deadline change" value={form.deadlineChangeReason || ""} onChange={value => set("deadlineChangeReason", value)} /> : null}<h3>Impact assessment</h3><p className="muted-copy">Completing the activity does not automatically demonstrate its impact.</p><label className="entry-field"><span>Impact assessment</span><select value={form.impactStatus} onChange={event => set("impactStatus", event.target.value)}>{Object.entries(impactLabels).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label><Narrative maxLength={4000} label="Impact evidence and observed change" value={form.impactEvidence || ""} onChange={value => set("impactEvidence", value)} /><TextField label="Impact evidence link" type="url" value={form.impactEvidenceLink || ""} onChange={value => set("impactEvidenceLink", value)} /></div></fieldset><div className="toolbar"><Button busy={saving} disabled={reviewSaving} icon={Check} variant="primary" onClick={() => void saveAction()}>{actionId ? "Save action update" : "Assign action"}</Button><Button disabled={saving || reviewSaving} onClick={() => void cancelEdit()}>Cancel action edits</Button></div></section> : null}
  </>}</div>;
}
