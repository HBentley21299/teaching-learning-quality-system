import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const requireWeb = createRequire(new URL('../apps/web/package.json', import.meta.url));
const ts = requireWeb('typescript'), react = requireWeb('react'), jsx = requireWeb('react/jsx-runtime');
const { renderToStaticMarkup } = requireWeb('react-dom/server');
async function load(path, modules = {}) {
  const source = await readFile(new URL(`../apps/web/src/${path}`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'exports', 'module', compiled)(name => { assert.ok(name in modules, `Unexpected import ${name}`); return modules[name]; }, module.exports, module);
  return module.exports;
}
const helpers = await load('services/csvImportPresentation.ts');
const listQuery = await load('services/listQuery.ts');
const loadingState = await load('components/LoadingState.tsx', { 'react/jsx-runtime': jsx });
const { AdminListSort } = await load('components/AdminListSort.tsx', { 'react/jsx-runtime': jsx });
const admin = { isAdministrator: true, userAccountId: 'admin', displayName: 'Administrator', permissions: ['qa_reviews.manage', 'cpd.manage', 'lists.manage'], scopes: [] };
const metadata = kind => ({ kind, title: `Import ${kind}`, description: 'A server-defined import.', columns: [{ key: 'reference', label: 'Stable reference', required: true, description: 'Keep this reference.', example: 'EXAMPLE' }, { key: 'question_text', label: 'Server question wording', required: true, description: 'Current server-defined wording column.', example: 'Example criterion' }], notes: ['Existing data is retained.'], references: [{ label: 'Activity values', columns: ['Code', 'Name'], rows: [['lesson_visit', 'Lesson visit']] }] });
const csv = 'reference,question_text\r\nA1,"A criterion, with comma\nand a new line"\r\n';
const preview = (kind = 'qa-questions', overrides = {}) => ({ kind, rowsRead: 1, createCount: 1, skipCount: 0, rows: [{ rowNumber: 2, reference: 'A1', operation: 'create', values: { reference: 'A1', question_text: 'A criterion, with comma\nand a new line' } }], issues: [], canImport: true, previewToken: 'token-A1', ...overrides });
const csvFile = (contents = csv, name = 'questions.csv') => { const bytes = new TextEncoder().encode(contents); return { name, size: bytes.byteLength, arrayBuffer: async () => bytes.buffer }; };

test('import permissions require the administrator flag plus the correct kind capability', () => {
  for (const kind of ['qa-questions', 'cpd-events', 'managed-list-values']) assert.equal(helpers.canUseAdminCsvImport({ ...admin, isAdministrator: false }, kind), false);
  assert.equal(helpers.canUseAdminCsvImport(undefined, 'qa-questions'), false);
  assert.equal(helpers.canUseAdminCsvImport({ ...admin, permissions: ['users.manage'] }, 'qa-questions'), false);
  assert.equal(helpers.canUseAdminCsvImport({ ...admin, permissions: ['cpd.mandatory_log'] }, 'cpd-events'), true);
});

test('UTF-8 file reading preserves quoted commas and multiline fields, and enforces file limits without guessing row structure', async () => {
  assert.equal(await helpers.readCsvImportFile(csvFile('\uFEFF' + csv)), csv);
  await assert.rejects(helpers.readCsvImportFile(csvFile(csv, 'questions.xlsx')), /CSV file/);
  await assert.rejects(helpers.readCsvImportFile({ ...csvFile(), size: 1024 * 1024 + 1 }), /1 MiB/);
  await assert.rejects(helpers.readCsvImportFile(csvFile('')), /empty/);
  await assert.rejects(helpers.readCsvImportFile({ name: 'bad.csv', size: 2, arrayBuffer: async () => new Uint8Array([0xff, 0xfe]).buffer }), /UTF-8/);
});

test('error and reference downloads quote cells and neutralise spreadsheet formulas', () => {
  const downloaded = helpers.csvImportDownloadText(['Row', 'Message'], [[2, '=HYPERLINK("bad")'], [3, ' @SUM(1,2)'], [4, 'A comma, and "quote"\nnext line']]);
  assert.ok(downloaded.startsWith('\uFEFF')); assert.match(downloaded, /"'=HYPERLINK\(""bad""\)"/); assert.match(downloaded, /"' @SUM\(1,2\)"/);
  assert.match(downloaded, /"A comma, and ""quote""\nnext line"/);
});

async function importer(initialProps = { kind: 'qa-questions', user: admin }, responses = {}) {
  let props = initialProps, tree, cursor = 0, pending = true;
  const slots = [], effects = [], calls = [], downloads = [], guards = new Map();
  const hooks = {
    useState(initial) { const slot = cursor++; if (!(slot in slots)) slots[slot] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[slot].value, update => { const next = typeof update === 'function' ? update(slots[slot].value) : update; if (!Object.is(next, slots[slot].value)) { slots[slot].value = next; pending = true; } }]; },
    useRef(initial) { const slot = cursor++; if (!(slot in slots)) slots[slot] = { current: initial }; return slots[slot]; },
    useMemo(factory, deps) { const slot = cursor++, previous = slots[slot]; if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index]))) slots[slot] = { deps, value: factory() }; return slots[slot].value; },
    useEffect(effect, deps) { const slot = cursor++, previous = slots[slot]; if (!previous || !deps || deps.some((value, index) => !Object.is(value, previous.deps[index]))) { slots[slot] = { deps }; effects.push(() => { previous?.cleanup?.(); slots[slot].cleanup = effect(); }); } }
  };
  const Button = ({ icon, variant, children, ...rest }) => react.createElement('button', rest, children);
  const ModalDialog = ({ children, label }) => react.createElement('div', { role: 'dialog', 'aria-label': label }, children);
  const defaults = { csvImportMetadata: kind => metadata(kind), csvImportTemplate: () => ({ ok: true }), previewCsvImport: kind => ({ ok: true, data: preview(kind) }), applyCsvImport: () => ({ ok: true, data: { batchId: 'batch-1', createdCount: 1, skippedCount: 0, message: 'Batch created.' } }) };
  const api = new Proxy({}, { get: (_, name) => (...args) => { calls.push([name, ...args]); const answer = Object.hasOwn(responses, name) ? responses[name] : defaults[name]; assert.notEqual(answer, undefined, `Unexpected API call ${name}`); return Promise.resolve().then(() => typeof answer === 'function' ? answer(...args) : structuredClone(answer)); } });
  const { AdminCsvImport } = await load('routes/AdminCsvImport.tsx', {
    react: hooks, 'react/jsx-runtime': jsx, 'lucide-react': new Proxy({}, { get: () => () => null }),
    '../design-system/Button': { Button }, '../components/ModalDialog': { ModalDialog }, '../components/CollapsibleSection': { Pagination: () => null },
    '../services/listQuery': listQuery, '../components/AdminListSort': { AdminListSort },
    '../components/ScrollableTableRegion': { ScrollableTableRegion: ({ children }) => react.createElement('div', { className: 'table-shell' }, children) },
    '../components/LoadingState': loadingState,
    '../components/UnsavedChangesGuard': { useUnsavedChanges: config => { guards.set(config.label, config); return () => {}; } },
    '../services/api': { api }, '../services/csvImportPresentation': { ...helpers, saveCsvImportDownload: (...args) => downloads.push(args) }
  });
  function nodes() { const result = []; function walk(node) { if (Array.isArray(node)) return node.forEach(walk); if (!node || typeof node !== 'object') return; result.push(node); walk(node.props?.children); if (node.type === AdminListSort) walk(AdminListSort(node.props)); } walk(tree); return result; }
  async function settle() { for (let round = 0; round < 40; round++) { if (pending) { pending = false; cursor = 0; tree = AdminCsvImport(props); } while (effects.length) effects.shift()(); await new Promise(resolve => setImmediate(resolve)); if (!pending && !effects.length) return; } throw new Error('Import UI did not settle'); }
  await settle();
  return { calls, downloads, guards, nodes, settle, markup: () => renderToStaticMarkup(tree),
    async selectFile(file) { const input = nodes().find(node => node.type === 'input' && node.props.type === 'file'); assert.ok(input); assert.ok(!input.props.disabled); input.props.ref.current = { value: file?.name ?? '' }; input.props.onChange({ target: { files: file ? [file] : [] } }); await settle(); },
    async click(label) { const button = nodes().find(node => (node.type === Button || node.type === 'button') && text(node.props.children) === label); assert.ok(button, `Missing button ${label}`); assert.ok(!button.props.disabled, `Disabled ${label}`); await button.props.onClick(); await settle(); },
    async change(label, value) { const node = nodes().find(node => node.props?.['aria-label'] === label); assert.ok(node, `Missing input ${label}`); node.props.onChange({ target: { value } }); await settle(); },
    async rerender(next) { props = next; pending = true; await settle(); }
  };
}
function text(value) { return Array.isArray(value) ? value.map(text).join('') : value?.props ? text(value.props.children) : value == null || typeof value === 'boolean' ? '' : String(value); }

