import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DashboardRequestCache } from '../apps/web/src/services/dashboardRequestCache.ts';

test('report requests reuse successful and pending scoped results until their short lifetime ends', async () => {
  let now = 10, calls = 0, finish;
  const cache = new DashboardRequestCache(4, 60, () => now);
  const load = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  const first = cache.get('year:user:permissions:process', load), second = cache.get('year:user:permissions:process', load);
  assert.equal(first, second); await Promise.resolve(); assert.equal(calls, 1);
  finish(['saved']); assert.deepEqual(await first, ['saved']);
  assert.deepEqual(await cache.get('year:user:permissions:process', load), ['saved']); assert.equal(calls, 1);
  now = 71; const renewed = cache.get('year:user:permissions:process', async () => { calls++; return ['new']; });
  assert.deepEqual(await renewed, ['new']); assert.equal(calls, 2);
});

test('account, year, permission and process keys remain separate; Refresh discards even a pending cache entry', async () => {
  const cache = new DashboardRequestCache(); let finish;
  const pending = cache.get('old-scope', () => new Promise(resolve => { finish = resolve; }));
  await Promise.resolve(); cache.clear();
  assert.equal(await cache.get('old-scope', async () => 'refreshed'), 'refreshed');
  finish('obsolete'); await pending;
  assert.equal(await cache.get('old-scope', async () => 'wrong'), 'refreshed');
  for (const scope of ['new-account', 'new-permission', 'new-year', 'new-process']) assert.equal(await cache.get(scope, async () => scope), scope);
});

test('failed results are never cached as zero or silently reused, and the cache has a bounded capacity', async () => {
  const cache = new DashboardRequestCache(2);
  await assert.rejects(cache.get('failed', async () => { throw new Error('unavailable'); }), /unavailable/);
  assert.equal(await cache.get('failed', async () => 'recovered'), 'recovered');
  await cache.get('second', async () => 2); await cache.get('third', async () => 3);
  assert.equal(await cache.get('failed', async () => 'reloaded after eviction'), 'reloaded after eviction');
});
