import { Archive, ArchiveRestore, Eye, History, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../design-system/Button";
import { api } from "../services/api";
import type { AdminRecord, RecordAudit } from "../services/types";

type ArchiveRequest = { record: AdminRecord; restore: boolean };

export function AdminRecordsPanel({ onOpenRecord }: { onOpenRecord: (record: AdminRecord) => void }) {
  const [records, setRecords] = useState<AdminRecord[]>([]);
  const [search, setSearch] = useState("");
  const [staffFilter, setStaffFilter] = useState("");
  const [facultyFilter, setFacultyFilter] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [formFilter, setFormFilter] = useState("");
  const [archiveFilter, setArchiveFilter] = useState<"active" | "archived" | "all">("active");
  const [auditRecord, setAuditRecord] = useState<AdminRecord | null>(null);
  const [audit, setAudit] = useState<RecordAudit[]>([]);
  const [archiveRequest, setArchiveRequest] = useState<ArchiveRequest | null>(null);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh(nextMessage = "") {
    try {
      setRecords(await api.adminRecords());
      setMessage(nextMessage);
    } catch {
      setMessage("Administrative records could not be loaded from the API.");
    }
  }

  const options = useMemo(() => ({
    staff: unique(records.map((record) => record.subjectStaffName).filter(Boolean) as string[]),
    faculties: unique(records.map((record) => record.facultyCode).filter(Boolean) as string[]),
    teams: unique(records.map((record) => record.teamCode).filter(Boolean) as string[]),
    forms: unique(records.map((record) => `${record.moduleName}|${record.recordType}`))
  }), [records]);

  const visibleRecords = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return records.filter((record) => {
      const isArchived = Boolean(record.archivedAt);
      return (!query || [record.title, record.subjectStaffName, record.ownerStaffName, record.facultyCode, record.teamCode, record.moduleName]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase().includes(query)))
        && (!staffFilter || record.subjectStaffName === staffFilter)
        && (!facultyFilter || record.facultyCode === facultyFilter)
        && (!teamFilter || record.teamCode === teamFilter)
        && (!formFilter || `${record.moduleName}|${record.recordType}` === formFilter)
        && (archiveFilter === "all" || (archiveFilter === "archived" ? isArchived : !isArchived));
    });
  }, [archiveFilter, facultyFilter, formFilter, records, search, staffFilter, teamFilter]);

  async function showAudit(record: AdminRecord) {
    setAuditRecord(record);
    try {
      setAudit(await api.adminRecordAudit(record.recordId));
    } catch {
      setAudit([]);
      setMessage("Audit history could not be loaded.");
    }
  }

  async function changeArchiveState() {
    if (!archiveRequest || !reason.trim()) return;
    setIsSaving(true);
    const result = archiveRequest.restore
      ? await api.restoreAdminRecord(archiveRequest.record.recordId, reason.trim())
      : await api.archiveAdminRecord(archiveRequest.record.recordId, reason.trim());
    setIsSaving(false);
    if (!result.ok) {
      setMessage(result.message ?? "The record status could not be changed.");
      return;
    }
    const restored = archiveRequest.restore;
    setArchiveRequest(null);
    setReason("");
    setAuditRecord(null);
    await refresh(restored ? "Record restored." : "Record archived. Existing audit history has been retained.");
  }

  return (
    <section className="panel admin-records-panel">
      <div className="panel-heading">
        <div><h2>Administrative record search</h2><span>Open, edit, archive, restore and audit teaching and learning records</span></div>
        <strong>{visibleRecords.length} records</strong>
      </div>

      <div className="admin-record-filters">
        <div className="search-box">
          <Search size={16} />
          <input aria-label="Search records" onChange={(event) => setSearch(event.target.value)} placeholder="Search title, staff, owner or area" type="search" value={search} />
        </div>
        <label><span>Staff</span><select onChange={(event) => setStaffFilter(event.target.value)} value={staffFilter}><option value="">All staff</option>{options.staff.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>Faculty</span><select onChange={(event) => setFacultyFilter(event.target.value)} value={facultyFilter}><option value="">All faculties</option>{options.faculties.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>Team</span><select onChange={(event) => setTeamFilter(event.target.value)} value={teamFilter}><option value="">All teams</option>{options.teams.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>Form</span><select onChange={(event) => setFormFilter(event.target.value)} value={formFilter}><option value="">All forms</option>{options.forms.map((value) => { const [label, type] = value.split("|"); return <option key={value} value={value}>{label} ({formatRecordType(type)})</option>; })}</select></label>
        <label><span>Record state</span><select onChange={(event) => setArchiveFilter(event.target.value as typeof archiveFilter)} value={archiveFilter}><option value="active">Active</option><option value="archived">Archived</option><option value="all">All</option></select></label>
      </div>

      {message ? <div className="notice-row" role="status">{message}</div> : null}

      <div className="admin-record-table" role="table" aria-label="Administrative records">
        <div className="admin-record-row admin-record-row-heading" role="row">
          <span>Record</span><span>Staff / owner</span><span>Area</span><span>Status</span><span>Date</span><span>Actions</span>
        </div>
        {visibleRecords.map((record) => (
          <div className={`admin-record-row${record.archivedAt ? " is-inactive" : ""}`} key={record.recordId} role="row">
            <div><strong>{record.title}</strong><span>{record.moduleName} / {formatRecordType(record.recordType)}</span></div>
            <div><strong>{record.subjectStaffName ?? "No subject"}</strong><span>{record.ownerStaffName ? `Owner: ${record.ownerStaffName}` : "No owner"}</span></div>
            <div><strong>{record.teamCode ?? record.facultyCode ?? "Unassigned"}</strong><span>{record.teamName ?? record.facultyName ?? "No organisation area"}</span></div>
            <span className={`status-pill status-${record.archivedAt ? "archived" : record.status}`}>{record.archivedAt ? "Archived" : formatRecordType(record.status)}</span>
            <span>{formatDate(record.recordDate ?? record.createdAt)}</span>
            <div className="admin-row-actions">
              {!record.archivedAt ? <button className="icon-button" onClick={() => onOpenRecord(record)} title="Open and edit record" type="button"><Eye size={16} /></button> : null}
              <button className="icon-button" onClick={() => void showAudit(record)} title="View audit history" type="button"><History size={16} /></button>
              <button className="icon-button" onClick={() => { setArchiveRequest({ record, restore: Boolean(record.archivedAt) }); setReason(""); }} title={record.archivedAt ? "Restore record" : "Archive record"} type="button">
                {record.archivedAt ? <ArchiveRestore size={16} /> : <Archive size={16} />}
              </button>
            </div>
          </div>
        ))}
        {visibleRecords.length === 0 ? <div className="empty-row">No records match the current filters.</div> : null}
      </div>

      {auditRecord ? (
        <div className="admin-audit-panel">
          <div className="panel-heading"><div><h2>Audit history</h2><span>{auditRecord.title}</span></div><button className="icon-button" onClick={() => setAuditRecord(null)} title="Close audit history" type="button"><X size={16} /></button></div>
          <div className="admin-audit-list">
            {audit.map((entry) => (
              <div className="admin-audit-row" key={entry.id}>
                <div><strong>{formatRecordType(entry.action)}</strong><span>{entry.actorName} / {formatDate(entry.createdAt)}</span></div>
                <p>{entry.summary ?? "No summary recorded."}</p>
                {entry.reason ? <blockquote>Reason: {entry.reason}</blockquote> : null}
                {entry.beforeJson || entry.afterJson ? <details><summary>Change data</summary><pre>{entry.beforeJson ?? "No previous value"}{"\n"}{entry.afterJson ?? "No new value"}</pre></details> : null}
              </div>
            ))}
            {audit.length === 0 ? <div className="empty-row">No audit entries are recorded for this item.</div> : null}
          </div>
        </div>
      ) : null}

      {archiveRequest ? (
        <div className="admin-reason-dialog" role="dialog" aria-modal="true" aria-label={archiveRequest.restore ? "Restore record" : "Archive record"}>
          <div>
            <div className="panel-heading"><h2>{archiveRequest.restore ? "Restore" : "Archive"} record</h2><button className="icon-button" onClick={() => setArchiveRequest(null)} title="Close" type="button"><X size={16} /></button></div>
            <p><strong>{archiveRequest.record.title}</strong></p>
            <label className="entry-field"><span>Reason <strong>Required</strong></span><textarea autoFocus onChange={(event) => setReason(event.target.value)} rows={4} value={reason} /></label>
            <div className="toolbar"><Button icon={X} onClick={() => setArchiveRequest(null)}>Cancel</Button><Button disabled={isSaving || !reason.trim()} icon={archiveRequest.restore ? ArchiveRestore : Archive} onClick={() => void changeArchiveState()} variant="primary">{archiveRequest.restore ? "Restore" : "Archive"}</Button></div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function unique(values: string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function formatRecordType(value: string) {
  return value.replaceAll("_", " ").replaceAll(".", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("en-GB");
}
