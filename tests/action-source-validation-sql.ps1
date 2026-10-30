param([string]$ServerInstance = '(localdb)\MSSQLLocalDB')

$ErrorActionPreference = 'Stop'
if ($ServerInstance -notmatch '^(\(localdb\)\\[^\\]+|\.|localhost)$') {
    throw 'Run this regression check against a local SQL Server instance only.'
}
$root = Split-Path -Parent $PSScriptRoot
$source = [IO.File]::ReadAllText((Join-Path $root 'apps/api/src/TLQS.Api/Data/SqlFoundationDataStore.cs'))
$sqlPath = Join-Path ([IO.Path]::GetTempPath()) ('ActionSourceValidation_' + [guid]::NewGuid().ToString('N') + '.sql')

# Execute the actual action-source queries against session-local tables. No
# application database or existing records are read, seeded, or changed.
# These columns match migrations 017, 027 and 031: observations have no archived_at.
$sql = @'
SET NOCOUNT ON;
SET XACT_ABORT ON;
CREATE TABLE #probation_cases (id uniqueidentifier, record_id uniqueidentifier, archived_at datetimeoffset NULL);
CREATE TABLE #probation_observations (id uniqueidentifier, probation_case_id uniqueidentifier);
CREATE TABLE #liv_records (id uniqueidentifier, record_id uniqueidentifier, archived_at datetimeoffset NULL);
CREATE TABLE #liv_visits (id uniqueidentifier, liv_record_id uniqueidentifier, archived_at datetimeoffset NULL);
CREATE TABLE #liv_cycles (id uniqueidentifier, liv_record_id uniqueidentifier);
CREATE TABLE #matches (match_count int);
DECLARE @record uniqueidentifier = NEWID(), @parent uniqueidentifier = NEWID(), @child uniqueidentifier = NEWID(), @other uniqueidentifier = NEWID();
INSERT #probation_cases VALUES (@parent, @record, NULL);
INSERT #probation_observations VALUES (@child, @parent);
INSERT #liv_records VALUES (@parent, @record, NULL);
INSERT #liv_visits VALUES (@child, @parent, NULL);
INSERT #liv_cycles VALUES (@child, @parent);
DECLARE @query nvarchar(max);
'@

foreach ($type in @('liv_visit', 'liv_cycle', 'probation_observation')) {
    $pattern = '(?s)if \(string.Equals\(sourceSubRecordType, "' + $type + '".*?"""\s*(?<query>SELECT COUNT\(\*\).*?;)\s*"""'
    $match = [regex]::Match($source, $pattern)
    if (!$match.Success) { throw "Could not locate the $type action-source validation query." }
    $query = $match.Groups['query'].Value
    foreach ($table in @('probation_cases', 'probation_observations', 'liv_records', 'liv_visits', 'liv_cycles')) {
        $query = $query.Replace("quality.$table", "#$table")
    }
    $query = $query.Replace("'", "''")
    $childParameter = switch ($type) {
        'liv_visit' { '@livVisitId' }
        'liv_cycle' { '@livCycleId' }
        'probation_observation' { '@observationId' }
    }
    $parentTable = if ($type -eq 'probation_observation') { '#probation_cases' } else { '#liv_records' }
    $sql += @"

SET @query = N'$query';
INSERT #matches EXEC sys.sp_executesql @query, N'$childParameter uniqueidentifier, @sourceRecordId uniqueidentifier', @child, @record;
IF (SELECT match_count FROM #matches) <> 1 THROW 51000, '$type rejected a valid source link.', 1;
TRUNCATE TABLE #matches;
INSERT #matches EXEC sys.sp_executesql @query, N'$childParameter uniqueidentifier, @sourceRecordId uniqueidentifier', @child, @other;
IF (SELECT match_count FROM #matches) <> 0 THROW 51000, '$type accepted an unrelated source record.', 1;
TRUNCATE TABLE #matches;
INSERT #matches EXEC sys.sp_executesql @query, N'$childParameter uniqueidentifier, @sourceRecordId uniqueidentifier', @other, @record;
IF (SELECT match_count FROM #matches) <> 0 THROW 51000, '$type accepted a missing child record.', 1;
TRUNCATE TABLE #matches;
UPDATE $parentTable SET archived_at = sysutcdatetime();
INSERT #matches EXEC sys.sp_executesql @query, N'$childParameter uniqueidentifier, @sourceRecordId uniqueidentifier', @child, @record;
IF (SELECT match_count FROM #matches) <> 0 THROW 51000, '$type accepted an archived source.', 1;
TRUNCATE TABLE #matches;
UPDATE $parentTable SET archived_at = NULL;
PRINT '${type}: valid, unrelated, missing and archived source checks passed.';
"@
}

try {
    [IO.File]::WriteAllText($sqlPath, $sql)
    & sqlcmd -S $ServerInstance -d tempdb -E -No -C -b -r 1 -l 15 -t 30 -i $sqlPath
    if ($LASTEXITCODE -ne 0) { throw 'Action-source SQL regression checks failed.' }
}
finally {
    Remove-Item -LiteralPath $sqlPath -Force -ErrorAction SilentlyContinue
}
