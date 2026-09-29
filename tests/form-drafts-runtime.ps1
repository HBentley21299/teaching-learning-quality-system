param([string]$AcademicYear = '2026/27', [string[]]$OnlyProcesses = @())
# Manual local-only integration check. Creates labelled copies of existing test
# submissions and archives every copy in finally; never edits the originals.
$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:5001/api/v1'
function Read-Api([string]$path) { $result = Invoke-RestMethod "$base$path" -TimeoutSec 120; $result }
function Write-Api([string]$path, [string]$method, $body) { Invoke-RestMethod "$base$path" -Method $method -ContentType 'application/json' -Body ($body | ConvertTo-Json -Depth 30) -TimeoutSec 120 }
function Export-ContainsRecord([string]$process, [string]$stage, [string]$recordId) {
    $module = @{ work_scrutiny='work-scrutiny'; learning_walk='learning-walks'; als_learning_walk='als-learning-walks'; elevate_environment='elevate-environments' }[$process]
    $path = Join-Path $PSScriptRoot "../.localappdata/audit-implementation/draft-export-$process-$stage.xlsx"
    Invoke-WebRequest "$base/exports/excel/$module`?academicYear=$year" -OutFile $path -TimeoutSec 120
    $zip = [IO.Compression.ZipFile]::OpenRead($path)
    try {
        foreach ($entry in $zip.Entries) {
            if ($entry.FullName -notmatch '^xl/(sharedStrings|worksheets/[^/]+)\.xml$') { continue }
            $reader = [IO.StreamReader]::new($entry.Open())
            try { if ($reader.ReadToEnd().Contains($recordId, [StringComparison]::OrdinalIgnoreCase)) { return $true } }
            finally { $reader.Dispose() }
        }
        return $false
    } finally { $zip.Dispose() }
}
$year = [uri]::EscapeDataString($AcademicYear)
$records = @(Read-Api "/records?academicYear=$year")
$created = [Collections.Generic.List[string]]::new()
$failures = [Collections.Generic.List[string]]::new()
$processes = @('work_scrutiny', 'learning_walk', 'elevate_environment')
if ($records | Where-Object { $_.recordType -eq 'als_learning_walk' -and $_.submissionStatus -eq 'submitted' -and $_.title -match 'TEST|Test|Fictional' }) { $processes += 'als_learning_walk' }
else { 'SKIP ALS Learning Walk: no labelled submitted fixture available; no fixture loaded automatically.' }
if ($OnlyProcesses.Count) { $processes = @($processes | Where-Object { $OnlyProcesses -contains $_ }) }
try {
    foreach ($process in $processes) {
        $source = $records | Where-Object { $_.recordType -eq $process -and $_.submissionStatus -eq 'submitted' -and $_.title -match 'TEST|Test|Fictional' } | Select-Object -First 1
        if (!$source) { throw "No labelled submitted test source for $process. Load local fixtures explicitly before this check." }
        $detail = Read-Api "/records/$($source.id)"
        $definition = Read-Api "/form-templates/$($detail.templateKey)/definition"
        $oldValues = @{}
        foreach ($section in $detail.sections) { foreach ($field in $section.fields) { $oldValues[$field.fieldKey] = $field.value } }
        if ($process -eq 'elevate_environment') {
            $rooms = @(Read-Api '/admin/rooms')
            $room = $rooms | Where-Object { $_.isActive -and $_.roomCode -eq $oldValues['room_code'] } | Select-Object -First 1
            if (!$room) { $room = $rooms | Where-Object isActive | Select-Object -First 1 }
            if (!$room) { throw 'No active room available for the labelled environment test copy.' }
            $oldValues['room_code'] = $room.roomCode
            $pillars = @(Read-Api '/elevate-environment/pillars')
            foreach ($pillar in $pillars) {
                $fieldKey = "$($pillar.pillarKey)_score"
                $matching = $pillar.rubric | Where-Object { [string]$_.score -eq $oldValues[$fieldKey] -or $_.judgement -eq $oldValues[$fieldKey] } | Select-Object -First 1
                if (!$matching) { $matching = $pillar.rubric | Select-Object -First 1 }
                if (!$matching) { throw "No current rubric choices for environment pillar $($pillar.pillarKey)." }
                $oldValues[$fieldKey] = [string]$matching.score
            }
        }
        $deliveryProcess = if ($process -eq 'als_learning_walk') { 'als_learning_walk' } else { 'learning_walk' }
        $deliveryAreas = @(Read-Api "/learning-walk/delivery-areas?process=$deliveryProcess")
        $deliveryArea = $deliveryAreas | Where-Object { $_.key -eq $oldValues['learning_walk_delivery_area'] -or $_.name -eq $oldValues['learning_walk_delivery_area'] } | Select-Object -First 1
        if ($deliveryArea) { $oldValues['learning_walk_delivery_area'] = $deliveryArea.key }
        $responses = @($definition.sections | ForEach-Object { $_.fields } | ForEach-Object {
            $value = $oldValues[$_.fieldKey]
            if ($process -eq 'work_scrutiny' -and $_.options.Count) {
                # Existing fixtures predate the latest configurable wording. Normalize
                # only this new, labelled test copy to current valid choices.
                $choices = @($_.options)
                $selected = @(([string]$value -split '\|') | ForEach-Object { $old = $_; $choices | Where-Object { $_ -eq $old } | Select-Object -First 1 })
                $value = if ($selected.Count) { $selected -join '|' } else { $choices[0] }
            }
            @{ fieldId = $_.id; value = $value }
        })
        $body = @{ templateKey = $definition.templateKey; recordType = $process; title = "[SYSTEM TEST] Draft lifecycle $process"; orgUnitId = $detail.orgUnitId; recordDate = $detail.recordDate; saveAsDraft = $true; responses = $responses; draftActions = @(@{ title = 'Incomplete action retained by draft' }) }
        $saved = Write-Api '/form-submissions' 'Post' $body
        $created.Add($saved.recordId)
        $draft = Read-Api "/records/$($saved.recordId)"
        if ($draft.submissionStatus -ne 'draft' -or @($draft.draftActions).Count -ne 1 -or $draft.draftActions[0].title -ne 'Incomplete action retained by draft') { throw "$process draft did not retain partial actions." }
        $actions = @(Read-Api "/actions?academicYear=$year")
        if (@($actions | Where-Object sourceRecordId -eq $saved.recordId).Count) { throw "$process draft assigned a central action prematurely." }
        $reported = @(Read-Api "/reports/process-records?academicYear=$year&dashboardKey=overview")
        if (@($reported | Where-Object id -eq $saved.recordId).Count) { $failures.Add("$process draft appeared in submitted reporting."); Write-Warning $failures[$failures.Count - 1] }
        $dimensions = @(Read-Api "/reports/dashboard-dimensions?academicYear=$year&dashboardKey=overview")
        if (@($dimensions | Where-Object sourceRecordId -eq $saved.recordId).Count) { $failures.Add("$process draft appeared in dashboard dimensions."); Write-Warning $failures[$failures.Count - 1] }
        if (Export-ContainsRecord $process 'draft' $saved.recordId) { $failures.Add("$process draft appeared in Excel export."); Write-Warning $failures[$failures.Count - 1] }
        $rejected = $false
        try { Write-Api "/form-submissions/$($draft.submissionId)/status" 'Post' @{action='submit'} | Out-Null }
        catch { if ([int]$_.Exception.Response.StatusCode -eq 400) { $rejected = $true } else { throw } }
        if (!$rejected) { throw "$process allowed an incomplete draft action to be submitted." }
        $stillDraft = Read-Api "/records/$($saved.recordId)"
        if ($stillDraft.submissionStatus -ne 'draft') { throw "$process failed submit changed its lifecycle." }
        $owners = @(Read-Api "/actions/owner-options?sourceRecordId=$($saved.recordId)&sourceFormType=$process")
        $themes = @(Read-Api "/action-themes/$process")
        if (!$owners.Count -or !$themes.Count) { throw "$process has no configured owner/theme for publication verification." }
        $completeAction = @{ actionTheme = $themes[0].displayName; title = '[SYSTEM TEST] Published once from draft'; ownerStaffId = $owners[0].staffId; dueDate = '2026-10-30'; detail = 'Fictional draft lifecycle verification.' }
        $directRejected = $false
        try { Write-Api '/actions' 'Post' ($completeAction + @{ sourceRecordId=$saved.recordId; publishedToStaff=$true }) | Out-Null }
        catch { if ([int]$_.Exception.Response.StatusCode -eq 400) { $directRejected = $true } else { throw } }
        if (!$directRejected) { throw "$process allowed a central action to bypass the draft pool." }
        Write-Api "/form-submissions/$($draft.submissionId)" 'Put' @{title=$body.title; orgUnitId=$body.orgUnitId; recordDate=$body.recordDate; responses=$responses; draftActions=@($completeAction)} | Out-Null
        $reopened = Read-Api "/records/$($saved.recordId)"
        if ($reopened.draftActions[0].detail -ne $completeAction.detail) { throw "$process edited draft action did not persist." }
        Write-Api "/form-submissions/$($draft.submissionId)/status" 'Post' @{action='submit'} | Out-Null
        $published = Read-Api "/records/$($saved.recordId)"
        $actions = @(Read-Api "/actions?academicYear=$year")
        if ($published.submissionStatus -ne 'submitted' -or @($published.draftActions).Count -ne 0 -or @($actions | Where-Object sourceRecordId -eq $saved.recordId).Count -ne 1) { throw "$process publication did not promote exactly one action." }
        $reported = @(Read-Api "/reports/process-records?academicYear=$year&dashboardKey=overview")
        if (!@($reported | Where-Object id -eq $saved.recordId).Count) { throw "$process submitted record missing from reporting." }
        $dimensions = @(Read-Api "/reports/dashboard-dimensions?academicYear=$year&dashboardKey=overview")
        if (!@($dimensions | Where-Object sourceRecordId -eq $saved.recordId).Count) { throw "$process submitted record missing from dimension facts." }
        if (!(Export-ContainsRecord $process 'submitted' $saved.recordId)) { throw "$process submitted record missing from Excel export." }
        "PASS $process — draft round-trip, action exclusion, incomplete rejection, direct-action bypass blocked, edit round-trip, single action promotion; submitted record present in reports, dimensions and Excel."
    }
    if ($failures.Count) { throw ($failures -join ' ') }
    'PASS all draft records excluded from reports, dashboard dimensions and Excel exports.'
} finally {
    $cleanupFailures = @()
    foreach ($id in $created) {
        try { Write-Api "/admin/records/$id/archive" 'Post' @{reason='Archive temporary local draft lifecycle verification copy.'} | Out-Null }
        catch { $cleanupFailures += $id; Write-Warning "Could not archive temporary draft verification record $id`: $($_.Exception.Message)" }
    }
    if ($cleanupFailures.Count) { throw "Temporary records need cleanup: $($cleanupFailures -join ', ')" }
}
