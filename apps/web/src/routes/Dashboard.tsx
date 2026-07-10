import { RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "../design-system/Button";
import { KpiStrip } from "../components/KpiStrip";
import { DataTable } from "../components/DataTable";
import type { ActionSummary, CurrentUser, DashboardSummary, ModuleSummary, StaffProfileSummary } from "../services/types";

type DashboardProps = {
  modules: ModuleSummary[];
  actions: ActionSummary[];
  dashboards: DashboardSummary[];
  staffProfiles: StaffProfileSummary[];
  user: CurrentUser;
  onRefresh: () => Promise<void>;
};

export function Dashboard({ modules, actions, dashboards, staffProfiles, user, onRefresh }: DashboardProps) {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);

  const filteredActions = useMemo(
    () =>
      actions.filter((action) => {
        if (!action.dueDate) {
          return true;
        }
        if (startDate && action.dueDate < startDate) {
          return false;
        }
        if (endDate && action.dueDate > endDate) {
          return false;
        }
        return true;
      }),
    [actions, endDate, startDate]
  );

  const openActions = filteredActions.filter((action) => !action.completedDate);
  const overdueActions = filteredActions.filter((action) => action.isOverdue);
  const evidenceRecords = staffProfiles.reduce((total, staff) => total + staff.evidenceRecords, 0);
  const cpdCredits = staffProfiles.reduce((total, staff) => total + staff.cpdSessionsAttended, 0);

  const myActions = useMemo(
    () =>
      filteredActions
        .filter((action) => !action.completedDate)
        .filter((action) => action.ownerStaffId === user.staffId || action.subjectStaffId === user.staffId)
        .map((action) => ({
          due: action.dueDate ?? "No date",
          id: action.id,
          owner: action.ownerStaffName ?? user.displayName,
          source: action.sourceRecordTitle ?? "Standalone",
          status: action.isOverdue ? "Overdue" : isDueSoon(action.dueDate) ? "Due soon" : "Open",
          title: action.title
        })),
    [filteredActions, user.displayName, user.staffId]
  );

  async function refresh() {
    setIsRefreshing(true);
    await onRefresh();
    setIsRefreshing(false);
  }

  return (
    <div className="route-stack">
      <div className="route-header">
        <div>
          <p className="eyebrow">Teaching & Learning Quality</p>
          <h1>Operating dashboard</h1>
        </div>
        <div className="toolbar">
          <label className="mini-filter">
            <span>Due from</span>
            <input onChange={(event) => setStartDate(event.target.value)} type="date" value={startDate} />
          </label>
          <label className="mini-filter">
            <span>Due to</span>
            <input onChange={(event) => setEndDate(event.target.value)} type="date" value={endDate} />
          </label>
          <Button disabled={isRefreshing} icon={RefreshCw} onClick={() => void refresh()}>Refresh</Button>
        </div>
      </div>

      <KpiStrip
        items={[
          { label: "Enabled modules", value: modules.filter((module) => module.isEnabled).length, tone: "blue" },
          { label: "Open actions", value: openActions.length, tone: "amber" },
          { label: "Overdue actions", value: overdueActions.length, tone: overdueActions.length > 0 ? "red" : "green" },
          { label: "Evidence records", value: evidenceRecords, tone: "green" },
          { label: "CPD credits", value: cpdCredits, tone: "blue" }
        ]}
      />

      <div className="two-column">
        <section className="panel">
          <div className="panel-heading">
            <h2>My Dashboard</h2>
            <span>{myActions.length} open items assigned to or about you</span>
          </div>
          {myActions.length === 0 ? (
            <div className="empty-row">Nothing outstanding. Actions assigned to you will appear here.</div>
          ) : (
            <DataTable
              rows={myActions}
              rowKey={(row) => row.id}
              columns={[
                { key: "title", header: "Item", render: (row) => row.title },
                { key: "source", header: "Source", render: (row) => row.source },
                { key: "due", header: "Due", render: (row) => row.due },
                { key: "status", header: "Status", render: (row) => row.status }
              ]}
            />
          )}
        </section>

        <section className="panel">
          <div className="panel-heading">
            <h2>Open action load</h2>
            <span>All actions you can see</span>
          </div>
          {openActions.length === 0 ? (
            <div className="empty-row">No open actions in the selected date range.</div>
          ) : (
            <DataTable
              rows={openActions}
              rowKey={(row) => row.id}
              columns={[
                { key: "title", header: "Action", render: (row) => row.title },
                { key: "owner", header: "Owner", render: (row) => row.ownerStaffName ?? "Unassigned" },
                { key: "due", header: "Due", render: (row) => row.dueDate ?? "No date" },
                { key: "state", header: "State", render: (row) => (row.isOverdue ? "Overdue" : "Open") }
              ]}
            />
          )}
        </section>

        <section className="panel">
          <div className="panel-heading">
            <h2>Staff engagement</h2>
            <span>CPD and evidence by staff member</span>
          </div>
          {staffProfiles.length === 0 ? (
            <div className="empty-row">Staff profile summaries appear once staff records exist.</div>
          ) : (
            <DataTable
              rows={staffProfiles}
              rowKey={(row) => row.staffId}
              columns={[
                { key: "name", header: "Staff member", render: (row) => row.displayName },
                { key: "org", header: "Area", render: (row) => row.primaryOrgCode ?? "None" },
                { key: "cpd", header: "CPD", render: (row) => row.cpdSessionsAttended },
                { key: "evidence", header: "Evidence", render: (row) => row.evidenceRecords },
                { key: "open", header: "Open actions", render: (row) => row.openActions },
                { key: "overdue", header: "Overdue", render: (row) => row.overdueActions }
              ]}
            />
          )}
        </section>

        <section className="panel">
          <div className="panel-heading">
            <h2>Dashboard catalogue</h2>
            <span>{dashboards.length} available to your role</span>
          </div>
          {dashboards.length === 0 ? (
            <div className="empty-row">No dashboards are configured for your permissions.</div>
          ) : (
            <DataTable
              rows={dashboards}
              rowKey={(row) => row.id}
              columns={[
                { key: "name", header: "Dashboard", render: (row) => row.name },
                { key: "permission", header: "Permission", render: (row) => row.primaryPermissionKey },
                { key: "scope", header: "Scope", render: (row) => (row.facultyScopeRequired ? "Scoped" : "Global") }
              ]}
            />
          )}
        </section>
      </div>
    </div>
  );
}

function isDueSoon(dateValue?: string) {
  if (!dateValue) {
    return false;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const targetDate = new Date(dateValue);
  const daysUntilDue = (targetDate.getTime() - today.getTime()) / 86400000;
  return daysUntilDue >= 0 && daysUntilDue <= 14;
}
