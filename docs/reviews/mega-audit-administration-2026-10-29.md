# Administration and QA configuration audit — 29 October 2026

## Outcome and evidence boundary

The active administration catalogue, its dedicated editors, QA Hub configuration, permission-tier management, process settings and CSV workflows were traced through their UI and relevant API/data-store contracts. The directory has a separate page for each task, searchable collapsible groups, related destinations and a distinct QA workspace. The new form tooling separates immutable template versions, fixed workflow wording, managed choices and review-specific QA setup.

This pass implements concrete corrections: accurate QA Staff eligibility for new form allocations; safe question copying and serialized question mutations; truthful optional-evidence-note wording; locked account/tier inputs during saves; actual all-year ELI administration; and a guarded editor for 47 workflow prompts and their guidance. It does not claim that every possible administrative write was performed in a browser. Account, permission, organisation, published-form, messaging, artwork and import changes were not applied to the user's data by this reviewer.

The inventory below covers reachable dedicated panels rather than counting unused helper definitions as additional product features. `AdminCentre.tsx` still contains legacy `LookupAdminPanel`, `LookupValueAdminSection` and `RecordCorrectionPanel` definitions; current routes use `AdminManagedLists` and the dedicated record panels.

## Where settings live and how an administrator finds them

`app/adminSettingsCatalog.ts` and `app/qaAdminNavigation.ts` supply the actual task directory. `AdminSettingsLayout` searches titles, descriptions, groups, keywords, steps, impact notes and workspace names. Search removes accents, normalises punctuation and N/A, and ignores common instruction words. Matching groups expand while searching; clearing search restores ordinary browsing. A focused setting exposes its impact immediately and its numbered instructions on demand. The active task appears ahead of the optional directory on small screens.

Main administration links directly into QA administration rather than embedding another copy of QA editors. The accessible catalogue is permission-filtered; administrator-only CSV entries require the actual Administrator role as well as their relevant capabilities. Direct API checks remain authoritative. The directory does not confer permissions merely by showing a destination.

The main separation is intentional:

| Need | Destination | Meaning |
| --- | --- | --- |
| Change a staff member's sign-in/account state | People & access → Staff accounts & sign-in | Account identity and status, separate from permissions and organisation membership. |
| Change a staff member's display details | Staff names, job titles & categories | A post category describes the job; it does not grant the equivalent leadership role. |
| Change what an account can do | Staff role allocations; Permission tiers & capabilities | Allocate existing tiers or maintain custom capability combinations. |
| Change where a person works | Organisation → Team membership | Primary/additional work membership, separate from additional access scope. |
| Change which areas an existing role can access | Staff organisation access | Extra permitted areas, retaining leadership-derived scope. |
| Change a template's future questions | Forms → All form versions & additional questions, or its named module page | Save a separate draft, preview, then publish an immutable version. |
| Change a typed review/action prompt or its guidance | Review & action wording and guidance | Current display wording; answers, types and workflow rules are retained. |
| Change a dropdown or theme | Named list/theme page, or All i-Elevate managed lists | Stable choice identifiers and shared usage remain visible. |
| Change shared QA criteria/outcomes/form participation | QA Hub → Administration | Separate question, scale and form-access tasks. |
| Change a particular QA review's owner, dates or allocations | That review → Configuration | Per-review setup and lifecycle, not a global admin setting. |
| Correct a saved record | Records & audit | Audited correction/archive/restoration, separate from future form definitions. |
| Change reporting inclusion | Reporting faculty datasets or Organisation-wide reporting inclusion | Dataset inclusion is distinct from access and presentation. |
| Change email wording versus transport | Message templates versus Email delivery | Versioned content/rules and transport credentials have separate tasks. |

## Complete main administration inventory

Permissions below describe catalogue entry conditions. Some sensitive mutations additionally require an actual Administrator and preserve system/leadership/self-protection rules.

