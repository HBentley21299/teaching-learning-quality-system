import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const requireWeb = createRequire(new URL('../apps/web/package.json', import.meta.url));
const ts = requireWeb('typescript');
const source = await readFile(new URL('../apps/web/src/services/processReviewTypes.ts', import.meta.url), 'utf8');
const module = { exports: {} };
new Function('exports', 'module', ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText)(module.exports, module);
const helpers = module.exports;

const data = () => ({
  fields: { scope: 'A partially completed review', newAdminPrompt: 'Keep this answer too' },
  samples: [{ id: 'first', title: '', sampleType: 'learner_work', staffIds: [] }, { id: 'second', title: 'Second sample', sampleType: 'observation', staffIds: ['staff-1'] }],
  responses: [
    { statementKey: 'statement-1', ratingKey: 'college-rating', sampleIds: ['first', 'second'], rationale: 'Rationale remains attached to its statement' },
    { statementKey: 'statement-2', sampleIds: ['first'], rationale: 'Partial evidence notes' }
  ]
});

test('opening a saved review preserves partial samples and all admin-defined answers without retaining editable ownership', () => {
  const detail = { title: 'Review', academicYear: '2026/27', facultyOrgUnitId: 'faculty', teamOrgUnitId: 'team', recordDate: '2026-11-12', data: data(), rowVersion: 'version-1', ownerStaffId: 'trusted-owner', ownerName: 'Trusted Owner' };
  const request = helpers.processReviewRequest(detail);
  assert.deepEqual(request.data, detail.data);
  assert.equal(request.data.samples[0].title, '');
  assert.equal(request.data.fields.newAdminPrompt, 'Keep this answer too');
  assert.equal(Object.hasOwn(request, 'ownerStaffId'), false);
  assert.equal(Object.hasOwn(request, 'ownerName'), false);
  request.data.fields.scope = 'An unsaved edit';
  request.data.samples[1].staffIds.push('staff-2');
  assert.equal(detail.data.fields.scope, 'A partially completed review');
  assert.deepEqual(detail.data.samples[1].staffIds, ['staff-1']);
});

test('dirty detection ignores refreshed concurrency tokens but detects edits to nested evidence', () => {
  const request = { title: 'Review', academicYear: '2026/27', data: data(), submit: false, rowVersion: 'before' };
  const original = helpers.processReviewFingerprint(request);
  assert.equal(helpers.processReviewFingerprint({ ...request, rowVersion: 'after', submit: true }), original);
  const changed = structuredClone(request);
  changed.data.responses[1].rationale = 'Unsaved further reasoning';
  assert.notEqual(helpers.processReviewFingerprint(changed), original);
});

test('automatic DLW titles follow amended team/date context without replacing historical custom titles', () => {
  const saved = { title: 'Digital Learning Walk · Earlier Team · 2026-10-30', academicYear: '2026/27', recordDate: '2026-10-30', teamOrgUnitId: 'earlier', teamName: 'Earlier Team', facultyOrgUnitId: 'faculty', facultyName: 'Faculty' };
  const updated = { ...saved, recordDate: '2026-11-01', teamOrgUnitId: 'new-team' };
  assert.equal(helpers.digitalLearningWalkTitle(updated, saved, [{ id: 'new-team', name: 'New Team' }]), 'Digital Learning Walk · New Team · 2026-11-01');
  assert.equal(helpers.digitalLearningWalkTitle({ ...updated, title: 'A named historic walk' }, { ...saved, title: 'A named historic walk' }, []), 'A named historic walk');
  assert.equal(helpers.digitalLearningWalkTitle(updated, saved, []), 'Digital Learning Walk · Team / area · 2026-11-01');
});

test('unrated drafts can immediately show the shared Learning Walk scale while rated and submitted reviews remain pinned', () => {
  const old = { processKey: 'digital_learning_walk', standards: [{ key: 'standard', statements: [{ key: 'statement', text: 'Original wording' }] }], ratingOptions: [] };
  const current = { ...old, ratingOptions: [{ key: 'secure_practice', label: '3 – Secure Practice', score: 3, colorHex: '#3FAE5A' }] };
  const saved = { status: 'draft', configuration: old, data: { responses: [] } };
  assert.equal(helpers.digitalLearningWalkConfiguration(saved, current), current);
  assert.equal(helpers.digitalLearningWalkConfiguration(null, current), current);
  assert.equal(helpers.digitalLearningWalkConfiguration({ ...saved, status: 'submitted' }, current), old);
  assert.equal(helpers.digitalLearningWalkConfiguration({ ...saved, data: { responses: [{ statementKey: 'statement', ratingKey: 'earlier-rating' }] } }, current), old);
  assert.equal(helpers.digitalLearningWalkConfiguration({ ...saved, configuration: { ...old, ratingOptions: [{ key: 'custom', label: 'Earlier scale' }] } }, current).ratingOptions[0].key, 'custom');
  const changed = { ...current, standards: [{ key: 'standard', statements: [{ key: 'statement', text: 'Amended wording' }] }] };
  assert.equal(helpers.digitalLearningWalkConfiguration(saved, changed), old);
});

