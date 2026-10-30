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

test('read-only reviewers can move between standards while ratings, sample links and rationale remain disabled', async () => {
  const react = requireWeb('react');
  const jsx = requireWeb('react/jsx-runtime');
  const { renderToStaticMarkup } = requireWeb('react-dom/server');
  const componentSource = await readFile(new URL('../apps/web/src/routes/ProcessReviews.tsx', import.meta.url), 'utf8');
  const componentModule = { exports: {} };
  let id = 0;
  const modules = {
    react: { useId: () => `test-${++id}` }, 'react/jsx-runtime': jsx,
    'lucide-react': new Proxy({}, { get: () => () => null }),
    '../services/processReviewTypes': helpers
  };
  const code = ts.transpileModule(componentSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText;
  new Function('require', 'exports', 'module', `${code}\nexports.TestStatements = DigitalStatements;`)(name => modules[name] || {}, componentModule.exports, componentModule);
  const selected = [];
  const configuration = {
    standards: [
      { key: 'first', title: 'First standard', statements: [{ key: 'question', text: 'A supplied statement' }] },
      { key: 'last', title: 'Last standard', statements: [{ key: 'last-question', text: 'A final statement' }] }
    ], ratingOptions: [{ key: 'college-rating', label: 'College rating' }]
  };
  const tree = componentModule.exports.TestStatements({ configuration, data: data(), selected: 0,
    setSelected: value => selected.push(value), onChange: () => assert.fail('Reading must not edit answers'), readOnly: true });
  const nodes = [];
  function walk(node) { if (Array.isArray(node)) return node.forEach(walk); if (!node || typeof node !== 'object') return; nodes.push(node); walk(node.props?.children); }
  walk(tree);
  const navigation = nodes.filter(node => node.type === 'button');
  assert.equal(navigation.length, 2);
  assert.ok(navigation.every(node => !node.props.disabled));
  navigation[1].props.onClick();
  assert.deepEqual(selected, [1]);
  const markup = renderToStaticMarkup(react.createElement(() => tree));
  assert.match(markup, /<select disabled=""/);
  assert.match(markup, /type="checkbox" disabled=""/);
  assert.match(markup, /<textarea[^>]*disabled=""/);
});
