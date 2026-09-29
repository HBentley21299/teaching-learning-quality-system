import { confirmUnsavedNavigation, useUnsavedChanges } from "../components/UnsavedChangesGuard";
import { DashboardFacultyAdmin } from "./DashboardFacultyAdmin";
import { PermissionAdminPanel } from "./PermissionsAdmin";
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Building2, Database, Edit3, FileText, LayoutDashboard, ListChecks, Mail, Plus, RefreshCw, Save, Search, ShieldCheck, SlidersHorizontal, Sparkles, UserCog, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { accessibleAdminSections, resolveAdminSectionKey, type AdminSectionKey } from "../app/adminNavigation";
import { AdminRooms } from "./AdminRooms";
import { AdminStaffDetails } from "./AdminStaffDetails";
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
import { FormEditor } from "./FormEditor";
import { AdminElevatePractice } from "./AdminElevatePractice";
import { ElevateStatusAssetsAdmin } from "./ElevateStatusAssetsAdmin";
import { AdminWorkScrutiny } from "./AdminWorkScrutiny";
import { AdminRecordsPanel } from "./AdminRecordsPanel";
import { OrganisationStructureAdmin } from "./OrganisationStructureAdmin";
import { MessagingAdminPanel } from "./MessagingAdminPanel";

export function AdminCentre({ user, modules, onOpenRecord, initialTab = "overview", onTabChange }: {
  user: CurrentUser;
  modules: ModuleSummary[];
  staff: StaffSummary[];
  onOpenRecord: (record: AdminRecord) => void;
  initialTab?: string;
  onTabChange?: (tab: string) => void;
}) {
  const sections = accessibleAdminSections(user.permissions);
  const resolveSection = (key: string) => sections.find((section) => section.key === resolveAdminSectionKey(key))?.key ?? "overview";
  const [activeTab, setActiveTab] = useState<AdminSectionKey>(() => resolveSection(initialTab));
  const [search, setSearch] = useState("");
  const [staffDetailsFocusId, setStaffDetailsFocusId] = useState("");
  const [, setEditorDirty] = useState(false);
  const [editorBusy, setEditorBusy] = useState(false);
  function handleFormDirty(dirty: boolean, saving = false) { setEditorDirty(dirty); setEditorBusy(saving); }
  useEffect(() => { setActiveTab(resolveSection(initialTab)); }, [initialTab, user.permissions]);
  const activeSection = sections.find((section) => section.key === activeTab) ?? sections[0];
  const query = search.trim().toLocaleLowerCase();
  const matchingSections = sections.filter((section) => !query || `${section.label} ${section.group} ${section.description}`.toLocaleLowerCase().includes(query));
  const groups = [...new Set(matchingSections.map((section) => section.group))];
  async function selectTab(key: AdminSectionKey) {
    if (editorBusy || key === activeTab || !await confirmUnsavedNavigation()) return;
    openSection(key);
  }
  function openSection(key: AdminSectionKey) {
    setEditorDirty(false);
    setEditorBusy(false);
    setActiveTab(key);
    setSearch("");
    onTabChange?.(key);
  }
  if (!activeSection) return <section className="panel"><h1>Admin centre</h1><p>You do not have permission to manage system administration.</p></section>;
  const current = activeSection.key;
  return (
    <div className="route-stack admin-centre">
      <div className="route-header"><div><p className="eyebrow">Administration</p><h1>Admin centre</h1><p>Find the right setting, make a change and get back to your work.</p></div></div>
      <div className="admin-workbench">
        <aside className="admin-directory" aria-label="Admin navigation">
          <label className="admin-setting-search"><span>Find a setting</span><input type="search" placeholder="Try rooms, staff or forms" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <nav aria-label="Admin sections">
            {groups.map((group) => <div className="admin-directory-group" key={group}><h2>{group}</h2>{matchingSections.filter((section) => section.group === group).map((section) => <button disabled={editorBusy} type="button" key={section.key} aria-current={current === section.key ? "page" : undefined} onClick={() => selectTab(section.key)}>{section.label}</button>)}</div>)}
            {matchingSections.length === 0 ? <p className="muted-copy" role="status">No settings found. Try another word.</p> : null}
          </nav>
        </aside>
        <div className="admin-workspace">
          <div className="admin-section-heading"><p>{activeSection.group}</p><h2>{activeSection.label}</h2><span>{activeSection.description}</span></div>
          {current === "overview" ? <>
            <div className="admin-task-directory">{matchingSections.filter((section) => section.key !== "overview").map((section) => <button disabled={editorBusy} type="button" key={section.key} onClick={() => selectTab(section.key)}><span>{section.group}</span><strong>{section.label}</strong><p>{section.description}</p><span className="admin-task-open">Open section →</span></button>)}</div>
          </> : null}
          {current === "staff-access" ? <StaffAdminPanel user={user} onOpenDetails={(id) => { setStaffDetailsFocusId(id); selectTab("staff-details"); }} /> : null}
          {current === "staff-details" ? <AdminStaffDetails isAdministrator={user.isAdministrator} initialUserAccountId={staffDetailsFocusId} onDirtyChange={setEditorDirty} /> : null}
          {current === "roles" ? <PermissionAdminPanel user={user} onDirtyChange={handleFormDirty} /> : null}
          {current === "organisation" ? <OrganisationStructureAdmin isAdministrator={user.isAdministrator} /> : null}
          {current === "forms" ? <FormEditor user={user} initialLocation={initialTab} onDirtyChange={handleFormDirty} renderSettings={(family, onDirtyChange) => {
            if (family === "coaching") return <CoachingConfigurationAdmin onDirtyChange={onDirtyChange} />;
            if (family === "als_learning_walk") return <LearningWalkThemeAdminPanel onDirtyChange={onDirtyChange} key="als-learning" processKey="als_learning_walk" title="ALS Learning Walk themes and focus areas" subtitle="Used by ALS Learning Walks and ALS reporting" />;
            if (family === "als_liv") return <LearningWalkThemeAdminPanel onDirtyChange={onDirtyChange} key="als-liv" processKey="als_liv_practitioner" title="ALS LIV practitioner areas" subtitle="Standalone configurable areas used only by ALS LIV" />;
            return <LearningWalkThemeAdminPanel onDirtyChange={onDirtyChange} />;
          }} /> : null}
          {current === "rooms" ? <AdminRooms onDirtyChange={setEditorDirty} /> : null}
          {current === "elevate" ? <AdminElevatePractice /> : null}
          {current === "badges" ? <ElevateStatusAssetsAdmin /> : null}
          {current === "records" ? <AdminRecordsPanel onOpenRecord={onOpenRecord} /> : null}
          {current === "work-scrutiny" ? <AdminWorkScrutiny /> : null}
          {current === "messaging" ? <MessagingAdminPanel /> : null}
          {current === "dashboards" ? <DashboardAdminPanel onDirtyChange={handleFormDirty} /> : null}
          {current === "system" ? <div className="route-stack">
            <section className="panel"><h3>Module availability</h3><p className="muted-copy">Configured by the application release. Access to each module also depends on staff permissions.</p><ul className="admin-module-list">{modules.map((module) => <li key={module.id}><span>{module.name}</span><strong>{module.isEnabled ? "Enabled" : "Disabled"}</strong></li>)}</ul></section>
            <section className="panel"><h3>Managed with college IT</h3><p>SQL Server connections, Microsoft sign-in, file storage, backups and deployment are managed in the hosting configuration. Ask college IT to change these settings.</p><p>Academic-year rules and controlled workflow stages currently require a reviewed application or database update. The form editor changes form definitions; it does not change workflow rules or rewrite submitted records.</p></section>
          </div> : null}
        </div>
      </div>
    </div>
  );
}

