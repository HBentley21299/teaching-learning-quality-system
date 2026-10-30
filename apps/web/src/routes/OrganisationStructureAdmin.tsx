import { ModalDialog } from "../components/ModalDialog";
import { confirmUnsavedNavigation, useUnsavedChanges } from "../components/UnsavedChangesGuard";
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
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../design-system/Button";
import { LoadingState } from "../components/LoadingState";
import { api } from "../services/api";
import { AdminListSort } from "../components/AdminListSort";
import { distinctListValues, matchesListSearch, sortListRows } from "../services/listQuery";
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

type OrganisationAdminView = "all" | "structure" | "leadership" | "membership" | "reviews" | "reporting";

const organisationViewGuidance: Record<OrganisationAdminView, { title: string; description: string }> = {
  all: { title: "Organisation structure", description: "Directorate, faculty and team management" },
  structure: { title: "Directorates, faculties & teams", description: "Choose a unit to edit its name, code or parent. Review the impact before activating or deactivating it." },
  leadership: { title: "Organisation leadership", description: "Choose a unit, find its manager, then confirm the assignment. Changing or removing a manager requires a reason." },
  membership: { title: "Team membership", description: "Choose a team to add a primary or additional staff allocation. Review the impact before removing an allocation." },
  reviews: { title: "Organisation allocation reviews", description: "Review unallocated leaders and migration records. Choose the correct unit before preparing a leadership assignment." },
  reporting: { title: "Dashboard inclusion", description: "Choose a directorate, faculty or team to control whether it contributes to dashboard reporting." }
};

