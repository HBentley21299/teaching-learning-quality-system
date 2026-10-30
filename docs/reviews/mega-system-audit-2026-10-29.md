# i-Elevate system audit and implementation — 29 October 2026

## Outcome

This pass reviewed the system's forms, workflow consumers, administration, people surfaces, navigation, dashboards, reporting and transfers against their actual React, API and SQL paths. It implemented the gaps described below while preserving the existing work in this checkout. The review covers all 19 primary route families, all 14 registered leadership dashboard destinations plus QA reporting, and the administration directory of 74 settings in 15 groups. Counts describe registered destinations, not a claim that every live account or record was exercised.

The largest new capability is a usable administration workflow for versioned forms and additional questions. A second editor manages 47 existing prompts across the typed review workflows. Published form history, answer identities, role checks and workflow progression are protected. Following Harry's sidebar correction, the collapsed sidebar uses the i-Elevate logo, the toggle uses a simple icon and the top Home link returns to the homepage.

## Changes implemented in this audit

| Finding | Result |
| --- | --- |
| Learning Walk, CPD and Environment definitions had no complete, clear draft/edit/publish administration journey. | A shared form console supports template search and grouped selection, version history, draft copies, section/question editing, preview, save, explicit publication confirmation and unused-draft discard. Dedicated module destinations link to the same editor. |
| Future additional questions needed a complete storage-to-report path. | Nine question types are supported: short/long text, number, date, Yes/No/Partial, single/multiple choice, checklist and rubric scale. Additional answers are validated, retained in saved versions and included in native Form data and Excel. Required questions, choice limits and malformed answers are enforced by the API. |
| Editing a published form or publishing while someone completed a form could misalign questions and answers. | Published/used versions are immutable. Draft copies receive new field IDs, saved entries retain their version, and submissions specify the version actually displayed to the user. Core workflow fields keep their type, requirement, choices and section. |
| Administrators could overwrite one another or lose local work after a failed save/readback. | Parent/version locking and observed row-version tokens guard writes. Failed saves retain edits; a successful save with failed readback blocks further writes until reload. Unsaved-work guards cover navigation. The legacy Work Scrutiny editor shares the concurrency boundary, server core-field protection and controlled configuration preservation. |
| Work Scrutiny setup and version administration could diverge. | The separate setup page retains new-template creation, allocation, copy and retirement. Publication now leads through the version editor's review/confirmation journey. New/copied unused drafts receive course-level and delivery-area questions. Older unused drafts can prepare them with one save; publication waits for readiness. Published versions are never repaired in place. |
| Fixed review prompts required code changes even for wording/help. | A guarded administrator editor manages 47 current labels/guidance entries: LIV/ALS LIV 6, probation 6, coaching 9, UCO 19, ELI 2 and actions 5. Runtime forms use the same canonical catalogue with recoverable defaults. Restore changes a local draft and requires Save. |
| Custom multiple-choice controls and validators used incompatible payloads. | Generic and Work Scrutiny custom choices use JSON arrays, including choices containing a literal pipe. Both Work Scrutiny validation layers accept the same values. Legacy non-custom delimiter contracts remain compatible; older custom values normalise when saved. |
| Some schema-required checks referred to questions deliberately hidden by the workflow. | Required-answer checks mirror visible questions and authoritative conditional rules. Empty custom selections are rejected when required; hidden CPD helpers and unselected Learning Walk Other fields do not block submissions. |
| Historical Environment answers and administrator section changes could disappear. | Saved inactive/retired answers retain their stored sections and labels. Current entry/editing honors saved section titles and order while retaining pillar imagery and active-core rules. Additional questions remain available in inactive pillars. |
| Report controls did not always match API capability rules. | Standard Dashboard PDF/Excel requires the export grant; dedicated UCO policy remains explicit. Self-only LIV viewers no longer receive a Word action the endpoint will reject. |
| QA summaries could briefly display a previously selected faculty/team. | Summary state and asynchronous responses are tied to request scope. A changed cohort immediately removes stale totals until its own response arrives. |
| Saved form/report names could follow the latest parent template instead of their version. | Record/detail/export queries use saved version metadata, with legacy fallback. Intentionally clearing a description stays cleared through reload, publish and copying. |
| QA question/access administration allowed overlapping operations and ambiguous eligibility. | Question mutations and access saves are serialized; failed drafts survive. Copy question prepares an editable new draft. Staff selection distinguishes eligible active QA Staff from retained historical members, with Select matching/Remove matching helpers. |
| QA wording advertised a mandatory-comment rule deliberately unsupported by existing policy. | Cards/imports now describe optional evidence notes accurately. Legacy metadata remains compatible and is explicitly warned about. Existing N/A reason rules remain enforced. |
| ELI administration offered All years while requesting only current-year data. | The API accepts validated current/explicit/all-year scope. Administration requests retained years and accurately identifies staff/year, including former staff with historical records. |
| The form picker repeated a long list of template buttons. | A compact module-grouped selector, search and match count reduce scrolling. The collapsed sidebar now displays the existing light/dark i-Elevate logo; a simple panel icon retains accessible Expand/Collapse state. The top Home link uses the normal guarded navigation on desktop and mobile. |

