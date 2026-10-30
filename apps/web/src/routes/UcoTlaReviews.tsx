import { useFormContent } from "../services/formContent";
import { WorkflowNarrativeField } from "../components/WorkflowNarrativeField";
import { LoadingState } from "../components/LoadingState";
import { focusWorkflowControl } from "../services/workflowExperience";
import { useWorkflowPagination, WorkflowPagination } from "../components/WorkflowPagination";
import { WorkflowFeedback } from "../components/WorkflowFeedback";
import { WorkflowFilters } from "../components/WorkflowFilters";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, CalendarClock, CheckCircle2, ChevronDown, ClipboardCheck, Eye, FilePlus2, MessageSquareText, Plus, RotateCcw, Save, Search, Send, ShieldCheck, X } from "lucide-react";
import { ExportExcelButton, ExportWordButton } from "../components/ExportButtons";
import { Button } from "../design-system/Button";
import { confirmUnsavedNavigation, useUnsavedChanges } from "../components/UnsavedChangesGuard";
import { api } from "../services/api";
import { distinctListValues, sortListRows } from "../services/listQuery";
import { selectUcoReviews } from "../services/workflowListQueries";
import type {
  CreateUcoTlaReviewRequest,
  SaveUcoTlaObserverSectionRequest,
  UcoTlaAccessSummary,
  UcoTlaActionPlan,
  UcoTlaDashboardSummary,
  UcoTlaFollowUp,
  UcoTlaReviewDetail,
  UcoTlaReviewSummary
} from "../services/types";

type Props = {
  access: UcoTlaAccessSummary | null;
  academicYear: string;
  initialRecordId?: string;
  onActionsChanged?: () => Promise<void>;
  onRecordOpened?: (recordId: string) => void;
  onRecordClosed?: () => void;
};

const evidenceSections = [
  {
    key: "teaching_learning_activities",
    title: "Teaching and learning activities",
    fields: [
      ["academic_research_skills", "Academic/research skills"],
      ["personal_professional_development", "Personal and professional development"],
      ["employability", "Employability"]
    ]
  },
  {
    key: "delivery_facilitation",
    title: "Delivery and facilitation of teaching and learning",
    fields: [
      ["structure_pace_organisation", "Structure, pace and organisation of session"],
      ["level_appropriate_inclusive", "Level-appropriate and inclusive content and delivery"],
      ["delivery_methods_styles_resources", "Range of delivery methods, styles and resources"],
      ["student_feedback_engagement", "Student feedback and engagement"]
    ]
  },
  {
    key: "learning_materials",
    title: "Teaching, learning and assessment materials",
    description: "Are the materials that support learning current, accurate, accessible and appropriate?",
    fields: [
      ["module_handbook", "Module handbook"],
      ["itslearning_resources", "Resources on ItsLearning"],
      ["session_materials", "Session materials, handouts and resources"],
      ["assessment_information", "Assessment information"],
      ["feedback_to_students", "Feedback to students"]
    ]
  },
  {
    key: "findings",
    title: "Findings",
    fields: [
      ["good_practice", "Aspects of good practice"],
      ["essential_actions", "Essential actions"],
      ["advisable_actions", "Advisable actions"],
      ["excellent_practice", "Excellent practice to share"]
    ]
  }
] as const;

const workflowStages = [
  { label: "Assigned", owner: "Coordinator", icon: CalendarClock },
  { label: "Observer review", owner: "Observer", icon: Eye },
  { label: "Discussion & reflection", owner: "Lecturer", icon: MessageSquareText },
  { label: "Final sign-off", owner: "Observer", icon: ClipboardCheck }
] as const;

const emptyCreate: CreateUcoTlaReviewRequest = {
  lecturerStaffId: "",
  observerStaffId: "",
  academicYear: ""
};

