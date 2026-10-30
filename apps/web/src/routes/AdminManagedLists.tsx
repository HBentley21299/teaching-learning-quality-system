import { useUnsavedChanges } from "../components/UnsavedChangesGuard";
import { LoadingState } from "../components/LoadingState";
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Edit3, Plus, Save, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../design-system/Button";
import { api } from "../services/api";
import type { AdminManagedList, AdminManagedListValue } from "../services/types";
import { AdminListSort } from "../components/AdminListSort";
import { matchesListSearch, sortListRows } from "../services/listQuery";

export function AdminManagedLists({ lookupKeys, excludeLookupKeys, onDirtyChange }: { lookupKeys?: readonly string[]; excludeLookupKeys?: readonly string[]; onDirtyChange?: (dirty: boolean, saving?: boolean) => void }) {
  const [dirtyLists, setDirtyLists] = useState<Record<string, {dirty: boolean; saving: boolean}>>({});
  const trackDirty = useCallback((key: string, dirty: boolean, saving: boolean) => setDirtyLists((current) => current[key]?.dirty === dirty && current[key]?.saving === saving ? current : { ...current, [key]: {dirty, saving} }), []);
  useEffect(() => { onDirtyChange?.(Object.values(dirtyLists).some(item => item.dirty), Object.values(dirtyLists).some(item => item.saving)); }, [dirtyLists, onDirtyChange]);
  const [loading, setLoading] = useState(true);
  const [lists, setLists] = useState<AdminManagedList[]>([]);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [catalogueSort, setCatalogueSort] = useState("name-asc");

  async function refresh(nextMessage = "") {
    setLoading(true); setLoadError("");
    try {
      setLists(await api.adminManagedLists());
      setMessage(nextMessage);
    } catch {
      setLoadError("Lists and choices could not be loaded. Check your connection and try again.");
    } finally { setLoading(false); }
  }

  useEffect(() => { void refresh(); }, []);

  const categories = useMemo(() => {
    const grouped = new Map<string, AdminManagedList[]>();
    lists.filter((list) => (!lookupKeys || lookupKeys.includes(list.lookupKey)) && !excludeLookupKeys?.includes(list.lookupKey)).forEach((list) => grouped.set(list.category, [...(grouped.get(list.category) ?? []), list]));
    return Array.from(grouped.entries()).sort(([left], [right]) => left.localeCompare(right));
  }, [lists, lookupKeys, excludeLookupKeys]);
  const query = search.trim().toLocaleLowerCase();
  const matches = (list: AdminManagedList) => (!categoryFilter || list.category === categoryFilter) && matchesListSearch(query, list.name, list.description, list.category, list.lookupKey, list.usedIn, list.values.map(value => [value.displayName, value.valueKey]));
  const visibleCount = categories.reduce((count, [, items]) => count + items.filter(list => matches(list) || dirtyLists[list.lookupKey]?.dirty || dirtyLists[list.lookupKey]?.saving).length, 0);

  return (
    <section className="panel admin-managed-lists admin-managed-list-catalogue">
      <div className="panel-heading"><div><h2>Lists & choices</h2><span>Edit wording, order and availability</span></div><strong>{categories.reduce((count, [, items]) => count + items.length, 0)} lists</strong></div>
      {message ? <div className="notice-row" role="status">{message}</div> : null}
      {loadError ? <div className="notice-row" role="alert">{loadError}<Button disabled={loading} onClick={() => void refresh()}>Try again</Button></div> : null}
      {categories.reduce((count, [, items]) => count + items.length, 0) > 1 ? <label className="admin-list-search"><Search size={17} aria-hidden="true" /><span className="sr-only">Search list names, usage or values</span><input type="search" placeholder="Search list names, usage or a choice" value={search} onChange={event => setSearch(event.target.value)} /></label> : null}
      {categories.reduce((count, [, items]) => count + items.length, 0) > 1 ? <div className="filter-toolbar"><label className="entry-field"><span>List category</span><select value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)}><option value="">All categories</option>{categories.map(([category]) => <option key={category}>{category}</option>)}</select></label><AdminListSort label="Sort lists by" value={catalogueSort} onChange={setCatalogueSort} options={[["name-asc","Name: A–Z"],["name-desc","Name: Z–A"],["active-desc","Active choices: most first"],["total-desc","Total choices: most first"]]} /></div> : null}
      {query ? <p role="status">{visibleCount} lists match. Lists with unsaved changes remain visible.</p> : null}
      {categories.length === 0 ? !loadError ? loading ? <LoadingState label="Loading choices" /> : <div className="empty-row" role="status">No lists are registered for this setting.</div> : null : categories.map(([category, categoryLists]) => (
        <div className="admin-list-category" key={category} hidden={!categoryLists.some(list => matches(list) || dirtyLists[list.lookupKey]?.dirty || dirtyLists[list.lookupKey]?.saving)}>
          <div className="admin-list-category-heading"><h3>{category}</h3><span>{categoryLists.length} lists</span></div>
          {sortListRows(categoryLists, list => catalogueSort.startsWith("active") ? list.values.filter(value => value.isActive).length : catalogueSort.startsWith("total") ? list.values.length : list.name, catalogueSort.endsWith("desc") ? "desc" : "asc", list => list.lookupKey).map((list) => <div key={list.lookupKey} hidden={!matches(list) && !dirtyLists[list.lookupKey]?.dirty && !dirtyLists[list.lookupKey]?.saving}><ManagedList list={list} expandedBySearch={Boolean(query && matches(list))} initiallyExpanded={lookupKeys?.length === 1} onRefresh={refresh} onDirtyChange={trackDirty} /></div>)}
        </div>
      ))}
    </section>
  );
}

