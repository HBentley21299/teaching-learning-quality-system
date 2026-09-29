-- Targeted LocalDB cleanup. Dry-run is the default; invoked by remove-local-system-test-data.ps1.
-- Never run during application startup. Keep the application stopped and take a verified backup first.
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET ANSI_WARNINGS ON;
SET ANSI_PADDING ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;
IF ISNULL(CONVERT(int,SERVERPROPERTY('IsLocalDB')),0)<>1 OR DB_NAME()<>N'TLQS'
    THROW 51000,'Cleanup is restricted to the local TLQS database.',1;
DECLARE @apply bit=COALESCE(TRY_CONVERT(bit,SESSION_CONTEXT(N'ApplySystemTestCleanup')),0);

BEGIN TRY
BEGIN TRANSACTION;
-- Serializable locks keep the reviewed set stable until commit/rollback.
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
CREATE TABLE #RecordIds(id uniqueidentifier PRIMARY KEY,reason nvarchar(200));
INSERT #RecordIds
SELECT id,N'Explicit SYSTEM TEST marker' FROM core.records
WHERE LEFT(title,LEN(N'[SYSTEM TEST 26/27]'))=N'[SYSTEM TEST 26/27]'
 OR LEFT(title,LEN(N'[SYSTEM TEST] Draft lifecycle '))=N'[SYSTEM TEST] Draft lifecycle ';
