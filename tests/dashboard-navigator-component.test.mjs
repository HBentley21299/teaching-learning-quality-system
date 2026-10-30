import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const requireWeb = createRequire(new URL('../apps/web/package.json', import.meta.url));
const ts = requireWeb('typescript'), jsx = requireWeb('react/jsx-runtime'), react = requireWeb('react');
const { renderToStaticMarkup } = requireWeb('react-dom/server');

const items = [
  { key: 'overview', label: 'College overview', group: 'Overview', description: 'Activity across the college.' },
  { key: 'liv', label: 'LIV', group: 'Teaching & review', description: 'Staff visits and review cycles.' },
  { key: 'elevate_status', label: 'Elevate Status', group: 'People & development', description: 'Named staff levels and next awards.' },
  { key: 'als_liv', label: 'ALS LIV', group: 'Specialist provision', description: 'ALS practitioner visits and review cycles.' },
  { key: 'uco', label: 'UCO TLA Reviews', group: 'Specialist provision', description: 'Lecturers, observers and reviews.' },
  { key: 'eli', label: 'Elevate Learning and Innovation', group: 'People & development', description: 'Staff submission coverage and self-assessment.' }
];

async function navigator(props) {
  let tree, cursor = 0, focusCount = 0;
  const slots = [], effects = [];
  const ModalDialog = ({ children }) => react.createElement('div', { role: 'dialog' }, children);
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }]; },
    useMemo(factory) { cursor++; return factory(); },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect(effect, deps) { const index = cursor++, previous = slots[index]; if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index]))) { slots[index] = { deps }; effects.push(effect); } }
  };
  const modules = { react: hooks, 'react/jsx-runtime': jsx, './ModalDialog': { ModalDialog }, 'lucide-react': new Proxy({}, { get: () => () => null }) };
  const source = await readFile(new URL('../apps/web/src/components/DashboardNavigator.tsx', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'exports', 'module', code)(name => { assert.ok(name in modules, `Unexpected import ${name}`); return modules[name]; }, module.exports, module);
  const { DashboardNavigator } = module.exports;
  function render() { cursor = 0; tree = DashboardNavigator(props); for (const node of nodes()) if (node.type === 'input' && node.props.ref) node.props.ref.current = { focus() { focusCount++; } }; while (effects.length) effects.shift()(); }
  function nodes() { const result = []; function walk(node) { if (Array.isArray(node)) return node.forEach(walk); if (!node || typeof node !== 'object') return; result.push(node); walk(node.props?.children); } walk(tree); return result; }
  render();
  return {
    nodes, markup: () => renderToStaticMarkup(tree), focusCount: () => focusCount,
    click(label) { const node = nodes().find(node => node.type === 'button' && (node.props['aria-label'] === label || text(node.props.children).trim() === label)); assert.ok(node, `Missing button ${label}`); node.props.onClick(); render(); },
    query(value) { const node = nodes().find(node => node.type === 'input' && node.props.type === 'search'); assert.ok(node); node.props.onChange({ target: { value } }); render(); },
    select(value) { const node = nodes().find(node => node.type === 'select' && node.props['aria-label'] === 'Dashboard'); assert.ok(node); node.props.onChange({ target: { value } }); render(); },
    closeDialog() { const dialog = nodes().find(node => node.type === ModalDialog); assert.ok(dialog); dialog.props.onClose(); render(); },
    rerender(next) { props = next; render(); }
  };
}
function text(node) { return Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : node == null || typeof node === 'boolean' ? '' : String(node); }

test('chooser exposes current location and groups all permitted dashboard destinations in one dialog', async () => {
  const page = await navigator({ items, activeKey: 'liv', onSelect() {}, canViewQa: true });
  assert.match(page.markup(), /Reporting \/ Teaching &amp; review/); assert.doesNotMatch(page.markup(), /role="dialog"/);
  page.click('Search dashboards');
  assert.match(page.markup(), /role="dialog"/);
  const headings = page.nodes().filter(node => node.type === 'h3').map(node => text(node.props.children));
  assert.deepEqual(headings, ['Overview', 'Teaching & review', 'People & development', 'Specialist provision']);
  const active = page.nodes().filter(node => node.type === 'button' && node.props['aria-current'] === 'page');
  assert.equal(active.length, 1); assert.match(text(active[0].props.children), /^LIV/);
  assert.match(page.markup(), /href="\/qa-hub\/reviews"/);
});

