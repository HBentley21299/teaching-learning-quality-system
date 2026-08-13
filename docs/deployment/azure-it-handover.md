# i-Elevate Azure hosting and IT handover

Last reviewed: 13 August 2026

This document is the deployment handover for the i-Elevate Teaching and Learning System. It supplements [azure-v1.md](./azure-v1.md), [v1-readiness.md](./v1-readiness.md) and the executable infrastructure in [`infra/azure/main.bicep`](../../infra/azure/main.bicep).

## 1. Handover status

The application is technically ready for a controlled Azure test deployment. It is **not ready for production deployment from the current working copy** until the release-owner actions in section 2 are complete.

The final local gate covers:

- .NET Release compilation with warnings treated as errors;
- 96 automated role, scope and permission tests;
- production NuGet and npm vulnerability audits;
- TypeScript and Vite production compilation;
- Linux App Service publish and release manifest generation;
- Bicep compilation and linting;
- browser review of all forms, dashboards, staff/profile areas and accessible admin tabs;
- dashboard load testing with 6,000 temporary records, followed by removal of the fixture.

No test-record fixture is included by the Azure deployment. Local username/password accounts are available only when the API runs in the `Development` environment with `Authentication__AllowDevelopmentUser=true`; production always uses Microsoft Entra ID.

## 2. Issues and decisions before production

| Priority | Item | Required action | Owner |
| --- | --- | --- | --- |
| **Blocker** | The repository is on `main` with uncommitted application and migrations 060–062 changes. A dirty verification artifact is not a production release. | Review the diff, commit it to an approved release branch, run CI and deploy the exact approved commit. Do not use `-AllowDirty` for production. | Product owner / release manager |
| **Blocker** | Production Entra configuration has not been exercised in this local review. | Create separate production SPA and API registrations, expose `access_as_user`, grant consent, register exact redirect/logout URLs and test every role with Conditional Access enabled. | Identity team |
| **Blocker** | Database changes are forward-only and include new ALS process migrations. | Back up the target database, run the guarded deployment script with the approved migration identity, confirm `dbo.schema_migrations`, and perform the smoke tests before opening access. | DBA / release manager |
| **Resolved in repository; validate in Azure** | Production staging and rollback | Bicep now creates a staging slot. Deployment health-checks it before swap, and the rollback script validates the previous production build before swapping it back. IT must validate this path in the college subscription before go-live. | Cloud platform team |
| **High** | Azure SQL has 35-day point-in-time retention, but no long-term retention, zone redundancy or documented RPO/RTO. | Agree RPO/RTO, configure long-term retention and any required geo/zone resilience, then complete and record a restore exercise. | DBA / information governance |
| **High** | Custom domain, certificate and DNS are not provisioned by the template. | Decide the final URL, bind the managed certificate/custom domain, update Entra redirect/logout URLs and set `Messaging__ApplicationUrl` to the final origin before enabling email. | Network / identity team |
| **High** | Key Vault currently permits its public endpoint. RBAC, soft delete and purge protection are enabled, but network restriction is an IT decision. | Restrict access with a private endpoint or approved firewall rules and confirm how deployment operators will set/rotate secrets. | Security / cloud platform team |
| **High if required** | Blob Storage and an `evidence` container are provisioned, but the present product does not expose general evidence-file upload; form evidence is currently structured/text data in Azure SQL. | Confirm that this is acceptable for launch. Implement and penetration-test file persistence/scanning before promising file attachments to users. | Product owner / security |
| **Partially resolved; IT input required** | Bicep now creates email alerts for App Service server errors and sustained SQL CPU when `OperationsAlertEmail` is supplied. Log retention remains 30 days. | Confirm the alert mailbox, required retention and any additional service-desk integration described in section 10. | Operations |
| **Medium** | Dashboard list endpoints return the selected academic year's permitted records to the browser and paginate the visible grid client-side. This performed adequately at 2,000 records in one process/year, but is not the preferred design at very high volumes. | Monitor response time and payload size. Move detail grids to server-side pagination before any process regularly exceeds 10,000 records per academic year or compressed responses exceed 2 MB. | Application owner |
| **Medium** | Package updates are available, although the vulnerability audits are clear. | Apply current .NET/React/MSAL patch releases in a separate, tested maintenance change. Do not combine untested major upgrades with go-live. | Application owner |
| **Medium** | Azure resource sizing is a starting point, not an observed production baseline. | Load-test in Azure with realistic concurrent users and exports; resize SQL/App Service from measured p95 latency, CPU, memory and DTU/vCore utilisation. | Cloud platform team |