| Key / focused editor | Controls and workflow reviewed | Safeguards / configuration boundary |
| --- | --- | --- |
| `staff-access` / `StaffAdminPanel` | Search existing users; inspect sign-in/account status; create an account; enable/disable sign-in and amend supported status. | `users.manage`; actual Administrator required to change accounts. Create is unavailable while accounts are loading or failed to load, preventing creation against an unknown directory. All create fields are locked during a request. Email/external identity maintenance is not presented as free text correction. |
| `staff-details` / `AdminStaffDetails` details | Display name, job title, staff post category; staff search, filters and sort. | `users.manage`; optimistic row version, saved-state readback, unsaved guard and explicit cancel. Four post categories are Head of Faculty/Sector Manager, Programme Leader, Tutor/Tutor Assessor and Other. Category does not allocate permissions/leadership. Existing nonempty job-title removal retains its current service restriction. |
| `staff-scope` / `AdminStaffDetails` scope | Select additional organisation access areas; inspect existing/derived scope. | `users.manage`; actual Administrator for scope writes. Leadership-derived access is retained. This does not move a colleague's primary team or allocate a managed leadership role. |
| `roles` / `PermissionAdminPanel` people | Find accounts, inspect effective capabilities, allocate permitted tiers, review current scope. | `users.manage`; actual Administrator for allocations. Organisation-managed leadership is changed through its own workflow; self/super-administrator protections remain. Dirty edits survive rejected saves. |
| `permission-tiers` / `PermissionAdminPanel` tiers | Inspect system roles; create/edit a custom name, description and capability combination; capability groups/search/counts. | `permissions.manage` or `users.manage` for entry; actual Administrator for custom-role writes. System roles are protected; editable custom roles use the existing custom-role contract and row version. Name/description inputs now lock during save. No unsupported delete/archive-role operation is advertised. |
| `archived-staff` / `AdminStaffDetails` archived | Search archived accounts; inspect active staff for archiving; reasoned archive and restore. | History is retained; archiving ends applicable allocations. Restored accounts remain disabled until their subsequent access is deliberately allocated. This is distinct from temporarily disabling sign-in. |
| `cpd-import` / `AdminCsvImport` | Delivered internal/mandatory CPD events and participants from CSV, column guide, reference downloads, preview and final confirmation. | Actual Administrator plus `cpd.manage`/`cpd.mandatory_log` for the event type. No future events, external logs for another person, staff creation or automatic award confirmation. |
| `list-import` / `AdminCsvImport` | New choices in registered editable lists; lookup/key references; preview/issues/explicit apply. | Actual Administrator plus `lists.manage`. Adds choices only; no arbitrary lists, protected states, renames, retirement or reactivation through CSV. |
| `organisation` / `OrganisationStructureAdmin` structure | Directorate/faculty/team tree; names/codes/parents/active state; search and scoped views. | `organisation.manage`; retained identifiers/history, current impact checks and required explanations for governed changes. |
| `organisation-leadership` / organisation leadership | Directors, Heads of Faculty and Programme Leaders; inspect existing allocation/impact before replacement/removal. | Actual Administrator for assignments; derives access/review ownership. Existing assignments cannot be bypassed by editing staff category. Change/removal reason requirements remain. |
| `organisation-membership` / organisation membership | Primary and additional work membership and staff allocation. | Membership is distinct from additional access areas. Impact checks remain for removing/reassigning governed relationships. |
| `organisation-reviews` / organisation reviews | Pending self-declared leadership and migration/allocation checks. | Resolution uses the managed leadership workflow rather than directly granting a role from a free text assertion. |
| `forms` / guide | Explains versioned questions, 47 fixed prompts, Work Scrutiny template setup, choices/themes and QA ownership. | Guidance only. Related links lead to the correct editor. |
| `form-versions` / `AdminFormVersions` | All supported template families; versions, draft copy, name/description, section/question organisation, additional questions, choices, required status, preview, save and publish. | `forms.manage`. Published versions are immutable; draft row versions, protected core fields and validation remain enforced by the API. Root owns detailed version-editor implementation/tests. |
| `work-scrutiny-templates` / version editor | Supported Work Scrutiny definitions and question/section versioning. | Corrections to submitted samples use Records & audit. Protected context/sample/action contracts remain. |
| `learning-walk-templates` / version editor | Shared Learning Walk/ALS Learning Walk template wording/layout and additional questions. | Theme/delivery/action choices have named settings; stable core fields retain their restrictions. |
| `cpd-templates` / version editor | CPD template wording/layout and supported additional questions. | CPD attendance/credit/award rules remain separate. CSV import refuses a form whose additional required answers it cannot supply. |
| `environment-templates` / version editor | Environment-audit wording, sections, guidance and supported additions. | Pillar/scoring core contracts remain protected. |
| `workflow-form-content` / `AdminWorkflowContent` | Choose a workflow, search prompts/guidance, edit label/help, preview, restore individual/all defaults locally, cancel, reload or explicitly save. | `forms.manage`; complete known-key payload, label 1–300, guidance ≤1,000, row-version conflict protection and audit. Saves do not change answers/types/required rules/owners/visibility/stages. Failed saves retain edits; saved-but-unverified versions block further editing until reload. |
| `work-scrutiny-template-setup` / legacy `FormBuilder` | Create a distinct blank/copied Work Scrutiny template, allocate to sub-teams or retire it; save an unused draft before opening versioned publication review. | Uses the administration definition and draft token, including genuinely empty drafts. Published-source copies explicitly select the published version; copied content uses the new target's own token. Description is retained. Core questions retain their answer type, required status and choices and cannot be removed with their section; wording/help/order stay editable. Historical allocations remain inspectable even if no longer valid for a new allocation. The legacy save-and-publish operation is retired. |
| `teaching-themes` / `LearningWalkThemeAdminPanel` | Shared practice areas and themes; names, availability, grouped ordering and moving themes between areas. | `forms.manage` or `lists.manage`. Shared use includes Learning Walks, LIV and reporting. Renaming shared live catalogue wording affects current display; it is not a QA published snapshot. Protected Other choices remain. |
| `als-learning-themes` / theme panel | Independent ALS Learning Walk areas/themes, ordering and active state. | Not the same catalogue as standard teaching themes or ALS LIV practitioner areas. |
| `als-liv-practitioner` / theme panel | Independent ALS LIV practitioner-area catalogue. | Kept distinct from ALS observation visit-focus choices. |
| `coaching-session` / `CoachingConfigurationAdmin` | Maximum new actions per session; load/retry, explicit Save and cancel. | `lists.manage`; whole number 1–10. Existing actions/records are retained. |
| `rooms` / `AdminRooms` | Search room/building, active/retired filters, usage/natural sort, add/edit room and building, availability. | `lists.manage`; row version and unsaved guard. Used room codes cannot be freely rewritten. Building/display edits retain current shared-display effects; retirement preserves historical records. |
| `all-lists` / `AdminManagedLists` | Full registered list catalogue, categories, Used in, search/sort; add/edit/reorder/deactivate/reactivate values. | `lists.manage`. Stable choice keys and history retained. Sorting a view never persists configuration order. Manual move is disabled in filtered/nonconfigured order. QA action themes have their separate QA destination. |
| `dashboards` / guide | Explains faculty datasets, ancestor inclusion and presentation. | Reporting settings do not grant narrative or staff-record access. |
| `dashboard-faculties` / `DashboardFacultyAdmin` | Choose main dashboard, include/clear faculties, save changed datasets. | `records.manage`. Untouched datasets retained. Organisation parent exclusions and permissions still apply. QA dataset is excluded from this editor. |
| `organisation-reporting` / organisation reporting view | Include/exclude an organisation unit and descendants across reporting. | `organisation.manage`. Excluded ancestors suppress descendants even when a dataset checkbox includes their faculty. |
| `dashboard-presentation` / `DashboardAdminPanel` | Labels, configured order, navigation availability, trend/area/outcome/action panels. | `records.manage`. Overview remains required. Reorder only in unfiltered configured order. Presentation does not alter metric definitions, saved data or access. Successful save followed by failed reload is reported separately. |
| `records` / `AdminRecordsPanel` | Whole permitted record source, type/staff/owner/year/faculty/team/status/archive facets, search/sort, open record, audit and archive/restore. | `records.manage`; reasoned lifecycle actions, retained history, current-selection audit sequencing and contextual dialog errors. No arbitrary hard delete. |
| `work-scrutiny` / `AdminWorkScrutiny` | Existing sample/answer/action corrections, original record detail and audit, archive/restore. | Requires both `records.manage` and `users.manage`. Slow record opens cannot replace a subsequent selection. Current correction/required answer/date constraints remain. |
| `elevate` / `AdminElevatePractice` | All retained ELI years; staff/faculty/team/status/year facets, activity sort, open supported correction editor. | `records.manage`; catalogue aligned to actual API. Explicit `all` query includes retained former-staff assessments, excludes archived assessments, and keeps unstarted active staff. Other callers still default to current year. Counts are labelled staff/year entries rather than active staff. |
| `message-templates` / `MessagingAdminPanel` templates | Template search/filter, create/copy, subject/body/optional HTML/CC/BCC, recipients, triggers, conditions, timing, version preview and activation. | `messaging.manage`; versions and reasoned governed actions; stale preview/history protection. Test requires saved wording. A real test/activation can deliver messages and was not run. |
| `email-delivery` / messaging delivery | Provider, sender/reply-to, test mode/recipient, Graph/SMTP/OAuth transport and polling configuration. | `messaging.manage`; source credentials masked/protected, conditional provider fields. Requires normal college IT handling, not an automatic test send. No secret values recorded in this audit. |
| `message-history` / messaging history | Server-filtered, sorted, paginated queued/sent/failed/cancelled deliveries; recipients/errors/attempts and existing retry control. | `messaging.manage`; each task loads only its required sources. Retry is an intentional delivery action, not a read-only check. |
| `badges` / `ElevateStatusAssetsAdmin` | Academic-year badge artwork, PNG/JPEG/WebP selection, preview, upload/reset. | `elevate_status.manage`; ≤5 MiB, image decode validation, file/year race protection, explicit reset confirmation and cache invalidation. Does not change award thresholds. No image uploaded/reset. |
| `modules` / release information | Inspect enabled modules delivered by this installation. | Read-only release setting; role capabilities separately determine user access. |
| `system` / ownership guide | Hosting/sign-in/SQL/storage/backups, academic years and controlled workflow/course identity ownership. | Honest ownership guidance rather than unusable switches for unsupported operations. Hosting secrets, identities and workflow rules are not freely editable in this UI. |

