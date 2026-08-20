@{
    # Copy this file to deployment.settings.psd1 and replace every value in
    # angle brackets. The completed file is ignored by Git.

    # Existing IIS site and application pool on the Windows application server.
    SiteName = "i-Elevate"
    AppPoolName = "i-Elevate"
    RuntimePrincipal = "<COLLEGE\iElevateServiceAccount$>"
    InstallRoot = "C:\inetpub\i-elevate"
    ApplicationUrl = "https://<i-elevate-college-address>"

    # Existing on-campus Microsoft SQL Server database. Windows integrated
    # authentication is strongly recommended; no database password is required.
    SqlServer = "<sql-server>\<instance>"
    SqlDatabase = "iElevate"
    SqlConnectionString = "Server=<sql-server>\<instance>;Database=iElevate;Integrated Security=True;Encrypt=True;TrustServerCertificate=False;MultipleActiveResultSets=True;Application Name=i-Elevate"

    # Persistent, access-controlled folder on the application server. The
    # deployment script grants the runtime service account access to this folder.
    DataProtectionKeyPath = "C:\ProgramData\i-Elevate\DataProtection-Keys"

    # Microsoft Entra application registrations supplied by the identity team.
    EntraTenantId = "<college-tenant-id>"
    EntraApiAudience = "<api-app-client-id>"
    EntraSpaClientId = "<spa-app-client-id>"
    EntraApiScope = "api://<api-app-client-id>/access_as_user"

    # This email must exist as an active staff account in the database. The
    # object ID is that person's Microsoft Entra object ID.
    BootstrapAdminEmail = "<initial-administrator-college-email>"
    BootstrapAdminObjectId = "<initial-administrator-entra-object-id>"

    # Set to $true only when the supplied college organisation/staff seed is the
    # approved production starting dataset.
    IncludeOfficialStaffData = $true
}
