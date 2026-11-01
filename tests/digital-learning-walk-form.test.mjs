import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const web = createRequire(new URL('../apps/web/package.json', import.meta.url));
const ts = web('typescript'), React = web('react'), jsx = web('react/jsx-runtime');
const { renderToStaticMarkup } = web('react-dom/server');
async function load(path, imports = {}) {
  const source = await readFile(new URL(`../apps/web/src/${path}`, import.meta.url), 'utf8');
  const module = { exports: {} };
  new Function('require', 'exports', 'module', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText)(name => imports[name] || {}, module.exports, module);
  return module.exports;
}
const delivery = await load('services/learningWalkDeliveryAreas.ts');
const reviewHelpers = await load('services/processReviewTypes.ts');
const sharedScale = [
  ['emerging_practice', 'Emerging Practice', '#D7E7F3', 'Practice is not yet clearly evident or consistently applied.'],
  ['developing_practice', 'Developing Practice', '#A9DDD2', 'Practice is evident but remains new, variable or inconsistent.'],
  ['secure_practice', 'Secure Practice', '#3FAE5A', 'Practice is usually effective and has a clear positive impact on learners.'],
  ['strong_practice', 'Strong Practice', '#176B3A', "Practice is consistently effective, embedded and responsive to learners' needs."],
  ['exceptional_practice', 'Exceptional Practice', '#1565A8', 'Practice is sustained, highly effective and shared to support others.']
].map(([key, wording, colorHex, guidanceText], index) => ({ key, label: `${index + 1} – ${wording}`, score: index + 1, colorHex, guidanceText }));
const configuration = { processKey: 'digital_learning_walk', title: 'Digital Learning Walks', version: 1, standards: [
  { key: 'agency', title: 'Learner Agency & Ownership', statements: [{ key: 'revisit', text: 'Learners revisit digital learning independently.' }, { key: 'choice', text: 'Learners make purposeful choices.' }] },
  { key: 'safety', title: 'Digital Citizenship & Safety', statements: [{ key: 'safe', text: 'Learners protect their accounts.' }] }
], ratingOptions: sharedScale, fieldLabels: {}, settings: { ratingScaleSource: 'learning_walk', evidenceMode: 'ratings_only' } };
const request = () => ({ title: '', academicYear: '2026/27', facultyOrgUnitId: 'faculty', teamOrgUnitId: 'child', recordDate: '2026-10-30', submit: false,
  data: { fields: {}, samples: [], responses: [], digital: { selectedStandardKeys: [], selectedStatementKeys: [], draftActions: [] } } });
