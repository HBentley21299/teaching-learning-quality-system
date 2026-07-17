SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO

/*
    Organisation governance

    Codes remain stable historical identifiers. Replacements and service-area
    relationships are represented explicitly rather than inferred from text.
*/
IF COL_LENGTH(N'org.org_units', N'legacy_code') IS NULL
    ALTER TABLE org.org_units ADD legacy_code nvarchar(50) NULL;
GO
IF COL_LENGTH(N'org.org_units', N'effective_from') IS NULL
    ALTER TABLE org.org_units ADD effective_from date NULL;
GO
IF COL_LENGTH(N'org.org_units', N'effective_to') IS NULL
    ALTER TABLE org.org_units ADD effective_to date NULL;
GO
IF COL_LENGTH(N'org.org_units', N'updated_by_user_account_id') IS NULL
    ALTER TABLE org.org_units ADD updated_by_user_account_id uniqueidentifier NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'fk_org_units_updated_by')
    ALTER TABLE org.org_units ADD CONSTRAINT fk_org_units_updated_by
        FOREIGN KEY (updated_by_user_account_id) REFERENCES auth.user_accounts(id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'ck_org_units_effective_dates')
    ALTER TABLE org.org_units ADD CONSTRAINT ck_org_units_effective_dates
        CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from);
GO

IF OBJECT_ID(N'org.org_unit_code_aliases', N'U') IS NULL
BEGIN
    CREATE TABLE org.org_unit_code_aliases (
        id uniqueidentifier NOT NULL CONSTRAINT pk_org_unit_code_aliases PRIMARY KEY DEFAULT newsequentialid(),
        legacy_code nvarchar(50) NOT NULL,
        replacement_org_unit_id uniqueidentifier NOT NULL,
        migration_note nvarchar(1000) NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_org_unit_alias_created DEFAULT sysutcdatetime(),
        created_by_user_account_id uniqueidentifier NULL,
        CONSTRAINT uq_org_unit_code_alias UNIQUE (legacy_code),
        CONSTRAINT fk_org_unit_alias_replacement FOREIGN KEY (replacement_org_unit_id) REFERENCES org.org_units(id),
        CONSTRAINT fk_org_unit_alias_created_by FOREIGN KEY (created_by_user_account_id) REFERENCES auth.user_accounts(id)
    );
END;
GO

IF OBJECT_ID(N'org.org_unit_alignments', N'U') IS NULL
BEGIN
    CREATE TABLE org.org_unit_alignments (
        id uniqueidentifier NOT NULL CONSTRAINT pk_org_unit_alignments PRIMARY KEY DEFAULT newsequentialid(),
        service_org_unit_id uniqueidentifier NOT NULL,
        aligned_org_unit_id uniqueidentifier NOT NULL,
        alignment_type nvarchar(50) NOT NULL CONSTRAINT df_org_unit_alignment_type DEFAULT N'service_coverage',
        is_active bit NOT NULL CONSTRAINT df_org_unit_alignment_active DEFAULT 1,
        created_at datetimeoffset NOT NULL CONSTRAINT df_org_unit_alignment_created DEFAULT sysutcdatetime(),
        archived_at datetimeoffset NULL,
        CONSTRAINT uq_org_unit_alignment UNIQUE (service_org_unit_id, aligned_org_unit_id, alignment_type),
        CONSTRAINT fk_org_unit_alignment_service FOREIGN KEY (service_org_unit_id) REFERENCES org.org_units(id),
        CONSTRAINT fk_org_unit_alignment_target FOREIGN KEY (aligned_org_unit_id) REFERENCES org.org_units(id),
        CONSTRAINT ck_org_unit_alignment_not_self CHECK (service_org_unit_id <> aligned_org_unit_id)
    );
END;
GO

