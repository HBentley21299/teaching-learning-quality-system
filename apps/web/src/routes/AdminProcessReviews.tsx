import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { Button } from "../design-system/Button";
import { LoadingState } from "../components/LoadingState";
import { WorkflowFeedback } from "../components/WorkflowFeedback";
import { confirmUnsavedNavigation, useUnsavedChanges } from "../components/UnsavedChangesGuard";
import { CollapsibleSection } from "../components/CollapsibleSection";
import { api } from "../services/api";
import type { ProcessReviewConfiguration, ProcessReviewKey, ProcessReviewStandard } from "../services/processReviewTypes";
import { processReviewCodeLabel, processReviewFieldLabel, validateProcessReviewConfiguration } from "../services/processReviewReporting";
import { matchesListSearch } from "../services/listQuery";
import "./ProcessReviewReporting.css";

type Props = { processKey: ProcessReviewKey; onDirtyChange?: (dirty: boolean, saving?: boolean) => void };
const clone = <T,>(value: T): T => structuredClone(value);
const reference = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
const settingLabels: Record<string, string> = {
  initialWindow: "Initial review window", progressWindow: "Progress review window", meetingMinutes: "Meeting duration (minutes)",
  skillsScanLeadDays: "Skills Scan closure · days before initial review", initialPackLeadDays: "Initial pack · days before review",
  progressPackLeadDays: "Progress pack · days before review", requireSamplePerRating: "Require a linked sample for each rating",
  requireRationale: "Require an evidence rationale for each rating"
};
const legacyActivateFields = new Set(["teamsUrl", "headOfFacultyStaffId", "initialPlannedDate", "initialHeldDate", "progressPlannedDate", "progressHeldDate", "attendeeStaffIds", "snapshotDate", "sourceCheckedDate", "sourceMeeting", "reportedNeeds", "supportRequested", "supportAgreed", "impactSummary", "skillsScanTargetDate", "skillsScanCompletedDate", "period", "summaryUrl", "responsesReceived", "eligibleStaff", "packTargetDate", "packCompletedDate", "gaps", "changedPriorities", "impactEvidence", "impactLinks", "outcomes", "carryForward", "escalations", "followUpDate"]);

