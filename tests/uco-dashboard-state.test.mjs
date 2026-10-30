import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const requireWeb = createRequire(new URL('../apps/web/package.json', import.meta.url));
const ts = requireWeb('typescript'), react = requireWeb('react'), jsxRuntime = requireWeb('react/jsx-runtime');
const { renderToStaticMarkup } = requireWeb('react-dom/server');
async function loadService(path) {
  const source = await readFile(new URL(`../apps/web/src/services/${path}.ts`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} }; new Function('exports', 'module', code)(module.exports, module); return module.exports;
}
const listQuery = await loadService('listQuery'), { DashboardRequestCache } = await loadService('dashboardRequestCache');
const loadingSource = await readFile(new URL('../apps/web/src/components/LoadingState.tsx', import.meta.url), 'utf8');
const loadingModule = { exports: {} };
new Function('require', 'exports', 'module', ts.transpileModule(loadingSource, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(name => ({ 'react/jsx-runtime': jsxRuntime })[name], loadingModule.exports, loadingModule);

const access = { canAccess: true, canManage: true, canExport: true };
const review = (recordId, lecturerName, workflowStatus = 'completed', overrides = {}) => ({
  recordId, lecturerName, observerName: 'Observer Example', workflowStatus,
  courseTitle: 'Teaching and Learning', moduleTitle: 'Practice', observationAt: '2026-10-01T09:00:00Z',
  completedSectionCount: 7, openActionCount: 0, overdueActionCount: 0, ...overrides
});
const dashboard = (reviews, overrides = {}) => ({
  activeUcoStaff: 10, coveredUcoStaff: 5, coveragePercent: 50, reviews, practiceHighlights: [],
  openActionCount: 999, overdueActionCount: 999, ...overrides
});
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flushPromises = () => new Promise(resolve => setImmediate(resolve));

async function component(initialProps, getData) {
  let cursor = 0, renderNeeded = true, tree, props = initialProps;
  const slots = [], effects = [], calls = [];
  const hooks = {
    useCallback(callback, deps) { const index = cursor++, previous = slots[index]; if (!previous || deps.some((value, offset) => !Object.is(value, previous.deps[offset]))) slots[index] = { deps, callback }; return slots[index].callback; },
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, next => {
        const value = typeof next === 'function' ? next(slots[index].value) : next;
        if (!Object.is(value, slots[index].value)) { slots[index].value = value; renderNeeded = true; }
      }];
    },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect(effect, deps) {
      const index = cursor++, previous = slots[index];
      if (!previous || deps.some((value, offset) => !Object.is(value, previous.deps[offset]))) {
        slots[index] = { deps };
        effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = effect(); });
      }
    }
  };
  const Button = ({ icon, variant, children, ...rest }) => react.createElement('button', rest, children);
  const DashboardReportButton = () => react.createElement('button', null, 'Export UCO report');
  const DashboardDataExplorer = () => react.createElement('section', { 'aria-label': 'Saved UCO form data' });
  const KpiStrip = ({ items }) => react.createElement('div', null, items.map(item => react.createElement('span', { key: item.label }, `${item.label}: ${item.value}`)));
  const modules = {
    react: hooks, 'react/jsx-runtime': jsxRuntime,
    'lucide-react': new Proxy({}, { get: () => () => null }),
    '../components/ExportButtons': { DashboardReportButton },
    '../components/DashboardDataExplorer': { DashboardDataExplorer },
    '../components/LoadingState': loadingModule.exports,
    '../components/KpiStrip': { KpiStrip },
    '../components/CollapsibleSection': { Pagination: () => null },
    '../services/listQuery': listQuery,
    '../services/dashboardRequestCache': { DashboardRequestCache },
    '../design-system/Button': { Button },
    '../services/api': { api: { ucoTlaDashboard: year => { calls.push(year); return Promise.resolve().then(() => getData(year, calls.length)); } } }
  };
  const source = await readFile(new URL('../apps/web/src/routes/UcoTlaDashboard.tsx', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'exports', 'module', code)(name => { assert.ok(name in modules, `Unexpected import: ${name}`); return modules[name]; }, module.exports, module);
  const Component = module.exports.UcoTlaDashboard;
  function nodes() {
    const results = [];
    function walk(node) { if (Array.isArray(node)) return node.forEach(walk); if (!node || typeof node !== 'object') return; results.push(node); walk(node.props?.children); }
    walk(tree); return results;
  }
  function render() { renderNeeded = false; cursor = 0; tree = Component(props); }
  async function settle() {
    for (let round = 0; round < 30; round++) {
      if (renderNeeded) render();
      while (effects.length) effects.shift()();
      await flushPromises();
      if (!renderNeeded && !effects.length) return;
    }
    throw new Error('UCO dashboard did not settle');
  }
  await settle();
  return {
    calls, nodes, settle,
    markup: () => renderToStaticMarkup(tree),
    exportButton: () => nodes().find(node => node.type === DashboardReportButton),
    explorer: () => nodes().find(node => node.type === DashboardDataExplorer),
    kpis: () => nodes().find(node => node.type === KpiStrip)?.props.items,
    renderBeforeEffects(nextProps) { props = nextProps; render(); return renderToStaticMarkup(tree); },
    async rerender(nextProps) { props = nextProps; renderNeeded = true; await settle(); },
    async refresh() {
      const button = nodes().find(node => node.type === Button && text(node.props.children) === 'Refresh');
      assert.ok(button, 'Missing Refresh button'); button.props.onClick(); await settle();
    },
    async changeWorkflow(value) {
      const select = nodes().find(node => node.props?.['aria-label'] === 'UCO dashboard workflow stage');
      assert.ok(select); select.props.onChange({ target: { value } }); await settle();
    },
    async change(label, value) { const node = nodes().find(node => node.props?.['aria-label'] === label); assert.ok(node, `Missing ${label}`); node.props.onChange({ target: { value } }); await settle(); },
    reviewIds: () => nodes().filter(node => typeof node.type === 'function' && node.props?.review).map(node => node.props.review.recordId)
  };
}