IF OBJECT_ID(N'org.migration_review_items', N'U') IS NULL
BEGIN
    CREATE TABLE org.migration_review_items (
        id uniqueidentifier NOT NULL CONSTRAINT pk_org_migration_review PRIMARY KEY DEFAULT newsequentialid(),
        migration_key nvarchar(100) NOT NULL,
        item_type nvarchar(80) NOT NULL,
        source_code nvarchar(100) NULL,
        proposed_code nvarchar(100) NULL,
        staff_id uniqueidentifier NULL,
        details nvarchar(2000) NOT NULL,
        status nvarchar(30) NOT NULL CONSTRAINT df_org_migration_review_status DEFAULT N'open',
        resolution_note nvarchar(2000) NULL,
        resolved_by_user_account_id uniqueidentifier NULL,
        resolved_at datetimeoffset NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_org_migration_review_created DEFAULT sysutcdatetime(),
        CONSTRAINT uq_org_migration_review UNIQUE (migration_key, item_type, source_code, staff_id),
        CONSTRAINT fk_org_migration_review_staff FOREIGN KEY (staff_id) REFERENCES people.staff(id),
        CONSTRAINT fk_org_migration_review_resolved_by FOREIGN KEY (resolved_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT ck_org_migration_review_status CHECK (status IN (N'open', N'resolved', N'ignored'))
    );
END;
GO

IF COL_LENGTH(N'org.staff_org_memberships', N'change_reason') IS NULL
    ALTER TABLE org.staff_org_memberships ADD change_reason nvarchar(1000) NULL;
GO
IF COL_LENGTH(N'org.staff_org_memberships', N'replacement_membership_id') IS NULL
    ALTER TABLE org.staff_org_memberships ADD replacement_membership_id uniqueidentifier NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'fk_staff_org_membership_replacement')
    ALTER TABLE org.staff_org_memberships ADD CONSTRAINT fk_staff_org_membership_replacement
        FOREIGN KEY (replacement_membership_id) REFERENCES org.staff_org_memberships(id);
GO

-- Completed records retain their original organisation wording even if units move later.
IF COL_LENGTH(N'core.records', N'org_unit_code_snapshot') IS NULL
    ALTER TABLE core.records ADD org_unit_code_snapshot nvarchar(50) NULL;
GO
IF COL_LENGTH(N'core.records', N'org_unit_name_snapshot') IS NULL
    ALTER TABLE core.records ADD org_unit_name_snapshot nvarchar(250) NULL;
GO
IF COL_LENGTH(N'core.records', N'parent_org_unit_code_snapshot') IS NULL
    ALTER TABLE core.records ADD parent_org_unit_code_snapshot nvarchar(50) NULL;
GO
IF COL_LENGTH(N'core.records', N'parent_org_unit_name_snapshot') IS NULL
    ALTER TABLE core.records ADD parent_org_unit_name_snapshot nvarchar(250) NULL;
GO

UPDATE record_row
SET org_unit_code_snapshot = unit.code,
    org_unit_name_snapshot = unit.name,
    parent_org_unit_code_snapshot = parent.code,
    parent_org_unit_name_snapshot = parent.name
FROM core.records record_row
JOIN org.org_units unit ON unit.id = record_row.org_unit_id
LEFT JOIN org.org_units parent ON parent.id = unit.parent_org_unit_id
WHERE record_row.org_unit_code_snapshot IS NULL;
GO

DECLARE @today date = CONVERT(date, sysutcdatetime());

-- Canonical faculties. CUFP/CUST and CUDC/CUPA intentionally remain distinct.
INSERT INTO org.org_units (org_unit_type, code, name, description, is_active, effective_from)
SELECT source.org_unit_type, source.code, source.name, source.description, 1, @today
FROM (VALUES
    (N'faculty', N'ALS', N'ALS', N'Additional Learning Support service faculty.'),
    (N'faculty', N'WBL', N'Work-Based Learning', N'Work-Based Learning faculty.'),
    (N'faculty', N'CUENMT', N'English and Mathematics', N'Combined English and Mathematics service faculty.')
) source(org_unit_type, code, name, description)
WHERE NOT EXISTS (
    SELECT 1 FROM org.org_units existing
    WHERE existing.org_unit_type = source.org_unit_type AND existing.code = source.code
);

UPDATE org.org_units
SET is_active = 1, archived_at = NULL, effective_to = NULL, updated_at = sysutcdatetime()
WHERE org_unit_type = N'faculty' AND code IN (N'ALS', N'WBL', N'CUENMT');

DECLARE @als uniqueidentifier = (SELECT id FROM org.org_units WHERE org_unit_type = N'faculty' AND code = N'ALS');
DECLARE @wbl uniqueidentifier = (SELECT id FROM org.org_units WHERE org_unit_type = N'faculty' AND code = N'WBL');
DECLARE @cuenmt uniqueidentifier = (SELECT id FROM org.org_units WHERE org_unit_type = N'faculty' AND code = N'CUENMT');
DECLARE @cues uniqueidentifier = (SELECT id FROM org.org_units WHERE org_unit_type = N'faculty' AND code = N'CUES');

