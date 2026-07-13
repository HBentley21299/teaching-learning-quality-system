import { useEffect, useMemo, useState } from "react";
import { Archive, CheckCircle2, Eye, Lock, Plus, Save, Settings2 } from "lucide-react";
import { Button } from "../design-system/Button";
import { api } from "../services/api";
import type {
  CurrentUser,
  FormFieldDefinition,
  FormTemplateSummary,
  LearningWalkThemeMappingSummary,
  OrgUnitSummary
} from "../services/types";

type ModuleKey = "learning_walks" | "work_scrutiny" | "cpd";

type EditableSection = {
  id: string;
  sectionKey: string;
  title: string;
  displayOrder: number;
  fields: EditableField[];
};

type EditableField = FormFieldDefinition & {
  fieldType: string;
};

type TemplateEditor = {
  templateId: string;
  name: string;
  orgUnitId: string;
  sections: EditableSection[];
};

const managedModuleOrder: ModuleKey[] = ["learning_walks", "work_scrutiny", "cpd"];

const systemFieldTypeOptions = [
  { value: "short_text", label: "Short text" },
  { value: "long_text", label: "Long text" },
  { value: "date", label: "Date" },
  { value: "datetime", label: "Date and time" },
  { value: "faculty_lookup", label: "Faculty lookup" },
  { value: "team_lookup", label: "Team lookup" },
  { value: "staff_lookup", label: "Staff lookup" },
  { value: "staff_multi_select", label: "Staff multi-select" },
  { value: "auto_text", label: "Auto text" },
  { value: "single_select", label: "Single select" },
  { value: "checkbox_group", label: "Checkbox group" },
  { value: "team_bulk_add", label: "Bulk team add" },
  { value: "selected_staff_list", label: "Selected staff list" },
  { value: "number", label: "Number" },
  { value: "yes_no_partial", label: "Yes / No / Partial" }
];

