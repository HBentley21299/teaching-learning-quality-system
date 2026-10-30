import { ScrollableTableRegion } from "../components/ScrollableTableRegion";
import { LoadingState } from "../components/LoadingState";
import { confirmUnsavedNavigation, useUnsavedChanges } from "../components/UnsavedChangesGuard";
import { DashboardFacultyAdmin } from "./DashboardFacultyAdmin";
import { PermissionAdminPanel } from "./PermissionsAdmin";
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Building2, Database, Edit3, FileText, LayoutDashboard, ListChecks, Mail, Plus, RefreshCw, Save, Search, ShieldCheck, SlidersHorizontal, Sparkles, UserCog, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { FormBuilder } from "./FormBuilder";
import { AdminFormVersions } from "./AdminFormVersions";
import { AdminWorkflowContent } from "./AdminWorkflowContent";
import { AdminProcessReviews } from "./AdminProcessReviews";
import { AdminManagedLists } from "./AdminManagedLists";
import { AdminCsvImport } from "./AdminCsvImport";
import { AdminSettingsLayout } from "../components/AdminSettingsLayout";
import { AdminElevatePractice } from "./AdminElevatePractice";
import { ElevateStatusAssetsAdmin } from "./ElevateStatusAssetsAdmin";
import { AdminWorkScrutiny } from "./AdminWorkScrutiny";
import { AdminRecordsPanel } from "./AdminRecordsPanel";
import { OrganisationStructureAdmin } from "./OrganisationStructureAdmin";
import { MessagingAdminPanel } from "./MessagingAdminPanel";
import { AdminListSort } from "../components/AdminListSort";
import { distinctListValues, matchesListSearch, sortListRows } from "../services/listQuery";

