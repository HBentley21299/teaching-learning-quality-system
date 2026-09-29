import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Search } from "lucide-react";
import { recordPath, staffPath } from "../app/routing";
import type { EliSubmissionStaffSummary } from "../services/types";
import { CollapsibleSection, Pagination } from "./CollapsibleSection";
import { DataTable } from "./DataTable";

export function EliSubmissionBreakdown({ rows, academicYear, onOpenStaff, onOpenRecord }: {
  rows: EliSubmissionStaffSummary[];
  academicYear: string;
  onOpenStaff: (staffId: string) => void;
  onOpenRecord: (recordId: string) => void;
}) {
  const [selection, setSelection] = useState<"all" | "submitted" | "not_submitted">("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const submitted = rows.filter(row => row.hasSubmitted).length;
  const visible = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return rows.filter(row => (selection === "all" || row.hasSubmitted === (selection === "submitted"))
      && (!search || [row.staffName, row.areaName, row.areaCode, row.parentAreaCode].some(value => value?.toLocaleLowerCase().includes(search))))
      .sort((a, b) => a.staffName.localeCompare(b.staffName) || a.staffId.localeCompare(b.staffId));
  }, [rows, selection, query]);
  const totalPages = Math.max(1, Math.ceil(visible.length / 15));
  useEffect(() => { setPage(1); }, [rows, selection, query]);
  const currentPage = Math.min(page, totalPages);

  return <CollapsibleSection title="ELI submission breakdown" storageKey="dashboard-eli-submissions" defaultExpanded
    count={rows.length} statusSummary={`${submitted} submitted · ${rows.length - submitted} not submitted`}>
    <p className="eli-submission-note">Staff in scope for {academicYear} and the selected faculty or team. Drafts and reopened assessments count as not submitted. Record date, theme and status filters do not change this staff breakdown.</p>
    <div className="dashboard-record-tools eli-submission-tools">
      <div className="segmented-control" role="group" aria-label="ELI submission status">
        <button type="button" aria-pressed={selection === "all"} onClick={() => setSelection("all")}>All staff ({rows.length})</button>
        <button type="button" aria-pressed={selection === "submitted"} onClick={() => setSelection("submitted")}>Submitted ({submitted})</button>
        <button type="button" aria-pressed={selection === "not_submitted"} onClick={() => setSelection("not_submitted")}>Not submitted ({rows.length - submitted})</button>
      </div>
      <label className="search-box dashboard-record-search"><Search size={16} aria-hidden="true" /><input aria-label="Search ELI submission breakdown" placeholder="Search staff or area" value={query} onChange={event => setQuery(event.target.value)} /></label>
    </div>
    <p className="eli-submission-note" role="status">Staff shown: {visible.length}</p>
    {visible.length ? <DataTable rows={visible.slice((currentPage - 1) * 15, currentPage * 15)} rowKey={row => row.staffId} columns={[
      { key: "staff", header: "Staff member", render: row => <a className="dashboard-detail-link" href={staffPath(row.staffId)} onClick={event => { event.preventDefault(); onOpenStaff(row.staffId); }}>{row.staffName}<ArrowUpRight size={14} aria-hidden="true" /></a> },
      { key: "area", header: "Area", render: row => row.areaName ?? row.areaCode ?? "Unassigned" },
      { key: "status", header: "Submission status", render: row => <span className="status-pill">{row.hasSubmitted ? "Submitted" : "Not submitted"}</span> },
      { key: "date", header: "Submitted on", render: row => row.hasSubmitted && row.submittedAt ? new Date(row.submittedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—" },
      { key: "assessment", header: "Assessment", render: row => row.hasSubmitted && row.assessmentRecordId ? <a className="dashboard-detail-link" href={recordPath(row.assessmentRecordId)} onClick={event => { event.preventDefault(); onOpenRecord(row.assessmentRecordId!); }}>View submitted ELI<ArrowUpRight size={14} aria-hidden="true" /></a> : "No submitted assessment" }
    ]} /> : <div className="section-state">No staff match this selection.</div>}
    <Pagination page={currentPage} totalPages={totalPages} onPageChange={setPage} />
  </CollapsibleSection>;
}
