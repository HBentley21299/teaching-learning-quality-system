import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Plus, X } from "lucide-react";
import { Button } from "../design-system/Button";
import { api } from "../services/api";
import type {
  CourseSummary,
  CurrentUser,
  FormDefinition,
  FormFieldDefinition,
  OrgUnitSummary,
  StaffSummary
} from "../services/types";
import { StaffSearchSelect } from "./StaffSearchSelect";
import { CourseMultiSelect } from "./CourseMultiSelect";

type DraftAction = {
  id: string;
  title: string;
  ownerStaffId: string;
  dueDate: string;
};

type WorkScrutinyCreateFormProps = {
  onCancel: () => void;
  onSubmitted: (recordId: string) => Promise<void>;
  orgUnits: OrgUnitSummary[];
  staff: StaffSummary[];
  user: CurrentUser;
};

export function WorkScrutinyCreateForm({ onCancel, onSubmitted, orgUnits, staff, user }: WorkScrutinyCreateFormProps) {
  const [facultyId, setFacultyId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [scrutinyDate, setScrutinyDate] = useState(getTodayDate());
  const [definition, setDefinition] = useState<FormDefinition | null>(null);
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [selectedCourseIds, setSelectedCourseIds] = useState<string[]>([]);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [actions, setActions] = useState<DraftAction[]>([]);
  const [statusMessage, setStatusMessage] = useState("");
  const [isLoadingTemplate, setIsLoadingTemplate] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const faculties = useMemo(
    () => orgUnits.filter((orgUnit) => orgUnit.orgUnitType === "faculty"),
    [orgUnits]
  );
  const teams = useMemo(
    () => orgUnits.filter((orgUnit) =>
      orgUnit.parentOrgUnitId === facultyId
      && ["team", "faculty_child_code", "faculty_child"].includes(orgUnit.orgUnitType)),
    [facultyId, orgUnits]
  );
  const selectedTeam = orgUnits.find((orgUnit) => orgUnit.id === teamId);

  useEffect(() => {
    setDefinition(null);
    setCourses([]);
    setSelectedCourseIds([]);
    setResponses({});
    setStatusMessage("");

    if (!teamId) {
      return;
    }

    let cancelled = false;
    setIsLoadingTemplate(true);
    Promise.all([api.workScrutinyTemplate(teamId), api.courses(teamId)])
      .then(([nextDefinition, nextCourses]) => {
        if (!cancelled) {
          setDefinition(nextDefinition);
          setCourses(nextCourses);
          setStatusMessage(nextCourses.length === 0
            ? "No courses are loaded for this sub-team yet. The course register can be populated when the source data is provided."
            : "");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatusMessage("This sub-team does not have a published Work Scrutiny template yet.");
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
      { id: crypto.randomUUID(), title: "", ownerStaffId: "", dueDate: "" }
    ]);
  }

  function updateAction(id: string, changes: Partial<DraftAction>) {
    setActions((current) => current.map((action) => action.id === id ? { ...action, ...changes } : action));
  }

  async function submit() {
    if (!facultyId || !teamId || !scrutinyDate || !definition) {
      setStatusMessage("Select the faculty, sub-team, scrutiny date and a published template.");
      return;
    }

    if (selectedCourseIds.length === 0) {
      setStatusMessage("Select at least one course for the scrutiny sample.");
      return;
    }

    const missingField = definition.sections
      .flatMap((section) => section.fields)
      .find((field) => field.isRequired && !responses[field.id]?.trim());
    if (missingField) {
      setStatusMessage(`Complete the required field: ${missingField.label}.`);
      return;
    }

    const incompleteAction = actions.find((action) => !action.title.trim() || !action.ownerStaffId || !action.dueDate);
    if (incompleteAction) {
      setStatusMessage("Every added action needs an action description, owner and due date.");
      return;
    }

    setIsSaving(true);
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
      courseIds: selectedCourseIds,
      actions: actions.map((action) => ({
        title: action.title.trim(),
        ownerStaffId: action.ownerStaffId,
        dueDate: action.dueDate
      }))
    });
    setIsSaving(false);

    if (!result.ok || !result.data?.recordId) {
      setStatusMessage(result.message ?? "The Work Scrutiny record could not be submitted.");
      return;
    }

    await onSubmitted(result.data.recordId);
  }

  return (
    <section className="panel work-scrutiny-create">
      <div className="panel-heading">
        <div>
          <h2>New Work Scrutiny</h2>
          <span>{definition ? `${definition.name} v${definition.version}` : "Sub-team template"}</span>
        </div>
        <small>Created by {user.displayName}</small>
      </div>

      {statusMessage ? <div className="notice-row">{statusMessage}</div> : null}

      <div className="entry-form">
        <div className="entry-section">
          <h3>Context</h3>
          <div className="entry-field-grid">
            <label className="entry-field">
              <span>Faculty <strong>Required</strong></span>
              <select
                onChange={(event) => {
                  setFacultyId(event.target.value);
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
              <select disabled={!facultyId} onChange={(event) => setTeamId(event.target.value)} value={teamId}>
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
            <label className="entry-field">
              <span>Reviewer</span>
              <input readOnly value={user.displayName} />
            </label>
          </div>
        </div>

        <div className="entry-section">
          <h3>Sample</h3>
          <label className="entry-field entry-field-wide">
            <span>Courses sampled <strong>Required</strong></span>
            <CourseMultiSelect
              courses={courses}
              disabled={!teamId}
              id="work-scrutiny-course"
              onChange={setSelectedCourseIds}
              selectedIds={selectedCourseIds}
            />
            <small>Select a result, then keep typing to add further courses from the same sub-team.</small>
          </label>
        </div>

        {isLoadingTemplate ? <div className="empty-row">Loading the sub-team template...</div> : null}
        {definition ? definition.sections.map((section) => (
          <div className="entry-section" key={section.id}>
            <h3>{section.title}</h3>
            <div className="entry-field-grid">
              {section.fields.map((field) => (
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
              <small>Add only actions arising from this scrutiny.</small>
            </div>
            <Button icon={Plus} onClick={addAction}>Action</Button>
          </div>
          {actions.length === 0 ? (
            <div className="empty-row">No actions added.</div>
          ) : (
            <div className="scrutiny-action-list">
              {actions.map((action, index) => (
                <div className="scrutiny-action-row" key={action.id}>
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
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="toolbar">
          <Button icon={X} onClick={onCancel}>Cancel</Button>
          <Button disabled={isSaving || !definition || courses.length === 0} icon={CheckCircle2} onClick={() => void submit()} variant="primary">
            Complete scrutiny
          </Button>
        </div>
      </div>
    </section>
  );
}

export function WorkScrutinyResponseField({
  field,
  onChange,
  value
}: {
  field: FormFieldDefinition;
  onChange: (value: string) => void;
  value: string;
}) {
  const options = field.options ?? [];
  const selectedValues = value.split("|").filter(Boolean);
  const isWide = ["long_text", "multi_select", "checkbox_group"].includes(field.fieldType);

  return (
    <label className={isWide ? "entry-field entry-field-wide" : "entry-field"}>
      <span>{field.label}{field.isRequired ? <strong>Required</strong> : null}</span>
      {field.fieldType === "long_text" ? (
        <textarea onChange={(event) => onChange(event.target.value)} rows={4} value={value} />
      ) : null}
      {field.fieldType === "number" ? (
        <input min="0" onChange={(event) => onChange(event.target.value)} type="number" value={value} />
      ) : null}
      {field.fieldType === "date" ? (
        <input onChange={(event) => onChange(event.target.value)} type="date" value={value} />
      ) : null}
      {field.fieldType === "yes_no_partial" ? (
        <select onChange={(event) => onChange(event.target.value)} value={value}>
          <option value="">Select response</option>
          <option value="Yes">Yes</option>
          <option value="Partially">Partially</option>
          <option value="No">No</option>
        </select>
      ) : null}
      {["single_select", "rubric_scale"].includes(field.fieldType) ? (
        <select onChange={(event) => onChange(event.target.value)} value={value}>
          <option value="">{field.fieldType === "rubric_scale" ? "Select rubric level" : "Select response"}</option>
          {options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      ) : null}
      {["multi_select", "checkbox_group"].includes(field.fieldType) ? (
        <div className="checkbox-field-grid">
          {options.map((option) => (
            <label key={option}>
              <input
                checked={selectedValues.includes(option)}
                onChange={() => onChange(toggleValue(selectedValues, option).join("|"))}
                type="checkbox"
              />
              <span>{option}</span>
            </label>
          ))}
        </div>
      ) : null}
      {field.fieldType === "short_text" ? (
        <input onChange={(event) => onChange(event.target.value)} type="text" value={value} />
      ) : null}
      {field.helpText ? <small>{field.helpText}</small> : null}
    </label>
  );
}

function toggleValue(selectedValues: string[], option: string) {
  return selectedValues.includes(option)
    ? selectedValues.filter((value) => value !== option)
    : [...selectedValues, option];
}

function getTodayDate() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}
