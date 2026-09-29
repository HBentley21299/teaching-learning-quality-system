param([string]$ServerInstance = '(localdb)\MSSQLLocalDB')
$ErrorActionPreference = 'Stop'
$source = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '../apps/api/src/TLQS.Api/Data/QaFormAccessDataStore.cs')
$match = [regex]::Match($source, '(?s)SELECT activity.id, template.restrict_qa_staff,.*?WHERE activity.review_id = @review;')
if (!$match.Success) { throw 'QA form access query not found.' }
$query = $match.Value.Replace(' WITH (HOLDLOCK)', '')
foreach ($table in @('qa.activity_template_staff','qa.review_activities','qa.activity_templates','auth.user_roles','auth.roles','auth.role_permissions','auth.permissions')) {
    $query = $query.Replace($table, $table.Replace('.', '_'))
}
# Execute the production query against inline CTEs in master; no application data or objects are changed.
$fixture = @'
DECLARE @review uniqueidentifier='00000000-0000-0000-0000-000000000001';
DECLARE @user uniqueidentifier='00000000-0000-0000-0000-000000000002';
DECLARE @staff uniqueidentifier='00000000-0000-0000-0000-000000000003';
;WITH qa_review_activities AS (
 SELECT @review id, @review review_id, @review activity_template_id
), qa_activity_templates AS (
 SELECT @review id, CAST(@restricted AS bit) restrict_qa_staff
), qa_activity_template_staff AS (
 SELECT @review activity_template_id, @staff staff_id WHERE @listed=1
), auth_user_roles AS (
 SELECT @user user_account_id, 1 role_id, DATEADD(day,-1,sysutcdatetime()) active_from, CAST(NULL AS datetimeoffset) active_to WHERE @qa=1
 UNION ALL
 SELECT @user, 2, DATEADD(day,-1,sysutcdatetime()), CASE WHEN @expired=1 THEN DATEADD(hour,-1,sysutcdatetime()) END WHERE @independent=1
), auth_roles AS (
 SELECT 1 id, N'qa_staff' role_key, 1 is_active, CAST(NULL AS datetimeoffset) archived_at
 UNION ALL SELECT 2, N'director', 1, NULL
), auth_role_permissions AS (
 SELECT 2 role_id, 1 permission_id
), auth_permissions AS (
 SELECT 1 id, N'qa_reviews.submit_all' permission_key
)
'@
$cases = @(
 @{Name='Restricted unlisted QA staff';Restricted=1;Listed=0;Qa=1;Independent=0;Expired=0;Expected='1|0|1|0'},
 @{Name='Whitelisted QA staff';Restricted=1;Listed=1;Qa=1;Independent=0;Expired=0;Expected='1|1|1|0'},
 @{Name='Unrestricted QA form';Restricted=0;Listed=0;Qa=1;Independent=0;Expired=0;Expected='0|0|1|0'},
 @{Name='Independent director grant';Restricted=1;Listed=0;Qa=1;Independent=1;Expired=0;Expected='1|0|1|1'},
 @{Name='Expired independent grant cannot bypass';Restricted=1;Listed=0;Qa=1;Independent=1;Expired=1;Expected='1|0|1|0'},
 @{Name='Other staff roles remain distinct';Restricted=1;Listed=0;Qa=0;Independent=0;Expired=0;Expected='1|0|0|0'}
)
foreach ($case in $cases) {
 $sql = "SET NOCOUNT ON; DECLARE @restricted int=$($case.Restricted), @listed int=$($case.Listed), @qa int=$($case.Qa), @independent int=$($case.Independent), @expired int=$($case.Expired);`n$fixture`n$query"
 $output = & sqlcmd -S $ServerInstance -d master -E -b -h -1 -W -s '|' -Q $sql
 if ($LASTEXITCODE -ne 0) { throw "SQL validation failed: $($case.Name)" }
 $actual = ((($output | Where-Object { $_.Trim() }) -join '').Trim() -split '\|',2)[1]
 if ($actual -ne $case.Expected) { throw "$($case.Name): expected $($case.Expected), received $actual" }
 Write-Output "PASS: $($case.Name)"
}
