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

IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'people') EXEC('CREATE SCHEMA people');
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'auth') EXEC('CREATE SCHEMA auth');
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'org') EXEC('CREATE SCHEMA org');
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'core') EXEC('CREATE SCHEMA core');
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'forms') EXEC('CREATE SCHEMA forms');
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'quality') EXEC('CREATE SCHEMA quality');
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'cpd') EXEC('CREATE SCHEMA cpd');
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'evidence') EXEC('CREATE SCHEMA evidence');
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'ops') EXEC('CREATE SCHEMA ops');
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'reporting') EXEC('CREATE SCHEMA reporting');

CREATE TABLE core.lookup_types (
    id uniqueidentifier NOT NULL CONSTRAINT pk_lookup_types PRIMARY KEY DEFAULT newsequentialid(),
    lookup_key nvarchar(100) NOT NULL,
    name nvarchar(200) NOT NULL,
    description nvarchar(1000) NULL,
    is_system bit NOT NULL CONSTRAINT df_lookup_types_is_system DEFAULT 0,
    is_active bit NOT NULL CONSTRAINT df_lookup_types_is_active DEFAULT 1,
    created_at datetimeoffset NOT NULL CONSTRAINT df_lookup_types_created DEFAULT sysutcdatetime(),
    updated_at datetimeoffset NULL,
    archived_at datetimeoffset NULL,
    row_version rowversion NOT NULL,
    CONSTRAINT uq_lookup_types_key UNIQUE (lookup_key)
);

CREATE TABLE core.lookup_values (
    id uniqueidentifier NOT NULL CONSTRAINT pk_lookup_values PRIMARY KEY DEFAULT newsequentialid(),
    lookup_type_id uniqueidentifier NOT NULL,
    value_key nvarchar(100) NOT NULL,
    display_name nvarchar(200) NOT NULL,
    display_order int NOT NULL CONSTRAINT df_lookup_values_order DEFAULT 0,
    color_hex char(7) NULL,
    is_active bit NOT NULL CONSTRAINT df_lookup_values_active DEFAULT 1,
    notes nvarchar(1000) NULL,
    created_at datetimeoffset NOT NULL CONSTRAINT df_lookup_values_created DEFAULT sysutcdatetime(),
    updated_at datetimeoffset NULL,
    archived_at datetimeoffset NULL,
    row_version rowversion NOT NULL,
    CONSTRAINT fk_lookup_values_type FOREIGN KEY (lookup_type_id) REFERENCES core.lookup_types(id),
    CONSTRAINT uq_lookup_values_type_key UNIQUE (lookup_type_id, value_key)
);

CREATE TABLE org.org_units (
    id uniqueidentifier NOT NULL CONSTRAINT pk_org_units PRIMARY KEY DEFAULT newsequentialid(),
    parent_org_unit_id uniqueidentifier NULL,
    org_unit_type nvarchar(50) NOT NULL,
    code nvarchar(50) NOT NULL,
    name nvarchar(250) NOT NULL,
    description nvarchar(1000) NULL,
    is_active bit NOT NULL CONSTRAINT df_org_units_active DEFAULT 1,
    created_at datetimeoffset NOT NULL CONSTRAINT df_org_units_created DEFAULT sysutcdatetime(),
    updated_at datetimeoffset NULL,
    archived_at datetimeoffset NULL,
    row_version rowversion NOT NULL,
    CONSTRAINT fk_org_units_parent FOREIGN KEY (parent_org_unit_id) REFERENCES org.org_units(id),
    CONSTRAINT uq_org_units_code UNIQUE (code)
);

CREATE TABLE people.staff (
    id uniqueidentifier NOT NULL CONSTRAINT pk_staff PRIMARY KEY DEFAULT newsequentialid(),
    external_id nvarchar(50) NOT NULL,
    first_name nvarchar(100) NULL,
    last_name nvarchar(100) NULL,
    display_name nvarchar(220) NOT NULL,
    email nvarchar(320) NOT NULL,
    job_title nvarchar(200) NULL,
    line_manager_staff_id uniqueidentifier NULL,
    primary_org_unit_id uniqueidentifier NULL,
    account_status nvarchar(50) NOT NULL CONSTRAINT df_staff_account_status DEFAULT 'active',
    start_date date NULL,
    end_date date NULL,
    notes nvarchar(2000) NULL,
    created_at datetimeoffset NOT NULL CONSTRAINT df_staff_created DEFAULT sysutcdatetime(),
    updated_at datetimeoffset NULL,
    archived_at datetimeoffset NULL,
    row_version rowversion NOT NULL,
    CONSTRAINT fk_staff_line_manager FOREIGN KEY (line_manager_staff_id) REFERENCES people.staff(id),
    CONSTRAINT fk_staff_primary_org_unit FOREIGN KEY (primary_org_unit_id) REFERENCES org.org_units(id),
    CONSTRAINT uq_staff_external_id UNIQUE (external_id),
    CONSTRAINT uq_staff_email UNIQUE (email)
);

