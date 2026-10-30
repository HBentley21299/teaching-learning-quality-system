import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowRight, BarChart3, BookOpenCheck, CalendarClock, CheckCircle2, ClipboardCheck, Eye, MessageSquareText, RefreshCw, Search, ShieldCheck, Sparkles, UsersRound } from "lucide-react";
import { DashboardReportButton } from "../components/ExportButtons";
import { LoadingState } from "../components/LoadingState";
import { DashboardDataExplorer } from "../components/DashboardDataExplorer";
import { KpiStrip } from "../components/KpiStrip";
import { Button } from "../design-system/Button";
import { api } from "../services/api";
import { DashboardRequestCache } from "../services/dashboardRequestCache";
import { compareListValues, distinctListValues, matchesListSearch } from "../services/listQuery";
import { Pagination } from "../components/CollapsibleSection";
import type { UcoTlaAccessSummary, UcoTlaDashboardSummary, UcoTlaReviewSummary } from "../services/types";

type Props = {
  access: UcoTlaAccessSummary;
  academicYear: string;
  onOpenReview: (recordId: string) => void;
  section?: "summary" | "data";
  onSectionChange?: (section: "summary" | "data") => void;
  requestCache?: DashboardRequestCache;
  accessScope?: string;
};

export function UcoTlaDashboard({ access, academicYear, onOpenReview, section: controlledSection, onSectionChange, requestCache: sharedCache, accessScope = JSON.stringify(access) }: Props) {
  const localCache = useRef(new DashboardRequestCache()).current;
  const requestCache = sharedCache ?? localCache;
  const scope = JSON.stringify([academicYear, accessScope, access.canAccess, access.canManage, access.canExport]);
  const [localSection, setLocalSection] = useState<"summary" | "data">("summary");
  const section = controlledSection ?? localSection;
  const [loadedDashboard, setLoadedDashboard] = useState<{ scope: string; revision: number; value: UcoTlaDashboardSummary } | null>(null);
  const dashboard = loadedDashboard?.scope === scope ? loadedDashboard.value : null;
  const [reviewSearch, setReviewSearch] = useState("");
  const [reviewStatus, setReviewStatus] = useState("all");
  const [lecturerFilter, setLecturerFilter] = useState("all");
  const [observerFilter, setObserverFilter] = useState("all");
  const [courseFilter, setCourseFilter] = useState("all");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [followUpFilter, setFollowUpFilter] = useState("all");
  const [sortBy, setSortBy] = useState("observationAt");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const loadSequence = useRef(0);
  const activeScope = useRef(scope);
  activeScope.current = scope;

  async function refresh(invalidate = true) {
    if (invalidate) { requestCache.clear(); setLoadedDashboard(null); }
    const sequence = ++loadSequence.current;
    const requestedScope = scope;
    setIsRefreshing(true);
    setError("");
    try {
      const next = await requestCache.get(`uco-summary:${requestedScope}`, () => api.ucoTlaDashboard(academicYear));
      if (sequence === loadSequence.current && activeScope.current === requestedScope) setLoadedDashboard({ scope: requestedScope, revision: sequence, value: next });
    } catch {
      if (sequence === loadSequence.current && activeScope.current === requestedScope) setError("The UCO TLA dashboard could not be loaded.");
    } finally {
      if (sequence === loadSequence.current && activeScope.current === requestedScope) setIsRefreshing(false);
    }
  }

  useEffect(() => { setLoadedDashboard(null); setPage(1); void refresh(false); return () => { ++loadSequence.current; }; }, [scope]);
  const formFilterKey = JSON.stringify({ academicYear, status: reviewStatus === "all" ? undefined : reviewStatus });
  const loadFormData = useCallback(() => requestCache.get(`uco-data:${scope}:${formFilterKey}`, () => api.dashboardRecordData(academicYear, "uco_tla_review", JSON.parse(formFilterKey))), [requestCache, scope, formFilterKey]);

  const reviews = (dashboard?.reviews ?? []).filter(review => reviewStatus === "all" || review.workflowStatus === reviewStatus);
  const completedReviews = reviews.filter((review) => review.workflowStatus === "completed").length;
  const inProgressReviews = reviews.length - completedReviews;
  const completedSectionMarks = reviews.reduce((total, review) => total + review.completedSectionCount, 0);
  const sectionReadiness = reviews.length ? Math.round(completedSectionMarks * 100 / (reviews.length * 7)) : 0;
  const personalCompletion = reviews.length ? Math.round(completedReviews * 100 / reviews.length) : 0;
  const headlineProgress = access.canManage ? dashboard?.coveragePercent ?? 0 : personalCompletion;
  const workflowDistribution = [
    { status: "observer_draft", label: "Observer review", detail: "Evidence being prepared", tone: "blue" },
    { status: "awaiting_lecturer", label: "With lecturer", detail: "Discussion and reflection", tone: "amber" },
    { status: "awaiting_finalisation", label: "Final sign-off", detail: "Observer acknowledgement", tone: "teal" },
    { status: "completed", label: "Complete", detail: "Signed and locked", tone: "green" }
  ].map((item) => ({ ...item, count: (dashboard?.reviews ?? []).filter((review) => review.workflowStatus === item.status).length }));
  const largestWorkflowCount = Math.max(1, ...workflowDistribution.map((item) => item.count));
  const now = Date.now();
  const openActionCount = reviews.reduce((sum, review) => sum + review.openActionCount, 0);
  const overdueActionCount = reviews.reduce((sum, review) => sum + review.overdueActionCount, 0);
  const followUpsDue = reviews.filter(review => review.followUpStatus === "scheduled" && review.followUpAt && new Date(review.followUpAt).getTime() <= now + 14 * 24 * 60 * 60 * 1000).length;
  const reviewIds = new Set(reviews.map(review => review.recordId));
  const practiceHighlights = (dashboard?.practiceHighlights ?? []).filter(highlight => reviewIds.has(highlight.recordId));
  const upcomingObservations = reviews.filter((review) => {
    if (!review.observationAt) return false;
    const observation = new Date(review.observationAt).getTime();
    return observation >= now && observation <= now + 30 * 24 * 60 * 60 * 1000;
  }).length;
  const attentionItems = reviews.flatMap((review) => {
    const attention = reviewAttention(review, now);
    return attention ? [{ review, attention }] : [];
  }).sort((left, right) => left.attention.priority - right.attention.priority || sortableDate(left.review.observationAt) - sortableDate(right.review.observationAt));
  const filteredReviews = reviews.filter((review) =>
    (lecturerFilter === "all" || review.lecturerName === lecturerFilter)
    && (observerFilter === "all" || review.observerName === observerFilter)
    && (courseFilter === "all" || (review.courseTitle || "Not recorded") === courseFilter)
    && (moduleFilter === "all" || (review.moduleTitle || "Not recorded") === moduleFilter)
    && (followUpFilter === "all" || (review.followUpStatus || "Not recorded") === followUpFilter)
    && matchesListSearch(reviewSearch, review.title, review.lecturerName, review.observerName, review.courseTitle, review.moduleTitle, humanStatus(review.workflowStatus), formatDateTime(review.observationAt), formatDateTime(review.professionalDiscussionAt), formatDateTime(review.followUpAt), humanStatus(review.followUpStatus ?? ""), `${review.completedSectionCount}/7 sections marked`, `${review.openActionCount} open`, `${review.overdueActionCount} overdue`)
  ).sort((left, right) => {
    const value = (review: UcoTlaReviewSummary) => ["observationAt", "professionalDiscussionAt", "followUpAt"].includes(sortBy) ? review[sortBy as "observationAt"] ? new Date(review[sortBy as "observationAt"]!) : null : sortBy === "workflowStatus" ? humanStatus(review.workflowStatus) : review[sortBy as "lecturerName"];
    return compareListValues(value(left), value(right), sortDirection) || left.lecturerName.localeCompare(right.lecturerName) || left.recordId.localeCompare(right.recordId);
  });
  const totalPages = Math.max(1, Math.ceil(filteredReviews.length / 15)), currentPage = Math.min(page, totalPages);
  const choiceSets = [
    { key: "lecturer", label: "Lecturer", value: lecturerFilter, change: setLecturerFilter, values: distinctListValues((dashboard?.reviews ?? []).map(review => review.lecturerName)) },
    { key: "observer", label: "Observer", value: observerFilter, change: setObserverFilter, values: distinctListValues((dashboard?.reviews ?? []).map(review => review.observerName)) },
    { key: "course", label: "Course", value: courseFilter, change: setCourseFilter, values: distinctListValues((dashboard?.reviews ?? []).map(review => review.courseTitle || "Not recorded")) },
    { key: "module", label: "Module", value: moduleFilter, change: setModuleFilter, values: distinctListValues((dashboard?.reviews ?? []).map(review => review.moduleTitle || "Not recorded")) },
    { key: "follow-up", label: "Follow-up", value: followUpFilter, change: setFollowUpFilter, values: distinctListValues((dashboard?.reviews ?? []).map(review => review.followUpStatus || "Not recorded")) }
  ];

  return <>
    <header className="intelligence-header">
      <div><p className="eyebrow">University Centre Oldham · {academicYear}</p><h1>Teaching, Learning and Assessment Reviews</h1><p>Track reviews, follow-ups and shared practice. Written evidence is kept in its original form.</p></div>
      <div className="intelligence-header-actions">{access.canExport && dashboard ? <DashboardReportButton filters={{ academicYear, status: reviewStatus === "all" ? undefined : reviewStatus }} moduleKey="uco-tla-reviews" /> : null}<Button disabled={isRefreshing} icon={RefreshCw} onClick={() => void refresh()}>{isRefreshing ? "Refreshing" : "Refresh"}</Button></div>
    </header>

    {error ? <div className="intelligence-warning" role="alert"><AlertCircle aria-hidden="true" size={16} />{error}</div> : null}
    {!dashboard ? <section className="panel">{error ? <><h2>Reporting data unavailable</h2><p>Unavailable records are not shown as zero. Refresh to try again.</p></> : <LoadingState label="Loading UCO reporting data" detail={`Retrieving records for ${academicYear}.`} />}</section> : <>
    <section className="panel intelligence-filter-panel"><div className="intelligence-filter-heading"><div><span>Reporting scope</span><strong>{academicYear} · UCO TLA Reviews</strong></div><small>Workflow stage filters review activity, form data and exports. Annual staff coverage uses the academic-year cohort.</small></div><label className="entry-field"><span>Workflow stage</span><select aria-label="UCO dashboard workflow stage" onChange={event => setReviewStatus(event.target.value)} value={reviewStatus}><option value="all">All stages</option><option value="observer_draft">Observer review</option><option value="awaiting_lecturer">With lecturer</option><option value="awaiting_finalisation">Final sign-off</option><option value="completed">Complete</option>{distinctListValues((dashboard?.reviews ?? []).map(review => review.workflowStatus)).filter(value => !["observer_draft", "awaiting_lecturer", "awaiting_finalisation", "completed"].includes(value)).map(value => <option key={value} value={value}>{humanStatus(value)}</option>)}</select></label></section>
    {access.canExport ? <nav className="dashboard-section-tabs" aria-label="UCO report sections"><button type="button" aria-current={section === "summary" ? "page" : undefined} onClick={() => (onSectionChange ?? setLocalSection)("summary")}>Summary</button><button type="button" aria-current={section === "data" ? "page" : undefined} onClick={() => (onSectionChange ?? setLocalSection)("data")}>Form data</button></nav> : null}
    {access.canExport && section === "data" ? <><p className="dashboard-explorer-scope-note">Saved report data includes released reviews. Unpublished observer drafts remain available through their original review workflow.</p><DashboardDataExplorer processKey="uco_tla_review" academicYear={academicYear} filters={{ academicYear, status: reviewStatus === "all" ? undefined : reviewStatus }} loadData={loadFormData} refreshKey={loadedDashboard?.revision} onOpenEntry={onOpenReview} /></> : <>

    <KpiStrip items={[
      access.canManage
        ? { label: "Annual coverage", value: dashboard ? `${dashboard.coveredUcoStaff}/${dashboard.activeUcoStaff} (${dashboard.coveragePercent}%)` : "—", tone: "blue" }
        : { label: "Reviews in my view", value: reviews.length, tone: "blue" },
      { label: "Reviews complete", value: completedReviews, tone: "green" },
      { label: "In progress", value: inProgressReviews, tone: "amber" },
      { label: "Follow-ups due", value: followUpsDue, tone: "amber" },
      { label: "Overdue actions", value: overdueActionCount, tone: "red" }
    ]} />

    <section className="uco-dashboard-grid" aria-label="UCO review dashboard">
      <article className="panel uco-dashboard-card uco-dashboard-progress-card">
        <header><div><p className="eyebrow">{academicYear || "Current year"}</p><h2>{access.canManage ? "Annual coverage" : "Review completion"}</h2><span>{access.canManage ? "Completed reviews across active UCO staff" : "Completed reviews available in your view"}</span></div><UsersRound size={20} /></header>
        <div className="uco-dashboard-progress-layout">
          <div className="uco-dashboard-ring" role="img" aria-label={`${headlineProgress}% ${access.canManage ? "annual coverage" : "review completion"}`} style={{ background: `conic-gradient(var(--teal) 0 ${headlineProgress}%, var(--surface-muted) ${headlineProgress}% 100%)` }}><span><strong>{headlineProgress}%</strong><small>{access.canManage ? "coverage" : "complete"}</small></span></div>
          <div className="uco-dashboard-progress-copy"><strong>{access.canManage ? `${dashboard?.coveredUcoStaff ?? 0} of ${dashboard?.activeUcoStaff ?? 0} staff covered` : `${completedReviews} of ${reviews.length} reviews complete`}</strong><p>Coverage means an authenticated review has reached final sign-off.</p></div>
        </div>
        <div className="uco-dashboard-mini-metrics"><div><span>Sections marked</span><strong>{sectionReadiness}%</strong></div><div><span>Next 30 days</span><strong>{upcomingObservations}</strong></div><div><span>Open actions</span><strong>{openActionCount}</strong></div></div>
      </article>

      <article className="panel uco-dashboard-card">
        <header><div><p className="eyebrow">Workflow</p><h2>Where reviews are now</h2><span>All stages in this academic year. Select a stage to filter the report; select it again to show all.</span></div><BarChart3 aria-hidden="true" size={20} /></header>
        <div className="uco-dashboard-workflow-bars">
          {workflowDistribution.map((item) => <button aria-pressed={reviewStatus === item.status} key={item.status} onClick={() => setReviewStatus(reviewStatus === item.status ? "all" : item.status)} type="button"><span><strong>{item.label}</strong><small>{item.detail}</small></span><div aria-hidden="true"><i className={`is-${item.tone}`} style={{ width: item.count ? `${Math.max(2, item.count * 100 / largestWorkflowCount)}%` : "0%" }} /></div><b>{item.count}</b></button>)}
        </div>
      </article>
    </section>

    <section className="uco-dashboard-grid uco-dashboard-grid-secondary">
      <article className="panel uco-dashboard-card">
        <header><div><p className="eyebrow">Attention</p><h2>What needs progressing</h2><span>Prioritised from overdue actions through to pending workflow steps.</span></div><AlertCircle size={20} /></header>
        <div className="uco-dashboard-attention-list">
          {attentionItems.length === 0 ? <div className="uco-dashboard-empty"><CheckCircle2 size={22} /><div><strong>Nothing currently needs attention</strong><span>Pending sign-offs, follow-ups and overdue actions will appear here.</span></div></div> : attentionItems.slice(0, 5).map(({ review, attention }) => {
            const AttentionIcon = attention.icon;
            return <button key={review.recordId} onClick={() => onOpenReview(review.recordId)} type="button"><span className={`uco-attention-icon is-${attention.tone}`}><AttentionIcon size={17} /></span><span><strong>{review.lecturerName}</strong><small>{attention.label} · {review.courseTitle || "Session details pending"}</small></span><time>{attention.dateLabel}</time><ArrowRight size={16} /></button>;
          })}
        </div>
        {attentionItems.length > 5 ? <p className="uco-dashboard-method-note">Showing the first 5 of {attentionItems.length} reviews needing attention. All reviews are available in the register below.</p> : null}
      </article>

      <article className="panel uco-dashboard-card">
        <header><div><p className="eyebrow">Qualitative evidence</p><h2>Practice highlights</h2><span>Recent good or excellent-practice narratives shared through the review process.</span></div><Sparkles size={20} /></header>
        <div className="uco-dashboard-highlight-list">
          {practiceHighlights.length === 0 ? <div className="uco-dashboard-empty"><BookOpenCheck size={22} /><div><strong>No shared highlights in this view</strong><span>Good-practice narratives appear after the observer sends a review to the lecturer.</span></div></div> : practiceHighlights.map((highlight) => <button key={`${highlight.recordId}-${highlight.category}`} onClick={() => onOpenReview(highlight.recordId)} type="button"><span>{highlight.category}</span><blockquote>{highlight.narrative}</blockquote><small>{highlight.lecturerName} · {highlight.courseTitle} / {highlight.moduleTitle}</small></button>)}
        </div>
        <p className="uco-dashboard-method-note"><ShieldCheck size={15} />Narrative evidence is shown as written. It is not scored, ranked or automatically interpreted.</p>
      </article>
    </section>

    <section className="panel">
      <div className="panel-heading"><div><h2>{access.canManage ? "UCO review register" : "Reviews in my view"}</h2><span>{filteredReviews.length} of {reviews.length} reviews in {academicYear || "the current academic year"}</span></div></div>
      <div className="filter-toolbar uco-dashboard-filter">
        <label className="search-box"><Search size={16} aria-hidden="true" /><input aria-label="Search UCO review register" onChange={(event) => { setReviewSearch(event.target.value); setPage(1); }} placeholder="Search people, sessions, dates or progress" value={reviewSearch} /></label>
        <label className="dashboard-explorer-filter"><span>Sort by</span><select aria-label="Sort UCO reviews by" value={sortBy} onChange={event => { setSortBy(event.target.value); setPage(1); }}>{[["lecturerName", "Lecturer"], ["observerName", "Observer"], ["title", "Review title"], ["courseTitle", "Course"], ["moduleTitle", "Module"], ["observationAt", "Observation date"], ["workflowStatus", "Workflow stage"], ["completedSectionCount", "Sections marked"], ["openActionCount", "Open actions"], ["overdueActionCount", "Overdue actions"], ["professionalDiscussionAt", "Discussion date"], ["followUpAt", "Follow-up date"], ["followUpStatus", "Follow-up status"]].map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="dashboard-explorer-filter"><span>Order</span><select aria-label="UCO review sort order" value={sortDirection} onChange={event => { setSortDirection(event.target.value as "asc" | "desc"); setPage(1); }}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label>
        <Button variant="secondary" onClick={() => { setLecturerFilter("all"); setObserverFilter("all"); setCourseFilter("all"); setModuleFilter("all"); setFollowUpFilter("all"); setReviewSearch(""); setPage(1); }}>Clear register filters</Button>
      </div>
      <details className="reporting-register-more"><summary>People and session filters{[lecturerFilter, observerFilter, courseFilter, moduleFilter, followUpFilter].filter(value => value !== "all").length ? <span className="reporting-filter-count">{[lecturerFilter, observerFilter, courseFilter, moduleFilter, followUpFilter].filter(value => value !== "all").length} active</span> : null}</summary><div className="filter-toolbar reporting-register-filters">
        {choiceSets.map(choice => <label className="dashboard-explorer-filter" key={choice.key}><span>{choice.label}</span><select aria-label={`UCO register ${choice.key}`} value={choice.value} onChange={event => { choice.change(event.target.value); setPage(1); }}><option value="all">All {choice.label.toLocaleLowerCase()} values</option>{choice.values.map(value => <option key={value} value={value}>{choice.key === "follow-up" ? humanStatus(value) : value}</option>)}{choice.value !== "all" && !choice.values.includes(choice.value) ? <option value={choice.value}>{choice.value} · no matching records</option> : null}</select></label>)}
      </div></details>
      <p className="dashboard-explorer-scope-note">These people, session and follow-up filters refine this register. Summary figures, form data and Excel use the academic year and workflow stage above. Choices include historical values from all permitted reviews.</p>
      <div className="uco-review-list">{filteredReviews.length === 0 ? <p className="muted-copy">No UCO TLA Reviews match this dashboard view.</p> : filteredReviews.slice((currentPage - 1) * 15, currentPage * 15).map((review) => <DashboardReviewRow key={review.recordId} review={review} onOpen={() => onOpenReview(review.recordId)} />)}</div>
      <Pagination page={currentPage} totalPages={totalPages} onPageChange={setPage} />
    </section>
    </>}
    </>}
  </>;
}

function DashboardReviewRow({ onOpen, review }: { onOpen: () => void; review: UcoTlaReviewSummary }) {
  return <button className="uco-review-row" onClick={onOpen} type="button"><span className={`status-pill status-${statusTone(review.workflowStatus)}`}>{humanStatus(review.workflowStatus)}</span><span><strong>{review.lecturerName}</strong><small>{sessionLabel(review.courseTitle, review.moduleTitle)}</small></span><span><strong>{formatDateTime(review.observationAt)}</strong><small>Observer: {review.observerName}</small></span><span><strong>{review.completedSectionCount}/7 sections marked</strong><small>{review.openActionCount} open · {review.overdueActionCount} overdue</small></span></button>;
}

function reviewAttention(review: UcoTlaReviewSummary, now: number) {
  if (review.overdueActionCount > 0) return { priority: 0, tone: "critical", label: `${review.overdueActionCount} overdue ${review.overdueActionCount === 1 ? "action" : "actions"}`, dateLabel: "Overdue", icon: AlertCircle };
  const followUpAt = review.followUpAt ? new Date(review.followUpAt).getTime() : undefined;
  if (review.followUpStatus === "scheduled" && followUpAt !== undefined && followUpAt <= now + 14 * 24 * 60 * 60 * 1000) return { priority: 1, tone: followUpAt < now ? "critical" : "warning", label: followUpAt < now ? "Follow-up overdue" : "Follow-up due soon", dateLabel: formatDateTime(review.followUpAt), icon: CalendarClock };
  if (review.workflowStatus === "awaiting_finalisation") return { priority: 2, tone: "warning", label: "Observer final sign-off required", dateLabel: formatDateTime(review.observationAt), icon: ClipboardCheck };
  if (review.workflowStatus === "awaiting_lecturer") return { priority: 3, tone: "info", label: "Discussion and lecturer reflection", dateLabel: formatDateTime(review.observationAt), icon: MessageSquareText };
  if (review.workflowStatus === "observer_draft" && !review.observationAt) return { priority: 4, tone: "info", label: "Session details need completing", dateLabel: "Unscheduled", icon: Eye };
  if (review.workflowStatus === "observer_draft" && review.observationAt && new Date(review.observationAt).getTime() < now) return { priority: 4, tone: "info", label: "Observer review in progress", dateLabel: formatDateTime(review.observationAt), icon: Eye };
  return null;
}

function formatDateTime(value?: string) {
  return value ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
}

function sortableDate(value?: string) {
  return value ? new Date(value).getTime() : Number.MAX_SAFE_INTEGER;
}

function sessionLabel(courseTitle?: string, moduleTitle?: string) {
  return courseTitle || moduleTitle ? [courseTitle, moduleTitle].filter(Boolean).join(" / ") : "Session details not yet provided";
}

function humanStatus(status: string) {
  return status.split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

function statusTone(status: string) {
  if (status === "completed") return "complete";
  if (status === "observer_draft") return "draft";
  return "submitted";
}