function ManagedList({ list, onRefresh, onDirtyChange, initiallyExpanded = false, expandedBySearch = false }: { list: AdminManagedList; onRefresh: (message?: string) => Promise<void>; onDirtyChange: (key: string, dirty: boolean, saving: boolean) => void; initiallyExpanded?: boolean; expandedBySearch?: boolean }) {
  const [newValue, setNewValue] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editingName, setEditingName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [query, setQuery] = useState("");
  const [status, setStatusFilter] = useState("all");
  const [sort, setSort] = useState("configured");
  const orderedValues = useMemo(() => [...list.values].sort((left, right) => left.displayOrder - right.displayOrder), [list.values]);
  const visibleValues = useMemo(() => sortListRows(orderedValues.filter(value => value.id === editingId
    || ((status === "all" || value.isActive === (status === "active")) && matchesListSearch(query, value.displayName, value.valueKey, value.isActive ? "active" : "inactive"))),
    value => sort === "configured" ? value.displayOrder : sort.startsWith("status") ? (value.isActive ? "Active" : "Inactive") : value.displayName,
    sort.endsWith("desc") ? "desc" : "asc", value => value.displayOrder), [orderedValues, query, status, sort, editingId]);
  const canReorder = sort === "configured" && !query.trim() && status === "all";

  const editDirty = Boolean(editingId && editingName !== list.values.find(value => value.id === editingId)?.displayName);
  const dirty = Boolean(newValue || editDirty);
  const clearGuard = useUnsavedChanges({label: list.name, dirty, saving: isSaving, onSave: async () => {
    if (editDirty && !await saveEdit()) return false;
    if (newValue && !await addValue()) return false;
    clearGuard(); return true;
  }, onDiscard: () => { setNewValue(""); setEditingId(""); setEditingName(""); clearGuard(); }});
  useEffect(() => { onDirtyChange(list.lookupKey, dirty, isSaving); }, [dirty, isSaving, list.lookupKey, onDirtyChange]);

  async function execute(operation: () => Promise<{ ok: boolean; message?: string }>, successMessage: string) {
    setIsSaving(true);
    try {
      const result = await operation();
      if (!result.ok) {
        setMessage(result.message ?? "The list could not be changed.");
        return false;
      }
      setMessage("");
      await onRefresh(successMessage);
      return true;
    } finally { setIsSaving(false); }
  }

  async function addValue() {
    if (!newValue.trim()) return false;
    if (!await execute(() => api.addLookupValue(list.lookupKey, newValue.trim()), `${list.name}: value added.`)) return false;
    setNewValue(""); return true;
  }

  async function saveEdit() {
    if (!editingId || !editingName.trim()) return false;
    if (await execute(() => api.updateManagedListValue(list.lookupKey, editingId, editingName.trim()), `${list.name}: value updated.`)) {
      setEditingId("");
      setEditingName(""); return true;
    }
    return false;
  }

  async function setStatus(value: AdminManagedListValue) {
    await execute(
      () => api.setManagedListValueStatus(list.lookupKey, value.id, !value.isActive),
      `${list.name}: value ${value.isActive ? "deactivated" : "reactivated"}.`
    );
  }

  async function moveValue(index: number, direction: -1 | 1) {
    if (!canReorder) return;
    const target = index + direction;
    if (target < 0 || target >= orderedValues.length) return;
    const ids = orderedValues.map((value) => value.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await execute(() => api.reorderManagedListValues(list.lookupKey, ids), `${list.name}: display order updated.`);
  }

  return (
    <details className="admin-managed-list" open={expanded || expandedBySearch} onToggle={event => { if (!expandedBySearch) setExpanded(event.currentTarget.open); }}>
      <summary><div><strong>{list.name}</strong><span>{list.description}</span></div><small>{list.values.filter((value) => value.isActive).length} active · {list.values.length} total</small></summary>
      <div className="admin-managed-list-body">
        <div className="admin-list-usage"><span>Used in</span>{list.usedIn.map((usage) => <strong key={usage}>{usage}</strong>)}</div>
        <div className="lookup-admin-toolbar">
          <label className="entry-field"><span>New list value</span><input disabled={isSaving} onChange={(event) => setNewValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void addValue(); } }} placeholder={`Add to ${list.name}`} value={newValue} /></label>
          <Button disabled={isSaving || !newValue.trim()} icon={Plus} onClick={() => void addValue()} variant="primary">Add value</Button>
          {newValue ? <Button disabled={isSaving} onClick={() => setNewValue("")}>Cancel new value</Button> : null}
        </div>
        {message ? <div className="notice-row">{message}</div> : null}
        <div className="lookup-admin-toolbar">
          <label className="entry-field"><span>Find a choice</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Wording or code" /></label>
          <label className="entry-field"><span>Availability</span><select value={status} onChange={event => setStatusFilter(event.target.value)}><option value="all">All choices</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
          <AdminListSort value={sort} onChange={setSort} options={[["configured","Configured form order"],["name-asc","Wording: A–Z"],["name-desc","Wording: Z–A"],["status-asc","Availability: active first"]]} />
          <span>{visibleValues.length} of {list.values.length} choices</span>
        </div>
        {!canReorder ? <p className="muted-copy">To change form order, show all choices in configured form order and clear the search. The choice being edited stays visible.</p> : null}
        <div className="admin-list-values">
          {visibleValues.map((value) => {
            const index = orderedValues.findIndex(item => item.id === value.id);
            return (
            <div className={`admin-list-value-row${value.isActive ? "" : " is-inactive"}`} key={value.id}>
              {editingId === value.id ? <input disabled={isSaving} aria-label="List value wording" autoFocus onChange={(event) => setEditingName(event.target.value)} value={editingName} /> : <div><strong>{value.displayName}</strong><span>{value.isActive ? "Active" : "Inactive"}</span></div>}
              <div className="admin-row-actions">
                <button className="icon-button" disabled={!canReorder || isSaving || dirty || index === 0} onClick={() => void moveValue(index, -1)} title="Move up" type="button" aria-label="Move up"><ArrowUp size={16}  aria-hidden="true"/></button>
                <button className="icon-button" disabled={!canReorder || isSaving || dirty || index === orderedValues.length - 1} onClick={() => void moveValue(index, 1)} title="Move down" type="button" aria-label="Move down"><ArrowDown size={16}  aria-hidden="true"/></button>
                {editingId === value.id ? <><button className="icon-button" disabled={isSaving} onClick={() => setEditingId("")} title="Cancel editing" type="button" aria-label="Cancel editing"><X size={16}  aria-hidden="true"/></button><button className="icon-button" disabled={isSaving || !editingName.trim()} onClick={() => void saveEdit()} title="Save value" type="button" aria-label="Save value"><Save size={16}  aria-hidden="true"/></button></> : <><button className="icon-button" disabled={isSaving || Boolean(editingId)} onClick={() => { setEditingId(value.id); setEditingName(value.displayName); }} title="Edit value" type="button" aria-label="Edit value"><Edit3 size={16}  aria-hidden="true"/></button><button className="icon-button" disabled={isSaving || dirty} onClick={() => void setStatus(value)} title={value.isActive ? "Deactivate value" : "Reactivate value"} type="button" aria-label={value.isActive ? "Deactivate value" : "Reactivate value"}>{value.isActive ? <Archive size={16}  aria-hidden="true"/> : <ArchiveRestore size={16}  aria-hidden="true"/>}</button></>}
              </div>
            </div>
          ); })}
          {!visibleValues.length ? <p className="empty-row">No choices match these filters.</p> : null}
        </div>
      </div>
    </details>
  );
}
