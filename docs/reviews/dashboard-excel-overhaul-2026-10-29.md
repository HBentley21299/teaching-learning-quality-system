# Dashboard and Excel overhaul — 29 October 2026

The export is now a business report of the selected forms. **Form entries** opens first, with one row per source entry and the associated staff member or lecturer, recorded submitter, organisation and saved form/version context where available. Saved question answers remain horizontal columns. Repeating children use linked detail tabs instead of creating hundreds of numbered columns on the first tab.

The overview workbook has a concise activity register followed by each contributing process's complete form sheet and genuine detail tabs. This avoids mixing unrelated forms into a single sparse worksheet. QA uses one evidence item per row, with a separate outcome, comment and neutral-reason column for every saved criterion. Its linked actions remain a separate table.

| Report | First-sheet row | Business detail retained |
| --- | --- | --- |
| Overview | Activity record | Individual process form sheets and linked repeat details |
| Elevate status | Staff member | Current consecutive confirmed level and name, qualifying internal CPD attendance, next level, sessions needed, last confirmation; individual awards and implementation impact on a detail tab |
| Actions | Action | Associated staff, owner, theme, source, description, original/revised/current due dates, intended evidence/impact, review date, progress/status, completion and cancellation comments; extensions on a detail tab |
| CPD | Event or log entry | Event details, internal/external/mandatory classification and every saved dynamic form answer; scoped attendance on a detail tab |
| Coaching and mentoring | Session | Staff and coach, cycle/session, qualification, primary/secondary/other focus, current practice/evidence, support/other support, conversation, closure and completion; actions and action reviews on detail tabs |
| LIV and ALS LIV | Case | Staff/reviewer, organisation, stage, focus, desired outcome, preferred month/secondary focus, delivery area and permitted practitioner/practice information; cycles, visits, findings, stages, development opportunities, visit rubric responses and actions on detail tabs |
| ELI | Assessment | Framework name/version, submission and validation, reviewer/feedback, selected strengths and development areas, saved area/statement outcomes/scores, reflection prompts/answers, development plans/support and LIV preferences; staff submission cohort on a separate named roster |
| Learning walks and ALS learning walks | Form submission | Staff/reviewer/submitter, delivery area, saved form/version and all questions and selected themes; actions on a detail tab |
| Work scrutiny | Form submission | Staff/reviewer/submitter, saved questions, course/level, sampling/context and rubric/evidence answers; actions on a detail tab |
| Learning environments | Audit record | Staff/reviewer/submitter and every saved question; pillar judgement/descriptor/score and actions on detail tabs |
| Probation | Case | Staff, organisation, reviewers, observation position and completion; observations, stages, visits, observed rubric/evidence, explicit areas not observed and actions on detail tabs. Linked LIV detail is included only through the existing LIV record, section and action access rules; linked UCO forms/actions require the existing UCO coordinator export role. |
| UCO TLA | Review | Lecturer/observer, course/module/session details, attendance numbers, workflow/signatory names/discussion/follow-up completion/reopen context and all saved form questions; development actions on a detail tab. Observer drafts remain excluded. |
| QA Hub | Evidence submission | Review title/theme/year/owner; activity, faculty/teams, course/level, delivery area, associated staff, reviewer, sample/date, context/evidence links, strengths/improvements/recommendations and every criterion outcome/comment/neutral reason; linked review actions separately |

## Native dashboard workflow

The main dashboard now has one grouped, searchable chooser for all permitted reporting destinations, including UCO. The current dashboard and reporting section have a restorable URL. The workspace switch is compact on dashboard pages. QA review dashboards remain within the selected QA review, with a clearly labelled route from the chooser to the QA review directory.

Each main process has a summary and a full data register. Appropriate processes also have a linked actions section; ELI has a named staff submission coverage section. Existing process-specific analysis remains available instead of forcing unrelated forms into one scoring model. UCO retains its qualitative review workflow and annual staff coverage; QA retains review-specific evidence analysis.

The data register initially shows the associated person, actual submitting actor, source, date, status and organisation. Owner, reviewer, observer and submitter remain distinct roles. An unknown submitter stays unrecorded. Users can search saved answers and linked business details, sort, select form columns, change page size, open source records and expand a row into readable sections with its repeating detail tables. Column choices persist for the browser session. Bulk form data loads once for the current scope; expanding rows does not make one request per record.

Elevate Status opens as a named staff register, including eligible colleagues with no award. The exact highest confirmed level filter also controls the summary and export. Attendance and next-level progress remain separate from the required award confirmation. ELI submission coverage and UCO annual staff coverage explicitly use the academic-year staff cohort; activity filters do not silently change those denominators.

