import {
  Activity,
  AlertTriangle,
  Award,
  BarChart3,
  BookOpenCheck,
  Building2,
  ClipboardCheck,
  ClipboardList,
  Download,
  GraduationCap,
  MessagesSquare,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  UsersRound
} from "lucide-react";
import type { LucideProps } from "lucide-react";
import { useEffect, useMemo, useState, type ComponentType } from "react";
import { CollapsibleSection } from "../components/CollapsibleSection";
import { DataTable } from "../components/DataTable";
import { Button } from "../design-system/Button";
import { api } from "../services/api";
import type {
  ActionSummary,
  CurrentUser,
  DashboardConfiguration,
  DashboardDimensionFact,
  DashboardProcessConfiguration,
  ElevateStatusDashboardSummary,
  OrgUnitSummary,
  ProcessDashboardRecordSummary
} from "../services/types";

type DashboardProcessKey = DashboardProcessConfiguration["processKey"];
type RecordProcessKey = ProcessDashboardRecordSummary["processKey"];
type SortKey = "date_desc" | "date_asc" | "title" | "area" | "status";

type DashboardProps = {
  academicYear: string;
  actions: ActionSummary[];
  orgUnits: OrgUnitSummary[];
  processRecords: ProcessDashboardRecordSummary[];
  user: CurrentUser;
  onRefresh: () => Promise<void>;
};

type ProcessDefinition = {
  key: DashboardProcessKey;
  label: string;
  shortLabel: string;
  singular: string;
  icon: ComponentType<LucideProps>;
  tone: "teal" | "blue" | "green" | "amber" | "violet";
};

type ChartDatum = { label: string; value: number; secondary?: string };
type ElevateStatusTotals = { staffCount: number; levelCounts: number[] };

const processDefinitions: ProcessDefinition[] = [
  { key: "overview", label: "Executive overview", shortLabel: "Overview", singular: "record", icon: Sparkles, tone: "teal" },
  { key: "learning_walk", label: "Learning Walks", shortLabel: "Learning Walks", singular: "learning walk", icon: BookOpenCheck, tone: "teal" },
  { key: "liv", label: "LIV", shortLabel: "LIV", singular: "LIV record", icon: Target, tone: "blue" },
  { key: "eli", label: "Elevate Learning and Innovation", shortLabel: "ELI", singular: "assessment", icon: Sparkles, tone: "violet" },
  { key: "probation_case", label: "Probationary Observations", shortLabel: "Probation", singular: "probation case", icon: UsersRound, tone: "blue" },
  { key: "elevate_environment", label: "Elevate Environments", shortLabel: "Environments", singular: "environment audit", icon: Building2, tone: "amber" },
  { key: "coaching_session", label: "Coaching and Mentoring", shortLabel: "Coaching", singular: "session", icon: MessagesSquare, tone: "teal" },
  { key: "work_scrutiny", label: "Work Scrutiny", shortLabel: "Scrutiny", singular: "scrutiny", icon: ClipboardCheck, tone: "blue" },
  { key: "cpd_event", label: "CPD", shortLabel: "CPD", singular: "CPD event", icon: GraduationCap, tone: "green" },
  { key: "elevate_status", label: "Elevate Status", shortLabel: "Elevate Status", singular: "staff status", icon: Award, tone: "violet" },
  { key: "actions", label: "Actions", shortLabel: "Actions", singular: "action", icon: ClipboardList, tone: "amber" }
];

const elevateLevelDefinitions = [
  { level: 1, key: "explorer", name: "Elevate Explorer", sessions: 3 },
  { level: 2, key: "storyteller", name: "Elevate Storyteller", sessions: 6 },
  { level: 3, key: "innovator", name: "Elevate Innovator", sessions: 9 },
  { level: 4, key: "champion", name: "Elevate Champion", sessions: 12 },
  { level: 5, key: "changemaker", name: "Elevate Changemaker", sessions: 15 }
] as const;

const fallbackConfiguration: DashboardConfiguration = {
  schemaVersion: 2,
  processes: processDefinitions.map((definition, index) => ({
    processKey: definition.key,
    label: definition.label,
    isEnabled: true,
    displayOrder: (index + 1) * 10,
    primaryVisual: ["overview", "learning_walk", "liv", "eli", "probation_case", "elevate_environment", "work_scrutiny", "cpd_event", "elevate_status"].includes(definition.key) ? "bar" : "donut",
    showTrend: true,
    showAreaComparison: true,
    showOutcomes: true,
    showActions: !["eli", "cpd_event"].includes(definition.key)
  }))
};

