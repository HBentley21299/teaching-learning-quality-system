# Digital Learning Walks and Activate+ Growth Reviews

Implemented the review processes approved on 30 October 2026. Contributors are not collected. The API derives the review owner from the signed-in creator and preserves that identity when another authorised person amends the record.

## Entry points

- Digital Learning Walks: `/digital-learning-walks`.
- Activate+ Growth Reviews: `/activate-growth-reviews`, alongside Digital Learning Walks in **Forms & observations**.
- Reporting: both are available through the existing dashboard switcher.
- Administration: **Digital learning & Activate+**, with separate Digital framework/rating settings and Activate+ Skills Scan, meeting and action settings.
- Native action permalinks: `/actions/{actionId}`. The app resolves the action's academic year so a Teams link remains usable in subsequent cycles.

## Digital Learning Walks

The initial framework contains the supplied 24 statements across six standards. Its criteria are independent of ordinary Learning Walks and QA Hub questions. A review concerns a team or area; the reviewer chooses one or more of the six DLW categories. Every statement in each chosen category is included, with its own rating.

The Digital form follows the continuous Learning Walk layout: context and focus, selected criteria with rating cards, inline actions, and Cancel / Save draft / Submit controls. Date, faculty, team and delivery area use the familiar Learning Walk presentation. The Scope and context text box, Findings section and per-criterion Evidence and rationale boxes have been removed, along with their obsolete wording/requirement settings; earlier saved text remains available as read-only history and in reporting and exports. The record title is derived from its context; the creator remains recorded automatically. Team choices include the organisation's faculty child units as well as teams. New DLWs have no sample section or sample-link controls; earlier samples remain available as read-only history.

Following Harry's later instruction, DLW uses the same managed 1–5 scale as Learning Walks: Emerging Practice, Developing Practice, Secure Practice, Strong Practice and Exceptional Practice. Wording, ordering, guidance and colours come from the shared practice rubric. DLW settings display this scale read only rather than maintaining a second copy. A review retains the scale snapshot used for its ratings; an unrated draft can safely adopt the shared scale when its criteria are unchanged.

Incomplete drafts and actions can be saved. Formal submission requires at least one selected category and a rating for every statement in each selected category. It does not require rationale or samples. Statements in unselected categories do not count as missing or unrated. Earlier partial selections, sample data and original rating wording are preserved when historical records are viewed or amended; changing a category selection explicitly adopts complete category coverage.

New inline actions have a theme, action text, owner and implementation date. They remain part of the review draft and become central assigned actions atomically on submission. Repeating a submission or correcting the review does not duplicate them. Existing live actions retain their identities and history. Saving a submitted review assigns any newly agreed actions as part of the same save. Reporting and exports distinguish unassigned draft actions from live actions, and preserve the selected criteria and named delivery area.

## Activate+

The amended journey has five stages: review and participants, Skills Scan results, meeting minutes, actions, and final checks. Select a faculty, an area's sub-teams, individual sub-teams, or all available sub-teams. The organisation structure supplies the review creator, head of faculty and relevant programme leaders for the conducted review date. The creator and assigned head of faculty remain participants; programme leaders can be removed and other named participants added. Missing leadership assignments are reported rather than invented.

The review collects its conducted date. **Add follow-up review** creates and opens a linked draft from the first review page or register; an existing linked follow-up has an Open button. Earlier typed follow-up dates remain historical information. The preparation and snapshot stages are replaced by manual entry of the 15 sub-area averages from the supplied Activate+ Skills Scan, grouped under its six pillars. Values accept decimals from 1 to 5; blanks remain missing and do not prevent submission. A pillar's displayed summary is the unweighted mean of its sub-area averages only when all are present. Every result bar has a circular marker at its result, including the minimum and maximum. No individual question responses, NR/NO counts or five-category specialist scores are inferred from the supplied averages. Draft form values show a live preview; official reporting and exports withhold draft pillar means.

Meeting notes consist of three concise fields: minutes, strengths, and areas for development. The full Teams proforma fields and the progress/impact review stage are absent from the amended form. Earlier fields, pinned wording, dated Teams snapshots and legacy action evidence remain available as history.

Actions have a configurable specialist theme, a Skills Scan impact area, action detail, text impact measures, one or more searchable responsible people, and a review date. The five specialist themes are separate from the six Skills Scan pillars. Each action has one shared central action row, including when several people are responsible. Every responsible person can find and update that action through Actions, without receiving full review access. Review-date changes keep the central due date aligned and require a reason. Concurrency checks and native update history remain enforced; generic mutation endpoints cannot bypass them.

## Administration and access

