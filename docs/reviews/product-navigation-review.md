# Product navigation and shared interaction review

Reviewed on 29 October 2026 as part of the wider i-Elevate product experience overhaul. This is the shared navigation/component portion; it does not claim completion of the whole-system review.

## Scope and decisions

- `app/navigation.ts`: retain established business names, routes and permission checks. Use a coherent domain icon for each activity: Footprints for Learning Walks, ClipboardPenLine for LIV, ClipboardCheck for probation, School for UCO, BookOpenCheck for Work Scrutiny. Standard/ALS variants retain the same activity icon.
- `routes/Home.tsx`: put a compact greeting and real destinations first. Remove random coffee/motivational messages and the large animated mascot scene. Retain product identity elsewhere in the application, grouped task descriptions and permission-filtered destinations. Describe ELI in plain language instead of repeating its name as its description.
- `WorkspaceSwitch.tsx`: retain compact/sidebar and full layouts; use a normal right arrow for navigation within the application. Clicking the current workspace remains a no-op. App shell placement is handled separately.
- `DashboardNavigator.tsx`: keep immediate native dashboard selection. Present the searchable chooser as a small search action, removing a second prominent “Switch dashboard” control. Announce search result counts and use singular/plural correctly. No data requests or reporting scope rules change.
- `AdminSettingsLayout.tsx`: preserve the grouped searchable directory and dedicated setting pages. Keep task instructions available in a disclosure instead of showing them on every setting by default.

## Interaction defects corrected

- Staff and room searches no longer overwrite a live query with the old selected label. Opening a selector makes the available directory browsable while retaining the saved value until the user types or chooses a replacement. Historical selections outside the available directory remain intact.
- Staff, room, course and CPD participant selectors share keyboard navigation. ArrowUp starts at the last result; ArrowDown starts at the first. Active options scroll into view. Enter chooses a result and cannot accidentally submit a surrounding form when there are no matches. Escape closes the popup and stops propagation; a second Escape can reach the surrounding dialog.
- Sort controls appear while a picker is expanded and remain reachable with normal Tab navigation. Every actual match remains available. Search/count/status labels and popup references are explicit. Course search now has its supplied input ID, restoring external label associations. Disabled course inputs do not advertise or render an open popup.
- Native modal dialogs share focus restoration, busy-state cancellation and optional initial focus on a marked heading or safe action. StrictMode effect replay closes before reopening the native dialog. The unsaved-change prompt uses this primitive, initially focuses “Keep editing”, and clearly labels “Save and leave” and “Discard and leave”.
- Collapsible sections tolerate blocked browser storage, keep a valid `aria-controls` target when closed, and preserve lazy content rendering. Loading sections expose a busy state. Pagination announces the page and hides decorative icons from assistive technology.
- Shared data tables label column headers, support a descriptive caption and useful empty state, and add a keyboard-focusable horizontal scroll region only when their contents actually overflow. Fitting tables do not add an unnecessary Tab stop.
- Action themes show a loading state, avoid presenting choices from the previous source during a request, retain historical selections and offer a retry after failure.
- Excel export selection uses the shared modal with a focused heading instead of a separate full-window overlay/card. Word exports recover from rejected requests. The report-format menu supports arrow-key entry, wrapping, Home/End, local Escape and dismissal when focus leaves; old report errors cannot overwrite a newly selected module.

## Verification completed in this portion

- `node --test tests/product-shared-usability.test.mjs tests/dashboard-navigator-component.test.mjs`: 20 tests passed. These exercise actual event handlers and resulting elements for retained values, keyboard selection, Escape/Enter behavior, group additions, recoverable theme/export failures, report-menu navigation, dialog focus/busy cancellation/restoration, blocked storage, overflow focusability, permission-filtered Home content and the single-directory administration overview/focused task order.
- Existing picker coverage in `workflow-list-filters.test.mjs` uses the real new keyboard helper and passed during the focused run. Five unrelated workflow tests required the workflow component harness to traverse the new `WorkflowFilters.primary` slot; that work belongs to the workflow review.
- `node node_modules/typescript/bin/tsc -b --pretty false` in `apps/web`: passed.
- Native preview on port 5174: verified the real Action owner picker retains its selection when opened, ArrowUp selects the last result, Tab reaches result sorting without closing, no-match Enter retains the editor, and Escape closes the popup. The unsaved prompt initially focuses Keep editing. Discarded only local unsaved test input; no record was submitted. Excel export dialog initially focuses its heading and Escape restores its Export Excel trigger. Report-menu ArrowUp focuses Excel, ArrowDown wraps to PDF, and Escape restores Export. Screenshot: `.localappdata/local-run/product-review/unsaved-changes-safe-focus.png`.

## Integration checks still required

- Remaining combined browser verification: narrow layouts, contrast modes, keyboard interaction with a picker nested inside a real modal and actual horizontal table scrolling. Core wide-layout interactions above were verified.
- Complete route-by-route and role-by-role review is tracked by the wider goal. The shared component tests do not establish completion of forms, QA, reporting or administration pages.
- LIV visibility dialogs are owned by the workflow review. General editor close actions should restore focus to their launch control if their previous Cancel trigger is removed; the real Actions editor revealed this issue and it was handed to the workflow owner.