export function Dashboard({ academicYear, actions, orgUnits, processRecords, user, onRefresh }: DashboardProps) {
  const [configuration, setConfiguration] = useState<DashboardConfiguration>(fallbackConfiguration);
  const [facts, setFacts] = useState<DashboardDimensionFact[]>([]);
  const [elevateStatus, setElevateStatus] = useState<ElevateStatusDashboardSummary[]>([]);
  const [selectedProcess, setSelectedProcess] = useState<DashboardProcessKey>("overview");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [areaFilter, setAreaFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dimensionFilter, setDimensionFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date_desc");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [intelligenceError, setIntelligenceError] = useState("");

  const canViewReports = user.permissions.includes("reports.view_all") || user.permissions.includes("reports.view_scoped");
  const canViewAll = user.permissions.includes("reports.view_all");

  useEffect(() => {
    if (!canViewReports) return;
    let cancelled = false;
    Promise.all([api.dashboardConfiguration(), api.dashboardDimensions(), api.elevateStatusDashboard(academicYear)])
      .then(([nextConfiguration, nextFacts, nextElevateStatus]) => {
        if (cancelled) return;
        setConfiguration(nextConfiguration);
        setFacts(nextFacts.filter((fact) => academicYearForDate(fact.occurredOn) === academicYear));
        setElevateStatus(nextElevateStatus);
        setIntelligenceError("");
      })
      .catch(() => {
        if (!cancelled) setIntelligenceError("Detailed outcome analysis is temporarily unavailable. Operational reporting remains visible.");
      });
    return () => { cancelled = true; };
  }, [academicYear, canViewReports]);

  const configuredProcesses = useMemo(() => configuration.processes
    .filter((item) => item.isEnabled)
    .sort((left, right) => left.displayOrder - right.displayOrder), [configuration]);

  useEffect(() => {
    if (!configuredProcesses.some((item) => item.processKey === selectedProcess)) {
      setSelectedProcess(configuredProcesses[0]?.processKey ?? "overview");
    }
  }, [configuredProcesses, selectedProcess]);

  const selectedDefinition = getProcessDefinition(selectedProcess);
  const selectedConfiguration = configuration.processes.find((item) => item.processKey === selectedProcess)
    ?? fallbackConfiguration.processes.find((item) => item.processKey === selectedProcess)!;
  const areaOptions = useMemo(() => collectDashboardAreaOptions(orgUnits, processRecords, user), [orgUnits, processRecords, user]);

  const dateAndAreaRecords = useMemo(() => processRecords.filter((record) => {
    const recordDate = getRecordDate(record);
    return (!startDate || recordDate >= startDate)
      && (!endDate || recordDate <= endDate)
      && recordMatchesArea(record, areaFilter);
  }), [areaFilter, endDate, processRecords, startDate]);

  const dateAndAreaFacts = useMemo(() => facts.filter((fact) =>
    (!startDate || fact.occurredOn >= startDate)
    && (!endDate || fact.occurredOn <= endDate)
    && (areaFilter === "all" || fact.areaCode === areaFilter || fact.parentAreaCode === areaFilter)
  ), [areaFilter, endDate, facts, startDate]);

  const elevateStatusInScope = useMemo(() => elevateStatus.filter((row) =>
    areaFilter === "all" || row.areaCode === areaFilter || row.parentAreaCode === areaFilter
  ), [areaFilter, elevateStatus]);
  const elevateStatusTotals = useMemo(() => aggregateElevateStatus(elevateStatusInScope), [elevateStatusInScope]);

  const processRecordsInScope = selectedProcess === "overview"
    ? dateAndAreaRecords
    : selectedProcess === "actions" ? [] : dateAndAreaRecords.filter((record) => record.processKey === selectedProcess);
  const processFactsInScope = selectedProcess === "overview"
    ? dateAndAreaFacts
    : dateAndAreaFacts.filter((fact) => fact.processKey === selectedProcess);
  const processActionsInScope = useMemo(() => actions.filter((action) => {
    const actionDate = (action.createdAt || action.dueDate || "").slice(0, 10);
    const matchesDate = (!startDate || actionDate >= startDate) && (!endDate || actionDate <= endDate);
    const matchesArea = areaFilter === "all"
      || action.facultyCode === areaFilter
      || action.teamCode === areaFilter;
    const matchesProcess = selectedProcess === "overview" || selectedProcess === "actions" || actionMatchesProcess(action, selectedProcess);
    return matchesDate && matchesArea && matchesProcess;
  }), [actions, areaFilter, endDate, selectedProcess, startDate]);

  const statusOptions = useMemo(() => selectedProcess === "elevate_status" ? [] : selectedProcess === "actions"
    ? ["open", "overdue", "complete"]
    : uniqueValues(processRecordsInScope.map((record) => record.status)), [processRecordsInScope, selectedProcess]);
  const dimensionOptions = useMemo(() => selectedProcess === "elevate_status" ? [] : uniqueValues([
    ...processFactsInScope.map((fact) => fact.seriesLabel),
    ...processRecordsInScope.flatMap((record) => splitValues(record.theme)),
    ...(selectedProcess === "overview" || selectedProcess === "actions" ? processActionsInScope.map((action) => action.actionTheme) : [])
  ]), [processActionsInScope, processFactsInScope, processRecordsInScope, selectedProcess]);

  const dimensionRecordIds = useMemo(() => new Set(
    dimensionFilter === "all" ? [] : processFactsInScope.filter((fact) => fact.seriesLabel === dimensionFilter).map((fact) => fact.sourceRecordId)
  ), [dimensionFilter, processFactsInScope]);

  const analysisRecords = useMemo(() => processRecordsInScope.filter((record) => {
    const matchesStatus = statusFilter === "all" || record.status === statusFilter;
    const matchesDimension = dimensionFilter === "all"
      || splitValues(record.theme).includes(dimensionFilter)
      || dimensionRecordIds.has(record.id);
    return matchesStatus && matchesDimension;
  }), [dimensionFilter, dimensionRecordIds, processRecordsInScope, statusFilter]);

  const analysisActions = useMemo(() => processActionsInScope.filter((action) => {
    const state = action.completedDate ? "complete" : action.isOverdue ? "overdue" : "open";
    return (statusFilter === "all" || statusFilter === state)
      && (dimensionFilter === "all" || action.actionTheme === dimensionFilter);
  }), [dimensionFilter, processActionsInScope, statusFilter]);

  const visibleRecords = useMemo(() => {
    const query = searchTerm.trim().toLocaleLowerCase();
    return [...analysisRecords].filter((record) => !query || [
      record.title, record.areaCode, record.parentAreaCode, record.ownerDisplayName,
      record.subjectDisplayName, record.theme, record.detail, record.status
    ].some((value) => value?.toLocaleLowerCase().includes(query)))
      .sort((left, right) => compareRecords(left, right, sortKey));
  }, [analysisRecords, searchTerm, sortKey]);

  const visibleActions = useMemo(() => {
    const query = searchTerm.trim().toLocaleLowerCase();
    return analysisActions.filter((action) => !query || [
      action.title, action.actionTheme, action.ownerStaffName, action.subjectStaffName,
      action.facultyCode, action.teamCode
    ].some((value) => value?.toLocaleLowerCase().includes(query)));
  }, [analysisActions, searchTerm]);

  const filteredFacts = useMemo(() => processFactsInScope.filter((fact) =>
    dimensionFilter === "all" || fact.seriesLabel === dimensionFilter
  ), [dimensionFilter, processFactsInScope]);

  const trendData = buildMonthlyTrend(selectedProcess === "actions"
    ? visibleActions.map((action) => ({ date: action.createdAt.slice(0, 10) }))
    : analysisRecords.map((record) => ({ date: getRecordDate(record) })));
  const areaData = selectedProcess === "actions"
    ? buildActionAreaBreakdown(visibleActions)
    : buildAreaBreakdown(analysisRecords);
  const outcomeData = buildOutcomeBreakdown(filteredFacts);
  const dimensionData = buildDimensionBreakdown(filteredFacts, analysisRecords);
  const processData = buildProcessBreakdown(dateAndAreaRecords, processActionsInScope);
  const openActions = analysisActions.filter((action) => !action.completedDate);
  const overdueActions = openActions.filter((action) => action.isOverdue);

  async function refresh() {
    setIsRefreshing(true);
    await onRefresh();
    try {
      const [nextConfiguration, nextFacts, nextElevateStatus] = await Promise.all([api.dashboardConfiguration(), api.dashboardDimensions(), api.elevateStatusDashboard(academicYear)]);
      setConfiguration(nextConfiguration);
      setFacts(nextFacts.filter((fact) => academicYearForDate(fact.occurredOn) === academicYear));
      setElevateStatus(nextElevateStatus);
      setIntelligenceError("");
    } catch {
      setIntelligenceError("Detailed outcome analysis is temporarily unavailable. Operational reporting remains visible.");
    } finally {
      setIsRefreshing(false);
    }
  }

  function clearFilters() {
    setStartDate(""); setEndDate(""); setAreaFilter("all"); setStatusFilter("all");
    setDimensionFilter("all"); setSearchTerm(""); setSortKey("date_desc");
  }

  function selectProcess(processKey: DashboardProcessKey) {
    setSelectedProcess(processKey); setStatusFilter("all"); setDimensionFilter("all");
    setSearchTerm(""); setSortKey("date_desc");
  }

  function exportCurrentView() {
    if (selectedProcess === "elevate_status") {
      downloadCsv(`i-elevate-status-${academicYear.replace("/", "-")}.csv`, [
        ["Organisation area", "Active staff", ...elevateLevelDefinitions.map((level) => `Level ${level.level} or above`)],
        ...elevateStatusInScope.map((row) => [
          row.areaName ?? row.areaCode ?? "Unassigned", row.staffCount,
          ...elevateLevelDefinitions.map((level) => {
            const count = elevateStatusLevelCount(row, level.level);
            return `${count} (${percentage(count, row.staffCount)}%)`;
          })
        ]),
        ["Overall", elevateStatusTotals.staffCount, ...elevateStatusTotals.levelCounts.map((count) => `${count} (${percentage(count, elevateStatusTotals.staffCount)}%)`)]
      ]);
      return;
    }
    if (selectedProcess === "actions") {
      downloadCsv(`i-elevate-actions-${academicYear.replace("/", "-")}.csv`, [
        ["Theme", "Action", "Owner", "Area", "Due", "Status"],
        ...visibleActions.map((action) => [
          action.actionTheme, action.title, action.ownerStaffName ?? "Unassigned",
          action.teamCode ?? action.facultyCode ?? "Unassigned", action.dueDate ?? "",
          action.completedDate ? "Complete" : action.isOverdue ? "Overdue" : "Open"
        ])
      ]);
      return;
    }
    downloadCsv(`i-elevate-${selectedProcess}-${academicYear.replace("/", "-")}.csv`, [
      ["Process", "Record", "Date", "Area", "Status", "Theme or focus", "Measure"],
      ...visibleRecords.map((record) => [
        getProcessDefinition(record.processKey).label, record.title, getRecordDate(record), formatArea(record),
        formatLabel(record.status), splitValues(record.theme).join(", "), formatRecordMeasure(record)
      ])
    ]);
  }

  if (!canViewReports) {
    return <div className="route-stack"><div className="route-header"><div><p className="eyebrow">Leadership intelligence</p><h1>Dashboard</h1></div></div><section className="panel dashboard-access-panel"><AlertTriangle size={20} aria-hidden="true" /><div><h2>Reporting access is not assigned</h2><p>Your actions and staff profile remain available from the main navigation.</p></div></section></div>;
  }

  return (
    <div className="route-stack intelligence-dashboard">
      <header className="intelligence-header">
        <div>
          <p className="eyebrow">Leadership intelligence · {academicYear}</p>
          <h1>{canViewAll ? "Whole organisation performance" : "Quality performance"}</h1>
          <p>Quality, professional development and delivery assurance across {canViewAll ? "the college" : formatScopeLabel(user)}.</p>
        </div>
        <div className="intelligence-header-actions">
          <span className="intelligence-data-state"><i />Permission-scoped live data</span>
          <Button icon={Download} onClick={exportCurrentView} variant="secondary">Export view</Button>
          <Button disabled={isRefreshing} icon={RefreshCw} onClick={() => void refresh()}>{isRefreshing ? "Refreshing" : "Refresh"}</Button>
        </div>
      </header>

      {intelligenceError ? <div className="intelligence-warning"><AlertTriangle size={16} />{intelligenceError}</div> : null}

      <nav className="intelligence-process-nav" aria-label="Dashboard views">
        {configuredProcesses.map((item) => {
          const definition = getProcessDefinition(item.processKey);
          const Icon = definition.icon;
          const count = item.processKey === "overview"
            ? dateAndAreaRecords.length
            : item.processKey === "actions" ? processActionsInScope.length
              : item.processKey === "elevate_status" ? elevateStatusTotals.staffCount
                : dateAndAreaRecords.filter((record) => record.processKey === item.processKey).length;
          return <button aria-pressed={selectedProcess === item.processKey} key={item.processKey} onClick={() => selectProcess(item.processKey)} type="button"><Icon size={17} /><span>{item.label || definition.shortLabel}</span><strong>{count}</strong></button>;
        })}
      </nav>

      <section className="panel intelligence-filter-panel">
        <div className="intelligence-filter-heading"><div><span>Current view</span><strong>{selectedConfiguration.label || selectedDefinition.label}</strong></div><small>All visuals and exports use these filters</small></div>
        <div className={`intelligence-filter-grid${selectedProcess === "elevate_status" ? " intelligence-filter-grid-status" : ""}`}>
          {selectedProcess !== "elevate_status" ? <><label><span>From</span><input onChange={(event) => setStartDate(event.target.value)} type="date" value={startDate} /></label>
          <label><span>To</span><input onChange={(event) => setEndDate(event.target.value)} type="date" value={endDate} /></label></> : null}
          <label><span>Organisation area</span><select onChange={(event) => setAreaFilter(event.target.value)} value={areaFilter}><option value="all">All permitted areas</option>{areaOptions.map((area) => <option key={area.code} value={area.code}>{area.label}</option>)}</select></label>
          {selectedProcess !== "elevate_status" ? <><label><span>Status</span><select onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}><option value="all">All statuses</option>{statusOptions.map((status) => <option key={status} value={status}>{formatLabel(status)}</option>)}</select></label>
          <label><span>Theme, focus or area</span><select onChange={(event) => setDimensionFilter(event.target.value)} value={dimensionFilter}><option value="all">All recorded dimensions</option>{dimensionOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label></> : <div className="elevate-status-filter-note"><span>Measurement</span><strong>{academicYear} · at or above each level</strong></div>}
          <Button icon={RotateCcw} onClick={clearFilters} variant="secondary">Reset</Button>
        </div>
      </section>

      {selectedProcess === "overview" ? (
        <ExecutiveOverview
          actions={processActionsInScope}
          areaData={areaData}
          facts={dateAndAreaFacts}
          processData={processData}
          records={dateAndAreaRecords}
          trendData={trendData}
        />
      ) : selectedProcess === "elevate_status" ? (
        <ElevateStatusOverview academicYear={academicYear} configuration={selectedConfiguration} rows={elevateStatusInScope} totals={elevateStatusTotals} />
      ) : (
        <ProcessOverview
          actions={analysisActions}
          areaData={areaData}
          configuration={selectedConfiguration}
          dimensionData={dimensionData}
          definition={selectedDefinition}
          outcomeData={outcomeData}
          records={analysisRecords}
          trendData={trendData}
        />
      )}

      {selectedProcess !== "elevate_status" ? <CollapsibleSection
        className="intelligence-record-panel"
        count={selectedProcess === "actions" ? visibleActions.length : visibleRecords.length}
        defaultExpanded={false}
        isEmpty={(selectedProcess === "actions" ? visibleActions.length : visibleRecords.length) === 0}
        emptyMessage={`No ${selectedDefinition.label.toLocaleLowerCase()} match the current filters.`}
        statusSummary="Search, sort and export-ready detail"
        storageKey={`leadership-dashboard-records-${selectedProcess}`}
        title={selectedProcess === "overview" ? "All quality records" : `${selectedDefinition.label} detail`}
      >
        <div className="dashboard-record-heading"><div className="dashboard-record-tools"><label className="search-box dashboard-record-search"><Search size={16} /><input aria-label="Search dashboard detail" onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search current view" value={searchTerm} /></label>{selectedProcess !== "actions" ? <label className="record-sort-field"><span>Sort by</span><select onChange={(event) => setSortKey(event.target.value as SortKey)} value={sortKey}><option value="date_desc">Newest first</option><option value="date_asc">Oldest first</option><option value="title">Title</option><option value="area">Area</option><option value="status">Status</option></select></label> : null}</div></div>
        {selectedProcess === "actions" ? <ActionDetailTable actions={visibleActions} /> : <RecordDetailTable records={visibleRecords} />}
      </CollapsibleSection> : null}
    </div>
  );
}

function ExecutiveOverview({ records, facts, actions, trendData, areaData, processData }: {
  records: ProcessDashboardRecordSummary[]; facts: DashboardDimensionFact[]; actions: ActionSummary[];
  trendData: ChartDatum[]; areaData: ChartDatum[]; processData: ChartDatum[];
}) {
  const scoredRecords = records.filter((record) => record.scoreCount > 0);
  const totalRatings = scoredRecords.reduce((total, record) => total + record.scoreCount, 0);
  const averageScore = totalRatings > 0 ? scoredRecords.reduce((total, record) => total + record.scoreTotal, 0) / totalRatings : 0;
  const openActions = actions.filter((action) => !action.completedDate);
  const overdueActions = openActions.filter((action) => action.isOverdue);
  const completionRate = actions.length ? Math.round((actions.filter((action) => action.completedDate).length / actions.length) * 100) : 0;
  const areas = new Set(records.flatMap((record) => [record.areaCode, record.parentAreaCode]).filter(Boolean)).size;
  const peopleReached = records.reduce((total, record) => total + (record.processKey === "cpd_event" ? record.participantCount : record.subjectDisplayName ? 1 : 0), 0);
  const topFocus = buildFocusFrequency(facts)[0];

  return <>
    <section className="intelligence-briefing panel">
      <div><span className="intelligence-section-label"><ShieldCheck size={15} />Executive briefing</span><h2>{records.length ? `${records.length} quality and development records are in scope.` : "No activity has been recorded for this view yet."}</h2><p>{areas} organisation areas represented · {peopleReached} staff interactions or CPD attendances · {openActions.length} open actions.</p></div>
      <div className="intelligence-briefing-signal"><span>Most visible focus</span><strong>{topFocus?.label ?? "Insufficient data"}</strong><small>{topFocus ? `${topFocus.value} recorded instances` : "Focus data will appear as forms are completed"}</small></div>
    </section>
    <div className="intelligence-kpi-grid">
      <MetricCard label="Recorded activity" value={records.length} detail={`${processData.filter((item) => item.value > 0).length} active processes`} tone="teal" />
      <MetricCard label="Areas represented" value={areas} detail="Across the permitted scope" tone="blue" />
      <MetricCard label="Average quality signal" value={averageScore ? averageScore.toFixed(1) : "—"} detail={averageScore ? "Five-point comparable scale" : "Awaiting scored activity"} tone="violet" />
      <MetricCard label="Action completion" value={actions.length ? `${completionRate}%` : "—"} detail={`${openActions.length} open · ${overdueActions.length} overdue`} tone={overdueActions.length ? "amber" : "green"} />
    </div>
    <div className="intelligence-chart-grid intelligence-chart-grid-wide">
      <TrendChart title="Activity trajectory" subtitle="Monthly completed and in-progress records" data={trendData} />
      <RankedBars title="Process mix" subtitle="Volume by quality and development process" data={processData} />
      <RankedBars title="Organisation coverage" subtitle="Recorded activity across curriculum areas" data={areaData} />
      <ActionAssurance actions={actions} />
    </div>
  </>;
}

function ElevateStatusOverview({ academicYear, configuration, rows, totals }: {
  academicYear: string;
  configuration: DashboardProcessConfiguration;
  rows: ElevateStatusDashboardSummary[];
  totals: ElevateStatusTotals;
}) {
  const anyStatus = totals.levelCounts[0] ?? 0;
  const highestLevel = [...elevateLevelDefinitions].reverse().find((level) => (totals.levelCounts[level.level - 1] ?? 0) > 0);
  return <>
    <section className="intelligence-briefing panel elevate-status-briefing">
      <div>
        <span className="intelligence-section-label"><Award size={15} />Cumulative attainment</span>
        <h2>{totals.staffCount ? `${anyStatus} of ${totals.staffCount} active staff have achieved Elevate Status.` : "No active staff are in the selected organisation scope."}</h2>
        <p>Each level includes staff at that level and every higher level. Percentages use all active staff in the selected permitted organisation area as the denominator.</p>
      </div>
      <div className="intelligence-briefing-signal"><span>Highest represented level</span><strong>{highestLevel?.name ?? "No awards recorded"}</strong><small>{academicYear} academic year</small></div>
    </section>
    <div className="intelligence-kpi-grid">
      <MetricCard label="Active staff in scope" value={totals.staffCount} detail="Permission and organisation filtered" tone="teal" />
      <MetricCard label="Status participation" value={totals.staffCount ? `${percentage(anyStatus, totals.staffCount)}%` : "—"} detail={`${anyStatus} staff at Level 1 or above`} tone="blue" />
      <MetricCard label="Innovators or above" value={totals.staffCount ? `${percentage(totals.levelCounts[2] ?? 0, totals.staffCount)}%` : "—"} detail={`${totals.levelCounts[2] ?? 0} staff at Level 3 or above`} tone="violet" />
      <MetricCard label="Champions or above" value={totals.staffCount ? `${percentage(totals.levelCounts[3] ?? 0, totals.staffCount)}%` : "—"} detail={`${totals.levelCounts[3] ?? 0} staff at Level 4 or above`} tone="amber" />
    </div>
    {configuration.showOutcomes ? <section className="panel intelligence-chart-card elevate-status-attainment-card">
      <div className="intelligence-card-heading"><div><h3>Attainment by level</h3><span>At or above each threshold · count and percentage of active staff</span></div><BarChart3 size={18} /></div>
      {totals.staffCount ? <div className="elevate-attainment-grid">
        {elevateLevelDefinitions.map((level) => {
          const count = totals.levelCounts[level.level - 1] ?? 0;
          const value = percentage(count, totals.staffCount);
          return <article key={level.level}>
            <img alt="" aria-hidden="true" src={`/system-assets/elevate-status/${level.key}.png`} />
            <div className="elevate-attainment-heading"><span>Level {level.level}</span><strong>{level.name}</strong><small>{level.sessions} sessions required</small></div>
            <div className="elevate-attainment-value"><strong>{value}%</strong><span>{count} of {totals.staffCount} staff</span></div>
            <div className="elevate-attainment-track" aria-label={`${level.name}: ${value}%, ${count} of ${totals.staffCount} staff`} role="img"><i style={{ width: `${value}%` }} /></div>
          </article>;
        })}
      </div> : <EmptyChart message="No active staff are available for this organisation scope." />}
    </section> : null}
    {configuration.showAreaComparison ? <section className="panel elevate-status-area-card">
      <div className="intelligence-card-heading"><div><h3>Organisation comparison</h3><span>Cumulative attainment within each primary organisation area</span></div><Building2 size={18} /></div>
      {rows.length ? <div className="table-scroll"><table className="elevate-status-area-table"><thead><tr><th>Organisation area</th><th>Active staff</th>{elevateLevelDefinitions.map((level) => <th key={level.level}>L{level.level}+</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.orgUnitId ?? "unassigned"}><td><strong>{row.areaName ?? "Unassigned"}</strong><span>{row.areaCode ?? "No primary area"}</span></td><td>{row.staffCount}</td>{elevateLevelDefinitions.map((level) => { const count = elevateStatusLevelCount(row, level.level); return <td key={level.level}><strong>{percentage(count, row.staffCount)}%</strong><span>{count} staff</span></td>; })}</tr>)}</tbody></table></div> : <EmptyChart message="No organisation areas are available in this view." />}
    </section> : null}
  </>;
}