INSERT #RecordIds
SELECT id,N'QA review explicitly titled Test' FROM core.records r
WHERE id='098E0571-2521-4DC8-9DFE-4E06B2525804' AND record_type=N'qa_review' AND title=N'Test'
 AND NOT EXISTS(SELECT 1 FROM #RecordIds x WHERE x.id=r.id);
INSERT #RecordIds
SELECT e.record_id,N'Evidence belonging to explicitly identified test review'
FROM qa.evidence_submissions e JOIN #RecordIds r ON r.id=e.review_id
WHERE NOT EXISTS(SELECT 1 FROM #RecordIds x WHERE x.id=e.record_id);
-- Harry explicitly requested this dummy ELI for Pl Demo. Keep its Entra account.
IF (SELECT COUNT(*) FROM quality.elevate_practice_assessments a JOIN people.staff s ON s.id=a.staff_id
    WHERE s.external_id=N'ENTRA_9e91bedd37fdf905f48ba668abf97ac5')>1
    THROW 51000,'More than one Pl Demo ELI exists; identify the dummy assessment before cleanup.',1;
INSERT #RecordIds
SELECT a.record_id,N'User-confirmed dummy ELI belonging to Pl Demo'
FROM quality.elevate_practice_assessments a JOIN people.staff s ON s.id=a.staff_id
WHERE s.external_id=N'ENTRA_9e91bedd37fdf905f48ba668abf97ac5'
  AND a.record_id='2136125E-4280-4C7F-BC60-7C4F91155C36'
  AND NOT EXISTS(SELECT 1 FROM #RecordIds x WHERE x.id=a.record_id);

CREATE TABLE #StaffIds(id uniqueidentifier PRIMARY KEY);
INSERT #StaffIds SELECT s.id FROM people.staff s
WHERE s.external_id IN(N'SYSTEM-TEST-01',N'SYSTEM-TEST-02',N'SYSTEM-TEST-03',N'SYSTEM-TEST-04',
 N'SYSTEM-TEST-05',N'SYSTEM-TEST-06',N'SYSTEM-TEST-07',N'SYSTEM-TEST-08',N'SYSTEM-TEST-09',N'SYSTEM-TEST-10',N'SYSTEM-TEST-11',N'SYSTEM-TEST-12');
IF EXISTS(SELECT 1 FROM people.staff s JOIN #StaffIds x ON x.id=s.id
 WHERE s.email NOT LIKE N'system.test.%@ielevate.local' OR s.notes NOT LIKE N'[[]SYSTEM TEST 26/27]%')
    THROW 51000,'A SYSTEM-TEST identity no longer matches fixture provenance; review it manually.',1;
CREATE TABLE #AccountIds(id uniqueidentifier PRIMARY KEY);
INSERT #AccountIds SELECT a.id FROM auth.user_accounts a JOIN #StaffIds s ON s.id=a.staff_id;
-- Fixture012 creates no external login identities. Any real identity is a hard stop.
IF EXISTS(SELECT 1 FROM auth.auth_identities a JOIN #AccountIds x ON x.id=a.user_account_id)
    THROW 51000,'A test account has an external login identity; preserve and review it manually.',1;

-- Only these operational/identity rows can enter the delete set. All other tables,
-- including organisation units, room registers, form definitions and configuration, stay protected.
CREATE TABLE #Allowed(name nvarchar(256) PRIMARY KEY);
INSERT #Allowed SELECT TRIM(REPLACE(REPLACE(value,CHAR(13),N''),CHAR(10),N'')) FROM STRING_SPLIT(N'
core.records,people.staff,auth.user_accounts,auth.user_roles,auth.access_scopes,auth.auth_identities,auth.local_credentials,
org.staff_org_memberships,org.staff_manager_relationships,org.org_unit_leaderships,org.migration_review_items,
forms.form_submissions,forms.form_responses,curriculum.courses,
cpd.cpd_events,cpd.cpd_attendance,cpd.elevate_status_awards,
quality.actions,quality.action_extensions,quality.activities,quality.learning_walk_details,quality.learning_walk_record_themes,
quality.work_scrutiny_details,quality.work_scrutiny_course_samples,quality.elevate_environment_assessments,
quality.elevate_environment_pillar_ratings,quality.elevate_environment_action_links,
quality.coaching_assignments,quality.coaching_cycles,quality.coaching_sessions,quality.coaching_action_reviews,quality.coaching_previous_action_updates,
quality.liv_records,quality.liv_cycles,quality.liv_stages,quality.liv_visits,quality.liv_visit_ratings,quality.liv_record_themes,
quality.probation_cases,quality.probation_observations,quality.probation_observation_stages,quality.probation_observation_visits,quality.probation_observation_ratings,quality.probation_case_reviewers,
quality.elevate_practice_assessments,quality.elevate_practice_selections,quality.elevate_practice_reflections,quality.elevate_practice_ratings,
quality.elevate_practice_area_ratings,quality.elevate_practice_liv_information,quality.elevate_practice_development_plans,quality.elevate_practice_validation_events,
quality.staff_reflections,quality.staff_reflection_development_areas,quality.staff_reflection_focus_areas,
quality.uco_tla_reviews,quality.uco_tla_section_progress,quality.uco_tla_action_plans,quality.uco_tla_follow_ups,
qa.reviews,qa.review_activities,qa.review_question_selections,qa.review_questions,qa.review_scopes,qa.review_contributors,
qa.evidence_submissions,qa.evidence_team_scopes,qa.evidence_responses,qa.evidence_revisions,
qa.action_groups,qa.action_group_assignments,qa.action_group_teams,qa.dashboard_snapshots,qa.activity_template_staff,
ops.audit_logs,ops.domain_events,ops.notifications,ops.export_jobs,ops.message_outbox,ops.message_outbox_recipients,ops.message_delivery_attempts,ops.message_attachments,
evidence.evidence_items,evidence.file_attachments,evidence.file_assets,reporting.saved_report_views',N',');

-- Metadata discovers dependency rows (including composite keys), never arbitrary table names from input.
CREATE TABLE #Tables(object_id int PRIMARY KEY,name nvarchar(256),qualified nvarchar(520),key_expression nvarchar(max),allowed bit);
INSERT #Tables
SELECT t.object_id,s.name+N'.'+t.name,QUOTENAME(s.name)+N'.'+QUOTENAME(t.name),
 CASE WHEN pk.columns IS NOT NULL THEN N'(SELECT '+pk.columns+N' FOR JSON PATH, INCLUDE_NULL_VALUES, WITHOUT_ARRAY_WRAPPER)' END,
 CONVERT(bit,CASE WHEN a.name IS NULL THEN 0 ELSE 1 END)
FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id
LEFT JOIN #Allowed a ON a.name=s.name+N'.'+t.name
OUTER APPLY(SELECT STRING_AGG(CONVERT(nvarchar(max),N't.'+QUOTENAME(c.name)+N' AS '+QUOTENAME(c.name)),N',') WITHIN GROUP(ORDER BY ic.key_ordinal) columns
 FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id
 JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
 WHERE i.object_id=t.object_id AND i.is_primary_key=1)pk
WHERE t.is_ms_shipped=0;
IF EXISTS(SELECT 1 FROM #Tables WHERE allowed=1 AND key_expression IS NULL)
 THROW 51000,'An operational table has no primary key; cleanup requires schema review.',1;
CREATE TABLE #Rows(object_id int NOT NULL,key_hash binary(32) NOT NULL,row_key nvarchar(max) NOT NULL,PRIMARY KEY(object_id,key_hash));
DECLARE @id int,@name nvarchar(256),@table nvarchar(520),@key nvarchar(max),@sql nvarchar(max),@count int;
DECLARE roots CURSOR LOCAL FAST_FORWARD FOR
 SELECT object_id,name,qualified,key_expression FROM #Tables WHERE name IN(N'core.records',N'people.staff',N'auth.user_accounts',N'curriculum.courses');
OPEN roots; FETCH NEXT FROM roots INTO @id,@name,@table,@key;
WHILE @@FETCH_STATUS=0
BEGIN
 SET @sql=N'INSERT #Rows SELECT '+CONVERT(nvarchar(12),@id)+N',HASHBYTES(''SHA2_256'',k.row_key),k.row_key FROM '+@table+N' t CROSS APPLY(SELECT '+@key+N' row_key)k WHERE '+
 CASE @name WHEN N'core.records' THEN N't.id IN(SELECT id FROM #RecordIds)' WHEN N'people.staff' THEN N't.id IN(SELECT id FROM #StaffIds)'
 WHEN N'auth.user_accounts' THEN N't.id IN(SELECT id FROM #AccountIds)'
 ELSE N't.source_system=N''TLQS_SYSTEM_TEST'' AND t.course_code LIKE N''SYSTEM26-%'' AND t.course_name LIKE N''[[]SYSTEM TEST 26/27]%''' END+N';';
 EXEC sys.sp_executesql @sql;
 FETCH NEXT FROM roots INTO @id,@name,@table,@key;
END;
CLOSE roots; DEALLOCATE roots;

CREATE TABLE #FK(id int PRIMARY KEY,child_id int,parent_id int,join_sql nvarchar(max),null_sql nvarchar(max));
INSERT #FK
SELECT f.object_id,f.parent_object_id,f.referenced_object_id,
 STRING_AGG(CONVERT(nvarchar(max),N't.'+QUOTENAME(c.name)+N'=p.'+QUOTENAME(pc.name)),N' AND '),
 CASE WHEN MIN(CONVERT(int,c.is_nullable))=1 THEN STRING_AGG(CONVERT(nvarchar(max),N't.'+QUOTENAME(c.name)+N'=NULL'),N',') END
FROM sys.foreign_keys f JOIN sys.foreign_key_columns fc ON fc.constraint_object_id=f.object_id
JOIN sys.columns c ON c.object_id=fc.parent_object_id AND c.column_id=fc.parent_column_id
JOIN sys.columns pc ON pc.object_id=fc.referenced_object_id AND pc.column_id=fc.referenced_column_id
WHERE f.is_disabled=0 GROUP BY f.object_id,f.parent_object_id,f.referenced_object_id;
DECLARE @child int,@parent int,@parent_table nvarchar(520),@parent_key nvarchar(max),@join nvarchar(max),@null nvarchar(max),@added int=1;
WHILE @added>0
BEGIN
 SET @added=0;
 DECLARE dependencies CURSOR LOCAL FAST_FORWARD FOR
 SELECT f.child_id,f.parent_id,t.qualified,t.key_expression,p.qualified,REPLACE(p.key_expression,N't.[',N'p.['),f.join_sql
 FROM #FK f JOIN #Tables t ON t.object_id=f.child_id AND t.allowed=1 JOIN #Tables p ON p.object_id=f.parent_id
 WHERE t.name NOT IN(N'core.records',N'people.staff',N'auth.user_accounts',N'curriculum.courses')
 AND EXISTS(SELECT 1 FROM #Rows r WHERE r.object_id=f.parent_id);
 OPEN dependencies; FETCH NEXT FROM dependencies INTO @child,@parent,@table,@key,@parent_table,@parent_key,@join;
 WHILE @@FETCH_STATUS=0
 BEGIN
  SET @sql=N'INSERT #Rows SELECT DISTINCT @child,HASHBYTES(''SHA2_256'',k.row_key),k.row_key FROM '+@table+N' t CROSS APPLY(SELECT '+@key+N' row_key)k
   JOIN '+@parent_table+N' p ON '+@join+N' JOIN #Rows r ON r.object_id=@parent AND r.key_hash=HASHBYTES(''SHA2_256'','+@parent_key+N')
   WHERE NOT EXISTS(SELECT 1 FROM #Rows x WHERE x.object_id=@child AND x.key_hash=HASHBYTES(''SHA2_256'',k.row_key))
   OPTION(RECOMPILE, MAXDOP 1, MAX_GRANT_PERCENT=1); SET @count=@@ROWCOUNT;';
  EXEC sys.sp_executesql @sql,N'@child int,@parent int,@count int OUTPUT',@child,@parent,@count OUTPUT;
  SET @added+=@count;
  FETCH NEXT FROM dependencies INTO @child,@parent,@table,@key,@parent_table,@parent_key,@join;
 END;
 CLOSE dependencies; DEALLOCATE dependencies;
END;

-- A dependency must never pull data belonging to an unselected record into the set.
DECLARE record_links CURSOR LOCAL FAST_FORWARD FOR
SELECT t.object_id,t.qualified,t.key_expression,c.name FROM #Tables t JOIN sys.columns c ON c.object_id=t.object_id
WHERE c.name IN(N'record_id',N'source_record_id',N'elevate_practice_record_id',N'evidence_record_id',N'review_record_id',N'review_id')
 AND c.system_type_id=36 AND EXISTS(SELECT 1 FROM #Rows r WHERE r.object_id=t.object_id);
DECLARE @column sysname;
OPEN record_links; FETCH NEXT FROM record_links INTO @id,@table,@key,@column;
WHILE @@FETCH_STATUS=0
BEGIN
 SET @sql=N'IF EXISTS(SELECT 1 FROM '+@table+N' t JOIN #Rows x ON x.object_id=@id AND x.key_hash=HASHBYTES(''SHA2_256'','+@key+N')
 JOIN core.records r ON r.id=t.'+QUOTENAME(@column)+N' WHERE NOT EXISTS(SELECT 1 FROM #RecordIds z WHERE z.id=r.id)) THROW 51000,''A dependency belongs to a preserved record; no data was removed.'',1;';
 EXEC sys.sp_executesql @sql,N'@id int',@id;
 FETCH NEXT FROM record_links INTO @id,@table,@key,@column;
END;
CLOSE record_links; DEALLOCATE record_links;

-- Block all inbound references from preserved rows, even if a FK has cascading deletion.
DECLARE boundaries CURSOR LOCAL FAST_FORWARD FOR
SELECT f.child_id,f.parent_id,t.qualified,t.key_expression,p.qualified,REPLACE(p.key_expression,N't.[',N'p.['),f.join_sql
FROM #FK f JOIN #Tables t ON t.object_id=f.child_id JOIN #Tables p ON p.object_id=f.parent_id
WHERE EXISTS(SELECT 1 FROM #Rows r WHERE r.object_id=f.parent_id);
OPEN boundaries; FETCH NEXT FROM boundaries INTO @child,@parent,@table,@key,@parent_table,@parent_key,@join;
WHILE @@FETCH_STATUS=0
BEGIN
 SET @sql=N'IF EXISTS(SELECT 1 FROM '+@table+N' t JOIN '+@parent_table+N' p ON '+@join+N'
 JOIN #Rows r ON r.object_id=@parent AND r.key_hash=HASHBYTES(''SHA2_256'','+@parent_key+N') WHERE '+
 CASE WHEN @key IS NULL THEN N'1=1' ELSE N'NOT EXISTS(SELECT 1 FROM #Rows x WHERE x.object_id=@child AND x.key_hash=HASHBYTES(''SHA2_256'','+@key+N'))' END+
 N') THROW 51000,''Preserved rows reference selected test data in '+REPLACE(@table,N'''',N'''''')+N'; review before cleanup.'',1;';
 EXEC sys.sp_executesql @sql,N'@child int,@parent int',@child,@parent;
 FETCH NEXT FROM boundaries INTO @child,@parent,@table,@key,@parent_table,@parent_key,@join;
END;
CLOSE boundaries; DEALLOCATE boundaries;

SELECT r.id,records.record_type,records.title,r.reason FROM #RecordIds r JOIN core.records records ON records.id=r.id ORDER BY records.record_type,records.title;
SELECT s.external_id,s.display_name FROM people.staff s JOIN #StaffIds x ON x.id=s.id ORDER BY s.external_id;
SELECT t.name,COUNT_BIG(*) rows_to_delete FROM #Rows r JOIN #Tables t ON t.object_id=r.object_id GROUP BY t.name ORDER BY t.name;
SELECT id,record_type,title AS preserved_record FROM core.records WHERE id NOT IN(SELECT id FROM #RecordIds);

IF @apply=0
BEGIN
 ROLLBACK;
 PRINT 'DRY RUN: identified rows only. No persistent data changed.';
 RETURN;
END;

-- Snapshot counts/checksums of every preserved row, including all configuration and Entra accounts.
CREATE TABLE #Preserved(object_id int PRIMARY KEY,row_count bigint,checksum_value int);
DECLARE snapshots CURSOR LOCAL FAST_FORWARD FOR SELECT object_id,qualified,key_expression FROM #Tables;
OPEN snapshots; FETCH NEXT FROM snapshots INTO @id,@table,@key;
WHILE @@FETCH_STATUS=0
BEGIN
 SET @sql=N'INSERT #Preserved SELECT @id,COUNT_BIG(*),CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM '+@table+N' t'+
 CASE WHEN @key IS NULL THEN N'' ELSE N' WHERE NOT EXISTS(SELECT 1 FROM #Rows r WHERE r.object_id=@id AND r.key_hash=HASHBYTES(''SHA2_256'','+@key+N'))' END+N';';
 EXEC sys.sp_executesql @sql,N'@id int',@id;
 FETCH NEXT FROM snapshots INTO @id,@table,@key;
END;
CLOSE snapshots; DEALLOCATE snapshots;

-- Delete children first without changing any nullable reference. The current selected
-- operational tables have no cross-table FK cycle. Row-level leaf passes handle action,
-- membership and UCO parent chains. An actual cycle aborts and rolls back for review;
-- nulling unrelated evidence links would violate their business CHECK constraints.
DECLARE @remaining bigint=(SELECT COUNT_BIG(*) FROM #Rows),@removed int,@blocked nvarchar(max);
WHILE @remaining>0
BEGIN
 SET @removed=0;
 DECLARE deletion CURSOR LOCAL FAST_FORWARD FOR
 SELECT t.object_id,t.qualified,t.key_expression FROM #Tables t WHERE EXISTS(SELECT 1 FROM #Rows r WHERE r.object_id=t.object_id);
 OPEN deletion; FETCH NEXT FROM deletion INTO @id,@table,@key;
 WHILE @@FETCH_STATUS=0
 BEGIN
  SELECT @blocked=STRING_AGG(CONVERT(nvarchar(max),N' AND NOT EXISTS(SELECT 1 FROM '+c.qualified+N' child WHERE '+REPLACE(REPLACE(f.join_sql,N't.[',N'child.['),N'p.[',N't.[')+N')'),N'')
  FROM #FK f JOIN #Tables c ON c.object_id=f.child_id WHERE f.parent_id=@id;
  SET @sql=N'DELETE t FROM '+@table+N' t JOIN #Rows r ON r.object_id=@id AND r.key_hash=HASHBYTES(''SHA2_256'','+@key+N') WHERE 1=1 '+COALESCE(@blocked,N'')+N' OPTION(RECOMPILE, MAXDOP 1, MAX_GRANT_PERCENT=1); SET @count=@@ROWCOUNT;
  DELETE r FROM #Rows r WHERE r.object_id=@id AND NOT EXISTS(SELECT 1 FROM '+@table+N' t WHERE HASHBYTES(''SHA2_256'','+@key+N')=r.key_hash) OPTION(RECOMPILE, MAXDOP 1, MAX_GRANT_PERCENT=1);';
  EXEC sys.sp_executesql @sql,N'@id int,@count int OUTPUT',@id,@count OUTPUT;
  SET @removed+=@count;
  FETCH NEXT FROM deletion INTO @id,@table,@key;
 END;
 CLOSE deletion; DEALLOCATE deletion;
 SET @remaining=(SELECT COUNT_BIG(*) FROM #Rows);
 IF @remaining>0 AND @removed=0 THROW 51000,'Dependency cycle blocked cleanup; all changes rolled back for review.',1;
END;

DECLARE verify CURSOR LOCAL FAST_FORWARD FOR SELECT object_id,qualified FROM #Tables;
OPEN verify; FETCH NEXT FROM verify INTO @id,@table;
WHILE @@FETCH_STATUS=0
BEGIN
 SET @sql=N'IF EXISTS(SELECT COUNT_BIG(*) n,CHECKSUM_AGG(BINARY_CHECKSUM(*)) c FROM '+@table+N' EXCEPT SELECT row_count,checksum_value FROM #Preserved WHERE object_id=@id)
 THROW 51000,''Preservation invariant failed for '+REPLACE(@table,N'''',N'''''')+N'; all changes rolled back.'',1;';
 EXEC sys.sp_executesql @sql,N'@id int',@id;
 FETCH NEXT FROM verify INTO @id,@table;
END;
CLOSE verify; DEALLOCATE verify;
IF EXISTS(SELECT 1 FROM core.records r JOIN #RecordIds x ON x.id=r.id) OR EXISTS(SELECT 1 FROM people.staff s JOIN #StaffIds x ON x.id=s.id)
 THROW 51000,'A selected fixture remains; all changes rolled back.',1;
COMMIT;
PRINT 'COMMITTED: selected test data removed. Preserved-row counts/checksums and retained configuration verified.';
END TRY
BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK;
 THROW;
END CATCH;
