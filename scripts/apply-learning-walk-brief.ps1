param(
    [string] $Server = "(localdb)\MSSQLLocalDB",
    [string] $Database = "TLQS"
)

$ErrorActionPreference = "Stop"

function Resolve-Tool {
    param(
        [string] $Name,
        [string[]] $KnownPaths
    )

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($null -ne $command) {
        return $command.Source
    }

    foreach ($path in $KnownPaths) {
        if (Test-Path -LiteralPath $path) {
            return $path
        }
    }

    throw "$Name was not found."
}

$root = Split-Path -Parent $PSScriptRoot
$sqlCmd = Resolve-Tool "SQLCMD.EXE" @(
    "C:\Program Files\Microsoft SQL Server\Client SDK\ODBC\180\Tools\Binn\SQLCMD.EXE",
    "C:\Program Files\Microsoft SQL Server\Client SDK\ODBC\170\Tools\Binn\SQLCMD.EXE"
)
$script = Join-Path $root "database\migrations\003_learning_walk_brief.sql"

Write-Host "Applying $script"
& $sqlCmd -S $Server -d $Database -E -b -No -C -i $script
if ($LASTEXITCODE -ne 0) {
    throw "SQL migration failed with exit code $LASTEXITCODE."
}

Write-Host "Learning Walk brief migration applied."
