# i-Elevate on Azure

The Azure deployment keeps the existing single-origin application design while
replacing IIS and on-campus SQL Server with managed Azure services in UK South.

## Resources

- Linux Azure App Service serving the React application and ASP.NET Core API.
- Azure SQL Database using the App Service system-assigned managed identity.
- Azure Blob Storage and Key Vault for encrypted ASP.NET Core data-protection keys.
- Application Insights backed by a 30-day Log Analytics workspace.
- A single resource group with consistent production and data-classification tags.

The default starter sizing is App Service Basic B1 and Azure SQL General Purpose
serverless with 0.5 minimum and 2 maximum vCores. These resources incur charges.
Free/Shared App Service tiers are not suitable for production.

## Deployment sequence

1. Sign Azure CLI into the approved Oldham College tenant and subscription.
2. Copy `subscription.parameters.example.json` outside source control, complete
   it, and supply the SQL break-glass password securely.
3. Validate the subscription deployment with `az deployment sub validate`.
4. Deploy `subscription.bicep` and retain its outputs.
5. Connect to Azure SQL as the configured Entra administrator. Apply the
   database migrations with `scripts/apply-database.ps1 -Authentication Entra`.
6. Create a contained database user for the App Service managed identity and
   grant only `db_datareader` and `db_datawriter` runtime roles.
7. Build the application with `scripts/new-azure-release.ps1`, then deploy the
   ZIP using `scripts/deploy-azure.ps1`.
8. Add the emitted HTTPS application URL to the `i-Elevate Web` SPA redirect
   URIs and complete tenant administrator consent.
9. Confirm `/health/ready`, sign-in, audit logging, data protection, backup and
   Application Insights telemetry before removing the temporary SQL firewall rule.

Never commit a completed parameters file, SQL administrator password, access
token, deployment ZIP or exported production data.
