import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const web = createRequire(new URL('../apps/web/package.json', import.meta.url));
const ts = web('typescript'), React = web('react'), jsx = web('react/jsx-runtime');
const { renderToStaticMarkup } = web('react-dom/server');
async function load(path, modules = {}) {
  const source = await readFile(new URL(`../apps/web/src/${path}`, import.meta.url), 'utf8');
  const module = { exports: {} };
  new Function('require', 'exports', 'module', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText)(name => modules[name] ?? {}, module.exports, module);
  return module.exports;
}
const origin = await load('services/actionOrigin.ts'), state = await load('services/dashboardActionState.ts'), list = await load('services/listQuery.ts');
const model = await load('services/actionDashboard.ts', { './actionOrigin': origin, './dashboardActionState': state, './listQuery': list });
const base = { sourceRecordId: 'record', sourceFormType: 'learning_walk', sourceRecordTitle: 'Autumn digital visit', sourceRecordDate: '2026-10-20', ownerStaffId: 'owner', ownerStaffName: 'Avery', actionTheme: 'Feedback', facultyCode: 'FAC', teamCode: 'TEAM', createdAt: '2026-10-21T10:00:00Z', isDeleted: false, statusKey: 'open', isOverdue: false };
const rows = [
  { ...base, id: 'shared', title: 'Shared planning action', responsibleStaffNames: ['Avery', 'Rene'], dueDate: '2026-11-04' },
  { ...base, id: 'late', title: 'Overdue review', isOverdue: true, dueDate: '2026-10-01' },
  { ...base, id: 'complete', title: 'Completed review', statusKey: 'complete', dueDate: '2026-10-01' },
  { ...base, id: 'cancelled', title: 'Cancelled review', statusKey: 'cancelled', isOverdue: true, completedDate: '2026-10-02', dueDate: '2026-10-01' },
  { ...base, id: 'legacy', title: 'Earlier unlinked action', sourceRecordId: null, sourceFormType: 'learning_walk', dueDate: null },
  { ...base, id: 'cpd', title: 'Professional learning', sourceFormType: 'cpd_event', sourceRecordTitle: 'Subject CPD', dueDate: '2026-12-01' }
];

test('action insights count each central action once, preserve lifecycle precedence and keep unlinked origins separate', () => {
  const result = model.actionDashboardModel([...rows, rows[0], { ...base, id: 'deleted', isDeleted: true }], '2026-10-31');
  assert.equal(result.total, 6); assert.equal(result.reportable, 5); assert.equal(result.completion, 20);
  assert.deepEqual(result.states, { open: 3, overdue: 1, complete: 1, cancelled: 1 });
  assert.equal(result.linked, 5); assert.equal(result.missingOrigin, 1);
  assert.equal(result.origins.find(group => group.key === 'learning_walk').count, 4);
  assert.equal(result.origins.find(group => group.key === 'origin_not_recorded').label, 'Origin not recorded');
  assert.equal(result.origins.find(group => group.key === 'cpd').count, 1);
  assert.deepEqual(result.attention.map(action => action.id), ['late', 'shared', 'legacy']);
});

test('origin, responsible person, source record search and state filters intersect without multiplying shared actions', () => {
  const filter = { ...model.emptyActionExploration, origin: 'learning_walk', responsible: 'Rene', search: 'Autumn planning 2026-10-20' };
  const result = model.filterDashboardActions([...rows, rows[0]], filter, '2026-10-31');
  assert.deepEqual(result.map(action => action.id), ['shared']);
  assert.deepEqual(model.filterDashboardActions(rows, { ...model.emptyActionExploration, state: 'due_soon' }, '2026-10-31').map(action => action.id), ['shared']);
  assert.deepEqual(model.filterDashboardActions(rows, { ...model.emptyActionExploration, state: 'cancelled' }).map(action => action.id), ['cancelled']);
  assert.equal(model.filterDashboardActions(rows, model.emptyActionExploration).at(-1).id, 'legacy', 'undated actions stay last when sorting dates');
});

