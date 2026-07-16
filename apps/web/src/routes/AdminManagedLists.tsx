import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Edit3, Plus, Save, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../design-system/Button";
import { api } from "../services/api";
import type { AdminManagedList, AdminManagedListValue } from "../services/types";

export function AdminManagedLists() {
  const [lists, setLists] = useState<AdminManagedList[]>([]);
  const [message, setMessage] = useState("");

  async function refresh(nextMessage = "") {
    try {
      setLists(await api.adminManagedLists());
      setMessage(nextMessage);
    } catch {
      setMessage("Administrative lists could not be loaded from the API.");
    }
  }

  useEffect(() => { void refresh(); }, []);

  const categories = useMemo(() => {
    const grouped = new Map<string, AdminManagedList[]>();
    lists.forEach((list) => grouped.set(list.category, [...(grouped.get(list.category) ?? []), list]));
    return Array.from(grouped.entries()).sort(([left], [right]) => left.localeCompare(right));
  }, [lists]);

  return (
    <section className="panel admin-managed-lists admin-managed-list-catalogue">
      <div className="panel-heading"><div><h2>Configurable lists</h2><span>Governed dropdown and checklist values used throughout the system</span></div><strong>{lists.length} lists</strong></div>
      {message ? <div className="notice-row" role="status">{message}</div> : null}
      {categories.length === 0 ? <div className="empty-row">No configurable lists are available.</div> : categories.map(([category, categoryLists]) => (
        <div className="admin-list-category" key={category}>
          <div className="admin-list-category-heading"><h3>{category}</h3><span>{categoryLists.length} lists</span></div>
          {categoryLists.sort((left, right) => left.name.localeCompare(right.name)).map((list) => <ManagedList key={list.lookupKey} list={list} onRefresh={refresh} />)}
        </div>
      ))}
    </section>
  );
}

function ManagedList({ list, onRefresh }: { list: AdminManagedList; onRefresh: (message?: string) => Promise<void> }) {
  const [newValue, setNewValue] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editingName, setEditingName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const orderedValues = useMemo(() => [...list.values].sort((left, right) => left.displayOrder - right.displayOrder), [list.values]);

  async function execute(operation: () => Promise<{ ok: boolean; message?: string }>, successMessage: string) {
    setIsSaving(true);
    const result = await operation();
    setIsSaving(false);
    if (!result.ok) {
      setMessage(result.message ?? "The list could not be changed.");
      return false;
    }
    setMessage("");
    await onRefresh(successMessage);
    return true;
  }

  async function addValue() {
    if (!newValue.trim()) return;
    if (await execute(() => api.addLookupValue(list.lookupKey, newValue.trim()), `${list.name}: value added.`)) setNewValue("");
  }

  async function saveEdit() {
    if (!editingId || !editingName.trim()) return;
    if (await execute(() => api.updateManagedListValue(list.lookupKey, editingId, editingName.trim()), `${list.name}: value updated.`)) {
      setEditingId("");
      setEditingName("");
    }
  }

  async function setStatus(value: AdminManagedListValue) {
    await execute(
      () => api.setManagedListValueStatus(list.lookupKey, value.id, !value.isActive),
      `${list.name}: value ${value.isActive ? "deactivated" : "reactivated"}.`
    );
  }

  async function moveValue(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= orderedValues.length) return;
    const ids = orderedValues.map((value) => value.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await execute(() => api.reorderManagedListValues(list.lookupKey, ids), `${list.name}: display order updated.`);
  }

  return (
    <details className="admin-managed-list" open={false}>
      <summary><div><strong>{list.name}</strong><span>{list.description}</span></div><small>{list.values.filter((value) => value.isActive).length} active · {list.values.length} total</small></summary>
      <div className="admin-managed-list-body">
        <div className="admin-list-usage"><span>Used in</span>{list.usedIn.map((usage) => <strong key={usage}>{usage}</strong>)}</div>
        <div className="lookup-admin-toolbar">
          <label className="entry-field"><span>New list value</span><input onChange={(event) => setNewValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void addValue(); } }} placeholder={`Add to ${list.name}`} value={newValue} /></label>
          <Button disabled={isSaving || !newValue.trim()} icon={Plus} onClick={() => void addValue()} variant="primary">Add value</Button>
        </div>
        {message ? <div className="notice-row">{message}</div> : null}
        <div className="admin-list-values">
          {orderedValues.map((value, index) => (
            <div className={`admin-list-value-row${value.isActive ? "" : " is-inactive"}`} key={value.id}>
              {editingId === value.id ? <input aria-label="List value wording" autoFocus onChange={(event) => setEditingName(event.target.value)} value={editingName} /> : <div><strong>{value.displayName}</strong><span>{value.isActive ? "Active" : "Inactive"}</span></div>}
              <div className="admin-row-actions">
                <button className="icon-button" disabled={isSaving || index === 0} onClick={() => void moveValue(index, -1)} title="Move up" type="button"><ArrowUp size={16} /></button>
                <button className="icon-button" disabled={isSaving || index === orderedValues.length - 1} onClick={() => void moveValue(index, 1)} title="Move down" type="button"><ArrowDown size={16} /></button>
                {editingId === value.id ? <><button className="icon-button" onClick={() => setEditingId("")} title="Cancel editing" type="button"><X size={16} /></button><button className="icon-button" disabled={isSaving || !editingName.trim()} onClick={() => void saveEdit()} title="Save value" type="button"><Save size={16} /></button></> : <><button className="icon-button" disabled={isSaving} onClick={() => { setEditingId(value.id); setEditingName(value.displayName); }} title="Edit value" type="button"><Edit3 size={16} /></button><button className="icon-button" disabled={isSaving} onClick={() => void setStatus(value)} title={value.isActive ? "Deactivate value" : "Reactivate value"} type="button">{value.isActive ? <Archive size={16} /> : <ArchiveRestore size={16} />}</button></>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}
