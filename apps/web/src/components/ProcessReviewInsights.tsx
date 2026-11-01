import { DashboardBreakdown, DashboardMetricCard, DashboardProgressRing } from "./DashboardVisuals";
import { SkillsScanResultBar } from "./SkillsScanResultBar";
import type { ProcessReviewAction, ProcessReviewDetail, ProcessReviewSummary } from "../services/processReviewTypes";
import type { ProcessReviewReportQuery } from "../services/processReviewReporting";
import { activateSkillsPillarResults, digitalReviewCriteria, formatActivatePillarMean, processReviewCodeLabel } from "../services/processReviewReporting";
import { isOverdueReviewAction, processReviewInsightModel, type ProcessReviewExploration } from "../services/processReviewInsights";
import "./ProcessReviewInsights.css";

type Props = {
  digital: boolean; rows: ProcessReviewSummary[]; selectedRows: ProcessReviewSummary[]; actions: ProcessReviewAction[];
  query: ProcessReviewReportQuery; exploration: ProcessReviewExploration; today: string;
  detail: ProcessReviewDetail | null; selectedId: string; detailLoading: boolean;
  onQuery: (changes: Partial<ProcessReviewReportQuery>) => void;
  onExplore: (changes: Partial<ProcessReviewExploration>) => void;
  onInspect: (id: string) => void;
  onOpenAction: (action: ProcessReviewAction) => void;
};
const reviewScope = (review: Pick<ProcessReviewSummary, "facultyName" | "teamName" | "selectedSubTeams">) => [review.facultyName, review.teamName || review.selectedSubTeams?.map(team => team.name).join(", ")].filter(Boolean).join(" · ") || "Area not recorded";
const date = (value?: string | null) => value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "Date not recorded";

