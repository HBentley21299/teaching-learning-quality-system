import { useEffect, useMemo, useState, type AriaAttributes } from "react";
import { Search } from "lucide-react";
import { matchesListSearch, sortListRows } from "../services/listQuery";
import type { StaffSummary } from "../services/types";
import { useComboboxNavigation } from "./useComboboxNavigation";

type StaffSearchSelectProps = {
  id: string;
  onChange: (staffId: string) => void;
  staff: StaffSummary[];
  value: string;
  helperText?: string;
  label?: string;
} & Pick<AriaAttributes, "aria-invalid" | "aria-describedby" | "aria-required">;

export function StaffSearchSelect({ id, onChange, staff, value, helperText, label, "aria-invalid": ariaInvalid, "aria-describedby": describedBy, "aria-required": ariaRequired }: StaffSearchSelectProps) {
  const selectedStaff = staff.find((staffMember) => staffMember.id === value);
  const [query, setQuery] = useState(selectedStaff?.displayName ?? (value ? "Saved staff member" : ""));
  const [isOpen, setIsOpen] = useState(false);
  const [sort, setSort] = useState("name");
  const optionsId = `${id}-options`;

  useEffect(() => {
    if (!isOpen) setQuery(selectedStaff?.displayName ?? (value ? "Saved staff member" : ""));
  }, [isOpen, selectedStaff?.displayName, value]);

  const filteredStaff = useMemo(() => sortListRows(staff.filter(person => matchesListSearch(query,
    person.displayName, person.email, person.externalId, person.jobTitle)), person => sort === "email" ? person.email
    : sort === "staff_id" ? person.externalId : sort === "job" ? person.jobTitle : person.displayName, "asc", person => person.id), [query, staff, sort]);

  function selectStaff(staffMember: StaffSummary) {
    setQuery(staffMember.displayName);
    setIsOpen(false);
    onChange(staffMember.id);
  }
  const { activeIndex, activeId, setActiveIndex, onKeyDown } = useComboboxNavigation({
    open: isOpen, setOpen: setIsOpen,
    optionIds: filteredStaff.map(person => `${optionsId}-${person.id}`),
    onSelect: index => selectStaff(filteredStaff[index])
  });

  return (
    <>
      <div className="staff-search form-staff-search" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setIsOpen(false); }}>
        <div className="search-box staff-search-input">
          <Search size={16} aria-hidden="true" />
          <input
            aria-label={label ?? (id.includes("owner") ? "Action owner" : "Staff member")}
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            aria-controls={isOpen ? optionsId : undefined}
            aria-describedby={[`${id}-help`, describedBy].filter(Boolean).join(" ")}
            aria-invalid={ariaInvalid}
            aria-required={ariaRequired}
            aria-expanded={isOpen}
            autoComplete="off"
            id={id}
            onChange={(event) => {
              setActiveIndex(-1);
              setQuery(event.target.value);
              setIsOpen(true);
              onChange("");
            }}
            onFocus={() => { setIsOpen(true); setActiveIndex(-1); if (value) setQuery(""); }}
            onKeyDown={onKeyDown}
            placeholder="Type a name, email or job title"
            role="combobox"
            type="text"
            value={query}
          />
        </div>

        {isOpen ? <div className="picker-tools"><div className="picker-sort"><span>Sort by</span><select aria-label={`${label || "Staff"} results sort`} value={sort} onChange={event => { setSort(event.target.value); setActiveIndex(-1); }}><option value="name">Name</option><option value="staff_id">Staff ID</option><option value="email">Email</option><option value="job">Job title</option></select></div><span className="picker-results-count" role="status">{filteredStaff.length} {filteredStaff.length === 1 ? "result" : "results"}</span></div> : null}
        {isOpen ? (
          <div
            className="staff-search-results"
            id={optionsId}
            role="listbox" aria-label={label ? `${label} results` : "Staff results"}
          >
            {filteredStaff.length === 0 ? (
              <div className="staff-search-empty">No staff match "{query.trim()}".</div>
            ) : (
              filteredStaff.map((staffMember, index) => (
                <button
                  aria-selected={index === activeIndex}
                  id={`${optionsId}-${staffMember.id}`}
                  tabIndex={-1}
                  className={`staff-search-result${index === activeIndex ? " is-active" : ""}`}
                  key={staffMember.id}
                  onMouseDown={event => event.preventDefault()}
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
      <small id={`${id}-help`}>
        {selectedStaff
          ? `Selected: ${selectedStaff.displayName} — ${selectedStaff.email}`
          : value ? "Saved staff selection is outside the available directory. It is retained until you choose a replacement." : helperText ?? "Start typing, then select a staff member from the results."}
      </small>
    </>
  );
}
