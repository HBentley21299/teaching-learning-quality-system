import assert from 'node:assert/strict';
import { test } from 'node:test';
import { availableFormFamilies } from '../apps/web/src/app/formEditorNavigation.ts';

test('QA-only administrators cannot open structural or managed-list editors', () => {
  assert.deepEqual(availableFormFamilies(['qa_reviews.manage']).map(form => form.key), ['qa']);
});
test('form-only administrators retain templates and authorised theme settings', () => {
  assert.deepEqual(availableFormFamilies(['forms.manage']).map(form => form.key), ['work_scrutiny', 'learning_walks', 'als_learning_walk', 'cpd', 'liv', 'als_liv']);
});
test('list managers retain access to all shared choices, including QA action themes', () => {
  const forms = availableFormFamilies(['lists.manage']);
  assert.ok(forms.some(form => form.key === 'all_lists'));
  assert.deepEqual(forms.find(form => form.key === 'cpd').lists, ['cpd_theme', 'action_theme_cpd']);
  assert.deepEqual(forms.find(form => form.key === 'qa').lists, ['action_theme_qa_review']);
});
