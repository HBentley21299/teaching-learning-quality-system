param(
    [string] $Server = "(localdb)\MSSQLLocalDB",
    [string] $Database = "TLQS"
)

$ErrorActionPreference = "Stop"

if ($Server -notmatch "(?i)localdb") {
    throw "This destructive reset is restricted to SQL Server LocalDB."
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
$scriptPath = Join-Path $root "database\seed\local\007_remove_all_local_submission_data.sql"

Write-Host "Removing all submission and workflow data from $Database on LocalDB..."
& $sqlCmd -S $Server -d $Database -E -b -i $scriptPath
if ($LASTEXITCODE -ne 0) {
    throw "$sqlCmd failed with exit code $LASTEXITCODE."
}

Write-Host "Local submission data reset complete. Accounts and configuration were preserved."
