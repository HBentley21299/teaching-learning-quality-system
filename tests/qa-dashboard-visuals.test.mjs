import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const web = createRequire(new URL('../apps/web/package.json', import.meta.url));
const ts = web('typescript'), React = web('react'), jsx = web('react/jsx-runtime');
const { renderToStaticMarkup } = web('react-dom/server');
async function load(path, modules = {}) {
  const source = await readFile(new URL(`../apps/web/src/${path}`, import.meta.url), 'utf8');
  const module = { exports: {} };
  new Function('require', 'exports', 'module', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText)(name => modules[name] ?? {}, module.exports, module);
  return module.exports;
}
const model = await load('services/qaDashboardExploration.ts');
const primitives = await load('components/DashboardVisuals.tsx', { 'react/jsx-runtime': jsx });
const labels = { below: 'Below standard', at: 'At standard', above: 'Above standard', notApplicable: 'Not applicable' };
const question = { activityKey: 'walk', activityLabel: 'Learning Walk', questionId: 'feedback', themeOrWeek: 'Assessment', questionText: 'Learners act on feedback', below: 2, at: 3, above: 1, notApplicable: 1, notSeen: 1, rated: 6, belowPercentage: 33.3, atPercentage: 50, abovePercentage: 16.7 };
const questions = [question,
  { ...question, questionId: 'agency', themeOrWeek: 'Ownership', questionText: 'Learners work independently', below: 0, at: 2, above: 3, rated: 5, notApplicable: 0, notSeen: 0 },
  { ...question, activityKey: 'scrutiny', activityLabel: 'Work Scrutiny', questionId: 'digital', questionText: 'Digital work shows progress', below: 1, at: 0, above: 0, rated: 1, notApplicable: 0, notSeen: 0 },
  { ...question, activityKey: 'scrutiny', activityLabel: 'Work Scrutiny', questionId: 'neutral', themeOrWeek: '', questionText: 'Neutral criterion', below: 0, at: 0, above: 0, rated: 0, notSeen: 4, notApplicable: 2 }
];
const dashboard = { reviewId: 'review', evidenceCount: 4, facultyCount: 1, teamCount: 2, courseCount: 3, sampleCount: 12, belowCount: 3, atCount: 5, aboveCount: 4, notApplicableCount: 3, notSeenCount: 5, ratedCount: 12, atOrAbovePercentage: 75,
  questions, byActivity: [
    { key: 'walk', label: 'Learning Walk', below: 2, at: 5, above: 4, notApplicable: 1, notSeen: 1, rated: 11, atOrAbovePercentage: 81.8 },
    { key: 'scrutiny', label: 'Work Scrutiny', below: 1, at: 0, above: 0, notApplicable: 2, notSeen: 4, rated: 1, atOrAbovePercentage: 0 }
  ], byTheme: [], byTeam: [
    { key: 'team-a', label: 'Team A', below: 3, at: 5, above: 4, rated: 12, notSeen: 5, notApplicable: 3 },
    { key: 'team-b', label: 'Team B', below: 3, at: 5, above: 4, rated: 12, notSeen: 5, notApplicable: 3 }
  ], timeline: [{ date: '2026-10-20', evidenceCount: 3, responseCount: 15 }, { date: '2026-10-21', evidenceCount: 1, responseCount: 5 }], teamsWithoutEvidence: ['Team C'], linkedActionCount: 3, openActionCount: 2, snapshotVersion: 2
};

test('QA criterion exploration intersects process, theme, recorded outcome and search without inventing record-level outcomes', () => {
  const selected = model.filterQaDashboardCriteria(questions, { ...model.emptyQaDashboardExploration, process: 'walk', theme: 'Assessment', outcome: 'below', search: 'feedback Learners' });
  assert.deepEqual(selected.map(row => row.questionId), ['feedback']);
  assert.deepEqual(model.filterQaDashboardCriteria(questions, { ...model.emptyQaDashboardExploration, outcome: 'not_seen' }).map(row => row.questionId), ['feedback', 'neutral']);
  assert.deepEqual(model.filterQaDashboardCriteria(questions, { ...model.emptyQaDashboardExploration, criterion: 'scrutiny:digital' }).map(row => row.questionId), ['digital']);
  assert.equal(questions.length, 4);
});

