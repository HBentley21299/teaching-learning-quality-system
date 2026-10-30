import { ScrollableTableRegion } from "../components/ScrollableTableRegion";
import { LoadingState } from "../components/LoadingState";
import { Edit3, Search, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../design-system/Button";
import { api } from "../services/api";
import type { ElevatePracticeProgress } from "../services/types";
import { ElevatePracticeAdminEditor } from "./ElevatePractice";
import { AdminListSort } from "../components/AdminListSort";
import { distinctListValues, matchesListSearch, sortListRows } from "../services/listQuery";
import { WorkflowFilters } from "../components/WorkflowFilters";

export function AdminElevatePractice() {
  const [records, setRecords] = useState<ElevatePracticeProgress[]>([]);
  const [selectedAssessmentId, setSelectedAssessmentId] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [faculty, setFaculty] = useState("all");
  const [academicYear, setAcademicYear] = useState("all");
  const [team, setTeam] = useState("");
  const [sort, setSort] = useState("staff-asc");
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");

  async function refresh(nextMessage = "") {
    setIsLoading(true);
    setLoadError("");
    try {
      setRecords(await api.elevatePracticeProgress("all"));
      setMessage(nextMessage);
    } catch {
      setLoadError("ELI records could not be loaded. Check your connection and try again.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const faculties = useMemo(
    () => Array.from(new Map(records.filter((record) => record.facultyCode).map((record) => [record.facultyCode!, record.facultyName ?? record.facultyCode!])).entries()),
    [records]
  );
  const academicYears = useMemo(
    () => Array.from(new Set(records.map((record) => record.academicYear))).sort().reverse(),
    [records]
  );
  const filtered = useMemo(() => {
    return sortListRows(records.filter((record) =>
      (status === "all" || record.status === status)
      && (faculty === "all" || record.facultyCode === faculty)
      && (academicYear === "all" || record.academicYear === academicYear)
      && (!team || record.teamCode === team)
      && matchesListSearch(search, record.staffName, record.externalId, record.email, record.facultyCode, record.facultyName, record.teamCode, record.teamName, record.academicYear, statusLabel(record.status))
    ), record => sort.startsWith("activity") ? Date.parse(record.submittedAt ?? record.updatedAt ?? "") : sort.startsWith("year") ? record.academicYear : sort.startsWith("status") ? statusLabel(record.status) : record.staffName, sort.endsWith("desc") ? "desc" : "asc", record => `${record.staffId}-${record.academicYear}`);
  }, [academicYear, faculty, records, search, status, team, sort]);

  if (selectedAssessmentId) {
    return (
      <ElevatePracticeAdminEditor
        assessmentId={selectedAssessmentId}
        onBack={() => setSelectedAssessmentId("")}
        onDeleted={() => {
          setSelectedAssessmentId("");
          void refresh("Elevate Learning and Innovation record deleted. Its audit history has been retained.");
        }}
      />
    );
  }

  return (
    <div className="route-stack">
      <section className="kpi-strip" aria-label="Elevate Learning and Innovation completion summary">
        <div className="kpi"><span>Staff/year entries</span><strong>{records.length}</strong></div>
        <div className="kpi kpi-amber"><span>Not started</span><strong>{records.filter((record) => record.status === "not_started").length}</strong></div>
        <div className="kpi kpi-blue"><span>Draft</span><strong>{records.filter((record) => record.status === "draft").length}</strong></div>
        <div className="kpi kpi-green"><span>Submitted</span><strong>{records.filter((record) => record.status === "submitted").length}</strong></div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div><p className="eyebrow">Self-assessment administration</p><h2>Elevate Learning and Innovation records</h2></div>
          <span>{filtered.length} shown</span>
        </div>
        <p className="muted-copy">All retained assessment years are included, including records for former staff. Not started shows active staff with no assessment record. Summary counts cover the complete list; the filters below narrow the table.</p>

        <WorkflowFilters activeCount={[status, faculty, academicYear].filter(value => value !== "all").length + Number(Boolean(team))} hasQuery={Boolean(search)} onClear={() => { setSearch(""); setStatus("all"); setFaculty("all"); setAcademicYear("all"); setTeam(""); }} primary={<>
          <label className="search-box"><Search aria-hidden="true" size={16} /><input aria-label="Search ELI administration records" type="search" onChange={(event) => setSearch(event.target.value)} placeholder="Search staff, ID or team" value={search} /></label>
          <AdminListSort value={sort} onChange={setSort} options={[["staff-asc","Staff: A–Z"],["staff-desc","Staff: Z–A"],["activity-desc","Last activity: newest first"],["activity-asc","Last activity: oldest first"],["year-desc","Academic year: newest first"],["status-asc","Status: A–Z"]]} />
        </>}>
          <label><span>Status</span><select onChange={(event) => setStatus(event.target.value)} value={status}><option value="all">All statuses</option><option value="not_started">Not started</option><option value="draft">Draft</option><option value="submitted">Submitted</option></select></label>
          <label><span>Faculty</span><select onChange={(event) => setFaculty(event.target.value)} value={faculty}><option value="all">All faculties</option>{faculties.map(([code, name]) => <option key={code} value={code}>{code} - {name}</option>)}</select></label>
          <label><span>Academic year</span><select onChange={(event) => setAcademicYear(event.target.value)} value={academicYear}><option value="all">All years</option>{academicYears.map((year) => <option key={year} value={year}>{year}</option>)}</select></label>
          <label><span>Team</span><select value={team} onChange={event => setTeam(event.target.value)}><option value="">All teams</option>{distinctListValues(records.map(record => record.teamCode)).map(value => <option key={value}>{value}</option>)}</select></label>
        </WorkflowFilters>

        {message ? <div className="notice-row" role="status">{message}</div> : null}
        {loadError ? <div className="notice-row" role="alert">{loadError}<Button disabled={isLoading} onClick={() => void refresh()}>Try again</Button></div> : null}

        <ScrollableTableRegion label="ELI administration records">
          <table aria-label="ELI administration records">
            <thead><tr><th scope="col">Staff member</th><th scope="col">Faculty</th><th scope="col">Team</th><th scope="col">Year</th><th scope="col">Status</th><th scope="col">Last activity</th><th scope="col"><span className="sr-only">Manage</span></th></tr></thead>
            <tbody>
              {isLoading ? <tr><td colSpan={7}><LoadingState label="Loading records" /></td></tr> : filtered.length === 0 ? <tr><td colSpan={7}>No staff match these filters.</td></tr> : filtered.map((record) => (
                <tr key={`${record.staffId}-${record.academicYear}`}>
                  <td><strong>{record.staffName}</strong><small className="table-subline">{record.externalId}</small></td>
                  <td>{record.facultyCode ?? "Unassigned"}</td>
                  <td>{record.teamCode ?? "Unassigned"}</td>
                  <td>{record.academicYear}</td>
                  <td><span className={`status-pill ${statusClass(record.status)}`}>{statusLabel(record.status)}</span></td>
                  <td>{record.submittedAt ? formatDate(record.submittedAt) : record.updatedAt ? formatDate(record.updatedAt) : "No activity"}</td>
                  <td>{record.assessmentId ? <Button icon={Edit3} onClick={() => setSelectedAssessmentId(record.assessmentId!)}>Manage</Button> : <span className="muted-copy">No record</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollableTableRegion>
      </section>

      <section className="admin-elevate-note">
        <Sparkles aria-hidden="true" size={18} />
        <p>Scores remain available to calculations and reporting, but this administration view uses the agreed rubric wording throughout.</p>
      </section>
    </div>
  );
}

function statusLabel(status: ElevatePracticeProgress["status"]) {
  return status === "not_started" ? "Not started" : status === "draft" ? "Draft" : "Submitted";
}

function statusClass(status: ElevatePracticeProgress["status"]) {
  return status === "not_started" ? "status-overdue" : status === "draft" ? "status-draft" : "status-complete";
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
