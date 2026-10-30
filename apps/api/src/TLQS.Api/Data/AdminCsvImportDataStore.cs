using System.Data;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    internal async Task<AdminCsvImportPlan> PreviewAdminCsvAsync(string kind, string csv, CurrentUser user, CancellationToken token)
    {
        RequireCsvAdministrator(user, kind);
        var table = AdminCsvReader.Parse(csv);
        await using var connection = await OpenConnectionAsync(token);
        var ledger = await ReadCsvLedgerAsync(kind, table, connection, null, token);
        return await BuildAdminCsvPlanAsync(kind, table, user, connection, null, ledger, token);
    }

    internal async Task<AdminCsvImportResult> ApplyAdminCsvAsync(string kind, string csv, string expectedFingerprint, CurrentUser user, CancellationToken token)
    {
        RequireCsvAdministrator(user, kind);
        var table = AdminCsvReader.Parse(csv);
        await using var connection = await OpenConnectionAsync(token);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(IsolationLevel.Serializable, token);
        // One writer per import area; catalogue and source rows also remain locked by the transaction.
        await using (var claim = new SqlCommand("DECLARE @result int; EXEC @result = sys.sp_getapplock @Resource = @resource, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 10000; SELECT @result;", connection, transaction))
        {
            claim.Parameters.AddWithValue("@resource", $"tlqs:csv-import:{kind}");
            if (Convert.ToInt32(await claim.ExecuteScalarAsync(token)) < 0)
                throw new DBConcurrencyException("Another import is in progress. Wait briefly, then preview your file again.");
        }
        var ledger = await ReadCsvLedgerAsync(kind, table, connection, transaction, token);
        var plan = await BuildAdminCsvPlanAsync(kind, table, user, connection, transaction, ledger, token);
        if (!string.Equals(AdminCsvPlanFingerprint(plan), expectedFingerprint, StringComparison.Ordinal))
            throw new DBConcurrencyException("The data or import plan has changed since preview. Preview the file again before importing.");
        if (plan.Issues.Any(issue => issue.Severity == "error") || plan.Changes.Count == 0)
            throw new WorkflowValidationException("This file has no valid changes to import. Preview it again and resolve the listed issues.");

        var batchId = Guid.NewGuid();
        foreach (var change in plan.Changes)
        {
            token.ThrowIfCancellationRequested();
            var entityId = await change.Apply(connection, transaction, user, token);
            await using var insert = new SqlCommand("""
                INSERT INTO ops.csv_import_items(kind,source_reference,payload_sha256,entity_id,batch_id,imported_by_user_account_id)
                VALUES(@kind,@reference,@hash,@entityId,@batchId,@actor);
                """, connection, transaction);
            insert.Parameters.AddWithValue("@kind", kind);
            insert.Parameters.AddWithValue("@reference", change.Reference);
            insert.Parameters.AddWithValue("@hash", change.PayloadHash);
            insert.Parameters.AddWithValue("@entityId", entityId);
            insert.Parameters.AddWithValue("@batchId", batchId);
            insert.Parameters.AddWithValue("@actor", user.UserAccountId!.Value);
            await insert.ExecuteNonQueryAsync(token);
        }
        var skipped = plan.Rows.Where(row => row.Operation == "skip").Select(row => row.Reference).Distinct(StringComparer.OrdinalIgnoreCase).Count();
        var result = new AdminCsvImportResult(batchId, plan.Changes.Count, skipped,
            $"Imported {plan.Changes.Count} new {(plan.Changes.Count == 1 ? "entry" : "entries")}. {skipped} existing {(skipped == 1 ? "entry was" : "entries were")} skipped.");
        await WriteAuditAsync(connection, transaction, user.UserAccountId, null, "csv_import", batchId,
            "admin.csv_import_applied", $"{user.DisplayName} imported {plan.Changes.Count} {kind} entries.", null,
            JsonSerializer.Serialize(new { kind, batchId, result.CreatedCount, result.SkippedCount, csvSha256 = AdminCsvReader.Hash(csv) }), token);
        await transaction.CommitAsync(token);
        return result;
    }

    private Task<AdminCsvImportPlan> BuildAdminCsvPlanAsync(string kind, AdminCsvTable table, CurrentUser user,
        SqlConnection connection, SqlTransaction? transaction, IReadOnlyDictionary<string, AdminCsvLedgerEntry> ledger, CancellationToken token) => kind switch
    {
        "qa-questions" => BuildQaQuestionCsvPlanAsync(table, user, connection, transaction, ledger, token),
        "cpd-events" => BuildCpdCsvPlanAsync(table, user, connection, transaction, ledger, token),
        "managed-list-values" => BuildManagedListCsvPlanAsync(table, user, connection, transaction, ledger, token),
        _ => throw new WorkflowValidationException("Select a supported CSV import.")
    };

    internal static string AdminCsvPlanFingerprint(AdminCsvImportPlan plan) => AdminCsvReader.CanonicalHash(new
    {
        plan.Kind, plan.Rows, plan.Issues, plan.ContextFingerprint,
        changes = plan.Changes.Select(change => new { change.Reference, change.PayloadHash, change.FirstRowNumber })
    });

    internal static AdminCsvImportPreview CsvPreview(AdminCsvImportPlan plan, int rowsRead, string? previewToken = null) => new(
        plan.Kind, rowsRead, plan.Changes.Count,
        plan.Rows.Where(row => row.Operation == "skip").Select(row => row.Reference).Distinct(StringComparer.OrdinalIgnoreCase).Count(),
        plan.Rows, plan.Issues, plan.Changes.Count > 0 && !plan.Issues.Any(issue => issue.Severity == "error"), previewToken);

    private static void RequireCsvAdministrator(CurrentUser user, string kind)
    {
        if (!AdminCsvAccess.CanUse(user, kind)) throw new UnauthorizedAccessException("CSV imports are available only to an Administrator with permission to manage this area.");
    }

    private static async Task<IReadOnlyDictionary<string, AdminCsvLedgerEntry>> ReadCsvLedgerAsync(string kind,
        AdminCsvTable table, SqlConnection connection, SqlTransaction? transaction, CancellationToken token)
    {
        await using (var check = new SqlCommand("SELECT OBJECT_ID(N'ops.csv_import_items',N'U');", connection, transaction))
            if (await check.ExecuteScalarAsync(token) is DBNull)
                throw new WorkflowValidationException("CSV import storage is not available. Ask college IT to apply database migration 092.");
        var entries = new Dictionary<string, AdminCsvLedgerEntry>(StringComparer.OrdinalIgnoreCase);
        var references = table.Rows.Select(row => kind switch
        {
            "qa-questions" => AdminCsvReader.Get(row, "question_reference"),
            "cpd-events" => AdminCsvReader.Get(row, "event_reference"),
            _ => $"{AdminCsvReader.Get(row, "lookup_key").ToLowerInvariant()}:{ManagedListCsvPlanner.ValueKey(row)}"
        }).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        await using var command = new SqlCommand("""
            SELECT source_reference,payload_sha256,entity_id FROM ops.csv_import_items
            WHERE kind=@kind AND EXISTS(SELECT 1 FROM OPENJSON(@references) requested WHERE requested.value=source_reference);
            """, connection, transaction);
        command.Parameters.AddWithValue("@kind", kind);
        command.Parameters.AddWithValue("@references", JsonSerializer.Serialize(references));
        await using var reader = await command.ExecuteReaderAsync(token);
        while (await reader.ReadAsync(token)) entries.Add(reader.GetString(0), new(reader.GetString(0), reader.GetString(1), reader.GetGuid(2)));
        return entries;
    }
}
