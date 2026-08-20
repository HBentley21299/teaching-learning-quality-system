# Production readiness checklist

Use this checklist after following [DEPLOYMENT-START-HERE.md](../../DEPLOYMENT-START-HERE.md).

## Hosting

- [ ] Supported Windows Server is patched and monitored.
- [ ] IIS and the .NET 10 Hosting Bundle are installed.
- [ ] The final HTTPS address, DNS record and trusted certificate are active.
- [ ] The IIS application pool runs as the approved dedicated service account.
- [ ] `DataProtectionKeyPath` is outside the release folders and included in server backup.
- [ ] The production website cannot serve directory listings or plain HTTP.

## Database

- [ ] SQL Server 2019 or 2022 is used with compatibility level 140 or later.
- [ ] Traffic from the IIS server is permitted and encrypted.
- [ ] The website account has `db_datareader`, `db_datawriter` and `EXECUTE`, not `db_owner`.
- [ ] A separate deployment account can apply migrations.
- [ ] Full, differential and transaction-log backups meet the agreed recovery targets.
- [ ] A restore has been tested and recorded.
- [ ] No local reset or test-data script is available to routine production operators.

## Identity and permissions

- [ ] Separate Microsoft Entra API and browser registrations are configured.
- [ ] Only the exact production HTTPS redirect/logout address is registered.
- [ ] `access_as_user` is exposed, assigned and granted administrator consent.
- [ ] MFA and Conditional Access apply.
- [ ] The bootstrap administrator identity matches the intended staff account.
- [ ] Admin, Teaching and Learning, Director, Head of Faculty, Programme Leader, ALS leadership and staff access have been tested.
- [ ] Faculty/team scope is correct across profiles, forms, actions, dashboards and exports.

## Application

- [ ] The release came from a clean, approved Git commit.
- [ ] Build, automated tests and dependency audits passed.
- [ ] `/health/live` returns HTTP 200.
- [ ] `/health/ready` returns HTTP 200 and reports the database connected.
- [ ] Every process can save, submit and reopen according to role.
- [ ] Actions, dashboards, drill-down links, Excel exports and Word exports work.
- [ ] Audit rows are created for changes.
- [ ] Tablet and keyboard use has no blocking issue.
- [ ] Test records and test accounts have been removed or disabled.

## Operations

- [ ] Application and IIS logs are collected without request bodies, tokens or staff narrative.
- [ ] Alerts cover website failure, repeated HTTP 500 responses, SQL connection failure, low disk space and failed backups.
- [ ] The service desk knows the website owner, DBA owner and escalation route.
- [ ] The immediately previous application release is retained.
- [ ] The application rollback and database restore procedures have been rehearsed.
- [ ] Messaging remains disabled until its sender, credentials, safe test recipient and support owner are approved.

Production should not open to staff until the product owner, IT owner and DBA have accepted this checklist.
