import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';
const web = createRequire(new URL('../apps/web/package.json', import.meta.url));
const ts = web('typescript'), React = web('react'), jsx = web('react/jsx-runtime'), { renderToStaticMarkup } = web('react-dom/server');
async function load(path, modules = {}) { const source = await readFile(new URL(`../apps/web/src/${path}`, import.meta.url), 'utf8'), module = { exports: {} }; new Function('require', 'exports', 'module', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText)(name => modules[name] ?? {}, module.exports, module); return module.exports; }
const actionState = await load('services/dashboardActionState.ts');
const model = await load('services/processIntelligence.ts', { './dashboardActionState': actionState });
const record = (id, processKey, extra = {}) => ({ id, processKey, title: `${id} review`, status: 'submitted', createdAt: '2026-10-01', recordDate: '2026-10-01', areaName: 'Applied studies', areaCode: 'AS', ownerDisplayName: 'Review Owner', submitterDisplayName: 'Named Submitter', participantCount: 0, learningMinutes: 0, attendanceCredits: 0, sampleSize: 0, scoreTotal: 0, scoreCount: 0, scoreMaximum: 5, barrierCount: 0, ...extra });
const fact = (recordId, dimensionKey, seriesKey, valueLabel = 'Secure', extra = {}) => ({ sourceRecordId: recordId, processKey: 'learning_walk', dimensionKey, seriesKey, seriesLabel: seriesKey, valueKey: valueLabel.toLowerCase(), valueLabel, numericValue: 3, occurredOn: '2026-10-01', ...extra });
const base = (processKey, records = [record('a', processKey)]) => ({ processKey, records, facts: [], actions: [] });
const choices = value => value.breakdowns.flatMap(group => group.choices);

test('all leadership process families expose their own meaningful chart grain and record/staff navigation', () => {
  const expected = { overview: 'process', learning_walk: 'delivery', als_learning_walk: 'delivery', liv: 'journey', als_liv: 'journey', eli: 'submission', probation_case: 'probation', elevate_environment: 'barriers', coaching_session: 'focus', work_scrutiny: 'course', cpd_event: 'attendance', elevate_status: 'levels' };
  for (const [processKey, key] of Object.entries(expected)) {
    const input = { ...base(processKey), facts: [fact('a', processKey === 'work_scrutiny' ? 'course_level' : 'focus', 'Assessment')], eliStaff: [{ staffId: 's', staffName: 'Alex', hasSubmitted: false }], statusStaff: [{ staffId: 's', staffName: 'Alex', currentLevel: 2, currentLevelName: 'Storyteller', qualifyingAttendanceCount: 7, sessionsToNextLevel: 2 }], lifecycle: [{ orgUnitId: 'area', areaName: 'Area', requestedCount: 3, caseStartedCount: 2, scheduledCount: 2, visitedCount: 1, completedCount: 0, completedVisitCount: 2, practitionerStaffCount: 1, practitionerStaffDenominator: 4 }] };
    const result = model.processIntelligenceModel(input);
    assert.ok(result.breakdowns.some(group => group.key === key), `${processKey} needs ${key}`);
    assert.equal(result.rows.records[0]?.recordId, 'a');
    assert.match(result.rows.records[0]?.person ?? '', /Named Submitter/);
    assert.ok(result.metrics.every(metric => metric.kind && Array.isArray(metric.ids)), `${processKey} clickable cohorts carry explicit identifiers`);
  }
});

test('focus selections and outcome response counts do not multiply records or include statement scores twice', () => {
  const records = [record('a', 'learning_walk'), record('b', 'learning_walk')];
  const focus = fact('a', 'focus', 'Assessment');
  const result = model.processIntelligenceModel({ ...base('learning_walk', records), facts: [focus, focus, fact('a', 'focus', 'Feedback'), fact('b', 'focus', 'Assessment'), fact('a', 'focus_outcome', 'Assessment'), fact('a', 'focus_outcome', 'Feedback'), fact('a', 'focus_statement_outcome', 'Assessment::statement'), fact('b', 'focus_outcome', 'Assessment', 'Not observed', { numericValue: undefined })] });
  const assessment = choices(result).find(row => row.key === 'focus:focus:Assessment');
  assert.equal(assessment.value, 2); assert.deepEqual(assessment.ids, ['a', 'b']);
  const ratings = result.breakdowns.find(group => group.key === 'ratings').choices;
  assert.equal(ratings.find(row => row.label === 'Secure').value, 2);
  assert.deepEqual(ratings.find(row => row.label === 'Secure').ids, ['a']);
  assert.equal(ratings.find(row => row.label === 'Not observed').value, 1);
  const explored = model.exploreProcessIntelligence(result, { ...model.emptyProcessExploration, choice: ratings[0].key });
  assert.equal(explored.rows.length, 1, 'two ratings in the same record still open one record');
});

