import { useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, ExternalLink, Plus, Save, Send, Trash2, X } from "lucide-react";
import { Button } from "../design-system/Button";
import { StaffSearchSelect } from "./StaffSearchSelect";
import { WorkflowFeedback } from "./WorkflowFeedback";
import { useActionOwners } from "./useActionOwners";
import { api } from "../services/api";
import { actionPath } from "../app/routing";
import { learningWalkDeliveryChoices, type LearningWalkDeliveryArea } from "../services/learningWalkDeliveryAreas";
import type { CurrentUser, OrgUnitSummary, StaffSummary } from "../services/types";
import type { DigitalLearningWalkData, DigitalLearningWalkDraftAction, ProcessReviewConfiguration, ProcessReviewDetail, ProcessReviewResponse, SaveProcessReviewRequest } from "../services/processReviewTypes";
import { processReviewSafeLink } from "../services/processReviewTypes";
import "./DigitalLearningWalkForm.css";

type RequestPatch = Partial<SaveProcessReviewRequest> | ((current: SaveProcessReviewRequest) => Partial<SaveProcessReviewRequest>);
export type DigitalLearningWalkFormProps = {
  request: SaveProcessReviewRequest; configuration: ProcessReviewConfiguration; detail: ProcessReviewDetail | null;
  user: CurrentUser; staff: StaffSummary[]; orgUnits: OrgUnitSummary[];
  readOnly: boolean; saving: boolean; dirty: boolean; message: string; messageTone: "success" | "error" | "neutral";
  onChange: (patch: RequestPatch) => void; onSave: () => Promise<boolean>; onSubmit: () => Promise<boolean>;
  onCancel: () => void | Promise<void>; onDismissMessage: () => void;
};

function walkData(request: SaveProcessReviewRequest): DigitalLearningWalkData {
  return request.data.digital ?? { selectedStatementKeys: [...new Set(request.data.responses.map(response => response.statementKey))], draftActions: [] };
}
function unitWithin(unit: OrgUnitSummary, ancestor: string, all: OrgUnitSummary[]) {
  let cursor: OrgUnitSummary | undefined = unit;
  for (let depth = 0; cursor && depth < 40; depth++) {
    if (cursor.id === ancestor) return true;
    cursor = all.find(candidate => candidate.id === cursor!.parentOrgUnitId);
  }
  return false;
}

