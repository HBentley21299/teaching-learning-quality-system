import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Edit3, Plus, Save, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../design-system/Button";
import { api } from "../services/api";
import type { AdminManagedList, AdminManagedListValue } from "../services/types";

export function AdminManagedLists() {
  const [lists, setLists] = useState<AdminManagedList[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editingName, setEditingName] = useState("");
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh(nextMessage = "") {
    try {
      const nextLists = await api.adminManagedLists();
      setLists(nextLists);
      setSelectedKey((current) => nextLists.some((list) => list.lookupKey === current)
        ? current
        : nextLists[0]?.lookupKey ?? "");
      setMessage(nextMessage);
    } catch {
      setMessage("Administrative lists could not be loaded from the API.");
    }
  }

  const selectedList = useMemo(
    () => lists.find((list) => list.lookupKey === selectedKey) ?? null,
    [lists, selectedKey]
  );
  const orderedValues = useMemo(
    () => [...(selectedList?.values ?? [])].sort((left, right) => left.displayOrder - right.displayOrder),
    [selectedList]
  );

  async function addValue() {
    if (!selectedList || !newValue.trim()) return;
    setIsSaving(true);
    const result = await api.addLookupValue(selectedList.lookupKey, newValue.trim());
    setIsSaving(false);
    if (!result.ok) {
      setMessage(result.message ?? "The list value could not be added.");
      return;
    }
    setNewValue("");
    await refresh("List value added.");
  }

  async function saveEdit() {
    if (!selectedList || !editingId || !editingName.trim()) return;
    setIsSaving(true);
    const result = await api.updateManagedListValue(selectedList.lookupKey, editingId, editingName.trim());
    setIsSaving(false);
    if (!result.ok) {
      setMessage(result.message ?? "The list value could not be updated.");
      return;
    }
    setEditingId("");
    setEditingName("");
    await refresh("List value updated.");
  }

  async function setStatus(value: AdminManagedListValue) {
    if (!selectedList) return;
    setIsSaving(true);
    const result = await api.setManagedListValueStatus(selectedList.lookupKey, value.id, !value.isActive);
    setIsSaving(false);
    if (!result.ok) {
      setMessage(result.message ?? "The list value status could not be changed.");
      return;
    }
    await refresh(value.isActive ? "List value deactivated." : "List value reactivated.");
  }

  async function moveValue(index: number, direction: -1 | 1) {
    if (!selectedList) return;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= orderedValues.length) return;
    const valueIds = orderedValues.map((value) => value.id);
    [valueIds[index], valueIds[targetIndex]] = [valueIds[targetIndex], valueIds[index]];
    setIsSaving(true);
    const result = await api.reorderManagedListValues(selectedList.lookupKey, valueIds);
    setIsSaving(false);
    if (!result.ok) {
      setMessage(result.message ?? "The list order could not be changed.");
      return;
    }
    await refresh("List order updated.");
  }

  return (
    <section className="panel admin-managed-lists">
      <div className="panel-heading">
        <div>
          <h2>Configurable lists</h2>
          <span>One governed source for form dropdowns and checklists</span>
        </div>
        <strong>{lists.length} lists</strong>
      </div>

      <div className="admin-list-selector">
        <label className="entry-field">
          <span>Managed list</span>
          <select onChange={(event) => setSelectedKey(event.target.value)} value={selectedKey}>
            {lists.map((list) => (
              <option key={list.lookupKey} value={list.lookupKey}>{list.category}: {list.name}</option>
            ))}
          </select>
        </label>
        {selectedList ? (
          <div className="admin-list-context">
            <strong>{selectedList.name}</strong>
            <span>{selectedList.description}</span>
          </div>
        ) : null}
      </div>

      {selectedList ? (
        <>
          <div className="admin-list-usage">
            <span>Used in</span>
            {selectedList.usedIn.map((usage) => <strong key={usage}>{usage}</strong>)}
          </div>

          <div className="lookup-admin-toolbar">
            <label className="entry-field">
              <span>New list value</span>
              <input
                onChange={(event) => setNewValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void addValue();
                  }
                }}
                placeholder={`Add to ${selectedList.name}`}
                value={newValue}
              />
            </label>
            <Button disabled={isSaving || !newValue.trim()} icon={Plus} onClick={() => void addValue()} variant="primary">
              Add value
            </Button>
          </div>

          {message ? <div className="notice-row" role="status">{message}</div> : null}

          <div className="admin-list-values">
            {orderedValues.map((value, index) => (
              <div className={`admin-list-value-row${value.isActive ? "" : " is-inactive"}`} key={value.id}>
                {editingId === value.id ? (
                  <input
                    aria-label="List value wording"
                    autoFocus
                    onChange={(event) => setEditingName(event.target.value)}
                    value={editingName}
                  />
                ) : (
                  <div>
                    <strong>{value.displayName}</strong>
                    <span>{value.isActive ? "Active" : "Inactive"}</span>
                  </div>
                )}
                <div className="admin-row-actions">
                  <button className="icon-button" disabled={isSaving || index === 0} onClick={() => void moveValue(index, -1)} title="Move up" type="button"><ArrowUp size={16} /></button>
                  <button className="icon-button" disabled={isSaving || index === orderedValues.length - 1} onClick={() => void moveValue(index, 1)} title="Move down" type="button"><ArrowDown size={16} /></button>
                  {editingId === value.id ? (
                    <>
                      <button className="icon-button" onClick={() => setEditingId("")} title="Cancel editing" type="button"><X size={16} /></button>
                      <button className="icon-button" disabled={isSaving || !editingName.trim()} onClick={() => void saveEdit()} title="Save value" type="button"><Save size={16} /></button>
                    </>
                  ) : (
                    <>
                      <button className="icon-button" disabled={isSaving} onClick={() => { setEditingId(value.id); setEditingName(value.displayName); }} title="Edit value" type="button"><Edit3 size={16} /></button>
                      <button className="icon-button" disabled={isSaving} onClick={() => void setStatus(value)} title={value.isActive ? "Deactivate value" : "Reactivate value"} type="button">
                        {value.isActive ? <Archive size={16} /> : <ArchiveRestore size={16} />}
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : <div className="empty-row">No configurable lists are available.</div>}
    </section>
  );
}
