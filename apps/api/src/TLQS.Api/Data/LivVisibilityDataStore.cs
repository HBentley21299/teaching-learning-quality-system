using System.Text.Json;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    public async Task<FormSubmissionUpdateResult> UpdateLivStageVisibilityAsync(
        Guid livId, Guid stageId, bool visibleToStaff, CurrentUser currentUser,
        CancellationToken cancellationToken, string processKey = "liv")
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            var metadata = await GetLivCaseMetadataV2Async(connection, transaction, livId, cancellationToken);
            if (metadata is null) return FormSubmissionUpdateResult.NotFound;
            if (metadata.ProcessKey != processKey
                || !LivAccessPolicy.CanManageVisibility(metadata.CreatedByUserAccountId, currentUser.UserAccountId))
                return FormSubmissionUpdateResult.Forbidden;

            await using var command = new SqlCommand("""
                UPDATE stage
                SET visible_to_staff = @visible, updated_at = sysutcdatetime(), updated_by_user_account_id = @user
                FROM quality.liv_stages stage
                JOIN quality.liv_cycles cycle ON cycle.id = stage.liv_cycle_id
                WHERE stage.id = @stageId AND cycle.liv_record_id = @livId AND stage.archived_at IS NULL;
                """, connection, (SqlTransaction)transaction);
            command.Parameters.AddWithValue("@visible", visibleToStaff);
            command.Parameters.AddWithValue("@user", ToDbValue(currentUser.UserAccountId));
            command.Parameters.AddWithValue("@stageId", stageId);
            command.Parameters.AddWithValue("@livId", livId);
            if (await command.ExecuteNonQueryAsync(cancellationToken) == 0) return FormSubmissionUpdateResult.NotFound;

            await WriteAuditAsync(connection, transaction, currentUser.UserAccountId, metadata.RecordId,
                "liv_stage", stageId, "liv.stage_visibility_changed",
                visibleToStaff ? "LIV section shared with the staff member." : "LIV section hidden from the staff member.",
                null, JsonSerializer.Serialize(new { VisibleToStaff = visibleToStaff }), cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return FormSubmissionUpdateResult.Saved;
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }
}
