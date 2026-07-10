SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO

BEGIN TRANSACTION;

DECLARE @lookupAccount uniqueidentifier = '10000000-0000-0000-0000-000000000001';
DECLARE @lookupAction uniqueidentifier = '10000000-0000-0000-0000-000000000002';
DECLARE @lookupPriority uniqueidentifier = '10000000-0000-0000-0000-000000000003';
DECLARE @lookupMilestone uniqueidentifier = '10000000-0000-0000-0000-000000000004';
DECLARE @lookupCpdTheme uniqueidentifier = '10000000-0000-0000-0000-000000000005';
DECLARE @lookupReview uniqueidentifier = '10000000-0000-0000-0000-000000000006';
DECLARE @lookupYesNoPartial uniqueidentifier = '10000000-0000-0000-0000-000000000007';

INSERT INTO core.lookup_types (id, lookup_key, name, is_system)
SELECT v.id, v.lookup_key, v.name, 1
FROM (VALUES
    (@lookupAccount, 'account_status', 'Account Status'),
    (@lookupAction, 'action_status', 'Action Status'),
    (@lookupPriority, 'priority', 'Priority'),
    (@lookupMilestone, 'impact_milestone', 'Impact Milestone'),
    (@lookupCpdTheme, 'cpd_theme', 'CPD Theme'),
    (@lookupReview, 'review_status', 'Review Status'),
    (@lookupYesNoPartial, 'yes_no_partial', 'Yes / No / Partial')
) v(id, lookup_key, name)
WHERE NOT EXISTS (SELECT 1 FROM core.lookup_types t WHERE t.id = v.id);

INSERT INTO core.lookup_values (id, lookup_type_id, value_key, display_name, display_order, color_hex, notes)
SELECT v.id, v.lookup_type_id, v.value_key, v.display_name, v.display_order, v.color_hex, v.notes
FROM (VALUES
    ('11000000-0000-0000-0000-000000000001', @lookupAccount, 'active', 'Active', 1, '#15803D', NULL),
    ('11000000-0000-0000-0000-000000000002', @lookupAccount, 'inactive', 'Inactive', 2, '#64748B', NULL),
    ('11000000-0000-0000-0000-000000000003', @lookupAccount, 'leaver', 'Leaver', 3, '#991B1B', NULL),
    ('12000000-0000-0000-0000-000000000001', @lookupAction, 'open', 'Open', 1, '#2563EB', NULL),
    ('12000000-0000-0000-0000-000000000002', @lookupAction, 'in_progress', 'In Progress', 2, '#7C3AED', NULL),
    ('12000000-0000-0000-0000-000000000003', @lookupAction, 'complete', 'Complete', 3, '#15803D', NULL),
    ('12000000-0000-0000-0000-000000000004', @lookupAction, 'overdue', 'Overdue', 4, '#B91C1C', 'Can be system-calculated from due date.'),
    ('13000000-0000-0000-0000-000000000001', @lookupPriority, 'low', 'Low', 1, '#0F766E', NULL),
    ('13000000-0000-0000-0000-000000000002', @lookupPriority, 'medium', 'Medium', 2, '#B45309', NULL),
    ('13000000-0000-0000-0000-000000000003', @lookupPriority, 'high', 'High', 3, '#B91C1C', NULL),
    ('14000000-0000-0000-0000-000000000001', @lookupMilestone, 'winter', 'Christmas / Winter', 1, NULL, 'Interim impact checkpoint.'),
    ('14000000-0000-0000-0000-000000000002', @lookupMilestone, 'spring', 'Easter / Spring', 2, NULL, 'Mid-year impact checkpoint.'),
    ('14000000-0000-0000-0000-000000000003', @lookupMilestone, 'end_of_year', 'End of Year', 3, NULL, 'Final impact checkpoint.'),
    ('15000000-0000-0000-0000-000000000001', @lookupCpdTheme, 'digital_teaching_learning', 'Digital Teaching & Learning', 1, NULL, NULL),
    ('15000000-0000-0000-0000-000000000002', @lookupCpdTheme, 'assessment_feedback', 'Assessment & Feedback', 2, NULL, NULL),
    ('15000000-0000-0000-0000-000000000003', @lookupCpdTheme, 'inclusion_assistive_technology', 'Inclusion / Assistive Technology', 3, NULL, NULL),
    ('15000000-0000-0000-0000-000000000004', @lookupCpdTheme, 'immersive_learning', 'Immersive Learning', 4, NULL, NULL),
    ('15000000-0000-0000-0000-000000000005', @lookupCpdTheme, 'questioning_active_learning', 'Questioning / Active Learning', 5, NULL, NULL),
    ('16000000-0000-0000-0000-000000000001', @lookupReview, 'draft', 'Draft', 1, '#64748B', NULL),
    ('16000000-0000-0000-0000-000000000002', @lookupReview, 'submitted', 'Submitted', 2, '#2563EB', NULL),
    ('16000000-0000-0000-0000-000000000003', @lookupReview, 'reviewed', 'Reviewed', 3, '#15803D', NULL),
    ('17000000-0000-0000-0000-000000000001', @lookupYesNoPartial, 'yes', 'Yes', 1, '#15803D', NULL),
    ('17000000-0000-0000-0000-000000000002', @lookupYesNoPartial, 'partial', 'Partial', 2, '#B45309', NULL),
    ('17000000-0000-0000-0000-000000000003', @lookupYesNoPartial, 'no', 'No', 3, '#B91C1C', NULL)
) v(id, lookup_type_id, value_key, display_name, display_order, color_hex, notes)
WHERE NOT EXISTS (SELECT 1 FROM core.lookup_values existing WHERE existing.id = v.id);

