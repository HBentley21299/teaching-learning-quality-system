# Deploy i-Elevate

Azure is the primary production target for i-Elevate. The application is deployed
as one Linux Azure App Service, backed by Azure SQL and Microsoft Entra ID.

> **Cost control:** an empty resource group does not run the application and does
> not create normal Azure usage charges. The Bicep deployment creates billable
> services. Obtain the college's technical, information-governance and cost
> approval before running it.

For detailed resource and command information, read
[`infrastructure/azure/README.md`](infrastructure/azure/README.md). Use the
[`production readiness checklist`](docs/deployment/v1-readiness.md) as the go-live
record.

## 1. Confirm ownership

Before provisioning resources, record named owners for:

- the application and release approval;
- the Azure subscription and cost centre;
- Microsoft Entra registrations and tenant consent;
- Azure SQL administration, backup and recovery;
- support monitoring and incident response;
- business acceptance and access-scope testing.

The canonical repository should be private and owned by an Oldham College GitHub
organisation, with at least two permanent college administrators.

## 2. Complete identity prerequisites

i-Elevate uses separate single-tenant registrations for the API and browser client.

The API exposes `access_as_user` under `api://<api-client-id>`. The browser client
requests that scope and must have the exact production HTTPS address registered as
a single-page application redirect URI.

Tenant administrator consent and the final redirect URI are go-live requirements.
Client secrets are not used by the browser application and must never be committed.

## 3. Verify the release

From a clean approved commit, run:

```powershell
.\scripts\verify-v1.ps1 -RuntimeIdentifier linux-x64
```

Alternatively, run the manual **Build Azure release** GitHub workflow after its
required repository variables have been configured. Retain the generated manifest,
release metadata and SHA-256 with the approved release.

## 4. Provision Azure

The subscription-level template creates the production resource group and its
managed resources:

```text
infrastructure/azure/subscription.bicep
infrastructure/azure/main.bicep
```

Copy `subscription.parameters.example.json` to a controlled location outside the
repository, replace every placeholder and validate the deployment before creation.
Supply the SQL break-glass password through the approved secret-handling process;
do not save it in source control, tickets or release notes.

The starter deployment includes Linux App Service, Azure SQL serverless, Storage,
Key Vault, Application Insights and Log Analytics in UK South. Review current Azure
pricing and policy immediately before deployment.

## 5. Prepare the database

After provisioning, connect as the nominated Microsoft Entra SQL administrator and:

1. Apply every forward-only migration with `scripts/apply-database.ps1` using
   Entra authentication.
2. Create a contained database user for the App Service managed identity.
3. Grant only the runtime permissions documented in the Azure deployment reference.
4. Link the approved bootstrap administrator with `scripts/set-bootstrap-admin.ps1`.

Never run local reset, demo seed or test-data scripts against production.

## 6. Build and deploy the application

Create a configured Linux package:

```powershell
.\scripts\new-azure-release.ps1 `
  -EntraTenantId <tenant-guid> `
  -EntraApiAudience <api-client-guid> `
  -EntraSpaClientId <spa-client-guid> `
  -EntraApiScope 'api://<api-client-guid>/access_as_user'
```

Deploy the verified package only after the billable resources exist:

```powershell
.\scripts\deploy-azure.ps1 `
  -ResourceGroupName <resource-group> `
  -WebAppName <web-app-name> `
  -ExpectedSubscriptionId <subscription-guid>
```

The deployment command verifies `/health/ready` before reporting success.

## 7. Complete go-live checks

- Register the emitted HTTPS address in the browser Entra registration.
- Complete tenant-wide administrator consent.
- Confirm sign-in, role scope, QA workflows, actions, dashboards and exports.
- Test `/health/live` and `/health/ready` from the monitoring service.
- Confirm Azure SQL restore, Key Vault/Storage access and alert routing.
- Remove temporary database firewall access used for migration.
- Remove acceptance accounts and records before staff access opens.

Production must not open until every mandatory item in
[`docs/deployment/v1-readiness.md`](docs/deployment/v1-readiness.md) is accepted.

## Alternative Windows/IIS deployment

The previous Windows/IIS scripts remain available as a contingency for an approved
on-premises hosting decision. See
[`docs/deployment/on-premises-operations.md`](docs/deployment/on-premises-operations.md)
and `scripts/deploy-on-premises.ps1`. Do not mix Azure and IIS deployment settings
or packages.
