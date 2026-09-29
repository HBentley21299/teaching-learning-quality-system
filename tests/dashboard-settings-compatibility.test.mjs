import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ApiHttpError, isUnavailableFacultySettings} from '../apps/web/src/services/apiHttpError.ts';

test('the older API missing the optional settings endpoint permits existing reporting', () => {
  assert.equal(isUnavailableFacultySettings(new ApiHttpError(404, 'Not Found', '/api/v1/reports/faculty-selections')), true);
});

test('settings errors and access failures never silently discard faculty selections', () => {
  for (const status of [401, 403, 500, 503]) {
    assert.equal(isUnavailableFacultySettings(new ApiHttpError(status, 'Failure', '/api/v1/reports/faculty-selections')), false);
  }
  assert.equal(isUnavailableFacultySettings(new Error('Network failure')), false);
  assert.equal(isUnavailableFacultySettings(new ApiHttpError(404, 'Not Found', '/api/v1/reports/process-records')), false);
});