test('unauthorised managers cannot fetch import definitions or use the upload workflow', async () => {
  const page = await importer({ kind: 'qa-questions', user: { ...admin, isAdministrator: false } });
  assert.match(page.markup(), /CSV import unavailable/); assert.equal(page.calls.length, 0); assert.equal(page.nodes().some(node => node.props?.type === 'file'), false);
});

test('preview sorting and search use every parsed row before pagination without changing the submitted CSV', async () => {
  const allRows = Array.from({ length: 25 }, (_, index) => ({ rowNumber: index + 2, reference: `ref-${String(25 - index).padStart(2, '0')}`, operation: 'create', values: { reference: `ref-${String(25 - index).padStart(2, '0')}`, question_text: index === 24 ? 'Historical criterion with café' : `Criterion ${index}` } }));
  const page = await importer(undefined, { previewCsvImport: { ok: true, data: preview('qa-questions', { rowsRead: 25, createCount: 25, rows: allRows }) } });
  await page.selectFile(csvFile()); await page.click('Check and preview CSV');
  assert.doesNotMatch(page.markup(), /<td>ref-01<\/td>/);
  await page.change('Sort by', 'reference-asc');
  assert.match(page.markup(), /<td>ref-01<\/td>/); assert.doesNotMatch(page.markup(), /<td>ref-25<\/td>/);
  await page.change('Search CSV preview rows', 'cafe historical');
  assert.match(page.markup(), /1 matching preview rows/); assert.match(page.markup(), /<td>ref-01<\/td>/);
  assert.deepEqual(allRows.map(row => row.rowNumber), Array.from({ length: 25 }, (_, index) => index + 2));
  assert.deepEqual(page.calls.find(call => call[0] === 'previewCsvImport'), ['previewCsvImport', 'qa-questions', csv]);
  assert.equal(page.calls.some(call => call[0] === 'applyCsvImport'), false);
});