test('the compact direct selector groups permitted dashboards and switches without opening a dialog', async () => {
  const selected = [];
  const page = await navigator({ items: items.slice(0, 3), activeKey: 'liv', onSelect: key => selected.push(key) });
  const select = page.nodes().find(node => node.props?.['aria-label'] === 'Dashboard');
  assert.ok(select); assert.equal(select.props.value, 'liv');
  assert.deepEqual(page.nodes().filter(node => node.type === 'option').map(node => node.props.value), ['overview', 'liv', 'elevate_status']);
  page.select('liv'); assert.deepEqual(selected, []);
  page.select('uco'); assert.deepEqual(selected, [], 'an unavailable destination cannot be selected');
  page.select('elevate_status'); assert.deepEqual(selected, ['elevate_status']);
  assert.doesNotMatch(page.markup(), /role="dialog"/);
});

test('multiword searches match dashboard names, descriptive context and group labels', async () => {
  const selected = [];
  const page = await navigator({ items, activeKey: 'overview', onSelect: key => selected.push(key) });
  page.click('Search dashboards'); page.query('specialist ALS');
  const destinationButtons = page.nodes().filter(node => node.type === 'button' && node.props.children?.[0]?.type === 'span');
  assert.equal(destinationButtons.length, 1); assert.match(text(destinationButtons[0].props.children), /^ALS LIV/);
  assert.equal(selected.length, 0, 'search must not switch dashboards');
  page.query('staff awards'); assert.match(page.markup(), /Elevate Status/); assert.doesNotMatch(page.markup(), /<strong>LIV<\/strong>/);
  page.query('unfindable criterion'); assert.match(page.markup(), /No dashboards match/); assert.equal(selected.length, 0);
});

test('selection closes the chooser, reports one destination and clears the search for its next opening', async () => {
  const selected = [];
  const page = await navigator({ items, activeKey: 'liv', onSelect: key => selected.push(key) });
  page.click('Search dashboards'); page.query('lecturers');
  const ucoButton = page.nodes().find(node => node.type === 'button' && text(node.props.children).startsWith('UCO TLA Reviews'));
  assert.ok(ucoButton); ucoButton.props.onClick();
  page.rerender({ items, activeKey: 'uco', onSelect: key => selected.push(key) });
  assert.deepEqual(selected, ['uco']); assert.doesNotMatch(page.markup(), /role="dialog"/);
  page.click('Search dashboards');
  assert.equal(page.nodes().find(node => node.type === 'input').props.value, ''); assert.match(page.markup(), /Elevate Status/);
  assert.match(page.markup(), /Reporting \/ Specialist provision/);
});

test('cancel and close preserve current dashboard and filters, and QA access is never implied by reporting access', async () => {
  const selected = [];
  const page = await navigator({ items: [items[2]], activeKey: 'elevate_status', onSelect: key => selected.push(key), canViewQa: false });
  page.click('Search dashboards'); page.query('not found'); page.closeDialog();
  assert.doesNotMatch(page.markup(), /role="dialog"/); assert.deepEqual(selected, []);
  page.click('Search dashboards'); assert.doesNotMatch(page.markup(), /href="\/qa-hub/); assert.match(page.markup(), /1 available dashboard/);
  assert.equal(page.nodes().find(node => node.type === 'input').props.value, '');
  page.click('Close dashboard chooser'); assert.deepEqual(selected, []);
});

test('choosing the current dashboard closes without resetting the current analysis filters', async () => {
  const selected = [];
  const page = await navigator({ items, activeKey: 'liv', onSelect: key => selected.push(key) });
  page.click('Search dashboards');
  const current = page.nodes().find(node => node.type === 'button' && node.props['aria-current'] === 'page');
  assert.ok(current); current.props.onClick();
  page.rerender({ items, activeKey: 'liv', onSelect: key => selected.push(key) });
  assert.deepEqual(selected, []); assert.doesNotMatch(page.markup(), /role="dialog"/);
});

test('opening focuses search after the dialog mount and process acronyms find their full dashboard labels', async () => {
  const page = await navigator({ items, activeKey: 'overview', onSelect() {} });
  assert.equal(page.focusCount(), 0); page.click('Search dashboards'); assert.equal(page.focusCount(), 1);
  page.query('ELI');
  assert.match(page.markup(), /Elevate Learning and Innovation/);
  assert.doesNotMatch(page.markup(), /<strong>LIV<\/strong>|<strong>UCO TLA Reviews<\/strong>/);
  page.closeDialog(); page.click('Search dashboards'); assert.equal(page.focusCount(), 2);
  page.query('als liv'); assert.match(page.markup(), /<strong>ALS LIV<\/strong>/);
});