INSERT INTO org.org_units (id, org_unit_type, code, name, description)
SELECT v.id, 'faculty', v.code, v.name, 'Seeded from the foundation workbook.'
FROM (VALUES
    ('20000000-0000-0000-0000-000000000001', 'CUCB', 'Construction & Motor Vehicle'),
    ('20000000-0000-0000-0000-000000000002', 'CUCP', 'Health, Social Care, Early Years & Science'),
    ('20000000-0000-0000-0000-000000000003', 'CUDCPA', 'Digital, Creative & Performing Arts'),
    ('20000000-0000-0000-0000-000000000004', 'CUENMT', 'English & Maths'),
    ('20000000-0000-0000-0000-000000000005', 'CUFP', 'Finance, Business & Accounting'),
    ('20000000-0000-0000-0000-000000000006', 'CUDS', 'SEND'),
    ('20000000-0000-0000-0000-000000000007', 'CUST', 'Sport & Public Services'),
    ('20000000-0000-0000-0000-000000000008', 'CURC', 'Hair, Beauty & Travel')
) v(id, code, name)
WHERE NOT EXISTS (SELECT 1 FROM org.org_units existing WHERE existing.id = v.id);

INSERT INTO auth.roles (id, role_key, name, description, is_system)
SELECT v.id, v.role_key, v.name, v.description, 1
FROM (VALUES
    ('30000000-0000-0000-0000-000000000001', 'super_admin', 'Super Admin', 'Full system configuration and user management.'),
    ('30000000-0000-0000-0000-000000000002', 'teaching_learning_team', 'Teaching & Learning Team', 'All forms and all reporting.'),
    ('30000000-0000-0000-0000-000000000003', 'director', 'Director', 'Strategic reporting across assigned areas.'),
    ('30000000-0000-0000-0000-000000000004', 'leader_manager', 'Leader / Manager', 'Forms and dashboards restricted to assigned scope.'),
    ('30000000-0000-0000-0000-000000000005', 'staff', 'Staff', 'Own profile, evidence submissions and assigned actions.')
) v(id, role_key, name, description)
WHERE NOT EXISTS (SELECT 1 FROM auth.roles existing WHERE existing.id = v.id);