test('removing one sample clears every reference to it while retaining ratings and rationale', () => {
  const original = data();
  const result = helpers.removeProcessReviewSample(original, 'first');
  assert.deepEqual(result.samples.map(sample => sample.id), ['second']);
  assert.deepEqual(result.responses[0].sampleIds, ['second']);
  assert.deepEqual(result.responses[1].sampleIds, []);
  assert.equal(result.responses[0].ratingKey, 'college-rating');
  assert.equal(result.responses[1].rationale, 'Partial evidence notes');
  assert.deepEqual(original.responses[0].sampleIds, ['first', 'second']);
});

test('only complete HTTPS links without embedded credentials become evidence navigation', () => {
  for (const value of ['', 'https://', 'example.com', 'javascript:alert(1)', 'data:text/html,example', 'file:///C:/example', 'http://example.com', 'https://user:password@example.com']) {
    assert.equal(helpers.processReviewSafeLink(value), null, value);
  }
  assert.equal(helpers.processReviewSafeLink('https://college.example/reviews?id=123#evidence'), 'https://college.example/reviews?id=123#evidence');
});

test('preparation targets cross month and year boundaries without changing the chosen meeting date', () => {
  assert.equal(helpers.addProcessReviewDays('2027-01-05', -14), '2026-12-22');
  assert.equal(helpers.addProcessReviewDays('2026-04-02', -7), '2026-03-26');
  assert.equal(helpers.addProcessReviewDays('', -14), '');
  assert.equal(helpers.addProcessReviewDays('not-a-date', -7), '');
});

test('read-only Digital Learning Walks show the continuous criteria form with editing disabled', async () => {
  const react = requireWeb('react'), jsx = requireWeb('react/jsx-runtime');
  const { renderToStaticMarkup } = requireWeb('react-dom/server');
  const componentSource = await readFile(new URL('../apps/web/src/components/DigitalLearningWalkForm.tsx', import.meta.url), 'utf8');
  const componentModule = { exports: {} };
  const Button = ({ children, icon, variant, busy, ...props }) => react.createElement('button', props, children);
  const modules = {
    react: { useId: () => 'readonly', useRef: value => ({ current: value }), useState: value => [value, () => {}], useEffect() {} }, 'react/jsx-runtime': jsx,
    'lucide-react': new Proxy({}, { get: () => () => null }), '../design-system/Button': { Button },
    './WorkflowFeedback': { WorkflowFeedback: () => null }, './useActionOwners': { useActionOwners: () => ({ owners: [], loading: false, error: '', retry() {} }) },
    '../services/learningWalkDeliveryAreas': { learningWalkDeliveryChoices: () => [] }, '../app/routing': { actionPath: id => `/actions/${id}` },
    '../services/processReviewTypes': helpers
  };
  new Function('require', 'exports', 'module', ts.transpileModule(componentSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText)(name => modules[name] || {}, componentModule.exports, componentModule);
  const configuration = { standards: [{ key: 'standard', title: 'Digital standard', statements: [{ key: 'question', text: 'A supplied DLW statement' }] }], ratingOptions: [{ key: 'college-rating', label: 'College rating' }], fieldLabels: {} };
  const current = { title: 'Review', academicYear: '2026/27', data: { fields: { strengths: 'Saved strengths' }, samples: [{ id: 'sample', title: 'Saved sample', sampleType: 'learner_work', staffIds: [] }], responses: [{ statementKey: 'question', ratingKey: 'college-rating', sampleIds: ['sample'], rationale: 'Saved reasoning' }], digital: { selectedStatementKeys: ['question'], draftActions: [] } } };
  const tree = componentModule.exports.DigitalLearningWalkForm({ configuration, request: current, detail: null, user: { displayName: 'Reviewer' }, staff: [], orgUnits: [], readOnly: true, saving: false, onChange: () => assert.fail('Reading must not edit answers'), onCancel() {} });
  const markup = renderToStaticMarkup(tree);
  assert.match(markup, /Context and focus/); assert.match(markup, /Practice observed/); assert.match(markup, /Actions/);
  assert.doesNotMatch(markup, /Scope and context|Findings|Good practice observed|Areas for development/);
  assert.match(markup, /<fieldset class="digital-walk-editable" disabled=""/);
  assert.match(markup, /aria-pressed="true"/); assert.match(markup, /Saved reasoning/); assert.match(markup, /Earlier evidence · read only|Saved sample/);
  assert.doesNotMatch(markup, /Linked evidence samples|Add sample/);
  assert.doesNotMatch(markup, /form sections|>Submit form</);
});