function CoachingConfigurationAdmin({ onDirtyChange }: { onDirtyChange?: (dirty: boolean, saving?: boolean) => void }) {
  const [maxActions, setMaxActions] = useState("");
  const [savedMaxActions, setSavedMaxActions] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const dirty = loaded && maxActions !== savedMaxActions;
  const clearGuard = useUnsavedChanges({ label: "Coaching workflow setting", dirty, saving: isSaving, onSave: saveConfiguration, onDiscard: () => { setMaxActions(savedMaxActions); clearGuard(); } });
  useEffect(() => { onDirtyChange?.(dirty || isSaving, isSaving); }, [dirty, isSaving, onDirtyChange]);

  useEffect(() => {
    void api.coachingConfiguration()
      .then((configuration) => { const value = String(configuration.maxActionsPerSession); setMaxActions(value); setSavedMaxActions(value); setLoaded(true); })
      .catch(() => setMessage("Coaching configuration could not be loaded."));
  }, []);

  async function saveConfiguration() {
    if (isSaving) return false;
    const value = Number(maxActions);
    if (!Number.isInteger(value) || value < 1 || value > 10) {
      setMessage("Enter a maximum between 1 and 10 actions.");
      return false;
    }
    setIsSaving(true);
    try {
      const result = await api.updateCoachingConfiguration(value);
      if (result.ok) { setMaxActions(String(value)); setSavedMaxActions(String(value)); clearGuard(); }
      setMessage(result.ok ? "Coaching action limit updated." : result.message ?? "The coaching configuration could not be saved.");
      return result.ok;
    } catch {
      setMessage("The coaching configuration could not be saved. Try again."); return false;
    } finally { setIsSaving(false); }
  }

  return (
    <section className="panel">
      <div className="panel-heading"><div><h2>Coaching workflow</h2><span>Session-level configuration</span></div></div>
      <div className="lookup-admin-toolbar">
        <label className="entry-field"><span>Maximum new actions per session</span><input disabled={!loaded || isSaving} max={10} min={1} onChange={(event) => setMaxActions(event.target.value)} type="number" value={maxActions} /></label>
        <Button disabled={!loaded || isSaving || !dirty} icon={Save} onClick={() => void saveConfiguration()} variant="primary">Save setting</Button>
        {dirty ? <Button disabled={isSaving} onClick={() => { setMaxActions(savedMaxActions); setMessage(""); }}>Cancel changes</Button> : null}
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
  const clearGuard = useUnsavedChanges({ label: title, dirty: Boolean(newValue), saving: isSaving, onSave: addValue, onDiscard: () => { setNewValue(""); clearGuard(); } });

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
      return false;
    }

    setIsSaving(true);
    const result = await api.addLookupValue(lookupKey, newValue.trim());
    setIsSaving(false);
    if (!result.ok) {
      setStatus(result.message ?? `The ${valueLabel} could not be added.`);
      return false;
    }

    setNewValue(""); clearGuard();
    await refreshValues(`${capitalize(valueLabel)} added.`);
    return true;
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

function StaffAdminPanel({ user, onOpenDetails }: { user: CurrentUser; onOpenDetails: (id: string) => void }) {
  const [accounts, setAccounts] = useState<AdminUserSummary[]>([]);
  const [roles, setRoles] = useState<AdminRoleSummary[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnitSummary[]>([]);
  const [form, setForm] = useState<NewAccountForm>(emptyAccountForm);
  const [rowEdits, setRowEdits] = useState<Record<string, { accountStatus: string }>>({});
  const [accountSearch, setAccountSearch] = useState("");
  const [panelStatus, setPanelStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const formDirty = JSON.stringify(form) !== JSON.stringify(emptyAccountForm);
  const editedAccounts = accounts.filter(account => rowEdits[account.userAccountId] && rowEdits[account.userAccountId].accountStatus !== account.accountStatus);
  const clearGuard = useUnsavedChanges({ label: "Staff account changes", dirty: formDirty || editedAccounts.length > 0, saving: isSaving,
    onSave: async () => { if (formDirty && !await createAccount()) return false; for (const account of editedAccounts) { if (!await saveAccount(account)) return false; } clearGuard(); return true; },
    onDiscard: () => { setForm(emptyAccountForm); setRowEdits({}); clearGuard(); } });

  useEffect(() => {
    void refreshData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshData(resetEdits = true) {
    try {
      const [nextAccounts, nextRoles, nextOrgUnits] = await Promise.all([
        api.adminUsers(),
        api.adminRoles(),
        api.orgUnits()
      ]);
      setAccounts(nextAccounts);
      setRoles(nextRoles);
      setOrgUnits(nextOrgUnits.filter((orgUnit) => orgUnit.isActive));
      if (resetEdits) setRowEdits({});
    } catch {
      setPanelStatus("User accounts could not be loaded from the API.");
    }
  }

  async function createAccount() {
    if (!form.displayName.trim() || !form.email.trim() || !form.externalId.trim()) {
      setPanelStatus("A staff name, email address and staff ID are required.");
      return false;
    }

    if (!form.roleKey) {
      setPanelStatus("Select a role for the new account.");
      return false;
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
      await refreshData(false);
      return true;
    } else {
      setPanelStatus(result.message ?? "The account could not be created."); return false;
    }
  }

  async function saveAccount(account: AdminUserSummary) {
    const edit = rowEdits[account.userAccountId];
    if (!edit) {
      return false;
    }

    setIsSaving(true);
    const result = await api.updateAdminUser(account.userAccountId, {
      accountStatus: edit.accountStatus !== account.accountStatus ? edit.accountStatus : undefined,
      rowVersion: account.rowVersion, staffRowVersion: account.staffRowVersion
    });
    setIsSaving(false);

    if (result.ok) {
      setPanelStatus(`Account for ${account.displayName} updated.`);
      setRowEdits(current => { const next = { ...current }; delete next[account.userAccountId]; return next; });
      await refreshData(false);
      return true;
    } else {
      setPanelStatus(result.message ?? "The account could not be updated."); return false;
    }
  }

  async function toggleDisabled(account: AdminUserSummary) {
    setIsSaving(true);
    const result = await api.updateAdminUser(account.userAccountId, { isDisabled: !account.isDisabled, rowVersion: account.rowVersion, staffRowVersion: account.staffRowVersion });
    setIsSaving(false);

    if (result.ok) {
      setPanelStatus(`Account for ${account.displayName} ${account.isDisabled ? "enabled" : "disabled"}.`);
      await refreshData(false);
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
      <details className="panel admin-create-account">
        <summary>Create a staff account</summary>
        <div className="panel-heading">
          <h2>New staff details</h2>
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
          <Button disabled={isSaving || !user.isAdministrator} icon={UserCog} onClick={() => void createAccount()} variant="primary">
            Create account
          </Button>
          {!user.isAdministrator ? <p>Only Administrators can create accounts and allocate their access.</p> : null}
        </div>
      </details>

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
          <span className="muted-copy">Open details to correct staff category or archive an account. Manage role membership in Roles & permissions.</span>
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
                <th>Actions</th>
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
                          disabled={isSaving || isSelf}
                          onChange={(event) =>
                            setRowEdits((current) => ({
                              ...current,
                              [account.userAccountId]: { ...edit, accountStatus: event.target.value }
                            }))
                          }
                          value={edit.accountStatus}
                        >
                          <option value="active" disabled={!user.isAdministrator && account.accountStatus !== "active"}>Active</option>
                          <option value="inactive">Inactive</option>
                          <option value="leaver">Leaver</option>
                        </select>
                      </td>
                      <td>
                        <input
                          aria-label={`Enable or disable ${account.displayName}`}
                          checked={!account.isDisabled}
                          disabled={isSaving || isSelf || (!user.isAdministrator && account.isDisabled)}
                          onChange={() => void toggleDisabled(account)}
                          type="checkbox"
                        />
                      </td>
                      <td>
                        <Button disabled={isSaving} icon={UserCog} onClick={() => onOpenDetails(account.userAccountId)} variant="quiet">Details</Button>
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

function rolePrecedence(roleKey: string, roles: AdminRoleSummary[]) {
  return roles.find((role) => role.roleKey === roleKey)?.precedence ?? 0;
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

function LearningWalkThemeAdminPanel({ processKey = "learning_walk", title = "Teaching and Learning themes", subtitle = "Shared by Learning Walks, LIV and teaching and learning reporting", onDirtyChange }: { processKey?: "learning_walk" | "als_learning_walk" | "als_liv_practitioner"; title?: string; subtitle?: string; onDirtyChange?: (dirty: boolean, saving?: boolean) => void }) {
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
  const [, setNewThemeAreaChanged] = useState(false);
  const originalArea = groups.find(group => group.id === editingAreaId);
  const originalTheme = groups.flatMap(group => group.themes).find(theme => theme.id === editingId);
  const areaDirty = Boolean(editingAreaId && editingAreaName !== originalArea?.name);
  const themeDirty = Boolean(editingId && (editingName !== originalTheme?.name || editingThemeGroupId !== originalTheme?.themeGroupId));
  const dirty = Boolean(newGroupName || newThemeName || areaDirty || themeDirty);
  const clearGuard = useUnsavedChanges({ label: title, dirty, saving: isSaving, onSave: async () => {
    if (areaDirty && !await saveAreaEdit()) return false;
    if (themeDirty && !await saveEdit()) return false;
    if (newGroupName && !await addThemeArea()) return false;
    if (newThemeName && !await addTheme()) return false;
    clearGuard(); return true;
  }, onDiscard: () => { cancelChanges(); clearGuard(); } });
  useEffect(() => { onDirtyChange?.(dirty || isSaving, isSaving); }, [dirty, isSaving, onDirtyChange]);
  function cancelChanges() {
    if (isSaving) return;
    setNewGroupName(""); setNewThemeName(""); setNewThemeAreaChanged(false);
    setNewThemeGroupId(groups.find((group) => group.isActive)?.id ?? "");
    setEditingAreaId(""); setEditingAreaName(""); setEditingId(""); setEditingName(""); setEditingThemeGroupId(""); setStatus("");
  }

  useEffect(() => {
    void refreshThemes();
  }, [processKey]);

  async function refreshThemes(nextStatus = "") {
    try {
      const nextGroups = await api.adminLearningWalkThemes(processKey);
      setGroups(nextGroups);
      setNewThemeGroupId((current) => nextGroups.some((group) => group.id === current && group.isActive)
        ? current
        : nextGroups.find((group) => group.isActive)?.id ?? "");
      setStatus(nextStatus);
    } catch {
      setStatus("Themes could not be loaded from the API.");
    }
  }

  async function changeTheme(operation: () => Promise<{ ok: boolean; message?: string }>, success: string, afterSuccess?: () => void) {
    if (isSaving) return false;
    setIsSaving(true);
    try {
      const result = await operation();
      if (!result.ok) { setStatus(result.message ?? "The theme change could not be saved."); return false; }
      afterSuccess?.();
      await refreshThemes(success);
      return true;
    } catch { setStatus("The theme change could not be saved. Try again."); return false; }
    finally { setIsSaving(false); }
  }

  async function addThemeArea() {
    if (!newGroupName.trim()) { setStatus("Enter a theme area name."); return false; }
    return await changeTheme(() => api.createLearningWalkThemeGroup({ name: newGroupName.trim() }, processKey), "Theme area added.", () => setNewGroupName(""));
  }
  function startAreaEdit(group: LearningWalkThemeGroup) {
    if (dirty || isSaving) return;
    setEditingAreaId(group.id); setEditingAreaName(group.name); setStatus("");
  }
  async function saveAreaEdit() {
    if (!editingAreaId || !editingAreaName.trim()) { setStatus("A theme area name is required."); return false; }
    return await changeTheme(() => api.updateLearningWalkThemeGroup(editingAreaId, { name: editingAreaName.trim() }),
      "Theme area renamed. Historical records retain their saved labels.", () => setEditingAreaId(""));
  }
  async function setAreaStatus(group: LearningWalkThemeGroup, isActive: boolean) {
    await changeTheme(() => api.setLearningWalkThemeGroupStatus(group.id, isActive), isActive ? "Theme area reactivated." : "Theme area deactivated. Its themes and historical reporting data have been preserved.");
  }
  async function addTheme() {
    if (!newThemeName.trim() || !newThemeGroupId) { setStatus("Enter a theme and select its area."); return false; }
    return await changeTheme(() => api.createLearningWalkTheme({ themeGroupId: newThemeGroupId, name: newThemeName.trim() }, processKey),
      "Theme added.", () => { setNewThemeName(""); setNewThemeAreaChanged(false); });
  }
  function startEdit(theme: LearningWalkTheme) {
    if (dirty || isSaving) return;
    setEditingId(theme.id); setEditingName(theme.name); setEditingThemeGroupId(theme.themeGroupId); setStatus("");
  }
  async function saveEdit() {
    if (!editingId || !editingName.trim() || !editingThemeGroupId) { setStatus("A theme name and area are required."); return false; }
    return await changeTheme(() => api.updateLearningWalkTheme(editingId, { themeGroupId: editingThemeGroupId, name: editingName.trim() }),
      "Theme updated.", () => setEditingId(""));
  }
  async function setThemeStatus(theme: LearningWalkTheme, isActive: boolean) {
    await changeTheme(() => api.setLearningWalkThemeStatus(theme.id, isActive), isActive ? "Theme reactivated." : "Theme deactivated.");
  }
  async function moveTheme(group: LearningWalkThemeGroup, themeIndex: number, direction: -1 | 1) {
    const targetIndex = themeIndex + direction;
    if (targetIndex < 0 || targetIndex >= group.themes.length) return;
    const nextIds = group.themes.map((theme) => theme.id);
    [nextIds[themeIndex], nextIds[targetIndex]] = [nextIds[targetIndex], nextIds[themeIndex]];
    await changeTheme(() => api.reorderLearningWalkThemes(group.id, nextIds), "Theme order updated.");
  }
  const activeGroups = groups.filter((group) => group.isActive);
  const activeThemeCount = activeGroups.reduce(
    (count, group) => count + group.themes.filter((theme) => theme.isActive).length,
    0);

  return (
    <section className="panel learning-theme-admin">
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          <span>{subtitle}</span>
        </div>
        <strong>{activeGroups.length} active areas · {activeThemeCount} active themes</strong>
      </div>

      <div className="learning-theme-area-add-row">
        <label className="entry-field">
          <span>New theme area <strong>Required</strong></span>
          <input disabled={isSaving} onChange={(event) => setNewGroupName(event.target.value)} placeholder="Enter area name" type="text" value={newGroupName} />
        </label>
        <Button disabled={isSaving || !newGroupName.trim()} icon={Plus} onClick={() => void addThemeArea()} variant="secondary">Add area</Button>
      </div>

      <div className="learning-theme-add-row">
        <label className="entry-field">
          <span>Theme area <strong>Required</strong></span>
          <select disabled={isSaving} onChange={(event) => { setNewThemeGroupId(event.target.value); setNewThemeAreaChanged(true); }} value={newThemeGroupId}>
            {activeGroups.length === 0 ? <option value="">No active theme areas</option> : null}
            {activeGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
          </select>
        </label>
        <label className="entry-field">
          <span>New theme <strong>Required</strong></span>
          <input disabled={isSaving} onChange={(event) => setNewThemeName(event.target.value)} placeholder="Enter theme wording" type="text" value={newThemeName} />
        </label>
        <Button disabled={isSaving || !newThemeName.trim() || !newThemeGroupId} icon={Plus} onClick={() => void addTheme()} variant="primary">Add theme</Button>
      </div>

      <p className="learning-theme-governance-note">
        Area names can change safely because records use stable IDs and saved reporting labels. Deactivating an area removes it from new selections without deleting its themes or history.
      </p>

      {dirty ? <div className="toolbar"><span className="muted-copy">Unsaved theme changes</span><Button disabled={isSaving} onClick={cancelChanges}>Cancel all changes</Button></div> : null}
      {status ? <div className="notice-row" role="status">{status}</div> : null}

      <div className="learning-theme-groups">
        {groups.map((group) => (
          <div className={`learning-theme-group${group.isActive ? "" : " is-inactive"}`} key={group.id}>
            <div className="learning-theme-group-heading">
              {editingAreaId === group.id ? (
                <div className="learning-theme-area-edit">
                  <input disabled={isSaving} aria-label="Theme area name" onChange={(event) => setEditingAreaName(event.target.value)} type="text" value={editingAreaName} />
                  <button aria-label="Cancel area editing" className="icon-button" disabled={isSaving} onClick={() => setEditingAreaId("")} title="Cancel area editing" type="button"><X size={16} /></button>
                  <button aria-label="Save theme area" className="icon-button" disabled={isSaving || !editingAreaName.trim()} onClick={() => void saveAreaEdit()} title="Save theme area" type="button"><Save size={16} /></button>
                </div>
              ) : (
                <>
                  <div className="learning-theme-group-title">
                    <h3>{group.name}</h3>
                    <span>{group.isActive ? "Active" : "Inactive"} · {group.themes.length} theme{group.themes.length === 1 ? "" : "s"}</span>
                  </div>
                  <div className="learning-theme-row-actions">
                    <button aria-label={`Rename ${group.name} area`} className="icon-button" disabled={isSaving || dirty} onClick={() => startAreaEdit(group)} title="Rename theme area" type="button"><Edit3 size={16} /></button>
                    <button
                      aria-label={`${group.isActive ? "Deactivate" : "Reactivate"} ${group.name} area`}
                      className="icon-button"
                      disabled={isSaving || dirty}
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
                    <input disabled={isSaving} aria-label="Theme wording" onChange={(event) => setEditingName(event.target.value)} type="text" value={editingName} />
                    <select aria-label="Theme area" disabled={isSaving || theme.isOther} onChange={(event) => setEditingThemeGroupId(event.target.value)} value={editingThemeGroupId}>
                      {groups.filter((candidate) => candidate.isActive || candidate.id === editingThemeGroupId).map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>{candidate.name}{candidate.isActive ? "" : " (inactive)"}</option>
                      ))}
                    </select>
                    <div className="learning-theme-row-actions">
                      <button aria-label="Cancel editing" className="icon-button" disabled={isSaving} onClick={() => setEditingId("")} title="Cancel editing" type="button"><X size={16} /></button>
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
                      <button aria-label={`Move ${theme.name} up`} className="icon-button" disabled={isSaving || dirty || !group.isActive || index === 0} onClick={() => void moveTheme(group, index, -1)} title="Move up" type="button"><ArrowUp size={16} /></button>
                      <button aria-label={`Move ${theme.name} down`} className="icon-button" disabled={isSaving || dirty || !group.isActive || index === group.themes.length - 1} onClick={() => void moveTheme(group, index, 1)} title="Move down" type="button"><ArrowDown size={16} /></button>
                    </div>
                    <div className="learning-theme-row-actions">
                      <button aria-label={`Edit ${theme.name}`} className="icon-button" disabled={isSaving || dirty || !group.isActive} onClick={() => startEdit(theme)} title="Edit theme" type="button"><Edit3 size={16} /></button>
                      <button
                        aria-label={`${theme.isActive ? "Deactivate" : "Reactivate"} ${theme.name}`}
                        className="icon-button"
                        disabled={isSaving || dirty || !group.isActive}
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

function DashboardAdminPanel({ onDirtyChange }: { onDirtyChange?: (dirty: boolean, busy: boolean) => void }) {
  const [facultyState, setFacultyState] = useState({ dirty: false, busy: false });
  const handleFacultyDirty = useCallback((dirty: boolean, busy: boolean) => setFacultyState({ dirty, busy }), []);
  const [savedProcesses, setSavedProcesses] = useState("");
  const [processes, setProcesses] = useState<DashboardProcessConfiguration[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    api.dashboardConfiguration()
      .then((configuration) => { const loaded = [...configuration.processes].sort((left, right) => left.displayOrder - right.displayOrder); setProcesses(loaded); setSavedProcesses(JSON.stringify(loaded)); })
      .catch(() => setMessage("Dashboard configuration could not be loaded."))
      .finally(() => setIsLoading(false));
  }, []);

  const dirty = savedProcesses !== "" && JSON.stringify(processes) !== savedProcesses;
  const clearGuard = useUnsavedChanges({ label: "Dashboard layout", dirty, saving: isSaving, onSave: save, onDiscard: () => { if (savedProcesses) setProcesses(JSON.parse(savedProcesses)); clearGuard(); } });
  useEffect(() => { onDirtyChange?.(dirty || facultyState.dirty, isSaving || facultyState.busy); }, [dirty, facultyState.dirty, facultyState.busy, isSaving, onDirtyChange]);
  useEffect(() => { if (!dirty) return; const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [dirty]);
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
      const result = await api.saveDashboardConfiguration(processes);
      if (!result.ok) throw new Error("Save failed");
      const saved = await api.dashboardConfiguration();
      const loaded = [...saved.processes].sort((left, right) => left.displayOrder - right.displayOrder);
      setProcesses(loaded); setSavedProcesses(JSON.stringify(loaded));
      setMessage("Dashboard configuration saved. Leadership views will use the new layout on refresh.");
      clearGuard(); return true;
    } catch {
      setMessage("Dashboard configuration could not be saved."); return false;
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="admin-dashboard-config">
      <DashboardFacultyAdmin onDirtyChange={handleFacultyDirty} />
      <section className="panel admin-dashboard-intro">
        <div><p className="eyebrow">Reporting governance</p><h2>Leadership dashboard</h2><p>Control the order, naming and analytical emphasis of approved dashboard views. Metrics and permission rules remain protected.</p></div>
        <Button disabled={isLoading || isSaving || !dirty || processes.length === 0} icon={Save} onClick={() => void save()} variant="primary">{isSaving ? "Saving" : "Save configuration"}</Button>
      </section>
      {message ? <div className="form-message">{message}</div> : null}
      {isLoading ? <section className="panel"><p className="muted-copy">Loading dashboard configuration...</p></section> : (
        <section className="panel admin-dashboard-processes">
          <div className="panel-heading"><h2>Dashboard views</h2><span>{processes.filter((process) => process.isEnabled).length} visible</span></div>
          <p className="muted-copy">Disabling a view hides it from navigation; it does not delete records or reporting data. Labels may be changed without changing stable process keys. Outcome matrices and frequency profiles are selected automatically from the type of structured data available.</p>
          <fieldset disabled={isSaving} className="admin-dashboard-process-list" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}><legend className="sr-only">Dashboard presentation settings</legend>
            {processes.map((process, index) => <article className={process.isEnabled ? "" : "is-disabled"} key={process.processKey}>
              <div className="admin-dashboard-order"><Button aria-label="Move up" disabled={index === 0} icon={ArrowUp} onClick={() => move(index, -1)} variant="secondary">Up</Button><Button aria-label="Move down" disabled={index === processes.length - 1} icon={ArrowDown} onClick={() => move(index, 1)} variant="secondary">Down</Button></div>
              <div className="admin-dashboard-identity"><small>{process.processKey}</small><input aria-label={`${process.label} dashboard label`} maxLength={80} onChange={(event) => update(process.processKey, { label: event.target.value })} value={process.label}/></div>
              <div className="admin-dashboard-widgets" aria-label={`${process.label} visible analysis`}>
                <label><input checked={process.showTrend} onChange={(event) => update(process.processKey, { showTrend: event.target.checked })} type="checkbox"/>Trend</label>
                <label><input checked={process.showAreaComparison} onChange={(event) => update(process.processKey, { showAreaComparison: event.target.checked })} type="checkbox"/>Areas</label>
                <label><input checked={process.showOutcomes} onChange={(event) => update(process.processKey, { showOutcomes: event.target.checked })} type="checkbox"/>Outcomes</label>
                <label><input checked={process.showActions} onChange={(event) => update(process.processKey, { showActions: event.target.checked })} type="checkbox"/>Actions</label>
              </div>
              <label className="admin-dashboard-enabled"><input checked={process.isEnabled} disabled={process.processKey === "overview"} onChange={(event) => update(process.processKey, { isEnabled: event.target.checked })} type="checkbox"/><span>{process.processKey === "overview" ? "Required" : process.isEnabled ? "Visible" : "Hidden"}</span></label>
            </article>)}
          </fieldset>
        </section>
      )}
      <section className="panel admin-dashboard-guardrails"><ShieldCheck size={20}/><div><h3>Protected reporting guardrails</h3><p>Administrators can change presentation, but cannot expose restricted narrative responses, alter scope permissions, introduce arbitrary database queries or delete historical reporting labels.</p></div></section>
    </div>
  );
}
