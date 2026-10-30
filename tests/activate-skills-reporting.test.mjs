import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const requireWeb = createRequire(new URL('../apps/web/package.json', import.meta.url));
const ts = requireWeb('typescript');
async function load(path, modules = {}) {
  const source = await readFile(new URL(`../apps/web/src/services/${path}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'exports', 'module', code)(name => { assert.ok(name in modules, `Unexpected import ${name}`); return modules[name]; }, module.exports, module);
  return module.exports;
}
const listQuery = await load('listQuery.ts');
const reporting = await load('processReviewReporting.ts', { './listQuery': listQuery });
const groups = [
  ['digital_proficiency_productivity', ['digital_proficiency', 'digital_productivity']],
  ['information_data_media_literacies', ['information_literacy', 'data_literacy', 'media_literacy']],
  ['digital_creation_problem_solving_innovation', ['digital_creation', 'problem_solving', 'digital_innovation']],
  ['digital_communication_collaboration_participation', ['digital_communication', 'digital_collaboration', 'digital_participation']],
  ['digital_learning_development', ['digital_learning', 'digital_teaching']],
  ['digital_identity_wellbeing', ['digital_identity_management', 'digital_wellbeing']]
];
const pillars = groups.map(([key, areas], index) => ({ key, title: `Pillar ${index + 1}`, subAreas: areas.map((key, area) => ({ key, title: `Sub-area ${index + 1}.${area + 1}` })) }));
const themes = Array.from({ length: 5 }, (_, index) => ({ key: `area_${index + 1}`, title: `Specialist theme ${index + 1}` }));
const scores = Object.fromEntries(pillars.flatMap(pillar => pillar.subAreas.map(area => [area.key, 3])));

test('six pillar means use their own fifteen manual decimal sub-area averages, not five specialist themes', () => {
  const values = Object.freeze({ ...scores, digital_proficiency: 2.25, digital_productivity: 3.75, information_literacy: 1.2, data_literacy: 2.4, media_literacy: 3.6 });
  const result = reporting.activateSkillsPillarResults(pillars, values);
  assert.equal(result.length, 6);
  assert.equal(result.reduce((count, pillar) => count + pillar.subAreas.length, 0), 15);
  assert.equal(result[0].mean, 3);
  assert.ok(Math.abs(result[1].mean - 2.4) < 1e-12);
  assert.ok(result.every(pillar => pillar.complete));
  assert.equal(values.digital_proficiency, 2.25);
  assert.ok(result.every(pillar => !themes.some(theme => theme.key === pillar.key)));
});

test('a missing or invalid sub-area average leaves its pillar pending rather than contributing zero', () => {
  for (const missing of [null, undefined, 0, 5.01, Number.NaN, Infinity, '3.25']) {
    const result = reporting.activateSkillsPillarResults(pillars, { ...scores, digital_productivity: missing });
    assert.equal(result[0].mean, null);
    assert.equal(result[0].enteredCount, 1);
    assert.equal(result[0].complete, false);
    assert.equal(result[0].subAreas[1].score, null);
    assert.equal(result[1].mean, 3);
  }
});

test('pillar display rounds decimal ties consistently with the workbook', () => {
  const [pillar] = reporting.activateSkillsPillarResults(pillars, { ...scores, digital_proficiency: 2.65, digital_productivity: 2.7 });
  assert.equal(pillar.mean, 2.675);
  assert.equal(reporting.formatActivatePillarMean(pillar.mean), '2.68');
  assert.equal(reporting.formatActivatePillarMean(3), '3.00');
});

test('draft reporting retains entered values without manufacturing reported pillar averages', () => {
  const result = reporting.activateSkillsPillarResults(pillars, { ...scores, digital_proficiency: 4.125 }, false);
  assert.ok(result.every(pillar => pillar.mean === null));
  assert.equal(result[0].subAreas[0].score, 4.125);
  assert.equal(result[0].enteredCount, 2);
});

test('Activate configuration keeps six/fifteen Skills Scan labels independent of five action themes', () => {
  const config = { processKey: 'activate_growth_review', title: 'Activate+', standards: [], ratingOptions: [], fieldLabels: {}, settings: {}, skillsScanPillars: structuredClone(pillars), actionThemes: structuredClone(themes) };
  config.skillsScanPillars[0].title = 'College pillar wording';
  config.actionThemes[0].title = 'Immersive Technology';
  assert.deepEqual(reporting.validateProcessReviewConfiguration(config), []);
  assert.equal(reporting.activateSkillsPillarResults(config.skillsScanPillars, scores)[0].mean, 3);
  assert.equal(config.skillsScanPillars[0].key, 'digital_proficiency_productivity');
  assert.ok(reporting.validateProcessReviewConfiguration({ ...config, actionThemes: config.actionThemes.slice(1) }).some(error => error.includes('five specialist')));
  assert.ok(reporting.validateProcessReviewConfiguration({ ...config, skillsScanPillars: config.skillsScanPillars.slice(1) }).some(error => error.includes('six pillars')));
  assert.ok(reporting.validateProcessReviewConfiguration({ ...config, ratingOptions: [{ key: 'high', label: 'High' }] }).some(error => error.includes('manual Skills Scan')));
});

test('named sub-team and participant filters use identities and preserve one review per row', () => {
  const base = { recordId: 'one', title: 'Review', facultyOrgUnitId: 'faculty', facultyName: 'Faculty', ownerStaffId: 'owner', ownerName: 'Owner', academicYear: '2026/27', status: 'submitted', recordDate: '2026-11-01', selectedSubTeams: [{ orgUnitId: 'team-one', name: 'Media' }], participants: [{ staffId: 'hof', displayName: 'Sam Head', roles: ['head_of_faculty'] }, { staffId: 'pl', displayName: 'Alex Leader', roles: ['programme_leader'] }] };
  const rows = Object.freeze([Object.freeze(base), Object.freeze({ ...base, recordId: 'two', selectedSubTeams: [{ orgUnitId: 'team-two', name: 'Media' }] })]);
  const query = { ...reporting.emptyProcessReviewReportQuery, subTeam: 'team-one', participant: 'hof', search: 'Alex Media' };
  assert.deepEqual(reporting.selectProcessReviewRows(rows, query).map(row => row.recordId), ['one']);
  assert.equal(rows.length, 2);
});

test('one action with several responsible people remains one action and filters by every assignee and impact area', () => {
  const row = { actionId: 'action-one', recordId: 'review-one', recordTitle: 'Review', title: 'Agree a development action', detail: 'Revise the resources', themeKey: 'area_2', themeLabel: 'Assistive Technology', ownerStaffId: 'one', ownerName: 'Alex Morgan', responsibleStaffIds: ['one', 'two'], responsibleStaff: [{ staffId: 'one', displayName: 'Alex Morgan' }, { staffId: 'two', displayName: 'Sam Patel' }], impactAreaKey: 'digital_learning', impactAreaLabel: 'Digital learning', dueDate: '2026-12-01', successEvidence: 'Learners demonstrate the intended change', progress: 'open', impactStatus: 'awaiting_evidence' };
  const selected = reporting.selectProcessReviewActions([row], { ...reporting.emptyProcessReviewReportQuery, owner: 'two', impactArea: 'digital_learning', search: 'Sam Assistive resources' });
  assert.equal(selected.length, 1);
  assert.equal(selected[0].actionId, 'action-one');
  assert.deepEqual(reporting.processReviewResponsibleNames(selected[0]), ['Alex Morgan', 'Sam Patel']);
  assert.equal(reporting.selectProcessReviewActions([row], { ...reporting.emptyProcessReviewReportQuery, impactArea: 'data_literacy' }).length, 0);
});
