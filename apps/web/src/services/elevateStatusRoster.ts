import type { ElevateStatusDashboardSummary, ElevateStatusStaffSummary } from "./types";

/** Rebuild cumulative award counts for an explicitly filtered staff cohort. */
export function statusRowsFromStaff(staff: readonly ElevateStatusStaffSummary[]): ElevateStatusDashboardSummary[] {
  const groups = new Map<string, ElevateStatusDashboardSummary>();
  for (const person of staff) {
    const key = person.orgUnitId ?? `${person.parentAreaCode ?? ""}:${person.areaCode ?? ""}`;
    const row = groups.get(key) ?? { orgUnitId: person.orgUnitId, areaCode: person.areaCode, areaName: person.areaName, parentAreaCode: person.parentAreaCode, staffCount: 0, level1OrAbove: 0, level2OrAbove: 0, level3OrAbove: 0, level4OrAbove: 0, level5OrAbove: 0 };
    row.staffCount += 1;
    if (person.currentLevel >= 1) row.level1OrAbove += 1;
    if (person.currentLevel >= 2) row.level2OrAbove += 1;
    if (person.currentLevel >= 3) row.level3OrAbove += 1;
    if (person.currentLevel >= 4) row.level4OrAbove += 1;
    if (person.currentLevel >= 5) row.level5OrAbove += 1;
    groups.set(key, row);
  }
  return [...groups.values()];
}