### Named choice lists and shared usage

These all use the same guarded managed-list editor. They are individual searchable destinations rather than requiring an administrator to discover internal lookup keys. Existing choices remain available to old records; retiring a choice is distinct from deleting it.

| Admin key | Registered list | Meaning / important separation |
| --- | --- | --- |
| `delivery-areas` | `liv_delivery_area` | Shared standard teaching delivery areas, including LIV, Learning Walks and QA evidence; Used in identifies other consumers. |
| `liv-course-levels` | `liv_course_level` | Standard LIV course levels. |
| `liv-visit-focus` | `liv_visit_focus_area` | Standard visit focus, separate from shared teaching themes and ELI preferences. |
| `liv-development` | `liv_development_opportunity` | LIV discussion/development choices. |
| `liv-notice` | `liv_notice_preference` | ELI/LIV notice planning preferences. |
| `liv-preferences` | `liv_focus_area` | Staff ELI/LIV planning focus preferences. |
| `als-delivery-areas` | `als_liv_delivery_area` | Shared ALS LIV/ALS Learning Walk delivery choices. |
| `als-course-levels` | `als_liv_course_level` | ALS LIV course levels. |
| `als-visit-focus` | `als_liv_visit_focus_area` | ALS observation visit focus, separate from practitioner areas. |
| `als-development` | `als_liv_development_opportunity` | ALS LIV development choices. |
| `coaching-qualifications` | `coaching_development_stage` | Coaching qualification/development statuses. |
| `coaching-focus` | `coaching_focus_area` | Coaching session focus choices. |
| `coaching-support` | `coaching_support_type` | Coaching support/comment categories. |
| `cpd-themes` | `cpd_theme` | CPD theme choices; also used by event CSV references. |