CREATE TABLE auth.user_accounts (
    id uniqueidentifier NOT NULL CONSTRAINT pk_user_accounts PRIMARY KEY DEFAULT newsequentialid(),
    staff_id uniqueidentifier NOT NULL,
    account_status nvarchar(50) NOT NULL CONSTRAINT df_user_accounts_status DEFAULT 'active',
    is_disabled bit NOT NULL CONSTRAINT df_user_accounts_disabled DEFAULT 0,
    last_login_at datetimeoffset NULL,
    created_at datetimeoffset NOT NULL CONSTRAINT df_user_accounts_created DEFAULT sysutcdatetime(),
    updated_at datetimeoffset NULL,
    archived_at datetimeoffset NULL,
    row_version rowversion NOT NULL,
    CONSTRAINT fk_user_accounts_staff FOREIGN KEY (staff_id) REFERENCES people.staff(id),
    CONSTRAINT uq_user_accounts_staff UNIQUE (staff_id)
);

CREATE TABLE auth.auth_identities (
    id uniqueidentifier NOT NULL CONSTRAINT pk_auth_identities PRIMARY KEY DEFAULT newsequentialid(),
    user_account_id uniqueidentifier NOT NULL,
    provider nvarchar(50) NOT NULL,
    tenant_id uniqueidentifier NOT NULL,
    provider_subject_id nvarchar(200) NOT NULL,
    email_claim nvarchar(320) NOT NULL,
    created_at datetimeoffset NOT NULL CONSTRAINT df_auth_identities_created DEFAULT sysutcdatetime(),
    updated_at datetimeoffset NULL,
    archived_at datetimeoffset NULL,
    row_version rowversion NOT NULL,
    CONSTRAINT fk_auth_identities_user FOREIGN KEY (user_account_id) REFERENCES auth.user_accounts(id),
    CONSTRAINT uq_auth_identity_provider_subject UNIQUE (provider, tenant_id, provider_subject_id)
);

CREATE TABLE auth.roles (
    id uniqueidentifier NOT NULL CONSTRAINT pk_roles PRIMARY KEY DEFAULT newsequentialid(),
    role_key nvarchar(100) NOT NULL,
    name nvarchar(200) NOT NULL,
    description nvarchar(1000) NULL,
    is_system bit NOT NULL CONSTRAINT df_roles_is_system DEFAULT 0,
    is_active bit NOT NULL CONSTRAINT df_roles_active DEFAULT 1,
    created_at datetimeoffset NOT NULL CONSTRAINT df_roles_created DEFAULT sysutcdatetime(),
    updated_at datetimeoffset NULL,
    archived_at datetimeoffset NULL,
    row_version rowversion NOT NULL,
    CONSTRAINT uq_roles_key UNIQUE (role_key)
);

CREATE TABLE auth.permissions (
    id uniqueidentifier NOT NULL CONSTRAINT pk_permissions PRIMARY KEY DEFAULT newsequentialid(),
    permission_key nvarchar(150) NOT NULL,
    name nvarchar(200) NOT NULL,
    description nvarchar(1000) NULL,
    category nvarchar(100) NOT NULL,
    is_system bit NOT NULL CONSTRAINT df_permissions_is_system DEFAULT 1,
    created_at datetimeoffset NOT NULL CONSTRAINT df_permissions_created DEFAULT sysutcdatetime(),
    updated_at datetimeoffset NULL,
    archived_at datetimeoffset NULL,
    row_version rowversion NOT NULL,
    CONSTRAINT uq_permissions_key UNIQUE (permission_key)
);

CREATE TABLE auth.role_permissions (
    id uniqueidentifier NOT NULL CONSTRAINT pk_role_permissions PRIMARY KEY DEFAULT newsequentialid(),
    role_id uniqueidentifier NOT NULL,
    permission_id uniqueidentifier NOT NULL,
    created_at datetimeoffset NOT NULL CONSTRAINT df_role_permissions_created DEFAULT sysutcdatetime(),
    CONSTRAINT fk_role_permissions_role FOREIGN KEY (role_id) REFERENCES auth.roles(id),
    CONSTRAINT fk_role_permissions_permission FOREIGN KEY (permission_id) REFERENCES auth.permissions(id),
    CONSTRAINT uq_role_permissions UNIQUE (role_id, permission_id)
);

CREATE TABLE auth.user_roles (
    id uniqueidentifier NOT NULL CONSTRAINT pk_user_roles PRIMARY KEY DEFAULT newsequentialid(),
    user_account_id uniqueidentifier NOT NULL,
    role_id uniqueidentifier NOT NULL,
    active_from datetimeoffset NOT NULL CONSTRAINT df_user_roles_active_from DEFAULT sysutcdatetime(),
    active_to datetimeoffset NULL,
    created_at datetimeoffset NOT NULL CONSTRAINT df_user_roles_created DEFAULT sysutcdatetime(),
    CONSTRAINT fk_user_roles_user FOREIGN KEY (user_account_id) REFERENCES auth.user_accounts(id),
    CONSTRAINT fk_user_roles_role FOREIGN KEY (role_id) REFERENCES auth.roles(id),
    CONSTRAINT uq_user_roles UNIQUE (user_account_id, role_id, active_from)
);

