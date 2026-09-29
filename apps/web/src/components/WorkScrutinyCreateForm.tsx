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
  const clearNavigation = useUnsavedChanges({ label: "Work Scrutiny", dirty: Boolean(facultyId || teamId || Object.values(responses).some(Boolean) || actions.length), saving: isSaving, onSave: () => submit(true), onDiscard: () => { setResponses({}); setActions([]); } });

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

  useEffect(() => {
    api.learningWalkDeliveryAreas().then((areas) => { setDeliveryAreas(areas); setDeliveryAreasLoaded(true); })
      .catch(() => setStatusMessage("Delivery areas could not be loaded. Refresh before submitting Work Scrutiny."));
  }, []);

  useEffect(() => {
    setDefinition(null);
    setResponses({});
    setStatusMessage("");

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
          setStatusMessage("This sub-team does not have an available published Work Scrutiny form. An administrator can check its allocation and publish it in the Form Editor.");
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
  }, [teamId]);

  function addAction() {
    setActions((current) => [
      ...current,
      { id: crypto.randomUUID(), actionTheme: "", title: "", ownerStaffId: "", dueDate: "", detail: "" }
    ]);
  }

  function updateAction(id: string, changes: Partial<DraftAction>) {
    setActions((current) => current.map((action) => action.id === id ? { ...action, ...changes } : action));
  }

  async function submit(asDraft = false): Promise<boolean> {
    if (!facultyId || !teamId || !scrutinyDate || !definition) {
      setStatusMessage("Select the faculty, sub-team, scrutiny date and a published template.");
      return false;
    }

    if (!asDraft) {
    if (!courseLevelField || !responses[courseLevelField.id]?.trim()) {
      setStatusMessage(missingLevelMessage || "Select the course level for the scrutiny sample.");
      if (courseLevelField) document.getElementById(`scrutiny-field-${courseLevelField.id}`)?.focus();
      return false;
    }

    if (!deliveryAreaField || !responses[deliveryAreaField.id]?.trim()) {
      setStatusMessage("Select the delivery area for this Work Scrutiny sample.");
      if (deliveryAreaField) document.getElementById(`scrutiny-field-${deliveryAreaField.id}`)?.focus();
      return false;
    }

    const missingField = definition.sections
      .flatMap((section) => section.fields)
      .find((field) => field.isRequired && !responses[field.id]?.trim());
    if (missingField) {
      setStatusMessage(`Complete the required field: ${missingField.label}.`);
      document.getElementById(`scrutiny-field-${missingField.id}`)?.focus();
      return false;
    }

    const sampleField = definition.sections.flatMap((section) => section.fields).find((field) => field.fieldKey === "sample_size");
    if (sampleField && responses[sampleField.id] && (!Number.isInteger(Number(responses[sampleField.id])) || Number(responses[sampleField.id]) < 1)) {
      setStatusMessage("Learner sample size must be a positive whole number.");
      document.getElementById(`scrutiny-field-${sampleField.id}`)?.focus();
      return false;
    }

    const incompleteAction = actions.find((action) => !action.actionTheme.trim() || !action.title.trim() || !action.ownerStaffId || !action.dueDate);
    if (incompleteAction) {
      setStatusMessage("Every added action needs an action theme, action, owner and implementation date.");
      return false;
    }

    }
    setIsSaving(true);
    try {
      const result = await api.submitForm({
        templateKey: definition.templateKey,
        recordType: "work_scrutiny",
        title: `Work Scrutiny - ${selectedTeam?.code ?? "Sub-team"}`,
        orgUnitId: teamId,
        recordDate: scrutinyDate,
        responses: definition.sections.flatMap((section) => section.fields.map((field) => ({
          fieldId: field.id,
          value: responses[field.id] || undefined
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

      {statusMessage ? <div className="notice-row" role="status">{statusMessage}</div> : null}

      <div className="entry-form">
        <div className="entry-section">
          <h3>Context</h3>
          <div className="entry-field-grid">
            <label className="entry-field">
              <span>Faculty <strong>Required</strong></span>
              <select
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
            </label>
            <label className="entry-field">
              <span>Sub-team <strong>Required</strong></span>
              <select disabled={!facultyId} onChange={async (event) => { const next = event.target.value; if ((Object.values(responses).some(Boolean) || actions.length) && !await confirmUnsavedNavigation()) return; setTeamId(next); }} value={teamId}>
                <option value="">{facultyId ? "Select sub-team" : "Select faculty first"}</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>{team.code} - {team.name}</option>
                ))}
              </select>
            </label>
            <label className="entry-field">
              <span>Date of scrutiny <strong>Required</strong></span>
              <input onChange={(event) => setScrutinyDate(event.target.value)} type="date" value={scrutinyDate} />
            </label>
            {deliveryAreaField ? <WorkScrutinyResponseField field={{ ...deliveryAreaField, isRequired: true }}
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
            onChange={(value) => setResponses((current) => ({ ...current, [courseLevelField.id]: value }))}
            value={responses[courseLevelField.id] ?? ""}
          /> : <div className="empty-row" role={missingLevelMessage ? "alert" : undefined}>
            {missingLevelMessage || (isLoadingTemplate ? "Loading course level choices..." : "Select a sub-team to choose the course level.")}
          </div>}
        </div>

        {isLoadingTemplate ? <div className="empty-row">Loading the sub-team template...</div> : null}
        {definition ? definition.sections.filter((section) => section.fields.some((field) => field.id !== courseLevelField?.id && field.id !== deliveryAreaField?.id)).map((section) => (
          <div className="entry-section" key={section.id}>
            <h3>{section.title}</h3>
            <div className="entry-field-grid">
              {section.fields.filter((field) => field.id !== courseLevelField?.id && field.id !== deliveryAreaField?.id).map((field) => (
                <WorkScrutinyResponseField
                  field={field}
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
            <Button icon={Plus} onClick={addAction}>Action</Button>
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
                      onChange={(actionTheme) => updateAction(action.id, { actionTheme })}
                      sourceFormType="work_scrutiny"
                      value={action.actionTheme}
                    />
                  </label>
                  <label className="entry-field scrutiny-action-text">
                    <span>Action {index + 1} <strong>Required</strong></span>
                    <textarea
                      maxLength={300}
                      onChange={(event) => updateAction(action.id, { title: event.target.value })}
                      rows={3}
                      value={action.title}
                    />
                  </label>
                  <label className="entry-field">
                    <span>Owner <strong>Required</strong></span>
                    <StaffSearchSelect
                      id={`scrutiny-action-owner-${action.id}`}
                      onChange={(ownerStaffId) => updateAction(action.id, { ownerStaffId })}
                      staff={staff}
                      value={action.ownerStaffId}
                    />
                  </label>
                  <label className="entry-field">
                    <span>Date to be implemented by <strong>Required</strong></span>
                    <input
                      min={scrutinyDate}
                      onChange={(event) => updateAction(action.id, { dueDate: event.target.value })}
                      type="date"
                      value={action.dueDate}
                    />
                  </label>
                  <button
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
          <Button disabled={isSaving || !definition} icon={Save} onClick={() => void submit(true)}>Save draft</Button>
          <Button disabled={isSaving || !definition || !courseLevelField || !deliveryAreaField || !deliveryAreasLoaded} icon={CheckCircle2} onClick={() => void submit()} variant="primary">
            Complete scrutiny
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
  savedDeliveryAreaName
}: {
  field: FormFieldDefinition;
  onChange: (value: string) => void;
  value: string;
  deliveryAreas?: LearningWalkDeliveryArea[];
  deliveryAreasLoaded?: boolean;
  savedDeliveryAreaName?: string;
}) {
  const options = field.options ?? [];
  const selectedValues = value.split("|").filter(Boolean);
  const isWide = ["long_text", "multi_select", "checkbox_group", "rubric_scale"].includes(field.fieldType);
  const controlId = `scrutiny-field-${field.id}`;
  const helpId = `${controlId}-help`;

  if (field.fieldKey === "learning_walk_delivery_area") {
    return <label className="entry-field" htmlFor={controlId}>
      <span>Delivery area{field.isRequired ? <strong>Required</strong> : null}</span>
      <select id={controlId} disabled={!deliveryAreasLoaded} onChange={(event) => onChange(event.target.value)} value={value}>
        <option value="">{deliveryAreasLoaded ? "Select delivery area" : "Loading delivery areas…"}</option>
        {learningWalkDeliveryChoices(deliveryAreas, value, savedDeliveryAreaName).map((area) => <option key={area.key} value={area.key} disabled={!area.isActive && area.key !== value}>{area.name}{area.isActive ? "" : " (retired)"}</option>)}
      </select>
      <small>Uses the shared LIV and Learning Walk delivery-area list.</small>
    </label>;
  }

  if (courseLevelKeys.includes(field.fieldKey)) {
    const levels = options.length > 0 ? options : defaultCourseLevels;
    const hasHistoricValue = Boolean(value && !levels.includes(value));
    const levelHelpText = field.helpText === "Add the level or qualification where it is not clear from the selected courses."
      ? undefined : field.helpText;
    return <label className="entry-field" htmlFor={controlId}>
      <span>Course level{field.isRequired ? <strong>Required</strong> : null}</span>
      <select id={controlId} aria-describedby={levelHelpText ? helpId : undefined} onChange={(event) => onChange(event.target.value)} value={value}>
        <option value="">Select course level</option>
        {hasHistoricValue ? <option value={value}>{value} (existing response)</option> : null}
        {levels.map((level) => <option key={level} value={level}>{level}</option>)}
      </select>
      {levelHelpText ? <small id={helpId}>{levelHelpText}</small> : null}
    </label>;
  }

  const isRating = field.fieldType === "rubric_scale" || (field.fieldKey === "overall_picture"
    && options.length === 5 && options.every((option) => practiceRubricOption(option).isStandard));
  if (isRating) {
    return <fieldset id={controlId} tabIndex={-1}
      className="coaching-wording-rubric learning-walk-focus-rubric practice-observed-rubric entry-field-wide work-scrutiny-rubric"
      aria-describedby={field.helpText ? helpId : undefined}>
      <legend>{field.label}{field.isRequired ? <strong>Required</strong> : null}</legend>
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
    </fieldset>;
  }

  if (["multi_select", "checkbox_group"].includes(field.fieldType)) {
    return <fieldset id={controlId} tabIndex={-1} className="entry-field entry-field-wide scrutiny-choice-field" aria-describedby={field.helpText ? helpId : undefined}>
      <legend>{field.label}{field.isRequired ? <strong>Required</strong> : null}</legend>
      <div className="checkbox-field-grid">
        {options.map((option) => <label key={option}>
          <input type="checkbox" name={controlId} value={option}
            checked={selectedValues.includes(option)}
            onChange={() => onChange(toggleValue(selectedValues, option, field.fieldKey).join("|"))} />
          <span>{option}</span>
        </label>)}
      </div>
      {field.helpText ? <small id={helpId}>{field.helpText}</small> : null}
    </fieldset>;
  }

  return (
    <label className={isWide ? "entry-field entry-field-wide" : "entry-field"} htmlFor={controlId}>
      <span>{field.label}{field.isRequired ? <strong>Required</strong> : null}</span>
      {field.fieldType === "long_text" ? (
        <textarea id={controlId} aria-describedby={field.helpText ? helpId : undefined} onChange={(event) => onChange(event.target.value)} rows={4} value={value} />
      ) : null}
      {field.fieldType === "number" ? (
        <input id={controlId} min={field.fieldKey === "sample_size" ? 1 : 0} step={field.fieldKey === "sample_size" ? 1 : "any"} onChange={(event) => onChange(event.target.value)} type="number" value={value} />
      ) : null}
      {field.fieldType === "date" ? (
        <input id={controlId} onChange={(event) => onChange(event.target.value)} type="date" value={value} />
      ) : null}
      {field.fieldType === "yes_no_partial" ? (
        <select id={controlId} onChange={(event) => onChange(event.target.value)} value={value}>
          <option value="">Select response</option>
          <option value="Yes">Yes</option>
          <option value="Partially">Partially</option>
          <option value="No">No</option>
        </select>
      ) : null}
      {field.fieldType === "single_select" ? (
        <select id={controlId} onChange={(event) => onChange(event.target.value)} value={value}>
          <option value="">Select response</option>
          {options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      ) : null}
      {field.fieldType === "short_text" ? (
        <input id={controlId} onChange={(event) => onChange(event.target.value)} type="text" value={value} />
      ) : null}
      {field.helpText ? <small id={helpId}>{field.helpText}</small> : null}
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