Internal database objects retain the historic `quality` schema name for migration compatibility. This is not displayed to users; user-facing language has been standardised to teaching and learning. Renaming the physical schema would be a high-risk data migration with no user benefit.

## 3. Recommended Azure topology

The supplied template creates one same-origin application deployment:

- Linux Azure App Service on .NET 10, serving the React application and ASP.NET Core API;
- Azure SQL Database using the App Service managed identity;
- Azure Storage with public blob access and shared-key access disabled;
- production VNet integration with private endpoints for SQL and Blob Storage;
- Key Vault with RBAC, soft delete and purge protection;
- Application Insights backed by Log Analytics.

Production defaults to Premium V3 `P0v3` and a one-vCore General Purpose serverless SQL database with auto-pause disabled. Treat these as initial values. Keep App Service and SQL in supported nearby regions unless college resilience policy requires a paired-region design.

Recommended additions owned by IT are:

- custom DNS and certificate;
- any Azure Monitor alerts beyond the included HTTP 5xx and SQL CPU baseline;
- budget alerts;
- Key Vault network restriction;
- SQL long-term retention and, where required, geo/zone resilience;
- App Service access restrictions or Front Door/WAF if required by college policy;
- shared ASP.NET Core Data Protection keys before scaling to multiple instances or slots.

## 4. Access required by the deployment operator

The first deployment operator needs:

- Contributor and User Access Administrator on the target resource group or equivalent least-privilege custom roles;
- permission to assign the Azure SQL Entra administrator;
- access to an Entra SQL administrator identity for migrations;
- Azure CLI 2.88 or later, .NET 10 SDK, Node.js 24, PowerShell and the `SqlServer` PowerShell module;
- the approved production Entra tenant, SPA client ID, API client ID/scope and bootstrap administrator identity.

Use an Entra group rather than a named individual as the Azure SQL administrator. Runtime access is granted to the App Service managed identity as `db_datareader`, `db_datawriter` and `EXECUTE`, not `db_owner`.

## 5. Entra application configuration

Create separate registrations for the API and browser application.

### API registration

1. Set Application ID URI to `api://<api-client-id>`.
2. Expose delegated scope `access_as_user`.
3. Record the tenant ID and API client ID.
4. Do not create a client secret for normal API authentication.

### SPA registration

1. Add delegated permission `api://<api-client-id>/access_as_user`.
2. Grant college administrator consent.
3. Configure exact HTTPS redirect and logout URLs for staging and production.
4. Do not use wildcard or localhost URLs in production.

Apply MFA and Conditional Access in Entra. The application does not store production passwords. Each production user must map to one active staff record, and permissions are then determined by application roles and organisation scopes.

If email is enabled later, use a third confidential Entra application with Microsoft Graph application permission `Mail.Send`, admin consent and an Exchange application-access policy limited to the approved sender mailbox.

## 6. Configuration reference

The React build values are compile-time values. Changing them requires a rebuild. API values are App Service settings and must not be committed as production secrets.

### Required application settings

| Setting | Production value |
| --- | --- |
| `ASPNETCORE_ENVIRONMENT` | `Production` |
| `ASPNETCORE_HTTP_PORTS` | `8080` |
| `ASPNETCORE_FORWARDEDHEADERS_ENABLED` | `true` |
| `Authentication__AllowDevelopmentUser` | `false` |
| `Authentication__TenantId` | College Entra tenant GUID |
| `Authentication__Audience` | API client ID |
| `ConnectionStrings__TlqsDatabase` | Encrypted managed-identity Azure SQL connection string |
| `Storage__AccountUri` | Storage Blob service URI |
| `Storage__EvidenceContainer` | `evidence` |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | Application Insights connection string |
| `WEBSITE_RUN_FROM_PACKAGE` | `1` |

