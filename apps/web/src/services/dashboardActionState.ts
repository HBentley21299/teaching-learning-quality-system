import type { DashboardActionSummary } from "./types";

type ActionStateSource = Pick<DashboardActionSummary, "statusKey" | "completedDate" | "isOverdue">;
export type DashboardActionState = "cancelled" | "complete" | "overdue" | "open";
export const dashboardActionStates: DashboardActionState[] = ["open", "overdue", "complete", "cancelled"];

/** Keep register filters, labels and counts aligned with the reporting export's action state. */
export function dashboardActionState(action: ActionStateSource): DashboardActionState {
  if (action.statusKey === "cancelled") return "cancelled";
  if (action.completedDate || action.statusKey === "complete") return "complete";
  return action.isOverdue ? "overdue" : "open";
}

export function isDashboardActionOpen(action: ActionStateSource) {
  const state = dashboardActionState(action);
  return state === "open" || state === "overdue";
}

export function matchesDashboardActionState(action: ActionStateSource, filter: string) {
  return filter === "all" || dashboardActionState(action) === filter;
}
