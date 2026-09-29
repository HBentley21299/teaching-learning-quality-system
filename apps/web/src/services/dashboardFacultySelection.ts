import type { OrgUnitSummary } from "./types";
export function excludedDashboardUnits(units: readonly OrgUnitSummary[], excludedFacultyIds: readonly string[]) {
 const excluded=new Set(excludedFacultyIds); for(let depth=0;depth<64;depth++){let added=false;for(const unit of units)if(unit.parentOrgUnitId&&excluded.has(unit.parentOrgUnitId)&&!excluded.has(unit.id)){excluded.add(unit.id);added=true;}if(!added)break;}
 return { ids:excluded, codes:new Set(units.filter(unit=>excluded.has(unit.id)).map(unit=>unit.code)) };
}