The first-deployment settings file also requires `OperationsAlertEmail`, a shared
mailbox or distribution list that receives the included HTTP 5xx and SQL CPU alerts.

`Cors__AllowedOrigins` is not required for the supplied same-origin package. If the frontend is separated later, allow only its exact HTTPS origins.

### Required web build values

| Variable | Production value |
| --- | --- |
| `VITE_API_BASE_URL` | Empty for the same-origin package |
| `VITE_API_TIMEOUT_MS` | `30000`, unless Azure load testing supports a lower value |
| `VITE_ENTRA_CLIENT_ID` | SPA client ID |
| `VITE_ENTRA_TENANT_ID` | College Entra tenant GUID |
| `VITE_ENTRA_API_SCOPE` | `api://<api-client-id>/access_as_user` |

### Optional messaging settings

Keep `Messaging__Enabled=false` for the initial deployment. When the separate email gate passes, configure the Graph client ID, Key Vault-referenced secret, sender/reply-to mailboxes and final application URL as described in [azure-v1.md](./azure-v1.md). Test/test environments must use `Messaging__TestMode=true` and a safe `Messaging__TestRecipient`.

## 7. Build and deployment sequence

Run from a clean checkout of the approved commit:

```powershell
.\scripts\check-prerequisites.ps1
.\scripts\verify-v1.ps1
az login --tenant <college-tenant-id>
az account set --subscription <subscription-id>
```

The release gate produces `.artifacts/v1/api`, `.artifacts/v1/web`, `release.json` and a SHA-256 `manifest.json`. The API artifact targets Linux x64 and excludes development settings.

For the first controlled production deployment:

```powershell
.\scripts\deploy-azure.ps1 `
  -ResourceGroup "rg-tlqs-prod" `
  -Location "uksouth" `
  -EnvironmentName prod `
  -SqlAdministratorLogin "TLQS SQL Administrators" `
  -SqlAdministratorObjectId "<entra-group-object-id>" `
  -SqlAdministratorPrincipalType Group `
  -EntraApiAudience "<api-client-id>" `
  -EntraSpaClientId "<spa-client-id>" `
  -EntraApiScope "api://<api-client-id>/access_as_user" `
  -BootstrapAdminObjectId "<initial-admin-entra-object-id>" `
  -BootstrapAdminEmail "<matching-active-staff-email>" `
  -IncludeOfficialStaffData
```

The script temporarily permits only the operator's public IP to Azure SQL, applies checksum-tracked migrations, binds the explicit bootstrap administrator, grants the managed identity its runtime database permissions, deploys the same-origin ZIP, closes public SQL access in a `finally` block and validates `/health/ready`.

Never run `fix-localdb.ps1`, reset scripts, local seed-management scripts or an `.mdf` database against Azure SQL.

## 8. Data migration and initial access

Before applying migrations:

1. Record the approved Git commit and artifact manifest.
2. Verify a restorable database backup or point-in-time restore position.
3. Confirm whether `-IncludeOfficialStaffData` is authorised.
4. Confirm that the bootstrap email exactly matches an active staff row and the supplied object ID belongs to that person.
5. Run the migration once. Do not edit a migration after it appears in `dbo.schema_migrations`.

After migration, sign in with the bootstrap administrator and configure/verify:

- staff account status and Entra identity mapping;
- Admin, Teaching and Learning, Director, Head of Faculty, Programme Leader and Tutor roles;
- ALS Team Leader and ALS Head of Faculty scopes;
- faculty/team organisation membership and management relationships;
- academic years and active configurable lists;
- dashboard visibility/labels and academic-year badge artwork.

