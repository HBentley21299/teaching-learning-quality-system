import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changeLivStageVisibility, isMyLivRecord, livCompletionOptions } from '../apps/web/src/services/livWorkflow.ts';
import { canAccessRoute } from '../apps/web/src/app/navigation.ts';

test('staff can reach LIV and ALS LIV without gaining unrelated management routes', () => {
  const permissions = ['cpd.self_log'];
  assert.equal(canAccessRoute('liv', permissions), true);
  assert.equal(canAccessRoute('als_liv', permissions), true);
  for (const route of ['admin', 'probation', 'learning', 'als_learning']) assert.equal(canAccessRoute(route, permissions), false);
});

test('My LIV records includes reviews of the staff member as well as reviews they created', () => {
  const records = [
    { subjectStaffId: 'me', isCreatedByCurrentUser: false },
    { subjectStaffId: 'someone-else', isCreatedByCurrentUser: true },
    { subjectStaffId: 'someone-else', isCreatedByCurrentUser: false }
  ];
  assert.deepEqual(records.filter(record => isMyLivRecord(record, 'me')), records.slice(0, 2));
  assert.equal(isMyLivRecord(records[0], undefined), false);
});

test('first LIV cycle always opens cycle 2, including a probation-linked LIV', () => {
  for (const isProbation of [false, true]) {
    const options = livCompletionOptions(1, isProbation, 'LIV');
    assert.equal(options.length, 1);
    assert.equal(options[0].openFollowUp, true);
    assert.match(options[0].label, /open cycle 2/);
    if (isProbation) assert.match(options[0].confirmation, /Observation 2 will remain in progress/);
  }
});

test('cycle 2 onwards can close or continue LIV, completing probation only on close', () => {
  for (const cycle of [2, 3]) {
    const options = livCompletionOptions(cycle, true, 'LIV');
    assert.equal(options.length, 2);
    assert.equal(options[0].openFollowUp, true);
    assert.match(options[0].successMessage, /Observation 2 remains in progress/);
    assert.equal(options[1].openFollowUp, false);
    assert.equal(options[1].label, 'Complete Probation Observation 2');
    assert.match(options[1].successMessage, /Observation 3 is ready/);
  }
  assert.match(livCompletionOptions(2, false, 'ALS LIV')[1].confirmation, /close the ALS LIV/);
});

test('cancelling a visibility confirmation never sends a save or changes the setting', async () => {
  let called = false;
  let confirmation = '';
  const result = await changeLivStageVisibility({
    visibleToStaff: true, sectionLabel: 'LIV Visit', staffName: 'Alex',
    confirm: message => { confirmation = message; return false; },
    save: async () => { called = true; return { ok: true }; }
  });
  assert.deepEqual(result, { ok: false, cancelled: true });
  assert.equal(called, false);
  assert.match(confirmation, /Make LIV Visit visible to Alex/);
  assert.match(confirmation, /Unsaved edits will only be shared after you save them/);
});

test('visibility save targets the requested setting and preserves API rejection details', async () => {
  for (const visibleToStaff of [true, false]) {
    let saved;
    const result = await changeLivStageVisibility({
      visibleToStaff, sectionLabel: 'Actions', staffName: 'Alex', confirm: () => true,
      save: async value => { saved = value; return { ok: false, message: 'Only the review owner can change visibility.' }; }
    });
    assert.equal(saved, visibleToStaff);
    assert.equal(result.ok, false);
    assert.match(result.message, /Only the review owner/);
  }
});

test('failed and successful visibility requests produce distinct outcomes for the switch', async () => {
  const options = { visibleToStaff: true, sectionLabel: 'Professional Discussion', staffName: 'Alex', confirm: () => true };
  const failure = await changeLivStageVisibility({ ...options, save: async () => { throw new Error('Connection lost'); } });
  assert.equal(failure.ok, false);
  assert.match(failure.message, /Visibility could not be updated/);
  const success = await changeLivStageVisibility({ ...options, save: async () => ({ ok: true }) });
  assert.deepEqual(success, { ok: true });
});