Form managers maintain versioned Digital frameworks and statement wording; the shared Learning Walk rating scale is displayed read only. Activate+ settings expose the six pillar and fifteen sub-area labels, five action-theme labels and meeting prompts independently. Historical records retain their configured wording and resolved participant/scope context. The new process permissions support creation, scoped viewing, all-process viewing and scoped management. Existing system administrators retain their administrative authority; delegated form configuration permission does not grant access to everyone else's review narrative.

Assigning an action does not grant full review visibility. Permissions and organisation scope are checked on the server. Excel export also requires the existing `exports.create` capability.

## Reporting

The native registers support named owners, faculties/sub-teams, participants, status, dates, search, sorting and pagination. Review counts, sample counts and action counts have separate reporting grains. Selected Activate+ reviews display their fifteen entered averages and six complete pillar summaries; there is no invented college-wide Skills Scan average. Coverage percentages are not fabricated when an eligible population is unknown. Digital rating categories remain independent of the Skills Scan scale.

Digital Excel workbooks retain form fields and linked evidence samples, responses, sample links, actions and updates. Activate+ exports contain the form's scope, participants, dates, meeting notes, fifteen manual averages and six complete submitted pillar means, with Skills Scan, scope, participant, action and update sheets. Historical form, snapshot and impact evidence sheets appear only when earlier data exists. Scores export as numbers and dates as dates; internal identifiers, row versions and UI visibility fields are excluded. The export control explicitly describes its permitted academic-year scope, independently of local table filters.

The new reporting views reset when account or permission scope changes and load their own datasets. Switching into them suspends the older dashboard's large-data aggregations.

## Initial implementation verification

Migration `094_process_reviews.sql` was applied to the prepared local database and recorded with its normalised checksum. Application data counts were unchanged: 2 staff, 3 records, 0 actions before and after migration. No fixtures or staff data were loaded. Database integration tests create and remove separate disposable databases.

The local API and frontend are started using `scripts/start-local.ps1 -SkipDatabase`. Read-only API smoke checks confirmed database readiness, the six-standard Digital framework with no rating options, and the five-area Activate+ framework. Browser inspection reached the existing test-account sign-in screen; authentication settings were retained.

Final verification: 402 frontend tests and 629 backend tests passed with no skips. The production frontend build and Release backend build passed. Live read-only Excel downloads were opened in memory and their detail sheets verified for both processes. Native action lifecycle integration checks include completion/cancellation actor attribution, reopening, deadline changes and preserved history.

The college rating scale remains the required input before Digital Learning Walks can be formally submitted. No remote repository write or deployment was performed.

## Amendment verification

The Skills Scan source was `Activate-Plus-Skills-Scan (1).pdf`, supplied by Harry. The agreed input is fifteen already calculated sub-area averages, with decimals allowed, rather than the thirty-six individual responses in that document.

Migration `095_activate_growth_review_workflow.sql` is additive and was applied on 30 October 2026. The before/after application data counts remained 2 staff, 4 records and 0 actions. Only the new migration was applied; no fixtures, seed reload, reset or data removal occurred. Its canonical UTF-8/LF checksum was recorded in `dbo.schema_migrations`.

The migration adds persisted review scopes and participants, historical configuration preservation, action impact-area/detail/review-date metadata, and multi-person action assignments. Resolved participant defaults and scope names are frozen for an unchanged initial review scope/date; removing a programme leader does not erase their identity from the default participant catalogue, so they can be restored later. Renaming or reparenting organisation units does not rewrite the review's saved scope labels.

Final amendment verification: all 430 frontend checks and all 637 backend checks passed, with no skips. A subsequent focused backend run passed all 15 process checks after adding full structural before/after action auditing. The audit regression verifies previous and revised responsible people, action detail, theme, impact area and impact measures. The frontend production build and Release backend build passed; the frontend retains the existing approximately 548 KB main-bundle advisory.

The local services were restarted using `scripts/start-local.ps1 -SkipDatabase`. Read-only API checks confirmed six Activate+ pillars, fifteen sub-areas, five action themes, and the still-unconfigured Digital college rating scale. Both native Excel downloads were inspected in memory and their detail sheets checked. A live read-only organisation preview resolved seven sub-teams and the required review creator; the local organisation's missing leadership assignments appeared as warnings. Application data counts remained unchanged after these checks. Existing browser authentication was retained; no authenticated end-to-end browser session was used for the amendment verification.

## Linked follow-up reviews

A follow-up is a separate draft linked to its preceding review. Creating it requires permission to amend the source and create an Activate+ review. Adding it again opens the existing child; a subsequent follow-up can be added from that child. The database enforces one child per preceding review, so a repeated request does not create duplicate drafts.

