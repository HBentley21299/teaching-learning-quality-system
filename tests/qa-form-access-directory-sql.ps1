param([string]$ServerInstance = '(localdb)\MSSQLLocalDB')
$ErrorActionPreference = 'Stop'
$source = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '../apps/api/src/TLQS.Api/Data/QaFormAccessDataStore.cs')
$predicate = [regex]::Match($source, '(?s)private const string ActiveQaStaffSql = """\s*(.*?)\s*""";').Groups[1].Value
$directory = [regex]::Match($source, '(?s)private static readonly string QaFormAccessStaffDirectorySql = """\s*(.*?)\s*""" \+ ActiveQaStaffSql \+ """\s*(.*?)\s*""";')
if (!$predicate -or !$directory.Success) { throw 'The production QA Staff directory query could not be extracted.' }
$query = $directory.Groups[1].Value + "`n" + $predicate + "`n" + $directory.Groups[2].Value
foreach ($table in @('people.staff','auth.user_accounts','auth.user_roles','auth.roles','qa.activity_template_staff')) {
    $query = $query.Replace($table, $table.Replace('.', '_'))
}
# Execute the real SELECT against CTE-only rows in master. No application rows,
# database objects or access settings are created or changed.
$fixture = @'
SET NOCOUNT ON;
;WITH people_staff AS (
 SELECT 1 id, N'Active QA' display_name, N'active@example.test' email, N'active' account_status, CAST(NULL AS datetimeoffset) archived_at
 UNION ALL SELECT 2, N'Disabled previous selection', N'disabled@example.test', N'active', NULL
 UNION ALL SELECT 3, N'Expired previous selection', N'expired@example.test', N'active', NULL
 UNION ALL SELECT 4, N'Custom grant previous selection', N'custom@example.test', N'active', NULL
 UNION ALL SELECT 5, N'Inactive unlisted person', N'unlisted@example.test', N'inactive', NULL
 UNION ALL SELECT 6, N'QA plus custom grant', N'combined@example.test', N'active', NULL
), auth_user_accounts AS (
 SELECT id, id staff_id, CASE WHEN id=2 THEN 1 ELSE 0 END is_disabled, N'active' account_status, CAST(NULL AS datetimeoffset) archived_at FROM people_staff
), auth_user_roles AS (
 SELECT id user_account_id, CASE WHEN id=4 THEN 2 ELSE 1 END role_id,
 DATEADD(day,-1,sysutcdatetime()) active_from,
 CASE WHEN id=3 THEN DATEADD(hour,-1,sysutcdatetime()) ELSE CAST(NULL AS datetimeoffset) END active_to FROM people_staff
 UNION ALL SELECT 6, 2, DATEADD(day,-1,sysutcdatetime()), NULL
), auth_roles AS (
 SELECT 1 id, N'qa_staff' role_key, 1 is_active, CAST(NULL AS datetimeoffset) archived_at
 UNION ALL SELECT 2, N'custom_qa_submit', 1, NULL
), qa_activity_template_staff AS (
 SELECT 100 activity_template_id, 2 staff_id
 UNION ALL SELECT 200, 3
 UNION ALL SELECT 200, 4
)
'@
$output = & sqlcmd -S $ServerInstance -d master -E -b -h -1 -W -s '|' -Q ($fixture + "`n" + $query)
if ($LASTEXITCODE -ne 0) { throw 'QA form access directory SQL validation failed.' }
$rows = @($output | Where-Object { $_.Trim() })
$actual = @{}
foreach ($line in $rows) { $row = $line.Trim() -split '\|'; $actual[$row[0]] = $row[3] }
foreach ($case in @(@{Id='1';Eligible='1'}, @{Id='2';Eligible='0'}, @{Id='3';Eligible='0'}, @{Id='4';Eligible='0'}, @{Id='6';Eligible='1'})) {
    if ($actual[$case.Id] -ne $case.Eligible) { throw "Staff $($case.Id): expected eligibility $($case.Eligible), received $($actual[$case.Id])" }
    Write-Output "PASS: staff $($case.Id) eligibility $($case.Eligible)"
}
if ($actual.ContainsKey('5') -or $actual.Count -ne 5) { throw 'Unlisted ineligible staff must stay outside the directory, and joins must not duplicate people.' }
Write-Output 'PASS: unlisted ineligible staff excluded; multiple roles do not duplicate directory rows'
