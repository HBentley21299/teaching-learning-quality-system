import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const requireWeb = createRequire(new URL('../apps/web/package.json', import.meta.url));
const ts = requireWeb('typescript'), react = requireWeb('react'), jsx = requireWeb('react/jsx-runtime');
const { renderToStaticMarkup } = requireWeb('react-dom/server');
async function compile(path, modules = {}) {
  const source = await readFile(new URL(`../apps/web/src/${path}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function('require', 'exports', 'module', code)(name => { assert.ok(name in modules, `Unexpected import ${name}`); return modules[name]; }, module.exports, module);
  return module.exports;
}
const listQuery = await compile('services/listQuery.ts');
const reporting = await compile('services/processReviewReporting.ts', { './listQuery': listQuery });
const text = node => Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : node == null || typeof node === 'boolean' ? '' : String(node);
const counts = [2, 3, 3, 3, 2, 2];
const configuration = {
  processKey: 'activate_growth_review', title: 'Activate+', version: 2, rowVersion: 'saved-config',
  standards: Array.from({ length: 5 }, (_, index) => ({ key: `area_${index + 1}`, title: `Legacy area ${index + 1}`, statements: [] })),
  skillsScanPillars: counts.map((count, index) => ({ key: `pillar_${index + 1}`, title: `Skills pillar ${index + 1}`, subAreas: Array.from({ length: count }, (_, area) => ({ key: `skill_${index + 1}_${area + 1}`, title: `Skill sub-area ${index + 1}.${area + 1}` })) })),
  actionThemes: Array.from({ length: 5 }, (_, index) => ({ key: `area_${index + 1}`, title: `Specialist theme ${index + 1}` })),
  ratingOptions: [], fieldLabels: { meetingMinutes: 'Meeting minutes', strengths: 'Strengths', development: 'Development priorities', teamsUrl: 'Teams proforma link', followUpDate: 'Planned follow-up date' },
  settings: { formJourney: 'activate_growth_v2', initialWindow: 'November–December', skillsScanLeadDays: '14' }
};

async function admin() {
  let cursor = 0, tree, needsRender = true;
  const slots = [], effects = [], saves = [];
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[index].value, next => { const value = typeof next === 'function' ? next(slots[index].value) : next; if (!Object.is(value, slots[index].value)) { slots[index].value = value; needsRender = true; } }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect(effect, deps) { const index = cursor++, previous = slots[index]; if (!previous || deps.some((value, position) => !Object.is(value, previous.deps[position]))) { slots[index] = { deps }; effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = effect(); }); } }
  };
  const Button = ({ icon, variant, busy, disabled, children, ...rest }) => react.createElement('button', { ...rest, disabled: disabled || busy }, children);
  const modules = {
    react: hooks, 'react/jsx-runtime': jsx, 'lucide-react': new Proxy({}, { get: () => () => null }),
    '../design-system/Button': { Button },
    '../components/LoadingState': { LoadingState: ({ label }) => react.createElement('p', {}, label) },
    '../components/WorkflowFeedback': { WorkflowFeedback: ({ message }) => message ? react.createElement('p', {}, message) : null },
    '../components/UnsavedChangesGuard': { useUnsavedChanges: () => () => {}, confirmUnsavedNavigation: async () => true },
    '../components/CollapsibleSection': { CollapsibleSection: ({ title, children }) => react.createElement('section', {}, react.createElement('h3', {}, title), children) },
    '../services/api': { api: { processReviewConfiguration: async () => structuredClone(configuration), saveProcessReviewConfiguration: async (key, request) => { saves.push({ key, request: structuredClone(request) }); return { ok: true, data: { ...request, version: 3, rowVersion: 'next-version' } }; } } },
    '../services/processReviewReporting': reporting, '../services/listQuery': listQuery, './ProcessReviewReporting.css': {}
  };
  const component = await compile('routes/AdminProcessReviews.tsx', modules);
  async function settle() { for (let round = 0; round < 30; round++) { if (needsRender) { needsRender = false; cursor = 0; tree = component.AdminProcessReviews({ processKey: 'activate_growth_review' }); } while (effects.length) effects.shift()(); await new Promise(resolve => setImmediate(resolve)); if (!needsRender) return; } throw new Error('Admin settings did not settle'); }
  function nodes() { const result = []; function walk(node) { if (Array.isArray(node)) return node.forEach(walk); if (!node || typeof node !== 'object') return; result.push(node); walk(node.props?.children); } walk(tree); return result; }
  function input(label) { const group = nodes().find(node => node.type === 'label' && text(Array.isArray(node.props.children) ? node.props.children[0] : node.props.children) === label); assert.ok(group, `Missing label ${label}`); return (Array.isArray(group.props.children) ? group.props.children : [group.props.children]).find(node => ['input', 'textarea', 'select'].includes(node?.type)); }
  await settle();
  return { saves, markup: () => renderToStaticMarkup(tree), async change(label, value) { input(label).props.onChange({ target: { value } }); await settle(); }, async save() { const button = nodes().find(node => node.type === Button && text(node.props.children) === 'Save new version'); assert.ok(button); assert.equal(Boolean(button.props.disabled), false); button.props.onClick(); await settle(); } };
}

test('Activate admin separates six/fifteen Skills Scan labels from five action themes and omits obsolete workflow controls', async () => {
  const page = await admin();
  const markup = page.markup();
  assert.equal((markup.match(/value="Skills pillar /g) ?? []).length, 6);
  assert.equal((markup.match(/value="Skill sub-area /g) ?? []).length, 15);
  assert.equal((markup.match(/value="Specialist theme /g) ?? []).length, 5);
  assert.match(markup, /fixed 1–5 scale/);
  assert.doesNotMatch(markup, /Teams proforma link|Cycle &amp; preparation|Skills Scan closure|College rating scale|Legacy area|Planned follow-up date/);
});

test('saving changed Skills Scan wording preserves pillar/sub-area identities and independent specialist themes', async () => {
  const page = await admin();
  await page.change('Pillar 1', 'Updated college pillar wording');
  await page.change('Sub-area 1.1', 'Updated college sub-area wording');
  await page.save();
  assert.equal(page.saves.length, 1);
  const { request } = page.saves[0];
  assert.equal(request.rowVersion, 'saved-config');
  assert.equal(request.skillsScanPillars[0].key, 'pillar_1');
  assert.equal(request.skillsScanPillars[0].subAreas[0].key, 'skill_1_1');
  assert.equal(request.skillsScanPillars[0].title, 'Updated college pillar wording');
  assert.equal(request.skillsScanPillars[0].subAreas[0].title, 'Updated college sub-area wording');
  assert.deepEqual(request.actionThemes, configuration.actionThemes);
  assert.deepEqual(request.ratingOptions, []);
});