function ProcessOverview({ definition, configuration, records, actions, trendData, areaData, outcomeData, dimensionData }: {
  definition: ProcessDefinition; configuration: DashboardProcessConfiguration; records: ProcessDashboardRecordSummary[];
  actions: ActionSummary[]; trendData: ChartDatum[]; areaData: ChartDatum[]; outcomeData: ChartDatum[]; dimensionData: ChartDatum[];
}) {
  const scored = records.filter((record) => record.scoreCount > 0);
  const scoreCount = scored.reduce((total, record) => total + record.scoreCount, 0);
  const average = scoreCount ? scored.reduce((total, record) => total + record.scoreTotal, 0) / scoreCount : 0;
  const complete = records.filter((record) => ["completed", "submitted", "closed"].includes(record.status)).length;
  const areas = new Set(records.map((record) => record.areaCode).filter(Boolean)).size;
  const open = actions.filter((action) => !action.completedDate);
  const totalItems = definition.key === "actions" ? actions.length : records.length;
  const completedItems = definition.key === "actions" ? actions.filter((action) => action.completedDate).length : complete;
  return <>
    <div className="intelligence-section-title"><div><span>{definition.shortLabel}</span><h2>Performance and assurance</h2></div><p>Structured answers are aggregated; narrative notes are excluded from dashboard analysis.</p></div>
    <div className="intelligence-kpi-grid">
      <MetricCard label="Records in view" value={definition.key === "actions" ? actions.length : records.length} detail={`${areas} organisation areas`} tone="teal" />
      <MetricCard label="Completed" value={completedItems} detail={totalItems ? `${Math.round((completedItems / totalItems) * 100)}% of ${definition.key === "actions" ? "actions" : "records"}` : "No records in view"} tone="green" />
      <MetricCard label="Average outcome" value={average ? average.toFixed(1) : "—"} detail={average ? "Five-point comparable scale" : "No scored outcomes"} tone="violet" />
      <MetricCard label="Open actions" value={open.length} detail={`${open.filter((action) => action.isOverdue).length} overdue`} tone={open.some((action) => action.isOverdue) ? "amber" : "blue"} />
    </div>
    <div className="intelligence-chart-grid">
      {configuration.showTrend ? <TrendChart title="Activity over time" subtitle="Monthly records in the current view" data={trendData} /> : null}
      {configuration.showAreaComparison ? <RankedBars title="Organisation comparison" subtitle="Volume by organisation area" data={areaData} /> : null}
      {configuration.showOutcomes ? configuration.primaryVisual === "donut"
        ? <DonutChart title="Recorded outcomes" subtitle="Distribution of configured responses" data={outcomeData.length ? outcomeData : dimensionData} />
        : <OutcomeProfile data={dimensionData} /> : null}
      {configuration.showActions ? <ActionAssurance actions={actions} /> : null}
    </div>
  </>;
}

