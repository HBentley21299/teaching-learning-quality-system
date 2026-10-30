import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const requireWeb = createRequire(new URL('../apps/web/package.json', import.meta.url));
const ts = requireWeb('typescript'), react = requireWeb('react'), jsx = requireWeb('react/jsx-runtime');
const { renderToStaticMarkup } = requireWeb('react-dom/server');
const sourceCache = new Map();
async function compiled(path) {
  if (!sourceCache.has(path)) sourceCache.set(path, ts.transpileModule(await readFile(new URL(`../apps/web/src/${path}`, import.meta.url), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);
  return sourceCache.get(path);
}
async function load(path, modules = {}, timers = {}) {
  const module = { exports: {} };
  new Function('require', 'exports', 'module', 'setTimeout', 'clearTimeout', await compiled(path))(name => { assert.ok(name in modules, `Unexpected import ${name} in ${path}`); return modules[name]; }, module.exports, module, timers.setTimeout ?? setTimeout, timers.clearTimeout ?? clearTimeout);
  return module.exports;
}
const listQuery = await load('services/listQuery.ts');
const loadingState = await load('components/LoadingState.tsx', { 'react/jsx-runtime': jsx });
const { WorkflowFilters } = await load('components/WorkflowFilters.tsx', { 'react/jsx-runtime': jsx, 'lucide-react':new Proxy({}, {get:()=>()=>null}) });
const { ProfileListControls } = await load('components/ProfileListControls.tsx', { 'react/jsx-runtime': jsx, './WorkflowFilters':{WorkflowFilters}, '../services/listQuery':listQuery });
const text = value => Array.isArray(value) ? value.map(text).join('') : value?.props ? text(value.props.children) : value == null || typeof value === 'boolean' ? '' : String(value);
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
globalThis.window = { addEventListener() {}, removeEventListener() {}, sessionStorage: { getItem() { return null; }, setItem() {} } };

// Execute the actual hooks and event handlers. Network responses and debounce time are
// controlled; these tests never call the local API or change persistent staff data.
async function mount(path, exportName, initialProps, responses = {}) {
  let props = initialProps, cursor = 0, pending = true, tree, nextTimer = 1;
  const slots = [], effects = [], calls = [], timers = new Map();
  const hooks = {
    useState(initial) { const slot = cursor++; if (!(slot in slots)) slots[slot] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[slot].value, update => { const value = typeof update === 'function' ? update(slots[slot].value) : update; if (!Object.is(value, slots[slot].value)) { slots[slot].value = value; pending = true; } }]; },
    useRef(initial) { const slot = cursor++; if (!(slot in slots)) slots[slot] = { current: initial }; return slots[slot]; },
    useId() { const slot = cursor++; return `test-${slot}`; },
    useMemo(factory, deps) { const slot = cursor++, previous = slots[slot]; if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index]))) slots[slot] = { deps, value: factory() }; return slots[slot].value; },
    useEffect(effect, deps) { const slot = cursor++, previous = slots[slot]; if (!previous || !deps || deps.some((value, index) => !Object.is(value, previous.deps?.[index]))) { slots[slot] = { deps }; effects.push(() => { previous?.cleanup?.(); slots[slot].cleanup = effect(); }); } }
  };
  const Button = ({ icon, variant, children, ...rest }) => react.createElement('button', rest, children);
  const DataTable = ({ rows, columns, rowKey }) => react.createElement('table', {}, react.createElement('tbody', {}, rows.map(row => react.createElement('tr', { key: rowKey(row) }, columns.map(column => react.createElement('td', { key: column.key }, column.render(row)))))));
  const Section = ({ title, toolbar, children, isLoading, error, isEmpty, emptyMessage }) => react.createElement('section', { 'aria-label': title }, toolbar, isLoading ? 'Loading records...' : error || (isEmpty ? emptyMessage : children));
  const Pagination = () => null;
  const api = new Proxy({}, { get: (_, method) => (...args) => { calls.push([method, ...args]); assert.ok(method in responses, `Unexpected API call ${String(method)}`); return Promise.resolve().then(() => typeof responses[method] === 'function' ? responses[method](...args) : structuredClone(responses[method])); } });
  const modules = {
    react: hooks, 'react/jsx-runtime': jsx, 'lucide-react': new Proxy({}, { get: () => () => null }),
    '../services/api': { api }, '../services/listQuery': listQuery,
    '../components/DataTable': { DataTable }, '../design-system/Button': { Button },
    '../components/CollapsibleSection': { CollapsibleSection: Section, Pagination },
    '../components/ProfileListControls': { ProfileListControls },
    './WorkflowFilters': { WorkflowFilters },
    './LoadingState': loadingState,
    '../components/LoadingState': loadingState,
    '../components/WorkflowFilters': { WorkflowFilters },
    '../components/ScrollableTableRegion': { ScrollableTableRegion: ({children}) => react.createElement('div',{},children) },
    '../components/UnsavedChangesGuard': { useUnsavedChanges: () => () => {}, confirmUnsavedNavigation: async () => true },
    '../components/ElevateStatusBadgeImage': { ElevateStatusBadgeImage: () => null },
    '../routes/ElevatePractice': { ElevatePracticeResultPage: () => null }
  };
  const loaded = await load(path, modules, { setTimeout: callback => { const id = nextTimer++; timers.set(id, callback); return id; }, clearTimeout: id => timers.delete(id) });
  const Component = loaded[exportName];
  function nodes() {
    const result = [];
    function visit(node) { if (Array.isArray(node)) return node.forEach(visit); if (!node || typeof node !== 'object') return; result.push(node); if(node.type===ProfileListControls)return visit(ProfileListControls(node.props)); if(node.type===WorkflowFilters)return visit(WorkflowFilters(node.props)); visit(node.props?.children); visit(node.props?.toolbar); visit(node.props?.actions); }
    visit(tree); return result;
  }
  async function settle() { for (let step = 0; step < 50; step++) { if (pending) { pending = false; cursor = 0; tree = Component(props); } while (effects.length) effects.shift()(); await new Promise(resolve => setImmediate(resolve)); if (!pending && !effects.length) return; } throw new Error('View did not settle'); }
  await settle();
  return {
    calls, nodes, settle, Section, DataTable, ProfileListControls, Pagination,
    markup: () => renderToStaticMarkup(tree),
    controls: section => nodes().find(node => node.type === ProfileListControls && node.props.section === section),
    section: title => nodes().find(node => node.type === Section && node.props.title === title),
    async query(section, patch) { const controls = this.controls(section); assert.ok(controls, `Missing controls for ${section}`); controls.props.onChange({ ...controls.props.query, ...patch }); await settle(); },
    async flushTimers() { const callbacks = [...timers.values()]; timers.clear(); for (const callback of callbacks) callback(); await settle(); },
    async expand(title, expanded = true) { const section = this.section(title); assert.ok(section, `Missing section ${title}`); section.props.onExpandedChange(expanded); await settle(); },
    async change(node, value) { assert.ok(node, 'Missing input'); node.props.onChange({ target: { value, checked: value } }); await settle(); },
    async click(label) { const button = nodes().find(node => (node.type === Button || node.type === 'button') && text(node.props.children) === label); assert.ok(button, `Missing button ${label}`); assert.ok(!button.props.disabled); await button.props.onClick(); await settle(); },
    async rerender(next) { props = next; pending = true; await settle(); }
  };
}
function field(page, label) {
  const wrapper = page.nodes().find(node => node.type === 'label' && node.props.children?.some?.(child => child?.type === 'span' && text(child.props.children).trim() === label));
  assert.ok(wrapper, `Missing field ${label}`); return wrapper.props.children.find(child => ['input', 'select'].includes(child?.type));
}
const member = (index, changes = {}) => ({ staffId: `s${index}`, displayName: `Person ${index}`, externalId: `AD${index}`, email: `person${index}@example.test`, faculties: [{ id: 'f', code: 'ENG', name: 'Engineering' }], teams: [{ id: 't', code: 'FAB', name: 'Fabrication' }], roleNames: ['Tutor'], accountStatus: 'active', openActionCount: index, overdueActionCount: 0, canOpenProfile: true, elevateJudgement: 'Exceeds expectations', elevateLevel: 2, ...changes });
const profileProps = { staffId: 'staff-a', academicYear: '2026/27', user: { userAccountId: 'viewer', permissions: [], scopes: [] } };
const detail = { staffId: 'staff-a', displayName: 'Alex Example', academicYear: '2026/27', email: 'alex@example.test', accountStatus: 'active', cpdRecords: [], coachingRecords: [], actions: [], elevateStatus: { levels: [], eligibleInternalCpd: [], internalCpdSessionsAttended: 0, canSubmitExplorerEvidence: false, canManageControlledLevels: false } };
const summary = { cpdCount: 2, livCount: 2, probationCount: 1, coachingCount: 2, openActionCount: 2, completedActionCount: 0, overdueActionCount: 0 };
const result = (items = [], changes = {}) => ({ items, page: 1, pageSize: 20, totalCount: items.length, totalPages: 1, filterOptions: { status: ['open', 'historic_status'], type: ['LIV', 'retired_process'], person: ['Historical reviewer'] }, ...changes });
const profileResponses = extra => ({ staffProfile: detail, staffProfileSectionSummary: summary, ...extra });

