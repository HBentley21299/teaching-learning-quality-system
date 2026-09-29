param(
    [string]$ServerInstance = '(localdb)\MSSQLLocalDB',
    [string]$Database = 'TLQS'
)
$ErrorActionPreference = 'Stop'
# Exercise the real projection and visibility functions. Every fixture and every
# projection update is rolled back, including when an assertion throws.
$sql = @'
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
BEGIN TRY
    BEGIN TRANSACTION;
    DECLARE @d1 uniqueidentifier=NEWID(), @d2 uniqueidentifier=NEWID(),
        @faculty uniqueidentifier=NEWID(), @team uniqueidentifier=NEWID(), @standalone uniqueidentifier=NEWID(),
        @director1 uniqueidentifier=NEWID(), @director2 uniqueidentifier=NEWID(), @hof uniqueidentifier=NEWID(),
        @member uniqueidentifier=NEWID(), @a1 uniqueidentifier=NEWID(), @a2 uniqueidentifier=NEWID(),
        @suffix nvarchar(36)=CONVERT(nvarchar(36),NEWID());
    INSERT org.org_units(id,parent_org_unit_id,org_unit_type,code,name)
    VALUES(@d1,NULL,N'directorate',N'TD1-'+@suffix,N'Test directorate one'),
          (@d2,NULL,N'directorate',N'TD2-'+@suffix,N'Test directorate two'),
          (@faculty,@d1,N'faculty',N'TF-'+@suffix,N'Test faculty'),
          (@team,@faculty,N'team',N'TT-'+@suffix,N'Test team'),
          (@standalone,NULL,N'faculty',N'TS-'+@suffix,N'Test standalone faculty');
    INSERT people.staff(id,external_id,display_name,email,primary_org_unit_id)
    VALUES(@director1,N'TD1-'+@suffix,N'Test director one',N'd1-'+@suffix+N'@example.invalid',NULL),
          (@director2,N'TD2-'+@suffix,N'Test director two',N'd2-'+@suffix+N'@example.invalid',NULL),
          (@hof,N'TH-'+@suffix,N'Test head of faculty',N'h-'+@suffix+N'@example.invalid',@faculty),
          (@member,N'TM-'+@suffix,N'Test team member',N'm-'+@suffix+N'@example.invalid',@team);
    INSERT auth.user_accounts(id,staff_id) VALUES(@a1,@director1),(@a2,@director2);
    INSERT org.staff_org_memberships(staff_id,org_unit_id,is_primary)
    VALUES(@hof,@faculty,1),(@member,@team,1);
    INSERT org.org_unit_leaderships(org_unit_id,leader_staff_id)
    VALUES(@d1,@director1),(@d2,@director2),(@faculty,@hof);
    EXEC org.usp_rebuild_unit_management_projection;

    IF (SELECT COUNT(*) FROM auth.user_roles ur JOIN auth.roles r ON r.id=ur.role_id
        WHERE ur.user_account_id IN (@a1,@a2) AND r.role_key=N'director'
          AND ur.assignment_source=N'org_unit_leadership' AND ur.active_to IS NULL) <> 2
        THROW 51000,'Director assignments did not grant the director role.',1;
    IF (SELECT COUNT(*) FROM org.fn_visible_org_units(@a1) WHERE org_unit_id IN (@d1,@faculty,@team)) <> 3
        THROW 51000,'Director scope did not include its faculty and team.',1;
    IF EXISTS(SELECT 1 FROM org.fn_visible_org_units(@a1) WHERE org_unit_id IN (@d2,@standalone))
        THROW 51000,'Director scope leaked to unrelated units.',1;
    IF NOT EXISTS(SELECT 1 FROM org.staff_manager_relationships WHERE staff_id=@hof
        AND manager_staff_id=@director1 AND is_primary=1 AND archived_at IS NULL)
        THROW 51000,'Faculty leader did not report to the director.',1;
    IF NOT EXISTS(SELECT 1 FROM org.fn_visible_staff(@a1) WHERE staff_id=@member)
        THROW 51000,'Director cannot see staff in the child team.',1;
    PRINT 'PASS: Assigning a director grants the role, descendant scope and faculty reporting line.';

    UPDATE org.org_units SET parent_org_unit_id=@d2 WHERE id=@faculty;
    EXEC org.usp_rebuild_unit_management_projection;
    IF EXISTS(SELECT 1 FROM org.fn_visible_org_units(@a1) WHERE org_unit_id IN (@faculty,@team))
        THROW 51000,'Previous director retained access to the reallocated faculty.',1;
    IF (SELECT COUNT(*) FROM org.fn_visible_org_units(@a2) WHERE org_unit_id IN (@faculty,@team)) <> 2
        THROW 51000,'New director did not receive the reallocated faculty and team.',1;
    IF NOT EXISTS(SELECT 1 FROM org.staff_manager_relationships WHERE staff_id=@hof
        AND manager_staff_id=@director2 AND is_primary=1 AND archived_at IS NULL)
        THROW 51000,'Reallocation did not update the faculty leader reporting line.',1;
    IF EXISTS(SELECT 1 FROM org.fn_visible_staff(@a1) WHERE staff_id IN (@hof,@member))
        THROW 51000,'Previous director retained staff visibility after reallocation.',1;
    IF (SELECT COUNT(*) FROM org.fn_visible_staff(@a2) WHERE staff_id IN (@hof,@member)) <> 2
        THROW 51000,'New director did not receive staff visibility after reallocation.',1;
    PRINT 'PASS: Moving a faculty transfers descendant visibility and its head reporting line.';

    UPDATE org.org_unit_leaderships SET archived_at=SYSUTCDATETIME() WHERE org_unit_id=@d2;
    EXEC org.usp_rebuild_unit_management_projection;
    IF EXISTS(SELECT 1 FROM auth.user_roles ur JOIN auth.roles r ON r.id=ur.role_id
        WHERE ur.user_account_id=@a2 AND r.role_key=N'director'
          AND ur.assignment_source=N'org_unit_leadership' AND (ur.active_to IS NULL OR ur.active_to>SYSUTCDATETIME()))
        THROW 51000,'Removing director leadership retained the generated director role.',1;
    IF EXISTS(SELECT 1 FROM auth.access_scopes WHERE user_account_id=@a2
        AND assignment_source=N'org_unit_leadership' AND is_active=1 AND archived_at IS NULL)
        THROW 51000,'Removing director leadership retained generated scope.',1;
    IF EXISTS(SELECT 1 FROM org.fn_visible_staff(@a2) WHERE staff_id IN (@hof,@member))
        THROW 51000,'Former director retained generated staff visibility.',1;
    PRINT 'PASS: Removing director leadership revokes generated role, scope and reporting access.';

    UPDATE org.org_units SET parent_org_unit_id=NULL WHERE id=@faculty;
    EXEC org.usp_rebuild_unit_management_projection;
    IF EXISTS(SELECT 1 FROM org.staff_manager_relationships WHERE staff_id=@hof
        AND manager_staff_id IN (@director1,@director2) AND is_primary=1 AND archived_at IS NULL)
        THROW 51000,'Standalone faculty retained a director reporting line.',1;
    IF NOT EXISTS(SELECT 1 FROM org.org_units WHERE id=@standalone AND parent_org_unit_id IS NULL AND is_active=1)
        THROW 51000,'Unallocated faculty was changed.',1;
    IF NOT EXISTS(SELECT 1 FROM org.staff_manager_relationships WHERE staff_id=@member
        AND manager_staff_id=@hof AND is_primary=1 AND archived_at IS NULL)
        THROW 51000,'Standalone faculty lost its internal reporting line.',1;
    PRINT 'PASS: Faculties can remain separate while retaining their internal reporting structure.';
    ROLLBACK TRANSACTION;
    PRINT 'PASS: All test fixtures and projection changes rolled back.';
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
'@
$sql | & sqlcmd -S $ServerInstance -d $Database -E -No -C -b -r 1
if ($LASTEXITCODE -ne 0) { throw 'Directorate hierarchy integration regression failed.' }
