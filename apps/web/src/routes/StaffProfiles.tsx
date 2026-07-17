import { Search, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { ExportExcelButton } from "../components/ExportButtons";
import { StaffProfilePanel } from "../features/StaffProfilePanel";
import type { CurrentUser, StaffProfileSummary, StaffSummary } from "../services/types";

const MAX_RESULTS = 8;

/**
 * Staff search for programme leaders and above (reports.view_scoped or
 * higher). The staff list arriving here is already scoped by the API, and the
 * profile endpoint re-checks scope server-side.
 */
export function StaffProfiles({
  academicYear,
  profiles,
  staff,
  user
}: {
  academicYear: string;
  profiles: StaffProfileSummary[];
  staff: StaffSummary[];
  user: CurrentUser;
}) {
  const [query, setQuery] = useState("");
  const [isResultsOpen, setIsResultsOpen] = useState(false);
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const canUseStaffSearch = [
    "reports.view_scoped",
    "reports.view_all",
    "staff.manage",
    "users.manage"
  ].some((permission) => user.permissions.includes(permission));

  const matches = useMemo(() => {
    const normalisedQuery = query.trim().toLowerCase();
    if (!normalisedQuery) {
      return [] as StaffSummary[];
    }

    return staff
      .filter((staffMember) =>
        [staffMember.displayName, staffMember.email, staffMember.externalId, staffMember.jobTitle ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(normalisedQuery)
      )
      .slice(0, MAX_RESULTS);
  }, [query, staff]);

  const selectedStaff = staff.find((staffMember) => staffMember.id === selectedStaffId);

  function selectStaff(staffMember: StaffSummary) {
    setSelectedStaffId(staffMember.id);
    setQuery(staffMember.displayName);
    setIsResultsOpen(false);
  }

  function clearSearch() {
    setQuery("");
    setSelectedStaffId("");
    setIsResultsOpen(false);
    inputRef.current?.focus();
  }

  if (!canUseStaffSearch) {
    return (
      <div className="route-stack">
        <div className="route-header">
          <div>
            <p className="eyebrow">People and scope</p>
            <h1>Staff</h1>
          </div>
        </div>
        <section className="panel">
          <div className="panel-heading">
            <h2>Access restricted</h2>
            <span>Programme leaders and above</span>
          </div>
          <p className="muted-copy">
            Staff search is available to programme leaders and above. Your own record is on the Staff Profile tab.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="route-stack">
      <div className="route-header">
        <div>
          <p className="eyebrow">People and scope</p>
          <h1>Staff</h1>
        </div>
        {user.permissions.includes("exports.create") ? <ExportExcelButton filters={{ academicYear }} moduleKey="staff" /> : null}
      </div>

      <section className="panel">
        <div className="panel-heading">
          <h2>Find a staff member</h2>
          <span>{staff.length} in your scope</span>
        </div>
        <div className="staff-search">
          <div className="search-box staff-search-input">
            <Search size={16} aria-hidden="true" />
            <input
              aria-autocomplete="list"
              aria-expanded={isResultsOpen && matches.length > 0}
              aria-label="Search staff by name, email or staff ID"
              onChange={(event) => {
                setQuery(event.target.value);
                setIsResultsOpen(true);
              }}
              onFocus={() => setIsResultsOpen(true)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && matches.length > 0) {
                  selectStaff(matches[0]);
                }

                if (event.key === "Escape") {
                  setIsResultsOpen(false);
                }
              }}
              placeholder="Search staff by name, email or staff ID"
              ref={inputRef}
              role="combobox"
              value={query}
            />
            {query ? (
              <button className="icon-button" onClick={clearSearch} title="Clear search" type="button">
                <X size={14} aria-hidden="true" />
              </button>
            ) : null}
          </div>

          {isResultsOpen && query.trim() ? (
            <div className="staff-search-results" onMouseDown={(event) => event.preventDefault()} role="listbox">
              {matches.length === 0 ? (
                <div className="staff-search-empty">No staff in your scope match "{query.trim()}".</div>
              ) : (
                matches.map((staffMember) => (
                  <button
                    className="staff-search-result"
                    key={staffMember.id}
                    onClick={() => selectStaff(staffMember)}
                    role="option"
                    aria-selected={staffMember.id === selectedStaffId}
                    type="button"
                  >
                    <strong>{staffMember.displayName}</strong>
                    <span>
                      {staffMember.externalId}
                      {staffMember.jobTitle ? ` - ${staffMember.jobTitle}` : ""}
                    </span>
                    <small>{staffMember.email}</small>
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>
      </section>

      {selectedStaff ? (
        <StaffProfilePanel academicYear={academicYear} profiles={profiles} staffId={selectedStaff.id} user={user} />
      ) : (
        <section className="panel">
          <div className="panel-heading">
            <h2>Staff Profile</h2>
            <span>Select a staff member</span>
          </div>
          <p className="muted-copy">
            Start typing a name, email address or staff ID, then choose a match to open their Staff Profile here.
          </p>
        </section>
      )}
    </div>
  );
}