function MetricCard({ label, value, detail, tone }: { label: string; value: string | number; detail: string; tone: string }) {
  return <section className={`intelligence-metric intelligence-metric-${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></section>;
}

function TrendChart({ title, subtitle, data }: { title: string; subtitle: string; data: ChartDatum[] }) {
  const values = data.length ? data : [{ label: "No data", value: 0 }];
  const max = Math.max(...values.map((item) => item.value), 1);
  const points = values.map((item, index) => {
    const x = values.length === 1 ? 50 : 8 + (index / (values.length - 1)) * 84;
    const y = 82 - (item.value / max) * 62;
    return { ...item, x, y };
  });
  const line = points.length === 1 ? `42,${points[0].y} 58,${points[0].y}` : points.map((point) => `${point.x},${point.y}`).join(" ");
  const area = points.length === 1 ? `42,86 42,${points[0].y} 58,${points[0].y} 58,86` : `8,86 ${line} ${points.at(-1)?.x ?? 92},86`;
  return <section className="panel intelligence-chart-card intelligence-trend-card"><div className="intelligence-card-heading"><div><h3>{title}</h3><span>{subtitle}</span></div><Activity size={18} /></div>{data.length ? <><svg aria-label={`${title}. ${data.map((item) => `${item.label}: ${item.value}`).join(", ")}`} role="img" viewBox="0 0 100 100" preserveAspectRatio="none"><defs><linearGradient id={`trend-${title.replaceAll(" ", "-")}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity=".32"/><stop offset="1" stopColor="var(--accent)" stopOpacity="0"/></linearGradient></defs><polygon fill={`url(#trend-${title.replaceAll(" ", "-")})`} points={area}/><polyline fill="none" points={line}/>{points.map((point) => <circle cx={point.x} cy={point.y} key={point.label} r="1.5"><title>{point.label}: {point.value}</title></circle>)}</svg><div className="intelligence-chart-axis">{points.map((point) => <span key={point.label}>{point.label}</span>)}</div></> : <EmptyChart />}</section>;
}

