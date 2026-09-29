import assert from 'node:assert/strict';
import {test} from 'node:test';
import {scopeCpdDashboardRecord} from '../apps/web/src/services/cpdDashboardScope.ts';
const event = {id:'event',processKey:'cpd_event',orgUnitId:'excluded-owner',areaCode:'Multiple',participantAreaBreakdown:'FAC~A~2~1~120|FAC~B~1~0~60|OTHER~C~4~4~240',participantCount:7,attendanceCredits:5,learningMinutes:420};
test('multi-faculty event counts once while totals use only chosen faculty',()=>{const value=scopeCpdDashboardRecord(event,'FAC');assert.equal(value.id,'event');assert.equal(value.participantCount,3);assert.equal(value.attendanceCredits,1);assert.equal(value.learningMinutes,180);assert.equal(value.areaCode,'FAC');assert.equal(value.orgUnitId,undefined);});
test('team filter excludes other teams in same faculty',()=>{const value=scopeCpdDashboardRecord(event,'FAC','B');assert.equal(value.participantCount,1);assert.equal(value.attendanceCredits,0);assert.equal(value.areaCode,'B');});
test('excluded attendee faculty does not contribute even when event itself is visible',()=>{const value=scopeCpdDashboardRecord(event,undefined,undefined,new Set(['OTHER']));assert.equal(value.participantCount,3);assert.equal(value.learningMinutes,180);});
test('unrelated attendee data cannot resurrect an event for a selected faculty',()=>assert.equal(scopeCpdDashboardRecord(event,'NONE'),undefined));
test('zero attendance event retains event count only in its matching area',()=>{const empty={...event,areaCode:'A',parentAreaCode:'FAC',participantAreaBreakdown:undefined};assert.equal(scopeCpdDashboardRecord(empty,'FAC').participantCount,0);assert.equal(scopeCpdDashboardRecord(empty,'OTHER'),undefined);});
