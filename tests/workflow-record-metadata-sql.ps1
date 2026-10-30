param([string]$ServerInstance = '(localdb)\MSSQLLocalDB')
# Run the actual listing SELECT against CTE-only data in master. No tables or application records are written.
$ErrorActionPreference = 'Stop'
$source = Get-Content (Join-Path $PSScriptRoot '../apps/api/src/TLQS.Api/Data/SqlFoundationDataStore.cs') -Raw
$start = $source.IndexOf('public Task<IReadOnlyList<RecordSummary>> GetRecordsAsync')
$end = $source.IndexOf('public async Task<RecordDetailSummary?> GetRecordDetailAsync', $start)
$query = [regex]::Match($source.Substring($start, $end - $start), '(?s)"""\s*(WITH.*?)\s*"""').Groups[1].Value
if (!$query) { throw 'The record listing query was not found.' }
$objects = @{
    'core.records'='records'; 'people.staff'='staff'; 'forms.form_submissions'='submissions';
    'forms.form_template_versions'='versions'; 'forms.form_templates'='templates'; 'auth.user_accounts'='accounts';
    'quality.elevate_environment_assessments'='environment_assessments'; 'quality.rooms'='rooms';
    'cpd.cpd_events'='cpd_events'; 'cpd.cpd_attendance'='cpd_attendance'; 'forms.form_responses'='responses';
    'forms.form_fields'='fields'; 'quality.learning_walk_record_themes'='record_themes'; 'core.lookup_values'='lookup_values';
    'org.fn_visible_staff(@currentUserAccountId)'='visible_staff_source'; 'org.fn_visible_org_units(@currentUserAccountId)'='visible_org_source'
}
foreach ($entry in $objects.GetEnumerator()) { $query = $query.Replace($entry.Key, $entry.Value) }
$columns = 'id,module_id,record_type,title,subject_staff_id,owner_staff_id,org_unit_id,record_date,created_at,submission_status,academic_year_key,is_mine,delivery_key,delivery_name,owner_name,subject_name,submitter_name,template_key,template_name,summary,theme_names,participant_names,room_code,building_name'
$query = $query.Replace('SELECT r.id, r.module_id', ", actual($columns) AS (`nSELECT r.id, r.module_id")
$query = $query.Replace('ORDER BY r.created_at DESC, r.id DESC OPTION (RECOMPILE);', ') SELECT * FROM actual ORDER BY id FOR JSON PATH, INCLUDE_NULL_VALUES;')

$fixture = @'
SET NOCOUNT ON;
DECLARE @currentUserAccountId int=1,@currentStaffId uniqueidentifier='10000000-0000-0000-0000-000000000001',
 @academicYear nvarchar(7)=N'2026/27',@canManageUco bit=1,@canViewAll bit=1,
 @canViewScopedActivities bit=1,@canViewStandardLearningWalk bit=1,@canViewAlsLearningWalk bit=1;
