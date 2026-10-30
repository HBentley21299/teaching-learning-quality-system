import { ScrollableTableRegion } from "../components/ScrollableTableRegion";
import { LoadingState } from "../components/LoadingState";
import { ArchiveRestore, ArrowLeft, Edit3, History, Save, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CourseMultiSelect } from "../components/CourseMultiSelect";
import { confirmUnsavedNavigation, useUnsavedChanges } from "../components/UnsavedChangesGuard";
import { WorkScrutinyResponseField } from "../components/WorkScrutinyCreateForm";
import { Button } from "../design-system/Button";
import { api } from "../services/api";
import { AdminListSort } from "../components/AdminListSort";
import { distinctListValues, matchesListSearch, sortListRows } from "../services/listQuery";
import { WorkflowFilters } from "../components/WorkflowFilters";
import type {
  AdminWorkScrutinyAction,
  AdminWorkScrutinyRecord,
  CourseSummary,
  RecordAudit,
  RecordDetail
} from "../services/types";

export function AdminWorkScrutiny() {
  const [records, setRecords] = useState<AdminWorkScrutinyRecord[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<AdminWorkScrutinyRecord | null>(null);
  const [detail, setDetail] = useState<RecordDetail | null>(null);
  const [audit, setAudit] = useState<RecordAudit[]>([]);
  const [actions, setActions] = useState<AdminWorkScrutinyAction[]>([]);
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [courseIds, setCourseIds] = useState<string[]>([]);
  const [recordDate, setRecordDate] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [facultyFilter, setFacultyFilter] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [sort, setSort] = useState("date-desc");
  const [recordState, setRecordState] = useState<"active" | "deleted" | "all">("active");
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [opening, setOpening] = useState(false);
  const selectionSequence = useRef(0), listSequence = useRef(0);
  const usesCourseLevel = detail?.sections.some(section => section.fields.some(field => ["qualification_level", "course_level", "course_or_unit"].includes(field.fieldKey))) ?? false;
  const dirty = isEditing && detail !== null && (recordDate !== (detail.recordDate ?? "")
    || JSON.stringify([...courseIds].sort()) !== JSON.stringify([...detail.courseIds].sort())
    || detail.sections.some(section => section.fields.some(field => (responses[field.id] ?? "") !== (field.value ?? ""))));
  const clearUnsaved = useUnsavedChanges({ label: "Work Scrutiny correction", dirty, saving: isSaving, onSave: saveRecord,
    onDiscard: () => { setIsEditing(false); if (detail) { setResponses(Object.fromEntries(detail.sections.flatMap(section => section.fields.map(field => [field.id, field.value ?? ""])))); setCourseIds(detail.courseIds); setRecordDate(detail.recordDate ?? ""); } } });

  async function refreshRecords(nextMessage = "") {
    const sequence = ++listSequence.current;
    setIsLoading(true);
    setLoadError("");
    try {
      const next = await api.adminWorkScrutinyRecords();
      if (sequence !== listSequence.current) return;
      setRecords(next);
      setMessage(nextMessage);
    } catch {
      if (sequence === listSequence.current) setLoadError("Work Scrutiny records could not be loaded. Check your connection and try again.");
    } finally {
      if (sequence === listSequence.current) setIsLoading(false);
    }
  }

  useEffect(() => {
    void refreshRecords();
    return () => { ++selectionSequence.current; ++listSequence.current; };
  }, []);

  const filteredRecords = useMemo(() => {
    return sortListRows(records.filter((record) =>
      (recordState === "all"
        || (recordState === "deleted" ? Boolean(record.archivedAt) : !record.archivedAt))
      && (!statusFilter || record.submissionStatus === statusFilter)
      && (!facultyFilter || record.parentOrgUnitCode === facultyFilter)
      && (!teamFilter || record.orgUnitCode === teamFilter)
      && (!actionFilter || (actionFilter === "open" ? record.openActionCount > 0 : record.openActionCount === 0))
      && matchesListSearch(search, record.title, record.summary, record.orgUnitCode, record.orgUnitName, record.parentOrgUnitCode, record.ownerDisplayName, record.submissionStatus, record.recordDate)
    ), record => sort.startsWith("team") ? record.orgUnitCode : sort.startsWith("creator") ? record.ownerDisplayName : sort.startsWith("title") ? record.title : sort.startsWith("actions") ? record.openActionCount : Date.parse(record.recordDate ?? record.createdAt), sort.endsWith("desc") ? "desc" : "asc", record => record.id);
  }, [recordState, records, search, statusFilter, facultyFilter, teamFilter, actionFilter, sort]);

  async function openRecord(record: AdminWorkScrutinyRecord, afterSave = false) {
    if (!afterSave && !await confirmUnsavedNavigation()) return;
    const sequence = ++selectionSequence.current;
    setSelectedRecord(record);
    setDetail(null);
    setAudit([]); setActions([]); setCourses([]); setDetailError(""); setOpening(true);
    setIsEditing(false);
    setMessage("");
    try {
      const [nextDetail, nextAudit, linkedActions, nextCourses] = await Promise.all([
        api.adminWorkScrutinyRecord(record.id),
        api.workScrutinyRecordAudit(record.id),
        api.adminWorkScrutinyActions(record.id),
        record.orgUnitId ? api.courses(record.orgUnitId) : Promise.resolve([])
      ]);
      if (sequence !== selectionSequence.current) return;
      setDetail(nextDetail);
      setAudit(nextAudit);
      setActions(linkedActions);
      setCourses(nextCourses);
      setResponses(Object.fromEntries(nextDetail.sections.flatMap((section) => section.fields.map((field) => [field.id, field.value ?? ""]))));
      setCourseIds(nextDetail.courseIds);
      setRecordDate(nextDetail.recordDate ?? "");
    } catch {
      if (sequence === selectionSequence.current) setDetailError("This Work Scrutiny record could not be opened. Check your connection and try again.");
    } finally { if (sequence === selectionSequence.current) setOpening(false); }
  }

  async function saveRecord() {
    if (!detail || !selectedRecord || !recordDate || (!usesCourseLevel && courseIds.length === 0)) {
      setMessage(usesCourseLevel ? "Enter the scrutiny date." : "Enter the scrutiny date and select at least one sampled course.");
      return false;
    }

    const missingField = detail.sections
      .flatMap((section) => section.fields)
      .find((field) => field.isRequired && !responses[field.id]?.trim());
    if (missingField) {
      setMessage(`Complete the required field: ${missingField.label}.`);
      return false;
    }

    const selectedCourses = courseIds
      .map((courseId) => courses.find((course) => course.id === courseId))
      .filter((course): course is CourseSummary => Boolean(course));
    setIsSaving(true);
    const result = await api.updateFormSubmission(detail.submissionId, {
      title: detail.title,
      summary: selectedCourses.length ? selectedCourses.map((course) => `${course.courseCode} - ${course.courseName}`).join("; ") : detail.summary,
      orgUnitId: detail.orgUnitId,
      recordDate,
      responses: detail.sections.flatMap((section) => section.fields.map((field) => ({
        fieldId: field.id,
        value: responses[field.id] || undefined
      }))),
      courseIds
    });
    if (!result.ok) {
      setIsSaving(false);
      setMessage(result.message ?? "The Work Scrutiny record could not be updated.");
      return false;
    }

    clearUnsaved();
    await refreshRecords();
    await openRecord({ ...selectedRecord, recordDate }, true);
    setIsEditing(false);
    setMessage("Work Scrutiny record updated and audit history recorded.");
    setIsSaving(false);
    return true;
  }

  async function deleteRecord() {
    if (!await confirmUnsavedNavigation()) return;
    if (!selectedRecord || !window.confirm("Delete this Work Scrutiny record? It will leave dashboards and action lists, but can be restored from Deleted records.")) {
      return;
    }

    setIsSaving(true);
    const result = await api.deleteWorkScrutinyRecord(selectedRecord.id);
    setIsSaving(false);
    if (!result.ok) {
      setMessage(result.message ?? "The Work Scrutiny record could not be deleted.");
      return;
    }

    setSelectedRecord(null);
    setDetail(null);
    setRecordState("deleted");
    await refreshRecords("Work Scrutiny record deleted. Its data and audit history have been retained.");
  }

  async function restoreRecord() {
    if (!selectedRecord) {
      return;
    }

    setIsSaving(true);
    const result = await api.restoreWorkScrutinyRecord(selectedRecord.id);
    setIsSaving(false);
    if (!result.ok) {
      setMessage(result.message ?? "The Work Scrutiny record could not be restored.");
      return;
    }

    setSelectedRecord(null);
    setDetail(null);
    setRecordState("active");
    await refreshRecords("Work Scrutiny record and its linked actions restored.");
  }

  if (selectedRecord) {
    return (
      <div className="route-stack">
        <div className="admin-record-editor-heading">
          <Button disabled={isSaving} icon={ArrowLeft} onClick={async () => { if (await confirmUnsavedNavigation()) { ++selectionSequence.current; setSelectedRecord(null); setDetail(null); } }}>Back to records</Button>
          {selectedRecord.archivedAt ? (
            <Button disabled={isSaving} icon={ArchiveRestore} onClick={() => void restoreRecord()} variant="primary">Restore record</Button>
          ) : (
            <Button disabled={isSaving} icon={Trash2} onClick={() => void deleteRecord()} variant="danger">Delete record</Button>
          )}
        </div>
        {message ? <div className="notice-row" role="status">{message}</div> : null}
        {!detail ? (
          <section className="panel">{opening ? <LoadingState label="Loading Work Scrutiny record" /> : null}{detailError ? <div className="notice-row" role="alert">{detailError}<Button onClick={() => void openRecord(selectedRecord)}>Try again</Button></div> : null}</section>
        ) : (
          <>
            <section className="panel">
              <div className="panel-heading">
                <div><p className="eyebrow">Work Scrutiny record</p><h2>{detail.title}</h2></div>
                <span className={`status-pill ${selectedRecord.archivedAt ? "status-overdue" : "status-complete"}`}>
                  {selectedRecord.archivedAt ? "Deleted" : detail.submissionStatus}
                </span>
              </div>
              <div className="record-detail-meta">
                <span>{detail.parentOrgUnitCode ? `${detail.parentOrgUnitCode} / ` : ""}{detail.orgUnitCode ?? "No sub-team"}</span>
                <span>{detail.ownerDisplayName ?? "No creator"}</span>
                <span>{detail.templateName} v{detail.templateVersion}</span>
              </div>

              {isEditing ? (
                <fieldset className="entry-form editor-fieldset" disabled={isSaving}>
                  <div className="entry-section">
                    <h3>Context and sample</h3>
                    <div className="entry-field-grid">
                      <label className="entry-field">
                        <span>Date of scrutiny <strong>Required</strong></span>
                        <input onChange={(event) => setRecordDate(event.target.value)} type="date" value={recordDate} />
                      </label>
                      {!usesCourseLevel || courseIds.length > 0 ? <label className="entry-field entry-field-wide">
                        <span>Courses sampled <strong>Required</strong></span>
                        <CourseMultiSelect
                          courses={courses}
                          id={`admin-work-scrutiny-courses-${detail.id}`}
                          onChange={setCourseIds}
                          selectedIds={courseIds}
                        />
                      </label> : null}
                    </div>
                  </div>
                  {detail.sections.map((section) => (
                    <div className="entry-section" key={section.id}>
                      <h3>{section.title}</h3>
                      <div className="entry-field-grid">
                        {section.fields.map((field) => (
                          <WorkScrutinyResponseField
                            field={field}
                            key={field.id}
                            onChange={(value) => setResponses((current) => ({ ...current, [field.id]: value }))}
                            value={responses[field.id] ?? ""}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                  <div className="toolbar">
                    <Button disabled={isSaving} icon={X} onClick={async () => { if (await confirmUnsavedNavigation()) setIsEditing(false); }}>Cancel</Button>
                    <Button disabled={isSaving} icon={Save} onClick={() => void saveRecord()} variant="primary">Save changes</Button>
                  </div>
                </fieldset>
              ) : (
                <>
                  <div className="record-context-note">
                    <strong>Courses sampled</strong>
                    <span>{detail.summary ?? "No course sample recorded"}</span>
                  </div>
                  <div className="answer-section-list">
                    {detail.sections.map((section) => (
                      <div className="answer-section" key={section.id}>
                        <h3>{section.title}</h3>
                        <div className="answer-grid">
                          {section.fields.map((field) => (
                            <div className={field.fieldType === "long_text" ? "answer-item answer-item-wide" : "answer-item"} key={field.id}>
                              <span>{field.label}</span>
                              <strong>{formatAnswer(field.value)}</strong>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  {!selectedRecord.archivedAt ? (
                    <div className="toolbar">
                      <Button icon={Edit3} onClick={() => setIsEditing(true)} variant="primary">Edit record</Button>
                    </div>
                  ) : null}
                </>
              )}
            </section>

            <section className="panel">
              <div className="panel-heading"><h2>Central actions</h2><span>{actions.length} linked</span></div>
              {actions.length === 0 ? <p className="muted-copy">No actions were raised from this scrutiny.</p> : (
                <div className="admin-linked-action-list">
                  {actions.map((action) => (
                    <article key={action.id}>
                      <div><strong>{action.title}</strong><span>{action.ownerDisplayName ?? "No owner"}</span></div>
                      <div><span>Date to be implemented by</span><strong>{action.dueDate ? formatDate(action.dueDate) : "No date"}</strong></div>
                      <span className={`status-pill ${action.archivedAt ? "status-overdue" : action.completedDate ? "status-complete" : "status-open"}`}>
                        {action.archivedAt ? "Deleted with record" : action.completedDate ? "Completed" : "Open"}
                      </span>
                    </article>
                  ))}
                </div>
              )}
              <p className="muted-copy">Action progress is maintained in the central Actions area and remains linked to this source record.</p>
            </section>

            <AuditHistory audit={audit} />
          </>
        )}
      </div>
    );
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <div><p className="eyebrow">Audited record administration</p><h2>Work Scrutiny records</h2></div>
        <span>{filteredRecords.length} shown</span>
      </div>
      <WorkflowFilters activeCount={[statusFilter, facultyFilter, teamFilter, actionFilter].filter(Boolean).length + Number(recordState !== "active")} hasQuery={Boolean(search)} onClear={() => { setSearch(""); setStatusFilter(""); setFacultyFilter(""); setTeamFilter(""); setActionFilter(""); setRecordState("active"); }} primary={<>
        <label className="search-box">
          <Search aria-hidden="true" size={16} />
          <input aria-label="Search Work Scrutiny records" type="search" onChange={(event) => setSearch(event.target.value)} placeholder="Search team, creator or course" value={search} />
        </label>
        <AdminListSort value={sort} onChange={setSort} options={[["date-desc","Scrutiny date: newest first"],["date-asc","Scrutiny date: oldest first"],["team-asc","Team: A–Z"],["creator-asc","Creator: A–Z"],["title-asc","Title: A–Z"],["actions-desc","Open actions: most first"]]} />
      </>}>
        <label>
          <span>Record state</span>
          <select onChange={(event) => setRecordState(event.target.value as typeof recordState)} value={recordState}>
            <option value="active">Active records</option>
            <option value="deleted">Deleted records</option>
            <option value="all">All records</option>
          </select>
        </label>
        <label><span>Submission status</span><select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="">All statuses</option>{distinctListValues(records.map(record => record.submissionStatus)).map(value => <option key={value}>{value}</option>)}</select></label>
        <label><span>Faculty</span><select value={facultyFilter} onChange={event => setFacultyFilter(event.target.value)}><option value="">All faculties</option>{distinctListValues(records.map(record => record.parentOrgUnitCode)).map(value => <option key={value}>{value}</option>)}</select></label>
        <label><span>Team</span><select value={teamFilter} onChange={event => setTeamFilter(event.target.value)}><option value="">All teams</option>{distinctListValues(records.map(record => record.orgUnitCode)).map(value => <option key={value}>{value}</option>)}</select></label>
        <label><span>Linked actions</span><select value={actionFilter} onChange={event => setActionFilter(event.target.value)}><option value="">Any actions</option><option value="open">Has open actions</option><option value="none">No open actions</option></select></label>
      </WorkflowFilters>
      {message ? <div className="notice-row" role="status">{message}</div> : null}
      {loadError ? <div className="notice-row" role="alert">{loadError}<Button disabled={isLoading} onClick={() => void refreshRecords()}>Try again</Button></div> : null}
      <ScrollableTableRegion label="Work Scrutiny data">
        <table aria-label="Work Scrutiny data">
          <thead><tr><th scope="col">Sub-team</th><th scope="col">Scrutiny date</th><th scope="col">Created by</th><th scope="col">Actions</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Manage</span></th></tr></thead>
          <tbody>
            {isLoading ? <tr><td colSpan={6}><LoadingState label="Loading Work Scrutiny records" /></td></tr> : filteredRecords.length === 0 ? <tr><td colSpan={6}>No records match these filters.</td></tr> : filteredRecords.map((record) => (
              <tr key={record.id}>
                <td><strong>{record.orgUnitCode ?? "Unassigned"}</strong><small className="table-subline">{record.orgUnitName ?? record.title}</small></td>
                <td>{record.recordDate ? formatDate(record.recordDate) : "No date"}</td>
                <td>{record.ownerDisplayName ?? "Unknown"}</td>
                <td>{record.openActionCount} open, {record.completedActionCount} completed</td>
                <td><span className={`status-pill ${record.archivedAt ? "status-overdue" : "status-complete"}`}>{record.archivedAt ? "Deleted" : record.submissionStatus}</span></td>
                <td><Button icon={record.archivedAt ? History : Edit3} onClick={() => void openRecord(record)}>{record.archivedAt ? "Review" : "Manage"}</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollableTableRegion>
    </section>
  );
}

function AuditHistory({ audit }: { audit: RecordAudit[] }) {
  return (
    <section className="panel">
      <div className="panel-heading"><h2>Full audit history</h2><span>{audit.length} events</span></div>
      <div className="audit-history-list">
        {audit.length === 0 ? <p className="muted-copy">No audit events have been recorded.</p> : audit.map((entry) => (
          <details key={entry.id}>
            <summary>
              <span><strong>{formatAuditAction(entry.action)}</strong><small>{entry.summary ?? "No summary"}</small></span>
              <span>{entry.actorName}<small>{formatDate(entry.createdAt)}</small></span>
            </summary>
            <div className="audit-change-grid">
              <div><strong>Before</strong><pre>{formatAuditJson(entry.beforeJson)}</pre></div>
              <div><strong>After</strong><pre>{formatAuditJson(entry.afterJson)}</pre></div>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

function formatAnswer(value?: string) {
  return value ? value.split("|").join(", ") : "No response";
}

function formatAuditAction(action: string) {
  return action
    .split(/[._]/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function formatAuditJson(value?: string) {
  if (!value) {
    return "No record snapshot";
  }

  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