test('My Team searches distinct business terms and outcomes across the full permitted directory', async () => {
  const page = await mount('routes/MyTeam.tsx', 'MyTeam', { onOpenActions() {}, onOpenProfile() {} }, { myTeam: [member(1), member(2, { displayName: 'Zoë Partner', teams: [{ id: 'old', code: 'LEGACY', name: 'Historical fabrication' }], accountStatus: 'disabled', roleNames: ['Previous role'], elevateJudgement: 'Meets expectations', elevateLevel: 4 })] });
  await page.change(page.nodes().find(node => node.props?.['aria-label'] === 'Search team members'), 'zoe historical meets');
  const rows = page.nodes().find(node => node.type === page.DataTable).props.rows;
  assert.deepEqual(rows.map(row => row.staffId), ['s2']);
  assert.match(text(field(page, 'Role').props.children), /Previous role/);
  assert.match(text(field(page, 'Account status').props.children), /disabled/);
  assert.match(text(field(page, 'Elevate outcome').props.children), /Exceeds expectations/);
  assert.equal(page.calls.length, 1);
});

test('My Team excludes private outcome and level values from search, facets and sorting for restricted profiles', async () => {
  const page = await mount('routes/MyTeam.tsx', 'MyTeam', { onOpenActions() {}, onOpenProfile() {} }, { myTeam: [member(1, { canOpenProfile: false, elevateJudgement: 'Confidential sentinel', elevateLevel: 5 }), member(2)] });
  assert.doesNotMatch(text(field(page, 'Elevate outcome').props.children), /Confidential sentinel/);
  assert.doesNotMatch(text(field(page, 'Elevate level').props.children), /Level 5/);
  await page.change(page.nodes().find(node => node.props?.['aria-label'] === 'Search team members'), 'confidential sentinel');
  assert.match(page.markup(), /No team members match/);
  await page.change(page.nodes().find(node => node.props?.['aria-label'] === 'Search team members'), '');
  await page.change(field(page, 'Sort by'), 'elevate_level_desc');
  assert.deepEqual(page.nodes().find(node => node.type === page.DataTable).props.rows.map(row => row.staffId), ['s2', 's1']);
  assert.doesNotMatch(page.markup(), /Confidential sentinel|Level 5/);
});

