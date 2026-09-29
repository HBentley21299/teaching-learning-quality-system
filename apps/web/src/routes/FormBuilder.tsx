import { confirmUnsavedNavigation, useUnsavedChanges } from "../components/UnsavedChangesGuard";
import type { LearningWalkDeliveryArea } from "../services/learningWalkDeliveryAreas";
import { useEffect, useMemo, useState } from "react";
import { Archive, ArrowDown, ArrowUp, CheckCircle2, Copy, Eye, Plus, Save, Settings2, Trash2 } from "lucide-react";
import { Button } from "../design-system/Button";
import { api } from "../services/api";
import type { CurrentUser, FormFieldDefinition, FormTemplateSummary, OrgUnitSummary } from "../services/types";

type EditableSection = { id: string; sectionKey: string; title: string; displayOrder: number; fields: EditableField[] };
type EditableField = FormFieldDefinition & { fieldType: string };
type TemplateEditor = { templateId: string; name: string; orgUnitId: string; sections: EditableSection[] };
const fieldTypeOptions = [
  { value: "short_text", label: "Short text" }, { value: "long_text", label: "Long text" },
  { value: "number", label: "Number" }, { value: "date", label: "Date" },
  { value: "yes_no_partial", label: "Yes / No / Partial" }, { value: "single_select", label: "Single choice" },
  { value: "multi_select", label: "Multiple choice" }, { value: "checkbox_group", label: "Checklist" },
  { value: "rubric_scale", label: "Rubric scale" }
];

