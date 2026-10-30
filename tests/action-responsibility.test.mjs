import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actionResponsibleNames, actionResponsiblePeople, isActionResponsible } from '../apps/web/src/services/actionResponsibility.ts';

test('legacy actions retain their single responsible person', () => {
  const action = { ownerStaffId: 'primary', ownerStaffName: 'Original Owner' };
  assert.deepEqual(actionResponsiblePeople(action), [{ id: 'primary', name: 'Original Owner' }]);
  assert.equal(isActionResponsible(action, 'primary'), true);
  assert.equal(isActionResponsible(action, 'other'), false);
});

test('secondary responsible people can find their one shared action by identity and name', () => {
  const action = Object.freeze({ ownerStaffId: 'primary', ownerStaffName: 'First Person',
    responsibleStaffIds: Object.freeze(['primary', 'secondary']), responsibleStaffNames: Object.freeze(['First Person', 'Second Person']) });
  assert.equal(isActionResponsible(action, 'secondary'), true);
  assert.equal(isActionResponsible(action, undefined), false);
  assert.equal(actionResponsibleNames(action), 'First Person; Second Person');
  assert.equal(actionResponsiblePeople(action).length, 2);
  assert.deepEqual(action.responsibleStaffIds, ['primary', 'secondary']);
});

test('duplicate assignments do not duplicate people and an older primary owner remains represented', () => {
  const action = { ownerStaffId: 'primary', ownerStaffName: 'First Person',
    responsibleStaffIds: ['secondary', 'secondary'], responsibleStaffNames: ['Second Person', 'Duplicate'] };
  assert.deepEqual(actionResponsiblePeople(action), [{ id: 'secondary', name: 'Second Person' }, { id: 'primary', name: 'First Person' }]);
});
