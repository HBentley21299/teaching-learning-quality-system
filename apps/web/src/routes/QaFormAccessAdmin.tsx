import { useUnsavedChanges } from "../components/UnsavedChangesGuard";
import { useCallback, useEffect, useRef, useState } from "react";
import { Search, ShieldCheck, Users } from "lucide-react";
import { Button } from "../design-system/Button";
import { LoadingState } from "../components/LoadingState";
import { api } from "../services/api";
import type { CurrentUser, QaFormAccessSetting, QaFormAccessSettings } from "../services/types";
import { AdminListSort } from "../components/AdminListSort";
import { distinctListValues, matchesListSearch, sortListRows } from "../services/listQuery";

function sameAccess(left: QaFormAccessSetting, right?: QaFormAccessSetting) {
  return !!right && left.restrictQaStaff === right.restrictQaStaff
    && [...left.staffIds].sort().join(",") === [...right.staffIds].sort().join(",");
}

export function QaFormAccessAdmin({ user, onDirtyChange }: { user: CurrentUser; onDirtyChange?: (dirty: boolean, saving?: boolean) => void }) {
  const [saved, setSaved] = useState<QaFormAccessSetting[]>([]);
  const [draft, setDraft] = useState<QaFormAccessSetting[]>([]);
  const [staff, setStaff] = useState<QaFormAccessSettings["staff"]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [formSearch, setFormSearch] = useState("");
  const [activity, setActivity] = useState("");
  const [accessFilter, setAccessFilter] = useState("");
  const [formSort, setFormSort] = useState("activity-asc");
  const [staffSort, setStaffSort] = useState("name-asc");
  const [selectionFilter, setSelectionFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const mutationInFlight = useRef(false);
  const loadSequence = useRef(0);
  const permitted = user.permissions.includes("qa_reviews.manage");
  const dirty = draft.some(form => !sameAccess(form, saved.find(item => item.templateId === form.templateId)));
  const clearGuard = useUnsavedChanges({ label: "QA form access", dirty, saving, onSave: save, onDiscard: () => { setDraft(saved); clearGuard(); } });
  const selected = draft.find(form => form.templateId === selectedId);
  const visibleStaff = sortListRows(staff.filter(person => matchesListSearch(search, person.displayName, person.email)
    && (!selectionFilter || Boolean(selected?.staffIds.includes(person.staffId)) === (selectionFilter === "selected"))), person => staffSort === "email-asc" ? person.email : person.displayName, "asc", person => person.staffId);
  const visibleForms = sortListRows(draft.filter(form => (!activity || form.activityName === activity)
    && (!accessFilter || form.restrictQaStaff === (accessFilter === "restricted"))
    && matchesListSearch(formSearch, form.templateName, form.activityName, form.restrictQaStaff ? "selected restricted" : "all QA Staff")), form => formSort === "template-asc" ? form.templateName : form.activityName, "asc", form => form.templateName);
  const savedSelection = saved.find(form => form.templateId === selectedId)?.staffIds ?? [];
  const canSelectStaff = (person: QaFormAccessSettings["staff"][number]) => person.isEligibleQaStaff || savedSelection.includes(person.staffId);
  const matchingSelectableIds = visibleStaff.filter(person => canSelectStaff(person) && !selected?.staffIds.includes(person.staffId)).map(person => person.staffId);
  const matchingSelectedIds = visibleStaff.filter(person => selected?.staffIds.includes(person.staffId)).map(person => person.staffId);
  const load = useCallback(async () => {
    if (mutationInFlight.current) return;
    const sequence = ++loadSequence.current;
    setLoading(true); setError(""); setMessage("");
    try {
      const result = await api.qaFormAccessSettings();
      if (sequence !== loadSequence.current) return;
      setSaved(result.forms); setDraft(result.forms); setStaff(result.staff);
      setSelectedId(current => result.forms.some(form => form.templateId === current) ? current : result.forms[0]?.templateId ?? "");
    } catch { if (sequence === loadSequence.current) setError("QA form access settings could not be loaded. Try again."); }
    finally { if (sequence === loadSequence.current) setLoading(false); }
  }, []);
  useEffect(() => { if (permitted) void load(); return () => { loadSequence.current += 1; }; }, [load, permitted]);
  useEffect(() => { onDirtyChange?.(dirty || saving, saving); }, [dirty, saving, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty || saving) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, saving]);
  function updateSelected(patch: Partial<Pick<QaFormAccessSetting, "restrictQaStaff" | "staffIds">>) {
    if (loading || saving || mutationInFlight.current || !permitted) return;
    setDraft(current => current.map(form => form.templateId === selectedId ? { ...form, ...patch } : form));
    setMessage("");
  }
  async function save() {
    if (!permitted || !dirty || loading || saving || mutationInFlight.current) return false;
    mutationInFlight.current = true;
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
    finally { mutationInFlight.current = false; setSaving(false); }
  }
  if (!permitted) return <p role="alert">You need permission to manage QA reviews to edit form access.</p>;
  if (loading) return <LoadingState label="Loading QA form access" />;
  return <section className="panel qa-form-access-admin">
    <div className="section-heading"><div><h2>QA form access</h2><p>Choose which QA Staff can complete and edit each form. Dashboard and report access stays unchanged.</p></div><ShieldCheck aria-hidden="true" size={24} /></div>
    <p className="muted-copy">These settings apply wherever the form template is used, including existing reviews and saved drafts. QA managers and staff with separate college-wide submission rights keep their existing access. Selecting someone here does not grant the QA Staff role or access to additional review teams.</p>
    {error ? <div className="api-error-banner" role="alert">{error}<Button disabled={saving} onClick={() => void load()}>Discard changes and reload</Button></div> : null}
    {message ? <div className="success-banner" role="status">{message}</div> : null}
    {!draft.length ? <p className="empty-state">No QA forms are available to configure.</p> : <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="filter-toolbar">
        <label className="entry-field"><span>Find a form</span><input type="search" value={formSearch} onChange={event => setFormSearch(event.target.value)} /></label>
        <label className="entry-field"><span>Activity</span><select value={activity} onChange={event => setActivity(event.target.value)}><option value="">All activities</option>{distinctListValues(draft.map(form => form.activityName)).map(value => <option key={value}>{value}</option>)}</select></label>
        <label className="entry-field"><span>Access</span><select value={accessFilter} onChange={event => setAccessFilter(event.target.value)}><option value="">All access modes</option><option value="restricted">Selected staff only</option><option value="all">All QA Staff</option></select></label>
        <AdminListSort value={formSort} onChange={setFormSort} label="Sort forms by" options={[["activity-asc","Activity: A–Z"],["template-asc","Form name: A–Z"]]} />
      </div>
      <div className="qa-form-access-layout">
        {!visibleForms.length ? <p className="empty-row">No QA forms match these filters. The current selection and unsaved changes are retained.</p> : null}
        <nav className="qa-form-access-forms" aria-label="QA form access templates">{visibleForms.map(form => {
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
            <div className="toolbar"><label className="entry-field"><span>Selection</span><select value={selectionFilter} onChange={event => setSelectionFilter(event.target.value)}><option value="">All QA Staff</option><option value="selected">Selected</option><option value="unselected">Not selected</option></select></label><AdminListSort label="Sort staff by" value={staffSort} onChange={setStaffSort} options={[["name-asc","Name: A–Z"],["email-asc","Email: A–Z"]]} /></div>
            {selected.staffIds.some(id => !staff.some(person => person.staffId === id && person.isEligibleQaStaff)) ? <p className="muted-copy">Some saved selections are no longer active QA Staff. They can be retained or removed, but do not grant access without an active qualifying account. They cannot be added to another form.</p> : null}
            <div className="toolbar"><Button disabled={saving || !matchingSelectableIds.length} onClick={() => updateSelected({ staffIds: [...new Set([...selected.staffIds, ...matchingSelectableIds])] })} variant="quiet">Select {matchingSelectableIds.length} matching staff</Button><Button disabled={saving || !matchingSelectedIds.length} onClick={() => updateSelected({ staffIds: selected.staffIds.filter(id => !matchingSelectedIds.includes(id)) })} variant="quiet">Remove {matchingSelectedIds.length} matching selections</Button><Button disabled={saving || !selected.staffIds.length} onClick={() => updateSelected({ staffIds: [] })} variant="quiet">Clear selection</Button></div>
            <p className="muted-copy">Select and remove matching apply only to the staff currently shown. Save form access to apply your changes.</p>
            {selected.staffIds.length === 0 ? <p className="notice-row">No QA Staff are selected. Only people with other qualifying permissions will be able to complete or edit this form.</p> : null}
            <div className="qa-form-access-staff-list">{visibleStaff.map(person => <label key={person.staffId}><input type="checkbox" checked={selected.staffIds.includes(person.staffId)} disabled={!canSelectStaff(person)} onChange={event => { if (!canSelectStaff(person)) return; updateSelected({ staffIds: event.target.checked ? [...new Set([...selected.staffIds, person.staffId])] : selected.staffIds.filter(id => id !== person.staffId) }); }} /><span><strong>{person.displayName}</strong><small>{person.email}</small>{!person.isEligibleQaStaff ? <small>{savedSelection.includes(person.staffId) ? "Previous selection on this form; no longer active QA Staff" : "No longer active QA Staff; unavailable for new selections"}</small> : null}</span></label>)}</div>
            {!visibleStaff.length ? <p className="muted-copy">{staff.length ? "No QA Staff match your search." : "No active QA Staff are available. Assign the role in staff permissions before selecting people here."}</p> : null}
          </fieldset> : <p className="muted-copy">QA Staff with access to the review can complete this form. Any saved selections are retained if you switch back to selected staff.</p>}
        </div> : null}
      </div>
      <div className="toolbar"><button className="button button-primary" type="submit" disabled={!dirty || saving}>{saving ? "Saving…" : "Save form access"}</button><Button disabled={!dirty || saving} onClick={() => { if (mutationInFlight.current) return; setDraft(saved); setMessage(""); setError(""); }}>Cancel changes</Button>{dirty ? <span className="muted-copy">Unsaved changes</span> : null}</div>
    </form>}
  </section>;
}
