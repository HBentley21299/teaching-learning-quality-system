import { useUnsavedChanges } from "../components/UnsavedChangesGuard";
import { useEffect, useState } from "react";
import { api } from "../services/api";
import { Button } from "../design-system/Button";
import { LoadingState } from "../components/LoadingState";
import type { OrgUnitSummary } from "../services/types";
import { AdminListSort } from "../components/AdminListSort";
import { matchesListSearch, sortListRows } from "../services/listQuery";

const labels: Record<string, string> = { overview: "Executive overview", learning_walk: "Learning Walks", als_learning_walk: "ALS Learning Walks", liv: "LIV", als_liv: "ALS LIV", eli: "Elevate Learning and Innovation", probation_case: "Probationary Observations", elevate_environment: "Elevate Environments", coaching_session: "Coaching and Mentoring", work_scrutiny: "Work Scrutiny", cpd_event: "CPD", elevate_status: "Elevate Status", actions: "Actions", qa_review: "QA Hub", uco_tla_review: "UCO TLA" };
type FacultySelection = { dashboardKey: string; excludedFacultyIds: string[] };

export function DashboardFacultyAdmin({ onDirtyChange, dashboardKey, excludeDashboardKeys = [] }: {
  onDirtyChange?: (dirty: boolean, busy: boolean) => void;
  dashboardKey?: string;
  excludeDashboardKeys?: readonly string[];
}) {
  const [savedSelections, setSavedSelections] = useState<FacultySelection[]>([]);
  const [units, setUnits] = useState<OrgUnitSummary[]>([]);
  const [selections, setSelections] = useState<FacultySelection[]>([]);
  const [selectedKey, setSelectedKey] = useState(dashboardKey ?? "overview");
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [inclusion, setInclusion] = useState("");
  const [sort, setSort] = useState("name-asc");
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setLoadError("");
    void Promise.all([api.orgUnits(), api.dashboardFacultySelections()]).then(([nextUnits, nextSelections]) => {
      if (cancelled) return;
      setUnits(nextUnits); setSelections(nextSelections); setSavedSelections(nextSelections); setLoaded(true);
    }).catch(() => { if (!cancelled) setLoadError("Faculty settings could not be loaded. Try again."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [attempt]);

  const availableKeys = Object.keys(labels).filter(key => !excludeDashboardKeys.includes(key)
    && (!dashboardKey || dashboardKey === key) && selections.some(selection => selection.dashboardKey === key));
  const selected = dashboardKey
    ? availableKeys.includes(dashboardKey) ? dashboardKey : ""
    : availableKeys.includes(selectedKey) ? selectedKey : availableKeys[0] ?? "";
  const changedSelections = selections.filter(selection => availableKeys.includes(selection.dashboardKey)
    && JSON.stringify(selection.excludedFacultyIds) !== JSON.stringify(savedSelections.find(saved => saved.dashboardKey === selection.dashboardKey)?.excludedFacultyIds));
  const dirty = loaded && changedSelections.length > 0;
  const clearGuard = useUnsavedChanges({ label: dashboardKey ? `${labels[dashboardKey] ?? "Dashboard"} faculty selections` : "Dashboard faculty selections", dirty, saving,
    onSave: save, onDiscard: () => { setSelections(savedSelections); clearGuard(); } });
  useEffect(() => { onDirtyChange?.(dirty, saving); }, [dirty, saving, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const faculties = units.filter(unit => unit.orgUnitType === "faculty").sort((left, right) => left.name.localeCompare(right.name));
  const excluded = selections.find(selection => selection.dashboardKey === selected)?.excludedFacultyIds ?? [];
  const visibleFaculties = sortListRows(faculties.filter(faculty => matchesListSearch(query, faculty.code, faculty.name)
    && (!inclusion || excluded.includes(faculty.id) === (inclusion === "excluded"))), faculty => sort.startsWith("code") ? faculty.code : faculty.name, sort.endsWith("desc") ? "desc" : "asc", faculty => faculty.id);
  const disabled = saving || !loaded || !selected;
  function change(ids: string[]) {
    if (disabled || !availableKeys.includes(selected)) return;
    setMessage("");
    setSelections(current => current.map(selection => selection.dashboardKey === selected ? { ...selection, excludedFacultyIds: ids } : selection));
  }
  async function save() {
    if (saving || !dirty) return false;
    // The API updates only supplied datasets. Never send untouched or out-of-scope rows.
    const changes = changedSelections.map(selection => ({ ...selection, excludedFacultyIds: [...selection.excludedFacultyIds] }));
    setSaving(true); setMessage("");
    try {
      const result = await api.saveDashboardFacultySelections(changes);
      if (!result.ok) { setMessage(result.message ?? "Faculty selections could not be saved."); return false; }
      setSavedSelections(current => current.map(selection => changes.find(change => change.dashboardKey === selection.dashboardKey) ?? selection));
      setMessage("Faculty datasets saved. Refresh dashboards to use these selections."); clearGuard(); return true;
    } catch { setMessage("Faculty selections could not be saved. Your changes are retained."); return false; }
    finally { setSaving(false); }
  }

  return <section className="panel">
    <div className="panel-heading"><div><h2>{dashboardKey ? `${labels[dashboardKey] ?? "Dashboard"} reporting faculties` : "Faculties included in each dashboard"}</h2><p>{dashboardKey ? "Tick the faculties whose data this dashboard should include, then save." : "Choose a dashboard, tick the faculties whose data it should include, then save. Other dashboards keep their own choices."} Their teams follow the same selection.</p></div><Button disabled={disabled || !dirty} onClick={() => void save()}>{saving ? "Saving…" : "Save faculty selections"}</Button></div>
    <p className="muted-copy">These choices apply to totals, staff coverage and exports. Organisation-wide exclusions and access permissions still apply. New faculties are included by default.</p>
    <p className="muted-copy">If an area is excluded in Organisation-wide reporting inclusion, including it here does not override that exclusion. Check its parent directorate and faculty when data is missing.</p>
    {message ? <p role="status">{message}</p> : null}
    {loadError ? <div className="notice-row" role="alert">{loadError}<Button disabled={loading} onClick={() => setAttempt(value => value + 1)}>Try again</Button></div> : null}
    {loading ? <LoadingState label="Loading faculty settings" /> : !loaded ? null : !selected ? <p role="status">No dashboard dataset is available for this setting.</p> : <>
      {!dashboardKey ? <label className="entry-field"><span>Dashboard dataset</span><select disabled={saving} value={selected} onChange={event => setSelectedKey(event.target.value)}>{availableKeys.map(key => <option key={key} value={key}>{labels[key]}</option>)}</select></label> : null}
      <div className="toolbar"><Button disabled={disabled} onClick={() => change([])}>Include all faculties</Button><Button disabled={disabled} onClick={() => change(faculties.map(faculty => faculty.id))}>Exclude all faculties</Button><span>{faculties.filter(faculty => !excluded.includes(faculty.id)).length} of {faculties.length} selected</span></div>
      <div className="filter-toolbar"><label className="entry-field"><span>Find a faculty</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label><label className="entry-field"><span>Dashboard inclusion</span><select value={inclusion} onChange={event => setInclusion(event.target.value)}><option value="">All faculties</option><option value="included">Included</option><option value="excluded">Excluded</option></select></label><AdminListSort value={sort} onChange={setSort} options={[["name-asc","Name: A–Z"],["name-desc","Name: Z–A"],["code-asc","Code: A–Z"]]} /></div>
      <fieldset className="support-options" disabled={disabled}><legend>{labels[selected]} faculties</legend>{visibleFaculties.map(faculty => <label key={faculty.id}><input type="checkbox" checked={!excluded.includes(faculty.id)} onChange={event => change(event.target.checked ? excluded.filter(id => id !== faculty.id) : [...excluded, faculty.id])} /><span>{faculty.code} — {faculty.name}{!faculty.includeInDashboards ? " (excluded organisation-wide)" : ""}{!faculty.isActive ? " (inactive)" : ""}</span></label>)}{!visibleFaculties.length ? <p>No faculties match these filters.</p> : null}</fieldset>
    </>}
  </section>;
}
