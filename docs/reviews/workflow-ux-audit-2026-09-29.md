# Workflow UX audit — 29 September 2026

Read-only review of the current worktree. Recommendations are pending Harry's acceptance or rejection; no workflow, permission, form contract or database change was made by this review. Source references below were rechecked against current files rather than copied from the earlier form review. The parent audit owns browser checks, the requested removal of the profile identifier, and the deeper server permission review.

Severity: **High** means preventable loss of entered work or an interaction barrier; **Medium** means misleading, obstructive or inconsistent behaviour; **Low** means a smaller clarity improvement. These are UX priorities, not security vulnerability scores. Source evidence establishes the paths described; it does not establish their incidence in the live college installation. Browser reproduction and assistive-technology testing remain separate evidence.

## Decisions to accept or reject

### UX-01 — High: ordinary navigation bypasses most unsaved-work protection

**Evidence:** `apps/web/src/app/App.tsx:292` consults a leave guard only for the QA route; `:221` applies browser-history locations directly. `apps/web/src/routes/AdminCentre.tsx:54` protects its own section buttons, but `:50` accepts changed route props directly. Its form/permissions editors implement browser `beforeunload` handlers; those do not run during the application's sidebar navigation. ELI stores responses locally (`ElevatePractice.tsx:49`, `:114`), with explicit save at `:72`; UCO stores the review locally (`UcoTlaReviews.tsx:232`) with an unguarded Back button at `:311`; coaching's Back handler changes view directly (`CoachingMentoring.tsx:254`). No shared operational leave guard connects these editors to the shell.

**Impact:** a user can type a long narrative or change admin configuration, click a different main navigation item and lose changes without the existing admin warning. This is distinct from persisted drafts: work since the last save remains at risk.

**Proposal — Accept / Reject:** use one application leave contract for dirty and in-flight editors, covering sidebar, workspace switch, browser Back/Forward, profile/source links and academic-year changes. Start with explicit Save / Discard / Stay behaviour; do not silently autosubmit forms. Acceptance: each covered editor survives “Stay”, only discards deliberately, and cannot disappear while its save is in flight. QA's existing guard must continue to work.

### UX-02 — High: changing Work Scrutiny allocation silently clears answers; no draft save

**Evidence:** `components/WorkScrutinyCreateForm.tsx:69` clears `responses` whenever `teamId` changes. Faculty selection clears team at `:204`; team selection directly changes it at `:216`. The only save action is submission (`:337`–`:339`); the request at `:153` does not set `saveAsDraft`. Cancel unmounts it through `routes/ModuleWorkspace.tsx:858`.

**Impact:** correcting a selected team after answering a long rubric loses all entered answers. A partially completed scrutiny cannot be deliberately saved from this creation screen, despite other processes offering drafts.

**Proposal — Accept / Reject:** warn before changing an allocation with answers, explain that the team controls the template, and add draft persistence with draft-exclusion reporting rules. Preserve compatible answers only when stable question identities prove they match. Acceptance: team changes cannot silently destroy responses; a partial draft reopens correctly and contributes nothing to submitted reporting.

### UX-03 — High: shared staff picker does not support choosing later results by keyboard

**Evidence:** `components/StaffSearchSelect.tsx:63` closes its list on input blur. The keyboard handler at `:70` supports Enter (always first result) and Escape only. Results at `:100` are buttons inside a listbox, but there is no arrow-key active option or `aria-activedescendant`. A Tab move away from the input closes and removes the results. Mouse selection is specially protected by `onMouseDown` at `:91`.

**Runtime corroboration:** the parent audit typed “Test Colleague” in the Coaching picker, saw results 01–08, pressed Down twice and Enter, and the picker selected 01. No create or save action was used. The browser accessibility tree also did not provide an accessible name for that combobox; the nearby heading does not label the input.

**Impact:** someone using a keyboard cannot reliably choose the second matching person unless they refine their query until that person becomes the first result. This shared component is used across form subjects and action owners, so duplicate names amplify the problem.

**Proposal — Accept / Reject:** implement an accessible combobox with arrow navigation, a announced active option, Enter selection and Escape dismissal; retain readable name/email disambiguation. Acceptance: select the second of several matches entirely by keyboard, including duplicate names, and verify with a screen reader. The parent audit can reproduce this without saving a form.

### UX-04 — High: saving one LIV stage can reset unsaved edits in another

**Evidence:** `routes/LivVisits.tsx:433` resets each stage editor's `form` and `visit` whenever its `stage` or `record.visits` prop changes. A stage save calls the shared refresh (`:443`, `:466`); the parent reloads the case (`:226`), supplying new stage objects and a new visits array to all rendered stage editors (`:401`). The stages each maintain independent local edit state (`:427`).

