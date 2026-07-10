import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, LogOut, PanelLeftClose, Search } from "lucide-react";
import { navigationItems, type AppRoute } from "./navigation";
import { api } from "../services/api";
import { isAuthEnabled, signOut } from "../services/auth";
import type {
  ActionSummary,
  CurrentUser,
  DashboardSummary,
  ModuleSummary,
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

const emptyUser: CurrentUser = {
  displayName: "Loading...",
  email: "",
  permissions: [],
  scopes: []
};

export function App() {
  const [route, setRoute] = useState<AppRoute>("dashboard");
  const [user, setUser] = useState<CurrentUser>(emptyUser);
  const [modules, setModules] = useState<ModuleSummary[]>([]);
  const [staff, setStaff] = useState<StaffSummary[]>([]);
  const [actions, setActions] = useState<ActionSummary[]>([]);
  const [dashboards, setDashboards] = useState<DashboardSummary[]>([]);
  const [profiles, setProfiles] = useState<StaffProfileSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const loadCoreData = useCallback(async () => {
    setLoadError("");
    try {
      const [nextUser, nextModules, nextStaff, nextActions, nextDashboards, nextProfiles] = await Promise.all([
        api.currentUser(),
        api.modules(),
        api.staff().catch(() => [] as StaffSummary[]),
        api.actions(),
        api.dashboards(),
        api.staffProfiles()
      ]);
      setUser(nextUser);
      setModules(nextModules);
      setStaff(nextStaff);
      setActions(nextActions);
      setDashboards(nextDashboards);
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

  const refreshActions = useCallback(async () => {
    try {
      setActions(await api.actions());
    } catch {
      // keep the previous list when a refresh fails
    }
  }, []);

  const activeItem = useMemo(() => navigationItems.find((item) => item.key === route), [route]);

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand-block">
          <div className="brand-mark">TL</div>
          <div>
            <strong>Quality System</strong>
            <span>Teaching & Learning</span>
          </div>
        </div>
        <nav>
          {navigationItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={item.key === route ? "nav-item nav-item-active" : "nav-item"}
                key={item.key}
                onClick={() => setRoute(item.key)}
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

        <div className="content-frame" aria-label={activeItem?.label ?? "Dashboard"}>
          {isLoading ? (
            <div className="route-stack">
              <p className="muted-copy">Loading the Teaching &amp; Learning system...</p>
            </div>
          ) : (
            <>
              {route === "dashboard" ? (
                <Dashboard
                  modules={modules}
                  actions={actions}
                  dashboards={dashboards}
                  staffProfiles={profiles}
                  user={user}
                  onRefresh={loadCoreData}
                />
              ) : null}
              {route === "staff" ? <StaffProfiles staff={staff} profiles={profiles} user={user} /> : null}
              {route === "admin" ? <AdminCentre user={user} modules={modules} profiles={profiles} staff={staff} /> : null}
              {route === "learning" ? (
                <ModuleWorkspace title="Learning Walks" eyebrow="Quality activity" mode="learning" staff={staff} user={user} onActionsChanged={refreshActions} />
              ) : null}
              {route === "liv" ? <LivVisits staff={staff} user={user} onActionsChanged={refreshActions} /> : null}
              {route === "scrutiny" ? (
                <ModuleWorkspace title="Work Scrutiny" eyebrow="Quality activity" mode="scrutiny" staff={staff} user={user} onActionsChanged={refreshActions} />
              ) : null}
              {route === "cpd" ? (
                <ModuleWorkspace title="CPD Management" eyebrow="Professional learning" mode="cpd" staff={staff} user={user} onActionsChanged={refreshActions} />
              ) : null}
              {route === "profile" ? <StaffProfileWorkspace profiles={profiles} staff={staff} user={user} /> : null}
              {route === "actions" ? (
                <ActionsView actions={actions} staff={staff} user={user} onChanged={refreshActions} />
              ) : null}
              {route === "security" ? <PermissionsView /> : null}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
