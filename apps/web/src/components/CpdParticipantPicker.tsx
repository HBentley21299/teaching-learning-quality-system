import { useMemo, useState, type AriaAttributes } from "react";
import { Search, UsersRound, X } from "lucide-react";
import { matchesListSearch, sortListRows } from "../services/listQuery";
import type { OrgUnitSummary, StaffSummary } from "../services/types";
import { useComboboxNavigation } from "./useComboboxNavigation";

type CpdParticipantPickerProps = {
  id: string;
  onChange: (value: string) => void;
  orgUnits: OrgUnitSummary[];
  staff: StaffSummary[];
  value: string;
} & Pick<AriaAttributes, "aria-invalid" | "aria-describedby" | "aria-required">;

export function CpdParticipantPicker({ id, onChange, orgUnits, staff, value, "aria-invalid": ariaInvalid, "aria-describedby": describedBy, "aria-required": ariaRequired }: CpdParticipantPickerProps) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [sort, setSort] = useState("name");
  const [selectedQuery, setSelectedQuery] = useState("");
  const [selectedSort, setSelectedSort] = useState("selection");
  const [groupQuery, setGroupQuery] = useState("");
  const [bulkStatus, setBulkStatus] = useState("");
  const selectedIds = useMemo(() => splitIds(value), [value]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const optionsId = `${id}-options`;

  const staffValue = (person: StaffSummary | undefined, order: string) => order === "email" ? person?.email : order === "staff_id" ? person?.externalId : order === "job" ? person?.jobTitle : person?.displayName;
  const staffMatches = (person: StaffSummary | undefined, search: string) => matchesListSearch(search, person?.displayName || "Unavailable staff member", person?.email, person?.externalId, person?.jobTitle,
    [...(person?.orgUnitIds || []), person?.primaryOrgUnitId].map(unitId => orgUnits.find(unit => unit.id === unitId)).filter(Boolean).map(unit => [unit?.code, unit?.name]));
  const filteredStaff = useMemo(() => sortListRows(staff.filter(person => !selectedIdSet.has(person.id) && staffMatches(person, query)),
    person => staffValue(person, sort), "asc", person => person.id), [query, selectedIdSet, staff, sort, orgUnits]);
  const selectedStaffById = new Map(staff.map(person => [person.id, person]));
  const filteredSelectedIds = selectedIds.filter(staffId => staffMatches(selectedStaffById.get(staffId), selectedQuery));
  const displayedSelectedIds = selectedSort === "selection" ? filteredSelectedIds : sortListRows(filteredSelectedIds, staffId => staffValue(selectedStaffById.get(staffId), selectedSort), "asc", staffId => staffId);

  const groupOptions = useMemo(
    () => sortListRows(orgUnits
      .filter((orgUnit) => orgUnit.isActive && ["faculty", "team", "faculty_child", "faculty_child_code"].includes(orgUnit.orgUnitType))
      .map((orgUnit) => {
        const parent = orgUnits.find((candidate) => candidate.id === orgUnit.parentOrgUnitId);
        return {
          ...orgUnit,
          label: parent ? `${parent.code} / ${orgUnit.code} - ${orgUnit.name}` : `${orgUnit.code} - ${orgUnit.name}`
        };
      })
      .filter(unit => matchesListSearch(groupQuery, unit.label)), unit => `${unit.parentOrgUnitId ? "1" : "0"} ${unit.label}`, "asc", unit => unit.id),
    [orgUnits, groupQuery]
  );

  function addStaff(staffId: string) {
    if (!selectedIdSet.has(staffId)) {
      onChange([...selectedIds, staffId].join("|"));
    }
    setActiveIndex(-1); setQuery("");
    setIsOpen(false);
    setBulkStatus("");
  }
  const { activeIndex, activeId, setActiveIndex, onKeyDown } = useComboboxNavigation({
    open: isOpen, setOpen: setIsOpen,
    optionIds: filteredStaff.map(person => `${optionsId}-${person.id}`),
    onSelect: index => addStaff(filteredStaff[index].id)
  });

  function removeStaff(staffId: string) {
    onChange(selectedIds.filter((selectedId) => selectedId !== staffId).join("|"));
    setBulkStatus("");
  }

  function addOrgUnit(orgUnitId: string) {
    if (!orgUnitId) {
      return;
    }

    const includedOrgUnitIds = getOrgUnitAndDescendantIds(orgUnitId, orgUnits);
    const additions = staff.filter((staffMember) => {
      const memberships = new Set([
        ...(staffMember.orgUnitIds ?? []),
        ...(staffMember.primaryOrgUnitId ? [staffMember.primaryOrgUnitId] : [])
      ]);
      return [...includedOrgUnitIds].some((candidateId) => memberships.has(candidateId));
    });
    const nextIds = [...selectedIds];
    for (const staffMember of additions) {
      if (!nextIds.includes(staffMember.id)) {
        nextIds.push(staffMember.id);
      }
    }

    const orgUnit = orgUnits.find((candidate) => candidate.id === orgUnitId);
    const addedCount = nextIds.length - selectedIds.length;
    onChange(nextIds.join("|"));
    setBulkStatus(`${addedCount} participant${addedCount === 1 ? "" : "s"} added from ${orgUnit?.code ?? "the selected area"}.`);
  }

  return (
    <div className="cpd-participant-picker">
      <div className="cpd-participant-controls">
        <div className="staff-search form-staff-search" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setIsOpen(false); }}>
          <div className="search-box staff-search-input">
            <Search size={16} aria-hidden="true" />
            <input
              aria-activedescendant={activeId}
              aria-autocomplete="list"
              aria-controls={isOpen ? optionsId : undefined}
              aria-expanded={isOpen}
              aria-label="Search participants"
              aria-invalid={ariaInvalid}
              aria-describedby={describedBy}
              aria-required={ariaRequired}
              autoComplete="off"
              id={id}
              onChange={(event) => {
                setActiveIndex(-1); setQuery(event.target.value);
                setIsOpen(true);
              }}
              onFocus={() => { setIsOpen(true); setActiveIndex(-1); }}
              onKeyDown={onKeyDown}
              placeholder="Search by name, email or staff ID"
              role="combobox"
              type="search"
              value={query}
            />
          </div>

          {isOpen ? <div className="picker-tools"><div className="picker-sort"><span>Sort by</span><select aria-label="Participant results sort" value={sort} onChange={event => { setSort(event.target.value); setActiveIndex(-1); }}><option value="name">Name</option><option value="staff_id">Staff ID</option><option value="email">Email</option><option value="job">Job title</option></select></div><span className="picker-results-count" role="status">{filteredStaff.length} {filteredStaff.length === 1 ? "result" : "results"}</span></div> : null}
          {isOpen ? (
            <div
              className="staff-search-results"
              id={optionsId}
              role="listbox" aria-label="Participant results"
            >
              {filteredStaff.length === 0 ? (
                <div className="staff-search-empty">No available staff match "{query.trim()}".</div>
              ) : (
                filteredStaff.map((staffMember, index) => (
                  <button
                    aria-selected={index === activeIndex}
                    id={`${optionsId}-${staffMember.id}`}
                    tabIndex={-1}
                    className={`staff-search-result${index === activeIndex ? " is-active" : ""}`}
                    key={staffMember.id}
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => addStaff(staffMember.id)}
                    role="option"
                    type="button"
                  >
                    <strong>{staffMember.displayName}</strong>
                    <span>{staffMember.externalId}{staffMember.jobTitle ? ` - ${staffMember.jobTitle}` : ""}</span>
                    <small>{staffMember.email}</small>
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>

        <label className="cpd-bulk-select">
          <span><UsersRound size={16} aria-hidden="true" /> Add faculty or sub-team</span>
          <input aria-label="Search participant groups" type="search" placeholder="Search faculty or team" value={groupQuery} onChange={event => setGroupQuery(event.target.value)} />
          <select
            aria-label="Add participants by faculty or sub-team"
            defaultValue=""
            onChange={(event) => {
              addOrgUnit(event.target.value);
              event.target.value = "";
            }}
          >
            <option value="">Select an area</option>
            {groupOptions.map((orgUnit) => (
              <option key={orgUnit.id} value={orgUnit.id}>{orgUnit.label}</option>
            ))}
          </select>
        </label>
      </div>

      {bulkStatus ? <div className="cpd-bulk-status" role="status">{bulkStatus}</div> : null}

      <div className="cpd-selected-heading">
        <strong>Selected participants</strong>
        <span>{displayedSelectedIds.length} of {selectedIds.length}</span>
      </div>
      {selectedIds.length ? <div className="filter-toolbar"><input aria-label="Search selected participants" type="search" placeholder="Search selected participants" value={selectedQuery} onChange={event => setSelectedQuery(event.target.value)} /><div className="picker-sort"><span>Sort selected by</span><select aria-label="Selected participants sort" value={selectedSort} onChange={event => setSelectedSort(event.target.value)}><option value="selection">Selection order</option><option value="name">Name</option><option value="staff_id">Staff ID</option><option value="email">Email</option></select></div></div> : null}
      <div className="cpd-participant-list">
        {displayedSelectedIds.length === 0 ? (
          <div className="empty-row">{selectedIds.length ? "No selected participants match this search." : "No participants selected."}</div>
        ) : (
          displayedSelectedIds.map((staffId) => {
            const staffMember = selectedStaffById.get(staffId);
            return (
              <div className="cpd-participant-row" key={staffId}>
                <div>
                  <strong>{staffMember?.displayName ?? "Unavailable staff member"}</strong>
                  <span>{staffMember ? `${staffMember.externalId} - ${staffMember.email}` : staffId}</span>
                </div>
                <button
                  aria-label={`Remove ${staffMember?.displayName ?? "participant"}`}
                  className="icon-button"
                  onClick={() => removeStaff(staffId)}
                  title={`Remove ${staffMember?.displayName ?? "participant"}`}
                  type="button"
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function splitIds(value: string) {
  return value.split("|").filter(Boolean);
}

function getOrgUnitAndDescendantIds(rootId: string, orgUnits: OrgUnitSummary[]) {
  const ids = new Set([rootId]);
  let added = true;
  while (added) {
    added = false;
    for (const orgUnit of orgUnits) {
      if (orgUnit.parentOrgUnitId && ids.has(orgUnit.parentOrgUnitId) && !ids.has(orgUnit.id)) {
        ids.add(orgUnit.id);
        added = true;
      }
    }
  }
  return ids;
}
