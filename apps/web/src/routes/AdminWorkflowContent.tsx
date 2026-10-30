import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Eye, RefreshCw, RotateCcw, Save, Search } from "lucide-react";
import defaults from "../../../../shared/workflow-form-content.json";
import { Button } from "../design-system/Button";
import { LoadingState } from "../components/LoadingState";
import { WorkflowErrorSummary } from "../components/WorkflowErrorSummary";
import { WorkflowFeedback } from "../components/WorkflowFeedback";
import { confirmUnsavedNavigation, useUnsavedChanges } from "../components/UnsavedChangesGuard";
import { api } from "../services/api";
import { invalidateFormContent } from "../services/formContent";
import { matchesListSearch } from "../services/listQuery";
import type { WorkflowFormContent, WorkflowFormContentField } from "../services/types";
import type { WorkflowFieldError } from "../services/workflowExperience";
import "./AdminWorkflowContent.css";

const editable = (fields: WorkflowFormContentField[]) => fields.map(field => ({ key: field.key, label: field.label, helpText: field.helpText ?? "" }));
const fingerprint = (fields: WorkflowFormContentField[]) => JSON.stringify(editable(fields));

/** Typed workflow fields keep their stable answer keys; this editor changes display copy only. */
export function AdminWorkflowContent({ onDirtyChange }: { onDirtyChange?: (dirty: boolean, saving?: boolean) => void }) {
  const [forms, setForms] = useState<WorkflowFormContent[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [draft, setDraft] = useState<WorkflowFormContentField[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);
  const [preview, setPreview] = useState(false);
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"neutral" | "error" | "success">("neutral");
  const [errors, setErrors] = useState<WorkflowFieldError[]>([]);
  const request = useRef(0);
  const mutationInFlight = useRef(false);
  const latestForms = useRef(forms);
  latestForms.current = forms;
  const prefix = useId();
  const selected = forms.find(form => form.formKey === selectedKey);
  const dirty = Boolean(selected && fingerprint(draft) !== fingerprint(selected.fields));
  const busy = loading || saving;
  const clearNavigation = useUnsavedChanges({ label: "Review and action form wording", dirty, saving,
    onSave: save, onDiscard: () => { if (selected) setDraft(editable(selected.fields)); setErrors([]); setMessage(""); } });
  useEffect(() => { onDirtyChange?.(dirty, saving); }, [dirty, saving, onDirtyChange]);
  useEffect(() => () => { request.current += 1; }, []);
  useEffect(() => () => { onDirtyChange?.(false, false); }, [onDirtyChange]);
  useEffect(() => { void load(); }, []);

  const visibleFields = useMemo(() => draft.filter(field => matchesListSearch(search, field.label, field.helpText,
    defaults.find(form => form.formKey === selectedKey)?.fields.find(item => item.key === field.key)?.label)), [draft, search, selectedKey]);
  const defaultFields = defaults.find(form => form.formKey === selectedKey)?.fields ?? [];

  function feedback(text: string, nextTone: typeof tone = "error") { setMessage(text); setTone(nextTone); }
  function fieldId(key: string, part = "label") { return `${prefix}-${key}-${part}`; }
  function choose(form: WorkflowFormContent) {
    setSelectedKey(form.formKey); setDraft(editable(form.fields)); setSearch(""); setErrors([]); setPreview(false); setMessage("");
  }
  async function load() {
    if (mutationInFlight.current) return;
    const current = ++request.current;
    setLoading(true); setLoadFailed(false);
    try {
      const next = await api.adminFormContent();
      if (current !== request.current) return;
      setForms(next);
      const form = next.find(item => item.formKey === selectedKey) ?? next[0];
      if (form) choose(form); else { setSelectedKey(""); setDraft([]); }
      setNeedsReload(false); clearNavigation();
    } catch {
      if (current === request.current) { setLoadFailed(true); feedback("Form wording could not be loaded. Try again before editing."); }
    } finally { if (current === request.current) setLoading(false); }
  }
  async function selectForm(key: string) {
    if (busy || mutationInFlight.current || key === selectedKey || !await confirmUnsavedNavigation()) return;
    const form = latestForms.current.find(item => item.formKey === key);
    if (form) choose(form);
  }
  async function reload() {
    if (busy || mutationInFlight.current || !await confirmUnsavedNavigation()) return;
    await load();
  }
  function update(key: string, part: "label" | "helpText", value: string) {
    if (busy || needsReload || loadFailed || mutationInFlight.current) return;
    setDraft(fields => fields.map(field => field.key === key ? { ...field, [part]: value } : field));
    setErrors(previous => previous.filter(error => error.id !== fieldId(key, part)));
    setMessage("");
  }
  function restore(key?: string) {
    if (busy || needsReload || loadFailed || mutationInFlight.current) return;
    setDraft(fields => fields.map(field => {
      const original = defaultFields.find(item => item.key === field.key);
      return original && (!key || field.key === key) ? { key: field.key, label: original.label, helpText: "helpText" in original ? String(original.helpText ?? "") : "" } : field;
    }));
    setErrors([]); feedback("Default wording restored in this draft. Save wording to apply it.", "neutral");
  }
  async function save() {
    if (busy || mutationInFlight.current || needsReload || loadFailed || !selected) return false;
    if (!dirty) return true;
    const validation: WorkflowFieldError[] = draft.flatMap(field => {
      const invalid: WorkflowFieldError[] = [];
      if (!field.label.trim() || field.label.trim().length > 300) invalid.push({ id: fieldId(field.key), message: `Enter a label of 1 to 300 characters for ${defaultFields.find(item => item.key === field.key)?.label ?? "this prompt"}.` });
      if ((field.helpText?.trim().length ?? 0) > 1000) invalid.push({ id: fieldId(field.key, "helpText"), message: `Use no more than 1,000 characters of guidance for ${field.label || "this prompt"}.` });
      return invalid;
    });
    setErrors(validation);
    if (validation.length) { setSearch(""); setPreview(false); feedback("Check the highlighted prompts. Your changes are still here."); return false; }
    mutationInFlight.current = true; setSaving(true); setMessage("");
    const current = request.current;
    const formKey = selected.formKey;
    const submitted = draft.map(field => ({ key: field.key, label: field.label.trim(), helpText: field.helpText?.trim() || undefined }));
    try {
      const result = await api.saveFormContent(formKey, submitted, selected.rowVersion);
      if (current !== request.current) return false;
      if (!result.ok) { feedback(result.message ?? "Form wording could not be saved. Your changes are still here."); return false; }
      invalidateFormContent(formKey);
      // The command does not return a row version. Never reuse its old version for a later save.
      setForms(previous => previous.map(form => form.formKey === formKey ? { ...form, fields: submitted } : form));
      setDraft(editable(submitted)); clearNavigation();
      try {
        const fresh = await api.adminFormContent();
        if (current !== request.current) return true;
        const saved = fresh.find(form => form.formKey === formKey);
        if (!saved) throw new Error("Saved form is absent from the returned configuration.");
        setForms(fresh); setDraft(editable(saved.fields)); setNeedsReload(false);
        feedback("Form wording saved. Reopen a workflow to see the updated prompts and guidance.", "success");
      } catch {
        if (current === request.current) { setNeedsReload(true); feedback("Form wording was saved, but its latest version could not be checked. Reload wording before making further changes.", "neutral"); }
      }
      return true;
    } catch {
      if (current === request.current) feedback("Form wording could not be saved. Your changes are still here. Try again.");
      return false;
    } finally {
      mutationInFlight.current = false;
      if (current === request.current) setSaving(false);
    }
  }

  return <section className="panel admin-workflow-content" aria-busy={busy}>
    <div className="panel-heading"><div><h2>Review and action wording</h2><p>Change prompts and guidance for the current display of each workflow form.</p></div></div>
    <p className="muted-copy">Existing answers are retained. Answer types, required rules, owners, visibility and workflow stages stay protected. LIV and ALS LIV share wording. QA questions and versioned template questions have their own editors.</p>
    <WorkflowFeedback message={message} tone={tone} />
    {loading ? <LoadingState label="Loading form wording" /> : null}
    {loadFailed || needsReload ? <div className="toolbar"><Button disabled={busy} onClick={() => void load()}>{needsReload ? "Reload wording" : "Try again"}</Button></div> : null}
    {!loading && !loadFailed && forms.length === 0 ? <p>No configurable workflow prompts are available.</p> : null}
    {selected && !loadFailed ? <>
      <div className="admin-wording-tools">
        <label className="entry-field"><span>Workflow form</span><select value={selectedKey} disabled={busy || needsReload} onChange={event => void selectForm(event.target.value)}>{forms.map(form => <option key={form.formKey} value={form.formKey}>{form.title}</option>)}</select></label>
        <label className="search-box"><Search aria-hidden="true" size={18} /><input aria-label="Find a prompt" type="search" placeholder="Find a prompt or guidance" value={search} disabled={busy || needsReload} onChange={event => setSearch(event.target.value)} /></label>
        <Button icon={Eye} aria-pressed={preview} disabled={busy} onClick={() => setPreview(value => !value)}>{preview ? "Edit wording" : "Preview wording"}</Button>
      </div>
      <p className="muted-copy" role="status">{visibleFields.length} of {draft.length} prompts shown{dirty ? " · Unsaved changes" : ""}.</p>
      <WorkflowErrorSummary errors={errors} />
      {preview ? <section className="admin-wording-preview" aria-label={`${selected.title} wording preview`}><h3>{selected.title} preview</h3><p className="muted-copy">A wording preview. The workflow keeps its own layout and controls.</p>{visibleFields.map(field => <div className="admin-wording-preview-field" key={field.key}><strong>{field.label || "Label needed"}</strong>{field.helpText ? <p>{field.helpText}</p> : <p className="muted-copy">No additional guidance.</p>}</div>)}</section>
        : <fieldset className="admin-wording-fields" disabled={busy || needsReload}><legend className="sr-only">{selected.title} prompts</legend>{visibleFields.map(field => {
          const original = defaultFields.find(item => item.key === field.key);
          const labelError = errors.find(error => error.id === fieldId(field.key));
          const helpError = errors.find(error => error.id === fieldId(field.key, "helpText"));
          return <section className="admin-wording-card" key={field.key}>
            <div className="admin-wording-card-heading"><h3>{original?.label ?? field.label}</h3><Button icon={RotateCcw} disabled={busy || needsReload || !original || fingerprint([field]) === fingerprint([original])} onClick={() => restore(field.key)}>Restore default</Button></div>
            <label className="entry-field" htmlFor={fieldId(field.key)}><span>Prompt label</span><input id={fieldId(field.key)} value={field.label} maxLength={300} required aria-invalid={Boolean(labelError)} aria-describedby={labelError ? `${fieldId(field.key)}-error` : undefined} onChange={event => update(field.key, "label", event.target.value)} />{labelError ? <span id={`${fieldId(field.key)}-error`} className="workflow-field-error">{labelError.message}</span> : null}</label>
            <label className="entry-field" htmlFor={fieldId(field.key, "helpText")}><span>Guidance <span className="muted-copy">(optional)</span></span><textarea id={fieldId(field.key, "helpText")} value={field.helpText ?? ""} maxLength={1000} rows={3} aria-invalid={Boolean(helpError)} aria-describedby={helpError ? `${fieldId(field.key, "helpText")}-error` : undefined} onChange={event => update(field.key, "helpText", event.target.value)} />{helpError ? <span id={`${fieldId(field.key, "helpText")}-error`} className="workflow-field-error">{helpError.message}</span> : null}</label>
          </section>;
        })}</fieldset>}
      {visibleFields.length === 0 ? <div className="table-empty-state"><p>No prompts match your search. Your edits are retained.</p><Button disabled={busy} onClick={() => setSearch("")}>Clear search</Button></div> : null}
      <div className="toolbar admin-wording-actions"><Button variant="primary" icon={Save} busy={saving} disabled={busy || needsReload || !dirty} onClick={() => void save()}>Save wording</Button><Button disabled={busy || needsReload || !dirty} onClick={() => { setDraft(editable(selected.fields)); setErrors([]); setMessage(""); }}>Cancel changes</Button><Button icon={RotateCcw} disabled={busy || needsReload || fingerprint(draft) === fingerprint(defaultFields)} onClick={() => restore()}>Restore all defaults</Button>{!needsReload ? <Button icon={RefreshCw} disabled={busy} onClick={() => void reload()}>Reload saved wording</Button> : null}</div>
      <p className="muted-copy">Restoring defaults changes this draft only. Save wording to apply any changes.</p>
    </> : null}
  </section>;
}
