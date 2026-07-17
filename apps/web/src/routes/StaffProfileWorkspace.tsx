import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { StaffProfilePanel } from "../features/StaffProfilePanel";
import type { CurrentUser, StaffProfileSummary, StaffSummary } from "../services/types";

export function StaffProfileWorkspace({
  academicYear,
  profiles,
  staff,
  user,
  initialStaffId = "",
  initialElevateRecordId = ""
}: {
  academicYear: string;
  profiles: StaffProfileSummary[];
  staff: StaffSummary[];
  user: CurrentUser;
  initialStaffId?: string;
  initialElevateRecordId?: string;
}) {
  const canViewAllProfiles =
    user.permissions.includes("liv.manage") ||
    user.permissions.includes("reports.view_all") ||
    user.permissions.includes("staff.manage") ||
    user.permissions.includes("users.manage");
  const canViewScopedProfiles = user.permissions.includes("reports.view_scoped");
  const currentUserStaff = staff.find((staffMember) => staffMember.email.toLowerCase() === user.email.toLowerCase());
  const accessibleStaff = canViewAllProfiles || canViewScopedProfiles
    ? staff
    : staff.filter((staffMember) => staffMember.id === (user.staffId ?? currentUserStaff?.id));

  const [selectedStaffId, setSelectedStaffId] = useState(
    accessibleStaff.some((staffMember) => staffMember.id === initialStaffId)
      ? initialStaffId
      : user.staffId ?? currentUserStaff?.id ?? accessibleStaff[0]?.id ?? ""
  );

  useEffect(() => {
    if (initialStaffId && accessibleStaff.some((staffMember) => staffMember.id === initialStaffId)) {
      setSelectedStaffId(initialStaffId);
    } else if (!initialStaffId) {
      setSelectedStaffId(user.staffId ?? currentUserStaff?.id ?? accessibleStaff[0]?.id ?? "");
    }
  }, [initialStaffId, staff]);

  return (
    <div className="route-stack">
      <div className="route-header">
        <div>
          <p className="eyebrow">Staff development record</p>
          <h1>Staff Profile</h1>
        </div>
        {canViewAllProfiles || canViewScopedProfiles ? (
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
        <StaffProfilePanel
          key={`${selectedStaffId}:${initialElevateRecordId}`}
          elevateRecordId={initialElevateRecordId}
          academicYear={academicYear}
          openElevateResult={Boolean(initialElevateRecordId)}
          profiles={profiles}
          staffId={selectedStaffId}
          user={user}
        />
      ) : (
        <section className="panel">
          <p className="muted-copy">No Staff Profile is available for this account.</p>
        </section>
      )}
    </div>
  );
}
