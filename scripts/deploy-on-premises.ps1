param(
    [string] $SettingsPath = "",
    [string] $PackagePath = "",
    [switch] $InitialDeployment,
    [switch] $DatabaseBackupConfirmed,
    [switch] $SkipDatabase,
    [switch] $AllowDirty
)

$ErrorActionPreference = "Stop"
$root = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
if ([string]::IsNullOrWhiteSpace($SettingsPath)) { $SettingsPath = Join-Path $root "deployment.settings.psd1" }
if (!(Test-Path -LiteralPath $SettingsPath -PathType Leaf)) {
    throw "Deployment settings were not found. Copy deployment.settings.example.psd1 to deployment.settings.psd1 and complete it."
}
$settings = Import-PowerShellDataFile -LiteralPath $SettingsPath
$required = @(
    "SiteName", "AppPoolName", "RuntimePrincipal", "InstallRoot", "ApplicationUrl", "SqlServer", "SqlDatabase",
    "SqlConnectionString", "DataProtectionKeyPath", "EntraTenantId", "EntraApiAudience",
    "EntraSpaClientId", "EntraApiScope", "BootstrapAdminEmail", "BootstrapAdminObjectId"
)
$missing = @($required | Where-Object {
    [string]::IsNullOrWhiteSpace([string]$settings[$_]) -or [string]$settings[$_] -match "[<>]"
})
if ($missing.Count -gt 0) { throw "Complete these deployment settings: $($missing -join ', ')." }
if (!$InitialDeployment -and !$SkipDatabase -and !$DatabaseBackupConfirmed) {
    throw "Confirm that a restorable database backup exists by adding -DatabaseBackupConfirmed."
}
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw "On-premises deployment requires Windows Server and IIS." }
if ($null -eq (Get-Module -ListAvailable -Name WebAdministration)) { throw "IIS management tools are not installed." }

