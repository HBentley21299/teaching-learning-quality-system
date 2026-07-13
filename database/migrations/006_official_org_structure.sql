SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

BEGIN TRANSACTION;

DECLARE @legacyDdcpaId uniqueidentifier = '20000000-0000-0000-0000-000000000003';
DECLARE @legacyEnglishMathsId uniqueidentifier = '20000000-0000-0000-0000-000000000004';
DECLARE @cupaId uniqueidentifier = '20000000-0000-0000-0000-000000000101';
DECLARE @cuesId uniqueidentifier = '20000000-0000-0000-0000-000000000102';
DECLARE @cumtId uniqueidentifier = '20000000-0000-0000-0000-000000000103';
DECLARE @cuseId uniqueidentifier = '20000000-0000-0000-0000-000000000104';
DECLARE @wasCombinedDdcpa bit = CASE WHEN EXISTS (
    SELECT 1 FROM org.org_units WHERE id = @legacyDdcpaId AND code = 'CUDCPA'
) THEN 1 ELSE 0 END;
DECLARE @wasCombinedEnglishMaths bit = CASE WHEN EXISTS (
    SELECT 1 FROM org.org_units WHERE id = @legacyEnglishMathsId AND code = 'CUENMT'
) THEN 1 ELSE 0 END;

-- Codes identify an organisation unit within its level. Some official one-team
-- faculties intentionally use the same external code at levels 1 and 2.
IF EXISTS (
    SELECT 1 FROM sys.key_constraints
    WHERE name = 'uq_org_units_code'
      AND parent_object_id = OBJECT_ID('org.org_units')
)
BEGIN
    ALTER TABLE org.org_units DROP CONSTRAINT uq_org_units_code;
END;

DECLARE @faculties TABLE (
    preferred_id uniqueidentifier NOT NULL,
    code nvarchar(50) NOT NULL,
    name nvarchar(250) NOT NULL
);

INSERT INTO @faculties (preferred_id, code, name)
VALUES
    ('20000000-0000-0000-0000-000000000002', 'CUCP', 'Caring Professions'),
    ('20000000-0000-0000-0000-000000000005', 'CUFP', 'Business, Law and Accounting'),
    ('20000000-0000-0000-0000-000000000007', 'CUST', 'Sport and Public Services'),
    (@legacyDdcpaId, 'CUDC', 'Digital and Creative'),
    (@cupaId, 'CUPA', 'Music and Performing Arts'),
    ('20000000-0000-0000-0000-000000000001', 'CUCB', 'Construction and Motor Vehicle'),
    (@cuesId, 'CUES', 'ESOL'),
    (@legacyEnglishMathsId, 'CUEN', 'English'),
    (@cumtId, 'CUMT', 'Mathematics'),
    (@cuseId, 'CUSE', 'Supported Education'),
    ('20000000-0000-0000-0000-000000000006', 'CUDS', 'Developmental Studies'),
    ('20000000-0000-0000-0000-000000000008', 'CURC', 'Retail and Commercial');

UPDATE org_unit
SET org_unit.parent_org_unit_id = NULL,
    org_unit.org_unit_type = 'faculty',
    org_unit.code = faculty.code,
    org_unit.name = faculty.name,
    org_unit.description = 'Official organisation structure - Level 1 faculty.',
    org_unit.is_active = 1,
    org_unit.archived_at = NULL,
    org_unit.updated_at = sysutcdatetime()
FROM org.org_units org_unit
JOIN @faculties faculty ON faculty.preferred_id = org_unit.id;

INSERT INTO org.org_units (id, parent_org_unit_id, org_unit_type, code, name, description, is_active)
SELECT faculty.preferred_id, NULL, 'faculty', faculty.code, faculty.name,
       'Official organisation structure - Level 1 faculty.', 1
FROM @faculties faculty
WHERE NOT EXISTS (
    SELECT 1 FROM org.org_units existing
    WHERE existing.org_unit_type = 'faculty'
      AND existing.code = faculty.code
      AND existing.archived_at IS NULL
);

DECLARE @teams TABLE (
    preferred_id uniqueidentifier NOT NULL,
    faculty_code nvarchar(50) NOT NULL,
    code nvarchar(50) NOT NULL,
    name nvarchar(250) NOT NULL
);