## Where an administrator makes changes

| Need | Destination and scope |
| --- | --- |
| Add questions or change versioned sections | Admin Centre → Forms & templates → All form versions & additional questions, or the Learning Walk, CPD, Work Scrutiny or Environment template page. Create a draft, edit, preview, save, then publish. |
| Create, allocate or retire a Work Scrutiny template | Forms & templates → Work Scrutiny template creation & allocation. Publish the saved draft through the version editor. |
| Rename a typed review question or change its help | Forms & templates → Review & action wording and guidance. Select the workflow, search prompts, preview and Save wording. |
| Change shared themes, dropdowns, delivery areas or rubrics | The named settings group for that process or Teaching & learning themes / Reference data. Shared usage is identified; stable identities and historical values matter. |
| Change QA questions, outcome wording, form access or action themes | QA Hub administration. Review-specific teams, selected questions and publication remain in that review's Configuration. |
| Bulk-add QA questions, delivered CPD/attendance or managed choices | Imports & bulk changes, with administrator identity and the relevant area capability, preview and explicit Apply. These import paths were re-audited; no import was applied. |
| Change people, permission combinations or organisation scope | People & access / Organisation & leadership. Display wording does not change a staff member's authority. |
| Change dashboard presentation or included faculties | Reporting. Metric definitions and access scope retain their application rules. |

The directory remains searchable and grouped under collapsible headings. The detailed administration inventory records every registered settings destination and its actual capability/ownership boundary.

## Form and role coverage

The workflow inventory traces create, draft, saved edit/detail, completion, linked actions and reporting for standard/ALS Learning Walks; managed, mandatory and external CPD; Learning Environment; Work Scrutiny; standard/ALS LIV; all three probation observations; UCO; coaching; ELI; and standalone/linked actions. It distinguishes dynamic questions from identities, signature controls and lifecycle transitions.

Role review uses capabilities rather than assuming mutable role names: self-only staff, submitter, subject, assigned reviewer, T&L owner, scoped/global leader, reporting-only reader, exporter, UCO observer/lecturer/coordinator, QA Staff/manager and each administrator grant. UI affordances were compared with endpoint/data access. Deterministic tests exercise representative allowed/denied combinations. This is not a live impersonation of every configured account.

The reporting review follows saved answer identities through generic responses, named business projections, repeat detail sheets, native registers and generated XLSX. It covers all dashboard process registrations, people/level/coverage registers, filters, cache/request scope, source links and role-specific PDF/Excel/Word affordances. Internal visibility flags and concurrency tokens do not become business export columns.

## Customisation boundaries

| Area | Configurable now | Deliberate boundary |
| --- | --- | --- |
| Versioned generic forms | Names/descriptions, section/question wording/help/order; additional sections/questions, types, choices and required rules for additional questions. | Core answer identities, lookup bindings, required rules and managed choices support workflows/reporting and remain protected. Published versions are immutable. |
| Typed LIV/probation/coaching/UCO/ELI/action workflows | 47 existing display prompts/help, plus dedicated managed choices/configuration already exposed for the process. | Arbitrary additional persisted fields, new stages, changed progression, signatures, owner logic or scoring require coordinated workflow/storage/reporting work. They are not exposed as an unsafe generic table editor. |
| QA | Question bank, guidance/tags, required outcomes, N/A, drafts/copies, published review snapshots, outcome wording, neutral availability, form access and action themes. | Canonical outcome meanings, review lifecycle and rated denominators remain controlled. Narrative optionality follows the existing explicit policy. |
| Historical wording | Generic saved definitions/answers retain their version; QA published questions retain snapshots. | Typed prompt wording is current display configuration, not a per-record wording snapshot. Renaming those prompts changes the display of existing typed answers. |
| Custom answer reporting | Additional generic fields appear in native Form data and Excel, preserving historical blanks and saved identity. | Adding a question does not invent a new aggregate metric, award threshold, denominator or chart. Those calculations need explicit definitions. |
| Learning Walk variants | Separate process permissions/themes/delivery areas with shared version administration. | Standard and ALS Learning Walk currently share the same question template. Independent structures require a deliberate template split. |
| Work Scrutiny context layout | Course/delivery question wording/help and additional question sections follow their saved definitions. | Core workflow controls retain their fixed Context/Sample placement. A core-only section rename/reorder does not relocate those controls; additional-question layout remains configurable. |
| CPD CSV | Existing supported import columns and optional additional blank answers. | Additional required questions the fixed CSV cannot answer block preview. The editor explains this before publication. |
| Organisation, lists and access | Named catalogues, custom permission combinations and supported allocations. | Staff identity matching, course/academic-year identities, award calculations, hosting, authentication and secrets retain controlled contracts. |

