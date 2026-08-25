# Production readiness checklist

Use this checklist with [DEPLOYMENT-START-HERE.md](../../DEPLOYMENT-START-HERE.md).
Record evidence, owner and completion date in the college's controlled change or
service-management record.

## Governance and cost

- [ ] The production service, data owner, support owner and technical owner are named.
- [ ] The Azure subscription, cost centre, budget and cost alerts are approved.
- [ ] UK South and the proposed services meet data-protection and college policy.
- [ ] The private repository is college-owned and has at least two administrators.
- [ ] The release commit, tag, package SHA-256 and approver are recorded.

## Azure platform

- [ ] Infrastructure was created from the reviewed Bicep templates.
- [ ] App Service enforces HTTPS and the approved minimum TLS configuration.
- [ ] The managed identity, Key Vault and Storage role assignments are correct.
- [ ] Application Insights and Log Analytics collect operational telemetry.
- [ ] Alerts route to a monitored college support channel.
- [ ] Resource locks, tags, diagnostic retention and policy compliance are reviewed.

## Database

- [ ] Azure SQL networking permits only the approved migration and application paths.
- [ ] The App Service managed identity has runtime access, not `db_owner`.
- [ ] A separate Entra administrator can apply migrations and perform recovery.
- [ ] Every tracked migration is recorded in `dbo.schema_migrations`.
- [ ] Backup retention and point-in-time restore meet the agreed recovery targets.
- [ ] A restore test has been completed and recorded.
- [ ] No demo seed, reset or test-data script has been used in production.

## Identity and access

- [ ] Separate single-tenant API and browser registrations are in college ownership.
- [ ] Only approved HTTPS redirect/logout addresses are registered.
- [ ] The `access_as_user` delegated permission has tenant administrator consent.
- [ ] MFA and Conditional Access policies apply.
- [ ] The bootstrap administrator is the intended active staff account.
- [ ] Admin, Teaching and Learning, Director, Head of Faculty, Programme Leader,
      QA Staff, ALS leadership and Tutor access have been tested.
- [ ] Faculty and team scope is correct across forms, profiles, actions, dashboards
      and exports.

## Application acceptance

- [ ] CI, release build, automated tests and dependency audits pass.
- [ ] `/health/live` and `/health/ready` return HTTP 200.
- [ ] Each enabled process can save, submit and reopen as designed.
- [ ] QA review setup, evidence, closure, dashboard, actions and reports work.
- [ ] Audit rows are written for every tested mutation.
- [ ] Excel, PDF and Word exports open correctly where supported.
- [ ] Keyboard and tablet use has no blocking issue.
- [ ] Test accounts and records have been removed or disabled.

## Operations and recovery

- [ ] Logs exclude access tokens, request bodies and staff narrative.
- [ ] Alerts cover availability, repeated server errors, database connectivity,
      capacity and failed backups.
- [ ] The service desk has the support contacts, escalation route and runbook.
- [ ] Deployment and rollback responsibilities are documented.
- [ ] The previous approved application package and its checksum are retained.
- [ ] Database recovery and application redeployment have been rehearsed.
- [ ] Messaging remains disabled until sender identity, credentials, recipients and
      support ownership are approved.

Production should not open to staff until the product owner, technical owner,
information-governance owner and service owner have accepted this checklist.
