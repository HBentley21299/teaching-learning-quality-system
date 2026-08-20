# Messaging And Export Operations

## Messaging Flow

1. A workflow commits its business record and a row in `ops.domain_events` in the
   same database transaction.
2. The dispatcher claims events with an expiring lock, evaluates active rules and
   resolves staff, action owner, creator, line manager or reviewer recipients.
3. One idempotent `ops.message_outbox` row is created per event and rule.
4. The delivery worker renders the immutable template version and sends through
   Microsoft Graph. Failed attempts use bounded exponential retry.
5. Templates, tests, retries, cancellation and delivery attempts remain audited.

Approved placeholders are defined in `MessageTemplatePolicy`. Adding a placeholder
requires an explicit data-source and privacy review; arbitrary database fields and
free-form recipient addresses are not available to template editors.

Email attachments are intentionally disabled in V1. The schema reserves managed
attachment metadata, but the application will not accept an attachment configuration
until approved college storage retrieval, file-size controls and malware scanning are delivered together.

Production Graph requirements:

- Dedicated Entra confidential application with `Mail.Send` application permission.
- Administrator consent and an Exchange application-access restriction for the
  approved sender mailbox.
- Client secret entered in Admin Centre and protected by the application's persistent Windows Data Protection key ring.
- Non-production `TestMode=true` with a mandatory safe test recipient.
- Sender, reply-to, final application URL and operational owner agreed before enablement.

## Export Flow

Excel exports are generated for Staff, Actions, CPD, Coaching, Reflections, LIV,
Elevate Learning and Innovation, Learning Walks, Work Scrutiny, Learning
Environments and Probationary Observations. Every query applies the same visible
staff and visible organisation functions as the application UI.

The workbook contains an Export Information worksheet with requester, timestamp and
filters. Detail worksheets freeze and filter their headings. Hidden numeric ELI
scores are deliberately excluded from user-facing exports.

Interactive requests are limited to 25,000 rows per worksheet. A truncation warning
is included in the workbook; users must narrow filters and export again. The
`ops.export_jobs` table reserves the contract for future storage-backed asynchronous
exports if real usage exceeds this V1 boundary.

Word output is a basic, valid Open XML record report with central branding settings,
record context, populated responses and linked actions. The final logo and approved
document layout can be added through `ExportBranding` without changing module data.

## Operational Checks

- Watch failed and retrying deliveries in Admin Centre > Messaging.
- Alert on sustained `messaging` worker errors and repeated Graph rejection responses.
- Keep `Messaging__Enabled=false` during tenant, mailbox or secret changes.
- Verify exports using accounts from each permission tier, not an administrator only.
- Never loosen export SQL to solve an empty result; first verify scopes and manager
  relationships in Admin Centre.