/** Exploration filters the named register; a selected review always uses its own saved framework. */
export function ProcessReviewInsights({ digital, rows, selectedRows, actions, query, exploration, today, detail, selectedId, detailLoading, onQuery, onExplore, onInspect, onOpenAction }: Props) {
  const model = processReviewInsightModel(rows, actions, today), selected = processReviewInsightModel(selectedRows, actions, today);
  const focused = selectedRows.find(review => review.recordId === selectedId);
  const pinned = focused && detail?.recordId === focused.recordId ? detail : null;
  const active = exploration.category || exploration.coverage || exploration.attention;
  const areaGroups = new Map<string, { key: string; label: string; value: number }>();
  const ownerGroups = new Map<string, { key: string; label: string; value: number }>();
  rows.forEach(review => { const key = review.facultyOrgUnitId || ""; if (!key) return; const group = areaGroups.get(key) || { key, label: review.facultyName || "Faculty / area", value: 0 }; group.value++; areaGroups.set(key, group); });
  rows.forEach(review => { const group = ownerGroups.get(review.ownerStaffId) || { key: review.ownerStaffId, label: review.ownerName, value: 0 }; group.value++; ownerGroups.set(review.ownerStaffId, group); });
  return <section className="process-insights" aria-label={digital ? "Digital Learning Walk insights" : "Activate+ review insights"}>
    <div className="process-insights-heading"><div><span className="process-insights-eyebrow">{digital ? "Digital practice" : "Growth journey"}</span><h3>{digital ? "From selected categories to completed walks" : "From review conversation to follow-through"}</h3><p className="muted-copy">Select a card or bar to explore the review register. Every review keeps its own identity and saved framework.</p></div>{active ? <button type="button" className="process-insights-reset" onClick={() => onExplore({ category: "", coverage: "", attention: false })}>Clear visual selection</button> : null}</div>
    <div className="dashboard-visual-metrics">
      <DashboardMetricCard label="Reviews in view" value={selected.total} detail={`${model.total} match the search and form filters`} onSelect={() => { onQuery({ status: "", reviewKind: "" }); onExplore({ category: "", coverage: "", attention: false }); }} />
      <DashboardMetricCard label="Submitted reviews" value={selected.submitted} detail="Formally submitted records" tone="green" active={query.status === "submitted"} onSelect={() => onQuery({ status: query.status === "submitted" ? "" : "submitted" })} />
      <DashboardMetricCard label="Draft reviews" value={selected.drafts} detail="Kept separate from submitted records" tone="blue" active={query.status === "draft"} onSelect={() => onQuery({ status: query.status === "draft" ? "" : "draft" })} />
      <DashboardMetricCard label="Reviews needing attention" value={selected.attention.length} detail={`${selected.overdueActions.length} overdue linked actions`} tone="amber" active={exploration.attention} onSelect={() => onExplore({ attention: !exploration.attention })} />
    </div>
    <div className="process-insights-grid">
      <article className="process-insights-card process-insights-coverage"><div><h4>{digital ? "Selected criteria coverage" : "Skills Scan entry coverage"}</h4><p className="muted-copy">{digital ? "Only criteria included in each saved walk count towards coverage. This measures completion, not practice quality." : "Counts entered sub-area results, not performance. Follow-up reviews can proceed without a new scan."}</p></div>
        <DashboardProgressRing value={digital ? selected.ratingCoverage : selected.total ? selected.completeScans * 100 / selected.total : null} label={digital ? "Included criteria rated" : "Reviews with 15 results"} detail={digital ? `${selected.ratedCriteria} / ${selected.selectedCriteria} criteria` : `${selected.completeScans} / ${selected.total} reviews`} />
        <DashboardBreakdown items={digital ? [
          { key: "complete", label: "All included criteria rated", value: model.fullRatingReviews, tone: "green" },
          { key: "partial", label: "Selection or ratings incomplete", value: model.total - model.fullRatingReviews, tone: "amber" }
        ] : [
          { key: "complete", label: "15 sub-area results entered", value: model.completeScans, tone: "green", detail: "Includes drafts; results remain identified by stage" },
          { key: "partial", label: "Fewer than 15 results entered", value: model.partialScans, tone: "amber", detail: "Includes follow-ups without a new scan" },
          { key: "earlier", label: "Earlier workflow", value: model.earlierScans, tone: "blue", detail: "No Skills Scan result set on the original form" }
        ]} activeKey={exploration.coverage} onSelect={key => onExplore({ coverage: exploration.coverage === key ? "" : key })} />
      </article>
      <article className="process-insights-card"><h4>{digital ? "Category reach" : "Initial and follow-up reviews"}</h4><p className="muted-copy">{digital ? "Each bar counts reviews including this category. A walk can include several categories; bar totals are not unique review totals." : "Each meeting is one record. Follow-ups retain their link to the initial review and shared actions."}</p>
        <DashboardBreakdown items={digital ? model.categories.map(category => ({ ...category, detail: `${category.included} criteria included${category.partial ? ` · ${category.partial} earlier partial selections` : ""}` })) : [
          { key: "initial", label: "Initial reviews", value: model.initial, detail: "Review scope, participants and starting results", tone: "teal" },
          { key: "follow_up", label: "Follow-up reviews", value: model.followUp, detail: "Linked meetings and action review", tone: "violet" }
        ]} activeKey={digital ? exploration.category : query.reviewKind} onSelect={key => digital ? onExplore({ category: exploration.category === key ? "" : key }) : onQuery({ reviewKind: query.reviewKind === key ? "" : key })} emptyMessage="No saved category selections in this scope." />
        {digital && model.unknownCategoryReviews ? <p className="muted-copy">{model.unknownCategoryReviews} reviews have no saved category breakdown; their categories have not been inferred.</p> : null}
      </article>
      <article className="process-insights-card"><h4>Review reach by area</h4><p className="muted-copy">Explore a named area or review owner. Participant and sub-team filters above narrow the register further.</p><DashboardBreakdown items={[...areaGroups.values()].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))} activeKey={query.faculty} onSelect={key => onQuery({ faculty: query.faculty === key ? "" : key })} emptyMessage="No named areas in this scope." /><h4 className="process-insights-subheading">Review owners</h4><DashboardBreakdown items={[...ownerGroups.values()].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))} activeKey={query.owner} onSelect={key => onQuery({ owner: query.owner === key ? "" : key })} emptyMessage="No review owners in this scope." /></article>
      <article className="process-insights-card process-insights-attention"><h4>Next to review</h4><p className="muted-copy">Prioritised by overdue actions, then unfinished drafts. Open a named review to see its full context.</p>{selected.attention.length ? <ol>{selected.attention.slice(0, 5).map(({ review, reasons }) => <li key={review.recordId}><button type="button" aria-pressed={selectedId === review.recordId} onClick={() => onInspect(review.recordId)}><strong>{review.title}</strong><span>{reviewScope(review)} · {review.ownerName}</span><small>{reasons.join(" · ")}</small></button></li>)}</ol> : <p className="process-insights-empty">No outstanding review cues in this selection.</p>}
        {selected.overdueActions.slice(0, 3).map(action => <button className="process-insights-action" key={action.actionId} type="button" onClick={() => onOpenAction(action)}><span><strong>{action.title}</strong><small>{action.ownerName} · {action.recordTitle}</small></span><b>Due {date(action.reviewDate || action.dueDate)}</b></button>)}
        <p className="muted-copy">{selected.openActions.length} open linked actions · {selected.actions.length} unique actions. Actions shared across reviews are counted once.</p>
      </article>
    </div>
    <article className="process-insights-card process-insights-review-focus"><div className="process-insights-heading"><div><h4>{digital ? "Explore one walk’s ratings" : "Explore one review’s Skills Scan"}</h4><p className="muted-copy">{digital ? "Ratings use the scale saved with that walk. Different historical scales are kept separate." : "Pillar and sub-area results stay with their own review. No average is calculated across teams or meetings."}</p></div><label className="entry-field"><span>Select a named review</span><select value={focused?.recordId || ""} onChange={event => { if (event.target.value) onInspect(event.target.value); }}><option value="">Choose a review…</option>{selectedRows.map(review => <option key={review.recordId} value={review.recordId}>{review.title} · {review.ownerName} · {processReviewCodeLabel(review.status)}</option>)}</select></label></div>
      {detailLoading && focused ? <p role="status" className="muted-copy">Loading this review’s saved results…</p> : pinned ? <>
        <div className="process-insights-review-context"><strong>{pinned.title}</strong><span>{reviewScope(pinned)} · {pinned.ownerName} · {processReviewCodeLabel(pinned.status)}</span>{!digital ? <span>{pinned.participants?.map(person => person.displayName).join(" · ") || "Participants not recorded"}</span> : null}</div>
        {digital ? <PinnedWalkResults detail={pinned} /> : <PinnedScanResults detail={pinned} />}
      </> : <p className="process-insights-empty">Choose a review to see its saved results. Full form answers and action history open below the register.</p>}
    </article>
    <p className="muted-copy process-insights-scope" role="status">Visual selection: {selectedRows.length} named reviews in the register. Excel keeps the full permitted academic-year scope, including when a visual selection is active.</p>
  </section>;
}

