# i-Elevate product experience review — 29 October 2026

## Outcome and decisions

Implemented the whole-system interface review while retaining the teal identity Harry requested. The work covers the shell, personal display settings, staff screens, workflow forms/registers, reporting, QA Hub and administration. Existing authorised backend/reporting/import/visibility changes in this checkout are preserved.

The interface now uses a calmer visual hierarchy, consistent meaningful icons, one workspace switch, clearer task language, progressive filters, proper keyboard interactions and recoverable loading/error states. Administration has dedicated searchable, grouped setting pages. Its home directory no longer repeats a second navigation tree; focused settings show their actual task first on narrow screens.

## Acceptance evidence

| Requirement | Implemented and checked |
| --- | --- |
| Consistent teal identity and readable surfaces | Shared light, dark and stronger-contrast tokens; measured text/action/border contrast tests; theme-aware required/error markers; quiet surfaces, coherent control sizing and focus styles. |
| Clear navigation | Permission-aware native sidebar links, purposeful Home groups, one workspace switch, direct dashboard selector plus searchable chooser, labelled mobile Menu, Escape close/focus return and skip-to-content target. |
| Less clutter and plain language | Search/order remain direct; secondary workflow/report filters are disclosed with active counts. Settings use the task as H1, collapsible guidance and grouped/searchable destinations. Optional message/HTML/history controls remain available on demand. |
| Personal display and accessibility settings | Device/light/dark appearance; three text sizes; comfortable/compact spacing; stronger contrast; line spacing; link underlining; reduced motion; navigation labels; reset. Apply immediately without losing the current form. Persist in this browser, sync valid cross-tab changes, migrate previous preferences and remain usable when storage is blocked. Available before sign-in/account setup. |
| Keyboard and semantic interactions | Shared searchable pickers, native dialogs, safe unsaved-change focus, accessible report menus, proper profile tabs/panels, linked form errors and named table scroll regions. A real ArrowRight press moved the overflowing probation table from scrollLeft 0 to 12. |
| Accurate feedback and recovery | Request generations/abort guards prevent stale records, histories and previews replacing the latest selection. Retry retains local work. Loading counts no longer imply zero records. Invalid profile/report dates have a linked correction instead of a false empty result. |
| Meaningful year context | Shared year control appears only where it is consumed. LIV/ALS LIV and probation retain their own all-year registers and full permitted linked-action history. Staff/year changes cannot briefly display a different profile or prior-year draft. UCO dashboard links survive cold reload after access is checked. |
| Responsive and enlarged layouts | Actual browser viewport checks at 320, 640, 1024 and default 1280 px. Corrected mobile report gaps, clipped ELI metrics, primary filter widths, hidden table-help overflow, enlarged preference footer and profile report-button overflow. |
| Existing data/access behavior | Complete frontend regression run: 280 passed, zero failed/skipped. Backend access/export/import/workflow suite: 539 passed, zero failed/skipped. Production TypeScript/Vite build passed. No application records, permissions, imports, settings, messages or published forms were changed during native QA. |

## Coverage inventory

