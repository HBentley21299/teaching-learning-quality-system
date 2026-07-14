import {
  Building2,
  ChevronRight,
  Search,
  ShieldCheck,
  Trash2,
  UserRoundCog,
  Users,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../design-system/Button";
import { api } from "../services/api";
import type {
  AdminOrganisationStaffOption,
  AdminOrganisationStructure,
  AdminOrganisationUnit
} from "../services/types";

type PendingManagerChange = {
  kind: "change" | "remove";
  manager?: AdminOrganisationStaffOption;
};

export function OrganisationStructureAdmin() {
  const [workspace, setWorkspace] = useState<AdminOrganisationStructure | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState("");
  const [unitSearch, setUnitSearch] = useState("");
  const [managerSearch, setManagerSearch] = useState("");
  const [selectedManagerId, setSelectedManagerId] = useState("");
  const [pendingChange, setPendingChange] = useState<PendingManagerChange | null>(null);
  const [changeReason, setChangeReason] = useState("");
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh(nextMessage = "") {
    try {
      const nextWorkspace = await api.adminOrganisationStructure();
      setWorkspace(nextWorkspace);
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
  const faculties = useMemo(() => units.filter((unit) => unit.orgUnitType === "faculty"), [units]);
  const teamsByFaculty = useMemo(() => {
    const result = new Map<string, AdminOrganisationUnit[]>();
    units.filter((unit) => unit.orgUnitType === "team").forEach((team) => {
      if (!team.parentOrgUnitId) return;
      result.set(team.parentOrgUnitId, [...(result.get(team.parentOrgUnitId) ?? []), team]);
    });
    result.forEach((teams) => teams.sort((left, right) => left.code.localeCompare(right.code)));
    return result;
  }, [units]);

  const visibleFaculties = useMemo(() => {
    const query = unitSearch.trim().toLocaleLowerCase();
    if (!query) return faculties;
    return faculties.filter((faculty) => {
      const teams = teamsByFaculty.get(faculty.id) ?? [];
      return unitMatches(faculty, query) || teams.some((team) => unitMatches(team, query));
    });
  }, [faculties, teamsByFaculty, unitSearch]);

  const managerCandidates = useMemo(() => {
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
  }, [managerSearch, selectedUnit?.manager?.staffId, staff]);

  const selectedManager = staff.find((person) => person.staffId === selectedManagerId) ?? null;
  const managedUnitCount = units.filter((unit) => unit.manager).length;

  function selectUnit(unitId: string) {
    setSelectedUnitId(unitId);
    setManagerSearch("");
    setSelectedManagerId("");
    setMessage("");
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

  return (
    <section className="panel organisation-unit-admin">
      <div className="panel-heading">
        <div>
          <h2>Organisation structure</h2>
          <span>Faculty and team management</span>
        </div>
        <strong>{managedUnitCount} of {units.length} managers assigned</strong>
      </div>

      {message ? <div className="notice-row" role="status">{message}</div> : null}

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
              </div>
              <span className={`status-chip ${selectedUnit.manager ? "status-chip-active" : "status-chip-muted"}`}>
                {selectedUnit.manager ? "Manager assigned" : "Unassigned"}
              </span>
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
                <span>{selectedUnit.totalStaffCount} staff records in scope</span>
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
          </div>
        ) : <div className="empty-row">Select a faculty or team.</div>}
      </div>

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
    <button className={`organisation-unit-button${isSelected ? " is-selected" : ""}`} onClick={onClick} type="button">
      <Icon aria-hidden="true" size={17} />
      <span><strong>{unit.code}</strong><small>{unit.name}</small></span>
      <span className={unit.manager ? "unit-manager-name" : "unit-manager-name is-unassigned"}>{unit.manager?.displayName ?? "Unassigned"}</span>
      <ChevronRight aria-hidden="true" size={16} />
    </button>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function managerLabel(unit: AdminOrganisationUnit) {
  return unit.orgUnitType === "faculty" ? "Faculty Manager" : "Team Manager";
}

function unitMatches(unit: AdminOrganisationUnit, query: string) {
  return [unit.code, unit.name, unit.manager?.displayName ?? ""]
    .some((value) => value.toLocaleLowerCase().includes(query));
}