CREATE TABLE org.staff_org_memberships (
    id uniqueidentifier NOT NULL CONSTRAINT pk_staff_org_memberships PRIMARY KEY DEFAULT newsequentialid(),
    staff_id uniqueidentifier NOT NULL,
    org_unit_id uniqueidentifier NOT NULL,
    membership_type nvarchar(50) NOT NULL CONSTRAINT df_staff_org_membership_type DEFAULT 'member',
    is_primary bit NOT NULL CONSTRAINT df_staff_org_memberships_primary DEFAULT 0,
    active_from date NULL,
    active_to date NULL,
    created_at datetimeoffset NOT NULL CONSTRAINT df_staff_org_memberships_created DEFAULT sysutcdatetime(),
    updated_at datetimeoffset NULL,
    archived_at datetimeoffset NULL,
    row_version rowversion NOT NULL,
    CONSTRAINT fk_staff_org_memberships_staff FOREIGN KEY (staff_id) REFERENCES people.staff(id),
    CONSTRAINT fk_staff_org_memberships_org FOREIGN KEY (org_unit_id) REFERENCES org.org_units(id),
    CONSTRAINT uq_staff_org_membership UNIQUE (staff_id, org_unit_id, membership_type, active_from)
);

CREATE TABLE auth.access_scopes (
    id uniqueidentifier NOT NULL CONSTRAINT pk_access_scopes PRIMARY KEY DEFAULT newsequentialid(),
    user_account_id uniqueidentifier NOT NULL,
    scope_type nvarchar(50) NOT NULL,
    org_unit_id uniqueidentifier NULL,
    staff_id uniqueidentifier NULL,
    is_active bit NOT NULL CONSTRAINT df_access_scopes_active DEFAULT 1,
    created_at datetimeoffset NOT NULL CONSTRAINT df_access_scopes_created DEFAULT sysutcdatetime(),
    updated_at datetimeoffset NULL,
    archived_at datetimeoffset NULL,
    row_version rowversion NOT NULL,
    CONSTRAINT fk_access_scopes_user FOREIGN KEY (user_account_id) REFERENCES auth.user_accounts(id),
    CONSTRAINT fk_access_scopes_org FOREIGN KEY (org_unit_id) REFERENCES org.org_units(id),
    CONSTRAINT fk_access_scopes_staff FOREIGN KEY (staff_id) REFERENCES people.staff(id)
);

CREATE TABLE core.modules (
    id uniqueidentifier NOT NULL CONSTRAINT pk_modules PRIMARY KEY DEFAULT newsequentialid(),
    module_key nvarchar(100) NOT NULL,
    name nvarchar(200) NOT NULL,
    description nvarchar(1000) NULL,
    route_prefix nvarchar(200) NOT NULL,
    display_order int NOT NULL CONSTRAINT df_modules_order DEFAULT 0,
    is_enabled bit NOT NULL CONSTRAINT df_modules_enabled DEFAULT 1,
    created_at datetimeoffset NOT NULL CONSTRAINT df_modules_created DEFAULT sysutcdatetime(),
    updated_at datetimeoffset NULL,
    archived_at datetimeoffset NULL,
    row_version rowversion NOT NULL,
    CONSTRAINT uq_modules_key UNIQUE (module_key)
);

CREATE TABLE core.records (
    id uniqueidentifier NOT NULL CONSTRAINT pk_records PRIMARY KEY DEFAULT newsequentialid(),
    module_id uniqueidentifier NOT NULL,
    record_type nvarchar(100) NOT NULL,
    title nvarchar(300) NOT NULL,
    summary nvarchar(2000) NULL,
    status_lookup_value_id uniqueidentifier NULL,
    subject_staff_id uniqueidentifier NULL,
    owner_staff_id uniqueidentifier NULL,
    org_unit_id uniqueidentifier NULL,
    record_date date NULL,
    created_by_user_account_id uniqueidentifier NULL,
    updated_by_user_account_id uniqueidentifier NULL,
    created_at datetimeoffset NOT NULL CONSTRAINT df_records_created DEFAULT sysutcdatetime(),
    updated_at datetimeoffset NULL,
    archived_at datetimeoffset NULL,
    row_version rowversion NOT NULL,
    CONSTRAINT fk_records_module FOREIGN KEY (module_id) REFERENCES core.modules(id),
    CONSTRAINT fk_records_status FOREIGN KEY (status_lookup_value_id) REFERENCES core.lookup_values(id),
    CONSTRAINT fk_records_subject_staff FOREIGN KEY (subject_staff_id) REFERENCES people.staff(id),
    CONSTRAINT fk_records_owner_staff FOREIGN KEY (owner_staff_id) REFERENCES people.staff(id),
    CONSTRAINT fk_records_org_unit FOREIGN KEY (org_unit_id) REFERENCES org.org_units(id),
    CONSTRAINT fk_records_created_by FOREIGN KEY (created_by_user_account_id) REFERENCES auth.user_accounts(id),
    CONSTRAINT fk_records_updated_by FOREIGN KEY (updated_by_user_account_id) REFERENCES auth.user_accounts(id)
);

