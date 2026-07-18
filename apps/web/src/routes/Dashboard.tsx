import {
  AlertTriangle,
  BookOpenCheck,
  Building2,
  ClipboardCheck,
  Download,
  GraduationCap,
  MessagesSquare,
  RefreshCw,
  RotateCcw,
  Search
} from "lucide-react";
import type { LucideProps } from "lucide-react";
import { useEffect, useMemo, useState, type ComponentType } from "react";
import { AccessiblePieChart, MonthlyActivityChart, type ChartDatum } from "../components/DashboardCharts";
import { CollapsibleSection } from "../components/CollapsibleSection";
import { DataTable } from "../components/DataTable";
import { ActionDetailLink, FullRecordLink } from "../components/FullRecordLink";
import { KpiStrip } from "../components/KpiStrip";
import { Button } from "../design-system/Button";
import { api } from "../services/api";
import type { ActionSummary, ActivityOverTimePoint, CurrentUser, OrgUnitSummary, ProcessDashboardRecordSummary } from "../services/types";

type ProcessKey = ProcessDashboardRecordSummary["processKey"];
type SortKey = "date_desc" | "date_asc" | "title" | "area" | "status";

type DashboardProps = {
  actions: ActionSummary[];
  orgUnits: OrgUnitSummary[];
  processRecords: ProcessDashboardRecordSummary[];
  user: CurrentUser;
  onRefresh: () => Promise<void>;
};

type ProcessDefinition = {
  key: ProcessKey;
  label: string;
  singular: string;
  icon: ComponentType<LucideProps>;
  tone: "teal" | "blue" | "green" | "amber";
};

type CpdAreaMetric = {
  parentCode: string;
  areaCode: string;
  participants: number;
  credits: number;
};

const processDefinitions: ProcessDefinition[] = [
  { key: "learning_walk", label: "Learning Walks", singular: "Learning Walk", icon: BookOpenCheck, tone: "teal" },
  { key: "work_scrutiny", label: "Work Scrutiny", singular: "Work Scrutiny", icon: ClipboardCheck, tone: "blue" },
  { key: "cpd_event", label: "CPD", singular: "CPD event", icon: GraduationCap, tone: "green" },
  { key: "elevate_environment", label: "Elevate Environments", singular: "environment check", icon: Building2, tone: "amber" },
  { key: "coaching_session", label: "Coaching & Mentoring", singular: "session", icon: MessagesSquare, tone: "teal" }
];

