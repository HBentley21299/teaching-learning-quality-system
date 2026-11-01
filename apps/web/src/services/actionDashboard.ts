import type { DashboardActionSummary } from "./types";
import { actionOriginKey, actionOriginLabel, actionOriginRecordLabel, hasActionOrigin } from "./actionOrigin";
import { dashboardActionState, isDashboardActionOpen } from "./dashboardActionState";
import { compareListValues, matchesListSearch } from "./listQuery";

export type ActionExploration = { origin: string; state: string; responsible: string; search: string; sort: string };
export const emptyActionExploration: ActionExploration = { origin: "all", state: "all", responsible: "all", search: "", sort: "due-asc" };
export const actionDashboardStateLabels = { open: "Open", overdue: "Overdue", complete: "Complete", cancelled: "Cancelled" };

/** Shared actions retain one reporting row even when several people are responsible. */
export function uniqueDashboardActions(actions: DashboardActionSummary[]) {
  return [...new Map(actions.filter(action => !action.isDeleted).map(action => [action.id, action])).values()];
}
export function actionResponsibleNames(action: DashboardActionSummary) {
  return [...new Set(action.responsibleStaffNames?.filter(Boolean).length ? action.responsibleStaffNames : [action.ownerStaffName || "Unassigned"])];
}
export function actionDueSoon(action: DashboardActionSummary, today = new Date().toISOString().slice(0, 10)) {
  const limit = new Date(`${today}T12:00:00Z`); limit.setUTCDate(limit.getUTCDate() + 14);
  return dashboardActionState(action) === "open" && Boolean(action.dueDate && action.dueDate >= today && action.dueDate <= limit.toISOString().slice(0, 10));
}
export function filterDashboardActions(actions: DashboardActionSummary[], filter: ActionExploration, today?: string) {
  const rows = uniqueDashboardActions(actions).filter(action => (filter.origin === "all" || actionOriginKey(action) === filter.origin)
    && (filter.state === "all" || (filter.state === "due_soon" ? actionDueSoon(action, today) : dashboardActionState(action) === filter.state))
    && (filter.responsible === "all" || actionResponsibleNames(action).includes(filter.responsible))
    && matchesListSearch(filter.search, action.title, action.actionTheme, actionResponsibleNames(action), action.subjectStaffName,
      actionOriginLabel(action), actionOriginRecordLabel(action), action.sourceRecordDate, action.facultyCode, action.teamCode, action.createdAt, action.dueDate,
      action.completedDate, actionDashboardStateLabels[dashboardActionState(action)]));
  const descending = filter.sort.endsWith("desc");
  const value = (action: DashboardActionSummary) => filter.sort.startsWith("title") ? action.title : filter.sort.startsWith("origin") ? actionOriginLabel(action)
    : filter.sort.startsWith("responsible") ? actionResponsibleNames(action).join("; ") : filter.sort.startsWith("raised") ? new Date(action.createdAt)
    : action.dueDate ? new Date(`${action.dueDate}T12:00:00Z`) : null;
  return rows.sort((left, right) => compareListValues(value(left), value(right), descending ? "desc" : "asc") || left.title.localeCompare(right.title) || left.id.localeCompare(right.id));
}
export function actionDashboardModel(actions: DashboardActionSummary[], today = new Date().toISOString().slice(0, 10)) {
  const rows = uniqueDashboardActions(actions);
  const states = { open: 0, overdue: 0, complete: 0, cancelled: 0 };
  const origins = new Map<string, { key: string; label: string; count: number; overdue: number }>();
  for (const action of rows) {
    const state = dashboardActionState(action); states[state]++;
    const key = actionOriginKey(action), group = origins.get(key) ?? { key, label: actionOriginLabel(action), count: 0, overdue: 0 };
    group.count++; if (state === "overdue") group.overdue++; origins.set(key, group);
  }
  const reportable = rows.length - states.cancelled;
  const linked = rows.filter(hasActionOrigin).length;
  const attention = rows.filter(action => isDashboardActionOpen(action) && (dashboardActionState(action) === "overdue" || actionDueSoon(action, today) || !action.dueDate))
    .sort((left, right) => Number(dashboardActionState(right) === "overdue") - Number(dashboardActionState(left) === "overdue") || (left.dueDate || "9999").localeCompare(right.dueDate || "9999") || left.id.localeCompare(right.id));
  return { rows, states, total: rows.length, reportable, linked, missingOrigin: rows.length - linked,
    completion: reportable ? Math.round(states.complete * 100 / reportable) : null,
    dueSoon: rows.filter(action => actionDueSoon(action, today)).length,
    origins: [...origins.values()].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label)), attention };
}
