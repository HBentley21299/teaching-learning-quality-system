[CmdletBinding()]
param(
    [string]$Server = '(localdb)\MSSQLLocalDB',
    [string]$Database = 'TLQS',
    [switch]$Apply,
    [string]$VerifiedBackupPath,
    [string]$OutputPath
)
$ErrorActionPreference = 'Stop'
if ($Server -notmatch '^\(localdb\)\\[A-Za-z0-9_-]+$' -or $Database -cne 'TLQS') {
    throw 'Targeted test cleanup is restricted to a named LocalDB instance and database TLQS.'
}
if ($Apply -and (!$VerifiedBackupPath -or !(Test-Path -LiteralPath $VerifiedBackupPath -PathType Leaf))) {
    throw 'Apply requires the path to the verified pre-cleanup database backup.'
}
if (Get-NetTCPConnection -LocalPort 5001 -State Listen -ErrorAction SilentlyContinue) {
    throw 'Stop the local API on port 5001 before planning or applying cleanup.'
}
$sqlcmd = (Get-Command sqlcmd -ErrorAction Stop).Source
$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'database/seed/local/016_remove_system_test_data.sql'
$runDirectory = Join-Path $root '.localappdata/system-test-cleanup'
New-Item -ItemType Directory -Path $runDirectory -Force | Out-Null
$batchPath = Join-Path $runDirectory 'prepared-cleanup.sql'
$applyValue = if ($Apply) { 1 } else { 0 }
# The SQL script independently checks SERVERPROPERTY(IsLocalDB) and DB_NAME().
$preamble = "EXEC sys.sp_set_session_context @key=N'ApplySystemTestCleanup', @value=$applyValue;`n"
[IO.File]::WriteAllText($batchPath, $preamble + [IO.File]::ReadAllText($source), [Text.UTF8Encoding]::new($false))
if (!$OutputPath) { $OutputPath = Join-Path $runDirectory $(if ($Apply) { 'applied.txt' } else { 'dry-run.txt' }) }
$arguments = @('-S',$Server,'-d',$Database,'-E','-No','-C','-b','-I','-W','-s','|','-w','65535','-l','15','-t','120','-f','65001','-i',$batchPath,'-o',$OutputPath)
& $sqlcmd @arguments
if ($LASTEXITCODE -ne 0) {
    if (Test-Path -LiteralPath $OutputPath) { Get-Content -LiteralPath $OutputPath -Tail 30 }
    throw "Targeted cleanup failed; SQL transaction rolled back. Review $OutputPath."
}
Write-Output $(if ($Apply) { "Targeted cleanup committed. Evidence: $OutputPath" } else { "Dry run complete; no persistent data changed. Review: $OutputPath" })
