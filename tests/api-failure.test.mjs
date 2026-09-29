import assert from 'node:assert/strict';
import {test} from 'node:test';
import {apiFailureMessage} from '../apps/web/src/services/apiFailure.ts';

test('validation and conflict details remain actionable and retain support references', () => {
  assert.match(apiFailureMessage(400, {detail:'Select a delivery area.', traceId:'request-123'}), /Select a delivery area.*request-123/);
  assert.match(apiFailureMessage(409, null), /changed while you were editing/);
  assert.match(apiFailureMessage(403, null), /permission/);
});
test('session and throttling errors give recovery guidance even with unhelpful response titles', () => {
  assert.match(apiFailureMessage(401, {title:'Unauthorized'}), /Sign in again/);
  assert.match(apiFailureMessage(429, {}, '30'), /30 seconds/);
});
test('server error internals are not exposed while a support reference remains available', () => {
  const message = apiFailureMessage(500, {detail:'SQL password=secret; exception stack', extensions:{traceId:'trace-9'}});
  assert.doesNotMatch(message, /SQL|password|secret/);
  assert.match(message, /trace-9/);
});