test('QA percentages exclude neutral outcomes, retain zero-rated criteria and aggregate criteria rather than overlapping team groups', () => {
  assert.equal(model.qaRatedPercentage(0, 0), null);
  assert.deepEqual(model.qaCriteriaTotals([questions[3]]), { below: 0, at: 0, above: 0, notSeen: 4, notApplicable: 2, rated: 0, atOrAbovePercentage: null });
  const totals = model.qaCriteriaTotals(questions);
  assert.equal(totals.rated, 12); assert.equal(totals.atOrAbovePercentage, 75); assert.equal(totals.notSeen, 5); assert.equal(totals.notApplicable, 3);
  assert.equal(dashboard.byTeam.reduce((sum, team) => sum + team.rated, 0), 24, 'shared submission responses overlap between teams');
  assert.equal(model.qaThemeBreakdown(questions).find(theme => theme.key === 'Other').rated, 0);
  assert.equal(model.qaThemeBreakdown(questions).find(theme => theme.key === 'Assessment').rated, 7);
});

test('QA attention, strength and volume sorting use response counts with ratio tie-breaks and no averaged scale score', () => {
  assert.deepEqual(model.filterQaDashboardCriteria(questions, model.emptyQaDashboardExploration).map(row => row.questionId), ['feedback', 'digital', 'agency', 'neutral']);
  assert.deepEqual(model.filterQaDashboardCriteria(questions, { ...model.emptyQaDashboardExploration, sort: 'strength' }).map(row => row.questionId), ['agency', 'feedback', 'digital', 'neutral']);
  assert.deepEqual(model.filterQaDashboardCriteria(questions, { ...model.emptyQaDashboardExploration, sort: 'responses' }).map(row => row.questionId), ['feedback', 'agency', 'digital', 'neutral']);
});

const text = value => Array.isArray(value) ? value.map(text).join('') : value?.props ? text(value.props.children) : value == null || typeof value === 'boolean' ? '' : String(value);
async function page(initial = {}) {
  let cursor = 0, changed = true, tree, props = { dashboard, scopeKey: 'review-faculty-all', selectedTeamId: '', teamOptions: [{ id: 'team-a', name: 'Team A' }, { id: 'team-b', name: 'Team B' }], onSelectTeam: key => teamSelections.push(key), onOpenFormData: () => formDataOpens.push(true), ...initial };
  const slots = [], effects = [], teamSelections = [], formDataOpens = [];
  const hooks = {
    useRef(initial) { const at = cursor++; if (!(at in slots)) slots[at] = { current: initial }; return slots[at]; },
    useState(initial) { const at = cursor++; if (!(at in slots)) slots[at] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[at].value, next => { const value = typeof next === 'function' ? next(slots[at].value) : next; if (!Object.is(value, slots[at].value)) { slots[at].value = value; changed = true; } }]; },
    useMemo(factory, deps) { const at = cursor++, previous = slots[at]; if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index]))) slots[at] = { deps, value: factory() }; return slots[at].value; },
    useEffect(effect, deps) { const at = cursor++, previous = slots[at]; if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index]))) { slots[at] = { deps }; effects.push(effect); } }
  };
  const component = (await load('components/QaReviewIntelligence.tsx', { react: hooks, 'react/jsx-runtime': jsx, 'lucide-react': new Proxy({}, { get: () => () => null }),
    '../design-system/Button': { Button: ({ children, icon, variant, ...rest }) => React.createElement('button', rest, children) }, '../services/qaOutcomeLabels': { useQaOutcomeLabels: () => labels, qaCombinedOutcomeLabel: labels => `${labels.at} / ${labels.above}` }, '../services/qaDashboardExploration': model, './DashboardVisuals': primitives })).QaReviewIntelligence;
  function nodes() { const found = []; function walk(node) { if (Array.isArray(node)) return node.forEach(walk); if (!node || typeof node !== 'object') return; found.push(node); if (typeof node.type === 'function') walk(node.type(node.props)); else walk(node.props?.children); } walk(tree); return found; }
  async function settle() { for (let i = 0; i < 20; i++) { if (changed) { cursor = 0; changed = false; tree = component(props); } while (effects.length) effects.shift()(); await new Promise(resolve => setImmediate(resolve)); if (!changed) return; } throw new Error('QA dashboard did not settle'); }
  await settle();
  return { teamSelections, formDataOpens, nodes, markup: () => renderToStaticMarkup(tree), criteria: () => nodes().filter(node => node.type === 'details'),
    async change(label, value) { const node = nodes().find(node => node.props?.['aria-label'] === label); assert.ok(node, `Missing ${label}`); node.props.onChange({ target: { value } }); await settle(); },
    async click(label) { const node = nodes().find(node => node.type === 'button' && (node.props['aria-label'] ?? text(node)).startsWith(label)); assert.ok(node, `Missing button ${label}`); node.props.onClick(); await settle(); },
    async rerender(next) { props = { ...props, ...next }; changed = true; await settle(); }
  };
}