/** Learning Walk entry pattern with DLW criteria and criterion-level evidence notes. */
export function DigitalLearningWalkForm(props: DigitalLearningWalkFormProps) {
  const { request, configuration, detail, user, staff, orgUnits, onChange, readOnly, saving } = props;
  const [deliveryAreas, setDeliveryAreas] = useState<LearningWalkDeliveryArea[]>([]);
  const [deliveryLoading, setDeliveryLoading] = useState(true);
  const [deliveryError, setDeliveryError] = useState("");
  const [deliveryRetry, setDeliveryRetry] = useState(0);
  const generation = useRef(0);
  const feedback = useRef<HTMLDivElement | null>(null);
  const formId = useId();
  const ownerOptions = useActionOwners(undefined, undefined, "digital_learning_walk", !readOnly);
  useEffect(() => {
    const version = ++generation.current; setDeliveryLoading(true); setDeliveryError("");
    void api.learningWalkDeliveryAreas("learning_walk").then(areas => { if (version === generation.current) setDeliveryAreas(areas); })
      .catch(() => { if (version === generation.current) setDeliveryError("Delivery areas could not be loaded. Saved choices and your entries are retained."); })
      .finally(() => { if (version === generation.current) setDeliveryLoading(false); });
    return () => { generation.current++; };
  }, [deliveryRetry]);
  useEffect(() => {
    if (props.messageTone !== "error" || !props.message || !feedback.current) return;
    const reduceMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    feedback.current.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
    feedback.current.focus({ preventScroll: true });
  }, [props.message, props.messageTone]);
  const digital = walkData(request);
  const categorySelection = digital.selectedStandardKeys != null;
  const selectedCategories = new Set(digital.selectedStandardKeys);
  const selected = new Set(categorySelection
    ? configuration.standards.filter(standard => selectedCategories.has(standard.key)).flatMap(standard => standard.statements.map(statement => statement.key))
    : digital.selectedStatementKeys);
  const selectedStatements = configuration.standards.flatMap(standard => standard.statements.filter(statement => selected.has(statement.key)).map(statement => ({ standard, statement })));
  const earlierNotes = (detail?.data.responses ?? request.data.responses).filter(item => item.rationale?.trim());
  const earlierPartialSelection = !categorySelection && configuration.standards.some(standard => {
    const count = standard.statements.filter(statement => selected.has(statement.key)).length;
    return count > 0 && count < standard.statements.length;
  });
  const faculties = orgUnits.filter(unit => unit.orgUnitType === "faculty" && (unit.isActive || unit.id === request.facultyOrgUnitId));
  const teams = orgUnits.filter(unit => ["team", "faculty_child_code", "faculty_child"].includes(unit.orgUnitType)
    && (unit.isActive || unit.id === request.teamOrgUnitId) && (!request.facultyOrgUnitId || unitWithin(unit, request.facultyOrgUnitId, orgUnits)));
  const deliveryChoices = learningWalkDeliveryChoices(deliveryAreas, request.data.fields.deliveryAreaKey, request.data.fields.deliveryAreaName);
  const eligibleIds = new Set(ownerOptions.owners.map(owner => owner.staffId));
  const eligibleStaff = staff.filter(person => eligibleIds.has(person.id));
  const scaleMissing = configuration.ratingOptions.length === 0;
  const legacyMissingDelivery = detail?.status === "submitted" && !detail.data.digital && !detail.data.fields.deliveryAreaKey;
  const label = (key: string, fallback: string) => configuration.fieldLabels[key] || fallback;
  function updateDigital(patch: Partial<DigitalLearningWalkData>) { onChange(current => ({ data: { ...current.data, digital: { ...walkData(current), ...patch } } })); }
  function toggleCategory(key: string, checked: boolean) {
    onChange(current => {
      const previous = walkData(current);
      const chosen = new Set(previous.selectedStandardKeys ?? configuration.standards
        .filter(standard => standard.statements.some(statement => previous.selectedStatementKeys.includes(statement.key))).map(standard => standard.key));
      if (checked) chosen.add(key); else chosen.delete(key);
      const standards = configuration.standards.filter(standard => chosen.has(standard.key));
      return { data: { ...current.data, digital: { ...previous, selectedStandardKeys: standards.map(standard => standard.key),
        selectedStatementKeys: standards.flatMap(standard => standard.statements.map(statement => statement.key)) } } };
    });
  }
  function response(key: string, patch: Partial<ProcessReviewResponse>) {
    onChange(current => { const existing = current.data.responses.find(item => item.statementKey === key); const next = { statementKey: key, sampleIds: [], ...existing, ...patch };
      return { data: { ...current.data, responses: existing ? current.data.responses.map(item => item.statementKey === key ? next : item) : [...current.data.responses, next] } }; });
  }
  function updateAction(id: string, patch: Partial<DigitalLearningWalkDraftAction>) {
    onChange(current => { const previous = walkData(current); return { data: { ...current.data, digital: { ...previous,
      draftActions: previous.draftActions.map(action => action.id === id ? { ...action, ...patch } : action) } } }; });
  }
  return <div className="route-stack process-reviews digital-learning-walk">
    <section className="panel"><div className="panel-heading"><div><Button icon={ArrowLeft} variant="quiet" disabled={saving} onClick={() => void props.onCancel()}>Learning Walk register</Button><span className="eyebrow">Digital Learning Walks</span><h1>Digital Learning Walk form</h1><p className="muted-copy">{request.academicYear} · {detail?.status === "submitted" ? "Submitted" : "Draft"} · Framework {configuration.version}</p></div><div className="process-review-owner"><span>Recorded by</span><strong>{detail?.ownerName || user.displayName}</strong><small>Recorded automatically from the person completing the form.</small></div></div>
      <div ref={feedback} tabIndex={-1}><WorkflowFeedback message={props.message} tone={props.messageTone} onDismiss={props.onDismissMessage} /></div>
      {props.dirty ? <span className="status-chip">Unsaved changes</span> : null}
      {readOnly ? <p className="notice-row">You can view this walk. Its owner or an authorised coordinator can amend it.</p> : null}
      <div className="entry-form">
        <fieldset className="digital-walk-editable" disabled={readOnly || saving}>
          <legend className="sr-only">Digital Learning Walk entry</legend>
          <section className="entry-section"><h2>Context and focus</h2><div className="entry-field-grid">
            <label className="entry-field"><span>{label("recordDate", "Date of visit")} <strong>Required</strong></span><input aria-required="true" type="date" value={request.recordDate || ""} onChange={event => onChange({ recordDate: event.target.value || null })} /></label>
            <label className="entry-field"><span>{label("faculty", "Faculty")} <strong>Required</strong></span><select aria-required="true" value={request.facultyOrgUnitId || ""} onChange={event => onChange({ facultyOrgUnitId: event.target.value || null, teamOrgUnitId: null })}><option value="">Select faculty</option>{request.facultyOrgUnitId && !faculties.some(unit => unit.id === request.facultyOrgUnitId) ? <option value={request.facultyOrgUnitId}>{detail?.facultyName || "Saved faculty"}</option> : null}{faculties.map(unit => <option value={unit.id} key={unit.id}>{unit.name}</option>)}</select></label>
            <label className="entry-field"><span>{label("team", "Team / area")} <strong>Required</strong></span><select aria-required="true" value={request.teamOrgUnitId || ""} onChange={event => onChange({ teamOrgUnitId: event.target.value || null })}><option value="">Select team / area</option>{request.teamOrgUnitId && !teams.some(unit => unit.id === request.teamOrgUnitId) ? <option value={request.teamOrgUnitId}>{detail?.teamName || "Saved team / area"}</option> : null}{teams.map(unit => <option value={unit.id} key={unit.id}>{unit.name}</option>)}</select></label>
            <label className="entry-field"><span>{label("deliveryAreaName", "Delivery area")}{!legacyMissingDelivery ? <> <strong>Required</strong></> : null}</span><select aria-required={!legacyMissingDelivery} disabled={deliveryLoading || Boolean(deliveryError)} value={request.data.fields.deliveryAreaKey || ""} onChange={event => {
              const key = event.target.value; const name = deliveryChoices.find(area => area.key === key)?.name || "";
              onChange(current => ({ data: { ...current.data, fields: { ...current.data.fields, deliveryAreaKey: key, deliveryAreaName: name } } }));
            }}><option value="">{deliveryLoading ? "Loading delivery areas…" : legacyMissingDelivery ? "Not recorded on this earlier walk" : "Select delivery area"}</option>{deliveryChoices.map(area => <option value={area.key} key={area.key}>{area.name}{area.isActive ? "" : " (saved)"}</option>)}</select></label>
            {deliveryError ? <div className="entry-field-wide" role="alert">{deliveryError}<Button variant="quiet" onClick={() => setDeliveryRetry(value => value + 1)}>Retry delivery areas</Button></div> : null}
            <fieldset className="entry-field entry-field-wide learning-walk-theme-picker digital-walk-criteria"><legend>{label("criteria", "DLW focus categories")}</legend><p className="muted-copy" id={`${formId}-category-help`}>Choose one or more categories. Every criterion in each selected category must be rated.</p>
              {earlierPartialSelection ? <p className="notice-row" id={`${formId}-earlier-selection`}>{readOnly ? "This earlier walk selected individual criteria. Partially selected categories show only those saved criteria." : "This earlier walk selected individual criteria. Its saved selection is retained until you change a category. Changing any category includes every criterion in the chosen categories."}</p> : null}
              <div className="digital-walk-category-options">{configuration.standards.map(standard => {
                const count = standard.statements.filter(statement => selected.has(statement.key)).length;
                const partial = !categorySelection && count > 0 && count < standard.statements.length;
                return <label className={partial ? "is-partial" : ""} key={standard.key}><input type="checkbox" aria-label={standard.title} checked={categorySelection ? selectedCategories.has(standard.key) : count > 0 && count === standard.statements.length} aria-checked={partial ? "mixed" : undefined} aria-describedby={`${formId}-category-help${partial ? ` ${formId}-earlier-selection` : ""}`} ref={input => { if (input) input.indeterminate = partial; }} onChange={event => toggleCategory(standard.key, event.target.checked)} /><span><strong>{standard.title}</strong><small>{standard.statements.length} {standard.statements.length === 1 ? "criterion" : "criteria"}{partial ? ` · Earlier partial selection: ${count} of ${standard.statements.length}` : ""}</small></span></label>;
              })}</div>
            </fieldset>
          </div></section>
          <section className="entry-section"><h2>Practice observed</h2><p className="muted-copy" role="status">{selectedStatements.length} {selectedStatements.length === 1 ? "criterion selected" : "criteria selected"}</p>
            {scaleMissing ? <p className="notice-row">The Learning Walk rating scale is unavailable. You can save a draft; try reloading before submitting.</p> : null}
            {!selectedStatements.length ? <p className="empty-row">Select one or more DLW categories above to show all their rating cards.</p> : selectedStatements.map(({ standard, statement }) => {
              const current = request.data.responses.find(item => item.statementKey === statement.key);
              return <article className="digital-walk-criterion" key={statement.key}><p className="eyebrow">{standard.title}</p><fieldset className="coaching-wording-rubric learning-walk-focus-rubrics"><legend>{statement.text}</legend><div className="digital-walk-rating-options">{configuration.ratingOptions.map(option => <button type="button" key={option.key} disabled={readOnly || saving} aria-pressed={current?.ratingKey === option.key} aria-label={`${option.label}: ${statement.text}`} className={current?.ratingKey === option.key ? "is-selected" : ""} onClick={() => response(statement.key, { ratingKey: option.key })}><i aria-hidden="true" style={{ backgroundColor: option.colorHex || "var(--line)" }} /><span><strong>{option.label}</strong>{option.guidanceText ? <small>{option.guidanceText}</small> : null}</span></button>)}</div>{current?.ratingKey && !configuration.ratingOptions.some(option => option.key === current.ratingKey) ? <p className="muted-copy">Saved rating: {current.ratingKey}</p> : null}</fieldset>
              </article>;
            })}
          </section>
          <section className="entry-section"><div className="section-heading-row"><div><h2>Actions</h2><small>{detail?.status === "submitted" ? "New actions are assigned when you save the submitted walk." : "Actions are assigned to their owners when you submit the walk. Draft actions remain with the draft."}</small></div><Button icon={Plus} onClick={() => updateDigital({ draftActions: [...digital.draftActions, { id: crypto.randomUUID(), themeKey: "", title: "", ownerStaffId: null, dueDate: null }] })}>Add action</Button></div>
            {digital.draftActions.length > 0 && ownerOptions.loading ? <p role="status">Loading eligible action owners…</p> : null}{digital.draftActions.length > 0 && ownerOptions.error ? <p role="alert">{ownerOptions.error}<Button variant="quiet" onClick={() => void ownerOptions.retry()}>Retry action owners</Button></p> : null}
            {!digital.draftActions.length ? <p className="empty-row">No draft actions added.</p> : <div className="scrutiny-action-list">{digital.draftActions.map((action, index) => <div className="scrutiny-action-row digital-walk-draft-action" key={action.id}>
              <label className="entry-field scrutiny-action-theme"><span>Action theme</span><select value={action.themeKey} onChange={event => updateAction(action.id, { themeKey: event.target.value })}><option value="">Select DLW standard</option>{configuration.standards.map(standard => <option key={standard.key} value={standard.key}>{standard.title}</option>)}</select></label>
              <label className="entry-field scrutiny-action-text"><span>Action {index + 1}</span><textarea rows={3} maxLength={300} value={action.title} onChange={event => updateAction(action.id, { title: event.target.value })} /></label>
              <label className="entry-field"><span>Owner</span><StaffSearchSelect id={`${formId}-action-${action.id}`} label={`Owner for action ${index + 1}`} staff={eligibleStaff} value={action.ownerStaffId || ""} onChange={ownerStaffId => updateAction(action.id, { ownerStaffId: ownerStaffId || null })} /><small>Programme Leaders and above in your permitted scope.</small></label>
              <label className="entry-field"><span>Date to be implemented by</span><input type="date" min={request.recordDate || undefined} value={action.dueDate || ""} onChange={event => updateAction(action.id, { dueDate: event.target.value || null })} /></label>
              <Button icon={Trash2} variant="quiet" aria-label={`Remove draft action ${index + 1}`} onClick={() => updateDigital({ draftActions: digital.draftActions.filter(candidate => candidate.id !== action.id) })}>Remove</Button>
            </div>)}</div>}
          </section>
        </fieldset>
        {earlierNotes.length > 0 ? <details className="entry-section digital-walk-earlier-evidence"><summary>Earlier criterion notes · read only</summary><p className="muted-copy">Notes saved on earlier forms are retained with their original wording.</p>{earlierNotes.map(item => <article className="digital-walk-earlier-item" key={item.statementKey}><h3>{configuration.standards.flatMap(standard => standard.statements).find(statement => statement.key === item.statementKey)?.text || "Earlier criterion"}</h3><p className="process-review-preserve">{item.rationale}</p></article>)}</details> : null}
        {request.data.samples.length > 0 ? <details className="entry-section digital-walk-earlier-evidence"><summary>Earlier evidence · read only</summary><p className="muted-copy">Evidence saved on the previous form is retained with its original links.</p>{request.data.samples.map((sample, index) => {
          const linkedCriteria = (detail?.data.responses || request.data.responses).filter(item => item.sampleIds.includes(sample.id)).map(item => configuration.standards.flatMap(standard => standard.statements).find(statement => statement.key === item.statementKey)?.text).filter(Boolean);
          const link = processReviewSafeLink(sample.evidenceLink);
          return <article className="digital-walk-earlier-item" key={sample.id}><h3>{sample.title || `Earlier evidence ${index + 1}`}</h3><dl className="process-review-summary"><div><dt>Type</dt><dd>{sample.sampleType?.replaceAll("_", " ") || "Not recorded"}</dd></div>{sample.sampleDate ? <div><dt>Date</dt><dd>{sample.sampleDate}</dd></div> : null}{sample.course ? <div><dt>Course / group</dt><dd>{sample.course}</dd></div> : null}{sample.staffIds.length ? <div><dt>Associated staff</dt><dd>{sample.staffIds.map(id => staff.find(person => person.id === id)?.displayName || "Saved staff member").join("; ")}</dd></div> : null}</dl>{sample.notes ? <p className="process-review-preserve">{sample.notes}</p> : null}{link ? <a href={link} target="_blank" rel="noreferrer">Open earlier evidence <ExternalLink size={15} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a> : sample.evidenceLink ? <p className="process-review-preserve">{sample.evidenceLink}</p> : null}{linkedCriteria.length ? <p className="muted-copy">Linked criteria: {linkedCriteria.join("; ")}</p> : null}</article>;
        })}</details> : null}
        {detail?.actions.length ? <section className="entry-section"><h2>Assigned actions</h2><p className="muted-copy">These actions are already live. Open an action to amend it or record progress.</p>{detail.actions.map(action => <article className="digital-walk-live-action" key={action.actionId}><div><strong>{action.title}</strong><p className="muted-copy">{action.themeLabel || configuration.standards.find(standard => standard.key === action.themeKey)?.title} · {action.ownerName} · {action.dueDate}</p></div><a href={actionPath(action.actionId)} target="_blank" rel="noreferrer">Open action <ExternalLink size={15} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a></article>)}</section> : null}
        <div className="toolbar digital-walk-footer"><Button icon={X} disabled={saving} onClick={() => void props.onCancel()}>Cancel</Button>{!readOnly ? <>{detail?.status !== "submitted" ? <Button icon={Save} busy={saving} onClick={() => void props.onSave()}>Save draft</Button> : null}<Button icon={detail?.status === "submitted" ? Save : Send} busy={saving} disabled={scaleMissing} variant="primary" onClick={() => void (detail?.status === "submitted" ? props.onSave() : props.onSubmit())}>{detail?.status === "submitted" ? "Save changes" : "Submit form"}</Button></> : null}</div>
      </div>
    </section>
  </div>;
}