## 9. Production smoke-test checklist

Complete this in staging, then repeat the critical items after production release:

- [ ] `/health/live` returns HTTP 200.
- [ ] `/health/ready` returns HTTP 200 with `database=connected`; loss of SQL returns 503.
- [ ] Entra sign-in, sign-out and expired-token recovery work.
- [ ] A Tutor sees only their own permitted records and actions.
- [ ] Programme Leader, Head of Faculty and Director faculty/team scope is correct.
- [ ] ALS leaders see ALS LIV/Learning Walk processes without ordinary LIV/Learning Walk access unless separately granted.
- [ ] Admin and Teaching and Learning users can access only their intended admin functions.
- [ ] Create, draft, submit, reopen/edit (where permitted), complete and archive are tested for every process.
- [ ] Learning Walk/LIV/ALS rubrics reflect configured focus selections.
- [ ] Probation observation two appears correctly in both probation and LIV reporting.
- [ ] Dashboard faculty/team drill-down links open only in-scope underlying records.
- [ ] Dashboard exports contain form data for the selected academic year/scope and open without repair warnings.
- [ ] Staff profile history and Elevate Status reset correctly by academic year.
- [ ] Elevate Status artwork upload, replacement and historic-year display work.
- [ ] Action ownership restrictions and completion/overdue measures are correct.
- [ ] Dark mode, keyboard navigation and tablet layouts have no blocking defect.
- [ ] Audit history records create, edit, submit, role/scope change, action closure and archive events.

Do not use genuine sensitive narratives during smoke testing. Remove all staging smoke records before any production data copy.

## 10. Monitoring and operational controls

Create an Azure Monitor action group and alerts for:

- readiness failures and App Service health-check eviction;
- sustained HTTP 5xx rate and p95 response latency;
- repeated authentication failures or 401/403 anomalies;
- App Service CPU, memory, restart and instance-health thresholds;
- Azure SQL CPU/data IO/log IO, connection failures, storage utilisation and deadlocks;
- failed or growing message-outbox rows if messaging is enabled;
- storage availability/errors if file evidence is implemented;
- Key Vault access failures;
- expiring certificate, client secret and custom-domain binding;
- cost/budget thresholds.

Request logs include trace IDs but must not include access tokens, request bodies, reflections or other staff narrative. Agree log retention with information governance. Application audit records live in Azure SQL and should be included in retention, subject-access and deletion policies.

## 11. Capacity and performance guidance

The frontend is route-split and production assets use immutable caching. API responses are compressed over HTTPS. Built-in display artwork has been reduced to an appropriate web resolution, and versioned custom badge images are privately cached after their first authenticated download.

For the first month, review weekly:

- p50/p95/p99 request duration by endpoint;
- dashboard payload and SQL query duration by process/year;
- export duration and memory use;
- SQL utilisation and connection-pool errors;
- App Service working set and restart count;
- browser error rate from supported desktop/tablet clients.

Scale vertically first if SQL CPU/IO or App Service memory is consistently constrained. Before scaling App Service beyond one instance, persist Data Protection keys to shared protected storage and run concurrency tests against action updates, form submission and exports.

## 12. Release, rollback and support

Production releases use a staging slot: deploy the approved package, verify health, then swap. The former production build remains in staging and can be restored with `scripts/rollback-azure-slot.ps1`. Retain the immediately previous ZIP and manifest as an additional recovery measure.

Application rollback can redeploy the previous package. Database migrations are forward-only and must remain backward compatible during the rollback window; do not attempt to reverse them ad hoc. If data recovery is required, follow the agreed Azure SQL point-in-time restore runbook and obtain information-governance approval.

Record for every release:

- Git commit and branch/tag;
- `release.json` and `manifest.json`;
- migration ledger state;
- deployment operator and approval reference;
- production smoke-test result;
- rollback package/location;
- known issues and expiry dates for any temporary exception.

The operational support handover should name the service owner, technical owner, data owner, security contact, support route, service hours, severity definitions and escalation path.
