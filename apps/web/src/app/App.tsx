import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, LogOut, PanelLeftClose, Search } from "lucide-react";
import { navigationItems, type AppRoute } from "./navigation";
import { api } from "../services/api";
import { isAuthEnabled, signOut } from "../services/auth";
import type {
  ActionSummary,
  CurrentUser,
  ModuleSummary,
  OrgUnitSummary,
  ProcessDashboardRecordSummary,
  StaffProfileSummary,
  StaffSummary
} from "../services/types";
import { Dashboard } from "../routes/Dashboard";
import { StaffProfiles } from "../routes/StaffProfiles";
import { AdminCentre } from "../routes/AdminCentre";
import { LivVisits } from "../routes/LivVisits";
import { ModuleWorkspace } from "../routes/ModuleWorkspace";
import { ActionsView } from "../routes/ActionsView";
import { PermissionsView } from "../routes/PermissionsView";
import { StaffProfileWorkspace } from "../routes/StaffProfileWorkspace";
import { ElevatePractice } from "../routes/ElevatePractice";
import { CoachingMentoring } from "../routes/CoachingMentoring";
import { RecordDetailPage, type DetailRoute } from "../routes/RecordDetailPage";

const emptyUser: CurrentUser = {
  displayName: "Loading...",
  email: "",
  permissions: [],
  scopes: []
};

