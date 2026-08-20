param(
    [Parameter(Mandatory = $true)][string] $Server,
    [Parameter(Mandatory = $true)][string] $Database,
    [Parameter(Mandatory = $true)][string] $RuntimePrincipal,
    [string] $SqlCmd = "sqlcmd"
)

$ErrorActionPreference = "Stop"
if ($null -eq (Get-Command $SqlCmd -ErrorAction SilentlyContinue)) {
    throw "sqlcmd was not found. Install Microsoft SQL Server command line tools."
}
$RuntimePrincipal = $RuntimePrincipal.Trim()
$invalidCharacters = [char[]]@("'", "]", "`r", "`n")
if ([string]::IsNullOrWhiteSpace($RuntimePrincipal) -or
    $RuntimePrincipal.Length -gt 128 -or
    $RuntimePrincipal.IndexOfAny($invalidCharacters) -ge 0) {
    throw "RuntimePrincipal is not a valid Windows login name."
}
$query = @"
SET XACT_ABORT ON;
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'$RuntimePrincipal')
    CREATE USER [$RuntimePrincipal] FOR LOGIN [$RuntimePrincipal];
IF IS_ROLEMEMBER(N'db_datareader', N'$RuntimePrincipal') <> 1
    ALTER ROLE db_datareader ADD MEMBER [$RuntimePrincipal];
IF IS_ROLEMEMBER(N'db_datawriter', N'$RuntimePrincipal') <> 1
    ALTER ROLE db_datawriter ADD MEMBER [$RuntimePrincipal];
GRANT EXECUTE TO [$RuntimePrincipal];
"@

& $SqlCmd -S $Server -d $Database -E -b -Q $query
if ($LASTEXITCODE -ne 0) { throw "Database access configuration failed with exit code $LASTEXITCODE." }
Write-Host "Database access granted to $RuntimePrincipal." -ForegroundColor Green