function RankedBars({ title, subtitle, data }: { title: string; subtitle: string; data: ChartDatum[] }) {
  const visible = data.slice(0, 8); const max = Math.max(...visible.map((item) => item.value), 1);
  return <section className="panel intelligence-chart-card"><div className="intelligence-card-heading"><div><h3>{title}</h3><span>{subtitle}</span></div><BarChart3 size={18} /></div>{visible.length ? <div className="intelligence-ranked-bars">{visible.map((item) => <div key={item.label}><span title={item.label}>{item.label}</span><div><i style={{ width: `${Math.max(4, (item.value / max) * 100)}%` }}/></div><strong>{item.value}</strong></div>)}</div> : <EmptyChart />}</section>;
}

function OutcomeProfile({ data }: { data: ChartDatum[] }) {
  const visible = data.slice(0, 8);
  return <section className="panel intelligence-chart-card"><div className="intelligence-card-heading"><div><h3>Focus and outcome profile</h3><span>Average score by configured focus, pillar or practice area</span></div><Target size={18} /></div>{visible.length ? <div className="intelligence-outcome-list">{visible.map((item) => <div key={item.label}><div><strong>{item.label}</strong><span>{item.secondary}</span></div><div className="intelligence-five-scale"><i style={{ width: `${Math.max(3, (item.value / 5) * 100)}%` }}/></div><b>{item.value.toFixed(1)}</b></div>)}</div> : <EmptyChart message="No structured outcome data in this view." />}</section>;
}

