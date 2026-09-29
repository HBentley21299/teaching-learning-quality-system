import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LatestDashboardLoad } from '../apps/web/src/services/latestDashboardLoad.ts';

function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test('a late prior-year batch cannot replace the newly selected year', async () => {
  const loader = new LatestDashboardLoad();
  const old = deferred(); const values = [];
  loader.setScope('2025/26:eli');
  const obsolete = loader.run([{ key: 'coverage', load: () => old.promise, apply: value => values.push(value) }]);
  loader.setScope('2026/27:eli');
  assert.deepEqual(await loader.run([{ key: 'coverage', load: async () => 26, apply: value => values.push(value) }]), []);
  old.resolve(25);
  assert.equal(await obsolete, null);
  assert.deepEqual(values, [26]);
});

test('a slower refresh of the same view cannot overwrite a later refresh', async () => {
  const loader = new LatestDashboardLoad(); const old = deferred(); const values = [];
  loader.setScope('year:liv');
  const previous = loader.run([{ key: 'journey', load: () => old.promise, apply: value => values.push(value) }]);
  await loader.run([{ key: 'journey', load: async () => 'current', apply: value => values.push(value) }]);
  old.resolve('stale'); await previous;
  assert.deepEqual(values, ['current']);
});

test('independent requests start together; failures remain explicit and never apply empty fallback data', async () => {
  const loader = new LatestDashboardLoad(); const first = deferred(); const second = deferred();
  const started = []; const applied = [];
  const result = loader.run([
    { key: 'records', load: () => { started.push('records'); return first.promise; }, apply: value => applied.push(value) },
    { key: 'outcomes', load: () => { started.push('outcomes'); return second.promise; }, apply: value => applied.push(value) }
  ]);
  await Promise.resolve(); assert.deepEqual(started, ['records', 'outcomes']);
  first.resolve([]); second.reject(new Error('offline'));
  assert.deepEqual(await result, ['outcomes']); assert.deepEqual(applied, [[]]);
});

test('unmount invalidates pending work without applying it', async () => {
  const loader = new LatestDashboardLoad(); const request = deferred(); let applied = false;
  const pending = loader.run([{ key: 'records', load: () => request.promise, apply: () => { applied = true; } }]);
  loader.invalidate(); request.resolve([1]);
  assert.equal(await pending, null); assert.equal(applied, false);
});