| Area | Source/behavior review | Native evidence |
| --- | --- | --- |
| Shell, Home and workspaces | All route groups, permission gates, compact/expanded navigation and mobile behavior | Desktop and 320 px; mobile Menu/Escape returns focus; expanded labels survive intermediate desktop width. |
| Display settings | Model/provider, system appearance, migration, persistence, invalid/blocked storage, reset and independent controls | Larger text resolves to 20 px; dark/high contrast/compact/reading/links/reduced-motion combination applied; reload retained choices; 320 px dialog scrollWidth equals clientWidth after correction. |
| Sign-in, setup and account | Real handlers exercised with controlled rejected requests; required/native submit semantics, loading retry, dependent team reset and shared password dialog | Appearance entry point is shared with these screens. Live Microsoft sign-in/account creation/password changes were not executed. |
| Staff, My Team and profiles | Complete permitted-data filtering/sorting/paging; private outcomes remain excluded; directory/deep-link loading; section queries, stale responses, date errors and retries | Staff selection, real profile Overview/CPD keyboard tabs, loaded profile and My Team at 320/640/1024 px. |
| Learning/ALS Walks, CPD, Environment and Work Scrutiny | Published field types, historical choices, context, filters, paging, errors, busy/draft/cancel states | Real create/required-error/cancel paths for Learning Walk, external CPD and Work Scrutiny; error link focuses actual field; no submission. Narrow register sweep includes all variants. |
| LIV/ALS LIV and probation | Stage access/sharing/cycle protections, historical actions, status parity, selection races, register/filter/paging | Existing LIV visit client validation and Course level link; probation case/stage read navigation; real keyboard horizontal scrolling. No section visibility or stage was changed. |
| Coaching, ELI, UCO and Actions | Request ordering, form validation, cancel/focus, action commands, history and workflow boundaries | Coaching local unsaved create/error/cancel; ELI submitted result with all responses expanded; UCO create form with no eligible staff, clear explanation and Cancel returning to Create review; shared Actions picker/dialog/menu checks. |
| Main/UCO reporting | All dataset views, date/scope recovery, exact chart data, named staff register, accessible tables and metric labels | All 14 dashboard choices loaded on desktop and 320 px. Populated ELI metrics and UCO checked with Larger text; UCO survives reload; no console errors/warnings in final inspected preview. |
| QA Hub and configuration | Review setup/evidence/outcomes/actions, radio keyboard behavior, requests, draft guards and dedicated settings | QA workspace and administration at 320 px; question catalogue, settings search, CSV preparation and focused configuration navigation. |
| Main administration | Every active destination and embedded panel reviewed, including forms, people/access, organisation, assets, records, messaging and datasets | Search “rooms” produced the single relevant task; focused Rooms page renders before optional navigation at 320 px. Template/34-field preview and grouped directory verified. |
| Imports/downloads | Administrator checks, exact-file preview, stale-file and duplicate-apply protections, retained failure state; shared report/export recovery | CSV preparation and native export dialog/menu focus/Escape. No import applied, file uploaded or message sent. |

## Runtime layout matrix

- At 320 px with Larger text, all staff-facing route entry screens were inspected. Loaded profile/My Team were rechecked after their requests completed. QA and both administration directories were checked separately. Final repaired screens do not expand the page beyond the viewport; wide data remains inside keyboard-scrollable tables.
- At 640 and 1024 px, thirteen main staff/workflow/admin screens were checked with Larger text, dark appearance, stronger contrast, compact spacing, extra line spacing, underlined links and reduced motion together. Page widths remained within their viewports.
- Native populated ELI reporting exposed an actual clipped summary metric that static tests had missed. Its mobile layout now shows the theme/distribution above three labelled, bounded metrics. The complete submitted ELI response view also fits at 320 px.
- Final viewport overrides were reset. Preview preference changes used port 5174 only, separately from the standard local app on port 5173. The temporary iframe review file was removed before production builds.

## Verification

The complete frontend command was `node --experimental-strip-types --test tests/*.test.mjs`. The web production command was `npm run build` in `apps/web`, which runs the actual `tsc -b` project build before Vite.

Backend verification used `TLQS_TEST_SQL_MASTER` with isolated test databases, `MSBuildEnableWorkloadResolver=false` and `dotnet test tests/access-control/TLQS.AccessControl.Tests.csproj -c FilterReview -p:UseAppHost=false --no-restore --nologo --verbosity minimal`.

The standard local web app/API were confirmed ready using `scripts/start-local.ps1 -SkipDatabase`. Database preparation/seeding was skipped.

## Detailed reviews and evidence

- [Shared visual foundation](product-foundation-2026-10-29.md)
- [Navigation and shared interactions](product-navigation-review.md)
- [Workflow forms and registers](product-workflow-review.md)
- [Reporting experience](product-reporting-2026-10-29.md)
- [QA and administration](product-administration-review.md)
- [Earlier dashboard/data/Excel work](dashboard-excel-overhaul-2026-10-29.md)
- [Earlier system filter/sort audit](system-list-filter-sort-review-2026-10-29.md)

Screenshots and raw run logs are repository-related, ignored review artifacts under `.localappdata/local-run/product-review/`, `product-workflow-review/`, `product-tests-final.log` and `product-build-final.log`.

## Practical limits

This is source-wide implementation and targeted native/handler verification, not a claim that every possible live CRUD action, production role, screen reader, browser or device was exercised. Data-changing, access-changing, publication and delivery scenarios were validated through code/controlled responses rather than performed against the user's data. Windows forced-colour cascade and contrast were checked in stylesheet tests; no native OS accessibility setting was changed. Live Microsoft authentication/credential changes were not required for the interface review.

Accessibility work follows W3C guidance on [keyboard access, readable content and operable controls](https://www.w3.org/WAI/WCAG22/Understanding/), including [visible focus](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance). The product-quality request is not a claim of formal WCAG AAA certification.