The Action themes group exposes all eleven non-QA sources: `learning-walk-action-themes` (`action_theme_learning_walk`), `als-learning-walk-action-themes` (`action_theme_als_learning_walk`), `liv-action-themes` (`action_theme_liv`), `als-liv-action-themes` (`action_theme_als_liv`), `probation-action-themes` (`action_theme_probation_observation`), `work-scrutiny-action-themes` (`action_theme_work_scrutiny`), `coaching-action-themes` (`action_theme_coaching_mentoring`), `cpd-action-themes` (`action_theme_cpd`), `learning-environment-action-themes` (`action_theme_elevate_environment`), `uco-action-themes` (`action_theme_uco_tla_review`) and `standalone-action-themes` (`action_theme_standalone`). QA's independent `action_theme_qa_review` is in QA administration.

## Complete QA administration inventory

| Destination | Supported changes / workflow | Scope and safeguards |
| --- | --- | --- |
| QA admin home | Search/browse the dedicated settings directory and follow review-setup guidance. | Visible only where at least one QA administration capability is available. |
| Questions, guidance & tags | Fixed activity selection; criterion wording, guidance, question tag, theme/week, order, required outcome, N/A availability and active/draft state; edit/version/archive/restore; new Copy question action. | `qa_reviews.manage`. Published review questions remain snapshots. Copy creates a local draft with a new identity and an order after the greatest current activity order, not an immediate active duplicate. One mutation runs at a time; save/archive/restore failure releases the lock and retains the appropriate state. |
| Import QA questions from CSV | Template/reference downloads, new criteria/guidance/tag/options, checked preview and explicit final apply. | Actual Administrator plus QA management. New imports default to draft. Does not overwrite criteria, create activity types, change review selections or rewrite published snapshots. |
| Outcome labels | Rename below/at/above/not-applicable display wording; 1–40 characters, four distinct labels, reserved neutral wording protected. | QA management; canonical outcomes/calculations unchanged. Shared wording affects existing/new displays and newly generated exports. Uses its own version token, independent of Not seen settings. |
| Not seen availability | Per-template availability for the neutral response. | QA management; existing Not seen answers are retained and excluded from rated totals. Partial saves preserve failures and retry only unsaved changes. This does not make Not seen part of the four rated labels. |
| Form access for QA Staff | All QA Staff versus selected QA Staff per form; name/email search, selection views and safe Select matching/Remove matching helpers. | QA management. Existing role/review allocation/access still applies; this does not allocate review teams. New choices require an active, nonarchived, enabled QA Staff account and current QA Staff role. Previous members can be retained/removed for their saved form, not added to a different form. Custom capability grants do not manufacture QA Staff eligibility. |
| QA action themes | Independent QA action choices, order and availability. | `lists.manage`; stable historical values retained. |
| Shared delivery areas | Same registered delivery list as main administration. | `lists.manage`; warns that change affects workflows outside QA. No duplicate private QA delivery catalogue is created. |
| QA reporting faculties | Faculty inclusion for QA totals, coverage and exports. | `records.manage`; locked to QA dataset; cannot accidentally save another dashboard. Organisation-wide exclusions/access remain authoritative. |
| How to set up or amend a review | Directs users to a review's Configuration for owner/dates/teams/activities/questions and publication, and separates that from shared defaults. | Published snapshots and review lifecycle are governed by the review workflow. No global setting purports to rewrite review membership or reopen all evidence. |