export function FormBuilder({ embedded = false, user, moduleKey, onDirtyChange }: {
  embedded?: boolean; user: CurrentUser; moduleKey?: string; onDirtyChange?: (dirty: boolean, saving?: boolean) => void;
}) {
  const [templates, setTemplates] = useState<FormTemplateSummary[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnitSummary[]>([]);
  const [deliveryAreas, setDeliveryAreas] = useState<LearningWalkDeliveryArea[]>([]);
  const [cpdThemes, setCpdThemes] = useState<string[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [editor, setEditor] = useState<TemplateEditor | null>(null);
  const [savedEditor, setSavedEditor] = useState<TemplateEditor | null>(null);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [newTemplateOrgUnitId, setNewTemplateOrgUnitId] = useState("");
  const [studioStatus, setStudioStatus] = useState("");
  const [loadError, setLoadError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [reloadDefinition, setReloadDefinition] = useState(0);
  const [view, setView] = useState<"editor" | "preview">("editor");
  const canManageForms = user.permissions.includes("forms.manage");
  const availableTemplates = useMemo(() => templates.filter((template) => !moduleKey || template.moduleKey === moduleKey), [moduleKey, templates]);
  const selectedTemplate = availableTemplates.find((template) => template.id === selectedTemplateId)
    ?? availableTemplates.find((template) => template.status !== "Archived") ?? availableTemplates[0];
  const canEditSelected = Boolean(selectedTemplate?.isEditable && selectedTemplate.status === "Draft" && selectedTemplate.submissionCount === 0);
  const formDirty = Boolean(editor && savedEditor && JSON.stringify(editor) !== JSON.stringify(savedEditor));
  const contentDirty = formDirty;
  const creationDirty = Boolean(newTemplateName || newTemplateOrgUnitId);
  const dirty = contentDirty || creationDirty;
  const clearGuard = useUnsavedChanges({ label: "Form layout and wording", dirty, saving: isSaving, onSave: creationDirty ? undefined : () => saveDraft(), onDiscard: discardChanges });
  const allocatableOrgUnits = orgUnits.filter((unit) => ["team", "faculty_child_code", "faculty_child"].includes(unit.orgUnitType));

  useEffect(() => {
    if (canManageForms) void refreshStudio();
    // Loading is explicitly refreshed after writes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManageForms]);

  useEffect(() => {
    onDirtyChange?.(dirty || isSaving, isSaving);
  }, [dirty, isSaving, onDirtyChange]);

  useEffect(() => {
    if (!dirty && !isSaving) return;
    const preventLeave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", preventLeave);
    return () => window.removeEventListener("beforeunload", preventLeave);
  }, [dirty, isSaving]);

  useEffect(() => {
    let cancelled = false;
    setEditor(null);
    setSavedEditor(null);
    setLoadError("");
    if (!selectedTemplate || selectedTemplate.status === "Archived") return;
    api.formDefinition(selectedTemplate.templateKey).then((definition) => {
      if (cancelled) return;
      const next = buildEditor(selectedTemplate, definition.sections);
      setEditor(next);
      setSavedEditor(next);
    }).catch((error: unknown) => {
      if (cancelled) return;
      // The definition endpoint returns 404 for a genuinely empty draft because its query joins fields.
      // No counts are exposed on FormTemplateSummary, so never convert other HTTP/network errors to blank forms.
      if (error instanceof Error && /^404\b/.test(error.message) && selectedTemplate.moduleKey === "work_scrutiny"
        && selectedTemplate.status === "Draft" && selectedTemplate.submissionCount === 0) {
        const next = buildEditor(selectedTemplate, []);
        setEditor(next);
        setSavedEditor(next);
      } else {
        setLoadError("This form could not be loaded. Retry before making changes.");
      }
    });
    return () => { cancelled = true; };
    // Summary refreshes should not replace an unsaved editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTemplate?.id, selectedTemplate?.status, selectedTemplate?.version, reloadDefinition]);

  async function refreshStudio() {
    setIsLoading(true);
    try {
      const [nextTemplates, nextOrgUnits, nextLookups] = await Promise.all([api.formTemplates(), api.orgUnits(), api.lookups()]);
      setTemplates(nextTemplates);
      setOrgUnits(nextOrgUnits.filter((unit) => unit.isActive));
      setCpdThemes(nextLookups.find((lookup) => lookup.lookupKey === "cpd_theme")?.values ?? []);
      return nextTemplates;
    } catch {
      setStudioStatus("Form templates could not be loaded from the API. Try reloading.");
      return [] as FormTemplateSummary[];
    } finally { setIsLoading(false); }
  }

  useEffect(() => {
    if (selectedTemplate?.moduleKey !== "learning_walks") return;
    let cancelled = false;
    api.learningWalkDeliveryAreas().then((areas) => {
      if (!cancelled) setDeliveryAreas(areas.filter((area) => area.isActive));
    }).catch(() => { if (!cancelled) setStudioStatus("Learning Walk delivery areas could not be loaded."); });
    return () => { cancelled = true; };
  }, [selectedTemplate?.moduleKey]);

  function discardChanges() {
    setEditor(savedEditor);
    setNewTemplateName("");
    setNewTemplateOrgUnitId("");
    setStudioStatus("Unsaved changes discarded."); clearGuard();
  }

  function structureRequest(value: TemplateEditor) {
    return {
      name: value.name.trim(), orgUnitId: value.orgUnitId || undefined,
      sections: value.sections.map((section, sectionIndex) => ({
        sectionKey: section.sectionKey, title: section.title.trim(), displayOrder: sectionIndex + 1,
        fields: section.fields.map((field, fieldIndex) => ({
          fieldKey: field.fieldKey, label: field.label.trim(), fieldType: field.fieldType,
          isRequired: field.isRequired, displayOrder: (fieldIndex + 1) * 10, helpText: field.helpText?.trim() || undefined,
          options: (field.options ?? []).map((option) => option.trim()).filter(Boolean)
        }))
      }))
    };
  }

  async function createWorkScrutinyTemplate(copy = false) {
    if (isSaving || contentDirty) return;
    const source = copy && editor ? copyableWorkScrutinyEditor(editor) : null;
    const name = newTemplateName.trim();
    const orgUnit = orgUnits.find((unit) => unit.id === newTemplateOrgUnitId);
    if (!name || !orgUnit) {
      setStudioStatus("Enter a name and select a sub-team for the new draft.");
      return;
    }
    if (copy && (!source || selectedTemplate?.moduleKey !== "work_scrutiny")) return;
    setIsSaving(true);
    try {
      const result = await api.createFormTemplate({ moduleKey: "work_scrutiny", name, orgUnitId: orgUnit.id });
      if (!result.ok) { setStudioStatus(result.message ?? "The draft could not be created."); return; }
      const payload: unknown = result.data;
      const createdId = payload && typeof payload === "object" && "id" in payload && typeof payload.id === "string" ? payload.id : "";
      if (!createdId) {
        await refreshStudio();
        setStudioStatus("A draft was created, but its ID was not returned. Select it from the form menu; do not create it again.");
        return;
      }
      let copyFailed = "";
      if (source) {
        const result = await api.updateFormTemplateStructure(createdId, structureRequest({ ...source, name, orgUnitId: orgUnit.id }));
        if (!result.ok) copyFailed = result.message ?? "The form content could not be copied.";
      }
      await refreshStudio();
      setSelectedTemplateId(createdId);
      setView("editor");
      setNewTemplateName("");
      setNewTemplateOrgUnitId("");
      setStudioStatus(copyFailed
        ? `The empty draft “${name}” was retained. ${copyFailed} Open it to add content; nothing was published.`
        : `${name} ${source ? "copied to a new draft" : "created"} for ${orgUnit.code}. Review and save before publishing.`);
    } finally { setIsSaving(false); }
  }

  async function saveDraft(publish = false) {
    if (!editor || !selectedTemplate || !canEditSelected || isSaving) return false;
    if (editor.sections.some((section) => section.fields.length === 0)) {
      setStudioStatus("Each section needs at least one question. Add a question or remove the empty section before saving.");
      return false;
    }
    setIsSaving(true);
    try {
      const result = await api.updateFormTemplateStructure(selectedTemplate.id, structureRequest(editor));
      if (!result.ok) { setStudioStatus(result.message ?? "The draft could not be saved. Nothing was published."); return false; }
      setSavedEditor(editor);
      if (publish) {
        const published = await api.publishFormTemplate(selectedTemplate.id);
        setStudioStatus(published.ok
          ? `${editor.name} published. This version is now protected; copy it to a new draft for future structural changes.`
          : `Draft saved, but publication failed. ${published.message ?? "Check its sub-team allocation."}`);
      } else setStudioStatus(`${editor.name} draft saved.`);
      await refreshStudio();
      setReloadDefinition((value) => value + 1);
      if (!creationDirty) clearGuard();
      return true;
    } finally { setIsSaving(false); }
  }

  async function archiveTemplate() {
    if (!selectedTemplate || dirty || isSaving) return;
    if (!window.confirm(`Archive “${selectedTemplate.name}”? Existing submissions stay available, but new submissions will no longer use this template.`)) return;
    setIsSaving(true);
    try {
      const result = await api.archiveFormTemplate(selectedTemplate.id);
      if (result.ok) {
        await refreshStudio();
        setStudioStatus("Template archived. Existing submissions and reporting remain available.");
      } else setStudioStatus(result.message ?? "The template could not be archived.");
    } finally { setIsSaving(false); }
  }

  function updateEditor(changes: Partial<TemplateEditor>) {
    if (canEditSelected && !isSaving) setEditor((current) => current ? { ...current, ...changes } : current);
  }
  function updateSection(id: string, changes: Partial<EditableSection>) {
    updateEditor({ sections: editor?.sections.map((section) => section.id === id ? { ...section, ...changes } : section) });
  }
  function updateField(sectionId: string, fieldId: string, changes: Partial<EditableField>) {
    updateEditor({ sections: editor?.sections.map((section) => section.id === sectionId ? {
      ...section, fields: section.fields.map((field) => field.id === fieldId ? { ...field, ...changes } : field)
    } : section) });
  }
  function addSection() {
    if (!editor) return;
    updateEditor({ sections: [...editor.sections, {
      id: createId("section"), sectionKey: createKey("section"), title: "New section", displayOrder: editor.sections.length + 1, fields: []
    }] });
  }
  function addField(section: EditableSection) {
    updateSection(section.id, { fields: [...section.fields, {
      id: createId("field"), fieldKey: createKey("field"), label: "New question", fieldType: "short_text",
      isRequired: false, displayOrder: (section.fields.length + 1) * 10, options: []
    }] });
  }
  function moveSection(index: number, direction: -1 | 1) {
    if (editor) updateEditor({ sections: moveItem(editor.sections, index, direction) });
  }
  function removeSection(section: EditableSection) {
    if (!editor || !window.confirm(`Remove “${section.title}” and its ${section.fields.length} questions from this draft?`)) return;
    updateEditor({ sections: editor.sections.filter((item) => item.id !== section.id) });
  }

  if (!canManageForms) return <section className="panel"><h2>Access restricted</h2><p>You do not have permission to manage forms.</p></section>;
  const controlsDisabled = !canEditSelected || isSaving;
  return (
    <div className="route-stack form-editor-template-workspace">
      {!embedded ? <div className="route-header"><div><p className="eyebrow">Form administration</p><h1>Form editor</h1></div></div> : null}
      {studioStatus ? <div className="notice-row" role="status">{studioStatus}</div> : null}
      {dirty ? <div className="notice-row" role="status"><span>You have unsaved changes. Save your edits, create the new draft, or discard changes before switching forms.</span><Button disabled={isSaving} onClick={discardChanges}>Discard changes</Button></div> : null}
      <div className="form-studio-layout">
        <section className="panel form-template-picker">
          <label className="studio-field"><span>Form template</span><select disabled={isSaving || isLoading} value={selectedTemplate?.id ?? ""} onChange={async (event) => { const next = event.target.value; if (!await confirmUnsavedNavigation()) return; setSelectedTemplateId(next); setStudioStatus(""); }}>
            {availableTemplates.length === 0 ? <option value="">{isLoading ? "Loading forms…" : "No form templates"}</option> : null}
            {availableTemplates.map((template) => <option key={template.id} value={template.id}>{template.name} · {template.status}{template.assignedOrgUnits.length ? ` · ${template.assignedOrgUnits.map((unit) => unit.code).join(", ")}` : ""}</option>)}
          </select></label>
          {(!moduleKey || moduleKey === "work_scrutiny") ? <details className="template-create-block"><summary>Create a Work Scrutiny draft</summary>
            <p className="muted-copy">Create a blank form or copy the selected Work Scrutiny questions. Controlled context, sample and actions are supplied automatically. Publishing a replacement requires archiving the previous template for that sub-team.</p>
            <label className="studio-field"><span>New draft name</span><input disabled={isSaving || contentDirty} onChange={(event) => setNewTemplateName(event.target.value)} value={newTemplateName} /></label>
            <label className="studio-field"><span>Allocated sub-team</span><select disabled={isSaving || contentDirty} onChange={(event) => setNewTemplateOrgUnitId(event.target.value)} value={newTemplateOrgUnitId}><option value="">Select sub-team</option>{allocatableOrgUnits.map((unit) => <option key={unit.id} value={unit.id}>{formatOrgUnitOption(unit)}</option>)}</select></label>
            <div className="toolbar"><Button disabled={isSaving || contentDirty || !newTemplateName.trim() || !newTemplateOrgUnitId} icon={Plus} onClick={() => void createWorkScrutinyTemplate()} variant="primary">Create blank draft</Button>
              {selectedTemplate?.moduleKey === "work_scrutiny" && editor ? <Button disabled={isSaving || contentDirty || !newTemplateName.trim() || !newTemplateOrgUnitId} icon={Copy} onClick={() => void createWorkScrutinyTemplate(true)}>Copy selected form</Button> : null}</div>
          </details> : null}
        </section>
        {loadError ? <section className="panel"><p role="alert">{loadError}</p><Button onClick={() => setReloadDefinition((value) => value + 1)}>Retry</Button></section> : null}
        {!selectedTemplate && !isLoading ? <section className="panel"><p>No templates are available for this form family.</p><Button onClick={() => void refreshStudio()}>Reload templates</Button></section> : null}
        {selectedTemplate?.status === "Archived" ? <section className="panel"><h2>{selectedTemplate.name}</h2><p>This template is archived. Existing submissions remain available in records and reporting.</p></section> : null}
        {selectedTemplate && !editor && !loadError && selectedTemplate.status !== "Archived" ? <p className="muted-copy">Loading form content…</p> : null}
        {editor && selectedTemplate && editor.templateId === selectedTemplate.id ? <div className="form-studio-main">
          <section className="panel">
            <div className="panel-heading"><div><h2>{editor.name}</h2><span>{selectedTemplate.moduleName} · {selectedTemplate.status} · Version {selectedTemplate.version ?? "0.1"}</span></div><span>{editor.sections.length} sections · {countFields(editor.sections)} questions</span></div>
            <p className="muted-copy">{canEditSelected ? "Edit the wording, order and response options in this unused draft. Technical keys are protected automatically." : "This version is protected to preserve submissions and reporting. Use the associated choices and lists to customise available values."}</p>
            {selectedTemplate.moduleKey === "work_scrutiny" ? <div className="work-scrutiny-core-contract"><div><strong>Context</strong><span>Faculty, sub-team, date and reviewer</span></div><div><strong>Sample</strong><span>Course selection stays consistent</span></div><div><strong>Actions</strong><span>Owners, dates and reporting stay protected</span></div></div> : null}
            <div className="template-meta-grid"><label className="studio-field"><span>Form name</span><input disabled={controlsDisabled} onChange={(event) => updateEditor({ name: event.target.value })} value={editor.name} /></label>
              {selectedTemplate.moduleKey === "work_scrutiny" ? <label className="studio-field"><span>Allocated sub-team</span><select disabled={controlsDisabled} onChange={(event) => updateEditor({ orgUnitId: event.target.value })} value={editor.orgUnitId}><option value="">Select sub-team</option>{allocatableOrgUnits.map((unit) => <option key={unit.id} value={unit.id}>{formatOrgUnitOption(unit)}</option>)}</select></label> : null}</div>
            <div className="template-action-strip"><span className={canEditSelected ? "editable-label" : "locked-label"}>{canEditSelected ? "Unused draft · editable" : "Structure protected"}</span>
              {canEditSelected ? <><Button disabled={isSaving} icon={Save} onClick={() => void saveDraft()}>Save draft</Button><Button disabled={isSaving || countFields(editor.sections) === 0} icon={CheckCircle2} onClick={() => void saveDraft(true)} variant="primary">Save and publish</Button></> : null}
              {selectedTemplate.isEditable ? <Button disabled={isSaving || dirty} icon={Archive} onClick={() => void archiveTemplate()}>Archive template</Button> : null}</div>
          </section>
          <div className="toolbar" role="group" aria-label="Form view"><button type="button" className={`button button-${view === "editor" ? "primary" : "secondary"}`} aria-pressed={view === "editor"} onClick={() => setView("editor")}><Settings2 size={16} aria-hidden="true" />Questions &amp; layout</button><button type="button" className={`button button-${view === "preview" ? "primary" : "secondary"}`} aria-pressed={view === "preview"} onClick={() => setView("preview")}><Eye size={16} aria-hidden="true" />Preview</button></div>
          <div className="form-designer-grid">
            {view === "editor" ? <section className="panel"><div className="panel-heading"><h2>Questions & layout</h2>{canEditSelected ? <Button disabled={isSaving} icon={Plus} onClick={addSection}>Add section</Button> : null}</div>
              {editor.sections.length === 0 ? <p className="empty-row">Add a section, then add the questions it should contain.</p> : null}
              <div className="section-editor-list">{editor.sections.map((section, sectionIndex) => <div className="section-editor-row" key={section.id}>
                <div className="section-title-row"><label className="studio-field"><span>Section {sectionIndex + 1} title</span><input disabled={controlsDisabled} onChange={(event) => updateSection(section.id, { title: event.target.value })} value={section.title} /></label>
                  {canEditSelected ? <div className="toolbar"><Button disabled={isSaving || sectionIndex === 0} icon={ArrowUp} onClick={() => moveSection(sectionIndex, -1)} aria-label={`Move ${section.title} up`}>Up</Button><Button disabled={isSaving || sectionIndex === editor.sections.length - 1} icon={ArrowDown} onClick={() => moveSection(sectionIndex, 1)} aria-label={`Move ${section.title} down`}>Down</Button><Button disabled={isSaving} icon={Trash2} onClick={() => removeSection(section)}>Remove section</Button></div> : null}</div>
                <div className="field-editor-list">{section.fields.map((field, fieldIndex) => <div className="field-editor-row" key={field.id}>
                  <label className="studio-field"><span>Question {fieldIndex + 1}</span><input disabled={controlsDisabled} onChange={(event) => updateField(section.id, field.id, { label: event.target.value })} value={field.label} /></label>
                  <label className="studio-field"><span>Answer type</span><select disabled={controlsDisabled} value={field.fieldType} onChange={(event) => { const fieldType = event.target.value; updateField(section.id, field.id, { fieldType, options: usesConfiguredOptions(fieldType) ? field.options?.length ? field.options : defaultFieldOptions(fieldType) : [] }); }}>
                    {!fieldTypeOptions.some((option) => option.value === field.fieldType) ? <option value={field.fieldType}>{field.fieldType.replaceAll("_", " ")}</option> : null}{fieldTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                  <label className="studio-check"><input checked={field.isRequired} disabled={controlsDisabled} onChange={(event) => updateField(section.id, field.id, { isRequired: event.target.checked })} type="checkbox" /><span>Required answer</span></label>
                  <label className="studio-field field-editor-help"><span>Guidance shown below the question</span><textarea disabled={controlsDisabled} rows={2} onChange={(event) => updateField(section.id, field.id, { helpText: event.target.value })} value={field.helpText ?? ""} /></label>
                  {usesConfiguredOptions(field.fieldType) && (canEditSelected || Boolean(field.options?.length)) ? <label className="studio-field field-editor-options"><span>Response options · one per line</span><textarea disabled={controlsDisabled} rows={4} onChange={(event) => updateField(section.id, field.id, { options: event.target.value.split(/\r?\n/) })} value={(field.options ?? []).join("\n")} /><small>Use 2–20 distinct options. These choices belong to this template version.</small></label> : null}
                  <details className="field-editor-help"><summary>Protected reference keys</summary><label className="studio-field"><span>Section key</span><input readOnly value={section.sectionKey} /></label><label className="studio-field"><span>Question key</span><input readOnly value={field.fieldKey} /></label></details>
                  {canEditSelected ? <div className="toolbar field-editor-help"><Button disabled={isSaving || fieldIndex === 0} icon={ArrowUp} onClick={() => updateSection(section.id, { fields: moveItem(section.fields, fieldIndex, -1) })} aria-label={`Move ${field.label} up`}>Up</Button><Button disabled={isSaving || fieldIndex === section.fields.length - 1} icon={ArrowDown} onClick={() => updateSection(section.id, { fields: moveItem(section.fields, fieldIndex, 1) })} aria-label={`Move ${field.label} down`}>Down</Button><Button disabled={isSaving} icon={Trash2} onClick={() => updateSection(section.id, { fields: section.fields.filter((item) => item.id !== field.id) })}>Remove question</Button></div> : null}
                </div>)}{canEditSelected ? <Button disabled={isSaving} icon={Plus} onClick={() => addField(section)}>Add question</Button> : null}</div>
              </div>)}</div>
            </section> : <section className="panel preview-panel"><div className="panel-heading"><h2>Form preview</h2><span>{formDirty ? "Includes unsaved changes" : selectedTemplate.status}</span></div><p className="muted-copy">Preview of the configured questions. Staff selection, course samples and actions are supplied by the form workflow.</p><TemplatePreview deliveryAreas={deliveryAreas} cpdThemes={cpdThemes} orgUnits={orgUnits} sections={editor.sections} /></section>}
          </div>
        </div> : null}
      </div>
    </div>
  );
}

function copyableWorkScrutinyEditor(editor: TemplateEditor): TemplateEditor {
  const reservedSections = new Set(["context", "sample", "actions"]);
  const reservedFields = new Set(["scrutiny_date", "faculty_area", "team_level", "reviewer", "course_sample", "recommended_actions"]);
  return { ...editor, sections: editor.sections
    .filter((section) => !reservedSections.has(section.sectionKey.toLowerCase()))
    .map((section) => ({ ...section, fields: section.fields.filter((field) => !reservedFields.has(field.fieldKey.toLowerCase())) }))
    .filter((section) => section.fields.length > 0) };
}

function createKey(prefix: string) { return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`; }
function moveItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items;
  const result = [...items];
  [result[index], result[target]] = [result[target], result[index]];
  return result;
}
function buildEditor(template: FormTemplateSummary, sections: Array<{
  id: string;
  sectionKey: string;
  title: string;
  displayOrder: number;
  fields: FormFieldDefinition[];
}>): TemplateEditor {
  return {
    templateId: template.id,
    name: template.name,
    orgUnitId: template.assignedOrgUnits[0]?.id ?? "",
    sections: sections
      .map((section) => ({
        id: section.id,
        sectionKey: section.sectionKey,
        title: section.title,
        displayOrder: section.displayOrder,
        fields: section.fields.map((field) => ({ ...field, options: field.options ?? [] })).sort((left, right) => left.displayOrder - right.displayOrder)
      }))
      .sort((a, b) => a.displayOrder - b.displayOrder)
  };
}

function TemplatePreview({
  deliveryAreas,
  cpdThemes,
  orgUnits,
  sections
}: {
  deliveryAreas: LearningWalkDeliveryArea[];
  cpdThemes: string[];
  orgUnits: OrgUnitSummary[];
  sections: EditableSection[];
}) {
  if (sections.length === 0) {
    return <p className="muted-copy">Add a section and fields to preview the template.</p>;
  }

  return (
    <div className="preview-form">
      {sections.map((section) => (
        <div className="preview-section" key={section.id}>
          <h3>{section.title}</h3>
          <div className="preview-field-grid">
            {section.fields.filter((field) => !["team_bulk_add", "selected_staff_list"].includes(field.fieldType)).map((field) => (
              <label
                className={isWidePreviewField(field.fieldType) ? "preview-field preview-field-wide" : "preview-field"}
                key={field.id}
              >
                <span>
                  {field.label}
                  {field.isRequired ? <strong>Required</strong> : null}
                </span>
                {renderPreviewControl(field, orgUnits, cpdThemes, deliveryAreas)}
                {field.helpText ? <small>{field.helpText}</small> : null}
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function renderPreviewControl(
  field: EditableField,
  orgUnits: OrgUnitSummary[],
  cpdThemes: string[],
  deliveryAreas: LearningWalkDeliveryArea[]
) {
  field = { ...field, options: field.options?.map((option) => option.trim()).filter(Boolean) };
  if (field.fieldType === "learning_walk_delivery_area") {
    return <select disabled defaultValue=""><option value="">Select delivery area</option>{deliveryAreas.map((area) => <option key={area.key} value={area.key}>{area.name}</option>)}</select>;
  }
  if (field.fieldType === "date") {
    return <input disabled type="date" />;
  }

  if (field.fieldType === "datetime") {
    return <input defaultValue={new Date().toISOString().slice(0, 16)} disabled type="datetime-local" />;
  }

  if (field.fieldType === "faculty_lookup") {
    return (
      <select defaultValue="" disabled>
        <option value="">Select faculty</option>
        {orgUnits
          .filter((orgUnit) => orgUnit.orgUnitType === "faculty")
          .map((orgUnit) => (
            <option key={orgUnit.id} value={orgUnit.id}>
              {orgUnit.code} - {orgUnit.name}
            </option>
          ))}
      </select>
    );
  }

  if (field.fieldType === "team_lookup") {
    return (
      <select defaultValue="" disabled>
        <option value="">Select team or child code</option>
        {orgUnits
          .filter((orgUnit) => ["team", "faculty_child_code", "faculty_child"].includes(orgUnit.orgUnitType))
          .map((orgUnit) => (
            <option key={orgUnit.id} value={orgUnit.id}>
              {orgUnit.code} - {orgUnit.name}
            </option>
          ))}
      </select>
    );
  }

  if (field.fieldType === "staff_lookup") {
    return (
      <select defaultValue="" disabled>
        <option value="">Select staff member</option>
      </select>
    );
  }

  if (field.fieldType === "staff_multi_select") {
    return (
      <div className="preview-cpd-participants">
        <input disabled placeholder="Search by name, email or staff ID" />
        <select defaultValue="" disabled>
          <option value="">Add faculty or sub-team</option>
        </select>
      </div>
    );
  }

  if (field.fieldType === "auto_text") {
    return <input readOnly value="Auto-filled by the form" />;
  }

  if (field.fieldType === "checkbox_group") {
    return (
      <div className="preview-check-list">
        {(field.options?.length ? field.options : cpdThemes).map((option) => (
          <label key={option}>
            <input disabled type="checkbox" />
            <span>{option}</span>
          </label>
        ))}
      </div>
    );
  }

  if (field.fieldType === "multi_select") {
    return (
      <div className="preview-check-list">
        {(field.options ?? []).map((option) => (
          <label key={option}>
            <input disabled type="checkbox" />
            <span>{option}</span>
          </label>
        ))}
      </div>
    );
  }

  if (field.fieldType === "team_bulk_add") {
    return (
      <div className="preview-inline-action">
        <select defaultValue="" disabled>
          <option value="">Search faculty, department, curriculum area or team code</option>
          {orgUnits.map((orgUnit) => (
            <option key={orgUnit.id} value={orgUnit.id}>
              {orgUnit.code} - {orgUnit.name}
            </option>
          ))}
        </select>
        <button disabled type="button">
          Bulk add
        </button>
      </div>
    );
  }

  if (field.fieldType === "selected_staff_list") {
    return (
      <div className="preview-participant-list">
        <div>
          <span>Example staff member</span>
          <button disabled type="button">
            Remove
          </button>
        </div>
      </div>
    );
  }

  if (field.fieldType === "long_text") {
    return <textarea disabled placeholder="Long text response" rows={4} />;
  }

  if (field.fieldType === "number") {
    return <input disabled placeholder="0" type="number" />;
  }

  if (field.fieldType === "yes_no_partial") {
    return (
      <select defaultValue="" disabled>
        <option value="">Select answer</option>
        <option>Yes</option>
        <option>Partially</option>
        <option>No</option>
      </select>
    );
  }

  if (field.fieldType === "single_select") {
    return (
      <select defaultValue="" disabled>
        <option value="">Select option</option>
        {(field.options ?? []).map((option) => <option key={option}>{option}</option>)}
      </select>
    );
  }

  if (field.fieldType === "rubric_scale") {
    return (
      <select defaultValue="" disabled>
        <option value="">Select rubric level</option>
        {(field.options ?? []).map((option) => <option key={option}>{option}</option>)}
      </select>
    );
  }

  return <input disabled placeholder="Short text response" />;
}

function countFields(sections: EditableSection[]) {
  return sections.reduce((total, section) => total + section.fields.length, 0);
}

function formatOrgUnitOption(orgUnit: OrgUnitSummary) {
  const level = orgUnit.orgUnitType === "faculty" ? "Faculty" : "Team";
  return `${level}: ${orgUnit.code} - ${orgUnit.name}`;
}

function isWidePreviewField(fieldType: string) {
  return ["long_text", "checkbox_group", "multi_select", "staff_multi_select", "team_bulk_add", "selected_staff_list"].includes(
    fieldType
  );
}

function usesConfiguredOptions(fieldType: string) {
  return ["single_select", "multi_select", "checkbox_group", "rubric_scale"].includes(fieldType);
}

function defaultFieldOptions(fieldType: string) {
  if (fieldType === "rubric_scale") {
    return ["1 - Emerging", "2 - Secure", "3 - Strong"];
  }
  return ["Option 1", "Option 2"];
}

function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}
