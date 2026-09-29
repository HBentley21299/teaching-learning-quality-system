param([string]$ServerInstance = '(localdb)\MSSQLLocalDB')
$ErrorActionPreference = 'Stop'
$source = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '../apps/api/src/TLQS.Api/Data/ElevateValidationDataStore.cs')

function Get-TemporaryUpdateSql([string]$MethodName) {
    $methodStart = $source.IndexOf($MethodName, [StringComparison]::Ordinal)
    if ($methodStart -lt 0) { throw "Method not found: $MethodName" }
    $match = [regex]::Match($source.Substring($methodStart), '(?s)"""\s*(UPDATE quality\.elevate_practice_assessments.*?;)\s*"""')
    if (!$match.Success) { throw "Assessment update SQL not found: $MethodName" }
    $sql = $match.Groups[1].Value
    foreach ($table in @('quality.elevate_practice_assessments', 'quality.elevate_practice_validation_events', 'core.records')) {
        $sql = $sql.Replace($table, '#' + $table.Replace('.', '_'))
    }
    if ($sql -match '(?i)\b(?:quality|core|auth|people|org)\.') {
        throw 'Production table reference remained in the isolated SQL check.'
    }
    return $sql
}

$contentSql = Get-TemporaryUpdateSql 'RecordElevateContentChangeAsync('
$reviewSql = Get-TemporaryUpdateSql 'ReviewElevatePracticeAsync('

# Run the production update blocks against connection-local temporary tables in master.
# Application tables, schemas and saved assessments are never accessed or changed.
$fixture = @'
SET NOCOUNT ON;
SET XACT_ABORT ON;
CREATE TABLE #quality_elevate_practice_assessments (
    id uniqueidentifier PRIMARY KEY, status nvarchar(20), validation_status nvarchar(20),
    reviewed_at datetimeoffset NULL, reviewed_by_user_account_id uniqueidentifier NULL,
    validation_feedback nvarchar(4000) NULL, updated_at datetimeoffset NULL, row_version rowversion
);
CREATE TABLE #quality_elevate_practice_validation_events (
    assessment_id uniqueidentifier, action nvarchar(40), note nvarchar(4000) NULL,
    actor_user_account_id uniqueidentifier, created_at datetimeoffset DEFAULT sysutcdatetime()
);
CREATE TABLE #core_records (
    id uniqueidentifier PRIMARY KEY, summary nvarchar(200), updated_at datetimeoffset NULL,
    updated_by_user_account_id uniqueidentifier NULL
);
DECLARE @id uniqueidentifier='00000000-0000-0000-0000-000000000001',
    @record uniqueidentifier='00000000-0000-0000-0000-000000000002',
    @user uniqueidentifier='00000000-0000-0000-0000-000000000003',
    @other uniqueidentifier='00000000-0000-0000-0000-000000000004',
    @next nvarchar(20), @action nvarchar(40), @note nvarchar(4000), @version binary(8),
    @reviewedAt datetimeoffset='2026-09-01T12:00:00+00:00';
INSERT #quality_elevate_practice_assessments (id,status,validation_status)
VALUES (@id,N'submitted',N'pending'),(@other,N'submitted',N'pending');
INSERT #core_records(id,summary) VALUES(@record,N'Submitted annual self-assessment'),(@other,N'Unrelated');

SET @next=N'returned'; SET @note=N'Revisit the feedback statement.';
SELECT @version=row_version FROM #quality_elevate_practice_assessments WHERE id=@id;
'@
$returnCheck = @'
IF NOT EXISTS(SELECT 1 FROM #quality_elevate_practice_assessments WHERE id=@id AND status=N'draft'
    AND validation_status=N'returned' AND reviewed_by_user_account_id=@user AND reviewed_at IS NOT NULL
    AND validation_feedback=@note AND row_version<>@version)
    THROW 51000,'Return did not unlock and record its reviewer, feedback and new version.',1;
IF NOT EXISTS(SELECT 1 FROM #quality_elevate_practice_validation_events WHERE assessment_id=@id
    AND action=N'returned' AND note=@note AND actor_user_account_id=@user AND created_at IS NOT NULL)
    THROW 51000,'Return history was not recorded.',1;
IF NOT EXISTS(SELECT 1 FROM #core_records WHERE id=@record AND updated_by_user_account_id=@user
    AND summary=N'Self-assessment returned for amendments' AND updated_at IS NOT NULL)
    THROW 51000,'Return did not update the record summary.',1;
PRINT 'PASS: Return unlocks the assessment and records reviewer, feedback, history and version.';