### Optional evidence notes are deliberate

The existing `QaReviewPolicyTests.StandardOutcomesDoNotRequireNarrativeComments` explicitly asserts that below, at and above outcomes accept empty narrative even when the legacy `commentRequiredAtExpected` metadata is true. `docs/admin-centre-review.md` also records that enforcement is unsupported. This is an existing workflow decision, not an accidentally missing checkbox.

The question card/editor now says evidence notes are optional. The compatible CSV column remains accepted and retained, but its label/help describe it as a legacy non-enforced flag. Supplying true produces a preview warning. No new enforcement toggle, mandatory narrative rule or migration of old flag values was introduced. Where N/A is enabled, its separate reason requirement remains enforced.

## Form customisation model

Template-based forms and typed review workflows need different controls to preserve their data contracts. The integrated administration now makes that difference explicit.

| Configuration | Supported surface | Historical behavior |
| --- | --- | --- |
| Versioned template definitions | Work Scrutiny, Learning Walk/ALS Learning Walk, CPD and Environment audits; a separate saved draft; template name/description, section/question wording/help and supported additional questions. | Published versions remain immutable and existing records retain their original version/answers. |
| Additional template question types | Short text, long text, number, date, Yes/No/Partial, single choice, multiple choice, checklist and rubric scale. | New custom question keys and validated versions; core types/required rules/managed choices are protected by `FormAdministrationRules`. |
| Typed workflow prompt wording | 6 LIV/ALS shared prompts, 6 probation prompts, 9 coaching prompts, 19 UCO prompts, 2 ELI prompts and 5 action prompts: 47 total across six definitions. | Current display wording/guidance changes; existing typed answers stay in place. This is not versioned question replacement. |
| Dropdown/theme choices | Named managed list or theme editor, with shared usage. | Stable identifiers and inactive historical values retained. Live catalogue wording can change current historical display, so shared usage matters. |
| QA criteria | Versioned question bank, optionally CSV-created, then selected into review setup. | Published reviews retain their fixed question snapshots. Shared outcome wording and form availability are separate settings. |

