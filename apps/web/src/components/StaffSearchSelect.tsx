import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { StaffSummary } from "../services/types";

type StaffSearchSelectProps = {
  id: string;
  onChange: (staffId: string) => void;
  staff: StaffSummary[];
  value: string;
  helperText?: string;
  label?: string;
};

export function StaffSearchSelect({ id, onChange, staff, value, helperText, label }: StaffSearchSelectProps) {
  const selectedStaff = staff.find((staffMember) => staffMember.id === value);
  const [query, setQuery] = useState(selectedStaff?.displayName ?? "");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const optionsId = `${id}-options`;

  useEffect(() => {
    if (selectedStaff) {
      setQuery(selectedStaff.displayName);
    } else if (!isOpen) {
      setQuery("");
    }
  }, [isOpen, selectedStaff]);

  const filteredStaff = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return staff
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
      .slice(0, 8);
  }, [query, staff]);

  function selectStaff(staffMember: StaffSummary) {
    setQuery(staffMember.displayName);
    setIsOpen(false);
    onChange(staffMember.id);
  }

  return (
    <>
      <div className="staff-search form-staff-search">
        <div className="search-box staff-search-input">
          <Search size={16} aria-hidden="true" />
          <input
            aria-label={label ?? (id.includes("owner") ? "Action owner" : "Staff member")}
            aria-activedescendant={isOpen && activeIndex >= 0 && filteredStaff[activeIndex] ? `${optionsId}-${filteredStaff[activeIndex].id}` : undefined}
            aria-autocomplete="list"
            aria-controls={optionsId}
            aria-expanded={isOpen}
            autoComplete="off"
            id={id}
            onBlur={() => setIsOpen(false)}
            onChange={(event) => {
              setActiveIndex(-1);
              setQuery(event.target.value);
              setIsOpen(true);
              onChange("");
            }}
            onFocus={() => { setIsOpen(true); setActiveIndex(-1); }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault(); setIsOpen(true);
                setActiveIndex(current => event.key === "ArrowDown" ? Math.min(current + 1, filteredStaff.length - 1) : Math.max(current - 1, 0));
              }
              if (event.key === "Enter" && isOpen && filteredStaff.length > 0) {
                event.preventDefault();
                selectStaff(filteredStaff[Math.max(0, activeIndex)] ?? filteredStaff[0]);
              }

              if (event.key === "Escape") {
                setIsOpen(false);
              }
            }}
            placeholder="Type a name, email or job title"
            role="combobox"
            type="text"
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
              <div className="staff-search-empty">No staff match "{query.trim()}".</div>
            ) : (
              filteredStaff.map((staffMember, index) => (
                <button
                  aria-selected={index === activeIndex}
                  id={`${optionsId}-${staffMember.id}`}
                  tabIndex={-1}
                  className="staff-search-result"
                  key={staffMember.id}
                  onClick={() => selectStaff(staffMember)}
                  role="option"
                  type="button"
                >
                  <strong>{staffMember.displayName}</strong>
                  <span>
                    {staffMember.jobTitle ?? "Staff member"}
                  </span>
                  <small>{staffMember.email}</small>
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>
      <small>
        {selectedStaff
          ? `Selected: ${selectedStaff.displayName} — ${selectedStaff.email}`
          : helperText ?? "Start typing, then select a staff member from the results."}
      </small>
    </>
  );
}
