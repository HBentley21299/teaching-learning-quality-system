# Workflow and form consumption audit — 29 October 2026

This is a source-backed inventory of the workflow screens, their answer contracts, local validation and administrator customisation. It covers `ModuleWorkspace`, `WorkScrutinyCreateForm`, LIV/ALS LIV, probation, UCO, coaching, ELI and Actions. It preserves the earlier working changes. The parent review owns API/schema/admin integration, account-policy tests and final native verification. No database mutation, seeding, import, account change or remote write was performed for this audit.

## Coverage and confidence

All listed create/edit/read-only/draft/complete branches were inspected in source. Real handler tests exercise representative permission conditions, failures, ordering, retention and saves against mocked APIs. They do not prove every provisioned account combination. Native no-write checks from the earlier workflow review cover Learning Walk, external CPD, Work Scrutiny, coaching, LIV and probation; this follow-up does not claim a new all-role browser run. The local HTTP socket was unavailable to this agent, so dynamic published question counts are deliberately not reported as live database facts.

| Form family / variant | Source of questions and choices | Consumption and role paths examined |
| --- | --- | --- |
| Learning Walk | `learning_walk_core`; shared themes, delivery areas and coaching practice rubric | Submit/manage/report/form permissions, create, draft, current-version submission, saved-version edit/detail, conditional Other, per-focus rubric, actions, source navigation and exports. |
| ALS Learning Walk | Same `learning_walk_core` schema; process-specific themes and delivery areas | Same renderer with `als_learning_walk` permissions and separate process data. A published schema wording change affects new entries in both Learning Walk variants. |
| Managed CPD | `cpd_core`; staff/group participant picker and CPD theme lookup | `cpd.manage` creation, staff associations, duration, draft/submit, historical details, filtering and exports. |
| Mandatory CPD | `cpd_mandatory` | `cpd.mandatory_log` creation, participant records, no Elevate-status credit, duration, draft/submit and existing CSV dependency. |
| External CPD | `cpd_external_self_log` | `cpd.self_log` plus staff identity, self subject target, external title, duration, draft/submit and historical answers. |
| Learning Environment | `elevate_learning_environments_core`; room register and pillar/rubric catalogue | Submit/manage/form/report access; room-derived context; active-pillar creation/editing; draft/submit; inactive and retired historical answers; linked actions and exports. |
| Work Scrutiny | Published schema allocated to the selected active sub-team | Faculty/team context, independent form/delivery requests, all nine question types, required course level/delivery, positive integer sample size, drafts, action drafts and scope. Separate legacy allocation/template-creation administration remains required. |
| LIV / ALS LIV | Typed stages and visits; process-specific `LivConfiguration`; shared practitioner themes | Subject/creator/manager scopes, owner-only sharing controls, protected hidden content, stage save/completion, mandatory cycle 2, follow-up cycles, practitioner metadata, linked actions and Word access. |
| Probation observations 1–3 | Typed stage/visit contracts, `ProbationConfiguration`, reviewers and linked LIV/UCO | Eligible create scope, teaching/learning and leader reviewers, stage capabilities, observation switch, observed/not-observed rubric/evidence, stage action-save order and complete linked pathways. |
| UCO TLA Reviews | Typed review/session/action/follow-up contracts; 16 literal evidence fields | Coordinator creation; observer editing/send; lecturer redaction, discussion and acknowledgement; observer sign-off; reopen, follow-up and linked review; capability-driven report access. |
| Coaching / Mentoring | Typed session/actions/reviews; qualification/focus/support/rubric/max-action configuration | Create/open/cycle loading, submit/manage capabilities, drafts/completed session, carried-action review, revised/new actions, formal cycle closure, saved retired lookups and history. |
| ELI | Areas/statements/rating scale/support/focus choices supplied by workspace | Staff draft/submission; required statement preflight; result; leader validate/return; audited administrator/profile corrections; completion/validation lists. |
| Standalone / linked Actions | Typed action contract, source-specific action themes and authorised owners | Management create/edit; owner completion/extension; UCO management exception; cancellation, deletion/restoration/reopening, notes, visibility, source details and history. |

## Exact source slot inventory

Counts below describe the current renderer's semantic slots, not live published form instances. Repeated action/rubric rows are counted per row. A workflow status, identity, visibility switch or signature is a control rather than an administrator-authored question.