export function App() {
  const [route, setRoute] = useState<AppRoute>("dashboard");
  const [detailRoute, setDetailRoute] = useState<DetailRoute | null>(() => parseDetailRoute(window.location.hash));
  const detailOpenedInApp = useRef(false);
  const [user, setUser] = useState<CurrentUser>(emptyUser);
  const [modules, setModules] = useState<ModuleSummary[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnitSummary[]>([]);
  const [staff, setStaff] = useState<StaffSummary[]>([]);
  const [actions, setActions] = useState<ActionSummary[]>([]);
  const [processRecords, setProcessRecords] = useState<ProcessDashboardRecordSummary[]>([]);
  const [profiles, setProfiles] = useState<StaffProfileSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const loadCoreData = useCallback(async () => {
    setLoadError("");
    try {
      const nextUser = await api.currentUser();
      setUser(nextUser);
      setRoute((currentRoute) => currentRoute === "dashboard" ? getDefaultHomeRoute(nextUser) : currentRoute);
      if (!nextUser.userAccountId) {
        setModules([]);
        setOrgUnits([]);
        setStaff([]);
        setActions([]);
        setProcessRecords([]);
        setProfiles([]);
        return;
      }

      const [nextModules, nextOrgUnits, nextStaff, nextActions, nextProcessRecords, nextProfiles] = await Promise.all([
        api.modules(),
        api.orgUnits(),
        api.staff().catch(() => [] as StaffSummary[]),
        api.actions(),
        api.processDashboardRecords().catch(() => [] as ProcessDashboardRecordSummary[]),
        api.staffProfiles()
      ]);
      setModules(nextModules);
      setOrgUnits(nextOrgUnits);
      setStaff(nextStaff);
      setActions(nextActions);
      setProcessRecords(nextProcessRecords);
      setProfiles(nextProfiles);
    } catch {
      setLoadError(
        "The Teaching & Learning API could not be reached. Start the API (scripts\\run-api.ps1) and check the database, then refresh."
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCoreData();
  }, [loadCoreData]);

  useEffect(() => {
    const handleHashChange = (event: HashChangeEvent) => {
      const nextDetailRoute = parseDetailRoute(window.location.hash);
      if (nextDetailRoute) {
        detailOpenedInApp.current = detailOpenedInApp.current || new URL(event.oldURL).hash.length === 0;
      } else {
        detailOpenedInApp.current = false;
      }
      setDetailRoute(nextDetailRoute);
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const refreshActions = useCallback(async () => {
    try {
      setActions(await api.actions());
    } catch {
      // keep the previous list when a refresh fails
    }
  }, []);

  const activeItem = useMemo(() => navigationItems.find((item) => item.key === route), [route]);

  const navigateTo = (nextRoute: AppRoute) => {
    if (window.location.hash) {
      window.history.pushState(null, "", `${window.location.pathname}${window.location.search}`);
      setDetailRoute(null);
      detailOpenedInApp.current = false;
    }
    setRoute(nextRoute);
  };

  const returnFromDetail = () => {
    if (detailOpenedInApp.current) {
      window.history.back();
    } else {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      setDetailRoute(null);
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Main navigation">
        <button
          className="brand-block"
          onClick={() => navigateTo(getDefaultHomeRoute(user))}
          title={getDefaultHomeRoute(user) === "dashboard" ? "Go to dashboard" : "Go to Staff Profile"}
          type="button"
        >
          <img alt="iElevate" className="brand-logo" src="/assets/elevate-logo.png" />
        </button>
        <nav>
          {navigationItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={item.key === route ? "nav-item nav-item-active" : "nav-item"}
                key={item.key}
                onClick={() => navigateTo(item.key)}
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
          <button className="icon-button" title="Collapse navigation" type="button">
            <PanelLeftClose size={18} aria-hidden="true" />
          </button>
          <div className="topbar-search">
            <Search size={16} aria-hidden="true" />
            <input aria-label="Search quality system" placeholder="Search staff, actions, records" />
          </div>
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

        <div className="content-frame" aria-label={detailRoute ? "Full record" : activeItem?.label ?? "Dashboard"}>
          {isLoading ? (
            <div className="route-stack">
              <p className="muted-copy">Loading the Teaching &amp; Learning system...</p>
            </div>
          ) : !user.userAccountId ? (
            <section className="access-denied-panel">
              <AlertTriangle size={22} aria-hidden="true" />
              <div>
                <h1>Account not provisioned</h1>
                <p>
                  Your Microsoft sign-in was successful, but this email address is not linked to an active Quality System account.
                </p>
                <p className="muted-copy">Signed in as {user.email || "unknown account"}</p>
              </div>
              {isAuthEnabled ? (
                <button onClick={signOut} type="button">Sign out</button>
              ) : null}
            </section>
          ) : (
            <>
              {detailRoute ? <RecordDetailPage route={detailRoute} onBack={returnFromDetail} /> : null}
              {!detailRoute && route === "dashboard" ? (
                <Dashboard
                  actions={actions}
                  orgUnits={orgUnits}
                  processRecords={processRecords}
                  user={user}
                  onRefresh={loadCoreData}
                />
              ) : null}
              {!detailRoute && route === "staff" ? <StaffProfiles staff={staff} profiles={profiles} user={user} /> : null}
              {!detailRoute && route === "admin" ? <AdminCentre user={user} modules={modules} profiles={profiles} staff={staff} /> : null}
              {!detailRoute && route === "learning" ? (
                <ModuleWorkspace title="Learning Walks" eyebrow="Quality activity" mode="learning" staff={staff} user={user} onActionsChanged={refreshActions} />
              ) : null}
              {!detailRoute && route === "liv" ? <LivVisits staff={staff} user={user} onActionsChanged={refreshActions} /> : null}
              {!detailRoute && route === "elevate" ? (
                <ModuleWorkspace
                  title="Elevate Learning Environments"
                  eyebrow="Learning environment quality"
                  mode="elevate"
                  staff={staff}
                  user={user}
                  onActionsChanged={refreshActions}
                />
              ) : null}
              {!detailRoute && route === "practice" ? <ElevatePractice user={user} onActionsChanged={refreshActions} /> : null}
              {!detailRoute && route === "coaching" ? (
                <CoachingMentoring staff={staff} user={user} onActionsChanged={refreshActions} />
              ) : null}
              {!detailRoute && route === "scrutiny" ? (
                <ModuleWorkspace title="Work Scrutiny" eyebrow="Quality activity" mode="scrutiny" staff={staff} user={user} onActionsChanged={refreshActions} />
              ) : null}
              {!detailRoute && route === "cpd" ? (
                <ModuleWorkspace title="CPD Management" eyebrow="Professional learning" mode="cpd" staff={staff} user={user} onActionsChanged={refreshActions} />
              ) : null}
              {!detailRoute && route === "profile" ? <StaffProfileWorkspace profiles={profiles} staff={staff} user={user} /> : null}
              {!detailRoute && route === "actions" ? (
                <ActionsView actions={actions} staff={staff} user={user} onChanged={refreshActions} />
              ) : null}
              {!detailRoute && route === "security" ? <PermissionsView /> : null}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function getDefaultHomeRoute(user: Pick<CurrentUser, "permissions">): AppRoute {
  return user.permissions.includes("reports.view_all") || user.permissions.includes("reports.view_scoped")
    ? "dashboard"
    : "profile";
}

function parseDetailRoute(hash: string): DetailRoute | null {
  const recordMatch = hash.match(/^#\/records\/([^/]+)\/([^/]+)$/);
  if (recordMatch) {
    return {
      kind: "record",
      recordType: decodeURIComponent(recordMatch[1]),
      recordId: decodeURIComponent(recordMatch[2])
    };
  }

  const actionMatch = hash.match(/^#\/actions\/([^/]+)$/);
  return actionMatch ? { kind: "action", actionId: decodeURIComponent(actionMatch[1]) } : null;
}
