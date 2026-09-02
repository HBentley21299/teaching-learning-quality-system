import {
  CalendarClock,
  CheckCircle2,
  Eye,
  ExternalLink,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  X,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { DataTable } from "../components/DataTable";
import { ActionThemeSelect } from "../components/ActionThemeSelect";
import { ExportExcelButton } from "../components/ExportButtons";
import { StaffSearchSelect } from "../components/StaffSearchSelect";
import { Button } from "../design-system/Button";
import { api } from "../services/api";
import type {
  ActionExtensionSummary,
  ActionOwnerOption,
  ActionSummary,
  ActionVisibility,
  CurrentUser,
  OrgUnitSummary,
  StaffSummary
} from "../services/types";

type ActionsViewProps = {
  academicYear: string;
  actions: ActionSummary[];
  staff: StaffSummary[];
  orgUnits: OrgUnitSummary[];
  user: CurrentUser;
  onChanged: () => Promise<void>;
  initialStaffId?: string;
  initialActionId?: string;
  onOpenSource?: (action: ActionSummary) => void;
  onActionOpened?: (actionId: string) => void;
  onActionClosed?: () => void;
};

type StatusFilter = "all" | "open" | "extended" | "overdue" | "complete" | "cancelled" | "deleted";
type OwnershipFilter = "all" | "mine" | "team";
type DueFilter = "all" | "overdue" | "next_7" | "next_30" | "no_date";
type SortMode = "due" | "newest" | "owner" | "source" | "title";

const sourceLabels: Record<string, string> = {
  coaching_mentoring: "Coaching and Mentoring",
  elevate_environment: "Learning Environment",
  elevate_practice: "Elevate Learning and Innovation",
  learning_walk: "Learning Walk",
  liv: "LIV",
  qa_review: "QA Review",
  standalone: "Standalone",
  work_scrutiny: "Work Scrutiny"
};

const visibilityLabels: Record<ActionVisibility, string> = {
  owner_only: "Owner only",
  staff_and_management: "Staff and management",
  management_only: "Management only",
  source_editors: "Source editors"
};

function sourceLabel(value: string) {
  return sourceLabels[value] ?? value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function actionStatus(action: ActionSummary) {
  if (action.isDeleted) return "Deleted";
  if (action.statusKey === "cancelled") return "Cancelled";
  if (action.completedDate || action.statusKey === "complete") return "Completed";
  if (action.isOverdue) return "Overdue";
  if (action.statusKey === "extended") return "Extended";
  return "Open";
}

function formatDateTime(value?: string) {
  return value ? new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "Not recorded";
}

function nextDate(value?: string) {
  if (!value) return "";
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + 1));
  return date.toISOString().slice(0, 10);
}

