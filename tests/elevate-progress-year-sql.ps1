param([string]$ServerInstance = '(localdb)\MSSQLLocalDB')
$ErrorActionPreference = 'Stop'
$source = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '../apps/api/src/TLQS.Api/Data/ElevatePracticeDataStore.cs')
$method = [regex]::Match($source, '(?s)GetElevatePracticeProgressAsync\(.*?QueryAsync\(\s*"""\s*(.*?)\s*""",')
if (!$method.Success) { throw 'The production ELI progress SELECT could not be extracted.' }
$query = $method.Groups[1].Value
foreach ($table in @('people.staff','org.org_units','quality.elevate_practice_assessments')) { $query = $query.Replace($table, $table.Replace('.', '_')) }
# Exercise the real production SELECT over CTE-only rows in master. No application
# data or database objects are created, seeded or changed.
$fixture = @'
SET NOCOUNT ON;
DECLARE @currentAcademicYear nvarchar(7) = N'2026/27';
DECLARE @academicYear nvarchar(7) = __YEAR__;
;WITH people_staff AS (
 SELECT 1 id,N'100' external_id,N'Active with history' display_name,N'one@example.test' email,1 primary_org_unit_id,N'active' account_status,CAST(NULL AS datetimeoffset) archived_at
 UNION ALL SELECT 2,N'200',N'Active without assessment',N'two@example.test',1,N'active',NULL
 UNION ALL SELECT 3,N'300',N'Former with history',N'three@example.test',1,N'inactive',NULL
 UNION ALL SELECT 4,N'400',N'Active with archived record',N'four@example.test',1,N'active',NULL
 UNION ALL SELECT 5,N'500',N'Former without assessment',N'five@example.test',1,N'inactive',NULL
), org_org_units AS (
 SELECT 1 id,N'team' org_unit_type,N'TEAM' code,N'Team' name,2 parent_org_unit_id,CAST(NULL AS datetimeoffset) archived_at
 UNION ALL SELECT 2,N'faculty',N'FAC',N'Faculty',NULL,NULL
), quality_elevate_practice_assessments AS (
 SELECT 11 id,111 record_id,1 staff_id,N'2026/27' academic_year,N'draft' status,CAST('2026-10-01' AS datetimeoffset) updated_at,CAST(NULL AS datetimeoffset) submitted_at,CAST(NULL AS datetimeoffset) archived_at
 UNION ALL SELECT 12,112,1,N'2024/25',N'submitted','2025-01-01','2025-01-01',NULL
 UNION ALL SELECT 31,131,3,N'2024/25',N'submitted','2025-01-01','2025-01-01',NULL
 UNION ALL SELECT 41,141,4,N'2024/25',N'submitted','2025-01-01','2025-01-01','2026-01-01'
)
'@
function Invoke-ProgressCase([string]$YearSql) {
    $output = & sqlcmd -S $ServerInstance -d master -E -b -h -1 -W -s '|' -Q ($fixture.Replace('__YEAR__', $YearSql) + "`n" + $query)
    if ($LASTEXITCODE -ne 0) { throw 'ELI progress SQL validation failed.' }
    return @($output | Where-Object { $_.Trim() } | ForEach-Object { ,($_.Trim() -split '\|') })
}
$all = @(Invoke-ProgressCase 'NULL')
if ($all.Count -ne 5) { throw "All years: expected 5 staff/year entries, received $($all.Count)." }
foreach ($expected in @('1|2026/27|draft','1|2024/25|submitted','2|2026/27|not_started','3|2024/25|submitted','4|2026/27|not_started')) {
    $matches = @($all | Where-Object { "$($_[2])|$($_[13])|$($_[10])" -eq $expected })
    if ($matches.Count -ne 1) { throw "All years did not return exactly one expected entry: $expected" }
}
Write-Output 'PASS: all years includes retained history, former staff records and active unstarted staff; archived assessments are excluded'
$current = @(Invoke-ProgressCase "N'2026/27'")
if ($current.Count -ne 3 -or @($current | Where-Object { $_[13] -ne '2026/27' -or $_[2] -in @('3','5') }).Count) { throw 'Current-year behavior changed or included former staff.' }
Write-Output 'PASS: current year retains active-staff behavior and selected-year output'
$historic = @(Invoke-ProgressCase "N'2024/25'")
if ($historic.Count -ne 3 -or @($historic | Where-Object { $_[13] -ne '2024/25' }).Count) { throw 'Explicit historical-year output is incomplete or mislabelled.' }
if (@($historic | Where-Object { $_[2] -eq '1' -and $_[10] -eq 'submitted' }).Count -ne 1) { throw 'Explicit historical assessment was not returned.' }
Write-Output 'PASS: explicit historical year returns that assessment and correctly labels unstarted entries'
