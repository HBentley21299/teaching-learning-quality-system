import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const web = createRequire(new URL('../apps/web/package.json', import.meta.url));
const ts = web('typescript'), jsx = web('react/jsx-runtime');
const { renderToStaticMarkup } = web('react-dom/server');
const source = await readFile(new URL('../apps/web/src/components/DashboardVisuals.tsx', import.meta.url), 'utf8');
const module = { exports: {} };
new Function('require', 'exports', 'module', ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText)(name => name === 'react/jsx-runtime' ? jsx : {}, module.exports, module);
const { DashboardMetricCard, DashboardProgressRing, DashboardBreakdown } = module.exports;

test('dashboard progress distinguishes an unavailable denominator from a known zero result', () => {
  const missing = renderToStaticMarkup(DashboardProgressRing({ value: null, label: 'Coverage' }));
  assert.match(missing, /Coverage: not available/); assert.match(missing, /—/); assert.doesNotMatch(missing, />0%/);
  const zero = renderToStaticMarkup(DashboardProgressRing({ value: 0, label: 'Coverage' }));
  assert.match(zero, /Coverage: 0%/); assert.match(zero, />0%</);
});

test('interactive metric and breakdown controls expose selection and send the selected cohort key', () => {
  let selected;
  const metric = DashboardMetricCard({ label: 'Reviews in progress', value: 3, active: true, onSelect: () => { selected = 'in_progress'; } });
  assert.equal(metric.type, 'button'); assert.equal(metric.props.type, 'button'); assert.equal(metric.props['aria-pressed'], true);
  metric.props.onClick(); assert.equal(selected, 'in_progress');
  const chart = DashboardBreakdown({ items: [{ key: 'waiting', label: 'Awaiting discussion', value: 3 }, { key: 'complete', label: 'Complete', value: 0 }], activeKey: 'waiting', onSelect: key => { selected = key; } });
  assert.equal(chart.props.children[0].props['aria-pressed'], true);
  chart.props.children[1].props.onClick(); assert.equal(selected, 'complete');
  assert.match(renderToStaticMarkup(chart.props.children[1]), /width:0%/);
});

test('unavailable breakdown data does not silently become a recorded zero and empty scope stays explicit', () => {
  const chart = renderToStaticMarkup(DashboardBreakdown({ items: [{ key: 'unknown', label: 'Awaiting data', value: Number.NaN }] }));
  assert.match(chart, /<b>—<\/b>/); assert.doesNotMatch(chart, /<b>0<\/b>/);
  assert.match(renderToStaticMarkup(DashboardBreakdown({ items: [], emptyMessage: 'No permitted records in this scope.' })), /No permitted records/);
});
