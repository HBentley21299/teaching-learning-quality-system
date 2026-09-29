# Forms, dashboards, exports and permissions review

## Scope and acceptance evidence

The active request is a comprehensive review, not a form redesign. Preserve saved answers, workflows and existing form questions; mandatory CPD is the explicitly requested new form. Treat UCOCLA as UCO TLA pending any correction.

| Requirement | Implementation / evidence | Remaining verification |
|---|---|---|
| Every form reviewed for logic and usability | Form-by-form audit completed in docs/forms-and-permissions-review.md, including eight QA activities | Authenticated visual review |
| Improve UI without changing form contracts | Dashboard analysis and organisation comparison use existing accessible collapsible component | Render browser views at desktop/narrow widths; review navigation and empty/loading/error states |
| Intuitive, process-specific dashboards | Existing process-specific KPI and evidence views audited; ELI statement facts corrected to use actual saved answers only | Full process matrix; identify and implement remaining misleading/generic measures; PDF parity |
| Dashboard admin faculty dataset controls | Dedicated bulk checkbox panel for 15 dataset keys; server faculty exclusions with hierarchy propagation | Migration 088 applied with explicit approval; runtime save/reload and exclusion parity for all endpoints/exports remain |
| Microsoft Forms-style Excel for every dashboard | Export workstream improving complete horizontal entry rows and headings including QA and ELI | All 14 dashboard workbooks verified; Work Scrutiny clone alignment verified; final QA-specific exports pending |
| Mandatory CPD only logged by T&L, on profile, excluded from Elevate | Separate template and permission; migration 087 prepared; policy/credit updates | Migration 087 applied; test submission appears on profile and leaves Elevate attendance unchanged; update/permission checks remain |
| Intuitive permissions including nonacademic users and custom tiers | Dedicated permissions admin, staged allocations, capability builder | Policy checks and runtime create/edit/conflict/audit passed; authenticated UI review pending |

## Data and deployment

Preserve current local database and all existing uncommitted changes. No GitHub writes/deployment authorised. Harry subsequently explicitly requested local test data, which was loaded through the manual fixture scripts. He approved migrations 087/088: both have now been applied in one guarded transaction and recorded in the migration ledger. The application was restarted with -SkipDatabase. Startup does not reload fixtures.

## Dashboard data findings

- Faculty inclusion was organisation-wide only. Added independently configurable dataset exclusions; global inclusion remains an outer guardrail. Operational records remain available.
- The SQL statement drilldown for ELI previously substituted the practice-area score for absent statement answers. Missing statement answers must not be counted as supplied responses. Both statement fact queries now join actual saved statement rows.
- Cross-process averages are not necessarily comparable (different denominators/scales); assess each panel against its source form during completion review.
- Repeated form collections need deterministic separate columns and no fabricated answers. Raw entry spreadsheets must not depend on the visible chart aggregation.

This document tracks unfinished work. Builds alone do not prove the full goal complete.

## Integrated verification update — 29 September 2026

- Combined backend suite: 371 tests passed, none failed/skipped, after CPD multiple-faculty export regression coverage and administration read-access alignment.
- Web production build passed. A subsequent TypeScript check covers the unsaved-settings navigation changes.
- Eleven focused Node tests passed for faculty hierarchy exclusions, CPD attendee scope and Work Scrutiny/ELI grouping. Neutral-only groups remain visible without contributing numeric scores; section/statement dimensions do not double-count.
- Work Scrutiny now exposes expandable section/statement outcomes. Course/level frequency excludes rubric facts. PDF and UI dimension filters retain the selected section's statements.
- CPD export handles multiple selected faculties and zero-attendance owner-area fallback. Empty dashboard query values resolve to the ordinary process scope.
- Dashboard faculty selections and layout now participate in the Admin Centre unsaved-changes guard; browser unload warns. Inputs cannot change while their save is in progress; failed layout saves no longer report success.
- Expanded PDF regression fixture generated locally without database changes: 126 entries and a 100-paragraph response, producing 46 A4 landscape pages. Visually inspected pages 1, 3 and 46: summary/chart, response continuation and final entries were readable with no visible overlap/clipping. This is representative renderer evidence, not proof of all live process exports. Poppler logged missing Symbol/ArialUnicode display-font warnings; inspected ordinary text rendered correctly. Unicode-rich export cases remain to be checked.
- Per-form recommendations are in `docs/forms-and-permissions-review.md`; process/Excel coverage is in `docs/reviews/dashboard-excel-audit-2026-09-29.md`. All live team-template variants still need the definition-query runtime retest.

