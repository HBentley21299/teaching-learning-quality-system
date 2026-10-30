param([string]$ServerInstance = '(localdb)\MSSQLLocalDB')

$ErrorActionPreference = 'Stop'
if ($ServerInstance -notmatch '^(\(localdb\)\\[^\\]+|\.|localhost)$') {
    throw 'Run this regression check against a local SQL Server instance only.'
}

$root = Split-Path -Parent $PSScriptRoot
$migration = [IO.File]::ReadAllText((Join-Path $root 'database/migrations/091_liv_section_visibility.sql'))
$match = [regex]::Match($migration, '(?s)CREATE OR ALTER FUNCTION quality\.fn_liv_action_access\(.*?\bRETURN\s*\(\s*(?<query>SELECT.*?)\r?\n\);\s*\r?\nGO')
if (!$match.Success) { throw 'Could not locate the LIV action-section visibility function SELECT.' }
$query = $match.Groups['query'].Value
foreach ($table in @('actions', 'liv_records', 'liv_visits', 'liv_stages', 'liv_cycles')) {
    $query = $query.Replace("quality.$table", "#$table")
}
foreach ($table in @('user_accounts', 'user_roles', 'roles', 'role_permissions', 'permissions')) {
    $query = $query.Replace("auth.$table", "#$table")
}
if ($query -match '\b(?:quality|auth)\.') {
    throw 'The function now reads an unmapped application table; update this isolated regression harness.'
}
$query = $query.Replace("'", "''")
$sqlPath = Join-Path ([IO.Path]::GetTempPath()) ('LivSectionVisibility_' + [guid]::NewGuid().ToString('N') + '.sql')

# Exercise the migration's actual predicate with synthetic session-local tables.
# The application database, existing staff records and stored functions are untouched.
$sql = @'
SET NOCOUNT ON;
SET XACT_ABORT ON;
CREATE TABLE #actions (id uniqueidentifier, source_record_id uniqueidentifier NULL, liv_cycle_id uniqueidentifier NULL,
    liv_visit_id uniqueidentifier NULL, source_sub_record_type nvarchar(100) NULL, source_sub_record_id uniqueidentifier NULL);
CREATE TABLE #liv_records (id uniqueidentifier, record_id uniqueidentifier, process_key nvarchar(100),
    created_by_user_account_id uniqueidentifier NULL, reviewer_staff_id uniqueidentifier NULL, archived_at datetimeoffset NULL);
CREATE TABLE #liv_cycles (id uniqueidentifier, liv_record_id uniqueidentifier, cycle_number int);
CREATE TABLE #liv_visits (id uniqueidentifier, cycle_id uniqueidentifier);
CREATE TABLE #liv_stages (liv_cycle_id uniqueidentifier, stage_type nvarchar(100), visible_to_staff bit, archived_at datetimeoffset NULL);
CREATE TABLE #user_accounts (id uniqueidentifier, staff_id uniqueidentifier NULL);
CREATE TABLE #user_roles (user_account_id uniqueidentifier, role_id uniqueidentifier, active_from datetimeoffset, active_to datetimeoffset NULL);
CREATE TABLE #roles (id uniqueidentifier, is_active bit, archived_at datetimeoffset NULL);
CREATE TABLE #role_permissions (role_id uniqueidentifier, permission_id uniqueidentifier);
CREATE TABLE #permissions (id uniqueidentifier, permission_key nvarchar(100), archived_at datetimeoffset NULL);
CREATE TABLE #actual (can_view bit);
CREATE TABLE #cases (
    id int IDENTITY PRIMARY KEY, label nvarchar(200), expected bit,
    reader_kind nvarchar(30) NOT NULL DEFAULT N'subject', process_key nvarchar(100) NOT NULL DEFAULT N'liv',
    first_shared bit NOT NULL DEFAULT 0, second_shared bit NOT NULL DEFAULT 0,
    creator_present bit NOT NULL DEFAULT 1, reviewer_present bit NOT NULL DEFAULT 1,
    liv_archived bit NOT NULL DEFAULT 0, stage_archived bit NOT NULL DEFAULT 0,
    source_kind nvarchar(30) NOT NULL DEFAULT N'liv', link_kind nvarchar(50) NOT NULL DEFAULT N'cycle_1',
    stage_type nvarchar(100) NOT NULL DEFAULT N'actions', permission_key nvarchar(100) NULL,
    role_active bit NOT NULL DEFAULT 1, role_archived bit NOT NULL DEFAULT 0,
    permission_archived bit NOT NULL DEFAULT 0, assignment_state nvarchar(30) NOT NULL DEFAULT N'active'
);

