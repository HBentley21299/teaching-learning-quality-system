# i-Elevate Teaching and Learning System

i-Elevate is Oldham College's teaching, learning and quality platform. It brings
staff development, quality review, evidence, actions, audit history and
permission-scoped reporting into one application.

> **Start here:** use [DEPLOYMENT-START-HERE.md](DEPLOYMENT-START-HERE.md) for
> production deployment and [HANDOVER.md](HANDOVER.md) for ownership transfer.
> Azure is the primary production target. The previous Windows/IIS tooling is
> retained as a supported fallback.

## Main capabilities

- QA Hub reviews, evidence, dashboards, reports and review actions.
- Learning Walks, Work Scrutiny and Learning and Innovation Visits (LIV).
- Managed and self-recorded CPD, staff profiles and badges.
- Probationary observations and Elevate Learning Environment records.
- Faculty/team scoped access, action monitoring and audit history.
- Excel, PDF and Word reporting where supported by the relevant process.

## Technology

- React and TypeScript frontend in `apps/web`.
- ASP.NET Core (.NET 10) API in `apps/api`.
- Microsoft SQL Server/Azure SQL migrations in `database`.
- Azure infrastructure-as-code in `infrastructure/azure`.
- Deployment and local-development automation in `scripts`.
- Architecture, operational and reporting notes in `docs`.
- Access-control and workflow tests in `tests`.

## Local development

Prerequisites are .NET 10, Node.js 24 and SQL Server LocalDB. Verify them with:

```powershell
.\scripts\check-prerequisites.ps1
```

Start the database, API and web application:

```powershell
.\scripts\start-local.ps1
```

Open `http://127.0.0.1:5173`, then stop the local services with:

```powershell
.\scripts\stop-local.ps1
```

Use `-SkipDatabase` when LocalDB is already prepared. Use `-ResetDatabase` only
when deliberately replacing local development data.

### Development configuration

`apps/api/src/TLQS.Api/appsettings.Development.json` controls the LocalDB
connection and development identity. The development authentication scheme trusts
the configured email and must never be enabled in production.

The web application uses `VITE_API_BASE_URL`; it defaults to the local API in
development and to the current origin in a production build.

Production refuses to start unless Microsoft Entra JWT settings and a database
connection are supplied through protected configuration.

## Repository map

| Path | Purpose |
| --- | --- |
| `.github/workflows` | Continuous integration and reproducible release packaging |
| `apps/api` | API, application, domain and infrastructure projects |
| `apps/web` | React frontend and static assets |
| `database/migrations` | Ordered, forward-only production migrations |
| `database/seed` | Local/demo data only; never apply to production |
| `docs` | Architecture, data model, reporting and operating guidance |
| `infrastructure/azure` | Azure Bicep templates and parameters example |
| `modules` and `shared` | Cross-module contracts and shared definitions |
| `scripts` | Local, release, database and deployment automation |
| `tests/access-control` | Permission, workflow and reporting regression tests |

Generated packages, caches, logs, local databases and completed secret-bearing
configuration files are deliberately excluded by `.gitignore`.

## Access model

| Role | Typical access |
| --- | --- |
| Admin | Platform-wide administration and reporting |
| Teaching and Learning | College-wide teaching, learning and quality workflows |
| Director | Faculty-scoped leadership access and permitted QA access |
| Head of Faculty | Faculty records, teams, actions and dashboards |
| Programme Leader | Managed-team records, actions and dashboards |
| QA Staff | Additive QA access granted by the QA permission model |
| Tutor | Own profile, records and actions |

The server is authoritative for permissions and faculty/team scope. UI visibility
is not treated as an access-control boundary.

## Verification

Run the full release gate from a clean commit:

```powershell
.\scripts\verify-v1.ps1 -RuntimeIdentifier linux-x64
```

Useful focused commands are:

```powershell
dotnet build .\apps\api\TLQS.sln --configuration Release
dotnet test .\apps\api\TLQS.sln --configuration Release
npm ci --prefix .\apps\web
npm run build --prefix .\apps\web
```

The release gate builds both applications, runs tests and dependency audits, and
writes ignored, checksummed outputs under `.artifacts`.

## Architecture rules

- Register workflows through the platform record, action, audit and reporting engines.
- Keep Microsoft Entra ID as the identity source and local roles as application permissions.
- Enforce staff, faculty and team scope on every server-side read and mutation.
- Version form templates and review questions so historical submissions remain stable.
- Record each state change in `ops.audit_logs` in the same transaction.
- Add a new forward-only migration; never rewrite an applied database migration.

## Production

The intended target is Linux Azure App Service with Azure SQL, managed identity,
Key Vault, Blob Storage and Application Insights. Begin with
[DEPLOYMENT-START-HERE.md](DEPLOYMENT-START-HERE.md), then use the detailed
[Azure deployment reference](infrastructure/azure/README.md) and
[production readiness checklist](docs/deployment/v1-readiness.md).

The repository also retains the guarded Windows/IIS release and rollback scripts.
They are documented in
[docs/deployment/on-premises-operations.md](docs/deployment/on-premises-operations.md)
for contingency use; they are not the primary handover target.
