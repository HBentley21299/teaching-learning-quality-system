$ErrorActionPreference = "Stop"

Write-Host "Checking TLQS local prerequisites..."

$dotnetSdkOutput = & dotnet --list-sdks 2>$null
if ([string]::IsNullOrWhiteSpace($dotnetSdkOutput)) {
    Write-Warning ".NET SDK not found. Install .NET 10 SDK, then rerun this script."
} else {
    Write-Host ".NET SDKs:"
    Write-Host $dotnetSdkOutput
}

$nodeVersion = & node --version 2>$null
if ([string]::IsNullOrWhiteSpace($nodeVersion)) {
    Write-Warning "Node.js not found. Install Node 24 or later."
} else {
    Write-Host "Node.js: $nodeVersion"
}

$npmVersion = & npm.cmd --version 2>$null
if ([string]::IsNullOrWhiteSpace($npmVersion)) {
    Write-Warning "npm not found."
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
    Write-Warning "SQL Server LocalDB not found. Use Azure SQL, SQL Server Developer, or install LocalDB for local development."
} else {
    Write-Host "SQL LocalDB: $($localDb.Source)"
}

Write-Host "Check complete."