test('LIV uses cumulative case totals and annual organisation rows without inventing individual case stages', () => {
  const input = { ...base('liv'), lifecycle: [{ orgUnitId: 'area', areaName: 'Area', requestedCount: 8, caseStartedCount: 6, scheduledCount: 5, visitedCount: 3, completedCount: 1, completedVisitCount: 4, practitionerStaffCount: 3, practitionerStaffDenominator: 8 }] };
  const result = model.processIntelligenceModel(input), stage = choices(result).find(row => row.key === 'journey:visitedCount');
  assert.equal(stage.value, 3); assert.equal(result.progress.value, 50); assert.match(result.progress.detail, /4 completed visit forms/);
  const explored = model.exploreProcessIntelligence(result, { ...model.emptyProcessExploration, choice: stage.key });
  assert.equal(explored.kind, 'areas'); assert.deepEqual(explored.rows.map(row => row.id), ['area']); assert.equal(explored.rows[0].recordId, undefined);
  assert.equal(model.processIntelligenceModel({ ...base('liv'), lifecycle: [] }).progress.value, null);
  assert.equal(model.processIntelligenceModel({ ...input, lifecycle: [{ ...input.lifecycle[0], caseStartedCount: 0 }] }).progress.value, null);
  assert.equal(choices(model.processIntelligenceModel({ ...input, processKey: 'als_liv' })).some(row => row.key === 'journey:requestedCount'), false);
});

test('repeated observation responses within the same probation case retain response grain and one-record drilldown', () => {
  const response = fact('case', 'focus_outcome', 'Assessment', 'Secure', { processKey: 'probation_case' });
  const result = model.processIntelligenceModel({ ...base('probation_case', [record('case', 'probation_case', { sampleSize: 2, subjectStaffId: 'staff' })]), facts: [response, { ...response }] });
  const ratings = result.breakdowns.find(group => group.key === 'ratings').choices;
  assert.equal(ratings[0].value, 2, 'each observation response remains present even with identical case, focus and answer');
  assert.deepEqual(ratings[0].ids, ['case']);
  assert.equal(model.exploreProcessIntelligence(result, { ...model.emptyProcessExploration, choice: ratings[0].key }).rows.length, 1);
});

test('probation milestones count unique staff at their highest observation count and keep unidentified cases separate', () => {
  const records = [record('early', 'probation_case', { subjectStaffId: 's', subjectDisplayName: 'Alex', sampleSize: 1 }), record('latest', 'probation_case', { subjectStaffId: 's', subjectDisplayName: 'Alex', sampleSize: 3 }), record('unknown', 'probation_case', { sampleSize: 0 }), record('other-unknown', 'probation_case', { sampleSize: 2 })];
  const result = model.processIntelligenceModel(base('probation_case', records));
  assert.equal(result.rows.staff.length, 3); assert.equal(result.progress.value, 33);
  const stage = choices(result).find(row => row.key === 'probation:3'); assert.equal(stage.value, 1);
  const explored = model.exploreProcessIntelligence(result, { ...model.emptyProcessExploration, choice: stage.key });
  assert.deepEqual(explored.rows.map(row => row.recordId), ['latest']);
});

test('ELI, CPD and Elevate distinguish annual named staff from record cohorts and preserve native denominators', () => {
  const eli = model.processIntelligenceModel({ ...base('eli'), eliStaff: [{ staffId: 's1', staffName: 'Submitted', hasSubmitted: true, assessmentRecordId: 'outside-record-date' }, { staffId: 's2', staffName: 'Pending', hasSubmitted: false }] });
  assert.equal(eli.progress.value, 50); assert.equal(eli.metrics[0].value, 2); assert.equal(eli.rows.records.length, 1);
  const cpd = model.processIntelligenceModel({ ...base('cpd_event', [record('a', 'cpd_event', { participantCount: 12, learningMinutes: 720 })]), cpdStaff: [{ staffId: 's', staffName: 'Repeat attendee', attendanceCount: 4 }, { staffId: 'zero', staffName: 'Eligible non-attendee', attendanceCount: 0 }], participation: { activeStaffCount: 8, participatingStaffCount: 2 } });
  assert.equal(cpd.metrics.find(row => row.key === 'cpd:attendances').value, 12); assert.equal(cpd.metrics.find(row => row.key === 'cpd:hours').value, 12); assert.equal(cpd.progress.value, 25);
  assert.equal(choices(cpd).find(row => row.key === 'attendance:4').value, 1); assert.match(cpd.note, /not narrowed by event dates/);
  assert.equal(choices(cpd).find(row => row.key === 'attendance:0').value, 1); assert.equal(cpd.metrics.find(row => row.key === 'cpd:staff').value, 1);
  assert.equal(model.processIntelligenceModel(base('cpd_event')).progress.value, null);
  const status = model.processIntelligenceModel({ ...base('elevate_status', []), statusStaff: [{ staffId: 's1', staffName: 'Champion', currentLevel: 4, currentLevelName: 'Champion', qualifyingAttendanceCount: 12, sessionsToNextLevel: 3 }, { staffId: 's2', staffName: 'Explorer', currentLevel: 1, currentLevelName: 'Explorer', qualifyingAttendanceCount: 5, sessionsToNextLevel: 1 }] });
  assert.equal(choices(status).filter(row => row.key.startsWith('level:')).reduce((sum, row) => sum + row.value, 0), 2, 'exclusive levels count every person exactly once');
  assert.equal(status.metrics.find(row => row.key === 'status:next').value, 1); assert.match(status.note, /cumulative badge thresholds/);
});

