import { StaffSearchSelect } from "../components/StaffSearchSelect";
import { confirmUnsavedNavigation } from "../components/UnsavedChangesGuard";
import { useState } from "react";
import { ExportExcelButton } from "../components/ExportButtons";
import { StaffProfilePanel, type StaffProfileRecordLinkHandler } from "../features/StaffProfilePanel";
import type { CurrentUser, StaffSummary } from "../services/types";

/**
 * Staff search for programme leaders and above (reports.view_scoped or
 * higher). The staff list arriving here is already scoped by the API, and the
 * profile endpoint re-checks scope server-side.
 */
export function StaffProfiles({
  academicYear,
  staff,
  user,
  onOpenRecord,
  onOpenActionDetails,
  onStaffSelected
}: {
  academicYear: string;
  staff: StaffSummary[];
  user: CurrentUser;
  onOpenRecord: StaffProfileRecordLinkHandler;
  onOpenActionDetails: (actionId: string, staffId: string) => void;
  onStaffSelected?: (staffId: string) => void;
}) {
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [pickerStaffId, setPickerStaffId] = useState("");

  const canUseStaffSearch = [
    "reports.view_scoped",
    "reports.view_all",
    "staff.manage",
    "users.manage"
  ].some((permission) => user.permissions.includes(permission));

  const selectedStaff = staff.find(person => person.id === selectedStaffId);

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
        <StaffSearchSelect id="staff-directory" label="Search staff by name, email or job title" staff={staff} value={pickerStaffId} onChange={async id => {
          setPickerStaffId(id);
          if (!id || id === selectedStaffId) return;
          if (await confirmUnsavedNavigation()) { setSelectedStaffId(id); onStaffSelected?.(id); }
          else setPickerStaffId(selectedStaffId);
        }} />
      </section>

      {selectedStaff ? (
        <StaffProfilePanel
          academicYear={academicYear}
          onOpenActionDetails={onOpenActionDetails}
          onOpenRecord={onOpenRecord}
          staffId={selectedStaff.id}
          user={user}
        />
      ) : (
        <section className="panel">
          <div className="panel-heading">
            <h2>Staff Profile</h2>
            <span>Select a staff member</span>
          </div>
          <p className="muted-copy">
            Start typing a name, email address or job title, then choose a match to open their Staff Profile here.
          </p>
        </section>
      )}
    </div>
  );
}
