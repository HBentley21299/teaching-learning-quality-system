import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, RotateCcw, Search } from "lucide-react";
import { Button } from "../design-system/Button";
import { qaCombinedOutcomeLabel, useQaOutcomeLabels } from "../services/qaOutcomeLabels";
import { emptyQaDashboardExploration, filterQaDashboardCriteria, qaCriteriaTotals, qaCriterionKey, qaCriterionTheme, qaOutcomeCount, qaRatedPercentage, qaThemeBreakdown } from "../services/qaDashboardExploration";
import type { QaCriterionOutcome, QaCriterionSort, QaDashboardExploration } from "../services/qaDashboardExploration";
import type { QaDashboardQuestionBreakdown, QaDashboardSummary } from "../services/types";
import { DashboardBreakdown, DashboardMetricCard, DashboardProgressRing } from "./DashboardVisuals";
import "./QaReviewIntelligence.css";

type Props = {
  dashboard: QaDashboardSummary;
  scopeKey: string;
  selectedTeamId: string;
  teamOptions: { id: string; name: string }[];
  onSelectTeam: (teamId: string) => void;
  onOpenFormData?: () => void;
};

const dateLabel = (date: string) => new Date(`${date.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function QaReviewIntelligence({ dashboard, scopeKey, selectedTeamId, teamOptions, onSelectTeam, onOpenFormData }: Props) {
  const labels = useQaOutcomeLabels();
  const [exploration, setExploration] = useState<QaDashboardExploration>({ ...emptyQaDashboardExploration });
  const [shown, setShown] = useState(12);
  const [selectedDay, setSelectedDay] = useState("");
  const register = useRef<HTMLElement>(null);
  useEffect(() => { setExploration({ ...emptyQaDashboardExploration }); setSelectedDay(""); setShown(12); }, [scopeKey]);
  const questions = useMemo(() => filterQaDashboardCriteria(dashboard.questions, exploration), [dashboard.questions, exploration]);
  const totals = useMemo(() => qaCriteriaTotals(questions), [questions]);
  const processQuestions = useMemo(() => dashboard.questions.filter(question => exploration.process === "all" || question.activityKey === exploration.process), [dashboard.questions, exploration.process]);
  const themes = useMemo(() => qaThemeBreakdown(processQuestions), [processQuestions]);
  const attention = useMemo(() => filterQaDashboardCriteria(processQuestions, { ...emptyQaDashboardExploration, sort: "attention" }).filter(question => question.below > 0).slice(0, 3), [processQuestions]);
  const strengths = useMemo(() => filterQaDashboardCriteria(processQuestions, { ...emptyQaDashboardExploration, sort: "strength" }).filter(question => question.at + question.above > 0).slice(0, 3), [processQuestions]);
  const outcomeChoices: { key: QaCriterionOutcome; label: string; count: number; tone: "red" | "teal" | "green" | "blue" | "violet" }[] = [
    { key: "below", label: labels.below, count: dashboard.belowCount, tone: "red" },
    { key: "at", label: labels.at, count: dashboard.atCount, tone: "teal" },
    { key: "above", label: labels.above, count: dashboard.aboveCount, tone: "green" },
    { key: "not_seen", label: "Not seen", count: dashboard.notSeenCount ?? 0, tone: "blue" },
    { key: "not_applicable", label: labels.notApplicable, count: dashboard.notApplicableCount, tone: "violet" }
  ];
  const active = exploration.process !== "all" || exploration.theme !== "all" || exploration.outcome !== "all" || exploration.criterion !== "all" || exploration.search !== "";
  const selectedCriterion = dashboard.questions.find(question => qaCriterionKey(question) === exploration.criterion);
  const day = dashboard.timeline.find(point => point.date === selectedDay);
  const maximumActivity = Math.max(1, ...dashboard.timeline.map(point => point.evidenceCount));
  function update(next: Partial<QaDashboardExploration>) { setExploration(previous => ({ ...previous, ...next })); setShown(12); }
  function selectCriterion(question: QaDashboardQuestionBreakdown) {
    update({ process: question.activityKey, theme: "all", outcome: "all", search: "", criterion: exploration.criterion === qaCriterionKey(question) ? "all" : qaCriterionKey(question) });
    register.current?.focus({ preventScroll: true });
    register.current?.scrollIntoView({ block: "start", behavior: "auto" });
  }
  return <div className="route-stack qa-intelligence">
    <section className="dashboard-visual-metrics" aria-label="Submitted review totals">
      <DashboardMetricCard label="Submissions" value={dashboard.evidenceCount} detail="Submitted forms in reporting scope" />
      <DashboardMetricCard label="Rated responses" value={dashboard.ratedCount} detail="Below, at and above outcomes" tone="blue" />
      <DashboardMetricCard label="Teams with evidence" value={dashboard.teamCount} detail={`${dashboard.facultyCount} ${dashboard.facultyCount === 1 ? "faculty" : "faculties"} · ${dashboard.courseCount} ${dashboard.courseCount === 1 ? "course" : "courses"}`} tone="violet" />
      <DashboardMetricCard label="Open linked actions" value={dashboard.openActionCount} detail={`${dashboard.linkedActionCount} linked actions in total`} tone="amber" />
    </section>
    <section className="panel qa-intelligence-overview">
      <div className="section-heading"><div><p className="eyebrow">QA review intelligence</p><h2>Explore the findings</h2><p>Select a process, outcome or theme to explore its criteria. Reporting totals above stay tied to the faculty and team filters.</p></div>{dashboard.snapshotVersion ? <span className="status-pill">Closure snapshot {dashboard.snapshotVersion}</span> : null}</div>
      <div className="qa-intelligence-outcomes" aria-label="Find criteria by recorded outcome">
        {outcomeChoices.map(outcome => <DashboardMetricCard key={outcome.key} label={outcome.label} value={outcome.count} detail="Responses in reporting scope" tone={outcome.tone} active={exploration.outcome === outcome.key} onSelect={() => update({ outcome: exploration.outcome === outcome.key ? "all" : outcome.key, criterion: "all" })} />)}
      </div>
      <div className="qa-intelligence-context"><p>Submitted evidence only. Not seen and {labels.notApplicable} are separate from rated percentages. Outcome selections find criteria containing that outcome; the mix shows all responses to those criteria.</p>{onOpenFormData ? <Button icon={ArrowRight} onClick={onOpenFormData}>Open submitted form data</Button> : null}</div>
    </section>
    <div className="qa-intelligence-two-column">
      <section className="panel"><div className="section-heading"><div><p className="eyebrow">Process lens</p><h2>Where findings come from</h2><p>Select a process to focus the criteria and theme breakdown.</p></div></div>
        <DashboardBreakdown activeKey={exploration.process} onSelect={key => update({ process: exploration.process === key ? "all" : key, theme: "all", criterion: "all" })} items={dashboard.byActivity.map(process => ({ key: process.key, label: process.label, value: process.rated, detail: `${process.below} ${labels.below} · ${process.notSeen ?? 0} Not seen · ${process.notApplicable} ${labels.notApplicable}`, tone: process.below > 0 ? "amber" : "teal" }))} emptyMessage="No QA processes are configured for this review." />
        <p className="qa-intelligence-note">Bars show counts of rated criterion responses.</p>
      </section>
      <section className="panel"><div className="section-heading"><div><p className="eyebrow">Theme lens</p><h2>Patterns across criteria</h2><p>Themes follow the selected process. Select one to narrow the criterion register.</p></div></div>
        <DashboardBreakdown activeKey={exploration.theme} onSelect={key => update({ theme: exploration.theme === key ? "all" : key, criterion: "all" })} items={themes.map(theme => ({ key: theme.key, label: theme.label, value: theme.rated, detail: `${theme.criteria} ${theme.criteria === 1 ? "criterion" : "criteria"} · ${theme.below} ${labels.below} · ${theme.notSeen} Not seen · ${theme.notApplicable} ${labels.notApplicable}`, tone: theme.below > 0 ? "amber" : "teal" }))} emptyMessage="No criteria are configured for this process." />
      </section>
    </div>
    <section className="panel qa-intelligence-explorer" aria-label="Criterion exploration" ref={register} tabIndex={-1}>
      <div className="section-heading"><div><p className="eyebrow">Linked criterion register</p><h2>From pattern to detail</h2><p>Search, sort and expand each criterion to inspect its complete outcome distribution.</p></div><Button icon={RotateCcw} disabled={!active && exploration.sort === "attention"} onClick={() => { setExploration({ ...emptyQaDashboardExploration }); setShown(12); }}>Reset exploration</Button></div>
      <div className="qa-intelligence-controls">
        <label><span>Search criteria</span><div className="qa-intelligence-search"><Search size={16} aria-hidden="true" /><input aria-label="Search QA dashboard criteria" placeholder="Question, process or theme" value={exploration.search} onChange={event => update({ search: event.target.value, criterion: "all" })} /></div></label>
        <label><span>Process</span><select aria-label="QA criterion process" value={exploration.process} onChange={event => update({ process: event.target.value, theme: "all", criterion: "all" })}><option value="all">All processes</option>{dashboard.byActivity.map(process => <option key={process.key} value={process.key}>{process.label}</option>)}</select></label>
        <label><span>Theme</span><select aria-label="QA criterion theme" value={exploration.theme} onChange={event => update({ theme: event.target.value, criterion: "all" })}><option value="all">All themes</option>{themes.map(theme => <option key={theme.key} value={theme.key}>{theme.label}</option>)}</select></label>
        <label><span>Recorded outcome</span><select aria-label="QA criterion recorded outcome" value={exploration.outcome} onChange={event => update({ outcome: event.target.value as QaCriterionOutcome, criterion: "all" })}><option value="all">All outcomes</option>{outcomeChoices.map(outcome => <option key={outcome.key} value={outcome.key}>{outcome.label}</option>)}</select></label>
        <label><span>Sort by</span><select aria-label="Sort QA dashboard criteria" value={exploration.sort} onChange={event => update({ sort: event.target.value as QaCriterionSort })}><option value="attention">Most {labels.below} responses</option><option value="strength">Most {qaCombinedOutcomeLabel(labels)} responses</option><option value="responses">Most rated responses</option><option value="question">Question A–Z</option></select></label>
      </div>
      {selectedCriterion ? <button className="qa-intelligence-selection" onClick={() => update({ criterion: "all" })} type="button">Selected criterion: {selectedCriterion.questionText} <span>Clear selection ×</span></button> : null}
      <div className="qa-intelligence-selection-summary">
        <DashboardProgressRing value={totals.atOrAbovePercentage} label={qaCombinedOutcomeLabel(labels)} detail={`${totals.at + totals.above} of ${totals.rated} rated responses`} />
        <div><p className="eyebrow">All responses for matching criteria</p><h3 aria-live="polite">{questions.length} of {dashboard.questions.length} criteria shown</h3><p>{totals.rated} rated responses · {totals.notSeen} Not seen · {totals.notApplicable} {labels.notApplicable}</p><QaOutcomeMix question={totals} label="Matching criteria" /><p className="qa-intelligence-note">Percentages show rated criterion responses across the current selection. — means no rated responses.</p></div>
      </div>
      <div className="qa-intelligence-criteria">
        {questions.slice(0, shown).map(question => <details key={qaCriterionKey(question)} className="qa-intelligence-criterion" open={exploration.criterion === qaCriterionKey(question) || undefined}>
          <summary><span><small>{question.activityLabel} · {qaCriterionTheme(question)}</small><strong>{question.questionText}</strong></span><span className="qa-intelligence-criterion-count">{exploration.outcome === "all" ? `${question.rated} rated` : `${qaOutcomeCount(question, exploration.outcome)} ${outcomeChoices.find(outcome => outcome.key === exploration.outcome)?.label}`}<small>Expand distribution</small></span></summary>
          <div className="qa-intelligence-criterion-detail"><QaOutcomeMix question={question} label={question.questionText} /><div className="qa-intelligence-counts">{outcomeChoices.map(outcome => <span key={outcome.key}><small>{outcome.label}</small><strong>{qaOutcomeCount(question, outcome.key)}</strong>{outcome.key === "below" || outcome.key === "at" || outcome.key === "above" ? <em>{qaRatedPercentage(qaOutcomeCount(question, outcome.key), question.rated) === null ? "—" : `${qaRatedPercentage(qaOutcomeCount(question, outcome.key), question.rated)}% of rated`}</em> : <em>Excluded from rated %</em>}</span>)}</div></div>
        </details>)}
        {!questions.length ? <p className="qa-intelligence-empty">No criteria match this selection. Reset exploration or change the filters.</p> : null}
      </div>
      {questions.length > shown ? <Button onClick={() => setShown(previous => previous + 12)}>Show more criteria ({questions.length - shown} remaining)</Button> : null}
      <p className="qa-intelligence-note">Excel and PDF use the faculty and team reporting filters above. Form data shows all submitted forms in that reporting scope.</p>
    </section>
    <div className="qa-intelligence-two-column">
      <QaCriterionHighlights title="Criteria needing attention" description={`Highest number of ${labels.below} responses, then proportion. Select a criterion to inspect its full mix.`} questions={attention} kind="attention" selectedKey={exploration.criterion} onSelect={selectCriterion} />
      <QaCriterionHighlights title="Strongest recorded practice" description={`Highest number of ${qaCombinedOutcomeLabel(labels)} responses, then proportion. Select a criterion to inspect its full mix.`} questions={strengths} kind="strength" selectedKey={exploration.criterion} onSelect={selectCriterion} />
    </div>
    <div className="qa-intelligence-two-column">
      <section className="panel"><div className="section-heading"><div><p className="eyebrow">Team coverage</p><h2>Compare team findings</h2><p>Select a team to update the reporting scope and reload its dashboard.</p></div></div>
        {selectedTeamId ? <Button onClick={() => onSelectTeam("")}>Return to all teams in faculty scope</Button> : null}
        <DashboardBreakdown activeKey={selectedTeamId} onSelect={key => onSelectTeam(selectedTeamId === key ? "" : key)} items={dashboard.byTeam.map(team => ({ key: team.key, label: team.label, value: team.rated, detail: `${team.below} ${labels.below} · ${team.notSeen ?? 0} Not seen · ${team.notApplicable} ${labels.notApplicable}`, disabled: !teamOptions.some(option => option.id === team.key), tone: team.below > 0 ? "amber" : "teal" }))} emptyMessage="No submitted evidence for teams in this reporting scope." />
        <p className="qa-intelligence-note">A shared submission can appear under several teams. Team counts overlap and must not be added together.</p>
        {dashboard.teamsWithoutEvidence.length ? <div className="qa-intelligence-coverage-gap"><h3>Teams without submitted evidence</h3><p>{dashboard.teamsWithoutEvidence.join(", ")}</p></div> : null}
      </section>
      <section className="panel"><div className="section-heading"><div><p className="eyebrow">Evidence activity</p><h2>When evidence was collected</h2><p>Select a date to inspect its submitted-form and response counts.</p></div></div>
        {dashboard.timeline.length ? <><div className="qa-intelligence-timeline" aria-label="Submitted evidence by activity date">{dashboard.timeline.map(point => <button key={point.date} type="button" aria-label={`${dateLabel(point.date)}: ${point.evidenceCount} submissions, ${point.responseCount} responses`} aria-pressed={selectedDay === point.date} onClick={() => setSelectedDay(selectedDay === point.date ? "" : point.date)}><span className="qa-intelligence-day-track" aria-hidden="true"><i style={{ height: `${Math.max(3, point.evidenceCount * 100 / maximumActivity)}%` }} /></span><strong>{point.evidenceCount}</strong><small>{dateLabel(point.date)}</small></button>)}</div><p className="qa-intelligence-day-detail" aria-live="polite">{day ? `${dateLabel(day.date)} · ${day.evidenceCount} submitted forms · ${day.responseCount} responses, including unscored responses.` : "Bar height = submitted forms by activity date. Choose a date for its response count."}</p></> : <p className="qa-intelligence-empty">No submitted evidence dates in this reporting scope.</p>}
      </section>
    </div>
  </div>;
}

function QaOutcomeMix({ question, label }: { question: { below: number; at: number; above: number; rated: number }; label: string }) {
  const labels = useQaOutcomeLabels();
  return <div className="qa-intelligence-outcome-mix" role="img" aria-label={question.rated ? `${label}: ${question.below} ${labels.below}, ${question.at} ${labels.at}, ${question.above} ${labels.above}; ${question.rated} rated responses` : `${label}: no rated responses`}>
    <span className="is-below" style={{ width: `${qaRatedPercentage(question.below, question.rated) ?? 0}%` }} /><span className="is-at" style={{ width: `${qaRatedPercentage(question.at, question.rated) ?? 0}%` }} /><span className="is-above" style={{ width: `${qaRatedPercentage(question.above, question.rated) ?? 0}%` }} />{!question.rated ? <small>No rated responses</small> : null}
  </div>;
}

function QaCriterionHighlights({ title, description, questions, kind, selectedKey, onSelect }: { title: string; description: string; questions: QaDashboardQuestionBreakdown[]; kind: "attention" | "strength"; selectedKey: string; onSelect: (question: QaDashboardQuestionBreakdown) => void }) {
  const labels = useQaOutcomeLabels();
  return <section className="panel"><div className="section-heading"><div><p className="eyebrow">Selected process · top three</p><h2>{title}</h2><p>{description}</p></div></div><div className="qa-intelligence-highlights">{questions.map((question, index) => <button key={qaCriterionKey(question)} type="button" aria-pressed={selectedKey === qaCriterionKey(question)} onClick={() => onSelect(question)}><span className={`qa-intelligence-rank is-${kind}`}>{index + 1}</span><span><small>{question.activityLabel} · {qaCriterionTheme(question)}</small><strong>{question.questionText}</strong><small>{kind === "attention" ? question.below : question.at + question.above} of {question.rated} rated · {kind === "attention" ? labels.below : qaCombinedOutcomeLabel(labels)}</small><QaOutcomeMix question={question} label={question.questionText} /></span><ArrowRight size={16} aria-hidden="true" /></button>)}{!questions.length ? <p className="qa-intelligence-empty">{kind === "attention" ? `No ${labels.below} responses in the selected process.` : `No ${qaCombinedOutcomeLabel(labels)} responses in the selected process.`}</p> : null}</div></section>;
}