CREATE TABLE forms.form_templates (
    id uniqueidentifier NOT NULL CONSTRAINT pk_form_templates PRIMARY KEY DEFAULT newsequentialid(),
    module_id uniqueidentifier NOT NULL,
    template_key nvarchar(100) NOT NULL,
    name nvarchar(250) NOT NULL,
    description nvarchar(1000) NULL,
    is_active bit NOT NULL CONSTRAINT df_form_templates_active DEFAULT 1,
    created_at datetimeoffset NOT NULL CONSTRAINT df_form_templates_created DEFAULT sysutcdatetime(),
    updated_at datetimeoffset NULL,
    archived_at datetimeoffset NULL,
    row_version rowversion NOT NULL,
    CONSTRAINT fk_form_templates_module FOREIGN KEY (module_id) REFERENCES core.modules(id),
    CONSTRAINT uq_form_templates_key UNIQUE (template_key)
);

CREATE TABLE forms.form_template_versions (
    id uniqueidentifier NOT NULL CONSTRAINT pk_form_template_versions PRIMARY KEY DEFAULT newsequentialid(),
    form_template_id uniqueidentifier NOT NULL,
    version_label nvarchar(50) NOT NULL,
    active_from datetimeoffset NULL,
    active_to datetimeoffset NULL,
    is_published bit NOT NULL CONSTRAINT df_form_template_versions_published DEFAULT 0,
    created_by_user_account_id uniqueidentifier NULL,
    created_at datetimeoffset NOT NULL CONSTRAINT df_form_template_versions_created DEFAULT sysutcdatetime(),
    updated_at datetimeoffset NULL,
    archived_at datetimeoffset NULL,
    row_version rowversion NOT NULL,
    CONSTRAINT fk_form_template_versions_template FOREIGN KEY (form_template_id) REFERENCES forms.form_templates(id),
    CONSTRAINT fk_form_template_versions_created_by FOREIGN KEY (created_by_user_account_id) REFERENCES auth.user_accounts(id),
    CONSTRAINT uq_form_template_versions UNIQUE (form_template_id, version_label)
);

CREATE TABLE forms.form_sections (
    id uniqueidentifier NOT NULL CONSTRAINT pk_form_sections PRIMARY KEY DEFAULT newsequentialid(),
    form_template_version_id uniqueidentifier NOT NULL,
    section_key nvarchar(100) NOT NULL,
    title nvarchar(250) NOT NULL,
    description nvarchar(1000) NULL,
    display_order int NOT NULL,
    created_at datetimeoffset NOT NULL CONSTRAINT df_form_sections_created DEFAULT sysutcdatetime(),
    updated_at datetimeoffset NULL,
    archived_at datetimeoffset NULL,
    row_version rowversion NOT NULL,
    CONSTRAINT fk_form_sections_version FOREIGN KEY (form_template_version_id) REFERENCES forms.form_template_versions(id),
    CONSTRAINT uq_form_sections_key UNIQUE (form_template_version_id, section_key)
);

CREATE TABLE forms.form_fields (
    id uniqueidentifier NOT NULL CONSTRAINT pk_form_fields PRIMARY KEY DEFAULT newsequentialid(),
    form_section_id uniqueidentifier NOT NULL,
    field_key nvarchar(100) NOT NULL,
    label nvarchar(300) NOT NULL,
    field_type nvarchar(50) NOT NULL,
    options_lookup_type_id uniqueidentifier NULL,
    is_required bit NOT NULL CONSTRAINT df_form_fields_required DEFAULT 0,
    display_order int NOT NULL,
    help_text nvarchar(1000) NULL,
    validation_json nvarchar(max) NULL,
    is_active bit NOT NULL CONSTRAINT df_form_fields_active DEFAULT 1,
    created_at datetimeoffset NOT NULL CONSTRAINT df_form_fields_created DEFAULT sysutcdatetime(),
    updated_at datetimeoffset NULL,
    archived_at datetimeoffset NULL,
    row_version rowversion NOT NULL,
    CONSTRAINT fk_form_fields_section FOREIGN KEY (form_section_id) REFERENCES forms.form_sections(id),
    CONSTRAINT fk_form_fields_lookup_type FOREIGN KEY (options_lookup_type_id) REFERENCES core.lookup_types(id),
    CONSTRAINT uq_form_fields_key UNIQUE (form_section_id, field_key)
);