`AdminWorkflowContent` sends every known prompt, including cards hidden by search. Restore changes only the local draft and requires explicit Save. Required labels and length checks have linked errors; failed initial reads do not expose an editable fallback as though it were saved configuration. During save the editor, form switch and restore controls are locked, including a synchronous duplicate-request guard. A conflict keeps the draft; Reload saved wording goes through the existing unsaved-change decision. A successful command invalidates the runtime cache and reads back the new row version. If that readback fails, the saved draft is shown as saved and further editing is blocked until a fresh version is loaded.

An older Work Scrutiny draft missing its course-level question or delivery-area question shows “Save draft once to prepare required workflow questions before publication.” Save is available even without local wording changes; Publish stays disabled until the server-prepared questions are read back. Retained `qualification_level`, `course_level` and `course_or_unit` aliases all satisfy course-level presence. The server readiness repair is confined to unused drafts; published versions are not repaired in place.

Runtime forms use `useFormContent` with shipped wording as a recoverable fallback. Reopening a workflow is the supported way to obtain the new configuration after saving. Root owns the generic version editor, runtime additional-question integration, shared backend catalogue and migration `093_form_version_administration.sql`; this reviewer did not apply that migration or edit stored configuration.

## Import safeguards and useful boundaries

The three existing import areas cover the high-value bulk-authoring tasks: QA criteria, delivered CPD/attendance and registered list choices. Each has metadata-driven templates, current reference downloads, row-level preview/error/warning filtering, explicit acknowledgement and a final confirmation. Limits are UTF-8 CSV, 1 MiB and 1,000 data rows. A changed file invalidates the prior preview; out-of-order responses cannot re-enable a previous file's Apply action.

