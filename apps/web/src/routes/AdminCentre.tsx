import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Building2, Database, Edit3, FileText, LayoutDashboard, ListChecks, Mail, Plus, RefreshCw, Save, Search, ShieldCheck, SlidersHorizontal, Sparkles, UserCog, UserMinus, UserPlus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../design-system/Button";
import { api } from "../services/api";
import type {
  AdminRoleSummary,
  AdminRecord,
  AdminUserSummary,
  CurrentUser,
  DashboardProcessConfiguration,
  LearningWalkTheme,
  LearningWalkThemeGroup,
  ModuleSummary,
  OrgUnitSummary,
  StaffProfileRecordSummary,
  StaffProfileSummary,
  StaffSummary
} from "../services/types";
import { FormBuilder } from "./FormBuilder";
import { AdminElevatePractice } from "./AdminElevatePractice";
import { AdminWorkScrutiny } from "./AdminWorkScrutiny";
import { AdminManagedLists } from "./AdminManagedLists";
import { AdminRecordsPanel } from "./AdminRecordsPanel";
import { OrganisationStructureAdmin } from "./OrganisationStructureAdmin";
import { MessagingAdminPanel } from "./MessagingAdminPanel";

export function AdminCentre({
  user,
  modules,
  profiles,
  staff,
  onOpenRecord,
  initialTab = "overview",
  onTabChange
}: {
  user: CurrentUser;
  modules: ModuleSummary[];
  profiles: StaffProfileSummary[];
  staff: StaffSummary[];
  onOpenRecord: (record: AdminRecord) => void;
  initialTab?: string;
  onTabChange?: (tab: string) => void;
}) {
  const requestedTab = adminTabs.some((tab) => tab.key === initialTab) ? initialTab as AdminTabKey : "overview";
  const [activeTab, setActiveTab] = useState<AdminTabKey>(requestedTab);
  const permissionRows = [
    ["Admin", "System maintenance, users, records and labels", "Global"],
    ["Teaching & Learning", "Forms, CPD, LIV, reports and actions", "Global"],
    ["Director", "Scoped reports and review activity", "Assigned org units"],
    ["Head of Faculty", "Faculty records, actions and dashboards", "Assigned faculty"],
    ["Programme Leader", "Team records, actions and dashboards", "Assigned team"],
    ["Tutor", "Own profile, records and actions", "Self"]
  ];
  const canManagePeople = user.permissions.includes("users.manage") || user.permissions.includes("permissions.manage");
  const canManageOrganisation = user.permissions.includes("organisation.manage");
  const canManageLists = user.permissions.includes("lists.manage");
  const canManageForms = user.permissions.includes("forms.manage");
  const canManageRecords = user.permissions.includes("records.manage");
  const canManageMessaging = user.permissions.includes("messaging.manage");
  const canUseAdmin = canManagePeople || canManageOrganisation || canManageLists || canManageForms || canManageRecords || canManageMessaging;
  const tabAccess: Record<AdminTabKey, boolean> = {
    overview: canUseAdmin,
    "staff-access": canManagePeople,
    organisation: canManageOrganisation,
    lists: canManageLists,
    forms: canManageForms,
    elevate: canManageRecords || user.permissions.includes("users.manage"),
    records: canManageRecords,
    messaging: canManageMessaging,
    dashboards: canManageRecords
  };
  const visibleTabs = adminTabs.filter((tab) => tabAccess[tab.key]);

  function selectTab(tab: AdminTabKey) {
    setActiveTab(tab);
    onTabChange?.(tab);
  }

  useEffect(() => {
    if (tabAccess[requestedTab]) setActiveTab(requestedTab);
  }, [requestedTab]);

  useEffect(() => {
    if (!tabAccess[activeTab]) {
      selectTab(visibleTabs[0]?.key ?? "overview");
    }
  }, [activeTab, tabAccess, visibleTabs]);

  if (!canUseAdmin) {
    return (
      <div className="route-stack">
        <div className="route-header">
          <div>
            <p className="eyebrow">Configuration</p>
            <h1>Admin centre</h1>
          </div>
        </div>
        <section className="panel">
          <div className="panel-heading">
            <h2>Access restricted</h2>
            <span>Admin only</span>
          </div>
          <p className="muted-copy">You do not have permission to manage system administration.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="route-stack">
      <div className="route-header">
        <div>
          <p className="eyebrow">Configuration</p>
          <h1>Admin centre</h1>
        </div>
      </div>

      <div className="admin-tab-bar" role="tablist" aria-label="Admin centre sections">
        {visibleTabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              aria-selected={activeTab === tab.key}
              className={activeTab === tab.key ? "admin-tab admin-tab-active" : "admin-tab"}
              key={tab.key}
              onClick={() => selectTab(tab.key)}
              role="tab"
              type="button"
            >
              <Icon size={16} aria-hidden="true" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {activeTab === "overview" ? (
        <AdminOverview
          modules={modules}
          onOpenLookups={() => selectTab("lists")}
          permissionRows={permissionRows}
          user={user}
        />
      ) : null}
      {activeTab === "staff-access" ? <div className="route-stack"><StaffAdminPanel user={user} /><PermissionAdminPanel user={user} /></div> : null}
      {activeTab === "organisation" ? <OrganisationStructureAdmin /> : null}
      {activeTab === "lists" ? <div className="route-stack"><CoachingConfigurationAdmin /><AdminManagedLists /><LearningWalkThemeAdminPanel /></div> : null}
      {activeTab === "forms" ? <FormBuilder embedded user={user} /> : null}
      {activeTab === "elevate" ? <AdminElevatePractice /> : null}
      {activeTab === "records" ? <AdminRecordsPanel onOpenRecord={onOpenRecord} /> : null}
      {activeTab === "messaging" ? <MessagingAdminPanel /> : null}
      {activeTab === "dashboards" ? <DashboardAdminPanel /> : null}
    </div>
  );
}

type AdminTabKey = "overview" | "staff-access" | "organisation" | "lists" | "forms" | "elevate" | "records" | "messaging" | "dashboards";

const adminTabs: Array<{ key: AdminTabKey; label: string; icon: typeof SlidersHorizontal }> = [
  { key: "overview", label: "Overview", icon: SlidersHorizontal },
  { key: "staff-access", label: "Staff & Access", icon: UserCog },
  { key: "organisation", label: "Organisation Structure", icon: Building2 },
  { key: "lists", label: "Admin Lists", icon: ListChecks },
  { key: "forms", label: "Forms", icon: FileText },
  { key: "elevate", label: "Elevate Records", icon: Sparkles },
  { key: "records", label: "Records", icon: Database },
  { key: "messaging", label: "Messaging", icon: Mail },
  { key: "dashboards", label: "Dashboards", icon: LayoutDashboard }
];

function AdminOverview({
  modules,
  onOpenLookups,
  permissionRows,
  user
}: {
  modules: ModuleSummary[];
  onOpenLookups: () => void;
  permissionRows: string[][];
  user: CurrentUser;
}) {
  return (
    <>
      <div className="three-column">
        <section className="panel">
          <div className="panel-heading">
            <h2>Current access</h2>
            <span>{user.scopes[0]?.scopeType ?? "none"}</span>
          </div>
          <dl className="definition-list">
            <dt>User</dt>
            <dd>{user.displayName}</dd>
            <dt>Email</dt>
            <dd>{user.email}</dd>
            <dt>Permissions</dt>
            <dd>{user.permissions.length}</dd>
          </dl>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <h2>Enabled modules</h2>
            <span>{modules.filter((module) => module.isEnabled).length}</span>
          </div>
          <div className="toggle-list">
            {modules.map((module) => (
              <label key={module.id} className="toggle-row">
                <span>{module.name}</span>
                <input type="checkbox" defaultChecked={module.isEnabled} disabled />
              </label>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <h2>Lookup control</h2>
            <span>Admin editable</span>
          </div>
          <div className="lookup-list">
            <button className="lookup-row" onClick={onOpenLookups} type="button">CPD themes</button>
            <button className="lookup-row" onClick={onOpenLookups} type="button">Coaching qualification statuses</button>
            <button className="lookup-row" onClick={onOpenLookups} type="button">Coaching focus areas</button>
            <button className="lookup-row" onClick={onOpenLookups} type="button">Coaching support types</button>
            <button className="lookup-row" onClick={onOpenLookups} type="button">Action themes by process</button>
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-heading">
          <h2>Role model</h2>
          <span>RBAC plus scope</span>
        </div>
        <div className="permission-grid">
          {permissionRows.map(([role, permissions, scope]) => (
            <div className="permission-row" key={role}>
              <strong>{role}</strong>
              <span>{permissions}</span>
              <span>{scope}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function CoachingConfigurationAdmin() {
  const [maxActions, setMaxActions] = useState("3");
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    void api.coachingConfiguration()
      .then((configuration) => setMaxActions(String(configuration.maxActionsPerSession)))
      .catch(() => setMessage("Coaching configuration could not be loaded."));
  }, []);

  async function saveConfiguration() {
    const value = Number(maxActions);
    if (!Number.isInteger(value) || value < 1 || value > 10) {
      setMessage("Enter a maximum between 1 and 10 actions.");
      return;
    }

    setIsSaving(true);
    const result = await api.updateCoachingConfiguration(value);
    setIsSaving(false);
    setMessage(result.ok ? "Coaching action limit updated." : result.message ?? "The coaching configuration could not be saved.");
  }

  return (
    <section className="panel">
      <div className="panel-heading"><div><h2>Coaching workflow</h2><span>Session-level configuration</span></div></div>
      <div className="lookup-admin-toolbar">
        <label className="entry-field"><span>Maximum new actions per session</span><input max={10} min={1} onChange={(event) => setMaxActions(event.target.value)} type="number" value={maxActions} /></label>
        <Button disabled={isSaving} icon={Save} onClick={() => void saveConfiguration()} variant="primary">Save setting</Button>
      </div>
      {message ? <div className="notice-row" role="status">{message}</div> : null}
    </section>
  );
}

function LookupAdminPanel() {
  return (
    <div className="route-stack">
      <LookupValueAdminSection
        addLabel="Add theme"
        emptyPrompt="Enter a CPD theme before adding it."
        inputLabel="New theme"
        lookupKey="cpd_theme"
        placeholder="Enter CPD theme"
        title="CPD themes"
        valueLabel="CPD theme"
      />
      <LookupValueAdminSection
        addLabel="Add stage"
        emptyPrompt="Enter a qualification status before adding it."
        inputLabel="New qualification status"
        lookupKey="coaching_development_stage"
        placeholder="Enter qualification status"
        title="Coaching qualification statuses"
        valueLabel="qualification status"
      />
      <LookupValueAdminSection
        addLabel="Add focus area"
        emptyPrompt="Enter a coaching focus area before adding it."
        inputLabel="New focus area"
        lookupKey="coaching_focus_area"
        placeholder="Enter focus area"
        title="Coaching focus areas"
        valueLabel="focus area"
      />
      <LookupValueAdminSection
        addLabel="Add support type"
        emptyPrompt="Enter a coaching support type before adding it."
        inputLabel="New support type"
        lookupKey="coaching_support_type"
        placeholder="Enter support type"
        title="Coaching support types"
        valueLabel="support type"
      />
    </div>
  );
}

function LookupValueAdminSection({
  addLabel,
  emptyPrompt,
  inputLabel,
  lookupKey,
  placeholder,
  title,
  valueLabel
}: {
  addLabel: string;
  emptyPrompt: string;
  inputLabel: string;
  lookupKey: string;
  placeholder: string;
  title: string;
  valueLabel: string;
}) {
  const [values, setValues] = useState<Awaited<ReturnType<typeof api.adminLookupValues>>>([]);
  const [newValue, setNewValue] = useState("");
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    void refreshValues();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookupKey]);

  async function refreshValues(nextStatus = "") {
    try {
      setValues(await api.adminLookupValues(lookupKey));
      setStatus(nextStatus);
    } catch {
      setStatus(`${title} could not be loaded from the API.`);
    }
  }

  async function addValue() {
    if (!newValue.trim()) {
      setStatus(emptyPrompt);
      return;
    }

    setIsSaving(true);
    const result = await api.addLookupValue(lookupKey, newValue.trim());
    setIsSaving(false);
    if (!result.ok) {
      setStatus(result.message ?? `The ${valueLabel} could not be added.`);
      return;
    }

    setNewValue("");
    await refreshValues(`${capitalize(valueLabel)} added.`);
  }

  async function removeValue(id: string) {
    setIsSaving(true);
    const result = await api.archiveLookupValue(lookupKey, id);
    setIsSaving(false);
    if (!result.ok) {
      setStatus(result.message ?? `The ${valueLabel} could not be removed.`);
      return;
    }

    await refreshValues(`${capitalize(valueLabel)} removed. Existing records are unchanged.`);
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>{title}</h2>
        <span>{values.length} active</span>
      </div>

      <div className="lookup-admin-toolbar">
        <label className="entry-field">
          <span>{inputLabel}</span>
          <input
            onChange={(event) => setNewValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void addValue();
              }
            }}
            placeholder={placeholder}
            type="text"
            value={newValue}
          />
        </label>
        <Button disabled={isSaving || !newValue.trim()} icon={Plus} onClick={() => void addValue()} variant="primary">{addLabel}</Button>
      </div>

      {status ? <div className="notice-row" role="status">{status}</div> : null}

      <div className="lookup-value-list">
        {values.map((value) => (
          <div className="lookup-value-row" key={value.id}>
            <strong>{value.displayName}</strong>
            <button
              aria-label={`Remove ${value.displayName}`}
              className="icon-button"
              disabled={isSaving || values.length <= 1}
              onClick={() => void removeValue(value.id)}
              title={`Remove ${value.displayName}`}
              type="button"
            >
              <X aria-hidden="true" size={16} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

type NewAccountForm = {
  displayName: string;
  email: string;
  externalId: string;
  jobTitle: string;
  roleKey: string;
  primaryOrgUnitId: string;
  scopeOrgUnitId: string;
  accountStatus: string;
};

const emptyAccountForm: NewAccountForm = {
  displayName: "",
  email: "",
  externalId: "",
  jobTitle: "",
  roleKey: "",
  primaryOrgUnitId: "",
  scopeOrgUnitId: "",
  accountStatus: "active"
};

function StaffAdminPanel({ user }: { user: CurrentUser }) {
  const [accounts, setAccounts] = useState<AdminUserSummary[]>([]);
  const [roles, setRoles] = useState<AdminRoleSummary[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnitSummary[]>([]);
  const [form, setForm] = useState<NewAccountForm>(emptyAccountForm);
  const [rowEdits, setRowEdits] = useState<Record<string, { accountStatus: string }>>({});
  const [accountSearch, setAccountSearch] = useState("");
  const [panelStatus, setPanelStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    void refreshData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshData() {
    try {
      const [nextAccounts, nextRoles, nextOrgUnits] = await Promise.all([
        api.adminUsers(),
        api.adminRoles(),
        api.orgUnits()
      ]);
      setAccounts(nextAccounts);
      setRoles(nextRoles);
      setOrgUnits(nextOrgUnits.filter((orgUnit) => orgUnit.isActive));
      setRowEdits({});
    } catch {
      setPanelStatus("User accounts could not be loaded from the API.");
    }
  }

  async function createAccount() {
    if (!form.displayName.trim() || !form.email.trim() || !form.externalId.trim()) {
      setPanelStatus("A staff name, email address and staff ID are required.");
      return;
    }

    if (!form.roleKey) {
      setPanelStatus("Select a role for the new account.");
      return;
    }

    setIsSaving(true);
    const result = await api.createAdminUser({
      externalId: form.externalId.trim(),
      displayName: form.displayName.trim(),
      email: form.email.trim(),
      jobTitle: form.jobTitle.trim() || undefined,
      primaryOrgUnitId: form.primaryOrgUnitId || undefined,
      roleKeys: [form.roleKey],
      scopeOrgUnitIds: form.scopeOrgUnitId ? [form.scopeOrgUnitId] : [],
      accountStatus: form.accountStatus
    });
    setIsSaving(false);

    if (result.ok) {
      setPanelStatus(`Account created for ${form.displayName.trim()}.`);
      setForm(emptyAccountForm);
      await refreshData();
    } else {
      setPanelStatus(result.message ?? "The account could not be created.");
    }
  }

  async function saveAccount(account: AdminUserSummary) {
    const edit = rowEdits[account.userAccountId];
    if (!edit) {
      return;
    }

    setIsSaving(true);
    const result = await api.updateAdminUser(account.userAccountId, {
      accountStatus: edit.accountStatus !== account.accountStatus ? edit.accountStatus : undefined
    });
    setIsSaving(false);

    if (result.ok) {
      setPanelStatus(`Account for ${account.displayName} updated.`);
      await refreshData();
    } else {
      setPanelStatus(result.message ?? "The account could not be updated.");
    }
  }

  async function toggleDisabled(account: AdminUserSummary) {
    setIsSaving(true);
    const result = await api.updateAdminUser(account.userAccountId, { isDisabled: !account.isDisabled });
    setIsSaving(false);

    if (result.ok) {
      setPanelStatus(`Account for ${account.displayName} ${account.isDisabled ? "enabled" : "disabled"}.`);
      await refreshData();
    } else {
      setPanelStatus(result.message ?? "The account could not be updated.");
    }
  }

  function rowEdit(account: AdminUserSummary) {
    return (
      rowEdits[account.userAccountId] ?? {
        accountStatus: account.accountStatus
      }
    );
  }

  const visibleAccounts = useMemo(() => {
    const query = accountSearch.trim().toLowerCase();
    if (!query) {
      return accounts;
    }

    return accounts.filter((account) =>
      [account.displayName, account.email, account.externalId, account.primaryOrgCode]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query))
    );
  }, [accountSearch, accounts]);

  const scopeOrgUnits = orgUnits.filter((orgUnit) =>
    ["faculty", "team", "faculty_child_code", "faculty_child", "directorate"].includes(orgUnit.orgUnitType)
  );

  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <h2>Create staff account</h2>
          <span>Linked to Entra by email</span>
        </div>
        <div className="admin-field-grid">
          <label className="entry-field">
            <span>Staff name</span>
            <input
              onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))}
              placeholder="Staff name"
              value={form.displayName}
            />
          </label>
          <label className="entry-field">
            <span>Staff email address</span>
            <input
              onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
              placeholder="AD0000@oldham.ac.uk"
              type="email"
              value={form.email}
            />
          </label>
          <label className="entry-field">
            <span>Staff ID</span>
            <input
              onChange={(event) => setForm((current) => ({ ...current, externalId: event.target.value }))}
              placeholder="AD0000"
              value={form.externalId}
            />
          </label>
          <label className="entry-field">
            <span>Job role</span>
            <input
              onChange={(event) => setForm((current) => ({ ...current, jobTitle: event.target.value }))}
              placeholder="Job role"
              value={form.jobTitle}
            />
          </label>
          <label className="entry-field">
            <span>Permission level</span>
            <select
              onChange={(event) => setForm((current) => ({ ...current, roleKey: event.target.value }))}
              value={form.roleKey}
            >
              <option value="">Select role</option>
              {roles.map((role) => (
                <option key={role.roleKey} value={role.roleKey}>
                  {role.name}
                </option>
              ))}
            </select>
          </label>
          <label className="entry-field">
            <span>Primary team</span>
            <select
              onChange={(event) => setForm((current) => ({ ...current, primaryOrgUnitId: event.target.value }))}
              value={form.primaryOrgUnitId}
            >
              <option value="">No primary team</option>
              {orgUnits.map((orgUnit) => (
                <option key={orgUnit.id} value={orgUnit.id}>
                  {formatOrgUnitOption(orgUnit)}
                </option>
              ))}
            </select>
          </label>
          <label className="entry-field">
            <span>Assigned scope</span>
            <select
              onChange={(event) => setForm((current) => ({ ...current, scopeOrgUnitId: event.target.value }))}
              value={form.scopeOrgUnitId}
            >
              <option value="">No assigned scope</option>
              {scopeOrgUnits.map((orgUnit) => (
                <option key={orgUnit.id} value={orgUnit.id}>
                  {formatOrgUnitOption(orgUnit)}
                </option>
              ))}
            </select>
          </label>
          <label className="entry-field">
            <span>Account status</span>
            <select
              onChange={(event) => setForm((current) => ({ ...current, accountStatus: event.target.value }))}
              value={form.accountStatus}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="leaver">Leaver</option>
            </select>
          </label>
        </div>
        {panelStatus ? <div className="notice-row">{panelStatus}</div> : null}
        <div className="toolbar admin-panel-actions">
          <Button disabled={isSaving} icon={UserCog} onClick={() => void createAccount()} variant="primary">
            Create account
          </Button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>User accounts</h2>
          <div className="toolbar">
            <span>{visibleAccounts.length} of {accounts.length} accounts</span>
            <Button icon={RefreshCw} onClick={() => void refreshData()} variant="secondary">Refresh</Button>
          </div>
        </div>
        <div className="admin-list-toolbar">
          <label className="admin-search-field">
            <Search size={16} aria-hidden="true" />
            <input
              aria-label="Search user accounts"
              onChange={(event) => setAccountSearch(event.target.value)}
              placeholder="Search name, AD number, email or team"
              value={accountSearch}
            />
          </label>
          <span className="muted-copy">Manage role membership in the Permissions tab.</span>
        </div>
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>Staff member</th>
                <th>Staff ID</th>
                <th>Role</th>
                <th>Scope</th>
                <th>Status</th>
                <th>Enabled</th>
                <th>Save</th>
              </tr>
            </thead>
            <tbody>
              {visibleAccounts.length === 0 ? (
                <tr>
                  <td colSpan={7}>No user accounts match the current search.</td>
                </tr>
              ) : (
                visibleAccounts.map((account) => {
                  const edit = rowEdit(account);
                  const isSelf = account.userAccountId === user.userAccountId;
                  const orderedRoles = [...account.roles].sort(
                    (left, right) => rolePrecedence(right.roleKey, roles) - rolePrecedence(left.roleKey, roles)
                  );
                  return (
                    <tr key={account.userAccountId}>
                      <td>
                        <strong>{account.displayName}</strong>
                        <br />
                        <small className="muted-copy">{account.email}</small>
                      </td>
                      <td>{account.externalId}</td>
                      <td>
                        <div className="role-chip-list">
                          {orderedRoles.map((role, index) => (
                            <span className={index === 0 ? "role-chip role-chip-effective" : "role-chip"} key={role.roleKey}>
                              {role.name}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td>
                        {account.scopes.length === 0
                          ? "None"
                          : account.scopes
                              .map((scope) => scope.orgUnitCode ?? scope.scopeType)
                              .join(", ")}
                      </td>
                      <td>
                        <select
                          aria-label={`Account status for ${account.displayName}`}
                          onChange={(event) =>
                            setRowEdits((current) => ({
                              ...current,
                              [account.userAccountId]: { ...edit, accountStatus: event.target.value }
                            }))
                          }
                          value={edit.accountStatus}
                        >
                          <option value="active">Active</option>
                          <option value="inactive">Inactive</option>
                          <option value="leaver">Leaver</option>
                        </select>
                      </td>
                      <td>
                        <input
                          aria-label={`Enable or disable ${account.displayName}`}
                          checked={!account.isDisabled}
                          disabled={isSaving || isSelf}
                          onChange={() => void toggleDisabled(account)}
                          type="checkbox"
                        />
                      </td>
                      <td>
                        <button
                          className="icon-button"
                          disabled={isSaving}
                          onClick={() => void saveAccount(account)}
                          title={`Save changes for ${account.displayName}`}
                          type="button"
                        >
                          <Save size={16} aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function PermissionAdminPanel({ user }: { user: CurrentUser }) {
  const [roles, setRoles] = useState<AdminRoleSummary[]>([]);
  const [accounts, setAccounts] = useState<AdminUserSummary[]>([]);
  const [selectedRoleKey, setSelectedRoleKey] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [candidateSearch, setCandidateSearch] = useState("");
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    void refreshData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshData(preferredRoleKey?: string) {
    try {
      const [nextRoles, nextAccounts] = await Promise.all([api.adminRoles(), api.adminUsers()]);
      setRoles(nextRoles);
      setAccounts(nextAccounts);
      setSelectedRoleKey((current) => preferredRoleKey || current || nextRoles[0]?.roleKey || "");
      setLoadError("");
    } catch {
      setLoadError("Roles and account allocations could not be loaded from the API.");
    }
  }

  const selectedRole = roles.find((role) => role.roleKey === selectedRoleKey);
  const members = useMemo(() => {
    const query = memberSearch.trim().toLowerCase();
    return accounts
      .filter((account) => account.roles.some((role) => role.roleKey === selectedRoleKey))
      .filter((account) => !query || [account.displayName, account.email, account.externalId]
        .some((value) => value.toLowerCase().includes(query)))
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  }, [accounts, memberSearch, selectedRoleKey]);

  const candidates = useMemo(() => {
    const query = candidateSearch.trim().toLowerCase();
    if (!query) {
      return [];
    }

    return accounts
      .filter((account) => !account.roles.some((role) => role.roleKey === selectedRoleKey))
      .filter((account) => [account.displayName, account.email, account.externalId]
        .some((value) => value.toLowerCase().includes(query)))
      .sort((left, right) => left.displayName.localeCompare(right.displayName))
      .slice(0, 8);
  }, [accounts, candidateSearch, selectedRoleKey]);

  async function changeRole(account: AdminUserSummary, action: "add" | "remove") {
    if (!selectedRole) {
      return;
    }

    const nextRoleKeys = new Set(account.roles.map((role) => role.roleKey));
    if (action === "add") {
      nextRoleKeys.add(selectedRole.roleKey);
    } else {
      nextRoleKeys.delete(selectedRole.roleKey);
    }

    setIsSaving(true);
    const result = await api.updateAdminUser(account.userAccountId, { roleKeys: [...nextRoleKeys] });
    setIsSaving(false);
    if (!result.ok) {
      setStatus(result.message ?? "The role allocation could not be updated.");
      return;
    }

    setStatus(`${selectedRole.name} ${action === "add" ? "added to" : "removed from"} ${account.displayName}.`);
    setCandidateSearch("");
    await refreshData(selectedRole.roleKey);
  }

  return (
    <section className="panel permission-admin-panel">
      <div className="panel-heading permission-admin-heading">
        <div>
          <h2>Role allocations</h2>
          <p className="muted-copy">Staff can hold multiple roles. The highest level is shown as their effective role.</p>
        </div>
        <div className="toolbar">
          <span>{accounts.length} accounts</span>
          <Button icon={RefreshCw} onClick={() => void refreshData()} variant="secondary">Refresh</Button>
        </div>
      </div>
      {loadError ? <div className="notice-row">{loadError}</div> : null}
      <div className="role-admin-layout">
        <div className="role-level-list" aria-label="Permission levels">
          {roles.map((role) => {
            const allocationCount = accounts.filter((account) =>
              account.roles.some((assignedRole) => assignedRole.roleKey === role.roleKey)
            ).length;
            return (
              <button
                aria-pressed={selectedRoleKey === role.roleKey}
                className={selectedRoleKey === role.roleKey ? "role-level-button role-level-button-active" : "role-level-button"}
                key={role.roleKey}
                onClick={() => {
                  setSelectedRoleKey(role.roleKey);
                  setMemberSearch("");
                  setCandidateSearch("");
                  setStatus("");
                }}
                type="button"
              >
                <span>
                  <strong>{role.name}</strong>
                  <small>Level {role.precedence}</small>
                </span>
                <b>{allocationCount}</b>
              </button>
            );
          })}
        </div>

        {selectedRole ? (
          <div className="role-member-panel">
            <div className="role-member-header">
              <div>
                <p className="eyebrow">Permission level</p>
                <h3>{selectedRole.name}</h3>
                <p>{selectedRole.description ?? "No description recorded."}</p>
              </div>
              <span className="role-rank-badge">Level {selectedRole.precedence}</span>
            </div>

            <div className="role-permission-summary">
              {selectedRole.permissions.map((permission) => (
                <span key={permission.permissionKey}>{permission.name}</span>
              ))}
            </div>

            <div className="role-add-control">
              <label className="entry-field">
                <span>Add staff member</span>
                <div className="role-candidate-input">
                  <UserPlus size={17} aria-hidden="true" />
                  <input
                    aria-autocomplete="list"
                    aria-controls="role-candidates"
                    aria-expanded={candidates.length > 0}
                    onChange={(event) => setCandidateSearch(event.target.value)}
                    placeholder="Type a name, AD number or email"
                    role="combobox"
                    value={candidateSearch}
                  />
                </div>
              </label>
              {candidates.length > 0 ? (
                <div className="role-candidate-list" id="role-candidates" role="listbox">
                  {candidates.map((account) => (
                    <button
                      disabled={isSaving}
                      key={account.userAccountId}
                      onClick={() => void changeRole(account, "add")}
                      role="option"
                      type="button"
                    >
                      <span><strong>{account.displayName}</strong><small>{account.externalId} · {account.email}</small></span>
                      <UserPlus size={16} aria-hidden="true" />
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {status ? <div className="notice-row">{status}</div> : null}

            <div className="role-member-toolbar">
              <h3>Allocated staff</h3>
              <label className="admin-search-field">
                <Search size={16} aria-hidden="true" />
                <input
                  aria-label={`Search ${selectedRole.name} allocations`}
                  onChange={(event) => setMemberSearch(event.target.value)}
                  placeholder="Filter allocated staff"
                  value={memberSearch}
                />
              </label>
            </div>

            <div className="role-member-list">
              {members.length === 0 ? <p className="muted-copy">No staff are allocated to this role.</p> : null}
              {members.map((account) => {
                const effectiveRole = getEffectiveRole(account, roles);
                const selectedAssignment = account.roles.find((role) => role.roleKey === selectedRole.roleKey);
                const isOrganisationManaged = selectedAssignment?.isOrganisationManaged === true;
                const isProtectedAdmin = selectedRole.roleKey === "super_admin"
                  && account.userAccountId === user.userAccountId;
                return (
                  <div className="role-member-row" key={account.userAccountId}>
                    <div>
                      <strong>{account.displayName}</strong>
                      <span>{account.externalId} · {account.email}</span>
                    </div>
                    <span className="effective-role-label">
                      {isOrganisationManaged ? "Organisation managed" : `Effective: ${effectiveRole?.name ?? "None"}`}
                    </span>
                    <button
                      className="icon-button"
                      disabled={isSaving || isProtectedAdmin || isOrganisationManaged || account.roles.length === 1}
                      onClick={() => void changeRole(account, "remove")}
                      title={isProtectedAdmin
                        ? "Your own Admin role is protected"
                        : isOrganisationManaged
                          ? "Change this role from Organisation Structure"
                          : `Remove ${selectedRole.name}`}
                      type="button"
                    >
                      <UserMinus size={16} aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function rolePrecedence(roleKey: string, roles: AdminRoleSummary[]) {
  return roles.find((role) => role.roleKey === roleKey)?.precedence ?? 0;
}

function getEffectiveRole(account: AdminUserSummary, roles: AdminRoleSummary[]) {
  return [...account.roles]
    .map((assignedRole) => roles.find((role) => role.roleKey === assignedRole.roleKey))
    .filter((role): role is AdminRoleSummary => Boolean(role))
    .sort((left, right) => right.precedence - left.precedence)[0];
}

function RecordCorrectionPanel({ profiles, staff }: { profiles: StaffProfileSummary[]; staff: StaffSummary[] }) {
  const [records, setRecords] = useState<StaffProfileRecordSummary[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [reflectionFilter, setReflectionFilter] = useState("all");
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    api
      .staffProfileRecords()
      .then(setRecords)
      .catch(() => setLoadError("Staff Profile records could not be loaded from the API."));
  }, []);

  const filteredRecords = records.filter((record) => {
    const query = searchTerm.trim().toLowerCase();
    const matchingText = `${record.displayName} ${record.email} ${record.externalId} ${record.primaryOrgCode ?? ""}`.toLowerCase();
    const matchesSearch = !query || matchingText.includes(query);
    const matchesReflection =
      reflectionFilter === "all" ||
      (reflectionFilter === "has_reflections" && record.reflectionCount > 0) ||
      (reflectionFilter === "none" && record.reflectionCount === 0) ||
      (reflectionFilter === "submitted" && record.submittedReflections > 0) ||
      (reflectionFilter === "draft" && record.draftReflections > 0);
    return matchesSearch && matchesReflection;
  });

  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <h2>Staff Profile records</h2>
          <span>{filteredRecords.length} found</span>
        </div>
        {loadError ? <div className="notice-row">{loadError}</div> : null}
        <div className="admin-filter-row">
          <div className="search-box">
            <input
              aria-label="Search Staff Profile records"
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search staff profile records"
              value={searchTerm}
            />
          </div>
          <select
            aria-label="Filter by reflection status"
            onChange={(event) => setReflectionFilter(event.target.value)}
            value={reflectionFilter}
          >
            <option value="all">All reflection statuses</option>
            <option value="has_reflections">Has reflection records</option>
            <option value="none">No reflection records</option>
            <option value="submitted">Has submitted reflections</option>
            <option value="draft">Has draft reflections</option>
          </select>
        </div>
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>Staff member</th>
                <th>Staff ID</th>
                <th>CPD sessions</th>
                <th>Evidence</th>
                <th>Reflections</th>
                <th>Open actions</th>
                <th>Directory status</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecords.map((record) => {
                const profile = profiles.find((item) => item.staffId === record.staffId);
                const staffRecord = staff.find((item) => item.id === record.staffId);
                return (
                  <tr key={record.staffId}>
                    <td>{record.displayName}</td>
                    <td>{record.externalId}</td>
                    <td>{profile?.cpdSessionsAttended ?? 0}</td>
                    <td>{profile?.evidenceRecords ?? 0}</td>
                    <td>{formatReflectionSummary(record)}</td>
                    <td>{record.openActions}</td>
                    <td>{staffRecord?.accountStatus ?? record.accountStatus}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>Submitted record correction</h2>
          <span>Audited admin edits</span>
        </div>
        <div className="admin-task-grid">
          {[
            "Edit submitted records where incorrect information has been entered",
            "Correct staff links, owner links, faculty codes and team codes",
            "Record who made the change, previous value, new value and timestamp",
            "Preserve historical CPD, Learning Walk, LIV and Staff Profile records"
          ].map((item) => (
            <div className="admin-task-row" key={item}>{item}</div>
          ))}
        </div>
      </section>
    </>
  );
}

function formatReflectionSummary(record: StaffProfileRecordSummary) {
  if (record.reflectionCount === 0) {
    return "No records";
  }

  return `${record.submittedReflections} submitted, ${record.draftReflections} draft`;
}

function LearningWalkThemeAdminPanel() {
  const [groups, setGroups] = useState<LearningWalkThemeGroup[]>([]);
  const [newGroupName, setNewGroupName] = useState("");
  const [newThemeName, setNewThemeName] = useState("");
  const [newThemeGroupId, setNewThemeGroupId] = useState("");
  const [editingAreaId, setEditingAreaId] = useState("");
  const [editingAreaName, setEditingAreaName] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editingName, setEditingName] = useState("");
  const [editingThemeGroupId, setEditingThemeGroupId] = useState("");
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    void refreshThemes();
  }, []);

  async function refreshThemes(nextStatus = "") {
    try {
      const nextGroups = await api.adminLearningWalkThemes();
      setGroups(nextGroups);
      setNewThemeGroupId((current) => nextGroups.some((group) => group.id === current && group.isActive)
        ? current
        : nextGroups.find((group) => group.isActive)?.id ?? "");
      setStatus(nextStatus);
    } catch {
      setStatus("Learning Walk themes could not be loaded from the API.");
    }
  }

  async function addThemeArea() {
    if (!newGroupName.trim()) {
      setStatus("Enter a theme area name.");
      return;
    }

    setIsSaving(true);
    const result = await api.createLearningWalkThemeGroup({ name: newGroupName.trim() });
    setIsSaving(false);
    if (!result.ok) {
      setStatus(result.message ?? "The theme area could not be added.");
      return;
    }

    setNewGroupName("");
    await refreshThemes("Theme area added.");
  }

  function startAreaEdit(group: LearningWalkThemeGroup) {
    setEditingAreaId(group.id);
    setEditingAreaName(group.name);
    setStatus("");
  }

  async function saveAreaEdit() {
    if (!editingAreaId || !editingAreaName.trim()) {
      setStatus("A theme area name is required.");
      return;
    }

    setIsSaving(true);
    const result = await api.updateLearningWalkThemeGroup(editingAreaId, { name: editingAreaName.trim() });
    setIsSaving(false);
    if (!result.ok) {
      setStatus(result.message ?? "The theme area could not be renamed.");
      return;
    }

    setEditingAreaId("");
    await refreshThemes("Theme area renamed. Historical records retain their saved labels.");
  }

  async function setAreaStatus(group: LearningWalkThemeGroup, isActive: boolean) {
    setIsSaving(true);
    const result = await api.setLearningWalkThemeGroupStatus(group.id, isActive);
    setIsSaving(false);
    if (!result.ok) {
      setStatus(result.message ?? "The theme area status could not be changed.");
      return;
    }

    await refreshThemes(isActive
      ? "Theme area reactivated."
      : "Theme area deactivated. Its themes and historical reporting data have been preserved.");
  }

  async function addTheme() {
    if (!newThemeName.trim() || !newThemeGroupId) {
      setStatus("Enter a theme and select its area.");
      return;
    }

    setIsSaving(true);
    const result = await api.createLearningWalkTheme({
      themeGroupId: newThemeGroupId,
      name: newThemeName.trim()
    });
    setIsSaving(false);
    if (!result.ok) {
      setStatus(result.message ?? "The Learning Walk theme could not be added.");
      return;
    }

    setNewThemeName("");
    await refreshThemes("Learning Walk theme added.");
  }

  function startEdit(theme: LearningWalkTheme) {
    setEditingId(theme.id);
    setEditingName(theme.name);
    setEditingThemeGroupId(theme.themeGroupId);
    setStatus("");
  }

  async function saveEdit() {
    if (!editingId || !editingName.trim() || !editingThemeGroupId) {
      setStatus("A theme name and area are required.");
      return;
    }

    setIsSaving(true);
    const result = await api.updateLearningWalkTheme(editingId, {
      themeGroupId: editingThemeGroupId,
      name: editingName.trim()
    });
    setIsSaving(false);
    if (!result.ok) {
      setStatus(result.message ?? "The Learning Walk theme could not be updated.");
      return;
    }

    setEditingId("");
    await refreshThemes("Learning Walk theme updated.");
  }

  async function setThemeStatus(theme: LearningWalkTheme, isActive: boolean) {
    setIsSaving(true);
    const result = await api.setLearningWalkThemeStatus(theme.id, isActive);
    setIsSaving(false);
    if (!result.ok) {
      setStatus(result.message ?? "The Learning Walk theme status could not be changed.");
      return;
    }

    await refreshThemes(isActive ? "Learning Walk theme reactivated." : "Learning Walk theme deactivated.");
  }

  async function moveTheme(group: LearningWalkThemeGroup, themeIndex: number, direction: -1 | 1) {
    const targetIndex = themeIndex + direction;
    if (targetIndex < 0 || targetIndex >= group.themes.length) {
      return;
    }

    const nextIds = group.themes.map((theme) => theme.id);
    [nextIds[themeIndex], nextIds[targetIndex]] = [nextIds[targetIndex], nextIds[themeIndex]];
    setIsSaving(true);
    const result = await api.reorderLearningWalkThemes(group.id, nextIds);
    setIsSaving(false);
    if (!result.ok) {
      setStatus(result.message ?? "The Learning Walk themes could not be reordered.");
      return;
    }

    await refreshThemes("Theme order updated.");
  }

  const activeGroups = groups.filter((group) => group.isActive);
  const activeThemeCount = activeGroups.reduce(
    (count, group) => count + group.themes.filter((theme) => theme.isActive).length,
    0);

  return (
    <section className="panel learning-theme-admin">
      <div className="panel-heading">
        <div>
          <h2>Teaching &amp; Learning themes</h2>
          <span>Shared by Learning Walks, LIV and quality reporting</span>
        </div>
        <strong>{activeGroups.length} active areas · {activeThemeCount} active themes</strong>
      </div>

      <div className="learning-theme-area-add-row">
        <label className="entry-field">
          <span>New theme area <strong>Required</strong></span>
          <input onChange={(event) => setNewGroupName(event.target.value)} placeholder="Enter area name" type="text" value={newGroupName} />
        </label>
        <Button disabled={isSaving || !newGroupName.trim()} icon={Plus} onClick={() => void addThemeArea()} variant="secondary">Add area</Button>
      </div>

      <div className="learning-theme-add-row">
        <label className="entry-field">
          <span>Theme area <strong>Required</strong></span>
          <select onChange={(event) => setNewThemeGroupId(event.target.value)} value={newThemeGroupId}>
            {activeGroups.length === 0 ? <option value="">No active theme areas</option> : null}
            {activeGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
          </select>
        </label>
        <label className="entry-field">
          <span>New theme <strong>Required</strong></span>
          <input onChange={(event) => setNewThemeName(event.target.value)} placeholder="Enter theme wording" type="text" value={newThemeName} />
        </label>
        <Button disabled={isSaving || !newThemeName.trim() || !newThemeGroupId} icon={Plus} onClick={() => void addTheme()} variant="primary">Add theme</Button>
      </div>

      <p className="learning-theme-governance-note">
        Area names can change safely because records use stable IDs and saved reporting labels. Deactivating an area removes it from new selections without deleting its themes or history.
      </p>

      {status ? <div className="notice-row" role="status">{status}</div> : null}

      <div className="learning-theme-groups">
        {groups.map((group) => (
          <div className={`learning-theme-group${group.isActive ? "" : " is-inactive"}`} key={group.id}>
            <div className="learning-theme-group-heading">
              {editingAreaId === group.id ? (
                <div className="learning-theme-area-edit">
                  <input aria-label="Theme area name" onChange={(event) => setEditingAreaName(event.target.value)} type="text" value={editingAreaName} />
                  <button aria-label="Cancel area editing" className="icon-button" onClick={() => setEditingAreaId("")} title="Cancel area editing" type="button"><X size={16} /></button>
                  <button aria-label="Save theme area" className="icon-button" disabled={isSaving || !editingAreaName.trim()} onClick={() => void saveAreaEdit()} title="Save theme area" type="button"><Save size={16} /></button>
                </div>
              ) : (
                <>
                  <div className="learning-theme-group-title">
                    <h3>{group.name}</h3>
                    <span>{group.isActive ? "Active" : "Inactive"} · {group.themes.length} theme{group.themes.length === 1 ? "" : "s"}</span>
                  </div>
                  <div className="learning-theme-row-actions">
                    <button aria-label={`Rename ${group.name} area`} className="icon-button" disabled={isSaving} onClick={() => startAreaEdit(group)} title="Rename theme area" type="button"><Edit3 size={16} /></button>
                    <button
                      aria-label={`${group.isActive ? "Deactivate" : "Reactivate"} ${group.name} area`}
                      className="icon-button"
                      disabled={isSaving}
                      onClick={() => void setAreaStatus(group, !group.isActive)}
                      title={group.isActive ? "Deactivate theme area" : "Reactivate theme area"}
                      type="button"
                    >
                      {group.isActive ? <Archive size={16} /> : <ArchiveRestore size={16} />}
                    </button>
                  </div>
                </>
              )}
            </div>
            {group.themes.length === 0 ? <div className="empty-row">No themes in this area.</div> : null}
            {group.themes.map((theme, index) => (
              <div className={`learning-theme-admin-row${theme.isActive && group.isActive ? "" : " is-inactive"}`} key={theme.id}>
                {editingId === theme.id ? (
                  <>
                    <input aria-label="Theme wording" onChange={(event) => setEditingName(event.target.value)} type="text" value={editingName} />
                    <select aria-label="Theme area" disabled={theme.isOther} onChange={(event) => setEditingThemeGroupId(event.target.value)} value={editingThemeGroupId}>
                      {groups.filter((candidate) => candidate.isActive || candidate.id === editingThemeGroupId).map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>{candidate.name}{candidate.isActive ? "" : " (inactive)"}</option>
                      ))}
                    </select>
                    <div className="learning-theme-row-actions">
                      <button aria-label="Cancel editing" className="icon-button" onClick={() => setEditingId("")} title="Cancel editing" type="button"><X size={16} /></button>
                      <button aria-label="Save theme" className="icon-button" disabled={isSaving || !editingName.trim()} onClick={() => void saveEdit()} title="Save theme" type="button"><Save size={16} /></button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="learning-theme-name">
                      <strong>{theme.name}</strong>
                      <span>{!group.isActive ? "Area inactive" : theme.isActive ? "Active" : "Inactive"}</span>
                    </div>
                    <div className="learning-theme-order-actions">
                      <button aria-label={`Move ${theme.name} up`} className="icon-button" disabled={isSaving || !group.isActive || index === 0} onClick={() => void moveTheme(group, index, -1)} title="Move up" type="button"><ArrowUp size={16} /></button>
                      <button aria-label={`Move ${theme.name} down`} className="icon-button" disabled={isSaving || !group.isActive || index === group.themes.length - 1} onClick={() => void moveTheme(group, index, 1)} title="Move down" type="button"><ArrowDown size={16} /></button>
                    </div>
                    <div className="learning-theme-row-actions">
                      <button aria-label={`Edit ${theme.name}`} className="icon-button" disabled={isSaving || !group.isActive} onClick={() => startEdit(theme)} title="Edit theme" type="button"><Edit3 size={16} /></button>
                      <button
                        aria-label={`${theme.isActive ? "Deactivate" : "Reactivate"} ${theme.name}`}
                        className="icon-button"
                        disabled={isSaving || !group.isActive}
                        onClick={() => void setThemeStatus(theme, !theme.isActive)}
                        title={theme.isActive ? "Deactivate theme" : "Reactivate theme"}
                        type="button"
                      >
                        {theme.isActive ? <Archive size={16} /> : <ArchiveRestore size={16} />}
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function capitalize(value: string) {
  return value.charAt(0).toLocaleUpperCase() + value.slice(1);
}

function formatOrgUnitOption(orgUnit: OrgUnitSummary) {
  const level = orgUnit.orgUnitType === "faculty" ? "Faculty" : "Team";
  return `${level}: ${orgUnit.code} - ${orgUnit.name}`;
}

function DashboardAdminPanel() {
  const [processes, setProcesses] = useState<DashboardProcessConfiguration[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    api.dashboardConfiguration()
      .then((configuration) => setProcesses([...configuration.processes].sort((left, right) => left.displayOrder - right.displayOrder)))
      .catch(() => setMessage("Dashboard configuration could not be loaded."))
      .finally(() => setIsLoading(false));
  }, []);

  function update(processKey: string, changes: Partial<DashboardProcessConfiguration>) {
    setProcesses((current) => current.map((process) => process.processKey === processKey ? { ...process, ...changes } : process));
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= processes.length) return;
    setProcesses((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((process, order) => ({ ...process, displayOrder: (order + 1) * 10 }));
    });
  }

  async function save() {
    setIsSaving(true); setMessage("");
    try {
      await api.saveDashboardConfiguration(processes);
      const saved = await api.dashboardConfiguration();
      setProcesses([...saved.processes].sort((left, right) => left.displayOrder - right.displayOrder));
      setMessage("Dashboard configuration saved. Leadership views will use the new layout on refresh.");
    } catch {
      setMessage("Dashboard configuration could not be saved.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="admin-dashboard-config">
      <section className="panel admin-dashboard-intro">
        <div><p className="eyebrow">Reporting governance</p><h2>Leadership dashboard</h2><p>Control the order, naming and analytical emphasis of approved dashboard views. Metrics and permission rules remain protected.</p></div>
        <Button disabled={isLoading || isSaving || processes.length === 0} icon={Save} onClick={() => void save()} variant="primary">{isSaving ? "Saving" : "Save configuration"}</Button>
      </section>
      {message ? <div className="form-message">{message}</div> : null}
      {isLoading ? <section className="panel"><p className="muted-copy">Loading dashboard configuration...</p></section> : (
        <section className="panel admin-dashboard-processes">
          <div className="panel-heading"><h2>Dashboard views</h2><span>{processes.filter((process) => process.isEnabled).length} visible</span></div>
          <p className="muted-copy">Disabling a view hides it from navigation; it does not delete records or reporting data. Labels may be changed without changing stable process keys.</p>
          <div className="admin-dashboard-process-list">
            {processes.map((process, index) => <article className={process.isEnabled ? "" : "is-disabled"} key={process.processKey}>
              <div className="admin-dashboard-order"><Button aria-label="Move up" disabled={index === 0} icon={ArrowUp} onClick={() => move(index, -1)} variant="secondary">Up</Button><Button aria-label="Move down" disabled={index === processes.length - 1} icon={ArrowDown} onClick={() => move(index, 1)} variant="secondary">Down</Button></div>
              <div className="admin-dashboard-identity"><small>{process.processKey}</small><input aria-label={`${process.label} dashboard label`} maxLength={80} onChange={(event) => update(process.processKey, { label: event.target.value })} value={process.label}/></div>
              <label className="admin-dashboard-visual"><span>Primary visual</span><select onChange={(event) => update(process.processKey, { primaryVisual: event.target.value as "bar" | "donut" })} value={process.primaryVisual}><option value="bar">Ranked profile</option><option value="donut">Distribution</option></select></label>
              <div className="admin-dashboard-widgets" aria-label={`${process.label} visible analysis`}>
                <label><input checked={process.showTrend} onChange={(event) => update(process.processKey, { showTrend: event.target.checked })} type="checkbox"/>Trend</label>
                <label><input checked={process.showAreaComparison} onChange={(event) => update(process.processKey, { showAreaComparison: event.target.checked })} type="checkbox"/>Areas</label>
                <label><input checked={process.showOutcomes} onChange={(event) => update(process.processKey, { showOutcomes: event.target.checked })} type="checkbox"/>Outcomes</label>
                <label><input checked={process.showActions} onChange={(event) => update(process.processKey, { showActions: event.target.checked })} type="checkbox"/>Actions</label>
              </div>
              <label className="admin-dashboard-enabled"><input checked={process.isEnabled} disabled={process.processKey === "overview"} onChange={(event) => update(process.processKey, { isEnabled: event.target.checked })} type="checkbox"/><span>{process.processKey === "overview" ? "Required" : process.isEnabled ? "Visible" : "Hidden"}</span></label>
            </article>)}
          </div>
        </section>
      )}
      <section className="panel admin-dashboard-guardrails"><ShieldCheck size={20}/><div><h3>Protected reporting guardrails</h3><p>Administrators can change presentation, but cannot expose restricted narrative responses, alter scope permissions, introduce arbitrary database queries or delete historical reporting labels.</p></div></section>
    </div>
  );
}
