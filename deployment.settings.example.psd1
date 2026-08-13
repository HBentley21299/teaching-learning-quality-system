@{
    # Copy this file to deployment.settings.psd1 and replace every value in
    # angle brackets. deployment.settings.psd1 is ignored by Git.
    ResourceGroup = "rg-ielevate-prod"
    Location = "uksouth"
    SqlLocation = "uksouth"
    EnvironmentName = "prod"
    AppName = "tlqs"

    # Microsoft Entra and Azure SQL details supplied by the college IT team.
    SqlAdministratorLogin = "<entra-sql-administrator-group-name>"
    SqlAdministratorObjectId = "<entra-sql-administrator-group-object-id>"
    SqlAdministratorPrincipalType = "Group"
    EntraTenantId = "<college-tenant-id>"
    EntraApiAudience = "<api-app-client-id>"
    EntraSpaClientId = "<spa-app-client-id>"
    EntraApiScope = "api://<api-app-client-id>/access_as_user"

    # This email must already exist as an active staff record in the deployed
    # database. The object ID must be the same person's Entra object ID.
    BootstrapAdminEmail = "<initial-administrator-college-email>"
    BootstrapAdminObjectId = "<initial-administrator-entra-object-id>"

    # Shared mailbox or distribution list monitored by the IT support team.
    OperationsAlertEmail = "<it-operations-alert-email>"

    # Set to $true only when the college has approved importing the supplied
    # official organisation/staff seed into this Azure environment.
    IncludeOfficialStaffData = $true

    # Keep email disabled for the first deployment. See the detailed handover
    # before enabling it.
    EnableMessaging = $false
    MessagingClientId = ""
    MessagingSenderAddress = ""
    MessagingReplyToAddress = ""
    MessagingTestRecipient = ""
}