INSERT INTO org.org_units (parent_org_unit_id, org_unit_type, code, name, description, is_active, effective_from)
SELECT source.parent_id, N'team', source.code, source.name, source.description, 1, @today
FROM (VALUES
    (@als, N'ALS-CUCP', N'ALS - CUCP', N'ALS service aligned to CUCP'),
    (@als, N'ALS-CUFPST', N'ALS - CUFPST', N'ALS service jointly aligned to CUFP and CUST'),
    (@als, N'ALS-CUDCPA', N'ALS - CUDCPA', N'ALS service jointly aligned to CUDC and CUPA'),
    (@als, N'ALS-CUCB', N'ALS - CUCB', N'ALS service aligned to CUCB'),
    (@als, N'ALS-CURC', N'ALS - CURC', N'ALS service aligned to CURC'),
    (@als, N'ALS-CUSE', N'ALS - CUSE', N'ALS service aligned to CUSE'),
    (@als, N'ALS-WBL', N'ALS - WBL', N'ALS service aligned to WBL'),
    (@wbl, N'WBL-LB', N'Land Based', N'Work-Based Learning - Land Based'),
    (@wbl, N'WBL-HC', N'Health and Care', N'Work-Based Learning - Health and Care'),
    (@wbl, N'WBL-EY', N'Early Years', N'Work-Based Learning - Early Years'),
    (@wbl, N'WBL-CO', N'Construction Operations', N'Work-Based Learning - Construction Operations'),
    (@wbl, N'WBL-BU', N'Business', N'Work-Based Learning - Business'),
    (@cuenmt, N'CUENMT-CUCP', N'CUENMT - CUCP', N'English and Mathematics aligned to CUCP'),
    (@cuenmt, N'CUENMT-CUFPST', N'CUENMT - CUFPST', N'English and Mathematics jointly aligned to CUFP and CUST'),
    (@cuenmt, N'CUENMT-CUDCPA', N'CUENMT - CUDCPA', N'English and Mathematics jointly aligned to CUDC and CUPA'),
    (@cuenmt, N'CUENMT-CUCB', N'CUENMT - CUCB', N'English and Mathematics aligned to CUCB'),
    (@cuenmt, N'CUENMT-CURC', N'CUENMT - CURC', N'English and Mathematics aligned to CURC'),
    (@cuenmt, N'CUENMT-CUSE', N'CUENMT - CUSE', N'English and Mathematics aligned to CUSE'),
    (@cuenmt, N'CUENMT-WBL', N'CUENMT - WBL', N'English and Mathematics aligned to WBL'),
    (@cuenmt, N'CUENMT-ADULT', N'CUENMT - Adult', N'English and Mathematics adult provision'),
    (@cues, N'CUESBD', N'Bridging', N'ESOL Bridging')
) source(parent_id, code, name, description)
WHERE source.parent_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM org.org_units existing
      WHERE existing.org_unit_type = N'team' AND existing.code = source.code
  );
GO

-- Explicit service-to-faculty relationships. A service team may align to more than one faculty.
INSERT INTO org.org_unit_alignments (service_org_unit_id, aligned_org_unit_id, alignment_type)
SELECT service.id, target.id, N'service_coverage'
FROM (VALUES
    (N'ALS-CUCP', N'CUCP'), (N'ALS-CUFPST', N'CUFP'), (N'ALS-CUFPST', N'CUST'),
    (N'ALS-CUDCPA', N'CUDC'), (N'ALS-CUDCPA', N'CUPA'), (N'ALS-CUCB', N'CUCB'),
    (N'ALS-CURC', N'CURC'), (N'ALS-CUSE', N'CUSE'), (N'ALS-WBL', N'WBL'),
    (N'CUENMT-CUCP', N'CUCP'), (N'CUENMT-CUFPST', N'CUFP'), (N'CUENMT-CUFPST', N'CUST'),
    (N'CUENMT-CUDCPA', N'CUDC'), (N'CUENMT-CUDCPA', N'CUPA'), (N'CUENMT-CUCB', N'CUCB'),
    (N'CUENMT-CURC', N'CURC'), (N'CUENMT-CUSE', N'CUSE'), (N'CUENMT-WBL', N'WBL')
) mapping(service_code, target_code)
JOIN org.org_units service ON service.org_unit_type = N'team' AND service.code = mapping.service_code
JOIN org.org_units target ON target.org_unit_type = N'faculty' AND target.code = mapping.target_code
WHERE NOT EXISTS (
    SELECT 1 FROM org.org_unit_alignments existing
    WHERE existing.service_org_unit_id = service.id
      AND existing.aligned_org_unit_id = target.id
      AND existing.alignment_type = N'service_coverage'
);
GO

