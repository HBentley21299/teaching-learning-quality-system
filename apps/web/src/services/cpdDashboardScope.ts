import type { ProcessDashboardRecordSummary } from "./types";

/** Each event counts once; attendance/credits/minutes count only selected attended staff. */
export function scopeCpdDashboardRecord(record: ProcessDashboardRecordSummary, facultyCode?: string, teamCode?: string, excludedCodes: ReadonlySet<string> = new Set()): ProcessDashboardRecordSummary | undefined {
  if (record.processKey !== "cpd_event") return record;
  const parts = (record.participantAreaBreakdown ?? "").split("|").map(value => value.split("~"))
    .filter(part => part.length === 5 && part.slice(2).every(value => Number.isFinite(Number(value)) && Number(value) >= 0))
    .filter(([parent, area]) => !excludedCodes.has(parent) && !excludedCodes.has(area)
      && (teamCode ? area === teamCode : !facultyCode || area === facultyCode || parent === facultyCode));
  if (!parts.length) {
    const ownAreaMatches = teamCode ? record.areaCode === teamCode : !facultyCode || record.areaCode === facultyCode || record.parentAreaCode === facultyCode;
    if (!ownAreaMatches || excludedCodes.has(record.areaCode ?? "") || excludedCodes.has(record.parentAreaCode ?? "")) return undefined;
    return { ...record, participantAreaBreakdown: undefined, participantCount: 0, attendanceCredits: 0, learningMinutes: 0 };
  }
  const areaCode = parts.length === 1 ? parts[0][1] : teamCode ?? facultyCode ?? "Multiple";
  return { ...record, orgUnitId: undefined, areaCode, areaName: parts.length === 1 ? areaCode : facultyCode ?? "Multiple areas",
    parentAreaCode: parts.length === 1 ? parts[0][0] || undefined : facultyCode,
    participantAreaBreakdown: parts.map(part => part.join("~")).join("|"),
    participantCount: parts.reduce((sum, part) => sum + Number(part[2]), 0),
    attendanceCredits: parts.reduce((sum, part) => sum + Number(part[3]), 0),
    learningMinutes: parts.reduce((sum, part) => sum + Number(part[4]), 0) };
}
