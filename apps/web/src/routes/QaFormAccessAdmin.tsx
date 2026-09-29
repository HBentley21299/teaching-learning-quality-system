import { useUnsavedChanges } from "../components/UnsavedChangesGuard";
import { useCallback, useEffect, useState } from "react";
import { Search, ShieldCheck, Users } from "lucide-react";
import { Button } from "../design-system/Button";
import { api } from "../services/api";
import type { CurrentUser, QaFormAccessSetting } from "../services/types";

function sameAccess(left: QaFormAccessSetting, right?: QaFormAccessSetting) {
  return !!right && left.restrictQaStaff === right.restrictQaStaff
    && [...left.staffIds].sort().join(",") === [...right.staffIds].sort().join(",");
}

export function QaFormAccessAdmin({ user, onDirtyChange }: { user: CurrentUser; onDirtyChange?: (dirty: boolean, saving?: boolean) => void }) {
  const [saved, setSaved] = useState<QaFormAccessSetting[]>([]);
  const [draft, setDraft] = useState<QaFormAccessSetting[]>([]);
  const [staff, setStaff] = useState<{ staffId: string; displayName: string; email: string }[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const permitted = user.permissions.includes("qa_reviews.manage");
  const dirty = draft.some(form => !sameAccess(form, saved.find(item => item.templateId === form.templateId)));
  const clearGuard = useUnsavedChanges({ label: "QA form access", dirty, saving, onSave: save, onDiscard: () => { setDraft(saved); clearGuard(); } });
  const selected = draft.find(form => form.templateId === selectedId);
  const visibleStaff = staff.filter(person => `${person.displayName} ${person.email}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const load = useCallback(async () => {
    setLoading(true); setError(""); setMessage("");
    try {
      const result = await api.qaFormAccessSettings();
      setSaved(result.forms); setDraft(result.forms); setStaff(result.staff);
      setSelectedId(current => result.forms.some(form => form.templateId === current) ? current : result.forms[0]?.templateId ?? "");
    } catch { setError("QA form access settings could not be loaded. Try again."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (permitted) void load(); }, [load, permitted]);
  useEffect(() => { onDirtyChange?.(dirty || saving, saving); }, [dirty, saving, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty || saving) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, saving]);
  function updateSelected(patch: Partial<Pick<QaFormAccessSetting, "restrictQaStaff" | "staffIds">>) {
    setDraft(current => current.map(form => form.templateId === selectedId ? { ...form, ...patch } : form));
    setMessage("");
  }
  async function save() {
    if (!dirty || saving) return false;
    setSaving(true); setError(""); setMessage("");
    try {
      for (const form of draft) {
        const previous = saved.find(item => item.templateId === form.templateId);
        if (!previous || sameAccess(form, previous)) continue;
        const result = await api.saveQaFormAccessSetting(form.templateId, {
          restrictQaStaff: form.restrictQaStaff, staffIds: form.staffIds, rowVersion: previous.rowVersion
        });
        if (!result.ok || !result.data) {
          setError(`${form.activityName} — ${form.templateName}: ${result.message ?? "Access could not be saved."} Any earlier changes were saved; remaining changes are still marked as unsaved.`);
          return false;
        }
        const updated = result.data;
        setSaved(current => current.map(item => item.templateId === updated.templateId ? updated : item));
        setDraft(current => current.map(item => item.templateId === updated.templateId ? updated : item));
      }
      setMessage("QA form access saved. Changes apply to new forms and further edits to existing evidence, including saved drafts."); clearGuard(); return true;
    } catch { setError("The save could not finish. Any earlier changes were saved; remaining changes are still marked as unsaved. Try again."); return false; }
    finally { setSaving(false); }
  }
  if (!permitted) return <p role="alert">You need permission to manage QA reviews to edit form access.</p>;
  if (loading) return <p role="status">Loading QA form access…</p>;
  return <section className="panel qa-form-access-admin">
    <div className="section-heading"><div><h2>QA form access</h2><p>Choose which QA Staff can complete and edit each form. Dashboard and report access stays unchanged.</p></div><ShieldCheck aria-hidden="true" size={24} /></div>
    <p className="muted-copy">These settings apply wherever the form template is used, including existing reviews and saved drafts. QA managers and staff with separate college-wide submission rights keep their existing access. Selecting someone here does not grant the QA Staff role or access to additional review teams.</p>
    {error ? <div className="api-error-banner" role="alert">{error}<Button disabled={saving} onClick={() => void load()}>Discard changes and reload</Button></div> : null}
    {message ? <div className="success-banner" role="status">{message}</div> : null}
    {!draft.length ? <p className="empty-state">No QA forms are available to configure.</p> : <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="qa-form-access-layout">
        <nav className="qa-form-access-forms" aria-label="QA form access templates">{draft.map(form => {
          const changed = !sameAccess(form, saved.find(item => item.templateId === form.templateId));
          return <button key={form.templateId} type="button" disabled={saving} aria-pressed={selectedId === form.templateId} className={selectedId === form.templateId ? "is-selected" : ""} onClick={() => { setSelectedId(form.templateId); setSearch(""); }}><strong>{form.templateName}</strong><small>{form.activityName}</small><span>{form.restrictQaStaff ? `${form.staffIds.length} selected` : "All QA Staff"}{changed ? " · Unsaved" : ""}</span></button>;
        })}</nav>
        {selected ? <div className="qa-form-access-detail">
          <div><p className="eyebrow">{selected.activityName}</p><h3>{selected.templateName}</h3></div>
          <fieldset className="qa-form-access-mode" disabled={saving}>
            <legend>Who can complete and edit this form?</legend>
            <label className={!selected.restrictQaStaff ? "is-selected" : ""}><input name={`qa-access-${selected.templateId}`} type="radio" checked={!selected.restrictQaStaff} onChange={() => updateSelected({ restrictQaStaff: false })} /><span><strong>All QA Staff</strong><small>Use existing role and review permissions.</small></span></label>
            <label className={selected.restrictQaStaff ? "is-selected" : ""}><input name={`qa-access-${selected.templateId}`} type="radio" checked={selected.restrictQaStaff} onChange={() => updateSelected({ restrictQaStaff: true })} /><span><strong>Selected QA Staff only</strong><small>Limit this form to the people selected below.</small></span></label>
          </fieldset>
          {selected.restrictQaStaff ? <fieldset className="qa-form-access-staff" disabled={saving}>
            <legend><Users aria-hidden="true" size={18} /> Allowed QA Staff <span>{selected.staffIds.length} selected</span></legend>
            <label className="qa-form-access-search"><Search aria-hidden="true" size={18} /><span className="sr-only">Search QA Staff</span><input type="search" placeholder="Search by name or email" value={search} onChange={event => setSearch(event.target.value)} /></label>
            {selected.staffIds.some(id => !staff.some(person => person.staffId === id)) ? <p className="muted-copy">Some saved selections are no longer active QA Staff. They do not gain access through this list. Clear the selection to rebuild it from the current staff shown below.</p> : null}
            <div className="toolbar"><Button disabled={saving || !selected.staffIds.length} onClick={() => updateSelected({ staffIds: [] })} variant="quiet">Clear selection</Button></div>
            {selected.staffIds.length === 0 ? <p className="notice-row">No QA Staff are selected. Only people with other qualifying permissions will be able to complete or edit this form.</p> : null}
            <div className="qa-form-access-staff-list">{visibleStaff.map(person => <label key={person.staffId}><input type="checkbox" checked={selected.staffIds.includes(person.staffId)} onChange={event => updateSelected({ staffIds: event.target.checked ? [...selected.staffIds, person.staffId] : selected.staffIds.filter(id => id !== person.staffId) })} /><span><strong>{person.displayName}</strong><small>{person.email}</small></span></label>)}</div>
            {!visibleStaff.length ? <p className="muted-copy">{staff.length ? "No QA Staff match your search." : "No active QA Staff are available. Assign the role in staff permissions before selecting people here."}</p> : null}
          </fieldset> : <p className="muted-copy">QA Staff with access to the review can complete this form. Any saved selections are retained if you switch back to selected staff.</p>}
        </div> : null}
      </div>
      <div className="toolbar"><button className="button button-primary" type="submit" disabled={!dirty || saving}>{saving ? "Saving…" : "Save form access"}</button><Button disabled={!dirty || saving} onClick={() => { setDraft(saved); setMessage(""); setError(""); }}>Cancel changes</Button>{dirty ? <span className="muted-copy">Unsaved changes</span> : null}</div>
    </form>}
  </section>;
}