The child retains the source's configured framework, named scope and participants. Its creator becomes the required review owner. The team scope stays fixed, while participants can be adjusted using the same required-role rules. Previous Skills Scan values and meeting notes are frozen as reference when the link is created. New meeting notes and new scan values start blank; entering updated scan results is optional. Earlier values never fill current reporting cells or become new evidence of progress automatically.

The existing action records appear in the follow-up with their original identities and dates. Updating one of them updates the shared central action, without creating a second action or replacing the current review with its parent. Parent narrative and baseline access still require permission to read the parent; separate action assignment continues to allow only that action's data. Follow-up links, previous results and current results are distinguished in reporting and exports, including when a linked review belongs to a different academic year.

Migration `096_activate_linked_follow_ups.sql` adds only the link table and its constraints. It was applied with its canonical checksum recorded; application data counts remained 2 staff, 5 records and 0 actions before and after. No follow-up reviews were created in the application database for testing. Disposable database checks verify repeated Add requests, a third linked meeting, different review creators, source-access restrictions, stable scope after organisation changes, frozen source status after later submission, and cross-year shared action/export behaviour.

Final linked-follow-up verification passed all 442 frontend and 641 backend checks, with no skips. The production frontend build and Release backend build passed. The existing main-bundle size advisory remains. Marker checks cover scores 1, 3 and 5, accessible meter values and reduced-motion styling. No remote repository change, publication or deployment was performed.

Local services were restarted with `-SkipDatabase`. Read-only review-list, detail and action requests passed; both Excel workbooks were opened in memory and the Activate+ Review links sheet was verified. The web app returned HTTP 200, readiness reported the database connected, and application counts remained 2 staff, 5 records, 0 actions and 0 follow-up links. Real follow-up creation was tested only in disposable integration databases.

## Digital Learning Walk form parity

The later DLW amendment follows Harry's confirmed choice of relevant criteria. It replaces the five-step Digital workspace with the normal Learning Walk's continuous form, while retaining the six standards, twenty-four available DLW criteria and linked sample model. Unselected responses are excluded from the current record/reporting on save; the audit retains the previous and revised data so earlier evidence remains traceable. Legacy records and existing live actions remain readable.

Draft actions stay within the DLW JSON until submission. The parent review, all promoted actions, histories, audit entries and assignment events commit together; a failed action promotion rolls back the whole submission. Stable draft action identities prevent duplicate assignments on retries. New native action creation is blocked on every Digital draft, including older records, and generic action creation cannot bypass the native workflow. Assigned owners are active Programme Leaders or above in scope. A new action's implementation date cannot precede the visit date on formal submission.

No additional database migration is required. All 454 frontend checks and 646 backend checks passed with no skips. The production web build and backend Release compilation passed. Desktop and 390-pixel mobile previews used the actual component with dummy data and a clearly marked example scale; no page errors or mobile horizontal overflow were found. The actual DLW scale remains unconfigured. These preview checks did not alter authentication or create application records.

After restarting with `-SkipDatabase`, read-only API checks confirmed the six standards and twenty-four available criteria, the unconfigured rating scale, updated wording settings, delivery-area choices, eligible owners and existing review reads. Digital and Activate+ Excel downloads were opened in memory and their detail sheets verified. Application counts remained 2 staff, 5 records and 0 actions. This amendment remains local on `codex/dlw-learning-walk-form`; no remote repository write or deployment was performed for it.

## Shared Learning Walk scale and criterion notes

Harry subsequently requested the same scale as Learning Walks and removal of the sample section. The shared managed practice-rubric query now supplies both processes. DLW copies the active 1–5 category keys, displayed wording, guidance and colours into each review's configuration snapshot. Current DLW settings display that source read only and cannot create a divergent scale. Historical rated records retain their pinned wording; an empty, unrated draft with unchanged criteria can adopt the shared scale when its first rating is saved or submitted.

New DLWs have no sample editor, sample-link checklists, sample reporting counts or empty sample export sheets. Criterion evidence notes remain. Submission does not require samples, and earlier sample evidence is retained as read-only history where present. Old partial sample titles, incomplete URLs and unchanged historical staff references cannot block the notes-only form; structural sample-reference validation and validation of newly introduced staff references remain enforced. Unsafe earlier URLs are displayed as plain text.

All 458 frontend checks and 647 backend checks passed, with no skips. The web production build and Release backend compilation passed, and the actual component was checked at desktop and mobile widths using the shared five-category scale. No database migration is required; integration submissions were exercised only in disposable databases. The earlier statements that the DLW scale was awaited describe the preceding implementation and are superseded by this amendment.

