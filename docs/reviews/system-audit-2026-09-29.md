# System audit and decision register — 29 September 2026

**Follow-up:** Harry accepted A–K, specifying Administrator-only control for A, and deferred L's full-scale stress test while authorising a modest optimisation pass. See [the implementation and verification record](audit-implementation-2026-09-29.md). The findings and Pending labels below describe the original audit before that decision; P1–P7 remain separate policy questions.

## Outcome and scope

The requested account identifier has been removed from the shared staff profile card in `apps/web/src/features/StaffProfilePanel.tsx`. This removes both `ENTRA_…` values and other technical external identifiers from that card without changing identity matching, permissions, stored data or authentication. The local browser was checked using both Harry Bentley and the Entra-backed Pl Demo profile; neither card displays the identifier. TypeScript compilation passed.

Harry confirmed this is a **local update**. No deployment or GitHub write was performed. Other changes in this report are proposals awaiting acceptance, not implemented fixes. Existing worktree changes from earlier requests were preserved.

The audit covers the current application shell, staff/profile/team workflows, operational form families, all eight shared QA activity paths, admin screens, permissions and organisation scope, reporting/export architecture, errors and operational safeguards. It combines current source inspection, local browser checks and existing policy tests. It is not a penetration test, full assistive-technology certification, production load test or proof of the deployed college configuration.

**Main conclusion:** the system has useful workflow and reporting controls, but delegated account administration, unsaved work and failed dashboard loads need attention before this update is considered ready for wider use. Passing policy-helper tests does not close the API/database gaps identified below.

## Recommended decisions

Each row is a separately selectable proposal. All remain **Pending**. Accepting a row means implement its stated scope and acceptance checks; it does not approve unrelated migrations, live deployment or changes to existing staff access.

| ID | Priority | Problem and proposed change | Evidence / acceptance |
| --- | --- | --- | --- |
| A | High | **Control who can allocate privileged roles.** Account management currently permits assigning roles the acting person does not hold, including Admin. Separate account maintenance from access allocation and enforce grant limits in both account-create and account-update APIs. | Permissions audit P1 allocation finding. Verify delegated account managers cannot grant themselves or others Admin/T&L or unowned capabilities; full authorised administration still works. |
| B | High | **Protect the last administrator through every account change.** Role removal is protected, but disable and account-status paths are inconsistent. Apply one transactional self/final-admin safeguard to disable, status, role and archive changes. | Permissions audit P1 lockout finding. Include two simultaneous administrator changes and own-account status changes in database-backed tests. |
| C | High | **Prevent stale or failed dashboard data appearing as current results.** Key datasets by year/process, display unavailable separately from zero, ignore outdated refresh results and offer targeted retry. | Reporting RO-01/02/04. Delay/fail a year-change response: no previous-year value should appear under the new year, and failure must not look like no activity. |
| D | High | **Protect unsaved work consistently.** Add a shared Save/Discard/Stay guard for navigation, history, year/type changes and admin sections; preserve dirty sibling LIV stages when another stage saves. | Workflow UX-01/04/06. Test each navigation path and edit two LIV stages before saving one. Do not autosubmit or discard silently. |
| E | High | **Make partial forms safely resumable.** Warn before Work Scrutiny team changes clear answers; add scrutiny draft saving and allow Learning Walk draft actions to remain with the draft. Include Learning Environments draft support in the design review. | Workflow UX-02/05 and coverage matrix. Partial entries reopen; draft answers/actions do not enter reports, notifications or assigned-action lists. This requires persistence work, not just a new button. |
| F | High | **Restore keyboard access to core controls.** Implement proper staff-picker arrow selection and labels; provide accessible dialog focus/Escape/return behaviour and announced save/error feedback. | Workflow UX-03/11, reporting RO-07. Browser reproduced Down twice + Enter selecting the first result. Test second-result selection, duplicate names and a full keyboard save/error journey. |
| G | High | **Apply request limits after identity is known.** Authentication currently runs after a limiter that tries to partition by user ID, falling back to IP. Staff behind the same college address can share limits. | Reporting RO-03; `Program.cs:79–100`, `:245–247`. Test two users sharing an IP, one user making repeated requests and anonymous traffic. Preserve deliberate vfanonymous protection. |
| H | Medium | **Make access changes predictable.** Protect director roles managed through organisation structure, consistently stop inactive/archived roles granting permissions, and reject stale concurrent account edits. | Permissions P2 findings. Test director allocation/rebuild, role retirement and two administrators saving an account. |
| I | Medium | **Make search and navigation honest and usable.** Either implement permission-scoped global search or remove its inactive header input; replace the long phone-width navigation strip with a grouped menu. Remove technical IDs from ordinary staff search, My Team and pickers, using name/job/area/email instead. | Browser found the header search does nothing; at 390px the 18-item navigation occupies 2,421px of content in 269px visible width. Workflow UX-07 lists remaining identifier renderers. Keep identity diagnostics available only where useful to authorised administrators. |
| J | Medium | **Explain failures and recovery.** Distinguish empty owner/staff lists from failed loading; centralise permission/session/conflict/rate-limit errors with retry or support references. | Workflow UX-09; reporting RO-05; `App.tsx:183–221` also marks failed staff/profile loads as loaded. Failed lookup must retain the user's form and explain how to recover. |
| K | Medium | **Keep QA writing smooth during autosave.** Queue background saves while allowing continued typing; block only explicit final operations and preserve version checks. | Workflow UX-10. Delay a save while typing: no lost characters, unexpected field disabling or older response overwriting newer text. |
| L | Investigate | **Measure reporting at full-year scale.** Profile dashboard payloads and QA Excel generation before choosing aggregate/paged endpoints, batched reads or background export jobs. | Reporting RO-06/10. Sequential QA detail reads and client-side table pagination are confirmed patterns, but this audit did not establish a production capacity limit. Preserve export scope and all answer columns. |

