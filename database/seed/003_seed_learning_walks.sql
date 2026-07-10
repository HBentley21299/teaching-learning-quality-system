SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- Demo learning walk records so the Learning Walks tab has data and the
-- creator-based visibility rules can be validated:
--   1. Priya Nair (Programme Leader) walk on Digital Media   - submitted
--   2. Fiona Hart (Head of Faculty) walk on Performing Arts  - submitted
--   3. David Okafor (Director) walk on Health & Social Care  - submitted
--   4. Priya Nair draft walk on Digital Media                - draft (owner only)
-- All inserts are idempotent. Depends on seed 001/002 and migration 003.

BEGIN TRANSACTION;

DECLARE @lwModule uniqueidentifier = (SELECT id FROM core.modules WHERE module_key = 'learning_walks' AND archived_at IS NULL);
DECLARE @lwVersion uniqueidentifier = '71000000-0000-0000-0000-000000000011';

DECLARE @cudcpa uniqueidentifier = (SELECT id FROM org.org_units WHERE code = 'CUDCPA' AND archived_at IS NULL);
DECLARE @cudcpadm uniqueidentifier = (SELECT id FROM org.org_units WHERE code = 'CUDCPADM' AND archived_at IS NULL);
DECLARE @cudcpapa uniqueidentifier = (SELECT id FROM org.org_units WHERE code = 'CUDCPAPA' AND archived_at IS NULL);
DECLARE @cucp uniqueidentifier = (SELECT id FROM org.org_units WHERE code = 'CUCP' AND archived_at IS NULL);
DECLARE @cucphs uniqueidentifier = (SELECT id FROM org.org_units WHERE code = 'CUCPHS' AND archived_at IS NULL);

DECLARE @fiona uniqueidentifier = '40000000-0000-0000-0000-000000000003';
DECLARE @priya uniqueidentifier = '40000000-0000-0000-0000-000000000004';
DECLARE @marcus uniqueidentifier = '40000000-0000-0000-0000-000000000005';
DECLARE @elena uniqueidentifier = '40000000-0000-0000-0000-000000000006';
DECLARE @david uniqueidentifier = '40000000-0000-0000-0000-000000000007';
DECLARE @sarah uniqueidentifier = '40000000-0000-0000-0000-000000000008';

DECLARE @fionaAccount uniqueidentifier = '41000000-0000-0000-0000-000000000003';
DECLARE @priyaAccount uniqueidentifier = '41000000-0000-0000-0000-000000000004';
DECLARE @davidAccount uniqueidentifier = '41000000-0000-0000-0000-000000000007';

IF @lwModule IS NOT NULL
   AND EXISTS (SELECT 1 FROM forms.form_template_versions WHERE id = @lwVersion)
   AND EXISTS (SELECT 1 FROM people.staff WHERE id = @priya)
