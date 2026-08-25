param(
    [Parameter(Mandatory = $true)][Guid] $EntraTenantId,
    [Parameter(Mandatory = $true)][Guid] $EntraApiAudience,
    [Parameter(Mandatory = $true)][Guid] $EntraSpaClientId,
    [Parameter(Mandatory = $true)][string] $EntraApiScope,
    [switch] $SkipInstall,
    [switch] $SkipSecurityAudit,
    [switch] $AllowDirty
)

$ErrorActionPreference = "Stop"
$root = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$artifactRoot = [System.IO.Path]::GetFullPath((Join-Path $root ".artifacts\azure"))
$packagePath = Join-Path $artifactRoot "i-elevate-linux-x64.zip"

if (!$artifactRoot.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "The Azure artifact directory resolved outside the repository."
}
if ($EntraApiScope -ne "api://$EntraApiAudience/access_as_user") {
    throw "EntraApiScope must match the API audience and access_as_user scope."
}

$previousValues = @{
    VITE_API_BASE_URL = $env:VITE_API_BASE_URL
    VITE_ENTRA_CLIENT_ID = $env:VITE_ENTRA_CLIENT_ID
    VITE_ENTRA_TENANT_ID = $env:VITE_ENTRA_TENANT_ID
    VITE_ENTRA_API_SCOPE = $env:VITE_ENTRA_API_SCOPE
}

try {
    $env:VITE_API_BASE_URL = ""
    $env:VITE_ENTRA_CLIENT_ID = [string]$EntraSpaClientId
    $env:VITE_ENTRA_TENANT_ID = [string]$EntraTenantId
    $env:VITE_ENTRA_API_SCOPE = $EntraApiScope

    $verifyArguments = @{ RuntimeIdentifier = "linux-x64" }
    if ($SkipInstall) { $verifyArguments.SkipInstall = $true }
    if ($SkipSecurityAudit) { $verifyArguments.SkipSecurityAudit = $true }
    if ($AllowDirty) { $verifyArguments.AllowDirty = $true }
    & (Join-Path $PSScriptRoot "verify-v1.ps1") @verifyArguments
    if ($LASTEXITCODE -ne 0) { throw "Azure release verification failed with exit code $LASTEXITCODE." }
}
finally {
    foreach ($entry in $previousValues.GetEnumerator()) {
        if ($null -eq $entry.Value) { Remove-Item -Path "Env:$($entry.Key)" -ErrorAction SilentlyContinue }
        else { Set-Item -Path "Env:$($entry.Key)" -Value $entry.Value }
    }
}

if (Test-Path -LiteralPath $artifactRoot) {
    Remove-Item -LiteralPath $artifactRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $artifactRoot | Out-Null

& (Join-Path $PSScriptRoot "new-deployment-package.ps1") `
    -SourceDirectory (Join-Path $root ".artifacts\v1\api") `
    -DestinationPath $packagePath
if ($LASTEXITCODE -ne 0) { throw "Azure packaging failed with exit code $LASTEXITCODE." }

$digest = (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Host ""
Write-Host "Azure App Service release is ready." -ForegroundColor Green
Write-Host "Package: $packagePath"
Write-Host "SHA256:  $digest"