/** A saved configuration creates a new version; historical reviews retain their own framework. */
export function AdminProcessReviews({ processKey, onDirtyChange }: Props) {
  const [configuration, setConfiguration] = useState<ProcessReviewConfiguration | null>(null);
  const [draft, setDraft] = useState<ProcessReviewConfiguration | null>(null);
  const [baseline, setBaseline] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"error" | "success" | "neutral">("neutral");
  const [errors, setErrors] = useState<string[]>([]);
  const request = useRef(0);
  const digital = processKey === "digital_learning_walk";
  const dirty = Boolean(draft && JSON.stringify(draft) !== baseline);
  const clearNavigation = useUnsavedChanges({ label: `${digital ? "Digital Learning Walk" : "Activate+"} settings`, dirty, saving: busy,
    onSave: save, onDiscard: () => { if (configuration) setDraft(clone(configuration)); } });

  useEffect(() => { onDirtyChange?.(dirty, busy); }, [dirty, busy, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false, false), [onDirtyChange]);
  useEffect(() => {
    setConfiguration(null); setDraft(null); setBaseline(""); setSearch(""); setMessage(""); setErrors([]);
    void load();
    return () => { request.current += 1; };
  }, [processKey]);

  async function load() {
    const token = ++request.current; setLoading(true);
    try {
      const result = await api.processReviewConfiguration(processKey);
      if (token !== request.current) return;
      setConfiguration(result); setDraft(clone(result)); setBaseline(JSON.stringify(result)); setNeedsReload(false); clearNavigation();
    } catch {
      if (token !== request.current) return;
      setTone("error"); setMessage("These process settings could not be loaded. Check your access or try again. Any current edits have been kept.");
    } finally { if (token === request.current) setLoading(false); }
  }

  async function save(): Promise<boolean> {
    if (!draft || busy || needsReload) return false;
    const found = validateProcessReviewConfiguration(draft); setErrors(found);
    if (found.length) return false;
    const token = request.current; setBusy(true); setMessage("");
    try {
      const result = await api.saveProcessReviewConfiguration(processKey, draft);
      if (token !== request.current) return false;
      if (!result.ok) { setTone("error"); setMessage(result.message ?? "This version could not be saved. Your edits are still here; reload before retrying if another administrator changed it."); return false; }
      if (result.data) {
        setConfiguration(result.data); setDraft(clone(result.data)); setBaseline(JSON.stringify(result.data)); clearNavigation();
      } else {
        setNeedsReload(true); setBaseline(JSON.stringify(draft)); clearNavigation();
      }
      setTone("success"); setMessage("New configuration version saved. New reviews use it; existing reviews keep their saved framework and reporting labels.");
      return true;
    } catch {
      if (token === request.current) { setTone("error"); setMessage("The version could not be saved. Your edits have been kept."); }
      return false;
    } finally { if (token === request.current) setBusy(false); }
  }

  function updateStandard(index: number, changes: Partial<ProcessReviewStandard>) {
    setDraft(current => current ? { ...current, standards: current.standards.map((standard, i) => i === index ? { ...standard, ...changes } : standard) } : current);
  }
  function moveStandard(index: number, offset: number) {
    if (!draft) return;
    const standards = [...draft.standards]; [standards[index], standards[index + offset]] = [standards[index + offset], standards[index]];
    setDraft({ ...draft, standards });
  }

  if (loading && !draft) return <LoadingState label="Loading process settings…" />;
  if (!draft) return <section className="panel route-stack"><WorkflowFeedback message={message} tone="error" /><Button icon={RefreshCw} onClick={() => void load()}>Try again</Button></section>;

  const matches = (...values: unknown[]) => matchesListSearch(search, ...values);
  const visibleStandards = draft.standards.map((standard, index) => ({ standard, index }))
    .filter(({ standard }) => matches("framework questions review areas standards", standard.title, standard.statements.map(statement => statement.text)));
  const labels = Object.entries(draft.fieldLabels).filter(([key, label]) => (digital || !legacyActivateFields.has(key) && !key.endsWith("_summary"))
    && matches("form labels prompts wording", processReviewFieldLabel(draft, key), label));
  const digitalOnlySettings = new Set(["requireSamplePerRating", "requireRationale"]);
  const activateOnlySettings = new Set(["initialWindow", "progressWindow", "meetingMinutes", "skillsScanLeadDays", "initialPackLeadDays", "progressPackLeadDays"]);
  const settings = Object.entries(draft.settings).filter(([key, value]) => !(digital ? activateOnlySettings : digitalOnlySettings).has(key)
    && matches("defaults evidence cycle meeting preparation", settingLabels[key] ?? processReviewCodeLabel(key), value));
  const ratingsVisible = digital && matches("rating categories college scale", draft.ratingOptions.map(option => option.label));
  const pillars = draft.skillsScanPillars ?? [];
  const visiblePillars = pillars.map((pillar, index) => ({ pillar, index })).filter(({ pillar }) => matches("Skills Scan pillars sub-areas manual averages", pillar.title, pillar.subAreas.map(area => area.title)));
  const themes = draft.actionThemes ?? [];
  const themesVisible = !digital && matches("specialist action themes", themes.map(theme => theme.title));

  return <div className="route-stack process-review-admin">
    <section className="panel">
      <div className="panel-heading"><div><h2>{draft.title} settings</h2><p className="muted-copy">Current version {configuration?.version ?? draft.version}. Changes create a new version for future reviews.</p></div>
        <div className="toolbar"><Button icon={RefreshCw} disabled={busy || loading} onClick={async () => { if (await confirmUnsavedNavigation()) await load(); }}>Reload saved version</Button>
          <Button variant="primary" icon={Save} busy={busy} disabled={!dirty || loading || needsReload} onClick={() => void save()}>Save new version</Button></div></div>
      <label className="entry-field"><span>Find a setting</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={digital ? "Search questions, wording, ratings or defaults" : "Search Skills Scan pillars, sub-areas, themes or wording"} /></label>
      <WorkflowFeedback message={message} tone={tone} />
      {needsReload ? <p role="status">The new version was saved. Reload its current version before making another change.</p> : null}
      {errors.length ? <div className="process-review-error-summary" role="alert"><strong>Check these settings before saving.</strong><ul>{errors.map(error => <li key={error}>{error}</li>)}</ul></div> : null}
    </section>
    <fieldset disabled={busy || loading || needsReload} className="process-review-settings-fields">
      <legend className="sr-only">Process configuration</legend>
      {matches("process title", draft.title) ? <section className="panel"><label className="entry-field"><span>Process title</span><input maxLength={250} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label></section> : null}
      {digital && (!search || visibleStandards.length) ? <CollapsibleSection storageKey={`process-admin-framework-${processKey}`} title="Framework & questions" count={draft.standards.reduce((sum, standard) => sum + standard.statements.length, 0)} defaultExpanded>
        <p className="muted-copy">{digital ? "This question set is separate from Learning Walks and the QA Hub activity bank. Each statement receives one overall rating." : "Teams holds the full review narrative. These areas and prompts structure the dated reporting snapshot."}</p>
        {visibleStandards.length ? visibleStandards.map(({ standard, index }) => <article className="process-review-config-area" key={standard.key}>
          <div className="panel-heading"><label className="entry-field"><span>{digital ? `Standard ${index + 1}` : `Review area ${index + 1}`}</span><input maxLength={250} value={standard.title} onChange={event => updateStandard(index, { title: event.target.value })} /></label>
            <div className="toolbar"><Button icon={ArrowUp} disabled={index === 0} aria-label={`Move ${standard.title} up`} onClick={() => moveStandard(index, -1)}>Up</Button><Button icon={ArrowDown} disabled={index === draft.standards.length - 1} aria-label={`Move ${standard.title} down`} onClick={() => moveStandard(index, 1)}>Down</Button><Button icon={Trash2} onClick={() => setDraft({ ...draft, standards: draft.standards.filter((_, i) => i !== index) })}>Remove area</Button></div></div>
          {standard.statements.map((statement, statementIndex) => <div className="process-review-question-row" key={statement.key}>
            <label className="entry-field"><span>{digital ? "Statement" : "Prompt"} {statementIndex + 1}</span><textarea rows={2} maxLength={2000} value={statement.text} onChange={event => updateStandard(index, { statements: standard.statements.map((item, i) => i === statementIndex ? { ...item, text: event.target.value } : item) })} /></label>
            <Button icon={Trash2} aria-label={`Remove statement ${statementIndex + 1} from ${standard.title}`} onClick={() => updateStandard(index, { statements: standard.statements.filter((_, i) => i !== statementIndex) })}>Remove</Button>
          </div>)}
          <Button icon={Plus} onClick={() => updateStandard(index, { statements: [...standard.statements, { key: reference("statement"), text: "" }] })}>Add {digital ? "statement" : "prompt"}</Button>
        </article>) : <p className="muted-copy">No review areas match this search.</p>}
        <Button icon={Plus} onClick={() => setDraft({ ...draft, standards: [...draft.standards, { key: reference("area"), title: "", statements: [] }] })}>Add {digital ? "standard" : "review area"}</Button>
      </CollapsibleSection> : null}
      {!digital && (!search || visiblePillars.length) ? <CollapsibleSection storageKey="process-admin-activate-skills" title="Skills Scan pillars & sub-areas" count={pillars.reduce((count, pillar) => count + pillar.subAreas.length, 0)} defaultExpanded>
        <p className="muted-copy">Six pillars contain fifteen sub-areas. Staff enter the supplied sub-area averages manually on a fixed 1–5 scale, including decimals. These labels are independent from the five specialist action themes.</p>
        {visiblePillars.map(({ pillar, index }) => <article className="process-review-config-area" key={pillar.key}>
          <label className="entry-field"><span>Pillar {index + 1}</span><input maxLength={300} value={pillar.title} onChange={event => setDraft({ ...draft, skillsScanPillars: pillars.map((item, position) => position === index ? { ...item, title: event.target.value } : item) })} /></label>
          <div className="form-grid form-grid-two">{pillar.subAreas.map((area, areaIndex) => <label className="entry-field" key={area.key}><span>Sub-area {index + 1}.{areaIndex + 1}</span><input maxLength={300} value={area.title} onChange={event => setDraft({ ...draft, skillsScanPillars: pillars.map((item, position) => position === index ? { ...item, subAreas: item.subAreas.map((subArea, subPosition) => subPosition === areaIndex ? { ...subArea, title: event.target.value } : subArea) } : item) })} /></label>)}</div>
        </article>)}
        {!pillars.length ? <p role="status">Reload the current configuration to load the Skills Scan framework.</p> : null}
      </CollapsibleSection> : null}
      {themesVisible ? <CollapsibleSection storageKey="process-admin-activate-action-themes" title="Specialist action themes" count={themes.length} defaultExpanded>
        <p className="muted-copy">These five themes organise action support. Each action also names a separate Skills Scan sub-area where its impact is intended.</p>
        <div className="form-grid form-grid-two">{themes.map((theme, index) => <label className="entry-field" key={theme.key}><span>Action theme {index + 1}</span><input maxLength={300} value={theme.title} onChange={event => setDraft({ ...draft, actionThemes: themes.map((item, position) => position === index ? { ...item, title: event.target.value } : item) })} /></label>)}</div>
      </CollapsibleSection> : null}
      {ratingsVisible ? <CollapsibleSection storageKey={`process-admin-ratings-${processKey}`} title="College rating scale" count={draft.ratingOptions.length} defaultExpanded>
        {!draft.ratingOptions.length ? <p className="record-context-note">No college rating scale is configured. Reviews can be saved as drafts; formal Digital submission remains unavailable until the agreed scale is entered.</p> : <p className="muted-copy">Enter the college’s agreed category labels. Categories are reported as counts; no score or average is assumed.</p>}
        {draft.ratingOptions.map((option, index) => <div className="process-review-question-row" key={option.key}><label className="entry-field"><span>Rating category {index + 1}</span><input maxLength={250} value={option.label} onChange={event => setDraft({ ...draft, ratingOptions: draft.ratingOptions.map((item, i) => i === index ? { ...item, label: event.target.value } : item) })} /></label><Button icon={Trash2} aria-label={`Remove rating category ${index + 1}`} onClick={() => setDraft({ ...draft, ratingOptions: draft.ratingOptions.filter((_, i) => i !== index) })}>Remove</Button></div>)}
        <Button icon={Plus} onClick={() => setDraft({ ...draft, ratingOptions: [...draft.ratingOptions, { key: reference("rating"), label: "" }] })}>Add rating category</Button>
      </CollapsibleSection> : null}
      {labels.length ? <CollapsibleSection storageKey={`process-admin-labels-${processKey}`} title="Form wording" count={labels.length} defaultExpanded={Boolean(search)}>
        <p className="muted-copy">Change the displayed labels while preserving the same saved answer and reporting field.</p>
        <div className="form-grid form-grid-two">{labels.map(([key, label]) => <label className="entry-field" key={key}><span>{processReviewFieldLabel(configuration ?? draft, key)}</span><input maxLength={300} value={label} onChange={event => setDraft({ ...draft, fieldLabels: { ...draft.fieldLabels, [key]: event.target.value } })} /></label>)}</div>
      </CollapsibleSection> : null}
      {digital && settings.length ? <CollapsibleSection storageKey={`process-admin-defaults-${processKey}`} title="Evidence requirements" defaultExpanded>
        <div className="form-grid form-grid-two">{settings.map(([key, value]) => value === "true" || value === "false"
          ? <label className="process-review-setting-toggle" key={key}><span>{settingLabels[key] ?? processReviewCodeLabel(key.replace(/([a-z])([A-Z])/g, "$1 $2"))}</span><input type="checkbox" role="switch" checked={value === "true"} onChange={event => setDraft({ ...draft, settings: { ...draft.settings, [key]: String(event.target.checked) } })} /></label>
          : <label className="entry-field" key={key}><span>{settingLabels[key] ?? processReviewCodeLabel(key.replace(/([a-z])([A-Z])/g, "$1 $2"))}</span><input maxLength={500} type={/Days|Minutes/.test(key) ? "number" : "text"} min={0} value={value} onChange={event => setDraft({ ...draft, settings: { ...draft.settings, [key]: event.target.value } })} /></label>)}</div>
      </CollapsibleSection> : null}
      {matches("access permissions participants head of faculty programme leaders action responsible people review owner") ? <section className="panel"><h3>Access & ownership</h3><p>The signed-in person creating the review is its recorded owner. Ownership is not entered on the form and does not change when another authorised person updates it.</p>{!digital ? <p>Review scope determines the Head of Faculty and programme leaders from Organisation structure. The creator and Head of Faculty stay in the participant list; programme leaders can be removed and additional participants can be added.</p> : null}<p className="muted-copy">Assign process permissions through Roles & permissions. Configuration access does not automatically grant access to every review.</p></section> : null}
    </fieldset>
  </div>;
}
