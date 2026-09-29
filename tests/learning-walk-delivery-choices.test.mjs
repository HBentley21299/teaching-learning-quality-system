import assert from 'node:assert/strict';
import { test } from 'node:test';
import { learningWalkDeliveryChoices } from '../apps/web/src/services/learningWalkDeliveryAreas.ts';
const areas = [{key:'classroom',name:'Classroom',isActive:true},{key:'workshop',name:'Workshop renamed',isActive:false}];
test('new forms offer active shared choices only', () => {
  assert.deepEqual(learningWalkDeliveryChoices(areas).map(area => area.key), ['classroom']);
});
test('editing retains an inactive saved choice and its historical label', () => {
  const options = learningWalkDeliveryChoices(areas, 'workshop', 'Workshop');
  assert.deepEqual(options[1], {key:'workshop',name:'Workshop',isActive:false});
});
test('a saved option still renders if its catalogue entry is unavailable', () => {
  assert.deepEqual(learningWalkDeliveryChoices([], 'legacy', 'Original area'), [{key:'legacy',name:'Original area',isActive:false}]);
});