test('metadata drives columns and reference downloads, and preview sends the exact uploaded CSV without mutations', async () => {
  const page = await importer();
  assert.match(page.markup(), /Server question wording/); assert.match(page.markup(), /Current server-defined wording column/);
  await page.click('Download reference values'); assert.match(page.downloads[0][1], /lesson_visit/);
  await page.selectFile(csvFile()); await page.click('Check and preview CSV');
  assert.deepEqual(page.calls.find(call => call[0] === 'previewCsvImport'), ['previewCsvImport', 'qa-questions', csv]);
  assert.equal(page.calls.some(call => call[0] === 'applyCsvImport'), false);
  assert.equal(page.guards.get('CSV import preview').onSave, undefined, 'Save-and-leave must never commit an import');
  assert.equal(page.guards.get('CSV import preview').dirty, true);
  assert.match(page.markup(), /A criterion, with comma/);
});

test('apply requires the final confirmation and clears staged data and dirty state after success', async () => {
  const destinations = [], page = await importer({ kind: 'qa-questions', user: admin, onOpenDestination: path => destinations.push(path) });
  await page.selectFile(csvFile()); await page.click('Check and preview CSV'); await page.click('Review and confirm import');
  assert.match(page.markup(), /Confirm this import/); assert.equal(page.calls.some(call => call[0] === 'applyCsvImport'), false);
  await page.click('Import 1 new entry');
  assert.deepEqual(page.calls.find(call => call[0] === 'applyCsvImport'), ['applyCsvImport', 'qa-questions', csv, 'token-A1']);
  assert.match(page.markup(), /Import completed/); assert.doesNotMatch(page.markup(), /Confirm this import|Review the import/);
  assert.equal(page.guards.get('CSV import preview').dirty, false); assert.equal(page.guards.get('CSV import preview').saving, false);
  await page.click('Open question bank'); assert.deepEqual(destinations, ['/qa-hub/admin/questions']);
});