Dashboard filters control report scope. Table searches, sorting, pagination and chosen display columns refine the native register; Excel deliberately exports every business column and scoped entry across all pages. This distinction is explained beside the tables and in the export menu. Loading failures remain explicit, and prior-year or prior-filter responses cannot replace the current view.

## Data and scope decisions

- The Excel writer and native dashboard register share `BusinessWorkbookExportBuilder`. The projection operates after access and dashboard filters; it does not grant access, alter stored forms or change answers.
- Source identity remains internal for correct joins. Ordinary reports omit database UUID columns, row versions, capability flags, LIV visibility state, raw JSON dumps, duplicate base sheets, question-definition plumbing and copied dashboard implementation data.
- Local `Entry 0001` references link the first sheet to detail rows within the workbook. Associated staff and source title are repeated on child tables where available. Equal staff names cannot merge different entries. Unrelated child rows are excluded.
- Saved form-template and framework names are shown with their saved versions. Question identities still determine answer alignment internally, so renamed/retired questions and identical faculty template clones retain the correct answers without exposing implementation identifiers as headings.
- Missing answers remain blank. N/A and Not seen remain distinct. Multiple selections and long multiline content remain complete; structured values display meaningful labels and evidence rather than JSON controls.
- A form dashboard's status and theme/focus filters select source entries and retain their linked actions. The actions dashboard filters the actions' own states and themes. Exact Elevate status level filtering applies to the named roster, workbook and PDF scope.
- UCO source queries retain coordinator access and draft exclusions and now honour organisation and selected-record filters. Timestamps retain their offset until the workbook writer converts them to UTC.
- CPD attendance continues to use the selected faculty/team and existing dashboard exclusions. Mandatory and external events do not become qualifying internal CPD because of this presentation change.

The audit also corrected data-source defects: staff with zero CPD attendance are retained; learning-walk dimensions use the latest active submitted form rather than historical form versions; and Elevate Status aggregates and named staff now share the same consecutive confirmed-award rules as the individual profile. Cancelled actions and legacy completed actions use the same state classification in native totals and exports. Completion timing is not inferred when a completed action has no recorded completion date.

## Workbook usability and verification

All data sheets have filters, wrapped cells and a frozen header. Wide form tables also freeze the entry reference and named context; the information tab does not freeze columns. Narrative/question columns are wider and header height follows readable question wording. Formula-looking user answers remain literal text. Numeric/date cells retain usable Excel types and long identifiers are not silently rounded. Existing row, column and cell-length limits reject incomplete exports rather than truncating answers.

The backend suite covers the shared projection across every main process, personnel and parent linkage, overview bridges, linked probation/LIV content, template names, saved question alignment, neutral/missing responses, structured control exclusion, filter regression cases, typed cells, formula safety and workbook presentation. Database-backed smoke verification is recorded separately by the reporting runtime scripts; the local database is intentionally sparse, so populated synthetic tests provide the repeated-item and long-answer coverage.

Final verification on the completed source:

- Backend: 457 tests passed; one existing opt-in database test skipped.
- Frontend: 128 tests passed, including register loading, role labels, parent details, column selection, search, refresh, exact status levels, action-state parity and UCO year-switch races. TypeScript and the production build passed. Vite retains its large shared-chunk advisory.
- Actual local API on port 5001: all 13 main form-data datasets passed identity, business-field, unique-record and parent-link checks. Named status totals matched the aggregate and individual staff profile; CPD retained the eligible staff member with no attendance.
- All 14 ordinary dashboard Excel endpoints produced valid OpenXML workbooks, opening on Form entries, with unique readable headings, filtering and frozen headers. The real ELI record produced 122 business columns. QA's populated review projection and repeating workflow data are covered by synthetic tests; no active QA review was created for a live smoke test.
- Browser checks: grouped dashboard search, switching and current selection; named Elevate Status staff and level filter; native ELI staff/submitter names and complete expanded answers; export controls; and preservation of the selected dashboard URL after clicking the main Dashboard link.
- Whitespace checks passed. The local API was restarted with `scripts/start-local.ps1 -SkipDatabase`; normal web development remains on port 5173.

The existing local database contains one eligible staff member and one submitted ELI assessment. No fixtures were loaded and no form, staff, award or settings data was changed by reporting validation. Excel endpoint checks create their normal export audit entries. These sparse-data smoke checks establish runtime integration, not production-volume performance. Existing result and Excel limits remain explicit; a large native result displays a narrowing notice rather than claiming to show every answer.

Runtime logs, downloaded verification workbooks and browser screenshots are in the ignored repository folder `.localappdata/local-run/dashboard-smoke/`. No remote repository updates or deployment were performed.
