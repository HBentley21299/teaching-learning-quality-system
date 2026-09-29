import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QaEvidenceSaveQueue } from '../apps/web/src/services/qaEvidenceSaveQueue.ts';

function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const requests = [], states = [], errors = [], saved = [];
  const queue = new QaEvidenceSaveQueue({
    initial: { text: '', rowVersion: 'v1' },
    send: (value, submit) => { const response = deferred(); requests.push({ value, submit, response }); return response.promise; },
    version: result => result.version,
    changed: (value, dirty, busy, finalizing) => states.push({ value, dirty, busy, finalizing }),
    saved: result => saved.push(result), failed: message => errors.push(message)
  });
  return { queue, requests, states, errors, saved };
}

test('typing during a save is coalesced without lost characters, using the returned row version', async () => {
  const { queue, requests, states } = fixture();
  queue.edit(value => ({ ...value, text: 'A' })); const saving = queue.save(); await tick();
  queue.edit(value => ({ ...value, text: value.text + 'B' }));
  queue.edit(value => ({ ...value, text: value.text + 'C' }));
  assert.equal(requests.length, 1);
  requests[0].response.resolve({ ok: true, data: { version: 'v2' } }); await tick();
  assert.deepEqual(requests[1].value, { text: 'ABC', rowVersion: 'v2' });
  assert.equal(states.at(-1).dirty, true);
  requests[1].response.resolve({ ok: true, data: { version: 'v3' } });
  assert.equal(await saving, true);
  assert.deepEqual(states.at(-1), { value: { text: 'ABC', rowVersion: 'v3' }, dirty: false, busy: false, finalizing: false });
});

test('submit joins the current writer and submits the latest edits with its acknowledged version', async () => {
  const { queue, requests, states } = fixture();
  queue.edit(value => ({ ...value, text: 'first' })); const autosave = queue.save(); await tick();
  queue.edit(value => ({ ...value, text: 'final' })); const submit = queue.save(true);
  queue.edit(value => ({ ...value, text: 'must not edit during submit' }));
  assert.equal(requests.length, 1); assert.equal(states.at(-1).finalizing, true);
  requests[0].response.resolve({ ok: true, data: { version: 'v2' } }); await tick();
  assert.equal(requests[1].submit, true);
  assert.deepEqual(requests[1].value, { text: 'final', rowVersion: 'v2' });
  requests[1].response.resolve({ ok: true, data: { version: 'v3' } });
  assert.equal(await submit, true); assert.equal(await autosave, true);
  assert.equal(requests.length, 2);
});

test('a conflict stops queued submission, retains edits and does not automatically retry', async () => {
  const { queue, requests, states, errors } = fixture();
  queue.edit(value => ({ ...value, text: 'unsaved' })); const pending = queue.save(); await tick();
  const submit = queue.save(true);
  requests[0].response.resolve({ ok: false, message: 'Another editor changed this evidence.' });
  assert.equal(await pending, false); assert.equal(await submit, false); await tick();
  assert.equal(requests.length, 1); assert.deepEqual(errors, ['Another editor changed this evidence.']);
  assert.equal(states.at(-1).value.text, 'unsaved'); assert.equal(states.at(-1).dirty, true);
  assert.equal(states.at(-1).finalizing, false);
});

test('a failed save can be explicitly retried with the retained draft', async () => {
  const { queue, requests } = fixture();
  queue.edit(value => ({ ...value, text: 'keep me' })); const first = queue.save(); await tick();
  requests[0].response.resolve({ ok: false, message: 'Network failed' }); await first;
  const retry = queue.save(); await tick();
  assert.deepEqual(requests[1].value, { text: 'keep me', rowVersion: 'v1' });
  requests[1].response.resolve({ ok: true, data: { version: 'v2' } }); assert.equal(await retry, true);
});

test('disposing an editor suppresses late acknowledgement and further queued writes', async () => {
  const { queue, requests, states, saved } = fixture();
  queue.edit(value => ({ ...value, text: 'A' })); const pending = queue.save(); await tick();
  queue.edit(value => ({ ...value, text: 'AB' })); queue.dispose(); const count = states.length;
  requests[0].response.resolve({ ok: true, data: { version: 'v2' } });
  assert.equal(await pending, false); assert.equal(states.length, count); assert.deepEqual(saved, []); assert.equal(requests.length, 1);
});
