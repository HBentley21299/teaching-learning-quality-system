# Azure V1 Deployment

This runbook creates the first deployable i-Elevate Teaching and Learning System
environment. Use a non-production subscription first, then repeat for production
after acceptance testing.

## 1. Required Access And Tools

The deployment operator needs:

- Contributor and User Access Administrator on the target resource group or subscription.
- Permission to create an Azure SQL Microsoft Entra administrator.
- Azure CLI, .NET 10 SDK, Node.js 24, `sqlcmd` for LocalDB and the PowerShell
  `SqlServer` module for Azure SQL migrations.
- An Entra SQL administrator account available through the active Azure CLI session.

Install the token-capable SQL PowerShell module once for the current user:

```powershell
Install-Module SqlServer -Scope CurrentUser
```

Verify the local build before touching Azure:

```powershell
.\scripts\check-prerequisites.ps1
.\scripts\verify-v1.ps1
az login --tenant <college-tenant-id>
az account set --subscription <subscription-id>
```

## 2. Entra Applications

Create separate Entra app registrations for the API and SPA.

For the API registration:

- Record its application/client ID.
- Expose delegated scope `access_as_user`.
- Use `api://<api-client-id>` as the Application ID URI.

For the SPA registration:

- Add permission `api://<api-client-id>/access_as_user` and grant college consent.
- Record its application/client ID.
- After Azure provisioning, add the exact HTTPS application URL as a SPA redirect URI and logout URL.
- Do not add wildcard or localhost redirect URIs to the production registration.

Authentication and MFA stay in Entra. The application stores no staff passwords.

For email delivery, create a separate confidential Entra application and grant
Microsoft Graph **application** permission `Mail.Send` with administrator consent.
Restrict that application's use to the approved sender mailbox using the college's
Exchange Online application-access policy. Do not reuse the SPA or API registration.

## 3. First Deployment

Run from the repository root with a clean, committed working tree:

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
  -BootstrapAdminEmail "<existing-staff-email>" `
  -IncludeOfficialStaffData
```

For a development deployment in a personal or trial subscription, use
`-EnvironmentName dev` and do not pass `-IncludeOfficialStaffData`. Development
is the default and excludes the official curriculum staff seed. It uses the Free
App Service tier and Azure SQL's free-limit auto-pause policy. Because Free App
Service does not support VNet integration, dev uses managed identity over Azure
public service endpoints; production retains private endpoints and VNet routing.
Never import real staff or teaching and learning records into a personally owned subscription.
The current personal free-trial subscription has validated Free App Service
capacity in `ukwest`. New SQL server creation is restricted in the UK regions
for this subscription, so use `-Location ukwest -SqlLocation francecentral` for
this development environment.

The script performs these operations in order:

1. Runs Release builds, tests and dependency audits.
2. Provisions or updates `infra/azure/main.bicep`.
3. Temporarily allows only the operator's public IPv4 address to reach Azure SQL.
4. Applies checksum-tracked, forward-only SQL migrations and seeds.
5. When explicitly supplied, links the bootstrap administrator by Entra object
   ID to an existing active staff account and grants Super Admin with global scope.
6. Resolves the App Service managed identity client ID and grants its Azure SQL
   contained user `db_datareader`, `db_datawriter` and `EXECUTE`.
7. Deploys the hashed same-origin UI/API release package using portable ZIP paths.
8. Removes the temporary client firewall rule and verifies `/health/ready`.
   Production disables SQL public access; development retains the Azure-service
   endpoint required by the Free App Service tier.

The SQL lockdown is in a `finally` block and runs after failed deployments too.
Applied database scripts are recorded in `dbo.schema_migrations`; a changed
checksum is rejected instead of silently rewriting migration history.
Never use `fix-localdb.ps1`, `-Reset`, `.mdf` files or local connection strings
against Azure SQL.

## 4. GitHub Production Environment

After the first deployment succeeds, create a protected GitHub environment named
`production` with required reviewers. Add these environment variables:

| Variable | Value |
| --- | --- |
| `AZURE_CLIENT_ID` | Client ID of the GitHub OIDC deployment identity |
| `AZURE_TENANT_ID` | College tenant ID |
| `AZURE_SUBSCRIPTION_ID` | Production subscription ID |
| `AZURE_RESOURCE_GROUP` | Deployed resource group |
| `AZURE_APP_SERVICE_NAME` | Bicep output `appServiceName` |
| `PRODUCTION_URL` | Bicep output `appUrl` |
| `ENTRA_SPA_CLIENT_ID` | SPA registration client ID |
| `ENTRA_API_SCOPE` | `api://<api-client-id>/access_as_user` |

Configure a federated credential on the deployment identity for the repository's
`production` environment. Grant it only the App Service deployment permissions
needed in the production resource group. The workflow uses OIDC; do not create a
long-lived Azure client secret.

The `Deploy production` workflow is intentionally manual and protected. Its
`database_ready` approval must be checked before it will deploy. Run the full
local deployment script whenever a release includes database migrations; the
GitHub workflow deploys application releases only after the target schema is ready.

## 5. Go-Live Checks

Before importing live activity data:

- Add the exact production URL to the SPA registration and test sign-in/sign-out.
- Confirm Admin, T&L, Director, Head of Faculty, Programme Leader and Tutor accounts.
- Test faculty and team scope across dashboards, records, actions and staff profiles.
- Complete one staging workflow for every V1 module and inspect its audit history.
- Verify an Azure SQL point-in-time restore and a Blob soft-delete restore.
- Configure alerts for readiness failure, HTTP 5xx, failed sign-ins, SQL capacity and storage errors.
- Record the deployed Git commit and `.artifacts/v1/manifest.json` with release approval.

Custom DNS can be added after the default App Service URL is accepted. Register
the final DNS URL in Entra before switching users to it.

## Optional Graph Messaging

Deploy once with messaging disabled so Key Vault exists. Then store the Graph
application secret without placing it in source control or command history:

```powershell
$secret = Read-Host "Graph client secret" -AsSecureString
$credential = [pscredential]::new("unused", $secret)
az keyvault secret set `
  --vault-name "<bicep-output-keyVaultName>" `
  --name "messaging-graph-client-secret" `
  --value $credential.GetNetworkCredential().Password `
  --output none
```

Redeploy with `-EnableMessaging`, `-MessagingClientId` and
`-MessagingSenderAddress`. In development or test, also provide
`-MessagingTestRecipient`; all recipients are redirected to that safe address.
Start with one inactive template, preview it, queue a test, inspect Delivery
History, and only then activate an event rule.

If Graph delivery fails repeatedly, disable `Messaging__Enabled` immediately.
Queued items remain auditable and can be retried after configuration is corrected.
