import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const webRequire = createRequire(new URL('../apps/web/package.json', import.meta.url));
const ts = webRequire('typescript');
const jsxRuntime = webRequire('react/jsx-runtime');
const { createElement } = webRequire('react');
const { renderToStaticMarkup } = webRequire('react-dom/server');
globalThis.window = { addEventListener() {}, removeEventListener() {}, requestAnimationFrame(callback) { callback(); return 0; }, confirm() { return true; } };

async function loadSupport(path, modules = {}) {
  const source = await readFile(new URL(`../apps/web/src/${path}`, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const module = { exports: {} };
  new Function('require', 'exports', 'module', output.outputText)(name => modules[name], module.exports, module);
  return module.exports;
}
const listQuery = await loadSupport('services/listQuery.ts');
const loadingState = await loadSupport('components/LoadingState.tsx', { 'react/jsx-runtime': jsxRuntime });
const dashboardOrgVisibility = await loadSupport('services/dashboardOrgVisibility.ts');
const qaEvidenceSaveQueue = await loadSupport('services/qaEvidenceSaveQueue.ts');
const learningWalkDeliveryAreas = await loadSupport('services/learningWalkDeliveryAreas.ts');
const { AdminListSort } = await loadSupport('components/AdminListSort.tsx', { 'react/jsx-runtime': jsxRuntime });
const { WorkflowFilters } = await loadSupport('components/WorkflowFilters.tsx', { 'react/jsx-runtime': jsxRuntime, 'lucide-react': new Proxy({}, { get: () => () => null }) });
const workflowDefaults = JSON.parse(await readFile(new URL('../shared/workflow-form-content.json', import.meta.url), 'utf8'));

// Run real component renders, effects and event handlers with deterministic hook storage.
// API calls are stubbed: these tests never touch accounts, configuration or message queues.
async function panel(file, exportName, initialProps, responses = {}) {
  let cursor = 0, pendingRender = true, tree;
  let navigationDecisionPending = false;
  const slots = [], effects = [], guards = new Map(), calls = [];
  let props = initialProps;
  const hooks = {
    useRef(initial) { const slot = cursor++; if (!(slot in slots)) slots[slot] = { current: initial }; return slots[slot]; },
    useId() { return `admin-test-${cursor++}`; },
    useState(initial) {
      const slot = cursor++;
      if (!(slot in slots)) slots[slot] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[slot].value, update => {
        const next = typeof update === 'function' ? update(slots[slot].value) : update;
        if (!Object.is(next, slots[slot].value)) { slots[slot].value = next; pendingRender = true; }
      }];
    },
    useEffect(effect, deps) {
      const slot = cursor++, previous = slots[slot];
      if (!previous || !deps || deps.some((value, index) => !Object.is(value, previous.deps?.[index]))) {
        slots[slot] = { deps };
        effects.push(() => { previous?.cleanup?.(); slots[slot].cleanup = effect(); });
      }
    },
    useMemo(factory, deps) {
      const slot = cursor++, previous = slots[slot];
      if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index]))) slots[slot] = { deps, value: factory() };
      return slots[slot].value;
    },
    useCallback(callback, deps) { return hooks.useMemo(() => callback, deps); }
  };
  const api = new Proxy({}, { get: (_, name) => (...args) => {
    calls.push([name, ...args]);
    if (!(name in responses)) throw new Error(`Unexpected API call: ${name}`);
    return Promise.resolve(typeof responses[name] === 'function' ? responses[name](...args) : structuredClone(responses[name]));
  } });
  const Button = ({ icon, variant, busy, children, ...props }) => createElement('button', { ...props, disabled: props.disabled || busy }, children);
  const modules = {
    react: hooks, 'react/jsx-runtime': jsxRuntime,
    'lucide-react': new Proxy({}, { get: () => () => null }),
    '../services/api': { api },
    '../services/listQuery': listQuery,
    '../components/AdminListSort': { AdminListSort },
    '../components/WorkflowFilters': { WorkflowFilters },
    '../../../../shared/workflow-form-content.json': { default: workflowDefaults },
    '../services/formContent': { invalidateFormContent: key => calls.push(['invalidateFormContent', key]) },
    '../components/WorkflowFeedback': { WorkflowFeedback: ({ message, tone }) => message ? createElement('div', { role: tone === 'error' ? 'alert' : 'status' }, message) : null },
    '../components/WorkflowErrorSummary': { WorkflowErrorSummary: ({ errors }) => errors.length ? createElement('div', { role: 'alert' }, errors.map(error => error.message).join(' ')) : null },
    '../components/ScrollableTableRegion': { ScrollableTableRegion: ({ children }) => createElement('div', { className: 'table-shell' }, children) },
    '../components/ExportButtons': { ReportButton: () => null },
    '../components/LoadingState': loadingState,
    '../components/ModalDialog': { ModalDialog: ({ children }) => createElement('div', {}, children) },
    '../services/csvImportPresentation': { canUseAdminCsvImport: () => false },
    './ElevatePractice': { ElevatePracticeAdminEditor: () => null },
    '../components/CourseMultiSelect': { CourseMultiSelect: () => null },
    '../components/WorkScrutinyCreateForm': { WorkScrutinyResponseField: () => null },
    '../app/history': { writeAppPath: path => calls.push(['writeAppPath', path]) }, '../app/qaAdminNavigation': {}, './QaAdminCentre': {},
    '../services/qaEvidenceSaveQueue': qaEvidenceSaveQueue, '../services/qaOutcomeLabels': { useQaOutcomeLabels: () => ({ below: 'Below', at: 'Meets', above: 'Exceeds', notApplicable: 'Not applicable' }), qaCombinedOutcomeLabel: labels => `${labels.at} or ${labels.above}` },
    '../components/QaDashboardDataExplorer': {}, '../services/dashboardOrgVisibility': dashboardOrgVisibility,
    '../services/learningWalkDeliveryAreas': learningWalkDeliveryAreas,
    '../design-system/Button': { Button },
    '../components/CollapsibleSection': { CollapsibleSection: props => createElement('section', {}, createElement('h2', {}, props.title), props.actions, props.children), Pagination: () => null },
    '../components/UnsavedChangesGuard': { confirmUnsavedNavigation: async () => true, useNavigationDecisionPending: () => navigationDecisionPending, useUnsavedChanges: config => { guards.set(config.label, config); return () => { const current = guards.get(config.label); if (current) guards.set(config.label, { ...current, dirty: false, saving: false }); }; } },
    './PermissionsAdmin.css': {}, './AdminWorkflowContent.css': {}
  };
  const source = await readFile(new URL(`../apps/web/src/routes/${file}`, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const module = { exports: {} };
  const expose = file === 'AdminManagedLists.tsx' ? '\nmodule.exports.ManagedList = ManagedList;' : file === 'QaHub.tsx' ? '\nmodule.exports.QaReviewList = QaReviewList; module.exports.QaActionGroupCards = QaActionGroupCards; module.exports.QaCriterion = QaCriterion; module.exports.QaActionCreator = QaActionCreator; module.exports.QaReviewWorkspace = QaReviewWorkspace; module.exports.QaEvidenceEditor = QaEvidenceEditor; module.exports.QaReviewEditor = QaReviewEditor;' : '';
  new Function('require', 'exports', 'module', output.outputText + expose)(name => {
    if (!(name in modules)) throw new Error(`Unexpected module: ${name}`);
    return modules[name];
  }, module.exports, module);
  const Component = module.exports[exportName];
  function nodes() {
    const found = [];
    function walk(node) {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== 'object') return;
      found.push(node); walk(node.props?.children); walk(node.props?.actions); walk(node.props?.primary);
      if (node.type === AdminListSort) walk(AdminListSort(node.props));
    }
    walk(tree); return found;
  }
  async function settle() {
    for (let round = 0; round < 40; round++) {
      if (pendingRender) { pendingRender = false; cursor = 0; tree = Component(props); }
      while (effects.length) effects.shift()();
      await new Promise(resolve => setImmediate(resolve));
      if (!pendingRender && !effects.length) return;
    }
    throw new Error('Panel did not settle');
  }
  await settle();
  return {
    calls, guards, nodes, Button, settle,
    markup: () => renderToStaticMarkup(tree),
    async click(label) {
      const button = nodes().find(node => (node.type === Button || node.type === 'button') && text(node.props.children) === label);
      assert.ok(button, `Missing button ${label}`); assert.ok(!button.props.disabled, `Disabled button ${label}`);
      await button.props.onClick(); await settle();
    },
    async change(node, value) { node.props.onChange({ target: { value, checked: value } }); await settle(); },
    changeBeforeEffects(node, value) { node.props.onChange({ target: { value, checked: value } }); if (pendingRender) { pendingRender = false; cursor = 0; tree = Component(props); } },
    async rerender(nextProps) { props = nextProps; pendingRender = true; await settle(); },
    async navigationPending(value) { navigationDecisionPending = value; pendingRender = true; await settle(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
    async saveGuard(label) { const result = await guards.get(label).onSave(); await settle(); return result; }
  };
}
function text(value) {
  if (Array.isArray(value)) return value.map(text).join('');
  if (value?.props) return text(value.props.children);
  return value == null || typeof value === 'boolean' ? '' : String(value);
}
const configuration = { enabled: false, testMode: true, provider: 'MicrosoftGraph', tenantId: '', clientId: '', senderAddress: 'qa@example.test', senderDisplayName: 'QA', replyToAddress: '', testRecipient: '', applicationUrl: 'https://example.test', pollSeconds: 10, smtpHost: 'smtp.example.test', smtpPort: 587, smtpSecurity: 'StartTls', smtpAuthentication: 'OAuth2', smtpUsername: '' };
function field(page, label) {
  const wrapper = page.nodes().find(node => node.type === 'label' && node.props.children?.some?.(child => child?.type === 'span' && text(child.props.children).trim() === label));
  assert.ok(wrapper, `Missing field ${label}`);
  const children = Array.isArray(wrapper.props.children) ? wrapper.props.children : [wrapper.props.children];
  const input = children.find(child => ['input', 'select'].includes(child?.type));
  assert.ok(input, `Missing input ${label}`); return input;
}

test('room search covers building names and filtering retains historical choices, with numeric sorting across every row', async () => {
  const rooms = [
    { id: 'ten', roomCode: 'Room 10', buildingName: 'North', assessmentCount: 9, isActive: true },
    { id: 'two', roomCode: 'Room 2', buildingName: 'North', assessmentCount: 1, isActive: true },
    { id: 'old', roomCode: 'Room 1', buildingName: 'Héritage', assessmentCount: 2, isActive: false }
  ];
  const page = await panel('AdminRooms.tsx', 'AdminRooms', {}, { adminRooms: rooms });
  let html = page.markup(); assert.ok(html.indexOf('<strong>Room 2') < html.indexOf('<strong>Room 10'));
  assert.match(text(field(page, 'Building').props.children), /Héritage/);
  await page.change(field(page, 'Show'), 'all');
  await page.change(field(page, 'Search rooms'), 'heritage room');
  assert.match(page.markup(), /<strong>Room 1/); assert.doesNotMatch(page.markup(), /<strong>Room 10/);
  await page.change(field(page, 'Search rooms'), '');
  await page.change(page.nodes().find(node => node.props?.['aria-label'] === 'Sort by'), 'usage-desc');
  html = page.markup(); assert.ok(html.indexOf('<strong>Room 10') < html.indexOf('<strong>Room 1<'));
  assert.equal(page.calls.length, 1, 'view controls never write data');
});

test('managed choice view sorting and search never persist form order or enable ambiguous manual moves', async () => {
  const values = [{ id: 'b', displayName: 'Zulu', valueKey: 'legacy_code', displayOrder: 1, isActive: false }, { id: 'a', displayName: 'Alpha', valueKey: 'alpha', displayOrder: 2, isActive: true }];
  const page = await panel('AdminManagedLists.tsx', 'ManagedList', { list: { lookupKey: 'topics', name: 'Topics', description: '', usedIn: [], values }, onDirtyChange() {}, onRefresh: async () => {} });
  assert.ok(page.markup().indexOf('<strong>Zulu') < page.markup().indexOf('<strong>Alpha'));
  await page.change(page.nodes().find(node => node.props?.['aria-label'] === 'Sort by'), 'name-asc');
  assert.ok(page.markup().indexOf('<strong>Alpha') < page.markup().indexOf('<strong>Zulu'));
  assert.ok(page.nodes().filter(node => ['Move up', 'Move down'].includes(node.props?.title)).every(node => node.props.disabled));
  await page.change(field(page, 'Find a choice'), 'legacy code');
  assert.match(page.markup(), /<strong>Zulu/); assert.doesNotMatch(page.markup(), /<strong>Alpha/);
  assert.deepEqual(values.map(value => value.id), ['b', 'a']); assert.equal(page.calls.length, 0);
});

test('administrative records search business area names and years while status options come from the complete source', async () => {
  const base = { moduleName: 'Teaching', moduleKey: 'learning_walk', recordType: 'learning_walk', ownerStaffName: 'Casey', subjectStaffName: 'Alex', createdAt: '2026-01-01', archivedAt: null };
  const page = await panel('AdminRecordsPanel.tsx', 'AdminRecordsPanel', { onOpenRecord() {} }, { adminRecords: [
    { ...base, recordId: 'r1', title: 'Current', facultyName: 'Engineering', status: 'submitted', academicYear: '2026/27', recordDate: '2026-10-01' },
    { ...base, recordId: 'r2', title: 'Historic', facultyName: 'Humanities', status: 'reopened', academicYear: '2024/25', recordDate: '2024-10-01', archivedAt: '2025-01-01' }
  ] });
  await page.change(page.nodes().find(node => node.props?.['aria-label'] === 'Search records'), 'engineering 2026/27');
  assert.match(page.markup(), /<strong>Current/); assert.doesNotMatch(page.markup(), /<strong>Historic/);
  assert.match(text(field(page, 'Academic year').props.children), /2024\/25/);
  assert.match(text(field(page, 'Status').props.children), /Reopened/);
  assert.equal(page.calls.length, 1);
});

test('QA review list supports historical year and owner facets and searching year across the whole permitted list', async () => {
  const base = { status: 'open', theme: 'Quality', ownerName: 'Zoe', teamCount: 1, activityCount: 2, evidenceCount: 0 };
  const summary = { reviews: [{ ...base, id: 'r2', title: 'Review 10', academicYear: '2026/27', closingDate: '2026-10-01' }, { ...base, id: 'r1', title: 'Review 2', academicYear: '2024/25', closingDate: '2024-10-01', status: 'archived', ownerName: 'Historic owner' }], canManageReviews: false };
  const page = await panel('QaHub.tsx', 'QaReviewList', { summary, onNavigate() {} });
  assert.match(text(field(page, 'Academic year').props.children), /2024\/25/);
  assert.match(text(field(page, 'Owner').props.children), /Historic owner/);
  await page.change(field(page, 'Status'), 'all');
  await page.change(page.nodes().find(node => node.props?.['aria-label'] === 'Search reviews'), '2024/25 historic');
  assert.match(page.markup(), /<strong>Review 2/); assert.doesNotMatch(page.markup(), /<strong>Review 10/);
});

test('QA action search includes assignees and completion notes, not only action titles', async () => {
  const group = { id: 'g', title: 'Improve assessment', detail: '', reviewTitle: 'Autumn', facultyName: 'Science', creatorName: 'Owner', teamNames: ['Laboratory'], dueDate: '2026-11-02', status: 'closed', closeNote: 'Verified sampling', assignments: [{ actionId: 'a', staffName: 'Réne Jones', sourceOrgUnitName: 'Lab', assignmentRole: 'pl', status: 'complete' }] };
  const page = await panel('QaHub.tsx', 'QaActionGroupCards', { groups: [group], onClose: async () => {}, onReview: async () => {} });
  await page.change(field(page, 'Find an action'), 'rene sampling');
  assert.match(page.markup(), /Improve assessment/);
  await page.change(field(page, 'Find an action'), 'missing');
  assert.doesNotMatch(page.markup(), /<h3>Improve assessment/); assert.match(page.markup(), /No QA actions match/);
});

test('delivery filtering submits the complete query to the server and rejects an older response after a filter change', async () => {
  let releaseOld;
  const old = new Promise(resolve => { releaseOld = resolve; });
  const delivery = title => ({ id: title, templateName: title, recipients: 'person@example.test', triggeringEvent: 'manual', queuedAt: '2026-10-29', attemptCount: 1, status: 'sent' });
  const result = title => ({ items: [delivery(title)], totalCount: 61, totalPages: 3, page: 1, filterOptions: { status: ['sent', 'failed'], type: ['manual', 'retired.trigger'], person: ['historic@example.test'] } });
  const page = await panel('MessagingAdminPanel.tsx', 'MessagingAdminPanel', { view: 'history' }, { messageDeliveriesPage: query => query.search ? result('Current matching delivery') : old });
  await page.change(field(page, 'Find a delivery'), 'matching');
  assert.match(page.markup(), /Current matching delivery/); assert.match(page.markup(), /61 matching deliveries/);
  assert.equal(page.calls[0][4].aborted, true);
  releaseOld(result('Stale delivery')); await page.settle(); assert.doesNotMatch(page.markup(), /Stale delivery/);
  await page.change(field(page, 'Status'), 'failed');
  await page.change(page.nodes().find(node => node.props?.['aria-label'] === 'Sort by'), 'attempts-desc');
  const call = page.calls.at(-1); assert.equal(call[0], 'messageDeliveriesPage'); assert.equal(call[1].status, 'failed'); assert.equal(call[1].sortBy, 'attempts'); assert.equal(call[1].sortDirection, 'desc'); assert.equal(call[2], 1); assert.equal(call[3], 25);
  assert.match(text(field(page, 'Trigger').props.children), /retired.trigger/);
  assert.match(text(field(page, 'Recipient group').props.children), /historic@example.test/);
});

test('template page fetches only templates and approved parameters, with no delivery configuration or history', async () => {
  const page = await panel('MessagingAdminPanel.tsx', 'MessagingAdminPanel', { view: 'templates' }, { messageTemplates: [], messagingParameters: [] });
  assert.deepEqual(page.calls.map(call => call[0]).sort(), ['messageTemplates', 'messagingParameters']);
  assert.match(page.markup(), /Message templates &amp; rules/);
  assert.doesNotMatch(page.markup(), /Email delivery|Delivery history/);
  await page.click('Add message');
  assert.match(page.markup(), /Plain-text message/);
  assert.match(page.markup(), /Recipients/);
  assert.match(page.markup(), /Insert a personalised detail/);
});

test('delivery page fetches only its configuration, reports dirty changes, and supports cancellation', async () => {
  const changes = [];
  const page = await panel('MessagingAdminPanel.tsx', 'MessagingAdminPanel', { view: 'delivery', onDirtyChange: (...args) => changes.push(args) }, { messagingConfiguration: configuration });
  assert.deepEqual(page.calls.map(call => call[0]), ['messagingConfiguration']);
  assert.match(page.markup(), /Sender mailbox/);
  assert.doesNotMatch(page.markup(), /Message templates &amp; rules|Delivery history/);
  const senderLabel = page.nodes().find(node => node.type === 'label' && text(node.props.children).startsWith('Sender display name'));
  const senderInput = senderLabel.props.children.find(node => node.type === 'input');
  await page.change(senderInput, 'Updated sender');
  assert.deepEqual(changes.at(-1), [true, false]);
  await page.click('Cancel changes');
  assert.deepEqual(changes.at(-1), [false, false]);
  assert.equal(page.nodes().find(node => node.type === 'input' && node.props.value === 'QA')?.props.value, 'QA');
});

test('history page loads deliveries without loading templates, parameters or transport settings', async () => {
  const page = await panel('MessagingAdminPanel.tsx', 'MessagingAdminPanel', { view: 'history' }, { messageDeliveriesPage: { items: [{ id: 'delivery-1', templateName: 'QA reminder', recipients: 'staff@example.test', status: 'sent', queuedAt: '2026-10-29T12:00:00Z', attemptCount: 1 }], page: 1, totalPages: 1, totalCount: 1 } });
  assert.deepEqual(page.calls.map(call => call[0]), ['messageDeliveriesPage']);
  assert.match(page.markup(), /QA reminder/);
  assert.doesNotMatch(page.markup(), /Sender mailbox|Message templates &amp; rules/);
  await page.click('Refresh history');
  assert.deepEqual(page.calls.map(call => call[0]), ['messageDeliveriesPage', 'messageDeliveriesPage']);
});

test('legacy messaging view retains templates and delivery settings but loads history only on expansion', async () => {
  const page = await panel('MessagingAdminPanel.tsx', 'MessagingAdminPanel', {}, { messageTemplates: [], messagingParameters: [], messagingConfiguration: configuration });
  assert.deepEqual(page.calls.map(call => call[0]).sort(), ['messageTemplates', 'messagingConfiguration', 'messagingParameters']);
  assert.match(page.markup(), /Message templates &amp; rules/);
  assert.match(page.markup(), /Email delivery/);
  assert.match(page.markup(), /Delivery history/);
});

const selections = [{ dashboardKey: 'overview', excludedFacultyIds: ['f2'] }, { dashboardKey: 'qa_review', excludedFacultyIds: [] }, { dashboardKey: 'liv', excludedFacultyIds: ['f1'] }];
const units = [{ id: 'f1', code: 'FAC1', name: 'Faculty one', orgUnitType: 'faculty', includeInDashboards: true }, { id: 'f2', code: 'FAC2', name: 'Faculty two', orgUnitType: 'faculty', includeInDashboards: true }];
function datasetResponses(save = { ok: true }) { return { orgUnits: units, dashboardFacultySelections: selections, saveDashboardFacultySelections: save }; }

test('locked QA dataset cannot select other dashboards and saves only changed QA settings', async () => {
  const page = await panel('DashboardFacultyAdmin.tsx', 'DashboardFacultyAdmin', { dashboardKey: 'qa_review' }, datasetResponses());
  assert.equal(page.nodes().filter(node => node.type === 'select' && node.props.children?.some?.(child => child.props?.value === 'overview')).length, 0);
  assert.match(page.markup(), /QA Hub reporting faculties/);
  await page.click('Exclude all faculties');
  assert.equal(await page.saveGuard('QA Hub faculty selections'), true);
  assert.deepEqual(page.calls.find(call => call[0] === 'saveDashboardFacultySelections')[1], [{ dashboardKey: 'qa_review', excludedFacultyIds: ['f1', 'f2'] }]);
});

test('main dataset page excludes QA and preserves every untouched dataset when saving', async () => {
  const page = await panel('DashboardFacultyAdmin.tsx', 'DashboardFacultyAdmin', { excludeDashboardKeys: ['qa_review'] }, datasetResponses());
  assert.deepEqual(page.nodes().find(node => node.type === 'select' && node.props.value === 'overview').props.children.map(node => node.props.value), ['overview', 'liv']);
  await page.click('Include all faculties');
  assert.equal(await page.saveGuard('Dashboard faculty selections'), true);
  assert.deepEqual(page.calls.find(call => call[0] === 'saveDashboardFacultySelections')[1], [{ dashboardKey: 'overview', excludedFacultyIds: [] }]);
});

test('dataset selector defaults to a permitted loaded dataset when overview is excluded', async () => {
  const page = await panel('DashboardFacultyAdmin.tsx', 'DashboardFacultyAdmin', { excludeDashboardKeys: ['overview', 'qa_review'] }, datasetResponses());
  assert.equal(page.nodes().find(node => node.type === 'select').props.value, 'liv');
});

test('invalid locked dataset offers no editable faculties and no save path', async () => {
  const page = await panel('DashboardFacultyAdmin.tsx', 'DashboardFacultyAdmin', { dashboardKey: 'unknown' }, datasetResponses());
  assert.match(page.markup(), /No dashboard dataset is available/);
  assert.equal(page.nodes().filter(node => node.type === 'input' && node.props.type === 'checkbox').length, 0);
  assert.equal(page.nodes().find(node => node.type === page.Button).props.disabled, true);
});

test('failed dataset saves retain the selected draft and unsaved-change guard', async () => {
  const page = await panel('DashboardFacultyAdmin.tsx', 'DashboardFacultyAdmin', { dashboardKey: 'qa_review' }, datasetResponses({ ok: false, message: 'Configuration changed. Refresh and try again.' }));
  await page.click('Exclude all faculties');
  assert.equal(await page.saveGuard('QA Hub faculty selections'), false);
  assert.equal(page.guards.get('QA Hub faculty selections').dirty, true);
  assert.match(page.markup(), /Configuration changed/);
});

const user = { userAccountId: 'admin', permissions: ['users.manage', 'permissions.manage'], isAdministrator: true };
const permissionResponses = { adminRoles: [{ id: 'role-1', roleKey: 'staff', name: 'Staff', permissions: [], isSystem: true }], adminUsers: [], permissionCatalogue: [] };
for (const view of ['people', 'tiers']) test(`focused ${view} permission page locks the task and hides its nested navigation`, async () => {
  const page = await panel('PermissionsAdmin.tsx', 'PermissionAdminPanel', { user, view }, permissionResponses);
  assert.equal(page.nodes().some(node => node.props?.['aria-label'] === 'Permission administration views'), false);
  assert.match(page.markup(), /QA Hub administration/);
  if (view === 'people') { assert.match(page.markup(), /Staff permissions/); assert.doesNotMatch(page.markup(), /Create permission tier/); }
  else { assert.match(page.markup(), /Create permission tier/); assert.doesNotMatch(page.markup(), /aria-label="Find staff account"/); }
});

test('legacy permissions keeps its task switch and unavailable account APIs stay gated', async () => {
  const page = await panel('PermissionsAdmin.tsx', 'PermissionAdminPanel', { user: { ...user, permissions: ['permissions.manage'], isAdministrator: false } }, { adminRoles: [] });
  assert.deepEqual(page.calls.map(call => call[0]), ['adminRoles']);
  assert.equal(page.nodes().some(node => node.props?.['aria-label'] === 'Permission administration views'), true);
});

const qaManager = { ...user, permissions: ['qa_reviews.manage'] };
const qaLabels = { below: 'Below standard', at: 'Meets standard', above: 'Above standard', notApplicable: 'Not applicable' };
const qaLabelState = { labels: qaLabels, isAvailable: true, rowVersion: 'labels-version-1' };
const qaFormSettings = [
  { templateId: 'form-a', templateName: 'First evidence form', activityName: 'Learning activity', allowsNotSeen: false, rowVersion: 'form-a-version-1' },
  { templateId: 'form-b', templateName: 'Second evidence form', activityName: 'Learner activity', allowsNotSeen: false, rowVersion: 'form-b-version-1' }
];
function qaCheckboxes(page) { return page.nodes().filter(node => node.type === 'input' && node.props.type === 'checkbox'); }

test('QA label mode loads and saves only outcome wording with its concurrency version', async () => {
  const updatedLabels = { ...qaLabels, below: 'Requires improvement' };
  const page = await panel('QaRatingLabelsAdmin.tsx', 'QaRatingLabelsAdmin', { user: qaManager, mode: 'labels' }, {
    qaOutcomeLabels: qaLabelState,
    saveQaOutcomeLabels: { ok: true, data: { ...qaLabelState, labels: updatedLabels, rowVersion: 'labels-version-2' } }
  });
  assert.deepEqual(page.calls.map(call => call[0]), ['qaOutcomeLabels']);
  assert.equal(qaCheckboxes(page).length, 0);
  assert.match(page.markup(), /Save outcome labels/);
  assert.doesNotMatch(page.markup(), /Not seen on QA forms|Save availability/);
  await page.change(page.nodes().find(node => node.props?.id === 'qa-label-below'), updatedLabels.below);
  assert.equal(await page.saveGuard('QA outcome labels'), true);
  assert.deepEqual(page.calls, [['qaOutcomeLabels'], ['saveQaOutcomeLabels', updatedLabels, 'labels-version-1']]);
  assert.equal(page.guards.get('QA outcome labels').dirty, false);
  assert.match(page.markup(), /QA outcome labels saved/);
});

test('QA Not seen mode loads and saves only changed form availability without loading outcome wording', async () => {
  const page = await panel('QaRatingLabelsAdmin.tsx', 'QaRatingLabelsAdmin', { user: qaManager, mode: 'not-seen' }, {
    qaNotSeenSettings: qaFormSettings,
    saveQaNotSeenSetting: { ok: true, data: { ...qaFormSettings[0], allowsNotSeen: true, rowVersion: 'form-a-version-2' } }
  });
  assert.deepEqual(page.calls.map(call => call[0]), ['qaNotSeenSettings']);
  assert.equal(page.nodes().filter(node => node.props?.id?.startsWith('qa-label-')).length, 0);
  assert.match(page.markup(), /Not seen on QA forms/);
  assert.doesNotMatch(page.markup(), /Save outcome labels/);
  await page.change(page.nodes().find(node => node.props?.['aria-label'] === `${qaFormSettings[0].templateName}: Not seen`), true);
  assert.equal(await page.saveGuard('Not seen availability'), true);
  assert.deepEqual(page.calls, [['qaNotSeenSettings'], ['saveQaNotSeenSetting', 'form-a', true, 'form-a-version-1']]);
  assert.equal(page.guards.get('Not seen availability').dirty, false);
  assert.equal(page.nodes().find(node => node.props?.['aria-label'] === `${qaFormSettings[0].templateName}: Not seen`).props.checked, true);
  assert.equal(page.nodes().find(node => node.props?.['aria-label'] === `${qaFormSettings[1].templateName}: Not seen`).props.checked, false);
});

test('partial QA availability saves retain failed drafts and retry only remaining changes', async () => {
  let failSecondForm = true;
  const page = await panel('QaRatingLabelsAdmin.tsx', 'QaRatingLabelsAdmin', { user: qaManager, mode: 'not-seen' }, {
    qaNotSeenSettings: qaFormSettings,
    saveQaNotSeenSetting: (templateId, allowsNotSeen) => templateId === 'form-b' && failSecondForm
      ? { ok: false, message: 'Another administrator changed this form.' }
      : { ok: true, data: { ...qaFormSettings.find(form => form.templateId === templateId), allowsNotSeen, rowVersion: `${templateId}-version-2` } }
  });
  await page.change(qaCheckboxes(page)[0], true);
  await page.change(qaCheckboxes(page)[1], true);
  assert.equal(await page.saveGuard('Not seen availability'), false);
  assert.equal(page.guards.get('Not seen availability').dirty, true);
  assert.equal(page.guards.get('Not seen availability').saving, false);
  assert.deepEqual(qaCheckboxes(page).map(node => node.props.checked), [true, true]);
  assert.match(page.markup(), /Another administrator changed this form/);
  assert.match(page.markup(), /Any earlier changes were saved; remaining changes are still marked as unsaved/);
  failSecondForm = false;
  assert.equal(await page.saveGuard('Not seen availability'), true);
  assert.deepEqual(page.calls, [
    ['qaNotSeenSettings'],
    ['saveQaNotSeenSetting', 'form-a', true, 'form-a-version-1'],
    ['saveQaNotSeenSetting', 'form-b', true, 'form-b-version-1'],
    ['saveQaNotSeenSetting', 'form-b', true, 'form-b-version-1']
  ]);
  assert.equal(page.guards.get('Not seen availability').dirty, false);
  assert.match(page.markup(), /Not seen availability saved/);
});

for (const mode of ['labels', 'not-seen']) test(`QA ${mode} mode makes no API calls without QA management permission`, async () => {
  const page = await panel('QaRatingLabelsAdmin.tsx', 'QaRatingLabelsAdmin', { user: { ...user, permissions: ['forms.manage', 'lists.manage', 'records.manage'] }, mode });
  assert.deepEqual(page.calls, []);
  assert.match(page.markup(), /role="alert"/);
  assert.match(page.markup(), /You need permission to manage QA reviews/);
  assert.equal(page.nodes().filter(node => node.type === 'input' || node.type === 'form').length, 0);
});

test('audit history ignores a slower previous record and archive failures remain inside their active dialog', async () => {
  let releaseOld;
  const old = new Promise(resolve => { releaseOld = resolve; });
  const base = { moduleName: 'Teaching', moduleKey: 'learning_walk', recordType: 'learning_walk', createdAt: '2026-10-01', status: 'submitted' };
  const entry = summary => ({ id: summary, action: 'record.updated', actorName: 'Reviewer', createdAt: '2026-10-01', summary });
  const page = await panel('AdminRecordsPanel.tsx', 'AdminRecordsPanel', { onOpenRecord() {} }, {
    adminRecords: [{ ...base, recordId: 'a', title: 'Record A' }, { ...base, recordId: 'b', title: 'Record B' }],
    adminRecordAudit: id => id === 'a' ? old : [entry('Current record B history')],
    archiveAdminRecord: () => ({ ok: false, message: 'Record changed elsewhere; retry with the latest version.' })
  });
  page.nodes().find(node => node.props?.['aria-label'] === 'Audit history for Record A').props.onClick(); await page.settle();
  page.nodes().find(node => node.props?.['aria-label'] === 'Audit history for Record B').props.onClick(); await page.settle();
  assert.match(page.markup(), /Current record B history/);
  releaseOld([entry('Stale record A history')]); await page.settle();
  assert.doesNotMatch(page.markup(), /Stale record A history/);
  page.nodes().find(node => node.props?.['aria-label'] === 'Archive Record B').props.onClick(); await page.settle();
  await page.change(page.nodes().find(node => node.type === 'textarea'), 'Duplicate review');
  await page.click('Archive');
  const activeDialog = page.nodes().find(node => node.props?.label === 'Archive record');
  assert.match(text(activeDialog), /Record changed elsewhere/);
  assert.equal(page.nodes().find(node => node.type === 'textarea').props.value, 'Duplicate review');
  assert.match(page.markup(), /role="columnheader"/); assert.match(page.markup(), /role="cell"/);
});

test('leaving an opening Work Scrutiny record prevents its response replacing the next record', async () => {
  let releaseOld;
  const old = new Promise(resolve => { releaseOld = resolve; });
  const records = ['a', 'b'].map(id => ({ id, title: `Record ${id}`, recordDate: '2026-10-01', createdAt: '2026-10-01', submissionStatus: 'submitted', openActionCount: 0, completedActionCount: 0 }));
  const detail = (id, title) => ({ id, title, recordDate: '2026-10-01', sections: [], courseIds: [], submissionStatus: 'submitted' });
  const page = await panel('AdminWorkScrutiny.tsx', 'AdminWorkScrutiny', {}, {
    adminWorkScrutinyRecords: records, adminWorkScrutinyRecord: id => id === 'a' ? old : detail('b', 'Current record B'),
    workScrutinyRecordAudit: [], adminWorkScrutinyActions: []
  });
  const manage = id => page.nodes().find(node => node.type === 'tr' && node.key === id).props.children.at(-1).props.children;
  manage('a').props.onClick(); await page.settle();
  await page.click('Back to records');
  manage('b').props.onClick(); await page.settle();
  assert.match(page.markup(), /Current record B/);
  releaseOld(detail('a', 'Stale record A')); await page.settle();
  assert.doesNotMatch(page.markup(), /Stale record A/); assert.match(page.markup(), /Current record B/);
});

test('message history and previews stay with the current editor, and tests require saved wording', async () => {
  let releaseVersions, releasePreview;
  const oldVersions = new Promise(resolve => { releaseVersions = resolve; }), oldPreview = new Promise(resolve => { releasePreview = resolve; });
  const template = (id, name) => ({ id, name, messageKey: id, versionNumber: 1, eventType: 'manual', recipientConfigJson: '{}', conditionConfigJson: '{}', subjectTemplate: 'Original subject', plainTextTemplate: 'Original body', htmlTemplate: '', isActive: false, scheduleConfigJson: '{}', updatedAt: '2026-10-01', createdAt: '2026-10-01' });
  const page = await panel('MessagingAdminPanel.tsx', 'MessagingAdminPanel', { view: 'templates' }, {
    messageTemplates: [template('a', 'Template A'), template('b', 'Template B')], messagingParameters: [],
    messageTemplateVersions: id => id === 'a' ? oldVersions : [{ id: 'b-v2', versionNumber: 2, createdAt: '2026-10-01', subjectTemplate: 'Current B history' }],
    previewMessageTemplate: () => oldPreview
  });
  page.nodes().find(node => node.props?.['aria-label'] === 'Edit Template A').props.onClick(); await page.settle();
  page.nodes().find(node => node.props?.['aria-label'] === 'Edit Template B').props.onClick(); await page.settle();
  releaseVersions([{ id: 'a-v1', versionNumber: 1, createdAt: '2026-10-01', subjectTemplate: 'Stale A history' }]); await page.settle();
  assert.match(page.markup(), /Current B history/); assert.doesNotMatch(page.markup(), /Stale A history/);
  await page.click('Preview');
  await page.change(field(page, 'Subject'), 'New unsaved subject');
  releasePreview({ subject: 'Stale preview', plainTextBody: 'Previous content', recipients: [] }); await page.settle();
  assert.doesNotMatch(page.markup(), /Stale preview/);
  const queueTest = page.nodes().find(node => node.type === page.Button && text(node) === 'Queue test');
  assert.equal(queueTest.props.disabled, true); assert.match(page.markup(), /Save your changes before sending a test/);
  assert.equal(page.calls.some(call => call[0] === 'sendTestMessage'), false);
});

test('QA outcomes are one radio choice with keyboard wrapping and a single tab stop', async () => {
  const changes = [], focused = [];
  const page = await panel('QaHub.tsx', 'QaCriterion', { question: { reviewQuestionId: 'q', questionText: 'Clear explanations', isRequired: true, allowsNotApplicable: true, allowsNotSeen: true }, response: { reviewQuestionId: 'q', outcome: 'at', notApplicableReason: 'Old reason' }, disabled: false, onChange: value => changes.push(value) });
  const radios = () => page.nodes().filter(node => node.props?.role === 'radio');
  assert.equal(radios().length, 5); assert.equal(radios().filter(node => node.props.tabIndex === 0).length, 1);
  assert.equal(radios().find(node => node.props['aria-checked']).props.children, 'Meets');
  radios()[2].props.onKeyDown({ key: 'ArrowRight', preventDefault() {}, currentTarget: { parentElement: { querySelectorAll() { return radios().map((_, index) => ({ focus() { focused.push(index); } })); } } } });
  assert.deepEqual(changes.at(-1), { outcome: 'above', notApplicableReason: undefined }); assert.equal(focused.at(-1), 3);
  assert.match(page.markup(), /role="radiogroup"/); assert.match(page.markup(), /aria-required="true"/);
});

test('QA question-bank source failures provide a retry without masquerading as an empty catalogue', async () => {
  let attempts = 0;
  const page = await panel('QaQuestionBankAdmin.tsx', 'QaQuestionBankAdmin', {}, {
    qaActivityTypes: [{ id: 'activity', name: 'Lesson Visit', description: '' }],
    qaQuestions: () => { if (++attempts === 1) throw new Error('network'); return [{ id: 'q', activityTypeId: 'activity', activityName: 'Lesson Visit', questionText: 'Current criterion', sourceStatus: 'active', isActive: true, displayOrder: 1, questionTag: 'general', versionNumber: 1 }]; }
  });
  assert.match(page.markup(), /could not be loaded/); assert.doesNotMatch(page.markup(), /No questions match these filters/);
  await page.click('Try again');
  assert.equal(attempts, 2); assert.match(page.markup(), /Current criterion/); assert.doesNotMatch(page.markup(), /could not be loaded/);
});

test('QA question loading transitions to a retryable failure without leaving its illustration running', async () => {
  let reject;
  const pending = new Promise((_, no) => { reject = no; });
  const page = await panel('QaQuestionBankAdmin.tsx', 'QaQuestionBankAdmin', {}, { qaActivityTypes: [], qaQuestions: () => pending });
  assert.equal((page.markup().match(/class="loading-state /g) ?? []).length, 1);
  assert.match(page.markup(), /Loading QA questions/);
  reject(new Error('Unavailable')); await page.settle();
  assert.doesNotMatch(page.markup(), /class="loading-state /); assert.match(page.markup(), /could not be loaded/);
  assert.ok(page.nodes().find(node => node.type === page.Button && text(node) === 'Try again'));
});

test('copying a QA criterion creates a guarded editable draft after the highest configured order and preserves optional narratives', async () => {
  const questions = [
    { id: 'q1', activityTypeId: 'activity', activityName: 'Lesson Visit', questionText: 'Current criterion', guidance: 'Look for evidence', sourceStatus: 'active', isActive: true, displayOrder: 90, questionTag: 'general', versionNumber: 1, isRequired: true, allowsNotApplicable: true, commentRequiredAtExpected: true },
    { id: 'q2', activityTypeId: 'activity', activityName: 'Lesson Visit', questionText: 'Later criterion', sourceStatus: 'active', isActive: true, displayOrder: 130, questionTag: 'general', versionNumber: 1 }
  ];
  const page = await panel('QaQuestionBankAdmin.tsx', 'QaQuestionBankAdmin', {}, {
    qaActivityTypes: [{ id: 'activity', name: 'Lesson Visit', description: '' }], qaQuestions: questions,
    saveQaQuestion: () => ({ ok: true })
  });
  assert.doesNotMatch(page.markup(), /Comment required at expected/);
  assert.match(page.markup(), /Evidence notes optional/);
  await page.click('Copy question');
  assert.equal(page.guards.get('QA question wording').dirty, true);
  assert.equal(field(page, 'Display order').props.value, 140);
  assert.equal(field(page, 'Status').props.value, 'draft');
  assert.equal(field(page, 'Activity Required').props.disabled, false);
  assert.equal(page.calls.filter(call => call[0] === 'saveQaQuestion').length, 0, 'copying is a local draft until Save');
  assert.equal(await page.saveGuard('QA question wording'), true);
  const saved = page.calls.find(call => call[0] === 'saveQaQuestion');
  assert.equal(saved[1], undefined, 'copies create a new stable question rather than version the source');
  assert.equal(saved[2].sourceStatus, 'draft');
  assert.equal(saved[2].isActive, false);
  assert.equal(saved[2].commentRequiredAtExpected, true, 'legacy metadata is retained without claiming enforcement');
  assert.equal(saved[2].questionText, 'Current criterion');
  assert.match(page.markup(), /Draft question added/);
});

test('QA archive operations serialize all question mutations until the request finishes', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const page = await panel('QaQuestionBankAdmin.tsx', 'QaQuestionBankAdmin', {}, {
    qaActivityTypes: [{ id: 'activity', name: 'Lesson Visit', description: '' }],
    qaQuestions: ['q1', 'q2'].map(id => ({ id, activityTypeId: 'activity', activityName: 'Lesson Visit', questionText: id, sourceStatus: 'active', isActive: true, displayOrder: 1, questionTag: 'general', versionNumber: 1 })),
    saveQaQuestion: () => pending
  });
  const oldArchiveButtons = page.nodes().filter(node => node.type === page.Button && text(node) === 'Archive');
  await page.click('Archive');
  assert.equal(page.guards.get('QA question wording').saving, true);
  assert.ok(page.nodes().filter(node => node.type === page.Button && ['Add question', 'Edit', 'Copy question', 'Archive'].includes(text(node))).every(node => node.props.disabled));
  oldArchiveButtons[1].props.onClick(); await page.settle();
  assert.equal(page.calls.filter(call => call[0] === 'saveQaQuestion').length, 1, 'the synchronous guard also blocks stale button activations');
  release({ ok: false, message: 'Please retry.' }); await page.settle();
  assert.equal(page.guards.get('QA question wording').saving, false);
  assert.match(page.markup(), /Please retry/);
});

test('QA form access distinguishes eligible staff from retained historical members and bulk edits only matching choices', async () => {
  const forms = ['Form A', 'Form B'].map((name, index) => ({ templateId: `f${index}`, templateName: name, activityName: 'Lesson Visit', restrictQaStaff: true, staffIds: index ? [] : ['former'], rowVersion: `v${index}` }));
  const page = await panel('QaFormAccessAdmin.tsx', 'QaFormAccessAdmin', { user: { permissions: ['qa_reviews.manage'] } }, {
    qaFormAccessSettings: { forms, staff: [
      { staffId: 'active', displayName: 'Avery', email: 'avery@example.test', isEligibleQaStaff: true },
      { staffId: 'former', displayName: 'Former QA colleague', email: 'former@example.test', isEligibleQaStaff: false },
      { staffId: 'other-form', displayName: 'Other historical member', email: 'other@example.test', isEligibleQaStaff: false }
    ] },
    saveQaFormAccessSetting: (id, request) => ({ ok: true, data: { ...forms.find(form => form.templateId === id), ...request, rowVersion: 'saved' } })
  });
  const personInput = name => page.nodes().find(node => node.type === 'label' && text(node).includes(name))?.props.children?.find?.(child => child?.type === 'input');
  assert.equal(personInput('Former QA colleague').props.disabled, false, 'saved former members can be retained or removed');
  assert.equal(personInput('Other historical member').props.disabled, true, 'former members of another template cannot be added');
  assert.match(page.markup(), /Some saved selections are no longer active QA Staff/);
  await page.click('Select 1 matching staff');
  assert.equal(page.guards.get('QA form access').dirty, true);
  assert.equal(page.calls.filter(call => call[0] === 'saveQaFormAccessSetting').length, 0);
  await page.change(page.nodes().find(node => node.props?.placeholder === 'Search by name or email'), 'Avery');
  await page.click('Remove 1 matching selections');
  await page.change(page.nodes().find(node => node.props?.placeholder === 'Search by name or email'), '');
  assert.equal(personInput('Former QA colleague').props.checked, true, 'matching removal preserves selections outside the search');
  const formB = page.nodes().find(node => node.type === 'button' && text(node).startsWith('Form B'));
  formB.props.onClick(); await page.settle();
  assert.equal(personInput('Former QA colleague').props.disabled, true, 'eligibility is scoped to this template’s saved members');
  personInput('Former QA colleague').props.onChange({ target: { checked: true } }); await page.settle();
  assert.equal(personInput('Former QA colleague').props.checked, false, 'the event handler also rejects an ineligible new selection');
  await page.click('Select 1 matching staff');
  assert.equal(await page.saveGuard('QA form access'), true);
  const write = page.calls.find(call => call[0] === 'saveQaFormAccessSetting');
  assert.equal(write[1], 'f1'); assert.deepEqual(write[2].staffIds, ['active']);
});

test('custom tier wording is locked during a save and a rejected save retains the editable draft', async () => {
  let release;
  const page = await panel('PermissionsAdmin.tsx', 'PermissionAdminPanel', { user, view: 'tiers' }, {
    ...permissionResponses, permissionCatalogue: [{ permissionKey: 'forms.manage', name: 'Manage forms', category: 'Forms' }],
    saveCustomRole: () => new Promise(resolve => { release = resolve; })
  });
  await page.click('Create permission tier');
  await page.change(field(page, 'Tier name'), 'QA template editors');
  const group = page.nodes().find(node => typeof node.type === 'function' && node.props?.onToggle);
  group.props.onToggle('forms.manage'); await page.settle();
  const saving = page.saveGuard('Staff access and permission tiers'); await page.settle();
  assert.equal(field(page, 'Tier name').props.disabled, true);
  assert.equal(page.nodes().find(node => node.type === 'textarea' && node.props.maxLength === 1000).props.disabled, true);
  release({ ok: false, message: 'Concurrent change; reload before saving.' }); assert.equal(await saving, false);
  assert.equal(field(page, 'Tier name').props.disabled, false);
  assert.equal(field(page, 'Tier name').props.value, 'QA template editors');
  assert.equal(page.guards.get('Staff access and permission tiers').dirty, true);
});

test('QA form access rejects duplicate stale saves and late selection events while retaining a rejected draft', async () => {
  let release;
  const page = await panel('QaFormAccessAdmin.tsx', 'QaFormAccessAdmin', { user: { permissions: ['qa_reviews.manage'] } }, {
    qaFormAccessSettings: { forms: [{ templateId: 'form', templateName: 'Form', activityName: 'Lesson Visit', restrictQaStaff: true, staffIds: [], rowVersion: 'v1' }], staff: [{ staffId: 'active', displayName: 'Avery', email: 'avery@example.test', isEligibleQaStaff: true }] },
    saveQaFormAccessSetting: () => new Promise(resolve => { release = resolve; })
  });
  const personInput = () => page.nodes().find(node => node.type === 'input' && node.props.type === 'checkbox');
  await page.change(personInput(), true);
  const staleSave = page.guards.get('QA form access').onSave;
  const staleInput = personInput();
  const saving = page.saveGuard('QA form access'); await page.settle();
  assert.equal(await staleSave(), false);
  staleInput.props.onChange({ target: { checked: false } }); await page.settle();
  assert.equal(personInput().props.checked, true);
  assert.equal(page.calls.filter(call => call[0] === 'saveQaFormAccessSetting').length, 1);
  release({ ok: false, message: 'Conflict; reload before saving.' });
  assert.equal(await saving, false);
  assert.equal(personInput().props.checked, true);
  assert.equal(page.guards.get('QA form access').dirty, true);
  assert.equal(page.guards.get('QA form access').saving, false);
});

test('changing QA reporting scope hides prior totals before effects and ignores a superseded faculty response', async () => {
  let resolveOld;
  const pending = new Promise(yes => { resolveOld = yes; });
  const review = { review: { id: 'review', title: 'Review', academicYear: '2026/27', theme: 'Practice', closingDate: '2026-11-30', status: 'open', capabilities: {} }, evidence: [], activities: [], scope: [
    { scopeType: 'team', orgUnitId: 'team-a', name: 'Team A', parentOrgUnitId: 'faculty-a', parentName: 'Faculty A' },
    { scopeType: 'team', orgUnitId: 'team-b', name: 'Team B', parentOrgUnitId: 'faculty-b', parentName: 'Faculty B' }
  ] };
  const page = await panel('QaHub.tsx', 'QaReviewWorkspace', { id: 'review', section: 'dashboard', user: {}, orgUnits: [], staff: [], academicYears: [], activities: [], onNavigate() {}, onRefreshSummary: async () => {} }, {
    qaReview: review, qaDashboard: (_id, faculty) => faculty === 'faculty-a' ? pending : { evidenceCount: faculty === 'faculty-b' ? 222 : 111 }
  });
  const dashboard = () => page.nodes().find(node => node.props?.dashboard)?.props.dashboard;
  const faculty = () => page.nodes().find(node => node.type === 'select' && node.props.children?.some?.(item => item?.props?.children === 'All faculties'));
  assert.equal(dashboard().evidenceCount, 111);
  page.changeBeforeEffects(faculty(), 'faculty-a');
  assert.equal(dashboard(), undefined, 'a new filter cannot display the previous cohort for even one render');
  await page.settle();
  page.changeBeforeEffects(faculty(), 'faculty-b');
  resolveOld({ evidenceCount: 999 });
  await Promise.resolve(); await Promise.resolve();
  await page.settle();
  assert.equal(dashboard().evidenceCount, 222);
  assert.equal(page.calls.filter(call => call[0] === 'qaDashboard').length, 3);
});

test('QA action drafts are guarded and a rejected creation keeps their content available for retry', async () => {
  let attempts = 0, created = 0;
  const options = { reviewId: 'review', reviewTitle: 'Review', creationMode: 'hof', faculties: [{ facultyOrgUnitId: 'faculty', facultyName: 'Science', headOfFaculty: { staffId: 'owner', displayName: 'Owner' }, teams: [{ teamOrgUnitId: 'team', teamName: 'Team' }] }] };
  const page = await panel('QaHub.tsx', 'QaActionCreator', { reviewId: 'review', options, onCreated: async () => { created++; } }, { createQaReviewAction: () => { if (++attempts === 1) throw new Error('network'); return { ok: true }; } });
  assert.equal(page.guards.get('QA action').dirty, false);
  await page.change(page.nodes().find(node => node.type === 'input' && node.props.maxLength === 300), 'Improve feedback');
  await page.change(page.nodes().find(node => node.type === 'input' && node.props.type === 'date'), '2026-11-30');
  assert.equal(page.guards.get('QA action').dirty, true);
  assert.equal(await page.saveGuard('QA action'), false);
  assert.match(page.markup(), /Your changes are still here/); assert.match(page.markup(), /Improve feedback/);
  assert.equal(page.guards.get('QA action').saving, false);
  assert.equal(await page.saveGuard('QA action'), true);
  assert.equal(created, 1); assert.equal(attempts, 2); assert.equal(page.guards.get('QA action').dirty, false);
});

function qaEvidenceFixture(status = 'draft', canEdit = true) {
  return { evidence: { id: 'evidence', reviewId: 'review', reviewActivityId: 'activity', teamOrgUnitId: 'team', activityAt: '2026-10-01T09:00:00Z', activityName: 'Learning Walk', teamName: 'Team', reviewerName: 'Reviewer', status, versionNumber: 1, rowVersion: 'v1', canEdit, canRemove: false, deliveryAreaKey: 'classroom' }, teamOrgUnitIds: ['team'], teamNames: ['Team'], responses: [{ reviewQuestionId: 'question', questionText: 'Clear explanations', isRequired: true, outcome: 'at' }], revisions: [] };
}
function qaSaved(detail, request, submit, rowVersion) {
  return { ...structuredClone(detail), evidence: { ...detail.evidence, status: submit ? 'submitted' : detail.evidence.status, rowVersion }, responses: detail.responses.map((question, index) => ({ ...question, ...request.responses[index] })) };
}
async function qaEvidencePanel(detail, saveQaEvidence = () => ({ ok: false, message: 'Save rejected' })) {
  const timers = new Map(), previousSet = window.setTimeout, previousClear = window.clearTimeout, paths = [];
  let nextTimer = 0, submitted = 0;
  window.setTimeout = callback => { const id = ++nextTimer; timers.set(id, callback); return id; };
  window.clearTimeout = id => timers.delete(id);
  const page = await panel('QaHub.tsx', 'QaEvidenceEditor', { evidenceId: 'evidence', reviews: [], onNavigate: path => paths.push(path), onSubmitted: async () => { submitted++; } }, { qaEvidence: detail, learningWalkDeliveryAreas: [{ key: 'classroom', name: 'Classroom', isActive: true }], saveQaEvidence });
  return { page, timers, paths, submitted: () => submitted,
    async edit(patch) { page.nodes().find(node => node.props?.question?.reviewQuestionId === 'question').props.onChange(patch); await page.settle(); },
    async autosave() { const [id, callback] = [...timers][0]; timers.delete(id); callback(); await page.settle(); },
    finish() { page.unmount(); window.setTimeout = previousSet; window.clearTimeout = previousClear; }
  };
}

test('QA evidence exit pauses autosave and discards only unsaved edits while keeping the acknowledged draft', async () => {
  const detail = qaEvidenceFixture();
  const view = await qaEvidencePanel(detail, (_review, _id, request, submit) => ({ ok: true, data: qaSaved(detail, request, submit, 'v2') }));
  try {
    await view.edit({ outcome: 'above', comment: 'Already autosaved' }); await view.autosave();
    await view.edit({ comment: 'Do not save this edit' }); assert.equal(view.timers.size, 1);
    await view.page.navigationPending(true); assert.equal(view.timers.size, 0);
    const guard = view.page.guards.get('QA evidence');
    assert.equal(guard.submission, true); assert.equal(guard.discardLabel, 'Discard unsaved changes');
    assert.match(guard.discardMessage, /retained as a draft/); assert.match(guard.discardMessage, /does not remove/);
    guard.onDiscard(); await view.page.settle();
    assert.equal(view.page.guards.get('QA evidence').dirty, false);
    const criterion = view.page.nodes().find(node => node.props?.question?.reviewQuestionId === 'question');
    assert.equal(criterion.props.response.comment, 'Already autosaved'); assert.equal(view.timers.size, 0);
    assert.equal(view.page.calls.filter(call => call[0] === 'saveQaEvidence').length, 1);
    assert.deepEqual(view.paths, []);
  } finally { view.finish(); }
});

test('QA exit submit flushes the real save queue and preserves the originally requested navigation destination', async () => {
  const detail = qaEvidenceFixture(), writes = [];
  const view = await qaEvidencePanel(detail, (_review, _id, request, submit) => new Promise(resolve => writes.push({ request: structuredClone(request), submit, resolve })));
  try {
    await view.edit({ outcome: 'above' }); await view.autosave();
    await view.edit({ comment: 'Newest queued answer' }); await view.page.navigationPending(true);
    const submitted = view.page.guards.get('QA evidence').onSubmit(); await view.page.settle();
    assert.equal(writes.length, 1);
    writes[0].resolve({ ok: true, data: qaSaved(detail, writes[0].request, false, 'v2') }); await view.page.settle();
    assert.equal(writes.length, 2); assert.equal(writes[1].submit, true);
    assert.equal(writes[1].request.rowVersion, 'v2'); assert.equal(writes[1].request.responses[0].comment, 'Newest queued answer');
    writes[1].resolve({ ok: true, data: qaSaved(detail, writes[1].request, true, 'v3') });
    assert.equal(await submitted, true); await view.page.settle();
    assert.equal(view.submitted(), 1); assert.deepEqual(view.paths, [], 'the shared guard owns the pending Home/back/logout destination');
    assert.equal(view.page.guards.get('QA evidence').onSubmit, undefined);
  } finally { view.finish(); }
});

test('QA exit submit retains rejected edits and is never offered for read-only or already submitted evidence', async () => {
  const view = await qaEvidencePanel(qaEvidenceFixture());
  try {
    await view.edit({ outcome: 'above' }); await view.page.navigationPending(true);
    assert.equal(await view.page.guards.get('QA evidence').onSubmit(), false); await view.page.settle();
    assert.equal(view.page.guards.get('QA evidence').dirty, true); assert.match(view.page.markup(), /Save rejected/);
    assert.deepEqual(view.paths, []); assert.equal(view.submitted(), 0);
  } finally { view.finish(); }
  for (const detail of [qaEvidenceFixture('draft', false), qaEvidenceFixture('submitted', true)]) {
    const readonly = await qaEvidencePanel(detail);
    try { assert.equal(readonly.page.guards.get('QA evidence').onSubmit, undefined); assert.equal(readonly.page.guards.get('QA evidence').submission, false); }
    finally { readonly.finish(); }
  }
});

test('QA review setup guard saves through its real endpoint without publishing or redirecting the pending exit', async () => {
  const existing = { review: { id: 'review', title: 'Review', theme: 'Theme', academicYear: '2026/27', status: 'draft', closingDate: '2026-11-30', rowVersion: 'v1' }, ownerStaffId: 'owner', questionTag: 'general', scope: [{ scopeType: 'team', orgUnitId: 'team' }], activities: [{ activityTypeId: 'activity', templateId: 'template', questions: [{ id: 'question' }] }] };
  let attempts = 0; const saved = [];
  const props = { existing, user: { staffId: 'owner' }, orgUnits: [{ id: 'faculty', name: 'Faculty', orgUnitType: 'faculty', isActive: true }, { id: 'team', parentOrgUnitId: 'faculty', name: 'Team', orgUnitType: 'team', isActive: true }], staff: [{ id: 'owner', displayName: 'Owner' }], academicYears: [{ academicYear: '2026/27', isCurrent: true }], activities: [{ id: 'activity', name: 'Learning Walk', templates: [{ id: 'template', name: 'Form', isActive: true }] }], onCancel() {}, onSaved: (...args) => saved.push(args) };
  const page = await panel('QaHub.tsx', 'QaReviewEditor', props, { qaQuestions: [{ id: 'question', activityTypeId: 'activity', questionTag: 'general', questionText: 'Question', isActive: true, sourceStatus: 'active', displayOrder: 1 }], updateQaReview: () => { if (++attempts === 1) throw Error('offline'); return { ok: true }; } });
  await page.change(page.nodes().find(node => node.type === 'input' && node.props.placeholder === 'For example, Autumn curriculum quality review'), 'Updated review');
  assert.equal(page.guards.get('QA review').onSubmit, undefined);
  assert.equal(await page.saveGuard('QA review'), false); assert.equal(page.guards.get('QA review').dirty, true);
  assert.match(page.markup(), /Your setup is still here/);
  assert.equal(await page.saveGuard('QA review'), true); assert.deepEqual(saved, [['review', false]]);
  assert.equal(page.guards.get('QA review').dirty, false);
  assert.equal(page.calls.filter(call => call[0] === 'updateQaReview').length, 2);
  assert.equal(page.calls.some(call => /publish/i.test(call[0])), false);
  page.unmount();
});

test('workflow wording searches and previews a complete local draft, restores locally and uses the freshly saved version', async () => {
  let savedForms = workflowDefaults.slice(0, 2).map(form => ({ ...structuredClone(form), rowVersion: 'version-1' }));
  const page = await panel('AdminWorkflowContent.tsx', 'AdminWorkflowContent', {}, {
    adminFormContent: () => savedForms,
    saveFormContent: (key, fields) => { savedForms = savedForms.map(form => form.formKey === key ? { ...form, fields, rowVersion: 'version-2' } : form); return { ok: true }; }
  });
  const label = key => page.nodes().find(node => node.type === 'input' && node.props.id?.endsWith(`-${key}-label`));
  await page.change(label('contextText'), 'Our local context');
  await page.change(page.nodes().find(node => node.props?.['aria-label'] === 'Find a prompt'), 'intended outcomes');
  assert.equal(page.guards.get('Review and action form wording').dirty, true);
  assert.equal(label('contextText'), undefined, 'search hides cards without dropping their edits');
  await page.click('Preview wording');
  assert.match(page.markup(), /wording preview/);
  assert.equal(page.calls.filter(call => call[0] === 'saveFormContent').length, 0);
  assert.equal(await page.saveGuard('Review and action form wording'), true);
  let write = page.calls.find(call => call[0] === 'saveFormContent');
  assert.equal(write[3], 'version-1');
  assert.equal(write[2].length, workflowDefaults[0].fields.length, 'filtered-out prompts remain in the complete save');
  assert.equal(write[2].find(field => field.key === 'contextText').label, 'Our local context');
  assert.deepEqual(page.calls.find(call => call[0] === 'invalidateFormContent'), ['invalidateFormContent', 'liv']);
  assert.equal(page.guards.get('Review and action form wording').dirty, false);
  await page.change(page.nodes().find(node => node.props?.['aria-label'] === 'Find a prompt'), '');
  await page.click('Edit wording');
  await page.click('Restore all defaults');
  assert.equal(label('contextText').props.value, 'Context');
  assert.equal(page.calls.filter(call => call[0] === 'saveFormContent').length, 1, 'restore only changes the local draft');
  assert.equal(await page.saveGuard('Review and action form wording'), true);
  write = page.calls.filter(call => call[0] === 'saveFormContent').at(-1);
  assert.equal(write[3], 'version-2', 'a second save uses the refreshed row version');
});

test('workflow wording serializes saves and preserves edits when a version conflict rejects the save', async () => {
  let release;
  const page = await panel('AdminWorkflowContent.tsx', 'AdminWorkflowContent', {}, {
    adminFormContent: [{ ...structuredClone(workflowDefaults[0]), rowVersion: 'old' }],
    saveFormContent: () => new Promise(resolve => { release = resolve; })
  });
  const label = () => page.nodes().find(node => node.type === 'input' && node.props.id?.endsWith('-contextText-label'));
  await page.change(label(), 'Keep this wording');
  const staleSave = page.guards.get('Review and action form wording').onSave;
  const saving = page.saveGuard('Review and action form wording'); await page.settle();
  assert.equal(page.nodes().find(node => node.type === 'fieldset').props.disabled, true);
  assert.equal(field(page, 'Workflow form').props.disabled, true);
  assert.equal(await staleSave(), false);
  assert.equal(page.calls.filter(call => call[0] === 'saveFormContent').length, 1);
  label().props.onChange({ target: { value: 'Late typing' } }); await page.settle();
  release({ ok: false, message: 'Someone changed this form. Reload before saving.' });
  assert.equal(await saving, false);
  assert.equal(label().props.value, 'Keep this wording');
  assert.equal(page.guards.get('Review and action form wording').dirty, true);
  assert.match(page.markup(), /Someone changed this form/);
  assert.equal(page.nodes().find(node => node.type === 'fieldset').props.disabled, false);
});

test('workflow wording validates hidden prompts and retains a failed load without enabling unsafe editing', async () => {
  let failLoad = true;
  const page = await panel('AdminWorkflowContent.tsx', 'AdminWorkflowContent', {}, {
    adminFormContent: () => { if (failLoad) throw new Error('offline'); return [structuredClone(workflowDefaults[0])]; }
  });
  assert.match(page.markup(), /could not be loaded/);
  assert.equal(page.nodes().filter(node => node.type === 'input').length, 0);
  failLoad = false; await page.click('Try again');
  await page.change(page.nodes().find(node => node.props.id?.endsWith('-contextText-label')), '   ');
  await page.change(page.nodes().find(node => node.props?.['aria-label'] === 'Find a prompt'), 'intended outcomes');
  assert.equal(await page.saveGuard('Review and action form wording'), false);
  assert.equal(page.nodes().find(node => node.props?.['aria-label'] === 'Find a prompt').props.value, '');
  assert.equal(page.nodes().find(node => node.props.id?.endsWith('-contextText-label')).props['aria-invalid'], true);
  assert.equal(page.calls.filter(call => call[0] === 'saveFormContent').length, 0);
});

test('saved workflow wording requires a verified new version before further edits after readback failure', async () => {
  let loads = 0;
  const initial = { ...structuredClone(workflowDefaults[0]), rowVersion: 'old' };
  let saved = initial;
  const page = await panel('AdminWorkflowContent.tsx', 'AdminWorkflowContent', {}, {
    adminFormContent: () => { if (++loads === 2) throw new Error('readback unavailable'); return [saved]; },
    saveFormContent: (_key, fields) => { saved = { ...initial, fields, rowVersion: 'fresh' }; return { ok: true }; }
  });
  const label = () => page.nodes().find(node => node.props.id?.endsWith('-contextText-label'));
  await page.change(label(), 'Saved successfully');
  assert.equal(await page.saveGuard('Review and action form wording'), true);
  assert.match(page.markup(), /was saved, but its latest version could not be checked/);
  assert.equal(page.guards.get('Review and action form wording').dirty, false);
  assert.equal(page.nodes().find(node => node.type === 'fieldset').props.disabled, true);
  label().props.onChange({ target: { value: 'Unsafe stale edit' } }); await page.settle();
  assert.equal(label().props.value, 'Saved successfully');
  assert.equal(await page.saveGuard('Review and action form wording'), false);
  await page.click('Reload wording');
  assert.equal(page.nodes().find(node => node.type === 'fieldset').props.disabled, false);
  assert.equal(label().props.value, 'Saved successfully');
});

test('ELI administration explicitly loads all retained years and filters the complete returned history', async () => {
  const common = { staffId: 's1', staffName: 'Avery', externalId: '100', email: 'avery@example.test', facultyCode: 'ART', facultyName: 'Arts', teamCode: 'ART1', status: 'submitted', submittedAt: '2026-10-01' };
  const page = await panel('AdminElevatePractice.tsx', 'AdminElevatePractice', {}, { elevatePracticeProgress: [
    { ...common, assessmentId: 'new', academicYear: '2026/27' },
    { ...common, assessmentId: 'old', academicYear: '2024/25', status: 'draft' }
  ] });
  assert.deepEqual(page.calls, [['elevatePracticeProgress', 'all']]);
  assert.match(text(field(page, 'Academic year').props.children), /2024\/25/);
  assert.match(page.markup(), /Staff\/year entries/);
  await page.change(field(page, 'Academic year'), '2024/25');
  assert.match(page.markup(), /2024\/25<\/td>/); assert.doesNotMatch(page.markup(), /2026\/27<\/td>/);
  assert.match(page.markup(), /including records for former staff/);
});

const wsTemplate = (overrides = {}) => ({ id: 'ws', moduleId: 'module', moduleKey: 'work_scrutiny', moduleName: 'Work Scrutiny', templateKey: 'ws_core', name: 'Work Scrutiny', version: '0.1', status: 'Draft', isEditable: true, assignedOrgUnits: [{ id: 'team', code: 'TEAM', name: 'Team' }], submissionCount: 0, ...overrides });
const wsAdministration = (overrides = {}) => ({ templateId: 'ws', templateKey: 'ws_core', moduleKey: 'work_scrutiny', name: 'Work Scrutiny', description: 'Guidance from the version editor', versionId: 'draft', version: '0.1', rowVersion: 'observed-draft-token', status: 'Draft', submissionCount: 0, versions: [{ id: 'draft', version: '0.1', status: 'Draft', submissionCount: 0 }], sections: [{ id: 'criteria', sectionKey: 'criteria', title: 'Criteria', displayOrder: 1, fields: [{ id: 'reflection', fieldKey: 'custom_reflection', label: 'Reflection', fieldType: 'long_text', isRequired: false, displayOrder: 10, options: [] }] }], ...overrides });
const wsStudioResponses = (extra = {}) => ({ formTemplates: [wsTemplate()], orgUnits: [{ id: 'team', code: 'TEAM', name: 'Team', orgUnitType: 'team', isActive: true }], lookups: [], formTemplateAdministration: wsAdministration(), ...extra });
const withSavedSectionIds = sections => sections.map((section, index) => ({ ...section, id: `saved-section-${index}`, fields: section.fields.map((field, fieldIndex) => ({ ...field, id: `saved-field-${index}-${fieldIndex}` })) }));
const wsTargetCoreSections = () => [{ id: 'target-context', sectionKey: 'workflow_context', title: 'Sample context', displayOrder: 0, fields: [
  { id: 'target-level', fieldKey: 'qualification_level', label: 'Course level', fieldType: 'single_select', isRequired: true, isProtected: true, displayOrder: 10, options: ['Level 1', 'Level 2'] },
  { id: 'target-delivery', fieldKey: 'learning_walk_delivery_area', label: 'Delivery area', fieldType: 'learning_walk_delivery_area', isRequired: true, isProtected: true, displayOrder: 20, options: [] }
] }];

test('legacy Work Scrutiny saves the observed draft token and existing description, retaining a stale rejected edit', async () => {
  const page = await panel('FormBuilder.tsx', 'FormBuilder', { user: { permissions: ['forms.manage'] }, moduleKey: 'work_scrutiny' }, wsStudioResponses({ updateFormTemplateStructure: { ok: false, message: 'A newer draft was saved. Reload before saving.' } }));
  assert.deepEqual(page.calls.find(call => call[0] === 'formTemplateAdministration'), ['formTemplateAdministration', 'ws']);
  assert.equal(page.calls.some(call => call[0] === 'formDefinition'), false);
  await page.change(field(page, 'Question 1'), 'Keep this local question');
  const link = page.nodes().find(node => node.type === 'a');
  assert.equal(link.props['aria-disabled'], true); assert.equal(link.props.href, undefined);
  assert.equal(await page.saveGuard('Form layout and wording'), false);
  const write = page.calls.find(call => call[0] === 'updateFormTemplateStructure');
  assert.equal(write[1], 'ws'); assert.equal(write[2].rowVersion, 'observed-draft-token');
  assert.equal(write[2].description, 'Guidance from the version editor');
  assert.equal(write[2].sections[0].fields[0].label, 'Keep this local question');
  assert.equal(field(page, 'Question 1').props.value, 'Keep this local question');
  assert.equal(page.guards.get('Form layout and wording').dirty, true);
  assert.match(page.markup(), /A newer draft was saved/);
  assert.doesNotMatch(page.markup(), /Save and publish/);
});

test('legacy Work Scrutiny loads genuine empty drafts through administration and never treats a failed read as an empty draft', async () => {
  let failing = true;
  const page = await panel('FormBuilder.tsx', 'FormBuilder', { user: { permissions: ['forms.manage'] }, moduleKey: 'work_scrutiny' }, wsStudioResponses({ formTemplateAdministration: () => { if (failing) throw new Error('404 Not found'); return wsAdministration({ sections: [] }); } }));
  assert.match(page.markup(), /This form could not be loaded/);
  assert.equal(page.nodes().some(node => node.type === page.Button && text(node) === 'Save draft'), false);
  assert.equal(page.calls.some(call => call[0] === 'formDefinition'), false);
  failing = false; await page.click('Retry');
  assert.match(page.markup(), /0 sections/); assert.match(page.markup(), /Add a section, then add the questions/);
  assert.equal(page.nodes().some(node => node.type === page.Button && text(node) === 'Add section'), true);
  assert.equal(page.guards.get('Form layout and wording').dirty, false);
});

test('copying a published Work Scrutiny source resolves its published questions and uses the new target token', async () => {
  let created = false, copied;
  const source = wsTemplate({ status: 'Published', version: '1.0', submissionCount: 4 });
  const page = await panel('FormBuilder.tsx', 'FormBuilder', { user: { permissions: ['forms.manage'] }, moduleKey: 'work_scrutiny' }, wsStudioResponses({
    formTemplates: () => created ? [source, wsTemplate({ id: 'created', name: 'New copy' })] : [source],
    formTemplateAdministration: (id, versionId) => {
      if (id === 'created') return wsAdministration({ templateId: 'created', name: 'New copy', rowVersion: copied ? 'target-after-save' : 'new-target-token', sections: copied ? withSavedSectionIds(copied.sections) : wsTargetCoreSections() });
      if (!versionId) return wsAdministration({ name: 'Pending unpublished changes', rowVersion: 'source-draft-token', versions: [{ id: 'draft', status: 'Draft' }, { id: 'published', status: 'Published' }] });
      assert.equal(versionId, 'published');
      return wsAdministration({ name: 'Published source', status: 'Published', rowVersion: 'published-source-token', sections: [
        { id: 'core', sectionKey: 'context', title: 'Context', displayOrder: 1, fields: [{ id: 'date', fieldKey: 'scrutiny_date', label: 'Date', fieldType: 'date', isRequired: true, displayOrder: 1 }] },
        { ...wsAdministration().sections[0], fields: [{ ...wsAdministration().sections[0].fields[0], label: 'Published criterion' }] }
      ] });
    },
    createFormTemplate: request => { created = true; assert.equal(request.orgUnitId, 'team'); return { ok: true, data: { id: 'created' } }; },
    updateFormTemplateStructure: (id, request) => { assert.equal(id, 'created'); copied = request; return { ok: true }; }
  }));
  assert.equal(field(page, 'Form name').props.value, 'Published source');
  await page.change(field(page, 'New draft name'), 'New copy');
  await page.change(field(page, 'Allocated sub-team'), 'team');
  await page.click('Copy selected form');
  assert.equal(copied.rowVersion, 'new-target-token', 'the source token must never be used to overwrite the created draft');
  assert.equal(copied.name, 'New copy'); assert.equal(copied.description, 'Guidance from the version editor');
  assert.equal(copied.sections.length, 2, 'the target retains required workflow questions alongside the copied criterion');
  assert.equal(copied.sections[0].sectionKey, 'workflow_context');
  assert.deepEqual(copied.sections[0].fields.map(field => [field.fieldKey, field.fieldType, field.isRequired, field.options]), [
    ['qualification_level', 'single_select', true, ['Level 1', 'Level 2']], ['learning_walk_delivery_area', 'learning_walk_delivery_area', true, []]
  ]);
  assert.equal(copied.sections[1].fields[0].label, 'Published criterion');
  assert.match(page.markup(), /copied to a new draft/);
  assert.equal(page.calls.some(call => call[0] === 'publishFormTemplate'), false);
});

test('legacy copying merges custom content into target core sections without duplicating source core aliases', async () => {
  let created = false, copied;
  const source = wsAdministration({ sections: [
    { id: 'source-context', sectionKey: 'workflow_context', title: 'Different source context', displayOrder: 1, fields: [
      { id: 'old-level', fieldKey: 'course_level', label: 'Old level wording', fieldType: 'single_select', isRequired: true, isProtected: true, displayOrder: 10, options: ['Old choice A', 'Old choice B'] },
      { id: 'custom-context', fieldKey: 'custom_sample_notes', label: 'Sample notes', fieldType: 'long_text', isRequired: false, isProtected: false, displayOrder: 20 }
    ] },
    { id: 'source-delivery-section', sectionKey: 'old_delivery', title: 'Old delivery section', displayOrder: 2, fields: [
      { id: 'old-delivery', fieldKey: 'learning_walk_delivery_area', label: 'Old delivery wording', fieldType: 'learning_walk_delivery_area', isRequired: true, isProtected: true, displayOrder: 10 }
    ] },
    wsAdministration().sections[0]
  ] });
  const page = await panel('FormBuilder.tsx', 'FormBuilder', { user: { permissions: ['forms.manage'] }, moduleKey: 'work_scrutiny' }, wsStudioResponses({
    formTemplates: () => created ? [wsTemplate(), wsTemplate({ id: 'created', name: 'Merged copy' })] : [wsTemplate()],
    formTemplateAdministration: id => id === 'created' ? wsAdministration({ templateId: 'created', rowVersion: 'target-token', sections: copied ? withSavedSectionIds(copied.sections) : wsTargetCoreSections() }) : source,
    createFormTemplate: () => { created = true; return { ok: true, data: { id: 'created' } }; },
    updateFormTemplateStructure: (_id, request) => { copied = request; return { ok: true }; }
  }));
  await page.change(field(page, 'New draft name'), 'Merged copy');
  await page.change(field(page, 'Allocated sub-team'), 'team'); await page.click('Copy selected form');
  assert.equal(copied.rowVersion, 'target-token');
  assert.deepEqual(copied.sections.map(section => section.sectionKey), ['workflow_context', 'criteria']);
  assert.equal(copied.sections[0].title, 'Sample context', 'the target core section remains authoritative');
  assert.deepEqual(copied.sections[0].fields.map(field => field.fieldKey), ['qualification_level', 'learning_walk_delivery_area', 'custom_sample_notes']);
  assert.deepEqual(copied.sections[0].fields[0].options, ['Level 1', 'Level 2']);
  const fields = copied.sections.flatMap(section => section.fields);
  assert.equal(new Set(fields.map(field => field.fieldKey)).size, fields.length);
  assert.equal(fields.some(field => field.fieldKey === 'course_level'), false);
  assert.equal(fields.find(field => field.fieldKey === 'custom_sample_notes').label, 'Sample notes');
  assert.equal(fields.find(field => field.fieldKey === 'custom_reflection').label, 'Reflection');
});

test('a created Work Scrutiny copy is retained without writing content if its target token cannot be read', async () => {
  let created = false;
  const page = await panel('FormBuilder.tsx', 'FormBuilder', { user: { permissions: ['forms.manage'] }, moduleKey: 'work_scrutiny' }, wsStudioResponses({
    formTemplates: () => created ? [wsTemplate(), wsTemplate({ id: 'created', name: 'Retained empty copy' })] : [wsTemplate()],
    formTemplateAdministration: id => { if (id === 'created') throw new Error('Target unavailable'); return wsAdministration(); },
    createFormTemplate: () => { created = true; return { ok: true, data: { id: 'created' } }; }
  }));
  await page.change(field(page, 'New draft name'), 'Retained empty copy');
  await page.change(field(page, 'Allocated sub-team'), 'team');
  await page.click('Copy selected form');
  assert.equal(page.calls.filter(call => call[0] === 'createFormTemplate').length, 1);
  assert.equal(page.calls.some(call => call[0] === 'updateFormTemplateStructure'), false);
  assert.match(page.markup(), /empty draft.*was retained/);
  assert.equal(field(page, 'New draft name').props.value, '');
});

test('legacy Work Scrutiny saves before offering guarded publication review in the version editor', async () => {
  let current = wsAdministration();
  const page = await panel('FormBuilder.tsx', 'FormBuilder', { user: { permissions: ['forms.manage'] }, moduleKey: 'work_scrutiny' }, wsStudioResponses({
    formTemplateAdministration: () => current,
    updateFormTemplateStructure: (_id, request) => { current = { ...current, ...request, sections: withSavedSectionIds(request.sections), rowVersion: 'fresh-draft-token' }; return { ok: true }; }
  }));
  await page.change(field(page, 'Question 1'), 'Saved before review');
  const disabledLink = page.nodes().find(node => node.type === 'a');
  await disabledLink.props.onClick({ preventDefault() {} });
  assert.equal(page.calls.some(call => call[0] === 'writeAppPath'), false);
  assert.equal(await page.saveGuard('Form layout and wording'), true);
  const link = page.nodes().find(node => node.type === 'a');
  assert.equal(link.props['aria-disabled'], false); assert.equal(link.props.href, '/admin/work-scrutiny-templates');
  await link.props.onClick({ preventDefault() {} });
  assert.deepEqual(page.calls.find(call => call[0] === 'writeAppPath'), ['writeAppPath', '/admin/work-scrutiny-templates']);
  assert.equal(page.calls.some(call => call[0] === 'publishFormTemplate'), false);
  await page.change(field(page, 'Question 1'), 'Another edit');
  assert.equal(await page.saveGuard('Form layout and wording'), true);
  assert.equal(page.calls.filter(call => call[0] === 'updateFormTemplateStructure').at(-1)[2].rowVersion, 'fresh-draft-token');
});

test('legacy Work Scrutiny protects core answer contracts and removal while retaining wording, guidance and ordering', async () => {
  const form = wsAdministration({ sections: [{ id: 'workflow', sectionKey: 'workflow_context', title: 'Sample context', displayOrder: 1, fields: [
    { id: 'level', fieldKey: 'qualification_level', label: 'Course level', fieldType: 'single_select', isRequired: true, isProtected: true, displayOrder: 10, helpText: 'Workflow guidance', options: ['Level 1', 'Level 2'] },
    { id: 'delivery', fieldKey: 'learning_walk_delivery_area', label: 'Delivery area', fieldType: 'learning_walk_delivery_area', isRequired: true, isProtected: true, displayOrder: 20 }
  ] }] });
  const page = await panel('FormBuilder.tsx', 'FormBuilder', { user: { permissions: ['forms.manage'] }, moduleKey: 'work_scrutiny' }, wsStudioResponses({ formTemplateAdministration: form, updateFormTemplateStructure: { ok: false, message: 'Keep the draft for inspection.' } }));
  assert.equal(field(page, 'Answer type').props.disabled, true);
  assert.ok(page.nodes().filter(node => node.type === 'input' && node.props.type === 'checkbox').every(node => node.props.disabled));
  assert.equal(page.nodes().find(node => node.type === 'textarea' && node.props.value === 'Level 1\nLevel 2').props.disabled, true);
  const removeButtons = page.nodes().filter(node => node.type === page.Button && ['Remove section', 'Remove question'].includes(text(node)));
  assert.ok(removeButtons.every(node => node.props.disabled));
  for (const button of removeButtons) button.props.onClick(); await page.settle();
  await page.change(field(page, 'Answer type'), 'short_text');
  assert.equal(field(page, 'Answer type').props.value, 'single_select');
  assert.equal(page.guards.get('Form layout and wording').dirty, false, 'bypassed disabled handlers cannot alter protected semantics or remove core questions');
  await page.change(field(page, 'Question 1'), 'Level of this sample');
  await page.change(page.nodes().find(node => node.type === 'textarea' && node.props.value === 'Workflow guidance'), 'Updated guidance');
  page.nodes().find(node => node.props?.['aria-label'] === 'Move Level of this sample down').props.onClick(); await page.settle();
  assert.equal(field(page, 'Question 1').props.value, 'Delivery area');
  assert.equal(await page.saveGuard('Form layout and wording'), false);
  const fields = page.calls.find(call => call[0] === 'updateFormTemplateStructure')[2].sections[0].fields;
  assert.deepEqual(fields.map(field => field.fieldKey), ['learning_walk_delivery_area', 'qualification_level']);
  assert.equal(fields[1].label, 'Level of this sample'); assert.equal(fields[1].helpText, 'Updated guidance');
  assert.equal(fields[1].fieldType, 'single_select'); assert.equal(fields[1].isRequired, true); assert.deepEqual(fields[1].options, ['Level 1', 'Level 2']);
});
