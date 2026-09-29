-- Explicit local-only fixture, authorised by Harry. Run after 012 staff/process fixture.
-- Additive and idempotent: reruns leave existing marked records and user edits intact.
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET ANSI_WARNINGS ON;
SET ANSI_PADDING ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;
IF ISNULL(CONVERT(int,SERVERPROPERTY('IsLocalDB')),0)<>1 THROW 51000,'This fixture is restricted to LocalDB.',1;
BEGIN TRY
BEGIN TRANSACTION;
DECLARE @marker nvarchar(60)=N'[SYSTEM TEST 26/27]', @year nvarchar(20)=N'2026/27';
DECLARE @admin uniqueidentifier=(SELECT TOP(1) a.id FROM auth.user_accounts a JOIN people.staff s ON s.id=a.staff_id WHERE s.external_id=N'STAFF_0001');
DECLARE @observer uniqueidentifier=(SELECT id FROM people.staff WHERE external_id=N'SYSTEM-TEST-01');
IF @admin IS NULL OR @observer IS NULL THROW 51000,'Run the system-test staff fixture first; local admin and test staff are required.',1;
DECLARE @module uniqueidentifier=(SELECT id FROM core.modules WHERE module_key=N'qa_reviews');
DECLARE @review uniqueidentifier, @cycle int=1;
WHILE @cycle<=2
BEGIN
 DECLARE @title nvarchar(300)=CONCAT(@marker,N' QA cycle ',@cycle);
 SELECT @review=id FROM core.records WHERE title=@title AND record_type=N'qa_review';
 IF @review IS NULL
 BEGIN
  SET @review=NEWID();
  INSERT core.records(id,module_id,record_type,title,summary,owner_staff_id,record_date,academic_year_key,created_by_user_account_id,updated_by_user_account_id)
  VALUES(@review,@module,N'qa_review',@title,N'Synthetic QA evidence for dashboard and export testing.',@observer,'2026-09-28',@year,@admin,@admin);
  INSERT qa.reviews(record_id,review_theme,intended_purpose,status,planned_open_date,closing_date,opened_at,opened_by_user_account_id,question_tag)
  VALUES(@review,CONCAT(N'Synthetic quality review ',@cycle),N'Test configured QA forms and reporting without altering question banks.',N'open','2026-09-01','2026-12-18','2026-09-01',@admin,N'general');
  INSERT qa.review_activities(review_id,activity_type_id,activity_template_id,display_order)
  SELECT @review,a.id,t.id,a.display_order FROM qa.activity_types a
  CROSS APPLY(SELECT TOP(1) t.id FROM qa.activity_templates t WHERE t.activity_type_id=a.id AND t.is_active=1 AND t.archived_at IS NULL
    ORDER BY (SELECT COUNT(*) FROM qa.activity_template_questions tq JOIN qa.questions q ON q.id=tq.question_id AND q.is_retired=0 WHERE tq.activity_template_id=t.id) DESC,t.template_key) t
  WHERE a.is_active=1 AND a.archived_at IS NULL;
  INSERT qa.review_question_selections(review_activity_id,question_id,display_order)
  SELECT a.id,q.id,tq.display_order FROM qa.review_activities a JOIN qa.activity_template_questions tq ON tq.activity_template_id=a.activity_template_id
  JOIN qa.questions q ON q.id=tq.question_id AND q.is_retired=0 AND q.archived_at IS NULL
  WHERE a.review_id=@review AND EXISTS(SELECT 1 FROM qa.question_versions v WHERE v.question_id=q.id AND v.is_active=1 AND v.source_status=N'active');
  INSERT qa.review_questions(review_activity_id,source_question_id,source_question_version_id,source_version_number,theme_or_week,question_text,guidance,display_order,is_required,allows_not_applicable,comment_required_at_expected,question_tag)
  SELECT s.review_activity_id,s.question_id,v.id,v.version_number,v.theme_or_week,v.question_text,v.guidance,s.display_order,v.is_required,v.allows_not_applicable,v.comment_required_at_expected,v.question_tag
  FROM qa.review_question_selections s JOIN qa.review_activities a ON a.id=s.review_activity_id
  CROSS APPLY(SELECT TOP(1) * FROM qa.question_versions v WHERE v.question_id=s.question_id AND v.is_active=1 AND v.source_status=N'active' ORDER BY v.version_number DESC)v WHERE a.review_id=@review;
  DECLARE @activities TABLE(n int,id uniqueidentifier,name nvarchar(200));
  DELETE FROM @activities;
  INSERT @activities SELECT ROW_NUMBER() OVER(ORDER BY t.display_order,t.activity_key),a.id,t.name FROM qa.review_activities a JOIN qa.activity_types t ON t.id=a.activity_type_id WHERE a.review_id=@review;
  DECLARE @n int=1,@count int=(SELECT COUNT(*) FROM @activities);
  WHILE @n<=@count
  BEGIN
   DECLARE @staff uniqueidentifier,@team uniqueidentifier,@faculty uniqueidentifier,@activity uniqueidentifier,@name nvarchar(200),@evidence uniqueidentifier=NEWID();
   SELECT @staff=id,@team=primary_org_unit_id FROM people.staff WHERE external_id=CONCAT(N'SYSTEM-TEST-',RIGHT(CONCAT('0',1+((@n-1)%8)),2));
   SELECT @faculty=parent_org_unit_id FROM org.org_units WHERE id=@team;
   IF NOT EXISTS(SELECT 1 FROM org.org_units WHERE id=@faculty AND org_unit_type=N'faculty') THROW 51000,'QA test staff must belong to a team with a faculty parent.',1;
   SELECT @activity=id,@name=name FROM @activities WHERE n=@n;
   INSERT qa.review_scopes(review_id,org_unit_id,scope_type,org_unit_code_snapshot,org_unit_name_snapshot,parent_org_unit_id,parent_code_snapshot,parent_name_snapshot)
   SELECT @review,u.id,CASE WHEN u.id=@team THEN N'team' ELSE N'faculty' END,u.code,u.name,p.id,p.code,p.name FROM org.org_units u LEFT JOIN org.org_units p ON p.id=u.parent_org_unit_id
   WHERE u.id IN(@team,@faculty) AND NOT EXISTS(SELECT 1 FROM qa.review_scopes x WHERE x.review_id=@review AND x.org_unit_id=u.id);
   INSERT qa.review_contributors(review_id,staff_id,assigned_org_unit_id,created_by_user_account_id) VALUES(@review,@staff,@team,@admin);
   INSERT core.records(id,module_id,record_type,title,summary,subject_staff_id,owner_staff_id,org_unit_id,record_date,academic_year_key,created_by_user_account_id,updated_by_user_account_id)
   VALUES(@evidence,@module,N'qa_evidence',CONCAT(@marker,N' ',@name,N' cycle ',@cycle),N'Synthetic evidence; no real learner data.',@staff,@observer,@team,DATEADD(day,@n,'20260901'),@year,@admin,@admin);
   INSERT qa.evidence_submissions(record_id,review_id,review_activity_id,faculty_org_unit_id,team_org_unit_id,faculty_code_snapshot,faculty_name_snapshot,team_code_snapshot,team_name_snapshot,course_programme,course_level,subject_staff_id,reviewer_staff_id,activity_at,sample_size,contextual_notes,key_strengths,areas_for_improvement,recommended_actions,status,submitted_at,submitted_by_user_account_id,created_by_user_account_id,updated_by_user_account_id,delivery_area_key,delivery_area_name_snapshot)
   SELECT @evidence,@review,@activity,f.id,t.id,f.code,f.name,t.code,t.name,CONCAT(N'Test programme ',@n),N'Level 3',@staff,@observer,DATEADD(day,@n,'20260901'),8,N'Synthetic test sample.',N'Learners explain their current goals.',N'Increase consistency of formative feedback.',N'Use weekly checks and review impact.',N'submitted',DATEADD(day,@n,'20260901'),@admin,@admin,@admin,d.value_key,d.display_name
   FROM org.org_units t JOIN org.org_units f ON f.id=t.parent_org_unit_id
   OUTER APPLY(SELECT TOP(1) v.value_key,v.display_name FROM core.lookup_values v JOIN core.lookup_types lt ON lt.id=v.lookup_type_id WHERE lt.lookup_key=N'liv_delivery_area' AND v.is_active=1 ORDER BY v.display_order,v.value_key)d WHERE t.id=@team;
   INSERT qa.evidence_team_scopes(evidence_record_id,team_org_unit_id,faculty_org_unit_id,faculty_code_snapshot,faculty_name_snapshot,team_code_snapshot,team_name_snapshot)
   SELECT record_id,team_org_unit_id,faculty_org_unit_id,faculty_code_snapshot,faculty_name_snapshot,team_code_snapshot,team_name_snapshot FROM qa.evidence_submissions WHERE record_id=@evidence;
   INSERT qa.evidence_responses(evidence_record_id,review_question_id,outcome,comment)
   SELECT @evidence,q.id,CASE (ROW_NUMBER() OVER(ORDER BY q.display_order,q.id)+@cycle+@n)%3 WHEN 0 THEN N'below' WHEN 1 THEN N'at' ELSE N'above' END,
     CONCAT(N'Synthetic evidence for ',q.question_text,N': sampled work and discussion support this test judgement.') FROM qa.review_questions q WHERE q.review_activity_id=@activity;
   SET @n+=1;
  END;
 END;
 SET @review=NULL; SET @cycle+=1;
