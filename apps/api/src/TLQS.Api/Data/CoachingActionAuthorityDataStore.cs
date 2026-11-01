using System.Text.Json;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Security;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    private async Task<HashSet<Guid>> GetManageableCoachingActionIdsAsync(IEnumerable<Guid> actionIds, CurrentUser user, CancellationToken ct)
    {
        var result = new HashSet<Guid>();
        await using var connection = await OpenConnectionAsync(ct);
        foreach (var id in actionIds.Distinct())
            if (await CanManageActionAsync(connection, null, id, user, ct)) result.Add(id);
        return result;
    }

    private sealed record CoachingActionSnapshot(CoachingSessionActionRequest Request, Guid SessionId, Guid OwnerStaffId,
        Guid? ParentActionId, bool Published, bool Archived);

    private static async Task<CoachingActionSnapshot?> ReadCoachingActionSnapshotAsync(SqlConnection connection, SqlTransaction transaction, Guid id, CancellationToken ct)
    {
        await using var command = new SqlCommand("""
            SELECT source_sub_record_id,action_theme,title,COALESCE(owner_context,N'staff'),owner_staff_id,due_date,
                   intended_evidence,intended_impact,review_date,COALESCE(progress_status,N'not_started'),
                   parent_action_id,published_to_staff,archived_at
            FROM quality.actions WITH(UPDLOCK,HOLDLOCK) WHERE id=@id AND source_sub_record_type=N'coaching_session';
            """, connection, transaction);
        command.Parameters.AddWithValue("@id", id);
        await using var reader = await command.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return null;
        return new(new(id,reader.GetString(1),reader.GetString(2),reader.GetString(3),GetDateOnlyOrNull(reader,5),
            GetStringOrNull(reader,6),GetStringOrNull(reader,7),GetDateOnlyOrNull(reader,8),reader.GetString(9)),
            reader.GetGuid(0),reader.GetGuid(4),GetGuidOrNull(reader,10),reader.GetBoolean(11),!reader.IsDBNull(12));
    }

    private static CoachingSessionActionRequest NormalizeCoachingAction(CoachingSessionActionRequest request, Guid? id) => request with
    {
        Id=id,ActionTheme=request.ActionTheme.Trim(),ActionText=request.ActionText.Trim(),OwnerType=request.OwnerType.ToLowerInvariant(),
        Status=request.Status.ToLowerInvariant(),IntendedEvidence=EmptyCoachingText(request.IntendedEvidence),IntendedImpact=EmptyCoachingText(request.IntendedImpact)
    };
    private static string? EmptyCoachingText(string? text) => string.IsNullOrEmpty(text) ? null : text;

    private static bool CoachingActionIsUnchanged(CoachingActionSnapshot saved, CoachingSessionActionRequest request, Guid sessionId,
        Guid staffId, Guid coachStaffId, Guid? parentId, string sessionStatus) => !saved.Archived
        && saved.SessionId==sessionId && saved.ParentActionId==parentId
        && saved.OwnerStaffId==(request.OwnerType.Equals("coach",StringComparison.OrdinalIgnoreCase)?coachStaffId:staffId)
        && saved.Published==sessionStatus.Equals("completed",StringComparison.OrdinalIgnoreCase)
        && NormalizeCoachingAction(saved.Request,saved.Request.Id)==NormalizeCoachingAction(request,saved.Request.Id);

    // An action assignment or permission to edit the conversation does not confer action authority.
    // Preserve unchanged read-only values so a coach can still save the rest of the session.
    private static async Task<bool> PreserveUnmanagedCoachingReviewAsync(SqlConnection connection, SqlTransaction transaction,
        Guid sessionId, CoachingActionReviewRequest request, Guid staffId, Guid coachStaffId, string sessionStatus, CurrentUser user, CancellationToken ct)
    {
        if (await CanManageActionAsync(connection,transaction,request.ActionId,user,ct)) return false;
        string? outcome=null,progress=null,impact=null; Guid? revisedId=null; var exists=false;
        await using (var command=new SqlCommand("""
            SELECT review_outcome,progress_update,impact_observed,revised_action_id
            FROM quality.coaching_action_reviews WITH(UPDLOCK,HOLDLOCK) WHERE session_id=@session AND action_id=@action;
            """,connection,transaction))
        {
            command.Parameters.AddWithValue("@session",sessionId);command.Parameters.AddWithValue("@action",request.ActionId);
            await using var reader=await command.ExecuteReaderAsync(ct);
            if(await reader.ReadAsync(ct)){exists=true;outcome=GetStringOrNull(reader,0);progress=GetStringOrNull(reader,1);impact=GetStringOrNull(reader,2);revisedId=GetGuidOrNull(reader,3);}
        }
        var unchanged=string.Equals(EmptyCoachingText(outcome),EmptyCoachingText(request.ReviewOutcome),StringComparison.OrdinalIgnoreCase)
            &&EmptyCoachingText(progress)==EmptyCoachingText(request.ProgressUpdate)&&EmptyCoachingText(impact)==EmptyCoachingText(request.ImpactObserved);
        if(revisedId.HasValue&&request.RevisedAction is not null)
        {
            var revised=await ReadCoachingActionSnapshotAsync(connection,transaction,revisedId.Value,ct);
            unchanged=unchanged&&revised is not null&&CoachingActionIsUnchanged(revised,request.RevisedAction,sessionId,staffId,coachStaffId,request.ActionId,sessionStatus);
        }
        else unchanged=unchanged&&!revisedId.HasValue&&request.RevisedAction is null;
        if(unchanged&&(exists||string.IsNullOrEmpty(request.ReviewOutcome)&&string.IsNullOrEmpty(request.ProgressUpdate)&&string.IsNullOrEmpty(request.ImpactObserved)))return true;
        await EnsureCanManageActionAsync(connection,transaction,request.ActionId,user,ct);
        return false;
    }

    private static async Task EnsureCanRemoveCoachingReviewsAsync(SqlConnection connection, SqlTransaction transaction, Guid sessionId,
        HashSet<Guid> retained, CurrentUser user, CancellationToken ct)
    {
        var removed=new List<(Guid Action,Guid? Revised)>();
        await using(var command=new SqlCommand("""
            SELECT action_id,revised_action_id FROM quality.coaching_action_reviews WITH(UPDLOCK,HOLDLOCK)
            WHERE session_id=@session AND action_id NOT IN(SELECT TRY_CONVERT(uniqueidentifier,value) FROM OPENJSON(@ids));
            """,connection,transaction))
        {
            command.Parameters.AddWithValue("@session",sessionId);command.Parameters.AddWithValue("@ids",JsonSerializer.Serialize(retained));
            await using var reader=await command.ExecuteReaderAsync(ct);
            while(await reader.ReadAsync(ct))removed.Add((reader.GetGuid(0),GetGuidOrNull(reader,1)));
        }
        foreach(var action in removed)
        {
            await EnsureCanManageActionAsync(connection,transaction,action.Action,user,ct);
            if(action.Revised.HasValue)await EnsureCanManageActionAsync(connection,transaction,action.Revised.Value,user,ct);
        }
    }
}
