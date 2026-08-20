param(
    [string] $SettingsPath = "",
    [switch] $SkipInstall,
    [switch] $SkipSecurityAudit,
    [switch] $AllowDirty
)

$ErrorActionPreference = "Stop"
$root = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
if ([string]::IsNullOrWhiteSpace($SettingsPath)) {
    $SettingsPath = Join-Path $root "deployment.settings.psd1"
}
if (!(Test-Path -LiteralPath $SettingsPath -PathType Leaf)) {
    throw "Deployment settings were not found at '$SettingsPath'. Copy deployment.settings.example.psd1 to deployment.settings.psd1 and complete it."
}

$settings = Import-PowerShellDataFile -LiteralPath $SettingsPath
$required = @("EntraTenantId", "EntraApiAudience", "EntraSpaClientId", "EntraApiScope")
$missing = @($required | Where-Object {
    [string]::IsNullOrWhiteSpace([string]$settings[$_]) -or [string]$settings[$_] -match "[<>]"
})
if ($missing.Count -gt 0) {
    throw "Complete these deployment settings before building: $($missing -join ', ')."
}

$tenantId = [Guid]::Empty
$apiAudience = [Guid]::Empty
$spaClientId = [Guid]::Empty
if (![Guid]::TryParse([string]$settings.EntraTenantId, [ref]$tenantId)) { throw "EntraTenantId must be a GUID." }
if (![Guid]::TryParse([string]$settings.EntraApiAudience, [ref]$apiAudience)) { throw "EntraApiAudience must be the API client ID GUID." }
if (![Guid]::TryParse([string]$settings.EntraSpaClientId, [ref]$spaClientId)) { throw "EntraSpaClientId must be a GUID." }

$previousValues = @{
    VITE_API_BASE_URL = $env:VITE_API_BASE_URL
    VITE_ENTRA_CLIENT_ID = $env:VITE_ENTRA_CLIENT_ID
    VITE_ENTRA_TENANT_ID = $env:VITE_ENTRA_TENANT_ID
    VITE_ENTRA_API_SCOPE = $env:VITE_ENTRA_API_SCOPE
}
try {
    $env:VITE_API_BASE_URL = ""
    $env:VITE_ENTRA_CLIENT_ID = [string]$settings.EntraSpaClientId
    $env:VITE_ENTRA_TENANT_ID = [string]$settings.EntraTenantId
    $env:VITE_ENTRA_API_SCOPE = [string]$settings.EntraApiScope

    $verifyArguments = @{}
    if ($SkipInstall) { $verifyArguments.SkipInstall = $true }
    if ($SkipSecurityAudit) { $verifyArguments.SkipSecurityAudit = $true }
    if ($AllowDirty) { $verifyArguments.AllowDirty = $true }
    & (Join-Path $PSScriptRoot "verify-v1.ps1") @verifyArguments
    if ($LASTEXITCODE -ne 0) { throw "Release verification failed with exit code $LASTEXITCODE." }
}
finally {
    foreach ($entry in $previousValues.GetEnumerator()) {
        if ($null -eq $entry.Value) { Remove-Item -Path "Env:$($entry.Key)" -ErrorAction SilentlyContinue }
        else { Set-Item -Path "Env:$($entry.Key)" -Value $entry.Value }
    }
}

$release = Get-Content -LiteralPath (Join-Path $root ".artifacts\v1\release.json") -Raw | ConvertFrom-Json
$shortCommit = ([string]$release.gitCommit).Substring(0, 8)
$packagePath = Join-Path $root ".artifacts\v1\i-elevate-$shortCommit-win-x64.zip"
& (Join-Path $PSScriptRoot "new-deployment-package.ps1") `
    -SourceDirectory (Join-Path $root ".artifacts\v1\api") `
    -DestinationPath $packagePath
if ($LASTEXITCODE -ne 0) { throw "Packaging failed with exit code $LASTEXITCODE." }

$digest = (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Host ""
Write-Host "On-premises release is ready." -ForegroundColor Green
Write-Host "Package: $packagePath"
Write-Host "SHA256:  $digest"
