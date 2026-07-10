import { useState } from "react";
import { Search } from "lucide-react";
import { StaffProfilePanel } from "../features/StaffProfilePanel";
import type { CurrentUser, StaffProfileSummary, StaffSummary } from "../services/types";

export function StaffProfileWorkspace({
  profiles,
  staff,
  user
}: {
  profiles: StaffProfileSummary[];
  staff: StaffSummary[];
  user: CurrentUser;
}) {
  const canViewAllProfiles =
    user.permissions.includes("liv.manage") ||
    user.permissions.includes("reports.view_all") ||
    user.permissions.includes("staff.manage") ||
    user.permissions.includes("users.manage");
  const currentUserStaff = staff.find((staffMember) => staffMember.email.toLowerCase() === user.email.toLowerCase());
  const accessibleStaff = canViewAllProfiles
    ? staff
    : staff.filter((staffMember) => staffMember.id === (user.staffId ?? currentUserStaff?.id));

  const [selectedStaffId, setSelectedStaffId] = useState(
    user.staffId ?? currentUserStaff?.id ?? accessibleStaff[0]?.id ?? ""
  );

  return (
    <div className="route-stack">
      <div className="route-header">
        <div>
          <p className="eyebrow">Staff development record</p>
          <h1>Staff Profile</h1>
        </div>
        {canViewAllProfiles ? (
          <div className="toolbar">
            <div className="search-box staff-profile-selector">
              <Search size={16} aria-hidden="true" />
              <select
                aria-label="Select staff profile"
                onChange={(event) => setSelectedStaffId(event.target.value)}
                value={selectedStaffId}
              >
                {accessibleStaff.map((staffMember) => (
                  <option key={staffMember.id} value={staffMember.id}>
                    {staffMember.displayName}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : null}
      </div>

      {selectedStaffId ? (
        <StaffProfilePanel profiles={profiles} staffId={selectedStaffId} user={user} />
      ) : (
        <section className="panel">
          <p className="muted-copy">No Staff Profile is available for this account.</p>
        </section>
      )}
    </div>
  );
}
