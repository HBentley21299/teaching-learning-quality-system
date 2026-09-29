-- Add eligible attendance and governed status awards for four synthetic staff only.
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
IF ISNULL(CONVERT(int,SERVERPROPERTY('IsLocalDB')),0)<>1 OR DB_NAME()<>N'TLQS'
 THROW 51000,'This fixture is restricted to local TLQS.',1;
BEGIN TRY
 BEGIN TRANSACTION;
 DECLARE @marker nvarchar(80)=N'[SYSTEM TEST 26/27]',@year nvarchar(7)=N'2026/27';
 DECLARE @actor uniqueidentifier=(SELECT TOP(1) a.id FROM auth.user_accounts a JOIN people.staff s ON s.id=a.staff_id WHERE s.external_id=N'STAFF_0001' AND a.archived_at IS NULL);
 IF @actor IS NULL THROW 51000,'Local administrator required.',1;
 DECLARE @staff TABLE(staff_id uniqueidentifier PRIMARY KEY,org_unit_id uniqueidentifier,level_number int);
 INSERT @staff SELECT id,primary_org_unit_id,CONVERT(int,RIGHT(external_id,2)) FROM people.staff
 WHERE external_id IN(N'SYSTEM-TEST-01',N'SYSTEM-TEST-02',N'SYSTEM-TEST-03',N'SYSTEM-TEST-04') AND archived_at IS NULL;
 IF (SELECT COUNT(*) FROM @staff)<>4 THROW 51000,'Four synthetic staff accounts required.',1;
 DECLARE @events TABLE(id uniqueidentifier PRIMARY KEY,event_date date);
 INSERT @events
 SELECT e.id,e.event_date FROM cpd.cpd_events e JOIN core.records r ON r.id=e.record_id
 CROSS APPLY(SELECT TOP(1) t.template_key,s.status FROM forms.form_submissions s
   JOIN forms.form_template_versions v ON v.id=s.form_template_version_id JOIN forms.form_templates t ON t.id=v.form_template_id
   WHERE s.record_id=r.id AND s.archived_at IS NULL ORDER BY s.created_at DESC,s.id DESC) submission
 WHERE LEFT(r.title,LEN(@marker))=@marker AND r.academic_year_key=@year
 AND r.archived_at IS NULL AND e.archived_at IS NULL AND submission.template_key=N'cpd_core' AND submission.status=N'submitted'
 AND e.event_date BETWEEN CONVERT(date,'2026-09-01') AND CONVERT(date,'2026-09-29');
 IF (SELECT COUNT(*) FROM @events)<>12 THROW 51000,'Twelve submitted internal CPD events required.',1;
 -- Prefer each member's existing attendance, then fill to the exact threshold.
 ;WITH desired AS (
 SELECT s.staff_id,s.org_unit_id,s.level_number,e.id,e.event_date,
 ROW_NUMBER() OVER(PARTITION BY s.staff_id ORDER BY CASE WHEN EXISTS(SELECT 1 FROM cpd.cpd_attendance a WHERE a.cpd_event_id=e.id AND a.staff_id=s.staff_id AND a.archived_at IS NULL AND a.attendance_status=N'Attended' AND a.milestone_credit=1) THEN 0 ELSE 1 END,e.event_date,e.id) sequence
 FROM @staff s CROSS JOIN @events e)
 INSERT cpd.cpd_attendance(id,cpd_event_id,staff_id,org_unit_id_at_time,attendance_status,milestone_credit,evidence_required,created_at)
 SELECT NEWID(),d.id,d.staff_id,d.org_unit_id,N'Attended',1,0,DATEADD(hour,11,CONVERT(datetimeoffset,d.event_date))
 FROM desired d WHERE d.sequence<=d.level_number*3
 AND NOT EXISTS(SELECT 1 FROM cpd.cpd_attendance a WHERE a.cpd_event_id=d.id AND a.staff_id=d.staff_id AND a.archived_at IS NULL);
 IF EXISTS(SELECT 1 FROM @staff s WHERE (SELECT COUNT(*) FROM cpd.cpd_attendance a JOIN @events e ON e.id=a.cpd_event_id WHERE a.staff_id=s.staff_id AND a.archived_at IS NULL AND a.attendance_status=N'Attended' AND a.milestone_credit=1)<s.level_number*3)
 THROW 51000,'Insufficient real eligible attendance for proposed test awards.',1;
 INSERT cpd.elevate_status_awards(id,staff_id,academic_year_key,level_number,qualifying_attendance_count,evidence_cpd_event_id,implementation_impact,confirmed_by_user_account_id,confirmed_at)
 SELECT NEWID(),s.staff_id,@year,level.level_number,level.level_number*3,
 CASE WHEN level.level_number=1 THEN evidence.id END,
 CASE WHEN level.level_number=1 THEN CONCAT(@marker,N' Synthetic implementation evidence: applied inclusive modelling and reviewed learner work samples.') END,
 @actor,CONVERT(datetimeoffset,'2026-09-28T12:00:00+00:00')
 FROM @staff s CROSS JOIN(VALUES(1),(2),(3),(4)) level(level_number)
 CROSS APPLY(SELECT TOP(1) e.id FROM @events e JOIN cpd.cpd_attendance a ON a.cpd_event_id=e.id WHERE a.staff_id=s.staff_id AND a.archived_at IS NULL AND a.attendance_status=N'Attended' AND a.milestone_credit=1 ORDER BY e.event_date,e.id) evidence
 WHERE level.level_number<=s.level_number AND NOT EXISTS(SELECT 1 FROM cpd.elevate_status_awards a WHERE a.staff_id=s.staff_id AND a.academic_year_key=@year AND a.level_number=level.level_number AND a.archived_at IS NULL);

 -- Keep the saved participant form answer consistent with the seeded attendance.
 UPDATE response SET response_text=attendees.staff_ids
 FROM forms.form_responses response JOIN forms.form_fields field ON field.id=response.form_field_id
 JOIN forms.form_submissions submission ON submission.id=response.form_submission_id
 JOIN cpd.cpd_events event ON event.record_id=submission.record_id JOIN @events allowed ON allowed.id=event.id
 CROSS APPLY(SELECT STRING_AGG(CONVERT(nvarchar(max),attendance.staff_id),N'|') staff_ids FROM cpd.cpd_attendance attendance
   JOIN people.staff staff ON staff.id=attendance.staff_id AND staff.external_id LIKE N'SYSTEM-TEST-[0-9][0-9]'
   WHERE attendance.cpd_event_id=event.id AND attendance.archived_at IS NULL) attendees
 WHERE field.field_key IN(N'staff_search',N'selected_staff_list');
 -- A test LIV with unfinished actions remains open even when its first visit is completed.
 DECLARE @reopen TABLE(id uniqueidentifier PRIMARY KEY);
 INSERT @reopen
 SELECT liv.id FROM quality.liv_records liv JOIN core.records record ON record.id=liv.record_id
 JOIN people.staff staff ON staff.id=liv.subject_staff_id AND staff.external_id LIKE N'SYSTEM-TEST-[0-9][0-9]'
 WHERE LEFT(record.title,LEN(@marker))=@marker AND record.academic_year_key=@year AND liv.status=N'closed'
 AND EXISTS(SELECT 1 FROM quality.actions action WHERE action.source_record_id=record.id AND action.archived_at IS NULL AND action.completed_date IS NULL);
 UPDATE liv SET status=N'in_progress',current_stage=N'visit_1',completion_date=NULL
 FROM quality.liv_records liv JOIN @reopen allowed ON allowed.id=liv.id;
 UPDATE cycle SET cycle_status=N'in_progress',completed_at=NULL
 FROM quality.liv_cycles cycle JOIN @reopen allowed ON allowed.id=cycle.liv_record_id;

 UPDATE action SET source_form_type=record.record_type
 FROM quality.actions action JOIN core.records record ON record.id=action.source_record_id
 JOIN people.staff staff ON staff.id=record.subject_staff_id AND staff.external_id LIKE N'SYSTEM-TEST-[0-9][0-9]'
 WHERE LEFT(record.title,LEN(@marker))=@marker AND record.academic_year_key=@year
 AND record.record_type IN(N'als_learning_walk',N'als_liv') AND LEFT(action.title,LEN(@marker))=@marker;
 COMMIT TRANSACTION;
 SELECT staff.external_id,COUNT(DISTINCT attendance.cpd_event_id) eligible_attendances,MAX(award.level_number) awarded_level
 FROM @staff fixture JOIN people.staff staff ON staff.id=fixture.staff_id
 JOIN cpd.cpd_attendance attendance ON attendance.staff_id=staff.id AND attendance.archived_at IS NULL AND attendance.attendance_status=N'Attended' AND attendance.milestone_credit=1
 JOIN @events event ON event.id=attendance.cpd_event_id
 JOIN cpd.elevate_status_awards award ON award.staff_id=staff.id AND award.academic_year_key=@year AND award.archived_at IS NULL
 GROUP BY staff.external_id ORDER BY staff.external_id;
END TRY
BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
 THROW;
END CATCH;