test('environment barriers use review counts, scrutiny uses sample counts and coaching uses distinct associated staff', () => {
  const environment = model.processIntelligenceModel(base('elevate_environment', [record('a', 'elevate_environment', { barrierCount: 5 }), record('b', 'elevate_environment', { barrierCount: 1 }), record('c', 'elevate_environment')]));
  assert.equal(environment.metrics.find(row => row.key === 'barriers:yes').value, 2); assert.match(environment.metrics[1].detail, /6 barriers/);
  const scrutiny = model.processIntelligenceModel(base('work_scrutiny', [record('a', 'work_scrutiny', { sampleSize: 8 }), record('b', 'work_scrutiny', { sampleSize: 5 })])); assert.equal(scrutiny.metrics[1].value, 13);
  const coaching = model.processIntelligenceModel(base('coaching_session', [record('a', 'coaching_session', { subjectStaffId: 's' }), record('b', 'coaching_session', { subjectStaffId: 's' })])); assert.equal(coaching.metrics[1].value, 1); assert.equal(coaching.metrics[1].ids.length, 2);
});

test('configuration hides disabled outcome/area/action data and cancelled actions never become overdue attention', () => {
  const actions = [{ id: 'cancelled', title: 'Cancelled', sourceRecordId: 'a', statusKey: 'cancelled', isOverdue: true, ownerStaffId: 'owner' }, { id: 'late', title: 'Late', sourceRecordId: 'a', statusKey: 'open', isOverdue: true, ownerStaffId: 'owner' }];
  const result = model.processIntelligenceModel({ ...base('learning_walk'), facts: [fact('a', 'focus_outcome', 'Feedback')], actions });
  assert.equal(result.metrics.find(row => row.key === 'overdue-actions').value, 1); assert.deepEqual(result.attention.map(row => row.id), ['late']);
  const hidden = model.processIntelligenceModel({ ...base('learning_walk'), actions, facts: [fact('a', 'focus_outcome', 'Feedback')], showActions: false, showAreaComparison: false, showOutcomes: false });
  assert.equal(hidden.rows.actions.length, 0); assert.equal(hidden.breakdowns.some(group => ['ratings', 'focus', 'areas'].includes(group.key)), false); assert.equal(hidden.metrics.some(row => row.key === 'overdue-actions'), false);
});

