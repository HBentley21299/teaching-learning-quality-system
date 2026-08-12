SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- Demo dataset: staff across faculties with realistic roles and scopes so the
-- permission model and dashboards can be exercised. All inserts are idempotent.

BEGIN TRANSACTION;

-- Child codes under Digital, Creative & Performing Arts
DECLARE @cudcpa uniqueidentifier = (SELECT id FROM org.org_units WHERE code = 'CUDCPA');

IF @cudcpa IS NOT NULL
BEGIN
    INSERT INTO org.org_units (id, parent_org_unit_id, org_unit_type, code, name, description)
    SELECT v.id, @cudcpa, 'faculty_child_code', v.code, v.name, 'Seeded demo child code.'
    FROM (VALUES
        ('20000000-0000-0000-0000-000000000031', 'CUDCPADM', 'Digital Media'),
        ('20000000-0000-0000-0000-000000000032', 'CUDCPAPA', 'Performing Arts')
    ) v(id, code, name)
    WHERE NOT EXISTS (SELECT 1 FROM org.org_units existing WHERE existing.id = v.id OR existing.code = v.code);

    INSERT INTO quality.learning_walk_theme_mappings (id, faculty_org_unit_id, child_org_unit_id, agreed_theme)
    SELECT v.id, @cudcpa, child.id, v.agreed_theme
    FROM (VALUES
        ('8a000000-0000-0000-0000-000000000011', 'CUDCPADM', 'Digital tools that make learning visible'),
        ('8a000000-0000-0000-0000-000000000012', 'CUDCPAPA', 'Feedback that moves rehearsal work forward')
    ) v(id, child_code, agreed_theme)
    JOIN org.org_units child ON child.code = v.child_code AND child.archived_at IS NULL
    WHERE NOT EXISTS (
        SELECT 1 FROM quality.learning_walk_theme_mappings existing
        WHERE existing.faculty_org_unit_id = @cudcpa
          AND existing.child_org_unit_id = child.id
          AND existing.archived_at IS NULL
    );
END;

-- Demo staff (line managers set after insert so ordering does not matter)
INSERT INTO people.staff (id, external_id, first_name, last_name, display_name, email, job_title, primary_org_unit_id, account_status)
SELECT v.id, v.external_id, v.first_name, v.last_name, v.display_name, v.email, v.job_title, ou.id, 'active'
FROM (VALUES
    ('40000000-0000-0000-0000-000000000003', 'STAFF_0003', 'Fiona', 'Hart', 'Fiona Hart', 'fiona.hart@college.example', 'Head of Faculty - DCPA', 'CUDCPA'),
    ('40000000-0000-0000-0000-000000000004', 'STAFF_0004', 'Priya', 'Nair', 'Priya Nair', 'priya.nair@college.example', 'Programme Leader - Digital Media', 'CUDCPADM'),
    ('40000000-0000-0000-0000-000000000005', 'STAFF_0005', 'Marcus', 'Reid', 'Marcus Reid', 'marcus.reid@college.example', 'Lecturer - Digital Media', 'CUDCPADM'),
    ('40000000-0000-0000-0000-000000000006', 'STAFF_0006', 'Elena', 'Sousa', 'Elena Sousa', 'elena.sousa@college.example', 'Lecturer - Performing Arts', 'CUDCPAPA'),
    ('40000000-0000-0000-0000-000000000007', 'STAFF_0007', 'David', 'Okafor', 'David Okafor', 'david.okafor@college.example', 'Director of Curriculum', 'CUDCPA'),
    ('40000000-0000-0000-0000-000000000008', 'STAFF_0008', 'Sarah', 'Whitmore', 'Sarah Whitmore', 'sarah.whitmore@college.example', 'Lecturer - Health & Social Care', 'CUCPHS')
) v(id, external_id, first_name, last_name, display_name, email, job_title, org_code)
JOIN org.org_units ou ON ou.code = v.org_code AND ou.archived_at IS NULL
WHERE NOT EXISTS (SELECT 1 FROM people.staff existing WHERE existing.id = v.id OR existing.email = v.email);

