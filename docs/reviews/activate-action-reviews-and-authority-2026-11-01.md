# Activate+ action reviews and shared action authority

Activate+ follow-up reviews carry forward their original central actions. The Review actions page now provides native Record progress, Close action, Extend action and, for completed/cancelled actions, Reopen action controls. Each saved review records a distance-travelled/outcome note, optional evidence link, authenticated updater and timestamp. Extensions require a later review date and a reason; native and central dates remain aligned. The original action, responsible people and source review are retained.

The form displays the original impact measures, latest distance-travelled note, carried-forward origin and how many actions have a dated review in this follow-up. An optional review-record reference in the existing JSON update history identifies the meeting in which an outcome was recorded. The server validates that this is an accessible Activate+ review containing the action in its own or previous review ancestry. No new table or migration is required.

Action review notes save immediately to the live shared action, independently of meeting minutes and formal review submission. Existing unsaved-change protection applies. Failed/conflicting saves retain entries and their concurrency token. A failed explicit reload removes unverified previous edit capabilities. Full dated history remains available; historical support/impact evidence stays readable.

## Authority

Action management follows the action's recorded creator. It is granted to:

- The creator's account.
- The creator's active line-management chain.
- Effective organisational manager leadership above the creator's current primary or secondary memberships, including programme, faculty and director levels.
- An active Administrator or Teaching & Learning team member.

Being the responsible person, associated staff member, source review owner, participant, or a holder of broad report/action-view permissions does not independently grant mutation rights. Expired leadership/memberships, another organisation branch and absent creator information do not manufacture authority. Historical actions without a creator require Admin/Teaching & Learning oversight.

The central inbox uses a server-provided capability instead of guessing from staff IDs or roles. All generic update/complete/reopen/cancel/extend/delete/restore operations independently enforce authority at the server. Native process action updates, QA group review/closure, Coaching saved/prior/revised actions and legacy ELI conversion/correction paths use the same creator rule.

Existing source-workflow locks, protected native metadata, archived sources and optimistic concurrency remain separate requirements. A management right over an action does not expose the underlying review narrative. Parent-source archive/restore workflows retain their own lifecycle permissions; this change concerns independent action management.

Coaching preserves unchanged read-only actions and prior reviews during unrelated session narrative saves. Read-only actions cannot be edited, removed or have their history erased. A cycle cannot close while an unresolved action that the viewer cannot manage is carried forward.

## Verification

Verification uses focused frontend interaction tests, disposable SQL databases and isolated actual-component browser fixtures with dummy data. No fixtures are loaded into the prepared local application database. Logs/screenshots are kept under ignored `.localappdata`.

The full frontend suite passes **524 tests** and the full backend Release suite passes **700 tests**, with zero failures or skips. The production web build passes, including TypeScript; the existing main-bundle size advisory remains. Actual desktop/mobile previews cover the inbox, Coaching and the Activate+ follow-up form, including read-only permissions, required distance notes, extension reasons, shared source identity, preserved unsaved meeting notes, denied reloads and 390px containment.

Local services were restarted with `-SkipDatabase`. Read-only checks confirm healthy API/database/web services, the updated identity contract, central/deleted-history action reads, native review/action reads, QA Hub and Coaching. The prepared database retained its two staff, six core records and zero actions across the restart; populated outcome and permission checks ran only in temporary test databases or browser fixtures.

No commit, push, merge or deployment is part of this change.