function DonutChart({ title, subtitle, data }: { title: string; subtitle: string; data: ChartDatum[] }) {
  const visible = data.slice(0, 6); const total = visible.reduce((sum, item) => sum + item.value, 0);
  let cursor = 0;
  const gradient = visible.length ? visible.map((item, index) => { const start = cursor; cursor += (item.value / total) * 100; return `var(--chart-${(index % 6) + 1}) ${start}% ${cursor}%`; }).join(",") : "var(--panel-border) 0 100%";
  return <section className="panel intelligence-chart-card"><div className="intelligence-card-heading"><div><h3>{title}</h3><span>{subtitle}</span></div><Target size={18} /></div>{visible.length ? <div className="intelligence-donut-layout"><div className="intelligence-donut" style={{ background: `conic-gradient(${gradient})` }}><span><strong>{total}</strong><small>responses</small></span></div><div className="intelligence-donut-legend">{visible.map((item, index) => <div key={item.label}><i style={{ background: `var(--chart-${(index % 6) + 1})` }}/><span>{item.label}</span><strong>{item.value}</strong></div>)}</div></div> : <EmptyChart />}</section>;
}

function ActionAssurance({ actions }: { actions: ActionSummary[] }) {
  const complete = actions.filter((action) => action.completedDate).length;
  const overdue = actions.filter((action) => !action.completedDate && action.isOverdue).length;
  const open = actions.length - complete;
  const completion = actions.length ? Math.round((complete / actions.length) * 100) : 0;
  const attention = actions.filter((action) => !action.completedDate).sort((left, right) => (left.dueDate ?? "9999").localeCompare(right.dueDate ?? "9999")).slice(0, 4);
  return <section className="panel intelligence-chart-card intelligence-assurance-card"><div className="intelligence-card-heading"><div><h3>Action assurance</h3><span>Delivery confidence and immediate attention</span></div><ShieldCheck size={18} /></div>{actions.length ? <><div className="intelligence-assurance-score"><div><strong>{completion}%</strong><span>completion</span></div><div><b>{open}</b><span>open</span></div><div className={overdue ? "is-risk" : ""}><b>{overdue}</b><span>overdue</span></div></div><div className="intelligence-attention-list">{attention.map((action) => <div key={action.id}><i className={action.isOverdue ? "is-overdue" : ""}/><span><strong>{action.title}</strong><small>{action.ownerStaffName ?? "Unassigned"} · {formatDate(action.dueDate)}</small></span></div>)}</div></> : <EmptyChart message="No actions are linked to this view." />}</section>;
}