INSERT #cases (label, expected) VALUES
    (N'Subject cannot see a hidden actions section', 0);
INSERT #cases (label, expected, first_shared) VALUES
    (N'Subject can see a shared actions section', 1, 1);
INSERT #cases (label, expected, reader_kind) VALUES
    (N'Creator can read a hidden section', 1, N'creator'),
    (N'Reviewer can read a hidden section', 1, N'reviewer'),
    (N'Unrelated reader gets no hidden data', 0, N'unrelated');
INSERT #cases (label, expected, reader_kind, first_shared) VALUES
    (N'Shared section predicate leaves outer record scope to the caller', 1, N'unrelated', 1);
INSERT #cases (label, expected, permission_key) VALUES
    (N'Standard LIV manager can read hidden standard sections', 1, N'liv.manage'),
    (N'ALS manager does not gain hidden standard LIV sections', 0, N'als_liv.manage'),
    (N'User administrator can read hidden sections', 1, N'users.manage'),
    (N'Sensitive permission can read hidden sections', 1, N'liv.sensitive.read'),
    (N'Broad report permission does not disclose hidden sections', 0, N'reports.view_all');
INSERT #cases (label, expected, process_key, permission_key) VALUES
    (N'ALS manager can read hidden ALS sections', 1, N'als_liv', N'als_liv.manage'),
    (N'Standard manager does not gain hidden ALS sections', 0, N'als_liv', N'liv.manage'),
    (N'Sensitive permission applies to ALS sections', 1, N'als_liv', N'liv.sensitive.read');
INSERT #cases (label, expected, process_key, first_shared) VALUES
    (N'ALS subject can read a shared section', 1, N'als_liv', 1);
INSERT #cases (label, expected, permission_key, role_active) VALUES
    (N'Inactive role cannot disclose hidden sections', 0, N'liv.manage', 0);
INSERT #cases (label, expected, permission_key, role_archived) VALUES
    (N'Archived role cannot disclose hidden sections', 0, N'liv.manage', 1);
INSERT #cases (label, expected, permission_key, permission_archived) VALUES
    (N'Archived permission cannot disclose hidden sections', 0, N'liv.manage', 1);
INSERT #cases (label, expected, permission_key, assignment_state) VALUES
    (N'Expired role assignment cannot disclose hidden sections', 0, N'liv.manage', N'expired'),
    (N'Future role assignment cannot disclose hidden sections', 0, N'liv.manage', N'future');
INSERT #cases (label, expected, creator_present, reviewer_present) VALUES
    (N'Null creator and reviewer do not disclose hidden sections', 0, 0, 0);
INSERT #cases (label, expected, creator_present, reviewer_present, first_shared) VALUES
    (N'Null creator and reviewer still permit explicitly shared sections', 1, 0, 0, 1);
INSERT #cases (label, expected, reader_kind, creator_present) VALUES
    (N'Null creator does not match a creator account', 0, N'creator', 0);
INSERT #cases (label, expected, reader_kind, reviewer_present) VALUES
    (N'Null reviewer does not match a reviewer account', 0, N'reviewer', 0);
INSERT #cases (label, expected, liv_archived, first_shared) VALUES
    (N'Archived LIV hides previously shared sections', 0, 1, 1);
INSERT #cases (label, expected, liv_archived, reader_kind) VALUES
    (N'Archived LIV is unavailable to its creator', 0, 1, N'creator');
INSERT #cases (label, expected, source_kind) VALUES
    (N'Unrelated non-LIV action remains unaffected', 1, N'non_liv'),
    (N'Standalone action remains unaffected', 1, N'standalone'),
    (N'Missing action is not authorized', 0, N'missing');
INSERT #cases (label, expected, first_shared, stage_archived) VALUES
    (N'Archived actions section cannot share actions', 0, 1, 1);
INSERT #cases (label, expected, first_shared, stage_type) VALUES
    (N'Sharing the visit section does not share actions', 0, 1, N'visit');