The generic renderer has **seven consumption variants** backed by **five fixed template keys plus the allocated Work Scrutiny template families**: two Learning Walk variants share one key; CPD has three; Environment has one; Work Scrutiny is allocated dynamically. Actual question/section totals are version-dependent. `FormDefinition` contains section/key/title/order and field ID/key/label/type/required/order/help/options. Existing submissions supply their stored sections and values.

The generic consumer recognises **22 explicit semantic keys**: `additional_focus_context`, `additional_focus_other`, `assessment_date`, `building_name`, `cpd_themes`, `cpd_title`, `date_time`, `delivery_mode`, `development_areas`, `duration_hours`, `duration_minutes`, `faculty_area`, `finding_tag`, `focus_rubric_ratings`, `intended_purpose`, `learning_walk_delivery_area`, `room_code`, `scrutiny_date`, `staff_id`, `staff_search`, `team_level`, `visit_date`. Renaming these keys changes behaviour; editing their display wording must not rename them.

| Fixed family / group | Count | Semantic answer keys or controls |
| --- | ---: | --- |
| LIV pre-discussion | 3 | `contextText`, `aimsText`, `learnerActivityText` |
| LIV distance/impact | 2 | `distanceImpactText`, `developmentOpportunityKeys` |
| LIV visit | 6 | `deliveryAreaKey`, `visitDate`, `visitTime`, `courseName`, `courseLevel`, `reflectionNotes` |
| LIV post-reflection | 2 | `reflectionText`, `developmentOpportunityKeys` (reused list) |
| LIV follow-up | 1 | `intendedFollowUpDate`; stage status is controlled. |
| LIV practitioner | 3 | Practitioner flag, selected practice themes, other practice text. |
| LIV action row | 4 | Action theme, action text/title, authorised owner, due date; closure/extension are separate lifecycle controls. |
| Probation professional discussion | 3 | `contextText`, `aimsText`, `learnerActivityText` |
| Probation visit context | 7 | `deliveryAreaKey`, `observationDate`, `observationTime`, `courseName`, `courseGroup`, `courseLevel`, `keyPoints` |
| Probation rubric per focus | 3 | Observed flag, descriptor ID, optional `evidenceOfPractice`; observed focus count/rubric choices come from configuration. |
| Probation reflection and next date | 3 | `reflectionText`, `developmentOpportunityKeys`, `intendedNextObservationDate` |
| UCO evidence narratives | 16 | 3 teaching/learning + 4 delivery + 5 materials + 4 findings. Exactly 13 currently require narrative text; `essential_actions`, `advisable_actions`, `excellent_practice` are conditional/optional findings. |
| UCO course/session | 8 | Observation date/time, session type, course title, module title, level, registered/present/late counts. |
| UCO action row | 5 | `actionType`, `target`, `achievementMethod`, `ownerStaffId`, `dueDate`; maximum three rows. |
| UCO observer discussion/follow-up | 3 | Professional discussion date/time, follow-up type, scheduled date/time. |
| UCO lecturer reflection | 1 | `lecturer_reflection`; authenticated acknowledgement/signature is controlled. |
| UCO follow-up management | 4 | Type, scheduled date/time, status, conditional outcome notes; linked observation setup has six slots (observer/date/type/course/module/level). |
| Coaching main session | 14 | Six session/cycle controls (`sessionDate`, `sessionType`, `deliveryMethod`, duration, qualification, cycle); four focus controls (primary/secondary/Other/specific focus); three conversation controls (support/Other/summary); formal cycle close. |
| Coaching action row | 4 | Theme, `actionText`, owner type, due date. |
| Coaching previous-action review | 3 | `progressUpdate`, `impactObserved`, review outcome; a revised outcome adds an action row. Two historical evidence/impact values are displayed when present. |
| ELI statements | Dynamic | One rating per workspace statement; areas and scale options come from the API. |
| ELI LIV information | 5 | Preferred month, primary focus, secondary focus, conditional `secondaryFocusOther`, `desiredOutcome`. |
| Actions create | 7 | Theme, title, detail, associated staff, authorised owner, due date, visibility. Edit has the same six editable slots without changing associated staff. |
| Actions notes | 5 lifecycle values | Completion note, cancellation comments, extension date/reason, deletion reason. Status transitions and audits are controlled. |

## Managed wording and safe boundaries

