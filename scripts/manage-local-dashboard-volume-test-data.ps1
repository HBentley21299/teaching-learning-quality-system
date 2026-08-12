param(
    [string] $Server = "(localdb)\MSSQLLocalDB",
    [string] $Database = "TLQS",
    [switch] $Remove
)

$ErrorActionPreference = "Stop"

if ($Server -notmatch "(?i)localdb") {
    throw "This script is restricted to SQL Server LocalDB."
}

$sqlCmdCommand = Get-Command "sqlcmd" -ErrorAction SilentlyContinue
$sqlCmd = if ($null -ne $sqlCmdCommand) { $sqlCmdCommand.Source } else { $null }
if ([string]::IsNullOrWhiteSpace($sqlCmd)) {
    $sqlCmd = @(
        "C:\Program Files\Microsoft SQL Server\Client SDK\ODBC\180\Tools\Binn\SQLCMD.EXE",
        "C:\Program Files\Microsoft SQL Server\170\Tools\Binn\SQLCMD.EXE"
    ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}

if ([string]::IsNullOrWhiteSpace($sqlCmd)) {
    throw "sqlcmd was not found."
}

$root = Split-Path -Parent $PSScriptRoot
$fileName = if ($Remove) {
    "006_remove_dashboard_volume_test_data.sql"
} else {
    "005_seed_dashboard_volume_test_data.sql"
}
$scriptPath = Join-Path $root "database\seed\local\$fileName"

Write-Host ($(if ($Remove) { "Removing" } else { "Creating" })) "local 2025/26 dashboard volume test data..."
& $sqlCmd -S $Server -d $Database -E -b -i $scriptPath
if ($LASTEXITCODE -ne 0) {
    throw "$sqlCmd failed with exit code $LASTEXITCODE."
}

Write-Host ($(if ($Remove) {
    "Local dashboard volume test data removed."
} else {
    "Local dashboard volume test data is ready."
}))