**Impact:** a reviewer can edit two expanded stages, save one, and have the other's unsaved text replaced by server data on refresh. The same shared workspace is used for ALS LIV. This is a source-demonstrated state-reset path; no destructive live test was performed.

**Proposal — Accept / Reject:** preserve dirty sibling-stage state during refresh, or save all changed stages explicitly. Reconcile refreshed row versions without overwriting newer local text. Acceptance: edit stages one and four, save one, and verify stage four's edit survives; test action changes and practitioner saves that also refresh the case.

### UX-05 — Medium: Learning Walk draft saving stops once any action is entered

**Evidence:** `routes/ModuleWorkspace.tsx:451` rejects `Save draft` when a Learning Walk/ALS Learning Walk has any `draftActions`, with the instruction to submit or remove the actions. The interface still offers the Save draft button at `:1010`.

**Impact:** a natural workflow—capture an action while drafting an observation—removes the user's ability to save partial progress. Removing action text or prematurely submitting are poor escape paths. This is explicit behaviour, not a backend failure.

**Proposal — Accept / Reject:** persist unassigned draft actions as part of the draft and create central assigned actions only on submission. Acceptance: partial observations and actions reopen together; draft actions do not appear in staff inboxes, notifications or dashboard totals until submitted. This changes persistence and requires a deliberate implementation decision.

### UX-06 — Medium: CPD form switching immediately clears entered answers

**Evidence:** `routes/ModuleWorkspace.tsx:746` switches between managed, external and mandatory CPD; when the form type changes, `:757` clears `responses` without testing for edits or asking to discard.

**Impact:** selecting the wrong CPD type after starting an entry loses work, even if a user only wants to compare the available routes.

**Proposal — Accept / Reject:** route CPD type switches through the common dirty guard, with clear type descriptions before starting. Acceptance: changing type with entered data offers Stay/Discard; changing an untouched form remains one click.

### UX-07 — Medium: technical identifiers still appear outside the requested profile card

**Evidence:** `routes/StaffProfiles.tsx:161`, `routes/MyTeam.tsx:128`, and the shared `components/StaffSearchSelect.tsx:108`/`:120` render `externalId` as normal staff-facing copy. The parent change removes it from the shared profile card only. This field may hold the synthetic `ENTRA_…` value rather than a familiar staff number.

**Impact:** the same confusing technical identity returns when finding a colleague, using My Team, or choosing an action owner, despite the profile card being corrected.

**Proposal — Accept / Reject:** use name, job and organisational area/email on ordinary people lists. Keep identity keys in authorised account diagnostics and internal API/database relationships. If genuine employee numbers are useful, identify that field explicitly instead of inferring it from an identity key. Acceptance: an Entra-provisioned colleague has readable disambiguation throughout normal workflows while account matching remains unchanged.

### UX-08 — Medium: first-time setup requires an academic-shaped organisation path for everyone

**Evidence:** `components/FirstTimeOnboarding.tsx:33` requires faculty, team and category; its visible labels are Faculty and Team (`:76`, `:92`). `apps/api/src/TLQS.Api/Data/StaffOnboardingDataStore.cs:17` exposes only faculty and team unit types, and `:81` validates that exact hierarchy. `TLQS.Application/Identity/StaffOnboardingRules.cs:10` has Head of Faculty, Programme Leader, Tutor and Other categories. Positively, `InitialRoleKeyFor` always returns staff (`:29`): self-declaring a leadership category does not grant leadership access.

**Impact:** professional-services colleagues without a genuine faculty/team allocation cannot complete this flow without an artificial academic allocation. Whether such colleagues need access is a product/organisation decision, not a confirmed failure for currently allocated users.

**Proposal — Accept / Reject:** decide which non-academic organisational units need accounts, then provide a legitimate “Organisation area / Team” path and meaningful categories. Keep category separate from privileges. Acceptance: an approved non-academic colleague completes setup in their real unit and receives only intended access; academic colleagues retain the existing hierarchy rules.

### UX-09 — Medium: failed owner-list loading looks like nobody is eligible

**Evidence:** `routes/ActionsView.tsx:174` loads action-owner options but catches failure by setting an empty list (`:177`), which directly determines selectable owners (`:181`). LIV does the same at `LivVisits.tsx:306`, and probation at `ProbationObservations.tsx:542`.

**Impact:** a temporary API failure creates an empty owner picker with no failure/retry explanation. Users may assume their organisational allocation or permissions are wrong and cannot complete an action.

