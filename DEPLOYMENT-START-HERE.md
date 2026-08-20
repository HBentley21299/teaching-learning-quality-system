# Deploy i-Elevate on campus

This is the main deployment guide. i-Elevate runs as one website on a Windows IIS server and stores its data in the college's existing Microsoft SQL Server environment. It does not require an Azure subscription, Azure SQL, App Service, Blob Storage or Key Vault.

Staff still sign in with their college Microsoft 365 account through Microsoft Entra ID.

Some Microsoft authentication libraries retain `Azure` in their technical package name. They are used only to sign users in or send approved Microsoft 365 email and do not require Azure hosting or an Azure subscription.

## What IT provides once

1. A Windows Server with IIS and an HTTPS certificate.
2. Microsoft SQL Server 2019 or 2022 and an empty database named `iElevate`.
3. A dedicated Windows service account, preferably a group managed service account (gMSA), for the IIS application pool.
4. Two Microsoft Entra app registrations: one API registration and one single-page application registration.
5. DNS for the final address, for example `https://i-elevate.college.ac.uk`.
6. A backup location and normal monitoring for the IIS server and SQL database.

The application server and SQL Server can be separate machines. SQL Server should not be exposed to the internet.

## Software needed

On the application/deployment server install:

- IIS, including IIS Management Tools;
- the .NET 10 Hosting Bundle;
- .NET 10 SDK and Node.js 24 to build from the repository;
- Git;
- Microsoft `sqlcmd` command-line tools.

Run this check from the repository:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-prerequisites.ps1
```

## One-time setup

### 1. Prepare SQL Server

Ask the DBA to:

- create an empty `iElevate` database;
- use compatibility level 140 or later;
- create a SQL Server login for the IIS service account;
- require encrypted connections using a certificate trusted by the application server;
- configure full, differential and transaction-log backups.

From a Windows account authorised by the DBA, give the application account its runtime access:

```powershell
.\scripts\grant-on-premises-database-access.ps1 `
  -Server "<sql-server>\<instance>" `
  -Database "iElevate" `
  -RuntimePrincipal "<COLLEGE\iElevateServiceAccount$>"
```

The deployment operator uses a separate account with permission to create and alter objects in this database. The website account is not given `db_owner`.

### 2. Create the IIS website

In IIS Manager:

1. Create an application pool named `i-Elevate`.
2. Set **.NET CLR version** to **No Managed Code**.
3. Set the application pool identity to the approved service account.
4. Create a website named `i-Elevate` using that application pool.
5. Give it the final HTTPS binding and certificate.
6. Point it temporarily at an empty folder such as `C:\inetpub\i-elevate\placeholder`.

The deployment script changes the physical folder after a release passes its checks.

### 3. Create the Microsoft Entra registrations

Create two single-tenant app registrations.

**i-Elevate API**

- Under **Expose an API**, use `api://<API client ID>`.
- Add the delegated scope `access_as_user`.

**i-Elevate Web**

- Platform: **Single-page application**.
- Redirect and logout URL: the exact final HTTPS website address.
- Add delegated permission `api://<API client ID>/access_as_user`.
- Grant administrator consent.

Apply the college's normal MFA and Conditional Access policies. The website does not store staff passwords.

### 4. Complete one settings file

From the repository root:

```powershell
Copy-Item .\deployment.settings.example.psd1 .\deployment.settings.psd1
notepad .\deployment.settings.psd1
```

Replace every value containing `<angle brackets>`. The completed file is ignored by Git. With the recommended Windows database authentication it contains no SQL password, but it should still remain on the controlled deployment server.

Use the same service account for `RuntimePrincipal`, the IIS application pool identity and the SQL database user.

## First deployment

Use a clean, approved Git commit. Run PowerShell as an administrator on the IIS server, using an account that is also authorised to apply database changes:

```powershell
.\scripts\deploy-on-premises.ps1 -InitialDeployment
```

The command builds and tests the application, audits dependencies, applies tracked database migrations, links the first administrator, deploys a versioned IIS release and verifies `/health/ready` before completing.

If IT supplies a pre-built approved ZIP, use:

```powershell
.\scripts\deploy-on-premises.ps1 `
  -InitialDeployment `
  -PackagePath "D:\ApprovedReleases\i-elevate-xxxxxxxx-win-x64.zip"
```

## Acceptance check

Before opening access to staff, confirm:

- the website opens over HTTPS and Microsoft sign-in works;
- the first administrator can open Admin Centre;
- the current academic year, staff and organisation structure are correct;
- one test account at each permission level sees only its permitted teams and records;
- one record can be created and submitted for every process;
- actions, dashboards, exports and audit history work;
- an Elevate Status image can be uploaded and displayed;
- SQL and application backups are running;
- the service desk receives a test application-down alert.

Use fictitious acceptance records and remove them before launch.

## Later updates

Do not replace or reset the database. Take or verify a restorable SQL backup, check out the approved release commit, then run:

```powershell
.\scripts\deploy-on-premises.ps1 -DatabaseBackupConfirmed
```

Each update is installed in a new folder. The old application remains available for rollback and live records remain in SQL Server.

For an application-only fix with no database changes:

```powershell
.\scripts\deploy-on-premises.ps1 -SkipDatabase
```

## Roll back the application

The successful deployment prints the retained previous release path. To return IIS to it:

```powershell
.\scripts\rollback-on-premises.ps1 `
  -ReleasePath "C:\inetpub\i-elevate\releases\release-yyyyMMdd-HHmmss"
```

This changes the application files only. Database migrations are forward-only and must never be manually reversed. If data itself must be recovered, stop and use the DBA-approved database restore procedure.

## Support ownership

- **Application owner:** approved releases, application testing and user guidance.
- **MIS/DBA:** SQL permissions, backups, restores, maintenance and performance.
- **IT infrastructure:** IIS, Windows patching, DNS, certificates, firewall and monitoring.
- **Identity team:** Microsoft Entra registrations, consent, MFA and Conditional Access.
- **Product owner:** permission testing and go-live approval.

The concise production checklist is in [docs/deployment/v1-readiness.md](docs/deployment/v1-readiness.md). Email and export configuration is in [docs/deployment/messaging-and-exports.md](docs/deployment/messaging-and-exports.md).
