# Leadership Dashboard Data Review

## Purpose

The leadership dashboard provides permission-scoped operational, quality and assurance reporting. It deliberately distinguishes structured responses that can be compared from narrative responses that require professional interpretation.

The dashboard never broadens record access. Whole-organisation and scoped users receive the same dashboard design, but the API constructs every dataset from their permitted staff and organisation scope.

## Process reporting map

| Process | Leadership questions supported | Structured dimensions | Measures | Narrative handling |
| --- | --- | --- | --- | --- |
| Learning Walks | What is being observed, where and at what level? | Configured focus and practice outcome | Walks, coverage, outcomes, actions | Good practice and development narratives remain in record detail |
| LIV | Which areas are being visited and what outcomes are observed? | Configured LIV focus and five-point outcome | Records, visits, cycles, outcomes, actions | LIV notes, discussions and reflections are excluded from charts |
| Elevate Learning and Innovation | What practice areas are strongest and require development? | Practice area and descriptor | Submitted assessments and comparable area scores | Reflections and desired outcomes are excluded from charts |
| Probationary Observations | Is the observation programme progressing and what practice signals emerge? | Configured focus and five-point outcome | Cases, completed observation stage, outcomes, actions | Evidence and observation notes are excluded from charts |
| Elevate Environments | Which environments and pillars require attention? | Pillar and configured judgement | Audits, average outcome, barriers, actions | Free-text findings remain in the source audit |
| Coaching and Mentoring | Is coaching active and what themes are being supported? | Primary/secondary focus and current-practice outcome | Sessions, completion, focus frequency, outcomes, actions | Goals, conversations, challenges and mentor comments are excluded from charts |
| Work Scrutiny | What curriculum coverage and follow-up activity exists? | Sampled course | Scrutinies, samples, coverage, actions | Findings and feedback notes remain in record detail |
| CPD | Who is participating, for how long and in what themes? | Configured CPD theme | Events, participants, attendance credits and learning time | Event notes are excluded from charts |
| Actions | Is agreed improvement activity being delivered? | Configured action theme, source process and organisation area | Open, complete, overdue, due date and completion rate | Action detail and completion notes remain in action records |

## Variable and configurable data

- Lookup-backed selections use stable database identifiers. Renaming a configured option does not detach existing records from its reporting category.
- Learning Walk selections retain name and group snapshots as well as stable identifiers, preserving the wording used when the record was submitted.
- Environment outcomes retain judgement and descriptor snapshots.
- LIV, probation, coaching, CPD and ELI facts use stable identifiers and the governed current label. A rename updates the reporting label without changing the underlying category.
- Action themes are validated against process-specific configurable lists and stored as the selected wording. Historical actions retain that wording; a later rename can therefore appear as a separate historical label. Adding a lookup identifier and wording snapshot to actions is the recommended next data-model enhancement.
- Free text, long text and notes are searchable in their authorised source record but are not automatically classified or charted. This avoids misleading counts and accidental disclosure of sensitive professional narratives.
- New form-builder fields are not made reportable automatically. A future governed “reportable dimension” registry should be used if administrators need to promote approved single-select, multi-select or numeric fields into dashboards.

## Dashboard configuration guardrails

Administrators with record-management permission can:

- rename dashboard views;
- reorder views;
- show or hide process views;
- select a ranked profile or distribution as the primary visual;
- show or hide trend, organisation, outcome and action panels.

Administrators cannot:

- disable the executive overview;
- change permission scope;
- enter arbitrary SQL or calculations;
- expose restricted narrative fields;
- delete data or historical labels through dashboard configuration.

## Interpretation and quality controls

- Outcome averages use the governed hidden numeric value on a comparable five-point scale.
- Volume and score are displayed separately; a high average from a small sample is not presented as broad coverage.
- Organisation coverage is shown alongside outcome signals.
- Academic year, date, organisation, status and configured-dimension filters apply consistently to visuals, detail and CSV exports.
- Archived records and archived assessments are excluded.
- Process dates use the most relevant activity date: session date, latest LIV visit, latest probation observation or assessment submission where available.
- Narrative content remains available only in the source workflow, where its access and context can be preserved.

## Recommended next decisions

1. Decide whether action themes should be migrated from wording-only storage to a stable lookup identifier plus wording snapshot.
2. Decide whether dashboard audiences need target or benchmark values, such as expected Learning Walk coverage or action-completion service levels.
3. Decide whether low-volume aggregate suppression is required for ELI or coaching views when a scoped cohort contains fewer than a defined number of staff.
4. Define which future form-builder field types may be explicitly promoted as reportable dimensions.