function text(node) { return Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : node == null || typeof node === 'boolean' ? '' : String(node); }
const props = (year, extra = {}) => ({ access, academicYear: year, onOpenReview: () => {}, ...extra });

test('UCO reporting uses its loading illustration only while the current request is pending', async () => {
  const request = deferred();
  const page = await component(props('2026/27'), () => request.promise);
  assert.equal((page.markup().match(/class="loading-state /g) ?? []).length, 1);
  assert.match(page.markup(), /Loading UCO reporting data/); assert.equal(page.exportButton(), undefined);
  request.reject(new Error('Unavailable')); await page.settle();
  assert.doesNotMatch(page.markup(), /class="loading-state /);
  assert.match(page.markup(), /Reporting data unavailable/); assert.match(page.markup(), /role="alert"/);
  assert.equal(page.kpis(), undefined);
});

test('stage bars preserve all-stage context and toggling the selected stage restores every review', async () => {
  const page = await component(props('2026/27'), () => dashboard([review('draft', 'Draft lecturer', 'observer_draft'), review('done', 'Completed lecturer')]));
  const bars = () => page.nodes().filter(node => node.type === 'button' && typeof node.props['aria-pressed'] === 'boolean');
  const draft = () => bars().find(node => text(node.props.children).startsWith('Observer review'));
  const complete = () => bars().find(node => text(node.props.children).startsWith('Complete'));
  draft().props.onClick(); await page.settle();
  assert.equal(draft().props['aria-pressed'], true); assert.deepEqual(page.reviewIds(), ['draft']);
  assert.equal(complete().props.children.at(-1).props.children, 1, 'other stages retain their complete academic-year counts');
  draft().props.onClick(); await page.settle();
  assert.equal(draft().props['aria-pressed'], false); assert.equal(page.reviewIds().length, 2);
});

test('changing academic year hides loaded prior-year reviews and export synchronously before effects run', async () => {
  const page = await component(props('2025/26'), year => dashboard([review(year, year === '2025/26' ? 'Prior Year Lecturer' : 'Current Year Lecturer')]));
  assert.match(page.markup(), /Prior Year Lecturer/);
  assert.equal(page.exportButton().props.filters.academicYear, '2025/26');
  const immediate = page.renderBeforeEffects(props('2026/27'));
  assert.doesNotMatch(immediate, /Prior Year Lecturer|Export UCO report/);
  assert.match(immediate, /Retrieving records for 2026\/27/);
  assert.equal(page.exportButton(), undefined);
  assert.equal(page.kpis(), undefined);
  await page.settle();
  assert.match(page.markup(), /Current Year Lecturer/);
  assert.doesNotMatch(page.markup(), /Prior Year Lecturer/);
  assert.equal(page.exportButton().props.filters.academicYear, '2026/27');
});

test('late previous-year response cannot overwrite a newer completed dashboard request', async () => {
  const prior = deferred();
  const page = await component(props('2025/26'), year => year === '2025/26' ? prior.promise : dashboard([review('current', 'Current Year Lecturer')]));
  await page.rerender(props('2026/27'));
  assert.match(page.markup(), /Current Year Lecturer/);
  prior.resolve(dashboard([review('prior', 'Late Prior Year Lecturer')]));
  await page.settle();
  assert.deepEqual(page.calls, ['2025/26', '2026/27']);
  assert.match(page.markup(), /Current Year Lecturer/);
  assert.doesNotMatch(page.markup(), /Late Prior Year Lecturer/);
  assert.equal(page.exportButton().props.filters.academicYear, '2026/27');
});

test('a prior-year result arriving between the new render and its effects is also ignored', async () => {
  const prior = deferred(), current = deferred();
  const page = await component(props('2025/26'), year => year === '2025/26' ? prior.promise : current.promise);
  page.renderBeforeEffects(props('2026/27'));
  prior.resolve(dashboard([review('prior', 'Pre-effect Prior Lecturer')]));
  await flushPromises(); // Deliberately do not run the new-year effect yet.
  assert.doesNotMatch(page.renderBeforeEffects(props('2026/27')), /Pre-effect Prior Lecturer|Export UCO report/);
  await page.settle();
  current.resolve(dashboard([review('current', 'Current Scope Lecturer')]));
  await page.settle();
  assert.match(page.markup(), /Current Scope Lecturer/);
  assert.doesNotMatch(page.markup(), /Pre-effect Prior Lecturer/);
});

test('explicit refresh invalidates cached data and hides unverified results on failure, then mounts the refreshed form register', async () => {
  let failNext = false;
  const page = await component(props('2026/27', { section: 'data' }), () => {
    if (failNext) throw new Error('Unavailable');
    return dashboard([review('current', 'Current Lecturer')]);
  });
  const original = page.explorer();
  assert.ok(original);
  failNext = true; await page.refresh();
  assert.match(page.markup(), /dashboard could not be loaded/);
  assert.equal(page.explorer(), undefined);
  assert.equal(page.exportButton(), undefined);
  failNext = false; await page.refresh();
  const refreshed = page.explorer();
  assert.equal(refreshed.type, original.type);
  assert.equal(refreshed.key, original.key);
  assert.ok(refreshed.props.refreshKey > original.props.refreshKey);
  assert.equal(refreshed.props.academicYear, '2026/27');
  assert.equal(refreshed.props.processKey, 'uco_tla_review');
  assert.doesNotMatch(page.markup(), /dashboard could not be loaded/);
  assert.deepEqual(page.calls, ['2026/27', '2026/27', '2026/27']);
  const immediate = page.renderBeforeEffects(props('2027/28', { section: 'data' }));
  assert.doesNotMatch(immediate, /Saved UCO form data|Export UCO report/);
  assert.equal(page.explorer(), undefined, 'the prior-year explorer cannot remain mounted under a new-year heading');
  await page.settle();
});

test('workflow scope filters action totals and practice highlights while annual staff coverage stays annual', async () => {
  const completed = review('complete', 'Completed Lecturer', 'completed', { openActionCount: 2, overdueActionCount: 1 });
  const waiting = review('waiting', 'Waiting Lecturer', 'awaiting_lecturer', { openActionCount: 5, overdueActionCount: 3 });
  const data = dashboard([completed, waiting], { practiceHighlights: [
    { recordId: 'complete', category: 'Good practice', narrative: 'Completed review narrative', lecturerName: completed.lecturerName },
    { recordId: 'waiting', category: 'Good practice', narrative: 'Waiting review narrative', lecturerName: waiting.lecturerName },
    { recordId: 'outside', category: 'Good practice', narrative: 'Outside scoped review narrative', lecturerName: 'Outside lecturer' }
  ] });
  const page = await component(props('2026/27'), () => data);
  assert.match(page.markup(), /Completed review narrative|Waiting review narrative/);
  assert.doesNotMatch(page.markup(), /Outside scoped review narrative/);
  await page.changeWorkflow('completed');
  const kpis = page.kpis();
  assert.equal(kpis.find(item => item.label === 'Annual coverage').value, '5/10 (50%)');
  assert.equal(kpis.find(item => item.label === 'Reviews complete').value, 1);
  assert.equal(kpis.find(item => item.label === 'In progress').value, 0);
  assert.equal(kpis.find(item => item.label === 'Overdue actions').value, 1);
  assert.match(page.markup(), /Open actions<\/span><strong>2<\/strong>/);
  assert.match(page.markup(), /Completed review narrative/);
  assert.doesNotMatch(page.markup(), /Waiting review narrative|Outside scoped review narrative/);
  assert.deepEqual(page.reviewIds(), ['complete']);
  assert.equal(page.exportButton().props.filters.status, 'completed');
});

test('UCO historical choices come from permitted records; people/session filters, sorting and multi-term search refine the register only', async () => {
  const data = dashboard([
    review('ten', 'Zoe Lecturer', 'completed', { observerName: 'Retired Observer', courseTitle: 'Archived course', moduleTitle: 'Module 10', openActionCount: 10, completedSectionCount: 3 }),
    review('two', 'Amélie Lecturer', 'awaiting_lecturer', { observerName: 'Current Observer', courseTitle: 'New course', moduleTitle: 'Module 2', openActionCount: 2 }),
    review('blank', 'Unknown session', 'completed', { observationAt: undefined, courseTitle: undefined, moduleTitle: undefined })
  ]);
  const page = await component(props('2026/27'), () => data);
  assert.match(page.markup(), /Retired Observer|Archived course/);
  await page.change('Sort UCO reviews by', 'openActionCount'); await page.change('UCO review sort order', 'asc');
  assert.deepEqual(page.reviewIds(), ['blank', 'two', 'ten']);
  await page.change('UCO register observer', 'Retired Observer'); assert.deepEqual(page.reviewIds(), ['ten']);
  assert.equal(page.kpis().find(item => item.label === 'Reviews complete').value, 2);
  assert.equal(page.exportButton().props.filters.status, undefined, 'register-only filters do not silently narrow Excel');
  await page.change('UCO register observer', 'all'); await page.change('Search UCO review register', 'amelie module 2');
  assert.deepEqual(page.reviewIds(), ['two']);
  await page.change('Search UCO review register', ''); await page.change('Sort UCO reviews by', 'observationAt'); await page.change('UCO review sort order', 'desc');
  assert.equal(page.reviewIds().at(-1), 'blank', 'missing observation dates stay last in either direction');
});

test('UCO scope changes hide the previous account before effects and cached same-scope return needs no duplicate network request', async () => {
  const page = await component(props('2026/27', { accessScope: 'account-a' }), year => dashboard([review(year, 'Scope Lecturer')]));
  await page.rerender(props('2025/26', { accessScope: 'account-a' }));
  await page.rerender(props('2026/27', { accessScope: 'account-a' }));
  assert.deepEqual(page.calls, ['2026/27', '2025/26']);
  const immediate = page.renderBeforeEffects(props('2026/27', { accessScope: 'account-b' }));
  assert.doesNotMatch(immediate, /Scope Lecturer|Export UCO report/);
  await page.settle(); assert.equal(page.calls.length, 3);
});
