param(
    [string] $Server = '(localdb)\MSSQLLocalDB',
    [string] $Database = 'TLQS'
)

$ErrorActionPreference = 'Stop'
if ($Server -notmatch '^\(localdb\)\\' -or $Database -ne 'TLQS') {
    throw 'This fixture loader is restricted to the local TLQS development database.'
}
$sqlcmd = (Get-Command sqlcmd -ErrorAction Stop).Source
$root = Split-Path -Parent $PSScriptRoot
$files = @(
    '012_seed_system_test_members.sql',
    '014_seed_system_test_processes.sql',
    '013_seed_system_test_qa_uco.sql',
    '015_seed_system_test_status.sql'
)
foreach ($file in $files) {
    $path = Join-Path $root "database\seed\local\$file"
    if (-not (Test-Path -LiteralPath $path)) { throw "Missing fixture: $file" }
}
foreach ($file in $files) {
    Write-Host "Loading $file"
    & $sqlcmd -S $Server -d $Database -E -I -No -C -b -l 15 -t 120 -i (Join-Path $root "database\seed\local\$file")
    if ($LASTEXITCODE -ne 0) { throw "Fixture failed: $file. Its transaction was rolled back; earlier completed fixtures are retained." }
}
Write-Host 'Local 2026/27 system test data loaded. Refresh i-Elevate.'
