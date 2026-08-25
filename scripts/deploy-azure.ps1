param(
    [Parameter(Mandatory = $true)][string] $ResourceGroupName,
    [Parameter(Mandatory = $true)][string] $WebAppName,
    [string] $PackagePath = "",
    [string] $ExpectedSubscriptionId = ""
)

$ErrorActionPreference = "Stop"
$root = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
if ([string]::IsNullOrWhiteSpace($PackagePath)) {
    $PackagePath = Join-Path $root ".artifacts\azure\i-elevate-linux-x64.zip"
}
$PackagePath = [System.IO.Path]::GetFullPath($PackagePath)
if (!(Test-Path -LiteralPath $PackagePath -PathType Leaf)) {
    throw "Azure deployment package was not found: $PackagePath"
}
if ($null -eq (Get-Command az -ErrorAction SilentlyContinue)) {
    throw "Azure CLI was not found. Install it and sign in to the approved college subscription."
}

$account = az account show --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $null -eq $account) {
    throw "Azure CLI is not signed in."
}
if (![string]::IsNullOrWhiteSpace($ExpectedSubscriptionId) -and [string]$account.id -ne $ExpectedSubscriptionId) {
    throw "Azure CLI is using subscription '$($account.id)', not the approved subscription '$ExpectedSubscriptionId'."
}

az webapp deploy `
    --resource-group $ResourceGroupName `
    --name $WebAppName `
    --src-path $PackagePath `
    --type zip `
    --clean true `
    --restart true `
    --output none
if ($LASTEXITCODE -ne 0) { throw "Azure App Service deployment failed with exit code $LASTEXITCODE." }

$hostName = az webapp show `
    --resource-group $ResourceGroupName `
    --name $WebAppName `
    --query defaultHostName `
    --output tsv
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($hostName)) {
    throw "Could not read the deployed App Service host name."
}

$healthUrl = "https://$hostName/health/ready"
$deadline = (Get-Date).AddMinutes(5)
$healthy = $false
do {
    try {
        $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 20
        if ($health.status -eq "healthy" -and $health.database -eq "connected") {
            $healthy = $true
            break
        }
    }
    catch {
        Start-Sleep -Seconds 10
    }
} while ((Get-Date) -lt $deadline)

if (!$healthy) {
    throw "The Azure deployment completed, but readiness did not become healthy within five minutes: $healthUrl"
}

Write-Host "Azure deployment healthy: $healthUrl" -ForegroundColor Green
