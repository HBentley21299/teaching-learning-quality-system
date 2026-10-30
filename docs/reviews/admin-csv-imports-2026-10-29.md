# Administrator CSV imports — 29 October 2026

Three focused import workflows are implemented. They sit beside the settings or records they maintain, with a shared prepare → preview → confirm workflow.

| Import | Location | What it adds |
| --- | --- | --- |
| QA questions | QA Hub → Administration → Evidence forms → Import QA questions from CSV | New versioned criteria, guidance, tags and answer requirements for future review setup |
| CPD | Admin Centre → Imports & bulk changes → Import CPD events & participants; also available from the CPD workspace | Delivered internal or mandatory CPD events, with named participant attendance |
| List choices | Admin Centre → Imports & bulk changes → Import managed list choices | Active choices in registered editable lists, including CPD themes, QA action themes and other supported form choices |

Every endpoint and native entry point requires the actual Administrator role. QA additionally requires `qa_reviews.manage`; CPD checks `cpd.manage` or `cpd.mandatory_log` for the corresponding event type; list import requires `lists.manage`. Management permissions or a custom permission tier alone do not grant import access. Permissions are resolved again before applying a batch.

## Preparing and checking a file

Each page provides a blank UTF-8 CSV template, an example row, a column guide and searchable current reference values with CSV downloads. Staff reference lists identify their 2,000-row display-source limit; the server can still resolve any valid active staff ID or email.

Files are limited to 1 MiB and 1,000 data rows. The server handles UTF-8 BOM, CRLF, quoted commas, escaped quotes and multiline fields. It rejects duplicate or unknown headers, malformed quoting, inconsistent row widths, missing required fields and unreadable content. Empty records are ignored while logical CSV row positions remain accurate. Example rows are illustrative and must be completed with the user's actual references.

Preview shows the proposed new entries, skipped entries, all input rows and row-specific errors, warnings and attendance notes. Users can search and filter it or download its issues. Errors block the entire batch. An explicit confirmation dialog is required; navigating away or choosing a generic Save action cannot apply an import. Selecting another file invalidates its previous preview immediately.

## QA question rules

Columns: `question_reference`, `activity_key`, `question_tag`, `theme_or_week`, `question_text`, `guidance`, `display_order`, `is_required`, `allows_not_applicable`, `comment_required_at_expected`, `source_status`.

Question reference, active activity key and question text are required. New criteria default to **draft**, with required responses and no N/A. Boolean columns accept true/false; availability accepts draft/active. Omitted order appends to the activity. The completion message explains how to find imported criteria using Draft or All statuses in the bank.

The importer creates a question and its first version. It does not overwrite existing criteria or change review selections, published snapshots, shared outcome labels, Not seen settings or form access. Review setup selects criteria by activity and question tag, so template membership is not modified. Duplicate bank criteria and conflicting imported references require review in the existing editor.

## CPD rules

Columns: `event_reference`, `academic_year`, `cpd_type`, `title`, `event_date_time`, `duration_minutes`, `delivery_mode`, `theme_keys`, `participant_external_id`, `participant_email`.

Use one participant per row and repeat the same event reference and event details for every participant. Staff match by exact external ID or email; if both are supplied, they must identify the same person. Names are not matching keys. Repeated participants are counted once and produce a warning. Staff are never created or reactivated by an import.

The importer accepts delivered internal/mandatory events, valid registered academic years, local college date/time, 1–1,499 minutes, supported delivery modes and active CPD themes. Future events, external self-logs on another person's behalf, attendance updates and award confirmations are excluded. Probable existing sessions are blocked to prevent duplicating manually recorded events. Additional required fields in a published CPD form block import rather than being silently omitted.

The existing form submission path is reused inside the batch transaction, retaining validation, saved answers, audit, domain events and attendance rules. Internal attendance earns its normal qualifying credit; mandatory attendance earns zero Elevate credit. Preview and confirmation show attendance consequences. Elevate award confirmation remains separate.

## Managed list rules

Columns: `lookup_key`, `value_key`, `display_name`, `display_order`.

Only active registered administrative lists are accepted. The importer cannot create arbitrary lists or extend protected workflow states. A blank choice key generates a stable key from the wording; a blank order appends. Existing identical active choices are skipped. Conflicting wording, order, keys or inactive choices require the existing list editor. No choice is renamed, archived or reactivated by CSV.

## Applying and auditing a batch

A protected 20-minute preview token binds the exact file, import area, administrator and calculated plan. Apply revalidates the file and relevant database context inside a serializable transaction with a per-area application lock. Stale previews require a new preview. Records, attendance, per-entry audit, batch audit and import tracking commit together; failure rolls everything back.

Migration `092_admin_csv_imports.sql` adds `ops.csv_import_items` and is registered in `scripts/apply-database.ps1`. Source references are durable per import area. Identical references and canonical payloads are skipped; changed payloads cannot overwrite prior imports. A network retry cannot create duplicate records. Import history remains separate from form answers and ordinary business reporting. Error/reference CSV downloads neutralise formula-looking text.

The local schema migration was applied without running database preparation, fixtures or seeds. No CSV batch was applied to the application database during validation.

## Verification

- 531 backend tests passed, with no failures or skips, including guarded disposable SQL databases for permissions, stale previews, idempotency, concurrent same-reference imports, published QA snapshot preservation and forced late-batch rollback of records, attendance, audit, outbox and ledger entries.
- 143 frontend tests passed, covering admin visibility, navigation, file reading, preview races, final confirmation, failed retries, duplicate apply protection and unsaved navigation. TypeScript and the production web build passed.
- Preview-only live checks passed for all three import types, template/metadata endpoints, invalid activities and invalid preview tokens. Browser checks verified QA navigation, file replacement, row errors blocking apply, valid draft previews and the final confirmation dialog. The dialog was cancelled and the staged file cleared.
- Local API startup used `scripts/start-local.ps1 -SkipDatabase`. Verification files and screenshots are in `.localappdata/local-run/csv-import-smoke/`.

Staff identity/role imports, arbitrary form-template CSV rewrites and protected review workflow/evidence imports were reviewed but excluded: their existing identity, versioning or workflow rules need dedicated import specifications. The delivered imports cover the useful QA/CPD authoring and reference-data work without introducing those unrelated bulk changes.
