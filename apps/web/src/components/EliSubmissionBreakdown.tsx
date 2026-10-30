import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Search } from "lucide-react";
import { recordPath, staffPath } from "../app/routing";
import type { EliSubmissionStaffSummary } from "../services/types";
import { CollapsibleSection, Pagination } from "./CollapsibleSection";
import { DataTable } from "./DataTable";
import { compareListValues, distinctListValues, matchesListSearch } from "../services/listQuery";
import { Button } from "../design-system/Button";

export function EliSubmissionBreakdown({ rows, academicYear, onOpenStaff, onOpenRecord }: {
  rows: EliSubmissionStaffSummary[];
  academicYear: string;
  onOpenStaff: (staffId: string) => void;
  onOpenRecord: (recordId: string) => void;
}) {
  const [selection, setSelection] = useState<"all" | "submitted" | "not_submitted">("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [area, setArea] = useState("all");
  const [sortBy, setSortBy] = useState("staff");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const submitted = rows.filter(row => row.hasSubmitted).length;
  const visible = useMemo(() => {
    return rows.filter(row => (selection === "all" || row.hasSubmitted === (selection === "submitted"))
      && (area === "all" || (row.areaName ?? row.areaCode ?? "Unassigned") === area)
      && matchesListSearch(query, row.staffName, row.areaName, row.areaCode, row.parentAreaCode, row.hasSubmitted ? "Submitted" : "Not submitted", row.submittedAt, row.submittedAt ? new Date(row.submittedAt).toLocaleDateString("en-GB") : "", row.assessmentRecordId ? "View submitted ELI" : "No submitted assessment"))
      .sort((a, b) => {
        const value = (row: EliSubmissionStaffSummary) => sortBy === "area" ? row.areaName ?? row.areaCode : sortBy === "status" ? row.hasSubmitted ? "Submitted" : "Not submitted" : sortBy === "date" ? row.hasSubmitted && row.submittedAt ? new Date(row.submittedAt) : null : sortBy === "assessment" ? row.assessmentRecordId ? "View submitted ELI" : "No submitted assessment" : row.staffName;
        return compareListValues(value(a), value(b), direction) || a.staffName.localeCompare(b.staffName) || a.staffId.localeCompare(b.staffId);
      });
  }, [rows, selection, query, area, sortBy, direction]);
  const areas = distinctListValues(rows.map(row => row.areaName ?? row.areaCode ?? "Unassigned"));
  const totalPages = Math.max(1, Math.ceil(visible.length / 15));
  useEffect(() => { setPage(1); }, [rows, selection, query, area, sortBy, direction]);
  const currentPage = Math.min(page, totalPages);

  return <CollapsibleSection title="Staff submissions" storageKey="dashboard-eli-submissions" defaultExpanded
    count={rows.length} statusSummary={`${submitted} submitted · ${rows.length - submitted} not submitted`}>
    <p className="eli-submission-note">Staff in scope for {academicYear} and the selected faculty or team. Drafts and reopened assessments count as not submitted. Record date, theme and status filters do not change this staff breakdown.</p>
    <div className="dashboard-record-tools eli-submission-tools">
      <div className="segmented-control" role="group" aria-label="ELI submission status">
        <button type="button" aria-pressed={selection === "all"} onClick={() => setSelection("all")}>All staff ({rows.length})</button>
        <button type="button" aria-pressed={selection === "submitted"} onClick={() => setSelection("submitted")}>Submitted ({submitted})</button>
        <button type="button" aria-pressed={selection === "not_submitted"} onClick={() => setSelection("not_submitted")}>Not submitted ({rows.length - submitted})</button>
      </div>
      <label className="search-box dashboard-record-search"><Search size={16} aria-hidden="true" /><input aria-label="Search ELI submission breakdown" placeholder="Search staff or area" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <label className="dashboard-explorer-filter"><span>Area</span><select aria-label="ELI submission area" value={area} onChange={event => setArea(event.target.value)}><option value="all">All recorded areas</option>{areas.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label className="dashboard-explorer-filter"><span>Sort by</span><select aria-label="Sort ELI submissions by" value={sortBy} onChange={event => setSortBy(event.target.value)}><option value="staff">Staff member</option><option value="area">Area</option><option value="status">Submission status</option><option value="date">Submitted on</option><option value="assessment">Assessment</option></select></label>
      <label className="dashboard-explorer-filter"><span>Order</span><select aria-label="ELI submission sort order" value={direction} onChange={event => setDirection(event.target.value as "asc" | "desc")}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label>
      {selection !== "all" || query || area !== "all" ? <Button variant="quiet" onClick={() => { setSelection("all"); setQuery(""); setArea("all"); setPage(1); }}>Clear staff filters</Button> : null}
    </div>
    <p className="eli-submission-note" role="status">Staff shown: {visible.length}</p>
    {visible.length ? <DataTable caption="ELI staff submission status and submitted assessments" rows={visible.slice((currentPage - 1) * 15, currentPage * 15)} rowKey={row => row.staffId} columns={[
      { key: "staff", header: "Staff member", render: row => <a className="dashboard-detail-link" href={staffPath(row.staffId)} onClick={event => { event.preventDefault(); onOpenStaff(row.staffId); }}>{row.staffName}<ArrowUpRight size={14} aria-hidden="true" /></a> },
      { key: "area", header: "Area", render: row => row.areaName ?? row.areaCode ?? "Unassigned" },
      { key: "status", header: "Submission status", render: row => <span className={`status-pill ${row.hasSubmitted ? "status-complete" : "status-draft"}`}>{row.hasSubmitted ? "Submitted" : "Not submitted"}</span> },
      { key: "date", header: "Submitted on", render: row => row.hasSubmitted && row.submittedAt ? new Date(row.submittedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—" },
      { key: "assessment", header: "Assessment", render: row => row.hasSubmitted && row.assessmentRecordId ? <a className="dashboard-detail-link" href={recordPath(row.assessmentRecordId)} onClick={event => { event.preventDefault(); onOpenRecord(row.assessmentRecordId!); }}>View submitted ELI<ArrowUpRight size={14} aria-hidden="true" /></a> : "No submitted assessment" }
    ]} /> : <div className="section-state">No staff match this selection.</div>}
    <Pagination page={currentPage} totalPages={totalPages} onPageChange={setPage} />
  </CollapsibleSection>;
}
