import { useEffect, useState } from "react";
import { StaffSearchSelect } from "../components/StaffSearchSelect";
import { confirmUnsavedNavigation } from "../components/UnsavedChangesGuard";
import { StaffProfilePanel, type StaffProfileRecordLinkHandler } from "../features/StaffProfilePanel";
import type { CurrentUser, StaffSummary } from "../services/types";

export function StaffProfileWorkspace({
  academicYear,
  staff,
  user,
  initialStaffId = "",
  initialElevateRecordId = "",
  onOpenRecord,
  onOpenActionDetails,
  onStaffChanged
}: {
  academicYear: string;
  staff: StaffSummary[];
  user: CurrentUser;
  initialStaffId?: string;
  initialElevateRecordId?: string;
  onOpenRecord: StaffProfileRecordLinkHandler;
  onOpenActionDetails: (actionId: string, staffId: string) => void;
  onStaffChanged?: (staffId: string) => void;
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
    initialStaffId
      ? accessibleStaff.some((staffMember) => staffMember.id === initialStaffId) || initialStaffId === user.staffId ? initialStaffId : ""
      : user.staffId ?? currentUserStaff?.id ?? accessibleStaff[0]?.id ?? ""
  );

  useEffect(() => {
    if (initialStaffId) {
      setSelectedStaffId(accessibleStaff.some((staffMember) => staffMember.id === initialStaffId) || initialStaffId === user.staffId ? initialStaffId : "");
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
            <div className="staff-profile-selector">
              <StaffSearchSelect
                id="profile-staff-selector"
                label="Select staff profile"
                staff={accessibleStaff}
                onChange={async (next) => {
                  if (!next || next === selectedStaffId) return;
                  if (!await confirmUnsavedNavigation()) return;
                  setSelectedStaffId(next);
                  onStaffChanged?.(next);
                }}
                value={selectedStaffId}
              />
            </div>
          </div>
        ) : null}
      </div>

      {selectedStaffId ? (
        <StaffProfilePanel
          key={`${selectedStaffId}:${academicYear}:${initialElevateRecordId}`}
          elevateRecordId={initialElevateRecordId}
          academicYear={academicYear}
          openElevateResult={Boolean(initialElevateRecordId)}
          staffId={selectedStaffId}
          user={user}
          onOpenActionDetails={onOpenActionDetails}
          onOpenRecord={onOpenRecord}
        />
      ) : (
        <section className="panel">
          <p className="muted-copy">{initialStaffId ? "This staff profile is unavailable in your directory. Choose another staff member, or retry loading the directory if a connection error is shown." : "No Staff Profile is available for this account."}</p>
        </section>
      )}
    </div>
  );
}