export function UcoTlaReviews({
  access,
  academicYear,
  initialRecordId = "",
  onActionsChanged,
  onRecordOpened,
  onRecordClosed
}: Props) {
  const [dashboard, setDashboard] = useState<UcoTlaDashboardSummary | null>(null);
  const [selectedId, setSelectedId] = useState(initialRecordId);
  const [detail, setDetail] = useState<UcoTlaReviewDetail | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [create, setCreate] = useState<CreateUcoTlaReviewRequest>(emptyCreate);
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [reviewSearch, setReviewSearch] = useState("");
  const [reviewStatus, setReviewStatus] = useState("all");
  const [reviewObserver, setReviewObserver] = useState("all");
  const [reviewCourse, setReviewCourse] = useState("all");
  const [reviewFollowUp, setReviewFollowUp] = useState("all");
  const [reviewSort, setReviewSort] = useState("newest");
  const [isLoading, setIsLoading] = useState(true);
  const [loadingLabel, setLoadingLabel] = useState("Loading UCO TLA reviews…");
  const [loadFailed, setLoadFailed] = useState(false);
  const loadRequest = useRef(0);
  const clearCreateNavigation = useUnsavedChanges({ label: "New UCO review", dirty: isCreating && Boolean(create.lecturerStaffId || create.observerStaffId), saving: isSaving,
    submission: true, onSubmit: access?.canCreate ? createReview : undefined, submitLabel: "Create review",
    onDiscard: () => { setCreate({ ...emptyCreate, academicYear }); setIsCreating(false); } });

  async function refresh(nextSelectedId = selectedId) {
    const request = ++loadRequest.current;
    setLoadingLabel("Loading UCO TLA reviews…");
    setIsLoading(true);
    try {
      const nextDashboard = await api.ucoTlaDashboard(academicYear);
      if (request !== loadRequest.current) return;
      setDashboard(nextDashboard);
      if (nextSelectedId) {
        const nextDetail = await api.ucoTlaReview(nextSelectedId);
        if (request !== loadRequest.current) return;
        setDetail(nextDetail);
        setSelectedId(nextSelectedId);
      }
      setLoadFailed(false);
    } catch {
      if (request !== loadRequest.current) return;
      setLoadFailed(true);
      setMessage("UCO TLA Reviews could not be loaded from the API.");
    } finally { if (request === loadRequest.current) setIsLoading(false); }
  }

  useEffect(() => {
    setDetail(null); setDashboard(null); setSelectedId("");
    if (access?.canAccess) void refresh(initialRecordId);
    return () => { loadRequest.current += 1; };
  }, [access?.canAccess, academicYear]);
  useEffect(() => {
    if (!initialRecordId || initialRecordId === selectedId) return;
    void openReview(initialRecordId);
  }, [initialRecordId]);

  async function openReview(recordId: string) {
    if (!await confirmUnsavedNavigation()) return;
    const request = ++loadRequest.current;
    setLoadingLabel("Opening the UCO TLA review…");
    setIsLoading(true);
    setMessage("");
    try {
      const next = await api.ucoTlaReview(recordId);
      if (request !== loadRequest.current) return;
      setDetail(next);
      setSelectedId(recordId);
      onRecordOpened?.(recordId);
      if (typeof window !== "undefined") window.requestAnimationFrame(() => focusWorkflowControl("uco-review-heading"));
    } catch {
      if (request !== loadRequest.current) return;
      setMessage("That UCO TLA Review could not be opened, or you no longer have access.");
    } finally { if (request === loadRequest.current) setIsLoading(false); }
  }

  function closeReview() {
    loadRequest.current += 1; setIsLoading(false);
    setDetail(null);
    setSelectedId("");
    onRecordClosed?.();
    window.requestAnimationFrame(() => focusWorkflowControl("uco-register-heading"));
  }

  async function createReview(): Promise<boolean> {
    if (!access?.canCreate || isSaving || !canCreate(create)) return false;
    setIsSaving(true);
    try {
      setMessage("");
      const result = await api.createUcoTlaReview({
        ...create,
        academicYear
      });

      if (!result.ok || !result.data) {
        setMessage(result.message ?? "The review could not be created.");
        return false;
      }
      clearCreateNavigation();
      setCreate({ ...emptyCreate, academicYear });
      setIsCreating(false);
      await refresh(result.data.recordId);
      onRecordOpened?.(result.data.recordId);
      return true;
    } finally { setIsSaving(false); }
  }

  const reviews = dashboard?.reviews ?? [];
  const observers = sortListRows([...new Map(reviews.map(review => [review.observerStaffId, review.observerName])).entries()], entry => entry[1]);
  const filteredReviews = selectUcoReviews(reviews, { search: reviewSearch, status: reviewStatus, observer: reviewObserver, course: reviewCourse, followUp: reviewFollowUp, sort: reviewSort });
  const recordPage = useWorkflowPagination(filteredReviews, JSON.stringify([academicYear, reviewSearch, reviewStatus, reviewObserver, reviewCourse, reviewFollowUp, reviewSort]));
  if (!access) return <div className="route-stack"><LoadingState label="Checking UCO review access…" size="page" /></div>;
  if (!access.canAccess) return <section className="access-denied-panel"><ShieldCheck size={22} /><div><h1>UCO TLA Reviews</h1><p>You do not have a UCO review assignment or coordinator access.</p></div></section>;
  if (detail) return (
    <UcoTlaReviewWorkspace
      key={detail.review.recordId}
      access={access}
      detail={detail}
      isSaving={isSaving}
      isLoading={isLoading}
      loadingLabel={loadingLabel}
      message={message}
      onActionsChanged={onActionsChanged}
      onBack={closeReview}
      onOpenReview={openReview}
      onChanged={async (next, nextMessage) => {
        setDetail(next);
        setMessage(nextMessage);
        setDashboard(await api.ucoTlaDashboard(academicYear));
      }}
      setIsSaving={setIsSaving}
      setMessage={setMessage}
    />
  );


  return (
    <fieldset disabled={isSaving} style={{ display: "contents" }}><div className="route-stack uco-tla-route">
      <section className="route-hero">
        <div><p className="eyebrow">University Centre Oldham</p><h1>Teaching, Learning and Assessment Reviews</h1><p>Narrative reviews with authenticated lecturer and observer sign-off.</p></div>
        <div className="toolbar">
          {access.canExport ? <ExportExcelButton filters={{ academicYear }} moduleKey="uco-tla-reviews" /> : null}
          {access.canCreate ? <Button id="uco-create-trigger" aria-expanded={isCreating} icon={FilePlus2} onClick={() => { if (!isCreating) { setCreate({ ...emptyCreate, academicYear }); setIsCreating(true); } }} variant="primary">Create review</Button> : null}
        </div>
      </section>

      <WorkflowFeedback message={message} onDismiss={() => setMessage("")} />
      {loadFailed ? <Button disabled={isLoading} onClick={() => void refresh()}>Retry loading reviews</Button> : null}
      {isLoading ? <LoadingState label={loadingLabel} /> : null}
      {isCreating ? (
        <section className="panel uco-create-card">
          <div className="panel-heading"><div><h2>Create a UCO TLA Review</h2><span>Assign the review for {academicYear}. The observer will complete session and attendance details inside the review.</span></div></div>
          {access.ucoStaff.length === 0 ? <p className="muted-copy">No UCO staff are available to select. Ask your administrator to check UCO staff access before creating a review.</p> : null}
          <div className="form-grid form-grid-two">
            <StaffSelect label="Lecturer" options={access.ucoStaff} value={create.lecturerStaffId} onChange={(value) => setCreate({ ...create, lecturerStaffId: value })} />
            <StaffSelect label="Observer" options={access.ucoStaff} value={create.observerStaffId} onChange={(value) => setCreate({ ...create, observerStaffId: value })} />
          </div>
          <div className="toolbar toolbar-end"><Button icon={X} onClick={() => void confirmUnsavedNavigation().then(leave => { if (leave) { setIsCreating(false); clearCreateNavigation(); window.requestAnimationFrame(() => focusWorkflowControl("uco-create-trigger")); } })}>Cancel</Button><Button busy={isSaving} disabled={!canCreate(create)} icon={Plus} onClick={() => void createReview()} variant="primary">{isSaving ? "Creating…" : "Create review"}</Button></div>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-heading"><div><h2 id="uco-register-heading" tabIndex={-1}>{access.canManage ? "UCO review register" : "Reviews in my view"}</h2><span>{filteredReviews.length} of {reviews.length} reviews in {academicYear || "the current academic year"}</span></div></div>
        <WorkflowFilters activeCount={[reviewStatus, reviewObserver, reviewCourse, reviewFollowUp].filter(value => value !== "all").length} hasQuery={Boolean(reviewSearch)} onClear={() => { setReviewSearch(""); setReviewStatus("all"); setReviewObserver("all"); setReviewCourse("all"); setReviewFollowUp("all"); setReviewSort("newest"); }} primary={<>
<label className="search-box"><Search size={16} aria-hidden="true" /><input aria-label="Search UCO reviews" onChange={(event) => setReviewSearch(event.target.value)} placeholder="Search people, course, module or stage" value={reviewSearch} /></label>
<label><span>Sort by</span><select aria-label="Sort UCO reviews" onChange={event => setReviewSort(event.target.value)} value={reviewSort}><option value="newest">Observation: newest first</option><option value="oldest">Observation: oldest first</option><option value="lecturer">Lecturer name</option><option value="observer">Observer name</option><option value="course">Course</option><option value="status">Workflow stage</option></select></label>
</>}>
<label><span>Workflow stage</span><select onChange={(event) => setReviewStatus(event.target.value)} value={reviewStatus}><option value="all">All stages</option>{distinctListValues(reviews.map(review => review.workflowStatus)).map(status => <option key={status} value={status}>{humanStatus(status)}</option>)}</select></label>
          <label><span>Observer</span><select onChange={event => setReviewObserver(event.target.value)} value={reviewObserver}><option value="all">All observers</option>{observers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
          <label><span>Course</span><select onChange={event => setReviewCourse(event.target.value)} value={reviewCourse}><option value="all">All courses</option>{distinctListValues(reviews.map(review => review.courseTitle)).map(course => <option key={course}>{course}</option>)}</select></label>
          <label><span>Follow-up</span><select onChange={event => setReviewFollowUp(event.target.value)} value={reviewFollowUp}><option value="all">All follow-up statuses</option>{distinctListValues(reviews.map(review => review.followUpStatus || "not_scheduled")).map(status => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select></label>
</WorkflowFilters>
        <div className="uco-review-list">
          {isLoading && filteredReviews.length === 0 ? null : loadFailed && filteredReviews.length === 0 ? <p className="muted-copy">Reviews are temporarily unavailable. Use Retry loading reviews above.</p> : filteredReviews.length === 0 ? <p className="muted-copy">{reviews.length ? "No UCO TLA Reviews match these filters." : `No UCO TLA Reviews have been created for ${academicYear} yet.`}</p> : recordPage.items.map((review) => <ReviewRow key={review.recordId} review={review} onOpen={() => void openReview(review.recordId)} />)}
        </div>
        <WorkflowPagination {...recordPage} label="UCO reviews" />
      </section>
    </div></fieldset>
  );
}

function UcoTlaReviewWorkspace({ access, detail, isSaving, isLoading, loadingLabel, message, onActionsChanged, onBack, onChanged, onOpenReview, setIsSaving, setMessage }: {
  access: UcoTlaAccessSummary;
  detail: UcoTlaReviewDetail;
  isSaving: boolean;
  isLoading: boolean;
  loadingLabel: string;
  message: string;
  onActionsChanged?: () => Promise<void>;
  onBack: () => void;
  onChanged: (detail: UcoTlaReviewDetail, message: string) => Promise<void>;
  onOpenReview: (recordId: string) => Promise<void>;
  setIsSaving: (value: boolean) => void;
  setMessage: (value: string) => void;
}) {
  const content = useFormContent("uco");
  const [form, setForm] = useState(() => formFromDetail(detail));
  const [reopenReason, setReopenReason] = useState("");
  const [reflection, setReflection] = useState(detail.responses.lecturer_reflection ?? "");
  const [discussionAt, setDiscussionAt] = useState(toLocalInput(detail.review.professionalDiscussionAt));
  const [managedFollowUp, setManagedFollowUp] = useState<{
    followUpType: UcoTlaFollowUp["followUpType"];
    scheduledAt: string;
    status: UcoTlaFollowUp["status"];
    outcomeNotes: string;
  }>(() => followUpFromDetail(detail));
  const [linkedReview, setLinkedReview] = useState({
    observerStaffId: "",
    observationAt: "",
    sessionType: detail.sessionType ?? "",
    courseTitle: detail.review.courseTitle ?? "",
    moduleTitle: detail.review.moduleTitle ?? "",
    courseLevel: detail.courseLevel ?? ""
  });

  const baseline = useRef({ form: JSON.stringify(form), reflection, discussionAt, followUp: JSON.stringify(managedFollowUp), linkedReview: JSON.stringify(linkedReview) });
  const operationInFlight = useRef(false);
  const caps = detail.review.capabilities;
  const observerDraft = caps.canEditObserverSection && detail.review.workflowStatus === "observer_draft";
  const discussionDirty = discussionAt !== baseline.current.discussionAt;
  const followUpDirty = JSON.stringify(managedFollowUp) !== baseline.current.followUp;
  const linkedDirty = JSON.stringify(linkedReview) !== baseline.current.linkedReview;
  const clearObserverNavigation = useUnsavedChanges({ label: "UCO observer review", dirty: JSON.stringify(form) !== baseline.current.form, saving: isSaving,
    submission: observerDraft, onSave: observerDraft ? () => saveObserver() : undefined,
    onSubmit: observerDraft ? sendToLecturer : undefined, submitLabel: "Send to lecturer",
    onDiscard: () => setForm(JSON.parse(baseline.current.form) as SaveUcoTlaObserverSectionRequest) });
  const clearReflectionNavigation = useUnsavedChanges({ label: "UCO lecturer reflection", dirty: reflection !== baseline.current.reflection, saving: isSaving,
    submission: caps.canReflect, onSubmit: caps.canReflect && Boolean(detail.review.professionalDiscussionAt) ? acknowledgeReview : undefined,
    submitLabel: "Acknowledge review", discardMessage: "Cancelling discards the unsaved reflection. It does not acknowledge the review; work saved earlier is retained.",
    onDiscard: () => setReflection(baseline.current.reflection) });
  useUnsavedChanges({ label: "UCO review management", dirty: discussionDirty || followUpDirty || linkedDirty || Boolean(reopenReason), saving: isSaving,
    onSave: !linkedDirty && !reopenReason && discussionDirty !== followUpDirty
      ? discussionDirty && caps.canRecordProfessionalDiscussion ? saveDiscussion : followUpDirty && caps.canManageFollowUp ? saveFollowUp : undefined : undefined,
    onDiscard: () => { setDiscussionAt(toLocalInput(detail.review.professionalDiscussionAt)); setManagedFollowUp(followUpFromDetail(detail)); setLinkedReview(JSON.parse(baseline.current.linkedReview)); setReopenReason(""); } });
  useEffect(() => {
    const nextForm = formFromDetail(detail), nextReflection = detail.responses.lecturer_reflection ?? "",
      nextDiscussion = toLocalInput(detail.review.professionalDiscussionAt), nextFollowUp = followUpFromDetail(detail);
    if (JSON.stringify(form) === baseline.current.form) setForm(nextForm);
    if (reflection === baseline.current.reflection) setReflection(nextReflection);
    if (discussionAt === baseline.current.discussionAt) setDiscussionAt(nextDiscussion);
    if (JSON.stringify(managedFollowUp) === baseline.current.followUp) setManagedFollowUp(nextFollowUp);
    baseline.current = { ...baseline.current, form: JSON.stringify(nextForm), reflection: nextReflection, discussionAt: nextDiscussion, followUp: JSON.stringify(nextFollowUp) };
  }, [detail.review.rowVersion]);

  async function run(request: () => ReturnType<typeof api.submitUcoTlaReview>, success: string) {
    if (isSaving || operationInFlight.current) return false;
    operationInFlight.current = true;
    setIsSaving(true);
    try {
      setMessage("");
      const result = await request();

      if (!result.ok || !result.data) {
        setMessage(result.message ?? "The review could not be updated.");
        return false;
      }
      await onChanged(result.data, success);
      return true;
    } catch { setMessage("The review could not be updated. Your changes are still here. Try again."); return false; }
    finally { operationInFlight.current = false; setIsSaving(false); }
  }

  async function saveObserver(sectionKey?: string, isSectionComplete?: boolean) {
    if (!observerDraft || isSaving) return false;
    let persisted: UcoTlaReviewDetail | undefined;
    const saved = await run(async () => {
      const result = await api.updateUcoTlaReview(detail.review.recordId, { ...form, sectionKey, isSectionComplete });
      persisted = result.data; return result;
    }, sectionKey ? `${sectionTitle(sectionKey)} saved.` : "Review changes saved.");
    if (saved && persisted) { const next = formFromDetail(persisted); baseline.current.form = JSON.stringify(next); setForm(next); clearObserverNavigation(); }
    return saved;
  }

  async function sendToLecturer() {
    if (!observerDraft || isSaving) return false;
    let persisted: UcoTlaReviewDetail | undefined;
    const sent = await run(async () => {
      const saved = await api.updateUcoTlaReview(detail.review.recordId, form);
      if (!saved.ok || !saved.data) return saved;
      persisted = saved.data;
      const result = await api.submitUcoTlaReview(detail.review.recordId, saved.data.review.rowVersion);
      if (result.ok && result.data) persisted = result.data;
      return result;
    }, "Review sent to the lecturer.");
    // A rejected submission may follow a successful draft save. Retain the
    // answers and that new token so a retry cannot reuse the old draft version.
    if (persisted) { const next = formFromDetail(persisted); setForm(next); if (sent) { baseline.current.form = JSON.stringify(next); clearObserverNavigation(); } }
    return sent;
  }

  async function acknowledgeReview() {
    if (!caps.canReflect || isSaving || !reflection.trim() || !detail.review.professionalDiscussionAt) {
      setMessage("Enter your reflection and wait for the professional discussion to be recorded before acknowledging the review."); return false;
    }
    const saved = await run(() => api.acknowledgeUcoTlaReview(detail.review.recordId, reflection, detail.review.rowVersion), "Lecturer acknowledgement recorded.");
    if (saved) { baseline.current.reflection = reflection; clearReflectionNavigation(); }
    return saved;
  }

  async function saveDiscussion() {
    if (!caps.canRecordProfessionalDiscussion || isSaving || !discussionAt) { setMessage("Enter the professional discussion date and time before saving."); return false; }
    const saved = await run(() => api.saveUcoTlaDiscussion(detail.review.recordId, fromLocalInput(discussionAt), detail.review.rowVersion), "Professional discussion date saved.");
    if (saved) baseline.current.discussionAt = discussionAt;
    return saved;
  }

  async function saveFollowUp() {
    if (!caps.canManageFollowUp || isSaving || !managedFollowUp.scheduledAt || (managedFollowUp.status === "completed" && !managedFollowUp.outcomeNotes.trim())) {
      setMessage("Enter the follow-up date and any required outcome notes before saving."); return false;
    }
    const saved = await run(() => api.saveUcoTlaFollowUp(detail.review.recordId, { followUpType: managedFollowUp.followUpType, scheduledAt: fromLocalInput(managedFollowUp.scheduledAt), status: managedFollowUp.status, outcomeNotes: managedFollowUp.outcomeNotes || undefined, rowVersion: detail.followUp?.rowVersion }), "Follow-up details saved.");
    if (saved) baseline.current.followUp = JSON.stringify(managedFollowUp);
    return saved;
  }

  async function createLinkedReview() {
    setIsSaving(true);
    try {
      setMessage("");
      const result = await api.createLinkedUcoTlaReview(detail.review.recordId, {
        ...linkedReview,
        observationAt: fromLocalInput(linkedReview.observationAt)
      });

      if (!result.ok || !result.data) {
        setMessage(result.message ?? "The linked review could not be created.");
        return;
      }
      await onOpenReview(result.data.recordId);
    } finally { setIsSaving(false); }
  }

  const requiredEvidenceKeys = evidenceSections.flatMap((section) => section.fields.map(([key]) => key)).filter(requiredNarrative);
  const completedRequiredEvidence = requiredEvidenceKeys.filter((key) => form.responses[key]?.trim()).length;
  const firstIncompleteEvidence = evidenceSections.findIndex((section) => section.fields.some(([key]) => requiredNarrative(key) && !form.responses[key]?.trim()));
  const completedSections = ["session_details", ...evidenceSections.map((section) => section.key), "action_plan", "discussion_follow_up"]
    .filter((sectionKey) => detail.sectionCompletion[sectionKey]).length;
  const sectionActions = (sectionKey: string, canComplete = true) => caps.canEditObserverSection ? (
    <SectionSaveActions
      canComplete={canComplete}
      isComplete={Boolean(detail.sectionCompletion[sectionKey])}
      isSaving={isSaving}
      onSave={() => void saveObserver(sectionKey, Boolean(detail.sectionCompletion[sectionKey]))}
      onToggleComplete={() => void saveObserver(sectionKey, !detail.sectionCompletion[sectionKey])}
    />
  ) : null;
  return (
    <fieldset disabled={isSaving} style={{ display: "contents" }}><div className="route-stack uco-tla-route">
      <section className="route-hero">
        <div><button className="quiet-link" onClick={() => void confirmUnsavedNavigation().then(leave => { if (leave) onBack(); })} type="button"><ArrowLeft size={16} />Back to reviews</button><p className="eyebrow">{detail.review.academicYear} / {humanStatus(detail.review.workflowStatus)}</p><h1 id="uco-review-heading" tabIndex={-1}>{detail.review.lecturerName}</h1><p>{sessionLabel(detail.review.courseTitle, detail.review.moduleTitle)}</p></div>
        <div className="toolbar">{caps.canViewCompletedReport ? <ExportWordButton recordId={detail.review.recordId} /> : null}{caps.canReopen ? <Button disabled={isSaving || !reopenReason.trim()} icon={RotateCcw} onClick={() => void run(() => api.reopenUcoTlaReview(detail.review.recordId, reopenReason, detail.review.rowVersion), "Review reopened; section completion and sign-off must be repeated.")}>Reopen</Button> : null}</div>
      </section>
      {caps.canReopen ? <label className="entry-field"><span>Reason for reopening</span><input onChange={(event) => setReopenReason(event.target.value)} value={reopenReason} /></label> : null}
      <WorkflowFeedback message={message} onDismiss={() => setMessage("")} />
      {isLoading ? <LoadingState label={loadingLabel} /> : null}

      <UcoWorkflowMap status={detail.review.workflowStatus} />
      <section className="uco-next-step" role="status">
        <span><CheckCircle2 size={18} /></span>
        <div><small>Current step</small><strong>{workflowHelp(detail.review.workflowStatus)}</strong></div>
      </section>

      <section className="panel uco-case-summary">
        <div className="panel-heading"><div><h2>Participants and session</h2><span>Scheduling details are visible to all assigned participants.</span></div><span className={`status-pill status-${statusTone(detail.review.workflowStatus)}`}>{humanStatus(detail.review.workflowStatus)}</span></div>
        <div className="uco-information-grid">
          <Detail label="Lecturer" value={detail.review.lecturerName} />
          <Detail label="Observer" value={detail.review.observerName} />
          <Detail label="Observation" value={detail.review.observationAt ? formatDateTime(detail.review.observationAt) : "Not yet provided"} />
          <Detail label="Session type" value={detail.sessionType || "Not yet provided"} />
          <Detail label="Course" value={detail.review.courseTitle || "Not yet provided"} />
          <Detail label="Module" value={detail.review.moduleTitle || "Not yet provided"} />
          <Detail label="Level" value={detail.courseLevel || "Not yet provided"} />
          <Detail label="Attendance" value={`${detail.numberPresent ?? "—"} present / ${detail.numberRegistered ?? "—"} registered / ${detail.numberLate ?? "—"} late`} />
        </div>
      </section>

      {caps.canViewObserverFindings ? <Guidance /> : <section className="panel uco-redaction-note"><ShieldCheck size={22} /><div><h2>Observer review in progress</h2><p>The lecturer can see scheduling details now. Findings will become available when the observer sends the completed review.</p></div></section>}

      {caps.canViewObserverFindings || caps.canEditObserverSection ? (
        <>
          <div className="uco-form-overview">
            <div><p className="eyebrow">Controlled review form</p><h2>Observation evidence and findings</h2><p>Open one section at a time. The questions and evidence captured remain unchanged.</p></div>
            <span>{completedSections}/7 sections complete · {completedRequiredEvidence}/{requiredEvidenceKeys.length} required fields filled</span>
          </div>
          <div className="uco-section-stack">
            {caps.canEditObserverSection ? <ReviewSectionPanel defaultOpen={!detail.sectionCompletion.session_details} description="Complete the session and attendance information here before sending the review to the lecturer." footer={sectionActions("session_details")} number={1} summary={detail.sectionCompletion.session_details ? "Complete" : "Not marked complete"} summaryComplete={Boolean(detail.sectionCompletion.session_details)} title="Course and session details"><div className="form-grid form-grid-three"><Input label="Observation date/time" type="datetime-local" value={toLocalInput(form.observationAt)} onChange={(value) => setForm({ ...form, observationAt: fromLocalInput(value) })} /><Input label="Session type" value={form.sessionType} onChange={(value) => setForm({ ...form, sessionType: value })} /><Input label="Course title" value={form.courseTitle} onChange={(value) => setForm({ ...form, courseTitle: value })} /><Input label="Module title" value={form.moduleTitle} onChange={(value) => setForm({ ...form, moduleTitle: value })} /><Input label="Level" value={form.courseLevel} onChange={(value) => setForm({ ...form, courseLevel: value })} /><NumberInput label="Number on register" value={form.numberRegistered} onChange={(value) => setForm({ ...form, numberRegistered: value })} /><NumberInput label="Number present" value={form.numberPresent} onChange={(value) => setForm({ ...form, numberPresent: value })} /><NumberInput label="Number arriving late" value={form.numberLate} onChange={(value) => setForm({ ...form, numberLate: value })} /></div></ReviewSectionPanel> : null}
            {evidenceSections.map((section, index) => {
              const progress = evidenceProgress(section.fields, form.responses);
              const isComplete = Boolean(detail.sectionCompletion[section.key]);
              return <ReviewSectionPanel defaultOpen={caps.canEditObserverSection && Boolean(detail.sectionCompletion.session_details) && index === firstIncompleteEvidence} description={"description" in section ? section.description : undefined} footer={sectionActions(section.key, progress.complete)} key={section.title} number={index + 2} summary={isComplete ? "Complete" : progress.label} summaryComplete={isComplete} title={section.title}><div className="form-stack">{section.fields.map(([key, label]) => <WorkflowNarrativeField key={key} content={content.field(key, label)} requiredLabel={requiredNarrative(key)} aria-required={requiredNarrative(key) || undefined} disabled={!caps.canEditObserverSection} onChange={value => setForm({ ...form, responses: { ...form.responses, [key]: value } })} rows={4} value={form.responses[key] ?? ""} />)}</div></ReviewSectionPanel>;
            })}
            <ActionPlanEditor access={access} disabled={!caps.canEditObserverSection} footer={sectionActions("action_plan", actionPlanComplete(form.actionPlan))} isSectionComplete={Boolean(detail.sectionCompletion.action_plan)} number={6} onChange={(actionPlan) => setForm({ ...form, actionPlan })} value={form.actionPlan} />
            {caps.canEditObserverSection ? <ReviewSectionPanel description="Essential findings must include a tracked essential action and a checkpoint 8–12 weeks after the discussion." footer={sectionActions("discussion_follow_up")} number={7} summary={detail.sectionCompletion.discussion_follow_up ? "Complete" : "Complete when reviewed"} summaryComplete={Boolean(detail.sectionCompletion.discussion_follow_up)} title="Professional discussion and follow-up"><div className="form-grid form-grid-three"><Input label="Professional discussion" type="datetime-local" value={toLocalInput(form.professionalDiscussionAt)} onChange={(value) => setForm({ ...form, professionalDiscussionAt: fromLocalInput(value) || undefined })} /><label className="entry-field"><span>Follow-up type</span><select onChange={(event) => setForm({ ...form, followUp: { ...(form.followUp ?? emptyFollowUp()), followUpType: event.target.value as "discussion" | "observation" } })} value={form.followUp?.followUpType ?? "discussion"}><option value="discussion">Professional discussion</option><option value="observation">Further observation</option></select></label><Input label="Follow-up date/time" type="datetime-local" value={toLocalInput(form.followUp?.scheduledAt)} onChange={(value) => setForm({ ...form, followUp: { ...(form.followUp ?? emptyFollowUp()), scheduledAt: fromLocalInput(value) } })} /></div></ReviewSectionPanel> : null}
          </div>
          {caps.canEditObserverSection ? <div className="uco-form-actions"><span>Section buttons save progress as you work. Sending the review makes the findings visible to the lecturer for discussion and reflection.</span><div className="toolbar toolbar-end"><Button disabled={isSaving} icon={Save} onClick={() => void saveObserver()}>{isSaving ? "Saving..." : "Save all changes"}</Button><Button disabled={isSaving} icon={Send} onClick={() => void sendToLecturer()} variant="primary">Send to lecturer</Button></div></div> : null}
        </>
      ) : null}

      {caps.canRecordProfessionalDiscussion ? <section className="panel"><div className="panel-heading"><div><h2>Professional discussion</h2><span>Record when the observer's completed review was discussed with the lecturer.</span></div></div><div className="form-grid form-grid-two"><Input label="Discussion date/time" type="datetime-local" value={discussionAt} onChange={setDiscussionAt} /></div><div className="toolbar toolbar-end"><Button disabled={isSaving || !discussionAt} icon={Save} onClick={() => void saveDiscussion()} variant="primary">Save discussion</Button></div></section> : null}

      {caps.canReflect ? <section className="panel"><div className="panel-heading"><div><h2>Lecturer reflection and acknowledgement</h2><span>Your authenticated account name and timestamp replace the handwritten signature.</span></div></div><WorkflowNarrativeField content={content.field("lecturer_reflection", "Reflection on observation and professional discussion")} requiredLabel aria-required="true" onChange={setReflection} rows={7} value={reflection} /><div className="toolbar toolbar-end"><Button disabled={isSaving || !reflection.trim() || !detail.review.professionalDiscussionAt} icon={CheckCircle2} onClick={() => void acknowledgeReview()} variant="primary">Acknowledge review</Button></div></section> : null}

      {caps.canFinalise ? <section className="panel"><div className="panel-heading"><div><h2>Observer final sign-off</h2><span>Finalising locks the findings, creates the linked central actions and completes any linked probation Observation 2.</span></div></div><div className="toolbar toolbar-end"><Button disabled={isSaving} icon={ClipboardCheck} onClick={() => void run(async () => { const result = await api.finaliseUcoTlaReview(detail.review.recordId, detail.review.rowVersion); if (result.ok) await onActionsChanged?.(); return result; }, "UCO TLA Review completed and actions created.")} variant="primary">Final sign-off</Button></div></section> : null}

      <SignOffSummary detail={detail} />

      {caps.canManageFollowUp ? <section className="panel"><div className="panel-heading"><div><h2>Follow-up management</h2><span>Track a discussion checkpoint here, or create a separately linked UCO observation.</span></div></div><div className="form-grid form-grid-three"><label className="entry-field"><span>Follow-up type</span><select onChange={(event) => setManagedFollowUp({ ...managedFollowUp, followUpType: event.target.value as UcoTlaFollowUp["followUpType"] })} value={managedFollowUp.followUpType}><option value="discussion">Professional discussion</option><option value="observation">Further observation</option></select></label><Input label="Scheduled date/time" type="datetime-local" value={managedFollowUp.scheduledAt} onChange={(scheduledAt) => setManagedFollowUp({ ...managedFollowUp, scheduledAt })} /><label className="entry-field"><span>Status</span><select onChange={(event) => setManagedFollowUp({ ...managedFollowUp, status: event.target.value as UcoTlaFollowUp["status"] })} value={managedFollowUp.status}><option value="scheduled">Scheduled</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></label></div><label className="entry-field"><span>Outcome notes{managedFollowUp.status === "completed" ? <strong> Required</strong> : null}</span><textarea onChange={(event) => setManagedFollowUp({ ...managedFollowUp, outcomeNotes: event.target.value })} rows={4} value={managedFollowUp.outcomeNotes} /></label><div className="toolbar toolbar-end"><Button disabled={isSaving || !managedFollowUp.scheduledAt || (managedFollowUp.status === "completed" && !managedFollowUp.outcomeNotes.trim())} icon={Save} onClick={() => void saveFollowUp()} variant="primary">Save follow-up</Button></div>
      {detail.followUp?.linkedReviewRecordId ? <div className="uco-linked-review"><div><strong>Linked UCO observation</strong><p className="muted-copy">A subsequent review has been created for this follow-up.</p></div><Button onClick={() => void onOpenReview(detail.followUp!.linkedReviewRecordId!)}>Open linked review</Button></div> : caps.canCreateLinkedReview && managedFollowUp.followUpType === "observation" && detail.followUp ? <div className="uco-linked-review-form"><h3>Create linked observation</h3><div className="form-grid form-grid-three"><StaffSelect label="Observer" options={access.ucoStaff} value={linkedReview.observerStaffId} onChange={(observerStaffId) => setLinkedReview({ ...linkedReview, observerStaffId })} /><Input label="Observation date/time" type="datetime-local" value={linkedReview.observationAt} onChange={(observationAt) => setLinkedReview({ ...linkedReview, observationAt })} /><Input label="Session type" value={linkedReview.sessionType} onChange={(sessionType) => setLinkedReview({ ...linkedReview, sessionType })} /><Input label="Course title" value={linkedReview.courseTitle} onChange={(courseTitle) => setLinkedReview({ ...linkedReview, courseTitle })} /><Input label="Module title" value={linkedReview.moduleTitle} onChange={(moduleTitle) => setLinkedReview({ ...linkedReview, moduleTitle })} /><Input label="Level" value={linkedReview.courseLevel} onChange={(courseLevel) => setLinkedReview({ ...linkedReview, courseLevel })} /></div><div className="toolbar toolbar-end"><Button disabled={isSaving || !canCreateLinkedReview(linkedReview, detail.review.lecturerStaffId)} icon={FilePlus2} onClick={() => void createLinkedReview()} variant="primary">Create linked review</Button></div></div> : null}</section> : null}
    </div></fieldset>
  );
}

function ActionPlanEditor({ access, disabled, footer, isSectionComplete, number, onChange, value }: { access: UcoTlaAccessSummary; disabled: boolean; footer?: ReactNode; isSectionComplete: boolean; number: number; onChange: (value: UcoTlaActionPlan[]) => void; value: UcoTlaActionPlan[] }) {
  const content = useFormContent("uco");
  function add() {
    if (value.length >= 3) return;
    onChange([...value, { displayOrder: value.length + 1, actionType: "advisable", target: "", achievementMethod: "", ownerStaffId: "", dueDate: "" }]);
  }
  function update(index: number, change: Partial<UcoTlaActionPlan>) {
    onChange(value.map((action, actionIndex) => actionIndex === index ? { ...action, ...change } : action));
  }
  function remove(index: number) {
    onChange(value.filter((_, actionIndex) => actionIndex !== index).map((action, actionIndex) => ({ ...action, displayOrder: actionIndex + 1 })));
  }
  const completeActions = value.filter((action) => action.target.trim() && action.achievementMethod.trim() && action.ownerStaffId && action.dueDate).length;
  return <ReviewSectionPanel description="Up to three targets. Completion creates matching central actions without duplicates." footer={footer} number={number} summary={isSectionComplete ? "Complete" : value.length === 0 ? "No actions added" : `${completeActions}/${value.length} actions complete`} summaryComplete={isSectionComplete} title="Action plan for development">{!disabled && value.length < 3 ? <div className="toolbar toolbar-end uco-add-action"><Button icon={Plus} onClick={add}>Add action</Button></div> : null}<div className="uco-action-plan">{value.length === 0 ? <p className="muted-copy">No structured development actions have been added.</p> : value.map((action, index) => <div className="uco-action-row" key={action.id ?? index}><div className="uco-action-row-heading"><strong>Action {index + 1}</strong>{!disabled && !action.centralActionId ? <button aria-label={`Remove action ${index + 1}`} onClick={() => remove(index)} type="button"><X size={16} /></button> : null}</div><div className="form-grid form-grid-three"><label className="entry-field"><span>Type</span><select disabled={disabled} onChange={(event) => update(index, { actionType: event.target.value as UcoTlaActionPlan["actionType"] })} value={action.actionType}><option value="essential">Essential</option><option value="advisable">Advisable</option><option value="good_practice">Sharing good practice</option></select></label><Input disabled={disabled} label={content.field("target", "Target").label} helpText={content.field("target", "Target").helpText} value={action.target} onChange={(target) => update(index, { target })} /><Input disabled={disabled} label="Due date" type="date" value={action.dueDate} onChange={(dueDate) => update(index, { dueDate })} /><label className="entry-field"><span>Owner</span><select disabled={disabled} onChange={(event) => update(index, { ownerStaffId: event.target.value })} value={action.ownerStaffId}><option value="">Select owner</option>{access.ucoStaff.map((staff) => <option key={staff.staffId} value={staff.staffId}>{staff.displayName}</option>)}</select></label><WorkflowNarrativeField className="entry-field uco-method-field" content={content.field("achievementMethod", "How it will be achieved and checked")} disabled={disabled} onChange={value => update(index, { achievementMethod: value })} rows={3} value={action.achievementMethod} /></div>{action.centralActionId ? <small className="muted-copy">Central action created</small> : null}</div>)}</div></ReviewSectionPanel>;
}

function ReviewSectionPanel({ children, defaultOpen = false, description, footer, number, summary, summaryComplete = false, title }: { children: ReactNode; defaultOpen?: boolean; description?: string; footer?: ReactNode; number: number; summary: string; summaryComplete?: boolean; title: string }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return <details className="panel uco-section-panel" onToggle={(event) => setIsOpen(event.currentTarget.open)} open={isOpen}><summary><div className="uco-section-title"><span>{number}</span><div><h2>{title}</h2>{description ? <p>{description}</p> : null}</div></div><span className={summaryComplete ? "uco-section-progress is-complete" : "uco-section-progress"}>{summary}</span><ChevronDown aria-hidden="true" size={18} /></summary><div className="uco-section-panel-body">{children}{footer}</div></details>;
}

function SectionSaveActions({ canComplete, isComplete, isSaving, onSave, onToggleComplete }: { canComplete: boolean; isComplete: boolean; isSaving: boolean; onSave: () => void; onToggleComplete: () => void }) {
  return <div className="uco-section-actions"><span>{isComplete ? "This section is marked complete." : canComplete ? "Ready to be marked complete." : "Complete the required fields first."}</span><div className="toolbar"><Button disabled={isSaving} icon={Save} onClick={onSave}>Save section</Button><Button disabled={isSaving || (!isComplete && !canComplete)} icon={CheckCircle2} onClick={onToggleComplete} variant={isComplete ? undefined : "primary"}>{isComplete ? "Mark as in progress" : "Mark section complete"}</Button></div></div>;
}

function UcoWorkflowMap({ status }: { status: string }) {
  return <section aria-label="UCO TLA review stages" className="uco-workflow-map">{workflowStages.map((stage, index) => {
    const state = workflowStageState(status, index);
    const Icon = stage.icon;
    return <div className={`is-${state.state}`} key={stage.label}><span>{state.state === "complete" ? <CheckCircle2 size={18} /> : <Icon size={18} />}</span><strong>{index + 1}. {stage.label}</strong><small>{state.label}</small><em>{stage.owner}</em></div>;
  })}</section>;
}

function workflowStageState(status: string, index: number): { state: "complete" | "current" | "waiting"; label: string } {
  const completedThrough = status === "completed" ? 3
    : status === "awaiting_finalisation" ? 2
      : status === "awaiting_lecturer" ? 1
        : 0;
  const currentStage = status === "completed" ? -1
    : status === "awaiting_finalisation" ? 3
      : status === "awaiting_lecturer" ? 2
        : 1;
  if (index <= completedThrough) {
    const labels = ["Assigned", "Sent to lecturer", "Acknowledged", "Complete"];
    return { state: "complete", label: labels[index] };
  }
  if (index === currentStage) {
    const labels = ["Assigned", "In progress", "With lecturer", "Ready to sign"];
    return { state: "current", label: labels[index] };
  }
  return { state: "waiting", label: "Waiting" };
}

function workflowHelp(status: string) {
  if (status === "observer_draft") return "The observer completes the review form and sends it to the lecturer.";
  if (status === "awaiting_lecturer") return "Record the professional discussion, then the lecturer adds their reflection and acknowledgement.";
  if (status === "awaiting_finalisation") return "The observer gives final authenticated sign-off; completion will create the agreed central actions.";
  if (status === "completed") return "The review is complete. Any actions and agreed follow-up can now be tracked.";
  return "Continue the review from the available section below.";
}

function evidenceProgress(fields: readonly (readonly [string, string])[], responses: Record<string, string | undefined>) {
  const answered = fields.filter(([key]) => responses[key]?.trim()).length;
  const missingRequired = fields.filter(([key]) => requiredNarrative(key) && !responses[key]?.trim()).length;
  return {
    complete: missingRequired === 0,
    label: missingRequired > 0 ? `${missingRequired} required remaining` : `${answered}/${fields.length} answered`
  };
}

function Guidance() {
  return <details className="panel uco-guidance"><summary><span><strong>Excellent / Good / Minimum guidance</strong><small>Reference only — no rating is stored</small></span><ShieldCheck size={18} /></summary><div className="uco-guidance-grid"><div><h3>Excellent practice</h3><p>Look for consistently ambitious, inclusive and research-informed teaching that enables learners to participate, think critically, apply learning and make strong progress.</p></div><div><h3>Good practice</h3><p>Look for clear planning, appropriate challenge, accurate and accessible resources, purposeful assessment and feedback, and active learner engagement.</p></div><div><h3>Minimum expectations</h3><p>Content must be accurate, level appropriate and inclusive; the session must be organised; learners must know what they are learning and receive usable assessment information and feedback.</p></div></div></details>;
}

function SignOffSummary({ detail }: { detail: UcoTlaReviewDetail }) {
  return <section className="panel"><div className="panel-heading"><div><h2>Authenticated sign-off</h2><span>The lecturer acknowledges the reviewed findings first; the observer then gives final sign-off. Names and timestamps come from authenticated accounts.</span></div></div><div className="uco-signoff-grid"><Detail label="Lecturer acknowledgement" value={detail.lecturerAcknowledgedAt ? `${detail.lecturerSignatoryName ?? detail.review.lecturerName} / ${formatDateTime(detail.lecturerAcknowledgedAt)}` : "Pending"} /><Detail label="Observer final sign-off" value={detail.observerSignedAt ? `${detail.observerSignatoryName ?? detail.review.observerName} / ${formatDateTime(detail.observerSignedAt)}` : "Pending"} /></div></section>;
}

function ReviewRow({ onOpen, review }: { onOpen: () => void; review: UcoTlaReviewSummary }) {
  return <button className="uco-review-row" onClick={onOpen} type="button"><span className={`status-pill status-${statusTone(review.workflowStatus)}`}>{humanStatus(review.workflowStatus)}</span><span><strong>{review.lecturerName}</strong><small>{sessionLabel(review.courseTitle, review.moduleTitle)}</small></span><span><strong>{formatDateTime(review.observationAt)}</strong><small>Observer: {review.observerName}</small></span><span><strong>{review.completedSectionCount}/7 sections marked</strong><small>{review.openActionCount} open · {review.overdueActionCount} overdue</small></span></button>;
}

function StaffSelect({ label, onChange, options, value }: { label: string; onChange: (value: string) => void; options: UcoTlaAccessSummary["ucoStaff"]; value: string }) {
  return <label className="entry-field"><span>{label}</span><select onChange={(event) => onChange(event.target.value)} value={value}><option value="">Select {label.toLowerCase()}</option>{options.map((option) => <option key={option.staffId} value={option.staffId}>{option.displayName}</option>)}</select></label>;
}

function Input({ disabled = false, label, helpText, onChange, type = "text", value }: { disabled?: boolean; label: string; helpText?: string; onChange: (value: string) => void; type?: string; value: string }) {
  const helpId = useId();
  return <label className="entry-field"><span>{label}</span><input disabled={disabled} aria-describedby={helpText ? helpId : undefined} onChange={(event) => onChange(event.target.value)} type={type} value={value} />{helpText ? <small id={helpId}>{helpText}</small> : null}</label>;
}

function NumberInput({ label, onChange, value }: { label: string; onChange: (value: number | undefined) => void; value?: number }) {
  return <label className="entry-field"><span>{label}</span><input min={0} onChange={(event) => onChange(event.target.value === "" ? undefined : Number(event.target.value))} type="number" value={value ?? ""} /></label>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function formFromDetail(detail: UcoTlaReviewDetail): SaveUcoTlaObserverSectionRequest {
  return {
    observationAt: detail.review.observationAt ?? "",
    sessionType: detail.sessionType ?? "",
    courseTitle: detail.review.courseTitle ?? "",
    moduleTitle: detail.review.moduleTitle ?? "",
    courseLevel: detail.courseLevel ?? "",
    numberRegistered: detail.numberRegistered,
    numberPresent: detail.numberPresent,
    numberLate: detail.numberLate,
    responses: { ...detail.responses },
    actionPlan: detail.actionPlan.map((action) => ({ ...action })),
    professionalDiscussionAt: detail.review.professionalDiscussionAt,
    followUp: detail.followUp ? {
      followUpType: detail.followUp.followUpType,
      scheduledAt: detail.followUp.scheduledAt,
      status: detail.followUp.status,
      outcomeNotes: detail.followUp.outcomeNotes
    } : undefined,
    rowVersion: detail.review.rowVersion
  };
}

function emptyFollowUp() {
  return { followUpType: "discussion" as const, scheduledAt: "", status: "scheduled" as const };
}

function followUpFromDetail(detail: UcoTlaReviewDetail) {
  return {
    followUpType: detail.followUp?.followUpType ?? "discussion" as const,
    scheduledAt: toLocalInput(detail.followUp?.scheduledAt),
    status: detail.followUp?.status ?? "scheduled" as const,
    outcomeNotes: detail.followUp?.outcomeNotes ?? ""
  };
}

function canCreateLinkedReview(value: { observerStaffId: string; observationAt: string; sessionType: string; courseTitle: string; moduleTitle: string; courseLevel: string }, lecturerStaffId: string) {
  return Boolean(value.observerStaffId && value.observationAt && value.sessionType.trim()
    && value.courseTitle.trim() && value.moduleTitle.trim() && value.courseLevel.trim()
    && lecturerStaffId !== value.observerStaffId);
}

function canCreate(value: CreateUcoTlaReviewRequest) {
  return Boolean(value.lecturerStaffId && value.observerStaffId && value.lecturerStaffId !== value.observerStaffId);
}

function actionPlanComplete(actions: UcoTlaActionPlan[]) {
  return actions.every((action) => Boolean(action.target.trim() && action.achievementMethod.trim() && action.ownerStaffId && action.dueDate));
}

function sectionTitle(sectionKey: string) {
  const titles: Record<string, string> = {
    session_details: "Course and session details",
    teaching_learning_activities: "Teaching and learning activities",
    delivery_facilitation: "Delivery and facilitation",
    learning_materials: "Teaching, learning and assessment materials",
    findings: "Findings",
    action_plan: "Action plan",
    discussion_follow_up: "Professional discussion and follow-up"
  };
  return titles[sectionKey] ?? "Review section";
}

function requiredNarrative(key: string) {
  return key !== "essential_actions" && key !== "advisable_actions" && key !== "excellent_practice";
}

function humanStatus(status: string) {
  return status.split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

function statusTone(status: string) {
  if (status === "completed") return "complete";
  if (status === "observer_draft") return "draft";
  return "submitted";
}

function formatDateTime(value?: string) {
  return value ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
}

function sessionLabel(courseTitle?: string, moduleTitle?: string) {
  return courseTitle || moduleTitle ? [courseTitle, moduleTitle].filter(Boolean).join(" / ") : "Session details not yet provided";
}

function toLocalInput(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromLocalInput(value: string) {
  return value ? new Date(value).toISOString() : "";
}
