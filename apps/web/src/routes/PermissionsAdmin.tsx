import { confirmUnsavedNavigation, useUnsavedChanges } from "../components/UnsavedChangesGuard";
import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Save, Search, Plus } from "lucide-react";
import { Button } from "../design-system/Button";
import { api } from "../services/api";
import type { AdminRoleSummary, AdminUserSummary, CurrentUser, PermissionSummary } from "../services/types";
import "./PermissionsAdmin.css";

type TierEdit = { id?: string; name: string; description: string; permissionKeys: string[]; rowVersion?: string };
const newTier = (): TierEdit => ({ name: "", description: "", permissionKeys: [] });

export function PermissionAdminPanel({ user, onDirtyChange }: { user: CurrentUser; onDirtyChange?: (dirty: boolean, busy: boolean) => void }) {
  const [roles, setRoles] = useState<AdminRoleSummary[]>([]);
  const [accounts, setAccounts] = useState<AdminUserSummary[]>([]);
  const [catalogue, setCatalogue] = useState<PermissionSummary[]>([]);
  const [view, setView] = useState<"people" | "tiers">(user.permissions.includes("users.manage") ? "people" : "tiers");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [tier, setTier] = useState<TierEdit | null>(null);
  const [tierBaseline, setTierBaseline] = useState("");
  const tierDirty = !!tier && JSON.stringify(tier) !== tierBaseline;
  const [capabilitySearch, setCapabilitySearch] = useState("");
  const [selectedRoleKey, setSelectedRoleKey] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const canAllocate = user.isAdministrator === true;
  const canReadAccounts = user.permissions.includes("users.manage");
  const canConstruct = user.isAdministrator === true;
  const selected = accounts.find(account => account.userAccountId === selectedId);
  const selectedRole = roles.find(role => role.roleKey === selectedRoleKey);
  const rolesDirty = !!selected && [...selectedRoles].sort().join() !== selected.roles.map(role => role.roleKey).sort().join();
  const dirty = rolesDirty || tierDirty;
  const clearGuard = useUnsavedChanges({ label: "Staff access and permission tiers", dirty, saving: busy, onSave: () => tierDirty ? saveTier() : saveAllocation(), onDiscard: () => { setTier(null); setTierBaseline(""); setSelectedRoles(selected?.roles.map(role => role.roleKey) ?? []); clearGuard(); } });
  useEffect(() => { onDirtyChange?.(dirty, busy); }, [dirty, busy, onDirtyChange]);

  async function load() {
    setBusy(true); setError("");
    try {
      const [nextRoles, nextAccounts, nextCatalogue] = await Promise.all([
        api.adminRoles(), canReadAccounts ? api.adminUsers() : Promise.resolve([]), canConstruct ? api.permissionCatalogue() : Promise.resolve([])
      ]);
      setRoles(nextRoles); setAccounts(nextAccounts); setCatalogue(nextCatalogue);
      setSelectedRoleKey(current => current || nextRoles[0]?.roleKey || "");
      const account = nextAccounts.find(item => item.userAccountId === selectedId);
      setSelectedRoles(account?.roles.map(role => role.roleKey) ?? []);
    } catch { setError("Permissions could not be loaded. Your saved settings have not changed."); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!dirty) return;
    const listener = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", listener);
    return () => window.removeEventListener("beforeunload", listener);
  }, [dirty]);

  const matchingAccounts = useMemo(() => accounts.filter(account =>
    [account.displayName, account.email, account.externalId, account.jobTitle ?? "", account.staffCategory ?? "", account.primaryOrgCode ?? ""].join(" ").toLowerCase().includes(search.toLowerCase())), [accounts, search]);
  const effectivePermissions = roles.filter(role => selectedRoles.includes(role.roleKey)).flatMap(role => role.permissions)
    .filter((permission, index, list) => list.findIndex(item => item.permissionKey === permission.permissionKey) === index);

  async function chooseAccount(account: AdminUserSummary) {
    if (busy || account.userAccountId === selectedId || !await confirmUnsavedNavigation()) return;
    setSelectedId(account.userAccountId); setSelectedRoles(account.roles.map(role => role.roleKey)); setMessage(""); setError("");
  }
  async function saveAllocation() {
    if (!selected || !rolesDirty || busy) return false;
    setBusy(true); setMessage(""); setError("");
    try {
      const result = await api.updateAdminUser(selected.userAccountId, { roleKeys: selectedRoles, rowVersion: selected.rowVersion, staffRowVersion: selected.staffRowVersion });
      if (!result.ok) { setError(result.message ?? "Access could not be saved."); return false; }
      setMessage(`Permission tiers saved for ${selected.displayName}.`);
      await load(); clearGuard(); return true;
    } catch { setError("Access could not be saved. Review the selections and try again."); return false; }
    finally { setBusy(false); }
  }
  async function editTier(role: AdminRoleSummary) {
    setBusy(true); setError("");
    try {
      const detail = await api.customRole(role.id);
      const next = { ...detail, description: detail.description ?? "" }; setTier(next); setTierBaseline(JSON.stringify(next));
    } catch { setError("This tier could not be opened. Refresh and try again."); }
    finally { setBusy(false); }
  }
  async function saveTier() {
    if (!tier || busy) return false;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await api.saveCustomRole(tier.id, tier);
      if (!result.ok) { setError(result.message ?? "The tier could not be saved."); return false; }
      setTier(null); setTierBaseline(""); setMessage("Permission tier saved. Allocate it to people from Staff access.");
      await load(); clearGuard(); return true;
    } catch { setError("The tier could not be saved. Your selections are retained."); return false; }
    finally { setBusy(false); }
  }
  function toggleCapability(key: string) {
    setTier(current => current ? { ...current, permissionKeys: current.permissionKeys.includes(key) ? current.permissionKeys.filter(item => item !== key) : [...current.permissionKeys, key] } : null);

  }
  return <section className="panel permission-admin-panel">
    <div className="panel-heading"><div><h2>Access and permission tiers</h2><p className="muted-copy">Choose what each person can do, then manage which organisation areas they can access separately.</p></div><Button icon={RefreshCw} disabled={busy || dirty} onClick={() => void load()}>Refresh</Button></div>
    {!canAllocate ? <p role="status">Only Administrators can change staff access or permission tiers. You can review existing access here.</p> : null}
    <details className="permissions-help"><summary>How access works — including non-academic staff</summary><p>Permission tiers combine capabilities. A higher display rank does not remove capabilities supplied by another tier. Staff category describes a person's job; it is not an access tier.</p><p>Use Staff details to set category and additional organisation scope. Leadership assignments in Organisation structure manage their own tiers and scope. College-wide report permissions can extend visibility beyond an assigned scope. Custom tiers do not assign leadership or academic status.</p><p>For support or professional services staff, select only the capabilities needed and keep their existing job category. QA form completion whitelists are managed separately in Form editor; they do not change report access.</p></details>
    <div className="toolbar" aria-label="Permission administration views"><Button disabled={busy || !canReadAccounts} onClick={async () => { if (await confirmUnsavedNavigation()) setView("people"); }} variant={view === "people" ? "primary" : "secondary"}>Staff access</Button><Button disabled={busy} onClick={async () => { if (await confirmUnsavedNavigation()) setView("tiers"); }} variant={view === "tiers" ? "primary" : "secondary"}>Permission tiers</Button></div>
    {error ? <div className="notice-row" role="alert">{error}</div> : null}{message ? <div className="notice-row" role="status">{message}</div> : null}
    {dirty ? <p role="status">Unsaved changes. Save or discard before switching views or people.</p> : null}
    {view === "people" ? <div className="permissions-workspace">
      <div><label className="admin-search-field"><Search size={16}/><input aria-label="Find staff account" value={search} onChange={event => setSearch(event.target.value)} placeholder="Name, job, category or faculty"/></label><div className="permissions-people" aria-label="Staff accounts">{matchingAccounts.map(account => <button type="button" className={selectedId === account.userAccountId ? "is-selected" : ""} disabled={busy} onClick={() => void chooseAccount(account)} key={account.userAccountId}><strong>{account.displayName}</strong><small>{account.jobTitle || account.email}</small><small>{account.primaryOrgCode || "No primary unit"}{account.isDisabled ? " · Sign-in disabled" : ""}</small></button>)}{!matchingAccounts.length ? <p>{busy ? "Loading staff accounts…" : "No matching accounts."}</p> : null}</div></div>
      {selected ? <div className="form-stack"><div><h3>{selected.displayName}</h3><p>{selected.jobTitle || "Job title not set"} · Category: {(selected.staffCategory || "Not set").replaceAll("_", " ")}</p><p>Current scope: {selected.scopes.map(scope => scope.orgUnitCode || scope.scopeType.replaceAll("_", " ")).join(", ") || "No additional organisation scope"}</p></div>
        <fieldset className="permissions-checkboxes"><legend>Permission tiers</legend>{roles.map(role => {
          const assignment = selected.roles.find(item => item.roleKey === role.roleKey);
          const locked = assignment?.isOrganisationManaged || (role.roleKey === "super_admin" && selected.userAccountId === user.userAccountId && !!assignment);
          return <label key={role.id}><input type="checkbox" checked={selectedRoles.includes(role.roleKey)} disabled={busy || !canAllocate || !!locked} onChange={() => setSelectedRoles(current => current.includes(role.roleKey) ? current.filter(key => key !== role.roleKey) : [...current, role.roleKey])}/><span><strong>{role.name}</strong><small>{assignment?.isOrganisationManaged ? "Managed through Organisation structure" : locked ? "Your administrator access is protected" : role.description || `${role.permissions.length} capabilities`}</small></span></label>;
        })}</fieldset>
        <div className="toolbar"><Button icon={Save} variant="primary" disabled={!rolesDirty || busy || !canAllocate || selectedRoles.length === 0} onClick={() => void saveAllocation()}>Save staff access</Button><Button disabled={!rolesDirty || busy} onClick={() => setSelectedRoles(selected.roles.map(role => role.roleKey))}>Discard</Button></div>{!selectedRoles.length ? <p role="alert">Keep at least one permission tier.</p> : null}
        <details><summary>Combined capabilities after saving ({effectivePermissions.length})</summary><CapabilityGroups permissions={effectivePermissions}/></details>
      </div> : <p>Select a person to review their access. No changes are made until you save.</p>}
    </div> : <div className="form-stack">
      <div className="toolbar"><Button icon={Plus} disabled={!canConstruct || busy || dirty} onClick={() => { setTier(newTier()); setTierBaseline(JSON.stringify(newTier())); setCapabilitySearch(""); }}>Create permission tier</Button></div>
      {tier ? <section className="permissions-tier-editor"><h3>{tier.id ? "Edit custom tier" : "Create permission tier"}</h3><p>Changes to an existing tier apply to everyone allocated to it. Only capabilities you hold can be granted. Mandatory CPD remains restricted to Teaching and Learning and administrators.</p><label className="entry-field"><span>Tier name</span><input maxLength={200} value={tier.name} onChange={event => { setTier({ ...tier, name: event.target.value });  }}/></label><label className="entry-field"><span>Who is this tier for?</span><textarea maxLength={1000} value={tier.description} onChange={event => { setTier({ ...tier, description: event.target.value });  }}/></label><label className="entry-field"><span>Find a capability</span><input value={capabilitySearch} onChange={event => setCapabilitySearch(event.target.value)}/></label><p>{tier.permissionKeys.length} capabilities selected. Scope remains controlled by each staff account.</p><CapabilityGroups permissions={catalogue.filter(permission => `${permission.name} ${permission.category} ${permission.permissionKey}`.toLowerCase().includes(capabilitySearch.toLowerCase()))} selectedKeys={tier.permissionKeys} onToggle={toggleCapability} disabled={busy}/>{tier.permissionKeys.some(key => !catalogue.some(permission => permission.permissionKey === key)) ? <p role="alert">This tier contains a capability you cannot grant. A suitably authorised administrator must edit it.</p> : null}<div className="toolbar"><Button icon={Save} variant="primary" disabled={busy || !tierDirty || !tier.name.trim() || !tier.permissionKeys.length || tier.permissionKeys.some(key => !catalogue.some(permission => permission.permissionKey === key))} onClick={() => void saveTier()}>Save tier</Button><Button disabled={busy} onClick={() => { setTier(null); setTierBaseline(""); }}>Discard</Button></div></section> : <div className="permissions-workspace"><div className="role-level-list">{roles.map(role => <button type="button" className={selectedRoleKey === role.roleKey ? "role-level-button role-level-button-active" : "role-level-button"} aria-pressed={selectedRoleKey === role.roleKey} key={role.id} onClick={() => setSelectedRoleKey(role.roleKey)}><strong>{role.name}</strong><small>{role.roleKey.startsWith("custom_") && !role.isSystem ? "Custom tier" : "System tier"} · {accounts.filter(account => account.roles.some(assignment => assignment.roleKey === role.roleKey)).length} people</small></button>)}</div>{selectedRole ? <section><h3>{selectedRole.name}</h3><p>{selectedRole.description}</p>{selectedRole.roleKey.startsWith("custom_") && !selectedRole.isSystem ? <Button disabled={busy || !canConstruct} onClick={() => void editTier(selectedRole)}>Edit capabilities</Button> : <p>System tier capabilities are maintained by the application. Create a custom tier for a different combination.</p>}<CapabilityGroups permissions={selectedRole.permissions}/></section> : null}</div>}
    </div>}
  </section>;
}

function CapabilityGroups({ permissions, selectedKeys, onToggle, disabled }: { permissions: PermissionSummary[]; selectedKeys?: string[]; onToggle?: (key: string) => void; disabled?: boolean }) {
  const categories = [...new Set(permissions.map(permission => permission.category || "Other"))].sort();
  return <div className="permissions-capabilities">{categories.map(category => <details key={category} open={!!onToggle}><summary>{category.replaceAll("_", " ")} · {permissions.filter(permission => (permission.category || "Other") === category).length}</summary><div className="permissions-checkboxes">{permissions.filter(permission => (permission.category || "Other") === category).map(permission => <label key={permission.permissionKey}>{onToggle ? <input type="checkbox" disabled={disabled} checked={selectedKeys?.includes(permission.permissionKey) ?? false} onChange={() => onToggle(permission.permissionKey)}/> : null}<span><strong>{permission.name}</strong><small>{permission.permissionKey}</small></span></label>)}</div></details>)}{!permissions.length ? <p>No capabilities to display.</p> : null}</div>;
}