CREATE TABLE forms.form_submissions (
    id uniqueidentifier NOT NULL CONSTRAINT pk_form_submissions PRIMARY KEY DEFAULT newsequentialid(),
    record_id uniqueidentifier NOT NULL,
    form_template_version_id uniqueidentifier NOT NULL,
    submitted_by_user_account_id uniqueidentifier NULL,
    submitted_at datetimeoffset NULL,
    status nvarchar(50) NOT NULL CONSTRAINT df_form_submissions_status DEFAULT 'draft',
    created_at datetimeoffset NOT NULL CONSTRAINT df_form_submissions_created DEFAULT sysutcdatetime(),
    updated_at datetimeoffset NULL,
    archived_at datetimeoffset NULL,
    row_version rowversion NOT NULL,
    CONSTRAINT fk_form_submissions_record FOREIGN KEY (record_id) REFERENCES core.records(id),
    CONSTRAINT fk_form_submissions_template_version FOREIGN KEY (form_template_version_id) REFERENCES forms.form_template_versions(id),
    CONSTRAINT fk_form_submissions_submitted_by FOREIGN KEY (submitted_by_user_account_id) REFERENCES auth.user_accounts(id)
);

CREATE TABLE forms.form_responses (
    id uniqueidentifier NOT NULL CONSTRAINT pk_form_responses PRIMARY KEY DEFAULT newsequentialid(),
    form_submission_id uniqueidentifier NOT NULL,
    form_field_id uniqueidentifier NOT NULL,
    response_text nvarchar(max) NULL,
    response_number decimal(18,4) NULL,
    response_date date NULL,
    response_lookup_value_id uniqueidentifier NULL,
    response_json nvarchar(max) NULL,
    created_at datetimeoffset NOT NULL CONSTRAINT df_form_responses_created DEFAULT sysutcdatetime(),
    updated_at datetimeoffset NULL,
    archived_at datetimeoffset NULL,
    row_version rowversion NOT NULL,
    CONSTRAINT fk_form_responses_submission FOREIGN KEY (form_submission_id) REFERENCES forms.form_submissions(id),
    CONSTRAINT fk_form_responses_field FOREIGN KEY (form_field_id) REFERENCES forms.form_fields(id),
    CONSTRAINT fk_form_responses_lookup_value FOREIGN KEY (response_lookup_value_id) REFERENCES core.lookup_values(id),
    CONSTRAINT uq_form_responses_field UNIQUE (form_submission_id, form_field_id)
);

CREATE TABLE quality.activities (
    id uniqueidentifier NOT NULL CONSTRAINT pk_activities PRIMARY KEY DEFAULT newsequentialid(),
    record_id uniqueidentifier NOT NULL,
    activity_type nvarchar(100) NOT NULL,
    activity_date date NOT NULL,
    subject_staff_id uniqueidentifier NOT NULL,
    reviewer_staff_id uniqueidentifier NULL,
    org_unit_id uniqueidentifier NULL,
    programme_area nvarchar(250) NULL,
    course_level nvarchar(100) NULL,
    room nvarchar(100) NULL,
    summary_strengths nvarchar(max) NULL,
    summary_development nvarchar(max) NULL,
    created_at datetimeoffset NOT NULL CONSTRAINT df_activities_created DEFAULT sysutcdatetime(),
    updated_at datetimeoffset NULL,
    archived_at datetimeoffset NULL,
    row_version rowversion NOT NULL,
    CONSTRAINT fk_activities_record FOREIGN KEY (record_id) REFERENCES core.records(id),
    CONSTRAINT fk_activities_subject_staff FOREIGN KEY (subject_staff_id) REFERENCES people.staff(id),
    CONSTRAINT fk_activities_reviewer_staff FOREIGN KEY (reviewer_staff_id) REFERENCES people.staff(id),
    CONSTRAINT fk_activities_org_unit FOREIGN KEY (org_unit_id) REFERENCES org.org_units(id),
    CONSTRAINT uq_activities_record UNIQUE (record_id)
);

CREATE TABLE quality.learning_walk_details (
    activity_id uniqueidentifier NOT NULL CONSTRAINT pk_learning_walk_details PRIMARY KEY,
    visit_focus nvarchar(500) NULL,
    learners_present int NULL,
    publish_to_staff bit NOT NULL CONSTRAINT df_learning_walk_publish DEFAULT 0,
    created_at datetimeoffset NOT NULL CONSTRAINT df_learning_walk_created DEFAULT sysutcdatetime(),
    updated_at datetimeoffset NULL,
    row_version rowversion NOT NULL,
    CONSTRAINT fk_learning_walk_details_activity FOREIGN KEY (activity_id) REFERENCES quality.activities(id)
);

CREATE TABLE quality.work_scrutiny_details (
    activity_id uniqueidentifier NOT NULL CONSTRAINT pk_work_scrutiny_details PRIMARY KEY,
    sample_size int NULL,
    work_type nvarchar(150) NULL,
    feedback_strategy_notes nvarchar(max) NULL,
    publish_to_staff bit NOT NULL CONSTRAINT df_work_scrutiny_publish DEFAULT 0,
    created_at datetimeoffset NOT NULL CONSTRAINT df_work_scrutiny_created DEFAULT sysutcdatetime(),
    updated_at datetimeoffset NULL,
    row_version rowversion NOT NULL,
    CONSTRAINT fk_work_scrutiny_details_activity FOREIGN KEY (activity_id) REFERENCES quality.activities(id)
);

