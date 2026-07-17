import { Edit3, Search, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../design-system/Button";
import { api } from "../services/api";
import type { ElevatePracticeProgress } from "../services/types";
import { ElevatePracticeAdminEditor } from "./ElevatePractice";

export function AdminElevatePractice() {
  const [records, setRecords] = useState<ElevatePracticeProgress[]>([]);
  const [selectedAssessmentId, setSelectedAssessmentId] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [faculty, setFaculty] = useState("all");
  const [academicYear, setAcademicYear] = useState("all");
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState("");

  async function refresh(nextMessage = "") {
    setIsLoading(true);
    try {
      setRecords(await api.elevatePracticeProgress());
      setMessage(nextMessage);
    } catch {
      setMessage("Elevate Learning and Innovation records could not be loaded from the API.");
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
    const query = search.trim().toLowerCase();
    return records.filter((record) =>
      (status === "all" || record.status === status)
      && (faculty === "all" || record.facultyCode === faculty)
      && (academicYear === "all" || record.academicYear === academicYear)
      && (!query || `${record.staffName} ${record.externalId} ${record.email} ${record.facultyCode ?? ""} ${record.teamCode ?? ""}`.toLowerCase().includes(query))
    );
  }, [academicYear, faculty, records, search, status]);

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
        <div className="kpi"><span>Active staff</span><strong>{records.length}</strong></div>
        <div className="kpi kpi-amber"><span>Not started</span><strong>{records.filter((record) => record.status === "not_started").length}</strong></div>
        <div className="kpi kpi-blue"><span>Draft</span><strong>{records.filter((record) => record.status === "draft").length}</strong></div>
        <div className="kpi kpi-green"><span>Submitted</span><strong>{records.filter((record) => record.status === "submitted").length}</strong></div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div><p className="eyebrow">Self-assessment administration</p><h2>Elevate Learning and Innovation records</h2></div>
          <span>{filtered.length} shown</span>
        </div>

        <div className="filter-toolbar admin-elevate-filters">
          <label className="search-box"><Search aria-hidden="true" size={16} /><input onChange={(event) => setSearch(event.target.value)} placeholder="Search staff, ID or team" value={search} /></label>
          <label><span>Status</span><select onChange={(event) => setStatus(event.target.value)} value={status}><option value="all">All statuses</option><option value="not_started">Not started</option><option value="draft">Draft</option><option value="submitted">Submitted</option></select></label>
          <label><span>Faculty</span><select onChange={(event) => setFaculty(event.target.value)} value={faculty}><option value="all">All faculties</option>{faculties.map(([code, name]) => <option key={code} value={code}>{code} - {name}</option>)}</select></label>
          <label><span>Academic year</span><select onChange={(event) => setAcademicYear(event.target.value)} value={academicYear}><option value="all">All years</option>{academicYears.map((year) => <option key={year} value={year}>{year}</option>)}</select></label>
        </div>

        {message ? <div className="notice-row" role="status">{message}</div> : null}

        <div className="table-shell">
          <table>
            <thead><tr><th>Staff member</th><th>Faculty</th><th>Team</th><th>Year</th><th>Status</th><th>Last activity</th><th><span className="sr-only">Manage</span></th></tr></thead>
            <tbody>
              {isLoading ? <tr><td colSpan={7}>Loading records...</td></tr> : filtered.length === 0 ? <tr><td colSpan={7}>No staff match these filters.</td></tr> : filtered.map((record) => (
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
        </div>
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
