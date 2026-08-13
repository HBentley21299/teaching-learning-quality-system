param(
    [string] $SettingsPath = (Join-Path (Split-Path -Parent $PSScriptRoot) "deployment.settings.psd1")
)

$ErrorActionPreference = "Stop"
$root = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$resolvedSettings = [System.IO.Path]::GetFullPath($SettingsPath)

if (!(Test-Path -LiteralPath $resolvedSettings -PathType Leaf)) {
    throw "Deployment settings were not found at '$resolvedSettings'. Copy deployment.settings.example.psd1 to deployment.settings.psd1, fill in the college values, then run this command again."
}
if (!$resolvedSettings.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Keep the deployment settings inside the repository so the handover process can validate them."
}

$settings = Import-PowerShellDataFile -LiteralPath $resolvedSettings
$required = @(
    "ResourceGroup",
    "Location",
    "EnvironmentName",
    "AppName",
    "SqlAdministratorLogin",
    "SqlAdministratorObjectId",
    "SqlAdministratorPrincipalType",
    "EntraTenantId",
    "EntraApiAudience",
    "EntraSpaClientId",
    "EntraApiScope",
    "BootstrapAdminEmail",
    "BootstrapAdminObjectId",
    "OperationsAlertEmail"
)
$missing = @($required | Where-Object {
    !$settings.ContainsKey($_) -or
    [string]::IsNullOrWhiteSpace([string]$settings[$_]) -or
    [string]$settings[$_] -match '<[^>]+>'
})
if ($missing.Count -gt 0) {
    throw "Fill in these deployment settings before continuing: $($missing -join ', ')."
}
if ($settings.EnvironmentName -notin @("dev", "test", "prod")) {
    throw "EnvironmentName must be dev, test or prod."
}
if ($settings.SqlAdministratorPrincipalType -notin @("Group", "User")) {
    throw "SqlAdministratorPrincipalType must be Group or User. Group is recommended for production."
}
if ($settings.EnvironmentName -eq "prod" -and $settings.SqlAdministratorPrincipalType -ne "Group") {
    Write-Warning "Production is configured with an individual Azure SQL administrator. An Entra group is strongly recommended."
}

$gitStatus = & git -C $root status --porcelain
if ($LASTEXITCODE -ne 0) {
    throw "Git could not inspect the repository."
}
if ($gitStatus) {
    throw "The repository contains uncommitted changes. Review and commit them before deploying; production deployment from a dirty working copy is blocked."
}

& (Join-Path $PSScriptRoot "check-prerequisites.ps1") -Azure

$arguments = @{
    ResourceGroup = [string]$settings.ResourceGroup
    Location = [string]$settings.Location
    EnvironmentName = [string]$settings.EnvironmentName
    AppName = [string]$settings.AppName
    SqlAdministratorLogin = [string]$settings.SqlAdministratorLogin
    SqlAdministratorObjectId = [string]$settings.SqlAdministratorObjectId
    SqlAdministratorPrincipalType = [string]$settings.SqlAdministratorPrincipalType
    EntraTenantId = [string]$settings.EntraTenantId
    EntraApiAudience = [string]$settings.EntraApiAudience
    EntraSpaClientId = [string]$settings.EntraSpaClientId
    EntraApiScope = [string]$settings.EntraApiScope
    BootstrapAdminEmail = [string]$settings.BootstrapAdminEmail
    BootstrapAdminObjectId = [string]$settings.BootstrapAdminObjectId
    OperationsAlertEmail = [string]$settings.OperationsAlertEmail
}
if ($settings.ContainsKey("SqlLocation") -and ![string]::IsNullOrWhiteSpace([string]$settings.SqlLocation)) {
    $arguments.SqlLocation = [string]$settings.SqlLocation
}
if ([bool]$settings.IncludeOfficialStaffData) {
    $arguments.IncludeOfficialStaffData = $true
}
if ([bool]$settings.EnableMessaging) {
    $arguments.EnableMessaging = $true
    $arguments.MessagingClientId = [string]$settings.MessagingClientId
    $arguments.MessagingSenderAddress = [string]$settings.MessagingSenderAddress
    $arguments.MessagingReplyToAddress = [string]$settings.MessagingReplyToAddress
    $arguments.MessagingTestRecipient = [string]$settings.MessagingTestRecipient
}

Write-Host "Deploying the approved i-Elevate release to $($settings.EnvironmentName)..." -ForegroundColor Cyan
& (Join-Path $PSScriptRoot "deploy-azure.ps1") @arguments
if ($LASTEXITCODE -ne 0) {
    throw "The Azure deployment did not complete successfully. Read the last error, correct it, and rerun this same command."
}
