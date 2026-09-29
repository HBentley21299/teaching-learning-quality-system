# Local reporting baseline — 29 September 2026

## Before the integrated restart

Measured at 13:02 BST against the existing local API at `http://127.0.0.1:5001`, process 6436. Used the existing development identity and test database, academic year 2026/27. Fourteen sequential GET requests (seven endpoints, two rounds), concurrency one, after one readiness request. No cache reset, fixture reload, exports, workflow writes or stress test. Other application activity was not suspended.

| Endpoint under /api/v1 | Round 1 ms | Round 2 ms | Items | Decoded JSON bytes |
| --- | ---: | ---: | ---: | ---: |
| reports/dashboard-configuration | 80.4 | 33.1 | 13 processes | 2,613 |
| reports/process-records, overview | 561.0 | 403.9 | 107 records | 94,152 |
| reports/dashboard-dimensions, overview | 341.9 | 347.0 | 1,100 facts | 526,036 |
| reports/actions, overview | 132.9 | 125.8 | 108 actions | 57,939 |
| reports/elevate-status | 237.9 | 139.2 | 12 area rows | 2,761 |
| reports/staff-participation | 194.8 | 240.0 | 60 process/area rows | 11,857 |
| qa-hub/summary | 176.8 | 220.6 | 2 reviews | 1,210 |

All responses returned HTTP 200. The combined measured request time was 3,235.3 ms. Payload sizes are decoded UTF-8 JSON, not compressed transfer sizes. The second round is a repeat with no deliberate cache flush; do not describe the first as a cold-cache test.

The observed local dataset does not currently justify a broad reporting rewrite. Two observations per endpoint and a small test cohort are insufficient to establish production capacity, percentiles, concurrent-user performance or a speed improvement. The integrated restart should repeat the same script and preserve these counts before comparing timings.

Reproduce with `scripts/measure-local-reporting.ps1 -Phase before` or `-Phase after`. Raw measurements, exact paths and runtime metadata are in `.localappdata/reporting-baseline/before.json`; the after run writes `after.json`. The script only targets localhost and sends GET requests.

## Bounded QA export optimisation candidate

`GetQaExportAsync` in `apps/api/src/TLQS.Api/Data/QaReviewDataStore.cs` retrieves each included submission through `GetQaEvidenceAsync`. That method performs five query stages per evidence item: permission-scoped header, edit whitelist, team names, question responses and revision history. The export builder uses header, teams and responses, but does not use `CanEdit`, `CanRemove` or `Revisions` (`apps/api/src/TLQS.Api/Exports/QaFormEntryExportBuilder.cs`).

The accepted implementation adds an export-only read mode which skips the whitelist and revision-history queries: two fewer query stages per submission (16 for an eight-entry review). The submitted-only selection, evidence-read scope predicate, team scopes, question response query and workbook structure are unchanged. The normal interactive detail reader still includes editing metadata by default. A focused preservation test compares every exported sheet, column and cell with and without editing metadata, including a multi-team record, revision number, N/A reason and Not seen outcome. The main task ran the integrated build/tests; the post-restart workbook comparison is recorded below.

An additional single sequential GET of the existing second QA review workbook, before the new backend build, returned HTTP 200 in 6,009.0 ms (39,522 bytes). It contains eight entry rows with 337 columns; thirteen sheets in total. The endpoint is read-only and does not write an export audit in this implementation. The baseline is `.localappdata/reporting-baseline/qa-before.xlsx`, with the exact review ID and request metadata alongside it. The post-restart comparison must permit only the `Export Information` generated-at value to change; all report data and answer columns should remain identical. This one observation is a parity baseline, not a reliable latency percentile.

Avoid replacing this with unbounded parallel evidence reads: that could increase SQL memory pressure. A broader batch query or background export queue should follow representative production-size measurements, not the small local baseline alone.

## After the integrated restart

Repeated at 13:16 BST against recorded API process 14048, using the same script, endpoints, academic year and concurrency of one. All fourteen requests returned HTTP 200. Every endpoint's item count and decoded payload size matched the before run exactly.

| Endpoint | Round 1 ms | Round 2 ms |
| --- | ---: | ---: |
| Dashboard configuration | 166.0 | 69.0 |
| Overview records | 536.7 | 657.0 |
| Overview dimensions | 358.8 | 431.6 |
| Overview actions | 118.2 | 181.6 |
| Elevate Status | 423.1 | 188.4 |
| Staff participation | 375.5 | 252.4 |
| QA summary | 343.5 | 274.6 |

Combined measured request time was 4,376.4 ms. These local timings vary with restart/cache state and other work; the dashboard sample is not evidence of a performance improvement or a meaningful regression. Counts and payload sizes provide the useful preservation check here.

