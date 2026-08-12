# i-Elevate Teaching and Learning System

Web application for managing a college's Teaching and Learning workflows: Learning Walks, Work Scrutiny, managed and self-logged CPD, LIV (Learning and Innovation Visit) records, staff profiles, actions, audit trail and role-scoped reporting dashboards.

- React + TypeScript frontend in `apps/web`
- ASP.NET Core (.NET 10) API in `apps/api` (ADO.NET data access, no EF runtime dependency)
- SQL Server / Azure SQL schema in `database`
- Azure infrastructure templates in `infra`
- Architecture and data model notes in `docs`

## Local Setup

1. Install the .NET 10 SDK, Node.js and SQL Server LocalDB (run `.\scripts\check-prerequisites.ps1` to verify).
2. Start the database, API and web app:
   `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local.ps1`
3. Open `http://127.0.0.1:5173`.
4. Stop the local services with:
   `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop-local.ps1`

Use `-SkipDatabase` for a faster start when LocalDB is already prepared. Use
`-ResetDatabase` only when you intentionally want to delete and recreate local test data.

## Configuration

`apps/api/src/TLQS.Api/appsettings.Development.json`:

- `ConnectionStrings:TlqsDatabase` - SQL Server connection string.
- `Authentication:DevelopmentUserEmail` - the user every request runs as during development.
  Override per shell with the email address of an active local test account to test another role.

`apps/web`: `VITE_API_BASE_URL` defaults to `http://127.0.0.1:5001` in
development and the current origin in a production build.

> **Security note:** the development authentication scheme trusts the configured email.
> Production refuses to start unless Entra ID JWT settings and the database
> connection are supplied through protected environment configuration.

## How the system fits together

- Every workflow registers a row in `core.records`; module detail lives in
  `quality.activities` (+ learning walk / work scrutiny detail tables),
  `cpd.cpd_events` + `cpd.cpd_attendance`, and `quality.liv_records`.
- Managed CPD and staff self-logged external CPD use separate versioned templates but
  converge on `cpd.cpd_events` and `cpd.cpd_attendance`. Duration is normalized to
  total minutes for profile accumulation and reporting.
- Form layouts are versioned templates (`forms.*`); submissions carry a lifecycle:
  **draft -> submitted -> reopened -> submitted**, with archive available to forms managers.
  Required fields are enforced server-side at submit time.
- Actions (`quality.actions`) link to their source record, an owner and an optional subject.
  Owners can complete their own actions with a closure note; `actions.manage` is needed
  to create, edit or reopen.
- Every create, update, submit, reopen, archive and action closure writes a row to
  `ops.audit_logs` with before/after JSON.
- Access is enforced in SQL on every read: global permissions (`reports.view_all`,
  `forms.manage`, `liv.manage`) see everything; `assigned_org_units` scopes cascade to
  child org units for leaders and directors; everyone always sees records they own or
  that are about them. Drafts are visible only to their owner and forms managers.

## Roles (seeded)

| Role | Access |
| --- | --- |
| Admin (`super_admin`) | Everything, including users, permissions and template administration |
| Teaching and Learning (`teaching_learning_team`) | Teaching and learning workflows, global reporting, LIV and actions |
| Director (`director`) | Scoped reporting across assigned faculties, LIV submit |
| Head of Faculty (`head_of_faculty`) | Faculty records, team managers, actions and dashboards |
| Programme Leader (`programme_leader`) | Team records, actions and dashboards |
| Tutor (`staff`) | Own profile, records and actions |

## Useful Scripts

- `.\scripts\check-prerequisites.ps1`
- `.\scripts\start-local.ps1` / `.\scripts\stop-local.ps1`
- `.\scripts\apply-org-structure.ps1` (applies the official faculty/team hierarchy to an existing database)
- `.\scripts\build-api.ps1` / `dotnet build apps\api\TLQS.sln`
- `dotnet test apps\api\TLQS.sln`
- `.\scripts\verify-v1.ps1` (Release build, tests, dependency audits and hashed artifacts)
- `.\scripts\apply-database.ps1 -Server <server> -Database <database>`
- `.\scripts\reset-local-submission-data.ps1` (LocalDB only; clears workflow data while preserving accounts and configuration)
- `.\scripts\run-api.ps1` / `.\scripts\run-web.ps1`
- `npm run build` in `apps/web`

## Architecture Rules

- Do not add a new workflow as a disconnected table set - register it through
  `core.modules`, `core.records`, forms, actions, evidence, audit and reporting.
- Keep Entra ID as the authentication source and local roles as application permissions.
- Enforce permissions and staff/faculty scope on the server, not only in the UI.
- Version form templates so historical submissions remain readable.
- Write an `ops.audit_logs` row for every state change, inside the same transaction.

## V1 Deployment Preparation

Run the release gate locally with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-v1.ps1
```

Deployment requirements and rollback checks are maintained in
[`docs/deployment/v1-readiness.md`](docs/deployment/v1-readiness.md).

For the first Azure deployment, follow
[`docs/deployment/azure-v1.md`](docs/deployment/azure-v1.md). The guarded
`scripts/deploy-azure.ps1` command provisions infrastructure, applies database
migrations, grants the App Service managed identity database access, deploys the
same-origin UI/API package, closes temporary SQL access and checks readiness.
