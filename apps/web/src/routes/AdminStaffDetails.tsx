import { Archive, RefreshCw, RotateCcw, Save, Search, UserCog, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../design-system/Button";
import { LoadingState } from "../components/LoadingState";
import { confirmUnsavedNavigation, useUnsavedChanges } from "../components/UnsavedChangesGuard";
import { api } from "../services/api";
import type { AdminUserSummary, OrgUnitSummary } from "../services/types";
import { AdminListSort } from "../components/AdminListSort";
import { distinctListValues, matchesListSearch, sortListRows } from "../services/listQuery";

type StaffEdit = { displayName: string; jobTitle: string; staffCategory: string; scopeIds: string[] };
type StaffDetailsView = "all" | "details" | "scope" | "archived";

const staffViewGuidance: Record<StaffDetailsView, { title: string; description: string }> = {
  all: { title: "Staff details & scope", description: "Update staff details, access areas and archived accounts." },
  details: { title: "Staff details", description: "Find a staff member, amend their name, job title or staff category, then save the changes." },
  scope: { title: "Organisation access", description: "Find a staff member, select the areas their existing roles can access, then save the selection." },
  archived: { title: "Archived staff", description: "Restore an archived staff account, or include active staff to review an account for archiving." }
};

const staffCategories = [
  { key: "head_of_faculty_sector_manager", label: "Head of Faculty / Sector Manager" },
  { key: "programme_leader", label: "Programme Leader" },
  { key: "tutor_tutor_assessor", label: "Tutor / Tutor Assessor" },
  { key: "other", label: "Other" }
];

function assignedScopeIds(account: AdminUserSummary) {
  return [...new Set(account.scopes
    .filter((scope) => scope.scopeType === "assigned_org_units" && scope.orgUnitId)
    .map((scope) => scope.orgUnitId!))].sort();
}

function editFor(account: AdminUserSummary): StaffEdit {
  return { displayName: account.displayName, jobTitle: account.jobTitle ?? "", staffCategory: account.staffCategory ?? "", scopeIds: assignedScopeIds(account) };
}

function sameScopes(left: string[], right: string[]) {
  return [...left].sort().join(",") === [...right].sort().join(",");
}

export function AdminStaffDetails({ initialUserAccountId, onDirtyChange, isAdministrator = false, view = "all" }: { initialUserAccountId?: string; onDirtyChange?: (dirty: boolean) => void; isAdministrator?: boolean; view?: StaffDetailsView }) {
  const showDetails = view === "all" || view === "details";
  const showScope = view === "all" || view === "scope";
  const showArchiveManagement = view === "all" || view === "archived";
  const guidance = staffViewGuidance[view];
  const [accounts, setAccounts] = useState<AdminUserSummary[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnitSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [edit, setEdit] = useState<StaffEdit | null>(null);
  const [search, setSearch] = useState("");
  const [orgFilter, setOrgFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [accountFilter, setAccountFilter] = useState("");
  const [sort, setSort] = useState("name-asc");
  const [scopeSort, setScopeSort] = useState("code-asc");
  const [showArchived, setShowArchived] = useState(view === "archived");
  const [includeActive, setIncludeActive] = useState(false);
  const [scopeSearch, setScopeSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const selected = accounts.find((account) => account.userAccountId === selectedId);
  const scopesChanged = !!selected && !!edit && !sameScopes(edit.scopeIds, assignedScopeIds(selected));
  const dirty = !!selected && !!edit && (edit.displayName !== selected.displayName
    || edit.jobTitle !== (selected.jobTitle ?? "")
    || edit.staffCategory !== (selected.staffCategory ?? "") || scopesChanged);
  const clearUnsaved = useUnsavedChanges({ label: guidance.title, dirty, saving, onSave: save, onDiscard: cancel });

  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const preventUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [dirty]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [nextAccounts, nextUnits] = await Promise.all([api.adminUsers(true), api.orgUnits()]);
      setAccounts(nextAccounts);
      setOrgUnits(nextUnits);
      const current = nextAccounts.find((account) => account.userAccountId === (selectedId || initialUserAccountId));
      setSelectedId(current?.userAccountId ?? "");
      setEdit(current ? editFor(current) : null);
    } catch {
      setError("Staff details could not be loaded. Try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const visibleAccounts = useMemo(() => {
    return sortListRows(accounts.filter((account) => (view === "archived" ? includeActive || !!account.archivedAt : showArchived || !account.archivedAt)
      && (!orgFilter || account.primaryOrgCode === orgFilter)
      && (!roleFilter || account.roles.some(role => role.roleKey === roleFilter))
      && (!accountFilter || (accountFilter === "disabled" ? account.isDisabled : !account.isDisabled))
      && matchesListSearch(search, account.displayName, account.email, account.externalId, account.jobTitle, account.staffCategory, account.primaryOrgCode, account.accountStatus, account.roles.map(role => [role.name, role.roleKey]), account.scopes.map(scope => scope.orgUnitCode))),
      account => sort.startsWith("email") ? account.email : sort.startsWith("id") ? account.externalId : sort.startsWith("login") ? Date.parse(account.lastLoginAt ?? "") : account.displayName, sort.endsWith("desc") ? "desc" : "asc", account => account.userAccountId);
  }, [accounts, includeActive, search, showArchived, view, orgFilter, roleFilter, accountFilter, sort]);
  const selectableUnits = useMemo(() => orgUnits.filter((unit) => unit.isActive
    && ["faculty", "team", "faculty_child_code", "faculty_child", "directorate"].includes(unit.orgUnitType))
    .sort((left, right) => left.code.localeCompare(right.code)), [orgUnits]);
  const scopeOptions = sortListRows(selectableUnits.filter((unit) => matchesListSearch(scopeSearch, unit.code, unit.name, unit.orgUnitType)), unit => scopeSort.startsWith("name") ? unit.name : unit.code, "asc", unit => unit.code);
  const retainedScopes = edit?.scopeIds.filter((id) => !selectableUnits.some((unit) => unit.id === id)) ?? [];
  const nameError = edit && !edit.displayName.trim() ? "Enter a staff name." : "";
  const titleError = selected?.jobTitle && edit && !edit.jobTitle.trim()
    ? "Enter a replacement job title. Removing an existing title is not supported by the current service." : "";

  async function chooseAccount(id: string) {
    if (saving || id === selectedId || !await confirmUnsavedNavigation()) return;
    const account = accounts.find((item) => item.userAccountId === id);
    setSelectedId(id);
    setEdit(account ? editFor(account) : null);
    setScopeSearch("");
    setError("");
    setMessage("");
  }

  function toggleArchived(value: boolean) {
    if (dirty || saving) return;
    setShowArchived(value);
    if (!value && selected?.archivedAt) {
      setSelectedId("");
      setEdit(null);
    }
  }

  function cancel() {
    if (!selected || saving) return;
    setEdit(editFor(selected));
    setError("");
    setMessage("Unsaved changes discarded.");
    clearUnsaved();
  }

  async function save() {
    if (!selected || !edit || saving || nameError || titleError) return false;
    if (!dirty) return true;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await api.updateAdminUser(selected.userAccountId, {
        rowVersion: selected.rowVersion,
        staffRowVersion: selected.staffRowVersion,
        displayName: edit.displayName !== selected.displayName ? edit.displayName.trim() : undefined,
        jobTitle: edit.jobTitle !== (selected.jobTitle ?? "") ? edit.jobTitle.trim() : undefined,
        staffCategory: edit.staffCategory !== (selected.staffCategory ?? "") ? edit.staffCategory : undefined,
        scopeOrgUnitIds: isAdministrator && scopesChanged ? edit.scopeIds : undefined
      });
      if (!result.ok) {
        setError(result.message ?? "Staff details could not be saved. Your changes are still here.");
        return false;
      }
      clearUnsaved();
      // Read the actual saved scopes: leadership assignments can preserve a removed scope.
      try {
        const nextAccounts = await api.adminUsers(true);
        const saved = nextAccounts.find((account) => account.userAccountId === selected.userAccountId);
        setAccounts(nextAccounts);
        setEdit(saved ? editFor(saved) : null);
        setSelectedId(saved?.userAccountId ?? "");
        setMessage(saved && scopesChanged && !sameScopes(assignedScopeIds(saved), edit.scopeIds)
          ? "Changes saved. Organisation leadership requires some scopes to remain assigned; the saved scope is shown below."
          : view === "scope" ? "Organisation access saved." : "Staff details saved.");
      } catch {
        // Do not offer another save against an unverified scope snapshot.
        setSelectedId("");
        setEdit(null);
        setAccounts([]);
        setError("Changes were saved, but the updated details could not be reloaded. Refresh staff before making further changes.");
      }
      return true;
    } catch {
      setError("The save could not be confirmed. Your changes are still here; check the connection before trying again.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function changeArchiveState() {
    if (!isAdministrator || !selected || dirty || saving) return;
    const archiving = !selected.archivedAt;
    const confirmed = window.confirm(archiving
      ? `Archive ${selected.displayName}? Their sign-in, roles and active organisation assignments will end. Historical records remain available.`
      : `Restore ${selected.displayName}? Their account will stay disabled until you assign roles, review scope and re-enable it.`);
    if (!confirmed) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await api.setAdminUserArchived(selected.userAccountId, archiving, selected.rowVersion, selected.staffRowVersion);
      if (!result.ok) {
        setError(result.message ?? "The account could not be updated.");
        return;
      }
      try {
        const nextAccounts = await api.adminUsers(true);
        const saved = nextAccounts.find((account) => account.userAccountId === selected.userAccountId);
        setAccounts(nextAccounts);
        setShowArchived(archiving ? true : showArchived);
        if (view === "archived" && !archiving && !includeActive) {
          setSelectedId("");
          setEdit(null);
        } else {
          setEdit(saved ? editFor(saved) : null);
        }
        setMessage(archiving
          ? "Staff account archived. Sign-in, roles and current organisation assignments have ended."
          : "Staff account restored. Assign roles and organisation access, then re-enable it before use.");
      } catch {
        setSelectedId("");
        setEdit(null);
        setAccounts([]);
        setError("The account was updated, but its new status could not be reloaded. Refresh staff before making further changes.");
      }
    } catch {
      setError("The account change could not be confirmed. Refresh staff before trying again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="route-stack">
      <section className="panel">
        <div className="panel-heading"><div><h2>{guidance.title}</h2><span>{guidance.description}</span></div><UserCog size={22} aria-hidden="true" /></div>
        <div className="lookup-admin-toolbar">
          <label className="entry-field"><span>Find staff</span><div className="role-candidate-input"><Search size={17} aria-hidden="true" /><input type="search" disabled={loading || saving} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name, email, staff ID or job title" value={search} /></div></label>
          <Button disabled={loading || saving || dirty} icon={RefreshCw} onClick={() => { setMessage(""); void load(); }}>Refresh staff</Button>
          <label className="entry-field"><span>Primary area</span><select disabled={loading || saving} value={orgFilter} onChange={event => setOrgFilter(event.target.value)}><option value="">All areas</option>{distinctListValues(accounts.map(account => account.primaryOrgCode)).map(value => <option key={value}>{value}</option>)}</select></label>
          <label className="entry-field"><span>Permission tier</span><select disabled={loading || saving} value={roleFilter} onChange={event => setRoleFilter(event.target.value)}><option value="">All tiers</option>{sortListRows([...new Map(accounts.flatMap(account => account.roles).map(role => [role.roleKey, role])).values()], role => role.name).map(role => <option key={role.roleKey} value={role.roleKey}>{role.name}</option>)}</select></label>
          <label className="entry-field"><span>Sign-in</span><select disabled={loading || saving} value={accountFilter} onChange={event => setAccountFilter(event.target.value)}><option value="">All accounts</option><option value="enabled">Enabled</option><option value="disabled">Disabled</option></select></label>
          <AdminListSort disabled={loading || saving} value={sort} onChange={setSort} options={[["name-asc","Name: A–Z"],["name-desc","Name: Z–A"],["email-asc","Email: A–Z"],["id-asc","Staff ID: A–Z"],["login-desc","Last sign-in: newest first"]]} />
        </div>
        {view === "archived" ? <label className="compact-checkbox"><input checked={includeActive} disabled={loading || saving || dirty} onChange={(event) => {
          setIncludeActive(event.target.checked);
          if (!event.target.checked && selected && !selected.archivedAt) { setSelectedId(""); setEdit(null); }
        }} type="checkbox" /><span>Include active staff for archiving</span></label>
          : <label className="compact-checkbox"><input checked={showArchived} disabled={loading || saving || dirty} onChange={(event) => toggleArchived(event.target.checked)} type="checkbox" /><span>Include archived staff</span></label>}
        <label className="entry-field"><span>Staff member</span><select disabled={loading || saving} onChange={(event) => void chooseAccount(event.target.value)} value={selectedId}>
          <option value="">{loading ? "Loading staff…" : "Choose a staff member"}</option>
          {selected && !visibleAccounts.some(account => account.userAccountId === selectedId) ? <option value={selectedId}>{selected.displayName} · Current selection (outside filters)</option> : null}
          {visibleAccounts.map((account) => <option key={account.userAccountId} value={account.userAccountId}>{account.displayName} · {account.externalId} · {account.email}{account.archivedAt ? " · Archived" : ""}</option>)}
        </select></label>
        {loading ? <LoadingState label="Loading staff accounts" /> : null}
        {!loading && !error && visibleAccounts.length === 0 ? <p className="empty-row">{search ? "No staff match your search." : view === "archived" && !includeActive ? "No archived staff accounts are available." : "No staff accounts are available."}</p> : null}
        {dirty ? <p className="notice-row" role="status">You have unsaved changes. Save or cancel before choosing another staff member.</p> : null}
        {error ? <div className="notice-row" role="alert">{error}</div> : null}
        {message ? <div className="notice-row" role="status">{message}</div> : null}
      </section>
      {selected && edit ? <section className="panel">
        <div className="panel-heading"><div><h2>{selected.displayName}</h2><span>{selected.email} · {selected.externalId}</span></div><span>{selected.archivedAt ? "Archived" : selected.isDisabled ? "Disabled account" : selected.accountStatus}</span></div>
        <p className="muted-copy">Email and staff ID are identity fields. Corrections follow the college’s account management process. Use Staff accounts for sign-in status and Role allocations for roles.</p>
        {selected.archivedAt ? <p className="notice-row">This account is archived. Restore it in Archived staff before changing its details or organisation access.</p> : null}
        <div className="route-stack">
          {showDetails ? <><label className="entry-field"><span>Staff name</span><input aria-describedby={nameError ? "staff-details-name-error" : undefined} aria-invalid={!!nameError} disabled={saving || !!selected.archivedAt} maxLength={220} onChange={(event) => setEdit({ ...edit, displayName: event.target.value })} value={edit.displayName} />{nameError ? <small id="staff-details-name-error">{nameError}</small> : null}</label>
          <label className="entry-field"><span>Job title</span><input aria-describedby={titleError ? "staff-details-title-error" : undefined} aria-invalid={!!titleError} disabled={saving || !!selected.archivedAt} maxLength={200} onChange={(event) => setEdit({ ...edit, jobTitle: event.target.value })} value={edit.jobTitle} />{titleError ? <small id="staff-details-title-error">{titleError}</small> : null}</label>
          <label className="entry-field"><span>Staff category</span><select disabled={saving || !!selected.archivedAt} onChange={(event) => setEdit({ ...edit, staffCategory: event.target.value })} value={edit.staffCategory}><option disabled value="">Not recorded</option>{staffCategories.map((category) => <option key={category.key} value={category.key}>{category.label}</option>)}</select></label>
          <p className="muted-copy">Staff category describes their post. Use Organisation leadership for managed unit assignments and Role allocations for permissions.</p></> : <p className="muted-copy">{selected.jobTitle ?? "Job title not recorded"} · Staff category: {staffCategories.find((category) => category.key === selected.staffCategory)?.label ?? selected.staffCategory?.replaceAll("_", " ") ?? "Not recorded"}</p>}
          {showScope ? <fieldset disabled={saving || !!selected.archivedAt || !isAdministrator}>
            <legend>Assigned organisational scope</legend>
            {!isAdministrator ? <p className="muted-copy">Only an Administrator can change organisational access.</p> : null}
            <p className="muted-copy">Choose the areas this account can access through its existing roles. Adding an area can expose records from that area. Organisation leadership may require a scope to remain assigned; review those assignments in Organisation leadership.</p>
            <label className="entry-field"><span>Find an organisational area</span><input onChange={(event) => setScopeSearch(event.target.value)} placeholder="Search by code or name" value={scopeSearch} /></label>
            <AdminListSort value={scopeSort} onChange={setScopeSort} label="Sort areas by" options={[["code-asc","Area code: A–Z"],["name-asc","Area name: A–Z"]]} />
            <p className="muted-copy">{edit.scopeIds.length} areas selected. Save applies the selection shown below.</p>
            {edit.scopeIds.length > 0 ? <div className="role-permission-summary" aria-label="Selected areas">{edit.scopeIds.map((id) => <span key={id}>{orgUnits.find((unit) => unit.id === id)?.code ?? selected.scopes.find((scope) => scope.orgUnitId === id)?.orgUnitCode ?? "Existing assigned area"}</span>)}</div> : <p className="muted-copy">No areas selected. Saving removes manually assigned areas; scopes required by leadership are retained.</p>}
            <div className="admin-scope-options">
              {scopeOptions.map((unit) => <label className="compact-checkbox" key={unit.id}><input checked={edit.scopeIds.includes(unit.id)} onChange={(event) => setEdit({ ...edit, scopeIds: event.target.checked ? [...edit.scopeIds, unit.id] : edit.scopeIds.filter((id) => id !== unit.id) })} type="checkbox" /><span><strong>{unit.code}</strong> · {unit.name}</span></label>)}
              {scopeOptions.length === 0 ? <p className="empty-row">No selectable areas match your search.</p> : null}
            </div>
            {retainedScopes.length > 0 ? <p className="muted-copy">{retainedScopes.length} existing assignments are outside the current area catalogue and will be preserved. Review these in Team membership or Organisation leadership.</p> : null}
            {selected.scopes.some((scope) => scope.scopeType !== "assigned_org_units") ? <p className="muted-copy">Other access scope: {[...new Set(selected.scopes.filter((scope) => scope.scopeType !== "assigned_org_units").map((scope) => scope.scopeType.replaceAll("_", " ")))].join(", ")}. These scopes remain unchanged.</p> : null}
          </fieldset> : null}
          {showDetails || showScope ? <div className="admin-row-actions"><Button disabled={!dirty || saving || !!nameError || !!titleError || !!selected.archivedAt} icon={Save} onClick={() => void save()} variant="primary">{saving ? "Saving…" : view === "scope" ? "Save organisation access" : "Save changes"}</Button><Button disabled={!dirty || saving} icon={X} onClick={() => void confirmUnsavedNavigation()}>Cancel</Button></div> : null}
          {showArchiveManagement ? <>
            <p className="muted-copy">{selected.archivedAt ? "Restoring leaves the account disabled. Review its roles and organisation access, then enable sign-in in Staff accounts." : "Archiving ends sign-in, roles and active organisation assignments. Historical records remain available. You will be asked to confirm."}</p>
            <div className="admin-row-actions"><Button disabled={!isAdministrator || dirty || saving} icon={selected.archivedAt ? RotateCcw : Archive} onClick={() => void changeArchiveState()}>{selected.archivedAt ? "Restore staff account" : "Archive staff account"}</Button></div>
          </> : null}
        </div>
      </section> : null}
    </div>
  );
}