export function AdminCentre({ user, modules, onOpenRecord, initialTab = "overview", onTabChange, onNavigatePath }: {
  user: CurrentUser;
  modules: ModuleSummary[];
  staff: StaffSummary[];
  onOpenRecord: (record: AdminRecord) => void;
  initialTab?: string;
  onTabChange?: (tab: string) => void;
  onNavigatePath?: (path: string) => void;
}) {
  const sections = accessibleAdminSections(user.permissions, user.isAdministrator === true);
  const [activeTab, setActiveTab] = useState<AdminSectionKey>(() => resolveAdminSectionKey(initialTab));
  const [staffDetailsFocusId, setStaffDetailsFocusId] = useState("");
  const [editorBusy, setEditorBusy] = useState(false);
  const handleEditorDirty = useCallback((_dirty: boolean, saving = false) => setEditorBusy(saving), []);
  useEffect(() => {
    const key = resolveAdminSectionKey(initialTab);
    const section = accessibleAdminSections(user.permissions, user.isAdministrator === true).find(item => item.key === key);
    if (section?.path && onNavigatePath) onNavigatePath(section.path);
    else setActiveTab(key);
  }, [initialTab, user.permissions, user.isAdministrator, onNavigatePath]);
  const section = sections.find(item => item.key === activeTab);
  const current = section?.key;
  async function selectTab(key: AdminSectionKey) {
    if (editorBusy || key === activeTab || !await confirmUnsavedNavigation()) return;
    const destination = sections.find(item => item.key === key);
    if (!destination) return;
    if (destination.path) { onNavigatePath?.(destination.path); return; }
    setEditorBusy(false);
    setActiveTab(key);
    onTabChange?.(key);
  }
  const relatedKeys = current === "forms" || current === "form-versions" || current === "workflow-form-content" ? ["form-versions", "workflow-form-content", "work-scrutiny-templates", "work-scrutiny-template-setup", "learning-walk-templates", "cpd-templates", "environment-templates", "all-lists", "teaching-themes", "coaching-session"]
    : current === "dashboards" || current?.startsWith("dashboard-") ? ["dashboard-faculties", "organisation-reporting", "dashboard-presentation", "qa-dashboard-faculties"]
    : ["staff-access", "staff-details", "staff-scope", "roles", "archived-staff"].includes(current ?? "") ? ["staff-access", "staff-details", "staff-scope", "roles", "archived-staff", "organisation-leadership", "organisation-membership"]
    : current?.startsWith("liv-") ? ["delivery-areas", "liv-visit-focus", "liv-preferences", "teaching-themes"]
    : current?.startsWith("coaching-") ? ["coaching-session", "coaching-qualifications", "coaching-focus", "coaching-support"]
    : current?.startsWith("cpd-") ? ["cpd-import", "cpd-templates", "cpd-themes", "cpd-action-themes", "list-import"]
    : current === "list-import" || current === "all-lists" || Boolean(section?.lookupKey) ? ["list-import", "all-lists"]
    : current === "message-templates" || current === "email-delivery" || current === "message-history" ? ["message-templates", "email-delivery", "message-history"]
    : current === "work-scrutiny" || current === "work-scrutiny-templates" || current === "work-scrutiny-template-setup" ? ["work-scrutiny-templates", "work-scrutiny-template-setup", "work-scrutiny-action-themes", "work-scrutiny", "records"]
    : [];
  const related = sections.filter(item => item.key !== current && relatedKeys.includes(item.key));
  if (sections.length === 0) return <section className="panel"><h1>Administration unavailable</h1><p>Your account has no administration permissions.</p></section>;
  return <AdminSettingsLayout title="i-Elevate administration" description="Find the task you need, then open its focused settings page. QA Hub has its own administration area." entries={sections} activeKey={activeTab} onSelect={selectTab} storageKey="ielevate" busy={editorBusy}>
    {!section ? <section className="panel" role="alert"><h2>Setting unavailable</h2><p>This page does not exist or is not available to your account. Use Administration home to choose a permitted setting.</p><Button onClick={() => void selectTab("overview")}>Administration home</Button></section> : null}
    <div key={current} className="admin-focused-editor">
      {current === "staff-access" ? <StaffAdminPanel user={user} onOpenDetails={id => { setStaffDetailsFocusId(id); void selectTab("staff-details"); }} /> : null}
      {current === "staff-details" || current === "staff-scope" || current === "archived-staff" ? <AdminStaffDetails isAdministrator={user.isAdministrator} initialUserAccountId={staffDetailsFocusId} onDirtyChange={handleEditorDirty} view={current === "staff-scope" ? "scope" : current === "archived-staff" ? "archived" : "details"} /> : null}
      {current === "roles" || current === "permission-tiers" ? <PermissionAdminPanel user={user} onDirtyChange={handleEditorDirty} view={current === "roles" ? "people" : "tiers"} /> : null}
      {current === "organisation" || current === "organisation-leadership" || current === "organisation-membership" || current === "organisation-reviews" || current === "organisation-reporting" ? <OrganisationStructureAdmin isAdministrator={user.isAdministrator} view={current === "organisation-leadership" ? "leadership" : current === "organisation-membership" ? "membership" : current === "organisation-reviews" ? "reviews" : current === "organisation-reporting" ? "reporting" : "structure"} /> : null}
      {section?.templateModule || current === "form-versions" ? <AdminFormVersions moduleKey={section?.templateModule} onDirtyChange={handleEditorDirty} /> : null}
      {current === "workflow-form-content" ? <AdminWorkflowContent onDirtyChange={handleEditorDirty} /> : null}
      {current === "digital-learning-walks" || current === "activate-growth-reviews" ? <AdminProcessReviews processKey={current === "digital-learning-walks" ? "digital_learning_walk" : "activate_growth_review"} onDirtyChange={handleEditorDirty} /> : null}
      {current === "work-scrutiny-template-setup" ? <FormBuilder embedded user={user} moduleKey="work_scrutiny" onDirtyChange={handleEditorDirty} /> : null}
      {section?.lookupKey ? <AdminManagedLists lookupKeys={[section.lookupKey]} onDirtyChange={handleEditorDirty} /> : null}
      {current === "all-lists" ? <AdminManagedLists excludeLookupKeys={["action_theme_qa_review"]} onDirtyChange={handleEditorDirty} /> : null}
      {current === "cpd-import" || current === "list-import" ? <AdminCsvImport key={current} kind={current === "cpd-import" ? "cpd-events" : "managed-list-values"} user={user} onDirtyChange={handleEditorDirty} onOpenDestination={onNavigatePath} /> : null}
      {section?.themeProcess ? <LearningWalkThemeAdminPanel processKey={section.themeProcess} title={section.label} subtitle={section.description} onDirtyChange={handleEditorDirty} /> : null}
      {current === "coaching-session" ? <CoachingConfigurationAdmin onDirtyChange={handleEditorDirty} /> : null}
      {current === "rooms" ? <AdminRooms onDirtyChange={handleEditorDirty} /> : null}
      {current === "elevate" ? <AdminElevatePractice /> : null}
      {current === "badges" ? <ElevateStatusAssetsAdmin /> : null}
      {current === "records" ? <AdminRecordsPanel onOpenRecord={onOpenRecord} /> : null}
      {current === "work-scrutiny" ? <AdminWorkScrutiny /> : null}
      {current === "message-templates" || current === "email-delivery" || current === "message-history" ? <MessagingAdminPanel view={current === "email-delivery" ? "delivery" : current === "message-history" ? "history" : "templates"} onDirtyChange={handleEditorDirty} /> : null}
      {current === "dashboard-faculties" ? <DashboardFacultyAdmin excludeDashboardKeys={["qa_review"]} onDirtyChange={handleEditorDirty} /> : null}
      {current === "dashboard-presentation" ? <DashboardAdminPanel onDirtyChange={handleEditorDirty} /> : null}
      {current === "forms" ? <section className="panel"><h3>Choose the part of the form you need to change</h3><ul><li><strong>Form versions and additional questions:</strong> edit template wording, guidance and sections, or add questions with nine supported answer types. Preview a separate draft before publishing it for future records; published versions remain unchanged.</li><li><strong>Review and action wording:</strong> edit the 47 supported prompts and their guidance across LIV, ALS LIV, probation, coaching, UCO, ELI and standalone actions. This changes current display wording while retaining existing answers.</li><li><strong>Work Scrutiny template creation and allocation:</strong> create a separate template, allocate it to sub-teams, or retire it.</li><li><strong>Choices and themes:</strong> open the named list or theme page. QA questions, outcomes and form access belong to QA Hub administration.</li></ul><p>Answer types for protected fields, required workflow rules, owners, visibility, cycle progression and award calculations remain controlled. Published record corrections belong under Records &amp; audit.</p></section> : null}
      {current === "dashboards" ? <section className="panel"><h3>Choose the level of reporting change</h3><ul><li><strong>Faculty datasets:</strong> which faculties contribute to a specific dashboard and its exports.</li><li><strong>Organisation-wide inclusion:</strong> whether a unit and its descendants may contribute across reporting.</li><li><strong>Dashboard presentation:</strong> labels, ordering and visible analysis panels.</li></ul><p>Reporting permissions are maintained under Staff role allocations. QA’s faculty dataset is maintained in QA Hub administration.</p></section> : null}
      {current === "modules" ? <section className="panel"><h3>Installed module availability</h3><p className="muted-copy">Controlled by the application release. Staff permissions also determine access.</p><ul className="admin-module-list">{modules.map(module => <li key={module.id}><span>{module.name}</span><strong>{module.isEnabled ? "Enabled" : "Disabled"}</strong></li>)}</ul></section> : null}
      {current === "system" ? <section className="panel"><h3>Managed with college IT</h3><dl className="admin-configuration-owners"><dt>Hosting and sign-in</dt><dd>SQL connections, Microsoft authentication, file storage, backups and deployment are maintained in hosting configuration.</dd><dt>Academic years and controlled workflow rules</dt><dd>Date rules, fixed workflow stages, LIV cycle progression and award thresholds require a reviewed application or database change.</dd><dt>Identity and course catalogues</dt><dd>Staff email/external IDs and catalogue imports need their existing identity and history safeguards.</dd></dl><p>A form-template change edits its definition; it does not change workflow validation or rewrite submitted records.</p></section> : null}
    </div>
    {current && current !== "overview" && related.length > 0 ? <section className="panel admin-related-settings"><h3>Related settings</h3><div>{related.map(item => <button type="button" disabled={editorBusy} key={item.key} onClick={() => void selectTab(item.key)}><strong>{item.label}</strong><span>{item.description}</span></button>)}</div></section> : null}
  </AdminSettingsLayout>;
}
function CoachingConfigurationAdmin({ onDirtyChange }: { onDirtyChange?: (dirty: boolean, saving?: boolean) => void }) {
  const [maxActions, setMaxActions] = useState("");
  const [savedMaxActions, setSavedMaxActions] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const dirty = loaded && maxActions !== savedMaxActions;
  const clearGuard = useUnsavedChanges({ label: "Coaching workflow setting", dirty, saving: isSaving, onSave: saveConfiguration, onDiscard: () => { setMaxActions(savedMaxActions); clearGuard(); } });
  useEffect(() => { onDirtyChange?.(dirty || isSaving, isSaving); }, [dirty, isSaving, onDirtyChange]);

  useEffect(() => {
    let cancelled = false;
    setLoadError("");
    void api.coachingConfiguration()
      .then((configuration) => { if (cancelled) return; const value = String(configuration.maxActionsPerSession); setMaxActions(value); setSavedMaxActions(value); setLoaded(true); })
      .catch(() => { if (!cancelled) setLoadError("Coaching settings could not be loaded. Try again."); });
    return () => { cancelled = true; };
  }, [attempt]);

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
      {loadError ? <div className="notice-row" role="alert">{loadError}<Button onClick={() => setAttempt(value => value + 1)}>Try again</Button></div> : !loaded ? <LoadingState label="Loading coaching settings" /> : null}
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
  const [accountRole, setAccountRole] = useState("");
  const [accountArea, setAccountArea] = useState("");
  const [accountState, setAccountState] = useState("");
  const [accountSort, setAccountSort] = useState("name-asc");
  const [panelStatus, setPanelStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadError, setLoadError] = useState("");
  const loadSequence = useRef(0);
  const formDirty = JSON.stringify(form) !== JSON.stringify(emptyAccountForm);
  const editedAccounts = accounts.filter(account => rowEdits[account.userAccountId] && rowEdits[account.userAccountId].accountStatus !== account.accountStatus);
  const clearGuard = useUnsavedChanges({ label: "Staff account changes", dirty: formDirty || editedAccounts.length > 0, saving: isSaving,
    onSave: async () => { if (formDirty && !await createAccount()) return false; for (const account of editedAccounts) { if (!await saveAccount(account)) return false; } clearGuard(); return true; },
    onDiscard: () => { setForm(emptyAccountForm); setRowEdits({}); clearGuard(); } });

  useEffect(() => {
    void refreshData();
    return () => { ++loadSequence.current; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshData(resetEdits = true) {
    const sequence = ++loadSequence.current;
    setLoadingAccounts(true); setLoadError("");
    try {
      const [nextAccounts, nextRoles, nextOrgUnits] = await Promise.all([
        api.adminUsers(),
        api.adminRoles(),
        api.orgUnits()
      ]);
      if (sequence !== loadSequence.current) return;
      setAccounts(nextAccounts);
      setRoles(nextRoles);
      setOrgUnits(nextOrgUnits.filter((orgUnit) => orgUnit.isActive));
      if (resetEdits) setRowEdits({});
    } catch {
      if (sequence === loadSequence.current) setLoadError("Staff accounts could not be loaded. Check your connection and try again.");
    } finally { if (sequence === loadSequence.current) setLoadingAccounts(false); }
  }

  async function createAccount() {
    if (isSaving || loadingAccounts || loadError || !user.isAdministrator) return false;
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
    return sortListRows(accounts.filter(account => (!accountRole || account.roles.some(role => role.roleKey === accountRole))
      && (!accountArea || account.primaryOrgCode === accountArea)
      && (!accountState || (accountState === "disabled" ? account.isDisabled : accountState === "enabled" ? !account.isDisabled : account.accountStatus === accountState))
      && matchesListSearch(accountSearch, account.displayName, account.email, account.externalId, account.primaryOrgCode, account.jobTitle, account.staffCategory, account.accountStatus, account.roles.map(role => [role.name, role.roleKey]), account.scopes.map(scope => [scope.orgUnitCode, scope.scopeType]))),
      account => accountSort.startsWith("email") ? account.email : accountSort.startsWith("id") ? account.externalId : accountSort.startsWith("login") ? Date.parse(account.lastLoginAt ?? "") : account.displayName, accountSort.endsWith("desc") ? "desc" : "asc", account => account.userAccountId);
  }, [accountSearch, accounts, accountRole, accountArea, accountState, accountSort]);

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
        <fieldset className="admin-field-grid admin-dialog-fields" disabled={isSaving || loadingAccounts || !user.isAdministrator}><legend className="sr-only">New staff account details</legend>
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
        </fieldset>
        {panelStatus ? <div className="notice-row" role="status">{panelStatus}</div> : null}
        {loadingAccounts ? <LoadingState label="Loading staff accounts" /> : null}
        {loadError ? <div className="notice-row" role="alert">{loadError}<Button disabled={loadingAccounts || isSaving} onClick={() => void refreshData(false)}>Try again</Button></div> : null}
        <div className="toolbar admin-panel-actions">
          <Button disabled={isSaving || loadingAccounts || Boolean(loadError) || !user.isAdministrator} icon={UserCog} onClick={() => void createAccount()} variant="primary">
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
            <Button disabled={loadingAccounts || isSaving} icon={RefreshCw} onClick={async () => { if (await confirmUnsavedNavigation()) void refreshData(); }} variant="secondary">Refresh</Button>
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
          <label className="entry-field"><span>Permission tier</span><select value={accountRole} onChange={event => setAccountRole(event.target.value)}><option value="">All tiers</option>{sortListRows([...new Map(accounts.flatMap(account => account.roles).map(role => [role.roleKey, role])).values()], role => role.name).map(role => <option key={role.roleKey} value={role.roleKey}>{role.name}</option>)}</select></label>
          <label className="entry-field"><span>Primary area</span><select value={accountArea} onChange={event => setAccountArea(event.target.value)}><option value="">All areas</option>{distinctListValues(accounts.map(account => account.primaryOrgCode)).map(value => <option key={value}>{value}</option>)}</select></label>
          <label className="entry-field"><span>Account status</span><select value={accountState} onChange={event => setAccountState(event.target.value)}><option value="">All statuses</option><option value="enabled">Sign-in enabled</option><option value="disabled">Sign-in disabled</option>{distinctListValues(accounts.map(account => account.accountStatus)).filter(value => !["enabled", "disabled"].includes(value)).map(value => <option key={value}>{value}</option>)}</select></label>
          <AdminListSort value={accountSort} onChange={setAccountSort} options={[["name-asc","Name: A–Z"],["name-desc","Name: Z–A"],["email-asc","Email: A–Z"],["id-asc","Staff ID: A–Z"],["login-desc","Last sign-in: newest first"]]} />
          <span className="muted-copy">Open Details to correct a staff category. Use Staff role allocations for permissions, or Archived staff &amp; restoration to archive or restore an account.</span>
        </div>
        <ScrollableTableRegion label="Administration data">
          <table aria-label="Administration data">
            <thead>
              <tr>
                <th scope="col">Staff member</th>
                <th scope="col">Staff ID</th>
                <th scope="col">Role</th>
                <th scope="col">Scope</th>
                <th scope="col">Status</th>
                <th scope="col">Enabled</th>
                <th scope="col">Actions</th>
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
                         aria-label={`Save changes for ${account.displayName}`}>
                          <Save size={16} aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </ScrollableTableRegion>
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
  const [profileSort, setProfileSort] = useState("name-asc");
  const [profileArea, setProfileArea] = useState("");
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    api
      .staffProfileRecords()
      .then(setRecords)
      .catch(() => setLoadError("Staff Profile records could not be loaded from the API."));
  }, []);

  const filteredRecords = sortListRows(records.filter((record) => {
    const matchesSearch = matchesListSearch(searchTerm, record.displayName, record.email, record.externalId, record.primaryOrgCode);
    const matchesReflection =
      reflectionFilter === "all" ||
      (reflectionFilter === "has_reflections" && record.reflectionCount > 0) ||
      (reflectionFilter === "none" && record.reflectionCount === 0) ||
      (reflectionFilter === "submitted" && record.submittedReflections > 0) ||
      (reflectionFilter === "draft" && record.draftReflections > 0);
    return matchesSearch && matchesReflection && (!profileArea || record.primaryOrgCode === profileArea);
  }), record => profileSort.startsWith("reflections") ? record.reflectionCount : profileSort.startsWith("actions") ? record.openActions : profileSort.startsWith("id") ? record.externalId : record.displayName, profileSort.endsWith("desc") ? "desc" : "asc", record => record.staffId);

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
          <label className="entry-field"><span>Primary area</span><select value={profileArea} onChange={event => setProfileArea(event.target.value)}><option value="">All areas</option>{distinctListValues(records.map(record => record.primaryOrgCode)).map(value => <option key={value}>{value}</option>)}</select></label>
          <AdminListSort value={profileSort} onChange={setProfileSort} options={[["name-asc","Staff: A–Z"],["name-desc","Staff: Z–A"],["id-asc","Staff ID: A–Z"],["reflections-desc","Reflections: most first"],["actions-desc","Open actions: most first"]]} />
        </div>
        <ScrollableTableRegion label="Administration data">
          <table aria-label="Administration data">
            <thead>
              <tr>
                <th scope="col">Staff member</th>
                <th scope="col">Staff ID</th>
                <th scope="col">CPD sessions</th>
                <th scope="col">Evidence</th>
                <th scope="col">Reflections</th>
                <th scope="col">Open actions</th>
                <th scope="col">Directory status</th>
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
        </ScrollableTableRegion>
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
  const [loadError, setLoadError] = useState("");
  const [loadingThemes, setLoadingThemes] = useState(true);
  const loadSequence = useRef(0);
  const [, setNewThemeAreaChanged] = useState(false);
  const [themeQuery, setThemeQuery] = useState("");
  const [themeStatus, setThemeAvailabilityFilter] = useState("all");
  const [themeSort, setThemeSort] = useState("configured");
  const canReorderThemes = !themeQuery.trim() && themeStatus === "all" && themeSort === "configured";
  const themeMatches = (theme: LearningWalkTheme, group: LearningWalkThemeGroup) => theme.id === editingId || ((themeStatus === "all" || (theme.isActive && group.isActive) === (themeStatus === "active")) && matchesListSearch(themeQuery, group.name, theme.name));
  const visibleThemeGroups = sortListRows(groups.filter(group => group.id === editingAreaId || group.themes.some(theme => themeMatches(theme, group)) || (!group.themes.length && matchesListSearch(themeQuery, group.name) && (themeStatus === "all" || group.isActive === (themeStatus === "active")))), group => themeSort === "configured" ? groups.indexOf(group) : group.name, themeSort.endsWith("desc") ? "desc" : "asc", group => group.id);
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
    return () => { ++loadSequence.current; };
  }, [processKey]);

  async function refreshThemes(nextStatus = "") {
    const sequence = ++loadSequence.current;
    setLoadingThemes(true); setLoadError("");
    try {
      const nextGroups = await api.adminLearningWalkThemes(processKey);
      if (sequence !== loadSequence.current) return;
      setGroups(nextGroups);
      setNewThemeGroupId((current) => nextGroups.some((group) => group.id === current && group.isActive)
        ? current
        : nextGroups.find((group) => group.isActive)?.id ?? "");
      setStatus(nextStatus);
    } catch {
      if (sequence === loadSequence.current) setLoadError("Themes could not be loaded. Check your connection and try again.");
    } finally { if (sequence === loadSequence.current) setLoadingThemes(false); }
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
    if (!canReorderThemes) return;
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
      {loadingThemes ? <LoadingState label="Loading themes" /> : null}
      {loadError ? <div className="notice-row" role="alert">{loadError}<Button disabled={loadingThemes || isSaving} onClick={() => void refreshThemes()}>Try again</Button></div> : null}

<div className="filter-toolbar"><label className="entry-field"><span>Find a theme or area</span><input type="search" value={themeQuery} onChange={event => setThemeQuery(event.target.value)} /></label><label className="entry-field"><span>Availability</span><select value={themeStatus} onChange={event => setThemeAvailabilityFilter(event.target.value)}><option value="all">All themes</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label><AdminListSort value={themeSort} onChange={setThemeSort} options={[["configured","Configured form order"],["name-asc","Name: A–Z"],["name-desc","Name: Z–A"]]} /></div>
      {!canReorderThemes ? <p className="muted-copy">Clear filters and choose configured form order to move themes. View sorting does not change saved form order.</p> : null}
      <div className="learning-theme-groups">
        {visibleThemeGroups.map((group) => (
          <div className={`learning-theme-group${group.isActive ? "" : " is-inactive"}`} key={group.id}>
            <div className="learning-theme-group-heading">
              {editingAreaId === group.id ? (
                <div className="learning-theme-area-edit">
                  <input disabled={isSaving} aria-label="Theme area name" onChange={(event) => setEditingAreaName(event.target.value)} type="text" value={editingAreaName} />
                  <button aria-label="Cancel area editing" className="icon-button" disabled={isSaving} onClick={() => setEditingAreaId("")} title="Cancel area editing" type="button"><X size={16}  aria-hidden="true"/></button>
                  <button aria-label="Save theme area" className="icon-button" disabled={isSaving || !editingAreaName.trim()} onClick={() => void saveAreaEdit()} title="Save theme area" type="button"><Save size={16}  aria-hidden="true"/></button>
                </div>
              ) : (
                <>
                  <div className="learning-theme-group-title">
                    <h3>{group.name}</h3>
                    <span>{group.isActive ? "Active" : "Inactive"} · {group.themes.length} theme{group.themes.length === 1 ? "" : "s"}</span>
                  </div>
                  <div className="learning-theme-row-actions">
                    <button aria-label={`Rename ${group.name} area`} className="icon-button" disabled={isSaving || dirty} onClick={() => startAreaEdit(group)} title="Rename theme area" type="button"><Edit3 size={16}  aria-hidden="true"/></button>
                    <button
                      aria-label={`${group.isActive ? "Deactivate" : "Reactivate"} ${group.name} area`}
                      className="icon-button"
                      disabled={isSaving || dirty}
                      onClick={() => void setAreaStatus(group, !group.isActive)}
                      title={group.isActive ? "Deactivate theme area" : "Reactivate theme area"}
                      type="button"
                    >
                      {group.isActive ? <Archive size={16}  aria-hidden="true"/> : <ArchiveRestore size={16}  aria-hidden="true"/>}
                    </button>
                  </div>
                </>
              )}
            </div>
            {group.themes.length === 0 ? <div className="empty-row">No themes in this area.</div> : null}
            {sortListRows(group.themes.filter(theme => themeMatches(theme, group)), theme => themeSort === "configured" ? group.themes.indexOf(theme) : theme.name, themeSort.endsWith("desc") ? "desc" : "asc", theme => theme.id).map((theme) => (
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
                      <button aria-label="Cancel editing" className="icon-button" disabled={isSaving} onClick={() => setEditingId("")} title="Cancel editing" type="button"><X size={16}  aria-hidden="true"/></button>
                      <button aria-label="Save theme" className="icon-button" disabled={isSaving || !editingName.trim()} onClick={() => void saveEdit()} title="Save theme" type="button"><Save size={16}  aria-hidden="true"/></button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="learning-theme-name">
                      <strong>{theme.name}</strong>
                      <span>{!group.isActive ? "Area inactive" : theme.isActive ? "Active" : "Inactive"}</span>
                    </div>
                    <div className="learning-theme-order-actions">
                      <button aria-label={`Move ${theme.name} up`} className="icon-button" disabled={!canReorderThemes || isSaving || dirty || !group.isActive || group.themes.indexOf(theme) === 0} onClick={() => void moveTheme(group, group.themes.indexOf(theme), -1)} title="Move up" type="button"><ArrowUp size={16}  aria-hidden="true"/></button>
                      <button aria-label={`Move ${theme.name} down`} className="icon-button" disabled={!canReorderThemes || isSaving || dirty || !group.isActive || group.themes.indexOf(theme) === group.themes.length - 1} onClick={() => void moveTheme(group, group.themes.indexOf(theme), 1)} title="Move down" type="button"><ArrowDown size={16}  aria-hidden="true"/></button>
                    </div>
                    <div className="learning-theme-row-actions">
                      <button aria-label={`Edit ${theme.name}`} className="icon-button" disabled={isSaving || dirty || !group.isActive} onClick={() => startEdit(theme)} title="Edit theme" type="button"><Edit3 size={16}  aria-hidden="true"/></button>
                      <button
                        aria-label={`${theme.isActive ? "Deactivate" : "Reactivate"} ${theme.name}`}
                        className="icon-button"
                        disabled={isSaving || dirty || !group.isActive}
                        onClick={() => void setThemeStatus(theme, !theme.isActive)}
                        title={theme.isActive ? "Deactivate theme" : "Reactivate theme"}
                        type="button"
                      >
                        {theme.isActive ? <Archive size={16}  aria-hidden="true"/> : <ArchiveRestore size={16}  aria-hidden="true"/>}
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
  const [savedProcesses, setSavedProcesses] = useState("");
  const [processQuery, setProcessQuery] = useState("");
  const [processStatus, setProcessStatus] = useState("");
  const [processSort, setProcessSort] = useState("configured");
  const canReorderProcesses = !processQuery.trim() && !processStatus && processSort === "configured";
  const [processes, setProcesses] = useState<DashboardProcessConfiguration[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true); setLoadError("");
    api.dashboardConfiguration()
      .then((configuration) => { if (cancelled) return; const loaded = [...configuration.processes].sort((left, right) => left.displayOrder - right.displayOrder); setProcesses(loaded); setSavedProcesses(JSON.stringify(loaded)); })
      .catch(() => { if (!cancelled) setLoadError("Dashboard settings could not be loaded. Try again."); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [attempt]);

  const dirty = savedProcesses !== "" && JSON.stringify(processes) !== savedProcesses;
  const clearGuard = useUnsavedChanges({ label: "Dashboard layout", dirty, saving: isSaving, onSave: save, onDiscard: () => { if (savedProcesses) setProcesses(JSON.parse(savedProcesses)); clearGuard(); } });
  useEffect(() => { onDirtyChange?.(dirty, isSaving); }, [dirty, isSaving, onDirtyChange]);
  useEffect(() => { if (!dirty) return; const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [dirty]);
  function update(processKey: string, changes: Partial<DashboardProcessConfiguration>) {
    setProcesses((current) => current.map((process) => process.processKey === processKey ? { ...process, ...changes } : process));
  }

  function move(index: number, direction: -1 | 1) {
    if (!canReorderProcesses) return;
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
    let persisted = false;
    try {
      const result = await api.saveDashboardConfiguration(processes);
      if (!result.ok) { setMessage(result.message ?? "Dashboard settings could not be saved. Your changes are still here."); return false; }
      persisted = true; setSavedProcesses(JSON.stringify(processes)); clearGuard();
      const saved = await api.dashboardConfiguration();
      const loaded = [...saved.processes].sort((left, right) => left.displayOrder - right.displayOrder);
      setProcesses(loaded); setSavedProcesses(JSON.stringify(loaded));
      setMessage("Dashboard configuration saved. Leadership views will use the new layout on refresh.");
      clearGuard(); return true;
    } catch {
      setMessage(persisted ? "Dashboard settings were saved, but the updated view could not be loaded. Reload the page to check them." : "Dashboard settings could not be saved. Your changes are still here."); return persisted;
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="admin-dashboard-config">
      <section className="panel admin-dashboard-intro">
        <div><p className="eyebrow">Reporting</p><h2>Dashboard presentation</h2><p>Arrange dashboards, edit their names and choose the charts people see.</p></div>
        <Button disabled={isLoading || isSaving || !dirty || processes.length === 0} icon={Save} onClick={() => void save()} variant="primary">{isSaving ? "Saving" : "Save configuration"}</Button>
      </section>
      {message ? <div className="form-message" role="status">{message}</div> : null}
      {loadError ? <div className="notice-row" role="alert">{loadError}<Button disabled={isLoading} onClick={() => setAttempt(value => value + 1)}>Try again</Button></div> : null}
      {isLoading ? <LoadingState label="Loading dashboard settings" /> : loadError && !processes.length ? null : (
        <section className="panel admin-dashboard-processes">
          <div className="panel-heading"><h2>Dashboard views</h2><span>{processes.filter((process) => process.isEnabled).length} visible</span></div>
          <p className="muted-copy">Disabling a view hides it from navigation; it does not delete records or reporting data. Labels may be changed without changing stable process keys. Outcome matrices and frequency profiles are selected automatically from the type of structured data available.</p>
<div className="filter-toolbar"><label className="entry-field"><span>Find a dashboard</span><input type="search" value={processQuery} onChange={event => setProcessQuery(event.target.value)} /></label><label className="entry-field"><span>Visibility</span><select value={processStatus} onChange={event => setProcessStatus(event.target.value)}><option value="">All views</option><option value="visible">Visible</option><option value="hidden">Hidden</option></select></label><AdminListSort value={processSort} onChange={setProcessSort} options={[["configured","Configured navigation order"],["name-asc","Dashboard: A–Z"],["name-desc","Dashboard: Z–A"]]} /></div>
          {!canReorderProcesses ? <p className="muted-copy">Clear filters and choose configured navigation order to move dashboards.</p> : null}
          <fieldset disabled={isSaving} className="admin-dashboard-process-list" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}><legend className="sr-only">Dashboard presentation settings</legend>
            {sortListRows(processes.filter(process => matchesListSearch(processQuery, process.label, process.processKey) && (!processStatus || process.isEnabled === (processStatus === "visible"))), process => processSort === "configured" ? processes.indexOf(process) : process.label, processSort.endsWith("desc") ? "desc" : "asc", process => process.processKey).map((process) => <article className={process.isEnabled ? "" : "is-disabled"} key={process.processKey}>
              <div className="admin-dashboard-order"><Button aria-label="Move up" disabled={!canReorderProcesses || processes.indexOf(process) === 0} icon={ArrowUp} onClick={() => move(processes.indexOf(process), -1)} variant="secondary">Up</Button><Button aria-label="Move down" disabled={!canReorderProcesses || processes.indexOf(process) === processes.length - 1} icon={ArrowDown} onClick={() => move(processes.indexOf(process), 1)} variant="secondary">Down</Button></div>
              <div className="admin-dashboard-identity" title={process.processKey}><small>Dashboard name</small><input aria-label={`${process.label} dashboard label`} maxLength={80} onChange={(event) => update(process.processKey, { label: event.target.value })} value={process.label}/></div>
              <div className="admin-dashboard-widgets" aria-label={`${process.label} visible analysis`}>
                <label><input checked={process.showTrend} onChange={(event) => update(process.processKey, { showTrend: event.target.checked })} type="checkbox"/>Trends over time</label>
                <label><input checked={process.showAreaComparison} onChange={(event) => update(process.processKey, { showAreaComparison: event.target.checked })} type="checkbox"/>Faculty and team comparison</label>
                <label><input checked={process.showOutcomes} onChange={(event) => update(process.processKey, { showOutcomes: event.target.checked })} type="checkbox"/>Review outcomes</label>
                <label><input checked={process.showActions} onChange={(event) => update(process.processKey, { showActions: event.target.checked })} type="checkbox"/>Linked actions</label>
              </div>
              <label className="admin-dashboard-enabled"><input checked={process.isEnabled} disabled={process.processKey === "overview"} onChange={(event) => update(process.processKey, { isEnabled: event.target.checked })} type="checkbox"/><span>{process.processKey === "overview" ? "Required" : process.isEnabled ? "Visible" : "Hidden"}</span></label>
            </article>)}
          </fieldset>
        </section>
      )}
      <p className="muted-copy">These settings change labels and charts. Existing access permissions and saved records still apply.</p>
    </div>
  );
}
