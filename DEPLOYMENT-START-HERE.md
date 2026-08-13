# Deploying i-Elevate: start here

This is the short handover guide for the college IT team. The repository already contains the Azure infrastructure, database migrations, release checks and deployment automation.

## What the deployment creates

One command provisions and configures:

- the i-Elevate website and API on Linux Azure App Service;
- a separate production staging slot for safe releases and rollback;
- Azure SQL Database;
- a production virtual network and private SQL/Blob endpoints;
- protected Blob Storage;
- Key Vault;
- Application Insights, Log Analytics and baseline operational email alerts;
- managed identities and least-privilege runtime access.

Production authentication uses college Microsoft 365 accounts through Microsoft Entra ID. No production passwords are stored by i-Elevate.

## Before starting

IT needs:

1. An Azure subscription and permission to create resources and role assignments.
2. An Entra group to administer Azure SQL.
3. An Entra API app registration.
4. An Entra browser/SPA app registration.
5. The object ID and college email of the initial i-Elevate administrator.
6. An approved, clean Git commit—not an uncommitted working folder.

Install on the deployment workstation:

- Git;
- Azure CLI;
- .NET 10 SDK;
- Node.js 24;
- PowerShell `SqlServer` module:

```powershell
Install-Module SqlServer -Scope CurrentUser
```

## Entra setup in plain English

Create two app registrations in the college tenant.

### 1. API registration

- Name: `i-Elevate API`.
- Supported account type: this organisation only.
- Under **Expose an API**, set the Application ID URI to `api://<API client ID>`.
- Add delegated scope `access_as_user`.
- Record the API client ID.

### 2. Browser registration

- Name: `i-Elevate Web`.
- Platform: **Single-page application**.
- Add delegated permission `api://<API client ID>/access_as_user`.
- Grant administrator consent.
- After the first Azure provisioning run, add both URLs as SPA redirect/logout URLs:
  - `https://<app-name>.azurewebsites.net`
  - `https://<app-name>-staging.azurewebsites.net`

Replace `<app-name>` with the App Service name printed by deployment. Add the final custom-domain URL later if one is used. Do not add wildcard or localhost URLs to production.

## Deploy in four steps

### Step 1: get the approved repository

```powershell
git clone <repository-url>
cd <repository-folder>
git status --short
```

`git status --short` must return nothing.

### Step 2: fill in one settings file

```powershell
Copy-Item .\deployment.settings.example.psd1 .\deployment.settings.psd1
notepad .\deployment.settings.psd1
```

Replace every value inside `<angle brackets>`. The completed file is ignored by Git. Do not email or commit it.

### Step 3: sign in to Azure

```powershell
az login --tenant <college-tenant-id>
az account set --subscription <subscription-id>
```

Confirm the displayed subscription before continuing:

```powershell
az account show --output table
```

### Step 4: deploy

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\invoke-azure-deployment.ps1
```

The command will:

1. Reject missing settings or uncommitted source changes.
2. Build and test the release.
3. Audit production dependencies.
4. Provision/update Azure resources.
5. Temporarily allow only the operator's public IP to run migrations.
6. Apply tracked forward-only database migrations.
7. Configure the initial administrator and managed identities.
8. Deploy to the staging slot and check its health.
9. Swap the healthy release into production.
10. Close temporary SQL access and check production health.

Allow approximately 20–40 minutes for the first run. If the script stops, read the final error, correct the stated item and run the same command again. The infrastructure and migrations are designed to be repeatable.

## First sign-in and acceptance check

Open the production URL printed by the script and sign in as the bootstrap administrator.

Before inviting staff, verify:

- the academic year is correct;
- staff and organisation data are correct;
- one test account at each required permission level sees only its intended menus/data;
- a draft and submitted record can be created for every process;
- faculty/team dashboard filters and record links work;
- exports open correctly;
- audit history is created;
- uploaded Elevate Status artwork displays on dashboards and profiles.

Use fictitious acceptance records and remove them before launch.

## Releasing a later version

Use the protected GitHub `production` environment, or rerun the same deployment command from a clean checkout of the newly approved commit. Production packages go to the staging slot first and are swapped live only after the readiness endpoint succeeds.

## Emergency rollback

After a successful deployment, the previous production build remains in the staging slot. To swap it back:

```powershell
.\scripts\rollback-azure-slot.ps1 `
  -ResourceGroup "rg-ielevate-prod" `
  -AppServiceName "<app-service-name>"
```

The rollback script checks that the old slot is healthy before changing production, then checks production again afterward. Database migrations are forward-only; do not manually reverse them.

## Items IT still owns

These cannot safely be guessed by the application developer:

- the Azure subscription, production region and budget;
- Entra registrations, consent, MFA and Conditional Access;
- custom domain, DNS and certificate;
- alert recipients and operational support rota;
- agreed backup recovery point/time and SQL long-term retention;
- whether Key Vault needs a private endpoint under college policy;
- information-governance approval for staff data;
- whether general evidence-file attachments are required at launch.

The comprehensive configuration, security and operational checklist is in [docs/deployment/azure-it-handover.md](docs/deployment/azure-it-handover.md).
