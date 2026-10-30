# Dashboard filter, sorting and switching audit

29 October 2026. Repository changes only; no records, fixtures or imports were created for this work.

## Native reporting inventory

| Area | Search and filters | Sorting | Scope and export behaviour |
| --- | --- | --- | --- |
| Main dashboard selection | Direct grouped selector plus existing searchable grouped chooser; permitted destinations only | Admin-configured dashboard order retained | URL view/section restoration retained; choosing the current dashboard preserves filters |
| Dashboard reporting scope | Academic year, saved faculty/team, date, record status, theme/focus, learning-walk delivery area, exact Elevate level where applicable | Summary charts retain their deliberate ranking/chronological ordering | These are the reporting/Excel filters; annual staff cohorts continue to use year and organisation rather than record dates |
| Form data, including QA and UCO form data | Multi-term search across identities, every saved business answer and child tables; combined per-field contains/equal/not-equal/missing/present/numeric/date filters | Explicit Sort by for **all** available business columns, including hidden columns, plus order; existing table-header sorting retained | Search, field filters and sort refine the native register. Excel retains the dashboard scope and exports all business columns. UI states this beside the controls |
| Linked actions | Search includes every displayed business field, human status/source and dates; saved owner/source/state choices | Every displayed field: title, theme, owner, associated staff, source, area, raised/due/completed dates, derived status | Local controls refine the action table; dashboard/export filters remain explicit. Cancelled/completed/overdue/open semantics remain shared |
| Elevate named staff | Existing exact-level dashboard filter, expanded multi-term search, attendance-progress filter | Name, confirmed level, attendance, faculty, team, next level, sessions remaining and last confirmation | Attendance threshold is not treated as an awarded level. Local attendance filter does not silently change Excel |
| ELI submission coverage | Existing all/submitted/not-submitted controls, recorded area and multi-term search including submission details | Every displayed field: staff, area, submission status/date, assessment availability | Coverage uses the year/organisation cohort, as stated in the section |
| Faculty/team comparisons | Multi-term business-field search; general comparisons also offer overdue/open actions, coverage gaps and no activity | Name/code, activity/coverage, outcomes, record/completion counts and actions; Elevate also has staff/percentage ordering at each cumulative level | Local comparison controls; totals and percentage denominators remain process-specific |
| UCO review register | Workflow stage remains the reporting filter; lecturer, observer, saved course/module and follow-up choices plus multi-term search refine the register | Lecturer/observer/title/course/module, observation/workflow, section/action counts, discussion/follow-up date/status | Local scope is explicitly labelled. Annual staff coverage remains annual. Register paginates at 15; original review access and released-form-data permissions remain unchanged |

Choices are derived before local search/filter/pagination from the complete returned permitted dataset. Retired saved answers, course names and observers are retained. Inactive organisation units referenced by permitted reporting rows/actions/cohorts are included where the organisation's dashboard-inclusion and assigned-scope checks allow them. Technical IDs, row versions and LIV sharing flags remain excluded from form data.

## Switching work removed

The old route reloaded dashboard configuration and the all-process annual staff-coverage endpoint on every process switch. Elevate Status also requested outcomes, actions and submitted records which its native view does not display. Previous process arrays were still used in derived calculations during the first loading render of the new view.

A per-mounted-workspace cache now deduplicates pending and successful scoped requests for 60 seconds, with at most 48 entries. Cache keys include account, staff identity, explicit administrator flag, permissions, scopes, year, dataset and process where applicable. The cache is not persisted or shared between accounts. Failed requests are evicted; explicit Refresh clears cached requests and reloads faculty settings. Bulk form-data responses can be reused when returning to their exact reporting scope. UCO uses the same bounded workspace cache with its access capabilities included.

Deterministic real-route request-count tests show:

| Scenario | Before | After |
| --- | --- | --- |
| First LIV load, including faculty settings | 7 requests | 7 requests |
| Then switch to CPD | 6 additional | 4 additional |
| Return to LIV within the cache lifetime | 6 additional | 0 additional |
| Total for LIV → CPD → LIV | 19 | 11 |
| First Elevate Status load | 8 | 5 |
| Explicit LIV Refresh | Full live request batch | All 7 calls fresh, including faculty settings |

These are verified network-call counts, not a claimed wall-clock benchmark. Backend duration still depends on cohort size, SQL execution and record projections. Year-wide staff participation remains a relatively broad backend request; returning only the requested process is a possible later optimisation if profiling justifies it.

## Verification

Focused tests exercise direct navigation, account/year scope changes, pending-response races, cache expiry/capacity/failure/refresh, real route request fan-out, historical organisation choices, hidden typed-answer sorting and combined filters, UCO historical people/session choices, register/export distinctions, ELI coverage and faculty percentage denominators. Existing header sorting, linked-action state rules and URL/permission checks are retained.

Bulk business projection data is still fetched only when a form-data section is opened. Expanding records or adding native field filters does not issue per-record requests. Failure states remain explicit and do not present missing datasets as zero.