const text = value => Array.isArray(value) ? value.map(text).join('') : value?.props ? text(value.props.children) : value == null || typeof value === 'boolean' ? '' : String(value);
const tick = () => new Promise(resolve => setImmediate(resolve));
export async function mountDigitalForm(overrides = {}, apiOverrides = {}) {
  let current = overrides.request || request(), props, cursor = 0, changed = true, tree;
  const slots = [], effects = [], saves = [], submissions = [], apiCalls = [];
  const hooks = {
    useId: () => 'dlw-test',
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, next => { const value = typeof next === 'function' ? next(slots[i].value) : next; if (!Object.is(value, slots[i].value)) { slots[i].value = value; changed = true; } }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect(effect, deps) { const i = cursor++, previous = slots[i]; if (!previous || deps.some((value, at) => !Object.is(value, previous.deps[at]))) { slots[i] = { deps }; effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = effect(); }); } }
  };
  const Button = ({ busy, icon, variant, children, ...rest }) => React.createElement('button', { ...rest, disabled: rest.disabled || busy }, children);
  const Staff = ({ label }) => React.createElement('input', { 'aria-label': label });
  const api = new Proxy({ learningWalkDeliveryAreas: async () => [{ key: 'classroom', name: 'Classroom', isActive: true }], ...apiOverrides }, { get(target, key) { assert.ok(key in target, `Unexpected API ${String(key)}`); return (...args) => { apiCalls.push({ key, args }); return target[key](...args); }; } });
  const ownerRequests = [];
  const component = (await load('components/DigitalLearningWalkForm.tsx', { react: hooks, 'react/jsx-runtime': jsx, 'lucide-react': new Proxy({}, { get: () => () => null }),
    '../design-system/Button': { Button }, './StaffSearchSelect': { StaffSearchSelect: Staff }, './WorkflowFeedback': { WorkflowFeedback: ({ message }) => message ? React.createElement('p', null, message) : null },
    './useActionOwners': { useActionOwners: (...args) => { ownerRequests.push(args); return { owners: [{ staffId: 'leader' }], loading: false, error: '', retry() {} }; } },
    '../services/api': { api }, '../app/routing': { actionPath: id => `/actions/${id}` }, '../services/learningWalkDeliveryAreas': delivery, '../services/processReviewTypes': reviewHelpers })).DigitalLearningWalkForm;
  props = { request: current, configuration, detail: null, user: { displayName: 'Reviewer' },
    staff: [{ id: 'leader', displayName: 'Programme Leader' }, { id: 'tutor', displayName: 'Tutor' }], orgUnits: [
      { id: 'faculty', name: 'Faculty', orgUnitType: 'faculty', isActive: true },
      { id: 'area', parentOrgUnitId: 'faculty', name: 'Area', orgUnitType: 'faculty_child', isActive: true },
      { id: 'child', parentOrgUnitId: 'area', name: 'Sub-team', orgUnitType: 'faculty_child_code', isActive: true }
    ], readOnly: false, saving: false, dirty: false, message: '', messageTone: 'neutral',
    onChange(patch) { current = { ...current, ...(typeof patch === 'function' ? patch(current) : patch) }; props.request = current; changed = true; },
    onSave: async () => { saves.push(structuredClone(current)); return false; }, onSubmit: async () => { submissions.push(structuredClone(current)); return false; }, onCancel() {}, onDismissMessage() {}, ...overrides };
  async function settle() { for (let i = 0; i < 30; i++) { if (changed) { cursor = 0; changed = false; tree = component(props); } while (effects.length) effects.shift()(); await tick(); if (!changed && !effects.length) return; } throw new Error('DLW form did not settle'); }
  const nodes = () => { const result = []; function visit(node) { if (Array.isArray(node)) return node.forEach(visit); if (!node?.props) return; result.push(node); visit(node.props.children); } visit(tree); return result; };
  function field(label) {
    const group = nodes().find(node => node.type === 'label' && text(Array.isArray(node.props.children) ? node.props.children[0] : node.props.children).replace(/Required$/, '').trim() === label);
    assert.ok(group, `Missing field ${label}`); return (Array.isArray(group.props.children) ? group.props.children : [group.props.children]).find(node => ['input', 'select', 'textarea'].includes(node?.type));
  }
  await settle();
  return { nodes, saves, submissions, apiCalls, ownerRequests, field, get request() { return current; }, markup: () => renderToStaticMarkup(tree),
    async choose(category, checked) { const input = nodes().find(node => node.type === 'input' && node.props.type === 'checkbox' && node.props['aria-label'] === category); assert.ok(input, `Missing category ${category}`); input.props.onChange({ target: { checked } }); await settle(); },
    async click(label) { const button = nodes().find(node => [Button, 'button'].includes(node.type) && (node.props['aria-label'] === label || text(node.props.children) === label)); assert.ok(button, `Missing button ${label}`); assert.ok(!button.props.disabled); button.props.onClick(); await settle(); },
    async change(label, value) { field(label).props.onChange({ target: { value } }); await settle(); },
    async owner(value) { const picker = nodes().find(node => node.type === Staff); assert.ok(picker); picker.props.onChange(value); await settle(); },
    async rerender(next) { props = { ...props, ...next }; changed = true; await settle(); }
  };
}

test('DLW follows the continuous Learning Walk sections and actual child organisation choices', async () => {
  const page = await mountDigitalForm();
  assert.match(page.markup(), /Context and focus/); assert.match(page.markup(), /Practice observed/); assert.match(page.markup(), /Actions/);
  assert.doesNotMatch(page.markup(), /Scope and context|Findings|Good practice observed|Areas for development/);
  assert.doesNotMatch(page.markup(), /form sections|Check &amp; submit|Review title|Evidence samples|Add sample|Linked evidence samples|Earlier evidence/);
  assert.match(page.markup(), /value="child" selected="">Sub-team/);
  assert.deepEqual(page.apiCalls[0], { key: 'learningWalkDeliveryAreas', args: ['learning_walk'] });
});

