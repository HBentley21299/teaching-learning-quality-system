SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO

-- Room data is managed separately from form responses so room names can be
-- corrected without changing the historical assessment record.
IF OBJECT_ID('quality.rooms', 'U') IS NULL
BEGIN
    CREATE TABLE quality.rooms (
        id uniqueidentifier NOT NULL CONSTRAINT pk_rooms PRIMARY KEY DEFAULT newsequentialid(),
        room_code nvarchar(50) NOT NULL,
        building_name nvarchar(200) NOT NULL,
        is_active bit NOT NULL CONSTRAINT df_rooms_active DEFAULT 1,
        created_at datetimeoffset NOT NULL CONSTRAINT df_rooms_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        archived_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT uq_rooms_code UNIQUE (room_code)
    );
END;
GO

IF OBJECT_ID('quality.elevate_environment_assessments', 'U') IS NULL
BEGIN
    CREATE TABLE quality.elevate_environment_assessments (
        record_id uniqueidentifier NOT NULL CONSTRAINT pk_elevate_environment_assessments PRIMARY KEY,
        room_id uniqueidentifier NOT NULL,
        total_score int NOT NULL,
        scored_value_count tinyint NOT NULL,
        barrier_count tinyint NOT NULL CONSTRAINT df_elevate_assessments_barriers DEFAULT 0,
        created_at datetimeoffset NOT NULL CONSTRAINT df_elevate_assessments_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT fk_elevate_assessments_record FOREIGN KEY (record_id) REFERENCES core.records(id),
        CONSTRAINT fk_elevate_assessments_room FOREIGN KEY (room_id) REFERENCES quality.rooms(id),
        CONSTRAINT ck_elevate_assessments_total CHECK (total_score BETWEEN 0 AND 15),
        CONSTRAINT ck_elevate_assessments_count CHECK (scored_value_count BETWEEN 1 AND 5),
        CONSTRAINT ck_elevate_assessments_barriers CHECK (barrier_count BETWEEN 0 AND 5)
    );
END;
GO

IF OBJECT_ID('quality.elevate_environment_action_links', 'U') IS NULL
BEGIN
    CREATE TABLE quality.elevate_environment_action_links (
        record_id uniqueidentifier NOT NULL,
        value_key nvarchar(50) NOT NULL,
        action_id uniqueidentifier NOT NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_elevate_action_links_created DEFAULT sysutcdatetime(),
        CONSTRAINT pk_elevate_action_links PRIMARY KEY (record_id, value_key),
        CONSTRAINT fk_elevate_action_links_record FOREIGN KEY (record_id) REFERENCES core.records(id),
        CONSTRAINT fk_elevate_action_links_action FOREIGN KEY (action_id) REFERENCES quality.actions(id)
    );
END;
GO

INSERT INTO core.modules (id, module_key, name, route_prefix, display_order, description)
SELECT '50000000-0000-0000-0000-000000000010', 'elevate_environments', 'Elevate Learning Environments', '/elevate-learning-environments', 47,
       'Room evaluations against the Elevate Learning Environments rubric.'
WHERE NOT EXISTS (SELECT 1 FROM core.modules WHERE module_key = 'elevate_environments');
GO

INSERT INTO auth.permissions (id, permission_key, name, category)
SELECT v.id, v.permission_key, v.name, v.category
FROM (VALUES
    ('31000000-0000-0000-0000-000000000016', 'elevate.submit', 'Complete Elevate Environment Checks', 'Elevate Learning Environments'),
    ('31000000-0000-0000-0000-000000000017', 'elevate.manage', 'Manage Elevate Environment Checks', 'Elevate Learning Environments')
) v(id, permission_key, name, category)
WHERE NOT EXISTS (SELECT 1 FROM auth.permissions existing WHERE existing.permission_key = v.permission_key);
GO