These boundaries are explicit future design decisions rather than hidden unfinished Save buttons. The system is more manageable through administration; it is not claimed to support arbitrary workflow changes without development.

## Verification and local state

- Final frontend suite: **342 passed, 0 failed, 0 skipped**. Production `npm run build` passed, including TypeScript. Vite retains its bundle-size advisory for the main chunk (about 542 kB before gzip); this is a performance follow-up, not a build failure.
- Final complete backend suite: **616 passed, 0 failed, 0 skipped** in `FilterReview`, with apphost generation disabled and explicit LocalDB-master opt-in for isolated database tests. The final targeted compatibility run also passed **87/87**, including 14 form-administration SQL cases, both publication routes, legacy/new editor concurrency, retired-field restoration, 21 shared rule cases, Work Scrutiny domain/API-boundary tests and actual workbook projections. These tests do not write to the application's business database.
- Native no-write review verified both new editors, real version history/read-only behavior, template search, workflow selection, local preview, unsaved-edit discard and branded collapse behavior. Widths 320, 640, 1024 and 1280 were reviewed, including enlarged text/stronger contrast on narrow screens. No horizontal page overflow was observed in the checked editor states; browser error logs were empty. No native create/save/publish claim is made: write paths are exercised in isolated tests.
- Migration `093_form_version_administration.sql` was applied transactionally to the local prepared database. It adds version name/description metadata and an initially empty workflow-content table. It does not backfill records or publish/configure forms. The normal migration script includes it for later environments.
- No application records, staff permissions or form configuration were saved for audit QA. No fixtures were seeded, database reset performed, GitHub writes made or deployment initiated. Temporary browser preferences/viewport and the audit tab were restored/closed.

The local API was restarted with `scripts/start-local.ps1 -SkipDatabase`. At 22:47 UTC, `/health/ready` returned HTTP 200, healthy/database connected; the normal web app returned HTTP 200, and the temporary audit preview was no longer listening. Whitespace checks passed; Git only reported the checkout's existing line-ending normalization notices.

## Supporting inventories and evidence

- [Workflow/forms: exact field groups, consumption paths and limitations](mega-audit-workflows-2026-10-29.md)
- [Administration: complete destination, QA and ownership inventory](mega-audit-administration-2026-10-29.md)
- [Navigation/reporting: source, role, export and transfer matrix](mega-audit-navigation-reporting-2026-10-29.md)
- Local logs: `.localappdata/local-run/mega-audit-frontend-final.log`, `mega-audit-web-build-final.log`, `mega-audit-backend-final.log`, `mega-audit-final-form-tests.log`, `mega-audit-restart-final.log` and `mega-audit-health-final.json`.
- Native evidence: `.localappdata/local-run/product-review/mega-audit-form-versions-final.png` and `mega-audit-wording-mobile.png`.

Sidebar/Home follow-up: 21 affected shell, text-scaling and responsive tests passed, and the production build passed. Native review verified collapsed branding, the icon toggle, navigation from Admin Centre through the top Home link, and a 44px Home link without overflow at 320px, including the dashboard year selector. Temporary preview settings/tab/process were restored or removed. Evidence: `sidebar-home-tests.log`, `sidebar-home-build.log` and `product-review/sidebar-home-updated.png` in the local-run directory. The earlier whole-suite counts above refer to the mega-audit integration run; this frontend-only follow-up did not change the API.
