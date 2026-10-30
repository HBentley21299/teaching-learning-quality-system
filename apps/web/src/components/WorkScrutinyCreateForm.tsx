import { LoadingState } from "./LoadingState";
import { hasFormAnswer, isCustomChoiceField, normalizeFormAnswer, parseChoiceAnswers, serializeChoiceAnswers } from "../services/formChoiceAnswers";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Plus, Save, X } from "lucide-react";
import { confirmUnsavedNavigation, useUnsavedChanges } from "./UnsavedChangesGuard";
import { Button } from "../design-system/Button";
import { api } from "../services/api";
import type {
  CurrentUser,
  FormDefinition,
  FormFieldDefinition,
  OrgUnitSummary,
  StaffSummary
} from "../services/types";
import { StaffSearchSelect } from "./StaffSearchSelect";
import { ActionThemeSelect } from "./ActionThemeSelect";
import { learningWalkDeliveryChoices, type LearningWalkDeliveryArea } from "../services/learningWalkDeliveryAreas";
import { WorkflowFeedback } from "./WorkflowFeedback";
import { WorkflowErrorSummary } from "./WorkflowErrorSummary";
import { requiredWorkflowMessage, workflowDescription, type WorkflowFieldError } from "../services/workflowExperience";

type DraftAction = {
  id: string;
  actionTheme: string;
  title: string;
  ownerStaffId: string;
  dueDate: string;
  detail: string;
};

type WorkScrutinyCreateFormProps = {
  onCancel: () => void;
  onSubmitted: (recordId: string, isDraft?: boolean) => Promise<void>;
  orgUnits: OrgUnitSummary[];
  staff: StaffSummary[];
  user: CurrentUser;
};

