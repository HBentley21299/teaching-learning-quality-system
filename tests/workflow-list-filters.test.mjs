import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const web = createRequire(new URL('../apps/web/package.json', import.meta.url));
const ts = web('typescript'), jsx = web('react/jsx-runtime');
async function load(path, imports = {}) {
  const source = await readFile(new URL(`../apps/web/src/${path}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'exports', 'module', code)(name => {
    if (name in imports) return imports[name];
    throw new Error(`Unexpected import ${name} in ${path}`);
  }, module.exports, module);
  return module.exports;
}
const list = await load('services/listQuery.ts');
const queries = await load('services/workflowListQueries.ts', { './listQuery': list });
const liv = await load('services/livWorkflow.ts');
const choiceAnswers = await load('services/formChoiceAnswers.ts');
const actionResponsibility = await load('services/actionResponsibility.ts');
const workflowFilters = await load('components/WorkflowFilters.tsx', { 'react/jsx-runtime': jsx, 'lucide-react': new Proxy({}, { get: () => function Icon() { return null; } }) });
const noOp = () => {};
const staff = (id, name, orgUnitIds = []) => ({ id, displayName: name, externalId: `EMP-${id}`, email: `${id}@college.test`, orgUnitIds });
const unit = (id, type, code, parentOrgUnitId) => ({ id, orgUnitType: type, code, name: `Historical ${code}`, parentOrgUnitId, isActive: false });
const user = { staffId: 'reviewer', permissions: [], displayName: 'Reviewer' };
const tick = () => new Promise(resolve => setImmediate(resolve));

// Exercise each real register's handlers and resulting rows without browser globals or API mutations.
async function mount(path, exportName, props, data = {}) {
  let cursor = 0, changed = true, tree, registeredEditors = [], navigationChecks = 0;
  const state = [], effects = [];
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial; return [state[i], next => { const value = typeof next === 'function' ? next(state[i]) : next; if (!Object.is(value, state[i])) { state[i] = value; changed = true; } }]; },
    useMemo(factory) { return factory(); },
    useId() { return "test-choice-control"; },
    useCallback(callback) { return callback; },
    useRef(initial) { const i = cursor++; if (!(i in state)) state[i] = { current: initial }; return state[i]; },
    useEffect(effect, deps) { const i = cursor++; const previous = state[i]; if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index]))) { const current = { deps }; state[i] = current; effects.push(() => { previous?.cleanup?.(); current.cleanup = effect(); }); } }
  };
  const api = new Proxy({}, { get: (_, key) => async (...args) => { assert.ok(key in data, `Unexpected API ${String(key)}`); return typeof data[key] === "function" ? data[key](...args) : data[key]; } });
  const source = await readFile(new URL(`../apps/web/src/${path}`, import.meta.url), 'utf8');
  const imports = Object.fromEntries([...source.matchAll(/from\s+"([^"]+)"/g)].map(([, name]) => [name, new Proxy({}, { get: (_, key) => key === '__esModule' ? true : function Placeholder() { return null; } })]));
  Object.assign(imports, {
    react: hooks, 'react/jsx-runtime': jsx,
    '../services/api': { api }, '../services/listQuery': list, '../services/workflowListQueries': queries,
    '../services/livWorkflow': liv, '../services/formChoiceAnswers': choiceAnswers,
    '../services/actionResponsibility': actionResponsibility,
    '../components/WorkflowFilters': workflowFilters,
    '../services/formContent': { useFormContent: formKey => ({ field: (key, label, helpText) => ({ label, helpText, ...(data.formContentOverrides?.[formKey]?.[key] ?? {}) }) }) },
    '../services/workflowExperience': await load('services/workflowExperience.ts'),
    '../components/UnsavedChangesGuard': { useUnsavedChanges: editor => { registeredEditors.push(editor); return noOp; }, confirmUnsavedNavigation: async () => { navigationChecks += 1; return data.navigationDecision ?? true; } },
    './UnsavedChangesGuard': { useUnsavedChanges: editor => { registeredEditors.push(editor); return noOp; }, confirmUnsavedNavigation: async () => { navigationChecks += 1; return data.navigationDecision ?? true; } },
    '../components/useActionOwners': { useActionOwners: () => ({ owners: [], loading: false, error: '', retry: noOp }) },
    '../services/learningWalkDeliveryAreas': { learningWalkDeliveryChoices: () => [] },
    '../services/csvImportPresentation': { canUseAdminCsvImport: () => false }
  });
  imports['../components/WorkflowPagination'] = await load('components/WorkflowPagination.tsx', { react: hooks, 'react/jsx-runtime': jsx, '../services/workflowExperience': await load('services/workflowExperience.ts'), '../design-system/Button': { Button: function Button() { return null; } }, 'lucide-react': new Proxy({}, { get: () => function Icon() { return null; } }) });
  imports['./useComboboxNavigation'] = await load('components/useComboboxNavigation.ts', { react: hooks });
  const component = (await load(path, imports))[exportName];
  async function settle() {
    for (let i = 0; i < 12; i++) {
      if (changed) { cursor = 0; changed = false; registeredEditors = []; tree = component(props); }
      while (effects.length) effects.shift()();
      await tick();
      if (!changed && !effects.length) return;
    }
    throw new Error('Register did not settle');
  }
  const nodes = () => { const result = []; const visit = value => { if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object' && value.props) { if (value.type === workflowFilters.WorkflowFilters) visit(value.type(value.props)); else { result.push(value); visit(value.props.children); } } }; visit(tree); return result; };
  const text = value => Array.isArray(value) ? value.map(text).join(' ') : value && typeof value === 'object' ? text(value.type === workflowFilters.WorkflowFilters ? value.type(value.props) : value.props?.children) : value == null || typeof value === 'boolean' ? '' : String(value);
  const field = label => nodes().find(node => node.props['aria-label'] === label) || (() => { const parent = nodes().find(node => node.type === 'label' && text(node).startsWith(label)); return parent && (Array.isArray(parent.props.children) ? parent.props.children : [parent.props.children]).find(node => node?.type === 'select' || node?.type === 'input' || node?.type === 'textarea'); })();
  function choices(controlId) {
    const component = nodes().find(node => node.props.controlId === controlId || `scrutiny-field-${node.props.field?.id}` === controlId);
    assert.ok(component, `Missing choice component ${controlId}`);
    const rendered = component.type(component.props), children = [];
    const visit = value => { if (Array.isArray(value)) value.forEach(visit); else if (value?.props) { children.push(value); visit(value.props.children); } };
    visit(rendered);
    return children.filter(node => node.type === 'label').map(label => {
      const nested = Array.isArray(label.props.children) ? label.props.children : [label.props.children];
      return { label: text(nested.find(node => node?.type === 'span')).trim(), input: nested.find(node => node?.type === 'input') };
    }).filter(choice => choice.input);
  }
  await settle();
  return { guards: () => registeredEditors, navigationChecks: () => navigationChecks, async runGuard(label, action) { const editor = registeredEditors.find(item => item.label === label); assert.ok(editor, `Missing guard ${label}`); assert.equal(typeof editor[action], "function", `Missing ${action} callback`); const result = await editor[action](); await settle(); return result; }, async choose(controlId, option) { const choice = choices(controlId).find(choice => choice.label === option); assert.ok(choice, `Missing option ${option}`); choice.input.props.onChange(); changed = true; await settle(); }, choiceStates: controlId => choices(controlId).map(choice => ({ label: choice.label, checked: choice.input.props.checked })), renderNodeText: node => text(node.type(node.props)), nodes, flush: settle, async page(label, page) { const pager = nodes().find(node => node.props.label === label && node.props.setPage); assert.ok(pager, `Missing ${label} pager`); pager.props.setPage(page); await settle(); }, async set(id, value) { const node = nodes().find(node => (node.props.id === id || node.props.controlId === id) && node.props.onChange); assert.ok(node, `Missing control ${id}`); await node.props.onChange(value); changed = true; await settle(); }, async event(label, eventName, payload = {}) { const input = field(label); assert.ok(input, `Missing ${label}`); input.props[eventName](payload); changed = true; await settle(); }, text: () => text(tree), field, async change(label, value) { const input = field(label); assert.ok(input, `Missing ${label}`); input.props.onChange({ target: { value } }); changed = true; await settle(); }, async click(label) { const button = nodes().find(node => node.props.onClick && (text(node).trim() === label || text(node).trim().startsWith(label + ' '))); assert.ok(button, `Missing ${label}`); button.props.onClick(); changed = true; await settle(); }, rowKeys: () => nodes().filter(node => node.type === 'tr' && node.key != null).map(node => String(node.key)) };
}

const uco = (recordId, overrides = {}) => ({ recordId, title: 'Review', lecturerName: 'Zoe', observerStaffId: 'old-observer', observerName: 'Retired Observer', courseTitle: 'Course 10', moduleTitle: 'Communication', academicYear: '2025/26', workflowStatus: 'completed', ...overrides });
test('UCO search combines people, course and module; date sorting keeps unscheduled reviews last in both directions', () => {
  const rows = [uco('missing'), uco('late', { observationAt: '2026-10-01' }), uco('early', { observationAt: '2026-09-01', courseTitle: 'Course 2' })];
  const filters = { search: 'retired communication', status: 'all', observer: 'old-observer', course: 'all', followUp: 'all', sort: 'newest' };
  assert.deepEqual(queries.selectUcoReviews(rows, filters).map(row => row.recordId), ['late', 'early', 'missing']);
  assert.deepEqual(queries.selectUcoReviews(rows, { ...filters, sort: 'oldest' }).map(row => row.recordId), ['early', 'late', 'missing']);
  assert.deepEqual(queries.selectUcoReviews(rows, { ...filters, course: 'Course 2' }).map(row => row.recordId), ['early']);
  assert.deepEqual(rows.map(row => row.recordId), ['missing', 'late', 'early']);
});

test('ELI completion/validation search includes organisation, email, reviewer and feedback; filters compose', () => {
  const rows = [
    { staffId: 'z', staffName: 'Zoe', email: 'z@college.test', externalId: 'EMP2', status: 'submitted', facultyCode: 'OLD', facultyName: 'Historical Faculty', teamCode: 'T2', teamName: 'Team 2', validationStatus: 'returned', reviewedByName: 'Former Leader', feedback: 'Revisit modelling', reviewedAt: '2026-09-01' },
    { staffId: 'a', staffName: 'Alex', email: 'alex@college.test', externalId: 'EMP1', status: 'not_started', validationStatus: 'draft' }
  ];
  const filters = { search: 'historical modelling former', status: 'returned', faculty: 'OLD', team: 'T2', reviewer: 'Former Leader', sort: 'staff' };
  assert.deepEqual(queries.selectPracticeStaff(rows, filters, true).map(row => row.staffId), ['z']);
  assert.deepEqual(queries.selectPracticeStaff(rows, { search: 'alex@college', status: 'all', faculty: 'all', team: 'all', sort: 'staff' }).map(row => row.staffId), ['a']);
  for (const sort of ['newest', 'oldest']) assert.deepEqual(queries.selectPracticeStaff(rows, { ...filters, search: '', status: 'all', faculty: 'all', team: 'all', reviewer: 'all', sort }, true).map(row => row.staffId), ['z', 'a']);
});

test('probation filters use historical case area after a staff transfer and search named reviewers', async () => {
  const cases = [
    { id: 'old', subjectStaffId: 'a', subjectStaffName: 'Alex', academicYear: '2025/26', orgUnitId: 'old-team', orgUnitCode: 'OLDT', parentOrgUnitCode: 'OLDF', status: 'in_progress', currentObservationNumber: 2, createdAt: '2025-09-01', isCreatedByCurrentUser: true, reviewers: [{ staffId: 'retired', displayName: 'Former Leader' }], observations: [] },
    { id: 'new', subjectStaffId: 'b', subjectStaffName: 'Beth', academicYear: '2026/27', orgUnitId: 'new-team', orgUnitCode: 'NEWT', parentOrgUnitCode: 'NEWF', status: 'completed', currentObservationNumber: 3, createdAt: '2026-09-01', isCreatedByCurrentUser: true, reviewers: [], observations: [] }
  ];
  const view = await mount('routes/ProbationObservations.tsx', 'ProbationObservations', { staff: [staff('a', 'Alex', ['new-team'])], orgUnits: [unit('old-faculty', 'faculty', 'OLDF'), unit('old-team', 'faculty_child_code', 'OLDT', 'old-faculty')], user, actions: [] }, { probationCases: cases, probationConfiguration: {}, livRecords: [] });
  assert.match(view.text(), /OLDF/);
  await view.change('Faculty', 'OLDF'); await view.change('Search probation cases', 'alex former');
  assert.deepEqual(view.rowKeys(), ['old']);
  await view.change('Reviewer', 'retired'); await view.change('Current observation', '3');
  assert.deepEqual(view.rowKeys(), []);
  await view.click('Clear filters'); assert.deepEqual(view.rowKeys(), ['old', 'new']);
});

test('LIV reviewer/course search and cycle filters act on the full register; coverage includes historical child-code teams', async () => {
  const records = [
    { id: 'old', recordId: 'r-old', subjectStaffId: 'a', subjectStaffName: 'Alex', reviewerStaffId: 'retired', reviewerStaffName: 'Former Leader', orgUnitId: 'old-team', orgUnitCode: 'OLDT', parentOrgUnitCode: 'OLDF', status: 'in_progress', currentStage: 'visit', createdAt: '2025-09-01', updatedAt: '2026-01-01', isCreatedByCurrentUser: true, cycles: [{ cycleNumber: 2, status: 'in_progress' }], visits: [{ visitDate: '2026-01-01', courseName: 'Communication', deliveryAreaName: 'Health' }] },
    { id: 'new', recordId: 'r-new', subjectStaffId: 'b', subjectStaffName: 'Beth', status: 'closed', currentStage: 'actions', createdAt: '2026-09-01', isCreatedByCurrentUser: true, cycles: [{ cycleNumber: 1, status: 'completed' }], visits: [] }
  ];
  const view = await mount('routes/LivVisits.tsx', 'LivVisits', { academicYear: '2026/27', staff: [staff('a', 'Alex', ['old-team'])], orgUnits: [unit('old-faculty', 'faculty', 'OLDF'), unit('old-team', 'faculty_child_code', 'OLDT', 'old-faculty')], user }, { livRecords: records, actions: [], livConfiguration: {}, sharedThemes: [] });
  await view.change('Search LIV records', 'former communication');
  assert.ok(view.rowKeys().includes('old')); assert.ok(!view.rowKeys().includes('new'));
  await view.change('Current cycle', '1'); assert.ok(!view.rowKeys().includes('old'));
  assert.match(view.text(), /Historical OLDT/);
});

test('coaching combines focus-label and coach search and retains retired focus options', async () => {
  const session = { id: 'old', recordId: 'r-old', staffId: 'a', staffName: 'Alex', coachStaffId: 'retired', coachName: 'Former Coach', sessionDate: '2025-09-01', academicYear: '2025/26', sessionType: 'coaching', status: 'completed', primaryFocus: 'retired_focus', cycleNumber: 2, sessionNumber: 10, isCreatedByCurrentUser: true };
  const view = await mount('routes/CoachingMentoring.tsx', 'CoachingMentoring', { staff: [], orgUnits: [], user }, { coachingSessions: [session], coachingConfiguration: { focusAreas: [{ valueKey: 'retired_focus', displayName: 'Historical Modelling' }] } });
  assert.equal(view.nodes().find(node => node.props['aria-controls'] === 'coaching-record-history').props['aria-expanded'], true);
  await view.change('Search coaching sessions', 'former modelling');
  assert.deepEqual(view.rowKeys(), ['old']);
  await view.change('Academic year', '2026/27'); assert.deepEqual(view.rowKeys(), []);
  assert.match(view.text(), /Historical Modelling/);
});

const workspaceRecord = (id, overrides = {}) => ({ id, title: 'CPD event', recordType: 'cpd_event', academicYear: '2026/27', isCreatedByCurrentUser: true,
  submissionStatus: 'submitted', createdAt: '2026-09-01', recordDate: '2026-09-01', templateKey: 'cpd_core', templateName: 'Internal CPD', ...overrides });
const workspaceFilters = { search: '', status: 'all', area: 'all', type: 'all', theme: 'all', person: 'all', participant: 'all', deliveryArea: 'all', room: 'all', from: '', to: '', sort: 'newest', mine: true };
test('all module record filters compose against full business metadata, including participant, theme, date, type and room', () => {
  const records = [workspaceRecord('chosen', { ownerDisplayName: 'Former Owner', participantNames: ['Alex Practitioner'], themeNames: ['Historical Theme'], orgUnitId: 'old-team' }),
    workspaceRecord('other', { templateKey: 'cpd_mandatory', templateName: 'Mandatory CPD', recordDate: '2026-10-01' })];
  const units = [unit('old-team', 'team', 'OLDT')];
  const filters = { ...workspaceFilters, search: 'former historical alex', participant: 'Alex Practitioner', theme: 'Historical Theme', from: '2026-09-01', to: '2026-09-30', type: 'cpd_core' };
  assert.deepEqual(queries.selectWorkspaceRecords(records, units, filters).map(row => row.id), ['chosen']);
  assert.deepEqual(queries.selectWorkspaceRecords(records, units, { ...filters, to: '2026-08-31' }), []);
  assert.deepEqual(queries.selectWorkspaceRecords([workspaceRecord('room', { roomCode: 'Room 2', roomName: 'Science Lab' })], [], { ...workspaceFilters, search: 'science room', room: 'Room 2' }).map(row => row.id), ['room']);
  assert.deepEqual(queries.selectWorkspaceRecords([workspaceRecord('10', { title: 'Event 10' }), workspaceRecord('2', { title: 'Event 2' })], [], { ...workspaceFilters, sort: 'title' }).map(row => row.id), ['2', '10']);
});

test('CPD register exposes filters beyond Learning Walks and retains historical participants/options during search', async () => {
  const records = [workspaceRecord('one', { participantNames: ['Former Lecturer'], themeNames: ['Historical Theme'] }), workspaceRecord('two', { title: 'Mandatory', templateKey: 'cpd_mandatory', templateName: 'Mandatory CPD' })];
  const view = await mount('routes/ModuleWorkspace.tsx', 'ModuleWorkspace', { academicYear: '2026/27', title: 'CPD', eyebrow: 'Development', mode: 'cpd', staff: [], user }, { records, orgUnits: [], actions: [], lookups: [] });
  assert.equal(view.nodes().find(node => node.props['aria-controls'] === 'cpd-active-records').props['aria-expanded'], true);
  assert.ok(view.field('CPD type')); assert.ok(view.field('Participant')); assert.ok(view.field('From date'));
  await view.change('Search workflow records', 'former historical');
  assert.match(view.text(), /Former Lecturer/); assert.match(view.text(), /Historical Theme/);
  assert.ok(view.nodes().some(node => node.props.className === 'record-row' && node.key === 'one'));
  assert.ok(!view.nodes().some(node => node.props.className === 'record-row' && node.key === 'two'));
});

test('Actions combine source/person/theme search, preserve historical filter labels and sort typed due dates globally', async () => {
  const base = { ownerStaffId: 'retired', ownerStaffName: 'Former Owner', subjectStaffId: 'a', subjectStaffName: 'Alex Practitioner', actionTheme: 'Historical Theme', sourceFormType: 'liv', sourceRecordTitle: 'Course review', statusKey: 'open', createdAt: '2026-09-01', facultyId: 'old-faculty', facultyCode: 'OLDF', facultyName: 'Retired Faculty', isDeleted: false };
  const view = await mount('routes/ActionsView.tsx', 'ActionsView', { academicYear: '2026/27', actions: [{ ...base, id: 'missing', title: 'Missing date' }, { ...base, id: 'late', title: 'Later', dueDate: '2026-10-01' }, { ...base, id: 'early', title: 'Earlier', dueDate: '2026-09-01' }], staff: [], orgUnits: [], user: { ...user, permissions: ['reports.view_scoped'] }, onChanged: async () => {} }, {});
  const rows = () => view.nodes().find(node => Array.isArray(node.props.rows))?.props.rows.map(row => row.id);
  assert.deepEqual(rows(), ['early', 'late', 'missing']);
  await view.change('Sort actions', 'due_desc'); assert.deepEqual(rows(), ['late', 'early', 'missing']);
  await view.change('Search actions and people', 'former course historical'); assert.deepEqual(rows(), ['late', 'early', 'missing']);
  assert.match(view.text(), /Retired Faculty/);
});

test('a shared Activate action appears once for a secondary responsible person and remains searchable by every responsible name', async () => {
  const base = { ownerStaffId: 'primary', ownerStaffName: 'Primary Colleague', responsibleStaffIds: ['primary', 'reviewer'],
    responsibleStaffNames: ['Primary Colleague', 'Secondary Colleague'], actionTheme: 'Digital Teaching & Learning',
    sourceFormType: 'activate_growth_review', sourceRecordTitle: 'Growth review', statusKey: 'open', createdAt: '2026-10-01', isDeleted: false };
  const view = await mount('routes/ActionsView.tsx', 'ActionsView', { academicYear: '2026/27', actions: [{ ...base, id: 'shared', title: 'Review the resources', dueDate: '2026-12-01' }],
    staff: [], orgUnits: [], user: { ...user, permissions: ['reports.view_scoped'] }, onChanged: async () => {} }, {});
  const rows = () => view.nodes().find(node => Array.isArray(node.props.rows))?.props.rows.map(row => row.id);
  assert.deepEqual(rows(), ['shared']);
  await view.change('View', 'mine'); assert.deepEqual(rows(), ['shared']);
  await view.change('Owner', 'reviewer'); assert.deepEqual(rows(), ['shared']);
  await view.change('Search actions and people', 'secondary growth'); assert.deepEqual(rows(), ['shared']);
  await view.change('Search actions and people', 'primary colleague'); assert.deepEqual(rows(), ['shared']);
  assert.match(view.text(), /Secondary Colleague/);
  const table = view.nodes().find(node => Array.isArray(node.props.rows));
  assert.equal(table.props.columns.find(column => column.key === 'owner').render(table.props.rows[0]), 'Primary Colleague; Secondary Colleague');
});

test('staff picker exposes all matches, combines email/job terms and supports keyboard selection after sort', async () => {
  const people = Array.from({ length: 15 }, (_, index) => ({ ...staff(`p${index}`, `Lecturer ${index}`), jobTitle: 'Science Teacher' }));
  const selected = [];
  const view = await mount('components/StaffSearchSelect.tsx', 'StaffSearchSelect', { id: 'staff', staff: people, value: '', onChange: id => selected.push(id) });
  await view.change('Staff member', '');
  assert.equal(view.nodes().filter(node => node.props.role === 'option').length, 15);
  await view.change('Staff results sort', 'staff_id');
  await view.change('Staff member', 'p12@college science');
  assert.equal(view.nodes().filter(node => node.props.role === 'option').length, 1);
  await view.event('Staff member', 'onKeyDown', { key: 'ArrowDown', preventDefault: noOp });
  await view.event('Staff member', 'onKeyDown', { key: 'Enter', preventDefault: noOp });
  assert.equal(selected.at(-1), 'p12');
  const saved = await mount('components/StaffSearchSelect.tsx', 'StaffSearchSelect', { id: 'staff', staff: [], value: 'saved-id', onChange: () => assert.fail('Saved choice must not be cleared') });
  assert.equal(saved.field('Staff member').props.value, 'Saved staff member');
  assert.match(saved.text(), /retained until/);
});

test('room and course pickers use natural ordering, uncapped matches, focusable sorts and retain unknown saved selections', async () => {
  const rooms = Array.from({ length: 15 }, (_, index) => ({ id: `r${index}`, roomCode: `Room ${index + 1}`, buildingName: 'Science Building' }));
  const selectedRooms = [];
  const room = await mount('components/RoomSearchSelect.tsx', 'RoomSearchSelect', { id: 'room', rooms: rooms.toReversed(), value: '', onChange: value => selectedRooms.push(value) });
  await room.change('Room', 'science');
  assert.equal(room.nodes().filter(node => node.props.role === 'option').length, 15);
  assert.deepEqual(room.nodes().filter(node => node.props.role === 'option').slice(0, 3).map(node => node.key), ['r0', 'r1', 'r2']);
  assert.ok(!room.nodes().find(node => node.props.role === 'listbox').props.onMouseDown);
  await room.event('Room', 'onKeyDown', { key: 'ArrowDown', preventDefault: noOp });
  await room.event('Room', 'onKeyDown', { key: 'Enter', preventDefault: noOp });
  assert.equal(selectedRooms.at(-1), 'Room 1');
  const savedRoom = await mount('components/RoomSearchSelect.tsx', 'RoomSearchSelect', { id: 'room', rooms: [], value: 'Historic 99', onChange: () => assert.fail('Saved room must remain') });
  assert.equal(savedRoom.field('Room').props.value, 'Historic 99');

  const courses = rooms.map((room, index) => ({ id: room.id, courseCode: `C${index + 1}`, courseName: 'Applied Science', academicYear: '2025/26', orgUnitId: 'old' }));
  const selectedCourses = [];
  const course = await mount('components/CourseMultiSelect.tsx', 'CourseMultiSelect', { id: 'courses', courses: courses.toReversed(), selectedIds: ['historic-id'], onChange: ids => selectedCourses.push(ids) });
  await course.change('Search courses', 'applied 2025/26');
  assert.equal(course.nodes().filter(node => node.props.role === 'option').length, 15);
  assert.match(course.text(), /Outside the available catalogue/);
  await course.event('Search courses', 'onKeyDown', { key: 'ArrowDown', preventDefault: noOp });
  await course.event('Search courses', 'onKeyDown', { key: 'Enter', preventDefault: noOp });
  assert.deepEqual(selectedCourses.at(-1), ['historic-id', 'r0']);
});

test('CPD participant picker searches associated groups without dropping saved unavailable participants', async () => {
  const people = Array.from({ length: 15 }, (_, index) => staff(`p${index}`, `Lecturer ${index}`, ['team']));
  const changes = [];
  const view = await mount('components/CpdParticipantPicker.tsx', 'CpdParticipantPicker', { id: 'participants', staff: people, orgUnits: [{ ...unit('team', 'team', 'SCI'), name: 'Science', isActive: true }], value: 'saved-unavailable|p1', onChange: value => changes.push(value) });
  await view.change('Search participants', 'science lecturer');
  assert.equal(view.nodes().filter(node => node.props.role === 'option').length, 14);
  await view.change('Selected participants sort', 'name');
  assert.match(view.text(), /Unavailable staff member/);
  await view.change('Search selected participants', 'lecturer science');
  assert.match(view.text(), /1\s+of\s+2/);
  assert.deepEqual(changes, []);
  assert.ok(!view.nodes().find(node => node.props.role === 'listbox').props.onMouseDown);
});

test('Work Scrutiny keeps removed saved choices visible without reordering current published answers', async () => {
  const field = { id: 'question', fieldKey: 'custom', fieldType: 'single_select', label: 'Response', options: ['Choice 10', 'Choice 2'] };
  const view = await mount('components/WorkScrutinyCreateForm.tsx', 'WorkScrutinyResponseField', { field, value: 'Retired choice', onChange: () => assert.fail('Rendering must not amend saved answers') });
  const options = view.nodes().filter(node => node.type === 'option').map(node => node.props.value);
  assert.deepEqual(options, ['', 'Retired choice', 'Choice 10', 'Choice 2']);
  const multi = await mount('components/WorkScrutinyCreateForm.tsx', 'WorkScrutinyResponseField', { field: { ...field, fieldType: 'multi_select' }, value: 'Choice 2|Retired choice', onChange: noOp });
  assert.equal(multi.nodes().filter(node => node.type === 'input' && node.props.checked).length, 2);
  assert.match(multi.text(), /Retired choice.*existing response/);
  const rubric = await mount('components/WorkScrutinyCreateForm.tsx', 'WorkScrutinyResponseField', { field: { ...field, fieldType: 'rubric_scale' }, value: 'Retired judgement', onChange: noOp });
  assert.match(rubric.text(), /Existing response:.*Retired judgement.*no longer offered/);
});


test('Work Scrutiny context change discards previous-team draft actions after the existing navigation check', async () => {
  const units = [
    { id: 'faculty', orgUnitType: 'faculty', code: 'F', name: 'Faculty', isActive: true },
    { id: 'a', orgUnitType: 'team', parentOrgUnitId: 'faculty', code: 'A', name: 'Team A', isActive: true },
    { id: 'b', orgUnitType: 'team', parentOrgUnitId: 'faculty', code: 'B', name: 'Team B', isActive: true }
  ];
  const definition = { templateKey: 'work_scrutiny', sections: [] };
  const view = await mount('components/WorkScrutinyCreateForm.tsx', 'WorkScrutinyCreateForm', { orgUnits: units, staff: [], user, onCancel: noOp, onSubmitted: noOp }, { learningWalkDeliveryAreas: [], workScrutinyTemplate: definition });
  await view.change('Faculty', 'faculty'); await view.change('Sub-team', 'a'); await view.click('Add action');
  assert.equal(view.nodes().filter(node => node.props.id?.startsWith('scrutiny-action-theme-')).length, 1);
  await view.change('Sub-team', 'b');
  assert.equal(view.nodes().filter(node => node.props.id?.startsWith('scrutiny-action-theme-')).length, 0);
});

test('Work Scrutiny validation links every missing required answer and never sends an invalid completion', async () => {
  let submissions = 0;
  const definition = { templateKey: 'work_scrutiny', sections: [{ id: 'section', title: 'Sample', fields: [
    { id: 'level', fieldKey: 'course_level', fieldType: 'single_select', label: 'Course level', isRequired: true },
    { id: 'delivery', fieldKey: 'learning_walk_delivery_area', fieldType: 'single_select', label: 'Delivery area', isRequired: true },
    { id: 'evidence', fieldKey: 'evidence', fieldType: 'long_text', label: 'Evidence', isRequired: true }
  ] }] };
  const view = await mount('components/WorkScrutinyCreateForm.tsx', 'WorkScrutinyCreateForm', { orgUnits: [], staff: [], user, onCancel: noOp, onSubmitted: noOp }, { learningWalkDeliveryAreas: [], workScrutinyTemplate: definition, submitForm: () => { submissions += 1; return { ok: false }; } });
  await view.change('Faculty', 'faculty'); await view.change('Sub-team', 'a'); await view.click('Complete scrutiny');
  const errors = view.nodes().find(node => Array.isArray(node.props.errors))?.props.errors;
  assert.deepEqual(errors.map(error => error.id), ['scrutiny-field-level', 'scrutiny-field-delivery', 'scrutiny-field-evidence']);
  assert.equal(submissions, 0);
});

test('a slow LIV staff-context response cannot replace the newly selected staff member', async () => {
  const pending = new Map();
  const view = await mount('routes/LivVisits.tsx', 'LivVisits', { academicYear: '2026/27', staff: [], orgUnits: [], user: { ...user, permissions: ['liv.submit'] } }, { livRecords: [], actions: [], livConfiguration: {}, sharedThemes: [], livStaffContext: staffId => new Promise(resolve => pending.set(staffId, resolve)) });
  await view.click('Create LIV case'); await view.set('liv-staff', 'a'); await view.set('liv-staff', 'b');
  pending.get('b')({ staffId: 'b', primaryFocus: 'Newest staff focus' }); await view.flush();
  pending.get('a')({ staffId: 'a', primaryFocus: 'Old staff focus' }); await view.flush();
  const context = view.nodes().find(node => node.props.context)?.props.context;
  assert.equal(context.staffId, 'b');
  assert.equal(context.primaryFocus, 'Newest staff focus');
});


test('LIV pages only after full-register filtering and resets to page one when the query changes', async () => {
  const records = Array.from({ length: 32 }, (_, index) => ({ id: `liv-${index + 1}`, recordId: `record-${index + 1}`, subjectStaffId: `staff-${index + 1}`, subjectStaffName: `Person ${index + 1}`, status: 'in_progress', currentStage: 'visit', createdAt: '2026-09-01', isCreatedByCurrentUser: true, cycles: [{ cycleNumber: 1, status: 'in_progress' }], visits: [] }));
  const view = await mount('routes/LivVisits.tsx', 'LivVisits', { academicYear: '2026/27', staff: [], orgUnits: [], user }, { livRecords: records, actions: [], livConfiguration: {}, sharedThemes: [] });
  assert.equal(view.rowKeys().length, 25);
  assert.ok(!view.rowKeys().includes('liv-32'));
  await view.page('LIV records', 2);
  assert.equal(view.rowKeys().length, 7);
  assert.ok(view.rowKeys().includes('liv-32'));
  await view.change('Search LIV records', 'person 32');
  assert.deepEqual(view.rowKeys(), ['liv-32']);
  const pager = view.nodes().find(node => node.props.label === 'LIV records' && node.props.setPage);
  assert.equal(pager.props.page, 1);
  assert.equal(pager.props.totalCount, 1);
});

test('rapid UCO record selection renders only the latest response and gives its editor a distinct record key', async () => {
  const pending = new Map();
  const view = await mount('routes/UcoTlaReviews.tsx', 'UcoTlaReviews', { access: { canAccess: true }, academicYear: '2026/27' }, { ucoTlaDashboard: { reviews: [uco('a'), uco('b')] }, ucoTlaReview: id => new Promise(resolve => pending.set(id, resolve)) });
  const rows = view.nodes().filter(node => node.props.review && node.props.onOpen);
  rows.find(node => node.props.review.recordId === 'a').props.onOpen(); await view.flush();
  rows.find(node => node.props.review.recordId === 'b').props.onOpen(); await view.flush();
  pending.get('b')({ review: { recordId: 'b' } }); await view.flush();
  pending.get('a')({ review: { recordId: 'a' } }); await view.flush();
  const workspace = view.nodes().find(node => node.props.detail?.review);
  assert.equal(workspace.props.detail.review.recordId, 'b');
  assert.equal(workspace.key, 'b');
});


test('coaching completion directs the user to the missing field before any completion request', async () => {
  let submitted = false;
  const view = await mount('routes/CoachingMentoring.tsx', 'CoachingMentoring', { staff: [], orgUnits: [], user: { ...user, permissions: ['coaching.submit'] }, onActionsChanged: noOp }, { coachingSessions: [], coachingConfiguration: { maxActionsPerSession: 3 }, coachingContext: { cycles: [], previousActions: [], nextSessionNumber: 1, staffName: 'Alex', coachName: 'Coach' }, createCoachingSession: () => { submitted = true; return { ok: false }; } });
  await view.set('coaching-staff', 'a'); await view.click('Create session');
  let editor = view.nodes().find(node => node.props.form && node.props.onSave);
  editor.props.onSave('completed'); await view.flush();
  editor = view.nodes().find(node => node.props.form && node.props.onSave);
  assert.equal(editor.props.validationError.id, 'coaching-delivery');
  editor.props.onChange({ ...editor.props.form, deliveryMethod: 'online' }); await view.flush();
  editor = view.nodes().find(node => node.props.form && node.props.onSave);
  assert.equal(editor.props.validationError, null);
  editor.props.onSave('completed'); await view.flush();
  editor = view.nodes().find(node => node.props.form && node.props.onSave);
  assert.equal(editor.props.validationError.id, 'coaching-duration');
  assert.equal(submitted, false);
});

test('LIV uses one contextual loader and replaces it with failure feedback when the request fails', async () => {
  let rejectRecords;
  const view = await mount('routes/LivVisits.tsx', 'LivVisits', { academicYear: '2026/27', staff: [], orgUnits: [], user }, {
    livRecords: () => new Promise((_, reject) => { rejectRecords = reject; }), actions: [], livConfiguration: {}, sharedThemes: []
  });
  assert.equal(view.nodes().filter(node => node.props.label === 'Loading LIV records…').length, 1);
  assert.doesNotMatch(view.text(), /No LIV records match|No staff match/);
  rejectRecords(new Error('Unavailable')); await view.flush();
  assert.equal(view.nodes().filter(node => node.props.label === 'Loading LIV records…').length, 0);
  assert.match(view.text(), /Retry loading records/);
  assert.match(view.text(), /temporarily unavailable/);
});

test('opening a UCO review keeps the register visible and stops loading on a failed open', async () => {
  let rejectReview;
  const view = await mount('routes/UcoTlaReviews.tsx', 'UcoTlaReviews', { access: { canAccess: true }, academicYear: '2026/27' }, {
    ucoTlaDashboard: { reviews: [uco('a')] }, ucoTlaReview: () => new Promise((_, reject) => { rejectReview = reject; })
  });
  view.nodes().find(node => node.props.review?.recordId === 'a').props.onOpen(); await view.flush();
  assert.equal(view.nodes().filter(node => node.props.label === 'Opening the UCO TLA review…').length, 1);
  assert.ok(view.nodes().find(node => node.props.review?.recordId === 'a'));
  rejectReview(new Error('Unavailable')); await view.flush();
  assert.equal(view.nodes().filter(node => node.props.label === 'Opening the UCO TLA review…').length, 0);
  assert.ok(view.nodes().find(node => node.props.review?.recordId === 'a'));
  assert.ok(view.nodes().some(node => String(node.props.message).includes('could not be opened')));
});

test('ELI validation keeps the previously loaded population while refreshing and after a failed refresh', async () => {
  let rejectRefresh, call = 0;
  const records = [{ staffId: 'a', staffName: 'Alex', status: 'draft', validationStatus: 'pending' }];
  const view = await mount('routes/ElevatePractice.tsx', 'ElevatePracticeValidationView', {}, {
    elevatePracticeValidationProgress: () => ++call === 1 ? records : new Promise((_, reject) => { rejectRefresh = reject; })
  });
  await view.click('Refresh');
  assert.equal(view.nodes().filter(node => node.props.label === 'Loading programme leader validation…').length, 1);
  assert.deepEqual(view.rowKeys(), ['a']);
  rejectRefresh(new Error('Unavailable')); await view.flush();
  assert.equal(view.nodes().filter(node => node.props.label === 'Loading programme leader validation…').length, 0);
  assert.deepEqual(view.rowKeys(), ['a']);
  assert.ok(view.nodes().some(node => String(node.props.message).includes('could not be loaded')));
});

test('historical Learning Environment details retain saved inactive pillars and retired answers', async () => {
  const section = { id: 'old-section', sectionKey: 'learning_environment', title: 'Original saved pillar', displayOrder: 1,
    fields: [{ id: 'old-purpose', fieldKey: 'intended_purpose', fieldType: 'long_text', label: 'Original saved purpose label', value: 'Original purpose answer', displayValue: 'Original purpose answer' }] };
  const view = await mount('routes/ModuleWorkspace.tsx', 'ModuleWorkspace', { academicYear: '2026/27', mode: 'elevate', title: 'Learning Environment', staff: [], user: { ...user, permissions: ['elevate.submit'] } }, {
    records: [workspaceRecord('historical', { recordType: 'elevate_environment', title: 'Historical environment' })], orgUnits: [], actions: [], rooms: [],
    elevateEnvironmentPillars: [{ pillarKey: 'learning_environment', isActive: false, displayOrder: 1, rubric: [] }],
    formDefinition: { templateKey: 'elevate_learning_environments_core', sections: [] },
    recordDetail: { id: 'historical', sections: [section], submissionStatus: 'submitted', canEdit: false, recordType: 'elevate_environment' }
  });
  await view.event('Open Historical environment', 'onClick');
  assert.ok(view.nodes().some(node => node.props.title === 'Original saved pillar' && node.props.preserveTitle));
  assert.match(view.text(), /Original saved purpose label/);
  assert.match(view.text(), /Original purpose answer/);
});

test('Learning Walk only validates the conditional Other field when its control is visible', async () => {
  let submissions = 0;
  const definition = { templateKey: 'learning_walk_core', sections: [{ id: 'section', sectionKey: 'context', fields: [
    { id: 'delivery', fieldKey: 'learning_walk_delivery_area', fieldType: 'learning_walk_delivery_area', label: 'Delivery area', isRequired: true },
    { id: 'themes', fieldKey: 'additional_focus_context', fieldType: 'learning_walk_theme_group', label: 'Focus', isRequired: false },
    { id: 'other', fieldKey: 'additional_focus_other', fieldType: 'long_text', label: 'Other focus', isRequired: true }
  ] }] };
  const view = await mount('routes/ModuleWorkspace.tsx', 'ModuleWorkspace', { academicYear: '2026/27', mode: 'learning', title: 'Learning Walk', staff: [], user: { ...user, permissions: ['learning_walk.submit'] } }, {
    records: [], orgUnits: [], actions: [], formDefinition: definition, learningWalkThemes: [], coachingConfiguration: { currentPracticeRubric: [] }, learningWalkDeliveryAreas: [],
    submitForm: () => { submissions += 1; return { ok: false, message: 'Review only' }; }
  });
  await view.click('Create record');
  await view.set('workflow-create-delivery', 'classroom');
  await view.click('Submit form');
  assert.equal(submissions, 1, 'a hidden required Other question must not block the form');
  await view.set('workflow-create-themes', JSON.stringify([{ id: 'other-theme', name: 'Other', isOther: true }]));
  await view.click('Submit form');
  assert.equal(submissions, 1, 'a visible required Other question must block incomplete submission');
  const errors = view.nodes().find(node => Array.isArray(node.props.errors))?.props.errors;
  assert.ok(errors.some(error => error.id === 'workflow-create-other'));
});

const administeredForm = (status = 'Draft') => ({ templateId: 'template', templateKey: 'learning_walk_core', moduleKey: 'learning_walk', name: 'Learning Walk', description: '',
  versionId: 'version', version: '2', rowVersion: 'row-1', status, submissionCount: 0,
  sections: [{ id: 'section', sectionKey: 'context', title: 'Context', displayOrder: 1, fields: [{ id: 'core', fieldKey: 'visit_date', label: 'Visit date', fieldType: 'date', isRequired: true, isProtected: true, displayOrder: 1 }] }],
  versions: [{ id: 'version', version: '2', status, submissionCount: 0 }] });

test('version editor protects workflow semantics and retains edits when a draft save fails', async () => {
  let saved;
  const view = await mount('routes/AdminFormVersions.tsx', 'AdminFormVersions', {}, {
    formTemplates: [{ id: 'template', moduleKey: 'learning_walk', moduleName: 'Learning Walk', assignedOrgUnits: [], name: 'Learning Walk' }],
    formTemplateAdministration: administeredForm(), saveFormTemplateVersion: (...args) => { saved = args; return { ok: false, message: 'Another administrator changed this draft.' }; }
  });
  assert.equal(view.field('Answer type').props.disabled, true);
  assert.equal(view.nodes().find(node => node.props.onClick && node.props.children === 'Remove question').props.disabled, true);
  assert.equal(view.nodes().find(node => node.props.onClick && node.props.children === 'Remove section').props.disabled, true);
  await view.change('Question wording', 'When did the visit happen?');
  assert.equal(view.nodes().find(node => node.props.onClick && node.props.children === 'Publish version').props.disabled, true);
  await view.click('Save draft');
  assert.equal(saved[2].sections[0].fields[0].label, 'When did the visit happen?');
  assert.equal(saved[2].sections[0].fields[0].fieldKey, 'visit_date');
  assert.equal(saved[2].rowVersion, 'row-1');
  assert.equal(view.field('Question wording').props.value, 'When did the visit happen?');
  assert.ok(view.nodes().some(node => node.props.message === 'Another administrator changed this draft.'));
});

test('form version publishing needs its explicit final confirmation and never edits a published version', async () => {
  let published = 0;
  const view = await mount('routes/AdminFormVersions.tsx', 'AdminFormVersions', {}, {
    formTemplates: [{ id: 'template', moduleKey: 'learning_walk', moduleName: 'Learning Walk', assignedOrgUnits: [], name: 'Learning Walk' }],
    formTemplateAdministration: () => administeredForm(published ? 'Published' : 'Draft'),
    publishFormTemplateVersion: () => { published += 1; return { ok: true }; }
  });
  await view.click('Publish version');
  assert.equal(published, 0);
  const confirm = view.nodes().find(node => node.props.busy === false && node.props.onClick && node.props.children === 'Publish version');
  assert.ok(confirm); confirm.props.onClick(); await view.flush();
  assert.equal(published, 1);
  assert.equal(view.nodes().some(node => node.props.onClick && node.props.children === 'Save draft'), false);
  assert.ok(view.nodes().some(node => node.type === 'fieldset' && node.props.disabled === true));
});

test('Environment supplementary fields remain answerable in an inactive pillar and pin their template version', async () => {
  let submitted;
  const definition = { templateKey: 'elevate_learning_environments_core', versionId: 'version-3', sections: [{ id: 'pillar', sectionKey: 'old_pillar', fields: [
    { id: 'core', fieldKey: 'old_pillar_score', fieldType: 'number', isRequired: true, label: 'Old score' },
    { id: 'custom', fieldKey: 'custom_question', fieldType: 'short_text', isRequired: true, label: 'Additional evidence' }
  ] }] };
  const view = await mount('routes/ModuleWorkspace.tsx', 'ModuleWorkspace', { academicYear: '2026/27', mode: 'elevate', title: 'Learning Environment', staff: [], user: { ...user, permissions: ['elevate.submit'] } }, {
    records: [], orgUnits: [], actions: [], rooms: [], elevateEnvironmentPillars: [{ pillarKey: 'old_pillar', isActive: false, displayOrder: 1, rubric: [] }], formDefinition: definition,
    submitForm: body => { submitted = body; return { ok: false }; }
  });
  await view.click('Start Audit'); await view.click('Complete check');
  assert.equal(submitted, undefined);
  assert.ok(view.nodes().some(node => node.props.errors?.some(error => error.id === 'workflow-create-custom')));
  assert.equal(view.nodes().some(node => node.props.controlId === 'workflow-create-core'), false);
  await view.set('workflow-create-custom', 'Supplementary answer'); await view.click('Complete check');
  assert.equal(submitted.templateVersionId, 'version-3');
  assert.deepEqual(submitted.responses, [{ fieldId: 'custom', value: 'Supplementary answer' }]);
});

test('Work Scrutiny draft pins the allocated form version without requiring completed answers', async () => {
  let submitted;
  const view = await mount('components/WorkScrutinyCreateForm.tsx', 'WorkScrutinyCreateForm', { orgUnits: [], staff: [], user, onCancel: noOp, onSubmitted: noOp }, {
    learningWalkDeliveryAreas: [], workScrutinyTemplate: { templateKey: 'allocated_scrutiny', versionId: 'allocated-version', sections: [] },
    submitForm: body => { submitted = body; return { ok: false }; }
  });
  await view.change('Faculty', 'faculty'); await view.change('Sub-team', 'team'); await view.click('Save draft');
  assert.equal(submitted.templateVersionId, 'allocated-version');
  assert.equal(submitted.saveAsDraft, true);
});

test('version editor validates and normalises custom choices before saving', async () => {
  let saved, calls = 0;
  const form = administeredForm(); form.sections[0].fields = [{ id: 'extra', fieldKey: 'custom_extra', label: 'Extra choice', fieldType: 'single_select', isRequired: false, isProtected: false, displayOrder: 1, options: ['One', 'Two'] }];
  const view = await mount('routes/AdminFormVersions.tsx', 'AdminFormVersions', {}, {
    formTemplates: [{ id: 'template', moduleKey: 'learning_walk', moduleName: 'Learning Walk', assignedOrgUnits: [], name: 'Learning Walk' }], formTemplateAdministration: form,
    saveFormTemplateVersion: (...args) => { calls += 1; saved = args[2]; return { ok: false }; }
  });
  await view.change('Answer choices', 'One\none'); await view.click('Save draft');
  assert.equal(calls, 0);
  await view.change('Answer choices', '  First  \nSecond\n\n'); await view.click('Save draft');
  assert.deepEqual(saved.sections[0].fields[0].options, ['First', 'Second']);
  await view.change('Answer type', 'short_text'); await view.click('Save draft');
  assert.deepEqual(saved.sections[0].fields[0].options, []);
});

test('successful version save followed by a failed reload prevents another stale write', async () => {
  let loads = 0;
  const view = await mount('routes/AdminFormVersions.tsx', 'AdminFormVersions', {}, {
    formTemplates: [{ id: 'template', moduleKey: 'learning_walk', moduleName: 'Learning Walk', assignedOrgUnits: [], name: 'Learning Walk' }],
    formTemplateAdministration: () => { if (++loads > 1) throw new Error('Reload unavailable'); return administeredForm(); },
    saveFormTemplateVersion: () => ({ ok: true })
  });
  await view.change('Question wording', 'Saved wording'); await view.click('Save draft');
  assert.equal(view.field('Question wording').props.value, 'Saved wording');
  assert.ok(view.nodes().some(node => String(node.props.message).includes('Draft saved, but')));
  assert.equal(view.nodes().find(node => node.props.onClick && node.props.children === 'Publish version').props.disabled, true);
  assert.ok(view.nodes().some(node => node.type === 'fieldset' && node.props.disabled));
});

test('the only initial form draft cannot be discarded into an unusable template', async () => {
  const view = await mount('routes/AdminFormVersions.tsx', 'AdminFormVersions', {}, {
    formTemplates: [{ id: 'template', moduleKey: 'work_scrutiny', moduleName: 'Work Scrutiny', assignedOrgUnits: [], name: 'New scrutiny form' }],
    formTemplateAdministration: administeredForm()
  });
  assert.equal(view.nodes().find(node => node.props.onClick && node.props.children === 'Discard draft').props.disabled, true);
  assert.match(view.text(), /first version of the form/);
});

test('an unchanged empty Work Scrutiny draft can prepare its core questions once before publication', async () => {
  let prepared = false, saved, publications = 0;
  const empty = { ...administeredForm(), moduleKey: 'work_scrutiny', templateKey: 'team_scrutiny', sections: [] };
  const ready = { ...empty, rowVersion: 'prepared-row', sections: [{ id: 'workflow', sectionKey: 'workflow_context', title: 'Sample context', displayOrder: 0, fields: [
    { id: 'level', fieldKey: 'qualification_level', label: 'Course level', fieldType: 'single_select', isRequired: true, isProtected: true, displayOrder: 10, options: ['Level 1', 'Level 2'] },
    { id: 'delivery', fieldKey: 'learning_walk_delivery_area', label: 'Delivery area', fieldType: 'learning_walk_delivery_area', isRequired: true, isProtected: true, displayOrder: 20 }
  ] }] };
  const view = await mount('routes/AdminFormVersions.tsx', 'AdminFormVersions', { moduleKey: 'work_scrutiny' }, {
    formTemplates: [{ id: 'template', moduleKey: 'work_scrutiny', moduleName: 'Work Scrutiny', assignedOrgUnits: [], name: 'New scrutiny' }],
    formTemplateAdministration: () => prepared ? ready : empty,
    saveFormTemplateVersion: (...args) => { saved = args; prepared = true; return { ok: true }; },
    publishFormTemplateVersion: () => { publications++; return { ok: true }; }
  });
  const command = label => view.nodes().find(node => node.props.onClick && node.props.children === label);
  assert.match(view.text(), /Save draft once to prepare required workflow questions/);
  assert.equal(command('Save draft').props.disabled, false);
  assert.equal(command('Publish version').props.disabled, true);
  await view.click('Publish version'); assert.equal(publications, 0, 'bypassed disabled publication cannot open a premature confirmation');
  await view.click('Save draft');
  assert.equal(saved[2].rowVersion, 'row-1'); assert.deepEqual(saved[2].sections, []);
  assert.equal(command('Save draft').props.disabled, true);
  assert.equal(command('Publish version').props.disabled, false);
  assert.equal(view.field('Answer type').props.disabled, true);
  assert.doesNotMatch(view.text(), /Save draft once to prepare/);
});

test('Work Scrutiny preparation recognises each retained course-level alias and still requires delivery area', async () => {
  for (const alias of ['qualification_level', 'course_level', 'course_or_unit']) {
    const form = { ...administeredForm(), moduleKey: 'work_scrutiny', templateKey: 'team_scrutiny' };
    form.sections[0].fields = [{ ...form.sections[0].fields[0], fieldKey: alias }, { ...form.sections[0].fields[0], id: 'delivery', fieldKey: 'learning_walk_delivery_area' }];
    const view = await mount('routes/AdminFormVersions.tsx', 'AdminFormVersions', { moduleKey: 'work_scrutiny' }, {
      formTemplates: [{ id: 'template', moduleKey: 'work_scrutiny', moduleName: 'Work Scrutiny', assignedOrgUnits: [], name: 'Scrutiny' }], formTemplateAdministration: form
    });
    assert.equal(view.nodes().find(node => node.props.onClick && node.props.children === 'Publish version').props.disabled, false, alias);
    assert.equal(view.nodes().find(node => node.props.onClick && node.props.children === 'Save draft').props.disabled, true, alias);
  }
  const missingDelivery = { ...administeredForm(), moduleKey: 'work_scrutiny', templateKey: 'team_scrutiny' };
  missingDelivery.sections[0].fields[0].fieldKey = 'course_level';
  const view = await mount('routes/AdminFormVersions.tsx', 'AdminFormVersions', { moduleKey: 'work_scrutiny' }, {
    formTemplates: [{ id: 'template', moduleKey: 'work_scrutiny', moduleName: 'Work Scrutiny', assignedOrgUnits: [], name: 'Scrutiny' }], formTemplateAdministration: missingDelivery
  });
  assert.equal(view.nodes().find(node => node.props.onClick && node.props.children === 'Save draft').props.disabled, false);
  assert.equal(view.nodes().find(node => node.props.onClick && node.props.children === 'Publish version').props.disabled, true);
});

test('generic custom choice handlers save JSON, preserve pipe characters and round-trip through editing', async () => {
  const fields = [
    { id: 'multi', fieldKey: 'custom_multi', fieldType: 'multi_select', label: 'Extra multiple choice', options: ['First | choice', 'Second'], isRequired: true },
    { id: 'check', fieldKey: 'custom_check', fieldType: 'checkbox_group', label: 'Extra checklist', options: ['A', 'B'], isRequired: true },
    { id: 'legacy', fieldKey: 'cpd_themes', fieldType: 'checkbox_group', label: 'Legacy themes', options: ['Legacy A', 'Legacy B'], isRequired: false }
  ];
  const definition = { templateKey: 'cpd_core', versionId: 'answer-version', sections: [{ id: 'section', sectionKey: 'event', fields }] };
  let created, updated;
  const summary = workspaceRecord('record', { title: 'Choice draft', submissionStatus: 'draft' });
  const view = await mount('routes/ModuleWorkspace.tsx', 'ModuleWorkspace', { academicYear: '2026/27', mode: 'cpd', title: 'CPD', staff: [], user: { ...user, permissions: ['cpd.manage'] } }, {
    records: () => created ? [summary] : [], orgUnits: [], actions: [], lookups: [], formDefinition: definition,
    submitForm: body => { created = body; return { ok: true }; },
    recordDetail: () => ({ ...summary, sections: [{ ...definition.sections[0], fields: fields.map(field => ({ ...field, value: !updated && field.id === 'check' ? 'A|B' : (updated ?? created).responses.find(response => response.fieldId === field.id)?.value })) }], submissionId: 'submission', canEdit: true }),
    updateFormSubmission: (_, body) => { updated = body; return { ok: true }; }
  });
  await view.click('Log a CPD Event');
  for (const option of ['First | choice', 'Second']) await view.choose('workflow-create-multi', option);
  for (const option of ['A', 'B']) await view.choose('workflow-create-check', option);
  for (const option of ['Legacy A', 'Legacy B']) await view.choose('workflow-create-legacy', option);
  await view.click('Save draft');
  const values = Object.fromEntries(created.responses.map(response => [response.fieldId, response.value]));
  assert.deepEqual(JSON.parse(values.multi), ['First | choice', 'Second']);
  assert.deepEqual(JSON.parse(values.check), ['A', 'B']);
  assert.equal(values.legacy, 'Legacy A|Legacy B');
  await view.event('Open Choice draft', 'onClick'); await view.click('Edit');
  assert.deepEqual(view.choiceStates('workflow-edit-multi').map(choice => choice.checked), [true, true]);
  assert.deepEqual(view.choiceStates('workflow-edit-check').map(choice => choice.checked), [true, true]);
  await view.choose('workflow-edit-multi', 'Second'); await view.click('Save changes');
  assert.deepEqual(JSON.parse(updated.responses.find(response => response.fieldId === 'multi').value), ['First | choice']);
  assert.deepEqual(JSON.parse(updated.responses.find(response => response.fieldId === 'check').value), ['A', 'B'], 'older pipe answers are normalised on save even when unchanged');
});

test('generic required custom choice controls cannot submit an empty JSON selection', async () => {
  let submitted = false;
  const view = await mount('routes/ModuleWorkspace.tsx', 'ModuleWorkspace', { academicYear: '2026/27', mode: 'elevate', title: 'Environment', staff: [], user: { ...user, permissions: ['elevate.submit'] } }, {
    records: [], orgUnits: [], actions: [], rooms: [], elevateEnvironmentPillars: [],
    formDefinition: { templateKey: 'environment', versionId: 'version', sections: [{ id: 'section', sectionKey: 'custom_section', displayOrder: 1, fields: [{ id: 'choice', fieldKey: 'custom_choice', fieldType: 'multi_select', label: 'Choose evidence', options: ['A', 'B'], isRequired: true }] }] },
    submitForm: () => { submitted = true; return { ok: false }; }
  });
  await view.click('Start Audit'); await view.choose('workflow-create-choice', 'A'); await view.choose('workflow-create-choice', 'A'); await view.click('Complete check');
  assert.equal(submitted, false);
  assert.ok(view.nodes().some(node => node.props.errors?.some(error => error.id === 'workflow-create-choice')));
});

test('Work Scrutiny real custom checklist and multiple-choice handlers save JSON and validate an empty array', async () => {
  const fields = [
    { id: 'level', fieldKey: 'course_level', fieldType: 'single_select', label: 'Level', options: ['Level 1'], isRequired: true },
    { id: 'delivery', fieldKey: 'learning_walk_delivery_area', fieldType: 'single_select', label: 'Delivery', isRequired: true },
    { id: 'multi', fieldKey: 'custom_multi', fieldType: 'multi_select', label: 'Multiple evidence', options: ['One | item', 'Two'], isRequired: true },
    { id: 'check', fieldKey: 'custom_check', fieldType: 'checkbox_group', label: 'Checklist evidence', options: ['A', 'B'], isRequired: true }
  ];
  let submitted;
  const view = await mount('components/WorkScrutinyCreateForm.tsx', 'WorkScrutinyCreateForm', { orgUnits: [], staff: [], user, onCancel: noOp, onSubmitted: noOp }, {
    learningWalkDeliveryAreas: [], workScrutinyTemplate: { templateKey: 'scrutiny', versionId: 'version', sections: [{ id: 'section', fields }] },
    submitForm: body => { submitted = body; return { ok: false }; }
  });
  await view.change('Faculty', 'faculty'); await view.change('Sub-team', 'team');
  for (const option of ['One | item', 'Two']) await view.choose('scrutiny-field-multi', option);
  for (const option of ['A', 'B']) await view.choose('scrutiny-field-check', option);
  await view.click('Save draft');
  assert.deepEqual(JSON.parse(submitted.responses.find(response => response.fieldId === 'multi').value), ['One | item', 'Two']);
  assert.deepEqual(JSON.parse(submitted.responses.find(response => response.fieldId === 'check').value), ['A', 'B']);
  assert.deepEqual(view.choiceStates('scrutiny-field-multi').map(choice => choice.checked), [true, true]);
  await view.choose('scrutiny-field-check', 'A'); await view.choose('scrutiny-field-check', 'B');
  await view.click('Complete scrutiny');
  assert.ok(view.nodes().some(node => node.props.errors?.some(error => error.id === 'scrutiny-field-check')));
});

test('Environment entry renders schema section titles and order instead of current pillar catalogue wording', async () => {
  const sections = [
    { id: 'room', sectionKey: 'room_context', title: 'Saved room wording', displayOrder: 3, fields: [{ id: 'room-note', fieldKey: 'custom_room', fieldType: 'short_text', label: 'Room note' }] },
    { id: 'pillar', sectionKey: 'pillar', title: 'Admin renamed pillar', displayOrder: 1, fields: [{ id: 'extra', fieldKey: 'custom_extra', fieldType: 'short_text', label: 'Additional context' }] },
    { id: 'custom', sectionKey: 'custom_section', title: 'Supplementary questions', displayOrder: 2, fields: [{ id: 'custom-field', fieldKey: 'custom_third', fieldType: 'short_text', label: 'Third question' }] }
  ];
  const view = await mount('routes/ModuleWorkspace.tsx', 'ModuleWorkspace', { academicYear: '2026/27', mode: 'elevate', title: 'Environment', staff: [], user: { ...user, permissions: ['elevate.submit'] } }, {
    records: [], orgUnits: [], actions: [], rooms: [], elevateEnvironmentPillars: [{ pillarKey: 'pillar', isActive: true, name: 'Live catalogue name', displayOrder: 99, rubric: [] }],
    formDefinition: { templateKey: 'environment', versionId: 'version', sections }
  });
  await view.click('Start Audit');
  const headers = view.nodes().filter(node => node.type?.name === 'EnvironmentPillarHeader');
  assert.deepEqual(headers.map(header => header.props.title), ['Admin renamed pillar', 'Supplementary questions', 'Saved room wording']);
  assert.match(view.renderNodeText(headers[0]), /Admin renamed pillar/);
  assert.doesNotMatch(view.renderNodeText(headers[0]), /Live catalogue name/);
  assert.ok(view.nodes().some(node => node.props.controlId === 'workflow-create-extra'));
});

function browserForGuardTest(t) {
  const previous = globalThis.window;
  globalThis.window = { confirm: () => true, requestAnimationFrame: () => 1, cancelAnimationFrame: noOp };
  t.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; });
}

test('generic form exit callbacks discard without saving, save a partial draft and validate formal submission', async t => {
  browserForGuardTest(t);
  const requests = [];
  let shouldSave = false;
  const definition = { templateKey: 'cpd_core', versionId: 'exit-version', sections: [{ id: 'section', fields: [
    { id: 'answer', fieldKey: 'custom_answer', fieldType: 'short_text', label: 'Required evidence', isRequired: true },
    { id: 'note', fieldKey: 'custom_note', fieldType: 'short_text', label: 'Note' }
  ] }] };
  const view = await mount('routes/ModuleWorkspace.tsx', 'ModuleWorkspace', { academicYear: '2026/27', mode: 'cpd', title: 'CPD', staff: [], user: { ...user, permissions: ['cpd.manage'] } }, {
    navigationDecision: false, records: [], orgUnits: [], actions: [], lookups: [], formDefinition: definition,
    submitForm: body => { requests.push(body); return { ok: shouldSave, message: 'Save rejected' }; }
  });
  await view.click('Log a CPD Event'); await view.set('workflow-create-note', 'Unfinished note');
  await view.click('Cancel'); assert.equal(view.navigationChecks(), 1); assert.equal(requests.length, 0);
  assert.ok(view.nodes().some(node => node.props.controlId === 'workflow-create-note' && node.props.value === 'Unfinished note'));
  assert.equal(view.guards().find(editor => editor.label === 'CPD event').submission, true);
  assert.equal(await view.runGuard('CPD event', 'onSubmit'), false);
  assert.equal(requests.length, 0, 'formal exit uses the actual required-field validation');
  assert.equal(await view.runGuard('CPD event', 'onSave'), false);
  assert.equal(requests[0].saveAsDraft, true);
  assert.ok(view.nodes().some(node => node.props.controlId === 'workflow-create-note' && node.props.value === 'Unfinished note'));
  await view.runGuard('CPD event', 'onDiscard');
  assert.equal(requests.length, 1, 'discard never creates a draft or a submission');
  await view.click('Log a CPD Event');
  assert.ok(view.nodes().some(node => node.props.controlId === 'workflow-create-note' && node.props.value === ''));
  await view.set('workflow-create-note', 'Partial saved draft'); shouldSave = true;
  assert.equal(await view.runGuard('CPD event', 'onSave'), true);
  assert.equal(requests.at(-1).saveAsDraft, true);
  await view.click('Log a CPD Event'); await view.set('workflow-create-answer', 'Complete evidence');
  assert.equal(await view.runGuard('CPD event', 'onSubmit'), true);
  assert.equal(requests.at(-1).saveAsDraft, false);
  assert.equal(requests.at(-1).templateVersionId, 'exit-version');
});

test('edited draft formal exit saves current answers before submitting and retains them after status rejection', async t => {
  browserForGuardTest(t);
  const operations = [];
  let persisted = 'Saved answer', allowSave = false, allowStatus = false;
  const summary = workspaceRecord('existing', { title: 'Existing draft', submissionStatus: 'draft' });
  const definition = { templateKey: 'cpd_core', versionId: 'version', sections: [{ id: 'section', fields: [
    { id: 'answer', fieldKey: 'custom_answer', fieldType: 'short_text', label: 'Evidence', isRequired: true }
  ] }] };
  const view = await mount('routes/ModuleWorkspace.tsx', 'ModuleWorkspace', { academicYear: '2026/27', mode: 'cpd', title: 'CPD', staff: [], user: { ...user, permissions: ['cpd.manage'] } }, {
    records: [summary], orgUnits: [], actions: [], lookups: [],
    recordDetail: () => ({ ...summary, sections: [{ ...definition.sections[0], fields: [{ ...definition.sections[0].fields[0], value: persisted }] }], submissionId: 'existing-submission', canEdit: true }),
    updateFormSubmission: (id, body) => { operations.push(['save', id]); if (allowSave) persisted = body.responses[0].value; return { ok: allowSave }; },
    changeSubmissionStatus: (id, status) => { operations.push([status, id]); return { ok: allowStatus, message: 'Formal submission rejected' }; }
  });
  await view.event('Open Existing draft', 'onClick'); await view.click('Edit');
  await view.set('workflow-edit-answer', '');
  assert.equal(await view.runGuard('CPD event', 'onSubmit'), false);
  assert.deepEqual(operations, []);
  await view.set('workflow-edit-answer', 'Unsaved formal evidence');
  assert.equal(await view.runGuard('CPD event', 'onSubmit'), false);
  assert.deepEqual(operations, [['save', 'existing-submission']], 'a failed answer save never attempts formal submission');
  assert.equal(persisted, 'Saved answer');
  operations.length = 0; allowSave = true;
  assert.equal(await view.runGuard('CPD event', 'onSubmit'), false);
  assert.deepEqual(operations, [['save', 'existing-submission'], ['submit', 'existing-submission']]);
  assert.equal(persisted, 'Unsaved formal evidence');
  assert.ok(view.nodes().some(node => node.props.controlId === 'workflow-edit-answer' && node.props.value === persisted));
  assert.equal(view.guards().find(editor => editor.label === 'CPD event').dirty, true, 'failed formal transition remains retryable');
  allowStatus = true;
  assert.equal(await view.runGuard('CPD event', 'onSubmit'), true);
  assert.equal(operations.length, 4);
  assert.equal(view.nodes().some(node => node.props.controlId === 'workflow-edit-answer'), false);
});

test('Work Scrutiny exit callbacks preserve partial draft payloads and require valid answers for completion', async () => {
  const requests = [], opened = [];
  let saved = false, cancelled = false;
  const fields = [
    { id: 'level', fieldKey: 'qualification_level', fieldType: 'single_select', label: 'Level', options: ['Level 1'], isRequired: true },
    { id: 'delivery', fieldKey: 'learning_walk_delivery_area', fieldType: 'single_select', label: 'Delivery', isRequired: true },
    { id: 'answer', fieldKey: 'custom_evidence', fieldType: 'long_text', label: 'Evidence', isRequired: true }
  ];
  const view = await mount('components/WorkScrutinyCreateForm.tsx', 'WorkScrutinyCreateForm', { orgUnits: [], staff: [], user, onCancel: () => { cancelled = true; }, onSubmitted: async (...args) => opened.push(args) }, {
    navigationDecision: false, learningWalkDeliveryAreas: [], workScrutinyTemplate: { templateKey: 'scrutiny', versionId: 'allocated-version', sections: [{ id: 'section', fields }] },
    submitForm: body => { requests.push(body); return { ok: saved, data: { recordId: 'saved-record' } }; }
  });
  await view.change('Faculty', 'faculty'); await view.change('Sub-team', 'team');
  const beforeCancel = view.navigationChecks(); await view.click('Cancel');
  assert.equal(view.navigationChecks(), beforeCancel + 1); assert.equal(cancelled, false); assert.equal(requests.length, 0);
  assert.equal(await view.runGuard('Work Scrutiny', 'onSubmit'), false);
  assert.equal(requests.length, 0);
  assert.equal(await view.runGuard('Work Scrutiny', 'onSave'), false);
  assert.equal(requests[0].saveAsDraft, true);
  await view.runGuard('Work Scrutiny', 'onDiscard'); assert.equal(requests.length, 1);
  saved = true;
  assert.equal(await view.runGuard('Work Scrutiny', 'onSave'), true);
  assert.deepEqual(opened, [['saved-record', true]]);
  for (const [id, value] of [['level', 'Level 1'], ['delivery', 'Health'], ['answer', 'Complete evidence']]) {
    view.nodes().find(node => node.props.field?.id === id).props.onChange(value); await view.flush();
  }
  assert.equal(await view.runGuard('Work Scrutiny', 'onSubmit'), true);
  assert.equal(requests.at(-1).saveAsDraft, false);
  assert.equal(requests.at(-1).templateVersionId, 'allocated-version');
  assert.deepEqual(opened.at(-1), ['saved-record', false]);
});

test('coaching exit callbacks use draft and completed lifecycles without saving discarded conversations', async t => {
  browserForGuardTest(t);
  const requests = [];
  let saved = false;
  const view = await mount('routes/CoachingMentoring.tsx', 'CoachingMentoring', { staff: [], orgUnits: [], user: { ...user, permissions: ['coaching.submit'] }, onActionsChanged: noOp }, {
    navigationDecision: false, coachingSessions: [], coachingConfiguration: { maxActionsPerSession: 3 }, coachingContext: { cycles: [], previousActions: [], nextSessionNumber: 1, staffName: 'Alex', coachName: 'Coach' },
    createCoachingSession: body => { requests.push(body); return { ok: saved, data: { id: 'saved-session' } }; },
    coachingSession: () => { throw new Error('Read-back unavailable'); }
  });
  await view.set('coaching-staff', 'a'); await view.click('Create session');
  const editor = () => view.nodes().find(node => node.props.form && node.props.onSave);
  editor().props.onChange({ ...editor().props.form, conversationSummary: 'Unfinished conversation' }); await view.flush();
  editor().props.onBack(); await view.flush(); assert.equal(view.navigationChecks(), 1);
  assert.equal(editor().props.form.conversationSummary, 'Unfinished conversation'); assert.equal(requests.length, 0);
  assert.equal(await view.runGuard('Coaching and mentoring session', 'onSubmit'), false);
  assert.equal(requests.length, 0);
  assert.equal(await view.runGuard('Coaching and mentoring session', 'onSave'), false);
  assert.equal(requests[0].status, 'draft');
  await view.runGuard('Coaching and mentoring session', 'onDiscard');
  assert.equal(requests.length, 1); assert.equal(editor().props.form.conversationSummary, undefined);
  editor().props.onChange({ ...editor().props.form, conversationSummary: 'Partial conversation' }); await view.flush(); saved = true;
  assert.equal(await view.runGuard('Coaching and mentoring session', 'onSave'), true);
  assert.equal(requests.at(-1).status, 'draft');
  editor().props.onChange({ ...editor().props.form, deliveryMethod: 'online', durationMinutes: 30, qualificationStatusKey: 'qualified', primaryFocusKey: 'planning', specificSessionFocus: 'Sequencing', supportTypes: ['discussion'], conversationSummary: 'Completed conversation', closeCycle: true }); await view.flush();
  assert.equal(await view.runGuard('Coaching and mentoring session', 'onSubmit'), true);
  assert.equal(requests.at(-1).status, 'completed');
  assert.equal(requests.at(-1).closeCycle, true);
});

test('ELI exit callbacks save incomplete ratings only as draft and submit complete ratings for validation', async t => {
  browserForGuardTest(t);
  const requests = [];
  let saved = false;
  const workspace = { staffId: 'a', staffName: 'Alex', academicYear: '2026/27', status: 'draft', canEdit: true,
    areas: [{ id: 'area', name: 'Planning', statements: [{ id: 'statement', text: 'Evidence' }] }], ratingScale: [], livInformation: { focusOptions: [] } };
  const view = await mount('routes/ElevatePractice.tsx', 'ElevatePractice', { user: { ...user, permissions: ['records.manage'] }, onActionsChanged: noOp }, {
    navigationDecision: false, elevatePracticeMe: workspace,
    saveElevatePractice: body => { requests.push(body); return { ok: saved, data: { ...workspace, status: body.submit ? 'submitted' : 'draft', livInformation: body.livInformation, areas: [{ ...workspace.areas[0], statements: [{ ...workspace.areas[0].statements[0], descriptorId: body.ratings[0]?.descriptorId }] }] } }; }
  });
  const editor = () => view.nodes().find(node => node.props.draft && node.props.onChange && node.props.onSubmit);
  editor().props.onChange({ ...editor().props.draft, livInformation: { desiredOutcome: 'Unfinished assessment' } }); await view.flush();
  await view.click('Programme leader validation'); assert.equal(view.navigationChecks(), 1); assert.equal(requests.length, 0);
  assert.equal(editor().props.draft.livInformation.desiredOutcome, 'Unfinished assessment');
  assert.equal(await view.runGuard('Elevate Learning and Innovation assessment', 'onSubmit'), false);
  assert.equal(requests.length, 0);
  assert.equal(await view.runGuard('Elevate Learning and Innovation assessment', 'onSave'), false);
  assert.equal(requests[0].submit, false);
  await view.runGuard('Elevate Learning and Innovation assessment', 'onDiscard');
  assert.equal(requests.length, 1); assert.equal(editor().props.draft.livInformation.desiredOutcome, undefined);
  editor().props.onChange({ ...editor().props.draft, livInformation: { desiredOutcome: 'Partial assessment' } }); await view.flush(); saved = true;
  assert.equal(await view.runGuard('Elevate Learning and Innovation assessment', 'onSave'), true);
  assert.equal(requests.at(-1).submit, false);
  editor().props.onChange({ ...editor().props.draft, ratings: { statement: 'descriptor' } }); await view.flush();
  assert.equal(await view.runGuard('Elevate Learning and Innovation assessment', 'onSubmit'), true);
  assert.equal(requests.at(-1).submit, true);
  assert.deepEqual(requests.at(-1).ratings, [{ areaId: 'area', statementId: 'statement', descriptorId: 'descriptor' }]);
});

test('linked action exit never offers a draft API and creates only through the validated formal callback', async t => {
  browserForGuardTest(t);
  const requests = [];
  const summary = workspaceRecord('source', { title: 'Action source' });
  const view = await mount('routes/ModuleWorkspace.tsx', 'ModuleWorkspace', { academicYear: '2026/27', mode: 'cpd', title: 'CPD', staff: [], user: { ...user, permissions: ['cpd.manage', 'actions.manage'] } }, {
    records: [summary], orgUnits: [], actions: [], lookups: [], recordDetail: { ...summary, sections: [], submissionId: 'submission', canEdit: true },
    createAction: body => { requests.push(body); return { ok: true }; }
  });
  await view.event('Open Action source', 'onClick'); await view.click('Linked action');
  await view.set('linked-action-theme-source', 'Planning');
  assert.equal(view.guards().find(editor => editor.label === 'Linked action').onSave, undefined);
  assert.equal(await view.runGuard('Linked action', 'onSubmit'), false);
  await view.runGuard('Linked action', 'onDiscard'); assert.equal(requests.length, 0);
  await view.click('Linked action'); await view.set('linked-action-theme-source', 'Planning');
  view.nodes().find(node => node.type === 'textarea').props.onChange({ target: { value: 'Plan retrieval' } }); await view.flush();
  assert.equal(await view.runGuard('Linked action', 'onSubmit'), true);
  assert.equal(requests[0].sourceRecordId, 'source'); assert.equal(requests[0].title, 'Plan retrieval');
});

test('standalone action exit cannot masquerade creation as a draft and discarding sends no request', async t => {
  browserForGuardTest(t);
  const requests = [];
  const view = await mount('routes/ActionsView.tsx', 'ActionsView', { academicYear: '2026/27', actions: [], staff: [], orgUnits: [], user: { ...user, permissions: ['actions.manage'] }, onChanged: async () => {} }, {
    actionOwnerOptions: [], actions: [], createAction: body => { requests.push(body); return { ok: true }; }
  });
  const setAction = async value => { view.nodes().find(node => node.props.content?.label === 'Action' && node.props.onChange).props.onChange(value); await view.flush(); };
  await view.click('Create action'); await setAction('Unfinished action');
  const guard = view.guards().find(editor => editor.label === 'Action changes');
  assert.equal(guard.submission, true); assert.equal(guard.onSave, undefined); assert.equal(guard.submitLabel, 'Create action');
  assert.equal(await view.runGuard('Action changes', 'onSubmit'), false);
  await view.runGuard('Action changes', 'onDiscard'); assert.equal(requests.length, 0);
  await view.click('Create action'); await setAction('Plan retrieval'); await view.set('standalone-action-theme', 'Planning'); await view.change('Date to be implemented by', '2026-11-30');
  assert.equal(await view.runGuard('Action changes', 'onSubmit'), true);
  assert.equal(requests.length, 1); assert.equal(requests[0].title, 'Plan retrieval'); assert.equal(requests[0].ownerStaffId, user.staffId);
});
