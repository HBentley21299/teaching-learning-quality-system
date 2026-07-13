$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$stateFile = Join-Path $root ".localappdata\local-run\processes.json"

function Stop-ProcessTree {
    param([int] $ProcessId)

    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId" -ErrorAction SilentlyContinue
    foreach ($child in $children) {
        Stop-ProcessTree -ProcessId $child.ProcessId
    }

    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

if (!(Test-Path -LiteralPath $stateFile)) {
    Write-Host "No TLQS processes started by start-local.ps1 were found."
    exit 0
}

$state = Get-Content -Raw -LiteralPath $stateFile | ConvertFrom-Json
foreach ($processId in @($state.apiProcessId, $state.webProcessId)) {
    if ($null -ne $processId) {
        Stop-ProcessTree -ProcessId ([int]$processId)
    }
}

Remove-Item -LiteralPath $stateFile -Force
Write-Host "TLQS local API and web processes have been stopped."
