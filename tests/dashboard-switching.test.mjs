import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';
const web = createRequire(new URL('../apps/web/package.json', import.meta.url)), ts = web('typescript'), jsx = web('react/jsx-runtime');
async function load(path, modules = {}, extra = '') {
  const source = await readFile(new URL(`../apps/web/src/${path}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source + extra, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'exports', 'module', code)(name => modules[name] ?? new Proxy({}, { get: () => () => null }), module.exports, module);
  return module.exports;
}
const dependencies = {};
dependencies['../components/LoadingState'] = await load('components/LoadingState.tsx', { 'react/jsx-runtime': jsx });
for (const [name, path] of Object.entries({
  '../services/latestDashboardLoad': 'services/latestDashboardLoad.ts', '../services/dashboardRequestCache': 'services/dashboardRequestCache.ts',
  '../services/listQuery': 'services/listQuery.ts', '../app/dashboardNavigation': 'app/dashboardNavigation.ts',
  '../services/elevateStatusRoster': 'services/elevateStatusRoster.ts', '../services/dashboardActionState': 'services/dashboardActionState.ts',
  '../services/formOutcomeGroups': 'services/formOutcomeGroups.ts', '../services/apiHttpError': 'services/apiHttpError.ts',
  '../services/processReviewAccess': 'services/processReviewAccess.ts',
  '../services/dashboardFacultySelection': 'services/dashboardFacultySelection.ts', '../services/cpdDashboardScope': 'services/cpdDashboardScope.ts',
  '../services/dashboardOrgVisibility': 'services/dashboardOrgVisibility.ts', './learningWalkDeliveryAreas': 'routes/learningWalkDeliveryAreas.ts'
})) dependencies[name] = await load(path);
const tick = () => new Promise(resolve => setImmediate(resolve));
const keys = ['overview', 'liv', 'cpd_event', 'elevate_status', 'eli'];
const configuration = { schemaVersion: 2, processes: keys.map((processKey, index) => ({ processKey, label: processKey, isEnabled: true, displayOrder: index, primaryVisual: 'bar', showTrend: true, showAreaComparison: true, showOutcomes: true, showActions: true })) };
const user = { userAccountId: 'account-a', staffId: 'staff-a', isAdministrator: true, permissions: ['reports.view_all', 'exports.create'], scopes: [] };
const record = processKey => ({ id: `${processKey}-saved`, processKey, title: `${processKey} record`, status: 'submitted', createdAt: '2026-10-01T00:00:00Z', recordDate: '2026-10-01', participantCount: 0, attendanceCredits: 0, learningMinutes: 0, sampleSize: 0, scoreTotal: 0, scoreCount: 0, barrierCount: 0 });
async function workspace({ initial = 'liv', responses = {}, initialUser = user } = {}) {
  globalThis.window = { location: { search: `?view=${initial}` } };
  let cursor = 0, renderNeeded = true, tree, activeComponent, props = { academicYear: '2026/27', orgUnits: [], ucoAccess: null, user: initialUser, onOpenAction() {}, onOpenRecord() {}, onOpenStaff() {}, onOpenUcoReview() {} };
  const slots = [], effects = [], calls = [];
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[index].value, next => { const value = typeof next === 'function' ? next(slots[index].value) : next; if (!Object.is(value, slots[index].value)) { slots[index].value = value; renderNeeded = true; } }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useMemo(factory, deps) { const index = cursor++, previous = slots[index]; if (!previous || deps.some((value, offset) => !Object.is(value, previous.deps[offset]))) slots[index] = { deps, value: factory() }; return slots[index].value; },
    useCallback(callback, deps) { return hooks.useMemo(() => callback, deps); },
    useEffect(effect, deps) { const index = cursor++, previous = slots[index]; if (!previous || deps.some((value, offset) => !Object.is(value, previous.deps[offset]))) { slots[index] = { deps }; effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = effect(); }); } }
  };
  const api = new Proxy({}, { get: (_, method) => (...args) => { calls.push([method, ...args]); return Promise.resolve().then(() => method in responses ? responses[method](...args) : method === 'dashboardConfiguration' ? configuration : method === 'processDashboardRecords' ? [record(args[1])] : []); } });
  const DashboardNavigator = () => null, Button = () => null, DashboardReportButton = () => null, ProcessReviewDashboard = () => null;
  const exports = await load('routes/Dashboard.tsx', { ...dependencies, react: hooks, 'react/jsx-runtime': jsx, '../services/api': { api }, '../components/DashboardNavigator': { DashboardNavigator }, '../components/ExportButtons': { DashboardReportButton }, '../design-system/Button': { Button }, './ProcessReviewDashboard': { ProcessReviewDashboard } }, '\nexport { collectDashboardOrgOptions, OrganisationPerformance, ElevateStatusOrganisationView };');
  function nodes() { const result = []; function walk(node) { if (Array.isArray(node)) return node.forEach(walk); if (!node || typeof node !== 'object') return; result.push(node); walk(node.props?.children); } walk(tree); return result; }
  function render() { cursor = 0; renderNeeded = false; tree = (activeComponent ?? exports.Dashboard)(props); }
  async function settle() { for (let i = 0; i < 40; i++) { if (renderNeeded) render(); while (effects.length) effects.shift()(); await tick(); if (!renderNeeded && !effects.length) return; } throw new Error('Dashboard did not settle'); }
  await settle();
  return { calls, nodes, settle, exports,
    async select(key) { nodes().find(node => node.type === DashboardNavigator).props.onSelect(key); await settle(); },
    async refresh() { const node = nodes().find(node => node.type === Button && node.props.icon); assert.ok(node); node.props.onClick(); await settle(); },
    async rerender(next) { props = { ...props, ...next }; renderNeeded = true; await settle(); },
    async useComponent(name, next) { slots.splice(0); effects.splice(0); activeComponent = exports[name]; props = next; renderNeeded = true; await settle(); },
    async change(label, value) { const node = nodes().find(node => node.props?.['aria-label'] === label); assert.ok(node, `Missing ${label}`); node.props.onChange({ target: { value } }); await settle(); },
    currentRecords: () => nodes().find(node => node.props?.definition)?.props.records ?? [],
    hasExport: () => nodes().some(node => node.type === DashboardReportButton),
    nativeReview: () => nodes().find(node => node.type === ProcessReviewDashboard)?.props,
    destinations: () => nodes().find(node => node.type === DashboardNavigator)?.props.items ?? []
  };
}

test('switching reuses shared settings/coverage and returning to a valid dashboard makes zero duplicate dataset requests', async () => {
  const page = await workspace();
  assert.equal(page.calls.length, 7, 'LIV initial load includes settings, records, outcomes, actions, coverage and journey plus faculty selections');
  await page.select('cpd_event');
  assert.equal(page.calls.length, 11, 'new CPD process loads only its three process datasets and attendance');
  await page.select('liv'); assert.equal(page.calls.length, 11);
  assert.deepEqual(page.currentRecords().map(row => row.id), ['liv-saved']);
  await page.refresh(); assert.equal(page.calls.length, 18, 'explicit Refresh reloads every LIV dataset and faculty settings');
});

test('view-only reporting roles can inspect data without being offered forbidden export actions', async () => {
  const page = await workspace({ initialUser: { ...user, isAdministrator: false, permissions: ['reports.view_all'] } });
  assert.equal(page.hasExport(), false);
  assert.equal(page.currentRecords().length, 1);
  assert.ok(page.nodes().some(node => node.props?.['aria-label'] === 'Report sections'));
  await page.rerender({ user });
  assert.equal(page.hasExport(), true);
});

test('dashboard shows one scoped loading illustration until reporting data is verified and export becomes available', async () => {
  let resolve;
  const pending = new Promise(yes => { resolve = yes; });
  const page = await workspace({ responses: { processDashboardRecords: () => pending } });
  const Loader = dependencies['../components/LoadingState'].LoadingState;
  assert.deepEqual(page.nodes().filter(node => node.type === Loader).map(node => node.props.label), ['Loading reporting data']);
  assert.equal(page.hasExport(), false); assert.deepEqual(page.currentRecords(), []);
  assert.equal(page.nodes().find(node => node.props?.className?.includes('intelligence-data-state')).props.role, undefined, 'header badge must not duplicate the pending status announcement');
  resolve([record('liv')]); await page.settle();
  assert.equal(page.nodes().filter(node => node.type === Loader).length, 0);
  assert.equal(page.hasExport(), true); assert.equal(page.currentRecords().length, 1);
});

test('report filters disclose secondary controls with active counts and invalid date ranges hide results and exports until corrected', async () => {
  const page = await workspace();
  let more = page.nodes().find(node => node.type === 'details' && node.props.className === 'reporting-scope-more');
  assert.ok(more); assert.equal(more.props.open, undefined, 'advanced filters begin closed');
  assert.equal(page.hasExport(), true);
  await page.change('Report start date', '2026-10-29');
  await page.change('Report end date', '2026-09-01');
  assert.equal(page.hasExport(), false);
  assert.equal(page.nodes().find(node => node.props?.className === 'reporting-results').props.hidden, true);
  assert.ok(page.nodes().some(node => node.props?.id === 'report-date-error'));
  assert.equal(page.nodes().find(node => node.props?.['aria-label'] === 'Report start date').props['aria-invalid'], true);
  const reset = page.nodes().find(node => node.props?.children === 'Clear dates');
  assert.ok(reset); reset.props.onClick(); await page.settle();
  assert.equal(page.hasExport(), true);
  assert.equal(page.nodes().find(node => node.props?.className === 'reporting-results').props.hidden, false);
});

test('faculty comparisons sort names/counts/percentages and attention filters without omitting historical areas', async () => {
  const page = await workspace();
  const base = { recordCount: 1, completedCount: 1, ratingTotal: 0, ratingCount: 0, secureOrAboveCount: 0, activeStaffCount: 10, participatingStaffCount: 5, openActionCount: 0, overdueActionCount: 0, livRequestedCount: 0, livVisitedCount: 0 };
  await page.useComponent('OrganisationPerformance', { processKey: 'eli', facultyNames: new Map(), onOpenDetail() {}, rows: [
    { ...base, code: 'A', name: 'Archived area', openActionCount: 10, overdueActionCount: 2 },
    { ...base, code: 'B', name: 'Current area', openActionCount: 2 }
  ] });
  const faculties = () => page.nodes().filter(node => node.props?.isFaculty && node.props.row).map(node => node.props.row.code);
  await page.change('Sort faculty performance by', 'openActionCount'); await page.change('Faculty performance sort order', 'desc');
  assert.deepEqual(faculties(), ['A', 'B']);
  await page.change('Faculty performance attention', 'overdue'); assert.deepEqual(faculties(), ['A']);
  await page.useComponent('ElevateStatusOrganisationView', { facultyNames: new Map(), rows: [
    { areaCode: 'A', areaName: 'Archived area', staffCount: 10, level1OrAbove: 2, level2OrAbove: 1 },
    { areaCode: 'B', areaName: 'Current area', staffCount: 100, level1OrAbove: 10, level2OrAbove: 2 }
  ] });
  const statusFaculties = () => page.nodes().filter(node => node.props?.isFaculty && node.props.row).map(node => node.props.row.areaCode);
  await page.change('Sort Elevate faculty results by', 'rate-1'); await page.change('Elevate faculty sort order', 'desc');
  assert.deepEqual(statusFaculties(), ['A', 'B'], 'percentage sort uses each faculty denominator rather than raw award count');
});

test('Elevate Status does not load irrelevant submitted-records, dimensions or actions', async () => {
  const page = await workspace({ initial: 'elevate_status' });
  assert.deepEqual(page.calls.map(call => call[0]).sort(), ['dashboardConfiguration', 'dashboardFacultySelections', 'elevateStatusBadgeAssets', 'elevateStatusDashboard', 'elevateStatusStaffDashboard'].sort());
});

test('per-dashboard faculty exclusions also constrain annual coverage and CPD attendee summaries', async () => {
  const page = await workspace({ initial: 'cpd_event', responses: {
    dashboardFacultySelections: () => [{ dashboardKey: 'cpd_event', excludedFacultyIds: ['excluded'] }],
    staffParticipationDashboard: () => [
      { processKey: 'cpd_event', orgUnitId: 'excluded', areaCode: 'EX', activeStaffCount: 100, participatingStaffCount: 100 },
      { processKey: 'cpd_event', orgUnitId: 'included', areaCode: 'IN', activeStaffCount: 2, participatingStaffCount: 1 }
    ],
    cpdAttendanceDashboard: () => [{ staffId: 'outside', orgUnitId: 'excluded', areaCode: 'EX' }, { staffId: 'inside', orgUnitId: 'included', areaCode: 'IN' }]
  } });
  await page.rerender({ orgUnits: [{ id: 'excluded', code: 'EX', name: 'Excluded', orgUnitType: 'faculty', isActive: true, includeInDashboards: true }, { id: 'included', code: 'IN', name: 'Included', orgUnitType: 'faculty', isActive: true, includeInDashboards: true }] });
  const view = page.nodes().find(node => node.props?.definition);
  assert.equal(view.props.staffParticipation.activeStaffCount, 2);
  assert.deepEqual(view.props.cpdAttendance.map(row => row.staffId), ['inside']);
});

test('permission/account/year changes fetch new scoped data and a failed process never reveals previous records or an export', async () => {
  const page = await workspace({ responses: { processDashboardRecords: (_year, process) => { if (process === 'cpd_event') throw new Error('unavailable'); return [record(process)]; } } });
  await page.select('cpd_event'); assert.equal(page.hasExport(), false); assert.deepEqual(page.currentRecords(), []);
  await page.select('liv'); const before = page.calls.length;
  await page.rerender({ user: { ...user, userAccountId: 'account-b' } }); assert.ok(page.calls.length > before);
  const accountCount = page.calls.length;
  await page.rerender({ academicYear: '2025/26' }); assert.ok(page.calls.length > accountCount);
});

test('historical inactive organisation choices remain selectable only when represented in permitted data and dashboard inclusion allows them', async () => {
  const page = await workspace();
  const units = [
    { id: 'faculty', code: 'FAC', name: 'Faculty', orgUnitType: 'faculty', isActive: true, includeInDashboards: true },
    { id: 'old', code: 'OLD', name: 'Retired team', orgUnitType: 'team', parentOrgUnitId: 'faculty', isActive: false, includeInDashboards: true },
    { id: 'unrecorded', code: 'UNUSED', name: 'Unused retired team', orgUnitType: 'team', parentOrgUnitId: 'faculty', isActive: false, includeInDashboards: true },
    { id: 'hidden', code: 'HIDDEN', name: 'Excluded team', orgUnitType: 'team', parentOrgUnitId: 'faculty', isActive: false, includeInDashboards: false }
  ];
  const options = page.exports.collectDashboardOrgOptions(units, user, [{ orgUnitId: 'old', areaCode: 'OLD', parentAreaCode: 'FAC' }, { orgUnitId: 'hidden', areaCode: 'HIDDEN', parentAreaCode: 'FAC' }]);
  assert.deepEqual(options.teams.map(row => row.code), ['OLD']);
});

test('Digital reporting deep links use its scoped register without requesting unrelated leadership data', async () => {
  const page = await workspace({ initial: 'digital_learning_walk', initialUser: { ...user, isAdministrator: false, permissions: ['digital_learning_walk.view_scoped'] } });
  assert.equal(page.nativeReview()?.processKey, 'digital_learning_walk');
  assert.equal(page.nativeReview()?.academicYear, '2026/27');
  assert.deepEqual(page.destinations().map(item => item.key), ['digital_learning_walk']);
  assert.deepEqual(page.calls, [], 'the native reporting component owns its dataset requests');
});

test('Activate and Digital share the switcher without reusing another process component or generic datasets', async () => {
  const page = await workspace({ initial: 'activate_growth_review', initialUser: { ...user, permissions: ['digital_learning_walk.view_scoped', 'activate_growth_review.view_scoped'] } });
  assert.equal(page.nativeReview()?.processKey, 'activate_growth_review');
  await page.select('digital_learning_walk');
  assert.equal(page.nativeReview()?.processKey, 'digital_learning_walk');
  assert.deepEqual(page.calls, []);
  await page.rerender({ user: { ...user, permissions: ['activate_growth_review.view_scoped'] } });
  assert.equal(page.nativeReview()?.processKey, 'activate_growth_review');
  assert.deepEqual(page.destinations().map(item => item.key), ['activate_growth_review']);
});
