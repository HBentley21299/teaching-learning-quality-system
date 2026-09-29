import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accessibleAdminSections, adminSections, resolveAdminSectionKey } from '../apps/web/src/app/adminNavigation.ts';

const keys = (permissions) => accessibleAdminSections(permissions).map((section) => section.key);

test('ordinary staff cannot enter the admin directory', () => {
  assert.deepEqual(keys(['cpd.self_log']), []);
});
test('list managers can find rooms and themes without seeing account editors', () => {
  const visible = keys(['lists.manage']);
  for (const key of ['overview', 'forms', 'rooms', 'system']) assert.ok(visible.includes(key));
  for (const key of ['staff-details', 'staff-access', 'roles', 'records', 'badges']) assert.ok(!visible.includes(key));
});
test('specialised correction screen requires all permissions used by its API calls', () => {
  assert.ok(!keys(['records.manage']).includes('work-scrutiny'));
  assert.ok(!keys(['users.manage']).includes('work-scrutiny'));
  assert.ok(keys(['records.manage', 'users.manage']).includes('work-scrutiny'));
});
test('badge managers get a focused admin directory', () => {
  assert.deepEqual(keys(['elevate_status.manage']), ['overview', 'badges', 'system']);
});
test('all sections have unique deep links and are reachable with their permissions', () => {
  assert.equal(new Set(adminSections.map((section) => section.key)).size, adminSections.length);
  assert.equal(keys(adminSections.flatMap((section) => section.permissions)).length, adminSections.length);
});

test('old form setting links resolve to the unified editor', () => {
  for (const key of ['lists', 'qa-reviews', 'themes', 'als-themes', 'als-liv', 'coaching']) assert.equal(resolveAdminSectionKey(key), 'forms');
  assert.equal(resolveAdminSectionKey('rooms'), 'rooms');
});
test('QA-only managers can open the form editor', () => {
  assert.deepEqual(keys(['qa_reviews.manage']), ['overview', 'forms', 'system']);
});
