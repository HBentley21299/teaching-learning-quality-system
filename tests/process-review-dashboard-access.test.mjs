import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const requireWeb = createRequire(new URL('../apps/web/package.json', import.meta.url));
const ts = requireWeb('typescript'), react = requireWeb('react'), jsx = requireWeb('react/jsx-runtime');
const { renderToStaticMarkup } = requireWeb('react-dom/server');
async function loadSource(path, modules = {}) {
  const source = await readFile(new URL(`../apps/web/src/${path}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function('require', 'exports', 'module', code)(name => { assert.ok(name in modules, `Unexpected import ${name}`); return modules[name]; }, module.exports, module);
  return module.exports;
}
const listQuery = await loadSource('services/listQuery.ts');
const reviewTypes = await loadSource('services/processReviewTypes.ts');
const resultBar = await loadSource('components/SkillsScanResultBar.tsx', { 'react/jsx-runtime': jsx, './SkillsScanResultBar.css': {} });
const reporting = await loadSource('services/processReviewReporting.ts', { './listQuery': listQuery });
const insightModel = await loadSource('services/processReviewInsights.ts', { './processReviewReporting': reporting });
const visuals = await loadSource('components/DashboardVisuals.tsx', { 'react/jsx-runtime': jsx, './DashboardVisuals.css': {} });
const insights = await loadSource('components/ProcessReviewInsights.tsx', { 'react/jsx-runtime': jsx, './DashboardVisuals': visuals, './SkillsScanResultBar': resultBar,
  '../services/processReviewReporting': reporting, '../services/processReviewInsights': insightModel, './ProcessReviewInsights.css': {} });
const source = await readFile(new URL('../apps/web/src/routes/ProcessReviewDashboard.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const text = node => Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : node == null || typeof node === 'boolean' ? '' : String(node);
const configuration = { processKey: 'activate_growth_review', title: 'Activate+ Growth Reviews', version: 1, rowVersion: 'config-1', standards: [{ key: 'area_1', title: 'Immersive Technology', statements: [] }], ratingOptions: [], fieldLabels: {}, settings: {} };
const record = (id, changes = {}) => ({ recordId: id, processKey: 'activate_growth_review', title: `Review ${id}`, academicYear: '2026/27', facultyOrgUnitId: 'faculty-one', facultyName: 'Creative Studies', teamOrgUnitId: null, teamName: null, recordDate: '2026-11-01', ownerStaffId: 'owner-one', ownerName: 'Alex Morgan', status: 'draft', updatedAt: '2026-11-01T12:00:00Z', rowVersion: `row-${id}`, sampleCount: 0, ratedStatementCount: 0, statementCount: 0, openActionCount: 0, snapshotAsOf: null, ...changes });

async function dashboard({ canExport, processKey = 'activate_growth_review', loadRecords = async () => [], loadActions = async () => [], loadConfiguration = async () => configuration, loadDetail = async () => { throw new Error('Detail was not requested in this test'); } } = {}) {
  let cursor = 0, tree, needsRender = true;
  const slots = [], effects = [], loads = [], exports = [];
  const props = { processKey, academicYear: '2026/27', orgUnits: [], staff: [{ id: 'owner-one', displayName: 'Alex Morgan' }], onOpenRecord: () => {} };
  if (canExport !== undefined) props.canExport = canExport;
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[index].value, next => { const value = typeof next === 'function' ? next(slots[index].value) : next; if (!Object.is(value, slots[index].value)) { slots[index].value = value; needsRender = true; } }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect(effect, deps) { const index = cursor++, previous = slots[index]; if (!previous || deps.some((value, position) => !Object.is(value, previous.deps[position]))) { slots[index] = { deps }; effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = effect(); }); } },
    useMemo(factory, deps) { const index = cursor++, previous = slots[index]; if (!previous || deps.some((value, position) => !Object.is(value, previous.deps[position]))) slots[index] = { deps, value: factory() }; return slots[index].value; }
  };
  const Button = ({ icon, variant, busy, disabled, children, ...rest }) => react.createElement('button', { ...rest, disabled: disabled || busy }, children);
  const LoadingState = ({ label }) => react.createElement('p', { role: 'status' }, label);
  const WorkflowFeedback = ({ message }) => message ? react.createElement('p', { role: 'alert' }, message) : null;
  const KpiStrip = ({ items }) => react.createElement('dl', {}, items.map(item => react.createElement('div', { key: item.label }, react.createElement('dt', {}, item.label), react.createElement('dd', {}, item.value))));
  const DataTable = ({ rows, columns, rowKey, emptyMessage }) => react.createElement('table', {}, react.createElement('tbody', {}, rows.length ? rows.map(row => react.createElement('tr', { key: rowKey(row) }, columns.map(column => react.createElement('td', { key: column.key }, column.render(row))))) : react.createElement('tr', {}, react.createElement('td', {}, emptyMessage))));
  const modules = {
    react: hooks, 'react/jsx-runtime': jsx,
    'lucide-react': new Proxy({}, { get: () => () => null }),
    '../design-system/Button': { Button }, '../components/LoadingState': { LoadingState },
    '../components/DataTable': { DataTable }, '../components/KpiStrip': { KpiStrip },
    '../components/SkillsScanResultBar': resultBar,
    '../components/ProcessReviewInsights': insights,
    '../components/WorkflowFeedback': { WorkflowFeedback },
    '../components/CollapsibleSection': { CollapsibleSection: ({ title, children }) => react.createElement('section', {}, react.createElement('h3', {}, title), children) },
    '../components/WorkflowPagination': { WorkflowPagination: () => null, useWorkflowPagination: rows => ({ items: rows.slice(0, 25), page: 1, pageSize: 25, totalPages: Math.max(1, Math.ceil(rows.length / 25)), totalCount: rows.length, setPage: () => {} }) },
    '../services/processReviewTypes': reviewTypes, '../services/processReviewReporting': reporting, '../services/listQuery': listQuery,
    '../services/processReviewInsights': insightModel,
    './ProcessReviewReporting.css': {},
    '../services/api': { api: {
      processReviewConfiguration: async key => { loads.push(['configuration', key]); return loadConfiguration(key); },
      processReviews: async (key, year) => { loads.push(['records', key, year]); return loadRecords(key, year); },
      processReviewActions: async (key, year) => { loads.push(['actions', key, year]); return loadActions(key, year); },
      exportProcessReviews: async (...args) => { exports.push(args); return { ok: true }; },
      staff: async () => [], processReview: loadDetail
    } }
  };
  const module = { exports: {} };
  new Function('require', 'exports', 'module', compiled)(name => { assert.ok(name in modules, `Unexpected import ${name}`); return modules[name]; }, module.exports, module);
  function render() { needsRender = false; cursor = 0; tree = module.exports.ProcessReviewDashboard(props); }
  async function settle() {
    for (let round = 0; round < 30; round++) {
      if (needsRender) render();
      while (effects.length) effects.shift()();
      await flush();
      if (!needsRender) return;
    }
    throw new Error('Review dashboard did not settle');
  }
  function nodes() { const output = []; function walk(node) { if (Array.isArray(node)) return node.forEach(walk); if (!node || typeof node !== 'object') return; output.push(node); if ([insights.ProcessReviewInsights, insights.ProcessActionInsights, visuals.DashboardMetricCard, visuals.DashboardBreakdown].includes(node.type)) walk(node.type(node.props)); else walk(node.props?.children); } walk(tree); return output; }
  const button = label => nodes().find(node => node.type === Button && text(node.props.children) === label);
  function control(label) {
    const group = nodes().find(node => node.type === 'label' && text(Array.isArray(node.props.children) ? node.props.children[0] : node.props.children) === label);
    assert.ok(group, `Missing field ${label}`);
    return (Array.isArray(group.props.children) ? group.props.children : [group.props.children]).find(node => ['input', 'select', 'textarea'].includes(node?.type));
  }
  await settle();
  return {
    loads, exports, settle, button, markup: () => renderToStaticMarkup(tree),
    skillsMarkup: props => renderToStaticMarkup(react.createElement(module.exports.ActivateSkillsScanReport, props)),
    activateMarkup: props => renderToStaticMarkup(react.createElement(module.exports.ActivateReviewReport, { ...props, staff: [], onOpenRecord: () => {} })),
    detailMarkup: props => renderToStaticMarkup(react.createElement(module.exports.ProcessReviewReportDetail, { ...props, onOpenRecord: () => {} })),
    links: (review, onOpen) => module.exports.ReviewLinks({ review, onOpen }),
    tableRows: () => nodes().find(node => node.type === DataTable)?.props.rows ?? [],
    async click(label) { const found = button(label); assert.ok(found, `Missing button ${label}`); assert.equal(Boolean(found.props.disabled || found.props.busy), false, `${label} must be enabled`); found.props.onClick(); await settle(); },
    async clickVisual(label) { const found = nodes().find(node => node.type === 'button' && text(node.props.children).startsWith(label)); assert.ok(found, `Missing visual ${label}`); found.props.onClick(); await settle(); },
    async changeProps(changes) { Object.assign(props, changes); needsRender = true; await settle(); },
    async change(label, value) { const input = control(label); assert.ok(input, `Missing input ${label}`); input.props.onChange({ target: { value } }); await settle(); }
  };
}

test('view-only native reporting omits export controls by default and with an explicit false capability', async () => {
  for (const capability of [undefined, false]) {
    const page = await dashboard({ canExport: capability, loadRecords: async () => [record('one')] });
    assert.match(page.markup(), /Review one/);
    assert.equal(page.button('Export Excel'), undefined);
    assert.doesNotMatch(page.markup(), /Export Excel/);
    assert.equal(page.exports.length, 0);
    assert.ok(page.loads.some(call => call[0] === 'records'));
  }
});

test('export capability waits for a valid report load and exports the full permitted year despite a local search', async () => {
  const pending = deferred();
  const sourceRows = Object.freeze([Object.freeze(record('older')), Object.freeze(record('newer', { recordDate: '2026-11-16' }))]);
  const original = structuredClone(sourceRows);
  const page = await dashboard({ canExport: true, loadRecords: () => pending.promise });
  assert.equal(page.button('Export Excel')?.props.disabled, true);
  assert.equal(page.exports.length, 0);
  pending.resolve(sourceRows); await page.settle();
  assert.equal(page.button('Export Excel')?.props.disabled, false);
  assert.deepEqual(page.tableRows().map(row => row.recordId), ['newer', 'older']);
  await page.change('Search', 'does not match any review');
  assert.equal(page.tableRows().length, 0);
  assert.match(page.markup(), /0 of 2 permitted reviews/);
  await page.click('Export Excel');
  assert.deepEqual(page.exports, [['activate_growth_review', '2026/27']]);
  assert.deepEqual(sourceRows, original);
  assert.equal(sourceRows.length, 2);
});

test('a failed native report load leaves export unavailable even when the user has export capability', async () => {
  const page = await dashboard({ canExport: true, loadRecords: async () => { throw new Error('Reporting connection failed'); } });
  assert.match(page.markup(), /reporting view could not be loaded/);
  assert.equal(page.button('Export Excel')?.props.disabled, true);
  assert.equal(page.exports.length, 0);
});

test('selected review reporting displays six complete pillar bars and fifteen independent manual results', async () => {
  const page = await dashboard();
  const counts = [2, 3, 3, 3, 2, 2];
  const skillsScanPillars = counts.map((count, index) => ({ key: `pillar_${index + 1}`, title: `Skills pillar ${index + 1}`, subAreas: Array.from({ length: count }, (_, area) => ({ key: `skill_${index + 1}_${area + 1}`, title: `Manual sub-area ${index + 1}.${area + 1}` })) }));
  const scores = Object.fromEntries(skillsScanPillars.flatMap(pillar => pillar.subAreas.map(area => [area.key, 3.25])));
  const markup = page.skillsMarkup({ configuration: { ...configuration, skillsScanPillars, actionThemes: Array.from({ length: 5 }, (_, index) => ({ key: `area_${index + 1}`, title: `Specialist theme ${index + 1}` })) }, scores, submitted: true });
  assert.equal((markup.match(/role="meter"/g) ?? []).length, 6);
  assert.equal((markup.match(/class="skills-scan-result-ball"/g) ?? []).length, 6);
  assert.equal((markup.match(/Manual sub-area/g) ?? []).length, 15);
  assert.match(markup, /3\.25 \/ 5/);
  assert.doesNotMatch(markup, /Specialist theme/);
  const incomplete = page.skillsMarkup({ configuration: { ...configuration, skillsScanPillars }, scores: { ...scores, skill_1_2: null }, submitted: true });
  assert.equal((incomplete.match(/role="meter"/g) ?? []).length, 5);
  assert.match(incomplete, /Awaiting results/);
  assert.match(incomplete, /Not recorded/);
});

test('selected draft results remain visible without reported pillar means', async () => {
  const page = await dashboard();
  const skillsScanPillars = [{ key: 'one', title: 'Skills pillar', subAreas: [{ key: 'one_a', title: 'Manual sub-area A' }, { key: 'one_b', title: 'Manual sub-area B' }] }];
  const markup = page.skillsMarkup({ configuration: { ...configuration, skillsScanPillars }, scores: { one_a: 2.75, one_b: 4.25 }, submitted: false });
  assert.doesNotMatch(markup, /role="meter"/);
  assert.match(markup, /Draft results/);
  assert.match(markup, /2\.75/);
  assert.match(markup, /4\.25/);
  assert.doesNotMatch(markup, /3\.50/);
});

test('linked follow-up reporting keeps the previous scores separate from uncollected current results', async () => {
  const page = await dashboard();
  const skillsScanPillars = [{ key: 'pillar', title: 'Digital proficiency', subAreas: [{ key: 'skill', title: 'Productivity average' }] }];
  const previous = { recordId: 'parent', title: 'Initial team review', academicYear: '2026/27', recordDate: '2026-10-01', status: 'submitted', canEdit: true };
  const detail = { ...record('follow-up', { isFollowUp: true, status: 'submitted', parentReview: previous }),
    configuration: { ...configuration, skillsScanPillars }, data: { fields: {}, samples: [], responses: [], activate: { allSubTeams: true, subTeamOrgUnitIds: [], participantStaffIds: [], removedProgrammeLeaderStaffIds: [], skillsScanScores: {} } }, snapshots: [], actions: [], canEdit: true,
    parentReviewContext: { review: previous, configuration: { ...configuration, skillsScanPillars }, skillsScanScores: { skill: 4.5 }, meetingMinutes: 'Earlier meeting discussion', strengths: 'Earlier strength', development: 'Earlier priority', selectedSubTeams: [], participants: [] } };
  const markup = page.activateMarkup({ detail });
  assert.match(markup, /Previous review context · read only/);
  assert.match(markup, /4\.50 \/ 5/);
  assert.match(markup, /Earlier meeting discussion/);
  assert.match(markup, /Previous: Initial team review/);
  const currentResults = markup.slice(markup.indexOf('<h3>New Skills Scan results'), markup.indexOf('Meeting minutes &amp; agreed development'));
  assert.match(currentResults, /Not recorded/);
  assert.doesNotMatch(currentResults, /role="meter"|4\.50/);
});

test('parent and follow-up links open their own review identities and unavailable parent context is not invented', async () => {
  const page = await dashboard();
  const opened = [];
  const review = record('meeting', { isFollowUp: true,
    parentReview: { recordId: 'parent', title: 'Original meeting', status: 'submitted', academicYear: '2025/26' },
    followUpReviews: [{ recordId: 'child', title: 'Next meeting', status: 'draft', academicYear: '2026/27', recordDate: '2026-12-01' }] });
  const tree = page.links(review, id => opened.push(id));
  const buttons = [];
  function walk(node) { if (Array.isArray(node)) return node.forEach(walk); if (!node?.props) return; if (node.props.onClick) buttons.push(node); walk(node.props.children); }
  walk(tree); buttons.forEach(button => button.props.onClick());
  assert.deepEqual(opened, ['parent', 'child']);
  const markup = page.activateMarkup({ detail: { ...review, parentReview: null, configuration, data: { fields: {}, samples: [], responses: [], activate: { allSubTeams: true, skillsScanScores: {} } }, snapshots: [], actions: [] } });
  assert.match(markup, /Previous review context is unavailable/);
  assert.doesNotMatch(markup, /Original meeting|Previous Skills Scan results/);
});

test('a shared action linked to an initial and follow-up review contributes once to the register action metric', async () => {
  const page = await dashboard({ loadRecords: async () => [record('initial', { openActionCount: 1 }), record('follow-up', { isFollowUp: true, openActionCount: 1 })],
    loadActions: async () => [{ actionId: 'one-action', recordId: 'initial', title: 'Shared development action', dueDate: '2026-12-01', progress: 'open', ownerStaffId: 'owner-one', ownerName: 'Alex Morgan' }] });
  assert.match(page.markup(), /1 open linked actions · 1 unique actions/);
  await page.change('Review type', 'follow_up');
  assert.deepEqual(page.tableRows().map(row => row.recordId), ['follow-up']);
});

test('current-year follow-up reporting counts and faculty-filters an action from an earlier review year once', async () => {
  const page = await dashboard({ loadRecords: async () => [record('current-follow-up', { isFollowUp: true, openActionCount: 1 })],
    loadActions: async () => [{ actionId: 'earlier-action', recordId: 'earlier-source', academicYear: '2025/26', associatedReviewIds: ['current-follow-up'],
      recordTitle: 'Earlier initial review', title: 'Existing development action', dueDate: '2026-12-01', progress: 'open', ownerStaffId: 'owner-one', ownerName: 'Alex Morgan' }] });
  assert.match(page.markup(), /1 open linked actions · 1 unique actions/);
  await page.click('Native actions');
  await page.change('Faculty / area', 'faculty-one');
  assert.deepEqual(page.tableRows().map(row => row.actionId), ['earlier-action']);
  assert.equal(page.tableRows()[0].recordId, 'earlier-source');
});

test('DLW detail reports selected criteria only and separates proposed draft actions from live actions', async () => {
  const page = await dashboard();
  const pinned = { ...configuration, processKey: 'digital_learning_walk', standards: [{ key: 'agency', title: 'Learner agency', statements: [
    { key: 'chosen', text: 'Selected criterion wording' }, { key: 'other', text: 'Unselected criterion wording' }
  ] }], ratingOptions: [{ key: 'secure', label: 'College secure' }], fieldLabels: {} };
  const detail = { ...record('digital'), processKey: 'digital_learning_walk', configuration: pinned, snapshots: [], actions: [], data: {
    fields: { deliveryAreaKey: 'internal-area-key', deliveryAreaName: 'Higher education', strengths: 'Clear learner ownership', development: 'Improve feedback uptake' }, samples: [],
    digital: { selectedStatementKeys: ['chosen'], draftActions: [{ id: 'draft-guid-not-for-report', themeKey: 'agency', title: 'Proposed resource revision', ownerStaffId: 'owner-one', dueDate: '2026-12-01' }] },
    responses: [{ statementKey: 'chosen', ratingKey: 'secure', sampleIds: [], rationale: 'Evidence for the selected criterion' }, { statementKey: 'other', ratingKey: 'secure', sampleIds: [], rationale: 'Unselected stale answer must not appear' }]
  } };
  const markup = page.detailMarkup({ detail, staff: [{ id: 'owner-one', displayName: 'Alex Morgan' }] });
  assert.match(markup, /Selected criteria &amp; responses/);
  assert.match(markup, /Selected criterion wording/); assert.match(markup, /Evidence for the selected criterion/);
  const historyStart = markup.indexOf('Earlier criterion notes · read only');
  assert.ok(historyStart >= 0);
  assert.doesNotMatch(markup.slice(0, historyStart), /Evidence for the selected criterion/);
  assert.match(markup.slice(historyStart), /Evidence for the selected criterion/);
  assert.match(markup, /Earlier criterion selection · 1 category represented/);
  assert.match(markup, /1 \/ 2 criteria included · earlier partial selection/);
  assert.doesNotMatch(markup, /Unselected criterion wording|Unselected stale answer|internal-area-key|draft-guid-not-for-report/);
  assert.match(markup, /Higher education|Improve feedback uptake/);
  assert.match(markup, /Draft actions · not assigned/); assert.match(markup, /excluded from live action counts/);
  assert.match(markup, /Proposed resource revision/); assert.match(markup, /Alex Morgan/);
  assert.doesNotMatch(markup, /Samples &amp; associated staff|No samples have been saved|Linked samples:/);
  const submitted = page.detailMarkup({ detail: { ...detail, status: 'submitted' }, staff: [] });
  assert.doesNotMatch(submitted, /Draft actions · not assigned|Proposed resource revision/);
  const ratingsOnly = page.detailMarkup({ detail: { ...detail, data: { ...detail.data,
    responses: detail.data.responses.map(response => ({ ...response, rationale: null })) } }, staff: [] });
  assert.doesNotMatch(ratingsOnly, /Earlier criterion notes|Evidence notes|rationale/i);
  assert.match(ratingsOnly, /College secure/);
});

test('DLW detail expands selected categories, preserves pinned wording and shows each missing child rating', async () => {
  const page = await dashboard();
  const detail = { ...record('categories'), processKey: 'digital_learning_walk', snapshots: [], actions: [],
    configuration: { ...configuration, processKey: 'digital_learning_walk', standards: [
      { key: 'agency', title: 'Pinned learner agency', statements: [{ key: 'agency_one', text: 'Rated agency statement' }, { key: 'agency_two', text: 'Required unrated agency statement' }] },
      { key: 'safety', title: 'Pinned digital safety', statements: [{ key: 'safety_one', text: 'Required unrated safety statement' }] },
      { key: 'creation', title: 'Unselected creation category', statements: [{ key: 'creation_one', text: 'Excluded stale statement' }] }
    ], ratingOptions: [{ key: 'secure', label: '3 – Secure Practice' }] },
    data: { fields: {}, samples: [], digital: { selectedStandardKeys: ['agency', 'safety'], selectedStatementKeys: ['agency_one', 'creation_one'], draftActions: [] }, responses: [
      { statementKey: 'agency_one', ratingKey: 'secure', sampleIds: [], rationale: 'Observed digital learning evidence' },
      { statementKey: 'creation_one', ratingKey: 'secure', sampleIds: [], rationale: 'Excluded stale evidence' }
    ] } };
  const markup = page.detailMarkup({ detail, staff: [] });
  assert.match(markup, /2 categories selected/);
  assert.match(markup, /2 \/ 2 criteria included/); assert.match(markup, /1 \/ 2 included criteria rated/);
  assert.match(markup, /1 \/ 1 criteria included/); assert.match(markup, /0 \/ 1 included criteria rated/);
  assert.match(markup, /Required unrated agency statement/); assert.match(markup, /Required unrated safety statement/);
  assert.equal((markup.match(/Not rated/g) || []).length, 2);
  assert.match(markup, /3 – Secure Practice/);
  assert.doesNotMatch(markup, /Excluded stale|Unselected creation|earlier partial selection|Earlier sample evidence/);
  const empty = page.detailMarkup({ detail: { ...detail, data: { ...detail.data, digital: { ...detail.data.digital, selectedStandardKeys: [] } } }, staff: [] });
  assert.match(empty, /No categories selected/);
  assert.doesNotMatch(empty, /Rated agency statement|Required unrated agency statement|Observed digital learning evidence/);
});

test('DLW register displays pinned category counts and titles without presenting earlier subsets as whole categories', async () => {
  const page = await dashboard({ processKey: 'digital_learning_walk', loadConfiguration: async () => ({ ...configuration, processKey: 'digital_learning_walk' }), loadRecords: async () => [
    record('categories', { processKey: 'digital_learning_walk', selectedStandardKeys: ['agency', 'safety'], selectedStandards: [
      { key: 'agency', title: 'Pinned agency title', statementCount: 3, selectedStatementCount: 3 },
      { key: 'safety', title: 'Pinned safety title', statementCount: 5, selectedStatementCount: 5 }
    ], statementCount: 8, ratedStatementCount: 6 }),
    record('legacy', { processKey: 'digital_learning_walk', selectedStandardKeys: null, selectedStandards: [
      { key: 'agency', title: 'Earlier pinned agency title', statementCount: 3, selectedStatementCount: 1 }
    ], statementCount: 1, ratedStatementCount: 1 })
  ] });
  const markup = page.markup();
  assert.match(markup, /2 categories selected/); assert.match(markup, /Pinned agency title/); assert.match(markup, /Pinned safety title/);
  assert.match(markup, /Earlier criterion selection · 1 category represented/); assert.match(markup, /1 \/ 3 criteria included · earlier partial selection/);
  assert.match(markup, /7 \/ 9 criteria/);
  await page.change('Search', 'Earlier pinned');
  assert.deepEqual(page.tableRows().map(row => row.recordId), ['legacy']);
});

test('DLW register uses the selected-criteria denominator supplied by the review instead of the whole framework', async () => {
  const digitalConfiguration = { ...configuration, processKey: 'digital_learning_walk', ratingOptions: [] };
  const page = await dashboard({ processKey: 'digital_learning_walk', loadConfiguration: async () => digitalConfiguration,
    loadRecords: async () => [record('selected', { processKey: 'digital_learning_walk', statementCount: 2, ratedStatementCount: 1, openActionCount: 0 })] });
  assert.match(page.markup(), /1 \/ 2 criteria/);
  assert.equal(page.tableRows()[0].statementCount, 2);
  assert.match(page.markup(), /shared Learning Walk rating scale is unavailable/);
  assert.doesNotMatch(page.markup(), /Samples in those reviews/);
});

test('earlier DLW sample evidence remains a read-only history only when it exists', async () => {
  const page = await dashboard();
  const detail = { ...record('earlier-digital'), processKey: 'digital_learning_walk', snapshots: [], actions: [],
    configuration: { ...configuration, processKey: 'digital_learning_walk', standards: [{ key: 'agency', title: 'Learner agency', statements: [{ key: 'chosen', text: 'Selected criterion' }] }], ratingOptions: [{ key: 'secure', label: '3 – Secure Practice' }], fieldLabels: {} },
    data: { fields: {}, digital: { selectedStatementKeys: ['chosen'], draftActions: [] },
      samples: [{ id: 'old-sample', title: 'Earlier portfolio', sampleType: 'learner_work', staffIds: ['owner-one'], notes: 'Earlier evidence remains readable', evidenceLink: 'https://college.example/evidence' }],
      responses: [{ statementKey: 'chosen', ratingKey: 'secure', sampleIds: ['old-sample'], rationale: 'Current criterion notes' }] } };
  const markup = page.detailMarkup({ detail, staff: [{ id: 'owner-one', displayName: 'Alex Morgan' }] });
  assert.match(markup, /Earlier sample evidence · read only/);
  assert.match(markup, /Earlier evidence remains readable|Earlier linked samples: Earlier portfolio/);
  assert.match(markup, /https:\/\/college.example\/evidence/);
  assert.match(markup, /3 – Secure Practice/);
  assert.doesNotMatch(markup, /Add sample|Remove sample/);
});

test('DLW visual category and completion selections intersect with the named register and clear on year change', async () => {
  const category = { key: 'agency', title: 'Saved learner agency', statementCount: 3, selectedStatementCount: 3 };
  const page = await dashboard({ processKey: 'digital_learning_walk', loadRecords: async () => [
    record('agency-draft', { processKey: 'digital_learning_walk', selectedStandards: [category], statementCount: 3, ratedStatementCount: 1 }),
    record('agency-done', { processKey: 'digital_learning_walk', selectedStandards: [category], statementCount: 3, ratedStatementCount: 3, status: 'submitted' }),
    record('creation', { processKey: 'digital_learning_walk', selectedStandards: [{ ...category, key: 'creation', title: 'Saved creation' }], statementCount: 3, ratedStatementCount: 3, status: 'submitted' })
  ] });
  await page.clickVisual('Saved learner agency');
  assert.deepEqual(page.tableRows().map(row => row.recordId).sort(), ['agency-done', 'agency-draft']);
  await page.clickVisual('All included criteria rated');
  assert.deepEqual(page.tableRows().map(row => row.recordId), ['agency-done']);
  assert.match(page.markup(), /Visual selection: 1 named reviews/);
  await page.changeProps({ academicYear: '2027/28' });
  assert.equal(page.tableRows().length, 3);
  assert.doesNotMatch(page.markup(), /Clear visual selection/);
  await page.clickVisual('Draft reviews');
  assert.deepEqual(page.tableRows().map(row => row.recordId), ['agency-draft']);
  await page.click('Clear filters');
  assert.equal(page.tableRows().length, 3);
  await page.clickVisual('Alex Morgan');
  assert.equal(page.tableRows().length, 3);
  await page.clickVisual('Alex Morgan');
  await page.clickVisual('Saved learner agency');
  await page.changeProps({ processKey: 'activate_growth_review' });
  assert.equal(page.tableRows().length, 3);
  assert.doesNotMatch(page.markup(), /Clear visual selection/);
});

test('Activate+ journey and scan-completeness exploration preserves one record per meeting without averaging teams', async () => {
  const scores = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`skill-${i}`, 3.5]));
  const page = await dashboard({ loadRecords: async () => [
    record('initial', { status: 'submitted', skillsScanScores: scores }),
    record('follow-up', { isFollowUp: true, skillsScanScores: {} }),
    record('earlier', { skillsScanScores: null })
  ] });
  await page.clickVisual('Follow-up reviews');
  assert.deepEqual(page.tableRows().map(row => row.recordId), ['follow-up']);
  await page.clickVisual('Follow-up reviews');
  await page.clickVisual('15 sub-area results entered');
  assert.deepEqual(page.tableRows().map(row => row.recordId), ['initial']);
  assert.doesNotMatch(page.markup(), /3\.50 \/ 5|role="meter"/);
  await page.clickVisual('Clear visual selection');
  await page.clickVisual('Earlier workflow');
  assert.deepEqual(page.tableRows().map(row => row.recordId), ['earlier']);
});

test('pinned Skills Scan exploration uses that named review’s saved labels and withholds draft means', async () => {
  const pinnedConfiguration = { ...configuration, version: 3, skillsScanPillars: [{ key: 'saved-pillar', title: 'Saved productivity pillar', subAreas: [{ key: 'saved-skill', title: 'Saved productivity result' }] }] };
  const detail = { ...record('named', { skillsScanScores: { 'saved-skill': 4.5 } }), configuration: pinnedConfiguration,
    data: { fields: {}, responses: [], samples: [], activate: { skillsScanScores: { 'saved-skill': 4.5 } } }, snapshots: [], actions: [] };
  const page = await dashboard({ loadRecords: async () => [record('named', { skillsScanScores: { 'saved-skill': 4.5 } })], loadDetail: async () => detail,
    loadConfiguration: async () => ({ ...configuration, skillsScanPillars: [{ key: 'saved-pillar', title: 'Current renamed pillar', subAreas: [] }] }) });
  await page.change('Select a named review', 'named');
  const markup = page.markup();
  assert.match(markup, /Saved productivity pillar/);
  assert.match(markup, /Saved productivity result/);
  assert.doesNotMatch(markup, /Current renamed pillar|role="meter"/);
  assert.match(markup, /pillar means are withheld/);
});

test('review insight model deduplicates meeting and shared-action grains, handles missing criteria and due follow-up cues', () => {
  const first = record('first', { processKey: 'digital_learning_walk', status: 'submitted', statementCount: 3, ratedStatementCount: 2, selectedStandards: [{ key: 'agency', title: 'Saved agency', statementCount: 3, selectedStatementCount: 3 }] });
  const followup = record('followup', { isFollowUp: true, status: 'submitted', followUpDate: '2026-10-01', skillsScanScores: {} });
  const action = { actionId: 'shared', recordId: 'previous-year', associatedReviewIds: ['first', 'followup'], progress: 'in_progress', dueDate: '2026-09-01' };
  const model = insightModel.processReviewInsightModel(Object.freeze([first, first, followup]), Object.freeze([action, action]), '2026-10-31');
  assert.equal(model.total, 2); assert.equal(model.actions.length, 1); assert.equal(model.openActions.length, 1); assert.equal(model.overdueActions.length, 1);
  assert.equal(model.ratingCoverage, 67); assert.equal(model.categories[0].value, 1);
  assert.ok(model.attention.find(item => item.review.recordId === 'followup').reasons.includes('Planned follow-up due'));
  assert.equal(insightModel.isOverdueReviewAction({ ...action, dueDate: '' }, '2026-10-31'), false);
  assert.equal(insightModel.isOverdueReviewAction({ ...action, progress: 'complete' }, '2026-10-31'), false);
  assert.equal(insightModel.processReviewInsightModel([], [], '2026-10-31').ratingCoverage, null);
  assert.equal(insightModel.processReviewInsightModel([record('invalid', { statementCount: 2, ratedStatementCount: 5 })], [], '2026-10-31').ratingCoverage, null);
});

test('native action visuals filter impact independently of activity and retain a shared action’s identity', async () => {
  const base = { recordId: 'review', recordTitle: 'Named review', processKey: 'activate_growth_review', academicYear: '2026/27', ownerStaffId: 'owner-one', ownerName: 'Alex Morgan', dueDate: '2020-01-01', themeKey: 'theme', supportRequired: '', successEvidence: '', rowVersion: 'v1', updates: [], canEdit: false };
  const shared = { ...base, actionId: 'shared', title: 'Shared activity', progress: 'complete', impactStatus: 'awaiting_evidence' };
  const page = await dashboard({ loadRecords: async () => [record('review')], loadActions: async () => [shared, shared, { ...base, actionId: 'impact', title: 'Demonstrated impact', progress: 'in_progress', impactStatus: 'demonstrated' }] });
  await page.click('Native actions');
  assert.equal(page.tableRows().length, 2);
  await page.clickVisual('Impact demonstrated');
  assert.deepEqual(page.tableRows().map(row => row.actionId), ['impact']);
  await page.clickVisual('Clear action visual selection');
  await page.clickVisual('Activity completed');
  assert.deepEqual(page.tableRows().map(row => row.actionId), ['shared']);
  assert.match(page.markup(), /Completion and demonstrated impact are separate measures/);
});

test('review owner visual uses staff identity and synchronizes with area and form filters', async () => {
  const page = await dashboard({ loadRecords: async () => [record('alex'), record('sam', { ownerStaffId: 'owner-two', ownerName: 'Sam Casey' }), record('other-area', { facultyOrgUnitId: 'faculty-two', facultyName: 'Technical Studies' })] });
  await page.clickVisual('Creative Studies');
  assert.deepEqual(page.tableRows().map(row => row.recordId).sort(), ['alex', 'sam']);
  await page.clickVisual('Sam Casey');
  assert.deepEqual(page.tableRows().map(row => row.recordId), ['sam']);
  await page.change('Review owner', 'owner-one');
  assert.deepEqual(page.tableRows().map(row => row.recordId), ['alex']);
  await page.click('Clear filters');
  assert.equal(page.tableRows().length, 3);
});
