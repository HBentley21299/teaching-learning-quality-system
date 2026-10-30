# Partial-record exit handling — 29 October 2026

## Result

Dirty staff forms now distinguish saving a draft from formal submission when the user tries to leave through Home, another area/form, browser Back within the app, or the form's own guarded Cancel/Back control.

The submission prompt provides **Keep editing**, **Cancel submission**, **Save as draft** and the workflow's explicit formal action, such as Submit form, Complete stage or Send to lecturer. Available actions follow the existing lifecycle and capabilities. Settings and completed-record corrections retain their ordinary Save and leave behavior.

Cancel submission discards local unsaved input; it does not call a save endpoint or create a new draft. Previously saved records/drafts remain. It does not delete an already allocated case, undo an acknowledged save or remove QA evidence. Clean saved drafts do not trigger another unsaved-input prompt merely because they remain unsubmitted.

## Coverage

| Entry | Draft exit action | Formal exit action / boundary |
| --- | --- | --- |
| Learning Walk / ALS Learning Walk | Existing draft write with the answered template version. | Existing formal submission, including required/conditional question and action validation. |
| CPD variants and Learning Environment | Existing draft write for new entries; draft editing uses its existing save handler. | Existing authorized submission/status transition; completed corrections remain ordinary saves. |
| Work Scrutiny | Existing draft endpoint and core-context requirements. | Complete scrutiny when definition/core fields/delivery choices are ready, through the existing submission path. |
| Existing generic draft | Save edited answers to its existing draft. | Validate, save answers, then use the real formal status endpoint. A failed transition keeps the editor open and retryable; the already saved answers remain on that existing draft. |
| Coaching draft | Save with draft status. | Existing completed-session handler and validation. Completed corrections remain save-only. |
| ELI self-assessment | Existing Save draft operation. | Existing assessment submission for validation; administrative corrections are separate. |
| LIV / ALS LIV in-progress stage | Save in_progress without completing the stage. | Complete stage through the same authorized stage/visit handler. Whole-cycle completion remains its explicit workflow. Visit draft saving still requires its existing delivery/course-level context. |
| Probation in-progress stage | Save in_progress; saving an action-stage status does not create a new live action. | Complete stage through the existing handler. Whole-observation completion first checks unsaved work, then retains its separate confirmation/progression. |
| UCO observer | Save the real observer draft. | Send to lecturer through update then submit, retaining the refreshed token/answers if sending fails. |
| UCO lecturer reflection | No draft endpoint exists. | Explicit authenticated Acknowledge review only, with the existing discussion/reflection validation. It is never presented as draft saving. Final sign-off and management steps remain separate. |
| New cases/reviews and live actions | No fake draft action is supplied where the domain has no draft endpoint. | Explicit Create case/review/action where supported; Keep editing or discard remains available. |
| QA evidence | Existing one-writer draft queue. | Submit evidence only for an editable draft; latest answers and row version are flushed. Submitted corrections retain their reason/audit save flow. |
| QA setup, profiles and administration | Existing ordinary save where supported. | No invented submit/publish operation. Review publication and other lifecycle transitions stay explicit. |

## Navigation, failures and cancellation

The shared guard registers actual dirty editors and their real callbacks. It does not create a draft automatically on navigation. Required-field failures, API rejection and thrown errors keep the decision open and the form data intact. Staff can return to editing or use a supported draft operation.

While an operation is running, duplicate submit/save/cancel/navigation gestures are blocked synchronously. A second destination cannot overtake the original decision, including after a callback has cleared its dirty state. Multiple dirty editors cannot be silently included in formal submission when any lacks a matching formal callback. Successful writes/discards clear the unload-warning reference immediately, avoiding a second stale warning during an accepted exit.

QA already creates a server draft before opening its evidence editor and autosaves after 900 ms. Its prompt therefore says **Discard unsaved changes** and explains that saved/autosaved evidence remains. The timer pauses while an exit decision is open. Discard restores the latest acknowledged answers/token without writing or removing evidence; an already running save must finish first. The guard's formal action retains the originally requested navigation destination instead of redirecting to the evidence list. Details and focused evidence are in [the QA follow-up](qa-partial-record-exit-2026-10-29.md).

## Browser closing and reload

Closing/reloading the browser or leaving the application document uses the browser's native beforeunload protection. Browsers control that warning and do not allow a page-defined three-action draft/submit dialog there. Choose Stay to return to the application and its exit choices. The listener is present only for dirty/in-flight editors; it performs no save during unload. Browser force-quit/mobile lifecycle events cannot be guaranteed to deliver this event. [Browser documentation](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event).

## Verification

- Complete frontend suite: **378 passed, 0 failed, 0 skipped**, recorded in `.localappdata/local-run/partial-record-exit-frontend-final.log`.
- Shared guard tests exercise actual registered callbacks: keep/discard/draft/formal behavior, failed validation/rejected promises, retry, duplicate operations, competing navigation, multiple editors, native unload-handler behavior and clean/unmounted forms.
- Consumer tests exercise the actual generic, Work Scrutiny, coaching, ELI, action, LIV, probation, UCO and QA handlers with deterministic API stubs. They check draft versus formal payloads, authorization/status affordances, token updates, failed transitions, local Cancel/Back and no-write discard.
- Native no-write review used a partial Learning Walk: Home, local Cancel and real browser Back each opened the four-choice prompt; Keep editing retained the typed answer; accepted discard returned to the requested destination. The register remained empty. Desktop and 320px modal layout were checked; all mobile actions were 44px tall and the modal had no horizontal overflow. Browser error logs were empty.
- No application records were created, drafted, submitted, removed or otherwise mutated for browser QA. No schema/API change, database reset, fixture seed, permission change, deployment or remote repository write was performed. Native save/submit writes are covered by deterministic consumer tests, not claimed as live-record tests.

Production `npm run build` passed, including TypeScript, recorded in `.localappdata/local-run/partial-record-exit-build-final.log`. Vite retains its existing main-bundle size advisory (about 545 kB before gzip). Whitespace checks passed. The native-review tab was closed, viewport restored and verified temporary preview process stopped. The normal development API and web app both returned HTTP 200; the API required no restart for this frontend-only change.

Evidence images: `.localappdata/local-run/product-review/partial-record-exit-desktop.png` and `partial-record-exit-mobile.png`. Shared guard log: `partial-record-exit-guard-tests.log`; QA log: `qa-partial-exit-tests.log`.
