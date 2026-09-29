import { useUnsavedChanges } from "../components/UnsavedChangesGuard";
import { useCallback, useEffect, useState } from "react";
import { Button } from "../design-system/Button";
import { api } from "../services/api";
import type { CurrentUser, QaOutcomeLabels, QaOutcomeLabelsState, QaNotSeenSetting } from "../services/types";

const fields: { key: keyof QaOutcomeLabels; title: string; help: string }[] = [
  { key: "below", title: "Below the expected standard", help: "Retains the below outcome and reporting position." },
  { key: "at", title: "Meets the expected standard", help: "Retains the at outcome; included in the at-or-above measure." },
  { key: "above", title: "Exceeds the expected standard", help: "Retains the above outcome; included in the at-or-above measure." },
  { key: "notApplicable", title: "Not applicable", help: "Remains excluded from rated totals; a reason is still required where enabled." }
];

export function QaRatingLabelsAdmin({ user, onDirtyChange }: { user: CurrentUser; onDirtyChange?: (dirty: boolean, saving?: boolean) => void }) {
  const [saved, setSaved] = useState<QaOutcomeLabelsState | null>(null);
  const [draft, setDraft] = useState<QaOutcomeLabels | null>(null);
  const [savedSettings, setSavedSettings] = useState<QaNotSeenSetting[]>([]);
  const [draftSettings, setDraftSettings] = useState<QaNotSeenSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const permitted = user.permissions.includes("qa_reviews.manage");
  const wordingDirty = !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved.labels);
  const settingsDirty = draftSettings.some(setting => savedSettings.find(savedSetting => savedSetting.templateId === setting.templateId)?.allowsNotSeen !== setting.allowsNotSeen);
  const dirty = wordingDirty || settingsDirty;
  const clearGuard = useUnsavedChanges({ label: "QA scale settings", dirty, saving, onSave: save, onDiscard: () => { if (saved) setDraft(saved.labels); setDraftSettings(savedSettings); clearGuard(); } });
  const load = useCallback(async () => {
    setLoading(true); setError(""); setMessage("");
    try {
      const [result, settings] = await Promise.all([api.qaOutcomeLabels(), api.qaNotSeenSettings()]);
      setSaved(result); setDraft(result.labels); setSavedSettings(settings); setDraftSettings(settings);
    }
    catch { setError("QA scale settings could not be loaded. Try again."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (permitted) void load(); }, [load, permitted]);
  useEffect(() => { onDirtyChange?.(dirty || saving, saving); }, [dirty, saving, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function save() {
    if (!draft || !saved || saving || (wordingDirty && !saved.rowVersion)) return false;
    const values = fields.map(field => draft[field.key].trim());
    if (values.some(value => !value || value.length > 40 || /[\u0000-\u001f\u007f-\u009f]/.test(value)) || new Set(values.map(value => value.toLocaleLowerCase())).size !== 4 || values.some(value => value.toLocaleLowerCase() === "not seen")) {
      setError("Use four different labels, each containing 1–40 characters on one line. Not seen is reserved for the neutral outcome."); return false;
    }
    setSaving(true); setError(""); setMessage("");
    try {
      if (wordingDirty) {
        const result = await api.saveQaOutcomeLabels(draft, saved.rowVersion!);
        if (!result.ok || !result.data) { setError(result.message ?? "Outcome wording could not be saved."); return false; }
        setSaved(result.data); setDraft(result.data.labels);
      }
      for (const setting of draftSettings) {
        const previous = savedSettings.find(item => item.templateId === setting.templateId);
        if (!previous || previous.allowsNotSeen === setting.allowsNotSeen) continue;
        const result = await api.saveQaNotSeenSetting(setting.templateId, setting.allowsNotSeen, previous.rowVersion);
        if (!result.ok || !result.data) {
          setError(`${setting.activityName} — ${setting.templateName}: ${result.message ?? "This form setting could not be saved."} Any earlier changes were saved; remaining changes are still marked as unsaved.`);
          return false;
        }
        const updated = result.data;
        setSavedSettings(current => current.map(item => item.templateId === updated.templateId ? updated : item));
        setDraftSettings(current => current.map(item => item.templateId === updated.templateId ? updated : item));
      }
      setMessage("QA scale settings saved. Selected forms can record Not seen without changing rated percentages."); clearGuard(); return true;
    } catch { setError("The save could not finish. Any earlier changes were saved; remaining changes are still marked as unsaved. Try again."); return false; }
    finally { setSaving(false); }
  }
  if (!permitted) return <p role="alert">You need permission to manage QA reviews to edit QA scale settings.</p>;
  if (loading) return <p role="status">Loading QA scale settings…</p>;
  return <section className="panel qa-rating-labels-admin">
    <div className="section-heading"><div><h2>QA scale settings</h2><p>Shared by all QA processes. Change the language people see while keeping the rated outcomes intact, and choose which forms offer Not seen.</p></div></div>
    <p className="muted-copy">These labels appear on existing and new evidence, dashboards and newly generated exports. Previously downloaded files retain their original wording. Saved outcomes, review snapshots and reporting calculations stay unchanged.</p>
    <p className="muted-copy">Keep each label aligned with its meaning below. Use question guidance to explain a different standard; renaming an outcome must not redefine it.</p>
    {error ? <div className="api-error-banner" role="alert">{error} <Button disabled={saving} onClick={() => void load()}>Discard changes and reload</Button></div> : null}
    {message ? <div className="success-banner" role="status">{message}</div> : null}
    {saved && !saved.isAvailable ? <p role="status">Editing will be available after the database upgrade for QA outcome wording. Current forms continue to use the standard labels.</p> : null}
    {draft ? <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset disabled={saving || !saved?.isAvailable} className="qa-rating-label-fields">
        <legend className="sr-only">Display labels for fixed QA outcomes</legend>
        {fields.map(field => <label className="entry-field" key={field.key} htmlFor={`qa-label-${field.key}`}><span>{field.title}</span><input id={`qa-label-${field.key}`} aria-describedby={`qa-label-help-${field.key}`} maxLength={40} required value={draft[field.key]} onChange={event => { setDraft({ ...draft, [field.key]: event.target.value }); setMessage(""); }} /><small id={`qa-label-help-${field.key}`} className="muted-copy">{field.help}</small></label>)}
      </fieldset>
      <fieldset disabled={saving} className="qa-not-seen-settings">
        <legend>Not seen on QA forms</legend>
        <p className="muted-copy" id="qa-not-seen-settings-help">Enable a neutral Not seen option at the left of a form’s scale when evidence may be unavailable. It is recorded separately from Not applicable and excluded from rated totals and percentages. Existing Not seen answers are retained if you later switch it off.</p>
        <div className="qa-not-seen-form-list">{draftSettings.map(setting => <label className="qa-not-seen-form" key={setting.templateId}>
          <input type="checkbox" checked={setting.allowsNotSeen} aria-describedby="qa-not-seen-settings-help" onChange={event => { setDraftSettings(current => current.map(item => item.templateId === setting.templateId ? { ...item, allowsNotSeen: event.target.checked } : item)); setMessage(""); }} />
          <span><strong>{setting.templateName}</strong><small>{setting.activityName}</small></span>
          <span className="qa-not-seen-state">{setting.allowsNotSeen ? "Enabled" : "Off"}</span>
        </label>)}</div>
        {!draftSettings.length ? <p className="muted-copy">No QA forms are available to configure.</p> : null}
      </fieldset>
      <div className="toolbar"><button type="submit" className="button button-primary" disabled={!dirty || saving || (wordingDirty && !saved?.isAvailable)}>{saving ? "Saving…" : "Save scale settings"}</button><Button disabled={!dirty || saving} onClick={() => { if (saved) setDraft(saved.labels); setDraftSettings(savedSettings); setError(""); setMessage(""); }}>Cancel changes</Button>{dirty ? <span className="muted-copy">Unsaved changes</span> : null}</div>
    </form> : null}
  </section>;
}