-- Line management: lecturers report to the programme leader, PL to the HoF
UPDATE people.staff SET line_manager_staff_id = '40000000-0000-0000-0000-000000000004'
WHERE id IN ('40000000-0000-0000-0000-000000000005', '40000000-0000-0000-0000-000000000006')
  AND line_manager_staff_id IS NULL;

UPDATE people.staff SET line_manager_staff_id = '40000000-0000-0000-0000-000000000003'
WHERE id = '40000000-0000-0000-0000-000000000004'
  AND line_manager_staff_id IS NULL;

-- Org memberships (staff can belong to more than one team)
INSERT INTO org.staff_org_memberships (staff_id, org_unit_id, membership_type, is_primary)
SELECT v.staff_id, ou.id, v.membership_type, v.is_primary
FROM (VALUES
    ('40000000-0000-0000-0000-000000000003', 'CUDCPA', 'leader', 1),
    ('40000000-0000-0000-0000-000000000004', 'CUDCPADM', 'leader', 1),
    ('40000000-0000-0000-0000-000000000005', 'CUDCPADM', 'member', 1),
    ('40000000-0000-0000-0000-000000000005', 'CUDCPAPA', 'member', 0),
    ('40000000-0000-0000-0000-000000000006', 'CUDCPAPA', 'member', 1),
    ('40000000-0000-0000-0000-000000000008', 'CUCPHS', 'member', 1)
) v(staff_id, org_code, membership_type, is_primary)
JOIN org.org_units ou ON ou.code = v.org_code AND ou.archived_at IS NULL
WHERE NOT EXISTS (
    SELECT 1 FROM org.staff_org_memberships existing
    WHERE existing.staff_id = v.staff_id AND existing.org_unit_id = ou.id AND existing.archived_at IS NULL
);

-- Accounts
INSERT INTO auth.user_accounts (id, staff_id, account_status)
SELECT v.id, v.staff_id, 'active'
FROM (VALUES
    ('41000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000003'),
    ('41000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000004'),
    ('41000000-0000-0000-0000-000000000005', '40000000-0000-0000-0000-000000000005'),
    ('41000000-0000-0000-0000-000000000006', '40000000-0000-0000-0000-000000000006'),
    ('41000000-0000-0000-0000-000000000007', '40000000-0000-0000-0000-000000000007'),
    ('41000000-0000-0000-0000-000000000008', '40000000-0000-0000-0000-000000000008')
) v(id, staff_id)
WHERE EXISTS (SELECT 1 FROM people.staff s WHERE s.id = v.staff_id)
  AND NOT EXISTS (SELECT 1 FROM auth.user_accounts existing WHERE existing.id = v.id);

-- Role assignments
INSERT INTO auth.user_roles (user_account_id, role_id)
SELECT v.user_account_id, r.id
FROM (VALUES
    ('41000000-0000-0000-0000-000000000003', 'leader_manager'),        -- Head of Faculty
    ('41000000-0000-0000-0000-000000000004', 'leader_manager'),        -- Programme Leader
    ('41000000-0000-0000-0000-000000000005', 'staff'),                 -- Tutor
    ('41000000-0000-0000-0000-000000000006', 'staff'),                 -- Tutor
    ('41000000-0000-0000-0000-000000000007', 'director'),              -- Director
    ('41000000-0000-0000-0000-000000000008', 'staff')                  -- Tutor
) v(user_account_id, role_key)
JOIN auth.roles r ON r.role_key = v.role_key
WHERE EXISTS (SELECT 1 FROM auth.user_accounts ua WHERE ua.id = v.user_account_id)
  AND NOT EXISTS (
      SELECT 1 FROM auth.user_roles existing
      WHERE existing.user_account_id = v.user_account_id AND existing.role_id = r.id
  );

