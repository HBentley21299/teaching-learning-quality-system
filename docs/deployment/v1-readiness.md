# V1 Deployment Readiness

This is the release gate for the first production deployment of the Teaching &
Learning Quality System. A successful build is necessary, but it is not the
same as approval to use live staff data.

## V1 Topology

- React production artifact and ASP.NET Core API on one Azure App Service origin.
- Azure SQL Database using managed identity at runtime.
- Azure Blob Storage for evidence, with public access disabled.
- Microsoft Entra ID for staff sign-in and Conditional Access.
- Application Insights and Azure Monitor for logs, metrics and alerts.

The release still emits independent web and API artifacts, but V1 copies the web
artifact into the API `wwwroot`. This avoids CORS and split-release failures for
the initial 500-user deployment. The frontend can move to a static host later
without changing the API or data model.

## Current Release Command

Run from the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-v1.ps1
```

The command must finish successfully and produce:

```text
.artifacts/v1/api
.artifacts/v1/web
.artifacts/v1/release.json
.artifacts/v1/manifest.json
```

Release artifacts require a clean Git working tree. `-AllowDirty` is available
only for development verification and marks the resulting release metadata as dirty.

CI performs the same Release build, tests and dependency audits and publishes
`tlqs-api` and `tlqs-web` artifacts for 14 days.

## Required API Configuration

Store values in App Service configuration or Key Vault references. Do not put
production values in `appsettings.json`.

| Setting | Requirement |
| --- | --- |
| `ASPNETCORE_ENVIRONMENT` | `Production` |
| `ConnectionStrings__TlqsDatabase` | Encrypted Azure SQL connection using managed identity |
| `Authentication__TenantId` | College Entra tenant ID |
| `Authentication__Audience` | API app registration client ID |
| `Cors__AllowedOrigins__0` | Exact HTTPS web origin |
| `Storage__AccountUri` | Evidence storage account Blob endpoint |
| `Storage__EvidenceContainer` | `evidence` |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | Production Application Insights resource |
| `ASPNETCORE_FORWARDEDHEADERS_ENABLED` | `true` on App Service |

The API fails during startup when the database or production authentication
settings are absent. Local origins are permitted only in `Development`.

## Required Web Build Configuration

| Setting | Requirement |
| --- | --- |
| `VITE_API_BASE_URL` | HTTPS API origin; leave blank only when API is reverse-proxied on the same origin |
| `VITE_API_TIMEOUT_MS` | `30000` unless load testing supports a tighter limit |
| `VITE_ENTRA_CLIENT_ID` | SPA app registration client ID |
| `VITE_ENTRA_TENANT_ID` | College Entra tenant ID |
| `VITE_ENTRA_API_SCOPE` | Delegated API scope, such as `api://<client-id>/access_as_user` |

Register the exact production and staging redirect URIs in Entra. Do not use
wildcard redirect URIs.

## Identity And Database Gates

- Create separate Entra registrations for the SPA and API.
- Configure the API audience and delegated scope, then grant the SPA access.
- Apply college MFA and Conditional Access policies outside the application.
- Keep one controlled break-glass administrator and test its audit trail.
- Give the App Service managed identity data access, not `db_owner`.
- Use a separate migration identity for schema changes.
- Grant the runtime identity only required read/write and stored-procedure rights.
- Verify every seeded staff email maps to the intended Entra account.

## Infrastructure Gate

`infra/azure/main.bicep` provisions the executable V1 environment: App Service,
Azure SQL, private endpoints and DNS, VNet integration, Blob Storage, Key Vault,
Application Insights and Log Analytics. Runtime database and Blob access use the
App Service managed identity. SQL public access is disabled except for the exact
operator IP while the guarded deployment script applies migrations.

Production approval still requires college IT to confirm the chosen Azure
subscription, region, DNS name, Entra registrations, budget alerts, backup
restore test and Conditional Access policy. Infrastructure readiness does not
replace information-governance approval for live staff data.

## Pre-Production Test Gate

- `/health/live` returns HTTP 200 without testing dependencies.
- `/health/ready` returns HTTP 200 only when Azure SQL is available.
- Unavailable SQL causes `/health/ready` to return HTTP 503.
- Entra sign-in, sign-out and expired-token recovery work on desktop and tablet.
- Admin, Teaching & Learning, Director, Head of Faculty, Programme Leader and Tutor accounts are tested.
- Faculty/team scope is verified across staff, records, actions and dashboards.
- Learning Walk, Work Scrutiny, CPD, LIV, Elevate, Coaching and Action workflows complete against staging data.
- Audit entries are written for create, edit, submit, manager change, action closure and archive operations.
- No production dependency vulnerability is reported by the release gate.
- Tablet layouts and keyboard navigation complete without blocking defects.

## Monitoring Gate

- Alert on readiness failures, repeated HTTP 5xx responses and failed sign-ins.
- Alert on Azure SQL capacity, connection failures and storage errors.
- Retain API logs with trace IDs long enough to investigate staff-reported issues.
- Create a release annotation containing the Git commit and artifact digest.
- Do not log access tokens, request bodies, reflections or other sensitive staff content.

## Deployment And Rollback

1. Take or verify a restorable database backup.
2. Apply forward-only database migrations using the migration identity.
3. Deploy the API to a staging slot and wait for `/health/ready`.
4. Deploy the web artifact and run the role/scope smoke tests.
5. Swap or promote only after approval from the product owner and IT owner.
6. Record the Git commit and artifact manifest used for the release.

For rollback, restore the previous web/API artifacts first. Database migrations
must remain backward compatible for the release window; never run the local
database reset scripts against Azure SQL.