**Proposal — Accept / Reject:** distinguish loading, failed lookup and genuinely no eligible owners; show a local retry and only suggest an admin allocation when the successful result is empty. Acceptance: a failed owner query displays an error/retry without losing the rest of the form; an empty successful query gives the correct next step.

### UX-10 — Medium: QA autosave temporarily disables every response field

**Evidence:** `routes/QaHub.tsx:1093` autosaves after 900 ms idle. `:1115` sets `saving` for that request; `:1149` passes `saving` into every criterion's disabled flag, applied to buttons/textareas at `:1172`–`:1176`. Requests may take longer than the pause that triggered them.

**Impact:** on a slow connection, a user pausing briefly to think can find their active notes box disabled when resuming typing. QA is otherwise the strongest draft implementation: visible saved state, explicit submission, retained local edits on failed save and a navigation guard are already present.

**Proposal — Accept / Reject:** allow editing during background draft saves, queue/coalesce later edits, and keep revision conflict handling. Reserve blocking controls for explicit submit/remove operations. Acceptance: continuous notes entry with a deliberately delayed save loses no keystrokes or focus; the next save contains newer text and stale responses cannot overwrite it.

### UX-11 — Medium: many workflow messages are not announced or linked to the failing field

**Evidence:** ELI uses a plain message `div` at `routes/ElevatePractice.tsx:112`; coaching at `CoachingMentoring.tsx:419`; ModuleWorkspace at `:853`; staff profile at `features/StaffProfilePanel.tsx:241`; LIV at `LivVisits.tsx:240`. Some appear near the top while save controls are much lower. Work Scrutiny is a better example: it uses `role="status"` at `components/WorkScrutinyCreateForm.tsx:193` and focuses missing fields at `:126`, `:139`.

**Impact:** a keyboard or screen-reader user can activate Save and receive no announced result; a sighted user at the bottom of a long form may also miss the explanation.

**Proposal — Accept / Reject:** share accessible save/error feedback: live status for success, alert/error summary plus field focus for blocking validation, and preserved inputs after failure. Acceptance: one missing required field and one network failure are apparent without scrolling back to the top or hunting through the form.

### UX-12 — Low: course-level entry differs between related QA/QI forms

**Evidence:** LIV uses configured options (`routes/LivVisits.tsx:524`) and Work Scrutiny a controlled level field; probation uses a free text input (`ProbationObservations.tsx:475`) and UCO uses its generic text Input for Level (`UcoTlaReviews.tsx:346`, also linked review creation).

**Impact:** equivalent levels can be entered as “L3”, “Level 3” or “3”, hindering comparison and increasing cleanup effort. Historical free text may also be legitimate, so a blanket conversion would be unsafe.

**Proposal — Accept / Reject:** agree one configured level list for new records, retain historical text as a visible legacy option and provide an explicit Other where needed. Acceptance: new forms use matching stable keys while old reports retain their original wording.

## Coverage matrix

All paths below are under `apps/web/src` unless shown otherwise. This is workflow source coverage, not a claim that every state has been exercised in production.

