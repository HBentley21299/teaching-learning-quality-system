param(
    [string] $Database = "TLQS",
    [string] $Instance = "MSSQLLocalDB",
    [switch] $Reset
)

$ErrorActionPreference = "Stop"

function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)]
        [string] $FilePath,

        [Parameter(Mandatory = $true)]
        [string[]] $Arguments
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FilePath failed with exit code $LASTEXITCODE."
    }
}

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
$localDb = Resolve-Tool "SqlLocalDB.exe" @(
    "C:\Program Files\Microsoft SQL Server\170\Tools\Binn\SqlLocalDB.exe",
    "C:\Program Files\Microsoft SQL Server\160\Tools\Binn\SqlLocalDB.exe"
)
$sqlCmd = Resolve-Tool "SQLCMD.EXE" @(
    "C:\Program Files\Microsoft SQL Server\Client SDK\ODBC\180\Tools\Binn\SQLCMD.EXE",
    "C:\Program Files\Microsoft SQL Server\Client SDK\ODBC\170\Tools\Binn\SQLCMD.EXE"
)

$instanceRoot = Join-Path $env:LOCALAPPDATA "Microsoft\Microsoft SQL Server Local DB\Instances"
New-Item -ItemType Directory -Force -Path $instanceRoot | Out-Null

Write-Host "Using LocalDB: $localDb"
Write-Host "Using sqlcmd:  $sqlCmd"

$info = & $localDb info $Instance 2>&1
if ($LASTEXITCODE -ne 0 -or ($info -join "`n") -match "not created|doesn't exist") {
    Write-Host "Creating LocalDB instance $Instance..."
    Invoke-Native -FilePath $localDb -Arguments @("create", $Instance)
}

Write-Host "Starting LocalDB instance $Instance..."
Invoke-Native -FilePath $localDb -Arguments @("start", $Instance)
Invoke-Native -FilePath $localDb -Arguments @("info", $Instance)

$server = "(localdb)\$Instance"
$sqlOptions = @("-No", "-C", "-l", "60")

Write-Host "Creating database $Database if needed..."
$databaseCheckArguments = @(
    "-S", $server,
    "-E",
    "-b",
    "-h", "-1",
    "-W"
) + $sqlOptions + @("-Q", "SET NOCOUNT ON; SELECT CASE WHEN DB_ID(N'$Database') IS NULL THEN 0 ELSE 1 END;")
$databaseCheckOutput = & $sqlCmd @databaseCheckArguments
if ($LASTEXITCODE -ne 0) {
    throw "$sqlCmd failed while checking for database $Database."
}
$databaseExists = ($databaseCheckOutput -join "`n") -match "(^|\s)1(\s|$)"
$applyScripts = $false
$baselineExistingDatabase = $false

if ($Reset) {
    Write-Host "Resetting local development database $Database..."
    $databaseSql = "IF DB_ID(N'$Database') IS NOT NULL BEGIN ALTER DATABASE [$Database] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [$Database]; END; CREATE DATABASE [$Database];"
    $applyScripts = $true
}
elseif (!$databaseExists) {
    Write-Host "Creating local development database $Database..."
    $databaseSql = "CREATE DATABASE [$Database];"
    $applyScripts = $true
}
else {
    Write-Host "Database $Database already exists; keeping its data and schema."
    $baselineCheckArguments = @(
        "-S", $server,
        "-d", $Database,
        "-E",
        "-b",
        "-h", "-1",
        "-W"
    ) + $sqlOptions + @(
        "-Q",
        "SET NOCOUNT ON; SELECT CASE WHEN OBJECT_ID(N'org.org_unit_leaderships', N'U') IS NOT NULL AND COALESCE((SELECT SUM(row_count) FROM sys.dm_db_partition_stats WHERE object_id = OBJECT_ID(N'dbo.schema_migrations', N'U') AND index_id IN (0, 1)), 0) = 0 THEN 1 ELSE 0 END;"
    )
    $baselineCheckOutput = & $sqlCmd @baselineCheckArguments
    if ($LASTEXITCODE -ne 0) {
        throw "$sqlCmd failed while checking migration history for database $Database."
    }
    $baselineExistingDatabase = ($baselineCheckOutput -join "`n") -match "(^|\s)1(\s|$)"
}

if ($applyScripts) {
    $createDatabaseArguments = @("-S", $server, "-E", "-b") + $sqlOptions + @("-Q", $databaseSql)
    Invoke-Native -FilePath $sqlCmd -Arguments $createDatabaseArguments
}

Write-Host "Applying pending TLQS database scripts..."
& (Join-Path $PSScriptRoot "apply-database.ps1") `
    -Server $server `
    -Database $Database `
    -SqlCmd $sqlCmd `
    -SqlCmdOptions $sqlOptions `
    -BaselineExistingDatabase:$baselineExistingDatabase

Write-Host "Local database is ready: $server / $Database"
