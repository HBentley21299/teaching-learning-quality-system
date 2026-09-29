param([string]$AcademicYear = '2026/27')
# Read-only local API regression check. Run once the integrated API has restarted.
$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:5001/api/v1'
function Read-Api([string]$path) { $result = Invoke-RestMethod "$base$path" -TimeoutSec 60; $result }
$year = [uri]::EscapeDataString($AcademicYear)
$rows = @(Read-Api "/reports/eli-submissions?academicYear=$year")
$allAggregates = @(Read-Api "/reports/staff-participation?academicYear=$year")
$aggregates = @($allAggregates | Where-Object processKey -eq 'eli')
if (@($rows | Group-Object staffId | Where-Object Count -ne 1).Count) { throw 'ELI roster duplicated an eligible staff member.' }
if (@($rows | Where-Object { !$_.hasSubmitted -and ($null -ne $_.submittedAt -or $null -ne $_.assessmentRecordId) }).Count) {
    throw 'Non-submission rows exposed assessment metadata.'
}
foreach ($aggregate in $aggregates) {
    $cohort = @($rows | Where-Object { [string]$_.orgUnitId -eq [string]$aggregate.orgUnitId })
    if ($cohort.Count -ne $aggregate.activeStaffCount) { throw "ELI denominator differs for unit $($aggregate.orgUnitId)." }
    if (@($cohort | Where-Object hasSubmitted).Count -ne $aggregate.participatingStaffCount) {
        throw "ELI submitted count differs for unit $($aggregate.orgUnitId)."
    }
}
if ($rows.Count -ne ($aggregates | Measure-Object activeStaffCount -Sum).Sum) { throw 'ELI roster includes staff outside the aggregate denominator.' }
$outsideYear = @(Read-Api '/reports/eli-submissions?academicYear=__nonexistent_test_year__')
if ($outsideYear.Count) { throw 'ELI roster returned staff for a nonexistent academic year.' }
$records = @(Read-Api "/reports/process-records?academicYear=$year&dashboardKey=overview")
if (@($records | Where-Object { !$_.PSObject.Properties['submitterDisplayName'] }).Count) { throw 'Process records omitted the nullable submitter contract.' }
[pscustomobject]@{
    AcademicYear = $AcademicYear
    EligibleStaff = $rows.Count
    Submitted = @($rows | Where-Object hasSubmitted).Count
    NotSubmitted = @($rows | Where-Object { !$_.hasSubmitted }).Count
    OrganisationGroups = $aggregates.Count
    ProcessRecords = $records.Count
    RecordedSubmitters = @($records | Where-Object submitterDisplayName).Count
    Result = 'PASS: named rows match scoped aggregates; no draft metadata; invalid year empty; nullable submitter field present'
}
