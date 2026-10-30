import { ScrollableTableRegion } from "../components/ScrollableTableRegion";
import { LoadingState } from "../components/LoadingState";
import { useUnsavedChanges, confirmUnsavedNavigation, useNavigationDecisionPending } from "../components/UnsavedChangesGuard";
import { writeAppPath } from "../app/history";
import { accessibleQaAdminSections, qaAdminPath, qaAdminSectionFromPath } from "../app/qaAdminNavigation";
import { QaAdminCentre } from "./QaAdminCentre";
import { QaEvidenceSaveQueue } from "../services/qaEvidenceSaveQueue";
import { QaOutcomeLabelsContext, defaultQaOutcomeLabels, useQaOutcomeLabels, qaCombinedOutcomeLabel } from "../services/qaOutcomeLabels";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Accessibility, AlertTriangle, Archive, ArrowLeft, Building2, CalendarRange, Check, CheckCircle2, ClipboardCheck, ClipboardList, Eye, FileCheck2, FileSearch, Footprints, ListChecks, MapPin, MessageCircle, Monitor, Plus, RotateCcw, Search, ShieldCheck, Target, Users, X } from "lucide-react";
import { CollapsibleSection } from "../components/CollapsibleSection";
import { QaDashboardDataExplorer } from "../components/QaDashboardDataExplorer";
import { Button } from "../design-system/Button";
import { ReportButton } from "../components/ExportButtons";
import { api } from "../services/api";
import { AdminListSort } from "../components/AdminListSort";
import { distinctListValues, matchesListSearch, sortListRows } from "../services/listQuery";
import { dashboardVisibleUnitIds } from "../services/dashboardOrgVisibility";
import { learningWalkDeliveryChoices, type LearningWalkDeliveryArea } from "../services/learningWalkDeliveryAreas";
import type {
  AcademicYearSummary,
  CurrentUser,
  OrgUnitSummary,
  QaActivityTypeSummary,
  QaActionGroupSummary,
  QaDashboardBreakdown,
  QaDashboardQuestionBreakdown,
  QaDashboardSummary,
  QaEvidenceDetail,
  QaEvidenceResponseSummary,
  QaHubSummary,
  QaQuestionSummary,
  QaReviewActionOptions,
  QaReviewDetail,
  SaveQaEvidenceRequest,
  SaveQaReviewRequest,
  StaffSummary
} from "../services/types";

type QaHubProps = {
  user: CurrentUser;
  orgUnits: OrgUnitSummary[];
  staff: StaffSummary[];
  academicYears: AcademicYearSummary[];
  onReturnToElevate: () => void;
};

type QaPage =
  | { kind: "list" }
  | { kind: "admin"; section: string }
  | { kind: "actions" }
  | { kind: "new" }
  | { kind: "review"; id: string; section: "configuration" | "evidence" | "dashboard" | "actions" }
  | { kind: "evidence"; id: string };

function useQaNavigationGuard(dirty: boolean, busy: boolean, onSave?: () => Promise<boolean>) {
  return useUnsavedChanges({ dirty, saving: busy, label: "QA review", onSave });
}

function qaReviewPath(review: QaHubSummary["reviews"][number]) {
  return `/qa-hub/reviews/${review.id}/${review.status === "draft" ? "configuration" : review.status === "closed" || review.status === "archived" ? "dashboard" : "evidence"}`;
}

function qaStatusLabel(status: string) { return status[0].toUpperCase() + status.slice(1); }
function qaCount(count: number, singular: string, plural = `${singular}s`) { return `${count} ${count === 1 ? singular : plural}`; }

const qaActivityIcons: Record<string, typeof Eye> = {
  lesson_visit: Eye,
  digital_learning_walk: Monitor,
  work_scrutiny: FileSearch,
  inclusion_learning_walk: Accessibility,
  walk_around: Footprints,
  desk_review: ClipboardList,
  stop_and_ask: MessageCircle,
  student_voice: Users
};

function formatQuestionTag(questionTag: string) {
  const label = questionTag.replaceAll("_", " ").replaceAll("-", " ").trim();
  return label ? `${label[0].toUpperCase()}${label.slice(1)}` : "General";
}

function normalizeQuestionSet(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function parseQuestionSets(value: string) {
  const sets = value.split(",").map(normalizeQuestionSet).filter(Boolean);
  return Array.from(new Set(sets));
}

function questionSetKeys(question: QaQuestionSummary) {
  const explicitTag = normalizeQuestionSet(question.questionTag || "general");
  if (explicitTag !== "general") return [explicitTag];

  const theme = question.themeOrWeek?.trim() ?? "";
  const sharedWeeks = /^weeks?\s+(\d+)\s+(?:and|&)\s+(\d+)/i.exec(theme);
  if (sharedWeeks) return [`week_${sharedWeeks[1]}`, `week_${sharedWeeks[2]}`];
  const singleWeek = /^week\s+(\d+)/i.exec(theme);
  if (singleWeek) return [`week_${singleWeek[1]}`];
  return ["general"];
}

function pageFromPath(pathname = window.location.pathname): QaPage {
  const adminSection = qaAdminSectionFromPath(pathname);
  if (adminSection !== null) return { kind: "admin", section: adminSection };
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[1] === "actions") return { kind: "actions" };
  if (parts[1] === "evidence" && parts[2]) return { kind: "evidence", id: parts[2] };
  if (parts[1] === "reviews" && parts[2] === "new") return { kind: "new" };
  if (parts[1] === "reviews" && parts[2]) {
    const section = parts[3];
    return { kind: "review", id: parts[2], section: section === "configuration" || section === "dashboard" || section === "actions" ? section : "evidence" };
  }
  return { kind: "list" };
}

