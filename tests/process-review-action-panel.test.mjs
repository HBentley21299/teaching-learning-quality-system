import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const requireWeb = createRequire(new URL('../apps/web/package.json', import.meta.url));
const ts = requireWeb('typescript'), react = requireWeb('react'), jsx = requireWeb('react/jsx-runtime');
const { renderToStaticMarkup } = requireWeb('react-dom/server');
const source = await readFile(new URL('../apps/web/src/components/ProcessReviewActionPanel.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const helpersSource = await readFile(new URL('../apps/web/src/services/processReviewTypes.ts', import.meta.url), 'utf8');
const helpersModule = { exports: {} };
new Function('exports', 'module', ts.transpileModule(helpersSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(helpersModule.exports, helpersModule);
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const action = (id = 'action-a', overrides = {}) => ({
  actionId: id, recordId: `record-${id}`, processKey: 'digital_learning_walk', recordTitle: `Review ${id}`,
  academicYear: '2026/27', title: `Improve access ${id}`, themeKey: 'area_2', ownerStaffId: `owner-${id}`,
  ownerName: 'Action Owner', dueDate: '2027-01-15', supportRequired: `Support ${id}`,
  successEvidence: `Success evidence ${id}`, progress: 'open', impactStatus: 'awaiting_evidence',
  rowVersion: `row-${id}-1`, updates: [], canEdit: true, ...overrides
});
function text(node) { return Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : node == null || typeof node === 'boolean' ? '' : String(node); }

async function panel({ initialAction = action(), getAction = () => initialAction, saveAction = (_id, request) => ({ ok: true, data: { ...initialAction, ...request, rowVersion: 'saved-version' } }), revision = 'register-v1', onChanged = async () => {} } = {}) {
  let cursor = 0, tree, needsRender = true, mounted = true;
  let props = { actionId: initialAction.actionId, revision, onChanged };
  const slots = [], effects = [], loads = [], saves = [], registered = [];
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[index].value, next => { const value = typeof next === 'function' ? next(slots[index].value) : next; if (!Object.is(value, slots[index].value)) { slots[index].value = value; needsRender = true; } }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect(effect, deps) { const index = cursor++, previous = slots[index]; if (!previous || deps.some((value, position) => !Object.is(value, previous.deps[position]))) { slots[index] = { deps }; effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = effect(); }); } }
  };
  const Button = ({ icon, variant, children, ...rest }) => react.createElement('button', rest, children);
  const LoadingState = ({ label }) => react.createElement('p', { role: 'status' }, label);
  const modules = {
    react: hooks, 'react/jsx-runtime': jsx,
    'lucide-react': new Proxy({}, { get: () => () => null }),
    '../app/routing': { actionPath: id => `/actions/${encodeURIComponent(id)}` },
    '../design-system/Button': { Button }, './LoadingState': { LoadingState },
    '../services/processReviewTypes': helpersModule.exports,
    './UnsavedChangesGuard': { confirmUnsavedNavigation: async () => true, useUnsavedChanges: editor => { registered.push(editor); return () => {}; } },
    '../services/api': { api: {
      processReviewAction: async id => { loads.push(id); return getAction(id, loads.length); },
      updateAssignedProcessReviewAction: async (id, request) => { const saved = structuredClone(request); saves.push({ id, request: saved }); return saveAction(id, saved); }
    } }
  };
  const module = { exports: {} };
  new Function('require', 'exports', 'module', compiled)(name => { assert.ok(name in modules, `Unexpected import ${name}`); return modules[name]; }, module.exports, module);
  function render() { if (!mounted) return; needsRender = false; cursor = 0; tree = module.exports.ProcessReviewActionPanel(props); }
  async function settle() {
    for (let round = 0; round < 30; round++) {
      if (needsRender) render();
      while (effects.length) effects.shift()();
      await flush();
      if (!needsRender || !mounted) return;
    }
    throw new Error('Action panel did not settle');
  }
  function nodes() { const output = []; function walk(node) { if (Array.isArray(node)) return node.forEach(walk); if (!node || typeof node !== 'object') return; output.push(node); walk(node.props?.children); } walk(tree); return output; }
  function control(label) { const group = nodes().find(node => node.type === 'label' && text(Array.isArray(node.props.children) ? node.props.children[0] : node.props.children) === label); assert.ok(group, `Missing field ${label}`); const children = Array.isArray(group.props.children) ? group.props.children : [group.props.children]; return children.find(node => ['input', 'textarea', 'select'].includes(node?.type)); }
  await settle();
  return {
    loads, saves, settle, nodes, control,
    markup: () => renderToStaticMarkup(tree),
    editor: () => registered.at(-1),
    async change(label, value) { const input = control(label); assert.ok(input, `Missing input ${label}`); input.props.onChange({ target: { value } }); await settle(); },
    async save() { const save = nodes().find(node => node.type === Button && /Save dated update|Saving…/.test(text(node.props.children))); assert.ok(save, 'Missing save action'); assert.equal(Boolean(save.props.disabled), false, 'Save should be available for an edited action'); save.props.onClick(); await settle(); },
    renderBeforeEffects(next) { props = { ...props, ...next }; render(); return renderToStaticMarkup(tree); },
    async rerender(next) { props = { ...props, ...next }; needsRender = true; await settle(); },
    unmount() { mounted = false; slots.forEach(slot => slot.cleanup?.()); }
  };
}

test('failed saves retain dated progress, barriers and next steps for retry', async () => {
  const page = await panel({ saveAction: () => ({ ok: false, message: 'A conflicting change was saved. Reload before trying again.' }) });
  await page.change('Progress update', 'Resources have been revised; learner feedback still needed.');
  await page.change('Barriers', 'Waiting for learner feedback');
  await page.change('Next step', 'Evaluate feedback at the next review');
  await page.save();
  assert.equal(page.saves.length, 1);
  assert.match(page.markup(), /role="alert"/);
  assert.match(page.markup(), /conflicting change/);
  assert.equal(page.control('Progress update').props.value, 'Resources have been revised; learner feedback still needed.');
  assert.equal(page.control('Barriers').props.value, 'Waiting for learner feedback');
  assert.equal(page.control('Next step').props.value, 'Evaluate feedback at the next review');
  assert.equal(page.editor().dirty, true);
});

test('a register refresh preserves unsaved inputs and the original concurrency token', async () => {
  const page = await panel();
  await page.change('Progress update', 'A local update that is not yet saved');
  const beforeEffects = page.renderBeforeEffects({ revision: 'register-v2' });
  assert.match(beforeEffects, /A local update that is not yet saved/);
  await page.settle();
  assert.equal(page.loads.length, 1, 'a background register refresh must not replace the editor');
  assert.equal(page.control('Progress update').props.value, 'A local update that is not yet saved');
  assert.match(page.markup(), /register refreshed.*unsaved update is retained/);
  await page.save();
  assert.equal(page.saves[0].request.rowVersion, 'row-action-a-1', 'the server must detect a conflicting saved update');
});

test('clean refresh loads the current row version and save preserves immutable action context', async () => {
  const original = action();
  const latest = action('action-a', { rowVersion: 'server-version-2', supportRequired: 'Updated specialist support' });
  const page = await panel({ getAction: (_id, call) => call === 1 ? original : latest });
  await page.rerender({ revision: 'register-v2' });
  await page.change('Progress update', 'Ready for the next checkpoint');
  await page.save();
  assert.equal(page.loads.length, 2);
  assert.equal(page.saves[0].id, original.actionId);
  assert.deepEqual(Object.fromEntries(['title', 'themeKey', 'ownerStaffId', 'supportRequired', 'successEvidence', 'rowVersion'].map(key => [key, page.saves[0].request[key]])), {
    title: latest.title, themeKey: latest.themeKey, ownerStaffId: latest.ownerStaffId,
    supportRequired: latest.supportRequired, successEvidence: latest.successEvidence, rowVersion: 'server-version-2'
  });
  assert.equal(page.editor().dirty, false);
});

test('keyed action replacement isolates a late response and saves only the new action context', async () => {
  const oldResponse = deferred();
  const old = await panel({ initialAction: action('old-action'), getAction: () => oldResponse.promise });
  assert.match(old.markup(), /Loading review action progress/);
  old.unmount();
  const nextAction = action('new-action', { rowVersion: 'new-version' });
  const next = await panel({ initialAction: nextAction });
  oldResponse.resolve(action('old-action'));
  await old.settle(); await next.settle();
  assert.match(next.markup(), /Support new-action/);
  assert.doesNotMatch(next.markup(), /Support old-action|Success evidence old-action/);
  await next.change('Progress update', 'An update for the new action only');
  await next.save();
  assert.equal(next.saves[0].id, 'new-action');
  assert.equal(next.saves[0].request.title, 'Improve access new-action');
  assert.equal(next.saves[0].request.ownerStaffId, 'owner-new-action');
  assert.equal(next.saves[0].request.rowVersion, 'new-version');
});

test('demonstrated impact requires evidence and accepts either observed-change text or an HTTPS evidence link', async () => {
  const missing = await panel();
  await missing.change('Impact assessment', 'demonstrated');
  await missing.save();
  assert.equal(missing.saves.length, 0);
  assert.match(missing.markup(), /Describe or link to the evidence/);
  assert.equal(missing.control('Impact assessment').props.value, 'demonstrated');
  for (const [label, evidence] of [
    ['Impact evidence and observed change', 'Learners now complete the task independently using the revised resources.'],
    ['Impact evidence link', 'https://college.example/evidence/learner-feedback']
  ]) {
    const page = await panel();
    await page.change('Impact assessment', 'demonstrated');
    await page.change(label, evidence);
    await page.save();
    assert.equal(page.saves.length, 1);
    assert.equal(page.saves[0].request.impactStatus, 'demonstrated');
  }
});

test('activity completion keeps impact separate, and changing a due date requires its reason', async () => {
  const page = await panel();
  await page.change('Activity progress', 'complete');
  assert.equal(page.control('Impact assessment').props.value, 'awaiting_evidence');
  await page.change('Implementation date', '2027-02-12');
  await page.save();
  assert.equal(page.saves.length, 0);
  assert.match(page.markup(), /Explain why the implementation date is changing/);
  await page.change('Reason for changing the deadline', 'Allow time to gather learner feedback');
  await page.save();
  assert.equal(page.saves[0].request.deadlineChangeReason, 'Allow time to gather learner feedback');
  assert.equal(page.saves[0].request.dueDate, '2027-02-12');
  assert.equal(page.saves[0].request.impactStatus, 'awaiting_evidence');
});

test('Activate actions show the streamlined context and retain every responsible person on a progress update', async () => {
  const shared = action('shared', { processKey: 'activate_growth_review', responsibleStaffIds: ['owner-shared', 'second-person'],
    responsibleStaff: [{ staffId: 'owner-shared', displayName: 'First Colleague' }, { staffId: 'second-person', displayName: 'Second Colleague' }],
    themeLabel: 'Assistive Technology', impactAreaKey: 'digital_teaching', impactAreaLabel: 'Digital teaching',
    detail: 'Review the accessibility of shared explanations.', reviewDate: '2027-01-15', supportRequired: '' });
  const page = await panel({ initialAction: shared });
  assert.match(page.markup(), /First Colleague; Second Colleague/);
  assert.match(page.markup(), /Impact measures/);
  assert.doesNotMatch(page.markup(), /Impact assessment|Support required|Teams links here/);
  await page.change('Progress update', 'Both colleagues reviewed the revised resources.');
  await page.save();
  assert.deepEqual(page.saves[0].request.responsibleStaffIds, ['owner-shared', 'second-person']);
  assert.equal(page.saves[0].request.impactAreaKey, 'digital_teaching');
  assert.equal(page.saves[0].request.detail, shared.detail);
});

test('changing an Activate review date keeps both native and central action dates aligned', async () => {
  const page = await panel({ initialAction: action('activate', { processKey: 'activate_growth_review', reviewDate: '2027-01-15' }) });
  await page.change('Review date', '2027-02-12');
  await page.save();
  assert.equal(page.saves.length, 0);
  assert.match(page.markup(), /Explain why the review date/);
  await page.change('Reason for changing the review date', 'Coordinate the review with the whole team.');
  await page.save();
  assert.equal(page.saves[0].request.reviewDate, '2027-02-12');
  assert.equal(page.saves[0].request.dueDate, '2027-02-12');
});

test('earlier Activate support and dated impact evidence remain readable without reintroducing impact inputs', async () => {
  const page = await panel({ initialAction: action('earlier', { processKey: 'activate_growth_review',
    supportRequired: 'Earlier specialist support', impactStatus: 'assessing', impactEvidence: 'Earlier learner feedback',
    impactEvidenceLink: 'https://college.example/earlier-evidence', updates: [{ updateId: 'previous', updatedAt: '2026-10-01T09:00:00Z',
      updatedByName: 'Earlier Reviewer', progress: 'open', impactStatus: 'demonstrated', impactEvidence: 'Dated evidence of improvement',
      impactEvidenceLink: 'https://college.example/dated-evidence', dueDate: '2027-01-15' }] }) });
  assert.match(page.markup(), /Earlier support and impact · read only/);
  assert.match(page.markup(), /Earlier specialist support/);
  assert.match(page.markup(), /Earlier learner feedback/);
  assert.match(page.markup(), /Dated evidence of improvement/);
  assert.match(page.markup(), /https:\/\/college.example\/dated-evidence/);
  assert.throws(() => page.control('Impact assessment'), /Missing field/);
  assert.throws(() => page.control('Impact evidence and observed change'), /Missing field/);
});