export function WorkScrutinyCreateForm({ onCancel, onSubmitted, orgUnits, staff, user }: WorkScrutinyCreateFormProps) {
  const [facultyId, setFacultyId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [scrutinyDate, setScrutinyDate] = useState(getTodayDate());
  const [definition, setDefinition] = useState<FormDefinition | null>(null);
  const [deliveryAreas, setDeliveryAreas] = useState<LearningWalkDeliveryArea[]>([]);
  const [deliveryAreasLoaded, setDeliveryAreasLoaded] = useState(false);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [actions, setActions] = useState<DraftAction[]>([]);
  const [statusMessage, setStatusMessage] = useState("");
  const [isLoadingTemplate, setIsLoadingTemplate] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<WorkflowFieldError[]>([]);
  const [deliveryError, setDeliveryError] = useState("");
  const [deliveryRetry, setDeliveryRetry] = useState(0);
  const [templateRetry, setTemplateRetry] = useState(0);
  const [templateError, setTemplateError] = useState("");
  const faculties = useMemo(
    () => orgUnits.filter((orgUnit) => orgUnit.isActive && orgUnit.orgUnitType === "faculty"),
    [orgUnits]
  );
  const teams = useMemo(
    () => orgUnits.filter((orgUnit) =>
      orgUnit.isActive && orgUnit.parentOrgUnitId === facultyId
      && ["team", "faculty_child_code", "faculty_child"].includes(orgUnit.orgUnitType)),
    [facultyId, orgUnits]
  );
  const selectedTeam = orgUnits.find((orgUnit) => orgUnit.id === teamId);
  const fields = definition?.sections.flatMap((section) => section.fields) ?? [];
  const courseLevelField = courseLevelKeys.map((key) => fields.find((field) => field.fieldKey === key)).find(Boolean);
  const deliveryAreaField = fields.find((field) => field.fieldKey === "learning_walk_delivery_area");
  const missingLevelMessage = definition && !courseLevelField
    ? "This published Work Scrutiny form needs a course level field. An administrator can add the course level question in the Form Editor and publish the updated form."
    : "";
  const clearNavigation = useUnsavedChanges({ label: "Work Scrutiny", submission: true, submitLabel: "Complete scrutiny",
    dirty: Boolean(facultyId || teamId || Object.values(responses).some(Boolean) || actions.length), saving: isSaving,
    onSave: () => submit(true), onSubmit: definition && courseLevelField && deliveryAreaField && deliveryAreasLoaded ? () => submit(false) : undefined,
    onDiscard: () => { setResponses({}); setActions([]); } });

  useEffect(() => {
    let cancelled = false;
    setDeliveryError(""); setDeliveryAreasLoaded(false);
    api.learningWalkDeliveryAreas().then((areas) => { if (!cancelled) { setDeliveryAreas(areas); setDeliveryAreasLoaded(true); } })
      .catch(() => { if (!cancelled) setDeliveryError("Delivery areas could not be loaded. Try again before completing this scrutiny."); });
    return () => { cancelled = true; };
  }, [deliveryRetry]);

  useEffect(() => {
    setResponses({});
    setActions([]);
    setFieldErrors([]);
  }, [teamId]);

  useEffect(() => {
    setDefinition(null);
    setStatusMessage("");
    setTemplateError("");

    if (!teamId) {
      setIsLoadingTemplate(false);
      return;
    }

    let cancelled = false;
    setIsLoadingTemplate(true);
    api.workScrutinyTemplate(teamId)
      .then((nextDefinition) => {
        if (!cancelled) {
          setDefinition(nextDefinition);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTemplateError("The form for this sub-team could not be loaded. Try again, or ask an administrator to check that a form is published and assigned to the sub-team.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingTemplate(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [teamId, templateRetry]);

  function addAction() {
    setActions((current) => [
      ...current,
      { id: crypto.randomUUID(), actionTheme: "", title: "", ownerStaffId: "", dueDate: "", detail: "" }
    ]);
  }

  function updateAction(id: string, changes: Partial<DraftAction>) {
    setActions((current) => current.map((action) => action.id === id ? { ...action, ...changes } : action));
  }

  function fieldAccessibility(id: string) {
    const invalid = fieldErrors.some(error => error.id === id);
    return { "aria-invalid": invalid || undefined, "aria-describedby": invalid ? `${id}-error` : undefined };
  }

  function fieldError(id: string) {
    const error = fieldErrors.find(error => error.id === id);
    return error ? <small id={`${id}-error`} className="workflow-field-error">{error.message}</small> : null;
  }

  async function submit(asDraft = false): Promise<boolean> {
    if (isSaving) return false;
    const errors: WorkflowFieldError[] = [];
    if (!facultyId) errors.push({ id: "scrutiny-faculty", message: "Select a faculty." });
    if (!teamId) errors.push({ id: "scrutiny-team", message: "Select a sub-team." });
    if (!scrutinyDate) errors.push({ id: "scrutiny-date", message: "Enter the date of scrutiny." });
    setStatusMessage("");
    if (!facultyId || !teamId || !scrutinyDate || !definition) {
      setFieldErrors(errors);
      if (!errors.length) setStatusMessage("A published form must be available for the selected sub-team before you can save.");
      return false;
    }

    if (!asDraft) {
    if (!courseLevelField || !responses[courseLevelField.id]?.trim()) {
      if (courseLevelField) errors.push({ id: `scrutiny-field-${courseLevelField.id}`, message: "Select the course level for the scrutiny sample." });
      else setStatusMessage(missingLevelMessage);
    }

    if (!deliveryAreaField || !responses[deliveryAreaField.id]?.trim()) {
      if (deliveryAreaField) errors.push({ id: `scrutiny-field-${deliveryAreaField.id}`, message: "Select the delivery area for this sample." });
      else setStatusMessage("The form needs a delivery area question. Ask an administrator to check the published form.");
    }

    const missingFields = definition.sections
      .flatMap((section) => section.fields)
      .filter((field) => field.isRequired && !hasFormAnswer(field, responses[field.id]));
    for (const field of missingFields) if (!errors.some(error => error.id === `scrutiny-field-${field.id}`))
      errors.push({ id: `scrutiny-field-${field.id}`, message: requiredWorkflowMessage(field.label) });

    const sampleField = definition.sections.flatMap((section) => section.fields).find((field) => field.fieldKey === "sample_size");
    if (sampleField && responses[sampleField.id] && (!Number.isInteger(Number(responses[sampleField.id])) || Number(responses[sampleField.id]) < 1)) {
      errors.push({ id: `scrutiny-field-${sampleField.id}`, message: "Learner sample size must be a positive whole number." });
    }

    actions.forEach((action, index) => {
      if (!action.actionTheme.trim()) errors.push({ id: `scrutiny-action-theme-${action.id}`, message: `Choose a theme for action ${index + 1}.` });
      if (!action.title.trim()) errors.push({ id: `scrutiny-action-text-${action.id}`, message: `Describe action ${index + 1}.` });
      if (!action.ownerStaffId) errors.push({ id: `scrutiny-action-owner-${action.id}`, message: `Choose an owner for action ${index + 1}.` });
      if (!action.dueDate) errors.push({ id: `scrutiny-action-date-${action.id}`, message: `Set the implementation date for action ${index + 1}.` });
    });

    }
    setFieldErrors(errors);
    if (errors.length || (!asDraft && (!courseLevelField || !deliveryAreaField))) return false;
    setIsSaving(true);
    try {
      const result = await api.submitForm({
        templateKey: definition.templateKey,
        templateVersionId: definition.versionId,
        recordType: "work_scrutiny",
        title: `Work Scrutiny - ${selectedTeam?.code ?? "Sub-team"}`,
        orgUnitId: teamId,
        recordDate: scrutinyDate,
        responses: definition.sections.flatMap((section) => section.fields.map((field) => ({
          fieldId: field.id,
          value: normalizeFormAnswer(field, responses[field.id]) || undefined
        }))),
        saveAsDraft: asDraft,
        draftActions: asDraft ? actions.map(action => ({ actionTheme: action.actionTheme, title: action.title, ownerStaffId: action.ownerStaffId || undefined, dueDate: action.dueDate || undefined, detail: action.detail })) : undefined,
        actions: asDraft ? undefined : actions.map((action) => ({
          actionTheme: action.actionTheme.trim(),
          title: action.title.trim(),
          ownerStaffId: action.ownerStaffId,
          dueDate: action.dueDate,
          detail: action.detail.trim() || undefined
        }))
      });


      if (!result.ok || !result.data?.recordId) {
        setStatusMessage(result.message ?? "The Work Scrutiny record could not be submitted.");
        return false;
      }

      clearNavigation();
      await onSubmitted(result.data.recordId, asDraft);
      return true;
    } finally { setIsSaving(false); }
  }

  return (
    <fieldset disabled={isSaving} style={{ display: "contents" }}><section className="panel work-scrutiny-create">
      <div className="panel-heading">
        <div>
          <h2>New Work Scrutiny</h2>
          <span>{definition ? `${definition.name} v${definition.version}` : "Sub-team template"}</span>
        </div>
        <small>Created by {user.displayName}</small>
      </div>

      <WorkflowFeedback message={statusMessage} tone="error" />
      <WorkflowFeedback message={deliveryError} tone="error" />
      {deliveryError ? <Button onClick={() => setDeliveryRetry(value => value + 1)}>Retry delivery areas</Button> : !deliveryAreasLoaded ? <LoadingState label="Loading delivery areas…" size="inline" /> : null}
      <WorkflowFeedback message={templateError} tone="error" />
      {templateError ? <Button onClick={() => setTemplateRetry(value => value + 1)}>Retry loading form</Button> : null}
      <WorkflowErrorSummary errors={fieldErrors} />

      <div className="entry-form">
        <div className="entry-section">
          <h3>Context</h3>
          <div className="entry-field-grid">
            <label className="entry-field">
              <span>Faculty <strong>Required</strong></span>
              <select
                id="scrutiny-faculty" aria-required="true" {...fieldAccessibility("scrutiny-faculty")}
                onChange={async (event) => {
                  const next = event.target.value;
                  if ((Object.values(responses).some(Boolean) || actions.length) && !await confirmUnsavedNavigation()) return;
                  setFacultyId(next);
                  setTeamId("");
                }}
                value={facultyId}
              >
                <option value="">Select faculty</option>
                {faculties.map((faculty) => (
                  <option key={faculty.id} value={faculty.id}>{faculty.code} - {faculty.name}</option>
                ))}
              </select>
              {fieldError("scrutiny-faculty")}
            </label>
            <label className="entry-field">
              <span>Sub-team <strong>Required</strong></span>
              <select id="scrutiny-team" aria-required="true" {...fieldAccessibility("scrutiny-team")} disabled={!facultyId} onChange={async (event) => { const next = event.target.value; if ((Object.values(responses).some(Boolean) || actions.length) && !await confirmUnsavedNavigation()) return; setTeamId(next); }} value={teamId}>
                <option value="">{facultyId ? "Select sub-team" : "Select faculty first"}</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>{team.code} - {team.name}</option>
                ))}
              </select>
              {fieldError("scrutiny-team")}
            </label>
            <label className="entry-field">
              <span>Date of scrutiny <strong>Required</strong></span>
              <input id="scrutiny-date" aria-required="true" {...fieldAccessibility("scrutiny-date")} onChange={(event) => setScrutinyDate(event.target.value)} type="date" value={scrutinyDate} />
              {fieldError("scrutiny-date")}
            </label>
            {deliveryAreaField ? <WorkScrutinyResponseField field={{ ...deliveryAreaField, isRequired: true }} error={fieldErrors.find(error => error.id === `scrutiny-field-${deliveryAreaField.id}`)?.message}
              deliveryAreas={deliveryAreas} deliveryAreasLoaded={deliveryAreasLoaded}
              onChange={(value) => setResponses((current) => ({ ...current, [deliveryAreaField.id]: value }))}
              value={responses[deliveryAreaField.id] ?? ""} /> : null}
            <label className="entry-field">
              <span>Reviewer</span>
              <input readOnly value={user.displayName} />
            </label>
          </div>
        </div>

        <div className="entry-section">
          <h3>Sample</h3>
          {courseLevelField ? <WorkScrutinyResponseField
            field={{ ...courseLevelField, isRequired: true }}
            error={fieldErrors.find(error => error.id === `scrutiny-field-${courseLevelField.id}`)?.message}
            onChange={(value) => setResponses((current) => ({ ...current, [courseLevelField.id]: value }))}
            value={responses[courseLevelField.id] ?? ""}
          /> : isLoadingTemplate ? null : <div className="empty-row" role={missingLevelMessage ? "alert" : undefined}>
            {missingLevelMessage || "Select a sub-team to choose the course level."}
          </div>}
        </div>

        {isLoadingTemplate ? <LoadingState label="Loading the sub-team form…" detail="Preparing course level choices and questions." /> : null}
        {definition ? definition.sections.filter((section) => section.fields.some((field) => field.id !== courseLevelField?.id && field.id !== deliveryAreaField?.id)).map((section) => (
          <div className="entry-section" key={section.id}>
            <h3>{section.title}</h3>
            <div className="entry-field-grid">
              {section.fields.filter((field) => field.id !== courseLevelField?.id && field.id !== deliveryAreaField?.id).map((field) => (
                <WorkScrutinyResponseField
                  field={field}
                  error={fieldErrors.find(error => error.id === `scrutiny-field-${field.id}`)?.message}
                  key={field.id}
                  onChange={(value) => setResponses((current) => ({ ...current, [field.id]: value }))}
                  value={responses[field.id] ?? ""}
                />
              ))}
            </div>
          </div>
        )) : null}

        <div className="entry-section">
          <div className="section-heading-row">
            <div>
              <h3>Actions</h3>
              <small>Add actions arising from this scrutiny. Owners, due dates, progress and follow-up evidence are tracked in linked actions after submission.</small>
            </div>
            <Button icon={Plus} onClick={addAction}>Add action</Button>
          </div>
          {actions.length === 0 ? (
            <div className="empty-row">No actions added.</div>
          ) : (
            <div className="scrutiny-action-list">
              {actions.map((action, index) => (
                <div className="scrutiny-action-row" key={action.id}>
                  <label className="entry-field scrutiny-action-theme">
                    <span>Action theme <strong>Required</strong></span>
                    <ActionThemeSelect
                      id={`scrutiny-action-theme-${action.id}`}
                      aria-required="true" {...fieldAccessibility(`scrutiny-action-theme-${action.id}`)}
                      onChange={(actionTheme) => updateAction(action.id, { actionTheme })}
                      sourceFormType="work_scrutiny"
                      value={action.actionTheme}
                    />
                    {fieldError(`scrutiny-action-theme-${action.id}`)}
                  </label>
                  <label className="entry-field scrutiny-action-text">
                    <span>Action {index + 1} <strong>Required</strong></span>
                    <textarea
                      id={`scrutiny-action-text-${action.id}`} aria-required="true" {...fieldAccessibility(`scrutiny-action-text-${action.id}`)}
                      maxLength={300}
                      onChange={(event) => updateAction(action.id, { title: event.target.value })}
                      rows={3}
                      value={action.title}
                    />
                    {fieldError(`scrutiny-action-text-${action.id}`)}
                  </label>
                  <label className="entry-field">
                    <span>Owner <strong>Required</strong></span>
                    <StaffSearchSelect
                      id={`scrutiny-action-owner-${action.id}`}
                      aria-required="true" {...fieldAccessibility(`scrutiny-action-owner-${action.id}`)}
                      onChange={(ownerStaffId) => updateAction(action.id, { ownerStaffId })}
                      staff={staff}
                      value={action.ownerStaffId}
                    />
                    {fieldError(`scrutiny-action-owner-${action.id}`)}
                  </label>
                  <label className="entry-field">
                    <span>Date to be implemented by <strong>Required</strong></span>
                    <input
                      id={`scrutiny-action-date-${action.id}`} aria-required="true" {...fieldAccessibility(`scrutiny-action-date-${action.id}`)}
                      min={scrutinyDate}
                      onChange={(event) => updateAction(action.id, { dueDate: event.target.value })}
                      type="date"
                      value={action.dueDate}
                    />
                    {fieldError(`scrutiny-action-date-${action.id}`)}
                  </label>
                  <button
                    aria-label={`Remove action ${index + 1}`}
                    className="icon-button scrutiny-action-remove"
                    onClick={() => setActions((current) => current.filter((candidate) => candidate.id !== action.id))}
                    title="Remove action"
                    type="button"
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                  <label className="entry-field entry-field-wide">
                    <span>Expected impact and follow-up plan</span>
                    <textarea maxLength={4000} rows={3} value={action.detail}
                      onChange={(event) => updateAction(action.id, { detail: event.target.value })} />
                    <small>Include the evidence of improvement you expect and how you will check it. This is saved with the linked action.</small>
                  </label>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="toolbar">
          <Button icon={X} onClick={() => void confirmUnsavedNavigation().then(leave => { if (leave) onCancel(); })}>Cancel</Button>
          <Button disabled={isSaving || !definition} icon={Save} onClick={() => void submit(true)}>{isSaving ? "Saving…" : "Save draft"}</Button>
          <Button disabled={isSaving || !definition || !courseLevelField || !deliveryAreaField || !deliveryAreasLoaded} icon={CheckCircle2} onClick={() => void submit()} variant="primary">
            {isSaving ? "Saving…" : "Complete scrutiny"}
          </Button>
        </div>
      </div>
    </section></fieldset>
  );
}

export function WorkScrutinyResponseField({
  field,
  onChange,
  value,
  deliveryAreas = [],
  deliveryAreasLoaded = false,
  savedDeliveryAreaName,
  error
}: {
  field: FormFieldDefinition;
  onChange: (value: string) => void;
  value: string;
  deliveryAreas?: LearningWalkDeliveryArea[];
  deliveryAreasLoaded?: boolean;
  savedDeliveryAreaName?: string;
  error?: string;
}) {
  const options = field.options ?? [];
  const selectedValues = isCustomChoiceField(field) ? parseChoiceAnswers(value) : value.split("|").filter(Boolean);
  const historicalChoices = selectedValues.filter(selected => !options.includes(selected));
  const isWide = ["long_text", "multi_select", "checkbox_group", "rubric_scale"].includes(field.fieldType);
  const controlId = `scrutiny-field-${field.id}`;
  const helpId = `${controlId}-help`;
  const errorId = `${controlId}-error`;
  const accessibility = { "aria-invalid": error ? true as const : undefined, "aria-required": field.isRequired || undefined,
    "aria-describedby": workflowDescription(field.helpText ? helpId : undefined, error ? errorId : undefined) };
  const errorMessage = error ? <small className="workflow-field-error" id={errorId}>{error}</small> : null;

  if (field.fieldKey === "learning_walk_delivery_area") {
    return <label className="entry-field" htmlFor={controlId}>
      <span>{field.label}{field.isRequired ? <strong>Required</strong> : null}</span>
      <select id={controlId} {...accessibility} disabled={!deliveryAreasLoaded} onChange={(event) => onChange(event.target.value)} value={value}>
        <option value="">{deliveryAreasLoaded ? "Select delivery area" : "Loading delivery areas…"}</option>
        {learningWalkDeliveryChoices(deliveryAreas, value, savedDeliveryAreaName).map((area) => <option key={area.key} value={area.key} disabled={!area.isActive && area.key !== value}>{area.name}{area.isActive ? "" : " (retired)"}</option>)}
      </select>
      {field.helpText ? <small id={helpId}>{field.helpText}</small> : null}
      {errorMessage}
    </label>;
  }

  if (courseLevelKeys.includes(field.fieldKey)) {
    const levels = options.length > 0 ? options : defaultCourseLevels;
    const hasHistoricValue = Boolean(value && !levels.includes(value));
    return <label className="entry-field" htmlFor={controlId}>
      <span>{field.label}{field.isRequired ? <strong>Required</strong> : null}</span>
      <select id={controlId} {...accessibility} onChange={(event) => onChange(event.target.value)} value={value}>
        <option value="">Select course level</option>
        {hasHistoricValue ? <option value={value}>{value} (existing response)</option> : null}
        {levels.map((level) => <option key={level} value={level}>{level}</option>)}
      </select>
      {field.helpText ? <small id={helpId}>{field.helpText}</small> : null}
      {errorMessage}
    </label>;
  }

  const isRating = field.fieldType === "rubric_scale" || (field.fieldKey === "overall_picture"
    && options.length === 5 && options.every((option) => practiceRubricOption(option).isStandard));
  if (isRating) {
    return <fieldset id={controlId} tabIndex={-1}
      className="coaching-wording-rubric learning-walk-focus-rubric practice-observed-rubric entry-field-wide work-scrutiny-rubric"
      {...accessibility}>
      <legend>{field.label}{field.isRequired ? <strong>Required</strong> : null}</legend>
      {value && !options.includes(value) ? <p className="muted-copy">Existing response: {value} (no longer offered)</p> : null}
      <div>
        {options.map((option) => {
          const display = practiceRubricOption(option);
          return <button key={option} type="button" aria-pressed={value === option}
            className={`${value === option ? "is-selected " : ""}${display.isNeutral ? "is-neutral" : ""}`}
            onClick={() => onChange(option)}>
            <i aria-hidden="true" style={{ backgroundColor: display.color }} />
            <span><strong>{display.label}</strong></span>
          </button>;
        })}
      </div>
      {field.helpText ? field.helpText.length > 250
        ? <details className="scrutiny-rating-guidance" id={helpId}><summary>Rating guidance</summary><p>{field.helpText}</p></details>
        : <small id={helpId}>{field.helpText}</small> : null}
      {errorMessage}
    </fieldset>;
  }

  if (["multi_select", "checkbox_group"].includes(field.fieldType)) {
    return <fieldset id={controlId} tabIndex={-1} className="entry-field entry-field-wide scrutiny-choice-field" {...accessibility}>
      <legend>{field.label}{field.isRequired ? <strong>Required</strong> : null}</legend>
      <div className="checkbox-field-grid">
        {[...options, ...historicalChoices].map((option) => <label key={option}>
          <input type="checkbox" name={controlId} value={option}
            checked={selectedValues.includes(option)}
            onChange={() => onChange(serializeChoiceAnswers(field.fieldKey, toggleValue(selectedValues, option, field.fieldKey)))} />
          <span>{option}{historicalChoices.includes(option) ? " (existing response)" : ""}</span>
        </label>)}
      </div>
      {field.helpText ? <small id={helpId}>{field.helpText}</small> : null}
      {errorMessage}
    </fieldset>;
  }

  return (
    <label className={isWide ? "entry-field entry-field-wide" : "entry-field"} htmlFor={controlId}>
      <span>{field.label}{field.isRequired ? <strong>Required</strong> : null}</span>
      {field.fieldType === "long_text" ? (
        <textarea id={controlId} {...accessibility} onChange={(event) => onChange(event.target.value)} rows={4} value={value} />
      ) : null}
      {field.fieldType === "number" ? (
        <input id={controlId} {...accessibility} min={field.fieldKey === "sample_size" ? 1 : 0} step={field.fieldKey === "sample_size" ? 1 : "any"} onChange={(event) => onChange(event.target.value)} type="number" value={value} />
      ) : null}
      {field.fieldType === "date" ? (
        <input id={controlId} {...accessibility} onChange={(event) => onChange(event.target.value)} type="date" value={value} />
      ) : null}
      {field.fieldType === "yes_no_partial" ? (
        <select id={controlId} {...accessibility} onChange={(event) => onChange(event.target.value)} value={value}>
          <option value="">Select response</option>
          <option value="Yes">Yes</option>
          <option value="Partially">Partially</option>
          <option value="No">No</option>
        </select>
      ) : null}
      {field.fieldType === "single_select" ? (
        <select id={controlId} {...accessibility} onChange={(event) => onChange(event.target.value)} value={value}>
          <option value="">Select response</option>
          {value && !options.includes(value) ? <option value={value}>{value} (existing response)</option> : null}
          {options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      ) : null}
      {field.fieldType === "short_text" ? (
        <input id={controlId} {...accessibility} onChange={(event) => onChange(event.target.value)} type="text" value={value} />
      ) : null}
      {field.helpText ? <small id={helpId}>{field.helpText}</small> : null}
      {errorMessage}
    </label>
  );
}

function toggleValue(selectedValues: string[], option: string, fieldKey: string) {
  if (fieldKey === "triangulation_sources" && !selectedValues.includes(option)) {
    return option === "No further validation required" ? [option] : [...selectedValues.filter((value) => value !== "No further validation required"), option];
  }
  return selectedValues.includes(option)
    ? selectedValues.filter((value) => value !== option)
    : [...selectedValues, option];
}

function getTodayDate() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

const courseLevelKeys = ["qualification_level", "course_level", "course_or_unit"];
const defaultCourseLevels = ["Pre-entry", "Entry Level", "Level 1", "Level 2", "Level 3", "Level 4", "Level 5", "Level 6", "Level 7"];
const practiceLabels = ["Emerging", "Developing", "Secure", "Strong", "Exceptional"];
const practiceColors = ["#D7E7F3", "#A9DDD2", "#3FAE5A", "#176B3A", "#1565A8"];

function practiceRubricOption(option: string) {
  const index = practiceLabels.findIndex((label) => option === label || option === `${label} Practice`);
  const isNeutral = /^(n\/?a|not applicable|not seen)$/i.test(option);
  return {
    label: index >= 0 ? `${practiceLabels[index]} Practice` : option,
    color: index >= 0 ? practiceColors[index] : "#87928e",
    isStandard: index >= 0,
    isNeutral
  };
}
