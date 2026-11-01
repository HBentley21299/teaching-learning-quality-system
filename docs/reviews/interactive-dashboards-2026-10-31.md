# Interactive dashboards

Implemented locally on 31 October 2026. This extends the UCO visual approach to all 16 dashboard hub views and QA Hub's review dashboard. It adds no packages, API endpoints, migrations, startup seeds or external services.

## Coverage

| Dashboard | Process-specific exploration |
| --- | --- |
| College overview | Process activity, submitted/completed records, area comparison, named record register and linked actions |
| Learning Walks | Delivery area, selected focus coverage, recorded rating distribution and matching walks |
| ALS Learning Walks | ALS delivery/focus coverage, outcomes and matching walks |
| Digital Learning Walks | Category reach, selected-criteria completion, named walk's saved rating scale and criterion breakdown |
| LIV | Annual cumulative case stages and organisation lifecycle rows, completed-visit coverage, visit records |
| ALS LIV | ALS case stages and organisation lifecycle rows, completed-visit coverage, visit records |
| ELI | Named eligible staff, submitted/outstanding cohorts, submission coverage and assessment responses |
| Probationary Observations | Unique staff by highest recorded observation count, case records and observation response distribution |
| Elevate Environments | Reviews with/without barriers, assessed pillars and recorded outcomes; repeat room reviews remain separate |
| Coaching and Mentoring | Distinct staff reached, session/focus coverage, annual participation and linked actions |
| Work Scrutiny | Work sample totals, course/level coverage and qualitative record context |
| CPD | Event attendances, attendance-weighted learning hours, named staff attendance bands including zero, annual participation |
| Elevate Status | Exact highest achieved level, named staff, next-level milestones; existing cumulative badges retained |
| Activate+ Growth Reviews | Initial/follow-up journey, entered Skills Scan coverage, named area/owner/participants, individual saved pillar/sub-area results |
| Actions | Existing origin/state drilldowns, progress ring, overdue attention list and named action register retained |
| UCO TLA Reviews | Annual staff coverage, global workflow stage bars, local completed/in-progress/follow-up/overdue metric lenses and named review register |
| QA Hub | Outcome/process/theme/criterion exploration, dynamic rated-response ring, attention/strength cards, team reporting scope and evidence-date activity |

DLW and Activate+ linked-action tabs also have progress, impact and overdue drilldowns. Shared central actions count once even when linked to several follow-ups or assigned to multiple people.

## Interaction and scope

- Shared accessible metric cards, progress rings and selectable breakdowns use native controls, visible keyboard focus and reduced-motion support.
- Generic summaries connect chart selections to a searchable, sortable, paginated named register. Existing specialist analyses remain under **Detailed analysis**; form data, coverage and action sections remain available.
- Generic local exploration does not issue more data requests or silently narrow exports. Top-level reporting filters still control report/export scope.
- UCO workflow selection controls report/form-data/export scope; KPI and people/session selections refine the named register. Annual coverage retains its eligible staff denominator.
- DLW/Activate+ register and visual filters retain the existing full academic-year Excel export scope, stated beside the controls.
- QA team selection invokes the existing server faculty/team filter. Criterion/outcome selection explores aggregate responses and does not infer individual form ratings. Form data navigation retains its export permission gate.
- New scopes reset local selections. Existing loading, failed refresh, permission, cache, late response and synchronous scope guards remain in place.

## Data definitions

- A missing denominator displays an unavailable percentage rather than a manufactured zero. A genuine known zero remains zero.
- Counts state their unit: records, staff, actions, responses, attendances, learning hours or organisation lifecycle cases. Outcome bars retain repeated observation response rows; only their record drilldown IDs are distinct.
- LIV journey stages are cumulative, not additive. Stage clicks show organisation rows; the source cannot safely map those stage totals to individual visit forms.
- ELI eligibility and CPD/coaching participation remain annual organisation measures, independent of date/status filtering of form records.
- Elevate exact-level cohorts are separate from cumulative achievement thresholds.
- QA Not seen and Not applicable are excluded from rated percentages. Multi-team evidence counts overlap and are not summed into distinct evidence totals.
- DLW completion uses each walk's included statements. Its individual rating distribution uses that saved walk's framework. No cross-scale practice average is created.
- Activate+ shows each selected review's pinned pillar/sub-area labels. Pillar means require complete valid inputs and a submitted review; drafts and missing results do not become official means. No average across reviews or teams is created.
- Qualitative narratives remain unscored. Existing access controls determine which records and narratives are available.

## Verification

The full frontend suite passes: **513 tests, zero failures or skips**. The production web build passes, including TypeScript. The existing main-bundle size warning remains. Model, interaction and existing state tests cover all process families, repeated probation responses, unique shared actions, exact staff levels, neutral-only/empty rates, saved frameworks, draft means, scope changes and export boundaries.

Actual React component browser previews used dummy API data only. Desktop/mobile checks cover all generic dashboard variants, QA Hub, native DLW/Activate+ review routes and UCO; they exercise chart selection, named navigation, keyboard controls, pagination, reduced motion, empty states and 390px document overflow. Preview assets and logs are kept under ignored `.localappdata`.

Read-only live checks confirm the local API/database and web app are healthy, DLW has six categories/24 statements/the shared five-point scale, and native Excel exports retain their form/response/Skills Scan/action sheets. The local database remains at two staff, five core records and zero actions. No test records were loaded.

No commit, push, merge or deployment was performed.