| Operational family | Current evidence reviewed | Outcome / next decision |
| --- | --- | --- |
| ELI self-assessment and programme-leader validation | `routes/ElevatePractice.tsx`, local draft, save/submit, submitted result, admin edit reason | UX-01/11; explicit submit lock warning already present. Server validation-scope review belongs to the permission audit. |
| LIV | `routes/LivVisits.tsx`, stage editors, cycle checklist, actions, practitioner data | UX-01/04/09; stage save and complete are distinct. |
| ALS LIV | Same workspace with ALS process key and independent configuration | Same state-loss/owner-loading exposure; preserve ALS separation. |
| Learning Walk | `routes/ModuleWorkspace.tsx`, creation, draft, edit and linked actions | UX-01/05/11. |
| ALS Learning Walk | Same workspace under `als_learning` and its own theme process | Same protections needed; no merging of ALS themes proposed. |
| Standalone Work Scrutiny | `components/WorkScrutinyCreateForm.tsx` and scrutiny workspace | UX-02; required fields focus correctly, sample size checked as positive integer. |
| Coaching and mentoring | `routes/CoachingMentoring.tsx`, session/cycle editor, close confirmation, previous actions | UX-01/11; preserve developmental workflow and removal of rating. |
| Probation observations | `routes/ProbationObservations.tsx`, stage editor, course context, owner options | UX-01/09/12; completion has a deliberate confirmation. |
| UCO TLA | `routes/UcoTlaReviews.tsx`, section saves, acknowledgement, sign-off, linked follow-up | UX-01/12; useful next-step guidance, restricted lecturer findings, and clear finalisation effects already exist. |
| Internal CPD | `routes/ModuleWorkspace.tsx`, managed entry and participants | UX-01/06; retain event/attendee distinction. |
| External CPD | Same workspace, separate external template | UX-01/06; preserve separate eligibility semantics. |
| Mandatory CPD | Same workspace, `cpd.mandatory_log` gate and mandatory template | UX-01/06; explicit no-Elevate-credit guidance at `ModuleWorkspace.tsx:880` is good. No permission/data changes proposed here. |
| Learning Environments | Same workspace, room/pillar questions, linked actions | UX-01/11; long form has no create-form Save draft button in this mode (`:1009`). Include in draft design if accepted, without assuming QA draft semantics are identical. |
| Elevate Explorer evidence / controlled levels | `features/StaffProfilePanel.tsx:296`–`:403`, eligibility, evidence and T&L confirmations | UX-01/11; eligibility requirements and controlled-level restrictions are visible. |
| Staff profile, staff directory and My Team | `StaffProfilePanel.tsx`, `routes/StaffProfiles.tsx`, `routes/MyTeam.tsx` | UX-07; profile sections have explicit local loading/error states and pagination. Profile identifier removal owned by parent. |
| Actions: create/edit/extend/close/delete | `routes/ActionsView.tsx`, eligibility loading, filters, detail/history, linked source | UX-01/09; central theme/owner/due date and extension history support follow-up. |
| QA review setup and lifecycle | `routes/QaHub.tsx:347`–`:806` | Saved draft precedes publish; published existing allocations are protected, new teams can be added; local navigation guard exists. |
| QA Lesson Visit | Shared QA evidence editor and review-selected criteria | UX-10. Activity-specific wording requires owner review; dynamic catalogue is not proved by source defaults. |
| QA Digital Learning Walk | Same shared editor | UX-10; no activity-specific code issue found in reviewed paths. |
| QA Work Scrutiny | Same shared editor, distinct from standalone workflow | UX-10; retain clear distinction from standalone scrutiny. |
| QA Walk Around | Same shared editor | UX-10; neutral options governed by configuration. |
| QA Inclusion Learning Walk | Same shared editor; configurable activity | UX-10; do not infer production catalogue contents from local training examples. |
| QA Desk Review | Same shared editor | UX-10; separate Not seen and Not applicable explanation present. |
| QA Stop and Ask | Same shared editor | UX-10; criterion/sample language must be checked against live configured questions. |
| QA Student Voice | Same shared editor | UX-10; no assumption that submission count equals learner headcount. |
| First-time setup | `components/FirstTimeOnboarding.tsx`, server options/hierarchy and category rules | UX-08; self-declared category does not escalate base tier. |
| Admin forms, questions, scales and whitelists | `FormEditor.tsx`, `FormBuilder.tsx`, `QaQuestionBankAdmin.tsx`, `QaRatingLabelsAdmin.tsx`, `QaFormAccessAdmin.tsx` | Local dirty guards and partial-save messages exist; global leave path remains UX-01. Preserve stable IDs and historic snapshots. |
| Admin staff, permissions, organisation and rooms | `AdminCentre.tsx`, `PermissionsAdmin.tsx`, `AdminStaffDetails.tsx`, `OrganisationStructureAdmin.tsx`, `AdminRooms.tsx` | UX-01. Organisation editor is not registered with AdminCentre dirty tracking (`AdminCentre.tsx:93`), unlike rooms/staff/permissions. Permission explanation distinguishes category, capabilities and scope. |
| Admin messaging, corrections and reporting settings | `MessagingAdminPanel.tsx`, `AdminWorkScrutiny.tsx`, `AdminElevatePractice.tsx`, `DashboardFacultyAdmin.tsx`, shell wiring | Messaging editor close immediately clears editor at `MessagingAdminPanel.tsx:422`; not registered with shell dirty tracking (`AdminCentre.tsx:105`). Include with UX-01. No test messages sent. |

## Boundary and follow-up checks

- The parent review separately covers dashboards/exports, global search/navigation, responsive layout and user-menu interaction. Do not interpret this document's workflow coverage as a fresh export load test.
- The current source can reveal defects and protections but cannot prove live Entra claims, organisation allocations, production query latency, real account permissions, or the live configurable wording. Review those with college IT using read-only production evidence before making access-policy changes.
- If UX-01–06 are accepted, test the specific loss/barrier scenarios rather than just checking that a Save button renders. Never use real staff's unsaved or submitted work for those tests.
- No fixes beyond the user's expressly requested profile-card identifier removal should be inferred as accepted merely because they appear in this report.