function EmptyChart({ message = "No data in the current view." }: { message?: string }) { return <div className="intelligence-empty"><Activity size={18}/><span>{message}</span></div>; }

function RecordDetailTable({ records }: { records: ProcessDashboardRecordSummary[] }) {
  return <DataTable rows={records} rowKey={(record) => record.id} columns={[
    { key: "process", header: "Process", render: (record) => getProcessDefinition(record.processKey).shortLabel },
    { key: "title", header: "Record", render: (record) => <strong>{record.title}</strong> },
    { key: "date", header: "Date", render: (record) => formatDate(getRecordDate(record)) },
    { key: "area", header: "Area", render: (record) => formatArea(record) },
    { key: "focus", header: "Theme / focus", render: (record) => formatRecordFocus(record) },
    { key: "measure", header: "Key measure", render: (record) => formatRecordMeasure(record) },
    { key: "status", header: "Status", render: (record) => <span className="status-pill">{formatLabel(record.status)}</span> }
  ]}/>;
}

function ActionDetailTable({ actions }: { actions: ActionSummary[] }) {
  return <DataTable rows={actions} rowKey={(action) => action.id} columns={[
    { key: "theme", header: "Theme", render: (action) => action.actionTheme },
    { key: "title", header: "Action", render: (action) => <strong>{action.title}</strong> },
    { key: "owner", header: "Owner", render: (action) => action.ownerStaffName ?? "Unassigned" },
    { key: "area", header: "Area", render: (action) => action.teamCode ?? action.facultyCode ?? "Unassigned" },
    { key: "due", header: "Due", render: (action) => formatDate(action.dueDate) },
    { key: "status", header: "Status", render: (action) => <span className={`status-pill ${action.isOverdue && !action.completedDate ? "status-risk" : ""}`}>{action.completedDate ? "Complete" : action.isOverdue ? "Overdue" : "Open"}</span> }
  ]}/>;
}

function buildMonthlyTrend(items: Array<{ date: string }>): ChartDatum[] {
  const counts = new Map<string, number>();
  for (const item of items) { const key = item.date.slice(0, 7); counts.set(key, (counts.get(key) ?? 0) + 1); }
  return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)).slice(-10).map(([month, value]) => ({ label: formatMonth(month), value }));
}

function buildAreaBreakdown(records: ProcessDashboardRecordSummary[]): ChartDatum[] {
  const counts = new Map<string, number>();
  for (const record of records) { const label = record.areaCode ?? record.parentAreaCode ?? "Unassigned"; const value = record.processKey === "cpd_event" ? Math.max(record.participantCount, 1) : 1; counts.set(label, (counts.get(label) ?? 0) + value); }
  return mapSortedCounts(counts);
}

function buildActionAreaBreakdown(actions: ActionSummary[]): ChartDatum[] {
  const counts = new Map<string, number>();
  for (const action of actions) { const label = action.teamCode ?? action.facultyCode ?? "Unassigned"; counts.set(label, (counts.get(label) ?? 0) + 1); }
  return mapSortedCounts(counts);
}

function buildProcessBreakdown(records: ProcessDashboardRecordSummary[], actions: ActionSummary[]): ChartDatum[] {
  return processDefinitions.filter((definition) => !["overview", "actions"].includes(definition.key)).map((definition) => ({ label: definition.shortLabel, value: records.filter((record) => record.processKey === definition.key).length })).concat({ label: "Actions", value: actions.length }).sort((left, right) => right.value - left.value);
}

function buildDimensionBreakdown(facts: DashboardDimensionFact[], records: ProcessDashboardRecordSummary[]): ChartDatum[] {
  const scored = new Map<string, { total: number; count: number }>();
  for (const fact of facts.filter((item) => item.numericValue !== undefined && item.numericValue !== null)) { const current = scored.get(fact.seriesLabel) ?? { total: 0, count: 0 }; current.total += Number(fact.numericValue); current.count += 1; scored.set(fact.seriesLabel, current); }
  if (scored.size) return [...scored.entries()].map(([label, metric]) => ({ label, value: metric.total / metric.count, secondary: `${metric.count} rated response${metric.count === 1 ? "" : "s"}` })).sort((left, right) => left.value - right.value);
  const counts = new Map<string, number>();
  for (const fact of facts) counts.set(fact.seriesLabel, (counts.get(fact.seriesLabel) ?? 0) + 1);
  for (const record of records) for (const theme of splitValues(record.theme)) counts.set(theme, (counts.get(theme) ?? 0) + 1);
  return mapSortedCounts(counts);
}

function buildOutcomeBreakdown(facts: DashboardDimensionFact[]): ChartDatum[] {
  const counts = new Map<string, number>();
  for (const fact of facts.filter((item) => item.numericValue !== undefined && item.numericValue !== null)) counts.set(fact.valueLabel, (counts.get(fact.valueLabel) ?? 0) + 1);
  return mapSortedCounts(counts);
}

function buildFocusFrequency(facts: DashboardDimensionFact[]): ChartDatum[] {
  const counts = new Map<string, number>();
  for (const fact of facts.filter((item) => ["focus", "focus_outcome", "practice_area_outcome", "pillar_outcome", "theme"].includes(item.dimensionKey))) {
    counts.set(fact.seriesLabel, (counts.get(fact.seriesLabel) ?? 0) + 1);
  }
  return mapSortedCounts(counts);
}