CREATE TABLE quality.actions (
    id uniqueidentifier NOT NULL CONSTRAINT pk_actions PRIMARY KEY DEFAULT newsequentialid(),
    source_record_id uniqueidentifier NULL,
    subject_staff_id uniqueidentifier NULL,
    owner_staff_id uniqueidentifier NOT NULL,
    title nvarchar(300) NOT NULL,
    detail nvarchar(max) NULL,
    priority_lookup_value_id uniqueidentifier NULL,
    status_lookup_value_id uniqueidentifier NULL,
    due_date date NULL,
    completed_date date NULL,
    reminder_enabled bit NOT NULL CONSTRAINT df_actions_reminder DEFAULT 1,
    last_reminder_sent_at datetimeoffset NULL,
    published_to_staff bit NOT NULL CONSTRAINT df_actions_published DEFAULT 0,
    created_by_user_account_id uniqueidentifier NULL,
    created_at datetimeoffset NOT NULL CONSTRAINT df_actions_created DEFAULT sysutcdatetime(),
    updated_at datetimeoffset NULL,
    archived_at datetimeoffset NULL,
    row_version rowversion NOT NULL,
    CONSTRAINT fk_actions_record FOREIGN KEY (source_record_id) REFERENCES core.records(id),
    CONSTRAINT fk_actions_subject_staff FOREIGN KEY (subject_staff_id) REFERENCES people.staff(id),
    CONSTRAINT fk_actions_owner_staff FOREIGN KEY (owner_staff_id) REFERENCES people.staff(id),
    CONSTRAINT fk_actions_priority FOREIGN KEY (priority_lookup_value_id) REFERENCES core.lookup_values(id),
    CONSTRAINT fk_actions_status FOREIGN KEY (status_lookup_value_id) REFERENCES core.lookup_values(id),
    CONSTRAINT fk_actions_created_by FOREIGN KEY (created_by_user_account_id) REFERENCES auth.user_accounts(id)
);

CREATE TABLE cpd.cpd_events (
    id uniqueidentifier NOT NULL CONSTRAINT pk_cpd_events PRIMARY KEY DEFAULT newsequentialid(),
    record_id uniqueidentifier NOT NULL,
    event_title nvarchar(300) NOT NULL,
    event_date date NOT NULL,
    start_time time NULL,
    end_time time NULL,
    theme_lookup_value_id uniqueidentifier NULL,
    delivery_method nvarchar(100) NULL,
    facilitator_staff_id uniqueidentifier NULL,
    location nvarchar(200) NULL,
    target_audience nvarchar(300) NULL,
    capacity int NULL,
    notes nvarchar(max) NULL,
    created_at datetimeoffset NOT NULL CONSTRAINT df_cpd_events_created DEFAULT sysutcdatetime(),
    updated_at datetimeoffset NULL,
    archived_at datetimeoffset NULL,
    row_version rowversion NOT NULL,
    CONSTRAINT fk_cpd_events_record FOREIGN KEY (record_id) REFERENCES core.records(id),
    CONSTRAINT fk_cpd_events_theme FOREIGN KEY (theme_lookup_value_id) REFERENCES core.lookup_values(id),
    CONSTRAINT fk_cpd_events_facilitator FOREIGN KEY (facilitator_staff_id) REFERENCES people.staff(id),
    CONSTRAINT uq_cpd_events_record UNIQUE (record_id)
);

CREATE TABLE cpd.cpd_attendance (
    id uniqueidentifier NOT NULL CONSTRAINT pk_cpd_attendance PRIMARY KEY DEFAULT newsequentialid(),
    cpd_event_id uniqueidentifier NOT NULL,
    staff_id uniqueidentifier NOT NULL,
    org_unit_id_at_time uniqueidentifier NULL,
    attendance_status nvarchar(50) NOT NULL,
    milestone_credit int NOT NULL CONSTRAINT df_cpd_attendance_credit DEFAULT 1,
    evidence_required bit NOT NULL CONSTRAINT df_cpd_attendance_evidence DEFAULT 0,
    created_at datetimeoffset NOT NULL CONSTRAINT df_cpd_attendance_created DEFAULT sysutcdatetime(),
    updated_at datetimeoffset NULL,
    archived_at datetimeoffset NULL,
    row_version rowversion NOT NULL,
    CONSTRAINT fk_cpd_attendance_event FOREIGN KEY (cpd_event_id) REFERENCES cpd.cpd_events(id),
    CONSTRAINT fk_cpd_attendance_staff FOREIGN KEY (staff_id) REFERENCES people.staff(id),
    CONSTRAINT fk_cpd_attendance_org FOREIGN KEY (org_unit_id_at_time) REFERENCES org.org_units(id),
    CONSTRAINT uq_cpd_attendance UNIQUE (cpd_event_id, staff_id)
);

