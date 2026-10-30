import { Archive, ArchiveRestore, Eye, History, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { confirmUnsavedNavigation, useUnsavedChanges } from "../components/UnsavedChangesGuard";
import { ModalDialog } from "../components/ModalDialog";
import { Button } from "../design-system/Button";
import { api } from "../services/api";
import type { AdminRecord, RecordAudit } from "../services/types";
import { AdminListSort } from "../components/AdminListSort";
import { distinctListValues, matchesListSearch, sortListRows } from "../services/listQuery";
import { WorkflowFilters } from "../components/WorkflowFilters";
import { ScrollableTableRegion } from "../components/ScrollableTableRegion";
import { LoadingState } from "../components/LoadingState";

type ArchiveRequest = { record: AdminRecord; restore: boolean };

export function AdminRecordsPanel({ onOpenRecord }: { onOpenRecord: (record: AdminRecord) => void }) {
  const [records, setRecords] = useState<AdminRecord[]>([]);
  const [search, setSearch] = useState("");
  const [staffFilter, setStaffFilter] = useState("");
  const [facultyFilter, setFacultyFilter] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [formFilter, setFormFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [sort, setSort] = useState("date-desc");
  const [archiveFilter, setArchiveFilter] = useState<"active" | "archived" | "all">("active");
  const [auditRecord, setAuditRecord] = useState<AdminRecord | null>(null);
  const [audit, setAudit] = useState<RecordAudit[]>([]);
  const [archiveRequest, setArchiveRequest] = useState<ArchiveRequest | null>(null);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState("");
  const [archiveError, setArchiveError] = useState("");
  const listSequence = useRef(0), auditSequence = useRef(0);
  useUnsavedChanges({ label: "Record archive reason", dirty: archiveRequest !== null && reason.length > 0, saving: isSaving,
    onDiscard: () => { setArchiveRequest(null); setReason(""); } });
  async function closeArchive() { if (await confirmUnsavedNavigation()) { setArchiveRequest(null); setReason(""); } }

  useEffect(() => {
    void refresh();
    return () => { ++listSequence.current; ++auditSequence.current; };
  }, []);

  async function refresh(nextMessage = "") {
    const sequence = ++listSequence.current;
    setLoading(true); setLoadError("");
    try {
      const next = await api.adminRecords();
      if (sequence !== listSequence.current) return;
      setRecords(next);
      setMessage(nextMessage);
    } catch {
      if (sequence === listSequence.current) setLoadError("Records could not be loaded. Check your connection and try again.");
    } finally { if (sequence === listSequence.current) setLoading(false); }
  }

  const options = useMemo(() => ({
    staff: unique(records.map((record) => record.subjectStaffName).filter(Boolean) as string[]),
    faculties: unique(records.map((record) => record.facultyCode).filter(Boolean) as string[]),
    teams: unique(records.map((record) => record.teamCode).filter(Boolean) as string[]),
    forms: unique(records.map((record) => `${record.moduleName}|${record.recordType}`))
  }), [records]);

  const visibleRecords = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return sortListRows(records.filter((record) => {
      const isArchived = Boolean(record.archivedAt);
      return matchesListSearch(query, record.title, record.subjectStaffName, record.ownerStaffName, record.facultyCode, record.facultyName, record.teamCode, record.teamName, record.moduleName, record.recordType, record.status, record.academicYear, record.recordDate)
        && (!staffFilter || record.subjectStaffName === staffFilter)
        && (!facultyFilter || record.facultyCode === facultyFilter)
        && (!teamFilter || record.teamCode === teamFilter)
        && (!formFilter || `${record.moduleName}|${record.recordType}` === formFilter)
        && (!statusFilter || record.status === statusFilter)
        && (!yearFilter || record.academicYear === yearFilter)
        && (archiveFilter === "all" || (archiveFilter === "archived" ? isArchived : !isArchived));
    }), record => sort.startsWith("staff") ? record.subjectStaffName : sort.startsWith("title") ? record.title : sort.startsWith("status") ? record.status : Date.parse(record.recordDate ?? record.createdAt), sort.endsWith("desc") ? "desc" : "asc", record => record.recordId);
  }, [archiveFilter, facultyFilter, formFilter, records, search, staffFilter, teamFilter, statusFilter, sort, yearFilter]);

  async function showAudit(record: AdminRecord) {
    const sequence = ++auditSequence.current;
    setAuditRecord(record);
    setAudit([]); setAuditLoading(true); setAuditError("");
    try {
      const next = await api.adminRecordAudit(record.recordId);
      if (sequence === auditSequence.current) setAudit(next);
    } catch {
      if (sequence === auditSequence.current) setAuditError("Audit history could not be loaded. Try again.");
    } finally { if (sequence === auditSequence.current) setAuditLoading(false); }
  }

  async function changeArchiveState() {
    if (!archiveRequest || !reason.trim()) return;
    setIsSaving(true);
    setArchiveError("");
    const result = archiveRequest.restore
      ? await api.restoreAdminRecord(archiveRequest.record.recordId, reason.trim())
      : await api.archiveAdminRecord(archiveRequest.record.recordId, reason.trim());
    setIsSaving(false);
    if (!result.ok) {
      setArchiveError(result.message ?? "The record status could not be changed. Your reason is still here; try again.");
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

      <WorkflowFilters activeCount={[staffFilter, facultyFilter, teamFilter, formFilter, statusFilter, yearFilter].filter(Boolean).length + Number(archiveFilter !== "active")} hasQuery={Boolean(search)} onClear={() => { setSearch(""); setStaffFilter(""); setFacultyFilter(""); setTeamFilter(""); setFormFilter(""); setStatusFilter(""); setYearFilter(""); setArchiveFilter("active"); }} primary={<>
        <div className="search-box">
          <Search size={16}  aria-hidden="true"/>
          <input aria-label="Search records" onChange={(event) => setSearch(event.target.value)} placeholder="Search title, staff, owner or area" type="search" value={search} />
        </div>
        <AdminListSort value={sort} onChange={setSort} options={[["date-desc","Record date: newest first"],["date-asc","Record date: oldest first"],["staff-asc","Staff: A–Z"],["title-asc","Title: A–Z"],["status-asc","Status: A–Z"]]} />
      </>}>
        <label><span>Staff</span><select onChange={(event) => setStaffFilter(event.target.value)} value={staffFilter}><option value="">All staff</option>{options.staff.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>Faculty</span><select onChange={(event) => setFacultyFilter(event.target.value)} value={facultyFilter}><option value="">All faculties</option>{options.faculties.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>Team</span><select onChange={(event) => setTeamFilter(event.target.value)} value={teamFilter}><option value="">All teams</option>{options.teams.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>Form</span><select onChange={(event) => setFormFilter(event.target.value)} value={formFilter}><option value="">All forms</option>{options.forms.map((value) => { const [label, type] = value.split("|"); return <option key={value} value={value}>{label} ({formatRecordType(type)})</option>; })}</select></label>
        <label><span>Record state</span><select onChange={(event) => setArchiveFilter(event.target.value as typeof archiveFilter)} value={archiveFilter}><option value="active">Active</option><option value="archived">Archived</option><option value="all">All</option></select></label>
        <label><span>Status</span><select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="">All statuses</option>{distinctListValues(records.map(record => record.status)).map(value => <option key={value} value={value}>{formatRecordType(value)}</option>)}</select></label>
        <label><span>Academic year</span><select value={yearFilter} onChange={event => setYearFilter(event.target.value)}><option value="">All years</option>{distinctListValues(records.map(record => record.academicYear)).reverse().map(value => <option key={value}>{value}</option>)}</select></label>
      </WorkflowFilters>

      {message ? <div className="notice-row" role="status">{message}</div> : null}
      {loadError ? <div className="notice-row" role="alert">{loadError}<Button disabled={loading} onClick={() => void refresh()}>Try again</Button></div> : null}
      {loading ? <LoadingState label="Loading records" /> : null}

      <ScrollableTableRegion label="Administrative records"><div className="admin-record-table" role="table" aria-label="Administrative records">
        <div className="admin-record-row admin-record-row-heading" role="row">
          <span role="columnheader">Record</span><span role="columnheader">Staff / owner</span><span role="columnheader">Area</span><span role="columnheader">Status</span><span role="columnheader">Date</span><span role="columnheader">Actions</span>
        </div>
        {visibleRecords.map((record) => (
          <div className={`admin-record-row${record.archivedAt ? " is-inactive" : ""}`} key={record.recordId} role="row">
            <div role="cell"><strong>{record.title}</strong><span>{record.moduleName} / {formatRecordType(record.recordType)}</span></div>
            <div role="cell"><strong>{record.subjectStaffName ?? "No subject"}</strong><span>{record.ownerStaffName ? `Owner: ${record.ownerStaffName}` : "No owner"}</span></div>
            <div role="cell"><strong>{record.teamCode ?? record.facultyCode ?? "Unassigned"}</strong><span>{record.teamName ?? record.facultyName ?? "No organisation area"}</span></div>
            <span role="cell" className={`status-pill status-${record.archivedAt ? "archived" : record.status}`}>{record.archivedAt ? "Archived" : formatRecordType(record.status)}</span>
            <span role="cell">{formatDate(record.recordDate ?? record.createdAt)}</span>
            <div className="admin-row-actions" role="cell">
              {!record.archivedAt ? <button aria-label={`Open ${record.title}`} className="icon-button" onClick={() => onOpenRecord(record)} title="Open and edit record" type="button"><Eye aria-hidden="true" size={16} /></button> : null}
              <button aria-label={`Audit history for ${record.title}`} className="icon-button" onClick={() => void showAudit(record)} title="View audit history" type="button"><History aria-hidden="true" size={16} /></button>
              <button aria-label={`${record.archivedAt ? "Restore" : "Archive"} ${record.title}`} className="icon-button" onClick={() => { setArchiveRequest({ record, restore: Boolean(record.archivedAt) }); setReason(""); setArchiveError(""); }} title={record.archivedAt ? "Restore record" : "Archive record"} type="button">
                {record.archivedAt ? <ArchiveRestore size={16}  aria-hidden="true"/> : <Archive size={16}  aria-hidden="true"/>}
              </button>
            </div>
          </div>
        ))}
        {!loading && !loadError && visibleRecords.length === 0 ? <div className="empty-row" role="row"><span role="cell" aria-colspan={6}>No records match the current filters.</span></div> : null}
      </div></ScrollableTableRegion>

      {auditRecord ? (
        <div className="admin-audit-panel">
          <div className="panel-heading"><div><h2>Audit history</h2><span>{auditRecord.title}</span></div><button aria-label="Close audit history" className="icon-button" onClick={() => { ++auditSequence.current; setAuditRecord(null); }} title="Close audit history" type="button"><X aria-hidden="true" size={16} /></button></div>
          {auditLoading ? <LoadingState label="Loading audit history" /> : null}
          {auditError ? <div className="notice-row" role="alert">{auditError}<Button onClick={() => void showAudit(auditRecord)}>Try again</Button></div> : null}
          <div className="admin-audit-list">
            {audit.map((entry) => (
              <div className="admin-audit-row" key={entry.id}>
                <div><strong>{formatRecordType(entry.action)}</strong><span>{entry.actorName} / {formatDate(entry.createdAt)}</span></div>
                <p>{entry.summary ?? "No summary recorded."}</p>
                {entry.reason ? <blockquote>Reason: {entry.reason}</blockquote> : null}
                {entry.beforeJson || entry.afterJson ? <details><summary>Change data</summary><pre>{entry.beforeJson ?? "No previous value"}{"\n"}{entry.afterJson ?? "No new value"}</pre></details> : null}
              </div>
            ))}
            {!auditLoading && !auditError && audit.length === 0 ? <div className="empty-row">No audit entries are recorded for this item.</div> : null}
          </div>
        </div>
      ) : null}

      {archiveRequest ? (
        <ModalDialog className="admin-reason-dialog" busy={isSaving} onClose={() => void closeArchive()} label={archiveRequest.restore ? "Restore record" : "Archive record"}>
          <div>
            <div className="panel-heading"><h2>{archiveRequest.restore ? "Restore" : "Archive"} record</h2><button disabled={isSaving} className="icon-button" onClick={() => void closeArchive()} title="Close" type="button" aria-label="Close"><X size={16}  aria-hidden="true"/></button></div>
            <p><strong>{archiveRequest.record.title}</strong></p>
            <label className="entry-field"><span>Reason <strong>Required</strong></span><textarea disabled={isSaving} autoFocus onChange={(event) => setReason(event.target.value)} rows={4} value={reason} /></label>
            {archiveError ? <p className="error-copy" role="alert">{archiveError}</p> : null}
            <div className="toolbar"><Button disabled={isSaving} icon={X} onClick={() => void closeArchive()}>Cancel</Button><Button disabled={isSaving || !reason.trim()} icon={archiveRequest.restore ? ArchiveRestore : Archive} onClick={() => void changeArchiveState()} variant="primary">{archiveRequest.restore ? "Restore" : "Archive"}</Button></div>
          </div>
        </ModalDialog>
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
