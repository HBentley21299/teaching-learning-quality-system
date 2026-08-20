# On-premises operations reference

This document covers the operational details behind the short deployment guide. It is not an additional installation process.

## Production layout

- One Windows IIS website serves both the React interface and ASP.NET Core API on the same HTTPS address.
- One on-campus Microsoft SQL Server database stores application, form, reporting, audit and Elevate Status image data.
- Microsoft Entra ID provides staff sign-in. Application roles and faculty/team scopes remain in the i-Elevate database.
- Every application deployment is extracted into a new `InstallRoot\releases\release-*` directory. IIS is switched only after preparation; the previous directory is retained.
- ASP.NET Core Data Protection keys are stored outside the release directories and protected using Windows DPAPI.

General evidence-file attachments are not part of the current release. No external object-storage service is required. If document attachments are added later, choose an access-controlled college storage service and add malware scanning before enabling uploads.

## Required production settings

The deployment script writes `appsettings.Production.json` into each protected release directory. It contains:

| Setting | Purpose |
| --- | --- |
| `ConnectionStrings:TlqsDatabase` | Encrypted connection to the on-campus SQL database using the IIS Windows identity |
| `Authentication:TenantId` | College Microsoft Entra tenant ID |
| `Authentication:Audience` | API app registration client ID |
| `Authentication:AllowDevelopmentUser` | Must be `false` |
| `DataProtection:KeyPath` | Persistent access-controlled key directory |
| `Messaging:ApplicationUrl` | Exact production HTTPS address |
| `AllowedHosts` | Production host name |

The web application's Microsoft Entra IDs are embedded during the production build. Changing them requires rebuilding the release package.

## Database releases

`scripts/apply-database.ps1` uses Windows integrated authentication and records every applied script and checksum in `dbo.schema_migrations`. Already-applied scripts are skipped. If an applied file changes, deployment stops; database history must be extended with a new forward-only migration instead.

Before every database release:

1. Verify a restorable backup.
2. Record the approved Git commit and package SHA-256.
3. Apply migrations with the deployment identity.
4. Check `/health/ready` and complete the permission smoke tests.

Never run `fix-localdb.ps1`, local fixture scripts, reset scripts, `.mdf` files or ad-hoc rollback SQL against production.

## Backups and recovery

The DBA should agree recovery point and recovery time objectives and then configure full, differential and transaction-log backups accordingly. Backups must include `dbo.schema_migrations`, audit data and all staff/workflow records.

The application server backup should include:

- the IIS configuration and HTTPS certificate configuration;
- `deployment.settings.psd1` in its controlled location;
- the Data Protection key directory;
- at least the current and immediately previous release packages and manifests.

Machine-scoped DPAPI protects the Data Protection keys. After a full rebuild onto a different Windows server, existing messaging secrets may need to be entered again in Admin Centre. This does not affect forms, dashboards, actions or other business records.

## Monitoring

Collect Windows Event Log, IIS access/error logs and application console logs using the college monitoring platform. Alert on:

- `/health/ready` failure;
- repeated HTTP 500 responses;
- application pool stops or rapid restarts;
- SQL connection failures, blocking, deadlocks, capacity and failed jobs;
- low application or SQL disk capacity;
- missed or failed database backups;
- sustained messaging delivery failures.

Logs contain trace IDs for support correlation. Do not collect access tokens, request bodies, reflections or other staff narrative.

## Scaling

The expected college workload is suitable for one correctly sized application server with SQL Server managed separately. Measure response time, CPU, memory and SQL waits after launch. If a second IIS server is later required, replace machine-scoped DPAPI with certificate-protected shared keys and place both servers behind an approved load balancer before scaling out.

Dashboard detail lists currently return the permitted records for the selected academic year and paginate the visible grid in the browser. Move them to server-side pagination before a single process routinely exceeds 10,000 records per academic year or compressed responses exceed 2 MB.