CREATE TABLE evidence.evidence_items (
    id uniqueidentifier NOT NULL CONSTRAINT pk_evidence_items PRIMARY KEY DEFAULT newsequentialid(),
    staff_id uniqueidentifier NOT NULL,
    related_record_id uniqueidentifier NULL,
    related_action_id uniqueidentifier NULL,
    milestone_lookup_value_id uniqueidentifier NULL,
    evidence_date date NOT NULL,
    pillar_or_theme nvarchar(200) NULL,
    what_tried nvarchar(max) NULL,
    implementation_detail nvarchar(max) NULL,
    impact_summary nvarchar(max) NULL,
    impact_rating_lookup_value_id uniqueidentifier NULL,
    review_status_lookup_value_id uniqueidentifier NULL,
    reviewer_staff_id uniqueidentifier NULL,
    reviewer_notes nvarchar(max) NULL,
    created_by_user_account_id uniqueidentifier NULL,
    created_at datetimeoffset NOT NULL CONSTRAINT df_evidence_items_created DEFAULT sysutcdatetime(),
    updated_at datetimeoffset NULL,
    archived_at datetimeoffset NULL,
    row_version rowversion NOT NULL,
    CONSTRAINT fk_evidence_items_staff FOREIGN KEY (staff_id) REFERENCES people.staff(id),
    CONSTRAINT fk_evidence_items_record FOREIGN KEY (related_record_id) REFERENCES core.records(id),
    CONSTRAINT fk_evidence_items_action FOREIGN KEY (related_action_id) REFERENCES quality.actions(id),
    CONSTRAINT fk_evidence_items_milestone FOREIGN KEY (milestone_lookup_value_id) REFERENCES core.lookup_values(id),
    CONSTRAINT fk_evidence_items_rating FOREIGN KEY (impact_rating_lookup_value_id) REFERENCES core.lookup_values(id),
    CONSTRAINT fk_evidence_items_review_status FOREIGN KEY (review_status_lookup_value_id) REFERENCES core.lookup_values(id),
    CONSTRAINT fk_evidence_items_reviewer FOREIGN KEY (reviewer_staff_id) REFERENCES people.staff(id),
    CONSTRAINT fk_evidence_items_created_by FOREIGN KEY (created_by_user_account_id) REFERENCES auth.user_accounts(id)
);

CREATE TABLE evidence.file_assets (
    id uniqueidentifier NOT NULL CONSTRAINT pk_file_assets PRIMARY KEY DEFAULT newsequentialid(),
    blob_container nvarchar(100) NOT NULL,
    blob_name nvarchar(500) NOT NULL,
    original_file_name nvarchar(300) NOT NULL,
    content_type nvarchar(200) NOT NULL,
    file_size_bytes bigint NOT NULL,
    checksum_sha256 nvarchar(128) NULL,
    uploaded_by_user_account_id uniqueidentifier NULL,
    uploaded_at datetimeoffset NOT NULL CONSTRAINT df_file_assets_uploaded DEFAULT sysutcdatetime(),
    archived_at datetimeoffset NULL,
    row_version rowversion NOT NULL,
    CONSTRAINT fk_file_assets_uploaded_by FOREIGN KEY (uploaded_by_user_account_id) REFERENCES auth.user_accounts(id),
    CONSTRAINT uq_file_assets_blob UNIQUE (blob_container, blob_name)
);

CREATE TABLE evidence.file_attachments (
    id uniqueidentifier NOT NULL CONSTRAINT pk_file_attachments PRIMARY KEY DEFAULT newsequentialid(),
    file_asset_id uniqueidentifier NOT NULL,
    evidence_item_id uniqueidentifier NULL,
    record_id uniqueidentifier NULL,
    source_process nvarchar(100) NULL,
    notes nvarchar(1000) NULL,
    created_at datetimeoffset NOT NULL CONSTRAINT df_file_attachments_created DEFAULT sysutcdatetime(),
    CONSTRAINT fk_file_attachments_asset FOREIGN KEY (file_asset_id) REFERENCES evidence.file_assets(id),
    CONSTRAINT fk_file_attachments_evidence FOREIGN KEY (evidence_item_id) REFERENCES evidence.evidence_items(id),
    CONSTRAINT fk_file_attachments_record FOREIGN KEY (record_id) REFERENCES core.records(id)
);

CREATE TABLE ops.audit_logs (
    id uniqueidentifier NOT NULL CONSTRAINT pk_audit_logs PRIMARY KEY DEFAULT newsequentialid(),
    user_account_id uniqueidentifier NULL,
    record_id uniqueidentifier NULL,
    entity_name nvarchar(150) NOT NULL,
    entity_id uniqueidentifier NULL,
    action nvarchar(100) NOT NULL,
    summary nvarchar(1000) NULL,
    before_json nvarchar(max) NULL,
    after_json nvarchar(max) NULL,
    ip_address nvarchar(64) NULL,
    user_agent nvarchar(1000) NULL,
    created_at datetimeoffset NOT NULL CONSTRAINT df_audit_logs_created DEFAULT sysutcdatetime(),
    CONSTRAINT fk_audit_logs_user FOREIGN KEY (user_account_id) REFERENCES auth.user_accounts(id),
    CONSTRAINT fk_audit_logs_record FOREIGN KEY (record_id) REFERENCES core.records(id)
);

