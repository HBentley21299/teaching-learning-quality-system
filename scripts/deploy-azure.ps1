param(
    [Parameter(Mandatory = $true)]
    [string] $ResourceGroup,

    [Parameter(Mandatory = $true)]
    [string] $Location,

    [string] $SqlLocation,

    [Parameter(Mandatory = $true)]
    [string] $SqlAdministratorLogin,

    [Parameter(Mandatory = $true)]
    [string] $SqlAdministratorObjectId,

    [Parameter(Mandatory = $true)]
    [string] $EntraApiAudience,

    [Parameter(Mandatory = $true)]
    [string] $EntraSpaClientId,

    [Parameter(Mandatory = $true)]
    [string] $EntraApiScope,

    [string] $EntraTenantId,
    [switch] $EnableMessaging,
    [string] $MessagingClientId,
    [string] $MessagingSenderAddress,
    [string] $MessagingReplyToAddress,
    [string] $MessagingTestRecipient,
    [string] $BootstrapAdminObjectId,
    [string] $BootstrapAdminEmail,
    [ValidateSet("Group", "User")]
    [string] $SqlAdministratorPrincipalType = "Group",
    [ValidateSet("dev", "test", "prod")]
    [string] $EnvironmentName = "dev",
    [string] $AppName = "tlqs",
    [switch] $IncludeOfficialStaffData,
    [switch] $AllowDirty,
    [switch] $SkipSecurityAudit
)

$ErrorActionPreference = "Stop"
$root = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$template = Join-Path $root "infra\azure\main.bicep"
$artifactRoot = Join-Path $root ".artifacts\v1"
$apiArtifact = Join-Path $artifactRoot "api"
$zipArtifact = Join-Path $artifactRoot "tlqs-v1.zip"
$migrationAccessOpened = $false
$sqlServerName = $null

if ($EnableMessaging -and ([string]::IsNullOrWhiteSpace($MessagingClientId) -or [string]::IsNullOrWhiteSpace($MessagingSenderAddress))) {
    throw "MessagingClientId and MessagingSenderAddress are required when EnableMessaging is selected."
}
if ($EnableMessaging -and $EnvironmentName -ne "prod" -and [string]::IsNullOrWhiteSpace($MessagingTestRecipient)) {
    throw "MessagingTestRecipient is required when messaging is enabled outside production."
}

