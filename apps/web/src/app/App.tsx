import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarDays, Moon, PanelLeftClose, PanelLeftOpen, Menu, Sun } from "lucide-react";
import { initialiseAppHistory, historyPosition, writeAppPath } from "./history";
import { UnsavedChangesGuard, confirmUnsavedNavigation, hasUnsavedChanges } from "../components/UnsavedChangesGuard";
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
import { SidebarNavigation } from "../components/SidebarNavigation";
import { WorkspaceSwitch } from "../components/WorkspaceSwitch";
import { UserMenu } from "../components/UserMenu";
import { FirstTimeOnboarding } from "../components/FirstTimeOnboarding";
import type {
  ActionSummary,
  AcademicYearSummary,
  AdminRecord,
  CurrentUser,
  ModuleSummary,
  OrgUnitSummary,
  QaHubSummary,
  StaffSummary,
  UcoTlaAccessSummary
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
const QaHub = lazy(() => import("../routes/QaHub").then((module) => ({ default: module.QaHub })));
const UcoTlaReviews = lazy(() => import("../routes/UcoTlaReviews").then((module) => ({ default: module.UcoTlaReviews })));

const emptyUser: CurrentUser = {
  displayName: "Loading...",
  email: "",
  permissions: [],
  scopes: []
};

export function App() {
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const historyIndex = useRef(historyPosition());
  const [initialLocation] = useState(() => parseAppLocation());
  const [route, setRoute] = useState<AppRoute>(initialLocation.route);
  const [user, setUser] = useState<CurrentUser>(emptyUser);
  const [modules, setModules] = useState<ModuleSummary[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnitSummary[]>([]);
  const [staff, setStaff] = useState<StaffSummary[]>([]);
  const [actions, setActions] = useState<ActionSummary[]>([]);
  const [academicYears, setAcademicYears] = useState<AcademicYearSummary[]>([]);
  const [academicYear, setAcademicYear] = useState("");
  const [modulesLoaded, setModulesLoaded] = useState(false);
  const [staffLoaded, setStaffLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [lookupErrors, setLookupErrors] = useState<Record<string, string>>({});
  const [lookupAttempt, setLookupAttempt] = useState(0);
  const [qaHubSummary, setQaHubSummary] = useState<QaHubSummary | null>(null);
  const [ucoAccess, setUcoAccess] = useState<UcoTlaAccessSummary | null>(null);
  const [ucoAccessLoaded, setUcoAccessLoaded] = useState(false);
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
    writeAppPath(path, replace);
    historyIndex.current = historyPosition();
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
        setAcademicYears([]);
        return;
      }

      const [nextOrgUnits, nextAcademicYears] = await Promise.all([
        api.orgUnits(),
        api.academicYears()
      ]);
      setOrgUnits(nextOrgUnits);
      setAcademicYears(nextAcademicYears);
      setAcademicYear((current) => current && nextAcademicYears.some((year) => year.academicYear === current)
        ? current
        : nextAcademicYears.find((year) => year.isCurrent)?.academicYear ?? nextAcademicYears[0]?.academicYear ?? "");
    } catch {
      setLoadError(
        "The service could not be reached. Check your connection and try again. Contact support if the problem continues."
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCoreData();
  }, [loadCoreData]);

  const hasQaPermission = user.permissions.some((permission) => permission.startsWith("qa_reviews.view_"));

  useEffect(() => {
    if (!user.userAccountId || !hasQaPermission) {
      setQaHubSummary(null);
      return;
    }
    let cancelled = false;
    void api.qaHubSummary()
      .then((summary) => { if (!cancelled) setQaHubSummary(summary); })
      .catch(() => { if (!cancelled) setQaHubSummary(null); });
    return () => { cancelled = true; };
  }, [hasQaPermission, user.userAccountId]);

  useEffect(() => {
    if (!user.userAccountId) {
      setUcoAccess(null);
      setUcoAccessLoaded(true);
      return;
    }
    let cancelled = false;
    setUcoAccessLoaded(false);
    void api.ucoTlaAccess()
      .then((summary) => { if (!cancelled) setUcoAccess(summary); })
      .catch(() => { if (!cancelled) setUcoAccess(null); })
      .finally(() => { if (!cancelled) setUcoAccessLoaded(true); });
    return () => { cancelled = true; };
  }, [user.userAccountId]);

  useEffect(() => {
    if (!user.userAccountId || modulesLoaded || route !== "admin") return;
    let cancelled = false;
    void api.modules()
      .then((rows) => { if (!cancelled) { setModules(rows); setModulesLoaded(true); setLookupErrors(current => ({ ...current, modules: "" })); } })
      .catch(error => { if (!cancelled) { setModulesLoaded(true); setLookupErrors(current => ({ ...current, modules: error instanceof Error ? error.message : "Could not load modules." })); } });
    return () => { cancelled = true; };
  }, [modulesLoaded, route, user.userAccountId]);

  useEffect(() => {
    const staffRoutes: AppRoute[] = ["staff", "learning", "liv", "als_learning", "als_liv", "probation", "elevate", "coaching", "scrutiny", "cpd", "profile", "actions", "qa"];
    if (!user.userAccountId || staffLoaded || !staffRoutes.includes(route)) return;
    let cancelled = false;
    void api.staff()
      .then((rows) => { if (!cancelled) { setStaff(rows); setStaffLoaded(true); setLookupErrors(current => ({ ...current, staff: "" })); } })
      .catch(error => { if (!cancelled) { setStaffLoaded(true); setLookupErrors(current => ({ ...current, staff: error instanceof Error ? error.message : "Could not load staff." })); } });
    return () => { cancelled = true; };
  }, [route, staffLoaded, user.userAccountId]);

  useEffect(() => {
    if (!user.userAccountId || !academicYear || !["actions", "probation"].includes(route)) return;
    let cancelled = false;
    setActions([]);
    void api.actions(false, academicYear)
      .then((rows) => { if (!cancelled) { setActions(rows); setLookupErrors(current => ({ ...current, actions: "" })); } })
      .catch(error => { if (!cancelled) setLookupErrors(current => ({ ...current, actions: error instanceof Error ? error.message : "Actions could not be loaded." })); });
    return () => { cancelled = true; };
  }, [academicYear, route, user.userAccountId, lookupAttempt]);

  useEffect(() => {
    initialiseAppHistory();
    historyIndex.current = historyPosition();
    let pendingHistory: { target: AppLocation; delta: number; phase: "restoring" | "confirming" | "accepting" } | null = null;
    const accepted = (location: AppLocation) => {
      historyIndex.current = historyPosition();
      applyLocation(location);
      setMobileNavigationOpen(false);
      window.dispatchEvent(new CustomEvent("app:navigation-accepted", { detail: { pathname: window.location.pathname } }));
    };
    const onWritten = () => { historyIndex.current = historyPosition(); };
    const onPopState = () => {
      if (pendingHistory?.phase === "accepting") {
        const target = pendingHistory.target;
        pendingHistory = null;
        accepted(target);
        return;
      }
      if (pendingHistory?.phase === "restoring") {
        const request = pendingHistory;
        request.phase = "confirming";
        void confirmUnsavedNavigation().then(leave => {
          if (pendingHistory !== request) return;
          if (!leave) { pendingHistory = null; return; }
          request.phase = "accepting";
          window.history.go(request.delta);
        });
        return;
      }
      if (pendingHistory) {
        const offset = historyIndex.current - historyPosition();
        if (offset) window.history.go(offset);
        return;
      }
      const target = parseAppLocation();
      const delta = historyPosition() - historyIndex.current;
      if (!delta || !hasUnsavedChanges()) { accepted(target); return; }
      pendingHistory = { target, delta, phase: "restoring" };
      window.history.go(-delta);
    };
    const onExpired = () => setSessionExpired(true);
    window.addEventListener("popstate", onPopState);
    window.addEventListener("app:history-written", onWritten);
    window.addEventListener("api:session-expired", onExpired);
    return () => {
      pendingHistory = null;
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("app:history-written", onWritten);
      window.removeEventListener("api:session-expired", onExpired);
    };
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
    if (!academicYear || !["actions", "probation"].includes(route)) return;
    try {
      setActions(await api.actions(false, academicYear));
    } catch {
      // keep the previous list when a refresh fails
    }
  }, [academicYear, route]);

  const effectivePermissions = useMemo(
    () => ucoAccess?.canAccess && !user.permissions.includes("uco_tla.manage")
      ? [...user.permissions, "uco_tla.manage"]
      : user.permissions,
    [ucoAccess?.canAccess, user.permissions]
  );
  const accessibleNavigationItems = useMemo(
    () => navigationItems.filter((item) => canAccessRoute(item.key, effectivePermissions)),
    [effectivePermissions]
  );
  const visibleNavigationItems = useMemo(
    () => accessibleNavigationItems.filter((item) => !("hidden" in item && item.hidden)),
    [accessibleNavigationItems]
  );
  const activeItem = useMemo(() => accessibleNavigationItems.find((item) => item.key === route), [route, accessibleNavigationItems]);

  useEffect(() => {
    if (isLoading || !user.userAccountId || pendingRecordId || sourceRecordId
        || ((route === "uco" || route === "dashboard") && !ucoAccessLoaded) || canAccessRoute(route, effectivePermissions)) return;
    setRoute("home");
    setProfileStaffId("");
    setActionStaffId("");
    setActionDetailId("");
    setAdminTab("overview");
    setLinkError("You do not have permission to open that area.");
    writePath(routePath("home"), true);
  }, [effectivePermissions, isLoading, pendingRecordId, route, sourceRecordId, ucoAccessLoaded, user.userAccountId, writePath]);

  const yearActions = useMemo(
    () => academicYear ? actions.filter((action) => action.academicYear === academicYear) : actions,
    [academicYear, actions]
  );
  async function navigate(nextRoute: AppRoute) {
    if (!await confirmUnsavedNavigation()) return;
    setMobileNavigationOpen(false);

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

  async function openTeamProfile(staffId: string) {
    if (!await confirmUnsavedNavigation()) return;
    setMobileNavigationOpen(false);
    setProfileStaffId(staffId);
    setActionStaffId("");
    setActionDetailId("");
    setSourceRecordId("");
    setRoute("profile");
    writePath(staffPath(staffId));
  }

  async function openTeamActions(staffId: string) {
    if (!await confirmUnsavedNavigation()) return;
    setMobileNavigationOpen(false);
    setActionStaffId(staffId);
    setActionDetailId("");
    setProfileStaffId("");
    setSourceRecordId("");
    setRoute("actions");
    writePath(staffActionsPath(staffId));
  }

  async function openElevateReport(staffId: string, elevateRecordId: string) {
    if (!await confirmUnsavedNavigation()) return;
    setMobileNavigationOpen(false);
    setProfileStaffId(staffId);
    setActionStaffId("");
    setActionDetailId("");
    setSourceRecordId(elevateRecordId);
    setRoute("profile");
    writePath(recordPath(elevateRecordId));
  }

  async function openUcoTlaReview(recordId: string) {
    if (!await confirmUnsavedNavigation()) return;
    setMobileNavigationOpen(false);
    setSourceRecordId(recordId);
    setActionStaffId("");
    setActionDetailId("");
    setProfileStaffId("");
    setRoute("uco");
    writePath(`/uco-tla-reviews/${recordId}`);
  }

  async function openActionSource(action: ActionSummary) {
    if (!await confirmUnsavedNavigation()) return;
    setMobileNavigationOpen(false);
    if (!action.sourceRecordId) return;
    if (action.sourceFormType === "qa_review") {
      setSourceRecordId("");
      setActionStaffId("");
      setActionDetailId("");
      setProfileStaffId("");
      setRoute("qa");
      writePath(`/qa-hub/reviews/${action.sourceRecordId}/actions`);
      return;
    }
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

  async function openAdminRecord(record: AdminRecord) {
    if (!await confirmUnsavedNavigation()) return;
    setMobileNavigationOpen(false);
    setSourceRecordId(record.recordId);
    setActionStaffId("");
    setActionDetailId("");
    const nextRoute = routeForRecordType(record.recordType);
    setProfileStaffId(nextRoute === "profile" ? record.subjectStaffId ?? "" : "");
    setRoute(nextRoute);
    writePath(recordPath(record.recordId));
  }

  async function openStaffRecord(recordType: string, recordId: string, staffId: string) {
    if (!await confirmUnsavedNavigation()) return;
    setMobileNavigationOpen(false);
    if (recordType === "qa_review") {
      setSourceRecordId("");
      setActionStaffId("");
      setActionDetailId("");
      setProfileStaffId("");
      setRoute("qa");
      writePath(`/qa-hub/reviews/${recordId}/actions`);
      return;
    }
    setSourceRecordId(recordId);
    setActionStaffId("");
    setActionDetailId("");
    const nextRoute = routeForRecordType(recordType);
    setProfileStaffId(nextRoute === "profile" ? staffId : "");
    setRoute(nextRoute);
    writePath(recordPath(recordId));
  }

  async function openActionDetails(actionId: string, staffId: string) {
    if (!await confirmUnsavedNavigation()) return;
    setMobileNavigationOpen(false);
    setActionDetailId(actionId);
    setActionStaffId(staffId);
    setProfileStaffId("");
    setSourceRecordId("");
    setRoute("actions");
    writePath(actionPath(actionId));
  }

  async function openDashboardRecord(recordId: string) {
    if (!await confirmUnsavedNavigation()) return;
    setMobileNavigationOpen(false);
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
      <UnsavedChangesGuard />
      <aside className={`sidebar${mobileNavigationOpen ? " mobile-navigation-open" : ""}`} aria-label="Main navigation" id="main-navigation">
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
        <button className="button mobile-navigation-button" aria-expanded={mobileNavigationOpen} aria-controls="mobile-navigation-links" onClick={() => setMobileNavigationOpen(open => !open)} type="button"><Menu size={18} aria-hidden="true" />{mobileNavigationOpen ? "Close menu" : "Menu"}</button>
        <div id="mobile-navigation-links" className="sidebar-navigation-wrapper"><SidebarNavigation items={visibleNavigationItems} route={route} onNavigate={navigate} /></div>
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
          <div className="topbar-context">{activeItem?.label ?? "i-Elevate"}</div>
          {academicYears.length > 0 ? (
            <label className="academic-year-selector">
              <CalendarDays size={16} aria-hidden="true" />
              <span className="sr-only">Academic year</span>
              <select aria-label="Academic year" onChange={async (event) => { const nextYear = event.target.value; if (await confirmUnsavedNavigation()) setAcademicYear(nextYear); }} value={academicYear}>
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
          <UserMenu displayName={user.displayName} />
        </header>

        {Object.entries(lookupErrors).filter(([, message]) => message).length > 0 ? <div className="api-error-banner" role="alert"><div>{Object.entries(lookupErrors).filter(([, message]) => message).map(([key, message]) => <p key={key}>{key === "staff" ? "Staff directory" : key === "actions" ? "Actions" : "System modules"} unavailable: {message}</p>)}</div><button type="button" onClick={() => { setLookupErrors({}); setModulesLoaded(false); setStaffLoaded(false); setLookupAttempt(value => value + 1); }}>Retry loading</button></div> : null}
        {sessionExpired ? <div className="api-error-banner" role="alert"><span>Your session has expired. Your unsaved work remains on this page. Copy any work you need before signing in again.</span><button type="button" onClick={async () => { if (await confirmUnsavedNavigation()) window.location.assign("/"); }}>Sign in again</button></div> : null}
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
          {!isLoading && user.userAccountId && qaHubSummary?.canAccessHub === true ? (
            <WorkspaceSwitch active={route === "qa" ? "qa" : "elevate"}
              onChange={(workspace) => navigate(workspace === "qa" ? "qa" : "home")} />
          ) : null}
          {isLoading ? (
            <div className="route-stack">
              <p className="muted-copy">Loading i-Elevate...</p>
            </div>
          ) : loadError && !user.userAccountId ? (
            <section className="panel"><h1>Unable to load your account</h1><p>Use Retry above to reconnect. Your account access has not been checked yet.</p></section>
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
                  orgUnits={orgUnits}
                  ucoAccess={ucoAccess}
                  user={user}
                  onOpenAction={openActionDetails}
                  onOpenRecord={openDashboardRecord}
                  onOpenStaff={openTeamProfile}
                  onOpenUcoReview={openUcoTlaReview}
                />
              ) : null}
              {route === "staff" ? <StaffProfiles academicYear={academicYear} onOpenActionDetails={openActionDetails} onOpenRecord={openStaffRecord} onStaffSelected={(staffId) => writePath(staffPath(staffId))} staff={staff} user={user} /> : null}
              {route === "team" ? <MyTeam onOpenActions={openTeamActions} onOpenProfile={openTeamProfile} /> : null}
              {route === "admin" ? <AdminCentre initialTab={adminTab} modules={modules} onOpenRecord={openAdminRecord} onTabChange={handleAdminTabChanged} staff={staff} user={user} /> : null}
              {route === "learning" ? (
                <ModuleWorkspace academicYear={academicYear} eyebrow="Teaching and learning activity" initialRecordId={sourceRecordId} mode="learning" onActionsChanged={refreshActions} onRecordClosed={() => handleRecordClosed("learning")} onRecordOpened={handleRecordOpened} staff={staff} title="Learning Walks" user={user} />
              ) : null}
              {route === "liv" ? (
                <LivVisits
                  academicYear={academicYear}
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
              {route === "als_learning" ? (
                <ModuleWorkspace academicYear={academicYear} eyebrow="Additional Learning Support" initialRecordId={sourceRecordId} mode="als_learning" onActionsChanged={refreshActions} onRecordClosed={() => handleRecordClosed("als_learning")} onRecordOpened={handleRecordOpened} staff={staff} title="ALS Learning Walks" user={user} />
              ) : null}
              {route === "als_liv" ? (
                <LivVisits
                  academicYear={academicYear}
                  initialSourceRecordId={sourceRecordId}
                  onActionsChanged={refreshActions}
                  onOpenStaffProfile={openTeamProfile}
                  onRecordClosed={() => handleRecordClosed("als_liv")}
                  onRecordOpened={handleRecordOpened}
                  orgUnits={orgUnits}
                  processKey="als_liv"
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
                  onOpenUcoTlaReview={openUcoTlaReview}
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
              {route === "profile" ? <StaffProfileWorkspace academicYear={academicYear} initialElevateRecordId={sourceRecordId} initialStaffId={profileStaffId} onOpenActionDetails={openActionDetails} onOpenRecord={openStaffRecord} onStaffChanged={(staffId) => writePath(staffPath(staffId))} staff={staff} user={user} /> : null}
              {route === "actions" ? (
                <ActionsView academicYear={academicYear} actions={yearActions} initialActionId={actionDetailId} initialStaffId={actionStaffId} onActionClosed={handleActionClosed} onActionOpened={handleActionOpened} onChanged={refreshActions} onOpenSource={openActionSource} orgUnits={orgUnits} staff={staff} user={user} />
              ) : null}
              {route === "uco" ? (
                <UcoTlaReviews
                  access={ucoAccess}
                  academicYear={academicYear}
                  initialRecordId={sourceRecordId}
                  onActionsChanged={refreshActions}
                  onRecordClosed={() => handleRecordClosed("uco")}
                  onRecordOpened={handleRecordOpened}
                />
              ) : null}
              {route === "qa" ? (
                <QaHub
                  academicYears={academicYears}
                  onReturnToElevate={() => navigate("home")}
                  orgUnits={orgUnits}
                  staff={staff}
                  user={user}
                />
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
    als_learning_walk: "als_learning",
    liv: "liv",
    als_liv: "als_liv",
    probation_case: "probation",
    probation_observation: "probation",
    uco_tla_review: "uco",
    qa_review: "qa",
    work_scrutiny: "scrutiny"
  };
  return routes[recordType] ?? "dashboard";
}
