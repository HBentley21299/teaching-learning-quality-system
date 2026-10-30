# QA and administration experience review — 29 October 2026

This pass covers the QA/admin route inventory and its shared editing components. It is part of the wider product review; it does not certify every role, live save, browser or device. Existing permission gates, CSV confirmation, published question snapshots and historical selections remain in place.

## Main changes

- Focused settings use the setting name as the page heading and document title, with the administration area as context. Breadcrumbs, impact notes and related settings remain available; procedural guidance starts collapsed. The overview contains a single search/count area and one grouped task directory. On narrow screens, the focused task comes before the optional browse directory; desktop keeps its sidebar. QA workflow guidance lives on its dedicated page.
- Question-bank, record, Work Scrutiny and Elevate Practice lists retain search and sort in their primary controls, with less-used facets behind an accessible filter disclosure. Filtering does not save a different configured question or choice order.
- Tables in the assigned routes have column-header scopes and reuse the shared keyboard-scroll region. The region enters the tab order only when the table actually overflows. Custom record tables have proper table, header and cell roles.
- Fetches for records, histories, previews, badges and form summaries ignore responses belonging to an earlier selection. Recoverable fetch errors have a working retry; they do not masquerade as empty data or endless loading.
- Archive and organisation-edit errors stay inside the active dialog. During a save, controls are disabled to prevent edits being silently lost. Staff selection respects the existing unsaved-change decision instead of disabling all browsing.
- QA outcome choices are a labelled radio group with arrow-key selection and one tab stop. Revisions are available on demand. QA action drafts are guarded when leaving, hiding the form or switching reviews; failed creation retains the draft and permits retry.
- QA and general dashboard report menus now share keyboard entry, menu navigation, Escape cancellation and focus return. Exports keep their existing filters and underlying APIs.
- Messaging keeps transport, template and history tasks separate. History and preview responses stay with the selected template. Optional CC/BCC and HTML controls are disclosed as needed. A test message requires saved wording. No message was queued during verification.
- Form preview groups no longer contain nested labels. Published/version protections are retained. Template search and sort are disclosed as needed, and an existing historical team allocation remains visible even if it cannot be selected for a new allocation.

## Route inventory

