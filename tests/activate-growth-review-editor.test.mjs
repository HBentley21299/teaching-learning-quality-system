import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const requireWeb = createRequire(new URL('../apps/web/package.json', import.meta.url));
const ts = requireWeb('typescript'), react = requireWeb('react'), jsx = requireWeb('react/jsx-runtime');
const { renderToStaticMarkup } = requireWeb('react-dom/server');
const helperSource = await readFile(new URL('../apps/web/src/services/processReviewTypes.ts', import.meta.url), 'utf8');
const helperModule = { exports: {} };
new Function('exports', 'module', ts.transpileModule(helperSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(helperModule.exports, helperModule);
const helpers = helperModule.exports;
const barSource = await readFile(new URL('../apps/web/src/components/SkillsScanResultBar.tsx', import.meta.url), 'utf8');
const barModule = { exports: {} };
new Function('require', 'exports', 'module', ts.transpileModule(barSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText)(name => name === 'react/jsx-runtime' ? jsx : {}, barModule.exports, barModule);
const source = await readFile(new URL('../apps/web/src/routes/ProcessReviews.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const pillars = [
  ['proficiency', 'Digital proficiency and productivity', ['digital_proficiency', 'digital_productivity']],
  ['literacies', 'Information, data and media literacies', ['information_literacy', 'data_literacy', 'media_literacy']],
  ['creation', 'Digital creation, problem solving and innovation', ['digital_creation', 'problem_solving', 'digital_innovation']],
  ['communication', 'Digital communication, collaboration and participation', ['digital_communication', 'digital_collaboration', 'digital_participation']],
  ['learning', 'Digital learning and development', ['digital_learning', 'digital_teaching']],
  ['identity', 'Digital identity and wellbeing', ['digital_identity_management', 'digital_wellbeing']]
].map(([key, title, keys]) => ({ key, title, subAreas: keys.map(key => ({ key, title: key.replaceAll('_', ' ') })) }));
const configuration = { processKey: 'activate_growth_review', title: 'Activate+', version: 2, standards: [], ratingOptions: [], fieldLabels: {}, settings: {}, skillsScanPillars: pillars,
  actionThemes: ['Immersive Technology', 'Assistive Technology', 'Digital Teaching & Learning', 'IT', 'MIS'].map((title, index) => ({ key: `area_${index + 1}`, title })) };
const person = (staffId, displayName, roles, isLocked) => ({ staffId, displayName, roles, isLocked, orgUnitNames: [] });
const context = {
  facultyOrgUnitId: 'faculty', facultyName: 'Selected Faculty', warnings: [],
  availableSubTeams: [{ orgUnitId: 'team-a', name: 'Team A', parentOrgUnitId: 'faculty', parentName: 'Selected Faculty' }, { orgUnitId: 'team-b', name: 'Team B', parentOrgUnitId: 'faculty', parentName: 'Selected Faculty' }],
  selectedSubTeamOrgUnitIds: ['team-a', 'team-b'],
  participants: [person('creator', 'Review Creator', ['Review owner'], true), person('hof', 'Faculty Head', ['Head of faculty'], true), person('pl', 'Programme Leader', ['Programme leader'], false)]
};
function request(overrides = {}) { return { title: 'Growth Review', academicYear: '2026/27', facultyOrgUnitId: 'faculty', teamOrgUnitId: null, recordDate: '2026-11-12', submit: false,
  data: { fields: { historicalNote: 'Retain the earlier review data' }, samples: [], responses: [], activate: { ...helpers.emptyActivateGrowthReviewData(), subTeamOrgUnitIds: ['team-a', 'team-b'], participantStaffIds: ['creator', 'hof', 'pl'], ...overrides } } }; }
function detail(current = request(), overrides = {}) { return { ...current, recordId: 'record', processKey: 'activate_growth_review', ownerStaffId: 'creator', ownerName: 'Review Creator', rowVersion: 'row-1', configuration,
  facultyName: 'Selected Faculty', status: 'draft', updatedAt: '2026-11-12T10:00:00Z', snapshots: [], actions: [], canEdit: true,
  participants: context.participants, selectedSubTeams: context.availableSubTeams, ...overrides }; }
function text(node) { return Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : node == null || typeof node === 'boolean' ? '' : String(node); }
const flush = () => new Promise(resolve => setImmediate(resolve));

async function view(name, initialProps, api = {}) {
  let props = initialProps, cursor = 0, needsRender = true, tree, id = 0;
  const slots = [], effects = [], unsaved = [];
  const hooks = {
    useId: () => `field-${++id}`,
    useMemo: factory => factory(),
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[index].value, next => { const value = typeof next === 'function' ? next(slots[index].value) : next; if (!Object.is(value, slots[index].value)) { slots[index].value = value; needsRender = true; } }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect(effect, deps) { const index = cursor++, old = slots[index]; if (!old || deps.some((value, position) => !Object.is(value, old.deps[position]))) { slots[index] = { deps }; effects.push(() => { old?.cleanup?.(); slots[index].cleanup = effect(); }); } }
  };
  const Button = ({ icon, variant, busy, children, ...rest }) => react.createElement('button', { ...rest, disabled: rest.disabled || busy }, children);
  const Feedback = ({ message, tone }) => message ? react.createElement('p', { role: tone === 'error' ? 'alert' : 'status' }, message) : null;
  const Staff = ({ label }) => react.createElement('input', { 'aria-label': label || 'Staff search' });
  const modules = {
    react: hooks, 'react/jsx-runtime': jsx, 'lucide-react': new Proxy({}, { get: () => () => null }),
    '../design-system/Button': { Button }, '../components/StaffSearchSelect': { StaffSearchSelect: Staff },
    '../components/WorkflowFeedback': { WorkflowFeedback: Feedback }, '../services/processReviewTypes': helpers,
    '../components/SkillsScanResultBar': barModule.exports,
    '../components/WorkflowPagination': { useWorkflowPagination: rows => ({ items: rows }), WorkflowPagination: () => null },
    '../components/WorkflowFilters': { WorkflowFilters: ({ children, primary }) => react.createElement('div', null, primary, children) },
    '../components/LoadingState': { LoadingState: ({ label }) => react.createElement('p', null, label) },
    '../components/UnsavedChangesGuard': { confirmUnsavedNavigation: async () => true, useUnsavedChanges: state => { unsaved.push(state); return () => {}; } },
    '../services/api': { api }, '../app/routing': { actionPath: id => `/actions/${id}` }
  };
  const module = { exports: {} };
  new Function('require', 'exports', 'module', `${code}\nexports.Page = ProcessReviews; exports.Links = ActivateReviewFollowUps; exports.Context = ActivateReviewContextFields; exports.Skills = ActivateSkillsScan; exports.Minutes = ActivateMeetingMinutes; exports.Actions = ActivateReviewActions; exports.Checks = ActivateReviewChecks;`)(name => modules[name] || {}, module.exports, module);
  function render() { cursor = 0; needsRender = false; tree = module.exports[name](props); }
  async function settle() { for (let round = 0; round < 30; round++) { if (needsRender) render(); while (effects.length) effects.shift()(); await flush(); if (!needsRender) return; } throw new Error(`${name} did not settle`); }
  function nodes() { const result = []; function walk(node) { if (Array.isArray(node)) return node.forEach(walk); if (!node || typeof node !== 'object') return; result.push(node); walk(node.props?.children); } walk(tree); return result; }
  await settle();
  return {
    nodes, settle, unsaved,
    markup: () => renderToStaticMarkup(tree),
    async click(label) { const button = nodes().find(node => node.type === Button && text(node.props.children) === label); assert.ok(button, `Missing button ${label}`); assert.equal(Boolean(button.props.disabled), false); button.props.onClick(); await settle(); },
    async change(label, value) {
      const component = nodes().find(node => typeof node.type === 'function' && node.props.label === label && node.props.onChange);
      if (component) component.props.onChange(value);
      else { const group = nodes().find(node => node.type === 'label' && text(Array.isArray(node.props.children) ? node.props.children[0] : node.props.children) === label); assert.ok(group, `Missing label ${label}`); const input = (Array.isArray(group.props.children) ? group.props.children : [group.props.children]).find(node => ['input', 'select', 'textarea'].includes(node?.type)); assert.ok(input); input.props.onChange({ target: { value } }); }
      await settle();
    },
    async rerender(next) { props = { ...props, ...next }; needsRender = true; await settle(); }
  };
}

function fieldsProps(current = request(), record = detail(current)) {
  return { request: current, configuration, detail: record, user: { staffId: 'creator', displayName: 'Review Creator', permissions: [] }, staff: [], orgUnits: [{ id: 'faculty', name: 'Selected Faculty', orgUnitType: 'faculty', isActive: true }],
    label: (_key, fallback) => fallback, field: () => {}, setRequest: () => {} };
}

test('pillar averages require all valid manual sub-area means and never impute missing results as zero', () => {
  const pillar = pillars[0];
  assert.equal(helpers.activatePillarAverage(pillar, {}), null);
  assert.equal(helpers.activatePillarAverage(pillar, { digital_proficiency: 2.5 }), null);
  assert.equal(helpers.activatePillarAverage(pillar, { digital_proficiency: null, digital_productivity: 4 }), null);
  assert.equal(helpers.activatePillarAverage(pillar, { digital_proficiency: 0, digital_productivity: 4 }), null);
  assert.equal(helpers.activatePillarAverage(pillar, { digital_proficiency: 5.1, digital_productivity: 4 }), null);
  assert.ok(Math.abs(helpers.activatePillarAverage(pillar, { digital_proficiency: 2.2, digital_productivity: 4.4, unrelated: 1 }) - 3.3) < 1e-10);
});

test('locked creator and HOF remain selected while a Programme Leader can be removed and extra participants retained', () => {
  const result = helpers.activateParticipantIds(context, ['creator', 'hof', 'pl', 'extra'], ['creator', 'hof', 'pl']);
  assert.deepEqual(result, ['creator', 'hof', 'extra']);
});

test('opening a saved multi-scope context does not reorder selections, set a singular team or create unsaved edits', () => {
  const current = request({ participantStaffIds: ['extra', 'pl', 'creator', 'hof'], subTeamOrgUnitIds: ['team-b', 'team-a'] });
  const before = helpers.processReviewFingerprint(current);
  const patch = helpers.activateContextPatch(current, context);
  assert.deepEqual(patch, {});
  assert.equal(helpers.processReviewFingerprint({ ...current, ...patch }), before);
  assert.equal(current.teamOrgUnitId, null);
});

test('changing scope replaces old automatic leaders and retains explicitly added participants', () => {
  const current = request({ participantStaffIds: ['creator', 'old-hof', 'old-pl', 'extra'] });
  const patch = helpers.activateContextPatch(current, context, ['creator', 'old-hof', 'old-pl']);
  assert.deepEqual(patch.data.activate.participantStaffIds, ['creator', 'extra', 'hof', 'pl']);
  assert.equal(patch.data.fields.historicalNote, 'Retain the earlier review data');
});

test('real area parents group selectable leaf sub-teams without inventing another hierarchy level', () => {
  const grouped = helpers.activateSubTeamGroups({ ...context, availableSubTeams: [
    { orgUnitId: 'area', name: 'Curriculum Area', parentOrgUnitId: 'faculty', parentName: 'Selected Faculty' },
    { orgUnitId: 'leaf', name: 'Sub-team', parentOrgUnitId: 'area', parentName: 'Curriculum Area' }
  ] });
  assert.equal(grouped.length, 1); assert.equal(grouped[0].name, 'Curriculum Area');
  assert.deepEqual(grouped[0].teams.map(team => team.orgUnitId), ['leaf']);
});

test('the Skills Scan form has 15 decimal inputs, 15 sub-area bars and six read-only complete-pillar bars', async () => {
  const scores = Object.fromEntries(pillars.flatMap(pillar => pillar.subAreas).map(area => [area.key, 2.5]));
  const page = await view('Skills', fieldsProps(request({ skillsScanScores: scores })));
  const markup = page.markup();
  assert.equal((markup.match(/type="number"/g) || []).length, 15);
  assert.equal((markup.match(/step="any"/g) || []).length, 15);
  assert.equal((markup.match(/role="meter"/g) || []).length, 21);
  assert.equal((markup.match(/pillar average"/g) || []).length, 6);
  assert.match(markup, /unweighted mean/);
  assert.doesNotMatch(markup, /Not relevant|Not observed|Overall score|Teams/);
});

test('clearing a Skills Scan average stores missing rather than zero and preserves historical fields', async () => {
  let current = request({ skillsScanScores: { digital_proficiency: 3.25, digital_productivity: 4 } });
  const props = fieldsProps(current);
  props.setRequest = patch => { current = { ...current, ...(typeof patch === 'function' ? patch(current) : patch) }; };
  const page = await view('Skills', props);
  const input = page.nodes().find(node => node.type === 'input' && node.props['aria-label'] === 'digital proficiency average');
  input.props.onChange({ target: { value: '' } });
  assert.equal(current.data.activate.skillsScanScores.digital_proficiency, null);
  assert.equal(current.data.activate.skillsScanScores.digital_productivity, 4);
  assert.equal(current.data.fields.historicalNote, 'Retain the earlier review data');
});

test('the minutes form contains only minutes, strengths and development narratives', async () => {
  const page = await view('Minutes', fieldsProps());
  assert.equal((page.markup().match(/<textarea/g) || []).length, 3);
  assert.match(page.markup(), /Meeting minutes/); assert.match(page.markup(), /Strengths/); assert.match(page.markup(), /Areas for development/);
  assert.doesNotMatch(page.markup(), /Teams|snapshot|planned|held|Impact assessment/i);
});

test('read-only review context uses saved participants and scope without calling the edit-only resolver', async () => {
  let calls = 0;
  const current = request();
  const page = await view('Context', fieldsProps(current, detail(current, { canEdit: false })), { activateReviewContext: () => { calls++; throw new Error('Must not request edit-only context'); } });
  const markup = page.markup();
  assert.equal(calls, 0);
  assert.match(markup, /Review Creator/); assert.match(markup, /Faculty Head/); assert.match(markup, /Programme Leader/);
  assert.equal((markup.match(/type="date"/g) || []).length, 1);
  assert.doesNotMatch(markup, /Teams proforma|full review in Teams|snapshot|planned|held|specialist leads/i);
});

test('one streamlined action assignment sends both responsible people and retains all six fields after a failure', async () => {
  const calls = [];
  const saved = detail();
  const props = { detail: saved, configuration, staff: [], onDirtyChange() {}, onSavingChange() {}, onChanged: async () => {}, onSaveReview: async () => true, reviewSaving: false };
  const page = await view('Actions', props, { saveProcessReviewAction: async (recordId, actionId, value) => { calls.push({ recordId, actionId, value }); return { ok: false, message: 'Try again; the action was not saved.' }; } });
  await page.click('Add action');
  await page.change('Theme', 'area_2'); await page.change('Area of impact', 'digital_productivity');
  await page.change('Action detail', 'Revise accessible resources and evaluate learner independence.');
  await page.change('Impact measures', 'Learners complete the task independently.');
  await page.change('Responsible people', ['person-a', 'person-b']);
  await page.change('Review date', '2027-01-15');
  assert.doesNotMatch(page.markup(), /Activity progress|Impact assessment|Support required|Dated progress update/);
  await page.click('Assign action');
  assert.equal(calls.length, 1); assert.equal(calls[0].recordId, 'record');
  assert.deepEqual(calls[0].value.responsibleStaffIds, ['person-a', 'person-b']);
  assert.equal(calls[0].value.ownerStaffId, 'person-a');
  assert.equal(calls[0].value.reviewDate, '2027-01-15');
  assert.equal(calls[0].value.dueDate, '2027-01-15');
  assert.equal(calls[0].value.impactAreaKey, 'digital_productivity');
  assert.match(page.markup(), /Revise accessible resources/);
  assert.match(page.markup(), /Try again/);
  assert.equal(page.unsaved.at(-1).dirty, true);
});


test('Skills Scan balls identify the 1, midpoint and 5 positions without hiding an endpoint marker', () => {
  for (const [value, position] of [[1, '0%'], [3, '50%'], [5, '100%']]) {
    const markup = renderToStaticMarkup(react.createElement(barModule.exports.SkillsScanResultBar, { value, label: 'Result' }));
    assert.match(markup, /role="meter"/);
    assert.match(markup, new RegExp(`aria-valuenow="${value}"`));
    assert.ok(markup.includes(`class="skills-scan-result-ball" style="left:${position}"`));
    assert.match(markup, /aria-valuemin="1" aria-valuemax="5"/);
  }
  assert.equal(renderToStaticMarkup(react.createElement(barModule.exports.SkillsScanResultBar, { value: 0, label: 'Missing' })), '');
});

test('linked follow-ups keep scope read only and use frozen participants without repeating organisation setup', async () => {
  let calls = 0;
  const current = request();
  const saved = detail(current, { isFollowUp: true, data: { ...current.data, activate: { ...current.data.activate, automaticParticipants: context.participants } } });
  const page = await view('Context', fieldsProps(current, saved), { activateReviewContext: () => { calls++; throw new Error('Follow-up must reuse saved scope'); } });
  assert.equal(calls, 0);
  assert.match(page.markup(), /Linked review scope/);
  assert.match(page.markup(), /Team A; Team B/);
  assert.doesNotMatch(page.markup(), /Find a sub-team|Select all sub-teams|Follow-up review date/);
  assert.equal((page.markup().match(/type="date"/g) || []).length, 1);
});

test('a follow-up displays previous scan results as reference and starts without current scan inputs or copied scores', async () => {
  const current = request({ skillsScanScores: {} });
  const previous = { review: { recordId: 'previous', title: 'Initial review', academicYear: '2026/27', recordDate: '2026-10-01', status: 'submitted', canEdit: true }, configuration,
    skillsScanScores: { digital_proficiency: 2.25, digital_productivity: 3.75 }, selectedSubTeams: context.availableSubTeams, participants: context.participants };
  const page = await view('Skills', fieldsProps(current, detail(current, { isFollowUp: true, parentReview: previous.review, parentReviewContext: previous })));
  assert.match(page.markup(), /Previous Skills Scan results/);
  assert.match(page.markup(), /2.25/); assert.match(page.markup(), /3.75/);
  assert.match(page.markup(), /Add new Skills Scan results for this follow-up/);
  assert.equal((page.markup().match(/type="number"/g) || []).length, 0);
  assert.deepEqual(current.data.activate.skillsScanScores, {});
});

test('follow-up controls save the first draft, add one linked review, and open an existing follow-up', async () => {
  const opened = [], calls = [];
  const parent = detail();
  const props = { detail: null, canCreate: true, blocked: false, busy: false, onSave: () => calls.push('save'), onAdd: () => calls.push('add'), onOpen: id => opened.push(id) };
  const page = await view('Links', props);
  assert.doesNotMatch(page.markup(), /Add follow-up review/);
  await page.click('Save review draft'); assert.deepEqual(calls, ['save']);
  await page.rerender({ detail: parent }); await page.click('Add follow-up review'); assert.deepEqual(calls, ['save', 'add']);
  await page.rerender({ detail: { ...parent, followUpReviews: [{ recordId: 'followup', title: 'Follow-up', recordDate: '2026-12-01', status: 'draft', academicYear: '2026/27', canEdit: true }] } });
  assert.doesNotMatch(page.markup(), /Add follow-up review/);
  await page.click('Open follow-up review'); assert.deepEqual(opened, ['followup']);
});

test('creating a follow-up ignores a repeated click and opens the returned child with a clean draft baseline', async () => {
  let resolve;
  const pending = new Promise(yes => { resolve = yes; });
  const calls = [], opened = [];
  const parent = detail();
  const followup = detail(request({ skillsScanScores: {} }), { recordId: 'child', title: 'Linked follow-up', rowVersion: 'child-row', isFollowUp: true,
    parentReview: { recordId: parent.recordId, title: parent.title, academicYear: parent.academicYear, recordDate: parent.recordDate, status: parent.status, canEdit: true } });
  const props = { processKey: 'activate_growth_review', user: { staffId: 'creator', displayName: 'Creator', permissions: ['activate_growth_review.submit'] }, orgUnits: [], staff: [], academicYear: '2026/27', initialRecordId: parent.recordId, onRecordOpened: id => opened.push(id) };
  const page = await view('Page', props, { processReviewConfiguration: async () => configuration, processReviews: async () => [parent], processReview: async () => parent,
    createActivateFollowUp: async (id, value) => { calls.push({ id, value }); return pending; } });
  const links = page.nodes().find(node => node.type?.name === 'ActivateReviewFollowUps'); assert.ok(links);
  links.props.onAdd(); links.props.onAdd(); await page.settle();
  assert.equal(calls.length, 1); assert.equal(calls[0].id, parent.recordId); assert.equal(calls[0].value.rowVersion, parent.rowVersion);
  assert.equal(page.unsaved.at(-1).saving, true);
  assert.ok(page.nodes().filter(node => node.type === 'fieldset').every(node => node.props.disabled));
  assert.ok(page.nodes().find(node => text(node.props?.children) === 'Save draft' && node.props.onClick)?.props.disabled);
  assert.equal(await page.unsaved.at(-1).onSave(), false, 'a second save cannot race the follow-up creation');
  resolve({ ok: true, data: followup }); await page.settle();
  const updated = page.nodes().find(node => node.type?.name === 'ActivateReviewFollowUps');
  assert.equal(updated.props.detail.recordId, 'child'); assert.equal(updated.props.detail.isFollowUp, true);
  assert.equal(page.unsaved.at(-1).dirty, false);
  assert.equal(opened.at(-1), 'child');
});

test('amending an inherited action uses its shared action identity and preserves the current follow-up details', async () => {
  const calls = [], changed = [];
  const shared = { actionId: 'shared-action', recordId: 'parent', title: 'Earlier action', detail: 'Earlier action detail', themeKey: 'area_1', ownerStaffId: 'creator',
    ownerName: 'Review Creator', dueDate: '2026-12-01', reviewDate: '2026-12-01', supportRequired: '', successEvidence: 'Original measures', progress: 'open', impactStatus: 'awaiting_evidence',
    rowVersion: 'action-row', canEdit: true, responsibleStaffIds: ['creator'], impactAreaKey: 'digital_proficiency', updates: [] };
  const current = request({ meetingMinutes: 'Unsaved follow-up meeting context' });
  const saved = detail(current, { recordId: 'child', isFollowUp: true, actions: [shared] });
  const props = { detail: saved, configuration, staff: [], onDirtyChange() {}, onSavingChange() {}, onChanged: async value => changed.push(value), onSaveReview: async () => true, reviewSaving: false };
  const page = await view('Actions', props, { updateAssignedProcessReviewAction: async (id, value) => { calls.push({ id, value }); return { ok: true, data: { ...shared, detail: value.detail, rowVersion: 'new-action-row' } }; },
    saveProcessReviewAction: async () => assert.fail('Inherited action must not be saved against the child record') });
  await page.click('Amend action'); await page.change('Action detail', 'Updated shared action detail'); await page.click('Save action');
  assert.equal(calls[0].id, 'shared-action'); assert.equal(changed[0].recordId, 'child');
  assert.equal(changed[0].data.activate.meetingMinutes, 'Unsaved follow-up meeting context');
  assert.equal(changed[0].actions.length, 1); assert.equal(changed[0].actions[0].recordId, 'parent'); assert.equal(changed[0].actions[0].detail, 'Updated shared action detail');
});
