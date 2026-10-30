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
const source = await readFile(new URL('../apps/web/src/routes/ProcessReviewDashboard.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const text = node => Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : node == null || typeof node === 'boolean' ? '' : String(node);
const configuration = { processKey: 'activate_growth_review', title: 'Activate+ Growth Reviews', version: 1, rowVersion: 'config-1', standards: [{ key: 'area_1', title: 'Immersive Technology', statements: [] }], ratingOptions: [], fieldLabels: {}, settings: {} };
const record = (id, changes = {}) => ({ recordId: id, processKey: 'activate_growth_review', title: `Review ${id}`, academicYear: '2026/27', facultyOrgUnitId: 'faculty-one', facultyName: 'Creative Studies', teamOrgUnitId: null, teamName: null, recordDate: '2026-11-01', ownerStaffId: 'owner-one', ownerName: 'Alex Morgan', status: 'draft', updatedAt: '2026-11-01T12:00:00Z', rowVersion: `row-${id}`, sampleCount: 0, ratedStatementCount: 0, statementCount: 0, openActionCount: 0, snapshotAsOf: null, ...changes });

async function dashboard({ canExport, loadRecords = async () => [], loadActions = async () => [], loadConfiguration = async () => configuration } = {}) {
  let cursor = 0, tree, needsRender = true;
  const slots = [], effects = [], loads = [], exports = [];
  const props = { processKey: 'activate_growth_review', academicYear: '2026/27', orgUnits: [], staff: [{ id: 'owner-one', displayName: 'Alex Morgan' }], onOpenRecord: () => {} };
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
    '../components/WorkflowFeedback': { WorkflowFeedback },
    '../components/CollapsibleSection': { CollapsibleSection: ({ title, children }) => react.createElement('section', {}, react.createElement('h3', {}, title), children) },
    '../components/WorkflowPagination': { WorkflowPagination: () => null, useWorkflowPagination: rows => ({ items: rows.slice(0, 25), page: 1, pageSize: 25, totalPages: Math.max(1, Math.ceil(rows.length / 25)), totalCount: rows.length, setPage: () => {} }) },
    '../services/processReviewTypes': reviewTypes, '../services/processReviewReporting': reporting, '../services/listQuery': listQuery,
    './ProcessReviewReporting.css': {},
    '../services/api': { api: {
      processReviewConfiguration: async key => { loads.push(['configuration', key]); return loadConfiguration(key); },
      processReviews: async (key, year) => { loads.push(['records', key, year]); return loadRecords(key, year); },
      processReviewActions: async (key, year) => { loads.push(['actions', key, year]); return loadActions(key, year); },
      exportProcessReviews: async (...args) => { exports.push(args); return { ok: true }; },
      staff: async () => [], processReview: async () => { throw new Error('Detail was not requested in this test'); }
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
  function nodes() { const output = []; function walk(node) { if (Array.isArray(node)) return node.forEach(walk); if (!node || typeof node !== 'object') return; output.push(node); walk(node.props?.children); } walk(tree); return output; }
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
    links: (review, onOpen) => module.exports.ReviewLinks({ review, onOpen }),
    tableRows: () => nodes().find(node => node.type === DataTable)?.props.rows ?? [],
    async click(label) { const found = button(label); assert.ok(found, `Missing button ${label}`); assert.equal(Boolean(found.props.disabled || found.props.busy), false, `${label} must be enabled`); found.props.onClick(); await settle(); },
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
  assert.match(page.markup(), /Open actions<\/dt><dd>1<\/dd>/);
  await page.change('Review type', 'follow_up');
  assert.deepEqual(page.tableRows().map(row => row.recordId), ['follow-up']);
});

test('current-year follow-up reporting counts and faculty-filters an action from an earlier review year once', async () => {
  const page = await dashboard({ loadRecords: async () => [record('current-follow-up', { isFollowUp: true, openActionCount: 1 })],
    loadActions: async () => [{ actionId: 'earlier-action', recordId: 'earlier-source', academicYear: '2025/26', associatedReviewIds: ['current-follow-up'],
      recordTitle: 'Earlier initial review', title: 'Existing development action', dueDate: '2026-12-01', progress: 'open', ownerStaffId: 'owner-one', ownerName: 'Alex Morgan' }] });
  assert.match(page.markup(), /Open actions<\/dt><dd>1<\/dd>/);
  await page.click('Native actions');
  await page.change('Faculty / area', 'faculty-one');
  assert.deepEqual(page.tableRows().map(row => row.actionId), ['earlier-action']);
  assert.equal(page.tableRows()[0].recordId, 'earlier-source');
});