`shared/workflow-form-content.json` now contains **47 existing narrative/display slots across six families**. The runtime hook supplies administrator wording/help while preserving the same typed property, permission, requiredness and save path. It falls back to shipped defaults if the supplementary request fails. No extra typed-store answers are invented.

| Family | Count | Exact managed keys |
| --- | ---: | --- |
| LIV / ALS LIV | 6 | `contextText`, `aimsText`, `learnerActivityText`, `distanceImpactText`, `reflectionText`, `reflectionNotes` |
| Probation | 6 | `contextText`, `aimsText`, `learnerActivityText`, `reflectionText`, `keyPoints`, `evidenceOfPractice` |
| Coaching | 9 | `specificSessionFocus`, `focusOtherText`, `supportOtherText`, `conversationSummary`, `progressUpdate`, `impactObserved`, `actionText`, `intendedEvidence`, `intendedImpact` (last two are historical display labels). |
| UCO | 19 | `academic_research_skills`, `personal_professional_development`, `employability`, `structure_pace_organisation`, `level_appropriate_inclusive`, `delivery_methods_styles_resources`, `student_feedback_engagement`, `module_handbook`, `itslearning_resources`, `session_materials`, `assessment_information`, `feedback_to_students`, `good_practice`, `essential_actions`, `advisable_actions`, `excellent_practice`, `lecturer_reflection`, `target`, `achievementMethod` |
| ELI | 2 | `desiredOutcome`, `secondaryFocusOther` |
| Actions | 5 | `title`, `detail`, `completionNote`, `cancellationComments`, `extensionReason` |

The typed field groups remain distinct from the versioned generic form system. New supplementary questions are safe only where the versioned form-response store already persists and exports them. Typed LIV/probation/coaching/UCO/ELI/action tables do not acquire arbitrary new answer columns in this change. Their cycle rules, staff/owner identities, statuses, outcome keys, visibility, sign-off order and action generation must remain protected.

## Implemented corrections and new editor

| Finding | Correction / coverage |
| --- | --- |
| Historical Environment details reused active-entry filtering, hiding inactive pillars and retired saved fields; current catalogue names could replace a stored section title. | Read-only details retain original sections/fields/title. Create/edit controls continue applying active catalogue rules. Existing stored display values take precedence over current lookup formatting. A handler test opens a historical record and verifies retained answers/title metadata. |
| Schema-required checks included fields the screen deliberately hides (conditional Learning Walk Other and retired CPD participant helper controls). | Local validation uses the same visible-field rules as rendering. A handler test proves hidden Other does not block, while selected Other still does. Matching generic create/update/draft-submit server validation is owned by the parent and must be integrated before claiming end-to-end parity. |
| Custom questions inside an inactive Environment pillar could be dropped with its inactive core controls. | `custom_*` fields survive entry composition. New custom sections survive as well; their required answers and values use ordinary response persistence. |
| Publishing between entry and save could select a different template definition from the one the user answered. | Both generic create consumers send `templateVersionId: definition.versionId`; the parent API honours that selected version. |
| The previous form-administration surface did not offer a clear generic immutable-version workflow. | New `AdminFormVersions` selects a form/version, copies a draft, edits labels/help/order, adds sections/questions, previews, saves with row version and explicitly confirms publication. Existing published versions are read-only. Protected fields cannot change type/required/options/section or be removed; sections containing them cannot be removed. |
| Save conflicts/failures could invite data loss in an admin editor. | Failed saves retain local work. A successful save with failed reload is identified distinctly and further writes wait for Reload version. The editor reports dirty/busy state and uses the existing unsaved-work guard. |
| CPD importer cannot supply arbitrary new required answers. | Editor explains the CSV impact. Required custom answers can block the import preview; optional custom answers are blank on imported entries. |
| A self-only LIV viewer could be offered a Word command the API always rejects. | LIV Word control now receives the same submit/manage/report-all policy identified by the role audit. Embedded probation LIV already omits the whole export toolbar. The API remains authoritative. |

The separate Work Scrutiny allocation, blank-template creation and template archive surface remains accessible through the parent-owned administration page; replacing those operations with a version editor alone would be incomplete. The new editor intentionally does not archive an active version.

## Remaining customisation gaps and integration requirements

