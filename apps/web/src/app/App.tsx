import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, LogOut, Moon, PanelLeftClose, PanelLeftOpen, Search, Sun } from "lucide-react";
import { canAccessRoute, navigationItems, type AppRoute } from "./navigation";
import {
  actionPath,
  adminPath,
  parseAppLocation,
  recordPath,
  routePath,
  staffActionsPath,
  staffPath,
  type AppLocation
} from "./routing";
import { api } from "../services/api";
import { isAuthEnabled, signOut } from "../services/auth";
import { FirstTimeOnboarding } from "../components/FirstTimeOnboarding";
import type {
  ActionSummary,
  AcademicYearSummary,
  AdminRecord,
  CurrentUser,
  ModuleSummary,
  OrgUnitSummary,
  ProcessDashboardRecordSummary,
  StaffProfileSummary,
  StaffSummary
} from "../services/types";

const Home = lazy(() => import("../routes/Home").then((module) => ({ default: module.Home })));
const Dashboard = lazy(() => import("../routes/Dashboard").then((module) => ({ default: module.Dashboard })));
const StaffProfiles = lazy(() => import("../routes/StaffProfiles").then((module) => ({ default: module.StaffProfiles })));
const AdminCentre = lazy(() => import("../routes/AdminCentre").then((module) => ({ default: module.AdminCentre })));
const LivVisits = lazy(() => import("../routes/LivVisits").then((module) => ({ default: module.LivVisits })));
const ProbationObservations = lazy(() => import("../routes/ProbationObservations").then((module) => ({ default: module.ProbationObservations })));
const ModuleWorkspace = lazy(() => import("../routes/ModuleWorkspace").then((module) => ({ default: module.ModuleWorkspace })));
const ActionsView = lazy(() => import("../routes/ActionsView").then((module) => ({ default: module.ActionsView })));
const StaffProfileWorkspace = lazy(() => import("../routes/StaffProfileWorkspace").then((module) => ({ default: module.StaffProfileWorkspace })));
const ElevatePractice = lazy(() => import("../routes/ElevatePractice").then((module) => ({ default: module.ElevatePractice })));
const CoachingMentoring = lazy(() => import("../routes/CoachingMentoring").then((module) => ({ default: module.CoachingMentoring })));
const MyTeam = lazy(() => import("../routes/MyTeam").then((module) => ({ default: module.MyTeam })));

const emptyUser: CurrentUser = {
  displayName: "Loading...",
  email: "",
  permissions: [],
  scopes: []
};