export function QaHub({ user, orgUnits, staff, academicYears, onReturnToElevate }: QaHubProps) {
  const [outcomeLabels, setOutcomeLabels] = useState(defaultQaOutcomeLabels);
  const [page, setPage] = useState<QaPage>(() => pageFromPath());
  const [summary, setSummary] = useState<QaHubSummary | null>(null);
  const [activities, setActivities] = useState<QaActivityTypeSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const summarySequence = useRef(0);
  const canAdminister = accessibleQaAdminSections(user.permissions, user.isAdministrator === true).length > 0;
  const navigate = useCallback(async (path: string) => {
    if (!await confirmUnsavedNavigation()) return;
    writeAppPath(path);
    setPage(pageFromPath(path));
    window.scrollTo({ top: 0, behavior: "auto" });
    window.requestAnimationFrame(() => document.getElementById("main-content")?.focus({ preventScroll: true }));
  }, []);

  const refreshSummary = useCallback(async () => {
    const sequence = ++summarySequence.current;
    setError("");
    try {
      const [nextSummary, nextActivities, nextLabels] = await Promise.all([api.qaHubSummary(), api.qaActivityTypes(), api.qaOutcomeLabels()]);
      if (sequence !== summarySequence.current) return;
      setOutcomeLabels(nextLabels.labels);
      setSummary(nextSummary);
      setActivities(nextActivities);
    } catch {
      if (sequence === summarySequence.current) setError("QA Hub could not be loaded. Check your connection and review access, then try again.");
    } finally {
      if (sequence === summarySequence.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => { void refreshSummary(); return () => { ++summarySequence.current; }; }, [refreshSummary]);
  useEffect(() => {
    if (page.kind === "admin") writeAppPath(qaAdminPath(page.section), true);
  }, [page]);
  const previousPageKind = useRef(page.kind);
  useEffect(() => {
    if (previousPageKind.current === "admin" && page.kind !== "admin") void refreshSummary();
    previousPageKind.current = page.kind;
  }, [page.kind, refreshSummary]);
  useEffect(() => {
    const accepted = (event: Event) => {
      const pathname = (event as CustomEvent<{ pathname: string }>).detail.pathname;
      if (pathname.startsWith("/qa-hub") || qaAdminSectionFromPath(pathname) !== null) setPage(pageFromPath(pathname));
    };
    window.addEventListener("app:navigation-accepted", accepted);
    return () => window.removeEventListener("app:navigation-accepted", accepted);
  }, []);

  const workspaceNavigation = <nav aria-label="QA Hub workspace" className="segmented-control qa-hub-tabs">
    {summary?.canAccessHub ? <button aria-current={page.kind !== "actions" && page.kind !== "admin" ? "page" : undefined} className={page.kind !== "actions" && page.kind !== "admin" ? "is-active" : ""} onClick={() => void navigate("/qa-hub/reviews")} type="button">Reviews</button> : null}
    {summary?.canAccessHub && summary.canMonitorActions ? <button aria-current={page.kind === "actions" ? "page" : undefined} className={page.kind === "actions" ? "is-active" : ""} onClick={() => void navigate("/qa-hub/actions")} type="button">Action monitoring</button> : null}
    {canAdminister ? <button aria-current={page.kind === "admin" ? "page" : undefined} className={page.kind === "admin" ? "is-active" : ""} onClick={() => void navigate(qaAdminPath())} type="button">Administration</button> : null}
  </nav>;

  // Managing reference lists or reporting does not grant access to QA reviews.
  // Render authorised settings independently of the review-summary access check.
  if (page.kind === "admin") return <div className="route-stack qa-hub">{workspaceNavigation}<QaAdminCentre user={user} initialSection={page.section} onNavigate={navigate} canManageReviews={summary?.canManageReviews} canAccessReviews={summary?.canAccessHub} /></div>;
  if (isLoading) return <LoadingState label="Loading QA Hub" size="page" />;
  if (error || !summary?.canAccessHub) return (
    <section className="access-denied-panel">
      <AlertTriangle size={22} aria-hidden="true" />
      <div><h1>QA Hub unavailable</h1><p>{error || "No active or historical QA Review is assigned to this account."}</p></div>
      <Button onClick={onReturnToElevate} variant="primary">Return to i-Elevate</Button>
      {error ? <Button onClick={() => { setIsLoading(true); void refreshSummary(); }}>Try again</Button> : null}
      {canAdminister ? <Button onClick={() => void navigate(qaAdminPath())}>Open QA administration</Button> : null}
    </section>
  );

  return (
    <QaOutcomeLabelsContext.Provider value={outcomeLabels}><div className="route-stack qa-hub">
      {workspaceNavigation}
      {page.kind === "review" && summary.reviews.length > 1 ? <label className="qa-review-switcher"><span>Current review</span><select aria-label="Switch QA review" value={page.id} onChange={(event) => { const review = summary.reviews.find((item) => item.id === event.target.value); if (review) navigate(qaReviewPath(review)); }}>{summary.reviews.map((review) => <option key={review.id} value={review.id}>{review.title} · {qaStatusLabel(review.status)} · {review.academicYear}</option>)}</select></label> : null}
      {page.kind === "list" ? <QaReviewList onNavigate={navigate} summary={summary} /> : null}
      {page.kind === "actions" && summary.canMonitorActions ? <QaAdminActions onNavigate={navigate} reviews={summary.reviews} /> : null}
      {page.kind === "actions" && !summary.canMonitorActions ? <section className="access-denied-panel"><AlertTriangle size={22}  aria-hidden="true"/><div><h1>Action monitoring unavailable</h1><p>This college-wide view is restricted to Administrators.</p></div><Button onClick={() => navigate("/qa-hub/reviews")} variant="primary">Return to reviews</Button></section> : null}
      {page.kind === "new" && summary.canManageReviews ? (
        <QaReviewEditor
          academicYears={academicYears}
          activities={activities}
          onCancel={() => navigate("/qa-hub")}
          onSaved={(id, navigateAfterSave = true) => { void refreshSummary(); if (navigateAfterSave) void navigate(`/qa-hub/reviews/${id}/evidence`); }}
          orgUnits={orgUnits}
          staff={staff}
          user={user}
        />
      ) : null}
      {page.kind === "review" ? (
        <QaReviewWorkspace
          key={`${page.id}/${page.section}`}
          academicYears={academicYears}
          activities={activities}
          id={page.id}
          onNavigate={navigate}
          onRefreshSummary={refreshSummary}
          orgUnits={orgUnits}
          section={page.section}
          staff={staff}
          user={user}
        />
      ) : null}
      {page.kind === "new" && !summary.canManageReviews ? <section className="panel"><h1>Review setup unavailable</h1><p>Your account can contribute to its assigned reviews.</p><Button onClick={() => navigate("/qa-hub/reviews")}>All reviews</Button></section> : null}
      {page.kind === "evidence" ? <QaEvidenceEditor key={page.id} evidenceId={page.id} reviews={summary.reviews} onNavigate={navigate} onSubmitted={refreshSummary} /> : null}
    </div></QaOutcomeLabelsContext.Provider>
  );
}

function QaReviewList({ summary, onNavigate }: { summary: QaHubSummary; onNavigate: (path: string) => void }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("active");
  const [year, setYear] = useState("");
  const [owner, setOwner] = useState("");
  const [sort, setSort] = useState("closing-desc");
  const reviews = sortListRows(summary.reviews.filter((review) => {
    const statusMatches = status === "all" || status === "active" && review.status !== "archived" || status === "open" && review.status === "reopened" || review.status === status;
    const queryMatches = matchesListSearch(query, review.title, review.theme, review.ownerName, review.academicYear, review.status, review.closingDate);
    return statusMatches && queryMatches && (!year || review.academicYear === year) && (!owner || review.ownerName === owner);
  }), review => sort.startsWith("title") ? review.title : sort.startsWith("owner") ? review.ownerName : sort.startsWith("status") ? review.status : Date.parse(review.closingDate), sort.endsWith("desc") ? "desc" : "asc", review => review.id);
  return (
    <>
      <section className="route-header qa-heading">
        <div><p className="eyebrow">Quality assurance</p><h1>QA Hub</h1><p>Choose a review to contribute evidence or explore findings. Multiple reviews can run at the same time.</p></div>
        {summary.canManageReviews ? <div className="toolbar"><Button icon={Plus} onClick={() => onNavigate("/qa-hub/reviews/new")} variant="primary">New review</Button></div> : null}
      </section>
      <section className="qa-kpi-grid compact" aria-label="QA Review counts">
        <article className="stat-card"><span>Open reviews</span><strong>{summary.openReviewCount}</strong></article>
        <article className="stat-card"><span>Available to me</span><strong>{summary.accessibleReviewCount}</strong></article>
        <article className="stat-card"><span>Visible reviews</span><strong>{summary.reviews.length}</strong></article>
      </section>
      <section className="panel qa-review-list">
        <div className="filter-toolbar qa-filter-toolbar">
          <label className="search-box"><Search size={16} aria-hidden="true" /><input aria-label="Search reviews" onChange={(event) => setQuery(event.target.value)} placeholder="Search title, theme or owner" value={query} /></label>
          <label className="qa-filter-field"><span>Status</span><select onChange={(event) => setStatus(event.target.value)} value={status}><option value="active">Current and historical</option><option value="draft">Draft</option><option value="open">Open</option><option value="reopened">Reopened</option><option value="closed">Closed</option><option value="archived">Archived</option><option value="all">All</option></select></label>
          <label className="qa-filter-field"><span>Academic year</span><select value={year} onChange={event => setYear(event.target.value)}><option value="">All years</option>{distinctListValues(summary.reviews.map(review => review.academicYear)).reverse().map(value => <option key={value}>{value}</option>)}</select></label>
          <label className="qa-filter-field"><span>Owner</span><select value={owner} onChange={event => setOwner(event.target.value)}><option value="">All owners</option>{distinctListValues(summary.reviews.map(review => review.ownerName)).map(value => <option key={value}>{value}</option>)}</select></label>
          <AdminListSort value={sort} onChange={setSort} options={[["closing-desc","Closing date: newest first"],["closing-asc","Closing date: oldest first"],["title-asc","Review: A–Z"],["owner-asc","Owner: A–Z"],["status-asc","Status: A–Z"]]} />
        </div>
        {reviews.length === 0 ? <p className="empty-state">No QA Reviews match these filters.</p> : (
          <div className="qa-review-cards">
            {reviews.map((review) => (
              <button className="qa-review-card" key={review.id} onClick={() => onNavigate(qaReviewPath(review))} type="button">
                <span className={`status-pill status-${review.status}`}>{qaStatusLabel(review.status)}</span>
                <strong>{review.title}</strong><span>{review.theme}</span>
                <small>{review.academicYear} · closes {new Date(`${review.closingDate}T00:00:00`).toLocaleDateString()} · {review.ownerName}</small>
                <span className="qa-card-counts"><span>{qaCount(review.teamCount, "team")}</span><span>{qaCount(review.activityCount, "activity", "activities")}</span><span>{qaCount(review.evidenceCount, "submission")}</span></span>
              </button>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function QaAdminActions({ reviews, onNavigate }: { reviews: QaHubSummary["reviews"]; onNavigate: (path: string) => void }) {
  const [groups, setGroups] = useState<QaActionGroupSummary[]>([]);
  const [reviewOptions, setReviewOptions] = useState<QaReviewActionOptions[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [status, setStatus] = useState("active");
  const [reviewId, setReviewId] = useState("");
  const [facultyId, setFacultyId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("due-asc");
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    try {
      const [nextGroups, nextOptions] = await Promise.all([api.qaAdminActions(), api.qaActionReviewOptions()]);
      setGroups(nextGroups);
      setReviewOptions(nextOptions);
    }
    catch { setMessage("QA actions could not be loaded."); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const faculties = Array.from(new Map(groups.filter((group) => group.facultyOrgUnitId).map((group) => [group.facultyOrgUnitId!, group.facultyName])).entries());
  const teamOptions = Array.from(new Map(groups.flatMap((group) => group.teamOrgUnitIds.map((id, index) => [id, group.teamNames[index]] as const))).entries());
  const visible = sortListRows(groups.filter((group) => {
    if (status === "active" && group.status !== "open" && group.status !== "overdue") return false;
    if (status !== "active" && status !== "all" && group.status !== status) return false;
    if (reviewId && group.reviewId !== reviewId) return false;
    if (facultyId && group.facultyOrgUnitId !== facultyId) return false;
    if (teamId && !group.teamOrgUnitIds.includes(teamId)) return false;
    return matchesListSearch(query, group.title, group.detail, group.reviewTitle, group.facultyName, group.teamNames, group.creatorName, group.status, group.dueDate, group.closeNote, group.assignments.map(assignment => [assignment.staffName, assignment.sourceOrgUnitName, assignment.assignmentRole, assignment.status]));
  }), group => sort.startsWith("title") ? group.title : sort.startsWith("review") ? group.reviewTitle : sort.startsWith("status") ? group.status : Date.parse(group.dueDate), sort.endsWith("desc") ? "desc" : "asc", group => group.id);
  async function review(group: QaActionGroupSummary) {
    const result = await api.reviewQaActionGroup(group.id, group.rowVersion);
    if (!result.ok) { setMessage(result.message ?? "The QA action could not be reviewed."); return; }
    setGroups((current) => current.map((item) => item.id === group.id ? result.data! : item));
  }
  async function close(group: QaActionGroupSummary) {
    const result = await api.closeQaActionGroup(group.id, group.rowVersion);
    if (!result.ok) { setMessage(result.message ?? "The QA action could not be closed."); return; }
    setGroups((current) => current.map((item) => item.id === group.id ? result.data! : item));
  }
  const openCount = groups.filter((group) => group.status === "open" || group.status === "overdue").length;
  const overdueCount = groups.filter((group) => group.status === "overdue").length;
  return (
    <div className="route-stack">
      <section className="route-header qa-heading"><div><p className="eyebrow">Quality improvement follow-up</p><h1>QA action monitoring</h1><p>Create, review and close permission-scoped actions from completed QA Reviews.</p></div>{reviewOptions.length ? <Button icon={Plus} onClick={async () => { if (!isCreating || await confirmUnsavedNavigation()) setIsCreating((current) => !current); }} variant="primary">{isCreating ? "Hide action form" : "Action"}</Button> : null}</section>
      {message ? <div className="api-error-banner" role="alert"><AlertTriangle size={16}  aria-hidden="true"/>{message}</div> : null}
      {isCreating && reviewOptions.length ? <QaMonitoringActionCreator onCreated={async () => { await load(); setIsCreating(false); }} reviewOptions={reviewOptions} /> : null}
      <section className="qa-kpi-grid"><article className="stat-card"><span>Active action groups</span><strong>{openCount}</strong></article><article className="stat-card"><span>Overdue</span><strong>{overdueCount}</strong></article><article className="stat-card"><span>Assignments</span><strong>{groups.reduce((total, group) => total + group.assignments.length, 0)}</strong></article><article className="stat-card"><span>Completed or closed</span><strong>{groups.length - openCount}</strong></article></section>
      <section className="panel qa-action-monitor-filters">
        <label className="search-box"><Search size={16}  aria-hidden="true"/><input aria-label="Search QA actions" onChange={(event) => setQuery(event.target.value)} placeholder="Search action, review or scope" value={query} /></label>
        <label><span>Status</span><select onChange={(event) => setStatus(event.target.value)} value={status}><option value="active">Open and overdue</option><option value="open">Open</option><option value="overdue">Overdue</option><option value="reviewed">Reviewed</option><option value="closed">Closed</option><option value="all">All</option></select></label>
        <label><span>Review</span><select onChange={(event) => setReviewId(event.target.value)} value={reviewId}><option value="">All reviews</option>{reviews.map((review) => <option key={review.id} value={review.id}>{review.title}</option>)}</select></label>
        <label><span>Faculty</span><select onChange={(event) => { setFacultyId(event.target.value); setTeamId(""); }} value={facultyId}><option value="">All faculties</option>{faculties.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label><span>Team</span><select onChange={(event) => setTeamId(event.target.value)} value={teamId}><option value="">All teams</option>{teamOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <AdminListSort value={sort} onChange={setSort} options={[["due-asc","Due date: soonest first"],["due-desc","Due date: latest first"],["title-asc","Action: A–Z"],["review-asc","Review: A–Z"],["status-asc","Status: A–Z"]]} />
      </section>
      <QaActionGroupCards filterable={false} groups={visible} onClose={close} onOpenReview={(id) => onNavigate(`/qa-hub/reviews/${id}/dashboard`)} onReview={review} />
    </div>
  );
}

function QaMonitoringActionCreator({ reviewOptions, onCreated }: { reviewOptions: QaReviewActionOptions[]; onCreated: () => Promise<void> }) {
  const [reviewId, setReviewId] = useState(reviewOptions[0]?.reviewId ?? "");
  const options = reviewOptions.find((item) => item.reviewId === reviewId) ?? reviewOptions[0];
  if (!options) return null;
  return (
    <div className="route-stack qa-monitoring-action-create">
      <section className="panel qa-action-review-picker"><label className="entry-field"><span>QA Review <strong>Required</strong></span><select onChange={async (event) => { const next = event.target.value; if (await confirmUnsavedNavigation()) setReviewId(next); }} value={options.reviewId}>{reviewOptions.map((item) => <option key={item.reviewId} value={item.reviewId}>{item.reviewTitle}</option>)}</select></label><p>Only reviews that include your permitted faculty or team are available.</p></section>
      <QaActionCreator key={options.reviewId} onCreated={onCreated} options={options} reviewId={options.reviewId} />
    </div>
  );
}

type ReviewEditorProps = Omit<QaHubProps, "onReturnToElevate"> & {
  activities: QaActivityTypeSummary[];
  existing?: QaReviewDetail;
  onCancel: () => void;
  onSaved: (id: string, navigateAfterSave?: boolean) => void;
};

function QaReviewEditor({ user, orgUnits, staff, academicYears, activities, existing, onCancel, onSaved }: ReviewEditorProps) {
  const published = Boolean(existing && existing.review.status !== "draft");
  const faculties = useMemo(() => orgUnits
    .filter((unit) => unit.isActive && unit.orgUnitType === "faculty")
    .sort((left, right) => left.name.localeCompare(right.name)), [orgUnits]);
  const activeTeams = useMemo(() => orgUnits
    .filter((unit) => unit.isActive && ["team", "faculty_child", "faculty_child_code"].includes(unit.orgUnitType))
    .sort((left, right) => left.name.localeCompare(right.name)), [orgUnits]);
  const existingTeamIds = existing?.scope.filter((scope) => scope.scopeType === "team").map((scope) => scope.orgUnitId) ?? [];
  const [selectedFacultyIds, setSelectedFacultyIds] = useState<string[]>(() => Array.from(new Set(
    activeTeams.filter((team) => existingTeamIds.includes(team.id)).map((team) => team.parentOrgUnitId).filter((id): id is string => Boolean(id))
  )));
  const [questions, setQuestions] = useState<QaQuestionSummary[]>([]);
  const [questionsLoaded, setQuestionsLoaded] = useState(false);
  const [form, setForm] = useState<SaveQaReviewRequest>(() => ({
    title: existing?.review.title ?? "",
    academicYear: existing?.review.academicYear ?? academicYears.find((year) => year.isCurrent)?.academicYear ?? academicYears[0]?.academicYear ?? "",
    theme: existing?.review.theme ?? "",
    questionTag: existing?.questionTag ?? "general",
    ownerStaffId: existing?.ownerStaffId ?? user.staffId ?? staff[0]?.id ?? "",
    plannedOpenDate: existing?.review.plannedOpenDate,
    closingDate: existing?.review.closingDate ?? "",
    teamOrgUnitIds: existingTeamIds,
    activities: existing?.activities.map((activity) => ({ activityTypeId: activity.activityTypeId, templateId: activity.templateId, questionIds: activity.questions.map((question) => question.id) })) ?? [],
    rowVersion: existing?.review.rowVersion
  }));
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const saveInFlight = useRef(false);
  const clearNavigation = useQaNavigationGuard(dirty, saving, () => save(false));
  const [questionError, setQuestionError] = useState("");
  const [questionAttempt, setQuestionAttempt] = useState(0);
  const [setupSearch, setSetupSearch] = useState("");
  const [setupSort, setSetupSort] = useState("configured");
  const [scopeSearch, setScopeSearch] = useState("");

  useEffect(() => {
    if (published) { setQuestionsLoaded(true); return; }
    let cancelled = false;
    setQuestionsLoaded(false); setQuestionError("");
    void api.qaQuestions(undefined, false)
      .then(next => { if (!cancelled) setQuestions(next); })
      .catch(() => { if (!cancelled) setQuestionError("Activity questions could not be loaded. Your setup is still here; try loading them again."); })
      .finally(() => { if (!cancelled) setQuestionsLoaded(true); });
    return () => { cancelled = true; };
  }, [published, questionAttempt]);

  const selectedQuestionSets = useMemo(() => parseQuestionSets(form.questionTag), [form.questionTag]);
  const questionSets = useMemo(() => Array.from(new Set(["general", ...questions.flatMap(questionSetKeys)]))
    .filter(Boolean).sort((left, right) => left === "general" ? -1 : right === "general" ? 1 : left.localeCompare(right, undefined, { numeric: true })), [questions]);
  const questionSetLabels = useMemo(() => {
    const labels = new Map<string, string>([["general", "General"]]);
    for (const question of questions) {
      for (const key of questionSetKeys(question)) {
        if (key === "general" || labels.has(key)) continue;
        const theme = question.themeOrWeek?.trim();
        labels.set(key, theme && !/^weeks?\s+\d+\s+(?:and|&)\s+\d+/i.test(theme) ? theme : formatQuestionTag(key));
      }
    }
    return labels;
  }, [questions]);
  const setupReady = Boolean(
    form.title.trim() && form.theme.trim() && form.questionTag.trim() && form.academicYear && form.ownerStaffId && form.closingDate
    && form.teamOrgUnitIds.length && form.activities.length
    && form.activities.every((activity) => activity.templateId && activity.questionIds.length)
    && (!form.plannedOpenDate || form.plannedOpenDate <= form.closingDate)
    && questionsLoaded && !questionError
  );

  function update<K extends keyof SaveQaReviewRequest>(key: K, value: SaveQaReviewRequest[K]) {
    setDirty(true);
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toggleFaculty(facultyId: string) {
    if (published && activeTeams.some((team) => team.parentOrgUnitId === facultyId && existingTeamIds.includes(team.id))) return;
    setDirty(true);
    const selected = selectedFacultyIds.includes(facultyId);
    const childIds = activeTeams.filter((team) => team.parentOrgUnitId === facultyId).map((team) => team.id);
    const childSet = new Set(childIds);
    setSelectedFacultyIds((current) => selected ? current.filter((id) => id !== facultyId) : [...current, facultyId]);
    setForm((current) => ({
      ...current,
      teamOrgUnitIds: selected
        ? current.teamOrgUnitIds.filter((id) => !childSet.has(id))
        : Array.from(new Set([...current.teamOrgUnitIds, ...childIds]))
    }));
  }

  function toggleTeam(id: string) {
    if (published && existingTeamIds.includes(id)) return;
    update("teamOrgUnitIds", form.teamOrgUnitIds.includes(id)
      ? form.teamOrgUnitIds.filter((value) => value !== id)
      : [...form.teamOrgUnitIds, id]);
  }

  function setAllFacultyTeams(facultyId: string, selected: boolean) {
    const childIds = activeTeams.filter((team) => team.parentOrgUnitId === facultyId).map((team) => team.id);
    const childSet = new Set(childIds);
    update("teamOrgUnitIds", selected
      ? Array.from(new Set([...form.teamOrgUnitIds, ...childIds]))
      : form.teamOrgUnitIds.filter((id) => !childSet.has(id) || published && existingTeamIds.includes(id)));
  }

  function taggedQuestionIds(activityTypeId: string, questionSetValue = form.questionTag) {
    return taggedQuestions(activityTypeId, questionSetValue).map((question) => question.id);
  }

  function taggedQuestions(activityTypeId: string, questionSetValue = form.questionTag) {
    const selectedSets = new Set(parseQuestionSets(questionSetValue));
    return questions.filter((question) => question.activityTypeId === activityTypeId
      && question.isActive && question.sourceStatus === "active"
      && questionSetKeys(question).some((questionSet) => selectedSets.has(questionSet)));
  }

  function changeQuestionSets(questionSets: string[]) {
    setDirty(true);
    const questionTag = Array.from(new Set(questionSets)).join(",");
    setForm((current) => ({
      ...current,
      questionTag,
      activities: current.activities.map((activity) => {
        const previouslyEligible = new Set(taggedQuestionIds(activity.activityTypeId, current.questionTag));
        const nextEligible = taggedQuestionIds(activity.activityTypeId, questionTag);
        const nextEligibleSet = new Set(nextEligible);
        return {
          ...activity,
          questionIds: Array.from(new Set([
            ...activity.questionIds.filter((id) => nextEligibleSet.has(id)),
            ...nextEligible.filter((id) => !previouslyEligible.has(id))
          ]))
        };
      })
    }));
  }

  function toggleQuestionSet(questionSet: string) {
    changeQuestionSets(selectedQuestionSets.includes(questionSet)
      ? selectedQuestionSets.filter((value) => value !== questionSet)
      : [...selectedQuestionSets, questionSet]);
  }

  function toggleActivityQuestion(activityTypeId: string, questionId: string) {
    update("activities", form.activities.map((activity) => activity.activityTypeId !== activityTypeId ? activity : {
      ...activity,
      questionIds: activity.questionIds.includes(questionId)
        ? activity.questionIds.filter((id) => id !== questionId)
        : [...activity.questionIds, questionId]
    }));
  }

  function setAllActivityQuestions(activityTypeId: string, selected: boolean) {
    const eligibleIds = taggedQuestionIds(activityTypeId);
    update("activities", form.activities.map((activity) => activity.activityTypeId === activityTypeId
      ? { ...activity, questionIds: selected ? eligibleIds : [] }
      : activity));
  }

  function toggleActivity(activity: QaActivityTypeSummary) {
    const selected = form.activities.some((item) => item.activityTypeId === activity.id);
    update("activities", selected ? form.activities.filter((item) => item.activityTypeId !== activity.id) : [...form.activities, {
      activityTypeId: activity.id,
      templateId: activity.templates.find((template) => template.isActive)?.id ?? "",
      questionIds: taggedQuestionIds(activity.id)
    }]);
  }

  async function save(navigateAfterSave = true): Promise<boolean> {
    if (saveInFlight.current) return false;
    if (!setupReady) { setMessage("Complete the required review details, teams and activity criteria before saving."); return false; }
    saveInFlight.current = true;
    setSaving(true);
    setMessage("");
    try {
      const result = existing ? await api.updateQaReview(existing.review.id, form) : await api.createQaReview(form);
      if (!result.ok) { setMessage(result.message ?? "The review could not be saved."); return false; }
      setDirty(false);
      clearNavigation();
      onSaved(existing?.review.id ?? (result.data as { id: string }).id, navigateAfterSave);
      return true;
    } catch {
      setMessage("The review could not be saved. Your setup is still here; try again.");
      return false;
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="qa-review-builder">
      <section className="route-header qa-builder-heading">
        <div>
          <Button disabled={saving} icon={ArrowLeft} onClick={onCancel} variant="quiet">{existing ? "Back to review" : "Back to QA Hub"}</Button>
          <p className="eyebrow">Review configuration</p>
          <h1>{existing ? "Edit QA Review" : "Create a QA Review"}</h1>
          <p>{published ? "Update review details or allocate more faculties and teams. Existing responses and published questions are retained." : "Set up the review, save a draft, then publish when it is ready for evidence."}</p>
        </div>
      </section>
      {message ? <div className="api-error-banner" role="alert"><AlertTriangle size={16}  aria-hidden="true"/>{message}</div> : null}
      {questionError ? <div className="api-error-banner" role="alert">{questionError}<Button onClick={() => setQuestionAttempt(value => value + 1)}>Try again</Button></div> : null}
      {published ? <div className="notice-row">This review is {existing!.review.status}. You can extend its allocation; existing teams, activities and questions stay in place so evidence and reporting remain consistent.</div> : null}
      <div className="qa-builder-layout">
        <div className="route-stack">
          <section className="panel qa-builder-section">
            <div className="qa-builder-step-heading">
              <span className="qa-step-number">1</span>
              <div><h2>Review details</h2><p>Name the review, choose its question set and confirm the review window.</p></div>
              <CalendarRange size={20} aria-hidden="true" />
            </div>
            <div className="form-grid qa-form-grid">
              <label className="field-wide"><span>Review title <strong>Required</strong></span><input maxLength={300} onChange={(event) => update("title", event.target.value)} placeholder="For example, Autumn curriculum quality review" required value={form.title} /></label>
              <label><span>Academic year <strong>Required</strong></span><select disabled={published} onChange={(event) => update("academicYear", event.target.value)} value={form.academicYear}>{!academicYears.some((year) => year.academicYear === form.academicYear) ? <option>{form.academicYear}</option> : null}{academicYears.map((year) => <option key={year.academicYear}>{year.academicYear}</option>)}</select></label>
              <label><span>Review owner <strong>Required</strong></span><select onChange={(event) => update("ownerStaffId", event.target.value)} value={form.ownerStaffId}>{staff.map((person) => <option key={person.id} value={person.id}>{person.displayName}</option>)}</select></label>
              <label className="field-wide"><span>Theme <strong>Required</strong></span><input onChange={(event) => update("theme", event.target.value)} placeholder="What is the review focused on?" required value={form.theme} /></label>
              {published ? <div className="field-wide"><strong>Published question sets</strong><p>{selectedQuestionSets.map(formatQuestionTag).join(" + ")}</p></div> : <fieldset className="field-wide qa-question-set-fieldset">
                <legend>Question sets <strong>Required</strong></legend>
                <p>Choose at least one question set for this review. General can be unchecked when it is not needed.</p>
                <div className="qa-question-set-options">
                  {questionSets.map((questionSet) => {
                    const selected = selectedQuestionSets.includes(questionSet);
                    return <label className={selected ? "qa-question-set-option is-selected" : "qa-question-set-option"} key={questionSet}><input checked={selected} onChange={() => toggleQuestionSet(questionSet)} type="checkbox" /><span><strong>{questionSetLabels.get(questionSet) ?? formatQuestionTag(questionSet)}</strong><small>{selected ? "Included in this review" : "Not selected"}</small></span></label>;
                  })}
                </div>
                <small>{selectedQuestionSets.length ? "One question set is enough. Select additional sets only if needed." : "Select at least one question set before saving the review."}</small>
              </fieldset>}
              <label><span>Planned opening</span><input disabled={published} onChange={(event) => update("plannedOpenDate", event.target.value || undefined)} type="date" value={form.plannedOpenDate ?? ""} /></label>
              <label><span>Closing date <strong>Required</strong></span><input onChange={(event) => update("closingDate", event.target.value)} required type="date" value={form.closingDate} /></label>
            </div>
            {form.plannedOpenDate && form.closingDate && form.plannedOpenDate > form.closingDate ? <p className="api-error-banner" role="alert">The closing date must be on or after the planned opening date.</p> : null}
          </section>

          <section className="panel qa-builder-section">
            <div className="qa-builder-step-heading">
              <span className="qa-step-number">2</span>
              <div><h2>Faculty and team scope</h2><p>Select a faculty to include all its current teams, then uncheck any that are not relevant.</p></div>
              <Building2 size={20} aria-hidden="true" />
            </div>
            <label className="entry-field"><span>Find a faculty or team</span><input type="search" value={scopeSearch} onChange={event => setScopeSearch(event.target.value)} /></label>
            <div className="qa-faculty-grid">
              {faculties.filter(faculty => matchesListSearch(scopeSearch, faculty.name, faculty.code, activeTeams.filter(team => team.parentOrgUnitId === faculty.id).map(team => [team.name, team.code]))).map((faculty) => {
                const selected = selectedFacultyIds.includes(faculty.id);
                const teamCount = activeTeams.filter((team) => team.parentOrgUnitId === faculty.id).length;
                return (
                  <button disabled={published && activeTeams.some((team) => team.parentOrgUnitId === faculty.id && existingTeamIds.includes(team.id))} aria-pressed={selected} className={selected ? "qa-scope-card is-selected" : "qa-scope-card"} key={faculty.id} onClick={() => toggleFaculty(faculty.id)} type="button">
                    <span className="qa-select-indicator">{selected ? <Check size={15} aria-hidden="true" /> : <Building2 size={15} aria-hidden="true" />}</span>
                    <span><strong>{faculty.name}</strong><small>{activeTeams.filter((team) => team.parentOrgUnitId === faculty.id && form.teamOrgUnitIds.includes(team.id)).length} of {teamCount} teams selected</small></span>
                  </button>
                );
              })}
            </div>
            {selectedFacultyIds.length === 0 ? (
              <div className="qa-scope-empty"><MapPin size={20} aria-hidden="true" /><div><strong>Select one or more faculties</strong><span>Team choices will appear here without showing unrelated areas.</span></div></div>
            ) : (
              <div className="qa-team-groups">
                {selectedFacultyIds.map((facultyId) => {
                  const faculty = faculties.find((item) => item.id === facultyId);
                  const facultyTeams = activeTeams.filter((team) => team.parentOrgUnitId === facultyId);
                  const selectedCount = facultyTeams.filter((team) => form.teamOrgUnitIds.includes(team.id)).length;
                  const allSelected = facultyTeams.length > 0 && selectedCount === facultyTeams.length;
                  return (
                    <article className="qa-team-group" key={facultyId}>
                      <header><div><strong>{faculty?.name}</strong><span>{selectedCount} of {facultyTeams.length} teams selected</span></div><Button onClick={() => setAllFacultyTeams(facultyId, !allSelected)} variant="quiet">{allSelected ? published ? "Clear new selections" : "Clear teams" : "Select all teams"}</Button></header>
                      <div className="qa-team-list">
                        {facultyTeams.filter(team => matchesListSearch(scopeSearch, team.name, team.code, faculty?.name, faculty?.code)).map((team) => <label key={team.id}><input disabled={published && existingTeamIds.includes(team.id)} checked={form.teamOrgUnitIds.includes(team.id)} onChange={() => toggleTeam(team.id)} type="checkbox" /><span><strong>{team.name}</strong><small>{team.code}{published && existingTeamIds.includes(team.id) ? " · Already allocated" : ""}</small></span></label>)}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
            {published ? <details className="qa-retained-scope"><summary>{existingTeamIds.length} existing team allocations retained</summary><ul>{existing!.scope.filter((scope) => scope.scopeType === "team").map((scope) => <li key={scope.orgUnitId}>{scope.parentName} · {scope.name}</li>)}</ul></details> : null}
          </section>

          {published ? <section className="panel qa-builder-section"><h2>Published activities and questions</h2><p>These questions remain unchanged for every team, including new allocations.</p>{existing!.activities.map((activity) => <details className="qa-retained-scope" key={activity.id}><summary>{activity.name} · {activity.questions.length} criteria</summary><ol>{activity.questions.map((question) => <li key={question.id}>{question.questionText}</li>)}</ol></details>)}</section> : <section className="panel qa-builder-section">
            <div className="qa-builder-step-heading">
              <span className="qa-step-number">3</span>
              <div><h2>Review activities</h2><p>Select the evidence activities to include. Questions are snapshotted when the review opens.</p></div>
              <ClipboardCheck size={20} aria-hidden="true" />
            </div>
            <div className="qa-activity-grid qa-builder-activity-grid">{activities.filter((activity) => activity.isActive).map((activity) => {
              const selected = form.activities.find((item) => item.activityTypeId === activity.id);
              return <button aria-pressed={Boolean(selected)} className={selected ? "qa-activity-option is-selected" : "qa-activity-option"} disabled={!questionsLoaded} key={activity.id} onClick={() => toggleActivity(activity)} type="button"><span className="qa-select-indicator">{selected ? <Check size={15} aria-hidden="true" /> : <ListChecks size={15} aria-hidden="true" />}</span><span><strong>{activity.name}</strong><small>{selected ? `${selected.questionIds.length} criteria selected` : activity.description}</small></span></button>;
            })}</div>
            {!questionsLoaded ? <LoadingState label="Loading activity criteria" /> : null}
<div className="filter-toolbar"><label className="entry-field"><span>Find a review criterion</span><input type="search" value={setupSearch} onChange={event => setSetupSearch(event.target.value)} placeholder="Question, guidance, theme or activity" /></label><AdminListSort value={setupSort} onChange={setSetupSort} options={[["configured","Configured question order"],["question-asc","Question: A–Z"],["question-desc","Question: Z–A"]]} /></div>
            <div className="qa-selected-activity-config">{form.activities.map((selected) => {
              const activity = activities.find((item) => item.id === selected.activityTypeId);
              const activityQuestions = taggedQuestions(selected.activityTypeId);
              const allSelected = activityQuestions.length > 0 && activityQuestions.every((question) => selected.questionIds.includes(question.id));
              return (
                <details key={selected.activityTypeId} open>
                  <summary><span>{activity?.name}</span><small>{selected.questionIds.length} of {activityQuestions.length} criteria selected</small></summary>
                  <label><span>Question template</span><select onChange={(event) => update("activities", form.activities.map((item) => item.activityTypeId === selected.activityTypeId ? { ...item, templateId: event.target.value } : item))} value={selected.templateId}>{activity?.templates.filter((template) => template.isActive).map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
                  <div className="qa-activity-question-toolbar"><div><strong>Questions included</strong><span>Uncheck any criteria that are not needed for this activity.</span></div><Button disabled={activityQuestions.length === 0} onClick={() => setAllActivityQuestions(selected.activityTypeId, !allSelected)} variant="quiet">{allSelected ? "Clear all" : "Select all"}</Button></div>
                  {activityQuestions.length === 0 ? <p className="empty-state">No active questions match this question set.</p> : (
                    <div className="qa-question-select-list">{sortListRows(activityQuestions.filter(question => matchesListSearch(setupSearch, question.questionText, question.guidance, question.themeOrWeek, question.questionTag, activity?.name)), question => setupSort === "configured" ? question.displayOrder : question.questionText, setupSort.endsWith("desc") ? "desc" : "asc", question => question.id).map((question) => (
                      <label className="qa-question-choice" key={question.id}>
                        <input checked={selected.questionIds.includes(question.id)} onChange={() => toggleActivityQuestion(selected.activityTypeId, question.id)} type="checkbox" />
                        <span><span className="qa-question-choice-heading"><span className="qa-question-tag">{questionSetKeys(question).map((questionSet) => questionSetLabels.get(questionSet) ?? formatQuestionTag(questionSet)).join(" / ")}</span><strong>{question.questionText}</strong></span>{question.guidance ? <small>{question.guidance}</small> : null}</span>
                      </label>
                    ))}</div>
                  )}
                </details>
              );
            })}</div>
          </section>}
        </div>

        <aside className="panel qa-builder-summary">
          <div><p className="eyebrow">Review setup</p><h2>{form.title.trim() || "Untitled review"}</h2><p>{form.theme.trim() || "Add a theme to describe the review focus."}</p></div>
          <dl>
            <div><dt>Faculties</dt><dd>{selectedFacultyIds.length}</dd></div>
            <div><dt>Teams</dt><dd>{form.teamOrgUnitIds.length}</dd></div>
            {published ? <div><dt>New allocations</dt><dd>{form.teamOrgUnitIds.filter((id) => !existingTeamIds.includes(id)).length}</dd></div> : null}
            <div><dt>Activities</dt><dd>{form.activities.length}</dd></div>
            <div><dt>Criteria</dt><dd>{form.activities.reduce((total, activity) => total + activity.questionIds.length, 0)}</dd></div>
            <div><dt>Question sets</dt><dd className="qa-summary-tag">{selectedQuestionSets.length ? selectedQuestionSets.map((questionSet) => questionSetLabels.get(questionSet) ?? formatQuestionTag(questionSet)).join(" + ") : "None selected"}</dd></div>
          </dl>
          <div className="qa-permission-note"><ShieldCheck size={18} aria-hidden="true" /><p><strong>Permission-driven access</strong><span>Admin, Teaching &amp; Learning, Directors and QA Staff have college-wide QA access. Other leaders see reviews within their organisation scope.</span></p></div>
          <div className="qa-builder-actions"><Button disabled={saving} onClick={onCancel}>Cancel</Button><Button disabled={saving || !setupReady || Boolean(existing && !dirty)} onClick={() => void save()} variant="primary">{saving ? "Saving…" : existing ? "Save changes" : "Save draft"}</Button></div>
          {!setupReady ? <small className="muted-copy">Complete the required details, choose at least one team and add an activity with criteria.</small> : null}
        </aside>
      </div>
    </div>
  );
}

function QaReportMenu({ reviewId, facultyOrgUnitId, teamOrgUnitId }: { reviewId: string; facultyOrgUnitId?: string; teamOrgUnitId?: string }) {
  return <ReportButton scopeKey={JSON.stringify([reviewId, facultyOrgUnitId, teamOrgUnitId])}
    downloadReport={format => api.exportQaReview(reviewId, format, facultyOrgUnitId, teamOrgUnitId)}
    triggerLabel="Report" pdfLabel="PDF report" pdfDescription="Dashboard view with every criterion expanded"
    excelLabel="Excel report" excelDescription="Submitted form fields, criteria, findings and actions"
    hint={facultyOrgUnitId || teamOrgUnitId ? "Uses the current dashboard filters." : "Includes submitted evidence in this review."} />;
}

function QaReviewWorkspace({
  id, section, user, orgUnits, staff, academicYears, activities, onNavigate, onRefreshSummary
}: Omit<QaHubProps, "onReturnToElevate"> & { id: string; section: "configuration" | "evidence" | "dashboard" | "actions"; activities: QaActivityTypeSummary[]; onNavigate: (path: string) => void; onRefreshSummary: () => Promise<void> }) {
  const [detail, setDetail] = useState<QaReviewDetail | null>(null);
  const [loadedDashboard, setLoadedDashboard] = useState<{ scope: string; value: QaDashboardSummary } | null>(null);
  const [dashboardFacultyId, setDashboardFacultyId] = useState("");
  const [dashboardTeamId, setDashboardTeamId] = useState("");
  const dashboardRequestScope = JSON.stringify([id, section, dashboardFacultyId, dashboardTeamId]);
  const activeDashboardScope = useRef(dashboardRequestScope);
  activeDashboardScope.current = dashboardRequestScope;
  const dashboard = loadedDashboard?.scope === dashboardRequestScope ? loadedDashboard.value : null;
  const [dashboardView, setDashboardView] = useState<"summary" | "data">("summary");
  const [actionGroups, setActionGroups] = useState<QaActionGroupSummary[]>([]);
  const [actionOptions, setActionOptions] = useState<QaReviewActionOptions | null>(null);
  const [newEvidenceActivityId, setNewEvidenceActivityId] = useState<string | null>(null);
  const [evidenceQuery, setEvidenceQuery] = useState("");
  const [evidenceActivity, setEvidenceActivity] = useState("");
  const [evidenceTeam, setEvidenceTeam] = useState("");
  const [evidenceReviewer, setEvidenceReviewer] = useState("");
  const [evidenceSort, setEvidenceSort] = useState("date-desc");
  const [message, setMessage] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [transitionAction, setTransitionAction] = useState<"open" | "close" | "reopen" | "archive" | null>(null);
  const [transitionReason, setTransitionReason] = useState("");
  const [transitionBusy, setTransitionBusy] = useState(false);
  useQaNavigationGuard(Boolean(transitionReason), transitionBusy);
  const loadSequence = useRef(0);
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setMessage("");
    setLoadedDashboard(null);
    try {
      const review = await api.qaReview(id);
      if (sequence !== loadSequence.current || activeDashboardScope.current !== dashboardRequestScope) return;
      setDetail(review);
      if (section === "dashboard") {
        const next = await api.qaDashboard(id, dashboardFacultyId || undefined, dashboardTeamId || undefined);
        if (sequence === loadSequence.current && activeDashboardScope.current === dashboardRequestScope) setLoadedDashboard({ scope: dashboardRequestScope, value: next });
      }
      if (section === "actions") {
        const [groups, options] = await Promise.all([api.qaReviewActions(id), review.review.capabilities.canManageActions ? api.qaReviewActionOptions(id) : Promise.resolve(null)]);
        if (sequence === loadSequence.current && activeDashboardScope.current === dashboardRequestScope) { setActionGroups(groups); setActionOptions(options); }
      }
    } catch { if (sequence === loadSequence.current && activeDashboardScope.current === dashboardRequestScope) setMessage("This QA Review could not be loaded. Check your connection and review access, then retry."); }
  }, [dashboardFacultyId, dashboardTeamId, id, section]);
  useEffect(() => { void load(); return () => { ++loadSequence.current; }; }, [load]);
  if (message) return <section className="access-denied-panel"><AlertTriangle size={22}  aria-hidden="true"/><div><h1>Review unavailable</h1><p>{message}</p></div><Button onClick={() => void load()} variant="primary">Retry</Button><Button onClick={() => onNavigate("/qa-hub")}>All reviews</Button></section>;
  if (!detail) return <LoadingState label="Loading review" size="page" />;
  if (section === "actions" && !detail.review.capabilities.canManageActions) return <section className="access-denied-panel"><AlertTriangle size={22}  aria-hidden="true"/><div><h1>Review actions unavailable</h1><p>This review tab is restricted to Administrators and the review owner. Your scoped actions remain available in Action monitoring.</p></div><Button onClick={() => onNavigate(`/qa-hub/reviews/${id}/dashboard`)} variant="primary">Open dashboard</Button></section>;
  if (section === "configuration" && detail.review.capabilities.canConfigure) return (
    <QaReviewEditor academicYears={academicYears} activities={activities} existing={detail} onCancel={() => onNavigate(`/qa-hub/reviews/${id}/evidence`)} onSaved={(_id, navigateAfterSave = true) => { void onRefreshSummary(); if (navigateAfterSave) onNavigate(`/qa-hub/reviews/${id}/evidence`); }} orgUnits={orgUnits} staff={staff} user={user} />
  );
  const review = detail.review;
  const visibleEvidence = sortListRows(detail.evidence.filter(item => (!evidenceActivity || item.activityName === evidenceActivity)
    && (!evidenceTeam || item.teamName === evidenceTeam) && (!evidenceReviewer || item.reviewerName === evidenceReviewer)
    && matchesListSearch(evidenceQuery, item.activityName, item.teamName, item.deliveryAreaName, item.reviewerName, item.activityAt, item.status)),
    item => evidenceSort.startsWith("reviewer") ? item.reviewerName : evidenceSort.startsWith("team") ? item.teamName : evidenceSort.startsWith("activity") ? item.activityName : Date.parse(item.activityAt), evidenceSort.endsWith("desc") ? "desc" : "asc", item => item.id);
  const draftEvidence = visibleEvidence.filter((item) => item.status === "draft");
  const submittedEvidence = visibleEvidence.filter((item) => item.status === "submitted");
  const dashboardOrgUnits = new Map(orgUnits.map((unit) => [unit.id, unit]));
  const includedDashboardOrgIds = dashboardVisibleUnitIds(orgUnits);
  const dashboardScope = detail.scope.filter((scope) => scope.scopeType === "team"
    && (!dashboardOrgUnits.has(scope.orgUnitId) || includedDashboardOrgIds.has(scope.orgUnitId))
    && (!scope.parentOrgUnitId || !dashboardOrgUnits.has(scope.parentOrgUnitId) || includedDashboardOrgIds.has(scope.parentOrgUnitId)));
  const dashboardFaculties = Array.from(new Map(dashboardScope.map((team) => [team.parentOrgUnitId!, { id: team.parentOrgUnitId!, name: team.parentName ?? "Faculty" }])).values());
  const dashboardTeams = dashboardScope.filter((scope) => !dashboardFacultyId || scope.parentOrgUnitId === dashboardFacultyId);
  async function transition(action: "open" | "close" | "reopen" | "archive") {
    if (transitionBusy || action !== "open" && !transitionReason.trim()) return;
    setTransitionBusy(true); setActionMessage("");
    const result = await api.transitionQaReview(id, action, action === "open" ? undefined : transitionReason.trim(), review.rowVersion);
    setTransitionBusy(false);
    if (!result.ok) { setActionMessage(result.message ?? "The review could not be updated."); return; }
    setTransitionAction(null); setTransitionReason("");
    setDetail(result.data!); void onRefreshSummary();
    setActionMessage(action === "open" ? "Review published and open for evidence." : `Review ${action === "close" ? "closed" : action === "reopen" ? "reopened" : "archived"}.`);
  }
  return (
    <>
      <section className="route-header qa-review-heading">
        <div><Button icon={ArrowLeft} onClick={() => onNavigate("/qa-hub/reviews")} variant="quiet">All reviews</Button><p className="eyebrow">{review.academicYear} · {review.theme}</p><h1>{review.title}</h1><div className="qa-review-context"><span className={`status-pill status-${review.status}`}>{qaStatusLabel(review.status)}</span><span>Closing date: {new Date(`${review.closingDate}T00:00:00`).toLocaleDateString("en-GB")}</span><span>{qaCount(review.teamCount, "team")} · {qaCount(review.activityCount, "activity", "activities")}</span></div></div>
        <div className="toolbar">
          {review.capabilities.canExport ? <QaReportMenu facultyOrgUnitId={dashboardFacultyId || undefined} reviewId={id} teamOrgUnitId={dashboardTeamId || undefined} /> : null}
          {review.capabilities.canConfigure ? <Button onClick={() => onNavigate(`/qa-hub/reviews/${id}/configuration`)}>{review.status === "draft" ? "Edit setup" : "Edit details & allocation"}</Button> : null}
          {review.status === "draft" && review.capabilities.canConfigure ? <Button disabled={transitionBusy} icon={FileCheck2} onClick={() => { setTransitionAction("open"); setActionMessage(""); }} variant="primary">Publish review</Button> : null}
          {review.capabilities.canClose ? <Button disabled={transitionBusy} icon={Check} onClick={() => { setTransitionAction("close"); setActionMessage(""); }} variant="primary">Close review</Button> : null}
          {review.capabilities.canReopen ? <Button disabled={transitionBusy} icon={RotateCcw} onClick={() => { setTransitionAction("reopen"); setActionMessage(""); }} variant="primary">Reopen review</Button> : null}
          {review.capabilities.canArchive ? <Button disabled={transitionBusy} icon={Archive} onClick={() => { setTransitionAction("archive"); setActionMessage(""); }} variant="danger">Archive</Button> : null}
        </div>
      </section>
      {actionMessage ? <div className="notice-row" role="status">{actionMessage}<Button disabled={transitionBusy} onClick={() => void load()} variant="quiet">Refresh review</Button></div> : null}
      {transitionAction ? <section className="panel qa-lifecycle-panel" aria-label="Review status change"><h2>{transitionAction === "open" ? "Publish and open this review" : `${qaStatusLabel(transitionAction)} this review`}</h2><p><strong>{review.title}</strong> · {qaCount(review.teamCount, "team")} · {qaCount(review.activityCount, "activity", "activities")}</p><p>{transitionAction === "open" ? "Publishing fixes the questions and opens this review for evidence. Other open reviews will remain open." : transitionAction === "close" ? "Closing stops new evidence. Review the coverage below and record a closure note. You can reopen this review later." : transitionAction === "reopen" ? "Reopen to collect more evidence or add faculties and teams. Existing questions and submissions are retained." : "Archive removes the review from current review lists and retains its history."}</p>
        {transitionAction === "close" && detail.closeValidation ? <div className="qa-close-coverage"><p>{detail.closeValidation.evidenceCount} submissions · {detail.closeValidation.draftSubmissionCount} drafts · {detail.closeValidation.missingRequiredResponseCount} missing required responses</p><p>{qaCount(detail.closeValidation.teamsWithoutEvidence.length, "team")} and {qaCount(detail.closeValidation.activitiesWithoutEvidence.length, "activity", "activities")} without evidence.</p>{detail.closeValidation.teamsWithoutEvidence.length || detail.closeValidation.activitiesWithoutEvidence.length ? <details><summary>View coverage gaps</summary><ul>{detail.closeValidation.teamsWithoutEvidence.map((name) => <li key={`team-${name}`}>Team: {name}</li>)}{detail.closeValidation.activitiesWithoutEvidence.map((name) => <li key={`activity-${name}`}>Activity: {name}</li>)}</ul></details> : null}</div> : null}
        {transitionAction !== "open" ? <label className="entry-field"><span>{transitionAction === "close" ? "Closure note" : "Reason"} <strong>Required</strong></span><textarea disabled={transitionBusy} rows={3} value={transitionReason} onChange={(event) => setTransitionReason(event.target.value)} /></label> : null}<div className="toolbar"><Button disabled={transitionBusy} onClick={() => { setTransitionAction(null); setTransitionReason(""); }}>Cancel</Button><Button disabled={transitionBusy || transitionAction !== "open" && !transitionReason.trim()} onClick={() => void transition(transitionAction)} variant={transitionAction === "archive" ? "danger" : "primary"}>{transitionBusy ? "Updating…" : transitionAction === "open" ? "Publish and open" : `Confirm ${transitionAction}`}</Button></div></section> : null}
      {review.status === "draft" ? <div className="notice-row">Draft review: check the setup, then publish it to begin collecting evidence.</div> : review.status === "closed" ? <div className="notice-row">This review is closed. Its evidence and findings remain available.{review.capabilities.canReopen ? " Reopen it to collect more evidence or extend its allocation." : ""}</div> : null}
      <nav aria-label="QA Review sections" className="segmented-control qa-review-tabs">
        {(["evidence", "dashboard", ...(review.capabilities.canManageActions ? ["actions" as const] : [])] as const).map((tab) => <button aria-pressed={section === tab} className={section === tab ? "is-active" : ""} key={tab} onClick={() => onNavigate(`/qa-hub/reviews/${id}/${tab}`)} type="button">{tab === "evidence" ? "Evidence" : tab[0].toUpperCase() + tab.slice(1)}</button>)}
      </nav>
      {section === "evidence" ? (
        newEvidenceActivityId ? <QaNewEvidence activityId={newEvidenceActivityId} detail={detail} onCancel={() => setNewEvidenceActivityId(null)} onCreated={(evidenceId) => onNavigate(`/qa-hub/evidence/${evidenceId}`)} /> : (
          <div className="route-stack">
            <section className="qa-evidence-launcher"><div className="section-heading"><div><p className="eyebrow">Evidence activities</p><h2>{review.capabilities.canSubmitEvidence ? "Add evidence" : "Review evidence"}</h2><p>{review.capabilities.canSubmitEvidence ? "Choose an activity, then select the faculty and team you reviewed." : "Open an existing submission below to view its responses."}</p></div></div>
              <div className="qa-evidence-tile-grid">{detail.activities.map((activity) => {
                const Icon = qaActivityIcons[activity.activityKey] ?? ClipboardCheck;
                const activityEvidence = detail.evidence.filter((item) => item.reviewActivityId === activity.id);
                const draftCount = activityEvidence.filter((item) => item.status === "draft").length;
                const submittedCount = activityEvidence.filter((item) => item.status === "submitted").length;
                const accessRestricted = review.capabilities.canSubmitEvidence && activity.canSubmitEvidence === false;
                return <button className="qa-evidence-tile" disabled={!review.capabilities.canSubmitEvidence || accessRestricted} key={activity.id} onClick={() => setNewEvidenceActivityId(activity.id)} type="button"><span className="qa-evidence-tile-icon"><Icon size={26} aria-hidden="true" /></span><span className="qa-evidence-tile-copy"><strong>{activity.name}</strong><small>{activity.questions.length} criteria</small></span><span className="qa-evidence-tile-stats"><span>{qaCount(submittedCount, "submission")}</span>{accessRestricted ? <span>Access restricted</span> : draftCount ? <span>{draftCount} draft{draftCount === 1 ? "" : "s"}</span> : <span>{review.capabilities.canSubmitEvidence ? "Start form" : "View submissions below"}</span>}</span></button>;
              })}</div>
            </section>
            <section className="panel filter-toolbar" aria-label="Evidence filters"><label className="entry-field"><span>Find evidence</span><input type="search" value={evidenceQuery} onChange={event => setEvidenceQuery(event.target.value)} placeholder="Activity, team, reviewer or delivery area" /></label><label className="entry-field"><span>Activity</span><select value={evidenceActivity} onChange={event => setEvidenceActivity(event.target.value)}><option value="">All activities</option>{distinctListValues(detail.evidence.map(item => item.activityName)).map(value => <option key={value}>{value}</option>)}</select></label><label className="entry-field"><span>Team</span><select value={evidenceTeam} onChange={event => setEvidenceTeam(event.target.value)}><option value="">All teams</option>{distinctListValues(detail.evidence.map(item => item.teamName)).map(value => <option key={value}>{value}</option>)}</select></label><label className="entry-field"><span>Reviewer</span><select value={evidenceReviewer} onChange={event => setEvidenceReviewer(event.target.value)}><option value="">All reviewers</option>{distinctListValues(detail.evidence.map(item => item.reviewerName)).map(value => <option key={value}>{value}</option>)}</select></label><AdminListSort value={evidenceSort} onChange={setEvidenceSort} options={[["date-desc","Activity date: newest first"],["date-asc","Activity date: oldest first"],["reviewer-asc","Reviewer: A–Z"],["team-asc","Team: A–Z"],["activity-asc","Activity: A–Z"]]} /><span>{visibleEvidence.length} of {detail.evidence.length} evidence forms</span></section>
            <CollapsibleSection count={draftEvidence.length} defaultExpanded={false} emptyMessage="No drafts are saved for this review." isEmpty={draftEvidence.length === 0} statusSummary="Saved work in progress · excluded from dashboard data and reports" storageKey={`qa-review-${id}-drafts`} title="Drafts">
              <ScrollableTableRegion label="QA evidence"><table aria-label="QA evidence"><thead><tr><th scope="col">Activity</th><th scope="col">Team</th><th scope="col">Delivery area</th><th scope="col">Reviewer</th><th scope="col">Date</th><th scope="col">Status</th><th scope="col">Responses</th></tr></thead><tbody>{draftEvidence.map((item) => <tr key={item.id} onClick={() => onNavigate(`/qa-hub/evidence/${item.id}`)}><td><button className="link-button" type="button">{item.activityName}</button></td><td>{item.teamName}</td><td>{item.deliveryAreaName ?? "Not selected"}</td><td>{item.reviewerName}</td><td>{new Date(item.activityAt).toLocaleDateString()}</td><td><span className="status-pill status-draft">Draft</span></td><td>{item.responseCount}</td></tr>)}</tbody></table></ScrollableTableRegion>
            </CollapsibleSection>
            <CollapsibleSection count={submittedEvidence.length} defaultExpanded={!review.capabilities.canSubmitEvidence} emptyMessage="No evidence has been submitted for this review." isEmpty={submittedEvidence.length === 0} statusSummary="Submitted evidence included in dashboard data and reports" storageKey={`qa-review-${id}-recent-submissions`} title="Recent submissions">
              <ScrollableTableRegion label="QA evidence"><table aria-label="QA evidence"><thead><tr><th scope="col">Activity</th><th scope="col">Team</th><th scope="col">Delivery area</th><th scope="col">Reviewer</th><th scope="col">Date</th><th scope="col">Status</th><th scope="col">Responses</th></tr></thead><tbody>{submittedEvidence.map((item) => <tr key={item.id} onClick={() => onNavigate(`/qa-hub/evidence/${item.id}`)}><td><button className="link-button" type="button">{item.activityName}</button></td><td>{item.teamName}</td><td>{item.deliveryAreaName ?? "Not recorded"}</td><td>{item.reviewerName}</td><td>{new Date(item.activityAt).toLocaleDateString()}</td><td><span className="status-pill status-submitted">Submitted</span></td><td>{item.responseCount}</td></tr>)}</tbody></table></ScrollableTableRegion>
            </CollapsibleSection>
          </div>
        )
      ) : null}
      {section === "dashboard" ? (
        <div className="route-stack">
          <section className="panel qa-dashboard-filters">
            <div><p className="eyebrow">Dashboard scope</p><h2>Filter findings</h2><p>View the whole review or narrow the evidence to one faculty or team.</p></div>
            <div className="qa-dashboard-filter-fields">
              <label><span>Faculty</span><select onChange={(event) => { setDashboardFacultyId(event.target.value); setDashboardTeamId(""); }} value={dashboardFacultyId}><option value="">All faculties</option>{dashboardFaculties.map((faculty) => <option key={faculty.id} value={faculty.id}>{faculty.name}</option>)}</select></label>
              <label><span>Team</span><select onChange={(event) => setDashboardTeamId(event.target.value)} value={dashboardTeamId}><option value="">All teams</option>{dashboardTeams.map((team) => <option key={team.orgUnitId} value={team.orgUnitId}>{team.name}</option>)}</select></label>
            </div>
          </section>
          {review.capabilities.canExport ? <nav className="dashboard-section-tabs" aria-label="QA dashboard content"><button type="button" className={dashboardView === "summary" ? "is-active" : ""} aria-pressed={dashboardView === "summary"} onClick={() => setDashboardView("summary")}>Summary</button><button type="button" className={dashboardView === "data" ? "is-active" : ""} aria-pressed={dashboardView === "data"} onClick={() => setDashboardView("data")}>Form data</button></nav> : null}
          {dashboardView === "data" && review.capabilities.canExport ? <QaDashboardDataExplorer reviewId={id} academicYear={review.academicYear} facultyOrgUnitId={dashboardFacultyId || undefined} teamOrgUnitId={dashboardTeamId || undefined} onOpenEvidence={evidenceId => onNavigate(`/qa-hub/evidence/${evidenceId}`)} /> : dashboard ? <QaDashboard dashboard={dashboard} /> : <LoadingState label="Loading dashboard" />}
        </div>
      ) : null}
      {section === "actions" ? <QaReviewActions actionGroups={actionGroups} actionOptions={actionOptions} canCreate={review.capabilities.canManageActions} onChanged={load} reviewId={id} /> : null}
    </>
  );
}

function QaReviewActions({
  reviewId, actionGroups, actionOptions, canCreate, onChanged
}: {
  reviewId: string;
  actionGroups: QaActionGroupSummary[];
  actionOptions: QaReviewActionOptions | null;
  canCreate: boolean;
  onChanged: () => Promise<void>;
}) {
  const [message, setMessage] = useState("");
  async function review(group: QaActionGroupSummary) {
    const result = await api.reviewQaActionGroup(group.id, group.rowVersion);
    if (!result.ok) { setMessage(result.message ?? "The QA action could not be reviewed."); return; }
    await onChanged();
  }
  async function close(group: QaActionGroupSummary) {
    const result = await api.closeQaActionGroup(group.id, group.rowVersion);
    if (!result.ok) { setMessage(result.message ?? "The QA action could not be closed."); return; }
    await onChanged();
  }
  return (
    <div className="route-stack">
      <section className="route-header qa-action-heading"><div><p className="eyebrow">Post-review improvement</p><h2>Review actions</h2><p>Actions are assigned to the Head of Faculty and to Programme Leaders for the selected teams. Each assignment also appears on that person&apos;s staff profile.</p></div></section>
      {message ? <div className="api-error-banner" role="alert"><AlertTriangle size={16}  aria-hidden="true"/>{message}</div> : null}
      {canCreate && actionOptions ? <QaActionCreator onCreated={onChanged} options={actionOptions} reviewId={reviewId} /> : null}
      <QaActionGroupCards groups={actionGroups} onClose={close} onReview={review} />
    </div>
  );
}

function QaActionCreator({ reviewId, options, onCreated }: { reviewId: string; options: QaReviewActionOptions; onCreated: () => Promise<void> }) {
  const [facultyId, setFacultyId] = useState(options.faculties[0]?.facultyOrgUnitId ?? "");
  const faculty = options.faculties.find((item) => item.facultyOrgUnitId === facultyId) ?? options.faculties[0];
  const [teamIds, setTeamIds] = useState<string[]>(() => faculty?.teams.map((team) => team.teamOrgUnitId) ?? []);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [wholeReview, setWholeReview] = useState(false);
  const initialScope = useRef({ facultyId, teamIds });
  const dirty = Boolean(title || detail || dueDate || wholeReview || facultyId !== initialScope.current.facultyId || JSON.stringify(teamIds) !== JSON.stringify(initialScope.current.teamIds));
  const clearGuard = useUnsavedChanges({ label: "QA action", dirty, saving, onSave: create, onDiscard: () => {
    setTitle(""); setDetail(""); setDueDate(""); setWholeReview(false);
    setFacultyId(initialScope.current.facultyId); setTeamIds(initialScope.current.teamIds);
  } });
  function selectFaculty(nextFacultyId: string) {
    const nextFaculty = options.faculties.find((item) => item.facultyOrgUnitId === nextFacultyId);
    setFacultyId(nextFacultyId);
    setTeamIds(nextFaculty?.teams.map((team) => team.teamOrgUnitId) ?? []);
  }
  function toggleTeam(teamId: string) {
    setTeamIds((current) => current.includes(teamId) ? current.filter((id) => id !== teamId) : [...current, teamId]);
  }
  async function create() {
    if (saving || !faculty || (!wholeReview && !faculty.headOfFaculty) || !teamIds.length || !title.trim() || !dueDate) return false;
    setSaving(true);
    setMessage("");
    try {
      const result = await api.createQaReviewAction(reviewId, {
      facultyOrgUnitId: wholeReview ? undefined : faculty.facultyOrgUnitId,
      teamOrgUnitIds: wholeReview ? options.faculties.flatMap((item) => item.teams.map((team) => team.teamOrgUnitId)) : teamIds,
      title: title.trim(),
      detail: detail.trim() || undefined,
      dueDate,
      wholeReview
      });
      if (!result.ok) { setMessage(result.message ?? "The QA action could not be created."); return false; }
      initialScope.current = { facultyId, teamIds };
      setTitle(""); setDetail(""); setDueDate(""); setWholeReview(false); clearGuard();
      try { await onCreated(); }
      catch { setMessage("The action was created. Reload the action list to see the latest entries."); }
      return true;
    } catch { setMessage("The QA action could not be created. Your changes are still here; try again."); return false; }
    finally { setSaving(false); }
  }
  if (!faculty) return <section className="panel"><p className="empty-state">No review faculties are available for actions.</p></section>;
  const selectedFaculties = wholeReview ? options.faculties : [faculty];
  const selectedPls = new Map(selectedFaculties.flatMap((item) => item.teams.filter((team) => wholeReview || teamIds.includes(team.teamOrgUnitId)).filter((team) => team.programmeLeader).map((team) => [team.programmeLeader!.staffId, team.programmeLeader!.displayName] as const)));
  const isPl = options.creationMode === "pl";
  return (
    <section className="panel qa-action-creator">
      <div className="section-heading"><div><p className="eyebrow">New action · {options.reviewTitle}</p><h2>{isPl ? "Add a team action" : "Assign a review action"}</h2><p>{isPl ? "Your programme team is applied automatically." : "Teams are selected automatically and can be unchecked when the action is narrower than the whole faculty."}</p></div><Target size={24} aria-hidden="true" /></div>
      {message ? <div className="api-error-banner" role="alert"><AlertTriangle size={16}  aria-hidden="true"/>{message}</div> : null}
      <fieldset className="admin-dialog-fields" disabled={saving}>
      {options.canCreateWholeReview ? <button aria-pressed={wholeReview} className={`qa-whole-review-action${wholeReview ? " is-selected" : ""}`} onClick={() => setWholeReview((current) => !current)} type="button"><AlertTriangle size={20} aria-hidden="true" /><span><strong>Whole review action</strong><small>Assign to every Head of Faculty and Programme Leader involved in this review. Use only for a college-wide review priority.</small></span></button> : null}
      <div className="qa-action-scope-layout">
        <div className="route-stack">
          <label className="entry-field"><span>Faculty <strong>Required</strong></span><select disabled={wholeReview || isPl} onChange={(event) => selectFaculty(event.target.value)} value={faculty.facultyOrgUnitId}>{options.faculties.map((item) => <option key={item.facultyOrgUnitId} value={item.facultyOrgUnitId}>{item.facultyName}</option>)}</select></label>
          <fieldset className="qa-action-team-picker" disabled={wholeReview || isPl}><legend>Teams <strong>Required</strong></legend>{faculty.teams.map((team) => <label key={team.teamOrgUnitId}><input checked={teamIds.includes(team.teamOrgUnitId)} onChange={() => toggleTeam(team.teamOrgUnitId)} type="checkbox" /><span><strong>{team.teamName}</strong><small>{team.programmeLeader ? `Programme Leader: ${team.programmeLeader.displayName}` : "No Programme Leader assigned — HOF only"}</small></span></label>)}</fieldset>
        </div>
        <aside className="qa-action-owner-preview"><p className="eyebrow">Automatic owners</p>{selectedFaculties.map((item) => item.headOfFaculty ? <div key={item.headOfFaculty.staffId}><ShieldCheck size={17}  aria-hidden="true"/><span><strong>{item.headOfFaculty.displayName}</strong><small>Head of Faculty · always assigned</small></span></div> : <div className="is-warning" key={item.facultyOrgUnitId}><AlertTriangle size={17}  aria-hidden="true"/><span><strong>{item.facultyName} needs a Head of Faculty</strong><small>Assign the faculty manager in Admin before creating this action.</small></span></div>)}{Array.from(selectedPls.entries()).map(([id, name]) => <div key={id}><Users size={17}  aria-hidden="true"/><span><strong>{name}</strong><small>Programme Leader</small></span></div>)}</aside>
      </div>
      <div className="form-grid form-grid-two"><label className="entry-field entry-field-wide"><span>Action <strong>Required</strong></span><input maxLength={300} onChange={(event) => setTitle(event.target.value)} placeholder="What needs to improve?" value={title} /></label><label className="entry-field entry-field-wide"><span>Success measure or detail</span><textarea maxLength={2000} onChange={(event) => setDetail(event.target.value)} rows={3} value={detail} /></label><label className="entry-field"><span>Due date <strong>Required</strong></span><input onChange={(event) => setDueDate(event.target.value)} type="date" value={dueDate} /></label></div>
      <div className="toolbar toolbar-end"><Button disabled={saving || (!wholeReview && !faculty.headOfFaculty) || !teamIds.length || !title.trim() || !dueDate} icon={Plus} onClick={() => void create()} variant="primary">{saving ? "Creating action…" : wholeReview ? "Create whole review action" : `Create action for ${teamIds.length} team${teamIds.length === 1 ? "" : "s"}`}</Button></div>
      </fieldset>
    </section>
  );
}

function QaActionGroupCards({ groups, onClose, onReview, onOpenReview, filterable = true }: { groups: QaActionGroupSummary[]; onClose: (group: QaActionGroupSummary) => Promise<void>; onReview: (group: QaActionGroupSummary) => Promise<void>; onOpenReview?: (reviewId: string) => void; filterable?: boolean }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [faculty, setFaculty] = useState("");
  const [sort, setSort] = useState("due-asc");
  const visible = filterable ? sortListRows(groups.filter(group => (!status || group.status === status) && (!faculty || group.facultyName === faculty)
    && matchesListSearch(query, group.title, group.detail, group.reviewTitle, group.creatorName, group.facultyName, group.teamNames, group.status, group.dueDate, group.closeNote, group.assignments.map(assignment => [assignment.staffName, assignment.sourceOrgUnitName, assignment.status]))),
    group => sort.startsWith("title") ? group.title : sort.startsWith("status") ? group.status : Date.parse(group.dueDate), sort.endsWith("desc") ? "desc" : "asc", group => group.id) : groups;
  return (
    <section className="qa-action-groups" aria-label="QA actions">
      {filterable ? <div className="panel filter-toolbar"><label className="entry-field"><span>Find an action</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Action, owner, team or completion note" /></label><label className="entry-field"><span>Status</span><select value={status} onChange={event => setStatus(event.target.value)}><option value="">All statuses</option>{distinctListValues(groups.map(group => group.status)).map(value => <option key={value}>{value}</option>)}</select></label><label className="entry-field"><span>Faculty</span><select value={faculty} onChange={event => setFaculty(event.target.value)}><option value="">All faculties</option>{distinctListValues(groups.map(group => group.facultyName)).map(value => <option key={value}>{value}</option>)}</select></label><AdminListSort value={sort} onChange={setSort} options={[["due-asc","Due date: soonest first"],["due-desc","Due date: latest first"],["title-asc","Action: A–Z"],["status-asc","Status: A–Z"]]} /></div> : null}
      {!visible.length ? <div className="panel empty-state">No QA actions match this view.</div> : null}
      {visible.map((group) => <article className="panel qa-action-group" key={group.id}>
        <div className="qa-action-group-heading"><div><span className={`status-pill status-${group.status}`}>{group.status[0].toUpperCase() + group.status.slice(1)}</span><h3>{group.title}</h3><p>{group.reviewTitle} · {group.facultyName} · created by {group.creatorName}</p></div><div className="qa-action-due"><CalendarRange size={17}  aria-hidden="true"/><span><small>Due</small><strong>{new Date(`${group.dueDate}T00:00:00`).toLocaleDateString()}</strong></span></div></div>
        {group.detail ? <p className="qa-action-detail">{group.detail}</p> : null}
        <div className="qa-action-team-tags">{group.teamNames.map((team) => <span key={team}>{team}</span>)}</div>
        <div className="qa-action-assignees">{group.assignments.map((assignment) => <div key={assignment.actionId}><span className={assignment.completedDate || assignment.status === "complete" ? "is-complete" : ""}>{assignment.completedDate || assignment.status === "complete" ? <CheckCircle2 size={17}  aria-hidden="true"/> : <Users size={17}  aria-hidden="true"/>}</span><p><strong>{assignment.staffName}</strong><small>{assignment.assignmentRole === "hof" ? "Head of Faculty" : "Programme Leader"} · {assignment.sourceOrgUnitName}</small></p><span className={`status-pill status-${assignment.completedDate || assignment.status === "complete" ? "complete" : "open"}`}>{assignment.completedDate || assignment.status === "complete" ? "Complete" : "Open"}</span></div>)}</div>
        {group.closeNote ? <p className="qa-action-close-note"><strong>Completion note:</strong> {group.closeNote}</p> : null}
        <div className="toolbar toolbar-end">{onOpenReview ? <Button onClick={() => onOpenReview(group.reviewId)}>Open review</Button> : null}{group.canReview ? <Button icon={CheckCircle2} onClick={() => void onReview(group)} variant="primary">Review action</Button> : null}{group.canClose ? <Button icon={Check} onClick={() => void onClose(group)} variant="primary">Close action</Button> : null}</div>
      </article>)}
    </section>
  );
}

function QaDashboard({ dashboard }: { dashboard: QaDashboardSummary }) {
  const labels = useQaOutcomeLabels();
  return (
    <div className="route-stack">
      <section className="qa-kpi-grid"><article className="stat-card"><span>Submissions</span><strong>{dashboard.evidenceCount}</strong></article><article className="stat-card"><span>Rated responses</span><strong>{dashboard.ratedCount}</strong></article><article className="stat-card"><span>Teams with evidence</span><strong>{dashboard.teamCount}</strong></article><article className="stat-card"><span>{qaCombinedOutcomeLabel(labels)}</span><strong>{dashboard.ratedCount ? `${dashboard.atOrAbovePercentage}%` : "No rated data"}</strong></article></section>
      <section className="panel"><div className="section-heading"><div><h2>Outcome distribution</h2><p>Compare the outcomes recorded across this review. Not seen and not applicable responses are shown separately and excluded from rated percentages.</p></div>{dashboard.snapshotVersion ? <span className="status-pill">Closure snapshot {dashboard.snapshotVersion}</span> : null}</div><div className="qa-outcome-summary"><span className="outcome-not_seen">Not seen <strong>{dashboard.notSeenCount ?? 0}</strong></span><span className="outcome-below">{labels.below} <strong>{dashboard.belowCount}</strong></span><span className="outcome-at">{labels.at} <strong>{dashboard.atCount}</strong></span><span className="outcome-above">{labels.above} <strong>{dashboard.aboveCount}</strong></span><span>{labels.notApplicable} <strong>{dashboard.notApplicableCount}</strong></span></div></section>
      <QaProcessDashboard processes={dashboard.byActivity} questions={dashboard.questions} />
      <QaCriteriaHighlights questions={dashboard.questions} />
      {dashboard.teamsWithoutEvidence.length ? <section className="panel"><h2>Zero coverage</h2><p>{dashboard.teamsWithoutEvidence.join(", ")}</p></section> : null}
    </div>
  );
}

function QaCriteriaHighlights({ questions }: { questions: QaDashboardQuestionBreakdown[] }) {
  const labels = useQaOutcomeLabels();
  const rated = questions.filter((question) => question.rated > 0);
  const strongest = [...rated].sort((left, right) =>
    right.at + right.above - (left.at + left.above)
    || (right.at + right.above) / right.rated - (left.at + left.above) / left.rated
    || right.rated - left.rated).slice(0, 3);
  const concerns = [...rated].sort((left, right) =>
    right.below - left.below
    || right.below / right.rated - left.below / left.rated
    || right.rated - left.rated).slice(0, 3);
  const cards = (items: QaDashboardQuestionBreakdown[], kind: "strong" | "concern") => items.length ? items.map((question, index) => {
    const count = kind === "strong" ? question.at + question.above : question.below;
    const percentage = outcomePercentage(count, question.rated);
    return <article className={`qa-highlight-card is-${kind}`} key={`${kind}-${question.questionId}`}><span className="qa-highlight-rank">{index + 1}</span><div><small>{question.activityLabel}{question.themeOrWeek ? ` · ${question.themeOrWeek}` : ""}</small><h3>{question.questionText}</h3><p><strong>{count}/{question.rated}</strong> responses · {percentage}% {kind === "strong" ? qaCombinedOutcomeLabel(labels) : labels.below}</p><QaDistributionBar above={question.above} at={question.at} below={question.below} label={question.questionText} rated={question.rated} /></div></article>;
  }) : <p className="empty-state">No rated criteria are available yet.</p>;
  return <section className="qa-highlight-grid"><div className="panel"><div className="section-heading"><div><p className="eyebrow">Top three</p><h2>Strongest criteria</h2><p>Questions with the highest number of {qaCombinedOutcomeLabel(labels)} responses, then the strongest proportion.</p></div></div><div className="qa-highlight-list">{cards(strongest, "strong")}</div></div><div className="panel"><div className="section-heading"><div><p className="eyebrow">Bottom three</p><h2>Concern criteria</h2><p>Questions with the highest number of {labels.below} responses, then the highest proportion.</p></div></div><div className="qa-highlight-list">{cards(concerns, "concern")}</div></div></section>;
}

function outcomePercentage(value: number, rated: number) {
  return rated === 0 ? 0 : Math.round(value * 1000 / rated) / 10;
}

function QaDistributionBar({ below, at, above, rated, label }: { below: number; at: number; above: number; rated: number; label: string }) {
  const labels = useQaOutcomeLabels();
  const belowPercentage = outcomePercentage(below, rated);
  const atPercentage = outcomePercentage(at, rated);
  const abovePercentage = outcomePercentage(above, rated);
  return (
    <div aria-label={rated === 0 ? `${label}: No rated responses` : `${label}: ${belowPercentage}% ${labels.below}, ${atPercentage}% ${labels.at} and ${abovePercentage}% ${labels.above}`} className="qa-distribution-bar" role="img">
      <span className="is-below" style={{ width: `${belowPercentage}%` }} />
      <span className="is-at" style={{ width: `${atPercentage}%` }} />
      <span className="is-above" style={{ width: `${abovePercentage}%` }} />
      {rated === 0 ? <span className="is-empty">No rated responses</span> : null}
    </div>
  );
}

function QaProcessDashboard({ processes, questions }: { processes: QaDashboardBreakdown[]; questions: QaDashboardQuestionBreakdown[] }) {
  const labels = useQaOutcomeLabels();
  return (
    <section className="panel qa-process-dashboard">
      <div className="section-heading"><div><h2>QA processes and questions</h2><p>Expand a process to drill down into every criterion and its outcome distribution.</p></div></div>
      <div className="qa-process-breakdowns">
        {processes.map((process) => {
          const processQuestions = questions.filter((question) => question.activityKey === process.key);
          const belowPercentage = outcomePercentage(process.below, process.rated);
          const atPercentage = outcomePercentage(process.at, process.rated);
          const abovePercentage = outcomePercentage(process.above, process.rated);
          return (
            <details className="qa-process-breakdown" key={process.key}>
              <summary>
                <div className="qa-process-summary-heading"><div><strong>{process.label}</strong><span>{process.rated} rated responses · {processQuestions.length} questions{process.notSeen ? ` · ${process.notSeen} Not seen` : ""}{process.notApplicable ? ` · ${process.notApplicable} ${labels.notApplicable}` : ""}</span></div><div className="qa-process-summary-counts"><span className="is-below"><strong>{process.below}</strong> · {process.rated ? `${belowPercentage}%` : "—"} {labels.below}</span><span className="is-at"><strong>{process.at}</strong> · {process.rated ? `${atPercentage}%` : "—"} {labels.at}</span><span className="is-above"><strong>{process.above}</strong> · {process.rated ? `${abovePercentage}%` : "—"} {labels.above}</span></div></div>
                <QaDistributionBar above={process.above} at={process.at} below={process.below} label={process.label} rated={process.rated} />
              </summary>
              <div className="qa-question-breakdowns">
                {processQuestions.map((question) => (
                  <article className="qa-question-breakdown" key={question.questionId}>
                    <div className="qa-question-breakdown-heading"><div>{question.themeOrWeek ? <span className="qa-criterion-theme">{question.themeOrWeek}</span> : null}<h3>{question.questionText}</h3></div><span>{question.rated} rated{question.notSeen ? ` · ${question.notSeen} Not seen` : ""}{question.notApplicable ? ` · ${question.notApplicable} ${labels.notApplicable}` : ""}</span></div>
                    <QaDistributionBar above={question.above} at={question.at} below={question.below} label={question.questionText} rated={question.rated} />
                    <div className="qa-question-outcome-stats"><span className="is-below"><small>{labels.below}</small><strong>{question.below}</strong><em>{question.rated ? `${question.belowPercentage}%` : "—"}</em></span><span className="is-at"><small>{labels.at}</small><strong>{question.at}</strong><em>{question.rated ? `${question.atPercentage}%` : "—"}</em></span><span className="is-above"><small>{labels.above}</small><strong>{question.above}</strong><em>{question.rated ? `${question.abovePercentage}%` : "—"}</em></span></div>
                  </article>
                ))}
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}

function QaNewEvidence({ activityId, detail, onCancel, onCreated }: { activityId: string; detail: QaReviewDetail; onCancel: () => void; onCreated: (id: string) => void }) {
  const activity = detail.activities.find((item) => item.id === activityId)!;
  const teams = detail.scope.filter((scope) => scope.scopeType === "team");
  const faculties = Array.from(new Map(teams.map((team) => [team.parentOrgUnitId ?? team.parentCode ?? team.parentName ?? "unassigned", {
    id: team.parentOrgUnitId ?? team.parentCode ?? team.parentName ?? "unassigned",
    name: team.parentName ?? "Other"
  }])).values()).sort((left, right) => left.name.localeCompare(right.name));
  const [facultyId, setFacultyId] = useState(faculties[0]?.id ?? "");
  const facultyTeams = facultyId === "all" ? teams : teams.filter((team) => (team.parentOrgUnitId ?? team.parentCode ?? team.parentName ?? "unassigned") === facultyId);
  const [teamId, setTeamId] = useState(facultyTeams[0]?.orgUnitId ?? "");
  const [allTeams, setAllTeams] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const clearNavigation = useQaNavigationGuard(false, saving);

  function facultyChanged(nextFacultyId: string) {
    const nextTeams = nextFacultyId === "all" ? teams : teams.filter((team) => (team.parentOrgUnitId ?? team.parentCode ?? team.parentName ?? "unassigned") === nextFacultyId);
    setFacultyId(nextFacultyId);
    setTeamId(nextTeams[0]?.orgUnitId ?? "");
    setAllTeams(false);
  }

  async function saveDraft() {
    if (activity.canSubmitEvidence === false || !detail.review.capabilities.canSubmitEvidence || saving) return;
    const selectedTeams = allTeams ? facultyTeams : facultyTeams.filter((team) => team.orgUnitId === teamId);
    if (!selectedTeams.length) { setMessage("Select a faculty and team before continuing."); return; }
    setSaving(true);
    setMessage("");
    const request: SaveQaEvidenceRequest = {
      reviewActivityId: activity.id,
      teamOrgUnitId: selectedTeams[0].orgUnitId,
      teamOrgUnitIds: selectedTeams.map((team) => team.orgUnitId),
      activityAt: new Date().toISOString(),
      responses: activity.questions.map((question) => ({ reviewQuestionId: question.id }))
    };
    const result = await api.saveQaEvidence(detail.review.id, undefined, request, false);
    if (!result.ok) {
      setSaving(false);
      setMessage(result.message ?? "The evidence draft could not be created.");
      return;
    }
    setSaving(false);
    clearNavigation();
    onCreated(result.data!.evidence.id);
  }
  return (
    <section className="panel qa-editor qa-new-evidence"><div className="section-heading"><div><p className="eyebrow">{activity.name}</p><h2>Choose review scope</h2><p>Select one team, or use All teams to apply this evidence submission to every team in the chosen faculty.</p></div></div>{message ? <div className="api-error-banner" role="alert"><AlertTriangle size={16}  aria-hidden="true"/>{message}</div> : null}<div className="qa-evidence-scope-picker">
      <label><span>Faculty</span><select onChange={(event) => facultyChanged(event.target.value)} value={facultyId}>{faculties.length > 1 ? <option value="all">All faculties</option> : null}{faculties.map((faculty) => <option key={faculty.id} value={faculty.id}>{faculty.name}</option>)}</select></label>
      <label><span>Team</span><select disabled={allTeams} onChange={(event) => setTeamId(event.target.value)} value={teamId}>{facultyTeams.map((team) => <option key={team.orgUnitId} value={team.orgUnitId}>{team.name}</option>)}</select></label>
      <button aria-pressed={allTeams} className="qa-all-teams-button" onClick={() => setAllTeams((current) => !current)} type="button"><Check size={17} aria-hidden="true" /><span><strong>All teams</strong><small>{facultyTeams.length} in selection</small></span></button>
    </div><div className="toolbar toolbar-end"><Button disabled={saving} onClick={onCancel}>Cancel</Button><Button disabled={saving || !teamId} icon={Plus} onClick={() => void saveDraft()} variant="primary">{saving ? "Preparing evidence…" : allTeams ? `Continue with ${facultyTeams.length} teams` : "Continue to evidence"}</Button></div></section>
  );
}

function QaEvidenceEditor({ evidenceId, reviews, onNavigate, onSubmitted }: { evidenceId: string; reviews: QaHubSummary["reviews"]; onNavigate: (path: string) => void; onSubmitted: () => Promise<void> }) {
  const [detail, setDetail] = useState<QaEvidenceDetail | null>(null);
  const [deliveryAreas, setDeliveryAreas] = useState<LearningWalkDeliveryArea[]>([]);
  const [deliveryAreasLoaded, setDeliveryAreasLoaded] = useState(false);
  const [deliveryAreaError, setDeliveryAreaError] = useState("");
  const [deliveryAreaAttempt, setDeliveryAreaAttempt] = useState(0);
  const [evidenceAttempt, setEvidenceAttempt] = useState(0);
  const [request, setRequest] = useState<SaveQaEvidenceRequest | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [finalizing, setFinalizing] = useState(false);
  const queue = useRef<QaEvidenceSaveQueue<SaveQaEvidenceRequest, QaEvidenceDetail> | null>(null);
  const navigationDecisionPending = useNavigationDecisionPending();
  const canSubmitDraft = Boolean(detail?.evidence.canEdit && detail.evidence.status === "draft");
  const clearNavigation = useUnsavedChanges({
    label: "QA evidence", dirty, saving, submission: canSubmitDraft,
    onSave: detail?.evidence.canEdit ? () => save(false) : undefined,
    onSubmit: canSubmitDraft ? () => save(true, false, false) : undefined,
    submitLabel: "Submit evidence",
    discardLabel: "Discard unsaved changes",
    discardMessage: detail?.evidence.status === "submitted"
      ? "Previously saved submitted evidence is retained. Only corrections not yet saved will be discarded."
      : "Evidence already saved or autosaved is retained as a draft. Only changes not yet saved will be discarded; this does not remove the evidence.",
    onDiscard: () => { queue.current?.cancelUnsaved(); setMessage(""); }
  });
  useEffect(() => {
    let cancelled = false;
    setMessage("");
    void api.qaEvidence(evidenceId).then(next => {
      if (cancelled) return;
      const initial: SaveQaEvidenceRequest = {
        reviewActivityId: next.evidence.reviewActivityId, teamOrgUnitId: next.evidence.teamOrgUnitId,
        teamOrgUnitIds: next.teamOrgUnitIds,
        courseProgramme: next.evidence.courseProgramme, courseLevel: next.evidence.courseLevel,
        deliveryAreaKey: next.evidence.deliveryAreaKey,
        subjectStaffId: next.subjectStaffId, activityAt: next.evidence.activityAt, sampleSize: next.evidence.sampleSize,
        contextualNotes: next.contextualNotes, evidenceLinks: next.evidenceLinks, keyStrengths: next.keyStrengths,
        areasForImprovement: next.areasForImprovement, recommendedActions: next.recommendedActions,
        additionalContext: next.additionalContext, rowVersion: next.evidence.rowVersion,
        responses: next.responses.map(response => ({ reviewQuestionId: response.reviewQuestionId, outcome: response.outcome, comment: response.comment, notApplicableReason: response.notApplicableReason }))
      };
      queue.current = new QaEvidenceSaveQueue({
        initial,
        send: (value, submit) => api.saveQaEvidence(next.evidence.reviewId, evidenceId, value, submit),
        version: result => result.evidence.rowVersion,
        changed: (value, isDirty, busy, submitting) => {
          setRequest(value); setDirty(isDirty); setSaving(busy); setFinalizing(submitting);
        },
        saved: setDetail,
        failed: setMessage
      });
      setDetail(next); setRequest(initial); setDirty(false);
    }).catch(() => { if (!cancelled) setMessage("This evidence submission was not found, or it is outside your scope."); });
    return () => { cancelled = true; queue.current?.dispose(); queue.current = null; };
  }, [evidenceId, evidenceAttempt]);
  useEffect(() => {
    let cancelled = false;
    setDeliveryAreaError(""); setDeliveryAreasLoaded(false);
    api.learningWalkDeliveryAreas().then((areas) => { if (!cancelled) { setDeliveryAreas(areas); setDeliveryAreasLoaded(true); } })
      .catch(() => { if (!cancelled) setDeliveryAreaError("Delivery areas could not be loaded. Your evidence is still here; try again before submitting."); });
    return () => { cancelled = true; };
  }, [deliveryAreaAttempt]);
  useEffect(() => {
    if (navigationDecisionPending || !dirty || saving || message || !request || !detail?.evidence.canEdit || detail.evidence.status === "submitted") return;
    const timer = window.setTimeout(() => { void save(false, true); }, 900);
    return () => window.clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, request, saving, message, navigationDecisionPending]);
  if (message && !detail) return <section className="access-denied-panel"><AlertTriangle size={22}  aria-hidden="true"/><div><h1>Evidence unavailable</h1><p>{message}</p></div><Button onClick={() => setEvidenceAttempt(value => value + 1)}>Try again</Button><Button onClick={() => onNavigate("/qa-hub")} variant="primary">Back to QA Hub</Button></section>;
  if (!detail || !request) return <LoadingState label="Loading evidence" size="page" />;
  function update<K extends keyof SaveQaEvidenceRequest>(key: K, value: SaveQaEvidenceRequest[K]) {
    queue.current?.edit(current => ({ ...current, [key]: value })); setMessage("");
  }
  function updateResponse(index: number, patch: Partial<SaveQaEvidenceRequest["responses"][number]>) {
    queue.current?.edit(current => ({ ...current, responses: current.responses.map((response, responseIndex) => responseIndex === index ? { ...response, ...patch } : response) }));
    setMessage("");
  }
  async function save(submit: boolean, autosave = false, navigateAfterSubmit = true): Promise<boolean> {
    if (!request || !queue.current || finalizing || !detail?.evidence.canEdit || submit && detail.evidence.status !== "draft") return false;
    if (autosave && navigationDecisionPending) return false;
    if (submit && (!deliveryAreasLoaded || !request.deliveryAreaKey) && detail?.evidence.status !== "submitted") {
      setMessage("Select a delivery area before submitting QA evidence."); return false;
    }
    if (detail!.evidence.status === "submitted") {
      const reason = window.prompt("Audit reason for correcting submitted evidence (required)") ?? "";
      if (!reason.trim()) return false;
      queue.current.edit(current => ({ ...current, correctionReason: reason }));
    }
    setMessage("");
    const saved = await queue.current.save(submit);
    if (!saved) return false;
    if (submit) {
      clearNavigation();
      void onSubmitted();
      if (navigateAfterSubmit) onNavigate(`/qa-hub/reviews/${detail!.evidence.reviewId}/evidence`);
    } else if (!autosave) {
      setMessage(detail!.evidence.status === "submitted" ? "Correction saved. The evidence remains submitted." : "Draft saved.");
    }
    return true;
  }
  async function remove() {
    const reason = window.prompt("Removal reason (required)") ?? "";
    if (!reason.trim()) return;
    if (saving) return;
    setSaving(true);
    const result = await api.removeQaEvidence(evidenceId, reason);
    setSaving(false);
    if (!result.ok) { setMessage(result.message ?? "Evidence could not be removed."); return; }
    clearNavigation(); void onSubmitted();
    onNavigate(`/qa-hub/reviews/${detail!.evidence.reviewId}/evidence`);
  }
  return (
    <section className="panel qa-evidence-editor">
      <div className="section-heading"><div><Button icon={ArrowLeft} onClick={() => onNavigate(`/qa-hub/reviews/${detail.evidence.reviewId}/evidence`)} variant="quiet">Evidence list</Button><p className="eyebrow">{reviews.find((review) => review.id === detail.evidence.reviewId)?.title ?? "QA review"}</p><p className="eyebrow">{detail.evidence.activityName} · {detail.teamNames.length > 1 ? `${detail.teamNames.length} teams` : detail.evidence.teamName}</p><h1>{detail.evidence.status === "draft" ? "Evidence draft" : `Submitted evidence · revision ${detail.evidence.versionNumber}`}</h1><p>{finalizing ? "Submitting…" : saving ? "Saving in the background…" : dirty ? "Unsaved changes" : detail.evidence.status === "draft" ? "Draft autosaved" : `Submitted by ${detail.evidence.reviewerName}`}</p>{detail.teamNames.length > 1 ? <div className="qa-evidence-team-tags">{detail.teamNames.map((team) => <span key={team}>{team}</span>)}</div> : null}</div><span className={`status-pill status-${detail.evidence.status}`}>{detail.evidence.status}</span></div>
      {message ? <div className={message.startsWith("Evidence submitted") || (message === "Draft saved." || message.startsWith("Correction saved.")) ? "success-banner" : "api-error-banner"} role="status">{message}</div> : null}
      {!detail.evidence.canEdit ? <p className="notice-row">This evidence is read-only. Editing depends on the review being open and your access to this form and submission.</p> : null}
      {deliveryAreaError ? <div className="notice-row" role="alert">{deliveryAreaError}<Button onClick={() => setDeliveryAreaAttempt(value => value + 1)}>Try again</Button></div> : null}
      <div className="entry-section"><h2>Course and delivery context</h2><div className="entry-field-grid"><label className="entry-field"><span>Delivery area <strong>Required to submit</strong></span><select disabled={!detail.evidence.canEdit || finalizing || !deliveryAreasLoaded} value={request.deliveryAreaKey ?? ""} onChange={(event) => update("deliveryAreaKey", event.target.value)}><option value="">{deliveryAreasLoaded ? "Select delivery area" : "Loading delivery areas…"}</option>{learningWalkDeliveryChoices(deliveryAreas, detail.evidence.deliveryAreaKey, detail.evidence.deliveryAreaName).map((area) => <option key={area.key} value={area.key} disabled={!area.isActive && area.key !== detail.evidence.deliveryAreaKey}>{area.name}{area.isActive ? "" : " (retired)"}</option>)}</select></label></div><small>Uses the shared LIV and Learning Walk delivery-area list.</small></div>
      <div className="qa-criteria-list">{detail.responses.map((question, index) => <QaCriterion key={question.reviewQuestionId} question={question} response={request.responses[index]} disabled={!detail.evidence.canEdit || finalizing} onChange={(patch) => updateResponse(index, patch)} />)}</div>
      <div className="toolbar qa-evidence-actions">{detail.evidence.canRemove ? <Button disabled={saving} icon={X} onClick={() => void remove()} variant="danger">Remove</Button> : null}<span className="button-spacer" />{detail.evidence.canEdit ? <Button disabled={saving} onClick={() => void save(false)}>{detail.evidence.status === "submitted" ? "Save correction" : "Save draft"}</Button> : null}{detail.evidence.canEdit && detail.evidence.status === "draft" ? <Button disabled={finalizing} icon={Check} onClick={() => void save(true)} variant="primary">Submit evidence</Button> : null}</div>
      {detail.revisions.length ? <details className="qa-revisions"><summary>Revision history ({detail.revisions.length})</summary><ul className="timeline-list">{detail.revisions.map((revision) => <li key={revision.versionNumber}><strong>Revision {revision.versionNumber}</strong><span>{revision.createdBy} · {new Date(revision.createdAt).toLocaleString()}</span>{revision.reason ? <small>{revision.reason}</small> : null}</li>)}</ul></details> : null}
    </section>
  );
}

function QaCriterion({ question, response, disabled, onChange }: { question: QaEvidenceResponseSummary; response: SaveQaEvidenceRequest["responses"][number]; disabled: boolean; onChange: (patch: Partial<SaveQaEvidenceRequest["responses"][number]>) => void }) {
  const labels = useQaOutcomeLabels();
  const criterionId = useId();
  const showNotSeen = question.allowsNotSeen || question.outcome === "not_seen";
  const outcomes = [...(showNotSeen ? [{ key: "not_seen", label: "Not seen" }] : []), { key: "below", label: labels.below }, { key: "at", label: labels.at }, { key: "above", label: labels.above }, ...(question.allowsNotApplicable ? [{ key: "not_applicable", label: labels.notApplicable }] : [])];
  return (
    <fieldset className="qa-criterion">
      <legend className="sr-only">{question.questionText}{question.isRequired ? " (required)" : ""}</legend>
      <header className="qa-criterion-header">
        <div className="qa-criterion-title">
          {question.themeOrWeek ? <span className="qa-criterion-theme">{question.themeOrWeek}</span> : null}
          <h3 id={`${criterionId}-question`}>{question.questionText}</h3>
        </div>
        <span className={question.isRequired ? "qa-criterion-requirement is-required" : "qa-criterion-requirement"}>{question.isRequired ? "Required" : "Optional"}</span>
      </header>
      {question.guidance ? <p className="qa-criterion-guidance">{question.guidance}</p> : null}
      <div aria-labelledby={`${criterionId}-question`} aria-required={question.isRequired} className="qa-outcome-buttons" data-outcome-count={outcomes.length} role="radiogroup">
        {outcomes.map((outcome, index) => <button aria-checked={response.outcome === outcome.key} role="radio" tabIndex={response.outcome === outcome.key || !outcomes.some(item => item.key === response.outcome) && index === 0 ? 0 : -1} className={`outcome-${outcome.key}`} disabled={disabled} key={outcome.key} onClick={() => onChange({ outcome: outcome.key, notApplicableReason: outcome.key === "not_applicable" ? response.notApplicableReason : undefined })} onKeyDown={event => {
          if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === "Home" ? 0 : event.key === "End" ? outcomes.length - 1
            : (index + (event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1) + outcomes.length) % outcomes.length;
          const chosen = outcomes[next];
          onChange({ outcome: chosen.key, notApplicableReason: chosen.key === "not_applicable" ? response.notApplicableReason : undefined });
          event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
        }} type="button">{outcome.label}</button>)}
      </div>
      {showNotSeen ? <p className="qa-not-seen-help">Not seen means there was insufficient evidence to make a judgement. It has no score and is excluded from rated percentages.</p> : null}
      {response.outcome === "not_applicable" ? <label className="qa-not-applicable-reason"><span>Reason for {labels.notApplicable}</span><textarea disabled={disabled} onChange={(event) => onChange({ notApplicableReason: event.target.value })} required rows={2} value={response.notApplicableReason ?? ""} /></label> : null}
      <label className="qa-not-applicable-reason"><span>Evidence notes <small>Optional</small></span><textarea disabled={disabled} onChange={(event) => onChange({ comment: event.target.value })} rows={2} value={response.comment ?? ""} /></label>
    </fieldset>
  );
}