END;
-- UCO uses its dedicated configured faculty and existing narrative criteria.
DECLARE @uco uniqueidentifier=(SELECT id FROM org.org_units WHERE code=N'UCO');
DECLARE @lecturer uniqueidentifier=(SELECT id FROM people.staff WHERE external_id=N'SYSTEM-TEST-11');
DECLARE @lecturerAccount uniqueidentifier=(SELECT TOP(1) id FROM auth.user_accounts WHERE staff_id=@lecturer);
DECLARE @observerAccount uniqueidentifier=(SELECT TOP(1) id FROM auth.user_accounts WHERE staff_id=@observer);
DECLARE @template uniqueidentifier=(SELECT TOP(1) v.id FROM forms.form_template_versions v JOIN forms.form_templates t ON t.id=v.form_template_id WHERE t.template_key=N'uco_tla_review_core' AND v.is_published=1 ORDER BY v.active_from DESC);
IF @uco IS NULL OR @lecturer IS NULL OR @template IS NULL OR @lecturerAccount IS NULL OR @observerAccount IS NULL THROW 51000,'UCO configuration and SYSTEM-TEST-11 are required.',1;
SET @module=(SELECT id FROM core.modules WHERE module_key=N'uco_tla_reviews');
SET @cycle=1;
WHILE @cycle<=3
BEGIN
 SET @title=CONCAT(@marker,N' UCO TLA ',@cycle);
 IF NOT EXISTS(SELECT 1 FROM core.records WHERE title=@title AND record_type=N'uco_tla_review')
 BEGIN
  DECLARE @record uniqueidentifier=NEWID(),@submission uniqueidentifier=NEWID(),@at datetimeoffset=DATEADD(day,@cycle,'20260910');
  DECLARE @status nvarchar(40)=CASE @cycle WHEN 1 THEN N'completed' WHEN 2 THEN N'awaiting_finalisation' ELSE N'awaiting_lecturer' END;
  INSERT core.records(id,module_id,record_type,title,subject_staff_id,owner_staff_id,org_unit_id,record_date,academic_year_key,created_by_user_account_id,updated_by_user_account_id)
  VALUES(@record,@module,N'uco_tla_review',@title,@lecturer,@observer,@uco,CONVERT(date,@at),@year,@admin,@admin);
  INSERT forms.form_submissions(id,record_id,form_template_version_id,status,submitted_at,submitted_by_user_account_id) VALUES(@submission,@record,@template,N'submitted',@at,@admin);
  INSERT quality.uco_tla_reviews(record_id,form_submission_id,lecturer_staff_id,observer_staff_id,workflow_status,observation_at,session_type,course_title,module_title,course_level,number_registered,number_present,number_late,professional_discussion_at,lecturer_acknowledged_at,lecturer_acknowledged_by_user_account_id,observer_signed_at,observer_signed_by_user_account_id,created_by_user_account_id,updated_by_user_account_id)
  VALUES(@record,@submission,@lecturer,@observer,@status,@at,N'Seminar',N'Synthetic higher education course',N'Applied research',N'Level 5',20,18,1,DATEADD(day,1,@at),CASE WHEN @cycle<=2 THEN DATEADD(day,2,@at) END,CASE WHEN @cycle<=2 THEN @lecturerAccount END,CASE WHEN @cycle=1 THEN DATEADD(day,3,@at) END,CASE WHEN @cycle=1 THEN @observerAccount END,@admin,@admin);
  INSERT forms.form_responses(form_submission_id,form_field_id,response_text)
  SELECT @submission,f.id,CASE f.field_key WHEN N'observation_at' THEN CONVERT(nvarchar(40),@at,127) WHEN N'session_type' THEN N'Seminar' WHEN N'course_title' THEN N'Synthetic higher education course' WHEN N'module_title' THEN N'Applied research' WHEN N'course_level' THEN N'Level 5' WHEN N'number_registered' THEN N'20' WHEN N'number_present' THEN N'18' WHEN N'number_late' THEN N'1' WHEN N'essential_actions' THEN N'None identified in this synthetic review.' WHEN N'advisable_actions' THEN N'Introduce a structured check of understanding.' WHEN N'lecturer_reflection' THEN CASE WHEN @cycle<=2 THEN N'I will use short formative checks and compare learner progress in the next session.' ELSE NULL END ELSE CONCAT(N'Synthetic observation evidence: ',f.label,N'. Learners demonstrated understanding through discussion and a worked example.') END
  FROM forms.form_fields f JOIN forms.form_sections s ON s.id=f.form_section_id WHERE s.form_template_version_id=@template AND f.archived_at IS NULL AND s.archived_at IS NULL;
  INSERT quality.uco_tla_section_progress(review_record_id,section_key,is_complete,completed_at,completed_by_user_account_id)
  SELECT @record,v.k,1,@at,@admin FROM(VALUES(N'session_details'),(N'teaching_learning_activities'),(N'delivery_facilitation'),(N'learning_materials'),(N'findings'),(N'action_plan'),(N'discussion_follow_up'))v(k);
  DECLARE @action uniqueidentifier=NEWID(),@plan uniqueidentifier=NEWID();
  INSERT quality.actions(id,source_record_id,source_form_type,source_sub_record_type,source_sub_record_id,source_sub_record_key,source_display_order,subject_staff_id,owner_staff_id,title,detail,action_theme,status_lookup_value_id,due_date,original_due_date,published_to_staff,visibility_setting,created_by_user_account_id,updated_by_user_account_id)
  SELECT @action,@record,N'uco_tla_review',N'uco_tla_action_plan',@plan,N'action_1',1,@lecturer,@lecturer,CONCAT(@marker,N' Structured checks'),N'Use an exit ticket and review responses after three sessions.',N'Advisable action',v.id,'2026-10-30','2026-10-30',1,N'staff_and_management',@admin,@admin FROM core.lookup_values v JOIN core.lookup_types t ON t.id=v.lookup_type_id WHERE t.lookup_key=N'action_status' AND v.value_key=N'open';
  INSERT quality.uco_tla_action_plans(id,review_record_id,display_order,action_type,target,achievement_method,owner_staff_id,due_date,central_action_id)
  VALUES(@plan,@record,1,N'advisable',N'Introduce structured checks of understanding',N'Use an exit ticket and compare learner progress.',@lecturer,'2026-10-30',@action);
 END;
 SET @cycle+=1;
END;
COMMIT TRANSACTION;
END TRY
BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
 THROW;
END CATCH;
SELECT r.record_type,COUNT(*) AS test_records FROM core.records r WHERE LEFT(r.title,LEN(N'[SYSTEM TEST 26/27]'))=N'[SYSTEM TEST 26/27]' AND r.record_type IN(N'qa_review',N'qa_evidence',N'uco_tla_review') GROUP BY r.record_type;
SELECT a.activity_key,COUNT(DISTINCT e.record_id) AS submissions,COUNT(x.id) AS responses FROM qa.evidence_submissions e JOIN core.records r ON r.id=e.record_id JOIN qa.review_activities ra ON ra.id=e.review_activity_id JOIN qa.activity_types a ON a.id=ra.activity_type_id LEFT JOIN qa.evidence_responses x ON x.evidence_record_id=e.record_id WHERE LEFT(r.title,LEN(N'[SYSTEM TEST 26/27]'))=N'[SYSTEM TEST 26/27]' GROUP BY a.activity_key;
