using System.Text;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore(IConfiguration configuration)
{
    private readonly string _connectionString = configuration.GetConnectionString("TlqsDatabase")
        ?? throw new InvalidOperationException("Connection string 'TlqsDatabase' is not configured.");

    public async Task<bool> CanConnectAsync(CancellationToken cancellationToken)
    {
        try
        {
            await using var connection = await OpenConnectionAsync(cancellationToken);
            await using var command = new SqlCommand("SELECT 1", connection);
            var result = await command.ExecuteScalarAsync(cancellationToken);
            return Convert.ToInt32(result) == 1;
        }
        catch (SqlException)
        {
            return false;
        }
        catch (InvalidOperationException)
        {
            return false;
        }
    }

    public async Task<CurrentUser> GetCurrentUserAsync(
        string? email,
        string? providerSubjectId,
        Guid? tenantId,
        CancellationToken cancellationToken)
    {
        var normalizedEmail = email?.Trim();
        var normalizedSubject = providerSubjectId?.Trim();
        if (string.IsNullOrWhiteSpace(normalizedEmail)
            && (string.IsNullOrWhiteSpace(normalizedSubject) || !tenantId.HasValue))
        {
            return CurrentUser.Empty("unknown@local");
        }

        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var command = new SqlCommand(
            """
            DECLARE @identityAccountId uniqueidentifier = (
                SELECT TOP (1) ai.user_account_id
                FROM auth.auth_identities ai
                WHERE ai.provider = 'entra'
                  AND ai.tenant_id = @tenantId
                  AND ai.provider_subject_id = @providerSubjectId
            );

            SELECT TOP (1)
                ua.id,
                s.id,
                s.display_name,
                s.email,
                @identityAccountId
            FROM auth.user_accounts ua
            JOIN people.staff s ON s.id = ua.staff_id
            WHERE (
                    (@identityAccountId IS NOT NULL AND ua.id = @identityAccountId)
                    OR (@identityAccountId IS NULL AND s.email = @email)
                )
              AND ua.is_disabled = 0
              AND ua.account_status = 'active'
              AND ua.archived_at IS NULL
              AND s.account_status = 'active'
              AND s.archived_at IS NULL
            ORDER BY CASE WHEN ua.id = @identityAccountId THEN 0 ELSE 1 END, ua.created_at DESC;
            """,
            connection);

        command.Parameters.AddWithValue("@email", ToDbValue(normalizedEmail));
        command.Parameters.AddWithValue("@providerSubjectId", ToDbValue(normalizedSubject));
        command.Parameters.AddWithValue("@tenantId", ToDbValue(tenantId));

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return CurrentUser.Empty(normalizedEmail ?? "unknown@local");
        }

        var userAccountId = reader.GetGuid(0);
        var staffId = reader.GetGuid(1);
        var displayName = reader.GetString(2);
        var userEmail = reader.GetString(3);
        var identityAccountId = GetGuidOrNull(reader, 4);

        await reader.DisposeAsync();

        if (!string.IsNullOrWhiteSpace(normalizedSubject) && tenantId.HasValue)
        {
            await using var identityCommand = new SqlCommand(
                """
                IF @identityAccountId IS NULL
                BEGIN
                    INSERT INTO auth.auth_identities (
                        user_account_id,
                        provider,
                        tenant_id,
                        provider_subject_id,
                        email_claim
                    )
                    VALUES (
                        @userAccountId,
                        'entra',
                        @tenantId,
                        @providerSubjectId,
                        @emailClaim
                    );
                END
                ELSE
                BEGIN
                    UPDATE auth.auth_identities
                    SET email_claim = @emailClaim,
                        updated_at = sysutcdatetime()
                    WHERE provider = 'entra'
                      AND tenant_id = @tenantId
                      AND provider_subject_id = @providerSubjectId;
                END;

                UPDATE auth.user_accounts
                SET last_login_at = sysutcdatetime(),
                    updated_at = sysutcdatetime()
                WHERE id = @userAccountId;
                """,
                connection);
            identityCommand.Parameters.AddWithValue("@identityAccountId", ToDbValue(identityAccountId));
            identityCommand.Parameters.AddWithValue("@userAccountId", userAccountId);
            identityCommand.Parameters.AddWithValue("@tenantId", tenantId.Value);
            identityCommand.Parameters.AddWithValue("@providerSubjectId", normalizedSubject);
            identityCommand.Parameters.AddWithValue("@emailClaim", normalizedEmail ?? userEmail);
            await identityCommand.ExecuteNonQueryAsync(cancellationToken);
        }

        var permissions = await GetPermissionKeysAsync(connection, userAccountId, cancellationToken);
        var scopes = await GetAccessScopesAsync(connection, userAccountId, cancellationToken);

        return new CurrentUser(userAccountId, staffId, displayName, userEmail, permissions, scopes);
    }

    public Task<IReadOnlyList<ModuleSummary>> GetModulesAsync(CancellationToken cancellationToken) =>
        QueryAsync(
            """
            SELECT id, module_key, name, description, route_prefix, display_order, is_enabled
            FROM core.modules
            WHERE archived_at IS NULL
            ORDER BY display_order, name;
            """,
            reader => new ModuleSummary(
                reader.GetGuid(0),
                reader.GetString(1),
                reader.GetString(2),
                GetStringOrNull(reader, 3),
                reader.GetString(4),
                reader.GetInt32(5),
                reader.GetBoolean(6)),
            cancellationToken);

    public async Task<IReadOnlyList<LookupSummary>> GetLookupsAsync(CancellationToken cancellationToken)
    {
        var rows = await QueryAsync(
            """
            SELECT lt.lookup_key, lt.name, lv.display_name
            FROM core.lookup_types lt
            LEFT JOIN core.lookup_values lv ON lv.lookup_type_id = lt.id
                AND lv.archived_at IS NULL
                AND lv.is_active = 1
            WHERE lt.archived_at IS NULL
              AND lt.is_active = 1
            ORDER BY lt.name, lv.display_order, lv.display_name;
            """,
            reader => new LookupRow(reader.GetString(0), reader.GetString(1), GetStringOrNull(reader, 2)),
            cancellationToken);

        return rows
            .GroupBy(row => new { row.LookupKey, row.Name })
            .Select(group => new LookupSummary(
                group.Key.LookupKey,
                group.Key.Name,
                group.Select(row => row.Value).Where(value => value is not null).Cast<string>().ToArray()))
            .ToArray();
    }

    public Task<IReadOnlyList<LookupValueSummary>> GetLookupValuesAsync(
        string lookupKey,
        CancellationToken cancellationToken) =>
        QueryAsync(
            """
            SELECT value.id, value.value_key, value.display_name, value.display_order
            FROM core.lookup_types type
            JOIN core.lookup_values value ON value.lookup_type_id = type.id
            WHERE type.lookup_key = @lookupKey
              AND type.archived_at IS NULL
              AND type.is_active = 1
              AND value.archived_at IS NULL
              AND value.is_active = 1
            ORDER BY value.display_order, value.display_name;
            """,
            command => command.Parameters.AddWithValue("@lookupKey", lookupKey.Trim()),
            reader => new LookupValueSummary(
                reader.GetGuid(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.GetInt32(3)),
            cancellationToken);

    public async Task<LookupValueSummary> SaveLookupValueAsync(
        string lookupKey,
        string displayName,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        lookupKey = lookupKey.Trim();
        displayName = displayName.Trim();
        if (string.IsNullOrWhiteSpace(displayName))
        {
            throw new WorkflowValidationException("Enter a lookup value before adding it.");
        }
        if (displayName.Length > 200)
        {
            throw new WorkflowValidationException("Lookup values cannot exceed 200 characters.");
        }

        var valueKey = Slugify(displayName);
        if (valueKey.Length > 100)
        {
            valueKey = valueKey[..100].TrimEnd('_');
        }

        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        Guid? lookupTypeId;
        await using (var typeCommand = new SqlCommand(
            """
            SELECT id
            FROM core.lookup_types
            WHERE lookup_key = @lookupKey
              AND archived_at IS NULL
              AND is_active = 1;
            """,
            connection,
            (SqlTransaction)transaction))
        {
            typeCommand.Parameters.AddWithValue("@lookupKey", lookupKey);
            lookupTypeId = (Guid?)(await typeCommand.ExecuteScalarAsync(cancellationToken));
        }

        if (!lookupTypeId.HasValue)
        {
            throw new WorkflowValidationException($"Lookup '{lookupKey}' was not found.");
        }

        LookupValueSummary saved;
        await using (var command = new SqlCommand(
            """
            DECLARE @valueId uniqueidentifier = (
                SELECT TOP (1) id
                FROM core.lookup_values
                WHERE lookup_type_id = @lookupTypeId
                  AND (value_key = @valueKey OR display_name = @displayName)
                ORDER BY CASE WHEN display_name = @displayName THEN 0 ELSE 1 END
            );

            IF @valueId IS NULL
            BEGIN
                SET @valueId = newid();
                INSERT INTO core.lookup_values (
                    id, lookup_type_id, value_key, display_name, display_order
                )
                SELECT
                    @valueId,
                    @lookupTypeId,
                    @valueKey,
                    @displayName,
                    COALESCE(MAX(display_order), 0) + 10
                FROM core.lookup_values
                WHERE lookup_type_id = @lookupTypeId;
            END
            ELSE
            BEGIN
                UPDATE core.lookup_values
                SET display_name = @displayName,
                    is_active = 1,
                    archived_at = NULL,
                    updated_at = sysutcdatetime()
                WHERE id = @valueId;
            END;

            SELECT id, value_key, display_name, display_order
            FROM core.lookup_values
            WHERE id = @valueId;
            """,
            connection,
            (SqlTransaction)transaction))
        {
            command.Parameters.AddWithValue("@lookupTypeId", lookupTypeId.Value);
            command.Parameters.AddWithValue("@valueKey", valueKey);
            command.Parameters.AddWithValue("@displayName", displayName);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            await reader.ReadAsync(cancellationToken);
            saved = new LookupValueSummary(
                reader.GetGuid(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.GetInt32(3));
        }

        await WriteAuditAsync(
            connection,
            transaction,
            currentUser.UserAccountId,
            null,
            "lookup_value",
            saved.Id,
            "lookup.value_saved",
            $"{currentUser.DisplayName} saved '{saved.DisplayName}' in {lookupKey}.",
            null,
            JsonSerializer.Serialize(saved),
            cancellationToken);

        await transaction.CommitAsync(cancellationToken);
        return saved;
    }

    public async Task<bool> ArchiveLookupValueAsync(
        string lookupKey,
        Guid id,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        var activeCount = 0;
        var targetExists = false;
        string? targetDisplayName = null;
        await using (var command = new SqlCommand(
            """
            SELECT
                COUNT(*) AS active_count,
                COUNT(CASE WHEN value.id = @id THEN 1 END) AS target_count,
                MAX(CASE WHEN value.id = @id THEN value.display_name END) AS target_display_name
            FROM core.lookup_types type
            JOIN core.lookup_values value WITH (UPDLOCK, HOLDLOCK) ON value.lookup_type_id = type.id
            WHERE type.lookup_key = @lookupKey
              AND type.archived_at IS NULL
              AND value.archived_at IS NULL
              AND value.is_active = 1;
            """,
            connection,
            (SqlTransaction)transaction))
        {
            command.Parameters.AddWithValue("@lookupKey", lookupKey.Trim());
            command.Parameters.AddWithValue("@id", id);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            if (await reader.ReadAsync(cancellationToken))
            {
                activeCount = reader.GetInt32(0);
                targetExists = reader.GetInt32(1) > 0;
                targetDisplayName = GetStringOrNull(reader, 2);
            }
        }

        if (!targetExists)
        {
            await transaction.RollbackAsync(cancellationToken);
            return false;
        }
        if (activeCount <= 1)
        {
            throw new WorkflowValidationException("At least one active value must remain in the lookup.");
        }

        await using (var command = new SqlCommand(
            """
            UPDATE value
            SET is_active = 0,
                archived_at = sysutcdatetime(),
                updated_at = sysutcdatetime()
            FROM core.lookup_values value
            JOIN core.lookup_types type ON type.id = value.lookup_type_id
            WHERE value.id = @id
              AND type.lookup_key = @lookupKey
              AND value.archived_at IS NULL;
            """,
            connection,
            (SqlTransaction)transaction))
        {
            command.Parameters.AddWithValue("@lookupKey", lookupKey.Trim());
            command.Parameters.AddWithValue("@id", id);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        await WriteAuditAsync(
            connection,
            transaction,
            currentUser.UserAccountId,
            null,
            "lookup_value",
            id,
            "lookup.value_archived",
            $"{currentUser.DisplayName} removed '{targetDisplayName}' from {lookupKey}.",
            JsonSerializer.Serialize(new { displayName = targetDisplayName }),
            null,
            cancellationToken);

        await transaction.CommitAsync(cancellationToken);
        return true;
    }

    public Task<IReadOnlyList<OrgUnitSummary>> GetOrgUnitsAsync(CancellationToken cancellationToken) =>
        QueryAsync(
            """
            SELECT id, parent_org_unit_id, org_unit_type, code, name, is_active
            FROM org.org_units
            WHERE archived_at IS NULL
            ORDER BY org_unit_type, name;
            """,
            reader => new OrgUnitSummary(
                reader.GetGuid(0),
                GetGuidOrNull(reader, 1),
                reader.GetString(2),
                reader.GetString(3),
                reader.GetString(4),
                reader.GetBoolean(5)),
            cancellationToken);

    public Task<IReadOnlyList<RoomSummary>> GetRoomsAsync(CancellationToken cancellationToken) =>
        QueryAsync(
            """
            SELECT id, room_code, building_name
            FROM quality.rooms
            WHERE archived_at IS NULL
              AND is_active = 1
            ORDER BY room_code;
            """,
            reader => new RoomSummary(reader.GetGuid(0), reader.GetString(1), reader.GetString(2)),
            cancellationToken);

    public Task<IReadOnlyList<CourseSummary>> GetCoursesAsync(
        Guid orgUnitId,
        CurrentUser currentUser,
        CancellationToken cancellationToken) =>
        QueryAsync(
            """
            WITH scoped_org_units AS (
                SELECT org_unit_id
                FROM auth.access_scopes
                WHERE user_account_id = @currentUserAccountId
                  AND scope_type = 'assigned_org_units'
                  AND org_unit_id IS NOT NULL
                  AND is_active = 1
                  AND archived_at IS NULL
                UNION ALL
                SELECT child.id
                FROM org.org_units child
                JOIN scoped_org_units parent_scope ON parent_scope.org_unit_id = child.parent_org_unit_id
                WHERE child.archived_at IS NULL
            )
            SELECT course.id, course.course_code, course.course_name, course.org_unit_id, course.academic_year
            FROM curriculum.courses course
            JOIN org.org_units team ON team.id = course.org_unit_id
            LEFT JOIN people.staff current_staff ON current_staff.id = @currentStaffId
            WHERE course.org_unit_id = @orgUnitId
              AND course.is_active = 1
              AND course.archived_at IS NULL
              AND team.archived_at IS NULL
              AND (
                    @canViewAll = 1
                    OR EXISTS (SELECT 1 FROM scoped_org_units scoped WHERE scoped.org_unit_id = course.org_unit_id)
                    OR current_staff.primary_org_unit_id = course.org_unit_id
              )
            ORDER BY course.course_code, course.course_name;
            """,
            command =>
            {
                command.Parameters.AddWithValue("@orgUnitId", orgUnitId);
                command.Parameters.AddWithValue("@currentUserAccountId", ToDbValue(currentUser.UserAccountId));
                command.Parameters.AddWithValue("@currentStaffId", ToDbValue(currentUser.StaffId));
                command.Parameters.AddWithValue("@canViewAll", CanViewAllRecords(currentUser));
            },
            reader => new CourseSummary(
                reader.GetGuid(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.GetGuid(3),
                GetStringOrNull(reader, 4)),
            cancellationToken);

    public async Task<FormDefinitionSummary?> GetWorkScrutinyTemplateAsync(
        Guid orgUnitId,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        var keys = await QueryAsync(
            """
            WITH scoped_org_units AS (
                SELECT org_unit_id
                FROM auth.access_scopes
                WHERE user_account_id = @currentUserAccountId
                  AND scope_type = 'assigned_org_units'
                  AND org_unit_id IS NOT NULL
                  AND is_active = 1
                  AND archived_at IS NULL
                UNION ALL
                SELECT child.id
                FROM org.org_units child
                JOIN scoped_org_units parent_scope ON parent_scope.org_unit_id = child.parent_org_unit_id
                WHERE child.archived_at IS NULL
            )
            SELECT TOP (1) template.template_key
            FROM forms.form_templates template
            JOIN core.modules module ON module.id = template.module_id
            JOIN forms.form_template_org_units assignment ON assignment.form_template_id = template.id
                AND assignment.archived_at IS NULL
            JOIN forms.form_template_versions version ON version.form_template_id = template.id
                AND version.archived_at IS NULL
                AND version.is_published = 1
            LEFT JOIN people.staff current_staff ON current_staff.id = @currentStaffId
            WHERE module.module_key = 'work_scrutiny'
              AND template.archived_at IS NULL
              AND template.is_active = 1
              AND assignment.org_unit_id = @orgUnitId
              AND (
                    @canViewAll = 1
                    OR EXISTS (SELECT 1 FROM scoped_org_units scoped WHERE scoped.org_unit_id = assignment.org_unit_id)
                    OR current_staff.primary_org_unit_id = assignment.org_unit_id
              )
            ORDER BY version.active_from DESC, version.created_at DESC;
            """,
            command =>
            {
                command.Parameters.AddWithValue("@orgUnitId", orgUnitId);
                command.Parameters.AddWithValue("@currentUserAccountId", ToDbValue(currentUser.UserAccountId));
                command.Parameters.AddWithValue("@currentStaffId", ToDbValue(currentUser.StaffId));
                command.Parameters.AddWithValue("@canViewAll", CanViewAllRecords(currentUser));
            },
            reader => reader.GetString(0),
            cancellationToken);

        return keys.Count == 0 ? null : await GetFormDefinitionAsync(keys[0], cancellationToken);
    }

    public Task<IReadOnlyList<StaffSummary>> GetStaffAsync(CurrentUser currentUser, CancellationToken cancellationToken)
    {
        var canViewAll = CanViewAllStaff(currentUser);
        return QueryAsync(
            """
            WITH scoped_org_units AS (
                SELECT org_unit_id
                FROM auth.access_scopes
                WHERE user_account_id = @currentUserAccountId
                  AND scope_type = 'assigned_org_units'
                  AND org_unit_id IS NOT NULL
                  AND is_active = 1
                  AND archived_at IS NULL
                UNION ALL
                SELECT child.id
                FROM org.org_units child
                JOIN scoped_org_units parent_scope ON parent_scope.org_unit_id = child.parent_org_unit_id
                WHERE child.archived_at IS NULL
            )
            SELECT
                s.id,
                s.external_id,
                s.display_name,
                s.email,
                s.job_title,
                s.primary_org_unit_id,
                s.account_status,
                memberships.org_unit_ids
            FROM people.staff s
            OUTER APPLY (
                SELECT STRING_AGG(CONVERT(nvarchar(36), membership.org_unit_id), '|') AS org_unit_ids
                FROM (
                    SELECT DISTINCT som.org_unit_id
                    FROM org.staff_org_memberships som
                    WHERE som.staff_id = s.id
                      AND som.archived_at IS NULL
                ) membership
            ) memberships
            WHERE s.archived_at IS NULL
              AND (
                    @canViewAll = 1
                    OR s.id = @currentStaffId
                    OR s.line_manager_staff_id = @currentStaffId
                    OR EXISTS (SELECT 1 FROM scoped_org_units sou WHERE sou.org_unit_id = s.primary_org_unit_id)
                    OR EXISTS (
                        SELECT 1
                        FROM org.staff_org_memberships som
                        JOIN scoped_org_units sou ON sou.org_unit_id = som.org_unit_id
                        WHERE som.staff_id = s.id
                          AND som.archived_at IS NULL
                    )
              )
            ORDER BY s.display_name;
            """,
            command =>
            {
                command.Parameters.AddWithValue("@canViewAll", canViewAll);
                command.Parameters.AddWithValue("@currentUserAccountId", ToDbValue(currentUser.UserAccountId));
                command.Parameters.AddWithValue("@currentStaffId", ToDbValue(currentUser.StaffId));
            },
            reader => new StaffSummary(
                reader.GetGuid(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.GetString(3),
                GetStringOrNull(reader, 4),
                GetGuidOrNull(reader, 5),
                reader.GetString(6),
                ParseGuidValues(GetStringOrNull(reader, 7))),
            cancellationToken);
    }

    public Task<IReadOnlyList<RoleSummary>> GetRolesAsync(CancellationToken cancellationToken) =>
        QueryAsync(
            """
            SELECT role_key, name
            FROM auth.roles
            WHERE archived_at IS NULL
              AND is_active = 1
            ORDER BY name;
            """,
            reader => new RoleSummary(reader.GetString(0), reader.GetString(1)),
            cancellationToken);

    public Task<IReadOnlyList<PermissionSummary>> GetPermissionsAsync(CancellationToken cancellationToken) =>
        QueryAsync(
            """
            SELECT permission_key, name, category
            FROM auth.permissions
            WHERE archived_at IS NULL
            ORDER BY category, permission_key;
            """,
            reader => new PermissionSummary(reader.GetString(0), reader.GetString(1), reader.GetString(2)),
            cancellationToken);

    public async Task<IReadOnlyList<FormTemplateSummary>> GetFormTemplatesAsync(CancellationToken cancellationToken)
    {
        var rows = await QueryAsync(
            """
            SELECT
                ft.id,
                m.id,
                m.module_key,
                m.name,
                ft.template_key,
                ft.name,
                latest_version.version_label,
                CASE
                    WHEN ft.archived_at IS NOT NULL THEN 'Archived'
                    WHEN latest_version.is_published = 1 THEN 'Published'
                    ELSE 'Draft'
                END AS status,
                CASE WHEN m.module_key = 'work_scrutiny' AND ft.archived_at IS NULL THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS is_editable,
                assigned_org.id,
                assigned_org.code,
                assigned_org.name,
                COUNT(DISTINCT fs.id) AS submission_count
            FROM forms.form_templates ft
            JOIN core.modules m ON m.id = ft.module_id
            OUTER APPLY (
                SELECT TOP (1) id, version_label, is_published
                FROM forms.form_template_versions ftv
                WHERE ftv.form_template_id = ft.id
                  AND ftv.archived_at IS NULL
                ORDER BY ftv.is_published DESC, ftv.active_from DESC, ftv.created_at DESC
            ) latest_version
            LEFT JOIN forms.form_template_versions all_versions ON all_versions.form_template_id = ft.id
                AND all_versions.archived_at IS NULL
            LEFT JOIN forms.form_submissions fs ON fs.form_template_version_id = all_versions.id
                AND fs.archived_at IS NULL
            LEFT JOIN forms.form_template_org_units ftou ON ftou.form_template_id = ft.id
                AND ftou.archived_at IS NULL
            LEFT JOIN org.org_units assigned_org ON assigned_org.id = ftou.org_unit_id
            WHERE m.module_key IN ('learning_walks', 'work_scrutiny', 'cpd')
            GROUP BY
                ft.id,
                m.id,
                m.module_key,
                m.name,
                m.display_order,
                ft.template_key,
                ft.name,
                latest_version.version_label,
                latest_version.is_published,
                ft.archived_at,
                assigned_org.id,
                assigned_org.code,
                assigned_org.name
            ORDER BY m.display_order, ft.name, assigned_org.name;
            """,
            reader => new FormTemplateRow(
                reader.GetGuid(0),
                reader.GetGuid(1),
                reader.GetString(2),
                reader.GetString(3),
                reader.GetString(4),
                reader.GetString(5),
                GetStringOrNull(reader, 6),
                reader.GetString(7),
                reader.GetBoolean(8),
                GetGuidOrNull(reader, 9),
                GetStringOrNull(reader, 10),
                GetStringOrNull(reader, 11),
                Convert.ToInt32(reader.GetValue(12))),
            cancellationToken);

        return rows
            .GroupBy(row => row.Id)
            .Select(group =>
            {
                var first = group.First();
                var assignedOrgUnits = group
                    .Where(row => row.AssignedOrgUnitId.HasValue)
                    .Select(row => new AssignedOrgUnitSummary(
                        row.AssignedOrgUnitId!.Value,
                        row.AssignedOrgCode ?? "",
                        row.AssignedOrgName ?? ""))
                    .DistinctBy(org => org.Id)
                    .OrderBy(org => org.Name)
                    .ToArray();

                return new FormTemplateSummary(
                    first.Id,
                    first.ModuleId,
                    first.ModuleKey,
                    first.ModuleName,
                    first.TemplateKey,
                    first.Name,
                    first.Version,
                    first.Status,
                    first.IsEditable,
                    assignedOrgUnits,
                    first.SubmissionCount);
            })
            .ToArray();
    }

    public async Task<FormDefinitionSummary?> GetFormDefinitionAsync(
        string templateKey,
        CancellationToken cancellationToken)
    {
        var rows = await QueryAsync(
            """
            SELECT
                ft.id,
                ftv.id,
                ft.template_key,
                ft.name,
                ftv.version_label,
                fs.id,
                fs.section_key,
                fs.title,
                fs.display_order,
                ff.id,
                ff.field_key,
                ff.label,
                ff.field_type,
                ff.is_required,
                ff.display_order,
                ff.help_text,
                ff.configuration_json
            FROM forms.form_templates ft
            JOIN forms.form_template_versions ftv ON ftv.form_template_id = ft.id
            JOIN forms.form_sections fs ON fs.form_template_version_id = ftv.id
            JOIN forms.form_fields ff ON ff.form_section_id = fs.id
            WHERE ft.template_key = @templateKey
              AND ft.archived_at IS NULL
              AND ftv.archived_at IS NULL
              AND fs.archived_at IS NULL
              AND ff.archived_at IS NULL
              AND ff.is_active = 1
              AND ftv.id = (
                  SELECT TOP (1) latest.id
                  FROM forms.form_template_versions latest
                  WHERE latest.form_template_id = ft.id
                    AND latest.archived_at IS NULL
                  ORDER BY latest.is_published DESC, latest.active_from DESC, latest.created_at DESC
              )
            ORDER BY fs.display_order, ff.display_order;
            """,
            command => command.Parameters.AddWithValue("@templateKey", templateKey),
            reader => new FormDefinitionRow(
                reader.GetGuid(0),
                reader.GetGuid(1),
                reader.GetString(2),
                reader.GetString(3),
                reader.GetString(4),
                reader.GetGuid(5),
                reader.GetString(6),
                reader.GetString(7),
                reader.GetInt32(8),
                reader.GetGuid(9),
                reader.GetString(10),
                reader.GetString(11),
                reader.GetString(12),
                reader.GetBoolean(13),
                reader.GetInt32(14),
                GetStringOrNull(reader, 15),
                GetStringOrNull(reader, 16)),
            cancellationToken);

        if (rows.Count == 0)
        {
            return null;
        }

        var first = rows[0];
        var sections = rows
            .GroupBy(row => row.SectionId)
            .Select(group =>
            {
                var section = group.First();
                return new FormSectionSummary(
                    section.SectionId,
                    section.SectionKey,
                    section.SectionTitle,
                    section.SectionDisplayOrder,
                    group
                        .Select(field => new FormFieldSummary(
                            field.FieldId,
                            field.FieldKey,
                            field.Label,
                            field.FieldType,
                            field.IsRequired,
                            field.FieldDisplayOrder,
                            field.HelpText,
                            ParseFieldOptions(field.ConfigurationJson)))
                        .OrderBy(field => field.DisplayOrder)
                        .ToArray());
            })
            .OrderBy(section => section.DisplayOrder)
            .ToArray();

        return new FormDefinitionSummary(
            first.TemplateId,
            first.VersionId,
            first.TemplateKey,
            first.TemplateName,
            first.VersionLabel,
            sections);
    }

    public Task<IReadOnlyList<LearningWalkThemeMappingSummary>> GetLearningWalkThemeMappingsAsync(
        CancellationToken cancellationToken) =>
        QueryAsync(
            """
            SELECT
                id,
                faculty_org_unit_id,
                child_org_unit_id,
                agreed_theme
            FROM quality.learning_walk_theme_mappings
            WHERE archived_at IS NULL
              AND is_active = 1
            ORDER BY faculty_org_unit_id, child_org_unit_id;
            """,
            reader => new LearningWalkThemeMappingSummary(
                reader.GetGuid(0),
                reader.GetGuid(1),
                reader.GetGuid(2),
                reader.GetString(3)),
            cancellationToken);

    public async Task<Guid> UpsertLearningWalkThemeMappingAsync(
        UpdateLearningWalkThemeMappingRequest request,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var command = new SqlCommand(
            """
            IF NOT EXISTS (
                SELECT 1
                FROM org.org_units faculty
                JOIN org.org_units child ON child.parent_org_unit_id = faculty.id
                WHERE faculty.id = @facultyOrgUnitId
                  AND child.id = @childOrgUnitId
                  AND faculty.org_unit_type = 'faculty'
                  AND child.org_unit_type IN ('team', 'faculty_child_code', 'faculty_child')
                  AND faculty.archived_at IS NULL
                  AND child.archived_at IS NULL
            )
            BEGIN
                THROW 51000, 'The selected team is not a child of the selected faculty.', 1;
            END;

            DECLARE @mappingId uniqueidentifier = (
                SELECT TOP (1) id
                FROM quality.learning_walk_theme_mappings
                WHERE faculty_org_unit_id = @facultyOrgUnitId
                  AND child_org_unit_id = @childOrgUnitId
                  AND archived_at IS NULL
            );

            IF @mappingId IS NULL
            BEGIN
                SET @mappingId = newid();

                INSERT INTO quality.learning_walk_theme_mappings (
                    id,
                    faculty_org_unit_id,
                    child_org_unit_id,
                    agreed_theme
                )
                VALUES (
                    @mappingId,
                    @facultyOrgUnitId,
                    @childOrgUnitId,
                    @agreedTheme
                );
            END
            ELSE
            BEGIN
                UPDATE quality.learning_walk_theme_mappings
                SET agreed_theme = @agreedTheme,
                    is_active = 1,
                    updated_at = sysutcdatetime()
                WHERE id = @mappingId;
            END;

            SELECT @mappingId;
            """,
            connection);

        command.Parameters.AddWithValue("@facultyOrgUnitId", request.FacultyOrgUnitId);
        command.Parameters.AddWithValue("@childOrgUnitId", request.ChildOrgUnitId);
        command.Parameters.AddWithValue("@agreedTheme", request.AgreedTheme.Trim());

        return (Guid)(await command.ExecuteScalarAsync(cancellationToken)
            ?? throw new InvalidOperationException("Learning Walk theme mapping was not saved."));
    }

    public Task<IReadOnlyList<RecordSummary>> GetRecordsAsync(CurrentUser currentUser, CancellationToken cancellationToken) =>
        QueryAsync(
            """
            WITH scoped_org_units AS (
                SELECT org_unit_id
                FROM auth.access_scopes
                WHERE user_account_id = @currentUserAccountId
                  AND scope_type = 'assigned_org_units'
                  AND org_unit_id IS NOT NULL
                  AND is_active = 1
                  AND archived_at IS NULL
                UNION ALL
                SELECT child.id
                FROM org.org_units child
                JOIN scoped_org_units parent_scope ON parent_scope.org_unit_id = child.parent_org_unit_id
                WHERE child.archived_at IS NULL
            )
            SELECT r.id, r.module_id, r.record_type, r.title, r.subject_staff_id, r.owner_staff_id, r.org_unit_id, r.record_date, r.created_at,
                   COALESCE(latest_submission.status, 'submitted') AS submission_status
            FROM core.records r
            OUTER APPLY (
                SELECT TOP (1) fsub.status
                FROM forms.form_submissions fsub
                WHERE fsub.record_id = r.id
                  AND fsub.archived_at IS NULL
                ORDER BY fsub.created_at DESC
            ) latest_submission
            LEFT JOIN people.staff subject_staff ON subject_staff.id = r.subject_staff_id
            LEFT JOIN people.staff owner_staff ON owner_staff.id = r.owner_staff_id
            WHERE r.archived_at IS NULL
              AND (
                    COALESCE(latest_submission.status, 'submitted') <> 'draft'
                    OR r.owner_staff_id = @currentStaffId
                    OR @canViewAll = 1
              )
              AND (
                    @canViewAll = 1
                    OR r.owner_staff_id = @currentStaffId
                    OR (
                        -- Learning walks are visible by who created them: the
                        -- walk's owner must sit inside the viewer's scope or
                        -- report to them directly, and the walk itself must be
                        -- in the viewer's scoped area.
                        @canViewScopedActivities = 1
                        AND r.record_type = 'learning_walk'
                        AND (
                            EXISTS (
                                SELECT 1 FROM scoped_org_units sou
                                WHERE sou.org_unit_id = owner_staff.primary_org_unit_id
                            )
                            OR owner_staff.line_manager_staff_id = @currentStaffId
                        )
                        AND EXISTS (
                            SELECT 1 FROM scoped_org_units sou
                            WHERE sou.org_unit_id = r.org_unit_id
                        )
                    )
                    OR (
                        @canViewScopedActivities = 1
                        AND r.record_type = 'work_scrutiny'
                        AND (
                            EXISTS (
                                SELECT 1 FROM scoped_org_units sou
                                WHERE sou.org_unit_id = r.org_unit_id
                                   OR sou.org_unit_id = subject_staff.primary_org_unit_id
                            )
                            OR EXISTS (
                                SELECT 1
                                FROM auth.access_scopes line_scope
                                WHERE line_scope.user_account_id = @currentUserAccountId
                                  AND line_scope.scope_type = 'line_managed_staff'
                                  AND line_scope.is_active = 1
                                  AND line_scope.archived_at IS NULL
                                  AND subject_staff.line_manager_staff_id = @currentStaffId
                            )
                        )
                    )
                    OR (
                        @canViewScopedActivities = 1
                        AND r.record_type = 'elevate_environment'
                        AND (
                            EXISTS (
                                SELECT 1 FROM scoped_org_units sou
                                WHERE sou.org_unit_id = r.org_unit_id
                                   OR sou.org_unit_id = owner_staff.primary_org_unit_id
                            )
                            OR owner_staff.line_manager_staff_id = @currentStaffId
                        )
                    )
              )
            ORDER BY created_at DESC;
            """,
            command => AddScopeParameters(command, currentUser),
            reader => new RecordSummary(
                reader.GetGuid(0),
                reader.GetGuid(1),
                reader.GetString(2),
                reader.GetString(3),
                GetGuidOrNull(reader, 4),
                GetGuidOrNull(reader, 5),
                GetGuidOrNull(reader, 6),
                GetDateOnlyOrNull(reader, 7),
                reader.GetFieldValue<DateTimeOffset>(8),
                reader.GetString(9)),
            cancellationToken);

    public async Task<RecordDetailSummary?> GetRecordDetailAsync(
        Guid id,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        var rows = await QueryAsync(
            """
            WITH scoped_org_units AS (
                SELECT org_unit_id
                FROM auth.access_scopes
                WHERE user_account_id = @currentUserAccountId
                  AND scope_type = 'assigned_org_units'
                  AND org_unit_id IS NOT NULL
                  AND is_active = 1
                  AND archived_at IS NULL
                UNION ALL
                SELECT child.id
                FROM org.org_units child
                JOIN scoped_org_units parent_scope ON parent_scope.org_unit_id = child.parent_org_unit_id
                WHERE child.archived_at IS NULL
            )
            SELECT
                r.id,
                m.module_key,
                m.name AS module_name,
                r.record_type,
                r.title,
                r.summary,
                r.owner_staff_id,
                owner.display_name AS owner_display_name,
                r.org_unit_id,
                org_unit.code AS org_unit_code,
                org_unit.name AS org_unit_name,
                parent_org.code AS parent_org_unit_code,
                r.record_date,
                r.created_at,
                fsub.id AS form_submission_id,
                ft.template_key,
                ft.name AS template_name,
                ftv.version_label,
                fsub.status,
                fsub.submitted_at,
                section.id AS section_id,
                section.section_key,
                section.title AS section_title,
                section.display_order AS section_display_order,
                field.id AS field_id,
                field.field_key,
                field.label,
                field.field_type,
                field.is_required,
                field.display_order AS field_display_order,
                field.help_text,
                field.configuration_json,
                COALESCE(response.response_text, CONVERT(nvarchar(10), response.response_date, 23)) AS response_value
            FROM core.records r
            JOIN core.modules m ON m.id = r.module_id
            JOIN forms.form_submissions fsub ON fsub.record_id = r.id
                AND fsub.archived_at IS NULL
            JOIN forms.form_template_versions ftv ON ftv.id = fsub.form_template_version_id
                AND ftv.archived_at IS NULL
            JOIN forms.form_templates ft ON ft.id = ftv.form_template_id
            JOIN forms.form_sections section ON section.form_template_version_id = ftv.id
                AND section.archived_at IS NULL
            JOIN forms.form_fields field ON field.form_section_id = section.id
                AND field.archived_at IS NULL
                AND field.is_active = 1
            LEFT JOIN forms.form_responses response ON response.form_submission_id = fsub.id
                AND response.form_field_id = field.id
                AND response.archived_at IS NULL
            LEFT JOIN people.staff subject_staff ON subject_staff.id = r.subject_staff_id
            LEFT JOIN people.staff owner ON owner.id = r.owner_staff_id
            LEFT JOIN org.org_units org_unit ON org_unit.id = r.org_unit_id
            LEFT JOIN org.org_units parent_org ON parent_org.id = org_unit.parent_org_unit_id
            WHERE r.id = @id
              AND r.archived_at IS NULL
              AND (
                    @canViewAll = 1
                    OR r.owner_staff_id = @currentStaffId
                    OR (
                        -- Learning walk visibility follows the record's creator,
                        -- and the walk itself must be in the viewer's scoped area.
                        @canViewScopedActivities = 1
                        AND r.record_type = 'learning_walk'
                        AND (
                            EXISTS (
                                SELECT 1 FROM scoped_org_units sou
                                WHERE sou.org_unit_id = owner.primary_org_unit_id
                            )
                            OR owner.line_manager_staff_id = @currentStaffId
                        )
                        AND EXISTS (
                            SELECT 1 FROM scoped_org_units sou
                            WHERE sou.org_unit_id = r.org_unit_id
                        )
                    )
                    OR (
                        @canViewScopedActivities = 1
                        AND r.record_type = 'work_scrutiny'
                        AND (
                            EXISTS (
                                SELECT 1 FROM scoped_org_units sou
                                WHERE sou.org_unit_id = r.org_unit_id
                                   OR sou.org_unit_id = subject_staff.primary_org_unit_id
                            )
                            OR EXISTS (
                                SELECT 1
                                FROM auth.access_scopes line_scope
                                WHERE line_scope.user_account_id = @currentUserAccountId
                                  AND line_scope.scope_type = 'line_managed_staff'
                                  AND line_scope.is_active = 1
                                  AND line_scope.archived_at IS NULL
                                  AND subject_staff.line_manager_staff_id = @currentStaffId
                            )
                        )
                    )
                    OR (
                        @canViewScopedActivities = 1
                        AND r.record_type = 'elevate_environment'
                        AND (
                            EXISTS (
                                SELECT 1 FROM scoped_org_units sou
                                WHERE sou.org_unit_id = r.org_unit_id
                                   OR sou.org_unit_id = owner.primary_org_unit_id
                            )
                            OR owner.line_manager_staff_id = @currentStaffId
                        )
                    )
              )
            ORDER BY section.display_order, field.display_order;
            """,
            command =>
            {
                AddScopeParameters(command, currentUser);
                command.Parameters.AddWithValue("@id", id);
            },
            reader => new RecordDetailRow(
                reader.GetGuid(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.GetString(3),
                reader.GetString(4),
                GetStringOrNull(reader, 5),
                GetGuidOrNull(reader, 6),
                GetStringOrNull(reader, 7),
                GetGuidOrNull(reader, 8),
                GetStringOrNull(reader, 9),
                GetStringOrNull(reader, 10),
                GetStringOrNull(reader, 11),
                GetDateOnlyOrNull(reader, 12),
                reader.GetFieldValue<DateTimeOffset>(13),
                reader.GetGuid(14),
                reader.GetString(15),
                reader.GetString(16),
                reader.GetString(17),
                reader.GetString(18),
                GetDateTimeOffsetOrNull(reader, 19),
                reader.GetGuid(20),
                reader.GetString(21),
                reader.GetString(22),
                reader.GetInt32(23),
                reader.GetGuid(24),
                reader.GetString(25),
                reader.GetString(26),
                reader.GetString(27),
                reader.GetBoolean(28),
                reader.GetInt32(29),
                GetStringOrNull(reader, 30),
                GetStringOrNull(reader, 31),
                GetStringOrNull(reader, 32)),
            cancellationToken);

        if (rows.Count == 0)
        {
            return null;
        }

        var first = rows[0];
        var sections = rows
            .GroupBy(row => row.SectionId)
            .Select(group =>
            {
                var section = group.First();
                return new RecordDetailSectionSummary(
                    section.SectionId,
                    section.SectionKey,
                    section.SectionTitle,
                    section.SectionDisplayOrder,
                    group
                        .Select(field => new RecordDetailFieldSummary(
                            field.FieldId,
                            field.FieldKey,
                            field.Label,
                            field.FieldType,
                            field.IsRequired,
                            field.FieldDisplayOrder,
                            field.HelpText,
                            ParseFieldOptions(field.ConfigurationJson),
                            field.ResponseValue))
                        .OrderBy(field => field.DisplayOrder)
                        .ToArray());
            })
            .OrderBy(section => section.DisplayOrder)
            .ToArray();

        return new RecordDetailSummary(
            first.Id,
            first.ModuleKey,
            first.ModuleName,
            first.RecordType,
            first.Title,
            first.Summary,
            first.OrgUnitId,
            first.OrgUnitCode,
            first.OrgUnitName,
            first.ParentOrgUnitCode,
            first.RecordDate,
            first.CreatedAt,
            first.OwnerDisplayName,
            first.SubmissionId,
            first.TemplateKey,
            first.TemplateName,
            first.TemplateVersion,
            first.SubmissionStatus,
            first.SubmittedAt,
            SubmissionLifecycle.CanEditResponses(
                first.SubmissionStatus,
                first.OwnerStaffId.HasValue && currentUser.StaffId == first.OwnerStaffId.Value,
                currentUser.HasPermission(PermissionKeys.FormsManage)),
            sections);
    }

    public Task<IReadOnlyList<ActionSummary>> GetActionsAsync(CurrentUser currentUser, CancellationToken cancellationToken)
    {
        var canViewAll = CanViewAllRecords(currentUser);
        var sql = canViewAll
            ? """
              SELECT a.id, a.source_record_id, a.subject_staff_id, a.owner_staff_id, a.title, a.detail, a.due_date, a.completed_date,
                     r.title AS source_record_title,
                     subject_staff.display_name AS subject_staff_name,
                     owner_staff.display_name AS owner_staff_name,
                     status_value.value_key AS status_key,
                     priority_value.value_key AS priority_key,
                     a.completion_note
              FROM quality.actions a
              LEFT JOIN core.records r ON r.id = a.source_record_id
              LEFT JOIN people.staff subject_staff ON subject_staff.id = a.subject_staff_id
              LEFT JOIN people.staff owner_staff ON owner_staff.id = a.owner_staff_id
              LEFT JOIN core.lookup_values status_value ON status_value.id = a.status_lookup_value_id
              LEFT JOIN core.lookup_values priority_value ON priority_value.id = a.priority_lookup_value_id
              WHERE a.archived_at IS NULL
              ORDER BY
                  CASE WHEN a.completed_date IS NULL THEN 0 ELSE 1 END,
                  a.due_date,
                  a.created_at DESC;
              """
            : """
            WITH scoped_org_units AS (
                SELECT org_unit_id
                FROM auth.access_scopes
                WHERE user_account_id = @currentUserAccountId
                  AND scope_type = 'assigned_org_units'
                  AND org_unit_id IS NOT NULL
                  AND is_active = 1
                  AND archived_at IS NULL
                UNION ALL
                SELECT child.id
                FROM org.org_units child
                JOIN scoped_org_units parent_scope ON parent_scope.org_unit_id = child.parent_org_unit_id
                WHERE child.archived_at IS NULL
            )
            SELECT a.id, a.source_record_id, a.subject_staff_id, a.owner_staff_id, a.title, a.detail, a.due_date, a.completed_date,
                   r.title AS source_record_title,
                   subject_staff.display_name AS subject_staff_name,
                   owner_staff.display_name AS owner_staff_name,
                   status_value.value_key AS status_key,
                   priority_value.value_key AS priority_key,
                   a.completion_note
            FROM quality.actions a
            LEFT JOIN core.records r ON r.id = a.source_record_id
            LEFT JOIN people.staff subject_staff ON subject_staff.id = a.subject_staff_id
            LEFT JOIN people.staff owner_staff ON owner_staff.id = a.owner_staff_id
            LEFT JOIN core.lookup_values status_value ON status_value.id = a.status_lookup_value_id
            LEFT JOIN core.lookup_values priority_value ON priority_value.id = a.priority_lookup_value_id
            WHERE a.archived_at IS NULL
              AND (
                    @canViewAll = 1
                    OR a.owner_staff_id = @currentStaffId
                    OR a.subject_staff_id = @currentStaffId
                    OR (
                        @canViewScopedActivities = 1
                        AND (
                            EXISTS (
                                SELECT 1 FROM scoped_org_units sou
                                WHERE sou.org_unit_id = r.org_unit_id
                                   OR sou.org_unit_id = subject_staff.primary_org_unit_id
                                   OR sou.org_unit_id = owner_staff.primary_org_unit_id
                            )
                            OR EXISTS (
                                SELECT 1
                                FROM auth.access_scopes line_scope
                                WHERE line_scope.user_account_id = @currentUserAccountId
                                  AND line_scope.scope_type = 'line_managed_staff'
                                  AND line_scope.is_active = 1
                                  AND line_scope.archived_at IS NULL
                                  AND (
                                      subject_staff.line_manager_staff_id = @currentStaffId
                                      OR owner_staff.line_manager_staff_id = @currentStaffId
                                  )
                            )
                        )
                    )
              )
            ORDER BY
                CASE WHEN a.completed_date IS NULL THEN 0 ELSE 1 END,
                a.due_date,
                a.created_at DESC;
            """;

        return QueryAsync(
            sql,
            canViewAll ? null : command => AddScopeParameters(command, currentUser),
            reader =>
            {
                var dueDate = GetDateOnlyOrNull(reader, 6);
                var completedDate = GetDateOnlyOrNull(reader, 7);
                return new ActionSummary(
                    reader.GetGuid(0),
                    GetGuidOrNull(reader, 1),
                    GetStringOrNull(reader, 8),
                    GetGuidOrNull(reader, 2),
                    GetStringOrNull(reader, 9),
                    reader.GetGuid(3),
                    GetStringOrNull(reader, 10),
                    reader.GetString(4),
                    GetStringOrNull(reader, 5),
                    GetStringOrNull(reader, 11),
                    GetStringOrNull(reader, 12),
                    dueDate,
                    completedDate,
                    GetStringOrNull(reader, 13),
                    dueDate.HasValue && completedDate is null && dueDate.Value < DateOnly.FromDateTime(DateTime.UtcNow));
            },
            cancellationToken);
    }

    public Task<IReadOnlyList<DashboardSummary>> GetDashboardsAsync(CurrentUser currentUser, CancellationToken cancellationToken) =>
        QueryAsync(
            """
            SELECT id, dashboard_key, name, purpose, primary_permission_key, faculty_scope_required
            FROM reporting.dashboards
            WHERE archived_at IS NULL
              AND is_active = 1
              AND primary_permission_key IN (
                  SELECT value FROM STRING_SPLIT(@permissionKeysCsv, ',')
              )
            ORDER BY name;
            """,
            command => command.Parameters.AddWithValue("@permissionKeysCsv", string.Join(",", currentUser.Permissions)),
            reader => new DashboardSummary(
                reader.GetGuid(0),
                reader.GetString(1),
                reader.GetString(2),
                GetStringOrNull(reader, 3),
                reader.GetString(4),
                reader.GetBoolean(5)),
            cancellationToken);

    public Task<IReadOnlyList<ActivityOverviewSummary>> GetActivityOverviewAsync(CurrentUser currentUser, CancellationToken cancellationToken) =>
        QueryAsync(
            """
            WITH scoped_org_units AS (
                SELECT org_unit_id
                FROM auth.access_scopes
                WHERE user_account_id = @currentUserAccountId
                  AND scope_type = 'assigned_org_units'
                  AND org_unit_id IS NOT NULL
                  AND is_active = 1
                  AND archived_at IS NULL
                UNION ALL
                SELECT child.id
                FROM org.org_units child
                JOIN scoped_org_units parent_scope ON parent_scope.org_unit_id = child.parent_org_unit_id
                WHERE child.archived_at IS NULL
            )
            SELECT m.module_key, m.name AS module_name, r.record_type, COUNT_BIG(*) AS record_count
            FROM core.records r
            JOIN core.modules m ON m.id = r.module_id
            LEFT JOIN people.staff subject_staff ON subject_staff.id = r.subject_staff_id
            LEFT JOIN people.staff owner_staff ON owner_staff.id = r.owner_staff_id
            WHERE r.archived_at IS NULL
              AND (
                    @canViewAll = 1
                    OR r.owner_staff_id = @currentStaffId
                    OR (
                        -- Learning walk visibility follows the record's creator,
                        -- and the walk itself must be in the viewer's scoped area.
                        @canViewScopedActivities = 1
                        AND r.record_type = 'learning_walk'
                        AND (
                            EXISTS (
                                SELECT 1 FROM scoped_org_units sou
                                WHERE sou.org_unit_id = owner_staff.primary_org_unit_id
                            )
                            OR owner_staff.line_manager_staff_id = @currentStaffId
                        )
                        AND EXISTS (
                            SELECT 1 FROM scoped_org_units sou
                            WHERE sou.org_unit_id = r.org_unit_id
                        )
                    )
                    OR (
                        @canViewScopedActivities = 1
                        AND r.record_type = 'work_scrutiny'
                        AND (
                            EXISTS (
                                SELECT 1 FROM scoped_org_units sou
                                WHERE sou.org_unit_id = r.org_unit_id
                                   OR sou.org_unit_id = subject_staff.primary_org_unit_id
                            )
                            OR EXISTS (
                                SELECT 1
                                FROM auth.access_scopes line_scope
                                WHERE line_scope.user_account_id = @currentUserAccountId
                                  AND line_scope.scope_type = 'line_managed_staff'
                                  AND line_scope.is_active = 1
                                  AND line_scope.archived_at IS NULL
                                  AND subject_staff.line_manager_staff_id = @currentStaffId
                            )
                        )
                    )
                    OR (
                        @canViewScopedActivities = 1
                        AND r.record_type = 'elevate_environment'
                        AND (
                            EXISTS (
                                SELECT 1 FROM scoped_org_units sou
                                WHERE sou.org_unit_id = r.org_unit_id
                                   OR sou.org_unit_id = owner_staff.primary_org_unit_id
                            )
                            OR owner_staff.line_manager_staff_id = @currentStaffId
                        )
                    )
              )
            GROUP BY m.module_key, m.name, r.record_type
            ORDER BY m.name, r.record_type;
            """,
            command => AddScopeParameters(command, currentUser),
            reader => new ActivityOverviewSummary(
                reader.GetString(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.GetInt64(3)),
            cancellationToken);

    public Task<IReadOnlyList<ProcessDashboardRecordSummary>> GetProcessDashboardRecordsAsync(
        CurrentUser currentUser,
        CancellationToken cancellationToken) =>
        QueryAsync(
            """
            WITH scoped_org_units AS (
                SELECT org_unit_id
                FROM auth.access_scopes
                WHERE user_account_id = @currentUserAccountId
                  AND scope_type = 'assigned_org_units'
                  AND org_unit_id IS NOT NULL
                  AND is_active = 1
                  AND archived_at IS NULL
                UNION ALL
                SELECT child.id
                FROM org.org_units child
                JOIN scoped_org_units parent_scope ON parent_scope.org_unit_id = child.parent_org_unit_id
                WHERE child.archived_at IS NULL
            )
            SELECT
                r.id,
                r.record_type,
                r.title,
                r.summary,
                r.record_date,
                r.created_at,
                CASE WHEN r.record_type = 'coaching_session'
                     THEN coaching_session.status
                     ELSE COALESCE(latest_submission.status, 'submitted')
                END AS submission_status,
                r.org_unit_id,
                CASE
                    WHEN r.record_type = 'elevate_environment' THEN elevate_room.room_code
                    WHEN r.record_type = 'cpd_event' AND cpd_metrics.area_count > 1 THEN 'Multiple'
                    WHEN r.record_type = 'cpd_event' THEN cpd_metrics.area_code
                    ELSE org_unit.code
                END AS area_code,
                CASE
                    WHEN r.record_type = 'elevate_environment' THEN elevate_room.building_name
                    WHEN r.record_type = 'cpd_event' AND cpd_metrics.area_count > 1 THEN 'Multiple areas'
                    WHEN r.record_type = 'cpd_event' THEN cpd_metrics.area_name
                    ELSE org_unit.name
                END AS area_name,
                CASE
                    WHEN r.record_type = 'elevate_environment' THEN elevate_room.building_name
                    WHEN r.record_type = 'cpd_event' AND cpd_metrics.area_count = 1 THEN cpd_metrics.parent_area_code
                    WHEN r.record_type <> 'cpd_event' THEN parent_org.code
                    ELSE NULL
                END AS parent_area_code,
                owner_staff.display_name AS owner_display_name,
                subject_staff.display_name AS subject_display_name,
                CASE
                    WHEN r.record_type = 'elevate_environment' AND elevate_assessment.barrier_count > 0 THEN 'Barrier present'
                    WHEN r.record_type = 'elevate_environment'
                         AND CAST(elevate_assessment.total_score AS decimal(10, 2)) / NULLIF(elevate_assessment.scored_value_count, 0) >= 3 THEN 'Elevate'
                    WHEN r.record_type = 'elevate_environment'
                         AND CAST(elevate_assessment.total_score AS decimal(10, 2)) / NULLIF(elevate_assessment.scored_value_count, 0) >= 2 THEN 'Secure'
                    WHEN r.record_type = 'elevate_environment' THEN 'Emerging'
                    WHEN r.record_type = 'coaching_session' THEN CASE coaching_session.main_focus
                        WHEN 'teaching_learning' THEN 'Teaching & learning'
                        WHEN 'subject_practice' THEN 'Subject practice'
                        ELSE REPLACE(coaching_session.main_focus, '_', ' ')
                    END
                    ELSE theme_response.response_text
                END AS theme,
                CASE
                    WHEN r.record_type = 'work_scrutiny' THEN r.summary
                    WHEN r.record_type = 'coaching_session' THEN CONCAT(
                        REPLACE(coaching_session.session_type, '_', ' '),
                        CASE WHEN coaching_session.duration_minutes IS NULL THEN ''
                             ELSE CONCAT(', ', coaching_session.duration_minutes, ' minutes') END
                    )
                    ELSE detail_response.response_text
                END AS detail,
                cpd_metrics.participant_area_breakdown,
                COALESCE(cpd_metrics.participant_count, 0) AS participant_count,
                COALESCE(cpd_metrics.attendance_credits, 0) AS attendance_credits,
                COALESCE(scrutiny_detail.sample_size, 0) AS sample_size,
                COALESCE(elevate_assessment.total_score, 0) AS score_total,
                COALESCE(elevate_assessment.scored_value_count, 0) AS score_count,
                COALESCE(elevate_assessment.barrier_count, 0) AS barrier_count
            FROM core.records r
            LEFT JOIN people.staff owner_staff ON owner_staff.id = r.owner_staff_id
            LEFT JOIN people.staff subject_staff ON subject_staff.id = r.subject_staff_id
            LEFT JOIN org.org_units org_unit ON org_unit.id = r.org_unit_id
            LEFT JOIN org.org_units parent_org ON parent_org.id = org_unit.parent_org_unit_id
            LEFT JOIN quality.activities activity ON activity.record_id = r.id
                AND activity.archived_at IS NULL
            LEFT JOIN quality.work_scrutiny_details scrutiny_detail ON scrutiny_detail.activity_id = activity.id
            LEFT JOIN quality.elevate_environment_assessments elevate_assessment ON elevate_assessment.record_id = r.id
            LEFT JOIN quality.rooms elevate_room ON elevate_room.id = elevate_assessment.room_id
            LEFT JOIN quality.coaching_sessions coaching_session ON coaching_session.record_id = r.id
                AND coaching_session.archived_at IS NULL
            OUTER APPLY (
                SELECT TOP (1) submission.id, submission.status
                FROM forms.form_submissions submission
                WHERE submission.record_id = r.id
                  AND submission.archived_at IS NULL
                ORDER BY submission.created_at DESC
            ) latest_submission
            OUTER APPLY (
                SELECT TOP (1) response.response_text
                FROM forms.form_responses response
                JOIN forms.form_fields field ON field.id = response.form_field_id
                WHERE response.form_submission_id = latest_submission.id
                  AND response.archived_at IS NULL
                  AND field.field_key = CASE r.record_type
                      WHEN 'learning_walk' THEN 'learning_walk_theme'
                      WHEN 'work_scrutiny' THEN 'finding_tag'
                      WHEN 'cpd_event' THEN 'cpd_themes'
                  END
            ) theme_response
            OUTER APPLY (
                SELECT TOP (1) response.response_text
                FROM forms.form_responses response
                JOIN forms.form_fields field ON field.id = response.form_field_id
                WHERE response.form_submission_id = latest_submission.id
                  AND response.archived_at IS NULL
                  AND field.field_key = CASE r.record_type
                      WHEN 'work_scrutiny' THEN 'course_or_unit'
                      WHEN 'cpd_event' THEN 'delivery_mode'
                      WHEN 'elevate_environment' THEN 'intended_purpose'
                      ELSE 'staff_id'
                  END
            ) detail_response
            OUTER APPLY (
                SELECT
                    COUNT(*) AS area_count,
                    COALESCE(SUM(area_metrics.participant_count), 0) AS participant_count,
                    COALESCE(SUM(area_metrics.attendance_credits), 0) AS attendance_credits,
                    MAX(area_metrics.area_code) AS area_code,
                    MAX(area_metrics.area_name) AS area_name,
                    MAX(area_metrics.parent_area_code) AS parent_area_code,
                    STRING_AGG(
                        CONCAT(
                            COALESCE(area_metrics.parent_area_code, ''), '~',
                            COALESCE(area_metrics.area_code, 'Unassigned'), '~',
                            area_metrics.participant_count, '~',
                            area_metrics.attendance_credits
                        ),
                        '|'
                    ) AS participant_area_breakdown
                FROM (
                    SELECT
                        attendee_org.code AS area_code,
                        attendee_org.name AS area_name,
                        attendee_parent.code AS parent_area_code,
                        COUNT(attendance.id) AS participant_count,
                        COALESCE(SUM(attendance.milestone_credit), 0) AS attendance_credits
                    FROM cpd.cpd_events event
                    JOIN cpd.cpd_attendance attendance ON attendance.cpd_event_id = event.id
                        AND attendance.archived_at IS NULL
                    LEFT JOIN people.staff attendee ON attendee.id = attendance.staff_id
                    LEFT JOIN org.org_units attendee_org ON attendee_org.id = COALESCE(attendance.org_unit_id_at_time, attendee.primary_org_unit_id)
                    LEFT JOIN org.org_units attendee_parent ON attendee_parent.id = attendee_org.parent_org_unit_id
                    WHERE event.record_id = r.id
                      AND event.archived_at IS NULL
                      AND (
                            @canViewAll = 1
                            OR attendance.staff_id = @currentStaffId
                            OR EXISTS (
                                SELECT 1 FROM scoped_org_units sou
                                WHERE sou.org_unit_id = COALESCE(attendance.org_unit_id_at_time, attendee.primary_org_unit_id)
                            )
                      )
                    GROUP BY attendee_org.id, attendee_org.code, attendee_org.name, attendee_parent.code
                ) area_metrics
            ) cpd_metrics
            WHERE r.archived_at IS NULL
              AND r.record_type IN ('learning_walk', 'work_scrutiny', 'cpd_event', 'elevate_environment', 'coaching_session')
              AND (
                    COALESCE(coaching_session.status, latest_submission.status, 'submitted') <> 'draft'
                    OR r.owner_staff_id = @currentStaffId
                    OR @canViewAll = 1
              )
              AND (
                    @canViewAll = 1
                    OR r.owner_staff_id = @currentStaffId
                    OR (
                        @canViewScopedActivities = 1
                        AND r.record_type = 'learning_walk'
                        AND (
                            EXISTS (
                                SELECT 1 FROM scoped_org_units sou
                                WHERE sou.org_unit_id = owner_staff.primary_org_unit_id
                            )
                            OR owner_staff.line_manager_staff_id = @currentStaffId
                        )
                        AND EXISTS (
                            SELECT 1 FROM scoped_org_units sou
                            WHERE sou.org_unit_id = r.org_unit_id
                        )
                    )
                    OR (
                        @canViewScopedActivities = 1
                        AND r.record_type = 'work_scrutiny'
                        AND (
                            EXISTS (
                                SELECT 1 FROM scoped_org_units sou
                                WHERE sou.org_unit_id = r.org_unit_id
                                   OR sou.org_unit_id = subject_staff.primary_org_unit_id
                            )
                            OR subject_staff.line_manager_staff_id = @currentStaffId
                        )
                    )
                    OR (
                        @canViewScopedActivities = 1
                        AND r.record_type = 'elevate_environment'
                        AND (
                            EXISTS (
                                SELECT 1 FROM scoped_org_units sou
                                WHERE sou.org_unit_id = r.org_unit_id
                                   OR sou.org_unit_id = owner_staff.primary_org_unit_id
                            )
                            OR owner_staff.line_manager_staff_id = @currentStaffId
                        )
                    )
                    OR (
                        @canViewScopedActivities = 1
                        AND r.record_type = 'cpd_event'
                        AND EXISTS (
                            SELECT 1
                            FROM cpd.cpd_events scoped_event
                            JOIN cpd.cpd_attendance scoped_attendance ON scoped_attendance.cpd_event_id = scoped_event.id
                                AND scoped_attendance.archived_at IS NULL
                            LEFT JOIN people.staff scoped_attendee ON scoped_attendee.id = scoped_attendance.staff_id
                            WHERE scoped_event.record_id = r.id
                              AND scoped_event.archived_at IS NULL
                              AND EXISTS (
                                  SELECT 1 FROM scoped_org_units sou
                                  WHERE sou.org_unit_id = COALESCE(scoped_attendance.org_unit_id_at_time, scoped_attendee.primary_org_unit_id)
                              )
                        )
                    )
                    OR (
                        @canViewScopedActivities = 1
                        AND r.record_type = 'coaching_session'
                        AND (
                            r.owner_staff_id = @currentStaffId
                            OR r.subject_staff_id = @currentStaffId
                            OR subject_staff.line_manager_staff_id = @currentStaffId
                            OR EXISTS (
                                SELECT 1 FROM scoped_org_units sou
                                WHERE sou.org_unit_id = r.org_unit_id
                                   OR sou.org_unit_id = subject_staff.primary_org_unit_id
                            )
                        )
                    )
              )
            ORDER BY COALESCE(r.record_date, CONVERT(date, r.created_at)) DESC, r.created_at DESC;
            """,
            command => AddScopeParameters(command, currentUser),
            reader => new ProcessDashboardRecordSummary(
                reader.GetGuid(0),
                reader.GetString(1),
                reader.GetString(2),
                GetStringOrNull(reader, 3),
                GetDateOnlyOrNull(reader, 4),
                reader.GetFieldValue<DateTimeOffset>(5),
                reader.GetString(6),
                GetGuidOrNull(reader, 7),
                GetStringOrNull(reader, 8),
                GetStringOrNull(reader, 9),
                GetStringOrNull(reader, 10),
                GetStringOrNull(reader, 11),
                GetStringOrNull(reader, 12),
                GetStringOrNull(reader, 13),
                GetStringOrNull(reader, 14),
                GetStringOrNull(reader, 15),
                Convert.ToInt32(reader.GetValue(16)),
                Convert.ToInt32(reader.GetValue(17)),
                Convert.ToInt32(reader.GetValue(18)),
                Convert.ToInt32(reader.GetValue(19)),
                Convert.ToInt32(reader.GetValue(20)),
                Convert.ToInt32(reader.GetValue(21))),
            cancellationToken);

    public Task<IReadOnlyList<LearningWalkRollupSummary>> GetLearningWalkRollupAsync(CurrentUser currentUser, CancellationToken cancellationToken) =>
        QueryAsync(
            """
            WITH scoped_org_units AS (
                SELECT org_unit_id
                FROM auth.access_scopes
                WHERE user_account_id = @currentUserAccountId
                  AND scope_type = 'assigned_org_units'
                  AND org_unit_id IS NOT NULL
                  AND is_active = 1
                  AND archived_at IS NULL
                UNION ALL
                SELECT child.id
                FROM org.org_units child
                JOIN scoped_org_units parent_scope ON parent_scope.org_unit_id = child.parent_org_unit_id
                WHERE child.archived_at IS NULL
            )
            SELECT
                COALESCE(parent_org.id, org_unit.id) AS faculty_org_unit_id,
                COALESCE(parent_org.code, org_unit.code) AS faculty_code,
                COALESCE(parent_org.name, org_unit.name) AS faculty_name,
                CASE WHEN parent_org.id IS NULL THEN NULL ELSE org_unit.id END AS child_org_unit_id,
                CASE WHEN parent_org.id IS NULL THEN NULL ELSE org_unit.code END AS child_code,
                CASE WHEN parent_org.id IS NULL THEN NULL ELSE org_unit.name END AS child_name,
                COUNT_BIG(*) AS record_count,
                MAX(r.record_date) AS latest_record_date
            FROM core.records r
            LEFT JOIN people.staff owner_staff ON owner_staff.id = r.owner_staff_id
            LEFT JOIN org.org_units org_unit ON org_unit.id = r.org_unit_id
            LEFT JOIN org.org_units parent_org ON parent_org.id = org_unit.parent_org_unit_id
            WHERE r.archived_at IS NULL
              AND r.record_type = 'learning_walk'
              AND (
                    @canViewAll = 1
                    OR r.owner_staff_id = @currentStaffId
                    OR (
                        -- Learning walk visibility follows the record's creator,
                        -- and the walk itself must be in the viewer's scoped area.
                        @canViewScopedActivities = 1
                        AND (
                            EXISTS (
                                SELECT 1 FROM scoped_org_units sou
                                WHERE sou.org_unit_id = owner_staff.primary_org_unit_id
                            )
                            OR owner_staff.line_manager_staff_id = @currentStaffId
                        )
                        AND EXISTS (
                            SELECT 1 FROM scoped_org_units sou
                            WHERE sou.org_unit_id = r.org_unit_id
                        )
                    )
              )
            GROUP BY
                COALESCE(parent_org.id, org_unit.id),
                COALESCE(parent_org.code, org_unit.code),
                COALESCE(parent_org.name, org_unit.name),
                CASE WHEN parent_org.id IS NULL THEN NULL ELSE org_unit.id END,
                CASE WHEN parent_org.id IS NULL THEN NULL ELSE org_unit.code END,
                CASE WHEN parent_org.id IS NULL THEN NULL ELSE org_unit.name END
            ORDER BY faculty_code, child_code;
            """,
            command => AddScopeParameters(command, currentUser),
            reader => new LearningWalkRollupSummary(
                GetGuidOrNull(reader, 0),
                GetStringOrNull(reader, 1),
                GetStringOrNull(reader, 2),
                GetGuidOrNull(reader, 3),
                GetStringOrNull(reader, 4),
                GetStringOrNull(reader, 5),
                reader.GetInt64(6),
                GetDateOnlyOrNull(reader, 7)),
            cancellationToken);

    public Task<IReadOnlyList<StaffProfileSummary>> GetStaffProfileSummariesAsync(CurrentUser currentUser, CancellationToken cancellationToken)
    {
        var canViewAll = CanViewAllStaff(currentUser);
        var sql = canViewAll
            ? """
              SELECT
                  profile.staff_id,
                  profile.external_id,
                  profile.display_name,
                  profile.email,
                  profile.job_title,
                  profile.primary_org_code,
                  profile.cpd_sessions_attended,
                  profile.evidence_records,
                  profile.open_actions,
                  profile.overdue_actions
              FROM reporting.v_staff_profile_summary profile
              ORDER BY profile.display_name;
              """
            : """
            WITH scoped_org_units AS (
                SELECT org_unit_id
                FROM auth.access_scopes
                WHERE user_account_id = @currentUserAccountId
                  AND scope_type = 'assigned_org_units'
                  AND org_unit_id IS NOT NULL
                  AND is_active = 1
                  AND archived_at IS NULL
                UNION ALL
                SELECT child.id
                FROM org.org_units child
                JOIN scoped_org_units parent_scope ON parent_scope.org_unit_id = child.parent_org_unit_id
                WHERE child.archived_at IS NULL
            )
            SELECT
                profile.staff_id,
                profile.external_id,
                profile.display_name,
                profile.email,
                profile.job_title,
                profile.primary_org_code,
                profile.cpd_sessions_attended,
                profile.evidence_records,
                profile.open_actions,
                profile.overdue_actions
            FROM reporting.v_staff_profile_summary profile
            JOIN people.staff staff ON staff.id = profile.staff_id
            WHERE profile.staff_id = @currentStaffId
               OR (
                    @canViewScoped = 1
                    AND (
                        EXISTS (SELECT 1 FROM scoped_org_units sou WHERE sou.org_unit_id = staff.primary_org_unit_id)
                        OR EXISTS (
                            SELECT 1
                            FROM org.staff_org_memberships membership
                            JOIN scoped_org_units sou ON sou.org_unit_id = membership.org_unit_id
                            WHERE membership.staff_id = staff.id
                              AND membership.archived_at IS NULL
                        )
                    )
               )
            ORDER BY profile.display_name;
            """;

        return QueryAsync(
            sql,
            canViewAll ? null : command =>
            {
                command.Parameters.AddWithValue("@canViewScoped", currentUser.HasPermission(PermissionKeys.ReportsViewScoped));
                command.Parameters.AddWithValue("@currentUserAccountId", ToDbValue(currentUser.UserAccountId));
                command.Parameters.AddWithValue("@currentStaffId", ToDbValue(currentUser.StaffId));
            },
            reader => new StaffProfileSummary(
                reader.GetGuid(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.GetString(3),
                GetStringOrNull(reader, 4),
                GetStringOrNull(reader, 5),
                Convert.ToInt32(reader.GetValue(6)),
                Convert.ToInt32(reader.GetValue(7)),
                Convert.ToInt32(reader.GetValue(8)),
                Convert.ToInt32(reader.GetValue(9))),
            cancellationToken);
    }

    public async Task<Guid> CreateRecordAsync(CreateRecordRequest request, CurrentUser currentUser, CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var command = new SqlCommand(
            """
            INSERT INTO core.records (
                module_id,
                record_type,
                title,
                summary,
                subject_staff_id,
                owner_staff_id,
                org_unit_id,
                record_date,
                created_by_user_account_id
            )
            OUTPUT inserted.id
            VALUES (
                @moduleId,
                @recordType,
                @title,
                @summary,
                @subjectStaffId,
                @ownerStaffId,
                @orgUnitId,
                @recordDate,
                @createdByUserAccountId
            );
            """,
            connection);

        command.Parameters.AddWithValue("@moduleId", request.ModuleId);
        command.Parameters.AddWithValue("@recordType", request.RecordType);
        command.Parameters.AddWithValue("@title", request.Title);
        command.Parameters.AddWithValue("@summary", ToDbValue(request.Summary));
        command.Parameters.AddWithValue("@subjectStaffId", ToDbValue(request.SubjectStaffId));
        command.Parameters.AddWithValue("@ownerStaffId", ToDbValue(request.OwnerStaffId ?? currentUser.StaffId));
        command.Parameters.AddWithValue("@orgUnitId", ToDbValue(request.OrgUnitId));
        command.Parameters.AddWithValue("@recordDate", ToDbValue(request.RecordDate));
        command.Parameters.AddWithValue("@createdByUserAccountId", ToDbValue(currentUser.UserAccountId));

        return (Guid)(await command.ExecuteScalarAsync(cancellationToken)
            ?? throw new InvalidOperationException("Record insert did not return an id."));
    }

    public async Task<Guid> CreateActionAsync(CreateActionRequest request, CurrentUser currentUser, CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        try
        {
            Guid actionId;
            await using (var command = new SqlCommand(
                """
                INSERT INTO quality.actions (
                    source_record_id,
                    subject_staff_id,
                    owner_staff_id,
                    title,
                    detail,
                    priority_lookup_value_id,
                    status_lookup_value_id,
                    due_date,
                    published_to_staff,
                    created_by_user_account_id
                )
                OUTPUT inserted.id
                VALUES (
                    @sourceRecordId,
                    @subjectStaffId,
                    @ownerStaffId,
                    @title,
                    @detail,
                    @priorityLookupValueId,
                    COALESCE(
                        @statusLookupValueId,
                        (SELECT TOP (1) lv.id
                         FROM core.lookup_values lv
                         JOIN core.lookup_types lt ON lt.id = lv.lookup_type_id
                         WHERE lt.lookup_key = 'action_status' AND lv.value_key = 'open')),
                    @dueDate,
                    @publishedToStaff,
                    @createdByUserAccountId
                );
                """,
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@sourceRecordId", ToDbValue(request.SourceRecordId));
                command.Parameters.AddWithValue("@subjectStaffId", ToDbValue(request.SubjectStaffId));
                command.Parameters.AddWithValue("@ownerStaffId", request.OwnerStaffId);
                command.Parameters.AddWithValue("@title", request.Title);
                command.Parameters.AddWithValue("@detail", ToDbValue(request.Detail));
                command.Parameters.AddWithValue("@priorityLookupValueId", ToDbValue(request.PriorityLookupValueId));
                command.Parameters.AddWithValue("@statusLookupValueId", ToDbValue(request.StatusLookupValueId));
                command.Parameters.AddWithValue("@dueDate", ToDbValue(request.DueDate));
                command.Parameters.AddWithValue("@publishedToStaff", request.PublishedToStaff);
                command.Parameters.AddWithValue("@createdByUserAccountId", ToDbValue(currentUser.UserAccountId));

                actionId = (Guid)(await command.ExecuteScalarAsync(cancellationToken)
                    ?? throw new InvalidOperationException("Action insert did not return an id."));
            }

            await WriteAuditAsync(
                connection,
                transaction,
                currentUser.UserAccountId,
                request.SourceRecordId,
                "action",
                actionId,
                "action.created",
                $"Action '{request.Title}' created by {currentUser.DisplayName}.",
                null,
                JsonSerializer.Serialize(new
                {
                    title = request.Title,
                    detail = request.Detail,
                    ownerStaffId = request.OwnerStaffId,
                    dueDate = request.DueDate?.ToString("yyyy-MM-dd"),
                    status = "open"
                }),
                cancellationToken);

            await transaction.CommitAsync(cancellationToken);
            return actionId;
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task<FormSubmissionUpdateResult> UpdateActionAsync(
        Guid actionId,
        UpdateActionRequest request,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        try
        {
            ActionEditInfo? action;
            await using (var command = new SqlCommand(
                """
                SELECT a.owner_staff_id, a.title, a.detail, a.due_date, a.completed_date, a.completion_note, a.source_record_id,
                       status_value.value_key
                FROM quality.actions a
                LEFT JOIN core.lookup_values status_value ON status_value.id = a.status_lookup_value_id
                WHERE a.id = @actionId AND a.archived_at IS NULL;
                """,
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@actionId", actionId);
                await using var reader = await command.ExecuteReaderAsync(cancellationToken);
                if (!await reader.ReadAsync(cancellationToken))
                {
                    return FormSubmissionUpdateResult.NotFound;
                }

                action = new ActionEditInfo(
                    reader.GetGuid(0),
                    reader.GetString(1),
                    GetStringOrNull(reader, 2),
                    GetDateOnlyOrNull(reader, 3),
                    GetDateOnlyOrNull(reader, 4),
                    GetStringOrNull(reader, 5),
                    GetGuidOrNull(reader, 6),
                    GetStringOrNull(reader, 7));
            }

            // The assigned owner can progress or complete their own action;
            // wider edits need actions.manage.
            var isOwner = currentUser.StaffId == action.OwnerStaffId;
            var canManage = currentUser.HasPermission(PermissionKeys.ActionsManage);
            if (!isOwner && !canManage)
            {
                await transaction.RollbackAsync(cancellationToken);
                return FormSubmissionUpdateResult.Forbidden;
            }

            var completing = string.Equals(request.Status, "complete", StringComparison.OrdinalIgnoreCase);
            var reopening = string.Equals(request.Status, "open", StringComparison.OrdinalIgnoreCase) && action.CompletedDate.HasValue;
            if (reopening && !canManage)
            {
                await transaction.RollbackAsync(cancellationToken);
                return FormSubmissionUpdateResult.Forbidden;
            }

            var newTitle = canManage && !string.IsNullOrWhiteSpace(request.Title) ? request.Title! : action.Title;
            var newDetail = canManage ? (request.Detail ?? action.Detail) : action.Detail;
            var newDueDate = canManage ? (request.DueDate ?? action.DueDate) : action.DueDate;

            await using (var command = new SqlCommand(
                """
                UPDATE quality.actions
                SET title = @title,
                    detail = @detail,
                    due_date = @dueDate,
                    completed_date = CASE
                        WHEN @completing = 1 THEN COALESCE(completed_date, CONVERT(date, sysutcdatetime()))
                        WHEN @reopening = 1 THEN NULL
                        ELSE completed_date END,
                    completed_by_user_account_id = CASE
                        WHEN @completing = 1 THEN COALESCE(completed_by_user_account_id, @userAccountId)
                        WHEN @reopening = 1 THEN NULL
                        ELSE completed_by_user_account_id END,
                    completion_note = CASE
                        WHEN @completionNote IS NOT NULL THEN @completionNote
                        WHEN @reopening = 1 THEN NULL
                        ELSE completion_note END,
                    status_lookup_value_id = CASE
                        WHEN @completing = 1 OR @reopening = 1 THEN
                            (SELECT TOP (1) lv.id
                             FROM core.lookup_values lv
                             JOIN core.lookup_types lt ON lt.id = lv.lookup_type_id
                             WHERE lt.lookup_key = 'action_status'
                               AND lv.value_key = CASE WHEN @completing = 1 THEN 'complete' ELSE 'open' END)
                        ELSE status_lookup_value_id END,
                    updated_by_user_account_id = @userAccountId,
                    updated_at = sysutcdatetime()
                WHERE id = @actionId;
                """,
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@actionId", actionId);
                command.Parameters.AddWithValue("@title", newTitle);
                command.Parameters.AddWithValue("@detail", ToDbValue(newDetail));
                command.Parameters.AddWithValue("@dueDate", ToDbValue(newDueDate));
                command.Parameters.AddWithValue("@completing", completing);
                command.Parameters.AddWithValue("@reopening", reopening);
                command.Parameters.AddWithValue("@completionNote", ToDbValue(request.CompletionNote));
                command.Parameters.AddWithValue("@userAccountId", ToDbValue(currentUser.UserAccountId));
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            var auditAction = completing ? "action.completed" : reopening ? "action.reopened" : "action.updated";
            await WriteAuditAsync(
                connection,
                transaction,
                currentUser.UserAccountId,
                action.SourceRecordId,
                "action",
                actionId,
                auditAction,
                $"Action '{newTitle}' {(completing ? "completed" : reopening ? "reopened" : "updated")} by {currentUser.DisplayName}.",
                JsonSerializer.Serialize(new
                {
                    title = action.Title,
                    detail = action.Detail,
                    dueDate = action.DueDate?.ToString("yyyy-MM-dd"),
                    completedDate = action.CompletedDate?.ToString("yyyy-MM-dd"),
                    completionNote = action.CompletionNote,
                    status = action.StatusKey
                }),
                JsonSerializer.Serialize(new
                {
                    title = newTitle,
                    detail = newDetail,
                    dueDate = newDueDate?.ToString("yyyy-MM-dd"),
                    completedDate = completing ? DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd") : reopening ? null : action.CompletedDate?.ToString("yyyy-MM-dd"),
                    completionNote = request.CompletionNote ?? (reopening ? null : action.CompletionNote),
                    status = completing ? "complete" : reopening ? "open" : action.StatusKey
                }),
                cancellationToken);

            await transaction.CommitAsync(cancellationToken);
            return FormSubmissionUpdateResult.Saved;
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public Task<IReadOnlyList<LivRecordSummary>> GetLivRecordsAsync(CurrentUser currentUser, CancellationToken cancellationToken)
    {
        var canViewAllLiv = currentUser.HasPermission(PermissionKeys.LivManage)
            || currentUser.HasPermission(PermissionKeys.ReportsViewAll);
        var canViewScopedLiv = currentUser.HasPermission(PermissionKeys.LivSubmit);
        var canManageLiv = currentUser.HasPermission(PermissionKeys.LivManage);

        return QueryAsync(
            """
            WITH scoped_org_units AS (
                SELECT org_unit_id
                FROM auth.access_scopes
                WHERE user_account_id = @currentUserAccountId
                  AND scope_type = 'assigned_org_units'
                  AND org_unit_id IS NOT NULL
                  AND is_active = 1
                  AND archived_at IS NULL
                UNION ALL
                SELECT child.id
                FROM org.org_units child
                JOIN scoped_org_units parent_scope ON parent_scope.org_unit_id = child.parent_org_unit_id
                WHERE child.archived_at IS NULL
            )
            SELECT
                liv.id,
                liv.record_id,
                liv.subject_staff_id,
                subject_staff.display_name,
                liv.reviewer_staff_id,
                reviewer_staff.display_name,
                liv.org_unit_id,
                org_unit.code,
                parent_org.code,
                liv.course_seen,
                liv.liv_date,
                CONVERT(nvarchar(5), liv.liv_time, 108) AS liv_time,
                liv.pre_conversation,
                liv.liv_overview,
                liv.post_conversation,
                liv.follow_up_projected_date,
                liv.second_liv_overview,
                liv.status,
                liv.created_at,
                liv.updated_at,
                CASE WHEN @canManageLiv = 1 OR liv.reviewer_staff_id = @currentStaffId THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS can_edit
            FROM quality.liv_records liv
            JOIN people.staff subject_staff ON subject_staff.id = liv.subject_staff_id
            LEFT JOIN people.staff reviewer_staff ON reviewer_staff.id = liv.reviewer_staff_id
            LEFT JOIN org.org_units org_unit ON org_unit.id = liv.org_unit_id
            LEFT JOIN org.org_units parent_org ON parent_org.id = org_unit.parent_org_unit_id
            WHERE liv.archived_at IS NULL
              AND (
                    @canViewAllLiv = 1
                    OR liv.subject_staff_id = @currentStaffId
                    OR liv.reviewer_staff_id = @currentStaffId
                    OR (
                        @canViewScopedLiv = 1
                        AND EXISTS (
                            SELECT 1 FROM scoped_org_units sou
                            WHERE sou.org_unit_id = liv.org_unit_id
                               OR sou.org_unit_id = subject_staff.primary_org_unit_id
                        )
                    )
              )
              AND (
                    liv.status <> 'draft'
                    OR liv.reviewer_staff_id = @currentStaffId
                    OR @canManageLiv = 1
              )
            ORDER BY liv.liv_date DESC, liv.created_at DESC;
            """,
            command =>
            {
                command.Parameters.AddWithValue("@currentUserAccountId", ToDbValue(currentUser.UserAccountId));
                command.Parameters.AddWithValue("@currentStaffId", ToDbValue(currentUser.StaffId));
                command.Parameters.AddWithValue("@canViewAllLiv", canViewAllLiv);
                command.Parameters.AddWithValue("@canViewScopedLiv", canViewScopedLiv);
                command.Parameters.AddWithValue("@canManageLiv", canManageLiv);
            },
            reader => new LivRecordSummary(
                reader.GetGuid(0),
                reader.GetGuid(1),
                reader.GetGuid(2),
                reader.GetString(3),
                GetGuidOrNull(reader, 4),
                GetStringOrNull(reader, 5),
                GetGuidOrNull(reader, 6),
                GetStringOrNull(reader, 7),
                GetStringOrNull(reader, 8),
                GetStringOrNull(reader, 9),
                GetDateOnlyOrNull(reader, 10),
                GetStringOrNull(reader, 11),
                GetStringOrNull(reader, 12),
                GetStringOrNull(reader, 13),
                GetStringOrNull(reader, 14),
                GetDateOnlyOrNull(reader, 15),
                GetStringOrNull(reader, 16),
                reader.GetString(17),
                reader.GetFieldValue<DateTimeOffset>(18),
                GetDateTimeOffsetOrNull(reader, 19),
                reader.GetBoolean(20)),
            cancellationToken);
    }

    public async Task<Guid> CreateLivRecordAsync(
        SaveLivRecordRequest request,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        try
        {
            var moduleId = await GetModuleIdAsync(connection, transaction, "liv", cancellationToken);
            var recordId = Guid.NewGuid();
            var livId = Guid.NewGuid();
            var status = request.SaveAsDraft ? "draft" : "open";

            await using (var command = new SqlCommand(
                """
                INSERT INTO core.records (id, module_id, record_type, title, subject_staff_id, owner_staff_id, org_unit_id, record_date, created_by_user_account_id)
                SELECT @id, @moduleId, 'liv', 'LIV - ' + s.display_name, @subjectStaffId, @ownerStaffId, @orgUnitId, @recordDate, @createdByUserAccountId
                FROM people.staff s
                WHERE s.id = @subjectStaffId AND s.archived_at IS NULL;
                """,
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@id", recordId);
                command.Parameters.AddWithValue("@moduleId", moduleId);
                command.Parameters.AddWithValue("@subjectStaffId", request.SubjectStaffId);
                command.Parameters.AddWithValue("@ownerStaffId", ToDbValue(currentUser.StaffId));
                command.Parameters.AddWithValue("@orgUnitId", ToDbValue(request.OrgUnitId));
                command.Parameters.AddWithValue("@recordDate", ToDbValue(request.LivDate));
                command.Parameters.AddWithValue("@createdByUserAccountId", ToDbValue(currentUser.UserAccountId));
                if (await command.ExecuteNonQueryAsync(cancellationToken) == 0)
                {
                    throw new WorkflowValidationException("The selected staff member was not found.");
                }
            }

            await using (var command = new SqlCommand(
                """
                INSERT INTO quality.liv_records (
                    id, record_id, subject_staff_id, reviewer_staff_id, org_unit_id, course_seen,
                    liv_date, liv_time, pre_conversation, liv_overview, post_conversation,
                    follow_up_projected_date, second_liv_overview, status, created_by_user_account_id)
                VALUES (
                    @id, @recordId, @subjectStaffId, @reviewerStaffId, @orgUnitId, @courseSeen,
                    @livDate, @livTime, @preConversation, @livOverview, @postConversation,
                    @followUpProjectedDate, @secondLivOverview, @status, @createdByUserAccountId);
                """,
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@id", livId);
                command.Parameters.AddWithValue("@recordId", recordId);
                AddLivParameters(command, request, currentUser);
                command.Parameters.AddWithValue("@status", status);
                command.Parameters.AddWithValue("@createdByUserAccountId", ToDbValue(currentUser.UserAccountId));
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            await WriteAuditAsync(
                connection,
                transaction,
                currentUser.UserAccountId,
                recordId,
                "liv_record",
                livId,
                request.SaveAsDraft ? "liv.draft_saved" : "liv.created",
                $"LIV record {(request.SaveAsDraft ? "saved as draft" : "created")} by {currentUser.DisplayName}.",
                null,
                SerializeLivSnapshot(request, status),
                cancellationToken);

            await transaction.CommitAsync(cancellationToken);
            return livId;
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task<FormSubmissionUpdateResult> UpdateLivRecordAsync(
        Guid livId,
        SaveLivRecordRequest request,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        try
        {
            var liv = await GetLivEditInfoAsync(connection, transaction, livId, cancellationToken);
            if (liv is null)
            {
                return FormSubmissionUpdateResult.NotFound;
            }

            var canManageLiv = currentUser.HasPermission(PermissionKeys.LivManage);
            var isReviewer = liv.ReviewerStaffId.HasValue && currentUser.StaffId == liv.ReviewerStaffId.Value;
            if (!canManageLiv && !(isReviewer && liv.Status != "closed"))
            {
                await transaction.RollbackAsync(cancellationToken);
                return FormSubmissionUpdateResult.Forbidden;
            }

            await using (var command = new SqlCommand(
                """
                UPDATE quality.liv_records
                SET subject_staff_id = @subjectStaffId,
                    org_unit_id = @orgUnitId,
                    course_seen = @courseSeen,
                    liv_date = @livDate,
                    liv_time = @livTime,
                    pre_conversation = @preConversation,
                    liv_overview = @livOverview,
                    post_conversation = @postConversation,
                    follow_up_projected_date = @followUpProjectedDate,
                    second_liv_overview = @secondLivOverview,
                    updated_by_user_account_id = @userAccountId,
                    updated_at = sysutcdatetime()
                WHERE id = @id;

                UPDATE r
                SET r.title = 'LIV - ' + s.display_name,
                    r.subject_staff_id = @subjectStaffId,
                    r.org_unit_id = @orgUnitId,
                    r.record_date = @livDate,
                    r.updated_by_user_account_id = @userAccountId,
                    r.updated_at = sysutcdatetime()
                FROM core.records r
                JOIN quality.liv_records liv ON liv.record_id = r.id
                JOIN people.staff s ON s.id = @subjectStaffId
                WHERE liv.id = @id;
                """,
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@id", livId);
                AddLivParameters(command, request, currentUser, includeReviewer: false);
                command.Parameters.AddWithValue("@userAccountId", ToDbValue(currentUser.UserAccountId));
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            await WriteAuditAsync(
                connection,
                transaction,
                currentUser.UserAccountId,
                liv.RecordId,
                "liv_record",
                livId,
                "liv.updated",
                $"LIV record updated by {currentUser.DisplayName}.",
                liv.SnapshotJson,
                SerializeLivSnapshot(request, liv.Status),
                cancellationToken);

            await transaction.CommitAsync(cancellationToken);
            return FormSubmissionUpdateResult.Saved;
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task<FormSubmissionUpdateResult> ChangeLivStatusAsync(
        Guid livId,
        string action,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        try
        {
            var liv = await GetLivEditInfoAsync(connection, transaction, livId, cancellationToken);
            if (liv is null)
            {
                return FormSubmissionUpdateResult.NotFound;
            }

            var canManageLiv = currentUser.HasPermission(PermissionKeys.LivManage);
            var isReviewer = liv.ReviewerStaffId.HasValue && currentUser.StaffId == liv.ReviewerStaffId.Value;

            var allowed = action switch
            {
                "submit" => isReviewer || canManageLiv,
                "close" => isReviewer || canManageLiv,
                "reopen" => canManageLiv,
                "archive" => canManageLiv,
                _ => false
            };
            if (!allowed)
            {
                await transaction.RollbackAsync(cancellationToken);
                return FormSubmissionUpdateResult.Forbidden;
            }

            var targetStatus = (liv.Status, action) switch
            {
                ("draft", "submit") => "open",
                ("open", "close") => "closed",
                ("closed", "reopen") => "open",
                (_, "archive") => liv.Status,
                _ => null
            };
            if (targetStatus is null)
            {
                throw new WorkflowValidationException($"A {liv.Status} LIV record cannot be changed with '{action}'.");
            }

            await using (var command = new SqlCommand(
                action == "archive"
                    ? """
                      UPDATE quality.liv_records
                      SET archived_at = sysutcdatetime(),
                          updated_by_user_account_id = @userAccountId,
                          updated_at = sysutcdatetime()
                      WHERE id = @id;

                      UPDATE core.records
                      SET archived_at = sysutcdatetime(),
                          updated_by_user_account_id = @userAccountId,
                          updated_at = sysutcdatetime()
                      WHERE id = @recordId;
                      """
                    : """
                      UPDATE quality.liv_records
                      SET status = @targetStatus,
                          updated_by_user_account_id = @userAccountId,
                          updated_at = sysutcdatetime()
                      WHERE id = @id;
                      """,
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@id", livId);
                command.Parameters.AddWithValue("@recordId", liv.RecordId);
                command.Parameters.AddWithValue("@targetStatus", targetStatus);
                command.Parameters.AddWithValue("@userAccountId", ToDbValue(currentUser.UserAccountId));
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            await WriteAuditAsync(
                connection,
                transaction,
                currentUser.UserAccountId,
                liv.RecordId,
                "liv_record",
                livId,
                $"liv.{action}",
                $"LIV record {action} by {currentUser.DisplayName}.",
                JsonSerializer.Serialize(new { status = liv.Status }),
                JsonSerializer.Serialize(new { status = action == "archive" ? "archived" : targetStatus }),
                cancellationToken);

            await transaction.CommitAsync(cancellationToken);
            return FormSubmissionUpdateResult.Saved;
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    private static void AddLivParameters(SqlCommand command, SaveLivRecordRequest request, CurrentUser currentUser, bool includeReviewer = true)
    {
        command.Parameters.AddWithValue("@subjectStaffId", request.SubjectStaffId);
        if (includeReviewer)
        {
            command.Parameters.AddWithValue("@reviewerStaffId", ToDbValue(currentUser.StaffId));
        }

        command.Parameters.AddWithValue("@orgUnitId", ToDbValue(request.OrgUnitId));
        command.Parameters.AddWithValue("@courseSeen", ToDbValue(request.CourseSeen));
        command.Parameters.AddWithValue("@livDate", ToDbValue(request.LivDate));
        command.Parameters.AddWithValue("@livTime", TimeOnly.TryParse(request.LivTime, out var livTime) ? livTime.ToTimeSpan() : DBNull.Value);
        command.Parameters.AddWithValue("@preConversation", ToDbValue(request.PreConversation));
        command.Parameters.AddWithValue("@livOverview", ToDbValue(request.LivOverview));
        command.Parameters.AddWithValue("@postConversation", ToDbValue(request.PostConversation));
        command.Parameters.AddWithValue("@followUpProjectedDate", ToDbValue(request.FollowUpProjectedDate));
        command.Parameters.AddWithValue("@secondLivOverview", ToDbValue(request.SecondLivOverview));
    }

    private static string SerializeLivSnapshot(SaveLivRecordRequest request, string status) =>
        JsonSerializer.Serialize(new
        {
            subjectStaffId = request.SubjectStaffId,
            orgUnitId = request.OrgUnitId,
            courseSeen = request.CourseSeen,
            livDate = request.LivDate?.ToString("yyyy-MM-dd"),
            livTime = request.LivTime,
            preConversation = request.PreConversation,
            livOverview = request.LivOverview,
            postConversation = request.PostConversation,
            followUpProjectedDate = request.FollowUpProjectedDate?.ToString("yyyy-MM-dd"),
            secondLivOverview = request.SecondLivOverview,
            status
        });

    private static async Task<LivEditInfo?> GetLivEditInfoAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        Guid livId,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            """
            SELECT record_id, reviewer_staff_id, status,
                   (SELECT liv.subject_staff_id AS subjectStaffId,
                           liv.org_unit_id AS orgUnitId,
                           liv.course_seen AS courseSeen,
                           CONVERT(nvarchar(10), liv.liv_date, 23) AS livDate,
                           CONVERT(nvarchar(5), liv.liv_time, 108) AS livTime,
                           liv.pre_conversation AS preConversation,
                           liv.liv_overview AS livOverview,
                           liv.post_conversation AS postConversation,
                           CONVERT(nvarchar(10), liv.follow_up_projected_date, 23) AS followUpProjectedDate,
                           liv.second_liv_overview AS secondLivOverview,
                           liv.status
                    FROM quality.liv_records liv
                    WHERE liv.id = @id
                    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS snapshot_json
            FROM quality.liv_records
            WHERE id = @id AND archived_at IS NULL;
            """,
            connection,
            (SqlTransaction)transaction);

        command.Parameters.AddWithValue("@id", livId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        return new LivEditInfo(
            reader.GetGuid(0),
            GetGuidOrNull(reader, 1),
            reader.GetString(2),
            GetStringOrNull(reader, 3));
    }

    public async Task<Guid> CreateFormTemplateAsync(
        CreateFormTemplateRequest request,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        try
        {
            await ValidateWorkScrutinyTemplateOrgUnitAsync(
                connection,
                transaction,
                request.OrgUnitId,
                cancellationToken);
            var moduleId = await GetModuleIdAsync(connection, transaction, request.ModuleKey, cancellationToken);
            var templateId = Guid.NewGuid();
            var versionId = Guid.NewGuid();
            var templateKey = $"work_scrutiny_{Slugify(request.Name)}_{DateTimeOffset.UtcNow:yyyyMMddHHmmss}";

            await using (var command = new SqlCommand(
                """
                INSERT INTO forms.form_templates (id, module_id, template_key, name, description, is_active)
                VALUES (@id, @moduleId, @templateKey, @name, @description, 1);
                """,
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@id", templateId);
                command.Parameters.AddWithValue("@moduleId", moduleId);
                command.Parameters.AddWithValue("@templateKey", templateKey);
                command.Parameters.AddWithValue("@name", request.Name);
                command.Parameters.AddWithValue("@description", ToDbValue(request.Description));
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            await using (var command = new SqlCommand(
                """
                INSERT INTO forms.form_template_versions (id, form_template_id, version_label, is_published, created_by_user_account_id)
                VALUES (@id, @formTemplateId, '0.1', 0, @createdByUserAccountId);
                """,
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@id", versionId);
                command.Parameters.AddWithValue("@formTemplateId", templateId);
                command.Parameters.AddWithValue("@createdByUserAccountId", ToDbValue(currentUser.UserAccountId));
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            await using (var command = new SqlCommand(
                """
                INSERT INTO forms.form_template_org_units (form_template_id, org_unit_id)
                VALUES (@formTemplateId, @orgUnitId);
                """,
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@formTemplateId", templateId);
                command.Parameters.AddWithValue("@orgUnitId", request.OrgUnitId!.Value);
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            await transaction.CommitAsync(cancellationToken);
            return templateId;
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task<bool> ArchiveFormTemplateAsync(Guid id, CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var command = new SqlCommand(
            """
            UPDATE ft
            SET archived_at = sysutcdatetime(),
                is_active = 0
            FROM forms.form_templates ft
            JOIN core.modules m ON m.id = ft.module_id
            WHERE ft.id = @id
              AND ft.archived_at IS NULL
              AND m.module_key = 'work_scrutiny';
            """,
            connection);

        command.Parameters.AddWithValue("@id", id);
        return await command.ExecuteNonQueryAsync(cancellationToken) > 0;
    }

    public async Task<SubmittedFormResult> SubmitFormAsync(
        SubmitFormRequest request,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        try
        {
            var template = await GetLatestTemplateVersionAsync(connection, transaction, request.TemplateKey, cancellationToken);
            var fields = await GetFieldInfoAsync(connection, transaction, template.VersionId, cancellationToken);

            if (string.Equals(request.RecordType, "work_scrutiny", StringComparison.OrdinalIgnoreCase))
            {
                if (request.SaveAsDraft)
                {
                    throw new WorkflowValidationException("Work Scrutiny records are completed in one submission and cannot be saved as drafts.");
                }

                await ValidateWorkScrutinySubmissionAsync(
                    connection,
                    transaction,
                    template,
                    request,
                    currentUser,
                    cancellationToken);
            }

            if (!request.SaveAsDraft)
            {
                ValidateRequiredFields(fields, request.Responses);
            }

            var status = request.SaveAsDraft ? SubmissionLifecycle.Draft : SubmissionLifecycle.Submitted;
            var recordId = Guid.NewGuid();
            var submissionId = Guid.NewGuid();

            await using (var command = new SqlCommand(
                """
                INSERT INTO core.records (
                    id,
                    module_id,
                    record_type,
                    title,
                    summary,
                    subject_staff_id,
                    owner_staff_id,
                    org_unit_id,
                    record_date,
                    created_by_user_account_id
                )
                VALUES (
                    @id,
                    @moduleId,
                    @recordType,
                    @title,
                    @summary,
                    @subjectStaffId,
                    @ownerStaffId,
                    CASE
                        WHEN @recordType = 'elevate_environment' AND @orgUnitId IS NULL
                            THEN (SELECT primary_org_unit_id FROM people.staff WHERE id = @ownerStaffId)
                        ELSE @orgUnitId
                    END,
                    @recordDate,
                    @createdByUserAccountId
                );
                """,
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@id", recordId);
                command.Parameters.AddWithValue("@moduleId", template.ModuleId);
                command.Parameters.AddWithValue("@recordType", request.RecordType);
                command.Parameters.AddWithValue("@title", request.Title);
                command.Parameters.AddWithValue("@summary", ToDbValue(request.Summary));
                command.Parameters.AddWithValue("@subjectStaffId", ToDbValue(request.SubjectStaffId));
                command.Parameters.AddWithValue("@ownerStaffId", ToDbValue(currentUser.StaffId));
                command.Parameters.AddWithValue("@orgUnitId", ToDbValue(request.OrgUnitId));
                command.Parameters.AddWithValue("@recordDate", ToDbValue(request.RecordDate));
                command.Parameters.AddWithValue("@createdByUserAccountId", ToDbValue(currentUser.UserAccountId));
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            await using (var command = new SqlCommand(
                """
                INSERT INTO forms.form_submissions (
                    id,
                    record_id,
                    form_template_version_id,
                    submitted_by_user_account_id,
                    submitted_at,
                    status
                )
                VALUES (
                    @id,
                    @recordId,
                    @formTemplateVersionId,
                    @submittedByUserAccountId,
                    @submittedAt,
                    @status
                );
                """,
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@id", submissionId);
                command.Parameters.AddWithValue("@recordId", recordId);
                command.Parameters.AddWithValue("@formTemplateVersionId", template.VersionId);
                command.Parameters.AddWithValue("@submittedByUserAccountId", ToDbValue(currentUser.UserAccountId));
                command.Parameters.AddWithValue("@submittedAt", request.SaveAsDraft ? DBNull.Value : DateTimeOffset.UtcNow);
                command.Parameters.AddWithValue("@status", status);
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            foreach (var response in request.Responses.Where(response => !string.IsNullOrWhiteSpace(response.Value)))
            {
                if (!fields.TryGetValue(response.FieldId, out var field))
                {
                    continue;
                }

                await InsertFormResponseAsync(connection, transaction, submissionId, response, field.FieldType, cancellationToken);
            }

            if (!request.SaveAsDraft)
            {
                var valuesByFieldKey = MapResponsesByFieldKey(fields, request.Responses);
                await ApplyModuleSideEffectsAsync(connection, transaction, recordId, request.RecordType, request.OrgUnitId, request.RecordDate, request.SubjectStaffId, valuesByFieldKey, currentUser, cancellationToken);

                if (string.Equals(request.RecordType, "work_scrutiny", StringComparison.OrdinalIgnoreCase))
                {
                    await SyncWorkScrutinyCourseSamplesAsync(
                        connection,
                        transaction,
                        recordId,
                        request.OrgUnitId!.Value,
                        request.CourseIds!,
                        cancellationToken);
                    await CreateSubmissionActionsAsync(
                        connection,
                        transaction,
                        recordId,
                        request.Actions ?? [],
                        currentUser,
                        cancellationToken);
                }
            }

            await WriteAuditAsync(
                connection,
                transaction,
                currentUser.UserAccountId,
                recordId,
                "form_submission",
                submissionId,
                request.SaveAsDraft ? "record.draft_saved" : "record.submitted",
                $"{request.RecordType} '{request.Title}' {(request.SaveAsDraft ? "saved as draft" : "submitted")} by {currentUser.DisplayName}.",
                null,
                SerializeSubmissionSnapshot(request.Title, request.Summary, request.OrgUnitId, request.RecordDate, status, MapResponsesByFieldKey(fields, request.Responses)),
                cancellationToken);

            await transaction.CommitAsync(cancellationToken);
            return new SubmittedFormResult(submissionId, recordId);
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task<FormSubmissionUpdateResult> UpdateFormSubmissionAsync(
        Guid submissionId,
        UpdateFormSubmissionRequest request,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        try
        {
            var submission = await GetSubmissionEditInfoAsync(connection, transaction, submissionId, cancellationToken);
            if (submission is null)
            {
                return FormSubmissionUpdateResult.NotFound;
            }

            var isOwner = submission.OwnerStaffId.HasValue && currentUser.StaffId == submission.OwnerStaffId.Value;
            var canManageForms = currentUser.HasPermission(PermissionKeys.FormsManage);
            if (!SubmissionLifecycle.CanEditResponses(submission.Status, isOwner, canManageForms))
            {
                await transaction.RollbackAsync(cancellationToken);
                return FormSubmissionUpdateResult.Forbidden;
            }

            var fields = await GetFieldInfoAsync(connection, transaction, submission.VersionId, cancellationToken);

            // A record that is already submitted must stay complete when edited.
            if (submission.Status == SubmissionLifecycle.Submitted)
            {
                ValidateRequiredFields(fields, request.Responses);
            }

            var beforeResponses = await GetResponsesByFieldKeyAsync(connection, transaction, submissionId, cancellationToken);
            var beforeJson = SerializeSubmissionSnapshot(
                submission.Title, submission.Summary, submission.OrgUnitId, submission.RecordDate, submission.Status, beforeResponses);

            await using (var command = new SqlCommand(
                """
                UPDATE core.records
                SET title = @title,
                    summary = @summary,
                    subject_staff_id = @subjectStaffId,
                    org_unit_id = CASE
                        WHEN record_type = 'elevate_environment' AND @orgUnitId IS NULL
                            THEN (SELECT primary_org_unit_id FROM people.staff WHERE id = owner_staff_id)
                        ELSE @orgUnitId
                    END,
                    record_date = @recordDate,
                    updated_by_user_account_id = @updatedByUserAccountId,
                    updated_at = sysutcdatetime()
                WHERE id = @recordId;

                UPDATE forms.form_submissions
                SET updated_at = sysutcdatetime()
                WHERE id = @submissionId;
                """,
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@recordId", submission.RecordId);
                command.Parameters.AddWithValue("@submissionId", submissionId);
                command.Parameters.AddWithValue("@title", request.Title);
                command.Parameters.AddWithValue("@summary", ToDbValue(request.Summary));
                command.Parameters.AddWithValue("@subjectStaffId", ToDbValue(request.SubjectStaffId));
                command.Parameters.AddWithValue("@orgUnitId", ToDbValue(request.OrgUnitId));
                command.Parameters.AddWithValue("@recordDate", ToDbValue(request.RecordDate));
                command.Parameters.AddWithValue("@updatedByUserAccountId", ToDbValue(currentUser.UserAccountId));
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            foreach (var response in request.Responses)
            {
                if (!fields.TryGetValue(response.FieldId, out var field))
                {
                    continue;
                }

                await UpsertFormResponseAsync(connection, transaction, submissionId, response, field.FieldType, cancellationToken);
            }

            var valuesByFieldKey = MapResponsesByFieldKey(fields, request.Responses);
            await ApplyModuleSideEffectsAsync(connection, transaction, submission.RecordId, submission.RecordType, request.OrgUnitId, request.RecordDate, request.SubjectStaffId, valuesByFieldKey, currentUser, cancellationToken);

            await WriteAuditAsync(
                connection,
                transaction,
                currentUser.UserAccountId,
                submission.RecordId,
                "form_submission",
                submissionId,
                "record.updated",
                $"{submission.RecordType} '{request.Title}' updated by {currentUser.DisplayName}.",
                beforeJson,
                SerializeSubmissionSnapshot(request.Title, request.Summary, request.OrgUnitId, request.RecordDate, submission.Status, valuesByFieldKey),
                cancellationToken);

            await transaction.CommitAsync(cancellationToken);
            return FormSubmissionUpdateResult.Saved;
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task<FormSubmissionUpdateResult> ChangeFormSubmissionStatusAsync(
        Guid submissionId,
        string action,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        try
        {
            var submission = await GetSubmissionEditInfoAsync(connection, transaction, submissionId, cancellationToken);
            if (submission is null)
            {
                return FormSubmissionUpdateResult.NotFound;
            }

            var isOwner = submission.OwnerStaffId.HasValue && currentUser.StaffId == submission.OwnerStaffId.Value;
            var canManageForms = currentUser.HasPermission(PermissionKeys.FormsManage);
            if (!SubmissionLifecycle.CanPerform(action, isOwner, canManageForms))
            {
                await transaction.RollbackAsync(cancellationToken);
                return FormSubmissionUpdateResult.Forbidden;
            }

            var targetStatus = SubmissionLifecycle.GetTargetStatus(submission.Status, action);
            if (targetStatus is null)
            {
                throw new WorkflowValidationException(
                    $"A {submission.Status} record cannot be {(action == SubmissionLifecycle.ActionSubmit ? "submitted" : action + "ed")}.");
            }

            if (action == SubmissionLifecycle.ActionSubmit)
            {
                var fields = await GetFieldInfoAsync(connection, transaction, submission.VersionId, cancellationToken);
                var stored = await GetResponsesByFieldKeyAsync(connection, transaction, submissionId, cancellationToken);
                var missing = fields.Values
                    .Where(field => field.IsRequired && !stored.ContainsKey(field.FieldKey))
                    .Select(field => field.Label)
                    .ToArray();
                if (missing.Length > 0)
                {
                    throw new WorkflowValidationException(
                        $"Complete the required fields before submitting: {string.Join(", ", missing)}.");
                }
            }

            await using (var command = new SqlCommand(
                action == SubmissionLifecycle.ActionArchive
                    ? """
                      UPDATE core.records
                      SET archived_at = sysutcdatetime(),
                          updated_by_user_account_id = @userAccountId,
                          updated_at = sysutcdatetime()
                      WHERE id = @recordId;
                      """
                    : """
                      UPDATE forms.form_submissions
                      SET status = @targetStatus,
                          submitted_at = CASE WHEN @targetStatus = 'submitted' THEN COALESCE(submitted_at, sysutcdatetime()) ELSE submitted_at END,
                          submitted_by_user_account_id = CASE WHEN @targetStatus = 'submitted' THEN COALESCE(submitted_by_user_account_id, @userAccountId) ELSE submitted_by_user_account_id END,
                          updated_at = sysutcdatetime()
                      WHERE id = @submissionId;

                      UPDATE core.records
                      SET updated_by_user_account_id = @userAccountId,
                          updated_at = sysutcdatetime()
                      WHERE id = @recordId;
                      """,
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@submissionId", submissionId);
                command.Parameters.AddWithValue("@recordId", submission.RecordId);
                command.Parameters.AddWithValue("@targetStatus", targetStatus);
                command.Parameters.AddWithValue("@userAccountId", ToDbValue(currentUser.UserAccountId));
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            await WriteAuditAsync(
                connection,
                transaction,
                currentUser.UserAccountId,
                submission.RecordId,
                "form_submission",
                submissionId,
                $"record.{action}",
                $"{submission.RecordType} '{submission.Title}' {action} by {currentUser.DisplayName}.",
                JsonSerializer.Serialize(new { status = submission.Status }),
                JsonSerializer.Serialize(new { status = action == SubmissionLifecycle.ActionArchive ? "archived" : targetStatus }),
                cancellationToken);

            await transaction.CommitAsync(cancellationToken);
            return FormSubmissionUpdateResult.Saved;
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    /// <summary>
    /// True when the staff member sits inside the current user's assigned
    /// org-unit scopes (including child units) or reports to them directly.
    /// Mirrors the visibility rules used by GetStaffAsync.
    /// </summary>
    public async Task<bool> IsStaffProfileInScopeAsync(
        Guid staffId,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        var rows = await QueryAsync(
            """
            WITH scoped_org_units AS (
                SELECT org_unit_id
                FROM auth.access_scopes
                WHERE user_account_id = @currentUserAccountId
                  AND scope_type = 'assigned_org_units'
                  AND org_unit_id IS NOT NULL
                  AND is_active = 1
                  AND archived_at IS NULL
                UNION ALL
                SELECT child.id
                FROM org.org_units child
                JOIN scoped_org_units parent_scope ON parent_scope.org_unit_id = child.parent_org_unit_id
                WHERE child.archived_at IS NULL
            )
            SELECT 1
            FROM people.staff s
            WHERE s.id = @staffId
              AND s.archived_at IS NULL
              AND (
                    s.id = @currentStaffId
                    OR s.line_manager_staff_id = @currentStaffId
                    OR EXISTS (SELECT 1 FROM scoped_org_units sou WHERE sou.org_unit_id = s.primary_org_unit_id)
                    OR EXISTS (
                        SELECT 1
                        FROM org.staff_org_memberships som
                        JOIN scoped_org_units sou ON sou.org_unit_id = som.org_unit_id
                        WHERE som.staff_id = s.id
                          AND som.archived_at IS NULL
                    )
              );
            """,
            command =>
            {
                command.Parameters.AddWithValue("@staffId", staffId);
                command.Parameters.AddWithValue("@currentUserAccountId", ToDbValue(currentUser.UserAccountId));
                command.Parameters.AddWithValue("@currentStaffId", ToDbValue(currentUser.StaffId));
            },
            reader => reader.GetInt32(0),
            cancellationToken);

        return rows.Count > 0;
    }

    public Task<IReadOnlyList<StaffProfileRecordSummary>> GetStaffProfileRecordsAsync(
        CurrentUser currentUser,
        CancellationToken cancellationToken) =>
        QueryAsync(
            """
            WITH scoped_org_units AS (
                SELECT org_unit_id
                FROM auth.access_scopes
                WHERE user_account_id = @currentUserAccountId
                  AND scope_type = 'assigned_org_units'
                  AND org_unit_id IS NOT NULL
                  AND is_active = 1
                  AND archived_at IS NULL
                UNION ALL
                SELECT child.id
                FROM org.org_units child
                JOIN scoped_org_units parent_scope ON parent_scope.org_unit_id = child.parent_org_unit_id
                WHERE child.archived_at IS NULL
            )
            SELECT
                s.id,
                s.external_id,
                s.display_name,
                s.email,
                s.job_title,
                ou.code,
                s.account_status,
                (SELECT COUNT(*)
                 FROM quality.reflection_points rp
                 WHERE rp.archived_at IS NULL AND rp.is_active = 1) AS reflection_point_count,
                (SELECT COUNT(*)
                 FROM quality.reflection_points rp
                 WHERE rp.archived_at IS NULL
                   AND rp.is_active = 1
                   AND EXISTS (
                       SELECT 1
                       FROM evidence.evidence_items ev
                       WHERE ev.staff_id = s.id
                         AND ev.milestone_lookup_value_id = rp.milestone_lookup_value_id
                         AND ev.pillar_or_theme = 'reflection'
                         AND ev.archived_at IS NULL
                   )) AS completed_reflections,
                (SELECT COUNT(*)
                 FROM quality.reflection_points rp
                 WHERE rp.archived_at IS NULL
                   AND rp.is_active = 1
                   AND rp.due_date < CONVERT(date, sysutcdatetime())
                   AND NOT EXISTS (
                       SELECT 1
                       FROM evidence.evidence_items ev
                       WHERE ev.staff_id = s.id
                         AND ev.milestone_lookup_value_id = rp.milestone_lookup_value_id
                         AND ev.pillar_or_theme = 'reflection'
                         AND ev.archived_at IS NULL
                   )) AS overdue_reflections,
                (SELECT COUNT(*)
                 FROM quality.actions a
                 WHERE (a.subject_staff_id = s.id OR a.owner_staff_id = s.id)
                   AND a.archived_at IS NULL
                   AND a.completed_date IS NULL) AS open_actions
            FROM people.staff s
            LEFT JOIN org.org_units ou ON ou.id = s.primary_org_unit_id
            WHERE s.archived_at IS NULL
              AND (
                    @canViewAll = 1
                    OR s.id = @currentStaffId
                    OR (
                        @canViewScoped = 1
                        AND (
                            s.line_manager_staff_id = @currentStaffId
                            OR EXISTS (SELECT 1 FROM scoped_org_units sou WHERE sou.org_unit_id = s.primary_org_unit_id)
                            OR EXISTS (
                                SELECT 1
                                FROM org.staff_org_memberships som
                                JOIN scoped_org_units sou ON sou.org_unit_id = som.org_unit_id
                                WHERE som.staff_id = s.id
                                  AND som.archived_at IS NULL
                            )
                        )
                    )
              )
            ORDER BY s.display_name;
            """,
            command =>
            {
                command.Parameters.AddWithValue("@canViewAll", CanViewAllStaffProfiles(currentUser));
                command.Parameters.AddWithValue("@canViewScoped", currentUser.HasPermission(PermissionKeys.ReportsViewScoped));
                command.Parameters.AddWithValue("@currentUserAccountId", ToDbValue(currentUser.UserAccountId));
                command.Parameters.AddWithValue("@currentStaffId", ToDbValue(currentUser.StaffId));
            },
            reader => new StaffProfileRecordSummary(
                reader.GetGuid(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.GetString(3),
                GetStringOrNull(reader, 4),
                GetStringOrNull(reader, 5),
                reader.GetString(6),
                reader.GetInt32(7),
                reader.GetInt32(8),
                reader.GetInt32(9),
                reader.GetInt32(10)),
            cancellationToken);

    public async Task<StaffProfileDetail?> GetStaffProfileDetailAsync(
        Guid staffId,
        CancellationToken cancellationToken)
    {
        var headers = await QueryAsync(
            """
            SELECT
                s.id,
                s.external_id,
                s.display_name,
                s.email,
                ou.code,
                s.account_status,
                (SELECT COUNT(*)
                 FROM evidence.evidence_items ev
                 WHERE ev.staff_id = s.id
                   AND ev.archived_at IS NULL
                   AND (ev.pillar_or_theme IS NULL OR ev.pillar_or_theme <> 'reflection')) AS evidence_submitted,
                (SELECT COUNT(DISTINCT ev.milestone_lookup_value_id)
                 FROM evidence.evidence_items ev
                 WHERE ev.staff_id = s.id
                   AND ev.archived_at IS NULL
                   AND ev.milestone_lookup_value_id IS NOT NULL) AS milestones_completed
            FROM people.staff s
            LEFT JOIN org.org_units ou ON ou.id = s.primary_org_unit_id
            WHERE s.id = @staffId
              AND s.archived_at IS NULL;
            """,
            command => command.Parameters.AddWithValue("@staffId", staffId),
            reader => new StaffProfileHeaderRow(
                reader.GetGuid(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.GetString(3),
                GetStringOrNull(reader, 4),
                reader.GetString(5),
                reader.GetInt32(6),
                reader.GetInt32(7)),
            cancellationToken);

        if (headers.Count == 0)
        {
            return null;
        }

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var reflections = await QueryAsync(
            """
            SELECT
                rp.point_key,
                rp.name,
                rp.due_date,
                ev.id,
                ev.impact_summary,
                ev.evidence_date,
                COALESCE(ev.updated_at, ev.created_at) AS last_saved_at
            FROM quality.reflection_points rp
            LEFT JOIN evidence.evidence_items ev ON ev.milestone_lookup_value_id = rp.milestone_lookup_value_id
                AND ev.staff_id = @staffId
                AND ev.pillar_or_theme = 'reflection'
                AND ev.archived_at IS NULL
            WHERE rp.archived_at IS NULL
              AND rp.is_active = 1
            ORDER BY rp.display_order;
            """,
            command => command.Parameters.AddWithValue("@staffId", staffId),
            reader =>
            {
                var dueDate = DateOnly.FromDateTime(reader.GetDateTime(2));
                var evidenceItemId = GetGuidOrNull(reader, 3);
                var status = evidenceItemId.HasValue
                    ? "completed"
                    : dueDate < today
                        ? "overdue"
                        : "not_yet_due";
                return new StaffReflectionSummary(
                    reader.GetString(0),
                    reader.GetString(1),
                    dueDate,
                    status,
                    evidenceItemId,
                    GetStringOrNull(reader, 4),
                    GetDateOnlyOrNull(reader, 5),
                    GetDateTimeOffsetOrNull(reader, 6));
            },
            cancellationToken);

        var cpdRecords = await QueryAsync(
            """
            SELECT ce.id, ce.event_title, ce.event_date, themes.response_text
            FROM cpd.cpd_attendance ca
            JOIN cpd.cpd_events ce ON ce.id = ca.cpd_event_id
                AND ce.archived_at IS NULL
            OUTER APPLY (
                SELECT TOP (1) fr.response_text
                FROM forms.form_submissions fsub
                JOIN forms.form_responses fr ON fr.form_submission_id = fsub.id
                    AND fr.archived_at IS NULL
                JOIN forms.form_fields ff ON ff.id = fr.form_field_id
                    AND ff.field_key = 'cpd_themes'
                WHERE fsub.record_id = ce.record_id
                  AND fsub.archived_at IS NULL
            ) themes
            WHERE ca.staff_id = @staffId
              AND ca.archived_at IS NULL
              AND ca.attendance_status = 'Attended'
            ORDER BY ce.event_date DESC;
            """,
            command => command.Parameters.AddWithValue("@staffId", staffId),
            reader => new StaffCpdRecordSummary(
                reader.GetGuid(0),
                reader.GetString(1),
                DateOnly.FromDateTime(reader.GetDateTime(2)),
                GetStringOrNull(reader, 3)),
            cancellationToken);

        var actions = await QueryAsync(
            """
            SELECT
                a.id,
                a.title,
                a.detail,
                a.created_at,
                a.source_record_id,
                r.title,
                r.record_type,
                module.name,
                owner.display_name,
                status_value.value_key,
                a.due_date,
                a.completed_date
            FROM quality.actions a
            JOIN people.staff owner ON owner.id = a.owner_staff_id
            LEFT JOIN core.records r ON r.id = a.source_record_id
            LEFT JOIN core.modules module ON module.id = r.module_id
            LEFT JOIN core.lookup_values status_value ON status_value.id = a.status_lookup_value_id
            WHERE (a.subject_staff_id = @staffId OR a.owner_staff_id = @staffId)
              AND a.archived_at IS NULL
            ORDER BY
                CASE WHEN a.completed_date IS NULL THEN 0 ELSE 1 END,
                a.due_date,
                a.created_at DESC;
            """,
            command => command.Parameters.AddWithValue("@staffId", staffId),
            reader =>
            {
                var dueDate = GetDateOnlyOrNull(reader, 10);
                var completedDate = GetDateOnlyOrNull(reader, 11);
                return new StaffProfileActionSummary(
                    reader.GetGuid(0),
                    reader.GetString(1),
                    GetStringOrNull(reader, 2),
                    reader.GetFieldValue<DateTimeOffset>(3),
                    GetGuidOrNull(reader, 4),
                    GetStringOrNull(reader, 5),
                    GetStringOrNull(reader, 6),
                    GetStringOrNull(reader, 7),
                    reader.GetString(8),
                    GetStringOrNull(reader, 9),
                    dueDate,
                    completedDate,
                    dueDate.HasValue && completedDate is null && dueDate.Value < today);
            },
            cancellationToken);

        var coachingRecords = await QueryAsync(
            """
            SELECT
                session.id,
                session.record_id,
                cycle.cycle_number,
                session.session_number,
                session.session_date,
                session.session_type,
                session.status,
                coach.display_name,
                session.main_focus,
                session.key_takeaway
            FROM quality.coaching_sessions session
            JOIN quality.coaching_cycles cycle ON cycle.id = session.cycle_id
            JOIN people.staff coach ON coach.id = session.coach_staff_id
            WHERE session.staff_id = @staffId
              AND session.archived_at IS NULL
              AND cycle.archived_at IS NULL
            ORDER BY session.session_date DESC, cycle.cycle_number DESC, session.session_number DESC;
            """,
            command => command.Parameters.AddWithValue("@staffId", staffId),
            reader => new StaffProfileCoachingSummary(
                reader.GetGuid(0),
                reader.GetGuid(1),
                reader.GetInt32(2),
                reader.GetInt32(3),
                DateOnly.FromDateTime(reader.GetDateTime(4)),
                reader.GetString(5),
                reader.GetString(6),
                reader.GetString(7),
                GetStringOrNull(reader, 8),
                GetStringOrNull(reader, 9)),
            cancellationToken);

        var header = headers[0];
        var elevatePractice = await GetElevatePracticeProfileSummaryAsync(staffId, cancellationToken);
        return new StaffProfileDetail(
            header.StaffId,
            header.ExternalId,
            header.DisplayName,
            header.Email,
            header.PrimaryOrgCode,
            header.AccountStatus,
            header.EvidenceSubmitted,
            header.MilestonesCompleted,
            reflections,
            cpdRecords,
            actions,
            coachingRecords,
            elevatePractice);
    }

    public async Task<FormSubmissionUpdateResult> SaveStaffReflectionAsync(
        Guid staffId,
        string pointKey,
        string? text,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        // Staff write their own reflections; staff.manage covers audited admin corrections.
        var canEdit = (currentUser.StaffId.HasValue && currentUser.StaffId.Value == staffId)
            || currentUser.HasPermission(PermissionKeys.StaffManage);
        if (!canEdit)
        {
            return FormSubmissionUpdateResult.Forbidden;
        }

        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        try
        {
            ReflectionPointInfo? point;
            await using (var command = new SqlCommand(
                """
                SELECT TOP (1) rp.id, rp.name, rp.milestone_lookup_value_id
                FROM quality.reflection_points rp
                WHERE rp.point_key = @pointKey
                  AND rp.archived_at IS NULL
                  AND rp.is_active = 1;
                """,
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@pointKey", pointKey);
                await using var reader = await command.ExecuteReaderAsync(cancellationToken);
                point = await reader.ReadAsync(cancellationToken)
                    ? new ReflectionPointInfo(reader.GetGuid(0), reader.GetString(1), reader.GetGuid(2))
                    : null;
            }

            if (point is null)
            {
                return FormSubmissionUpdateResult.NotFound;
            }

            await using (var command = new SqlCommand(
                "SELECT COUNT(*) FROM people.staff WHERE id = @staffId AND archived_at IS NULL;",
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@staffId", staffId);
                if (Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken)) == 0)
                {
                    return FormSubmissionUpdateResult.NotFound;
                }
            }

            ReflectionEvidenceInfo? existing = null;
            await using (var command = new SqlCommand(
                """
                SELECT TOP (1) id, impact_summary, evidence_date
                FROM evidence.evidence_items
                WHERE staff_id = @staffId
                  AND milestone_lookup_value_id = @milestoneLookupValueId
                  AND pillar_or_theme = 'reflection'
                  AND archived_at IS NULL
                ORDER BY created_at DESC;
                """,
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@staffId", staffId);
                command.Parameters.AddWithValue("@milestoneLookupValueId", point.MilestoneLookupValueId);
                await using var reader = await command.ExecuteReaderAsync(cancellationToken);
                if (await reader.ReadAsync(cancellationToken))
                {
                    existing = new ReflectionEvidenceInfo(
                        reader.GetGuid(0),
                        GetStringOrNull(reader, 1),
                        DateOnly.FromDateTime(reader.GetDateTime(2)));
                }
            }

            var trimmedText = text?.Trim();
            var beforeJson = existing is null
                ? null
                : JsonSerializer.Serialize(new
                {
                    text = existing.Text,
                    completionDate = existing.CompletionDate.ToString("yyyy-MM-dd")
                });

            if (string.IsNullOrWhiteSpace(trimmedText))
            {
                if (existing is null)
                {
                    await transaction.CommitAsync(cancellationToken);
                    return FormSubmissionUpdateResult.Saved;
                }

                await using (var command = new SqlCommand(
                    """
                    UPDATE evidence.evidence_items
                    SET archived_at = sysutcdatetime(),
                        updated_at = sysutcdatetime()
                    WHERE id = @id;
                    """,
                    connection,
                    (SqlTransaction)transaction))
                {
                    command.Parameters.AddWithValue("@id", existing.Id);
                    await command.ExecuteNonQueryAsync(cancellationToken);
                }

                await WriteAuditAsync(
                    connection,
                    transaction,
                    currentUser.UserAccountId,
                    null,
                    "evidence_item",
                    existing.Id,
                    "staff_profile.reflection_cleared",
                    $"{point.Name} reflection cleared by {currentUser.DisplayName}.",
                    beforeJson,
                    null,
                    cancellationToken);
            }
            else if (existing is null)
            {
                var evidenceItemId = Guid.NewGuid();
                await using (var command = new SqlCommand(
                    """
                    INSERT INTO evidence.evidence_items (
                        id, staff_id, milestone_lookup_value_id, evidence_date,
                        pillar_or_theme, impact_summary, created_by_user_account_id)
                    VALUES (
                        @id, @staffId, @milestoneLookupValueId, CONVERT(date, sysutcdatetime()),
                        'reflection', @text, @createdByUserAccountId);
                    """,
                    connection,
                    (SqlTransaction)transaction))
                {
                    command.Parameters.AddWithValue("@id", evidenceItemId);
                    command.Parameters.AddWithValue("@staffId", staffId);
                    command.Parameters.AddWithValue("@milestoneLookupValueId", point.MilestoneLookupValueId);
                    command.Parameters.AddWithValue("@text", trimmedText);
                    command.Parameters.AddWithValue("@createdByUserAccountId", ToDbValue(currentUser.UserAccountId));
                    await command.ExecuteNonQueryAsync(cancellationToken);
                }

                await WriteAuditAsync(
                    connection,
                    transaction,
                    currentUser.UserAccountId,
                    null,
                    "evidence_item",
                    evidenceItemId,
                    "staff_profile.reflection_saved",
                    $"{point.Name} reflection completed by {currentUser.DisplayName}.",
                    null,
                    JsonSerializer.Serialize(new
                    {
                        text = trimmedText,
                        completionDate = DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd")
                    }),
                    cancellationToken);
            }
            else
            {
                await using (var command = new SqlCommand(
                    """
                    UPDATE evidence.evidence_items
                    SET impact_summary = @text,
                        updated_at = sysutcdatetime()
                    WHERE id = @id;
                    """,
                    connection,
                    (SqlTransaction)transaction))
                {
                    command.Parameters.AddWithValue("@id", existing.Id);
                    command.Parameters.AddWithValue("@text", trimmedText);
                    await command.ExecuteNonQueryAsync(cancellationToken);
                }

                await WriteAuditAsync(
                    connection,
                    transaction,
                    currentUser.UserAccountId,
                    null,
                    "evidence_item",
                    existing.Id,
                    "staff_profile.reflection_saved",
                    $"{point.Name} reflection updated by {currentUser.DisplayName}.",
                    beforeJson,
                    JsonSerializer.Serialize(new
                    {
                        text = trimmedText,
                        completionDate = existing.CompletionDate.ToString("yyyy-MM-dd")
                    }),
                    cancellationToken);
            }

            await transaction.CommitAsync(cancellationToken);
            return FormSubmissionUpdateResult.Saved;
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task<IReadOnlyList<AdminUserSummary>> GetAdminUsersAsync(CancellationToken cancellationToken)
    {
        var rows = await QueryAsync(
            """
            SELECT
                ua.id,
                s.id,
                s.external_id,
                s.display_name,
                s.email,
                s.job_title,
                s.primary_org_unit_id,
                ou.code,
                ua.account_status,
                ua.is_disabled,
                ua.last_login_at,
                r.role_key,
                r.name,
                sc.scope_type,
                sc.org_unit_id,
                scope_org.code
            FROM auth.user_accounts ua
            JOIN people.staff s ON s.id = ua.staff_id
                AND s.archived_at IS NULL
            LEFT JOIN org.org_units ou ON ou.id = s.primary_org_unit_id
            LEFT JOIN auth.user_roles ur ON ur.user_account_id = ua.id
                AND ur.active_from <= sysutcdatetime()
                AND (ur.active_to IS NULL OR ur.active_to > sysutcdatetime())
            LEFT JOIN auth.roles r ON r.id = ur.role_id
                AND r.archived_at IS NULL
            LEFT JOIN auth.access_scopes sc ON sc.user_account_id = ua.id
                AND sc.is_active = 1
                AND sc.archived_at IS NULL
            LEFT JOIN org.org_units scope_org ON scope_org.id = sc.org_unit_id
            WHERE ua.archived_at IS NULL
            ORDER BY s.display_name;
            """,
            reader => new AdminUserRow(
                reader.GetGuid(0),
                reader.GetGuid(1),
                reader.GetString(2),
                reader.GetString(3),
                reader.GetString(4),
                GetStringOrNull(reader, 5),
                GetGuidOrNull(reader, 6),
                GetStringOrNull(reader, 7),
                reader.GetString(8),
                reader.GetBoolean(9),
                GetDateTimeOffsetOrNull(reader, 10),
                GetStringOrNull(reader, 11),
                GetStringOrNull(reader, 12),
                GetStringOrNull(reader, 13),
                GetGuidOrNull(reader, 14),
                GetStringOrNull(reader, 15)),
            cancellationToken);

        return rows
            .GroupBy(row => row.UserAccountId)
            .Select(group =>
            {
                var first = group.First();
                var roles = group
                    .Where(row => row.RoleKey is not null)
                    .Select(row => new RoleSummary(row.RoleKey!, row.RoleName ?? row.RoleKey!))
                    .DistinctBy(role => role.RoleKey)
                    .OrderBy(role => role.Name)
                    .ToArray();
                var scopes = group
                    .Where(row => row.ScopeType is not null)
                    .Select(row => new AdminUserScopeSummary(row.ScopeType!, row.ScopeOrgUnitId, row.ScopeOrgCode))
                    .Distinct()
                    .OrderBy(scope => scope.ScopeType)
                    .ThenBy(scope => scope.OrgUnitCode)
                    .ToArray();

                return new AdminUserSummary(
                    first.UserAccountId,
                    first.StaffId,
                    first.ExternalId,
                    first.DisplayName,
                    first.Email,
                    first.JobTitle,
                    first.PrimaryOrgUnitId,
                    first.PrimaryOrgCode,
                    first.AccountStatus,
                    first.IsDisabled,
                    first.LastLoginAt,
                    roles,
                    scopes);
            })
            .OrderBy(user => user.DisplayName)
            .ToArray();
    }

    public async Task<IReadOnlyList<AdminRoleSummary>> GetAdminRolesAsync(CancellationToken cancellationToken)
    {
        var rows = await QueryAsync(
            """
            SELECT r.id, r.role_key, r.name, r.description, r.is_system, r.precedence,
                   p.permission_key, p.name, p.category
            FROM auth.roles r
            LEFT JOIN auth.role_permissions rp ON rp.role_id = r.id
            LEFT JOIN auth.permissions p ON p.id = rp.permission_id
                AND p.archived_at IS NULL
            WHERE r.archived_at IS NULL
              AND r.is_active = 1
            ORDER BY r.name, p.category, p.permission_key;
            """,
            reader => new AdminRoleRow(
                reader.GetGuid(0),
                reader.GetString(1),
                reader.GetString(2),
                GetStringOrNull(reader, 3),
                reader.GetBoolean(4),
                reader.GetInt32(5),
                GetStringOrNull(reader, 6),
                GetStringOrNull(reader, 7),
                GetStringOrNull(reader, 8)),
            cancellationToken);

        return rows
            .GroupBy(row => row.Id)
            .Select(group =>
            {
                var first = group.First();
                return new AdminRoleSummary(
                    first.Id,
                    first.RoleKey,
                    first.Name,
                    first.Description,
                    first.IsSystem,
                    first.Precedence,
                    group
                        .Where(row => row.PermissionKey is not null)
                        .Select(row => new PermissionSummary(
                            row.PermissionKey!,
                            row.PermissionName ?? row.PermissionKey!,
                            row.PermissionCategory ?? ""))
                        .DistinctBy(permission => permission.PermissionKey)
                        .ToArray());
            })
            .OrderByDescending(role => role.Precedence)
            .ThenBy(role => role.Name)
            .ToArray();
    }

    public async Task<Guid> CreateAdminUserAsync(
        CreateAdminUserRequest request,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        try
        {
            Guid? existingStaffId = null;
            var hasAccount = false;
            await using (var command = new SqlCommand(
                """
                SELECT TOP (1)
                    s.id,
                    CASE WHEN EXISTS (
                        SELECT 1 FROM auth.user_accounts ua
                        WHERE ua.staff_id = s.id AND ua.archived_at IS NULL
                    ) THEN 1 ELSE 0 END
                FROM people.staff s
                WHERE (s.email = @email OR s.external_id = @externalId)
                  AND s.archived_at IS NULL;
                """,
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@email", request.Email.Trim());
                command.Parameters.AddWithValue("@externalId", request.ExternalId.Trim());
                await using var reader = await command.ExecuteReaderAsync(cancellationToken);
                if (await reader.ReadAsync(cancellationToken))
                {
                    existingStaffId = reader.GetGuid(0);
                    hasAccount = reader.GetInt32(1) == 1;
                }
            }

            if (hasAccount)
            {
                throw new WorkflowValidationException(
                    "A user account already exists for that staff member. Edit the existing account instead.");
            }

            var accountStatus = string.IsNullOrWhiteSpace(request.AccountStatus) ? "active" : request.AccountStatus.Trim();
            var staffId = existingStaffId ?? Guid.NewGuid();

            if (existingStaffId is null)
            {
                await using var command = new SqlCommand(
                    """
                    INSERT INTO people.staff (id, external_id, display_name, email, job_title, primary_org_unit_id, account_status)
                    VALUES (@id, @externalId, @displayName, @email, @jobTitle, @primaryOrgUnitId, @accountStatus);
                    """,
                    connection,
                    (SqlTransaction)transaction);
                command.Parameters.AddWithValue("@id", staffId);
                command.Parameters.AddWithValue("@externalId", request.ExternalId.Trim());
                command.Parameters.AddWithValue("@displayName", request.DisplayName.Trim());
                command.Parameters.AddWithValue("@email", request.Email.Trim());
                command.Parameters.AddWithValue("@jobTitle", ToDbValue(request.JobTitle));
                command.Parameters.AddWithValue("@primaryOrgUnitId", ToDbValue(request.PrimaryOrgUnitId));
                command.Parameters.AddWithValue("@accountStatus", accountStatus);
                await command.ExecuteNonQueryAsync(cancellationToken);
            }
            else
            {
                await using var command = new SqlCommand(
                    """
                    UPDATE people.staff
                    SET display_name = @displayName,
                        job_title = COALESCE(@jobTitle, job_title),
                        primary_org_unit_id = COALESCE(@primaryOrgUnitId, primary_org_unit_id),
                        account_status = @accountStatus,
                        updated_at = sysutcdatetime()
                    WHERE id = @id;
                    """,
                    connection,
                    (SqlTransaction)transaction);
                command.Parameters.AddWithValue("@id", staffId);
                command.Parameters.AddWithValue("@displayName", request.DisplayName.Trim());
                command.Parameters.AddWithValue("@jobTitle", ToDbValue(request.JobTitle));
                command.Parameters.AddWithValue("@primaryOrgUnitId", ToDbValue(request.PrimaryOrgUnitId));
                command.Parameters.AddWithValue("@accountStatus", accountStatus);
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            var userAccountId = Guid.NewGuid();
            await using (var command = new SqlCommand(
                """
                INSERT INTO auth.user_accounts (id, staff_id, account_status)
                VALUES (@id, @staffId, @accountStatus);
                """,
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@id", userAccountId);
                command.Parameters.AddWithValue("@staffId", staffId);
                command.Parameters.AddWithValue("@accountStatus", accountStatus);
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            await ReplaceUserRolesAsync(connection, transaction, userAccountId, request.RoleKeys ?? [], cancellationToken);
            await ReplaceUserScopesAsync(connection, transaction, userAccountId, request.ScopeOrgUnitIds ?? [], cancellationToken);

            await WriteAuditAsync(
                connection,
                transaction,
                currentUser.UserAccountId,
                null,
                "user_account",
                userAccountId,
                "user.created",
                $"User account created for {request.DisplayName.Trim()} by {currentUser.DisplayName}.",
                null,
                JsonSerializer.Serialize(new
                {
                    externalId = request.ExternalId.Trim(),
                    displayName = request.DisplayName.Trim(),
                    email = request.Email.Trim(),
                    jobTitle = request.JobTitle,
                    primaryOrgUnitId = request.PrimaryOrgUnitId,
                    accountStatus,
                    roles = request.RoleKeys,
                    scopeOrgUnitIds = request.ScopeOrgUnitIds
                }),
                cancellationToken);

            await transaction.CommitAsync(cancellationToken);
            return userAccountId;
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task<FormSubmissionUpdateResult> UpdateAdminUserAsync(
        Guid userAccountId,
        UpdateAdminUserRequest request,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        if (request.IsDisabled == true
            && currentUser.UserAccountId.HasValue
            && currentUser.UserAccountId.Value == userAccountId)
        {
            throw new WorkflowValidationException("You cannot disable your own account.");
        }

        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        try
        {
            AdminUserEditInfo? account = null;
            await using (var command = new SqlCommand(
                """
                SELECT ua.staff_id, ua.account_status, ua.is_disabled, s.display_name, s.job_title, s.primary_org_unit_id
                FROM auth.user_accounts ua
                JOIN people.staff s ON s.id = ua.staff_id
                WHERE ua.id = @id
                  AND ua.archived_at IS NULL;
                """,
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@id", userAccountId);
                await using var reader = await command.ExecuteReaderAsync(cancellationToken);
                if (await reader.ReadAsync(cancellationToken))
                {
                    account = new AdminUserEditInfo(
                        reader.GetGuid(0),
                        reader.GetString(1),
                        reader.GetBoolean(2),
                        reader.GetString(3),
                        GetStringOrNull(reader, 4),
                        GetGuidOrNull(reader, 5));
                }
            }

            if (account is null)
            {
                return FormSubmissionUpdateResult.NotFound;
            }

            var currentRoles = await GetActiveRoleKeysAsync(connection, transaction, userAccountId, cancellationToken);
            var currentScopes = await GetActiveScopeOrgUnitIdsAsync(connection, transaction, userAccountId, cancellationToken);

            var beforeJson = JsonSerializer.Serialize(new
            {
                displayName = account.DisplayName,
                jobTitle = account.JobTitle,
                primaryOrgUnitId = account.PrimaryOrgUnitId,
                accountStatus = account.AccountStatus,
                isDisabled = account.IsDisabled,
                roles = currentRoles,
                scopeOrgUnitIds = currentScopes
            });

            await using (var command = new SqlCommand(
                """
                UPDATE people.staff
                SET display_name = COALESCE(@displayName, display_name),
                    job_title = COALESCE(@jobTitle, job_title),
                    primary_org_unit_id = COALESCE(@primaryOrgUnitId, primary_org_unit_id),
                    account_status = COALESCE(@accountStatus, account_status),
                    updated_at = sysutcdatetime()
                WHERE id = @staffId;

                UPDATE auth.user_accounts
                SET account_status = COALESCE(@accountStatus, account_status),
                    is_disabled = COALESCE(@isDisabled, is_disabled),
                    updated_at = sysutcdatetime()
                WHERE id = @userAccountId;
                """,
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@staffId", account.StaffId);
                command.Parameters.AddWithValue("@userAccountId", userAccountId);
                command.Parameters.AddWithValue("@displayName", ToDbValue(request.DisplayName));
                command.Parameters.AddWithValue("@jobTitle", ToDbValue(request.JobTitle));
                command.Parameters.AddWithValue("@primaryOrgUnitId", ToDbValue(request.PrimaryOrgUnitId));
                command.Parameters.AddWithValue("@accountStatus", ToDbValue(request.AccountStatus));
                command.Parameters.AddWithValue("@isDisabled", ToDbValue(request.IsDisabled));
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            if (request.RoleKeys is not null)
            {
                var requestedRoleKeys = request.RoleKeys
                    .Where(key => !string.IsNullOrWhiteSpace(key))
                    .Select(key => key.Trim())
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToArray();
                if (requestedRoleKeys.Length == 0)
                {
                    throw new WorkflowValidationException("An active account must have at least one role.");
                }

                var isRemovingAdmin = currentRoles.Contains("super_admin", StringComparer.OrdinalIgnoreCase)
                    && !requestedRoleKeys.Contains("super_admin", StringComparer.OrdinalIgnoreCase);
                if (isRemovingAdmin
                    && currentUser.UserAccountId.HasValue
                    && currentUser.UserAccountId.Value == userAccountId)
                {
                    throw new WorkflowValidationException("You cannot remove your own Admin role.");
                }

                if (isRemovingAdmin)
                {
                    await using var adminCountCommand = new SqlCommand(
                        """
                        SELECT COUNT(DISTINCT ur.user_account_id)
                        FROM auth.user_roles ur
                        JOIN auth.roles r ON r.id = ur.role_id
                        JOIN auth.user_accounts ua ON ua.id = ur.user_account_id
                        WHERE r.role_key = 'super_admin'
                          AND ur.user_account_id <> @userAccountId
                          AND ur.active_from <= sysutcdatetime()
                          AND (ur.active_to IS NULL OR ur.active_to > sysutcdatetime())
                          AND ua.is_disabled = 0
                          AND ua.account_status = 'active'
                          AND ua.archived_at IS NULL;
                        """,
                        connection,
                        (SqlTransaction)transaction);
                    adminCountCommand.Parameters.AddWithValue("@userAccountId", userAccountId);
                    var remainingAdminCount = Convert.ToInt32(
                        await adminCountCommand.ExecuteScalarAsync(cancellationToken));
                    if (remainingAdminCount == 0)
                    {
                        throw new WorkflowValidationException("The final active Admin role cannot be removed.");
                    }
                }

                await ReplaceUserRolesAsync(connection, transaction, userAccountId, request.RoleKeys, cancellationToken);
            }

            if (request.ScopeOrgUnitIds is not null)
            {
                await ReplaceUserScopesAsync(connection, transaction, userAccountId, request.ScopeOrgUnitIds, cancellationToken);
            }

            await WriteAuditAsync(
                connection,
                transaction,
                currentUser.UserAccountId,
                null,
                "user_account",
                userAccountId,
                "user.updated",
                $"User account for {request.DisplayName ?? account.DisplayName} updated by {currentUser.DisplayName}.",
                beforeJson,
                JsonSerializer.Serialize(new
                {
                    displayName = request.DisplayName ?? account.DisplayName,
                    jobTitle = request.JobTitle ?? account.JobTitle,
                    primaryOrgUnitId = request.PrimaryOrgUnitId ?? account.PrimaryOrgUnitId,
                    accountStatus = request.AccountStatus ?? account.AccountStatus,
                    isDisabled = request.IsDisabled ?? account.IsDisabled,
                    roles = request.RoleKeys ?? currentRoles,
                    scopeOrgUnitIds = request.ScopeOrgUnitIds ?? currentScopes
                }),
                cancellationToken);

            await transaction.CommitAsync(cancellationToken);
            return FormSubmissionUpdateResult.Saved;
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task<FormSubmissionUpdateResult> UpdateFormTemplateStructureAsync(
        Guid templateId,
        UpdateFormTemplateStructureRequest request,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        try
        {
            var template = await GetTemplateEditInfoAsync(connection, transaction, templateId, cancellationToken);
            if (template is null)
            {
                return FormSubmissionUpdateResult.NotFound;
            }

            if (!string.Equals(template.ModuleKey, "work_scrutiny", StringComparison.OrdinalIgnoreCase))
            {
                await transaction.RollbackAsync(cancellationToken);
                return FormSubmissionUpdateResult.Forbidden;
            }

            if (template.IsPublished || template.SubmissionCount > 0)
            {
                throw new WorkflowValidationException(
                    "Published templates or templates with submissions cannot be restructured. Create a new template instead.");
            }

            await ValidateWorkScrutinyTemplateOrgUnitAsync(
                connection,
                transaction,
                request.OrgUnitId,
                cancellationToken);
            ValidateTemplateStructure(request);

            await using (var command = new SqlCommand(
                """
                DELETE ff
                FROM forms.form_fields ff
                JOIN forms.form_sections fs ON fs.id = ff.form_section_id
                WHERE fs.form_template_version_id = @versionId;

                DELETE FROM forms.form_sections
                WHERE form_template_version_id = @versionId;

                UPDATE forms.form_templates
                SET name = @name,
                    description = @description,
                    updated_at = sysutcdatetime()
                WHERE id = @templateId;
                """,
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@versionId", template.VersionId);
                command.Parameters.AddWithValue("@templateId", templateId);
                command.Parameters.AddWithValue("@name", request.Name.Trim());
                command.Parameters.AddWithValue("@description", ToDbValue(request.Description));
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            foreach (var section in request.Sections)
            {
                var sectionId = Guid.NewGuid();
                await using (var command = new SqlCommand(
                    """
                    INSERT INTO forms.form_sections (id, form_template_version_id, section_key, title, display_order)
                    VALUES (@id, @versionId, @sectionKey, @title, @displayOrder);
                    """,
                    connection,
                    (SqlTransaction)transaction))
                {
                    command.Parameters.AddWithValue("@id", sectionId);
                    command.Parameters.AddWithValue("@versionId", template.VersionId);
                    command.Parameters.AddWithValue("@sectionKey", section.SectionKey.Trim());
                    command.Parameters.AddWithValue("@title", section.Title.Trim());
                    command.Parameters.AddWithValue("@displayOrder", section.DisplayOrder);
                    await command.ExecuteNonQueryAsync(cancellationToken);
                }

                foreach (var field in section.Fields)
                {
                    await using var command = new SqlCommand(
                        """
                        INSERT INTO forms.form_fields (
                            form_section_id,
                            field_key,
                            label,
                            field_type,
                            is_required,
                            display_order,
                            help_text,
                            configuration_json
                        )
                        VALUES (
                            @sectionId,
                            @fieldKey,
                            @label,
                            @fieldType,
                            @isRequired,
                            @displayOrder,
                            @helpText,
                            @configurationJson
                        );
                        """,
                        connection,
                        (SqlTransaction)transaction);
                    command.Parameters.AddWithValue("@sectionId", sectionId);
                    command.Parameters.AddWithValue("@fieldKey", field.FieldKey.Trim());
                    command.Parameters.AddWithValue("@label", field.Label.Trim());
                    command.Parameters.AddWithValue("@fieldType", field.FieldType.Trim());
                    command.Parameters.AddWithValue("@isRequired", field.IsRequired);
                    command.Parameters.AddWithValue("@displayOrder", field.DisplayOrder);
                    command.Parameters.AddWithValue("@helpText", ToDbValue(field.HelpText));
                    command.Parameters.AddWithValue("@configurationJson", ToDbValue(SerializeFieldConfiguration(field.Options)));
                    await command.ExecuteNonQueryAsync(cancellationToken);
                }
            }

            if (request.OrgUnitId.HasValue)
            {
                await using var command = new SqlCommand(
                    """
                    UPDATE forms.form_template_org_units
                    SET archived_at = sysutcdatetime()
                    WHERE form_template_id = @templateId
                      AND archived_at IS NULL
                      AND org_unit_id <> @orgUnitId;

                    IF NOT EXISTS (
                        SELECT 1 FROM forms.form_template_org_units
                        WHERE form_template_id = @templateId
                          AND org_unit_id = @orgUnitId
                          AND archived_at IS NULL
                    )
                    BEGIN
                        INSERT INTO forms.form_template_org_units (form_template_id, org_unit_id)
                        VALUES (@templateId, @orgUnitId);
                    END;
                    """,
                    connection,
                    (SqlTransaction)transaction);
                command.Parameters.AddWithValue("@templateId", templateId);
                command.Parameters.AddWithValue("@orgUnitId", request.OrgUnitId.Value);
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            await WriteAuditAsync(
                connection,
                transaction,
                currentUser.UserAccountId,
                null,
                "form_template",
                templateId,
                "form_template.updated",
                $"Form template '{request.Name.Trim()}' structure updated by {currentUser.DisplayName}.",
                JsonSerializer.Serialize(new { name = template.Name }),
                JsonSerializer.Serialize(new
                {
                    name = request.Name.Trim(),
                    orgUnitId = request.OrgUnitId,
                    sectionCount = request.Sections.Count,
                    fieldCount = request.Sections.Sum(section => section.Fields.Count)
                }),
                cancellationToken);

            await transaction.CommitAsync(cancellationToken);
            return FormSubmissionUpdateResult.Saved;
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task<FormSubmissionUpdateResult> PublishFormTemplateAsync(
        Guid templateId,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        try
        {
            var template = await GetTemplateEditInfoAsync(connection, transaction, templateId, cancellationToken);
            if (template is null)
            {
                return FormSubmissionUpdateResult.NotFound;
            }

            if (!string.Equals(template.ModuleKey, "work_scrutiny", StringComparison.OrdinalIgnoreCase))
            {
                await transaction.RollbackAsync(cancellationToken);
                return FormSubmissionUpdateResult.Forbidden;
            }

            if (template.IsPublished)
            {
                throw new WorkflowValidationException("This template version is already published.");
            }

            if (template.FieldCount == 0)
            {
                throw new WorkflowValidationException("Add at least one section and field before publishing the template.");
            }

            await using (var command = new SqlCommand(
                """
                IF NOT EXISTS (
                    SELECT 1
                    FROM forms.form_template_org_units assignment
                    JOIN org.org_units team ON team.id = assignment.org_unit_id
                    JOIN org.org_units faculty ON faculty.id = team.parent_org_unit_id
                    WHERE assignment.form_template_id = @templateId
                      AND assignment.archived_at IS NULL
                      AND team.org_unit_type IN ('team', 'faculty_child_code', 'faculty_child')
                      AND team.archived_at IS NULL
                      AND faculty.org_unit_type = 'faculty'
                      AND faculty.archived_at IS NULL
                )
                BEGIN
                    THROW 51000, 'Work Scrutiny templates must be allocated to one active sub-team.', 1;
                END;

                IF EXISTS (
                    SELECT 1
                    FROM forms.form_template_org_units current_assignment
                    JOIN forms.form_template_org_units other_assignment
                      ON other_assignment.org_unit_id = current_assignment.org_unit_id
                     AND other_assignment.form_template_id <> current_assignment.form_template_id
                     AND other_assignment.archived_at IS NULL
                    JOIN forms.form_templates other_template ON other_template.id = other_assignment.form_template_id
                    JOIN core.modules other_module ON other_module.id = other_template.module_id
                    JOIN forms.form_template_versions other_version ON other_version.form_template_id = other_template.id
                    WHERE current_assignment.form_template_id = @templateId
                      AND current_assignment.archived_at IS NULL
                      AND other_template.archived_at IS NULL
                      AND other_template.is_active = 1
                      AND other_module.module_key = 'work_scrutiny'
                      AND other_version.is_published = 1
                      AND other_version.archived_at IS NULL
                )
                BEGIN
                    THROW 51000, 'That sub-team already has a published Work Scrutiny template. Archive it before publishing its replacement.', 1;
                END;
                """,
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@templateId", templateId);
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            await using (var command = new SqlCommand(
                """
                UPDATE ftv
                SET is_published = 1,
                    active_from = COALESCE(ftv.active_from, sysutcdatetime()),
                    version_label = CASE
                        WHEN ftv.version_label LIKE '0.%' AND NOT EXISTS (
                            SELECT 1 FROM forms.form_template_versions other
                            WHERE other.form_template_id = ftv.form_template_id
                              AND other.version_label = '1.0'
                              AND other.id <> ftv.id
                        ) THEN '1.0'
                        ELSE ftv.version_label END,
                    updated_at = sysutcdatetime()
                FROM forms.form_template_versions ftv
                WHERE ftv.id = @versionId;
                """,
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@versionId", template.VersionId);
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            await WriteAuditAsync(
                connection,
                transaction,
                currentUser.UserAccountId,
                null,
                "form_template",
                templateId,
                "form_template.published",
                $"Form template '{template.Name}' published by {currentUser.DisplayName}.",
                JsonSerializer.Serialize(new { status = "Draft" }),
                JsonSerializer.Serialize(new { status = "Published" }),
                cancellationToken);

            await transaction.CommitAsync(cancellationToken);
            return FormSubmissionUpdateResult.Saved;
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public static bool CanViewAllStaffProfiles(CurrentUser currentUser) =>
        currentUser.HasPermission(PermissionKeys.LivManage)
        || currentUser.HasPermission(PermissionKeys.ReportsViewAll)
        || currentUser.HasPermission(PermissionKeys.StaffManage)
        || currentUser.HasPermission(PermissionKeys.UsersManage);

    private static void ValidateTemplateStructure(UpdateFormTemplateStructureRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
        {
            throw new WorkflowValidationException("A template name is required.");
        }

        var allowedFieldTypes = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "short_text",
            "long_text",
            "number",
            "date",
            "yes_no_partial",
            "single_select",
            "multi_select",
            "checkbox_group",
            "rubric_scale"
        };
        var optionFieldTypes = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "single_select",
            "multi_select",
            "checkbox_group",
            "rubric_scale"
        };
        var reservedSectionKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "context",
            "sample",
            "actions"
        };
        var reservedFieldKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "scrutiny_date",
            "faculty_area",
            "team_level",
            "reviewer",
            "course_sample",
            "recommended_actions"
        };

        var sectionKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var section in request.Sections)
        {
            if (string.IsNullOrWhiteSpace(section.SectionKey) || string.IsNullOrWhiteSpace(section.Title))
            {
                throw new WorkflowValidationException("Every section needs a key and a title.");
            }

            if (!sectionKeys.Add(section.SectionKey.Trim()))
            {
                throw new WorkflowValidationException($"Section key '{section.SectionKey}' is used more than once.");
            }

            if (reservedSectionKeys.Contains(section.SectionKey.Trim()))
            {
                throw new WorkflowValidationException(
                    $"Section key '{section.SectionKey}' is reserved for the universal Work Scrutiny form.");
            }

            var fieldKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var field in section.Fields)
            {
                if (string.IsNullOrWhiteSpace(field.FieldKey)
                    || string.IsNullOrWhiteSpace(field.Label)
                    || string.IsNullOrWhiteSpace(field.FieldType))
                {
                    throw new WorkflowValidationException("Every field needs a key, a label and a type.");
                }

                if (!fieldKeys.Add(field.FieldKey.Trim()))
                {
                    throw new WorkflowValidationException(
                        $"Field key '{field.FieldKey}' is used more than once in section '{section.Title}'.");
                }

                if (reservedFieldKeys.Contains(field.FieldKey.Trim()))
                {
                    throw new WorkflowValidationException(
                        $"Field key '{field.FieldKey}' is reserved for the universal Work Scrutiny form.");
                }

                if (!allowedFieldTypes.Contains(field.FieldType.Trim()))
                {
                    throw new WorkflowValidationException(
                        $"Field type '{field.FieldType}' is not available in Work Scrutiny templates.");
                }

                var options = field.Options?
                    .Where(option => !string.IsNullOrWhiteSpace(option))
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToArray() ?? [];
                if (optionFieldTypes.Contains(field.FieldType.Trim()) && options.Length < 2)
                {
                    throw new WorkflowValidationException(
                        $"Field '{field.Label}' needs at least two response options.");
                }

                if (options.Length > 20)
                {
                    throw new WorkflowValidationException(
                        $"Field '{field.Label}' cannot have more than 20 response options.");
                }
            }
        }
    }

    private static async Task<TemplateEditInfo?> GetTemplateEditInfoAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        Guid templateId,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            """
            SELECT
                ft.name,
                m.module_key,
                latest_version.id,
                latest_version.is_published,
                (SELECT COUNT(*)
                 FROM forms.form_submissions fs
                 WHERE fs.form_template_version_id = latest_version.id
                   AND fs.archived_at IS NULL) AS submission_count,
                (SELECT COUNT(*)
                 FROM forms.form_sections fsec
                 JOIN forms.form_fields ff ON ff.form_section_id = fsec.id
                 WHERE fsec.form_template_version_id = latest_version.id
                   AND fsec.archived_at IS NULL
                   AND ff.archived_at IS NULL
                   AND ff.is_active = 1) AS field_count
            FROM forms.form_templates ft
            JOIN core.modules m ON m.id = ft.module_id
            OUTER APPLY (
                SELECT TOP (1) id, is_published
                FROM forms.form_template_versions ftv
                WHERE ftv.form_template_id = ft.id
                  AND ftv.archived_at IS NULL
                ORDER BY ftv.is_published DESC, ftv.active_from DESC, ftv.created_at DESC
            ) latest_version
            WHERE ft.id = @templateId
              AND ft.archived_at IS NULL;
            """,
            connection,
            (SqlTransaction)transaction);

        command.Parameters.AddWithValue("@templateId", templateId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken) || reader.IsDBNull(2))
        {
            return null;
        }

        return new TemplateEditInfo(
            reader.GetString(0),
            reader.GetString(1),
            reader.GetGuid(2),
            reader.GetBoolean(3),
            Convert.ToInt32(reader.GetValue(4)),
            Convert.ToInt32(reader.GetValue(5)));
    }

    private static async Task ValidateWorkScrutinyTemplateOrgUnitAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        Guid? orgUnitId,
        CancellationToken cancellationToken)
    {
        if (!orgUnitId.HasValue)
        {
            throw new WorkflowValidationException("Select a sub-team for the Work Scrutiny template.");
        }

        await using var command = new SqlCommand(
            """
            SELECT COUNT(*)
            FROM org.org_units team
            JOIN org.org_units faculty ON faculty.id = team.parent_org_unit_id
            WHERE team.id = @orgUnitId
              AND team.org_unit_type IN ('team', 'faculty_child_code', 'faculty_child')
              AND team.archived_at IS NULL
              AND team.is_active = 1
              AND faculty.org_unit_type = 'faculty'
              AND faculty.archived_at IS NULL
              AND faculty.is_active = 1;
            """,
            connection,
            (SqlTransaction)transaction);
        command.Parameters.AddWithValue("@orgUnitId", orgUnitId.Value);
        var count = Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken));
        if (count == 0)
        {
            throw new WorkflowValidationException("Work Scrutiny templates must be allocated to an active sub-team.");
        }
    }

    private static async Task ReplaceUserRolesAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        Guid userAccountId,
        IReadOnlyList<string> roleKeys,
        CancellationToken cancellationToken)
    {
        var requestedKeys = roleKeys
            .Where(key => !string.IsNullOrWhiteSpace(key))
            .Select(key => key.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        var keysCsv = string.Join(",", requestedKeys);

        var resolved = new Dictionary<string, Guid>(StringComparer.OrdinalIgnoreCase);
        await using (var command = new SqlCommand(
            """
            SELECT role_key, id
            FROM auth.roles
            WHERE archived_at IS NULL
              AND is_active = 1
              AND role_key IN (SELECT value FROM STRING_SPLIT(@roleKeysCsv, ','));
            """,
            connection,
            (SqlTransaction)transaction))
        {
            command.Parameters.AddWithValue("@roleKeysCsv", keysCsv);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                resolved[reader.GetString(0)] = reader.GetGuid(1);
            }
        }

        var missing = requestedKeys.Where(key => !resolved.ContainsKey(key)).ToArray();
        if (missing.Length > 0)
        {
            throw new WorkflowValidationException($"Unknown role(s): {string.Join(", ", missing)}.");
        }

        await using (var command = new SqlCommand(
            """
            UPDATE auth.user_roles
            SET active_to = sysutcdatetime()
            WHERE user_account_id = @userAccountId
              AND active_from <= sysutcdatetime()
              AND (active_to IS NULL OR active_to > sysutcdatetime())
              AND role_id NOT IN (
                  SELECT r.id
                  FROM auth.roles r
                  WHERE r.role_key IN (SELECT value FROM STRING_SPLIT(@roleKeysCsv, ','))
              );
            """,
            connection,
            (SqlTransaction)transaction))
        {
            command.Parameters.AddWithValue("@userAccountId", userAccountId);
            command.Parameters.AddWithValue("@roleKeysCsv", keysCsv);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        foreach (var roleId in resolved.Values)
        {
            await using var command = new SqlCommand(
                """
                IF NOT EXISTS (
                    SELECT 1
                    FROM auth.user_roles
                    WHERE user_account_id = @userAccountId
                      AND role_id = @roleId
                      AND active_from <= sysutcdatetime()
                      AND (active_to IS NULL OR active_to > sysutcdatetime())
                )
                BEGIN
                    INSERT INTO auth.user_roles (user_account_id, role_id)
                    VALUES (@userAccountId, @roleId);
                END;
                """,
                connection,
                (SqlTransaction)transaction);
            command.Parameters.AddWithValue("@userAccountId", userAccountId);
            command.Parameters.AddWithValue("@roleId", roleId);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }
    }

    private static async Task ReplaceUserScopesAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        Guid userAccountId,
        IReadOnlyList<Guid> scopeOrgUnitIds,
        CancellationToken cancellationToken)
    {
        var requestedIds = scopeOrgUnitIds.Distinct().ToArray();
        var idsCsv = string.Join(",", requestedIds);

        await using (var command = new SqlCommand(
            """
            UPDATE auth.access_scopes
            SET is_active = 0,
                archived_at = sysutcdatetime(),
                updated_at = sysutcdatetime()
            WHERE user_account_id = @userAccountId
              AND scope_type = 'assigned_org_units'
              AND archived_at IS NULL
              AND (org_unit_id IS NULL OR NOT EXISTS (
                  SELECT 1 FROM STRING_SPLIT(@orgUnitIdsCsv, ',') requested
                  WHERE TRY_CONVERT(uniqueidentifier, requested.value) = org_unit_id
              ));
            """,
            connection,
            (SqlTransaction)transaction))
        {
            command.Parameters.AddWithValue("@userAccountId", userAccountId);
            command.Parameters.AddWithValue("@orgUnitIdsCsv", idsCsv);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        foreach (var orgUnitId in requestedIds)
        {
            await using var command = new SqlCommand(
                """
                IF NOT EXISTS (SELECT 1 FROM org.org_units WHERE id = @orgUnitId AND archived_at IS NULL)
                BEGIN
                    THROW 51000, 'One of the selected org units was not found.', 1;
                END;

                IF EXISTS (
                    SELECT 1 FROM auth.access_scopes
                    WHERE user_account_id = @userAccountId
                      AND scope_type = 'assigned_org_units'
                      AND org_unit_id = @orgUnitId
                      AND archived_at IS NULL
                )
                BEGIN
                    UPDATE auth.access_scopes
                    SET is_active = 1,
                        updated_at = sysutcdatetime()
                    WHERE user_account_id = @userAccountId
                      AND scope_type = 'assigned_org_units'
                      AND org_unit_id = @orgUnitId
                      AND archived_at IS NULL;
                END
                ELSE
                BEGIN
                    INSERT INTO auth.access_scopes (user_account_id, scope_type, org_unit_id)
                    VALUES (@userAccountId, 'assigned_org_units', @orgUnitId);
                END;
                """,
                connection,
                (SqlTransaction)transaction);
            command.Parameters.AddWithValue("@userAccountId", userAccountId);
            command.Parameters.AddWithValue("@orgUnitId", orgUnitId);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }
    }

    private static async Task<IReadOnlyList<string>> GetActiveRoleKeysAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        Guid userAccountId,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            """
            SELECT r.role_key
            FROM auth.user_roles ur
            JOIN auth.roles r ON r.id = ur.role_id
            WHERE ur.user_account_id = @userAccountId
              AND ur.active_from <= sysutcdatetime()
              AND (ur.active_to IS NULL OR ur.active_to > sysutcdatetime())
            ORDER BY r.role_key;
            """,
            connection,
            (SqlTransaction)transaction);

        command.Parameters.AddWithValue("@userAccountId", userAccountId);

        var keys = new List<string>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            keys.Add(reader.GetString(0));
        }

        return keys;
    }

    private static async Task<IReadOnlyList<Guid>> GetActiveScopeOrgUnitIdsAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        Guid userAccountId,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            """
            SELECT org_unit_id
            FROM auth.access_scopes
            WHERE user_account_id = @userAccountId
              AND scope_type = 'assigned_org_units'
              AND org_unit_id IS NOT NULL
              AND is_active = 1
              AND archived_at IS NULL
            ORDER BY org_unit_id;
            """,
            connection,
            (SqlTransaction)transaction);

        command.Parameters.AddWithValue("@userAccountId", userAccountId);

        var ids = new List<Guid>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            ids.Add(reader.GetGuid(0));
        }

        return ids;
    }

    private async Task<HashSet<string>> GetPermissionKeysAsync(
        SqlConnection connection,
        Guid userAccountId,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            """
            SELECT DISTINCT p.permission_key
            FROM auth.user_roles ur
            JOIN auth.role_permissions rp ON rp.role_id = ur.role_id
            JOIN auth.permissions p ON p.id = rp.permission_id
            WHERE ur.user_account_id = @userAccountId
              AND ur.active_from <= sysutcdatetime()
              AND (ur.active_to IS NULL OR ur.active_to > sysutcdatetime())
              AND p.archived_at IS NULL
            ORDER BY p.permission_key;
            """,
            connection);

        command.Parameters.AddWithValue("@userAccountId", userAccountId);

        var permissions = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            permissions.Add(reader.GetString(0));
        }

        return permissions;
    }

    private async Task<IReadOnlyList<AccessScopeDto>> GetAccessScopesAsync(
        SqlConnection connection,
        Guid userAccountId,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            """
            SELECT scope_type, org_unit_id, staff_id
            FROM auth.access_scopes
            WHERE user_account_id = @userAccountId
              AND is_active = 1
              AND archived_at IS NULL
            ORDER BY scope_type;
            """,
            connection);

        command.Parameters.AddWithValue("@userAccountId", userAccountId);

        var scopes = new List<AccessScopeDto>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            scopes.Add(new AccessScopeDto(
                reader.GetString(0),
                GetGuidOrNull(reader, 1),
                GetGuidOrNull(reader, 2)));
        }

        return scopes;
    }

    private static async Task<Guid> GetModuleIdAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        string moduleKey,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            """
            SELECT id
            FROM core.modules
            WHERE module_key = @moduleKey
              AND archived_at IS NULL;
            """,
            connection,
            (SqlTransaction)transaction);

        command.Parameters.AddWithValue("@moduleKey", moduleKey);

        return (Guid)(await command.ExecuteScalarAsync(cancellationToken)
            ?? throw new InvalidOperationException($"Module '{moduleKey}' was not found."));
    }

    private static async Task<TemplateVersionInfo> GetLatestTemplateVersionAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        string templateKey,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            """
            SELECT TOP (1)
                ft.id,
                ft.module_id,
                ftv.id,
                ftv.is_published
            FROM forms.form_templates ft
            JOIN forms.form_template_versions ftv ON ftv.form_template_id = ft.id
            WHERE ft.template_key = @templateKey
              AND ft.archived_at IS NULL
              AND ftv.archived_at IS NULL
            ORDER BY ftv.is_published DESC, ftv.active_from DESC, ftv.created_at DESC;
            """,
            connection,
            (SqlTransaction)transaction);

        command.Parameters.AddWithValue("@templateKey", templateKey);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            throw new InvalidOperationException($"Template '{templateKey}' was not found.");
        }

        return new TemplateVersionInfo(reader.GetGuid(0), reader.GetGuid(1), reader.GetGuid(2), reader.GetBoolean(3));
    }

    private static async Task<Dictionary<Guid, FormFieldInfo>> GetFieldInfoAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        Guid versionId,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            """
            SELECT ff.id, ff.field_type, ff.field_key, ff.is_required, ff.label
            FROM forms.form_sections fs
            JOIN forms.form_fields ff ON ff.form_section_id = fs.id
            WHERE fs.form_template_version_id = @versionId
              AND fs.archived_at IS NULL
              AND ff.archived_at IS NULL
              AND ff.is_active = 1;
            """,
            connection,
            (SqlTransaction)transaction);

        command.Parameters.AddWithValue("@versionId", versionId);

        var fields = new Dictionary<Guid, FormFieldInfo>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            fields[reader.GetGuid(0)] = new FormFieldInfo(
                reader.GetString(1),
                reader.GetString(2),
                reader.GetBoolean(3),
                reader.GetString(4));
        }

        return fields;
    }

    private static void ValidateRequiredFields(
        Dictionary<Guid, FormFieldInfo> fields,
        IReadOnlyList<SubmitFormResponseRequest> responses)
    {
        var valuesByFieldId = responses
            .Where(response => !string.IsNullOrWhiteSpace(response.Value))
            .ToDictionary(response => response.FieldId, response => response.Value!);

        var missing = fields
            .Where(field => field.Value.IsRequired && !valuesByFieldId.ContainsKey(field.Key))
            .Select(field => field.Value.Label)
            .ToArray();

        if (missing.Length > 0)
        {
            throw new WorkflowValidationException(
                $"Complete the required fields before submitting: {string.Join(", ", missing)}.");
        }
    }

    private static async Task ValidateWorkScrutinySubmissionAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        TemplateVersionInfo template,
        SubmitFormRequest request,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        if (!template.IsPublished || !request.OrgUnitId.HasValue)
        {
            throw new WorkflowValidationException("Select a sub-team with a published Work Scrutiny template.");
        }

        await using (var command = new SqlCommand(
            """
            WITH scoped_org_units AS (
                SELECT org_unit_id
                FROM auth.access_scopes
                WHERE user_account_id = @currentUserAccountId
                  AND scope_type = 'assigned_org_units'
                  AND org_unit_id IS NOT NULL
                  AND is_active = 1
                  AND archived_at IS NULL
                UNION ALL
                SELECT child.id
                FROM org.org_units child
                JOIN scoped_org_units parent_scope ON parent_scope.org_unit_id = child.parent_org_unit_id
                WHERE child.archived_at IS NULL
            )
            SELECT COUNT(*)
            FROM forms.form_templates template
            JOIN core.modules module ON module.id = template.module_id
            JOIN forms.form_template_org_units assignment ON assignment.form_template_id = template.id
            JOIN org.org_units team ON team.id = assignment.org_unit_id
            JOIN org.org_units faculty ON faculty.id = team.parent_org_unit_id
            LEFT JOIN people.staff current_staff ON current_staff.id = @currentStaffId
            WHERE template.id = @templateId
              AND module.module_key = 'work_scrutiny'
              AND template.archived_at IS NULL
              AND template.is_active = 1
              AND assignment.archived_at IS NULL
              AND assignment.org_unit_id = @orgUnitId
              AND team.org_unit_type IN ('team', 'faculty_child_code', 'faculty_child')
              AND team.archived_at IS NULL
              AND team.is_active = 1
              AND faculty.org_unit_type = 'faculty'
              AND faculty.archived_at IS NULL
              AND (
                    @canViewAll = 1
                    OR EXISTS (SELECT 1 FROM scoped_org_units scoped WHERE scoped.org_unit_id = team.id)
                    OR EXISTS (
                        SELECT 1 FROM auth.access_scopes global_scope
                        WHERE global_scope.user_account_id = @currentUserAccountId
                          AND global_scope.scope_type = 'global'
                          AND global_scope.is_active = 1
                          AND global_scope.archived_at IS NULL
                    )
                    OR current_staff.primary_org_unit_id = team.id
              );
            """,
            connection,
            (SqlTransaction)transaction))
        {
            command.Parameters.AddWithValue("@templateId", template.TemplateId);
            command.Parameters.AddWithValue("@orgUnitId", request.OrgUnitId.Value);
            command.Parameters.AddWithValue("@currentUserAccountId", ToDbValue(currentUser.UserAccountId));
            command.Parameters.AddWithValue("@currentStaffId", ToDbValue(currentUser.StaffId));
            command.Parameters.AddWithValue("@canViewAll", CanViewAllRecords(currentUser));
            var validContext = Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken));
            if (validContext == 0)
            {
                throw new WorkflowValidationException(
                    "The selected Work Scrutiny template is not published for that sub-team or is outside your assigned scope.");
            }
        }

        var courseIds = request.CourseIds?.Distinct().ToArray() ?? [];
        if (courseIds.Length == 0)
        {
            throw new WorkflowValidationException("Select at least one course for the scrutiny sample.");
        }

        await using (var command = new SqlCommand(
            """
            SELECT COUNT(DISTINCT course.id)
            FROM curriculum.courses course
            WHERE course.id IN (
                SELECT TRY_CONVERT(uniqueidentifier, value)
                FROM STRING_SPLIT(@courseIds, ',')
            )
              AND course.org_unit_id = @orgUnitId
              AND course.is_active = 1
              AND course.archived_at IS NULL;
            """,
            connection,
            (SqlTransaction)transaction))
        {
            command.Parameters.AddWithValue("@courseIds", string.Join(',', courseIds));
            command.Parameters.AddWithValue("@orgUnitId", request.OrgUnitId.Value);
            var matchedCourses = Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken));
            if (matchedCourses != courseIds.Length)
            {
                throw new WorkflowValidationException("Every sampled course must belong to the selected sub-team.");
            }
        }

        foreach (var action in request.Actions ?? [])
        {
            if (string.IsNullOrWhiteSpace(action.Title))
            {
                throw new WorkflowValidationException("Every Work Scrutiny action needs an action description.");
            }

            if (action.Title.Trim().Length > 300)
            {
                throw new WorkflowValidationException("Work Scrutiny action descriptions cannot exceed 300 characters.");
            }
        }
    }

    private static async Task SyncWorkScrutinyCourseSamplesAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        Guid recordId,
        Guid orgUnitId,
        IReadOnlyList<Guid> courseIds,
        CancellationToken cancellationToken)
    {
        var ids = courseIds.Distinct().ToArray();
        await using var command = new SqlCommand(
            """
            INSERT INTO quality.work_scrutiny_course_samples (record_id, course_id)
            SELECT @recordId, course.id
            FROM curriculum.courses course
            WHERE course.id IN (
                SELECT TRY_CONVERT(uniqueidentifier, value)
                FROM STRING_SPLIT(@courseIds, ',')
            )
              AND course.org_unit_id = @orgUnitId
              AND course.is_active = 1
              AND course.archived_at IS NULL;

            DECLARE @sampleSize int = (
                SELECT COUNT(*)
                FROM quality.work_scrutiny_course_samples
                WHERE record_id = @recordId
            );
            DECLARE @courseCodes nvarchar(max) = (
                SELECT STRING_AGG(course.course_code, ', ')
                FROM quality.work_scrutiny_course_samples sample
                JOIN curriculum.courses course ON course.id = sample.course_id
                WHERE sample.record_id = @recordId
            );
            DECLARE @courseSummary nvarchar(max) = (
                SELECT STRING_AGG(CONCAT(course.course_code, ' - ', course.course_name), '; ')
                FROM quality.work_scrutiny_course_samples sample
                JOIN curriculum.courses course ON course.id = sample.course_id
                WHERE sample.record_id = @recordId
            );

            UPDATE core.records
            SET summary = @courseSummary,
                updated_at = sysutcdatetime()
            WHERE id = @recordId;

            UPDATE detail
            SET sample_size = @sampleSize,
                work_type = @courseCodes,
                updated_at = sysutcdatetime()
            FROM quality.work_scrutiny_details detail
            JOIN quality.activities activity ON activity.id = detail.activity_id
            WHERE activity.record_id = @recordId;
            """,
            connection,
            (SqlTransaction)transaction);
        command.Parameters.AddWithValue("@recordId", recordId);
        command.Parameters.AddWithValue("@orgUnitId", orgUnitId);
        command.Parameters.AddWithValue("@courseIds", string.Join(',', ids));
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task CreateSubmissionActionsAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        Guid recordId,
        IReadOnlyList<SubmitLinkedActionRequest> actions,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        foreach (var action in actions)
        {
            var actionId = Guid.NewGuid();
            await using (var command = new SqlCommand(
                """
                INSERT INTO quality.actions (
                    id,
                    source_record_id,
                    owner_staff_id,
                    title,
                    status_lookup_value_id,
                    due_date,
                    published_to_staff,
                    created_by_user_account_id
                )
                SELECT
                    @id,
                    @recordId,
                    staff.id,
                    @title,
                    (
                        SELECT TOP (1) value.id
                        FROM core.lookup_values value
                        JOIN core.lookup_types type ON type.id = value.lookup_type_id
                        WHERE type.lookup_key = 'action_status'
                          AND value.value_key = 'open'
                    ),
                    @dueDate,
                    1,
                    @createdByUserAccountId
                FROM people.staff staff
                WHERE staff.id = @ownerStaffId
                  AND staff.archived_at IS NULL
                  AND staff.account_status = 'active';
                """,
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@id", actionId);
                command.Parameters.AddWithValue("@recordId", recordId);
                command.Parameters.AddWithValue("@ownerStaffId", action.OwnerStaffId);
                command.Parameters.AddWithValue("@title", action.Title.Trim());
                command.Parameters.AddWithValue("@dueDate", action.DueDate.ToDateTime(TimeOnly.MinValue));
                command.Parameters.AddWithValue("@createdByUserAccountId", ToDbValue(currentUser.UserAccountId));
                if (await command.ExecuteNonQueryAsync(cancellationToken) == 0)
                {
                    throw new WorkflowValidationException("One of the selected action owners is not an active staff member.");
                }
            }

            await WriteAuditAsync(
                connection,
                transaction,
                currentUser.UserAccountId,
                recordId,
                "action",
                actionId,
                "action.created",
                $"Work Scrutiny action '{action.Title.Trim()}' created by {currentUser.DisplayName}.",
                null,
                JsonSerializer.Serialize(new
                {
                    title = action.Title.Trim(),
                    ownerStaffId = action.OwnerStaffId,
                    dueDate = action.DueDate.ToString("yyyy-MM-dd"),
                    status = "open"
                }),
                cancellationToken);
        }
    }

    private static Dictionary<string, string> MapResponsesByFieldKey(
        Dictionary<Guid, FormFieldInfo> fields,
        IReadOnlyList<SubmitFormResponseRequest> responses)
    {
        var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var response in responses)
        {
            if (!string.IsNullOrWhiteSpace(response.Value) && fields.TryGetValue(response.FieldId, out var field))
            {
                values[field.FieldKey] = response.Value!;
            }
        }

        return values;
    }

    private static async Task InsertFormResponseAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        Guid submissionId,
        SubmitFormResponseRequest response,
        string fieldType,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            """
            INSERT INTO forms.form_responses (
                form_submission_id,
                form_field_id,
                response_text,
                response_date
            )
            VALUES (
                @formSubmissionId,
                @formFieldId,
                @responseText,
                @responseDate
            );
            """,
            connection,
            (SqlTransaction)transaction);

        var responseDate = DateOnly.TryParse(response.Value, out var parsedDate)
            && string.Equals(fieldType, "date", StringComparison.OrdinalIgnoreCase)
                ? parsedDate
                : (DateOnly?)null;

        command.Parameters.AddWithValue("@formSubmissionId", submissionId);
        command.Parameters.AddWithValue("@formFieldId", response.FieldId);
        command.Parameters.AddWithValue("@responseText", responseDate.HasValue ? DBNull.Value : ToDbValue(response.Value));
        command.Parameters.AddWithValue("@responseDate", ToDbValue(responseDate));
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task UpsertFormResponseAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        Guid submissionId,
        SubmitFormResponseRequest response,
        string fieldType,
        CancellationToken cancellationToken)
    {
        var responseDate = DateOnly.TryParse(response.Value, out var parsedDate)
            && string.Equals(fieldType, "date", StringComparison.OrdinalIgnoreCase)
                ? parsedDate
                : (DateOnly?)null;
        var hasValue = !string.IsNullOrWhiteSpace(response.Value);

        await using var command = new SqlCommand(
            """
            IF EXISTS (
                SELECT 1
                FROM forms.form_responses
                WHERE form_submission_id = @formSubmissionId
                  AND form_field_id = @formFieldId
            )
            BEGIN
                UPDATE forms.form_responses
                SET response_text = @responseText,
                    response_number = NULL,
                    response_date = @responseDate,
                    response_lookup_value_id = NULL,
                    response_json = NULL,
                    updated_at = sysutcdatetime(),
                    archived_at = CASE WHEN @hasValue = 1 THEN NULL ELSE sysutcdatetime() END
                WHERE form_submission_id = @formSubmissionId
                  AND form_field_id = @formFieldId;
            END
            ELSE IF @hasValue = 1
            BEGIN
                INSERT INTO forms.form_responses (
                    form_submission_id,
                    form_field_id,
                    response_text,
                    response_date
                )
                VALUES (
                    @formSubmissionId,
                    @formFieldId,
                    @responseText,
                    @responseDate
                );
            END;
            """,
            connection,
            (SqlTransaction)transaction);

        command.Parameters.AddWithValue("@formSubmissionId", submissionId);
        command.Parameters.AddWithValue("@formFieldId", response.FieldId);
        command.Parameters.AddWithValue("@responseText", responseDate.HasValue || !hasValue ? DBNull.Value : response.Value!.Trim());
        command.Parameters.AddWithValue("@responseDate", ToDbValue(responseDate));
        command.Parameters.AddWithValue("@hasValue", hasValue);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    /// <summary>
    /// Keeps module-specific reporting tables in step with the universal record:
    /// learning walks and work scrutiny maintain quality.activities (+ scrutiny details),
    /// CPD events maintain cpd.cpd_events and attendance credits.
    /// </summary>
    private static async Task ApplyModuleSideEffectsAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        Guid recordId,
        string recordType,
        Guid? orgUnitId,
        DateOnly? recordDate,
        Guid? subjectStaffId,
        Dictionary<string, string> valuesByFieldKey,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        var isLearningWalk = string.Equals(recordType, "learning_walk", StringComparison.OrdinalIgnoreCase);
        var isWorkScrutiny = string.Equals(recordType, "work_scrutiny", StringComparison.OrdinalIgnoreCase);
        var isCpdEvent = string.Equals(recordType, "cpd_event", StringComparison.OrdinalIgnoreCase);
        var isElevateEnvironment = string.Equals(recordType, "elevate_environment", StringComparison.OrdinalIgnoreCase);

        if ((isLearningWalk || isWorkScrutiny) && recordDate.HasValue)
        {
            var reviewerStaffId = currentUser.StaffId;
            if (isWorkScrutiny
                && valuesByFieldKey.TryGetValue("reviewer", out var reviewerValue)
                && Guid.TryParse(reviewerValue, out var parsedReviewer))
            {
                reviewerStaffId = parsedReviewer;
            }

            await using (var command = new SqlCommand(
                """
                IF EXISTS (SELECT 1 FROM quality.activities WHERE record_id = @recordId)
                BEGIN
                    UPDATE quality.activities
                    SET activity_date = @activityDate,
                        subject_staff_id = @subjectStaffId,
                        reviewer_staff_id = COALESCE(@reviewerStaffId, reviewer_staff_id),
                        org_unit_id = @orgUnitId,
                        updated_at = sysutcdatetime()
                    WHERE record_id = @recordId;
                END
                ELSE
                BEGIN
                    INSERT INTO quality.activities (record_id, activity_type, activity_date, subject_staff_id, reviewer_staff_id, org_unit_id)
                    VALUES (@recordId, @activityType, @activityDate, @subjectStaffId, @reviewerStaffId, @orgUnitId);
                END;
                """,
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@recordId", recordId);
                command.Parameters.AddWithValue("@activityType", recordType);
                command.Parameters.AddWithValue("@activityDate", ToDbValue(recordDate));
                command.Parameters.AddWithValue("@subjectStaffId", ToDbValue(subjectStaffId));
                command.Parameters.AddWithValue("@reviewerStaffId", ToDbValue(reviewerStaffId));
                command.Parameters.AddWithValue("@orgUnitId", ToDbValue(orgUnitId));
                await command.ExecuteNonQueryAsync(cancellationToken);
            }
        }

        if (isWorkScrutiny && recordDate.HasValue)
        {
            int? sampleSize = valuesByFieldKey.TryGetValue("sample_size", out var sampleValue)
                && int.TryParse(sampleValue, out var parsedSample)
                    ? parsedSample
                    : null;

            await using var command = new SqlCommand(
                """
                DECLARE @activityId uniqueidentifier = (SELECT id FROM quality.activities WHERE record_id = @recordId);
                IF @activityId IS NOT NULL
                BEGIN
                    IF EXISTS (SELECT 1 FROM quality.work_scrutiny_details WHERE activity_id = @activityId)
                    BEGIN
                        UPDATE quality.work_scrutiny_details
                        SET sample_size = @sampleSize,
                            work_type = @workType,
                            updated_at = sysutcdatetime()
                        WHERE activity_id = @activityId;
                    END
                    ELSE
                    BEGIN
                        INSERT INTO quality.work_scrutiny_details (activity_id, sample_size, work_type)
                        VALUES (@activityId, @sampleSize, @workType);
                    END;
                END;
                """,
                connection,
                (SqlTransaction)transaction);

            command.Parameters.AddWithValue("@recordId", recordId);
            command.Parameters.AddWithValue("@sampleSize", sampleSize.HasValue ? sampleSize.Value : DBNull.Value);
            command.Parameters.AddWithValue("@workType", ToDbValue(valuesByFieldKey.TryGetValue("course_or_unit", out var workType) ? workType : null));
            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        if (isElevateEnvironment)
        {
            if (!valuesByFieldKey.TryGetValue("room_code", out var roomCode)
                || string.IsNullOrWhiteSpace(roomCode))
            {
                throw new WorkflowValidationException("Select a room from the room register.");
            }

            var valueKeys = new[] { "aspirational", "collaborative", "respectful", "innovative", "inclusion" };
            var scores = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            foreach (var valueKey in valueKeys)
            {
                if (!valuesByFieldKey.TryGetValue($"{valueKey}_score", out var scoreValue)
                    || !int.TryParse(scoreValue, out var score)
                    || score is < 0 or > 3)
                {
                    throw new WorkflowValidationException("Every Elevate value needs a score from 0 to 3.");
                }
                scores[valueKey] = score;
            }

            Guid roomId;
            await using (var command = new SqlCommand(
                """
                SELECT id
                FROM quality.rooms
                WHERE room_code = @roomCode
                  AND is_active = 1
                  AND archived_at IS NULL;
                """,
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@roomCode", roomCode.Trim());
                roomId = (Guid?)(await command.ExecuteScalarAsync(cancellationToken))
                    ?? throw new WorkflowValidationException("The selected room is not in the active room register.");
            }

            await using (var command = new SqlCommand(
                """
                IF EXISTS (SELECT 1 FROM quality.elevate_environment_assessments WHERE record_id = @recordId)
                BEGIN
                    UPDATE quality.elevate_environment_assessments
                    SET room_id = @roomId,
                        total_score = @totalScore,
                        scored_value_count = @scoreCount,
                        barrier_count = @barrierCount,
                        updated_at = sysutcdatetime()
                    WHERE record_id = @recordId;
                END
                ELSE
                BEGIN
                    INSERT INTO quality.elevate_environment_assessments (
                        record_id, room_id, total_score, scored_value_count, barrier_count
                    )
                    VALUES (
                        @recordId, @roomId, @totalScore, @scoreCount, @barrierCount
                    );
                END;
                """,
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@recordId", recordId);
                command.Parameters.AddWithValue("@roomId", roomId);
                command.Parameters.AddWithValue("@totalScore", scores.Values.Sum());
                command.Parameters.AddWithValue("@scoreCount", scores.Count);
                command.Parameters.AddWithValue("@barrierCount", scores.Values.Count(score => score == 0));
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            foreach (var valueKey in valueKeys)
            {
                valuesByFieldKey.TryGetValue($"{valueKey}_action", out var actionText);
                valuesByFieldKey.TryGetValue($"{valueKey}_owner", out var ownerValue);
                valuesByFieldKey.TryGetValue($"{valueKey}_target", out var targetValue);

                if (scores[valueKey] == 0 && string.IsNullOrWhiteSpace(actionText))
                {
                    throw new WorkflowValidationException(
                        $"A Barrier score for {FormatElevateValue(valueKey)} requires an immediate action.");
                }

                Guid? ownerStaffId = Guid.TryParse(ownerValue, out var parsedOwner) ? parsedOwner : null;
                DateOnly? targetDate = DateOnly.TryParse(targetValue, out var parsedTarget) ? parsedTarget : null;
                if (!string.IsNullOrWhiteSpace(actionText) && (!ownerStaffId.HasValue || !targetDate.HasValue))
                {
                    throw new WorkflowValidationException(
                        $"The {FormatElevateValue(valueKey)} action needs an owner and target date.");
                }

                await SyncElevateActionAsync(
                    connection,
                    transaction,
                    recordId,
                    valueKey,
                    actionText,
                    ownerStaffId,
                    targetDate,
                    currentUser,
                    cancellationToken);
            }
        }

        if (isCpdEvent)
        {
            var eventTitle = valuesByFieldKey.TryGetValue("cpd_title", out var cpdTitle) ? cpdTitle : "CPD event";
            DateOnly? eventDate = recordDate;
            TimeOnly? startTime = null;
            if (valuesByFieldKey.TryGetValue("date_time", out var dateTimeValue)
                && DateTime.TryParse(dateTimeValue, out var parsedDateTime))
            {
                eventDate = DateOnly.FromDateTime(parsedDateTime);
                startTime = TimeOnly.FromDateTime(parsedDateTime);
            }

            if (!eventDate.HasValue)
            {
                return;
            }

            Guid cpdEventId;
            await using (var command = new SqlCommand(
                """
                DECLARE @eventId uniqueidentifier = (SELECT id FROM cpd.cpd_events WHERE record_id = @recordId);
                IF @eventId IS NULL
                BEGIN
                    SET @eventId = newid();
                    INSERT INTO cpd.cpd_events (id, record_id, event_title, event_date, start_time, delivery_method, facilitator_staff_id)
                    VALUES (@eventId, @recordId, @eventTitle, @eventDate, @startTime, @deliveryMethod, @facilitatorStaffId);
                END
                ELSE
                BEGIN
                    UPDATE cpd.cpd_events
                    SET event_title = @eventTitle,
                        event_date = @eventDate,
                        start_time = @startTime,
                        delivery_method = @deliveryMethod,
                        updated_at = sysutcdatetime()
                    WHERE id = @eventId;
                END;
                SELECT @eventId;
                """,
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@recordId", recordId);
                command.Parameters.AddWithValue("@eventTitle", eventTitle);
                command.Parameters.AddWithValue("@eventDate", eventDate.Value.ToDateTime(TimeOnly.MinValue));
                command.Parameters.AddWithValue("@startTime", startTime.HasValue ? startTime.Value.ToTimeSpan() : DBNull.Value);
                command.Parameters.AddWithValue("@deliveryMethod", ToDbValue(valuesByFieldKey.TryGetValue("delivery_mode", out var delivery) ? delivery : null));
                command.Parameters.AddWithValue("@facilitatorStaffId", ToDbValue(currentUser.StaffId));
                cpdEventId = (Guid)(await command.ExecuteScalarAsync(cancellationToken)
                    ?? throw new InvalidOperationException("CPD event upsert did not return an id."));
            }

            var attendeeIds = valuesByFieldKey.TryGetValue("staff_search", out var staffSearch)
                ? staffSearch.Split('|', StringSplitOptions.RemoveEmptyEntries)
                    .Select(value => Guid.TryParse(value, out var staffId) ? staffId : (Guid?)null)
                    .Where(value => value.HasValue)
                    .Select(value => value!.Value)
                    .Distinct()
                    .ToArray()
                : [];

            if (attendeeIds.Length == 0)
            {
                throw new WorkflowValidationException("Select at least one active participant for the CPD event.");
            }

            await using (var command = new SqlCommand(
                """
                SELECT COUNT(*)
                FROM people.staff
                WHERE id IN (SELECT TRY_CONVERT(uniqueidentifier, value) FROM STRING_SPLIT(@staffIds, '|'))
                  AND account_status = 'active'
                  AND archived_at IS NULL;
                """,
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@staffIds", string.Join('|', attendeeIds));
                var activeAttendeeCount = Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken));
                if (activeAttendeeCount != attendeeIds.Length)
                {
                    throw new WorkflowValidationException("Every CPD participant must be an active staff member.");
                }
            }

            await using (var command = new SqlCommand(
                "DELETE FROM cpd.cpd_attendance WHERE cpd_event_id = @eventId;",
                connection,
                (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@eventId", cpdEventId);
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            foreach (var attendeeId in attendeeIds)
            {
                await using var command = new SqlCommand(
                    """
                    INSERT INTO cpd.cpd_attendance (cpd_event_id, staff_id, org_unit_id_at_time, attendance_status)
                    SELECT @eventId, s.id, s.primary_org_unit_id, 'Attended'
                    FROM people.staff s
                    WHERE s.id = @staffId AND s.archived_at IS NULL;
                    """,
                    connection,
                    (SqlTransaction)transaction);

                command.Parameters.AddWithValue("@eventId", cpdEventId);
                command.Parameters.AddWithValue("@staffId", attendeeId);
                await command.ExecuteNonQueryAsync(cancellationToken);
            }
        }
    }

    private static async Task SyncElevateActionAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        Guid recordId,
        string valueKey,
        string? actionText,
        Guid? ownerStaffId,
        DateOnly? targetDate,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        var actionTitle = string.IsNullOrWhiteSpace(actionText)
            ? null
            : $"{FormatElevateValue(valueKey)}: {actionText.Trim()}";
        if (actionTitle?.Length > 300)
        {
            actionTitle = actionTitle[..300];
        }

        await using var command = new SqlCommand(
            """
            DECLARE @actionId uniqueidentifier = (
                SELECT action_id
                FROM quality.elevate_environment_action_links
                WHERE record_id = @recordId
                  AND value_key = @valueKey
            );

            IF @actionTitle IS NULL
            BEGIN
                IF @actionId IS NOT NULL
                BEGIN
                    UPDATE quality.actions
                    SET archived_at = sysutcdatetime(),
                        updated_by_user_account_id = @currentUserAccountId,
                        updated_at = sysutcdatetime()
                    WHERE id = @actionId;

                    DELETE FROM quality.elevate_environment_action_links
                    WHERE record_id = @recordId AND value_key = @valueKey;
                END;
            END
            ELSE IF @actionId IS NOT NULL
            BEGIN
                UPDATE quality.actions
                SET owner_staff_id = @ownerStaffId,
                    title = @actionTitle,
                    detail = @actionDetail,
                    due_date = @targetDate,
                    archived_at = NULL,
                    updated_by_user_account_id = @currentUserAccountId,
                    updated_at = sysutcdatetime()
                WHERE id = @actionId;
            END
            ELSE
            BEGIN
                SET @actionId = newid();

                INSERT INTO quality.actions (
                    id,
                    source_record_id,
                    owner_staff_id,
                    title,
                    detail,
                    status_lookup_value_id,
                    due_date,
                    published_to_staff,
                    created_by_user_account_id
                )
                SELECT
                    @actionId,
                    @recordId,
                    @ownerStaffId,
                    @actionTitle,
                    @actionDetail,
                    lookup_value.id,
                    @targetDate,
                    1,
                    @currentUserAccountId
                FROM core.lookup_values lookup_value
                JOIN core.lookup_types lookup_type ON lookup_type.id = lookup_value.lookup_type_id
                WHERE lookup_type.lookup_key = 'action_status'
                  AND lookup_value.value_key = 'open';

                INSERT INTO quality.elevate_environment_action_links (record_id, value_key, action_id)
                VALUES (@recordId, @valueKey, @actionId);
            END;
            """,
            connection,
            (SqlTransaction)transaction);

        command.Parameters.AddWithValue("@recordId", recordId);
        command.Parameters.AddWithValue("@valueKey", valueKey);
        command.Parameters.AddWithValue("@actionTitle", ToDbValue(actionTitle));
        command.Parameters.AddWithValue(
            "@actionDetail",
            ToDbValue(string.IsNullOrWhiteSpace(actionText)
                ? null
                : $"Elevate Learning Environments action for {FormatElevateValue(valueKey)}. {actionText.Trim()}"));
        command.Parameters.AddWithValue("@ownerStaffId", ToDbValue(ownerStaffId));
        command.Parameters.AddWithValue("@targetDate", ToDbValue(targetDate));
        command.Parameters.AddWithValue("@currentUserAccountId", ToDbValue(currentUser.UserAccountId));
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static string FormatElevateValue(string valueKey) => valueKey switch
    {
        "aspirational" => "Aspirational",
        "collaborative" => "Collaborative",
        "respectful" => "Respectful",
        "innovative" => "Innovative",
        "inclusion" => "Inclusion",
        _ => valueKey
    };

    private static async Task<SubmissionEditInfo?> GetSubmissionEditInfoAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        Guid submissionId,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            """
            SELECT
                fsub.record_id,
                fsub.form_template_version_id,
                r.owner_staff_id,
                r.record_type,
                fsub.status,
                r.title,
                r.summary,
                r.org_unit_id,
                r.record_date
            FROM forms.form_submissions fsub
            JOIN core.records r ON r.id = fsub.record_id
            WHERE fsub.id = @submissionId
              AND fsub.archived_at IS NULL
              AND r.archived_at IS NULL;
            """,
            connection,
            (SqlTransaction)transaction);

        command.Parameters.AddWithValue("@submissionId", submissionId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        return new SubmissionEditInfo(
            reader.GetGuid(0),
            reader.GetGuid(1),
            GetGuidOrNull(reader, 2),
            reader.GetString(3),
            reader.GetString(4),
            reader.GetString(5),
            GetStringOrNull(reader, 6),
            GetGuidOrNull(reader, 7),
            GetDateOnlyOrNull(reader, 8));
    }

    private static async Task<Dictionary<string, string>> GetResponsesByFieldKeyAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        Guid submissionId,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            """
            SELECT ff.field_key,
                   COALESCE(fr.response_text, CONVERT(nvarchar(10), fr.response_date, 23)) AS response_value
            FROM forms.form_responses fr
            JOIN forms.form_fields ff ON ff.id = fr.form_field_id
            WHERE fr.form_submission_id = @submissionId
              AND fr.archived_at IS NULL;
            """,
            connection,
            (SqlTransaction)transaction);

        command.Parameters.AddWithValue("@submissionId", submissionId);

        var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var value = GetStringOrNull(reader, 1);
            if (!string.IsNullOrWhiteSpace(value))
            {
                values[reader.GetString(0)] = value;
            }
        }

        return values;
    }

    private static string SerializeSubmissionSnapshot(
        string title,
        string? summary,
        Guid? orgUnitId,
        DateOnly? recordDate,
        string status,
        Dictionary<string, string> responsesByFieldKey) =>
        JsonSerializer.Serialize(new
        {
            title,
            summary,
            orgUnitId,
            recordDate = recordDate?.ToString("yyyy-MM-dd"),
            status,
            responses = responsesByFieldKey
        });

    private static IReadOnlyList<string> ParseFieldOptions(string? configurationJson)
    {
        if (string.IsNullOrWhiteSpace(configurationJson))
        {
            return [];
        }

        try
        {
            using var document = JsonDocument.Parse(configurationJson);
            if (!document.RootElement.TryGetProperty("options", out var options)
                || options.ValueKind != JsonValueKind.Array)
            {
                return [];
            }

            return options
                .EnumerateArray()
                .Where(option => option.ValueKind == JsonValueKind.String)
                .Select(option => option.GetString()?.Trim())
                .Where(option => !string.IsNullOrWhiteSpace(option))
                .Select(option => option!)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private static string? SerializeFieldConfiguration(IReadOnlyList<string>? options)
    {
        var normalized = options?
            .Select(option => option.Trim())
            .Where(option => !string.IsNullOrWhiteSpace(option))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray() ?? [];
        return normalized.Length == 0 ? null : JsonSerializer.Serialize(new { options = normalized });
    }

    private static async Task WriteAuditAsync(
        SqlConnection connection,
        System.Data.Common.DbTransaction transaction,
        Guid? userAccountId,
        Guid? recordId,
        string entityName,
        Guid? entityId,
        string action,
        string summary,
        string? beforeJson,
        string? afterJson,
        CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand(
            """
            INSERT INTO ops.audit_logs (user_account_id, record_id, entity_name, entity_id, action, summary, before_json, after_json)
            VALUES (@userAccountId, @recordId, @entityName, @entityId, @action, @summary, @beforeJson, @afterJson);
            """,
            connection,
            (SqlTransaction)transaction);

        command.Parameters.AddWithValue("@userAccountId", ToDbValue(userAccountId));
        command.Parameters.AddWithValue("@recordId", ToDbValue(recordId));
        command.Parameters.AddWithValue("@entityName", entityName);
        command.Parameters.AddWithValue("@entityId", ToDbValue(entityId));
        command.Parameters.AddWithValue("@action", action);
        command.Parameters.AddWithValue("@summary", summary);
        command.Parameters.AddWithValue("@beforeJson", ToDbValue(beforeJson));
        command.Parameters.AddWithValue("@afterJson", ToDbValue(afterJson));
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private async Task<IReadOnlyList<T>> QueryAsync<T>(
        string sql,
        Func<SqlDataReader, T> map,
        CancellationToken cancellationToken)
    {
        return await QueryAsync(sql, null, map, cancellationToken);
    }

    private async Task<IReadOnlyList<T>> QueryAsync<T>(
        string sql,
        Action<SqlCommand>? configureCommand,
        Func<SqlDataReader, T> map,
        CancellationToken cancellationToken)
    {
        var results = new List<T>();
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var command = new SqlCommand(sql, connection);
        configureCommand?.Invoke(command);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);

        while (await reader.ReadAsync(cancellationToken))
        {
            results.Add(map(reader));
        }

        return results;
    }

    private static void AddScopeParameters(SqlCommand command, CurrentUser currentUser)
    {
        command.Parameters.AddWithValue("@currentUserAccountId", ToDbValue(currentUser.UserAccountId));
        command.Parameters.AddWithValue("@currentStaffId", ToDbValue(currentUser.StaffId));
        command.Parameters.AddWithValue("@canViewAll", CanViewAllRecords(currentUser));
        command.Parameters.AddWithValue("@canViewScopedActivities", CanViewScopedActivities(currentUser));
    }

    private static bool CanViewAllStaff(CurrentUser currentUser) =>
        currentUser.HasPermission(PermissionKeys.StaffManage)
        || currentUser.HasPermission(PermissionKeys.UsersManage)
        || currentUser.HasPermission(PermissionKeys.ReportsViewAll);

    private static bool CanViewAllRecords(CurrentUser currentUser) =>
        currentUser.HasPermission(PermissionKeys.FormsManage)
        || currentUser.HasPermission(PermissionKeys.ReportsViewAll);

    private static bool CanViewScopedActivities(CurrentUser currentUser) =>
        currentUser.HasPermission(PermissionKeys.ReportsViewScoped)
        || currentUser.HasPermission(PermissionKeys.LearningWalkSubmit)
        || currentUser.HasPermission(PermissionKeys.WorkScrutinySubmit)
        || currentUser.HasPermission(PermissionKeys.ElevateSubmit)
        || currentUser.HasPermission(PermissionKeys.ElevateManage)
        || currentUser.HasPermission(PermissionKeys.CoachingSubmit)
        || currentUser.HasPermission(PermissionKeys.CoachingManage)
        || currentUser.HasPermission(PermissionKeys.ActionsManage);

    private async Task<SqlConnection> OpenConnectionAsync(CancellationToken cancellationToken)
    {
        var connection = new SqlConnection(_connectionString);

        try
        {
            await connection.OpenAsync(cancellationToken);
            return connection;
        }
        catch
        {
            await connection.DisposeAsync();
            throw;
        }
    }

    private static string? GetStringOrNull(SqlDataReader reader, int ordinal) =>
        reader.IsDBNull(ordinal) ? null : reader.GetString(ordinal);

    private static Guid? GetGuidOrNull(SqlDataReader reader, int ordinal) =>
        reader.IsDBNull(ordinal) ? null : reader.GetGuid(ordinal);

    private static IReadOnlyList<Guid> ParseGuidValues(string? values) =>
        string.IsNullOrWhiteSpace(values)
            ? []
            : values.Split('|', StringSplitOptions.RemoveEmptyEntries)
                .Select(Guid.Parse)
                .ToArray();

    private static DateOnly? GetDateOnlyOrNull(SqlDataReader reader, int ordinal) =>
        reader.IsDBNull(ordinal) ? null : DateOnly.FromDateTime(reader.GetDateTime(ordinal));

    private static DateTimeOffset? GetDateTimeOffsetOrNull(SqlDataReader reader, int ordinal) =>
        reader.IsDBNull(ordinal) ? null : reader.GetFieldValue<DateTimeOffset>(ordinal);

    private static object ToDbValue(string? value) =>
        string.IsNullOrWhiteSpace(value) ? DBNull.Value : value;

    private static object ToDbValue(Guid? value) =>
        value.HasValue ? value.Value : DBNull.Value;

    private static object ToDbValue(DateOnly? value) =>
        value.HasValue ? value.Value.ToDateTime(TimeOnly.MinValue) : DBNull.Value;

    private static object ToDbValue(bool? value) =>
        value.HasValue ? value.Value : DBNull.Value;

    private static string Slugify(string value)
    {
        var builder = new StringBuilder();
        foreach (var character in value.Trim().ToLowerInvariant())
        {
            if (char.IsLetterOrDigit(character))
            {
                builder.Append(character);
            }
            else if (builder.Length > 0 && builder[^1] != '_')
            {
                builder.Append('_');
            }
        }

        var slug = builder.ToString().Trim('_');
        return string.IsNullOrWhiteSpace(slug) ? "template" : slug;
    }

    private sealed record LookupRow(string LookupKey, string Name, string? Value);
    private sealed record TemplateVersionInfo(Guid TemplateId, Guid ModuleId, Guid VersionId, bool IsPublished);

    private sealed record FormTemplateRow(
        Guid Id,
        Guid ModuleId,
        string ModuleKey,
        string ModuleName,
        string TemplateKey,
        string Name,
        string? Version,
        string Status,
        bool IsEditable,
        Guid? AssignedOrgUnitId,
        string? AssignedOrgCode,
        string? AssignedOrgName,
        int SubmissionCount);

    private sealed record FormDefinitionRow(
        Guid TemplateId,
        Guid VersionId,
        string TemplateKey,
        string TemplateName,
        string VersionLabel,
        Guid SectionId,
        string SectionKey,
        string SectionTitle,
        int SectionDisplayOrder,
        Guid FieldId,
        string FieldKey,
        string Label,
        string FieldType,
        bool IsRequired,
        int FieldDisplayOrder,
        string? HelpText,
        string? ConfigurationJson);

    private sealed record RecordDetailRow(
        Guid Id,
        string ModuleKey,
        string ModuleName,
        string RecordType,
        string Title,
        string? Summary,
        Guid? OwnerStaffId,
        string? OwnerDisplayName,
        Guid? OrgUnitId,
        string? OrgUnitCode,
        string? OrgUnitName,
        string? ParentOrgUnitCode,
        DateOnly? RecordDate,
        DateTimeOffset CreatedAt,
        Guid SubmissionId,
        string TemplateKey,
        string TemplateName,
        string TemplateVersion,
        string SubmissionStatus,
        DateTimeOffset? SubmittedAt,
        Guid SectionId,
        string SectionKey,
        string SectionTitle,
        int SectionDisplayOrder,
        Guid FieldId,
        string FieldKey,
        string Label,
        string FieldType,
        bool IsRequired,
        int FieldDisplayOrder,
        string? HelpText,
        string? ConfigurationJson,
        string? ResponseValue);

    private sealed record SubmissionEditInfo(
        Guid RecordId,
        Guid VersionId,
        Guid? OwnerStaffId,
        string RecordType,
        string Status,
        string Title,
        string? Summary,
        Guid? OrgUnitId,
        DateOnly? RecordDate);

    private sealed record FormFieldInfo(string FieldType, string FieldKey, bool IsRequired, string Label);

    private sealed record ActionEditInfo(
        Guid OwnerStaffId,
        string Title,
        string? Detail,
        DateOnly? DueDate,
        DateOnly? CompletedDate,
        string? CompletionNote,
        Guid? SourceRecordId,
        string? StatusKey);

    private sealed record LivEditInfo(
        Guid RecordId,
        Guid? ReviewerStaffId,
        string Status,
        string? SnapshotJson);

    private sealed record StaffProfileHeaderRow(
        Guid StaffId,
        string ExternalId,
        string DisplayName,
        string Email,
        string? PrimaryOrgCode,
        string AccountStatus,
        int EvidenceSubmitted,
        int MilestonesCompleted);

    private sealed record ReflectionPointInfo(Guid Id, string Name, Guid MilestoneLookupValueId);

    private sealed record ReflectionEvidenceInfo(Guid Id, string? Text, DateOnly CompletionDate);

    private sealed record AdminUserRow(
        Guid UserAccountId,
        Guid StaffId,
        string ExternalId,
        string DisplayName,
        string Email,
        string? JobTitle,
        Guid? PrimaryOrgUnitId,
        string? PrimaryOrgCode,
        string AccountStatus,
        bool IsDisabled,
        DateTimeOffset? LastLoginAt,
        string? RoleKey,
        string? RoleName,
        string? ScopeType,
        Guid? ScopeOrgUnitId,
        string? ScopeOrgCode);

    private sealed record AdminRoleRow(
        Guid Id,
        string RoleKey,
        string Name,
        string? Description,
        bool IsSystem,
        int Precedence,
        string? PermissionKey,
        string? PermissionName,
        string? PermissionCategory);

    private sealed record AdminUserEditInfo(
        Guid StaffId,
        string AccountStatus,
        bool IsDisabled,
        string DisplayName,
        string? JobTitle,
        Guid? PrimaryOrgUnitId);

    private sealed record TemplateEditInfo(
        string Name,
        string ModuleKey,
        Guid VersionId,
        bool IsPublished,
        int SubmissionCount,
        int FieldCount);
}