test('row errors block confirmation, expose corrective messages and produce a safe issues download', async () => {
  const bad = preview('qa-questions', { createCount: 0, canImport: false, previewToken: null, issues: [{ rowNumber: 2, column: 'question_text', severity: 'error', message: 'Question is required.' }], rows: [{ rowNumber: 2, reference: 'A1', operation: 'error', values: { reference: 'A1', question_text: '=SUM(1,2)' } }] });
  const page = await importer(undefined, { previewCsvImport: { ok: true, data: bad } });
  await page.selectFile(csvFile()); await page.click('Check and preview CSV');
  assert.match(page.markup(), /Question is required/);
  const confirm = page.nodes().find(node => typeof node.props?.onClick === 'function' && text(node.props?.children) === 'Review and confirm import'); assert.equal(confirm.props.disabled, true);
  await page.change('Filter CSV preview rows', 'errors'); assert.match(page.markup(), /1 matching preview rows/);
  await page.click('Download row issues'); assert.match(page.downloads.at(-1)[1], /"'=SUM\(1,2\)"/); assert.equal(page.calls.some(call => call[0] === 'applyCsvImport'), false);
});

test('changing the selected file invalidates a pending preview and never reuses its confirmation token', async () => {
  let resolveFirst;
  const old = new Promise(resolve => { resolveFirst = resolve; });
  const page = await importer(undefined, { previewCsvImport: (_kind, contents) => contents === csv ? old : { ok: true, data: preview('qa-questions', { previewToken: 'token-NEW' }) } });
  await page.selectFile(csvFile()); await page.click('Check and preview CSV');
  const replacement = 'reference,question_text\nNEW,Replacement question\n';
  await page.selectFile(csvFile(replacement, 'replacement.csv'));
  resolveFirst({ ok: true, data: preview() }); await page.settle();
  assert.doesNotMatch(page.markup(), /Review the import/); assert.equal(page.calls.some(call => call[0] === 'applyCsvImport'), false);
  await page.click('Check and preview CSV'); await page.click('Review and confirm import'); await page.click('Import 1 new entry');
  assert.deepEqual(page.calls.find(call => call[0] === 'applyCsvImport'), ['applyCsvImport', 'qa-questions', replacement, 'token-NEW']);
});

test('a slower first file read cannot replace a newer selection', async () => {
  let finishRead;
  const pending = new Promise(resolve => { finishRead = resolve; });
  const page = await importer();
  await page.selectFile({ name: 'slow.csv', size: 20, arrayBuffer: () => pending });
  const replacement = 'reference,question_text\nFAST,Newest file\n';
  await page.selectFile(csvFile(replacement, 'fast.csv'));
  finishRead(new TextEncoder().encode(csv).buffer); await page.settle();
  await page.click('Check and preview CSV');
  assert.deepEqual(page.calls.find(call => call[0] === 'previewCsvImport'), ['previewCsvImport', 'qa-questions', replacement]);
  assert.match(page.markup(), /fast.csv/); assert.doesNotMatch(page.markup(), /slow.csv/);
});