export function OrganisationStructureAdmin({ isAdministrator = false, view = "all" }: { isAdministrator?: boolean; view?: OrganisationAdminView }) {
  const showStructure = view === "all" || view === "structure";
  const showLeadership = view === "all" || view === "leadership" || view === "reviews";
  const showMembership = view === "all" || view === "membership";
  const showReporting = view === "all" || view === "reporting";
  const showReviews = view === "all" || view === "reviews";
  const guidance = organisationViewGuidance[view];
  const [workspace, setWorkspace] = useState<AdminOrganisationStructure | null>(null);
  const [staffDetails, setStaffDetails] = useState<AdminOrganisationStaff[]>([]);
  const [selectedUnitId, setSelectedUnitId] = useState("");
  const [unitSearch, setUnitSearch] = useState("");
  const [unitSort, setUnitSort] = useState("code-asc");
  const [peopleSort, setPeopleSort] = useState("name-asc");
  const [memberQuery, setMemberQuery] = useState("");
  const [memberType, setMemberType] = useState("");
  const [reviewQuery, setReviewQuery] = useState("");
  const [reviewStatus, setReviewStatus] = useState("open");
  const [reviewSort, setReviewSort] = useState("staff-asc");
  const [managerSearch, setManagerSearch] = useState("");
  const [selectedManagerId, setSelectedManagerId] = useState("");
  const [pendingChange, setPendingChange] = useState<PendingManagerChange | null>(null);
  const [changeReason, setChangeReason] = useState("");
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const loadSequence = useRef(0);
  const [isSaving, setIsSaving] = useState(false);
  const [isAddingStaff, setIsAddingStaff] = useState(false);
  const [staffSearch, setStaffSearch] = useState("");
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [makePrimary, setMakePrimary] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [unitEditor, setUnitEditor] = useState<UnitEditor | null>(null);
  const [unitEditorBaseline, setUnitEditorBaseline] = useState("");
  const [pendingUnitStatus, setPendingUnitStatus] = useState<PendingUnitStatus | null>(null);
  const [pendingMembershipRemoval, setPendingMembershipRemoval] = useState<PendingMembershipRemoval | null>(null);
  const [migrationReviews, setMigrationReviews] = useState<OrganisationMigrationReview[]>([]);
  const unitDirty = Boolean(unitEditor && JSON.stringify(unitEditor) !== unitEditorBaseline);
  const assignmentDirty = Boolean(selectedManagerId || selectedStaffId || pendingChange || pendingUnitStatus || pendingMembershipRemoval);
  const dirty = unitDirty || assignmentDirty;
  const clearGuard = useUnsavedChanges({ label: "Organisation structure and assignments", dirty, saving: isSaving,
    onSave: assignmentDirty ? undefined : async () => { const saved = await saveUnit(); if (saved) clearGuard(); return saved; },
    onDiscard: () => { setUnitEditor(null); setSelectedManagerId(""); setManagerSearch(""); setSelectedStaffId(""); setStaffSearch(""); setMakePrimary(false); setPendingChange(null); setChangeReason(""); setPendingUnitStatus(null); setPendingMembershipRemoval(null); clearGuard(); } });

  async function closeEditor(close: () => void) {
    if (isSaving) return;
    if (!dirty || await confirmUnsavedNavigation()) close();
  }

  useEffect(() => {
    void refresh();
    return () => { ++loadSequence.current; };
  }, []);
  useEffect(() => { if (unitEditor || pendingChange || pendingUnitStatus || pendingMembershipRemoval) setMessage(""); }, [Boolean(unitEditor), Boolean(pendingChange), Boolean(pendingUnitStatus), Boolean(pendingMembershipRemoval)]);

  async function refresh(nextMessage = "") {
    const sequence = ++loadSequence.current;
    setLoading(true); setLoadError("");
    try {
      const [nextWorkspace, nextStaffDetails, nextMigrationReviews] = await Promise.all([
        api.adminOrganisationStructure(),
        api.adminOrganisationStaff(),
        api.organisationMigrationReviews()
      ]);
      if (sequence !== loadSequence.current) return;
      setWorkspace(nextWorkspace);
      setStaffDetails(nextStaffDetails);
      setMigrationReviews(nextMigrationReviews);
      setSelectedUnitId((current) => nextWorkspace.units.some((unit) => unit.id === current)
        ? current
        : nextWorkspace.units.find((unit) => unit.orgUnitType === "faculty")?.id ?? nextWorkspace.units[0]?.id ?? "");
      setMessage(nextMessage);
    } catch {
      if (sequence === loadSequence.current) setLoadError("Organisation settings could not be loaded. Check your connection and try again.");
    } finally { if (sequence === loadSequence.current) setLoading(false); }
  }

  const units = workspace?.units ?? [];
  const staff = workspace?.staff ?? [];
  const selectedUnit = units.find((unit) => unit.id === selectedUnitId) ?? null;
  const directorates = sortListRows(units.filter((unit) => unit.orgUnitType === "directorate" && (showInactive || unit.isActive
    || units.some((child) => child.orgUnitType === "faculty" && child.isActive && child.parentOrgUnitId === unit.id))), unit => unitSort.startsWith("name") ? unit.name : unit.code, "asc", unit => unit.id);
  const faculties = useMemo(
    () => units.filter((unit) => unit.orgUnitType === "faculty" && (showInactive || unit.isActive)),
    [showInactive, units]
  );
  const teamsByFaculty = useMemo(() => {
    const result = new Map<string, AdminOrganisationUnit[]>();
    units.filter((unit) => ["team", "faculty_child", "faculty_child_code"].includes(unit.orgUnitType) && (showInactive || unit.isActive)).forEach((team) => {
      if (!team.parentOrgUnitId) return;
      result.set(team.parentOrgUnitId, [...(result.get(team.parentOrgUnitId) ?? []), team]);
    });
    result.forEach((teams, key) => result.set(key, sortListRows(teams, unit => unitSort.startsWith("name") ? unit.name : unit.code, "asc", unit => unit.id)));
    return result;
  }, [showInactive, units, unitSort]);

  const visibleFaculties = useMemo(() => {
    const query = unitSearch.trim().toLocaleLowerCase();
    return sortListRows(faculties.filter((faculty) => {
      const teams = teamsByFaculty.get(faculty.id) ?? [];
      const directorate = units.find((unit) => unit.id === faculty.parentOrgUnitId);
      return !query || unitMatches(faculty, query) || (directorate && unitMatches(directorate, query)) || teams.some((team) => unitMatches(team, query));
    }), unit => unitSort.startsWith("name") ? unit.name : unit.code, "asc", unit => unit.id);
  }, [faculties, teamsByFaculty, unitSearch, units, unitSort]);

  const managerCandidates = useMemo(() => {
    if (selectedManagerId) return [];
    const query = managerSearch.trim().toLocaleLowerCase();
    if (!query) return [];
    return sortListRows(staff
      .filter((person) => person.staffId !== selectedUnit?.manager?.staffId)
      .filter((person) => matchesListSearch(query, person.displayName, person.externalId, person.email, person.primaryOrgCode)),
      person => peopleSort === "id-asc" ? person.externalId : person.displayName, "asc", person => person.staffId);
  }, [managerSearch, selectedManagerId, selectedUnit?.manager?.staffId, staff, peopleSort]);

  const selectedManager = staff.find((person) => person.staffId === selectedManagerId) ?? null;
  const managedUnitCount = units.filter((unit) => unit.manager).length;
  const selectedUnitMembers = useMemo(() => {
    if (!selectedUnit) return [];
    return staffDetails
      .filter((person) => person.memberships.some((membership) => membership.orgUnitId === selectedUnit.id && membership.isActive))
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  }, [selectedUnit, staffDetails]);
  const visibleMembers = sortListRows(selectedUnitMembers.filter(person => matchesListSearch(memberQuery, person.displayName, person.externalId, person.email, person.roleNames)
    && (!memberType || person.memberships.some(membership => membership.orgUnitId === selectedUnit?.id && membership.isActive && membership.isPrimary === (memberType === "primary")))),
    person => peopleSort === "id-asc" ? person.externalId : person.displayName, "asc", person => person.staffId);
  const staffCandidates = useMemo(() => {
    if (!selectedUnit || selectedUnit.orgUnitType !== "team" || selectedStaffId) return [];
    const query = staffSearch.trim().toLocaleLowerCase();
    if (!query) return [];
    const allocatedIds = new Set(selectedUnitMembers.map((person) => person.staffId));
    return sortListRows(staffDetails
      .filter((person) => !allocatedIds.has(person.staffId) && person.accountStatus === "active")
      .filter((person) => matchesListSearch(query, person.displayName, person.externalId, person.email, person.roleNames)), person => peopleSort === "id-asc" ? person.externalId : person.displayName, "asc", person => person.staffId);
  }, [selectedStaffId, selectedUnit, selectedUnitMembers, staffDetails, staffSearch, peopleSort]);
  const selectedStaff = staffDetails.find((person) => person.staffId === selectedStaffId) ?? null;
  const awaitingLeaders = useMemo(() => {
    const directors = new Set(units.filter((unit) => unit.orgUnitType === "directorate" && unit.manager).map((unit) => unit.manager!.staffId));
    const facultyManagers = new Set(units.filter((unit) => unit.orgUnitType === "faculty" && unit.manager).map((unit) => unit.manager!.staffId));
    const teamManagers = new Set(units.filter((unit) => unit.orgUnitType === "team" && unit.manager).map((unit) => unit.manager!.staffId));
    return staffDetails.flatMap((person) => {
      if ((person.staffCategory === "director" || (!person.staffCategory && person.roleNames.includes("Director"))) && !directors.has(person.staffId)) {
        return [{ person, roleName: "Director" }];
      }
      const awaitingFaculty = person.staffCategory
        ? person.staffCategory === "head_of_faculty_sector_manager"
        : person.roleNames.includes("Head of Faculty");
      const awaitingTeam = person.staffCategory
        ? person.staffCategory === "programme_leader"
        : person.roleNames.includes("Programme Leader");
      if (awaitingFaculty
          && !facultyManagers.has(person.staffId)) {
        return [{ person, roleName: "Head of Faculty / Sector Manager" }];
      }
      if (awaitingTeam
          && !teamManagers.has(person.staffId)) {
        return [{ person, roleName: "Programme Leader" }];
      }
      return [];
    });
  }, [staffDetails, units]);
  const visibleLeaders = sortListRows(awaitingLeaders.filter(({ person, roleName }) => matchesListSearch(reviewQuery, person.displayName, person.externalId, person.email, roleName)), item => peopleSort === "id-asc" ? item.person.externalId : item.person.displayName, "asc", item => item.person.staffId);
  const visibleMigrationReviews = sortListRows(migrationReviews.filter(review => (!reviewStatus || review.status === reviewStatus)
    && matchesListSearch(reviewQuery, review.staffName, review.sourceCode, review.proposedCode, review.details, review.status, review.resolutionNote, review.migrationKey, review.itemType)), review => reviewSort.startsWith("date") ? Date.parse(review.createdAt) : reviewSort.startsWith("status") ? review.status : review.staffName ?? review.sourceCode, reviewSort.endsWith("desc") ? "desc" : "asc", review => review.id);

  async function selectUnit(unitId: string) {
    if (unitId === selectedUnitId || !await confirmUnsavedNavigation()) return;
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
    if (!isAdministrator) { setMessage("Only Administrators can change organisation assignments or hierarchy because these control access."); return; }
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
    if (!isAdministrator) { setMessage("Only Administrators can change organisation assignments or hierarchy because these control access."); return; }
    setManagerSearch(person.displayName);
    setSelectedManagerId(person.staffId);
    setMessage(selectedUnit
      ? `Review ${person.displayName}'s proposed assignment to ${selectedUnit.code}, then confirm it in the unit details.`
      : "Choose the correct organisation unit, then choose this leader again to prepare their assignment.");
  }

  async function assignInitialManager() {
    if (!isAdministrator) { setMessage("Only Administrators can change organisation assignments or hierarchy because these control access."); return; }
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
    if (!isAdministrator) { setMessage("Only Administrators can change organisation assignments or hierarchy because these control access."); return; }
    if (!isAdministrator || !selectedUnit || !pendingChange || !changeReason.trim()) return;
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
    if (!isAdministrator) { setMessage("Only Administrators can change organisation assignments or hierarchy because these control access."); return; }
    if (!selectedUnit || !selectedManager) return;
    if (!selectedUnit.manager) {
      void assignInitialManager();
      return;
    }
    if (!isAdministrator) return;
    setPendingChange({ kind: "change", manager: selectedManager });
    setChangeReason("");
  }

  async function openNewUnit(orgUnitType: SaveOrganisationUnitRequest["orgUnitType"]) {
    if (!isAdministrator) { setMessage("Only Administrators can change organisation assignments or hierarchy because these control access."); return; }
    const parentOrgUnitId = orgUnitType === "team"
      ? selectedUnit?.orgUnitType === "faculty"
        ? selectedUnit.id
        : selectedUnit?.orgUnitType === "team" ? selectedUnit.parentOrgUnitId : undefined
      : orgUnitType === "faculty"
        ? selectedUnit?.orgUnitType === "directorate" ? selectedUnit.id : selectedUnit?.orgUnitType === "faculty" ? selectedUnit.parentOrgUnitId : undefined
        : undefined;
    if (!await confirmUnsavedNavigation()) return;
    const next: UnitEditor = { orgUnitType, code: "", name: "", description: "", parentOrgUnitId };
    setUnitEditor(next); setUnitEditorBaseline(JSON.stringify(next));
  }

  async function openEditUnit(unit: AdminOrganisationUnit) {
    if (!isAdministrator) { setMessage("Only Administrators can change organisation assignments or hierarchy because these control access."); return; }
    if (!await confirmUnsavedNavigation()) return;
    const next: UnitEditor = {
      id: unit.id,
      orgUnitType: unit.orgUnitType,
      code: unit.code,
      name: unit.name,
      description: unit.description ?? "",
      parentOrgUnitId: unit.parentOrgUnitId
    };
    setUnitEditor(next); setUnitEditorBaseline(JSON.stringify(next));
  }

  async function saveUnit() {
    if (!isAdministrator) { setMessage("Only Administrators can change organisation assignments or hierarchy because these control access."); return false; }
    if (!unitEditor || !unitEditor.code.trim() || !unitEditor.name.trim()) return false;
    setIsSaving(true);
    const request: SaveOrganisationUnitRequest = {
      orgUnitType: unitEditor.orgUnitType,
      code: unitEditor.code.trim().toUpperCase(),
      name: unitEditor.name.trim(),
      description: unitEditor.description?.trim() || undefined,
      parentOrgUnitId: unitEditor.orgUnitType !== "directorate" ? unitEditor.parentOrgUnitId || undefined : undefined
    };
    const result = unitEditor.id
      ? await api.updateOrganisationUnit(unitEditor.id, request)
      : await api.createOrganisationUnit(request);
    setIsSaving(false);
    if (!result.ok) {
      setMessage(result.message ?? "The organisation unit could not be saved.");
      return false;
    }
    const savedId = unitEditor.id ?? result.data?.id;
    setUnitEditor(null);
    await refresh(`${request.code} saved.`);
    if (savedId) setSelectedUnitId(savedId);
    if (!assignmentDirty) clearGuard();
    return true;
  }

  async function setDashboardInclusion(unit: AdminOrganisationUnit, includeInDashboards: boolean) {
    setIsSaving(true);
    const result = await api.setOrganisationUnitDashboardVisibility(unit.id, includeInDashboards);
    setIsSaving(false);
    if (!result.ok) {
      setMessage(result.message ?? "Dashboard inclusion could not be saved.");
      return;
    }
    await refresh(`${unit.code} ${includeInDashboards ? "included in" : "excluded from"} dashboards.`);
  }

  async function requestUnitStatusChange(unit: AdminOrganisationUnit) {
    if (!isAdministrator) { setMessage("Only Administrators can change organisation assignments or hierarchy because these control access."); return; }
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
    if (!isAdministrator) { setMessage("Only Administrators can change organisation assignments or hierarchy because these control access."); return; }
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
    if (!isAdministrator) { setMessage("Only Administrators can change organisation assignments or hierarchy because these control access."); return; }
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
    if (!isAdministrator) { setMessage("Only Administrators can change organisation assignments or hierarchy because these control access."); return; }
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
    <section className="panel organisation-unit-admin" aria-busy={loading || isSaving}>
      <div className="panel-heading">
        <div>
          <h2>{guidance.title}</h2>
          <span>{guidance.description}</span>
        </div>
        {showStructure ? <div className="toolbar">
          <Button disabled={!isAdministrator || isSaving} icon={Plus} onClick={() => openNewUnit("directorate")}>Add directorate</Button>
          <Button disabled={!isAdministrator || isSaving} icon={Plus} onClick={() => openNewUnit("faculty")}>Add faculty</Button>
          <Button disabled={!isAdministrator || isSaving} icon={Plus} onClick={() => openNewUnit("team")}>Add team</Button>
        </div> : null}
      </div>

      {message ? <div className="notice-row" role="status">{message}</div> : null}
      {loading ? <LoadingState label="Loading organisation settings" /> : null}
      {loadError ? <div className="notice-row" role="alert">{loadError}<Button disabled={loading || isSaving} onClick={() => void refresh()}>Try again</Button></div> : null}
      {showLeadership || showReviews ? <div className="filter-toolbar"><label className="entry-field"><span>Find an allocation or leader</span><input type="search" value={reviewQuery} onChange={event => setReviewQuery(event.target.value)} placeholder="Staff, code, role or review details" /></label><AdminListSort label="Sort people by" value={peopleSort} onChange={setPeopleSort} options={[["name-asc","Name: A–Z"],["id-asc","Staff ID: A–Z"]]} /></div> : null}

      {showLeadership && awaitingLeaders.length > 0 ? (
        <div className="organisation-leader-queue">
          <div>
            <strong>Leaders awaiting managed unit</strong>
            <span>{awaitingLeaders.length} self-declared {awaitingLeaders.length === 1 ? "leader needs" : "leaders need"} an Admin allocation.</span>
            <span>Select the correct unit below, then choose a leader here to prepare their assignment.</span>
          </div>
          <div className="organisation-leader-list">
            {visibleLeaders.map(({ person, roleName }) => (
              <button key={`${person.staffId}-${roleName}`} onClick={() => prepareLeaderAssignment(person)} type="button">
                <UserRoundCog aria-hidden="true" size={16} />
                <span><strong>{person.displayName}</strong><small>{roleName}</small></span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {view === "reviews" && awaitingLeaders.length === 0 ? <p className="notice-row">No self-declared leaders are awaiting a managed unit.</p> : null}

      <div className="organisation-unit-layout">
        <aside className="organisation-unit-directory" aria-label="Directorates, faculties and teams">
          <label className="admin-search-field">
            <Search aria-hidden="true" size={16} />
            <input
              aria-label="Search directorates, faculties and teams"
              onChange={(event) => setUnitSearch(event.target.value)}
              placeholder="Search unit or manager"
              type="search"
              value={unitSearch}
            />
          </label>
          <label className="organisation-primary-toggle">
            <input checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} type="checkbox" />
            <span>Show inactive</span>
          </label>
          <AdminListSort value={unitSort} onChange={setUnitSort} options={[["code-asc","Unit code: A–Z"],["name-asc","Unit name: A–Z"]]} />
          <p className="muted-copy">Units remain grouped under their directorate and faculty.</p>

          <div className="organisation-faculty-list">
            {[...directorates.filter((directorate) => !unitSearch.trim() || unitMatches(directorate, unitSearch.trim().toLocaleLowerCase()) || visibleFaculties.some((faculty) => faculty.parentOrgUnitId === directorate.id)), null].map((directorate) => {
              const groupedFaculties = visibleFaculties.filter((faculty) => directorate
                ? faculty.parentOrgUnitId === directorate.id
                : !directorates.some((item) => item.id === faculty.parentOrgUnitId));
              if (!directorate && groupedFaculties.length === 0) return null;
              return <div className="organisation-directorate-group" key={directorate?.id ?? "standalone"}>
                {directorate
                  ? <UnitButton isSelected={directorate.id === selectedUnitId} onClick={() => selectUnit(directorate.id)} unit={directorate} />
                  : <h3 className="eyebrow">Separate faculties</h3>}
                <div className={directorate ? "organisation-directorate-faculties" : undefined}>
            {groupedFaculties.map((faculty) => {
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
                {directorate && groupedFaculties.length === 0 ? <div className="empty-row">No faculties allocated.</div> : null}
                </div>
              </div>;
            })}
            {visibleFaculties.length === 0 && !directorates.some((unit) => !unitSearch.trim() || unitMatches(unit, unitSearch.trim().toLocaleLowerCase())) ? <div className="empty-row">No organisation units match this search.</div> : null}
          </div>
        </aside>

        {selectedUnit ? (
          <div className="organisation-unit-detail">
            <header className="organisation-unit-heading">
              <div>
                <span className="eyebrow">{selectedUnit.orgUnitType}</span>
                <h3>{selectedUnit.code} - {selectedUnit.name}</h3>
                {selectedUnit.orgUnitType === "faculty" ? <span>Directorate: {units.find((unit) => unit.id === selectedUnit.parentOrgUnitId)?.name ?? "Separate faculty"}</span> : null}
                {selectedUnit.alignedFacultyCodes.length > 0 ? <span>Service coverage: {selectedUnit.alignedFacultyCodes.join(", ")}</span> : null}
                {selectedUnit.legacyCodes.length > 0 ? <span>Previous code: {selectedUnit.legacyCodes.join(", ")}</span> : null}
              </div>
              <div className="toolbar">
                <span className={`status-chip ${selectedUnit.isActive ? "status-chip-active" : "status-chip-muted"}`}>
                  {selectedUnit.isActive ? "Active" : "Inactive"}
                </span>
                {showStructure ? <><button className="icon-button" disabled={!isAdministrator || isSaving} onClick={() => openEditUnit(selectedUnit)} title="Edit organisation unit" type="button" aria-label="Edit organisation unit">
                  <Edit3 aria-hidden="true" size={16} />
                </button>
                <button className="icon-button" disabled={!isAdministrator || isSaving} onClick={() => void requestUnitStatusChange(selectedUnit)} title={selectedUnit.isActive ? "Deactivate organisation unit" : "Activate organisation unit"} type="button" aria-label={selectedUnit.isActive ? "Deactivate organisation unit" : "Activate organisation unit"}>
                  <Power aria-hidden="true" size={16} />
                </button></> : null}
              </div>
            </header>

            {showReporting ? <div className="notice-row">
              <label>
                <input
                  checked={selectedUnit.includeInDashboards}
                  disabled={isSaving}
                  onChange={(event) => void setDashboardInclusion(selectedUnit, event.target.checked)}
                  type="checkbox"
                />{" "}
                Include this {selectedUnit.orgUnitType} in dashboards
              </label>
              <p>
                Excluding a unit also excludes the faculties and teams beneath it. A unit is only included when its parent units are included. Existing records remain available.
              </p>
            </div> : null}

            <div className="organisation-unit-metrics" aria-label="Organisation coverage">
              <Metric label="Staff in scope" value={selectedUnit.totalStaffCount} />
              <Metric label="Direct allocations" value={selectedUnit.directStaffCount} />
              {selectedUnit.orgUnitType === "directorate" ? (
                <Metric label="Faculties" value={units.filter((unit) => unit.orgUnitType === "faculty" && unit.parentOrgUnitId === selectedUnit.id && unit.isActive).length} />
              ) : selectedUnit.orgUnitType === "faculty" ? (
                <Metric label="Managed teams" value={`${selectedUnit.managedTeamCount}/${selectedUnit.childTeamCount}`} />
              ) : (
                <Metric label="Faculty manager" value={selectedUnit.parentManager?.displayName ?? "Unassigned"} />
              )}
              {showLeadership ? <Metric label="Permission level" value={selectedUnit.orgUnitType === "directorate" ? "Director" : selectedUnit.orgUnitType === "faculty" ? "Head of Faculty" : "Programme Leader"} /> : null}
            </div>

            {showLeadership ? <><div className="organisation-manager-section">
              <div className="admin-detail-heading">
                <h3>{managerLabel(selectedUnit)}</h3>
                <span>{selectedUnit.orgUnitType} scope</span>
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
                    disabled={!isAdministrator || isSaving}
                    onClick={() => { setPendingChange({ kind: "remove" }); setChangeReason(""); }}
                    title={`Remove ${managerLabel(selectedUnit)}`}
                    type="button"
                   aria-label={`Remove ${managerLabel(selectedUnit)}`}>
                    <Trash2 aria-hidden="true" size={16} />
                  </button>
                </div>
              ) : <div className="empty-row">No manager is assigned to this {selectedUnit.orgUnitType}.</div>}

              <div className="organisation-reporting-rule">
                <ShieldCheck aria-hidden="true" size={18} />
                <div>
                  <strong>{selectedUnit.orgUnitType === "directorate" ? "Directorate reporting line" : selectedUnit.orgUnitType === "faculty" ? "Faculty reporting line" : "Team reporting line"}</strong>
                  <span>
                    {selectedUnit.orgUnitType === "directorate"
                      ? "Faculty managers in this directorate report to the director."
                      : selectedUnit.orgUnitType === "faculty"
                      ? `${selectedUnit.managedTeamCount} team managers report to this role.${selectedUnit.parentManager ? ` The faculty manager reports to ${selectedUnit.parentManager.displayName}.` : selectedUnit.parentOrgUnitId ? " Assign a director to complete the reporting line." : " This faculty is separate from the directorates."}`
                      : selectedUnit.parentManager
                        ? `The team manager reports to ${selectedUnit.parentManager.displayName}.`
                        : "Assign the faculty manager to complete the reporting line."}
                  </span>
                </div>
              </div>
            </div>

            <div className="organisation-manager-assignment">
              {!isAdministrator ? <p>Only Administrators can change managers, memberships or the organisation hierarchy because these control access.</p> : null}
              <div className="admin-detail-heading">
                <h3>{selectedUnit.manager ? "Change" : "Assign"} {managerLabel(selectedUnit).toLowerCase()}</h3>
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
                    disabled={!isAdministrator}
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
                  <Button disabled={isSaving || !isAdministrator} icon={ShieldCheck} onClick={requestAssignment} variant="primary">
                    {`${selectedUnit.manager ? "Change" : "Assign"} ${managerLabel(selectedUnit).toLowerCase()}`}
                  </Button>
                </div>
              ) : null}
            </div></> : null}

            {showMembership && selectedUnit.orgUnitType === "team" ? (
              <div className="organisation-team-members">
                <div className="admin-detail-heading">
                  <div><h3>Team members</h3><span>{selectedUnitMembers.length} direct allocations</span></div>
                  <div className="filter-toolbar"><label className="entry-field"><span>Find a team member</span><input type="search" value={memberQuery} onChange={event => setMemberQuery(event.target.value)} /></label><label className="entry-field"><span>Allocation</span><select value={memberType} onChange={event => setMemberType(event.target.value)}><option value="">All allocations</option><option value="primary">Primary</option><option value="additional">Additional</option></select></label><AdminListSort label="Sort staff by" value={peopleSort} onChange={setPeopleSort} options={[["name-asc","Name: A–Z"],["id-asc","Staff ID: A–Z"]]} /></div>
                  <Button disabled={!isAdministrator || isSaving} icon={UserPlus} onClick={() => setIsAddingStaff((current) => !current)}>
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
                        <Button disabled={!isAdministrator || isSaving} icon={UserPlus} onClick={() => void addStaffToTeam()} variant="primary">Add to team</Button>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="organisation-member-list">
                  {visibleMembers.map((person) => {
                    const membership = person.memberships.find((item) => item.orgUnitId === selectedUnit.id && item.isActive);
                    return (
                    <div key={person.staffId}>
                      <span><strong>{person.displayName}</strong><small>{person.externalId} / {person.email}</small></span>
                      <span>{membership?.isPrimary ? "Primary" : "Additional"}</span>
                      {membership ? (
                        <button className="icon-button" disabled={!isAdministrator || isSaving} onClick={() => void requestMembershipRemoval(person, membership.id)} title="Remove team allocation" type="button" aria-label="Remove team allocation">
                          <Trash2 aria-hidden="true" size={15} />
                        </button>
                      ) : null}
                    </div>
                    );
                  })}
                  {selectedUnitMembers.length === 0 ? <div className="empty-row">No staff are directly allocated to this team.</div> : null}
                  {selectedUnitMembers.length > 0 && visibleMembers.length === 0 ? <div className="empty-row">No team members match these filters.</div> : null}
                </div>
              </div>
            ) : null}
            {view === "membership" && selectedUnit.orgUnitType !== "team" ? <p className="notice-row">Select a team beneath this {selectedUnit.orgUnitType} to manage its staff allocations.</p> : null}
          </div>
        ) : <div className="empty-row">Select a directorate, faculty or team.</div>}
      </div>

      {showReviews && migrationReviews.length > 0 ? (
        <details className="organisation-migration-review" open={view === "reviews" ? true : undefined}>
          <summary>
            <strong>Migration review</strong>
            <span>{migrationReviews.filter((review) => review.status === "open").length} staff allocations need confirmation</span>
          </summary>
          <p className="muted-copy">Check the proposed allocations against the staff records. Use Team membership to apply a confirmed team allocation.</p>
          <div className="filter-toolbar"><label className="entry-field"><span>Review status</span><select value={reviewStatus} onChange={event => setReviewStatus(event.target.value)}><option value="">All statuses</option>{distinctListValues(migrationReviews.map(review => review.status)).map(value => <option key={value}>{value}</option>)}</select></label><AdminListSort value={reviewSort} onChange={setReviewSort} options={[["staff-asc","Staff: A–Z"],["date-desc","Created: newest first"],["date-asc","Created: oldest first"],["status-asc","Status: A–Z"]]} /></div>
          <div className="organisation-member-list">
            {visibleMigrationReviews.map((review) => (
              <div key={review.id}>
                <span><strong>{review.staffName ?? review.sourceCode ?? "Unmatched record"}</strong><small>{review.details}</small></span>
                <span>{review.proposedCode ?? "Review"} · {review.status}</span>
              </div>
            ))}
            {!visibleMigrationReviews.length ? <p className="empty-row">No allocations match these filters.</p> : null}
          </div>
        </details>
      ) : null}
      {view === "reviews" && !migrationReviews.some((review) => review.status === "open") ? <p className="notice-row">No open migration allocations need review.</p> : null}

      {unitEditor ? (
        <ModalDialog className="admin-reason-dialog" label={unitEditor.id ? "Edit organisation unit" : "Add organisation unit"} busy={isSaving} onClose={() => void closeEditor(() => setUnitEditor(null))}>
          <fieldset className="admin-dialog-fields" disabled={isSaving} aria-label="Change details">
            <div className="panel-heading">
              <div><h2>{unitEditor.id ? "Edit" : "Add"} {unitEditor.orgUnitType}</h2><span>Organisation structure</span></div>
              <button className="icon-button" onClick={() => void closeEditor(() => setUnitEditor(null))} title="Close" type="button" aria-label="Close"><X size={16}  aria-hidden="true"/></button>
            </div>
            <div className="responsive-form-grid">
              <label className="entry-field"><span>Code <strong>Required</strong></span><input maxLength={50} onChange={(event) => setUnitEditor({ ...unitEditor, code: event.target.value.toUpperCase() })} value={unitEditor.code} /></label>
              <label className="entry-field"><span>Name <strong>Required</strong></span><input maxLength={250} onChange={(event) => setUnitEditor({ ...unitEditor, name: event.target.value })} value={unitEditor.name} /></label>
              {unitEditor.orgUnitType === "team" ? (
                <label className="entry-field"><span>Faculty <strong>Required</strong></span><select onChange={(event) => setUnitEditor({ ...unitEditor, parentOrgUnitId: event.target.value })} value={unitEditor.parentOrgUnitId ?? ""}><option value="">Select faculty</option>{units.filter((unit) => unit.orgUnitType === "faculty" && unit.isActive).map((faculty) => <option key={faculty.id} value={faculty.id}>{faculty.code} - {faculty.name}</option>)}</select></label>
              ) : null}
              {unitEditor.orgUnitType === "faculty" ? (
                <label className="entry-field"><span>Directorate</span><select onChange={(event) => setUnitEditor({ ...unitEditor, parentOrgUnitId: event.target.value || undefined })} value={unitEditor.parentOrgUnitId ?? ""}><option value="">Separate faculty (no directorate)</option>{units.filter((unit) => unit.orgUnitType === "directorate" && (unit.isActive || unit.id === unitEditor.parentOrgUnitId)).map((directorate) => <option key={directorate.id} value={directorate.id}>{directorate.name}{directorate.isActive ? "" : " (inactive)"}</option>)}</select><small>Change this allocation to move the faculty and its teams into a different directorate.</small></label>
              ) : null}
            </div>
            <label className="entry-field"><span>Description</span><textarea onChange={(event) => setUnitEditor({ ...unitEditor, description: event.target.value })} rows={3} value={unitEditor.description ?? ""} /></label>
            {message ? <p className="error-copy" role="alert">{message}</p> : null}
            <div className="toolbar"><Button icon={X} onClick={() => void closeEditor(() => setUnitEditor(null))}>Cancel</Button><Button disabled={isSaving || !unitEditor.code.trim() || !unitEditor.name.trim() || (unitEditor.orgUnitType === "team" && !unitEditor.parentOrgUnitId)} icon={SaveIcon} onClick={() => void saveUnit()} variant="primary">Save</Button></div>
          </fieldset>
        </ModalDialog>
      ) : null}

      {pendingUnitStatus ? (
        <ModalDialog className="admin-reason-dialog" label={`${pendingUnitStatus.unit.isActive ? "Deactivate" : "Activate"} organisation unit`} busy={isSaving} onClose={() => void closeEditor(() => setPendingUnitStatus(null))}>
          <fieldset className="admin-dialog-fields" disabled={isSaving} aria-label="Change details">
            <div className="panel-heading"><div><h2>{pendingUnitStatus.unit.isActive ? "Deactivate" : "Activate"} {pendingUnitStatus.unit.code}</h2><span>Review impact before confirming</span></div><button className="icon-button" onClick={() => void closeEditor(() => setPendingUnitStatus(null))} title="Close" type="button" aria-label="Close"><X size={16}  aria-hidden="true"/></button></div>
            <ImpactSummary impact={pendingUnitStatus.impact} />
            <label className="entry-field"><span>Reason <strong>Required</strong></span><textarea autoFocus onChange={(event) => setPendingUnitStatus({ ...pendingUnitStatus, reason: event.target.value })} rows={3} value={pendingUnitStatus.reason} /></label>
            {message ? <p className="error-copy" role="alert">{message}</p> : null}
            <div className="toolbar"><Button icon={X} onClick={() => void closeEditor(() => setPendingUnitStatus(null))}>Cancel</Button><Button disabled={isSaving || !pendingUnitStatus.reason.trim()} icon={Power} onClick={() => void confirmUnitStatusChange()} variant="primary">Confirm status change</Button></div>
          </fieldset>
        </ModalDialog>
      ) : null}

      {pendingMembershipRemoval ? (
        <ModalDialog className="admin-reason-dialog" label="Remove staff allocation" busy={isSaving} onClose={() => void closeEditor(() => setPendingMembershipRemoval(null))}>
          <fieldset className="admin-dialog-fields" disabled={isSaving} aria-label="Change details">
            <div className="panel-heading"><div><h2>Remove {pendingMembershipRemoval.impact.orgUnitCode} allocation</h2><span>{pendingMembershipRemoval.staff.displayName}</span></div><button className="icon-button" onClick={() => void closeEditor(() => setPendingMembershipRemoval(null))} title="Close" type="button" aria-label="Close"><X size={16}  aria-hidden="true"/></button></div>
            <MembershipImpactSummary impact={pendingMembershipRemoval.impact} />
            <label className="entry-field"><span>Reason <strong>Required</strong></span><textarea autoFocus onChange={(event) => setPendingMembershipRemoval({ ...pendingMembershipRemoval, reason: event.target.value })} rows={3} value={pendingMembershipRemoval.reason} /></label>
            {message ? <p className="error-copy" role="alert">{message}</p> : null}
            <div className="toolbar"><Button icon={X} onClick={() => void closeEditor(() => setPendingMembershipRemoval(null))}>Cancel</Button><Button disabled={isSaving || !pendingMembershipRemoval.reason.trim()} icon={Trash2} onClick={() => void confirmMembershipRemoval()} variant="primary">Remove allocation</Button></div>
          </fieldset>
        </ModalDialog>
      ) : null}

      {pendingChange && selectedUnit ? (
        <ModalDialog className="admin-reason-dialog" label={pendingChange.kind === "remove" ? "Remove manager" : "Change manager"} busy={isSaving} onClose={() => void closeEditor(() => setPendingChange(null))}>
          <fieldset className="admin-dialog-fields" disabled={isSaving} aria-label="Change details">
            <div className="panel-heading">
              <div>
                <h2>{pendingChange.kind === "remove" ? `Remove ${managerLabel(selectedUnit)}` : `Change ${managerLabel(selectedUnit)}`}</h2>
                <span>{selectedUnit.code} - {selectedUnit.name}</span>
              </div>
              <button className="icon-button" onClick={() => void closeEditor(() => setPendingChange(null))} title="Close" type="button" aria-label="Close"><X size={16}  aria-hidden="true"/></button>
            </div>
            <label className="entry-field">
              <span>Reason <strong>Required</strong></span>
              <textarea autoFocus onChange={(event) => setChangeReason(event.target.value)} rows={4} value={changeReason} />
            </label>
            {message ? <p className="error-copy" role="alert">{message}</p> : null}
            <div className="toolbar">
              <Button icon={X} onClick={() => void closeEditor(() => setPendingChange(null))}>Cancel</Button>
              <Button disabled={isSaving || !isAdministrator || !changeReason.trim()} icon={pendingChange.kind === "remove" ? Trash2 : ShieldCheck} onClick={() => void confirmChange()} variant="primary">
                {pendingChange.kind === "remove" ? "Remove manager" : "Confirm change"}
              </Button>
            </div>
          </fieldset>
        </ModalDialog>
      ) : null}
    </section>
  );
}

function UnitButton({ unit, isSelected, onClick }: { unit: AdminOrganisationUnit; isSelected: boolean; onClick: () => void }) {
  const Icon = unit.orgUnitType === "team" ? Users : Building2;
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
  return unit.orgUnitType === "directorate" ? "Director" : unit.orgUnitType === "faculty" ? "Faculty Manager" : "Team Manager";
}

function unitMatches(unit: AdminOrganisationUnit, query: string) {
  return matchesListSearch(query, unit.code, unit.name, unit.description, unit.manager?.displayName, unit.legacyCodes, unit.alignedFacultyCodes);
}
