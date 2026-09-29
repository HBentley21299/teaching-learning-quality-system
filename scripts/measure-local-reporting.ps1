param([ValidateSet('before','after')][string]$Phase = 'before')
$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:5001'
$outputDirectory = Join-Path $PSScriptRoot '../.localappdata/reporting-baseline'
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$targets = @(
    @{ Name='Dashboard configuration'; Path='/api/v1/reports/dashboard-configuration' },
    @{ Name='Overview records'; Path='/api/v1/reports/process-records?academicYear=2026%2F27&dashboardKey=overview' },
    @{ Name='Overview dimensions'; Path='/api/v1/reports/dashboard-dimensions?academicYear=2026%2F27&dashboardKey=overview' },
    @{ Name='Overview actions'; Path='/api/v1/reports/actions?academicYear=2026%2F27&dashboardKey=overview' },
    @{ Name='Elevate Status'; Path='/api/v1/reports/elevate-status?academicYear=2026%2F27' },
    @{ Name='Staff participation'; Path='/api/v1/reports/staff-participation?academicYear=2026%2F27' },
    @{ Name='QA summary'; Path='/api/v1/qa-hub/summary' }
)
$readiness = Invoke-WebRequest "$base/health/ready" -TimeoutSec 30
if ($readiness.StatusCode -ne 200) { throw 'Local API is not ready.' }
$measurements = [System.Collections.Generic.List[object]]::new()
foreach ($round in 1..2) {
    foreach ($target in $targets) {
        $watch = [System.Diagnostics.Stopwatch]::StartNew()
        $status = $null; $bytes = $null; $count = $null; $failure = $null
        try {
            $response = Invoke-WebRequest "$base$($target.Path)" -TimeoutSec 45
            $watch.Stop()
            $status = [int]$response.StatusCode
            $bytes = [System.Text.Encoding]::UTF8.GetByteCount([string]$response.Content)
            $value = ConvertFrom-Json -InputObject ([string]$response.Content)
            if ($value -is [array]) { $count = $value.Count }
            elseif ($target.Name -eq 'QA summary') { $count = @($value.reviews).Count }
            elseif ($target.Name -eq 'Dashboard configuration') { $count = @($value.processes).Count }
        } catch {
            $watch.Stop()
            if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
            $failure = $_.Exception.GetType().Name
        }
        $row = [pscustomobject]@{ phase=$Phase; round=$round; name=$target.Name; path=$target.Path; status=$status; elapsedMs=[math]::Round($watch.Elapsed.TotalMilliseconds,1); decodedUtf8Bytes=$bytes; itemCount=$count; errorType=$failure }
        $measurements.Add($row)
        $row | ConvertTo-Json -Compress
        if ($status -in 401,403) { throw 'This local baseline needs the existing permitted local development identity; no credentials will be created or changed.' }
    }
}
$processStatePath = Join-Path $PSScriptRoot '../.localappdata/local-run/processes.json'
$processState = if (Test-Path $processStatePath) { Get-Content $processStatePath -Raw | ConvertFrom-Json } else { $null }
$result = [pscustomobject]@{ recordedAt=(Get-Date).ToString('o'); baseUrl=$base; phase=$Phase; apiProcessId=$processState.apiProcessId; requestConcurrency=1; rounds=2; notes='GET only, no cache reset, existing local test data and development identity. Payload sizes are decoded UTF-8 JSON, not compressed network bytes. No production/load-test inference.'; measurements=$measurements }
$result | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $outputDirectory "$Phase.json") -Encoding utf8
