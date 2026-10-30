import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const requireWeb = createRequire(new URL('../apps/web/package.json', import.meta.url));
const ts = requireWeb('typescript'), react = requireWeb('react'), jsxRuntime = requireWeb('react/jsx-runtime');
const { renderToStaticMarkup } = requireWeb('react-dom/server');

async function loadFile(path, modules = {}) {
  const source = await readFile(new URL(`../apps/web/src/${path}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'exports', 'module', code)(name => {
    assert.ok(name in modules, `Unexpected import: ${name}`); return modules[name];
  }, module.exports, module);
  return module.exports;
}

const listQuery = await loadFile('services/listQuery.ts');
const loadingState = await loadFile('components/LoadingState.tsx', { 'react/jsx-runtime': jsxRuntime });
const presentation = await loadFile('services/dashboardDataPresentation.ts', { './listQuery': listQuery });
const record = (id, overrides = {}) => ({ id, processKey: 'liv', title: `Review ${id}`, createdAt: '2026-10-01T09:00:00Z', recordDate: '2026-10-01', status: 'in_progress', subjectDisplayName: 'Alex Practitioner', subjectStaffId: 'staff-alex', submitterDisplayName: 'Sam Submitter', submitterStaffId: 'staff-sam', ownerDisplayName: 'Olivia Owner', ownerStaffId: 'staff-olivia', areaCode: 'TEAM', areaName: 'Teaching team', parentAreaCode: 'FAC', theme: 'Questioning', participantCount: 0, attendanceCredits: 0, learningMinutes: 0, sampleSize: 2, scoreTotal: 6, scoreCount: 2, barrierCount: 0, scoreMaximum: 3, ...overrides });
const formData = {
  dashboardKey: 'liv', columns: [{ key: 'evidence', label: 'Evidence of practice', section: 'Cycle 1' }, { key: 'visible', label: 'Section visibility', section: 'Internal' }, { key: 'rowVersion', label: 'Row version' }],
  rows: [{ recordId: 'r1', values: { evidence: 'Clear modelling and retrieval practice', visible: 'hidden', rowVersion: 'secret-token' } }],
  relatedTables: [{ key: 'visits', label: 'Visits', columns: [{ key: 'visitDate', label: 'Visit date' }, { key: 'feedback', label: 'Feedback' }, { key: 'visibility', label: 'Visibility' }], rows: [{ recordId: 'r1', values: { visitDate: '2026-10-03', feedback: 'Excellent vocabulary scaffolding', visibility: 'hidden' } }] }],
  wasTruncated: false, generatedAt: '2026-10-29T14:00:00Z'
};

test('saved arrays, structured answers, dates and status codes are readable without changing narrative content', () => {
  assert.equal(presentation.displayDashboardValue('["Questioning","Modelling"]'), 'Questioning; Modelling');
  assert.equal(presentation.displayDashboardValue({ focusArea: 'Feedback', agreed: false }), 'Focus Area: Feedback; Agreed: No');
  assert.equal(presentation.displayDashboardValue('2026-10-03'), '03 Oct 2026');
  assert.match(presentation.displayDashboardValue('2026-10-03T14:30:00Z'), /03 Oct 2026.*14:30.*UTC/);
  assert.equal(presentation.displayDashboardValue('not_seen'), 'Not seen');
  assert.equal(presentation.displayDashboardValue('Clear, concise feedback — including next steps.'), 'Clear, concise feedback — including next steps.');
});

test('personal dashboards show the associated individual and preserve genuine submitter separately from owner', () => {
  for (const process of ['eli', 'liv', 'als_liv', 'probation_case', 'coaching_session', 'uco_tla_review']) {
    assert.ok(presentation.recommendedDashboardColumns(process).includes('subject'), process);
    assert.ok(presentation.recommendedDashboardColumns(process).includes('submitter'), process);
  }
  const columns = presentation.dashboardExplorerColumns('liv', formData);
  const [row] = presentation.buildDashboardExplorerRows([record('r1')], columns, formData);
  assert.equal(row.values.subject, 'Alex Practitioner'); assert.equal(row.values.submitter, 'Sam Submitter'); assert.equal(row.values.owner, 'Olivia Owner');
  assert.equal(row.record.submitterStaffId, 'staff-sam');
  assert.equal(columns.find(column => column.key === 'sample').label, 'Visits recorded');
  assert.ok(!columns.some(column => /visibility|rowversion/i.test(column.key + column.label)));
  assert.ok(!row.searchText.includes('secret-token'));
  assert.equal(presentation.isDashboardBusinessColumn({ key: 'question_1', label: 'Visibility of learning outcomes' }), true);
});

test('search spans all saved answers and child business tables, even when their columns are hidden', () => {
  const columns = presentation.dashboardExplorerColumns('liv', formData);
  const rows = presentation.buildDashboardExplorerRows([record('r1'), record('r2', { subjectDisplayName: 'Taylor' })], columns, formData);
  assert.deepEqual(presentation.filterDashboardExplorerRows(rows, 'alex modelling', 'date', 'desc').map(row => row.id), ['r1']);
  assert.deepEqual(presentation.filterDashboardExplorerRows(rows, 'vocabulary scaffolding', 'date', 'desc').map(row => row.id), ['r1']);
  assert.equal(presentation.filterDashboardExplorerRows(rows, 'hidden', 'date', 'desc').length, 0);
});

test('repeated field rows are retained and dates sort chronologically rather than by displayed date label', () => {
  const data = { ...formData, rows: [...formData.rows, { recordId: 'r1', values: { evidence: 'A second observation' } }] };
  const columns = presentation.dashboardExplorerColumns('liv', data);
  const rows = presentation.buildDashboardExplorerRows([record('r1', { recordDate: '2026-09-30' }), record('r2', { recordDate: '2026-10-01' })], columns, data);
  assert.equal(rows[0].values['answer:evidence'], 'Clear modelling and retrieval practice\nA second observation');
  assert.deepEqual(presentation.filterDashboardExplorerRows(rows, '', 'date', 'desc').map(row => row.id), ['r2', 'r1']);
});

test('saved hidden answer columns retain their date/number types and support combined field filters without sorting missing values first', () => {
  const data = { ...formData, columns: [{ key: 'followup', label: 'Follow-up date', dataType: 'date' }, { key: 'hours', label: 'Teaching hours', dataType: 'number' }, { key: 'choice', label: 'Historical choice' }], rows: [
    { recordId: 'r1', values: { followup: '2026-10-02', hours: '10', choice: 'Retired choice' } },
    { recordId: 'r2', values: { followup: '2026-09-30', hours: '2', choice: 'Current choice' } },
    { recordId: 'r3', values: { followup: null, hours: null, choice: null } }
  ] };
  const columns = presentation.dashboardExplorerColumns('liv', data), rows = presentation.buildDashboardExplorerRows([record('r1'), record('r2'), record('r3')], columns, data);
  assert.equal(columns.find(column => column.key === 'answer:followup').kind, 'date');
  assert.deepEqual(presentation.filterDashboardExplorerRows(rows, '', 'answer:followup', 'asc', columns).map(row => row.id), ['r2', 'r1', 'r3']);
  assert.deepEqual(presentation.filterDashboardExplorerRows(rows, '', 'answer:hours', 'desc', columns).map(row => row.id), ['r1', 'r2', 'r3']);
  const filters = [{ key: 'answer:hours', operator: 'gte', value: '5' }, { key: 'answer:followup', operator: 'lte', value: '2026-10-03' }, { key: 'answer:choice', operator: 'equals', value: 'Retired choice' }];
  assert.deepEqual(presentation.filterDashboardExplorerRows(rows, '', 'date', 'desc', columns, filters).map(row => row.id), ['r1']);
  assert.deepEqual(presentation.filterDashboardExplorerRows(rows, '', 'date', 'desc', columns, [{ key: 'answer:choice', operator: 'empty', value: '' }]).map(row => row.id), ['r3']);
  assert.deepEqual(presentation.filterDashboardExplorerRows(rows, '', 'created', 'desc', columns, [{ key: 'created', operator: 'lte', value: '2026-10-01' }]).map(row => row.id), ['r1', 'r2', 'r3'], 'on or before includes the whole selected date, including stored times');
});

test('real ELI context labels deduplicate equivalent identities while retaining every question, distinct date and role', () => {
  const data = { dashboardKey: 'eli', columns: [
    { key: 'staff', label: 'Staff member', section: 'Record' }, { key: 'submitter', label: 'Submitted by', section: 'Record' },
    { key: 'year', label: 'Academic year', section: 'Record' }, { key: 'faculty', label: 'Faculty', section: 'Record' }, { key: 'team', label: 'Sub-team', section: 'Record' },
    { key: 'created', label: 'Created at', section: 'Record' }, { key: 'updated', label: 'Updated at', section: 'Record' }, { key: 'reviewer', label: 'Validated or reviewed by', section: 'Record' },
    { key: 'q1', label: 'Staff member', section: 'Assessment questions' }, { key: 'q2', label: 'Primary focus', section: 'LIV' }
  ], rows: [{ recordId: 'r1', values: { staff: 'Alex Practitioner', submitter: 'Chris Historical Submitter', year: '2026/27', faculty: 'FAC', team: 'TEAM', created: '01 Oct 2026 09:00', updated: '02 Oct 2026 10:00', reviewer: 'Vera Validator', q1: 'A distinct saved question answer', q2: 'Questioning' } }], wasTruncated: false, generatedAt: '' };
  const records = [record('r1', { processKey: 'eli', submitterDisplayName: undefined, submitterStaffId: undefined, academicYear: '2026/27' })];
  const columns = presentation.dashboardExplorerColumns('eli', data, records);
  assert.ok(!columns.some(column => ['answer:staff', 'answer:submitter', 'answer:year', 'answer:faculty', 'answer:team'].includes(column.key)));
  for (const key of ['answer:created', 'answer:updated', 'answer:reviewer', 'answer:q1', 'answer:q2']) assert.ok(columns.some(column => column.key === key), key);
  assert.equal(columns.find(column => column.key === 'answer:reviewer').section, 'Saved record context');
  const [row] = presentation.buildDashboardExplorerRows(records, columns, data, 'eli'); assert.equal(row.values.submitter, 'Chris Historical Submitter');
  const conflicting = presentation.dashboardExplorerColumns('eli', data, [record('r1')]);
  assert.ok(conflicting.some(column => column.key === 'answer:submitter'), 'different recorded context must remain visible rather than be discarded');
});

test('actions and UCO projection records appear without process-summary rows and keep scoped entry IDs for navigation', () => {
  const data = { dashboardKey: 'actions', columns: [{ key: 'title', label: 'Action title' }, { key: 'owner', label: 'Action owner' }, { key: 'date', label: 'Created on' }, { key: 'status', label: 'Status' }], rows: [{ recordId: 'action-1', values: { title: 'Review inclusive resources', owner: 'Avery Teacher', date: '2026-10-24', status: 'in_progress' } }], wasTruncated: false, generatedAt: '' };
  const rows = presentation.buildDashboardExplorerRows([], presentation.dashboardExplorerColumns('actions', data), data, 'actions');
  assert.equal(rows.length, 1); assert.equal(rows[0].id, 'action-1'); assert.equal(rows[0].values.title, 'Review inclusive resources'); assert.equal(rows[0].values.owner, 'Avery Teacher');
  assert.ok(!rows[0].searchText.includes('action-1'));
});

test('reviewer and observer remain separate from a recorded submitting actor in QA and UCO', () => {
  const data = { dashboardKey: 'qa_review', columns: [{ key: 'a', label: 'Activity' }, { key: 'r', label: 'Reviewer' }, { key: 's', label: 'Associated staff' }, { key: 'd', label: 'Observation date' }], rows: [{ recordId: 'e1', values: { a: 'Lesson visit', r: 'Robin Reviewer', s: 'Phoenix Practitioner', d: '2026-10-25' } }], wasTruncated: false, generatedAt: '' };
  const [row] = presentation.buildDashboardExplorerRows([], presentation.dashboardExplorerColumns('qa_review', data), data, 'qa_review');
  assert.equal(row.values.submitter, 'Not recorded'); assert.equal(row.values.reviewer, 'Robin Reviewer'); assert.equal(row.values.subject, 'Phoenix Practitioner'); assert.equal(row.values.date, '25 Oct 2026');
  assert.ok(presentation.recommendedDashboardColumns('qa_review').includes('reviewer'));
  assert.ok(presentation.recommendedDashboardColumns('uco_tla_review').includes('reviewer'));
  assert.ok(presentation.dashboardExplorerColumns('elevate_environment').some(column => column.key === 'barriers'));
  const ucoData = { ...data, columns: [...data.columns, { key: 'observation', label: 'Observation date and time' }, { key: 'workflow', label: 'Workflow status' }], rows: [{ recordId: 'uco1', values: { a: 'UCO Review', r: 'Robin Reviewer', observation: '25 Oct 2026 14:30', workflow: 'awaiting_lecturer' } }] };
  const [uco] = presentation.buildDashboardExplorerRows([], presentation.dashboardExplorerColumns('uco_tla_review', ucoData), ucoData, 'uco_tla_review');
  assert.equal(uco.values.date, '25 Oct 2026'); assert.equal(uco.values.status, 'With lecturer');
});

const roster = [
  { staffId: 's0', staffName: 'Noah Newstarter', areaCode: 'TEAM-A', areaName: 'Computing', parentAreaCode: 'FAC', currentLevel: 0, currentLevelName: 'Not yet awarded', qualifyingAttendanceCount: 2, nextLevel: 1, nextLevelName: 'Elevate Explorer', sessionsToNextLevel: 1 },
  { staffId: 's2', staffName: 'Morgan Teacher', areaCode: 'TEAM-B', areaName: 'Business', parentAreaCode: 'FAC', currentLevel: 2, currentLevelName: 'Elevate Enthusiast', qualifyingAttendanceCount: 6, nextLevel: 3, sessionsToNextLevel: 0, lastConfirmedAt: '2026-10-10' }
];

test('named Elevate Status register includes unawarded staff and uses exact, searchable level filters', () => {
  assert.equal(presentation.filterElevateStatusStaff(roster, '', 'all').length, 2);
  assert.deepEqual(presentation.filterElevateStatusStaff(roster, 'computing noah', '0').map(row => row.staffId), ['s0']);
  assert.deepEqual(presentation.filterElevateStatusStaff(roster, 'level 2', '2').map(row => row.staffId), ['s2']);
  assert.equal(presentation.filterElevateStatusStaff(roster, 'morgan', '1').length, 0);
});

async function component(exportName, initialProps, getData = () => structuredClone(formData)) {
  let cursor = 0, renderNeeded = true, tree, props = initialProps;
  const slots = [], effects = [], calls = [], storage = new Map();
  globalThis.window = { sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } };
  const hooks = {
    Fragment: react.Fragment,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, next => { const value = typeof next === 'function' ? next(slots[index].value) : next; if (!Object.is(value, slots[index].value)) { slots[index].value = value; renderNeeded = true; } }];
    },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useMemo(factory, deps) { const index = cursor++, previous = slots[index]; if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index]))) slots[index] = { deps, value: factory() }; return slots[index].value; },
    useEffect(effect, deps) { const index = cursor++, previous = slots[index]; if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index]))) { slots[index] = { deps }; effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = effect(); }); } }
  };
  const Button = ({ icon, variant, children, ...rest }) => react.createElement('button', rest, children);
  const modules = {
    react: hooks, 'react/jsx-runtime': jsxRuntime,
    'lucide-react': new Proxy({}, { get: () => () => null }),
    '../services/api': { api: { dashboardRecordData: (...args) => { calls.push(args); return Promise.resolve().then(() => getData(...args)); } } },
    '../services/dashboardDataPresentation': presentation,
    '../services/listQuery': listQuery,
    '../design-system/Button': { Button },
    './CollapsibleSection': { Pagination: () => null, CollapsibleSection: ({ children }) => jsxRuntime.jsx('section', { children }) },
    './DataTable': { DataTable: () => null },
    './ScrollableTableRegion': { ScrollableTableRegion: ({ children, className }) => jsxRuntime.jsx('div', { className, children }) },
    './LoadingState': loadingState,
    '../app/routing': { recordPath: id => `/record/${id}`, staffPath: id => `/staff/${id}` }
  };
  const exports = await loadFile(exportName === 'EliSubmissionBreakdown' ? 'components/EliSubmissionBreakdown.tsx' : 'components/DashboardDataExplorer.tsx', modules), Component = exports[exportName];
  function nodes() { const results = []; function walk(node) { if (Array.isArray(node)) return node.forEach(walk); if (!node || typeof node !== 'object') return; results.push(node); walk(node.props?.children); } walk(tree); return results; }
  async function settle() { for (let round = 0; round < 30; round++) { if (renderNeeded) { renderNeeded = false; cursor = 0; tree = Component(props); } while (effects.length) effects.shift()(); await new Promise(resolve => setImmediate(resolve)); if (!renderNeeded && !effects.length) return; } throw new Error('Component did not settle'); }
  await settle();
  return { calls, nodes, storage, markup: () => renderToStaticMarkup(tree), settle,
    renderBeforeEffects(nextProps) { props = nextProps; renderNeeded = false; cursor = 0; tree = Component(props); return renderToStaticMarkup(tree); },
    async rerender(nextProps) { props = nextProps; renderNeeded = true; await settle(); },
    async change(label, value) { const node = nodes().find(node => node.props?.['aria-label'] === label); assert.ok(node, `Missing ${label}`); node.props.onChange({ target: { value, checked: value } }); await settle(); },
    async click(label) { const node = nodes().find(node => (node.type === 'button' || node.type === Button) && (node.props['aria-label'] === label || text(node.props.children) === label)); assert.ok(node, `Missing ${label}`); await node.props.onClick(); await settle(); }
  };
}
function text(node) { return Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : node == null || typeof node === 'boolean' ? '' : String(node); }

test('data register loads one scoped bulk dataset, expands child tables, changes columns and navigates original records', async () => {
  const opened = [], staff = [];
  const page = await component('DashboardDataExplorer', { processKey: 'liv', academicYear: '2026/27', filters: { facultyCode: 'FAC', fromDate: '2026-10-01' }, records: [record('r1')], onOpenRecord: id => opened.push(id), onOpenStaff: id => staff.push(id) });
  assert.deepEqual(page.calls, [['2026/27', 'liv', { facultyCode: 'FAC', fromDate: '2026-10-01' }]]);
  assert.match(page.markup(), /Sam Submitter/); assert.match(page.markup(), /Alex Practitioner/);
  await page.click('Show form answers for Review r1');
  assert.match(page.markup(), /Clear modelling and retrieval practice/); assert.match(page.markup(), /Excellent vocabulary scaffolding/); assert.match(page.markup(), /03 Oct 2026/);
  assert.doesNotMatch(page.markup(), /secret-token|Section visibility|Row version/);
  await page.click('Open source record'); assert.deepEqual(opened, ['r1']);
  await page.click('Sam Submitter'); assert.deepEqual(staff, ['staff-sam']);
  await page.click('Show all columns');
  assert.match(page.markup(), /Evidence of practice/);
  assert.equal(page.calls.length, 1, 'expanding rows and choosing columns must not trigger per-record requests');
  await page.change('Search form data and people', 'vocabulary'); assert.match(page.markup(), /1 of 1 record matches/);
});

test('explicit register Sort by and combined field filters reach hidden saved answers and historical values without more requests', async () => {
  const data = { ...formData, columns: [{ key: 'choice', label: 'Archived practice area', section: 'Saved answers' }], rows: [{ recordId: 'r1', values: { choice: 'Retired choice' } }, { recordId: 'r2', values: { choice: 'Current choice' } }] };
  const page = await component('DashboardDataExplorer', { processKey: 'liv', academicYear: '2026/27', records: [record('r1'), record('r2')] }, () => data);
  const rowLabels = () => page.nodes().filter(node => node.props?.['aria-label']?.startsWith('Show form answers for')).map(node => node.props['aria-label']);
  await page.change('Sort form data by', 'answer:choice'); await page.change('Form data sort order', 'asc');
  assert.deepEqual(rowLabels(), ['Show form answers for Review r2', 'Show form answers for Review r1']);
  await page.click('Add field filter'); await page.change('Form filter 1 field', 'answer:choice'); await page.change('Form filter 1 match', 'equals'); await page.change('Form filter 1 value', 'Retired choice');
  assert.deepEqual(rowLabels(), ['Show form answers for Review r1']);
  assert.ok(page.nodes().some(node => node.type === 'option' && node.props.value === 'Retired choice'));
  await page.click('Add field filter'); await page.change('Form filter 2 value', 'Nobody');
  assert.equal(rowLabels().length, 0);
  await page.click('Clear field filters'); assert.equal(rowLabels().length, 2); assert.equal(page.calls.length, 1);
  assert.match(page.markup(), /Table search, field filters and sorting refine this register/);
});

test('scope changes discard pending stale data and send the new dashboard filters', async () => {
  let finishOld;
  const pending = new Promise(resolve => { finishOld = resolve; });
  const props = { processKey: 'liv', academicYear: '2026/27', filters: { facultyCode: 'OLD' }, records: [record('r1')] };
  const page = await component('DashboardDataExplorer', props, (_year, _process, filters) => filters.facultyCode === 'OLD' ? pending : { ...formData, rows: [{ recordId: 'r1', values: { evidence: 'New scope answers' } }] });
  await page.rerender({ ...props, filters: { facultyCode: 'NEW' } });
  finishOld(formData); await page.settle();
  await page.click('Show form answers for Review r1');
  assert.match(page.markup(), /New scope answers/); assert.doesNotMatch(page.markup(), /Clear modelling and retrieval practice/);
  assert.equal(page.calls.length, 2); assert.equal(page.calls[1][2].facultyCode, 'NEW');
});

test('field-filter empty recovery clears the local table filters and every expander retains an existing controlled target', async () => {
  const page = await component('DashboardDataExplorer', { processKey: 'liv', academicYear: '2026/27', records: [record('r1'), record('r2')] });
  let expander = page.nodes().find(node => node.props?.['aria-label'] === 'Show form answers for Review r1');
  assert.ok(page.nodes().some(node => node.props?.id === expander.props['aria-controls']), 'closed expanders still reference an existing target');
  await page.click('Add field filter'); await page.change('Form filter 1 value', 'Nobody matches this');
  assert.match(page.markup(), /No records match these filters/);
  await page.click('Clear table filters');
  assert.equal(page.nodes().filter(node => node.props?.['aria-label']?.startsWith('Show form answers for')).length, 2);
  assert.equal(page.calls.length, 1, 'local filter recovery never reloads the reporting dataset');
  await page.click('Show form answers for Review r1'); await page.click('Hide form answers for Review r1');
  expander = page.nodes().find(node => node.props?.['aria-label'] === 'Show form answers for Review r1');
  assert.ok(page.nodes().some(node => node.props?.id === expander.props['aria-controls']));
  assert.doesNotMatch(page.markup(), /Clear modelling and retrieval practice/, 'collapsed saved answers are unmounted');
});

test('Escape closes the native column chooser and restores focus to its own disclosure', async () => {
  const page = await component('DashboardDataExplorer', { processKey: 'liv', academicYear: '2026/27', records: [record('r1')] });
  const chooser = page.nodes().find(node => node.type === 'details' && node.props.className === 'dashboard-column-picker');
  assert.ok(chooser);
  let focus = 0, prevented = 0;
  const disclosure = { open: true, querySelector: selector => { assert.equal(selector, 'summary'); return { focus() { focus++; } }; } };
  chooser.props.onKeyDown({ key: 'Escape', currentTarget: disclosure, preventDefault() { prevented++; } });
  assert.equal(disclosure.open, false); assert.equal(focus, 1); assert.equal(prevented, 1);
  chooser.props.onKeyDown({ key: 'Tab', currentTarget: disclosure, preventDefault() { prevented++; } });
  assert.equal(prevented, 1, 'ordinary keyboard navigation is preserved');
});

test('a new scope cannot render already-loaded projection rows from the previous scope before effects run', async () => {
  const previous = { ...formData, columns: [{ key: 'title', label: 'Record title', section: 'Record' }], rows: [{ recordId: 'old-projection', values: { title: 'Prior faculty record' } }] };
  const props = { processKey: 'liv', academicYear: '2026/27', filters: { facultyCode: 'OLD' }, records: [] };
  const page = await component('DashboardDataExplorer', props, () => previous);
  assert.match(page.markup(), /Prior faculty record/);
  const immediate = page.renderBeforeEffects({ ...props, filters: { facultyCode: 'NEW' }, records: [record('new-summary')] });
  assert.doesNotMatch(immediate, /Prior faculty record/); assert.match(immediate, /Review new-summary/);
  await page.settle();
});

test('refreshing the same reporting scope reloads answers while preserving register search and column choices', async () => {
  let revision = 0;
  const props = { processKey: 'liv', academicYear: '2026/27', records: [record('r1')], refreshKey: 0 };
  const page = await component('DashboardDataExplorer', props, () => ({ ...formData, rows: [{ recordId: 'r1', values: { evidence: `Modelling evidence revision ${revision}` } }] }));
  await page.click('Show all columns'); await page.change('Search form data and people', 'modelling');
  revision = 1; await page.rerender({ ...props, refreshKey: 1 });
  assert.equal(page.calls.length, 2); assert.match(page.markup(), /Modelling evidence revision 1/);
  assert.equal(page.nodes().find(node => node.props?.['aria-label'] === 'Search form data and people').props.value, 'modelling');
  assert.match(page.storage.get('dashboard-columns:liv:v1'), /answer:evidence/);
  assert.match(page.markup(), /1 record/); assert.doesNotMatch(page.markup(), /1 records/);
});

test('failed full-data load leaves identity summaries available and provides a retry', async () => {
  let fail = true;
  const page = await component('DashboardDataExplorer', { processKey: 'liv', academicYear: '2026/27', records: [record('r1')] }, () => { if (fail) throw new Error('Service unavailable'); return formData; });
  assert.match(page.markup(), /Saved form answers could not be loaded/); assert.match(page.markup(), /Alex Practitioner/);
  fail = false; await page.click('Retry form data');
  assert.doesNotMatch(page.markup(), /Service unavailable/); assert.equal(page.calls.length, 2);
});

test('pending form data announces one real load without a false empty register, then shows a recoverable error', async () => {
  let reject;
  const pending = new Promise((_, no) => { reject = no; });
  const page = await component('DashboardDataExplorer', { processKey: 'liv', academicYear: '2026/27', records: [] }, () => pending);
  const initial = page.markup();
  assert.equal((initial.match(/class="loading-state /g) ?? []).length, 1);
  assert.equal((initial.match(/role="status"/g) ?? []).length, 1, 'one pending request must not announce empty counts or nested loaders');
  assert.match(initial, /Loading saved form answers/);
  assert.doesNotMatch(initial, /No records in this dashboard scope|0 of 0|Record data is unavailable/);
  reject(new Error('Network unavailable')); await page.settle();
  const failed = page.markup();
  assert.doesNotMatch(failed, /class="loading-state /);
  assert.match(failed, /role="alert"/); assert.match(failed, /Retry form data/); assert.match(failed, /Record data is unavailable/);
});

test('controlled staff level filter uses the dashboard selection without duplicating its selector', async () => {
  const changes = [], opened = [];
  const props = { rows: roster, academicYear: '2026/27', levelFilter: 'all', onLevelFilterChange: value => changes.push(value), onOpenStaff: id => opened.push(id) };
  const page = await component('ElevateStatusStaffExplorer', props);
  assert.match(page.markup(), /Noah Newstarter/); assert.match(page.markup(), /Morgan Teacher/); assert.match(page.markup(), /Attendance threshold met/);
  assert.equal(page.nodes().some(node => node.props?.['aria-label'] === 'Filter staff by exact Elevate Status level'), false);
  await page.rerender({ ...props, levelFilter: '0' });
  assert.match(page.markup(), /Noah Newstarter/); assert.doesNotMatch(page.markup(), /Morgan Teacher/);
  await page.click('Noah Newstarter'); assert.deepEqual(opened, ['s0']); assert.equal(page.calls.length, 0);
  assert.deepEqual(changes, []);
});

test('standalone staff register retains a working local exact-level selector', async () => {
  const page = await component('ElevateStatusStaffExplorer', { rows: roster });
  await page.change('Filter staff by exact Elevate Status level', '0');
  assert.match(page.markup(), /Noah Newstarter/); assert.doesNotMatch(page.markup(), /Morgan Teacher/);
});

test('staff status sorting covers remaining/date/area fields and attendance filters retain the award-confirmation distinction', async () => {
  const page = await component('ElevateStatusStaffExplorer', { rows: roster });
  await page.change('Staff attendance progress', 'threshold');
  assert.match(page.markup(), /Morgan Teacher/); assert.doesNotMatch(page.markup(), /Noah Newstarter/);
  assert.match(page.markup(), /does not replace the required confirmation and evidence/);
  await page.change('Staff attendance progress', 'all'); await page.change('Sort staff status register', 'remaining'); await page.change('Staff status sort order', 'desc');
  const textRows = page.markup().split('<tbody>')[1]; assert.ok(textRows.indexOf('Noah Newstarter') < textRows.indexOf('Morgan Teacher'));
});

test('ELI coverage supports all displayed sorts, historical area choices and multi-term search across submission details', async () => {
  const source = [
    { staffId: 'a', staffName: 'Zoe Staff', areaName: 'Retired area', hasSubmitted: true, submittedAt: '2026-10-02', assessmentRecordId: 'r1' },
    { staffId: 'b', staffName: 'Amélie Staff', areaName: 'Current area', hasSubmitted: true, submittedAt: '2026-09-30', assessmentRecordId: 'r2' },
    { staffId: 'c', staffName: 'No submission', hasSubmitted: false }
  ];
  const page = await component('EliSubmissionBreakdown', { rows: source, academicYear: '2026/27', onOpenStaff() {}, onOpenRecord() {} });
  const visible = () => page.nodes().find(node => Array.isArray(node.props?.rows))?.props.rows.map(row => row.staffId) ?? [];
  await page.change('Sort ELI submissions by', 'date'); await page.change('ELI submission sort order', 'desc');
  assert.deepEqual(visible(), ['a', 'b', 'c']);
  await page.change('ELI submission area', 'Retired area'); assert.deepEqual(visible(), ['a']);
  await page.change('ELI submission area', 'all'); await page.change('Search ELI submission breakdown', 'amelie submitted'); assert.deepEqual(visible(), ['b']);
  assert.equal(page.calls.length, 0);
});

test('QA form data uses one review-specific bulk loader with the same faculty and team filters', async () => {
  const calls = [], opened = [];
  const { QaDashboardDataExplorer } = await loadFile('components/QaDashboardDataExplorer.tsx', {
    react: { useCallback: callback => callback }, 'react/jsx-runtime': jsxRuntime,
    '../services/api': { api: { qaDashboardRecordData: (...args) => { calls.push(args); return Promise.resolve(formData); } } },
    './DashboardDataExplorer': { DashboardDataExplorer: () => null }
  });
  const wrapper = QaDashboardDataExplorer({ reviewId: 'qa-review', academicYear: '2026/27', facultyOrgUnitId: 'qa-faculty', teamOrgUnitId: 'qa-team', onOpenEvidence: id => opened.push(id) });
  assert.equal(wrapper.props.processKey, 'qa_review'); assert.equal(wrapper.props.records, undefined, 'the register must not reuse review summaries that may include excluded or draft submissions');
  assert.deepEqual(await wrapper.props.loadData(), formData); assert.deepEqual(calls, [['qa-review', 'qa-faculty', 'qa-team']]);
  wrapper.props.onOpenEntry('e1'); assert.deepEqual(opened, ['e1']);
  const page = await component('DashboardDataExplorer', { ...wrapper.props, loadData: wrapper.props.loadData });
  assert.equal(page.calls.length, 0, 'a QA view must not call the generic reporting permission endpoint');
});
