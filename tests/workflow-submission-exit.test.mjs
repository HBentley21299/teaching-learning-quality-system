import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const web = createRequire(new URL('../apps/web/package.json', import.meta.url));
const ts = web('typescript'), jsx = web('react/jsx-runtime');
globalThis.window = { addEventListener() {}, removeEventListener() {}, requestAnimationFrame(callback) { callback(); }, confirm() { return true; } };
const noop = () => {};
async function load(path, imports = {}, expose = '') {
  const source = await readFile(new URL(`../apps/web/src/${path}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function('require', 'exports', 'module', code + expose)(name => imports[name] ?? new Proxy({}, { get: () => function Placeholder() { return null; } }), module.exports, module);
  return module.exports;
}
const list = await load('services/listQuery.ts');
const liv = await load('services/livWorkflow.ts');
const actions = await load('services/dashboardActionState.ts');
const probationActions = await load('services/saveProbationActions.ts');

// Run real route editor hooks and handlers. All APIs are in-memory stubs: these
// tests never create cases, actions, signatures or records in the application.
async function editor(file, name, initialProps, responses = {}, navigationAllowed = true) {
  let cursor = 0, changed = true, tree, props = { ...initialProps };
  const slots = [], effects = [], calls = [], guards = new Map();
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, next => { const value = typeof next === 'function' ? next(slots[i].value) : next; if (!Object.is(slots[i].value, value)) { slots[i].value = value; changed = true; } }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useId() { return `exit-test-${cursor++}`; }, useMemo(factory) { return factory(); }, useCallback(callback) { return callback; },
    useEffect(effect, deps) { const i = cursor++, previous = slots[i]; if (!previous || deps?.some((value, index) => !Object.is(value, previous.deps?.[index]))) { const current = { deps }; slots[i] = current; effects.push(() => { previous?.cleanup?.(); current.cleanup = effect(); }); } }
  };
  const api = new Proxy({}, { get: (_, key) => async (...args) => { calls.push([key, ...args]); assert.ok(key in responses, `Unexpected API ${String(key)}`); return typeof responses[key] === 'function' ? responses[key](...args) : structuredClone(responses[key]); } });
  if ('isSaving' in props) props.setIsSaving = value => { props = { ...props, isSaving: value }; changed = true; };
  if (name === 'UcoTlaReviewWorkspace') {
    props.setMessage = value => { props = { ...props, message: value }; changed = true; };
    props.onChanged = async (detail, message) => { props = { ...props, detail, message }; changed = true; };
  }
  const imports = {
    react: hooks, 'react/jsx-runtime': jsx, '../services/api': { api }, '../services/listQuery': list,
    '../services/livWorkflow': liv, '../services/dashboardActionState': actions, '../services/saveProbationActions': probationActions,
    '../services/formContent': { useFormContent: () => ({ field: (_key, label, helpText) => ({ label, helpText }) }) },
    '../services/workflowExperience': { focusWorkflowControl: noop },
    '../components/useActionOwners': { useActionOwners: () => ({ owners: initialProps.ownerOptions ?? [], loading: false, error: '', retry: noop }) },
    '../components/UnsavedChangesGuard': { useUnsavedChanges: config => { guards.set(config.label, config); return () => { const latest = guards.get(config.label); if (latest) Object.assign(latest, { dirty: false, saving: false }); }; }, confirmUnsavedNavigation: async () => { calls.push(['confirmNavigation']); return navigationAllowed; } }
  };
  const Component = (await load(`routes/${file}`, imports, `\nmodule.exports.TestEditor = ${name};`)).TestEditor;
  function nodes() { const found = []; const visit = node => { if (Array.isArray(node)) node.forEach(visit); else if (node?.props) { found.push(node); visit(node.props.children); } }; visit(tree); return found; }
  async function settle() { for (let i = 0; i < 30; i++) { if (changed) { cursor = 0; changed = false; tree = Component(props); } while (effects.length) effects.shift()(); await new Promise(resolve => setImmediate(resolve)); if (!changed && !effects.length) return; } throw new Error('Editor did not settle'); }
  await settle();
  return { calls, guards, nodes, settle, message: () => props.message,
    async narrative(label, value) { const node = nodes().find(node => node.props.content?.label === label); assert.ok(node, label); node.props.onChange(value); await settle(); },
    async native(node, value) { assert.ok(node); node.props.onChange({ target: { value, checked: value } }); await settle(); },
    async input(label, value) { const node = nodes().find(node => node.props.label === label && node.props.onChange); assert.ok(node, label); node.props.onChange(value); await settle(); },
    async action(label, operation) { const callback = guards.get(label)?.[operation]; assert.equal(typeof callback, 'function', `${label} ${operation}`); const result = await callback(); await settle(); return result; },
    async discard(label) { guards.get(label).onDiscard(); await settle(); },
    async click(text) { const node = nodes().find(node => node.props.onClick && node.props.children === text); assert.ok(node, text); await node.props.onClick(); await settle(); }
  };
}
const configuration = { developmentOpportunities: [], deliveryAreas: [{ key: 'classroom', name: 'Classroom' }], courseLevels: [{ key: 'level_2', name: 'Level 2' }], rubricAreas: [] };
const livProps = (overrides = {}) => ({ stage: { id: 'stage', stageType: 'pre_discussion', stageStatus: 'in_progress', canEdit: true, developmentOpportunityKeys: [] }, record: { id: 'liv', recordId: 'record', subjectStaffId: 'subject', visits: [], canEdit: true }, cycle: { id: 'cycle', cycleNumber: 1, status: 'in_progress' }, configuration, actions: [], previousActions: [], ownerOptions: [{ staffId: 'subject', displayName: 'Subject' }], staff: [], onChanged: async () => {}, processKey: 'liv', ...overrides });
const probationProps = (overrides = {}) => ({ record: { id: 'case', recordId: 'record', subjectStaffId: 'subject', canEdit: true }, observation: { id: 'observation', observationNumber: 1 }, stage: { id: 'stage', stageType: 'professional_discussion', stageStatus: 'in_progress', canEdit: true, developmentOpportunityKeys: [] }, configuration, actions: [], staff: [], onChanged: async () => {}, ...overrides });
const ucoDetail = (caps = {}, status = 'observer_draft') => ({ review: { recordId: 'uco', academicYear: '2026/27', workflowStatus: status, lecturerStaffId: 'lecturer', lecturerName: 'Lecturer', observerName: 'Observer', rowVersion: 'initial', capabilities: { canEditObserverSection: false, canReflect: false, ...caps } }, responses: {}, actionPlan: [], sectionCompletion: {} });
const ucoProps = detail => ({ detail, access: { ucoStaff: [] }, isSaving: false, isLoading: false, message: '', onBack: noop, onOpenReview: async () => {}, onChanged: async () => {}, setIsSaving: noop, setMessage: noop });

test('LIV draft saving never completes a selected stage; formal completion is explicit and cancel writes nothing', async () => {
  const page = await editor('LivVisits.tsx', 'LivStageEditor', livProps({ processKey: 'als_liv' }), { updateLivStage: { ok: true } });
  await page.narrative('Context', 'Partial discussion');
  await page.native(page.nodes().find(node => node.type === 'input' && node.props.type === 'checkbox'), true);
  assert.equal(page.guards.get('LIV pre discussion').submission, true);
  assert.equal(await page.action('LIV pre discussion', 'onSave'), true);
  assert.equal(page.calls.find(call => call[0] === 'updateLivStage')[3].stageStatus, 'in_progress');
  assert.equal(page.calls.find(call => call[0] === 'updateLivStage')[4], 'als_liv');
  await page.narrative('Context', 'Ready for this stage');
  assert.equal(page.guards.get('LIV pre discussion').submitLabel, 'Complete stage');
  assert.equal(await page.action('LIV pre discussion', 'onSubmit'), true);
  assert.equal(page.calls.filter(call => call[0] === 'updateLivStage').at(-1)[3].stageStatus, 'completed');
  await page.narrative('Context', 'Discard this change'); const count = page.calls.length;
  await page.discard('LIV pre discussion'); assert.equal(page.calls.length, count);
  assert.equal(page.nodes().find(node => node.props.content?.label === 'Context').props.value, 'Ready for this stage', 'cancel retains the most recently saved work even before a parent refresh');
  assert.equal(page.calls.some(call => call[0] === 'completeLivCycle'), false);
});

test('LIV visit exit callbacks retain validation and failed input rather than claiming a saved or completed stage', async () => {
  const base = livProps(); base.stage = { ...base.stage, stageType: 'visit', visitId: 'visit' };
  const page = await editor('LivVisits.tsx', 'LivStageEditor', base, { updateLivVisit: { ok: false, message: 'Visit rejected.' } });
  const visitControl = () => page.nodes().find(node => node.props.idPrefix === 'liv-visit-visit');
  visitControl().props.onChange({ ...visitControl().props.value, reflectionNotes: 'Keep my notes' }); await page.settle();
  assert.equal(await page.action('LIV visit', 'onSubmit'), false);
  assert.equal(page.calls.length, 0);
  assert.equal(page.nodes().find(node => Array.isArray(node.props.errors))?.props.errors.length, 2);
  visitControl().props.onChange({ ...visitControl().props.value, courseLevel: 'level_2', deliveryAreaKey: 'classroom' }); await page.settle();
  assert.equal(await page.action('LIV visit', 'onSubmit'), false);
  assert.equal(visitControl().props.value.reflectionNotes, 'Keep my notes');
  assert.equal(page.guards.get('LIV visit').dirty, true);
  assert.equal(page.calls.some(call => call[0] === 'updateLivStage'), false);
});

test('completed LIV corrections remain ordinary saves without an exit completion action', async () => {
  const base = livProps(); base.stage = { ...base.stage, stageStatus: 'completed' };
  const page = await editor('LivVisits.tsx', 'LivStageEditor', base, { updateLivStage: { ok: true } });
  await page.narrative('Context', 'A correction');
  assert.equal(page.guards.get('LIV pre discussion').submission, false);
  assert.equal(page.guards.get('LIV pre discussion').onSubmit, undefined);
  assert.equal(await page.action('LIV pre discussion', 'onSave'), true);
  assert.equal(page.calls[0][3].stageStatus, 'completed');
});

test('probation visit saves incomplete progress as in_progress and preserves answers after rejected completion', async () => {
  const base = probationProps(); base.stage = { ...base.stage, stageType: 'visit_rubric' };
  const page = await editor('ProbationObservations.tsx', 'ProbationStageEditor', base, { updateProbationVisit: (_case, _observation, request) => request.stageStatus === 'completed' ? { ok: false, message: 'Delivery area is required.' } : { ok: true } });
  const visit = () => page.nodes().find(node => node.props.value?.ratings && node.props.onChange);
  visit().props.onChange({ ...visit().props.value, keyPoints: 'Partial observation', stageStatus: 'completed' }); await page.settle();
  assert.equal(await page.action('Probation visit rubric', 'onSave'), true);
  assert.equal(page.calls[0][3].stageStatus, 'in_progress');
  visit().props.onChange({ ...visit().props.value, keyPoints: 'Keep these details' }); await page.settle();
  assert.equal(await page.action('Probation visit rubric', 'onSubmit'), false);
  assert.equal(page.calls.at(-1)[3].stageStatus, 'completed');
  assert.equal(visit().props.value.keyPoints, 'Keep these details');
  assert.equal(page.guards.get('Probation visit rubric').dirty, true);
  assert.equal(page.calls.some(call => call[0] === 'completeProbationObservation'), false);
});

test('new LIV actions offer explicit creation without advertising a nonexistent draft save', async () => {
  const page = await editor('LivVisits.tsx', 'LivActions', livProps(), { createAction: { ok: false, message: 'Creation failed.' } });
  await page.click('Add action');
  const theme = page.nodes().find(node => node.props.id === 'liv-action-theme-cycle'); theme.props.onChange('Teaching'); await page.settle();
  await page.native(page.nodes().find(node => node.type === 'textarea'), 'Action to keep');
  assert.equal(page.guards.get('New LIV action').onSave, undefined);
  assert.equal(page.guards.get('New LIV action').submitLabel, 'Create action');
  assert.equal(await page.action('New LIV action', 'onSubmit'), false); assert.equal(page.calls.length, 0, 'required owner and date are still validated');
  await page.native(page.nodes().find(node => node.type === 'select'), 'subject');
  await page.native(page.nodes().find(node => node.type === 'input' && node.props.type === 'date'), '2026-11-01');
  assert.equal(await page.action('New LIV action', 'onSubmit'), false);
  assert.equal(page.nodes().find(node => node.type === 'textarea').props.value, 'Action to keep');
  const count = page.calls.length; await page.discard('New LIV action'); assert.equal(page.calls.length, count);
});

test('probation action creation stays separate from saving the action stage', async () => {
  const base = probationProps({ ownerOptions: [{ staffId: 'subject', displayName: 'Subject' }] }); base.stage = { ...base.stage, stageType: 'actions' };
  const page = await editor('ProbationObservations.tsx', 'ProbationActions', base, { updateProbationStage: { ok: true }, createAction: { ok: false, message: 'Action rejected.' } });
  await page.click('Add action');
  page.nodes().find(node => node.props.id === 'probation-action-theme-observation').props.onChange('Teaching'); await page.settle();
  await page.native(page.nodes().find(node => node.type === 'textarea'), 'Pending action');
  await page.native(page.nodes().find(node => node.type === 'input' && node.props.type === 'date'), '2026-11-01');
  await page.native(page.nodes().find(node => node.type === 'input' && node.props.type === 'checkbox'), true);
  assert.equal(page.guards.get('New probation action').onSave, undefined);
  assert.equal(await page.action('Probation actions stage', 'onSave'), true);
  assert.equal(page.calls.some(call => call[0] === 'createAction'), false, 'saving a stage never creates the unsaved live action');
  assert.equal(await page.action('New probation action', 'onSubmit'), false);
  assert.equal(page.nodes().find(node => node.type === 'textarea').props.value, 'Pending action');
  assert.equal(page.guards.get('New probation action').dirty, true);
});

test('probation whole-observation completion first respects the unsaved keep-editing decision', async () => {
  const observation = { id: 'observation', observationNumber: 1, status: 'in_progress', stages: [] };
  const base = probationProps({ record: { ...probationProps().record, observations: [observation], reviewers: [], currentObservationNumber: 1, academicYear: '2026/27' }, observation, selectedObservationNumber: 1, livRecords: [], livConfiguration: configuration, onBack: noop, onObservationChange: noop });
  const page = await editor('ProbationObservations.tsx', 'ProbationCaseWorkspace', base, {}, false);
  await page.click('Complete Observation 1');
  assert.deepEqual(page.calls, [['confirmNavigation']]);
});

test('UCO observer draft saving and sending use separate endpoints and refreshed concurrency versions', async () => {
  let sequence = 0;
  const detail = ucoDetail({ canEditObserverSection: true });
  const page = await editor('UcoTlaReviews.tsx', 'UcoTlaReviewWorkspace', ucoProps(detail), {
    updateUcoTlaReview: (_id, request) => ({ ok: true, data: { ...detail, responses: request.responses, review: { ...detail.review, rowVersion: `saved-${++sequence}` } } }),
    submitUcoTlaReview: () => ({ ok: true, data: ucoDetail({}, 'awaiting_lecturer') })
  });
  await page.narrative('Academic/research skills', 'Partial evidence');
  assert.equal(page.guards.get('UCO observer review').submitLabel, 'Send to lecturer');
  assert.equal(await page.action('UCO observer review', 'onSave'), true);
  assert.equal(page.calls.some(call => call[0] === 'submitUcoTlaReview'), false);
  await page.narrative('Academic/research skills', 'Ready evidence');
  assert.equal(await page.action('UCO observer review', 'onSubmit'), true);
  assert.equal(page.calls.filter(call => call[0] === 'updateUcoTlaReview').at(-1)[2].rowVersion, 'saved-1');
  assert.deepEqual(page.calls.find(call => call[0] === 'submitUcoTlaReview'), ['submitUcoTlaReview', 'uco', 'saved-2']);
  assert.equal(page.calls.some(call => call[0] === 'acknowledgeUcoTlaReview' || call[0] === 'finaliseUcoTlaReview'), false);
});

test('failed UCO send retains saved answers and its refreshed draft token for retry', async () => {
  const detail = ucoDetail({ canEditObserverSection: true });
  const page = await editor('UcoTlaReviews.tsx', 'UcoTlaReviewWorkspace', ucoProps(detail), {
    updateUcoTlaReview: (_id, request) => ({ ok: true, data: { ...detail, responses: request.responses, review: { ...detail.review, rowVersion: 'saved-before-rejection' } } }),
    submitUcoTlaReview: { ok: false, message: 'Complete the required sections first.' }
  });
  await page.narrative('Academic/research skills', 'Retain my evidence');
  assert.equal(await page.action('UCO observer review', 'onSubmit'), false);
  assert.equal(page.nodes().find(node => node.props.content?.label === 'Academic/research skills').props.value, 'Retain my evidence');
  assert.equal(page.guards.get('UCO observer review').dirty, true);
  assert.match(page.message(), /required sections/);
  assert.equal(await page.action('UCO observer review', 'onSubmit'), false);
  assert.equal(page.calls.filter(call => call[0] === 'updateUcoTlaReview').at(-1)[2].rowVersion, 'saved-before-rejection');
});

test('lecturer reflection cannot masquerade as a draft and only explicit authenticated acknowledgement persists it', async () => {
  const detail = ucoDetail({ canReflect: true }, 'awaiting_lecturer'); detail.review.professionalDiscussionAt = '2026-10-29T12:00:00Z';
  const page = await editor('UcoTlaReviews.tsx', 'UcoTlaReviewWorkspace', ucoProps(detail), { acknowledgeUcoTlaReview: { ok: false, message: 'Acknowledgement rejected.' } });
  const label = 'Reflection on observation and professional discussion';
  await page.narrative(label, ' ');
  assert.equal(page.guards.get('UCO lecturer reflection').onSave, undefined);
  assert.equal(page.guards.get('UCO lecturer reflection').submitLabel, 'Acknowledge review');
  assert.equal(await page.action('UCO lecturer reflection', 'onSubmit'), false); assert.equal(page.calls.length, 0);
  await page.narrative(label, 'My reflection');
  assert.equal(await page.action('UCO lecturer reflection', 'onSubmit'), false);
  assert.equal(page.nodes().find(node => node.props.content?.label === label).props.value, 'My reflection');
  assert.equal(page.guards.get('UCO lecturer reflection').dirty, true);
  const count = page.calls.length; await page.discard('UCO lecturer reflection'); assert.equal(page.calls.length, count);
  assert.equal(page.calls[0][0], 'acknowledgeUcoTlaReview');
});

test('read-only UCO roles do not receive observer submission or lecturer acknowledgement callbacks', async () => {
  const page = await editor('UcoTlaReviews.tsx', 'UcoTlaReviewWorkspace', ucoProps(ucoDetail({}, 'completed')));
  for (const label of ['UCO observer review', 'UCO lecturer reflection']) {
    assert.equal(page.guards.get(label).onSave, undefined); assert.equal(page.guards.get(label).onSubmit, undefined);
  }
});

test('UCO local Back respects a keep-editing decision without submitting or acknowledging', async () => {
  let back = 0;
  const page = await editor('UcoTlaReviews.tsx', 'UcoTlaReviewWorkspace', { ...ucoProps(ucoDetail({ canEditObserverSection: true })), onBack: () => { back++; } }, {}, false);
  const backButton = page.nodes().find(node => node.type === 'button' && node.props.className === 'quiet-link');
  backButton.props.onClick(); await page.settle();
  assert.equal(back, 0); assert.deepEqual(page.calls, [['confirmNavigation']]);
});
