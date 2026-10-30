import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const requireWeb = createRequire(new URL('../apps/web/package.json', import.meta.url));
const ts = requireWeb('typescript');
async function loadSource(path, modules = {}) {
  const source = await readFile(new URL(`../apps/web/src/services/${path}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'exports', 'module', code)(name => { assert.ok(name in modules, `Unexpected import ${name}`); return modules[name]; }, module.exports, module);
  return module.exports;
}
const listQuery = await loadSource('listQuery.ts');
const reporting = await loadSource('processReviewReporting.ts', { './listQuery': listQuery });
const query = changes => ({ ...reporting.emptyProcessReviewReportQuery, ...changes });
const review = (recordId, changes = {}) => ({ recordId, title: `Review ${recordId}`, facultyOrgUnitId: 'faculty-1', facultyName: 'Creative Studies', ownerStaffId: 'owner-1', ownerName: 'Alex Morgan', academicYear: '2026/27', status: 'draft', recordDate: '2026-11-16', updatedAt: '2026-11-17T12:00:00Z', sampleCount: 4, ratedStatementCount: 0, statementCount: 24, ...changes });
const action = (actionId, changes = {}) => ({ actionId, recordId: 'review-1', title: 'Improve accessible learning resources', recordTitle: 'Creative Studies review', facultyName: 'Creative Studies', ownerStaffId: 'owner-1', ownerName: 'Alex Morgan', dueDate: '2027-01-12', progress: 'complete', themeKey: 'assistive', supportRequired: 'Assistive Technology lead', successEvidence: 'Learners can use the revised resources', impactStatus: 'awaiting_evidence', ...changes });
const configuration = changes => ({ processKey: 'digital_learning_walk', title: 'Digital Learning Walks', standards: [{ key: 'agency', title: 'Learner Agency', statements: [{ key: 'agency_1', text: 'Learners locate digital learning independently.' }] }], ratingOptions: [], fieldLabels: {}, settings: {}, ...changes });

test('review filters combine owner identity, faculty identity, stage, date and named search', () => {
  const records = [review('a'), review('b', { ownerStaffId: 'owner-2', ownerName: 'Sam Patel' }), review('c', { facultyOrgUnitId: 'faculty-2' }), review('d', { recordDate: null }), review('e', { status: 'submitted' })];
  const rows = reporting.selectProcessReviewRows(records, query({ owner: 'owner-1', faculty: 'faculty-1', status: 'draft', fromDate: '2026-11-01', toDate: '2026-11-30', search: 'alex creative' }));
  assert.deepEqual(rows.map(row => row.recordId), ['a']);
  assert.equal(rows[0].sampleCount, 4);
  assert.equal(rows[0].ratedStatementCount, 0);
  assert.deepEqual(reporting.selectProcessReviewRows(records, query({ fromDate: '2027-01-01', toDate: '2026-01-01' })), []);
});

test('chronological sorting keeps missing dates last and preserves the source list', () => {
  const records = [review('missing', { recordDate: null }), review('older', { recordDate: '2026-09-30' }), review('newer', { recordDate: '2026-10-01' })];
  assert.deepEqual(reporting.selectProcessReviewRows(records, query({ sort: 'date_desc' })).map(row => row.recordId), ['newer', 'older', 'missing']);
  assert.deepEqual(reporting.selectProcessReviewRows(records, query({ sort: 'date_asc' })).map(row => row.recordId), ['older', 'newer', 'missing']);
  assert.deepEqual(records.map(row => row.recordId), ['missing', 'older', 'newer']);
});

test('initial and follow-up review filters keep one meeting per row and search linked review titles', () => {
  const parent = { recordId: 'parent', title: 'Autumn initial discussion', status: 'submitted', academicYear: '2026/27', recordDate: '2026-10-01' };
  const child = { recordId: 'child', title: 'Spring follow-up', status: 'draft', academicYear: '2026/27', recordDate: '2027-03-01' };
  const rows = Object.freeze([Object.freeze(review('initial', { isFollowUp: false, followUpReviews: [child] })),
    Object.freeze(review('follow-up', { isFollowUp: true, parentReview: parent, followUpReviews: [] }))]);
  assert.deepEqual(reporting.selectProcessReviewRows(rows, query({ reviewKind: 'follow_up', search: 'Autumn initial' })).map(row => row.recordId), ['follow-up']);
  assert.deepEqual(reporting.selectProcessReviewRows(rows, query({ reviewKind: 'initial', search: 'Spring' })).map(row => row.recordId), ['initial']);
  assert.deepEqual(reporting.selectProcessReviewRows(rows, query({ sort: 'follow_up' })).map(row => row.recordId), ['initial', 'follow-up']);
  assert.equal(rows.length, 2);
});

test('action faculty filtering uses source review identity even when faculties share a display name', () => {
  const rows = [action('one'), action('two', { recordId: 'review-2', facultyName: 'Creative Studies' })];
  const selected = reporting.selectProcessReviewActions(rows, query({}), new Set(['review-1']));
  assert.deepEqual(selected.map(row => row.actionId), ['one']);
});

test('an earlier-year action remains associated with its current-year follow-up when filtering by faculty', () => {
  const rows = [action('shared', { recordId: 'earlier-source', academicYear: '2025/26', associatedReviewIds: ['current-follow-up'] }),
    action('elsewhere', { recordId: 'other-source', associatedReviewIds: ['other-follow-up'] })];
  const selected = reporting.selectProcessReviewActions(rows, query({}), new Set(['current-follow-up']));
  assert.deepEqual(selected.map(row => row.actionId), ['shared']);
  assert.equal(selected[0].recordId, 'earlier-source');
});

test('native action search includes owners, support and distinct impact without converting completion to impact', () => {
  const rows = [action('one'), action('two', { ownerStaffId: 'owner-2', ownerName: 'Sam Patel', impactStatus: 'demonstrated' })];
  const selected = reporting.selectProcessReviewActions(rows, query({ owner: 'owner-1', status: 'complete', search: 'Alex assistive awaiting' }));
  assert.equal(selected.length, 1);
  assert.equal(selected[0].progress, 'complete');
  assert.equal(selected[0].impactStatus, 'awaiting_evidence');
  assert.equal(reporting.selectProcessReviewActions(rows, query({ fromDate: '2027-02-01' })).length, 0);
});

test('admin configuration permits an unconfigured college scale and retains stable statement references', () => {
  const draft = configuration({ standards: [{ key: 'agency', title: 'Updated area title', statements: [{ key: 'agency_1', text: 'Updated college wording.' }] }] });
  assert.deepEqual(reporting.validateProcessReviewConfiguration(draft), []);
  assert.equal(draft.standards[0].statements[0].key, 'agency_1');
  assert.equal(reporting.processReviewFieldLabel(draft, 'agency_summary'), 'Updated area title');
  assert.ok(reporting.validateProcessReviewConfiguration(configuration({ processKey: 'activate_growth_review', standards: [{ key: 'it', title: 'IT', statements: [] }] })).some(message => message.includes('six pillars')));
});

test('admin validation rejects ambiguous reporting references and duplicate rating labels', () => {
  const draft = configuration({ standards: [{ key: 'one', title: 'One', statements: [{ key: 'same', text: 'First question' }] }, { key: 'two', title: 'Two', statements: [{ key: 'same', text: 'Second question' }] }], ratingOptions: [{ key: 'one', label: 'Secure' }, { key: 'two', label: ' secure ' }] });
  assert.ok(reporting.validateProcessReviewConfiguration(draft).some(message => message.includes('statement needs a distinct')));
  assert.ok(reporting.validateProcessReviewConfiguration(draft).some(message => message.includes('labels must be distinct')));
});

test('evidence links reject executable URLs and embedded credentials', () => {
  assert.equal(reporting.processReviewEvidenceHref('javascript:alert(1)'), null);
  assert.equal(reporting.processReviewEvidenceHref('data:text/html,private'), null);
  assert.equal(reporting.processReviewEvidenceHref('https://person:secret@example.com/file'), null);
  assert.equal(reporting.processReviewEvidenceHref('https://example.com/evidence'), 'https://example.com/evidence');
});
