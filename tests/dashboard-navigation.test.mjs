import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dashboardDescriptions, dashboardLocation, dashboardNavigationGroup, readDashboardLocation } from '../apps/web/src/app/dashboardNavigation.ts';

test('every dashboard has a restorable view and reporting section', () => {
  for (const view of Object.keys(dashboardDescriptions)) for (const section of ['summary', 'data', 'actions', 'coverage']) {
    const path = dashboardLocation(view, section);
    assert.deepEqual(readDashboardLocation(new URL(path, 'http://local.test').search), { view, section });
  }
});
test('invalid dashboard links have a stable safe default', () => {
  for (const key of ['missing', '__proto__', 'constructor']) assert.deepEqual(readDashboardLocation(`?view=${key}&section=unknown`), { view: 'overview', section: 'summary' });
  assert.equal(dashboardLocation('overview'), '/dashboard');
});
test('specialist and staff reporting share a single grouped catalogue', () => {
  assert.equal(dashboardNavigationGroup('uco'), 'Specialist provision');
  assert.equal(dashboardNavigationGroup('als_liv'), 'Specialist provision');
  assert.equal(dashboardNavigationGroup('elevate_status'), 'People & development');
  assert.equal(dashboardNavigationGroup('liv'), 'Teaching & review');
});