| Route/component | Review and resulting treatment | Evidence |
| --- | --- | --- |
| `QaHub` | Review setup, evidence entry, action monitoring, outcomes, report controls and navigation reviewed. Added recoverable criterion/evidence/delivery loads, radio semantics, guarded action drafts and shared report menu. | Handler tests; native QA navigation. Live publication/evidence submission not performed. |
| `QaAdminCentre` | Dedicated administration retained; workflow guide rendered only on its own page. Question bank receives embedded mode. | Native questions/import destinations; source review. |
| `QaQuestionBankAdmin` | Combined source load with stale-response guard and retry; save validation and unsaved cancellation; simpler primary filters. Published snapshots retained. | Handler tests for failed load/retry; native 105-question catalogue. |
| `QaFormAccessAdmin` | Separate task, explicit scope, selected/historical staff retention, unsaved guard and concurrency behavior reviewed. Shared table semantics improved. | Existing permission/task tests. Live access changes not made. |
| `QaRatingLabelsAdmin` | Separate outcome and Not seen tasks, partial-save retries and version checks preserved. Shared table semantics improved. | Permission, partial-save and task-isolation tests. No live wording save. |
| `AdminCentre` | Active coaching, staff, learning-walk-theme and dashboard subpanels reviewed. Recoverable reads, stale-response handling, guarded staff refresh and plainer dashboard labels. Dashboard save distinguishes a successful write from a failed refresh. | Focused panel tests; native searchable setting directory. |
| `AdminStaffDetails` | Search/sort remain usable while editing; switching staff uses the existing save/discard decision and retains the selected staff option. | Source and focused people-route tests. Live staff edits not saved. |
| `AdminRooms` | Existing validation, historical room-code protection, guard and retry retained; table headers/scroll region improved. | Room search/history/sort handler test. |
| `AdminManagedLists` | Load failure has retry and a distinct unavailable state. Search/sort never writes configured order; ambiguous manual movement remains blocked. | Handler tests. |
| `AdminRecordsPanel` | Record/audit reads guarded; stale audit cleared; retry and contextual archive errors; readable custom table semantics and progressive filters. | Deferred-response and failed-archive handler test. |
| `AdminWorkScrutiny` | Pending record opens cannot overwrite a subsequent selection; details/actions/audit reset together; loading/retry and save lock cover refresh. | Deferred-response navigation test. |
| `AdminElevatePractice` | Named search, progressive facets, recoverable load errors and table semantics. | Source review. No live correction saved. |
| `AdminCsvImport` | Existing metadata-led template/reference download, exact-file preview, staged confirmation, stale-file protection and administrator-only checks retained. Tables use shared keyboard overflow behavior. | 14 CSV component/helper tests; native QA import preparation. No batch applied. |
| `ElevateStatusAssetsAdmin` | Year and asset reads separated; assets clear during year change; delayed image checks cannot attach an old file to a new year. Invalid file selection clears the old pending file. | Source review and TypeScript build. No file uploaded. |
| `PermissionsAdmin` | Focused people/tiers pages retain their boundaries. Capability groups start compact, show selected counts and expand for capability search. Technical keys remain in tooltips. | Focused permission/task tests. No role/access writes. |
| `OrganisationStructureAdmin` | Unit/leadership/allocation workflows, protected historical records and impact confirmation reviewed. Load retry, labelled icon actions, dialog-local errors and save locks added. | Four focused people/organisation SSR tests. No live organisation changes. |
| `DashboardFacultyAdmin` | Dataset scope boundaries and untouched-dataset preservation retained. Initial failure has retry instead of indefinite loading. | Dataset-isolation and failed-save tests. |
| `MessagingAdminPanel` | Template, transport and history separation retained. Guarded histories/previews, independent retry, conditional SMTP fields, simpler optional editors and saved-wording test requirement. | Task isolation, deferred history/preview and test eligibility tests. No email sent. |
| `FormBuilder` | Template selection/filters, draft/version/publish protections, preview labels, historical allocation and stale summary loads reviewed. Configured order stays explicit. | Native Work Scrutiny template and 34-field preview; TypeScript build. No draft created/published. |
| `FormEditor` | Legacy editor reviewed; current unsaved-change wording aligned. No active route import found during this pass. | Source reachability review. |

`AdminCentre` also retains the legacy `LookupAdminPanel` and `RecordCorrectionPanel` helper definitions. No active JSX use was found; their presence is not counted as native route coverage. The active routes use the dedicated managed-list and record panels.

## Verification

Final focused run: 60 passed, 0 failed across `admin-focused-panels.test.mjs`, `admin-focused-people-organisation.test.mjs`, `admin-csv-import.test.mjs` and `product-shared-usability.test.mjs`. The administration layout regression covers single groups, actual search and destination selection, and focused task DOM order. The dashboard chooser has a separate seven-case suite documented in the shared navigation review. Web TypeScript project build passed after the final source changes.

Native browser checks used the existing local preview/API and existing data. They exercised the questions settings page, question CSV destination, settings search, focused Work Scrutiny template page and its configured 34-field preview. Earlier shared checks covered staff/action pickers, safe unsaved-dialog focus, Excel-selection dialog focus and report-menu keyboard behavior. Only local unsaved input was discarded. No fixtures, imports, permissions, records, settings, messages or uploads were applied.

Local review screenshots are in the ignored `.localappdata/local-run/product-review/` directory: `qa-question-settings.png`, `qa-question-import.png`, `admin-template-preview.png` and the shared dialog evidence. No preview process was started by this reviewer.

## Limits and integration notes

- This is source-wide coverage of the assigned inventory, with targeted handler tests and selected native screens. It is not a full live CRUD/role/browser matrix. Destructive, access-changing, publication and delivery actions were verified through code and mocked responses rather than executed against the user's data.
- Native setting selection can finish with focus on the main landmark because shell navigation's frame callback can run after the setting-heading focus. The heading and document title are correct; this integration detail was reported to the shell owner.
- Narrow-screen and enlarged-text shell checks are being performed by the root/product reporting reviewers. Those checks and reporting data/export correctness have their own review documents; they are not implied by this inventory.
- Existing personal display choices were respected during native review. The task does not assert WCAG certification or assistive-technology testing that was not performed.