export function App() {
  const [initialLocation] = useState(() => parseAppLocation());
  const [route, setRoute] = useState<AppRoute>(initialLocation.route);
  const [user, setUser] = useState<CurrentUser>(emptyUser);
  const [modules, setModules] = useState<ModuleSummary[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnitSummary[]>([]);
  const [staff, setStaff] = useState<StaffSummary[]>([]);
  const [actions, setActions] = useState<ActionSummary[]>([]);
  const [processRecords, setProcessRecords] = useState<ProcessDashboardRecordSummary[]>([]);
  const [profiles, setProfiles] = useState<StaffProfileSummary[]>([]);
  const [academicYears, setAcademicYears] = useState<AcademicYearSummary[]>([]);
  const [academicYear, setAcademicYear] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [profileStaffId, setProfileStaffId] = useState(initialLocation.profileStaffId);
  const [actionStaffId, setActionStaffId] = useState(initialLocation.actionStaffId);
  const [actionDetailId, setActionDetailId] = useState(initialLocation.actionDetailId);
  const [sourceRecordId, setSourceRecordId] = useState(initialLocation.sourceRecordId);
  const [pendingRecordId, setPendingRecordId] = useState(initialLocation.pendingRecordId);
  const [adminTab, setAdminTab] = useState(initialLocation.adminTab);
  const [linkError, setLinkError] = useState("");
  const [isNavigationCollapsed, setIsNavigationCollapsed] = useState(
    () => localStorage.getItem("ielevate-navigation-collapsed") === "true"
  );
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const stored = localStorage.getItem("ielevate-theme");
    if (stored === "light" || stored === "dark") return stored;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("ielevate-theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("ielevate-navigation-collapsed", String(isNavigationCollapsed));
  }, [isNavigationCollapsed]);

  const applyLocation = useCallback((location: AppLocation) => {
    setRoute(location.route);
    setProfileStaffId(location.profileStaffId);
    setActionStaffId(location.actionStaffId);
    setActionDetailId(location.actionDetailId);
    setSourceRecordId(location.sourceRecordId);
    setPendingRecordId(location.pendingRecordId);
    setAdminTab(location.adminTab);
    setLinkError("");
  }, []);

  const writePath = useCallback((path: string, replace = false) => {
    if (window.location.pathname === path && !window.location.search && !window.location.hash) return;
    window.history[replace ? "replaceState" : "pushState"]({}, "", path);
  }, []);

  const loadCoreData = useCallback(async () => {
    setLoadError("");
    try {
      const nextUser = await api.currentUser();
      setUser(nextUser);
      if (!nextUser.userAccountId) {
        setModules([]);
        setOrgUnits([]);
        setStaff([]);
        setActions([]);
        setProcessRecords([]);
        setProfiles([]);
        return;
      }

      const [nextModules, nextOrgUnits, nextStaff, nextActions, nextProfiles, nextAcademicYears] = await Promise.all([
        api.modules(),
        api.orgUnits(),
        api.staff().catch(() => [] as StaffSummary[]),
        api.actions(),
        api.staffProfiles(),
        api.academicYears()
      ]);
      setModules(nextModules);
      setOrgUnits(nextOrgUnits);
      setStaff(nextStaff);
      setActions(nextActions);
      setProfiles(nextProfiles);
      setAcademicYears(nextAcademicYears);
      setAcademicYear((current) => current && nextAcademicYears.some((year) => year.academicYear === current)
        ? current
        : nextAcademicYears.find((year) => year.isCurrent)?.academicYear ?? nextAcademicYears[0]?.academicYear ?? "");
      void api
        .processDashboardRecords()
        .then(setProcessRecords)
        .catch(() => setProcessRecords([]));
    } catch {
      setLoadError(
        "The Teaching and Learning API could not be reached. Start the API (scripts\\run-api.ps1) and check the database, then refresh."
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCoreData();
  }, [loadCoreData]);

  useEffect(() => {
    const onPopState = () => applyLocation(parseAppLocation());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [applyLocation]);

  useEffect(() => {
    if (!pendingRecordId || !user.userAccountId || isLoading) return;
    let cancelled = false;
    void api.recordNavigation(pendingRecordId)
      .then((record) => {
        if (cancelled) return;
        const nextRoute = routeForRecordType(record.recordType);
        setPendingRecordId("");
        setSourceRecordId(record.id);
        setProfileStaffId(nextRoute === "profile" ? record.subjectStaffId ?? "" : "");
        setActionStaffId("");
        setActionDetailId("");
        setRoute(nextRoute);
      })
      .catch(() => {
        if (cancelled) return;
        setPendingRecordId("");
        setSourceRecordId("");
        setRoute("dashboard");
        setLinkError("That record could not be found, or you do not have permission to view it.");
        writePath(routePath("dashboard"), true);
      });
    return () => { cancelled = true; };
  }, [isLoading, pendingRecordId, user.userAccountId, writePath]);

  const refreshActions = useCallback(async () => {
    try {
      setActions(await api.actions());
    } catch {
      // keep the previous list when a refresh fails
    }
  }, []);

  const visibleNavigationItems = useMemo(
    () => navigationItems.filter((item) => canAccessRoute(item.key, user.permissions)),
    [user.permissions]
  );
  const activeItem = useMemo(() => visibleNavigationItems.find((item) => item.key === route), [route, visibleNavigationItems]);

  useEffect(() => {
    if (isLoading || !user.userAccountId || pendingRecordId || sourceRecordId || canAccessRoute(route, user.permissions)) return;
    setRoute("home");
    setProfileStaffId("");
    setActionStaffId("");
    setActionDetailId("");
    setAdminTab("overview");
    setLinkError("You do not have permission to open that area.");
    writePath(routePath("home"), true);
  }, [isLoading, pendingRecordId, route, sourceRecordId, user.permissions, user.userAccountId, writePath]);

  const yearActions = useMemo(
    () => academicYear ? actions.filter((action) => action.academicYear === academicYear) : actions,
    [academicYear, actions]
  );
  const yearProcessRecords = useMemo(
    () => academicYear
      ? processRecords.filter((record) => (record.academicYear ?? academicYearForDate(record.recordDate ?? record.createdAt)) === academicYear)
      : processRecords,
    [academicYear, processRecords]
  );

  function navigate(nextRoute: AppRoute) {
    setProfileStaffId("");
    setActionStaffId("");
    setActionDetailId("");
    setSourceRecordId("");
    setPendingRecordId("");
    setAdminTab("overview");
    setLinkError("");
    setRoute(nextRoute);
    writePath(routePath(nextRoute));
  }

  function openTeamProfile(staffId: string) {
    setProfileStaffId(staffId);
    setActionStaffId("");
    setActionDetailId("");
    setSourceRecordId("");
    setRoute("profile");
    writePath(staffPath(staffId));
  }

  function openTeamActions(staffId: string) {
    setActionStaffId(staffId);
    setActionDetailId("");
    setProfileStaffId("");
    setSourceRecordId("");
    setRoute("actions");
    writePath(staffActionsPath(staffId));
  }

  function openElevateReport(staffId: string, elevateRecordId: string) {
    setProfileStaffId(staffId);
    setActionStaffId("");
    setActionDetailId("");
    setSourceRecordId(elevateRecordId);
    setRoute("profile");
    writePath(recordPath(elevateRecordId));
  }

  function openActionSource(action: ActionSummary) {
    if (!action.sourceRecordId) return;
    setSourceRecordId(action.sourceRecordId);
    setActionStaffId("");
    setActionDetailId("");
    if (action.sourceFormType === "elevate_practice" && action.subjectStaffId) {
      setProfileStaffId(action.subjectStaffId);
      setRoute("profile");
      writePath(recordPath(action.sourceRecordId));
      return;
    }
    setProfileStaffId("");
    setRoute(routeForRecordType(action.sourceFormType));
    writePath(recordPath(action.sourceRecordId));
  }

  function openAdminRecord(record: AdminRecord) {
    setSourceRecordId(record.recordId);
    setActionStaffId("");
    setActionDetailId("");
    const nextRoute = routeForRecordType(record.recordType);
    setProfileStaffId(nextRoute === "profile" ? record.subjectStaffId ?? "" : "");
    setRoute(nextRoute);
    writePath(recordPath(record.recordId));
  }

  function openStaffRecord(recordType: string, recordId: string, staffId: string) {
    setSourceRecordId(recordId);
    setActionStaffId("");
    setActionDetailId("");
    const nextRoute = routeForRecordType(recordType);
    setProfileStaffId(nextRoute === "profile" ? staffId : "");
    setRoute(nextRoute);
    writePath(recordPath(recordId));
  }

  function openActionDetails(actionId: string, staffId: string) {
    setActionDetailId(actionId);
    setActionStaffId(staffId);
    setProfileStaffId("");
    setSourceRecordId("");
    setRoute("actions");
    writePath(actionPath(actionId));
  }

  function openDashboardRecord(recordId: string) {
    setPendingRecordId(recordId);
    setLinkError("");
    writePath(recordPath(recordId));
  }

  function handleRecordOpened(recordId: string) {
    setSourceRecordId(recordId);
    setLinkError("");
    writePath(recordPath(recordId));
  }

  function handleRecordClosed(recordRoute: AppRoute) {
    setSourceRecordId("");
    writePath(routePath(recordRoute));
  }

  function handleAdminTabChanged(tab: string) {
    setAdminTab(tab);
    writePath(adminPath(tab));
  }

  function handleActionOpened(actionId: string) {
    setActionDetailId(actionId);
    writePath(actionPath(actionId));
  }

  function handleActionClosed() {
    setActionDetailId("");
    writePath(actionStaffId ? staffActionsPath(actionStaffId) : routePath("actions"));
  }

  if (!isLoading && !loadError && !user.userAccountId) {
    return (
      <FirstTimeOnboarding
        email={user.email}
        onComplete={async (onboardedUser) => {
          setUser(onboardedUser);
          setIsLoading(true);
          await loadCoreData();
        }}
      />
    );
  }

  return (
    <div className={isNavigationCollapsed ? "app-shell app-shell-nav-collapsed" : "app-shell"}>
      <aside className="sidebar" aria-label="Main navigation" id="main-navigation">
        <div className="brand-block">
          <img
            className="brand-logo brand-logo-full"
            src={theme === "dark"
              ? "/system-assets/i-elevate-logo-transparent.png"
              : "/system-assets/i-elevate-logo-ink.png"}
            alt="i-Elevate"
          />
          <img
            aria-hidden="true"
            className="brand-logo-mark"
            src="/system-assets/eli/eli-favicon-64.png"
            alt=""
          />
        </div>
        <nav>
          {visibleNavigationItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={item.key === route ? "nav-item nav-item-active" : "nav-item"}
                key={item.key}
                onClick={() => navigate(item.key)}
                title={item.label}
                type="button"
              >
                <Icon size={18} aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="main">
        <header className="topbar">
          <button
            aria-controls="main-navigation"
            aria-expanded={!isNavigationCollapsed}
            className="icon-button navigation-collapse-button"
            onClick={() => setIsNavigationCollapsed((current) => !current)}
            title={isNavigationCollapsed ? "Expand navigation" : "Collapse navigation"}
            type="button"
          >
            {isNavigationCollapsed
              ? <PanelLeftOpen size={18} aria-hidden="true" />
              : <PanelLeftClose size={18} aria-hidden="true" />}
          </button>
          <div className="topbar-search">
            <Search size={16} aria-hidden="true" />
            <input aria-label="Search i-Elevate" placeholder="Search staff, actions, records" />
          </div>
          {academicYears.length > 0 ? (
            <label className="academic-year-selector">
              <CalendarDays size={16} aria-hidden="true" />
              <span className="sr-only">Academic year</span>
              <select aria-label="Academic year" onChange={(event) => setAcademicYear(event.target.value)} value={academicYear}>
                {academicYears.map((year) => (
                  <option key={year.academicYear} value={year.academicYear}>
                    {year.academicYear}{year.isCurrent ? " (current)" : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button
            className="icon-button"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            title={theme === "dark" ? "Switch to light appearance" : "Switch to dark appearance"}
            type="button"
          >
            {theme === "dark" ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
          </button>
          <div className="user-chip">
            <span>{user.displayName}</span>
            {isAuthEnabled ? (
              <button className="icon-button" onClick={signOut} title="Sign out" type="button">
                <LogOut size={16} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </header>

        {loadError ? (
          <div className="api-error-banner" role="alert">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>{loadError}</span>
            <button onClick={() => { setIsLoading(true); void loadCoreData(); }} type="button">
              Retry
            </button>
          </div>
        ) : null}

        {linkError ? (
          <div className="api-error-banner" role="alert">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>{linkError}</span>
            <button onClick={() => setLinkError("")} type="button">Dismiss</button>
          </div>
        ) : null}

        <div className="content-frame" aria-label={activeItem?.label ?? "Dashboard"}>
          {isLoading ? (
            <div className="route-stack">
              <p className="muted-copy">Loading i-Elevate...</p>
            </div>
          ) : !user.userAccountId ? (
            <section className="access-denied-panel">
              <AlertTriangle size={22} aria-hidden="true" />
              <div>
                <h1>Account not provisioned</h1>
                <p>
                  Your Microsoft sign-in was successful, but this email address is not linked to an active i-Elevate account.
                </p>
                <p className="muted-copy">Signed in as {user.email || "unknown account"}</p>
              </div>
              {isAuthEnabled ? (
                <button onClick={signOut} type="button">Sign out</button>
              ) : null}
            </section>
          ) : (
            <Suspense fallback={<div className="route-stack"><p className="muted-copy">Loading this workspace...</p></div>}>
              {route === "home" ? (
                <Home
                  onNavigate={navigate}
                  tiles={visibleNavigationItems}
                  user={user}
                />
              ) : null}
              {route === "dashboard" ? (
                <Dashboard
                  academicYear={academicYear}
                  actions={yearActions}
                  orgUnits={orgUnits}
                  processRecords={yearProcessRecords}
                  user={user}
                  onRefresh={loadCoreData}
                  onOpenAction={openActionDetails}
                  onOpenRecord={openDashboardRecord}
                  onOpenStaff={openTeamProfile}
                />
              ) : null}
              {route === "staff" ? <StaffProfiles academicYear={academicYear} onOpenActionDetails={openActionDetails} onOpenRecord={openStaffRecord} onStaffSelected={(staffId) => writePath(staffPath(staffId))} profiles={profiles} staff={staff} user={user} /> : null}
              {route === "team" ? <MyTeam onOpenActions={openTeamActions} onOpenProfile={openTeamProfile} /> : null}
              {route === "admin" ? <AdminCentre initialTab={adminTab} modules={modules} onOpenRecord={openAdminRecord} onTabChange={handleAdminTabChanged} profiles={profiles} staff={staff} user={user} /> : null}
              {route === "learning" ? (
                <ModuleWorkspace academicYear={academicYear} eyebrow="Teaching and learning activity" initialRecordId={sourceRecordId} mode="learning" onActionsChanged={refreshActions} onRecordClosed={() => handleRecordClosed("learning")} onRecordOpened={handleRecordOpened} staff={staff} title="Learning Walks" user={user} />
              ) : null}
              {route === "liv" ? (
                <LivVisits
                  initialSourceRecordId={sourceRecordId}
                  onActionsChanged={refreshActions}
                  onOpenStaffProfile={openTeamProfile}
                  onRecordClosed={() => handleRecordClosed("liv")}
                  onRecordOpened={handleRecordOpened}
                  orgUnits={orgUnits}
                  staff={staff}
                  user={user}
                />
              ) : null}
              {route === "probation" ? (
                <ProbationObservations
                  actions={yearActions}
                  initialSourceRecordId={sourceRecordId}
                  onActionsChanged={refreshActions}
                  onOpenEliReport={openElevateReport}
                  onRecordClosed={() => handleRecordClosed("probation")}
                  onRecordOpened={handleRecordOpened}
                  orgUnits={orgUnits}
                  staff={staff}
                  user={user}
                />
              ) : null}
              {route === "elevate" ? (
                <ModuleWorkspace
                  academicYear={academicYear}
                  title="Elevate Your Learning Environment"
                  eyebrow="Learning environment review"
                  initialRecordId={sourceRecordId}
                  mode="elevate"
                  onRecordClosed={() => handleRecordClosed("elevate")}
                  onRecordOpened={handleRecordOpened}
                  staff={staff}
                  user={user}
                  onActionsChanged={refreshActions}
                />
              ) : null}
              {route === "practice" ? <ElevatePractice user={user} onActionsChanged={refreshActions} /> : null}
              {route === "coaching" ? (
                <CoachingMentoring initialRecordId={sourceRecordId} onActionsChanged={refreshActions} onRecordClosed={() => handleRecordClosed("coaching")} onRecordOpened={handleRecordOpened} orgUnits={orgUnits} staff={staff} user={user} />
              ) : null}
              {route === "scrutiny" ? (
                <ModuleWorkspace academicYear={academicYear} eyebrow="Teaching and learning activity" initialRecordId={sourceRecordId} mode="scrutiny" onActionsChanged={refreshActions} onRecordClosed={() => handleRecordClosed("scrutiny")} onRecordOpened={handleRecordOpened} staff={staff} title="Work Scrutiny" user={user} />
              ) : null}
              {route === "cpd" ? (
                <ModuleWorkspace academicYear={academicYear} eyebrow="Professional learning" initialRecordId={sourceRecordId} mode="cpd" onActionsChanged={refreshActions} onRecordClosed={() => handleRecordClosed("cpd")} onRecordOpened={handleRecordOpened} staff={staff} title={user.permissions.includes("cpd.manage") ? "CPD Management" : "CPD"} user={user} />
              ) : null}
              {route === "profile" ? <StaffProfileWorkspace academicYear={academicYear} initialElevateRecordId={sourceRecordId} initialStaffId={profileStaffId} onOpenActionDetails={openActionDetails} onOpenRecord={openStaffRecord} onStaffChanged={(staffId) => writePath(staffPath(staffId))} profiles={profiles} staff={staff} user={user} /> : null}
              {route === "actions" ? (
                <ActionsView academicYear={academicYear} actions={yearActions} initialActionId={actionDetailId} initialStaffId={actionStaffId} onActionClosed={handleActionClosed} onActionOpened={handleActionOpened} onChanged={refreshActions} onOpenSource={openActionSource} orgUnits={orgUnits} staff={staff} user={user} />
              ) : null}
            </Suspense>
          )}
        </div>
      </main>
    </div>
  );
}

function academicYearForDate(value: string) {
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  const calendarYear = date.getUTCFullYear();
  const startYear = date.getUTCMonth() >= 7 ? calendarYear : calendarYear - 1;
  return `${startYear}/${String((startYear + 1) % 100).padStart(2, "0")}`;
}

function routeForRecordType(recordType: string): AppRoute {
  const routes: Partial<Record<string, AppRoute>> = {
    coaching_mentoring: "coaching",
    coaching_session: "coaching",
    cpd_event: "cpd",
    elevate_environment: "elevate",
    elevate_practice: "profile",
    elevate_practice_assessment: "profile",
    learning_walk: "learning",
    liv: "liv",
    probation_case: "probation",
    probation_observation: "probation",
    work_scrutiny: "scrutiny"
  };
  return routes[recordType] ?? "dashboard";
}
