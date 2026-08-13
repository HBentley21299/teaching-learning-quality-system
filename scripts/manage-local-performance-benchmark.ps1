param(
    [string] $Server = "(localdb)\MSSQLLocalDB",
    [string] $Database = "TLQS",
    [switch] $Remove
)

$ErrorActionPreference = "Stop"

if ($Server -notmatch "(?i)localdb") {
    throw "This performance fixture is restricted to SQL Server LocalDB."
}

$sqlCmdCommand = Get-Command "sqlcmd" -ErrorAction SilentlyContinue
if ($null -eq $sqlCmdCommand) {
    throw "sqlcmd was not found."
}

$root = Split-Path -Parent $PSScriptRoot
$fileName = if ($Remove) { "008_remove_performance_benchmark.sql" } else { "007_seed_performance_benchmark.sql" }
$scriptPath = Join-Path $root "database\seed\local\$fileName"
$verb = if ($Remove) { "Removing" } else { "Creating" }

Write-Host "$verb the local performance fixture..."
& $sqlCmdCommand.Source -S $Server -d $Database -E -b -i $scriptPath
if ($LASTEXITCODE -ne 0) {
    throw "sqlcmd failed with exit code $LASTEXITCODE."
}

Write-Host "Local performance fixture operation completed."
