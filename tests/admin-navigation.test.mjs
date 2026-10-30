import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRequire = createRequire(new URL('../apps/web/package.json', import.meta.url));
const ts = webRequire('typescript');
const loaded = new Map();
// Load the real pure TypeScript modules, including extensionless app imports.
function load(relative, parent = fileURLToPath(new URL('../apps/web/src/app/', import.meta.url))) {
  const file = resolve(parent, relative.endsWith('.ts') ? relative : `${relative}.ts`);
  if (loaded.has(file)) return loaded.get(file);
  const module = { exports: {} };
  loaded.set(file, module.exports);
  const output = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  new Function('require', 'exports', 'module', output.outputText)(name => load(name, dirname(file)), module.exports, module);
  return module.exports;
}
const { accessibleAdminSections, adminSections, resolveAdminSectionKey } = load('adminNavigation');
const { searchAdminSettings, normalizeAdminSearch } = load('adminSettingsSearch');
const { adminPath, parseAppLocation } = load('routing');
const allPermissions = [...new Set(adminSections.flatMap(section => [...section.permissions, ...(section.allPermissions ?? [])]))];

const keys = (permissions, isAdministrator = false) => accessibleAdminSections(permissions, isAdministrator).map((section) => section.key);

test('ordinary staff cannot enter the admin directory', () => {
  assert.deepEqual(keys(['cpd.self_log']), []);
});
test('list managers can find rooms and themes without seeing account editors', () => {
  const visible = keys(['lists.manage']);
  for (const key of ['overview', 'coaching-qualifications', 'liv-preferences', 'teaching-themes', 'rooms', 'all-lists', 'qa-action-themes', 'system']) assert.ok(visible.includes(key), key);
  for (const key of ['staff-details', 'staff-access', 'roles', 'records', 'badges', 'work-scrutiny-templates', 'qa-questions']) assert.ok(!visible.includes(key), key);
});
test('specialised correction screen requires all permissions used by its API calls', () => {
  assert.ok(!keys(['records.manage']).includes('work-scrutiny'));
  assert.ok(!keys(['users.manage']).includes('work-scrutiny'));
  assert.ok(keys(['records.manage', 'users.manage']).includes('work-scrutiny'));
});
test('badge managers get a focused admin directory', () => {
  assert.deepEqual(keys(['elevate_status.manage']), ['overview', 'badges', 'modules', 'system']);
});
test('all sections have unique deep links and are reachable with their permissions', () => {
  assert.equal(new Set(adminSections.map((section) => section.key)).size, adminSections.length);
  assert.equal(keys(allPermissions, true).length, adminSections.length);
  const paths = adminSections.map(section => section.path ?? adminPath(section.key));
  assert.equal(new Set(paths).size, paths.length);
  for (const section of adminSections) {
    const location = parseAppLocation(section.path ?? adminPath(section.key));
    assert.equal(location.route, section.path ? 'qa' : 'admin', section.key);
    if (!section.path) assert.equal(location.adminTab, section.key);
    if (section.lookupKey) assert.ok(section.steps?.length && section.impact, section.key);
  }
});

test('CSV imports require an explicit administrator identity and the matching management permission', () => {
  for (const key of ['cpd-import', 'list-import', 'qa-question-import']) assert.ok(!keys(allPermissions).includes(key), key);
  assert.ok(keys(['cpd.manage'], true).includes('cpd-import'));
  assert.ok(keys(['cpd.mandatory_log'], true).includes('cpd-import'));
  assert.ok(keys(['lists.manage'], true).includes('list-import'));
  const qa = accessibleAdminSections(['qa_reviews.manage'], true).find(section => section.key === 'qa-question-import');
  assert.equal(qa?.path, '/qa-hub/admin/question-import');
  assert.ok(!keys(['users.manage'], true).includes('cpd-import'));
});