INSERT INTO auth.permissions (id, permission_key, name, category)
SELECT v.id, v.permission_key, v.name, v.category
FROM (VALUES
    ('31000000-0000-0000-0000-000000000001', 'staff.read', 'Read Staff', 'Staff'),
    ('31000000-0000-0000-0000-000000000002', 'staff.manage', 'Manage Staff', 'Staff'),
    ('31000000-0000-0000-0000-000000000003', 'users.manage', 'Manage Users', 'Identity'),
    ('31000000-0000-0000-0000-000000000004', 'permissions.manage', 'Manage Permissions', 'Identity'),
    ('31000000-0000-0000-0000-000000000005', 'forms.manage', 'Manage Forms', 'Forms'),
    ('31000000-0000-0000-0000-000000000006', 'learning_walk.submit', 'Submit Learning Walks', 'Learning Walks'),
    ('31000000-0000-0000-0000-000000000007', 'work_scrutiny.submit', 'Submit Work Scrutiny', 'Work Scrutiny'),
    ('31000000-0000-0000-0000-000000000008', 'cpd.manage', 'Manage CPD', 'CPD'),
    ('31000000-0000-0000-0000-000000000009', 'evidence.submit', 'Submit Evidence', 'Evidence'),
    ('31000000-0000-0000-0000-000000000010', 'evidence.review', 'Review Evidence', 'Evidence'),
    ('31000000-0000-0000-0000-000000000011', 'actions.manage', 'Manage Actions', 'Actions'),
    ('31000000-0000-0000-0000-000000000012', 'reports.view_all', 'View All Reports', 'Reporting'),
    ('31000000-0000-0000-0000-000000000013', 'reports.view_scoped', 'View Scoped Reports', 'Reporting')
) v(id, permission_key, name, category)
WHERE NOT EXISTS (SELECT 1 FROM auth.permissions existing WHERE existing.id = v.id);

INSERT INTO auth.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM auth.roles r
CROSS JOIN auth.permissions p
WHERE r.role_key = 'super_admin'
AND NOT EXISTS (
    SELECT 1 FROM auth.role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
);

INSERT INTO auth.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM auth.roles r
JOIN auth.permissions p ON p.permission_key IN (
    'staff.read', 'forms.manage', 'learning_walk.submit', 'work_scrutiny.submit',
    'cpd.manage', 'evidence.submit', 'evidence.review', 'actions.manage',
    'reports.view_all', 'reports.view_scoped'
)
WHERE r.role_key = 'teaching_learning_team'
AND NOT EXISTS (
    SELECT 1 FROM auth.role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
);

INSERT INTO auth.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM auth.roles r
JOIN auth.permissions p ON p.permission_key IN (
    'staff.read', 'learning_walk.submit', 'work_scrutiny.submit',
    'actions.manage', 'reports.view_scoped'
)
WHERE r.role_key IN ('director', 'leader_manager')
AND NOT EXISTS (
    SELECT 1 FROM auth.role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
);

INSERT INTO auth.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM auth.roles r
JOIN auth.permissions p ON p.permission_key IN ('staff.read', 'evidence.submit')
WHERE r.role_key = 'staff'
AND NOT EXISTS (
    SELECT 1 FROM auth.role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
);

INSERT INTO people.staff (id, external_id, first_name, last_name, display_name, email, job_title, account_status)
SELECT v.id, v.external_id, v.first_name, v.last_name, v.display_name, v.email, v.job_title, 'active'
FROM (VALUES
    ('40000000-0000-0000-0000-000000000001', 'STAFF_0001', 'Harry', 'Bentley', 'Harry Bentley', 'harryjbentley@outlook.com', 'Digital Teaching & Learning Lead'),
    ('40000000-0000-0000-0000-000000000002', 'STAFF_0002', 'Example', 'Staff Member', 'Example Staff Member', 'example.staff@college.example', 'Lecturer')
) v(id, external_id, first_name, last_name, display_name, email, job_title)
WHERE NOT EXISTS (SELECT 1 FROM people.staff existing WHERE existing.id = v.id);

