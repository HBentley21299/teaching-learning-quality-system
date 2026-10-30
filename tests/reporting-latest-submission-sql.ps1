param([string]$ServerInstance = '(localdb)\MSSQLLocalDB')
# CTE-only fixture: exercises the actual fact SELECT without changing database objects or application records.
$ErrorActionPreference = 'Stop'
$source = Get-Content (Join-Path $PSScriptRoot '../apps/api/src/TLQS.Api/Data/ReportingDashboardDataStore.cs') -Raw
$queryMatch = [regex]::Match($source, '(?s)SELECT record\.id, record\.record_type, record\.occurred_on.*?N''focus_outcome''.*?AND submission\.status = N''submitted''')
if (!$queryMatch.Success) { throw 'Could not locate the Learning Walk latest-submission fact query.' }
$query = $queryMatch.Value.Replace('#visible_records','visible_records').Replace('forms.form_submissions','form_submissions').Replace('forms.form_responses','form_responses').Replace('forms.form_fields','form_fields')
$fixture = @'
WITH visible_records AS (
    SELECT 1 id, N'learning_walk' record_type, CONVERT(date,'2026-10-29') occurred_on,
           CAST(NULL AS int) org_unit_id, N'TEAM' area_code, N'Team' area_name, N'FAC' parent_area_code
), form_submissions AS (
    SELECT * FROM (VALUES
        (11,1,N'submitted',CONVERT(datetime2,'2026-10-01'),CAST(NULL AS int)),
        (12,1,N'__latest_status__',CONVERT(datetime2,'2026-10-29'),__latest_archive__)
    ) fixture(id,record_id,status,created_at,archived_at)
), form_responses AS (
    SELECT * FROM (VALUES
        (11,1,N'[{"focusId":"planning","focusName":"Planning","score":2,"rating":"Older response"}]',CAST(NULL AS int)),
        (12,1,N'[{"focusId":"planning","focusName":"Planning","score":4,"rating":"Latest response"}]',NULL)
    ) fixture(form_submission_id,form_field_id,response_text,archived_at)
), form_fields AS (
    SELECT 1 id,N'focus_rubric_ratings' field_key
)
'@
$cases = @(
    @{ Name='Latest submitted answer appears once'; Status='submitted'; Archived='NULL'; Expected='Latest response' },
    @{ Name='Latest draft contributes no historical answer'; Status='draft'; Archived='NULL'; Expected='' },
    @{ Name='Archived latest answer does not replace active submission'; Status='submitted'; Archived='1'; Expected='Older response' }
)
foreach ($case in $cases) {
    $cte = $fixture.Replace('__latest_status__',$case.Status).Replace('__latest_archive__',$case.Archived)
    $sql = "SET NOCOUNT ON; $cte SELECT value_label FROM ($query) selected(id,record_type,occurred_on,org_unit_id,area_code,area_name,parent_area_code,dimension_key,series_key,series_label,value_key,value_label,numeric_value);"
    $fixturePath = Join-Path ([IO.Path]::GetTempPath()) ('reporting-latest-' + [guid]::NewGuid().ToString('N') + '.sql')
    try {
        Set-Content -LiteralPath $fixturePath -Value $sql -Encoding utf8NoBOM
        $output = & sqlcmd -S $ServerInstance -d master -E -b -h -1 -W -i $fixturePath
    }
    finally { Remove-Item -LiteralPath $fixturePath -ErrorAction SilentlyContinue }
    if ($LASTEXITCODE -ne 0) { throw "SQL check failed for $($case.Name)." }
    $actual = (@($output | Where-Object { $_.Trim() }) -join '').Trim()
    if ($actual -ne $case.Expected) { throw "$($case.Name): expected '$($case.Expected)', got '$actual'." }
    Write-Output "PASS: $($case.Name)"
}
