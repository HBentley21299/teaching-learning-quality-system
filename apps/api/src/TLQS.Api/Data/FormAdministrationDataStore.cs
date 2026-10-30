using System.Data;
using System.Data.Common;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    public async Task<FormTemplateAdministration?> GetFormTemplateAdministrationAsync(Guid templateId, Guid? versionId, CurrentUser user, CancellationToken cancellationToken)
    {
        RequireFormAdministrator(user);
        await using var connection = await OpenConnectionAsync(cancellationToken);
        var header = await ReadFormAdminHeaderAsync(connection, null, templateId, cancellationToken);
        if (header is null || !FormAdministrationRules.SupportsModule(header.ModuleKey)) return null;
        var versions = await ReadFormAdminVersionsAsync(connection, null, templateId, cancellationToken);
        var selected = versionId.HasValue ? versions.FirstOrDefault(version => version.Id == versionId) : versions.FirstOrDefault(version => version.Status == "Draft") ?? versions.FirstOrDefault();
        if (selected is null) return null;
        var token = await ReadFormVersionTokenAsync(connection, null, templateId, selected.Id, cancellationToken);
        var sections = await ReadFormAdminSectionsAsync(connection, null, selected.Id, header.ModuleKey, cancellationToken);
        var metadata = await ReadFormAdminMetadataAsync(connection, null, selected.Id, header, cancellationToken);
        return new(templateId, header.TemplateKey, header.ModuleKey, metadata.Name, metadata.Description, selected.Id, selected.Version,
            Convert.ToBase64String(token!), selected.Status, selected.SubmissionCount, sections, versions);
    }

    public async Task<Guid> CreateFormVersionDraftAsync(Guid templateId, Guid sourceVersionId, CurrentUser user, CancellationToken cancellationToken)
    {
        RequireFormAdministrator(user);
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var header = await RequireFormAdminHeaderAsync(connection, transaction, templateId, cancellationToken);
        var versions = await ReadFormAdminVersionsAsync(connection, transaction, templateId, cancellationToken);
        if (versions.Any(version => version.Status == "Draft"))
            throw new WorkflowValidationException("This form already has an unpublished draft. Open that draft before creating another version.");
        if (!versions.Any(version => version.Id == sourceVersionId)) throw new WorkflowValidationException("Choose a version belonging to this form.");
        var id = Guid.NewGuid();
        await using (var command = new SqlCommand("""
            INSERT INTO forms.form_template_versions(id,form_template_id,version_label,is_published,created_by_user_account_id,display_name,description)
            SELECT @id,@templateId,@label,0,@userId,COALESCE(display_name,@name),CASE WHEN display_name IS NULL THEN @description ELSE description END
            FROM forms.form_template_versions WHERE id=@sourceId AND form_template_id=@templateId;
            """, connection, (SqlTransaction)transaction))
        {
            command.Parameters.AddWithValue("@id", id);
            command.Parameters.AddWithValue("@templateId", templateId);
            command.Parameters.AddWithValue("@label", $"Draft {DateTimeOffset.UtcNow:yyyyMMdd-HHmmss}-{Guid.NewGuid():N}"[..35]);
            command.Parameters.AddWithValue("@userId", ToDbValue(user.UserAccountId));
            command.Parameters.AddWithValue("@sourceId", sourceVersionId);
            command.Parameters.AddWithValue("@name", header.Name);
            command.Parameters.AddWithValue("@description", ToDbValue(header.Description));
            await command.ExecuteNonQueryAsync(cancellationToken);
        }
        // New IDs isolate every draft from responses to any previously published version.
        await using (var command = new SqlCommand("""
            DECLARE @sections TABLE(old_id uniqueidentifier,new_id uniqueidentifier);
            INSERT INTO @sections SELECT id,NEWID() FROM forms.form_sections WHERE form_template_version_id=@sourceId AND archived_at IS NULL;
            INSERT INTO forms.form_sections(id,form_template_version_id,section_key,title,description,display_order)
                SELECT map.new_id,@id,source.section_key,source.title,source.description,source.display_order
                FROM forms.form_sections source JOIN @sections map ON map.old_id=source.id;
            INSERT INTO forms.form_fields(form_section_id,field_key,label,field_type,options_lookup_type_id,is_required,display_order,help_text,validation_json,configuration_json,is_active)
                SELECT map.new_id,field.field_key,field.label,field.field_type,field.options_lookup_type_id,field.is_required,field.display_order,field.help_text,field.validation_json,field.configuration_json,field.is_active
                FROM forms.form_fields field JOIN @sections map ON map.old_id=field.form_section_id
                WHERE field.archived_at IS NULL;
            """, connection, (SqlTransaction)transaction))
        {
            command.Parameters.AddWithValue("@id", id);
            command.Parameters.AddWithValue("@sourceId", sourceVersionId);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }
        if (header.ModuleKey == "work_scrutiny") await EnsureWorkScrutinyCoreQuestionsAsync(connection, transaction, id, cancellationToken);
        await WriteFormVersionAuditAsync(connection, transaction, user, templateId, "form_version.draft_created", new { versionId = id, sourceVersionId }, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return id;
    }

    public async Task SaveFormVersionAsync(Guid templateId, Guid versionId, SaveFormVersionRequest request, CurrentUser user, CancellationToken cancellationToken)
    {
        RequireFormAdministrator(user);
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var header = await RequireFormAdminHeaderAsync(connection, transaction, templateId, cancellationToken);
        await RequireEditableFormVersionAsync(connection, transaction, templateId, versionId, request.RowVersion, cancellationToken);
        var existing = await ReadFormAdminSectionsAsync(connection, transaction, versionId, header.ModuleKey, cancellationToken);
        FormAdministrationRules.Validate(header.ModuleKey, existing, request);
        // Preserve controlled field configuration (including lookup bindings and validation), not only visible options.
        var original = await ReadControlledFormConfigurationsAsync(connection, transaction, versionId, cancellationToken);
        // Inactive fields are preserved in the draft. Only its visible content is replaced.
        await using (var command = new SqlCommand("""
            DELETE field FROM forms.form_fields field JOIN forms.form_sections section ON section.id=field.form_section_id
                WHERE section.form_template_version_id=@versionId AND section.archived_at IS NULL AND field.is_active=1 AND field.archived_at IS NULL;
            """, connection, (SqlTransaction)transaction))
        {
            command.Parameters.AddWithValue("@versionId", versionId);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }
        for (var sectionIndex = 0; sectionIndex < request.Sections.Count; sectionIndex++)
        {
            var section = request.Sections[sectionIndex];
            Guid sectionId;
            await using (var command = new SqlCommand("""
                DECLARE @sectionId uniqueidentifier = (SELECT id FROM forms.form_sections WHERE form_template_version_id=@versionId AND section_key=@key);
                IF @sectionId IS NULL BEGIN SET @sectionId=NEWID();
                    INSERT INTO forms.form_sections(id,form_template_version_id,section_key,title,display_order) VALUES(@sectionId,@versionId,@key,@title,@order); END;
                ELSE UPDATE forms.form_sections SET title=@title,display_order=@order,archived_at=NULL,updated_at=sysutcdatetime() WHERE id=@sectionId;
                SELECT @sectionId;
                """, connection, (SqlTransaction)transaction))
            {
                command.Parameters.AddWithValue("@versionId", versionId); command.Parameters.AddWithValue("@key", section.SectionKey);
                command.Parameters.AddWithValue("@title", section.Title.Trim()); command.Parameters.AddWithValue("@order", sectionIndex + 1);
                sectionId = (Guid)(await command.ExecuteScalarAsync(cancellationToken))!;
            }
            for (var fieldIndex = 0; fieldIndex < section.Fields.Count; fieldIndex++)
            {
                var field = section.Fields[fieldIndex];
                var isProtected = existing.SelectMany(item => item.Fields).Any(item => item.FieldKey == field.FieldKey && item.IsProtected);
                var controlled = original.GetValueOrDefault(field.FieldKey);
                await using var command = new SqlCommand("""
                    INSERT INTO forms.form_fields(form_section_id,field_key,label,field_type,options_lookup_type_id,is_required,display_order,help_text,validation_json,configuration_json)
                    VALUES(@sectionId,@key,@label,@type,@lookup,@required,@order,@help,@validation,@configuration);
                    """, connection, (SqlTransaction)transaction);
                command.Parameters.AddWithValue("@sectionId", sectionId); command.Parameters.AddWithValue("@key", field.FieldKey);
                command.Parameters.AddWithValue("@label", field.Label.Trim()); command.Parameters.AddWithValue("@type", field.FieldType);
                command.Parameters.AddWithValue("@required", field.IsRequired); command.Parameters.AddWithValue("@order", (fieldIndex + 1) * 10);
                command.Parameters.AddWithValue("@help", ToDbValue(field.HelpText?.Trim()));
                command.Parameters.AddWithValue("@lookup", ToDbValue(isProtected ? controlled.Lookup : null));
                command.Parameters.AddWithValue("@validation", ToDbValue(isProtected ? controlled.Validation : null));
                command.Parameters.AddWithValue("@configuration", ToDbValue(isProtected ? controlled.Configuration : SerializeFieldConfiguration(field.Options)));
                await command.ExecuteNonQueryAsync(cancellationToken);
            }
        }
        // Retire removed, now-empty draft sections without deleting any published definition.
        await using (var command = new SqlCommand("""
            UPDATE section SET archived_at=sysutcdatetime() FROM forms.form_sections section
            WHERE section.form_template_version_id=@versionId AND NOT EXISTS(SELECT 1 FROM forms.form_fields field WHERE field.form_section_id=section.id AND field.archived_at IS NULL AND field.is_active=1);
            UPDATE forms.form_template_versions SET display_name=@name,description=@description,updated_at=sysutcdatetime() WHERE id=@versionId;
            """, connection, (SqlTransaction)transaction))
        {
            command.Parameters.AddWithValue("@versionId", versionId);
            command.Parameters.AddWithValue("@name", request.Name.Trim());
            command.Parameters.AddWithValue("@description", ToDbValue(request.Description));
            await command.ExecuteNonQueryAsync(cancellationToken);
        }
        if (header.ModuleKey == "work_scrutiny") await EnsureWorkScrutinyCoreQuestionsAsync(connection, transaction, versionId, cancellationToken);
        await WriteFormVersionAuditAsync(connection, transaction, user, templateId, "form_version.draft_saved", new { versionId, sectionCount = request.Sections.Count, questionCount = request.Sections.Sum(item => item.Fields.Count) }, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    public async Task PublishFormVersionAsync(Guid templateId, Guid versionId, string rowVersion, CurrentUser user, CancellationToken cancellationToken)
    {
        RequireFormAdministrator(user);
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var header = await RequireFormAdminHeaderAsync(connection, transaction, templateId, cancellationToken);
        await RequireEditableFormVersionAsync(connection, transaction, templateId, versionId, rowVersion, cancellationToken);
        if (header.ModuleKey == "work_scrutiny") await ValidateWorkScrutinyVersionAllocationAsync(connection, transaction, templateId, cancellationToken);
        var sections = await ReadFormAdminSectionsAsync(connection, transaction, versionId, header.ModuleKey, cancellationToken);
        if (header.ModuleKey == "work_scrutiny") ValidateWorkScrutinyCoreReadiness(sections);
        var metadata = await ReadFormAdminMetadataAsync(connection, transaction, versionId, header, cancellationToken);
        FormAdministrationRules.Validate(header.ModuleKey, sections, new(metadata.Name, metadata.Description, rowVersion, sections.Select(section => new FormStructureSectionRequest(section.SectionKey, section.Title, section.DisplayOrder,
            section.Fields.Select(field => new FormStructureFieldRequest(field.FieldKey, field.Label, field.FieldType, field.IsRequired, field.DisplayOrder, field.HelpText, field.Options)).ToArray())).ToArray()));
        var versions = await ReadFormAdminVersionsAsync(connection, transaction, templateId, cancellationToken);
        var major = versions.Select(item => Version.TryParse(item.Version, out var parsed) ? parsed.Major : 0).DefaultIfEmpty(0).Max() + 1;
        await using (var command = new SqlCommand("""
            UPDATE forms.form_template_versions SET active_to=sysutcdatetime(),updated_at=sysutcdatetime()
                WHERE form_template_id=@templateId AND is_published=1 AND active_to IS NULL AND id<>@versionId;
            UPDATE forms.form_template_versions SET is_published=1,active_from=sysutcdatetime(),active_to=NULL,version_label=@label,updated_at=sysutcdatetime() WHERE id=@versionId;
            """, connection, (SqlTransaction)transaction))
        {
            command.Parameters.AddWithValue("@templateId", templateId); command.Parameters.AddWithValue("@versionId", versionId); command.Parameters.AddWithValue("@label", $"{major}.0");
            await command.ExecuteNonQueryAsync(cancellationToken);
        }
        await WriteFormVersionAuditAsync(connection, transaction, user, templateId, "form_version.published", new { versionId, version = $"{major}.0" }, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    public async Task DiscardFormVersionDraftAsync(Guid templateId, Guid versionId, string rowVersion, CurrentUser user, CancellationToken cancellationToken)
    {
        RequireFormAdministrator(user);
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        await RequireFormAdminHeaderAsync(connection, transaction, templateId, cancellationToken);
        await RequireEditableFormVersionAsync(connection, transaction, templateId, versionId, rowVersion, cancellationToken);
        var versions = await ReadFormAdminVersionsAsync(connection, transaction, templateId, cancellationToken);
        if (!versions.Any(version => version.Status is "Published" or "Superseded"))
            throw new WorkflowValidationException("This is the form's first draft. Archive an unwanted Work Scrutiny template through Template creation and allocation instead.");
        await using var command = new SqlCommand("UPDATE forms.form_template_versions SET archived_at=sysutcdatetime(),updated_at=sysutcdatetime() WHERE id=@id;", connection, (SqlTransaction)transaction);
        command.Parameters.AddWithValue("@id", versionId); await command.ExecuteNonQueryAsync(cancellationToken);
        await WriteFormVersionAuditAsync(connection, transaction, user, templateId, "form_version.draft_discarded", new { versionId }, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    private static void RequireFormAdministrator(CurrentUser user)
    {
        if (!user.HasPermission(PermissionKeys.FormsManage)) throw new UnauthorizedAccessException("Form administration permission is required.");
    }
    private sealed record FormAdminHeader(string TemplateKey, string ModuleKey, string Name, string? Description, bool Archived);
    private static async Task<FormAdminHeader?> ReadFormAdminHeaderAsync(SqlConnection connection, DbTransaction? transaction, Guid templateId, CancellationToken cancellationToken)
    {
        var locking = transaction is null ? "" : "WITH(UPDLOCK,HOLDLOCK)";
        await using var command = new SqlCommand($"""
            SELECT template.template_key,module.module_key,template.name,template.description,CAST(CASE WHEN template.archived_at IS NULL THEN 0 ELSE 1 END AS bit)
            FROM forms.form_templates template {locking} JOIN core.modules module ON module.id=template.module_id WHERE template.id=@id;
            """, connection, (SqlTransaction?)transaction);
        command.Parameters.AddWithValue("@id", templateId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? new(reader.GetString(0), reader.GetString(1), reader.GetString(2), GetStringOrNull(reader, 3), reader.GetBoolean(4)) : null;
    }
    private static async Task<FormAdminHeader> RequireFormAdminHeaderAsync(SqlConnection connection, DbTransaction transaction, Guid templateId, CancellationToken cancellationToken)
    {
        var header = await ReadFormAdminHeaderAsync(connection, transaction, templateId, cancellationToken);
        if (header is null || header.Archived || !FormAdministrationRules.SupportsModule(header.ModuleKey)) throw new WorkflowValidationException("Choose an active configurable form.");
        return header;
    }
    private static async Task<IReadOnlyList<AdminFormVersion>> ReadFormAdminVersionsAsync(SqlConnection connection, DbTransaction? transaction, Guid templateId, CancellationToken cancellationToken)
    {
        var result = new List<AdminFormVersion>();
        await using var command = new SqlCommand("""
            SELECT version.id,version.version_label,CASE WHEN version.is_published=0 THEN 'Draft' WHEN version.active_to IS NOT NULL THEN 'Superseded' ELSE 'Published' END,
                (SELECT COUNT(*) FROM forms.form_submissions submission WHERE submission.form_template_version_id=version.id),version.created_at
            FROM forms.form_template_versions version WHERE version.form_template_id=@id AND version.archived_at IS NULL
            ORDER BY version.is_published,version.active_from DESC,version.created_at DESC;
            """, connection, (SqlTransaction?)transaction);
        command.Parameters.AddWithValue("@id", templateId); await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken)) result.Add(new(reader.GetGuid(0), reader.GetString(1), reader.GetString(2), reader.GetInt32(3), reader.GetFieldValue<DateTimeOffset>(4)));
        return result;
    }
    private static async Task<byte[]?> ReadFormVersionTokenAsync(SqlConnection connection, DbTransaction? transaction, Guid templateId, Guid versionId, CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand("SELECT row_version FROM forms.form_template_versions WHERE id=@id AND form_template_id=@templateId AND archived_at IS NULL;", connection, (SqlTransaction?)transaction);
        command.Parameters.AddWithValue("@id", versionId); command.Parameters.AddWithValue("@templateId", templateId);
        return await command.ExecuteScalarAsync(cancellationToken) as byte[];
    }
    private static async Task<(string Name, string? Description)> ReadFormAdminMetadataAsync(SqlConnection connection, DbTransaction? transaction, Guid versionId, FormAdminHeader header, CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand("SELECT display_name,description FROM forms.form_template_versions WHERE id=@id;", connection, (SqlTransaction?)transaction);
        command.Parameters.AddWithValue("@id", versionId); await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) return (header.Name, header.Description);
        return (GetStringOrNull(reader, 0) ?? header.Name, reader.IsDBNull(0) ? header.Description : GetStringOrNull(reader, 1));
    }
    private static async Task RequireEditableFormVersionAsync(SqlConnection connection, DbTransaction transaction, Guid templateId, Guid versionId, string rowVersion, CancellationToken cancellationToken)
    {
        byte[] expected;
        try { expected = Convert.FromBase64String(rowVersion); } catch (Exception exception) when (exception is FormatException or ArgumentNullException) { throw new WorkflowValidationException("Reload this version before making changes."); }
        await using var command = new SqlCommand("""
            SELECT row_version,is_published,(SELECT COUNT(*) FROM forms.form_submissions WHERE form_template_version_id=@id)
            FROM forms.form_template_versions WITH(UPDLOCK,HOLDLOCK) WHERE id=@id AND form_template_id=@templateId AND archived_at IS NULL;
            """, connection, (SqlTransaction)transaction);
        command.Parameters.AddWithValue("@id", versionId); command.Parameters.AddWithValue("@templateId", templateId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) throw new WorkflowValidationException("This draft is no longer available. Reload the form.");
        if (reader.GetBoolean(1) || reader.GetInt32(2) > 0) throw new WorkflowValidationException("Published or used versions are protected. Create a new draft to make changes.");
        if (!expected.AsSpan().SequenceEqual((byte[])reader.GetValue(0))) throw new DBConcurrencyException("Another administrator changed this draft. Your changes have not been saved. Copy any work you need, then reload the version.");
    }
    private static async Task<IReadOnlyList<AdminFormSection>> ReadFormAdminSectionsAsync(SqlConnection connection, DbTransaction? transaction, Guid versionId, string moduleKey, CancellationToken cancellationToken)
    {
        var sections = new List<AdminFormSection>(); var fields = new Dictionary<Guid, List<AdminFormField>>();
        await using var command = new SqlCommand("""
            SELECT section.id,section.section_key,section.title,section.display_order,field.id,field.field_key,field.label,field.field_type,field.is_required,field.display_order,field.help_text,field.configuration_json
            FROM forms.form_sections section LEFT JOIN forms.form_fields field ON field.form_section_id=section.id AND field.archived_at IS NULL AND field.is_active=1
            WHERE section.form_template_version_id=@id AND section.archived_at IS NULL
              AND (field.id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM forms.form_fields existing WHERE existing.form_section_id=section.id))
            ORDER BY section.display_order,section.id,field.display_order,field.id;
            """, connection, (SqlTransaction?)transaction);
        command.Parameters.AddWithValue("@id", versionId); await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var sectionId = reader.GetGuid(0); var key = reader.GetString(1);
            if (!fields.TryGetValue(sectionId, out var list)) { fields[sectionId] = list = []; sections.Add(new(sectionId, key, reader.GetString(2), reader.GetInt32(3), list)); }
            if (!reader.IsDBNull(4)) list.Add(new(reader.GetGuid(4), reader.GetString(5), reader.GetString(6), reader.GetString(7), reader.GetBoolean(8), reader.GetInt32(9), GetStringOrNull(reader, 10), ParseFieldOptions(GetStringOrNull(reader, 11)), FormAdministrationRules.IsProtected(moduleKey, key, reader.GetString(5))));
        }
        return sections;
    }
    private static async Task ValidateWorkScrutinyVersionAllocationAsync(SqlConnection connection, DbTransaction transaction, Guid templateId, CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand("""
            IF (SELECT COUNT(*) FROM forms.form_template_org_units assignment JOIN org.org_units team ON team.id=assignment.org_unit_id
                JOIN org.org_units faculty ON faculty.id=team.parent_org_unit_id
                WHERE assignment.form_template_id=@id AND assignment.archived_at IS NULL AND team.is_active=1 AND team.archived_at IS NULL
                AND team.org_unit_type IN('team','faculty_child_code','faculty_child') AND faculty.org_unit_type='faculty' AND faculty.is_active=1 AND faculty.archived_at IS NULL) <> 1
                THROW 51000,'Allocate this Work Scrutiny template to one active sub-team before publishing.',1;
            IF EXISTS(SELECT 1 FROM forms.form_template_org_units assignment JOIN forms.form_template_org_units other ON other.org_unit_id=assignment.org_unit_id AND other.form_template_id<>@id AND other.archived_at IS NULL
                JOIN forms.form_templates template ON template.id=other.form_template_id AND template.archived_at IS NULL AND template.is_active=1
                JOIN core.modules module ON module.id=template.module_id AND module.module_key='work_scrutiny'
                JOIN forms.form_template_versions version ON version.form_template_id=template.id AND version.is_published=1 AND version.active_to IS NULL AND version.archived_at IS NULL
                WHERE assignment.form_template_id=@id AND assignment.archived_at IS NULL)
                THROW 51000,'This sub-team has another active published template. Archive that template before publishing its replacement.',1;
            """, connection, (SqlTransaction)transaction);
        command.Parameters.AddWithValue("@id", templateId);
        try { await command.ExecuteNonQueryAsync(cancellationToken); }
        catch (SqlException exception) when (exception.Number == 51000) { throw new WorkflowValidationException(exception.Message); }
    }
    private static Task WriteFormVersionAuditAsync(SqlConnection connection, DbTransaction transaction, CurrentUser user, Guid templateId, string action, object detail, CancellationToken cancellationToken) =>
        WriteAuditAsync(connection, transaction, user.UserAccountId, null, "form_template", templateId, action, $"{action} by {user.DisplayName}.", null, JsonSerializer.Serialize(detail), cancellationToken);

    private static async Task<Dictionary<string, (Guid? Lookup, string? Validation, string? Configuration)>> ReadControlledFormConfigurationsAsync(
        SqlConnection connection, DbTransaction transaction, Guid versionId, CancellationToken cancellationToken)
    {
        var result = new Dictionary<string, (Guid? Lookup, string? Validation, string? Configuration)>(StringComparer.OrdinalIgnoreCase);
        await using var command = new SqlCommand("""
            SELECT field.field_key,field.options_lookup_type_id,field.validation_json,field.configuration_json
            FROM forms.form_fields field JOIN forms.form_sections section ON section.id=field.form_section_id
            WHERE section.form_template_version_id=@versionId AND field.archived_at IS NULL;
            """, connection, (SqlTransaction)transaction);
        command.Parameters.AddWithValue("@versionId", versionId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken)) result[reader.GetString(0)] = (GetGuidOrNull(reader, 1), GetStringOrNull(reader, 2), GetStringOrNull(reader, 3));
        return result;
    }
}
