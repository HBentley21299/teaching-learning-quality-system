# Administration organisation review — 29 October 2026

## Outcome

The administration directory now has 58 i-Elevate settings and guidance destinations in 13 groups, plus links into QA Hub's separate administration workspace. QA administration has eight focused destinations in five groups, alongside its home page. The full main directory therefore shows 67 destinations to an administrator with all relevant permissions. Each account sees only its permitted destinations.

Both workspaces have collapsible task groups, search, a current-page indicator, direct URLs, breadcrumbs, and task instructions where a setting needs a sequence of steps. Search covers names, descriptions, everyday keywords, instructions and change-impact notes. It opens matching groups and leaves the current editor mounted, preserving unsaved work. Selecting a new task moves keyboard focus to its heading. Group expansion is remembered independently for the two workspaces within the browser session.

This replaces the combined Form editor navigation described in the earlier admin review. Templates, lists, themes and QA governance now have separate entry points. It reuses existing APIs and permissions; it introduces no schema change or new grant of access.

## Main directory inventory

All paths below begin with `/admin/` unless specified otherwise.

| Group | Focused destinations and path suffixes |
| --- | --- |
| People & access | Staff accounts & sign-in (`staff-access`); staff names, job titles & categories (`staff-details`); staff organisation access (`staff-scope`); staff role allocations (`roles`); permission tiers & capabilities (`permission-tiers`); archived staff & restoration (`archived-staff`) |
| Organisation & leadership | Organisation structure & teams (`organisation`); organisation leadership (`organisation-leadership`); team membership & staff allocation (`organisation-membership`); allocation reviews & migration checks (`organisation-reviews`) |
| Forms & templates | Form template guide (`forms`); Work Scrutiny templates (`work-scrutiny-templates`); Learning Walk templates (`learning-walk-templates`); CPD templates (`cpd-templates`) |
| Teaching & learning themes | Shared teaching themes & practice areas (`teaching-themes`) |
| ALS settings | ALS Learning Walk themes & focus areas (`als-learning-themes`); ALS LIV practitioner areas (`als-liv-practitioner`); ALS delivery areas (`als-delivery-areas`); ALS LIV course levels (`als-course-levels`); ALS LIV visit focus areas (`als-visit-focus`); ALS LIV development opportunities (`als-development`) |
| Reference data | Shared delivery areas (`delivery-areas`); rooms & buildings (`rooms`); searchable registered i-Elevate list catalogue (`all-lists`) |
| LIV & probation | LIV course levels (`liv-course-levels`); LIV visit focus areas (`liv-visit-focus`); LIV development opportunities (`liv-development`); LIV notice preferences (`liv-notice`); ELI / LIV focus preferences (`liv-preferences`) |
| Coaching & CPD | Coaching action limit (`coaching-session`); qualification statuses (`coaching-qualifications`); focus areas (`coaching-focus`); support types (`coaching-support`); CPD themes (`cpd-themes`) |
| Action themes | Separate pages for Learning Walk, ALS Learning Walk, LIV, ALS LIV, Probationary Observation, Work Scrutiny, Coaching & Mentoring, CPD, Learning Environment, UCO TLA Review and standalone actions. Suffixes: `learning-walk-action-themes`, `als-learning-walk-action-themes`, `liv-action-themes`, `als-liv-action-themes`, `probation-action-themes`, `work-scrutiny-action-themes`, `coaching-action-themes`, `cpd-action-themes`, `learning-environment-action-themes`, `uco-action-themes`, `standalone-action-themes` |
| Reporting | Reporting settings guide (`dashboards`); dashboard faculty datasets (`dashboard-faculties`); organisation-wide reporting inclusion (`organisation-reporting`); dashboard labels, order & views (`dashboard-presentation`) |
| Records & audit | Record search, audit & restoration (`records`); Work Scrutiny record corrections (`work-scrutiny`); ELI record corrections (`elevate`) |
| Communication | Message templates & automation rules (`message-templates`); email delivery & provider settings (`email-delivery`); message delivery history & failures (`message-history`) |
| Appearance & system | Elevate badge artwork (`badges`); module availability information (`modules`); ownership of hosting, academic years & controlled rules (`system`) |
| QA Hub administration | Links to QA admin home and each of the eight pages below. These open the QA workspace rather than mounting duplicate editors in i-Elevate. |

## QA administration inventory

Home is `/qa-hub/admin`. Focused paths begin with `/qa-hub/admin/`.

