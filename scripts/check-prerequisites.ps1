param()

$ErrorActionPreference = "Stop"
$missingRequired = [System.Collections.Generic.List[string]]::new()

Write-Host "Checking TLQS local prerequisites..."

$dotnetSdkOutput = & dotnet --list-sdks 2>$null
if ([string]::IsNullOrWhiteSpace($dotnetSdkOutput)) {
    Write-Warning ".NET SDK not found. Install .NET 10 SDK, then rerun this script."
    $missingRequired.Add(".NET 10 SDK")
} else {
    Write-Host ".NET SDKs:"
    Write-Host $dotnetSdkOutput
}

$nodeVersion = & node --version 2>$null
if ([string]::IsNullOrWhiteSpace($nodeVersion)) {
    Write-Warning "Node.js not found. Install Node 24 or later."
    $missingRequired.Add("Node.js 24")
} else {
    Write-Host "Node.js: $nodeVersion"
}

$npmVersion = & npm.cmd --version 2>$null
if ([string]::IsNullOrWhiteSpace($npmVersion)) {
    Write-Warning "npm not found."
    $missingRequired.Add("npm")
} else {
    Write-Host "npm: $npmVersion"
}

$sqlcmd = Get-Command sqlcmd -ErrorAction SilentlyContinue
if ($null -eq $sqlcmd) {
    Write-Warning "sqlcmd not found. Install SQL Server command line tools to apply database scripts locally."
} else {
    Write-Host "sqlcmd: $($sqlcmd.Source)"
}

$localDb = Get-Command sqllocaldb -ErrorAction SilentlyContinue
if ($null -eq $localDb) {
    Write-Warning "SQL Server LocalDB not found. Use SQL Server Developer or install LocalDB for local development."
} else {
    Write-Host "SQL LocalDB: $($localDb.Source)"
}

if ($missingRequired.Count -gt 0) {
    throw "Install the missing prerequisites, then rerun this check: $($missingRequired -join ', ')."
}

Write-Host "Check complete. All required tools are available." -ForegroundColor Green
