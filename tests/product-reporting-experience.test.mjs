import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const web = createRequire(new URL('../apps/web/package.json', import.meta.url));
const ts = web('typescript'), react = web('react'), jsx = web('react/jsx-runtime');
const { renderToStaticMarkup } = web('react-dom/server');
async function load(path, modules = {}, extra = '') {
  const source = await readFile(new URL(`../apps/web/src/${path}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source + extra, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'exports', 'module', code)(name => modules[name] ?? new Proxy({}, { get: () => () => null }), module.exports, module);
  return module.exports;
}
const listQuery = await load('services/listQuery.ts');
const actionState = await load('services/dashboardActionState.ts');
const formOutcomes = await load('services/formOutcomeGroups.ts');
const deliveryAreas = await load('routes/learningWalkDeliveryAreas.ts');
const ScrollableTableRegion = ({ children, label, className }) => react.createElement('div', { className, 'aria-label': label }, children);
const CollapsibleSection = ({ children, title }) => react.createElement('section', { 'aria-label': title }, children);
const { TrendChart, RankedBars, DonutChart, MetricCard, buildAdaptiveTrend, ProcessOverview, OutcomeDrilldown } = await load('routes/Dashboard.tsx', {
  react, 'react/jsx-runtime': jsx, 'lucide-react': new Proxy({}, { get: () => () => null }),
  '../services/listQuery': listQuery, '../services/dashboardActionState': actionState,
  '../services/formOutcomeGroups': formOutcomes, './learningWalkDeliveryAreas': deliveryAreas,
  '../components/ScrollableTableRegion': { ScrollableTableRegion }, '../components/CollapsibleSection': { CollapsibleSection },
}, '\nexport { TrendChart, RankedBars, DonutChart, MetricCard, buildAdaptiveTrend, ProcessOverview, OutcomeDrilldown };');

function markup(Component, props) { return renderToStaticMarkup(react.createElement(Component, props)); }
function allNodes(node, result = []) { if (Array.isArray(node)) node.forEach(child => allNodes(child, result)); else if (node && typeof node === 'object') { result.push(node); allNodes(node.props?.children, result); } return result; }

test('full-year trends retain every month and exact values, with a bounded readable axis', () => {
  const items = Array.from({ length: 12 }, (_, index) => ({ date: `2026-${String(index + 1).padStart(2, '0')}-10` }));
  const data = buildAdaptiveTrend(items, 'month', '', '');
  assert.equal(data.length, 12, 'the first two months must not silently disappear');
  const tree = TrendChart({ title: 'Activity over time', subtitle: 'Monthly records', data });
  const nodes = allNodes(tree), axis = nodes.find(node => node.props?.className?.includes('reporting-trend-axis'));
  assert.ok(axis); assert.equal(axis.props.children.length, 3);
  const html = renderToStaticMarkup(tree);
  assert.match(html, /12 periods/); assert.match(html, /View chart data/);
  assert.equal((html.match(/<tbody><tr>/g) ?? []).length, 1);
  assert.equal((html.split('<tbody>')[1].split('</tbody>')[0].match(/<tr>/g) ?? []).length, 12);
  assert.doesNotMatch(html, /linearGradient|NaN|Infinity/);
});

test('daily trends expose all 31 exact periods without requiring a pointer and avoid duplicate numeric ticks for one record', () => {
  const data = Array.from({ length: 31 }, (_, index) => ({ label: `${index + 1} Oct`, value: index % 2 }));
  const tree = TrendChart({ title: 'Daily activity', subtitle: 'October', data }), nodes = allNodes(tree);
  const ticks = nodes.filter(node => node.type === 'text').map(node => node.props.children);
  assert.deepEqual(ticks, ['0', '1']);
  const html = renderToStaticMarkup(tree);
  assert.equal((html.split('<tbody>')[1].split('</tbody>')[0].match(/<tr>/g) ?? []).length, 31);
  assert.match(html, /31 Oct/);
  assert.match(markup(TrendChart, { title: 'Empty', subtitle: '', data: [] }), /No data in the current view/);
});

test('zero counts draw no bar and zero-response donuts never divide by zero', () => {
  const bars = allNodes(RankedBars({ title: 'Process mix', subtitle: '', data: [{ label: 'Empty process', value: 0 }, { label: 'Recorded process', value: 10 }] }));
  const widths = bars.filter(node => node.type === 'i').map(node => node.props.style.width);
  assert.deepEqual(widths, ['0%', '100%']);
  const html = markup(DonutChart, { title: 'Outcomes', subtitle: '', data: [{ label: 'No response yet', value: 0 }] });
  assert.doesNotMatch(html, /NaN|Infinity/); assert.match(html, /No response yet/);
});

test('report metrics expose their labels, values and explanatory scope as a description list', () => {
  const html = markup(MetricCard, { label: 'Completed reviews', value: 12, detail: 'Within the selected academic year', tone: 'teal' });
  assert.match(html, /^<dl/); assert.match(html, /<dt>Completed reviews<\/dt>/);
  assert.match(html, /<dd>12<small>Within the selected academic year<\/small><\/dd>/);
});

test('outcome disclosures retain a label for every metric when narrow layouts hide the column header', () => {
  const summary = { label: 'Inclusive practice with a long configured name', responseCount: 1, secureOrAboveCount: 1, average: 5, distribution: [0, 0, 0, 0, 1] };
  const tree = OutcomeDrilldown({ groups: [{ key: 'practice', label: summary.label, summary, children: [summary] }] });
  const nodes = allNodes(tree), disclosure = nodes.find(node => node.type === 'summary');
  const metrics = allNodes(disclosure).filter(node => node.props?.className?.split(' ').includes('outcome-drilldown-metric'));
  assert.equal(metrics.length, 3);
  assert.deepEqual(metrics.map(node => allNodes(node).find(child => child.props?.className === 'outcome-drilldown-metric-label')?.props.children), ['Rated', 'Secure+', 'Mean']);
  assert.deepEqual(metrics.map(node => allNodes(node).find(child => child.type === 'strong')?.props.children), [1, '100%', '5.0']);
  const html = renderToStaticMarkup(tree);
  assert.match(html, /1 of 1/); assert.match(html, /of 5/);
});

for (const key of ['learning_walk', 'als_learning_walk', 'liv', 'als_liv', 'eli', 'probation_case', 'elevate_environment', 'coaching_session', 'work_scrutiny', 'cpd_event', 'actions']) {
  test(`${key} summary: sparse genuine datasets remain readable without invalid figures`, () => {
    const html = markup(ProcessOverview, {
      definition: { key, label: key, shortLabel: key, singular: 'record', tone: 'teal' },
      configuration: { showTrend: true, showOutcomes: true, showActions: true, showAreaComparison: true },
      records: [], actions: [], cpdAttendance: [], trendData: [], trendGranularity: 'month', facts: [],
      staffParticipationRows: [], livLifecycleRows: [], learningWalkThemeGroups: [],
      livLifecycle: { requestedCount: 0, caseStartedCount: 0, scheduledCount: 0, visitedCount: 0, completedCount: 0, completedVisitCount: 0, practitionerStaffCount: 0, practitionerStaffDenominator: 0 },
      organisationOptions: { faculties: [], teams: [] }, onOpenOrganisationDetail() {}, onOpenStaff() {},
    });
    assert.match(html, /Summary/); assert.doesNotMatch(html, /NaN|Infinity|undefined/);
  });
}
