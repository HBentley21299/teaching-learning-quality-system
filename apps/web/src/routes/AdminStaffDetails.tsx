import { Archive, RefreshCw, RotateCcw, Save, Search, UserCog, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../design-system/Button";
import { confirmUnsavedNavigation, useUnsavedChanges } from "../components/UnsavedChangesGuard";
import { api } from "../services/api";
import type { AdminUserSummary, OrgUnitSummary } from "../services/types";

type StaffEdit = { displayName: string; jobTitle: string; staffCategory: string; scopeIds: string[] };

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

export function AdminStaffDetails({ initialUserAccountId, onDirtyChange, isAdministrator = false }: { initialUserAccountId?: string; onDirtyChange?: (dirty: boolean) => void; isAdministrator?: boolean }) {
  const [accounts, setAccounts] = useState<AdminUserSummary[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnitSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [edit, setEdit] = useState<StaffEdit | null>(null);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
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
  const clearUnsaved = useUnsavedChanges({ label: "Staff details", dirty, saving, onSave: save, onDiscard: cancel });

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
    const query = search.trim().toLowerCase();
    return accounts.filter((account) => (showArchived || !account.archivedAt)
      && [account.displayName, account.email, account.externalId, account.jobTitle ?? ""]
      .some((value) => value.toLowerCase().includes(query)))
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  }, [accounts, search, showArchived]);
  const selectableUnits = useMemo(() => orgUnits.filter((unit) => unit.isActive
    && ["faculty", "team", "faculty_child_code", "faculty_child", "directorate"].includes(unit.orgUnitType))
    .sort((left, right) => left.code.localeCompare(right.code)), [orgUnits]);
  const scopeOptions = selectableUnits.filter((unit) => `${unit.code} ${unit.name}`.toLowerCase().includes(scopeSearch.trim().toLowerCase()));
  const retainedScopes = edit?.scopeIds.filter((id) => !selectableUnits.some((unit) => unit.id === id)) ?? [];
  const nameError = edit && !edit.displayName.trim() ? "Enter a staff name." : "";
  const titleError = selected?.jobTitle && edit && !edit.jobTitle.trim()
    ? "Enter a replacement job title. Removing an existing title is not supported by the current service." : "";

  function chooseAccount(id: string) {
    if (dirty || saving) return;
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
          : "Staff details saved.");
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
        setEdit(saved ? editFor(saved) : null);
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
        <div className="panel-heading"><div><h2>Staff details &amp; scope</h2><span>Update staff details, access areas and archived accounts.</span></div><UserCog size={22} aria-hidden="true" /></div>
        <div className="lookup-admin-toolbar">
          <label className="entry-field"><span>Find staff</span><div className="role-candidate-input"><Search size={17} aria-hidden="true" /><input disabled={loading || saving || dirty} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name, email, staff ID or job title" value={search} /></div></label>
          <Button disabled={loading || saving || dirty} icon={RefreshCw} onClick={() => { setMessage(""); void load(); }}>Refresh staff</Button>
        </div>
        <label className="compact-checkbox"><input checked={showArchived} disabled={loading || saving || dirty} onChange={(event) => toggleArchived(event.target.checked)} type="checkbox" /><span>Include archived staff</span></label>
        <label className="entry-field"><span>Staff member</span><select disabled={loading || saving || dirty} onChange={(event) => chooseAccount(event.target.value)} value={selectedId}>
          <option value="">{loading ? "Loading staff…" : "Choose a staff member"}</option>
          {visibleAccounts.map((account) => <option key={account.userAccountId} value={account.userAccountId}>{account.displayName} · {account.externalId} · {account.email}{account.archivedAt ? " · Archived" : ""}</option>)}
        </select></label>
        {!loading && !error && visibleAccounts.length === 0 ? <p className="empty-row">{search ? "No staff match your search." : "No staff accounts are available."}</p> : null}
        {dirty ? <p className="notice-row" role="status">You have unsaved changes. Save or cancel before choosing another staff member.</p> : null}
        {error ? <div className="notice-row" role="alert">{error}</div> : null}
        {message ? <div className="notice-row" role="status">{message}</div> : null}
      </section>
      {selected && edit ? <section className="panel">
        <div className="panel-heading"><div><h2>{selected.displayName}</h2><span>{selected.email} · {selected.externalId}</span></div><span>{selected.archivedAt ? "Archived" : selected.isDisabled ? "Disabled account" : selected.accountStatus}</span></div>
        <p className="muted-copy">Email and staff ID are identity fields. Corrections follow the college’s account management process. Use Staff accounts for account status and Roles &amp; permissions for role allocations.</p>
        <div className="route-stack">
          <label className="entry-field"><span>Staff name</span><input aria-describedby={nameError ? "staff-details-name-error" : undefined} aria-invalid={!!nameError} disabled={saving || !!selected.archivedAt} maxLength={220} onChange={(event) => setEdit({ ...edit, displayName: event.target.value })} value={edit.displayName} />{nameError ? <small id="staff-details-name-error">{nameError}</small> : null}</label>
          <label className="entry-field"><span>Job title</span><input aria-describedby={titleError ? "staff-details-title-error" : undefined} aria-invalid={!!titleError} disabled={saving || !!selected.archivedAt} maxLength={200} onChange={(event) => setEdit({ ...edit, jobTitle: event.target.value })} value={edit.jobTitle} />{titleError ? <small id="staff-details-title-error">{titleError}</small> : null}</label>
          <label className="entry-field"><span>Staff category</span><select disabled={saving || !!selected.archivedAt} onChange={(event) => setEdit({ ...edit, staffCategory: event.target.value })} value={edit.staffCategory}><option disabled value="">Not recorded</option>{staffCategories.map((category) => <option key={category.key} value={category.key}>{category.label}</option>)}</select></label>
          <p className="muted-copy">This corrects the category shown for self-declared leaders. It does not change permissions or managed unit assignments; use Organisation for those.</p>
          <fieldset disabled={saving || !!selected.archivedAt || !isAdministrator}>
            <legend>Assigned organisational scope</legend>
            {!isAdministrator ? <p className="muted-copy">Only an Administrator can change organisational access.</p> : null}
            <p className="muted-copy">Choose the areas this account can access through its existing roles. Adding an area can expose records from that area. Organisation leadership may require a scope to remain assigned; manage leadership in Organisation.</p>
            <label className="entry-field"><span>Find an organisational area</span><input onChange={(event) => setScopeSearch(event.target.value)} placeholder="Search by code or name" value={scopeSearch} /></label>
            <p className="muted-copy">{edit.scopeIds.length} areas selected. Save applies the selection shown below.</p>
            {edit.scopeIds.length > 0 ? <div className="role-permission-summary" aria-label="Selected areas">{edit.scopeIds.map((id) => <span key={id}>{orgUnits.find((unit) => unit.id === id)?.code ?? selected.scopes.find((scope) => scope.orgUnitId === id)?.orgUnitCode ?? "Existing assigned area"}</span>)}</div> : <p className="muted-copy">No areas selected. Saving removes manually assigned areas; scopes required by leadership are retained.</p>}
            <div className="admin-scope-options">
              {scopeOptions.map((unit) => <label className="compact-checkbox" key={unit.id}><input checked={edit.scopeIds.includes(unit.id)} onChange={(event) => setEdit({ ...edit, scopeIds: event.target.checked ? [...edit.scopeIds, unit.id] : edit.scopeIds.filter((id) => id !== unit.id) })} type="checkbox" /><span><strong>{unit.code}</strong> · {unit.name}</span></label>)}
              {scopeOptions.length === 0 ? <p className="empty-row">No selectable areas match your search.</p> : null}
            </div>
            {retainedScopes.length > 0 ? <p className="muted-copy">{retainedScopes.length} existing assignments are outside the current area catalogue and will be preserved. Review these in Organisation.</p> : null}
            {selected.scopes.some((scope) => scope.scopeType !== "assigned_org_units") ? <p className="muted-copy">Other access scope: {[...new Set(selected.scopes.filter((scope) => scope.scopeType !== "assigned_org_units").map((scope) => scope.scopeType.replaceAll("_", " ")))].join(", ")}. These scopes remain unchanged.</p> : null}
          </fieldset>
          <div className="admin-row-actions"><Button disabled={!dirty || saving || !!nameError || !!titleError || !!selected.archivedAt} icon={Save} onClick={() => void save()} variant="primary">{saving ? "Saving…" : "Save changes"}</Button><Button disabled={!dirty || saving} icon={X} onClick={() => void confirmUnsavedNavigation()}>Cancel</Button></div>
          <div className="admin-row-actions"><Button disabled={!isAdministrator || dirty || saving} icon={selected.archivedAt ? RotateCcw : Archive} onClick={() => void changeArchiveState()}>{selected.archivedAt ? "Restore staff account" : "Archive staff account"}</Button></div>
        </div>
      </section> : null}
    </div>
  );
}
