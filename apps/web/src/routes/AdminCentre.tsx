import { Database, FileText, LayoutDashboard, ListChecks, Plus, RefreshCw, Save, Search, ShieldCheck, SlidersHorizontal, Sparkles, UserCog, UserMinus, UserPlus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../design-system/Button";
import { api } from "../services/api";
import type {
  AdminRoleSummary,
  AdminUserSummary,
  CurrentUser,
  ModuleSummary,
  OrgUnitSummary,
  StaffProfileRecordSummary,
  StaffProfileSummary,
  StaffSummary
} from "../services/types";
import { FormBuilder } from "./FormBuilder";
import { AdminElevatePractice } from "./AdminElevatePractice";

export function AdminCentre({
  user,
  modules,
  profiles,
  staff
}: {
  user: CurrentUser;
  modules: ModuleSummary[];
  profiles: StaffProfileSummary[];
  staff: StaffSummary[];
}) {
  const [activeTab, setActiveTab] = useState<AdminTabKey>("overview");
  const permissionRows = [
    ["Admin", "System maintenance, users, records and labels", "Global"],
    ["Teaching & Learning", "Forms, CPD, LIV, reports and actions", "Global"],
    ["Director", "Scoped reports and review activity", "Assigned org units"],
    ["Head of Faculty", "Faculty records, actions and dashboards", "Assigned faculty"],
    ["Programme Leader", "Team records, actions and dashboards", "Assigned team"],
    ["Tutor", "Own profile, records and actions", "Self"]
  ];
  const canUseAdmin = user.permissions.includes("users.manage") || user.permissions.includes("permissions.manage");

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
        {adminTabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              aria-selected={activeTab === tab.key}
              className={activeTab === tab.key ? "admin-tab admin-tab-active" : "admin-tab"}
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
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
          onOpenLookups={() => setActiveTab("lookups")}
          permissionRows={permissionRows}
          user={user}
        />
      ) : null}
      {activeTab === "staff" ? <StaffAdminPanel user={user} /> : null}
      {activeTab === "permissions" ? <PermissionAdminPanel user={user} /> : null}
      {activeTab === "lookups" ? <LookupAdminPanel /> : null}
      {activeTab === "forms" ? <FormBuilder embedded user={user} /> : null}
      {activeTab === "elevate" ? <AdminElevatePractice /> : null}
      {activeTab === "records" ? <RecordCorrectionPanel profiles={profiles} staff={staff} /> : null}
      {activeTab === "dashboards" ? <DashboardAdminPanel /> : null}
    </div>
  );
}

type AdminTabKey = "overview" | "staff" | "permissions" | "lookups" | "forms" | "elevate" | "records" | "dashboards";

