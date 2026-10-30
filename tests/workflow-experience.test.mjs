import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { createElement } = web('react');
const { renderToStaticMarkup } = web('react-dom/server');
const { createServer } = await import(pathToFileURL(web.resolve('vite')));
let server, fields, filters, feedback, experience, errorSummary, narrative;

before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('../apps/web', import.meta.url)), configFile: false,
    server: { middlewareMode: true, ws: false, hmr: false }, esbuild: { jsx: 'automatic' }, define: { 'import.meta.env.VITE_ENTRA_CLIENT_ID': '""' } });
  fields = await server.ssrLoadModule('/src/components/WorkScrutinyCreateForm.tsx');
  filters = await server.ssrLoadModule('/src/components/WorkflowFilters.tsx');
  feedback = await server.ssrLoadModule('/src/components/WorkflowFeedback.tsx');
  errorSummary = await server.ssrLoadModule('/src/components/WorkflowErrorSummary.tsx');
  narrative = await server.ssrLoadModule('/src/components/WorkflowNarrativeField.tsx');
  experience = await server.ssrLoadModule('/src/services/workflowExperience.ts');
});
after(async () => { await server?.close(); });

test('secondary filters are a closed native disclosure while search, order and reset remain directly reachable', () => {
  const html = renderToStaticMarkup(createElement(filters.WorkflowFilters, {
    primary: createElement('input', { 'aria-label': 'Search records' }), activeCount: 2, onClear() {},
    children: createElement('select', { 'aria-label': 'Status filter' }, createElement('option', {}, 'Open'))
  }));
  assert.ok(html.indexOf('Search records') < html.indexOf('<details'));
  assert.match(html, /<details class="workflow-filter-disclosure">/);
  assert.match(html, /2 active/);
  assert.ok(html.indexOf('Status filter') > html.indexOf('<summary>'));
  assert.match(html, /Clear filters/);
  assert.doesNotMatch(html, /<details[^>]+open/);
});

test('required Work Scrutiny controls expose their help and specific validation message', () => {
  for (const fieldType of ['short_text', 'long_text', 'number', 'date', 'single_select', 'yes_no_partial', 'rubric_scale', 'multi_select', 'checkbox_group']) {
    const html = renderToStaticMarkup(createElement(fields.WorkScrutinyResponseField, {
      field: { id: fieldType, fieldKey: 'sample', label: 'Sample evidence', fieldType, isRequired: true, options: ['One', 'Two'], helpText: 'Choose the evidence observed.' },
      value: '', error: 'Complete sample evidence.', onChange() {}
    }));
    assert.match(html, /aria-invalid="true"/);
    assert.match(html, /aria-required="true"/);
    assert.match(html, new RegExp(`aria-describedby="scrutiny-field-${fieldType}-help scrutiny-field-${fieldType}-error"`));
    assert.match(html, new RegExp(`id="scrutiny-field-${fieldType}-error"`));
    assert.match(html, /Complete sample evidence\./);
    if (['multi_select', 'checkbox_group', 'rubric_scale'].includes(fieldType)) assert.match(html, /<legend>Sample evidence/);
    else assert.match(html, new RegExp(`for="scrutiny-field-${fieldType}"`));
  }
});

test('Work Scrutiny workflow choices use configured wording and guidance without changing their bindings', () => {
  const level = renderToStaticMarkup(createElement(fields.WorkScrutinyResponseField, {
    field: { id: 'level', fieldKey: 'qualification_level', label: 'Qualification covered by the sample', fieldType: 'single_select', isRequired: true,
      options: ['Level 1', 'Level 2'], helpText: 'Choose the qualification used for this review.' },
    value: 'Level 2', error: 'Choose a qualification.', onChange() {}
  }));
  assert.match(level, /Qualification covered by the sample/);
  assert.match(level, /Choose the qualification used for this review\./);
  assert.match(level, /id="scrutiny-field-level"/);
  assert.match(level, /aria-required="true"/);
  assert.match(level, /aria-describedby="scrutiny-field-level-help scrutiny-field-level-error"/);
  assert.match(level, /<option value="Level 2" selected="">Level 2<\/option>/);

  const delivery = renderToStaticMarkup(createElement(fields.WorkScrutinyResponseField, {
    field: { id: 'delivery', fieldKey: 'learning_walk_delivery_area', label: 'Area reviewed', fieldType: 'learning_walk_delivery_area', isRequired: true,
      helpText: 'Choose where the sampled learning took place.' },
    deliveryAreas: [{ key: 'live', name: 'Live delivery choice', isActive: true }, { key: 'retired', name: 'Retired choice', isActive: false }], deliveryAreasLoaded: true,
    value: 'live', onChange() {}
  }));
  assert.match(delivery, /Area reviewed/);
  assert.match(delivery, /Choose where the sampled learning took place\./);
  assert.match(delivery, /id="scrutiny-field-delivery"/);
  assert.match(delivery, /aria-required="true"/);
  assert.match(delivery, /aria-describedby="scrutiny-field-delivery-help"/);
  assert.match(delivery, /<option value="live" selected="">Live delivery choice<\/option>/);
  assert.doesNotMatch(delivery, /Retired choice|Choose the area covered by this sample/);
});