test('My Team numeric sorting precedes pagination and filters reset a later page', async () => {
  const members = Array.from({ length: 31 }, (_, index) => member(index + 1));
  const page = await mount('routes/MyTeam.tsx', 'MyTeam', { onOpenActions() {}, onOpenProfile() {} }, { myTeam: members });
  await page.change(field(page, 'Sort by'), 'open_desc');
  assert.deepEqual(page.nodes().find(node => node.type === page.DataTable).props.rows.map(row => row.openActionCount), Array.from({ length: 25 }, (_, index) => 31 - index));
  await page.click('Next');
  assert.deepEqual(page.nodes().find(node => node.type === page.DataTable).props.rows.map(row => row.openActionCount), [6, 5, 4, 3, 2, 1]);
  await page.change(page.nodes().find(node => node.props?.['aria-label'] === 'Search team members'), 'Person 31');
  assert.deepEqual(page.nodes().find(node => node.type === page.DataTable).props.rows.map(row => row.staffId), ['s31']);
  assert.deepEqual(members.map(row => row.staffId), Array.from({ length: 31 }, (_, index) => `s${index + 1}`));
});

test('My Team retries a failed directory request without leaving the page', async () => {
  let requests = 0;
  const page = await mount('routes/MyTeam.tsx', 'MyTeam', { onOpenActions() {}, onOpenProfile() {} }, { myTeam: () => { if (++requests === 1) throw Error('offline'); return [member(1)]; } });
  assert.match(page.markup(), /could not be loaded/);
  await page.click('Try again');
  assert.equal(requests, 2); assert.doesNotMatch(page.markup(), /could not be loaded/);
  assert.equal(page.nodes().find(node => node.type === page.DataTable).props.rows.length, 1);
});