-- Scopes: HoF sees the whole faculty, PL sees the child code,
-- the director sees two faculties, tutors see themselves.
INSERT INTO auth.access_scopes (user_account_id, scope_type, org_unit_id)
SELECT v.user_account_id, 'assigned_org_units', ou.id
FROM (VALUES
    ('41000000-0000-0000-0000-000000000003', 'CUDCPA'),
    ('41000000-0000-0000-0000-000000000004', 'CUDCPADM'),
    ('41000000-0000-0000-0000-000000000007', 'CUDCPA'),
    ('41000000-0000-0000-0000-000000000007', 'CUCP')
) v(user_account_id, org_code)
JOIN org.org_units ou ON ou.code = v.org_code AND ou.archived_at IS NULL
WHERE EXISTS (SELECT 1 FROM auth.user_accounts ua WHERE ua.id = v.user_account_id)
  AND NOT EXISTS (
      SELECT 1 FROM auth.access_scopes existing
      WHERE existing.user_account_id = v.user_account_id
        AND existing.scope_type = 'assigned_org_units'
        AND existing.org_unit_id = ou.id
        AND existing.archived_at IS NULL
  );

INSERT INTO auth.access_scopes (user_account_id, scope_type, staff_id)
SELECT v.user_account_id, 'self', v.staff_id
FROM (VALUES
    ('41000000-0000-0000-0000-000000000005', '40000000-0000-0000-0000-000000000005'),
    ('41000000-0000-0000-0000-000000000006', '40000000-0000-0000-0000-000000000006'),
    ('41000000-0000-0000-0000-000000000008', '40000000-0000-0000-0000-000000000008')
) v(user_account_id, staff_id)
WHERE EXISTS (SELECT 1 FROM auth.user_accounts ua WHERE ua.id = v.user_account_id)
  AND NOT EXISTS (
      SELECT 1 FROM auth.access_scopes existing
      WHERE existing.user_account_id = v.user_account_id AND existing.scope_type = 'self'
  );

-- Give the two original seed staff a primary faculty so scoping examples work
UPDATE people.staff
SET primary_org_unit_id = (SELECT id FROM org.org_units WHERE code = 'CUDCPA')
WHERE external_id = 'STAFF_0001' AND primary_org_unit_id IS NULL;

UPDATE people.staff
SET primary_org_unit_id = (SELECT id FROM org.org_units WHERE code = 'CUCPSC')
WHERE external_id = 'STAFF_0002' AND primary_org_unit_id IS NULL;

-- A few demo actions with mixed due dates so dashboards show real load
INSERT INTO quality.actions (id, owner_staff_id, subject_staff_id, title, detail, due_date, published_to_staff, status_lookup_value_id, created_by_user_account_id)
SELECT v.id, v.owner_staff_id, v.subject_staff_id, v.title, v.detail, v.due_date,
       1,
       (SELECT TOP (1) lv.id FROM core.lookup_values lv JOIN core.lookup_types lt ON lt.id = lv.lookup_type_id
        WHERE lt.lookup_key = 'action_status' AND lv.value_key = 'open'),
       '41000000-0000-0000-0000-000000000001'
FROM (VALUES
    ('92000000-0000-0000-0000-000000000001',
     '40000000-0000-0000-0000-000000000005', '40000000-0000-0000-0000-000000000005',
     'Embed visible checks for understanding',
     'Agreed at the last learning walk. Build two checkpoints into practical sessions.',
     CONVERT(date, DATEADD(day, 10, sysutcdatetime()))),
    ('92000000-0000-0000-0000-000000000002',
     '40000000-0000-0000-0000-000000000006', '40000000-0000-0000-0000-000000000006',
     'Reference assessment criteria in rehearsal logs',
     'Follow-up from work scrutiny. Share an annotated example with the team.',
     CONVERT(date, DATEADD(day, -5, sysutcdatetime()))),
    ('92000000-0000-0000-0000-000000000003',
     '40000000-0000-0000-0000-000000000004', NULL,
     'Run a digital media feedback workshop',
     'Programme-level action from the faculty teaching and learning review.',
     CONVERT(date, DATEADD(day, 21, sysutcdatetime())))
) v(id, owner_staff_id, subject_staff_id, title, detail, due_date)
WHERE EXISTS (SELECT 1 FROM people.staff s WHERE s.id = v.owner_staff_id)
  AND NOT EXISTS (SELECT 1 FROM quality.actions existing WHERE existing.id = v.id);

COMMIT TRANSACTION;
GO
