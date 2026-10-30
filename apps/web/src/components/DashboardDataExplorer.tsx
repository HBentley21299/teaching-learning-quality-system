import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpRight, ChevronDown, ChevronRight, Columns3, RotateCcw, Search, X } from "lucide-react";
import { api, type ExportFilters } from "../services/api";
import type { DashboardRecordData, ElevateStatusStaffSummary, ProcessDashboardRecordSummary } from "../services/types";
import { buildDashboardExplorerRows, dashboardDate, dashboardExplorerColumns, displayDashboardValue, filterDashboardExplorerRows, filterElevateStatusStaff, isDashboardBusinessColumn, normalizeDashboardSearch, recommendedDashboardColumns, type DashboardExplorerColumn, type DashboardExplorerRow, type DashboardFieldFilter } from "../services/dashboardDataPresentation";
import { Button } from "../design-system/Button";
import { Pagination } from "./CollapsibleSection";
import { ScrollableTableRegion } from "./ScrollableTableRegion";
import { LoadingState } from "./LoadingState";
import { compareListValues } from "../services/listQuery";

type DashboardDataExplorerProps = {
  processKey: string;
  academicYear: string;
  filters?: ExportFilters;
  records?: ProcessDashboardRecordSummary[];
  onOpenRecord?: (recordId: string) => void;
  onOpenEntry?: (recordId: string) => void;
  loadData?: () => Promise<DashboardRecordData>;
  refreshKey?: number;
  onOpenStaff?: (staffId: string) => void;
};

const pageSizes = [15, 30, 60];
const emptyRecords: ProcessDashboardRecordSummary[] = [];