INSERT INTO auth.user_accounts (id, staff_id, account_status)
SELECT v.id, v.staff_id, 'active'
FROM (VALUES
    ('41000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001'),
    ('41000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002')
) v(id, staff_id)
WHERE NOT EXISTS (SELECT 1 FROM auth.user_accounts existing WHERE existing.id = v.id);

INSERT INTO auth.user_roles (user_account_id, role_id)
SELECT '41000000-0000-0000-0000-000000000001', id FROM auth.roles WHERE role_key = 'super_admin'
AND NOT EXISTS (SELECT 1 FROM auth.user_roles WHERE user_account_id = '41000000-0000-0000-0000-000000000001' AND role_id = auth.roles.id);

INSERT INTO auth.user_roles (user_account_id, role_id)
SELECT '41000000-0000-0000-0000-000000000002', id FROM auth.roles WHERE role_key = 'staff'
AND NOT EXISTS (SELECT 1 FROM auth.user_roles WHERE user_account_id = '41000000-0000-0000-0000-000000000002' AND role_id = auth.roles.id);

INSERT INTO auth.access_scopes (user_account_id, scope_type)
SELECT '41000000-0000-0000-0000-000000000001', 'global'
WHERE NOT EXISTS (SELECT 1 FROM auth.access_scopes WHERE user_account_id = '41000000-0000-0000-0000-000000000001' AND scope_type = 'global');

INSERT INTO auth.access_scopes (user_account_id, scope_type, staff_id)
SELECT '41000000-0000-0000-0000-000000000002', 'self', '40000000-0000-0000-0000-000000000002'
WHERE NOT EXISTS (SELECT 1 FROM auth.access_scopes WHERE user_account_id = '41000000-0000-0000-0000-000000000002' AND scope_type = 'self');

INSERT INTO core.modules (id, module_key, name, route_prefix, display_order, description)
SELECT v.id, v.module_key, v.name, v.route_prefix, v.display_order, v.description
FROM (VALUES
    ('50000000-0000-0000-0000-000000000001', 'staff', 'Staff Management', '/staff', 10, 'Staff profiles, manager hierarchy and CSV import.'),
    ('50000000-0000-0000-0000-000000000002', 'identity_access', 'User Accounts & Permissions', '/admin/users', 20, 'Users, roles, permissions and scoped access.'),
    ('50000000-0000-0000-0000-000000000003', 'learning_walks', 'Learning Walks', '/learning-walks', 30, 'Learning walk records and form submissions.'),
    ('50000000-0000-0000-0000-000000000004', 'work_scrutiny', 'Work Scrutiny', '/work-scrutiny', 40, 'Work scrutiny records and actions.'),
    ('50000000-0000-0000-0000-000000000005', 'cpd', 'CPD Management', '/cpd', 50, 'CPD events, attendance and milestones.'),
    ('50000000-0000-0000-0000-000000000006', 'evidence', 'Staff Development Evidence', '/evidence', 60, 'Impact evidence and file attachments.'),
    ('50000000-0000-0000-0000-000000000007', 'actions', 'Actions', '/actions', 70, 'Universal action tracker.'),
    ('50000000-0000-0000-0000-000000000008', 'reporting', 'Reporting', '/reports', 80, 'Role-aware dashboards.')
) v(id, module_key, name, route_prefix, display_order, description)
WHERE NOT EXISTS (SELECT 1 FROM core.modules existing WHERE existing.id = v.id);