INSERT INTO @teams (preferred_id, faculty_code, code, name)
VALUES
    ('20000000-0000-0000-0000-000000000023', 'CUCP', 'CUCPSC', 'Science and Access'),
    ('20000000-0000-0000-0000-000000000021', 'CUCP', 'CUCPHSC', 'Health and Social Care'),
    ('20000000-0000-0000-0000-000000000022', 'CUCP', 'CUCPEY', 'Early Years'),
    ('20000000-0000-0000-0000-000000000201', 'CUFP', 'CUFPBUS', 'Business'),
    ('20000000-0000-0000-0000-000000000202', 'CUFP', 'CUFPLA', 'Law and Accounting'),
    ('20000000-0000-0000-0000-000000000203', 'CUST', 'CUSTSPT', 'Sport'),
    ('20000000-0000-0000-0000-000000000204', 'CUST', 'CUSTUPS', 'Uniformed Public Services'),
    ('20000000-0000-0000-0000-000000000031', 'CUDC', 'CUDCDIG', 'Digital'),
    ('20000000-0000-0000-0000-000000000205', 'CUDC', 'CUDCCRE', 'Creative'),
    ('20000000-0000-0000-0000-000000000032', 'CUPA', 'CUPAMPA', 'Music and Performing Arts'),
    ('20000000-0000-0000-0000-000000000206', 'CUCB', 'CUCBMV', 'Motor Vehicle'),
    ('20000000-0000-0000-0000-000000000207', 'CUCB', 'CUCBELEC', 'Electrical'),
    ('20000000-0000-0000-0000-000000000208', 'CUCB', 'CUCBPLU', 'Plumbing'),
    ('20000000-0000-0000-0000-000000000209', 'CUCB', 'CUCBDSP', 'DSP'),
    ('20000000-0000-0000-0000-000000000210', 'CUCB', 'CUCBCJ', 'Carpentry and Joinery'),
    ('20000000-0000-0000-0000-000000000211', 'CUCB', 'CUCBBRK', 'Brickwork'),
    ('20000000-0000-0000-0000-000000000212', 'CUES', 'CUESFT', 'Full-Time ESOL'),
    ('20000000-0000-0000-0000-000000000213', 'CUES', 'CUESPT', 'Part-Time ESOL'),
    ('20000000-0000-0000-0000-000000000214', 'CUEN', 'CUEN', 'English'),
    ('20000000-0000-0000-0000-000000000215', 'CUMT', 'CUMT', 'Mathematics'),
    ('20000000-0000-0000-0000-000000000216', 'CUSE', 'CUSE', 'RISE / Supported Education'),
    ('20000000-0000-0000-0000-000000000217', 'CUDS', 'CUDS', 'Developmental Studies'),
    ('20000000-0000-0000-0000-000000000218', 'CURC', 'CURCTT', 'Travel and Tourism'),
    ('20000000-0000-0000-0000-000000000219', 'CURC', 'CURCHB', 'Hair and Beauty');

UPDATE org_unit
SET org_unit.parent_org_unit_id = faculty.id,
    org_unit.org_unit_type = 'team',
    org_unit.code = team.code,
    org_unit.name = team.name,
    org_unit.description = 'Official organisation structure - Level 2 team.',
    org_unit.is_active = 1,
    org_unit.archived_at = NULL,
    org_unit.updated_at = sysutcdatetime()
FROM org.org_units org_unit
JOIN @teams team ON team.preferred_id = org_unit.id
JOIN org.org_units faculty ON faculty.org_unit_type = 'faculty'
    AND faculty.code = team.faculty_code
    AND faculty.archived_at IS NULL;

INSERT INTO org.org_units (id, parent_org_unit_id, org_unit_type, code, name, description, is_active)
SELECT team.preferred_id, faculty.id, 'team', team.code, team.name,
       'Official organisation structure - Level 2 team.', 1
FROM @teams team
JOIN org.org_units faculty ON faculty.org_unit_type = 'faculty'
    AND faculty.code = team.faculty_code
    AND faculty.archived_at IS NULL
