param(
    [Parameter(Mandatory = $true)][string] $ResourceGroup,
    [Parameter(Mandatory = $true)][string] $AppServiceName,
    [string] $SlotName = "staging"
)

$ErrorActionPreference = "Stop"
$productionUrl = "https://$AppServiceName.azurewebsites.net"
$rollbackUrl = "https://$AppServiceName-$SlotName.azurewebsites.net"

function Assert-Healthy {
    param([string] $Url, [string] $Label)
    try {
        $health = Invoke-RestMethod -Uri "$Url/health/ready" -TimeoutSec 15
    }
    catch {
        throw "$Label is not healthy at $Url. The swap was not performed. $($_.Exception.Message)"
    }
    if ($health.status -ne "healthy" -or $health.database -ne "connected") {
        throw "$Label did not report a healthy database connection. The swap was not performed."
    }
}

Assert-Healthy -Url $rollbackUrl -Label "The rollback build in the staging slot"

Write-Host "Swapping the previous build back into production..." -ForegroundColor Yellow
az webapp deployment slot swap `
    --resource-group $ResourceGroup `
    --name $AppServiceName `
    --slot $SlotName `
    --target-slot production `
    --output none
if ($LASTEXITCODE -ne 0) {
    throw "Azure did not complete the rollback slot swap."
}

Assert-Healthy -Url $productionUrl -Label "Production after rollback"
Write-Host "Rollback completed and production is healthy: $productionUrl" -ForegroundColor Green
