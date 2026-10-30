import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Copy, Eye, Plus, Save, Send, Trash2 } from "lucide-react";
import { Button } from "../design-system/Button";
import { LoadingState } from "../components/LoadingState";
import { ModalDialog } from "../components/ModalDialog";
import { WorkflowErrorSummary } from "../components/WorkflowErrorSummary";
import { WorkflowFeedback } from "../components/WorkflowFeedback";
import { confirmUnsavedNavigation, useUnsavedChanges } from "../components/UnsavedChangesGuard";
import { api } from "../services/api";
import type { FormTemplateAdministration, FormTemplateSummary } from "../services/types";
import type { WorkflowFieldError } from "../services/workflowExperience";

const questionTypes = [
  ["short_text", "Short text"], ["long_text", "Long text"], ["number", "Number"], ["date", "Date"],
  ["yes_no_partial", "Yes / No / Partial"], ["single_select", "Single choice"],
  ["multi_select", "Multiple choice"], ["checkbox_group", "Checklist"], ["rubric_scale", "Rubric scale"]
] as const;
const choiceTypes = new Set(["single_select", "multi_select", "checkbox_group", "rubric_scale"]);
type Section = FormTemplateAdministration["sections"][number];
type Question = Section["fields"][number];
type EditableForm = Pick<FormTemplateAdministration, "name" | "description" | "sections">;
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const editable = (form: FormTemplateAdministration): EditableForm => copy({ name: form.name, description: form.description ?? "", sections: form.sections });
function ordered<T extends { displayOrder: number }>(items: T[]) { return items.map((item, index) => ({ ...item, displayOrder: index + 1 })); }
function move<T>(items: T[], index: number, offset: number) { const next = [...items]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; return next; }

