import { Building2, Check, Search, Trash2, UserRoundCog, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../design-system/Button";
import { api } from "../services/api";
import type { AdminOrganisationStaff, OrgUnitSummary } from "../services/types";

type RemovalTarget = {
  kind: "membership" | "manager";
  id: string;
  label: string;
};

export function OrganisationStructureAdmin() {
  const [people, setPeople] = useState<AdminOrganisationStaff[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnitSummary[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [membershipOrgUnitId, setMembershipOrgUnitId] = useState("");
  const [membershipType, setMembershipType] = useState("member");
  const [membershipPrimary, setMembershipPrimary] = useState(false);
  const [membershipFrom, setMembershipFrom] = useState("");
  const [membershipTo, setMembershipTo] = useState("");
  const [managerSearch, setManagerSearch] = useState("");
  const [managerStaffId, setManagerStaffId] = useState("");
  const [managerType, setManagerType] = useState("line_manager");
  const [managerPrimary, setManagerPrimary] = useState(true);
  const [removalTarget, setRemovalTarget] = useState<RemovalTarget | null>(null);
  const [removalReason, setRemovalReason] = useState("");

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh(nextMessage = "") {
    try {
      const [nextPeople, nextOrgUnits] = await Promise.all([api.adminOrganisationStaff(), api.orgUnits()]);
      setPeople(nextPeople);
      setOrgUnits(nextOrgUnits.filter((unit) => unit.isActive && unit.orgUnitType !== "college"));
      setSelectedStaffId((current) => nextPeople.some((person) => person.staffId === current)
        ? current
        : nextPeople[0]?.staffId ?? "");
      setMessage(nextMessage);
    } catch {
      setMessage("Organisation structure could not be loaded from the API.");
    }
  }

  const selectedPerson = people.find((person) => person.staffId === selectedStaffId) ?? null;
  const visiblePeople = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return people;
    return people.filter((person) => [
      person.displayName,
      person.externalId,
      person.email,
      person.effectivePermissionLevel,
      ...person.memberships.flatMap((membership) => [membership.code, membership.name, membership.parentCode ?? ""])
    ].some((value) => value.toLocaleLowerCase().includes(query)));
  }, [people, search]);
  const managerCandidates = useMemo(() => {
    const query = managerSearch.trim().toLocaleLowerCase();
    return people
      .filter((person) => person.staffId !== selectedStaffId)
      .filter((person) => !query || `${person.displayName} ${person.externalId} ${person.email}`.toLocaleLowerCase().includes(query))
      .slice(0, 30);
  }, [managerSearch, people, selectedStaffId]);

  async function addMembership() {
    if (!selectedPerson || !membershipOrgUnitId) {
      setMessage("Select a faculty or team to allocate.");
      return;
    }
    setIsSaving(true);
    const result = await api.saveOrganisationMembership(selectedPerson.staffId, {
      orgUnitId: membershipOrgUnitId,
      membershipType,
      isPrimary: membershipPrimary,
      activeFrom: membershipFrom || undefined,
      activeTo: membershipTo || undefined
    });
    setIsSaving(false);
    if (!result.ok) {
      setMessage(result.message ?? "The allocation could not be saved.");
      return;
    }
    setMembershipOrgUnitId("");
    setMembershipPrimary(false);
    setMembershipFrom("");
    setMembershipTo("");
    await refresh("Organisation allocation saved.");
  }

  async function setPrimary(membershipId: string) {
    if (!selectedPerson) return;
    setIsSaving(true);
    const result = await api.setPrimaryOrganisationMembership(selectedPerson.staffId, membershipId);
    setIsSaving(false);
    if (!result.ok) {
      setMessage(result.message ?? "The primary allocation could not be changed.");
      return;
    }
    await refresh("Primary allocation updated.");
  }

  async function addManager() {
    if (!selectedPerson || !managerStaffId) {
      setMessage("Select a manager.");
      return;
    }
    setIsSaving(true);
    const result = await api.saveManagerRelationship(selectedPerson.staffId, {
      managerStaffId,
      relationshipType: managerPrimary ? "line_manager" : managerType,
      isPrimary: managerPrimary
    });
    setIsSaving(false);
    if (!result.ok) {
      setMessage(result.message ?? "The manager relationship could not be saved.");
      return;
    }
    setManagerSearch("");
    setManagerStaffId("");
    await refresh("Manager relationship saved.");
  }

  async function confirmRemoval() {
    if (!selectedPerson || !removalTarget || !removalReason.trim()) return;
    setIsSaving(true);
    const result = removalTarget.kind === "membership"
      ? await api.archiveOrganisationMembership(selectedPerson.staffId, removalTarget.id, removalReason.trim())
      : await api.archiveManagerRelationship(selectedPerson.staffId, removalTarget.id, removalReason.trim());
    setIsSaving(false);
    if (!result.ok) {
      setMessage(result.message ?? "The relationship could not be removed.");
      return;
    }
    setRemovalTarget(null);
    setRemovalReason("");
    await refresh("Relationship removed and recorded in the audit history.");
  }

  const facultyCount = orgUnits.filter((unit) => unit.orgUnitType === "faculty").length;
  const teamCount = orgUnits.filter((unit) => unit.parentOrgUnitId).length;

  return (
    <section className="panel organisation-admin">
      <div className="panel-heading">
        <div>
          <h2>Organisation structure</h2>
          <span>College, faculty, team and reporting relationships</span>
        </div>
        <strong>{facultyCount} faculties / {teamCount} teams</strong>
      </div>

      {message ? <div className="notice-row" role="status">{message}</div> : null}

      <div className="organisation-admin-layout">
        <aside className="organisation-directory" aria-label="Staff directory">
          <div className="search-box">
            <Search size={16} />
            <input onChange={(event) => setSearch(event.target.value)} placeholder="Search staff or allocation" type="search" value={search} />
          </div>
          <div className="organisation-person-list">
            {visiblePeople.map((person) => (
              <button className={person.staffId === selectedStaffId ? "is-selected" : ""} key={person.staffId} onClick={() => setSelectedStaffId(person.staffId)} type="button">
                <strong>{person.displayName}</strong>
                <span>{person.externalId} / {person.effectivePermissionLevel}</span>
              </button>
            ))}
          </div>
        </aside>

        {selectedPerson ? (
          <div className="organisation-person-detail">
            <header className="organisation-person-heading">
              <div>
                <h3>{selectedPerson.displayName}</h3>
                <span>{selectedPerson.email}</span>
              </div>
              <div className="organisation-person-badges">
                <strong>{selectedPerson.effectivePermissionLevel}</strong>
                <span>{selectedPerson.accountStatus}</span>
              </div>
            </header>

            <div className="admin-detail-section">
              <div className="admin-detail-heading"><h3>Faculty and team allocations</h3><span>{selectedPerson.memberships.length} allocations</span></div>
              <div className="admin-allocation-list">
                {selectedPerson.memberships.map((membership) => (
                  <div className={`admin-allocation-row${membership.isActive ? "" : " is-inactive"}`} key={membership.id}>
                    <Building2 size={17} />
                    <div>
                      <strong>{membership.code} - {membership.name}</strong>
                      <span>{membership.parentName ? `${membership.parentCode} - ${membership.parentName} / ` : ""}{formatMembershipType(membership.membershipType)}</span>
                    </div>
                    <span>{membership.isPrimary ? "Primary" : membership.isActive ? "Active" : "Inactive"}</span>
                    <div className="admin-row-actions">
                      {!membership.isPrimary && membership.isActive ? <button className="icon-button" disabled={isSaving} onClick={() => void setPrimary(membership.id)} title="Set as primary" type="button"><Check size={16} /></button> : null}
                      <button className="icon-button" disabled={isSaving} onClick={() => setRemovalTarget({ kind: "membership", id: membership.id, label: `${membership.code} - ${membership.name}` })} title="Remove allocation" type="button"><Trash2 size={16} /></button>
                    </div>
                  </div>
                ))}
                {selectedPerson.memberships.length === 0 ? <div className="empty-row">No organisation allocations.</div> : null}
              </div>

              <div className="admin-inline-form">
                <label className="entry-field"><span>Faculty or team</span><select onChange={(event) => setMembershipOrgUnitId(event.target.value)} value={membershipOrgUnitId}><option value="">Select allocation</option>{orgUnits.map((unit) => <option key={unit.id} value={unit.id}>{formatOrgUnit(unit, orgUnits)}</option>)}</select></label>
                <label className="entry-field"><span>Allocation role</span><select onChange={(event) => setMembershipType(event.target.value)} value={membershipType}><option value="member">Member</option><option value="programme_leader">Programme Leader</option><option value="head_of_faculty">Head of Faculty</option><option value="director">Director</option><option value="support">Support</option></select></label>
                <label className="entry-field"><span>Start date</span><input onChange={(event) => setMembershipFrom(event.target.value)} type="date" value={membershipFrom} /></label>
                <label className="entry-field"><span>End date</span><input onChange={(event) => setMembershipTo(event.target.value)} type="date" value={membershipTo} /></label>
                <label className="toggle-row"><span>Primary allocation</span><input checked={membershipPrimary} onChange={(event) => setMembershipPrimary(event.target.checked)} type="checkbox" /></label>
                <Button disabled={isSaving || !membershipOrgUnitId} icon={Building2} onClick={() => void addMembership()} variant="primary">Add allocation</Button>
              </div>
            </div>

            <div className="admin-detail-section">
              <div className="admin-detail-heading"><h3>Management relationships</h3><span>Primary chain inherits upward</span></div>
              <div className="admin-manager-list">
                {selectedPerson.directManagers.map((manager) => (
                  <div className="admin-manager-row" key={manager.id}>
                    <UserRoundCog size={17} />
                    <div><strong>{manager.managerName}</strong><span>{manager.isPrimary ? "Primary line manager" : formatMembershipType(manager.relationshipType)}</span></div>
                    <button className="icon-button" disabled={isSaving} onClick={() => setRemovalTarget({ kind: "manager", id: manager.id, label: manager.managerName })} title="Remove manager" type="button"><Trash2 size={16} /></button>
                  </div>
                ))}
                {selectedPerson.directManagers.length === 0 ? <div className="empty-row">No direct manager assigned.</div> : null}
              </div>

              <div className="reporting-chain">
                <span>Inherited reporting line</span>
                {selectedPerson.reportingLine.map((manager) => <strong key={`${manager.level}-${manager.managerStaffId}`}>{manager.level}. {manager.managerName} ({manager.effectivePermissionLevel})</strong>)}
                {selectedPerson.reportingLine.length === 0 ? <em>No inherited managers.</em> : null}
              </div>

              <div className="admin-inline-form">
                <label className="entry-field"><span>Find manager</span><input onChange={(event) => { setManagerSearch(event.target.value); setManagerStaffId(""); }} placeholder="Type a name or staff ID" value={managerSearch} /></label>
                <label className="entry-field"><span>Manager</span><select onChange={(event) => setManagerStaffId(event.target.value)} value={managerStaffId}><option value="">Select manager</option>{managerCandidates.map((person) => <option key={person.staffId} value={person.staffId}>{person.displayName} ({person.externalId})</option>)}</select></label>
                <label className="entry-field"><span>Relationship</span><select disabled={managerPrimary} onChange={(event) => setManagerType(event.target.value)} value={managerPrimary ? "line_manager" : managerType}><option value="line_manager">Line manager</option><option value="secondary">Secondary manager</option><option value="functional">Functional manager</option></select></label>
                <label className="toggle-row"><span>Primary relationship</span><input checked={managerPrimary} onChange={(event) => setManagerPrimary(event.target.checked)} type="checkbox" /></label>
                <Button disabled={isSaving || !managerStaffId} icon={UserRoundCog} onClick={() => void addManager()} variant="primary">Assign manager</Button>
              </div>
            </div>
          </div>
        ) : <div className="empty-row">Select a staff member.</div>}
      </div>

      {removalTarget ? (
        <div className="admin-reason-dialog" role="dialog" aria-modal="true" aria-label="Removal reason">
          <div>
            <div className="panel-heading"><h2>Remove {removalTarget.label}</h2><button className="icon-button" onClick={() => setRemovalTarget(null)} title="Close" type="button"><X size={16} /></button></div>
            <label className="entry-field"><span>Reason <strong>Required</strong></span><textarea autoFocus onChange={(event) => setRemovalReason(event.target.value)} rows={4} value={removalReason} /></label>
            <div className="toolbar"><Button icon={X} onClick={() => setRemovalTarget(null)}>Cancel</Button><Button disabled={isSaving || !removalReason.trim()} icon={Trash2} onClick={() => void confirmRemoval()} variant="primary">Remove</Button></div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function formatMembershipType(value: string) {
  return value.split("_").map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(" ");
}

function formatOrgUnit(unit: OrgUnitSummary, units: OrgUnitSummary[]) {
  const parent = units.find((candidate) => candidate.id === unit.parentOrgUnitId);
  return parent ? `${parent.code} / ${unit.code} - ${unit.name}` : `${unit.code} - ${unit.name}`;
}