CREATE TABLE ops.notifications (
    id uniqueidentifier NOT NULL CONSTRAINT pk_notifications PRIMARY KEY DEFAULT newsequentialid(),
    user_account_id uniqueidentifier NOT NULL,
    related_action_id uniqueidentifier NULL,
    record_id uniqueidentifier NULL,
    notification_type nvarchar(100) NOT NULL,
    title nvarchar(300) NOT NULL,
    body nvarchar(max) NULL,
    delivery_channel nvarchar(50) NOT NULL CONSTRAINT df_notifications_channel DEFAULT 'in_app',
    scheduled_for datetimeoffset NULL,
    sent_at datetimeoffset NULL,
    read_at datetimeoffset NULL,
    created_at datetimeoffset NOT NULL CONSTRAINT df_notifications_created DEFAULT sysutcdatetime(),
    archived_at datetimeoffset NULL,
    row_version rowversion NOT NULL,
    CONSTRAINT fk_notifications_user FOREIGN KEY (user_account_id) REFERENCES auth.user_accounts(id),
    CONSTRAINT fk_notifications_action FOREIGN KEY (related_action_id) REFERENCES quality.actions(id),
    CONSTRAINT fk_notifications_record FOREIGN KEY (record_id) REFERENCES core.records(id)
);

CREATE TABLE reporting.dashboards (
    id uniqueidentifier NOT NULL CONSTRAINT pk_dashboards PRIMARY KEY DEFAULT newsequentialid(),
    dashboard_key nvarchar(100) NOT NULL,
    name nvarchar(200) NOT NULL,
    purpose nvarchar(1000) NULL,
    primary_permission_key nvarchar(150) NOT NULL,
    faculty_scope_required bit NOT NULL CONSTRAINT df_dashboards_faculty_scope DEFAULT 0,
    config_json nvarchar(max) NULL,
    is_active bit NOT NULL CONSTRAINT df_dashboards_active DEFAULT 1,
    created_at datetimeoffset NOT NULL CONSTRAINT df_dashboards_created DEFAULT sysutcdatetime(),
    updated_at datetimeoffset NULL,
    archived_at datetimeoffset NULL,
    row_version rowversion NOT NULL,
    CONSTRAINT uq_dashboards_key UNIQUE (dashboard_key)
);

CREATE TABLE reporting.saved_report_views (
    id uniqueidentifier NOT NULL CONSTRAINT pk_saved_report_views PRIMARY KEY DEFAULT newsequentialid(),
    dashboard_id uniqueidentifier NOT NULL,
    owner_user_account_id uniqueidentifier NOT NULL,
    name nvarchar(200) NOT NULL,
    filters_json nvarchar(max) NOT NULL,
    is_shared bit NOT NULL CONSTRAINT df_saved_report_views_shared DEFAULT 0,
    created_at datetimeoffset NOT NULL CONSTRAINT df_saved_report_views_created DEFAULT sysutcdatetime(),
    updated_at datetimeoffset NULL,
    archived_at datetimeoffset NULL,
    row_version rowversion NOT NULL,
    CONSTRAINT fk_saved_report_views_dashboard FOREIGN KEY (dashboard_id) REFERENCES reporting.dashboards(id),
    CONSTRAINT fk_saved_report_views_owner FOREIGN KEY (owner_user_account_id) REFERENCES auth.user_accounts(id)
);

CREATE INDEX ix_staff_line_manager ON people.staff(line_manager_staff_id);
CREATE INDEX ix_staff_primary_org_unit ON people.staff(primary_org_unit_id);
CREATE INDEX ix_staff_org_memberships_org ON org.staff_org_memberships(org_unit_id);
CREATE INDEX ix_access_scopes_user_scope ON auth.access_scopes(user_account_id, scope_type);
CREATE INDEX ix_records_module_type ON core.records(module_id, record_type);
CREATE INDEX ix_records_subject_staff ON core.records(subject_staff_id);
CREATE INDEX ix_records_org_unit ON core.records(org_unit_id);
CREATE INDEX ix_form_submissions_record ON forms.form_submissions(record_id);
CREATE INDEX ix_form_responses_submission ON forms.form_responses(form_submission_id);
CREATE INDEX ix_activities_subject_date ON quality.activities(subject_staff_id, activity_date);
CREATE INDEX ix_actions_owner_status ON quality.actions(owner_staff_id, status_lookup_value_id);
CREATE INDEX ix_actions_due_date ON quality.actions(due_date) WHERE completed_date IS NULL AND archived_at IS NULL;
CREATE INDEX ix_cpd_attendance_staff ON cpd.cpd_attendance(staff_id);
CREATE INDEX ix_evidence_staff_date ON evidence.evidence_items(staff_id, evidence_date);
CREATE INDEX ix_audit_logs_entity ON ops.audit_logs(entity_name, entity_id);
CREATE INDEX ix_notifications_user_unread ON ops.notifications(user_account_id, read_at) WHERE archived_at IS NULL;

COMMIT TRANSACTION;
GO
