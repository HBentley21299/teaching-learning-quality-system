import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareListValues, distinctListValues, matchesListSearch, sortListRows } from '../apps/web/src/services/listQuery.ts';

test('sorts natural codes, numbers and dates while missing values stay last in both directions', () => {
  assert.ok(compareListValues('Room 2', 'Room 10') < 0);
  assert.ok(compareListValues(2, 10) < 0);
  assert.ok(compareListValues(new Date('2026-09-30'), new Date('2026-10-01')) < 0);
  for (const direction of ['asc','desc']) {
    assert.ok(compareListValues(null, 'Known', direction) > 0);
    assert.ok(compareListValues(new Date('invalid'), new Date(), direction) > 0);
  }
});
test('sorting is stable, preserves the source and can break ties by identity', () => {
  const rows = [{ id:'b', value:2 }, { id:'a', value:2 }, { id:'c', value:1 }];
  assert.deepEqual(sortListRows(rows, row => row.value, 'asc', row => row.id).map(row => row.id), ['c','a','b']);
  assert.deepEqual(rows.map(row => row.id), ['b','a','c']);
});
test('multi-term search spans people, codes and associated data with accent-insensitive matching', () => {
  assert.ok(matchesListSearch('zoe assessment TEAM2', 'Zoë Jones', ['Assessment feedback'], { team:'TEAM2' }));
  assert.ok(!matchesListSearch('zoe safeguarding', 'Zoë Jones', ['Assessment feedback']));
  assert.deepEqual(distinctListValues(['Room 10','Room 2','room 2','',null]), ['room 2','Room 10']);
});