export function DashboardDataExplorer({ processKey, academicYear, filters = {}, records = emptyRecords, onOpenRecord, onOpenEntry, onOpenStaff, loadData, refreshKey = 0 }: DashboardDataExplorerProps) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState("date");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [columnQuery, setColumnQuery] = useState("");
  const [fieldFilters, setFieldFilters] = useState<DashboardFieldFilter[]>([]);
  const [chosenColumns, setChosenColumns] = useState(() => ({ processKey, keys: readColumns(processKey) }));
  const [loadState, setLoadState] = useState<{ scope: object | null; data: DashboardRecordData | null; loading: boolean; error: string }>({ scope: null, data: null, loading: true, error: "" });
  const [reload, setReload] = useState(0);
  const requestSequence = useRef(0);
  const filterKey = JSON.stringify(Object.entries(filters).sort(([left], [right]) => left.localeCompare(right)));
  const requestScope = useMemo(() => ({ academicYear, processKey, filterKey, loadData, reload, refreshKey }), [academicYear, processKey, filterKey, loadData, reload, refreshKey]);
  const data = loadState.scope === requestScope ? loadState.data : null;
  const error = loadState.scope === requestScope ? loadState.error : "";
  const loading = loadState.scope !== requestScope || loadState.loading;

  useEffect(() => {
    const sequence = ++requestSequence.current;
    let active = true;
    setLoadState({ scope: requestScope, data: null, error: "", loading: true }); setExpandedId(null); setPage(1);
    void Promise.resolve().then(() => loadData ? loadData() : api.dashboardRecordData(academicYear, processKey, Object.fromEntries(JSON.parse(filterKey)))).then(result => {
      if (active && sequence === requestSequence.current) setLoadState({ scope: requestScope, data: result, error: "", loading: false });
    }).catch(reason => {
      if (active && sequence === requestSequence.current) setLoadState({ scope: requestScope, data: null, error: reason instanceof Error ? reason.message : "The saved form data could not be loaded.", loading: false });
    });
    return () => { active = false; };
  }, [academicYear, processKey, filterKey, reload, loadData, requestScope]);

  useEffect(() => {
    setChosenColumns({ processKey, keys: readColumns(processKey) }); setQuery(""); setColumnQuery(""); setSortKey("date"); setDirection("desc"); setFieldFilters([]);
  }, [processKey]);

  const columns = useMemo(() => dashboardExplorerColumns(processKey, data, records), [processKey, data, records]);
  const allRows = useMemo(() => buildDashboardExplorerRows(records, columns, data, processKey), [records, columns, data, processKey]);
  const rows = useMemo(() => filterDashboardExplorerRows(allRows, query, sortKey, direction, columns, fieldFilters), [allRows, query, sortKey, direction, columns, fieldFilters]);
  const storedKeys = chosenColumns.processKey === processKey ? chosenColumns.keys : recommendedDashboardColumns(processKey);
  const chosenKeys = storedKeys.join("|") === recommendedDashboardColumns(processKey).join("|") ? recommendedDashboardColumns(processKey, data) : storedKeys;
  const visibleColumns = columns.filter(column => chosenKeys.includes(column.key));
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visibleRows = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const columnGroups = groupColumns(columns.filter(column => normalizeDashboardSearch(`${column.label} ${column.section}`).includes(normalizeDashboardSearch(columnQuery))));
  const loadedRecordIds = useMemo(() => new Set(data?.rows.map(row => row.recordId) ?? []), [data]);
  const openEntry = onOpenEntry ?? onOpenRecord;
  const entryLabel = processKey === "actions" ? "actions" : processKey === "uco_tla_review" ? "reviews" : processKey === "qa_review" ? "submissions" : "records";
  const entryCountLabel = allRows.length === 1 ? entryLabel.slice(0, -1) : entryLabel;

  function selectColumns(keys: string[]) {
    const next = keys.includes("title") ? keys : ["title", ...keys];
    setChosenColumns({ processKey, keys: next });
    try { window.sessionStorage.setItem(`dashboard-columns:${processKey}:v1`, JSON.stringify(next)); } catch { /* Column choices work without browser storage. */ }
  }

  function changeSort(key: string) {
    setDirection(sortKey === key && direction === "asc" ? "desc" : "asc"); setSortKey(key); setPage(1);
  }

  function updateFieldFilter(index: number, change: Partial<DashboardFieldFilter>) {
    setFieldFilters(current => current.map((filter, offset) => offset === index ? { ...filter, ...change } : filter)); setPage(1);
  }

  return <section className="dashboard-data-explorer" aria-label="Form data register">
    <div className="dashboard-data-heading"><div><h2>Form data</h2><p>People, {entryLabel} and answers for the selected report filters. Expand a row to see its full details.</p></div>{!loading || allRows.length ? <span className="dashboard-data-count">{`${allRows.length.toLocaleString()} ${entryCountLabel}`}</span> : null}</div>
    <div className="dashboard-explorer-toolbar">
      <label className="search-box dashboard-explorer-search"><Search size={16} aria-hidden="true" /><input aria-label="Search form data and people" placeholder="Find a person, record or saved answer" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} />{query ? <button type="button" aria-label="Clear form data search" onClick={() => { setQuery(""); setPage(1); }}><X size={15} /></button> : null}</label>
      <label className="dashboard-explorer-filter"><span>Sort by</span><select aria-label="Sort form data by" value={sortKey} onChange={event => { setSortKey(event.target.value); setPage(1); }}>{groupColumns(columns).map(([section, fields]) => <optgroup key={section} label={section}>{fields.map(column => <option key={column.key} value={column.key}>{column.label}</option>)}</optgroup>)}</select></label>
      <label className="dashboard-explorer-filter"><span>Order</span><select aria-label="Form data sort order" value={direction} onChange={event => { setDirection(event.target.value as "asc" | "desc"); setPage(1); }}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label>
      <details className="dashboard-column-picker" onKeyDown={event => { if (event.key === "Escape" && event.currentTarget.open) { event.preventDefault(); event.currentTarget.open = false; event.currentTarget.querySelector<HTMLElement>("summary")?.focus(); } }}><summary><Columns3 size={16} aria-hidden="true" />Columns<span>{visibleColumns.length}</span></summary><div className="dashboard-column-picker-body">
        <div className="dashboard-column-picker-heading"><strong>Choose table columns</strong><p>Expand a record to see all its answers, including columns hidden here.</p></div>
        <label className="search-box"><Search size={15} aria-hidden="true" /><input aria-label="Find a form data column" placeholder="Find a column" value={columnQuery} onChange={event => setColumnQuery(event.target.value)} /></label>
        <div className="dashboard-column-actions"><Button variant="quiet" onClick={() => selectColumns(recommendedDashboardColumns(processKey, data))}>Suggested columns</Button><Button variant="quiet" onClick={() => selectColumns(columns.map(column => column.key))}>Show all columns</Button></div>
        <div className="dashboard-column-groups">{columnGroups.map(([section, fields]) => <fieldset key={section}><legend>{section}</legend>{fields.map(column => <label key={column.key}><input type="checkbox" checked={chosenKeys.includes(column.key)} disabled={column.key === "title"} onChange={event => selectColumns(event.target.checked ? [...chosenKeys, column.key] : chosenKeys.filter(key => key !== column.key))} /><span>{column.label}</span></label>)}</fieldset>)}{!columnGroups.length ? <p>No columns match this search.</p> : null}</div>
        {loading ? <p>Saved form columns will appear when the answers finish loading.</p> : null}
      </div></details>
      <label className="dashboard-explorer-page-size"><span>Rows</span><select aria-label="Form data rows per page" value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1); }}>{pageSizes.map(size => <option key={size} value={size}>{size}</option>)}</select></label>
    </div>
    <details className="dashboard-field-filters"><summary>Filter form fields{fieldFilters.length ? ` · ${fieldFilters.length}` : ""}</summary><p>Choose a field and the value to match. You can combine filters, including fields hidden from the table.</p>{fieldFilters.map((filter, index) => {
      const column = columns.find(item => item.key === filter.key), ordered = column?.kind === "number" || column?.kind === "date";
      const values = [...new Set(allRows.map(row => row.values[filter.key]).filter(value => value && value !== "Not recorded"))].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
      return <div className="dashboard-explorer-toolbar" key={index}><label className="dashboard-explorer-filter"><span>Field</span><select aria-label={`Form filter ${index + 1} field`} value={filter.key} onChange={event => updateFieldFilter(index, { key: event.target.value, operator: "contains", value: "" })}>{groupColumns(columns).map(([section, fields]) => <optgroup key={section} label={section}>{fields.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</optgroup>)}</select></label><label className="dashboard-explorer-filter"><span>Match</span><select aria-label={`Form filter ${index + 1} match`} value={filter.operator} onChange={event => updateFieldFilter(index, { operator: event.target.value as DashboardFieldFilter["operator"] })}><option value="contains">Contains</option><option value="equals">Equals</option><option value="not_equals">Does not equal</option><option value="empty">Not recorded</option><option value="not_empty">Recorded</option>{ordered ? <><option value="gte">{column?.kind === "date" ? "On or after" : "At least"}</option><option value="lte">{column?.kind === "date" ? "On or before" : "At most"}</option></> : null}</select></label>{!["empty", "not_empty"].includes(filter.operator) ? <label className="dashboard-explorer-filter"><span>Value</span><input aria-label={`Form filter ${index + 1} value`} type={ordered && ["gte", "lte"].includes(filter.operator) ? column?.kind === "date" ? "date" : "number" : "text"} list={`dashboard-filter-values-${index}`} value={filter.value} onChange={event => updateFieldFilter(index, { value: event.target.value })} /><datalist id={`dashboard-filter-values-${index}`}>{values.map(value => <option key={value} value={value} />)}</datalist></label> : null}<Button variant="quiet" onClick={() => { setFieldFilters(current => current.filter((_, offset) => offset !== index)); setPage(1); }} aria-label={`Remove form filter ${index + 1}`}>Remove</Button></div>;
    })}<div className="toolbar"><Button onClick={() => setFieldFilters(current => [...current, { key: columns.find(column => column.key === "subject")?.key ?? "title", operator: "contains", value: "" }])}>Add field filter</Button>{fieldFilters.length ? <Button variant="quiet" onClick={() => { setFieldFilters([]); setPage(1); }}>Clear field filters</Button> : null}</div></details>
    <p className="dashboard-explorer-scope-note">Table search, field filters and sorting refine this register. Excel includes all business form columns for the dashboard filters above.</p>
    {loading ? <LoadingState label="Loading saved form answers" detail={allRows.length ? "Record names and summary data are available below." : undefined} /> : null}
    {error ? <div className="dashboard-data-warning" role="alert"><p>Saved form answers could not be loaded. The record summary remains available. {error}</p><Button icon={RotateCcw} onClick={() => setReload(value => value + 1)}>Retry form data</Button></div> : null}
    {data?.wasTruncated ? <p className="dashboard-data-warning" role="status">The complete form data is limited for this large result. Narrow the dashboard dates or organisation to inspect all answers.</p> : null}
    {!loading || allRows.length ? <div className="dashboard-explorer-result-summary" role={loading ? undefined : "status"}>{rows.length.toLocaleString()} of {allRows.length.toLocaleString()} {entryCountLabel}{query ? ` ${rows.length === 1 ? "matches" : "match"} “${query}”` : ""} · {rows.length ? `${((currentPage - 1) * pageSize + 1).toLocaleString()}–${Math.min(currentPage * pageSize, rows.length).toLocaleString()} shown` : "none shown"}</div> : null}
    <ScrollableTableRegion className="dashboard-explorer-table" label="Form data register"><table><caption>Form records · select a column heading to sort, or expand a row to inspect its answers</caption><thead><tr><th scope="col"><span className="sr-only">Expand record</span></th>{visibleColumns.map(column => <th scope="col" key={column.key} aria-sort={sortKey === column.key ? direction === "asc" ? "ascending" : "descending" : "none"}><button type="button" onClick={() => changeSort(column.key)}>{column.label}{sortKey === column.key ? direction === "asc" ? <ArrowUp size={13} aria-hidden="true" /> : <ArrowDown size={13} aria-hidden="true" /> : null}</button></th>)}</tr></thead><tbody>
      {visibleRows.map(row => <Fragment key={row.id}><tr className={expandedId === row.id ? "is-expanded" : undefined}><td><button className="dashboard-row-expander" type="button" aria-label={`${expandedId === row.id ? "Hide" : "Show"} form answers for ${row.record.title}`} aria-expanded={expandedId === row.id} aria-controls={`dashboard-form-detail-${row.id}`} onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}>{expandedId === row.id ? <ChevronDown size={17} /> : <ChevronRight size={17} />}</button></td>{visibleColumns.map(column => <td key={column.key} className={column.kind === "number" ? "is-numeric" : undefined}>{renderCell(row, column, openEntry, onOpenStaff)}</td>)}</tr>
        <tr className="dashboard-expanded-row" hidden={expandedId !== row.id}><td colSpan={visibleColumns.length + 1}><div id={`dashboard-form-detail-${row.id}`} className="dashboard-form-detail">{expandedId === row.id ? <><div className="dashboard-form-detail-heading"><div><span>Complete record</span><h3>{row.record.title}</h3></div>{openEntry ? <Button icon={ArrowUpRight} onClick={() => openEntry(row.id)}>Open source record</Button> : null}</div>
          <FormAnswerGroups row={row} columns={columns} hasSavedData={loadedRecordIds.has(row.id)} loading={loading} failed={Boolean(error)} />
          <RelatedBusinessTables data={data} recordId={row.id} />
        </> : null}</div></td></tr>
      </Fragment>)}
      {!visibleRows.length && !loading ? <tr><td colSpan={visibleColumns.length + 1}><div className="dashboard-explorer-empty"><strong>{error && !allRows.length ? "Record data is unavailable" : query || fieldFilters.length ? "No records match these filters" : "No records in this dashboard scope"}</strong><p>{error && !allRows.length ? "Use Retry form data above to load the records again." : query || fieldFilters.length ? "Try another search or remove a field filter. Your report filters stay unchanged." : "Adjust the report dates, faculty, team or status to find records."}</p>{query || fieldFilters.length ? <Button variant="quiet" onClick={() => { setQuery(""); setFieldFilters([]); setPage(1); }}>Clear table filters</Button> : null}</div></td></tr> : null}
    </tbody></table></ScrollableTableRegion>
    <Pagination page={currentPage} totalPages={totalPages} onPageChange={setPage} />
  </section>;
}

