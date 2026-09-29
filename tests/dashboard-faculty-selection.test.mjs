import assert from 'node:assert/strict';
import {test} from 'node:test';
import {excludedDashboardUnits} from '../apps/web/src/services/dashboardFacultySelection.ts';
const units=[{id:'d',code:'DIR',orgUnitType:'directorate'},{id:'f',code:'FAC',orgUnitType:'faculty',parentOrgUnitId:'d'},{id:'t',code:'TEAM',orgUnitType:'team',parentOrgUnitId:'f'},{id:'other',code:'OTHER',orgUnitType:'faculty'}];
test('excluding a faculty excludes its teams without excluding a sibling or directorate',()=>{const result=excludedDashboardUnits(units,['f']);assert.deepEqual([...result.codes].sort(),['FAC','TEAM']);assert.ok(!result.ids.has('d'));assert.ok(!result.ids.has('other'));});
test('no exclusions includes new faculties by default',()=>assert.equal(excludedDashboardUnits(units,[]).ids.size,0));
test('cyclic data terminates and exclusion propagation is independent of ordering',()=>{const a=excludedDashboardUnits([...units].reverse(),['f']);assert.ok(a.ids.has('t'));const b=excludedDashboardUnits([{id:'a',code:'A',parentOrgUnitId:'b'},{id:'b',code:'B',parentOrgUnitId:'a'}],['a']);assert.equal(b.ids.size,2);});