function PinnedWalkResults({ detail }: { detail: ProcessReviewDetail }) {
  const criteria = digitalReviewCriteria(detail.configuration, detail.data).flatMap(standard => standard.statements), keys = new Set(criteria.map(statement => statement.key));
  const responses = [...new Map(detail.data.responses.filter(response => keys.has(response.statementKey)).map(response => [response.statementKey, response])).values()];
  const options = detail.configuration.ratingOptions;
  const rated = responses.filter(response => options.some(option => option.key === response.ratingKey)).length;
  return <div className="process-insights-pinned-walk"><div><h5>Saved rating distribution</h5><DashboardBreakdown items={[...options.map(option => ({ key: option.key, label: option.label, value: responses.filter(response => response.ratingKey === option.key).length, detail: option.score == null ? "Saved rating label" : `Saved scale value ${option.score}` })), { key: "__unrated", label: "Not rated", value: Math.max(0, criteria.length - rated), tone: "amber" }]} /><p className="muted-copy">{detail.status === "draft" ? "Draft ratings for checking. " : ""}{rated} / {criteria.length} included criteria rated. No overall practice average is calculated.</p></div><div><h5>Included criteria by category</h5>{digitalReviewCriteria(detail.configuration, detail.data).map(category => <details key={category.key}><summary>{category.title} · {category.statements.length} criteria</summary><ul>{category.statements.map(statement => <li key={statement.key}><span>{statement.text}</span><strong>{options.find(option => option.key === responses.find(response => response.statementKey === statement.key)?.ratingKey)?.label || "Not rated"}</strong></li>)}</ul></details>)}</div></div>;
}

function PinnedScanResults({ detail }: { detail: ProcessReviewDetail }) {
  const scores = detail.data.activate?.skillsScanScores;
  if (!scores) return <p className="muted-copy">This earlier workflow has no Skills Scan results. Its original answers remain in the detail below.</p>;
  const pillars = activateSkillsPillarResults(detail.configuration.skillsScanPillars ?? [], scores, detail.status === "submitted");
  return <><p className="muted-copy">1–5 manual sub-area averages. A pillar mean requires every sub-area and a submitted review; missing results are not zero.{detail.isFollowUp ? " These are this follow-up’s new results, if collected; earlier results remain on the previous review." : ""}</p>
    {detail.status === "draft" ? <p className="record-context-note">Draft results are available for checking; pillar means are withheld.</p> : null}
    <div className="process-insights-pillar-grid">{pillars.map(pillar => <article key={pillar.key}><h5>{pillar.title}</h5><strong className="process-insights-pillar-value">{pillar.mean == null ? detail.status === "draft" ? "Draft" : "Awaiting results" : `${formatActivatePillarMean(pillar.mean)} / 5`}</strong>{pillar.mean == null ? <div className="process-insights-pending" /> : <SkillsScanResultBar value={pillar.mean} label={`${pillar.title}: ${formatActivatePillarMean(pillar.mean)} out of 5`} />}<details><summary>{pillar.enteredCount} / {pillar.subAreas.length} sub-area results</summary><dl>{pillar.subAreas.map(area => <div key={area.key}><dt>{area.title}</dt><dd>{area.score ?? "Not recorded"}</dd></div>)}</dl></details></article>)}</div>
    {!pillars.length ? <p className="muted-copy">No Skills Scan framework is saved with this review.</p> : null}
  </>;
}