The matching QA workbook GET returned HTTP 200 in 1,860.6 ms (39,521 bytes), compared with the earlier 6,009.0 ms observation. The bounded query reduction is consistent with a faster export, but one request per phase cannot isolate causation or establish production performance.

Workbook parity **passed**: all 8,474 non-generation-time cells across thirteen sheets matched exactly, including eight form-entry rows with 337 columns, all answer values, neutral reasons, metadata and summary measures. The sole allowed difference was `Export Information!B4` (Generated at). Raw comparison evidence is `.localappdata/reporting-baseline/qa-parity.json`. No further data changes or load testing were performed for this comparison.

## Later record-detail timeout diagnosis

The initial sample did not include generic record detail or the legacy staff-profile-summary endpoint. Later workflow verification exposed timeouts on these paths while LocalDB reported process memory pressure. The fast dashboard sample must not be used as evidence that every endpoint was healthy. The timing of this discovery after migration 089 does not establish that the migration caused the record-detail problem.

Read-only actual-plan probes used the existing synthetic Work Scrutiny record `3134ac58-d96c-4616-944f-e1f1affb05f0` and local administrator identity. The probe with only `OPTION(RECOMPILE)` pruned every visibility/auth table from the administrator execution plan, but still estimated 3,027 result rows where 34 existed. Hash joins over cloned form metadata and the wide response sort requested **58,480 KB**, waited **10,570 ms** for the grant and used at most **2,024 KB**. Execution took 10,593 ms. A loop-join hint alone subsequently timed out after 20 seconds; it was not adopted.

The accepted bounded fix first materialises only this record's active submission/section/field IDs in a session-local keyed table variable. The final query joins that field set while retaining all original permissions, draft, UCO and archive predicates, metadata eligibility filters and returned columns. `OPTION(RECOMPILE)` makes the small selected field set and permission parameters available to planning. Multiple active submissions remain supported; no TOP-one assumption or data change was introduced.

The measured revised query requested **2,000 KB** for the field-ID step and **1,264 KB** for the final detail step, with **zero grant wait** in both. Each step executed in 21 ms; final-query compile time was approximately 190 ms. All **34 returned source field rows matched exactly** against the original administrator result. A separate owner-only probe (global/scoped bypasses off) returned the same 34 rows; its two execution steps took 11 and 18 ms. The old owner-only query timed out at 20 seconds, so no successful old/new owner timing comparison is claimed. Both old and revised queries returned zero rows when owner/global/scoped access was absent. These are SQL predicate probes, not a full production authentication test.

Probe SQL, raw plans and results are under `.localappdata/reporting-baseline/record-detail-*`. The fix is confined to `GetRecordDetailAsync` in `SqlFoundationDataStore.cs`; no database settings, migrations, role definitions or stored data were changed. The separate staff-summary materialisation probe timed out and was not implemented. The main task instead removed that unused summary fetch from the UI. The rebuilt API and draft workflow require the main task's final verification.
# Record-list follow-up

The integration run subsequently exposed intermittent SQL timeouts on `GET /records` while record detail remained healthy. A read-only reproduction of the exact `GetRecordsAsync` query for the local administrator and academic year 2026/27, adding only `OPTION(RECOMPILE)`, returned 133 rows. SQL reported 63 ms compilation and 30 ms execution, a 1,224 KB grant and 3 ms grant wait. The actual plan contained only records, submissions, fields, responses and lookup tables: recompilation removed the unused visibility-function branches for this administrator. This sample includes temporary integration copies and is not a stable record-count baseline.

The source change adds that single query hint. An exact-text comparison against the pre-change extracted query, after removing the hint, confirmed every returned column, scope predicate and draft/year rule is unchanged. No permission bypass, database setting, timeout increase or data change was introduced. Further owner/denied workload probes were deferred while the draft/export lifecycle harness was active to avoid adding pressure to the memory-constrained local instance. The earlier record-detail owner/denied evidence above concerns the detail query, not this list query. Read-only plan artifacts: `.localappdata/reporting-baseline/records-list-original.sql`, `records-list-recompile.sql` and `records-list-recompile.txt`.

After a later Environment export and cleanup request timed out, a quiet read-only DMV snapshot showed 723,388 KB physical memory available to Windows, SQL using 93,668 KB with `process_physical_memory_low=1`, and only 6,360 KB total query-grant memory. No foreground request, blocking session or outstanding query grant remained at snapshot time. This supports a local resource limitation as well as the specific query-plan issues; it does not prove all failed operations share one plan defect. The integration task owns the pending exact-ID cleanup and rerun after restarting the API and releasing build processes. Snapshot artifact: `.localappdata/reporting-baseline/runtime-memory-diagnostic.txt`. No SQL configuration change or process termination was performed by this audit.
