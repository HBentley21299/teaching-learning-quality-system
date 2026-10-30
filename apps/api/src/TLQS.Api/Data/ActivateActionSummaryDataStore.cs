using System.Text.Json;
using TLQS.Api.V1;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    private async Task<IReadOnlyList<ActionSummary>> EnrichActivateActionResponsiblesAsync(IReadOnlyList<ActionSummary> actions,CancellationToken ct)
    {
        var ids=actions.Where(x=>x.SourceFormType==ProcessReviewRules.Activate).Select(x=>x.Id).ToArray();
        if(ids.Length==0)return actions;
        var people=await QueryAsync("""
            SELECT action_id,staff_id,display_name_snapshot FROM quality.process_review_action_assignees
            WHERE action_id IN(SELECT TRY_CONVERT(uniqueidentifier,value) FROM OPENJSON(@ids)) ORDER BY display_name_snapshot;
            """,command=>command.Parameters.AddWithValue("@ids",JsonSerializer.Serialize(ids)),reader=>new
            {ActionId=reader.GetGuid(0),StaffId=reader.GetGuid(1),Name=reader.GetString(2)},ct);
        var byAction=people.ToLookup(x=>x.ActionId);
        return actions.Select(action=>action.SourceFormType!=ProcessReviewRules.Activate?action:action with
        {
            ResponsibleStaffIds=byAction[action.Id].Any()?byAction[action.Id].Select(x=>x.StaffId).ToArray():[action.OwnerStaffId],
            ResponsibleStaffNames=byAction[action.Id].Any()?byAction[action.Id].Select(x=>x.Name).ToArray():[action.OwnerStaffName??"Staff member"]
        }).ToArray();
    }
}
