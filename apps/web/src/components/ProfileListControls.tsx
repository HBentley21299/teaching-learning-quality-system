import type { ListQuery, PagedResult } from "../services/types";
import { WorkflowFilters } from "./WorkflowFilters";
import { listDateRangeError } from "../services/listQuery";

export type ProfileListSection = "cpd" | "coaching" | "liv" | "probation" | "actions";

const sortFields: Record<ProfileListSection, Array<[string, string]>> = {
  cpd: [["date", "Session date"], ["title", "Session title"], ["type", "CPD type"], ["themes", "Themes"], ["duration", "Duration"]],
  coaching: [["date", "Session date"], ["person", "Coach"], ["type", "Session type"], ["status", "Status"], ["focus", "Focus"], ["cycle", "Cycle"], ["session", "Session number"]],
  liv: [["date", "Record date"], ["title", "Record title"], ["person", "Reviewer"], ["type", "Process"], ["status", "Status"], ["stage", "Current stage"], ["area", "Faculty / team"], ["updated", "Last updated"]],
  probation: [["date", "Created date"], ["title", "Record title"], ["type", "Academic year"], ["status", "Status"], ["observation", "Observation"], ["area", "Faculty / team"], ["updated", "Last updated"]],
  actions: [["date", "Created date"], ["title", "Action title"], ["person", "Owner"], ["type", "Source process"], ["status", "Status"], ["due", "Due date"], ["completed", "Completed date"], ["source", "Source record"]]
};

export function ProfileListControls({ section, query, options, totalCount, onChange }: {
  section: ProfileListSection; query: ListQuery; options?: PagedResult<unknown>["filterOptions"];
  totalCount?: number; onChange: (query: ListQuery) => void;
}) {
  const update = (key: keyof ListQuery, value: string) => onChange({ ...query, [key]: value });
  const activeCount = [query.status, query.type, query.person, query.fromDate, query.toDate].filter(Boolean).length;
  const dateError = listDateRangeError(query);
  const errorId = `profile-${section}-date-error`;
  return <div className="profile-list-controls" aria-label={`${section} list controls`}>
    <WorkflowFilters activeCount={activeCount} hasQuery={Boolean(query.search)} onClear={() => onChange({})} primary={<>
      <label className="record-filter-field record-filter-search"><span>Search records</span><input type="search" value={query.search ?? ""} onChange={event => update("search", event.target.value)} placeholder="Search all record details" /></label>
      <label className="record-filter-field"><span>Sort by</span><select value={query.sortBy ?? "date"} onChange={event => update("sortBy", event.target.value)}>{sortFields[section].map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="record-filter-field"><span>Direction</span><select value={query.sortDirection ?? "desc"} onChange={event => update("sortDirection", event.target.value)}><option value="desc">Descending</option><option value="asc">Ascending</option></select></label>
    </>}>
    {(["status", "type", "person"] as const).map(key => options?.[key]?.length ? <label key={key}><span>{key === "person" ? "Person" : key === "type" ? section === "probation" ? "Academic year" : "Type" : "Status"}</span><select value={query[key] ?? ""} onChange={event => update(key, event.target.value)}><option value="">All</option>{options[key].map(value => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label> : null)}
    <label><span>From date</span><input type="date" aria-invalid={Boolean(dateError)} aria-describedby={dateError ? errorId : undefined} value={query.fromDate ?? ""} max={query.toDate} onChange={event => update("fromDate", event.target.value)} /></label>
    <label><span>To date</span><input type="date" aria-invalid={Boolean(dateError)} aria-describedby={dateError ? errorId : undefined} value={query.toDate ?? ""} min={query.fromDate} onChange={event => update("toDate", event.target.value)} /></label>
    <button type="button" className="button button-quiet" onClick={() => onChange({})}>Reset</button>
    </WorkflowFilters>
    {dateError ? <p className="field-error" role="alert" id={errorId}>{dateError} <button className="quiet-link" type="button" onClick={() => onChange({...query, fromDate: "", toDate: ""})}>Clear dates</button></p> : totalCount !== undefined ? <small role="status">{totalCount} matching records</small> : null}
  </div>;
}
