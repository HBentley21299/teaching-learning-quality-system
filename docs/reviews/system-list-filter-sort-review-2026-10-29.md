# System list, filter and sorting review

29 October 2026. Local implementation; existing development data preserved.

## Coverage

This review covers every active route and the shared selectors used inside forms. The detailed inventories are [workflows](filter-audit-workflows.md), [QA and administration](filter-audit-admin-qa.md) and [dashboards](filter-audit-dashboard.md).

| Area | Result |
| --- | --- |
| Learning Walks, ALS Learning Walks, CPD, Learning Environment, Work Scrutiny | Full-register business-field search; named people, saved themes, rooms, form type and participant context where applicable; status/area/person/date filters and typed global sorts. Generic record metadata is projected in the listing query, avoiding one detail request per record. |
| LIV / ALS LIV, probation, coaching, ELI, actions, UCO reviews | Process-specific filters and sorts reflect actual saved data, cycles/observations, reviewers/owners, source process and historical labels. LIV and coaching years come from their source records. |
| Staff, Staff Profile, My Team | Searchable staff selection; job/account filters in the directory; role/account/outcome/exact-level filters and all visible-column sorting in My Team. Restricted profile outcomes are excluded from search/filter/sort values. |
| Profile record sections | CPD, coaching, LIV, probation and action filters/sorts run on the server before pagination. Filter choices come from the complete permitted section. Inputs stay mounted during loading and empty results. Aborted or superseded responses cannot overwrite a newer query. Independent section loading state supports concurrent expansion. |
| Form catalogue | Search by template name/key/module/status/allocated area; saved statuses and allocated-area choices; sort by name, status, module, area, version or submission count. Filtering preserves the currently selected editor and unsaved content. |
| Shared form selectors | Staff, rooms, courses and CPD participants have multi-term business searches and explicit natural sorts. Silent 8/10-match caps removed; scrollable results expose every match. Saved unavailable choices remain represented. |
| Excel area chooser | Active and historical faculties and all supported sub-team types; code/name/parent search, area status and code/name sorting. Searching does not discard selected areas. |
| Main/UCO/QA dashboards | Explicit all-field sorting and combined field filters, saved-answer choices, named staff and action refinements. Direct grouped dashboard selection and bounded per-workspace request reuse speed switching. |
| QA Hub and QA administration | Review/evidence/action/question catalogues, access rules, outcome settings and related registers reviewed. Source-derived filters and relevant sorts added. |
| Main administration | Accounts, permissions, scope/organisation, records, managed lists, rooms, themes, dashboard configuration, ELI, scrutiny, CSV import previews/reference lists, messaging templates and complete delivery history reviewed. |
| Messaging delivery history | New admin-authorised paged endpoint searches the full history beyond the previous 500-row ceiling. Server filters/sorts precede paging; options include historical status/trigger/recipient groups. |

## Ordering and scope decisions

- Workflow stages, published question/answer order, rubric levels, dashboard configuration order and navigation groups retain their deliberate order. Reordering controls act only in the unfiltered configured-order view.
- Creation pickers continue to offer permitted active choices. Registers and saved forms retain historical labels and selections.
- Summary charts and explicit top-five/top-three summaries retain their ranking; underlying registers remain available in full.
- CSV reference previews explicitly label the first 100 displayed rows and offer the complete reference download. Import preview filtering and sorting precede its pagination.
- Dashboard detail-table refinements remain separate from the reporting/export scope, with this distinction stated beside the controls.
- No record permission or LIV section-visibility grant is widened. Generic list summaries are limited to the ordinary form processes; private LIV section text is not projected into the generic register.

## Dashboard switching

The request cache belongs to one mounted dashboard workspace and is keyed by account, staff identity, permissions/scopes, academic year and dataset/process. Entries expire after 60 seconds, failures are removed and Refresh clears the cache. Recent in-flight requests are shared; no cache is persisted or shared between users.

The real route-handler regression for LIV → CPD → LIV makes 7 initial calls, 4 additional calls for CPD, and no additional calls when returning to LIV within the cache lifetime. Refresh makes the LIV dataset requests again. Elevate Status avoids three unrelated record/action/dimension requests.

## Acceptance checks

Validation includes business-field search/sort handler tests, historical selections, global paging, stale-response guards, permission-scope SQL tests, a production frontend build and local browser/API checks. Final execution counts and any practical verification limits are recorded after integration below.

### Final execution

- Backend: **539 passed, 0 skipped**. Wider list-query database fixtures run in a non-parallel collection because simultaneous disposable database workloads exceeded LocalDB's shared resources during the first integrated run; the final complete suite passes in 33 seconds.
- Frontend: **191 passed**, including real handler checks for numeric sorting before pagination, restricted profile values, exact server query arguments, stale responses, independent section loading, debounce/collapse/reopen and displayed default-sort parity.
- Generic record SQL: **11 assertions passed** against CTE-only fixtures in master, with no table writes. Covers draft CPD participants, duplicate/invalid participant IDs, draft environment room/building, retired LW/ALS theme snapshots, latest-submission selection and exclusion of private LIV narrative/theme content.
- Production frontend build passes. The existing large main-bundle advisory remains; this work reduces repeated dashboard data requests and route-switch work.
- API restarted with `scripts/start-local.ps1 -SkipDatabase`. Readiness confirms database connectivity. Generic records, coaching, LIV, paged messaging and all five paged profile routes return successfully. Profile empty pages clamp to page 1 and include filter metadata.
- Browser: direct dashboard navigation, all-field sort choices, a combined saved-person field filter, existing named record, empty profile controls and My Team filtering/level sorting verified. Dashboard and team pages have no document-level horizontal overflow at the inspected desktop viewport.

The local database is sparse, so populated combinations beyond its existing records are verified with isolated/CTE fixtures and deterministic component responses. No startup fixtures, CSV applications, record edits, permission changes or database restoration were performed.