$installRoot = [System.IO.Path]::GetFullPath([string]$settings.InstallRoot).TrimEnd("\", "/")
$keyPath = [System.IO.Path]::GetFullPath([string]$settings.DataProtectionKeyPath).TrimEnd("\", "/")
if ([System.IO.Path]::GetPathRoot($installRoot).TrimEnd("\") -eq $installRoot.TrimEnd("\")) { throw "InstallRoot cannot be a drive root." }
if ([System.IO.Path]::GetPathRoot($keyPath).TrimEnd("\") -eq $keyPath.TrimEnd("\")) { throw "DataProtectionKeyPath cannot be a drive root." }
if ($keyPath.StartsWith("$installRoot\releases\", [StringComparison]::OrdinalIgnoreCase)) {
    throw "DataProtectionKeyPath must be outside the versioned release directories."
}
$applicationUri = [Uri]([string]$settings.ApplicationUrl)
if (!$applicationUri.IsAbsoluteUri -or $applicationUri.Scheme -ne "https") { throw "ApplicationUrl must be an absolute HTTPS address." }
$connectionString = [string]$settings.SqlConnectionString
if ($connectionString -notmatch "(?i)(Integrated Security\s*=\s*(true|sspi)|Trusted_Connection\s*=\s*true)") {
    throw "SqlConnectionString must use Windows integrated authentication."
}
if ($connectionString -notmatch "(?i)Encrypt\s*=\s*(true|mandatory|strict)" -or $connectionString -match "(?i)TrustServerCertificate\s*=\s*true") {
    throw "SqlConnectionString must require encryption and must validate the SQL Server certificate."
}
$parsedGuid = [Guid]::Empty
foreach ($guidSetting in @("EntraTenantId", "EntraApiAudience", "EntraSpaClientId", "BootstrapAdminObjectId")) {
    if (![Guid]::TryParse([string]$settings[$guidSetting], [ref]$parsedGuid)) { throw "$guidSetting must be a GUID." }
}

Import-Module WebAdministration -ErrorAction Stop
$sitePath = "IIS:\Sites\$($settings.SiteName)"
$appPoolPath = "IIS:\AppPools\$($settings.AppPoolName)"
if (!(Test-Path $sitePath)) { throw "IIS site '$($settings.SiteName)' does not exist. Complete the one-time IIS setup in DEPLOYMENT-START-HERE.md." }
if (!(Test-Path $appPoolPath)) { throw "IIS application pool '$($settings.AppPoolName)' does not exist. Complete the one-time IIS setup first." }

if ([string]::IsNullOrWhiteSpace($PackagePath)) {
    $buildArguments = @{ SettingsPath = $SettingsPath }
    if ($AllowDirty) { $buildArguments.AllowDirty = $true }
    & (Join-Path $PSScriptRoot "new-on-premises-release.ps1") @buildArguments
    if ($LASTEXITCODE -ne 0) { throw "Release build failed with exit code $LASTEXITCODE." }
    $packageItem = Get-ChildItem (Join-Path $root ".artifacts\v1") -Filter "i-elevate-*-win-x64.zip" |
        Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    if ($null -eq $packageItem) { throw "The release build completed without creating a deployment package." }
    $PackagePath = $packageItem.FullName
}
$PackagePath = [System.IO.Path]::GetFullPath($PackagePath)
if (!(Test-Path -LiteralPath $PackagePath -PathType Leaf)) { throw "Release package was not found at '$PackagePath'." }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($PackagePath)
try {
    $entryNames = @($archive.Entries | ForEach-Object { $_.FullName.Replace("\", "/") })
    foreach ($requiredEntry in @("TLQS.Api.dll", "web.config", "wwwroot/index.html")) {
        if ($requiredEntry -notin $entryNames) { throw "Release package is invalid: '$requiredEntry' is missing." }
    }
}
finally {
    $archive.Dispose()
}

if (!$SkipDatabase) {
    $databaseArguments = @{ Server = [string]$settings.SqlServer; Database = [string]$settings.SqlDatabase }
    if (-not [bool]$settings.IncludeOfficialStaffData) { $databaseArguments.ExcludeOfficialStaffData = $true }
    & (Join-Path $PSScriptRoot "apply-database.ps1") @databaseArguments
    if ($LASTEXITCODE -ne 0) { throw "Database migration failed with exit code $LASTEXITCODE." }
    & (Join-Path $PSScriptRoot "set-bootstrap-admin.ps1") `
        -Server ([string]$settings.SqlServer) -Database ([string]$settings.SqlDatabase) `
        -Email ([string]$settings.BootstrapAdminEmail) -TenantId ([Guid]$settings.EntraTenantId) `
        -ObjectId ([Guid]$settings.BootstrapAdminObjectId)
    if ($LASTEXITCODE -ne 0) { throw "Bootstrap administrator setup failed with exit code $LASTEXITCODE." }
}

$releaseName = "release-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
$releaseRoot = Join-Path (Join-Path $installRoot "releases") $releaseName
New-Item -ItemType Directory -Force -Path $releaseRoot, $keyPath | Out-Null
Expand-Archive -LiteralPath $PackagePath -DestinationPath $releaseRoot

$configuration = [ordered]@{
    ConnectionStrings = [ordered]@{ TlqsDatabase = [string]$settings.SqlConnectionString }
    Authentication = [ordered]@{
        TenantId = [string]$settings.EntraTenantId
        Audience = [string]$settings.EntraApiAudience
        AllowDevelopmentUser = $false
    }
    DataProtection = [ordered]@{ KeyPath = $keyPath }
    Cors = [ordered]@{ AllowedOrigins = @() }
    Messaging = [ordered]@{
        Enabled = $false
        TestMode = $true
        ApplicationUrl = ([string]$settings.ApplicationUrl).TrimEnd("/")
    }
    AllowedHosts = $applicationUri.Host
}
$configuration | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $releaseRoot "appsettings.Production.json") -Encoding utf8

$runtimePrincipal = [string]$settings.RuntimePrincipal
& icacls $releaseRoot /grant "${runtimePrincipal}:(OI)(CI)RX" /T /C | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Could not grant the IIS application pool read access to '$releaseRoot'." }
& icacls $keyPath /grant "${runtimePrincipal}:(OI)(CI)M" /T /C | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Could not grant the IIS application pool access to '$keyPath'." }

$previousPath = [string](Get-ItemProperty $sitePath -Name physicalPath).physicalPath
$switched = $false
try {
    Stop-WebAppPool -Name ([string]$settings.AppPoolName) -ErrorAction SilentlyContinue
    Set-ItemProperty $sitePath -Name applicationPool -Value ([string]$settings.AppPoolName)
    Set-ItemProperty $sitePath -Name physicalPath -Value $releaseRoot
    Start-WebAppPool -Name ([string]$settings.AppPoolName)
    $switched = $true

    $healthUrl = "$(([string]$settings.ApplicationUrl).TrimEnd('/'))/health/ready"
    $deadline = (Get-Date).AddMinutes(3)
    $healthy = $false
    do {
        try {
            $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 10
            if ($health.status -eq "healthy" -and $health.database -eq "connected") {
                $healthy = $true
                break
            }
        }
        catch { Start-Sleep -Seconds 5 }
    } while ((Get-Date) -lt $deadline)
    if (!$healthy) { throw "The new release did not become healthy within three minutes." }
    Write-Host "Deployment healthy: $healthUrl" -ForegroundColor Green
    Write-Host "Previous release retained at: $previousPath"
    Write-Host "New release: $releaseRoot"
}
catch {
    if ($switched -and ![string]::IsNullOrWhiteSpace($previousPath) -and (Test-Path -LiteralPath $previousPath)) {
        Stop-WebAppPool -Name ([string]$settings.AppPoolName) -ErrorAction SilentlyContinue
        Set-ItemProperty $sitePath -Name physicalPath -Value $previousPath
        Start-WebAppPool -Name ([string]$settings.AppPoolName)
        Write-Warning "The IIS site was returned to '$previousPath'. Database migrations were not reversed."
    }
    throw
}