-- Old codes resolve to canonical WBL teams without changing historical records.
INSERT INTO org.org_unit_code_aliases (legacy_code, replacement_org_unit_id, migration_note)
SELECT mapping.legacy_code, replacement.id, N'Canonical Work-Based Learning code migration.'
FROM (VALUES
    (N'BDWBLB', N'WBL-LB'), (N'BDWBHC', N'WBL-HC'), (N'BDWBEY', N'WBL-EY'),
    (N'BDWBCO', N'WBL-CO'), (N'BDWBBU', N'WBL-BU'), (N'WBL-CUCB', N'WBL-CO')
) mapping(legacy_code, replacement_code)
JOIN org.org_units replacement ON replacement.org_unit_type = N'team' AND replacement.code = mapping.replacement_code
WHERE NOT EXISTS (SELECT 1 FROM org.org_unit_code_aliases existing WHERE existing.legacy_code = mapping.legacy_code);
GO

-- Move active WBL construction memberships to WBL-CO while retaining the old row for audit/history.
DECLARE @wblCo uniqueidentifier = (SELECT id FROM org.org_units WHERE org_unit_type = N'team' AND code = N'WBL-CO');
DECLARE @migrationAt datetimeoffset = sysutcdatetime();
DECLARE @migrationDate date = CONVERT(date, @migrationAt);

DECLARE @wblMoves TABLE (old_membership_id uniqueidentifier, staff_id uniqueidentifier, was_primary bit);
INSERT INTO @wblMoves
SELECT membership.id, membership.staff_id, membership.is_primary
FROM org.staff_org_memberships membership
JOIN org.org_units old_unit ON old_unit.id = membership.org_unit_id
WHERE old_unit.code IN (N'BDWBCO', N'WBL-CUCB')
  AND membership.archived_at IS NULL
  AND (membership.active_to IS NULL OR membership.active_to >= @migrationDate);

INSERT INTO org.staff_org_memberships (
    staff_id, org_unit_id, membership_type, is_primary, active_from,
    created_at, change_reason
)
SELECT move.staff_id, @wblCo, N'member', move.was_primary, @migrationDate,
       @migrationAt, N'Migrated from legacy WBL construction code.'
FROM @wblMoves move
WHERE @wblCo IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM org.staff_org_memberships existing
      WHERE existing.staff_id = move.staff_id
        AND existing.org_unit_id = @wblCo
        AND existing.archived_at IS NULL
        AND (existing.active_to IS NULL OR existing.active_to >= @migrationDate)
  );

UPDATE old_membership
SET active_to = DATEADD(day, -1, @migrationDate),
    archived_at = @migrationAt,
    change_reason = N'Replaced by canonical WBL-CO membership.',
    replacement_membership_id = replacement.id,
    updated_at = @migrationAt
FROM org.staff_org_memberships old_membership
JOIN @wblMoves move ON move.old_membership_id = old_membership.id
JOIN org.staff_org_memberships replacement ON replacement.staff_id = move.staff_id
    AND replacement.org_unit_id = @wblCo
    AND replacement.archived_at IS NULL;

UPDATE staff
SET primary_org_unit_id = @wblCo, updated_at = @migrationAt
FROM people.staff staff
JOIN @wblMoves move ON move.staff_id = staff.id AND move.was_primary = 1
WHERE @wblCo IS NOT NULL;
GO

-- CUEN/CUMT are superseded by CUENMT. The exact service-area team is not inferable,
-- so affected people are placed at faculty level and surfaced for administrator review.
DECLARE @cuenmtId uniqueidentifier = (SELECT id FROM org.org_units WHERE org_unit_type = N'faculty' AND code = N'CUENMT');
DECLARE @migrationAt datetimeoffset = sysutcdatetime();
DECLARE @migrationDate date = CONVERT(date, @migrationAt);
DECLARE @englishMathsMoves TABLE (old_membership_id uniqueidentifier, staff_id uniqueidentifier, source_code nvarchar(50), was_primary bit);

INSERT INTO @englishMathsMoves
SELECT membership.id, membership.staff_id, old_unit.code, membership.is_primary
FROM org.staff_org_memberships membership
JOIN org.org_units old_unit ON old_unit.id = membership.org_unit_id
WHERE old_unit.code IN (N'CUEN', N'CUMT')
  AND membership.archived_at IS NULL
  AND (membership.active_to IS NULL OR membership.active_to >= @migrationDate);

INSERT INTO org.staff_org_memberships (
    staff_id, org_unit_id, membership_type, is_primary, active_from, created_at, change_reason
)
SELECT move.staff_id, @cuenmtId, N'member', CONVERT(bit, MAX(CONVERT(int, move.was_primary))),
       @migrationDate, @migrationAt, N'Migrated from CUEN/CUMT; service-area team requires review.'
