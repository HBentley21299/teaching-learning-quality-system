import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildFormOutcomeGroups} from '../apps/web/src/services/formOutcomeGroups.ts';

const fact = (dimensionKey, seriesKey, seriesLabel, numericValue, valueLabel = '') => ({dimensionKey, seriesKey, seriesLabel, numericValue, valueLabel});
const group = facts => buildFormOutcomeGroups(facts, 'section', 'statement');

test('section scores are not counted again when statements are expanded', () => {
  const [result] = group([
    fact('section', 'a', 'Assessment', 3),
    fact('statement', 'a::1', 'Assessment|||Feedback', 1),
    fact('statement', 'a::2', 'Assessment|||Progress', 5)
  ]);
  assert.equal(result.summary.responseCount, 1);
  assert.equal(result.summary.average, 3);
  assert.equal(result.children.length, 2);
});

test('neutral responses remain visible without affecting means or secure percentages', () => {
  const [result] = group([
    fact('statement', 'a::1', 'Assessment|||Feedback', 4),
    fact('statement', 'a::1', 'Assessment|||Feedback', null, 'Not seen'),
    fact('statement', 'a::1', 'Assessment|||Feedback', undefined, 'N/A')
  ]);
  assert.equal(result.summary.responseCount, 1);
  assert.equal(result.summary.average, 4);
  assert.equal(result.summary.secureOrAboveCount, 1);
  assert.deepEqual(result.summary.neutralCounts, [{label:'Not seen',count:1},{label:'N/A',count:1}]);
});

test('neutral-only sections and identical wording on different statements are retained', () => {
  const [result] = group([
    fact('statement', 'a::1', 'Assessment|||Evidence', null, 'Not seen'),
    fact('statement', 'a::2', 'Assessment|||Evidence', null, 'Not seen')
  ]);
  assert.equal(result.children.length, 2);
  assert.equal(result.summary.responseCount, 0);
  assert.deepEqual(result.summary.neutralCounts, [{label:'Not seen',count:2}]);
});