test('Profile list controls preserve existing query terms and expose historical options without rewriting their keys', async () => {
  const changes = [], page = await mount('components/ProfileListControls.tsx', 'ProfileListControls', { section: 'probation', query: { search: 'previous observation', sortBy: 'observation', status: 'historic_status' }, options: { status: ['historic_status'], type: ['2024/25'], person: ['Former reviewer'] }, totalCount: 0, onChange: query => changes.push(query) });
  assert.match(page.markup(), /0 matching records/); assert.match(page.markup(), /Academic year/); assert.match(page.markup(), /historic status/);
  await page.change(field(page, 'Academic year'), '2024/25');
  assert.deepEqual(changes.at(-1), { search: 'previous observation', sortBy: 'observation', status: 'historic_status', type: '2024/25' });
  await page.click('Reset'); assert.deepEqual(changes.at(-1), {});
});

test('Profile section search, facets, date and sort are sent together to the server before first-page loading', async () => {
  const page = await mount('features/StaffProfilePanel.tsx', 'StaffProfilePanel', profileProps, profileResponses({ staffProfileLiv: result() }));
  await page.query('liv', { search: 'historic reviewer', status: 'historic_status', type: 'retired_process', person: 'Historical reviewer', fromDate: '2024-01-01', toDate: '2026-12-31', sortBy: 'stage', sortDirection: 'asc' });
  assert.equal(page.calls.some(call => call[0] === 'staffProfileLiv'), false, 'typing is debounced');
  await page.flushTimers();
  const call = page.calls.find(call => call[0] === 'staffProfileLiv');
  assert.deepEqual(call.slice(1, 5), ['staff-a', '2026/27', 1, 20]);
  assert.deepEqual(call[6], { search: 'historic reviewer', status: 'historic_status', type: 'retired_process', person: 'Historical reviewer', fromDate: '2024-01-01', toDate: '2026-12-31', sortBy: 'stage', sortDirection: 'asc' });
  assert.match(page.markup(), /Historical reviewer|historic status/);
  assert.equal(page.controls('liv').props.totalCount, 0);
});

test('invalid profile date ranges explain the error and do not request or label an empty result', async () => {
  const changes = [];
  const controls = await mount('components/ProfileListControls.tsx', 'ProfileListControls', { section: 'liv', query: { search: 'retained', fromDate: '2026-10-29', toDate: '2026-09-01' }, totalCount: 0, onChange: query => changes.push(query) });
  assert.match(controls.markup(), /to date must be on or after/); assert.doesNotMatch(controls.markup(), /0 matching records/);
  for (const label of ['From date', 'To date']) {
    const input = field(controls, label); assert.equal(input.props['aria-invalid'], true);
    assert.ok(controls.nodes().some(node => node.props?.id === input.props['aria-describedby']));
  }
  await controls.click('Clear dates'); assert.deepEqual(changes.at(-1), { search: 'retained', fromDate: '', toDate: '' });
  const page = await mount('features/StaffProfilePanel.tsx', 'StaffProfilePanel', profileProps, profileResponses({staffProfileLiv: result()}));
  await page.query('liv', {fromDate: '2026-10-29', toDate: '2026-09-01'}); await page.flushTimers();
  assert.equal(page.calls.some(call => call[0] === 'staffProfileLiv'), false);
  assert.match(page.section('LIV records').props.error, /to date must be on or after/);
  await page.query('liv', {toDate: '2026-10-30'}); await page.flushTimers();
  assert.equal(page.calls.filter(call => call[0] === 'staffProfileLiv').length, 1);
  assert.equal(page.section('LIV records').props.error, '');
});