/** Published versions are immutable; edits belong to a separately saved draft. */
export function AdminFormVersions({ moduleKey, onDirtyChange }: { moduleKey?: string; onDirtyChange?: (dirty: boolean, saving?: boolean) => void }) {
  const [templates, setTemplates] = useState<FormTemplateSummary[]>([]);
  const [form, setForm] = useState<FormTemplateAdministration | null>(null);
  const [draft, setDraft] = useState<EditableForm | null>(null);
  const [baseline, setBaseline] = useState("");
  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState(moduleKey ?? "all");
  const [isLoading, setIsLoading] = useState(true);
  const [listFailed, setListFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);
  const [preview, setPreview] = useState(false);
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"neutral" | "error" | "success">("neutral");
  const [errors, setErrors] = useState<WorkflowFieldError[]>([]);
  const [confirmation, setConfirmation] = useState<"publish" | "discard" | null>(null);
  const request = useRef(0);
  const listRequest = useRef(0);
  const dirty = Boolean(draft && JSON.stringify(draft) !== baseline);
  const isDraft = form?.status === "Draft";
  const workflowKeys = new Set(draft?.sections.flatMap(section => section.fields.map(field => field.fieldKey)) ?? []);
  const needsCorePreparation = Boolean(isDraft && form?.moduleKey === "work_scrutiny"
    && (!["qualification_level", "course_level", "course_or_unit"].some(key => workflowKeys.has(key)) || !workflowKeys.has("learning_walk_delivery_area")));
  const canDiscardDraft = Boolean(form?.versions.some(version => version.status === "Published" || version.status === "Superseded"));
  const clearNavigation = useUnsavedChanges({ label: "Form version", dirty, saving: busy,
    onSave: () => save(), onDiscard: () => { if (form) setDraft(editable(form)); } });
  useEffect(() => { onDirtyChange?.(dirty, busy); }, [dirty, busy, onDirtyChange]);
  useEffect(() => () => { onDirtyChange?.(false, false); }, [onDirtyChange]);

  function feedback(text: string, nextTone: typeof tone = "error") { setMessage(text); setTone(nextTone); }
  async function loadVersion(templateId: string, versionId?: string) {
    const current = ++request.current; setIsLoading(true); setErrors([]);
    try {
      const next = await api.formTemplateAdministration(templateId, versionId);
      if (current !== request.current) return false;
      const nextDraft = editable(next);
      setForm(next); setDraft(nextDraft); setBaseline(JSON.stringify(nextDraft));
      setPreview(false); setNeedsReload(false); clearNavigation();
      return true;
    } catch {
      if (current === request.current) feedback("This form version could not be loaded. Your current edits are still here. Try loading it again.");
      return false;
    } finally { if (current === request.current) setIsLoading(false); }
  }
  async function loadTemplates() {
    const current = ++listRequest.current; request.current += 1;
    setIsLoading(true); setListFailed(false);
    try {
      const next = (await api.formTemplates()).filter(item => item.status !== "Archived");
      if (current !== listRequest.current) return;
      setTemplates(next);
      const first = next.find(item => !moduleKey || item.moduleKey === moduleKey);
      if (first) await loadVersion(first.id); else setIsLoading(false);
    } catch { if (current === listRequest.current) { setListFailed(true); setIsLoading(false); feedback("Forms could not be loaded. Try again."); } }
  }
  useEffect(() => { void loadTemplates(); return () => { request.current += 1; listRequest.current += 1; }; }, [moduleKey]);
  async function navigate(templateId: string, versionId?: string) {
    if (!await confirmUnsavedNavigation()) return;
    setMessage(""); await loadVersion(templateId, versionId);
  }
  function updateSection(id: string, changes: Partial<Section>) {
    setDraft(current => current ? { ...current, sections: current.sections.map(section => section.id === id ? { ...section, ...changes } : section) } : current);
    setErrors([]);
  }
  function updateQuestion(sectionId: string, id: string, changes: Partial<Question>) {
    const section = draft?.sections.find(item => item.id === sectionId);
    if (section) updateSection(sectionId, { fields: section.fields.map(field => field.id === id ? { ...field, ...changes } : field) });
  }
  function addSection() {
    setDraft(current => current ? { ...current, sections: [...current.sections, { id: crypto.randomUUID(), sectionKey: `custom_${crypto.randomUUID().replaceAll("-", "")}`, title: "New section", displayOrder: current.sections.length + 1, fields: [] }] } : current);
  }
  function addQuestion(section: Section) {
    const id = crypto.randomUUID();
    updateSection(section.id, { fields: [...section.fields, { id, fieldKey: `custom_${id.replaceAll("-", "")}`, label: "New question", fieldType: "short_text", isRequired: false, isProtected: false, displayOrder: section.fields.length + 1, helpText: "", options: [] }] });
  }
  function validate() {
    if (!draft) return [];
    const found: WorkflowFieldError[] = [];
    if (!draft.name.trim()) found.push({ id: "admin-version-name", message: "Enter the form name." });
    if (!draft.sections.length && !needsCorePreparation) found.push({ id: "admin-version-add-section", message: "Add at least one section." });
    for (const section of draft.sections) {
      if (!section.title.trim()) found.push({ id: `admin-section-${section.id}`, message: "Name every section." });
      if (!section.fields.length) found.push({ id: `admin-section-${section.id}`, message: `Add a question to ${section.title || "the section"}, or remove the empty section.` });
      for (const field of section.fields) {
        if (!field.label.trim()) found.push({ id: `admin-question-${field.id}`, message: "Enter the wording for every question." });
        if (!field.isProtected && choiceTypes.has(field.fieldType)) {
          const choices = (field.options ?? []).map(option => option.trim()).filter(Boolean);
          if (choices.length < 2 || choices.length > 20 || choices.some(option => option.length > 300) || new Set(choices.map(option => option.toLocaleLowerCase())).size !== choices.length)
            found.push({ id: `admin-options-${field.id}`, message: `Add 2–20 distinct choices for ${field.label || "the question"}.` });
        }
      }
    }
    return found;
  }
  async function save(): Promise<boolean> {
    if (!form || !draft || !isDraft || busy || needsReload) return false;
    setPreview(false);
    const nextErrors = validate(); setErrors(nextErrors); if (nextErrors.length) return false;
    setBusy(true); setMessage("");
    try {
      const result = await api.saveFormTemplateVersion(form.templateId, form.versionId, { ...draft, rowVersion: form.rowVersion,
        sections: ordered(draft.sections).map(section => ({ ...section, fields: ordered(section.fields).map(field => ({ ...field,
          options: field.isProtected ? field.options : choiceTypes.has(field.fieldType) ? (field.options ?? []).map(option => option.trim()).filter(Boolean) : [] })) })) });
      if (!result.ok) { feedback(result.message ?? "The draft could not be saved. Your edits have been kept."); return false; }
      setBaseline(JSON.stringify(draft)); setNeedsReload(true); clearNavigation();
      const loaded = await loadVersion(form.templateId, form.versionId);
      if (loaded) feedback("Draft saved. It is ready to preview or publish.", "success");
      else feedback("Draft saved, but its refreshed version could not be loaded. Reload the version before making more changes.");
      return true;
    } catch { feedback("The draft could not be saved. Your edits have been kept."); return false; }
    finally { setBusy(false); }
  }
  async function createDraft() {
    if (!form || busy || !await confirmUnsavedNavigation()) return;
    setBusy(true); setMessage("");
    try {
      const result = await api.createFormTemplateDraft(form.templateId, form.versionId);
      if (!result.ok || !result.data?.versionId) { feedback(result.message ?? "A draft could not be created."); return; }
      if (await loadVersion(form.templateId, result.data.versionId)) feedback("Draft copy created. The published form is still in use.", "success");
    } catch { feedback("A draft could not be created. Try again."); }
    finally { setBusy(false); }
  }
  async function confirmAction() {
    if (!form || busy || (confirmation === "discard" && !canDiscardDraft)) return;
    if (confirmation === "publish" && (needsCorePreparation || dirty || needsReload)) return;
    setBusy(true); setMessage("");
    try {
      const result = confirmation === "publish"
        ? await api.publishFormTemplateVersion(form.templateId, form.versionId, form.rowVersion)
        : await api.discardFormTemplateDraft(form.templateId, form.versionId, form.rowVersion);
      if (!result.ok) { feedback(result.message ?? "The form version could not be changed."); return; }
      const published = confirmation === "publish"; setConfirmation(null); clearNavigation();
      if (await loadVersion(form.templateId)) feedback(published ? "Form published. New entries will use this version; existing records keep their saved version." : "Draft discarded. The published form is unchanged.", "success");
    } catch { feedback("The form version could not be changed. Try again."); }
    finally { setBusy(false); }
  }

  const modules = [...new Map(templates.map(item => [item.moduleKey, item.moduleName])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const visible = templates.filter(item => (!moduleKey || item.moduleKey === moduleKey) && (moduleFilter === "all" || item.moduleKey === moduleFilter)
    && `${item.name} ${item.moduleName} ${item.templateKey}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
  const invalid = (id: string) => ({ "aria-invalid": errors.some(error => error.id === id) || undefined,
    "aria-describedby": errors.some(error => error.id === id) ? `${id}-summary-error` : undefined });
  return <div className="form-stack admin-form-versions">
    <section className="panel"><div className="panel-heading"><div><h2>Form versions and questions</h2><p className="muted-copy">Choose a form, create a draft and preview your changes before publishing. Existing records keep their original questions and answers.</p></div></div>
      <div className="form-grid form-grid-two"><label className="entry-field"><span>Find a form</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search form or module" /></label>
        {!moduleKey ? <label className="entry-field"><span>Module</span><select value={moduleFilter} onChange={event => setModuleFilter(event.target.value)}><option value="all">All modules</option>{modules.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label> : null}</div>
      <label className="entry-field"><span>Form template</span><select aria-label="Choose form template" disabled={busy || isLoading} value={form?.templateId ?? ""} onChange={event => void navigate(event.target.value)}>
        {!form ? <option value="">{isLoading ? "Loading forms…" : "Choose a form"}</option> : null}
        {form && !visible.some(item => item.id === form.templateId) ? <option value={form.templateId}>{form.name} · Current selection (outside filters)</option> : null}
        {modules.map(([key, name]) => visible.some(item => item.moduleKey === key) ? <optgroup key={key} label={name}>{visible.filter(item => item.moduleKey === key).map(item => <option key={item.id} value={item.id}>{item.name}{item.assignedOrgUnits.length ? ` · ${item.assignedOrgUnits.map(unit => unit.code).join(", ")}` : ""}</option>)}</optgroup> : null)}
      </select></label><p className="muted-copy" role="status">{visible.length} matching {visible.length === 1 ? "form" : "forms"}. Search or filter by module to narrow the list.</p>
      {!isLoading && !visible.length ? <p className="muted-copy">No forms match your search.</p> : null}
      {listFailed ? <Button onClick={() => void loadTemplates()}>Retry loading forms</Button> : null}
    </section>
    {!confirmation ? <WorkflowFeedback message={message} tone={tone} /> : null}
    <WorkflowErrorSummary errors={errors} />
    {isLoading ? <LoadingState label="Loading form version…" /> : null}
    {form && draft ? <section className="panel"><div className="panel-heading"><div><h2>{form.name}</h2><p className="muted-copy">{form.moduleKey.replaceAll("_", " ")} · {form.status} · {form.submissionCount} saved {form.submissionCount === 1 ? "entry" : "entries"}</p></div>
      <label className="entry-field"><span>Version</span><select aria-label="Choose form version" disabled={busy || isLoading} value={form.versionId} onChange={event => void navigate(form.templateId, event.target.value)}>{form.versions.map(version => <option key={version.id} value={version.id}>{version.version} · {version.status} · {version.submissionCount} entries</option>)}</select></label></div>
      <div className="toolbar"><Button icon={Copy} disabled={busy || isLoading || needsReload} onClick={() => void createDraft()}>Create draft copy</Button><Button icon={Eye} aria-pressed={preview} onClick={() => setPreview(current => !current)}>{preview ? "Back to questions" : "Preview form"}</Button><Button disabled={busy || isLoading} onClick={() => void navigate(form.templateId, form.versionId)}>Reload version</Button>
        {isDraft ? <><Button icon={Save} busy={busy} disabled={(!dirty && !needsCorePreparation) || isLoading || needsReload} onClick={() => void save()}>Save draft</Button><Button icon={Send} variant="primary" disabled={busy || isLoading || dirty || needsReload || needsCorePreparation} onClick={() => { if (needsCorePreparation) return; setPreview(false); const found = validate(); setErrors(found); if (!found.length) setConfirmation("publish"); }}>Publish version</Button><Button icon={Trash2} disabled={busy || isLoading || needsReload || !canDiscardDraft} onClick={() => setConfirmation("discard")}>Discard draft</Button></> : null}</div>
      <p className="muted-copy">{needsCorePreparation ? "Save draft once to prepare required workflow questions before publication." : isDraft ? dirty ? "You have unsaved changes. Save the draft before publishing." : "This is a saved draft. Staff continue using the published version until you publish it." : "This saved version is read-only. Create a draft copy to make changes."}</p>
      {isDraft && !canDiscardDraft ? <p className="muted-copy">This is the first version of the form. Keep it until it is published; an unused Work Scrutiny template can be retired in Work Scrutiny template setup.</p> : null}
      {form.templateKey === "learning_walk_core" ? <p className="record-context-note">Learning Walk and ALS Learning Walk share this form. Publishing a version changes the questions for new entries in both workflows.</p> : null}
      {form.moduleKey === "work_scrutiny" ? <p className="record-context-note">Course level and delivery area use your question wording and guidance within the fixed Sample and Context groups. Section titles and order arrange the additional questions; they do not move these workflow controls.</p> : null}
      {form.moduleKey === "cpd" ? <p className="record-context-note">CSV imports cannot answer additional questions. Adding a required question may block CPD imports; the import preview will explain any required answers the CSV cannot supply. Optional additional questions remain blank on imported entries.</p> : null}
      <details><summary>Version history</summary><ul>{form.versions.map(version => <li key={version.id}><Button variant="quiet" disabled={busy || isLoading} onClick={() => void navigate(form.templateId, version.id)}>Version {version.version} · {version.status}</Button><small>{version.submissionCount} saved entries{version.createdAt ? ` · Created ${new Date(version.createdAt).toLocaleDateString("en-GB")}` : ""}</small></li>)}</ul></details>
      {preview ? <FormVersionPreview sections={draft.sections} /> : <fieldset disabled={!isDraft || busy || isLoading || needsReload} className="form-stack"><legend className="sr-only">Edit draft questions</legend>
        <div className="form-grid form-grid-two"><label className="entry-field"><span>Form name <strong>Required</strong></span><input id="admin-version-name" maxLength={250} {...invalid("admin-version-name")} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label><label className="entry-field"><span>Description</span><textarea maxLength={1000} value={draft.description ?? ""} onChange={event => setDraft({ ...draft, description: event.target.value })} rows={2} /></label></div>
        {draft.sections.map((section, sectionIndex) => <section className="entry-section" key={section.id}><div className="panel-heading"><label className="entry-field"><span>Section name</span><input id={`admin-section-${section.id}`} maxLength={250} {...invalid(`admin-section-${section.id}`)} value={section.title} onChange={event => updateSection(section.id, { title: event.target.value })} /></label><div className="toolbar"><Button icon={ArrowUp} aria-label={`Move section ${section.title} up`} disabled={sectionIndex === 0} onClick={() => setDraft({ ...draft, sections: ordered(move(draft.sections, sectionIndex, -1)) })}>Up</Button><Button icon={ArrowDown} aria-label={`Move section ${section.title} down`} disabled={sectionIndex === draft.sections.length - 1} onClick={() => setDraft({ ...draft, sections: ordered(move(draft.sections, sectionIndex, 1)) })}>Down</Button><Button icon={Trash2} disabled={section.fields.some(field => field.isProtected)} onClick={() => setDraft({ ...draft, sections: ordered(draft.sections.filter(item => item.id !== section.id)) })}>Remove section</Button></div></div>
          {section.fields.some(field => field.isProtected) ? <p className="muted-copy">This section contains workflow fields and must stay in the form.</p> : null}
          {section.fields.map((field, fieldIndex) => <article className="panel form-stack" key={field.id}>
            <div className="panel-heading"><strong>Question {fieldIndex + 1}{field.isProtected ? " · Workflow field" : " · Additional question"}</strong><div className="toolbar"><Button icon={ArrowUp} aria-label={`Move ${field.label} up`} disabled={fieldIndex === 0} onClick={() => updateSection(section.id, { fields: ordered(move(section.fields, fieldIndex, -1)) })}>Up</Button><Button icon={ArrowDown} aria-label={`Move ${field.label} down`} disabled={fieldIndex === section.fields.length - 1} onClick={() => updateSection(section.id, { fields: ordered(move(section.fields, fieldIndex, 1)) })}>Down</Button><Button icon={Trash2} disabled={field.isProtected} onClick={() => updateSection(section.id, { fields: ordered(section.fields.filter(item => item.id !== field.id)) })}>Remove question</Button></div></div>
            <label className="entry-field"><span>Question wording <strong>Required</strong></span><input id={`admin-question-${field.id}`} maxLength={300} {...invalid(`admin-question-${field.id}`)} value={field.label} onChange={event => updateQuestion(section.id, field.id, { label: event.target.value })} /></label>
            <label className="entry-field"><span>Help and guidance</span><textarea maxLength={1000} rows={2} value={field.helpText ?? ""} onChange={event => updateQuestion(section.id, field.id, { helpText: event.target.value })} /></label>
            <div className="form-grid form-grid-two"><label className="entry-field"><span>Answer type</span><select disabled={field.isProtected} value={field.fieldType} onChange={event => updateQuestion(section.id, field.id, { fieldType: event.target.value, options: choiceTypes.has(event.target.value) ? field.options?.length ? field.options : ["Option 1", "Option 2"] : [] })}>{!questionTypes.some(([key]) => key === field.fieldType) ? <option value={field.fieldType}>{field.fieldType.replaceAll("_", " ")}</option> : null}{questionTypes.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label><label className="compact-check"><input type="checkbox" disabled={field.isProtected} checked={field.isRequired} onChange={event => updateQuestion(section.id, field.id, { isRequired: event.target.checked })} /><span>Required before submission</span></label></div>
            {choiceTypes.has(field.fieldType) ? <label className="entry-field"><span>Answer choices · one per line</span><textarea id={`admin-options-${field.id}`} {...invalid(`admin-options-${field.id}`)} disabled={field.isProtected} rows={4} value={(field.options ?? []).join("\n")} onChange={event => updateQuestion(section.id, field.id, { options: event.target.value.split("\n") })} /></label> : null}
            {field.isProtected ? <small className="muted-copy">You can change the wording, guidance and order. Its answer type, requirement, choices and section support the workflow and are protected.</small> : null}
          </article>)}
          {!section.fields.length ? <p className="muted-copy">Add questions to this section.</p> : null}<Button icon={Plus} disabled={draft.sections.reduce((count, item) => count + item.fields.length, 0) >= 300} onClick={() => addQuestion(section)}>Add question</Button>
        </section>)}
        <Button id="admin-version-add-section" icon={Plus} disabled={draft.sections.length >= 50} onClick={addSection}>Add section</Button>
      </fieldset>}
    </section> : null}
    {confirmation && form ? <ModalDialog label={confirmation === "publish" ? "Publish form version" : "Discard form draft"} busy={busy} onClose={() => setConfirmation(null)}><div className="form-stack"><h2>{confirmation === "publish" ? `Publish ${form.name}?` : `Discard the draft of ${form.name}?`}</h2><p>{confirmation === "publish" ? "New entries will use this version. Existing records keep their original questions and answers." : "This removes the unpublished draft and any unsaved changes in it. The published version and existing entries remain available."}</p><WorkflowFeedback message={message} tone={tone} /><div className="toolbar toolbar-end"><Button data-dialog-initial-focus disabled={busy} onClick={() => setConfirmation(null)}>Cancel</Button><Button busy={busy} variant="primary" onClick={() => void confirmAction()}>{confirmation === "publish" ? "Publish version" : "Discard draft"}</Button></div></div></ModalDialog> : null}
  </div>;
}

function FormVersionPreview({ sections }: { sections: Section[] }) {
  return <div className="form-stack"><p className="muted-copy">Preview only. Answers entered here are not saved. Workflow-specific pickers use their normal data when staff open the form.</p>{sections.map(section => <section className="entry-section" key={section.id}><h3>{section.title}</h3><div className="entry-field-grid">{section.fields.map(field => <PreviewQuestion key={field.id} field={field} />)}</div></section>)}</div>;
}
function PreviewQuestion({ field }: { field: Question }) {
  const [value, setValue] = useState(""); const id = `admin-preview-${field.id}`;
  const options = field.fieldType === "yes_no_partial" ? ["Yes", "Partially", "No"] : field.options ?? [];
  if (["multi_select", "checkbox_group"].includes(field.fieldType)) return <fieldset className="entry-field"><legend>{field.label}{field.isRequired ? " · Required" : ""}</legend>{options.map((option, index) => <label key={`${option}-${index}`}><input type="checkbox" /><span>{option}</span></label>)}{field.helpText ? <small>{field.helpText}</small> : null}</fieldset>;
  return <label className="entry-field" htmlFor={id}><span>{field.label}{field.isRequired ? <strong>Required</strong> : null}</span>{field.fieldType === "long_text" ? <textarea id={id} rows={4} value={value} onChange={event => setValue(event.target.value)} /> : ["single_select", "rubric_scale", "yes_no_partial"].includes(field.fieldType) ? <select id={id} value={value} onChange={event => setValue(event.target.value)}><option value="">Select response</option>{options.map((option, index) => <option key={`${option}-${index}`} value={option}>{option}</option>)}</select> : ["short_text", "number", "date"].includes(field.fieldType) ? <input id={id} type={field.fieldType === "short_text" ? "text" : field.fieldType} step={field.fieldType === "number" ? "any" : undefined} value={value} onChange={event => setValue(event.target.value)} /> : <input id={id} readOnly value={`${field.fieldType.replaceAll("_", " ")} · workflow control`} />}{field.helpText ? <small>{field.helpText}</small> : null}</label>;
}
