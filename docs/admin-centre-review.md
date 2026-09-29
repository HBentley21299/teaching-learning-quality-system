# Admin Centre review — 8 September 2026

## Scope and approach

Reviewed the Admin Centre, its existing child editors, API contracts, endpoint permissions and underlying configuration stores. The local implementation preserves the preceding homepage/navigation work. No production deployment, GitHub writes or test-data seeding is part of this change. The follow-up form editor adds migration 075 for QA display wording; it has been applied only to local development.

Design references:
- [Microsoft Fluent navigation](https://fluent2.microsoft.design/components/web/react/core/nav/usage): plain task labels, shallow grouping, a consistent location and a visible current section.
- [IBM Carbon forms](https://carbondesignsystem.com/patterns/forms-pattern/): related fields, descriptive labels, predictable actions and contextual help.

## Findings and changes

| Area | Finding | Result |
| --- | --- | --- |
| Navigation | Primary tabs, secondary tabs and accordions obscure destinations | One grouped, searchable directory with a current-page indicator and direct section URLs |
| Landing page | Static role guidance and disabled module checkboxes dominate the page | Task directory with descriptions; honest module status moved to System information |
| People | Accounts and role allocation share a page | Separate Staff accounts, Staff details & scope, and Roles & permissions sections |
| Staff correction | Name, job title and scope updates already exist in the API but lack an editor | New explicit Save/Cancel editor; preserves unrelated roles and scope types |
| Forms | Templates, QA questions and lists are disconnected | One Form editor with a form picker and contextual layout, choices and QA language panels |
| Workflow settings | Coaching action limit is buried under lookup lists | Session settings within Coaching & Mentoring in the Form editor |
| Themes | Teaching, ALS walks and ALS LIV catalogues are buried together | Contextual theme panels within each relevant form; old deep links still resolve |
| Rooms | Existing database catalogue has no write API or admin editor | New permission-gated room editor with validation, duplicate handling, row-version conflict detection and transaction audit |
| Work Scrutiny | Fully implemented correction screen is imported but never mounted | Dedicated correction section, requiring both permissions used by its existing API calls |
| ELI | Record correction and badge images appear together | Separate ELI record corrections and Elevate badges sections |
| Operations | Existing records, messaging and reporting editors work but are hard to find | Plain-language destinations for All records & audit, Messages & email, Dashboard layout |
| Account creation | Large creation form precedes routine account maintenance | Creation form is disclosed only when requested |

## Data and access safeguards

- Navigation filters are a usability layer; room writes also enforce `lists.manage` at the API boundary.
- New room changes are audited in the same database transaction. Existing room IDs are retained, and no delete endpoint is added.
- A room referenced by assessments cannot have its code changed. Deactivation removes it from new selections without deleting assessments. Building-name corrections remain visible in historical displays because those displays join the room catalogue; the editor explains this.
- Existing staff update behaviour is reused. Only changed fields are sent; global/self access and leadership-derived scopes follow the backend's existing rules.
- Work Scrutiny's audit/actions calls require `users.manage`, while record editing requires `records.manage`. The new destination requires both to avoid a partly functioning editor.
- New room and staff editors expose dirty state to Admin Centre navigation and guard browser unload. Existing editors retain their existing save behaviour; this is not an application-wide unsaved-change guard.
- Rooms use the existing `quality.rooms` table. Deploy the API and web changes together; older live databases must first be verified to contain the expected room schema.

## Remaining configuration boundaries

These were reviewed and are deliberately disclosed rather than presented as working editable controls:

| Capability | Why a separate change is required |
| --- | --- |
| Academic-year dates/rules | Needs a write contract, overlap/current-year validation and a decision about reporting-history semantics |
| Course catalogue | Needs a supported maintenance/import ownership policy and preservation of historical course samples |
| LIV/learning-environment rubrics | Needs versioned descriptors so wording changes do not reinterpret completed assessments |
| Elevate level names and thresholds | Defined in code; needs versioned rules and explicit treatment of existing awards |
| Controlled workflow stages | A form-template edit does not alter workflow validation, transitions or permissions |
| Staff email/external ID | Identity fields are outside the existing update contract; changes need identity-reconciliation safeguards |
| Clear an existing job title | Existing update SQL treats blank as unchanged; replacement is supported, clearing is not |
| Local passwords | API exists, but enabling another sign-in method needs an explicit account-management policy; no new password UI added |
| Module enablement | A database flag alone is not an end-to-end feature gate; no misleading toggle added |
| SQL/sign-in/storage/backups | Remain hosting settings owned by college IT; no credentials exposed in Admin Centre |

## Verification

- `node --test tests/admin-navigation.test.mjs`: permission filtering, specialised endpoint requirements and complete/unique destinations.
- TypeScript and production web build.
- Room validation/history/concurrency unit tests and backend build.
- Local read-only API and UI checks; no saved test records or changed staff permissions required.

## Unified form editor follow-up

- One admin destination replaces separate forms, lists, QA questions, coaching settings and theme entries. Legacy URLs remain supported. Permission checks expose only the form families and panels each administrator may use.
- Explicit lookup dependencies group each form's shared choices; All shared lists retains access to the complete catalogue. Shared lists preserve stable identifiers, audit changes and support deactivation. The Used in metadata makes cross-form impact visible.
- Work Scrutiny supports creating or copying to an unused draft, changing question/section wording and order, adding/removing questions, response options, guidance and required flags. Generated reference keys remain read-only. Context, course samples and action fields remain controlled; published definitions cannot be restructured.
- Saving and publishing now saves the visible draft first. A failed save prevents publication; failed publication leaves a saved draft. Successful structure saves reload server field IDs. Non-404 definition failures cannot be presented as an empty editable form.
- Editor and preview use separate full-width views, with responsive field controls. CPD and Learning Walk definitions remain structurally controlled; their contextual lists/themes are editable. Other specialised workflow layouts and non-QA rubric definitions are not made freely editable by this release.
- QA question changes retain existing versioning. Outcome wording is global across QA processes and appears on existing/new evidence, dashboard displays and newly generated PDF/Excel exports. Previously downloaded files retain their original text. Canonical below/at/above/not_applicable outcomes, question snapshots, scoring and denominator rules are unchanged.
- QA labels require four distinct single-line names of 1–40 characters, qa_reviews.manage, a current rowversion and an audit entry in the same transaction. Migration 075 creates the label singleton and registers the existing QA action theme list; it does not rewrite evidence or seed records.
- Form drafts, new-template input, managed-list drafts, QA question editors and QA label changes participate in internal navigation protection. Theme/coaching edits also report unsaved changes, with cancel controls; navigation is disabled during active saves. The whole app's sidebar/history still has no shared unsaved-navigation boundary.
- Existing QA commentRequiredAtExpected enforcement was reviewed and is not implemented by the current policy. No new toggle is exposed for that unsupported behaviour.

Follow-up verification: web production build, backend Release build and 43 focused QA policy/wording/PDF tests passed. Local API smoke checks saved the unchanged default wording (200), rejected an old rowversion (409) and duplicate labels (400); saved language stayed unchanged. Migration 075 was applied alone with its canonical checksum recorded, and core.records remained at zero.

Browser follow-up: checked CPD contextual lists, internal unsaved navigation, QA wording cancellation and mobile layout. A temporary browser-only Work Scrutiny fixture verified multiline entry, preview, save-before-publish and no publication after a simulated failed save. Fixture writes were simulated, with no form definitions or records inserted in SQL.

## Learning Walk delivery areas

- Standard Learning Walks share LIV delivery-area choices; ALS Learning Walks share ALS LIV choices. Both appear in the Form editor's contextual lists, with cross-form usage information and a dropdown in the Learning Walk preview.
- New submissions require a delivery area; drafts may be incomplete. Existing submitted walks without this field remain editable and report as Not recorded. Selecting an area saves its stable key and wording; subsequent list renames or retirement preserve saved wording. New selections must belong to the correct active catalogue.
- Delivery areas appear in record lists, searches and record details, dashboard filters, record tables and a distribution chart. Each walk counts once irrespective of its focus selections. Area filters also scope linked actions and Excel/PDF downloads; Word record exports include the saved area. Dashboard group wording uses the latest saved label for each stable key.
- Migration 076 adds the field to existing Learning Walk template context sections and registers shared-list usage. It does not backfill historical responses or insert records. Apply it with the matching API/web release. Only the local development database has been updated here; college SQL and GitHub were not changed.
- Verification: 23 focused backend policy/export tests and six frontend choice/dashboard tests passed, alongside backend and production web builds. Local dropdown, definition, records, dashboard and filtered Excel/PDF endpoints returned successfully. Browser checks covered real form options and browser-only dashboard fixtures for selected and missing areas; no fixture records were saved. A responsive grid correction keeps wide dashboard tables inside their scroll containers. Local core.records remained zero.

## ELI report editing and statement responses

- Submitted Elevate Learning and Innovation reports expose editing to the direct line manager and managers above them through the existing active staff-management hierarchy. Record administrators retain access. Broad reporting visibility or an unrelated staff scope does not grant editing; the API enforces the same rule for reads and saves.
- Profile and record-link report views use the server's CanEdit flag. Corrections target the staff and assessment loaded in the report, remain submitted and reuse transactional audit/scoring updates. Managers cannot use this route to take over a draft or edit their own locked submission.
- Report outcomes expand by section to show every statement, saved rubric response, guidance and any recorded reflection. Show all responses and Collapse all responses support reviewing the entire assessment. Missing responses are explicitly labelled Not recorded.
- Verification: 17 authorization policy cases passed, API compiled, TypeScript checks and production web build passed. Browser-only fixtures verified record-link editing, the correct save target, refreshed response wording, read-only viewing, individual/all expansion and a 390px mobile layout without page overflow. Fixture saves were simulated; local records and ELI assessments both remained zero. Local API lookup completed successfully with the expected 404 for a nonexistent assessment. No database migration is needed.

## QA Hub publication, allocation and concurrent reviews

- Review managers can edit title, theme, owner and closing date and add faculties/teams while a review is open or reopened. Published academic year, planned opening, question sets, activities, templates and frozen questions remain fixed. Existing team allocations, organisation snapshots, contributors and evidence remain intact. Closed reviews must be reopened before editing; archived reviews remain locked. The API validates this structure under a review lock and row-version check and audits the before/after configuration.
- Migration 077 removes only the former singleton index and computed slot. Each review retains its own lifecycle, evidence, scope and dashboard snapshots. It was applied to local TLQS with its canonical checksum recorded; college SQL and GitHub were not changed. Deploy this migration alongside the matching API/web release.
- QA Hub now starts with the review directory and provides a named review switcher. Review identity, status, closing date and scope remain visible. Review/section keys and request sequencing prevent stale review state from appearing after switching. Configuration saves refresh directory counts and names.
- Setup distinguishes editable drafts from published allocation changes. Existing allocations and published questions are visible as retained content; active faculties show selected-team counts. Question-loading failure blocks structural saving, and inconsistent review dates are flagged before saving.
- Publish, close, reopen and archive use a review-specific confirmation panel. Closing displays coverage gaps and drafts beside the required closure note. Failed transitions preserve the review and note, with refresh/retry available. Draft/closed views explain their next steps, and historical evidence is presented as viewable rather than as a disabled submission flow.
- Evidence submission returns to its source review. Evidence pages name that review, preserve optional notes when outcomes change, label submitted changes as corrections, expose autosave failures, and retain edits that outlive an in-flight save. Review configuration/evidence edits and lifecycle notes register independent navigation guards; internal switches, browser Back and the main workspace switch respect them. Other application editors retain their existing navigation behaviour.
- Verification: 54 focused QA policy tests passed, including 22 new published-structure/lifecycle cases; the API compiled and TypeScript/production web checks passed. Browser-only fixtures covered additional faculty allocation, three concurrent open/reopened reviews, draft publication, close conflict/retry, reopening, evidence submission to the correct review, dashboard navigation and mobile layouts. Navigation regression fixtures confirmed cancelled browser Back does not reach the parent app listener and cancelled workspace/review switching retains edited text. A local SQL transaction successfully held two open/reopened reviews, then rolled back; final core.records, qa.reviews and qa.evidence_submissions counts were all zero. Temporary preview files were removed.

## Work Scrutiny Quality Review

- Adapted the supplied paper form into existing versioned Work Scrutiny templates: 15 statements in five groups, five-level qualitative ratings plus N/A, section evidence, learner sample details, strengths/development, overall judgement and triangulation. The existing record controls provide faculty/team, reviewer/date and course links. Optional staff names are context only and do not alter staff access or attribution.
- Migration 078 supplies one published standard template per uncovered active team (46 locally), while preserving custom published templates, reserved custom drafts and all historical records/versions. Admins can edit wording and choices through the existing Form Editor. It introduces no schema or global scoring changes and was applied only to local TLQS with its checksum recorded.
- Actions retain the existing source links, owners, due dates, permissions and tracker. Optional expected-impact/follow-up prose is saved in the action's existing detail field; subsequent evidence and progress use the linked action workflow. No separate paper sign-off or follow-up table was introduced.
- Learner sample size is validated as a positive whole number and no longer overwritten by the number of course links. Edits preserve course summaries. Ratings validate against the submission's template version, including administrator-customised wording; N/A remains a qualitative response rather than a numeric score. Stale/unknown field IDs and contradictory triangulation selections are rejected.
- Verification: 23 focused backend checks passed, TypeScript and production web builds passed. Rollback SQL tests covered repeated installation, custom draft/published reservations, unchanged historical data,12 learners with 2 courses, later 17 learners with retained course summaries, and multiline linked-action details. Browser-only checks covered actual template rendering, 15 ratings, course selection, required responses, captured submission, and mobile/light/dark layouts. No fixture records or courses were retained; local core.records stayed at 2 existing user records. GitHub and college SQL were untouched.
- Final performance check: parameter-aware query compilation reduced the form endpoint from approximately 26 seconds to 3.9 seconds on the first successful request after restart. Query filters, permissions and version selection are unchanged. LocalDB briefly failed to reopen after restart, then recovered; final readiness was healthy and direct verification confirmed 2 existing records and 46 installed templates. No database settings, data reset or restoration were used.

## Dashboard PDF and Excel exports

- Dashboard Report controls now describe PDF as an expanded dashboard report and Excel as form data. Both use the current dashboard filters and full result set, independent of detail-table search or pagination. The shared control is also used on UCO TLA and fits mobile screens.
- PDF reports use QA Hub styling, dashboard measures, trends, outcome distributions and averages, faculty/team summaries, action assurance and full entry detail. ELI statement outcomes, Learning Walk delivery areas, LIV stages/practitioner coverage and CPD attendance are included. Cohort measures retain the dashboard's academic-year/organisation scope. Individual rating dates and selected ELI areas are respected. All responses paginate without the previous 120-row/two-line clipping.
- Excel's primary data sheet has one source entry per row (one action or staff member for those dashboards). Saved question identities define a union of columns across versions, including keyed multi-theme answers; absent answers stay blank, N/A stays explicit and saved template/version metadata is retained. Supporting sheets retain one-to-many relationships, original answers, field definitions and dashboard input data. ELI exports actual statement answers without inventing legacy fallback responses. CPD exports events with attendance detail; UCO keeps its existing coordinator/draft visibility.
- Dates and numbers are typed for analysis. IDs, long numbers and submitted text remain literal. Worksheet/row/cell limits return an explicit validation error rather than a silently partial file. No migration or reporting-score changes are required.
- Verification: 33 focused export, scope and PDF tests; TypeScript checks; successful local Excel downloads for all 14 dashboard areas; Learning Walk/UCO/overview PDF downloads; workbook structure and PDF bounds inspection; desktop/mobile menu checks. A 126-entry synthetic PDF fixture expanded to 46 pages and retained the final entry and all 100 paragraphs of a long response. Current-year local form datasets were empty, so changing themes/versions and populated pagination were covered by synthetic tests. One local cohort query timed out and passed on retry. Existing records were not reset or replaced; college SQL and GitHub were untouched.

## Work Scrutiny rubric and course level

- Work Scrutiny creation and editing use the same coloured practice-scale cards as Learning Walks and LIV. Standard wording displays Emerging through Exceptional Practice; saved values, custom wording and neutral options remain intact. Overall picture uses the same cards when configured with the standard five outcomes.
- Course information is a course-level dropdown using the existing saved qualification-level field and configured options, with the existing LIV level range as its default. New submissions no longer fetch or require an imported course register. Historical course links and previously saved level text remain editable without being rewritten.
- Level-only records feed dashboard coverage and exports through their saved form responses. Historical linked-course reporting is retained. The API validates level choices and preserves existing sample-size and response validation.
- Verification: 30 focused Work Scrutiny/export tests passed; API and TypeScript builds passed. Browser-only desktop/mobile previews captured a valid submission with the existing field identities and no course IDs, without writing a record. Local readiness and the dashboard-dimensions query passed after restarting with `-SkipDatabase`. No migrations, data loading or database updates were performed for this change.

## QA drafts and form submission access

- QA evidence stays in Drafts while opened and saved. Recent submissions and activity submission counts include submitted evidence only. Explicit Submit moves the entry between lists. Review summary and close-validation reporting totals now also exclude drafts; the separate draft count still supports unfinished-work checks. Existing dashboard, PDF and Excel submitted-only filters are retained.
- Admin Centre → Form Editor → QA reviews → Form access provides an optional whitelist per template for QA Staff completion/editing. Settings default to All QA Staff. Selected staff with an empty list blocks QA Staff completion; management and independent college-wide submission permissions retain access. Whitelist membership never grants a role or organisation scope. Submitted evidence/report viewing is unchanged, as requested.
- The API checks current form access for draft creation, autosave, submission and correction, including the original form when editing an existing entry. Removing access prevents further saves from an already open editor. Another reviewer's evidence also requires correction permission. Read-only evidence has an explanation in the UI. Duplicated templates inherit whitelist settings and members.
- Migration 080 adds the template restriction flag and member table only. Applied to local TLQS with all nine template restrictions off; no QA Staff accounts were assigned or test records loaded. College SQL and GitHub were untouched. Deploy this migration with the matching API/web release.
- Verification: 91 QA tests passed; six production-access-query CTE cases and four submitted-only reporting CTE cases passed without application writes. API/TypeScript builds passed. Browser-only desktop/mobile fixtures verified draft saving, explicit submission movement, restricted buttons and staff selection/save. Local settings/evidence reads passed; invalid staff returned 400, stale settings 409 and unavailable form saves 403. Rejected saves preserved the prior settings/row version. All four existing records, two evidence entries and eight responses remained; local startup used `-SkipDatabase`.

## Elevate Learning and Innovation validation

- Submitted self-assessments now await programme leader validation. Reviewers can expand every statement, validate the result, or return it with required feedback. Returning the current year's assessment unlocks it for staff to amend and resubmit. Joint editing uses the existing statement editor, requires a reason and staff-present confirmation for non-admin reviewers, and returns the result to awaiting validation. Historical years support tracked joint amendments; they cannot be returned to the current-year staff editor.
- A Programme leader validation view shows scoped staff, pending/returned/validated counts, status and staff filters, reviewer/date and feedback. Initial drafts are tracked without a Review action. Staff see return feedback/history above their editable assessment. Decisions and content changes record actor/time/note; existing audit records retain before/after content and joint-edit confirmation.
- Permission `elevate_practice.validate` is granted to programme leaders and existing senior leadership/administrative roles. Staff scope is enforced by the API; nobody can validate their own assessment. Existing manager edit access remains. Review and all existing-assessment saves use rowversion concurrency, with locked checks before replacing responses; inconsistent workspace reads are rejected. Any submitted amendment invalidates the old validation and requires a fresh review.
- Migration 081 adds validation metadata/history and role permission grants. Existing submissions become pending, never implicitly validated. Applied locally only; startup skipped database preparation and seeds. Existing dashboard scores continue to reflect submitted answers; validation is monitored separately. Deploy the migration and matching API/web together.
- Verification: API/TypeScript builds, 54 focused validation/access tests and four production-SQL cases against temporary tables passed. Browser-only fixtures covered complete statement review, return, joint edit, resubmission, validation and monitoring refresh without writing data. Running local API reads and self-validation denial passed. Four existing records remained, with zero assessment/rating fixtures added. College SQL and GitHub were untouched.

## Optional QA Not seen outcome

- Added a canonical `not_seen` outcome, shown neutrally before Below/At/Above on enabled QA form scales. It is distinct from missing responses and Not applicable, satisfies a required criterion without requiring an N/A reason, and never enters rated totals or percentages. Evidence notes remain optional. Dashboards, drill-downs, Excel and PDF show neutral counts separately; all-neutral sets display no rated data.
- Admin Centre → Form Editor → QA reviews → Scale settings now controls Not seen per active QA form template. Settings initially default off; nine active local templates are available. Enabling applies to that form's open and future review evidence. Disabling prevents new neutral selections while retaining already saved neutral answers, including when correcting other evidence fields. Duplicate templates inherit the setting. QA review management permission, row-version concurrency and audit recording protect changes.
- Migration 079 adds the template flag and extends the existing outcome constraint. It was applied only to local TLQS; no evidence or closure snapshots were rewritten. Historical snapshots without neutral counts continue to read as zero. Deploy the migration with the matching API/web build; college SQL and GitHub were not changed.
- Verification: 82 focused QA tests passed, including neutral enable/disable validation, preservation on correction, denominator integrity, reserved wording, exports and historical snapshots. API/TypeScript builds passed. Local settings/read/evidence/dashboard/PDF/Excel endpoints succeeded; same-value setting save refreshed the row version and a stale save returned 409. A rolled-back SQL setting change reached four frozen questions. Desktop/mobile component previews verified the neutral-first scale and per-form saving without creating evidence. All three existing records and four evidence responses were preserved; no forms were left enabled by verification.