The server verifies actual Administrator authority and area permission again before apply. Its protected preview token binds file, user, area and plan; apply revalidates inside the existing transaction/locking/idempotency scheme. Exact prior references are skipped, changed/conflicting references need deliberate review, and records/attendance/audit/import ledger commit together. Staff match by exact active external ID/email rather than names. Reference staff downloads explicitly state their first-2,000 display limit; matching itself is not limited to those displayed references.

There is no arbitrary question-template, staff identity/role, protected workflow, historical evidence or settings-overwrite import. Adding these needs a dedicated identity/versioning/rollback specification rather than exposing a generic table upload. The existing detailed import review is [admin-csv-imports-2026-10-29.md](admin-csv-imports-2026-10-29.md).

## Findings implemented in this pass

| Finding | Correction | Evidence |
| --- | --- | --- |
| Former/inactive QA members looked eligible for a new allocation because the directory deliberately retained historical selections but supplied no eligibility flag. | Additive `isEligibleQaStaff` DTO backed by the same SQL predicate used for new-member validation; UI distinguishes eligible and historical rows and prevents adding an unrelated former member. | Deferred/mocked component test; real production directory SELECT over CTE cases for active/disabled/expired/custom-only/combined roles and no duplicate rows. |
| Selecting many matching QA Staff required repetitive individual clicks. | Local Select matching/Remove matching helpers operate only on currently visible selectable rows and preserve other selections; explicit Save still required. | Component test covers search, hidden selection retention, per-form history and bypassed disabled event handling. |
| Reusing a criterion required retyping or CSV. | Copy question creates a new guarded draft, preserves supported metadata, defaults inactive/draft and appends after maximum activity order. | Component test checks new identity, local-only copy, draft save, order gaps and retained legacy metadata. |
| A pending archive/save permitted unrelated question mutations; slow access/tier/account saves allowed duplicate saves or late input changes. | Serialize question and QA form-access mutations; disable related actions and stale handlers; lock custom-role and account-creation fields while busy. Form-access loads also reject superseded responses. | Deferred-response duplicate-operation, access-selection and custom-tier failure-retention tests; source account guard inspection. |
| QA card/import wording advertised an unsupported mandatory-comment behavior. | Clear optional-note wording; compatible legacy CSV metadata marked non-enforced and true values warned. | Existing deliberate policy tests retained; CSV planner assertion updated. |
| ELI admin offered All years but requested only current-year progress. | Optional validated year query, explicit all-years admin request, all retained assessment years including former staff, actual assessment year mapping and accurate staff/year labels. | Frontend history filter test; year policy tests; endpoint contract check; production SELECT CTE current/all/historic cases. |
| Typed workflow prompts were hardcoded and had no clear admin owner. | Guarded 47-prompt label/help editor integrated under Forms, with separate current-wording semantics and immutable generic version editor destinations. | Four behavioral component tests plus TypeScript build. Backend catalogue/version editor are root-owned integration. |
| General form destinations still pointed to the legacy setup-only surface. | Named template pages mount `AdminFormVersions`; generic all-versions page and workflow-wording page mounted; old Work Scrutiny creation/allocation preserved under its named setup key; guide and related links updated. | Active JSX/catalog inspection; root verifies version/editor behavior and native routes. |
| Legacy Work Scrutiny setup could overwrite a draft changed by the version editor, and its separate save/publish sequence did not share the new publication confirmation. | Load the actual administration draft token, preserve its description and send the token on structure saves. Published-source copies resolve the published version, then use the newly created target's token. Remove direct publication and route saved drafts to the version editor. | Five component tests cover stale rejection/draft retention, genuine empty versus failed reads, published copy/source identity, failed target read and save-before-review with refreshed tokens. Backend shared-token enforcement is root-owned. |

## Remaining controlled areas and future options

These are documented boundaries, not hidden controls or incomplete Save buttons:

