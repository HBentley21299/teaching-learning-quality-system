# Starting and Running the Teaching & Learning Quality System

This guide is for starting the application locally on Harry's machine.

The system has three moving parts:

- Local SQL database: `TLQS`
- API: `http://127.0.0.1:5001`
- Web app: usually `http://127.0.0.1:5173` for development

## Recommended One-Command Start

From the project folder, run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local.ps1
```

This prepares the database, starts the API and web app in the background, checks
that both are responding, and writes logs under `.localappdata\local-run\logs`.

Open:

```text
http://127.0.0.1:5173
```

Stop both services with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop-local.ps1
```

For a faster daily start when the database is already prepared:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local.ps1 -SkipDatabase
```

## 1. Open PowerShell in the Project Folder

```powershell
cd "C:\Users\Harry\OneDrive\Documents\New project 2"
```

## 2. Check the Required Tools

Run this first if the app has not been used for a while, or after installing tools.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-prerequisites.ps1
```

You need:

- .NET 10 SDK
- Node.js 24 or later
- npm
- SQL Server LocalDB or SQL Server Developer
- SQL Server command line tools / `sqlcmd`

## 3. Prepare the Local Database

For a clean local reset, run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\fix-localdb.ps1 -Reset
```

This recreates the local `TLQS` database and applies the SQL scripts.

Use this without `-Reset` when you want to start and keep the existing local database:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\fix-localdb.ps1
```

Normal startup does not reapply the foundation schema to an existing database. Important:
`-Reset` removes the local development database. Do not use it if you need to keep test records.

## 4. Start the API

Open a PowerShell window and run:

```powershell
cd "C:\Users\Harry\OneDrive\Documents\New project 2"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-api.ps1
```

Leave this window open.

The API should show:

```text
Now listening on: http://127.0.0.1:5001
```

You can check API readiness at:

```text
http://127.0.0.1:5001/health/ready
```

## 5. Start the Web App

For normal development, use the Vite development server.

Open a second PowerShell window and run:

```powershell
cd "C:\Users\Harry\OneDrive\Documents\New project 2\apps\web"
npm.cmd install --cache .\.npm-cache
npm.cmd run dev
```

Open:

```text
http://127.0.0.1:5173
```

Leave this window open.

## Alternative Web Start Script

There is also a project script:

```powershell
cd "C:\Users\Harry\OneDrive\Documents\New project 2"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-web.ps1
```

This starts the Vite development server at:

```text
http://127.0.0.1:5173
```

## 6. Normal Daily Startup

Once everything is installed and the database is ready:

PowerShell window 1:

```powershell
cd "C:\Users\Harry\OneDrive\Documents\New project 2"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-api.ps1
```

PowerShell window 2:

```powershell
cd "C:\Users\Harry\OneDrive\Documents\New project 2\apps\web"
npm.cmd run dev
```

Then open:

```text
http://127.0.0.1:5173
```

## 7. Stop the Application

In each running PowerShell window, press:

```text
Ctrl + C
```

Stop the web app and API separately.

## 8. Build and Check Before Sharing

Frontend build:

```powershell
cd "C:\Users\Harry\OneDrive\Documents\New project 2\apps\web"
npm.cmd run build
```

API build:

```powershell
cd "C:\Users\Harry\OneDrive\Documents\New project 2"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-api.ps1
```

API tests:

```powershell
cd "C:\Users\Harry\OneDrive\Documents\New project 2"
dotnet test .\apps\api\TLQS.sln
```

## 9. Useful Local URLs

| Area | URL |
| --- | --- |
| Web app development server | `http://127.0.0.1:5173` |
| Web app preview server | `http://127.0.0.1:4173` |
| API | `http://127.0.0.1:5001` |
| API liveness check | `http://127.0.0.1:5001/health/live` |
| API readiness check | `http://127.0.0.1:5001/health/ready` |

## 10. Common Problems

### The web app opens but data does not save

Check the API PowerShell window is still running and listening on `http://127.0.0.1:5001`.

Also check the database has been applied:

```powershell
cd "C:\Users\Harry\OneDrive\Documents\New project 2"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\fix-localdb.ps1
```

### The web app is blank or does not update

Stop the web app with `Ctrl + C`, then restart it:

```powershell
cd "C:\Users\Harry\OneDrive\Documents\New project 2\apps\web"
npm.cmd run dev
```

Refresh the browser.

### Port 5173 or 5001 is already in use

Close old PowerShell windows running the app, or press `Ctrl + C` in them.

Then start the API and web app again.

### LocalDB or SQL errors appear

For a clean rebuild of the local database:

```powershell
cd "C:\Users\Harry\OneDrive\Documents\New project 2"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\fix-localdb.ps1 -Reset
```

Only use `-Reset` when it is safe to remove local test data.

### PowerShell blocks a script

Use this pattern:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\SCRIPT-NAME.ps1
```

Replace `SCRIPT-NAME.ps1` with the script you want to run.

## 11. Development Login

During local development, the API uses a configured development user.

Configuration file:

```text
apps\api\src\TLQS.Api\appsettings.Development.json
```

The key setting is:

```text
Authentication:DevelopmentUserEmail
```

You can temporarily test another seeded user from PowerShell:

```powershell
$env:Authentication__DevelopmentUserEmail = "priya.nair@college.example"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-api.ps1
```

Restart the API after changing the user.

## 12. Notes Before Go-Live

- Local development authentication is not production authentication.
- Microsoft Entra ID must be used before real deployment.
- Keep `scripts\apply-database.ps1` in sync with every SQL file in `database\migrations`, `database\seed`, and `database\views`.
- Do not rely only on frontend permissions. Final permission and scope checks must run server-side.

## 13. Run the V1 Release Gate

This restores locked dependencies, runs Release builds and tests, audits
production dependencies and creates hashed deployment artifacts:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-v1.ps1
```

Outputs are written under `.artifacts\v1` and are intentionally excluded from Git.
The release command requires committed source; use `-AllowDirty` only for a
development-only verification package.
