import assert from 'node:assert/strict';
import { test } from 'node:test';
import { statusRowsFromStaff } from '../apps/web/src/services/elevateStatusRoster.ts';

test('named staff cohorts preserve cumulative thresholds and staff with no award', () => {
  const staff = [0, 1, 3, 5].map((currentLevel, index) => ({ staffId: String(index), orgUnitId: 'team-one', currentLevel }));
  const [row] = statusRowsFromStaff(staff);
  assert.deepEqual([row.staffCount, row.level1OrAbove, row.level2OrAbove, row.level3OrAbove, row.level4OrAbove, row.level5OrAbove], [4, 3, 2, 2, 1, 1]);
  const [selected] = statusRowsFromStaff(staff.filter(person => person.currentLevel === 3));
  assert.deepEqual([selected.staffCount, selected.level1OrAbove, selected.level3OrAbove, selected.level4OrAbove], [1, 1, 1, 0]);
});
test('organisation totals retain separate teams and an empty cohort is empty', () => {
  assert.equal(statusRowsFromStaff([{ orgUnitId: 'one', currentLevel: 2 }, { orgUnitId: 'two', currentLevel: 1 }]).length, 2);
  assert.deepEqual(statusRowsFromStaff([]), []);
});
