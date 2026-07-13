import { useMemo, useState } from "react";
import { Search, UsersRound, X } from "lucide-react";
import type { OrgUnitSummary, StaffSummary } from "../services/types";

type CpdParticipantPickerProps = {
  id: string;
  onChange: (value: string) => void;
  orgUnits: OrgUnitSummary[];
  staff: StaffSummary[];
  value: string;
};

export function CpdParticipantPicker({ id, onChange, orgUnits, staff, value }: CpdParticipantPickerProps) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [bulkStatus, setBulkStatus] = useState("");
  const selectedIds = useMemo(() => splitIds(value), [value]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const optionsId = `${id}-options`;

  const filteredStaff = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return staff
      .filter((staffMember) => !selectedIdSet.has(staffMember.id))
      .filter((staffMember) => {
        if (!search) {
          return true;
        }

        return [
          staffMember.displayName,
          staffMember.email,
          staffMember.externalId,
          staffMember.jobTitle ?? ""
        ].some((candidate) => candidate.toLocaleLowerCase().includes(search));
      })
      .sort((left, right) => left.displayName.localeCompare(right.displayName))
      .slice(0, 10);
  }, [query, selectedIdSet, staff]);

  const selectedStaff = useMemo(
    () => selectedIds.map((staffId) => staff.find((staffMember) => staffMember.id === staffId)),
    [selectedIds, staff]
  );

  const groupOptions = useMemo(
    () => orgUnits
      .filter((orgUnit) => orgUnit.isActive && ["faculty", "team", "faculty_child", "faculty_child_code"].includes(orgUnit.orgUnitType))
      .map((orgUnit) => {
        const parent = orgUnits.find((candidate) => candidate.id === orgUnit.parentOrgUnitId);
        return {
          ...orgUnit,
          label: parent ? `${parent.code} / ${orgUnit.code} - ${orgUnit.name}` : `${orgUnit.code} - ${orgUnit.name}`
        };
      })
      .sort((left, right) => {
        const levelDifference = Number(Boolean(left.parentOrgUnitId)) - Number(Boolean(right.parentOrgUnitId));
        return levelDifference || left.label.localeCompare(right.label);
      }),
    [orgUnits]
  );

  function addStaff(staffId: string) {
    if (!selectedIdSet.has(staffId)) {
      onChange([...selectedIds, staffId].join("|"));
    }
    setQuery("");
    setIsOpen(false);
    setBulkStatus("");
  }

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
        <div className="staff-search form-staff-search">
          <div className="search-box staff-search-input">
            <Search size={16} aria-hidden="true" />
            <input
              aria-autocomplete="list"
              aria-controls={optionsId}
              aria-expanded={isOpen}
              aria-label="Search participants"
              autoComplete="off"
              id={id}
              onBlur={() => setIsOpen(false)}
              onChange={(event) => {
                setQuery(event.target.value);
                setIsOpen(true);
              }}
              onFocus={() => setIsOpen(true)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && filteredStaff.length > 0) {
                  event.preventDefault();
                  addStaff(filteredStaff[0].id);
                }
                if (event.key === "Escape") {
                  setIsOpen(false);
                }
              }}
              placeholder="Search by name, email or staff ID"
              role="combobox"
              type="search"
              value={query}
            />
          </div>

          {isOpen ? (
            <div
              className="staff-search-results"
              id={optionsId}
              onMouseDown={(event) => event.preventDefault()}
              role="listbox"
            >
              {filteredStaff.length === 0 ? (
                <div className="staff-search-empty">No available staff match "{query.trim()}".</div>
              ) : (
                filteredStaff.map((staffMember) => (
                  <button
                    className="staff-search-result"
                    key={staffMember.id}
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
        <span>{selectedIds.length}</span>
      </div>
      <div className="cpd-participant-list">
        {selectedIds.length === 0 ? (
          <div className="empty-row">No participants selected.</div>
        ) : (
          selectedIds.map((staffId, index) => {
            const staffMember = selectedStaff[index];
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
