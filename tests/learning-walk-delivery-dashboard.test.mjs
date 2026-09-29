import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLearningWalkDeliveryAreas, deliveryAreaKey, deliveryAreaLabel, unrecordedDeliveryAreaKey } from '../apps/web/src/routes/learningWalkDeliveryAreas.ts';

const record = (id, key, label, createdAt = '2026-09-08T12:00:00Z') => ({ id, deliveryAreaKey: key, deliveryAreaName: label, createdAt });

test('delivery breakdown counts each source record once, independently of focus facts', () => {
  const records = [record('one', 'classroom', 'Classroom'), record('one', 'classroom', 'Classroom'), record('two', 'classroom', 'Classroom'), record('three', 'online', 'Online')];
  assert.deepEqual(buildLearningWalkDeliveryAreas(records).map(({ key, value }) => ({ key, value })), [{ key: 'classroom', value: 2 }, { key: 'online', value: 1 }]);
});

test('older missing areas remain visible and can be selected explicitly', () => {
  const old = record('old', undefined, undefined);
  assert.equal(deliveryAreaKey(old), unrecordedDeliveryAreaKey);
  assert.equal(deliveryAreaLabel(old), 'Not recorded');
  assert.equal(buildLearningWalkDeliveryAreas([old])[0].value, 1);
});

test('renamed area wording retains one stable reporting group with deterministic latest wording', () => {
  const records = [record('old', 'classroom', 'Classroom', '2025-01-01T12:00:00Z'), record('new', 'classroom', 'Classroom delivery')];
  const groups = buildLearningWalkDeliveryAreas(records);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, 'Classroom delivery');
  assert.equal(groups[0].value, 2);
  assert.deepEqual(buildLearningWalkDeliveryAreas([...records].reverse()), groups);
  assert.equal(deliveryAreaLabel(records[0]), 'Classroom');
});