test('legacy setting links lead to the appropriate focused page', () => {
  const expected = { lists: 'all-lists', 'qa-reviews': 'qa-questions', themes: 'teaching-themes', 'als-themes': 'als-learning-themes', 'als-liv': 'als-liv-practitioner', coaching: 'coaching-session', messaging: 'message-templates' };
  for (const [old, current] of Object.entries(expected)) assert.equal(resolveAdminSectionKey(old), current);
  for (const key of ['rooms', 'not-a-setting', 'constructor', '__proto__']) assert.equal(resolveAdminSectionKey(key), key);
  assert.equal(parseAppLocation('/admin/qa-reviews').route, 'qa');
  assert.equal(parseAppLocation('/qa-hub/question-bank').route, 'qa');
  assert.equal(parseAppLocation('/qa-hub/admin/%E0%A4%A').route, 'qa');
});
test('QA-only managers enter their own administration without unrelated main editors', () => {
  assert.deepEqual(keys(['qa_reviews.manage']), ['overview', 'modules', 'system', 'qa-overview', 'qa-questions', 'qa-outcomes', 'qa-not-seen', 'qa-form-access', 'qa-workflow']);
  const qa = accessibleAdminSections(['qa_reviews.manage']).find(section => section.key === 'qa-questions');
  assert.equal(qa.path, '/qa-hub/admin/questions');
  assert.equal(qa.workspace, 'QA Hub');
});

test('form managers get templates and authorised theme editors without QA governance', () => {
  const visible = keys(['forms.manage']);
  for (const key of ['forms', 'work-scrutiny-templates', 'learning-walk-templates', 'cpd-templates', 'teaching-themes', 'als-liv-practitioner']) assert.ok(visible.includes(key));
  for (const key of ['qa-questions', 'qa-outcomes', 'all-lists', 'coaching-session']) assert.ok(!visible.includes(key));
});

test('reporting managers see QA datasets without QA question or staff access editors', () => {
  const visible = keys(['records.manage']);
  for (const key of ['dashboard-faculties', 'dashboard-presentation', 'qa-dashboard-faculties']) assert.ok(visible.includes(key));
  for (const key of ['organisation-reporting', 'qa-questions', 'staff-scope']) assert.ok(!visible.includes(key));
});

test('each registered main lookup has a focused page and QA action themes stay in QA administration', () => {
  const direct = adminSections.filter(section => section.lookupKey).map(section => section.lookupKey);
  const registered = [
    'cpd_theme', 'coaching_development_stage', 'coaching_focus_area', 'coaching_support_type',
    'liv_notice_preference', 'liv_focus_area', 'liv_visit_focus_area', 'als_liv_delivery_area', 'liv_delivery_area',
    'als_liv_course_level', 'als_liv_visit_focus_area', 'als_liv_development_opportunity', 'liv_development_opportunity', 'liv_course_level',
    'action_theme_learning_walk', 'action_theme_elevate_environment', 'action_theme_work_scrutiny', 'action_theme_coaching_mentoring',
    'action_theme_liv', 'action_theme_probation_observation', 'action_theme_cpd', 'action_theme_standalone',
    'action_theme_als_learning_walk', 'action_theme_als_liv', 'action_theme_uco_tla_review'
  ];
  assert.deepEqual(direct.sort(), registered.sort());
  assert.equal(new Set(direct).size, direct.length);
  assert.equal(adminSections.find(section => section.key === 'qa-action-themes').path, '/qa-hub/admin/action-themes');
});

test('search finds tasks through descriptions, keywords, impact and instructions', () => {
  const results = query => searchAdminSettings(adminSections, query).map(section => section.key);
  for (const [query, key] of [
    ['how do I change the email sender', 'email-delivery'], ['qualification mentor', 'coaching-qualifications'],
    ['N/A wording', 'qa-outcomes'], ['not seen', 'qa-not-seen'], ['parent exclusion', 'organisation-reporting'],
    ['archived colleague', 'archived-staff'], ['LIV visit focus', 'liv-visit-focus'], ['Save faculty selections', 'dashboard-faculties']
  ]) assert.ok(results(query).includes(key), `${query} -> ${key}`);
  assert.deepEqual(results('no-such-control-987'), []);
  assert.equal(searchAdminSettings(adminSections, '').length, adminSections.length);
  assert.equal(normalizeAdminSearch('N/A & CAFÉ'), 'not applicable and cafe');
});

test('search returns only destinations the account can open', () => {
  const permitted = accessibleAdminSections(['qa_reviews.manage']);
  assert.deepEqual(searchAdminSettings(permitted, 'sender'), []);
  assert.ok(searchAdminSettings(permitted, 'outcome').some(section => section.key === 'qa-outcomes'));
});