Current outstanding checks are final corrected PDF/QA exports and authenticated browser review. Migrations, restart, mandatory CPD create/edit/profile/credit checks, custom-tier save/conflict/audit, all published form-definition reads and the dashboard Excel matrix have passed. No full visual sign-off is claimed.

## Read-only runtime audit follow-up

The local database template inventory and all 46 Work Scrutiny definitions have now been compared without changes to the database. Every variant has eight sections, 34 fields and 15 rubric statements. Definition hashes (section title, label, type, required flag, help text and configuration) agree for every field across the 46 variants. The revised GetFormDefinitionAsync SQL was executed directly for the previously timing-out template and returned its 34 fields in 240 ms. This confirms the SQL path but does not replace post-restart HTTP testing.

Browser verification reached the local sign-in page at http://127.0.0.1:5173. No authenticated session is available in the in-app browser. No login bypass or fixture reload was used. Migration approval was subsequently supplied and both migrations applied; authenticated browser verification is still pending. Last TypeScript check passed after the admin unsaved-settings changes.

## Dashboard availability regression fixed

The running API returns 404 for /reports/faculty-selections because it predates the pending migration and endpoint. The new frontend incorrectly treated that absent optional capability as a prerequisite for all dashboard rendering. Confirmed the existing configuration, dimensions, actions and process-record endpoints return HTTP 200. Added a narrow compatibility path for this endpoint's HTTP 404: existing organisation reporting continues and an informational message explains that per-dashboard faculty selection is not active. HTTP 401/403/500, timeouts and other missing endpoints do not use this fallback. Settings errors have their own state so other requests cannot clear them. Dashboard data requests now load concurrently. No database migration, reset or API restart was used for this repair.


## Approved migration and runtime continuation — 29 September 2026

- Migrations 087 and 088 applied successfully, with recorded checksums. The mandatory template also copies field configuration as well as validation.
- Current API serves all 15 faculty dataset keys and the custom permission catalogue. The mandatory logging capability is excluded from assignable custom permissions.
- A labelled mandatory CPD runtime fixture was submitted for Test Colleague 01 and Test Colleague 12. Test Colleague 01's paged profile shows it with `isMandatory: true`; eligible internal CPD attendance remains 3 before and after submission.
- Five actual Excel exports passed initial inspection: overview, Elevate status, actions, coaching and LIV. Each starts with Form entries and has unique readable horizontal columns. Remaining exports are being checked serially.
- Intermittent SQL timeouts affected authentication and background messaging as well as exports. SQL reports low physical memory; no blocking user query was found. Build servers were shut down to release resources. Subsequent dashboard data requests and the mandatory profile/status checks succeeded. This is an environment limitation under investigation, not evidence that every runtime path passes.
- The in-app browser still shows the sign-in screen. Authenticated visual verification remains outstanding.

Earlier sections describe historical checkpoints; this entry supersedes their pending migration/restart status.

## Runtime acceptance checks completed

- All 50 published form definitions returned successfully over HTTP, including all 46 Work Scrutiny variants. Each Work Scrutiny definition contains 34 fields. Per-definition timing was 0.03–0.25 seconds in this run.
- Faculty selection save/reload passed: excluding CUDC from the ELI dataset removed its faculty/team records (107 to 96 records in the source endpoint); the independent overview record IDs were unchanged. Original selections were restored and compared exactly.
- Custom tier creation and editing persisted; stale row-version update returned HTTP 409. SQL audit contains one creation and one update. The labelled runtime tier is unassigned; no person's permissions changed.
- Mandatory CPD attendance rows for both test colleagues have milestone_credit = 0. Profile visibility and unchanged eligible attendance count were verified through the API.
- All 14 dashboard Excel endpoints returned successful workbooks after serial retry. Inspection identified duplicated equivalent Work Scrutiny columns across cloned team templates; this is being corrected and will require a targeted re-export after restart.
- Mandatory CPD update returned HTTP 204 after restart; the earlier retry failed during compilation-related SQL pressure. Current health endpoint reports healthy/database connected.
- Work Scrutiny cloned-template export alignment passed eight focused builder tests; the updated API is running. No additional database migration was needed for this correction.
- Post-restart Work Scrutiny export confirmed equivalent cloned questions align: the same 12 rows reduced from 403 to 63 columns, with original template metadata retained. Customised definitions remain distinct.

