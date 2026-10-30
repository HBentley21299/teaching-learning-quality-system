param(
    [string]$BaseUrl = 'http://127.0.0.1:5001/api/v1',
    [string]$AcademicYear = '2026/27',
    [string[]]$DashboardKeys = @('overview','learning_walk','als_learning_walk','liv','als_liv','eli','probation_case','elevate_environment','coaching_session','work_scrutiny','cpd_event','actions','uco_tla_review'),
    [switch]$CheckProfiles
)
# Read-only checks against the actual scoped reporting queries. Does not add fixture data or alter configuration.
$ErrorActionPreference = 'Stop'
function Read-Api([string]$path) { $result = Invoke-RestMethod "$BaseUrl$path" -TimeoutSec 180; $result }
$year = [uri]::EscapeDataString($AcademicYear)
$staff = @(Read-Api "/reports/elevate-status-staff?academicYear=$year")
$areas = @(Read-Api "/reports/elevate-status?academicYear=$year")
if (@($staff | Group-Object staffId | Where-Object Count -ne 1).Count) { throw 'Status roster duplicated staff.' }
foreach ($area in $areas) {
    $cohort = @($staff | Where-Object { [string]$_.orgUnitId -eq [string]$area.orgUnitId })
    if ($cohort.Count -ne $area.staffCount) { throw 'Status denominator differs from named cohort.' }
    foreach ($level in 1..5) {
        if (@($cohort | Where-Object { $_.currentLevel -ge $level }).Count -ne $area."level${level}OrAbove") {
            throw "Status aggregate differs at level $level."
        }
    }
}
if ($staff.Count -ne [long](($areas | Measure-Object staffCount -Sum).Sum)) { throw 'Named status roster extends beyond aggregate cohort.' }
if (@(Read-Api '/reports/elevate-status-staff?academicYear=__missing_test_year__').Count) { throw 'Status roster returned rows for an unknown year.' }
if ($CheckProfiles) {
    foreach ($person in $staff) {
        $profile = Read-Api "/staff-profiles/$($person.staffId)/elevate-status?academicYear=$year"
        $awarded = @($profile.levels | Where-Object isAwarded)
        $highest = if ($awarded.Count) { ($awarded | Measure-Object levelNumber -Maximum).Maximum } else { 0 }
        if ($person.currentLevel -ne $highest -or $person.qualifyingAttendanceCount -ne $profile.internalCpdSessionsAttended) {
            throw "Named status differs from individual profile for $($person.staffId)."
        }
    }
}
$attendance = @(Read-Api "/reports/cpd-attendance?academicYear=$year")
$participation = @(Read-Api "/reports/staff-participation?academicYear=$year")
$cpdParticipation = @($participation | Where-Object processKey -eq 'cpd_event')
if ($attendance.Count -ne [long](($cpdParticipation | Measure-Object activeStaffCount -Sum).Sum)) {
    throw 'CPD attendance omitted eligible staff with zero attendance.'
}
$records = @(Read-Api "/reports/process-records?academicYear=$year&dashboardKey=overview")
foreach ($record in $records) {
    foreach ($property in @('ownerStaffId','submitterStaffId','submitterDisplayName','submittedAt')) {
        if (!$record.PSObject.Properties[$property]) { throw "Process rows omitted $property." }
    }
}
$results = foreach ($key in $DashboardKeys) {
    $started = Get-Date
    $data = Read-Api "/reports/report-record-data?academicYear=$year&dashboardKey=$key"
    if ($data.wasTruncated) { throw "Dashboard $key silently truncated form data." }
    foreach ($column in @($data.columns) + @($data.relatedTables | ForEach-Object columns)) {
        if ($column.label -match '^(Record ID|LIV case ID|Visibility|Visible to staff|Row version|Rowversion|Concurrency token)$') {
            throw "Dashboard $key exposed internal column $($column.label)."
        }
    }
    $primaryIds = @($data.rows | ForEach-Object recordId)
    if (@($primaryIds | Group-Object | Where-Object Count -gt 1).Count) { throw "Dashboard $key repeated its primary entry." }
    foreach ($table in @($data.relatedTables)) {
        if (@($table.rows | Where-Object { $_.recordId -notin $primaryIds }).Count) { throw "Dashboard $key exposed unrelated detail rows." }
    }
    [pscustomobject]@{ Dashboard=$key; Entries=@($data.rows).Count; Columns=@($data.columns).Count; DetailTables=@($data.relatedTables).Count; Seconds=[math]::Round(((Get-Date)-$started).TotalSeconds,2) }
}
$results | Format-Table -AutoSize
[pscustomobject]@{ AcademicYear=$AcademicYear; EligibleStatusStaff=$staff.Count; CpdStaff=$attendance.Count; CpdStaffWithNoAttendance=@($attendance | Where-Object attendanceCount -eq 0).Count; ProcessRecords=$records.Count; Result='PASS: named cohort parity, additive identity contract, business fields and parent-scoped details' }