BEGIN
    -- 1. Records
    INSERT INTO core.records (id, module_id, record_type, title, summary, subject_staff_id, owner_staff_id, org_unit_id, record_date, created_by_user_account_id)
    SELECT v.id, @lwModule, 'learning_walk', v.title, v.summary, v.subject_staff_id, v.owner_staff_id, v.org_unit_id, v.record_date, v.created_by
    FROM (VALUES
        ('93000000-0000-0000-0000-000000000001', 'Learning Walk - CUDCPADM',
         'Digital tools that make learning visible', @marcus, @priya, @cudcpadm,
         CONVERT(date, DATEADD(day, -7, sysutcdatetime())), @priyaAccount),
        ('93000000-0000-0000-0000-000000000002', 'Learning Walk - CUDCPAPA',
         'Feedback that moves rehearsal work forward', @elena, @fiona, @cudcpapa,
         CONVERT(date, DATEADD(day, -14, sysutcdatetime())), @fionaAccount),
        ('93000000-0000-0000-0000-000000000003', 'Learning Walk - CUCPHS',
         'Embedding inclusive practice and learner progress checks', @sarah, @david, @cucphs,
         CONVERT(date, DATEADD(day, -3, sysutcdatetime())), @davidAccount),
        ('93000000-0000-0000-0000-000000000004', 'Learning Walk - CUDCPADM',
         'Digital tools that make learning visible', @marcus, @priya, @cudcpadm,
         CONVERT(date, DATEADD(day, -1, sysutcdatetime())), @priyaAccount)
    ) v(id, title, summary, subject_staff_id, owner_staff_id, org_unit_id, record_date, created_by)
    WHERE NOT EXISTS (SELECT 1 FROM core.records existing WHERE existing.id = v.id);

    -- 2. Form submissions (record 4 stays in draft)
    INSERT INTO forms.form_submissions (id, record_id, form_template_version_id, submitted_by_user_account_id, submitted_at, status)
    SELECT v.id, v.record_id, @lwVersion, v.submitted_by,
           CASE WHEN v.status = 'submitted' THEN DATEADD(day, v.age_days, sysutcdatetime()) ELSE NULL END,
           v.status
    FROM (VALUES
        ('94000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000001', @priyaAccount, -7, 'submitted'),
        ('94000000-0000-0000-0000-000000000002', '93000000-0000-0000-0000-000000000002', @fionaAccount, -14, 'submitted'),
        ('94000000-0000-0000-0000-000000000003', '93000000-0000-0000-0000-000000000003', @davidAccount, -3, 'submitted'),
        ('94000000-0000-0000-0000-000000000004', '93000000-0000-0000-0000-000000000004', @priyaAccount, -1, 'draft')
    ) v(id, record_id, submitted_by, age_days, status)
    WHERE EXISTS (SELECT 1 FROM core.records r WHERE r.id = v.record_id)
      AND NOT EXISTS (SELECT 1 FROM forms.form_submissions existing WHERE existing.id = v.id);

    -- 3. Responses against the learning_walk_core 1.1 fields
    --    73...0011 visit_date, 0012 faculty_area, 0013 team_level,
    --    0014 learning_walk_theme, 0016 good_practice, 0017 development_areas,
    --    0018 actions_next_steps
    INSERT INTO forms.form_responses (form_submission_id, form_field_id, response_text, response_date)
    SELECT v.submission_id, v.field_id, v.response_text, v.response_date
    FROM (VALUES
        -- Priya on Digital Media
        ('94000000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000011', NULL, CONVERT(date, DATEADD(day, -7, sysutcdatetime()))),
        ('94000000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000012', CONVERT(nvarchar(36), @cudcpa), NULL),
        ('94000000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000013', CONVERT(nvarchar(36), @cudcpadm), NULL),
        ('94000000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000014', 'Digital tools that make learning visible', NULL),
        ('94000000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000016', 'Learners used shared documents to critique each other''s edits; the tutor surfaced strong examples on the main screen.', NULL),
        ('94000000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000017', 'Checks for understanding relied on volunteers. Agree a cold-calling routine for the demo segments.', NULL),
        ('94000000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000018', 'Share the critique protocol at the next team meeting.', NULL),
        -- Fiona on Performing Arts
        ('94000000-0000-0000-0000-000000000002', '73000000-0000-0000-0000-000000000011', NULL, CONVERT(date, DATEADD(day, -14, sysutcdatetime()))),
        ('94000000-0000-0000-0000-000000000002', '73000000-0000-0000-0000-000000000012', CONVERT(nvarchar(36), @cudcpa), NULL),
        ('94000000-0000-0000-0000-000000000002', '73000000-0000-0000-0000-000000000013', CONVERT(nvarchar(36), @cudcpapa), NULL),
        ('94000000-0000-0000-0000-000000000002', '73000000-0000-0000-0000-000000000014', 'Feedback that moves rehearsal work forward', NULL),
        ('94000000-0000-0000-0000-000000000002', '73000000-0000-0000-0000-000000000016', 'Rehearsal notes referenced the assessment criteria and learners could explain their next step.', NULL),
        ('94000000-0000-0000-0000-000000000002', '73000000-0000-0000-0000-000000000017', 'Feedback was verbal only in two groups; capture it in the rehearsal logs so progress is visible.', NULL),
        -- David on Health & Social Care
        ('94000000-0000-0000-0000-000000000003', '73000000-0000-0000-0000-000000000011', NULL, CONVERT(date, DATEADD(day, -3, sysutcdatetime()))),
        ('94000000-0000-0000-0000-000000000003', '73000000-0000-0000-0000-000000000012', CONVERT(nvarchar(36), @cucp), NULL),
        ('94000000-0000-0000-0000-000000000003', '73000000-0000-0000-0000-000000000013', CONVERT(nvarchar(36), @cucphs), NULL),
        ('94000000-0000-0000-0000-000000000003', '73000000-0000-0000-0000-000000000014', 'Embedding inclusive practice and learner progress checks', NULL),
        ('94000000-0000-0000-0000-000000000003', '73000000-0000-0000-0000-000000000016', 'Adapted resources were in use throughout and support staff were briefed on the session goals.', NULL),
        ('94000000-0000-0000-0000-000000000003', '73000000-0000-0000-0000-000000000017', 'Progress checks clustered at the end of the session; spread them across the practical tasks.', NULL),
        -- Priya's draft
        ('94000000-0000-0000-0000-000000000004', '73000000-0000-0000-0000-000000000011', NULL, CONVERT(date, DATEADD(day, -1, sysutcdatetime()))),
        ('94000000-0000-0000-0000-000000000004', '73000000-0000-0000-0000-000000000012', CONVERT(nvarchar(36), @cudcpa), NULL),
        ('94000000-0000-0000-0000-000000000004', '73000000-0000-0000-0000-000000000013', CONVERT(nvarchar(36), @cudcpadm), NULL),
        ('94000000-0000-0000-0000-000000000004', '73000000-0000-0000-0000-000000000014', 'Digital tools that make learning visible', NULL)
    ) v(submission_id, field_id, response_text, response_date)
    WHERE EXISTS (SELECT 1 FROM forms.form_submissions fs WHERE fs.id = v.submission_id)
      AND NOT EXISTS (
          SELECT 1 FROM forms.form_responses existing
          WHERE existing.form_submission_id = v.submission_id
            AND existing.form_field_id = v.field_id
      );

    -- 4. Activity side-table rows for the submitted walks (reporting joins)
    INSERT INTO quality.activities (record_id, activity_type, activity_date, subject_staff_id, reviewer_staff_id, org_unit_id)
    SELECT v.record_id, 'learning_walk', v.activity_date, v.subject_staff_id, v.reviewer_staff_id, v.org_unit_id
    FROM (VALUES
        ('93000000-0000-0000-0000-000000000001', CONVERT(date, DATEADD(day, -7, sysutcdatetime())), @marcus, @priya, @cudcpadm),
        ('93000000-0000-0000-0000-000000000002', CONVERT(date, DATEADD(day, -14, sysutcdatetime())), @elena, @fiona, @cudcpapa),
        ('93000000-0000-0000-0000-000000000003', CONVERT(date, DATEADD(day, -3, sysutcdatetime())), @sarah, @david, @cucphs)
    ) v(record_id, activity_date, subject_staff_id, reviewer_staff_id, org_unit_id)
    WHERE EXISTS (SELECT 1 FROM core.records r WHERE r.id = v.record_id)
      AND NOT EXISTS (SELECT 1 FROM quality.activities existing WHERE existing.record_id = v.record_id);
END;

COMMIT TRANSACTION;
GO