const text = value => Array.isArray(value) ? value.map(text).join('') : value?.props ? text(value.props.children) : value == null || typeof value === 'boolean' ? '' : String(value);
async function dashboard(initialRows = rows) {
  let cursor = 0, changed = true, tree, props = { actions: initialRows, scopeKey: 'scope-a', onOpenAction: (id, staff) => opens.push([id, staff]) };
  const slots = [], effects = [], opens = [];
  const hooks = {
    useState(initial) { const at = cursor++; if (!(at in slots)) slots[at] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[at].value, next => { const value = typeof next === 'function' ? next(slots[at].value) : next; if (!Object.is(value, slots[at].value)) { slots[at].value = value; changed = true; } }]; },
    useMemo(factory, deps) { const at = cursor++, previous = slots[at]; if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index]))) slots[at] = { deps, value: factory() }; return slots[at].value; },
    useEffect(effect, deps) { const at = cursor++, previous = slots[at]; if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index]))) { slots[at] = { deps }; effects.push(effect); } }
  };
  const component = (await load('components/ActionDashboard.tsx', { react: hooks, 'react/jsx-runtime': jsx, 'lucide-react': new Proxy({}, { get: () => () => null }),
    '../design-system/Button': { Button: ({ children, variant, ...rest }) => React.createElement('button', rest, children) }, './CollapsibleSection': { Pagination: () => null },
    '../app/routing': { actionPath: id => `/actions/${id}` }, '../services/actionOrigin': origin, '../services/dashboardActionState': state, '../services/actionDashboard': model })).ActionDashboard;
  function nodes() { const found = []; function walk(node) { if (Array.isArray(node)) return node.forEach(walk); if (!node || typeof node !== 'object') return; found.push(node); walk(node.props?.children); } walk(tree); return found; }
  async function settle() { for (let i = 0; i < 20; i++) { if (changed) { cursor = 0; changed = false; tree = component(props); } while (effects.length) effects.shift()(); await new Promise(resolve => setImmediate(resolve)); if (!changed) return; } throw new Error('Dashboard did not settle'); }
  await settle();
  return { opens, nodes, markup: () => renderToStaticMarkup(tree), cards: () => nodes().filter(node => node.type === 'a'),
    async change(label, value) { const node = nodes().find(node => node.props?.['aria-label'] === label); assert.ok(node, `Missing ${label}`); node.props.onChange({ target: { value } }); await settle(); },
    async clickOrigin(label) { const node = nodes().find(node => node.type === 'button' && node.props['aria-pressed'] !== undefined && text(node.props.children).startsWith(label)); assert.ok(node); node.props.onClick(); await settle(); },
    async rerender(next) { props = { ...props, ...next }; changed = true; await settle(); }
  };
}

test('interactive origin and state exploration update the same register, ring and person filter; source detail stays visible', async () => {
  const page = await dashboard();
  await page.clickOrigin('CPD');
  assert.deepEqual(page.cards().map(node => text(node)), ['Professional learning']);
  assert.match(page.markup(), /Subject CPD/); assert.match(page.markup(), /Source date:/);
  await page.change('Action origin', 'learning_walk'); await page.change('Action responsible person', 'Rene');
  assert.deepEqual(page.cards().map(node => text(node)), ['Shared planning action']);
  assert.match(page.markup(), /1 of 6 actions shown/);
  page.cards()[0].props.onClick({ preventDefault() {} }); assert.deepEqual(page.opens, [['shared', 'owner']]);
  await page.change('Action responsible person', 'all'); await page.change('Action exploration state', 'complete');
  assert.deepEqual(page.cards().map(node => text(node)), ['Completed review']);
  assert.equal(page.nodes().find(node => node.props?.role === 'img').props['aria-label'], '100% of non-cancelled selected actions complete');
  assert.match(page.markup(), /Excel and PDF use the report filters above/);
});

test('a reporting scope change resets exploration and cannot retain earlier source data', async () => {
  const page = await dashboard(); await page.change('Action origin', 'learning_walk'); await page.change('Find dashboard actions', 'shared');
  await page.rerender({ actions: [{ ...rows[5], id: 'new-scope', title: 'Different year action' }], scopeKey: 'scope-b' });
  assert.deepEqual(page.cards().map(node => text(node)), ['Different year action']);
  assert.equal(page.nodes().find(node => node.props?.['aria-label'] === 'Action origin').props.value, 'all');
  assert.equal(page.nodes().find(node => node.props?.['aria-label'] === 'Find dashboard actions').props.value, '');
  assert.doesNotMatch(page.markup(), /Shared planning action/);
});
