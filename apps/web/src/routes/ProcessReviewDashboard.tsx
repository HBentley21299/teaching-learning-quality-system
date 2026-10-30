import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Download, ExternalLink, RefreshCw, X } from "lucide-react";
import { Button } from "../design-system/Button";
import { DataTable } from "../components/DataTable";
import { CollapsibleSection } from "../components/CollapsibleSection";
import { KpiStrip } from "../components/KpiStrip";
import { LoadingState } from "../components/LoadingState";
import { SkillsScanResultBar } from "../components/SkillsScanResultBar";
import { WorkflowFeedback } from "../components/WorkflowFeedback";
import { WorkflowPagination, useWorkflowPagination } from "../components/WorkflowPagination";
import { api } from "../services/api";
import type { OrgUnitSummary, StaffSummary } from "../services/types";
import type { ProcessReviewAction, ProcessReviewConfiguration, ProcessReviewDetail, ProcessReviewKey, ProcessReviewSummary } from "../services/processReviewTypes";
import { processReviewAreas, processReviewSet } from "../services/processReviewTypes";
import { distinctListValues } from "../services/listQuery";
import { emptyProcessReviewReportQuery, processReviewCodeLabel, processReviewEvidenceHref, processReviewFieldLabel,
  activateSkillsPillarResults, activateSkillsScore, formatActivatePillarMean, processReviewResponsibleNames,
  selectProcessReviewActions, selectProcessReviewRows, type ProcessReviewReportQuery } from "../services/processReviewReporting";
import "./ProcessReviewReporting.css";

type Props = {
  processKey: ProcessReviewKey;
  academicYear: string;
  orgUnits: OrgUnitSummary[];
  staff?: StaffSummary[];
  canExport?: boolean;
  onOpenRecord: (recordId: string) => void;
  onOpenAction?: (actionId: string, staffId: string) => void;
};
const date = (value?: string | null) => value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "Not recorded";
const dateTime = (value: string) => new Date(value).toLocaleString("en-GB");
const emptyStaff: StaffSummary[] = [];