function RelatedBusinessTables({ data, recordId }: { data: DashboardRecordData | null; recordId: string }) {
  return <div className="dashboard-related-data">{(data?.relatedTables ?? []).map(table => {
    const rows = table.rows.filter(row => row.recordId === recordId), columns = table.columns.filter(isDashboardBusinessColumn);
    if (!rows.length || !columns.length) return null;
    return <details className="dashboard-related-table" open key={table.key}><summary>{table.label}<span>{rows.length.toLocaleString()}</span></summary><ScrollableTableRegion label={table.label}><table><caption>{table.label} associated with this record</caption><thead><tr>{columns.map(column => <th scope="col" key={column.key}>{column.label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{columns.map(column => <td key={column.key}><span className="dashboard-cell-value">{displayDashboardValue(row.values[column.key])}</span></td>)}</tr>)}</tbody></table></ScrollableTableRegion></details>;
  })}</div>;
}

function FormAnswerGroups({ row, columns, hasSavedData, loading, failed }: { row: DashboardExplorerRow; columns: DashboardExplorerColumn[]; hasSavedData: boolean; loading: boolean; failed: boolean }) {
  const answerColumns = columns.filter(column => column.key.startsWith("answer:"));
  const detailColumns = hasSavedData && answerColumns.length ? columns.filter(column => ["subject", "submitter", "owner", "reviewer", "date", "submitted", "faculty", "team", "status"].includes(column.key)).concat(answerColumns) : columns.filter(column => !column.key.startsWith("answer:") && column.key !== "title");
  return <>{groupColumns(detailColumns).map(([section, fields]) => <section className="dashboard-form-answer-group" key={section}><h4>{section}</h4><dl>{fields.map(column => <div key={column.key}><dt>{column.label}</dt><dd className={row.values[column.key] === "Not recorded" ? "is-empty" : undefined}>{row.values[column.key] ?? "Not recorded"}</dd></div>)}</dl></section>)}
    {loading ? <p>Saved answers will appear here when loading finishes.</p> : !hasSavedData && !failed ? <p className="dashboard-explorer-scope-note">No additional saved form answers were returned for this record. Open the source record to inspect its original workflow.</p> : null}
  </>;
}

function renderCell(row: DashboardExplorerRow, column: DashboardExplorerColumn, onOpenRecord?: (id: string) => void, onOpenStaff?: (id: string) => void) {
  const text = row.values[column.key] ?? "Not recorded";
  if (column.key === "title" && onOpenRecord) return <button className="dashboard-detail-link dashboard-record-link" type="button" onClick={() => onOpenRecord(row.id)}>{text}<ArrowUpRight aria-hidden="true" size={14} /></button>;
  const staffId = column.key === "subject" ? row.record.subjectStaffId : column.key === "submitter" ? row.record.submitterStaffId : column.key === "owner" ? row.record.ownerStaffId : undefined;
  if (staffId && onOpenStaff && text !== "Not recorded") return <button className="dashboard-detail-link" type="button" onClick={() => onOpenStaff(staffId)}>{text}</button>;
  if (column.key === "status") return <span className="status-pill">{text}</span>;
  return <span className={`dashboard-cell-value${text === "Not recorded" ? " is-empty" : ""}`} title={text.length > 120 ? text : undefined}>{text}</span>;
}

type ElevateStatusStaffExplorerProps = {
  rows: ElevateStatusStaffSummary[];
  academicYear?: string;
  onOpenStaff?: (staffId: string) => void;
  levelFilter?: string;
  onLevelFilterChange?: (value: string) => void;
};

export function ElevateStatusStaffExplorer({ rows, academicYear, onOpenStaff, levelFilter, onLevelFilterChange }: ElevateStatusStaffExplorerProps) {
  const [query, setQuery] = useState("");
  const [localLevel, setLocalLevel] = useState("all");
  const [sort, setSort] = useState("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [progressFilter, setProgressFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const level = levelFilter ?? localLevel;
  const filtered = useMemo(() => filterElevateStatusStaff(rows, query, level).filter(row => progressFilter === "all" || (progressFilter === "highest" ? row.nextLevel == null : progressFilter === "threshold" ? row.nextLevel != null && row.sessionsToNextLevel === 0 : row.nextLevel != null && (row.sessionsToNextLevel ?? 0) > 0)).sort((left, right) => {
    const value = (row: ElevateStatusStaffSummary) => sort === "level_desc" || sort === "level_asc" ? row.currentLevel : sort === "attendance" ? row.qualifyingAttendanceCount : sort === "faculty" ? row.parentAreaCode ?? row.areaCode : sort === "team" ? row.areaName ?? row.areaCode : sort === "next" ? row.nextLevel : sort === "remaining" ? row.sessionsToNextLevel : sort === "confirmed" ? row.lastConfirmedAt ? new Date(row.lastConfirmedAt) : null : row.staffName;
    return compareListValues(value(left), value(right), sort === "level_desc" || sort === "attendance" ? "desc" : sort === "level_asc" ? "asc" : sortDirection) || left.staffName.localeCompare(right.staffName) || left.staffId.localeCompare(right.staffId);
  }), [rows, query, level, sort, sortDirection, progressFilter]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize)), currentPage = Math.min(page, totalPages);
  const visibleRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const levelNames = new Map(rows.map(row => [row.currentLevel, row.currentLevelName]));

  useEffect(() => { setPage(1); }, [level, academicYear]);

  return <section className="dashboard-data-explorer dashboard-staff-explorer" aria-label="Elevate Status staff register">
    <div className="dashboard-data-heading"><div><h2>Staff status register</h2><p>Every eligible staff member in the current dashboard scope{academicYear ? ` for ${academicYear}` : ""}, including colleagues with no confirmed award.</p></div><span className="dashboard-data-count">{filtered.length.toLocaleString()} staff</span></div>
    <div className="dashboard-explorer-toolbar"><label className="search-box dashboard-explorer-search"><Search size={16} aria-hidden="true" /><input aria-label="Search Elevate Status staff" placeholder="Find staff, faculty, team or status" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} />{query ? <button type="button" aria-label="Clear staff status search" onClick={() => { setQuery(""); setPage(1); }}><X size={15} /></button> : null}</label>
      {levelFilter === undefined ? <label className="dashboard-explorer-filter"><span>Confirmed level</span><select aria-label="Filter staff by exact Elevate Status level" value={level} onChange={event => { const next = event.target.value; if (onLevelFilterChange) onLevelFilterChange(next); else setLocalLevel(next); setPage(1); }}><option value="all">All levels</option>{[0, 1, 2, 3, 4, 5].map(value => <option key={value} value={String(value)}>{value === 0 ? "Not yet awarded (Level 0)" : `Level ${value}${levelNames.get(value) ? ` · ${levelNames.get(value)}` : ""}`}</option>)}</select></label> : null}
      <label className="dashboard-explorer-filter"><span>Attendance progress</span><select aria-label="Staff attendance progress" value={progressFilter} onChange={event => { setProgressFilter(event.target.value); setPage(1); }}><option value="all">All attendance progress</option><option value="threshold">Next attendance threshold met</option><option value="remaining">More attendance needed</option><option value="highest">Highest level reached</option></select></label>
      <label className="dashboard-explorer-filter"><span>Sort by</span><select aria-label="Sort staff status register" value={sort} onChange={event => { setSort(event.target.value); setPage(1); }}><option value="name">Staff name</option><option value="level_desc">Highest level first</option><option value="level_asc">Lowest level first</option><option value="attendance">Most qualifying attendance</option><option value="faculty">Faculty</option><option value="team">Team / area</option><option value="next">Next level</option><option value="remaining">Sessions still needed</option><option value="confirmed">Last confirmed</option></select></label>
      {!["level_desc", "level_asc", "attendance"].includes(sort) ? <label className="dashboard-explorer-filter"><span>Order</span><select aria-label="Staff status sort order" value={sortDirection} onChange={event => { setSortDirection(event.target.value as "asc" | "desc"); setPage(1); }}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label> : null}
      <label className="dashboard-explorer-page-size"><span>Rows</span><select aria-label="Staff status rows per page" value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1); }}>{pageSizes.map(size => <option key={size} value={size}>{size}</option>)}</select></label>
    </div>
    <p className="dashboard-explorer-scope-note">Search, attendance progress and sorting narrow the staff register. Excel uses the dashboard filters, including the selected level. Attendance progress does not replace the required confirmation and evidence for an award.</p>
    <div className="dashboard-explorer-result-summary" role="status">{filtered.length.toLocaleString()} matching staff · {filtered.length ? `${((currentPage - 1) * pageSize + 1).toLocaleString()}–${Math.min(currentPage * pageSize, filtered.length).toLocaleString()} shown` : "none shown"}</div>
    <ScrollableTableRegion className="dashboard-explorer-table" label="Form data register"><table><caption>Individual confirmed Elevate Status and qualifying CPD attendance</caption><thead><tr><th scope="col">Staff member</th><th scope="col">Faculty</th><th scope="col">Team / area</th><th scope="col">Confirmed status</th><th scope="col">Qualifying attendance</th><th scope="col">Next level</th><th scope="col">Sessions still needed</th><th scope="col">Last confirmed</th></tr></thead><tbody>{visibleRows.map(row => <tr key={`${row.staffId}:${row.orgUnitId ?? row.areaCode ?? "unassigned"}`}><td>{onOpenStaff ? <button className="dashboard-detail-link" type="button" onClick={() => onOpenStaff(row.staffId)}>{row.staffName}<ArrowUpRight size={14} aria-hidden="true" /></button> : row.staffName}</td><td>{row.parentAreaCode ?? row.areaCode ?? "Unassigned"}</td><td>{row.areaName ?? row.areaCode ?? "Unassigned"}</td><td><span className={`dashboard-status-level level-${row.currentLevel}`}>{row.currentLevel > 0 ? `Level ${row.currentLevel} · ` : ""}{row.currentLevelName || (row.currentLevel ? `Level ${row.currentLevel}` : "Not yet awarded")}</span></td><td className="is-numeric">{row.qualifyingAttendanceCount}</td><td>{row.nextLevel == null ? "Highest level reached" : `Level ${row.nextLevel}${row.nextLevelName ? ` · ${row.nextLevelName}` : ""}`}</td><td>{row.nextLevel == null ? "—" : row.sessionsToNextLevel == null ? "Not recorded" : row.sessionsToNextLevel === 0 ? "Attendance threshold met" : row.sessionsToNextLevel}</td><td>{row.lastConfirmedAt ? dashboardDate(row.lastConfirmedAt) : "Not yet confirmed"}</td></tr>)}{!visibleRows.length ? <tr><td colSpan={8}><div className="dashboard-explorer-empty"><strong>No staff match this view</strong><p>Check the selected level, search text and dashboard organisation filters.</p>{query ? <Button variant="quiet" onClick={() => { setQuery(""); setPage(1); }}>Clear search</Button> : null}</div></td></tr> : null}</tbody></table></ScrollableTableRegion>
    <Pagination page={currentPage} totalPages={totalPages} onPageChange={setPage} />
  </section>;
}

function groupColumns(columns: DashboardExplorerColumn[]) {
  const groups = new Map<string, DashboardExplorerColumn[]>();
  for (const column of columns) groups.set(column.section, [...(groups.get(column.section) ?? []), column]);
  return [...groups];
}

function readColumns(processKey: string): string[] {
  try {
    const saved: unknown = JSON.parse(window.sessionStorage.getItem(`dashboard-columns:${processKey}:v1`) ?? "null");
    if (Array.isArray(saved) && saved.every(key => typeof key === "string")) return [...new Set(["title", ...saved])];
  } catch { /* Use process-specific defaults when storage is disabled or outdated. */ }
  return recommendedDashboardColumns(processKey);
}
