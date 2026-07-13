# Teaching & Learning Quality System

Web application for managing a college's Teaching & Learning workflows: Learning Walks, Work Scrutiny, CPD events and attendance, LIV (Learning Improvement Visit) records, staff profiles, actions, audit trail and role-scoped reporting dashboards.

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

- `ConnectionStrings:TlqsDatabase` — SQL Server connection string.
- `Authentication:DevelopmentUserEmail` — the user every request runs as during development.
  Override per shell with `$env:Authentication__DevelopmentUserEmail = "priya.nair@college.example"`
  to test other roles (see `database/seed/002_seed_demo.sql` for demo accounts).

`apps/web`: `VITE_API_BASE_URL` (defaults to `http://127.0.0.1:5001`).

> **Security note:** the development authentication scheme trusts the configured email.
> Entra ID (JWT bearer) must replace it before any real deployment.

## How the system fits together

- Every workflow registers a row in `core.records`; module detail lives in
  `quality.activities` (+ learning walk / work scrutiny detail tables),
  `cpd.cpd_events` + `cpd.cpd_attendance`, and `quality.liv_records`.
- Form layouts are versioned templates (`forms.*`); submissions carry a lifecycle:
  **draft → submitted → reopened → submitted**, with archive available to forms managers.
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
| `super_admin` | Everything, including users, permissions and template admin |
| `teaching_learning_team` | All forms and all reporting, LIV manage |
| `director` | Scoped reporting across assigned faculties, LIV submit |
| `leader_manager` | Forms and dashboards restricted to assigned org units (faculty or child code) |
| `staff` | Own profile, own actions (can complete with closure note), LIV records about them |

## Useful Scripts

- `.\scripts\check-prerequisites.ps1`
- `.\scripts\start-local.ps1` / `.\scripts\stop-local.ps1`
- `.\scripts\apply-org-structure.ps1` (applies the official faculty/team hierarchy to an existing database)
- `.\scripts\build-api.ps1` / `dotnet build apps\api\TLQS.sln`
- `dotnet test apps\api\TLQS.sln`
- `.\scripts\apply-database.ps1 -Server <server> -Database <database>`
- `.\scripts\run-api.ps1` / `.\scripts\run-web.ps1`
- `npm run build` in `apps/web`

## Architecture Rules

- Do not add a new workflow as a disconnected table set — register it through
  `core.modules`, `core.records`, forms, actions, evidence, audit and reporting.
- Keep Entra ID as the authentication source and local roles as application permissions.
- Enforce permissions and staff/faculty scope on the server, not only in the UI.
- Version form templates so historical submissions remain readable.
- Write an `ops.audit_logs` row for every state change, inside the same transaction.
