import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accessibleQaAdminSections, qaAdminPath, qaAdminSectionFromPath, resolveQaAdminSectionKey } from '../apps/web/src/app/qaAdminNavigation.ts';

const keys = permissions => accessibleQaAdminSections(permissions).map(section => section.key);

test('QA contribution and form editing permissions do not grant QA administration', () => {
  for (const permissions of [[], ['qa_reviews.submit'], ['qa_reviews.view'], ['forms.manage'], ['users.manage']]) {
    assert.deepEqual(keys(permissions), []);
  }
});

test('QA managers get questions, scale and form access without list or reporting editors', () => {
  assert.deepEqual(keys(['qa_reviews.manage']), ['overview', 'questions', 'outcomes', 'not-seen', 'form-access', 'workflow']);
});

test('QA CSV import is available only to explicit administrators with QA management permission', () => {
  assert.ok(!accessibleQaAdminSections(['qa_reviews.manage']).some(section => section.key === 'question-import'));
  assert.ok(accessibleQaAdminSections(['qa_reviews.manage'], true).some(section => section.key === 'question-import'));
  assert.ok(!accessibleQaAdminSections(['lists.manage'], true).some(section => section.key === 'question-import'));
  assert.equal(qaAdminSectionFromPath('/qa-hub/admin/question-import'), 'question-import');
});

test('reference list and reporting managers get independent QA administration entry points', () => {
  assert.deepEqual(keys(['lists.manage']), ['overview', 'action-themes', 'delivery-areas', 'workflow']);
  assert.deepEqual(keys(['records.manage']), ['overview', 'dashboard-faculties', 'workflow']);
  assert.deepEqual(keys(['lists.manage', 'records.manage']), ['overview', 'action-themes', 'delivery-areas', 'dashboard-faculties', 'workflow']);
});

test('each authorised settings destination has a distinct, restorable QA deep link', () => {
  const sections = accessibleQaAdminSections(['qa_reviews.manage', 'lists.manage', 'records.manage']);
  assert.equal(new Set(sections.map(section => qaAdminPath(section.key))).size, sections.length);
  for (const section of sections) {
    assert.equal(qaAdminSectionFromPath(qaAdminPath(section.key)), section.key);
    assert.equal(qaAdminSectionFromPath(`${qaAdminPath(section.key)}/`), section.key);
  }
});

test('previous question bank and scale links resolve to their dedicated settings pages', () => {
  assert.equal(qaAdminSectionFromPath('/qa-hub/question-bank'), 'questions');
  assert.equal(qaAdminSectionFromPath('/admin/qa-reviews'), 'questions');
  assert.equal(qaAdminSectionFromPath('/qa-hub/admin/question-bank'), 'questions');
  assert.equal(qaAdminSectionFromPath('/qa-hub/admin/ratings'), 'outcomes');
  assert.equal(qaAdminSectionFromPath('/qa-hub/admin/access'), 'form-access');
  assert.equal(qaAdminPath('ratings'), '/qa-hub/admin/outcomes');
  assert.equal(qaAdminPath('overview'), '/qa-hub/admin');
});

test('review routes are not mistaken for admin routes and unknown settings stay unavailable', () => {
  for (const path of ['/qa-hub', '/qa-hub/reviews', '/qa-hub/actions', '/qa-hub/reviews/new', '/admin/forms']) assert.equal(qaAdminSectionFromPath(path), null);
  assert.equal(resolveQaAdminSectionKey('not-a-setting'), undefined);
  assert.equal(resolveQaAdminSectionKey('constructor'), undefined);
  assert.equal(resolveQaAdminSectionKey('__proto__'), undefined);
  assert.equal(qaAdminSectionFromPath('/qa-hub/admin/not-a-setting'), 'not-a-setting');
  assert.equal(qaAdminSectionFromPath('/qa-hub/admin/%E0%A4%A'), 'unavailable');
});