export function Dashboard({ actions, orgUnits, processRecords, user, onRefresh }: DashboardProps) {
  const [selectedProcess, setSelectedProcess] = useState<ProcessKey>("learning_walk");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [areaFilter, setAreaFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [themeFilter, setThemeFilter] = useState("all");
  const [focusFilter, setFocusFilter] = useState("all");
  const [practiceFilter, setPracticeFilter] = useState("all");
  const [recordTypeFilter, setRecordTypeFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date_desc");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activityPoints, setActivityPoints] = useState<ActivityOverTimePoint[]>([]);

  const canViewReports = user.permissions.includes("reports.view_all") || user.permissions.includes("reports.view_scoped");
  const canViewAll = user.permissions.includes("reports.view_all");

  const areaOptions = useMemo(
    () => selectedProcess === "elevate_environment"
      ? collectAreaOptions(processRecords.filter((record) => record.processKey === "elevate_environment"))
      : collectDashboardAreaOptions(orgUnits, processRecords, user),
    [orgUnits, processRecords, selectedProcess, user]
  );

  const globallyFilteredRecords = useMemo(
    () =>
      processRecords.filter((record) => {
        const recordDate = getRecordDate(record);
        if (startDate && recordDate < startDate) {
          return false;
        }
        if (endDate && recordDate > endDate) {
          return false;
        }
        return recordMatchesArea(record, areaFilter);
      }),
    [areaFilter, endDate, processRecords, startDate]
  );

  const processRecordsInScope = useMemo(
    () => globallyFilteredRecords.filter((record) => record.processKey === selectedProcess),
    [globallyFilteredRecords, selectedProcess]
  );

  const statusOptions = useMemo(
    () => uniqueValues(processRecordsInScope.map((record) => record.status)),
    [processRecordsInScope]
  );
  const themeOptions = useMemo(
    () => uniqueValues(processRecordsInScope.flatMap((record) => splitValues(record.theme))),
    [processRecordsInScope]
  );
  const focusOptions = useMemo(
    () => uniqueValues(processRecordsInScope.flatMap((record) => splitValues(getRecordFocus(record)))),
    [processRecordsInScope]
  );
  const practiceOptions = useMemo(
    () => uniqueValues(processRecordsInScope.map((record) => record.practiceObserved ?? "")),
    [processRecordsInScope]
  );
  const recordTypeOptions = useMemo(
    () => uniqueValues(processRecordsInScope.map((record) => record.recordType)),
    [processRecordsInScope]
  );

  const analysisRecords = useMemo(
    () =>
      processRecordsInScope.filter((record) => {
        const matchesStatus = statusFilter === "all" || record.status === statusFilter;
        const matchesTheme = themeFilter === "all" || splitValues(record.theme).includes(themeFilter);
        const matchesFocus = focusFilter === "all" || splitValues(getRecordFocus(record)).includes(focusFilter);
        const matchesPractice = practiceFilter === "all" || record.practiceObserved === practiceFilter;
        const matchesRecordType = recordTypeFilter === "all" || record.recordType === recordTypeFilter;
        return matchesStatus && matchesTheme && matchesFocus && matchesPractice && matchesRecordType;
      }),
    [focusFilter, practiceFilter, processRecordsInScope, recordTypeFilter, statusFilter, themeFilter]
  );

  useEffect(() => {
    let cancelled = false;
    setActivityPoints([]);
    api.activityOverTime({
      processKey: selectedProcess,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      areaCode: areaFilter === "all" ? undefined : areaFilter,
      status: statusFilter === "all" ? undefined : statusFilter,
      theme: themeFilter === "all" ? undefined : themeFilter,
      focus: focusFilter === "all" ? undefined : focusFilter,
      recordType: recordTypeFilter === "all" ? undefined : recordTypeFilter,
      practiceObserved: practiceFilter === "all" ? undefined : practiceFilter
    }).then((points) => {
      if (!cancelled) setActivityPoints(points);
    }).catch(() => {
      if (!cancelled) setActivityPoints([]);
    });
    return () => { cancelled = true; };
  }, [areaFilter, endDate, focusFilter, practiceFilter, recordTypeFilter, selectedProcess, startDate, statusFilter, themeFilter]);

  const visibleRecords = useMemo(() => {
    const query = searchTerm.trim().toLocaleLowerCase();
    const filtered = analysisRecords.filter((record) => {
      if (!query) {
        return true;
      }

      return [
        record.title,
        record.areaCode,
        record.parentAreaCode,
        record.ownerDisplayName,
        record.subjectDisplayName,
        record.theme,
        record.detail,
        record.focus,
        record.status
      ].some((value) => value?.toLocaleLowerCase().includes(query));
    });

    return [...filtered].sort((left, right) => compareRecords(left, right, sortKey));
  }, [analysisRecords, searchTerm, sortKey]);

  const selectedDefinition = processDefinitions.find((definition) => definition.key === selectedProcess)!;
  const selectedRecordIds = useMemo(() => new Set(analysisRecords.map((record) => record.id)), [analysisRecords]);
  const linkedActions = useMemo(
    () => actions.filter((action) => action.sourceRecordId && selectedRecordIds.has(action.sourceRecordId)),
    [actions, selectedRecordIds]
  );
  const openActions = linkedActions.filter((action) => !action.completedDate);
  const overdueActions = openActions.filter((action) => action.isOverdue);
  const attentionActions = [...openActions]
    .filter((action) => action.isOverdue || isDueSoon(action.dueDate))
    .sort((left, right) => (left.dueDate ?? "9999-12-31").localeCompare(right.dueDate ?? "9999-12-31"))
    .slice(0, 6);
  const actionStatusData = [
    { label: "Open", value: openActions.length },
    { label: "Complete", value: linkedActions.filter((action) => Boolean(action.completedDate)).length },
    { label: "Overdue", value: overdueActions.length }
  ];

  const trendData = useMemo<ChartDatum[]>(
    () => activityPoints.length
      ? activityPoints.map((point) => ({ label: formatMonth(point.month), value: point.recordCount, detail: point.recordType }))
      : buildMonthlyTrend(analysisRecords, startDate, endDate),
    [activityPoints, analysisRecords, endDate, startDate]
  );
  const areaData = useMemo(
    () => buildAreaBreakdown(analysisRecords, selectedProcess, areaFilter),
    [analysisRecords, areaFilter, selectedProcess]
  );
  const themeData = useMemo(
    () => buildThemeBreakdown(analysisRecords, selectedProcess),
    [analysisRecords, selectedProcess]
  );
  const focusData = useMemo(() => buildFocusBreakdown(analysisRecords), [analysisRecords]);
  const kpis = buildKpis(selectedProcess, analysisRecords, linkedActions, areaFilter);

  async function refresh() {
    setIsRefreshing(true);
    await onRefresh();
    setIsRefreshing(false);
  }

  function selectProcess(processKey: ProcessKey) {
    setSelectedProcess(processKey);
    setStatusFilter("all");
    setThemeFilter("all");
    setFocusFilter("all");
    setPracticeFilter("all");
    setRecordTypeFilter("all");
    setSearchTerm("");
    setSortKey("date_desc");
  }

  function clearFilters() {
    setStartDate("");
    setEndDate("");
    setAreaFilter("all");
    setStatusFilter("all");
    setThemeFilter("all");
    setFocusFilter("all");
    setPracticeFilter("all");
    setRecordTypeFilter("all");
    setSearchTerm("");
    setSortKey("date_desc");
  }

  if (!canViewReports) {
    return (
      <div className="route-stack">
        <div className="route-header">
          <div>
            <p className="eyebrow">Teaching &amp; Learning Quality</p>
            <h1>Dashboard</h1>
          </div>
        </div>
        <section className="panel dashboard-access-panel">
          <AlertTriangle size={20} aria-hidden="true" />
          <div>
            <h2>Reporting access is not assigned</h2>
            <p>Your actions and staff profile remain available from the main navigation.</p>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="route-stack dashboard-route">
      <div className="route-header">
        <div>
          <p className="eyebrow">Teaching &amp; Learning Quality</p>
          <h1>{canViewAll ? "Whole organisation dashboard" : "Quality dashboard"}</h1>
          <span className="dashboard-scope-label">
            {canViewAll ? "Whole organisation" : formatScopeLabel(user)}
          </span>
        </div>
        <Button disabled={isRefreshing} icon={RefreshCw} onClick={() => void refresh()}>
          Refresh
        </Button>
      </div>

      <section className="process-tile-grid" aria-label="Quality process dashboards">
        {processDefinitions.map((definition) => {
          const Icon = definition.icon;
          const records = globallyFilteredRecords.filter((record) => record.processKey === definition.key);
          const supportingMetric = getTileSupportingMetric(definition.key, records, areaFilter);
          return (
            <button
              aria-pressed={selectedProcess === definition.key}
              className={`process-tile process-tile-${definition.tone} ${selectedProcess === definition.key ? "process-tile-active" : ""}`}
              key={definition.key}
              onClick={() => selectProcess(definition.key)}
              type="button"
            >
              <span className="process-tile-icon"><Icon size={21} aria-hidden="true" /></span>
              <span className="process-tile-copy">
                <strong>{definition.label}</strong>
                <small>{supportingMetric}</small>
              </span>
              <span className="process-tile-value">{records.length}</span>
            </button>
          );
        })}
      </section>

      <section className="panel dashboard-filter-panel">
        <div className={`dashboard-filter-grid${selectedProcess === "work_scrutiny" ? " dashboard-filter-grid-work-scrutiny" : ""}`}>
          <label className="record-filter-field">
            <span>From</span>
            <input onChange={(event) => setStartDate(event.target.value)} type="date" value={startDate} />
          </label>
          <label className="record-filter-field">
            <span>To</span>
            <input onChange={(event) => setEndDate(event.target.value)} type="date" value={endDate} />
          </label>
          <label className="record-filter-field">
            <span>{selectedProcess === "elevate_environment" ? "Building / room" : "Organisation area"}</span>
            <select onChange={(event) => setAreaFilter(event.target.value)} value={areaFilter}>
              <option value="all">All permitted areas</option>
              {areaOptions.map((area) => <option key={area.code} value={area.code}>{area.label}</option>)}
            </select>
          </label>
          <label className="record-filter-field">
            <span>Status</span>
            <select onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}>
              <option value="all">All statuses</option>
              {statusOptions.map((status) => <option key={status} value={status}>{formatLabel(status)}</option>)}
            </select>
          </label>
          {selectedProcess !== "work_scrutiny" ? (
            <label className="record-filter-field">
              <span>{selectedProcess === "elevate_environment" ? "Overall standard" : selectedProcess === "coaching_session" ? "Focus" : "Theme"}</span>
              <select onChange={(event) => setThemeFilter(event.target.value)} value={themeFilter}>
                <option value="all">All {selectedProcess === "elevate_environment" ? "standards" : selectedProcess === "coaching_session" ? "focus areas" : "themes"}</option>
                {themeOptions.map((theme) => <option key={theme} value={theme}>{formatDashboardTheme(theme, selectedProcess)}</option>)}
              </select>
            </label>
          ) : null}
          {selectedProcess === "learning_walk" ? (
            <label className="record-filter-field">
              <span>Focus</span>
              <select onChange={(event) => setFocusFilter(event.target.value)} value={focusFilter}>
                <option value="all">All focus areas</option>
                {focusOptions.map((focus) => <option key={focus} value={focus}>{focus}</option>)}
              </select>
            </label>
          ) : null}
          {selectedProcess === "learning_walk" ? (
            <label className="record-filter-field">
              <span>Practice observed</span>
              <select onChange={(event) => setPracticeFilter(event.target.value)} value={practiceFilter}>
                <option value="all">All judgements</option>
                {practiceOptions.map((practice) => <option key={practice} value={practice}>{practice}</option>)}
              </select>
            </label>
          ) : null}
          {selectedProcess === "cpd_event" && recordTypeOptions.length > 1 ? (
            <label className="record-filter-field">
              <span>Record type</span>
              <select onChange={(event) => setRecordTypeFilter(event.target.value)} value={recordTypeFilter}>
                <option value="all">All CPD records</option>
                {recordTypeOptions.map((recordType) => (
                  <option key={recordType} value={recordType}>{formatRecordTypeLabel(recordType)}</option>
                ))}
              </select>
            </label>
          ) : null}
          <Button icon={RotateCcw} onClick={clearFilters} variant="secondary">Reset</Button>
        </div>
      </section>

      <div className="dashboard-section-heading">
        <div>
          <h2>{selectedDefinition.label}</h2>
          <span>{analysisRecords.length} {analysisRecords.length === 1 ? selectedDefinition.singular.toLocaleLowerCase() : "records"} in the current view</span>
        </div>
      </div>

      <KpiStrip items={kpis} />

      <div className="dashboard-visual-grid">
        <MonthlyActivityChart
          title="Activity over time"
          subtitle="Records aggregated by calendar month"
          data={trendData}
          recordType={selectedDefinition.label}
        />
        <AccessiblePieChart
          title="Organisation breakdown"
          subtitle={selectedProcess === "cpd_event" ? "Participants by area" : selectedProcess === "elevate_environment" ? "Checks by building" : "Records by area"}
          data={areaData}
        />
        {selectedProcess === "work_scrutiny" ? (
          <DashboardBars title="Action status" subtitle="Actions linked to scrutinies" data={actionStatusData} />
        ) : (
          <>
            <AccessiblePieChart
              title={selectedProcess === "elevate_environment" ? "Overall standards" : selectedProcess === "coaching_session" ? "Session focus" : "Themes"}
              subtitle="Frequency in the current view"
              data={themeData}
            />
            {selectedProcess === "learning_walk" ? (
              <AccessiblePieChart
                title="Focus"
                subtitle="Additional focus in the current view"
                data={focusData}
              />
            ) : null}
          </>
        )}
        <section className="panel dashboard-attention-panel">
          <div className="panel-heading">
            <h2>Upcoming Actions</h2>
            <span>{attentionActions.length} due or overdue</span>
          </div>
          {attentionActions.length === 0 ? (
            <div className="empty-row">No linked upcoming actions are due soon or overdue.</div>
          ) : (
            <div className="dashboard-attention-list">
              {attentionActions.map((action) => (
                <div className="dashboard-attention-row" key={action.id}>
                  <span className={action.isOverdue ? "attention-state attention-state-overdue" : "attention-state"}>
                    {action.isOverdue ? "Overdue" : "Due soon"}
                  </span>
                  <div>
                    <strong>{action.title}</strong>
                    <ActionDetailLink actionId={action.id} />
                    <span>{action.ownerStaffName ?? "Unassigned"} · {formatDate(action.dueDate)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <CollapsibleSection
        className="dashboard-record-panel"
        count={visibleRecords.length}
        defaultOpen={false}
        title={`${selectedDefinition.label} records`}
      >
        <div className="dashboard-record-heading">
          <div className="dashboard-record-tools">
            <label className="search-box dashboard-record-search">
              <Search size={16} aria-hidden="true" />
              <input
                aria-label={`Search ${selectedDefinition.label}`}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search records"
                value={searchTerm}
              />
            </label>
            <label className="record-sort-field">
              <span>Sort by</span>
              <select onChange={(event) => setSortKey(event.target.value as SortKey)} value={sortKey}>
                <option value="date_desc">Newest first</option>
                <option value="date_asc">Oldest first</option>
                <option value="title">Title</option>
                <option value="area">Area</option>
                <option value="status">Status</option>
              </select>
            </label>
            <Button
              disabled={visibleRecords.length === 0}
              icon={Download}
              onClick={() => exportProcessRecords(visibleRecords, selectedDefinition.label)}
              variant="secondary"
            >
              Export filtered CSV
            </Button>
          </div>
        </div>
        {visibleRecords.length === 0 ? (
          <div className="empty-row">No {selectedDefinition.label.toLocaleLowerCase()} match the current filters.</div>
        ) : (
          <DataTable
            rows={visibleRecords}
            rowKey={(record) => record.id}
            columns={[
              { key: "title", header: "Record", render: (record) => <strong>{record.title}</strong> },
              { key: "date", header: "Date", render: (record) => formatDate(getRecordDate(record)) },
              { key: "area", header: "Area", render: (record) => formatArea(record) },
              {
                key: "focus",
                header: selectedProcess === "work_scrutiny" ? "Courses sampled" : selectedProcess === "elevate_environment" ? "Standard / purpose" : selectedProcess === "coaching_session" ? "Focus / session" : "Theme / detail",
                render: (record) => formatRecordFocus(record)
              },
              {
                key: "measure",
                header: getMeasureHeader(selectedProcess),
                render: (record) => selectedProcess === "work_scrutiny"
                  ? actions.filter((action) => action.sourceRecordId === record.id).length
                  : getRecordMeasure(record, selectedProcess, areaFilter)
              },
              { key: "status", header: "Status", render: (record) => <span className="status-pill">{formatLabel(record.status)}</span> },
              {
                key: "actions",
                header: "Open actions",
                render: (record) => actions.filter((action) => action.sourceRecordId === record.id && !action.completedDate).length
              },
              {
                key: "open",
                header: "",
                render: (record) => <FullRecordLink label="Open record" recordId={record.id} recordType={record.recordType} />
              }
            ]}
          />
        )}
      </CollapsibleSection>
    </div>
  );
}

function DashboardBars({ title, subtitle, data }: { title: string; subtitle: string; data: Array<{ label: string; value: number }> }) {
  const maximum = Math.max(...data.map((item) => item.value), 1);
  return (
    <section className="panel dashboard-chart-panel">
      <div className="panel-heading">
        <h2>{title}</h2>
        <span>{subtitle}</span>
      </div>
      {data.length === 0 ? (
        <div className="empty-row">No data in the current view.</div>
      ) : (
        <div className="dashboard-bar-list">
          {data.slice(0, 8).map((item) => (
            <div className="dashboard-bar-row" key={item.label}>
              <span title={item.label}>{item.label}</span>
              <div className="dashboard-bar-track" aria-label={`${item.label}: ${item.value}`}>
                <div className="dashboard-bar-fill" style={{ width: `${Math.max((item.value / maximum) * 100, 3)}%` }} />
              </div>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function buildKpis(
  processKey: ProcessKey,
  records: ProcessDashboardRecordSummary[],
  actions: ActionSummary[],
  areaFilter: string
) {
  const openActions = actions.filter((action) => !action.completedDate);
  const overdueActions = openActions.filter((action) => action.isOverdue);
  const areaCount = countRecordAreas(records);

  if (processKey === "elevate_environment") {
    const scoredRecords = records.filter((record) => record.scoreCount > 0);
    const scoreCount = scoredRecords.reduce((total, record) => total + record.scoreCount, 0);
    const averageScore = scoreCount
      ? scoredRecords.reduce((total, record) => total + record.scoreTotal, 0) / scoreCount
      : 0;
    return [
      { label: "Completed audits", value: records.length, tone: "blue" as const },
      { label: "Rooms audited", value: new Set(records.map((record) => record.areaCode).filter(Boolean)).size, tone: "green" as const },
      { label: "Buildings covered", value: new Set(records.map((record) => record.parentAreaCode).filter(Boolean)).size, tone: "blue" as const },
      { label: "Average score", value: averageScore.toFixed(1), tone: averageScore >= 3 ? "green" as const : "amber" as const },
      { label: "Below Secure", value: records.reduce((total, record) => total + record.belowSecureCount, 0), tone: records.some((record) => record.belowSecureCount > 0) ? "red" as const : "green" as const }
    ];
  }

  if (processKey === "cpd_event") {
    const cpdTotals = records.reduce(
      (totals, record) => {
        const metrics = getCpdMetrics(record, areaFilter);
        totals.participants += metrics.participants;
        totals.credits += metrics.credits;
        return totals;
      },
      { participants: 0, credits: 0 }
    );
    return [
      { label: "CPD events", value: records.length, tone: "blue" as const },
      { label: "Participants", value: cpdTotals.participants, tone: "green" as const },
      { label: "Attendance credits", value: cpdTotals.credits, tone: "blue" as const },
      { label: "Open actions", value: openActions.length, tone: "amber" as const },
      { label: "Overdue actions", value: overdueActions.length, tone: overdueActions.length ? "red" as const : "green" as const }
    ];
  }

  if (processKey === "work_scrutiny") {
    return [
      { label: "Completed scrutinies", value: records.filter((record) => record.status === "submitted").length, tone: "blue" as const },
      { label: "Linked actions", value: actions.length, tone: "blue" as const },
      { label: "Open actions", value: openActions.length, tone: "amber" as const },
      { label: "Completed actions", value: actions.filter((action) => Boolean(action.completedDate)).length, tone: "green" as const },
      { label: "Overdue actions", value: overdueActions.length, tone: overdueActions.length ? "red" as const : "green" as const }
    ];
  }

  if (processKey === "coaching_session") {
    return [
      { label: "Completed sessions", value: records.filter((record) => record.status === "completed").length, tone: "blue" as const },
      { label: "Staff supported", value: new Set(records.map((record) => record.subjectDisplayName).filter(Boolean)).size, tone: "green" as const },
      { label: "Agreed actions", value: actions.length, tone: "blue" as const },
      { label: "Open actions", value: openActions.length, tone: "amber" as const },
      { label: "Overdue actions", value: overdueActions.length, tone: overdueActions.length ? "red" as const : "green" as const }
    ];
  }

  return [
    { label: "Learning walks", value: records.length, tone: "blue" as const },
    { label: "Areas covered", value: areaCount, tone: "blue" as const },
    { label: "Themes covered", value: new Set(records.flatMap((record) => splitValues(record.theme))).size, tone: "green" as const },
    { label: "Open actions", value: openActions.length, tone: "amber" as const },
    { label: "Overdue actions", value: overdueActions.length, tone: overdueActions.length ? "red" as const : "green" as const }
  ];
}

function getTileSupportingMetric(processKey: ProcessKey, records: ProcessDashboardRecordSummary[], areaFilter: string) {
  if (processKey === "elevate_environment") {
    const scoreCount = records.reduce((total, record) => total + record.scoreCount, 0);
    const average = scoreCount ? records.reduce((total, record) => total + record.scoreTotal, 0) / scoreCount : 0;
    return scoreCount ? `${average.toFixed(1)} average score` : "No scored checks";
  }
  if (processKey === "cpd_event") {
    const participants = records.reduce((total, record) => total + getCpdMetrics(record, areaFilter).participants, 0);
    return `${participants} participant${participants === 1 ? "" : "s"}`;
  }
  if (processKey === "work_scrutiny") {
    const completed = records.filter((record) => record.status === "submitted").length;
    return `${completed} completed`;
  }
  if (processKey === "coaching_session") {
    const completed = records.filter((record) => record.status === "completed").length;
    return `${completed} completed`;
  }
  const areas = countRecordAreas(records);
  return `${areas} area${areas === 1 ? "" : "s"} covered`;
}

function countRecordAreas(records: ProcessDashboardRecordSummary[]) {
  const areaCodes = records.flatMap((record) =>
    record.processKey === "cpd_event"
      ? parseCpdAreaMetrics(record.participantAreaBreakdown).map((metric) => metric.areaCode)
      : record.areaCode ? [record.areaCode] : []
  );
  return new Set(areaCodes.filter((code) => code !== "Multiple" && code !== "Unassigned")).size;
}

function collectAreaOptions(records: ProcessDashboardRecordSummary[]) {
  const areas = new Map<string, string>();
  for (const record of records) {
    if (record.parentAreaCode) {
      areas.set(record.parentAreaCode, record.parentAreaCode);
    }
    if (record.areaCode && record.areaCode !== "Multiple") {
      areas.set(record.areaCode, record.areaName ? `${record.areaCode} · ${record.areaName}` : record.areaCode);
    }
    for (const metric of parseCpdAreaMetrics(record.participantAreaBreakdown)) {
      if (metric.parentCode) {
        areas.set(metric.parentCode, metric.parentCode);
      }
      areas.set(metric.areaCode, metric.areaCode);
    }
  }
  return [...areas.entries()]
    .map(([code, label]) => ({ code, label }))
    .sort((left, right) => left.code.localeCompare(right.code));
}

function collectDashboardAreaOptions(
  orgUnits: OrgUnitSummary[],
  records: ProcessDashboardRecordSummary[],
  user: CurrentUser
) {
  const activeUnits = orgUnits.filter(
    (orgUnit) => orgUnit.isActive && ["faculty", "team", "faculty_child_code", "faculty_child"].includes(orgUnit.orgUnitType)
  );
  if (activeUnits.length === 0) {
    return collectAreaOptions(records);
  }

  const canViewAll = user.permissions.includes("reports.view_all");
  const assignedIds = new Set(
    user.scopes
      .filter((scope) => scope.scopeType === "assigned_org_units" && scope.orgUnitId)
      .map((scope) => scope.orgUnitId!)
  );
  const permittedIds = new Set<string>(assignedIds);

  if (canViewAll) {
    for (const orgUnit of activeUnits) {
      permittedIds.add(orgUnit.id);
    }
  } else {
    let addedChild = true;
    while (addedChild) {
      addedChild = false;
      for (const orgUnit of activeUnits) {
        if (orgUnit.parentOrgUnitId && permittedIds.has(orgUnit.parentOrgUnitId) && !permittedIds.has(orgUnit.id)) {
          permittedIds.add(orgUnit.id);
          addedChild = true;
        }
      }
    }
  }

  const permittedUnits = activeUnits.filter((orgUnit) => permittedIds.has(orgUnit.id));
  if (permittedUnits.length === 0) {
    return collectAreaOptions(records);
  }

  const areas = new Map<string, string>();
  for (const orgUnit of permittedUnits.sort(compareOrgUnits)) {
    const parent = activeUnits.find((candidate) => candidate.id === orgUnit.parentOrgUnitId);
    const label = parent
      ? `${parent.code} / ${orgUnit.code} · ${orgUnit.name}`
      : `${orgUnit.code} · ${orgUnit.name}`;
    areas.set(orgUnit.code, label);
  }

  return [...areas.entries()].map(([code, label]) => ({ code, label }));
}

function compareOrgUnits(left: OrgUnitSummary, right: OrgUnitSummary) {
  const leftLevel = left.orgUnitType === "faculty" ? 0 : 1;
  const rightLevel = right.orgUnitType === "faculty" ? 0 : 1;
  return leftLevel - rightLevel || left.code.localeCompare(right.code) || left.name.localeCompare(right.name);
}

function recordMatchesArea(record: ProcessDashboardRecordSummary, areaFilter: string) {
  if (areaFilter === "all") {
    return true;
  }
  if (record.processKey === "cpd_event") {
    return parseCpdAreaMetrics(record.participantAreaBreakdown)
      .some((metric) => metric.areaCode === areaFilter || metric.parentCode === areaFilter);
  }
  return record.areaCode === areaFilter || record.parentAreaCode === areaFilter;
}

function getCpdMetrics(record: ProcessDashboardRecordSummary, areaFilter: string) {
  if (areaFilter === "all") {
    return { participants: record.participantCount, credits: record.attendanceCredits };
  }
  return parseCpdAreaMetrics(record.participantAreaBreakdown)
    .filter((metric) => metric.areaCode === areaFilter || metric.parentCode === areaFilter)
    .reduce(
      (totals, metric) => ({ participants: totals.participants + metric.participants, credits: totals.credits + metric.credits }),
      { participants: 0, credits: 0 }
    );
}

function parseCpdAreaMetrics(value?: string): CpdAreaMetric[] {
  if (!value) {
    return [];
  }
  return value.split("|").map((item) => {
    const [parentCode, areaCode, participants, credits] = item.split("~");
    return {
      parentCode: parentCode ?? "",
      areaCode: areaCode || "Unassigned",
      participants: Number(participants) || 0,
      credits: Number(credits) || 0
    };
  });
}

export function buildMonthlyTrend(records: ProcessDashboardRecordSummary[], startDate = "", endDate = "") {
  const counts = new Map<string, number>();
  for (const record of records) {
    const monthKey = getRecordDate(record).slice(0, 7);
    counts.set(monthKey, (counts.get(monthKey) ?? 0) + 1);
  }
  const sortedMonths = [...counts.keys()].sort();
  const resolvedEnd = (endDate || sortedMonths.at(-1) || new Date().toISOString().slice(0, 7)).slice(0, 7);
  const end = new Date(`${resolvedEnd}-01T00:00:00`);
  const defaultStart = new Date(end);
  defaultStart.setMonth(defaultStart.getMonth() - 7);
  const resolvedStart = (startDate || sortedMonths[0] || defaultStart.toISOString().slice(0, 7)).slice(0, 7);
  const start = new Date(`${resolvedStart}-01T00:00:00`);
  const result: ChartDatum[] = [];
  for (const month = new Date(start); month <= end; month.setMonth(month.getMonth() + 1)) {
    const key = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
    result.push({ label: formatMonth(key), value: counts.get(key) ?? 0 });
  }
  return result;
}

function buildAreaBreakdown(records: ProcessDashboardRecordSummary[], processKey: ProcessKey, areaFilter: string) {
  const counts = new Map<string, number>();
  if (processKey === "cpd_event") {
    for (const record of records) {
      const metrics = parseCpdAreaMetrics(record.participantAreaBreakdown)
        .filter((metric) => areaFilter === "all" || metric.areaCode === areaFilter || metric.parentCode === areaFilter);
      for (const metric of metrics) {
        counts.set(metric.areaCode, (counts.get(metric.areaCode) ?? 0) + metric.participants);
      }
    }
  } else if (processKey === "elevate_environment") {
    for (const record of records) {
      const label = record.parentAreaCode ?? record.areaName ?? "Unassigned";
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  } else {
    for (const record of records) {
      const label = record.areaCode ?? "Unassigned";
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label));
}

function buildThemeBreakdown(records: ProcessDashboardRecordSummary[], processKey: ProcessKey) {
  const counts = new Map<string, number>();
  for (const record of records) {
    const values = splitValues(record.theme);
    for (const value of values.length ? values : ["Not recorded"]) {
      const label = formatDashboardTheme(value, processKey);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label));
}

function buildFocusBreakdown(records: ProcessDashboardRecordSummary[]) {
  const counts = new Map<string, number>();
  for (const record of records) {
    const values = splitValues(getRecordFocus(record));
    for (const value of values.length ? values : ["Not recorded"]) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label));
}

function compareRecords(left: ProcessDashboardRecordSummary, right: ProcessDashboardRecordSummary, sortKey: SortKey) {
  if (sortKey === "date_asc") {
    return getRecordDate(left).localeCompare(getRecordDate(right));
  }
  if (sortKey === "title") {
    return left.title.localeCompare(right.title);
  }
  if (sortKey === "area") {
    return (left.areaCode ?? "").localeCompare(right.areaCode ?? "");
  }
  if (sortKey === "status") {
    return left.status.localeCompare(right.status);
  }
  return getRecordDate(right).localeCompare(getRecordDate(left));
}

function getRecordMeasure(record: ProcessDashboardRecordSummary, processKey: ProcessKey, areaFilter: string) {
  if (processKey === "cpd_event") {
    return getCpdMetrics(record, areaFilter).participants;
  }
  if (processKey === "work_scrutiny") {
    return record.sampleSize;
  }
  if (processKey === "elevate_environment") {
    return record.scoreCount ? `${(record.scoreTotal / record.scoreCount).toFixed(1)} / 5` : "Not scored";
  }
  if (processKey === "coaching_session") {
    return record.ownerDisplayName ?? "Not recorded";
  }
  return record.ownerDisplayName ?? "Not recorded";
}

function getMeasureHeader(processKey: ProcessKey) {
  if (processKey === "cpd_event") {
    return "Participants";
  }
  if (processKey === "work_scrutiny") {
    return "Linked actions";
  }
  if (processKey === "elevate_environment") {
    return "Average score";
  }
  if (processKey === "coaching_session") {
    return "Coach or mentor";
  }
  return "Recorded by";
}

function formatRecordFocus(record: ProcessDashboardRecordSummary) {
  const theme = splitValues(record.theme).join(", ");
  const displayTheme = theme ? formatDashboardTheme(theme, record.processKey) : "";
  const focus = record.processKey === "learning_walk" ? getRecordFocus(record) : record.detail;
  if (displayTheme && focus) {
    return `${displayTheme} · ${focus}`;
  }
  return displayTheme || focus || record.summary || "Not recorded";
}

function getRecordFocus(record: ProcessDashboardRecordSummary) {
  if (record.focus) {
    return record.focus;
  }
  if (record.processKey !== "learning_walk" || !record.detail) {
    return undefined;
  }
  return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(record.detail) ? undefined : record.detail;
}

function formatDashboardTheme(value: string, processKey: ProcessKey) {
  return processKey === "elevate_environment" && value === "Exceptional Practice"
    ? "Leading Practice"
    : value;
}

function formatRecordTypeLabel(recordType: string) {
  if (recordType === "cpd_event") return "CPD event";
  if (recordType === "external_cpd") return "External CPD";
  return formatLabel(recordType);
}

function formatArea(record: ProcessDashboardRecordSummary) {
  if (record.parentAreaCode && record.areaCode && record.parentAreaCode !== record.areaCode) {
    return `${record.parentAreaCode} / ${record.areaCode}`;
  }
  return record.areaCode ?? "Unassigned";
}

function formatScopeLabel(user: CurrentUser) {
  const assignedAreas = user.scopes.filter((scope) => scope.scopeType === "assigned_org_units").length;
  if (assignedAreas === 1) {
    return "Assigned organisation area";
  }
  if (assignedAreas > 1) {
    return `${assignedAreas} assigned organisation areas`;
  }
  return "Your permitted records";
}

function splitValues(value?: string) {
  return value?.split("|").map((item) => item.trim()).filter(Boolean) ?? [];
}

function uniqueValues(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function getRecordDate(record: ProcessDashboardRecordSummary) {
  return record.recordDate ?? record.createdAt.slice(0, 10);
}

function formatDate(value?: string) {
  if (!value) {
    return "No date";
  }
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    .format(new Date(`${value.slice(0, 10)}T00:00:00`));
}

function formatMonth(value: string) {
  const monthValue = value.slice(0, 7);
  return new Intl.DateTimeFormat("en-GB", { month: "short", year: "2-digit" })
    .format(new Date(`${monthValue}-01T00:00:00`));
}

function exportProcessRecords(records: ProcessDashboardRecordSummary[], label: string) {
  const rows = [
    ["Record ID", "Record type", "Title", "Date", "Organisation", "Owner", "Staff member", "Status", "Theme", "Focus", "Practice observed"],
    ...records.map((record) => [
      record.id,
      record.recordType,
      record.title,
      getRecordDate(record),
      formatArea(record),
      record.ownerDisplayName ?? "",
      record.subjectDisplayName ?? "",
      record.status,
      record.theme ?? "",
      getRecordFocus(record) ?? record.detail ?? "",
      record.practiceObserved ?? ""
    ])
  ];
  downloadCsv(rows, `${label.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-")}-filtered.csv`);
}

function downloadCsv(rows: string[][], filename: string) {
  const csv = rows.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function formatLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function isDueSoon(dateValue?: string) {
  if (!dateValue) {
    return false;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const targetDate = new Date(`${dateValue}T00:00:00`);
  const daysUntilDue = (targetDate.getTime() - today.getTime()) / 86400000;
  return daysUntilDue >= 0 && daysUntilDue <= 14;
}