function mapSortedCounts(counts: Map<string, number>): ChartDatum[] { return [...counts.entries()].map(([label, value]) => ({ label, value })).sort((left, right) => right.value - left.value || left.label.localeCompare(right.label)); }

function elevateStatusLevelCount(row: ElevateStatusDashboardSummary, level: number) {
  return [row.level1OrAbove, row.level2OrAbove, row.level3OrAbove, row.level4OrAbove, row.level5OrAbove][level - 1] ?? 0;
}

function aggregateElevateStatus(rows: ElevateStatusDashboardSummary[]): ElevateStatusTotals {
  return rows.reduce<ElevateStatusTotals>((total, row) => ({
    staffCount: total.staffCount + row.staffCount,
    levelCounts: total.levelCounts.map((count, index) => count + elevateStatusLevelCount(row, index + 1))
  }), { staffCount: 0, levelCounts: [0, 0, 0, 0, 0] });
}

function percentage(count: number, total: number) {
  return total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
}

function actionMatchesProcess(action: ActionSummary, processKey: DashboardProcessKey) {
  const map: Partial<Record<DashboardProcessKey, string[]>> = {
    learning_walk: ["learning_walk"], liv: ["liv"], probation_case: ["probation_observation"],
    elevate_environment: ["elevate_environment"], coaching_session: ["coaching_mentoring"],
    work_scrutiny: ["work_scrutiny"], cpd_event: ["cpd", "cpd_event"]
  };
  return map[processKey]?.includes(action.sourceFormType) ?? false;
}

function getProcessDefinition(processKey: DashboardProcessKey | RecordProcessKey) { return processDefinitions.find((item) => item.key === processKey) ?? processDefinitions[0]; }
function recordMatchesArea(record: ProcessDashboardRecordSummary, area: string) { return area === "all" || record.areaCode === area || record.parentAreaCode === area; }
function splitValues(value?: string) { return value?.split("|").map((item) => item.trim()).filter(Boolean) ?? []; }
function uniqueValues(values: string[]) { return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right)); }
function getRecordDate(record: ProcessDashboardRecordSummary) { return record.recordDate ?? record.createdAt.slice(0, 10); }
function compareRecords(left: ProcessDashboardRecordSummary, right: ProcessDashboardRecordSummary, sort: SortKey) { if (sort === "date_asc") return getRecordDate(left).localeCompare(getRecordDate(right)); if (sort === "title") return left.title.localeCompare(right.title); if (sort === "area") return (left.areaCode ?? "").localeCompare(right.areaCode ?? ""); if (sort === "status") return left.status.localeCompare(right.status); return getRecordDate(right).localeCompare(getRecordDate(left)); }
function formatArea(record: ProcessDashboardRecordSummary) { return record.parentAreaCode && record.areaCode && record.parentAreaCode !== record.areaCode ? `${record.parentAreaCode} / ${record.areaCode}` : record.areaCode ?? "Unassigned"; }
function formatRecordFocus(record: ProcessDashboardRecordSummary) { return splitValues(record.theme).join(", ") || record.detail || record.summary || "Not recorded"; }
function formatRecordMeasure(record: ProcessDashboardRecordSummary) { if (record.processKey === "cpd_event") return `${record.participantCount} participants · ${formatDuration(record.learningMinutes)}`; if (record.scoreCount) return `${(record.scoreTotal / record.scoreCount).toFixed(1)} / ${record.scoreMaximum}`; if (record.processKey === "probation_case") return record.sampleSize ? `Observation ${record.sampleSize}` : "Started"; if (record.processKey === "liv") return `${record.sampleSize} visits`; if (record.processKey === "work_scrutiny") return `${record.sampleSize} sampled`; return record.ownerDisplayName ?? record.subjectDisplayName ?? "Recorded"; }
function formatDuration(minutes: number) { const hours = Math.floor(minutes / 60); const remainder = minutes % 60; return hours ? `${hours}h${remainder ? ` ${remainder}m` : ""}` : `${remainder}m`; }
function formatLabel(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase()); }
function formatDate(value?: string) { return value ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value.slice(0, 10)}T00:00:00`)) : "No date"; }
function formatMonth(value: string) { return new Intl.DateTimeFormat("en-GB", { month: "short", year: "2-digit" }).format(new Date(`${value}-01T00:00:00`)); }
function academicYearForDate(value: string) { const date = new Date(value); const year = date.getFullYear(); const start = date.getMonth() >= 7 ? year : year - 1; return `${start}/${String(start + 1).slice(-2)}`; }
function formatScopeLabel(user: CurrentUser) { const count = user.scopes.filter((scope) => scope.scopeType === "assigned_org_units").length; return count ? `${count} assigned organisation area${count === 1 ? "" : "s"}` : "your permitted records"; }

function collectDashboardAreaOptions(orgUnits: OrgUnitSummary[], records: ProcessDashboardRecordSummary[], user: CurrentUser) {
  const active = orgUnits.filter((unit) => unit.isActive && ["faculty", "team", "faculty_child_code", "faculty_child"].includes(unit.orgUnitType));
  const permitted = new Set(user.permissions.includes("reports.view_all") ? active.map((unit) => unit.id) : user.scopes.filter((scope) => scope.scopeType === "assigned_org_units" && scope.orgUnitId).map((scope) => scope.orgUnitId!));
  let changed = true; while (changed) { changed = false; for (const unit of active) if (unit.parentOrgUnitId && permitted.has(unit.parentOrgUnitId) && !permitted.has(unit.id)) { permitted.add(unit.id); changed = true; } }
  const options = active.filter((unit) => permitted.has(unit.id)).map((unit) => { const parent = active.find((candidate) => candidate.id === unit.parentOrgUnitId); return { code: unit.code, label: parent ? `${parent.code} / ${unit.code} · ${unit.name}` : `${unit.code} · ${unit.name}` }; });
  if (options.length) return options.sort((left, right) => left.label.localeCompare(right.label));
  return uniqueValues(records.flatMap((record) => [record.parentAreaCode ?? "", record.areaCode ?? ""])).map((code) => ({ code, label: code }));
}

function downloadCsv(filename: string, rows: Array<Array<string | number>>) {
  const content = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\ufeff", content], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
}
