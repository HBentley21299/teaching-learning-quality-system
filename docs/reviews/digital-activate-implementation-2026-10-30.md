# Digital Learning Walks and Activate+ Growth Reviews

Implemented the guided journeys approved on 30 October 2026. Contributors are not collected. The API derives the review owner from the signed-in creator and preserves that identity when another authorised person amends the record.

## Entry points

- Digital Learning Walks: `/digital-learning-walks`.
- Activate+ Growth Reviews: `/activate-growth-reviews`, alongside Digital Learning Walks in **Forms & observations**.
- Reporting: both are available through the existing dashboard switcher.
- Administration: **Digital learning & Activate+**, with separate Digital framework/rating settings and Activate+ Skills Scan, meeting and action settings.
- Native action permalinks: `/actions/{actionId}`. The app resolves the action's academic year so a Teams link remains usable in subsequent cycles.

## Digital Learning Walks

The initial framework contains the supplied 24 statements across six standards. It is independent of ordinary Learning Walks and QA Hub questions. A review concerns a team or area; each statement has one overall rating and can reference several evidence samples. Removing a sample clears its links without deleting the statement's other answers.

The college rating scale remains unconfigured. Incomplete drafts, including partially entered sample information, can be saved. Formal submission requires the configured scale, all statement ratings and the configured evidence rules. Submitted reviews retain their original framework and continue to enforce submission requirements when corrected. An unrated draft can adopt a newly configured scale when its statement wording is unchanged.

## Activate+

The amended journey has five stages: review and participants, Skills Scan results, meeting minutes, actions, and final checks. Select a faculty, an area's sub-teams, individual sub-teams, or all available sub-teams. The organisation structure supplies the review creator, head of faculty and relevant programme leaders for the conducted review date. The creator and assigned head of faculty remain participants; programme leaders can be removed and other named participants added. Missing leadership assignments are reported rather than invented.

The review collects its conducted date. **Add follow-up review** creates and opens a linked draft from the first review page or register; an existing linked follow-up has an Open button. Earlier typed follow-up dates remain historical information. The preparation and snapshot stages are replaced by manual entry of the 15 sub-area averages from the supplied Activate+ Skills Scan, grouped under its six pillars. Values accept decimals from 1 to 5; blanks remain missing and do not prevent submission. A pillar's displayed summary is the unweighted mean of its sub-area averages only when all are present. Every result bar has a circular marker at its result, including the minimum and maximum. No individual question responses, NR/NO counts or five-category specialist scores are inferred from the supplied averages. Draft form values show a live preview; official reporting and exports withhold draft pillar means.

Meeting notes consist of three concise fields: minutes, strengths, and areas for development. The full Teams proforma fields and the progress/impact review stage are absent from the amended form. Earlier fields, pinned wording, dated Teams snapshots and legacy action evidence remain available as history.

Actions have a configurable specialist theme, a Skills Scan impact area, action detail, text impact measures, one or more searchable responsible people, and a review date. The five specialist themes are separate from the six Skills Scan pillars. Each action has one shared central action row, including when several people are responsible. Every responsible person can find and update that action through Actions, without receiving full review access. Review-date changes keep the central due date aligned and require a reason. Concurrency checks and native update history remain enforced; generic mutation endpoints cannot bypass them.

## Administration and access

Form managers maintain versioned Digital frameworks, statement wording, rating labels and evidence requirements. Activate+ settings expose the six pillar and fifteen sub-area labels, five action-theme labels and meeting prompts independently. Historical records retain their configured wording and resolved participant/scope context. The new process permissions support creation, scoped viewing, all-process viewing and scoped management. Existing system administrators retain their administrative authority; delegated form configuration permission does not grant access to everyone else's review narrative.

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
