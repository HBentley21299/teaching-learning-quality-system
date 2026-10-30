import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const web = createRequire(new URL('../apps/web/package.json', import.meta.url));
const ts = web('typescript'), jsx = web('react/jsx-runtime'), react = web('react');
const { renderToStaticMarkup } = web('react-dom/server');
const icons = new Proxy({}, { get: () => () => null });
const text = node => Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : node == null || typeof node === 'boolean' ? '' : String(node);
async function load(path, imports = {}) {
  const source = await readFile(new URL(`../apps/web/src/${path}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'exports', 'module', code)(name => { assert.ok(name in imports, `Unexpected import ${name}`); return imports[name]; }, module.exports, module);
  return module.exports;
}
const listQuery = await load('services/listQuery.ts');
const loadingState = await load('components/LoadingState.tsx', { 'react/jsx-runtime': jsx });

async function mount(path, name, initialProps, { dialog, scrollArea, extraImports = {}, refFor } = {}) {
  let props = initialProps, tree, cursor = 0, changed = true;
  const slots = [], effects = [];
  const hooks = {
    useState(initial) { const slot = cursor++; if (!(slot in slots)) slots[slot] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[slot].value, update => { const next = typeof update === 'function' ? update(slots[slot].value) : update; if (!Object.is(next, slots[slot].value)) { slots[slot].value = next; changed = true; } }]; },
    useRef(initial) { const slot = cursor++; if (!(slot in slots)) slots[slot] = { current: initial }; return slots[slot]; },
    useId() { const slot = cursor++; return `test-${slot}`; },
    useMemo(factory, deps) { const slot = cursor++, previous = slots[slot]; if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index]))) slots[slot] = { deps, value: factory() }; return slots[slot].value; },
    useEffect(effect, deps) { const slot = cursor++, previous = slots[slot]; if (!previous || !deps || deps.some((value, index) => !Object.is(value, previous.deps?.[index]))) { slots[slot] = { deps }; effects.push(() => { previous?.cleanup?.(); slots[slot].cleanup = effect(); }); } }
  };
  const navigation = await load('components/useComboboxNavigation.ts', { react: hooks });
  const imports = { react: hooks, 'react/jsx-runtime': jsx, 'lucide-react': icons, '../services/listQuery': listQuery, './useComboboxNavigation': navigation, './LoadingState': loadingState, ...extraImports };
  const Component = (await load(path, imports))[name];
  function nodes() { const result = []; function visit(node) { if (Array.isArray(node)) return node.forEach(visit); if (!node || typeof node !== 'object') return; result.push(node); visit(node.props?.children); } visit(tree); return result; }
  function settle() {
    for (let attempt = 0; attempt < 30; attempt++) {
      if (changed) {
        cursor = 0; changed = false; tree = Component(props);
        for (const node of nodes()) {
          if (node.props?.ref && node.type === 'dialog' && dialog) node.props.ref.current = dialog;
          if (node.props?.ref && node.props.className?.includes('data-table-scroll') && scrollArea) node.props.ref.current = scrollArea;
          if (node.props?.ref && refFor) {
            const target = refFor(node);
            if (target) node.props.ref.current = target;
          }
        }
      }
      while (effects.length) effects.shift()();
      if (!changed && !effects.length) return;
    }
    throw new Error('Component did not settle');
  }
  settle();
  const control = label => nodes().find(node => node.props?.['aria-label'] === label);
  return {
    nodes, control, settle, markup: () => renderToStaticMarkup(tree),
    async flush() { for (let attempt = 0; attempt < 5; attempt++) { await new Promise(resolve => setImmediate(resolve)); settle(); } },
    update(next) { props = { ...props, ...next }; changed = true; settle(); },
    change(label, value) { const node = control(label); assert.ok(node, `Missing ${label}`); node.props.onChange({ target: { value } }); settle(); },
    focus(label) { control(label).props.onFocus(); settle(); },
    key(label, key, extra = {}) { let prevented = false, stopped = false; control(label).props.onKeyDown({ key, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; }, ...extra }); settle(); return { prevented, stopped }; },
    unmount() { for (const slot of slots) slot?.cleanup?.(); }
  };
}
const staff = (id, displayName) => ({ id, displayName, externalId: `EMP-${id}`, email: `${id}@college.test`, jobTitle: 'Teacher', orgUnitIds: [] });

test('staff selection can be browsed without clearing it, typing is preserved, and popup-only controls disappear on Escape', async () => {
  const changes = [], people = [staff('a', 'Alex One'), staff('b', 'Beth Two')];
  const page = await mount('components/StaffSearchSelect.tsx', 'StaffSearchSelect', { id: 'owner', label: 'Review owner', staff: people, value: 'a', 'aria-invalid': true, 'aria-required': true, 'aria-describedby': 'owner-error', onChange: id => changes.push(id) });
  assert.equal(page.control('Review owner').props.value, 'Alex One');
  assert.equal(page.control('Review owner').props['aria-describedby'], 'owner-help owner-error');
  assert.equal(page.control('Review owner').props['aria-required'], true);
  assert.equal(page.control('Review owner').props['aria-invalid'], true);
  assert.equal(page.control('Review owner results sort'), undefined);
  page.focus('Review owner');
  assert.deepEqual(changes, [], 'opening the directory retains the current selection');
  assert.equal(page.nodes().filter(node => node.props?.role === 'option').length, 2);
  page.change('Review owner', 'Beth');
  assert.equal(page.control('Review owner').props.value, 'Beth', 'selected value must not overwrite a live search');
  assert.deepEqual(changes, ['']);
  page.update({ value: '' });
  assert.equal(page.control('Review owner').props.value, 'Beth');
  assert.deepEqual(page.key('Review owner', 'Escape'), { prevented: true, stopped: true });
  assert.equal(page.control('Review owner').props['aria-expanded'], false);
  assert.equal(page.control('Review owner').props['aria-controls'], undefined);
  assert.equal(page.control('Review owner results sort'), undefined);
  page.unmount();
});

test('action themes show loading, retain historical values and recover after a failed request', async () => {
  let reject, retryResolve;
  const initial = new Promise((_, b) => { reject = b; }), retry = new Promise(a => { retryResolve = a; });
  const calls = [];
  const api = { actionThemes(source) { calls.push(source); return calls.length === 1 ? initial : retry; } };
  const page = await mount('components/ActionThemeSelect.tsx', 'ActionThemeSelect', { id: 'theme', sourceFormType: 'liv', value: 'Historical theme', onChange() { assert.fail('Loading must not change a saved theme'); } }, { extraImports: { '../services/api': { api } } });
  assert.match(page.markup(), /Loading themes/); assert.match(page.markup(), /Historical theme/);
  assert.equal(page.nodes().find(node => node.type === 'select').props.disabled, true);
  reject(new Error('network interrupted')); await page.flush();
  assert.match(page.markup(), /could not be loaded/);
  const retryButton = page.nodes().find(node => node.type === 'button' && text(node) === 'Try again');
  assert.ok(retryButton); retryButton.props.onClick(); page.settle();
  retryResolve([{ id: 'current', displayName: 'Current theme' }]); await page.flush();
  assert.deepEqual(calls, ['liv', 'liv']);
  assert.equal(page.nodes().find(node => node.type === 'select').props.disabled, false);
  assert.match(page.markup(), /Historical theme \(existing\)/); assert.match(page.markup(), /Current theme/);
  assert.doesNotMatch(page.markup(), /could not be loaded|Loading themes/);
  page.unmount();
});

test('Word export errors release the busy button and permit a retry instead of leaving the control disabled', async () => {
  const calls = [];
  const Button = ({ children, busy, icon, variant, ...props }) => react.createElement('button', { ...props, disabled: busy || props.disabled }, children);
  const ModalDialog = ({ children }) => react.createElement('div', null, children);
  const api = { async exportRecordWord(recordId) { calls.push(recordId); if (calls.length === 1) throw new Error('network'); return { ok: true }; } };
  const page = await mount('components/ExportButtons.tsx', 'ExportWordButton', { recordId: 'record-a' }, { extraImports: { 'react-dom': { createPortal: children => children }, '../design-system/Button': { Button }, '../services/api': { api }, './ModalDialog': { ModalDialog } } });
  const button = () => page.nodes().find(node => node.type === Button);
  button().props.onClick(); page.settle(); assert.equal(button().props.busy, true);
  await page.flush(); assert.equal(button().props.busy, false); assert.match(page.markup(), /could not be created/);
  button().props.onClick(); await page.flush();
  assert.deepEqual(calls, ['record-a', 'record-a']); assert.doesNotMatch(page.markup(), /could not be created/);
  page.unmount();
});

test('report menu supports arrow-key entry, wraps between formats, cancels locally and closes on focus leaving', async () => {
  const previousDocument = globalThis.document, focused = [];
  globalThis.document = { activeElement: null };
  const target = name => ({ name, focus() { focused.push(name); globalThis.document.activeElement = this; } });
  const trigger = target('trigger'), first = target('pdf'), last = target('xlsx');
  const menu = { contains(value) { return value === first || value === last; } };
  const Button = () => null, ModalDialog = () => null;
  try {
    const page = await mount('components/ExportButtons.tsx', 'ReportButton', { scopeKey: 'liv', downloadReport: async () => ({ ok: true }) }, { refFor(node) {
      if (node.props.role === 'menu') return menu;
      if (node.props.role === 'menuitem') return text(node).startsWith('PDF') ? first : last;
      if (node.props.className?.includes('qa-report-trigger')) return trigger;
    }, extraImports: { 'react-dom': { createPortal: children => children }, '../design-system/Button': { Button }, '../services/api': { api: {} }, './ModalDialog': { ModalDialog } } });
    const triggerNode = () => page.nodes().find(node => node.props?.className?.includes('qa-report-trigger'));
    const wrapper = () => page.nodes().find(node => node.props?.className === 'qa-report-menu');
    triggerNode().props.onKeyDown({ key: 'ArrowUp', preventDefault() {} }); page.settle();
    assert.equal(focused.at(-1), 'xlsx'); assert.equal(triggerNode().props['aria-expanded'], true);
    wrapper().props.onKeyDown({ key: 'ArrowDown', target: last, preventDefault() {} });
    assert.equal(focused.at(-1), 'pdf');
    wrapper().props.onKeyDown({ key: 'End', target: first, preventDefault() {} }); assert.equal(focused.at(-1), 'xlsx');
    let stopped = false;
    wrapper().props.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() { stopped = true; } }); page.settle();
    assert.equal(stopped, true); assert.equal(focused.at(-1), 'trigger'); assert.equal(triggerNode().props['aria-expanded'], false);
    triggerNode().props.onClick(); page.settle();
    wrapper().props.onBlur({ currentTarget: { contains() { return false; } }, relatedTarget: {} }); page.settle();
    assert.equal(triggerNode().props['aria-expanded'], false);
    page.unmount();
  } finally { globalThis.document = previousDocument; }
});

test('room keyboard browsing starts at the last result with ArrowUp and scrolls the actual active option into view', async () => {
  const previousDocument = globalThis.document, scrolled = [], changes = [];
  globalThis.document = { getElementById(id) { return { scrollIntoView(options) { scrolled.push([id, options]); } }; } };
  try {
    const rooms = [{ id: 'r1', roomCode: 'Room 1', buildingName: 'Science' }, { id: 'r2', roomCode: 'Room 2', buildingName: 'Science' }];
    const page = await mount('components/RoomSearchSelect.tsx', 'RoomSearchSelect', { id: 'room', rooms, value: 'Room 1', onChange: value => changes.push(value) });
    page.focus('Room');
    assert.equal(page.nodes().filter(node => node.props?.role === 'option').length, 2, 'a formatted saved label must not exclude all results');
    page.key('Room', 'ArrowUp');
    assert.equal(page.control('Room').props['aria-activedescendant'], 'room-options-r2');
    assert.deepEqual(scrolled.at(-1), ['room-options-r2', { block: 'nearest' }]);
    page.key('Room', 'Enter');
    assert.deepEqual(changes, ['Room 2']);
    assert.equal(page.control('Room').props['aria-expanded'], false);
    page.unmount();
  } finally { globalThis.document = previousDocument; }
});

test('course labels resolve, no-match Enter cannot submit a form, and Escape closes only the popup', async () => {
  const changes = [];
  const page = await mount('components/CourseMultiSelect.tsx', 'CourseMultiSelect', { id: 'course-field', courses: [{ id: 'course-a', courseCode: 'C1', courseName: 'Science', orgUnitId: 'team' }], selectedIds: ['historical'], onChange: ids => changes.push(ids) });
  assert.equal(page.control('Search courses').props.id, 'course-field');
  page.change('Search courses', 'missing');
  assert.deepEqual(page.key('Search courses', 'Enter'), { prevented: true, stopped: false });
  assert.deepEqual(changes, []);
  assert.equal(page.key('Search courses', 'Tab').prevented, false, 'sorting stays reachable through normal Tab navigation');
  assert.deepEqual(page.key('Search courses', 'Escape'), { prevented: true, stopped: true });
  assert.deepEqual(page.key('Search courses', 'Escape'), { prevented: false, stopped: false }, 'a second Escape can reach its parent dialog');
  page.change('Search courses', ''); page.key('Search courses', 'ArrowDown'); page.key('Search courses', 'Enter');
  assert.deepEqual(changes.at(-1), ['historical', 'course-a']);
  page.update({ disabled: true });
  assert.equal(page.control('Search courses').props['aria-expanded'], false);
  assert.equal(page.nodes().some(node => node.props?.role === 'listbox'), false);
  page.unmount();
});

test('participant keyboard selection keeps historical selections and per-group additions use the full scoped directory', async () => {
  const changes = [], people = [staff('a', 'Alex'), staff('b', 'Beth')].map(person => ({ ...person, orgUnitIds: ['team'] }));
  const page = await mount('components/CpdParticipantPicker.tsx', 'CpdParticipantPicker', { id: 'participants', value: 'historical|a', staff: people, orgUnits: [{ id: 'team', code: 'SCI', name: 'Science', orgUnitType: 'team', isActive: true }], onChange: value => changes.push(value) });
  page.focus('Search participants'); page.key('Search participants', 'ArrowUp'); page.key('Search participants', 'Enter');
  assert.equal(changes.at(-1), 'historical|a|b');
  assert.equal(page.control('Search participants').props['aria-expanded'], false);
  page.change('Add participants by faculty or sub-team', 'team');
  assert.equal(changes.at(-1), 'historical|a|b');
  page.unmount();
});

test('native dialogs respect safe initial focus, busy cancellation and focus restoration', async () => {
  const previousDocument = globalThis.document, events = [], origin = { isConnected: true, focus(options) { events.push(['restore', options]); } };
  globalThis.document = { activeElement: origin };
  const dialog = { open: false, showModal() { this.open = true; events.push('show'); }, close() { this.open = false; events.push('close'); }, querySelector(selector) { assert.match(selector, /data-dialog-initial-focus/); return { focus(options) { events.push(['initial', options]); } }; } };
  try {
    let closed = 0;
    const page = await mount('components/ModalDialog.tsx', 'ModalDialog', { label: 'Preferences', className: 'preferences-dialog', onClose() { closed++; }, children: react.createElement('h2', { tabIndex: -1, 'data-dialog-heading': true }, 'Preferences') }, { dialog });
    assert.equal(dialog.open, true); assert.equal(events[0], 'show'); assert.equal(events[1][0], 'initial');
    assert.match(page.markup(), /class="app-dialog preferences-dialog"/);
    let prevented = false;
    page.nodes().find(node => node.type === 'dialog').props.onCancel({ preventDefault() { prevented = true; } });
    assert.equal(closed, 1); assert.equal(prevented, true);
    page.update({ busy: true });
    page.nodes().find(node => node.type === 'dialog').props.onCancel({ preventDefault() {} });
    assert.equal(closed, 1); assert.match(page.markup(), /aria-busy="true"/);
    page.unmount(); assert.equal(dialog.open, false); assert.equal(events.at(-1)[0], 'restore');
  } finally { globalThis.document = previousDocument; }
});

test('collapsible sections remain usable with blocked browser storage and always reference an existing target', async () => {
  const previousWindow = globalThis.window;
  globalThis.window = { sessionStorage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } } };
  try {
    const expanded = [];
    const page = await mount('components/CollapsibleSection.tsx', 'CollapsibleSection', { storageKey: 'test', title: 'Records', children: 'Private record content', onExpandedChange: value => expanded.push(value) });
    const toggle = () => page.nodes().find(node => node.type === 'button');
    const target = () => page.nodes().find(node => node.props?.id === toggle().props['aria-controls']);
    assert.ok(target()); assert.equal(target().props.hidden, true);
    assert.doesNotMatch(page.markup(), /Private record content/);
    toggle().props.onClick(); page.settle();
    assert.equal(target().props.hidden, false); assert.match(page.markup(), /Private record content/);
    assert.deepEqual(expanded, [false, true]);
    page.update({ isLoading: true }); assert.equal(target().props['aria-busy'], true);
    page.unmount();
  } finally { globalThis.window = previousWindow; }
});

test('tables expose meaningful headers, captions and an empty state', async () => {
  const ScrollableTableRegion = ({ children }) => react.createElement('div', null, children);
  const props = { columns: [{ key: 'name', header: 'Name', render: row => row.name }], rows: [], rowKey: row => row.id, caption: 'Staff actions', emptyMessage: 'No actions match this view.' };
  const page = await mount('components/DataTable.tsx', 'DataTable', props, { extraImports: { './ScrollableTableRegion': { ScrollableTableRegion } } });
  assert.match(page.markup(), /scope="col"/); assert.match(page.markup(), /<caption class="sr-only">Staff actions/);
  assert.match(page.markup(), /No actions match this view/);
  page.update({ rows: [{ id: 'a', name: 'Alex' }] });
  assert.doesNotMatch(page.markup(), /No actions match this view/);
  page.unmount();
});

test('table containers become keyboard scroll regions only when the contents overflow', async () => {
  const previousWindow = globalThis.window;
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  try {
    const scrollArea = { clientWidth: 200, scrollWidth: 600, firstElementChild: {} };
    const children = react.createElement('table', null, react.createElement('tbody', null));
    const page = await mount('components/ScrollableTableRegion.tsx', 'ScrollableTableRegion', { children, label: 'Staff actions' }, { scrollArea });
    assert.equal(page.nodes()[0].props.tabIndex, 0); assert.equal(page.nodes()[0].props.role, 'region');
    scrollArea.scrollWidth = 100; page.update({ children: react.createElement('table') });
    assert.equal(page.nodes()[0].props.tabIndex, undefined); assert.equal(page.nodes()[0].props.role, undefined);
    page.unmount();
  } finally { globalThis.window = previousWindow; }
});

test('home is a purposeful, permission-filtered start and workspace buttons do not reload the current area', async () => {
  const navigation = await load('app/navigation.ts', { 'lucide-react': icons });
  const { Home } = await load('routes/Home.tsx', { 'react/jsx-runtime': jsx, 'lucide-react': icons, '../app/navigation': navigation });
  const home = renderToStaticMarkup(react.createElement(Home, { user: { displayName: 'Harry Example' }, tiles: [{ key: 'profile', label: 'Staff Profile' }, { key: 'actions', label: 'Actions' }], onNavigate() {} }));
  assert.match(home, /Choose an area to get started/); assert.match(home, /aria-label="Work areas"/);
  assert.doesNotMatch(home, /coffee|lucky|<canvas|Admin Centre|Learning Walks/);
  assert.equal((home.match(/<strong>Staff Profile<\/strong>/g) ?? []).length, 1);
  const selected = [];
  const page = await mount('components/WorkspaceSwitch.tsx', 'WorkspaceSwitch', { active: 'elevate', compact: true, onChange: value => selected.push(value) });
  const buttons = page.nodes().filter(node => node.type === 'button');
  buttons[0].props.onClick(); assert.deepEqual(selected, []);
  buttons[1].props.onClick(); assert.deepEqual(selected, ['qa']);
  assert.equal(buttons[0].props['aria-current'], 'true');
});

test('administration overview has one searchable group directory and focused tasks precede optional browsing', async () => {
  const settingsSearch = await load('app/adminSettingsSearch.ts');
  const selected = [], focused = [];
  const entries = [
    { key: 'overview', group: 'Home', label: 'Administration', description: 'Choose a setting.' },
    { key: 'questions', group: 'Evidence forms', label: 'Questions', description: 'Maintain review criteria.' },
    { key: 'labels', group: 'Evidence forms', label: 'Outcome labels', description: 'Change outcome wording.' },
    { key: 'access', group: 'Participation', label: 'Form access', description: 'Choose permitted staff.' }
  ];
  const page = await mount('components/AdminSettingsLayout.tsx', 'AdminSettingsLayout', {
    title: 'QA administration', description: 'Find the setting.', entries, activeKey: 'overview', storageKey: 'test', onSelect: key => selected.push(key), children: react.createElement('button', null, 'Task editor')
  }, { extraImports: { '../app/adminSettingsSearch': settingsSearch }, refFor: node => node.type === 'h1' ? { focus() { focused.push(text(node)); } } : undefined });
  assert.equal(page.nodes().filter(node => node.type === 'aside').length, 0, 'overview must not repeat the directory as a sidebar');
  assert.equal(page.nodes().filter(node => node.type === 'details' && node.props.className?.includes('admin-task-group')).length, 2);
  assert.equal((page.markup().match(/<h3>Evidence forms<\/h3>/g) ?? []).length, 1);
  page.change('Search QA administration', 'wording');
  assert.match(page.markup(), /1 setting found/); assert.match(page.markup(), /Outcome labels/); assert.doesNotMatch(page.markup(), /Choose permitted staff/);
  page.nodes().find(node => node.type === 'button' && text(node).startsWith('Outcome labels')).props.onClick();
  assert.deepEqual(selected, ['labels']);
  page.update({ activeKey: 'labels' });
  const workbench = page.nodes().find(node => node.props?.className === 'admin-workbench');
  const children = workbench.props.children.filter(Boolean);
  assert.equal(children[0].props.className, 'admin-workspace', 'task comes before browse controls in DOM and narrow layout');
  assert.equal(children[1].type, 'aside');
  assert.equal(page.nodes().filter(node => node.props?.['aria-label'] === 'Admin sections').length, 1);
  assert.equal(page.nodes().filter(node => node.props?.['aria-label'] === 'Setting location').length, 1);
  assert.deepEqual(focused, ['QA administration', 'Outcome labels']);
  page.unmount();
});