INSERT #cases (label, expected, link_kind, first_shared, second_shared) VALUES
    (N'Cycle 2 direct link reads its shared actions section', 1, N'cycle_2', 0, 1),
    (N'Cycle 2 direct link cannot borrow cycle 1 visibility', 0, N'cycle_2', 1, 0),
    (N'Legacy source-cycle link uses the matching section', 1, N'source_cycle_2', 0, 1),
    (N'Legacy source-cycle link cannot borrow another cycle visibility', 0, N'source_cycle_2', 1, 0),
    (N'Direct visit link resolves to its cycle', 1, N'visit_2', 0, 1),
    (N'Direct visit link cannot borrow another cycle visibility', 0, N'visit_2', 1, 0),
    (N'Legacy source-visit link resolves to its cycle', 1, N'source_visit_2', 0, 1),
    (N'Legacy source-visit link cannot borrow another cycle visibility', 0, N'source_visit_2', 1, 0),
    (N'Unlinked legacy action falls back to the first cycle', 1, N'legacy', 1, 0),
    (N'Later shared cycle does not disclose an unlinked legacy action', 0, N'legacy', 0, 1),
    (N'Direct cycle takes precedence over source cycle and visit', 0, N'cycle_1_precedence', 0, 1),
    (N'Source cycle takes precedence over visit cycle', 0, N'source_cycle_1_precedence', 0, 1),
    (N'Direct visit takes precedence over source visit', 0, N'visit_1_precedence', 0, 1),
    (N'Unrelated cycle cannot borrow LIV visibility', 0, N'unrelated_cycle', 1, 1);

