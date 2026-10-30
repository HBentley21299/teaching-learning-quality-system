import assert from 'node:assert/strict';
import { test } from 'node:test';
import { saveProbationActions } from '../apps/web/src/services/saveProbationActions.ts';

const draft = { actionTheme: ' Practice ', title: ' Develop questioning ', ownerStaffId: 'staff-1', dueDate: '2026-11-01' };

function fixture() {
  const calls = [];
  let pending = { ...draft };
  return {
    calls,
    get draft() { return pending; },
    persistence: {
      createAction: async value => { calls.push(['action', value]); return { ok: true }; },
      actionSaved: () => { calls.push(['acknowledged']); pending = undefined; },
      saveStage: async () => { calls.push(['stage']); return { ok: true }; }
    }
  };
}

test('saving an actions stage creates the draft before marking the stage saved', async () => {
  const f = fixture();
  assert.equal((await saveProbationActions(f.draft, f.persistence)).ok, true);
  assert.deepEqual(f.calls, [
    ['action', { ...draft, actionTheme: 'Practice', title: 'Develop questioning' }],
    ['acknowledged'], ['stage']
  ]);
  assert.equal(f.draft, undefined);
});

test('incomplete drafts block stage completion and retain all entered values', async () => {
  for (const field of ['actionTheme', 'title', 'ownerStaffId', 'dueDate']) {
    const f = fixture();
    const incomplete = { ...f.draft, [field]: '' };
    const result = await saveProbationActions(incomplete, f.persistence);
    assert.equal(result.ok, false);
    assert.match(result.message, /Complete the action/);
    assert.deepEqual(f.calls, []);
    assert.deepEqual(incomplete, { ...draft, [field]: '' });
  }
});

test('failed action creation stops stage saving and retains the draft for retry', async () => {
  const f = fixture();
  f.persistence.createAction = async () => ({ ok: false, message: 'Service failed. Support reference: abc123.' });
  assert.deepEqual(await saveProbationActions(f.draft, f.persistence), { ok: false, message: 'Service failed. Support reference: abc123.' });
  assert.deepEqual(f.draft, draft);
  assert.deepEqual(f.calls, []);
  f.persistence.createAction = async value => { f.calls.push(['action', value]); return { ok: true }; };
  assert.equal((await saveProbationActions(f.draft, f.persistence)).ok, true);
  assert.equal(f.calls.filter(([type]) => type === 'action').length, 1);
});

test('retrying a failed stage does not recreate an already saved action', async () => {
  const f = fixture();
  f.persistence.saveStage = async () => { f.calls.push(['failed-stage']); return { ok: false, message: 'Stage failed.' }; };
  const result = await saveProbationActions(f.draft, f.persistence);
  assert.equal(result.ok, false);
  assert.match(result.message, /action was created.*Stage failed/);
  assert.equal(f.draft, undefined);
  f.persistence.saveStage = async () => { f.calls.push(['stage']); return { ok: true }; };
  assert.equal((await saveProbationActions(f.draft, f.persistence)).ok, true);
  assert.deepEqual(f.calls.map(([type]) => type), ['action', 'acknowledged', 'failed-stage', 'stage']);
});

test('creating an action alone does not persist the stage completion checkbox', async () => {
  const f = fixture();
  assert.equal((await saveProbationActions(f.draft, { ...f.persistence, saveStage: undefined })).ok, true);
  assert.deepEqual(f.calls.map(([type]) => type), ['action', 'acknowledged']);
});

test('a stage without a pending action saves without creating an empty action', async () => {
  const f = fixture();
  assert.equal((await saveProbationActions(undefined, f.persistence)).ok, true);
  assert.deepEqual(f.calls, [['stage']]);
});
