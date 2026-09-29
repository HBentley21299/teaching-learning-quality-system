using System.Data;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    public async Task<IReadOnlyList<PermissionSummary>> GetAssignablePermissionsAsync(CurrentUser user, CancellationToken token)
    {
        var catalogue = await QueryAsync("SELECT permission_key, name, category FROM auth.permissions WHERE archived_at IS NULL ORDER BY category, name;",
            r => new PermissionSummary(r.GetString(0), r.GetString(1), r.GetString(2)), token);
        return catalogue.Where(p => CustomRolePolicy.CanGrant(p.PermissionKey, user.Permissions)).ToArray();
    }

    public async Task<CustomRoleDetail?> GetCustomRoleAsync(Guid id, CancellationToken token)
    {
        var rows = await QueryAsync("""
            SELECT role.id, role.name, role.description, role.row_version, permission.permission_key
            FROM auth.roles role
            LEFT JOIN auth.role_permissions grant_row ON grant_row.role_id = role.id
            LEFT JOIN auth.permissions permission ON permission.id = grant_row.permission_id
            WHERE role.id = @id AND role.is_system = 0 AND role.role_key LIKE N'custom[_]%'
              AND role.archived_at IS NULL AND role.is_active = 1;
            """, command => command.Parameters.AddWithValue("@id", id),
            r => (Id: r.GetGuid(0), Name: r.GetString(1), Description: GetStringOrNull(r, 2), Version: r.GetFieldValue<byte[]>(3), Key: GetStringOrNull(r, 4)), token);
        if (rows.Count == 0) return null;
        var first = rows[0];
        return new(first.Id, first.Name, first.Description, rows.Where(r => r.Key is not null).Select(r => r.Key!).ToArray(), first.Version);
    }

    public async Task<Guid> SaveCustomRoleAsync(Guid? id, SaveCustomRoleRequest request, CurrentUser user, CancellationToken token)
    {
        if (!await IsActiveAdministratorAsync(user, token)) throw new UnauthorizedAccessException("Only an active Administrator can edit permission tiers.");
        if (string.IsNullOrWhiteSpace(request.Name) || request.Name.Trim().Length > 200 || request.Description?.Length > 1000)
            throw new WorkflowValidationException("Enter a tier name up to 200 characters and a description up to 1,000 characters.");
        if (request.PermissionKeys is null || request.PermissionKeys.Count > 500 || request.PermissionKeys.Any(key => !CustomRolePolicy.CanGrant(key, user.Permissions)))
            throw new WorkflowValidationException("Choose only capabilities you can grant. Mandatory CPD logging is reserved for Teaching and Learning and administrators.");
        var keys = request.PermissionKeys.Distinct(StringComparer.Ordinal).Order().ToArray();
        if (keys.Length == 0) throw new WorkflowValidationException("Select at least one capability.");
        if (id.HasValue && request.RowVersion is not { Length: 8 }) throw new WorkflowValidationException("Reload the tier before editing it.");
        var roleId = id ?? Guid.NewGuid();
        await using var connection = await OpenConnectionAsync(token);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(token);
        await LockAccountAdministrationAsync(connection, transaction, token);
        await RequireAdministratorAsync(connection, transaction, user, token);
        string? beforeJson = null;
        if (id.HasValue)
        {
            await using var before = new SqlCommand("SELECT name, description, (SELECT permission.permission_key FROM auth.role_permissions grant_row JOIN auth.permissions permission ON permission.id = grant_row.permission_id WHERE grant_row.role_id = auth.roles.id ORDER BY permission.permission_key FOR JSON PATH) FROM auth.roles WITH (UPDLOCK, HOLDLOCK) WHERE id = @id AND is_system = 0 AND role_key LIKE N'custom[_]%' AND archived_at IS NULL AND is_active = 1 AND row_version = @version;", connection, transaction);
            before.Parameters.AddWithValue("@id", roleId);
            before.Parameters.Add("@version", SqlDbType.Timestamp, 8).Value = request.RowVersion!;
            await using var reader = await before.ExecuteReaderAsync(token);
            if (!await reader.ReadAsync(token)) throw new DBConcurrencyException("This tier changed or is protected. Reload before saving.");
            beforeJson = JsonSerializer.Serialize(new { name = reader.GetString(0), description = GetStringOrNull(reader, 1), capabilities = reader.GetString(2) });
        }
        // Resolve every key before changing the tier; never silently drop unavailable grants.
        var resolved = new List<Guid>();
        foreach (var key in keys)
        {
            await using var permission = new SqlCommand("SELECT id FROM auth.permissions WHERE permission_key = @key AND archived_at IS NULL;", connection, transaction);
            permission.Parameters.AddWithValue("@key", key);
            if (await permission.ExecuteScalarAsync(token) is not Guid permissionId) throw new WorkflowValidationException("A selected capability is no longer available. Reload and try again.");
            resolved.Add(permissionId);
        }
        await using (var save = new SqlCommand(id.HasValue
            ? "UPDATE auth.roles SET name=@name, description=@description, updated_at=sysutcdatetime() WHERE id=@id; DELETE FROM auth.role_permissions WHERE role_id=@id;"
            : "INSERT auth.roles(id, role_key, name, description, is_system, precedence) VALUES(@id, @key, @name, @description, 0, 0);", connection, transaction))
        {
            save.Parameters.AddWithValue("@id", roleId);
            save.Parameters.AddWithValue("@key", "custom_" + roleId.ToString("N"));
            save.Parameters.AddWithValue("@name", request.Name.Trim());
            save.Parameters.AddWithValue("@description", ToDbValue(request.Description?.Trim()));
            await save.ExecuteNonQueryAsync(token);
        }
        foreach (var permissionId in resolved)
        {
            await using var grant = new SqlCommand("INSERT auth.role_permissions(role_id, permission_id) VALUES(@role, @permission);", connection, transaction);
            grant.Parameters.AddWithValue("@role", roleId);
            grant.Parameters.AddWithValue("@permission", permissionId);
            await grant.ExecuteNonQueryAsync(token);
        }
        await WriteAuditAsync(connection, transaction, user.UserAccountId, null, "role", roleId,
            id.HasValue ? "role.updated" : "role.created", $"Custom tier {request.Name.Trim()} saved.", beforeJson,
            JsonSerializer.Serialize(new { name = request.Name.Trim(), description = request.Description, permissionKeys = keys }), token);
        await transaction.CommitAsync(token);
        return roleId;
    }
}