| Area | Present support | Remaining boundary / appropriate next step |
| --- | --- | --- |
| Fixed QA activities and canonical outcome meanings | Questions, required/N/A options, tags, wording, neutral availability and participation can be configured. | Changing activity processes, outcome semantics or rated denominators requires a reviewed workflow/reporting change. Optional narratives stay deliberate; legacy flag is deprecated compatibility metadata. |
| LIV/probation/coaching/UCO/ELI/action structure | Supported prompt labels/help and named choices are configurable. | Arbitrary added fields, types, required rules, progression, owner/visibility logic and validation require a typed workflow/data/reporting design. The wording editor does not imply dynamic schema editing. |
| System roles and leadership | Custom permission combinations and individual allocations; organisation-managed leadership. | System tier mutation, deleting used roles or bypassing self/leadership safeguards is not an admin text edit. A lifecycle design is needed before introducing custom-role retirement. |
| Staff identity and classification | Supported display details, fixed post categories, work membership and access scope. | Email/external ID matching, bulk identity imports and an academic-versus-support classification model are separate from the existing four post categories. Do not infer access from post wording. |
| Academic years, cycle/award rules and course catalogue | Existing year-aware operational screens and ownership guidance. | Their validation/history rules are application/database governed. No arbitrary academic-date, award-threshold or course-identity editor exists in this pass. |
| Badge artwork | Per-year image upload/reset. | Artwork changes do not change earned level or threshold calculations. |
| Dashboard metrics | Presentation, dataset faculties and organisation inclusion are configurable. | Metric calculations/export contracts are reviewed application behavior; a label switch does not change them. |
| CSV scope | Adds supported new questions, delivered CPD/attendance and choices. | Existing-record overwrites, identity/role imports and template rewrites require dedicated preview, conflict and rollback semantics. |
| Hosting and release modules | Inspect availability and identify responsible owner. | Authentication, database, backups, secret transport and deployment require controlled configuration outside ordinary form admin. |

## Verification and limitations

Completed by this reviewer after the new editor and ELI fixes:

- `node --test tests/admin-focused-panels.test.mjs`: 47 passed, 0 failed. Includes real component handlers/effects with stubbed APIs; no application mutations.
- Final combined focused panels, people/organisation, navigation and ELI handler-contract run: 64 passed, 0 failed.
- Final Work Scrutiny readiness follow-up, `admin-focused-panels.test.mjs` plus `workflow-list-filters.test.mjs`: 83 passed, 0 failed, including protected legacy controls and save-before-publication preparation.
- `node --test tests/elevate-progress-year-contract.test.mjs`: 1 passed. Checks the actual optional-year handler keeps records authority and validation before its datastore call.
- Web `npx tsc -b --pretty false`: passed after mounting the new editors.
- `tests/qa-form-access-directory-sql.ps1`: passed against configured LocalDB `master` with elevated read access. It extracts the real directory SELECT and shared eligibility predicate, replacing source tables with CTE rows only. Active/disabled/expired/historical/custom-role combinations and duplicate prevention passed.
- `tests/elevate-progress-year-sql.ps1`: passed against the same `master`, extracting the real production progress SELECT over CTE rows only. All/current/explicit historical years, former staff retention, archived assessment exclusion, exact year mapping and unstarted active staff passed. No schema objects or application rows were created.
- Added `ElevateProgressPolicyTests` for omitted/current/all/historical and malformed/out-of-range years. Updated the QA CSV planner warning assertion while retaining the existing optional-narrative policy tests. The root integration run records the final .NET suite result; this document does not invent a successful run before that result is available.

Root owns the integrated native-browser route matrix, generic form version/runtime changes, final production build and whole-suite results. Existing shared UI/accessibility, import and product-administration reviews remain relevant, but their prior results are not presented as new live verification of every write in this audit. No email, test delivery, batch import, permission change, staff mutation, artwork upload, form publication, deployment or GitHub write was performed by this reviewer.