INSERT INTO auth.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM auth.roles r
JOIN auth.permissions p ON p.permission_key IN ('elevate.submit', 'elevate.manage')
WHERE r.role_key IN ('super_admin', 'teaching_learning_team')
  AND NOT EXISTS (
      SELECT 1 FROM auth.role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
GO

INSERT INTO auth.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM auth.roles r
JOIN auth.permissions p ON p.permission_key = 'elevate.submit'
WHERE r.role_key IN ('director', 'leader_manager')
  AND NOT EXISTS (
      SELECT 1 FROM auth.role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
GO

DECLARE @moduleId uniqueidentifier = (SELECT id FROM core.modules WHERE module_key = 'elevate_environments');
DECLARE @templateId uniqueidentifier = '80000000-0000-0000-0000-000000000001';
DECLARE @versionId uniqueidentifier = '80000000-0000-0000-0000-000000000002';

INSERT INTO forms.form_templates (id, module_id, template_key, name, description, is_active)
SELECT @templateId, @moduleId, 'elevate_learning_environments_core', 'Elevate Learning Environments Check',
       'Practical room evaluation using the five Elevate values.', 1
WHERE @moduleId IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM forms.form_templates WHERE template_key = 'elevate_learning_environments_core');

INSERT INTO forms.form_template_versions (id, form_template_id, version_label, active_from, is_published, created_by_user_account_id)
SELECT @versionId, @templateId, '1.0', sysutcdatetime(), 1, '41000000-0000-0000-0000-000000000001'
WHERE EXISTS (SELECT 1 FROM forms.form_templates WHERE id = @templateId)
  AND NOT EXISTS (SELECT 1 FROM forms.form_template_versions WHERE id = @versionId);

DECLARE @context uniqueidentifier = '81000000-0000-0000-0000-000000000001';
DECLARE @aspirational uniqueidentifier = '81000000-0000-0000-0000-000000000002';
DECLARE @collaborative uniqueidentifier = '81000000-0000-0000-0000-000000000003';
DECLARE @respectful uniqueidentifier = '81000000-0000-0000-0000-000000000004';
DECLARE @innovative uniqueidentifier = '81000000-0000-0000-0000-000000000005';
DECLARE @inclusion uniqueidentifier = '81000000-0000-0000-0000-000000000006';

INSERT INTO forms.form_sections (id, form_template_version_id, section_key, title, display_order)
SELECT v.id, @versionId, v.section_key, v.title, v.display_order
FROM (VALUES
    (@context, 'room_context', 'Room and purpose', 1),
    (@aspirational, 'aspirational', 'Aspirational', 2),
    (@collaborative, 'collaborative', 'Collaborative', 3),
    (@respectful, 'respectful', 'Respectful', 4),
    (@innovative, 'innovative', 'Innovative', 5),
    (@inclusion, 'inclusion', 'Inclusion', 6)
) v(id, section_key, title, display_order)
WHERE EXISTS (SELECT 1 FROM forms.form_template_versions WHERE id = @versionId)
  AND NOT EXISTS (SELECT 1 FROM forms.form_sections existing WHERE existing.id = v.id);

INSERT INTO forms.form_fields (id, form_section_id, field_key, label, field_type, is_required, display_order, help_text)
SELECT v.id, v.section_id, v.field_key, v.label, v.field_type, v.is_required, v.display_order, v.help_text
FROM (VALUES
    ('82000000-0000-0000-0000-000000000001', @context, 'room_code', 'Room code', 'room_lookup', 1, 10, 'Type a room code to filter the room register.'),
    ('82000000-0000-0000-0000-000000000002', @context, 'building_name', 'Building', 'auto_text', 1, 20, 'Filled automatically from the room register.'),
    ('82000000-0000-0000-0000-000000000003', @context, 'assessment_date', 'Date of check', 'date', 1, 30, NULL),
    ('82000000-0000-0000-0000-000000000004', @context, 'intended_purpose', 'Intended purpose', 'long_text', 1, 40, 'Judge the room against its intended purpose, including specialist layouts and safe working practices.'),

    ('82000000-0000-0000-0000-000000000010', @aspirational, 'aspirational_score', 'Score', 'score_0_3', 1, 10, 'Does the environment communicate high expectations and prepare learners for excellent work? Look for readiness, current resources, a clear curriculum purpose, quality, progression and pride.'),
    ('82000000-0000-0000-0000-000000000011', @aspirational, 'aspirational_working', 'What is working?', 'long_text', 0, 20, 'Record only the most relevant evidence.'),
    ('82000000-0000-0000-0000-000000000012', @aspirational, 'aspirational_action', 'Highest-impact action', 'long_text', 0, 30, NULL),
    ('82000000-0000-0000-0000-000000000013', @aspirational, 'aspirational_owner', 'Action owner', 'staff_lookup', 0, 40, NULL),
    ('82000000-0000-0000-0000-000000000014', @aspirational, 'aspirational_target', 'Target date', 'date', 0, 50, NULL),

    ('82000000-0000-0000-0000-000000000020', @collaborative, 'collaborative_score', 'Score', 'score_0_3', 1, 10, 'Does the environment enable communication, demonstration, practice and effective collaboration? Look for visibility, flexible activity, safe movement and accessible shared resources.'),
    ('82000000-0000-0000-0000-000000000021', @collaborative, 'collaborative_working', 'What is working?', 'long_text', 0, 20, 'Record only the most relevant evidence.'),
    ('82000000-0000-0000-0000-000000000022', @collaborative, 'collaborative_action', 'Highest-impact action', 'long_text', 0, 30, NULL),
    ('82000000-0000-0000-0000-000000000023', @collaborative, 'collaborative_owner', 'Action owner', 'staff_lookup', 0, 40, NULL),
    ('82000000-0000-0000-0000-000000000024', @collaborative, 'collaborative_target', 'Target date', 'date', 0, 50, NULL),

    ('82000000-0000-0000-0000-000000000030', @respectful, 'respectful_score', 'Score', 'score_0_3', 1, 10, 'Does the room show care for learners, staff, their work and subject standards? Look for cleanliness, safe storage, suitable comfort, privacy and clear fault-reporting routines.'),
    ('82000000-0000-0000-0000-000000000031', @respectful, 'respectful_working', 'What is working?', 'long_text', 0, 20, 'Record only the most relevant evidence.'),
    ('82000000-0000-0000-0000-000000000032', @respectful, 'respectful_action', 'Highest-impact action', 'long_text', 0, 30, NULL),
    ('82000000-0000-0000-0000-000000000033', @respectful, 'respectful_owner', 'Action owner', 'staff_lookup', 0, 40, NULL),
    ('82000000-0000-0000-0000-000000000034', @respectful, 'respectful_target', 'Target date', 'date', 0, 50, NULL),

    ('82000000-0000-0000-0000-000000000040', @innovative, 'innovative_score', 'Score', 'score_0_3', 1, 10, 'Do the room, resources and equipment improve learning and support current or future practice? Look for reliable tools, authentic practice, experimentation, independence and better feedback.'),
    ('82000000-0000-0000-0000-000000000041', @innovative, 'innovative_working', 'What is working?', 'long_text', 0, 20, 'Record only the most relevant evidence.'),
    ('82000000-0000-0000-0000-000000000042', @innovative, 'innovative_action', 'Highest-impact action', 'long_text', 0, 30, NULL),
    ('82000000-0000-0000-0000-000000000043', @innovative, 'innovative_owner', 'Action owner', 'staff_lookup', 0, 40, NULL),
    ('82000000-0000-0000-0000-000000000044', @innovative, 'innovative_target', 'Target date', 'date', 0, 50, NULL),

    ('82000000-0000-0000-0000-000000000050', @inclusion, 'inclusion_score', 'Score', 'score_0_3', 1, 10, 'Can learners access, participate and work as independently as possible without reduced expectations? Look for accessible routes and equipment, clear instructions, sensory needs and dignified adjustments.'),
    ('82000000-0000-0000-0000-000000000051', @inclusion, 'inclusion_working', 'What is working?', 'long_text', 0, 20, 'Record only the most relevant evidence.'),
    ('82000000-0000-0000-0000-000000000052', @inclusion, 'inclusion_action', 'Highest-impact action', 'long_text', 0, 30, NULL),
    ('82000000-0000-0000-0000-000000000053', @inclusion, 'inclusion_owner', 'Action owner', 'staff_lookup', 0, 40, NULL),
    ('82000000-0000-0000-0000-000000000054', @inclusion, 'inclusion_target', 'Target date', 'date', 0, 50, NULL)
) v(id, section_id, field_key, label, field_type, is_required, display_order, help_text)
WHERE EXISTS (SELECT 1 FROM forms.form_sections WHERE id = v.section_id)
  AND NOT EXISTS (SELECT 1 FROM forms.form_fields existing WHERE existing.id = v.id);
GO