test('Profile sections ignore aborted older responses and keep loading until the current request resolves', async () => {
  const old = deferred(), current = deferred();
  const page = await mount('features/StaffProfilePanel.tsx', 'StaffProfilePanel', profileProps, profileResponses({ staffProfileLiv: (...args) => args[5].search === 'current' ? current.promise : old.promise }));
  await page.expand('LIV records');
  const oldCall = page.calls.find(call => call[0] === 'staffProfileLiv');
  await page.query('liv', { search: 'current' });
  assert.equal(oldCall[5].aborted, true);
  await page.flushTimers();
  old.resolve(result([{ id: 'stale', title: 'Stale confidential response', processKey: 'liv', createdAt: '2026-01-01', currentStage: 'cycle_1', status: 'in_progress' }]));
  await page.settle();
  assert.equal(page.section('LIV records').props.isLoading, true);
  assert.doesNotMatch(page.markup(), /Stale confidential response/);
  current.resolve(result([{ id: 'current', title: 'Current matching LIV', processKey: 'liv', createdAt: '2026-10-01', currentStage: 'cycle_2', status: 'in_progress' }], { totalCount: 41, totalPages: 3 }));
  await page.settle();
  assert.equal(page.section('LIV records').props.isLoading, false);
  assert.match(page.markup(), /Current matching LIV/); assert.doesNotMatch(page.markup(), /Stale confidential response/);
  const paging = page.nodes().find(node => node.type === page.Pagination && node.props.totalPages === 3);
  paging.props.onPageChange(2); await page.settle();
  assert.equal(page.calls.at(-1)[3], 2); assert.equal(page.calls.at(-1)[6].search, 'current');
});

test('Concurrent profile sections maintain independent loading and query state', async () => {
  const liv = deferred(), coaching = deferred();
  const page = await mount('features/StaffProfilePanel.tsx', 'StaffProfilePanel', profileProps, profileResponses({ staffProfileLiv: () => liv.promise, staffProfileCoaching: () => coaching.promise }));
  await page.expand('LIV records'); await page.expand('Coaching and mentoring');
  assert.equal(page.section('LIV records').props.isLoading, true); assert.equal(page.section('Coaching and mentoring').props.isLoading, true);
  liv.resolve(result()); await page.settle();
  assert.equal(page.section('LIV records').props.isLoading, false); assert.equal(page.section('Coaching and mentoring').props.isLoading, true);
  assert.ok(page.controls('coaching'), 'controls remain present while loading');
  coaching.resolve(result()); await page.settle();
  assert.equal(page.section('Coaching and mentoring').props.isLoading, false);
  assert.equal(page.controls('liv').props.totalCount, 0); assert.equal(page.controls('coaching').props.totalCount, 0);
});

test('Initial and reset profile sorting matches the displayed date descending controls', async () => {
  const page = await mount('features/StaffProfilePanel.tsx', 'StaffProfilePanel', profileProps, profileResponses({ staffProfileActions: result() }));
  await page.expand('Actions');
  assert.deepEqual(page.calls.find(call => call[0] === 'staffProfileActions')[6], { sortBy: 'date', sortDirection: 'desc' });
  await page.query('actions', { search: 'owner' }); await page.flushTimers();
  assert.deepEqual(page.calls.at(-1)[6], { sortBy: 'date', sortDirection: 'desc', search: 'owner' });
  page.controls('actions').props.onChange({}); await page.settle(); await page.flushTimers();
  assert.deepEqual(page.calls.at(-1)[6], { sortBy: 'date', sortDirection: 'desc' });
});