const adminTabs: Array<{ key: AdminTabKey; label: string; icon: typeof SlidersHorizontal }> = [
  { key: "overview", label: "Overview", icon: SlidersHorizontal },
  { key: "staff", label: "Staff accounts", icon: UserCog },
  { key: "permissions", label: "Permissions", icon: ShieldCheck },
  { key: "lookups", label: "Lookups", icon: ListChecks },
  { key: "forms", label: "Forms", icon: FileText },
  { key: "elevate", label: "Elevate records", icon: Sparkles },
  { key: "records", label: "Submitted records", icon: Database },
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

function LookupAdminPanel() {
  const [themes, setThemes] = useState<Awaited<ReturnType<typeof api.adminLookupValues>>>([]);
  const [newTheme, setNewTheme] = useState("");
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    void refreshThemes();
  }, []);

  async function refreshThemes(nextStatus = "") {
    try {
      setThemes(await api.adminLookupValues("cpd_theme"));
      setStatus(nextStatus);
    } catch {
      setStatus("CPD themes could not be loaded from the API.");
    }
  }

  async function addTheme() {
    if (!newTheme.trim()) {
      setStatus("Enter a CPD theme before adding it.");
      return;
    }

    setIsSaving(true);
    const result = await api.addLookupValue("cpd_theme", newTheme.trim());
    setIsSaving(false);
    if (!result.ok) {
      setStatus(result.message ?? "The CPD theme could not be added.");
      return;
    }

    setNewTheme("");
    await refreshThemes("CPD theme added.");
  }

  async function removeTheme(id: string) {
    setIsSaving(true);
    const result = await api.archiveLookupValue("cpd_theme", id);
    setIsSaving(false);
    if (!result.ok) {
      setStatus(result.message ?? "The CPD theme could not be removed.");
      return;
    }

    await refreshThemes("CPD theme removed. Existing CPD records are unchanged.");
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>CPD themes</h2>
        <span>{themes.length} active</span>
      </div>

      <div className="lookup-admin-toolbar">
        <label className="entry-field">
          <span>New theme</span>
          <input
            onChange={(event) => setNewTheme(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void addTheme();
              }
            }}
            placeholder="Enter CPD theme"
            type="text"
            value={newTheme}
          />
        </label>
        <Button disabled={isSaving || !newTheme.trim()} icon={Plus} onClick={() => void addTheme()} variant="primary">Add theme</Button>
      </div>

      {status ? <div className="notice-row" role="status">{status}</div> : null}

      <div className="lookup-value-list">
        {themes.map((theme) => (
          <div className="lookup-value-row" key={theme.id}>
            <strong>{theme.displayName}</strong>
            <button
              aria-label={`Remove ${theme.displayName}`}
              className="icon-button"
              disabled={isSaving || themes.length <= 1}
              onClick={() => void removeTheme(theme.id)}
              title={`Remove ${theme.displayName}`}
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
                const isProtectedAdmin = selectedRole.roleKey === "super_admin"
                  && account.userAccountId === user.userAccountId;
                return (
                  <div className="role-member-row" key={account.userAccountId}>
                    <div>
                      <strong>{account.displayName}</strong>
                      <span>{account.externalId} · {account.email}</span>
                    </div>
                    <span className="effective-role-label">Effective: {effectiveRole?.name ?? "None"}</span>
                    <button
                      className="icon-button"
                      disabled={isSaving || isProtectedAdmin || account.roles.length === 1}
                      onClick={() => void changeRole(account, "remove")}
                      title={isProtectedAdmin ? "Your own Admin role is protected" : `Remove ${selectedRole.name}`}
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
      (reflectionFilter === "completed" && record.completedReflections === record.reflectionPointCount) ||
      (reflectionFilter === "overdue" && record.overdueReflections > 0) ||
      (reflectionFilter === "outstanding" && record.completedReflections < record.reflectionPointCount);
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
            <option value="completed">All reflections completed</option>
            <option value="outstanding">Reflections outstanding</option>
            <option value="overdue">Reflections overdue</option>
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
  const base = `${record.completedReflections}/${record.reflectionPointCount} completed`;
  return record.overdueReflections > 0 ? `${base}, ${record.overdueReflections} overdue` : base;
}

function formatOrgUnitOption(orgUnit: OrgUnitSummary) {
  const level = orgUnit.orgUnitType === "faculty" ? "Faculty" : "Team";
  return `${level}: ${orgUnit.code} - ${orgUnit.name}`;
}

function DashboardAdminPanel() {
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Dashboard governance</h2>
        <span>Fixed dashboards first</span>
      </div>
      <div className="admin-task-grid">
        {[
          "Use fixed dashboards with role-based visibility for the first release",
          "Apply academic year and custom date range filters to reporting views",
          "Control dashboard visibility by role, faculty, team, child code and directorate",
          "Support CSV and Excel exports where permission allows",
          "Treat custom dashboard building as a future phase"
        ].map((item) => (
          <div className="admin-task-row" key={item}>{item}</div>
        ))}
      </div>
    </section>
  );
}
