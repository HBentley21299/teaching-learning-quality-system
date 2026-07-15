param(
    [Parameter(Mandatory = $true)]
    [string] $ResourceGroup,

    [Parameter(Mandatory = $true)]
    [string] $Location,

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
    [string] $SqlAdministratorUserName,
    [ValidateSet("Group", "User")]
    [string] $SqlAdministratorPrincipalType = "Group",
    [ValidateSet("dev", "test", "prod")]
    [string] $EnvironmentName = "dev",
    [string] $AppName = "tlqs",
    [string] $SqlCmd = "sqlcmd",
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
    param([string] $ObjectId)
    $bytes = ([Guid] $ObjectId).ToByteArray()
    return "0x" + (($bytes | ForEach-Object { $_.ToString("x2") }) -join "")
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
Assert-Command $SqlCmd
Assert-Command "dotnet"
Assert-Command "npm.cmd"

if ([string]::IsNullOrWhiteSpace($EntraTenantId)) {
    $EntraTenantId = (& az account show --query tenantId -o tsv).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($EntraTenantId)) {
        throw "No Azure session was found. Run 'az login' and try again."
    }
}

if ([string]::IsNullOrWhiteSpace($SqlAdministratorUserName)) {
    $SqlAdministratorUserName = ((@(& az account show --query user.name --output tsv) -join "").Trim())
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
            appName=$AppName `
            sqlAdministratorLogin=$SqlAdministratorLogin `
            sqlAdministratorObjectId=$SqlAdministratorObjectId `
            sqlAdministratorPrincipalType=$SqlAdministratorPrincipalType `
            entraTenantId=$EntraTenantId `
            entraApiAudience=$EntraApiAudience `
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
    $sqlServerName = $outputs.sqlServerName.value
    $sqlServerFqdn = $outputs.sqlServerFqdn.value
    $sqlDatabaseName = $outputs.sqlDatabaseName.value
    Invoke-Native "Apply forward-only database migrations" {
        $databaseArguments = @{
            Server = $sqlServerFqdn
            Database = $sqlDatabaseName
            SqlCmd = $SqlCmd
            UseAzureAuthentication = $true
            AzureUserName = $SqlAdministratorUserName
            ExcludeOfficialStaffData = !$IncludeOfficialStaffData
        }
        & (Join-Path $PSScriptRoot "apply-database.ps1") @databaseArguments
        if ($LASTEXITCODE -ne 0) {
            throw "Database migration failed with exit code $LASTEXITCODE."
        }
    }

    $escapedIdentityName = $appServiceName.Replace("]", "]]" )
    $identitySid = Convert-GuidToSidHex $appIdentityObjectId
    $grantSql = @"
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

    Invoke-Native "Grant the App Service managed identity least-privilege database access" {
        $grantAuthenticationArguments = if ([string]::IsNullOrWhiteSpace($SqlAdministratorUserName)) {
            @("-G")
        }
        else {
            @("-G", "-U", $SqlAdministratorUserName)
        }
        & $SqlCmd -S $sqlServerFqdn -d $sqlDatabaseName @grantAuthenticationArguments -b -Q $grantSql
    }

    if (Test-Path -LiteralPath $zipArtifact) {
        Remove-Item -LiteralPath $zipArtifact -Force
    }
    Compress-Archive -Path (Join-Path $apiArtifact "*") -DestinationPath $zipArtifact -CompressionLevel Optimal

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