FROM @englishMathsMoves move
WHERE @cuenmtId IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM org.staff_org_memberships existing
      WHERE existing.staff_id = move.staff_id
        AND existing.org_unit_id = @cuenmtId
        AND existing.archived_at IS NULL
  )
GROUP BY move.staff_id;

UPDATE old_membership
SET active_to = DATEADD(day, -1, @migrationDate), archived_at = @migrationAt,
    change_reason = N'Replaced by CUENMT faculty membership pending service-area allocation.',
    replacement_membership_id = replacement.id, updated_at = @migrationAt
FROM org.staff_org_memberships old_membership
JOIN @englishMathsMoves move ON move.old_membership_id = old_membership.id
JOIN org.staff_org_memberships replacement ON replacement.staff_id = move.staff_id
    AND replacement.org_unit_id = @cuenmtId AND replacement.archived_at IS NULL;

UPDATE staff
SET primary_org_unit_id = @cuenmtId, updated_at = @migrationAt
FROM people.staff staff
WHERE staff.id IN (SELECT staff_id FROM @englishMathsMoves WHERE was_primary = 1);

INSERT INTO org.migration_review_items (
    migration_key, item_type, source_code, proposed_code, staff_id, details
)
SELECT N'036_cuenmt', N'staff_service_team', MIN(move.source_code), N'CUENMT', move.staff_id,
       N'Assign this staff member to the correct CUENMT service-area team. CUFP/CUST and CUDC/CUPA remain distinct faculties but are covered by combined CUENMT teams.'
FROM @englishMathsMoves move
WHERE NOT EXISTS (
    SELECT 1 FROM org.migration_review_items existing
    WHERE existing.migration_key = N'036_cuenmt'
      AND existing.item_type = N'staff_service_team'
      AND existing.staff_id = move.staff_id
)
GROUP BY move.staff_id;

UPDATE org.org_units
SET is_active = 0, effective_to = COALESCE(effective_to, @migrationDate), updated_at = @migrationAt
WHERE code IN (N'CUEN', N'CUMT') AND code <> N'CUENMT';
GO

/* Independent permission scope: ordinary membership is descriptive and does
   not itself grant access. Access comes from explicit scope, management graph,
   specific-staff scope, self, or global permission. */
CREATE OR ALTER FUNCTION org.fn_visible_org_units (@user_account_id uniqueidentifier)
RETURNS @visible TABLE (org_unit_id uniqueidentifier NOT NULL PRIMARY KEY)
AS
BEGIN
    DECLARE @now datetimeoffset = sysutcdatetime();
    IF EXISTS (
        SELECT 1
        FROM auth.user_roles ur
        JOIN auth.role_permissions rp ON rp.role_id = ur.role_id
        JOIN auth.permissions p ON p.id = rp.permission_id
        WHERE ur.user_account_id = @user_account_id
          AND ur.active_from <= @now AND (ur.active_to IS NULL OR ur.active_to > @now)
          AND p.permission_key IN (N'staff.manage', N'users.manage', N'reports.view_all')
    ) OR EXISTS (
        SELECT 1 FROM auth.access_scopes scope
        WHERE scope.user_account_id = @user_account_id AND scope.scope_type = N'global'
          AND scope.is_active = 1 AND scope.archived_at IS NULL
    )
    BEGIN
        INSERT INTO @visible SELECT id FROM org.org_units WHERE is_active = 1 AND archived_at IS NULL;
        RETURN;
    END;

    ;WITH base_scope AS (
        SELECT scope.org_unit_id
        FROM auth.access_scopes scope
        WHERE scope.user_account_id = @user_account_id
          AND scope.scope_type = N'assigned_org_units'
          AND scope.org_unit_id IS NOT NULL
          AND scope.is_active = 1 AND scope.archived_at IS NULL
    ), org_tree AS (
        SELECT org_unit_id, 0 AS depth FROM base_scope
        UNION ALL
        SELECT child.id, tree.depth + 1
        FROM org.org_units child
        JOIN org_tree tree ON tree.org_unit_id = child.parent_org_unit_id
        WHERE child.is_active = 1 AND child.archived_at IS NULL AND tree.depth < 32
    )
    INSERT INTO @visible SELECT DISTINCT org_unit_id FROM org_tree OPTION (MAXRECURSION 32);
    RETURN;
END;
GO

-- Messaging permissions are deliberately separate from general administration.
INSERT INTO auth.permissions (permission_key, name, description, category, is_system)
SELECT source.permission_key, source.name, source.description, N'Messaging and exports', 1
FROM (VALUES
    (N'messaging.manage', N'Manage messaging', N'Create, edit, test and audit message templates and rules.'),
    (N'messaging.send', N'Send messages', N'Trigger approved manual messages and retry failed deliveries.'),
    (N'exports.create', N'Create exports', N'Create permission-scoped Excel and Word exports.')
) source(permission_key, name, description)
WHERE NOT EXISTS (SELECT 1 FROM auth.permissions existing WHERE existing.permission_key = source.permission_key);
GO