WHERE NOT EXISTS (
    SELECT 1 FROM org.org_units existing
    WHERE existing.org_unit_type = 'team'
      AND existing.code = team.code
      AND existing.archived_at IS NULL
);

IF NOT EXISTS (
    SELECT 1 FROM sys.key_constraints
    WHERE name = 'uq_org_units_type_code'
      AND parent_object_id = OBJECT_ID('org.org_units')
)
BEGIN
    ALTER TABLE org.org_units
    ADD CONSTRAINT uq_org_units_type_code UNIQUE (org_unit_type, code);
END;

-- Preserve access inherited from legacy combined faculties when they split.
IF @wasCombinedDdcpa = 1
BEGIN
    INSERT INTO auth.access_scopes (user_account_id, scope_type, org_unit_id, staff_id, is_active)
    SELECT scope.user_account_id, scope.scope_type, @cupaId, scope.staff_id, scope.is_active
    FROM auth.access_scopes scope
    WHERE scope.org_unit_id = @legacyDdcpaId
      AND scope.archived_at IS NULL
      AND NOT EXISTS (
          SELECT 1 FROM auth.access_scopes existing
          WHERE existing.user_account_id = scope.user_account_id
            AND existing.scope_type = scope.scope_type
            AND existing.org_unit_id = @cupaId
            AND existing.archived_at IS NULL
      );

    INSERT INTO org.staff_org_memberships (staff_id, org_unit_id, membership_type, is_primary, active_from, active_to)
    SELECT membership.staff_id, @cupaId, membership.membership_type, 0, membership.active_from, membership.active_to
    FROM org.staff_org_memberships membership
    WHERE membership.org_unit_id = @legacyDdcpaId
      AND membership.archived_at IS NULL
      AND NOT EXISTS (
          SELECT 1 FROM org.staff_org_memberships existing
          WHERE existing.staff_id = membership.staff_id
            AND existing.org_unit_id = @cupaId
            AND existing.membership_type = membership.membership_type
            AND (existing.active_from = membership.active_from OR (existing.active_from IS NULL AND membership.active_from IS NULL))
      );
END;

IF @wasCombinedEnglishMaths = 1
BEGIN
    INSERT INTO auth.access_scopes (user_account_id, scope_type, org_unit_id, staff_id, is_active)
    SELECT scope.user_account_id, scope.scope_type, @cumtId, scope.staff_id, scope.is_active
    FROM auth.access_scopes scope
    WHERE scope.org_unit_id = @legacyEnglishMathsId
      AND scope.archived_at IS NULL
      AND NOT EXISTS (
          SELECT 1 FROM auth.access_scopes existing
          WHERE existing.user_account_id = scope.user_account_id
            AND existing.scope_type = scope.scope_type
            AND existing.org_unit_id = @cumtId
            AND existing.archived_at IS NULL
      );

    INSERT INTO org.staff_org_memberships (staff_id, org_unit_id, membership_type, is_primary, active_from, active_to)
    SELECT membership.staff_id, @cumtId, membership.membership_type, 0, membership.active_from, membership.active_to
    FROM org.staff_org_memberships membership
    WHERE membership.org_unit_id = @legacyEnglishMathsId
      AND membership.archived_at IS NULL
      AND NOT EXISTS (
          SELECT 1 FROM org.staff_org_memberships existing
          WHERE existing.staff_id = membership.staff_id
            AND existing.org_unit_id = @cumtId
            AND existing.membership_type = membership.membership_type
            AND (existing.active_from = membership.active_from OR (existing.active_from IS NULL AND membership.active_from IS NULL))
      );
END;