Local services were restarted with database preparation skipped. Read-only live checks confirmed exact parity with the Learning Walk scale for all five category keys, labels, scores, guidance texts and colours, and confirmed criterion-notes mode with no sample requirement. The live DLW Excel contained Form entries, Responses, Actions, Updates and Export Information, with no empty sample sheets. Activate+ exports and web readiness also passed. Application counts remained 2 staff, 5 records and 0 actions; no remote push or deployment was performed.

## Whole-category Digital Learning Walk focus

Harry's 31 October amendment replaces individual statement checkboxes with one checkbox for each of the six DLW categories. Selecting a category includes every statement in its pinned framework; each included statement still receives its own Learning Walk scale rating and evidence notes. Multiple categories can be selected. Removing and reselecting a category retains the in-memory answers until save, while saved reporting excludes unselected statements.

The API expands category keys to the complete statement set and rejects formal submission if any included statement remains unrated. Earlier clients creating a walk without category metadata have their represented categories expanded automatically, and a category-based saved walk cannot be downgraded to an earlier partial-selection payload. Existing pre-amendment records retain their exact saved criterion selections until a reviewer explicitly changes a category. Earlier partial categories have a mixed checkbox and clear explanation; viewing them does not add statements, ratings or unsaved changes.

Dashboard and Excel category labels, counts and statement coverage come from the review's pinned framework. Exports include all statements in selected categories, including unanswered draft statements. Historical partial coverage is labelled explicitly, rather than presented as complete category coverage. Administration guidance explains that reviewers choose whole categories. No schema change or application-data rewrite is required.

Verification passed all 468 frontend checks and 651 backend checks with no skips, plus the production web build and Release backend compilation. The actual component was exercised at desktop and 390-pixel mobile widths: six category selectors, complete child expansion, retained answers on deselect/reselect, and explicit legacy partial-selection adoption all passed without browser errors or horizontal overflow. The final guidance wording also passed its focused administration/editor checks. The existing main-bundle size advisory remains.

Local services were restarted with `scripts/start-local.ps1 -SkipDatabase`. Read-only live checks confirmed six categories, twenty-four statements, five shared Learning Walk ratings, criterion-notes mode, the new category Excel headings, healthy Activate+ exports and HTTP 200 for the web app. The application database currently has no Digital reviews; persisted category selections, pinned-framework coverage, legacy round trips and submissions were verified in disposable integration databases. Application counts remained 2 staff, 5 records and 0 actions. No remote repository write or deployment was performed.

Harry subsequently removed the Scope and context field from the DLW form. Its admin wording control and default label are removed too. DLW exports omit the obsolete column unless the exported records contain earlier nonblank answers; those answers remain intact. The focused checks passed 25 frontend and 61 backend tests, the web production build and Release backend compilation. The component preview confirmed the box is absent and category interactions still work at desktop and mobile widths.

The following amendment also removes Findings (good practice and areas for development) from the DLW form, leaving criterion ratings and notes followed by Actions. Their admin wording controls and default labels are removed. Each retired export field appears only when earlier records contain a nonblank answer; saved data and Activate+ findings are retained. The updated existing checks passed 25 frontend and 61 backend tests with no skips, both builds passed, and the desktop/mobile component preview confirmed Findings is absent with category interactions intact.

## Ratings-only criterion cards

Harry subsequently removed Evidence and rationale beneath each DLW criterion. Current cards contain the shared 1–5 rating controls only. Ordinary and ALS Learning Walks were reviewed and already use rating-only focus cards, so their overall findings and actions were left unchanged.

The obsolete admin rationale requirement is removed, and current DLW configuration reports `evidenceMode=ratings_only`, `requireRationale=false` and no sample requirement. Earlier pinned `requireRationale=true` settings no longer block submission. Each selected category still requires every child rating. Saved earlier rationale remains in a separate collapsed read-only history section, survives ordinary rating updates, and remains reportable/exportable under an explicit historical label. New exports omit empty rationale columns. Historical sample compatibility, the shared rubric, staged actions and Activate+ remain intact.

Verification passed 39 focused form/admin/editor/report checks and 63 backend/export checks without skips, plus the reporting agent's focused helper/access checks. The production web build and Release backend compilation passed. Actual-component desktop and 390-pixel mobile previews confirmed no per-criterion textareas, retained historical notes, working category/rating controls and no overflow or browser errors. No migration was needed. Services were refreshed with database preparation skipped; read-only live settings and DLW/Activate+ Excel checks passed. Application counts remained 2 staff, 5 records and 0 actions, with no fixture loading, remote push or deployment.
