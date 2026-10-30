using System.Data;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public static class WorkflowFormContentCatalog
{
    public static readonly IReadOnlyList<WorkflowFormContent> Forms = Load();
    private static IReadOnlyList<WorkflowFormContent> Load()
    {
        using var stream = typeof(WorkflowFormContentCatalog).Assembly.GetManifestResourceStream("TLQS.WorkflowFormContent.json")
            ?? throw new InvalidOperationException("The workflow form content catalogue is missing.");
        return JsonSerializer.Deserialize<WorkflowFormContent[]>(stream, new JsonSerializerOptions(JsonSerializerDefaults.Web))
            ?? throw new InvalidOperationException("The workflow form content catalogue is invalid.");
    }
    public static WorkflowFormContent Validate(string formKey, SaveWorkflowFormContentRequest request)
    {
        var form = Forms.SingleOrDefault(form => form.FormKey == formKey) ?? throw new WorkflowValidationException("Choose a supported workflow form.");
        if (request.Fields is null || request.Fields.Count != form.Fields.Count
            || request.Fields.Select(field => field.Key).Distinct(StringComparer.Ordinal).Count() != form.Fields.Count
            || request.Fields.Any(field => !form.Fields.Any(known => known.Key == field.Key) || string.IsNullOrWhiteSpace(field.Label)
                || field.Label.Trim().Length > 300 || field.HelpText?.Length > 1000))
            throw new WorkflowValidationException("Keep every prompt reference, with a label of 1–300 characters and guidance of up to 1,000 characters.");
        return form with { Fields = form.Fields.Select(known => request.Fields.Single(field => field.Key == known.Key) with { Label = request.Fields.Single(field => field.Key == known.Key).Label.Trim() }).ToArray() };
    }
}

public sealed partial class SqlFoundationDataStore
{
    public async Task<WorkflowFormContent?> GetWorkflowFormContentAsync(string formKey, CancellationToken cancellationToken)
    {
        var defaults = WorkflowFormContentCatalog.Forms.SingleOrDefault(form => form.FormKey == formKey);
        if (defaults is null) return null;
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var command = new SqlCommand("SELECT content_json,row_version FROM forms.workflow_content WHERE form_key=@key;", connection);
        command.Parameters.AddWithValue("@key", formKey); await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) return defaults;
        var saved = JsonSerializer.Deserialize<WorkflowFormContentField[]>(reader.GetString(0), new JsonSerializerOptions(JsonSerializerDefaults.Web)) ?? [];
        // New application prompts receive their defaults until an administrator explicitly customises them.
        return defaults with { Fields = defaults.Fields.Select(field => saved.FirstOrDefault(item => item.Key == field.Key) ?? field).ToArray(), RowVersion = Convert.ToBase64String((byte[])reader.GetValue(1)) };
    }

    public async Task<IReadOnlyList<WorkflowFormContent>> GetWorkflowFormContentAdministrationAsync(CurrentUser user, CancellationToken cancellationToken)
    {
        RequireFormAdministrator(user);
        var result = new List<WorkflowFormContent>();
        foreach (var form in WorkflowFormContentCatalog.Forms) result.Add((await GetWorkflowFormContentAsync(form.FormKey, cancellationToken))!);
        return result;
    }

    public async Task SaveWorkflowFormContentAsync(string formKey, SaveWorkflowFormContentRequest request, CurrentUser user, CancellationToken cancellationToken)
    {
        RequireFormAdministrator(user);
        var validated = WorkflowFormContentCatalog.Validate(formKey, request);
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        await using var command = new SqlCommand("""
            SELECT row_version,content_json FROM forms.workflow_content WITH(UPDLOCK,HOLDLOCK) WHERE form_key=@key;
            """, connection, (SqlTransaction)transaction);
        command.Parameters.AddWithValue("@key", formKey);
        byte[]? current = null; string? previousJson = null;
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            if (await reader.ReadAsync(cancellationToken)) { current = (byte[])reader.GetValue(0); previousJson = reader.GetString(1); }
        }
        string? currentToken = current is null ? null : Convert.ToBase64String(current);
        if (request.RowVersion != currentToken) throw new DBConcurrencyException("Another administrator changed this form's wording. Your edits are retained; reload before saving over newer changes.");
        await using var save = new SqlCommand("""
            IF EXISTS(SELECT 1 FROM forms.workflow_content WHERE form_key=@key)
                UPDATE forms.workflow_content SET content_json=@json,updated_at=sysutcdatetime() WHERE form_key=@key;
            ELSE INSERT INTO forms.workflow_content(form_key,content_json) VALUES(@key,@json);
            """, connection, (SqlTransaction)transaction);
        var nextJson = JsonSerializer.Serialize(validated.Fields, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        save.Parameters.AddWithValue("@key", formKey); save.Parameters.AddWithValue("@json", nextJson);
        await save.ExecuteNonQueryAsync(cancellationToken);
        await WriteAuditAsync(connection, transaction, user.UserAccountId, null, "workflow_form_content", Guid.Empty, "workflow_form_content.updated",
            $"{validated.Title} wording updated by {user.DisplayName}.", previousJson, nextJson, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }
}