WITH records AS (
 SELECT id,1 module_id,record_type,CONCAT(N'Record ',id) title,
 CAST(NULL AS uniqueidentifier) subject_staff_id,CONVERT(uniqueidentifier,'10000000-0000-0000-0000-000000000001') owner_staff_id,
 CAST(NULL AS int) org_unit_id,CONVERT(date,'2026-10-01') record_date,CONVERT(datetimeoffset,'2026-10-01T00:00:00Z') created_at,
 N'2026/27' academic_year_key,1 created_by_user_account_id,CAST(NULL AS datetimeoffset) archived_at,summary
 FROM (VALUES(1,N'cpd_event',N'CPD draft'),(2,N'elevate_environment',N'Environment draft'),
 (3,N'learning_walk',N'Focus draft'),(4,N'als_learning_walk',N'ALS themes'),(5,N'liv',N'PRIVATE SECTION CONTENT'),
 (6,N'cpd_event',N'Published CPD'),(7,N'elevate_environment',N'Published environment'),(8,N'cpd_event',N'Latest draft')) v(id,record_type,summary)
), staff AS (
 SELECT CONVERT(uniqueidentifier,id) id,display_name FROM (VALUES
 ('10000000-0000-0000-0000-000000000001',N'Alice Teacher'),
 ('10000000-0000-0000-0000-000000000002',N'Bob Retired'),
 ('10000000-0000-0000-0000-000000000003',N'Charlie Teacher')) v(id,display_name)
), submissions AS (
 SELECT id,record_id,status,1 form_template_version_id,1 submitted_by_user_account_id,
 CONVERT(datetimeoffset,created_at) created_at,CAST(NULL AS datetimeoffset) archived_at
 FROM (VALUES(10,1,N'draft','2026-10-01'),(20,2,N'draft','2026-10-01'),(30,3,N'draft','2026-10-01'),
 (40,4,N'submitted','2026-10-01'),(50,5,N'submitted','2026-10-01'),(60,6,N'submitted','2026-10-01'),
 (70,7,N'submitted','2026-10-01'),(80,8,N'draft','2026-09-01'),(81,8,N'draft','2026-10-01')) v(id,record_id,status,created_at)
), versions AS (SELECT 1 id,1 form_template_id), templates AS (SELECT 1 id,N'cpd_core' template_key,N'Example form' name),
 accounts AS (SELECT 1 id,CONVERT(uniqueidentifier,'10000000-0000-0000-0000-000000000001') staff_id),
 environment_assessments AS (SELECT 7 record_id,1 room_id), rooms AS (SELECT 1 id,N'PROJECTED-1' room_code,N'Projected building' building_name),
 cpd_events AS (SELECT 1 id,6 record_id,CAST(NULL AS datetimeoffset) archived_at),
 cpd_attendance AS (SELECT 1 cpd_event_id,CONVERT(uniqueidentifier,'10000000-0000-0000-0000-000000000002') staff_id,CAST(NULL AS datetimeoffset) archived_at),
 fields AS (SELECT id,field_key FROM (VALUES(1,N'staff_search'),(2,N'room_code'),(3,N'building_name'),(4,N'learning_walk_theme'),(5,N'cpd_themes')) v(id,field_key)),
 responses AS (
 SELECT id,form_submission_id,form_field_id,CONVERT(nvarchar(max),response_text) response_text,
 CAST(NULL AS datetimeoffset) archived_at,CONVERT(datetimeoffset,'2026-10-01') updated_at,
 CAST(NULL AS nvarchar(max)) response_json,CAST(NULL AS int) response_lookup_value_id
 FROM (VALUES
 (1,10,1,N'10000000-0000-0000-0000-000000000001|10000000-0000-0000-0000-000000000002|bad-id|10000000-0000-0000-0000-000000000002'),
 (2,20,2,N'HISTORIC-2'),(3,20,3,N'Saved building'),(4,40,4,N'Legacy theme|Snapshot focus'),
 (5,50,4,N'PRIVATE THEME'),(6,60,1,N'10000000-0000-0000-0000-000000000001'),
 (7,70,2,N'SAVED-OLD'),(8,70,3,N'Old building'),
 (9,80,1,N'10000000-0000-0000-0000-000000000001'),(10,81,1,N'10000000-0000-0000-0000-000000000003')) v(id,form_submission_id,form_field_id,response_text)
), record_themes AS (
 SELECT record_id,theme_name_snapshot FROM (VALUES(3,N'Retired snapshot focus'),(4,N'Snapshot focus'),(5,N'PRIVATE FOCUS')) v(record_id,theme_name_snapshot)
), lookup_values AS (SELECT CAST(NULL AS int) id,CAST(NULL AS nvarchar(100)) display_name WHERE 1=0),
 visible_staff_source AS (SELECT id staff_id FROM staff),visible_org_source AS (SELECT CAST(NULL AS int) org_unit_id WHERE 1=0)
'@
$sql = $fixture + $query.Replace('WITH visible_staff AS', ', visible_staff AS')
$temporaryPath = Join-Path ([IO.Path]::GetTempPath()) ('workflow-record-metadata-' + [guid]::NewGuid().ToString('N') + '.sql')
try {
    Set-Content -LiteralPath $temporaryPath -Value $sql -Encoding utf8NoBOM
    $output = & sqlcmd -S $ServerInstance -d master -E -b -h -1 -y 8000 -w 65535 -i $temporaryPath
    if ($LASTEXITCODE -ne 0) { throw 'The real record-list metadata SQL failed.' }
    $rows = ((@($output | Where-Object { $_.Trim() }) -join '') | ConvertFrom-Json)
} finally { Remove-Item -LiteralPath $temporaryPath -ErrorAction SilentlyContinue }

function Equal($actual,$expected,[string]$label) {
    if ($actual -cne $expected) { throw "$label expected '$expected', got '$actual'." }
    Write-Output "PASS: $label"
}
Equal $rows.Count 8 'The unchanged permitted listing retains all eight fixture records'
$separator = [char]31
Equal ($rows | Where-Object id -eq 1).participant_names "Alice Teacher${separator}Bob Retired" 'Draft CPD resolves named participants and ignores duplicate/invalid IDs'
Equal ($rows | Where-Object id -eq 2).room_code 'HISTORIC-2' 'Draft environment retains saved room code'
Equal ($rows | Where-Object id -eq 2).building_name 'Saved building' 'Draft environment retains saved building name'
Equal ($rows | Where-Object id -eq 3).theme_names 'Retired snapshot focus' 'LIV focus filters include historical selected Learning Walk snapshots without a legacy answer'
Equal ($rows | Where-Object id -eq 4).theme_names "Legacy theme${separator}Snapshot focus" 'ALS themes union snapshots and legacy values without duplicates'
Equal ($rows | Where-Object id -eq 5).summary $null 'LIV section narrative remains excluded'
Equal ($rows | Where-Object id -eq 5).theme_names $null 'LIV private themes remain excluded'
Equal ($rows | Where-Object id -eq 6).participant_names 'Bob Retired' 'Submitted CPD retains authoritative attendance projection'
Equal ($rows | Where-Object id -eq 7).room_code 'PROJECTED-1' 'Submitted environment retains authoritative room projection'
Equal ($rows | Where-Object id -eq 8).participant_names 'Charlie Teacher' 'Draft participant fallback uses the latest active submission only'
