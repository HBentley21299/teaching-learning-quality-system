import { CheckCircle2, Plus, RotateCcw, X } from "lucide-react";
import { useMemo, useState } from "react";
import { DataTable } from "../components/DataTable";
import { Button } from "../design-system/Button";
import { api } from "../services/api";
import type { ActionSummary, CurrentUser, StaffSummary } from "../services/types";

type ActionsViewProps = {
  actions: ActionSummary[];
  staff: StaffSummary[];
  user: CurrentUser;
  onChanged: () => Promise<void>;
};

type StatusFilter = "all" | "open" | "overdue" | "complete";
type OwnershipFilter = "all" | "mine" | "team";

export function ActionsView({ actions, staff, user, onChanged }: ActionsViewProps) {
  const [statusMessage, setStatusMessage] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [ownershipFilter, setOwnershipFilter] = useState<OwnershipFilter>("all");
  const [isCreating, setIsCreating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [ownerStaffId, setOwnerStaffId] = useState(user.staffId ?? "");
  const [subjectStaffId, setSubjectStaffId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [completingId, setCompletingId] = useState("");
  const [completionNote, setCompletionNote] = useState("");

  const canManageActions = user.permissions.includes("actions.manage");
  const canViewTeamActions = canManageActions
    || user.permissions.includes("reports.view_scoped")
    || user.permissions.includes("reports.view_all");

  const visibleActions = useMemo(
    () =>
      actions.filter((action) => {
        const isMine = action.ownerStaffId === user.staffId || action.subjectStaffId === user.staffId;
        if (ownershipFilter === "mine" && !isMine) {
          return false;
        }
        if (ownershipFilter === "team" && isMine) {
          return false;
        }
        if (statusFilter === "open") {
          return !action.completedDate;
        }
        if (statusFilter === "overdue") {
          return action.isOverdue;
        }
        if (statusFilter === "complete") {
          return Boolean(action.completedDate);
        }
        return true;
      }),
    [actions, ownershipFilter, statusFilter, user.staffId]
  );

  async function createAction() {
    if (!title.trim() || !ownerStaffId) {
      setStatusMessage("An action needs a title and an assigned owner.");
      return;
    }

    setIsSaving(true);
    const result = await api.createAction({
      title: title.trim(),
      detail: detail.trim() || undefined,
      ownerStaffId,
      subjectStaffId: subjectStaffId || undefined,
      dueDate: dueDate || undefined,
      publishedToStaff: true
    });
    setIsSaving(false);

    if (result.ok) {
      setStatusMessage("Action created and assigned.");
      setIsCreating(false);
      setTitle("");
      setDetail("");
      setDueDate("");
      setSubjectStaffId("");
      await onChanged();
    } else {
      setStatusMessage(result.message ?? "The action could not be created.");
    }
  }

  async function completeAction(actionId: string) {
    setIsSaving(true);
    const result = await api.updateAction(actionId, {
      status: "complete",
      completionNote: completionNote.trim() || undefined
    });
    setIsSaving(false);

    if (result.ok) {
      setStatusMessage("Action completed.");
      setCompletingId("");
      setCompletionNote("");
      await onChanged();
    } else {
      setStatusMessage(result.message ?? "The action could not be completed.");
    }
  }

  async function reopenAction(actionId: string) {
    const result = await api.updateAction(actionId, { status: "open" });
    if (result.ok) {
      setStatusMessage("Action reopened.");
      await onChanged();
    } else {
      setStatusMessage(result.message ?? "The action could not be reopened.");
    }
  }

  function statusLabel(action: ActionSummary) {
    if (action.completedDate) {
      return "Complete";
    }
    if (action.isOverdue) {
      return "Overdue";
    }
    return "Open";
  }

  const openCount = actions.filter((action) => !action.completedDate).length;
  const overdueCount = actions.filter((action) => action.isOverdue).length;

  return (
    <div className="route-stack">
      <div className="route-header">
        <div>
          <p className="eyebrow">Universal follow-up engine</p>
          <h1>Actions</h1>
        </div>
        <div className="toolbar">
          {canViewTeamActions ? (
            <label className="mini-filter">
              <span>View</span>
              <select onChange={(event) => setOwnershipFilter(event.target.value as OwnershipFilter)} value={ownershipFilter}>
                <option value="all">All permitted</option>
                <option value="mine">My actions</option>
                <option value="team">My team</option>
              </select>
            </label>
          ) : null}
          <label className="mini-filter">
            <span>Status</span>
            <select onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} value={statusFilter}>
              <option value="all">All</option>
              <option value="open">Open</option>
              <option value="overdue">Overdue</option>
              <option value="complete">Complete</option>
            </select>
          </label>
          {canManageActions ? (
            <Button icon={Plus} onClick={() => setIsCreating((current) => !current)} variant="primary">
              Create action
            </Button>
          ) : null}
        </div>
      </div>

      {statusMessage ? <div className="notice-row">{statusMessage}</div> : null}

      {isCreating ? (
        <section className="panel">
          <div className="panel-heading">
            <h2>New action</h2>
            <span>Assigned actions appear on the owner's dashboard</span>
          </div>
          <div className="entry-form">
            <div className="entry-field-grid">
              <label className="entry-field entry-field-wide">
                <span>Title <strong>Required</strong></span>
                <input onChange={(event) => setTitle(event.target.value)} type="text" value={title} />
              </label>
              <label className="entry-field entry-field-wide">
                <span>Detail</span>
                <textarea onChange={(event) => setDetail(event.target.value)} rows={3} value={detail} />
              </label>
              <label className="entry-field">
                <span>Owner (responsible for completing) <strong>Required</strong></span>
                <select onChange={(event) => setOwnerStaffId(event.target.value)} value={ownerStaffId}>
                  <option value="">Select owner</option>
                  {staff.map((staffMember) => (
                    <option key={staffMember.id} value={staffMember.id}>
                      {staffMember.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="entry-field">
                <span>Relates to staff member</span>
                <select onChange={(event) => setSubjectStaffId(event.target.value)} value={subjectStaffId}>
                  <option value="">Not staff-specific</option>
                  {staff.map((staffMember) => (
                    <option key={staffMember.id} value={staffMember.id}>
                      {staffMember.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="entry-field">
                <span>Due date</span>
                <input onChange={(event) => setDueDate(event.target.value)} type="date" value={dueDate} />
              </label>
            </div>
            <div className="toolbar">
              <Button icon={X} onClick={() => setIsCreating(false)}>Cancel</Button>
              <Button disabled={isSaving} icon={Plus} onClick={createAction} variant="primary">
                Create action
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-heading">
          <h2>Action inbox</h2>
          <span>{openCount} open, {overdueCount} overdue</span>
        </div>
        {visibleActions.length === 0 ? (
          <div className="empty-row">
            {actions.length === 0
              ? "No actions yet. Actions created from Learning Walks, Work Scrutiny and LIV records appear here."
              : "No actions match the current filter."}
          </div>
        ) : (
          <DataTable
            rows={visibleActions}
            rowKey={(row) => row.id}
            columns={[
              { key: "title", header: "Action", render: (row) => row.title },
              { key: "owner", header: "Owner", render: (row) => row.ownerStaffName ?? "Unassigned" },
              { key: "source", header: "Source", render: (row) => row.sourceRecordTitle ?? "Standalone" },
              { key: "due", header: "Due date", render: (row) => row.dueDate ?? "No date" },
              { key: "state", header: "Status", render: (row) => statusLabel(row) },
              {
                key: "actions",
                header: "",
                render: (row) => {
                  const canComplete = !row.completedDate && (canManageActions || row.ownerStaffId === user.staffId);
                  if (row.completedDate) {
                    return canManageActions ? (
                      <Button icon={RotateCcw} onClick={() => void reopenAction(row.id)} variant="quiet">
                        Reopen
                      </Button>
                    ) : (
                      <span className="muted-copy">{row.completionNote ?? ""}</span>
                    );
                  }

                  return canComplete ? (
                    <Button icon={CheckCircle2} onClick={() => setCompletingId(row.id)} variant="quiet">
                      Complete
                    </Button>
                  ) : null;
                }
              }
            ]}
          />
        )}
      </section>

      {completingId ? (
        <section className="panel">
          <div className="panel-heading">
            <h2>Complete action</h2>
            <span>Add closure evidence</span>
          </div>
          <div className="entry-form">
            <label className="entry-field entry-field-wide">
              <span>What was done? (closure note)</span>
              <textarea onChange={(event) => setCompletionNote(event.target.value)} rows={3} value={completionNote} />
            </label>
            <div className="toolbar">
              <Button icon={X} onClick={() => { setCompletingId(""); setCompletionNote(""); }}>Cancel</Button>
              <Button disabled={isSaving} icon={CheckCircle2} onClick={() => void completeAction(completingId)} variant="primary">
                Mark complete
              </Button>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