test('rapid duplicate confirmation gestures send one batch and lock the file during apply', async () => {
  let finishApply;
  const pending = new Promise(resolve => { finishApply = resolve; });
  const page = await importer(undefined, { applyCsvImport: () => pending });
  await page.selectFile(csvFile()); await page.click('Check and preview CSV'); await page.click('Review and confirm import');
  const confirm = page.nodes().find(node => typeof node.props?.onClick === 'function' && text(node.props.children) === 'Import 1 new entry');
  confirm.props.onClick(); confirm.props.onClick(); await page.settle();
  assert.equal(page.calls.filter(call => call[0] === 'applyCsvImport').length, 1);
  assert.equal(page.nodes().find(node => node.type === 'input' && node.props.type === 'file').props.disabled, true);
  assert.equal(page.guards.get('CSV import preview').saving, true);
  finishApply({ ok: true, data: { batchId: 'single-batch', createdCount: 1, skippedCount: 0, message: 'One batch created.' } }); await page.settle();
  assert.match(page.markup(), /One batch created/); assert.equal(page.guards.get('CSV import preview').saving, false);
});

test('failed preview and failed apply remain retryable with the exact same file and signed token', async () => {
  let checks = 0, applies = 0;
  const page = await importer(undefined, { previewCsvImport: kind => ++checks === 1 ? { ok: false, message: 'Preview service unavailable.' } : { ok: true, data: preview(kind) }, applyCsvImport: () => ++applies === 1 ? { ok: false, message: 'Connection interrupted. Retry this batch.' } : { ok: true, data: { batchId: 'recovered', createdCount: 1, skippedCount: 0, message: 'Batch recovered.' } } });
  await page.selectFile(csvFile()); await page.click('Check and preview CSV'); assert.match(page.markup(), /Preview service unavailable/);
  await page.click('Check and preview CSV'); await page.click('Review and confirm import'); await page.click('Import 1 new entry');
  assert.match(page.markup(), /Connection interrupted/); assert.equal(page.guards.get('CSV import preview').dirty, true);
  await page.click('Import 1 new entry');
  const applyCalls = page.calls.filter(call => call[0] === 'applyCsvImport'); assert.equal(applyCalls.length, 2); assert.deepEqual(applyCalls[0], applyCalls[1]); assert.match(page.markup(), /Batch recovered/);
});

test('stale metadata and previews are hidden when changing import kind or administrator identity', async () => {
  let resolveOld;
  const pending = new Promise(resolve => { resolveOld = resolve; });
  const page = await importer(undefined, { csvImportMetadata: kind => kind === 'qa-questions' ? pending : metadata(kind) });
  await page.rerender({ kind: 'managed-list-values', user: admin }); resolveOld(metadata('qa-questions')); await page.settle();
  assert.match(page.markup(), /Import managed-list-values/); assert.doesNotMatch(page.markup(), /Import qa-questions/);
  await page.rerender({ kind: 'managed-list-values', user: { ...admin, isAdministrator: false } }); assert.match(page.markup(), /CSV import unavailable/);
});

test('CPD attendance effects are information notes and remain concrete in the final confirmation', async () => {
  const effect = 'Assessment workshop: 3 attendees; mandatory attendance earns 0 Elevate credits.';
  const page = await importer({ kind: 'cpd-events', user: admin }, { previewCsvImport: { ok: true, data: preview('cpd-events', { rowsRead: 3, skipCount: 1, issues: [{ rowNumber: 2, column: 'event_reference', severity: 'info', message: effect }] }) } });
  await page.selectFile(csvFile()); await page.click('Check and preview CSV');
  assert.match(page.markup(), />Info<\/td>/); assert.match(page.markup(), /0 warnings · 1 notes/);
  await page.click('Review and confirm import');
  assert.match(page.markup(), /Attendance effects/); assert.ok(page.markup().includes(effect)); assert.match(page.markup(), /1 existing entry will be skipped/);
  assert.equal(page.calls.some(call => call[0] === 'applyCsvImport'), false);
});