const workScrutinyFieldTypeOptions = [
  { value: "short_text", label: "Short text" },
  { value: "long_text", label: "Long text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "yes_no_partial", label: "Yes / No / Partial" },
  { value: "single_select", label: "Single choice" },
  { value: "multi_select", label: "Multiple choice" },
  { value: "checkbox_group", label: "Checklist" },
  { value: "rubric_scale", label: "Rubric scale" }
];

export function FormBuilder({ embedded = false, user }: { embedded?: boolean; user: CurrentUser }) {
  const [templates, setTemplates] = useState<FormTemplateSummary[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnitSummary[]>([]);
  const [themeMappings, setThemeMappings] = useState<LearningWalkThemeMappingSummary[]>([]);
  const [cpdThemes, setCpdThemes] = useState<string[]>([]);
  const [themeDrafts, setThemeDrafts] = useState<Record<string, string>>({});
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [editor, setEditor] = useState<TemplateEditor | null>(null);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [newTemplateOrgUnitId, setNewTemplateOrgUnitId] = useState("");
  const [studioStatus, setStudioStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const canManageForms = user.permissions.includes("forms.manage");
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) ?? templates[0];
  // The API only lets unpublished Work Scrutiny templates be restructured;
  // Learning Walk and CPD templates are system controlled.
  const canEditSelected = Boolean(
    selectedTemplate?.isEditable && selectedTemplate.status === "Draft" && selectedTemplate.submissionCount === 0
  );

  useEffect(() => {
    if (!canManageForms) {
      return;
    }

    void refreshStudio();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManageForms]);

  useEffect(() => {
    if (!selectedTemplate) {
      setEditor(null);
      return;
    }

    let cancelled = false;
    api
      .formDefinition(selectedTemplate.templateKey)
      .then((definition) => {
        if (!cancelled) {
          setEditor(buildEditor(selectedTemplate, definition.sections));
        }
      })
      .catch(() => {
        // Newly created templates have no sections yet, which the API reports as 404.
        if (!cancelled) {
          setEditor(buildEditor(selectedTemplate, []));
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTemplate?.id, selectedTemplate?.version, selectedTemplate?.status]);

  async function refreshStudio() {
    try {
      const [nextTemplates, nextOrgUnits, nextMappings, nextLookups] = await Promise.all([
        api.formTemplates(),
        api.orgUnits(),
        api.learningWalkThemeMappings(),
        api.lookups()
      ]);
      setTemplates(nextTemplates);
      setOrgUnits(nextOrgUnits.filter((orgUnit) => orgUnit.isActive));
      setThemeMappings(nextMappings);
      setCpdThemes(nextLookups.find((lookup) => lookup.lookupKey === "cpd_theme")?.values ?? []);
      setThemeDrafts(Object.fromEntries(nextMappings.map((mapping) => [mapping.childOrgUnitId, mapping.agreedTheme])));
      return nextTemplates;
    } catch {
      setStudioStatus("Form templates could not be loaded from the API.");
      return [] as FormTemplateSummary[];
    }
  }

  const groupedTemplates = useMemo(() => {
    return managedModuleOrder.map((moduleKey) => ({
      moduleKey,
      moduleName: moduleLabel(moduleKey),
      templates: templates.filter((template) => template.moduleKey === moduleKey)
    }));
  }, [templates]);

  const allocatableOrgUnits = orgUnits.filter((orgUnit) =>
    ["team", "faculty_child_code", "faculty_child"].includes(orgUnit.orgUnitType)
  );

  const themeRows = orgUnits
    .filter((orgUnit) => ["team", "faculty_child_code", "faculty_child"].includes(orgUnit.orgUnitType))
    .map((childOrgUnit) => ({
      childOrgUnit,
      faculty: orgUnits.find((orgUnit) => orgUnit.id === childOrgUnit.parentOrgUnitId),
      mapping: themeMappings.find((mapping) => mapping.childOrgUnitId === childOrgUnit.id)
    }))
    .filter((row) => row.faculty);

  async function createWorkScrutinyTemplate() {
    const name = newTemplateName.trim();
    const orgUnit = orgUnits.find((unit) => unit.id === newTemplateOrgUnitId);

    if (!name || !orgUnit) {
      setStudioStatus("Add a template name and allocation before creating the Work Scrutiny template.");
      return;
    }

    setIsSaving(true);
    const result = await api.createFormTemplate({
      moduleKey: "work_scrutiny",
      name,
      orgUnitId: orgUnit.id
    });
    setIsSaving(false);

    if (!result.ok) {
      setStudioStatus(result.message ?? "The Work Scrutiny template could not be created.");
      return;
    }

    const nextTemplates = await refreshStudio();
    const created = nextTemplates
      .filter((template) => template.moduleKey === "work_scrutiny" && template.name === name)
      .at(-1);
    if (created) {
      setSelectedTemplateId(created.id);
    }

    setNewTemplateName("");
    setNewTemplateOrgUnitId("");
    setStudioStatus(`${name} created for ${orgUnit.code}.`);
  }

  async function saveDraft() {
    if (!editor || !selectedTemplate || !canEditSelected) {
      setStudioStatus("This template cannot be edited.");
      return;
    }

    setIsSaving(true);
    const result = await api.updateFormTemplateStructure(selectedTemplate.id, {
      name: editor.name,
      orgUnitId: editor.orgUnitId || undefined,
      sections: editor.sections.map((section, sectionIndex) => ({
        sectionKey: section.sectionKey,
        title: section.title,
        displayOrder: sectionIndex + 1,
        fields: section.fields.map((field, fieldIndex) => ({
          fieldKey: field.fieldKey,
          label: field.label,
          fieldType: field.fieldType,
          isRequired: field.isRequired,
          displayOrder: (fieldIndex + 1) * 10,
          helpText: field.helpText || undefined,
          options: field.options ?? []
        }))
      }))
    });
    setIsSaving(false);

    if (result.ok) {
      setStudioStatus(`${editor.name} draft saved.`);
      await refreshStudio();
    } else {
      setStudioStatus(result.message ?? "The template draft could not be saved.");
    }
  }

  async function publishSelectedTemplate() {
    if (!selectedTemplate || !canEditSelected) {
      return;
    }

    setIsSaving(true);
    const result = await api.publishFormTemplate(selectedTemplate.id);
    setIsSaving(false);

    if (result.ok) {
      setStudioStatus(`${selectedTemplate.name} published. Published templates are locked for editing.`);
      await refreshStudio();
    } else {
      setStudioStatus(result.message ?? "The template could not be published.");
    }
  }

  async function archiveTemplate(templateId: string) {
    setIsSaving(true);
    const result = await api.archiveFormTemplate(templateId);
    setIsSaving(false);

    if (result.ok) {
      setStudioStatus("Template archived. It remains visible for audit history.");
      await refreshStudio();
    } else {
      setStudioStatus(result.message ?? "The template could not be archived.");
    }
  }

  async function saveThemeMapping(facultyOrgUnitId: string, childOrgUnitId: string) {
    const agreedTheme = themeDrafts[childOrgUnitId]?.trim();
    if (!agreedTheme) {
      setStudioStatus("Add an agreed Learning Walk theme before saving.");
      return;
    }

    setIsSaving(true);
    const result = await api.updateLearningWalkThemeMapping({ facultyOrgUnitId, childOrgUnitId, agreedTheme });
    setIsSaving(false);

    if (result.ok) {
      setStudioStatus("Learning Walk theme saved.");
      try {
        const nextMappings = await api.learningWalkThemeMappings();
        setThemeMappings(nextMappings);
      } catch {
        // keep the previous mapping list when a refresh fails
      }
    } else {
      setStudioStatus(result.message ?? "The Learning Walk theme could not be saved.");
    }
  }

  function updateEditor(changes: Partial<TemplateEditor>) {
    if (!canEditSelected) {
      return;
    }

    setEditor((current) => (current ? { ...current, ...changes } : current));
  }

  function updateSection(sectionId: string, changes: Partial<EditableSection>) {
    updateEditor({
      sections: editor?.sections.map((section) => (section.id === sectionId ? { ...section, ...changes } : section))
    });
  }

  function addSection() {
    if (!editor || !canEditSelected) {
      return;
    }

    const sectionNumber = editor.sections.length + 1;
    updateEditor({
      sections: [
        ...editor.sections,
        {
          id: createId("section"),
          sectionKey: `section_${sectionNumber}`,
          title: `New section ${sectionNumber}`,
          displayOrder: sectionNumber,
          fields: []
        }
      ]
    });
    setStudioStatus("Section added. Save the draft to keep it.");
  }

  function updateField(sectionId: string, fieldId: string, changes: Partial<EditableField>) {
    updateEditor({
      sections: editor?.sections.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              fields: section.fields.map((field) => (field.id === fieldId ? { ...field, ...changes } : field))
            }
          : section
      )
    });
  }

  function addField(sectionId: string) {
    if (!editor || !canEditSelected) {
      return;
    }

    updateEditor({
      sections: editor.sections.map((section) => {
        if (section.id !== sectionId) {
          return section;
        }

        const fieldNumber = section.fields.length + 1;
        return {
          ...section,
          fields: [
            ...section.fields,
            {
              id: createId("field"),
              fieldKey: `field_${fieldNumber}`,
              label: "New field",
              fieldType: "short_text",
              isRequired: false,
              displayOrder: fieldNumber * 10,
              options: []
            }
          ]
        };
      })
    });
    setStudioStatus("Field added. Save the draft to keep it.");
  }

  if (!canManageForms) {
    return (
      <div className="route-stack">
        {!embedded ? (
          <div className="route-header">
            <div>
              <p className="eyebrow">Template admin</p>
              <h1>Form templates</h1>
            </div>
          </div>
        ) : null}
        <section className="panel">
          <div className="panel-heading">
            <h2>Access restricted</h2>
            <span>Admin only</span>
          </div>
          <p className="muted-copy">You do not have permission to manage form templates.</p>
        </section>
      </div>
    );
  }

  if (!selectedTemplate || !editor) {
    return (
      <div className="route-stack">
        {!embedded ? (
          <div className="route-header">
            <div>
              <p className="eyebrow">Template admin</p>
              <h1>Form Studio</h1>
            </div>
          </div>
        ) : null}
        <section className="panel">
          <p className="muted-copy">{studioStatus || "Loading form templates..."}</p>
        </section>
      </div>
    );
  }

  return (
    <div className="route-stack">
      {!embedded ? (
        <div className="route-header">
          <div>
            <p className="eyebrow">Template admin</p>
            <h1>Form Studio</h1>
          </div>
          <div className="toolbar">
            <Button disabled={!canEditSelected || isSaving} icon={Save} onClick={() => void saveDraft()}>
              Save draft
            </Button>
          </div>
        </div>
      ) : (
        <section className="panel">
          <div className="panel-heading">
            <h2>Form Studio</h2>
            <Button disabled={!canEditSelected || isSaving} icon={Save} onClick={() => void saveDraft()}>
              Save draft
            </Button>
          </div>
          <p className="muted-copy">Create sub-team Work Scrutiny templates while the universal context, course sample and actions remain controlled.</p>
        </section>
      )}

      {studioStatus ? <div className="notice-row">{studioStatus}</div> : null}

      <div className="form-studio-layout">
        <aside className="panel form-template-rail">
          <div className="panel-heading">
            <h2>Templates</h2>
            <span>{templates.length} total</span>
          </div>

          <div className="template-create-block">
            <input
              aria-label="New Work Scrutiny template name"
              onChange={(event) => setNewTemplateName(event.target.value)}
              placeholder="Work Scrutiny template name"
              value={newTemplateName}
            />
            <select
              aria-label="Allocated sub-team"
              onChange={(event) => setNewTemplateOrgUnitId(event.target.value)}
              value={newTemplateOrgUnitId}
            >
              <option value="">Allocate to sub-team</option>
              {allocatableOrgUnits.map((orgUnit) => (
                <option key={orgUnit.id} value={orgUnit.id}>
                  {formatOrgUnitOption(orgUnit)}
                </option>
              ))}
            </select>
            <Button disabled={isSaving} icon={Plus} onClick={() => void createWorkScrutinyTemplate()} variant="primary">
              Create
            </Button>
          </div>

          <div className="template-group-list">
            {groupedTemplates.map((group) => (
              <div className="template-group" key={group.moduleKey}>
                <div className="template-group-heading">
                  <strong>{group.moduleName}</strong>
                  <span>{group.templates.length}</span>
                </div>
                {group.templates.map((template) => (
                  <button
                    className={
                      template.id === selectedTemplate.id
                        ? "template-select-row template-select-row-active"
                        : "template-select-row"
                    }
                    key={template.id}
                    onClick={() => setSelectedTemplateId(template.id)}
                    type="button"
                  >
                    <span>
                      <strong>{template.name}</strong>
                      <small>{template.templateKey}</small>
                    </span>
                    <span className={`status-pill status-${template.status.toLowerCase()}`}>{template.status}</span>
                    {template.isEditable ? <Settings2 size={15} aria-hidden="true" /> : <Lock size={15} aria-hidden="true" />}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </aside>

        <div className="form-studio-main">
          <section className="panel">
            <div className="panel-heading">
              <h2>{editor.name}</h2>
              <span>{selectedTemplate.moduleName}</span>
            </div>

            <div className="structure-strip">
              <div>
                <strong>{selectedTemplate.version ?? "0.1"}</strong>
                <span>Version</span>
              </div>
              <div>
                <strong>{editor.sections.length}</strong>
                <span>Sections</span>
              </div>
              <div>
                <strong>{countFields(editor.sections)}</strong>
                <span>Fields</span>
              </div>
              <div>
                <strong>{formatOrgUnits(selectedTemplate, editor, orgUnits)}</strong>
                <span>Allocation</span>
              </div>
            </div>

            {selectedTemplate.moduleKey === "work_scrutiny" ? (
              <div className="work-scrutiny-core-contract">
                <div><strong>Context</strong><span>Faculty, sub-team, date and reviewer</span></div>
                <div><strong>Sample</strong><span>Search and select multiple courses</span></div>
                <div><strong>Actions</strong><span>Action, owner and date due</span></div>
              </div>
            ) : null}

            <div className="template-meta-grid">
              <label className="studio-field">
                <span>Template name</span>
                <input
                  disabled={!canEditSelected}
                  onChange={(event) => updateEditor({ name: event.target.value })}
                  value={editor.name}
                />
              </label>
              <label className="studio-field">
                <span>Template key</span>
                <input readOnly value={selectedTemplate.templateKey} />
              </label>
              <label className="studio-field">
                <span>Status</span>
                <input readOnly value={selectedTemplate.status} />
              </label>
              <label className="studio-field">
                <span>Allocated to</span>
                <select
                  disabled={!canEditSelected || selectedTemplate.moduleKey !== "work_scrutiny"}
                  onChange={(event) => updateEditor({ orgUnitId: event.target.value })}
                  value={editor.orgUnitId}
                >
                  <option value="">Select sub-team</option>
                  {allocatableOrgUnits.map((orgUnit) => (
                    <option key={orgUnit.id} value={orgUnit.id}>
                      {formatOrgUnitOption(orgUnit)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="template-action-strip">
              <span className={selectedTemplate.isEditable ? "editable-label" : "locked-label"}>
                {selectedTemplate.isEditable
                  ? selectedTemplate.status === "Draft"
                    ? "Editable template"
                    : "Published - locked for editing"
                  : "Controlled template"}
              </span>
              <Button
                disabled={!canEditSelected || isSaving}
                icon={CheckCircle2}
                onClick={() => void publishSelectedTemplate()}
                variant="primary"
              >
                Publish
              </Button>
              <button
                className="icon-button"
                disabled={!selectedTemplate.isEditable || isSaving}
                onClick={() => void archiveTemplate(selectedTemplate.id)}
                title="Archive template"
                type="button"
              >
                <Archive size={16} aria-hidden="true" />
              </button>
            </div>
          </section>

          <div className="form-designer-grid">
            <section className="panel">
              <div className="panel-heading">
                <h2>Sections and fields</h2>
                <Button disabled={!canEditSelected} icon={Plus} onClick={addSection}>
                  Section
                </Button>
              </div>
              <div className="section-editor-list">
                {editor.sections.map((section) => (
                  <div className="section-editor-row" key={section.id}>
                    <div className="section-title-row">
                      <label className="studio-field">
                        <span>Section title</span>
                        <input
                          disabled={!canEditSelected}
                          onChange={(event) => updateSection(section.id, { title: event.target.value })}
                          value={section.title}
                        />
                      </label>
                      <label className="studio-field">
                        <span>Section key</span>
                        <input
                          disabled={!canEditSelected}
                          onChange={(event) => updateSection(section.id, { sectionKey: event.target.value })}
                          value={section.sectionKey}
                        />
                      </label>
                    </div>

                    <div className="field-editor-list">
                      {section.fields.map((field) => (
                        <div className="field-editor-row" key={field.id}>
                          <label className="studio-field">
                            <span>Label</span>
                            <input
                              disabled={!canEditSelected}
                              onChange={(event) => updateField(section.id, field.id, { label: event.target.value })}
                              value={field.label}
                            />
                          </label>
                          <label className="studio-field">
                            <span>Field key</span>
                            <input
                              disabled={!canEditSelected}
                              onChange={(event) => updateField(section.id, field.id, { fieldKey: event.target.value })}
                              value={field.fieldKey}
                            />
                          </label>
                          <label className="studio-field">
                            <span>Type</span>
                            <select
                              disabled={!canEditSelected}
                              onChange={(event) => {
                                const fieldType = event.target.value;
                                updateField(section.id, field.id, {
                                  fieldType,
                                  options: usesConfiguredOptions(fieldType)
                                    ? field.options?.length ? field.options : defaultFieldOptions(fieldType)
                                    : []
                                });
                              }}
                              value={field.fieldType}
                            >
                              {(selectedTemplate.moduleKey === "work_scrutiny"
                                ? workScrutinyFieldTypeOptions
                                : systemFieldTypeOptions).map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="studio-check">
                            <input
                              checked={field.isRequired}
                              disabled={!canEditSelected}
                              onChange={(event) =>
                                updateField(section.id, field.id, { isRequired: event.target.checked })
                              }
                              type="checkbox"
                            />
                            <span>Required</span>
                          </label>
                          <label className="studio-field field-editor-help">
                            <span>Help text</span>
                            <input
                              disabled={!canEditSelected}
                              onChange={(event) => updateField(section.id, field.id, { helpText: event.target.value })}
                              value={field.helpText ?? ""}
                            />
                          </label>
                          {usesConfiguredOptions(field.fieldType) ? (
                            <label className="studio-field field-editor-options">
                              <span>Response options</span>
                              <textarea
                                disabled={!canEditSelected}
                                onChange={(event) => updateField(section.id, field.id, {
                                  options: event.target.value.split(/\r?\n/).map((option) => option.trim()).filter(Boolean)
                                })}
                                placeholder="One option per line"
                                rows={4}
                                value={(field.options ?? []).join("\n")}
                              />
                            </label>
                          ) : null}
                        </div>
                      ))}
                      <Button disabled={!canEditSelected} icon={Plus} onClick={() => addField(section.id)}>
                        Field
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="panel preview-panel">
              <div className="panel-heading">
                <h2>{selectedTemplate.moduleKey === "work_scrutiny" ? "Faculty response preview" : "Preview"}</h2>
                <span>
                  <Eye size={15} aria-hidden="true" /> {selectedTemplate.status}
                </span>
              </div>
              <TemplatePreview cpdThemes={cpdThemes} orgUnits={orgUnits} sections={editor.sections} themeMappings={themeMappings} />
            </section>
          </div>
        </div>
      </div>

      <section className="panel">
        <div className="panel-heading">
          <h2>Learning Walk themes</h2>
          <span>Faculty and child code mapping</span>
        </div>
        <div className="theme-map-list">
          {themeRows.length === 0 ? (
            <div className="empty-row">No faculty child codes found</div>
          ) : (
            themeRows.map(({ childOrgUnit, faculty, mapping }) => (
              <div className="theme-map-row" key={childOrgUnit.id}>
                <span>{faculty?.code}</span>
                <span>{childOrgUnit.code}</span>
                <input
                  aria-label={`Agreed theme for ${childOrgUnit.code}`}
                  onChange={(event) =>
                    setThemeDrafts((current) => ({ ...current, [childOrgUnit.id]: event.target.value }))
                  }
                  value={themeDrafts[childOrgUnit.id] ?? mapping?.agreedTheme ?? ""}
                />
                <button
                  className="icon-button"
                  disabled={isSaving}
                  onClick={() => void saveThemeMapping(faculty!.id, childOrgUnit.id)}
                  title="Save agreed theme"
                  type="button"
                >
                  <Save size={16} aria-hidden="true" />
                </button>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
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
        fields: section.fields.map((field) => ({ ...field, options: field.options ?? [] }))
      }))
      .sort((a, b) => a.displayOrder - b.displayOrder)
  };
}

function TemplatePreview({
  cpdThemes,
  orgUnits,
  sections,
  themeMappings
}: {
  cpdThemes: string[];
  orgUnits: OrgUnitSummary[];
  sections: EditableSection[];
  themeMappings: LearningWalkThemeMappingSummary[];
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
                {renderPreviewControl(field, orgUnits, themeMappings, cpdThemes)}
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
  themeMappings: LearningWalkThemeMappingSummary[],
  cpdThemes: string[]
) {
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
    return <input readOnly value={themeMappings[0]?.agreedTheme ?? "Auto-filled from mapping"} />;
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

function formatOrgUnits(template: FormTemplateSummary, editor: TemplateEditor, orgUnits: OrgUnitSummary[]) {
  const orgUnitIds = editor.orgUnitId ? [editor.orgUnitId] : template.assignedOrgUnits.map((orgUnit) => orgUnit.id);
  if (orgUnitIds.length === 0) {
    return template.moduleKey === "work_scrutiny" ? "Unallocated" : "System-wide";
  }

  return orgUnitIds
    .map((orgUnitId) => orgUnits.find((orgUnit) => orgUnit.id === orgUnitId)?.code)
    .filter(Boolean)
    .join(", ");
}

function moduleLabel(moduleKey: ModuleKey) {
  if (moduleKey === "learning_walks") {
    return "Learning Walks";
  }

  if (moduleKey === "work_scrutiny") {
    return "Work Scrutiny";
  }

  return "CPD";
}

function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}
