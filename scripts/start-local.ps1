param(
    [switch] $SkipDatabase,
    [switch] $ResetDatabase
)

$ErrorActionPreference = "Stop"

# Some terminals expose both Path and PATH. Windows treats them as the same
# variable, but Start-Process rejects the duplicate environment dictionary.
$processPath = [Environment]::GetEnvironmentVariable("Path", "Process")
[Environment]::SetEnvironmentVariable("PATH", $null, "Process")
[Environment]::SetEnvironmentVariable("Path", $processPath, "Process")

$root = Split-Path -Parent $PSScriptRoot
$stateDirectory = Join-Path $root ".localappdata\local-run"
$logDirectory = Join-Path $stateDirectory "logs"
$stateFile = Join-Path $stateDirectory "processes.json"

New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null

function Test-LocalPort {
    param([int] $Port)

    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $task = $client.ConnectAsync("127.0.0.1", $Port)
        return $task.Wait(400) -and $client.Connected
    }
    catch {
        return $false
    }
    finally {
        $client.Dispose()
    }
}

function Wait-ForUrl {
    param(
        [string] $Url,
        [int] $TimeoutSeconds = 60
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) {
                return
            }
        }
        catch {
            Start-Sleep -Milliseconds 750
        }
    } while ((Get-Date) -lt $deadline)

    throw "Timed out waiting for $Url. Check the logs in $logDirectory."
}

function Start-LocalService {
    param(
        [string] $Name,
        [string] $ScriptPath
    )

    $standardOutput = Join-Path $logDirectory "$Name.out.log"
    $standardError = Join-Path $logDirectory "$Name.err.log"
    $arguments = @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", "`"$ScriptPath`""
    )

    return Start-Process `
        -FilePath "powershell.exe" `
        -ArgumentList $arguments `
        -WindowStyle Hidden `
        -RedirectStandardOutput $standardOutput `
        -RedirectStandardError $standardError `
        -PassThru
}

if (!$SkipDatabase) {
    Write-Host "Preparing the local TLQS database..."
    if ($ResetDatabase) {
        & (Join-Path $PSScriptRoot "fix-localdb.ps1") -Reset
    }
    else {
        & (Join-Path $PSScriptRoot "fix-localdb.ps1")
    }
}

$state = [ordered]@{
    startedAt = (Get-Date).ToString("o")
    apiProcessId = $null
    webProcessId = $null
}

if (Test-LocalPort -Port 5001) {
    Write-Host "API is already listening on http://127.0.0.1:5001"
}
else {
    Write-Host "Starting the API..."
    $apiProcess = Start-LocalService -Name "api" -ScriptPath (Join-Path $PSScriptRoot "run-api.ps1")
    $state.apiProcessId = $apiProcess.Id
}

if (Test-LocalPort -Port 5173) {
    Write-Host "Web app is already listening on http://127.0.0.1:5173"
}
else {
    Write-Host "Starting the web app..."
    $webProcess = Start-LocalService -Name "web" -ScriptPath (Join-Path $PSScriptRoot "run-web.ps1")
    $state.webProcessId = $webProcess.Id
}

$state | ConvertTo-Json | Set-Content -Path $stateFile -Encoding utf8

Wait-ForUrl -Url "http://127.0.0.1:5001/health/ready"
Wait-ForUrl -Url "http://127.0.0.1:5173/"

$health = Invoke-RestMethod -Uri "http://127.0.0.1:5001/health/ready" -TimeoutSec 5
if ($health.database -ne "connected") {
    throw "The API started but LocalDB is unavailable. Check $logDirectory\api.err.log."
}

Write-Host ""
Write-Host "TLQS is ready."
Write-Host "Web app: http://127.0.0.1:5173"
Write-Host "API:     http://127.0.0.1:5001"
Write-Host "Ready:   http://127.0.0.1:5001/health/ready"
Write-Host "Logs:    $logDirectory"
Write-Host "Stop:    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop-local.ps1"
