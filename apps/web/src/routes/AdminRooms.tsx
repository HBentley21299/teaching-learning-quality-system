import { DoorOpen, Edit3, Plus, RefreshCw, Save, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../design-system/Button";
import { confirmUnsavedNavigation, useUnsavedChanges } from "../components/UnsavedChangesGuard";
import { api } from "../services/api";
import type { AdminRoomSummary, SaveAdminRoomRequest } from "../services/types";

const emptyRoom: SaveAdminRoomRequest = { roomCode: "", buildingName: "", isActive: true };

export function AdminRooms({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const [rooms, setRooms] = useState<AdminRoomSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("active");
  const [editor, setEditor] = useState<{ room: AdminRoomSummary | null } | null>(null);
  const [draft, setDraft] = useState<SaveAdminRoomRequest>(emptyRoom);
  const original = editor?.room ?? emptyRoom;
  const dirty = editor !== null && (draft.roomCode !== original.roomCode
    || draft.buildingName !== original.buildingName || draft.isActive !== original.isActive);
  const clearUnsaved = useUnsavedChanges({ label: "Room details", dirty, saving, onSave: save, onDiscard: () => { setEditor(null); setDraft(emptyRoom); } });

  useEffect(() => {
    onDirtyChange?.(dirty || saving);
    return () => onDirtyChange?.(false);
  }, [dirty, saving, onDirtyChange]);

  useEffect(() => {
    if (!dirty && !saving) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, saving]);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      setRooms(await api.adminRooms());
      setLoaded(true);
    } catch {
      setError("The room catalogue could not be loaded. Please retry.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  const visibleRooms = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return rooms.filter((room) => (status === "all" || room.isActive === (status === "active"))
      && `${room.roomCode} ${room.buildingName}`.toLocaleLowerCase().includes(search))
      .sort((left, right) => left.roomCode.localeCompare(right.roomCode, undefined, { numeric: true }));
  }, [rooms, query, status]);

  function beginEdit(room: AdminRoomSummary | null) {
    setEditor({ room });
    setDraft(room ? { roomCode: room.roomCode, buildingName: room.buildingName, isActive: room.isActive, rowVersion: room.rowVersion } : { ...emptyRoom });
    setError("");
    setMessage("");
  }

  async function cancelEdit() {
    if (!await confirmUnsavedNavigation()) return;
    setEditor(null);
    setError("");
  }

  async function save() {
    if (!editor || saving) return false;
    const request = { ...draft, roomCode: draft.roomCode.trim(), buildingName: draft.buildingName.trim() };
    if (!request.roomCode || !request.buildingName) {
      setError("Enter both a room code and a building name.");
      return false;
    }
    setSaving(true);
    setError("");
    try {
      const result = editor.room
        ? await api.updateAdminRoom(editor.room.id, request)
        : await api.createAdminRoom(request);
      if (!result.ok || !result.data) {
        setError(result.message ?? "The room could not be saved. Your changes are still here.");
        return false;
      }
      const saved = result.data;
      setRooms((current) => [...current.filter((room) => room.id !== saved.id), saved]);
      setMessage(`${saved.roomCode} ${editor.room ? "updated" : "added"}. ${saved.isActive ? "Available for new learning environment assessments." : "Inactive; existing assessments are retained."}`);
      setEditor(null);
      clearUnsaved();
      return true;
    } catch {
      setError("The room could not be saved. Your changes are still here; please try again.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel admin-room-catalogue" aria-busy={loading}>
      <div className="panel-heading">
        <div><h2><DoorOpen aria-hidden="true" size={22} /> Rooms</h2><span>Manage the rooms offered in learning environment assessments.</span></div>
        <div className="admin-row-actions">
          <Button disabled={loading || editor !== null} icon={RefreshCw} onClick={() => void refresh()} variant="quiet">Reload</Button>
          <Button disabled={!loaded || loading || editor !== null} icon={Plus} onClick={() => beginEdit(null)} variant="primary">Add room</Button>
        </div>
      </div>
      <p>Deactivate rooms to remove them from future selections. Existing assessments stay linked to their room.</p>
      {error ? <div className="notice-row" role="alert">{error}</div> : null}
      {message ? <div className="notice-row" role="status">{message}</div> : null}

      {editor ? (
        <form className="admin-room-editor" onSubmit={(event) => { event.preventDefault(); void save(); }} aria-busy={saving}>
          <h3>{editor.room ? `Edit ${editor.room.roomCode}` : "Add a room"}</h3>
          <div className="entry-grid">
            <label className="entry-field"><span>Room code <small>(required)</small></span>
              <input autoFocus disabled={saving} readOnly={(editor.room?.assessmentCount ?? 0) > 0} maxLength={50} required value={draft.roomCode} onChange={(event) => setDraft({ ...draft, roomCode: event.target.value })} aria-describedby={(editor.room?.assessmentCount ?? 0) > 0 ? "room-code-history" : undefined} />
            </label>
            <label className="entry-field"><span>Building name <small>(required)</small></span>
              <input disabled={saving} maxLength={200} required value={draft.buildingName} onChange={(event) => setDraft({ ...draft, buildingName: event.target.value })} />
            </label>
            <label className="entry-field"><span>Availability</span>
              <select disabled={saving} value={draft.isActive ? "active" : "inactive"} onChange={(event) => setDraft({ ...draft, isActive: event.target.value === "active" })}>
                <option value="active">Active — available for selection</option><option value="inactive">Inactive — hidden from new selections</option>
              </select>
            </label>
          </div>
          {(editor.room?.assessmentCount ?? 0) > 0 ? <p id="room-code-history">Used by {editor.room!.assessmentCount} linked records, including drafts. The room code is protected; building name corrections also appear wherever this room is displayed.</p> : null}
          {editor.room?.isActive && !draft.isActive ? <p role="status">Existing assessments will remain. Draft assessments that need to be saved again may need an active room selected.</p> : null}
          <div className="admin-row-actions">
            <Button disabled={saving} icon={X} onClick={cancelEdit}>Cancel</Button>
            <Button disabled={saving || !dirty || !draft.roomCode.trim() || !draft.buildingName.trim()} icon={Save} onClick={() => void save()} variant="primary">{saving ? "Saving…" : "Save room"}</Button>
          </div>
        </form>
      ) : null}

      <div className="lookup-admin-toolbar">
        <label className="entry-field"><span><Search aria-hidden="true" size={15} /> Search rooms</span><input type="search" placeholder="Room code or building name" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <label className="entry-field"><span>Show</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="active">Active rooms</option><option value="inactive">Inactive rooms</option><option value="all">All rooms</option></select></label>
        {loaded ? <span role="status">{visibleRooms.length} of {rooms.length} rooms</span> : null}
      </div>
      {loading ? <div className="empty-row" role="status">Loading room catalogue…</div> : !loaded ? <div className="empty-row"><Button onClick={() => void refresh()}>Retry loading</Button></div> : visibleRooms.length === 0 ? <div className="empty-row">{rooms.length === 0 ? "No rooms yet. Add a room to make it available in learning environment assessments." : "No rooms match these filters. Try another search or show all rooms."}</div> : (
        <div className="table-scroll">
          <table className="data-table admin-room-table">
            <thead><tr><th scope="col">Room</th><th scope="col">Building</th><th scope="col">Availability</th><th scope="col">Linked records</th><th scope="col">Actions</th></tr></thead>
            <tbody>{visibleRooms.map((room) => <tr key={room.id}>
              <td><strong>{room.roomCode}</strong></td><td>{room.buildingName}</td><td><span className={`status-badge ${room.isActive ? "is-active" : "is-inactive"}`}>{room.isActive ? "Active" : "Inactive"}</span></td><td>{room.assessmentCount}</td>
              <td><Button disabled={editor !== null} icon={Edit3} onClick={() => beginEdit(room)} title={`Edit room ${room.roomCode}`} variant="quiet">Edit</Button></td>
            </tr>)}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