## PDF scope correction from visual review

The initial database-backed PDFs rendered without clipping but included a full raw-form appendix, producing 209 pages for 13 ELI entries and 82 pages for 12 Work Scrutiny entries. That exceeds the requested expanded-dashboard PDF scope. The raw appendix is being removed from dashboard report sections; Excel retains full form rows. Dashboard metrics, outcome/statement breakdowns, organisation comparisons, actions and other visible dashboard sections remain expanded. Those initial PDF files are superseded verification artifacts, not the final accepted exports.
- Final PDF correction passed 11 focused tests, including UCO dashboard sections and absence of raw Excel-only responses in dashboard PDFs. The PDF endpoint now skips workbook-entry queries; Excel keeps its default full-entry path. Shared filter validation still applies to both formats.
- Final local restart completed and /health/ready reports healthy/database connected. Compiler and MSBuild servers were shut down after compilation to release resources. Database-backed final PDF/QA rechecks are in progress.


## Final dashboard PDF verification

All 14 dashboard PDF endpoints succeeded on the final build. The overview completed in 3.03 seconds, versus the earlier raw-appendix path timing out at 180 seconds. UCO completed in 1.38 seconds; remaining process reports completed in approximately 2.5–15 seconds in this run. Work Scrutiny reduced from 82 to 30 pages, and ELI from 209 to 36. Representative rendered summary and final statement-distribution pages were inspected without overlap or clipping. The raw form data remains in Excel. These local timings are verification observations, not production performance guarantees.

Only QA-specific export completion and authenticated browser review remain at this checkpoint.

## QA Excel bottleneck isolated

Cycle 1 Excel timed out once and later completed in approximately 158 seconds; cycle 2 timed out at 180 seconds. Both QA PDFs succeeded. Five live SQL samples isolated the response-detail query waiting on RESOURCE_SEMAPHORE, with 7,424 KB requested against a 6,240 KB available query pool and no competing grantees. The inclusion query took 29 ms; ordinary evidence detail reads subsequently took under one second.

A two-stage response query resolves the evidence activity and neutral-option flag first, then reads its questions/responses directly. Direct SQL verification requested/granted 1,024 KB, used 16 KB and had zero grant wait; execution including sqlcmd startup took 0.298 seconds. The twelve response columns, ordering and existing permission check are preserved. The application change is in focused testing, followed by byte-value comparison of the previous and regenerated workbook cells. No SQL memory setting was changed.

## Final authenticated browser review — 29 September 2026

The final QA Excel exports succeeded for both seeded reviews (26.63 and 35.69 seconds); the first workbook matched the previous export value-by-value. All 14 dashboard Excel/PDF exports and both QA review Excel/PDF exports have passed runtime checks. The focused backend export/policy run passed 112 tests.

Authenticated browser checks covered the admin directory, per-dashboard faculty selection and discard guard, staff access and custom-tier views, the consolidated Form Editor and QA scale settings, Work Scrutiny section-to-statement expansion, Elevate Status cohort and levels, and the mandatory CPD entry form. Staff permission cards now use theme colours, fixing unreadable names in dark mode. The dashboard admin link now says Dashboard settings and explains faculty inclusion. Staff loading is distinguished from an empty search result. The workspace switch's small horizontal overflow at a 692-pixel panel width was removed; the temporary desktop viewport override was reset.

Executive overview now reports completed/submitted/closed activity with its denominator rather than pooling unrelated process scores. The PDF summary uses the same status rules and team definition. Elevate Status and Actions navigation badges are shown only when their own dataset is available, avoiding misleading zero or other-process counts. Mandatory CPD creation explains that attendance appears on profiles without Elevate credit; the combined internal/mandatory event list retains its accurate CPD event label.

The production web build and 21 focused Node tests passed. The final overview summary regression check passed with 11 focused backend tests; TypeScript and the final running API/PDF are checked after the last small adjustments. Existing form contracts and submitted data were preserved. Local runtime timings are not production load-test results.

Final acceptance: the last TypeScript check passed. The final API restart used -SkipDatabase with the existing Windows account context; readiness reports healthy/connected. The regenerated overview PDF contains 82 of 107 completed/submitted/closed records and 10 teams, matching the visible dashboard. No pooled cross-process grade remains in its summary. Build-server shutdown released compilation resources; transient local SQL timeouts during compilation recovered. Browser verification is representative, not a claim that every possible role, data volume and device combination has been exhaustively tested.