DECLARE @record uniqueidentifier = NEWID(), @liv uniqueidentifier = NEWID(), @action uniqueidentifier = NEWID(),
    @cycle1 uniqueidentifier = NEWID(), @cycle2 uniqueidentifier = NEWID(), @visit1 uniqueidentifier = NEWID(), @visit2 uniqueidentifier = NEWID(),
    @subjectAccount uniqueidentifier = NEWID(), @creatorAccount uniqueidentifier = NEWID(), @reviewerAccount uniqueidentifier = NEWID(),
    @subjectStaff uniqueidentifier = NEWID(), @reviewerStaff uniqueidentifier = NEWID(), @other uniqueidentifier = NEWID(),
    @role uniqueidentifier = NEWID(), @permission uniqueidentifier = NEWID(), @reader uniqueidentifier,
    @query nvarchar(max), @caseId int = 1, @total int = (SELECT COUNT(*) FROM #cases), @actualCount int,
    @label nvarchar(200), @expected bit, @readerKind nvarchar(30), @process nvarchar(100), @firstShared bit, @secondShared bit,
    @creatorPresent bit, @reviewerPresent bit, @livArchived bit, @stageArchived bit, @sourceKind nvarchar(30), @linkKind nvarchar(50),
    @stageType nvarchar(100), @permissionKey nvarchar(100), @roleActive bit, @roleArchived bit, @permissionArchived bit, @assignment nvarchar(30);
'@

$sql += "`nSET @query = N'$query';`n"
$sql += @'
WHILE @caseId <= @total
BEGIN
    SELECT @label = label, @expected = expected, @readerKind = reader_kind, @process = process_key,
        @firstShared = first_shared, @secondShared = second_shared, @creatorPresent = creator_present,
        @reviewerPresent = reviewer_present, @livArchived = liv_archived, @stageArchived = stage_archived,
        @sourceKind = source_kind, @linkKind = link_kind, @stageType = stage_type, @permissionKey = permission_key,
        @roleActive = role_active, @roleArchived = role_archived, @permissionArchived = permission_archived,
        @assignment = assignment_state
    FROM #cases WHERE id = @caseId;

    TRUNCATE TABLE #actions;
    TRUNCATE TABLE #liv_records;
    TRUNCATE TABLE #liv_cycles;
    TRUNCATE TABLE #liv_visits;
    TRUNCATE TABLE #liv_stages;
    TRUNCATE TABLE #user_accounts;
    TRUNCATE TABLE #user_roles;
    TRUNCATE TABLE #roles;
    TRUNCATE TABLE #role_permissions;
    TRUNCATE TABLE #permissions;
    TRUNCATE TABLE #actual;

    SET @reader = CASE @readerKind WHEN N'creator' THEN @creatorAccount WHEN N'reviewer' THEN @reviewerAccount
        WHEN N'unrelated' THEN @other ELSE @subjectAccount END;
    INSERT #user_accounts VALUES (@subjectAccount, @subjectStaff), (@creatorAccount, @other), (@reviewerAccount, @reviewerStaff), (@other, @other);
    INSERT #liv_records VALUES (@liv, @record, @process, CASE WHEN @creatorPresent = 1 THEN @creatorAccount END,
        CASE WHEN @reviewerPresent = 1 THEN @reviewerStaff END, CASE WHEN @livArchived = 1 THEN sysutcdatetime() END);
    INSERT #liv_cycles VALUES (@cycle1, @liv, 1), (@cycle2, @liv, 2), (@other, @other, 1);
    INSERT #liv_visits VALUES (@visit1, @cycle1), (@visit2, @cycle2);
    INSERT #liv_stages VALUES (@cycle1, @stageType, @firstShared, CASE WHEN @stageArchived = 1 THEN sysutcdatetime() END),
        (@cycle2, @stageType, @secondShared, CASE WHEN @stageArchived = 1 THEN sysutcdatetime() END);
    IF @sourceKind <> N'missing'
        INSERT #actions VALUES (@action, CASE @sourceKind WHEN N'non_liv' THEN @other WHEN N'standalone' THEN NULL ELSE @record END,
            CASE @linkKind WHEN N'cycle_1' THEN @cycle1 WHEN N'cycle_2' THEN @cycle2 WHEN N'cycle_1_precedence' THEN @cycle1
                WHEN N'unrelated_cycle' THEN @other END,
            CASE @linkKind WHEN N'visit_2' THEN @visit2 WHEN N'visit_1_precedence' THEN @visit1
                WHEN N'cycle_1_precedence' THEN @visit2 WHEN N'source_cycle_1_precedence' THEN @visit2 END,
            CASE WHEN @linkKind IN (N'source_cycle_2', N'cycle_1_precedence', N'source_cycle_1_precedence') THEN N'liv_cycle'
                WHEN @linkKind IN (N'source_visit_2', N'visit_1_precedence') THEN N'liv_visit' END,
            CASE WHEN @linkKind = N'source_cycle_1_precedence' THEN @cycle1
                WHEN @linkKind IN (N'source_cycle_2', N'cycle_1_precedence') THEN @cycle2
                WHEN @linkKind IN (N'source_visit_2', N'visit_1_precedence') THEN @visit2 END);
    IF @permissionKey IS NOT NULL
    BEGIN
        INSERT #roles VALUES (@role, @roleActive, CASE WHEN @roleArchived = 1 THEN sysutcdatetime() END);
        INSERT #permissions VALUES (@permission, @permissionKey, CASE WHEN @permissionArchived = 1 THEN sysutcdatetime() END);
        INSERT #role_permissions VALUES (@role, @permission);
        INSERT #user_roles VALUES (@reader, @role,
            DATEADD(day, CASE WHEN @assignment = N'future' THEN 1 ELSE -1 END, sysutcdatetime()),
            CASE WHEN @assignment = N'expired' THEN DATEADD(hour, -1, sysutcdatetime()) END);
    END;

    INSERT #actual EXEC sys.sp_executesql @query,
        N'@actionId uniqueidentifier, @currentUserAccountId uniqueidentifier', @action, @reader;
    SELECT @actualCount = COUNT(*) FROM #actual;
    IF @actualCount <> CONVERT(int, @expected) OR EXISTS (SELECT 1 FROM #actual WHERE can_view <> 1 OR can_view IS NULL)
    BEGIN
        DECLARE @failure nvarchar(2048) = CONCAT(N'LIV section regression failed: ', @label,
            N'. Expected ', @expected, N' authorized rows; received ', @actualCount, N'.');
        THROW 51000, @failure, 1;
    END;
    PRINT CONCAT(N'PASS: ', @label);
    SET @caseId += 1;
END;
PRINT CONCAT(@total, N' LIV section/action visibility SQL regression checks passed using session-local tables in tempdb.');
'@

try {
    [IO.File]::WriteAllText($sqlPath, $sql)
    & sqlcmd -S $ServerInstance -d tempdb -E -No -C -b -r 1 -l 15 -t 30 -i $sqlPath
    if ($LASTEXITCODE -ne 0) { throw 'LIV section visibility SQL regression checks failed.' }
}
finally {
    Remove-Item -LiteralPath $sqlPath -Force -ErrorAction SilentlyContinue
}