test('Actual collapsible section retains its toolbar during loading, failure and empty results', async () => {
  const toolbar = react.createElement('input', { 'aria-label': 'Persistent list filter', defaultValue: 'query' });
  const base = { title: 'Records', storageKey: 'test-records', defaultExpanded: true, persistState: false, toolbar, children: react.createElement('p', {}, 'Result data') };
  const page = await mount('components/CollapsibleSection.tsx', 'CollapsibleSection', { ...base, isLoading: true });
  assert.match(page.markup(), /Persistent list filter/); assert.match(page.markup(), /Loading records/); assert.doesNotMatch(page.markup(), /Result data/);
  await page.rerender({ ...base, isEmpty: true, emptyMessage: 'No matches for current query' });
  assert.match(page.markup(), /Persistent list filter/); assert.match(page.markup(), /No matches for current query/);
  await page.rerender({ ...base, error: 'Connection failed' });
  assert.match(page.markup(), /Persistent list filter/); assert.match(page.markup(), /Connection failed/);
});

test('Profile tabs connect to named panels and support a single tab stop plus arrow/Home/End navigation', async () => {
  let focused = '';
  globalThis.document = {getElementById:id=>({focus(){focused=id;}})};
  const page = await mount('features/StaffProfilePanel.tsx','StaffProfilePanel',profileProps,profileResponses({staffProfileCpd:result()}));
  const tabs = () => page.nodes().filter(node=>node.props?.role==='tab');
  assert.deepEqual(tabs().map(node=>node.props.tabIndex),[0,-1]);
  for(const tab of tabs())assert.ok(page.nodes().some(node=>node.props?.id===tab.props['aria-controls']&&node.props.role==='tabpanel'&&node.props['aria-labelledby']===tab.props.id));
  const key = async value => {let prevented=false;page.nodes().find(node=>node.props?.role==='tablist').props.onKeyDown({key:value,preventDefault(){prevented=true;}});await page.settle();assert.equal(prevented,true);};
  await key('End');assert.deepEqual(tabs().map(node=>node.props.tabIndex),[-1,0]);assert.equal(focused,tabs()[1].props.id);
  await key('End');assert.equal(page.calls.filter(call=>call[0]==='staffProfileCpd').length,1);
  await key('ArrowRight');assert.equal(tabs()[0].props['aria-selected'],true);
  await key('ArrowLeft');assert.equal(tabs()[1].props['aria-selected'],true);
  await key('Home');assert.equal(tabs()[0].props['aria-selected'],true);
});

test('An unavailable staff profile can be retried without leaving the page', async () => {
  let attempts=0;
  const page=await mount('features/StaffProfilePanel.tsx','StaffProfilePanel',profileProps,profileResponses({staffProfile:()=>{if(++attempts===1)throw Error('offline');return structuredClone(detail);}}));
  assert.match(page.markup(),/Staff profile unavailable/);
  await page.click('Try again');assert.equal(attempts,2);assert.doesNotMatch(page.markup(),/Staff profile unavailable/);
  assert.ok(page.nodes().some(node=>node.props?.role==='tablist'));
});

test('Collapsing during a new debounced query cancels its timer and reopening refetches that query', async () => {
  const page = await mount('features/StaffProfilePanel.tsx', 'StaffProfilePanel', profileProps, profileResponses({ staffProfileLiv: result() }));
  await page.expand('LIV records');
  assert.equal(page.calls.filter(call => call[0] === 'staffProfileLiv').length, 1);
  assert.equal(page.section('LIV records').props.isLoading, false);
  await page.query('liv', { search: 'new query after original load' });
  assert.equal(page.section('LIV records').props.isLoading, true);
  await page.expand('LIV records', false);
  assert.equal(page.section('LIV records').props.isLoading, false);
  await page.flushTimers();
  assert.equal(page.calls.filter(call => call[0] === 'staffProfileLiv').length, 1, 'collapse cancels the pending debounce');
  await page.expand('LIV records');
  const calls = page.calls.filter(call => call[0] === 'staffProfileLiv');
  assert.equal(calls.length, 2);
  assert.equal(calls[1][6].search, 'new query after original load');
  assert.equal(page.section('LIV records').props.isLoading, false);
});