test('clearing Work Scrutiny workflow guidance stays cleared instead of restoring hardcoded text', () => {
  for (const fieldKey of ['qualification_level', 'learning_walk_delivery_area']) {
    const html = renderToStaticMarkup(createElement(fields.WorkScrutinyResponseField, {
      field: { id: fieldKey, fieldKey, label: 'Configured question', fieldType: 'single_select', isRequired: true, options: ['Level 1'], helpText: '' },
      deliveryAreasLoaded: true, deliveryAreas: [], value: '', onChange() {}
    }));
    assert.match(html, /Configured question/);
    assert.doesNotMatch(html, /aria-describedby=|Choose the area covered by this sample|Add the level or qualification/);
  }
});

test('workflow feedback announces successes politely and errors urgently without a focus target', () => {
  const success = renderToStaticMarkup(createElement(feedback.WorkflowFeedback, { message: 'Draft saved.', tone: 'success' }));
  const error = renderToStaticMarkup(createElement(feedback.WorkflowFeedback, { message: 'The form could not be saved.', tone: 'error' }));
  assert.match(success, /role="status"/);
  assert.match(error, /role="alert"/);
  assert.doesNotMatch(success, /tabindex=/);
});

test('an error-summary target reveals every collapsed ancestor before focusing the real control', () => {
  const previousDocument = globalThis.document;
  const outer = { tagName: 'DETAILS', open: false, parentElement: null };
  const inner = { tagName: 'DETAILS', open: false, parentElement: outer };
  let focused = false, scrolled = false;
  const target = { parentElement: inner, matches: () => true,
    focus: () => { assert.equal(inner.open, true); assert.equal(outer.open, true); focused = true; },
    scrollIntoView: () => { scrolled = true; } };
  try {
    globalThis.document = { getElementById: id => id === 'field' ? target : null };
    experience.focusWorkflowControl('field');
    assert.equal(focused, true); assert.equal(scrolled, true);
    assert.doesNotThrow(() => experience.focusWorkflowControl('removed-field'));
  } finally { globalThis.document = previousDocument; }
});

test('long form errors keep the initial summary compact without removing later field targets', () => {
  const errors = Array.from({ length: 21 }, (_, index) => ({ id: `question-${index + 1}`, message: `Complete question ${index + 1}.` }));
  const html = renderToStaticMarkup(createElement(errorSummary.WorkflowErrorSummary, { errors }));
  assert.match(html, /Check these 21 fields before continuing/);
  assert.match(html, /Show 16 more fields to check/);
  assert.equal((html.match(/class="quiet-link"/g) ?? []).length, 21);
  assert.ok(html.indexOf('question-5-summary-error') < html.indexOf('<details>'));
  assert.ok(html.indexOf('question-6-summary-error') > html.indexOf('<summary>'));
  assert.match(html, /id="question-21-summary-error"/);
  assert.equal(experience.requiredWorkflowMessage('1.1 Evaluate the sample'), 'Choose a response for question 1.1.');
});

test('workflow pagination clamps invalid positions and retains the already-filtered order without mutation', () => {
  const rows = Array.from({ length: 52 }, (_, index) => `Record ${index + 1}`);
  assert.deepEqual(experience.paginateWorkflowRows(rows, 2).items, rows.slice(25, 50));
  const last = experience.paginateWorkflowRows(rows, 500);
  assert.equal(last.page, 3); assert.equal(last.totalCount, 52);
  assert.deepEqual(last.items, ['Record 51', 'Record 52']);
  assert.equal(experience.paginateWorkflowRows([], NaN).page, 1);
  assert.equal(experience.paginateWorkflowRows(rows, 1, 0).pageSize, 1);
  assert.equal(rows[0], 'Record 1');
});

test('managed narrative wording preserves saved values, read-only access and existing error guidance', () => {
  const html = renderToStaticMarkup(createElement(narrative.WorkflowNarrativeField, {
    content: { label: 'Configured reflection question', helpText: 'Configured guidance.' }, id: 'reflection-control', value: 'Original saved answer', disabled: true,
    'aria-invalid': true, 'aria-describedby': 'existing-error', onChange() {}
  }));
  assert.match(html, /for="reflection-control"/);
  assert.match(html, /Configured reflection question/);
  assert.match(html, /aria-describedby="existing-error reflection-control-help"/);
  assert.match(html, /id="reflection-control-help"/);
  assert.match(html, /disabled=""/);
  assert.match(html, /Original saved answer/);
  assert.match(html, /Configured guidance\./);
});
