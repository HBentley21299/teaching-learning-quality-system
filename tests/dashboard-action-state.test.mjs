import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const requireWeb = createRequire(new URL('../apps/web/package.json', import.meta.url));
const ts = requireWeb('typescript'), jsxRuntime = requireWeb('react/jsx-runtime');
const { renderToStaticMarkup } = requireWeb('react-dom/server');

async function load(path, modules = {}, extra = '') {
  const source = await readFile(new URL(`../apps/web/src/${path}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source + extra, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'exports', 'module', code)(name => modules[name] ?? new Proxy({}, { get: () => () => null }), module.exports, module);
  return module.exports;
}

const state = await load('services/dashboardActionState.ts');
const { DataTable } = await load('components/DataTable.tsx', {
  'react/jsx-runtime': jsxRuntime,
  './ScrollableTableRegion': { ScrollableTableRegion: ({ children }) => jsxRuntime.jsx('div', { children }) }
});
// Exercise the real private rendering and aggregation paths without loading the Dashboard route's network effects.
const dashboard = await load('routes/Dashboard.tsx', {
  'react/jsx-runtime': jsxRuntime,
  '../services/dashboardActionState': state,
  '../components/DataTable': { DataTable }
}, '\nexport { ActionDetailTable, ActionRecords, buildActionPosition, buildProcessMetrics, buildOrganisationPerformanceRows };');

const base = { sourceFormType: 'cpd', sourceRecordId: 'event1', ownerStaffId: 'staff-owner', ownerStaffName: 'Avery Owner', actionTheme: 'Inclusive teaching', facultyCode: 'FAC', teamCode: 'TEAM', createdAt: '2026-10-01T10:00:00Z', isDeleted: false };
const actions = [
  { ...base, id: 'cancelled', title: 'Cancelled action', statusKey: 'cancelled', isOverdue: true, dueDate: '2026-10-05' },
  { ...base, id: 'cancelled-complete-date', title: 'Cancelled action retaining a historic date', statusKey: 'cancelled', completedDate: '2026-10-04', isOverdue: false, dueDate: '2026-10-05' },
  { ...base, id: 'complete-no-date', title: 'Completed without date', statusKey: 'complete', isOverdue: true, dueDate: '2026-10-05' },
  { ...base, id: 'complete-with-date', title: 'Completed with date', statusKey: 'open', completedDate: '2026-10-04', isOverdue: true, dueDate: '2026-10-05' },
  { ...base, id: 'overdue', title: 'Still overdue', statusKey: 'open', isOverdue: true, dueDate: '2026-10-05' },
  { ...base, id: 'open', title: 'Still open', statusKey: 'in_progress', isOverdue: false, dueDate: '2099-10-05' }
];

test('all dashboard action filters use cancellation then completion before overdue/open state', () => {
  assert.deepEqual(state.dashboardActionStates, ['open', 'overdue', 'complete', 'cancelled']);
  assert.deepEqual(actions.map(state.dashboardActionState), ['cancelled', 'cancelled', 'complete', 'complete', 'overdue', 'open']);
  const filter = key => actions.filter(action => state.matchesDashboardActionState(action, key)).map(action => action.id);
  assert.deepEqual(filter('open'), ['open']); assert.deepEqual(filter('overdue'), ['overdue']);
  assert.deepEqual(filter('complete'), ['complete-no-date', 'complete-with-date']);
  assert.deepEqual(filter('cancelled'), ['cancelled', 'cancelled-complete-date']);
  assert.equal(filter('all').length, 6);
});

test('main metrics, organisation counts and assurance exclude cancelled and undated-complete actions from open totals', () => {
  const metrics = dashboard.buildProcessMetrics('actions', [], [], actions, undefined, {});
  assert.equal(metrics.find(metric => metric.label === 'Open actions').value, 2);
  assert.equal(metrics.find(metric => metric.label === 'Overdue').value, 1);
  assert.match(metrics.find(metric => metric.label === 'Actions raised').detail, /2 completed/);
  const [organisation] = dashboard.buildOrganisationPerformanceRows([], [], actions, [], []);
  assert.equal(organisation.openActionCount, 2); assert.equal(organisation.overdueActionCount, 1);
  const position = dashboard.buildActionPosition(actions);
  assert.equal(position.total, 4); assert.equal(position.completed, 2); assert.equal(position.inProgress, 1); assert.equal(position.overdue, 1); assert.equal(position.completionRate, 50);
});

test('completed actions without completion dates do not establish compliance and are disclosed', () => {
  const position = dashboard.buildActionPosition(actions);
  assert.equal(position.missingCompletionDates, 1); assert.equal(position.dueDated, 3); assert.equal(position.compliantDueDated, 2); assert.equal(position.dueDateCompliance, 66.7);
  const markup = renderToStaticMarkup(dashboard.ActionRecords({ actions }));
  assert.match(markup, /Completion date not recorded: 1/); assert.match(markup, /2 of 3 within deadline/);
});

test('linked-action table labels and risk styling use the same state as filters and counts', () => {
  const markup = renderToStaticMarkup(dashboard.ActionDetailTable({ actions, onOpenAction() {} }));
  const rows = [...markup.matchAll(/<tr>[\s\S]*?<\/tr>/g)].map(match => match[0]).slice(1);
  assert.equal(rows.length, 6);
  for (const row of rows.slice(0, 2)) { assert.match(row, />Cancelled<\/span>/); assert.doesNotMatch(row, /status-risk/); }
  for (const row of rows.slice(2, 4)) { assert.match(row, />Complete<\/span>/); assert.doesNotMatch(row, /status-risk/); }
  assert.match(rows[4], /status-risk[^>]*>Overdue<\/span>/); assert.match(rows[5], />Open<\/span>/);
});
