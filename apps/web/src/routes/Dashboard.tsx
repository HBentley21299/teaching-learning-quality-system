import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Award,
  BarChart3,
  BookOpenCheck,
  Building2,
  ChevronDown,
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
import { CollapsibleSection, Pagination } from "../components/CollapsibleSection";
import { DataTable } from "../components/DataTable";
import { Button } from "../design-system/Button";
import { actionPath, recordPath, staffPath } from "../app/routing";
import { api } from "../services/api";
import type {
  ActionSummary,
  CurrentUser,
  CpdAttendanceDashboardSummary,
  DashboardConfiguration,
  DashboardDimensionFact,
  DashboardProcessConfiguration,
  ElevateStatusDashboardSummary,
  LearningWalkThemeGroup,
  LivLifecycleDashboardSummary,
  OrgUnitSummary,
  ProcessDashboardRecordSummary,
  StaffParticipationDashboardSummary
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
  onOpenAction: (actionId: string, staffId: string) => void;
  onOpenRecord: (recordId: string) => void;
  onOpenStaff: (staffId: string) => void;
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
type TrendGranularity = "day" | "week" | "month";
type ElevateStatusTotals = { staffCount: number; levelCounts: number[] };
type StaffParticipationTotals = { activeStaffCount: number; participatingStaffCount: number };
type DashboardOrgOption = { id: string; code: string; name: string; facultyId: string };
type LivLifecycleTotals = {
  requestedCount: number;
  caseStartedCount: number;
  scheduledCount: number;
  visitedCount: number;
  completedCount: number;
  completedVisitCount: number;
  practitionerStaffCount: number;
  practitionerStaffDenominator: number;
};
type OutcomeRow = {
  label: string;
  responseCount: number;
  average: number;
  secureOrAboveCount: number;
  distribution: number[];
};
type OutcomeGroup = {
  key: string;
  label: string;
  summary: OutcomeRow;
  children: OutcomeRow[];
};
type FrequencyRow = { label: string; recordCount: number };
type OrganisationPerformanceRow = {
  code: string;
  name: string;
  parentCode?: string;
  recordCount: number;
  completedCount: number;
  ratingTotal: number;
  ratingCount: number;
  secureOrAboveCount: number;
  openActionCount: number;
  overdueActionCount: number;
  activeStaffCount: number;
  participatingStaffCount: number;
  livRequestedCount: number;
  livScheduledCount: number;
  livVisitedCount: number;
  livCompletedCount: number;
};
type MetricDefinition = { label: string; value: string | number; detail: string; tone: "teal" | "blue" | "green" | "amber" | "violet" };

const detailPageSize = 25;

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

export function Dashboard({ academicYear, actions, orgUnits, processRecords, user, onRefresh, onOpenAction, onOpenRecord, onOpenStaff }: DashboardProps) {
  const [configuration, setConfiguration] = useState<DashboardConfiguration>(fallbackConfiguration);
  const [facts, setFacts] = useState<DashboardDimensionFact[]>([]);
  const [elevateStatus, setElevateStatus] = useState<ElevateStatusDashboardSummary[]>([]);
  const [staffParticipation, setStaffParticipation] = useState<StaffParticipationDashboardSummary[]>([]);
  const [cpdAttendance, setCpdAttendance] = useState<CpdAttendanceDashboardSummary[]>([]);
  const [livLifecycle, setLivLifecycle] = useState<LivLifecycleDashboardSummary[]>([]);
  const [learningWalkThemeGroups, setLearningWalkThemeGroups] = useState<LearningWalkThemeGroup[]>([]);
  const [selectedProcess, setSelectedProcess] = useState<DashboardProcessKey>("overview");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [facultyFilter, setFacultyFilter] = useState("all");
  const [teamFilter, setTeamFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dimensionFilter, setDimensionFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date_desc");
  const [detailPage, setDetailPage] = useState(1);
  const [actionDetailPage, setActionDetailPage] = useState(1);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [recordDetailExpanded, setRecordDetailExpanded] = useState(false);
  const [actionDetailExpanded, setActionDetailExpanded] = useState(false);
  const [intelligenceError, setIntelligenceError] = useState("");

  const canViewReports = user.permissions.includes("reports.view_all") || user.permissions.includes("reports.view_scoped");
  const canViewAll = user.permissions.includes("reports.view_all");

  useEffect(() => {
    if (!canViewReports) return;
    let cancelled = false;
    const safe = <T,>(request: Promise<T>, fallback: T) => request
      .then((value) => ({ value, failed: false }))
      .catch(() => ({ value: fallback, failed: true }));
    void (async () => {
      // Reporting queries are deliberately sequenced. Large academic-year datasets can
      // otherwise make several individually fast SQL queries contend and time out together.
      const configurationResult = await safe(api.dashboardConfiguration(), fallbackConfiguration);
      const factsResult = await safe(api.dashboardDimensions(academicYear), [] as DashboardDimensionFact[]);
      const eliFactsResult = await safe(api.eliStatementDashboardDimensions(academicYear), [] as DashboardDimensionFact[]);
      const elevateStatusResult = await safe(api.elevateStatusDashboard(academicYear), [] as ElevateStatusDashboardSummary[]);
      const participationResult = await safe(api.staffParticipationDashboard(academicYear), [] as StaffParticipationDashboardSummary[]);
      const attendanceResult = await safe(api.cpdAttendanceDashboard(academicYear), [] as CpdAttendanceDashboardSummary[]);
      const livResult = await safe(api.livLifecycleDashboard(academicYear), [] as LivLifecycleDashboardSummary[]);
      const themeResult = await safe(api.learningWalkThemes(), [] as LearningWalkThemeGroup[]);

        if (cancelled) return;
        setConfiguration(configurationResult.value);
        setFacts([...factsResult.value, ...eliFactsResult.value].filter((fact) => academicYearForDate(fact.occurredOn) === academicYear));
        setElevateStatus(elevateStatusResult.value);
        setStaffParticipation(participationResult.value);
        setCpdAttendance(attendanceResult.value);
        setLivLifecycle(livResult.value);
        setLearningWalkThemeGroups(themeResult.value);
        setIntelligenceError([configurationResult, factsResult, eliFactsResult, elevateStatusResult, participationResult, attendanceResult, livResult, themeResult].some((result) => result.failed)
          ? "Some detailed analysis is temporarily unavailable. Available reporting remains visible."
          : "");
    })();
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
  const organisationOptions = useMemo(() => collectDashboardOrgOptions(orgUnits, user), [orgUnits, user]);
  const selectedFaculty = organisationOptions.faculties.find((unit) => unit.id === facultyFilter);
  const teamOptions = organisationOptions.teams.filter((unit) => unit.facultyId === facultyFilter);
  const selectedTeam = teamOptions.find((unit) => unit.id === teamFilter);
  const reportableRecordIds = useMemo(() => new Set(processRecords.filter((record) => record.status.toLocaleLowerCase() !== "draft").map((record) => record.id)), [processRecords]);

  const dateAndAreaRecords = useMemo(() => processRecords.filter((record) => {
    const recordDate = getRecordDate(record);
    return record.status.toLocaleLowerCase() !== "draft"
      && (!startDate || recordDate >= startDate)
      && (!endDate || recordDate <= endDate)
      && recordMatchesOrganisation(record, selectedFaculty?.code, selectedTeam?.code, selectedTeam?.id);
  }), [endDate, processRecords, selectedFaculty?.code, selectedTeam?.code, selectedTeam?.id, startDate]);

  const dateAndAreaFacts = useMemo(() => facts.filter((fact) =>
    reportableRecordIds.has(fact.sourceRecordId)
    && (!startDate || fact.occurredOn >= startDate)
    && (!endDate || fact.occurredOn <= endDate)
    && matchesOrganisation(fact.areaCode, fact.parentAreaCode, fact.orgUnitId, selectedFaculty?.code, selectedTeam?.code, selectedTeam?.id)
  ), [endDate, facts, reportableRecordIds, selectedFaculty?.code, selectedTeam?.code, selectedTeam?.id, startDate]);

  const elevateStatusInScope = useMemo(() => elevateStatus.filter((row) =>
    matchesOrganisation(row.areaCode, row.parentAreaCode, row.orgUnitId, selectedFaculty?.code, selectedTeam?.code, selectedTeam?.id)
  ), [elevateStatus, selectedFaculty?.code, selectedTeam?.code, selectedTeam?.id]);
  const elevateStatusTotals = useMemo(() => aggregateElevateStatus(elevateStatusInScope), [elevateStatusInScope]);
  const staffParticipationInScope = useMemo(() => staffParticipation.filter((row) =>
    row.processKey === selectedProcess
    && matchesOrganisation(row.areaCode, row.parentAreaCode, row.orgUnitId, selectedFaculty?.code, selectedTeam?.code, selectedTeam?.id)
  ), [selectedFaculty?.code, selectedProcess, selectedTeam?.code, selectedTeam?.id, staffParticipation]);
  const staffParticipationTotals = useMemo(() => aggregateStaffParticipation(staffParticipationInScope), [staffParticipationInScope]);
  const cpdAttendanceInScope = useMemo(() => cpdAttendance.filter((row) =>
    matchesOrganisation(row.areaCode, row.parentAreaCode, row.orgUnitId, selectedFaculty?.code, selectedTeam?.code, selectedTeam?.id)
  ), [cpdAttendance, selectedFaculty?.code, selectedTeam?.code, selectedTeam?.id]);
  const livLifecycleInScope = useMemo(() => livLifecycle.filter((row) =>
    matchesOrganisation(row.areaCode, row.parentAreaCode, row.orgUnitId, selectedFaculty?.code, selectedTeam?.code, selectedTeam?.id)
  ), [livLifecycle, selectedFaculty?.code, selectedTeam?.code, selectedTeam?.id]);
  const livLifecycleTotals = useMemo(() => aggregateLivLifecycle(livLifecycleInScope), [livLifecycleInScope]);

  const processRecordsInScope = selectedProcess === "overview"
    ? dateAndAreaRecords
    : selectedProcess === "actions" ? [] : dateAndAreaRecords.filter((record) => record.processKey === selectedProcess);
  const processFactsInScope = selectedProcess === "overview"
    ? dateAndAreaFacts
    : dateAndAreaFacts.filter((fact) => fact.processKey === selectedProcess);
  const processActionsInScope = useMemo(() => actions.filter((action) => {
    const actionDate = (action.createdAt || action.dueDate || "").slice(0, 10);
    const matchesDate = (!startDate || actionDate >= startDate) && (!endDate || actionDate <= endDate);
    const matchesArea = !selectedFaculty
      || (selectedTeam ? action.teamCode === selectedTeam.code : action.facultyCode === selectedFaculty.code || action.teamCode === selectedFaculty.code);
    const matchesProcess = selectedProcess === "overview" || selectedProcess === "actions" || actionMatchesProcess(action, selectedProcess);
    return matchesDate && matchesArea && matchesProcess;
  }), [actions, endDate, selectedFaculty, selectedProcess, selectedTeam, startDate]);

  const statusOptions = useMemo(() => selectedProcess === "elevate_status" ? [] : selectedProcess === "actions"
    ? ["open", "overdue", "complete"]
    : uniqueValues(processRecordsInScope.map((record) => record.status)), [processRecordsInScope, selectedProcess]);
  const dimensionOptions = useMemo(() => ["elevate_status", "overview"].includes(selectedProcess) ? [] : uniqueValues([
    ...processFactsInScope.filter((fact) => fact.dimensionKey !== "practice_statement_outcome").map((fact) => fact.seriesLabel),
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

  const filteredFacts = useMemo(() => {
    if (dimensionFilter === "all") return processFactsInScope;
    const selectedEliAreaKeys = new Set(processFactsInScope.filter((fact) => fact.dimensionKey === "practice_area_outcome" && fact.seriesLabel === dimensionFilter).map((fact) => fact.seriesKey));
    return processFactsInScope.filter((fact) => fact.seriesLabel === dimensionFilter
      || (fact.dimensionKey === "practice_statement_outcome" && selectedEliAreaKeys.has(fact.seriesKey.split("::")[0])));
  }, [dimensionFilter, processFactsInScope]);

  const trendItems = selectedProcess === "actions"
    ? visibleActions.map((action) => ({ date: action.createdAt.slice(0, 10) }))
    : analysisRecords.map((record) => ({ date: getRecordDate(record) }));
  const trendGranularity = selectTrendGranularity(trendItems, startDate, endDate);
  const trendData = buildAdaptiveTrend(trendItems, trendGranularity, startDate, endDate);
  const processData = buildProcessBreakdown(dateAndAreaRecords, processActionsInScope);
  const openActions = analysisActions.filter((action) => !action.completedDate);
  const overdueActions = openActions.filter((action) => action.isOverdue);
  const detailCount = selectedProcess === "actions" ? visibleActions.length : visibleRecords.length;
  const detailTotalPages = Math.max(1, Math.ceil(detailCount / detailPageSize));
  const detailStart = (detailPage - 1) * detailPageSize;
  const detailActions = visibleActions.slice(detailStart, detailStart + detailPageSize);
  const detailRecords = visibleRecords.slice(detailStart, detailStart + detailPageSize);
  const actionDetailTotalPages = Math.max(1, Math.ceil(visibleActions.length / detailPageSize));
  const actionDetailActions = visibleActions.slice((actionDetailPage - 1) * detailPageSize, actionDetailPage * detailPageSize);

  useEffect(() => {
    setDetailPage((current) => Math.min(current, detailTotalPages));
  }, [detailTotalPages]);

  useEffect(() => {
    setActionDetailPage((current) => Math.min(current, actionDetailTotalPages));
  }, [actionDetailTotalPages]);

  useEffect(() => {
    setDetailPage(1);
    setActionDetailPage(1);
  }, [dimensionFilter, endDate, facultyFilter, searchTerm, selectedProcess, sortKey, startDate, statusFilter, teamFilter]);

  async function refresh() {
    setIsRefreshing(true);
    await onRefresh();
    const safe = <T,>(request: Promise<T>, fallback: T) => request
      .then((value) => ({ value, failed: false }))
      .catch(() => ({ value: fallback, failed: true }));
    const configurationResult = await safe(api.dashboardConfiguration(), configuration);
    const factsResult = await safe(api.dashboardDimensions(academicYear), [] as DashboardDimensionFact[]);
    const eliFactsResult = await safe(api.eliStatementDashboardDimensions(academicYear), [] as DashboardDimensionFact[]);
    const elevateStatusResult = await safe(api.elevateStatusDashboard(academicYear), elevateStatus);
    const participationResult = await safe(api.staffParticipationDashboard(academicYear), staffParticipation);
    const attendanceResult = await safe(api.cpdAttendanceDashboard(academicYear), cpdAttendance);
    const livResult = await safe(api.livLifecycleDashboard(academicYear), livLifecycle);
    const themeResult = await safe(api.learningWalkThemes(), learningWalkThemeGroups);

    setConfiguration(configurationResult.value);
    if (!factsResult.failed && !eliFactsResult.failed) {
      setFacts([...factsResult.value, ...eliFactsResult.value].filter((fact) => academicYearForDate(fact.occurredOn) === academicYear));
    }
    setElevateStatus(elevateStatusResult.value);
    setStaffParticipation(participationResult.value);
    setCpdAttendance(attendanceResult.value);
    setLivLifecycle(livResult.value);
    setLearningWalkThemeGroups(themeResult.value);
    setIntelligenceError([configurationResult, factsResult, eliFactsResult, elevateStatusResult, participationResult, attendanceResult, livResult, themeResult].some((result) => result.failed)
      ? "Some detailed analysis is temporarily unavailable. Available reporting remains visible."
      : "");
    setIsRefreshing(false);
  }

  function clearFilters() {
    setStartDate(""); setEndDate(""); setFacultyFilter("all"); setTeamFilter("all"); setStatusFilter("all");
    setDimensionFilter("all"); setSearchTerm(""); setSortKey("date_desc");
  }

  function selectProcess(processKey: DashboardProcessKey) {
    setSelectedProcess(processKey); setStatusFilter("all"); setDimensionFilter("all");
    setSearchTerm(""); setSortKey("date_desc");
    setRecordDetailExpanded(false); setActionDetailExpanded(false); setExportError("");
  }

  async function exportCurrentView() {
    if (selectedProcess === "elevate_status") {
      downloadCsv(`i-elevate-status-${academicYear.replace("/", "-")}.csv`, [
        ["Organisation area", "Staff in academic year", ...elevateLevelDefinitions.map((level) => `Level ${level.level} or above`)],
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
    const moduleKey = dashboardExportModuleKey(selectedProcess);
    if (!moduleKey) {
      downloadCsv(`i-elevate-${selectedProcess}-${academicYear.replace("/", "-")}.csv`, [
        ["Process", "Record", "Date", "Area", "Status", "Theme or focus", "Measure"],
        ...visibleRecords.map((record) => [getProcessDefinition(record.processKey).label, record.title, getRecordDate(record), formatArea(record), formatLabel(record.status), splitValues(record.theme).join(", "), formatRecordMeasure(record)])
      ]);
      return;
    }
    setIsExporting(true); setExportError("");
    const result = await api.exportExcel(moduleKey, {
      academicYear,
      facultyCode: selectedFaculty?.code,
      teamCode: selectedTeam?.code,
      fromDate: startDate || undefined,
      toDate: endDate || undefined,
      status: statusFilter === "all" ? undefined : statusFilter
    });
    setIsExporting(false);
    if (!result.ok) setExportError(result.message ?? "The full form export could not be created.");
  }

  function openOrganisationDetail(row: OrganisationPerformanceRow, detail: "records" | "actions") {
    const facultyCode = row.parentCode || row.code;
    const faculty = organisationOptions.faculties.find((option) => option.code === facultyCode);
    const team = row.parentCode ? organisationOptions.teams.find((option) => option.code === row.code && option.facultyId === faculty?.id) : undefined;
    setFacultyFilter(faculty?.id ?? "all");
    setTeamFilter(team?.id ?? "all");
    setStatusFilter("all"); setDimensionFilter("all"); setSearchTerm(""); setDetailPage(1); setActionDetailPage(1);
    if (detail === "records") setRecordDetailExpanded(true); else setActionDetailExpanded(true);
    window.setTimeout(() => document.getElementById(detail === "records" ? "dashboard-record-detail" : "dashboard-action-detail")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  }

  if (!canViewReports) {
    return <div className="route-stack"><div className="route-header"><div><p className="eyebrow">Leadership intelligence</p><h1>Dashboard</h1></div></div><section className="panel dashboard-access-panel"><AlertTriangle size={20} aria-hidden="true" /><div><h2>Reporting access is not assigned</h2><p>Your actions and staff profile remain available from the main navigation.</p></div></section></div>;
  }

  return (
    <div className="route-stack intelligence-dashboard">
      <header className="intelligence-header">
        <div>
          <p className="eyebrow">Leadership intelligence · {academicYear}</p>
          <h1>{canViewAll ? "Organisation data" : "Teaching and learning performance"}</h1>
          <p>Teaching and learning, professional development and delivery oversight across {canViewAll ? "the college" : formatScopeLabel(user)}.</p>
        </div>
        <div className="intelligence-header-actions">
          <span className="intelligence-data-state"><i />Permission-scoped live data</span>
          <Button disabled={isExporting} icon={Download} onClick={() => void exportCurrentView()} variant="secondary">{isExporting ? "Exporting forms" : "Export view"}</Button>
          <Button disabled={isRefreshing} icon={RefreshCw} onClick={() => void refresh()}>{isRefreshing ? "Refreshing" : "Refresh"}</Button>
        </div>
      </header>

      {intelligenceError ? <div className="intelligence-warning"><AlertTriangle size={16} />{intelligenceError}</div> : null}
      {exportError ? <div className="intelligence-warning"><AlertTriangle size={16} />{exportError}</div> : null}

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
        <div className="intelligence-filter-heading"><div><span>Current view</span><strong>{selectedConfiguration.label || selectedDefinition.label}</strong></div><small>{selectedProcess === "liv" ? "The LIV journey uses academic year and organisation area; record detail also uses date, status and focus filters" : isStaffCoverageProcess(selectedProcess) ? "Staff coverage uses academic year and organisation area; record visuals also use the remaining filters" : "All visuals and exports use these filters"}</small></div>
        <div className={`intelligence-filter-grid${selectedProcess === "overview" ? " intelligence-filter-grid-overview" : selectedProcess === "elevate_status" ? " intelligence-filter-grid-status" : ""}`}>
          {selectedProcess !== "elevate_status" ? <><label><span>From</span><input onChange={(event) => setStartDate(event.target.value)} type="date" value={startDate} /></label>
          <label><span>To</span><input onChange={(event) => setEndDate(event.target.value)} type="date" value={endDate} /></label></> : null}
          <label><span>Faculty</span><select onChange={(event) => { setFacultyFilter(event.target.value); setTeamFilter("all"); }} value={facultyFilter}><option value="all">All permitted faculties</option>{organisationOptions.faculties.map((faculty) => <option key={faculty.id} value={faculty.id}>{faculty.code} · {faculty.name}</option>)}</select></label>
          <label><span>Team</span><select disabled={facultyFilter === "all" || teamOptions.length === 0} onChange={(event) => setTeamFilter(event.target.value)} value={teamFilter}><option value="all">{facultyFilter === "all" ? "Select a faculty first" : teamOptions.length ? "All teams in faculty" : "No teams available"}</option>{teamOptions.map((team) => <option key={team.id} value={team.id}>{team.code} · {team.name}</option>)}</select></label>
          {!["elevate_status", "overview"].includes(selectedProcess) ? <><label><span>Status</span><select onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}><option value="all">All statuses</option>{statusOptions.map((status) => <option key={status} value={status}>{formatLabel(status)}</option>)}</select></label>
          <label><span>Theme, focus or area</span><select onChange={(event) => setDimensionFilter(event.target.value)} value={dimensionFilter}><option value="all">All recorded dimensions</option>{dimensionOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label></> : selectedProcess === "elevate_status" ? <div className="elevate-status-filter-note"><span>Measurement</span><strong>{academicYear} · at or above each level</strong></div> : null}
          <Button icon={RotateCcw} onClick={clearFilters} variant="secondary">Reset</Button>
        </div>
      </section>

      {selectedProcess === "overview" ? (
        <ExecutiveOverview
          actions={processActionsInScope}
          facts={dateAndAreaFacts}
          processData={processData}
          records={dateAndAreaRecords}
          trendData={trendData}
          trendGranularity={trendGranularity}
        />
      ) : selectedProcess === "elevate_status" ? (
        <ElevateStatusOverview academicYear={academicYear} configuration={selectedConfiguration} facultyNames={new Map(organisationOptions.faculties.map((faculty) => [faculty.code, faculty.name]))} rows={elevateStatusInScope} totals={elevateStatusTotals} />
      ) : (
        <ProcessOverview
          actions={analysisActions}
          cpdAttendance={cpdAttendanceInScope}
          configuration={selectedConfiguration}
          definition={selectedDefinition}
          facts={filteredFacts}
          livLifecycle={livLifecycleTotals}
          livLifecycleRows={livLifecycleInScope}
          learningWalkThemeGroups={learningWalkThemeGroups}
          organisationOptions={organisationOptions}
          onOpenOrganisationDetail={openOrganisationDetail}
          onOpenStaff={onOpenStaff}
          records={analysisRecords}
          staffParticipation={staffParticipationTotals.activeStaffCount ? staffParticipationTotals : undefined}
          staffParticipationRows={staffParticipationInScope}
          trendData={trendData}
          trendGranularity={trendGranularity}
        />
      )}

      {!["elevate_status", "overview"].includes(selectedProcess) ? <div id="dashboard-record-detail"><CollapsibleSection
        className="intelligence-record-panel"
        count={selectedProcess === "actions" ? visibleActions.length : visibleRecords.length}
        defaultExpanded={recordDetailExpanded}
        isEmpty={(selectedProcess === "actions" ? visibleActions.length : visibleRecords.length) === 0}
        emptyMessage={`No ${selectedDefinition.label.toLocaleLowerCase()} match the current filters.`}
        persistState={false}
        onExpandedChange={setRecordDetailExpanded}
        statusSummary={`${detailCount} matching · opens the source record`}
        storageKey={`leadership-dashboard-records-${selectedProcess}`}
        title={selectedProcess === "overview" ? "All teaching and learning records" : `${selectedDefinition.label} detail`}
      >
        <div className="dashboard-record-heading"><div className="dashboard-record-tools"><label className="search-box dashboard-record-search"><Search size={16} /><input aria-label="Search dashboard detail" onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search current view" value={searchTerm} /></label>{selectedProcess !== "actions" ? <label className="record-sort-field"><span>Sort by</span><select onChange={(event) => setSortKey(event.target.value as SortKey)} value={sortKey}><option value="date_desc">Newest first</option><option value="date_asc">Oldest first</option><option value="title">Title</option><option value="area">Area</option><option value="status">Status</option></select></label> : null}</div></div>
        {selectedProcess === "actions"
          ? <ActionDetailTable actions={detailActions} onOpenAction={onOpenAction} />
          : <RecordDetailTable onOpenRecord={onOpenRecord} records={detailRecords} />}
        <Pagination onPageChange={setDetailPage} page={detailPage} totalPages={detailTotalPages} />
      </CollapsibleSection></div> : null}
      {!["elevate_status", "overview", "actions"].includes(selectedProcess) ? <div id="dashboard-action-detail"><CollapsibleSection
        className="intelligence-record-panel"
        count={visibleActions.length}
        defaultExpanded={actionDetailExpanded}
        isEmpty={visibleActions.length === 0}
        emptyMessage={`No actions linked to ${selectedDefinition.label.toLocaleLowerCase()} match the current filters.`}
        persistState={false}
        onExpandedChange={setActionDetailExpanded}
        statusSummary={`${visibleActions.length} matching · opens the action record`}
        storageKey={`leadership-dashboard-actions-${selectedProcess}`}
        title={`${selectedDefinition.label} action detail`}
      >
        <ActionDetailTable actions={actionDetailActions} onOpenAction={onOpenAction} />
        <Pagination onPageChange={setActionDetailPage} page={actionDetailPage} totalPages={actionDetailTotalPages} />
      </CollapsibleSection></div> : null}
    </div>
  );
}

function ExecutiveOverview({ records, facts, actions, trendData, trendGranularity, processData }: {
  records: ProcessDashboardRecordSummary[]; facts: DashboardDimensionFact[]; actions: ActionSummary[];
  trendData: ChartDatum[]; trendGranularity: TrendGranularity; processData: ChartDatum[];
}) {
  const scoredRecords = records.filter((record) => record.scoreCount > 0);
  const totalRatings = scoredRecords.reduce((total, record) => total + record.scoreCount, 0);
  const averageScore = totalRatings > 0 ? scoredRecords.reduce((total, record) => total + record.scoreTotal, 0) / totalRatings : 0;
  const actionPosition = buildActionPosition(actions);
  const teams = new Set(records.filter((record) => record.areaCode && record.parentAreaCode && record.areaCode !== record.parentAreaCode).map((record) => record.areaCode)).size;
  const peopleReached = records.reduce((total, record) => total + (record.processKey === "cpd_event" ? record.participantCount : record.subjectDisplayName ? 1 : 0), 0);
  const topFocus = buildFocusFrequency(facts)[0];

  return <>
    <section className="intelligence-briefing panel">
      <div><span className="intelligence-section-label"><ShieldCheck size={15} />Executive briefing</span><h2>{records.length ? `${records.length} teaching and learning records.` : "No teaching and learning records have been recorded for this view yet."}</h2><p>{teams} teams represented · {peopleReached} staff interactions or CPD attendances · {actionPosition.inProgress} actions in progress.</p></div>
      <div className="intelligence-briefing-signal"><span>Most visible focus</span><strong>{topFocus?.label ?? "Insufficient data"}</strong><small>{topFocus ? `${topFocus.value} recorded instances` : "Focus data will appear as forms are completed"}</small></div>
    </section>
    <div className="intelligence-kpi-grid">
      <MetricCard label="Recorded activity" value={records.length} detail={`${processData.filter((item) => item.value > 0).length} active processes`} tone="teal" />
      <MetricCard label="Teams represented" value={teams} detail="Across the permitted scope" tone="blue" />
      <MetricCard label="Average outcome across all processes" value={averageScore ? averageScore.toFixed(1) : "—"} detail={averageScore ? "Five-point comparable scale" : "Awaiting scored activity"} tone="violet" />
      <MetricCard label="Action completion" value={actionPosition.total ? `${actionPosition.completionRate}%` : "—"} detail={`${actionPosition.inProgress} in progress · ${actionPosition.overdue} overdue`} tone={actionPosition.overdue ? "amber" : "green"} />
    </div>
    <div className="intelligence-chart-grid intelligence-chart-grid-wide intelligence-executive-grid">
      <TrendChart title="Activity trajectory" subtitle={`${formatTrendGranularity(trendGranularity)} completed and in-progress records`} data={trendData} />
      <SummaryList title="Process mix" subtitle="All teaching and learning processes in the current view" data={processData} />
    </div>
    <div className="intelligence-executive-assurance"><ActionRecords actions={actions} /></div>
  </>;
}

function ElevateStatusOverview({ academicYear, configuration, rows, totals, facultyNames }: {
  academicYear: string;
  configuration: DashboardProcessConfiguration;
  rows: ElevateStatusDashboardSummary[];
  totals: ElevateStatusTotals;
  facultyNames: Map<string, string>;
}) {
  const anyStatus = totals.levelCounts[0] ?? 0;
  const highestLevel = [...elevateLevelDefinitions].reverse().find((level) => (totals.levelCounts[level.level - 1] ?? 0) > 0);
  return <>
    <section className="intelligence-briefing panel elevate-status-briefing">
      <div>
        <span className="intelligence-section-label"><Award size={15} />Cumulative attainment</span>
        <h2>{totals.staffCount ? `${anyStatus} of ${totals.staffCount} staff employed in the academic year have achieved Elevate Status.` : "No staff are in the selected academic year and organisation scope."}</h2>
        <p>Each level includes staff at that level and every higher level. Percentages use staff employed during the selected academic year in the permitted organisation area as the denominator.</p>
      </div>
      <div className="intelligence-briefing-signal"><span>Highest represented level</span><strong>{highestLevel?.name ?? "No awards recorded"}</strong><small>{academicYear} academic year</small></div>
    </section>
    <div className="intelligence-kpi-grid">
      <MetricCard label="Staff in academic year" value={totals.staffCount} detail="Permission and organisation filtered" tone="teal" />
      <MetricCard label="Status participation" value={totals.staffCount ? `${percentage(anyStatus, totals.staffCount)}%` : "—"} detail={`${anyStatus} staff at Level 1 or above`} tone="blue" />
      <MetricCard label="Innovators or above" value={totals.staffCount ? `${percentage(totals.levelCounts[2] ?? 0, totals.staffCount)}%` : "—"} detail={`${totals.levelCounts[2] ?? 0} staff at Level 3 or above`} tone="violet" />
      <MetricCard label="Champions or above" value={totals.staffCount ? `${percentage(totals.levelCounts[3] ?? 0, totals.staffCount)}%` : "—"} detail={`${totals.levelCounts[3] ?? 0} staff at Level 4 or above`} tone="amber" />
    </div>
    {configuration.showOutcomes ? <section className="panel intelligence-chart-card elevate-status-attainment-card">
      <div className="intelligence-card-heading"><div><h3>Attainment by level</h3><span>At or above each threshold · count and percentage of staff in the academic year</span></div><BarChart3 size={18} /></div>
      {totals.staffCount ? <div className="elevate-attainment-grid">
        {elevateLevelDefinitions.map((level) => {
          const count = totals.levelCounts[level.level - 1] ?? 0;
          const value = percentage(count, totals.staffCount);
          return <article key={level.level}>
            <img alt="" aria-hidden="true" src={`/system-assets/elevate-status/${level.key}.png`} />
            <div className="elevate-attainment-heading"><span>Level {level.level}</span><strong>{level.name}</strong><small>{level.sessions} sessions required</small></div>
            <div className="elevate-attainment-value"><strong>{value}%</strong><span>{count} of {totals.staffCount} staff in year</span></div>
            <div className="elevate-attainment-track" aria-label={`${level.name}: ${value}%, ${count} of ${totals.staffCount} staff`} role="img"><i style={{ width: `${value}%` }} /></div>
          </article>;
        })}
      </div> : <EmptyChart message="No staff are available for this academic year and organisation scope." />}
    </section> : null}
    {configuration.showAreaComparison ? <ElevateStatusOrganisationView facultyNames={facultyNames} rows={rows} /> : null}
  </>;
}

function ElevateStatusOrganisationView({ rows, facultyNames }: { rows: ElevateStatusDashboardSummary[]; facultyNames: Map<string, string> }) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const groups = groupElevateStatusRows(rows, facultyNames).filter((group) => !normalizedQuery
    || [group.code, group.name, ...group.rows.flatMap((row) => [row.areaCode, row.areaName])].some((value) => value?.toLocaleLowerCase().includes(normalizedQuery)));
  return <section className="panel organisation-performance-card elevate-status-organisation-card">
    <div className="organisation-performance-heading"><div className="intelligence-card-heading"><div><h3>Faculty and team view</h3><span>Faculties expand to show cumulative Elevate Status attainment for each team</span></div><Building2 size={18} /></div><label className="search-box organisation-performance-search"><Search size={15} /><input aria-label="Filter Elevate Status faculty and team results" onChange={(event) => setQuery(event.target.value)} placeholder="Find a faculty or team" value={query} /></label></div>
    <p className="organisation-performance-note">Every percentage uses staff employed in the academic year within that faculty or team. Higher levels remain included in each lower-level threshold.</p>
    {groups.length ? <div className="organisation-performance-groups elevate-status-organisation-groups">{groups.map((group) => <details key={group.code} open={normalizedQuery ? true : undefined}><summary><ElevateStatusOrganisationLine isFaculty name={group.name} row={group.total} /></summary><div className="organisation-team-list">{group.rows.filter((row) => row.areaCode !== group.code && row.parentAreaCode && row.parentAreaCode !== row.areaCode).map((row) => <ElevateStatusOrganisationLine key={row.orgUnitId ?? row.areaCode} name={row.areaName ?? row.areaCode ?? "Unassigned"} row={row} />)}</div></details>)}</div> : <EmptyChart message="No faculty or team data match this view." />}
  </section>;
}

function ElevateStatusOrganisationLine({ row, name, isFaculty = false }: { row: ElevateStatusDashboardSummary; name: string; isFaculty?: boolean }) {
  return <div className={`elevate-status-organisation-line${isFaculty ? " is-faculty" : ""}`}><div><strong>{name}</strong><span>{row.areaCode ?? "No organisation code"}</span></div><div><strong>{row.staffCount}</strong><span>staff in year</span></div><div className="elevate-status-organisation-levels">{elevateLevelDefinitions.map((level) => { const count = elevateStatusLevelCount(row, level.level); return <span key={level.level}><small>L{level.level}+</small><strong>{percentage(count, row.staffCount)}%</strong><i>{count} staff</i></span>; })}</div></div>;
}

function ProcessOverview({ definition, configuration, records, actions, cpdAttendance, trendData, trendGranularity, facts, staffParticipation, staffParticipationRows, livLifecycle, livLifecycleRows, learningWalkThemeGroups, organisationOptions, onOpenOrganisationDetail, onOpenStaff }: {
  definition: ProcessDefinition;
  configuration: DashboardProcessConfiguration;
  records: ProcessDashboardRecordSummary[];
  actions: ActionSummary[];
  cpdAttendance: CpdAttendanceDashboardSummary[];
  trendData: ChartDatum[];
  trendGranularity: TrendGranularity;
  facts: DashboardDimensionFact[];
  staffParticipation?: StaffParticipationTotals;
  staffParticipationRows: StaffParticipationDashboardSummary[];
  livLifecycle: LivLifecycleTotals;
  livLifecycleRows: LivLifecycleDashboardSummary[];
  learningWalkThemeGroups: LearningWalkThemeGroup[];
  organisationOptions: { faculties: DashboardOrgOption[]; teams: DashboardOrgOption[] };
  onOpenOrganisationDetail: (row: OrganisationPerformanceRow, detail: "records" | "actions") => void;
  onOpenStaff: (staffId: string) => void;
}) {
  const outcomeRows = buildOutcomeRows(facts.filter((fact) => fact.dimensionKey !== "practice_statement_outcome"));
  const outcomeGroups = definition.key === "learning_walk" ? buildLearningWalkOutcomeGroups(facts, learningWalkThemeGroups) : [];
  const eliOutcomeGroups = definition.key === "eli" ? buildEliOutcomeGroups(facts) : [];
  const hasOutcomeVisual = definition.key === "learning_walk" ? outcomeGroups.length > 0 : definition.key === "eli" ? eliOutcomeGroups.length > 0 : outcomeRows.length > 0;
  const frequencyRows = buildFrequencyRows(facts, records, actions);
  const organisationRows = buildOrganisationPerformanceRows(records, facts, actions, staffParticipationRows, livLifecycleRows);
  const metrics = buildProcessMetrics(definition.key, records, facts, actions, staffParticipation, livLifecycle);
  const briefing = buildProcessBriefing(definition.key, records, facts, actions, livLifecycle);

  return <>
    <div className="intelligence-section-title"><div><span>{definition.shortLabel}</span><h2>Teaching and learning position</h2></div><p>Every measure below is calculated from existing structured form data. Narrative notes are not scored.</p></div>
    <section className="intelligence-briefing panel intelligence-process-briefing">
      <div><span className="intelligence-section-label"><ShieldCheck size={15} />{definition.key === "liv" ? "Completed LIVs" : "Leadership reading"}</span><h2>{briefing.headline}</h2><p>{briefing.detail}</p></div>
      <div className="intelligence-briefing-signal"><span>{briefing.signalLabel}</span><strong>{briefing.signalValue}</strong><small>{briefing.signalDetail}</small></div>
    </section>
    <div className="intelligence-kpi-grid">
      {metrics.map((metric) => <MetricCard detail={metric.detail} key={metric.label} label={metric.label} tone={metric.tone} value={metric.value} />)}
    </div>
    {definition.key === "liv" ? <LivLifecyclePanel totals={livLifecycle} /> : null}
    <div className={`intelligence-chart-grid${configuration.showTrend && hasOutcomeVisual && !frequencyRows.length && !configuration.showActions ? " intelligence-chart-grid-solo-trend" : ""}`}>
      {configuration.showTrend ? <TrendChart title="Activity over time" subtitle={`${formatTrendGranularity(trendGranularity)} records in the current filtered view`} data={trendData} /> : null}
      {configuration.showOutcomes && definition.key === "learning_walk" && outcomeGroups.length ? <OutcomeDrilldown groups={outcomeGroups} /> : null}
      {configuration.showOutcomes && definition.key === "eli" && eliOutcomeGroups.length ? <OutcomeDrilldown childLabel="Statement" groups={eliOutcomeGroups} subtitle="Practice-area position first; expand an area to see the statement answers that produce its score" title="Practice outcome matrix" /> : null}
      {configuration.showOutcomes && !["learning_walk", "eli"].includes(definition.key) && outcomeRows.length ? <OutcomeMatrix rows={outcomeRows} /> : null}
      {configuration.showOutcomes && frequencyRows.length ? <FrequencyProfile processKey={definition.key} records={records.length} rows={frequencyRows} /> : null}
      {configuration.showActions ? <ActionRecords actions={actions} /> : null}
    </div>
    {definition.key === "cpd_event" ? <CpdAttendanceRankings attendance={cpdAttendance} facultyNames={new Map(organisationOptions.faculties.map((faculty) => [faculty.code, faculty.name]))} onOpenStaff={onOpenStaff} participation={staffParticipationRows} /> : null}
    {configuration.showAreaComparison ? <OrganisationPerformance facultyNames={new Map(organisationOptions.faculties.map((faculty) => [faculty.code, faculty.name]))} onOpenDetail={onOpenOrganisationDetail} processKey={definition.key} rows={organisationRows} /> : null}
  </>;
}

function LegacyProcessOverview({ definition, configuration, records, actions, trendData, areaData, outcomeData, dimensionData, staffParticipation, staffParticipationAreaData }: {
  definition: ProcessDefinition; configuration: DashboardProcessConfiguration; records: ProcessDashboardRecordSummary[];
  actions: ActionSummary[]; trendData: ChartDatum[]; areaData: ChartDatum[]; outcomeData: ChartDatum[]; dimensionData: ChartDatum[];
  staffParticipation?: StaffParticipationTotals; staffParticipationAreaData: ChartDatum[];
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
    <div className="intelligence-section-title"><div><span>{definition.shortLabel}</span><h2>Performance and outcomes</h2></div><p>Structured answers are aggregated; narrative notes are excluded from dashboard analysis.</p></div>
    <div className="intelligence-kpi-grid">
      <MetricCard label="Records in view" value={definition.key === "actions" ? actions.length : records.length} detail={`${areas} organisation areas`} tone="teal" />
      {staffParticipation ? <MetricCard label={staffCoverageLabel(definition.key)} value={`${percentage(staffParticipation.participatingStaffCount, staffParticipation.activeStaffCount)}%`} detail={`${staffParticipation.participatingStaffCount} of ${staffParticipation.activeStaffCount} active staff`} tone="green" />
        : <MetricCard label="Completed" value={completedItems} detail={totalItems ? `${Math.round((completedItems / totalItems) * 100)}% of ${definition.key === "actions" ? "actions" : "records"}` : "No records in view"} tone="green" />}
      <MetricCard label="Average outcome" value={average ? average.toFixed(1) : "—"} detail={average ? "Five-point comparable scale" : "No scored outcomes"} tone="violet" />
      <MetricCard label="Open actions" value={open.length} detail={`${open.filter((action) => action.isOverdue).length} overdue`} tone={open.some((action) => action.isOverdue) ? "amber" : "blue"} />
    </div>
    <div className="intelligence-chart-grid">
      {configuration.showTrend ? <TrendChart title="Activity over time" subtitle="Monthly records in the current view" data={trendData} /> : null}
      {configuration.showAreaComparison ? staffParticipation
        ? <PercentageBars title="Staff coverage by organisation" subtitle={`${staffCoverageLabel(definition.key)} as a percentage of active staff`} data={staffParticipationAreaData} />
        : <RankedBars title="Organisation comparison" subtitle="Volume by organisation area" data={areaData} /> : null}
      {configuration.showOutcomes ? configuration.primaryVisual === "donut"
        ? <DonutChart title="Recorded outcomes" subtitle="Distribution of configured responses" data={outcomeData.length ? outcomeData : dimensionData} />
        : <OutcomeProfile data={dimensionData} /> : null}
      {configuration.showActions ? <ActionRecords actions={actions} /> : null}
    </div>
  </>;
}

function LivLifecyclePanel({ totals }: { totals: LivLifecycleTotals }) {
  const steps = [
    { label: "LIV requested", value: totals.requestedCount, detail: "ELI requests and planned Probation Observation 2 LIVs" },
    { label: "Case started", value: totals.caseStartedCount, detail: "A LIV case has been opened" },
    { label: "Visit date recorded", value: totals.scheduledCount, detail: "The visit form contains a date" },
    { label: "Visit completed", value: totals.visitedCount, detail: `${totals.completedVisitCount} completed visit form${totals.completedVisitCount === 1 ? "" : "s"}` },
    { label: "LIV closed", value: totals.completedCount, detail: "The LIV case is complete" }
  ];
  return <section className="panel liv-lifecycle-panel">
    <div className="intelligence-card-heading"><div><h3>LIV journey</h3><span>ELI requests and Probation Observation 2 are tracked through the shared LIV workflow</span></div><Target size={18} /></div>
    <div className="liv-lifecycle-grid">{steps.map((step, index) => <article key={step.label}><span>{index + 1}</span><strong>{step.value}</strong><b>{step.label}</b><small>{step.detail}</small></article>)}</div>
    <p className="intelligence-definition-note"><strong>Reporting definition:</strong> Probation Observation 2 is counted in both Probationary Observations and LIV because it is a dual process. “Visit completed” only counts a LIV visit saved as completed, so opening a case or drafting a visit does not inflate delivery.</p>
  </section>;
}

function OutcomeMatrix({ rows }: { rows: OutcomeRow[] }) {
  return <section className="panel intelligence-chart-card intelligence-outcome-matrix-card">
    <div className="intelligence-card-heading"><div><h3>Practice outcome matrix</h3><span>All configured areas with response volume, distribution and Secure practice or above</span></div><Target size={18} /></div>
    <div className="outcome-scale-legend" aria-label="Outcome scale"><span>1 Emerging</span><span>2 Developing</span><span>3 Secure</span><span>4 Strong</span><span>5 Exceptional</span></div>
    <div className="table-scroll"><table className="outcome-matrix-table"><thead><tr><th>Area</th><th>Rated</th><th>Outcome distribution</th><th>Secure+</th><th>Mean</th></tr></thead><tbody>{rows.map((row) => <tr key={row.label}><td><strong>{row.label}</strong></td><td>{row.responseCount}</td><td><div className="outcome-distribution" aria-label={`${row.label}: ${row.distribution.map((count, index) => `${count} at level ${index + 1}`).join(", ")}`} role="img">{row.distribution.map((count, index) => <i className={`outcome-level-${index + 1}`} key={index} style={{ width: `${row.responseCount ? (count / row.responseCount) * 100 : 0}%` }} title={`Level ${index + 1}: ${count}`} />)}</div></td><td><strong>{percentage(row.secureOrAboveCount, row.responseCount)}%</strong><span>{row.secureOrAboveCount} of {row.responseCount}</span></td><td><strong>{row.average.toFixed(1)}</strong><span>of 5</span></td></tr>)}</tbody></table></div>
  </section>;
}

function OutcomeDrilldown({ groups, title = "Practice outcomes", subtitle = "Theme-area position first; expand an area to see the ranking for each underlying focus", childLabel = "Focus area" }: { groups: OutcomeGroup[]; title?: string; subtitle?: string; childLabel?: string }) {
  const childNoun = childLabel === "Statement" ? "statement" : "focus area";
  return <section className="panel intelligence-chart-card intelligence-outcome-matrix-card outcome-drilldown-card">
    <div className="intelligence-card-heading"><div><h3>{title}</h3><span>{subtitle}</span></div><Target size={18} /></div>
    <div className="outcome-scale-legend" aria-label="Outcome scale"><span>1 Emerging</span><span>2 Developing</span><span>3 Secure</span><span>4 Strong</span><span>5 Exceptional</span></div>
    <div className="outcome-drilldown-header" aria-hidden="true"><span>Theme area</span><span>Rated</span><span>Outcome distribution</span><span>Secure+</span><span>Mean</span></div>
    <div className="outcome-drilldown-groups">
      {groups.map((group) => <details key={group.key}>
        <summary>
          <div className="outcome-drilldown-title"><ChevronDown aria-hidden="true" size={17} /><span><strong>{group.label}</strong><small>{group.children.length} {childNoun}{group.children.length === 1 ? "" : "s"} · select to drill down</small></span></div>
          <strong>{group.summary.responseCount}</strong>
          <OutcomeDistribution row={group.summary} />
          <span className="outcome-drilldown-metric"><strong>{group.summary.responseCount ? `${percentage(group.summary.secureOrAboveCount, group.summary.responseCount)}%` : "—"}</strong><small>{group.summary.responseCount ? `${group.summary.secureOrAboveCount} of ${group.summary.responseCount}` : "No ratings"}</small></span>
          <span className="outcome-drilldown-metric"><strong>{group.summary.responseCount ? group.summary.average.toFixed(1) : "—"}</strong><small>{group.summary.responseCount ? "of 5" : "No ratings"}</small></span>
        </summary>
        <div className="table-scroll"><table className="outcome-matrix-table outcome-drilldown-table"><thead><tr><th>{childLabel}</th><th>Rated</th><th>Outcome distribution</th><th>Secure+</th><th>Mean</th></tr></thead><tbody>{group.children.map((row, index) => <tr className={row.responseCount ? "" : "is-unrated"} key={row.label}><td><span className="outcome-rank">{row.responseCount ? index + 1 : "—"}</span><strong>{row.label}</strong></td><td>{row.responseCount || "—"}</td><td>{row.responseCount ? <OutcomeDistribution row={row} /> : <span>No ratings in this view</span>}</td><td><strong>{row.responseCount ? `${percentage(row.secureOrAboveCount, row.responseCount)}%` : "—"}</strong><span>{row.responseCount ? `${row.secureOrAboveCount} of ${row.responseCount}` : "No ratings"}</span></td><td><strong>{row.responseCount ? row.average.toFixed(1) : "—"}</strong><span>{row.responseCount ? "of 5" : "No ratings"}</span></td></tr>)}</tbody></table></div>
      </details>)}
    </div>
  </section>;
}

function OutcomeDistribution({ row }: { row: OutcomeRow }) {
  return <div className="outcome-distribution" aria-label={`${row.label}: ${row.distribution.map((count, index) => `${count} at level ${index + 1}`).join(", ")}`} role="img">{row.distribution.map((count, index) => <i className={`outcome-level-${index + 1}`} key={index} style={{ width: `${row.responseCount ? (count / row.responseCount) * 100 : 0}%` }} title={`Level ${index + 1}: ${count}`} />)}</div>;
}

function FrequencyProfile({ rows, records, processKey }: { rows: FrequencyRow[]; records: number; processKey: DashboardProcessKey }) {
  const copy = frequencyProfileCopy(processKey);
  return <section className="panel intelligence-chart-card intelligence-frequency-card">
    <div className="intelligence-card-heading"><div><h3>{copy.title}</h3><span>{copy.subtitle}</span></div><ClipboardCheck size={18} /></div>
    <div className="frequency-profile-list">{rows.map((row) => <div key={row.label}><span><strong>{row.label}</strong><small>{records ? `${percentage(row.recordCount, records)}% of records` : "No record denominator"}</small></span><b>{row.recordCount}</b></div>)}</div>
  </section>;
}

function CpdAttendanceRankings({ attendance, participation, facultyNames, onOpenStaff }: {
  attendance: CpdAttendanceDashboardSummary[];
  participation: StaffParticipationDashboardSummary[];
  facultyNames: Map<string, string>;
  onOpenStaff: (staffId: string) => void;
}) {
  const individuals = [...attendance].sort((left, right) => right.attendanceCount - left.attendanceCount || left.staffName.localeCompare(right.staffName)).slice(0, 5);
  const facultyMap = new Map<string, { name: string; attendances: number; staff: number }>();
  for (const row of participation) {
    const code = row.parentAreaCode || row.areaCode || "Unassigned";
    const current = facultyMap.get(code) ?? { name: facultyNames.get(code) ?? row.areaName ?? code, attendances: 0, staff: 0 };
    current.staff += row.activeStaffCount; facultyMap.set(code, current);
  }
  for (const row of attendance) {
    const code = row.parentAreaCode || row.areaCode || "Unassigned";
    const current = facultyMap.get(code) ?? { name: facultyNames.get(code) ?? row.areaName ?? code, attendances: 0, staff: 0 };
    current.attendances += row.attendanceCount; facultyMap.set(code, current);
  }
  const faculties = [...facultyMap.entries()].filter(([code, value]) => code !== "Unassigned" && facultyNames.has(code) && value.staff > 0 && value.attendances > 0)
    .map(([code, value]) => ({ code, ...value, average: value.attendances / value.staff }))
    .sort((left, right) => right.average - left.average || right.attendances - left.attendances || left.name.localeCompare(right.name)).slice(0, 5);
  return <div className="cpd-ranking-grid">
    <section className="panel intelligence-chart-card cpd-ranking-card">
      <div className="intelligence-card-heading"><div><h3>Top five CPD attenders</h3><span>Individual attended-session counts in the current organisation scope</span></div><UsersRound size={18} /></div>
      {individuals.length ? <ol>{individuals.map((row, index) => <li key={row.staffId}><span>{index + 1}</span><a href={staffPath(row.staffId)} onClick={(event) => { event.preventDefault(); onOpenStaff(row.staffId); }}><strong>{row.staffName}</strong><small>{row.parentAreaCode && row.areaCode && row.parentAreaCode !== row.areaCode ? `${row.parentAreaCode} / ${row.areaCode}` : row.areaCode ?? "Unassigned"}</small></a><b>{row.attendanceCount}<small>sessions</small></b></li>)}</ol> : <EmptyChart message="No attended CPD sessions are available in this view." />}
    </section>
    <section className="panel intelligence-chart-card cpd-ranking-card">
      <div className="intelligence-card-heading"><div><h3>Top five faculties by attendance</h3><span>Attendances per staff member, using staff registered to each faculty as the denominator</span></div><Building2 size={18} /></div>
      {faculties.length ? <ol>{faculties.map((row, index) => <li key={row.code}><span>{index + 1}</span><div><strong>{row.name}</strong><small>{row.attendances} attendances across {row.staff} staff</small></div><b>{row.average.toFixed(1)}<small>per person</small></b></li>)}</ol> : <EmptyChart message="No faculty attendance rates are available in this view." />}
    </section>
  </div>;
}

function OrganisationPerformance({ processKey, rows, facultyNames, onOpenDetail }: { processKey: DashboardProcessKey; rows: OrganisationPerformanceRow[]; facultyNames: Map<string, string>; onOpenDetail: (row: OrganisationPerformanceRow, detail: "records" | "actions") => void }) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredRows = rows.filter((row) => !normalizedQuery || [row.code, row.name, row.parentCode].some((value) => value?.toLocaleLowerCase().includes(normalizedQuery)));
  const groups = groupOrganisationPerformanceRows(filteredRows, facultyNames);
  return <section className="panel organisation-performance-card">
    <div className="organisation-performance-heading"><div className="intelligence-card-heading"><div><h3>Faculty and team view</h3><span>Faculties expand to the complete team picture; no areas are silently omitted</span></div><Building2 size={18} /></div><label className="search-box organisation-performance-search"><Search size={15} /><input aria-label="Filter faculty and team results" onChange={(event) => setQuery(event.target.value)} placeholder="Find a faculty or team" value={query} /></label></div>
    <p className="organisation-performance-note">Record measures use the organisation saved on each record. Staff denominators use employment dates for the selected year and the staff member’s current primary organisation assignment.</p>
    {groups.length ? <div className="organisation-performance-groups">{groups.map((group) => <details key={group.code} open={normalizedQuery ? true : undefined}><summary><OrganisationPerformanceLine isFaculty onOpenDetail={onOpenDetail} processKey={processKey} row={group.total} /></summary><div className="organisation-team-list">{group.rows.filter((row) => row.code !== group.code || row.parentCode).map((row) => <OrganisationPerformanceLine key={`${group.code}-${row.code}`} onOpenDetail={onOpenDetail} processKey={processKey} row={row} />)}</div></details>)}</div> : <EmptyChart message="No organisation data match the current filters." />}
  </section>;
}

function OrganisationPerformanceLine({ processKey, row, onOpenDetail, isFaculty = false }: { processKey: DashboardProcessKey; row: OrganisationPerformanceRow; onOpenDetail: (row: OrganisationPerformanceRow, detail: "records" | "actions") => void; isFaculty?: boolean }) {
  const coverageAvailable = row.activeStaffCount > 0;
  const outcomeAvailable = row.ratingCount > 0;
  const activityValue = processKey === "liv"
    ? `${row.livVisitedCount} / ${row.livRequestedCount}`
    : coverageAvailable ? `${percentage(row.participatingStaffCount, row.activeStaffCount)}%` : String(row.recordCount);
  const activityDetail = processKey === "liv"
    ? "requests visited"
    : coverageAvailable ? `${row.participatingStaffCount} of ${row.activeStaffCount} staff` : `${row.recordCount === 1 ? "record" : "records"} in view`;
  const outcomeValue = outcomeAvailable ? `${percentage(row.secureOrAboveCount, row.ratingCount)}%` : row.recordCount ? `${percentage(row.completedCount, row.recordCount)}%` : "—";
  const outcomeDetail = outcomeAvailable ? `${row.secureOrAboveCount} of ${row.ratingCount} ratings Secure+` : row.recordCount ? `${row.completedCount} completed record${row.completedCount === 1 ? "" : "s"}` : "No outcome data";
  return <div className={`organisation-performance-line${isFaculty ? " is-faculty" : ""}`}><div><strong>{row.name}</strong><span>{row.code}{row.parentCode ? ` · ${row.parentCode}` : ""}</span></div><div><strong>{activityValue}</strong><span>{activityDetail}</span>{row.recordCount ? <button className="organisation-detail-link" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onOpenDetail(row, "records"); }} type="button">View {row.recordCount} detailed record{row.recordCount === 1 ? "" : "s"}<ArrowUpRight size={13} /></button> : null}</div><div><strong>{outcomeValue}</strong><span>{outcomeDetail}</span></div><div className={row.overdueActionCount ? "is-risk" : ""}>{row.openActionCount ? <button className="organisation-detail-link organisation-action-link" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onOpenDetail(row, "actions"); }} type="button"><strong>{row.openActionCount}</strong><span>open action{row.openActionCount === 1 ? "" : "s"}</span><ArrowUpRight size={13} /></button> : <><strong>0</strong><span>open actions</span></>}<small>{row.overdueActionCount} overdue</small></div></div>;
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

function SummaryList({ title, subtitle, data }: { title: string; subtitle: string; data: ChartDatum[] }) {
  return <section className="panel intelligence-chart-card"><div className="intelligence-card-heading"><div><h3>{title}</h3><span>{subtitle}</span></div><BarChart3 size={18} /></div>{data.length ? <div className="intelligence-summary-list">{data.map((item) => <div key={item.label}><span>{item.label}</span><strong>{item.value}</strong></div>)}</div> : <EmptyChart />}</section>;
}

function RankedBars({ title, subtitle, data }: { title: string; subtitle: string; data: ChartDatum[] }) {
  const visible = data; const max = Math.max(...visible.map((item) => item.value), 1);
  return <section className="panel intelligence-chart-card"><div className="intelligence-card-heading"><div><h3>{title}</h3><span>{subtitle}</span></div><BarChart3 size={18} /></div>{visible.length ? <div className="intelligence-ranked-bars">{visible.map((item) => <div key={item.label}><span title={item.label}>{item.label}</span><div><i style={{ width: `${Math.max(4, (item.value / max) * 100)}%` }}/></div><strong>{item.value}</strong></div>)}</div> : <EmptyChart />}</section>;
}

function PercentageBars({ title, subtitle, data }: { title: string; subtitle: string; data: ChartDatum[] }) {
  const visible = data;
  return <section className="panel intelligence-chart-card"><div className="intelligence-card-heading"><div><h3>{title}</h3><span>{subtitle}</span></div><UsersRound size={18} /></div>{visible.length ? <div className="intelligence-percentage-bars">{visible.map((item) => <div key={item.label}><span><strong title={item.label}>{item.label}</strong><small>{item.secondary}</small></span><div><i style={{ width: `${item.value}%` }} /></div><b>{item.value}%</b></div>)}</div> : <EmptyChart message="No active staff are available for this organisation scope." />}</section>;
}

function OutcomeProfile({ data }: { data: ChartDatum[] }) {
  const visible = data;
  return <section className="panel intelligence-chart-card"><div className="intelligence-card-heading"><div><h3>Focus and outcome profile</h3><span>Average score by configured focus, pillar or practice area</span></div><Target size={18} /></div>{visible.length ? <div className="intelligence-outcome-list">{visible.map((item) => <div key={item.label}><div><strong>{item.label}</strong><span>{item.secondary}</span></div><div className="intelligence-five-scale"><i style={{ width: `${Math.max(3, (item.value / 5) * 100)}%` }}/></div><b>{item.value.toFixed(1)}</b></div>)}</div> : <EmptyChart message="No structured outcome data in this view." />}</section>;
}

function DonutChart({ title, subtitle, data }: { title: string; subtitle: string; data: ChartDatum[] }) {
  const visible = data; const total = visible.reduce((sum, item) => sum + item.value, 0);
  let cursor = 0;
  const gradient = visible.length ? visible.map((item, index) => { const start = cursor; cursor += (item.value / total) * 100; return `var(--chart-${(index % 6) + 1}) ${start}% ${cursor}%`; }).join(",") : "var(--panel-border) 0 100%";
  return <section className="panel intelligence-chart-card"><div className="intelligence-card-heading"><div><h3>{title}</h3><span>{subtitle}</span></div><Target size={18} /></div>{visible.length ? <div className="intelligence-donut-layout"><div className="intelligence-donut" style={{ background: `conic-gradient(${gradient})` }}><span><strong>{total}</strong><small>responses</small></span></div><div className="intelligence-donut-legend">{visible.map((item, index) => <div key={item.label}><i style={{ background: `var(--chart-${(index % 6) + 1})` }}/><span>{item.label}</span><strong>{item.value}</strong></div>)}</div></div> : <EmptyChart />}</section>;
}

function ActionRecords({ actions }: { actions: ActionSummary[] }) {
  const position = buildActionPosition(actions);
  return <section className="panel intelligence-chart-card intelligence-assurance-card intelligence-action-records-card">
    <div className="intelligence-card-heading"><div><h3>Action records</h3></div><ClipboardList size={18} /></div>
    {position.total ? <div className="intelligence-assurance-score">
      <div><strong>{position.completionRate}%</strong><span>completion</span></div>
      <div><b>{position.inProgress}</b><span>in progress</span></div>
      <div className={position.overdue ? "is-risk" : ""}><b>{position.overdue}</b><span>overdue</span></div>
      <div><b>{position.dueSoon}</b><span>due in 14 days</span></div>
      <div><b>{position.dueDateCompliance === undefined ? "—" : `${position.dueDateCompliance}%`}</b><span>due-date compliance</span><small>{position.dueDated ? `${position.compliantDueDated} of ${position.dueDated} within deadline` : "No implementation dates"}</small></div>
    </div> : <EmptyChart message="No action records are linked to this view." />}
  </section>;
}

function buildActionPosition(actions: ActionSummary[]) {
  const reportable = actions.filter((action) => !action.isDeleted && action.statusKey !== "cancelled");
  const completed = reportable.filter((action) => Boolean(action.completedDate) || action.statusKey === "complete");
  const active = reportable.filter((action) => !action.completedDate && action.statusKey !== "complete");
  const overdue = active.filter((action) => action.isOverdue);
  const inProgress = active.filter((action) => !action.isOverdue);
  const today = new Date().toISOString().slice(0, 10);
  const dueSoonLimit = new Date();
  dueSoonLimit.setDate(dueSoonLimit.getDate() + 14);
  const dueSoonDate = dueSoonLimit.toISOString().slice(0, 10);
  const dueSoon = inProgress.filter((action) => action.dueDate && action.dueDate >= today && action.dueDate <= dueSoonDate).length;
  const dueDated = reportable.filter((action) => action.dueDate);
  const compliantDueDated = dueDated.filter((action) => action.completedDate
    ? action.completedDate <= action.dueDate!
    : !action.isOverdue).length;
  return {
    total: reportable.length,
    completed: completed.length,
    inProgress: inProgress.length,
    overdue: overdue.length,
    dueSoon,
    dueDated: dueDated.length,
    compliantDueDated,
    completionRate: reportable.length ? percentage(completed.length, reportable.length) : 0,
    dueDateCompliance: dueDated.length ? percentage(compliantDueDated, dueDated.length) : undefined
  };
}

function EmptyChart({ message = "No data in the current view." }: { message?: string }) { return <div className="intelligence-empty"><Activity size={18}/><span>{message}</span></div>; }

function RecordDetailTable({ records, onOpenRecord }: { records: ProcessDashboardRecordSummary[]; onOpenRecord: (recordId: string) => void }) {
  return <DataTable rows={records} rowKey={(record) => record.id} columns={[
    { key: "process", header: "Process", render: (record) => getProcessDefinition(record.processKey).shortLabel },
    { key: "title", header: "Record", render: (record) => <a className="dashboard-detail-link" href={recordPath(record.id)} onClick={(event) => { event.preventDefault(); onOpenRecord(record.id); }}>{record.title}<ArrowUpRight aria-hidden="true" size={14} /></a> },
    { key: "date", header: "Date", render: (record) => formatDate(getRecordDate(record)) },
    { key: "area", header: "Area", render: (record) => formatArea(record) },
    { key: "focus", header: "Theme / focus", render: (record) => formatRecordFocus(record) },
    { key: "measure", header: "Key measure", render: (record) => formatRecordMeasure(record) },
    { key: "status", header: "Status", render: (record) => <span className="status-pill">{formatLabel(record.status)}</span> }
  ]}/>;
}

function ActionDetailTable({ actions, onOpenAction }: { actions: ActionSummary[]; onOpenAction: (actionId: string, staffId: string) => void }) {
  return <DataTable rows={actions} rowKey={(action) => action.id} columns={[
    { key: "theme", header: "Theme", render: (action) => action.actionTheme },
    { key: "title", header: "Action", render: (action) => <a className="dashboard-detail-link" href={actionPath(action.id)} onClick={(event) => { event.preventDefault(); onOpenAction(action.id, action.ownerStaffId); }}>{action.title}<ArrowUpRight aria-hidden="true" size={14} /></a> },
    { key: "owner", header: "Owner", render: (action) => action.ownerStaffName ?? "Unassigned" },
    { key: "area", header: "Area", render: (action) => action.teamCode ?? action.facultyCode ?? "Unassigned" },
    { key: "due", header: "Due", render: (action) => formatDate(action.dueDate) },
    { key: "status", header: "Status", render: (action) => <span className={`status-pill ${action.isOverdue && !action.completedDate ? "status-risk" : ""}`}>{action.completedDate ? "Complete" : action.isOverdue ? "Overdue" : "Open"}</span> }
  ]}/>;
}

function selectTrendGranularity(items: Array<{ date: string }>, startDate: string, endDate: string): TrendGranularity {
  if (!startDate && !endDate) return "month";
  const dates = items.map((item) => item.date.slice(0, 10)).filter(Boolean).sort();
  const from = startDate || dates[0];
  const to = endDate || dates.at(-1);
  if (!from || !to) return "month";
  const days = differenceInDays(from, to) + 1;
  if (days <= 31) return "day";
  if (days <= 120) return "week";
  return "month";
}

function buildAdaptiveTrend(items: Array<{ date: string }>, granularity: TrendGranularity, startDate: string, endDate: string): ChartDatum[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const date = item.date.slice(0, 10);
    const key = granularity === "day" ? date : granularity === "week" ? startOfIsoWeek(date) : date.slice(0, 7);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const itemDates = items.map((item) => item.date.slice(0, 10)).filter(Boolean).sort();
  const from = startDate || itemDates[0];
  const to = endDate || itemDates.at(-1);
  if (from && to && granularity !== "month") {
    const first = granularity === "week" ? startOfIsoWeek(from) : from;
    const last = granularity === "week" ? startOfIsoWeek(to) : to;
    for (let cursor = first; cursor <= last; cursor = addIsoDays(cursor, granularity === "week" ? 7 : 1)) {
      if (!counts.has(cursor)) counts.set(cursor, 0);
    }
  }
  return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)).slice(granularity === "month" ? -10 : undefined).map(([key, value]) => ({
    label: granularity === "day" ? formatTrendDate(key) : granularity === "week" ? `w/c ${formatTrendDate(key)}` : formatMonth(key),
    value
  }));
}

function formatTrendGranularity(granularity: TrendGranularity) {
  return granularity === "day" ? "Daily" : granularity === "week" ? "Weekly" : "Monthly";
}

function differenceInDays(from: string, to: string) {
  return Math.max(0, Math.round((parseIsoDate(to).getTime() - parseIsoDate(from).getTime()) / 86_400_000));
}

function startOfIsoWeek(value: string) {
  const date = parseIsoDate(value);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

function addIsoDays(value: string, days: number) {
  const date = parseIsoDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function parseIsoDate(value: string) { return new Date(`${value.slice(0, 10)}T00:00:00Z`); }
function formatTrendDate(value: string) { return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" }).format(parseIsoDate(value)); }

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
  return processDefinitions.filter((definition) => !["overview", "actions", "elevate_status"].includes(definition.key)).map((definition) => ({ label: definition.shortLabel, value: records.filter((record) => record.processKey === definition.key).length })).concat({ label: "Actions", value: actions.length }).filter((item) => item.value > 0).sort((left, right) => right.value - left.value);
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

function buildOutcomeRows(facts: DashboardDimensionFact[]): OutcomeRow[] {
  const rows = new Map<string, { total: number; count: number; secure: number; distribution: number[] }>();
  for (const fact of facts) {
    if (fact.numericValue === undefined || fact.numericValue === null) continue;
    const value = Number(fact.numericValue);
    const current = rows.get(fact.seriesLabel) ?? { total: 0, count: 0, secure: 0, distribution: [0, 0, 0, 0, 0] };
    current.total += value;
    current.count += 1;
    if (value >= 3) current.secure += 1;
    const bucket = Math.max(1, Math.min(5, Math.round(value)));
    current.distribution[bucket - 1] += 1;
    rows.set(fact.seriesLabel, current);
  }
  return [...rows.entries()].map(([label, row]) => ({
    label,
    responseCount: row.count,
    average: row.total / row.count,
    secureOrAboveCount: row.secure,
    distribution: row.distribution
  })).sort((left, right) => left.average - right.average || left.label.localeCompare(right.label));
}

function buildLearningWalkOutcomeGroups(facts: DashboardDimensionFact[], themeGroups: LearningWalkThemeGroup[]): OutcomeGroup[] {
  const numericFacts = facts.filter((fact) => fact.dimensionKey !== "practice_statement_outcome" && fact.numericValue !== undefined && fact.numericValue !== null);
  if (!numericFacts.length) return [];

  const themeIndex = new Map<string, LearningWalkThemeGroup>();
  for (const group of themeGroups) {
    for (const theme of group.themes) {
      themeIndex.set(theme.id.toLocaleLowerCase(), group);
    }
  }

  const groupedFacts = new Map<string, DashboardDimensionFact[]>();
  const historicalFacts: DashboardDimensionFact[] = [];
  for (const fact of numericFacts) {
    const configuredGroup = themeIndex.get(fact.seriesKey.toLocaleLowerCase());
    if (!configuredGroup) {
      historicalFacts.push(fact);
      continue;
    }
    const key = configuredGroup.groupKey || configuredGroup.id;
    const current = groupedFacts.get(key) ?? [];
    current.push(fact);
    groupedFacts.set(key, current);
  }

  const groups = [...themeGroups]
    .sort((left, right) => left.displayOrder - right.displayOrder || left.name.localeCompare(right.name))
    .flatMap<OutcomeGroup>((group) => {
      const key = group.groupKey || group.id;
      const groupFacts = groupedFacts.get(key) ?? [];
      if (!groupFacts.length) return [];
      const factsByTheme = new Map<string, DashboardDimensionFact[]>();
      for (const fact of groupFacts) {
        const factKey = fact.seriesKey.toLocaleLowerCase();
        const current = factsByTheme.get(factKey) ?? [];
        current.push(fact);
        factsByTheme.set(factKey, current);
      }
      const configuredThemeIds = new Set(group.themes.map((theme) => theme.id.toLocaleLowerCase()));
      const configuredChildren = group.themes
        .filter((theme) => theme.isActive || factsByTheme.has(theme.id.toLocaleLowerCase()))
        .map((theme) => buildOutcomeSummary(`${theme.name}${theme.isActive ? "" : " (historical)"}`, factsByTheme.get(theme.id.toLocaleLowerCase()) ?? []));
      const unmappedWithinGroup = buildOutcomeRows(groupFacts.filter((fact) => !configuredThemeIds.has(fact.seriesKey.toLocaleLowerCase())));
      const children = [...configuredChildren, ...unmappedWithinGroup]
        .sort((left, right) => {
          if (!left.responseCount && right.responseCount) return 1;
          if (left.responseCount && !right.responseCount) return -1;
          return left.average - right.average || left.label.localeCompare(right.label);
        });
      return [{ key, label: group.name, summary: buildOutcomeSummary(group.name, groupFacts), children }];
    });

  if (historicalFacts.length) {
    groups.push({
      key: "historical-or-other",
      label: "Other and historical focus areas",
      summary: buildOutcomeSummary("Other and historical focus areas", historicalFacts),
      children: buildOutcomeRows(historicalFacts)
    });
  }
  return groups;
}

function buildEliOutcomeGroups(facts: DashboardDimensionFact[]): OutcomeGroup[] {
  const areaFacts = facts.filter((fact) => fact.dimensionKey === "practice_area_outcome" && fact.numericValue !== undefined && fact.numericValue !== null);
  const statementFacts = facts.filter((fact) => fact.dimensionKey === "practice_statement_outcome" && fact.numericValue !== undefined && fact.numericValue !== null);
  const areas = new Map<string, { label: string; facts: DashboardDimensionFact[]; statements: DashboardDimensionFact[] }>();
  for (const fact of areaFacts) {
    const current = areas.get(fact.seriesKey) ?? { label: fact.seriesLabel, facts: [], statements: [] };
    current.facts.push(fact); areas.set(fact.seriesKey, current);
  }
  for (const fact of statementFacts) {
    const [areaKey] = fact.seriesKey.split("::");
    const [areaLabel] = fact.seriesLabel.split("|||");
    const current = areas.get(areaKey) ?? { label: areaLabel || areaKey, facts: [], statements: [] };
    current.statements.push(fact); areas.set(areaKey, current);
  }
  return [...areas.entries()].map(([key, area]) => {
    const statementRows = new Map<string, DashboardDimensionFact[]>();
    for (const fact of area.statements) {
      const statementLabel = fact.seriesLabel.split("|||").slice(1).join("|||") || fact.seriesLabel;
      const current = statementRows.get(statementLabel) ?? [];
      current.push(fact); statementRows.set(statementLabel, current);
    }
    return {
      key,
      label: area.label,
      summary: buildOutcomeSummary(area.label, area.facts.length ? area.facts : area.statements),
      children: [...statementRows.entries()].map(([label, rowFacts]) => buildOutcomeSummary(label, rowFacts))
        .sort((left, right) => left.average - right.average || left.label.localeCompare(right.label))
    };
  }).filter((group) => group.summary.responseCount > 0).sort((left, right) => left.summary.average - right.summary.average || left.label.localeCompare(right.label));
}

function buildOutcomeSummary(label: string, facts: DashboardDimensionFact[]): OutcomeRow {
  const distribution = [0, 0, 0, 0, 0];
  let total = 0;
  let secureOrAboveCount = 0;
  for (const fact of facts) {
    const value = Number(fact.numericValue);
    total += value;
    if (value >= 3) secureOrAboveCount += 1;
    distribution[Math.max(1, Math.min(5, Math.round(value))) - 1] += 1;
  }
  return { label, responseCount: facts.length, average: facts.length ? total / facts.length : 0, secureOrAboveCount, distribution };
}

function buildFrequencyRows(facts: DashboardDimensionFact[], records: ProcessDashboardRecordSummary[], actions: ActionSummary[]): FrequencyRow[] {
  const selections = new Map<string, Set<string>>();
  const add = (label: string, id: string) => {
    if (!label.trim()) return;
    const recordIds = selections.get(label) ?? new Set<string>();
    recordIds.add(id);
    selections.set(label, recordIds);
  };
  for (const fact of facts) {
    if (fact.numericValue === undefined || fact.numericValue === null) add(fact.seriesLabel, fact.sourceRecordId);
  }
  const recordFallbackAllowed = ["learning_walk", "work_scrutiny", "cpd_event"].includes(records[0]?.processKey ?? "");
  if (!selections.size && !facts.length && (recordFallbackAllowed || actions.length > 0)) {
    for (const record of records) for (const theme of splitValues(record.theme)) add(theme, record.id);
    for (const action of actions) add(action.actionTheme, action.id);
  }
  return [...selections.entries()].map(([label, ids]) => ({ label, recordCount: ids.size }))
    .sort((left, right) => right.recordCount - left.recordCount || left.label.localeCompare(right.label));
}

function buildProcessMetrics(
  processKey: DashboardProcessKey,
  records: ProcessDashboardRecordSummary[],
  facts: DashboardDimensionFact[],
  actions: ActionSummary[],
  staffParticipation: StaffParticipationTotals | undefined,
  liv: LivLifecycleTotals
): MetricDefinition[] {
  const numericFacts = facts.filter((fact) => fact.dimensionKey !== "practice_statement_outcome" && fact.numericValue !== undefined && fact.numericValue !== null);
  const secure = numericFacts.filter((fact) => Number(fact.numericValue) >= 3).length;
  const complete = records.filter((record) => isCompletedStatus(record.status)).length;
  const openActions = actions.filter((action) => !action.completedDate);
  const overdueActions = openActions.filter((action) => action.isOverdue);
  const coverage = staffParticipation && staffParticipation.activeStaffCount
    ? percentage(staffParticipation.participatingStaffCount, staffParticipation.activeStaffCount)
    : undefined;
  const actionMetric: MetricDefinition = { label: "Open actions", value: openActions.length, detail: `${overdueActions.length} overdue`, tone: overdueActions.length ? "amber" : "blue" };
  const secureMetric: MetricDefinition = { label: "Secure practice or above", value: numericFacts.length ? `${percentage(secure, numericFacts.length)}%` : "—", detail: numericFacts.length ? `${secure} of ${numericFacts.length} rated responses` : "No scored responses", tone: "violet" };

  if (processKey === "learning_walk") {
    const selectedFocuses = new Set(facts.filter((fact) => fact.dimensionKey === "focus").map((fact) => `${fact.sourceRecordId}:${fact.seriesKey}`)).size;
    return [
      { label: "Learning Walks", value: records.length, detail: `${complete} submitted records`, tone: "teal" },
      { label: "Focus selections", value: selectedFocuses, detail: "Multiple focus areas are counted", tone: "blue" },
      secureMetric,
      actionMetric
    ];
  }
  if (processKey === "liv") return [
    { label: "LIV requested", value: liv.requestedCount, detail: "Submitted through ELI", tone: "teal" },
    { label: "Visit date recorded", value: liv.scheduledCount, detail: `${liv.caseStartedCount} cases started`, tone: "blue" },
    { label: "Visit completed", value: liv.visitedCount, detail: `${liv.completedVisitCount} completed visit forms`, tone: "green" },
    { label: "Elevate practitioners", value: liv.practitionerStaffCount, detail: liv.practitionerStaffDenominator ? `${percentage(liv.practitionerStaffCount, liv.practitionerStaffDenominator)}% of ${liv.practitionerStaffDenominator} staff with a LIV case` : "No LIV cases in view", tone: "violet" },
    { label: "LIV closed", value: liv.completedCount, detail: `${openActions.length} open actions · ${overdueActions.length} overdue`, tone: overdueActions.length ? "amber" : "violet" }
  ];
  if (processKey === "eli") return [
    { label: "ELI submissions", value: records.length, detail: `${complete} submitted assessments`, tone: "teal" },
      { label: "Staff submission", value: coverage === undefined ? "—" : `${coverage}%`, detail: staffParticipation ? `${staffParticipation.participatingStaffCount} of ${staffParticipation.activeStaffCount} staff in year` : "No staff denominator", tone: "green" },
    secureMetric,
      { label: "Areas assessed", value: buildOutcomeRows(facts.filter((fact) => fact.dimensionKey === "practice_area_outcome")).length, detail: `${numericFacts.length} area ratings`, tone: "blue" }
  ];
  if (processKey === "probation_case") {
    const observationCounts = buildProbationObservationCounts(records);
    return [
      { label: "Staff with one observation", value: observationCounts.one, detail: "Includes staff who progressed to observations two and three", tone: "teal" },
      { label: "Staff with two observations", value: observationCounts.two, detail: "Includes staff who progressed to observation three", tone: "blue" },
      { label: "Staff with three observations", value: observationCounts.three, detail: "Completed all three observations", tone: "green" },
      actionMetric
    ];
  }
  if (processKey === "elevate_environment") return [
    { label: "Environment reviews", value: records.length, detail: `${complete} completed records`, tone: "teal" },
    { label: "Barriers identified", value: records.reduce((total, record) => total + record.barrierCount, 0), detail: `${records.filter((record) => record.barrierCount > 0).length} rooms affected`, tone: "amber" },
    secureMetric,
    actionMetric
  ];
  if (processKey === "coaching_session") return [
    { label: "Coaching sessions", value: records.length, detail: `${complete} completed sessions`, tone: "teal" },
    { label: "Staff reached", value: staffParticipation?.participatingStaffCount ?? "—", detail: coverage === undefined ? "No staff denominator" : `${coverage}% of ${staffParticipation?.activeStaffCount} staff in year`, tone: "green" },
    { label: "Focus areas used", value: buildFrequencyRows(facts, records, []).length, detail: "Distinct configured coaching themes", tone: "violet" },
    actionMetric
  ];
  if (processKey === "work_scrutiny") return [
    { label: "Scrutiny records", value: records.length, detail: `${complete} submitted records`, tone: "teal" },
    { label: "Work samples", value: records.reduce((total, record) => total + record.sampleSize, 0), detail: "Sample size recorded on forms", tone: "green" },
    { label: "Courses represented", value: buildFrequencyRows(facts, records, []).length, detail: "Distinct configured course selections", tone: "blue" },
    actionMetric
  ];
  if (processKey === "cpd_event") {
    const participants = records.reduce((total, record) => total + record.participantCount, 0);
    const minutes = records.reduce((total, record) => total + record.learningMinutes, 0);
    return [
      { label: "CPD events", value: records.length, detail: `${complete} completed event records`, tone: "teal" },
      { label: "Attendances", value: participants, detail: "Recorded attended places", tone: "green" },
      { label: "Learning hours", value: Math.round(minutes / 6) / 10, detail: "Attendance-weighted time", tone: "violet" },
      { label: "Staff participation", value: coverage === undefined ? "—" : `${coverage}%`, detail: staffParticipation ? `${staffParticipation.participatingStaffCount} of ${staffParticipation.activeStaffCount} staff in year` : "No staff denominator", tone: "blue" }
    ];
  }
  if (processKey === "actions") {
    const completeActions = actions.filter((action) => action.completedDate).length;
    return [
      { label: "Actions raised", value: actions.length, detail: `${completeActions} completed`, tone: "teal" },
      { label: "Open actions", value: openActions.length, detail: `${actions.length ? percentage(openActions.length, actions.length) : 0}% of actions`, tone: "blue" },
      { label: "Overdue", value: overdueActions.length, detail: "Requires management attention", tone: overdueActions.length ? "amber" : "green" },
      { label: "Completion", value: actions.length ? `${percentage(completeActions, actions.length)}%` : "—", detail: `${completeActions} of ${actions.length} actions`, tone: "green" }
    ];
  }
  return [
    { label: "Records in view", value: records.length, detail: `${complete} completed`, tone: "teal" },
    secureMetric,
    actionMetric,
    { label: "Structured responses", value: facts.length, detail: "Configured fields only", tone: "blue" }
  ];
}

function buildProbationObservationCounts(records: ProcessDashboardRecordSummary[]) {
  const highestByStaff = new Map<string, number>();
  for (const record of records) {
    const staffKey = record.subjectStaffId || record.subjectDisplayName || record.id;
    highestByStaff.set(staffKey, Math.max(highestByStaff.get(staffKey) ?? 0, record.sampleSize));
  }
  const stages = [...highestByStaff.values()];
  return {
    one: stages.filter((stage) => stage >= 1).length,
    two: stages.filter((stage) => stage >= 2).length,
    three: stages.filter((stage) => stage >= 3).length
  };
}

function buildProcessBriefing(processKey: DashboardProcessKey, records: ProcessDashboardRecordSummary[], facts: DashboardDimensionFact[], actions: ActionSummary[], liv: LivLifecycleTotals) {
  const outcomes = buildOutcomeRows(facts.filter((fact) => fact.dimensionKey !== "practice_statement_outcome"));
  const priority = outcomes[0];
  const overdue = actions.filter((action) => !action.completedDate && action.isOverdue).length;
  if (processKey === "liv") {
    const scheduledConversion = liv.requestedCount ? percentage(liv.scheduledCount, liv.requestedCount) : 0;
    return {
      headline: `${liv.visitedCount} completed LIV${liv.visitedCount === 1 ? "" : "s"}.`,
      detail: `${liv.scheduledCount} have a visit date recorded and ${liv.visitedCount} have at least one completed visit. Draft visits are excluded from delivery counts.`,
      signalLabel: "Request to scheduled",
      signalValue: liv.requestedCount ? `${scheduledConversion}%` : "No requests",
      signalDetail: `${liv.scheduledCount} of ${liv.requestedCount} requests`
    };
  }
  if (priority) return {
    headline: `${records.length} record${records.length === 1 ? " is" : "s are"} in view with ${facts.filter((fact) => fact.dimensionKey !== "practice_statement_outcome" && fact.numericValue !== undefined && fact.numericValue !== null).length} rated responses.`,
    detail: `${overdue} linked action${overdue === 1 ? " is" : "s are"} overdue. The matrix below retains every assessed area and its response volume.`,
    signalLabel: "Priority area",
    signalValue: priority.label,
    signalDetail: `${percentage(priority.secureOrAboveCount, priority.responseCount)}% Secure practice or above`
  };
  const mostUsed = buildFrequencyRows(facts, records, actions)[0];
  return {
    headline: `${processKey === "actions" ? actions.length : records.length} ${processKey === "actions" ? "action" : "record"}${(processKey === "actions" ? actions.length : records.length) === 1 ? " is" : "s are"} in the current view.`,
    detail: `${overdue} overdue action${overdue === 1 ? " requires" : "s require"} attention. Frequency reporting uses configured selections without attempting to score them.`,
    signalLabel: "Most recorded",
    signalValue: mostUsed?.label ?? "No structured selections",
    signalDetail: mostUsed ? `${mostUsed.recordCount} record${mostUsed.recordCount === 1 ? "" : "s"}` : "Awaiting structured data"
  };
}

function buildOrganisationPerformanceRows(
  records: ProcessDashboardRecordSummary[],
  facts: DashboardDimensionFact[],
  actions: ActionSummary[],
  participation: StaffParticipationDashboardSummary[],
  livRows: LivLifecycleDashboardSummary[]
): OrganisationPerformanceRow[] {
  const rows = new Map<string, OrganisationPerformanceRow>();
  const ensure = (code?: string, name?: string, parentCode?: string) => {
    const key = code || "Unassigned";
    const existing = rows.get(key);
    if (existing) {
      if ((!existing.name || existing.name === existing.code) && name) existing.name = name;
      if (!existing.parentCode && parentCode) existing.parentCode = parentCode;
      return existing;
    }
    const row: OrganisationPerformanceRow = {
      code: key, name: name || key, parentCode, recordCount: 0, completedCount: 0,
      ratingTotal: 0, ratingCount: 0, secureOrAboveCount: 0, openActionCount: 0, overdueActionCount: 0,
      activeStaffCount: 0, participatingStaffCount: 0, livRequestedCount: 0, livScheduledCount: 0,
      livVisitedCount: 0, livCompletedCount: 0
    };
    rows.set(key, row);
    return row;
  };
  for (const record of records) {
    if (record.areaCode === "Multiple") continue;
    const row = ensure(record.areaCode ?? record.parentAreaCode, record.areaName, record.parentAreaCode);
    row.recordCount += 1;
    if (isCompletedStatus(record.status)) row.completedCount += 1;
  }
  for (const fact of facts) {
    if (fact.dimensionKey === "practice_statement_outcome") continue;
    if (fact.numericValue === undefined || fact.numericValue === null) continue;
    const row = ensure(fact.areaCode ?? fact.parentAreaCode, fact.areaName, fact.parentAreaCode);
    const value = Number(fact.numericValue);
    row.ratingTotal += value;
    row.ratingCount += 1;
    if (value >= 3) row.secureOrAboveCount += 1;
  }
  for (const action of actions) {
    const code = action.teamCode ?? action.facultyCode;
    const row = ensure(code, code, action.teamCode ? action.facultyCode : undefined);
    if (!action.completedDate) row.openActionCount += 1;
    if (!action.completedDate && action.isOverdue) row.overdueActionCount += 1;
  }
  for (const item of participation) {
    const row = ensure(item.areaCode ?? item.parentAreaCode, item.areaName, item.parentAreaCode);
    row.activeStaffCount += item.activeStaffCount;
    row.participatingStaffCount += item.participatingStaffCount;
  }
  for (const item of livRows) {
    const row = ensure(item.areaCode ?? item.parentAreaCode, item.areaName, item.parentAreaCode);
    row.livRequestedCount += item.requestedCount;
    row.livScheduledCount += item.scheduledCount;
    row.livVisitedCount += item.visitedCount;
    row.livCompletedCount += item.completedCount;
  }
  return [...rows.values()].sort((left, right) => (left.parentCode ?? left.code).localeCompare(right.parentCode ?? right.code) || left.name.localeCompare(right.name));
}

function groupOrganisationPerformanceRows(rows: OrganisationPerformanceRow[], facultyNames: Map<string, string>) {
  const groups = new Map<string, OrganisationPerformanceRow[]>();
  for (const row of rows) {
    const facultyCode = row.parentCode || row.code;
    const values = groups.get(facultyCode) ?? [];
    values.push(row);
    groups.set(facultyCode, values);
  }
  return [...groups.entries()].map(([code, groupRows]) => {
    const direct = groupRows.find((row) => row.code === code && !row.parentCode);
    return { code, rows: groupRows, total: aggregateOrganisationPerformance(groupRows, code, direct?.name ?? facultyNames.get(code) ?? `Faculty ${code}`) };
  }).sort((left, right) => left.total.name.localeCompare(right.total.name));
}

function aggregateOrganisationPerformance(rows: OrganisationPerformanceRow[], code: string, name: string): OrganisationPerformanceRow {
  return rows.reduce<OrganisationPerformanceRow>((total, row) => ({
    ...total,
    recordCount: total.recordCount + row.recordCount,
    completedCount: total.completedCount + row.completedCount,
    ratingTotal: total.ratingTotal + row.ratingTotal,
    ratingCount: total.ratingCount + row.ratingCount,
    secureOrAboveCount: total.secureOrAboveCount + row.secureOrAboveCount,
    openActionCount: total.openActionCount + row.openActionCount,
    overdueActionCount: total.overdueActionCount + row.overdueActionCount,
    activeStaffCount: total.activeStaffCount + row.activeStaffCount,
    participatingStaffCount: total.participatingStaffCount + row.participatingStaffCount,
    livRequestedCount: total.livRequestedCount + row.livRequestedCount,
    livScheduledCount: total.livScheduledCount + row.livScheduledCount,
    livVisitedCount: total.livVisitedCount + row.livVisitedCount,
    livCompletedCount: total.livCompletedCount + row.livCompletedCount
  }), { code, name, recordCount: 0, completedCount: 0, ratingTotal: 0, ratingCount: 0, secureOrAboveCount: 0, openActionCount: 0, overdueActionCount: 0, activeStaffCount: 0, participatingStaffCount: 0, livRequestedCount: 0, livScheduledCount: 0, livVisitedCount: 0, livCompletedCount: 0 });
}

function aggregateLivLifecycle(rows: LivLifecycleDashboardSummary[]): LivLifecycleTotals {
  return rows.reduce<LivLifecycleTotals>((total, row) => ({
    requestedCount: total.requestedCount + row.requestedCount,
    caseStartedCount: total.caseStartedCount + row.caseStartedCount,
    scheduledCount: total.scheduledCount + row.scheduledCount,
    visitedCount: total.visitedCount + row.visitedCount,
    completedCount: total.completedCount + row.completedCount,
    completedVisitCount: total.completedVisitCount + row.completedVisitCount,
    practitionerStaffCount: total.practitionerStaffCount + row.practitionerStaffCount,
    practitionerStaffDenominator: total.practitionerStaffDenominator + row.practitionerStaffDenominator
  }), { requestedCount: 0, caseStartedCount: 0, scheduledCount: 0, visitedCount: 0, completedCount: 0, completedVisitCount: 0, practitionerStaffCount: 0, practitionerStaffDenominator: 0 });
}

function isCompletedStatus(status: string) {
  return ["completed", "submitted", "closed"].includes(status.toLocaleLowerCase());
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

function groupElevateStatusRows(rows: ElevateStatusDashboardSummary[], facultyNames: Map<string, string>) {
  const grouped = new Map<string, ElevateStatusDashboardSummary[]>();
  for (const row of rows) {
    const hasDistinctParent = Boolean(row.parentAreaCode && row.parentAreaCode !== row.areaCode);
    const facultyCode = hasDistinctParent ? row.parentAreaCode! : row.areaCode ?? "Unassigned";
    const current = grouped.get(facultyCode) ?? [];
    current.push(row); grouped.set(facultyCode, current);
  }
  return [...grouped.entries()].map(([code, groupRows]) => {
    const direct = groupRows.find((row) => row.areaCode === code && (!row.parentAreaCode || row.parentAreaCode === row.areaCode));
    const totals = aggregateElevateStatus(groupRows);
    const total: ElevateStatusDashboardSummary = {
      areaCode: code,
      areaName: direct?.areaName ?? facultyNames.get(code) ?? code,
      staffCount: totals.staffCount,
      level1OrAbove: totals.levelCounts[0] ?? 0,
      level2OrAbove: totals.levelCounts[1] ?? 0,
      level3OrAbove: totals.levelCounts[2] ?? 0,
      level4OrAbove: totals.levelCounts[3] ?? 0,
      level5OrAbove: totals.levelCounts[4] ?? 0
    };
    return { code, name: total.areaName ?? code, rows: groupRows, total };
  }).sort((left, right) => left.name.localeCompare(right.name));
}

function aggregateStaffParticipation(rows: StaffParticipationDashboardSummary[]): StaffParticipationTotals {
  return rows.reduce<StaffParticipationTotals>((total, row) => ({
    activeStaffCount: total.activeStaffCount + row.activeStaffCount,
    participatingStaffCount: total.participatingStaffCount + row.participatingStaffCount
  }), { activeStaffCount: 0, participatingStaffCount: 0 });
}

function staffCoverageLabel(processKey: DashboardProcessKey) {
  const labels: Partial<Record<DashboardProcessKey, string>> = {
    eli: "ELI submission rate",
    liv: "Completed LIV coverage",
    cpd_event: "CPD participation",
    coaching_session: "Coaching and mentoring reach"
  };
  return labels[processKey] ?? "Staff coverage";
}

function frequencyProfileCopy(processKey: DashboardProcessKey) {
  const copy: Partial<Record<DashboardProcessKey, { title: string; subtitle: string }>> = {
    learning_walk: { title: "Focus coverage", subtitle: "Number and share of Learning Walks containing each selected focus" },
    probation_case: { title: "Areas not observed", subtitle: "Completed observations where an area was explicitly marked as not observed" },
    coaching_session: { title: "Coaching focus areas", subtitle: "Distinct records using each configured coaching focus" },
    work_scrutiny: { title: "Course coverage", subtitle: "Scrutiny records associated with each configured course" },
    cpd_event: { title: "CPD themes", subtitle: "Events associated with each configured professional development theme" },
    actions: { title: "Action themes", subtitle: "Actions grouped by their configured teaching and learning theme" }
  };
  return copy[processKey] ?? { title: "Configured selections", subtitle: "Number and share of records containing each structured selection" };
}

function isStaffCoverageProcess(processKey: DashboardProcessKey) {
  return ["eli", "liv", "cpd_event", "coaching_session"].includes(processKey);
}

function percentage(count: number, total: number) {
  return total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
}

function actionMatchesProcess(action: ActionSummary, processKey: DashboardProcessKey) {
  const map: Partial<Record<DashboardProcessKey, string[]>> = {
    learning_walk: ["learning_walk"], liv: ["liv"], eli: ["elevate_practice"], probation_case: ["probation_observation"],
    elevate_environment: ["elevate_environment"], coaching_session: ["coaching_mentoring"],
    work_scrutiny: ["work_scrutiny"], cpd_event: ["cpd", "cpd_event"]
  };
  return map[processKey]?.includes(action.sourceFormType) ?? false;
}

function dashboardExportModuleKey(processKey: DashboardProcessKey) {
  const map: Partial<Record<DashboardProcessKey, string>> = {
    learning_walk: "learning-walks",
    liv: "liv",
    eli: "elevate-practice",
    probation_case: "probation",
    elevate_environment: "elevate-environments",
    coaching_session: "coaching",
    work_scrutiny: "work-scrutiny",
    cpd_event: "cpd"
  };
  return map[processKey];
}

function getProcessDefinition(processKey: DashboardProcessKey | RecordProcessKey) { return processDefinitions.find((item) => item.key === processKey) ?? processDefinitions[0]; }
function recordMatchesOrganisation(record: ProcessDashboardRecordSummary, facultyCode?: string, teamCode?: string, teamId?: string) { return matchesOrganisation(record.areaCode, record.parentAreaCode, record.orgUnitId, facultyCode, teamCode, teamId); }
function matchesOrganisation(areaCode?: string, parentAreaCode?: string, orgUnitId?: string, facultyCode?: string, teamCode?: string, teamId?: string) {
  if (teamCode) return orgUnitId === teamId || areaCode === teamCode;
  if (facultyCode) return areaCode === facultyCode || parentAreaCode === facultyCode;
  return true;
}
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

function collectDashboardOrgOptions(orgUnits: OrgUnitSummary[], user: CurrentUser) {
  const active = orgUnits.filter((unit) => unit.isActive && ["faculty", "team", "faculty_child_code", "faculty_child"].includes(unit.orgUnitType));
  const byId = new Map(active.map((unit) => [unit.id, unit]));
  const permitted = new Set(user.permissions.includes("reports.view_all")
    ? active.map((unit) => unit.id)
    : user.scopes.filter((scope) => scope.scopeType === "assigned_org_units" && scope.orgUnitId).map((scope) => scope.orgUnitId!));
  let changed = true;
  while (changed) {
    changed = false;
    for (const unit of active) {
      if (unit.parentOrgUnitId && permitted.has(unit.parentOrgUnitId) && !permitted.has(unit.id)) {
        permitted.add(unit.id);
        changed = true;
      }
    }
  }
  function facultyFor(unit: OrgUnitSummary) {
    let current: OrgUnitSummary | undefined = unit;
    while (current && current.orgUnitType !== "faculty") current = current.parentOrgUnitId ? byId.get(current.parentOrgUnitId) : undefined;
    return current;
  }
  const teams: DashboardOrgOption[] = active.filter((unit) => unit.orgUnitType !== "faculty" && permitted.has(unit.id)).flatMap((unit) => {
    const faculty = facultyFor(unit);
    return faculty ? [{ id: unit.id, code: unit.code, name: unit.name, facultyId: faculty.id }] : [];
  });
  const facultyIds = new Set([...permitted].flatMap((id) => {
    const unit = byId.get(id);
    const faculty = unit ? facultyFor(unit) : undefined;
    return faculty ? [faculty.id] : [];
  }));
  const faculties: DashboardOrgOption[] = active.filter((unit) => unit.orgUnitType === "faculty" && facultyIds.has(unit.id)).map((unit) => ({ id: unit.id, code: unit.code, name: unit.name, facultyId: unit.id }));
  return {
    faculties: faculties.sort((left, right) => left.name.localeCompare(right.name)),
    teams: teams.sort((left, right) => left.name.localeCompare(right.name))
  };
}

function downloadCsv(filename: string, rows: Array<Array<string | number>>) {
  const content = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\ufeff", content], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
}
