import type { OrgUnitSummary } from "./types";

export function dashboardVisibleUnitIds(units: readonly OrgUnitSummary[]): Set<string> {
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const visible = new Set<string>();
  for (const unit of units) {
    let current: OrgUnitSummary | undefined = unit;
    const visited = new Set<string>();
    let included = true;
    while (current) {
      if (!current.includeInDashboards || visited.has(current.id)) {
        included = false;
        break;
      }
      visited.add(current.id);
      current = current.parentOrgUnitId ? byId.get(current.parentOrgUnitId) : undefined;
    }
    if (included) visible.add(unit.id);
  }
  return visible;
}