const text = value => Array.isArray(value) ? value.map(text).join('') : value?.props ? text(value.props.children) : value == null || typeof value === 'boolean' ? '' : String(value);
async function dashboard(input) {
  let cursor = 0, changed = true, tree, props = { ...input, scopeKey: 'scope-a', onOpenRecord: id => opens.push(['record', id]), onOpenStaff: id => opens.push(['staff', id]), onOpenAction: (id, staff) => opens.push(['action', id, staff]) };
  const slots = [], effects = [], opens = [], primitives = await load('components/DashboardVisuals.tsx', { 'react/jsx-runtime': jsx });
  const hooks = { useState(initial) { const at = cursor++; if (!(at in slots)) slots[at] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[at].value, next => { const value = typeof next === 'function' ? next(slots[at].value) : next; if (!Object.is(value, slots[at].value)) { slots[at].value = value; changed = true; } }]; }, useMemo(factory, deps) { const at = cursor++, previous = slots[at]; if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index]))) slots[at] = { deps, value: factory() }; return slots[at].value; }, useEffect(effect, deps) { const at = cursor++, previous = slots[at]; if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index]))) { slots[at] = { deps }; effects.push(effect); } } };
  const component = (await load('components/ProcessIntelligence.tsx', { react: hooks, 'react/jsx-runtime': jsx, 'lucide-react': new Proxy({}, { get: () => () => null }), '../design-system/Button': { Button: ({ children, ...rest }) => React.createElement('button', rest, children) }, './CollapsibleSection': { Pagination: () => null }, './DashboardVisuals': primitives, '../app/routing': { recordPath: id => `/records/${id}`, staffPath: id => `/staff/${id}`, actionPath: id => `/actions/${id}` }, '../services/processIntelligence': model })).ProcessIntelligence;
  function nodes() { const found = []; function walk(node) { if (Array.isArray(node)) return node.forEach(walk); if (!node || typeof node !== 'object') return; found.push(node); walk(node.props?.children); } walk(tree); return found; }
  async function settle() { for (let i = 0; i < 20; i++) { if (changed) { cursor = 0; changed = false; tree = component(props); } while (effects.length) effects.shift()(); await new Promise(resolve => setImmediate(resolve)); if (!changed) return; } throw new Error('Dashboard did not settle'); }
  await settle(); return { nodes, opens, markup: () => renderToStaticMarkup(tree), links: () => nodes().filter(node => node.type === 'a'), async change(label, value) { const node = nodes().find(node => node.props?.['aria-label'] === label); assert.ok(node, `Missing ${label}`); node.props.onChange({ target: { value } }); await settle(); }, async select(key) { const metric = nodes().find(node => node.type === primitives.DashboardMetricCard && node.key === key); if (metric) metric.props.onSelect(); else { const chart = nodes().find(node => node.type === primitives.DashboardBreakdown && node.props.items.some(item => item.key === key)); assert.ok(chart, `Missing cohort ${key}`); chart.props.onSelect(key); } await settle(); }, async rerender(next) { props = { ...props, ...next }; changed = true; await settle(); } };
}

test('actual component chart, search, area, sort and dataset switches share the named register; scope resets immediately', async () => {
  const records = [record('digital', 'learning_walk', { deliveryAreaName: 'Digital', subjectDisplayName: 'Alex' }), record('workshop', 'learning_walk', { deliveryAreaName: 'Workshop', areaName: 'Engineering' })];
  const page = await dashboard({ ...base('learning_walk', records), facts: [fact('digital', 'focus', 'Assessment'), fact('workshop', 'focus', 'Feedback')] });
  await page.select('delivery:Digital'); assert.deepEqual(page.links().map(node => text(node)), ['digital review']);
  assert.match(page.markup(), /1 of 2 records shown/); assert.match(page.markup(), /Named Submitter/); assert.match(page.markup(), /Excel and PDF use the report filters above/);
  page.links()[0].props.onClick({ preventDefault() {} }); assert.deepEqual(page.opens, [['record', 'digital']]);
  await page.select('all'); await page.change('Explore dashboard area', 'Engineering'); assert.deepEqual(page.links().map(node => text(node)), ['workshop review']);
  await page.change('Explore dashboard area', 'all'); await page.change('Sort dashboard exploration', 'title-desc'); assert.deepEqual(page.links().map(node => text(node)), ['workshop review', 'digital review']);
  await page.change('Search dashboard exploration', 'missing'); assert.match(page.markup(), /No records match/);
  await page.rerender({ records: [record('new-year', 'learning_walk')], scopeKey: 'scope-b' }); assert.deepEqual(page.links().map(node => text(node)), ['new-year review']); assert.doesNotMatch(page.markup(), /digital review|workshop review/);
  assert.equal(page.nodes().find(node => node.props?.['aria-label'] === 'Search dashboard exploration').props.value, '');
});

test('staff cohorts open a named profile and expose a separate linked assessment action; exact levels do not become cumulative filters', async () => {
  const page = await dashboard({ ...base('eli'), eliStaff: [{ staffId: 's1', staffName: 'Alex Staff', hasSubmitted: true, assessmentRecordId: 'a' }, { staffId: 's2', staffName: 'Sam Pending', hasSubmitted: false }] });
  await page.select('eli:submitted'); assert.deepEqual(page.links().map(node => text(node)), ['Alex Staff', 'Open linked review']);
  page.links()[0].props.onClick({ preventDefault() {} }); page.links()[1].props.onClick({ preventDefault() {} }); assert.deepEqual(page.opens, [['staff', 's1'], ['record', 'a']]);
  await page.rerender({ ...base('elevate_status', []), statusStaff: [{ staffId: 'champion', staffName: 'Champion', currentLevel: 4, currentLevelName: 'Champion', qualifyingAttendanceCount: 12 }, { staffId: 'explorer', staffName: 'Explorer', currentLevel: 1, currentLevelName: 'Explorer', qualifyingAttendanceCount: 3 }], scopeKey: 'status' });
  await page.select('level:1'); assert.deepEqual(page.links().map(node => text(node)), ['Explorer']);
});
