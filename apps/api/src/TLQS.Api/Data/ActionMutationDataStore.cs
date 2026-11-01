using Microsoft.Data.SqlClient;
using System.Text.Json;
using TLQS.Api.V1;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    private async Task<IReadOnlyList<ActionSummary>> EnrichQaActionWorkflowLocksAsync(IReadOnlyList<ActionSummary> actions,CancellationToken cancellationToken)
    {
        if(actions.Count==0)return actions;
        var archivedSources=await QueryAsync("""
            SELECT a.id FROM quality.actions a JOIN core.records record ON record.id=a.source_record_id
            JOIN OPENJSON(@ids) selected ON a.id=TRY_CONVERT(uniqueidentifier,selected.value)
            WHERE record.archived_at IS NOT NULL;
            """,command=>command.Parameters.AddWithValue("@ids",JsonSerializer.Serialize(actions.Select(action=>action.Id))),reader=>reader.GetGuid(0),cancellationToken);
        var archivedIds=archivedSources.ToHashSet();
        actions=actions.Select(action=>archivedIds.Contains(action.Id)?action with{SourceWorkflowLocked=true}:action).ToArray();
        var ids=actions.Where(action=>action.SourceRecordId.HasValue&&action.SourceRecordId!=Guid.Empty
            &&ActionOriginPolicy.CanonicalSourceType(action.SourceFormType)=="qa_review").Select(action=>action.Id).Distinct().ToArray();
        if(ids.Length==0)return actions;
        // Only identities already authorised by the action query are enriched. This is a UI hint;
        // every mutation rechecks current state transactionally below.
        var locked=await QueryAsync("""
            SELECT DISTINCT action.id
            FROM quality.actions action
            JOIN OPENJSON(@ids) selected ON action.id=TRY_CONVERT(uniqueidentifier,selected.value)
            LEFT JOIN core.records record ON record.id=action.source_record_id
            LEFT JOIN qa.reviews review ON review.record_id=record.id
            LEFT JOIN qa.action_group_assignments assignment ON assignment.action_id=action.id
            LEFT JOIN qa.action_groups action_group ON action_group.id=assignment.action_group_id
            WHERE record.id IS NULL OR record.archived_at IS NOT NULL OR review.status=N'archived'
                OR action_group.workflow_status IN(N'closed',N'archived');
            """,command=>command.Parameters.AddWithValue("@ids",JsonSerializer.Serialize(ids)),reader=>reader.GetGuid(0),cancellationToken);
        var lockedIds=locked.ToHashSet();
        return actions.Select(action=>lockedIds.Contains(action.Id)?action with{SourceWorkflowLocked=true}:action).ToArray();
    }

    private static bool HasStructuralActionFields(UpdateActionRequest request) => request.Title is not null || request.Detail is not null
        || request.ActionTheme is not null || request.OwnerStaffId.HasValue || request.DueDate.HasValue || request.VisibilitySetting is not null;

    private static async Task ValidateGenericActionMutationAsync(SqlConnection connection, SqlTransaction transaction, Guid actionId,
        GenericActionMutation mutation, bool structuralFields, CancellationToken cancellationToken)
    {
        Guid? sourceRecordId; string sourceType;bool sourceArchived;
        // Origin fields cannot be edited through action endpoints. Release this read before taking a QA group lock,
        // matching the native group's group-then-action lock order.
        await using (var source = new SqlCommand("""
            SELECT action.source_record_id,COALESCE(action.source_form_type,record.record_type,N''),record.archived_at
            FROM quality.actions action LEFT JOIN core.records record ON record.id=action.source_record_id WHERE action.id=@id;
            """,connection,transaction))
        {
            source.Parameters.AddWithValue("@id",actionId);
            await using var reader=await source.ExecuteReaderAsync(cancellationToken);
            if(!await reader.ReadAsync(cancellationToken))return;
            sourceRecordId=GetGuidOrNull(reader,0);sourceType=reader.GetString(1);
            sourceArchived=!reader.IsDBNull(2);
        }
        if(sourceArchived&&mutation is GenericActionMutation.Update or GenericActionMutation.Extend)
            throw new WorkflowValidationException("This action's originating record is archived. Restore the source before changing action progress.");
        ActionMutationPolicy.ValidateGenericMutation(sourceRecordId,sourceType,mutation,structuralFields);
        if(!sourceRecordId.HasValue||sourceRecordId==Guid.Empty||ActionOriginPolicy.CanonicalSourceType(sourceType)!="qa_review"
            ||mutation is GenericActionMutation.Delete or GenericActionMutation.Restore)return;

        await using(var group=new SqlCommand("""
            SELECT action_group.workflow_status
            FROM qa.action_group_assignments assignment
            JOIN qa.action_groups action_group WITH(UPDLOCK,HOLDLOCK) ON action_group.id=assignment.action_group_id
            WHERE assignment.action_id=@id;
            """,connection,transaction))
        {
            group.Parameters.AddWithValue("@id",actionId);
            await using var reader=await group.ExecuteReaderAsync(cancellationToken);
            while(await reader.ReadAsync(cancellationToken))ActionMutationPolicy.ValidateQaProgress(reader.GetString(0),null,false);
        }
        await using(var review=new SqlCommand("""
            SELECT review.status,record.archived_at
            FROM core.records record WITH(HOLDLOCK)
            LEFT JOIN qa.reviews review WITH(HOLDLOCK) ON review.record_id=record.id WHERE record.id=@id;
            """,connection,transaction))
        {
            review.Parameters.AddWithValue("@id",sourceRecordId.Value);
            await using var reader=await review.ExecuteReaderAsync(cancellationToken);
            if(!await reader.ReadAsync(cancellationToken))ActionMutationPolicy.ValidateQaProgress(null,null,true);
            else ActionMutationPolicy.ValidateQaProgress(null,GetStringOrNull(reader,0),!reader.IsDBNull(1));
        }
    }
}
