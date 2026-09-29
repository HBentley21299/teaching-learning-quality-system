# Reporting and workflow follow-up — 29 September 2026

Implemented the accepted dashboard freshness, QA autosave, action editing and staff-profile evidence improvements in the local worktree. No database migrations or server configuration changes are involved in this part.

- Dashboard data is keyed by academic year, process and user access. All independent datasets load together. A failed required dataset is named explicitly, charts and exports stay unavailable until the selected view is complete, and retry requests only the failed datasets. A superseded request cannot apply its response after a new selection or refresh. Successful empty datasets still display real zero counts.
- QA draft typing remains enabled during background saves. A single writer coalesces edits made during a request, uses the acknowledged row version for the next save and retains newer text. Final submission queues behind any pending draft save, locks editing, and uses the latest draft. Failure stops the writer and retains the draft. Unmounted editors ignore late replies.
- QA uses the shared unsaved-changes dialog and the shell's accepted-history event. Successful submission clears its guard before navigation. Draft evidence supports Save/Discard/Stay when leaving.
- Action create/edit fields and note panels register actual changed content. Switching or cancelling editors uses the shared guard. Create/edit can save before leaving; destructive/note workflows must be completed in their editor or discarded. Eligible-owner failures are visible and retryable, stale owner lookups are ignored, and save is blocked while eligible owners are unavailable. Explicit writes disable the editor to prevent changes being cleared while saving.
- Staff-profile evidence and level confirmations register actual changes and support save before leaving. Saving one level preserves unsaved changes to the others. Failed saves keep entered values, while a successful save followed by a failed profile refresh is reported separately. Save feedback is announced through a live status region.

## Verification

- Full web TypeScript check passed after these changes (later parallel changes still require the main task's combined check).
- Nine deterministic async tests passed in `tests/dashboard-loading-races.test.mjs` and `tests/qa-autosave-races.test.mjs`: late prior-year replies, late same-view refresh, concurrent dataset loading/failure, unmount, typing during save, final submission during save, concurrency conflict, explicit retry and editor disposal.
- These tests exercise the actual loader/writer helpers used by the components. Browser integration and production performance are separate checks owned by the main audit; no production verification is claimed here.
- After the integrated local restart, fourteen sequential reporting GETs all returned HTTP 200 with the same counts and payload sizes as before. The QA export optimisation preserved all 8,474 compared workbook cells across thirteen sheets; only the generation timestamp changed. Details and timing limits are recorded in `local-reporting-baseline-2026-09-29.md`.

The original source audit remains in `reporting-operations-audit-2026-09-29.md` as the pre-change findings and decision record.

## Generic form drafts and reporting

The local draft lifecycle test found that a new Work Scrutiny draft was returned by the dashboard process-records API for its administrator/owner, despite being hidden by the dashboard client. The reporting query had deliberately allowed owners and administrators to see drafts, reusing an editor-access rule in a reporting source.

Learning Walk, ALS Learning Walk, Work Scrutiny and Elevate Environment now have a separate reporting eligibility condition: the latest active form submission must not be a draft. This condition applies regardless of editor access, across process-records, dimension facts, Learning Walk rollup and generic workbook record/answer sheets. Archived submissions do not influence the condition; existing legacy records without a form submission retain their previous treatment. In-progress LIV, coaching and other domain workflows retain their existing rules. Staff participation already uses submitted ELI/completed visits/attended CPD/completed coaching and does not count these generic forms.

The reusable runtime regression harness is `tests/form-drafts-runtime.ps1`. It creates clearly labelled local test copies, verifies the draft's detail and action state, attempts an invalid submission, completes and submits it, checks reporting eligibility, and archives the copies in a `finally` block. Its post-restart result is recorded by the integration task; source inspection alone is not runtime verification.

The integration run subsequently passed for Work Scrutiny, Learning Walk, Environment and ALS Learning Walk: draft IDs were absent from process records, dimension facts and actual Excel workbooks; submitted IDs were present in all three and exactly one staged action was promoted. Every labelled copy was archived; the final active-record check found none remaining. Eight workbook artifacts and cumulative `form-drafts-runtime-results.txt` are under `.localappdata/audit-implementation`.