export function ActionsView({ academicYear, actions, staff, orgUnits, user, onChanged, initialStaffId = "", initialActionId = "", onOpenSource, onActionOpened, onActionClosed }: ActionsViewProps) {
  const [localActions, setLocalActions] = useState(actions);
  const [statusMessage, setStatusMessage] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [ownershipFilter, setOwnershipFilter] = useState<OwnershipFilter>("all");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [staffFilter, setStaffFilter] = useState("");
  const [facultyFilter, setFacultyFilter] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [dueFilter, setDueFilter] = useState<DueFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("due");
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [actionTheme, setActionTheme] = useState("");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [ownerStaffId, setOwnerStaffId] = useState(user.staffId ?? "");
  const [subjectStaffId, setSubjectStaffId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [visibilitySetting, setVisibilitySetting] = useState<ActionVisibility>("staff_and_management");
  const [ownerOptions, setOwnerOptions] = useState<ActionOwnerOption[]>([]);
  const [completingId, setCompletingId] = useState("");
  const [completionNote, setCompletionNote] = useState("");
  const [cancellingId, setCancellingId] = useState("");
  const [cancellationComments, setCancellationComments] = useState("");
  const [extendingId, setExtendingId] = useState("");
  const [extendedDueDate, setExtendedDueDate] = useState("");
  const [extensionReason, setExtensionReason] = useState("");
  const [detailId, setDetailId] = useState("");
  const [extensions, setExtensions] = useState<ActionExtensionSummary[]>([]);
  const [editingId, setEditingId] = useState("");
  const [editActionTheme, setEditActionTheme] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editDetail, setEditDetail] = useState("");
  const [editOwnerId, setEditOwnerId] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editVisibility, setEditVisibility] = useState<ActionVisibility>("staff_and_management");
  const [deletingId, setDeletingId] = useState("");
  const [deletionReason, setDeletionReason] = useState("");
  const extensionPanelRef = useRef<HTMLElement | null>(null);

  const canManageActions = user.permissions.includes("actions.manage");
  const canManageUcoActions = user.permissions.includes("uco_tla.manage")
    || user.permissions.includes("records.manage");
  const canManageAction = (action: ActionSummary) => canManageActions
    || (canManageUcoActions && action.sourceFormType === "uco_tla_review");
  const canViewTeamActions = canManageActions
    || user.permissions.includes("reports.view_scoped")
    || user.permissions.includes("reports.view_all");

  useEffect(() => {
    if (!extendingId) return;
    window.requestAnimationFrame(() => {
      extensionPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [extendingId]);

  useEffect(() => {
    if (!includeDeleted) {
      setLocalActions(actions);
      return;
    }

    void api.actions(true, academicYear)
      .then(setLocalActions)
      .catch(() => setLocalActions(actions));
  }, [academicYear, actions, includeDeleted]);

  useEffect(() => {
    setStaffFilter(initialStaffId);
    if (initialStaffId) {
      setOwnershipFilter("all");
    }
  }, [initialStaffId]);

  useEffect(() => {
    if (!initialActionId) return;
    const action = localActions.find((candidate) => candidate.id === initialActionId);
    if (action) void showDetail(action);
  }, [initialActionId, localActions]);

  useEffect(() => {
    void api.actionOwnerOptions(undefined, subjectStaffId || undefined)
      .then(setOwnerOptions)
      .catch(() => setOwnerOptions([]));
  }, [subjectStaffId]);

  const availableOwnerStaff = useMemo(() => {
    const ids = new Set(ownerOptions.map((option) => option.staffId));
    return staff.filter((staffMember) => ids.has(staffMember.id));
  }, [ownerOptions, staff]);

  const facultyOptions = useMemo(
    () => orgUnits.filter((unit) => !unit.parentOrgUnitId && unit.isActive).sort((left, right) => left.name.localeCompare(right.name)),
    [orgUnits]
  );
  const teamOptions = useMemo(
    () => orgUnits.filter((unit) => unit.parentOrgUnitId === facultyFilter && unit.isActive).sort((left, right) => left.name.localeCompare(right.name)),
    [facultyFilter, orgUnits]
  );
  const sourceOptions = useMemo(
    () => [...new Set(localActions.map((action) => action.sourceFormType))].sort((left, right) => sourceLabel(left).localeCompare(sourceLabel(right))),
    [localActions]
  );

  const visibleActions = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const inDays = (days: number) => new Date(today.getTime() + days * 86_400_000);
    return localActions
      .filter((action) => {
        const isMine = action.ownerStaffId === user.staffId || action.subjectStaffId === user.staffId;
        if (ownershipFilter === "mine" && !isMine) return false;
        if (ownershipFilter === "team" && isMine) return false;
        if (ownerFilter && action.ownerStaffId !== ownerFilter) return false;
        if (staffFilter && action.subjectStaffId !== staffFilter && action.ownerStaffId !== staffFilter) return false;
        if (facultyFilter && action.facultyId !== facultyFilter) return false;
        if (teamFilter && action.teamId !== teamFilter) return false;
        if (sourceFilter && action.sourceFormType !== sourceFilter) return false;
        if (statusFilter !== "all") {
          const expectedStatus = statusFilter === "complete" ? "completed" : statusFilter;
          if (actionStatus(action).toLowerCase() !== expectedStatus) return false;
        }
        if (dueFilter === "overdue" && !action.isOverdue) return false;
        if (dueFilter === "no_date" && action.dueDate) return false;
        if ((dueFilter === "next_7" || dueFilter === "next_30") && !action.dueDate) return false;
        if (dueFilter === "next_7" && action.dueDate && (new Date(action.dueDate) < today || new Date(action.dueDate) > inDays(7))) return false;
        if (dueFilter === "next_30" && action.dueDate && (new Date(action.dueDate) < today || new Date(action.dueDate) > inDays(30))) return false;
        return includeDeleted || !action.isDeleted;
      })
      .sort((left, right) => {
        if (sortMode === "newest") return right.createdAt.localeCompare(left.createdAt);
        if (sortMode === "owner") return (left.ownerStaffName ?? "").localeCompare(right.ownerStaffName ?? "");
        if (sortMode === "source") return sourceLabel(left.sourceFormType).localeCompare(sourceLabel(right.sourceFormType));
        if (sortMode === "title") return left.title.localeCompare(right.title);
        return (left.dueDate ?? "9999-12-31").localeCompare(right.dueDate ?? "9999-12-31");
      });
  }, [dueFilter, facultyFilter, includeDeleted, localActions, ownerFilter, ownershipFilter, sortMode, sourceFilter, staffFilter, statusFilter, teamFilter, user.staffId]);

  async function refresh() {
    await onChanged();
    const nextActions = await api.actions(includeDeleted, academicYear);
    setLocalActions(nextActions);
  }

  async function createAction() {
    if (!actionTheme.trim() || !title.trim() || !ownerStaffId || !dueDate) {
      setStatusMessage("An action needs an action theme, action, assigned owner and implementation date.");
      return;
    }
    setIsSaving(true);
    const result = await api.createAction({
      actionTheme: actionTheme.trim(), title: title.trim(), detail: detail.trim() || undefined, ownerStaffId,
      subjectStaffId: subjectStaffId || undefined, dueDate: dueDate || undefined,
      publishedToStaff: visibilitySetting !== "source_editors", visibilitySetting
    });
    setIsSaving(false);
    if (!result.ok) return setStatusMessage(result.message ?? "The action could not be created.");
    setStatusMessage("Action created and assigned.");
    setIsCreating(false); setActionTheme(""); setTitle(""); setDetail(""); setDueDate(""); setSubjectStaffId("");
    await refresh();
  }

  async function completeAction(actionId: string) {
    setIsSaving(true);
    const result = await api.updateAction(actionId, { status: "complete", completionNote: completionNote.trim() || undefined });
    setIsSaving(false);
    if (!result.ok) return setStatusMessage(result.message ?? "The action could not be completed.");
    setStatusMessage("Action completed."); setCompletingId(""); setCompletionNote(""); await refresh();
  }

  async function cancelAction(actionId: string) {
    if (!cancellationComments.trim()) return setStatusMessage("Add a cancellation reason.");
    setIsSaving(true);
    const result = await api.updateAction(actionId, { status: "cancelled", cancellationComments: cancellationComments.trim() });
    setIsSaving(false);
    if (!result.ok) return setStatusMessage(result.message ?? "The action could not be cancelled.");
    setStatusMessage("Action cancelled."); setCancellingId(""); setCancellationComments(""); await refresh();
  }

  async function reopenAction(actionId: string) {
    const result = await api.updateAction(actionId, { status: "open" });
    if (!result.ok) return setStatusMessage(result.message ?? "The action could not be reopened.");
    setStatusMessage("Action reopened."); await refresh();
  }

  async function extendAction(actionId: string) {
    if (!extendedDueDate || !extensionReason.trim()) return setStatusMessage("An extension needs a later date and a reason.");
    setIsSaving(true);
    const result = await api.extendAction(actionId, { dueDate: extendedDueDate, reason: extensionReason.trim() });
    setIsSaving(false);
    if (!result.ok) return setStatusMessage(result.message ?? "The action could not be extended.");
    setStatusMessage("Action implementation date extended."); setExtendingId(""); setExtendedDueDate(""); setExtensionReason(""); await refresh();
  }

  async function showDetail(action: ActionSummary) {
    setDetailId(action.id);
    onActionOpened?.(action.id);
    setExtensions(action.extensionCount ? await api.actionExtensions(action.id) : []);
  }

  async function beginEdit(action: ActionSummary) {
    setEditingId(action.id); setEditActionTheme(action.actionTheme); setEditTitle(action.title); setEditDetail(action.detail ?? "");
    setEditOwnerId(action.ownerStaffId); setEditDueDate(action.dueDate ?? ""); setEditVisibility(action.visibilitySetting);
    const options = await api.actionOwnerOptions(action.sourceRecordId, action.subjectStaffId);
    setOwnerOptions(options);
  }

  async function saveEdit() {
    if (!editingId || !editActionTheme.trim() || !editTitle.trim() || !editOwnerId) return;
    setIsSaving(true);
    const result = await api.updateAction(editingId, {
      actionTheme: editActionTheme.trim(), title: editTitle.trim(), detail: editDetail.trim() || undefined,
      dueDate: editDueDate || undefined, ownerStaffId: editOwnerId, visibilitySetting: editVisibility
    });
    setIsSaving(false);
    if (!result.ok) return setStatusMessage(result.message ?? "The action could not be updated.");
    setStatusMessage("Action updated."); setEditingId(""); await refresh();
  }

  async function deleteAction() {
    if (!deletingId || !deletionReason.trim()) return setStatusMessage("Add a deletion reason.");
    const result = await api.deleteAction(deletingId, deletionReason.trim());
    if (!result.ok) return setStatusMessage(result.message ?? "The action could not be deleted.");
    setStatusMessage("Action moved to deleted records."); setDeletingId(""); setDeletionReason(""); await refresh();
  }

  async function restoreAction(actionId: string) {
    const result = await api.restoreAction(actionId);
    if (!result.ok) return setStatusMessage(result.message ?? "The action could not be restored.");
    setStatusMessage("Action restored."); await refresh();
  }

  const counts = {
    open: localActions.filter((action) => !action.isDeleted && action.statusKey === "open" && !action.isOverdue).length,
    extended: localActions.filter((action) => !action.isDeleted && action.statusKey === "extended").length,
    overdue: localActions.filter((action) => !action.isDeleted && action.isOverdue).length,
    completed: localActions.filter((action) => !action.isDeleted && action.statusKey === "complete").length
  };
  const selectedAction = localActions.find((action) => action.id === detailId);

  return (
    <div className="route-stack">
      <div className="route-header">
        <div><p className="eyebrow">{canViewTeamActions ? "Teaching and learning follow-up" : "Your follow-up"}</p><h1>Actions</h1></div>
        <div className="toolbar">
          {user.permissions.includes("exports.create") ? <ExportExcelButton filters={{ academicYear }} moduleKey="actions" /> : null}
          {canManageActions ? <Button icon={Plus} onClick={() => setIsCreating((current) => !current)} variant="primary">Create action</Button> : null}
        </div>
      </div>

      <div className="action-metrics" aria-label="Action totals">
        <button onClick={() => setStatusFilter("open")} type="button"><strong>{counts.open}</strong><span>Open</span></button>
        <button onClick={() => setStatusFilter("extended")} type="button"><strong>{counts.extended}</strong><span>Extended</span></button>
        <button onClick={() => setStatusFilter("overdue")} type="button"><strong>{counts.overdue}</strong><span>Overdue</span></button>
        <button onClick={() => setStatusFilter("complete")} type="button"><strong>{counts.completed}</strong><span>Completed</span></button>
      </div>

      {statusMessage ? <div className="notice-row">{statusMessage}</div> : null}

      {isCreating ? (
        <section className="panel">
          <div className="panel-heading"><h2>New action</h2><span>Assign a standalone action within your permitted scope</span></div>
          <div className="entry-form">
            <div className="entry-field-grid">
              <label className="entry-field entry-field-wide"><span>Action theme <strong>Required</strong></span><ActionThemeSelect id="standalone-action-theme" onChange={setActionTheme} sourceFormType="standalone" value={actionTheme} /></label>
              <label className="entry-field entry-field-wide"><span>Action <strong>Required</strong></span><textarea maxLength={300} onChange={(event) => setTitle(event.target.value)} rows={3} value={title} /></label>
              <label className="entry-field entry-field-wide"><span>Description</span><textarea onChange={(event) => setDetail(event.target.value)} rows={3} value={detail} /></label>
              <label className="entry-field"><span>Staff member</span><StaffSearchSelect id="action-subject" onChange={setSubjectStaffId} staff={staff} value={subjectStaffId} /></label>
              <label className="entry-field"><span>Owner <strong>Required</strong></span><StaffSearchSelect id="action-owner" onChange={setOwnerStaffId} staff={availableOwnerStaff} value={ownerStaffId} /></label>
              <label className="entry-field"><span>Date to be implemented by <strong>Required</strong></span><input onChange={(event) => setDueDate(event.target.value)} type="date" value={dueDate} /></label>
              <label className="entry-field"><span>Visibility</span><select onChange={(event) => setVisibilitySetting(event.target.value as ActionVisibility)} value={visibilitySetting}>{Object.entries(visibilityLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            </div>
            <div className="toolbar"><Button icon={X} onClick={() => setIsCreating(false)}>Cancel</Button><Button disabled={isSaving} icon={Plus} onClick={() => void createAction()} variant="primary">Create action</Button></div>
          </div>
        </section>
      ) : null}

      {extendingId ? <section className="panel" ref={extensionPanelRef}><div className="panel-heading"><h2>Extend action</h2><span>The original implementation date remains in the audit history</span></div><div className="entry-form"><div className="entry-field-grid">
        <label className="entry-field"><span>Revised implementation date</span><input min={nextDate(localActions.find((action) => action.id === extendingId)?.dueDate)} onChange={(event) => setExtendedDueDate(event.target.value)} type="date" value={extendedDueDate} /></label>
        <label className="entry-field entry-field-wide"><span>Extension reason</span><textarea onChange={(event) => setExtensionReason(event.target.value)} rows={3} value={extensionReason} /></label>
      </div><div className="toolbar"><Button icon={X} onClick={() => { setExtendingId(""); setExtendedDueDate(""); setExtensionReason(""); }}>Cancel</Button><Button disabled={isSaving} icon={CalendarClock} onClick={() => void extendAction(extendingId)} variant="primary">{isSaving ? "Extending…" : "Extend action"}</Button></div></div></section> : null}

      <section className="panel action-inbox-panel">
        <div className="panel-heading"><h2>Action inbox</h2><span>{visibleActions.length} matching action{visibleActions.length === 1 ? "" : "s"}</span></div>
        <div className="action-filter-grid">
          {canViewTeamActions ? <label className="mini-filter"><span>View</span><select onChange={(event) => setOwnershipFilter(event.target.value as OwnershipFilter)} value={ownershipFilter}><option value="all">All permitted</option><option value="mine">My actions</option><option value="team">My team</option></select></label> : null}
          <label className="mini-filter"><span>Status</span><select onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} value={statusFilter}><option value="all">All statuses</option><option value="open">Open</option><option value="extended">Extended</option><option value="overdue">Overdue</option><option value="complete">Completed</option><option value="cancelled">Cancelled</option>{includeDeleted ? <option value="deleted">Deleted</option> : null}</select></label>
          {canViewTeamActions ? <label className="mini-filter"><span>Owner</span><select onChange={(event) => setOwnerFilter(event.target.value)} value={ownerFilter}><option value="">All owners</option>{staff.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label> : null}
          {canViewTeamActions ? <label className="mini-filter"><span>Staff member</span><select onChange={(event) => setStaffFilter(event.target.value)} value={staffFilter}><option value="">All staff</option>{staff.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label> : null}
          {canViewTeamActions ? <label className="mini-filter"><span>Faculty</span><select onChange={(event) => { setFacultyFilter(event.target.value); setTeamFilter(""); }} value={facultyFilter}><option value="">All faculties</option>{facultyOptions.map((unit) => <option key={unit.id} value={unit.id}>{unit.code} - {unit.name}</option>)}</select></label> : null}
          {canViewTeamActions ? <label className="mini-filter"><span>Team</span><select disabled={!facultyFilter} onChange={(event) => setTeamFilter(event.target.value)} value={teamFilter}><option value="">All teams</option>{teamOptions.map((unit) => <option key={unit.id} value={unit.id}>{unit.code} - {unit.name}</option>)}</select></label> : null}
          <label className="mini-filter"><span>Source form</span><select onChange={(event) => setSourceFilter(event.target.value)} value={sourceFilter}><option value="">All sources</option>{sourceOptions.map((source) => <option key={source} value={source}>{sourceLabel(source)}</option>)}</select></label>
          <label className="mini-filter"><span>Due date</span><select onChange={(event) => setDueFilter(event.target.value as DueFilter)} value={dueFilter}><option value="all">Any date</option><option value="overdue">Overdue</option><option value="next_7">Next 7 days</option><option value="next_30">Next 30 days</option><option value="no_date">No date</option></select></label>
          <label className="mini-filter"><span>Sort by</span><select onChange={(event) => setSortMode(event.target.value as SortMode)} value={sortMode}><option value="due">Date due</option><option value="newest">Newest created</option><option value="owner">Owner</option><option value="source">Source</option><option value="title">Action</option></select></label>
          {canManageActions || canManageUcoActions ? <label className="action-deleted-toggle"><input checked={includeDeleted} onChange={(event) => setIncludeDeleted(event.target.checked)} type="checkbox" /><span>Include deleted</span></label> : null}
        </div>

        {visibleActions.length === 0 ? <div className="empty-row">No actions match the current filters.</div> : (
          <DataTable rows={visibleActions} rowKey={(row) => row.id} columns={[
            { key: "title", header: "Action", render: (row) => <span><strong>{row.title}</strong><small className="table-subline">{row.actionTheme} · {row.subjectStaffName ?? "Organisation action"}</small></span> },
            { key: "owner", header: "Owner", render: (row) => row.ownerStaffName ?? "Unassigned" },
            { key: "source", header: "Source", render: (row) => <span>{sourceLabel(row.sourceFormType)}<small className="table-subline">{row.sourceRecordTitle ?? "Standalone"}</small></span> },
            { key: "area", header: "Faculty / team", render: (row) => <span>{row.facultyCode ?? "Organisation"}<small className="table-subline">{row.teamCode ?? ""}</small></span> },
            { key: "due", header: "Implementation date", render: (row) => <span>{row.dueDate ?? "No date"}{row.extensionCount ? <small className="table-subline">Extended {row.extensionCount} time{row.extensionCount === 1 ? "" : "s"}</small> : null}</span> },
            { key: "status", header: "Status", render: (row) => <span className={`action-status action-status-${actionStatus(row).toLowerCase()}`}>{actionStatus(row)}</span> },
            { key: "commands", header: "", render: (row) => <div className="action-row-commands">
              <Button icon={Eye} onClick={() => void showDetail(row)} variant="quiet">View</Button>
              {row.isDeleted && canManageAction(row) ? <Button icon={RotateCcw} onClick={() => void restoreAction(row.id)} variant="quiet">Restore</Button> : null}
              {!row.isDeleted && canManageAction(row) ? <Button icon={Pencil} onClick={() => void beginEdit(row)} variant="quiet">Edit</Button> : null}
              {!row.isDeleted && row.dueDate && !row.completedDate && row.statusKey !== "cancelled" && (canManageAction(row) || row.ownerStaffId === user.staffId) ? <Button icon={CalendarClock} onClick={() => { setStatusMessage(""); setExtendingId(row.id); setExtendedDueDate(nextDate(row.dueDate)); setExtensionReason(""); }} variant="quiet">Extend</Button> : null}
              {!row.isDeleted && !row.completedDate && row.statusKey !== "cancelled" && (canManageAction(row) || row.ownerStaffId === user.staffId) ? <Button icon={CheckCircle2} onClick={() => setCompletingId(row.id)} variant="quiet">Complete</Button> : null}
              {!row.isDeleted && !row.completedDate && row.statusKey !== "cancelled" && (canManageAction(row) || row.ownerStaffId === user.staffId) ? <Button icon={XCircle} onClick={() => setCancellingId(row.id)} variant="quiet">Cancel</Button> : null}
              {!row.isDeleted && canManageAction(row) && (row.completedDate || row.statusKey === "cancelled") ? <Button icon={RotateCcw} onClick={() => void reopenAction(row.id)} variant="quiet">Reopen</Button> : null}
            </div> }
          ]} />
        )}
      </section>

      {selectedAction ? (
        <section className="panel action-detail-panel">
          <div className="panel-heading"><div><h2>{selectedAction.title}</h2><span>{sourceLabel(selectedAction.sourceFormType)} · {actionStatus(selectedAction)}</span></div><Button icon={X} onClick={() => { setDetailId(""); onActionClosed?.(); }} variant="quiet">Close</Button></div>
          {selectedAction.detail ? <p className="action-detail-copy">{selectedAction.detail}</p> : null}
          <dl className="action-detail-grid">
            <div><dt>Action theme</dt><dd>{selectedAction.actionTheme}</dd></div>
            <div><dt>Owner</dt><dd>{selectedAction.ownerStaffName}</dd></div><div><dt>Staff member</dt><dd>{selectedAction.subjectStaffName ?? "Not staff-specific"}</dd></div>
            <div><dt>Original date</dt><dd>{selectedAction.originalDueDate ?? "No date"}</dd></div><div><dt>Current date</dt><dd>{selectedAction.dueDate ?? "No date"}</dd></div>
            {selectedAction.reviewDate ? <div><dt>Review date</dt><dd>{selectedAction.reviewDate}</dd></div> : null}
            {selectedAction.progressStatus ? <div><dt>Coaching progress</dt><dd>{selectedAction.progressStatus.replaceAll("_", " ")}</dd></div> : null}
            {selectedAction.intendedEvidence ? <div><dt>Intended evidence</dt><dd>{selectedAction.intendedEvidence}</dd></div> : null}
            {selectedAction.intendedImpact ? <div><dt>Intended impact</dt><dd>{selectedAction.intendedImpact}</dd></div> : null}
            <div><dt>Visibility</dt><dd>{visibilityLabels[selectedAction.visibilitySetting]}</dd></div><div><dt>Faculty / team</dt><dd>{[selectedAction.facultyName, selectedAction.teamName].filter(Boolean).join(" / ") || "Organisation"}</dd></div>
            <div><dt>Created</dt><dd>{formatDateTime(selectedAction.createdAt)} by {selectedAction.createdByName ?? "System"}</dd></div><div><dt>Last updated</dt><dd>{formatDateTime(selectedAction.updatedAt)}{selectedAction.updatedByName ? ` by ${selectedAction.updatedByName}` : ""}</dd></div>
            {selectedAction.completedDate ? <div><dt>Closure</dt><dd>{selectedAction.completedDate} by {selectedAction.completedByName ?? "Unknown"}<br />{selectedAction.completionNote}</dd></div> : null}
            {selectedAction.cancellationComments ? <div><dt>Cancellation</dt><dd>{selectedAction.cancellationComments}{selectedAction.cancelledByName ? ` · ${selectedAction.cancelledByName}` : ""}</dd></div> : null}
            {selectedAction.isDeleted ? <div><dt>Deletion</dt><dd>{selectedAction.deletionReason}<br />{formatDateTime(selectedAction.deletedAt)} by {selectedAction.deletedByName ?? "Unknown"}</dd></div> : null}
          </dl>
          {extensions.length ? <div className="action-history"><h3>Extension history</h3>{extensions.map((extension) => <div key={extension.id}><strong>{extension.previousDueDate} to {extension.extendedDueDate}</strong><span>{extension.reason}</span><small>{formatDateTime(extension.createdAt)} by {extension.createdByName ?? "System"}</small></div>)}</div> : null}
          {selectedAction.sourceRecordId && onOpenSource ? <div className="toolbar"><Button icon={ExternalLink} onClick={() => onOpenSource(selectedAction)} variant="secondary">Open source record</Button></div> : null}
          {canManageAction(selectedAction) && !selectedAction.isDeleted ? <div className="toolbar"><Button icon={Trash2} onClick={() => { setDeletingId(selectedAction.id); setDeletionReason(""); }} variant="danger">Delete action</Button></div> : null}
        </section>
      ) : null}

      {editingId ? <section className="panel"><div className="panel-heading"><h2>Edit action</h2><span>Changes are audit logged</span></div><div className="entry-form"><div className="entry-field-grid">
        <label className="entry-field entry-field-wide"><span>Action theme <strong>Required</strong></span><ActionThemeSelect id="edit-action-theme" onChange={setEditActionTheme} sourceFormType={localActions.find((action) => action.id === editingId)?.sourceFormType ?? "standalone"} value={editActionTheme} /></label>
        <label className="entry-field entry-field-wide"><span>Action <strong>Required</strong></span><textarea maxLength={300} onChange={(event) => setEditTitle(event.target.value)} rows={3} value={editTitle} /></label>
        <label className="entry-field entry-field-wide"><span>Description</span><textarea onChange={(event) => setEditDetail(event.target.value)} rows={3} value={editDetail} /></label>
        <label className="entry-field"><span>Owner</span><StaffSearchSelect id="edit-action-owner" onChange={setEditOwnerId} staff={availableOwnerStaff} value={editOwnerId} /></label>
        <label className="entry-field"><span>Date to be implemented by</span><input onChange={(event) => setEditDueDate(event.target.value)} type="date" value={editDueDate} /></label>
        <label className="entry-field"><span>Visibility</span><select onChange={(event) => setEditVisibility(event.target.value as ActionVisibility)} value={editVisibility}>{Object.entries(visibilityLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      </div><div className="toolbar"><Button icon={X} onClick={() => setEditingId("")}>Cancel</Button><Button disabled={isSaving} icon={CheckCircle2} onClick={() => void saveEdit()} variant="primary">Save changes</Button></div></div></section> : null}

      {completingId ? <ActionNotePanel heading="Complete action" label="Closure comments" value={completionNote} onChange={setCompletionNote} onCancel={() => { setCompletingId(""); setCompletionNote(""); }} onSave={() => void completeAction(completingId)} saveLabel="Mark completed" saving={isSaving} /> : null}
      {cancellingId ? <ActionNotePanel heading="Cancel action" label="Cancellation reason" value={cancellationComments} onChange={setCancellationComments} onCancel={() => { setCancellingId(""); setCancellationComments(""); }} onSave={() => void cancelAction(cancellingId)} saveLabel="Cancel action" saving={isSaving} danger /> : null}
      {deletingId ? <ActionNotePanel heading="Delete action" label="Deletion reason" value={deletionReason} onChange={setDeletionReason} onCancel={() => { setDeletingId(""); setDeletionReason(""); }} onSave={() => void deleteAction()} saveLabel="Delete action" saving={isSaving} danger /> : null}

    </div>
  );
}

type ActionNotePanelProps = {
  heading: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
  saveLabel: string;
  saving: boolean;
  danger?: boolean;
};

function ActionNotePanel({ heading, label, value, onChange, onCancel, onSave, saveLabel, saving, danger = false }: ActionNotePanelProps) {
  return <section className="panel"><div className="panel-heading"><h2>{heading}</h2><span>This change is audit logged</span></div><div className="entry-form">
    <label className="entry-field entry-field-wide"><span>{label}</span><textarea onChange={(event) => onChange(event.target.value)} rows={3} value={value} /></label>
    <div className="toolbar"><Button icon={X} onClick={onCancel}>Back</Button><Button disabled={saving} icon={danger ? Trash2 : CheckCircle2} onClick={onSave} variant={danger ? "danger" : "primary"}>{saveLabel}</Button></div>
  </div></section>;
}
