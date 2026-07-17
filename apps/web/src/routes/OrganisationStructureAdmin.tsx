import {
  Building2,
  ChevronRight,
  Edit3,
  Plus,
  Power,
  Save as SaveIcon,
  Search,
  ShieldCheck,
  Trash2,
  UserPlus,
  UserRoundCog,
  Users,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../design-system/Button";
import { api } from "../services/api";
import type {
  AdminOrganisationStaffOption,
  AdminOrganisationStaff,
  AdminOrganisationStructure,
  AdminOrganisationUnit,
  MembershipChangeImpact,
  OrganisationChangeImpact,
  OrganisationMigrationReview,
  SaveOrganisationUnitRequest
} from "../services/types";

type PendingManagerChange = {
  kind: "change" | "remove";
  manager?: AdminOrganisationStaffOption;
};

type UnitEditor = SaveOrganisationUnitRequest & { id?: string };
type PendingUnitStatus = { unit: AdminOrganisationUnit; impact: OrganisationChangeImpact; reason: string };
type PendingMembershipRemoval = { staff: AdminOrganisationStaff; membershipId: string; impact: MembershipChangeImpact; reason: string };

export function OrganisationStructureAdmin() {
  const [workspace, setWorkspace] = useState<AdminOrganisationStructure | null>(null);
  const [staffDetails, setStaffDetails] = useState<AdminOrganisationStaff[]>([]);
  const [selectedUnitId, setSelectedUnitId] = useState("");
  const [unitSearch, setUnitSearch] = useState("");
  const [managerSearch, setManagerSearch] = useState("");
  const [selectedManagerId, setSelectedManagerId] = useState("");
  const [pendingChange, setPendingChange] = useState<PendingManagerChange | null>(null);
  const [changeReason, setChangeReason] = useState("");
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isAddingStaff, setIsAddingStaff] = useState(false);
  const [staffSearch, setStaffSearch] = useState("");
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [makePrimary, setMakePrimary] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [unitEditor, setUnitEditor] = useState<UnitEditor | null>(null);
  const [pendingUnitStatus, setPendingUnitStatus] = useState<PendingUnitStatus | null>(null);
  const [pendingMembershipRemoval, setPendingMembershipRemoval] = useState<PendingMembershipRemoval | null>(null);
  const [migrationReviews, setMigrationReviews] = useState<OrganisationMigrationReview[]>([]);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh(nextMessage = "") {
    try {
      const [nextWorkspace, nextStaffDetails, nextMigrationReviews] = await Promise.all([
        api.adminOrganisationStructure(),
        api.adminOrganisationStaff(),
        api.organisationMigrationReviews()
      ]);
      setWorkspace(nextWorkspace);
      setStaffDetails(nextStaffDetails);
      setMigrationReviews(nextMigrationReviews);
      setSelectedUnitId((current) => nextWorkspace.units.some((unit) => unit.id === current)
        ? current
        : nextWorkspace.units.find((unit) => unit.orgUnitType === "faculty")?.id ?? nextWorkspace.units[0]?.id ?? "");
      setMessage(nextMessage);
    } catch {
      setMessage("Organisation structure could not be loaded from the API.");
    }
  }

  const units = workspace?.units ?? [];
  const staff = workspace?.staff ?? [];
  const selectedUnit = units.find((unit) => unit.id === selectedUnitId) ?? null;
  const faculties = useMemo(
    () => units.filter((unit) => unit.orgUnitType === "faculty" && (showInactive || unit.isActive)),
    [showInactive, units]
  );
  const teamsByFaculty = useMemo(() => {
    const result = new Map<string, AdminOrganisationUnit[]>();
    units.filter((unit) => unit.orgUnitType === "team" && (showInactive || unit.isActive)).forEach((team) => {
      if (!team.parentOrgUnitId) return;
      result.set(team.parentOrgUnitId, [...(result.get(team.parentOrgUnitId) ?? []), team]);
    });
    result.forEach((teams) => teams.sort((left, right) => left.code.localeCompare(right.code)));
    return result;
  }, [showInactive, units]);

  const visibleFaculties = useMemo(() => {
    const query = unitSearch.trim().toLocaleLowerCase();
    if (!query) return faculties;
    return faculties.filter((faculty) => {
      const teams = teamsByFaculty.get(faculty.id) ?? [];
      return unitMatches(faculty, query) || teams.some((team) => unitMatches(team, query));
    });
  }, [faculties, teamsByFaculty, unitSearch]);

  const managerCandidates = useMemo(() => {
    if (selectedManagerId) return [];
    const query = managerSearch.trim().toLocaleLowerCase();
    if (!query) return [];
    return staff
      .filter((person) => person.staffId !== selectedUnit?.manager?.staffId)
      .filter((person) => [
        person.displayName,
        person.externalId,
        person.email,
        person.primaryOrgCode ?? ""
      ].some((value) => value.toLocaleLowerCase().includes(query)))
      .slice(0, 8);
  }, [managerSearch, selectedManagerId, selectedUnit?.manager?.staffId, staff]);

  const selectedManager = staff.find((person) => person.staffId === selectedManagerId) ?? null;
  const managedUnitCount = units.filter((unit) => unit.manager).length;
  const selectedUnitMembers = useMemo(() => {
    if (!selectedUnit) return [];
    return staffDetails
      .filter((person) => person.memberships.some((membership) => membership.orgUnitId === selectedUnit.id && membership.isActive))
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  }, [selectedUnit, staffDetails]);
  const staffCandidates = useMemo(() => {
    if (!selectedUnit || selectedUnit.orgUnitType !== "team" || selectedStaffId) return [];
    const query = staffSearch.trim().toLocaleLowerCase();
    if (!query) return [];
    const allocatedIds = new Set(selectedUnitMembers.map((person) => person.staffId));
    return staffDetails
      .filter((person) => !allocatedIds.has(person.staffId) && person.accountStatus === "active")
      .filter((person) => [person.displayName, person.externalId, person.email]
        .some((value) => value.toLocaleLowerCase().includes(query)))
      .slice(0, 8);
  }, [selectedStaffId, selectedUnit, selectedUnitMembers, staffDetails, staffSearch]);
  const selectedStaff = staffDetails.find((person) => person.staffId === selectedStaffId) ?? null;
  const awaitingLeaders = useMemo(() => {
    const facultyManagers = new Set(units.filter((unit) => unit.orgUnitType === "faculty" && unit.manager).map((unit) => unit.manager!.staffId));
    const teamManagers = new Set(units.filter((unit) => unit.orgUnitType === "team" && unit.manager).map((unit) => unit.manager!.staffId));
    return staffDetails.flatMap((person) => {
      if ((person.staffCategory === "head_of_faculty_sector_manager" || person.roleNames.includes("Head of Faculty"))
          && !facultyManagers.has(person.staffId)) {
        return [{ person, roleName: "Head of Faculty / Sector Manager" }];
      }
      if ((person.staffCategory === "programme_leader" || person.roleNames.includes("Programme Leader"))
          && !teamManagers.has(person.staffId)) {
        return [{ person, roleName: "Programme Leader" }];
      }
      return [];
    });
  }, [staffDetails, units]);

  function selectUnit(unitId: string) {
    setSelectedUnitId(unitId);
    setManagerSearch("");
    setSelectedManagerId("");
    setIsAddingStaff(false);
    setStaffSearch("");
    setSelectedStaffId("");
    setMakePrimary(false);
    setMessage("");
  }

  async function addStaffToTeam() {
    if (!selectedUnit || selectedUnit.orgUnitType !== "team" || !selectedStaff) return;
    setIsSaving(true);
    const result = await api.saveOrganisationMembership(selectedStaff.staffId, {
      orgUnitId: selectedUnit.id,
      membershipType: "member",
      isPrimary: makePrimary
    });
    setIsSaving(false);
    if (!result.ok) {
      setMessage(result.message ?? "The staff allocation could not be saved.");
      return;
    }
    setIsAddingStaff(false);
    setStaffSearch("");
    setSelectedStaffId("");
    setMakePrimary(false);
    await refresh(`${selectedStaff.displayName} added to ${selectedUnit.code}.`);
  }

  function prepareLeaderAssignment(person: AdminOrganisationStaff) {
    setManagerSearch(person.displayName);
    setSelectedManagerId(person.staffId);
    setMessage("Select the correct faculty or team, then confirm the manager assignment.");
  }

  async function assignInitialManager() {
    if (!selectedUnit || !selectedManager) return;
    setIsSaving(true);
    const result = await api.saveOrgUnitManager(selectedUnit.id, { managerStaffId: selectedManager.staffId });
    setIsSaving(false);
    if (!result.ok) {
      setMessage(result.message ?? "The manager could not be assigned.");
      return;
    }
    setManagerSearch("");
    setSelectedManagerId("");
    await refresh(`${managerLabel(selectedUnit)} assigned to ${selectedManager.displayName}.`);
  }

  async function confirmChange() {
    if (!selectedUnit || !pendingChange || !changeReason.trim()) return;
    setIsSaving(true);
    const result = pendingChange.kind === "remove"
      ? await api.archiveOrgUnitManager(selectedUnit.id, changeReason.trim())
      : await api.saveOrgUnitManager(selectedUnit.id, {
          managerStaffId: pendingChange.manager!.staffId,
          reason: changeReason.trim()
        });
    setIsSaving(false);
    if (!result.ok) {
      setMessage(result.message ?? "The manager assignment could not be updated.");
      return;
    }

    const nextMessage = pendingChange.kind === "remove"
      ? `${managerLabel(selectedUnit)} removed from ${selectedUnit.code}.`
      : `${managerLabel(selectedUnit)} changed to ${pendingChange.manager!.displayName}.`;
    setPendingChange(null);
    setChangeReason("");
    setManagerSearch("");
    setSelectedManagerId("");
    await refresh(nextMessage);
  }

  function requestAssignment() {
    if (!selectedUnit || !selectedManager) return;
    if (!selectedUnit.manager) {
      void assignInitialManager();
      return;
    }
    setPendingChange({ kind: "change", manager: selectedManager });
    setChangeReason("");
  }

  function openNewUnit(orgUnitType: "faculty" | "team") {
    const parentOrgUnitId = orgUnitType === "team"
      ? selectedUnit?.orgUnitType === "faculty"
        ? selectedUnit.id
        : selectedUnit?.parentOrgUnitId
      : undefined;
    setUnitEditor({ orgUnitType, code: "", name: "", description: "", parentOrgUnitId });
  }

  function openEditUnit(unit: AdminOrganisationUnit) {
    setUnitEditor({
      id: unit.id,
      orgUnitType: unit.orgUnitType,
      code: unit.code,
      name: unit.name,
      description: unit.description ?? "",
      parentOrgUnitId: unit.parentOrgUnitId
    });
  }

  async function saveUnit() {
    if (!unitEditor || !unitEditor.code.trim() || !unitEditor.name.trim()) return;
    setIsSaving(true);
    const request: SaveOrganisationUnitRequest = {
      orgUnitType: unitEditor.orgUnitType,
      code: unitEditor.code.trim().toUpperCase(),
      name: unitEditor.name.trim(),
      description: unitEditor.description?.trim() || undefined,
      parentOrgUnitId: unitEditor.orgUnitType === "team" ? unitEditor.parentOrgUnitId : undefined
    };
    const result = unitEditor.id
      ? await api.updateOrganisationUnit(unitEditor.id, request)
      : await api.createOrganisationUnit(request);
    setIsSaving(false);
    if (!result.ok) {
      setMessage(result.message ?? "The organisation unit could not be saved.");
      return;
    }
    const savedId = unitEditor.id ?? result.data?.id;
    setUnitEditor(null);
    await refresh(`${request.code} saved.`);
    if (savedId) setSelectedUnitId(savedId);
  }

  async function requestUnitStatusChange(unit: AdminOrganisationUnit) {
    setIsSaving(true);
    try {
      const impact = await api.organisationUnitImpact(unit.id);
      setPendingUnitStatus({ unit, impact, reason: "" });
    } catch {
      setMessage("The organisation change impact could not be loaded.");
    } finally {
      setIsSaving(false);
    }
  }

  async function confirmUnitStatusChange() {
    if (!pendingUnitStatus?.reason.trim()) return;
    setIsSaving(true);
    const nextStatus = !pendingUnitStatus.unit.isActive;
    const result = await api.setOrganisationUnitStatus(
      pendingUnitStatus.unit.id,
      nextStatus,
      pendingUnitStatus.reason.trim(),
      true
    );
    setIsSaving(false);
    if (!result.ok) {
      setMessage(result.message ?? "The organisation status could not be changed.");
      return;
    }
    const code = pendingUnitStatus.unit.code;
    setPendingUnitStatus(null);
    await refresh(`${code} ${nextStatus ? "activated" : "deactivated"}.`);
  }

  async function requestMembershipRemoval(person: AdminOrganisationStaff, membershipId: string) {
    setIsSaving(true);
    try {
      const impact = await api.organisationMembershipImpact(person.staffId, membershipId);
      setPendingMembershipRemoval({ staff: person, membershipId, impact, reason: "" });
    } catch {
      setMessage("The membership impact could not be loaded.");
    } finally {
      setIsSaving(false);
    }
  }

  async function confirmMembershipRemoval() {
    if (!pendingMembershipRemoval?.reason.trim()) return;
    setIsSaving(true);
    const result = await api.archiveOrganisationMembership(
      pendingMembershipRemoval.staff.staffId,
      pendingMembershipRemoval.membershipId,
      pendingMembershipRemoval.reason.trim()
    );
    setIsSaving(false);
    if (!result.ok) {
      setMessage(result.message ?? "The staff allocation could not be removed.");
      return;
    }
    const name = pendingMembershipRemoval.staff.displayName;
    setPendingMembershipRemoval(null);
    await refresh(`${name}'s allocation was removed.`);
  }

  return (
    <section className="panel organisation-unit-admin">
      <div className="panel-heading">
        <div>
          <h2>Organisation structure</h2>
          <span>Faculty and team management</span>
        </div>
        <div className="toolbar">
          <Button icon={Plus} onClick={() => openNewUnit("faculty")}>Add faculty</Button>
          <Button icon={Plus} onClick={() => openNewUnit("team")}>Add team</Button>
        </div>
      </div>

      {message ? <div className="notice-row" role="status">{message}</div> : null}

      {awaitingLeaders.length > 0 ? (
        <div className="organisation-leader-queue">
          <div>
            <strong>Leaders awaiting managed unit</strong>
            <span>{awaitingLeaders.length} self-declared {awaitingLeaders.length === 1 ? "leader needs" : "leaders need"} an Admin allocation.</span>
          </div>
          <div className="organisation-leader-list">
            {awaitingLeaders.map(({ person, roleName }) => (
              <button key={`${person.staffId}-${roleName}`} onClick={() => prepareLeaderAssignment(person)} type="button">
                <UserRoundCog aria-hidden="true" size={16} />
                <span><strong>{person.displayName}</strong><small>{roleName}</small></span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="organisation-unit-layout">
        <aside className="organisation-unit-directory" aria-label="Faculties and teams">
          <label className="admin-search-field">
            <Search aria-hidden="true" size={16} />
            <input
              aria-label="Search faculties and teams"
              onChange={(event) => setUnitSearch(event.target.value)}
              placeholder="Search faculty, team or manager"
              type="search"
              value={unitSearch}
            />
          </label>
          <label className="organisation-primary-toggle">
            <input checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} type="checkbox" />
            <span>Show inactive</span>
          </label>

          <div className="organisation-faculty-list">
            {visibleFaculties.map((faculty) => {
              const teams = teamsByFaculty.get(faculty.id) ?? [];
              const query = unitSearch.trim().toLocaleLowerCase();
              const visibleTeams = query ? teams.filter((team) => unitMatches(team, query)) : teams;
              return (
                <div className="organisation-faculty-group" key={faculty.id}>
                  <UnitButton isSelected={faculty.id === selectedUnitId} onClick={() => selectUnit(faculty.id)} unit={faculty} />
                  <div className="organisation-team-list">
                    {(visibleTeams.length > 0 || !query ? visibleTeams : teams).map((team) => (
                      <UnitButton isSelected={team.id === selectedUnitId} key={team.id} onClick={() => selectUnit(team.id)} unit={team} />
                    ))}
                  </div>
                </div>
              );
            })}
            {visibleFaculties.length === 0 ? <div className="empty-row">No faculties or teams match this search.</div> : null}
          </div>
        </aside>

        {selectedUnit ? (
          <div className="organisation-unit-detail">
            <header className="organisation-unit-heading">
              <div>
                <span className="eyebrow">{selectedUnit.orgUnitType === "faculty" ? "Faculty" : "Team"}</span>
                <h3>{selectedUnit.code} - {selectedUnit.name}</h3>
                {selectedUnit.alignedFacultyCodes.length > 0 ? <span>Service coverage: {selectedUnit.alignedFacultyCodes.join(", ")}</span> : null}
                {selectedUnit.legacyCodes.length > 0 ? <span>Previous code: {selectedUnit.legacyCodes.join(", ")}</span> : null}
              </div>
              <div className="toolbar">
                <span className={`status-chip ${selectedUnit.isActive ? "status-chip-active" : "status-chip-muted"}`}>
                  {selectedUnit.isActive ? "Active" : "Inactive"}
                </span>
                <button className="icon-button" onClick={() => openEditUnit(selectedUnit)} title="Edit organisation unit" type="button">
                  <Edit3 aria-hidden="true" size={16} />
                </button>
                <button className="icon-button" disabled={isSaving} onClick={() => void requestUnitStatusChange(selectedUnit)} title={selectedUnit.isActive ? "Deactivate organisation unit" : "Activate organisation unit"} type="button">
                  <Power aria-hidden="true" size={16} />
                </button>
              </div>
            </header>

            <div className="organisation-unit-metrics" aria-label="Organisation coverage">
              <Metric label="Staff in scope" value={selectedUnit.totalStaffCount} />
              <Metric label="Direct allocations" value={selectedUnit.directStaffCount} />
              {selectedUnit.orgUnitType === "faculty" ? (
                <Metric label="Managed teams" value={`${selectedUnit.managedTeamCount}/${selectedUnit.childTeamCount}`} />
              ) : (
                <Metric label="Faculty manager" value={selectedUnit.parentManager?.displayName ?? "Unassigned"} />
              )}
              <Metric label="Permission level" value={selectedUnit.orgUnitType === "faculty" ? "Head of Faculty" : "Programme Leader"} />
            </div>

            <div className="organisation-manager-section">
              <div className="admin-detail-heading">
                <h3>{managerLabel(selectedUnit)}</h3>
                <span>{selectedUnit.orgUnitType === "faculty" ? "Faculty scope" : "Team scope"}</span>
              </div>

              {selectedUnit.manager ? (
                <div className="organisation-current-manager">
                  <UserRoundCog aria-hidden="true" size={20} />
                  <div>
                    <strong>{selectedUnit.manager.displayName}</strong>
                    <span>{selectedUnit.manager.externalId} / {selectedUnit.manager.email}</span>
                  </div>
                  <span>{selectedUnit.manager.permissionLevel}</span>
                  <button
                    className="icon-button"
                    disabled={isSaving}
                    onClick={() => { setPendingChange({ kind: "remove" }); setChangeReason(""); }}
                    title={`Remove ${managerLabel(selectedUnit)}`}
                    type="button"
                  >
                    <Trash2 aria-hidden="true" size={16} />
                  </button>
                </div>
              ) : <div className="empty-row">No manager is assigned to this {selectedUnit.orgUnitType}.</div>}

              <div className="organisation-reporting-rule">
                <ShieldCheck aria-hidden="true" size={18} />
                <div>
                  <strong>{selectedUnit.orgUnitType === "faculty" ? "Faculty reporting line" : "Team reporting line"}</strong>
                  <span>
                    {selectedUnit.orgUnitType === "faculty"
                      ? `${selectedUnit.managedTeamCount} team managers report to this role.`
                      : selectedUnit.parentManager
                        ? `The team manager reports to ${selectedUnit.parentManager.displayName}.`
                        : "Assign the faculty manager to complete the reporting line."}
                  </span>
                </div>
              </div>
            </div>

            <div className="organisation-manager-assignment">
              <div className="admin-detail-heading">
                <h3>{selectedUnit.manager ? "Change manager" : "Assign manager"}</h3>
                <span>{selectedUnit.totalStaffCount} staff records covered by this role</span>
              </div>
              <label className="entry-field">
                <span>Staff search</span>
                <div className="staff-combobox">
                  <Search aria-hidden="true" size={17} />
                  <input
                    aria-autocomplete="list"
                    aria-controls="organisation-manager-candidates"
                    aria-expanded={managerCandidates.length > 0}
                    onChange={(event) => { setManagerSearch(event.target.value); setSelectedManagerId(""); }}
                    placeholder="Type a name, AD number or email"
                    role="combobox"
                    value={managerSearch}
                  />
                </div>
              </label>
              {managerCandidates.length > 0 ? (
                <div className="staff-search-results organisation-manager-candidates" id="organisation-manager-candidates" role="listbox">
                  {managerCandidates.map((person) => (
                    <button
                      key={person.staffId}
                      onClick={() => { setSelectedManagerId(person.staffId); setManagerSearch(person.displayName); }}
                      role="option"
                      type="button"
                    >
                      <span><strong>{person.displayName}</strong><small>{person.externalId} / {person.email}</small></span>
                      <span>{person.effectivePermissionLevel}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              {selectedManager ? (
                <div className="organisation-selected-manager">
                  <UserRoundCog aria-hidden="true" size={18} />
                  <div><strong>{selectedManager.displayName}</strong><span>{selectedManager.externalId} / {selectedManager.primaryOrgCode ?? "No primary team"}</span></div>
                  <Button disabled={isSaving} icon={ShieldCheck} onClick={requestAssignment} variant="primary">
                    {selectedUnit.manager ? "Change manager" : "Assign manager"}
                  </Button>
                </div>
              ) : null}
            </div>

            {selectedUnit.orgUnitType === "team" ? (
              <div className="organisation-team-members">
                <div className="admin-detail-heading">
                  <div><h3>Team members</h3><span>{selectedUnitMembers.length} direct allocations</span></div>
                  <Button icon={UserPlus} onClick={() => setIsAddingStaff((current) => !current)}>
                    {isAddingStaff ? "Close" : "Add staff"}
                  </Button>
                </div>

                {isAddingStaff ? (
                  <div className="organisation-member-assignment">
                    <label className="entry-field">
                      <span>Staff search</span>
                      <div className="staff-combobox">
                        <Search aria-hidden="true" size={17} />
                        <input
                          aria-autocomplete="list"
                          aria-controls="organisation-member-candidates"
                          aria-expanded={staffCandidates.length > 0}
                          onChange={(event) => { setStaffSearch(event.target.value); setSelectedStaffId(""); }}
                          placeholder="Type a name, AD number or email"
                          role="combobox"
                          value={staffSearch}
                        />
                      </div>
                    </label>
                    {staffCandidates.length > 0 ? (
                      <div className="staff-search-results organisation-manager-candidates" id="organisation-member-candidates" role="listbox">
                        {staffCandidates.map((person) => (
                          <button
                            key={person.staffId}
                            onClick={() => { setSelectedStaffId(person.staffId); setStaffSearch(person.displayName); }}
                            role="option"
                            type="button"
                          >
                            <span><strong>{person.displayName}</strong><small>{person.externalId} / {person.email}</small></span>
                            <span>{person.effectivePermissionLevel}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {selectedStaff ? (
                      <div className="organisation-selected-manager">
                        <UserPlus aria-hidden="true" size={18} />
                        <div><strong>{selectedStaff.displayName}</strong><span>{selectedStaff.externalId} / {selectedStaff.email}</span></div>
                        <label className="organisation-primary-toggle">
                          <input checked={makePrimary} onChange={(event) => setMakePrimary(event.target.checked)} type="checkbox" />
                          <span>Primary team</span>
                        </label>
                        <Button disabled={isSaving} icon={UserPlus} onClick={() => void addStaffToTeam()} variant="primary">Add to team</Button>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="organisation-member-list">
                  {selectedUnitMembers.map((person) => {
                    const membership = person.memberships.find((item) => item.orgUnitId === selectedUnit.id && item.isActive);
                    return (
                    <div key={person.staffId}>
                      <span><strong>{person.displayName}</strong><small>{person.externalId} / {person.email}</small></span>
                      <span>{membership?.isPrimary ? "Primary" : "Additional"}</span>
                      {membership ? (
                        <button className="icon-button" disabled={isSaving} onClick={() => void requestMembershipRemoval(person, membership.id)} title="Remove team allocation" type="button">
                          <Trash2 aria-hidden="true" size={15} />
                        </button>
                      ) : null}
                    </div>
                    );
                  })}
                  {selectedUnitMembers.length === 0 ? <div className="empty-row">No staff are directly allocated to this team.</div> : null}
                </div>
              </div>
            ) : null}
          </div>
        ) : <div className="empty-row">Select a faculty or team.</div>}
      </div>

      {migrationReviews.some((review) => review.status === "open") ? (
        <details className="organisation-migration-review">
          <summary>
            <strong>Migration review</strong>
            <span>{migrationReviews.filter((review) => review.status === "open").length} staff allocations need confirmation</span>
          </summary>
          <div className="organisation-member-list">
            {migrationReviews.filter((review) => review.status === "open").map((review) => (
              <div key={review.id}>
                <span><strong>{review.staffName ?? review.sourceCode ?? "Unmatched record"}</strong><small>{review.details}</small></span>
                <span>{review.proposedCode ?? "Review"}</span>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {unitEditor ? (
        <div className="admin-reason-dialog" role="dialog" aria-modal="true" aria-label={unitEditor.id ? "Edit organisation unit" : "Add organisation unit"}>
          <div>
            <div className="panel-heading">
              <div><h2>{unitEditor.id ? "Edit" : "Add"} {unitEditor.orgUnitType}</h2><span>Organisation structure</span></div>
              <button className="icon-button" onClick={() => setUnitEditor(null)} title="Close" type="button"><X size={16} /></button>
            </div>
            <div className="responsive-form-grid">
              <label className="entry-field"><span>Code <strong>Required</strong></span><input maxLength={50} onChange={(event) => setUnitEditor({ ...unitEditor, code: event.target.value.toUpperCase() })} value={unitEditor.code} /></label>
              <label className="entry-field"><span>Name <strong>Required</strong></span><input maxLength={250} onChange={(event) => setUnitEditor({ ...unitEditor, name: event.target.value })} value={unitEditor.name} /></label>
              {unitEditor.orgUnitType === "team" ? (
                <label className="entry-field"><span>Faculty <strong>Required</strong></span><select onChange={(event) => setUnitEditor({ ...unitEditor, parentOrgUnitId: event.target.value })} value={unitEditor.parentOrgUnitId ?? ""}><option value="">Select faculty</option>{units.filter((unit) => unit.orgUnitType === "faculty" && unit.isActive).map((faculty) => <option key={faculty.id} value={faculty.id}>{faculty.code} - {faculty.name}</option>)}</select></label>
              ) : null}
            </div>
            <label className="entry-field"><span>Description</span><textarea onChange={(event) => setUnitEditor({ ...unitEditor, description: event.target.value })} rows={3} value={unitEditor.description ?? ""} /></label>
            <div className="toolbar"><Button icon={X} onClick={() => setUnitEditor(null)}>Cancel</Button><Button disabled={isSaving || !unitEditor.code.trim() || !unitEditor.name.trim() || (unitEditor.orgUnitType === "team" && !unitEditor.parentOrgUnitId)} icon={SaveIcon} onClick={() => void saveUnit()} variant="primary">Save</Button></div>
          </div>
        </div>
      ) : null}

      {pendingUnitStatus ? (
        <div className="admin-reason-dialog" role="dialog" aria-modal="true" aria-label={`${pendingUnitStatus.unit.isActive ? "Deactivate" : "Activate"} organisation unit`}>
          <div>
            <div className="panel-heading"><div><h2>{pendingUnitStatus.unit.isActive ? "Deactivate" : "Activate"} {pendingUnitStatus.unit.code}</h2><span>Review impact before confirming</span></div><button className="icon-button" onClick={() => setPendingUnitStatus(null)} title="Close" type="button"><X size={16} /></button></div>
            <ImpactSummary impact={pendingUnitStatus.impact} />
            <label className="entry-field"><span>Reason <strong>Required</strong></span><textarea autoFocus onChange={(event) => setPendingUnitStatus({ ...pendingUnitStatus, reason: event.target.value })} rows={3} value={pendingUnitStatus.reason} /></label>
            <div className="toolbar"><Button icon={X} onClick={() => setPendingUnitStatus(null)}>Cancel</Button><Button disabled={isSaving || !pendingUnitStatus.reason.trim()} icon={Power} onClick={() => void confirmUnitStatusChange()} variant="primary">Confirm status change</Button></div>
          </div>
        </div>
      ) : null}

      {pendingMembershipRemoval ? (
        <div className="admin-reason-dialog" role="dialog" aria-modal="true" aria-label="Remove staff allocation">
          <div>
            <div className="panel-heading"><div><h2>Remove {pendingMembershipRemoval.impact.orgUnitCode} allocation</h2><span>{pendingMembershipRemoval.staff.displayName}</span></div><button className="icon-button" onClick={() => setPendingMembershipRemoval(null)} title="Close" type="button"><X size={16} /></button></div>
            <MembershipImpactSummary impact={pendingMembershipRemoval.impact} />
            <label className="entry-field"><span>Reason <strong>Required</strong></span><textarea autoFocus onChange={(event) => setPendingMembershipRemoval({ ...pendingMembershipRemoval, reason: event.target.value })} rows={3} value={pendingMembershipRemoval.reason} /></label>
            <div className="toolbar"><Button icon={X} onClick={() => setPendingMembershipRemoval(null)}>Cancel</Button><Button disabled={isSaving || !pendingMembershipRemoval.reason.trim()} icon={Trash2} onClick={() => void confirmMembershipRemoval()} variant="primary">Remove allocation</Button></div>
          </div>
        </div>
      ) : null}

      {pendingChange && selectedUnit ? (
        <div className="admin-reason-dialog" role="dialog" aria-modal="true" aria-label={pendingChange.kind === "remove" ? "Remove manager" : "Change manager"}>
          <div>
            <div className="panel-heading">
              <div>
                <h2>{pendingChange.kind === "remove" ? `Remove ${managerLabel(selectedUnit)}` : `Change ${managerLabel(selectedUnit)}`}</h2>
                <span>{selectedUnit.code} - {selectedUnit.name}</span>
              </div>
              <button className="icon-button" onClick={() => setPendingChange(null)} title="Close" type="button"><X size={16} /></button>
            </div>
            <label className="entry-field">
              <span>Reason <strong>Required</strong></span>
              <textarea autoFocus onChange={(event) => setChangeReason(event.target.value)} rows={4} value={changeReason} />
            </label>
            <div className="toolbar">
              <Button icon={X} onClick={() => setPendingChange(null)}>Cancel</Button>
              <Button disabled={isSaving || !changeReason.trim()} icon={pendingChange.kind === "remove" ? Trash2 : ShieldCheck} onClick={() => void confirmChange()} variant="primary">
                {pendingChange.kind === "remove" ? "Remove manager" : "Confirm change"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function UnitButton({ unit, isSelected, onClick }: { unit: AdminOrganisationUnit; isSelected: boolean; onClick: () => void }) {
  const Icon = unit.orgUnitType === "faculty" ? Building2 : Users;
  return (
    <button className={`organisation-unit-button${isSelected ? " is-selected" : ""}${unit.isActive ? "" : " is-inactive"}`} onClick={onClick} type="button">
      <Icon aria-hidden="true" size={17} />
      <span><strong>{unit.code}</strong><small>{unit.name}</small></span>
      <span className={unit.manager && unit.isActive ? "unit-manager-name" : "unit-manager-name is-unassigned"}>{unit.isActive ? unit.manager?.displayName ?? "Unassigned" : "Inactive"}</span>
      <ChevronRight aria-hidden="true" size={16} />
    </button>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function ImpactSummary({ impact }: { impact: OrganisationChangeImpact }) {
  return <div className="organisation-unit-metrics"><Metric label="Active staff" value={impact.activeMemberships} /><Metric label="Permission scopes" value={impact.activePermissionScopes} /><Metric label="Draft records" value={impact.draftRecords} /><Metric label="Historical records" value={impact.historicalRecords} />{impact.warnings.map((warning) => <p className="notice-row" key={warning}>{warning}</p>)}</div>;
}

function MembershipImpactSummary({ impact }: { impact: MembershipChangeImpact }) {
  return <div className="organisation-unit-metrics"><Metric label="Direct reports" value={impact.directReports} /><Metric label="Open actions" value={impact.assignedOpenActions} /><Metric label="Draft records" value={impact.draftRecords} /><Metric label="Active reviews" value={impact.activeReviews} />{impact.warnings.map((warning) => <p className="notice-row" key={warning}>{warning}</p>)}</div>;
}

function managerLabel(unit: AdminOrganisationUnit) {
  return unit.orgUnitType === "faculty" ? "Faculty Manager" : "Team Manager";
}

function unitMatches(unit: AdminOrganisationUnit, query: string) {
  return [unit.code, unit.name, unit.manager?.displayName ?? ""]
    .some((value) => value.toLocaleLowerCase().includes(query));
}