DELETE FROM #quality_elevate_practice_validation_events;
UPDATE #quality_elevate_practice_assessments SET status=N'submitted',validation_status=N'pending',
    reviewed_at=NULL,reviewed_by_user_account_id=NULL,validation_feedback=NULL WHERE id=@id;
SET @next=N'validated'; SET @note=N'All statements reviewed and agreed.';
'@
$validateCheck = @'
IF NOT EXISTS(SELECT 1 FROM #quality_elevate_practice_assessments WHERE id=@id AND status=N'submitted'
    AND validation_status=N'validated' AND reviewed_by_user_account_id=@user AND reviewed_at IS NOT NULL
    AND validation_feedback=@note)
    THROW 51000,'Validation did not retain submission and record the decision.',1;
IF NOT EXISTS(SELECT 1 FROM #quality_elevate_practice_validation_events WHERE assessment_id=@id
    AND action=N'validated' AND note=@note AND actor_user_account_id=@user)
    THROW 51000,'Validation history was not recorded.',1;
IF NOT EXISTS(SELECT 1 FROM #core_records WHERE id=@record AND summary=N'Validated annual self-assessment')
    THROW 51000,'Validation did not update the record summary.',1;
PRINT 'PASS: Validation keeps the assessment submitted and records the decision.';

DELETE FROM #quality_elevate_practice_validation_events;
SET @next=N'pending'; SET @action=N'resubmitted'; SET @note=N'Agreed amendment with staff member present.';
SELECT @version=row_version FROM #quality_elevate_practice_assessments WHERE id=@id;
'@
$contentCheck = @'
IF NOT EXISTS(SELECT 1 FROM #quality_elevate_practice_assessments WHERE id=@id AND status=N'submitted'
    AND validation_status=N'pending' AND reviewed_at IS NULL AND reviewed_by_user_account_id IS NULL
    AND validation_feedback IS NULL AND row_version<>@version)
    THROW 51000,'Content amendment retained an obsolete validation decision.',1;
IF NOT EXISTS(SELECT 1 FROM #quality_elevate_practice_validation_events WHERE assessment_id=@id
    AND action=N'resubmitted' AND note=@note AND actor_user_account_id=@user)
    THROW 51000,'Content amendment history was not recorded.',1;
PRINT 'PASS: Amending validated content requires validation again and clears old review metadata.';

DELETE FROM #quality_elevate_practice_validation_events;
UPDATE #quality_elevate_practice_assessments SET status=N'draft',validation_status=N'returned',
    reviewed_at=@reviewedAt,reviewed_by_user_account_id=@user,validation_feedback=N'Revisit the feedback statement.'
    WHERE id=@id;
SET @next=N'returned'; SET @action=N'draft_saved'; SET @note=NULL;
'@
$draftCheck = @'
IF NOT EXISTS(SELECT 1 FROM #quality_elevate_practice_assessments WHERE id=@id AND status=N'draft'
    AND validation_status=N'returned' AND reviewed_at=@reviewedAt AND reviewed_by_user_account_id=@user
    AND validation_feedback=N'Revisit the feedback statement.')
    THROW 51000,'Draft save lost the open amendment request or its feedback.',1;
IF NOT EXISTS(SELECT 1 FROM #quality_elevate_practice_validation_events WHERE assessment_id=@id
    AND action=N'draft_saved' AND note IS NULL AND actor_user_account_id=@user)
    THROW 51000,'Draft save history was not recorded.',1;
IF NOT EXISTS(SELECT 1 FROM #quality_elevate_practice_assessments WHERE id=@other AND status=N'submitted'
    AND validation_status=N'pending' AND reviewed_at IS NULL AND validation_feedback IS NULL)
    OR NOT EXISTS(SELECT 1 FROM #core_records WHERE id=@other AND summary=N'Unrelated')
    OR EXISTS(SELECT 1 FROM #quality_elevate_practice_validation_events WHERE assessment_id<>@id)
    THROW 51000,'An unrelated assessment or record was changed.',1;
PRINT 'PASS: Draft save preserves returned feedback; unrelated assessments remain unchanged.';
'@

$sql = @($fixture, $reviewSql, $returnCheck, $reviewSql, $validateCheck, $contentSql, $contentCheck, $contentSql, $draftCheck) -join "`n"
$temporarySqlPath = [IO.Path]::GetTempFileName()
try {
    Set-Content -LiteralPath $temporarySqlPath -Value $sql -Encoding utf8
    & sqlcmd -S $ServerInstance -d master -E -b -l 60 -i $temporarySqlPath
    if ($LASTEXITCODE -ne 0) { throw 'ELI validation SQL verification failed.' }
}
finally {
    Remove-Item -LiteralPath $temporarySqlPath -Force
}