test('DLW category selection uses one checkbox per category and includes every child criterion', async () => {
  const page = await mountDigitalForm();
  const boxes = () => page.nodes().filter(node => node.type === 'input' && node.props.type === 'checkbox');
  assert.deepEqual(boxes().map(node => node.props['aria-label']), configuration.standards.map(standard => standard.title));
  assert.match(page.markup(), /2 criteria/);
  assert.equal(page.nodes().filter(node => node.type === 'button' && node.props['aria-pressed'] !== undefined).length, 0);
  await page.choose('Learner Agency & Ownership', true);
  assert.deepEqual(page.request.data.digital.selectedStandardKeys, ['agency']);
  assert.deepEqual(page.request.data.digital.selectedStatementKeys, ['revisit', 'choice']);
  assert.equal(page.nodes().filter(node => node.type === 'button' && node.props['aria-pressed'] !== undefined).length, 10);
  assert.equal(boxes().length, 2);
  assert.match(page.markup(), /Learners revisit digital learning independently/);
  assert.match(page.markup(), /Learners make purposeful choices/);
  await page.choose('Digital Citizenship & Safety', true);
  assert.deepEqual(page.request.data.digital.selectedStandardKeys, ['agency', 'safety']);
  assert.deepEqual(page.request.data.digital.selectedStatementKeys, ['revisit', 'choice', 'safe']);
  await page.choose('Learner Agency & Ownership', false);
  assert.deepEqual(page.request.data.digital.selectedStandardKeys, ['safety']);
  assert.deepEqual(page.request.data.digital.selectedStatementKeys, ['safe']);
  assert.doesNotMatch(page.markup(), /aria-label="1 – Emerging Practice: Learners make purposeful choices/);
});

test('selected DLW categories use the shared five-level Learning Walk scale without per-criterion narrative or samples', async () => {
  const page = await mountDigitalForm();
  await page.choose('Digital Citizenship & Safety', true);
  const cards = page.nodes().filter(node => node.type === 'button' && node.props['aria-pressed'] !== undefined);
  assert.equal(cards.length, 5);
  for (let index = 0; index < sharedScale.length; index++) {
    assert.equal(cards[index].props['aria-label'], `${sharedScale[index].label}: Learners protect their accounts.`);
    const children = cards[index].props.children;
    assert.equal(children.find(node => node.type === 'i').props.style.backgroundColor, sharedScale[index].colorHex);
    assert.match(page.markup(), new RegExp(sharedScale[index].label));
  }
  assert.match(page.markup(), /Practice is sustained, highly effective and shared to support others/);
  await page.click('4 – Strong Practice: Learners protect their accounts.');
  assert.deepEqual(page.request.data.digital.selectedStatementKeys, ['safe']);
  assert.deepEqual(page.request.data.responses[0], { statementKey: 'safe', sampleIds: [], ratingKey: 'strong_practice' });
  assert.doesNotMatch(page.markup(), /aria-label="1 – Emerging Practice: Learners make purposeful choices|Evidence and rationale|Evidence samples|Linked evidence samples|Add sample/);
  assert.equal(page.nodes().filter(node => node.type === 'textarea').length, 0);
  await page.click('Submit form');
  assert.deepEqual(page.submissions[0].data.samples, []);
  assert.deepEqual(page.submissions[0].data.responses[0].sampleIds, []);
  await page.choose('Digital Citizenship & Safety', false); await page.choose('Digital Citizenship & Safety', true);
  assert.equal(page.request.data.responses[0].ratingKey, 'strong_practice');
});

test('removing and reselecting a category retains local ratings and earlier notes without filling missing ratings', async () => {
  const current = request(); current.data.responses = [{ statementKey: 'revisit', sampleIds: [], rationale: 'Learners revisit the course independently.' }];
  const page = await mountDigitalForm({ request: current });
  await page.choose('Learner Agency & Ownership', true);
  await page.click('3 – Secure Practice: Learners revisit digital learning independently.');
  const answers = structuredClone(page.request.data.responses);
  await page.choose('Learner Agency & Ownership', false);
  assert.deepEqual(page.request.data.responses, answers);
  await page.choose('Learner Agency & Ownership', true);
  assert.deepEqual(page.request.data.responses, answers);
  assert.match(page.markup(), /Learners revisit the course independently/);
  await page.click('Submit form');
  assert.deepEqual(page.submissions[0].data.digital.selectedStatementKeys, ['revisit', 'choice']);
  assert.equal(page.submissions[0].data.responses.length, 1);
  assert.equal(page.submissions[0].data.responses.some(response => response.statementKey === 'choice'), false);
});

test('opening a legacy partial category preserves its exact saved coverage, ratings and clean state', async () => {
  const current = request(); delete current.data.digital.selectedStandardKeys;
  current.data.digital.selectedStatementKeys = ['revisit'];
  current.data.responses = [{ statementKey: 'revisit', ratingKey: 'earlier-rating', sampleIds: [], rationale: 'Saved partial reasoning' }];
  const saved = structuredClone(current);
  const fingerprint = reviewHelpers.processReviewFingerprint(current);
  const page = await mountDigitalForm({ request: current });
  assert.deepEqual(page.request, saved);
  assert.equal(reviewHelpers.processReviewFingerprint(page.request), fingerprint);
  assert.match(page.markup(), /Earlier partial selection: 1 of 2/);
  assert.match(page.markup(), /Saved rating: earlier-rating/);
  assert.doesNotMatch(page.markup(), /aria-label="1 – Emerging Practice: Learners make purposeful choices/);
  const category = page.nodes().find(node => node.type === 'input' && node.props['aria-label'] === 'Learner Agency & Ownership');
  assert.equal(category.props.checked, false); assert.equal(category.props['aria-checked'], 'mixed');
  const element = {}; category.props.ref(element); assert.equal(element.indeterminate, true);
  await page.click('Save draft');
  assert.deepEqual(page.saves[0], saved);
  await page.choose('Digital Citizenship & Safety', true);
  assert.deepEqual(page.request.data.digital.selectedStandardKeys, ['agency', 'safety']);
  assert.deepEqual(page.request.data.digital.selectedStatementKeys, ['revisit', 'choice', 'safe']);
  assert.deepEqual(page.request.data.responses, saved.data.responses);
  assert.doesNotMatch(page.markup(), /Earlier partial selection/);
});

test('read-only legacy partial categories display only saved criteria and remain unchanged', async () => {
  const current = request(); current.data.digital.selectedStandardKeys = null;
  current.data.digital.selectedStatementKeys = ['choice'];
  current.data.responses = [{ statementKey: 'choice', ratingKey: 'secure_practice', sampleIds: [], rationale: 'Saved criterion' }];
  const saved = structuredClone(current);
  const page = await mountDigitalForm({ request: current, readOnly: true });
  assert.match(page.markup(), /Partially selected categories show only those saved criteria/);
  assert.match(page.markup(), /Earlier partial selection: 1 of 2/);
  assert.doesNotMatch(page.markup(), /aria-label="1 – Emerging Practice: Learners revisit digital learning independently/);
  assert.equal(page.nodes().filter(node => node.type === 'button' && node.props['aria-pressed'] !== undefined).length, 5);
  assert.deepEqual(page.request, saved);
});

test('earlier walks without digital focus metadata do not gain extra criteria merely by opening', async () => {
  const current = request(); delete current.data.digital;
  current.data.responses = [{ statementKey: 'choice', ratingKey: 'secure_practice', sampleIds: [], rationale: 'Earlier reasoning' }];
  const saved = structuredClone(current);
  const page = await mountDigitalForm({ request: current });
  assert.match(page.markup(), /Earlier partial selection: 1 of 2/);
  assert.equal(page.nodes().filter(node => node.type === 'button' && node.props['aria-pressed'] !== undefined).length, 5);
  assert.deepEqual(page.request, saved);
});

test('category selection is authoritative even when an earlier compatibility statement list is stale', async () => {
  const current = request(); current.data.digital.selectedStandardKeys = ['agency'];
  current.data.digital.selectedStatementKeys = ['safe'];
  const page = await mountDigitalForm({ request: current });
  assert.equal(page.nodes().filter(node => node.type === 'button' && node.props['aria-pressed'] !== undefined).length, 10);
  assert.doesNotMatch(page.markup(), /aria-label="1 – Emerging Practice: Learners protect their accounts/);
});

test('four-field actions remain in the draft payload without calling live action APIs', async () => {
  const page = await mountDigitalForm(); await page.click('Add action');
  await page.change('Action theme', 'safety'); await page.change('Action 1', 'Review digital account guidance'); await page.owner('leader'); await page.change('Date to be implemented by', '2026-12-01');
  await page.click('Save draft');
  assert.equal(page.saves.length, 1); assert.equal(page.saves[0].data.digital.draftActions.length, 1);
  assert.deepEqual(Object.fromEntries(['themeKey', 'title', 'ownerStaffId', 'dueDate'].map(key => [key, page.saves[0].data.digital.draftActions[0][key]])), { themeKey: 'safety', title: 'Review digital account guidance', ownerStaffId: 'leader', dueDate: '2026-12-01' });
  assert.ok(page.request.data.digital.draftActions[0].id); assert.equal(page.apiCalls.length, 1);
  assert.deepEqual(page.ownerRequests.at(-1), [undefined, undefined, 'digital_learning_walk', true]);
  assert.match(page.markup(), /Programme Leader/); assert.doesNotMatch(page.markup(), /Support required|Success evidence|Save the review as a draft before/);
});

test('an unavailable shared scale permits drafts while submission and rating cards remain unavailable', async () => {
  const page = await mountDigitalForm({ configuration: { ...configuration, ratingOptions: [] } });
  await page.choose('Learner Agency & Ownership', true); await page.click('Save draft');
  assert.equal(page.saves.length, 1); assert.match(page.markup(), /Learning Walk rating scale is unavailable/);
  const submit = page.nodes().find(node => text(node.props.children) === 'Submit form' && node.props.onClick); assert.equal(submit.props.disabled, true);
  assert.equal(page.submissions.length, 0); assert.doesNotMatch(page.markup(), /Emerging|Exceptional Practice/);
});

test('read-only walks keep criteria, ratings and action assignment disabled while evidence remains readable', async () => {
  const current = request(); current.data.digital.selectedStandardKeys = ['safety']; current.data.digital.selectedStatementKeys = ['safe']; current.data.responses = [{ statementKey: 'safe', ratingKey: 'emerging_practice', sampleIds: [], rationale: 'Saved rationale' }];
  const page = await mountDigitalForm({ request: current, readOnly: true });
  assert.ok(page.nodes().some(node => node.type === 'fieldset' && node.props.className === 'digital-walk-editable' && node.props.disabled));
  assert.ok(page.nodes().filter(node => node.type === 'button' && node.props['aria-pressed'] !== undefined).every(node => node.props.disabled));
  assert.match(page.markup(), /Saved rationale/); assert.doesNotMatch(page.markup(), /Linked evidence samples|Add sample|>Save draft<|>Submit form</);
  assert.equal(page.ownerRequests.at(-1)[3], false);
});

test('earlier samples and criterion notes remain read only and survive rating changes', async () => {
  const current = request();
  delete current.data.digital.selectedStandardKeys;
  current.data.samples = [{ id: 'earlier-sample', title: 'Earlier digital portfolio', sampleType: 'learner_work', sampleDate: '2026-10-01',
    course: 'Digital course', staffIds: ['leader'], notes: 'Earlier feedback and evidence', evidenceLink: 'https://college.example/earlier-evidence' }];
  current.data.digital.selectedStatementKeys = ['safe'];
  current.data.responses = [{ statementKey: 'safe', ratingKey: 'strong_practice', sampleIds: ['earlier-sample'], rationale: 'Earlier criterion note' }];
  const previousSamples = structuredClone(current.data.samples);
  const page = await mountDigitalForm({ request: current });
  assert.match(page.markup(), /Earlier evidence · read only|Earlier digital portfolio|Earlier feedback and evidence/);
  assert.match(page.markup(), /https:\/\/college.example\/earlier-evidence/);
  assert.match(page.markup(), /Programme Leader/);
  assert.doesNotMatch(page.markup(), /Evidence samples|Linked evidence samples|Add sample|Remove sample|Sample title/);
  assert.match(page.markup(), /Earlier criterion notes · read only/);
  assert.equal(page.nodes().filter(node => node.type === 'textarea').length, 0);
  await page.click('3 – Secure Practice: Learners protect their accounts.');
  await page.click('Save draft');
  assert.deepEqual(page.saves[0].data.samples, previousSamples);
  assert.deepEqual(page.saves[0].data.responses[0].sampleIds, ['earlier-sample']);
  assert.equal(page.saves[0].data.responses[0].rationale, 'Earlier criterion note');
  assert.equal(page.saves[0].data.responses[0].ratingKey, 'secure_practice');
});

test('saved retired delivery choices retain their stable key and displayed name during a lookup failure', async () => {
  const current = request(); current.data.fields = { deliveryAreaKey: 'retired', deliveryAreaName: 'Earlier delivery area' };
  const page = await mountDigitalForm({ request: current }, { learningWalkDeliveryAreas: async () => { throw new Error('Unavailable'); } });
  assert.match(page.markup(), /Earlier delivery area \(saved\)/); assert.match(page.markup(), /Saved choices and your entries are retained/);
  assert.equal(page.request.data.fields.deliveryAreaKey, 'retired');
});

test('admin delivery-area wording is used while the stored lookup key remains independent', async () => {
  const page = await mountDigitalForm({ configuration: { ...configuration, fieldLabels: { deliveryAreaName: 'Teaching delivery context' } } });
  assert.ok(page.field('Teaching delivery context'));
  await page.change('Teaching delivery context', 'classroom');
  assert.equal(page.request.data.fields.deliveryAreaKey, 'classroom');
  assert.equal(page.request.data.fields.deliveryAreaName, 'Classroom');
});
