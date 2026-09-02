import { useEffect, useState } from "react";
import { AlertCircle, ArrowRight, BarChart3, BookOpenCheck, CalendarClock, CheckCircle2, ClipboardCheck, Eye, MessageSquareText, RefreshCw, Search, ShieldCheck, Sparkles, UsersRound } from "lucide-react";
import { ExportExcelButton } from "../components/ExportButtons";
import { KpiStrip } from "../components/KpiStrip";
import { Button } from "../design-system/Button";
import { api } from "../services/api";
import type { UcoTlaAccessSummary, UcoTlaDashboardSummary, UcoTlaReviewSummary } from "../services/types";

type Props = {
  access: UcoTlaAccessSummary;
  academicYear: string;
  onOpenReview: (recordId: string) => void;
};

export function UcoTlaDashboard({ access, academicYear, onOpenReview }: Props) {
  const [dashboard, setDashboard] = useState<UcoTlaDashboardSummary | null>(null);
  const [reviewSearch, setReviewSearch] = useState("");
  const [reviewStatus, setReviewStatus] = useState("all");
  const [error, setError] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);

  async function refresh() {
    setIsRefreshing(true);
    setError("");
    try {
      setDashboard(await api.ucoTlaDashboard(academicYear));
    } catch {
      setError("The UCO TLA dashboard could not be loaded.");
    } finally {
      setIsRefreshing(false);
    }
  }

  useEffect(() => { void refresh(); }, [academicYear]);

  const reviews = dashboard?.reviews ?? [];
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
  ].map((item) => ({ ...item, count: reviews.filter((review) => review.workflowStatus === item.status).length }));
  const largestWorkflowCount = Math.max(1, ...workflowDistribution.map((item) => item.count));
  const now = Date.now();
  const upcomingObservations = reviews.filter((review) => {
    if (!review.observationAt) return false;
    const observation = new Date(review.observationAt).getTime();
    return observation >= now && observation <= now + 30 * 24 * 60 * 60 * 1000;
  }).length;
  const attentionItems = reviews.flatMap((review) => {
    const attention = reviewAttention(review, now);
    return attention ? [{ review, attention }] : [];
  }).sort((left, right) => left.attention.priority - right.attention.priority || sortableDate(left.review.observationAt) - sortableDate(right.review.observationAt));
  const query = reviewSearch.trim().toLowerCase();
  const filteredReviews = reviews.filter((review) =>
    (reviewStatus === "all" || review.workflowStatus === reviewStatus)
    && (!query || `${review.lecturerName} ${review.observerName} ${review.courseTitle} ${review.moduleTitle}`.toLowerCase().includes(query))
  );

  return <>
    <header className="intelligence-header">
      <div><p className="eyebrow">University Centre Oldham · {academicYear}</p><h1>Teaching, Learning and Assessment Reviews</h1><p>Workflow oversight and qualitative practice evidence. No teaching rating or score is calculated.</p></div>
      <div className="intelligence-header-actions">{access.canExport ? <ExportExcelButton filters={{ academicYear }} moduleKey="uco-tla-reviews" /> : null}<Button disabled={isRefreshing} icon={RefreshCw} onClick={() => void refresh()}>{isRefreshing ? "Refreshing" : "Refresh"}</Button></div>
    </header>

    {error ? <div className="intelligence-warning"><AlertCircle size={16} />{error}</div> : null}

    <KpiStrip items={[
      access.canManage
        ? { label: "Annual coverage", value: dashboard ? `${dashboard.coveredUcoStaff}/${dashboard.activeUcoStaff} (${dashboard.coveragePercent}%)` : "—", tone: "blue" }
        : { label: "Reviews in my view", value: reviews.length, tone: "blue" },
      { label: "Reviews complete", value: completedReviews, tone: "green" },
      { label: "In progress", value: inProgressReviews, tone: "amber" },
      { label: "Follow-ups due", value: dashboard?.followUpsDue ?? 0, tone: "amber" },
      { label: "Overdue actions", value: dashboard?.overdueActions ?? 0, tone: "red" }
    ]} />

    <section className="uco-dashboard-grid" aria-label="UCO review dashboard">
      <article className="panel uco-dashboard-card uco-dashboard-progress-card">
        <header><div><p className="eyebrow">{academicYear || "Current year"}</p><h2>{access.canManage ? "Annual coverage" : "Review completion"}</h2><span>{access.canManage ? "Completed reviews across active UCO staff" : "Completed reviews available in your view"}</span></div><UsersRound size={20} /></header>
        <div className="uco-dashboard-progress-layout">
          <div className="uco-dashboard-ring" role="img" aria-label={`${headlineProgress}% ${access.canManage ? "annual coverage" : "review completion"}`} style={{ background: `conic-gradient(var(--teal) 0 ${headlineProgress}%, var(--surface-muted) ${headlineProgress}% 100%)` }}><span><strong>{headlineProgress}%</strong><small>{access.canManage ? "coverage" : "complete"}</small></span></div>
          <div className="uco-dashboard-progress-copy"><strong>{access.canManage ? `${dashboard?.coveredUcoStaff ?? 0} of ${dashboard?.activeUcoStaff ?? 0} staff covered` : `${completedReviews} of ${reviews.length} reviews complete`}</strong><p>Coverage means an authenticated review has reached final sign-off.</p></div>
        </div>
        <div className="uco-dashboard-mini-metrics"><div><span>Sections marked</span><strong>{sectionReadiness}%</strong></div><div><span>Next 30 days</span><strong>{upcomingObservations}</strong></div><div><span>Open actions</span><strong>{dashboard?.openActions ?? 0}</strong></div></div>
      </article>

      <article className="panel uco-dashboard-card">
        <header><div><p className="eyebrow">Workflow</p><h2>Where reviews are now</h2><span>Select a stage to filter the register below.</span></div><BarChart3 size={20} /></header>
        <div className="uco-dashboard-workflow-bars">
          {workflowDistribution.map((item) => <button key={item.status} onClick={() => setReviewStatus(item.status)} type="button"><span><strong>{item.label}</strong><small>{item.detail}</small></span><div><i className={`is-${item.tone}`} style={{ width: item.count ? `${Math.max(8, item.count * 100 / largestWorkflowCount)}%` : "0%" }} /></div><b>{item.count}</b></button>)}
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
      </article>

      <article className="panel uco-dashboard-card">
        <header><div><p className="eyebrow">Qualitative evidence</p><h2>Practice highlights</h2><span>Recent good or excellent-practice narratives shared through the review process.</span></div><Sparkles size={20} /></header>
        <div className="uco-dashboard-highlight-list">
          {(dashboard?.practiceHighlights ?? []).length === 0 ? <div className="uco-dashboard-empty"><BookOpenCheck size={22} /><div><strong>No shared highlights yet</strong><span>Good-practice narratives appear after the observer sends a review to the lecturer.</span></div></div> : dashboard!.practiceHighlights.map((highlight) => <button key={`${highlight.recordId}-${highlight.category}`} onClick={() => onOpenReview(highlight.recordId)} type="button"><span>{highlight.category}</span><blockquote>{highlight.narrative}</blockquote><small>{highlight.lecturerName} · {highlight.courseTitle} / {highlight.moduleTitle}</small></button>)}
        </div>
        <p className="uco-dashboard-method-note"><ShieldCheck size={15} />Narrative evidence is shown as written. It is not scored, ranked or automatically interpreted.</p>
      </article>
    </section>

    <section className="panel">
      <div className="panel-heading"><div><h2>{access.canManage ? "UCO review register" : "Reviews in my view"}</h2><span>{filteredReviews.length} of {reviews.length} reviews in {academicYear || "the current academic year"}</span></div></div>
      <div className="filter-toolbar uco-dashboard-filter">
        <label className="search-box"><Search size={16} aria-hidden="true" /><input onChange={(event) => setReviewSearch(event.target.value)} placeholder="Search lecturer, observer, course or module" value={reviewSearch} /></label>
        <label><span>Workflow stage</span><select onChange={(event) => setReviewStatus(event.target.value)} value={reviewStatus}><option value="all">All stages</option><option value="observer_draft">Observer review</option><option value="awaiting_lecturer">With lecturer</option><option value="awaiting_finalisation">Final sign-off</option><option value="completed">Complete</option></select></label>
      </div>
      <div className="uco-review-list">{filteredReviews.length === 0 ? <p className="muted-copy">No UCO TLA Reviews match this dashboard view.</p> : filteredReviews.map((review) => <DashboardReviewRow key={review.recordId} review={review} onOpen={() => onOpenReview(review.recordId)} />)}</div>
    </section>
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