IF OBJECT_ID('forms.form_template_org_units', 'U') IS NOT NULL
BEGIN
    IF @wasCombinedDdcpa = 1
    BEGIN
        INSERT INTO forms.form_template_org_units (form_template_id, org_unit_id, assignment_type)
        SELECT assignment.form_template_id, @cupaId, assignment.assignment_type
        FROM forms.form_template_org_units assignment
        WHERE assignment.org_unit_id = @legacyDdcpaId
          AND assignment.archived_at IS NULL
          AND NOT EXISTS (
              SELECT 1 FROM forms.form_template_org_units existing
              WHERE existing.form_template_id = assignment.form_template_id
                AND existing.org_unit_id = @cupaId
                AND existing.assignment_type = assignment.assignment_type
          );
    END;

    IF @wasCombinedEnglishMaths = 1
    BEGIN
        INSERT INTO forms.form_template_org_units (form_template_id, org_unit_id, assignment_type)
        SELECT assignment.form_template_id, @cumtId, assignment.assignment_type
        FROM forms.form_template_org_units assignment
        WHERE assignment.org_unit_id = @legacyEnglishMathsId
          AND assignment.archived_at IS NULL
          AND NOT EXISTS (
              SELECT 1 FROM forms.form_template_org_units existing
              WHERE existing.form_template_id = assignment.form_template_id
                AND existing.org_unit_id = @cumtId
                AND existing.assignment_type = assignment.assignment_type
          );
    END;
END;

-- The legacy Performing Arts child moved from the combined DCPA faculty to CUPA.
IF OBJECT_ID('quality.learning_walk_theme_mappings', 'U') IS NOT NULL
BEGIN
    UPDATE quality.learning_walk_theme_mappings
    SET faculty_org_unit_id = @cupaId,
        updated_at = sysutcdatetime()
    WHERE child_org_unit_id = '20000000-0000-0000-0000-000000000032'
      AND faculty_org_unit_id <> @cupaId
      AND archived_at IS NULL;
END;

-- Keep historical form metadata aligned with the moved Performing Arts team.
UPDATE response
SET response.response_text = CONVERT(nvarchar(36), @cupaId),
    response.updated_at = sysutcdatetime()
FROM forms.form_responses response
JOIN forms.form_fields field ON field.id = response.form_field_id
JOIN forms.form_submissions submission ON submission.id = response.form_submission_id
JOIN core.records record ON record.id = submission.record_id
WHERE field.field_key = 'faculty_area'
  AND record.org_unit_id = '20000000-0000-0000-0000-000000000032'
  AND TRY_CONVERT(uniqueidentifier, response.response_text) = @legacyDdcpaId;

-- Generated titles carry the current organisational code; narrative evidence
-- and dates remain untouched.
UPDATE core.records
SET title = CASE title
        WHEN 'Learning Walk - CUDCPADM' THEN 'Learning Walk - CUDCDIG'
        WHEN 'Learning Walk - CUDCPAPA' THEN 'Learning Walk - CUPAMPA'
        WHEN 'Learning Walk - CUCPHS' THEN 'Learning Walk - CUCPHSC'
        WHEN 'Work Scrutiny - CUDCPADM' THEN 'Work Scrutiny - CUDCDIG'
        WHEN 'Work Scrutiny - CUDCPAPA' THEN 'Work Scrutiny - CUPAMPA'
        WHEN 'Work Scrutiny - CUCPHS' THEN 'Work Scrutiny - CUCPHSC'
        ELSE title
    END,
    updated_at = sysutcdatetime()
WHERE title IN (
    'Learning Walk - CUDCPADM',
    'Learning Walk - CUDCPAPA',
    'Learning Walk - CUCPHS',
    'Work Scrutiny - CUDCPADM',
    'Work Scrutiny - CUDCPAPA',
    'Work Scrutiny - CUCPHS'
);

IF (SELECT COUNT(*) FROM @faculties) <> (
    SELECT COUNT(*)
    FROM org.org_units org_unit
    JOIN @faculties faculty ON faculty.code = org_unit.code
    WHERE org_unit.org_unit_type = 'faculty'
      AND org_unit.is_active = 1
      AND org_unit.archived_at IS NULL
)
BEGIN
    THROW 51000, 'The official faculty structure was not applied completely.', 1;
END;

IF (SELECT COUNT(*) FROM @teams) <> (
    SELECT COUNT(*)
    FROM org.org_units team_org
    JOIN org.org_units faculty_org ON faculty_org.id = team_org.parent_org_unit_id
    JOIN @teams team ON team.code = team_org.code AND team.faculty_code = faculty_org.code
    WHERE team_org.org_unit_type = 'team'
      AND team_org.is_active = 1
      AND team_org.archived_at IS NULL
)
BEGIN
    THROW 51000, 'The official team structure was not applied completely.', 1;
END;

COMMIT TRANSACTION;
GO
