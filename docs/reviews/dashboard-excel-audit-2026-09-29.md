# Dashboard Excel audit

Excel now opens on **Form entries**. Each record is a horizontal row, with section/question headings, rather than opening on export metadata or an aggregate summary. Repeated child items have numbered columns, preserving blank values and each item's fields together. Linked source sheets and field definitions remain available. Technical question identities are retained internally and in definitions; displayed Excel headings are readable and made unique when wording repeats.

| Dashboard/process | Primary row | Detail coverage |
| --- | --- | --- |
| Elevate Learning and Innovation | Assessment | Framework/version, submission, validation/reviewer/feedback, each area outcome/score, each actual saved statement outcome/score, reflection prompt/answer, each development-plan field, LIV preferences and desired outcome |
| Learning walk / ALS learning walk | Submitted record | Versioned section/question answers, selected themes with stable keyed response columns, delivery area, linked actions |
| Work scrutiny | Submitted record | Versioned question answers, course/level, sampling/context, rubric responses and evidence, linked actions |
| Elevate environments | Record | Versioned answers, pillar ratings, linked actions |
| Coaching and mentoring | Session | Session fields, dynamic saved answers, numbered actions and action reviews |
| CPD | Event/log entry | Event details, mandatory/external/internal classification, full saved form answers, numbered attendance fields; mandatory remains non-qualifying |
| LIV / ALS LIV | Case | Case details, numbered visits/stages/actions; configured action themes remain the reporting metric |
| Probation | Case | Numbered observations/stages/visits/rubric evidence/actions |
| UCO TLA | Review | Review context, versioned field answers, numbered development actions and follow-up details; observer drafts excluded from Excel |
| QA review | Submitted evidence item | Activity, faculty/team, delivery area, course/level, sampling, context, evidence links, strengths/improvements/recommendations and a separate outcome/comment/neutral-reason column for every criterion |
| Elevate status | Staff member | Staff information and numbered annual award details; source awards retained |
| Overview | Record | Generic answers merged with specialised process details |
| Actions | Action | Action details and linked extension source sheet |

## Preservation and verification

- No form fields, stored responses or database values are changed by this export work.
- Missing answers stay blank. N/A and Not seen remain distinct; historical area scores are never substituted for missing statement answers.
- Field identity, rather than answer selection order or current wording, determines dynamic columns.
- SQL permission scopes and dashboard selection apply before rows are constructed. New process-specific faculty filtering depends on migration 088.
- PDFs now contain the dashboard metrics and fully expanded dashboard sections. Raw form-entry rows remain in Excel rather than being repeated in a large PDF appendix. The PDF endpoint skips constructing the raw workbook, including the overview merge, while retaining its validation and authorisation scope. UCO PDFs include workflow, attention, practice highlights and the review register.
- Automated cases cover stable dynamic keys, renamed questions, multiple selections, blank/neutral answers, row boundaries, numbered repeated items, data types, readable unique headers, workbook tab order and QA criteria export. Runtime Excel verification now covers all 14 dashboard exports after migrations 087/088 and restart; details below.

## Database-backed verification, 29 September

With migrations 087/088 applied and the local application restarted, all 14 dashboard Excel endpoints successfully returned readable workbooks using the marked 2026/27 test submissions. Each opened on **Form entries**, used unique readable column headings, and retained one horizontal primary entry per row. The observed primary row counts were: overview 107, Elevate status 13, actions 108, CPD 16 (including the mandatory test log), coaching 12, LIV 12, ALS LIV 3, ELI 13, Learning Walk 12, ALS Learning Walk 3, Work Scrutiny 12, environments 12, probation 12 and UCO 3. These are observed export counts, not proof of every record's eligibility independently of the query.

Inspection found that identical faculty copies of Work Scrutiny produced separate question columns solely because their template keys differed. A bounded export fix now aligns known `work_scrutiny_quality_<GUID>` copies by section/field identity plus their saved section, wording, type, configuration and lookup source. Customised definitions remain separate and original form-template metadata remains available. Eleven focused builder/PDF tests passed, including equivalent-clone answer alignment and separation of changed definitions. Post-restart verification retained all 12 Work Scrutiny rows while reducing duplicate columns from 403 to 63. The refreshed overview retained 107 rows with 752 columns.

Early export attempts suffered SQL timeouts during independently confirmed local memory pressure; CPD subsequently succeeded on an isolated retry. This does not establish acceptable production performance. All 14 final dashboard PDF endpoints succeeded; text inspection confirmed that the raw-entry appendix is absent. The overview completed in 3.03 seconds after the PDF path stopped building the raw workbook, versus an earlier 180-second timeout. Work Scrutiny reduced from 82 to 30 pages and ELI from 209 to 36 pages while retaining dashboard statement drilldowns. Final Work Scrutiny, ELI and UCO pages were visually inspected without clipping or overlap. Both QA review PDFs succeeded (30 pages each); the first was visually inspected. QA cycle 1 Excel succeeded on retry with 8 horizontal entries, 337 unique columns and all 105 criterion outcomes/comments/neutral-reason fields. Live SQL diagnostics traced QA Excel delays to the detail response query waiting for a 7,424 KB memory grant. Resolving its single activity before selecting ordered question responses reduced the measured grant to 1,024 KB with zero wait and preserved the existing authorisation check. After the correction, both QA workbooks succeeded in 26.63 and 35.69 seconds. Each contains 8 entries, 337 unique columns and 105 criterion outcomes, with separate comment and neutral-reason columns. A complete comparison of every cycle 1 first-sheet header and data cell before/after the query correction was identical. The normal-output focused QA/export/policy suite passed all 112 tests. Engineering evidence is saved under `.localappdata/export-review/runtime`.

## Operational limits

- LIV and probation are case workflows: the entry row is a case, with numbered visits/observations, rather than duplicate case rows for every stage.
- Additional source sheets are intentional for one-to-many relationships and auditability; the first sheet is the form-style entry view.
- Existing explicit row, column and cell-size limits fail with a message rather than silently losing data. Very large repeated collections can require narrower filters.
- QA retains per-submission authorisation. Its ordered response query now resolves the single activity first, avoiding the measured excessive memory grant. Large review volumes still need production profiling; the local runtime test is not a load test.
- CPD event rows now follow attendee-aware dashboard scope: an event with eligible attended staff can contribute even if its owner faculty is excluded, provided existing access checks allow the record. Each event counts once; attendance, credit and learning-minute totals sum only **Attended** staff in the selected faculty/team. Registered, cancelled and absent staff do not inflate these KPIs. A multi-faculty event's full total is never reused for one selected faculty. Excel attendee detail columns use the same selected faculty/team and dashboard exclusion rules; their explicit attendance statuses retain the submitted attendance record for audit. Node tests cover cross-faculty totals, team selection, exclusions, unrelated faculty rejection and empty attendance.
