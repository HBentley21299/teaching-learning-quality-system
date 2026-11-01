# QA Hub form commentary

QA review setup has a Written commentary switch for each selected form/process. New selections start enabled. The switch controls one optional overall commentary box on each evidence form for that process, replacing the earlier notes box beneath every criterion. Each process can have its own setting within the same review.

The choice is saved with the review activity and fixed when the review is published, alongside its questions and template. Published setup displays whether commentary is enabled. Review configuration permissions, row versions and the existing published-structure rules continue to apply.

The overall commentary accepts up to 10,000 characters. It uses the evidence form's existing draft autosave, explicit submission and audited correction flow. A disabled form does not display the box, and the API rejects new or changed nonblank overall commentary for it. Ratings and required Not applicable reasons remain separate.

Earlier criterion notes and other saved narrative remain available as read-only history. They are not merged into the new box or removed from save payloads. An older client omitting the new overall field cannot erase an existing answer; an explicit empty string clears it through the usual authorised save/correction path.

The native QA data explorer and Excel export include Written commentary once per form entry. Earlier nonblank criterion notes retain distinct labels; new blank criterion-note columns are omitted. Generic dashboard PDFs receive the same safe form data. The dedicated QA PDF continues to report aggregate distributions and coverage.

Migration `097_qa_form_written_commentary.sql` adds the activity-level flag and evidence-level text without loading fixtures or removing records. Existing review activities start enabled and existing narrative stays intact.

Verification passed all 472 frontend tests and 658 backend tests with no skips, plus the production web build and Release backend compilation. Disposable database checks cover independent setup choices, editing and publishing, unchanged settings when adding allocations, commentary autosaves, older-client omissions, explicit clearing, audited corrections, revision snapshots, stale versions, disabled-form validation and access restrictions. Export/PDF checks confirm a single form-level value and distinct historical notes.

The actual setup and evidence components were exercised in an isolated browser fixture at desktop and 390-pixel mobile widths. Both switch states, saved choices, keyboard focus, one enabled commentary box, no disabled commentary box, retained N/A reasons, earlier read-only notes and read-only access passed without browser errors or horizontal overflow. The final switch tracks measure 46 by 28 pixels, with their animated 22-pixel thumbs contained inside both states. The existing main-bundle size advisory remains.

Only migration097 was applied to the prepared local database, with its canonical UTF-8/LF checksum recorded in `dbo.schema_migrations`. Counts remained 2 staff, 5 core records and 0 actions; the local database has no QA reviews or submissions. Real save/submission cases ran only in disposable databases. Local services were restarted with `scripts/start-local.ps1 -SkipDatabase`; read-only checks confirmed QA Hub access, eight activity types, outcome labels, connected database readiness, HTTP 200 for the web app, and healthy DLW/Activate+ exports. No fixtures, reset, remote repository write or deployment was performed.