Recommended implementation order: **A/B/C/D/F/G**, then **E/H/J/K**, then **I/L**. E should be designed with D because resumable drafts and navigation protection solve different parts of the same problem. A/B/H should use one reviewed permission model rather than three disconnected UI restrictions.

## Policy choices that need your judgement

These are not automatically defects: changing them changes the meaning of access or reporting.

| ID | Current behaviour | Recommendation to accept or reject |
| --- | --- | --- |
| P1 | Authorised people can read in-scope QA drafts; drafts are excluded from submitted reporting. | Make drafts private to the author, with an explicit QA administrator exception, if unfinished notes should not be visible to colleagues. |
| P2 | QA form whitelists constrain the named QA Staff tier; a separate custom submit-all tier can bypass that restriction. | Keep the agreed QA-Staff-only rule, but explain exceptions in an effective-access preview. Choose a broader per-user whitelist only if you want the policy changed. |
| P3 | A validation capability combined with broad staff/report visibility can extend ELI validation beyond the person's management hierarchy. | Give validation its own explicit management scope if programme leaders should validate only their own hierarchy despite broader report access. |
| P4 | Archived staff drop out of historical cohort queries even when they worked during the selected year. | Preserve historical employment/membership eligibility independently of present account access so old percentages remain interpretable. Agree treatment of leavers, transfers and secondary memberships first. |
| P5 | First-time setup requires faculty/team allocation and academic-oriented categories, though declaring a category does not grant leadership. | Add legitimate professional-services organisation paths/categories for the non-academic colleagues you want to include. Keep job category, permissions and managed area separate. |
| P6 | Course level uses configured choices in some forms and free text in others. | Agree one configured list for new entries, retain original historical wording and allow a deliberate Other option where needed. |
| P7 | Custom-tier edits immediately affect all assigned people; warnings and audit exist, but no affected-person/capability comparison is shown. | Add an impact preview and “Why does this person have access?” explanation. A second human approval is optional governance, not a prerequisite assumed by this audit. |

## What is working and should be retained

- QA has a visible draft/submission distinction and submitted-only reporting/export selection. This does not imply drafts are private; P1 above addresses that separate question.
- Backend record access and workflow policies exist; navigation visibility is not the only boundary. ELI prevents self-validation and records validation changes. Mandatory CPD has a dedicated logging capability and does not earn Elevate credit.
- Archive has explicit audit, self/final-admin checks and disabled-on-restore behaviour. Those safeguards need to be shared by ordinary account status changes rather than removed.
- Form configuration retains stable keys and review snapshots; meaningful wording changes should continue to preserve historical interpretation.
- The unified form editor, per-dashboard faculty controls, separate process dashboards and expandable evidence sections give a sound basis for the next changes.

## Evidence and verification

| Check | Result and limit |
| --- | --- |
| Profile identifier removal | Current shared component no longer renders `detail.externalId`; both local ordinary and Entra-backed profile cards checked. Stored identifiers unchanged. |
| TypeScript | `npx tsc -b` passed after the removal. No backend build, migration or restart was needed. |
| Existing permission tests | 160 focused tests passed using the existing current build (`--no-build`). They cover policy helpers; the newly identified SQL/API mutation paths are not established by those results. Exact command/build evidence is in the permissions audit. |
| Header search | Entered `learning` and pressed Enter: input changed, page/results did not. Current `App.tsx:486` has no search handler. Cleared the test text afterwards. |
| Shared staff picker | In Coaching, typed `Test Colleague`, saw 01–08, pressed Down twice then Enter; 01 was selected. No session was created or saved. |
| Responsive navigation | At 390px viewport, rendered document did not overflow horizontally, but the navigation itself had 2,421px scroll width and 269px visible width for 18 destinations. This is a discoverability recommendation, not a claim of inaccessible content or whole-page overflow. Temporary viewport override reset. |
| Data and permissions | No account, role, submission, report setting or database content changed during this audit. Only the requested profile-card display was edited. |
| Local scope | Current repository and local browser were reviewed. Harry confirmed local update scope. No assertion about the deployed release, production data, real user identities, backup restoration or production load is made. |

For accepted access fixes, add a database-backed negative-access matrix: staff/self, programme leader, director, QA Staff with/without whitelist, report-only user, delegated account administrator and full administrator. Cover direct record reads, edits and exports across unrelated faculties, plus disabled/archived/retired roles. The current fast policy tests should remain, but cannot substitute for these checks.

For accepted UX fixes, reproduce the loss/error/keyboard scenario, not merely the presence of a new button. Use disposable local form state and test accounts, never unsaved real staff work.

## Detailed audit trails

- [Permissions, safeguards and scope decisions](permissions-audit-2026-09-29.md) — five confirmed permission defects, policy decisions and control/verification matrix.
- [Workflow UX and coverage matrix](workflow-ux-audit-2026-09-29.md) — twelve workflow findings and source coverage for all operational form families, eight QA activity paths and admin areas.
- [Reporting and operations](reporting-operations-audit-2026-09-29.md) — seven reporting/operational barriers plus capacity, historical-cohort and hosting questions.

The proposed identity-aware limiter order follows [Microsoft's ASP.NET Core rate-limiter guidance](https://learn.microsoft.com/en-us/aspnet/core/performance/rate-limit-samples?view=aspnetcore-10.0). The proposed staff-picker behaviour follows the [W3C combobox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/). These guide proposed changes; they do not certify this application as fully compliant.