| Group | Destination | Path suffix | Existing permission |
| --- | --- | --- | --- |
| Evidence forms | Questions, guidance & tags | `questions` | `qa_reviews.manage` |
| Evidence forms | Outcome labels | `outcomes` | `qa_reviews.manage` |
| Evidence forms | Not seen availability | `not-seen` | `qa_reviews.manage` |
| Access & participation | Form access for QA Staff | `form-access` | `qa_reviews.manage` |
| Lists & reference data | QA action themes | `action-themes` | `lists.manage` |
| Lists & reference data | Shared delivery areas | `delivery-areas` | `lists.manage` |
| Reporting | QA reporting faculties | `dashboard-faculties` | `records.manage` |
| Review setup & workflow | How to set up or amend a review | `workflow` | Any QA administration permission, for guidance only |

QA Hub has an Administration tab. List-only and reporting-only administrators can open their own settings without receiving review or evidence access. Review setup still belongs to the individual review's Configuration page. Its owner, dates, allocations, publication and lifecycle are operational review tasks, rather than global defaults.

## Workflow decisions

| Task | Where the workflow now leads | Why |
| --- | --- | --- |
| Correct a colleague's details | Find the account → edit the relevant details → save or cancel | Identity corrections do not compete with role, scope and archival controls. Archiving has its own page and is linked from related People settings. |
| Change access | Role allocation, custom-tier definition, additional organisation access, leadership and team membership have distinct pages | These are different operations. Moving a person between teams is not the same as assigning a leadership role or additional access scope. Existing administrator restrictions remain in each editor. |
| Maintain the organisation | Select a unit → perform the specific structure, leadership, membership, allocation-review or reporting task | The relevant organisation tree remains available, while unrelated editing controls are hidden. Existing reason, impact and confirmation steps remain. |
| Change a form | Open its supported template → amend/preview a draft → save/publish | Template wording, lists, themes, workflow rules and corrections to submitted records are separated. The page explains the difference. |
| Change a dropdown | Find its named page → review Used in → add/edit/reorder/deactivate | All 26 active registered lists are accounted for: 25 have direct main-admin pages, with QA action themes in QA admin. Shared delivery areas can be reached from both workspaces. A single-list page opens its editor automatically. |
| Change LIV focus wording | Choose shared teaching themes, visit focus areas or ELI planning focus preferences | The audit found three distinct mechanisms. Each is named for its actual use instead of presenting them as interchangeable focus settings. ALS practitioner areas and ALS visit focus choices are also distinct. |
| Change reporting coverage | Select a specific dataset, or change organisation-wide inclusion | Organisation-wide parent exclusions can suppress data even when a dashboard's faculty is ticked. QA faculty selection is locked to QA; i-Elevate excludes that dataset from its selector. Saves send changed permitted datasets only. |
| Change reporting appearance | Open Dashboard labels, order & views | Presentation controls no longer share a page with dataset coverage. Reporting calculations and narrative permissions retain their existing behaviour. |
| Change QA responses | Choose outcome wording, Not seen availability or question-level options | Outcome labels and neutral-response availability now load and save independently. A failure in one does not block the other. The guide explains which settings affect existing displays or further editing, and which affect future review setup. |
| Change email behaviour | Choose templates/rules, provider configuration or delivery history | Each page loads its own API data. Message history has an explicit Refresh history control; inspecting it does not load transport credentials or create a delivery. |
| Leave an edited page | Save, discard, or stay | The existing shared unsaved-change guard is retained across section, workspace and browser navigation. Search does not unmount the editor. Navigation is blocked during active saves. |

## Compatibility and boundaries

- Existing main links for lists, themes, ALS themes, ALS LIV practitioner areas, coaching and messaging resolve to their focused replacements. `/admin/qa-reviews` and `/qa-hub/question-bank` open the canonical QA questions page. Unknown or unauthorised destinations show an unavailable message, without mounting a different editor.
- Work Scrutiny corrections still require both `records.manage` and `users.manage`, matching their API dependencies.
- The all-lists page excludes QA action themes. It searches names, usage and saved values while retaining unsaved list editors. Retired Learning Environment purposes are not reintroduced: migration 025 removed their active registration.
- Hosting, identity reconciliation, academic-year rules, fixed workflow transitions and scoring rules remain controlled application/IT work. Module availability is read-only release information. The UI identifies these boundaries instead of adding ineffective switches.
- No accounts, role allocations, message deliveries, configuration values or review records were changed to test this navigation. Browser role fixtures substitute only the displayed permission context, disable review access and block API writes; they do not test or bypass backend authorisation.

## Verification

- All 92 frontend regression tests pass, including catalog/search/deep-link coverage, permission combinations, focused editor API calls, independent QA saves, dataset isolation and partial-failure draft retention.
- TypeScript and production web build.
- Local browser checks of grouped navigation, task search, direct-list expansion, cross-workspace QA links, QA outcome and Not seen pages, and cancellation of unsaved navigation with the draft retained.
- Read-only browser fixtures for list-only and reporting-only QA administrators, with review access disabled and API writes blocked.
- Local readiness confirms the existing database is connected. No migration, database reset, seeding, GitHub write or deployment is required by this administration change.