INSERT INTO reporting.dashboards (id, dashboard_key, name, purpose, primary_permission_key, faculty_scope_required, config_json)
SELECT v.id, v.dashboard_key, v.name, v.purpose, v.permission_key, v.faculty_scope_required, v.config_json
FROM (VALUES
    ('60000000-0000-0000-0000-000000000001', 'tl_overview', 'T&L Overview', 'Whole-system view of walks, scrutiny, CPD, evidence and actions.', 'reports.view_all', 0, '{"filters":["dateRange","faculty","process","theme"]}'),
    ('60000000-0000-0000-0000-000000000002', 'faculty_dashboard', 'Faculty Dashboard', 'Restricted faculty view for leaders and managers.', 'reports.view_scoped', 1, '{"filters":["assignedFaculty","dateRange","staff"]}'),
    ('60000000-0000-0000-0000-000000000003', 'staff_profile', 'Staff Profile', 'Single staff profile showing activity, CPD, evidence and actions.', 'reports.view_scoped', 1, '{"filters":["staffId"]}'),
    ('60000000-0000-0000-0000-000000000004', 'cpd_milestones', 'CPD Milestones', 'Tracks attendance against milestone thresholds.', 'reports.view_all', 0, '{"thresholds":[3,6,9,12,15]}')
) v(id, dashboard_key, name, purpose, permission_key, faculty_scope_required, config_json)
WHERE NOT EXISTS (SELECT 1 FROM reporting.dashboards existing WHERE existing.id = v.id);

DECLARE @learningWalkTemplate uniqueidentifier = '70000000-0000-0000-0000-000000000001';
DECLARE @learningWalkVersion uniqueidentifier = '71000000-0000-0000-0000-000000000001';
DECLARE @lwContext uniqueidentifier = '72000000-0000-0000-0000-000000000001';
DECLARE @lwTeaching uniqueidentifier = '72000000-0000-0000-0000-000000000002';

INSERT INTO forms.form_templates (id, module_id, template_key, name, description)
SELECT @learningWalkTemplate, id, 'learning_walk_core', 'Learning Walk Core Template', 'Admin-editable learning walk structure.'
FROM core.modules WHERE module_key = 'learning_walks'
AND NOT EXISTS (SELECT 1 FROM forms.form_templates WHERE id = @learningWalkTemplate);

INSERT INTO forms.form_template_versions (id, form_template_id, version_label, active_from, is_published, created_by_user_account_id)
SELECT @learningWalkVersion, @learningWalkTemplate, '1.0', sysutcdatetime(), 1, '41000000-0000-0000-0000-000000000001'
WHERE NOT EXISTS (SELECT 1 FROM forms.form_template_versions WHERE id = @learningWalkVersion);

INSERT INTO forms.form_sections (id, form_template_version_id, section_key, title, display_order)
SELECT v.id, @learningWalkVersion, v.section_key, v.title, v.display_order
FROM (VALUES
    (@lwContext, 'context', 'Context', 1),
    (@lwTeaching, 'teaching_learning', 'Teaching & Learning', 2)
) v(id, section_key, title, display_order)
WHERE NOT EXISTS (SELECT 1 FROM forms.form_sections existing WHERE existing.id = v.id);

INSERT INTO forms.form_fields (id, form_section_id, field_key, label, field_type, is_required, display_order, help_text)
SELECT v.id, v.section_id, v.field_key, v.label, v.field_type, v.is_required, v.display_order, v.help_text
FROM (VALUES
    ('73000000-0000-0000-0000-000000000001', @lwContext, 'visit_date', 'Date of visit', 'date', 1, 1, NULL),
    ('73000000-0000-0000-0000-000000000002', @lwContext, 'staff_id', 'Staff member observed', 'staff_lookup', 1, 2, 'Links to staff.'),
    ('73000000-0000-0000-0000-000000000003', @lwTeaching, 'what_was_seen', 'What was seen?', 'long_text', 1, 10, 'Narrative evidence.'),
    ('73000000-0000-0000-0000-000000000004', @lwTeaching, 'strengths', 'Strengths identified', 'long_text', 0, 20, NULL),
    ('73000000-0000-0000-0000-000000000005', @lwTeaching, 'development_points', 'Development points', 'long_text', 0, 30, NULL)
) v(id, section_id, field_key, label, field_type, is_required, display_order, help_text)
WHERE NOT EXISTS (SELECT 1 FROM forms.form_fields existing WHERE existing.id = v.id);

COMMIT TRANSACTION;
GO