function Assert-Command {
    param([string] $Name)
    if ($null -eq (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "$Name is required but was not found on PATH."
    }
}

function Invoke-Native {
    param(
        [string] $Name,
        [scriptblock] $Action
    )
    Write-Host ""
    Write-Host "==> $Name" -ForegroundColor Cyan
    & $Action
    if ($LASTEXITCODE -ne 0) {
        throw "$Name failed with exit code $LASTEXITCODE."
    }
}

function Convert-GuidToSidHex {
    param([string] $Identifier)
    $bytes = ([Guid] $Identifier).ToByteArray()
    return "0x" + (($bytes | ForEach-Object { $_.ToString("x2") }) -join "")
}

function Get-ServicePrincipalClientId {
    param(
        [Parameter(Mandatory = $true)]
        [string] $ObjectId,

        [int] $TimeoutSeconds = 120
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $clientId = ((@(& az ad sp show `
            --id $ObjectId `
            --query appId `
            --output tsv 2>$null) -join "").Trim())
        $parsedClientId = [Guid]::Empty
        if ($LASTEXITCODE -eq 0 -and [Guid]::TryParse($clientId, [ref] $parsedClientId)) {
            return $parsedClientId.ToString()
        }
        Start-Sleep -Seconds 5
    } while ((Get-Date) -lt $deadline)

    throw "Could not resolve the App Service managed identity client ID from Entra within $TimeoutSeconds seconds."
}

function Get-AzureSqlAccessToken {
    $token = ((@(& az account get-access-token `
        --resource "https://database.windows.net/" `
        --query accessToken `
        --output tsv) -join "").Trim())
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($token)) {
        throw "Azure CLI could not acquire an Azure SQL access token. Run 'az login' and try again."
    }
    return $token
}

function New-PortableZip {
    param(
        [Parameter(Mandatory = $true)]
        [string] $SourceDirectory,

        [Parameter(Mandatory = $true)]
        [string] $DestinationPath
    )

    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem

    $source = [System.IO.Path]::GetFullPath($SourceDirectory).TrimEnd("\", "/")
    if (!(Test-Path -LiteralPath $source -PathType Container)) {
        throw "Package source directory was not found: $source"
    }
    if (Test-Path -LiteralPath $DestinationPath) {
        Remove-Item -LiteralPath $DestinationPath -Force
    }

    $files = @(Get-ChildItem -LiteralPath $source -Recurse -File)
    if ($files.Count -eq 0) {
        throw "Package source directory is empty: $source"
    }

    $stream = [System.IO.File]::Open($DestinationPath, [System.IO.FileMode]::CreateNew)
    try {
        $archive = New-Object System.IO.Compression.ZipArchive(
            $stream,
            [System.IO.Compression.ZipArchiveMode]::Create,
            $false
        )
        try {
            foreach ($file in $files) {
                $entryName = $file.FullName.Substring($source.Length + 1).Replace("\", "/")
                [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                    $archive,
                    $file.FullName,
                    $entryName,
                    [System.IO.Compression.CompressionLevel]::Optimal
                ) | Out-Null
            }
        }
        finally {
            $archive.Dispose()
        }
    }
    finally {
        $stream.Dispose()
    }
}

function Wait-ForHealthyApp {
    param(
        [string] $Url,
        [int] $TimeoutSeconds = 180
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        try {
            $response = Invoke-RestMethod -Uri "$Url/health/ready" -TimeoutSec 10
            if ($response.status -eq "healthy" -and $response.database -eq "connected") {
                return
            }
        }
        catch {
            Start-Sleep -Seconds 5
        }
    } while ((Get-Date) -lt $deadline)

    throw "The deployed application did not become healthy within $TimeoutSeconds seconds."
}

Assert-Command "az"
Assert-Command "dotnet"
Assert-Command "npm.cmd"

if ($null -eq (Get-Command "Invoke-Sqlcmd" -ErrorAction SilentlyContinue)) {
    try {
        Import-Module SqlServer -ErrorAction Stop
    }
    catch {
        throw "The SqlServer PowerShell module is required for token-based Azure SQL deployment. Install it with 'Install-Module SqlServer -Scope CurrentUser'."
    }
}

if ([string]::IsNullOrWhiteSpace($EntraTenantId)) {
    $EntraTenantId = (& az account show --query tenantId -o tsv).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($EntraTenantId)) {
        throw "No Azure session was found. Run 'az login' and try again."
    }
}
$parsedEntraTenantId = [Guid]::Empty
if (![Guid]::TryParse($EntraTenantId, [ref] $parsedEntraTenantId)) {
    throw "EntraTenantId must be a valid tenant ID."
}
$EntraTenantId = $parsedEntraTenantId.ToString()

$hasBootstrapAdminObjectId = ![string]::IsNullOrWhiteSpace($BootstrapAdminObjectId)
$hasBootstrapAdminEmail = ![string]::IsNullOrWhiteSpace($BootstrapAdminEmail)
if ($hasBootstrapAdminObjectId -ne $hasBootstrapAdminEmail) {
    throw "BootstrapAdminObjectId and BootstrapAdminEmail must be supplied together."
}
if ($hasBootstrapAdminObjectId) {
    $parsedBootstrapAdminObjectId = [Guid]::Empty
    if (![Guid]::TryParse($BootstrapAdminObjectId, [ref] $parsedBootstrapAdminObjectId)) {
        throw "BootstrapAdminObjectId must be a valid Entra object ID."
    }
    $BootstrapAdminObjectId = $parsedBootstrapAdminObjectId.ToString()
}

if ([string]::IsNullOrWhiteSpace($SqlLocation)) {
    $SqlLocation = $Location
}

$migrationClientIp = (Invoke-RestMethod -Uri "https://api.ipify.org").Trim()
if ($migrationClientIp -notmatch '^\d{1,3}(\.\d{1,3}){3}$') {
    throw "Could not determine a valid public IPv4 address for temporary SQL migration access."
}

$env:VITE_API_BASE_URL = ""
$env:VITE_ENTRA_CLIENT_ID = $EntraSpaClientId
$env:VITE_ENTRA_TENANT_ID = $EntraTenantId
$env:VITE_ENTRA_API_SCOPE = $EntraApiScope

$verifyArguments = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", (Join-Path $PSScriptRoot "verify-v1.ps1")
)
if ($AllowDirty) { $verifyArguments += "-AllowDirty" }
if ($SkipSecurityAudit) { $verifyArguments += "-SkipSecurityAudit" }

Invoke-Native "Build and verify the V1 release" {
    & powershell.exe @verifyArguments
}

$existingResourceGroupLocation = ((@(& az group show `
    --name $ResourceGroup `
    --query location `
    --output tsv 2>$null) -join "").Trim())

if ([string]::IsNullOrWhiteSpace($existingResourceGroupLocation)) {
    Invoke-Native "Create the Azure resource group" {
        az group create --name $ResourceGroup --location $Location --output none
    }
}
else {
    Write-Host ""
    Write-Host "==> Reuse Azure resource group $ResourceGroup ($existingResourceGroupLocation)" -ForegroundColor Cyan
}

try {
    Write-Host ""
    Write-Host "==> Provision Azure infrastructure" -ForegroundColor Cyan
    # From this point onward the template may have opened the migration rule,
    # even if a later Azure resource fails. The finally block must always audit
    # and close SQL public access.
    $migrationAccessOpened = $true
    $deploymentJson = & az deployment group create `
        --resource-group $ResourceGroup `
        --name "tlqs-$EnvironmentName-$(Get-Date -Format 'yyyyMMddHHmmss')" `
        --template-file $template `
        --parameters `
            environmentName=$EnvironmentName `
            location=$Location `
            sqlLocation=$SqlLocation `
            appName=$AppName `
            sqlAdministratorLogin=$SqlAdministratorLogin `
            sqlAdministratorObjectId=$SqlAdministratorObjectId `
            sqlAdministratorPrincipalType=$SqlAdministratorPrincipalType `
            entraTenantId=$EntraTenantId `
            entraApiAudience=$EntraApiAudience `
            messagingEnabled=$($EnableMessaging.IsPresent.ToString().ToLowerInvariant()) `
            messagingClientId=$MessagingClientId `
            messagingSenderAddress=$MessagingSenderAddress `
            messagingReplyToAddress=$MessagingReplyToAddress `
            messagingTestRecipient=$MessagingTestRecipient `
            enableSqlMigrationAccess=true `
            migrationClientIp=$migrationClientIp `
        --output json
    if ($LASTEXITCODE -ne 0) {
        throw "Azure infrastructure deployment failed."
    }

    $deployment = $deploymentJson | ConvertFrom-Json
    $outputs = $deployment.properties.outputs
    $appServiceName = $outputs.appServiceName.value
    $appUrl = $outputs.appUrl.value.TrimEnd("/")
    $appIdentityObjectId = $outputs.appManagedIdentityObjectId.value
    $appIdentityClientId = Get-ServicePrincipalClientId -ObjectId $appIdentityObjectId
    $sqlServerName = $outputs.sqlServerName.value
    $sqlServerFqdn = $outputs.sqlServerFqdn.value
    $sqlDatabaseName = $outputs.sqlDatabaseName.value
    Invoke-Native "Apply forward-only database migrations" {
        $databaseArguments = @{
            Server = $sqlServerFqdn
            Database = $sqlDatabaseName
            UseAzureAuthentication = $true
            ExcludeOfficialStaffData = !$IncludeOfficialStaffData
        }
        & (Join-Path $PSScriptRoot "apply-database.ps1") @databaseArguments
        if ($LASTEXITCODE -ne 0) {
            throw "Database migration failed with exit code $LASTEXITCODE."
        }
    }

    $databaseAccessToken = Get-AzureSqlAccessToken
    if ($hasBootstrapAdminObjectId) {
        $escapedBootstrapAdminEmail = $BootstrapAdminEmail.Replace("'", "''")
        $bootstrapSql = @"
DECLARE @UserAccountId uniqueidentifier = (
    SELECT account.id
    FROM auth.user_accounts account
    JOIN people.staff staff ON staff.id = account.staff_id
    WHERE LOWER(staff.email) = LOWER(N'$escapedBootstrapAdminEmail')
      AND staff.archived_at IS NULL
      AND staff.account_status = N'active'
      AND account.archived_at IS NULL
      AND account.account_status = N'active'
      AND account.is_disabled = 0
);
IF @UserAccountId IS NULL
    THROW 50002, 'The bootstrap administrator email does not match an active staff account.', 1;
IF EXISTS (
    SELECT 1
    FROM auth.auth_identities
    WHERE provider = N'entra'
      AND tenant_id = '$EntraTenantId'
      AND provider_subject_id = N'$BootstrapAdminObjectId'
      AND user_account_id <> @UserAccountId
)
    THROW 50003, 'The bootstrap Entra identity is already linked to another account.', 1;
IF EXISTS (
    SELECT 1
    FROM auth.auth_identities
    WHERE provider = N'entra'
      AND tenant_id = '$EntraTenantId'
      AND provider_subject_id = N'$BootstrapAdminObjectId'
      AND user_account_id = @UserAccountId
)
BEGIN
    UPDATE auth.auth_identities
    SET email_claim = N'$escapedBootstrapAdminEmail',
        updated_at = sysutcdatetime(),
        archived_at = NULL
    WHERE provider = N'entra'
      AND tenant_id = '$EntraTenantId'
      AND provider_subject_id = N'$BootstrapAdminObjectId'
      AND user_account_id = @UserAccountId;
END;
ELSE
BEGIN
    INSERT INTO auth.auth_identities (
        user_account_id, provider, tenant_id, provider_subject_id, email_claim
    )
    VALUES (
        @UserAccountId, N'entra', '$EntraTenantId', N'$BootstrapAdminObjectId', N'$escapedBootstrapAdminEmail'
    );
END;
IF NOT EXISTS (
    SELECT 1
    FROM auth.user_roles user_role
    JOIN auth.roles role ON role.id = user_role.role_id
    WHERE user_role.user_account_id = @UserAccountId
      AND role.role_key = N'super_admin'
      AND user_role.active_from <= sysutcdatetime()
      AND (user_role.active_to IS NULL OR user_role.active_to > sysutcdatetime())
)
BEGIN
    INSERT INTO auth.user_roles (user_account_id, role_id, assignment_source)
    SELECT @UserAccountId, id, N'deployment_bootstrap'
    FROM auth.roles
    WHERE role_key = N'super_admin' AND archived_at IS NULL;
END;
IF NOT EXISTS (
    SELECT 1
    FROM auth.access_scopes
    WHERE user_account_id = @UserAccountId
      AND scope_type = N'global'
      AND is_active = 1
      AND archived_at IS NULL
)
BEGIN
    INSERT INTO auth.access_scopes (user_account_id, scope_type, assignment_source)
    VALUES (@UserAccountId, N'global', N'deployment_bootstrap');
END;
"@

        Write-Host ""
        Write-Host "==> Bind the explicit bootstrap administrator Entra identity" -ForegroundColor Cyan
        Invoke-Sqlcmd `
            -ServerInstance $sqlServerFqdn `
            -Database $sqlDatabaseName `
            -AccessToken $databaseAccessToken `
            -Query $bootstrapSql `
            -AbortOnError `
            -ErrorAction Stop | Out-Null
    }

    $escapedIdentityName = $appServiceName.Replace("]", "]]" )
    # Azure SQL matches a service principal token to its application/client ID,
    # not the service principal object ID returned by the App Service resource.
    $identitySid = Convert-GuidToSidHex $appIdentityClientId
    $grantSql = @"
IF EXISTS (
    SELECT 1
    FROM sys.database_principals
    WHERE sid = $identitySid AND name <> N'$escapedIdentityName'
)
    THROW 50001, 'The managed identity client ID is already mapped to another database principal.', 1;
IF EXISTS (
    SELECT 1
    FROM sys.database_principals
    WHERE name = N'$escapedIdentityName' AND sid <> $identitySid
)
    DROP USER [$escapedIdentityName];
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE sid = $identitySid)
    CREATE USER [$escapedIdentityName] WITH SID = $identitySid, TYPE = E;
IF NOT EXISTS (
    SELECT 1
    FROM sys.database_role_members membership
    JOIN sys.database_principals role ON role.principal_id = membership.role_principal_id
    JOIN sys.database_principals member ON member.principal_id = membership.member_principal_id
    WHERE role.name = N'db_datareader' AND member.sid = $identitySid
)
    ALTER ROLE db_datareader ADD MEMBER [$escapedIdentityName];
IF NOT EXISTS (
    SELECT 1
    FROM sys.database_role_members membership
    JOIN sys.database_principals role ON role.principal_id = membership.role_principal_id
    JOIN sys.database_principals member ON member.principal_id = membership.member_principal_id
    WHERE role.name = N'db_datawriter' AND member.sid = $identitySid
)
    ALTER ROLE db_datawriter ADD MEMBER [$escapedIdentityName];
GRANT EXECUTE TO [$escapedIdentityName];
"@

    Write-Host ""
    Write-Host "==> Grant the App Service managed identity least-privilege database access" -ForegroundColor Cyan
    Invoke-Sqlcmd `
        -ServerInstance $sqlServerFqdn `
        -Database $sqlDatabaseName `
        -AccessToken $databaseAccessToken `
        -Query $grantSql `
        -AbortOnError `
        -ErrorAction Stop | Out-Null

    New-PortableZip -SourceDirectory $apiArtifact -DestinationPath $zipArtifact

    Invoke-Native "Deploy the verified application package" {
        az webapp deploy `
            --resource-group $ResourceGroup `
            --name $appServiceName `
            --src-path $zipArtifact `
            --type zip `
            --clean true `
            --restart true `
            --output none
    }
}
finally {
    if ($migrationAccessOpened -and [string]::IsNullOrWhiteSpace($sqlServerName)) {
        $sqlServerName = ((@(& az sql server list `
            --resource-group $ResourceGroup `
            --query "[?tags.application=='$AppName' && tags.environment=='$EnvironmentName'].name | [0]" `
            --output tsv 2>$null) -join "").Trim())
    }
    if ($migrationAccessOpened -and ![string]::IsNullOrWhiteSpace($sqlServerName)) {
        Write-Host ""
        Write-Host "==> Close temporary SQL migration access" -ForegroundColor Cyan
        & az sql server firewall-rule delete `
            --resource-group $ResourceGroup `
            --server $sqlServerName `
            --name "temporary-migration-client" `
            --output none 2>$null
        $publicNetworkEnabled = if ($EnvironmentName -eq "prod") { "false" } else { "true" }
        & az sql server update `
            --resource-group $ResourceGroup `
            --name $sqlServerName `
            --enable-public-network $publicNetworkEnabled `
            --output none
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "Automatic SQL network lockdown failed. Disable public network access on $sqlServerName immediately."
        }
    }
}

Wait-ForHealthyApp -Url $appUrl

Write-Host ""
Write-Host "V1 deployment completed and passed its readiness check." -ForegroundColor Green
Write-Host "Application: $appUrl"
Write-Host "Health:      $appUrl/health/ready"
Write-Host "Resource group: $ResourceGroup"