1. **Controlled workflows are not arbitrary form builders.** Their existing 47 managed text slots are editable wording/help. Adding new persisted answers, changing requiredness or changing fixed statuses/options needs coordinated storage, validation, capability and export work. The editor must explain this boundary.
2. **Conditional rules are still semantic code.** Learning Walk Other, CPD participants/duration, Environment room/pillar derivation, Work Scrutiny course/sample rules, coaching Other/cycle closure, UCO findings/follow-up/signatures and mandatory LIV/probation progression are not a generic administrator rule language. Do not imply that a label change alters them.
3. **Version scope differs.** Generic questions/labels belong to immutable saved versions. Fixed narrative wording currently comes from current supplementary configuration, not a per-record wording snapshot; typed answers and their keys remain unchanged. Historical wording snapshots for those stores would be a separate design/data task.
4. **Shared Learning Walk template.** Learning Walk and ALS Learning Walk currently use one schema key, despite separate thematic/delivery data. Independent question wording/versioning for those two routes would require a deliberate template split.
5. **Dynamic choice catalogues.** Staff, rooms, organisations, themes, rubrics, ELI areas/statements and authorisation-dependent owners remain managed by their dedicated catalogues. Generic question choice editing cannot replace those data sources or permission checks.
6. **Historical values remain significant.** Retired choices must stay visible when saved. Current catalogue descriptors/artwork can still differ from historic metadata unless their own snapshots exist; stored field labels/display values are preserved wherever supplied by the saved record.
7. **Frontend gates complement server policy.** Source review is not a successful runtime test of all role assignments. Final verification must include subject-only, submitter, scoped reviewer/leader, T&L owner, UCO coordinator/observer/lecturer and administrator accounts, plus outsider denial and redacted exports.
8. **Work Scrutiny workflow grouping is fixed.** Course-level and delivery questions consume their configured labels/help and choices, but their controls are placed within the workflow's Context/Sample blocks. Editing a core-only helper section's title/order does not relocate those controls. Additional question sections retain their authored layout. This structural boundary must be explained in administration.

## Acceptance checks

The focused handler/SSR checks cover original sharing/cycle/action protections, failed/stale requests, required field links, historical choices, draft validation, pagination and new version-editor protection/conflict/confirmation behaviour. All API actions in these tests are fakes. The parent integration run owns full API policy tests, build and native preview; no production or local business record was written for verification.

The final workflow command passed **61 tests**:

```powershell
node --test tests/workflow-experience.test.mjs tests/workflow-list-filters.test.mjs tests/liv-workspace-render.test.mjs tests/liv-workflow.test.mjs tests/probation-actions-save.test.mjs
```

`node apps/web/node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json` also passed.

Added coverage proves that Environment custom questions remain answerable and validate inside an inactive pillar, generic and Work Scrutiny entry pin the answered version, custom choices are normalised/validated, save success followed by reload failure blocks a stale write, a sole initial draft cannot be discarded, managed guidance retains answer/read-only/error semantics, and self-only LIV viewers do not receive an unauthorised Word command. The new editor also mirrors the server's 50-section/300-question and text-length limits. Its initial-draft note directs unused Work Scrutiny templates to the existing template setup/retirement page.

An independent consumer/server review found and corrected two additional integration defects. Custom multiple-choice/checklist controls now persist JSON arrays in both generic and Work Scrutiny forms, matching custom-answer validation. Real checkbox handler tests cover selecting two values, a literal pipe inside one option, Save draft payloads, JSON and old-pipe edit round trips, unchanged legacy CPD pipe payloads and required empty `[]` selections. Older custom pipe values are normalised on the next save, and read-only custom answers render as answer text rather than raw JSON. Legacy non-custom payloads retain their original delimiter contract; the parent server validation must retain that legacy distinction as well.

Environment entry and editing also now honour the version's original section titles and `displayOrder`. Live pillar catalogue names/order and the former hardcoded Room heading no longer override an administrator's versioned changes. Pillar artwork/descriptions and active-core filtering remain, and a real header-render test verifies a renamed/reordered pillar with stable supplementary fields.

A final Work Scrutiny consumer correction removes hardcoded labels/help from the course-level and special delivery field renderers. Real SSR checks verify configured wording, help/error references, stable IDs, required semantics, selected values and live delivery choices; explicitly cleared help remains cleared. The targeted workflow-experience/list-handler command passed 45 tests after this correction. The parent reruns the complete frontend suite/build for final integrated totals.
