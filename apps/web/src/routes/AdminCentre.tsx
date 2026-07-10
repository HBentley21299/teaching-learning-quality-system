import { Database, FileText, LayoutDashboard, Save, ShieldCheck, SlidersHorizontal, UserCog } from "lucide-react";
import { useEffect, useState } from "react";
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
        <AdminOverview modules={modules} permissionRows={permissionRows} user={user} />
      ) : null}
      {activeTab === "staff" ? <StaffAdminPanel user={user} /> : null}
      {activeTab === "permissions" ? <PermissionAdminPanel /> : null}
      {activeTab === "forms" ? <FormBuilder embedded user={user} /> : null}
      {activeTab === "records" ? <RecordCorrectionPanel profiles={profiles} staff={staff} /> : null}
      {activeTab === "dashboards" ? <DashboardAdminPanel /> : null}
    </div>
  );
}

type AdminTabKey = "overview" | "staff" | "permissions" | "forms" | "records" | "dashboards";

const adminTabs: Array<{ key: AdminTabKey; label: string; icon: typeof SlidersHorizontal }> = [
  { key: "overview", label: "Overview", icon: SlidersHorizontal },
  { key: "staff", label: "Staff accounts", icon: UserCog },
  { key: "permissions", label: "Permissions", icon: ShieldCheck },
  { key: "forms", label: "Forms", icon: FileText },
  { key: "records", label: "Submitted records", icon: Database },
  { key: "dashboards", label: "Dashboards", icon: LayoutDashboard }
];

function AdminOverview({
  modules,
  permissionRows,
  user
}: {
  modules: ModuleSummary[];
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
            {["Account status", "Action status", "Priority", "CPD theme", "Impact milestone"].map((lookup) => (
              <button key={lookup} className="lookup-row" type="button">
                {lookup}
              </button>
            ))}
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
  const [rowEdits, setRowEdits] = useState<Record<string, { roleKey: string; accountStatus: string }>>({});
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
      accountStatus: edit.accountStatus !== account.accountStatus ? edit.accountStatus : undefined,
      roleKeys: edit.roleKey !== (account.roles[0]?.roleKey ?? "") ? [edit.roleKey].filter(Boolean) : undefined
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
        roleKey: account.roles[0]?.roleKey ?? "",
        accountStatus: account.accountStatus
      }
    );
  }

  const scopeOrgUnits = orgUnits.filter((orgUnit) =>
    ["faculty", "faculty_child_code", "faculty_child", "directorate"].includes(orgUnit.orgUnitType)
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
              placeholder="name@college.example"
              type="email"
              value={form.email}
            />
          </label>
          <label className="entry-field">
            <span>Staff ID</span>
            <input
              onChange={(event) => setForm((current) => ({ ...current, externalId: event.target.value }))}
              placeholder="STAFF_0000"
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
                  {orgUnit.code} - {orgUnit.name}
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
                  {orgUnit.code} - {orgUnit.name}
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
          <span>{accounts.length} accounts</span>
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
              {accounts.length === 0 ? (
                <tr>
                  <td colSpan={7}>No user accounts were returned by the API.</td>
                </tr>
              ) : (
                accounts.map((account) => {
                  const edit = rowEdit(account);
                  const isSelf = account.userAccountId === user.userAccountId;
                  return (
                    <tr key={account.userAccountId}>
                      <td>
                        <strong>{account.displayName}</strong>
                        <br />
                        <small className="muted-copy">{account.email}</small>
                      </td>
                      <td>{account.externalId}</td>
                      <td>
                        <select
                          aria-label={`Role for ${account.displayName}`}
                          onChange={(event) =>
                            setRowEdits((current) => ({
                              ...current,
                              [account.userAccountId]: { ...edit, roleKey: event.target.value }
                            }))
                          }
                          value={edit.roleKey}
                        >
                          <option value="">No role</option>
                          {roles.map((role) => (
                            <option key={role.roleKey} value={role.roleKey}>
                              {role.name}
                            </option>
                          ))}
                        </select>
                        {account.roles.length > 1 ? (
                          <small className="muted-copy">+{account.roles.length - 1} more</small>
                        ) : null}
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

function PermissionAdminPanel() {
  const [roles, setRoles] = useState<AdminRoleSummary[]>([]);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    api
      .adminRoles()
      .then(setRoles)
      .catch(() => setLoadError("Roles and permissions could not be loaded from the API."));
  }, []);

  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Permission management</h2>
        <span>Level and scope</span>
      </div>
      {loadError ? <div className="notice-row">{loadError}</div> : null}
      <div className="permission-grid">
        {roles.map((role) => (
          <div className="permission-row" key={role.roleKey}>
            <strong>{role.name}</strong>
            <span>{role.description ?? "No description recorded."}</span>
            <span>
              {role.permissions.length === 0
                ? "No permissions"
                : role.permissions.map((permission) => permission.name).join(", ")}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
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
                <th>Open LIV actions</th>
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
                    <td>{record.openLivActions}</td>
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