INSERT INTO auth.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM auth.roles role
JOIN auth.permissions permission ON permission.permission_key IN (N'messaging.manage', N'messaging.send', N'exports.create')
WHERE role.role_key IN (N'super_admin', N'teaching_learning_team')
  AND NOT EXISTS (
      SELECT 1 FROM auth.role_permissions existing
      WHERE existing.role_id = role.id AND existing.permission_id = permission.id
  );

INSERT INTO auth.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM auth.roles role
JOIN auth.permissions permission ON permission.permission_key = N'exports.create'
WHERE role.role_key IN (N'director', N'leader_manager', N'head_of_faculty', N'programme_leader')
  AND NOT EXISTS (
      SELECT 1 FROM auth.role_permissions existing
      WHERE existing.role_id = role.id AND existing.permission_id = permission.id
  );
GO

IF OBJECT_ID(N'ops.message_templates', N'U') IS NULL
BEGIN
    CREATE TABLE ops.message_templates (
        id uniqueidentifier NOT NULL CONSTRAINT pk_message_templates PRIMARY KEY DEFAULT newsequentialid(),
        message_key nvarchar(120) NOT NULL,
        name nvarchar(250) NOT NULL,
        internal_description nvarchar(1000) NULL,
        is_active bit NOT NULL CONSTRAINT df_message_template_active DEFAULT 0,
        current_version_id uniqueidentifier NULL,
        created_by_user_account_id uniqueidentifier NULL,
        updated_by_user_account_id uniqueidentifier NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_message_template_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        archived_at datetimeoffset NULL,
        row_version rowversion NOT NULL,
        CONSTRAINT uq_message_templates_key UNIQUE (message_key),
        CONSTRAINT fk_message_template_created_by FOREIGN KEY (created_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT fk_message_template_updated_by FOREIGN KEY (updated_by_user_account_id) REFERENCES auth.user_accounts(id)
    );
END;
GO

IF OBJECT_ID(N'ops.message_template_versions', N'U') IS NULL
BEGIN
    CREATE TABLE ops.message_template_versions (
        id uniqueidentifier NOT NULL CONSTRAINT pk_message_template_versions PRIMARY KEY DEFAULT newsequentialid(),
        message_template_id uniqueidentifier NOT NULL,
        version_number int NOT NULL,
        subject_template nvarchar(500) NOT NULL,
        plain_text_template nvarchar(max) NOT NULL,
        html_template nvarchar(max) NULL,
        recipient_config_json nvarchar(max) NOT NULL CONSTRAINT df_message_version_recipients DEFAULT N'{}',
        cc_config_json nvarchar(max) NULL,
        bcc_config_json nvarchar(max) NULL,
        created_by_user_account_id uniqueidentifier NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_message_version_created DEFAULT sysutcdatetime(),
        CONSTRAINT uq_message_template_version UNIQUE (message_template_id, version_number),
        CONSTRAINT fk_message_version_template FOREIGN KEY (message_template_id) REFERENCES ops.message_templates(id),
        CONSTRAINT fk_message_version_created_by FOREIGN KEY (created_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT ck_message_version_recipient_json CHECK (ISJSON(recipient_config_json) = 1),
        CONSTRAINT ck_message_version_cc_json CHECK (cc_config_json IS NULL OR ISJSON(cc_config_json) = 1),
        CONSTRAINT ck_message_version_bcc_json CHECK (bcc_config_json IS NULL OR ISJSON(bcc_config_json) = 1)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'fk_message_template_current_version')
    ALTER TABLE ops.message_templates ADD CONSTRAINT fk_message_template_current_version
        FOREIGN KEY (current_version_id) REFERENCES ops.message_template_versions(id);
GO

IF OBJECT_ID(N'ops.message_rules', N'U') IS NULL
BEGIN
    CREATE TABLE ops.message_rules (
        id uniqueidentifier NOT NULL CONSTRAINT pk_message_rules PRIMARY KEY DEFAULT newsequentialid(),
        message_template_id uniqueidentifier NOT NULL,
        event_type nvarchar(120) NOT NULL,
        condition_config_json nvarchar(max) NOT NULL CONSTRAINT df_message_rule_conditions DEFAULT N'{}',
        schedule_config_json nvarchar(max) NOT NULL CONSTRAINT df_message_rule_schedule DEFAULT N'{"mode":"immediate"}',
        is_active bit NOT NULL CONSTRAINT df_message_rule_active DEFAULT 1,
        created_at datetimeoffset NOT NULL CONSTRAINT df_message_rule_created DEFAULT sysutcdatetime(),
        updated_at datetimeoffset NULL,
        archived_at datetimeoffset NULL,
        CONSTRAINT fk_message_rule_template FOREIGN KEY (message_template_id) REFERENCES ops.message_templates(id),
        CONSTRAINT ck_message_rule_conditions_json CHECK (ISJSON(condition_config_json) = 1),
        CONSTRAINT ck_message_rule_schedule_json CHECK (ISJSON(schedule_config_json) = 1)
    );
END;
GO

IF OBJECT_ID(N'ops.message_attachments', N'U') IS NULL
BEGIN
    CREATE TABLE ops.message_attachments (
        id uniqueidentifier NOT NULL CONSTRAINT pk_message_attachments PRIMARY KEY DEFAULT newsequentialid(),
        message_template_id uniqueidentifier NOT NULL,
        attachment_type nvarchar(50) NOT NULL,
        file_asset_id uniqueidentifier NULL,
        export_module_key nvarchar(100) NULL,
        display_name nvarchar(250) NOT NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_message_attachment_created DEFAULT sysutcdatetime(),
        archived_at datetimeoffset NULL,
        CONSTRAINT fk_message_attachment_template FOREIGN KEY (message_template_id) REFERENCES ops.message_templates(id),
        CONSTRAINT fk_message_attachment_file FOREIGN KEY (file_asset_id) REFERENCES evidence.file_assets(id),
        CONSTRAINT ck_message_attachment_type CHECK (attachment_type IN (N'static', N'record', N'excel_export', N'word_report'))
    );
END;
GO

IF OBJECT_ID(N'ops.message_outbox', N'U') IS NULL
BEGIN
    CREATE TABLE ops.message_outbox (
        id uniqueidentifier NOT NULL CONSTRAINT pk_message_outbox PRIMARY KEY DEFAULT newsequentialid(),
        template_version_id uniqueidentifier NOT NULL,
        message_rule_id uniqueidentifier NULL,
        source_record_id uniqueidentifier NULL,
        triggering_event nvarchar(120) NOT NULL,
        idempotency_key nvarchar(250) NOT NULL,
        parameter_values_json nvarchar(max) NOT NULL,
        status nvarchar(30) NOT NULL CONSTRAINT df_message_outbox_status DEFAULT N'pending',
        priority int NOT NULL CONSTRAINT df_message_outbox_priority DEFAULT 100,
        attempt_count int NOT NULL CONSTRAINT df_message_outbox_attempt_count DEFAULT 0,
        max_attempts int NOT NULL CONSTRAINT df_message_outbox_max_attempts DEFAULT 5,
        queued_at datetimeoffset NOT NULL CONSTRAINT df_message_outbox_queued DEFAULT sysutcdatetime(),
        available_at datetimeoffset NOT NULL CONSTRAINT df_message_outbox_available DEFAULT sysutcdatetime(),
        processing_at datetimeoffset NULL,
        locked_until datetimeoffset NULL,
        delivered_at datetimeoffset NULL,
        failed_at datetimeoffset NULL,
        cancelled_at datetimeoffset NULL,
        last_error nvarchar(2000) NULL,
        provider_response_id nvarchar(500) NULL,
        requested_by_user_account_id uniqueidentifier NULL,
        CONSTRAINT uq_message_outbox_idempotency UNIQUE (idempotency_key),
        CONSTRAINT fk_message_outbox_version FOREIGN KEY (template_version_id) REFERENCES ops.message_template_versions(id),
        CONSTRAINT fk_message_outbox_rule FOREIGN KEY (message_rule_id) REFERENCES ops.message_rules(id),
        CONSTRAINT fk_message_outbox_record FOREIGN KEY (source_record_id) REFERENCES core.records(id),
        CONSTRAINT fk_message_outbox_requested_by FOREIGN KEY (requested_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT ck_message_outbox_parameters_json CHECK (ISJSON(parameter_values_json) = 1),
        CONSTRAINT ck_message_outbox_status CHECK (status IN (N'pending', N'processing', N'sent', N'failed', N'retrying', N'cancelled'))
    );
END;
GO

IF OBJECT_ID(N'ops.message_outbox_recipients', N'U') IS NULL
BEGIN
    CREATE TABLE ops.message_outbox_recipients (
        id uniqueidentifier NOT NULL CONSTRAINT pk_message_outbox_recipients PRIMARY KEY DEFAULT newsequentialid(),
        outbox_id uniqueidentifier NOT NULL,
        recipient_type nvarchar(10) NOT NULL,
        email_address nvarchar(320) NOT NULL,
        display_name nvarchar(250) NULL,
        staff_id uniqueidentifier NULL,
        CONSTRAINT fk_message_recipient_outbox FOREIGN KEY (outbox_id) REFERENCES ops.message_outbox(id),
        CONSTRAINT fk_message_recipient_staff FOREIGN KEY (staff_id) REFERENCES people.staff(id),
        CONSTRAINT ck_message_recipient_type CHECK (recipient_type IN (N'to', N'cc', N'bcc'))
    );
END;
GO

IF OBJECT_ID(N'ops.message_delivery_attempts', N'U') IS NULL
BEGIN
    CREATE TABLE ops.message_delivery_attempts (
        id uniqueidentifier NOT NULL CONSTRAINT pk_message_delivery_attempts PRIMARY KEY DEFAULT newsequentialid(),
        outbox_id uniqueidentifier NOT NULL,
        attempt_number int NOT NULL,
        provider_type nvarchar(50) NOT NULL,
        started_at datetimeoffset NOT NULL,
        completed_at datetimeoffset NULL,
        was_successful bit NOT NULL CONSTRAINT df_message_attempt_success DEFAULT 0,
        provider_response_id nvarchar(500) NULL,
        error_summary nvarchar(2000) NULL,
        CONSTRAINT uq_message_delivery_attempt UNIQUE (outbox_id, attempt_number),
        CONSTRAINT fk_message_attempt_outbox FOREIGN KEY (outbox_id) REFERENCES ops.message_outbox(id)
    );
END;
GO

IF OBJECT_ID(N'ops.export_jobs', N'U') IS NULL
BEGIN
    CREATE TABLE ops.export_jobs (
        id uniqueidentifier NOT NULL CONSTRAINT pk_export_jobs PRIMARY KEY DEFAULT newsequentialid(),
        requested_by_user_account_id uniqueidentifier NOT NULL,
        export_format nvarchar(10) NOT NULL,
        module_key nvarchar(100) NOT NULL,
        source_record_id uniqueidentifier NULL,
        filter_json nvarchar(max) NOT NULL CONSTRAINT df_export_job_filter DEFAULT N'{}',
        request_fingerprint nvarchar(128) NOT NULL,
        status nvarchar(30) NOT NULL CONSTRAINT df_export_job_status DEFAULT N'queued',
        row_count int NULL,
        file_name nvarchar(260) NULL,
        storage_path nvarchar(1000) NULL,
        content_type nvarchar(150) NULL,
        error_summary nvarchar(2000) NULL,
        queued_at datetimeoffset NOT NULL CONSTRAINT df_export_job_queued DEFAULT sysutcdatetime(),
        processing_at datetimeoffset NULL,
        completed_at datetimeoffset NULL,
        expires_at datetimeoffset NULL,
        CONSTRAINT fk_export_job_user FOREIGN KEY (requested_by_user_account_id) REFERENCES auth.user_accounts(id),
        CONSTRAINT fk_export_job_record FOREIGN KEY (source_record_id) REFERENCES core.records(id),
        CONSTRAINT ck_export_job_format CHECK (export_format IN (N'xlsx', N'docx')),
        CONSTRAINT ck_export_job_status CHECK (status IN (N'queued', N'processing', N'completed', N'failed', N'cancelled')),
        CONSTRAINT ck_export_job_filter_json CHECK (ISJSON(filter_json) = 1)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'ops.message_outbox') AND name = N'ix_message_outbox_worker')
    CREATE INDEX ix_message_outbox_worker ON ops.message_outbox(status, available_at, priority, queued_at)
        INCLUDE (attempt_count, max_attempts, locked_until);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'ops.export_jobs') AND name = N'ix_export_jobs_worker')
    CREATE INDEX ix_export_jobs_worker ON ops.export_jobs(status, queued_at)
        INCLUDE (module_key, export_format, requested_by_user_account_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'org.org_unit_alignments') AND name = N'ix_org_unit_alignments_target')
    CREATE INDEX ix_org_unit_alignments_target ON org.org_unit_alignments(aligned_org_unit_id, is_active)
        INCLUDE (service_org_unit_id, alignment_type);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'org.staff_org_memberships') AND name = N'ix_staff_org_memberships_active_unit')
    CREATE INDEX ix_staff_org_memberships_active_unit ON org.staff_org_memberships(org_unit_id, archived_at, active_to)
        INCLUDE (staff_id, is_primary, membership_type);
GO