/** Records, samples and native actions retain different reporting grains. */
export function ProcessReviewDashboard({ processKey, academicYear, orgUnits, staff = emptyStaff, canExport = false, onOpenRecord, onOpenAction }: Props) {
  const [configuration, setConfiguration] = useState<ProcessReviewConfiguration | null>(null);
  const [records, setRecords] = useState<ProcessReviewSummary[]>([]);
  const [actions, setActions] = useState<ProcessReviewAction[]>([]);
  const [tab, setTab] = useState<"records" | "actions">("records");
  const [query, setQuery] = useState<ProcessReviewReportQuery>({ ...emptyProcessReviewReportQuery });
  const [detail, setDetail] = useState<ProcessReviewDetail | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState("");
  const [directory, setDirectory] = useState<StaffSummary[]>(staff);
  const [directoryMessage, setDirectoryMessage] = useState("");
  const request = useRef(0), detailRequest = useRef(0), exportRequest = useRef(0), directoryRequest = useRef(0);
  const digital = processKey === "digital_learning_walk";

  async function loadDirectory() {
    const token = ++directoryRequest.current; setDirectoryMessage("");
    try {
      const next = await api.staff();
      if (token === directoryRequest.current) setDirectory(next);
    } catch {
      if (token === directoryRequest.current) setDirectoryMessage("Some associated staff names are unavailable. The review data is still shown.");
    }
  }
  useEffect(() => {
    directoryRequest.current += 1; setDirectory(staff); setDirectoryMessage("");
    if (!staff.length) void loadDirectory();
    return () => { directoryRequest.current += 1; };
  }, [processKey, staff]);

  async function load() {
    const token = ++request.current; setLoading(true); setFailed(false); setMessage("");
    try {
      const [nextConfiguration, nextRecords, nextActions] = await Promise.all([
        api.processReviewConfiguration(processKey), api.processReviews(processKey, academicYear), api.processReviewActions(processKey, academicYear)
      ]);
      if (token !== request.current) return;
      setConfiguration(nextConfiguration); setRecords(nextRecords); setActions(nextActions);
    } catch {
      if (token === request.current) { setFailed(true); setMessage("This reporting view could not be loaded. Try again; no figures have been substituted."); }
    } finally { if (token === request.current) setLoading(false); }
  }
  useEffect(() => {
    setConfiguration(null); setRecords([]); setActions([]); setDetail(null); setSelectedId(""); setDetailLoading(false);
    detailRequest.current += 1; exportRequest.current += 1; setExporting(false);
    setQuery({ ...emptyProcessReviewReportQuery }); setTab("records"); void load();
    return () => { request.current += 1; detailRequest.current += 1; exportRequest.current += 1; };
  }, [processKey, academicYear]);

  async function openDetail(recordId: string) {
    const token = ++detailRequest.current; setDetailLoading(true); setSelectedId(recordId); setDetail(null); setMessage("");
    try {
      const next = await api.processReview(recordId);
      if (token === detailRequest.current) setDetail(next);
    } catch {
      if (token === detailRequest.current) setMessage("That review detail could not be opened, or you no longer have access.");
    } finally { if (token === detailRequest.current) setDetailLoading(false); }
  }
  async function exportData() {
    if (!canExport || loading || failed || exporting) return;
    const token = ++exportRequest.current; setExporting(true); setMessage("");
    try {
      const result = await api.exportProcessReviews(processKey, academicYear);
      if (token === exportRequest.current && !result.ok) setMessage(result.message ?? "The workbook could not be created. Try again.");
    } catch { if (token === exportRequest.current) setMessage("The workbook could not be created. Try again."); }
    finally { if (token === exportRequest.current) setExporting(false); }
  }

  const selectedReviews = useMemo(() => selectProcessReviewRows(records, query), [records, query]);
  const selectedReviewIds = new Set(selectedReviews.map(review => review.recordId));
  const openActionsInReviews = new Set(actions.filter(action => (selectedReviewIds.has(action.recordId) || action.associatedReviewIds?.some(id => selectedReviewIds.has(id))) && !["complete", "cancelled"].includes(action.progress)).map(action => action.actionId)).size;
  const facultyRecordIds = query.faculty ? new Set(records.filter(row => row.facultyOrgUnitId === query.faculty).map(row => row.recordId)) : null;
  const selectedActions = useMemo(() => selectProcessReviewActions(actions, query, facultyRecordIds), [actions, query, records]);
  const filterKey = JSON.stringify([processKey, academicYear, tab, query]);
  const recordPage = useWorkflowPagination(selectedReviews, filterKey), actionPage = useWorkflowPagination(selectedActions, filterKey);
  const ownerOptions = tab === "records" ? records.map(row => ({ id: row.ownerStaffId, name: row.ownerName })) : actions.flatMap(row => !digital && row.responsibleStaff?.length ? row.responsibleStaff.map(person => ({ id: person.staffId, name: person.displayName })) : [{ id: row.ownerStaffId, name: row.ownerName }]);
  const owners = [...new Map(ownerOptions.map(owner => [owner.id, owner])).values()].sort((a, b) => a.name.localeCompare(b.name));
  const faculties = [...new Map(records.filter(row => row.facultyOrgUnitId).map(row => [row.facultyOrgUnitId!, { id: row.facultyOrgUnitId!, name: row.facultyName ?? orgUnits.find(unit => unit.id === row.facultyOrgUnitId)?.name ?? "Faculty" }])).values()].sort((a, b) => a.name.localeCompare(b.name));
  const statuses = distinctListValues(tab === "records" ? records.map(row => row.status) : actions.map(row => row.progress));
  const subTeams = [...new Map(records.flatMap(row => row.selectedSubTeams ?? []).map(team => [team.orgUnitId, team])).values()].sort((a, b) => a.name.localeCompare(b.name));
  const participants = [...new Map(records.flatMap(row => row.participants ?? []).map(person => [person.staffId, person])).values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  const impactAreas = [...new Map(actions.filter(action => action.impactAreaKey).map(action => [action.impactAreaKey!, { key: action.impactAreaKey!, label: action.impactAreaLabel || processReviewCodeLabel(action.impactAreaKey!) }])).values()].sort((a, b) => a.label.localeCompare(b.label));
  const title = configuration?.title ?? (digital ? "Digital Learning Walks" : "Activate+ Growth Reviews");
  const update = (changes: Partial<ProcessReviewReportQuery>) => setQuery(current => ({ ...current, ...changes }));
  const dateError = query.fromDate && query.toDate && query.fromDate > query.toDate ? "The to date must be on or after the from date." : "";

  return <div className="route-stack process-review-report">
    <section className="panel">
      <div className="panel-heading"><div><h2>{title}</h2><p className="muted-copy">{academicYear} · Records and actions available within your access.</p></div><div className="toolbar"><Button icon={RefreshCw} disabled={loading} onClick={() => { setDetail(null); setSelectedId(""); setDetailLoading(false); detailRequest.current += 1; void load(); }}>Refresh</Button>{canExport ? <Button icon={Download} busy={exporting} disabled={loading || failed} onClick={() => void exportData()}>Export Excel</Button> : null}</div></div>
      {canExport ? <p className="muted-copy process-review-detail-notice">Excel exports all permitted reviews in {academicYear}, with linked detail sheets. The table search and local filters below do not limit the workbook.</p> : null}
      <div className="toolbar" aria-label="Reporting section"><Button className="process-review-tab-button" aria-pressed={tab === "records"} onClick={() => { setTab("records"); setQuery({ ...emptyProcessReviewReportQuery }); }}>Review register</Button><Button className="process-review-tab-button" aria-pressed={tab === "actions"} onClick={() => { setTab("actions"); setQuery({ ...emptyProcessReviewReportQuery, sort: "date_asc" }); }}>Native actions</Button></div>
      <WorkflowFeedback message={message} tone="error" />
      {directoryMessage ? <div className="toolbar"><p className="muted-copy" role="status">{directoryMessage}</p><Button variant="quiet" onClick={() => void loadDirectory()}>Retry staff names</Button></div> : null}
      {failed ? <Button onClick={() => void load()}>Try loading again</Button> : null}
      {loading ? <LoadingState label="Loading review reporting…" /> : null}
      {!loading && !failed ? <>
        <div className="process-review-report-filters">
          <label className="entry-field"><span>Search</span><input type="search" placeholder={tab === "records" ? "Review, team, area, owner or participant" : "Action, responsible person, theme or impact"} value={query.search} onChange={event => update({ search: event.target.value })} /></label>
          <label className="entry-field"><span>{digital ? "Faculty" : "Faculty / area"}</span><select value={query.faculty} onChange={event => update({ faculty: event.target.value })}><option value="">All {digital ? "faculties" : "faculties / areas"}</option>{faculties.map(faculty => <option key={faculty.id} value={faculty.id}>{faculty.name}</option>)}</select></label>
          <label className="entry-field"><span>{tab === "records" ? "Review owner" : digital ? "Action owner" : "Responsible person"}</span><select value={query.owner} onChange={event => update({ owner: event.target.value })}><option value="">All {tab === "records" || digital ? "owners" : "responsible people"}</option>{owners.map(owner => <option key={owner.id} value={owner.id}>{owner.name}</option>)}</select></label>
          {!digital && tab === "records" ? <><label className="entry-field"><span>Review type</span><select value={query.reviewKind ?? ""} onChange={event => update({ reviewKind: event.target.value })}><option value="">Initial and follow-up reviews</option><option value="initial">Initial reviews</option><option value="follow_up">Follow-up reviews</option></select></label><label className="entry-field"><span>Sub-team</span><select value={query.subTeam ?? ""} onChange={event => update({ subTeam: event.target.value })}><option value="">All sub-teams</option>{subTeams.map(team => <option key={team.orgUnitId} value={team.orgUnitId}>{team.name}</option>)}</select></label><label className="entry-field"><span>Participant</span><select value={query.participant ?? ""} onChange={event => update({ participant: event.target.value })}><option value="">All participants</option>{participants.map(person => <option key={person.staffId} value={person.staffId}>{person.displayName}</option>)}</select></label></> : null}
          {!digital && tab === "actions" ? <label className="entry-field"><span>Skills Scan impact area</span><select value={query.impactArea ?? ""} onChange={event => update({ impactArea: event.target.value })}><option value="">All impact areas</option>{impactAreas.map(area => <option key={area.key} value={area.key}>{area.label}</option>)}</select></label> : null}
          <label className="entry-field"><span>{tab === "records" ? "Stage" : "Progress"}</span><select value={query.status} onChange={event => update({ status: event.target.value })}><option value="">All {tab === "records" ? "stages" : "progress"}</option>{statuses.map(status => <option key={status} value={status}>{processReviewCodeLabel(status)}</option>)}</select></label>
          <label className="entry-field"><span>{tab === "records" ? digital ? "Review date from" : "Conducted from" : digital ? "Due date from" : "Action review date from"}</span><input type="date" value={query.fromDate} onChange={event => update({ fromDate: event.target.value })} aria-invalid={Boolean(dateError)} /></label>
          <label className="entry-field"><span>{tab === "records" ? digital ? "Review date to" : "Conducted to" : digital ? "Due date to" : "Action review date to"}</span><input type="date" value={query.toDate} onChange={event => update({ toDate: event.target.value })} aria-invalid={Boolean(dateError)} /></label>
          <label className="entry-field"><span>Sort by</span><select value={query.sort} onChange={event => update({ sort: event.target.value })}><option value="date_desc">{tab === "records" ? "Review date · newest" : "Due date · latest"}</option><option value="date_asc">{tab === "records" ? "Review date · oldest" : "Due date · soonest"}</option><option value="title">Title A–Z</option><option value="faculty">Faculty A–Z</option><option value="owner">Owner A–Z</option>{tab === "records" ? <><option value="updated">Last updated · newest</option>{!digital ? <option value="follow_up">Latest follow-up · newest</option> : null}</> : null}</select></label>
          <Button variant="quiet" onClick={() => setQuery({ ...emptyProcessReviewReportQuery, sort: tab === "records" ? "date_desc" : "date_asc" })}>Clear filters</Button>
        </div>
        {dateError ? <p role="alert" className="error-copy">{dateError}</p> : null}
        {tab === "records" ? <>
          <KpiStrip items={digital ? [
            { label: "Reviews in view", value: selectedReviews.length, tone: "blue" },
            { label: "Samples in those reviews", value: selectedReviews.reduce((sum, review) => sum + review.sampleCount, 0), tone: "green" },
            { label: "Statements rated", value: `${selectedReviews.reduce((sum, review) => sum + review.ratedStatementCount, 0)} / ${selectedReviews.reduce((sum, review) => sum + review.statementCount, 0)}`, tone: "amber" }
          ] : [
            { label: "Reviews in view", value: selectedReviews.length, tone: "blue" },
            { label: "Submitted reviews", value: selectedReviews.filter(review => review.status === "submitted").length, tone: "green" },
            { label: "Open actions", value: openActionsInReviews, tone: "amber" }
          ]} />
          {digital && !configuration?.ratingOptions.length ? <p className="record-context-note">The college rating scale is not configured. Draft evidence can be collected; no rating distribution or overall score has been invented.</p> : null}
          <p className="muted-copy" role="status">{selectedReviews.length} of {records.length} permitted reviews match these filters.</p>
          <DataTable rows={recordPage.items} rowKey={review => review.recordId} caption={`${title} review register`} columns={[
            { key: "title", header: digital ? "Review / team" : "Growth review", render: review => <><Button variant="quiet" onClick={() => void openDetail(review.recordId)} aria-expanded={selectedId === review.recordId}>{review.title}</Button><small className="muted-copy">{digital ? review.teamName : review.participants?.map(person => person.displayName).join("; ")}</small></> },
            { key: "faculty", header: digital ? "Faculty" : "Faculty / area", render: review => review.facultyName || "Not recorded" },
            ...(!digital ? [{ key: "subteams", header: "Sub-team scope", render: (review: ProcessReviewSummary) => <>{review.skillsScanScores == null && review.allSubTeams == null ? "Earlier workflow" : review.allSubTeams ? "All sub-teams" : "Selected sub-teams"}<small className="muted-copy">{review.selectedSubTeams?.map(team => team.name).join("; ") || (review.skillsScanScores == null ? "" : "Selected area")}</small></> }] : []),
            { key: "owner", header: "Review owner", render: review => review.ownerName },
            { key: "date", header: digital ? "Review date" : "Date conducted", render: review => date(review.recordDate) },
            ...(!digital ? [{ key: "kind", header: "Review type", render: (review: ProcessReviewSummary) => review.isFollowUp ? "Follow-up" : "Initial" },
              { key: "followup", header: "Linked reviews", render: (review: ProcessReviewSummary) => <ReviewLinks review={review} onOpen={onOpenRecord} /> }] : []),
            { key: "status", header: "Stage", render: review => processReviewCodeLabel(review.status) },
            ...(digital ? [{ key: "samples", header: "Samples", render: (review: ProcessReviewSummary) => review.sampleCount }, { key: "ratings", header: "Statements rated", render: (review: ProcessReviewSummary) => `${review.ratedStatementCount} / ${review.statementCount}` }] : [{ key: "scan", header: "Skills Scan results entered", render: (review: ProcessReviewSummary) => review.skillsScanScores == null ? "Earlier workflow" : `${Object.values(review.skillsScanScores).filter(value => activateSkillsScore(value) !== null).length} / 15` }]),
            { key: "actions", header: "Open actions", render: review => review.openActionCount },
            { key: "updated", header: "Last updated", render: review => dateTime(review.updatedAt) }
          ]} emptyMessage={records.length ? "No reviews match these filters." : "No reviews have been saved in this academic year."} />
          <WorkflowPagination {...recordPage} label="Review register" />
        </> : <>
          <KpiStrip items={[
            { label: "Actions in view", value: selectedActions.length, tone: "blue" },
            { label: "Activity completed", value: selectedActions.filter(action => action.progress === "complete").length, tone: "green" },
            { label: "Impact demonstrated", value: selectedActions.filter(action => action.impactStatus === "demonstrated").length, tone: "amber" }
          ]} />
          <p className="muted-copy">Action activity and demonstrated impact are separate. A completed activity may still need impact evidence.</p>
          <DataTable rows={actionPage.items} rowKey={action => action.actionId} caption={`${title} native actions`} columns={[
            { key: "action", header: "Action", render: action => <Button variant="quiet" onClick={() => onOpenAction ? onOpenAction(action.actionId, action.ownerStaffId) : onOpenRecord(action.recordId)}>{action.title}</Button> },
            { key: "faculty", header: "Faculty / team", render: action => <>{action.facultyName || "Not recorded"}{action.teamName ? <small className="muted-copy">{action.teamName}</small> : null}</> },
            { key: "source", header: "Source review", render: action => <Button variant="quiet" onClick={() => void openDetail(action.recordId)}>{action.recordTitle}</Button> },
            { key: "owner", header: digital ? "Action owner" : "Responsible people", render: action => digital ? action.ownerName : processReviewResponsibleNames(action).join("; ") },
            { key: "area", header: digital ? "Standard" : "Specialist area", render: action => action.themeLabel || processReviewCodeLabel(action.themeKey) },
            ...(!digital ? [{ key: "impactArea", header: "Skills Scan impact area", render: (action: ProcessReviewAction) => action.impactAreaLabel || processReviewCodeLabel(action.impactAreaKey ?? undefined) }, { key: "detail", header: "Action detail", render: (action: ProcessReviewAction) => action.detail || action.title }] : []),
            { key: "due", header: digital ? "Due date" : "Review date", render: action => date(digital ? action.dueDate : action.reviewDate || action.dueDate) },
            { key: "progress", header: "Activity progress", render: action => processReviewCodeLabel(action.progress) },
            ...(digital ? [{ key: "support", header: "Support required", render: (action: ProcessReviewAction) => action.supportRequired || "None recorded" }] : []),
            { key: "success", header: digital ? "Success evidence" : "Impact measures", render: action => action.successEvidence },
            { key: "impact", header: "Impact", render: action => <>{processReviewCodeLabel(action.impactStatus)}{action.impactEvidence ? <p>{action.impactEvidence}</p> : null}<EvidenceLink value={action.impactEvidenceLink} label="Impact evidence" /></> }
          ]} emptyMessage={actions.length ? "No actions match these filters." : "No native actions have been saved in this academic year."} />
          <WorkflowPagination {...actionPage} label="Native actions" />
        </>}
      </> : null}
    </section>
    {detailLoading ? <LoadingState label="Loading all review details…" /> : null}
    {detail ? <section className="panel process-review-report-detail"><div className="panel-heading"><div><h2>{detail.title}</h2><p className="muted-copy">{detail.ownerName} · {detail.academicYear} · Saved framework version {detail.configuration.version}</p></div><div className="toolbar"><Button onClick={() => onOpenRecord(detail.recordId)}>Open review</Button><Button icon={X} onClick={() => { detailRequest.current += 1; setDetail(null); setSelectedId(""); setDetailLoading(false); }}>Close detail</Button></div></div><ProcessReviewReportDetail detail={detail} staff={directory} onOpenRecord={onOpenRecord} /></section> : null}
  </div>;
}

function EvidenceLink({ value, label }: { value?: string | null; label: string }) {
  const href = processReviewEvidenceHref(value ?? undefined);
  return href ? <a href={href} target="_blank" rel="noopener noreferrer">{label} <ExternalLink size={13} aria-hidden="true" /></a> : null;
}

function FieldValue({ fieldKey, value, staff, configuration }: { fieldKey: string; value: string; staff: StaffSummary[]; configuration: ProcessReviewConfiguration }): ReactNode {
  if (fieldKey.endsWith("StaffId")) return staff.find(person => person.id === value)?.displayName || "Staff member is not in the available directory";
  if (fieldKey === "attendeeStaffIds") return processReviewSet(value).map(id => staff.find(person => person.id === id)?.displayName || "Staff member is not in the available directory").join("; ") || "Not recorded";
  if (fieldKey === "specialistReady") return processReviewSet(value).map(key => configuration.standards.find(area => area.key === key)?.title || processReviewAreas.find(area => area.key === key)?.label || processReviewCodeLabel(key)).join("; ") || "Not recorded";
  if (fieldKey === "sourceMeeting") return processReviewCodeLabel(value);
  if (/Date$/.test(fieldKey) && /^\d{4}-\d{2}-\d{2}$/.test(value)) return date(value);
  const href = /Url$|Link$/.test(fieldKey) ? processReviewEvidenceHref(value) : null;
  return href ? <EvidenceLink value={href} label={fieldKey === "teamsUrl" ? "Open full review in Teams" : "Open supporting evidence"} /> : value;
}

function ReviewFields({ fields, configuration, staff }: { fields: Record<string, string>; configuration: ProcessReviewConfiguration; staff: StaffSummary[] }) {
  const rows = Object.entries(fields).filter(([, value]) => value?.trim());
  return rows.length ? <dl className="process-review-report-field-list">{rows.map(([key, value]) => <div className="process-review-field-pair" key={key}><dt>{processReviewFieldLabel(configuration, key)}</dt><dd><FieldValue fieldKey={key} value={value} staff={staff} configuration={configuration} /></dd></div>)}</dl> : <p className="muted-copy">No additional tracking answers have been saved.</p>;
}

export function ReviewLinks({ review, onOpen }: { review: Pick<ProcessReviewSummary, "isFollowUp" | "parentReview" | "followUpReviews">; onOpen: (recordId: string) => void }) {
  return <div className="activate-report-review-links">
    {review.parentReview ? <Button variant="quiet" onClick={() => onOpen(review.parentReview!.recordId)}>Previous: {review.parentReview.title}</Button> : review.isFollowUp ? <span className="muted-copy">Previous review unavailable</span> : null}
    {review.followUpReviews?.map(child => <Button key={child.recordId} variant="quiet" onClick={() => onOpen(child.recordId)}>Follow-up: {child.title}<small>{date(child.recordDate)} · {processReviewCodeLabel(child.status)}</small></Button>)}
    {!review.followUpReviews?.length ? <span className="muted-copy">No follow-up review yet</span> : null}
  </div>;
}

function ProcessReviewReportDetail({ detail, staff, onOpenRecord }: { detail: ProcessReviewDetail; staff: StaffSummary[]; onOpenRecord: (recordId: string) => void }) {
  const digital = detail.processKey === "digital_learning_walk";
  return <>
    {digital ? <ReviewFields fields={detail.data.fields} configuration={detail.configuration} staff={staff} /> : <ActivateReviewReport detail={detail} staff={staff} onOpenRecord={onOpenRecord} />}
    {digital ? <>
      <CollapsibleSection storageKey={`process-report-samples-${detail.recordId}`} title="Samples & associated staff" count={detail.data.samples.length} defaultExpanded>
        {detail.data.samples.length ? detail.data.samples.map((sample, index) => <article className="process-review-report-sample" key={sample.id}><h3>{index + 1}. {sample.title}</h3><p className="muted-copy">{sample.sampleType}{sample.sampleDate ? ` · ${date(sample.sampleDate)}` : ""}{sample.course ? ` · ${sample.course}` : ""}</p><p>Associated staff: {sample.staffIds.map(id => staff.find(person => person.id === id)?.displayName || "Staff member is not in the available directory").join("; ") || "None recorded"}</p>{sample.notes ? <p>{sample.notes}</p> : null}<EvidenceLink value={sample.evidenceLink} label="Open sample evidence" /></article>) : <p className="muted-copy">No samples have been saved.</p>}
      </CollapsibleSection>
      <CollapsibleSection storageKey={`process-report-statements-${detail.recordId}`} title="All statement responses" count={detail.configuration.standards.reduce((sum, standard) => sum + standard.statements.length, 0)} defaultExpanded>
        {detail.configuration.standards.map(standard => <section key={standard.key}><h3>{standard.title}</h3>{standard.statements.map(statement => {
          const response = detail.data.responses.find(answer => answer.statementKey === statement.key);
          return <article className="process-review-report-response" key={statement.key}><p>{statement.text}</p><p><strong>Rating:</strong> {detail.configuration.ratingOptions.find(option => option.key === response?.ratingKey)?.label || "Not rated"}</p>{response?.rationale ? <p>{response.rationale}</p> : null}<p className="muted-copy">Linked samples: {response?.sampleIds.map(id => detail.data.samples.find(sample => sample.id === id)?.title || "Sample no longer available").join("; ") || "None recorded"}</p></article>;
        })}</section>)}
      </CollapsibleSection>
    </> : null}
    <CollapsibleSection storageKey={`process-report-actions-${detail.recordId}`} title="Native actions & update history" count={detail.actions.length} defaultExpanded>
      {!digital && detail.actions.some(action => action.recordId !== detail.recordId) ? <p className="muted-copy">Earlier actions remain linked as shared live records. They retain their original responsible people, review dates and update history.</p> : null}
      {detail.actions.length ? detail.actions.map(action => <details key={action.actionId}><summary>{action.title} · {digital ? action.ownerName : processReviewResponsibleNames(action).join("; ")} · {processReviewCodeLabel(action.progress)}</summary><dl className="process-review-report-field-list"><dt>{digital ? "Due date" : "Review date"}</dt><dd>{date(digital ? action.dueDate : action.reviewDate || action.dueDate)}</dd>{!digital ? <><dt>Specialist action theme</dt><dd>{action.themeLabel || processReviewCodeLabel(action.themeKey)}</dd><dt>Skills Scan impact area</dt><dd>{action.impactAreaLabel || processReviewCodeLabel(action.impactAreaKey ?? undefined)}</dd><dt>Action detail</dt><dd>{action.detail || action.title}</dd><dt>Responsible people</dt><dd>{processReviewResponsibleNames(action).join("; ")}</dd>{action.supportRequired ? <><dt>Earlier support required</dt><dd>{action.supportRequired}</dd></> : null}</> : <><dt>Support required</dt><dd>{action.supportRequired || "None recorded"}</dd></>}<dt>{digital ? "Success evidence" : "Impact measures"}</dt><dd>{action.successEvidence}</dd><dt>Impact assessment</dt><dd>{processReviewCodeLabel(action.impactStatus)}</dd><dt>Impact evidence</dt><dd>{action.impactEvidence || "Awaiting evidence"}<EvidenceLink value={action.impactEvidenceLink} label="Open impact evidence" /></dd></dl>{action.updates.length ? action.updates.map(update => <article className="process-review-report-response" key={update.updateId}><h3>{dateTime(update.updatedAt)} · {update.updatedByName}</h3><p>Activity: {processReviewCodeLabel(update.progress)} · Impact: {processReviewCodeLabel(update.impactStatus)}</p>{update.progressNote ? <p>{update.progressNote}</p> : null}{update.barriers ? <p>Barriers: {update.barriers}</p> : null}{update.nextStep ? <p>Next step: {update.nextStep}</p> : null}<p>{digital ? "Due" : "Review date"}: {date(update.dueDate)}{update.deadlineChangeReason ? ` · Change reason: ${update.deadlineChangeReason}` : ""}</p><EvidenceLink value={update.evidenceLink} label="Open progress evidence" />{update.impactEvidence ? <p>{update.impactEvidence}</p> : null}<EvidenceLink value={update.impactEvidenceLink} label="Open impact evidence" /></article>) : <p className="muted-copy">No dated updates have been added.</p>}</details>) : <p className="muted-copy">No actions have been saved.</p>}
    </CollapsibleSection>
  </>;
}

export function ActivateReviewReport({ detail, staff, onOpenRecord }: { detail: ProcessReviewDetail; staff: StaffSummary[]; onOpenRecord: (recordId: string) => void }) {
  const activate = detail.data.activate;
  const legacy = detail.legacyConfiguration ?? detail.configuration;
  const hasLegacy = Object.values(detail.data.fields).some(value => value?.trim()) || detail.snapshots.length > 0 || Boolean(activate?.followUpDate);
  const previous = detail.parentReviewContext;
  return <>
    {activate ? <>
      <section><h3>{detail.isFollowUp ? "Follow-up review" : "Review scope & participants"}</h3><ReviewLinks review={detail} onOpen={onOpenRecord} /><dl className="process-review-report-field-list"><dt>Faculty / area</dt><dd>{detail.facultyName || "Not recorded"}</dd><dt>Sub-team scope</dt><dd>{activate.allSubTeams ? "All sub-teams" : "Selected sub-teams"}{detail.selectedSubTeams?.length ? <p>{detail.selectedSubTeams.map(team => team.name).join("; ")}</p> : null}</dd><dt>{detail.configuration.fieldLabels.recordDate || "Date conducted"}</dt><dd>{date(detail.recordDate)}</dd></dl>
        {detail.participants?.length ? <ul className="activate-report-participants">{detail.participants.map(person => <li key={person.staffId}><strong>{person.displayName}</strong><span>{person.roles.map(processReviewCodeLabel).join(" · ")}{person.isLocked ? " · Required participant" : ""}</span>{person.orgUnitNames.length ? <small>{person.orgUnitNames.join("; ")}</small> : null}</li>)}</ul> : <p className="muted-copy">Participant names have not been recorded.</p>}
      </section>
      {previous ? <CollapsibleSection storageKey={`process-report-previous-${detail.recordId}`} title="Previous review context · read only" defaultExpanded={false}>
        <p className="muted-copy">{previous.review.title} · {date(previous.review.recordDate)} · {processReviewCodeLabel(previous.review.status)}. These are the results and notes carried forward when this follow-up was added.</p>
        <ActivateSkillsScanReport configuration={previous.configuration} scores={previous.skillsScanScores} submitted={previous.review.status === "submitted"} title="Previous Skills Scan results" />
        <dl className="process-review-report-field-list"><dt>Previous meeting minutes</dt><dd>{previous.meetingMinutes || "Not recorded"}</dd><dt>Previous strengths</dt><dd>{previous.strengths || "Not recorded"}</dd><dt>Previous development priorities</dt><dd>{previous.development || "Not recorded"}</dd></dl>
      </CollapsibleSection> : detail.isFollowUp ? <p className="muted-copy">Previous review context is unavailable to your account.</p> : null}
      <ActivateSkillsScanReport configuration={detail.configuration} scores={activate.skillsScanScores} submitted={detail.status === "submitted"} title={detail.isFollowUp ? "New Skills Scan results, if collected" : undefined} />
      {detail.isFollowUp ? <p className="muted-copy">Previous results stay in their original review. New results are shown here only when they were entered for this follow-up.</p> : null}
      <section><h3>Meeting minutes & agreed development</h3><dl className="process-review-report-field-list"><dt>{detail.configuration.fieldLabels.meetingMinutes || "Meeting minutes"}</dt><dd>{activate.meetingMinutes || "Not recorded"}</dd><dt>{detail.configuration.fieldLabels.strengths || "Strengths"}</dt><dd>{activate.strengths || "Not recorded"}</dd><dt>{detail.configuration.fieldLabels.development || "Development priorities"}</dt><dd>{activate.development || "Not recorded"}</dd></dl></section>
    </> : <p className="record-context-note">This record uses the earlier Activate+ workflow. Its original reporting fields remain available below.</p>}
    {hasLegacy ? <CollapsibleSection storageKey={`process-report-legacy-${detail.recordId}`} title="Earlier workflow record · read only" count={detail.snapshots.length} defaultExpanded={false}>
      <p className="muted-copy">The earlier record and its dated source snapshots are retained with their original field labels. They do not supply Skills Scan scores for the current process.</p>
      {activate?.followUpDate ? <p>Earlier planned follow-up date: {date(activate.followUpDate)}</p> : null}
      <ReviewFields fields={detail.data.fields} configuration={legacy} staff={staff} />
      {detail.snapshots.map(snapshot => <details key={snapshot.snapshotId}><summary>Snapshot as of {date(snapshot.asOfDate)} · {processReviewCodeLabel(snapshot.sourceMeeting)} · {snapshot.recordedByName}</summary><p className="muted-copy">Recorded {dateTime(snapshot.recordedAt)}</p><EvidenceLink value={snapshot.teamsLink} label="Open earlier source record" /><ReviewFields fields={snapshot.data.fields} configuration={legacy} staff={staff} /></details>)}
    </CollapsibleSection> : null}
  </>;
}

export function ActivateSkillsScanReport({ configuration, scores, submitted, title = "Skills Scan results" }: { configuration: ProcessReviewConfiguration; scores: Readonly<Record<string, number | null>>; submitted: boolean; title?: string }) {
  const pillars = activateSkillsPillarResults(configuration.skillsScanPillars ?? [], scores, submitted);
  if (!pillars.length) return <p className="muted-copy">This saved framework does not contain a Skills Scan result set.</p>;
  return <section className="activate-skills-report"><h3>{title}</h3><p className="muted-copy">Manually entered sub-area averages use a 1–5 scale. A pillar mean gives each of its sub-area averages equal weight and is shown only when every sub-area has a result. Missing results are not zero.</p>
    {!submitted ? <p className="record-context-note">Draft results are shown for checking. Pillar means are withheld from reporting until the review is submitted.</p> : null}
    <div className="activate-report-pillar-grid">{pillars.map(pillar => <article className="activate-report-pillar" key={pillar.key}><div className="panel-heading"><h4>{pillar.title}</h4><strong>{pillar.mean === null ? submitted ? "Awaiting results" : "Draft" : `${formatActivatePillarMean(pillar.mean)} / 5`}</strong></div>
      {pillar.mean !== null ? <SkillsScanResultBar value={pillar.mean} label={`${pillar.title} mean, ${formatActivatePillarMean(pillar.mean)} out of 5`} /> : <div className="activate-report-pending" aria-label={`${pillar.title}: no reported pillar mean`} />}
      <p className="muted-copy">{pillar.enteredCount} of {pillar.subAreas.length} sub-area results entered</p><dl>{pillar.subAreas.map(area => <div key={area.key}><dt>{area.title}</dt><dd>{area.score === null ? "Not recorded" : String(area.score)}</dd></div>)}</dl>
    </article>)}</div>
  </section>;
}