test('interactive QA process, outcome and theme lenses synchronise the criterion register and response mix', async () => {
  const ui = await page();
  await ui.click('Work Scrutiny');
  assert.equal(ui.criteria().length, 2); assert.match(ui.markup(), /2 of 4 criteria shown/);
  await ui.click('Not seen');
  assert.equal(ui.criteria().length, 1); assert.match(text(ui.criteria()[0]), /Neutral criterion/);
  assert.match(ui.markup(), /At standard \/ Above standard: not available/);
  assert.match(ui.markup(), /4 Not seen · 2 Not applicable/);
  await ui.click('Reset exploration');
  await ui.click('Assessment');
  assert.equal(ui.criteria().length, 2); assert.match(ui.markup(), /4 of 7 rated responses/);
  await ui.change('QA criterion process', 'walk');
  await ui.change('Search QA dashboard criteria', 'independently');
  assert.equal(ui.criteria().length, 1); assert.match(ui.markup(), /5 of 5 rated responses/);
  assert.match(ui.markup(), /Excel and PDF use the faculty and team reporting filters/);
});

test('team comparison delegates to the existing server scope, while date selections expose exact timeline counts', async () => {
  const ui = await page();
  await ui.click('Team A'); assert.deepEqual(ui.teamSelections, ['team-a']);
  assert.match(ui.markup(), /Shared submission|shared submission/);
  assert.match(ui.markup(), /value="team-a"|Team A/);
  await ui.click('20 Oct 2026:');
  assert.match(ui.markup(), /20 Oct 2026 · 3 submitted forms · 15 responses/);
  await ui.click('Open submitted form data'); assert.equal(ui.formDataOpens.length, 1);
  assert.equal(ui.criteria().length, 4, 'team navigation does not fake a locally derived team subset');
});

test('criterion highlights select the exact criterion and never classify zero-below criteria as concerns', async () => {
  const ui = await page();
  const attention = ui.nodes().find(node => node.type === 'section' && text(node).startsWith('Selected process · top threeCriteria needing attention'));
  assert.ok(attention); assert.doesNotMatch(text(attention), /Learners work independently|Neutral criterion/);
  await ui.click('1Learning Walk');
  assert.equal(ui.criteria().length, 1); assert.match(text(ui.criteria()[0]), /Learners act on feedback/);
  assert.equal(ui.criteria()[0].props.open, true);
  assert.match(ui.markup(), /Selected criterion: Learners act on feedback/);
  await ui.click('Selected criterion:');
  assert.equal(ui.criteria().length, 2, 'clear criterion retains the explicitly selected process');
});

test('a report scope change resets local exploration and hidden export access does not create a form-data link', async () => {
  const ui = await page(); await ui.change('QA criterion process', 'walk'); await ui.change('Search QA dashboard criteria', 'feedback'); await ui.click('20 Oct 2026:');
  await ui.rerender({ scopeKey: 'review-team-new', dashboard: { ...dashboard, questions: [questions[3]], byActivity: [dashboard.byActivity[1]], timeline: [] }, onOpenFormData: undefined });
  assert.equal(ui.criteria().length, 1); assert.match(text(ui.criteria()[0]), /Neutral criterion/);
  assert.equal(ui.nodes().find(node => node.props?.['aria-label'] === 'QA criterion process').props.value, 'all');
  assert.equal(ui.nodes().find(node => node.props?.['aria-label'] === 'Search QA dashboard criteria').props.value, '');
  assert.doesNotMatch(ui.markup(), /Open submitted form data|20 Oct 2026 · 3 submitted forms/);
});

test('QA criterion pagination exposes the complete selected set and resets after a changed filter', async () => {
  const ui = await page({ dashboard: { ...dashboard, questions: Array.from({ length: 15 }, (_, index) => ({ ...question, questionId: `criterion-${index}`, questionText: `Criterion ${index + 1}` })) } });
  assert.equal(ui.criteria().length, 12);
  await ui.click('Show more criteria'); assert.equal(ui.criteria().length, 15);
  await ui.change('Sort QA dashboard criteria', 'question'); assert.equal(ui.criteria().length, 12);
  await ui.change('Search QA dashboard criteria', 'Criterion 15'); assert.equal(ui.criteria().length, 1);
});
