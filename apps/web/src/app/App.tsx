import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, LogOut, PanelLeftClose, Search } from "lucide-react";
import { navigationItems, type AppRoute } from "./navigation";
import { api } from "../services/api";
import { isAuthEnabled, signOut } from "../services/auth";
import { FirstTimeOnboarding } from "../components/FirstTimeOnboarding";
import type {
  ActionSummary,
  AdminRecord,
  CurrentUser,
  ModuleSummary,
  OrgUnitSummary,
  ProcessDashboardRecordSummary,
  StaffProfileSummary,
  StaffSummary
} from "../services/types";

const Dashboard = lazy(() => import("../routes/Dashboard").then((module) => ({ default: module.Dashboard })));
const StaffProfiles = lazy(() => import("../routes/StaffProfiles").then((module) => ({ default: module.StaffProfiles })));
const AdminCentre = lazy(() => import("../routes/AdminCentre").then((module) => ({ default: module.AdminCentre })));
const LivVisits = lazy(() => import("../routes/LivVisits").then((module) => ({ default: module.LivVisits })));
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
  const [route, setRoute] = useState<AppRoute>("dashboard");
  const [user, setUser] = useState<CurrentUser>(emptyUser);
  const [modules, setModules] = useState<ModuleSummary[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnitSummary[]>([]);
  const [staff, setStaff] = useState<StaffSummary[]>([]);
  const [actions, setActions] = useState<ActionSummary[]>([]);
  const [processRecords, setProcessRecords] = useState<ProcessDashboardRecordSummary[]>([]);
  const [profiles, setProfiles] = useState<StaffProfileSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [profileStaffId, setProfileStaffId] = useState("");
  const [actionStaffId, setActionStaffId] = useState("");
  const [sourceRecordId, setSourceRecordId] = useState("");

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

      const [nextModules, nextOrgUnits, nextStaff, nextActions, nextProfiles] = await Promise.all([
        api.modules(),
        api.orgUnits(),
        api.staff().catch(() => [] as StaffSummary[]),
        api.actions(),
        api.staffProfiles()
      ]);
      setModules(nextModules);
      setOrgUnits(nextOrgUnits);
      setStaff(nextStaff);
      setActions(nextActions);
      setProfiles(nextProfiles);
      void api
        .processDashboardRecords()
        .then(setProcessRecords)
        .catch(() => setProcessRecords([]));
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

  const visibleNavigationItems = useMemo(
    () => navigationItems.filter((item) => {
      if (item.key === "team") return user.permissions.includes("my_team.view");
      if (item.key === "admin") {
        return ["users.manage", "permissions.manage", "organisation.manage", "lists.manage", "forms.manage", "records.manage"]
          .some((permission) => user.permissions.includes(permission));
      }
      return true;
    }),
    [user.permissions]
  );
  const activeItem = useMemo(() => visibleNavigationItems.find((item) => item.key === route), [route, visibleNavigationItems]);

  function navigate(nextRoute: AppRoute) {
    setProfileStaffId("");
    setActionStaffId("");
    setSourceRecordId("");
    setRoute(nextRoute);
  }

  function openTeamProfile(staffId: string) {
    setProfileStaffId(staffId);
    setActionStaffId("");
    setSourceRecordId("");
    setRoute("profile");
  }

  function openTeamActions(staffId: string) {
    setActionStaffId(staffId);
    setProfileStaffId("");
    setSourceRecordId("");
    setRoute("actions");
  }

  function openActionSource(action: ActionSummary) {
    if (!action.sourceRecordId) return;
    setSourceRecordId(action.sourceRecordId);
    setActionStaffId("");
    if (action.sourceFormType === "elevate_practice" && action.subjectStaffId) {
      setProfileStaffId(action.subjectStaffId);
      setRoute("profile");
      return;
    }
    setProfileStaffId("");
    const sourceRoutes: Partial<Record<string, AppRoute>> = {
      coaching_mentoring: "coaching",
      elevate_environment: "elevate",
      learning_walk: "learning",
      liv: "liv",
      work_scrutiny: "scrutiny"
    };
    setRoute(sourceRoutes[action.sourceFormType] ?? "actions");
  }

  function openAdminRecord(record: AdminRecord) {
    setSourceRecordId(record.recordId);
    setActionStaffId("");
    if (["elevate_practice", "elevate_practice_assessment"].includes(record.recordType) && record.subjectStaffId) {
      setProfileStaffId(record.subjectStaffId);
      setRoute("profile");
      return;
    }
    setProfileStaffId("");
    const recordRoutes: Partial<Record<string, AppRoute>> = {
      coaching_session: "coaching",
      cpd_event: "cpd",
      elevate_environment: "elevate",
      learning_walk: "learning",
      liv: "liv",
      work_scrutiny: "scrutiny"
    };
    setRoute(recordRoutes[record.recordType] ?? "dashboard");
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
            <Suspense fallback={<div className="route-stack"><p className="muted-copy">Loading this workspace...</p></div>}>
              {route === "dashboard" ? (
                <Dashboard
                  actions={actions}
                  orgUnits={orgUnits}
                  processRecords={processRecords}
                  user={user}
                  onRefresh={loadCoreData}
                />
              ) : null}
              {route === "staff" ? <StaffProfiles staff={staff} profiles={profiles} user={user} /> : null}
              {route === "team" ? <MyTeam onOpenActions={openTeamActions} onOpenProfile={openTeamProfile} /> : null}
              {route === "admin" ? <AdminCentre user={user} modules={modules} profiles={profiles} staff={staff} onOpenRecord={openAdminRecord} /> : null}
              {route === "learning" ? (
                <ModuleWorkspace title="Learning Walks" eyebrow="Quality activity" initialRecordId={sourceRecordId} mode="learning" staff={staff} user={user} onActionsChanged={refreshActions} />
              ) : null}
              {route === "liv" ? <LivVisits initialSourceRecordId={sourceRecordId} staff={staff} user={user} onActionsChanged={refreshActions} /> : null}
              {route === "elevate" ? (
                <ModuleWorkspace
                  title="Elevate Learning Environments"
                  eyebrow="Learning environment quality"
                  initialRecordId={sourceRecordId}
                  mode="elevate"
                  staff={staff}
                  user={user}
                  onActionsChanged={refreshActions}
                />
              ) : null}
              {route === "practice" ? <ElevatePractice user={user} onActionsChanged={refreshActions} /> : null}
              {route === "coaching" ? (
                <CoachingMentoring initialRecordId={sourceRecordId} staff={staff} user={user} onActionsChanged={refreshActions} />
              ) : null}
              {route === "scrutiny" ? (
                <ModuleWorkspace title="Work Scrutiny" eyebrow="Quality activity" initialRecordId={sourceRecordId} mode="scrutiny" staff={staff} user={user} onActionsChanged={refreshActions} />
              ) : null}
              {route === "cpd" ? (
                <ModuleWorkspace title="CPD Management" eyebrow="Professional learning" mode="cpd" staff={staff} user={user} onActionsChanged={refreshActions} />
              ) : null}
              {route === "profile" ? <StaffProfileWorkspace initialElevateRecordId={sourceRecordId} initialStaffId={profileStaffId} profiles={profiles} staff={staff} user={user} /> : null}
              {route === "actions" ? (
                <ActionsView actions={actions} initialStaffId={actionStaffId} onOpenSource={openActionSource} orgUnits={orgUnits} staff={staff} user={user} onChanged={refreshActions} />
              ) : null}
            </Suspense>
          )}
        </div>
      </main>
    </div>
  );
}
