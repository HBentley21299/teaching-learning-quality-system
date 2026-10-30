import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('ELI progress keeps records permission and validates the optional year before querying', async () => {
  const source = await readFile(new URL('../apps/api/src/TLQS.Api/V1/FoundationEndpoints.cs', import.meta.url), 'utf8');
  const start = source.indexOf('api.MapGet("/elevate-practice/progress"');
  const endpoint = source.slice(start, source.indexOf('\n        api.Map', start + 1));
  assert.match(endpoint, /string\? academicYear/);
  assert.match(endpoint, /CanManageRecords/);
  assert.match(endpoint, /ElevateProgressPolicy.TryResolveAcademicYear\(academicYear, SqlFoundationDataStore.GetCurrentAcademicYear\(\), out var selectedYear\)/);
  assert.match(endpoint, /Results.BadRequest/);
  assert.match(endpoint, /GetElevatePracticeProgressAsync\(selectedYear, cancellationToken\)/);
  assert.ok(endpoint.indexOf('TryResolveAcademicYear') < endpoint.indexOf('GetElevatePracticeProgressAsync'));
});