export function ProcessActionInsights({ rows, digital, today, query, exploration, onQuery, onExplore, onOpen }: {
  rows: ProcessReviewAction[]; digital: boolean; today: string; query: ProcessReviewReportQuery; exploration: ProcessReviewExploration;
  onQuery: (changes: Partial<ProcessReviewReportQuery>) => void; onExplore: (changes: Partial<ProcessReviewExploration>) => void; onOpen: (action: ProcessReviewAction) => void;
}) {
  const breakdown = (field: "progress" | "impactStatus") => [...new Set(rows.map(row => row[field]))].sort().map(key => ({ key, label: processReviewCodeLabel(key), value: rows.filter(row => row[field] === key).length }));
  const overdue = rows.filter(action => isOverdueReviewAction(action, today)).sort((a, b) => (a.reviewDate || a.dueDate).localeCompare(b.reviewDate || b.dueDate));
  return <section className="process-insights" aria-label="Linked action insights"><div className="dashboard-visual-metrics">
    <DashboardMetricCard label="Actions in view" value={rows.length} detail="One record per linked action" onSelect={() => { onQuery({ status: "" }); onExplore({ actionImpact: "", actionOverdue: false }); }} />
    <DashboardMetricCard label="Activity completed" value={rows.filter(action => action.progress === "complete").length} tone="green" active={query.status === "complete"} onSelect={() => onQuery({ status: query.status === "complete" ? "" : "complete" })} />
    <DashboardMetricCard label="Impact demonstrated" value={rows.filter(action => action.impactStatus === "demonstrated").length} tone="violet" active={exploration.actionImpact === "demonstrated"} onSelect={() => onExplore({ actionImpact: exploration.actionImpact === "demonstrated" ? "" : "demonstrated" })} />
    <DashboardMetricCard label={digital ? "Overdue implementation" : "Overdue action reviews"} value={overdue.length} tone="amber" active={exploration.actionOverdue} onSelect={() => onExplore({ actionOverdue: !exploration.actionOverdue })} />
  </div><div className="process-insights-grid"><article className="process-insights-card"><h4>Activity progress</h4><DashboardBreakdown items={breakdown("progress")} activeKey={query.status} onSelect={key => onQuery({ status: query.status === key ? "" : key })} /><h4>Impact assessment</h4><p className="muted-copy">Completion and demonstrated impact are separate measures.</p><DashboardBreakdown items={breakdown("impactStatus")} activeKey={exploration.actionImpact} onSelect={key => onExplore({ actionImpact: exploration.actionImpact === key ? "" : key })} /></article>
    <article className="process-insights-card process-insights-attention"><h4>{digital ? "Implementation due" : "Action review due"}</h4><p className="muted-copy">Open a named action with its original review and responsible person.</p>{overdue.slice(0, 5).map(action => <button type="button" className="process-insights-action" key={action.actionId} onClick={() => onOpen(action)}><span><strong>{action.title}</strong><small>{action.recordTitle} · {action.responsibleStaff?.map(person => person.displayName).join(", ") || action.ownerName}</small><small>{digital ? processReviewCodeLabel(action.themeKey) : action.impactAreaLabel || "Impact area not recorded"}</small></span><b>{date(action.reviewDate || action.dueDate)}</b></button>)}{!overdue.length ? <p className="process-insights-empty">No overdue actions in this selection.</p> : null}</article></div>
    {exploration.actionImpact || exploration.actionOverdue ? <button type="button" className="process-insights-reset" onClick={() => onExplore({ actionImpact: "", actionOverdue: false })}>Clear action visual selection</button> : null}<p className="muted-copy">Visual selections filter the action register. Excel continues to export the full permitted academic year.</p></section>;
}
